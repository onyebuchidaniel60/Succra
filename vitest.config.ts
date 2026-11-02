import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    // Only apps/web uses the `@/*` import prefix (Next.js convention).
    alias: {
      '@': fileURLToPath(new URL('./apps/web', import.meta.url)),
    },
  },
  test: {
    include: [
      'apps/*/tests/**/*.test.{ts,tsx}',
      'packages/*/tests/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    environment: 'node',
  },
});
