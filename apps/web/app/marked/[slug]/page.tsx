import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadEventDetail, loadPhotos, loadReviews, todayIso } from '../../../lib/data.ts';
import {
  CATEGORY_LABELS,
  displayPlace,
  displayTitle,
  formatDateLong,
  formatHours,
  truncateAtWord,
} from '../../../lib/format.ts';
import { DetailMap } from '../../../components/DetailMap.tsx';
import { ShareButton } from '../../../components/ShareButton.tsx';
import { ReportEventForm } from '../../../components/ReportEventForm.tsx';
import { ConfirmEventForm } from '../../../components/ConfirmEventForm.tsx';
import { ReviewForm } from '../../../components/ReviewForm.tsx';
import { PhotoForm } from '../../../components/PhotoForm.tsx';
import { starGlyphs } from '../../../lib/reviews.ts';
import { listCancelledUpcomingSlugs, listUpcomingEvents } from '../../../lib/data.ts';
import { distanceKm } from '../../../lib/client-utils.ts';

// Only known event slugs render; unknowns 404. generateStaticParams reads the
// live DB so both the static export and `next dev` cover every active event.
export const dynamicParams = false;

export function generateStaticParams(): Array<{ slug: string }> {
  // Active upcoming markets — the browsable set. Plus markets that were
  // cancelled but whose date hasn't passed: their pages must render (as clear
  // "AFLYST" pages) rather than 404, so a link shared before the cancellation
  // still tells a visitor not to go. A slug is only ever in one list (single
  // status), but dedupe defensively.
  const slugs = new Set<string>(listUpcomingEvents(180).map((e) => e.slug));
  for (const slug of listCancelledUpcomingSlugs(180)) slugs.add(slug);
  return [...slugs].map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = loadEventDetail(slug);
  if (!event) return { title: 'Marked ikke fundet — Loppefund' };
  const place = [event.city ?? event.municipality].filter(Boolean).join(', ');
  const description = event.description
    ? truncateAtWord(event.description, 155)
    : `${CATEGORY_LABELS[event.category] ?? 'Marked'}${place ? ` i ${place}` : ''} — datoer, åbningstider og praktisk info på Loppefund.`;
  const title = `${event.title}${place ? ` i ${place}` : ''} — Loppefund`;
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  // Shares in Facebook groups are the primary adoption channel — each event
  // page must carry its OWN card, not the generic site-wide one. The
  // file-convention auto-wiring (opengraph-image.tsx in this segment) proved
  // non-deterministic under basePath + static export — the deployed HTML
  // sometimes fell back to the root card — so point at the per-event image
  // explicitly. It resolves against the origin-only metadataBase.
  const ogImage = {
    url: `${basePath}/marked/${slug}/opengraph-image`,
    width: 1200,
    height: 630,
    alt: title,
  };
  return {
    title,
    description,
    // rel=canonical: GitHub Pages serves both trailing- and non-trailing-slash
    // forms, and shared filter URLs add query strings — all must point back to
    // the clean event URL so ranking signals don't split. Relative, so it
    // resolves against the origin-only metadataBase like og:url.
    alternates: { canonical: `${basePath}/marked/${slug}` },
    openGraph: {
      title,
      description,
      url: `${basePath}/marked/${slug}`,
      type: 'website',
      siteName: 'Loppefund',
      locale: 'da_DK',
      images: [ogImage],
    },
    twitter: { card: 'summary_large_image', images: [ogImage] },
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

/**
 * Serialize JSON-LD for inline injection. Event data is crawled from the
 * public web, so "</script>" or a raw line/paragraph separator in a title
 * must be escaped or it breaks out of the <script> tag (stored XSS).
 */
function safeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/[\u2028\u2029]/g, (c) => (c === '\u2028' ? '\\u2028' : '\\u2029'));
}

/** Validate a crawled website value: only http(s), scheme repaired, else null. */
function safeExternalUrl(raw: string | null): { href: string; label: string } | null {
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return { href: u.href, label: u.hostname.replace(/^www\./, '') };
  } catch {
    return null;
  }
}

export default async function EventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = loadEventDetail(slug);
  if (!event) notFound();
  const reviews = loadReviews(slug);
  const photos = loadPhotos(slug);
  const today = todayIso();
  const upcoming = event.occurrences.filter((o) => o.date >= today);
  const shownDates = upcoming.slice(0, 10);

  // Same-visit discovery: the three nearest other upcoming markets.
  const nearby =
    event.lat != null && event.lng != null
      ? listUpcomingEvents(60)
          .filter((e) => e.slug !== event.slug && e.lat != null && e.lng != null)
          .map((e) => ({ ...e, km: distanceKm(event.lat!, event.lng!, e.lat!, e.lng!) }))
          .filter((e) => e.km <= 40)
          .sort((a, b) => a.km - b.km)
          .slice(0, 3)
      : [];

  const confidencePct = Math.round(event.confidence * 100);
  const trustLabel =
    event.confidence >= 0.75 ? 'Godt bekræftet' : event.confidence >= 0.45 ? 'Bekræftet' : 'Ubekræftet';
  const jsonLd = eventJsonLd(event, today);
  const safeWebsite = safeExternalUrl(event.contactWebsite);
  // The booking link is crawled too — validate its scheme like the website.
  const safeBooking = safeExternalUrl(event.amenities?.bookingUrl ?? null);

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          // Event data is crawled from the public web — a title containing
          // "</script>" or a line-separator must not break out of the tag.
          dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }}
        />
      )}
      <div className="container">
        <Link href="/" className="back-link">
          ← Alle markeder
        </Link>
        {event.status === 'cancelled' && (
          <div className="cancelled-banner" role="alert">
            <strong>Aflyst.</strong> Dette marked er meldt aflyst. Tag ikke afsted —
            arrangøren har trukket det tilbage, eller det er ikke længere bekræftet.
          </div>
        )}
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
          <p style={{ marginTop: 14 }}>
            <ShareButton
              title={displayTitle(event.title)}
              path={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/marked/${event.slug}`}
            />
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
                    href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/marked/${event.slug}/ical`}
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

            <section className="panel">
              <h2>Billeder</h2>
              {photos.length > 0 && (
                <ul className="photo-grid">
                  {photos.map((p) => (
                    <li key={p.file}>
                      <img
                        src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/market-photos/${p.file}`}
                        alt={`Foto fra ${displayTitle(event.title)}${p.credit ? ` — ${p.credit}` : ''}`}
                        loading="lazy"
                        className="photo-thumb"
                      />
                      {p.credit && <span className="photo-credit">📷 {p.credit}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {photos.length === 0 && (
                <p style={{ color: 'var(--ink-soft)', marginTop: 0 }}>
                  Ingen billeder endnu — har du været her? Del et, så andre kan se markedet.
                </p>
              )}
              <PhotoForm
                slug={event.slug}
                title={displayTitle(event.title)}
                url={`${process.env.LOPPEFUND_BASE_URL ?? 'https://loppefund.dk'}/marked/${event.slug}`}
              />
            </section>

            <section className="panel">
              <h2>
                Anmeldelser
                {reviews.count > 0 && (
                  <span className="review-summary">
                    <span className="review-stars" aria-hidden="true">
                      {starGlyphs(reviews.average)}
                    </span>
                    <span className="review-avg">{reviews.average.toFixed(1)}</span>
                    <span className="review-count">
                      · {reviews.count} {reviews.count === 1 ? 'anmeldelse' : 'anmeldelser'}
                    </span>
                  </span>
                )}
              </h2>
              {reviews.count === 0 ? (
                <p style={{ color: 'var(--ink-soft)', marginTop: 0 }}>
                  Ingen anmeldelser endnu — har du været her? Vær den første til at dele din oplevelse.
                </p>
              ) : (
                <ul className="review-list">
                  {reviews.reviews.slice(0, 8).map((r, i) => (
                    <li key={i} className="review-item">
                      <div className="review-head">
                        <span className="review-stars" aria-label={`${r.rating} af 5 stjerner`}>
                          {starGlyphs(r.rating)}
                        </span>
                        {r.author && <span className="review-author">{r.author}</span>}
                        {r.date && <span className="review-date">{r.date}</span>}
                      </div>
                      {r.text && <p className="review-body">{r.text}</p>}
                    </li>
                  ))}
                </ul>
              )}
              <ReviewForm
                slug={event.slug}
                title={displayTitle(event.title)}
                url={`${process.env.LOPPEFUND_BASE_URL ?? 'https://loppefund.dk'}/marked/${event.slug}`}
              />
            </section>
          </div>

          <aside>
            <section className="panel">
              <h2>Praktisk</h2>
              {event.amenities && (
                <div className="badge-row" style={{ marginBottom: 12 }}>
                  {event.amenities.parking === true && <span className="badge free">P Parkering</span>}
                  {event.amenities.parking === false && <span className="badge cancelled">Ingen parkering</span>}
                  {event.amenities.food === true && <span className="badge free">Mad & drikke</span>}
                  {event.amenities.toilets === true && <span className="badge free">Toiletter</span>}
                  {event.amenities.kidsActivities === true && <span className="badge free">Børneaktiviteter</span>}
                  {event.amenities.accessibility === true && <span className="badge free">Kørestolsvenligt</span>}
                  {event.amenities.mobilepay === true && <span className="badge">MobilePay</span>}
                  {event.amenities.cashOnly === true && <span className="badge unverified">Kun kontanter</span>}
                  {event.amenities.weatherDependent === true && <span className="badge unverified">Vejrafhængigt</span>}
                </div>
              )}
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
                {safeWebsite && (
                  <li>
                    <span className="k">Hjemmeside</span>
                    <span className="v">
                      <a href={safeWebsite.href} target="_blank" rel="noopener noreferrer">
                        {safeWebsite.label}
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
                {safeBooking && (
                  <li>
                    <span className="k">Lej en stand</span>
                    <span className="v">
                      <a href={safeBooking.href} target="_blank" rel="noopener noreferrer">
                        Book stadeplads
                      </a>
                    </span>
                  </li>
                )}
              </ul>
              {event.lat != null && event.lng != null && (
                <>
                  <div className="detail-map">
                    <DetailMap lat={event.lat} lng={event.lng} approximate={event.approximate} />
                  </div>
                  {event.approximate && (
                    <p
                      style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--ink-soft, #6b6257)' }}
                    >
                      ⓘ Omtrentlig placering (postnummer-område) — den præcise adresse er ikke
                      bekræftet.
                    </p>
                  )}
                  <p style={{ marginTop: 10, marginBottom: 0 }}>
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${event.lat},${event.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--accent-deep)' }}
                    >
                      🧭 Find vej
                    </a>
                  </p>
                </>
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
              <ConfirmEventForm
                slug={event.slug}
                title={event.title}
                url={`${process.env.LOPPEFUND_BASE_URL ?? 'https://loppefund.dk'}/marked/${event.slug}`}
              />
              <ReportEventForm
                title={event.title}
                url={`${process.env.LOPPEFUND_BASE_URL ?? 'https://loppefund.dk'}/marked/${event.slug}`}
              />
            </section>

            {nearby.length > 0 && (
              <section className="panel">
                <h2>I nærheden</h2>
                <ul className="occurrence-list">
                  {nearby.map((n) => (
                    <li key={n.slug}>
                      <span className="when">
                        <Link href={`/marked/${n.slug}`} style={{ color: 'var(--accent-deep)', fontWeight: 600 }}>
                          {displayTitle(n.title)}
                        </Link>
                      </span>
                      <span className="hours">{Math.round(n.km)} km</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        </div>
      </div>
    </>
  );
}
