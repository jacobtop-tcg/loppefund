import Link from 'next/link';
import type { Metadata } from 'next';
import { listPublicInformalPlaces } from '../../lib/informal.ts';
import HiddenPlaces from '../../components/HiddenPlaces.tsx';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const TITLE = 'Skjulte loppesteder — loppelader, gårdsalg og dødsboer | Loppefund';
const DESCRIPTION =
  'Private loppelader, gårdsalg, garagesalg og dødsbo-lagre — de steder der ikke findes på Google Maps eller i markedskalenderen. Med ærlig vurdering af hvor sikre vi er.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${BASE_PATH}/skjulte-steder` },
};

export default function HiddenPlacesPage() {
  // The server's only job here: publish the vetted view. Every place has
  // already been through publicView(), so the client component receives nothing
  // it must not render — filtering in the browser cannot leak an address it was
  // never given.
  const places = listPublicInformalPlaces();

  return (
    <div className="container">
      <Link href="/" className="back-link">
        ← Alle markeder
      </Link>
      <header className="detail-header">
        <div className="detail-category">Skjulte steder</div>
        <h1 className="detail-title">Skjulte loppesteder</h1>
        <p className="detail-place">
          Private loppelader, gårdsalg og dødsbo-lagre — dem der aldrig når en markedskalender.
          Vi viser hvor sikre vi er på hvert sted, og hvor gode fund du kan håbe på. De to ting er
          ikke det samme.
        </p>
      </header>

      {places.length === 0 ? (
        <div className="empty-state">
          <p>
            Ingen skjulte steder er bekræftet endnu. De findes kun, når nogen har været der —
            derfor bygger vi dem på tips fra folk der kender deres egen egn.
          </p>
          <Link href="/tip-perle" className="empty-cta">
            Kender du et skjult loppested? →
          </Link>
        </div>
      ) : (
        <HiddenPlaces places={places} />
      )}

      <nav className="intent-crosslinks" aria-label="Andre visninger">
        <Link href="/tip-perle">Tip en skjult perle</Link>
        <Link href="/naer-mig">I nærheden</Link>
        <Link href="/">Kort &amp; filtre</Link>
      </nav>
    </div>
  );
}
