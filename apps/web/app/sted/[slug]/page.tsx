import Link from 'next/link';
import { notFound } from 'next/navigation';
import { copenhagenNow } from '@loppefund/core';
import { listVenues, loadVenueDetail } from '../../../lib/data.ts';
import { displayPlace, displayTitle } from '../../../lib/format.ts';
import { VENUE_LABELS } from '../../../lib/venue-client.ts';
import { VenueHours } from '../../../components/VenueHours.tsx';

// Permanent-venue pages: "<butik> åbningstider" is what people google for a shop.
export const dynamicParams = false;

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
  return { title, description, alternates: { canonical: `${basePath}/sted/${v.slug}` } };
}

export default async function VenuePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const v = loadVenueDetail(slug);
  if (!v) notFound();
  const now = copenhagenNow();
  const place = [v.street, v.city].filter(Boolean).join(', ');
  const mapsUrl =
    v.lat != null && v.lng != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lng}`
      : null;
  const website = v.contactWebsite
    ? v.contactWebsite.startsWith('http')
      ? v.contactWebsite
      : `https://${v.contactWebsite}`
    : null;

  return (
    <div className="container">
      <Link href="/" className="back-link">
        ← Alle steder
      </Link>
      <header className="detail-header">
        <div className="detail-category">{VENUE_LABELS[v.category] ?? 'Fast butik'}</div>
        <h1 className="detail-title">{displayTitle(v.title)}</h1>
        {place && <p className="detail-place">{displayPlace(place)}</p>}
      </header>

      <VenueHours hoursText={v.openingHoursText} buildNow={now} />

      <div className="venue-actions">
        {mapsUrl && (
          <a className="venue-action" href={mapsUrl} target="_blank" rel="noopener noreferrer">
            Vis rute
          </a>
        )}
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
