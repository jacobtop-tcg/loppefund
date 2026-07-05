import type { MetadataRoute } from 'next';
import { listCities, listUpcomingEvents } from '../lib/data.ts';

export const dynamic = 'force-static';

const BASE = process.env.LOPPEFUND_BASE_URL ?? 'https://jacobtop-tcg.github.io/loppefund';

export default function sitemap(): MetadataRoute.Sitemap {
  const events = listUpcomingEvents(180);
  return [
    { url: BASE, changeFrequency: 'daily', priority: 1 },
    // The two highest-intent time-based searches get their own indexable pages.
    { url: `${BASE}/i-dag`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE}/i-weekenden`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE}/byer`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE}/kilder`, changeFrequency: 'weekly', priority: 0.5 },
    ...listCities().map((c) => ({
      url: `${BASE}/by/${c.slug}`,
      changeFrequency: 'daily' as const,
      priority: 0.8,
    })),
    ...events.map((e) => ({
      url: `${BASE}/marked/${e.slug}`,
      changeFrequency: 'daily' as const,
      priority: 0.7,
    })),
  ];
}
