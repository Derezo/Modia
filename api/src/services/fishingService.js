/**
 * Fishing Service - Handle fishing sessions and catches
 *
 * Fishing is an idle/passive activity where players can fish at
 * fishing_spot nodes to earn gold. Auto-catches happen periodically,
 * with occasional "Big One" events that reward bonus fish if clicked in time.
 */

import { randomUUID } from 'node:crypto';
import { pool, withTransaction } from '../config/database.js';
import { MAX_GOLD } from '../config/constants.js';
import { AppError } from '../middleware/errorHandler.js';
import { lockAgainstWorldMigration } from '../db/worldMigrationLock.js';
import {
  selectRandomFish,
  calculateFishValue,
  FISHING_CONFIG,
  FISH_TYPES
} from '../db/templates/fish.js';
import * as dailyQuestService from './dailyQuestService.js';

const SESSION_COLUMNS = `
  session_id,
  user_id,
  node_id,
  node_name,
  status,
  started_at,
  last_catch_at,
  catches,
  total_value,
  big_one_active,
  big_one_expires_at,
  big_one_fish,
  collection_result,
  collected_at
`;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Helper to get party leader character ID for a user
 * @param {number} userId - User ID
 * @returns {Promise<number|null>} Character ID or null
 */
async function getPartyLeaderId(userId) {
  const result = await pool.query(
    'SELECT id FROM characters WHERE user_id = $1 AND party_slot = 1',
    [userId]
  );
  return result.rows[0]?.id || null;
}

/**
 * Session data structure
 */
function createSession(userId, nodeId, nodeName) {
  return {
    sessionId: randomUUID(),
    userId,
    nodeId,
    nodeName,
    startTime: Date.now(),
    catches: [],
    totalValue: 0,
    lastCatchTime: null,
    bigOneActive: false,
    bigOneExpires: null,
    bigOneFish: null,
    state: 'active'
  };
}

function toEpoch(value) {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function sessionFromRow(row) {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    nodeId: row.node_id,
    nodeName: row.node_name,
    startTime: toEpoch(row.started_at),
    catches: Array.isArray(row.catches) ? row.catches : [],
    totalValue: Number(row.total_value) || 0,
    lastCatchTime: toEpoch(row.last_catch_at),
    bigOneActive: row.big_one_active === true,
    bigOneExpires: toEpoch(row.big_one_expires_at),
    bigOneFish: row.big_one_fish || null,
    state: row.status
  };
}

function getPublicConfig() {
  return {
    minCatchInterval: FISHING_CONFIG.minCatchInterval,
    maxCatchInterval: FISHING_CONFIG.maxCatchInterval,
    bigOneWindowMs: FISHING_CONFIG.bigOneWindowMs
  };
}

function serializeSession(session) {
  const bigOneExpiresIn = session.bigOneActive
    ? Math.max(0, session.bigOneExpires - Date.now())
    : null;
  const bigOneIsActive = Boolean(session.bigOneActive && bigOneExpiresIn > 0);

  return {
    active: session.state === 'active',
    collecting: false,
    sessionId: session.sessionId,
    nodeId: session.nodeId,
    nodeName: session.nodeName,
    startTime: session.startTime,
    duration: Math.floor((Date.now() - session.startTime) / 1000),
    totalCatches: session.catches.length,
    totalValue: session.totalValue,
    catches: session.catches.map(catchRecord => ({ ...catchRecord })),
    config: getPublicConfig(),
    bigOneActive: bigOneIsActive,
    bigOneExpiresIn: bigOneIsActive ? bigOneExpiresIn : null,
    bigOne: bigOneIsActive ? {
      active: true,
      expiresIn: bigOneExpiresIn,
      fishName: session.bigOneFish?.name,
      rarity: session.bigOneFish?.rarity
    } : null
  };
}

function validateSessionId(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') {
    throw new AppError('Fishing session ID is required', 400);
  }
  if (!UUID_PATTERN.test(sessionId)) {
    throw new AppError('Fishing session ID is invalid', 400);
  }
}

function requireSessionRow(result) {
  if (result.rows.length === 0) {
    throw new AppError('No active fishing session', 404);
  }
  return result.rows[0];
}

function requireActiveSessionRow(result) {
  const row = requireSessionRow(result);
  if (row.status !== 'active') {
    throw new AppError('Fishing session is no longer active', 409);
  }
  return row;
}

async function lockUser(client, userId) {
  const result = await client.query(
    'SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE',
    [userId]
  );
  if (result.rows.length === 0) {
    throw new AppError('User not found', 404);
  }
}

async function loadSessionForUpdate(client, userId, nodeId, sessionId) {
  validateSessionId(sessionId);
  return client.query(`
    SELECT ${SESSION_COLUMNS}
    FROM user_fishing_sessions
    WHERE session_id = $1 AND user_id = $2 AND node_id = $3
    FOR UPDATE
  `, [sessionId, userId, nodeId]);
}

function fireFishCatchProgress(userId, fish, isBigOne = false) {
  getPartyLeaderId(userId).then(characterId => {
    if (characterId) {
      dailyQuestService.updateProgress(characterId, 'fish_catches', 1, {
        rarity: fish.rarity,
        ...(isBigOne ? { isBigOne: true } : {})
      }).catch(err => console.warn('[Quest] fish_catches progress failed:', err.message));
    }
  }).catch(err => console.warn('[Quest] Failed to get characterId for fishing:', err.message));
}

/**
 * Start a new fishing session
 * @param {number} userId - User ID
 * @param {number} nodeId - Fishing spot node ID
 * @returns {Object} Session start result
 */
export async function startSession(userId, nodeId) {
  return withTransaction(async client => {
    await lockAgainstWorldMigration(client);
    // Locking the user serializes start/end transitions across API workers.
    // The partial unique index remains the final cross-process invariant.
    await lockUser(client, userId);

    const nodeResult = await client.query(`
      SELECT id, name, node_type FROM world_nodes WHERE id = $1
    `, [nodeId]);

    if (nodeResult.rows.length === 0) {
      throw new AppError('Node not found', 404);
    }

    const node = nodeResult.rows[0];
    if (node.node_type !== 'fishing_spot') {
      throw new AppError('This node is not a fishing spot', 400);
    }

    const activeResult = await client.query(`
      SELECT ${SESSION_COLUMNS}
      FROM user_fishing_sessions
      WHERE user_id = $1 AND status = 'active'
      ORDER BY started_at DESC
      LIMIT 1
    `, [userId]);

    if (activeResult.rows.length > 0) {
      const existingSession = sessionFromRow(activeResult.rows[0]);
      if (existingSession.nodeId !== nodeId) {
        throw new AppError(
          `You already have an active fishing session at ${existingSession.nodeName}`,
          409,
          { activeSession: serializeSession(existingSession) }
        );
      }

      return {
        success: true,
        resumed: true,
        message: 'Fishing session resumed',
        ...serializeSession(existingSession)
      };
    }

    const session = createSession(userId, nodeId, node.name);
    await client.query(`
      INSERT INTO user_fishing_sessions (
        session_id,
        user_id,
        node_id,
        node_name,
        status,
        started_at,
        catches,
        total_value,
        big_one_active,
        updated_at
      )
      VALUES ($1, $2, $3, $4, 'active', $5, '[]'::JSONB, 0, FALSE, NOW())
    `, [
      session.sessionId,
      userId,
      nodeId,
      node.name,
      new Date(session.startTime)
    ]);

    return {
      success: true,
      resumed: false,
      message: 'Fishing session started',
      ...serializeSession(session)
    };
  });
}

/**
 * Register a catch (called by client timer)
 * @param {number} userId - User ID
 * @param {number} nodeId - Fishing spot node ID
 * @param {string} sessionId - Active fishing session ID
 * @returns {Object} Catch result with fish data
 */
export async function registerCatch(userId, nodeId, sessionId) {
  validateSessionId(sessionId);

  let caughtFish;
  const result = await withTransaction(async client => {
    await lockAgainstWorldMigration(client);
    await lockUser(client, userId);
    const sessionResult = await loadSessionForUpdate(client, userId, nodeId, sessionId);
    const session = sessionFromRow(requireActiveSessionRow(sessionResult));
    const now = Date.now();

    if (session.lastCatchTime) {
      const elapsed = now - session.lastCatchTime;
      if (elapsed < FISHING_CONFIG.catchCooldown) {
        throw new AppError('Catch cooldown not complete', 429);
      }
    }

    const sessionDuration = now - session.startTime;
    if (sessionDuration > FISHING_CONFIG.maxSessionDuration) {
      throw new AppError(
        'Session has expired. Please pack up and start a new session.',
        409
      );
    }

    const fish = selectRandomFish(Math.random);
    caughtFish = fish;
    const sizeMultiplier = FISHING_CONFIG.sizeMultiplierMin +
      (Math.random() * (FISHING_CONFIG.sizeMultiplierMax - FISHING_CONFIG.sizeMultiplierMin));
    const value = calculateFishValue(fish, sizeMultiplier, false);
    const catchRecord = {
      fishId: fish.id,
      fishName: fish.name,
      rarity: fish.rarity,
      value,
      sizeMultiplier: Math.round(sizeMultiplier * 100) / 100,
      timestamp: now
    };

    session.catches.push(catchRecord);
    session.totalValue += value;
    session.lastCatchTime = now;

    let bigOneTriggered = false;
    if (Math.random() < FISHING_CONFIG.bigOneChance) {
      session.bigOneActive = true;
      session.bigOneExpires = now + FISHING_CONFIG.bigOneWindowMs;
      session.bigOneFish = selectBigOneFish();
      bigOneTriggered = true;
    }

    await client.query(`
      UPDATE user_fishing_sessions
      SET catches = $1::JSONB,
          total_value = $2,
          last_catch_at = $3,
          big_one_active = $4,
          big_one_expires_at = $5,
          big_one_fish = $6::JSONB,
          updated_at = NOW()
      WHERE session_id = $7
    `, [
      JSON.stringify(session.catches),
      session.totalValue,
      new Date(now),
      session.bigOneActive,
      session.bigOneExpires ? new Date(session.bigOneExpires) : null,
      session.bigOneFish ? JSON.stringify(session.bigOneFish) : null,
      session.sessionId
    ]);

    await client.query(`
      INSERT INTO user_fishing_catches (user_id, node_id, fish_type, quantity, caught_at)
      VALUES ($1, $2, $3, $4, NOW())
    `, [userId, nodeId, fish.id, 1]);

    return {
      success: true,
      catch: catchRecord,
      sessionStats: {
        totalCatches: session.catches.length,
        totalValue: session.totalValue
      },
      bigOne: bigOneTriggered ? {
        active: true,
        expiresIn: FISHING_CONFIG.bigOneWindowMs,
        fishName: session.bigOneFish.name,
        rarity: session.bigOneFish.rarity
      } : null
    };
  });

  fireFishCatchProgress(userId, caughtFish);
  return result;
}

/**
 * Select a fish for "Big One" event (rare or better guaranteed)
 */
function selectBigOneFish() {
  // Higher chance of better fish for big one
  const roll = Math.random() * 100;
  let rarity;

  if (roll < 50) {
    rarity = 'rare';
  } else if (roll < 85) {
    rarity = 'epic';
  } else {
    rarity = 'legendary';
  }

  const fishOfRarity = FISH_TYPES.filter(f => f.rarity === rarity);
  return fishOfRarity[Math.floor(Math.random() * fishOfRarity.length)];
}

/**
 * Claim a "Big One" catch
 * @param {number} userId - User ID
 * @param {number} nodeId - Fishing spot node ID
 * @param {string} sessionId - Active fishing session ID
 * @returns {Object} Big one result
 */
export async function claimBigOne(userId, nodeId, sessionId) {
  validateSessionId(sessionId);

  let caughtFish;
  const result = await withTransaction(async client => {
    await lockAgainstWorldMigration(client);
    await lockUser(client, userId);
    const sessionResult = await loadSessionForUpdate(client, userId, nodeId, sessionId);
    const session = sessionFromRow(requireActiveSessionRow(sessionResult));

    if (!session.bigOneActive) {
      throw new AppError('No Big One event active', 409);
    }

    if (Date.now() > session.bigOneExpires) {
      await client.query(`
        UPDATE user_fishing_sessions
        SET big_one_active = FALSE,
            big_one_expires_at = NULL,
            big_one_fish = NULL,
            updated_at = NOW()
        WHERE session_id = $1
      `, [session.sessionId]);
      return { expired: true };
    }

    const fish = session.bigOneFish;
    caughtFish = fish;
    const sizeMultiplier = 1.3 + (Math.random() * 0.4);
    const value = calculateFishValue(fish, sizeMultiplier, true);
    const catchRecord = {
      fishId: fish.id,
      fishName: fish.name,
      rarity: fish.rarity,
      value,
      sizeMultiplier: Math.round(sizeMultiplier * 100) / 100,
      timestamp: Date.now(),
      isBigOne: true
    };

    session.catches.push(catchRecord);
    session.totalValue += value;

    await client.query(`
      UPDATE user_fishing_sessions
      SET catches = $1::JSONB,
          total_value = $2,
          big_one_active = FALSE,
          big_one_expires_at = NULL,
          big_one_fish = NULL,
          updated_at = NOW()
      WHERE session_id = $3
    `, [
      JSON.stringify(session.catches),
      session.totalValue,
      session.sessionId
    ]);

    await client.query(`
      INSERT INTO user_fishing_catches (user_id, node_id, fish_type, quantity, caught_at)
      VALUES ($1, $2, $3, $4, NOW())
    `, [userId, nodeId, fish.id, 1]);

    return {
      success: true,
      message: `You caught a ${fish.name}! (Big One bonus!)`,
      catch: catchRecord,
      sessionStats: {
        totalCatches: session.catches.length,
        totalValue: session.totalValue
      }
    };
  });

  if (result.expired) {
    throw new AppError('Too slow! The Big One got away.', 409);
  }

  fireFishCatchProgress(userId, caughtFish, true);
  return result;
}

/**
 * End fishing session and collect rewards
 * @param {number} userId - User ID
 * @param {number} nodeId - Fishing spot node ID
 * @param {string} sessionId - Fishing session ID being collected
 * @returns {Object} Session summary with total rewards
 */
export async function endSession(userId, nodeId, sessionId) {
  validateSessionId(sessionId);

  const result = await withTransaction(async client => {
    await lockAgainstWorldMigration(client);
    // Serializes collection with any new start for this user. The session row
    // lock serializes concurrent collectors, including other API workers.
    await lockUser(client, userId);
    const sessionResult = await loadSessionForUpdate(client, userId, nodeId, sessionId);
    const row = requireSessionRow(sessionResult);

    if (row.status === 'collected' && row.collection_result) {
      return {
        ...row.collection_result,
        idempotent: true
      };
    }
    if (row.status !== 'active') {
      throw new AppError('Fishing session is no longer active', 409);
    }

    const session = sessionFromRow(row);
    const duration = Math.floor((Date.now() - session.startTime) / 1000);
    const catches = session.catches.map(catchRecord => ({ ...catchRecord }));
    const totalCatches = catches.length;
    const totalValue = session.totalValue;
    const catchesByRarity = {
      common: 0,
      uncommon: 0,
      rare: 0,
      epic: 0,
      legendary: 0
    };

    for (const catchRecord of catches) {
      catchesByRarity[catchRecord.rarity] =
        (catchesByRarity[catchRecord.rarity] || 0) + 1;
    }

    let userResult;
    if (totalValue > 0) {
      userResult = await client.query(`
        UPDATE users
        SET gold = LEAST(gold + $1, $2)
        WHERE id = $3
        RETURNING gold
      `, [totalValue, MAX_GOLD, userId]);
    } else {
      userResult = await client.query(
        'SELECT gold FROM users WHERE id = $1',
        [userId]
      );
    }

    if (!userResult.rows[0]) {
      throw new Error('Unable to load updated gold balance');
    }

    const collectionResult = {
      success: true,
      idempotent: false,
      sessionId: session.sessionId,
      message: `Fishing session complete! You earned ${totalValue} gold.`,
      summary: {
        duration,
        totalCatches,
        totalValue,
        catchesByRarity,
        catches
      },
      newGold: userResult.rows[0].gold
    };

    await client.query(`
      UPDATE user_fishing_sessions
      SET status = 'collected',
          collection_result = $1::JSONB,
          collected_at = NOW(),
          big_one_active = FALSE,
          big_one_expires_at = NULL,
          big_one_fish = NULL,
          updated_at = NOW()
      WHERE session_id = $2
    `, [JSON.stringify(collectionResult), session.sessionId]);

    return collectionResult;
  });

  if (!result.idempotent && result.summary.totalValue > 0) {
    getPartyLeaderId(userId).then(characterId => {
      if (characterId) {
        dailyQuestService.updateProgress(
          characterId,
          'gold_earned',
          result.summary.totalValue,
          {}
        ).catch(err => console.warn('[Quest] gold_earned progress failed:', err.message));
      }
    }).catch(err => console.warn('[Quest] Failed to get characterId for gold:', err.message));
  }

  return result;
}

/**
 * Get active session status
 * @param {number} userId - User ID
 * @param {number} nodeId - Fishing spot node ID
 * @returns {Object|null} Session status or null
 */
export async function getSessionStatus(userId, nodeId) {
  const result = await pool.query(`
    SELECT ${SESSION_COLUMNS}
    FROM user_fishing_sessions
    WHERE user_id = $1 AND node_id = $2 AND status = 'active'
    ORDER BY started_at DESC
    LIMIT 1
  `, [userId, nodeId]);

  return result.rows[0] ? serializeSession(sessionFromRow(result.rows[0])) : null;
}

/**
 * Find the active fishing session for a user after a client reconnect.
 * The database enforces at most one active session per user.
 *
 * @param {number} userId - User ID
 * @returns {Object|null} Most recent session status or null
 */
export async function getActiveSessionStatus(userId) {
  const result = await pool.query(`
    SELECT ${SESSION_COLUMNS}
    FROM user_fishing_sessions
    WHERE user_id = $1 AND status = 'active'
    ORDER BY started_at DESC
    LIMIT 1
  `, [userId]);

  return result.rows[0] ? serializeSession(sessionFromRow(result.rows[0])) : null;
}

/**
 * Clean up expired sessions (call periodically)
 */
export async function cleanupExpiredSessions() {
  const expiresBefore = new Date(
    Date.now() - (FISHING_CONFIG.maxSessionDuration * 1.5)
  );
  await withTransaction(async client => {
    await lockAgainstWorldMigration(client);
    await client.query(`
      UPDATE user_fishing_sessions
      SET status = 'expired',
          big_one_active = FALSE,
          big_one_expires_at = NULL,
          big_one_fish = NULL,
          updated_at = NOW()
      WHERE status = 'active' AND started_at < $1
    `, [expiresBefore]);
  });
}

/**
 * Start the cleanup scheduler
 * Runs cleanup every 5 minutes
 */
let cleanupInterval = null;

export function startCleanupScheduler() {
  if (cleanupInterval) return; // Already running

  const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  cleanupInterval = setInterval(() => {
    cleanupExpiredSessions().catch(err => {
      console.warn('[Fishing] Failed to clean up expired sessions:', err.message);
    });
  }, CLEANUP_INTERVAL_MS);

  // Don't prevent process exit
  cleanupInterval.unref();
}

export function stopCleanupScheduler() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

// Auto-start cleanup scheduler when module loads
startCleanupScheduler();
