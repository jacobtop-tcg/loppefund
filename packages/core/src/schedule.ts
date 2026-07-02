/**
 * Resolve Danish schedule descriptions into concrete occurrences.
 *
 * Trust policy: only produce dates the source actually implies. Ambiguous
 * recurrence without an anchor (e.g. "hver anden søndag" with no dates)
 * produces nothing rather than a guess.
 */
import {
  addDays,
  getIsoWeek,
  parseOpeningHours,
  WEEKDAYS,
  weekdayOf,
  type OpeningHours,
} from './danish-dates.ts';
import type { Occurrence } from './types.ts';

export interface ScheduleInput {
  dateRanges?: Array<{ start: string; end: string }>;
  scheduleText?: string;
  openingHoursText?: string;
}

export interface ResolveWindow {
  /** ISO date, inclusive */
  from: string;
  horizonDays: number;
}

interface Rule {
  weekdays: number[];
  kind: 'weekly' | 'nth' | 'last' | 'odd-weeks' | 'even-weeks';
  nth?: number;
}

const NTH_WORDS: Record<string, number> = {
  'første': 1,
  '1.': 1,
  'anden': 2,
  '2.': 2,
  'tredje': 3,
  '3.': 3,
  'fjerde': 4,
  '4.': 4,
};

const WEEKDAY_NAMES = Object.keys(WEEKDAYS).join('|');

/** Parse Danish recurrence text into rules. Unrecognized text -> []. */
export function parseRecurrence(text: string): Rule[] {
  const t = text.trim().toLowerCase();
  if (!t) return [];
  const rules: Rule[] = [];

  // "søndag i alle ulige uger", "lørdag i lige uger", "alle søndage i lige uger"
  let m = t.match(
    new RegExp(`(${WEEKDAY_NAMES})e?\\s+i\\s+(?:alle\\s+)?(ulige|lige)\\s+uger`),
  );
  if (m) {
    rules.push({
      weekdays: [WEEKDAYS[m[1]!]!],
      kind: m[2] === 'ulige' ? 'odd-weeks' : 'even-weeks',
    });
    return rules;
  }

  // "første lørdag i måneden", "sidste søndag i måneden"
  m = t.match(
    new RegExp(
      `(første|anden|tredje|fjerde|[1-4]\\.|sidste)\\s+(${WEEKDAY_NAMES})\\s+i\\s+(?:hver\\s+)?måned`,
    ),
  );
  if (m) {
    const wd = WEEKDAYS[m[2]!]!;
    if (m[1] === 'sidste') {
      rules.push({ weekdays: [wd], kind: 'last' });
    } else {
      rules.push({ weekdays: [wd], kind: 'nth', nth: NTH_WORDS[m[1]!] });
    }
    return rules;
  }

  // "hver anden søndag" — unanchored, refuse to guess
  if (new RegExp(`hver\\s+anden\\s+(${WEEKDAY_NAMES})`).test(t)) {
    return [];
  }

  // "hver søndag", "hver lørdag og søndag", "alle søndage"
  m = t.match(
    new RegExp(
      `(?:hver|alle)\\s+(${WEEKDAY_NAMES})e?(?:\\s+og\\s+(${WEEKDAY_NAMES})e?)?`,
    ),
  );
  if (m) {
    const wds = [WEEKDAYS[m[1]!]!];
    if (m[2]) wds.push(WEEKDAYS[m[2]]!);
    rules.push({ weekdays: wds, kind: 'weekly' });
    return rules;
  }

  return rules;
}

function nthWeekdayOfMonth(y: number, mo: number, wd: number, nth: number): string | null {
  const first = `${y}-${String(mo).padStart(2, '0')}-01`;
  const firstWd = weekdayOf(first);
  const day = 1 + ((wd - firstWd + 7) % 7) + (nth - 1) * 7;
  const candidate = addDays(first, day - 1);
  return candidate.startsWith(`${y}-${String(mo).padStart(2, '0')}`) ? candidate : null;
}

function lastWeekdayOfMonth(y: number, mo: number, wd: number): string {
  const nextMonthFirst =
    mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`;
  let d = addDays(nextMonthFirst, -1);
  while (weekdayOf(d) !== wd) d = addDays(d, -1);
  return d;
}

function timesFor(date: string, hours: OpeningHours): Pick<Occurrence, 'startTime' | 'endTime'> {
  const win = hours.byWeekday.get(weekdayOf(date)) ?? hours.generic;
  return win
    ? { startTime: win.start, endTime: win.end }
    : { startTime: null, endTime: null };
}

/** Resolve a schedule into sorted, deduplicated occurrences within the window. */
export function resolveSchedule(
  input: ScheduleInput,
  window: ResolveWindow,
): Occurrence[] {
  const to = addDays(window.from, window.horizonDays);
  const hours = parseOpeningHours(input.openingHoursText ?? '');
  const dates = new Set<string>();

  for (const range of input.dateRanges ?? []) {
    // Cap runaway ranges (bad data) at one year
    let d = range.start;
    for (let i = 0; d <= range.end && i < 366; i++, d = addDays(d, 1)) {
      if (d >= window.from && d <= to) dates.add(d);
    }
  }

  // When the source publishes explicit ranges, recurrence text only fills in
  // days WITHIN that published span — a summer market's "hver søndag" must
  // not invent occurrences after its season ends.
  const ranges = input.dateRanges ?? [];
  const ruleFrom =
    ranges.length > 0
      ? ranges.reduce((min, r) => (r.start < min ? r.start : min), ranges[0]!.start)
      : window.from;
  const ruleTo =
    ranges.length > 0
      ? ranges.reduce((max, r) => (r.end > max ? r.end : max), ranges[0]!.end)
      : to;
  const rules = input.scheduleText ? parseRecurrence(input.scheduleText) : [];
  for (const rule of rules) {
    for (
      let d = ruleFrom < window.from ? window.from : ruleFrom;
      d <= (ruleTo > to ? to : ruleTo);
      d = addDays(d, 1)
    ) {
      if (!rule.weekdays.includes(weekdayOf(d))) continue;
      switch (rule.kind) {
        case 'weekly':
          dates.add(d);
          break;
        case 'odd-weeks':
          if (getIsoWeek(d) % 2 === 1) dates.add(d);
          break;
        case 'even-weeks':
          if (getIsoWeek(d) % 2 === 0) dates.add(d);
          break;
        case 'nth': {
          const [y, mo] = d.split('-').map(Number) as [number, number];
          if (d === nthWeekdayOfMonth(y, mo, rule.weekdays[0]!, rule.nth!)) dates.add(d);
          break;
        }
        case 'last': {
          const [y, mo] = d.split('-').map(Number) as [number, number];
          if (d === lastWeekdayOfMonth(y, mo, rule.weekdays[0]!)) dates.add(d);
          break;
        }
      }
    }
  }

  return [...dates].sort().map((date) => ({ date, ...timesFor(date, hours) }));
}
