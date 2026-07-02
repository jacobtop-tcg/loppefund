'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import type { EventSummary } from '../lib/data.ts';
import { EventCard } from './EventCard.tsx';
import { addDaysIso, distanceKm, foldForSearch } from '../lib/client-utils.ts';

const MapView = dynamic(() => import('./MapView.tsx').then((m) => m.MapView), {
  ssr: false,
  loading: () => <div className="map-shell" style={{ display: 'grid', placeItems: 'center', color: 'var(--ink-faint)' }}>Indlæser kort…</div>,
});

type DateFilter = 'idag' | 'weekend' | 'naeste-weekend' | 'alle';

const DATE_CHIPS: Array<{ key: DateFilter; label: string }> = [
  { key: 'idag', label: 'I dag' },
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

function weekdayOfIso(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** [from, to] inclusive for each date filter. Weekend = Sat+Sun (or rest of it). */
function dateRangeFor(filter: DateFilter, today: string): [string, string] {
  if (filter === 'idag') return [today, today];
  if (filter === 'alle') return [today, addDaysIso(today, 120)];
  const wd = weekdayOfIso(today);
  const daysToSaturday = (6 - wd + 7) % 7;
  const saturday = addDaysIso(today, daysToSaturday);
  const sunday = wd === 7 ? today : addDaysIso(saturday, 1);
  const start = wd >= 6 ? today : saturday;
  if (filter === 'weekend') return [start, sunday];
  return [addDaysIso(saturday, wd === 7 ? 6 : 7), addDaysIso(sunday, wd === 7 ? 6 : 7)];
}

export function Explorer({ events, today }: { events: EventSummary[]; today: string }) {
  const [dateFilter, setDateFilter] = useState<DateFilter>('weekend');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [freeOnly, setFreeOnly] = useState(false);
  const [inOut, setInOut] = useState<'indoor' | 'outdoor' | null>(null);
  const [view, setView] = useState<'list' | 'map'>('list');
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);

  const [from, to] = dateRangeFor(dateFilter, today);

  const filtered = useMemo(() => {
    const q = foldForSearch(query.trim());
    const result: Array<EventSummary & { nextDate: string; distanceKm: number | null }> = [];
    for (const e of events) {
      const inRange = e.occurrences.filter((o) => o.date >= from && o.date <= to);
      if (inRange.length === 0) continue;
      if (category && e.category !== category) continue;
      if (freeOnly && e.isFree !== true) continue;
      if (inOut && e.indoorOutdoor !== inOut && e.indoorOutdoor !== 'mixed') continue;
      if (q) {
        const haystack = foldForSearch(
          `${e.title} ${e.city ?? ''} ${e.venueName ?? ''} ${e.municipality ?? ''} ${e.postcode ?? ''}`,
        );
        if (!haystack.includes(q)) continue;
      }
      const d =
        pos && e.lat != null && e.lng != null
          ? distanceKm(pos.lat, pos.lng, e.lat, e.lng)
          : null;
      result.push({ ...e, nextDate: inRange[0]!.date, distanceKm: d });
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
    if (pos) {
      result.sort((a, b) => {
        if (a.distanceKm === null || b.distanceKm === null) return 0;
        return a.distanceKm - b.distanceKm;
      });
    }
    return result;
  }, [events, from, to, query, category, freeOnly, inOut, pos]);

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
          <button className={`chip ${freeOnly ? 'active' : ''}`} onClick={() => setFreeOnly(!freeOnly)}>
            Gratis entré
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
          <button className={`chip accent ${pos ? 'active' : ''}`} onClick={() => (pos ? setPos(null) : locate())}>
            {locating ? 'Finder dig…' : pos ? '✓ Nær mig' : '◎ Nær mig'}
          </button>
        </div>
      </div>

      <div className="result-meta">
        <span className="result-count">
          <strong>{filtered.length}</strong>{' '}
          {filtered.length === 1 ? 'marked' : 'markeder'}
          {dateFilter === 'weekend' && ' i weekenden'}
          {dateFilter === 'idag' && ' i dag'}
          {dateFilter === 'naeste-weekend' && ' næste weekend'}
        </span>
      </div>

      {view === 'map' ? (
        <MapView events={filtered} />
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <h2>Ingen markeder fundet</h2>
          <p>Prøv en anden dato eller fjern et filter — der kommer hele tiden nye markeder til.</p>
        </div>
      ) : (
        <div className="event-grid">
          {filtered.map((e, i) => (
            <EventCard key={e.slug} event={e} today={today} index={i} />
          ))}
        </div>
      )}
    </>
  );
}
