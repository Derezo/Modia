/**
 * @module world/progression
 * @description World progression routes - fast travel to region castles
 *
 * Key responsibilities:
 * - Fast travel destinations listing
 * - Fast travel execution (requires Wayfarer's Compass relic)
 * - Gold-based travel costs
 *
 * @see ../world.js - Main router that composes this module
 */
import express from 'express';
import { query, withTransaction } from '../../config/database.js';
import { authenticate } from '../../middleware/auth.js';
import { fastTravelLimiter } from '../../middleware/economyRateLimiter.js';
import { asyncHandler, AppError } from '../../middleware/errorHandler.js';
import presenceService from '../../services/presenceService.js';
import * as staminaService from '../../services/staminaService.js';

const router = express.Router();

// ============================================================================
// FAST TRAVEL ENDPOINTS
// ============================================================================

// GET /api/world/fast-travel/destinations - Get available fast travel destinations
router.get('/destinations', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  // Check if user has the Wayfarer's Compass relic
  const relicCheck = await query(
    `SELECT 1 FROM user_relics ur
     JOIN relic_templates rt ON rt.id = ur.relic_id
     WHERE ur.user_id = $1 AND rt.key = 'wayfarers_compass'`,
    [userId]
  );

  const hasRelic = relicCheck.rows.length > 0;

  // Get user's current location
  const charResult = await query(
    `SELECT c.current_node_id, wn.region_id as current_region_id
     FROM characters c
     JOIN world_nodes wn ON wn.id = c.current_node_id
     WHERE c.user_id = $1 AND c.party_slot = 1`,
    [userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('No active party character', 400);
  }

  const currentRegionId = charResult.rows[0].current_region_id;

  // Get all region castles as potential destinations
  const castlesResult = await query(
    `SELECT
       wr.id as region_id,
       wr.race as region_race,
       wn.id as node_id,
       wn.name,
       wn.x_coord,
       wn.y_coord
     FROM world_regions wr
     JOIN world_nodes wn ON wn.id = wr.castle_node_id
     ORDER BY wr.id`
  );

  // Calculate costs for each destination
  const baseCost = 100;
  const costPerRegion = 50;

  const destinations = castlesResult.rows.map(castle => {
    const regionDistance = Math.abs(castle.region_id - currentRegionId);
    const cost = baseCost + (regionDistance * costPerRegion);

    return {
      nodeId: castle.node_id,
      name: castle.name,
      regionId: castle.region_id,
      regionRace: castle.region_race,
      x: castle.x_coord,
      y: castle.y_coord,
      cost,
      isCurrentRegion: castle.region_id === currentRegionId
    };
  });

  res.json({
    hasRelic,
    currentRegionId,
    destinations
  });
}));

// POST /api/world/fast-travel - Fast travel to a region castle
router.post('/', authenticate, fastTravelLimiter, asyncHandler(async (req, res) => {
  const { targetNodeId } = req.body;
  const userId = req.user.userId;

  if (!targetNodeId) {
    throw new AppError('targetNodeId is required', 400);
  }

  // Check if user has the Wayfarer's Compass relic
  const relicCheck = await query(
    `SELECT rt.effects FROM user_relics ur
     JOIN relic_templates rt ON rt.id = ur.relic_id
     WHERE ur.user_id = $1 AND rt.key = 'wayfarers_compass'`,
    [userId]
  );

  if (relicCheck.rows.length === 0) {
    throw new AppError('You need the Wayfarer\'s Compass to use fast travel', 400);
  }

  // Verify target is a castle node
  const targetCheck = await query(
    `SELECT wn.id, wn.name, wn.region_id, wr.id as castle_region_id
     FROM world_nodes wn
     JOIN world_regions wr ON wr.castle_node_id = wn.id
     WHERE wn.id = $1`,
    [targetNodeId]
  );

  if (targetCheck.rows.length === 0) {
    throw new AppError('Fast travel is only available to region castles', 400);
  }

  const targetCastle = targetCheck.rows[0];

  // Get user's current position and check if in battle
  const charResult = await query(
    `SELECT c.id as character_id, c.current_node_id, c.name, wn.region_id as current_region_id, c.in_battle
     FROM characters c
     JOIN world_nodes wn ON wn.id = c.current_node_id
     WHERE c.user_id = $1 AND c.party_slot = 1`,
    [userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('No active party character', 400);
  }

  const character = charResult.rows[0];

  if (character.in_battle) {
    throw new AppError('Cannot fast travel while in battle', 400);
  }

  // Already at destination
  if (character.current_node_id === targetNodeId) {
    throw new AppError('Already at destination', 400);
  }

  // Calculate cost
  const baseCost = 100;
  const costPerRegion = 50;
  const regionDistance = Math.abs(targetCastle.castle_region_id - character.current_region_id);
  const goldCost = baseCost + (regionDistance * costPerRegion);

  // Perform all database mutations in a transaction
  const { newGold } = await withTransaction(async (client) => {
    // Check and deduct gold
    const goldResult = await client.query(
      `UPDATE users
       SET gold = gold - $1
       WHERE id = $2 AND gold >= $1
       RETURNING gold`,
      [goldCost, userId]
    );

    if (goldResult.rows.length === 0) {
      const userGold = await client.query('SELECT gold FROM users WHERE id = $1', [userId]);
      const currentGold = userGold.rows[0]?.gold || 0;
      throw new AppError(`Insufficient gold. Need ${goldCost}, have ${currentGold}`, 400);
    }

    // Move all party characters to destination
    await client.query(
      `UPDATE characters SET current_node_id = $1
       WHERE user_id = $2 AND party_slot IS NOT NULL`,
      [targetNodeId, userId]
    );

    // Discover the destination node (if not already discovered)
    await client.query('SELECT discover_node_and_adjacent($1, $2)', [userId, targetNodeId]);

    // Log the fast travel
    await client.query(
      `INSERT INTO fast_travel_log (user_id, character_id, from_node_id, to_node_id, gold_cost)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, character.character_id, character.current_node_id, targetNodeId, goldCost]
    );

    return { newGold: goldResult.rows[0].gold };
  });

  // Update presence (outside transaction - non-critical)
  presenceService.moveNode(
    character.current_node_id,
    targetNodeId,
    userId,
    req.user.username,
    character.name || 'Unknown'
  );

  // Get updated stamina info
  const staminaInfo = await staminaService.getStaminaInfo(character.character_id);

  res.json({
    success: true,
    message: `Traveled to ${targetCastle.name}`,
    goldSpent: goldCost,
    newGold,
    destination: {
      nodeId: targetNodeId,
      name: targetCastle.name,
      regionId: targetCastle.castle_region_id
    },
    stamina: staminaInfo
  });
}));

export default router;
