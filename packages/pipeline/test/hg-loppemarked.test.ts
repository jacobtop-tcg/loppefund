import { describe, expect, it } from 'vitest';
import { parseHgSaturdays, hgLoppemarked } from '../src/adapters/hg-loppemarked.ts';
import type { FetchResult } from '../src/adapters/types.ts';

const PAGE = 'Hver lørdag i Høje Gladsaxe fra kl. 9–14. Sæson: 23. maj – 10. oktober. Adresse Høje Gladsaxe Torv 4, 2860 Søborg';

describe('parseHgSaturdays', () => {
  it('emits every Saturday 09–14 within the stated season', () => {
    const occ = parseHgSaturdays(PAGE, 2026);
    // 23 May 2026 is a Saturday; season ends 10 Oct 2026.
    expect(occ[0]).toEqual({ date: '2026-05-23', startTime: '09:00', endTime: '14:00' });
    expect(occ.every((o) => new Date(`${o.date}T00:00:00Z`).getUTCDay() === 6)).toBe(true);
    expect(occ.every((o) => o.date >= '2026-05-23' && o.date <= '2026-10-10')).toBe(true);
    // consecutive Saturdays are 7 days apart
    expect(occ[1]!.date).toBe('2026-05-30');
  });

  it('returns nothing when no season range is present', () => {
    expect(parseHgSaturdays('velkommen til markedet', 2026)).toEqual([]);
  });
});

describe('hgLoppemarked adapter', () => {
  it('returns the Søborg market with the right place', async () => {
    const raws = await hgLoppemarked.fetchRawEvents!(async () => ({ url: 'x', status: 200, body: PAGE }) as FetchResult);
    expect(raws).toHaveLength(1);
    const r = raws[0]!;
    expect(r.category).toBe('loppemarked');
    expect(r.postcode).toBe('2860');
    expect(r.city).toBe('Søborg');
    expect((r.occurrences ?? []).length).toBeGreaterThan(10);
  });

  it('emits nothing when the site is down', async () => {
    expect(await hgLoppemarked.fetchRawEvents!(async () => ({ url: 'x', status: 500, body: '' }))).toEqual([]);
  });
});
