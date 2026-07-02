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
      <div className="city-cloud">
        {cities.map((c) => (
          <Link key={c.slug} href={`/by/${c.slug}`} className="chip">
            {displayPlace(c.city)} <span className="city-count">{c.count}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
