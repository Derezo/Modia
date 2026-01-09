/**
 * Enemy Service - Template-based procedural enemy generation
 */

const { query } = require('../config/database');
const { generateEnemySkills } = require('./npcSkillService');
const { generateNpcItems } = require('./npcItemService');

// Difficulty tier multipliers for stat scaling
const TIER_MULTIPLIERS = {
  1: 0.9,
  2: 1.1,
  3: 1.35,
  4: 1.75,
  5: 2.15
};

// Enemy count ranges by difficulty tier (weighted randomization)
const ENEMY_COUNT_RANGES = {
  1: { min: 3, max: 4 },
  2: { min: 3, max: 5 },
  3: { min: 4, max: 6 },
  4: { min: 5, max: 7 },
  5: { min: 5, max: 7 }
};

// Enemy spawn zone on right side of 32x32 map
const ENEMY_SPAWN_ZONE = {
  minX: 25,
  maxX: 30,
  minY: 10,
  maxY: 21
};

/**
 * Generate unique random positions for enemies
 * @param {number} count - Number of positions to generate
 * @returns {Array<{x: number, y: number}>} Array of position objects
 */
function generateEnemyPositions(count) {
  const positions = [];
  const usedPositions = new Set();

  for (let i = 0; i < count; i++) {
    let attempts = 0;
    let x, y, key;

    do {
      x = Math.floor(Math.random() * (ENEMY_SPAWN_ZONE.maxX - ENEMY_SPAWN_ZONE.minX + 1)) + ENEMY_SPAWN_ZONE.minX;
      y = Math.floor(Math.random() * (ENEMY_SPAWN_ZONE.maxY - ENEMY_SPAWN_ZONE.minY + 1)) + ENEMY_SPAWN_ZONE.minY;
      key = `${x},${y}`;
      attempts++;
    } while (usedPositions.has(key) && attempts < 50);

    usedPositions.add(key);
    positions.push({ x, y });
  }

  return positions;
}

/**
 * Select enemy templates matching node type and difficulty
 * @param {string} nodeType - The node type (forest, cave, mountain, etc.)
 * @param {number} difficultyTier - The node's difficulty tier (1-5)
 * @param {number} count - Number of enemies to select
 * @returns {Promise<Array>} Array of enemy templates
 */
async function selectEnemiesForEncounter(nodeType, difficultyTier, count) {
  // Query templates that can spawn at this node type and difficulty
  const result = await query(
    `SELECT id, name, sprite_id, base_hp, base_mp, base_strength, base_intelligence, base_agility,
            ai_type, abilities, drop_table, experience_reward, gold_reward_min, gold_reward_max,
            archetype, guild, guild_level, enemy_class, movement, attack_range,
            attack_bonus, defense_bonus, magic_attack_bonus, magic_defense_bonus
     FROM enemy_templates
     WHERE $1 = ANY(spawn_node_types) AND min_difficulty_tier <= $2
     ORDER BY RANDOM()
     LIMIT $3`,
    [nodeType, difficultyTier, count]
  );

  // If not enough templates found, pad with generic enemies
  if (result.rows.length < count) {
    // Fallback to any templates at or below current difficulty
    const fallbackResult = await query(
      `SELECT id, name, sprite_id, base_hp, base_mp, base_strength, base_intelligence, base_agility,
              ai_type, abilities, drop_table, experience_reward, gold_reward_min, gold_reward_max,
              archetype, guild, guild_level, enemy_class, movement, attack_range,
              attack_bonus, defense_bonus, magic_attack_bonus, magic_defense_bonus
       FROM enemy_templates
       WHERE min_difficulty_tier <= $1
       ORDER BY RANDOM()
       LIMIT $2`,
      [difficultyTier, count - result.rows.length]
    );
    result.rows.push(...fallbackResult.rows);
  }

  return result.rows;
}

/**
 * Scale template stats for battle instance
 * @param {Object} template - The enemy template from database
 * @param {number} partyLevel - Average party level
 * @param {number} difficultyTier - Node difficulty tier
 * @param {number} index - Enemy index for ID generation
 * @param {{x: number, y: number}} position - Pre-calculated spawn position
 * @param {string} biome - Biome type for sprite loading (forest, cave, mountain, bridge)
 * @returns {Promise<Object>} Scaled enemy object ready for battle
 */
async function createEnemyInstance(template, partyLevel, difficultyTier, index, position, biome = 'forest') {
  const tierMult = TIER_MULTIPLIERS[difficultyTier] || 1.0;

  // Calculate effective enemy level
  const enemyLevel = Math.floor(partyLevel * tierMult);

  // Scale stats based on level
  const scaledHp = Math.floor(template.base_hp * (1 + enemyLevel * 0.10));
  const scaledMp = Math.floor(template.base_mp * (1 + enemyLevel * 0.05));
  const scaledStrength = Math.floor(template.base_strength * (1 + enemyLevel * 0.05));
  const scaledIntelligence = Math.floor(template.base_intelligence * (1 + enemyLevel * 0.05));
  const scaledAgility = Math.floor(template.base_agility * (1 + enemyLevel * 0.05));

  // Generate skills for this enemy based on archetype/guild
  const skills = await generateEnemySkills(template, enemyLevel, partyLevel, difficultyTier);

  // Generate consumable items for this enemy (tier-based)
  const consumables = generateNpcItems(template, enemyLevel, difficultyTier);

  // Get movement and attack range from template (with defaults)
  const movement = template.movement || 3;
  const attackRange = template.attack_range || 1;

  return {
    id: `enemy_${index}`,
    type: 'enemy',
    templateId: template.id,
    name: template.name,
    enemyId: template.sprite_id, // Used for sprite lookup in AssetLoader.getEnemySprite()
    biome, // Biome type for sprite path
    class: template.enemy_class || 'monster',
    level: enemyLevel,
    hp: scaledHp,
    maxHp: scaledHp,
    mp: scaledMp,
    maxMp: scaledMp,
    strength: scaledStrength,
    intelligence: scaledIntelligence,
    agility: scaledAgility,
    vitality: Math.floor(scaledHp / 10), // Derived from HP for defense calc
    luck: 10,
    // Combat bonuses from template
    attack: template.attack_bonus || 0,
    defense: template.defense_bonus || 0,
    magicAttack: template.magic_attack_bonus || 0,
    magicDefense: template.magic_defense_bonus || 0,
    // Movement and range
    movement,
    attackRange,
    tileX: position.x,
    tileY: position.y,
    ct: 0, // Charge time for CT-based turn system
    hasActed: false,
    statusEffects: [],
    skillCooldowns: {}, // Track skill cooldowns
    // Skills generated from archetype/guild
    skills,
    // Consumable items (tier-based generation)
    consumables,
    aiType: template.ai_type || 'aggressive',
    archetype: template.archetype || 'beast',
    abilities: template.abilities || [],
    dropTable: template.drop_table || {},
    experienceReward: template.experience_reward || 10,
    goldRewardMin: template.gold_reward_min || 1,
    goldRewardMax: template.gold_reward_max || 10,
    // Hidden state for ambush AI
    isHidden: template.ai_type === 'ambush',
    hasAmbushed: false
  };
}

/**
 * Main entry point - Generate full encounter for a node
 * @param {number} nodeId - The world node ID
 * @param {Array} party - Array of party characters
 * @param {Array<number>|null} formationCharacterIds - Optional array of character IDs in formation (for level calculation)
 * @returns {Promise<Array>} Array of enemy unit objects
 */
async function generateEncounter(nodeId, party, formationCharacterIds = null) {
  // Get node info
  const nodeResult = await query(
    'SELECT node_type, difficulty_tier FROM world_nodes WHERE id = $1',
    [nodeId]
  );

  if (nodeResult.rows.length === 0) {
    throw new Error('Node not found');
  }

  const { node_type: nodeType, difficulty_tier: difficultyTier } = nodeResult.rows[0];

  // Filter to formation characters if provided (for accurate level scaling)
  const activeParty = formationCharacterIds
    ? party.filter(c => formationCharacterIds.includes(c.id))
    : party;

  // Calculate average party level from active formation
  const partyLevel = Math.floor(
    activeParty.reduce((sum, char) => sum + (char.level || 1), 0) / activeParty.length
  ) || 1;

  // Determine enemy count based on difficulty tier (randomized within range)
  const range = ENEMY_COUNT_RANGES[difficultyTier] || ENEMY_COUNT_RANGES[1];
  const enemyCount = Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;

  // Select templates from database
  const templates = await selectEnemiesForEncounter(nodeType, difficultyTier, enemyCount);

  // Generate randomized positions for all enemies
  const positions = generateEnemyPositions(enemyCount);

  // Create scaled enemy instances with random positions (async for skill generation)
  const enemies = await Promise.all(
    templates.map((template, index) =>
      createEnemyInstance(template, partyLevel, difficultyTier, index, positions[index], nodeType)
    )
  );

  // If we still don't have enough enemies (empty database), create generic ones
  while (enemies.length < enemyCount) {
    const index = enemies.length;
    const pos = positions[index] || { x: 28, y: 13 + index };
    enemies.push({
      id: `enemy_${index}`,
      type: 'enemy',
      templateId: null,
      enemyId: null, // Generic enemy, no specific sprite
      biome: nodeType,
      name: `Wild ${nodeType.charAt(0).toUpperCase() + nodeType.slice(1)} Creature`,
      class: 'monster',
      level: partyLevel,
      hp: 50 + partyLevel * 10,
      maxHp: 50 + partyLevel * 10,
      mp: 20,
      maxMp: 20,
      strength: 8 + partyLevel,
      intelligence: 5 + partyLevel,
      agility: 6 + partyLevel,
      vitality: 5 + partyLevel,
      luck: 10,
      // Combat bonuses (generic enemy has none)
      attack: 0,
      defense: 0,
      magicAttack: 0,
      magicDefense: 0,
      // Movement and range
      movement: 3,
      attackRange: 1,
      tileX: pos.x,
      tileY: pos.y,
      ct: 0, // Charge time for CT-based turn system
      hasActed: false,
      statusEffects: [],
      skillCooldowns: {},
      // Generic enemies have no skills
      skills: [],
      aiType: 'aggressive',
      archetype: 'beast',
      abilities: [],
      dropTable: {},
      experienceReward: 10 + partyLevel * 5,
      goldRewardMin: 1,
      goldRewardMax: 10 + partyLevel * 2,
      isHidden: false,
      hasAmbushed: false
    });
  }

  return enemies;
}

/**
 * Get encounter preview info without creating actual battle
 * Returns possible enemy types for a node without counts or levels (those are calculated at battle start)
 * @param {number} nodeId - The world node ID
 * @returns {Promise<Object>} Preview info about possible enemies
 */
async function getEncounterPreview(nodeId) {
  const nodeResult = await query(
    'SELECT node_type, difficulty_tier, name FROM world_nodes WHERE id = $1',
    [nodeId]
  );

  if (nodeResult.rows.length === 0) {
    throw new Error('Node not found');
  }

  const { node_type: nodeType, difficulty_tier: difficultyTier, name: nodeName } = nodeResult.rows[0];

  // Get possible enemies for this area (distinct names, no counts or levels)
  const enemyResult = await query(
    `SELECT DISTINCT name, sprite_id, ai_type
     FROM enemy_templates
     WHERE $1 = ANY(spawn_node_types) AND min_difficulty_tier <= $2
     ORDER BY name
     LIMIT 6`,
    [nodeType, difficultyTier]
  );

  return {
    nodeName,
    nodeType,
    difficultyTier,
    possibleEnemies: enemyResult.rows.map(e => ({
      name: e.name,
      spriteId: e.sprite_id,
      aiType: e.ai_type
    }))
  };
}

module.exports = {
  selectEnemiesForEncounter,
  createEnemyInstance,
  generateEncounter,
  getEncounterPreview,
  TIER_MULTIPLIERS
};
