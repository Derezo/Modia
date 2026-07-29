/**
 * Achievement Service - Handles PvP achievement badge checking and awarding
 *
 * Badge Types:
 * - Milestone: Cumulative progress (wins, tier reached)
 * - Skill: Single-match feats (giant_slayer, underdog, flawless, comeback)
 * - Streak: Dynamic (computed from winStreak, not stored)
 */

import { query } from '../config/database.js';
import { ACHIEVEMENT_BADGES, getTierName } from '../../../shared/coliseum.js';

// Thresholds for milestone badges
const WIN_THRESHOLDS = {
  first_blood: 1,
  veteran: 50,
  legend: 200
};

// Tier requirements for tier badges
const TIER_BADGES = {
  climber: 'Gold',
  elite: 'Master',
  champion: 'Grandmaster'
};

// ELO difference threshold for giant_slayer
const GIANT_SLAYER_ELO_DIFF = 200;

// PPR disadvantage threshold for underdog (20%)
const UNDERDOG_PPR_THRESHOLD = 0.20;

/**
 * Check and award badges after a match completion
 * @param {number} userId - User ID of the winner
 * @param {Object} matchResult - Match result data
 * @param {number} matchResult.winnerRating - Winner's rating before match
 * @param {number} matchResult.loserRating - Loser's rating before match
 * @param {number} matchResult.winnerPPR - Winner's Player Power Rating
 * @param {number} matchResult.loserPPR - Loser's Player Power Rating
 * @param {Object} [matchResult.battleState] - Final battle state
 * @param {{flawless: boolean, comeback: boolean}} [matchResult.outcome] -
 *   Precomputed terminal outcome for a durable/replayable handler
 * @param {number} matchResult.winnerNewRating - Winner's rating after match
 * @param {Object} [options]
 * @param {boolean} [options.throwOnAwardError=false] - Re-throw inserts so a
 *   durable caller can retry instead of silently losing an award
 * @returns {Promise<Array>} Array of newly awarded badges
 */
async function checkAndAwardBadges(
  userId,
  matchResult,
  { throwOnAwardError = false } = {}
) {
  const newBadges = [];

  // Get user's current achievements to avoid re-awarding
  const existingAchievements = await getUserAchievements(userId);
  const existingKeys = new Set(existingAchievements.map(a => a.achievement_key));

  // Get user's win count for milestone checks
  const ratingResult = await query(
    `SELECT wins, rating FROM pvp_ratings
     WHERE user_id = $1 AND queue_type = '1v1'`,
    [userId]
  );
  const wins = ratingResult.rows[0]?.wins || 0;
  const currentRating = matchResult.winnerNewRating || ratingResult.rows[0]?.rating || 1000;

  // Check milestone badges (win count)
  for (const [badgeKey, requiredWins] of Object.entries(WIN_THRESHOLDS)) {
    if (!existingKeys.has(badgeKey) && wins >= requiredWins) {
      const awarded = await awardBadge(userId, badgeKey, { throwOnAwardError });
      if (awarded) {
        newBadges.push({ key: badgeKey, ...ACHIEVEMENT_BADGES[badgeKey] });
      }
    }
  }

  // Check tier badges
  const currentTier = getTierName(currentRating);
  for (const [badgeKey, requiredTier] of Object.entries(TIER_BADGES)) {
    if (!existingKeys.has(badgeKey) && isTierAtLeast(currentTier, requiredTier)) {
      const awarded = await awardBadge(userId, badgeKey, { throwOnAwardError });
      if (awarded) {
        newBadges.push({ key: badgeKey, ...ACHIEVEMENT_BADGES[badgeKey] });
      }
    }
  }

  // Check skill badges (match-specific feats)
  const skillBadges = checkSkillBadges(matchResult, existingKeys);
  for (const badgeKey of skillBadges) {
    const awarded = await awardBadge(userId, badgeKey, { throwOnAwardError });
    if (awarded) {
      newBadges.push({ key: badgeKey, ...ACHIEVEMENT_BADGES[badgeKey] });
    }
  }

  return newBadges;
}

/**
 * Check skill badges based on match result
 * @param {Object} matchResult - Match result data
 * @param {Set} existingKeys - Set of already earned badge keys
 * @returns {Array} Array of badge keys to award
 */
function checkSkillBadges(matchResult, existingKeys) {
  const badgesToAward = [];
  const {
    winnerRating = 1000,
    loserRating = 1000,
    winnerPPR = 0,
    loserPPR = 0,
    battleState,
    outcome
  } = matchResult;

  // Giant Slayer: Beat opponent 200+ ELO above you
  if (!existingKeys.has('giant_slayer')) {
    const eloDiff = loserRating - winnerRating;
    if (eloDiff >= GIANT_SLAYER_ELO_DIFF) {
      badgesToAward.push('giant_slayer');
    }
  }

  // Underdog: Win with 20%+ PPR disadvantage
  if (!existingKeys.has('underdog') && winnerPPR > 0 && loserPPR > 0) {
    const pprDiff = (loserPPR - winnerPPR) / winnerPPR;
    if (pprDiff >= UNDERDOG_PPR_THRESHOLD) {
      badgesToAward.push('underdog');
    }
  }

  // Check battle state for flawless and comeback badges
  if (outcome || (battleState && battleState.units)) {
    const { flawless, comeback } = outcome ?? analyzeBattleOutcome(battleState);

    // Flawless: Win without losing a single unit
    if (!existingKeys.has('flawless') && flawless) {
      badgesToAward.push('flawless');
    }

    // Comeback Kid: Win after losing 50%+ of units first
    if (!existingKeys.has('comeback') && comeback) {
      badgesToAward.push('comeback');
    }
  }

  return badgesToAward;
}

/**
 * Analyze battle outcome for flawless and comeback badges
 * @param {Object} battleState - Final battle state
 * @returns {Object} { flawless: boolean, comeback: boolean }
 */
function analyzeBattleOutcome(battleState) {
  const { units, player1Id, player2Id } = battleState;

  // Determine winner by checking which team has surviving units
  let winnerUnits = [];

  const player1Units = units.filter(u => u.ownerId === player1Id);
  const player2Units = units.filter(u => u.ownerId === player2Id);

  const player1Alive = player1Units.filter(u => u.hp > 0).length;
  const player2Alive = player2Units.filter(u => u.hp > 0).length;

  if (player1Alive > 0 && player2Alive === 0) {
    winnerUnits = player1Units;
  } else if (player2Alive > 0 && player1Alive === 0) {
    winnerUnits = player2Units;
  } else {
    // Battle not conclusively won or still in progress
    return { flawless: false, comeback: false };
  }

  // Flawless: All winner's units survived
  const winnerDeaths = winnerUnits.filter(u => u.hp <= 0).length;
  const flawless = winnerDeaths === 0;

  // Comeback: Winner lost 50%+ of units at some point
  // This requires tracking during battle, so we estimate from final state
  // If winner lost units but still won, check if they lost at least half
  const winnerTotalUnits = winnerUnits.length;
  const comeback = winnerDeaths >= Math.ceil(winnerTotalUnits / 2);

  return { flawless, comeback };
}

/**
 * Check if a tier is at least as high as the required tier
 * @param {string} currentTier - Current tier name
 * @param {string} requiredTier - Required tier name
 * @returns {boolean} True if current tier is at or above required
 */
function isTierAtLeast(currentTier, requiredTier) {
  const tierOrder = ['Unranked', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Master', 'Grandmaster'];
  const currentIndex = tierOrder.indexOf(currentTier);
  const requiredIndex = tierOrder.indexOf(requiredTier);

  if (currentIndex === -1 || requiredIndex === -1) {
    return false;
  }

  return currentIndex >= requiredIndex;
}

/**
 * Award a badge to a user
 * @param {number} userId - User ID
 * @param {string} badgeKey - Achievement key
 * @param {Object} [options]
 * @param {boolean} [options.throwOnAwardError=false]
 * @returns {Promise<boolean>} True if badge was awarded (not already owned)
 */
async function awardBadge(
  userId,
  badgeKey,
  { throwOnAwardError = false } = {}
) {
  try {
    const result = await query(
      `INSERT INTO pvp_achievements (user_id, achievement_key)
       VALUES ($1, $2)
       ON CONFLICT (user_id, achievement_key) DO NOTHING
       RETURNING id`,
      [userId, badgeKey]
    );

    return result.rows.length > 0;
  } catch (error) {
    console.error(`[Achievement] Failed to award badge ${badgeKey} to user ${userId}:`, error);
    if (throwOnAwardError) throw error;
    return false;
  }
}

/**
 * Get all achievements for a user
 * @param {number} userId - User ID
 * @returns {Promise<Array>} Array of achievement records
 */
async function getUserAchievements(userId) {
  const result = await query(
    `SELECT achievement_key, earned_at
     FROM pvp_achievements
     WHERE user_id = $1
     ORDER BY earned_at DESC`,
    [userId]
  );

  return result.rows;
}

/**
 * Get achievements for multiple users (batch query for leaderboard)
 * @param {Array<number>} userIds - Array of user IDs
 * @returns {Promise<Map>} Map of userId -> Array of achievements
 */
async function getBatchUserAchievements(userIds) {
  if (!userIds || userIds.length === 0) {
    return new Map();
  }

  const result = await query(
    `SELECT user_id, achievement_key, earned_at
     FROM pvp_achievements
     WHERE user_id = ANY($1)
     ORDER BY user_id, earned_at DESC`,
    [userIds]
  );

  const achievementsMap = new Map();
  for (const row of result.rows) {
    if (!achievementsMap.has(row.user_id)) {
      achievementsMap.set(row.user_id, []);
    }
    achievementsMap.get(row.user_id).push({
      achievement_key: row.achievement_key,
      earned_at: row.earned_at
    });
  }

  return achievementsMap;
}

/**
 * Get achievement statistics
 * @param {string} badgeKey - Achievement key (optional, for specific badge)
 * @returns {Promise<Object>} Achievement statistics
 */
async function getAchievementStats(badgeKey = null) {
  if (badgeKey) {
    const result = await query(
      `SELECT COUNT(*) as count
       FROM pvp_achievements
       WHERE achievement_key = $1`,
      [badgeKey]
    );
    return {
      badge: badgeKey,
      earnedBy: parseInt(result.rows[0].count, 10)
    };
  }

  const result = await query(
    `SELECT achievement_key, COUNT(*) as count
     FROM pvp_achievements
     GROUP BY achievement_key
     ORDER BY count DESC`
  );

  return result.rows.map(row => ({
    badge: row.achievement_key,
    earnedBy: parseInt(row.count, 10)
  }));
}

export {
  checkAndAwardBadges,
  awardBadge,
  getUserAchievements,
  getBatchUserAchievements,
  getAchievementStats,
  analyzeBattleOutcome,
  isTierAtLeast,
  GIANT_SLAYER_ELO_DIFF,
  UNDERDOG_PPR_THRESHOLD,
  WIN_THRESHOLDS,
  TIER_BADGES
};

export default {
  checkAndAwardBadges,
  awardBadge,
  getUserAchievements,
  getBatchUserAchievements,
  getAchievementStats
};
