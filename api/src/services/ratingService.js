/**
 * Rating Service - ELO-based rating calculations for PvP
 * Implements weighted ELO with character power adjustments
 *
 * Uses weighted ELO with underdog bonus based on Player Power Rating (PPR):
 * - Base K-factor: 32
 * - Underdog bonus: 0.5x - 2.0x multiplier based on PPR ratio
 * - Forfeit/surrender penalty: 1.25x rating loss
 */

import { query } from '../config/database.js';
import { getTierName } from '../../../shared/coliseum.js';

// Base K-factor for ELO calculations
const K_FACTOR = 32;
const BASE_K_FACTOR = K_FACTOR; // Alias for backwards compatibility

// Starting rating for new players
const DEFAULT_RATING = 1000;

// Minimum and maximum power ratio for underdog bonus
const MIN_POWER_RATIO = 0.5;
const MAX_POWER_RATIO = 2.0;
const MIN_UNDERDOG_BONUS = MIN_POWER_RATIO;
const MAX_UNDERDOG_BONUS = MAX_POWER_RATIO;

// Surrender/forfeit penalty multiplier (25% extra rating loss)
const FORFEIT_PENALTY_MULTIPLIER = 1.25;

/**
 * Calculate rating changes for a match
 * Uses ELO formula with power-weighted underdog bonus
 * @param {number} winnerRating - Winner's current rating
 * @param {number} loserRating - Loser's current rating
 * @param {number} winnerPPR - Winner's Player Power Rating
 * @param {number} loserPPR - Loser's Player Power Rating
 * @returns {Object} { winnerGain, loserLoss }
 */
function calculateRatingChange(winnerRating, loserRating, winnerPPR, loserPPR) {
  // Calculate expected score using ELO formula
  const expectedWinner = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));

  // Calculate power ratio for underdog bonus
  // Higher ratio = winner was underdog (lower power beat higher power)
  const powerRatio = loserPPR > 0 ? loserPPR / winnerPPR : 1.0;

  // Clamp power ratio between 0.5 and 2.0
  const underdogBonus = Math.min(Math.max(powerRatio, MIN_POWER_RATIO), MAX_POWER_RATIO);

  // Calculate rating changes
  // Winner gains more if they were the underdog (power-wise)
  const winnerGain = Math.round(BASE_K_FACTOR * (1 - expectedWinner) * underdogBonus);
  const loserLoss = Math.round(BASE_K_FACTOR * expectedWinner);

  return {
    winnerGain: Math.max(1, winnerGain), // Minimum 1 point gain
    loserLoss: Math.max(1, loserLoss)    // Minimum 1 point loss
  };
}

/**
 * Apply forfeit/surrender penalty to rating loss
 * @param {number} baseLoss - Base rating loss
 * @returns {number} Penalized rating loss
 */
function applyForfeitPenalty(baseLoss) {
  return Math.round(baseLoss * FORFEIT_PENALTY_MULTIPLIER);
}

/**
 * Ensure a rating record exists for a user/queue combination
 * Creates with default rating if not exists
 * @param {number} userId - User ID
 * @param {string} queueType - Queue type (1v1, 3v3, 5v5)
 * @returns {Promise<Object>} Rating record
 */
async function ensureRating(userId, queueType = '1v1') {
  // Try to get existing rating
  let result = await query(
    'SELECT * FROM pvp_ratings WHERE user_id = $1 AND queue_type = $2',
    [userId, queueType]
  );

  if (result.rows.length === 0) {
    // Calculate initial tier
    const initialTier = getTierName(DEFAULT_RATING);

    // Create new rating record with tier
    result = await query(
      `INSERT INTO pvp_ratings (user_id, queue_type, rating, peak_rating, tier, peak_tier)
       VALUES ($1, $2, $3, $3, $4, $4)
       ON CONFLICT (user_id, queue_type) DO NOTHING
       RETURNING *`,
      [userId, queueType, DEFAULT_RATING, initialTier]
    );

    // If ON CONFLICT triggered, fetch the existing record
    if (result.rows.length === 0) {
      result = await query(
        'SELECT * FROM pvp_ratings WHERE user_id = $1 AND queue_type = $2',
        [userId, queueType]
      );
    }
  }

  return result.rows[0];
}

/**
 * Get a player's current rating for a queue type
 * @param {number} userId - User ID
 * @param {string} queueType - Queue type
 * @returns {Promise<Object>} Rating info or null
 */
async function getPlayerRating(userId, queueType = '1v1') {
  const result = await query(
    'SELECT * FROM pvp_ratings WHERE user_id = $1 AND queue_type = $2',
    [userId, queueType]
  );

  return result.rows[0] || null;
}

/**
 * Get all ratings for a player across all queue types
 * @param {number} userId - User ID
 * @returns {Promise<Array>} Array of rating records
 */
async function getAllPlayerRatings(userId) {
  const result = await query(
    'SELECT * FROM pvp_ratings WHERE user_id = $1 ORDER BY queue_type',
    [userId]
  );

  return result.rows;
}

/**
 * Update a player's PvP rating after a match
 * @param {number} userId - User ID
 * @param {string} queueType - Queue type
 * @param {number} ratingChange - Rating change (positive for win, negative for loss)
 * @param {boolean} isWin - Whether this was a win
 * @returns {Promise<Object>} Updated rating record
 */
async function updatePvpRating(userId, queueType, ratingChange, isWin) {
  // Ensure rating exists
  await ensureRating(userId, queueType);

  // First, get current rating to calculate new tier
  const currentResult = await query(
    'SELECT rating, peak_rating FROM pvp_ratings WHERE user_id = $1 AND queue_type = $2',
    [userId, queueType]
  );

  const currentRating = currentResult.rows[0]?.rating || DEFAULT_RATING;
  const currentPeakRating = currentResult.rows[0]?.peak_rating || DEFAULT_RATING;

  // Calculate new ratings
  const newRating = Math.max(0, currentRating + ratingChange);
  const newPeakRating = Math.max(currentPeakRating, newRating);

  // Calculate tiers
  const newTier = getTierName(newRating);
  const newPeakTier = getTierName(newPeakRating);

  const result = await query(
    `UPDATE pvp_ratings SET
       rating = $3,
       peak_rating = $4,
       tier = $5,
       peak_tier = $6,
       wins = wins + CASE WHEN $7 THEN 1 ELSE 0 END,
       losses = losses + CASE WHEN NOT $7 THEN 1 ELSE 0 END,
       win_streak = CASE WHEN $7 THEN win_streak + 1 ELSE 0 END,
       best_win_streak = GREATEST(best_win_streak, CASE WHEN $7 THEN win_streak + 1 ELSE win_streak END),
       last_match_at = NOW(),
       updated_at = NOW()
     WHERE user_id = $1 AND queue_type = $2
     RETURNING *`,
    [userId, queueType, newRating, newPeakRating, newTier, newPeakTier, isWin]
  );

  return result.rows[0];
}

/**
 * Record a draw (updates last_match_at but not wins/losses)
 * @param {number} userId - User ID
 * @param {string} queueType - Queue type
 * @returns {Promise<Object>} Updated rating record
 */
async function recordDraw(userId, queueType) {
  await ensureRating(userId, queueType);

  const result = await query(
    `UPDATE pvp_ratings SET
       draws = draws + 1,
       win_streak = 0,
       last_match_at = NOW(),
       updated_at = NOW()
     WHERE user_id = $1 AND queue_type = $2
     RETURNING *`,
    [userId, queueType]
  );

  return result.rows[0];
}

/**
 * Check and use weekly disconnect grace
 * @param {number} userId - User ID
 * @returns {Promise<boolean>} True if grace was available and used
 */
async function checkAndUseWeeklyGrace(userId) {
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Check if grace is available
  const result = await query(
    'SELECT last_disconnect_grace FROM users WHERE id = $1',
    [userId]
  );

  if (result.rows.length === 0) {
    return false;
  }

  const lastGrace = result.rows[0].last_disconnect_grace;

  // Grace available if never used or used more than a week ago
  if (!lastGrace || new Date(lastGrace) < oneWeekAgo) {
    // Use the grace
    await query(
      'UPDATE users SET last_disconnect_grace = NOW() WHERE id = $1',
      [userId]
    );
    return true;
  }

  return false;
}

/**
 * Record a disconnect event
 * @param {number} userId - User ID
 * @param {number} matchId - Match ID (can be null if match not yet recorded)
 * @returns {Promise<Object>} Disconnect record
 */
async function recordDisconnect(userId, matchId = null) {
  const result = await query(
    `INSERT INTO pvp_disconnects (user_id, match_id, disconnected_at)
     VALUES ($1, $2, NOW())
     RETURNING *`,
    [userId, matchId]
  );

  return result.rows[0];
}

/**
 * Record reconnection
 * @param {number} disconnectId - Disconnect record ID
 * @returns {Promise<Object>} Updated disconnect record
 */
async function recordReconnection(disconnectId) {
  const result = await query(
    `UPDATE pvp_disconnects SET reconnected_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [disconnectId]
  );

  return result.rows[0];
}

/**
 * Forgive a disconnect (using weekly grace)
 * @param {number} disconnectId - Disconnect record ID
 * @returns {Promise<Object>} Updated disconnect record
 */
async function forgiveDisconnect(disconnectId) {
  const result = await query(
    `UPDATE pvp_disconnects SET was_forgiven = TRUE
     WHERE id = $1
     RETURNING *`,
    [disconnectId]
  );

  return result.rows[0];
}

/**
 * Get disconnect history for a user
 * @param {number} userId - User ID
 * @param {number} limit - Number of records to return
 * @returns {Promise<Array>} Disconnect records
 */
async function getDisconnectHistory(userId, limit = 10) {
  const result = await query(
    `SELECT * FROM pvp_disconnects
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );

  return result.rows;
}

/**
 * Count unforgiven disconnects in the last 24 hours
 * Used for potential penalties or warnings
 * @param {number} userId - User ID
 * @returns {Promise<number>} Count of unforgiven disconnects
 */
async function countRecentDisconnects(userId) {
  const result = await query(
    `SELECT COUNT(*) as count FROM pvp_disconnects
     WHERE user_id = $1
       AND was_forgiven = FALSE
       AND reconnected_at IS NULL
       AND created_at > NOW() - INTERVAL '24 hours'`,
    [userId]
  );

  return parseInt(result.rows[0].count, 10);
}

/**
 * Get full rating stats for a player
 * @param {number} userId - User ID
 * @param {string} queueType - Queue type ('1v1', '3v3', '5v5')
 * @returns {Promise<Object>} Full rating stats
 */
async function getPlayerRatingStats(userId, queueType = '1v1') {
  const rating = await ensureRating(userId, queueType);
  return {
    rating: rating.rating,
    peakRating: rating.peak_rating,
    wins: rating.wins,
    losses: rating.losses,
    draws: rating.draws,
    winStreak: rating.win_streak,
    bestWinStreak: rating.best_win_streak,
    totalGames: rating.wins + rating.losses + rating.draws,
    winRate: rating.wins + rating.losses > 0
      ? Math.round((rating.wins / (rating.wins + rating.losses)) * 100)
      : 0,
    lastMatchAt: rating.last_match_at
  };
}

/**
 * Process a match result and update both players' ratings
 * @param {Object} options - Match result options
 * @param {number} options.winnerId - Winner's user ID
 * @param {number} options.loserId - Loser's user ID
 * @param {string} options.queueType - Queue type
 * @param {number} options.winnerPPR - Winner's Player Power Rating (optional)
 * @param {number} options.loserPPR - Loser's Player Power Rating (optional)
 * @param {string} options.endReason - How the match ended ('victory', 'surrender', 'timeout_forfeit', 'disconnect_forfeit')
 * @returns {Promise<Object>} Rating changes for both players
 */
async function processMatchResult({
  winnerId,
  loserId,
  queueType = '1v1',
  winnerPPR = 0,
  loserPPR = 0,
  endReason = 'victory'
}) {
  // Get current ratings
  const winnerRatingData = await getPlayerRating(winnerId, queueType);
  const loserRatingData = await getPlayerRating(loserId, queueType);

  const winnerRating = winnerRatingData?.rating || DEFAULT_RATING;
  const loserRating = loserRatingData?.rating || DEFAULT_RATING;

  // Calculate base rating change
  const ratingChange = calculateRatingChange(winnerRating, loserRating, winnerPPR, loserPPR);

  // Apply forfeit penalty if applicable
  if (['surrender', 'timeout_forfeit', 'disconnect_forfeit'].includes(endReason)) {
    ratingChange.loserLoss = applyForfeitPenalty(ratingChange.loserLoss);
  }

  // Update both players' ratings
  const [updatedWinner, updatedLoser] = await Promise.all([
    updatePvpRating(winnerId, queueType, ratingChange.winnerGain, true),
    updatePvpRating(loserId, queueType, -ratingChange.loserLoss, false)
  ]);

  return {
    winner: {
      userId: winnerId,
      oldRating: winnerRating,
      newRating: updatedWinner.rating,
      change: ratingChange.winnerGain
    },
    loser: {
      userId: loserId,
      oldRating: loserRating,
      newRating: updatedLoser.rating,
      change: -ratingChange.loserLoss
    },
    endReason
  };
}

/**
 * Get the leaderboard for a queue type
 * @param {string} queueType - Queue type
 * @param {number} limit - Maximum number of entries
 * @param {number} offset - Offset for pagination
 * @returns {Promise<Array>} Leaderboard entries
 */
async function getLeaderboard(queueType = '1v1', limit = 100, offset = 0) {
  const result = await query(
    `SELECT
       pr.user_id,
       u.username,
       pr.rating,
       pr.peak_rating,
       pr.wins,
       pr.losses,
       pr.win_streak,
       pr.best_win_streak,
       pr.last_match_at,
       ROW_NUMBER() OVER (ORDER BY pr.rating DESC) as rank
     FROM pvp_ratings pr
     JOIN users u ON pr.user_id = u.id
     WHERE pr.queue_type = $1
       AND (pr.wins + pr.losses) > 0
     ORDER BY pr.rating DESC
     LIMIT $2 OFFSET $3`,
    [queueType, limit, offset]
  );

  return result.rows.map(row => ({
    rank: parseInt(row.rank, 10),
    userId: row.user_id,
    username: row.username,
    rating: row.rating,
    peakRating: row.peak_rating,
    wins: row.wins,
    losses: row.losses,
    winRate: row.wins + row.losses > 0
      ? Math.round((row.wins / (row.wins + row.losses)) * 100)
      : 0,
    winStreak: row.win_streak,
    bestWinStreak: row.best_win_streak,
    lastMatchAt: row.last_match_at
  }));
}

/**
 * Get a player's rank on the leaderboard
 * @param {number} userId - User ID
 * @param {string} queueType - Queue type
 * @returns {Promise<number|null>} Player's rank or null if not ranked
 */
async function getPlayerRank(userId, queueType = '1v1') {
  const result = await query(
    `SELECT rank FROM (
       SELECT
         user_id,
         ROW_NUMBER() OVER (ORDER BY rating DESC) as rank
       FROM pvp_ratings
       WHERE queue_type = $1
         AND (wins + losses) > 0
     ) ranked
     WHERE user_id = $2`,
    [queueType, userId]
  );

  return result.rows.length > 0 ? parseInt(result.rows[0].rank, 10) : null;
}

/**
 * Calculate the expected win probability for player A vs player B
 * @param {number} ratingA - Player A's rating
 * @param {number} ratingB - Player B's rating
 * @returns {number} Expected win probability (0-1)
 */
function calculateExpectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Calculate the underdog bonus multiplier based on PPR ratio
 * @param {number} winnerPPR - Winner's Player Power Rating
 * @param {number} loserPPR - Loser's Player Power Rating
 * @returns {number} Underdog bonus multiplier (0.5 - 2.0)
 */
function calculateUnderdogBonus(winnerPPR, loserPPR) {
  if (!winnerPPR || !loserPPR || winnerPPR <= 0 || loserPPR <= 0) {
    return 1.0;
  }
  const powerRatio = loserPPR / winnerPPR;
  return Math.min(Math.max(powerRatio, MIN_UNDERDOG_BONUS), MAX_UNDERDOG_BONUS);
}

export {
  // Constants
  K_FACTOR,
  BASE_K_FACTOR,
  DEFAULT_RATING,
  FORFEIT_PENALTY_MULTIPLIER,
  MIN_UNDERDOG_BONUS,
  MAX_UNDERDOG_BONUS,
  // Rating calculations
  calculateRatingChange,
  calculateExpectedScore,
  calculateUnderdogBonus,
  applyForfeitPenalty,
  // Rating CRUD
  ensureRating,
  getPlayerRating,
  getPlayerRatingStats,
  getAllPlayerRatings,
  updatePvpRating,
  recordDraw,
  // Match processing
  processMatchResult,
  // Leaderboards
  getLeaderboard,
  getPlayerRank,
  // Disconnect handling
  checkAndUseWeeklyGrace,
  recordDisconnect,
  recordReconnection,
  forgiveDisconnect,
  getDisconnectHistory,
  countRecentDisconnects
};
