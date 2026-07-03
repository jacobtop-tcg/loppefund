/** Small pure helpers safe for client bundles. */

export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** Danish-aware fold for instant search: lowercase, ø->o, å->a, æ->ae. */
export function foldForSearch(text: string): string {
  return text
    .toLowerCase()
    .replaceAll('æ', 'ae')
    .replaceAll('ø', 'o')
    .replaceAll('å', 'a')
    .replaceAll('oe', 'o')
    .replaceAll('aa', 'a');
}

export interface TripStop {
  lat: number;
  lng: number;
}

/** Google Maps URL API limit: 9 waypoints + destination. */
export const MAX_TRIP_STOPS = 10;

/**
 * Directions URL from the user's current location through stops in order;
 * the last stop is the destination. Returns null for fewer than 2 stops.
 * Omitting `origin` makes Google start from the user's current position.
 */
export function buildTripUrl(stops: ReadonlyArray<TripStop>): string | null {
  if (stops.length < 2) return null;
  const fmt = (s: TripStop) => `${s.lat.toFixed(6)},${s.lng.toFixed(6)}`;
  const params = new URLSearchParams({
    api: '1',
    destination: fmt(stops[stops.length - 1]!),
    travelmode: 'driving',
  });
  params.set('waypoints', stops.slice(0, -1).map(fmt).join('|'));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* ------------------------------------------------------------------ *
 * Shareable filter state <-> URL query string.
 *
 * Danish query keys, all defaults omitted so a pristine view has a
 * clean URL. Geolocation (pos/radius) and trip selection are session
 * state and intentionally excluded — they are not shareable.
 * ------------------------------------------------------------------ */

export type ExplorerDateFilter =
  | 'aabent-nu'
  | 'idag'
  | 'imorgen'
  | 'weekend'
  | 'naeste-weekend'
  | 'alle';

const DATE_FILTERS: readonly ExplorerDateFilter[] = [
  'aabent-nu',
  'idag',
  'imorgen',
  'weekend',
  'naeste-weekend',
  'alle',
];

const DEFAULT_DATE_FILTER: ExplorerDateFilter = 'weekend';

export interface ExplorerParams {
  dateFilter: ExplorerDateFilter;
  category: string | null;
  query: string;
  freeOnly: boolean;
  familyOnly: boolean;
  inOut: 'indoor' | 'outdoor' | null;
  savedOnly: boolean;
  gemsFirst: boolean;
  view: 'list' | 'map';
}

export const DEFAULT_EXPLORER_PARAMS: ExplorerParams = {
  dateFilter: DEFAULT_DATE_FILTER,
  category: null,
  query: '',
  freeOnly: false,
  familyOnly: false,
  inOut: null,
  savedOnly: false,
  gemsFirst: false,
  view: 'list',
};

/**
 * Parse a `window.location.search` string into filter state. Unknown or
 * malformed values fall back to defaults, so a hand-edited URL never throws.
 */
export function parseExplorerParams(search: string): ExplorerParams {
  const p = new URLSearchParams(search);
  const dato = p.get('dato');
  const dateFilter =
    dato && (DATE_FILTERS as readonly string[]).includes(dato)
      ? (dato as ExplorerDateFilter)
      : DEFAULT_DATE_FILTER;

  const category = p.get('kat') || null;
  const query = p.get('q') ?? '';

  let inOut: 'indoor' | 'outdoor' | null = null;
  if (p.get('inde') === '1') inOut = 'indoor';
  else if (p.get('ude') === '1') inOut = 'outdoor';

  return {
    dateFilter,
    category,
    query,
    freeOnly: p.get('gratis') === '1',
    familyOnly: p.get('familie') === '1',
    inOut,
    savedOnly: p.get('gemt') === '1',
    gemsFirst: p.get('perler') === '1',
    view: p.get('visning') === 'kort' ? 'map' : 'list',
  };
}

/**
 * Serialize filter state to a query string (no leading `?`). Defaults are
 * omitted, so the pristine weekend/list view serializes to the empty string.
 */
export function serializeExplorerParams(state: ExplorerParams): string {
  const p = new URLSearchParams();
  if (state.dateFilter !== DEFAULT_DATE_FILTER) p.set('dato', state.dateFilter);
  if (state.category) p.set('kat', state.category);
  const q = state.query.trim();
  if (q) p.set('q', q);
  if (state.freeOnly) p.set('gratis', '1');
  if (state.familyOnly) p.set('familie', '1');
  if (state.inOut === 'indoor') p.set('inde', '1');
  else if (state.inOut === 'outdoor') p.set('ude', '1');
  if (state.savedOnly) p.set('gemt', '1');
  if (state.gemsFirst) p.set('perler', '1');
  if (state.view === 'map') p.set('visning', 'kort');
  return p.toString();
}
