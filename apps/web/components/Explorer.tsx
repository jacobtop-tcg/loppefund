'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { copenhagenNow, isOpenAt, type CphNow } from '@loppefund/core';
import type { EventSummary, VenueSummary } from '../lib/data.ts';
import { useFavorites } from '../lib/favorites.ts';
import { venueOpenState, VENUE_TYPES, type VenueType } from '../lib/venue-client.ts';
import { buildSearchIndex } from '../lib/search-index.ts';
import { useOutdoorWeather } from '../lib/weather.ts';
import { FilterBar, type DateFilter } from './FilterBar.tsx';
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
  serializeExplorerParams,
  tripDistanceKm,
  weekendDates,
} from '../lib/client-utils.ts';

const MapView = dynamic(() => import('./MapView.tsx').then((m) => m.MapView), {
  ssr: false,
  loading: () => <MapSkeleton className="map-shell" />,
});

/** [from, to] inclusive for each date filter. Weekend = Sat+Sun (or rest of it). */
function dateRangeFor(filter: DateFilter, today: string): [string, string] {
  if (filter === 'idag' || filter === 'aabent-nu') return [today, today];
  if (filter === 'imorgen') {
    const tomorrow = addDaysIso(today, 1);
    return [tomorrow, tomorrow];
  }
  if (filter === 'alle') return [today, addDaysIso(today, 120)];
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
  const [freeOnly, setFreeOnly] = useState(false);
  const [familyOnly, setFamilyOnly] = useState(false);
  const [inOut, setInOut] = useState<'indoor' | 'outdoor' | null>(null);
  const [view, setView] = useState<'list' | 'map'>('list');
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [radius, setRadius] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [now, setNow] = useState<CphNow>(initialNow);
  const [gemsFirst, setGemsFirst] = useState(false);
  const [tripMode, setTripMode] = useState(false);
  const [tripSlugs, setTripSlugs] = useState<string[]>([]); // insertion order = route order
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

  useEffect(() => {
    if (!venuesOn || venuesLoaded) return;
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
  }, [venuesOn, venuesLoaded]);

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
    setInOut(parsed.inOut);
    setSavedOnly(parsed.savedOnly);
    setGemsFirst(parsed.gemsFirst);
    setView(parsed.view);
    // Land a returning visitor back in their own area (device-local, never a
    // URL). A shared link (which carries no location) never triggers this,
    // because its owner's browser has nothing saved.
    const savedLoc = readSavedLocation();
    if (savedLoc) {
      setPos({ lat: savedLoc.lat, lng: savedLoc.lng });
      if (savedLoc.radius !== null) setRadius(savedLoc.radius);
    }
    setHydrated(true);
  }, []);

  // Remember the location on this device whenever it changes, so the next visit
  // restores it. Only persists a real position; clearing is handled in clearPos.
  useEffect(() => {
    if (!hydrated || !pos) return;
    writeSavedLocation({ lat: pos.lat, lng: pos.lng, radius });
  }, [hydrated, pos, radius]);

  // On any relevant filter change, keep the URL in sync via replaceState so
  // refresh/back restore state without polluting history. SSR-guarded.
  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return;
    const qs = serializeExplorerParams({
      dateFilter,
      category,
      query,
      freeOnly,
      familyOnly,
      inOut,
      savedOnly,
      gemsFirst,
      view,
    });
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, '', url);
  }, [hydrated, dateFilter, category, query, freeOnly, familyOnly, inOut, savedOnly, gemsFirst, view]);

  const [from, to] = dateRangeFor(dateFilter, today);

  // Autocomplete index (cities + market/venue names), built once from the data.
  const searchIndex = useMemo(() => buildSearchIndex(events, venues), [events, venues]);

  // Typing stays instant (the input reads `query`), while the expensive filter
  // passes over ~700 events + ~1100 venues run against a deferred value — React
  // keeps the last result on screen and recomputes off the critical path.
  const deferredQuery = useDeferredValue(query);

  const filtered = useMemo(() => {
    const q = foldForSearch(deferredQuery.trim());
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
      if (freeOnly && e.isFree !== true) continue;
      if (familyOnly && !e.familyFriendly) continue;
      if (inOut && e.indoorOutdoor !== inOut && e.indoorOutdoor !== 'mixed') continue;
      if (q) {
        const haystack =
          foldForSearch(
            `${e.title} ${e.city ?? ''} ${e.venueName ?? ''} ${e.municipality ?? ''} ${e.postcode ?? ''}`,
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
  }, [events, from, to, deferredQuery, category, freeOnly, familyOnly, inOut, pos, radius, dateFilter, now, gemsFirst, savedOnly, favorites]);

  // The permanent-venue layer, filtered in parallel with events (venues have no
  // dates, so the date chips don't apply — except "Åbent nu", which narrows them
  // to shops open right now). Respects type toggles, search and location.
  const filteredVenues = useMemo(() => {
    if (!venuesOn) return [];
    const q = foldForSearch(deferredQuery.trim());
    const onlyOpen = dateFilter === 'aabent-nu';
    const result: Array<VenueSummary & { distanceKm: number | null; open: boolean }> = [];
    for (const v of venues) {
      if (!venueTypes.has(v.category as VenueType)) continue;
      const st = venueOpenState(v.openingHoursText, now);
      if (onlyOpen && !st.open) continue;
      if (q) {
        const hay =
          foldForSearch(`${v.title} ${v.city ?? ''} ${v.street ?? ''}`) + ` ${v.searchText}`;
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
    () => recommend(events, pos, today, { distanceKm, limit: 4 }),
    [events, pos, today],
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
    const q = foldForSearch(deferredQuery.trim());
    const horizon = addDaysIso(today, 45);
    const alt: Array<EventSummary & { nextDate: string; distanceKm: number | null; openNow: boolean }> = [];
    for (const e of events) {
      const upcoming = e.occurrences.filter((o) => o.date >= today && o.date <= horizon);
      if (upcoming.length === 0) continue;
      if (category && e.category !== category) continue;
      if (freeOnly && e.isFree !== true) continue;
      if (familyOnly && !e.familyFriendly) continue;
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
  }, [filtered.length, events, today, deferredQuery, category, freeOnly, familyOnly, inOut, savedOnly, pos]);

  // Echo the active refinements next to the result count, so the number always
  // has context ("12 markeder i weekenden · gratis · inden 25 km · »odense«").
  // Date filter is already spelled out by ResultsList; these are the extras.
  const refinements = useMemo(() => {
    const r: string[] = [];
    if (freeOnly) r.push('gratis');
    if (familyOnly) r.push('børnevenlige');
    if (inOut === 'indoor') r.push('indendørs');
    else if (inOut === 'outdoor') r.push('udendørs');
    if (savedOnly) r.push('gemte');
    if (pos && radius !== null) r.push(`inden ${radius} km`);
    else if (pos) r.push('nær dig');
    const q = query.trim();
    if (q) r.push(`»${q}«`);
    return r;
  }, [freeOnly, familyOnly, inOut, savedOnly, pos, radius, query]);

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
  // Order the stops into an efficient drive — from the user's location when we
  // have it — instead of the arbitrary order they were tapped, then hand Google
  // Maps the sane sequence (its URL API won't re-optimise waypoints itself).
  // The total distance is an honest "is this weekend worth the drive?" scent.
  // Memoised on the selection + location so it doesn't recompute on every hover
  // or the 60s clock tick (which re-render this component with the same trip).
  const { tripUrl, tripKm } = useMemo(() => {
    const stops = tripSlugs
      .map(coordForStop)
      .filter((c): c is { lat: number; lng: number } => c !== null);
    const ordered = optimizeTripOrder(stops, pos);
    return { tripUrl: buildTripUrl(ordered), tripKm: tripDistanceKm(ordered, pos) };
  }, [tripSlugs, coordForStop, pos]);

  // Handlers passed to the memoized FilterBar/ResultsList must be referentially
  // stable, or every hoveredSlug change re-renders 600+ cards.
  const toggleTrip = useCallback((slug: string) => {
    setTripSlugs((prev) =>
      prev.includes(slug)
        ? prev.filter((x) => x !== slug)
        : prev.length >= MAX_TRIP_STOPS
          ? prev
          : [...prev, slug],
    );
  }, []);

  const exitTrip = useCallback(() => {
    setTripMode(false);
    setTripSlugs([]);
  }, []);

  const toggleTripMode = useCallback(
    () => (tripMode ? exitTrip() : setTripMode(true)),
    [tripMode, exitTrip],
  );

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setGeoError('Din browser deler ikke placering — søg på en by i stedet.');
      return;
    }
    setLocating(true);
    setGeoError(null); // clear any prior error when re-attempting
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
        setLocating(false);
        setGeoError(null); // a later success must wipe an earlier failure
      },
      () => {
        setLocating(false);
        setGeoError('Kunne ikke hente din placering — tjek tilladelser, eller søg på en by.');
      },
      { timeout: 8000 },
    );
  }, []);

  const clearPos = useCallback(() => {
    setPos(null);
    setRadius(null);
    clearSavedLocation(); // forget the device-local location too
  }, []);

  return (
    <div className={`explorer${view === 'map' ? ' is-map-view' : ''}${tripMode ? ' has-trip' : ''}`}>
      <FilterBar
        query={query} onQuery={setQuery} searchIndex={searchIndex}
        dateFilter={dateFilter} onDateFilter={setDateFilter}
        category={category} onCategory={setCategory}
        freeOnly={freeOnly} onFreeOnly={setFreeOnly}
        familyOnly={familyOnly} onFamilyOnly={setFamilyOnly}
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
            hasPos={pos !== null}
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
          <span className="trip-count">
            {tripSlugs.length === 0 ? (
              'Vælg markeder og faste steder til din tur'
            ) : tripSlugs.length === 1 ? (
              '1 stop — vælg mindst 2'
            ) : (
              <>
                <strong>{tripSlugs.length}</strong> stop
                {tripSlugs.length >= MAX_TRIP_STOPS && ' (maks)'}
                {tripKm > 0 && (
                  <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>
                    {' · '}~{Math.round(tripKm)} km i fugleflugt
                  </span>
                )}
              </>
            )}
          </span>
          {tripUrl ? (
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
          {tripSlugs.length > 0 && (
            <button className="trip-clear" onClick={() => setTripSlugs([])}>
              Ryd
            </button>
          )}
        </div>
      )}
    </div>
  );
}
