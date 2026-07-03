import { ImageResponse } from 'next/og';

// Site-wide fallback OG card. next/font is not usable inside ImageResponse, so
// only system-safe generic families are styled — they render æøå fine. The
// default nodejs runtime is compatible with output:export (edge is not).
// No dynamic params, so output:export needs an explicit static directive.
export const dynamic = 'force-static';
export const alt = 'Loppefund — alle loppemarkeder i Danmark';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const PAPER = '#faf5ec';
const INK = '#241f19';
const ACCENT = '#e4572e';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          background: PAPER,
          color: INK,
          padding: '90px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', fontSize: 88, fontWeight: 800, letterSpacing: -2, fontFamily: 'serif' }}>
          <span>Loppefund</span>
          <span style={{ color: ACCENT }}>.</span>
        </div>
        <div style={{ display: 'flex', marginTop: 28, fontSize: 46, fontWeight: 600 }}>
          Alle loppemarkeder i Danmark
        </div>
        <div style={{ display: 'flex', marginTop: 18, fontSize: 34, color: '#6b6156' }}>
          Hvor skal I hen i weekenden?
        </div>
      </div>
    ),
    size,
  );
}
