import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  transpilePackages: ['@relay/core'],
};

export default config;
