import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { weekdayOf } from '@loppefund/core';
import { gentofte, seasonOccurrences } from '../src/adapters/gentofte.ts';

const html = readFileSync(
  join(import.meta.dirname, 'fixtures', 'gentofte-home.html'),
  'utf-8',
);

describe('seasonOccurrences', () => {
  it('lists the recurring weekday within a yearless season, from today onward', () => {
    const occ = seasonOccurrences({
      weekday: 7,
      startMonth: 4,
      startDay: 12,
      endMonth: 10,
      endDay: 4,
      startTime: '08:00',
      endTime: '14:00',
      today: '2026-07-01',
    });
    expect(occ).toHaveLength(14); // Sundays 5 Jul .. 4 Oct 2026
    expect(occ[0]).toEqual({ date: '2026-07-05', startTime: '08:00', endTime: '14:00' });
    expect(occ.at(-1)!.date).toBe('2026-10-04');
    for (const o of occ) expect(weekdayOf(o.date)).toBe(7);
  });

  it('rolls to next year once this year\'s season has ended', () => {
    const occ = seasonOccurrences({
      weekday: 7,
      startMonth: 4,
      startDay: 12,
      endMonth: 10,
      endDay: 4,
      startTime: '08:00',
      endTime: '14:00',
      today: '2026-11-20',
    });
    expect(occ[0]!.date.startsWith('2027-04')).toBe(true);
    for (const o of occ) expect(weekdayOf(o.date)).toBe(7);
  });
});

describe('gentofteloppemarked.dk adapter', () => {
  it('discovers the single market homepage without fetching', async () => {
    const urls = await gentofte.discover(async () => {
      throw new Error('discover must not fetch for a single-market site');
    });
    expect(urls).toEqual(['https://gentofteloppemarked.dk/']);
  });

  it('extracts the recurring seasonal market from the homepage', () => {
    const raw = gentofte.extract('https://gentofteloppemarked.dk/', html);
    expect(raw).not.toBeNull();
    expect(raw!.sourceKey).toBe('gentofte');
    expect(raw!.title).toBe('Gentofte Loppemarked');
    expect(raw!.category).toBe('loppemarked');
    expect(raw!.street).toBe('Bregnegårdsvej 2A');
    expect(raw!.city).toBe('Charlottenlund');
    expect(raw!.organizer).toContain('Overførstergården');
    expect(raw!.contactEmail).toBe('info@gentofteloppemarked.dk');
    expect(raw!.contactWebsite).toBe('https://gentofteloppemarked.dk/');
    expect(raw!.openingHoursText).toMatch(/8.*14/);
    // Every occurrence is a Sunday, 08:00–14:00, inside the Apr–Oct season.
    expect(raw!.occurrences!.length).toBeGreaterThan(0);
    for (const o of raw!.occurrences!) {
      expect(weekdayOf(o.date)).toBe(7);
      expect(o.startTime).toBe('08:00');
      expect(o.endTime).toBe('14:00');
      const [, mo] = o.date.split('-').map(Number);
      expect(mo).toBeGreaterThanOrEqual(4);
      expect(mo).toBeLessThanOrEqual(10);
    }
    expect(raw!.scheduleText).toBeUndefined(); // dates are explicit, not a resolver rule
  });

  it('returns null when the schedule/address anchor is gone', () => {
    expect(gentofte.extract('https://gentofteloppemarked.dk/', '<html><body>Lukket</body></html>')).toBeNull();
  });
});
