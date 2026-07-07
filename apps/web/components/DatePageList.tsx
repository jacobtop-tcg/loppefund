'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { EventSummary } from '../lib/data.ts';
import { EventCard } from './EventCard.tsx';
import {
  copenhagenToday,
  firstDateInWindow,
  occurrenceWindow,
  type DateWindowKind,
} from '../lib/client-utils.ts';
import { dayOfMonth, monthLong } from '../lib/format.ts';

export type DateWindow = DateWindowKind;

/**
 * The market grid for the /i-dag and /i-weekenden intent landing pages.
 *
 * A client island on purpose: it server-renders the build-day window into the
 * static HTML (so Google indexes real, correct markets for the "loppemarked i
 * dag / i weekenden" query), then re-derives the window from the live
 * Copenhagen date after mount. That way a static page built days ago can never
 * present a past day as "today" — the same live-clock guarantee the homepage
 * relies on. Incorrect events are not acceptable; an empty honest list is.
 */
export function DatePageList({
  events,
  buildToday,
  kind,
}: {
  events: EventSummary[];
  buildToday: string;
  kind: DateWindow;
}) {
  // Seed from the build date so the first client render matches the server HTML
  // (no hydration mismatch), then correct to the real date on mount.
  const [today, setToday] = useState(buildToday);
  useEffect(() => {
    const live = copenhagenToday();
    setToday((prev) => (live !== prev ? live : prev));
  }, []);

  const [from, to] = occurrenceWindow(kind, today);
  const shown = events
    .map((e) => ({ event: e, date: firstDateInWindow(e.occurrences, from, to) }))
    .filter((x): x is { event: EventSummary; date: string } => x.date !== null)
    .sort((a, b) => a.date.localeCompare(b.date) || a.event.title.localeCompare(b.event.title));

  if (shown.length === 0) {
    const alt =
      kind === 'today'
        ? { href: '/i-weekenden', label: 'Se loppemarkeder i weekenden →' }
        : { href: '/', label: 'Se alle kommende markeder →' };
    return (
      <div className="empty-state">
        <p>
          {kind === 'today'
            ? 'Der er ingen loppemarkeder åbne i dag lige nu.'
            : 'Der er ingen loppemarkeder i den kommende weekend lige nu.'}{' '}
          Nye markeder kommer til hele tiden — kig forbi igen.
        </p>
        <Link href={alt.href} className="empty-cta">
          {alt.label}
        </Link>
      </div>
    );
  }

  const noun = shown.length === 1 ? 'marked' : 'markeder';
  // The landing page speaks the same serif voice as home: name the moment
  // ('I dag' / 'Weekenden 11.–12. juli'), then count it quietly. Dates derive
  // from the ISO window seeded by the build date, so hydration stays clean.
  const lead =
    kind === 'today' ? 'I dag' : `Weekenden ${dayOfMonth(from)}.–${dayOfMonth(to)}. ${monthLong(to)}`;
  return (
    <>
      <div className="result-head" style={{ margin: '8px 0 2px' }}>
        <p className="result-lead">{lead}</p>
        <p className="result-count" aria-live="polite">
          <strong>{shown.length}</strong> {noun}
        </p>
      </div>
      <div className="event-grid" style={{ marginTop: 14 }}>
        {shown.map(({ event, date }, i) => (
          <EventCard
            key={event.slug}
            event={{ ...event, nextDate: date, distanceKm: null }}
            today={today}
            index={i}
          />
        ))}
      </div>
    </>
  );
}
