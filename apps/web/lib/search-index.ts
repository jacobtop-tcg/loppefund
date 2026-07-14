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
// City nicknames people actually type into search. Each alias resolves to the
// canonical city name, which then substring-matches all of its districts
// (København K / NV / …). Only emitted when the canonical city is in the data,
// so an alias never leads to an empty result.
const CITY_ALIASES: Array<{ canonical: string; aliases: string[] }> = [
  { canonical: 'København', aliases: ['kbh', 'cph', 'copenhagen'] },
];

// Folded alias → folded canonical, so the LIVE filter query honours aliases too
// (not just the autocomplete dropdown). Without this, typing "cph" and not
// clicking the suggestion filtered to nothing, hiding every København market.
const FOLDED_ALIASES = new Map<string, string>(
  CITY_ALIASES.flatMap(({ canonical, aliases }) =>
    aliases.map((a) => [foldForSearch(a), foldForSearch(canonical)] as const),
  ),
);

/** Rewrite alias tokens ("cph"→"kobenhavn") in an already-folded query. */
export function expandQueryAliases(foldedQuery: string): string {
  return foldedQuery
    .split(/\s+/)
    .map((t) => FOLDED_ALIASES.get(t) ?? t)
    .join(' ');
}

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
  for (const { canonical, aliases } of CITY_ALIASES) {
    const cf = foldForSearch(canonical);
    if (![...cityCount.keys()].some((c) => foldForSearch(c).startsWith(cf))) continue;
    for (const a of aliases) {
      out.push({ label: canonical, value: canonical, kind: 'by', fold: foldForSearch(a), weight: 1400 });
    }
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
