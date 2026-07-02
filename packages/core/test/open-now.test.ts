import { describe, expect, it } from 'vitest';
import { copenhagenNow, isOpenAt } from '../src/open-now.ts';
import {
  hiddenGemScore,
  isHiddenGem,
  parseStallCount,
  type HiddenGemInput,
} from '../src/gems.ts';

const occ = (date: string, start: string | null, end: string | null) => ({
  date,
  startTime: start,
  endTime: end,
});

describe('isOpenAt', () => {
  it('is true inside the window and inclusive at both ends', () => {
    const o = [occ('2026-07-04', '10:00', '16:00')];
    expect(isOpenAt(o, '2026-07-04', '12:30')).toBe(true);
    expect(isOpenAt(o, '2026-07-04', '10:00')).toBe(true);
    expect(isOpenAt(o, '2026-07-04', '16:00')).toBe(true);
  });

  it('is false before, after, and on other dates', () => {
    const o = [occ('2026-07-04', '10:00', '16:00')];
    expect(isOpenAt(o, '2026-07-04', '09:59')).toBe(false);
    expect(isOpenAt(o, '2026-07-04', '16:01')).toBe(false);
    expect(isOpenAt(o, '2026-07-05', '12:00')).toBe(false);
  });

  it('never matches null times — unknown is not open', () => {
    expect(isOpenAt([occ('2026-07-04', null, null)], '2026-07-04', '12:00')).toBe(false);
    expect(isOpenAt([occ('2026-07-04', '10:00', null)], '2026-07-04', '12:00')).toBe(false);
  });

  it('handles a "24:00" end bound', () => {
    expect(isOpenAt([occ('2026-07-04', '18:00', '24:00')], '2026-07-04', '23:30')).toBe(true);
  });

  it('conservatively excludes end < start (overnight/bad data)', () => {
    expect(isOpenAt([occ('2026-07-04', '18:00', '02:00')], '2026-07-04', '19:00')).toBe(false);
  });

  it('matches only the occurrence on the given date in a series', () => {
    const o = [occ('2026-07-04', '10:00', '16:00'), occ('2026-07-05', '12:00', '17:00')];
    expect(isOpenAt(o, '2026-07-05', '11:00')).toBe(false);
    expect(isOpenAt(o, '2026-07-05', '12:30')).toBe(true);
  });
});

describe('copenhagenNow', () => {
  it('formats Danish wall-clock time including DST', () => {
    expect(copenhagenNow(new Date('2026-07-04T21:30:00Z'))).toEqual({
      date: '2026-07-04',
      time: '23:30',
    });
    expect(copenhagenNow(new Date('2026-01-04T21:30:00Z'))).toEqual({
      date: '2026-01-04',
      time: '22:30',
    });
  });
});

function baseGem(): HiddenGemInput {
  return {
    confidence: 0.85,
    sourceCount: 1,
    occurrenceCount: 2,
    hasLocation: true,
    descriptionLength: 250,
    stallCountText: 'Ca. 60 stande',
    isFreeKnown: true,
    hasTimedOccurrence: true,
    hasVenueName: true,
    hasOrganizerOrWebsite: true,
  };
}

describe('hidden gems', () => {
  it('scores the complete base case at 7 and calls it a gem', () => {
    expect(hiddenGemScore(baseGem())).toBe(7);
    expect(isHiddenGem(baseGem())).toBe(true);
  });

  it('every gate flips it off', () => {
    expect(isHiddenGem({ ...baseGem(), confidence: 0.69 })).toBe(false);
    expect(isHiddenGem({ ...baseGem(), sourceCount: 2 })).toBe(false);
    expect(isHiddenGem({ ...baseGem(), occurrenceCount: 0 })).toBe(false);
    expect(isHiddenGem({ ...baseGem(), occurrenceCount: 7 })).toBe(false);
    expect(isHiddenGem({ ...baseGem(), hasLocation: false })).toBe(false);
    expect(isHiddenGem({ ...baseGem(), stallCountText: 'Over 400 stande' })).toBe(false);
  });

  it('degrades score with thin descriptions', () => {
    expect(hiddenGemScore({ ...baseGem(), descriptionLength: 100 })).toBe(6);
    expect(isHiddenGem({ ...baseGem(), descriptionLength: 100 })).toBe(true);
    expect(
      isHiddenGem({ ...baseGem(), descriptionLength: 0, stallCountText: null }),
    ).toBe(false);
  });

  it('parses stall counts', () => {
    expect(parseStallCount('Ca. 100 stande')).toBe(100);
    expect(parseStallCount('30-40 boder')).toBe(30);
    expect(parseStallCount('mange stande')).toBeNull();
    expect(parseStallCount(null)).toBeNull();
  });
});
