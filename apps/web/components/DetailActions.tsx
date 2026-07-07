'use client';

import { useFavorites } from '../lib/favorites.ts';
import { CalendarIcon, HeartIcon, NavIcon } from './icons.tsx';
import { ShareButton } from './ShareButton.tsx';

/**
 * The detail page's single confident action bar: Vis rute / Gem / Kalender /
 * Del as ONE cohesive component instead of CTAs scattered across panels. On
 * mobile it pins to the bottom of the screen (thumb reach) — deciding to go is
 * one tap, never a hunt-and-scroll.
 */
export function DetailActions({
  slug,
  title,
  sharePath,
  routeUrl,
  calendarUrl,
}: {
  slug: string;
  title: string;
  sharePath: string;
  /** Google Maps directions URL — omitted when the event has no coordinates. */
  routeUrl?: string;
  /** Omitted when there is no upcoming date to add. */
  calendarUrl?: string;
}) {
  const { isFavorite, toggle } = useFavorites();
  const saved = isFavorite(slug);
  return (
    <div className="detail-actions" role="group" aria-label="Handlinger">
      {routeUrl && (
        <a className="da-btn primary" href={routeUrl} target="_blank" rel="noopener noreferrer">
          <NavIcon /> Vis rute
        </a>
      )}
      <button
        type="button"
        className={`da-btn${saved ? ' saved' : ''}`}
        aria-pressed={saved}
        onClick={() => toggle(slug)}
      >
        <HeartIcon /> {saved ? 'Gemt' : 'Gem'}
      </button>
      {calendarUrl && (
        <a className="da-btn" href={calendarUrl} target="_blank" rel="noopener noreferrer">
          <CalendarIcon /> Kalender
        </a>
      )}
      <ShareButton title={title} path={sharePath} />
    </div>
  );
}
