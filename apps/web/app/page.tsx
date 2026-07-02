import { copenhagenNow } from '@loppefund/core';
import { listUpcomingEvents, todayIso } from '../lib/data.ts';
import { Explorer } from '../components/Explorer.tsx';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  const events = listUpcomingEvents();
  const today = todayIso();
  const now = copenhagenNow();
  return (
    <>
      <header className="site-header container">
        <div className="wordmark">
          Loppefund<span className="dot">.</span>
        </div>
        <p className="tagline">Alle loppemarkeder i Danmark. Ét sted, altid opdateret.</p>
      </header>
      <main className="container">
        <Explorer events={events} today={today} now={now} />
      </main>
      <footer className="site-footer">
        <div className="container">
          Loppefund samler markeder automatisk fra offentlige kilder og viser altid, hvor
          oplysningerne kommer fra. Fandt du en fejl? Kilderne er linket på hvert marked.
        </div>
      </footer>
    </>
  );
}
