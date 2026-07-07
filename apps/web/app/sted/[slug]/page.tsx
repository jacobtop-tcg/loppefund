import Link from 'next/link';
import { BackLink } from '../../../components/BackLink.tsx';
import { notFound } from 'next/navigation';
import { copenhagenNow, parseOsmHours } from '@loppefund/core';
import { listVenues, loadVenueDetail } from '../../../lib/data.ts';
import { displayPlace, displayTitle } from '../../../lib/format.ts';
import { VENUE_LABELS } from '../../../lib/venue-client.ts';
import { VenueHours } from '../../../components/VenueHours.tsx';
import { VenueHoursForm } from '../../../components/VenueHoursForm.tsx';
import { distanceKm } from '../../../lib/client-utils.ts';

// Permanent-venue pages: "<butik> åbningstider" is what people google for a shop.
export const dynamicParams = false;

const SITE_URL = process.env.LOPPEFUND_BASE_URL ?? 'https://jacobtop-tcg.github.io/loppefund';
const SCHEMA_DAYS = [
  'https://schema.org/Monday',
  'https://schema.org/Tuesday',
  'https://schema.org/Wednesday',
  'https://schema.org/Thursday',
  'https://schema.org/Friday',
  'https://schema.org/Saturday',
  'https://schema.org/Sunday',
];
const pad2 = (n: number) => String(n).padStart(2, '0');
const fmtMin = (m: number) => {
  const c = Math.min(m, 1439); // schema Time has no "24:00"; clamp an all-day close
  return `${pad2(Math.floor(c / 60))}:${pad2(c % 60)}`;
};

/** Escape a JSON-LD payload for safe inline injection (OSM names are crawled). */
function safeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
}

/**
 * Store JSON-LD for a permanent venue — the ~1100 /sted pages carried zero
 * structured data. Opening hours are reconstructed from the VALIDATED parse
 * (never the raw OSM string, which can carry PH/month selectors schema rejects);
 * unparseable hours are simply omitted. Missing is fine, malformed markup is not.
 */
function venueJsonLd(v: NonNullable<ReturnType<typeof loadVenueDetail>>, website: string | null) {
  const week = parseOsmHours(v.openingHoursText);
  const spec = week
    ? week.flatMap((ranges, day) =>
        ranges.map(([s, e]) => ({
          '@type': 'OpeningHoursSpecification',
          dayOfWeek: SCHEMA_DAYS[day],
          opens: fmtMin(s),
          closes: fmtMin(e),
        })),
      )
    : [];
  const hasAddress = v.street || v.city || v.postcode;
  return {
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: displayTitle(v.title),
    url: `${SITE_URL}/sted/${v.slug}`,
    ...(hasAddress
      ? {
          address: {
            '@type': 'PostalAddress',
            streetAddress: v.street ?? undefined,
            postalCode: v.postcode ?? undefined,
            addressLocality: v.city ?? undefined,
            addressCountry: 'DK',
          },
        }
      : {}),
    ...(v.lat != null && v.lng != null
      ? { geo: { '@type': 'GeoCoordinates', latitude: v.lat, longitude: v.lng } }
      : {}),
    ...(v.contactPhone ? { telephone: v.contactPhone } : {}),
    ...(website ? { sameAs: [website] } : {}),
    ...(spec.length ? { openingHoursSpecification: spec } : {}),
  };
}

export function generateStaticParams(): Array<{ slug: string }> {
  const venues = listVenues();
  // `output: export` rejects an EMPTY generateStaticParams for a dynamic route,
  // and a push build restores a DB from cache that may predate any venue crawl.
  // Keep the route exportable with a sentinel that resolves to notFound().
  if (venues.length === 0) return [{ slug: '__none__' }];
  return venues.map((v) => ({ slug: v.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const v = loadVenueDetail(slug);
  if (!v) return { title: 'Butik ikke fundet — Loppefund' };
  const name = displayTitle(v.title);
  const kind = VENUE_LABELS[v.category] ?? 'Genbrugsbutik';
  const place = v.city ? ` i ${displayPlace(v.city)}` : '';
  const title = `${name} — ${kind}${place} | Loppefund`;
  const description = `Åbningstider, adresse og rute for ${name}${place}. ${kind} — altid opdateret.`;
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  const ogImage = { url: `${basePath}/opengraph-image`, width: 1200, height: 630, alt: title };
  return {
    title,
    description,
    alternates: { canonical: `${basePath}/sted/${v.slug}` },
    openGraph: {
      title,
      description,
      url: `${basePath}/sted/${v.slug}`,
      type: 'website',
      siteName: 'Loppefund',
      locale: 'da_DK',
      images: [ogImage],
    },
    twitter: { card: 'summary_large_image', images: [ogImage] },
  };
}

export default async function VenuePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const v = loadVenueDetail(slug);
  if (!v) notFound();
  const now = copenhagenNow();
  // Same-visit discovery: the three nearest OTHER shops (~5 km — shops cluster in
  // town, unlike the 40 km used for markets). Mirrors the event page's "I nærheden".
  const nearby =
    v.lat != null && v.lng != null
      ? listVenues()
          .filter((o) => o.slug !== v.slug && o.lat != null && o.lng != null)
          .map((o) => ({ ...o, km: distanceKm(v.lat!, v.lng!, o.lat!, o.lng!) }))
          .filter((o) => o.km <= 5)
          .sort((a, b) => a.km - b.km)
          .slice(0, 3)
      : [];
  const place = [v.street, v.city].filter(Boolean).join(', ');
  const mapsUrl =
    v.lat != null && v.lng != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lng}`
      : null;
  // Deep-link to the shop ON Google Maps (search by name + address) so a visitor
  // can check live hours, photos and reviews. We link out — we never store or
  // re-display Google's data (that would breach the Places terms); OpenStreetMap
  // remains our own dataset.
  const gmapsPlaceUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${displayTitle(v.title)} ${place}`.trim(),
  )}`;
  const website = v.contactWebsite
    ? v.contactWebsite.startsWith('http')
      ? v.contactWebsite
      : `https://${v.contactWebsite}`
    : null;
  const jsonLd = venueJsonLd(v, website);

  return (
    <div className="container">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }}
      />
      <BackLink href="/">
        ← Alle steder
      </BackLink>
      <header className="detail-header">
        <div className="detail-category">{VENUE_LABELS[v.category] ?? 'Fast butik'}</div>
        <h1 className="detail-title">{displayTitle(v.title)}</h1>
        {place && <p className="detail-place">{displayPlace(place)}</p>}
      </header>

      <VenueHours hoursText={v.openingHoursText} buildNow={now} />
      {!v.openingHoursText && (
        <VenueHoursForm slug={v.slug} title={v.title} url={`${SITE_URL}/sted/${v.slug}`} />
      )}

      <div className="venue-actions">
        {mapsUrl && (
          <a className="venue-action primary" href={mapsUrl} target="_blank" rel="noopener noreferrer">
            Vis rute
          </a>
        )}
        <a className="venue-action" href={gmapsPlaceUrl} target="_blank" rel="noopener noreferrer">
          Se på Google Maps
        </a>
        {website && (
          <a className="venue-action" href={website} target="_blank" rel="noopener noreferrer">
            Hjemmeside
          </a>
        )}
        {v.contactPhone && (
          <a className="venue-action" href={`tel:${v.contactPhone.replace(/\s+/g, '')}`}>
            Ring {v.contactPhone}
          </a>
        )}
      </div>

      {nearby.length > 0 && (
        <section className="panel venue-nearby">
          <h2>I nærheden</h2>
          <ul className="occurrence-list">
            {nearby.map((n) => (
              <li key={n.slug}>
                <span className="when">
                  <Link href={`/sted/${n.slug}`} style={{ color: 'var(--accent-deep)', fontWeight: 600 }}>
                    {displayTitle(n.title)}
                  </Link>
                  <span className="venue-nearby-kind"> · {VENUE_LABELS[n.category] ?? 'Butik'}</span>
                </span>
                <span className="hours">{n.km < 1 ? '<1' : Math.round(n.km)} km</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="venue-attrib">
        Butiks- og åbningstidsdata fra{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
          © OpenStreetMap
        </a>{' '}
        bidragydere. Noget forkert? Ret det direkte på OpenStreetMap.
      </p>
    </div>
  );
}
