/**
 * Battle Unit Factory - Creates unified battle units for players and NPCs
 *
 * All combat participants share the same BattleUnit interface, enabling
 * unified logic for movement, actions, skills, and AI decision-making.
 */

import { CLASS_MOVEMENT } from '../config/constants.js';
import traitService from './traitService.js';

/**
 * BattleUnit interface (documented for reference):
 * {
 *   // Identity
 *   id: string | number,      // Unique identifier
 *   type: 'player' | 'enemy', // Team affiliation
 *   name: string,
 *   class: string,            // Guild/class (warrior, wizard, monster, dragon, etc.)
 *   level: number,
 *
 *   // Core Stats
 *   hp, maxHp, mp, maxMp,
 *   strength, intelligence, agility, vitality, luck,
 *
 *   // Combat Bonuses (from equipment or template)
 *   attack, defense, magicAttack, magicDefense,
 *
 *   // Position
 *   tileX, tileY,
 *
 *   // Turn System
 *   ct, moveUsed, actUsed, turnPhase, hasActed,
 *
 *   // Status
 *   statusEffects: [],
 *   skillCooldowns: {},
 *
 *   // Skills
 *   skills: [],               // Available skills for this unit
 *
 *   // Movement/Range
 *   movement: number,         // Movement range
 *   attackRange: number,      // Base attack range
 *
 *   // AI (NPCs only)
 *   aiType?: string,
 *
 *   // Metadata
 *   ownerId?: number,         // Player who controls this unit
 *   templateId?: number,      // For enemies: template reference
 *   archetype?: string,       // Monster archetype (beast, dragon, etc.)
 * }
 */

/**
 * Create a player battle unit from character data
 * @param {Object} character - Character from database
 * @param {Object} formation - Formation position data (optional)
 * @param {Array} skills - Loaded skills array
 * @param {Object} options - Additional options (defaultX, defaultY, traits)
 * @returns {Object} BattleUnit object
 */
function createPlayerBattleUnit(character, formation = null, skills = [], options = {}) {
  const defaultX = options.defaultX ?? 3;
  const defaultY = options.defaultY ?? 15;
  const traits = options.traits || [];

  const unit = {
    // Identity
    id: character.id,
    type: 'player',
    name: character.name,
    class: character.class,
    level: character.level || 1,
    race: character.race,
    gender: character.gender || 'other',

    // Core Stats (with equipment bonuses applied)
    hp: character.hp_current ?? character.hp_max,
    maxHp: character.hp_max + (character.equip_hp || 0),
    mp: character.mp_current ?? character.mp_max,
    maxMp: character.mp_max + (character.equip_mp || 0),
    strength: character.strength + (character.equip_strength || 0),
    intelligence: character.intelligence + (character.equip_intelligence || 0),
    agility: character.agility + (character.equip_agility || 0),
    vitality: character.vitality + (character.equip_vitality || 0),
    luck: character.luck + (character.equip_luck || 0),

    // Combat Bonuses (from equipment)
    attack: character.equip_attack || 0,
    defense: character.equip_defense || 0,
    magicAttack: character.equip_magic_attack || 0,
    magicDefense: character.equip_magic_defense || 0,

    // Position (from formation or defaults)
    tileX: formation?.tileX ?? defaultX,
    tileY: formation?.tileY ?? defaultY,

    // Turn System
    ct: 0,
    moveUsed: false,
    actUsed: false,
    turnPhase: 'ready',
    hasActed: false,

    // Status
    statusEffects: [],
    skillCooldowns: {},

    // Skills
    skills: skills,

    // Traits (innate bonuses from guild recruits)
    traits: traits,

    // Movement/Range (from class)
    movement: CLASS_MOVEMENT[character.class?.toLowerCase()] || 3,
    attackRange: 1, // Default melee, can be extended by equipment

    // Metadata
    ownerId: character.user_id,

    // Equipment info for rendering/display
    equipment: character.equipment || null,

    // Death save tracking (for Second Wind trait)
    deathSaveUsed: false
  };

  // Apply battle-start trait effects (HP/MP bonuses, movement/range bonuses)
  traitService.applyBattleStartTraits(unit);

  return unit;
}

/**
 * Archetype-based stat growth rates that match player class scaling
 * This ensures enemies at equal level have equivalent stats to players
 */
const ARCHETYPE_GROWTH = {
  beast:     { hp: 8,  str: 2.5, int: 1,   agi: 2,   vit: 2,   lck: 0.5 },
  humanoid:  { hp: 12, str: 2,   int: 2,   agi: 2,   vit: 2,   lck: 1 },
  undead:    { hp: 15, str: 2,   int: 1.5, agi: 1,   vit: 3,   lck: 0 },
  elemental: { hp: 10, str: 1,   int: 3,   agi: 1.5, vit: 1.5, lck: 1 },
  dragon:    { hp: 20, str: 3,   int: 2.5, agi: 1.5, vit: 3,   lck: 1 },
  boss:      { hp: 30, str: 3.5, int: 3,   agi: 2,   vit: 4,   lck: 2 },
  // Fallback for unknown archetypes
  monster:   { hp: 10, str: 2,   int: 1.5, agi: 1.5, vit: 2,   lck: 0.5 }
};

/**
 * Difficulty tier multipliers (adjusted for balanced encounters)
 * Tier 2 (1.0) means enemies match player level exactly
 */
const TIER_MULTIPLIERS = {
  1: 0.8,   // Starting areas - slightly easier
  2: 1.0,   // Normal encounters - fair fight
  3: 1.25,  // Hard content - requires strategy
  4: 1.5,   // Expert/group content
  5: 2.0    // Boss/raid encounters
};

/**
 * Create an enemy battle unit from template with archetype-based scaling
 * Enemies now use growth rates similar to player classes for balanced encounters
 * @param {Object} template - Enemy template from database
 * @param {number} partyLevel - Average party level for scaling
 * @param {number} difficultyTier - Node difficulty tier (1-5)
 * @param {number} index - Enemy index for ID generation
 * @param {Object} position - Spawn position {x, y}
 * @param {Object} options - Additional options (biome, skills, etc.)
 * @returns {Object} BattleUnit object
 */
function createEnemyBattleUnit(template, partyLevel, difficultyTier, index, position, options = {}) {
  const { biome = 'forest', skills = [], consumables = [] } = options;

  const tierMult = TIER_MULTIPLIERS[difficultyTier] || 1.0;
  const enemyLevel = Math.max(1, Math.floor(partyLevel * tierMult));

  // Get archetype growth rates (defaults to 'monster' if not found)
  const archetype = (template.archetype || 'monster').toLowerCase();
  const growth = ARCHETYPE_GROWTH[archetype] || ARCHETYPE_GROWTH.monster;

  // Scale stats using archetype growth (same formula as player classes)
  // scaledStat = baseStat + (level * growthRate) * tierMultiplier
  const scaledHp = Math.floor((template.base_hp + (enemyLevel * growth.hp)) * tierMult);
  const scaledMp = Math.floor((template.base_mp + (enemyLevel * growth.hp * 0.3)) * tierMult); // MP scales slower
  const scaledStrength = Math.floor((template.base_strength + (enemyLevel * growth.str)) * tierMult);
  const scaledIntelligence = Math.floor((template.base_intelligence + (enemyLevel * growth.int)) * tierMult);
  const scaledAgility = Math.floor((template.base_agility + (enemyLevel * growth.agi)) * tierMult);
  const scaledVitality = Math.floor(((template.base_vitality || template.base_hp / 10) + (enemyLevel * growth.vit)) * tierMult);
  const scaledLuck = Math.floor(((template.base_luck || 10) + (enemyLevel * growth.lck)) * tierMult);

  // Get class from template (new field) or derive from archetype
  const enemyClass = template.enemy_class || template.guild || 'monster';

  return {
    // Identity
    id: `enemy_${index}`,
    type: 'enemy',
    name: template.name,
    class: enemyClass,
    level: enemyLevel,

    // Core Stats (scaled with archetype growth)
    hp: scaledHp,
    maxHp: scaledHp,
    mp: scaledMp,
    maxMp: scaledMp,
    strength: scaledStrength,
    intelligence: scaledIntelligence,
    agility: scaledAgility,
    vitality: scaledVitality,
    luck: scaledLuck,

    // Combat Bonuses (from template, also scaled by tier)
    attack: Math.floor((template.attack_bonus || 0) * tierMult),
    defense: Math.floor((template.defense_bonus || 0) * tierMult),
    magicAttack: Math.floor((template.magic_attack_bonus || 0) * tierMult),
    magicDefense: Math.floor((template.magic_defense_bonus || 0) * tierMult),

    // Position
    tileX: position.x,
    tileY: position.y,

    // Turn System
    ct: 0,
    moveUsed: false,
    actUsed: false,
    turnPhase: 'ready',
    hasActed: false,

    // Status
    statusEffects: [],
    skillCooldowns: {},

    // Skills (from NPC skill service or template abilities)
    skills: skills.length > 0 ? skills : (template.abilities || []),

    // Consumables (from NPC item service)
    consumables: consumables,

    // Movement/Range
    movement: template.movement || CLASS_MOVEMENT[enemyClass?.toLowerCase()] || 3,
    attackRange: template.attack_range || 1,

    // AI
    aiType: template.ai_type || 'aggressive',

    // Archetype (for monster skill trees)
    archetype: archetype,
    guild: template.guild || null,
    guildLevel: template.guild_level || 1,

    // Metadata
    templateId: template.id,
    enemyId: template.sprite_id,
    biome: biome,

    // Rewards (scaled by tier for harder content)
    experienceReward: Math.floor((template.experience_reward || 10) * tierMult),
    goldRewardMin: Math.floor((template.gold_reward_min || 1) * tierMult),
    goldRewardMax: Math.floor((template.gold_reward_max || 10) * tierMult),
    dropTable: template.drop_table || {},

    // Special states (ambush AI, etc.)
    isHidden: template.ai_type === 'ambush',
    hasAmbushed: false
  };
}

/**
 * Normalize any unit to ensure it has all required BattleUnit properties
 * Useful for backwards compatibility with existing unit objects
 * @param {Object} unit - Any unit object
 * @returns {Object} Normalized BattleUnit
 */
function normalizeUnit(unit) {
  return {
    ...unit,
    // Ensure required properties exist
    statusEffects: unit.statusEffects || [],
    skillCooldowns: unit.skillCooldowns || {},
    skills: unit.skills || unit.abilities || [],
    movement: unit.movement || CLASS_MOVEMENT[unit.class?.toLowerCase()] || 3,
    attackRange: unit.attackRange || 1,
    moveUsed: unit.moveUsed ?? false,
    actUsed: unit.actUsed ?? false,
    turnPhase: unit.turnPhase || 'ready',
    attack: unit.attack || 0,
    defense: unit.defense || 0,
    magicAttack: unit.magicAttack || 0,
    magicDefense: unit.magicDefense || 0
  };
}

/**
 * Check if a unit is a player unit
 * @param {Object} unit - BattleUnit
 * @returns {boolean}
 */
function isPlayerUnit(unit) {
  return unit.type === 'player';
}

/**
 * Check if a unit is an enemy unit
 * @param {Object} unit - BattleUnit
 * @returns {boolean}
 */
function isEnemyUnit(unit) {
  return unit.type === 'enemy';
}

/**
 * Get the opposite type
 * @param {string} type - 'player' or 'enemy'
 * @returns {string}
 */
function getOppositeType(type) {
  return type === 'player' ? 'enemy' : 'player';
}

/**
 * Check if unit is alive
 * @param {Object} unit - BattleUnit
 * @returns {boolean}
 */
function isAlive(unit) {
  return unit.hp > 0;
}

/**
 * Get all alive units of a specific type
 * @param {Array} units - Array of units
 * @param {string} type - 'player' or 'enemy'
 * @returns {Array}
 */
function getAliveUnitsOfType(units, type) {
  return units.filter(u => u.type === type && u.hp > 0);
}

export {
  createPlayerBattleUnit,
  createEnemyBattleUnit,
  normalizeUnit,
  isPlayerUnit,
  isEnemyUnit,
  getOppositeType,
  isAlive,
  getAliveUnitsOfType
};

export default {
  createPlayerBattleUnit,
  createEnemyBattleUnit,
  normalizeUnit,
  isPlayerUnit,
  isEnemyUnit,
  getOppositeType,
  isAlive,
  getAliveUnitsOfType
};
