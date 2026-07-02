import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadEventDetail, todayIso } from '../../../lib/data.ts';
import {
  CATEGORY_LABELS,
  displayPlace,
  displayTitle,
  formatDateLong,
  formatHours,
} from '../../../lib/format.ts';
import { DetailMap } from '../../../components/DetailMap.tsx';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = loadEventDetail(slug);
  if (!event) return { title: 'Marked ikke fundet — Loppefund' };
  const place = [event.city ?? event.municipality].filter(Boolean).join(', ');
  return {
    title: `${event.title}${place ? ` i ${place}` : ''} — Loppefund`,
    description:
      event.description?.slice(0, 155) ??
      `${CATEGORY_LABELS[event.category] ?? 'Marked'}${place ? ` i ${place}` : ''} — datoer, åbningstider og praktisk info på Loppefund.`,
  };
}

function eventJsonLd(event: NonNullable<ReturnType<typeof loadEventDetail>>, today: string) {
  const next = event.occurrences.find((o) => o.date >= today);
  if (!next) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title,
    startDate: next.startTime ? `${next.date}T${next.startTime}:00` : next.date,
    ...(next.endTime ? { endDate: `${next.date}T${next.endTime}:00` } : {}),
    eventStatus:
      event.status === 'cancelled'
        ? 'https://schema.org/EventCancelled'
        : 'https://schema.org/EventScheduled',
    location: {
      '@type': 'Place',
      name: event.venueName ?? event.title,
      address: {
        '@type': 'PostalAddress',
        streetAddress: event.street ?? undefined,
        postalCode: event.postcode ?? undefined,
        addressLocality: event.city ?? undefined,
        addressCountry: 'DK',
      },
      ...(event.lat != null && event.lng != null
        ? { geo: { '@type': 'GeoCoordinates', latitude: event.lat, longitude: event.lng } }
        : {}),
    },
    ...(event.description ? { description: event.description.slice(0, 500) } : {}),
    ...(event.isFree !== null ? { isAccessibleForFree: event.isFree } : {}),
  };
}

export default async function EventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = loadEventDetail(slug);
  if (!event) notFound();
  const today = todayIso();
  const upcoming = event.occurrences.filter((o) => o.date >= today);
  const shownDates = upcoming.slice(0, 10);

  const confidencePct = Math.round(event.confidence * 100);
  const trustLabel =
    event.confidence >= 0.75 ? 'Godt bekræftet' : event.confidence >= 0.45 ? 'Bekræftet' : 'Ubekræftet';
  const jsonLd = eventJsonLd(event, today);

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <div className="container">
        <Link href="/" className="back-link">
          ← Alle markeder
        </Link>
        <header className="detail-header">
          <div className="detail-category">
            {CATEGORY_LABELS[event.category] ?? 'Marked'}
            {event.status === 'cancelled' && ' · AFLYST'}
          </div>
          <h1 className="detail-title">{displayTitle(event.title)}</h1>
          <p className="detail-place">
            {[
              event.venueName && displayTitle(event.venueName),
              event.street,
              [event.postcode, event.city && displayPlace(event.city)].filter(Boolean).join(' '),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </header>

        <div className="detail-grid">
          <div>
            <section className="panel">
              <h2>Kommende datoer</h2>
              {shownDates.length === 0 ? (
                <p style={{ color: 'var(--ink-soft)' }}>Ingen kommende datoer kendt.</p>
              ) : (
                <ul className="occurrence-list">
                  {shownDates.map((o) => (
                    <li key={o.date} className={o.date === today ? 'today' : ''}>
                      <span className="when">
                        {o.date === today ? 'I dag — ' : ''}
                        {formatDateLong(o.date)}
                      </span>
                      <span className="hours">{formatHours(o.startTime, o.endTime) ?? 'tid ikke oplyst'}</span>
                    </li>
                  ))}
                  {upcoming.length > shownDates.length && (
                    <li>
                      <span style={{ color: 'var(--ink-faint)' }}>
                        + {upcoming.length - shownDates.length} datoer mere
                      </span>
                    </li>
                  )}
                </ul>
              )}
              {upcoming.length > 0 && (
                <p style={{ marginBottom: 0 }}>
                  <a
                    href={`/marked/${event.slug}/ical`}
                    style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--accent-deep)' }}
                  >
                    ↓ Føj til kalender (.ics)
                  </a>
                </p>
              )}
              {event.scheduleText && (
                <p style={{ color: 'var(--ink-soft)', fontSize: 13.5, marginBottom: 0 }}>
                  Mønster: {event.scheduleText}
                </p>
              )}
            </section>

            {event.description && (
              <section className="panel">
                <h2>Om markedet</h2>
                <p className="description">{event.description}</p>
              </section>
            )}
          </div>

          <aside>
            <section className="panel">
              <h2>Praktisk</h2>
              <ul className="info-list">
                {event.priceText && (
                  <li>
                    <span className="k">Entré</span>
                    <span className="v">{event.priceText}</span>
                  </li>
                )}
                {event.stallCountText && (
                  <li>
                    <span className="k">Stande</span>
                    <span className="v">{event.stallCountText}</span>
                  </li>
                )}
                {event.indoorOutdoor !== 'unknown' && (
                  <li>
                    <span className="k">Inde/ude</span>
                    <span className="v">
                      {{ indoor: 'Indendørs', outdoor: 'Udendørs', mixed: 'Både inde og ude' }[
                        event.indoorOutdoor
                      ]}
                    </span>
                  </li>
                )}
                {event.openingHoursText && (
                  <li>
                    <span className="k">Åbningstid</span>
                    <span className="v">{event.openingHoursText}</span>
                  </li>
                )}
                {event.organizer && (
                  <li>
                    <span className="k">Arrangør</span>
                    <span className="v">{event.organizer}</span>
                  </li>
                )}
                {event.contactWebsite && (
                  <li>
                    <span className="k">Hjemmeside</span>
                    <span className="v">
                      <a href={event.contactWebsite} target="_blank" rel="noopener noreferrer">
                        {new URL(event.contactWebsite).hostname.replace('www.', '')}
                      </a>
                    </span>
                  </li>
                )}
                {event.contactPhone && (
                  <li>
                    <span className="k">Telefon</span>
                    <span className="v">{event.contactPhone}</span>
                  </li>
                )}
              </ul>
              {event.lat != null && event.lng != null && (
                <div className="detail-map">
                  <DetailMap lat={event.lat} lng={event.lng} />
                </div>
              )}
            </section>

            <section className="panel trust-panel">
              <h2>Kan du stole på det her?</h2>
              <div className="trust-meter">
                <div className="trust-bar">
                  <span style={{ width: `${confidencePct}%` }} />
                </div>
                <span className={`trust-label ${event.confidence < 0.45 ? 'low' : ''}`}>
                  {trustLabel}
                </span>
              </div>
              <ul className="source-list">
                {event.sources.map((s) => (
                  <li key={s.url}>
                    Set på{' '}
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      {s.name}
                    </a>{' '}
                    — bekræftet {s.lastConfirmedAt.slice(0, 10)}
                  </li>
                ))}
              </ul>
              <p className="trust-note">
                Loppefund samler automatisk oplysninger fra offentlige kilder og viser altid
                hvor de kommer fra. Tag forbehold for ændringer hos arrangøren.
              </p>
              <p className="trust-note">
                <a
                  href={`mailto:hej@loppefund.dk?subject=${encodeURIComponent(`Fejl i "${event.title}"`)}&body=${encodeURIComponent(`Vedrører: https://loppefund.dk/marked/${event.slug}\n\nHvad er forkert?\n`)}`}
                  style={{ color: 'var(--accent-deep)', fontWeight: 600 }}
                >
                  Fejl i oplysningerne? Skriv til os
                </a>
              </p>
            </section>
          </aside>
        </div>
      </div>
    </>
  );
}
