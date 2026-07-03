import { describe, expect, it } from 'vitest';
import { parseVorbasseDates, vorbasseMarked } from '../src/adapters/vorbasse-marked.ts';
import type { FetchResult } from '../src/adapters/types.ts';

describe('parseVorbasseDates', () => {
  it('parses "16. til 18. juli 2026" into three day occurrences', () => {
    expect(parseVorbasseDates('Vorbasse Marked - 16. til 18. juli 2026').map((o) => o.date)).toEqual([
      '2026-07-16',
      '2026-07-17',
      '2026-07-18',
    ]);
  });

  it('parses an en-dash range too, with null times', () => {
    const occ = parseVorbasseDates('Vorbasse Marked 20.–22. juli 2027');
    expect(occ.map((o) => o.date)).toEqual(['2027-07-20', '2027-07-21', '2027-07-22']);
    expect(occ.every((o) => o.startTime === null && o.endTime === null)).toBe(true);
  });

  it('rejects an implausible span / no date', () => {
    expect(parseVorbasseDates('åbent 1. til 30. juli 2026')).toEqual([]); // > 10 days
    expect(parseVorbasseDates('velkommen til markedet')).toEqual([]);
  });
});

describe('vorbasseMarked adapter', () => {
  it('returns Vorbasse Marked with parsed dates when the site is live', async () => {
    const body: FetchResult = { url: 'x', status: 200, body: 'Vorbasse Marked - 16. til 18. juli 2026' };
    const raws = await vorbasseMarked.fetchRawEvents!(async () => body);
    expect(raws).toHaveLength(1);
    const r = raws[0]!;
    expect(r.title).toBe('Vorbasse Marked');
    expect(r.category).toBe('kraemmermarked');
    expect(r.postcode).toBe('6623');
    expect(r.city).toBe('Vorbasse');
    expect((r.occurrences ?? []).map((o) => o.date)).toEqual(['2026-07-16', '2026-07-17', '2026-07-18']);
  });

  it('emits nothing when no date is announced or the site is down', async () => {
    expect(await vorbasseMarked.fetchRawEvents!(async () => ({ url: 'x', status: 200, body: 'ingen dato endnu' }))).toEqual([]);
    expect(await vorbasseMarked.fetchRawEvents!(async () => ({ url: 'x', status: 404, body: '' }))).toEqual([]);
  });
});
