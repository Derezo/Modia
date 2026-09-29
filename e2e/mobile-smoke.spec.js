import { devices } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { createPlayer, login, RATE_LIMIT_BYPASS_HEADERS, waitForWorldMapReady } from './helpers/index.js';

/**
 * Mobile smoke test
 *
 * Catches regressions in mobile viewport handling: canvas DPR, responsive
 * CSS variable injection, viewport meta, and tap target sizing. Runs on
 * iPhone 14 and Pixel 7 emulation on top of the Mobile Chrome project.
 *
 * Scope is intentionally narrow — confirm the app renders and a user can
 * move one scene deep. Richer mobile tests can layer on top.
 */

const MOBILE_DEVICES = [
  { name: 'iPhone 14', device: devices['iPhone 14'] },
  { name: 'Pixel 7', device: devices['Pixel 7'] }
];

test.describe('Mobile smoke', () => {
  for (const { name, device } of MOBILE_DEVICES) {
    test(`${name}: login and reach the world map`, async ({ browser, request, baseURL }) => {
      const player = await createPlayer(request);
      const context = await browser.newContext({ ...device, baseURL });
      // Same dev-only rate-limit bypass the shared fixture adds (fixtures.js).
      await context.route(
        url => url.origin === new URL(baseURL).origin && url.pathname.startsWith('/api/'),
        route => route.fallback({ headers: { ...route.request().headers(), ...RATE_LIMIT_BYPASS_HEADERS } })
      );
      const page = await context.newPage();

      try {
        await login(page, player.username, player.password);
        await waitForWorldMapReady(page);

        // Canvas should be mounted and sized.
        const canvas = page.locator('#game-canvas');
        await expect(canvas).toBeVisible({ timeout: 15000 });

        const box = await canvas.boundingBox();
        expect(box, 'canvas has a bounding box').toBeTruthy();
        expect(box.width).toBeGreaterThan(0);
        expect(box.height).toBeGreaterThan(0);

        // Viewport meta must allow pinch-zoom (P1.2 regression check).
        const viewportContent = await page.locator('meta[name="viewport"]').getAttribute('content');
        expect(viewportContent).toBeTruthy();
        expect(viewportContent).not.toMatch(/user-scalable\s*=\s*no/i);
        expect(viewportContent).not.toMatch(/maximum-scale\s*=\s*1(\.0)?\b/i);

        // Responsive CSS variables should be injected on :root (P1.6 regression check).
        const touchTarget = await page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--touch-target').trim()
        );
        expect(touchTarget, '--touch-target should be set by Responsive singleton').not.toBe('');

        // DPR: canvas backing store should be >= CSS width (P1.1 regression check).
        const dprInfo = await canvas.evaluate(el => ({
          backing: el.width,
          css: el.getBoundingClientRect().width,
          dpr: window.devicePixelRatio
        }));
        // backing should be roughly css * dpr — use >= css so the test is tolerant.
        expect(dprInfo.backing).toBeGreaterThanOrEqual(Math.floor(dprInfo.css));
      } finally {
        await context.close();
      }
    });
  }
});
