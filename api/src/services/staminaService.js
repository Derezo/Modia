/**
 * Stamina Service - Handles stamina calculation, regeneration, and deduction for world travel
 */

import { query } from '../config/database.js';

// Constants
const REGEN_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes per stamina point
const DEFAULT_MAX_STAMINA = 8;

/**
 * Calculate current stamina including regeneration since last update
 * @param {Object} character - Character with stamina, stamina_updated_at, max_stamina
 * @returns {number} Current stamina after applying regeneration
 */
export function calculateCurrentStamina(character) {
  const storedStamina = character.stamina ?? DEFAULT_MAX_STAMINA;
  const maxStamina = character.max_stamina ?? DEFAULT_MAX_STAMINA;

  // If already at max, no regen needed
  if (storedStamina >= maxStamina) {
    return maxStamina;
  }

  const updatedAt = new Date(character.stamina_updated_at || Date.now());
  const elapsedMs = Date.now() - updatedAt.getTime();
  const regenPoints = Math.floor(elapsedMs / REGEN_INTERVAL_MS);

  return Math.min(maxStamina, storedStamina + regenPoints);
}

/**
 * Get full stamina info for a character including regen timing
 * @param {number} characterId - Character ID
 * @returns {Promise<Object>} Stamina info with current, max, and nextRegenAt
 */
export async function getStaminaInfo(characterId) {
  const result = await query(
    `SELECT stamina, stamina_updated_at, max_stamina
     FROM characters WHERE id = $1`,
    [characterId]
  );

  if (result.rows.length === 0) {
    throw new Error('Character not found');
  }

  const character = result.rows[0];
  const current = calculateCurrentStamina(character);
  const max = character.max_stamina ?? DEFAULT_MAX_STAMINA;

  // Calculate next regen time
  let nextRegenAt = null;
  if (current < max) {
    const updatedAt = new Date(character.stamina_updated_at || Date.now());
    const elapsedMs = Date.now() - updatedAt.getTime();
    const msUntilNextRegen = REGEN_INTERVAL_MS - (elapsedMs % REGEN_INTERVAL_MS);
    nextRegenAt = new Date(Date.now() + msUntilNextRegen).toISOString();
  }

  return {
    current,
    max,
    nextRegenAt,
    regenIntervalSeconds: REGEN_INTERVAL_MS / 1000
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
 * Applies any pending regeneration first, then deducts
 * @param {number} characterId - Character ID
 * @param {number} amount - Amount to deduct
 * @returns {Promise<Object>} Updated stamina info
 * @throws {Error} If insufficient stamina
 */
export async function deductStamina(characterId, amount) {
  if (amount <= 0) {
    throw new Error('Deduction amount must be positive');
  }

  // Get current stamina (with regen applied)
  const info = await getStaminaInfo(characterId);

  if (info.current < amount) {
    throw new Error(`Insufficient stamina: have ${info.current}, need ${amount}`);
  }

  const newStamina = info.current - amount;

  // Update in database with new timestamp
  await query(
    `UPDATE characters
     SET stamina = $1, stamina_updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [newStamina, characterId]
  );

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
export async function getPartyStaminaInfo(characterIds) {
  if (!characterIds.length) {
    return {};
  }

  const result = await query(
    `SELECT id, stamina, stamina_updated_at, max_stamina
     FROM characters WHERE id = ANY($1)`,
    [characterIds]
  );

  const staminaMap = {};
  for (const character of result.rows) {
    const current = calculateCurrentStamina(character);
    const max = character.max_stamina ?? DEFAULT_MAX_STAMINA;

    let nextRegenAt = null;
    if (current < max) {
      const updatedAt = new Date(character.stamina_updated_at || Date.now());
      const elapsedMs = Date.now() - updatedAt.getTime();
      const msUntilNextRegen = REGEN_INTERVAL_MS - (elapsedMs % REGEN_INTERVAL_MS);
      nextRegenAt = new Date(Date.now() + msUntilNextRegen).toISOString();
    }

    staminaMap[character.id] = { current, max, nextRegenAt };
  }

  return staminaMap;
}
