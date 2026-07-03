'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { copenhagenNow, isOpenAt, type CphNow } from '@loppefund/core';
import type { EventSummary } from '../lib/data.ts';
import { useFavorites } from '../lib/favorites.ts';
import { FilterBar, type DateFilter } from './FilterBar.tsx';
import { ResultsList } from './ResultsList.tsx';
import {
  addDaysIso,
  buildTripUrl,
  distanceKm,
  foldForSearch,
  MAX_TRIP_STOPS,
  optimizeTripOrder,
  parseExplorerParams,
  serializeExplorerParams,
  tripDistanceKm,
} from '../lib/client-utils.ts';

const MapView = dynamic(() => import('./MapView.tsx').then((m) => m.MapView), {
  ssr: false,
  loading: () => <div className="map-shell" style={{ display: 'grid', placeItems: 'center', color: 'var(--ink-faint)' }}>Indlæser kort…</div>,
});

function weekdayOfIso(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** [from, to] inclusive for each date filter. Weekend = Sat+Sun (or rest of it). */
function dateRangeFor(filter: DateFilter, today: string): [string, string] {
  if (filter === 'idag' || filter === 'aabent-nu') return [today, today];
  if (filter === 'imorgen') {
    const tomorrow = addDaysIso(today, 1);
    return [tomorrow, tomorrow];
  }
  if (filter === 'alle') return [today, addDaysIso(today, 120)];
  const wd = weekdayOfIso(today);
  // This weekend's Saturday and Sunday. On Sunday the Saturday is yesterday.
  const thisSat = wd === 7 ? addDaysIso(today, -1) : addDaysIso(today, (6 - wd + 7) % 7);
  const thisSun = addDaysIso(thisSat, 1);
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
  const { favorites, count: favCount } = useFavorites();

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
    setHydrated(true);
  }, []);

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

  const filtered = useMemo(() => {
    const q = foldForSearch(query.trim());
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
        if (!haystack.includes(q)) continue;
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
  }, [events, from, to, query, category, freeOnly, familyOnly, inOut, pos, radius, dateFilter, now, gemsFirst, savedOnly, favorites]);

  // The empty state must always help onward: when filters yield nothing,
  // relax date/radius (keep category & search) and suggest the nearest
  // upcoming alternatives instead of a dead end.
  const suggestions = useMemo(() => {
    if (filtered.length > 0) return [];
    const q = foldForSearch(query.trim());
    const horizon = addDaysIso(today, 45);
    const alt: Array<EventSummary & { nextDate: string; distanceKm: number | null; openNow: boolean }> = [];
    for (const e of events) {
      const upcoming = e.occurrences.filter((o) => o.date >= today && o.date <= horizon);
      if (upcoming.length === 0) continue;
      if (category && e.category !== category) continue;
      if (q) {
        const haystack =
          foldForSearch(`${e.title} ${e.city ?? ''} ${e.venueName ?? ''} ${e.municipality ?? ''}`) +
          ` ${e.searchText}`;
        if (!haystack.includes(q)) continue;
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
  }, [filtered.length, events, today, query, category, pos]);

  // The map never goes blank: when filters yield nothing it shows the same
  // three suggestions the empty state offers as list cards.
  const mapEvents = filtered.length > 0 ? filtered : suggestions;

  // Trip selection is keyed by slug against the full list, so filter changes
  // never drop chosen stops.
  const eventsBySlug = useMemo(() => new Map(events.map((e) => [e.slug, e])), [events]);
  const tripStops = tripSlugs
    .map((s) => eventsBySlug.get(s))
    .filter((e): e is EventSummary => !!e && e.lat != null && e.lng != null);
  // Order the stops into an efficient drive — from the user's location when we
  // have it — instead of the arbitrary order they were tapped, then hand Google
  // Maps the sane sequence (its URL API won't re-optimise waypoints itself).
  // The total distance is an honest "is this weekend worth the drive?" scent.
  const orderedTrip = optimizeTripOrder(
    tripStops.map((e) => ({ lat: e.lat!, lng: e.lng! })),
    pos,
  );
  const tripUrl = buildTripUrl(orderedTrip);
  const tripKm = tripDistanceKm(orderedTrip, pos);

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
      setGeoError('Kunne ikke finde din placering');
      return;
    }
    setLocating(true);
    setGeoError(null); // clear any prior error when re-attempting
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
        setLocating(false);
      },
      () => {
        setLocating(false);
        setGeoError('Kunne ikke finde din placering');
      },
      { timeout: 8000 },
    );
  }, []);

  const clearPos = useCallback(() => {
    setPos(null);
    setRadius(null);
  }, []);

  return (
    <div className={`explorer${view === 'map' ? ' is-map-view' : ''}${tripMode ? ' has-trip' : ''}`}>
      <FilterBar
        query={query} onQuery={setQuery}
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
      />
      <div className="explorer-split">
        <section className="results-pane">
          <ResultsList
            filtered={filtered}
            suggestions={suggestions}
            today={today}
            dateFilter={dateFilter}
            hasPos={pos !== null}
            gemsFirst={gemsFirst}
            onGemsFirst={setGemsFirst}
            tripMode={tripMode}
            tripSlugs={tripSlugs}
            onToggleTrip={toggleTrip}
            onHoverSlug={setHoveredSlug}
          />
        </section>
        <aside className="map-pane" aria-label="Kort over markeder">
          <MapView
            events={mapEvents}
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
              'Vælg markeder til din tur'
            ) : tripSlugs.length === 1 ? (
              '1 stop — vælg mindst 2'
            ) : (
              <>
                <strong>{tripSlugs.length}</strong> stop
                {tripSlugs.length >= MAX_TRIP_STOPS && ' (maks)'}
                {tripKm > 0 && (
                  <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>
                    {' · '}~{Math.round(tripKm)} km{pos ? ' fra dig' : ''}
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
            <button className="trip-go" disabled>
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
