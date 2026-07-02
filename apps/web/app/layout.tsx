import type { Metadata } from 'next';
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
  metadataBase: new URL(BASE_URL),
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="da" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
