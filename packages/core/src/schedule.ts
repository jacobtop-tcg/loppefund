/**
 * Resolve Danish schedule descriptions into concrete occurrences.
 *
 * Trust policy: only produce dates the source actually implies. Ambiguous
 * recurrence without an anchor (e.g. "hver anden søndag" with no dates)
 * produces nothing rather than a guess.
 */

/**
 * The one upcoming-markets horizon (days), shared by every surface that renders
 * the full upcoming set: the home Explorer + its "Alle datoer" range, the city
 * guides, the sitemap, and the /marked static-page generator. A SINGLE constant
 * so those surfaces can never drift apart — the drift is what let a city page
 * (365 d) link to a market whose detail page was only generated to 180 d, so a
 * real far-future market rendered as a card that 404'd on click. Invariant: if a
 * market is listed anywhere, its page exists and it's searchable. (Scoped window
 * views — /naer-mig, /i-dag, /i-weekenden — use their own smaller windows on
 * purpose; their markets stay reachable through the full-horizon surfaces.)
 */
export const UPCOMING_HORIZON_DAYS = 365;
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

const DA_WEEKDAY: Record<number, string> = {
  1: 'mandag', 2: 'tirsdag', 3: 'onsdag', 4: 'torsdag', 5: 'fredag', 6: 'lørdag', 7: 'søndag',
};
const DA_ORDINAL: Record<number, string> = { 1: 'Første', 2: 'Anden', 3: 'Tredje', 4: 'Fjerde' };
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
function joinDanish(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} og ${names[names.length - 1]}`;
}

/**
 * Human-readable Danish label for a recurring schedule ("Hver søndag", "Sidste
 * lørdag i måneden", "Torvedag i lige uger"), or null when nothing parses — so
 * callers fall back to the raw text rather than showing a code-ish pattern.
 * A dependable "fixture" cue a one-off Facebook post can't convey.
 */
export function describeRecurrence(scheduleText: string | null | undefined): string | null {
  if (!scheduleText) return null;
  const parts: string[] = [];
  for (const r of parseRecurrence(scheduleText)) {
    const days = joinDanish(r.weekdays.map((w) => DA_WEEKDAY[w] ?? '').filter(Boolean));
    if (!days) continue;
    if (r.kind === 'weekly') parts.push(`Hver ${days}`);
    else if (r.kind === 'odd-weeks') parts.push(`${cap(days)} i ulige uger`);
    else if (r.kind === 'even-weeks') parts.push(`${cap(days)} i lige uger`);
    else if (r.kind === 'last') parts.push(`Sidste ${days} i måneden`);
    else if (r.kind === 'nth') parts.push(`${DA_ORDINAL[r.nth ?? 0] ?? `${r.nth}.`} ${days} i måneden`);
  }
  return parts.length ? parts.join(' · ') : null;
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

// Above this span, a date range is treated as a season/validity window (anchors
// only) rather than consecutive event days, to avoid fabricating daily markets.
const MAX_CONSECUTIVE_FILL = 6;

/** Resolve a schedule into sorted, deduplicated occurrences within the window. */
export function resolveSchedule(
  input: ScheduleInput,
  window: ResolveWindow,
): Occurrence[] {
  const to = addDays(window.from, window.horizonDays);
  const hours = parseOpeningHours(input.openingHoursText ?? '');
  const dates = new Set<string>();

  for (const range of input.dateRanges ?? []) {
    const spanDays = Math.round(
      (Date.parse(range.end) - Date.parse(range.start)) / 86_400_000,
    );
    if (spanDays <= MAX_CONSECUTIVE_FILL) {
      // A genuine single- or multi-day event — materialize each day.
      let d = range.start;
      for (let i = 0; d <= range.end && i < 366; i++, d = addDays(d, 1)) {
        if (d >= window.from && d <= to) dates.add(d);
      }
    } else {
      // A WIDE span is almost always a season / validity window, not consecutive
      // market days. Daily-filling it fabricates dozens of non-event days (a
      // "24/7" private sale became 30 daily markets). Keep only the endpoints as
      // anchors; a recurrence rule (below) fills the real days inside the span.
      for (const d of [range.start, range.end]) {
        if (d >= window.from && d <= to) dates.add(d);
      }
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
