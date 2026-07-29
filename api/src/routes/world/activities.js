/**
 * @module world/activities
 * @description World activity routes - shrines, chests, discoveries, watchtowers
 *
 * Key responsibilities:
 * - Chest claiming (one-time loot)
 * - Shrine buffs (cooldown-based)
 * - Discovery content unlocking
 * - Watchtower extended views
 * - Zodiac crystal collection
 *
 * @see ../world.js - Main router that composes this module
 */
import express from 'express';
import { query, withTransaction } from '../../config/database.js';
import { authenticate } from '../../middleware/auth.js';
import {
  chestClaimLimiter,
  shrineLimiter,
  discoveryLimiter
} from '../../middleware/economyRateLimiter.js';
import { asyncHandler, AppError } from '../../middleware/errorHandler.js';
import {
  SHRINE_BUFFS,
  SHRINE_COOLDOWN_HOURS,
  ZODIAC_SHRINE_BUFFS,
  ZODIAC_CRYSTALS,
  ZODIAC_COLLECTION_BONUS
} from '../../../../shared/constants.js';
import { generateChestLoot, addItemsToInventory } from '../../services/world/chestLootService.js';
import { getLoreContent } from '../../../../shared/loreContent.js';

const router = express.Router();

// Maximum gold value to prevent integer overflow
const MAX_GOLD = 2147483647;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Verify user is physically at a node
 * @param {number} userId - User ID
 * @param {number} nodeId - Node ID to check
 * @returns {Promise<boolean>} True if user is at the node
 */
async function verifyUserAtNode(userId, nodeId) {
  const result = await query(
    `SELECT 1 FROM characters
     WHERE user_id = $1 AND party_slot = 1 AND current_node_id = $2`,
    [userId, nodeId]
  );
  return result.rows.length > 0;
}

/**
 * Read the response-safe representation of a previously committed chest claim.
 * @param {Object} client - Database client or transaction
 * @param {number} userId
 * @param {number} nodeId
 * @returns {Promise<Object|null>}
 */
async function getPersistedChestClaim(client, userId, nodeId) {
  const result = await client.query(
    `SELECT ucc.gold_awarded, ucc.items_awarded, u.gold AS new_gold_balance
     FROM user_chest_claims ucc
     JOIN users u ON u.id = ucc.user_id
     WHERE ucc.user_id = $1 AND ucc.node_id = $2`,
    [userId, nodeId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const claim = result.rows[0];
  return {
    alreadyClaimed: true,
    goldAwarded: claim.gold_awarded,
    itemsAwarded: claim.items_awarded,
    newGoldBalance: claim.new_gold_balance
  };
}

// ============================================================================
// CHEST ENDPOINTS
// ============================================================================

// POST /api/world/nodes/:id/claim-chest - Claim one-time chest loot
router.post('/nodes/:id/claim-chest', authenticate, chestClaimLimiter, asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const nodeId = parseInt(req.params.id, 10);

  // Use one transaction to serialize location changes, claim the chest, and
  // award its loot. A retry after a lost response returns the persisted claim
  // without awarding anything a second time.
  const result = await withTransaction(async (client) => {
    let existingClaim = await getPersistedChestClaim(client, userId, nodeId);
    if (existingClaim) {
      return existingClaim;
    }

    // Lock the leader row so travel's UPDATE cannot change location between
    // authorization and commit. If travel commits first, this reads its new
    // location and rejects the claim.
    const locationResult = await client.query(
      `SELECT current_node_id
       FROM characters
       WHERE user_id = $1 AND party_slot = 1
       FOR UPDATE`,
      [userId]
    );

    // A concurrent claim may have committed while this transaction waited for
    // the leader lock. Recheck before enforcing location so that such a retry
    // remains idempotent even if travel was queued at the same time.
    existingClaim = await getPersistedChestClaim(client, userId, nodeId);
    if (existingClaim) {
      return existingClaim;
    }

    if (
      locationResult.rows.length === 0 ||
      locationResult.rows[0].current_node_id !== nodeId
    ) {
      throw new AppError('You must be at this location to claim the treasure', 400);
    }

    const nodeResult = await client.query(
      'SELECT id, node_type, distance_from_center FROM world_nodes WHERE id = $1',
      [nodeId]
    );

    if (nodeResult.rows.length === 0) {
      throw new AppError('Node not found', 404);
    }

    const node = nodeResult.rows[0];
    if (node.node_type !== 'chest') {
      throw new AppError('This node is not a treasure chest', 400);
    }

    // Generate loot based on distance (farther = better rewards).
    const distance = node.distance_from_center;
    const baseGold = 100 + (distance * 15);
    const goldVariance = Math.floor(baseGold * 0.2);
    const goldAwarded = baseGold
      + Math.floor(Math.random() * goldVariance * 2)
      - goldVariance;
    const itemsAwarded = generateChestLoot({ userId, nodeId, distance });

    // Atomically insert claim - prevents race condition via unique constraint
    // ON CONFLICT DO NOTHING returns 0 rows if already claimed
    const claimResult = await client.query(
      `INSERT INTO user_chest_claims (user_id, node_id, gold_awarded, items_awarded)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, node_id) DO NOTHING
       RETURNING node_id`,
      [userId, nodeId, goldAwarded, JSON.stringify(itemsAwarded)]
    );

    if (claimResult.rows.length === 0) {
      const concurrentClaim = await getPersistedChestClaim(client, userId, nodeId);
      if (!concurrentClaim) {
        throw new AppError('Unable to resolve treasure claim', 409);
      }
      return concurrentClaim;
    }

    // Add items to user's shared inventory
    if (itemsAwarded.length > 0) {
      await addItemsToInventory(client, userId, itemsAwarded);
    }

    // Gold is account-wide, matching shops, fishing, ruins, and other rewards.
    const userResult = await client.query(
      `UPDATE users SET gold = LEAST(gold + $1, $3)
       WHERE id = $2
       RETURNING gold`,
      [goldAwarded, userId, MAX_GOLD]
    );

    if (userResult.rows.length === 0) {
      throw new AppError('User not found', 404);
    }

    return {
      alreadyClaimed: false,
      goldAwarded,
      itemsAwarded,
      newGoldBalance: userResult.rows[0].gold
    };
  });

  res.json({
    success: true,
    already_claimed: result.alreadyClaimed,
    gold_awarded: result.goldAwarded,
    items_awarded: result.itemsAwarded,
    new_gold_balance: result.newGoldBalance,
    message: result.alreadyClaimed
      ? 'This treasure was already collected.'
      : result.itemsAwarded.length > 0
        ? `You found ${result.goldAwarded} gold and ${result.itemsAwarded.length} item(s) in the treasure chest!`
        : `You found ${result.goldAwarded} gold in the treasure chest!`
  });
}));

// ============================================================================
// SHRINE ENDPOINTS
// ============================================================================

// POST /api/world/nodes/:id/visit-shrine - Apply shrine buff
router.post('/nodes/:id/visit-shrine', authenticate, shrineLimiter, asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const nodeId = parseInt(req.params.id, 10);

  // Verify user is at this node
  const atNode = await verifyUserAtNode(userId, nodeId);
  if (!atNode) {
    throw new AppError('You must be at this location to receive the blessing', 400);
  }

  // Verify the node exists and is a shrine type
  const nodeResult = await query(
    'SELECT id, node_type, shrine_buff_type, zodiac_sign FROM world_nodes WHERE id = $1',
    [nodeId]
  );

  if (nodeResult.rows.length === 0) {
    throw new AppError('Node not found', 404);
  }

  const node = nodeResult.rows[0];
  if (node.node_type !== 'shrine') {
    throw new AppError('This node is not a shrine', 400);
  }

  const zodiacSign = node.zodiac_sign;
  const isZodiacShrine = zodiacSign && ZODIAC_SHRINE_BUFFS[zodiacSign];

  // Get buff info from either zodiac or regular shrine buffs
  let buffInfo;
  let buffType;
  let signatureAbility = null;

  if (isZodiacShrine) {
    buffInfo = ZODIAC_SHRINE_BUFFS[zodiacSign];
    buffType = `zodiac_${zodiacSign}`;
    signatureAbility = buffInfo.signatureAbility;
  } else {
    buffType = node.shrine_buff_type;
    buffInfo = SHRINE_BUFFS[buffType];
  }

  if (!buffInfo) {
    throw new AppError('Invalid shrine buff type', 500);
  }

  // Check cooldown
  const visitCheck = await query(
    `SELECT expires_at, last_visited_at FROM user_shrine_visits
     WHERE user_id = $1 AND node_id = $2`,
    [userId, nodeId]
  );

  const now = new Date();
  if (visitCheck.rows.length > 0) {
    const lastVisit = new Date(visitCheck.rows[0].last_visited_at);
    const cooldownMs = SHRINE_COOLDOWN_HOURS * 60 * 60 * 1000;
    if (now - lastVisit < cooldownMs) {
      const remainingMs = cooldownMs - (now - lastVisit);
      const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));
      throw new AppError(`Shrine is on cooldown. Return in ${remainingHours} hour(s).`, 400);
    }
  }

  // Calculate expiration time
  const expiresAt = new Date(now.getTime() + buffInfo.duration * 60 * 60 * 1000);

  // Handle zodiac crystal collection (first visit awards permanent crystal)
  let crystalAwarded = false;
  let crystalName = null;
  let totalCrystals = 0;
  let collectionComplete = false;

  if (isZodiacShrine) {
    // Check if user already has this crystal
    const crystalCheck = await query(
      'SELECT 1 FROM user_zodiac_crystals WHERE user_id = $1 AND zodiac_sign = $2',
      [userId, zodiacSign]
    );

    if (crystalCheck.rows.length === 0) {
      // Award the crystal
      await query(
        `INSERT INTO user_zodiac_crystals (user_id, zodiac_sign, shrine_node_id)
         VALUES ($1, $2, $3)`,
        [userId, zodiacSign, nodeId]
      );
      crystalAwarded = true;
      crystalName = ZODIAC_CRYSTALS[zodiacSign].name;
    }

    // Get total crystals collected
    const crystalCount = await query(
      'SELECT COUNT(*) as count FROM user_zodiac_crystals WHERE user_id = $1',
      [userId]
    );
    totalCrystals = parseInt(crystalCount.rows[0].count, 10);
    collectionComplete = totalCrystals >= 12;
  }

  // Upsert the shrine visit with signature ability for zodiac shrines
  await query(
    `INSERT INTO user_shrine_visits (user_id, node_id, buff_type, expires_at, last_visited_at, signature_ability, signature_used)
     VALUES ($1, $2, $3, $4, $5, $6, FALSE)
     ON CONFLICT (user_id, node_id) DO UPDATE SET
       buff_type = $3,
       expires_at = $4,
       last_visited_at = $5,
       signature_ability = $6,
       signature_used = FALSE`,
    [userId, nodeId, buffType, expiresAt, now, signatureAbility]
  );

  // Build response
  const response = {
    success: true,
    buff_name: buffInfo.name,
    buff_description: buffInfo.description,
    expires_at: expiresAt,
    duration_hours: buffInfo.duration,
    message: `You received the blessing: ${buffInfo.name}!`
  };

  // Add zodiac-specific response fields
  if (isZodiacShrine) {
    response.isZodiacShrine = true;
    response.zodiacSign = zodiacSign;
    response.signatureAbility = {
      name: buffInfo.signatureAbility,
      description: buffInfo.description,
      element: buffInfo.element
    };
    response.crystalAwarded = crystalAwarded;
    if (crystalAwarded) {
      response.crystalName = crystalName;
      response.message = `You received the blessing: ${buffInfo.name}! You also collected the ${crystalName}!`;
    }
    response.totalCrystals = totalCrystals;
    response.collectionComplete = collectionComplete;
    if (collectionComplete && crystalAwarded) {
      response.collectionBonusUnlocked = ZODIAC_COLLECTION_BONUS;
      response.message += ` You have completed the Zodiac Collection and earned the title "${ZODIAC_COLLECTION_BONUS.title}"!`;
    }
  }

  res.json(response);
}));

// GET /api/world/active-buffs - Get user's active shrine buffs
router.get('/active-buffs', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  const buffs = await query(
    `SELECT usv.buff_type, usv.expires_at, wn.name as shrine_name
     FROM user_shrine_visits usv
     JOIN world_nodes wn ON wn.id = usv.node_id
     WHERE usv.user_id = $1 AND usv.expires_at > NOW()
     ORDER BY usv.expires_at ASC`,
    [userId]
  );

  const activeBuffs = buffs.rows.map(buff => ({
    buff_type: buff.buff_type,
    buff_info: SHRINE_BUFFS[buff.buff_type],
    expires_at: buff.expires_at,
    shrine_name: buff.shrine_name
  }));

  res.json({ buffs: activeBuffs });
}));

// ============================================================================
// ZODIAC COLLECTION ENDPOINTS
// ============================================================================

// GET /api/world/zodiac-collection - Get user's zodiac crystal collection progress
router.get('/zodiac-collection', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  // Get all collected crystals for this user
  const collectedResult = await query(
    `SELECT zodiac_sign, collected_at, shrine_node_id
     FROM user_zodiac_crystals
     WHERE user_id = $1
     ORDER BY collected_at ASC`,
    [userId]
  );

  // Build a map of collected crystals
  const collectedMap = new Map();
  for (const row of collectedResult.rows) {
    collectedMap.set(row.zodiac_sign, {
      collectedAt: row.collected_at,
      shrineNodeId: row.shrine_node_id
    });
  }

  // Build the full collection status
  const zodiacSigns = Object.keys(ZODIAC_CRYSTALS);
  const crystals = zodiacSigns.map(sign => {
    const crystal = ZODIAC_CRYSTALS[sign];
    const collected = collectedMap.get(sign);
    return {
      sign,
      name: crystal.name,
      bonus: crystal.bonus,
      collected: !!collected,
      collectedAt: collected?.collectedAt || null,
      shrineNodeId: collected?.shrineNodeId || null
    };
  });

  const totalCollected = collectedResult.rows.length;
  const collectionComplete = totalCollected >= 12;

  res.json({
    crystals,
    totalCollected,
    collectionComplete,
    bonusActive: collectionComplete,
    collectionBonus: collectionComplete ? ZODIAC_COLLECTION_BONUS : null
  });
}));

// ============================================================================
// DISCOVERY ENDPOINTS
// ============================================================================

// POST /api/world/nodes/:id/discover - Unlock discovery content
router.post('/nodes/:id/discover', authenticate, discoveryLimiter, asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const nodeId = parseInt(req.params.id, 10);

  // Verify user is at this node
  const atNode = await verifyUserAtNode(userId, nodeId);
  if (!atNode) {
    throw new AppError('You must be at this location to explore the discovery', 400);
  }

  // Verify the node exists and is a discovery type
  const nodeResult = await query(
    'SELECT id, node_type, lore_key, name, region_race FROM world_nodes WHERE id = $1',
    [nodeId]
  );

  if (nodeResult.rows.length === 0) {
    throw new AppError('Node not found', 404);
  }

  const node = nodeResult.rows[0];
  if (node.node_type !== 'discovery') {
    throw new AppError('This node is not a discovery site', 400);
  }

  // Check if already discovered
  const discoveryCheck = await query(
    'SELECT 1 FROM user_discoveries WHERE user_id = $1 AND node_id = $2',
    [userId, nodeId]
  );

  const alreadyDiscovered = discoveryCheck.rows.length > 0;

  if (!alreadyDiscovered) {
    // Record the discovery
    await query(
      `INSERT INTO user_discoveries (user_id, node_id, lore_key)
       VALUES ($1, $2, $3)`,
      [userId, nodeId, node.lore_key]
    );
  }

  // Generate lore content based on region and coordinates
  const loreContent = getLoreContent(node.lore_key, node.name, node.region_race);

  res.json({
    success: true,
    already_discovered: alreadyDiscovered,
    lore: loreContent,
    message: alreadyDiscovered
      ? `You revisit the ${node.name}, recalling its secrets.`
      : `You have discovered ${node.name}!`
  });
}));

// GET /api/world/my-discoveries - Get user's discovery progress
router.get('/my-discoveries', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  const discoveries = await query(
    `SELECT ud.discovered_at, ud.lore_key, wn.name, wn.id as node_id
     FROM user_discoveries ud
     JOIN world_nodes wn ON wn.id = ud.node_id
     WHERE ud.user_id = $1
     ORDER BY ud.discovered_at DESC`,
    [userId]
  );

  const totalDiscoveries = await query(
    'SELECT COUNT(*) as total FROM world_nodes WHERE node_type = \'discovery\''
  );

  res.json({
    discoveries: discoveries.rows,
    discovered_count: discoveries.rows.length,
    total_count: parseInt(totalDiscoveries.rows[0].total, 10)
  });
}));

// ============================================================================
// WATCHTOWER ENDPOINTS
// ============================================================================

// GET /api/world/watchtower-view/:nodeId - Get extended view from a watchtower
router.get('/watchtower-view/:nodeId', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const nodeId = parseInt(req.params.nodeId, 10);

  if (isNaN(nodeId)) {
    throw new AppError('Invalid node ID', 400);
  }

  // Verify the node exists and is a watchtower
  const nodeResult = await query(
    `SELECT id, node_type, name, x_coord, y_coord, watchtower_reveal_radius,
            region_id, region_race, ring_distance, features
     FROM world_nodes WHERE id = $1`,
    [nodeId]
  );

  if (nodeResult.rows.length === 0) {
    throw new AppError('Node not found', 404);
  }

  const watchtowerNode = nodeResult.rows[0];

  if (watchtowerNode.node_type !== 'watchtower') {
    throw new AppError('This node is not a watchtower', 400);
  }

  // Use pixel-based reveal radius (~3000px diameter = 1500px radius)
  // watchtower_reveal_radius in DB is a multiplier (DB default is 2, meaning 3000px radius)
  // The base is 1500px, multiplied by the radius value to get final pixel radius
  const baseRevealRadiusPixels = 1500;
  const radiusMultiplier = watchtowerNode.watchtower_reveal_radius ?? 2;
  const revealRadiusPixels = baseRevealRadiusPixels * radiusMultiplier;

  // Spatial query: find all nodes within pixel radius using Euclidean distance
  // Coordinates are in worldgen units (1 unit = 30 pixels), so convert radius
  const revealRadiusUnits = revealRadiusPixels / 30;
  const wtX = watchtowerNode.x_coord;
  const wtY = watchtowerNode.y_coord;

  // Query nodes within the circular radius using spatial distance
  // Use bounding box pre-filter for index optimization, then apply circular filter
  const spatialResult = await query(
    `SELECT id,
            SQRT(POWER(x_coord - $1, 2) + POWER(y_coord - $2, 2)) as distance_units
     FROM world_nodes
     WHERE x_coord BETWEEN $1 - $3 AND $1 + $3
       AND y_coord BETWEEN $2 - $3 AND $2 + $3
       AND SQRT(POWER(x_coord - $1, 2) + POWER(y_coord - $2, 2)) <= $3
     ORDER BY distance_units`,
    [wtX, wtY, revealRadiusUnits]
  );

  const revealedNodeIds = spatialResult.rows.map(r => r.id);
  const distanceMap = new Map(spatialResult.rows.map(r => [r.id, r.distance_units * 30])); // Convert back to pixels

  // Fetch node details for all revealed nodes
  const nodesResult = await query(
    `SELECT wn.id, wn.x_coord, wn.y_coord, wn.node_type, wn.name,
            wn.region_id, wn.region_race, wn.ring_distance, wn.difficulty_tier,
            CASE WHEN und.node_id IS NOT NULL THEN true ELSE false END as discovered
     FROM world_nodes wn
     LEFT JOIN user_node_discovery und ON und.node_id = wn.id AND und.user_id = $2
     WHERE wn.id = ANY($1)`,
    [revealedNodeIds, userId]
  );

  // Get connections between revealed nodes
  const revealedConnectionsResult = await query(
    `SELECT from_node_id, to_node_id
     FROM world_node_connections
     WHERE from_node_id = ANY($1) AND to_node_id = ANY($1)`,
    [revealedNodeIds]
  );

  // Format revealed nodes - always include names for watchtower reveals
  const revealedNodes = nodesResult.rows.map(node => ({
    id: node.id,
    x_coord: node.x_coord,
    y_coord: node.y_coord,
    node_type: node.node_type,
    name: node.name, // Always include actual name for watchtower reveals
    discovered: node.discovered,
    region_id: node.region_id,
    region_race: node.region_race,
    difficulty_tier: node.difficulty_tier,
    distance_from_watchtower: distanceMap.get(node.id) ?? 0 // Distance in pixels
  }));

  res.json({
    watchtowerNode: {
      id: watchtowerNode.id,
      name: watchtowerNode.name,
      x_coord: watchtowerNode.x_coord,
      y_coord: watchtowerNode.y_coord,
      node_type: watchtowerNode.node_type,
      region_id: watchtowerNode.region_id,
      region_race: watchtowerNode.region_race,
      reveal_radius_pixels: revealRadiusPixels
    },
    revealedNodes,
    revealedConnections: revealedConnectionsResult.rows
  });
}));

export default router;
