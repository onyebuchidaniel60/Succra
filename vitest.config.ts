import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Only apps/web uses the `@/*` import prefix (Next.js convention).
    alias: {
      '@': fileURLToPath(new URL('./apps/web', import.meta.url)),
    },
  },
  test: {
    include: ['apps/*/tests/**/*.test.ts', 'packages/*/tests/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
  },
});
