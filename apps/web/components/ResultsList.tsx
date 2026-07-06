'use client';

import { memo } from 'react';
import type { EventSummary, VenueSummary } from '../lib/data.ts';
import { EventCard } from './EventCard.tsx';
import { VenueCard } from './VenueCard.tsx';
import { GemIcon } from './icons.tsx';
import type { DateFilter } from './FilterBar.tsx';
import type { DayWeather } from '../lib/weather.ts';

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
  hasPos,
  gemsFirst,
  onGemsFirst,
  tripMode,
  tripSlugs,
  onToggleTrip,
  onHoverSlug,
  weather,
  refinements = [],
}: {
  filtered: Row[];
  suggestions: Row[];
  venues: VenueRow[];
  now: { date: string; time: string };
  today: string;
  dateFilter: DateFilter;
  hasPos: boolean;
  gemsFirst: boolean;
  onGemsFirst: (v: boolean) => void;
  tripMode: boolean;
  tripSlugs: string[];
  onToggleTrip: (slug: string) => void;
  onHoverSlug: (slug: string | null) => void;
  weather: Map<string, DayWeather>;
  refinements?: string[];
}) {
  return (
    <>
      <div className="result-meta">
        <span className="result-count" aria-live="polite">
          <strong>{filtered.length}</strong>{' '}
          {filtered.length === 1 ? 'marked' : 'markeder'}
          {dateFilter === 'weekend' && ' i weekenden'}
          {dateFilter === 'idag' && ' i dag'}
          {dateFilter === 'imorgen' && ' i morgen'}
          {dateFilter === 'aabent-nu' &&
            (filtered.length === 1 ? ' åbent lige nu' : ' åbne lige nu')}
          {dateFilter === 'naeste-weekend' && ' næste weekend'}
          {refinements.length > 0 && (
            <span className="result-refinements"> · {refinements.join(' · ')}</span>
          )}
        </span>
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
              weather={weather.get(e.slug)}
              tripMode={tripMode}
              selected={tripSlugs.includes(e.slug)}
              onToggleTrip={onToggleTrip}
              onHoverChange={onHoverSlug}
            />
          ))}
        </div>
      )}

      {venues.length > 0 && (
        <section className="venue-section" aria-label="Faste steder">
          <div className="venue-section-head">
            <h2 className="reco-title">Faste steder</h2>
            <span className="venue-count">
              <strong>{venues.length}</strong> genbrug, antik &amp; loppebutikker
            </span>
          </div>
          <div className="event-grid">
            {venues.slice(0, VENUE_CAP).map((v, i) => (
              <VenueCard key={v.slug} venue={v} now={now} index={i} />
            ))}
          </div>
          {venues.length > VENUE_CAP && (
            <p className="venue-more">
              Viser {VENUE_CAP} af {venues.length}. Søg eller vælg et område (Nær mig) for at
              indsnævre — eller zoom ind på kortet.
            </p>
          )}
        </section>
      )}
    </>
  );
});
