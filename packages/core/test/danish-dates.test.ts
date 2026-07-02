import { describe, expect, it } from 'vitest';
import {
  getIsoWeek,
  parseDanishDate,
  parseOpeningHours,
  weekdayOf,
} from '../src/danish-dates.ts';

describe('parseDanishDate', () => {
  it('parses dd-mm-yyyy', () => {
    expect(parseDanishDate('05-07-2026')).toBe('2026-07-05');
    expect(parseDanishDate('31-12-2026')).toBe('2026-12-31');
  });

  it('parses d. month yyyy', () => {
    expect(parseDanishDate('5. juli 2026')).toBe('2026-07-05');
    expect(parseDanishDate('1. januar 2027')).toBe('2027-01-01');
    expect(parseDanishDate('24. December 2026')).toBe('2026-12-24');
  });

  it('parses d/m-yyyy and d/m yyyy', () => {
    expect(parseDanishDate('5/7-2026')).toBe('2026-07-05');
    expect(parseDanishDate('5/7 2026')).toBe('2026-07-05');
  });

  it('parses with weekday prefix', () => {
    expect(parseDanishDate('lørdag den 5. juli 2026')).toBe('2026-07-05');
    expect(parseDanishDate('Søndag d. 5. juli 2026')).toBe('2026-07-05');
  });

  it('rejects invalid dates', () => {
    expect(parseDanishDate('32-01-2026')).toBeNull();
    expect(parseDanishDate('05-13-2026')).toBeNull();
    expect(parseDanishDate('gibberish')).toBeNull();
    expect(parseDanishDate('30-02-2026')).toBeNull();
  });
});

describe('weekdayOf', () => {
  it('computes ISO weekday (1=Monday..7=Sunday)', () => {
    expect(weekdayOf('2026-07-05')).toBe(7); // Sunday
    expect(weekdayOf('2026-07-06')).toBe(1); // Monday
    expect(weekdayOf('2026-07-04')).toBe(6); // Saturday
  });
});

describe('getIsoWeek', () => {
  it('computes ISO week numbers', () => {
    expect(getIsoWeek('2026-01-01')).toBe(1);
    expect(getIsoWeek('2026-07-05')).toBe(27);
    expect(getIsoWeek('2026-12-31')).toBe(53);
    expect(getIsoWeek('2025-12-29')).toBe(1); // Monday of week 1, 2026
  });
});

describe('parseOpeningHours', () => {
  it('parses single weekday with hours', () => {
    expect(parseOpeningHours('Søndag 12-17')).toEqual({
      byWeekday: new Map([[7, { start: '12:00', end: '17:00' }]]),
      generic: null,
    });
  });

  it('parses weekday ranges', () => {
    const r = parseOpeningHours('Lørdag-søndag 10-16');
    expect(r.byWeekday.get(6)).toEqual({ start: '10:00', end: '16:00' });
    expect(r.byWeekday.get(7)).toEqual({ start: '10:00', end: '16:00' });
  });

  it('parses multiple weekday clauses', () => {
    const r = parseOpeningHours('Lørdag 10-16, Søndag 10-15');
    expect(r.byWeekday.get(6)).toEqual({ start: '10:00', end: '16:00' });
    expect(r.byWeekday.get(7)).toEqual({ start: '10:00', end: '15:00' });
  });

  it('parses generic hours with kl. and minutes', () => {
    const r = parseOpeningHours('kl. 10.00-16.30');
    expect(r.generic).toEqual({ start: '10:00', end: '16:30' });
    expect(r.byWeekday.size).toBe(0);
  });

  it('parses bare hour range', () => {
    expect(parseOpeningHours('10-16').generic).toEqual({
      start: '10:00',
      end: '16:00',
    });
  });

  it('returns nothing for unparseable text without inventing times', () => {
    const r = parseOpeningHours('efter aftale');
    expect(r.generic).toBeNull();
    expect(r.byWeekday.size).toBe(0);
  });

  it('does not read date ranges after weekdays as opening hours', () => {
    // "5.-6. september" is a date range, not 05:00-06:00.
    const r = parseOpeningHours('lørdag-søndag 5-6 september');
    expect(r.byWeekday.size).toBe(0);
    const r2 = parseOpeningHours('søndag 5.-6. september');
    expect(r2.byWeekday.size).toBe(0);
  });
});
