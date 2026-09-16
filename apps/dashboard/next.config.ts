import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingIncludes: {
    '/api/operator/journey-reports/*': ['./app/fonts/Inter-Variable.ttf'],
  },
  transpilePackages: ['@tulink/ui'],
};

export default nextConfig;
