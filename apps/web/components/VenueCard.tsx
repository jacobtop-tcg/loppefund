'use client';

import Link from 'next/link';
import type { VenueSummary } from '../lib/data.ts';
import { displayPlace, displayTitle } from '../lib/format.ts';
import { openLabel, venueOpenState, VENUE_LABELS, VENUE_SHORT } from '../lib/venue-client.ts';

/**
 * A permanent second-hand venue in the list — visually a sibling of EventCard
 * but with a type stub instead of a date block and a live "Åbent nu" line from
 * the venue's opening hours (never a date). Sourced from OpenStreetMap.
 *
 * In trip mode it becomes a selectable stop (a real toggle button) so a loppetur
 * can mix markets and permanent shops — the id is namespaced `v:<slug>`.
 */
export function VenueCard({
  venue,
  now,
  index,
  tripMode = false,
  selected = false,
  tripIndex,
  tripFull = false,
  onToggleTrip,
}: {
  venue: VenueSummary;
  now: { date: string; time: string };
  index: number;
  tripMode?: boolean;
  selected?: boolean;
  /** 1-based position on the trip, or undefined when not on it. */
  tripIndex?: number;
  /** True when the trip is at MAX_TRIP_STOPS and cannot take another. */
  tripFull?: boolean;
  onToggleTrip?: (id: string) => void;
}) {
  const state = venueOpenState(venue.openingHoursText, now);
  const label = openLabel(state, now);
  // Omit the place line entirely when we have no real location — printing the
  // type word "Fast butik" as if it were a town read as a bug.
  const place = venue.city ?? venue.street ?? null;
  // At the cap, an unselected card is NOT selectable — it looked and behaved
  // like a live toggle that silently did nothing, and a screen reader was told
  // it was an unpressed toggle that never presses. A full trip must read as
  // full. Already-selected cards stay tappable so you can always take one off.
  const selectable =
    tripMode && venue.lat != null && venue.lng != null && (selected || !tripFull);

  const article = (
    <article
      className={`event-card venue-card venue-${venue.category}${selected ? ' selected' : ''}${tripMode && !selectable ? ' trip-disabled' : ''}`}
      style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
      title={
        tripMode && !selectable
          ? venue.lat == null || venue.lng == null
            ? 'Mangler placering — kan ikke lægges på ruten'
            : 'Turen er fuld — fjern et stop for at bytte'
          : undefined
      }
    >
      {tripMode && selectable && (
        <span className="select-ring" aria-hidden>
          {selected && tripIndex ? tripIndex : null}
        </span>
      )}
      <div className={`date-block venue-stub venue-${venue.category}`} aria-hidden>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9.5 12 4l9 5.5" />
          <path d="M5 10v9h14v-9" />
          <path d="M9 19v-5h6v5" />
        </svg>
        <div className="venue-stub-label">{VENUE_SHORT[venue.category]}</div>
      </div>
      <div className="event-card-body">
        <h3 className="event-title">{displayTitle(venue.title)}</h3>
        {place && <div className="event-place">{displayPlace(place)}</div>}
        <div className={`event-time${label?.open ? ' venue-open-line' : ''}`}>
          {label ? label.text : 'Åbningstider ikke oplyst'}
        </div>
        <div className="badge-row">
          {label?.open && (
            <span className="badge open-now">
              <span className="dot" aria-hidden />
              Åbent nu
            </span>
          )}
          <span className="badge">{VENUE_LABELS[venue.category] ?? 'Fast butik'}</span>
          <span className="badge venue-badge">Fast butik</span>
        </div>
      </div>
    </article>
  );

  // In trip mode the card is a real toggle button (Space/Enter, aria-pressed,
  // disabled) rather than a link — proper keyboard/AT semantics, no navigation.
  if (tripMode) {
    return (
      <button
        type="button"
        className="card-button"
        aria-pressed={selectable ? selected : undefined}
        aria-label={selected && tripIndex ? `${venue.title} — stop ${tripIndex} på turen` : undefined}
        disabled={!selectable}
        onClick={() => selectable && onToggleTrip?.(`v:${venue.slug}`)}
      >
        {article}
      </button>
    );
  }

  return (
    <div className="event-card-shell" style={{ position: 'relative', display: 'block' }}>
      <Link href={`/sted/${venue.slug}`} prefetch={false} style={{ display: 'block' }}>
        {article}
      </Link>
    </div>
  );
}
