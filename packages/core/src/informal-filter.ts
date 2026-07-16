/**
 * FILTERING AND SORTING for hidden places.
 *
 * Pure and isomorphic on purpose: the filter UI is a client component, but the
 * rules that decide what a visitor sees must be testable without a browser.
 *
 * The one invariant this module exists to protect: FILTERING NARROWS, IT NEVER
 * PROMOTES. A place's trust layer is decided upstream by trustLayerFor() and is
 * carried on the record; nothing here recomputes it, and grouping reads it
 * verbatim. So no combination of filters or sorts can lift a Radar rumour into
 * the confirmed section — the worst a filter can do is show fewer places.
 *
 * That is why sorting is defined per-layer (see sortWithinLayers): a "best find
 * potential first" sort across a flat list would put an unverified 90-fund
 * rumour above a confirmed place, and the ranking itself would become the lie.
 */
import type { InformalPlaceType, InventorySignal, TrustLayer } from './informal-place.ts';

/**
 * Decides whether a place's indexed blob matches the visitor's raw query.
 *
 * INJECTED, not implemented here — deliberately. Two different Danish folding
 * conventions are in play: searchFold() INDEXES both spellings into one blob
 * ("soenderborg sonderborg"), while the web app's foldForSearch() collapses a
 * QUERY down to one ("sonderborg"). Running the indexing fold on a query and
 * substring-matching it can never hit, and the app's matcher additionally does
 * AND-of-tokens with a fuzzy fallback. Core would only get to reimplement that
 * badly, so the caller supplies the matcher it already trusts.
 */
export type TextMatcher = (indexedSearchText: string, rawQuery: string) => boolean;

/** The minimum shape this module needs. Structural, so both the published view
 *  (PublicInformalPlace + trustLayer) and test fixtures satisfy it. */
export interface FilterablePlace {
  placeType: InformalPlaceType;
  inventorySignals: InventorySignal[];
  trustLayer: TrustLayer;
  municipality: string | null;
  city: string | null;
  fundScore: number;
  confidence: number;
  lastSeenAt: string;
  callBeforeVisiting: boolean;
  /** Pre-folded searchable blob (name, city, description, …). */
  searchText: string;
}

export interface InformalFilterState {
  /** Free text. Empty = no text constraint. */
  query: string;
  /** Empty = all types. Multiple = OR. */
  types: InformalPlaceType[];
  /** "What are you hunting for" — empty = all. Multiple = OR (vinyl OR lego). */
  signals: InventorySignal[];
  /** Empty = all layers. */
  layers: TrustLayer[];
  /** Municipality, or null for anywhere. */
  region: string | null;
  /** Minimum fund score; 0 = no floor. */
  minFund: number;
  /** Hide places you must phone before visiting. */
  hideCallFirst: boolean;
}

export const EMPTY_INFORMAL_FILTER: InformalFilterState = {
  query: '',
  types: [],
  signals: [],
  layers: [],
  region: null,
  minFund: 0,
  hideCallFirst: false,
};

/** Dependable first, unproven last. Exported so the page and the tests agree. */
export const TRUST_LAYER_ORDER: readonly TrustLayer[] = [
  'bekraeftet',
  'kontroller-foerst',
  'radar',
];

export type InformalSort = 'fund' | 'sikkerhed' | 'senest';

export function filterInformalPlaces<T extends FilterablePlace>(
  places: readonly T[],
  f: InformalFilterState,
  matchText: TextMatcher,
): T[] {
  const q = f.query.trim();
  return places.filter((p) => {
    if (q && !matchText(p.searchText, q)) return false;
    if (f.types.length > 0 && !f.types.includes(p.placeType)) return false;
    // OR across signals: a collector hunting vinyl OR lego wants both piles.
    if (f.signals.length > 0 && !f.signals.some((s) => p.inventorySignals.includes(s))) {
      return false;
    }
    if (f.layers.length > 0 && !f.layers.includes(p.trustLayer)) return false;
    if (f.region && p.municipality !== f.region) return false;
    if (p.fundScore < f.minFund) return false;
    if (f.hideCallFirst && p.callBeforeVisiting) return false;
    return true;
  });
}

/** Group into the three layers, preserving order and dropping nothing. Reads
 *  `trustLayer` verbatim — this function cannot promote a place. */
export function groupByTrustLayer<T extends FilterablePlace>(
  places: readonly T[],
): Map<TrustLayer, T[]> {
  const out = new Map<TrustLayer, T[]>();
  for (const l of TRUST_LAYER_ORDER) out.set(l, []);
  for (const p of places) out.get(p.trustLayer)?.push(p);
  return out;
}

function compare(sort: InformalSort) {
  return (a: FilterablePlace, b: FilterablePlace): number => {
    switch (sort) {
      case 'fund':
        return b.fundScore - a.fundScore;
      case 'sikkerhed':
        return b.confidence - a.confidence;
      case 'senest':
        // Lexicographic works: ISO dates sort chronologically as strings.
        return b.lastSeenAt.localeCompare(a.lastSeenAt);
    }
  };
}

/**
 * Sort INSIDE each layer and return the layers in trust order. This is the only
 * sanctioned way to order hidden places for display: the caller never gets a
 * flat ranked list it could render as one undifferentiated column.
 */
export function sortWithinLayers<T extends FilterablePlace>(
  places: readonly T[],
  sort: InformalSort,
): Array<{ layer: TrustLayer; places: T[] }> {
  const grouped = groupByTrustLayer(places);
  const cmp = compare(sort);
  return TRUST_LAYER_ORDER.map((layer) => ({
    layer,
    places: [...(grouped.get(layer) ?? [])].sort(cmp),
  }));
}

/** Municipalities actually present, sorted for Danish readers. */
export function regionOptions(places: readonly FilterablePlace[]): string[] {
  const set = new Set<string>();
  for (const p of places) if (p.municipality) set.add(p.municipality);
  return [...set].sort((a, b) => a.localeCompare(b, 'da'));
}

/**
 * Only the signals some place actually has, ordered by how many places have
 * them. A filter chip that returns nothing is a lie about the dataset — it
 * promises inventory we do not have.
 */
export function signalOptions(places: readonly FilterablePlace[]): InventorySignal[] {
  const count = new Map<InventorySignal, number>();
  for (const p of places) {
    for (const s of p.inventorySignals) count.set(s, (count.get(s) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s);
}

/** Same rule for types: never offer a type nobody has. */
export function typeOptions(places: readonly FilterablePlace[]): InformalPlaceType[] {
  const count = new Map<InformalPlaceType, number>();
  for (const p of places) count.set(p.placeType, (count.get(p.placeType) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

/** How many constraints are active — drives the "clear filters" affordance. */
export function activeFilterCount(f: InformalFilterState): number {
  return (
    (f.query.trim() ? 1 : 0) +
    f.types.length +
    f.signals.length +
    f.layers.length +
    (f.region ? 1 : 0) +
    (f.minFund > 0 ? 1 : 0) +
    (f.hideCallFirst ? 1 : 0)
  );
}
