import Link from 'next/link';
import type { Metadata } from 'next';
import { listUpcomingEvents, todayIso } from '../../lib/data.ts';
import { collectionJsonLd, safeJsonLd } from '../../lib/jsonld.ts';
import { firstDateInWindow, occurrenceWindow } from '../../lib/client-utils.ts';
import { DatePageList } from '../../components/DatePageList.tsx';

// "loppemarked i weekenden" is one of the two highest-intent Danish searches a
// family makes when planning a trip (the other is "loppemarked i dag"). The
// homepage answers it only behind a client-side filter Google can't rank, so
// this dedicated, indexable landing page is what captures that search.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const TITLE = 'Loppemarkeder i weekenden i Danmark — Loppefund';
const DESCRIPTION =
  'Se alle loppemarkeder, kræmmermarkeder og bagagerumsmarkeder i weekenden i hele Danmark. Datoer, åbningstider, priser og adresser — altid opdateret.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${BASE_PATH}/i-weekenden` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${BASE_PATH}/i-weekenden`,
    type: 'website',
    siteName: 'Loppefund',
    locale: 'da_DK',
    images: [{ url: `${BASE_PATH}/opengraph-image`, width: 1200, height: 630, alt: TITLE }],
  },
  twitter: { card: 'summary_large_image', images: [`${BASE_PATH}/opengraph-image`] },
};

export default function WeekendPage() {
  const today = todayIso();
  // A generous candidate horizon so the client island can still surface the
  // correct weekend even if a daily rebuild was missed; it re-filters to the
  // live weekend after mount.
  const candidates = listUpcomingEvents(16);
  const [from, to] = occurrenceWindow('weekend', today);
  const weekendItems = candidates
    .filter((e) => firstDateInWindow(e.occurrences, from, to) !== null)
    .map((e) => ({ slug: e.slug, title: e.title }));

  return (
    <div className="container">
      {weekendItems.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLd(
              collectionJsonLd({
                name: 'Loppemarkeder i weekenden i Danmark',
                path: '/i-weekenden',
                items: weekendItems,
              }),
            ),
          }}
        />
      )}
      <Link href="/" className="back-link">
        ← Alle markeder
      </Link>
      <header className="detail-header">
        <div className="detail-category">Weekendguide</div>
        <h1 className="detail-title">Loppemarkeder i weekenden</h1>
        <p className="detail-place">
          Alle loppemarkeder, kræmmermarkeder og bagagerumsmarkeder i Danmark i den kommende
          weekend — samlet ét sted og opdateret automatisk fra offentlige kilder.
        </p>
      </header>
      <DatePageList events={candidates} buildToday={today} kind="weekend" />
      <nav className="intent-crosslinks" aria-label="Andre visninger">
        <Link href="/i-dag">Åbent i dag</Link>
        <Link href="/naer-mig">I nærheden</Link>
        <Link href="/byer">Find din by</Link>
        <Link href="/">Kort & filtre</Link>
      </nav>
    </div>
  );
}
