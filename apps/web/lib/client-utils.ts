/** Small pure helpers safe for client bundles. */

export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** ISO weekday for a YYYY-MM-DD date: 1 = Monday … 7 = Sunday. Timezone-free. */
export function isoWeekday(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/**
 * The Saturday and Sunday of `today`'s weekend, as ISO dates. On a Sunday the
 * Saturday is yesterday; callers wanting only the *remaining* weekend clamp the
 * start to `today` themselves. Single source of truth for "this weekend",
 * shared by the Explorer filter and the /i-weekenden landing page so the two
 * definitions can never drift apart.
 */
export function weekendDates(today: string): { saturday: string; sunday: string } {
  const wd = isoWeekday(today);
  const saturday = wd === 7 ? addDaysIso(today, -1) : addDaysIso(today, (6 - wd + 7) % 7);
  return { saturday, sunday: addDaysIso(saturday, 1) };
}

/**
 * Today's date in Copenhagen (YYYY-MM-DD) from the live clock. The static HTML
 * bakes a build-time date; reading the real date on the client is what keeps
 * "i dag"/"i weekenden" honest days after a build — incorrect events are not
 * acceptable, missing ones are.
 */
export function copenhagenToday(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen' }).format(new Date());
}

export type DateWindowKind = 'today' | 'weekend';

/**
 * Inclusive [from, to] ISO window for an intent landing page, relative to
 * `today`. "weekend" is the *remaining* Saturday–Sunday (on Sunday, just
 * today). Shared by the server pages (build-time render + JSON-LD) and the
 * client island (live re-derivation) so the two never disagree.
 */
export function occurrenceWindow(kind: DateWindowKind, today: string): [string, string] {
  if (kind === 'today') return [today, today];
  const { saturday, sunday } = weekendDates(today);
  return [today > saturday ? today : saturday, sunday];
}

/** The earliest occurrence date falling inside [from, to] inclusive, or null. */
export function firstDateInWindow(
  occurrences: ReadonlyArray<{ date: string }>,
  from: string,
  to: string,
): string | null {
  let best: string | null = null;
  for (const o of occurrences) {
    if (o.date >= from && o.date <= to && (best === null || o.date < best)) best = o.date;
  }
  return best;
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

/**
 * Does an already-folded haystack match an already-folded query?
 *
 * The query is split on whitespace and EVERY token must appear somewhere in the
 * haystack (AND-of-tokens), independent of order. A plain substring match would
 * fail "odense loppemarked" against a haystack that reads "loppemarked … odense"
 * — the exact multi-word case a family types. Empty query matches everything.
 */
export function matchesQuery(foldedHaystack: string, foldedQuery: string): boolean {
  const tokens = foldedQuery.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((t) => tokenMatchesFuzzy(foldedHaystack, t));
}

/** Levenshtein distance, bailing out early once it exceeds `max`. */
function boundedLevenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1; // whole row already too far — stop
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * A query token matches the haystack if it's a substring (the fast, common
 * path) OR — for tokens of 4+ chars — is within one edit of some haystack word.
 * That forgives the single fumbled letter Danish compound terms invite
 * ("loppmarked" → loppemarked, "arhus" → aarhus) instead of the zero-results
 * dead-end. Kept tight (len ≥ 4, distance ≤ 1) so it never invents matches.
 */
export function tokenMatchesFuzzy(foldedHaystack: string, token: string): boolean {
  if (foldedHaystack.includes(token)) return true;
  if (token.length < 4) return false;
  for (const word of foldedHaystack.split(/[^a-z0-9]+/)) {
    if (word.length >= 3 && boundedLevenshtein(word, token, 1) <= 1) return true;
  }
  return false;
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

/**
 * Order trip stops into an efficient drive. Greedy nearest-neighbour: from
 * `start` (the user's location) repeatedly hop to the closest unvisited stop.
 * Google's Maps URL API visits waypoints in the given order and won't
 * re-optimise, so ordering them ourselves is what makes the actual route sane.
 *
 * ANCHORING, AND WHY IT IS NOT A FREE CHOICE.
 * With no known start the route is an open path — and an open path and its
 * exact reversal always have IDENTICAL length. Our own objective function
 * therefore cannot tell the user's order from its mirror: the two are tied, and
 * something outside the objective has to break the tie. The old code broke it
 * with `b.lat - a.lat`. Latitude appears nowhere in the objective, so the tie
 * was decided by nothing at all — and a user tapping stops south->north got
 * their trip handed back exactly reversed. It wasn't a bad trade; the optimiser
 * had no opinion and acted anyway.
 *
 * We now anchor on the FIRST stop the user chose. It is equally deterministic,
 * it is the only start signal we have, and it can never hand the user back
 * their own sequence reversed.
 *
 * Nearest-neighbour is not the optimal TSP tour, but for the <=10 stops a
 * weekend loppetur allows it is within a few km of optimal and, crucially,
 * deterministic and instant.
 *
 * NOTE: this is only ever called when the user ASKS for it (the "Optimér
 * rækkefølgen" button) or when the app itself chose the stops (autoPlanTrip).
 * It must never run as a silent render step — see Explorer's tripRoute.
 */
export function optimizeTripOrder<T extends TripStop>(
  stops: readonly T[],
  start?: TripStop | null,
): T[] {
  if (stops.length <= 1) return [...stops];
  const remaining = [...stops];
  const ordered: T[] = [];
  let cursor: TripStop;
  if (start) {
    cursor = start;
  } else {
    ordered.push(remaining.shift()!); // the user's own first stop anchors the chain
    cursor = ordered[0]!;
  }
  while (remaining.length) {
    let bestIdx = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = distanceKm(cursor.lat, cursor.lng, remaining[i]!.lat, remaining[i]!.lng);
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0]!;
    ordered.push(next);
    cursor = next;
  }
  return ordered;
}

/**
 * Total driving-ish distance (km, great-circle) along the ordered stops,
 * counting the leg from `start` (the user's location) to the first stop when
 * known. An honest info-scent for "is this weekend worth the drive?".
 */
export function tripDistanceKm(stops: readonly TripStop[], start?: TripStop | null): number {
  if (stops.length === 0) return 0;
  let total = 0;
  let cursor = start ?? stops[0]!;
  const legs = start ? stops : stops.slice(1);
  for (const s of legs) {
    total += distanceKm(cursor.lat, cursor.lng, s.lat, s.lng);
    cursor = s;
  }
  return total;
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
  biggerOnly: boolean;
  accessibleOnly: boolean;
  verifiedOnly: boolean;
  inOut: 'indoor' | 'outdoor' | null;
  savedOnly: boolean;
  gemsFirst: boolean;
  view: 'list' | 'map';
  /** Shared loppetur stops ('e:slug' / 'v:slug'), in route order. A shared
   *  link recreates the whole trip — "her er vores lørdag" in one URL. */
  trip: string[];
}

export const DEFAULT_EXPLORER_PARAMS: ExplorerParams = {
  dateFilter: DEFAULT_DATE_FILTER,
  category: null,
  query: '',
  freeOnly: false,
  familyOnly: false,
  biggerOnly: false,
  accessibleOnly: false,
  verifiedOnly: false,
  inOut: null,
  savedOnly: false,
  gemsFirst: false,
  view: 'list',
  trip: [],
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
    biggerOnly: p.get('stor') === '1',
    accessibleOnly: p.get('handicap') === '1',
    verifiedOnly: p.get('bekr') === '1',
    inOut,
    savedOnly: p.get('gemt') === '1',
    gemsFirst: p.get('perler') === '1',
    trip: (p.get('tur') ?? '')
      .split(',')
      .filter((t) => /^[ev]:[a-z0-9-]+$/.test(t))
      .slice(0, 10),
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
  if (state.biggerOnly) p.set('stor', '1');
  if (state.accessibleOnly) p.set('handicap', '1');
  if (state.verifiedOnly) p.set('bekr', '1');
  if (state.inOut === 'indoor') p.set('inde', '1');
  else if (state.inOut === 'outdoor') p.set('ude', '1');
  if (state.savedOnly) p.set('gemt', '1');
  if (state.gemsFirst) p.set('perler', '1');
  if (state.trip.length > 0) p.set('tur', state.trip.join(','));
  if (state.view === 'map') p.set('visning', 'kort');
  return p.toString();
}
