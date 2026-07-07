import { describe, expect, it } from 'vitest';
import { buildOsmHours, type DayHours } from './build-osm-hours.ts';

const open = (from: string, to: string): DayHours => ({ open: true, from, to });
const shut: DayHours = { open: false, from: '', to: '' };
// Mon-first week helper.
const week = (...d: DayHours[]) => d;

describe('buildOsmHours', () => {
  it('groups consecutive same-hours weekdays and keeps Saturday distinct', () => {
    const w = week(
      open('10:00', '17:00'), open('10:00', '17:00'), open('10:00', '17:00'),
      open('10:00', '17:00'), open('10:00', '17:00'), open('10:00', '14:00'), shut,
    );
    expect(buildOsmHours(w)).toBe('Mo-Fr 10:00-17:00; Sa 10:00-14:00');
  });

  it('omits closed days (Monday closed → starts Tuesday)', () => {
    const w = week(shut, open('11:00', '17:00'), open('11:00', '17:00'), open('11:00', '17:00'),
      open('11:00', '17:00'), shut, shut);
    expect(buildOsmHours(w)).toBe('Tu-Fr 11:00-17:00');
  });

  it('normalizes single-digit hours to HH:MM', () => {
    const w = week(open('9:00', '17:30'), shut, shut, shut, shut, shut, shut);
    expect(buildOsmHours(w)).toBe('Mo 09:00-17:30');
  });

  it('returns null when no day is open (nothing to submit)', () => {
    expect(buildOsmHours(week(shut, shut, shut, shut, shut, shut, shut))).toBeNull();
  });

  it('treats an invalid/backwards day as closed rather than emitting garbage', () => {
    const w = week(open('17:00', '10:00'), open('10:00', '17:00'), shut, shut, shut, shut, shut);
    expect(buildOsmHours(w)).toBe('Tu 10:00-17:00'); // Monday (from>=to) dropped
  });

  it('handles a single Sunday-only market', () => {
    const w = week(shut, shut, shut, shut, shut, shut, open('08:00', '15:00'));
    expect(buildOsmHours(w)).toBe('Su 08:00-15:00');
  });
});
