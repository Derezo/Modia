/**
 * Ruins Routes - Ancient puzzle challenges
 *
 * Ruins nodes contain sliding tile puzzles that reward gold and items.
 * Each ruins can only be solved once per player.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { pool } from '../config/database.js';
import { SeededRandom } from '../../../shared/constants.js';
import { MAX_GOLD } from '../config/constants.js';
import * as dailyQuestService from '../services/dailyQuestService.js';
import { ruinsSolveLimiter } from '../middleware/economyRateLimiter.js';

const router = Router();

// Puzzle configuration by tier
const PUZZLE_CONFIG = {
  1: { gridSize: 3, minMoves: 8, parMoves: 15 },
  2: { gridSize: 4, minMoves: 15, parMoves: 30 },
  3: { gridSize: 5, minMoves: 30, parMoves: 50 }
};

// Rewards by tier
const TIER_REWARDS = {
  1: { goldMin: 50, goldMax: 100, parBonus: 0.25 },
  2: { goldMin: 150, goldMax: 300, parBonus: 0.25 },
  3: { goldMin: 400, goldMax: 800, parBonus: 0.25 }
};

// Puzzle image themes by region race
const PUZZLE_THEMES = {
  human: { name: 'Royal Crest', description: 'The ancient seal of the kingdom' },
  elf: { name: 'Tree of Life', description: 'Sacred symbol of the forest realm' },
  dwarf: { name: 'Forge Rune', description: 'Ancient dwarven crafting sigil' },
  orc: { name: 'War Banner', description: 'Symbol of orcish might' },
  vampire: { name: 'Blood Moon', description: 'Dark emblem of the night' }
};

/**
 * Generate a solvable shuffled puzzle state
 * @param {number} gridSize - Size of grid (3, 4, or 5)
 * @param {SeededRandom} rng - Seeded random for deterministic shuffle
 * @returns {number[]} Array of tile positions (0 = empty space)
 */
function generateShuffledPuzzle(gridSize, rng) {
  const totalTiles = gridSize * gridSize;
  // Start with solved state: [1, 2, 3, ..., n-1, 0] where 0 is empty
  const tiles = Array.from({ length: totalTiles - 1 }, (_, i) => i + 1);
  tiles.push(0); // Empty space at the end (bottom-right)

  // Shuffle by making random valid moves (guarantees solvability)
  let emptyIndex = totalTiles - 1;
  const numShuffles = gridSize * gridSize * 20; // More shuffles = harder

  for (let i = 0; i < numShuffles; i++) {
    const validMoves = getValidMoves(emptyIndex, gridSize);
    const moveIndex = validMoves[Math.floor(rng.next() * validMoves.length)];

    // Swap empty with adjacent tile
    tiles[emptyIndex] = tiles[moveIndex];
    tiles[moveIndex] = 0;
    emptyIndex = moveIndex;
  }

  return tiles;
}

/**
 * Get valid adjacent positions for the empty tile
 * @param {number} emptyIndex - Current empty position
 * @param {number} gridSize - Size of grid
 * @returns {number[]} Array of valid adjacent indices
 */
function getValidMoves(emptyIndex, gridSize) {
  const moves = [];
  const row = Math.floor(emptyIndex / gridSize);
  const col = emptyIndex % gridSize;

  // Up
  if (row > 0) moves.push(emptyIndex - gridSize);
  // Down
  if (row < gridSize - 1) moves.push(emptyIndex + gridSize);
  // Left
  if (col > 0) moves.push(emptyIndex - 1);
  // Right
  if (col < gridSize - 1) moves.push(emptyIndex + 1);

  return moves;
}

/**
 * Check if puzzle is solved
 * @param {number[]} tiles - Current tile positions
 * @returns {boolean}
 */
function _isPuzzleSolved(tiles) {
  for (let i = 0; i < tiles.length - 1; i++) {
    if (tiles[i] !== i + 1) return false;
  }
  return tiles[tiles.length - 1] === 0;
}

/**
 * GET /ruins/:nodeId/puzzle
 * Returns puzzle configuration and completion status
 */
router.get('/:nodeId/puzzle', authenticate, async (req, res) => {
  const { nodeId } = req.params;
  const userId = req.user.userId;

  try {
    // Get ruins node data
    const nodeResult = await pool.query(`
      SELECT
        id,
        name,
        node_type,
        ruins_puzzle_type,
        ruins_reward_tier,
        region_race
      FROM world_nodes
      WHERE id = $1
    `, [nodeId]);

    if (nodeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Node not found' });
    }

    const node = nodeResult.rows[0];

    if (node.node_type !== 'ruins') {
      return res.status(400).json({ error: 'This node is not a ruins' });
    }

    // Check completion status
    const completionResult = await pool.query(`
      SELECT puzzle_solved, reward_claimed, completed_at
      FROM user_ruins_completions
      WHERE user_id = $1 AND node_id = $2
    `, [userId, nodeId]);

    const completion = completionResult.rows[0] || null;
    const isCompleted = completion?.puzzle_solved || false;

    // Get puzzle tier (default to 1 if not set)
    const tier = node.ruins_reward_tier || 1;
    const config = PUZZLE_CONFIG[tier] || PUZZLE_CONFIG[1];
    const rewards = TIER_REWARDS[tier] || TIER_REWARDS[1];

    // Get theme based on region race
    const race = node.region_race || 'human';
    const theme = PUZZLE_THEMES[race] || PUZZLE_THEMES.human;

    // Generate deterministic puzzle based on node ID
    const rng = new SeededRandom(node.id * 12345);
    const puzzleState = isCompleted ? null : generateShuffledPuzzle(config.gridSize, rng);

    // Calculate potential reward
    const goldReward = Math.floor(rng.next() * (rewards.goldMax - rewards.goldMin + 1)) + rewards.goldMin;

    res.json({
      nodeId: node.id,
      nodeName: node.name,
      tier,
      gridSize: config.gridSize,
      parMoves: config.parMoves,
      theme: {
        name: theme.name,
        description: theme.description,
        race
      },
      puzzleState, // Array of tile positions (null if completed)
      isCompleted,
      completedAt: completion?.completed_at || null,
      rewards: {
        gold: goldReward,
        parBonus: `+${rewards.parBonus * 100}% gold for under-par completion`
      }
    });
  } catch (err) {
    console.error('Error fetching ruins puzzle:', err);
    res.status(500).json({ error: 'Failed to fetch puzzle' });
  }
});

/**
 * POST /ruins/:nodeId/solve
 * Submit puzzle solution and claim rewards
 */
router.post('/:nodeId/solve', authenticate, ruinsSolveLimiter, async (req, res) => {
  const { nodeId } = req.params;
  const { moveCount } = req.body;
  const userId = req.user.userId;

  if (typeof moveCount !== 'number' || moveCount < 1) {
    return res.status(400).json({ error: 'Invalid move count' });
  }

  // Validate minimum moves based on grid size to prevent instant completion
  const nodeIdNum = parseInt(nodeId, 10);
  if (isNaN(nodeIdNum)) {
    return res.status(400).json({ error: 'Invalid node ID' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get ruins node data
    const nodeResult = await client.query(`
      SELECT
        wn.id,
        wn.name,
        wn.node_type,
        wn.ruins_reward_tier
      FROM world_nodes wn
      WHERE wn.id = $1
    `, [nodeId]);

    if (nodeResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Node not found' });
    }

    const node = nodeResult.rows[0];

    if (node.node_type !== 'ruins') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This node is not a ruins' });
    }

    // Get tier config for validation
    const tier = node.ruins_reward_tier || 1;
    const rewards = TIER_REWARDS[tier] || TIER_REWARDS[1];
    const config = PUZZLE_CONFIG[tier] || PUZZLE_CONFIG[1];

    // Validate minimum moves (prevent instant completion exploits)
    if (moveCount < config.minMoves) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Invalid solution: ${config.gridSize}x${config.gridSize} puzzle requires at least ${config.minMoves} moves`
      });
    }

    // Check if already completed with FOR UPDATE to prevent race conditions
    const completionResult = await client.query(`
      SELECT puzzle_solved FROM user_ruins_completions
      WHERE user_id = $1 AND node_id = $2
      FOR UPDATE
    `, [userId, nodeId]);

    if (completionResult.rows.length > 0 && completionResult.rows[0].puzzle_solved) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This ruins has already been solved' });
    }

    // Deterministic gold amount based on node ID
    const rng = new SeededRandom(node.id * 12345);
    let goldReward = Math.floor(rng.next() * (rewards.goldMax - rewards.goldMin + 1)) + rewards.goldMin;

    // Apply par bonus if completed under par
    const underPar = moveCount <= config.parMoves;
    if (underPar) {
      goldReward = Math.floor(goldReward * (1 + rewards.parBonus));
    }

    // Record completion
    await client.query(`
      INSERT INTO user_ruins_completions (user_id, node_id, puzzle_solved, reward_claimed, completed_at)
      VALUES ($1, $2, true, true, NOW())
      ON CONFLICT (user_id, node_id)
      DO UPDATE SET puzzle_solved = true, reward_claimed = true, completed_at = NOW()
    `, [userId, nodeId]);

    // Award gold to user (capped at MAX_GOLD to prevent overflow)
    await client.query(`
      UPDATE users SET gold = LEAST(gold + $1, $2) WHERE id = $3
    `, [goldReward, MAX_GOLD, userId]);

    // Get updated gold
    const userResult = await client.query(`
      SELECT gold FROM users WHERE id = $1
    `, [userId]);

    await client.query('COMMIT');

    // Daily/Weekly quest progress hooks (fire-and-forget pattern)
    // Get party leader character ID for quest tracking
    pool.query('SELECT id FROM characters WHERE user_id = $1 AND party_slot = 1', [userId])
      .then(charResult => {
        const characterId = charResult.rows[0]?.id;
        if (characterId) {
          // Track puzzle completion
          dailyQuestService.updateProgress(characterId, 'puzzle_solves', 1, {
            tier
          }).catch(err => console.warn('[Quest] puzzle_solves progress failed:', err.message));

          // Track gold earned
          if (goldReward > 0) {
            dailyQuestService.updateProgress(characterId, 'gold_earned', goldReward, {})
              .catch(err => console.warn('[Quest] gold_earned progress failed:', err.message));
          }
        }
      })
      .catch(err => console.warn('[Quest] Failed to get characterId for ruins:', err.message));

    res.json({
      success: true,
      message: `Ancient puzzle solved! You found ${goldReward} gold${underPar ? ' (par bonus!)' : ''}.`,
      rewards: {
        gold: goldReward,
        underPar
      },
      newGold: userResult.rows[0].gold
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error solving ruins puzzle:', err);
    res.status(500).json({ error: 'Failed to process solution' });
  } finally {
    client.release();
  }
});

/**
 * GET /ruins/completions
 * Get all ruins completions for the current user
 */
router.get('/completions', authenticate, async (req, res) => {
  const userId = req.user.userId;

  try {
    const result = await pool.query(`
      SELECT
        urc.node_id,
        wn.name as node_name,
        urc.completed_at
      FROM user_ruins_completions urc
      JOIN world_nodes wn ON urc.node_id = wn.id
      WHERE urc.user_id = $1 AND urc.puzzle_solved = true
      ORDER BY urc.completed_at DESC
    `, [userId]);

    res.json({
      completions: result.rows,
      totalCompleted: result.rows.length
    });
  } catch (err) {
    console.error('Error fetching ruins completions:', err);
    res.status(500).json({ error: 'Failed to fetch completions' });
  }
});

export default router;
