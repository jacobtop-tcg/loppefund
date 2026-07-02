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
}: {
  event: EventSummary & { nextDate: string; distanceKm: number | null };
  today: string;
  index: number;
}) {
  const next = event.occurrences.find((o) => o.date === event.nextDate)!;
  const hours = formatHours(next.startTime, next.endTime);
  const isToday = event.nextDate === today;
  const moreDates = event.occurrences.filter((o) => o.date > event.nextDate).length;

  return (
    <Link href={`/marked/${event.slug}`}>
      <article className="event-card" style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}>
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
      </article>
    </Link>
  );
}
