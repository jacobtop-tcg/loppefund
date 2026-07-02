import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@loppefund/core', '@loppefund/db'],
  serverExternalPackages: [],
};

export default nextConfig;
