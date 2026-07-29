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
import {
  resolveBattleSkill,
  resolveBattleSkills,
  serializeBattleSkill
} from './battle/skillDefinitionService.js';
import { withBattleVisualIdentity } from './battle/visualIdentityService.js';
import battleStateRepository from './battle/BattleStateRepository.js';
import {
  extractBattleMutableState,
  generateBattleMap,
  isBattleMapV2EnabledForMode,
  selectBattleMapGenerationVersion
} from './battle/battleMapGenerationService.js';
import { deriveEncounterTerrainSeed } from './battle/encounterService.js';
// createPlayerBattleUnit could be used for future multi-character guildmaster battles
// import { createPlayerBattleUnit } from './battleUnitFactory.js';
import * as bossService from './bossService.js';

const BASE_CLASSES = ['warrior', 'wizard', 'monk', 'chemist'];

/**
 * Hydrate persisted advancement-battle skills into the same canonical DTOs
 * used by PvE and Coliseum battle creation. Kept public for deterministic
 * validation without requiring database fixtures.
 */
export function resolveAdvancementSkills(characterClass, learnedSkills) {
  return resolveBattleSkills(characterClass, learnedSkills);
}

/**
 * Resolve the opponent template independently from the class awarded on win.
 */
export function resolveGuildmasterOpponentClass(targetClass, bossConfig) {
  const configuredClass = bossConfig?.guildmaster_class;
  return typeof configuredClass === 'string' && configuredClass.trim().length > 0
    ? configuredClass
    : targetClass;
}

/**
 * Persist the advancement identity needed to authorize quest completion.
 */
export async function persistAdvancementBattleIdentity(
  client,
  battleId,
  targetClass,
  guildmasterTemplateId
) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('persistAdvancementBattleIdentity requires a pg client');
  }
  return battleStateRepository.persistAdvancementIdentity(
    battleId,
    {
      targetClass,
      guildmasterTemplateId
    },
    { client }
  );
}

/**
 * Build a key that deduplicates one concrete boss-trial attempt without
 * permanently aliasing later retries to a completed battle.
 */
export function buildGuildmasterCreationKey({
  userId,
  challengerId,
  targetClass,
  nodeId,
  attempt
}) {
  return [
    'guildmaster',
    userId,
    challengerId,
    targetClass,
    nodeId,
    'attempt',
    attempt
  ].join(':');
}

/**
 * Serialize boss-trial creation for a user and allocate the next attempt.
 * Locking every owned character shares the lifecycle boundary used by normal
 * party battle creation, including when the challenger was omitted from that
 * battle's formation.
 */
export async function reserveGuildmasterBattleAttempt(
  client,
  {
    userId,
    challengerId,
    advancementQuestId,
    targetClass,
    nodeId
  }
) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('reserveGuildmasterBattleAttempt requires a pg client');
  }

  const charactersResult = await client.query(
    `SELECT c.id, c.user_id, c.class, c.current_node_id, c.in_battle,
            wn.node_type, wn.guild_class AS node_guild_id
     FROM characters c
     LEFT JOIN world_nodes wn ON wn.id = c.current_node_id
     WHERE c.user_id = $1
     ORDER BY c.id
     FOR UPDATE OF c`,
    [userId]
  );
  const character = charactersResult.rows.find(
    candidate => Number(candidate.id) === Number(challengerId)
  );
  if (!character) {
    throw new Error('Character not found');
  }

  const hasActiveBattle = await battleStateRepository.hasActiveBattleForPlayer(
    userId,
    { client }
  );
  if (
    hasActiveBattle
    || charactersResult.rows.some(candidate => candidate.in_battle)
  ) {
    const error = new Error('Character is already in battle');
    error.code = 'ADVANCEMENT_BATTLE_ALREADY_ACTIVE';
    throw error;
  }

  const questResult = await client.query(
    `SELECT cq.id AS quest_id,
            aqt.guild_id, aqt.target_class, aqt.prerequisite_class
     FROM character_quests cq
     JOIN advancement_quest_templates aqt
       ON aqt.id = cq.quest_template_id
     WHERE cq.character_id = $1
       AND cq.status = 'boss_ready'
     FOR UPDATE OF cq`,
    [challengerId]
  );
  const quest = questResult.rows[0];
  const expectedCurrentClass = quest?.prerequisite_class ?? quest?.guild_id;
  const stateIsCurrent = (
    quest
    && character.user_id === userId
    && character.current_node_id === nodeId
    && character.node_type === 'guild'
    && character.node_guild_id === quest.guild_id
    && quest.quest_id === advancementQuestId
    && quest.target_class === targetClass
    && character.class === expectedCurrentClass
  );
  if (!stateIsCurrent) {
    const error = new Error(
      'Advancement trial is no longer ready. Refresh the guild and try again.'
    );
    error.code = 'ADVANCEMENT_BATTLE_STATE_CHANGED';
    throw error;
  }

  const attemptSummary = await battleStateRepository.getAdvancementAttemptSummary(
    {
      challengerCharacterId: challengerId,
      targetClass,
      nodeId
    },
    { client }
  );
  if (attemptSummary.hasBlockingAttempt) {
    const error = new Error(
      'The guildmaster trial is already active or its victory is being finalized.'
    );
    error.code = 'ADVANCEMENT_BATTLE_STATE_CHANGED';
    throw error;
  }

  return attemptSummary.attemptCount + 1;
}

/**
 * Generate a guildmaster battle for advancement
 * @param {Object} character - Character attempting advancement
 * @param {string} targetClass - Class to advance to
 * @param {number} nodeId - Guild node ID where battle takes place
 * @param {Object} options - Battle generation options
 * @param {Object|null} options.bossConfig - Active quest boss configuration
 * @returns {Object} Battle state and configuration
 */
export async function generateGuildmasterBattle(
  character,
  targetClass,
  nodeId,
  {
    bossConfig = null,
    advancementQuestId = null,
    clientCapabilities = null,
    allowV2 = isBattleMapV2EnabledForMode('guild')
  } = {}
) {
  const opponentClass = resolveGuildmasterOpponentClass(
    targetClass,
    bossConfig
  );

  // Get guildmaster template from database
  const templateResult = await query(
    'SELECT * FROM guildmaster_templates WHERE guild_class = $1',
    [opponentClass]
  );

  if (templateResult.rows.length === 0) {
    throw new Error(`No guildmaster template found for class: ${opponentClass}`);
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

  // Position units on map
  positionUnits([playerUnit], enemies, 32, 32);

  // The seed and creation input are stable across retries of the same
  // advancement trial. Version selection is repeated by generateBattleMap and
  // must produce the same result for the same rollout/capabilities.
  const terrainGenerationVersion = selectBattleMapGenerationVersion({
    mode: 'guild',
    allowV2,
    clientCapabilities
  });
  const mapSeed = deriveEncounterTerrainSeed(
    nodeId,
    'guild',
    terrainGenerationVersion
  );

  // Build mutable combat state; the generation boundary appends the immutable
  // map and, for V2, relocates units to its authored spawn slots.
  const initialMutableState = {
    turn: 1,
    phase: 'active',
    currentActorIndex: 0,
    units: [playerUnit, ...enemies],
    bossStates: {}
  };

  // Initialize boss state for guildmaster
  const bossState = bossService.initializeBossState(guildmaster, 0); // Battle ID assigned later
  if (bossState) {
    initialMutableState.bossStates[guildmaster.id] = bossState;
  }

  const generatedMap = await generateBattleMap({
    terrainSeed: mapSeed,
    nodeType: 'guild',
    mapWidth: 32,
    mapHeight: 32,
    mode: 'guild',
    playerCount: 1,
    enemyCount: enemies.length,
    enemyCapacity: enemies.length,
    existingUnits: initialMutableState.units,
    initialMutableState,
    allowV2,
    clientCapabilities
  });

  return {
    // Advancement setup initializes CT immediately before persistence. Keep a
    // mutable staging copy for those combat-only edits; createBattleRecord
    // extracts its closed mutable vocabulary and the repository reconstructs
    // the immutable authoritative flat state.
    initialState: structuredClone(generatedMap.flatState),
    mutableState: generatedMap.mutableState,
    finalMap: generatedMap.finalMap,
    legacyFlatState: generatedMap.legacyFlatState,
    battleMapSchemaVersion: generatedMap.battleMapSchemaVersion,
    terrainGenerationVersion: generatedMap.terrainGenerationVersion,
    guildmaster,
    disciples,
    playerUnit,
    mapSeed,
    nodeId,
    guildmasterTemplate,
    isAdvancementBattle: true,
    advancementQuestId,
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

  const skills = resolveAdvancementSkills(char.class, skillsResult.rows);

  return withBattleVisualIdentity({
    id: `player_${character.id}`,
    characterId: character.id,
    type: 'player',
    name: char.name,
    class: char.class,
    race: char.race,
    gender: char.gender || 'other',
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
    tileX: 0,
    tileY: 0
  }, {
    kind: 'player',
    id: character.id
  });
}

/**
 * Create guildmaster battle unit
 */
export function createGuildmasterUnit(template, challengerLevel) {
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

  const skills = (template.skills || [])
    .map(skill => (
      resolveBattleSkill(template.guild_class, skill)
      || (typeof skill === 'object' ? serializeBattleSkill(skill) : null)
    ))
    .filter(Boolean);

  return withBattleVisualIdentity({
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
    tileX: 0,
    tileY: 0,
    isBoss: true,
    currentPhase: 1,
    maxPhases: (template.phases || []).length || 1,
    phaseName: (template.phases?.[0]?.name) || 'Phase 1',
    aiType: template.ai_type || 'tactical'
  }, {
    kind: 'npc',
    id: template.id ?? `guildmaster_${template.guild_class}`,
    visualId: template.sprite_id,
    primaryBiome: template.primary_biome || 'guild'
  });
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
export function createDiscipleUnit(className, challengerLevel, index) {
  // Disciples are at or slightly below challenger level
  const level = Math.max(1, challengerLevel - 2 + index);

  // Determine race for stat calculation (use human as default)
  const race = 'human';
  const stats = calculateStats(race, className, level);

  // Get skills from skill tree
  const skillTree = SKILL_TREES[className];
  const activeDefinitions = (skillTree?.branches || [])
    .flatMap(branch => branch.skills || [])
    .filter(skill => (skill.type ?? 'active') === 'active')
    .slice(0, 3);
  const skills = activeDefinitions.length > 0
    ? activeDefinitions.map(skill => serializeBattleSkill(skill)).filter(Boolean)
    : [serializeBattleSkill({
      id: 'attack',
      name: 'Attack',
      type: 'active',
      power: 80,
      range: 1,
      damageType: 'physical',
      visualCategory: 'physical'
    })];

  const visualId = `disciple_${className}`;

  return withBattleVisualIdentity({
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
    tileX: 0,
    tileY: 0,
    aiType: 'standard'
  }, {
    kind: 'npc',
    id: visualId,
    visualId,
    primaryBiome: 'guild'
  });
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
export function positionUnits(playerUnits, enemyUnits, mapWidth, mapHeight) {
  // Player unit starts on left side
  for (let i = 0; i < playerUnits.length; i++) {
    playerUnits[i].tileX = 2;
    playerUnits[i].tileY = Math.floor(mapHeight / 2);
  }

  // Enemy units on right side - guildmaster center, disciples around
  const centerY = Math.floor(mapHeight / 2);
  const startX = mapWidth - 5;

  for (let i = 0; i < enemyUnits.length; i++) {
    if (i === 0) {
      // Guildmaster in center
      enemyUnits[i].tileX = startX;
      enemyUnits[i].tileY = centerY;
    } else {
      // Disciples in formation around guildmaster
      const offset = Math.floor((i + 1) / 2) * (i % 2 === 1 ? 1 : -1);
      enemyUnits[i].tileX = startX - 2;
      enemyUnits[i].tileY = centerY + offset * 2;
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
  const {
    initialState,
    mutableState: generatedMutableState,
    finalMap,
    legacyFlatState,
    isAdvancementBattle,
    advancementQuestId,
    targetClass,
    challengerId,
    nodeId
  } = battleConfig;
  const mutableState = extractBattleMutableState(
    initialState ?? generatedMutableState
  );

  const created = await withTransaction(async (client) => {
    const attempt = await reserveGuildmasterBattleAttempt(client, {
      userId,
      challengerId,
      advancementQuestId,
      targetClass,
      nodeId
    });
    const creationIdempotencyKey = buildGuildmasterCreationKey({
      userId,
      challengerId,
      targetClass,
      nodeId,
      attempt
    });
    const result = await battleStateRepository.createBattle({
      battleType: 'pve',
      status: 'active',
      nodeId,
      player1Id: userId,
      isAdvancementBattle,
      challengerCharacterId: challengerId,
      creationIdempotencyKey,
      finalMap,
      legacyFlatState,
      initialMutableState: mutableState
    }, { client });
    await persistAdvancementBattleIdentity(
      client,
      result.battleId,
      targetClass,
      battleConfig.guildmasterTemplate.id
    );
    for (const bossState of Object.values(mutableState.bossStates)) {
      await bossService.saveBossEncounter({
        ...bossState,
        battleId: result.battleId
      }, { client });
    }
    // Mark character as in battle
    await client.query(
      'UPDATE characters SET in_battle = true WHERE id = $1',
      [challengerId]
    );
    return result;
  });

  battleConfig.initialState = created.envelope.state;
  return created.battleId;
}

export default {
  generateGuildmasterBattle,
  createGuildmasterBattleRecord,
  reserveGuildmasterBattleAttempt
};
