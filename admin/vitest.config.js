import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./src/tests/setup.js'],
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    // Cap worker fan-out: the default is one fork per CPU core (~32 on this
    // machine), which can exhaust memory and crash the host. Bound to 4.
    // Vitest 4 moved these to top-level (poolOptions was removed).
    pool: 'forks',
    maxWorkers: 4,
    minWorkers: 1,
    fileParallelism: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'src/tests/**',
        '**/*.d.ts',
        '**/*.config.{js,ts}',
        '**/index.js'
      ],
      // Baselined to vitest 4's v8 AST-aware coverage provider, which counts
      // functions/branches differently than vitest 2 did (same tests, lower
      // reported %). Thresholds sit just under current measured coverage so
      // the gate still catches regressions without blocking on the provider
      // re-count. Raise these as admin test coverage improves.
      thresholds: {
        branches: 55,
        functions: 45,
        lines: 70,
        statements: 70
      }
    },
    testTimeout: 10000,
    hookTimeout: 10000
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('../shared', import.meta.url))
    }
  }
});
