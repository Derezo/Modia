/**
 * @module world/stamina
 * @description Stamina management routes - recovery at settlement nodes
 *
 * Key responsibilities:
 * - Stamina restoration for gold (requires Vitality Charm relic)
 * - Settlement node location verification (castle, city, village, keep, palace)
 *
 * @see ../world.js - Main router that composes this module
 */
import express from 'express';
import { query, withTransaction } from '../../config/database.js';
import { authenticate } from '../../middleware/auth.js';
import { staminaRestoreLimiter } from '../../middleware/economyRateLimiter.js';
import { asyncHandler, AppError } from '../../middleware/errorHandler.js';
import * as staminaService from '../../services/staminaService.js';
import { STAMINA_RESTORE_NODE_TYPES } from '../../../../shared/constants.js';

const router = express.Router();


// ============================================================================
// STAMINA ENDPOINTS
// ============================================================================

// POST /api/world/stamina/restore - Restore stamina at a town for gold
router.post('/restore', authenticate, staminaRestoreLimiter, asyncHandler(async (req, res) => {
  const { amount } = req.body;
  const userId = req.user.userId;

  // Improved input validation
  const parsedAmount = parseInt(amount, 10);
  if (isNaN(parsedAmount) || parsedAmount <= 0 || parsedAmount > 100) {
    throw new AppError('amount must be a positive integer (1-100)', 400);
  }

  // Check if user has the Vitality Charm relic
  const relicCheck = await query(
    `SELECT rt.effects FROM user_relics ur
     JOIN relic_templates rt ON rt.id = ur.relic_id
     WHERE ur.user_id = $1 AND rt.key = 'vitality_charm'`,
    [userId]
  );

  if (relicCheck.rows.length === 0) {
    throw new AppError('You need the Vitality Charm to restore stamina for gold', 400);
  }

  const relicEffects = relicCheck.rows[0].effects || {};
  const costPerPoint = relicEffects.cost_per_point || 100;

  // Get user's current location and character
  const charResult = await query(
    `SELECT c.id as character_id, c.current_node_id, wn.node_type
     FROM characters c
     JOIN world_nodes wn ON wn.id = c.current_node_id
     WHERE c.user_id = $1 AND c.party_slot = 1`,
    [userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('No active party character', 400);
  }

  const character = charResult.rows[0];

  // Verify character is at a settlement node (castle, city, village, keep, palace)
  if (!STAMINA_RESTORE_NODE_TYPES.includes(character.node_type)) {
    throw new AppError('Stamina restore is only available at settlement nodes (castles, cities, villages)', 400);
  }

  // Perform stamina restore and logging in a transaction
  const result = await withTransaction(async (client) => {
    // Restore stamina for gold (service handles gold deduction and stamina update)
    const restoreResult = await staminaService.restoreStaminaForGoldWithClient(
      client,
      userId,
      character.character_id,
      parsedAmount,
      costPerPoint
    );

    // Log the stamina restore
    await client.query(
      `INSERT INTO stamina_restore_log (user_id, character_id, node_id, stamina_amount, gold_cost)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, character.character_id, character.current_node_id, restoreResult.staminaRestored, restoreResult.goldSpent]
    );

    return restoreResult;
  });

  res.json({
    success: true,
    message: `Restored ${result.staminaRestored} stamina for ${result.goldSpent} gold`,
    staminaRestored: result.staminaRestored,
    goldSpent: result.goldSpent,
    newGold: result.newGold,
    stamina: result.stamina
  });
}));

export default router;
