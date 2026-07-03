import Link from 'next/link';
import { listActiveSources, listDiscoveredSources } from '../../lib/data.ts';

export const metadata = {
  title: 'Kilder — hvor Loppefund henter markederne',
  description:
    'Loppefund samler loppemarkeder fra offentlige kilder og opdager løbende nye automatisk. Se hvilke kilder vi henter fra, og hvad discovery-motoren har fundet.',
};

function trustLabel(trust: number): string {
  if (trust >= 0.7) return 'Høj tillid';
  if (trust >= 0.55) return 'God tillid';
  if (trust >= 0.45) return 'Middel';
  return 'Fællesskab';
}

// Discovery status -> a short Danish label + a badge tone.
const STATUS: Record<string, { label: string; cls: string }> = {
  promoted: { label: 'Tilføjet', cls: 'free' },
  probed: { label: 'Undersøgt', cls: '' },
  candidate: { label: 'Ny kandidat', cls: 'unverified' },
  rejected: { label: 'Fravalgt', cls: 'cancelled' },
};

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export default function SourcesPage() {
  const active = listActiveSources().filter((s) => s.eventCount > 0 || s.key === 'tip');
  // A discovered domain that is now the base of an active source has been
  // "added" — derive it from the live sources rather than a status flag that
  // has to be maintained by hand, so it's always accurate.
  const activeHosts = new Set(active.map((s) => hostname(s.baseUrl)));
  const isAdded = (domain: string) => activeHosts.has(domain);
  const discovered = listDiscoveredSources();
  const promoted = discovered.filter((d) => isAdded(d.domain) || d.status === 'promoted').length;

  return (
    <div className="container">
      <Link href="/" className="back-link">
        ← Alle markeder
      </Link>
      <header className="detail-header">
        <div className="detail-category">Åbenhed om data</div>
        <h1 className="detail-title">Kilder</h1>
        <p className="detail-place" style={{ maxWidth: '58ch' }}>
          Loppefund henter loppemarkeder fra offentlige kilder, fletter dubletter
          sammen og viser altid hvor hvert marked kommer fra. Motoren opdager også
          løbende nye kilder helt automatisk — herunder ser du begge dele.
        </p>
      </header>

      <section className="panel" style={{ marginBottom: 20 }}>
        <h2>Kilder vi henter fra</h2>
        <p style={{ color: 'var(--ink-soft)', marginTop: 0 }}>
          {active.length} aktive kilder. Tillidsvægten afgør, om en kilde kan
          bekræfte et marked alene, eller om det kræver flere kilder.
        </p>
        <ul className="source-cards">
          {active.map((s) => (
            <li key={s.key} className="source-card">
              <div className="source-card-top">
                <span className="source-card-name">{s.name}</span>
                <span className={`badge ${s.trust >= 0.7 ? 'free' : s.trust >= 0.55 ? '' : 'unverified'}`}>
                  {trustLabel(s.trust)}
                </span>
              </div>
              <div className="source-card-meta">
                <span className="source-card-count">{s.eventCount} markeder</span>
                <a href={s.baseUrl} target="_blank" rel="noopener noreferrer">
                  {hostname(s.baseUrl)}
                </a>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Automatisk opdagede kilder</h2>
        <p style={{ color: 'var(--ink-soft)', marginTop: 0 }}>
          Discovery-motoren udleder nye domæner fra de data, vi allerede har
          hentet, undersøger dem for markeds-signaler og rangerer dem. {discovered.length}{' '}
          kandidater fundet · {promoted} allerede tilføjet som kilde.
        </p>
        <div className="source-table-wrap">
          <table className="source-table">
            <thead>
              <tr>
                <th>Domæne</th>
                <th className="num">Omtaler</th>
                <th className="num">Titler</th>
                <th className="num">Score</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {discovered.map((d) => {
                const st = isAdded(d.domain)
                  ? STATUS.promoted!
                  : (STATUS[d.status] ?? { label: d.status, cls: '' });
                return (
                  <tr key={d.domain}>
                    <td className="source-domain">{d.domain}</td>
                    <td className="num">{d.mentions}</td>
                    <td className="num">{d.distinctTitles}</td>
                    <td className="num">{d.probeScore == null ? '–' : d.probeScore}</td>
                    <td>
                      <span className={`badge ${st.cls}`}>{st.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="trust-note">
          Kender du en kilde, vi mangler? <Link href="/tip">Tip os her</Link> — så
          gør vi resten.
        </p>
      </section>
    </div>
  );
}
