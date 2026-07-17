'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { copenhagenNow, isOpenAt, parseStallCount, UPCOMING_HORIZON_DAYS, type CphNow } from '@loppefund/core';
import type { EventSummary, VenueSummary } from '../lib/data.ts';
import { useFavorites } from '../lib/favorites.ts';
import { isUnverified } from '../lib/trust.ts';
import { formatDateLong } from '../lib/format.ts';
import { venueOpenState, VENUE_TYPES, type VenueType } from '../lib/venue-client.ts';
import { buildSearchIndex, expandQueryAliases } from '../lib/search-index.ts';
import { buildCityGazetteer, suggestCities } from '../lib/city-gazetteer.ts';
import { useOutdoorWeather } from '../lib/weather.ts';
import { FilterBar, type DateFilter } from './FilterBar.tsx';
import { NAV_FLAG } from './BackLink.tsx';
import { ShareButton } from './ShareButton.tsx';
import { MapSkeleton } from './MapSkeleton.tsx';
import { ResultsList } from './ResultsList.tsx';
import { Recommendations } from './Recommendations.tsx';
import { recommend } from '../lib/recommend.ts';
import {
  clearSavedLocation,
  readSavedLocation,
  writeSavedLocation,
} from '../lib/saved-location.ts';
import {
  addDaysIso,
  buildTripUrl,
  distanceKm,
  foldForSearch,
  matchesQuery,
  MAX_TRIP_STOPS,
  optimizeTripOrder,
  parseExplorerParams,
  pickTripDay,
  serializeExplorerParams,
  tripDistanceKm,
  weekendDates,
} from '../lib/client-utils.ts';

const MapView = dynamic(() => import('./MapView.tsx').then((m) => m.MapView), {
  ssr: false,
  loading: () => <MapSkeleton className="map-shell" />,
});

// "Større markeder" bar: a known stall count at/above this is a substantial
// market worth driving to. ~113 of the events clear it — a useful, honest set.
const BIGGER_STALLS = 15;

// Past this, a first stop is far enough that the route is worth questioning out
// loud. ~45 min of driving in Denmark: far enough that nobody starts a loppetur
// there by accident, near enough that a genuine "drive out, work back" plan
// isn't nagged. It gates a QUESTION, never an action — the worst it can do is
// offer a sort the user declines.
const FAR_FIRST_LEG_KM = 40;

/** [from, to] inclusive for each date filter. Weekend = Sat+Sun (or rest of it). */
function dateRangeFor(filter: DateFilter, today: string): [string, string] {
  if (filter === 'idag' || filter === 'aabent-nu') return [today, today];
  if (filter === 'imorgen') {
    const tomorrow = addDaysIso(today, 1);
    return [tomorrow, tomorrow];
  }
  // "Alle datoer" must span the SAME horizon the page loads (data.ts uses
  // UPCOMING_HORIZON_DAYS), or a market that exists in the dataset would still
  // be filtered out of the one view that promises "all dates".
  if (filter === 'alle') return [today, addDaysIso(today, UPCOMING_HORIZON_DAYS)];
  const { saturday: thisSat, sunday: thisSun } = weekendDates(today);
  if (filter === 'weekend') {
    // Show only the remaining part of the current weekend.
    const start = today > thisSat ? today : thisSat;
    return [start, thisSun];
  }
  // "Næste weekend" = the Saturday–Sunday one week after this weekend's.
  return [addDaysIso(thisSat, 7), addDaysIso(thisSun, 7)];
}

export function Explorer({
  events,
  now: initialNow,
}: {
  events: EventSummary[];
  now: CphNow;
}) {
  const [dateFilter, setDateFilter] = useState<DateFilter>('weekend');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  /**
   * Interests the visitor is hunting ("vinyl", "møbler"). OR within — a hunter
   * after vinyl OR lego wants both piles. Matches a market only when its own
   * text ADVERTISES the thing; two markets in three say nothing, and this filter
   * must never be read as "the rest don't have it".
   */
  const [interests, setInterests] = useState<string[]>([]);
  const [freeOnly, setFreeOnly] = useState(false);
  const [familyOnly, setFamilyOnly] = useState(false);
  // "Større markeder" — answers the mandate's "which are worth driving to?".
  // A market with a known stall count at/above this bar is a substantial one.
  const [biggerOnly, setBiggerOnly] = useState(false);
  // "Kørestolsvenligt" — wheelchair-accessible only (from stated amenities).
  const [accessibleOnly, setAccessibleOnly] = useState(false);
  // "Bekræftet" — trust-first browse: only markets corroborated by ≥2 sources
  // and above the confidence bar. The mode only Loppefund's provenance can power.
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [inOut, setInOut] = useState<'indoor' | 'outdoor' | null>(null);
  const [view, setView] = useState<'list' | 'map'>('list');
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  /**
   * WHERE the position came from. A real device fix is "where I am" and worth
   * remembering; a town picked to sort one trip is not. Without this the
   * persistence effect below would overwrite the visitor's saved home the moment
   * they picked "Odense" as a start, and /naer-mig would think they had moved.
   */
  const [posSource, setPosSource] = useState<'gps' | 'by' | null>(null);
  /** The picked town's name, so the UI can say what it is sorting from. */
  const [posLabel, setPosLabel] = useState<string | null>(null);
  const [radius, setRadius] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [now, setNow] = useState<CphNow>(initialNow);
  const [gemsFirst, setGemsFirst] = useState(false);
  const [tripMode, setTripMode] = useState(false);
  // Insertion order IS route order — nothing downstream reorders it. The only
  // thing that ever rewrites this array is optimizeTrip(), on an explicit tap.
  const [tripSlugs, setTripSlugs] = useState<string[]>([]);
  /** The selection as it was before the last "Optimér rækkefølgen", or null. */
  const [tripUndo, setTripUndo] = useState<string[] | null>(null);
  /** Which day "⚡ Planlæg for mig" planned for, or null when the user picked. */
  const [tripNotice, setTripNotice] = useState<string | null>(null);
  /**
   * The trip asks where you START — the one input that decides whether an order
   * makes sense. Session-only on purpose: "skip" is a decision about this trip,
   * not a preference to remember, and a persisted dismissal would silently
   * disable the fix forever.
   */
  const [originAsked, setOriginAsked] = useState(false);
  const [originDismissed, setOriginDismissed] = useState(false);
  /** The town picker — the way out for anyone who denied the permission. */
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cityQuery, setCityQuery] = useState('');
  const [savedOnly, setSavedOnly] = useState(false);
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);
  // Permanent-venue layer (thrift/antique/flea shops): off by default so the
  // weekend-markets view stays clean; a master toggle + per-type toggles opt in.
  const [venuesOn, setVenuesOn] = useState(false);
  const [venueTypes, setVenueTypes] = useState<Set<VenueType>>(() => new Set(VENUE_TYPES));
  // Lazy-loaded so ~1,000 venues never sit in the initial HTML: fetched from the
  // static /venues.json the first time the "Faste steder" layer is opened.
  const [venues, setVenues] = useState<VenueSummary[]>([]);
  const [venuesLoaded, setVenuesLoaded] = useState(false);
  const { favorites, count: favCount } = useFavorites();

  // Venues must be reachable through the SEARCH front door too, not only the
  // layer toggle: a visitor typing "loppebazar" has never heard of "Faste
  // steder" (root cause of the invisible-Loppebazar report). So the lazy fetch
  // also fires on the first real query.
  //
  // ...and on a shared trip that contains one. Without that clause a `?tur=`
  // link with a `v:` stop was DEAD ON ARRIVAL: venues.json never loaded, so the
  // stop had no coordinate, the bar counted a stop the route didn't have, and
  // the Google button stayed disabled forever. The app's own "Del turen" button
  // produced exactly that link, because it drops `q` — the one parameter that
  // could otherwise have triggered the fetch.
  // ...and when the town picker opens: 129 of the 413 towns exist ONLY in the
  // shop data, so a gazetteer without it would silently fail to offer them.
  // Gated on the picker rather than trip mode, so only a visitor who actually
  // asks for the list pays the ~340 KB.
  const wantVenues =
    venuesOn || query.trim().length >= 2 || tripSlugs.some((t) => t.startsWith('v:')) || pickerOpen;
  useEffect(() => {
    if (!wantVenues || venuesLoaded) return;
    let cancelled = false;
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
    fetch(`${base}/venues.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: VenueSummary[]) => {
        if (!cancelled) {
          setVenues(Array.isArray(data) ? data : []);
          setVenuesLoaded(true);
        }
      })
      .catch(() => {
        // A failed fetch just means no venues this session — the map/markets
        // are unaffected. Retry on the next toggle.
        if (!cancelled) setVenuesLoaded(false);
      });
    return () => {
      cancelled = true;
    };
  }, [wantVenues, venuesLoaded]);

  // Today's date, derived from the LIVE clock — never a build-time constant.
  // The static HTML bakes `now` at build; if "today" came from a frozen prop it
  // would lag the visitor's real date every night between local midnight and
  // the next scheduled rebuild, so 'I dag'/'Åbent nu' would filter to yesterday
  // and 'i dag' labels would be wrong. `now.date` refreshes on mount + every
  // 60s below, and equals the build date on the first render (server and client
  // agree → no hydration mismatch).
  const today = now.date;

  // The `now` prop is baked into the static HTML at build time, so on the
  // deployed site open-now state would otherwise be computed against build
  // time, not the visitor's. Refresh to the real clock on mount and keep it
  // ticking every minute regardless of which date filter is active.
  useEffect(() => {
    setNow(copenhagenNow());
    const id = setInterval(() => setNow(copenhagenNow()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Shareable filter URLs. We read window.location.search in a mount effect
  // (never a useState initializer — the pre-rendered static HTML must match
  // the first client render or hydration mismatches). `hydrated` gates the
  // write-back effect so it can't clobber the URL with defaults before the
  // read has applied the shared state.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const parsed = parseExplorerParams(window.location.search);
    setDateFilter(parsed.dateFilter);
    setCategory(parsed.category);
    setQuery(parsed.query);
    setFreeOnly(parsed.freeOnly);
    setFamilyOnly(parsed.familyOnly);
    setBiggerOnly(parsed.biggerOnly);
    setAccessibleOnly(parsed.accessibleOnly);
    setVerifiedOnly(parsed.verifiedOnly);
    setInOut(parsed.inOut);
    setSavedOnly(parsed.savedOnly);
    setGemsFirst(parsed.gemsFirst);
    setView(parsed.view);
    // A shared loppetur link recreates the whole trip. Event stops are
    // validated against the baked event list (a stale link never injects junk);
    // venue stops pass through and are validated once venues.json arrives —
    // `wantVenues` now watches tripSlugs, so a shared trip fetches the layer it
    // needs. Unknown venue slugs simply never render as stops.
    if (parsed.trip.length > 0) {
      const known = new Set(events.map((e) => `e:${e.slug}`));
      const valid = parsed.trip.filter((t) => t.startsWith('v:') || known.has(t));
      if (valid.length > 0) {
        setTripSlugs(valid);
        setTripMode(true);
      }
    }
    // Land a returning visitor back in their own area (device-local, never a
    // URL). A shared link (which carries no location) never triggers this,
    // because its owner's browser has nothing saved.
    const savedLoc = readSavedLocation();
    if (savedLoc) {
      setPos({ lat: savedLoc.lat, lng: savedLoc.lng });
      // Every record ever written to this key came from getCurrentPosition —
      // it is backed, not guessed.
      setPosSource('gps');
      if (savedLoc.radius !== null) setRadius(savedLoc.radius);
    }
    setHydrated(true);
    // Mark that the visitor has browsed the list this session — detail pages'
    // back-links then use real history-back so filters + scroll survive.
    try {
      sessionStorage.setItem(NAV_FLAG, '1');
    } catch {
      /* private-mode edge — back-links just use their href fallback */
    }
  }, []);

  // Remember the location on this device whenever it changes, so the next visit
  // restores it. Only a REAL device fix counts as home — a town picked to sort a
  // single loppetur is a start point, not a move. Clearing is in clearPos.
  useEffect(() => {
    if (!hydrated || !pos || posSource !== 'gps') return;
    writeSavedLocation({ lat: pos.lat, lng: pos.lng, radius });
  }, [hydrated, pos, posSource, radius]);

  /**
   * The complete shareable state, in one place.
   *
   * Both the address bar and the "Del turen" button read this. They used to
   * disagree: the bar carried every filter while the share button hand-built
   * `?tur=…` and silently dropped `dato`, `kat` and `q`. So the recipient landed
   * on the default weekend view with a trip whose stops weren't in it — unable
   * to inspect or remove them — and, before the venue-fetch fix, with a dead
   * route, because `q` was the very parameter that would have loaded the shops.
   */
  const explorerQuery = useMemo(
    () =>
      serializeExplorerParams({
        dateFilter,
        category,
        query,
        freeOnly,
        familyOnly,
        biggerOnly,
        accessibleOnly,
        verifiedOnly,
        inOut,
        savedOnly,
        gemsFirst,
        view,
        // The trip only lives in the URL while trip mode is on — leaving the
        // mode leaves a clean, shareable filter URL behind.
        trip: tripMode ? tripSlugs : [],
      }),
    [dateFilter, category, query, freeOnly, familyOnly, biggerOnly, accessibleOnly, verifiedOnly, inOut, savedOnly, gemsFirst, view, tripMode, tripSlugs],
  );

  // Keep the URL in sync via replaceState so refresh/back restore state without
  // polluting history. SSR-guarded.
  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return;
    const url = explorerQuery
      ? `${window.location.pathname}?${explorerQuery}`
      : window.location.pathname;
    window.history.replaceState(null, '', url);
  }, [hydrated, explorerQuery]);


  // Only the interests some market actually advertises, most common first. A
  // chip that can return nothing is a promise the data can't keep.
  const interestOptions = useMemo(() => {
    const n = new Map<string, number>();
    for (const e of events) for (const s of e.inventorySignals) n.set(s, (n.get(s) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }, [events]);

  // Autocomplete index (cities + market/venue names), built once from the data.
  const searchIndex = useMemo(() => buildSearchIndex(events, venues), [events, venues]);

  // Typing stays instant (the input reads `query`), while the expensive filter
  // passes over ~700 events + ~1100 venues run against a deferred value — React
  // keeps the last result on screen and recomputes off the critical path.
  const deferredQuery = useDeferredValue(query);

  // SEARCH IS A FRONT DOOR TO THE WHOLE DATABASE, NOT TO THE CURRENT DATE CHIP.
  // Typing a name/town means "find this", never "find this, but only if it falls
  // in this weekend". The old behaviour answered "0 markeder · »sønderborg«"
  // while two real Sønderborg markets sat in the DB in January — data present,
  // invisible to the person looking for it. So an active query spans the FULL
  // horizon; the date chips stay in charge of BROWSING (when there's no query).
  const searching = deferredQuery.trim().length > 0;
  const [from, to] = searching
    ? [today, addDaysIso(today, UPCOMING_HORIZON_DAYS)]
    : dateRangeFor(dateFilter, today);

  const filtered = useMemo(() => {
    const q = expandQueryAliases(foldForSearch(deferredQuery.trim()));
    const result: Array<
      EventSummary & { nextDate: string; distanceKm: number | null; openNow: boolean }
    > = [];
    for (const e of events) {
      const inRange = e.occurrences.filter((o) => o.date >= from && o.date <= to);
      if (inRange.length === 0) continue;
      const openNow = isOpenAt(inRange, now.date, now.time);
      if (dateFilter === 'aabent-nu' && !openNow) continue;
      if (savedOnly && !favorites.includes(e.slug)) continue;
      if (category && e.category !== category) continue;
      if (interests.length > 0 && !interests.some((i) => e.inventorySignals.includes(i as never))) continue;
      if (freeOnly && e.isFree !== true) continue;
      if (familyOnly && !e.familyFriendly) continue;
      if (biggerOnly && (parseStallCount(e.stallCountText) ?? 0) < BIGGER_STALLS) continue;
      if (accessibleOnly && !e.accessible) continue;
      if (verifiedOnly && (isUnverified(e.confidence) || e.sourceCount < 2)) continue;
      if (inOut && e.indoorOutdoor !== inOut && e.indoorOutdoor !== 'mixed') continue;
      if (q) {
        const haystack =
          foldForSearch(
            `${e.title} ${e.city ?? ''} ${e.venueName ?? ''} ${e.municipality ?? ''} ${e.postcode ?? ''} ${e.organizer ?? ''} ${e.street ?? ''}`,
          ) + ` ${e.searchText}`;
        if (!matchesQuery(haystack, q)) continue;
      }
      const d =
        pos && e.lat != null && e.lng != null
          ? distanceKm(pos.lat, pos.lng, e.lat, e.lng)
          : null;
      if (pos && radius !== null && (d === null || d > radius)) continue;
      result.push({ ...e, nextDate: inRange[0]!.date, distanceKm: d, openNow });
    }
    result.sort((a, b) => {
      if (a.nextDate !== b.nextDate) return a.nextDate.localeCompare(b.nextDate);
      // Special one-off events before always-open venues on the same day.
      if (a.occurrences.length !== b.occurrences.length) {
        return a.occurrences.length - b.occurrences.length;
      }
      if (a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm;
      return b.confidence - a.confidence;
    });
    if (dateFilter === 'aabent-nu') {
      // Closing soonest first — "we can still make it" ordering.
      const endOf = (e: (typeof result)[number]) =>
        e.occurrences.find((o) => o.date === now.date)?.endTime ?? '99:99';
      result.sort((a, b) => endOf(a).localeCompare(endOf(b)));
    }
    if (pos) {
      // Nearest first; coordinate-less events sink to the end (a 0-return
      // comparator is intransitive and leaves TimSort partly unsorted).
      result.sort((a, b) => {
        if (a.distanceKm === null && b.distanceKm === null) return 0;
        if (a.distanceKm === null) return 1;
        if (b.distanceKm === null) return -1;
        return a.distanceKm - b.distanceKm;
      });
    }
    if (gemsFirst) result.sort((a, b) => Number(b.gem) - Number(a.gem));
    return result;
  }, [events, from, to, deferredQuery, category, interests, freeOnly, familyOnly, biggerOnly, accessibleOnly, verifiedOnly, inOut, pos, radius, dateFilter, now, gemsFirst, savedOnly, favorites]);

  // The permanent-venue layer, filtered in parallel with events (venues have no
  // dates, so the date chips don't apply — except "Åbent nu", which narrows them
  // to shops open right now). Respects type toggles, search and location.
  const filteredVenues = useMemo(() => {
    const q = expandQueryAliases(foldForSearch(deferredQuery.trim()));
    // Search is a front door: a typed query surfaces matching venues even when
    // the layer is off — "loppebazar" must find the shop without the visitor
    // knowing the "Faste steder" toggle exists. Without a query, the toggle
    // still owns visibility (the default weekend view stays clean).
    if (!venuesOn && !q) return [];
    const onlyOpen = dateFilter === 'aabent-nu';
    const result: Array<VenueSummary & { distanceKm: number | null; open: boolean }> = [];
    for (const v of venues) {
      // The per-type chips are part of the layer UI — they only bind when the
      // layer is on. A search with the layer off must not be silently narrowed
      // by chips the visitor can't see.
      if (venuesOn && !venueTypes.has(v.category as VenueType)) continue;
      const st = venueOpenState(v.openingHoursText, now);
      if (onlyOpen && !st.open) continue;
      if (q) {
        const hay =
          foldForSearch(`${v.title} ${v.city ?? ''} ${v.street ?? ''} ${v.postcode ?? ''}`) +
          ` ${v.searchText}`;
        if (!matchesQuery(hay, q)) continue;
      }
      const d =
        pos && v.lat != null && v.lng != null ? distanceKm(pos.lat, pos.lng, v.lat, v.lng) : null;
      if (pos && radius !== null && (d === null || d > radius)) continue;
      result.push({ ...v, distanceKm: d, open: st.open });
    }
    result.sort((a, b) => {
      if (pos && a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm;
      if (a.open !== b.open) return Number(b.open) - Number(a.open);
      return a.title.localeCompare(b.title, 'da');
    });
    return result;
  }, [venues, venuesOn, venueTypes, deferredQuery, dateFilter, now, pos, radius]);

  const toggleVenueType = useCallback((t: VenueType) => {
    setVenueTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }, []);

  // "Til dig": personalized top picks from the full upcoming set (independent of
  // the active filter). Shown only when the visitor is browsing, not searching.
  const recs = useMemo(
    () =>
      recommend(events, pos, today, {
        distanceKm,
        limit: 4,
        favorites: new Set(favorites),
        // Scope the rail to the SAME window the list shows, so it can't
        // recommend next month above "Weekenden 18.-19. juli". Only when a real
        // date filter is active — while searching, the window is the whole
        // horizon and the rail is hidden anyway.
        window: searching ? undefined : dateRangeFor(dateFilter, today),
      }),
    [events, pos, today, favorites, dateFilter, searching],
  );

  // The empty state must always help onward: when filters yield nothing,
  // relax date/radius (keep category & search) and suggest the nearest
  // upcoming alternatives instead of a dead end.
  const suggestions = useMemo(() => {
    if (filtered.length > 0) return [];
    // Never suggest markets that contradict what the visitor explicitly asked
    // for: honour the practical filters (free/family/indoor-outdoor) and, when
    // they're browsing only their saved list, offer nothing rather than a
    // stranger's market. Date/radius are intentionally relaxed — that's the
    // point of the empty state ("nothing this weekend, but here's what's near").
    if (savedOnly) return [];
    const q = expandQueryAliases(foldForSearch(deferredQuery.trim()));
    const horizon = addDaysIso(today, 45);
    const alt: Array<EventSummary & { nextDate: string; distanceKm: number | null; openNow: boolean }> = [];
    for (const e of events) {
      const upcoming = e.occurrences.filter((o) => o.date >= today && o.date <= horizon);
      if (upcoming.length === 0) continue;
      if (category && e.category !== category) continue;
      if (interests.length > 0 && !interests.some((i) => e.inventorySignals.includes(i as never))) continue;
      if (freeOnly && e.isFree !== true) continue;
      if (familyOnly && !e.familyFriendly) continue;
      if (biggerOnly && (parseStallCount(e.stallCountText) ?? 0) < BIGGER_STALLS) continue;
      if (accessibleOnly && !e.accessible) continue;
      if (verifiedOnly && (isUnverified(e.confidence) || e.sourceCount < 2)) continue;
      if (inOut && e.indoorOutdoor !== inOut && e.indoorOutdoor !== 'mixed') continue;
      if (q) {
        const haystack =
          foldForSearch(`${e.title} ${e.city ?? ''} ${e.venueName ?? ''} ${e.municipality ?? ''}`) +
          ` ${e.searchText}`;
        if (!matchesQuery(haystack, q)) continue;
      }
      const d =
        pos && e.lat != null && e.lng != null
          ? distanceKm(pos.lat, pos.lng, e.lat, e.lng)
          : null;
      alt.push({ ...e, nextDate: upcoming[0]!.date, distanceKm: d, openNow: false });
    }
    alt.sort((a, b) => {
      if (pos && a.distanceKm !== null && b.distanceKm !== null) {
        return a.distanceKm - b.distanceKm;
      }
      return a.nextDate.localeCompare(b.nextDate);
    });
    return alt.slice(0, 3);
  }, [filtered.length, events, today, deferredQuery, category, freeOnly, familyOnly, biggerOnly, accessibleOnly, verifiedOnly, inOut, savedOnly, pos]);

  // Echo the active refinements next to the result count, so the number always
  // has context ("12 markeder i weekenden · gratis · inden 25 km · »odense«").
  // Date filter is already spelled out by ResultsList; these are the extras.
  const refinements = useMemo(() => {
    const r: string[] = [];
    if (freeOnly) r.push('gratis');
    if (familyOnly) r.push('børnevenlige');
    if (biggerOnly) r.push('større markeder');
    if (accessibleOnly) r.push('kørestolsvenlige');
    if (verifiedOnly) r.push('bekræftede');
    if (inOut === 'indoor') r.push('indendørs');
    else if (inOut === 'outdoor') r.push('udendørs');
    if (savedOnly) r.push('gemte');
    if (pos && radius !== null) r.push(`inden ${radius} km`);
    else if (pos) r.push('nær dig');
    const q = query.trim();
    if (q) r.push(`»${q}«`);
    return r;
  }, [freeOnly, familyOnly, biggerOnly, accessibleOnly, verifiedOnly, inOut, savedOnly, pos, radius, query]);

  // The map never goes blank: when filters yield nothing it shows the same
  // three suggestions the empty state offers as list cards.
  const mapEvents = filtered.length > 0 ? filtered : suggestions;

  // Weekend weather for the OUTDOOR markets on show — the big "worth driving
  // to?" signal. Client-only, non-blocking; empty until it resolves.
  const weather = useOutdoorWeather(mapEvents);

  // Trip selection is keyed by slug against the full list, so filter changes
  // never drop chosen stops.
  const eventsBySlug = useMemo(() => new Map(events.map((e) => [e.slug, e])), [events]);
  const venuesBySlug = useMemo(() => new Map(venues.map((v) => [v.slug, v])), [venues]);
  // A loppetur can mix one-off markets AND permanent shops (genbrug/antik/…), so
  // stops are namespaced 'e:<slug>' / 'v:<slug>' — a market and a shop can share
  // a slug string, and the route/highlight logic must tell them apart.
  const coordForStop = useCallback(
    (id: string): { lat: number; lng: number } | null => {
      const [kind, slug] = [id.slice(0, 1), id.slice(2)];
      const row = kind === 'v' ? venuesBySlug.get(slug) : eventsBySlug.get(slug);
      return row && row.lat != null && row.lng != null ? { lat: row.lat, lng: row.lng } : null;
    },
    [eventsBySlug, venuesBySlug],
  );
  // Route order IS the order the user tapped. We never silently reorder: the
  // "Optimér rækkefølgen" button rewrites tripSlugs itself, so state, URL, map
  // numbers and the Google route can never disagree.
  //
  // `pos` is deliberately NOT a dependency. It used to be, and that meant the
  // pins silently renumbered mid-session the moment geolocation resolved — and
  // that a shared ?tur= link (which carries tap order) rendered a DIFFERENT
  // order on the recipient's device than the sender ever saw.
  const tripRoute = useMemo(
    () =>
      tripSlugs
        .map((id) => {
          const c = coordForStop(id);
          return c ? { id, lat: c.lat, lng: c.lng } : null;
        })
        .filter((s): s is { id: string; lat: number; lng: number } => s !== null),
    [tripSlugs, coordForStop],
  );
  // Two DIFFERENT numbers, and conflating them is how the bar came to read
  // "~8 km" for a drive Google measured at 165 km:
  //   with a start -> the whole journey, including getting to stop 1
  //   without one  -> only the distance BETWEEN the stops, which is all we know
  // The label has to change with the meaning, so tripKm carries its own words.
  const { tripUrl, tripKm } = useMemo(() => {
    const url = buildTripUrl(tripRoute);
    if (tripRoute.length === 0) return { tripUrl: url, tripKm: null };
    return {
      tripUrl: url,
      tripKm: pos
        ? { km: tripDistanceKm(tripRoute, pos), label: 'fra dig' }
        : { km: tripDistanceKm(tripRoute.slice(1), tripRoute[0]!), label: 'mellem stoppene' },
    };
  }, [tripRoute, pos]);

  /**
   * Ask where the trip starts once an ORDER EXISTS — two stops — and not before.
   * One stop has no order to get wrong, so asking then is unexplained noise, and
   * an unexplained permission prompt gets denied. A denial is permanent and
   * per-origin: code can never re-prompt. So the ask has to be worth its one
   * shot, which means it must arrive with a visible reason attached.
   */
  const needsOrigin =
    tripMode && !pos && !originDismissed && (tripSlugs.length >= 2 || originAsked);

  // Built from the coordinates the app already has — no endpoint, no geocoder,
  // no invented data. Deferred until the picker opens: that is when the shop
  // layer has landed, and 129 of the 413 towns exist only in it.
  const gazetteer = useMemo(
    () => (pickerOpen ? buildCityGazetteer([...events, ...venues]) : []),
    [pickerOpen, events, venues],
  );
  const citySuggestions = useMemo(() => suggestCities(gazetteer, cityQuery), [gazetteer, cityQuery]);

  /** How far stop 1 is from the user — the number behind "this makes no sense". */
  const firstLegKm = useMemo(
    () => (pos && tripRoute[0] ? distanceKm(pos.lat, pos.lng, tripRoute[0].lat, tripRoute[0].lng) : null),
    [pos, tripRoute],
  );

  // Handlers passed to the memoized FilterBar/ResultsList must be referentially
  // stable, or every hoveredSlug change re-renders 600+ cards.
  const toggleTrip = useCallback((slug: string) => {
    setTripUndo(null); // the undo would point at a selection that no longer exists
    setTripNotice(null); // once the user edits the selection, it isn't "our plan" any more
    setTripSlugs((prev) =>
      prev.includes(slug)
        ? prev.filter((x) => x !== slug)
        : prev.length >= MAX_TRIP_STOPS
          ? prev
          : [...prev, slug],
    );
  }, []);

  /**
   * The ONLY place the app reorders a trip — and only when asked.
   *
   * It writes back into tripSlugs rather than sorting on the way to the map, so
   * the sorted order is what gets numbered, shared and driven. Reordering is now
   * an act the user performs and can undo, not something that happens to them.
   */
  const optimizeTrip = useCallback(() => {
    // The remedy must ask for the input it needs. Without a start point this
    // used to fall through to a no-op: the user tapped the app's only fix and
    // NOTHING happened — no reorder, no message, no state change. Ordering
    // without a start is now unrepresentable (optimizeTripOrder requires one),
    // so there is exactly one honest thing left to do: ask.
    if (!pos) {
      setOriginAsked(true);
      return;
    }
    const stops = tripSlugs
      .map((id) => {
        const c = coordForStop(id);
        return c ? { id, lat: c.lat, lng: c.lng } : null;
      })
      .filter((s): s is { id: string; lat: number; lng: number } => s !== null);
    if (stops.length < 2) return;
    const ordered = optimizeTripOrder(stops, pos).map((s) => s.id);
    // A stop we have no coordinate for isn't routable, but it is still the
    // user's choice — park it at the end rather than drop it from their own
    // selection.
    const next = [...ordered, ...tripSlugs.filter((id) => !ordered.includes(id))];
    if (next.every((id, i) => id === tripSlugs[i])) {
      // Already optimal. Say so — silence after tapping the only remedy reads
      // exactly like a broken button, which is how this bug was reported.
      setTripNotice('Rækkefølgen er allerede den korteste');
      return;
    }
    setTripUndo(tripSlugs);
    setTripSlugs(next);
    // NOT the setTripSlugs(prev => …) form on purpose: setTripUndo inside an
    // updater is a side effect, and strict mode double-invokes updaters.
  }, [tripSlugs, pos, coordForStop]);

  const undoOptimize = useCallback(() => {
    if (!tripUndo) return;
    setTripSlugs(tripUndo);
    setTripUndo(null);
  }, [tripUndo]);

  const exitTrip = useCallback(() => {
    setTripMode(false);
    setTripSlugs([]);
    setTripUndo(null);
    setTripNotice(null);
  }, []);

  const toggleTripMode = useCallback(
    () => (tripMode ? exitTrip() : setTripMode(true)),
    [tripMode, exitTrip],
  );

  // Concierge move: auto-fill the loppetur from the CURRENT filtered view (which
  // already honours the active date window / radius / search). Anchor on the
  // visitor's location if known, else the first (soonest) market, then take the
  // NEAREST stops to that anchor — so the route is a compact day trip, not a
  // cross-country sprawl. optimizeTripOrder then draws the drive-ordered route.
  // A tap that turns raw data into a planned Saturday — no competitor has the
  // corpus for it.
  const autoPlanTrip = useCallback(() => {
    // Its own label promises "tættest på dig først". Without a start point that
    // was an unbacked assertion: the anchor fell back to the soonest market in
    // the list, so the app centred the whole plan on a town the user had never
    // heard of and still called it "closest to you". Ask instead of pretending.
    if (!pos) {
      setOriginAsked(true);
      return;
    }
    const withCoords = filtered.filter((e) => e.lat != null && e.lng != null);
    if (withCoords.length < 2) return;

    // ONE DAY — not one weekend, and certainly not one year.
    //
    // `filtered` spans BOTH weekend days on the default chip, and up to 365 days
    // under "Alle datoer" or any active search. Taking the nearest N regardless
    // of date welded Saturday-only and Sunday-only markets into a single Google
    // Maps route, numbered 1..N. That trip cannot be driven, and no code path
    // downstream could detect it: a TripStop is just {lat, lng} — a date can
    // never reach the optimiser.
    //
    // So the day is chosen HERE: the soonest day that actually has two markets
    // to string together. "Planlæg for mig" means "plan my next loppe-day".
    const day = pickTripDay(withCoords);
    if (!day) return;
    // A market running Sat AND Sun belongs to whichever day we picked — hence
    // the occurrence check rather than a nextDate equality test.
    const sameDay = withCoords.filter((e) => e.occurrences.some((o) => o.date === day));

    const anchor = pos;
    const near = [...sameDay]
      .sort(
        (a, b) =>
          distanceKm(anchor.lat, anchor.lng, a.lat!, a.lng!) -
          distanceKm(anchor.lat, anchor.lng, b.lat!, b.lng!),
      )
      .slice(0, MAX_TRIP_STOPS)
      .map((e) => ({ id: `e:${e.slug}`, lat: e.lat!, lng: e.lng! }));
    if (near.length < 2) return;
    // This is the ONE path where the app chose the stops, so it is entitled to
    // choose the order too — but it must now do so explicitly, because the
    // implicit reorder in tripRoute is gone.
    //
    // Order from the SAME anchor the selection was built around. Selecting
    // around one point and then chaining from another made the market the whole
    // plan is centred on come out last.
    setTripUndo(null);
    setTripSlugs(optimizeTripOrder(near, anchor).map((s) => s.id));
    // Say which day we picked. The app just made a choice on the user's behalf;
    // it does not get to make that choice silently.
    setTripNotice(formatDateLong(day));
  }, [filtered, pos]);

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setGeoError('Din browser deler ikke placering.');
      return;
    }
    setLocating(true);
    setGeoError(null); // clear any prior error when re-attempting
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
        setPosSource('gps');
        setPosLabel(null);
        setLocating(false);
        setGeoError(null); // a later success must wipe an earlier failure
      },
      (err) => {
        setLocating(false);
        // The three failure modes are NOT the same thing and must not share
        // copy: a denial is permanent and per-origin (code cannot re-prompt —
        // only the browser's own site settings can), while a timeout indoors is
        // worth retrying. Telling a blocked user to "check permissions" is the
        // only useful thing; telling a timed-out user that is a wild goose chase.
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? 'Du har slået placering fra for siden — det kan kun ændres i browserens indstillinger.'
            : 'Kunne ikke finde din placering lige nu. Prøv igen.',
        );
      },
      // A fix from the last 5 minutes is plenty for sorting a day trip, and it
      // answers instantly instead of waking the GPS.
      { timeout: 8000, maximumAge: 300_000 },
    );
  }, []);

  const clearPos = useCallback(() => {
    setPos(null);
    setPosSource(null);
    setPosLabel(null);
    setRadius(null);
    clearSavedLocation(); // forget the device-local location too
  }, []);

  return (
    <div className={`explorer${view === 'map' ? ' is-map-view' : ''}${tripMode ? ' has-trip' : ''}`}>
      <FilterBar
        query={query} onQuery={setQuery} searchIndex={searchIndex}
        dateFilter={dateFilter} onDateFilter={setDateFilter}
        category={category} onCategory={setCategory}
        interestOptions={interestOptions} interests={interests} onInterests={setInterests}
        freeOnly={freeOnly} onFreeOnly={setFreeOnly}
        familyOnly={familyOnly} onFamilyOnly={setFamilyOnly}
        biggerOnly={biggerOnly} onBiggerOnly={setBiggerOnly}
        accessibleOnly={accessibleOnly} onAccessibleOnly={setAccessibleOnly}
        verifiedOnly={verifiedOnly} onVerifiedOnly={setVerifiedOnly}
        inOut={inOut} onInOut={setInOut}
        savedOnly={savedOnly} onSavedOnly={setSavedOnly} favCount={favCount}
        pos={pos} locating={locating} onLocate={locate} onClearPos={clearPos}
        geoError={geoError}
        radius={radius} onRadius={setRadius}
        tripMode={tripMode} onToggleTripMode={toggleTripMode}
        venuesOn={venuesOn} onVenuesOn={setVenuesOn}
        venueTypes={venueTypes} onToggleVenueType={toggleVenueType}
      />
      <div className="explorer-split">
        <section className="results-pane">
          {!query.trim() && <Recommendations recs={recs} hasPos={pos !== null} />}
          <ResultsList
            filtered={filtered}
            suggestions={suggestions}
            venues={filteredVenues}
            now={now}
            today={today}
            dateFilter={dateFilter}
            searching={searching}
            from={from}
            to={to}
            hasPos={pos !== null}
            // Query-free filter signature: typing must never re-animate the list
            // (search is already smooth via useDeferredValue); chip changes do.
            filterKey={`${dateFilter}|${category}|${freeOnly}|${familyOnly}|${biggerOnly}|${accessibleOnly}|${verifiedOnly}|${inOut}|${gemsFirst}|${savedOnly}|${radius}`}
            gemsFirst={gemsFirst}
            onGemsFirst={setGemsFirst}
            tripMode={tripMode}
            tripSlugs={tripSlugs}
            onToggleTrip={toggleTrip}
            onHoverSlug={setHoveredSlug}
            weather={weather}
            refinements={refinements}
          />
        </section>
        <aside className="map-pane" aria-label="Kort over markeder">
          <p className="sr-only">
            Kortet viser de samme markeder som listen ovenfor. Listen er fuldt
            tilgængelig uden kortet.
          </p>
          <MapView
            events={mapEvents}
            venues={filteredVenues}
            today={today}
            highlightSlug={hoveredSlug}
            tripMode={tripMode}
            tripSlugs={tripSlugs}
            tripRoute={tripRoute}
          onGeolocate={(p) => {
            setPos(p);
            setPosSource('gps');
            setPosLabel(null);
          }}
            onToggleTrip={toggleTrip}
            fullscreen={view === 'map'}
          />
        </aside>
      </div>
      <button
        className="view-pill"
        aria-pressed={view === 'map'}
        aria-label={view === 'list' ? 'Skift til kortvisning' : 'Skift til listevisning'}
        onClick={() => setView(view === 'list' ? 'map' : 'list')}
      >
        {view === 'list' ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
            <path d="M9 3 3.6 5.2a1 1 0 0 0-.6.9v13.4a.5.5 0 0 0 .7.5L9 18l6 3 5.4-2.2a1 1 0 0 0 .6-.9V4.5a.5.5 0 0 0-.7-.5L15 6 9 3Z" />
            <path d="M9 3v15M15 6v15" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        )}
        {view === 'list' ? 'Kort' : 'Liste'}
      </button>

      {tripMode && (
        <div className="trip-bar" role="region" aria-label="Loppetur">
          <span className="trip-count" aria-live="polite">
            {tripSlugs.length === 0 ? (
              'Vælg markeder og faste steder til din tur'
            ) : tripSlugs.length === 1 ? (
              '1 stop — vælg mindst 2'
            ) : (
              <>
                <strong>{tripSlugs.length}</strong> stop
                {tripSlugs.length >= MAX_TRIP_STOPS && ' (maks)'}
                {tripNotice && (
                  <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>
                    {' · '}
                    {tripNotice}
                  </span>
                )}
                {tripKm && tripKm.km > 0 && (
                  <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>
                    {' · '}~{Math.round(tripKm.km)} km {posLabel ? `fra ${posLabel}` : tripKm.label}
                  </span>
                )}
                {/* Rides the existing live region, so a screen reader is told
                    the order changed — the whole disclosure in one word. */}
                {tripUndo && (
                  <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>{' · '}sorteret</span>
                )}
              </>
            )}
          </span>
          {tripSlugs.length === 0 ? (
            <button
              className="trip-go"
              onClick={autoPlanTrip}
              title="Byg automatisk en loppetur ud fra de viste markeder — tættest på dig først"
            >
              ⚡ Planlæg for mig
            </button>
          ) : tripUrl ? (
            <a className="trip-go" href={tripUrl} target="_blank" rel="noopener noreferrer">
              Åbn rute i Google Maps
            </a>
          ) : (
            <button
              className="trip-go"
              disabled
              title="Vælg mindst 2 markeder med kendt placering for at lave en rute"
            >
              Åbn rute i Google Maps
            </button>
          )}
          {needsOrigin && (
            <div className="trip-ask" role="group" aria-label="Startpunkt">
              <span className="trip-ask-q">Hvor starter I fra?</span>
              <button className="trip-go" onClick={locate} disabled={locating}>
                {locating ? 'Finder…' : 'Brug min placering'}
              </button>
              <button className="trip-clear" onClick={() => setPickerOpen((v) => !v)}>
                Vælg by
              </button>
              <button
                className="trip-clear"
                onClick={() => {
                  setOriginDismissed(true);
                  setOriginAsked(false);
                  setPickerOpen(false);
                }}
              >
                Spring over
              </button>
              <span className="trip-ask-note">
                {geoError ?? 'Bruges kun til at sortere stoppene. Gemmes kun på din enhed.'}
              </span>
              {pickerOpen && (
                <div className="trip-picker">
                  <input
                    type="search"
                    className="search-box"
                    value={cityQuery}
                    onChange={(e) => setCityQuery(e.target.value)}
                    placeholder="Skriv en by — fx Sønderborg"
                    aria-label="Søg efter en by at starte fra"
                  />
                  <ul className="trip-picker-list">
                    {citySuggestions.length === 0 ? (
                      <li className="trip-picker-empty">
                        {gazetteer.length === 0 ? 'Henter byer…' : 'Ingen by matcher'}
                      </li>
                    ) : (
                      citySuggestions.map((c) => (
                        <li key={`${c.label}-${c.lat}`}>
                          <button
                            type="button"
                            className="trip-picker-city"
                            onClick={() => {
                              setPos({ lat: c.lat, lng: c.lng });
                              // 'by', never 'gps': a town chosen for one trip is
                              // a start point, not this device's home.
                              setPosSource('by');
                              setPosLabel(c.label);
                              setPickerOpen(false);
                              setCityQuery('');
                            }}
                          >
                            {c.label}
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}
          {/* Reordering is an act the user performs, never one that happens to
              them. The km figure moves in front of them when they tap it — the
              number that used to launder a silent reorder now prices it. */}
          {tripSlugs.length >= 2 &&
            (tripUndo ? (
              <button className="trip-clear" onClick={undoOptimize}>
                Fortryd sortering
              </button>
            ) : (
              <button
                className="trip-clear"
                onClick={optimizeTrip}
                title={
                  pos
                    ? 'Sorterer stoppene til den korteste køretur fra din placering'
                    : 'Vi ved ikke hvor du starter fra — tryk for at oplyse det'
                }
              >
                {pos && firstLegKm !== null && firstLegKm > FAR_FIRST_LEG_KM
                  ? `Stop 1 er ${Math.round(firstLegKm)} km væk — sortér efter afstand`
                  : 'Optimér rækkefølgen'}
              </button>
            ))}
          {tripSlugs.length >= 2 && (
            // Share the LOPPEFUND trip, not just the Google route — the link
            // recreates the whole plan for the rest of the family.
            <ShareButton
              title="Vores loppetur"
              path={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/${explorerQuery ? `?${explorerQuery}` : ''}`}
              label="Del turen"
            />
          )}
          {tripSlugs.length > 0 && (
            <button
              className="trip-clear"
              onClick={() => {
                setTripSlugs([]);
                setTripUndo(null);
                setTripNotice(null);
              }}
            >
              Ryd
            </button>
          )}
        </div>
      )}
    </div>
  );
}
