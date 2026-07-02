import { describe, expect, it } from 'vitest';
import { openDb, getEventBySlug, upsertSource } from '@loppefund/db';
import type { RawEvent } from '@loppefund/core';
import { canonicalizeRawEvent, type CanonicalizeStats } from '../src/canonicalize.ts';

const trust = { markedskalenderen: 0.7, kultunaut: 0.6 };

function newStats(): CanonicalizeStats {
  return { created: 0, merged: 0, unchanged: 0, skippedNoDates: 0 };
}

const future = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 10);
  return d.toISOString().slice(0, 10);
})();

function rawA(): RawEvent {
  return {
    sourceKey: 'markedskalenderen',
    sourceUrl: 'https://markedskalenderen.dk/marked/show/testmarked',
    sourceEventId: 'testmarked',
    title: 'Testmarked på Havnen',
    category: 'loppemarked',
    street: 'Havnegade 1',
    postcode: '5000',
    city: 'Odense C',
    lat: 55.4,
    lng: 10.38,
    priceText: 'Gratis',
    isFree: true,
    dateRanges: [{ start: future, end: future }],
    openingHoursText: '10-16',
  };
}

describe('canonicalizeRawEvent', () => {
  it('creates a canonical event with occurrences and provenance', async () => {
    const db = openDb(':memory:');
    upsertSource(db, { key: 'markedskalenderen', name: 'MK', baseUrl: 'x', trust: 0.7 });
    const stats = newStats();
    await canonicalizeRawEvent(db, rawA(), trust, stats);
    expect(stats.created).toBe(1);

    const e = getEventBySlug(db, 'testmarked-paa-havnen-odense-c');
    expect(e).not.toBeNull();
    expect(e!.occurrences).toEqual([
      { date: future, start_time: '10:00', end_time: '16:00' },
    ]);
    expect(e!.confidence).toBeGreaterThan(0.5);
    expect(JSON.parse(e!.field_provenance).title).toBe('markedskalenderen');
  });

  it('merges the same market from a second source instead of duplicating', async () => {
    const db = openDb(':memory:');
    upsertSource(db, { key: 'markedskalenderen', name: 'MK', baseUrl: 'x', trust: 0.7 });
    upsertSource(db, { key: 'kultunaut', name: 'KN', baseUrl: 'x', trust: 0.6 });
    const stats = newStats();
    await canonicalizeRawEvent(db, rawA(), trust, stats);

    const fromKultunaut: RawEvent = {
      sourceKey: 'kultunaut',
      sourceUrl: 'https://kultunaut.dk/arr/123',
      sourceEventId: '123',
      title: 'Testmarked på havnen i Odense',
      lat: 55.4001,
      lng: 10.3801,
      postcode: '5000',
      description: 'Hyggeligt loppemarked ved havnen med 40 stande.',
      occurrences: [{ date: future, startTime: null, endTime: null }],
    };
    await canonicalizeRawEvent(db, fromKultunaut, trust, stats);
    expect(stats.created).toBe(1);
    expect(stats.merged).toBe(1);

    const e = getEventBySlug(db, 'testmarked-paa-havnen-odense-c')!;
    // Second source contributed the description; provenance records it.
    expect(e.description).toContain('Hyggeligt');
    expect(JSON.parse(e.field_provenance).description).toBe('kultunaut');
    // Occurrence with times wins over the one without.
    expect(e.occurrences).toEqual([
      { date: future, start_time: '10:00', end_time: '16:00' },
    ]);
    expect(e.sources).toHaveLength(2);
    // Corroboration raises confidence.
    expect(e.confidence).toBeGreaterThan(0.75);
  });

  it('re-processing the identical raw event counts as unchanged', async () => {
    const db = openDb(':memory:');
    upsertSource(db, { key: 'markedskalenderen', name: 'MK', baseUrl: 'x', trust: 0.7 });
    const stats = newStats();
    await canonicalizeRawEvent(db, rawA(), trust, stats);
    await canonicalizeRawEvent(db, rawA(), trust, stats);
    expect(stats.created).toBe(1);
    expect(stats.unchanged).toBe(1);
  });

  it('skips events with no resolvable dates', async () => {
    const db = openDb(':memory:');
    upsertSource(db, { key: 'markedskalenderen', name: 'MK', baseUrl: 'x', trust: 0.7 });
    const stats = newStats();
    await canonicalizeRawEvent(
      db,
      { ...rawA(), dateRanges: undefined, openingHoursText: undefined },
      trust,
      stats,
    );
    expect(stats.created).toBe(0);
    expect(stats.skippedNoDates).toBe(1);
  });

  it('marks cancelled events', async () => {
    const db = openDb(':memory:');
    upsertSource(db, { key: 'markedskalenderen', name: 'MK', baseUrl: 'x', trust: 0.7 });
    const stats = newStats();
    await canonicalizeRawEvent(db, rawA(), trust, stats);
    await canonicalizeRawEvent(db, { ...rawA(), cancelled: true }, trust, stats);
    const e = getEventBySlug(db, 'testmarked-paa-havnen-odense-c')!;
    expect(e.status).toBe('cancelled');
  });

  it('does not let a low-trust source cancel a higher-trust event', async () => {
    const db = openDb(':memory:');
    upsertSource(db, { key: 'markedskalenderen', name: 'MK', baseUrl: 'x', trust: 0.7 });
    upsertSource(db, { key: 'tip', name: 'Tip', baseUrl: 'x', trust: 0.35 });
    const t2 = { ...trust, tip: 0.35 };
    const stats = newStats();
    await canonicalizeRawEvent(db, rawA(), t2, stats);
    await canonicalizeRawEvent(
      db,
      { ...rawA(), sourceKey: 'tip', sourceUrl: 'tip:1', sourceEventId: 't1', cancelled: true },
      t2,
      stats,
    );
    expect(getEventBySlug(db, 'testmarked-paa-havnen-odense-c')!.status).toBe('active');
  });

  it('lets the dominant source restore a cancelled event it re-publishes', async () => {
    const db = openDb(':memory:');
    upsertSource(db, { key: 'markedskalenderen', name: 'MK', baseUrl: 'x', trust: 0.7 });
    const stats = newStats();
    const laterDate = (() => {
      const d = new Date();
      d.setDate(d.getDate() + 30);
      return d.toISOString().slice(0, 10);
    })();
    await canonicalizeRawEvent(db, rawA(), trust, stats);
    await canonicalizeRawEvent(db, { ...rawA(), cancelled: true }, trust, stats);
    expect(getEventBySlug(db, 'testmarked-paa-havnen-odense-c')!.status).toBe('cancelled');
    // Organizer re-publishes with a new date and a clean title.
    await canonicalizeRawEvent(
      db,
      { ...rawA(), dateRanges: [{ start: laterDate, end: laterDate }] },
      trust,
      stats,
    );
    expect(getEventBySlug(db, 'testmarked-paa-havnen-odense-c')!.status).toBe('active');
  });
});
