'use client';

import Link from 'next/link';
import { parseStallCount } from '@loppefund/core';
import type { EventSummary } from '../lib/data.ts';
import { useFavorites } from '../lib/favorites.ts';
import { weatherGlyph, type DayWeather } from '../lib/weather.ts';
import { GemIcon, WarnIcon, WeatherIcon } from './icons.tsx';
import {
  CATEGORY_LABELS,
  dayOfMonth,
  displayPlace,
  displayTitle,
  formatHours,
  monthShort,
  weekdayShort,
} from '../lib/format.ts';

const UNVERIFIED_THRESHOLD = 0.45;

type CardEvent = EventSummary & { nextDate: string; distanceKm: number | null };

function cardBody(event: CardEvent, today: string, openNow: boolean, weather?: DayWeather) {
  const next = event.occurrences.find((o) => o.date === event.nextDate)!;
  const hours = formatHours(next.startTime, next.endTime);
  const isToday = event.nextDate === today;
  const moreDates = event.occurrences.filter((o) => o.date > event.nextDate).length;
  // Size is a strong "worth driving to?" signal and family-friendliness answers
  // one of the six core questions — both computed by the pipeline but never
  // shown on the card until now. A big number sells the trip at a glance.
  const stalls = parseStallCount(event.stallCountText);
  return (
    <>
      <div className={`date-block ${isToday ? 'today' : ''}`}>
        <div className="weekday">{isToday ? 'i dag' : weekdayShort(event.nextDate)}</div>
        <div className="day">{dayOfMonth(event.nextDate)}</div>
        <div className="month">{monthShort(event.nextDate)}</div>
      </div>
      <div className="event-card-body">
        <h3 className="event-title">{displayTitle(event.title)}</h3>
        <div className="event-place">
          {[
            event.venueName && displayTitle(event.venueName),
            (event.city ?? event.municipality) && displayPlace(event.city ?? event.municipality!),
          ]
            .filter(Boolean)
            .join(' · ') || 'Sted ukendt'}
        </div>
        <div className="event-time">
          {hours ?? 'Tidspunkt ikke oplyst'}
          {moreDates > 0 && ` · +${moreDates} ${moreDates === 1 ? 'dato' : 'datoer'}`}
        </div>
        <div className="badge-row">
          {openNow && event.status !== 'cancelled' && (
            <span className="badge open-now">
              <span className="dot" aria-hidden />
              Åbent nu
            </span>
          )}
          {event.gem && (
            <span className="badge gem">
              <GemIcon /> Skjult perle
            </span>
          )}
          {stalls !== null && stalls >= 15 && (
            <span className="badge stalls" title={event.stallCountText ?? undefined}>
              ~{stalls} stande
            </span>
          )}
          {event.familyFriendly && <span className="badge family">Børnevenligt</span>}
          <span className="badge">{CATEGORY_LABELS[event.category] ?? 'Marked'}</span>
          {event.isFree === true && <span className="badge free">Gratis</span>}
          {event.indoorOutdoor === 'indoor' && <span className="badge">Indendørs</span>}
          {event.indoorOutdoor === 'outdoor' && <span className="badge">Udendørs</span>}
          {/* A market that says it cancels in rain, on a day with a real chance of
              it, gets a warning instead of a plain forecast — the single most
              trip-saving thing we can tell a family before they drive out. Such a
              market is outdoors by definition, so the warning shows even when the
              indoor/outdoor field was never filled in. */}
          {weather && event.weatherDependent && weather.popPct >= 50 ? (
            <span
              className="badge weather-warn"
              title={`Dette marked aflyses typisk ved regn — ${weather.popPct}% chance for regn (${weatherGlyph(weather.code).label})`}
            >
              <WarnIcon /> Kan aflyses · {weather.popPct}% regn
            </span>
          ) : weather && (event.indoorOutdoor === 'outdoor' || event.indoorOutdoor === 'mixed') ? (
            <span
              className={`badge weather${weather.popPct >= 50 ? ' wet' : ''}`}
              title={`${weatherGlyph(weather.code).label}${weather.popPct >= 30 ? ` · ${weather.popPct}% regn` : ''}`}
            >
              <WeatherIcon code={weather.code} /> {weather.tmaxC}°
              {weather.popPct >= 50 ? ` · ${weather.popPct}%` : ''}
            </span>
          ) : null}
          {event.distanceKm !== null && (
            <span className="badge distance">{Math.round(event.distanceKm)} km</span>
          )}
          {event.status === 'cancelled' && (
            <span className="badge cancelled" title="Meldt aflyst — tag ikke afsted uden at tjekke hos arrangøren.">
              Aflyst
            </span>
          )}
          {event.status !== 'cancelled' && event.confidence < UNVERIFIED_THRESHOLD && (
            <span
              className="badge unverified"
              title="Kun set ét sted og endnu ikke bekræftet — tjek datoen hos arrangøren, før du tager afsted."
            >
              Ubekræftet
            </span>
          )}
        </div>
      </div>
    </>
  );
}

export function EventCard({
  event,
  today,
  index,
  openNow = false,
  weather,
  tripMode = false,
  selected = false,
  onToggleTrip,
  onHoverChange,
}: {
  event: CardEvent;
  today: string;
  index: number;
  openNow?: boolean;
  weather?: DayWeather;
  tripMode?: boolean;
  selected?: boolean;
  onToggleTrip?: (slug: string) => void;
  onHoverChange?: (slug: string | null) => void;
}) {
  const { isFavorite, toggle } = useFavorites();
  // Hover/focus lights up this market's dot on the map (keyboard users too).
  const hoverProps = onHoverChange
    ? {
        onMouseEnter: () => onHoverChange(event.slug),
        onMouseLeave: () => onHoverChange(null),
        onFocus: () => onHoverChange(event.slug),
        onBlur: () => onHoverChange(null),
      }
    : {};
  const saved = isFavorite(event.slug);
  const selectable = tripMode && event.lat != null && event.lng != null;

  const article = (
    <article
      className={`event-card cat-${event.category}${selected ? ' selected' : ''}${tripMode && !selectable ? ' trip-disabled' : ''}`}
      style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
      title={tripMode && !selectable ? 'Mangler placering — kan ikke lægges på ruten' : undefined}
    >
      {tripMode && selectable && (
        <span className="select-ring" aria-hidden>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round">
            <path d="m4 12 5 5 11-11" />
          </svg>
        </span>
      )}
      {cardBody(event, today, openNow, weather)}
    </article>
  );

  // In trip mode the card is a real toggle button (Space/Enter, aria-pressed,
  // disabled) instead of a link with preventDefault — proper keyboard/AT
  // semantics and no swallowed modifier-clicks.
  if (tripMode) {
    return (
      <button
        type="button"
        className="card-button"
        aria-pressed={selectable ? selected : undefined}
        disabled={!selectable}
        onClick={() => selectable && onToggleTrip?.(event.slug)}
        {...hoverProps}
      >
        {article}
      </button>
    );
  }

  // The heart is a SIBLING of the link, not a descendant — no interactive
  // element nested inside the anchor. The shell is the positioning context
  // both share.
  return (
    <div className="event-card-shell" style={{ position: 'relative', display: 'block' }}>
      <Link href={`/marked/${event.slug}`} prefetch={false} style={{ display: 'block' }} {...hoverProps}>
        {article}
      </Link>
      <button
        type="button"
        className={`fav-btn${saved ? ' saved' : ''}`}
        aria-pressed={saved}
        aria-label={saved ? 'Fjern fra gemte' : 'Gem marked'}
        title={saved ? 'Fjern fra gemte' : 'Gem marked'}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggle(event.slug);
        }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
          <path d="M12 21s-7-4.35-9.5-8.5C.5 9 2.5 5.5 6 5.5c2 0 3.2 1.2 4 2.3.8-1.1 2-2.3 4-2.3 3.5 0 5.5 3.5 3.5 7-2.5 4.15-9.5 8.5-9.5 8.5z" />
        </svg>
      </button>
    </div>
  );
}
