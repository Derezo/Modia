/**
 * Enemy Service - Template-based procedural enemy generation
 */

const { query } = require('../config/database');

// Difficulty tier multipliers for stat scaling
const TIER_MULTIPLIERS = {
  1: 0.9,
  2: 1.1,
  3: 1.35,
  4: 1.75,
  5: 2.15
};

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
            ai_type, abilities, drop_table, experience_reward, gold_reward_min, gold_reward_max
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
              ai_type, abilities, drop_table, experience_reward, gold_reward_min, gold_reward_max
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
 * @param {number} index - Enemy index for positioning
 * @returns {Object} Scaled enemy object ready for battle
 */
function createEnemyInstance(template, partyLevel, difficultyTier, index) {
  const tierMult = TIER_MULTIPLIERS[difficultyTier] || 1.0;

  // Calculate effective enemy level
  const enemyLevel = Math.floor(partyLevel * tierMult);

  // Scale stats based on level
  const scaledHp = Math.floor(template.base_hp * (1 + enemyLevel * 0.10));
  const scaledMp = Math.floor(template.base_mp * (1 + enemyLevel * 0.05));
  const scaledStrength = Math.floor(template.base_strength * (1 + enemyLevel * 0.05));
  const scaledIntelligence = Math.floor(template.base_intelligence * (1 + enemyLevel * 0.05));
  const scaledAgility = Math.floor(template.base_agility * (1 + enemyLevel * 0.05));

  // Calculate position (enemies spawn on right side of 32x32 map)
  const tileX = 28 + (index % 3);
  const tileY = 13 + Math.floor(index / 3) * 2;

  return {
    id: `enemy_${index}`,
    type: 'enemy',
    templateId: template.id,
    name: template.name,
    spriteId: template.sprite_id,
    class: 'monster',
    level: enemyLevel,
    hp: scaledHp,
    maxHp: scaledHp,
    mp: scaledMp,
    maxMp: scaledMp,
    strength: scaledStrength,
    intelligence: scaledIntelligence,
    agility: scaledAgility,
    tileX,
    tileY,
    hasActed: false,
    statusEffects: [],
    aiType: template.ai_type || 'aggressive',
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
 * @returns {Promise<Array>} Array of enemy unit objects
 */
async function generateEncounter(nodeId, party) {
  // Get node info
  const nodeResult = await query(
    'SELECT node_type, difficulty_tier FROM world_nodes WHERE id = $1',
    [nodeId]
  );

  if (nodeResult.rows.length === 0) {
    throw new Error('Node not found');
  }

  const { node_type: nodeType, difficulty_tier: difficultyTier } = nodeResult.rows[0];

  // Calculate average party level
  const partyLevel = Math.floor(
    party.reduce((sum, char) => sum + (char.level || 1), 0) / party.length
  ) || 1;

  // Determine enemy count based on difficulty and party size
  const baseEnemyCount = Math.min(difficultyTier + 2, 5);
  const enemyCount = Math.min(baseEnemyCount, Math.max(party.length + 1, 3));

  // Select templates from database
  const templates = await selectEnemiesForEncounter(nodeType, difficultyTier, enemyCount);

  // Create scaled enemy instances
  const enemies = templates.map((template, index) =>
    createEnemyInstance(template, partyLevel, difficultyTier, index)
  );

  // If we still don't have enough enemies (empty database), create generic ones
  while (enemies.length < enemyCount) {
    const index = enemies.length;
    enemies.push({
      id: `enemy_${index}`,
      type: 'enemy',
      templateId: null,
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
      tileX: 6 + (index % 2),
      tileY: index,
      hasActed: false,
      statusEffects: [],
      aiType: 'aggressive',
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
 * @param {number} nodeId - The world node ID
 * @param {number} partyLevel - Average party level
 * @returns {Promise<Object>} Preview info about the encounter
 */
async function getEncounterPreview(nodeId, partyLevel) {
  const nodeResult = await query(
    'SELECT node_type, difficulty_tier, name FROM world_nodes WHERE id = $1',
    [nodeId]
  );

  if (nodeResult.rows.length === 0) {
    throw new Error('Node not found');
  }

  const { node_type: nodeType, difficulty_tier: difficultyTier, name: nodeName } = nodeResult.rows[0];

  // Get possible enemies for this area
  const enemyResult = await query(
    `SELECT name, ai_type, min_difficulty_tier
     FROM enemy_templates
     WHERE $1 = ANY(spawn_node_types) AND min_difficulty_tier <= $2
     ORDER BY min_difficulty_tier DESC
     LIMIT 5`,
    [nodeType, difficultyTier]
  );

  const tierMult = TIER_MULTIPLIERS[difficultyTier] || 1.0;
  const estimatedEnemyLevel = Math.floor(partyLevel * tierMult);

  return {
    nodeName,
    nodeType,
    difficultyTier,
    estimatedEnemyLevel,
    possibleEnemies: enemyResult.rows.map(e => ({
      name: e.name,
      aiType: e.ai_type,
      tier: e.min_difficulty_tier
    })),
    enemyCount: Math.min(difficultyTier + 2, 5)
  };
}

module.exports = {
  selectEnemiesForEncounter,
  createEnemyInstance,
  generateEncounter,
  getEncounterPreview,
  TIER_MULTIPLIERS
};
