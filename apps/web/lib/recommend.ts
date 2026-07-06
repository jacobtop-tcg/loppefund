import type { EventSummary } from './data.ts';

/**
 * Personalized "Til dig" recommendations — the answer to "where should we go this
 * weekend?". Pure and testable: rank each market's next upcoming occurrence by a
 * transparent, trust-first score (confidence + proximity to the visitor's saved
 * area + soon-ness + hidden-gem/family/free), and surface a short human reason for
 * each. Client-side only; uses the same signals the list already carries.
 */
export interface Recommendation {
  event: EventSummary;
  nextDate: string;
  distanceKm: number | null;
  score: number;
  reasons: string[];
}

const WEEKDAYS = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
const MONTHS = [
  'januar', 'februar', 'marts', 'april', 'maj', 'juni',
  'juli', 'august', 'september', 'oktober', 'november', 'december',
];

function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}
function timingLabel(today: string, date: string): string {
  const diff = daysBetween(today, date);
  if (diff <= 0) return 'i dag';
  if (diff === 1) return 'i morgen';
  if (diff <= 6) return `på ${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]}`;
  const [, m, d] = date.split('-').map(Number) as [number, number, number];
  return `d. ${d}. ${MONTHS[m - 1]}`;
}

export function recommend(
  events: EventSummary[],
  pos: { lat: number; lng: number } | null,
  today: string,
  opts: {
    horizonDays?: number;
    limit?: number;
    distanceKm?: (aLat: number, aLng: number, bLat: number, bLng: number) => number;
  } = {},
): Recommendation[] {
  const horizon = addDaysIso(today, opts.horizonDays ?? 21);
  const dist = opts.distanceKm;
  const out: Recommendation[] = [];

  for (const e of events) {
    if (e.status !== 'active') continue;
    const next = e.occurrences.find((o) => o.date >= today && o.date <= horizon);
    if (!next) continue;

    const d =
      pos && dist && e.lat != null && e.lng != null ? dist(pos.lat, pos.lng, e.lat, e.lng) : null;

    let score = e.confidence * 0.3; // trust first
    if (d != null) score += Math.max(0, 1 - d / 60) * 0.35;
    if (daysBetween(today, next.date) <= 7) score += 0.2; // this-weekend bias
    if (e.gem) score += 0.3;
    if (e.familyFriendly) score += 0.12;
    if (e.isFree) score += 0.08;

    // Reason chips in priority order — the enticing, specific signals first.
    // "godt bekræftet" is generic reassurance, so it only appears as a fallback
    // when the market has fewer than two real features to show, never crowding
    // out "skjult perle" / "familievenlig" / "gratis".
    const quality: string[] = [];
    if (e.gem) quality.push('skjult perle');
    if (d != null && d <= 30) quality.push(`kun ${Math.round(d)} km væk`);
    if (e.familyFriendly) quality.push('familievenlig');
    if (e.isFree) quality.push('gratis');
    if (e.confidence >= 0.75 && quality.length < 2) quality.push('godt bekræftet');

    const reasons = [timingLabel(today, next.date), ...quality].slice(0, 3);
    out.push({ event: e, nextDate: next.date, distanceKm: d, score, reasons });
  }

  out.sort((a, b) => b.score - a.score || a.nextDate.localeCompare(b.nextDate));
  return out.slice(0, opts.limit ?? 4);
}
