import type { NextConfig } from 'next';

// Static export: the consumer app only READS the SQLite database (the pipeline
// writes it offline), so the whole site pre-renders to plain HTML/JS and hosts
// for free on GitHub Pages / Cloudflare Pages. All filtering, search, map and
// trip-planning already run client-side. `LOPPEFUND_STATIC=1` turns it on;
// unset it for local `next dev` with live server rendering.
const staticExport = process.env.LOPPEFUND_STATIC === '1';

const nextConfig: NextConfig = {
  transpilePackages: ['@loppefund/core', '@loppefund/db'],
  ...(staticExport
    ? { output: 'export', images: { unoptimized: true } }
    : {}),
  // Serve under a repo subpath on GitHub Pages when configured.
  ...(process.env.LOPPEFUND_BASE_PATH
    ? { basePath: process.env.LOPPEFUND_BASE_PATH }
    : {}),
};

export default nextConfig;
