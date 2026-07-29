/**
 * Zodiac Ability Service - Load and manage zodiac signature abilities for battles
 *
 * Zodiac signature abilities are special once-per-battle abilities that players
 * can use after visiting zodiac shrines in the world.
 */

import { query } from '../config/database.js';
import { ZODIAC_SHRINE_BUFFS } from '../../../shared/constants.js';

/**
 * Load active zodiac abilities for a user
 * Returns abilities that:
 * 1. Have not expired (buff_expires_at > NOW())
 * 2. Have not been used this battle (signature_used = FALSE)
 *
 * @param {number} userId - User ID to load abilities for
 * @param {{client?: Object|null}} [options] - Optional transaction client
 * @returns {Promise<Array>} Array of zodiac ability objects
 */
export async function loadActiveZodiacAbilities(userId, { client = null } = {}) {
  try {
    const executeQuery = client
      ? client.query.bind(client)
      : query;
    const result = await executeQuery(
      `SELECT wn.zodiac_sign, usv.signature_ability, usv.buff_type, usv.expires_at
       FROM user_shrine_visits usv
       JOIN world_nodes wn ON usv.node_id = wn.id
       WHERE usv.user_id = $1
         AND usv.expires_at > NOW()
         AND usv.signature_ability IS NOT NULL
         AND usv.signature_used = FALSE`,
      [userId]
    );

    return result.rows.map(row => {
      const signInfo = ZODIAC_SHRINE_BUFFS[row.zodiac_sign] || {};
      return {
        key: row.signature_ability,
        zodiacSign: row.zodiac_sign,
        name: signInfo.name || row.signature_ability,
        description: signInfo.description || '',
        element: signInfo.element || 'neutral',
        expiresAt: row.expires_at
      };
    });
  } catch (err) {
    // Handle case where zodiac_sign column doesn't exist yet (migration not run)
    if (err.code === '42703') { // PostgreSQL column does not exist error
      return [];
    }
    throw err;
  }
}

/**
 * Load zodiac abilities for multiple users (batch loading for party)
 *
 * @param {Array<number>} userIds - Array of user IDs
 * @returns {Promise<Object>} Map of userId -> abilities array
 */
export async function loadZodiacAbilitiesForUsers(userIds) {
  if (!userIds || userIds.length === 0) {
    return {};
  }

  const result = await query(
    `SELECT usv.user_id, wn.zodiac_sign, usv.signature_ability, usv.expires_at
     FROM user_shrine_visits usv
     JOIN world_nodes wn ON usv.node_id = wn.id
     WHERE usv.user_id = ANY($1)
       AND usv.expires_at > NOW()
       AND usv.signature_ability IS NOT NULL
       AND usv.signature_used = FALSE`,
    [userIds]
  );

  const abilitiesByUser = {};
  for (const userId of userIds) {
    abilitiesByUser[userId] = [];
  }

  for (const row of result.rows) {
    const signInfo = ZODIAC_SHRINE_BUFFS[row.zodiac_sign] || {};
    abilitiesByUser[row.user_id].push({
      key: row.signature_ability,
      zodiacSign: row.zodiac_sign,
      name: signInfo.name || row.signature_ability,
      description: signInfo.description || '',
      element: signInfo.element || 'neutral',
      expiresAt: row.expires_at
    });
  }

  return abilitiesByUser;
}

/**
 * Mark zodiac abilities as used after a battle ends
 * This prevents the ability from being used in future battles until
 * the player visits the shrine again.
 *
 * @param {number} userId - User ID
 * @param {Array<string>} usedAbilityKeys - Array of ability keys that were used
 */
export async function markAbilitiesUsedInBattle(userId, usedAbilityKeys) {
  if (!usedAbilityKeys || usedAbilityKeys.length === 0) {
    return;
  }

  // Get zodiac signs for the used abilities
  const zodiacSigns = usedAbilityKeys.map(key => {
    return Object.keys(ZODIAC_SHRINE_BUFFS).find(
      sign => ZODIAC_SHRINE_BUFFS[sign].signatureAbility === key
    );
  }).filter(Boolean);

  if (zodiacSigns.length === 0) {
    return;
  }

  await query(
    `UPDATE user_shrine_visits usv
     SET signature_used = TRUE
     FROM world_nodes wn
     WHERE usv.node_id = wn.id
       AND usv.user_id = $1
       AND wn.zodiac_sign = ANY($2)`,
    [userId, zodiacSigns]
  );
}

/**
 * Check if a user has a specific zodiac ability available
 *
 * @param {number} userId - User ID
 * @param {string} abilityKey - Ability key to check
 * @returns {Promise<boolean>}
 */
export async function hasAvailableAbility(userId, abilityKey) {
  const zodiacSign = Object.keys(ZODIAC_SHRINE_BUFFS).find(
    sign => ZODIAC_SHRINE_BUFFS[sign].signatureAbility === abilityKey
  );

  if (!zodiacSign) {
    return false;
  }

  const result = await query(
    `SELECT 1 FROM user_shrine_visits usv
     JOIN world_nodes wn ON usv.node_id = wn.id
     WHERE usv.user_id = $1
       AND wn.zodiac_sign = $2
       AND usv.expires_at > NOW()
       AND usv.signature_used = FALSE
     LIMIT 1`,
    [userId, zodiacSign]
  );

  return result.rows.length > 0;
}

/**
 * Get all zodiac ability definitions for reference
 *
 * @returns {Object} Map of abilityKey -> ability info
 */
export function getAllZodiacAbilities() {
  const abilities = {};

  for (const [sign, info] of Object.entries(ZODIAC_SHRINE_BUFFS)) {
    abilities[info.signatureAbility] = {
      key: info.signatureAbility,
      zodiacSign: sign,
      name: info.name,
      description: info.description,
      element: info.element,
      duration: info.duration
    };
  }

  return abilities;
}

export default {
  loadActiveZodiacAbilities,
  loadZodiacAbilitiesForUsers,
  markAbilitiesUsedInBattle,
  hasAvailableAbility,
  getAllZodiacAbilities
};
