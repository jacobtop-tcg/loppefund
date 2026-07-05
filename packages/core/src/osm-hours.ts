/**
 * A pragmatic subset parser for the OSM `opening_hours` grammar — enough to
 * answer "Åbent nu? / åbner kl. X" for permanent second-hand venues, without
 * pulling in the heavy (LGPL) opening_hours.js and its holiday/astronomy
 * machinery. The raw string is always kept verbatim for display; this only
 * powers the live open/closed badge.
 *
 * Supported: weekday rules ("Mo-Fr 10:00-17:30"), lists ("Mo,We,Fr 10-14"),
 * multiple ranges incl. a lunch break ("Mo 10:00-12:00,13:00-17:00"), "24/7",
 * and "off"/"closed". Deliberately NOT supported (rules containing them are
 * skipped, degrading to "hours unknown" rather than guessing): public/school
 * holidays (PH/SH), month/date ranges, week numbers, sunrise/sunset offsets.
 *
 * Weekday index is 0 = Monday … 6 = Sunday.
 */

const WEEKDAY: Record<string, number> = {
  mo: 0, tu: 1, we: 2, th: 3, fr: 4, sa: 5, su: 6,
};

type Range = [start: number, end: number]; // minutes since midnight
export type OsmWeek = Range[][]; // 7 entries (Mon..Sun), each a list of ranges

function parseDayList(sel: string): number[] | null {
  const out = new Set<number>();
  for (const part of sel.split(',')) {
    const p = part.trim().toLowerCase();
    if (!p) continue;
    const range = p.match(/^(mo|tu|we|th|fr|sa|su)\s*-\s*(mo|tu|we|th|fr|sa|su)$/);
    if (range) {
      const a = WEEKDAY[range[1]!]!;
      const b = WEEKDAY[range[2]!]!;
      for (let i = 0; i <= 7; i++) {
        const d = (a + i) % 7; // wraps (e.g. Fr-Mo -> Fr,Sa,Su,Mo)
        out.add(d);
        if (d === b) break;
        if (i === 7) return null;
      }
    } else if (WEEKDAY[p] !== undefined) {
      out.add(WEEKDAY[p]);
    } else {
      return null; // an unknown token means we don't understand this selector
    }
  }
  return out.size ? [...out] : null;
}

function parseTimeRanges(part: string): Range[] {
  const out: Range[] = [];
  const re = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(part)) !== null) {
    const start = Number(m[1]) * 60 + Number(m[2]);
    let end = Number(m[3]) * 60 + Number(m[4]);
    if (end === 0) end = 1440; // "…-00:00" means midnight (end of day)
    if (start >= 0 && end > start && end <= 1440) out.push([start, end]);
  }
  return out;
}

/** Parse an OSM opening_hours string into per-weekday ranges, or null if
 *  nothing usable could be extracted. */
export function parseOsmHours(input: string | null | undefined): OsmWeek | null {
  if (!input) return null;
  const s = input.trim();
  if (!s) return null;
  const days: OsmWeek = [[], [], [], [], [], [], []];
  let any = false;
  for (const ruleRaw of s.split(';')) {
    const rule = ruleRaw.trim();
    if (!rule) continue;
    if (/^24\/7$/i.test(rule)) {
      for (let d = 0; d < 7; d++) days[d] = [[0, 1440]];
      any = true;
      continue;
    }
    // Unsupported selectors: skip the rule rather than mis-parse it.
    if (/\b(ph|sh|week|easter)\b/i.test(rule)) continue;
    if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(rule)) continue;

    const timeToken = rule.match(/\d{1,2}:\d{2}/);
    const isOff = /\b(off|closed)\b/i.test(rule);
    let selPart: string;
    let timePart = '';
    if (timeToken) {
      const idx = rule.indexOf(timeToken[0]);
      selPart = rule.slice(0, idx).trim();
      timePart = rule.slice(idx).trim();
    } else {
      selPart = rule.replace(/\b(off|closed)\b/gi, '').trim();
    }
    const dayIdx = selPart ? parseDayList(selPart) : [0, 1, 2, 3, 4, 5, 6];
    if (!dayIdx) continue;
    if (isOff) {
      for (const d of dayIdx) days[d] = []; // an explicit close overrides earlier rules
      any = true;
      continue;
    }
    const ranges = parseTimeRanges(timePart);
    if (!ranges.length) continue;
    for (const d of dayIdx) days[d] = ranges.map((r) => [...r] as Range); // later rule wins for a day
    any = true;
  }
  return any ? days : null;
}

// No % 24: a range ending at midnight is 1440 -> "24:00" (never "00:00", which
// would read as "closes at midnight… this morning"). Inputs are 0..1440.
const fmt = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export interface OpenState {
  /** false when the hours string couldn't be parsed at all. */
  known: boolean;
  open: boolean;
  /** "HH:MM" it closes today (when open). */
  closesAt: string | null;
  /** "HH:MM" of the next opening (when closed and one exists within 7 days). */
  opensAt: string | null;
  /** 0 = later today, 1 = tomorrow, … (when closed). */
  opensInDays: number | null;
}

/**
 * Live open/closed state for an OSM opening_hours string. `dayMon0` is the
 * weekday (0 = Monday) and `minutes` the minutes since midnight, both taken
 * from the visitor's live clock so the badge is always current.
 */
export function osmOpenState(
  hoursText: string | null | undefined,
  dayMon0: number,
  minutes: number,
): OpenState {
  const days = parseOsmHours(hoursText);
  if (!days) return { known: false, open: false, closesAt: null, opensAt: null, opensInDays: null };

  for (const [start, end] of days[dayMon0]!) {
    if (minutes >= start && minutes < end) {
      return { known: true, open: true, closesAt: fmt(end), opensAt: null, opensInDays: null };
    }
  }
  for (let ahead = 0; ahead < 7; ahead++) {
    const d = (dayMon0 + ahead) % 7;
    const starts = days[d]!.map((r) => r[0]).sort((a, b) => a - b);
    for (const start of starts) {
      if (ahead === 0 && start <= minutes) continue; // already past today
      return { known: true, open: false, closesAt: null, opensAt: fmt(start), opensInDays: ahead };
    }
  }
  return { known: true, open: false, closesAt: null, opensAt: null, opensInDays: null };
}
