import { ImageResponse } from 'next/og';
import { listCities } from '../../../lib/data.ts';
import { displayPlace } from '../../../lib/format.ts';

// One share card per city landing page. Static at build (nodejs runtime,
// output:export compatible). Mirrors the page's static params.
export const dynamicParams = false;

export function generateStaticParams(): Array<{ city: string }> {
  return listCities().map((c) => ({ city: c.slug }));
}

export const alt = 'Loppemarkeder i din by — Loppefund';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const PAPER = '#faf5ec';
const INK = '#241f19';
const ACCENT = '#e4572e';
const ACCENT_DEEP = '#c73e18';

export default async function CityOgImage({ params }: { params: Promise<{ city: string }> }) {
  const { city } = await params;
  const info = listCities().find((c) => c.slug === city);
  const name = info ? displayPlace(info.city) : 'Danmark';
  const count = info?.count ?? 0;
  const subline =
    count > 0
      ? `${count} kommende ${count === 1 ? 'marked' : 'markeder'} — altid opdateret`
      : 'Datoer, åbningstider og adresser — altid opdateret';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: PAPER,
          color: INK,
          padding: '80px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', fontSize: 44, fontWeight: 800, letterSpacing: -1, fontFamily: 'serif' }}>
          <span>Loppefund</span>
          <span style={{ color: ACCENT }}>.</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 40, fontWeight: 600, color: '#6b6156', marginBottom: 14 }}>
            Loppemarkeder i
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 96,
              fontWeight: 800,
              lineHeight: 1.02,
              letterSpacing: -3,
              fontFamily: 'serif',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxHeight: 200,
            }}
          >
            {name}
          </div>
        </div>

        <div style={{ display: 'flex', fontSize: 40, fontWeight: 600, color: ACCENT_DEEP }}>
          {subline}
        </div>
      </div>
    ),
    size,
  );
}
