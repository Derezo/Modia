/**
 * Debug Service - Business logic for debug/developer tools
 *
 * SECURITY: These functions should only be called from debug routes,
 * which are disabled in production environments.
 */

import { query, pool } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import battleWebsocket from './battleWebsocket.js';
import { COMBAT_NODE_TYPES } from '../config/constants.js';

/**
 * Instantly win a battle for debugging purposes
 * Sets all enemy HP to 0 and processes victory rewards
 *
 * @param {number} battleId - The battle to win
 * @param {number} userId - The user winning the battle
 * @returns {Promise<{gold: number, experience: number, items: Array, enemyCount: number, playerCount: number}>}
 * @throws {AppError} If battle not found, not active, or invalid state
 */
export async function winBattle(battleId, userId) {
  // Get battle with its JSONB state
  const battleResult = await query(
    `SELECT b.id, b.status, b.node_id, b.battle_type, b.battle_state,
            wn.node_type, wn.name as node_name, wn.difficulty_tier
     FROM battles b
     LEFT JOIN world_nodes wn ON wn.id = b.node_id
     WHERE b.id = $1`,
    [battleId]
  );

  if (battleResult.rows.length === 0) {
    throw new AppError('Battle not found', 404);
  }

  const battle = battleResult.rows[0];

  if (battle.status !== 'active') {
    throw new AppError(`Battle is not active (status: ${battle.status})`, 400);
  }

  // Parse battle state from JSONB
  const state = battle.battle_state;
  if (!state || !state.units) {
    throw new AppError('Invalid battle state', 500);
  }

  // Set all enemy HP to 0 in the state
  const enemies = state.units.filter(u => u.type === 'enemy');
  const players = state.units.filter(u => u.type === 'player');

  for (const enemy of enemies) {
    enemy.hp = 0;
  }

  // Calculate simplified rewards based on enemy count and difficulty
  const difficultyTier = battle.difficulty_tier || 1;
  const gold = enemies.length * 20 * difficultyTier;
  const experience = enemies.length * 30 * difficultyTier;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Update battle state and status
    const rewards = { gold, experience, items: [] };
    await client.query(
      `UPDATE battles
       SET battle_state = $1,
           status = 'victory',
           rewards = $2,
           ended_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [JSON.stringify(state), JSON.stringify(rewards), battleId]
    );

    // Award gold to user
    await client.query(
      'UPDATE users SET gold = gold + $1 WHERE id = $2',
      [gold, userId]
    );

    // Award XP to party characters
    const xpPerCharacter = Math.floor(experience / Math.max(players.length, 1));
    await client.query(
      `UPDATE characters
       SET experience = experience + $1
       WHERE party_slot IS NOT NULL AND user_id = $2`,
      [xpPerCharacter, userId]
    );

    // Mark characters as not in battle
    await client.query(
      `UPDATE characters
       SET in_battle = false
       WHERE party_slot IS NOT NULL AND user_id = $1`,
      [userId]
    );

    // Clear the combat node if applicable
    if (battle.node_id && COMBAT_NODE_TYPES.includes(battle.node_type)) {
      await client.query(
        `INSERT INTO user_node_clearance (user_id, node_id, battle_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, node_id) DO NOTHING`,
        [userId, battle.node_id, battleId]
      );
    }

    await client.query('COMMIT');

    // Broadcast battle end via WebSocket
    battleWebsocket.broadcastBattleEnd(battleId, 'victory', rewards);

    console.log(`[DEBUG] Battle ${battleId} won by user ${userId} via debug service`);

    return {
      gold,
      experience,
      items: [],
      enemyCount: enemies.length,
      playerCount: players.length
    };

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
