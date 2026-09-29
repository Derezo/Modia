/**
 * Deletes the throwaway e2etest_ accounts (and their characters, battles,
 * inventory, orders, ...) created during this run, using the same cascade
 * the API integration suites use.
 */
import { cleanupTestUsers, pool, query } from '../api/src/tests/testHelper.js';

// Keep in step with E2E_USERNAME_PREFIX in helpers/game.js (a CommonJS-
// transpiled module that this ESM hook cannot import by name).
const E2E_USERNAME_PREFIX = 'e2etest_';

export default async function globalTeardown() {
  const floor = Number.parseInt(process.env.E2E_USER_ID_FLOOR ?? '', 10);
  try {
    if (!Number.isSafeInteger(floor)) {
      console.warn('[e2e teardown] E2E_USER_ID_FLOOR not set; skipping account cleanup');
      return;
    }
    const result = await query(
      `SELECT id FROM users
       WHERE id > $1 AND username LIKE $2 ESCAPE '\\'
       ORDER BY id`,
      [floor, `${E2E_USERNAME_PREFIX.replace(/_/g, '\\_')}%`]
    );
    const ids = result.rows.map(row => row.id);
    if (ids.length > 0) {
      await cleanupTestUsers(ids);
    }
    console.log(`[e2e teardown] removed ${ids.length} e2etest_ account(s)`);
  } finally {
    await pool.end();
  }
}
