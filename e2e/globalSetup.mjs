/**
 * Records the highest existing user id so globalTeardown deletes only the
 * e2etest_ accounts created by this run (other runs and agents may share the
 * dev database).
 */
import { query } from '../api/src/tests/testHelper.js';

export default async function globalSetup() {
  const result = await query('SELECT COALESCE(MAX(id), 0) AS max_id FROM users');
  process.env.E2E_USER_ID_FLOOR = String(result.rows[0].max_id);
}
