import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { BackLink } from '../../../components/BackLink.tsx';
import { DistanceFromYou } from '../../../components/DistanceFromYou.tsx';
import { getPublicInformalPlace, informalPlaceSlugs } from '../../../lib/informal.ts';
import { PLACE_TYPE_LABELS, STATUS_LABELS, TRUST_LAYER_LABELS } from '../../../lib/informal-labels.ts';

// A hidden place gets its OWN namespace (/perle/), never /marked/ or /sted/:
// those URLs are published, sitemapped and IndexNow-pushed, and overloading them
// would break the promise each one makes about what you'll find there.
export const dynamicParams = false;

export function generateStaticParams(): Array<{ slug: string }> {
  return informalPlaceSlugs();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const p = getPublicInformalPlace(slug);
  if (!p) return { title: 'Stedet blev ikke fundet — Loppefund' };
  const where = p.city ? ` ved ${p.city}` : '';
  const title = `${p.name}${where} — skjult loppested | Loppefund`;
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  return {
    title,
    // NOTE: no street in the description either. A private address must not leak
    // through a meta tag, a share card, or a search snippet.
    description: `${PLACE_TYPE_LABELS[p.placeType] ?? 'Skjult loppested'}${where}. Fundpotentiale ${p.fundScore}/100 — se status, kilder og hvor sikkert stedet er, før du kører.`,
    alternates: { canonical: `${basePath}/perle/${p.slug}` },
  };
}

/** A score with its reasoning — never a bare number the visitor must trust. */
function ScoreBar({
  label,
  score,
  tone,
  explain,
}: {
  label: string;
  score: number;
  tone: 'confidence' | 'fund';
  explain: string;
}) {
  return (
    <div className={`ip-score ip-score-${tone}`}>
      <div className="ip-score-head">
        <span className="ip-score-label">{label}</span>
        <strong className="ip-score-value">{score}/100</strong>
      </div>
      <div className="ip-score-track" aria-hidden>
        <div className="ip-score-fill" style={{ width: `${score}%` }} />
      </div>
      <p className="ip-score-explain">{explain}</p>
    </div>
  );
}

export default async function InformalPlacePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const p = getPublicInformalPlace(slug);
  if (!p) notFound();

  const typeLabel = PLACE_TYPE_LABELS[p.placeType] ?? 'Skjult loppested';
  const layer = TRUST_LAYER_LABELS[p.trustLayer];

  return (
    <div className="container">
      <BackLink href="/">← Alle markeder</BackLink>

      {/* The trust layer leads. A Radar place must announce itself as unproven
          BEFORE the visitor reads a tempting fund score and gets in the car. */}
      <div className={`ip-layer ip-layer-${p.trustLayer}`} role="status">
        <strong>{layer.title}</strong> {layer.body}
      </div>

      <header className="detail-header">
        <div className="detail-category">{typeLabel}</div>
        <h1 className="detail-title">{p.name}</h1>
        <p className="detail-place">
          {[p.street, [p.postcode, p.city].filter(Boolean).join(' ')].filter(Boolean).join(' · ') ||
            p.city ||
            'Sted ukendt'}
          {p.lat != null && p.lng != null && <DistanceFromYou lat={p.lat} lng={p.lng} />}
        </p>
        {p.addressNote && <p className="ip-address-note">{p.addressNote}</p>}
      </header>

      {(p.callBeforeVisiting || p.openWhenFlagIsOut) && (
        <div className="ip-warnings">
          {p.callBeforeVisiting && (
            <span className="ip-warn">
              Ring før du kører{p.phone ? ' — ' : ''}
              {p.phone && <a href={`tel:${p.phone.replace(/\s+/g, '')}`}>{p.phone}</a>}
            </span>
          )}
          {p.openWhenFlagIsOut && <span className="ip-warn">Åbent når flaget er ude</span>}
        </div>
      )}

      <div className="ip-scores">
        <ScoreBar
          label="Hvor sikre er vi på stedet?"
          score={p.confidence}
          tone="confidence"
          explain={`Status: ${STATUS_LABELS[p.status] ?? p.status}. Bygget på ${p.sources.length} ${p.sources.length === 1 ? 'kilde' : 'kilder'}${p.lastVerifiedAt ? `, senest bekræftet ${p.lastVerifiedAt}` : ''}.`}
        />
        <ScoreBar
          label="Fundpotentiale"
          score={p.fundScore}
          tone="fund"
          explain="Et skøn over sandsynligheden for gode køb — aldrig en garanti."
        />
      </div>

      {p.description && <p className="ip-description">{p.description}</p>}

      <section className="panel">
        <h2>Praktisk</h2>
        <dl className="ip-facts">
          <dt>Type</dt>
          <dd>{typeLabel}</dd>
          <dt>Status</dt>
          <dd>{STATUS_LABELS[p.status] ?? p.status}</dd>
          {p.recurrencePattern && (
            <>
              <dt>Åbner</dt>
              <dd>{p.recurrencePattern}</dd>
            </>
          )}
          {p.openingNotes && (
            <>
              <dt>Åbningstider</dt>
              <dd>{p.openingNotes}</dd>
            </>
          )}
          {p.priceLevel && (
            <>
              <dt>Prisniveau</dt>
              <dd>{{ lav: 'Lavt', middel: 'Middel', hoej: 'Højt' }[p.priceLevel]}</dd>
            </>
          )}
          {p.inventorySignals.length > 0 && (
            <>
              <dt>Varer</dt>
              <dd>{p.inventorySignals.join(', ')}</dd>
            </>
          )}
          <dt>Senest set</dt>
          <dd>{p.lastSeenAt.slice(0, 10)}</dd>
        </dl>
      </section>

      {/* Provenance: type + date + link only. The excerpt and the reviewer's
          identity stay internal — a source must be auditable without
          republishing someone's post or naming a moderator. */}
      <section className="panel">
        <h2>Hvorfor stedet er her</h2>
        <ul className="ip-sources">
          {p.sources.map((s, i) => (
            <li key={i}>
              <span className="ip-source-type">{s.sourceType.replace(/_/g, ' ')}</span>
              <span className="ip-source-date">{s.observedAt}</span>
              {s.url && (
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  kilde
                </a>
              )}
            </li>
          ))}
        </ul>
        {p.visitCount > 0 && (
          <p className="ip-visits">
            {p.visitCount} {p.visitCount === 1 ? 'besøgsrapport' : 'besøgsrapporter'} fra brugere.
          </p>
        )}
      </section>

      <p className="ip-report">
        Passer noget ikke? <Link href="/tip-perle">Send en rettelse</Link> — skjulte steder
        ændrer sig, og vi vil hellere fjerne et forkert end beholde det.
      </p>
    </div>
  );
}
