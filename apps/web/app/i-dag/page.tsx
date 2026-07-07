import Link from 'next/link';
import type { Metadata } from 'next';
import { listUpcomingEvents, todayIso } from '../../lib/data.ts';
import { collectionJsonLd, safeJsonLd } from '../../lib/jsonld.ts';
import { firstDateInWindow, occurrenceWindow } from '../../lib/client-utils.ts';
import { DatePageList } from '../../components/DatePageList.tsx';

// "loppemarked i dag" — the other high-intent Danish search. A static page can
// go stale, so the market list is a client island that re-derives "today" from
// the live Copenhagen clock after mount; a page built yesterday never presents
// yesterday's markets as today's. See DatePageList.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const TITLE = 'Loppemarkeder i dag i Danmark — Loppefund';
const DESCRIPTION =
  'Se hvilke loppemarkeder, kræmmermarkeder og bagagerumsmarkeder der har åbent i dag i hele Danmark. Åbningstider, adresser og priser — altid opdateret.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${BASE_PATH}/i-dag` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${BASE_PATH}/i-dag`,
    type: 'website',
    siteName: 'Loppefund',
    locale: 'da_DK',
    images: [{ url: `${BASE_PATH}/opengraph-image`, width: 1200, height: 630, alt: TITLE }],
  },
  twitter: { card: 'summary_large_image', images: [`${BASE_PATH}/opengraph-image`] },
};

export default function TodayPage() {
  const today = todayIso();
  const candidates = listUpcomingEvents(16);
  const [from, to] = occurrenceWindow('today', today);
  const todayItems = candidates
    .filter((e) => firstDateInWindow(e.occurrences, from, to) !== null)
    .map((e) => ({ slug: e.slug, title: e.title }));

  return (
    <div className="container">
      {todayItems.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLd(
              collectionJsonLd({
                name: 'Loppemarkeder i dag i Danmark',
                path: '/i-dag',
                items: todayItems,
              }),
            ),
          }}
        />
      )}
      <Link href="/" className="back-link">
        ← Alle markeder
      </Link>
      <header className="detail-header">
        <div className="detail-category">I dag</div>
        <h1 className="detail-title">Loppemarkeder i dag</h1>
        <p className="detail-place">
          Alle loppemarkeder i Danmark, der har åbent i dag — åbningstider, adresser og priser,
          opdateret automatisk fra offentlige kilder.
        </p>
      </header>
      <DatePageList events={candidates} buildToday={today} kind="today" />
      <nav className="intent-crosslinks" aria-label="Andre visninger">
        <Link href="/i-weekenden">I weekenden</Link>
        <Link href="/naer-mig">I nærheden</Link>
        <Link href="/byer">Find din by</Link>
        <Link href="/">Kort & filtre</Link>
      </nav>
    </div>
  );
}
