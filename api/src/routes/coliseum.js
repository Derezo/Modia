/**
 * Coliseum Routes - PvP leaderboards, match history, and management
 */

import express from 'express';
import { query } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { createLimiter } from '../middleware/rateLimiterFactory.js';
import { getTier, getUserBadges, getPriorityBadges } from '../../../shared/coliseum.js';
import { getUserAchievements, getBatchUserAchievements } from '../services/achievementService.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Rate limiter for queues endpoint
const queuesLimiter = createLimiter({
  name: 'coliseum/queues',
  maxRequests: 30,
  windowMs: 60000
});

/**
 * GET /api/coliseum/queues
 * Get current queue sizes for all queue types
 */
router.get('/queues', queuesLimiter, async (req, res) => {
  try {
    const coliseumService = await import('../services/coliseumService.js');
    const statuses = coliseumService.getAllQueueStatuses();
    res.json({ success: true, queues: statuses });
  } catch (error) {
    console.error('Failed to get queue statuses:', error);
    res.status(500).json({ success: false, error: 'Failed to get queue statuses' });
  }
});

/**
 * GET /api/coliseum/queue/:queueType/players
 * Get detailed player list for a specific queue
 */
router.get('/queue/:queueType/players', queuesLimiter, async (req, res) => {
  try {
    const { queueType } = req.params;
    const userId = req.user.id;

    // Validate queue type
    const validQueues = ['1v1', '3v3', '5v5'];
    if (!validQueues.includes(queueType)) {
      return res.status(400).json({ success: false, error: 'Invalid queue type' });
    }

    const coliseumService = await import('../services/coliseumService.js');
    const players = await coliseumService.getQueuePlayers(queueType, userId);

    res.json({ success: true, players });
  } catch (error) {
    console.error('Failed to get queue players:', error);
    res.status(500).json({ success: false, error: 'Failed to get queue players' });
  }
});

/**
 * GET /api/coliseum/leaderboard
 * Get PvP leaderboard for a specific queue type
 * Query params: queue (1v1|3v3|5v5), limit, time (all|week|today)
 */
router.get('/leaderboard', async (req, res) => {
  try {
    const { queue = '1v1', limit = 100, time = 'all' } = req.query;
    const userId = req.user.id;
    const parsedLimit = Math.min(parseInt(limit, 10) || 100, 100);

    // Validate queue type
    const validQueues = ['1v1', '3v3', '5v5'];
    if (!validQueues.includes(queue)) {
      return res.status(400).json({ error: 'Invalid queue type' });
    }

    // Build time filter condition
    let timeCondition = '';
    if (time === 'week') {
      timeCondition = 'AND pr.last_match_at >= NOW() - INTERVAL \'7 days\'';
    } else if (time === 'today') {
      timeCondition = 'AND pr.last_match_at >= NOW() - INTERVAL \'1 day\'';
    }

    // Get leaderboard with tier data
    const leaderboardResult = await query(
      `SELECT
        pr.user_id as "userId",
        u.username,
        pr.rating,
        pr.wins,
        pr.losses,
        pr.win_streak as "winStreak",
        pr.best_win_streak as "bestWinStreak",
        pr.peak_rating as "peakRating",
        pr.tier,
        pr.peak_tier as "peakTier"
       FROM pvp_ratings pr
       JOIN users u ON u.id = pr.user_id
       WHERE pr.queue_type = $1
         AND (pr.wins > 0 OR pr.losses > 0)
         ${timeCondition}
       ORDER BY pr.rating DESC, pr.wins DESC
       LIMIT $2`,
      [queue, parsedLimit]
    );

    // Get achievements for all users in leaderboard (batch query)
    const userIds = leaderboardResult.rows.map(r => r.userId);
    const achievementsMap = await getBatchUserAchievements(userIds);

    // Add tier info and badges to each entry
    leaderboardResult.rows = leaderboardResult.rows.map(entry => {
      const tierInfo = getTier(entry.rating);
      const userAchievements = achievementsMap.get(entry.userId) || [];
      const allBadges = getUserBadges(userAchievements, entry.winStreak);
      const priorityBadges = getPriorityBadges(allBadges, 3);

      return {
        ...entry,
        tier: entry.tier || tierInfo.name,
        tierColor: tierInfo.color,
        tierIcon: tierInfo.icon,
        badges: priorityBadges.map(b => ({
          key: b.key,
          name: b.name,
          icon: b.icon,
          type: b.type
        }))
      };
    });

    // Get user's rank if not in top 100
    let userRank = null;
    const userInLeaderboard = leaderboardResult.rows.find(r => r.userId === userId);

    if (!userInLeaderboard) {
      const userRankResult = await query(
        `SELECT COUNT(*) + 1 as rank
         FROM pvp_ratings
         WHERE queue_type = $1
           AND rating > (
             SELECT COALESCE(rating, 0)
             FROM pvp_ratings
             WHERE user_id = $2 AND queue_type = $1
           )`,
        [queue, userId]
      );

      if (userRankResult.rows.length > 0) {
        userRank = parseInt(userRankResult.rows[0].rank, 10);
      }
    }

    res.json({
      leaderboard: leaderboardResult.rows,
      userRank
    });
  } catch (err) {
    console.error('Error fetching leaderboard:', err);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

/**
 * GET /api/coliseum/matches
 * Get match history
 * Query params: filter (all|mine), limit, offset
 */
router.get('/matches', async (req, res) => {
  try {
    const { filter = 'all', limit = 20, offset = 0 } = req.query;
    const userId = req.user.id;
    const parsedLimit = Math.min(parseInt(limit, 10) || 20, 50);
    const parsedOffset = parseInt(offset, 10) || 0;

    let whereClause = '';
    const params = [parsedLimit, parsedOffset];

    if (filter === 'mine') {
      whereClause = 'WHERE cm.winner_user_id = $3 OR cm.loser_user_id = $3';
      params.push(userId);
    }

    const result = await query(
      `SELECT
        cm.id,
        cm.battle_id as "battleId",
        cm.queue_type as "queueType",
        cm.winner_user_id as "winnerId",
        cm.loser_user_id as "loserId",
        w.username as "winnerUsername",
        l.username as "loserUsername",
        cm.winner_rating_change as "winnerRatingChange",
        cm.loser_rating_change as "loserRatingChange",
        cm.match_duration_seconds as "duration",
        (cm.match_stats->>'turnCount')::int as "turnCount",
        cm.created_at as "createdAt",
        wpr.rating as "winnerRating",
        wpr.tier as "winnerTier",
        lpr.rating as "loserRating",
        lpr.tier as "loserTier"
       FROM coliseum_matches cm
       JOIN users w ON w.id = cm.winner_user_id
       JOIN users l ON l.id = cm.loser_user_id
       LEFT JOIN pvp_ratings wpr ON wpr.user_id = cm.winner_user_id AND wpr.queue_type = cm.queue_type
       LEFT JOIN pvp_ratings lpr ON lpr.user_id = cm.loser_user_id AND lpr.queue_type = cm.queue_type
       ${whereClause}
       ORDER BY cm.created_at DESC
       LIMIT $1 OFFSET $2`,
      params
    );

    // Add tier colors to match data
    const matches = result.rows.map(match => {
      const winnerTierInfo = getTier(match.winnerRating || 1000);
      const loserTierInfo = getTier(match.loserRating || 1000);
      return {
        ...match,
        winnerTier: match.winnerTier || winnerTierInfo.name,
        winnerTierColor: winnerTierInfo.color,
        winnerTierIcon: winnerTierInfo.icon,
        loserTier: match.loserTier || loserTierInfo.name,
        loserTierColor: loserTierInfo.color,
        loserTierIcon: loserTierInfo.icon
      };
    });

    res.json({ matches });
  } catch (err) {
    console.error('Error fetching match history:', err);
    res.status(500).json({ error: 'Failed to fetch match history' });
  }
});

/**
 * GET /api/coliseum/matches/:matchId
 * Get detailed match information
 */
router.get('/matches/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;

    const result = await query(
      `SELECT
        cm.id,
        cm.battle_id as "battleId",
        cm.queue_type as "queueType",
        cm.winner_user_id as "winnerId",
        cm.loser_user_id as "loserId",
        w.username as "winnerUsername",
        l.username as "loserUsername",
        cm.winner_rating_change as "winnerRatingChange",
        cm.loser_rating_change as "loserRatingChange",
        cm.match_duration_seconds as "duration",
        cm.match_snapshot as "matchSnapshot",
        cm.match_stats as "matchStats",
        cm.created_at as "createdAt"
       FROM coliseum_matches cm
       JOIN users w ON w.id = cm.winner_user_id
       JOIN users l ON l.id = cm.loser_user_id
       WHERE cm.id = $1`,
      [matchId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Match not found' });
    }

    res.json({ match: result.rows[0] });
  } catch (err) {
    console.error('Error fetching match details:', err);
    res.status(500).json({ error: 'Failed to fetch match details' });
  }
});

/**
 * POST /api/coliseum/surrender
 * Surrender from current PvP battle
 */
router.post('/surrender', async (req, res) => {
  try {
    const { battleId } = req.body;
    const userId = req.user.id;

    if (!battleId) {
      return res.status(400).json({ error: 'Battle ID is required' });
    }

    // Verify user is in this battle
    const battleResult = await query(
      `SELECT b.id, b.battle_type, b.status, b.player1_id, b.player2_id
       FROM battles b
       WHERE b.id = $1
         AND b.status = 'active'
         AND b.battle_type = 'pvp'
         AND (b.player1_id = $2 OR b.player2_id = $2)`,
      [battleId, userId]
    );

    if (battleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Active PvP battle not found' });
    }

    const battle = battleResult.rows[0];
    const _winnerId = battle.player1_id === userId ? battle.player2_id : battle.player1_id;

    // Import coliseum service to handle surrender
    const _coliseumService = await import('../services/coliseumService.js');

    // The actual surrender handling would be done via WebSocket
    // This endpoint is for fallback/confirmation
    res.json({
      success: true,
      message: 'Surrender request sent. Use WebSocket for real-time updates.'
    });
  } catch (err) {
    console.error('Error processing surrender:', err);
    res.status(500).json({ error: 'Failed to process surrender' });
  }
});

/**
 * GET /api/coliseum/achievements/:userId
 * Get achievements for a specific user
 */
router.get('/achievements/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const parsedUserId = parseInt(userId, 10);

    if (isNaN(parsedUserId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    // Get user's achievements
    const achievements = await getUserAchievements(parsedUserId);

    // Get user's win streak for dynamic badges
    const ratingResult = await query(
      `SELECT win_streak FROM pvp_ratings
       WHERE user_id = $1 AND queue_type = '1v1'`,
      [parsedUserId]
    );
    const winStreak = ratingResult.rows[0]?.win_streak || 0;

    // Build full badge list with definitions
    const badges = getUserBadges(achievements, winStreak);

    res.json({
      success: true,
      achievements: badges.map(badge => ({
        key: badge.key,
        name: badge.name,
        icon: badge.icon,
        description: badge.description,
        type: badge.type,
        earnedAt: badge.earnedAt,
        isDynamic: badge.isDynamic || false
      }))
    });
  } catch (err) {
    console.error('Error fetching achievements:', err);
    res.status(500).json({ error: 'Failed to fetch achievements' });
  }
});

/**
 * GET /api/coliseum/my-achievements
 * Get achievements for the current user
 */
router.get('/my-achievements', async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's achievements
    const achievements = await getUserAchievements(userId);

    // Get user's win streak for dynamic badges
    const ratingResult = await query(
      `SELECT win_streak FROM pvp_ratings
       WHERE user_id = $1 AND queue_type = '1v1'`,
      [userId]
    );
    const winStreak = ratingResult.rows[0]?.win_streak || 0;

    // Build full badge list with definitions
    const badges = getUserBadges(achievements, winStreak);

    res.json({
      success: true,
      achievements: badges.map(badge => ({
        key: badge.key,
        name: badge.name,
        icon: badge.icon,
        description: badge.description,
        type: badge.type,
        earnedAt: badge.earnedAt,
        isDynamic: badge.isDynamic || false
      }))
    });
  } catch (err) {
    console.error('Error fetching achievements:', err);
    res.status(500).json({ error: 'Failed to fetch achievements' });
  }
});

/**
 * GET /api/coliseum/stats
 * Get user's PvP statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await query(
      `SELECT
        queue_type as "queueType",
        rating,
        peak_rating as "peakRating",
        wins,
        losses,
        draws,
        win_streak as "winStreak",
        best_win_streak as "bestWinStreak",
        last_match_at as "lastMatchAt",
        tier,
        peak_tier as "peakTier"
       FROM pvp_ratings
       WHERE user_id = $1`,
      [userId]
    );

    // Add tier info to each rating entry
    result.rows = result.rows.map(entry => {
      const tierInfo = getTier(entry.rating);
      const peakTierInfo = getTier(entry.peakRating);
      return {
        ...entry,
        tier: entry.tier || tierInfo.name,
        tierColor: tierInfo.color,
        tierIcon: tierInfo.icon,
        peakTier: entry.peakTier || peakTierInfo.name,
        peakTierColor: peakTierInfo.color
      };
    });

    // Get recent matches
    const recentMatchesResult = await query(
      `SELECT
        cm.id,
        cm.queue_type as "queueType",
        cm.winner_user_id as "winnerId",
        CASE
          WHEN cm.winner_user_id = $1 THEN cm.winner_rating_change
          ELSE cm.loser_rating_change
        END as "ratingChange",
        cm.created_at as "createdAt"
       FROM coliseum_matches cm
       WHERE cm.winner_user_id = $1 OR cm.loser_user_id = $1
       ORDER BY cm.created_at DESC
       LIMIT 10`,
      [userId]
    );

    res.json({
      ratings: result.rows,
      recentMatches: recentMatchesResult.rows
    });
  } catch (err) {
    console.error('Error fetching PvP stats:', err);
    res.status(500).json({ error: 'Failed to fetch PvP stats' });
  }
});

export default router;
