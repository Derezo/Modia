/**
 * Zodiac Ability Service - Load and manage zodiac signature abilities for battles
 *
 * Zodiac signature abilities are account-level blessings that remain
 * available for every battle during their world-map duration. Battle state
 * tracks the single use allowed to the owning party in each battle.
 */

import { query } from '../config/database.js';
import { ZODIAC_SHRINE_BUFFS } from '../../../shared/constants.js';

const TARGETED_ZODIAC_ABILITIES = new Set([
  'venom_sting',
  'dreamwave'
]);
const ZODIAC_SIGNS = Object.freeze(Object.keys(ZODIAC_SHRINE_BUFFS));
const COMPLETE_COLLECTION_SIZE = ZODIAC_SIGNS.length;

function mapZodiacAbilityRow(row) {
  const signInfo = ZODIAC_SHRINE_BUFFS[row.zodiac_sign];
  if (
    !signInfo
    || signInfo.signatureAbility !== row.signature_ability
  ) {
    return null;
  }

  return {
    key: row.signature_ability,
    zodiacSign: row.zodiac_sign,
    name: signInfo.name,
    description: signInfo.description,
    element: signInfo.element,
    needsTarget: TARGETED_ZODIAC_ABILITIES.has(row.signature_ability),
    expiresAt: row.expires_at instanceof Date
      ? row.expires_at.toISOString()
      : row.expires_at
  };
}

function getZodiacBlessingSlotCount(row) {
  const canonicalCrystalCount = Number(row?.canonical_crystal_count) || 0;
  return canonicalCrystalCount >= COMPLETE_COLLECTION_SIZE ? 2 : 1;
}

/**
 * Rows arrive newest-first. Keep only canonical, unique abilities within the
 * account's current one/two-slot entitlement. This read-time guard prevents
 * legacy over-cap visits from leaking extra signatures into a new battle
 * before the player next activates a shrine.
 */
function selectEntitledZodiacAbilities(rows) {
  const slotCount = getZodiacBlessingSlotCount(rows[0]);
  const selected = [];
  const seenAbilities = new Set();

  for (const row of rows) {
    const ability = mapZodiacAbilityRow(row);
    if (!ability || seenAbilities.has(ability.key)) continue;
    selected.push(ability);
    seenAbilities.add(ability.key);
    if (selected.length >= slotCount) break;
  }

  return selected;
}

/**
 * Load active zodiac abilities for a user
 * Returns abilities that:
 * 1. Have not expired (buff_expires_at > NOW())
 * 2. Fit the account's current one/two-slot Zodiac entitlement
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
      `WITH canonical_crystals AS (
         SELECT COUNT(DISTINCT zodiac_sign) AS canonical_crystal_count
         FROM user_zodiac_crystals
         WHERE user_id = $1
           AND zodiac_sign = ANY($2::varchar[])
       )
       SELECT wn.zodiac_sign, usv.signature_ability, usv.buff_type,
              usv.expires_at, usv.last_visited_at, usv.node_id,
              canonical_crystals.canonical_crystal_count
       FROM user_shrine_visits usv
       JOIN world_nodes wn ON usv.node_id = wn.id
       CROSS JOIN canonical_crystals
       WHERE usv.user_id = $1
         AND usv.expires_at > NOW()
         AND usv.signature_ability IS NOT NULL
       ORDER BY usv.last_visited_at DESC NULLS LAST, usv.node_id DESC`,
      [userId, ZODIAC_SIGNS]
    );

    return selectEntitledZodiacAbilities(result.rows);
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
    `WITH canonical_crystals AS (
       SELECT user_id,
              COUNT(DISTINCT zodiac_sign) AS canonical_crystal_count
       FROM user_zodiac_crystals
       WHERE user_id = ANY($1)
         AND zodiac_sign = ANY($2::varchar[])
       GROUP BY user_id
     )
     SELECT usv.user_id, wn.zodiac_sign, usv.signature_ability,
            usv.expires_at, usv.last_visited_at, usv.node_id,
            COALESCE(
              canonical_crystals.canonical_crystal_count,
              0
            ) AS canonical_crystal_count
     FROM user_shrine_visits usv
     JOIN world_nodes wn ON usv.node_id = wn.id
     LEFT JOIN canonical_crystals
       ON canonical_crystals.user_id = usv.user_id
     WHERE usv.user_id = ANY($1)
       AND usv.expires_at > NOW()
       AND usv.signature_ability IS NOT NULL
     ORDER BY usv.user_id, usv.last_visited_at DESC NULLS LAST,
              usv.node_id DESC`,
    [userIds, ZODIAC_SIGNS]
  );

  const abilitiesByUser = {};
  for (const userId of userIds) {
    abilitiesByUser[userId] = [];
  }

  const rowsByUser = new Map();
  for (const row of result.rows) {
    const key = String(row.user_id);
    if (!rowsByUser.has(key)) rowsByUser.set(key, []);
    rowsByUser.get(key).push(row);
  }
  for (const userId of userIds) {
    abilitiesByUser[userId] = selectEntitledZodiacAbilities(
      rowsByUser.get(String(userId)) || []
    );
  }

  return abilitiesByUser;
}

/**
 * Check if a user has a specific zodiac ability available
 *
 * @param {number} userId - User ID
 * @param {string} abilityKey - Ability key to check
 * @returns {Promise<boolean>}
 */
export async function hasAvailableAbility(userId, abilityKey) {
  if (!ZODIAC_SIGNS.some(
    sign => ZODIAC_SHRINE_BUFFS[sign].signatureAbility === abilityKey
  )) return false;

  const abilities = await loadActiveZodiacAbilities(userId);
  return abilities.some(ability => ability.key === abilityKey);
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
      needsTarget: TARGETED_ZODIAC_ABILITIES.has(info.signatureAbility),
      duration: info.duration
    };
  }

  return abilities;
}

export default {
  loadActiveZodiacAbilities,
  loadZodiacAbilitiesForUsers,
  hasAvailableAbility,
  getAllZodiacAbilities
};
