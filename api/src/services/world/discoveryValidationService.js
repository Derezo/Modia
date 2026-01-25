/**
 * Discovery Validation Service - Self-healing for orphaned character positions
 *
 * Detects: Characters with current_node_id not in user_node_discovery
 * Repairs: Discovers the character's current node + adjacent nodes
 */

import { query } from '../../config/database.js';
import { discoverNodeAndAdjacent } from './discoveryService.js';

/**
 * Validate and repair discovery state for a user.
 * Called on login to ensure world map works.
 *
 * @param {number} userId - User ID to validate
 * @returns {Promise<{repaired: boolean, repairs: Array, checked: boolean}>}
 */
export async function validateAndRepairDiscovery(userId) {
  // CRITICAL: This must be the VERY FIRST line to prove execution
  console.log(`[DiscoveryValidation] START for user ${userId}`);

  const result = { repaired: false, repairs: [], checked: true };

  // Get all character positions and home castles
  const charResult = await query(
    `SELECT c.id, c.name, c.current_node_id, wr.castle_node_id
     FROM characters c
     LEFT JOIN world_regions wr ON c.home_region_id = wr.id
     WHERE c.user_id = $1 AND c.current_node_id IS NOT NULL`,
    [userId]
  );

  console.log(`[DiscoveryValidation] Found ${charResult.rows.length} characters for user ${userId}`);

  if (charResult.rows.length === 0) {
    console.log(`[DiscoveryValidation] SKIP - no characters for user ${userId}`);
    return { ...result, skipped: true, skipReason: 'no_characters' };
  }

  // Log each character's node
  for (const char of charResult.rows) {
    console.log(`[DiscoveryValidation] Character "${char.name}": current_node=${char.current_node_id}, castle=${char.castle_node_id}`);
  }

  // Collect nodes that MUST be discovered
  const requiredNodes = new Set();
  for (const char of charResult.rows) {
    if (char.current_node_id) requiredNodes.add(char.current_node_id);
    if (char.castle_node_id) requiredNodes.add(char.castle_node_id);
  }

  console.log(`[DiscoveryValidation] Required nodes: [${[...requiredNodes].join(', ')}]`);

  // CRITICAL: Verify required nodes exist in world_nodes
  const nodeExistsCheck = await query(
    'SELECT id FROM world_nodes WHERE id = ANY($1)',
    [[...requiredNodes]]
  );
  const existingNodeIds = new Set(nodeExistsCheck.rows.map(r => r.id));

  for (const nodeId of requiredNodes) {
    if (!existingNodeIds.has(nodeId)) {
      console.error(`[DiscoveryValidation] CRITICAL: Node ${nodeId} does NOT exist in world_nodes!`);
      result.repairs.push({ type: 'missing_node', nodeId, error: 'Node does not exist in world_nodes' });
    }
  }

  // Check which required nodes are NOT discovered
  const discoveryCheck = await query(
    `SELECT node_id FROM user_node_discovery
     WHERE user_id = $1 AND node_id = ANY($2)`,
    [userId, [...requiredNodes]]
  );

  const discoveredSet = new Set(discoveryCheck.rows.map(r => r.node_id));
  console.log(`[DiscoveryValidation] Already discovered: [${[...discoveredSet].join(', ')}]`);

  // Find and repair missing nodes (with per-repair error handling for partial success)
  for (const char of charResult.rows) {
    // Check current position
    if (char.current_node_id && !discoveredSet.has(char.current_node_id)) {
      // Only try repair if node exists
      if (!existingNodeIds.has(char.current_node_id)) {
        console.error(`[DiscoveryValidation] Cannot repair node ${char.current_node_id} - it doesn't exist in world_nodes`);
        continue;
      }

      try {
        console.log(`[DiscoveryValidation] Repairing: discovering node ${char.current_node_id} for char "${char.name}"`);
        await discoverNodeAndAdjacent(userId, char.current_node_id);

        // VERIFY the insert actually worked
        const verifyResult = await query(
          'SELECT 1 FROM user_node_discovery WHERE user_id = $1 AND node_id = $2',
          [userId, char.current_node_id]
        );

        if (verifyResult.rows.length > 0) {
          console.log(`[DiscoveryValidation] SUCCESS: Node ${char.current_node_id} now discovered`);
          result.repairs.push({ type: 'current_node', nodeId: char.current_node_id, charName: char.name });
          result.repaired = true;
          discoveredSet.add(char.current_node_id);
        } else {
          console.error(`[DiscoveryValidation] FAILED: Node ${char.current_node_id} still not in discovery table after insert!`);
          result.repairs.push({ type: 'current_node', nodeId: char.current_node_id, charName: char.name, error: 'Insert did not persist' });
        }
      } catch (err) {
        console.error(`[DiscoveryValidation] ERROR repairing node ${char.current_node_id}:`, err.message);
        result.repairs.push({ type: 'current_node', nodeId: char.current_node_id, charName: char.name, error: err.message });
      }
    }

    // Check home castle (same pattern)
    if (char.castle_node_id && !discoveredSet.has(char.castle_node_id)) {
      if (!existingNodeIds.has(char.castle_node_id)) {
        console.error(`[DiscoveryValidation] Cannot repair castle ${char.castle_node_id} - it doesn't exist in world_nodes`);
        continue;
      }

      try {
        console.log(`[DiscoveryValidation] Repairing: discovering castle ${char.castle_node_id} for char "${char.name}"`);
        await discoverNodeAndAdjacent(userId, char.castle_node_id);

        const verifyResult = await query(
          'SELECT 1 FROM user_node_discovery WHERE user_id = $1 AND node_id = $2',
          [userId, char.castle_node_id]
        );

        if (verifyResult.rows.length > 0) {
          console.log(`[DiscoveryValidation] SUCCESS: Castle ${char.castle_node_id} now discovered`);
          result.repairs.push({ type: 'home_castle', nodeId: char.castle_node_id, charName: char.name });
          result.repaired = true;
          discoveredSet.add(char.castle_node_id);
        } else {
          console.error(`[DiscoveryValidation] FAILED: Castle ${char.castle_node_id} still not in discovery table!`);
          result.repairs.push({ type: 'home_castle', nodeId: char.castle_node_id, charName: char.name, error: 'Insert did not persist' });
        }
      } catch (err) {
        console.error(`[DiscoveryValidation] ERROR repairing castle ${char.castle_node_id}:`, err.message);
        result.repairs.push({ type: 'home_castle', nodeId: char.castle_node_id, charName: char.name, error: err.message });
      }
    }
  }

  console.log(`[DiscoveryValidation] END for user ${userId}: repaired=${result.repaired}, repairs=${result.repairs.length}`);
  return result;
}

/**
 * Fix characters at non-existent nodes by relocating them to their home castle
 * @param {number} userId - User ID to fix
 * @returns {Promise<{fixed: Array, errors: Array}>}
 */
export async function fixOrphanedCharacters(userId) {
  console.log(`[FixOrphaned] START for user ${userId}`);
  const result = { fixed: [], errors: [] };

  // Find characters at nodes that don't exist
  const orphanedResult = await query(
    `SELECT c.id, c.name, c.current_node_id, c.home_region_id, wr.castle_node_id
     FROM characters c
     LEFT JOIN world_nodes wn ON c.current_node_id = wn.id
     LEFT JOIN world_regions wr ON c.home_region_id = wr.id
     WHERE c.user_id = $1 AND c.current_node_id IS NOT NULL AND wn.id IS NULL`,
    [userId]
  );

  if (orphanedResult.rows.length === 0) {
    console.log(`[FixOrphaned] No orphaned characters for user ${userId}`);
    return result;
  }

  console.log(`[FixOrphaned] Found ${orphanedResult.rows.length} orphaned characters for user ${userId}`);

  for (const char of orphanedResult.rows) {
    const newNodeId = char.castle_node_id;

    if (!newNodeId) {
      console.error(`[FixOrphaned] No home castle for char "${char.name}" - cannot relocate`);
      result.errors.push({ charId: char.id, charName: char.name, error: 'No home castle to relocate to' });
      continue;
    }

    // Verify the castle exists
    const castleExists = await query('SELECT 1 FROM world_nodes WHERE id = $1', [newNodeId]);
    if (castleExists.rows.length === 0) {
      console.error(`[FixOrphaned] Castle ${newNodeId} doesn't exist - cannot relocate char "${char.name}"`);
      result.errors.push({ charId: char.id, charName: char.name, error: `Castle ${newNodeId} does not exist` });
      continue;
    }

    try {
      // Relocate character to their home castle
      await query(
        'UPDATE characters SET current_node_id = $1 WHERE id = $2',
        [newNodeId, char.id]
      );

      // Discover the home castle
      await discoverNodeAndAdjacent(userId, newNodeId);

      console.log(`[FixOrphaned] Relocated "${char.name}" from orphaned node ${char.current_node_id} to castle ${newNodeId}`);
      result.fixed.push({ charId: char.id, charName: char.name, fromNode: char.current_node_id, toNode: newNodeId });
    } catch (err) {
      console.error(`[FixOrphaned] Failed to relocate "${char.name}":`, err.message);
      result.errors.push({ charId: char.id, charName: char.name, error: err.message });
    }
  }

  console.log(`[FixOrphaned] END for user ${userId}: fixed=${result.fixed.length}, errors=${result.errors.length}`);
  return result;
}

/**
 * Check discovery health without repairing (diagnostic)
 * @param {number} userId - User ID to check
 * @returns {Promise<Object>} Health status with issues array
 */
export async function checkDiscoveryHealth(userId) {
  const charResult = await query(
    `SELECT c.id, c.name, c.current_node_id, wr.castle_node_id
     FROM characters c
     LEFT JOIN world_regions wr ON c.home_region_id = wr.id
     WHERE c.user_id = $1`,
    [userId]
  );

  const discoveryResult = await query(
    'SELECT node_id FROM user_node_discovery WHERE user_id = $1',
    [userId]
  );

  const discoveredSet = new Set(discoveryResult.rows.map(r => r.node_id));
  const issues = [];

  for (const char of charResult.rows) {
    if (char.current_node_id && !discoveredSet.has(char.current_node_id)) {
      issues.push({ type: 'orphaned_position', charId: char.id, charName: char.name, nodeId: char.current_node_id });
    }
    if (char.castle_node_id && !discoveredSet.has(char.castle_node_id)) {
      issues.push({ type: 'missing_home_castle', charId: char.id, charName: char.name, nodeId: char.castle_node_id });
    }
  }

  return {
    healthy: issues.length === 0,
    characterCount: charResult.rows.length,
    discoveredNodeCount: discoveryResult.rows.length,
    issues
  };
}

/**
 * Batch repair all affected users (one-time migration)
 * @returns {Promise<{total: number, repaired: number, errors: Array}>}
 */
export async function batchRepairAllUsers() {
  const usersResult = await query(
    `SELECT DISTINCT u.id, u.username
     FROM users u
     JOIN characters c ON c.user_id = u.id
     WHERE c.current_node_id IS NOT NULL`
  );

  console.log(`[BatchRepair] Checking ${usersResult.rows.length} users...`);

  let repaired = 0;
  const errors = [];

  for (const user of usersResult.rows) {
    try {
      // Fix orphaned characters first
      const orphanResult = await fixOrphanedCharacters(user.id);

      // Then repair discovery state
      const result = await validateAndRepairDiscovery(user.id);
      if (result.repaired || orphanResult.fixed.length > 0) {
        repaired++;
        console.log(`[BatchRepair] Fixed user ${user.username} (${user.id})`);
      }
    } catch (err) {
      errors.push({ userId: user.id, username: user.username, error: err.message });
      console.error(`[BatchRepair] Error for user ${user.username} (${user.id}):`, err.message);
    }
  }

  console.log(`[BatchRepair] Complete: ${repaired} users repaired, ${errors.length} errors`);
  return { total: usersResult.rows.length, repaired, errors };
}
