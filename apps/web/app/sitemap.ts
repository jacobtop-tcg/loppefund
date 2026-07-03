import type { MetadataRoute } from 'next';
import { listCities, listUpcomingEvents } from '../lib/data.ts';

export const dynamic = 'force-static';

const BASE = process.env.LOPPEFUND_BASE_URL ?? 'https://loppefund.dk';

export default function sitemap(): MetadataRoute.Sitemap {
  const events = listUpcomingEvents(180);
  return [
    { url: BASE, changeFrequency: 'daily', priority: 1 },
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
