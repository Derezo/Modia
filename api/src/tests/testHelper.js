import 'dotenv/config';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, getClient, withTransaction, query } from '../config/database.js';
import {
  isRateLimitingEnabled,
  TEST_BYPASS_HEADER,
  TEST_BYPASS_SECRET
} from '../middleware/rateLimiterFactory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Local dev runs the API on PORT from .env (3001). Keep the fallback in step
// with that so a missing PORT never targets an unrelated app on 3000.
const BASE_URL = process.env.TEST_API_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.TEST_REQUEST_TIMEOUT_MS || '30000', 10);

// ============================================================================
// Test Isolation Utilities
// ============================================================================

/**
 * Track test data for cleanup
 * Each test file can register cleanup callbacks
 */
const cleanupCallbacks = [];

/**
 * Register a cleanup callback to be run after tests
 * @param {Function} callback - Async cleanup function
 */
function registerCleanup(callback) {
  cleanupCallbacks.push(callback);
}

/**
 * Run all registered cleanup callbacks
 * Call this in after() hooks
 */
async function runCleanup() {
  for (const callback of cleanupCallbacks) {
    try {
      await callback();
    } catch (err) {
      console.warn('Cleanup callback failed:', err.message);
    }
  }
  cleanupCallbacks.length = 0;
}

/**
 * Delete a complete set of test-owned users and their associated data.
 *
 * Shared active battles are only safe to delete when every participant is in
 * this cleanup scope. Terminal battles with an out-of-scope participant are
 * retained and detached only after all terminal events are fully processed.
 *
 * @param {Array<number>} userIds - Complete set of test-owned user IDs
 */
/**
 * Wait until the running API's terminal outbox worker has released every
 * claim on the given battles' terminal effect events.
 *
 * cleanupTestUsers() deliberately refuses to delete users while a terminal
 * event is actively claimed. A suite whose last test commits a terminal
 * battle event must therefore let the asynchronous worker finish its drain
 * tick before cleanup, or teardown races the worker.
 *
 * @param {number[]} battleIds - Battle ids whose outbox rows to wait on
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=10000] - Give up after this long
 * @param {number} [options.intervalMs=100] - Poll interval
 */
async function waitForTerminalOutboxSettled(
  battleIds,
  { timeoutMs = 10000, intervalMs = 100 } = {}
) {
  const ids = [...new Set(
    (battleIds || [])
      .map(Number)
      .filter(battleId => Number.isSafeInteger(battleId) && battleId > 0)
  )];
  if (ids.length === 0) return;

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const claimed = await query(
      `SELECT battle_id, event_key, attempts, last_error
       FROM battle_terminal_effect_outbox
       WHERE battle_id = ANY($1::int[])
         AND claim_token IS NOT NULL
         AND processed_at IS NULL
       ORDER BY id`,
      [ids]
    );
    if (claimed.rows.length === 0) return;
    if (Date.now() >= deadline) {
      const detail = claimed.rows
        .map(row => `${row.event_key} (battle ${row.battle_id}, attempts ${row.attempts}, last_error ${row.last_error ?? 'none'})`)
        .join('; ');
      throw new Error(
        `Terminal outbox events still claimed after ${timeoutMs}ms: ${detail}`
      );
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}

async function cleanupTestUsers(userIds) {
  const normalizedUserIds = [...new Set(
    (userIds || [])
      .map(Number)
      .filter(userId => Number.isSafeInteger(userId) && userId > 0)
  )].sort((left, right) => left - right);
  if (normalizedUserIds.length === 0) return;

  await withTransaction(async (client) => {
    const charLookup = await client.query(
      `SELECT id, user_id
       FROM characters
       WHERE user_id = ANY($1::int[])
       ORDER BY user_id, id`,
      [normalizedUserIds]
    );
    const charIds = charLookup.rows.map(character => character.id);

    // Battle terminal paths lock battle rows before characters. Test cleanup
    // follows the same order to avoid deadlocks with an in-flight completion.
    const battles = await client.query(
      `SELECT b.id, b.status, b.player1_id, b.player2_id
       FROM battles b
       WHERE b.player1_id = ANY($1::int[])
          OR b.player2_id = ANY($1::int[])
          OR b.winner_id = ANY($1::int[])
          OR b.challenger_character_id = ANY($2::int[])
          OR EXISTS (
            SELECT 1
            FROM battle_players bp
            WHERE bp.battle_id = b.id
              AND bp.user_id = ANY($1::int[])
          )
       ORDER BY b.id
       FOR UPDATE OF b`,
      [normalizedUserIds, charIds]
    );
    const battleIds = battles.rows.map(battle => battle.id);
    const memberships = battleIds.length > 0
      ? await client.query(
        `SELECT battle_id, user_id
         FROM battle_players
         WHERE battle_id = ANY($1::int[])
         ORDER BY battle_id, user_id
         FOR UPDATE`,
        [battleIds]
      )
      : { rows: [] };

    await client.query(
      `SELECT id
       FROM characters
       WHERE user_id = ANY($1::int[])
       ORDER BY user_id, id
       FOR UPDATE`,
      [normalizedUserIds]
    );

    const outbox = battleIds.length > 0
      ? await client.query(
        `SELECT battle_id, event_key, claim_token, processed_at
         FROM battle_terminal_effect_outbox
         WHERE battle_id = ANY($1::int[])
         ORDER BY id
         FOR UPDATE`,
        [battleIds]
      )
      : { rows: [] };
    if (outbox.rows.some(event => event.claim_token !== null)) {
      throw new Error(
        'Cannot clean test users while a terminal battle event is actively claimed'
      );
    }

    const cleanupUserIds = new Set(normalizedUserIds.map(String));
    const participantIdsByBattle = new Map();
    for (const battle of battles.rows) {
      participantIdsByBattle.set(
        battle.id,
        new Set(
          [battle.player1_id, battle.player2_id]
            .filter(participantId => participantId !== null)
            .map(String)
        )
      );
    }
    for (const membership of memberships.rows) {
      participantIdsByBattle
        .get(membership.battle_id)
        ?.add(String(membership.user_id));
    }

    const sharedBattleIds = [];
    const ownedBattleIds = [];
    for (const battle of battles.rows) {
      const participantIds = participantIdsByBattle.get(battle.id) ?? new Set();
      const hasOutsideParticipant = [...participantIds]
        .some(participantId => !cleanupUserIds.has(participantId));
      if (!hasOutsideParticipant) {
        ownedBattleIds.push(battle.id);
        continue;
      }
      if (battle.status === 'active') {
        throw new Error(
          `Cannot clean a participant from active shared battle ${battle.id}`
        );
      }
      const pendingEvent = outbox.rows.find(event =>
        event.battle_id === battle.id && event.processed_at === null
      );
      if (pendingEvent) {
        throw new Error(
          `Cannot clean a participant while shared battle ${battle.id} `
          + 'has pending terminal events'
        );
      }
      sharedBattleIds.push(battle.id);
    }

    if (sharedBattleIds.length > 0) {
      if (charIds.length > 0) {
        await client.query(
          `DELETE FROM battle_participants
           WHERE battle_id = ANY($1::int[])
             AND character_id = ANY($2::int[])`,
          [sharedBattleIds, charIds]
        );
      }
      await client.query(
        `DELETE FROM battle_players
         WHERE battle_id = ANY($1::int[])
           AND user_id = ANY($2::int[])`,
        [sharedBattleIds, normalizedUserIds]
      );
      await client.query(
        `UPDATE battles
         SET player1_id = CASE
               WHEN player1_id = ANY($2::int[]) THEN NULL
               ELSE player1_id
             END,
             player2_id = CASE
               WHEN player2_id = ANY($2::int[]) THEN NULL
               ELSE player2_id
             END,
             winner_id = CASE
               WHEN winner_id = ANY($2::int[]) THEN NULL
               ELSE winner_id
             END,
             challenger_character_id = CASE
               WHEN challenger_character_id = ANY($3::int[]) THEN NULL
               ELSE challenger_character_id
             END
         WHERE id = ANY($1::int[])`,
        [sharedBattleIds, normalizedUserIds, charIds]
      );
    }

    if (ownedBattleIds.length > 0) {
      // Outbox/receipt tables deliberately have no battle FK. Test teardown
      // owns these events and must remove them explicitly to avoid residue.
      const eventKeys = outbox.rows
        .filter(event => ownedBattleIds.includes(event.battle_id))
        .map(event => event.event_key);
      if (eventKeys.length > 0) {
        await client.query(
          `DELETE FROM battle_terminal_progression_receipts
           WHERE event_key = ANY($1::text[])`,
          [eventKeys]
        );
        await client.query(
          `DELETE FROM battle_terminal_effect_outbox
           WHERE event_key = ANY($1::text[])`,
          [eventKeys]
        );
      }

      // Clearances for another participant remain valid even after the test
      // battle history is removed, so detach rather than delete those rows.
      await client.query(
        `UPDATE user_node_clearance
         SET battle_id = NULL
         WHERE battle_id = ANY($1::int[])`,
        [ownedBattleIds]
      );
      await client.query(
        'DELETE FROM battles WHERE id = ANY($1::int[])',
        [ownedBattleIds]
      );
    }

    // Preserve an out-of-scope opponent's Coliseum history while releasing
    // only references touched by this cleanup. The DELETE is intentionally
    // scoped through UPDATE ... RETURNING so unrelated anonymized history is
    // never removed.
    const touchedMatches = await client.query(
      `UPDATE coliseum_matches
       SET winner_user_id = CASE
             WHEN winner_user_id = ANY($1::int[]) THEN NULL
             ELSE winner_user_id
           END,
           loser_user_id = CASE
             WHEN loser_user_id = ANY($1::int[]) THEN NULL
             ELSE loser_user_id
           END
       WHERE winner_user_id = ANY($1::int[])
          OR loser_user_id = ANY($1::int[])
       RETURNING id, battle_id, winner_user_id, loser_user_id`,
      [normalizedUserIds]
    );
    const emptyTouchedMatchIds = touchedMatches.rows
      .filter(match =>
        match.battle_id === null
        && match.winner_user_id === null
        && match.loser_user_id === null
      )
      .map(match => match.id);
    if (emptyTouchedMatchIds.length > 0) {
      await client.query(
        'DELETE FROM coliseum_matches WHERE id = ANY($1::int[])',
        [emptyTouchedMatchIds]
      );
    }
    await client.query(
      'DELETE FROM coliseum_queue WHERE user_id = ANY($1::int[])',
      [normalizedUserIds]
    );

    // item_listing_sales.listing_id references item_listings with no ON DELETE
    // action, while item_listings cascades from characters, character_items
    // and users. Drop the sale history of the users' listings first, or a sold
    // listing blocks the character_items delete below.
    await client.query(
      `DELETE FROM item_listing_sales
       WHERE buyer_id = ANY($1::int[])
          OR seller_id = ANY($1::int[])
          OR listing_id IN (
            SELECT il.id
            FROM item_listings il
            WHERE il.seller_id = ANY($1::int[])
               OR il.character_id = ANY($2::int[])
               OR il.character_item_id IN (
                 SELECT ci.id
                 FROM character_items ci
                 WHERE ci.user_id = ANY($1::int[])
                    OR ci.character_id = ANY($2::int[])
               )
          )`,
      [normalizedUserIds, charIds]
    );

    if (charIds.length > 0) {
      // Clean up character-related data
      await client.query(
        'DELETE FROM character_skills WHERE character_id = ANY($1::int[])',
        [charIds]
      );
      await client.query(
        'DELETE FROM character_traits WHERE character_id = ANY($1::int[])',
        [charIds]
      );
      await client.query(
        `DELETE FROM character_items
         WHERE character_id = ANY($1::int[])
            OR user_id = ANY($2::int[])`,
        [charIds, normalizedUserIds]
      );
    }
    await client.query(
      'DELETE FROM party_members WHERE user_id = ANY($1::int[])',
      [normalizedUserIds]
    );
    await client.query(
      'DELETE FROM notifications WHERE user_id = ANY($1::int[])',
      [normalizedUserIds]
    );
    await client.query(
      `DELETE FROM friendships
       WHERE user_id = ANY($1::int[])
          OR friend_id = ANY($1::int[])`,
      [normalizedUserIds]
    );
    await client.query(
      'DELETE FROM user_settings WHERE user_id = ANY($1::int[])',
      [normalizedUserIds]
    );
    await client.query(
      'DELETE FROM gold_reservations WHERE user_id = ANY($1::int[])',
      [normalizedUserIds]
    );
    await client.query(
      'DELETE FROM characters WHERE user_id = ANY($1::int[])',
      [normalizedUserIds]
    );
    await client.query(
      'DELETE FROM users WHERE id = ANY($1::int[])',
      [normalizedUserIds]
    );
  });
}

/**
 * Delete one test user when it has no active out-of-scope battle opponent.
 * @param {number} userId - User ID to delete
 */
async function cleanupTestUser(userId) {
  return cleanupTestUsers([userId]);
}

/**
 * Create an isolated test transaction context
 * All operations within the callback will be rolled back after completion
 * @param {Function} callback - Async function receiving (client, query) helpers
 * @returns {Promise<any>} Result of the callback (before rollback)
 */
async function withTestTransaction(callback) {
  const client = await getClient();
  let result;

  try {
    await client.query('BEGIN');

    // Create a scoped query function that uses this transaction
    const scopedQuery = async (text, params) => {
      return client.query(text, params);
    };

    result = await callback(client, scopedQuery);
  } finally {
    // Always rollback - this is for testing only
    await client.query('ROLLBACK');
    client.release();
  }

  return result;
}

/**
 * Create a test context that tracks all created resources
 * and cleans them up automatically
 */
function createTestContext() {
  const userIds = [];
  const characterIds = [];

  return {
    /**
     * Create a test user and track for cleanup
     */
    async createUser() {
      const user = await createTestUser();
      userIds.push(user.userId);
      return user;
    },

    /**
     * Create a test character and track for cleanup
     */
    async createCharacter(token, name = null) {
      const character = await createTestCharacter(token, name);
      characterIds.push(character.id);
      return character;
    },

    /**
     * Clean up all tracked resources
     */
    async cleanup() {
      await cleanupTestUsers(userIds);
      userIds.length = 0;
      characterIds.length = 0;
    }
  };
}

// Simple HTTP client for testing
async function sendRequest(method, path, body = null, token = null, bypassRateLimit = true) {
  const url = new URL(path, BASE_URL);

  const headers = {
    'Content-Type': 'application/json'
  };

  if (bypassRateLimit) {
    headers[TEST_BYPASS_HEADER] = TEST_BYPASS_SECRET;
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const options = {
    method,
    headers,
    // One connection per request. Node's global agent keeps sockets alive,
    // and reusing one the server's keepAliveTimeout has just closed surfaces
    // as a spurious ECONNRESET late in long sequential suites.
    agent: false
  };

  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms: ${method} ${path}`));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

async function request(method, path, body = null, token = null) {
  return sendRequest(method, path, body, token, true);
}

async function rateLimitedRequest(method, path, body = null, token = null) {
  return sendRequest(method, path, body, token, false);
}

// Generate unique test data
function uniqueUsername() {
  return `testuser_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

function uniqueEmail() {
  return `test_${Date.now()}_${Math.random().toString(36).substring(7)}@test.com`;
}

// Create and authenticate a test user
async function createTestUser() {
  const username = uniqueUsername();
  const email = uniqueEmail();
  const password = 'TestPassword123!';

  const res = await request('POST', '/api/auth/register', {
    username,
    email,
    password
  });

  if (res.status !== 201) {
    throw new Error(`Failed to create test user: ${JSON.stringify(res.body)}`);
  }

  return {
    userId: res.body.user.id,
    username,
    email,
    password,
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken
  };
}

// Create a test character for a user
async function createTestCharacter(token, name = null) {
  // Keep name short to fit 2-24 character limit
  const charName = name || `TC${Date.now().toString(36).slice(-6)}`;
  const races = ['human', 'elf', 'dwarf', 'orc'];
  const classes = ['warrior', 'wizard', 'monk', 'chemist'];

  const res = await request('POST', '/api/characters', {
    name: charName,
    race: races[Math.floor(Math.random() * races.length)],
    characterClass: classes[Math.floor(Math.random() * classes.length)]
  }, token);

  if (res.status !== 201) {
    throw new Error(`Failed to create test character: ${JSON.stringify(res.body)}`);
  }

  return res.body.character;
}

/**
 * Create an additional party character as a persistence fixture.
 *
 * Public manual creation intentionally permits only a user's first character;
 * subsequent party members come from recruitment. Integration tests that are
 * not testing recruitment itself can use this helper to establish that state
 * without weakening the public creation policy.
 */
async function createTestPartyCharacter(userId, {
  name = null
} = {}) {
  const sourceResult = await query(
    `SELECT *
     FROM characters
     WHERE user_id = $1
     ORDER BY party_slot NULLS LAST, id
     LIMIT 1`,
    [userId]
  );
  if (sourceResult.rows.length === 0) {
    throw new Error('Cannot create a party fixture without an existing character');
  }

  const source = sourceResult.rows[0];
  const slotResult = await query(
    `SELECT COALESCE(MAX(party_slot), 0) + 1 AS next_slot
     FROM characters
     WHERE user_id = $1`,
    [userId]
  );
  const nextSlot = Number(slotResult.rows[0].next_slot);
  const characterName = name || `TP${Date.now().toString(36).slice(-6)}`;

  const result = await query(
    `INSERT INTO characters (
       user_id, name, race, class, gender, level, experience,
       hp_current, hp_max, mp_current, mp_max,
       strength, intelligence, agility, vitality, luck,
       current_node_id, party_slot, home_region_id
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11,
       $12, $13, $14, $15, $16,
       $17, $18, $19
     )
     RETURNING *`,
    [
      userId,
      characterName,
      source.race,
      source.class,
      source.gender ?? 'other',
      source.level,
      source.experience,
      source.hp_current,
      source.hp_max,
      source.mp_current,
      source.mp_max,
      source.strength,
      source.intelligence,
      source.agility,
      source.vitality,
      source.luck,
      source.current_node_id,
      nextSlot,
      source.home_region_id
    ]
  );

  return result.rows[0];
}

// ============================================================================
// Rate Limit Testing Utilities
// ============================================================================

/**
 * Fire multiple requests in rapid succession
 * Useful for testing rate limits
 * @param {number} count - Number of requests to fire
 * @param {string} method - HTTP method
 * @param {string} path - API path
 * @param {Object|null} body - Request body
 * @param {string|null} token - Auth token
 * @returns {Promise<Array>} Array of response objects
 */
async function fireRequests(count, method, path, body = null, token = null) {
  const results = [];
  for (let i = 0; i < count; i++) {
    results.push(await rateLimitedRequest(method, path, body, token));
  }
  return results;
}

/**
 * Fire requests in parallel (more aggressive than sequential)
 * @param {number} count - Number of requests to fire
 * @param {string} method - HTTP method
 * @param {string} path - API path
 * @param {Object|null} body - Request body
 * @param {string|null} token - Auth token
 * @returns {Promise<Array>} Array of response objects
 */
async function fireRequestsParallel(count, method, path, body = null, token = null) {
  const promises = [];
  for (let i = 0; i < count; i++) {
    promises.push(rateLimitedRequest(method, path, body, token));
  }
  return Promise.all(promises);
}

/**
 * Wait for rate limit window to reset
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
function waitForRateLimitReset(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Read all rate limiter stats from the API server process.
 */
async function getAllLimiterStats() {
  const res = await request('GET', '/api/health/metrics');
  if (res.status !== 200 || !res.body?.rateLimiter?.stats) {
    throw new Error(`Failed to read rate limiter stats: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.rateLimiter.stats;
}

/**
 * Read one rate limiter's stats from the API server process.
 */
async function getRateLimiterStats(name) {
  const stats = await getAllLimiterStats();
  return stats[name] || null;
}

/**
 * Reset all rate limiters via API endpoint
 * Call this before running tests that might be affected by rate limiting
 * @returns {Promise<boolean>} True if reset was successful
 */
async function resetRateLimitersViaApi() {
  const res = await request('POST', '/api/test/reset-rate-limiters');
  if (res.status !== 200) {
    throw new Error(`Failed to reset rate limiters: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return true;
}

/**
 * Fail fast unless this process runs under the rate-limit runner.
 *
 * The rate-limit suites assert exact limiter thresholds and reset limiter
 * state through the API, so they need a server started with NODE_ENV=test
 * and TEST_RATE_LIMITS=true. runRateLimitTests.js starts exactly that server
 * on a private port and exports TEST_API_BASE_URL. A direct `node --test`
 * run would otherwise silently hit whatever server listens on PORT (the dev
 * server, with development limits) and fail for reasons unrelated to the
 * limiter code under test.
 */
function assertRateLimitHarness() {
  if (!process.env.TEST_API_BASE_URL || process.env.RATE_LIMIT_TEST_RUNNER !== '1') {
    throw new Error(
      'Rate-limit suites must run via `npm run test:ratelimit -w api` '
      + '(runner-owned server with NODE_ENV=test and TEST_RATE_LIMITS=true)'
    );
  }
}

async function resetAllLimiterStats() {
  return resetRateLimitersViaApi();
}

async function resetLimiterStats() {
  return resetRateLimitersViaApi();
}

export {
  // HTTP client
  request,
  rateLimitedRequest,
  BASE_URL,

  // Data generators
  uniqueUsername,
  uniqueEmail,
  createTestUser,
  createTestCharacter,
  createTestPartyCharacter,

  // Test isolation
  registerCleanup,
  runCleanup,
  cleanupTestUser,
  cleanupTestUsers,
  withTestTransaction,
  createTestContext,

  // Database access for direct testing
  pool,
  query,
  getClient,
  withTransaction,

  // Rate limit testing utilities
  fireRequests,
  fireRequestsParallel,
  waitForRateLimitReset,
  getRateLimiterStats,
  getAllLimiterStats,
  resetLimiterStats,
  resetAllLimiterStats,
  resetRateLimitersViaApi,
  isRateLimitingEnabled,
  assertRateLimitHarness,

  // Battle teardown
  waitForTerminalOutboxSettled
};
