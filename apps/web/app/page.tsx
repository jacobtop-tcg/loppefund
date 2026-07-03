import Link from 'next/link';
import { copenhagenNow } from '@loppefund/core';
import { listUpcomingEvents, todayIso } from '../lib/data.ts';
import { Explorer } from '../components/Explorer.tsx';

// Statically generated at build; a scheduled rebuild refreshes the data.
// `next dev` always re-renders, so local development still sees live data.
export default function HomePage() {
  const events = listUpcomingEvents();
  const today = todayIso();
  const now = copenhagenNow();
  return (
    <>
      <a className="skip-link" href="#markeder">
        Spring til markederne
      </a>
      <header className="site-header explorer-main">
        <div className="brand-row">
          <h1 className="wordmark">
            Loppefund<span className="dot">.</span>
          </h1>
          <p className="tagline">Alle loppemarkeder i Danmark. Ét sted, altid opdateret.</p>
        </div>
      </header>
      <main id="markeder" className="explorer-main">
        <Explorer events={events} today={today} now={now} />
      </main>
      <footer className="site-footer">
        <div className="explorer-main">
          Loppefund samler markeder automatisk fra offentlige kilder og viser altid, hvor
          oplysningerne kommer fra. Fandt du en fejl? Kilderne er linket på hvert marked.{' '}
          <Link href="/tip" style={{ color: 'var(--accent-deep)', fontWeight: 600 }}>
            Mangler vi et marked? Tip os →
          </Link>{' '}
          <Link href="/byer" style={{ color: 'var(--accent-deep)', fontWeight: 600 }}>
            · Find din by →
          </Link>
        </div>
      </footer>
    </>
  );
}
