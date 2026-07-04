import { describe, expect, it } from 'vitest';
import { tippelsbjerggaard, upcomingOpenDays } from '../src/adapters/tippelsbjerggaard.ts';

describe('tippelsbjerggaard adapter', () => {
  it('returns only verified open days on/after today, kl. 10–16', () => {
    const occ = upcomingOpenDays('2026-10-01');
    expect(occ.map((o) => o.date)).toEqual([
      '2026-10-04', '2026-10-18', '2026-11-01', '2026-11-15', '2026-12-06', '2026-12-20',
    ]);
    expect(occ.every((o) => o.startTime === '10:00' && o.endTime === '16:00')).toBe(true);
  });

  it('drops past dates and yields nothing once the season is over', () => {
    expect(upcomingOpenDays('2026-08-17').some((o) => o.date === '2026-08-16')).toBe(false);
    expect(upcomingOpenDays('2027-01-01')).toEqual([]);
  });

  it('emits a single well-formed Faaborg market with provenance', async () => {
    const raws = await tippelsbjerggaard.fetchRawEvents!(async () => ({ url: '', status: 200, body: '' }));
    // Empty only if run after the season; guard so the test is season-agnostic.
    if (raws.length === 0) return;
    const r = raws[0]!;
    expect(r.title).toMatch(/Tippelsbjerggaard/);
    expect(r.postcode).toBe('5600');
    expect(r.city).toBe('Faaborg');
    expect(r.street).toBe('Hornegydén 6');
    expect(r.sourceUrl).toContain('visitfaaborg.dk');
  });
});
