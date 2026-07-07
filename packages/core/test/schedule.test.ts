import { describe, expect, it } from 'vitest';
import { resolveSchedule, describeRecurrence } from '../src/schedule.ts';

const window = { from: '2026-07-01', horizonDays: 60 };

describe('describeRecurrence', () => {
  it('renders recognised cadences as clean Danish', () => {
    expect(describeRecurrence('Hver søndag')).toBe('Hver søndag');
    expect(describeRecurrence('hver lørdag og søndag')).toBe('Hver lørdag og søndag');
    expect(describeRecurrence('søndag i lige uger')).toBe('Søndag i lige uger');
    expect(describeRecurrence('sidste lørdag i måneden')).toBe('Sidste lørdag i måneden');
    expect(describeRecurrence('første søndag i måneden')).toBe('Første søndag i måneden');
  });
  it('returns null for empty or unparseable text (so callers can fall back)', () => {
    expect(describeRecurrence(null)).toBeNull();
    expect(describeRecurrence('')).toBeNull();
    expect(describeRecurrence('noget uden mønster')).toBeNull();
  });
});

describe('resolveSchedule — explicit date ranges', () => {
  it('materializes one occurrence per day in each range', () => {
    const occ = resolveSchedule(
      {
        dateRanges: [
          { start: '2026-07-05', end: '2026-07-05' },
          { start: '2026-07-18', end: '2026-07-19' },
        ],
      },
      window,
    );
    expect(occ.map((o) => o.date)).toEqual([
      '2026-07-05',
      '2026-07-18',
      '2026-07-19',
    ]);
  });

  it('applies weekday-specific opening hours', () => {
    const occ = resolveSchedule(
      {
        dateRanges: [{ start: '2026-07-04', end: '2026-07-05' }],
        openingHoursText: 'Lørdag 10-16, Søndag 10-15',
      },
      window,
    );
    expect(occ).toEqual([
      { date: '2026-07-04', startTime: '10:00', endTime: '16:00' },
      { date: '2026-07-05', startTime: '10:00', endTime: '15:00' },
    ]);
  });

  it('leaves times null when hours are unknown', () => {
    const occ = resolveSchedule(
      { dateRanges: [{ start: '2026-07-05', end: '2026-07-05' }] },
      window,
    );
    expect(occ[0]).toEqual({
      date: '2026-07-05',
      startTime: null,
      endTime: null,
    });
  });

  it('does not daily-fill a wide range (season window) — keeps only endpoints', () => {
    const occ = resolveSchedule(
      { dateRanges: [{ start: '2026-07-05', end: '2026-08-05' }] },
      { from: '2026-07-01', horizonDays: 60 },
    );
    // A 31-day span with no recurrence rule must NOT become 31 daily markets.
    expect(occ.map((o) => o.date)).toEqual(['2026-07-05', '2026-08-05']);
  });

  it('still fills a genuine multi-day span (<= 6 days)', () => {
    const occ = resolveSchedule(
      { dateRanges: [{ start: '2026-07-04', end: '2026-07-06' }] },
      { from: '2026-07-01', horizonDays: 30 },
    );
    expect(occ.map((o) => o.date)).toEqual(['2026-07-04', '2026-07-05', '2026-07-06']);
  });

  it('drops days outside the window', () => {
    const occ = resolveSchedule(
      {
        dateRanges: [
          { start: '2026-06-01', end: '2026-06-01' },
          { start: '2026-12-24', end: '2026-12-24' },
          { start: '2026-07-10', end: '2026-07-10' },
        ],
      },
      window,
    );
    expect(occ.map((o) => o.date)).toEqual(['2026-07-10']);
  });
});

describe('resolveSchedule — recurrence text', () => {
  it('resolves "hver søndag"', () => {
    const occ = resolveSchedule(
      { scheduleText: 'hver søndag', openingHoursText: 'Søndag 12-17' },
      { from: '2026-07-01', horizonDays: 21 },
    );
    expect(occ.map((o) => o.date)).toEqual([
      '2026-07-05',
      '2026-07-12',
      '2026-07-19',
    ]);
    expect(occ[0]!.startTime).toBe('12:00');
  });

  it('resolves "hver lørdag og søndag"', () => {
    const occ = resolveSchedule(
      { scheduleText: 'hver lørdag og søndag' },
      { from: '2026-07-01', horizonDays: 12 },
    );
    expect(occ.map((o) => o.date)).toEqual([
      '2026-07-04',
      '2026-07-05',
      '2026-07-11',
      '2026-07-12',
    ]);
  });

  it('resolves "første lørdag i måneden"', () => {
    const occ = resolveSchedule(
      { scheduleText: 'Første lørdag i måneden' },
      { from: '2026-07-01', horizonDays: 92 },
    );
    expect(occ.map((o) => o.date)).toEqual([
      '2026-07-04',
      '2026-08-01',
      '2026-09-05',
    ]);
  });

  it('resolves "sidste søndag i måneden"', () => {
    const occ = resolveSchedule(
      { scheduleText: 'sidste søndag i måneden' },
      { from: '2026-07-01', horizonDays: 62 },
    );
    expect(occ.map((o) => o.date)).toEqual(['2026-07-26', '2026-08-30']);
  });

  it('resolves "søndag i alle ulige uger" via ISO week parity', () => {
    // 2026-07-05 is Sunday of ISO week 27 (odd), 2026-07-12 week 28 (even)
    const occ = resolveSchedule(
      { scheduleText: 'Søndag i alle ulige uger' },
      { from: '2026-07-01', horizonDays: 28 },
    );
    expect(occ.map((o) => o.date)).toEqual(['2026-07-05', '2026-07-19']);
  });

  it('resolves "lørdag i lige uger"', () => {
    const occ = resolveSchedule(
      { scheduleText: 'lørdag i lige uger' },
      { from: '2026-07-01', horizonDays: 28 },
    );
    // Saturdays: 07-04 (wk27 odd), 07-11 (wk28 even), 07-18 (odd), 07-25 (even)
    expect(occ.map((o) => o.date)).toEqual(['2026-07-11', '2026-07-25']);
  });

  it('does not guess for unanchored "hver anden søndag" without dates', () => {
    const occ = resolveSchedule(
      { scheduleText: 'hver anden søndag' },
      { from: '2026-07-01', horizonDays: 28 },
    );
    expect(occ).toEqual([]);
  });

  it('unions ranges with recurrence but never extends past the published span', () => {
    const occ = resolveSchedule(
      {
        dateRanges: [
          { start: '2026-07-05', end: '2026-07-05' },
          { start: '2026-07-19', end: '2026-07-19' },
        ],
        scheduleText: 'hver søndag',
      },
      { from: '2026-07-01', horizonDays: 30 },
    );
    // The rule fills 07-12 inside the span; nothing after 07-19 is invented.
    expect(occ.map((o) => o.date)).toEqual(['2026-07-05', '2026-07-12', '2026-07-19']);
  });

  it('resolves plural weekday parity text ("Alle søndage i lige uger")', () => {
    const occ = resolveSchedule(
      { scheduleText: 'Alle søndage i lige uger' },
      { from: '2026-07-01', horizonDays: 28 },
    );
    expect(occ.map((o) => o.date)).toEqual(['2026-07-12', '2026-07-26']);
  });

  it('returns empty for pure noise', () => {
    expect(
      resolveSchedule({ scheduleText: 'kom glad!' }, window),
    ).toEqual([]);
  });
});
