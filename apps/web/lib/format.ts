/** Danish date/label formatting shared by server and client components. */

export const CATEGORY_LABELS: Record<string, string> = {
  loppemarked: 'Loppemarked',
  kraemmermarked: 'Kræmmermarked',
  bagagerumsmarked: 'Bagagerumsmarked',
  antikmarked: 'Antikmarked',
  genbrugsmarked: 'Genbrugsmarked',
  byloppemarked: 'Gadeloppemarked',
  julemarked: 'Julemarked',
  andet: 'Marked',
};

const WEEKDAYS_SHORT = ['man', 'tir', 'ons', 'tor', 'fre', 'lør', 'søn'];
const WEEKDAYS_LONG = ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];
const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const MONTHS_LONG = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];

function parts(isoDate: string): { y: number; m: number; d: number; weekday: number } {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, weekday: dow === 0 ? 6 : dow - 1 };
}

export function weekdayShort(isoDate: string): string {
  return WEEKDAYS_SHORT[parts(isoDate).weekday]!;
}

export function weekdayLong(isoDate: string): string {
  return WEEKDAYS_LONG[parts(isoDate).weekday]!;
}

export function monthShort(isoDate: string): string {
  return MONTHS_SHORT[parts(isoDate).m - 1]!;
}

export function dayOfMonth(isoDate: string): number {
  return parts(isoDate).d;
}

/** "5. juli 2026" — with year, no weekday. For "data opdateret" labels. */
export function formatUpdated(isoDate: string): string {
  const p = parts(isoDate);
  return `${p.d}. ${MONTHS_LONG[p.m - 1]} ${p.y}`;
}

/** "søndag 5. juli" */
export function formatDateLong(isoDate: string): string {
  const p = parts(isoDate);
  return `${WEEKDAYS_LONG[p.weekday]} ${p.d}. ${MONTHS_LONG[p.m - 1]}`;
}

/**
 * Tame shouting user-submitted titles: if a string is mostly uppercase,
 * convert to sentence case for display. Raw data is never altered.
 */
export function displayTitle(text: string): string {
  const letters = text.replace(/[^a-zA-ZæøåÆØÅ]/g, '');
  if (letters.length < 4) return text;
  const upper = letters.replace(/[^A-ZÆØÅ]/g, '').length;
  if (upper / letters.length <= 0.7) return text;
  const lowered = text.toLowerCase();
  return lowered.charAt(0).toUpperCase() + lowered.slice(1);
}

/** Capitalize each word — for city names that arrive lowercase. */
export function displayPlace(text: string): string {
  return text
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * Trim to at most `max` chars WITHOUT cutting a word in half, appending an
 * ellipsis when shortened. Used for SEO/OG descriptions — a snippet ending in
 * "…og de flotte r" reads as broken on a search result or a share card.
 */
export function truncateAtWord(text: string, max = 155): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  // Leave room for the ellipsis, then back up to the last word boundary.
  const slice = clean.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(' ');
  const head = (lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice).replace(/[.,;:!?–-]+$/, '');
  return `${head}…`;
}

/** "10–16" or "10.30–16" from HH:MM strings */
export function formatHours(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const fmt = (t: string) => {
    const [h, m] = t.split(':') as [string, string];
    return m === '00' ? String(Number(h)) : `${Number(h)}.${m}`;
  };
  return end ? `kl. ${fmt(start)}–${fmt(end)}` : `kl. ${fmt(start)}`;
}
