'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { copenhagenNow, isOpenAt, type CphNow } from '@loppefund/core';
import type { EventSummary } from '../lib/data.ts';
import { useFavorites } from '../lib/favorites.ts';
import { EventCard } from './EventCard.tsx';
import {
  addDaysIso,
  buildTripUrl,
  distanceKm,
  foldForSearch,
  MAX_TRIP_STOPS,
} from '../lib/client-utils.ts';

const MapView = dynamic(() => import('./MapView.tsx').then((m) => m.MapView), {
  ssr: false,
  loading: () => <div className="map-shell" style={{ display: 'grid', placeItems: 'center', color: 'var(--ink-faint)' }}>Indlæser kort…</div>,
});

type DateFilter = 'aabent-nu' | 'idag' | 'imorgen' | 'weekend' | 'naeste-weekend' | 'alle';

const DATE_CHIPS: Array<{ key: DateFilter; label: string }> = [
  { key: 'aabent-nu', label: 'Åbent nu' },
  { key: 'idag', label: 'I dag' },
  { key: 'imorgen', label: 'I morgen' },
  { key: 'weekend', label: 'I weekenden' },
  { key: 'naeste-weekend', label: 'Næste weekend' },
  { key: 'alle', label: 'Alle datoer' },
];

const CATEGORY_CHIPS: Array<{ key: string; label: string }> = [
  { key: 'loppemarked', label: 'Loppemarked' },
  { key: 'kraemmermarked', label: 'Kræmmer' },
  { key: 'bagagerumsmarked', label: 'Bagagerum' },
  { key: 'antikmarked', label: 'Antik' },
];

const RADIUS_CHIPS = [10, 25, 50] as const;

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
  today,
  now: initialNow,
}: {
  events: EventSummary[];
  today: string;
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
  const [now, setNow] = useState<CphNow>(initialNow);
  const [gemsFirst, setGemsFirst] = useState(false);
  const [tripMode, setTripMode] = useState(false);
  const [tripSlugs, setTripSlugs] = useState<string[]>([]); // insertion order = route order
  const [savedOnly, setSavedOnly] = useState(false);
  const { favorites, count: favCount } = useFavorites();

  // Live clock only while the "Åbent nu" filter is active.
  useEffect(() => {
    if (dateFilter !== 'aabent-nu') return;
    setNow(copenhagenNow());
    const id = setInterval(() => setNow(copenhagenNow()), 30_000);
    return () => clearInterval(id);
  }, [dateFilter]);

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

  // Trip selection is keyed by slug against the full list, so filter changes
  // never drop chosen stops.
  const eventsBySlug = useMemo(() => new Map(events.map((e) => [e.slug, e])), [events]);
  const tripStops = tripSlugs
    .map((s) => eventsBySlug.get(s))
    .filter((e): e is EventSummary => !!e && e.lat != null && e.lng != null);
  const tripUrl = buildTripUrl(tripStops.map((e) => ({ lat: e.lat!, lng: e.lng! })));

  function toggleTrip(slug: string) {
    setTripSlugs((prev) =>
      prev.includes(slug)
        ? prev.filter((x) => x !== slug)
        : prev.length >= MAX_TRIP_STOPS
          ? prev
          : [...prev, slug],
    );
  }

  function exitTrip() {
    setTripMode(false);
    setTripSlugs([]);
  }

  function locate() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
        setLocating(false);
      },
      () => setLocating(false),
      { timeout: 8000 },
    );
  }

  return (
    <>
      <div className="controls">
        <div className="search-row">
          <label className="search-box">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              placeholder="Søg marked, by eller sted…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Søg"
            />
          </label>
          <div className="view-toggle" role="tablist" aria-label="Visning">
            <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
              Liste
            </button>
            <button className={view === 'map' ? 'active' : ''} onClick={() => setView('map')}>
              Kort
            </button>
          </div>
        </div>
        <div className="chip-row">
          {DATE_CHIPS.map((c) => (
            <button
              key={c.key}
              className={`chip ${dateFilter === c.key ? 'active' : ''}`}
              onClick={() => setDateFilter(c.key)}
            >
              {c.key === 'aabent-nu' && <span className="live-dot" aria-hidden />}
              {c.label}
            </button>
          ))}
          <span className="chip-sep" aria-hidden />
          {CATEGORY_CHIPS.map((c) => (
            <button
              key={c.key}
              className={`chip ${category === c.key ? 'active' : ''}`}
              onClick={() => setCategory(category === c.key ? null : c.key)}
            >
              {c.label}
            </button>
          ))}
          <span className="chip-sep" aria-hidden />
          {favCount > 0 && (
            <button
              className={`chip accent ${savedOnly ? 'active' : ''}`}
              onClick={() => setSavedOnly(!savedOnly)}
            >
              ♥ Gemte ({favCount})
            </button>
          )}
          <button className={`chip ${freeOnly ? 'active' : ''}`} onClick={() => setFreeOnly(!freeOnly)}>
            Gratis entré
          </button>
          <button className={`chip ${familyOnly ? 'active' : ''}`} onClick={() => setFamilyOnly(!familyOnly)}>
            Børnevenligt
          </button>
          <button
            className={`chip ${inOut === 'indoor' ? 'active' : ''}`}
            onClick={() => setInOut(inOut === 'indoor' ? null : 'indoor')}
          >
            Indendørs
          </button>
          <button
            className={`chip ${inOut === 'outdoor' ? 'active' : ''}`}
            onClick={() => setInOut(inOut === 'outdoor' ? null : 'outdoor')}
          >
            Udendørs
          </button>
          <span className="chip-sep" aria-hidden />
          <button
            className={`chip accent ${pos ? 'active' : ''}`}
            onClick={() => (pos ? (setPos(null), setRadius(null)) : locate())}
          >
            {locating ? 'Finder dig…' : pos ? '✓ Nær mig' : '◎ Nær mig'}
          </button>
          {pos &&
            RADIUS_CHIPS.map((r) => (
              <button
                key={r}
                className={`chip ${radius === r ? 'active' : ''}`}
                onClick={() => setRadius(radius === r ? null : r)}
              >
                {r} km
              </button>
            ))}
          <button
            className={`chip accent ${tripMode ? 'active' : ''}`}
            onClick={() => (tripMode ? exitTrip() : setTripMode(true))}
          >
            {tripMode ? '✓ Loppetur' : 'Lav en loppetur'}
          </button>
        </div>
      </div>

      <div className="result-meta">
        <span className="result-count">
          <strong>{filtered.length}</strong>{' '}
          {filtered.length === 1 ? 'marked' : 'markeder'}
          {dateFilter === 'weekend' && ' i weekenden'}
          {dateFilter === 'idag' && ' i dag'}
          {dateFilter === 'imorgen' && ' i morgen'}
          {dateFilter === 'aabent-nu' && ' åbne lige nu'}
          {dateFilter === 'naeste-weekend' && ' næste weekend'}
        </span>
        {view === 'list' && filtered.some((e) => e.gem) && (
          <button
            className={`sort-gems ${gemsFirst ? 'active' : ''}`}
            onClick={() => setGemsFirst(!gemsFirst)}
            aria-pressed={gemsFirst}
          >
            ✦ Perler først
          </button>
        )}
      </div>

      {view === 'map' ? (
        <MapView events={filtered} />
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <h2>Ingen markeder fundet lige her</h2>
          <p>
            {suggestions.length > 0
              ? pos
                ? 'Men de her er tættest på dig i de kommende uger:'
                : 'Men de her kommer snart:'
              : 'Prøv en anden dato eller fjern et filter — der kommer hele tiden nye markeder til.'}
          </p>
          {suggestions.length > 0 && (
            <div className="event-grid" style={{ textAlign: 'left', marginTop: 22 }}>
              {suggestions.map((e, i) => (
                <EventCard key={e.slug} event={e} today={today} index={i} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="event-grid">
          {filtered.map((e, i) => (
            <EventCard
              key={e.slug}
              event={e}
              today={today}
              index={i}
              openNow={e.openNow}
              tripMode={tripMode}
              selected={tripSlugs.includes(e.slug)}
              onToggleTrip={toggleTrip}
            />
          ))}
        </div>
      )}

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
    </>
  );
}
