/**
 * Shared Playwright `test` for the Modia e2e suite.
 *
 * Every browser context adds the dev-only rate-limit bypass header to the
 * game's own /api requests (the Vite proxy forwards it to the API). Only
 * same-origin /api paths are touched: a context-wide extraHTTPHeaders would
 * also reach Google Fonts and trigger failing CORS preflights, and a
 * `**\/api/**` glob would also match Vite modules under /src/api/.
 *
 * Specs import `test` and `expect` from here instead of @playwright/test.
 */

import { test as base, expect } from '@playwright/test';
import { RATE_LIMIT_BYPASS_HEADERS } from './helpers/game.js';

function isGameApiRequest(url, baseURL) {
  return url.origin === new URL(baseURL).origin && url.pathname.startsWith('/api/');
}

export const test = base.extend({
  context: async ({ context, baseURL }, use) => {
    await context.route(url => isGameApiRequest(url, baseURL), route => {
      route.fallback({
        headers: { ...route.request().headers(), ...RATE_LIMIT_BYPASS_HEADERS }
      });
    });
    await use(context);
  }
});

export { expect };
