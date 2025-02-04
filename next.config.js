/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: { unoptimized: true },
  // Optimize bundling and transpilation
  transpilePackages: ['@radix-ui/react-progress'],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@radix-ui/react-progress': require.resolve('@radix-ui/react-progress'),
    };
    return config;
  },
  // Configure static export
  trailingSlash: true,
};

module.exports = nextConfig;
