import { describe, expect, it } from 'vitest';
import { parseLocation, periodsToOccurrences, itemToRaw } from './visitdenmark.ts';

describe('parseLocation', () => {
  it('parses a "lat,lng" pair inside Denmark', () => {
    expect(parseLocation('55.057453,9.742739')).toEqual({ lat: 55.057453, lng: 9.742739 });
  });
  it('rejects empty / malformed / out-of-bounds', () => {
    expect(parseLocation(undefined)).toBeNull();
    expect(parseLocation('')).toBeNull();
    expect(parseLocation('55.05')).toBeNull();
    // lng,lat swapped would put "lat" at ~9 (out of Danish 50–60 band) -> reject
    expect(parseLocation('9.742739,55.057453')).toBeNull();
  });
});

describe('periodsToOccurrences', () => {
  const today = '2026-07-04';

  it('keeps future single-day periods, drops past ones', () => {
    const occ = periodsToOccurrences(
      [{ startDate: '2026-07-06T00:00:00', endDate: '2026-07-06T00:00:00' }, { startDate: '2026-06-01T00:00:00' }],
      today,
    );
    expect(occ).toEqual([{ date: '2026-07-06', startTime: null, endTime: null }]);
  });

  it('expands a multi-day range to distinct days (whole-day, no invented times)', () => {
    const occ = periodsToOccurrences([{ startDate: '2026-09-12T00:00:00', endDate: '2026-09-14T00:00:00' }], today);
    expect(occ.map((o) => o.date)).toEqual(['2026-09-12', '2026-09-13', '2026-09-14']);
    expect(occ.every((o) => o.startTime === null && o.endTime === null)).toBe(true);
  });

  it('dedupes and sorts overlapping periods', () => {
    const occ = periodsToOccurrences(
      [{ startDate: '2026-08-16T00:00:00' }, { startDate: '2026-08-02T00:00:00' }, { startDate: '2026-08-16T00:00:00' }],
      today,
    );
    expect(occ.map((o) => o.date)).toEqual(['2026-08-02', '2026-08-16']);
  });

  it('returns nothing when every period is in the past', () => {
    expect(periodsToOccurrences([{ startDate: '2025-01-01T00:00:00' }], today)).toEqual([]);
  });
});

describe('itemToRaw', () => {
  const today = '2026-07-04';

  it('rejects a non-market title', async () => {
    const raw = await itemToRaw(
      { pid: 1, title: 'Broager Ringridning', periodsByDate: [{ startDate: '2026-07-10T00:00:00' }] },
      today,
    );
    expect(raw).toBeNull();
  });

  it('rejects a market with no future date', async () => {
    const raw = await itemToRaw(
      { pid: 2, title: 'Kræmmermarked i Nordborg', periodsByDate: [{ startDate: '2020-01-01T00:00:00' }] },
      today,
    );
    expect(raw).toBeNull();
  });

  it('builds a market RawEvent with a stable GuideDanmark id (no address lookup without coords)', async () => {
    const raw = await itemToRaw(
      {
        pid: 611162,
        title: 'Kræmmermarked i Nordborg',
        path: 'https://www.visitsonderjylland.dk/turist/information/kraemmermarked-i-nordborg-gdk611162',
        periodsByDate: [{ startDate: '2026-07-06T00:00:00', endDate: '2026-07-06T00:00:00' }],
        // no location -> no reverse-geocode network call in this unit test
      },
      today,
    );
    expect(raw).not.toBeNull();
    expect(raw!.sourceKey).toBe('visitdenmark');
    expect(raw!.sourceEventId).toBe('gdk-611162');
    expect(raw!.title).toBe('Kræmmermarked i Nordborg');
    expect(raw!.category).toBeUndefined(); // canonicalizer derives it
    expect(raw!.occurrences).toEqual([{ date: '2026-07-06', startTime: null, endTime: null }]);
    expect(raw!.lat).toBeUndefined();
  });
});
