/** @type {import('next').NextConfig} */
const config = {
  transpilePackages: ['@fixtures/next-cases'],
  productionBrowserSourceMaps: true,
  poweredByHeader: false,
  // The CDN proxy fixture serves dev pages from 127.0.0.1.
  allowedDevOrigins: ['127.0.0.1'],
};

export default config;
