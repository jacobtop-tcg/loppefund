import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRaskEventCity, raskevent } from '../src/adapters/raskevent.ts';

const AALBORG = readFileSync(join(import.meta.dirname, 'fixtures/raskevent-aalborg.html'), 'utf8');

describe('parseRaskEventCity (Rask Event / bagagerumsmarkeder.dk)', () => {
  const r = parseRaskEventCity(AALBORG, 'Aalborg')!;

  it('extracts the season market dates (no-year), excluding the year-tagged stray', () => {
    expect(r).not.toBeNull();
    expect(r.occurrences!.map((o) => o.date)).toEqual([
      '2026-05-10',
      '2026-06-14',
      '2026-07-12',
      '2026-08-09',
      '2026-09-13',
    ]);
    // the "Download kalender (10. april 2026)" stray must NOT be included
    expect(r.occurrences!.some((o) => o.date === '2026-04-10')).toBe(false);
  });

  it('reads the shared opening hours and the venue postcode/city', () => {
    expect(r.occurrences![0]).toEqual({ date: '2026-05-10', startTime: '09:00', endTime: '15:00' });
    expect(r.postcode).toBe('9200');
    expect(r.category).toBe('bagagerumsmarked');
    expect(r.title).toBe('Bagagerumsmarked Aalborg');
  });

  it('discovers 9 city pages', async () => {
    const urls = await raskevent.discover(async () => ({ url: '', status: 200, body: '' }));
    expect(urls).toHaveLength(9);
    expect(urls).toContain('https://bagagerumsmarkeder.dk/aalborg/');
  });

  it('returns null for a page with no market dates', () => {
    expect(parseRaskEventCity('<html>ingen markeder her</html>', 'Aalborg')).toBeNull();
  });
});
