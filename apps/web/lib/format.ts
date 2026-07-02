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

/** "søndag 5. juli" */
export function formatDateLong(isoDate: string): string {
  const p = parts(isoDate);
  return `${WEEKDAYS_LONG[p.weekday]} ${p.d}. ${MONTHS_LONG[p.m - 1]}`;
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
