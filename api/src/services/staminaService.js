/**
 * Stamina Service - Handles stamina calculation, regeneration, and deduction for world travel
 */

import { query } from '../config/database.js';
import {
  loadStaminaRegenWindows,
  STANDARD_SHRINE_EFFECTS
} from './shrineEffectService.js';

// Constants
const IS_DEVELOPMENT = process.env.NODE_ENV !== 'production';
const REGEN_INTERVAL_MS = IS_DEVELOPMENT
  ? 5 * 1000           // 5 seconds in development
  : 2 * 60 * 1000;     // 2 minutes in production
const DEFAULT_MAX_STAMINA = 8;
const STAMINA_REGEN_BONUS_RATE = STANDARD_SHRINE_EFFECTS.stamina_regen.rate;

function toTimestamp(value, fallback) {
  const timestamp = new Date(value ?? fallback).getTime();
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

/**
 * Merge and clamp stamina blessing windows so overlapping same-type blessings
 * increase regeneration only once.
 */
export function mergeStaminaRegenWindows(
  regenWindows = [],
  periodStartMs = Number.NEGATIVE_INFINITY,
  periodEndMs = Number.POSITIVE_INFINITY
) {
  const normalized = regenWindows
    .map(window => {
      const startsAt = toTimestamp(
        window?.startsAt ?? window?.last_visited_at,
        Number.NaN
      );
      const expiresAt = toTimestamp(
        window?.expiresAt ?? window?.expires_at,
        Number.NaN
      );
      return {
        startsAt: Math.max(startsAt, periodStartMs),
        expiresAt: Math.min(expiresAt, periodEndMs)
      };
    })
    .filter(window =>
      Number.isFinite(window.startsAt) &&
      Number.isFinite(window.expiresAt) &&
      window.expiresAt > window.startsAt
    )
    .sort((left, right) => left.startsAt - right.startsAt);

  const merged = [];
  for (const window of normalized) {
    const previous = merged[merged.length - 1];
    if (previous && window.startsAt <= previous.expiresAt) {
      previous.expiresAt = Math.max(previous.expiresAt, window.expiresAt);
    } else {
      merged.push({ ...window });
    }
  }
  return merged;
}

/**
 * Calculate the complete lazy-regeneration state for a character.
 *
 * Regeneration is expressed as elapsed base-interval progress plus 50% extra
 * progress only during blessing windows. This preserves progress earned before
 * activation/expiry and avoids multiplying overlapping blessings.
 */
export function calculateStaminaState(
  character,
  { now = Date.now(), regenWindows = [] } = {}
) {
  const nowMs = toTimestamp(now, Date.now());
  const storedStamina = Math.max(0, character.stamina ?? DEFAULT_MAX_STAMINA);
  const maxStamina = character.max_stamina ?? DEFAULT_MAX_STAMINA;
  const activeWindows = mergeStaminaRegenWindows(
    regenWindows,
    nowMs,
    Number.POSITIVE_INFINITY
  );
  const activeWindow = activeWindows.find(
    window => window.startsAt <= nowMs && window.expiresAt > nowMs
  );
  const activeMultiplier = activeWindow
    ? 1 + STAMINA_REGEN_BONUS_RATE
    : 1;

  if (storedStamina >= maxStamina) {
    return {
      current: maxStamina,
      max: maxStamina,
      nextRegenAt: null,
      regenIntervalSeconds: REGEN_INTERVAL_MS / activeMultiplier / 1000,
      staminaRegenBonusActive: Boolean(activeWindow)
    };
  }

  const updatedAtMs = toTimestamp(character.stamina_updated_at, nowMs);
  const elapsedMs = Math.max(0, nowMs - updatedAtMs);
  const mergedWindows = mergeStaminaRegenWindows(
    regenWindows,
    updatedAtMs,
    nowMs
  );
  const blessedElapsedMs = mergedWindows.reduce(
    (total, window) => total + (window.expiresAt - window.startsAt),
    0
  );
  const regenProgress = (
    elapsedMs + (blessedElapsedMs * STAMINA_REGEN_BONUS_RATE)
  ) / REGEN_INTERVAL_MS;
  const regenPoints = Math.floor(regenProgress);
  const current = Math.min(maxStamina, storedStamina + regenPoints);

  if (current >= maxStamina) {
    return {
      current,
      max: maxStamina,
      nextRegenAt: null,
      regenIntervalSeconds: REGEN_INTERVAL_MS / activeMultiplier / 1000,
      staminaRegenBonusActive: Boolean(activeWindow)
    };
  }

  const fractionalProgress = regenProgress - regenPoints;
  let progressNeededMs = (1 - fractionalProgress) * REGEN_INTERVAL_MS;
  let msUntilNextRegen;

  if (activeWindow) {
    const activeRemainingMs = activeWindow.expiresAt - nowMs;
    const blessedCapacityMs = activeRemainingMs * activeMultiplier;
    if (progressNeededMs <= blessedCapacityMs) {
      msUntilNextRegen = progressNeededMs / activeMultiplier;
    } else {
      progressNeededMs -= blessedCapacityMs;
      msUntilNextRegen = activeRemainingMs + progressNeededMs;
    }
  } else {
    msUntilNextRegen = progressNeededMs;
  }

  return {
    current,
    max: maxStamina,
    nextRegenAt: new Date(nowMs + msUntilNextRegen).toISOString(),
    regenIntervalSeconds: REGEN_INTERVAL_MS / activeMultiplier / 1000,
    staminaRegenBonusActive: Boolean(activeWindow)
  };
}

/**
 * Calculate current stamina including regeneration since last update
 * @param {Object} character - Character with stamina, stamina_updated_at, max_stamina
 * @returns {number} Current stamina after applying regeneration
 */
export function calculateCurrentStamina(character, options = {}) {
  return calculateStaminaState(character, options).current;
}

/**
 * Get full stamina info for a character including regen timing
 * @param {number} characterId - Character ID
 * @returns {Promise<Object>} Stamina info with current, max, and nextRegenAt
 */
export async function getStaminaInfo(
  characterId,
  { queryFn = query, now = new Date() } = {}
) {
  const result = await queryFn(
    `SELECT user_id, stamina, stamina_updated_at, max_stamina
     FROM characters WHERE id = $1`,
    [characterId]
  );

  if (result.rows.length === 0) {
    throw new Error('Character not found');
  }

  const character = result.rows[0];
  const periodStart = new Date(character.stamina_updated_at || now);
  const regenWindows = await loadStaminaRegenWindows(character.user_id, periodStart, {
    queryFn,
    now
  });
  const staminaState = calculateStaminaState(character, { now, regenWindows });

  return {
    ...staminaState,
    storedStamina: character.stamina  // Raw DB value for atomic updates
  };
}

/**
 * Get current stamina for a character (simple version)
 * @param {number} characterId - Character ID
 * @returns {Promise<number>} Current stamina
 */
export async function getCurrentStamina(characterId) {
  const info = await getStaminaInfo(characterId);
  return info.current;
}

/**
 * Deduct stamina from a character atomically
 * Uses optimistic locking to prevent race conditions
 * @param {number} characterId - Character ID
 * @param {number} amount - Amount to deduct
 * @param {number} retryCount - Internal retry counter
 * @returns {Promise<Object>} Updated stamina info
 * @throws {Error} If insufficient stamina or max retries exceeded
 */
export async function deductStamina(characterId, amount, retryCount = 0) {
  const MAX_RETRIES = 3;

  if (amount <= 0) {
    throw new Error('Deduction amount must be positive');
  }

  // Get current stamina (with regen applied)
  const info = await getStaminaInfo(characterId);

  if (info.current < amount) {
    throw new Error(`Insufficient stamina: have ${info.current}, need ${amount}`);
  }

  const newStamina = info.current - amount;

  // Atomic update: only succeeds if stored stamina hasn't changed
  // This prevents race conditions where two requests both pass validation
  const result = await query(
    `UPDATE characters
     SET stamina = $1, stamina_updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND stamina = $3
     RETURNING id`,
    [newStamina, characterId, info.storedStamina]
  );

  // If no rows updated, another request modified stamina - retry
  if (result.rowCount === 0) {
    if (retryCount >= MAX_RETRIES) {
      throw new Error('Unable to deduct stamina: too many concurrent requests');
    }
    return deductStamina(characterId, amount, retryCount + 1);
  }

  // Return new stamina info
  return getStaminaInfo(characterId);
}

/**
 * Check if a character has enough stamina for a cost
 * @param {number} characterId - Character ID
 * @param {number} cost - Required stamina cost
 * @returns {Promise<boolean>} True if sufficient stamina
 */
export async function hasEnoughStamina(characterId, cost) {
  const current = await getCurrentStamina(characterId);
  return current >= cost;
}

/**
 * Restore stamina to a character (e.g., from item use or resting)
 * @param {number} characterId - Character ID
 * @param {number} amount - Amount to restore
 * @returns {Promise<Object>} Updated stamina info
 */
export async function restoreStamina(characterId, amount) {
  if (amount <= 0) {
    throw new Error('Restore amount must be positive');
  }

  const info = await getStaminaInfo(characterId);
  const newStamina = Math.min(info.max, info.current + amount);

  await query(
    `UPDATE characters
     SET stamina = $1, stamina_updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [newStamina, characterId]
  );

  return getStaminaInfo(characterId);
}

/**
 * Get stamina info for multiple characters (for party display)
 * @param {number[]} characterIds - Array of character IDs
 * @returns {Promise<Object>} Map of characterId -> stamina info
 */
export async function getPartyStaminaInfo(
  characterIds,
  { queryFn = query, now = new Date() } = {}
) {
  if (!characterIds.length) {
    return {};
  }

  const result = await queryFn(
    `SELECT id, user_id, stamina, stamina_updated_at, max_stamina
     FROM characters WHERE id = ANY($1)`,
    [characterIds]
  );

  const staminaMap = {};
  for (const character of result.rows) {
    const periodStart = new Date(character.stamina_updated_at || now);
    const regenWindows = await loadStaminaRegenWindows(
      character.user_id,
      periodStart,
      { queryFn, now }
    );
    staminaMap[character.id] = calculateStaminaState(character, {
      now,
      regenWindows
    });
  }

  return staminaMap;
}

// Gold cost per stamina point when restoring for gold
const STAMINA_RESTORE_GOLD_COST = 100;

/**
 * Restore stamina to a character by paying gold
 * Requires the Vitality Charm relic and being at a town node
 * @param {number} userId - User ID (for gold deduction)
 * @param {number} characterId - Character ID (for stamina restore)
 * @param {number} amount - Amount of stamina to restore
 * @param {number} costPerPoint - Gold cost per stamina point (default 100)
 * @returns {Promise<Object>} Result with stamina and gold info
 */
export async function restoreStaminaForGold(userId, characterId, amount, costPerPoint = STAMINA_RESTORE_GOLD_COST) {
  if (amount <= 0) {
    throw new Error('Restore amount must be positive');
  }

  // Get current stamina info
  const staminaInfo = await getStaminaInfo(characterId);

  // Calculate how much stamina can actually be restored (up to max)
  const maxRestorable = staminaInfo.max - staminaInfo.current;
  if (maxRestorable <= 0) {
    throw new Error('Stamina is already full');
  }

  const actualAmount = Math.min(amount, maxRestorable);
  const goldCost = actualAmount * costPerPoint;

  // Check and deduct gold from user atomically
  const goldResult = await query(
    `UPDATE users
     SET gold = gold - $1
     WHERE id = $2 AND gold >= $1
     RETURNING gold`,
    [goldCost, userId]
  );

  if (goldResult.rows.length === 0) {
    // Check actual gold for better error message
    const userGold = await query('SELECT gold FROM users WHERE id = $1', [userId]);
    const currentGold = userGold.rows[0]?.gold || 0;
    throw new Error(`Insufficient gold. Need ${goldCost}, have ${currentGold}`);
  }

  // Restore stamina
  const newStamina = Math.min(staminaInfo.max, staminaInfo.current + actualAmount);
  await query(
    `UPDATE characters
     SET stamina = $1, stamina_updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [newStamina, characterId]
  );

  // Get updated stamina info
  const updatedStamina = await getStaminaInfo(characterId);

  return {
    staminaRestored: actualAmount,
    goldSpent: goldCost,
    newGold: goldResult.rows[0].gold,
    stamina: updatedStamina
  };
}

/**
 * Restore stamina to a character by paying gold (transaction-safe version)
 * Uses an existing database client for transaction support
 * @param {Object} client - Database client from pool.connect()
 * @param {number} userId - User ID (for gold deduction)
 * @param {number} characterId - Character ID (for stamina restore)
 * @param {number} amount - Amount of stamina to restore
 * @param {number} costPerPoint - Gold cost per stamina point (default 100)
 * @returns {Promise<Object>} Result with stamina and gold info
 */
export async function restoreStaminaForGoldWithClient(client, userId, characterId, amount, costPerPoint = STAMINA_RESTORE_GOLD_COST) {
  if (amount <= 0) {
    throw new Error('Restore amount must be positive');
  }

  // Get current stamina info using client
  const staminaResult = await client.query(
    `SELECT user_id, stamina, stamina_updated_at, max_stamina
     FROM characters WHERE id = $1`,
    [characterId]
  );

  if (staminaResult.rows.length === 0) {
    throw new Error('Character not found');
  }

  const character = staminaResult.rows[0];
  const now = new Date();
  const regenWindows = await loadStaminaRegenWindows(
    character.user_id,
    new Date(character.stamina_updated_at || now),
    { queryFn: client.query.bind(client), now }
  );
  const currentStamina = calculateCurrentStamina(character, {
    now,
    regenWindows
  });
  const maxStamina = character.max_stamina ?? DEFAULT_MAX_STAMINA;

  // Calculate how much stamina can actually be restored (up to max)
  const maxRestorable = maxStamina - currentStamina;
  if (maxRestorable <= 0) {
    throw new Error('Stamina is already full');
  }

  const actualAmount = Math.min(amount, maxRestorable);
  const goldCost = actualAmount * costPerPoint;

  // Check and deduct gold from user atomically
  const goldResult = await client.query(
    `UPDATE users
     SET gold = gold - $1
     WHERE id = $2 AND gold >= $1
     RETURNING gold`,
    [goldCost, userId]
  );

  if (goldResult.rows.length === 0) {
    // Check actual gold for better error message
    const userGold = await client.query('SELECT gold FROM users WHERE id = $1', [userId]);
    const currentGold = userGold.rows[0]?.gold || 0;
    throw new Error(`Insufficient gold. Need ${goldCost}, have ${currentGold}`);
  }

  // Restore stamina
  const newStamina = Math.min(maxStamina, currentStamina + actualAmount);
  await client.query(
    `UPDATE characters
     SET stamina = $1, stamina_updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [newStamina, characterId]
  );

  // Get updated stamina info (using client for consistency within transaction)
  const updatedResult = await client.query(
    `SELECT user_id, stamina, stamina_updated_at, max_stamina
     FROM characters WHERE id = $1`,
    [characterId]
  );
  const updatedChar = updatedResult.rows[0];
  const updatedNow = new Date();
  const updatedRegenWindows = await loadStaminaRegenWindows(
    updatedChar.user_id,
    new Date(updatedChar.stamina_updated_at || updatedNow),
    { queryFn: client.query.bind(client), now: updatedNow }
  );
  const updatedStamina = calculateStaminaState(updatedChar, {
    now: updatedNow,
    regenWindows: updatedRegenWindows
  });

  return {
    staminaRestored: actualAmount,
    goldSpent: goldCost,
    newGold: goldResult.rows[0].gold,
    stamina: updatedStamina
  };
}

// Export constants for testing
export { REGEN_INTERVAL_MS, DEFAULT_MAX_STAMINA, STAMINA_RESTORE_GOLD_COST };
