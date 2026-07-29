/**
 * Debug Service - Business logic for debug/developer tools
 *
 * SECURITY: These functions should only be called from debug routes,
 * which are disabled in production environments.
 */

import { pool } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import battleWebsocket from './battleWebsocket.js';
import { COMBAT_NODE_TYPES } from '../config/constants.js';
import {
  BattleStateLifecycleError,
  BattleStateNotFoundError,
  battleStateRepository
} from './battle/BattleStateRepository.js';

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
  const client = await pool.connect();
  let committedEnvelope;
  let committedRewards;
  let committedUpdate;
  let didCommit = false;
  let enemyCount = 0;
  let playerCount = 0;

  try {
    await client.query('BEGIN');

    const battle = await battleStateRepository.loadBattle(battleId, {
      client,
      forUpdate: true
    });
    const state = structuredClone(battle.state);

    if (!state || !Array.isArray(state.units)) {
      throw new AppError('Invalid battle state', 500);
    }

    const nodeResult = battle.nodeId
      ? await client.query(
        `SELECT node_type, name AS node_name, difficulty_tier
         FROM world_nodes
         WHERE id = $1`,
        [battle.nodeId]
      )
      : { rows: [] };
    const node = nodeResult.rows[0] ?? null;
    const enemies = state.units.filter(unit => unit.type === 'enemy');
    const players = state.units.filter(unit => unit.type === 'player');
    enemyCount = enemies.length;
    playerCount = players.length;

    for (const enemy of enemies) {
      enemy.hp = 0;
    }

    const difficultyTier = node?.difficulty_tier || 1;
    const calculatedRewards = {
      gold: enemies.length * 20 * difficultyTier,
      experience: enemies.length * 30 * difficultyTier,
      items: []
    };
    const rewards = battle.status === 'active'
      ? calculatedRewards
      : (battle.rewards ?? calculatedRewards);
    const commitResult = await battleStateRepository.commitBattleState({
      battleId,
      expectedRevision: battle.stateRevision,
      commandType: 'debug_win_battle',
      idempotencyKey: `debug-win:${battleId}:${userId}`,
      flatState: state,
      lifecycle: {
        status: 'victory',
        winnerId: battle.winnerId,
        rewards,
        endedAt: battle.endedAt ?? new Date().toISOString()
      },
      allowedStatuses: ['active']
    }, { client });

    committedEnvelope = commitResult.envelope
      ?? await battleStateRepository.loadBattle(battleId, { client });
    committedRewards = committedEnvelope.rewards ?? rewards;
    committedUpdate = commitResult.update;
    didCommit = !commitResult.idempotent;

    if (didCommit) {
      await client.query(
        'UPDATE users SET gold = gold + $1 WHERE id = $2',
        [committedRewards.gold, userId]
      );

      const xpPerCharacter = Math.floor(
        committedRewards.experience / Math.max(players.length, 1)
      );
      await client.query(
        `UPDATE characters
         SET experience = experience + $1
         WHERE party_slot IS NOT NULL AND user_id = $2`,
        [xpPerCharacter, userId]
      );

      await client.query(
        `UPDATE characters
         SET in_battle = false
         WHERE party_slot IS NOT NULL AND user_id = $1`,
        [userId]
      );
    }

    if (
      didCommit
      && battle.nodeId
      && COMBAT_NODE_TYPES.includes(node?.node_type)
    ) {
      await client.query(
        `INSERT INTO user_node_clearance (user_id, node_id, battle_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, node_id) DO NOTHING`,
        [userId, battle.nodeId, battleId]
      );
    }

    await client.query('COMMIT');

    if (didCommit) {
      await battleWebsocket.broadcastStateUpdate(battleId, committedUpdate);
      await battleWebsocket.broadcastBattleEnd(battleId, 'victory', committedRewards);
      console.log(`[DEBUG] Battle ${battleId} won by user ${userId} via debug service`);
    }
  } catch (error) {
    await client.query('ROLLBACK');
    if (error instanceof BattleStateNotFoundError) {
      throw new AppError('Battle not found', 404);
    }
    if (error instanceof BattleStateLifecycleError) {
      throw new AppError(
        `Battle is not active (status: ${error.actualStatus ?? 'unknown'})`,
        400
      );
    }
    throw error;
  } finally {
    client.release();
  }

  return {
    gold: committedRewards.gold,
    experience: committedRewards.experience,
    items: committedRewards.items ?? [],
    enemyCount,
    playerCount,
    stateRevision: committedEnvelope.stateRevision
  };
}
