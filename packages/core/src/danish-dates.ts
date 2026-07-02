/** Danish date, weekday and opening-hours parsing. Pure functions, no I/O. */

const MONTHS: Record<string, number> = {
  januar: 1,
  februar: 2,
  marts: 3,
  april: 4,
  maj: 5,
  juni: 6,
  juli: 7,
  august: 8,
  september: 9,
  oktober: 10,
  november: 11,
  december: 12,
};

export const WEEKDAYS: Record<string, number> = {
  mandag: 1,
  tirsdag: 2,
  onsdag: 3,
  torsdag: 4,
  fredag: 5,
  lørdag: 6,
  loerdag: 6,
  søndag: 7,
  soendag: 7,
};

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function isValidDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  let max = DAYS_IN_MONTH[m - 1]!;
  if (m === 2 && isLeapYear(y)) max = 29;
  return d <= max;
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Parse a single Danish date expression to an ISO date, or null.
 * Handles "05-07-2026", "5. juli 2026", "5/7-2026", "5/7 2026",
 * optionally prefixed with a weekday ("lørdag den 5. juli 2026").
 */
export function parseDanishDate(text: string): string | null {
  const t = text.trim().toLowerCase();

  // dd-mm-yyyy or dd.mm.yyyy or dd/mm-yyyy or dd/mm yyyy
  let m = t.match(/(\d{1,2})[-./](\d{1,2})[-./ ](\d{4})/);
  if (m) {
    const [, d, mo, y] = m;
    const yy = Number(y), mm = Number(mo), dd = Number(d);
    return isValidDate(yy, mm, dd) ? iso(yy, mm, dd) : null;
  }

  // d. monthname yyyy (with optional weekday / "den" / "d." prefix)
  m = t.match(/(\d{1,2})\.?\s+([a-zæøå]+)\s+(\d{4})/);
  if (m) {
    const [, d, monthName, y] = m;
    const mm = MONTHS[monthName!];
    if (!mm) return null;
    const yy = Number(y), dd = Number(d);
    return isValidDate(yy, mm, dd) ? iso(yy, mm, dd) : null;
  }

  return null;
}

/** ISO weekday of an ISO date: 1=Monday .. 7=Sunday. TZ-independent. */
export function weekdayOf(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  return dow === 0 ? 7 : dow;
}

/** ISO 8601 week number, TZ-independent. */
export function getIsoWeek(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  // Thursday of this week determines the ISO year/week
  const dow = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** Add days to an ISO date. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export interface TimeWindow {
  start: string; // "HH:MM"
  end: string;
}

export interface OpeningHours {
  byWeekday: Map<number, TimeWindow>;
  generic: TimeWindow | null;
}

function toHHMM(h: string, min?: string): string {
  return `${h.padStart(2, '0')}:${(min ?? '00').padStart(2, '0')}`;
}

const HOUR_RANGE =
  /(?:kl\.?\s*)?(\d{1,2})(?:[.:](\d{2}))?\s*[-–]\s*(\d{1,2})(?:[.:](\d{2}))?/;

/**
 * Parse Danish opening-hours text like "Søndag 12-17",
 * "Lørdag-søndag 10-16", "Lørdag 10-16, Søndag 10-15", "kl. 10.00-16.30".
 * Never invents times: unparseable text yields empty result.
 */
export function parseOpeningHours(text: string): OpeningHours {
  const result: OpeningHours = { byWeekday: new Map(), generic: null };
  const t = text.trim().toLowerCase();
  if (!t) return result;

  const weekdayNames = Object.keys(WEEKDAYS).join('|');
  // clauses like "lørdag 10-16" or "lørdag-søndag 10-16"
  const clauseRe = new RegExp(
    `(${weekdayNames})(?:\\s*[-–]\\s*(${weekdayNames}))?\\s*:?\\s*` +
      HOUR_RANGE.source,
    'g',
  );

  let matched = false;
  for (const m of t.matchAll(clauseRe)) {
    matched = true;
    const from = WEEKDAYS[m[1]!]!;
    const to = m[2] ? WEEKDAYS[m[2]]! : from;
    const win: TimeWindow = {
      start: toHHMM(m[3]!, m[4]),
      end: toHHMM(m[5]!, m[6]),
    };
    for (let wd = from; ; wd = (wd % 7) + 1) {
      result.byWeekday.set(wd, win);
      if (wd === to) break;
    }
  }
  if (matched) return result;

  const g = t.match(HOUR_RANGE);
  if (g) {
    const startH = Number(g[1]), endH = Number(g[3]);
    // Reject implausible hour ranges (e.g. matched a date "5-7")
    if (startH <= 23 && endH <= 24 && endH > startH) {
      result.generic = { start: toHHMM(g[1]!, g[2]), end: toHHMM(g[3]!, g[4]) };
    }
  }
  return result;
}
