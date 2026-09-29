import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

// The API listens on PORT from .env (3001 in local dev). Loading .env keeps
// PORT and TEST_BYPASS_SECRET in step with the running API.
const API_PORT = process.env.PORT || 3001;

// The frontend dev server is fixed at 8080. E2E_BASE_URL points the suite at
// another already-running frontend instead (for example a Vite instance with
// HMR disabled, so edits elsewhere in the tree cannot full-reload a page in
// the middle of a test); Playwright then does not manage a frontend server.
const FRONTEND_URL = process.env.E2E_BASE_URL || 'http://localhost:8080';

// Headless Chromium defaults to SwiftShader, which rasterizes the battle map
// canvas at roughly one frame every five seconds and starves the page's main
// thread. These flags let it use the host GPU through ANGLE/EGL; a host
// without one falls back to SwiftShader as before.
const CHROMIUM_GPU_ARGS = [
  '--use-angle=gl-egl',
  '--use-gl=angle',
  '--ignore-gpu-blocklist',
  '--enable-gpu'
];

/**
 * Playwright configuration for Modia E2E tests
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',
  // The battle-map visual gallery has its own config, server and artifact
  // output (npm run battle-maps:visual-gallery); here it would overwrite the
  // tracked artifacts/battle-map-visual-gallery/manifest.json.
  testIgnore: ['battle-map-render.spec.js'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Cap local workers to 4. Default (undefined) uses ~half the CPU cores,
  // which on this 32-core host spawns enough browser instances to crash it.
  workers: process.env.CI ? 1 : 4,
  reporter: 'html',
  // Deletes the e2etest_ accounts this run created (e2e/globalTeardown.mjs).
  globalSetup: './e2e/globalSetup.mjs',
  globalTeardown: './e2e/globalTeardown.mjs',

  use: {
    baseURL: FRONTEND_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: { args: CHROMIUM_GPU_ARGS } },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    /* Test against mobile viewports */
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'], launchOptions: { args: CHROMIUM_GPU_ARGS } },
    },
  ],

  /* Run local dev servers before starting tests */
  webServer: [
    {
      command: 'npm run dev:api',
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    },
    ...(process.env.E2E_BASE_URL ? [] : [{
      command: 'npm run dev:frontend',
      url: FRONTEND_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    }]),
  ],

  /* Global test timeout */
  timeout: 30 * 1000,
  expect: {
    timeout: 5000,
  },
});
