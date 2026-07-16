'use client';

import { memo, useEffect, useRef } from 'react';
import Link from 'next/link';
import type { EventSummary, VenueSummary } from '../lib/data.ts';
import { EventCard } from './EventCard.tsx';
import { VenueCard } from './VenueCard.tsx';
import { GemIcon } from './icons.tsx';
import type { DateFilter } from './FilterBar.tsx';
import type { DayWeather } from '../lib/weather.ts';
import { dayOfMonth, monthLong } from '../lib/format.ts';

/** "11.–12. juli" / "12. juli" / "30. juni–1. juli" from an ISO range. */
function formatRange(from: string, to: string): string {
  if (from === to) return `${dayOfMonth(from)}. ${monthLong(from)}`;
  if (monthLong(from) === monthLong(to) && from.slice(0, 7) === to.slice(0, 7)) {
    return `${dayOfMonth(from)}.–${dayOfMonth(to)}. ${monthLong(to)}`;
  }
  return `${dayOfMonth(from)}. ${monthLong(from)}–${dayOfMonth(to)}. ${monthLong(to)}`;
}

/** The serif statement that NAMES the moment before counting it. */
function leadFor(dateFilter: DateFilter, from: string, to: string, searching = false): string {
  // A query spans every date (see Explorer), so the lead must not keep claiming
  // the date chip's window — "Weekenden 18.–19. juli" over search results for
  // "sønderborg" is simply false.
  if (searching) return 'Søgeresultater';
  switch (dateFilter) {
    case 'weekend':
      return `Weekenden ${formatRange(from, to)}`;
    case 'naeste-weekend':
      return `Næste weekend ${formatRange(from, to)}`;
    case 'idag':
      return 'I dag';
    case 'imorgen':
      return 'I morgen';
    case 'aabent-nu':
      return 'Åbent lige nu';
    default:
      return 'Kommende markeder';
  }
}

type Row = EventSummary & { nextDate: string; distanceKm: number | null; openNow: boolean };
type VenueRow = VenueSummary & { distanceKm: number | null; open: boolean };

// The permanent-venue list is capped so a national "show everything" toggle
// can't drop 1000 cards into the DOM; the map keeps all of them, and search /
// "Nær mig" narrows the list to what's relevant.
const VENUE_CAP = 48;

/**
 * The list pane: result meta + cards (or the always-helpful empty state).
 * Memoized — Explorer re-renders on every card hover (hoveredSlug) and this
 * list receives only stable props.
 */
export const ResultsList = memo(function ResultsList({
  filtered,
  suggestions,
  venues,
  now,
  today,
  dateFilter,
  from,
  to,
  hasPos,
  gemsFirst,
  onGemsFirst,
  tripMode,
  tripSlugs,
  onToggleTrip,
  onHoverSlug,
  weather,
  refinements = [],
  filterKey = '',
  searching = false,
}: {
  filtered: Row[];
  suggestions: Row[];
  venues: VenueRow[];
  now: { date: string; time: string };
  today: string;
  dateFilter: DateFilter;
  from: string;
  to: string;
  hasPos: boolean;
  gemsFirst: boolean;
  onGemsFirst: (v: boolean) => void;
  tripMode: boolean;
  tripSlugs: string[];
  onToggleTrip: (slug: string) => void;
  onHoverSlug: (slug: string | null) => void;
  weather: Map<string, DayWeather>;
  refinements?: string[];
  /** Query-free signature of the active filters — drives the list settle. */
  filterKey?: string;
  /** A search query is active, so results span every date, not the chip's window. */
  searching?: boolean;
}) {
  // Re-trigger the 180ms settle when the ANSWER changes (chip toggles), without
  // remounting cards — identity, hover-highlight and mount-stagger all survive.
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    el.classList.remove('is-settling');
    void el.offsetWidth; // reflow so the animation restarts
    el.classList.add('is-settling');
  }, [filterKey]);

  const venueSection = venues.length > 0 && (
    <section className="venue-section" aria-label="Faste steder">
      <div className="venue-section-head">
        <h2 className="reco-title">Faste steder</h2>
        <span className="venue-count">
          <strong>{venues.length}</strong> genbrug, antik &amp; loppebutikker
        </span>
      </div>
      <div className="event-grid">
        {venues.slice(0, VENUE_CAP).map((v, i) => (
          <VenueCard
            key={v.slug}
            venue={v}
            now={now}
            index={i}
            tripMode={tripMode}
            selected={tripSlugs.includes(`v:${v.slug}`)}
            tripIndex={tripSlugs.indexOf(`v:${v.slug}`) + 1 || undefined}
            onToggleTrip={onToggleTrip}
          />
        ))}
      </div>
      {venues.length > VENUE_CAP && (
        <p className="venue-more">
          Viser {VENUE_CAP} af {venues.length}. Søg eller vælg et område (Nær mig) for at
          indsnævre — eller zoom ind på kortet.
        </p>
      )}
    </section>
  );

  return (
    <>
      <div className="result-meta">
        <div className="result-head">
          {/* keyed on dateFilter so the lead softly re-enters when the answer changes */}
          <p className="result-lead" key={searching ? 'search' : dateFilter}>
            {leadFor(dateFilter, from, to, searching)}
          </p>
          {/* The count must describe EVERYTHING found. It used to say "0 markeder"
              while twenty shops rendered right below it — the headline number the
              eye trusts, denying data that was on screen. Shops are counted as
              first-class results, not a footnote. */}
          <p className="result-count" aria-live="polite">
            <strong>{filtered.length}</strong>{' '}
            {filtered.length === 1 ? 'marked' : 'markeder'}
            {venues.length > 0 && (
              <>
                {' · '}
                <strong>{venues.length}</strong>{' '}
                {venues.length === 1 ? 'fast sted' : 'faste steder'}
              </>
            )}
            {refinements.length > 0 && (
              <span className="result-refinements"> · {refinements.join(' · ')}</span>
            )}
          </p>
        </div>
        {filtered.some((e) => e.gem) && (
          <button
            className={`sort-gems ${gemsFirst ? 'active' : ''}`}
            onClick={() => onGemsFirst(!gemsFirst)}
            aria-pressed={gemsFirst}
          >
            <GemIcon /> Perler først
          </button>
        )}
      </div>

      {/* When the search found SHOPS but no markets ("loppe bazar"), the hits
          must greet the visitor first — not hide below a full-height "no
          markets" illustration they may never scroll past. */}
      {filtered.length === 0 && venueSection}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <svg className="empty-illu" width="112" height="112" viewBox="0 0 96 96" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {/* A little market stall with a striped awning — on-brand, warmer
                than a generic "no results" glyph. */}
            <path d="M20 40h56v34a2 2 0 0 1-2 2H22a2 2 0 0 1-2-2V40Z" />
            <path d="M14 40l6-14h56l6 14" />
            <path d="M20 40c0 3.4 2.7 6 6 6s6-2.6 6-6c0 3.4 2.7 6 6 6s6-2.6 6-6c0 3.4 2.7 6 6 6s6-2.6 6-6c0 3.4 2.7 6 6 6s6-2.6 6-6c0 3.4 2.7 6 6 6s6-2.6 6-6" />
            <path d="M38 76V58a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v18" />
          </svg>
          <h2>Ingen markeder fundet lige her</h2>
          <p>
            {suggestions.length > 0
              ? hasPos
                ? 'Men de her er tættest på dig i de kommende uger:'
                : 'Men de her kommer snart:'
              : 'Prøv en anden dato eller fjern et filter — der kommer hele tiden nye markeder til.'}
          </p>
          {suggestions.length > 0 && (
            <div className="event-grid" style={{ textAlign: 'left', marginTop: 22 }}>
              {suggestions.map((e, i) => (
                <EventCard key={e.slug} event={e} today={today} index={i} onHoverChange={onHoverSlug} />
              ))}
            </div>
          )}
          <p className="empty-tip">
            Mangler der et marked?{' '}
            <Link href="/tip">Tip os, så tilføjer vi det →</Link>
          </p>
        </div>
      ) : (
        <div className="event-grid" ref={gridRef}>
          {filtered.map((e, i) => (
            <EventCard
              key={e.slug}
              event={e}
              today={today}
              index={i}
              openNow={e.openNow}
              weather={weather.get(e.slug)}
              tripMode={tripMode}
              selected={tripSlugs.includes(`e:${e.slug}`)}
              tripIndex={tripSlugs.indexOf(`e:${e.slug}`) + 1 || undefined}
              onToggleTrip={onToggleTrip}
              onHoverChange={onHoverSlug}
            />
          ))}
        </div>
      )}

      {filtered.length > 0 && venueSection}
    </>
  );
});
