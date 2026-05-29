import 'dotenv/config';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, getClient, withTransaction, query } from '../config/database.js';
import {
  getLimiterStats,
  getAllLimiterStats,
  resetLimiterStats,
  resetAllLimiterStats,
  isRateLimitingEnabled,
  TEST_BYPASS_HEADER,
  TEST_BYPASS_SECRET
} from '../middleware/rateLimiterFactory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;

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
 * Delete test user and all associated data by user ID
 * Cascades through characters, inventory, party, etc.
 * @param {number} userId - User ID to delete
 */
async function cleanupTestUser(userId) {
  if (!userId) return;

  try {
    // Delete in dependency order (most dependent first)
    // Get character IDs first
    const chars = await query(
      'SELECT id FROM characters WHERE user_id = $1',
      [userId]
    );
    const charIds = chars.rows.map(c => c.id);

    if (charIds.length > 0) {
      // Clean up character-related data
      await query('DELETE FROM character_skills WHERE character_id = ANY($1)', [charIds]);
      await query('DELETE FROM character_traits WHERE character_id = ANY($1)', [charIds]);
      await query('DELETE FROM inventory_items WHERE character_id = ANY($1)', [charIds]);
      await query('DELETE FROM equipped_items WHERE character_id = ANY($1)', [charIds]);
      await query('DELETE FROM party_members WHERE character_id = ANY($1)', [charIds]);
    }

    // Clean up user-related data (silently ignore missing tables)
    const safeDelete = async (sql, params) => {
      try {
        await query(sql, params);
      } catch (err) {
        if (!err.message.includes('does not exist')) throw err;
      }
    };
    await safeDelete('DELETE FROM notifications WHERE user_id = $1', [userId]);
    await safeDelete('DELETE FROM friendships WHERE user_id = $1 OR friend_id = $1', [userId]);
    await safeDelete('DELETE FROM user_settings WHERE user_id = $1', [userId]);
    await safeDelete('DELETE FROM gold_reservations WHERE user_id = $1', [userId]);
    await safeDelete('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
    await query('DELETE FROM characters WHERE user_id = $1', [userId]);
    await query('DELETE FROM users WHERE id = $1', [userId]);
  } catch (err) {
    console.warn(`Failed to cleanup test user ${userId}:`, err.message);
  }
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
      for (const userId of userIds) {
        await cleanupTestUser(userId);
      }
      userIds.length = 0;
      characterIds.length = 0;
    }
  };
}

// Simple HTTP client for testing
async function request(method, path, body = null, token = null) {
  const url = new URL(path, BASE_URL);

  const headers = {
    'Content-Type': 'application/json',
    // Always include test bypass header for rate limiting
    [TEST_BYPASS_HEADER]: TEST_BYPASS_SECRET
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const options = {
    method,
    headers
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

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
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
    results.push(await request(method, path, body, token));
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
    promises.push(request(method, path, body, token));
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
 * Get rate limiter stats wrapper (re-exported from factory)
 */
function getRateLimiterStats(name) {
  return getLimiterStats(name);
}

/**
 * Reset all rate limiters via API endpoint
 * Call this before running tests that might be affected by rate limiting
 * @returns {Promise<boolean>} True if reset was successful
 */
async function resetRateLimitersViaApi() {
  try {
    const res = await request('POST', '/api/test/reset-rate-limiters');
    return res.status === 200;
  } catch (err) {
    console.warn('Failed to reset rate limiters via API:', err.message);
    return false;
  }
}

export {
  // HTTP client
  request,
  BASE_URL,

  // Data generators
  uniqueUsername,
  uniqueEmail,
  createTestUser,
  createTestCharacter,

  // Test isolation
  registerCleanup,
  runCleanup,
  cleanupTestUser,
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
  isRateLimitingEnabled
};
