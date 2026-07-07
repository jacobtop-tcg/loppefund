import Link from 'next/link';

/**
 * Branded 404 (static export renders this to /404.html). Markets come and go,
 * and dead /marked/* links shared in Facebook groups are a steady stream of
 * first visits — greet them warmly and reroute them to a live weekend instead
 * of the browser's stark default.
 */
export default function NotFound() {
  return (
    <div className="container notfound">
      <p className="notfound-eyebrow">404 · Siden findes ikke</p>
      <h1 className="notfound-title">Det marked er pakket sammen</h1>
      <p className="notfound-lead">
        Loppemarkeder kommer og går — måske er datoen passeret, eller linket er forældet.
        Men der er altid nye fund lige om hjørnet.
      </p>
      <div className="notfound-actions">
        <Link href="/i-weekenden" className="notfound-cta primary">
          Se markeder i weekenden
        </Link>
        <Link href="/byer" className="notfound-cta">
          Find din by
        </Link>
        <Link href="/" className="notfound-cta">
          Til forsiden
        </Link>
      </div>
    </div>
  );
}
