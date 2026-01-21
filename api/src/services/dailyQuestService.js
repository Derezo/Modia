/**
 * Daily Quest Service - Handle daily/weekly quest assignment, progress, and rewards
 *
 * Core functions:
 * - Auto-assign quests on login if needed
 * - Track progress across 10 objective types
 * - Handle streak bonuses (+10%/day, cap at +100%)
 * - First Blood, Completion Bonus, Perfect Week mechanics
 */

import { query, withTransaction } from '../config/database.js';
import { MAX_GOLD, MAX_XP } from '../config/constants.js';

// Constants
const DAILY_QUEST_COUNT = 3;
const WEEKLY_QUEST_COUNT = 2;
const STREAK_BONUS_PER_DAY = 0.10; // 10% per day
const MAX_STREAK_BONUS = 1.0; // Cap at +100%
const FIRST_BLOOD_BONUS = 0.50; // 50% bonus
const COMPLETION_BONUS_MULTIPLIER = 0.25; // 25% of total daily quest rewards

// ============================================
// QUEST ASSIGNMENT
// ============================================

/**
 * Check and refresh quests for a character on login
 * @param {number} characterId - Character ID
 * @returns {Object} Refresh result with new quests if any
 */
export async function refreshQuestsIfNeeded(characterId) {
  const result = {
    dailyRefreshed: false,
    weeklyRefreshed: false,
    dailyQuests: [],
    weeklyQuests: []
  };

  // Get character level for quest selection
  const charResult = await query(
    'SELECT level, user_id FROM characters WHERE id = $1',
    [characterId]
  );

  if (charResult.rows.length === 0) {
    throw new Error('Character not found');
  }

  const { level, user_id: userId } = charResult.rows[0];

  // Check if daily refresh needed
  const needsDaily = await query(
    'SELECT needs_daily_quest_refresh($1) as needs_refresh',
    [characterId]
  );

  if (needsDaily.rows[0].needs_refresh) {
    result.dailyQuests = await assignQuests(characterId, userId, level, 'daily');
    result.dailyRefreshed = true;
  }

  // Check if weekly refresh needed
  const needsWeekly = await query(
    'SELECT needs_weekly_quest_refresh($1) as needs_refresh',
    [characterId]
  );

  if (needsWeekly.rows[0].needs_refresh) {
    result.weeklyQuests = await assignQuests(characterId, userId, level, 'weekly');
    result.weeklyRefreshed = true;
  }

  // Update streak
  if (result.dailyRefreshed) {
    await updateStreak(characterId);
  }

  return result;
}

/**
 * Assign new quests for a period
 * @param {number} characterId - Character ID
 * @param {number} userId - User ID
 * @param {number} level - Character level
 * @param {string} period - 'daily' or 'weekly'
 * @returns {Array} Assigned quests
 */
async function assignQuests(characterId, userId, level, period) {
  const count = period === 'daily' ? DAILY_QUEST_COUNT : WEEKLY_QUEST_COUNT;

  // Check if character has elite quest access (via Perfect Week)
  const eliteAccessResult = await query(
    'SELECT has_elite_quest_access($1) as has_access',
    [characterId]
  );
  const hasEliteAccess = eliteAccessResult.rows[0]?.has_access || false;

  // Get eligible quest templates (level appropriate, active, weighted random)
  // Gate elite quests based on Perfect Week achievement
  const templatesResult = await query(
    `SELECT id, quest_key, quest_name, quest_description, objective_type,
            objective_requirements, target_count, rewards, difficulty, selection_weight
     FROM daily_quest_templates
     WHERE period = $1
       AND is_active = TRUE
       AND min_level <= $2
       AND max_level >= $2
       AND (difficulty != 'elite' OR $3 = TRUE)
     ORDER BY RANDOM() * selection_weight DESC
     LIMIT $4`,
    [period, level, hasEliteAccess, count * 2] // Get extra for variety
  );

  if (templatesResult.rows.length === 0) {
    console.warn(`[Quest] No eligible templates found for level ${level}, period ${period}`);
    return [];
  }

  // Select distinct templates (avoid duplicates)
  const selectedTemplates = [];
  const usedIds = new Set();

  for (const template of templatesResult.rows) {
    if (!usedIds.has(template.id) && selectedTemplates.length < count) {
      selectedTemplates.push(template);
      usedIds.add(template.id);
    }
  }

  // Get period boundaries
  const periodResult = await query(
    `SELECT
      ${period === 'daily' ? 'get_daily_period_start()' : 'get_weekly_period_start()'} as period_start,
      get_period_end($1::quest_period, ${period === 'daily' ? 'get_daily_period_start()' : 'get_weekly_period_start()'}) as period_end`,
    [period]
  );

  const { period_start, period_end } = periodResult.rows[0];

  // Insert assigned quests
  const assignedQuests = [];

  for (const template of selectedTemplates) {
    const insertResult = await query(
      `INSERT INTO character_daily_quests
       (character_id, quest_template_id, period, target_progress, period_start, period_end)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (character_id, quest_template_id, period_start) DO NOTHING
       RETURNING id`,
      [characterId, template.id, period, template.target_count, period_start, period_end]
    );

    if (insertResult.rows.length > 0) {
      assignedQuests.push({
        id: insertResult.rows[0].id,
        templateId: template.id,
        questKey: template.quest_key,
        questName: template.quest_name,
        description: template.quest_description,
        objectiveType: template.objective_type,
        objectiveRequirements: template.objective_requirements,
        targetProgress: template.target_count,
        currentProgress: 0,
        rewards: template.rewards,
        difficulty: template.difficulty,
        period,
        periodStart: period_start,
        periodEnd: period_end,
        isCompleted: false,
        rewardsClaimed: false
      });
    }
  }

  // Update last reset timestamp
  await query(
    `INSERT INTO character_login_streaks (character_id, last_login_date, ${period === 'daily' ? 'last_daily_reset' : 'last_weekly_reset'})
     VALUES ($1, CURRENT_DATE, NOW())
     ON CONFLICT (character_id) DO UPDATE SET
       ${period === 'daily' ? 'last_daily_reset' : 'last_weekly_reset'} = NOW(),
       last_login_date = CURRENT_DATE`,
    [characterId]
  );

  return assignedQuests;
}

// ============================================
// QUEST RETRIEVAL
// ============================================

/**
 * Get daily quests for a character
 * @param {number} characterId - Character ID
 * @returns {Object} Daily quests with streak info
 */
export async function getDailyQuests(characterId) {
  const result = await query(
    `SELECT cdq.id, cdq.quest_template_id, cdq.current_progress, cdq.target_progress,
            cdq.is_completed, cdq.rewards_claimed, cdq.period_start, cdq.period_end,
            cdq.completed_at, cdq.claimed_at,
            dqt.quest_key, dqt.quest_name, dqt.quest_description, dqt.objective_type,
            dqt.objective_requirements, dqt.rewards, dqt.difficulty
     FROM character_daily_quests cdq
     JOIN daily_quest_templates dqt ON dqt.id = cdq.quest_template_id
     WHERE cdq.character_id = $1
       AND cdq.period = 'daily'
       AND cdq.period_end > NOW()
     ORDER BY cdq.is_completed DESC, dqt.difficulty`,
    [characterId]
  );

  const streak = await getStreakInfo(characterId);

  return {
    quests: result.rows.map(formatQuest),
    streak,
    periodEnd: result.rows[0]?.period_end || null
  };
}

/**
 * Get weekly quests for a character
 * @param {number} characterId - Character ID
 * @returns {Object} Weekly quests
 */
export async function getWeeklyQuests(characterId) {
  const result = await query(
    `SELECT cdq.id, cdq.quest_template_id, cdq.current_progress, cdq.target_progress,
            cdq.is_completed, cdq.rewards_claimed, cdq.period_start, cdq.period_end,
            cdq.completed_at, cdq.claimed_at,
            dqt.quest_key, dqt.quest_name, dqt.quest_description, dqt.objective_type,
            dqt.objective_requirements, dqt.rewards, dqt.difficulty
     FROM character_daily_quests cdq
     JOIN daily_quest_templates dqt ON dqt.id = cdq.quest_template_id
     WHERE cdq.character_id = $1
       AND cdq.period = 'weekly'
       AND cdq.period_end > NOW()
     ORDER BY cdq.is_completed DESC, dqt.difficulty`,
    [characterId]
  );

  return {
    quests: result.rows.map(formatQuest),
    periodEnd: result.rows[0]?.period_end || null
  };
}

/**
 * Format a quest row for API response
 */
function formatQuest(row) {
  return {
    id: row.id,
    templateId: row.quest_template_id,
    questKey: row.quest_key,
    questName: row.quest_name,
    description: row.quest_description,
    objectiveType: row.objective_type,
    objectiveRequirements: row.objective_requirements,
    currentProgress: row.current_progress,
    targetProgress: row.target_progress,
    rewards: row.rewards,
    difficulty: row.difficulty,
    isCompleted: row.is_completed,
    rewardsClaimed: row.rewards_claimed,
    completedAt: row.completed_at,
    claimedAt: row.claimed_at,
    periodStart: row.period_start,
    periodEnd: row.period_end
  };
}

// ============================================
// PROGRESS TRACKING
// ============================================

/**
 * Update progress for matching quests (called from hooks)
 * @param {number} characterId - Character ID
 * @param {string} objectiveType - Type of objective (kill_enemies, visit_nodes, etc.)
 * @param {number} amount - Amount to increment (default 1)
 * @param {Object} metadata - Additional filter data (enemy_types, node_types, region, etc.)
 */
export async function updateProgress(characterId, objectiveType, amount = 1, metadata = {}) {
  // Get active quests matching the objective type
  const questsResult = await query(
    `SELECT cdq.id, cdq.current_progress, cdq.target_progress, cdq.is_completed,
            cdq.quest_template_id, cdq.period, cdq.period_start,
            dqt.objective_requirements
     FROM character_daily_quests cdq
     JOIN daily_quest_templates dqt ON dqt.id = cdq.quest_template_id
     WHERE cdq.character_id = $1
       AND dqt.objective_type = $2
       AND cdq.is_completed = FALSE
       AND cdq.period_end > NOW()`,
    [characterId, objectiveType]
  );

  for (const quest of questsResult.rows) {
    // Check if metadata matches requirements
    if (!matchesRequirements(quest.objective_requirements, metadata)) {
      continue;
    }

    const newProgress = Math.min(quest.current_progress + amount, quest.target_progress);
    const completed = newProgress >= quest.target_progress;

    // Update progress
    await query(
      `UPDATE character_daily_quests
       SET current_progress = $1,
           is_completed = $2,
           completed_at = CASE WHEN $2 AND completed_at IS NULL THEN NOW() ELSE completed_at END
       WHERE id = $3`,
      [newProgress, completed, quest.id]
    );

    // If completed, try to claim First Blood and send notification
    if (completed && !quest.is_completed) {
      const firstBlood = await tryClaimFirstBlood(quest.quest_template_id, characterId, quest.period, quest.period_start);

      // Check for Completion Bonus (all daily quests done)
      if (quest.period === 'daily') {
        await checkCompletionBonus(characterId);
      }

      // Send WebSocket notification (fire-and-forget)
      sendQuestCompletedNotification(characterId, quest.id, firstBlood)
        .catch(err => console.warn('[Quest] WS notification failed:', err.message));
    }
  }
}

/**
 * Send WebSocket notification when a quest is completed
 */
async function sendQuestCompletedNotification(characterId, questId, firstBlood) {
  // Get user ID from character
  const charResult = await query(
    'SELECT user_id FROM characters WHERE id = $1',
    [characterId]
  );

  if (charResult.rows.length === 0) return;
  const userId = charResult.rows[0].user_id;

  // Dynamic import to avoid circular dependency
  const { sendToUser } = await import('../websocket/index.js');

  sendToUser(userId, {
    type: 'quest:completed',
    payload: {
      questId,
      characterId,
      firstBlood,
      timestamp: Date.now()
    }
  });
}

/**
 * Check if metadata matches quest requirements
 */
function matchesRequirements(requirements, metadata) {
  if (!requirements || Object.keys(requirements).length === 0) {
    return true; // No specific requirements
  }

  // Check enemy_types
  if (requirements.enemy_types && requirements.enemy_types.length > 0) {
    if (requirements.enemy_types[0] !== 'any' && metadata.enemyType) {
      if (!requirements.enemy_types.includes(metadata.enemyType)) {
        return false;
      }
    }
  }

  // Check node_types
  if (requirements.node_types && requirements.node_types.length > 0) {
    if (metadata.nodeType && !requirements.node_types.includes(metadata.nodeType)) {
      return false;
    }
  }

  // Check region
  if (requirements.region && metadata.region) {
    if (requirements.region !== metadata.region) {
      return false;
    }
  }

  // Check is_big_one for fishing
  if (requirements.is_big_one && !metadata.isBigOne) {
    return false;
  }

  // Check min_tier
  if (requirements.min_tier && metadata.tier) {
    if (metadata.tier < requirements.min_tier) {
      return false;
    }
  }

  return true;
}

// ============================================
// REWARD CLAIMING
// ============================================

/**
 * Claim reward for a single quest
 * @param {number} questId - Quest assignment ID
 * @param {number} characterId - Character ID
 * @returns {Object} Claimed rewards
 */
export async function claimReward(questId, characterId) {
  return withTransaction(async (client) => {
    // Get quest with lock
    const questResult = await client.query(
      `SELECT cdq.id, cdq.is_completed, cdq.rewards_claimed, cdq.quest_template_id,
              cdq.period, cdq.period_start, cdq.character_id,
              dqt.rewards, dqt.difficulty,
              c.user_id
       FROM character_daily_quests cdq
       JOIN daily_quest_templates dqt ON dqt.id = cdq.quest_template_id
       JOIN characters c ON c.id = cdq.character_id
       WHERE cdq.id = $1 AND cdq.character_id = $2
       FOR UPDATE OF cdq`,
      [questId, characterId]
    );

    if (questResult.rows.length === 0) {
      throw new Error('Quest not found');
    }

    const quest = questResult.rows[0];

    if (!quest.is_completed) {
      throw new Error('Quest not completed');
    }

    if (quest.rewards_claimed) {
      throw new Error('Rewards already claimed');
    }

    const baseRewards = quest.rewards;
    const streak = await getStreakInfo(characterId);
    const streakMultiplier = 1 + Math.min(streak.currentStreak * STREAK_BONUS_PER_DAY, MAX_STREAK_BONUS);

    // Check for First Blood bonus
    const firstBloodResult = await client.query(
      `SELECT first_blood FROM daily_quest_history
       WHERE quest_template_id = $1 AND character_id = $2 AND period_start = $3`,
      [quest.quest_template_id, characterId, quest.period_start]
    );
    const hasFirstBlood = firstBloodResult.rows[0]?.first_blood || false;
    const firstBloodMultiplier = hasFirstBlood ? (1 + FIRST_BLOOD_BONUS) : 1;

    // Calculate final rewards
    const totalMultiplier = streakMultiplier * firstBloodMultiplier;
    const finalGold = Math.floor((baseRewards.gold || 0) * totalMultiplier);
    const finalXp = Math.floor((baseRewards.xp || 0) * totalMultiplier);

    // Award gold to user
    if (finalGold > 0) {
      await client.query(
        'UPDATE users SET gold = LEAST(gold + $1, $2) WHERE id = $3',
        [finalGold, MAX_GOLD, quest.user_id]
      );
    }

    // Award XP to character (with overflow protection)
    if (finalXp > 0) {
      await client.query(
        'UPDATE characters SET experience = LEAST(experience + $1, $2) WHERE id = $3',
        [finalXp, MAX_XP, characterId]
      );
    }

    // Mark quest as claimed
    await client.query(
      'UPDATE character_daily_quests SET rewards_claimed = TRUE, claimed_at = NOW() WHERE id = $1',
      [questId]
    );

    // Record in history
    await client.query(
      `INSERT INTO daily_quest_history
       (character_id, quest_template_id, period, rewards_granted, period_start, completed_at, consecutive_days)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6)
       ON CONFLICT DO NOTHING`,
      [
        characterId,
        quest.quest_template_id,
        quest.period,
        JSON.stringify({ gold: finalGold, xp: finalXp }),
        quest.period_start,
        streak.currentStreak
      ]
    );

    // Elite quest handling: item drops and stats tracking
    let itemDrop = null;
    if (quest.difficulty === 'elite') {
      // Update elite quest stats
      await client.query('SELECT update_elite_quest_stats($1)', [characterId]);

      // Roll for rare item drop (15% chance)
      const dropChance = 0.15;
      if (Math.random() < dropChance) {
        // Get random elite-tier item (rarity 4+)
        const itemResult = await client.query(
          `SELECT id, name, item_type, equipment_slot, rarity
           FROM item_templates
           WHERE rarity >= 4 AND item_type IN ('weapon', 'armor', 'accessory')
           ORDER BY RANDOM() LIMIT 1`
        );

        if (itemResult.rows.length > 0) {
          const item = itemResult.rows[0];

          // Add item to user's shared inventory pool (not character-specific)
          // This matches the pattern used by shop, marketplace, and item drops
          await client.query(
            `INSERT INTO character_items (user_id, item_template_id, quantity)
             VALUES ($1, $2, 1)`,
            [quest.user_id, item.id]
          );

          itemDrop = {
            id: item.id,
            name: item.name,
            type: item.item_type,
            slot: item.equipment_slot,
            rarity: item.rarity
          };
        }
      }
    }

    return {
      gold: finalGold,
      xp: finalXp,
      streakBonus: streakMultiplier - 1,
      firstBloodBonus: hasFirstBlood,
      totalMultiplier,
      isElite: quest.difficulty === 'elite',
      itemDrop
    };
  });
}

/**
 * Claim all completed quests
 * @param {number} characterId - Character ID
 * @returns {Object} Total claimed rewards
 */
export async function claimAllRewards(characterId) {
  // Get all completed but unclaimed quests
  const questsResult = await query(
    `SELECT id FROM character_daily_quests
     WHERE character_id = $1 AND is_completed = TRUE AND rewards_claimed = FALSE
     AND period_end > NOW()`,
    [characterId]
  );

  const results = {
    questsClaimed: 0,
    totalGold: 0,
    totalXp: 0,
    completionBonus: null,
    itemDrops: []
  };

  for (const quest of questsResult.rows) {
    try {
      const reward = await claimReward(quest.id, characterId);
      results.questsClaimed++;
      results.totalGold += reward.gold;
      results.totalXp += reward.xp;
      if (reward.itemDrop) {
        results.itemDrops.push(reward.itemDrop);
      }
    } catch (err) {
      console.warn(`[Quest] Failed to claim quest ${quest.id}:`, err.message);
    }
  }

  // Check and grant completion bonus after all claims
  const completionBonus = await grantCompletionBonus(characterId);
  if (completionBonus) {
    results.completionBonus = completionBonus;
    results.totalGold += completionBonus.gold;
    results.totalXp += completionBonus.xp;
  }

  return results;
}

// ============================================
// BONUS MECHANICS
// ============================================

/**
 * Try to claim First Blood for a quest
 * Uses partial unique index to ensure only one winner
 */
async function tryClaimFirstBlood(templateId, characterId, period, periodStart) {
  try {
    // Try to insert First Blood record (will fail if someone already has it)
    const result = await query(
      `INSERT INTO daily_quest_history
       (character_id, quest_template_id, period, rewards_granted, period_start, completed_at, first_blood)
       VALUES ($1, $2, $3, '{}', $4, NOW(), TRUE)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [characterId, templateId, period, periodStart]
    );

    return result.rows.length > 0;
  } catch (err) {
    // Unique constraint violation means someone else got it
    console.log(`[Quest] First Blood already claimed for template ${templateId}`);
    return false;
  }
}

/**
 * Check if character qualifies for Completion Bonus
 */
async function checkCompletionBonus(characterId) {
  const result = await query(
    'SELECT has_completed_all_daily_quests($1) as completed',
    [characterId]
  );

  if (result.rows[0].completed) {
    // Update Perfect Week progress
    await query('SELECT update_perfect_week_progress($1)', [characterId]);
  }

  return result.rows[0].completed;
}

/**
 * Grant Completion Bonus (called after claiming all daily quests)
 */
async function grantCompletionBonus(characterId) {
  return withTransaction(async (client) => {
    // Check if all daily quests are completed and claimed
    const checkResult = await client.query(
      `SELECT COUNT(*) as total,
              COUNT(*) FILTER (WHERE is_completed = TRUE AND rewards_claimed = TRUE) as claimed
       FROM character_daily_quests
       WHERE character_id = $1
         AND period = 'daily'
         AND period_start = get_daily_period_start()`,
      [characterId]
    );

    const { total, claimed } = checkResult.rows[0];

    // Must have claimed all 3 daily quests
    if (parseInt(total) < DAILY_QUEST_COUNT || parseInt(claimed) < parseInt(total)) {
      return null;
    }

    // Check if bonus already granted today
    const existingBonus = await client.query(
      `SELECT id FROM character_completion_bonuses
       WHERE character_id = $1 AND period_start = get_daily_period_start()`,
      [characterId]
    );

    if (existingBonus.rows.length > 0) {
      return null; // Already granted
    }

    // Calculate bonus (25% of total daily rewards)
    const totalRewardsResult = await client.query(
      `SELECT COALESCE(SUM((rewards_granted->>'gold')::int), 0) as total_gold,
              COALESCE(SUM((rewards_granted->>'xp')::int), 0) as total_xp
       FROM daily_quest_history
       WHERE character_id = $1
         AND period = 'daily'
         AND period_start = get_daily_period_start()`,
      [characterId]
    );

    const bonusGold = Math.floor((totalRewardsResult.rows[0].total_gold || 0) * COMPLETION_BONUS_MULTIPLIER);
    const bonusXp = Math.floor((totalRewardsResult.rows[0].total_xp || 0) * COMPLETION_BONUS_MULTIPLIER);

    if (bonusGold === 0 && bonusXp === 0) {
      return null;
    }

    // Get user_id for gold update
    const charResult = await client.query(
      'SELECT user_id FROM characters WHERE id = $1',
      [characterId]
    );
    const userId = charResult.rows[0].user_id;

    // Award bonus gold
    if (bonusGold > 0) {
      await client.query(
        'UPDATE users SET gold = LEAST(gold + $1, $2) WHERE id = $3',
        [bonusGold, MAX_GOLD, userId]
      );
    }

    // Award bonus XP
    if (bonusXp > 0) {
      await client.query(
        'UPDATE characters SET experience = experience + $1 WHERE id = $2',
        [bonusXp, characterId]
      );
    }

    // Record the bonus
    await client.query(
      `INSERT INTO character_completion_bonuses (character_id, period_start, bonus_gold, bonus_xp)
       VALUES ($1, get_daily_period_start(), $2, $3)`,
      [characterId, bonusGold, bonusXp]
    );

    return { gold: bonusGold, xp: bonusXp };
  });
}

// ============================================
// STREAK TRACKING
// ============================================

/**
 * Get streak info for a character
 * @param {number} characterId - Character ID
 * @returns {Object} Streak data
 */
export async function getStreakInfo(characterId) {
  const result = await query(
    `SELECT current_streak, longest_streak, last_login_date
     FROM character_login_streaks
     WHERE character_id = $1`,
    [characterId]
  );

  if (result.rows.length === 0) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      bonusPercentage: 0,
      lastLoginDate: null
    };
  }

  const { current_streak, longest_streak, last_login_date } = result.rows[0];
  const bonusPercentage = Math.min(current_streak * STREAK_BONUS_PER_DAY * 100, MAX_STREAK_BONUS * 100);

  return {
    currentStreak: current_streak,
    longestStreak: longest_streak,
    bonusPercentage,
    lastLoginDate: last_login_date
  };
}

/**
 * Update streak on login
 */
async function updateStreak(characterId) {
  const result = await query(
    `SELECT current_streak, longest_streak, last_login_date
     FROM character_login_streaks
     WHERE character_id = $1`,
    [characterId]
  );

  if (result.rows.length === 0) {
    // First login - create record
    await query(
      `INSERT INTO character_login_streaks (character_id, current_streak, longest_streak, last_login_date)
       VALUES ($1, 1, 1, CURRENT_DATE)`,
      [characterId]
    );
    return;
  }

  const { current_streak, longest_streak, last_login_date } = result.rows[0];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const lastLogin = new Date(last_login_date);
  lastLogin.setHours(0, 0, 0, 0);

  const daysDiff = Math.floor((today - lastLogin) / (1000 * 60 * 60 * 24));

  let newStreak;
  if (daysDiff === 0) {
    // Same day - no change
    return;
  } else if (daysDiff === 1) {
    // Consecutive day - increment streak
    newStreak = current_streak + 1;
  } else {
    // Streak broken
    newStreak = 1;
  }

  const newLongest = Math.max(newStreak, longest_streak);

  await query(
    `UPDATE character_login_streaks
     SET current_streak = $1, longest_streak = $2, last_login_date = CURRENT_DATE, updated_at = NOW()
     WHERE character_id = $3`,
    [newStreak, newLongest, characterId]
  );
}

// ============================================
// FIRST BLOOD & PERFECT WEEK LEADERBOARDS
// ============================================

/**
 * Get today's First Blood winners
 */
export async function getFirstBloodWinners() {
  const result = await query(
    'SELECT * FROM todays_first_blood'
  );

  return result.rows;
}

/**
 * Get Perfect Week champions
 * @param {number} limit - Number of records to return
 */
export async function getPerfectWeekChampions(limit = 50) {
  const result = await query(
    'SELECT * FROM quest_champions LIMIT $1',
    [limit]
  );

  return result.rows;
}

/**
 * Get Perfect Week progress for a character
 */
export async function getPerfectWeekProgress(characterId) {
  const result = await query(
    `SELECT * FROM character_perfect_weeks
     WHERE character_id = $1
       AND week_start = get_weekly_period_start()`,
    [characterId]
  );

  if (result.rows.length === 0) {
    return {
      daysCompleted: 0,
      isPerfect: false,
      dayStatus: [false, false, false, false, false, false, false]
    };
  }

  const row = result.rows[0];
  return {
    daysCompleted: row.days_completed,
    isPerfect: row.is_perfect,
    rewardsClaimed: row.rewards_claimed,
    eliteQuestAccess: row.elite_quest_access,
    badgeGranted: row.badge_granted,
    dayStatus: [
      row.day_1_complete,
      row.day_2_complete,
      row.day_3_complete,
      row.day_4_complete,
      row.day_5_complete,
      row.day_6_complete,
      row.day_7_complete
    ]
  };
}

// ============================================
// SCHEDULED CLEANUP
// ============================================

/**
 * Clean up expired quests (call from scheduler)
 */
export async function cleanupExpiredQuests() {
  const result = await query(
    `DELETE FROM character_daily_quests
     WHERE period_end < NOW() - INTERVAL '1 day'
     AND rewards_claimed = TRUE`
  );

  console.log(`[Quest] Cleaned up ${result.rowCount} expired quest records`);
  return result.rowCount;
}

/**
 * Start cleanup scheduler
 */
export function startCleanupScheduler() {
  // Run cleanup every 6 hours
  const CLEANUP_INTERVAL = 6 * 60 * 60 * 1000;

  setInterval(async () => {
    try {
      await cleanupExpiredQuests();
    } catch (err) {
      console.error('[Quest] Cleanup failed:', err);
    }
  }, CLEANUP_INTERVAL);

  console.log('[Quest] Cleanup scheduler started');
}

// ============================================
// QUEST MARKERS
// ============================================

/**
 * Node types that spawn enemies (combat nodes)
 */
const COMBAT_NODE_TYPES = ['forest', 'cave', 'mountain', 'bridge'];

/**
 * Map of objective types to their relevant node types
 */
const OBJECTIVE_NODE_TYPE_MAP = {
  kill_enemies: COMBAT_NODE_TYPES,
  complete_battles: COMBAT_NODE_TYPES,
  fish_catches: ['fishing_spot'],
  puzzle_solves: ['ruins']
};

/**
 * Get world nodes that are relevant to a character's active quests
 * Used for displaying quest markers on the world map
 *
 * @param {number} characterId - Character ID
 * @returns {Promise<Map<number, Array<Object>>>} Map of nodeId -> quest info array
 */
export async function getQuestRelevantNodes(characterId) {
  // Get all active (uncompleted) quests for the character
  const activeQuests = await query(
    `SELECT cdq.id, cdq.current_progress, cdq.target_progress, cdq.period,
            dqt.quest_name, dqt.objective_type, dqt.objective_requirements
     FROM character_daily_quests cdq
     JOIN daily_quest_templates dqt ON dqt.id = cdq.quest_template_id
     WHERE cdq.character_id = $1
       AND cdq.is_completed = FALSE
       AND cdq.period_end > NOW()`,
    [characterId]
  );

  if (activeQuests.rows.length === 0) {
    return new Map();
  }

  // Collect all required node types from active quests
  const requiredNodeTypes = new Set();
  const questNodeRequirements = [];

  for (const quest of activeQuests.rows) {
    const requirements = quest.objective_requirements || {};
    const objectiveType = quest.objective_type;

    let nodeTypes = [];

    // Determine relevant node types based on objective type
    if (objectiveType === 'visit_nodes') {
      // Visit quests may specify specific node types
      if (requirements.node_types && requirements.node_types.length > 0) {
        nodeTypes = requirements.node_types;
      }
      // If no specific types, skip (too many nodes to mark)
    } else if (OBJECTIVE_NODE_TYPE_MAP[objectiveType]) {
      nodeTypes = OBJECTIVE_NODE_TYPE_MAP[objectiveType];
    }
    // gold_earned, items_sold, coliseum_wins, party_battles, visit_regions
    // don't map to specific nodes

    if (nodeTypes.length > 0) {
      for (const nt of nodeTypes) {
        requiredNodeTypes.add(nt);
      }
      questNodeRequirements.push({
        questId: quest.id,
        questType: quest.period,
        name: quest.quest_name,
        progress: quest.target_progress > 0
          ? quest.current_progress / quest.target_progress
          : 0,
        nearComplete: quest.target_progress > 0
          ? (quest.current_progress / quest.target_progress) >= 0.8
          : false,
        nodeTypes,
        region: requirements.region || null
      });
    }
  }

  if (requiredNodeTypes.size === 0) {
    return new Map();
  }

  // Fetch all nodes of the required types
  const nodeTypesArray = Array.from(requiredNodeTypes);
  const nodesResult = await query(
    'SELECT id, node_type, region_id FROM world_nodes WHERE node_type = ANY($1)',
    [nodeTypesArray]
  );

  // Build nodeId -> quests map
  const nodeQuestMap = new Map();

  for (const node of nodesResult.rows) {
    const matchingQuests = [];

    for (const qr of questNodeRequirements) {
      // Check if this node matches the quest's node type requirements
      if (!qr.nodeTypes.includes(node.node_type)) {
        continue;
      }

      // Check region requirement if specified
      if (qr.region !== null) {
        // Get region name from region_id if needed
        // For simplicity, we skip region filtering here - can be enhanced later
        // when region names are needed
      }

      matchingQuests.push({
        questId: qr.questId,
        questType: qr.questType,
        name: qr.name,
        progress: qr.progress,
        nearComplete: qr.nearComplete
      });
    }

    if (matchingQuests.length > 0) {
      nodeQuestMap.set(node.id, matchingQuests);
    }
  }

  return nodeQuestMap;
}
