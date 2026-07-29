/**
 * Audio Constants and Helper Functions
 * Extracted from AudioAssets.js for modularization
 */

// =============================================================================
// CONSTANTS
// =============================================================================

/** Region IDs for music context */
export const REGIONS = ['heartlands', 'sylvan_reaches', 'iron_depths', 'shadowmere', 'bloodplains'];

/**
 * Maps race names (from API) to region IDs (for music)
 * The API returns region_race ('human', 'elf', etc.) - music tracks use region names
 * Keys are lowercase to match API response format
 */
export const RACE_TO_REGION = {
  'human': 'heartlands',
  'elf': 'sylvan_reaches',
  'dwarf': 'iron_depths',
  'vampire': 'shadowmere',
  'orc': 'bloodplains'
};

/** Node types that have regional music */
export const NODE_TYPES = ['exploration', 'tavern', 'shop', 'fishing', 'ruins'];

/** Battle types with regional variations */
export const BATTLE_TYPES = ['regular', 'boss', 'pvp', 'story'];

/** Player skill guilds */
export const PLAYER_GUILDS = ['warrior', 'wizard', 'monk', 'chemist', 'berserker', 'sorcerer', 'ninja', 'alchemist'];

/** Monster archetypes */
export const MONSTER_ARCHETYPES = ['beast', 'dragon', 'undead', 'elemental', 'humanoid', 'construct', 'demon', 'insect', 'plant'];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Helper to get regional music key
 * @param {string} region - Region ID
 * @param {string} type - Node type (exploration, tavern, shop, fishing, ruins)
 * @returns {string} Music key
 */
export function getRegionalMusicKey(region, type) {
  return `${region}_${type}`;
}

/**
 * Helper to get battle music key
 * @param {string} region - Region ID
 * @param {string} battleType - Battle type (regular, boss, pvp, story)
 * @returns {string} Music key
 */
export function getBattleMusicKey(region, battleType) {
  return `${region}_battle_${battleType}`;
}

/**
 * Helper to get skill sound key
 * @param {string} skillId - Skill identifier
 * @param {boolean} isMonster - Whether it's a monster skill
 * @returns {string} SFX key
 */
export function getSkillSoundKey(skillId, isMonster = false) {
  return isMonster ? `monster_${skillId}` : `skill_${skillId}`;
}

/**
 * Helper to get UI sound key
 * @param {string} id - UI sound identifier
 * @returns {string} UI sound key
 */
export function getUiSoundKey(id) {
  return id;
}

/**
 * Helper to get interaction sound key
 * @param {string} id - Interaction identifier
 * @returns {string} Interaction sound key
 */
export function getInteractionSoundKey(id) {
  return id;
}

/**
 * Helper to get ambient sound key
 * @param {string} id - Ambient identifier
 * @returns {string} Ambient sound key
 */
export function getAmbientSoundKey(id) {
  return id;
}
