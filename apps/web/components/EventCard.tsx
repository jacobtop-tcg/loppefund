import Link from 'next/link';
import type { EventSummary } from '../lib/data.ts';
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

export function EventCard({
  event,
  today,
  index,
  openNow = false,
  tripMode = false,
  selected = false,
  onToggleTrip,
}: {
  event: EventSummary & { nextDate: string; distanceKm: number | null };
  today: string;
  index: number;
  openNow?: boolean;
  tripMode?: boolean;
  selected?: boolean;
  onToggleTrip?: (slug: string) => void;
}) {
  const next = event.occurrences.find((o) => o.date === event.nextDate)!;
  const hours = formatHours(next.startTime, next.endTime);
  const isToday = event.nextDate === today;
  const moreDates = event.occurrences.filter((o) => o.date > event.nextDate).length;
  const selectable = tripMode && event.lat != null && event.lng != null;

  // In trip mode the card is a real toggle button (Space/Enter, aria-pressed,
  // disabled) instead of a link with preventDefault — proper keyboard/AT
  // semantics and no swallowed modifier-clicks.
  const inner = (
    <article
      className={`event-card${selected ? ' selected' : ''}${tripMode && !selectable ? ' trip-disabled' : ''}`}
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
      <CardBody />
    </article>
  );

  function CardBody() {
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
            {event.gem && <span className="badge gem">✦ Skjult perle</span>}
            <span className="badge">{CATEGORY_LABELS[event.category] ?? 'Marked'}</span>
            {event.isFree === true && <span className="badge free">Gratis</span>}
            {event.indoorOutdoor === 'indoor' && <span className="badge">Indendørs</span>}
            {event.indoorOutdoor === 'outdoor' && <span className="badge">Udendørs</span>}
            {event.distanceKm !== null && (
              <span className="badge distance">{Math.round(event.distanceKm)} km</span>
            )}
            {event.status === 'cancelled' && <span className="badge cancelled">Aflyst</span>}
            {event.status !== 'cancelled' && event.confidence < UNVERIFIED_THRESHOLD && (
              <span className="badge unverified">Ubekræftet</span>
            )}
          </div>
        </div>
      </>
    );
  }

  if (tripMode) {
    return (
      <button
        type="button"
        className="card-button"
        aria-pressed={selectable ? selected : undefined}
        disabled={!selectable}
        onClick={() => selectable && onToggleTrip?.(event.slug)}
      >
        {inner}
      </button>
    );
  }

  return <Link href={`/marked/${event.slug}`}>{inner}</Link>;
}
