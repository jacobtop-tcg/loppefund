/**
 * Parse Danish opening-hours text into a compact OSM opening_hours string,
 * shared across the charity-chain adapters (they all present hours as labelled
 * day/time lines: "Mandag - fredag 12.00-17.00", "Man-fre: 10.00-17.30",
 * "Lørdag 10.00-14.00", one per <br>/line). Handles full + abbreviated day
 * names, day ranges, dot- or colon-separated times. Unparseable input → null
 * (missing hours beat wrong hours).
 */
const OSM_DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DA_PREFIX = ['man', 'tir', 'ons', 'tor', 'fre', 'lør', 'søn'];

/** Danish day label (full or abbreviated) → 0..6 (Mo..Su), or -1. */
function dayIndex(label: string): number {
  return DA_PREFIX.indexOf(label.trim().toLowerCase().slice(0, 3));
}

const pad = (s: string) => (s.length === 1 ? `0${s}` : s);

/** Group a 7-slot day→time array into "Mo-Fr 10:00-17:00; Sa 10:00-13:00". */
function groupOsm(byDay: (string | null)[]): string | null {
  const parts: string[] = [];
  let i = 0;
  while (i < 7) {
    const h = byDay[i];
    if (!h) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < 7 && byDay[j + 1] === h) j++;
    parts.push(`${i === j ? OSM_DAYS[i] : `${OSM_DAYS[i]}-${OSM_DAYS[j]}`} ${h}`);
    i = j + 1;
  }
  return parts.length ? parts.join('; ') : null;
}

const DAY_WORD =
  '(?:mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag|man|tirs?|ons|tors?|fre|lør|søn)';
// A day label directly followed by a time range — anchoring on the time keeps
// prefix noise ("Telefon: … Åbningstider:") out of the day label.
const HOURS_RE = new RegExp(
  `(${DAY_WORD}(?:\\s*(?:[-–—]|til|og)\\s*${DAY_WORD})?)\\s*:?\\s*(?:kl\\.?\\s*)?` +
    '(\\d{1,2})(?:[.:](\\d{2}))?\\s*[-–—]\\s*(\\d{1,2})(?:[.:](\\d{2}))?',
  'gi',
);

export function danishHoursToOsm(text: string | null | undefined): string | null {
  if (!text) return null;
  const flat = text.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ');
  const byDay: (string | null)[] = Array(7).fill(null);
  for (const m of flat.matchAll(HOURS_RE)) {
    const time = `${pad(m[2]!)}:${m[3] ?? '00'}-${pad(m[4]!)}:${m[5] ?? '00'}`;
    const days = m[1]!.split(/\s*(?:[-–—]|til|og)\s*/i).map((s) => s.trim()).filter(Boolean);
    const from = dayIndex(days[0]!);
    const to = days.length > 1 ? dayIndex(days[days.length - 1]!) : from;
    if (from < 0 || to < 0 || to < from) continue;
    for (let d = from; d <= to; d++) byDay[d] = time;
  }
  return groupOsm(byDay);
}

/** Stable numeric id from a key string (for sources without their own ids). */
export function stableId(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h;
}

/** Split "0000 By" (or "By, 0000") into {postcode, city}. */
export function splitPostcodeCity(s: string): { postcode: string | null; city: string } {
  const m = s.match(/(\d{4})\s+(.+)/) ?? s.match(/(.+?)\s*(\d{4})/);
  if (!m) return { postcode: null, city: s.trim() };
  // First shape "0000 By" -> [full, pc, city]; second "By 0000" -> [full, city, pc]
  if (/^\d{4}/.test(m[1]!)) return { postcode: m[1]!, city: m[2]!.trim() };
  return { postcode: m[2]!, city: m[1]!.trim() };
}
