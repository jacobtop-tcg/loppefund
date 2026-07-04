import { describe, expect, it } from 'vitest';
import {
  firstDateInWindow,
  isoWeekday,
  occurrenceWindow,
  weekendDates,
} from './client-utils.ts';

// These pure helpers define "this weekend" / "today" for both the Explorer
// filter and the /i-dag and /i-weekenden landing pages. If the definition
// drifts, a static page could present a past day as current — the one thing
// the product must never do. Pin the tricky boundaries.

describe('isoWeekday', () => {
  it('returns 1..7 with Monday = 1 and Sunday = 7', () => {
    expect(isoWeekday('2026-07-06')).toBe(1); // Monday
    expect(isoWeekday('2026-07-11')).toBe(6); // Saturday
    expect(isoWeekday('2026-07-05')).toBe(7); // Sunday
  });
});

describe('weekendDates', () => {
  it('from a weekday points at the coming Saturday and Sunday', () => {
    // Wed 2026-07-08 -> Sat 07-11, Sun 07-12
    expect(weekendDates('2026-07-08')).toEqual({ saturday: '2026-07-11', sunday: '2026-07-12' });
  });

  it('on Saturday returns that Saturday and the next day', () => {
    expect(weekendDates('2026-07-11')).toEqual({ saturday: '2026-07-11', sunday: '2026-07-12' });
  });

  it('on Sunday the Saturday is yesterday (the weekend already started)', () => {
    expect(weekendDates('2026-07-12')).toEqual({ saturday: '2026-07-11', sunday: '2026-07-12' });
  });

  it('handles a weekend that straddles a month boundary', () => {
    // Fri 2026-07-31 -> Sat 08-01, Sun 08-02
    expect(weekendDates('2026-07-31')).toEqual({ saturday: '2026-08-01', sunday: '2026-08-02' });
  });
});

describe("occurrenceWindow('weekend')", () => {
  it('spans Saturday through Sunday when today is before the weekend', () => {
    expect(occurrenceWindow('weekend', '2026-07-08')).toEqual(['2026-07-11', '2026-07-12']);
  });

  it('clamps the start to today on Sunday — only the remaining weekend', () => {
    // Sunday: never advertise Saturday (yesterday) as part of "this weekend".
    expect(occurrenceWindow('weekend', '2026-07-12')).toEqual(['2026-07-12', '2026-07-12']);
  });
});

describe("occurrenceWindow('today')", () => {
  it('is a single-day window', () => {
    expect(occurrenceWindow('today', '2026-07-05')).toEqual(['2026-07-05', '2026-07-05']);
  });
});

describe('firstDateInWindow', () => {
  const occ = (...dates: string[]) => dates.map((date) => ({ date }));

  it('returns the earliest occurrence inside the inclusive window', () => {
    expect(firstDateInWindow(occ('2026-07-20', '2026-07-11', '2026-07-12'), '2026-07-11', '2026-07-12')).toBe(
      '2026-07-11',
    );
  });

  it('includes the window boundaries', () => {
    expect(firstDateInWindow(occ('2026-07-12'), '2026-07-11', '2026-07-12')).toBe('2026-07-12');
  });

  it('returns null when no occurrence falls in the window', () => {
    expect(firstDateInWindow(occ('2026-07-01', '2026-07-20'), '2026-07-11', '2026-07-12')).toBeNull();
  });

  it('returns null for an event with no occurrences', () => {
    expect(firstDateInWindow([], '2026-07-11', '2026-07-12')).toBeNull();
  });
});
