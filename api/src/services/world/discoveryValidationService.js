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
  const result = { repaired: false, repairs: [], checked: true };

  // Get all character positions and home castles
  const charResult = await query(
    `SELECT c.id, c.name, c.current_node_id, wr.castle_node_id
     FROM characters c
     LEFT JOIN world_regions wr ON c.home_region_id = wr.id
     WHERE c.user_id = $1 AND c.current_node_id IS NOT NULL`,
    [userId]
  );

  if (charResult.rows.length === 0) {
    return { ...result, skipped: true, skipReason: 'no_characters' };
  }

  // Collect nodes that MUST be discovered
  const requiredNodes = new Set();
  for (const char of charResult.rows) {
    if (char.current_node_id) requiredNodes.add(char.current_node_id);
    if (char.castle_node_id) requiredNodes.add(char.castle_node_id);
  }

  // Check which required nodes are NOT discovered
  const discoveryCheck = await query(
    `SELECT node_id FROM user_node_discovery
     WHERE user_id = $1 AND node_id = ANY($2)`,
    [userId, [...requiredNodes]]
  );

  const discoveredSet = new Set(discoveryCheck.rows.map(r => r.node_id));

  // Find and repair missing nodes (with per-repair error handling for partial success)
  for (const char of charResult.rows) {
    // Check current position
    if (char.current_node_id && !discoveredSet.has(char.current_node_id)) {
      try {
        console.log(`[DiscoveryValidation] Repairing user ${userId}: discovering current_node ${char.current_node_id} for char ${char.name}`);
        await discoverNodeAndAdjacent(userId, char.current_node_id);
        result.repairs.push({ type: 'current_node', nodeId: char.current_node_id, charName: char.name });
        result.repaired = true;
        // Add to discovered set to avoid duplicate repairs
        discoveredSet.add(char.current_node_id);
      } catch (err) {
        console.error(`[DiscoveryValidation] Failed to repair current_node ${char.current_node_id} for char ${char.name}:`, err.message);
        result.repairs.push({ type: 'current_node', nodeId: char.current_node_id, charName: char.name, error: err.message });
      }
    }

    // Check home castle
    if (char.castle_node_id && !discoveredSet.has(char.castle_node_id)) {
      try {
        console.log(`[DiscoveryValidation] Repairing user ${userId}: discovering home_castle ${char.castle_node_id} for char ${char.name}`);
        await discoverNodeAndAdjacent(userId, char.castle_node_id);
        result.repairs.push({ type: 'home_castle', nodeId: char.castle_node_id, charName: char.name });
        result.repaired = true;
        discoveredSet.add(char.castle_node_id);
      } catch (err) {
        console.error(`[DiscoveryValidation] Failed to repair home_castle ${char.castle_node_id} for char ${char.name}:`, err.message);
        result.repairs.push({ type: 'home_castle', nodeId: char.castle_node_id, charName: char.name, error: err.message });
      }
    }
  }

  if (result.repaired) {
    console.log(`[DiscoveryValidation] Repaired user ${userId}: ${result.repairs.length} nodes discovered`);
  }

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
      const result = await validateAndRepairDiscovery(user.id);
      if (result.repaired) {
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
