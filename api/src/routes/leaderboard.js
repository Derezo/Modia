/**
 * Leaderboard Routes - Multi-category game leaderboards
 * Categories: pvp, level, gold, battles
 */

import express from 'express';
import { query } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/leaderboard/:category
 * Get leaderboard for a specific category
 * Categories: pvp, level, gold, battles
 * Query params: time (all|week|today), limit, offset, queue (for pvp only)
 */
router.get('/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const { time = 'all', limit = 50, offset = 0, queue = '1v1' } = req.query;
    const userId = req.user.id;
    const parsedLimit = Math.min(parseInt(limit, 10) || 50, 100);
    const parsedOffset = parseInt(offset, 10) || 0;

    // Validate category
    const validCategories = ['pvp', 'level', 'gold', 'battles'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ error: 'Invalid category. Valid options: pvp, level, gold, battles' });
    }

    let leaderboard;
    let userEntry;
    let total;

    switch (category) {
      case 'pvp':
        ({ leaderboard, userEntry, total } = await getPvPLeaderboard(userId, queue, time, parsedLimit, parsedOffset));
        break;
      case 'level':
        ({ leaderboard, userEntry, total } = await getLevelLeaderboard(userId, time, parsedLimit, parsedOffset));
        break;
      case 'gold':
        ({ leaderboard, userEntry, total } = await getGoldLeaderboard(userId, time, parsedLimit, parsedOffset));
        break;
      case 'battles':
        ({ leaderboard, userEntry, total } = await getBattleLeaderboard(userId, time, parsedLimit, parsedOffset));
        break;
    }

    res.json({
      category,
      timeFilter: time,
      leaderboard,
      userEntry,
      pagination: {
        limit: parsedLimit,
        offset: parsedOffset,
        total,
        hasMore: parsedOffset + parsedLimit < total
      }
    });
  } catch (err) {
    console.error('Error fetching leaderboard:', err);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

/**
 * Get PvP rating leaderboard
 */
async function getPvPLeaderboard(userId, queue, time, limit, offset) {
  const validQueues = ['1v1', '3v3', '5v5'];
  if (!validQueues.includes(queue)) {
    queue = '1v1';
  }

  // Build time filter
  let timeCondition = '';
  if (time === 'week') {
    timeCondition = "AND pr.last_match_at >= NOW() - INTERVAL '7 days'";
  } else if (time === 'today') {
    timeCondition = "AND pr.last_match_at >= NOW() - INTERVAL '1 day'";
  }

  // Get total count
  const countResult = await query(
    `SELECT COUNT(*) as total
     FROM pvp_ratings pr
     WHERE pr.queue_type = $1
       AND (pr.wins > 0 OR pr.losses > 0)
       ${timeCondition}`,
    [queue]
  );
  const total = parseInt(countResult.rows[0]?.total || 0, 10);

  // Get leaderboard page with badge info
  const leaderboardResult = await query(
    `SELECT
      ROW_NUMBER() OVER (ORDER BY pr.rating DESC, pr.wins DESC) as rank,
      pr.user_id as "userId",
      u.username,
      pr.rating as value,
      pr.wins,
      pr.losses,
      pr.win_streak as "winStreak",
      EXISTS(
        SELECT 1 FROM character_perfect_weeks cpw
        JOIN characters c ON c.id = cpw.character_id
        WHERE c.user_id = pr.user_id AND cpw.is_perfect = TRUE
      ) as "hasPerfectWeekBadge",
      (
        SELECT ct.title FROM character_titles ct
        JOIN characters c ON c.id = ct.character_id
        WHERE c.user_id = pr.user_id AND ct.is_active = TRUE
        LIMIT 1
      ) as "equippedTitle"
     FROM pvp_ratings pr
     JOIN users u ON u.id = pr.user_id
     WHERE pr.queue_type = $1
       AND (pr.wins > 0 OR pr.losses > 0)
       ${timeCondition}
     ORDER BY pr.rating DESC, pr.wins DESC
     LIMIT $2 OFFSET $3`,
    [queue, limit, offset]
  );

  // Get user's entry if not in current page
  const userInPage = leaderboardResult.rows.find(r => r.userId === userId);
  let userEntry = null;

  if (!userInPage) {
    const userResult = await query(
      `WITH ranked AS (
        SELECT
          pr.user_id,
          u.username,
          pr.rating,
          pr.wins,
          pr.losses,
          pr.win_streak,
          ROW_NUMBER() OVER (ORDER BY pr.rating DESC, pr.wins DESC) as rank
        FROM pvp_ratings pr
        JOIN users u ON u.id = pr.user_id
        WHERE pr.queue_type = $1
          AND (pr.wins > 0 OR pr.losses > 0)
          ${timeCondition}
      )
      SELECT rank, user_id as "userId", username, rating as value, wins, losses, win_streak as "winStreak"
      FROM ranked
      WHERE user_id = $2`,
      [queue, userId]
    );

    if (userResult.rows.length > 0) {
      userEntry = userResult.rows[0];
      userEntry.rank = parseInt(userEntry.rank, 10);
    }
  }

  return {
    leaderboard: leaderboardResult.rows.map(r => ({
      ...r,
      rank: parseInt(r.rank, 10)
    })),
    userEntry,
    total
  };
}

/**
 * Get character level leaderboard (highest level character per user)
 */
async function getLevelLeaderboard(userId, time, limit, offset) {
  // Build time filter
  let timeCondition = '';
  if (time === 'week') {
    timeCondition = "AND c.created_at >= NOW() - INTERVAL '7 days'";
  } else if (time === 'today') {
    timeCondition = "AND c.created_at >= NOW() - INTERVAL '1 day'";
  }

  // Get total unique users with characters
  const countResult = await query(
    `SELECT COUNT(DISTINCT user_id) as total
     FROM characters
     WHERE 1=1 ${timeCondition}`
  );
  const total = parseInt(countResult.rows[0]?.total || 0, 10);

  // Get leaderboard - max level per user with badge info
  const leaderboardResult = await query(
    `WITH user_max_level AS (
      SELECT
        c.user_id,
        MAX(c.level) as max_level,
        MAX(c.experience) as max_exp
      FROM characters c
      WHERE 1=1 ${timeCondition}
      GROUP BY c.user_id
    )
    SELECT
      ROW_NUMBER() OVER (ORDER BY uml.max_level DESC, uml.max_exp DESC) as rank,
      uml.user_id as "userId",
      u.username,
      uml.max_level as value,
      uml.max_exp as experience,
      EXISTS(
        SELECT 1 FROM character_perfect_weeks cpw
        JOIN characters ch ON ch.id = cpw.character_id
        WHERE ch.user_id = uml.user_id AND cpw.is_perfect = TRUE
      ) as "hasPerfectWeekBadge",
      (
        SELECT ct.title FROM character_titles ct
        JOIN characters ch ON ch.id = ct.character_id
        WHERE ch.user_id = uml.user_id AND ct.is_active = TRUE
        LIMIT 1
      ) as "equippedTitle"
    FROM user_max_level uml
    JOIN users u ON u.id = uml.user_id
    ORDER BY uml.max_level DESC, uml.max_exp DESC
    LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  // Get user's entry
  const userInPage = leaderboardResult.rows.find(r => r.userId === userId);
  let userEntry = null;

  if (!userInPage) {
    const userResult = await query(
      `WITH user_max_level AS (
        SELECT
          c.user_id,
          MAX(c.level) as max_level,
          MAX(c.experience) as max_exp
        FROM characters c
        WHERE 1=1 ${timeCondition}
        GROUP BY c.user_id
      ),
      ranked AS (
        SELECT
          uml.user_id,
          u.username,
          uml.max_level,
          uml.max_exp,
          ROW_NUMBER() OVER (ORDER BY uml.max_level DESC, uml.max_exp DESC) as rank
        FROM user_max_level uml
        JOIN users u ON u.id = uml.user_id
      )
      SELECT rank, user_id as "userId", username, max_level as value, max_exp as experience
      FROM ranked
      WHERE user_id = $1`,
      [userId]
    );

    if (userResult.rows.length > 0) {
      userEntry = userResult.rows[0];
      userEntry.rank = parseInt(userEntry.rank, 10);
    }
  }

  return {
    leaderboard: leaderboardResult.rows.map(r => ({
      ...r,
      rank: parseInt(r.rank, 10)
    })),
    userEntry,
    total
  };
}

/**
 * Get gold leaderboard
 */
async function getGoldLeaderboard(userId, time, limit, offset) {
  // Build time filter (based on account creation for new wealth)
  let timeCondition = '';
  if (time === 'week') {
    timeCondition = "WHERE u.created_at >= NOW() - INTERVAL '7 days'";
  } else if (time === 'today') {
    timeCondition = "WHERE u.created_at >= NOW() - INTERVAL '1 day'";
  } else {
    timeCondition = 'WHERE 1=1';
  }

  // Get total
  const countResult = await query(
    `SELECT COUNT(*) as total FROM users u ${timeCondition} AND u.gold > 0`
  );
  const total = parseInt(countResult.rows[0]?.total || 0, 10);

  // Get leaderboard with badge info
  const leaderboardResult = await query(
    `SELECT
      ROW_NUMBER() OVER (ORDER BY u.gold DESC) as rank,
      u.id as "userId",
      u.username,
      u.gold as value,
      EXISTS(
        SELECT 1 FROM character_perfect_weeks cpw
        JOIN characters c ON c.id = cpw.character_id
        WHERE c.user_id = u.id AND cpw.is_perfect = TRUE
      ) as "hasPerfectWeekBadge",
      (
        SELECT ct.title FROM character_titles ct
        JOIN characters c ON c.id = ct.character_id
        WHERE c.user_id = u.id AND ct.is_active = TRUE
        LIMIT 1
      ) as "equippedTitle"
    FROM users u
    ${timeCondition} AND u.gold > 0
    ORDER BY u.gold DESC
    LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  // Get user's entry
  const userInPage = leaderboardResult.rows.find(r => r.userId === userId);
  let userEntry = null;

  if (!userInPage) {
    const userResult = await query(
      `WITH ranked AS (
        SELECT
          u.id,
          u.username,
          u.gold,
          ROW_NUMBER() OVER (ORDER BY u.gold DESC) as rank
        FROM users u
        ${timeCondition} AND u.gold > 0
      )
      SELECT rank, id as "userId", username, gold as value
      FROM ranked
      WHERE id = $1`,
      [userId]
    );

    if (userResult.rows.length > 0) {
      userEntry = userResult.rows[0];
      userEntry.rank = parseInt(userEntry.rank, 10);
    }
  }

  return {
    leaderboard: leaderboardResult.rows.map(r => ({
      ...r,
      rank: parseInt(r.rank, 10)
    })),
    userEntry,
    total
  };
}

/**
 * Get battle wins leaderboard (PvE battles won)
 */
async function getBattleLeaderboard(userId, time, limit, offset) {
  // Build time filter
  let timeCondition = '';
  if (time === 'week') {
    timeCondition = "AND b.ended_at >= NOW() - INTERVAL '7 days'";
  } else if (time === 'today') {
    timeCondition = "AND b.ended_at >= NOW() - INTERVAL '1 day'";
  }

  // Count users with victories
  const countResult = await query(
    `SELECT COUNT(DISTINCT b.user_id) as total
     FROM battles b
     WHERE b.status = 'victory'
       AND b.battle_type = 'pve'
       ${timeCondition}`
  );
  const total = parseInt(countResult.rows[0]?.total || 0, 10);

  // Get leaderboard with badge info
  const leaderboardResult = await query(
    `WITH battle_stats AS (
      SELECT
        b.user_id,
        COUNT(*) as wins
      FROM battles b
      WHERE b.status = 'victory'
        AND b.battle_type = 'pve'
        ${timeCondition}
      GROUP BY b.user_id
    )
    SELECT
      ROW_NUMBER() OVER (ORDER BY bs.wins DESC) as rank,
      bs.user_id as "userId",
      u.username,
      bs.wins as value,
      EXISTS(
        SELECT 1 FROM character_perfect_weeks cpw
        JOIN characters c ON c.id = cpw.character_id
        WHERE c.user_id = bs.user_id AND cpw.is_perfect = TRUE
      ) as "hasPerfectWeekBadge",
      (
        SELECT ct.title FROM character_titles ct
        JOIN characters c ON c.id = ct.character_id
        WHERE c.user_id = bs.user_id AND ct.is_active = TRUE
        LIMIT 1
      ) as "equippedTitle"
    FROM battle_stats bs
    JOIN users u ON u.id = bs.user_id
    ORDER BY bs.wins DESC
    LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  // Get user's entry
  const userInPage = leaderboardResult.rows.find(r => r.userId === userId);
  let userEntry = null;

  if (!userInPage) {
    const userResult = await query(
      `WITH battle_stats AS (
        SELECT
          b.user_id,
          COUNT(*) as wins
        FROM battles b
        WHERE b.status = 'victory'
          AND b.battle_type = 'pve'
          ${timeCondition}
        GROUP BY b.user_id
      ),
      ranked AS (
        SELECT
          bs.user_id,
          u.username,
          bs.wins,
          ROW_NUMBER() OVER (ORDER BY bs.wins DESC) as rank
        FROM battle_stats bs
        JOIN users u ON u.id = bs.user_id
      )
      SELECT rank, user_id as "userId", username, wins as value
      FROM ranked
      WHERE user_id = $1`,
      [userId]
    );

    if (userResult.rows.length > 0) {
      userEntry = userResult.rows[0];
      userEntry.rank = parseInt(userEntry.rank, 10);
    }
  }

  return {
    leaderboard: leaderboardResult.rows.map(r => ({
      ...r,
      rank: parseInt(r.rank, 10)
    })),
    userEntry,
    total
  };
}

export default router;
