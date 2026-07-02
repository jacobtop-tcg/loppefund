import { describe, expect, it } from 'vitest';
import { buildTripUrl } from './client-utils.ts';

// Mirror of Explorer's dateRangeFor to pin the Sunday "næste weekend" bug.
function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
function weekdayOfIso(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}
function nextWeekendRange(today: string): [string, string] {
  const wd = weekdayOfIso(today);
  const thisSat = wd === 7 ? addDaysIso(today, -1) : addDaysIso(today, (6 - wd + 7) % 7);
  const thisSun = addDaysIso(thisSat, 1);
  return [addDaysIso(thisSat, 7), addDaysIso(thisSun, 7)];
}

describe('nextWeekendRange', () => {
  it('is a valid forward range on every weekday incl. Sunday', () => {
    // 2026-07-05 is a Sunday; the old code produced an inverted range here.
    for (let i = 0; i < 7; i++) {
      const day = addDaysIso('2026-07-05', i);
      const [from, to] = nextWeekendRange(day);
      expect(from <= to).toBe(true);
      expect(weekdayOfIso(from)).toBe(6); // Saturday
      expect(weekdayOfIso(to)).toBe(7); // Sunday
      expect(from > day).toBe(true); // strictly in the future
    }
  });
});

describe('buildTripUrl', () => {
  it('returns null below 2 stops', () => {
    expect(buildTripUrl([])).toBeNull();
    expect(buildTripUrl([{ lat: 55.6761, lng: 12.5683 }])).toBeNull();
  });

  it('routes through waypoints to the last stop as destination', () => {
    const url = buildTripUrl([
      { lat: 55.6761, lng: 12.5683 },
      { lat: 56.1629, lng: 10.2039 },
    ])!;
    const p = new URL(url).searchParams;
    expect(p.get('api')).toBe('1');
    expect(p.get('travelmode')).toBe('driving');
    expect(p.get('destination')).toBe('56.162900,10.203900');
    expect(p.get('waypoints')).toBe('55.676100,12.568300');
  });

  it('joins multiple waypoints with | in route order', () => {
    const url = buildTripUrl([
      { lat: 55.1, lng: 12.1 },
      { lat: 55.2, lng: 12.2 },
      { lat: 55.3, lng: 12.3 },
    ])!;
    expect(new URL(url).searchParams.get('waypoints')).toBe(
      '55.100000,12.100000|55.200000,12.200000',
    );
    expect(url).toContain('%7C');
  });
});
