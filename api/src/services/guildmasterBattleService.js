/**
 * Guildmaster Battle Service
 *
 * Handles generation of solo advancement boss battles:
 * - Guildmaster = fully mastered target class
 * - Disciples = lower tier classes from same guild tree
 * - Scaled to challenger level
 * - 1v5 battle format (1 player vs guildmaster + disciples)
 */

import { query, withTransaction } from '../config/database.js';
import { calculateStats, GUILD_ADVANCEMENT_TIERS, CLASS_MOVEMENT } from '../config/constants.js';
import { SKILL_TREES } from '../config/skillTrees.js';
// createPlayerBattleUnit could be used for future multi-character guildmaster battles
// import { createPlayerBattleUnit } from './battleUnitFactory.js';
import * as bossService from './bossService.js';
import { generateTerrain } from '../../../shared/mapGeneration.js';

const BASE_CLASSES = ['warrior', 'wizard', 'monk', 'chemist'];

/**
 * Generate a guildmaster battle for advancement
 * @param {Object} character - Character attempting advancement
 * @param {string} targetClass - Class to advance to
 * @param {number} nodeId - Guild node ID where battle takes place
 * @returns {Object} Battle state and configuration
 */
export async function generateGuildmasterBattle(character, targetClass, _nodeId) {
  // Get guildmaster template from database
  const templateResult = await query(
    'SELECT * FROM guildmaster_templates WHERE guild_class = $1',
    [targetClass]
  );

  if (templateResult.rows.length === 0) {
    throw new Error(`No guildmaster template found for class: ${targetClass}`);
  }

  const guildmasterTemplate = templateResult.rows[0];

  // Determine guild and tier
  const guildId = guildmasterTemplate.guild_id || getGuildForClass(targetClass);
  const tier = guildmasterTemplate.guild_tier;

  // Create player battle unit (solo - just the one character)
  const playerUnit = await createSoloPlayerUnit(character);

  // Create guildmaster unit scaled to challenger level
  const guildmaster = createGuildmasterUnit(guildmasterTemplate, character.level);

  // Create disciple units based on tier
  const disciples = createDiscipleUnits(guildId, tier, character.level, guildmasterTemplate.disciple_classes);

  // Combine enemies (guildmaster first, then disciples)
  const enemies = [guildmaster, ...disciples];

  // Generate battle map - use 'guild' node type for advancement battles
  const mapSeed = Date.now() % 1000000;
  const terrainData = generateTerrain(mapSeed, 'guild', 32, 32, { elevation: true });

  // Position units on map
  positionUnits([playerUnit], enemies, 32, 32);

  // Build initial battle state
  const initialState = {
    turn: 1,
    phase: 'active',
    currentActorIndex: 0,
    units: [playerUnit, ...enemies],
    terrain: terrainData.terrain,
    elevation: terrainData.elevation,
    obstacles: terrainData.obstacles,
    mapWidth: 32,
    mapHeight: 32,
    bossStates: {}
  };

  // Initialize boss state for guildmaster
  const bossState = bossService.initializeBossState(guildmaster, 0); // Battle ID assigned later
  if (bossState) {
    initialState.bossStates[guildmaster.id] = bossState;
  }

  return {
    initialState,
    guildmaster,
    disciples,
    playerUnit,
    mapSeed,
    guildmasterTemplate,
    isAdvancementBattle: true,
    targetClass,
    challengerId: character.id
  };
}

/**
 * Create a solo player battle unit
 */
async function createSoloPlayerUnit(character) {
  // Get full character data with equipment
  const charResult = await query(
    `SELECT c.*, r.name as race_name
     FROM characters c
     LEFT JOIN races r ON c.race = r.id::text
     WHERE c.id = $1`,
    [character.id]
  );

  const char = charResult.rows[0] || character;

  // Get equipped items for stat bonuses
  const equipResult = await query(
    `SELECT ci.*, it.stat_bonuses, it.equipment_slot
     FROM character_items ci
     JOIN item_templates it ON ci.item_template_id = it.id
     WHERE ci.character_id = $1 AND ci.is_equipped = true`,
    [character.id]
  );

  // Calculate equipment bonuses
  const equipmentBonuses = calculateEquipmentBonuses(equipResult.rows);

  // Get character skills
  const skillsResult = await query(
    'SELECT skill_id, level FROM character_skills WHERE character_id = $1',
    [character.id]
  );

  const skills = skillsResult.rows.map(s => ({
    id: s.skill_id,
    level: s.level
  }));

  return {
    id: `player_${character.id}`,
    characterId: character.id,
    type: 'player',
    name: char.name,
    class: char.class,
    race: char.race,
    level: char.level,
    hp: char.hp_current || char.hp_max,
    maxHp: char.hp_max + (equipmentBonuses.hp || 0),
    mp: char.mp_current || char.mp_max,
    maxMp: char.mp_max + (equipmentBonuses.mp || 0),
    strength: char.strength + (equipmentBonuses.strength || 0),
    intelligence: char.intelligence + (equipmentBonuses.intelligence || 0),
    agility: char.agility + (equipmentBonuses.agility || 0),
    vitality: char.vitality + (equipmentBonuses.vitality || 0),
    luck: char.luck || 10,
    attack: (equipmentBonuses.attack || 0),
    defense: (equipmentBonuses.defense || 0),
    magicAttack: (equipmentBonuses.magicAttack || 0),
    magicDefense: (equipmentBonuses.magicDefense || 0),
    movement: CLASS_MOVEMENT[char.class] || 3,
    skills,
    ct: 0,
    statusEffects: [],
    moveUsed: false,
    actUsed: false,
    x: 0,
    y: 0
  };
}

/**
 * Create guildmaster battle unit
 */
function createGuildmasterUnit(template, challengerLevel) {
  // Scale guildmaster to be slightly above challenger level
  const level = Math.max(template.base_level, challengerLevel + 5);

  // Calculate scaled stats
  const baseStats = {
    hp: template.base_hp,
    mp: template.base_mp,
    strength: template.base_strength,
    intelligence: template.base_intelligence,
    agility: template.base_agility,
    vitality: template.base_vitality
  };

  // Level scaling factor
  const scaleFactor = 1 + (level - template.base_level) * 0.05;

  const skills = (template.skills || []).map(skill => ({
    id: skill.id,
    name: skill.name,
    power: skill.power,
    range: skill.range || 1,
    mpCost: skill.mpCost || 0,
    damageType: skill.damageType || 'physical',
    effect: skill.effect,
    effectChance: skill.effectChance
  }));

  return {
    id: `guildmaster_${template.guild_class}`,
    type: 'enemy',
    name: template.name,
    title: template.title,
    class: template.guild_class,
    level,
    hp: Math.floor(baseStats.hp * scaleFactor),
    maxHp: Math.floor(baseStats.hp * scaleFactor),
    mp: Math.floor(baseStats.mp * scaleFactor),
    maxMp: Math.floor(baseStats.mp * scaleFactor),
    strength: Math.floor(baseStats.strength * scaleFactor),
    intelligence: Math.floor(baseStats.intelligence * scaleFactor),
    agility: Math.floor(baseStats.agility * scaleFactor),
    vitality: Math.floor(baseStats.vitality * scaleFactor),
    luck: 15,
    attack: Math.floor((template.attack_bonus || 0) * scaleFactor),
    defense: Math.floor((template.defense_bonus || 0) * scaleFactor),
    magicAttack: Math.floor((template.attack_bonus || 0) * scaleFactor * 0.8),
    magicDefense: Math.floor((template.defense_bonus || 0) * scaleFactor * 0.8),
    movement: CLASS_MOVEMENT[template.guild_class] || 3,
    skills,
    phases: template.phases || [],
    ct: 0,
    statusEffects: [],
    moveUsed: false,
    actUsed: false,
    x: 0,
    y: 0,
    isBoss: true,
    currentPhase: 1,
    maxPhases: (template.phases || []).length || 1,
    phaseName: (template.phases?.[0]?.name) || 'Phase 1',
    spriteId: template.sprite_id,
    aiType: template.ai_type || 'tactical'
  };
}

/**
 * Create disciple units for the battle
 */
function createDiscipleUnits(guildId, currentTier, challengerLevel, discipleClasses) {
  const disciples = [];
  const tiers = GUILD_ADVANCEMENT_TIERS[guildId];

  if (!tiers) {
    return disciples;
  }

  // Get disciple classes from template or derive from lower tiers
  const classesToUse = discipleClasses && discipleClasses.length > 0
    ? discipleClasses
    : getDiscipleClasses(guildId, currentTier);

  // Create 2-4 disciples based on tier
  const discipleCount = Math.min(currentTier + 1, 4);

  for (let i = 0; i < discipleCount && i < classesToUse.length; i++) {
    const discipleClass = classesToUse[i];
    const disciple = createDiscipleUnit(discipleClass, challengerLevel, i);
    disciples.push(disciple);
  }

  return disciples;
}

/**
 * Get disciple classes based on tier (lower tier classes)
 */
function getDiscipleClasses(guildId, currentTier) {
  const classes = [];

  // Include base class
  classes.push(guildId);

  // Include lower tier advanced classes
  const tiers = GUILD_ADVANCEMENT_TIERS[guildId];
  for (let i = 0; i < currentTier - 1 && i < tiers.length; i++) {
    classes.push(tiers[i]);
  }

  return classes;
}

/**
 * Create a single disciple unit
 */
function createDiscipleUnit(className, challengerLevel, index) {
  // Disciples are at or slightly below challenger level
  const level = Math.max(1, challengerLevel - 2 + index);

  // Determine race for stat calculation (use human as default)
  const race = 'human';
  const stats = calculateStats(race, className, level);

  // Get skills from skill tree
  const skillTree = SKILL_TREES[className];
  const skills = skillTree?.skills?.slice(0, 3).map(s => ({
    id: s.id,
    name: s.name,
    power: s.power || 80,
    range: s.range || 1,
    mpCost: s.mpCost || 5,
    damageType: s.damageType || 'physical'
  })) || [{ id: 'attack', name: 'Attack', power: 80, range: 1 }];

  return {
    id: `disciple_${className}_${index}`,
    type: 'enemy',
    name: `${className.charAt(0).toUpperCase() + className.slice(1)} Disciple`,
    class: className,
    race,
    level,
    hp: stats.hpMax,
    maxHp: stats.hpMax,
    mp: stats.mpMax,
    maxMp: stats.mpMax,
    strength: stats.strength,
    intelligence: stats.intelligence,
    agility: stats.agility,
    vitality: stats.vitality,
    luck: 10,
    attack: 0,
    defense: 0,
    magicAttack: 0,
    magicDefense: 0,
    movement: CLASS_MOVEMENT[className] || 3,
    skills,
    ct: 0,
    statusEffects: [],
    moveUsed: false,
    actUsed: false,
    x: 0,
    y: 0,
    aiType: 'standard'
  };
}

/**
 * Calculate equipment stat bonuses
 */
function calculateEquipmentBonuses(equipment) {
  const bonuses = {
    hp: 0,
    mp: 0,
    attack: 0,
    defense: 0,
    magicAttack: 0,
    magicDefense: 0,
    strength: 0,
    intelligence: 0,
    agility: 0,
    vitality: 0
  };

  for (const item of equipment) {
    const statBonuses = item.stat_bonuses || {};

    for (const [stat, value] of Object.entries(statBonuses)) {
      if (bonuses[stat] !== undefined) {
        bonuses[stat] += value;
      }
    }
  }

  return bonuses;
}

/**
 * Position units on the battle map
 */
function positionUnits(playerUnits, enemyUnits, mapWidth, mapHeight) {
  // Player unit starts on left side
  for (let i = 0; i < playerUnits.length; i++) {
    playerUnits[i].x = 2;
    playerUnits[i].y = Math.floor(mapHeight / 2);
  }

  // Enemy units on right side - guildmaster center, disciples around
  const centerY = Math.floor(mapHeight / 2);
  const startX = mapWidth - 5;

  for (let i = 0; i < enemyUnits.length; i++) {
    if (i === 0) {
      // Guildmaster in center
      enemyUnits[i].x = startX;
      enemyUnits[i].y = centerY;
    } else {
      // Disciples in formation around guildmaster
      const offset = Math.floor((i + 1) / 2) * (i % 2 === 1 ? 1 : -1);
      enemyUnits[i].x = startX - 2;
      enemyUnits[i].y = centerY + offset * 2;
    }
  }
}

/**
 * Get guild for a class
 */
function getGuildForClass(className) {
  if (BASE_CLASSES.includes(className)) {
    return className;
  }
  for (const [guild, tiers] of Object.entries(GUILD_ADVANCEMENT_TIERS)) {
    if (tiers.includes(className)) {
      return guild;
    }
  }
  return null;
}

/**
 * Create the actual battle record in database
 */
export async function createGuildmasterBattleRecord(battleConfig, userId) {
  const { initialState, mapSeed, isAdvancementBattle, targetClass: _targetClass, challengerId } = battleConfig;

  return await withTransaction(async (client) => {
    // Create battle record with advancement flags
    const battleResult = await client.query(
      `INSERT INTO battles (
        battle_type, status, battle_state, map_seed, map_width, map_height,
        player1_id, is_advancement_battle, challenger_character_id
      )
      VALUES ('pve', 'active', $1, $2, 32, 32, $3, $4, $5)
      RETURNING id`,
      [JSON.stringify(initialState), mapSeed, userId, isAdvancementBattle, challengerId]
    );

    const battleId = battleResult.rows[0].id;

    // Update boss state with actual battle ID
    if (Object.keys(initialState.bossStates).length > 0) {
      for (const [_unitId, bossState] of Object.entries(initialState.bossStates)) {
        bossState.battleId = battleId;
        await bossService.saveBossEncounter(bossState);
      }
    }

    // Mark character as in battle
    await client.query(
      'UPDATE characters SET in_battle = true WHERE id = $1',
      [challengerId]
    );

    return battleId;
  });
}

export default {
  generateGuildmasterBattle,
  createGuildmasterBattleRecord
};
