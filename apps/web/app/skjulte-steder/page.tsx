import Link from 'next/link';
import type { Metadata } from 'next';
import { listPublicInformalPlaces } from '../../lib/informal.ts';
import { PLACE_TYPE_LABELS, STATUS_LABELS, TRUST_LAYER_LABELS } from '../../lib/informal-labels.ts';
import type { TrustLayer } from '@loppefund/core';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const TITLE = 'Skjulte loppesteder — loppelader, gårdsalg og dødsboer | Loppefund';
const DESCRIPTION =
  'Private loppelader, gårdsalg, garagesalg og dødsbo-lagre — de steder der ikke findes på Google Maps eller i markedskalenderen. Med ærlig vurdering af hvor sikre vi er.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${BASE_PATH}/skjulte-steder` },
};

/**
 * The three trust layers, rendered as three SEPARATE sections.
 *
 * That separation is the product promise, not a layout choice: a Radar lead and
 * a confirmed place must never sit in one undifferentiated list where the eye
 * reads them as equally true. Order is deliberate — dependable first, unproven
 * last, each under its own honest heading.
 */
const LAYER_ORDER: TrustLayer[] = ['bekraeftet', 'kontroller-foerst', 'radar'];

export default function HiddenPlacesPage() {
  const places = listPublicInformalPlaces();
  const byLayer = new Map<TrustLayer, typeof places>();
  for (const l of LAYER_ORDER) byLayer.set(l, []);
  for (const p of places) byLayer.get(p.trustLayer)!.push(p);
  // Best find potential first WITHIN a layer — never across layers, so a
  // tempting Radar lead can't outrank a confirmed place.
  for (const l of LAYER_ORDER) byLayer.get(l)!.sort((a, b) => b.fundScore - a.fundScore);

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
        LAYER_ORDER.map((layer) => {
          const list = byLayer.get(layer)!;
          if (list.length === 0) return null;
          const meta = TRUST_LAYER_LABELS[layer];
          return (
            <section key={layer} className={`ip-section ip-section-${layer}`}>
              <h2 className="ip-section-title">{meta.title}</h2>
              <p className="ip-section-body">{meta.body}</p>
              <div className="event-grid">
                {list.map((p) => (
                  <Link key={p.slug} href={`/perle/${p.slug}`} className="ip-card">
                    <div className="ip-card-head">
                      <span className="ip-card-type">{PLACE_TYPE_LABELS[p.placeType]}</span>
                      <span className={`ip-card-fund ip-fund-${p.fundScore >= 70 ? 'high' : 'mid'}`}>
                        {p.fundScore}
                        <span className="ip-card-fund-unit">/100 fund</span>
                      </span>
                    </div>
                    <h3 className="ip-card-name">{p.name}</h3>
                    <div className="ip-card-where">
                      {p.city ?? 'Sted ukendt'}
                      {p.areaOnly && <span className="ip-card-area"> · ca. område</span>}
                    </div>
                    <div className="ip-card-meta">
                      <span>{STATUS_LABELS[p.status]}</span>
                      <span className="ip-card-conf">{p.confidence}/100 sikkerhed</span>
                    </div>
                    {p.callBeforeVisiting && <div className="ip-card-warn">Ring først</div>}
                  </Link>
                ))}
              </div>
            </section>
          );
        })
      )}

      <nav className="intent-crosslinks" aria-label="Andre visninger">
        <Link href="/tip-perle">Tip en skjult perle</Link>
        <Link href="/naer-mig">I nærheden</Link>
        <Link href="/">Kort &amp; filtre</Link>
      </nav>
    </div>
  );
}
