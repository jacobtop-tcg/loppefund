import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveSchedule, weekdayOf } from '@loppefund/core';
import { olg } from '../src/adapters/olg.ts';

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf-8');

describe('olg.dk adapter', () => {
  const html = fixture('olg-home.html');

  it('discovers the single market homepage without fetching', async () => {
    const urls = await olg.discover(async () => {
      throw new Error('discover must not fetch for a single-market site');
    });
    expect(urls).toEqual(['https://olg.dk/']);
  });

  it('extracts the recurring market from the homepage', () => {
    const raw = olg.extract('https://olg.dk/', html);
    expect(raw).not.toBeNull();
    expect(raw!.sourceKey).toBe('olg');
    expect(raw!.sourceEventId).toBe('odsherreds-antik-kraemmermarked');
    expect(raw!.title).toBe('Odsherreds Antik og Kræmmermarked');
    expect(raw!.category).toBe('kraemmermarked');
    expect(raw!.street).toBe('Sneglerupvej 2');
    expect(raw!.postcode).toBe('4571');
    expect(raw!.city).toBe('Grevinge');
    expect(raw!.contactPhone).toBe('93924475');
    expect(raw!.contactWebsite).toBe('https://olg.dk/');
    expect(raw!.indoorOutdoor).toBe('indoor');
    expect(raw!.scheduleText).toMatch(/søndag/i);
    expect(raw!.openingHoursText).toContain('10-16');
    expect(raw!.stallCountText).toContain('100');
    expect(raw!.description).toContain('1992');
  });

  it('resolves the schedule to Sundays at 10:00–16:00', () => {
    const raw = olg.extract('https://olg.dk/', html)!;
    const occ = resolveSchedule(
      {
        scheduleText: raw.scheduleText,
        openingHoursText: raw.openingHoursText,
      },
      { from: '2026-07-01', horizonDays: 30 },
    );
    expect(occ.length).toBeGreaterThanOrEqual(4);
    // Every resolved day is a Sunday with the stated opening hours.
    for (const o of occ) {
      expect(weekdayOf(o.date)).toBe(7);
      expect(o.startTime).toBe('10:00');
      expect(o.endTime).toBe('16:00');
    }
  });

  it('returns null when the address block is gone (page fundamentally changed)', () => {
    expect(olg.extract('https://olg.dk/', '<html><body><h1>Under ombygning</h1></body></html>')).toBeNull();
  });
});
