import { describe, expect, it } from 'vitest';
import {
  cacheGeocode,
  expirePastEvents,
  getCachedGeocode,
  getEventBySlug,
  insertEvent,
  linkEventSource,
  listEventsBetween,
  openDb,
  replaceOccurrences,
  searchEvents,
  upsertRawEvent,
  upsertSource,
} from '../src/index.ts';

function testEvent(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    slug: 'broens-lopper',
    title: 'Broens Lopper',
    description: 'Loppemarked på kajen ved Broens Street Food',
    category: 'loppemarked' as const,
    venueName: 'Broens Street Food',
    street: 'Strandgade 95',
    postcode: '1401',
    city: 'København K',
    municipality: 'København',
    lat: 55.6799,
    lng: 12.5988,
    geocodeQuality: 'A',
    organizer: 'Broens Street Food',
    contactWebsite: 'https://broensstreetfood.dk',
    contactEmail: null,
    contactPhone: null,
    priceText: 'Gratis',
    isFree: true,
    stallCountText: '26-50',
    indoorOutdoor: 'outdoor' as const,
    scheduleText: 'Søndag i alle ulige uger',
    openingHoursText: 'Søndag 12-17',
    status: 'active' as const,
    confidence: 0.8,
    fieldProvenance: { title: 'markedskalenderen' },
    firstSeenAt: now,
    lastSeenAt: now,
    ...overrides,
  };
}

describe('db round trip', () => {
  it('stores and retrieves an event with occurrences and sources', () => {
    const db = openDb(':memory:');
    upsertSource(db, {
      key: 'markedskalenderen',
      name: 'Markedskalenderen',
      baseUrl: 'https://markedskalenderen.dk',
      trust: 0.7,
    });
    const raw = upsertRawEvent(db, {
      sourceKey: 'markedskalenderen',
      sourceEventId: 'broens-lopper',
      sourceUrl: 'https://markedskalenderen.dk/marked/show/broens-lopper',
      title: 'Broens Lopper',
    });
    expect(raw.changed).toBe(true);

    const id = insertEvent(db, testEvent());
    replaceOccurrences(db, id, [
      { date: '2026-07-05', startTime: '12:00', endTime: '17:00' },
      { date: '2026-07-19', startTime: '12:00', endTime: '17:00' },
    ]);
    linkEventSource(db, id, raw.id);

    const found = getEventBySlug(db, 'broens-lopper');
    expect(found?.title).toBe('Broens Lopper');
    expect(found?.occurrences).toHaveLength(2);
    expect(found?.sources[0]?.name).toBe('Markedskalenderen');

    const weekend = listEventsBetween(db, '2026-07-04', '2026-07-05');
    expect(weekend).toHaveLength(1);
    expect(weekend[0]?.occurrences).toHaveLength(1);
  });

  it('detects unchanged raw events', () => {
    const db = openDb(':memory:');
    upsertSource(db, { key: 's', name: 'S', baseUrl: 'https://x', trust: 0.5 });
    const raw = {
      sourceKey: 's',
      sourceEventId: 'e1',
      sourceUrl: 'https://x/e1',
      title: 'Marked',
    };
    expect(upsertRawEvent(db, raw).changed).toBe(true);
    expect(upsertRawEvent(db, raw).changed).toBe(false);
    expect(upsertRawEvent(db, { ...raw, title: 'Marked 2' }).changed).toBe(true);
  });

  it('searches with FTS including prefixes and diacritics', () => {
    const db = openDb(':memory:');
    const id = insertEvent(db, testEvent());
    expect(searchEvents(db, 'broens')).toEqual([id]);
    expect(searchEvents(db, 'lop')).toEqual([id]);
    expect(searchEvents(db, 'københavn')).toEqual([id]);
    expect(searchEvents(db, 'kobenhavn')).toEqual([id]);
    expect(searchEvents(db, 'aarhus')).toEqual([]);
  });

  it('expires events with no future occurrences', () => {
    const db = openDb(':memory:');
    const id = insertEvent(db, testEvent());
    replaceOccurrences(db, id, [
      { date: '2026-06-01', startTime: null, endTime: null },
    ]);
    expect(expirePastEvents(db, '2026-07-01')).toBe(1);
    expect(listEventsBetween(db, '2026-01-01', '2026-12-31')).toHaveLength(0);
  });

  it('caches geocodes', () => {
    const db = openDb(':memory:');
    expect(getCachedGeocode(db, 'Strandgade 95, 1401')).toBeNull();
    cacheGeocode(db, 'Strandgade 95, 1401', {
      lat: 55.68,
      lng: 12.6,
      quality: 'A',
      resolvedCity: 'København K',
      resolvedPostcode: '1401',
    });
    expect(getCachedGeocode(db, 'Strandgade 95, 1401')?.lat).toBe(55.68);
  });
});
