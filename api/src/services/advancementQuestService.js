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

/**
 * Get the guild ID for a given class
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
  const currentClass = character.class;
  const guildId = getGuildForClass(currentClass);

  if (!guildId) {
    return [];
  }

  // Check minimum level
  if (character.level < ADVANCEMENT_QUEST_MIN_LEVEL) {
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

  // Get available quest templates for this guild
  // T1 quests require base class, T2+ require previous tier
  const tiers = GUILD_ADVANCEMENT_TIERS[guildId];
  const currentTierIndex = tiers.indexOf(currentClass);

  // Determine what prerequisite class is needed for the next tier
  let prerequisiteClass = null;
  let nextTier = 1;

  if (BASE_CLASSES.includes(currentClass)) {
    // Base class can do T1 quest
    prerequisiteClass = null;
    nextTier = 1;
  } else if (currentTierIndex >= 0 && currentTierIndex < tiers.length - 1) {
    // Advanced class can do next tier quest
    prerequisiteClass = currentClass;
    nextTier = currentTierIndex + 2; // +2 because index 0 = tier 1
  } else {
    // Already at max tier or unknown class
    return [];
  }

  // Query for matching quest template
  const questResult = await query(
    `SELECT aqt.*, g.name as guildmaster_name
     FROM advancement_quest_templates aqt
     LEFT JOIN guildmaster_templates g ON g.guild_class = aqt.target_class
     WHERE aqt.guild_id = $1
     AND aqt.tier = $2
     AND (aqt.prerequisite_class = $3 OR (aqt.prerequisite_class IS NULL AND $3 IS NULL))`,
    [guildId, nextTier, prerequisiteClass]
  );

  return questResult.rows;
}

/**
 * Accept an advancement quest
 * @param {number} characterId - Character ID
 * @param {number} questTemplateId - Quest template ID
 * @returns {Object} Created quest record
 */
export async function acceptQuest(characterId, questTemplateId) {
  // Verify quest is available for this character
  const availableQuests = await getAvailableQuests(characterId);
  const questTemplate = availableQuests.find(q => q.id === questTemplateId);

  if (!questTemplate) {
    throw new Error('Quest not available for this character');
  }

  // Create the quest record
  const result = await query(
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
  const result = await query(
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

function calculateMaterialProgress(requirements, progress) {
  if (!requirements || requirements.length === 0) {
    return { items: [], complete: true, percentage: 100 };
  }

  const items = requirements.map(req => {
    const collected = progress?.[req.item_template_id] || 0;
    return {
      itemTemplateId: req.item_template_id,
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

function calculateEnemyProgress(requirements, progress) {
  if (!requirements || requirements.length === 0) {
    return { enemies: [], complete: true, percentage: 100 };
  }

  const enemies = requirements.map(req => {
    const killed = progress?.[req.enemy_archetype] || 0;
    return {
      enemyArchetype: req.enemy_archetype,
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

function calculateNodeProgress(requirements, progress) {
  if (!requirements || requirements.length === 0) {
    return { nodes: [], complete: true, percentage: 100 };
  }

  const nodes = requirements.map(req => {
    const visited = progress?.[req.node_type]?.length || 0;
    return {
      nodeType: req.node_type,
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
  const result = await query(
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
    await checkAndUpdateQuestStatus(characterId);
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
  const result = await query(
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
    await checkAndUpdateQuestStatus(characterId);
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
  // First check if this node is already recorded
  const checkResult = await query(
    `SELECT node_progress FROM character_quests
     WHERE character_id = $1 AND status = 'active'`,
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
  const result = await query(
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
    await checkAndUpdateQuestStatus(characterId);
    return true;
  }
  return false;
}

/**
 * Check if all objectives are complete and update quest status
 * @param {number} characterId - Character ID
 */
async function checkAndUpdateQuestStatus(characterId) {
  const progress = await getQuestProgress(characterId);

  if (!progress) {
    return;
  }

  if (progress.progress.allComplete && progress.status === 'active') {
    // Update status to boss_ready
    await query(
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
    bossConfig: progress.bossConfig,
    targetClass: progress.targetClass
  };
}

/**
 * Complete a quest after defeating the guildmaster boss
 * @param {number} characterId - Character ID
 * @param {number} battleId - The boss battle ID
 * @returns {Object} Completion result with new class info
 */
export async function completeQuest(characterId, battleId) {
  const progress = await getQuestProgress(characterId);

  if (!progress || progress.status !== 'boss_ready') {
    throw new Error('Quest not ready for completion');
  }

  // Get character info
  const charResult = await query(
    'SELECT id, name, race, level, user_id FROM characters WHERE id = $1',
    [characterId]
  );

  const character = charResult.rows[0];
  const newClass = progress.targetClass;

  // Calculate new stats with advanced class
  const newStats = calculateStats(character.race, newClass, character.level);

  return await withTransaction(async (client) => {
    // Update character class
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
           vitality = $7
       WHERE id = $8`,
      [
        newClass,
        newStats.hpMax,
        newStats.mpMax,
        newStats.strength,
        newStats.intelligence,
        newStats.agility,
        newStats.vitality,
        characterId
      ]
    );

    // Mark quest as completed
    await client.query(
      `UPDATE character_quests
       SET status = 'completed', completed_at = NOW()
       WHERE character_id = $1 AND status = 'boss_ready'`,
      [characterId]
    );

    // Award gold reward
    if (progress.rewards.gold > 0) {
      await client.query(
        'UPDATE users SET gold = LEAST(gold + $1, 2147483647) WHERE id = $2',
        [progress.rewards.gold, character.user_id]
      );
    }

    // Award XP reward
    if (progress.rewards.xp > 0) {
      await client.query(
        'UPDATE characters SET experience = experience + $1 WHERE id = $2',
        [progress.rewards.xp, characterId]
      );
    }

    // Award title if present
    if (progress.rewards.title) {
      await client.query(
        `INSERT INTO character_titles (character_id, title, is_active)
         VALUES ($1, $2, false)
         ON CONFLICT (character_id, title) DO NOTHING`,
        [characterId, progress.rewards.title]
      );
    }

    return {
      success: true,
      characterName: character.name,
      previousClass: character.class,
      newClass,
      tier: progress.tier,
      rewards: progress.rewards,
      newStats
    };
  });
}

/**
 * Abandon an active quest
 * @param {number} characterId - Character ID
 * @returns {boolean} True if quest was abandoned
 */
export async function abandonQuest(characterId) {
  const result = await query(
    `UPDATE character_quests
     SET status = 'abandoned', abandoned_at = NOW()
     WHERE character_id = $1 AND status IN ('active', 'boss_ready')
     RETURNING id`,
    [characterId]
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
  getAvailableQuests,
  acceptQuest,
  getQuestProgress,
  updateMaterialProgress,
  updateEnemyProgress,
  updateNodeProgress,
  canStartBossTrial,
  completeQuest,
  abandonQuest,
  getCompletedQuests
};
