// Build an OSM `opening_hours` string from a 7-day (Mon-first) picker, grouping
// consecutive same-hours days ("Mo-Fr 10:00-17:00; Sa 10:00-14:00") — the exact
// syntax parseOsmHours reads back, so a community submission renders identically
// to a crawled one. Closed days are simply omitted (OSM convention). Pure and
// dependency-free so the client bundle can use it directly.

const OSM_DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;

export interface DayHours {
  open: boolean;
  from: string; // "HH:MM"
  to: string; // "HH:MM"
}

/** Normalize "9:00"/"09:00" → "09:00", or null if not a valid clock time. */
function normTime(s: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

/**
 * Turn the 7-day picker into an OSM opening_hours string, or null if it carries
 * no valid open day (nothing to submit). A day counts only when it's marked open
 * AND has a valid from < to — an invalid/blank day is treated as closed rather
 * than poisoning the string.
 */
export function buildOsmHours(days: DayHours[]): string | null {
  if (days.length !== 7) return null;
  const specs = days.map((d) => {
    if (!d.open) return null;
    const f = normTime(d.from);
    const t = normTime(d.to);
    if (!f || !t || f >= t) return null;
    return `${f}-${t}`;
  });
  const parts: string[] = [];
  let i = 0;
  while (i < 7) {
    if (specs[i] == null) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < 7 && specs[j + 1] === specs[i]) j++;
    const label = i === j ? OSM_DAYS[i] : `${OSM_DAYS[i]}-${OSM_DAYS[j]}`;
    parts.push(`${label} ${specs[i]}`);
    i = j + 1;
  }
  return parts.length ? parts.join('; ') : null;
}
