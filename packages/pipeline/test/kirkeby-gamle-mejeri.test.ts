import { describe, expect, it } from 'vitest';
import { resolveSchedule } from '@loppefund/core';
import { kirkebyGamleMejeri } from '../src/adapters/kirkeby-gamle-mejeri.ts';
import type { FetchResult } from '../src/adapters/types.ts';

describe('kirkebyGamleMejeri adapter', () => {
  const ok: FetchResult = { url: 'x', status: 200, body: 'Fyns største indendørs kræmmermarked' };

  it('returns the Stenstrup market with the right place and recurrence', async () => {
    const raws = await kirkebyGamleMejeri.fetchRawEvents!(async () => ok);
    expect(raws).toHaveLength(1);
    const r = raws[0]!;
    expect(r.category).toBe('kraemmermarked');
    expect(r.street).toBe('Assensvej 13');
    expect(r.postcode).toBe('5771');
    expect(r.city).toBe('Stenstrup');
    expect(r.scheduleText).toBe('Søndag i lige uger');
  });

  it('its recurrence resolves to even-week Sundays 10–16', async () => {
    const [r] = await kirkebyGamleMejeri.fetchRawEvents!(async () => ok);
    const occ = resolveSchedule(
      { scheduleText: r!.scheduleText, openingHoursText: r!.openingHoursText },
      { from: '2026-07-01', horizonDays: 28 },
    );
    // 2026-07-05 (wk27, odd) skipped; 2026-07-12 (wk28, even) kept, etc.
    expect(occ.map((o) => o.date)).toEqual(['2026-07-12', '2026-07-26']);
    expect(occ.every((o) => o.startTime === '10:00' && o.endTime === '16:00')).toBe(true);
  });

  it('emits nothing when the site is down', async () => {
    expect(await kirkebyGamleMejeri.fetchRawEvents!(async () => ({ url: 'x', status: 503, body: '' }))).toEqual([]);
  });
});
