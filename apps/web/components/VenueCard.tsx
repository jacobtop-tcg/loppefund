'use client';

import Link from 'next/link';
import type { VenueSummary } from '../lib/data.ts';
import { displayPlace, displayTitle } from '../lib/format.ts';
import { openLabel, venueOpenState, VENUE_LABELS, VENUE_SHORT } from '../lib/venue-client.ts';

/**
 * A permanent second-hand venue in the list — visually a sibling of EventCard
 * but with a type stub instead of a date block and a live "Åbent nu" line from
 * the venue's opening hours (never a date). Sourced from OpenStreetMap.
 */
export function VenueCard({
  venue,
  now,
  index,
}: {
  venue: VenueSummary;
  now: { date: string; time: string };
  index: number;
}) {
  const state = venueOpenState(venue.openingHoursText, now);
  const label = openLabel(state, now);
  const place = venue.city ?? venue.street ?? 'Fast butik';
  return (
    <div className="event-card-shell" style={{ position: 'relative', display: 'block' }}>
      <Link href={`/sted/${venue.slug}`} prefetch={false} style={{ display: 'block' }}>
        <article
          className={`event-card venue-card venue-${venue.category}`}
          style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
        >
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
            <div className="event-place">{displayPlace(place)}</div>
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
      </Link>
    </div>
  );
}
