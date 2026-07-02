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

export const metadata: Metadata = {
  title: 'Loppefund — alle loppemarkeder i Danmark',
  description:
    'Find loppemarkeder, kræmmermarkeder og bagagerumsmarkeder i hele Danmark. Opdateret automatisk, verificeret og samlet ét sted.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="da" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
