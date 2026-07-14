import Link from 'next/link';
import { listCities } from '../../lib/data.ts';
import { displayPlace } from '../../lib/format.ts';

export const metadata = {
  title: 'Loppemarkeder by for by — Loppefund',
  description:
    'Find loppemarkeder, kræmmermarkeder og bagagerumsmarkeder i din by. Guides til over 100 danske byer, altid opdateret.',
};

export default function CitiesPage() {
  const cities = listCities();
  return (
    <div className="container">
      <Link href="/" className="back-link">
        ← Alle markeder
      </Link>
      <header className="detail-header">
        <div className="detail-category">By for by</div>
        <h1 className="detail-title">Loppemarkeder i hele Danmark</h1>
        <p className="detail-place">Vælg din by og se alle kommende markeder.</p>
      </header>
      {/* The big cities greet you as cards; the long tail stays a compact cloud. */}
      <div className="city-lead">
        {cities.slice(0, 8).map((c) => (
          <Link key={c.slug} href={`/by/${c.slug}`} className="city-lead-card">
            <span className="city-lead-name">{displayPlace(c.city)}</span>
            <span className="city-lead-count">
              {c.count > 0
                ? `${c.count} ${c.count === 1 ? 'marked' : 'markeder'}`
                : `${c.venueCount} ${c.venueCount === 1 ? 'butik' : 'butikker'}`}
            </span>
          </Link>
        ))}
      </div>
      {cities.length > 8 && (
        <>
          <h2 className="city-rest-heading">Flere byer</h2>
          <div className="city-cloud">
            {cities.slice(8).map((c) => (
              <Link key={c.slug} href={`/by/${c.slug}`} className="chip">
                {displayPlace(c.city)}{' '}
                <span className="city-count">{c.count > 0 ? c.count : c.venueCount}</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
