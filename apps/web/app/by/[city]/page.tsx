import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listCities, listEventsForCity, todayIso } from '../../../lib/data.ts';
import { displayPlace } from '../../../lib/format.ts';
import { EventCard } from '../../../components/EventCard.tsx';

// SEO landing pages: "Loppemarkeder i <By>" is what Danish families google.
export const dynamicParams = false;

export function generateStaticParams(): Array<{ city: string }> {
  return listCities().map((c) => ({ city: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city } = await params;
  const info = listCities().find((c) => c.slug === city);
  if (!info) return { title: 'By ikke fundet — Loppefund' };
  const name = displayPlace(info.city);
  const title = `Loppemarkeder i ${name} — Loppefund`;
  const description = `${info.count} kommende loppemarkeder, kræmmermarkeder og bagagerumsmarkeder i ${name}. Datoer, åbningstider og adresser — altid opdateret.`;
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  // Per-city share cards for Facebook groups, not the site-wide fallback.
  // Referenced explicitly (not via file-convention auto-wiring) because that
  // proved non-deterministic under basePath + static export — see the event
  // page's generateMetadata for the same fix.
  const ogImage = {
    url: `${basePath}/by/${info.slug}/opengraph-image`,
    width: 1200,
    height: 630,
    alt: title,
  };
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${basePath}/by/${info.slug}`,
      type: 'website',
      siteName: 'Loppefund',
      locale: 'da_DK',
      images: [ogImage],
    },
    twitter: { card: 'summary_large_image', images: [ogImage] },
  };
}

export default async function CityPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city } = await params;
  const info = listCities().find((c) => c.slug === city);
  if (!info) notFound();
  const events = listEventsForCity(city);
  const today = todayIso();
  const name = displayPlace(info.city);

  return (
    <div className="container">
      <Link href="/" className="back-link">
        ← Alle markeder
      </Link>
      <header className="detail-header">
        <div className="detail-category">By-guide</div>
        <h1 className="detail-title">Loppemarkeder i {name}</h1>
        <p className="detail-place">
          {events.length} kommende {events.length === 1 ? 'marked' : 'markeder'} — opdateret
          automatisk fra offentlige kilder.
        </p>
      </header>
      <div className="event-grid" style={{ marginTop: 18 }}>
        {events.map((e, i) => (
          <EventCard
            key={e.slug}
            event={{
              ...e,
              nextDate: e.occurrences[0]?.date ?? today,
              distanceKm: null,
            }}
            today={today}
            index={i}
          />
        ))}
      </div>
    </div>
  );
}
