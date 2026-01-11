import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  request,
  createTestUser,
  createTestCharacter,
  cleanupTestUser,
  query
} from '../testHelper.js';

/**
 * Node Blocking System Tests
 *
 * Tests the node blocking mechanics:
 * - Combat nodes (forest, cave, mountain, bridge) are blocked until cleared
 * - From a blocked node, can only travel to visited nodes
 * - Cannot travel through blocked intermediate nodes
 * - Can travel TO a blocked node (to initiate battle)
 */

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Find specific nodes for testing
 * @param {number} userId - User ID to check discovery against
 * @returns {Promise<Object>} Object with castle, forest, beyondForest node IDs
 */
async function findTestNodes() {
  // Find castle (starting point, never blocked)
  const castle = await query(
    `SELECT id, name FROM world_nodes WHERE node_type = 'castle' LIMIT 1`
  );

  if (castle.rows.length === 0) {
    throw new Error('No castle node found in world');
  }

  // Find a forest adjacent to castle (will be blocked)
  const adjacentForest = await query(
    `SELECT wn.id, wn.name FROM world_nodes wn
     JOIN world_node_connections wnc ON (wnc.from_node_id = wn.id OR wnc.to_node_id = wn.id)
     WHERE wn.node_type = 'forest'
     AND (wnc.from_node_id = $1 OR wnc.to_node_id = $1)
     LIMIT 1`,
    [castle.rows[0].id]
  );

  // Find a node connected to the forest but not the castle (beyond forest)
  let beyondForest = null;
  if (adjacentForest.rows.length > 0) {
    const beyond = await query(
      `SELECT wn.id, wn.name, wn.node_type FROM world_nodes wn
       JOIN world_node_connections wnc ON (wnc.from_node_id = wn.id OR wnc.to_node_id = wn.id)
       WHERE (wnc.from_node_id = $1 OR wnc.to_node_id = $1)
       AND wn.id != $2
       LIMIT 1`,
      [adjacentForest.rows[0].id, castle.rows[0].id]
    );
    beyondForest = beyond.rows[0] || null;
  }

  return {
    castle: castle.rows[0],
    forest: adjacentForest.rows[0] || null,
    beyondForest
  };
}

/**
 * Discover a node for a user
 * @param {number} userId - User ID
 * @param {number} nodeId - Node ID to discover
 * @param {string} method - Discovery method ('travel' or 'adjacent')
 */
async function discoverNode(userId, nodeId, method = 'travel') {
  await query(
    `INSERT INTO user_node_discovery (user_id, node_id, discovery_method)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, node_id) DO UPDATE SET discovery_method = $3`,
    [userId, nodeId, method]
  );
}

/**
 * Clear a node for a user (simulate battle victory)
 * @param {number} userId - User ID
 * @param {number} nodeId - Node ID to clear
 */
async function clearNode(userId, nodeId) {
  await query(
    `INSERT INTO user_node_clearance (user_id, node_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, node_id) DO NOTHING`,
    [userId, nodeId]
  );
}

/**
 * Remove clearance for a node (reset to blocked)
 * @param {number} userId - User ID
 * @param {number} nodeId - Node ID to block
 */
async function blockNode(userId, nodeId) {
  await query(
    `DELETE FROM user_node_clearance WHERE user_id = $1 AND node_id = $2`,
    [userId, nodeId]
  );
}

/**
 * Move character directly to a node (bypasses travel logic)
 * @param {number} userId - User ID
 * @param {number} nodeId - Node ID to move to
 */
async function teleportToNode(userId, nodeId) {
  await query(
    `UPDATE characters SET current_node_id = $1
     WHERE user_id = $2 AND party_slot IS NOT NULL`,
    [nodeId, userId]
  );
}

/**
 * Set stamina for a character (respects max_stamina constraint)
 * @param {number} characterId - Character ID
 * @param {number} stamina - Stamina value (will be clamped to max_stamina)
 */
async function setStamina(characterId, stamina) {
  // First get max_stamina to respect the constraint
  const charResult = await query(
    'SELECT max_stamina FROM characters WHERE id = $1',
    [characterId]
  );
  const maxStamina = charResult.rows[0]?.max_stamina || 10;
  const clampedStamina = Math.min(stamina, maxStamina);

  await query(
    `UPDATE characters SET stamina = $1, stamina_updated_at = NOW()
     WHERE id = $2`,
    [clampedStamina, characterId]
  );
}

/**
 * Get current position of user's party leader
 * @param {number} userId - User ID
 * @returns {Promise<number>} Current node ID
 */
async function getCurrentNodeId(userId) {
  const result = await query(
    `SELECT current_node_id FROM characters
     WHERE user_id = $1 AND party_slot = 1`,
    [userId]
  );
  return result.rows[0]?.current_node_id;
}

// ============================================================================
// Tests
// ============================================================================

describe('Node Blocking System', () => {
  let user = null;
  let character = null;
  let testNodes = null;

  before(async () => {
    // Create test user and character
    user = await createTestUser();
    character = await createTestCharacter(user.accessToken);

    // Find nodes for testing
    testNodes = await findTestNodes();

    // Give character plenty of stamina
    await setStamina(character.id, 100);
  });

  after(async () => {
    if (user) {
      await cleanupTestUser(user.userId);
    }
  });

  describe('GET /api/world/nodes - Blocking Status', () => {
    it('should show combat nodes as blocked when not cleared', async () => {
      const res = await request('GET', '/api/world/nodes', null, user.accessToken);

      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.nodes));

      // Find a forest node in the response
      const forestNode = res.body.nodes.find(n => n.node_type === 'forest');
      if (forestNode) {
        assert.strictEqual(forestNode.blocked, true, 'Forest should be blocked');
      }
    });

    it('should show non-combat nodes as not blocked', async () => {
      const res = await request('GET', '/api/world/nodes', null, user.accessToken);

      assert.strictEqual(res.status, 200);

      // Find castle node (non-combat)
      const castleNode = res.body.nodes.find(n => n.node_type === 'castle');
      if (castleNode) {
        assert.strictEqual(castleNode.blocked, false, 'Castle should not be blocked');
      }
    });

    it('should show cleared nodes as not blocked', async () => {
      if (!testNodes.forest) {
        return; // Skip if no forest found
      }

      // Clear the forest
      await clearNode(user.userId, testNodes.forest.id);

      const res = await request('GET', '/api/world/nodes', null, user.accessToken);

      assert.strictEqual(res.status, 200);

      const forestNode = res.body.nodes.find(n => n.id === testNodes.forest.id);
      if (forestNode) {
        assert.strictEqual(forestNode.blocked, false, 'Cleared forest should not be blocked');
      }

      // Reset - remove clearance
      await blockNode(user.userId, testNodes.forest.id);
    });
  });

  describe('GET /api/world/path/:targetNodeId - Path Preview', () => {
    before(async () => {
      // Ensure we're at the castle
      await teleportToNode(user.userId, testNodes.castle.id);
    });

    it('should show path to adjacent non-blocked node', async () => {
      // Travel to forest first to visit it (so it has discovery_method = 'travel')
      await discoverNode(user.userId, testNodes.forest.id, 'travel');
      await clearNode(user.userId, testNodes.forest.id);

      const res = await request('GET', `/api/world/path/${testNodes.forest.id}`, null, user.accessToken);

      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.path));
      assert.strictEqual(res.body.pathBlocked, false);

      // Reset
      await blockNode(user.userId, testNodes.forest.id);
    });

    it('should show destinationBlocked when target is blocked', async () => {
      if (!testNodes.forest) return;

      // Make sure forest is discovered but not cleared
      await discoverNode(user.userId, testNodes.forest.id, 'travel');
      await blockNode(user.userId, testNodes.forest.id);

      const res = await request('GET', `/api/world/path/${testNodes.forest.id}`, null, user.accessToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.destinationBlocked, true, 'Destination should show as blocked');
    });

    it('should show cannotReachFromOrigin when at blocked node trying to reach non-visited node', async () => {
      if (!testNodes.forest || !testNodes.beyondForest) return;

      // Setup: Move to forest (blocked), discover beyond but not visit it
      await discoverNode(user.userId, testNodes.forest.id, 'travel');
      await blockNode(user.userId, testNodes.forest.id); // Ensure forest is blocked
      await teleportToNode(user.userId, testNodes.forest.id);
      await discoverNode(user.userId, testNodes.beyondForest.id, 'adjacent');

      const res = await request('GET', `/api/world/path/${testNodes.beyondForest.id}`, null, user.accessToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.originBlocked, true, 'Origin should be blocked');
      assert.strictEqual(res.body.cannotReachFromOrigin, true, 'Should not be able to reach from blocked origin');
      assert.strictEqual(res.body.affordable, false, 'Should not be affordable when blocked');

      // Reset
      await teleportToNode(user.userId, testNodes.castle.id);
    });
  });

  describe('POST /api/world/travel - Blocking Enforcement', () => {
    beforeEach(async () => {
      // Reset to castle with full stamina before each test
      await teleportToNode(user.userId, testNodes.castle.id);
      await setStamina(character.id, 100);
    });

    it('should allow travel TO a blocked node (to initiate battle)', async () => {
      if (!testNodes.forest) return;

      // Discover forest as visited (we've been there before)
      await discoverNode(user.userId, testNodes.forest.id, 'travel');
      await blockNode(user.userId, testNodes.forest.id);

      const res = await request('POST', '/api/world/travel',
        { targetNodeId: testNodes.forest.id },
        user.accessToken
      );

      assert.strictEqual(res.status, 200, `Travel should succeed: ${JSON.stringify(res.body)}`);

      // Verify we moved
      const currentNode = await getCurrentNodeId(user.userId);
      assert.strictEqual(currentNode, testNodes.forest.id);
    });

    it('should allow travel from blocked node to visited node (retreat)', async () => {
      if (!testNodes.forest) return;

      // Setup: Visit forest, move there, it's now blocked
      await discoverNode(user.userId, testNodes.forest.id, 'travel');
      await discoverNode(user.userId, testNodes.castle.id, 'travel'); // Castle already visited
      await teleportToNode(user.userId, testNodes.forest.id);
      await blockNode(user.userId, testNodes.forest.id);

      // Should be able to go back to castle
      const res = await request('POST', '/api/world/travel',
        { targetNodeId: testNodes.castle.id },
        user.accessToken
      );

      assert.strictEqual(res.status, 200, `Retreat should succeed: ${JSON.stringify(res.body)}`);

      const currentNode = await getCurrentNodeId(user.userId);
      assert.strictEqual(currentNode, testNodes.castle.id);
    });

    it('should BLOCK travel from blocked node to non-visited node', async () => {
      if (!testNodes.forest || !testNodes.beyondForest) return;

      // Setup: At forest (blocked), beyondForest is discovered as adjacent but not visited
      await discoverNode(user.userId, testNodes.forest.id, 'travel');
      await blockNode(user.userId, testNodes.forest.id); // Ensure forest is blocked first
      await teleportToNode(user.userId, testNodes.forest.id);
      await discoverNode(user.userId, testNodes.beyondForest.id, 'adjacent');

      const res = await request('POST', '/api/world/travel',
        { targetNodeId: testNodes.beyondForest.id },
        user.accessToken
      );

      assert.strictEqual(res.status, 400, 'Should reject travel to non-visited node from blocked origin');
      const message = res.body.message || res.body.error || '';
      assert.ok(
        message.includes('defeat the enemies') ||
        message.includes('retreat') ||
        message.includes('exploring further'),
        `Error message should mention clearing area: ${message}`
      );

      // Verify we didn't move
      const currentNode = await getCurrentNodeId(user.userId);
      assert.strictEqual(currentNode, testNodes.forest.id);
    });

    it('should allow travel after clearing the blocked node', async () => {
      if (!testNodes.forest || !testNodes.beyondForest) return;

      // Setup: At forest, now cleared
      await discoverNode(user.userId, testNodes.forest.id, 'travel');
      await teleportToNode(user.userId, testNodes.forest.id);
      await clearNode(user.userId, testNodes.forest.id);
      await discoverNode(user.userId, testNodes.beyondForest.id, 'travel');

      const res = await request('POST', '/api/world/travel',
        { targetNodeId: testNodes.beyondForest.id },
        user.accessToken
      );

      assert.strictEqual(res.status, 200, `Travel should succeed after clearing: ${JSON.stringify(res.body)}`);

      const currentNode = await getCurrentNodeId(user.userId);
      assert.strictEqual(currentNode, testNodes.beyondForest.id);
    });

    it('should reject travel to undiscovered nodes', async () => {
      // Use a high node ID that likely doesn't exist or isn't discovered
      const undiscoveredNodeId = 99999;

      const res = await request('POST', '/api/world/travel',
        { targetNodeId: undiscoveredNodeId },
        user.accessToken
      );

      assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
      // Check message exists and contains expected text
      const message = res.body.message || res.body.error || JSON.stringify(res.body);
      assert.ok(
        message.includes('not been discovered') ||
        message.includes('No path found') ||
        message.includes('not found'),
        `Should mention discovery issue: ${message}`
      );
    });
  });

  describe('Node Clearance', () => {
    it('should track clearance per user (different users have different clearance)', async () => {
      if (!testNodes.forest) return;

      // Create second user
      const user2 = await createTestUser();
      const char2 = await createTestCharacter(user2.accessToken);

      try {
        // Clear forest for user1
        await clearNode(user.userId, testNodes.forest.id);

        // Check user1 sees it as not blocked
        const res1 = await request('GET', '/api/world/nodes', null, user.accessToken);
        const forest1 = res1.body.nodes.find(n => n.id === testNodes.forest.id);

        // Check user2 still sees it as blocked
        await discoverNode(user2.userId, testNodes.castle.id, 'travel');
        await discoverNode(user2.userId, testNodes.forest.id, 'adjacent');

        const res2 = await request('GET', '/api/world/nodes', null, user2.accessToken);
        const forest2 = res2.body.nodes.find(n => n.id === testNodes.forest.id);

        if (forest1 && forest2) {
          assert.strictEqual(forest1.blocked, false, 'User1 should see forest as not blocked');
          assert.strictEqual(forest2.blocked, true, 'User2 should still see forest as blocked');
        }
      } finally {
        await cleanupTestUser(user2.userId);
      }
    });
  });
});
