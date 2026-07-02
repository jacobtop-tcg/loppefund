import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

const BASE = process.env.LOPPEFUND_BASE_URL ?? 'https://loppefund.dk';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${BASE}/sitemap.xml`,
  };
}
