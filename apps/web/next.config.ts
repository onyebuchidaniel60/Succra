import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Phase 3: default App Router behavior. No rewrites, no headers, no
  // experimental flags.
  // Phase 4: @succra/shared is TypeScript workspace source (NodeNext-style
  // `.js` relative imports). Next skips TS resolution for symlinked
  // node_modules by default, so the package is transpiled as source and
  // `.js` specifiers alias to TypeScript files.
  transpilePackages: ['@succra/shared'],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
    };
    return config;
  },
};

export default nextConfig;
