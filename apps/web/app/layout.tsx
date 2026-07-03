import type { Metadata, Viewport } from 'next';
import { Fraunces, Instrument_Sans } from 'next/font/google';
import './globals.css';

const display = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  axes: ['SOFT', 'WONK', 'opsz'],
});

const body = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-body',
});

const BASE_URL = process.env.LOPPEFUND_BASE_URL ?? 'https://loppefund.dk';

export const metadata: Metadata = {
  // Origin only — never the basePath. Next auto-prefixes basePath onto the
  // generated opengraph-image asset path, so a metadataBase that also carried
  // "/loppefund" would double it (…/loppefund/loppefund/…). Relative og:url
  // values below therefore carry the basePath explicitly.
  metadataBase: new URL(new URL(BASE_URL).origin),
  // Homepage canonical (basePath-prefixed, resolves against the origin-only
  // metadataBase). Child routes override this in their own generateMetadata.
  alternates: { canonical: `${process.env.LOPPEFUND_BASE_PATH ?? ''}/` },
  appleWebApp: { capable: true, title: 'Loppefund', statusBarStyle: 'default' },
  icons: {
    apple: `${process.env.LOPPEFUND_BASE_PATH ?? ''}/apple-touch-icon.png`,
  },
  title: 'Loppefund — alle loppemarkeder i Danmark',
  description:
    'Find loppemarkeder, kræmmermarkeder og bagagerumsmarkeder i hele Danmark. Opdateret automatisk, verificeret og samlet ét sted.',
  // Shares in Facebook groups are the primary adoption channel — the card
  // must look premium.
  openGraph: {
    type: 'website',
    siteName: 'Loppefund',
    locale: 'da_DK',
    title: 'Loppefund — alle loppemarkeder i Danmark',
    description:
      'Hvor skal I hen i weekenden? Alle danske loppemarkeder samlet ét sted — med kort, datoer og ruteplan.',
  },
};

// viewport-fit=cover is required for the env(safe-area-inset-*) offsets on the
// floating view-pill and trip-bar to resolve on notched devices.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="da" className={`${display.variable} ${body.variable}`}>
      {/* Next's App Router hoists <link> elements rendered in a Server
          Component into <head>, so these preconnect hints warm up the map
          tile origin before the first tile request. */}
      <link rel="preconnect" href="https://tiles.openfreemap.org" crossOrigin="anonymous" />
      <link rel="dns-prefetch" href="https://tiles.openfreemap.org" />
      <body>{children}</body>
    </html>
  );
}
