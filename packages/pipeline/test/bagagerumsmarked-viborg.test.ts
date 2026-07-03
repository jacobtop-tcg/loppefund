import { describe, expect, it } from 'vitest';
import {
  bagagerumViborgOccurrences,
  bagagerumsmarkedViborg,
} from '../src/adapters/bagagerumsmarked-viborg.ts';
import type { FetchResult } from '../src/adapters/types.ts';

describe('bagagerumViborgOccurrences', () => {
  const occ = bagagerumViborgOccurrences([2026]);

  it('emits the first Sat+Sun of every month Apr–Oct', () => {
    expect(occ).toHaveLength(14); // 7 months × 2 days
    // July 2026: first Saturday is the 4th, Sunday the 5th.
    expect(occ).toContainEqual({ date: '2026-07-04', startTime: '06:00', endTime: '15:00' });
    expect(occ).toContainEqual({ date: '2026-07-05', startTime: '08:00', endTime: '14:00' });
    // April 2026 first weekend anchors the season start.
    expect(occ[0]).toEqual({ date: '2026-04-04', startTime: '06:00', endTime: '15:00' });
  });

  it('gives Saturdays 06–15 and Sundays 08–14', () => {
    const sats = occ.filter((_, i) => i % 2 === 0);
    const suns = occ.filter((_, i) => i % 2 === 1);
    expect(sats.every((o) => o.startTime === '06:00' && o.endTime === '15:00')).toBe(true);
    expect(suns.every((o) => o.startTime === '08:00' && o.endTime === '14:00')).toBe(true);
  });
});

describe('bagagerumsmarkedViborg adapter', () => {
  const ok: FetchResult = { url: 'x', status: 200, body: '<h1>Bagagerumsmarked Viborg</h1>' };

  it('returns one market with the right place when the site is live', async () => {
    const raws = await bagagerumsmarkedViborg.fetchRawEvents!(async () => ok);
    expect(raws).toHaveLength(1);
    const r = raws[0]!;
    expect(r.title).toBe('Bagagerumsmarked Viborg');
    expect(r.category).toBe('bagagerumsmarked');
    expect(r.postcode).toBe('8800');
    expect(r.city).toBe('Viborg');
    expect(r.street).toBe('Fabrikvej');
    expect((r.occurrences ?? []).length).toBeGreaterThan(0);
  });

  it('emits nothing if the site is down or no longer this market', async () => {
    expect(await bagagerumsmarkedViborg.fetchRawEvents!(async () => ({ url: 'x', status: 500, body: '' }))).toEqual([]);
    expect(
      await bagagerumsmarkedViborg.fetchRawEvents!(async () => ({ url: 'x', status: 200, body: 'noget helt andet' })),
    ).toEqual([]);
  });
});
