import Link from 'next/link';
import type { Metadata } from 'next';
import { listCities, listUpcomingEvents, todayIso } from '../../lib/data.ts';
import { displayPlace } from '../../lib/format.ts';
import { NearMeList } from '../../components/NearMeList.tsx';

// "loppemarked i nærheden / nær mig" — the highest-intent search of them all:
// the asker is ready to GO. The page is honest about what a static build can
// know: the HTML carries real, crawlable substance (copy + every market town
// as links), and the distance-sorted list is a client island that only exists
// once the visitor shares their location — which never leaves their device.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const TITLE = 'Loppemarkeder i nærheden — find loppemarked nær dig | Loppefund';
const DESCRIPTION =
  'Find loppemarkeder, kræmmermarkeder og bagagerumsmarkeder tæt på dig — sorteret efter afstand, med datoer, åbningstider og adresser. Altid opdateret.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${BASE_PATH}/naer-mig` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${BASE_PATH}/naer-mig`,
    type: 'website',
    siteName: 'Loppefund',
    locale: 'da_DK',
    images: [{ url: `${BASE_PATH}/opengraph-image`, width: 1200, height: 630, alt: TITLE }],
  },
  twitter: { card: 'summary_large_image', images: [`${BASE_PATH}/opengraph-image`] },
};

export default function NearMePage() {
  const today = todayIso();
  // 45 days: enough horizon that thinly covered corners of the country still
  // get a meaningful nearest-list, small enough to keep the page light.
  const events = listUpcomingEvents(45);
  const cities = listCities();

  return (
    <div className="container">
      <Link href="/" className="back-link">
        ← Alle markeder
      </Link>
      <header className="detail-header">
        <div className="detail-category">Nær dig</div>
        <h1 className="detail-title">Loppemarkeder i nærheden</h1>
        <p className="detail-place">
          Del din placering, og se de nærmeste loppemarkeder først — med dato, åbningstider og
          adresse. Opdateret automatisk fra offentlige kilder.
        </p>
      </header>
      <NearMeList events={events} buildToday={today} />

      <section aria-label="Find din by">
        <h2 className="reco-title" style={{ marginTop: 30 }}>
          Eller find din by
        </h2>
        <div className="city-cloud" style={{ marginTop: 10 }}>
          {cities.slice(0, 24).map((c) => (
            <Link key={c.slug} href={`/by/${c.slug}`} className="chip">
              {displayPlace(c.city)}{' '}
              <span className="city-count">{c.count > 0 ? c.count : c.venueCount}</span>
            </Link>
          ))}
          <Link href="/byer" className="chip">
            Alle byer →
          </Link>
        </div>
      </section>

      <nav className="intent-crosslinks" aria-label="Andre visninger">
        <Link href="/i-dag">I dag</Link>
        <Link href="/i-weekenden">I weekenden</Link>
        <Link href="/">Kort &amp; filtre</Link>
      </nav>
    </div>
  );
}
