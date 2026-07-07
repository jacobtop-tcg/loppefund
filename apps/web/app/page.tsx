import Link from 'next/link';
import { copenhagenNow } from '@loppefund/core';
import { latestUpdate, listUpcomingEvents, listVenues } from '../lib/data.ts';
import { formatUpdated } from '../lib/format.ts';
import { Explorer } from '../components/Explorer.tsx';

// Statically generated at build; a scheduled rebuild refreshes the data.
// `next dev` always re-renders, so local development still sees live data.
export default function HomePage() {
  const events = listUpcomingEvents();
  // Only the COUNT is needed here (for the hero); the full venue list is
  // lazy-loaded client-side from /venues.json when the layer is opened.
  const venueCount = listVenues().length;
  const now = copenhagenNow();
  const updated = latestUpdate();
  // "Continuously updated" made visible: markets first discovered in the last
  // ~10 days. Reuses the guarded `newlyAdded` signal (self-suppresses after an
  // offline rebuild), so this only ever shows a real, honest discovery count.
  const newCount = events.filter((e) => e.newlyAdded).length;
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
          <p className="hero-stats">
            <strong>{events.length.toLocaleString('da-DK')}</strong> markeder
            <span className="hero-dot" aria-hidden>
              ·
            </span>
            <strong>{venueCount.toLocaleString('da-DK')}</strong> faste steder
            {newCount > 0 && (
              <span className="hero-fresh">
                <span className="live-dot" aria-hidden />
                {newCount} {newCount === 1 ? 'nyt marked' : 'nye markeder'} for nylig
              </span>
            )}
          </p>
          {updated && (
            <p className="hero-updated">Data opdateret {formatUpdated(updated)}</p>
          )}
        </div>
      </header>
      <main id="markeder" className="explorer-main">
        <Explorer events={events} now={now} />
      </main>
      <footer className="site-footer">
        <div className="explorer-main">
          Loppefund samler markeder automatisk fra offentlige kilder og viser altid, hvor
          oplysningerne kommer fra. Fandt du en fejl? Kilderne er linket på hvert marked.{' '}
          <Link href="/i-dag" style={{ color: 'var(--accent-deep)', fontWeight: 600 }}>
            Loppemarkeder i dag →
          </Link>{' '}
          <Link href="/i-weekenden" style={{ color: 'var(--accent-deep)', fontWeight: 600 }}>
            · I weekenden →
          </Link>{' '}
          <Link href="/byer" style={{ color: 'var(--accent-deep)', fontWeight: 600 }}>
            · Find din by →
          </Link>{' '}
          <Link href="/tip" style={{ color: 'var(--accent-deep)', fontWeight: 600 }}>
            · Tip os →
          </Link>{' '}
          <Link href="/kilder" style={{ color: 'var(--accent-deep)', fontWeight: 600 }}>
            · Se vores kilder →
          </Link>
          {updated && (
            <div className="data-freshness">
              Data senest opdateret {formatUpdated(updated)}
            </div>
          )}
          <div className="data-freshness">
            Faste butikker og åbningstider fra{' '}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'inherit', textDecoration: 'underline' }}
            >
              © OpenStreetMap
            </a>{' '}
            bidragydere
          </div>
        </div>
      </footer>
    </>
  );
}
