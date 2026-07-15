/**
 * @module coliseum/statistics
 * @description Leaderboard and match history functions for the coliseum system.
 *
 * Key responsibilities:
 * - Capturing team snapshots for match records
 * - Calculating match statistics from battle state
 * - Leaderboard queries and ranking
 * - Match history retrieval
 */

import { query } from '../../config/database.js';
import { MAX_BATTLE_PARTY_SIZE } from '../../config/constants.js';

/**
 * Capture team snapshots for match history
 * @param {number} winnerId - Winner user ID
 * @param {number} loserId - Loser user ID
 * @returns {Promise<Object>} Team snapshots
 */
export async function captureTeamSnapshots(winnerId, loserId) {
  const captureTeam = async (userId) => {
    const chars = await query(
      `SELECT
         c.id, c.name, c.class, c.race, c.level, c.party_slot,
         c.strength, c.vitality, c.agility, c.intelligence, c.luck,
         c.hp_current, c.hp_max, c.mp_current, c.mp_max
       FROM characters c
       WHERE c.user_id = $1 AND c.party_slot IS NOT NULL AND c.party_slot <= $2
       ORDER BY c.party_slot`,
      [userId, MAX_BATTLE_PARTY_SIZE]
    );

    // Get equipment for each character
    const team = await Promise.all(chars.rows.map(async (char) => {
      const equip = await query(
        `SELECT ci.equipped_slot, ci.modifications,
                it.name, it.rarity, it.item_type, it.equipment_slot, it.sprite_id
         FROM character_items ci
         JOIN item_templates it ON ci.item_template_id = it.id
         WHERE ci.character_id = $1 AND ci.equipped_slot IS NOT NULL`,
        [char.id]
      );

      return {
        ...char,
        equipment: equip.rows.map((item) => {
          const modifications = item.modifications || {};
          return {
            ...item,
            name: modifications.generatedName || item.name,
            rarity: modifications.rarity || item.rarity,
            augments: modifications.augments || []
          };
        })
      };
    }));

    return team;
  };

  const [winnerTeam, loserTeam] = await Promise.all([
    captureTeam(winnerId),
    captureTeam(loserId)
  ]);

  return {
    winner: { userId: winnerId, team: winnerTeam },
    loser: { userId: loserId, team: loserTeam }
  };
}

/**
 * Calculate match statistics from battle state
 * @param {number} battleId - Battle ID
 * @returns {Promise<Object>} Match statistics
 */
export async function calculateMatchStats(battleId) {
  const result = await query(
    'SELECT battle_state, started_at FROM battles WHERE id = $1',
    [battleId]
  );

  if (result.rows.length === 0) return null;

  const { battle_state, started_at } = result.rows[0];
  const state = battle_state;

  // Calculate stats from battle log
  const stats = {
    totalTurns: state.turn || 0,
    duration: Math.floor((Date.now() - new Date(started_at).getTime()) / 1000),
    player1: { damageDealt: 0, healingDone: 0, unitsLost: 0 },
    player2: { damageDealt: 0, healingDone: 0, unitsLost: 0 }
  };

  // Count units lost
  for (const unit of state.units) {
    if (unit.hp <= 0) {
      if (unit.ownerId === state.player1Id) {
        stats.player1.unitsLost++;
      } else if (unit.ownerId === state.player2Id) {
        stats.player2.unitsLost++;
      }
    }
  }

  // Parse battle log for damage/healing (if available)
  if (state.log) {
    for (const entry of state.log) {
      if (entry.damage) {
        // Determine which player dealt damage
        const actor = state.units.find(u => u.id === entry.actorId);
        if (actor?.ownerId === state.player1Id) {
          stats.player1.damageDealt += entry.damage;
        } else if (actor?.ownerId === state.player2Id) {
          stats.player2.damageDealt += entry.damage;
        }
      }
      if (entry.healing) {
        const actor = state.units.find(u => u.id === entry.actorId);
        if (actor?.ownerId === state.player1Id) {
          stats.player1.healingDone += entry.healing;
        } else if (actor?.ownerId === state.player2Id) {
          stats.player2.healingDone += entry.healing;
        }
      }
    }
  }

  return stats;
}

/**
 * Get leaderboard for a queue type
 * @param {string} queueType - Queue type (1v1, 3v3, 5v5)
 * @param {number} limit - Number of entries to return
 * @returns {Promise<Array>} Leaderboard entries
 */
export async function getLeaderboard(queueType = '1v1', limit = 100) {
  const result = await query(
    `SELECT
       pr.user_id,
       u.username,
       pr.rating,
       pr.peak_rating,
       pr.wins,
       pr.losses,
       pr.draws,
       pr.win_streak,
       pr.best_win_streak,
       pr.last_match_at,
       ROW_NUMBER() OVER (ORDER BY pr.rating DESC) as rank
     FROM pvp_ratings pr
     JOIN users u ON pr.user_id = u.id
     WHERE pr.queue_type = $1 AND (pr.wins + pr.losses) > 0
     ORDER BY pr.rating DESC
     LIMIT $2`,
    [queueType, limit]
  );

  return result.rows;
}

/**
 * Get match history
 * @param {string} filter - 'all' for global, 'mine' for user's matches
 * @param {number} userId - User ID (required if filter is 'mine')
 * @param {number} limit - Number of matches to return
 * @param {number} offset - Offset for pagination
 * @returns {Promise<Array>} Match history
 */
export async function getMatchHistory(filter = 'all', userId = null, limit = 50, offset = 0) {
  let queryStr;
  let params;

  if (filter === 'mine' && userId) {
    queryStr = `
      SELECT
        cm.id,
        cm.battle_id,
        cm.queue_type,
        cm.winner_user_id,
        cm.loser_user_id,
        winner.username as winner_username,
        loser.username as loser_username,
        cm.winner_rating_change,
        cm.loser_rating_change,
        cm.match_duration_seconds,
        cm.created_at
      FROM coliseum_matches cm
      JOIN users winner ON cm.winner_user_id = winner.id
      JOIN users loser ON cm.loser_user_id = loser.id
      WHERE cm.winner_user_id = $1 OR cm.loser_user_id = $1
      ORDER BY cm.created_at DESC
      LIMIT $2 OFFSET $3`;
    params = [userId, limit, offset];
  } else {
    queryStr = `
      SELECT
        cm.id,
        cm.battle_id,
        cm.queue_type,
        cm.winner_user_id,
        cm.loser_user_id,
        winner.username as winner_username,
        loser.username as loser_username,
        cm.winner_rating_change,
        cm.loser_rating_change,
        cm.match_duration_seconds,
        cm.created_at
      FROM coliseum_matches cm
      JOIN users winner ON cm.winner_user_id = winner.id
      JOIN users loser ON cm.loser_user_id = loser.id
      ORDER BY cm.created_at DESC
      LIMIT $1 OFFSET $2`;
    params = [limit, offset];
  }

  const result = await query(queryStr, params);
  return result.rows;
}

/**
 * Get detailed match information
 * @param {number} matchId - Coliseum match ID
 * @returns {Promise<Object>} Match details with snapshots and stats
 */
export async function getMatchDetails(matchId) {
  const result = await query(
    `SELECT
       cm.*,
       winner.username as winner_username,
       loser.username as loser_username
     FROM coliseum_matches cm
     JOIN users winner ON cm.winner_user_id = winner.id
     JOIN users loser ON cm.loser_user_id = loser.id
     WHERE cm.id = $1`,
    [matchId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

/**
 * Calculate enhanced per-unit match statistics from battle state
 * @param {number} battleId - Battle ID
 * @returns {Promise<Object|null>} Enhanced match statistics with per-unit breakdown
 */
export async function calculateEnhancedMatchStats(battleId) {
  const result = await query(
    'SELECT battle_state, started_at FROM battles WHERE id = $1',
    [battleId]
  );

  if (result.rows.length === 0) return null;

  const { battle_state: state, started_at } = result.rows[0];

  if (!state || !state.units) return null;

  // Build unit stats map for O(1) lookup
  // Use unit's tracked stats as fallback (handles surrender before combat)
  const unitStatsMap = new Map();

  for (const unit of state.units) {
    unitStatsMap.set(unit.id, {
      id: unit.id,
      name: unit.name,
      class: unit.class,
      race: unit.race,
      level: unit.level,
      teamId: unit.teamId,
      ownerId: unit.ownerId,
      type: unit.type || 'player',
      // Fallback to unit's tracked values for surrender scenarios
      damageDealt: unit.damageDealt || 0,
      damageTaken: unit.damageTaken || 0,
      healingDone: unit.healingDone || 0,
      kills: unit.kills || 0,
      deaths: unit.hp <= 0 ? 1 : 0,
      survivedWith: Math.max(0, unit.hp)
    });
  }

  // Track which units have pre-tracked stats (from battle state) vs need log accumulation
  const hasPreTrackedDamageDealt = new Set();
  const hasPreTrackedDamageTaken = new Set();
  const hasPreTrackedHealingDone = new Set();
  const hasPreTrackedKills = new Set();

  for (const unit of state.units) {
    if (unit.damageDealt) hasPreTrackedDamageDealt.add(unit.id);
    if (unit.damageTaken) hasPreTrackedDamageTaken.add(unit.id);
    if (unit.healingDone) hasPreTrackedHealingDone.add(unit.id);
    if (unit.kills) hasPreTrackedKills.add(unit.id);
  }

  // Parse battle log for damage/healing/kills (only for units without pre-tracked stats)
  if (state.log && Array.isArray(state.log)) {
    for (const entry of state.log) {
      const actorId = entry.actorId;
      const targetId = entry.targetId;

      // Check for damage at both nesting levels
      const damage = entry.damage ?? entry.result?.damage ?? 0;
      if (damage > 0) {
        const actorStats = unitStatsMap.get(actorId);
        if (actorStats && !hasPreTrackedDamageDealt.has(actorId)) {
          actorStats.damageDealt += damage;
        }
        const targetStats = unitStatsMap.get(targetId);
        if (targetStats && !hasPreTrackedDamageTaken.has(targetId)) {
          targetStats.damageTaken += damage;
        }
      }

      // Check for healing at both nesting levels
      const healing = entry.healing ?? entry.result?.healing ?? 0;
      if (healing > 0) {
        const actorStats = unitStatsMap.get(actorId);
        if (actorStats && !hasPreTrackedHealingDone.has(actorId)) {
          actorStats.healingDone += healing;
        }
      }

      // Check for kills at both nesting levels
      const targetDefeated = entry.targetDefeated ?? entry.result?.targetDefeated ?? false;
      if (targetDefeated) {
        const actorStats = unitStatsMap.get(actorId);
        if (actorStats && !hasPreTrackedKills.has(actorId)) {
          actorStats.kills += 1;
        }
      }
    }
  }

  // Get usernames for all owners
  const ownerIds = [...new Set(state.units.map(u => u.ownerId).filter(Boolean))];
  if (ownerIds.length > 0) {
    const usersResult = await query(
      'SELECT id, username FROM users WHERE id = ANY($1)',
      [ownerIds]
    );
    const usernameMap = new Map(usersResult.rows.map(u => [u.id, u.username]));

    // Add ownerUsername to each unit stats
    for (const stats of unitStatsMap.values()) {
      stats.ownerUsername = usernameMap.get(stats.ownerId) || null;
    }
  }

  // Convert map to array for return value
  const unitStats = Array.from(unitStatsMap.values());

  return {
    unitStats,
    battleSummary: {
      totalTurns: state.turn || 0,
      durationSeconds: Math.floor((Date.now() - new Date(started_at).getTime()) / 1000)
    }
  };
}

/**
 * Get a player's rank in the leaderboard
 * @param {number} userId - User ID
 * @param {string} queueType - Queue type
 * @returns {Promise<Object>} Player's rank and rating info
 */
export async function getPlayerRank(userId, queueType = '1v1') {
  const result = await query(
    `SELECT
       user_id,
       rating,
       wins,
       losses,
       (SELECT COUNT(*) + 1 FROM pvp_ratings
        WHERE queue_type = $2 AND rating > pr.rating) as rank
     FROM pvp_ratings pr
     WHERE user_id = $1 AND queue_type = $2`,
    [userId, queueType]
  );

  if (result.rows.length === 0) {
    return { rank: null, rating: 1000, wins: 0, losses: 0 };
  }

  return result.rows[0];
}
