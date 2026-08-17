/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `@weaver/contracts` ships as a local workspace package; Next compiles it from source rather
  // than expecting a prebuilt bundle.
  transpilePackages: ['@weaver/contracts'],
};

export default nextConfig;
