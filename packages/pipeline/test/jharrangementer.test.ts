import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  jharrangementer,
  jhEntryToRaw,
  parseCalendar,
  parseCityAddress,
  type JhEntry,
} from '../src/adapters/jharrangementer.ts';

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf-8');

const daySpan = (start: string, end: string) =>
  (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;

describe('jharrangementer calendar parsing', () => {
  const entries = parseCalendar(fixture('jharrangementer-calendar.html'));

  it('extracts every market weekend as a dated entry', () => {
    // 20 market rows on the calendar; one has a corrupt 32-day range (see below)
    // and is dropped, leaving 19.
    expect(entries.length).toBe(19);
    for (const e of entries) {
      expect(e.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.title).toMatch(/marked/i);
    }
  });

  it('drops the corrupt month-long "weekend" (10/10-11/11-2026 data error)', () => {
    // The source lists Køge as 10/10–11/11-2026 (32 days) — a data-entry typo.
    // A weekend market spanning a month is not a real occurrence; skip it
    // rather than fabricate 32 wrong days. "Missing over incorrect."
    expect(
      entries.some((e) => e.start === '2026-10-10' && e.end === '2026-11-11'),
    ).toBe(false);
    for (const e of entries) expect(daySpan(e.start, e.end)).toBeLessThanOrEqual(6);
  });

  it('pairs each market name with its own city page (first for-besøgende link)', () => {
    // Gigantium is in Aalborg — the name says nothing about "Aalborg", so this
    // only works if the first /for-besoegende/ link in the row is the market's
    // own page and not one of the trailing navigation links.
    const gigantium = entries.find((e) => /Gigantium/i.test(e.venue));
    expect(gigantium?.citySlug).toBe('aalborg');

    const koege = entries.find((e) => e.citySlug === 'koege' && e.start === '2027-01-16');
    expect(koege?.venue).toContain('Køge Hallerne');
    expect(koege?.end).toBe('2027-01-17');
  });
});

describe('jharrangementer city-page address parsing', () => {
  it('reads the venue postcode and city, not the JH office footer', () => {
    // Every city page repeats "2630 Taastrup" (JH's own office) in the footer.
    expect(parseCityAddress(fixture('jharrangementer-city-koege.html'))).toEqual({
      postcode: '4600',
      city: 'Køge',
    });
  });

  it('returns a null postcode when the page lists no venue address', () => {
    // Roskilde's page has no venue postcode at all — only the office footer.
    expect(parseCityAddress(fixture('jharrangementer-city-roskilde.html')).postcode).toBe(
      null,
    );
  });
});

describe('jharrangementer RawEvent construction', () => {
  const entry: JhEntry = {
    title: 'Køges store kræmmer og Loppemarked i Køge Hallerne',
    venue: 'Køge Hallerne',
    citySlug: 'koege',
    start: '2027-01-16',
    end: '2027-01-17',
  };

  it('builds a located RawEvent from an entry and its city address', () => {
    const raw = jhEntryToRaw(entry, { postcode: '4600', city: 'Køge' });
    expect(raw.sourceKey).toBe('jharrangementer');
    expect(raw.title).toBe('Køges store kræmmer og Loppemarked i Køge Hallerne');
    expect(raw.venueName).toBe('Køge Hallerne');
    expect(raw.postcode).toBe('4600');
    expect(raw.city).toBe('Køge');
    // No reliable street on the page — leave it null so geocoding falls back to
    // the postcode centroid rather than guessing a wrong address.
    expect(raw.street).toBeUndefined();
    expect(raw.category).toBe('kraemmermarked');
    expect(raw.sourceUrl).toContain('/for-besoegende/koege.aspx');
    expect(raw.occurrences).toEqual([
      { date: '2027-01-16', startTime: null, endTime: null },
      { date: '2027-01-17', startTime: null, endTime: null },
    ]);
  });

  it('gives each market weekend a stable, unique source id', () => {
    const a = jhEntryToRaw(entry, { postcode: '4600', city: 'Køge' });
    const b = jhEntryToRaw({ ...entry, start: '2026-10-10', end: '2026-10-11' }, null);
    expect(a.sourceEventId).toBe(jhEntryToRaw(entry, null).sourceEventId);
    expect(a.sourceEventId).not.toBe(b.sourceEventId);
  });

  it('still produces a valid event when the city page has no address', () => {
    const raw = jhEntryToRaw(entry, null);
    expect(raw.postcode).toBeUndefined();
    expect(raw.city).toBeUndefined();
    expect(raw.occurrences?.length).toBe(2);
  });
});

describe('jharrangementer adapter', () => {
  it('is an API-shaped source at broadening-coverage trust', () => {
    expect(jharrangementer.key).toBe('jharrangementer');
    expect(jharrangementer.trust).toBeGreaterThanOrEqual(0.55);
    expect(jharrangementer.trust).toBeLessThanOrEqual(0.6);
    expect(typeof jharrangementer.fetchRawEvents).toBe('function');
  });
});
