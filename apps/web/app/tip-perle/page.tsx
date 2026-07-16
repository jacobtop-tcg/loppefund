import Link from 'next/link';
import type { Metadata } from 'next';
import { PerleTipForm } from './PerleTipForm.tsx';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const TITLE = 'Tip en skjult perle — loppelader, gårdsalg og dødsboer | Loppefund';
const DESCRIPTION =
  'Kender du en privat loppelade, et gårdsalg eller et dødsbo-lager, der ikke findes nogen steder online? Fortæl os om det — vi viser aldrig en privat adresse uden lov.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${BASE_PATH}/tip-perle` },
};

export default function TipPerlePage() {
  return (
    <div className="container">
      <Link href="/" className="back-link">
        ← Alle markeder
      </Link>
      <header className="detail-header">
        <div className="detail-category">Tip en skjult perle</div>
        <h1 className="detail-title">Kender du et sted, ingen andre kender?</h1>
        <p className="detail-place">
          De bedste fund ligger i en lade ad en grusvej — steder der aldrig når en
          markedskalender, fordi ejeren bare hænger et skilt op. Dem kan vi kun finde, hvis
          nogen som dig fortæller om dem.
        </p>
      </header>

      {/* The promise comes BEFORE the form. Someone about to type a neighbour's
          address deserves to know what we will and won't do with it, while they
          can still change their mind. */}
      <section className="perle-promise">
        <h2>Sådan behandler vi dit tip</h2>
        <ul>
          <li>
            <strong>Intet bliver lagt op automatisk.</strong> Et menneske læser tippet igennem
            først.
          </li>
          <li>
            <strong>Private adresser vises kun med lov.</strong> Er du i tvivl, viser vi kun det
            omtrentlige område — aldrig gaden, aldrig en rutevejledning til nogens hoveddør.
          </li>
          <li>
            <strong>Vi skriver hvor sikre vi er.</strong> Dit tip alene gør ikke et sted
            “bekræftet” — det ligger på Radar, indtil flere kilder eller et besøg bekræfter det.
          </li>
          <li>
            <strong>Fortryder du?</strong> Skriv til os, så fjerner vi det. Vi vil hellere mangle
            et sted end have et forkert.
          </li>
        </ul>
      </section>

      <PerleTipForm />

      <nav className="intent-crosslinks" aria-label="Andre visninger">
        <Link href="/skjulte-steder">Se skjulte steder</Link>
        <Link href="/tip">Tip et almindeligt marked</Link>
        <Link href="/">Kort &amp; filtre</Link>
      </nav>
    </div>
  );
}
