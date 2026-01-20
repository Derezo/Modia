/**
 * Character Valuation Service - Calculates Player Power Rating (PPR)
 * Used for PvP matchmaking to create balanced matches
 *
 * Power Rating Formula:
 * - statValue = (STR + VIT + AGI + INT + LCK) * 10
 * - levelValue = level * 100
 * - skillXP = sum of all XP spent on skills (calculated from skill levels)
 * - equipmentValue = sum of equipment values / 10
 *
 * Equipment value = basePrice * rarityMultiplier + (augmentCount * 500)
 * Rarity multipliers: 1(common):1, 2(uncommon):1.5, 3(rare):2.5, 4(epic):5, 5(legendary):10
 */

import { query } from '../config/database.js';
import { MAX_BATTLE_PARTY_SIZE } from '../config/constants.js';
import { SKILL_TREES } from '../config/skillTrees.js';

// Rarity multipliers for equipment valuation (rarity is integer 1-5 in database)
const RARITY_MULTIPLIERS = {
  1: 1.0,     // Common
  2: 1.5,     // Uncommon
  3: 2.5,     // Rare
  4: 5.0,     // Epic
  5: 10.0    // Legendary
};

// Augment bonus per augment on equipment
const AUGMENT_BONUS = 500;

/**
 * Calculate the XP spent to reach a given skill level
 * Uses the same formula as skills.js: baseCost * Math.pow(1.2, levelIndex)
 * @param {number} baseCost - Base cost of the skill
 * @param {number} level - Current level of the skill
 * @returns {number} Total XP spent to reach this level
 */
function calculateSkillXPForLevel(baseCost, level) {
  let totalXP = 0;
  for (let i = 0; i < level; i++) {
    totalXP += Math.floor(baseCost * Math.pow(1.2, i));
  }
  return totalXP;
}

/**
 * Get the base cost for a skill from the skill trees
 * @param {string} skillId - The skill ID
 * @returns {number} Base cost or 0 if not found
 */
function getSkillBaseCost(skillId) {
  for (const guildTree of Object.values(SKILL_TREES)) {
    for (const branch of guildTree.branches) {
      const skill = branch.skills.find(s => s.id === skillId);
      if (skill) {
        return skill.baseCost;
      }
    }
  }
  return 0;
}

/**
 * Calculate total XP spent on skills for a character
 * @param {number} characterId - Character ID
 * @returns {Promise<number>} Total XP spent on skills
 */
async function calculateSkillXPSpent(characterId) {
  const result = await query(
    'SELECT skill_id, level FROM character_skills WHERE character_id = $1',
    [characterId]
  );

  let totalXP = 0;
  for (const skill of result.rows) {
    const baseCost = getSkillBaseCost(skill.skill_id);
    if (baseCost > 0) {
      totalXP += calculateSkillXPForLevel(baseCost, skill.level);
    }
  }

  return totalXP;
}

/**
 * Calculate equipment value for a character
 * @param {number} characterId - Character ID
 * @returns {Promise<number>} Total equipment value
 */
async function calculateEquipmentValue(characterId) {
  const result = await query(
    `SELECT
       ci.id,
       it.base_price,
       it.rarity,
       ci.modifications
     FROM character_items ci
     JOIN item_templates it ON ci.item_template_id = it.id
     WHERE ci.character_id = $1 AND ci.equipped_slot IS NOT NULL`,
    [characterId]
  );

  let totalValue = 0;

  for (const item of result.rows) {
    const basePrice = item.base_price || 100;
    const rarity = item.rarity || 1;
    const rarityMultiplier = RARITY_MULTIPLIERS[rarity] || 1.0;

    // Count augments from modifications JSON
    const modifications = item.modifications || {};
    // Count non-null values in modifications as augments
    const augmentCount = Object.values(modifications).filter(v => v !== null && v !== undefined).length;
    const augmentBonus = augmentCount * AUGMENT_BONUS;

    totalValue += Math.floor(basePrice * rarityMultiplier) + augmentBonus;
  }

  return totalValue;
}

/**
 * Calculate the power rating for a single character
 * @param {Object} character - Character with stats
 * @param {Object} options - Additional data (skillXP, equipmentValue)
 * @returns {number} Character power rating
 */
function calculateCharacterPower(character, options = {}) {
  // Base stat value: sum of all stats * 10
  const statValue = (
    (character.strength || 0) +
    (character.vitality || 0) +
    (character.agility || 0) +
    (character.intelligence || 0) +
    (character.luck || 0)
  ) * 10;

  // Level contribution: level * 100
  const levelValue = (character.level || 1) * 100;

  // Skill XP spent contribution
  const skillXP = options.skillXP || 0;

  // Equipment value contribution (divided by 10 to normalize)
  const equipmentValue = options.equipmentValue || 0;
  const equipmentContribution = Math.floor(equipmentValue / 10);

  return statValue + levelValue + skillXP + equipmentContribution;
}

/**
 * Calculate power for a single character with full data fetch
 * @param {number} characterId - Character ID
 * @returns {Promise<Object>} Character power and breakdown
 */
async function getCharacterPowerWithBreakdown(characterId) {
  const charResult = await query(
    `SELECT id, name, class, level, strength, vitality, agility, intelligence, luck, party_slot
     FROM characters WHERE id = $1`,
    [characterId]
  );

  if (charResult.rows.length === 0) {
    return null;
  }

  const char = charResult.rows[0];
  const skillXP = await calculateSkillXPSpent(characterId);
  const equipmentValue = await calculateEquipmentValue(characterId);

  const statValue = (char.strength + char.vitality + char.agility + char.intelligence + char.luck) * 10;
  const levelValue = char.level * 100;
  const equipmentContribution = Math.floor(equipmentValue / 10);
  const totalPower = statValue + levelValue + skillXP + equipmentContribution;

  return {
    id: char.id,
    name: char.name,
    class: char.class,
    level: char.level,
    partySlot: char.party_slot,
    power: totalPower,
    breakdown: {
      stats: statValue,
      level: levelValue,
      skills: skillXP,
      equipment: equipmentContribution,
      equipmentRawValue: equipmentValue
    }
  };
}

/**
 * Calculate the total Player Power Rating (PPR) for a user
 * Uses the top 5 characters by power (or all if fewer than 5)
 * @param {number} userId - User ID
 * @returns {Promise<number>} Player Power Rating
 */
async function calculatePlayerPower(userId) {
  // Get all characters for this user
  const result = await query(
    `SELECT id, level, strength, vitality, agility, intelligence, luck
     FROM characters WHERE user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return 0;
  }

  // Calculate power for each character (including skills and equipment)
  const characterPowers = await Promise.all(
    result.rows.map(async (char) => {
      const skillXP = await calculateSkillXPSpent(char.id);
      const equipmentValue = await calculateEquipmentValue(char.id);
      return calculateCharacterPower(char, { skillXP, equipmentValue });
    })
  );

  // Sort by power descending and take top 5
  characterPowers.sort((a, b) => b - a);
  const topPowers = characterPowers.slice(0, 5);

  // Sum the top 5 (or all if fewer)
  return topPowers.reduce((sum, power) => sum + power, 0);
}

/**
 * Calculate PPR for a user's battle party only
 * Used for queue-specific matchmaking
 * @param {number} userId - User ID
 * @returns {Promise<number>} Battle party power rating
 */
async function calculateBattlePartyPower(userId) {
  // Get battle party characters (those with party_slot set)
  const result = await query(
    `SELECT id, level, strength, vitality, agility, intelligence, luck
     FROM characters
     WHERE user_id = $1 AND party_slot IS NOT NULL AND party_slot <= $2
     ORDER BY party_slot`,
    [userId, MAX_BATTLE_PARTY_SIZE]
  );

  if (result.rows.length === 0) {
    return 0;
  }

  // Calculate power for each character in battle party
  const characterPowers = await Promise.all(
    result.rows.map(async (char) => {
      const skillXP = await calculateSkillXPSpent(char.id);
      const equipmentValue = await calculateEquipmentValue(char.id);
      return calculateCharacterPower(char, { skillXP, equipmentValue });
    })
  );

  // Sum all battle party powers
  return characterPowers.reduce((sum, power) => sum + power, 0);
}

/**
 * Get detailed power breakdown for a user (for UI display)
 * @param {number} userId - User ID
 * @returns {Promise<Object>} Detailed power breakdown
 */
async function getPlayerPowerBreakdown(userId) {
  const result = await query(
    `SELECT id, name, class, level, strength, vitality, agility, intelligence, luck, party_slot
     FROM characters
     WHERE user_id = $1
     ORDER BY party_slot NULLS LAST, level DESC`,
    [userId]
  );

  if (result.rows.length === 0) {
    return {
      totalPPR: 0,
      battlePartyPPR: 0,
      characters: [],
      top5Characters: []
    };
  }

  // Calculate full breakdown for each character
  const characters = await Promise.all(
    result.rows.map(async (char) => {
      const skillXP = await calculateSkillXPSpent(char.id);
      const equipmentValue = await calculateEquipmentValue(char.id);

      const statValue = (char.strength + char.vitality + char.agility + char.intelligence + char.luck) * 10;
      const levelValue = char.level * 100;
      const equipmentContribution = Math.floor(equipmentValue / 10);
      const totalPower = statValue + levelValue + skillXP + equipmentContribution;

      return {
        id: char.id,
        name: char.name,
        class: char.class,
        level: char.level,
        partySlot: char.party_slot,
        power: totalPower,
        breakdown: {
          stats: statValue,
          level: levelValue,
          skills: skillXP,
          equipment: equipmentContribution
        }
      };
    })
  );

  // Calculate total PPR (top 5)
  const sortedByPower = [...characters].sort((a, b) => b.power - a.power);
  const top5 = sortedByPower.slice(0, 5);
  const totalPPR = top5.reduce((sum, c) => sum + c.power, 0);

  // Calculate battle party PPR
  const battleParty = characters.filter(c => c.partySlot !== null);
  const battlePartyPPR = battleParty.reduce((sum, c) => sum + c.power, 0);

  return {
    totalPPR,
    battlePartyPPR,
    characters,
    top5Characters: top5.map(c => c.id)
  };
}

export {
  calculateCharacterPower,
  calculateEquipmentValue,
  calculateSkillXPSpent,
  calculateSkillXPForLevel,
  getSkillBaseCost,
  getCharacterPowerWithBreakdown,
  calculatePlayerPower,
  calculateBattlePartyPower,
  getPlayerPowerBreakdown,
  RARITY_MULTIPLIERS,
  AUGMENT_BONUS
};
