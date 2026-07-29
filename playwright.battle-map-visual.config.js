import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'battle-map-render.spec.js',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'line' : 'list',
  outputDir: 'artifacts/battle-map-visual-test-results',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1120, height: 760 },
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: {
    command:
      'npm run dev -w frontend -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/battle-map-visual.html?autorun=0',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000
  },
  timeout: 12 * 60 * 1000,
  expect: {
    timeout: 10 * 1000
  }
});
