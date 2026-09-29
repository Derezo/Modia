/**
 * Advancement Quest Service
 *
 * Handles guild advancement quest logic including:
 * - Quest availability and acceptance
 * - Progress tracking (materials, enemies, nodes)
 * - Boss trial eligibility
 * - Quest completion and class advancement
 */

import { query, withTransaction } from '../config/database.js';
import {
  GUILD_ADVANCEMENT_TIERS,
  ADVANCEMENT_QUEST_MIN_LEVEL,
  calculateStats
} from '../config/constants.js';

const BASE_CLASSES = ['warrior', 'wizard', 'monk', 'chemist'];

function requireQueryClient(client, operation) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError(`${operation} requires a pg client`);
  }
}

/**
 * Get the guild ID for a given class
 */
export function getGuildForClass(className) {
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

export function getAdvancementNodeIdError(nodeId) {
  if (nodeId === undefined || nodeId === null) {
    return 'nodeId is required';
  }
  if (!Number.isSafeInteger(nodeId) || nodeId < 1) {
    return 'Valid nodeId is required';
  }
  return null;
}

/**
 * Validate that a character is at the requested node and that the node is the
 * guild responsible for the character's active advancement path.
 *
 * @returns {string|null} A client-safe validation message, or null when valid.
 */
export function getAdvancementGuildLocationError(
  character,
  node,
  nodeId,
  questGuildId
) {
  const nodeIdError = getAdvancementNodeIdError(nodeId);
  if (nodeIdError) return nodeIdError;
  if (character?.current_node_id !== nodeId) {
    return 'Character is not at the selected guild node';
  }
  if (!node || node.id !== nodeId) {
    return 'Selected guild node not found';
  }
  if (node.node_type !== 'guild') {
    return 'Selected node is not a guild';
  }

  const characterGuildId = getGuildForClass(character?.class);
  if (!characterGuildId) {
    return 'Character class does not belong to an advancement guild';
  }
  if (characterGuildId !== questGuildId) {
    return 'Advancement quest does not match the character guild';
  }
  if (node.guild_class !== questGuildId) {
    return 'Selected guild does not match the advancement quest guild';
  }

  return null;
}

/**
 * Resolve the one advancement template a locked character may currently use.
 */
export function getNextAdvancementStep(character) {
  const currentClass = character?.class;
  const guildId = getGuildForClass(currentClass);
  const level = Number(character?.level);
  if (
    !guildId
    || !Number.isFinite(level)
    || level < ADVANCEMENT_QUEST_MIN_LEVEL
  ) {
    return null;
  }

  const tiers = GUILD_ADVANCEMENT_TIERS[guildId];
  if (BASE_CLASSES.includes(currentClass)) {
    return {
      guildId,
      tier: 1,
      prerequisiteClass: null,
      targetClass: tiers[0]
    };
  }

  const currentTierIndex = tiers.indexOf(currentClass);
  if (currentTierIndex < 0 || currentTierIndex >= tiers.length - 1) {
    return null;
  }

  return {
    guildId,
    tier: currentTierIndex + 2,
    prerequisiteClass: currentClass,
    targetClass: tiers[currentTierIndex + 1]
  };
}

/**
 * Get all available advancement quests for a character
 * @param {number} characterId - Character ID
 * @returns {Object[]} Available quest templates
 */
export async function getAvailableQuests(characterId) {
  // Get character info
  const charResult = await query(
    'SELECT id, class, level, user_id FROM characters WHERE id = $1',
    [characterId]
  );

  if (charResult.rows.length === 0) {
    throw new Error('Character not found');
  }

  const character = charResult.rows[0];
  const advancementStep = getNextAdvancementStep(character);
  if (!advancementStep) {
    return [];
  }

  // Check if character has an active quest
  const activeQuestResult = await query(
    `SELECT id FROM character_quests
     WHERE character_id = $1 AND status IN ('active', 'boss_ready')`,
    [characterId]
  );

  if (activeQuestResult.rows.length > 0) {
    return []; // Already has active quest
  }

  // Query for matching quest template
  const questResult = await query(
    `SELECT aqt.*, g.name as guildmaster_name
     FROM advancement_quest_templates aqt
     LEFT JOIN guildmaster_templates g
       ON g.guild_class = aqt.boss_config->>'guildmaster_class'
     WHERE aqt.guild_id = $1
     AND aqt.tier = $2
     AND aqt.prerequisite_class IS NOT DISTINCT FROM $3
     AND aqt.target_class = $4`,
    [
      advancementStep.guildId,
      advancementStep.tier,
      advancementStep.prerequisiteClass,
      advancementStep.targetClass
    ]
  );

  return questResult.rows;
}

/**
 * Accept an advancement quest
 * @param {number} characterId - Character ID
 * @param {number} questTemplateId - Quest template ID
 * @param {number} nodeId - Selected guild node ID
 * @returns {Object} Created quest record
 */
export async function acceptQuest(characterId, questTemplateId, nodeId) {
  return withTransaction(client =>
    acceptQuestWithClient(client, characterId, questTemplateId, nodeId)
  );
}

/**
 * Accept a quest using only state read after the character row is locked.
 * This prevents a stale quest-board response from being accepted after a
 * concurrent class or level change.
 */
export async function acceptQuestWithClient(
  client,
  characterId,
  questTemplateId,
  nodeId
) {
  requireQueryClient(client, 'acceptQuestWithClient');
  if (!Number.isSafeInteger(nodeId) || nodeId < 1) {
    throw new Error('Valid nodeId is required');
  }
  if (!Number.isSafeInteger(questTemplateId) || questTemplateId < 1) {
    throw new Error('Valid questTemplateId is required');
  }

  // Lock first, then derive eligibility exclusively from the locked row.
  const lockResult = await client.query(
    `SELECT id, class, level, current_node_id
     FROM characters
     WHERE id = $1
     FOR UPDATE`,
    [characterId]
  );

  if (lockResult.rows.length === 0) {
    throw new Error('Character not found');
  }

  const character = lockResult.rows[0];
  const advancementStep = getNextAdvancementStep(character);
  if (!advancementStep) {
    throw new Error('Quest not available for this character');
  }

  const activeCheck = await client.query(
    `SELECT id FROM character_quests
     WHERE character_id = $1 AND status IN ('active', 'boss_ready')
     FOR UPDATE`,
    [characterId]
  );
  if (activeCheck.rows.length > 0) {
    throw new Error('Character already has an active quest');
  }

  const templateResult = await client.query(
    `SELECT *
     FROM advancement_quest_templates
     WHERE id = $1
       AND guild_id = $2
       AND tier = $3
       AND prerequisite_class IS NOT DISTINCT FROM $4
       AND target_class = $5`,
    [
      questTemplateId,
      advancementStep.guildId,
      advancementStep.tier,
      advancementStep.prerequisiteClass,
      advancementStep.targetClass
    ]
  );
  if (templateResult.rows.length === 0) {
    throw new Error('Quest not available for this character');
  }
  const questTemplate = templateResult.rows[0];

  const nodeResult = await client.query(
    `SELECT id, node_type, guild_class
     FROM world_nodes
     WHERE id = $1`,
    [nodeId]
  );
  const locationError = getAdvancementGuildLocationError(
    character,
    nodeResult.rows[0],
    nodeId,
    advancementStep.guildId
  );
  if (locationError) {
    throw new Error(locationError);
  }

  const result = await client.query(
    `INSERT INTO character_quests (character_id, quest_template_id, status)
     VALUES ($1, $2, 'active')
     RETURNING *`,
    [characterId, questTemplateId]
  );

  return {
    quest: result.rows[0],
    template: questTemplate
  };
}

/**
 * Get current quest progress for a character
 * @param {number} characterId - Character ID
 * @returns {Object|null} Quest progress or null if no active quest
 */
export async function getQuestProgress(characterId) {
  return getQuestProgressWithClient({ query }, characterId);
}

export async function getQuestProgressWithClient(client, characterId) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('getQuestProgressWithClient requires a pg client');
  }
  const result = await client.query(
    `SELECT cq.*, aqt.quest_name, aqt.quest_description,
            aqt.material_requirements, aqt.enemy_requirements, aqt.node_requirements,
            aqt.target_class, aqt.guild_id, aqt.tier, aqt.gold_reward, aqt.xp_reward,
            aqt.title_reward, aqt.boss_config
     FROM character_quests cq
     JOIN advancement_quest_templates aqt ON aqt.id = cq.quest_template_id
     WHERE cq.character_id = $1 AND cq.status IN ('active', 'boss_ready')`,
    [characterId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const quest = result.rows[0];

  // Calculate progress percentages
  const materialProgress = calculateMaterialProgress(
    quest.material_requirements,
    quest.material_progress
  );
  const enemyProgress = calculateEnemyProgress(
    quest.enemy_requirements,
    quest.enemy_progress
  );
  const nodeProgress = calculateNodeProgress(
    quest.node_requirements,
    quest.node_progress
  );

  const allObjectivesComplete =
    materialProgress.complete &&
    enemyProgress.complete &&
    nodeProgress.complete;

  return {
    questId: quest.id,
    templateId: quest.quest_template_id,
    questName: quest.quest_name,
    questDescription: quest.quest_description,
    targetClass: quest.target_class,
    guildId: quest.guild_id,
    tier: quest.tier,
    status: quest.status,
    startedAt: quest.started_at,
    bossUnlockedAt: quest.boss_unlocked_at,
    rewards: {
      gold: quest.gold_reward,
      xp: quest.xp_reward,
      title: quest.title_reward
    },
    bossConfig: quest.boss_config,
    progress: {
      materials: materialProgress,
      enemies: enemyProgress,
      nodes: nodeProgress,
      allComplete: allObjectivesComplete
    }
  };
}

export function calculateMaterialProgress(requirements, progress) {
  if (!requirements || requirements.length === 0) {
    return { items: [], complete: true, percentage: 100 };
  }

  const items = requirements.map(req => {
    const collected = progress?.[req.item_template_id] || 0;
    return {
      itemTemplateId: req.item_template_id,
      name: req.name ?? `Item ${req.item_template_id}`,
      rarity: req.rarity ?? null,
      required: req.quantity,
      collected,
      complete: collected >= req.quantity
    };
  });

  const complete = items.every(i => i.complete);
  const percentage = items.length > 0
    ? Math.floor(items.reduce((sum, i) => sum + Math.min(i.collected / i.required, 1), 0) / items.length * 100)
    : 100;

  return { items, complete, percentage };
}

export function calculateEnemyProgress(requirements, progress) {
  if (!requirements || requirements.length === 0) {
    return { enemies: [], complete: true, percentage: 100 };
  }

  const enemies = requirements.map(req => {
    const killed = progress?.[req.enemy_archetype] || 0;
    return {
      enemyArchetype: req.enemy_archetype,
      name: req.name ?? req.enemy_archetype,
      zoneTier: req.zone_tier ?? null,
      required: req.count,
      killed,
      complete: killed >= req.count
    };
  });

  const complete = enemies.every(e => e.complete);
  const percentage = enemies.length > 0
    ? Math.floor(enemies.reduce((sum, e) => sum + Math.min(e.killed / e.required, 1), 0) / enemies.length * 100)
    : 100;

  return { enemies, complete, percentage };
}

export function calculateNodeProgress(requirements, progress) {
  if (!requirements || requirements.length === 0) {
    return { nodes: [], complete: true, percentage: 100 };
  }

  const nodes = requirements.map(req => {
    const visited = progress?.[req.node_type]?.length || 0;
    return {
      nodeType: req.node_type,
      name: req.name ?? req.node_type,
      minTier: req.min_tier ?? null,
      required: req.count,
      visited,
      complete: visited >= req.count
    };
  });

  const complete = nodes.every(n => n.complete);
  const percentage = nodes.length > 0
    ? Math.floor(nodes.reduce((sum, n) => sum + Math.min(n.visited / n.required, 1), 0) / nodes.length * 100)
    : 100;

  return { nodes, complete, percentage };
}

/**
 * Update material progress for a character's active quest
 * @param {number} characterId - Character ID
 * @param {number} itemTemplateId - Item template ID collected
 * @param {number} quantity - Quantity collected (default 1)
 * @returns {boolean} True if progress was updated
 */
export async function updateMaterialProgress(characterId, itemTemplateId, quantity = 1) {
  return updateMaterialProgressWithClient(
    { query },
    characterId,
    itemTemplateId,
    quantity
  );
}

export async function updateMaterialProgressWithClient(
  client,
  characterId,
  itemTemplateId,
  quantity = 1
) {
  requireQueryClient(client, 'updateMaterialProgressWithClient');
  const result = await client.query(
    `UPDATE character_quests
     SET material_progress = jsonb_set(
       COALESCE(material_progress, '{}'),
       $2::text[],
       (COALESCE((material_progress->>$3)::int, 0) + $4)::text::jsonb
     )
     WHERE character_id = $1 AND status = 'active'
     RETURNING id`,
    [characterId, [String(itemTemplateId)], String(itemTemplateId), quantity]
  );

  if (result.rows.length > 0) {
    await checkAndUpdateQuestStatus(client, characterId);
    return true;
  }
  return false;
}

/**
 * Update enemy kill progress for a character's active quest
 * @param {number} characterId - Character ID
 * @param {string} enemyArchetype - Enemy archetype killed
 * @param {number} count - Kill count (default 1)
 * @returns {boolean} True if progress was updated
 */
export async function updateEnemyProgress(characterId, enemyArchetype, count = 1) {
  return updateEnemyProgressWithClient(
    { query },
    characterId,
    enemyArchetype,
    count
  );
}

export async function updateEnemyProgressWithClient(
  client,
  characterId,
  enemyArchetype,
  count = 1
) {
  requireQueryClient(client, 'updateEnemyProgressWithClient');
  const result = await client.query(
    `UPDATE character_quests
     SET enemy_progress = jsonb_set(
       COALESCE(enemy_progress, '{}'),
       $2::text[],
       (COALESCE((enemy_progress->>$3)::int, 0) + $4)::text::jsonb
     )
     WHERE character_id = $1 AND status = 'active'
     RETURNING id`,
    [characterId, [enemyArchetype], enemyArchetype, count]
  );

  if (result.rows.length > 0) {
    await checkAndUpdateQuestStatus(client, characterId);
    return true;
  }
  return false;
}

/**
 * Update node visit progress for a character's active quest
 * @param {number} characterId - Character ID
 * @param {number} nodeId - Node ID visited
 * @param {string} nodeType - Type of node visited
 * @returns {boolean} True if progress was updated
 */
export async function updateNodeProgress(characterId, nodeId, nodeType) {
  return updateNodeProgressWithClient({ query }, characterId, nodeId, nodeType);
}

export async function updateNodeProgressWithClient(
  client,
  characterId,
  nodeId,
  nodeType
) {
  requireQueryClient(client, 'updateNodeProgressWithClient');
  // First check if this node is already recorded
  const checkResult = await client.query(
    `SELECT node_progress FROM character_quests
     WHERE character_id = $1 AND status = 'active'
     FOR UPDATE`,
    [characterId]
  );

  if (checkResult.rows.length === 0) {
    return false;
  }

  const currentProgress = checkResult.rows[0].node_progress || {};
  const nodeList = currentProgress[nodeType] || [];

  // Don't add duplicate nodes
  if (nodeList.includes(nodeId)) {
    return false;
  }

  // Add this node to the list
  const result = await client.query(
    `UPDATE character_quests
     SET node_progress = jsonb_set(
       COALESCE(node_progress, '{}'),
       $2::text[],
       (COALESCE(node_progress->$3, '[]'::jsonb) || $4::jsonb)
     )
     WHERE character_id = $1 AND status = 'active'
     RETURNING id`,
    [characterId, [nodeType], nodeType, JSON.stringify([nodeId])]
  );

  if (result.rows.length > 0) {
    await checkAndUpdateQuestStatus(client, characterId);
    return true;
  }
  return false;
}

/**
 * Check if all objectives are complete and update quest status
 * @param {number} characterId - Character ID
 */
async function checkAndUpdateQuestStatus(client, characterId) {
  const progress = await getQuestProgressWithClient(client, characterId);

  if (!progress) {
    return;
  }

  if (progress.progress.allComplete && progress.status === 'active') {
    // Update status to boss_ready
    await client.query(
      `UPDATE character_quests
       SET status = 'boss_ready', boss_unlocked_at = NOW()
       WHERE character_id = $1 AND status = 'active'`,
      [characterId]
    );
  }
}

/**
 * Check if character can start the boss trial
 * @param {number} characterId - Character ID
 * @returns {Object} Eligibility info
 */
export async function canStartBossTrial(characterId) {
  const progress = await getQuestProgress(characterId);

  if (!progress) {
    return { eligible: false, reason: 'No active quest' };
  }

  if (progress.status !== 'boss_ready') {
    return {
      eligible: false,
      reason: 'Quest objectives not complete',
      progress: progress.progress
    };
  }

  // Check if character is in battle
  const battleCheck = await query(
    'SELECT in_battle FROM characters WHERE id = $1',
    [characterId]
  );

  if (battleCheck.rows[0]?.in_battle) {
    return { eligible: false, reason: 'Character is in battle' };
  }

  return {
    eligible: true,
    reason: 'Ready to challenge the guildmaster',
    questId: progress.questId,
    bossConfig: progress.bossConfig,
    targetClass: progress.targetClass,
    guildId: progress.guildId
  };
}

/**
 * Complete a quest after defeating the guildmaster boss
 * @param {number} characterId - Character ID
 * @param {number} battleId - The boss battle ID
 * @returns {Object} Completion result with new class info
 */
export async function completeQuest(characterId, battleId) {
  return withTransaction(client =>
    completeQuestWithClient(client, characterId, battleId)
  );
}

/**
 * Complete or reconstruct an advancement completion within a caller-owned
 * transaction. The quest and character locks serialize concurrent deliveries.
 */
export async function completeQuestWithClient(client, characterId, battleId) {
  requireQueryClient(client, 'completeQuestWithClient');
  if (!Number.isSafeInteger(battleId) || battleId < 1) {
    throw new TypeError('battleId must be a positive safe integer');
  }
  const result = await client.query(
    `SELECT cq.id AS quest_id, cq.status,
            aqt.target_class, aqt.prerequisite_class, aqt.guild_id, aqt.tier,
            aqt.gold_reward, aqt.xp_reward, aqt.title_reward,
            c.name, c.class, c.race, c.level, c.user_id
     FROM character_quests cq
     JOIN advancement_quest_templates aqt ON aqt.id = cq.quest_template_id
     JOIN characters c ON c.id = cq.character_id
     WHERE cq.character_id = $1
       AND (
         (
           cq.status = 'boss_ready'
           AND EXISTS (
             SELECT 1
             FROM battles b
             WHERE b.id = $2
               AND b.is_advancement_battle = TRUE
               AND b.challenger_character_id = cq.character_id
               AND b.target_class = aqt.target_class
               AND b.status = 'victory'
           )
         )
         OR
         (
           cq.status = 'completed'
           AND cq.completion_battle_id = $2
         )
       )
     FOR UPDATE OF cq, c`,
    [characterId, battleId]
  );

  if (result.rows.length === 0) {
    throw new Error('Quest not ready for completion');
  }

  const row = result.rows[0];
  const newClass = row.target_class;
  const previousClass = row.prerequisite_class || row.guild_id;
  const rewards = {
    gold: row.gold_reward,
    xp: row.xp_reward,
    title: row.title_reward
  };
  const newStats = calculateStats(row.race, newClass, row.level);
  const outcome = {
    success: true,
    characterName: row.name,
    previousClass,
    newClass,
    tier: row.tier,
    rewards,
    newStats
  };

  if (row.status === 'completed') {
    return outcome;
  }

  await client.query(
    `UPDATE characters
     SET class = $1,
         hp_max = $2,
         hp_current = LEAST(hp_current, $2),
         mp_max = $3,
         mp_current = LEAST(mp_current, $3),
         strength = $4,
         intelligence = $5,
         agility = $6,
         vitality = $7,
         luck = $8
     WHERE id = $9`,
    [
      newClass,
      newStats.hpMax,
      newStats.mpMax,
      newStats.strength,
      newStats.intelligence,
      newStats.agility,
      newStats.vitality,
      newStats.luck,
      characterId
    ]
  );

  await client.query(
    `UPDATE character_quests
     SET status = 'completed',
         completed_at = NOW(),
         completion_battle_id = $2
     WHERE id = $1 AND status = 'boss_ready'`,
    [row.quest_id, battleId]
  );

  if (rewards.gold > 0) {
    await client.query(
      'UPDATE users SET gold = LEAST(gold + $1, 2147483647) WHERE id = $2',
      [rewards.gold, row.user_id]
    );
  }

  if (rewards.xp > 0) {
    await client.query(
      'UPDATE characters SET experience = experience + $1 WHERE id = $2',
      [rewards.xp, characterId]
    );
  }

  if (rewards.title) {
    await client.query(
      `INSERT INTO character_titles (character_id, title, is_active)
       VALUES ($1, $2, false)
       ON CONFLICT (character_id, title) DO NOTHING`,
      [characterId, rewards.title]
    );
  }

  return outcome;
}

/**
 * Abandon an active quest
 * @param {number} characterId - Character ID
 * @returns {boolean} True if quest was abandoned
 */
export async function abandonQuest(characterId) {
  return withTransaction(client => abandonQuestWithClient(client, characterId));
}

/**
 * Serialize abandonment with boss-trial creation on the character lock.
 */
export async function abandonQuestWithClient(client, characterId) {
  requireQueryClient(client, 'abandonQuestWithClient');
  const characterResult = await client.query(
    `SELECT id, in_battle
     FROM characters
     WHERE id = $1
     FOR UPDATE`,
    [characterId]
  );
  if (characterResult.rows.length === 0) return false;
  if (characterResult.rows[0].in_battle) {
    const error = new Error(
      'Cannot abandon an advancement quest during its boss trial'
    );
    error.code = 'ADVANCEMENT_QUEST_BATTLE_ACTIVE';
    throw error;
  }

  const questResult = await client.query(
    `SELECT id
     FROM character_quests
     WHERE character_id = $1
       AND status IN ('active', 'boss_ready')
     FOR UPDATE`,
    [characterId]
  );
  if (questResult.rows.length === 0) return false;

  const result = await client.query(
    `UPDATE character_quests
     SET status = 'abandoned', abandoned_at = NOW()
     WHERE id = $1
       AND status IN ('active', 'boss_ready')
     RETURNING id`,
    [questResult.rows[0].id]
  );

  return result.rows.length > 0;
}

/**
 * Get completed quests for a character (for history/achievements)
 * @param {number} characterId - Character ID
 * @returns {Object[]} Completed quest records
 */
export async function getCompletedQuests(characterId) {
  const result = await query(
    `SELECT cq.*, aqt.quest_name, aqt.target_class, aqt.tier
     FROM character_quests cq
     JOIN advancement_quest_templates aqt ON aqt.id = cq.quest_template_id
     WHERE cq.character_id = $1 AND cq.status = 'completed'
     ORDER BY cq.completed_at DESC`,
    [characterId]
  );

  return result.rows;
}

export default {
  getGuildForClass,
  getAdvancementNodeIdError,
  getAdvancementGuildLocationError,
  getNextAdvancementStep,
  getAvailableQuests,
  acceptQuest,
  acceptQuestWithClient,
  getQuestProgress,
  calculateMaterialProgress,
  calculateEnemyProgress,
  calculateNodeProgress,
  updateMaterialProgress,
  updateMaterialProgressWithClient,
  updateEnemyProgress,
  updateEnemyProgressWithClient,
  updateNodeProgress,
  updateNodeProgressWithClient,
  canStartBossTrial,
  completeQuest,
  completeQuestWithClient,
  abandonQuest,
  abandonQuestWithClient,
  getCompletedQuests
};
