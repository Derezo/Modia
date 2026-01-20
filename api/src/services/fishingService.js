/**
 * Fishing Service - Handle fishing sessions and catches
 *
 * Fishing is an idle/passive activity where players can fish at
 * fishing_spot nodes to earn gold. Auto-catches happen periodically,
 * with occasional "Big One" events that reward bonus fish if clicked in time.
 */

import { pool } from '../config/database.js';
import { MAX_GOLD } from '../config/constants.js';
import {
  selectRandomFish,
  calculateFishValue,
  FISHING_CONFIG,
  FISH_TYPES
} from '../db/templates/fish.js';
import * as dailyQuestService from './dailyQuestService.js';

// In-memory session storage (sessions are short-lived)
const activeSessions = new Map();

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
function createSession(userId, nodeId) {
  return {
    userId,
    nodeId,
    startTime: Date.now(),
    catches: [],
    totalValue: 0,
    lastCatchTime: null,
    bigOneActive: false,
    bigOneExpires: null,
    bigOneFish: null
  };
}

/**
 * Start a new fishing session
 * @param {number} userId - User ID
 * @param {number} nodeId - Fishing spot node ID
 * @returns {Object} Session start result
 */
export async function startSession(userId, nodeId) {
  // Validate node is a fishing spot
  const nodeResult = await pool.query(`
    SELECT id, name, node_type FROM world_nodes WHERE id = $1
  `, [nodeId]);

  if (nodeResult.rows.length === 0) {
    throw new Error('Node not found');
  }

  const node = nodeResult.rows[0];
  if (node.node_type !== 'fishing_spot') {
    throw new Error('This node is not a fishing spot');
  }

  // Check for existing session
  const sessionKey = `${userId}-${nodeId}`;
  if (activeSessions.has(sessionKey)) {
    throw new Error('You already have an active fishing session here');
  }

  // Create new session
  const session = createSession(userId, nodeId);
  activeSessions.set(sessionKey, session);

  return {
    success: true,
    message: 'Fishing session started',
    sessionKey,
    nodeName: node.name,
    config: {
      minCatchInterval: FISHING_CONFIG.minCatchInterval,
      maxCatchInterval: FISHING_CONFIG.maxCatchInterval,
      bigOneWindowMs: FISHING_CONFIG.bigOneWindowMs
    }
  };
}

/**
 * Register a catch (called by client timer)
 * @param {number} userId - User ID
 * @param {number} nodeId - Fishing spot node ID
 * @returns {Object} Catch result with fish data
 */
export async function registerCatch(userId, nodeId) {
  const sessionKey = `${userId}-${nodeId}`;
  const session = activeSessions.get(sessionKey);

  if (!session) {
    throw new Error('No active fishing session');
  }

  // Check cooldown
  if (session.lastCatchTime) {
    const elapsed = Date.now() - session.lastCatchTime;
    if (elapsed < FISHING_CONFIG.catchCooldown) {
      throw new Error('Catch cooldown not complete');
    }
  }

  // Check session duration limit
  const sessionDuration = Date.now() - session.startTime;
  if (sessionDuration > FISHING_CONFIG.maxSessionDuration) {
    throw new Error('Session has expired. Please pack up and start a new session.');
  }

  // Select random fish
  const fish = selectRandomFish(Math.random);

  // Calculate size multiplier
  const sizeMultiplier = FISHING_CONFIG.sizeMultiplierMin +
    (Math.random() * (FISHING_CONFIG.sizeMultiplierMax - FISHING_CONFIG.sizeMultiplierMin));

  const value = calculateFishValue(fish, sizeMultiplier, false);

  // Record catch
  const catchRecord = {
    fishId: fish.id,
    fishName: fish.name,
    rarity: fish.rarity,
    value,
    sizeMultiplier: Math.round(sizeMultiplier * 100) / 100,
    timestamp: Date.now()
  };

  session.catches.push(catchRecord);
  session.totalValue += value;
  session.lastCatchTime = Date.now();

  // Check for "Big One" event trigger
  let bigOneTriggered = false;
  if (Math.random() < FISHING_CONFIG.bigOneChance) {
    // Generate big one fish (guaranteed rare or better)
    const bigOneFish = selectBigOneFish();
    session.bigOneActive = true;
    session.bigOneExpires = Date.now() + FISHING_CONFIG.bigOneWindowMs;
    session.bigOneFish = bigOneFish;
    bigOneTriggered = true;
  }

  // Record catch in database
  await pool.query(`
    INSERT INTO user_fishing_catches (user_id, node_id, fish_type, quantity, caught_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT DO NOTHING
  `, [userId, nodeId, fish.id, 1]);

  // Daily/Weekly quest progress hooks (fire-and-forget pattern)
  getPartyLeaderId(userId).then(characterId => {
    if (characterId) {
      dailyQuestService.updateProgress(characterId, 'fish_catches', 1, {
        rarity: fish.rarity
      }).catch(err => console.warn('[Quest] fish_catches progress failed:', err.message));
    }
  }).catch(err => console.warn('[Quest] Failed to get characterId for fishing:', err.message));

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
 * @returns {Object} Big one result
 */
export async function claimBigOne(userId, nodeId) {
  const sessionKey = `${userId}-${nodeId}`;
  const session = activeSessions.get(sessionKey);

  if (!session) {
    throw new Error('No active fishing session');
  }

  if (!session.bigOneActive) {
    throw new Error('No Big One event active');
  }

  if (Date.now() > session.bigOneExpires) {
    // Expired - reset and give nothing
    session.bigOneActive = false;
    session.bigOneFish = null;
    throw new Error('Too slow! The Big One got away.');
  }

  // Success! Award the big one fish
  const fish = session.bigOneFish;
  const sizeMultiplier = 1.3 + (Math.random() * 0.4); // Big ones are bigger
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

  // Reset big one state
  session.bigOneActive = false;
  session.bigOneFish = null;
  session.bigOneExpires = null;

  // Record in database
  await pool.query(`
    INSERT INTO user_fishing_catches (user_id, node_id, fish_type, quantity, caught_at)
    VALUES ($1, $2, $3, $4, NOW())
  `, [userId, nodeId, fish.id, 1]);

  // Daily/Weekly quest progress hooks (fire-and-forget pattern)
  getPartyLeaderId(userId).then(characterId => {
    if (characterId) {
      // Track fish catch with Big One flag
      dailyQuestService.updateProgress(characterId, 'fish_catches', 1, {
        rarity: fish.rarity,
        isBigOne: true
      }).catch(err => console.warn('[Quest] fish_catches progress failed:', err.message));
    }
  }).catch(err => console.warn('[Quest] Failed to get characterId for big one:', err.message));

  return {
    success: true,
    message: `You caught a ${fish.name}! (Big One bonus!)`,
    catch: catchRecord,
    sessionStats: {
      totalCatches: session.catches.length,
      totalValue: session.totalValue
    }
  };
}

/**
 * End fishing session and collect rewards
 * @param {number} userId - User ID
 * @param {number} nodeId - Fishing spot node ID
 * @returns {Object} Session summary with total rewards
 */
export async function endSession(userId, nodeId) {
  const sessionKey = `${userId}-${nodeId}`;
  const session = activeSessions.get(sessionKey);

  if (!session) {
    throw new Error('No active fishing session');
  }

  // Calculate final stats
  const duration = Math.floor((Date.now() - session.startTime) / 1000);
  const totalCatches = session.catches.length;
  const totalValue = session.totalValue;

  // Award gold to user (capped at MAX_GOLD to prevent overflow)
  if (totalValue > 0) {
    await pool.query(`
      UPDATE users SET gold = LEAST(gold + $1, $2) WHERE id = $3
    `, [totalValue, MAX_GOLD, userId]);

    // Daily/Weekly quest progress - track gold earned (fire-and-forget)
    getPartyLeaderId(userId).then(characterId => {
      if (characterId) {
        dailyQuestService.updateProgress(characterId, 'gold_earned', totalValue, {})
          .catch(err => console.warn('[Quest] gold_earned progress failed:', err.message));
      }
    }).catch(err => console.warn('[Quest] Failed to get characterId for gold:', err.message));
  }

  // Get updated gold
  const userResult = await pool.query(`
    SELECT gold FROM users WHERE id = $1
  `, [userId]);

  // Clean up session
  activeSessions.delete(sessionKey);

  // Summarize catches by rarity
  const catchesByRarity = {
    common: 0,
    uncommon: 0,
    rare: 0,
    epic: 0,
    legendary: 0
  };

  for (const c of session.catches) {
    catchesByRarity[c.rarity] = (catchesByRarity[c.rarity] || 0) + 1;
  }

  return {
    success: true,
    message: `Fishing session complete! You earned ${totalValue} gold.`,
    summary: {
      duration,
      totalCatches,
      totalValue,
      catchesByRarity,
      catches: session.catches
    },
    newGold: userResult.rows[0].gold
  };
}

/**
 * Get active session status
 * @param {number} userId - User ID
 * @param {number} nodeId - Fishing spot node ID
 * @returns {Object|null} Session status or null
 */
export function getSessionStatus(userId, nodeId) {
  const sessionKey = `${userId}-${nodeId}`;
  const session = activeSessions.get(sessionKey);

  if (!session) {
    return null;
  }

  return {
    active: true,
    startTime: session.startTime,
    duration: Math.floor((Date.now() - session.startTime) / 1000),
    totalCatches: session.catches.length,
    totalValue: session.totalValue,
    bigOneActive: session.bigOneActive,
    bigOneExpiresIn: session.bigOneActive
      ? Math.max(0, session.bigOneExpires - Date.now())
      : null
  };
}

/**
 * Clean up expired sessions (call periodically)
 */
export function cleanupExpiredSessions() {
  const now = Date.now();

  for (const [key, session] of activeSessions.entries()) {
    const duration = now - session.startTime;
    if (duration > FISHING_CONFIG.maxSessionDuration * 1.5) {
      // Session way over time limit, force cleanup
      activeSessions.delete(key);
    }
  }
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
    cleanupExpiredSessions();
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
