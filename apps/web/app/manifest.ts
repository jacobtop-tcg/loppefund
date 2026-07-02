import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

const BASE_PATH = process.env.LOPPEFUND_BASE_PATH ?? '';

/**
 * PWA manifest: "Føj til hjemmeskærm" puts Loppefund next to the native
 * apps — the literal mechanics of "opens this app first" on mobile.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Loppefund — alle loppemarkeder i Danmark',
    short_name: 'Loppefund',
    description:
      'Find loppemarkeder, kræmmermarkeder og bagagerumsmarkeder i hele Danmark.',
    lang: 'da',
    start_url: `${BASE_PATH}/`,
    scope: `${BASE_PATH}/`,
    display: 'standalone',
    background_color: '#faf5ec',
    theme_color: '#faf5ec',
    icons: [
      { src: `${BASE_PATH}/icon-192.png`, sizes: '192x192', type: 'image/png' },
      { src: `${BASE_PATH}/icon-512.png`, sizes: '512x512', type: 'image/png' },
      {
        src: `${BASE_PATH}/icon-512.png`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
