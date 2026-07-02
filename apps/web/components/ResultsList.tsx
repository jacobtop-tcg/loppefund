'use client';

import { memo } from 'react';
import type { EventSummary } from '../lib/data.ts';
import { EventCard } from './EventCard.tsx';
import type { DateFilter } from './FilterBar.tsx';

type Row = EventSummary & { nextDate: string; distanceKm: number | null; openNow: boolean };

/**
 * The list pane: result meta + cards (or the always-helpful empty state).
 * Memoized — Explorer re-renders on every card hover (hoveredSlug) and this
 * list receives only stable props.
 */
export const ResultsList = memo(function ResultsList({
  filtered,
  suggestions,
  today,
  dateFilter,
  hasPos,
  gemsFirst,
  onGemsFirst,
  tripMode,
  tripSlugs,
  onToggleTrip,
  onHoverSlug,
}: {
  filtered: Row[];
  suggestions: Row[];
  today: string;
  dateFilter: DateFilter;
  hasPos: boolean;
  gemsFirst: boolean;
  onGemsFirst: (v: boolean) => void;
  tripMode: boolean;
  tripSlugs: string[];
  onToggleTrip: (slug: string) => void;
  onHoverSlug: (slug: string | null) => void;
}) {
  return (
    <>
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
        {filtered.some((e) => e.gem) && (
          <button
            className={`sort-gems ${gemsFirst ? 'active' : ''}`}
            onClick={() => onGemsFirst(!gemsFirst)}
            aria-pressed={gemsFirst}
          >
            ✦ Perler først
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
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
              tripMode={tripMode}
              selected={tripSlugs.includes(e.slug)}
              onToggleTrip={onToggleTrip}
              onHoverChange={onHoverSlug}
            />
          ))}
        </div>
      )}
    </>
  );
});
