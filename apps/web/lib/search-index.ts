import { foldForSearch } from './client-utils.ts';
import type { EventSummary, VenueSummary } from './data.ts';

export type SuggestionKind = 'by' | 'marked' | 'butik';

export interface Suggestion {
  label: string;
  /** What to put in the search box when picked (folded matching uses `fold`). */
  value: string;
  kind: SuggestionKind;
  fold: string;
  /** Higher = surfaced first (cities that host many markets rank up). */
  weight: number;
}

/**
 * Build a client-side autocomplete index from the loaded data: every city
 * (weighted by how many markets it hosts), plus market and venue names. Deduped
 * and folded so typo-tolerant matching is a cheap substring test. Runs once,
 * memoized in the Explorer.
 */
export function buildSearchIndex(events: EventSummary[], venues: VenueSummary[]): Suggestion[] {
  const cityCount = new Map<string, number>();
  const add = (m: Map<string, number>, key: string | null | undefined) => {
    if (!key) return;
    const k = key.trim();
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  };
  for (const e of events) add(cityCount, e.city ?? e.municipality);
  for (const v of venues) add(cityCount, v.city);

  const out: Suggestion[] = [];
  for (const [city, n] of cityCount) {
    out.push({ label: city, value: city, kind: 'by', fold: foldForSearch(city), weight: 1000 + n });
  }
  const seenTitle = new Set<string>();
  for (const e of events) {
    const t = e.title.trim();
    const key = foldForSearch(t);
    if (t && !seenTitle.has(key)) {
      seenTitle.add(key);
      out.push({ label: t, value: t, kind: 'marked', fold: key, weight: 100 });
    }
  }
  for (const v of venues) {
    const t = v.title.trim();
    const key = foldForSearch(t);
    if (t && !seenTitle.has(key)) {
      seenTitle.add(key);
      out.push({ label: t, value: t, kind: 'butik', fold: key, weight: 50 });
    }
  }
  return out;
}

/**
 * Top suggestions for a query. Prefix matches rank above mid-string matches,
 * then by weight (cities first), so "aar" surfaces Aarhus before a market whose
 * name merely contains "aar". Returns at most `limit`.
 */
export function suggestFor(index: Suggestion[], query: string, limit = 7): Suggestion[] {
  const q = foldForSearch(query.trim());
  if (q.length < 2) return [];
  const scored: Array<{ s: Suggestion; rank: number }> = [];
  for (const s of index) {
    const i = s.fold.indexOf(q);
    if (i < 0) continue;
    // Prefix hit gets a big boost; then earlier position; then base weight.
    const rank = (i === 0 ? 100_000 : 0) + s.weight - i;
    scored.push({ s, rank });
  }
  scored.sort((a, b) => b.rank - a.rank);
  return scored.slice(0, limit).map((x) => x.s);
}
