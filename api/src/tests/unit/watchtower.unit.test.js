/**
 * Watchtower Reveal System - Unit Tests
 *
 * Tests the watchtower-view API endpoint functionality:
 * - Returns watchtowerNode with reveal_radius_pixels
 * - Returns revealedNodes array with proper node data
 * - Returns revealedConnections array
 * - Validates node is actually a watchtower
 * - Handles invalid node IDs appropriately
 *
 * This is a pure unit test that mocks database queries.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';

// ===========================================================================
// Mocked Handler Logic (extracted from world.js route for unit testing)
// ===========================================================================

/**
 * Watchtower view handler logic extracted for testability.
 * This mirrors the logic in /api/world/watchtower-view/:nodeId route.
 */
async function getWatchtowerView(nodeId, userId, queryFn) {
  if (isNaN(nodeId)) {
    throw new AppError('Invalid node ID', 400);
  }

  // Query 1: Fetch the watchtower node
  const nodeResult = await queryFn(
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

  // Calculate reveal radius (base 1500px multiplied by radius value)
  const baseRevealRadiusPixels = 1500;
  const radiusMultiplier = watchtowerNode.watchtower_reveal_radius ?? 2;
  const revealRadiusPixels = baseRevealRadiusPixels * radiusMultiplier;

  // Convert radius to worldgen units (1 unit = 30 pixels)
  const revealRadiusUnits = revealRadiusPixels / 30;
  const wtX = watchtowerNode.x_coord;
  const wtY = watchtowerNode.y_coord;

  // Query 2: Spatial query to find nodes within radius
  const spatialResult = await queryFn(
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
  const distanceMap = new Map(spatialResult.rows.map(r => [r.id, r.distance_units * 30]));

  // Query 3: Fetch node details for all revealed nodes
  const nodesResult = await queryFn(
    `SELECT wn.id, wn.x_coord, wn.y_coord, wn.node_type, wn.name,
            wn.region_id, wn.region_race, wn.ring_distance, wn.difficulty_tier,
            CASE WHEN und.node_id IS NOT NULL THEN true ELSE false END as discovered
     FROM world_nodes wn
     LEFT JOIN user_node_discovery und ON und.node_id = wn.id AND und.user_id = $2
     WHERE wn.id = ANY($1)`,
    [revealedNodeIds, userId]
  );

  // Query 4: Get connections between revealed nodes
  const revealedConnectionsResult = await queryFn(
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
    distance_from_watchtower: distanceMap.get(node.id) ?? 0
  }));

  return {
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
  };
}

/**
 * Simplified AppError class for testing
 */
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
  }
}

// ===========================================================================
// Test Data Fixtures
// ===========================================================================

/**
 * Create a mock watchtower node
 */
function createMockWatchtowerNode(overrides = {}) {
  return {
    id: 100,
    node_type: 'watchtower',
    name: 'Northern Watchtower',
    x_coord: 50,
    y_coord: 50,
    watchtower_reveal_radius: 2,
    region_id: 1,
    region_race: 'human',
    ring_distance: 3,
    features: null,
    ...overrides
  };
}

/**
 * Create a mock node (non-watchtower)
 */
function createMockNode(id, overrides = {}) {
  return {
    id,
    x_coord: 45 + (id % 10),
    y_coord: 45 + Math.floor(id / 10),
    node_type: 'town',
    name: `Town ${id}`,
    region_id: 1,
    region_race: 'human',
    ring_distance: 2,
    difficulty_tier: 1,
    discovered: false,
    ...overrides
  };
}

/**
 * Create mock spatial result row
 */
function createMockSpatialRow(id, distanceUnits) {
  return {
    id,
    distance_units: distanceUnits
  };
}

/**
 * Create mock connection
 */
function createMockConnection(fromId, toId) {
  return {
    from_node_id: fromId,
    to_node_id: toId
  };
}

// ===========================================================================
// Unit Tests
// ===========================================================================

describe('Watchtower View API', () => {
  let mockQuery;

  beforeEach(() => {
    mockQuery = mock.fn();
    mockQuery.mock.resetCalls();
  });

  describe('watchtowerNode response', () => {
    it('should return watchtowerNode with reveal_radius_pixels', async () => {
      const watchtowerNode = createMockWatchtowerNode();

      // Setup mock responses for each query
      mockQuery.mock.mockImplementation(async (sql, params) => {
        if (sql.includes('FROM world_nodes WHERE id')) {
          return { rows: [watchtowerNode] };
        }
        if (sql.includes('SQRT(POWER')) {
          return { rows: [{ id: 100, distance_units: 0 }] };
        }
        if (sql.includes('LEFT JOIN user_node_discovery')) {
          return {
            rows: [{
              ...watchtowerNode,
              discovered: true
            }]
          };
        }
        if (sql.includes('world_node_connections')) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      const result = await getWatchtowerView(100, 1, mockQuery);

      assert.ok(result.watchtowerNode, 'Should have watchtowerNode');
      assert.strictEqual(result.watchtowerNode.id, 100);
      assert.strictEqual(result.watchtowerNode.name, 'Northern Watchtower');
      assert.strictEqual(result.watchtowerNode.node_type, 'watchtower');
      assert.strictEqual(result.watchtowerNode.reveal_radius_pixels, 3000, 'Default radius multiplier 2 x 1500 = 3000');
    });

    it('should calculate reveal_radius_pixels based on watchtower_reveal_radius', async () => {
      // Test with custom radius multiplier of 3
      const watchtowerNode = createMockWatchtowerNode({ watchtower_reveal_radius: 3 });

      mockQuery.mock.mockImplementation(async (sql) => {
        if (sql.includes('FROM world_nodes WHERE id')) {
          return { rows: [watchtowerNode] };
        }
        if (sql.includes('SQRT(POWER')) {
          return { rows: [{ id: 100, distance_units: 0 }] };
        }
        if (sql.includes('LEFT JOIN user_node_discovery')) {
          return { rows: [{ ...watchtowerNode, discovered: true }] };
        }
        if (sql.includes('world_node_connections')) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      const result = await getWatchtowerView(100, 1, mockQuery);

      assert.strictEqual(
        result.watchtowerNode.reveal_radius_pixels,
        4500,
        'Radius multiplier 3 x 1500 = 4500'
      );
    });

    it('should use default radius multiplier of 2 when watchtower_reveal_radius is null', async () => {
      const watchtowerNode = createMockWatchtowerNode({ watchtower_reveal_radius: null });

      mockQuery.mock.mockImplementation(async (sql) => {
        if (sql.includes('FROM world_nodes WHERE id')) {
          return { rows: [watchtowerNode] };
        }
        if (sql.includes('SQRT(POWER')) {
          return { rows: [{ id: 100, distance_units: 0 }] };
        }
        if (sql.includes('LEFT JOIN user_node_discovery')) {
          return { rows: [{ ...watchtowerNode, discovered: true }] };
        }
        if (sql.includes('world_node_connections')) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      const result = await getWatchtowerView(100, 1, mockQuery);

      assert.strictEqual(
        result.watchtowerNode.reveal_radius_pixels,
        3000,
        'Default radius multiplier 2 x 1500 = 3000'
      );
    });
  });

  describe('revealedNodes response', () => {
    it('should return revealedNodes array', async () => {
      const watchtowerNode = createMockWatchtowerNode();
      const nearbyNodes = [
        createMockNode(101, { name: 'Village A', node_type: 'town' }),
        createMockNode(102, { name: 'Forest B', node_type: 'forest' }),
        createMockNode(103, { name: 'Cave C', node_type: 'cave' })
      ];

      mockQuery.mock.mockImplementation(async (sql) => {
        if (sql.includes('FROM world_nodes WHERE id')) {
          return { rows: [watchtowerNode] };
        }
        if (sql.includes('SQRT(POWER')) {
          return {
            rows: [
              createMockSpatialRow(100, 0),
              createMockSpatialRow(101, 5),
              createMockSpatialRow(102, 10),
              createMockSpatialRow(103, 15)
            ]
          };
        }
        if (sql.includes('LEFT JOIN user_node_discovery')) {
          return {
            rows: [
              { ...watchtowerNode, discovered: true },
              { ...nearbyNodes[0], discovered: true },
              { ...nearbyNodes[1], discovered: false },
              { ...nearbyNodes[2], discovered: false }
            ]
          };
        }
        if (sql.includes('world_node_connections')) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      const result = await getWatchtowerView(100, 1, mockQuery);

      assert.ok(Array.isArray(result.revealedNodes), 'revealedNodes should be an array');
      assert.strictEqual(result.revealedNodes.length, 4);
    });

    it('should always populate name for all revealed nodes (not null)', async () => {
      const watchtowerNode = createMockWatchtowerNode();
      const nearbyNodes = [
        createMockNode(101, { name: 'Known Village' }),
        createMockNode(102, { name: 'Hidden Cave' }),
        createMockNode(103, { name: 'Mysterious Forest' })
      ];

      mockQuery.mock.mockImplementation(async (sql) => {
        if (sql.includes('FROM world_nodes WHERE id')) {
          return { rows: [watchtowerNode] };
        }
        if (sql.includes('SQRT(POWER')) {
          return {
            rows: [
              createMockSpatialRow(100, 0),
              createMockSpatialRow(101, 5),
              createMockSpatialRow(102, 10),
              createMockSpatialRow(103, 15)
            ]
          };
        }
        if (sql.includes('LEFT JOIN user_node_discovery')) {
          return {
            rows: [
              { ...watchtowerNode, discovered: true },
              ...nearbyNodes.map((n, i) => ({ ...n, discovered: i === 0 }))
            ]
          };
        }
        if (sql.includes('world_node_connections')) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      const result = await getWatchtowerView(100, 1, mockQuery);

      // Verify all nodes have names populated
      for (const node of result.revealedNodes) {
        assert.ok(node.name !== null, `Node ${node.id} should have name populated`);
        assert.ok(node.name !== undefined, `Node ${node.id} name should not be undefined`);
        assert.ok(typeof node.name === 'string', `Node ${node.id} name should be a string`);
        assert.ok(node.name.length > 0, `Node ${node.id} should have non-empty name`);
      }
    });

    it('should include distance_from_watchtower in pixels for each revealed node', async () => {
      const watchtowerNode = createMockWatchtowerNode();

      mockQuery.mock.mockImplementation(async (sql) => {
        if (sql.includes('FROM world_nodes WHERE id')) {
          return { rows: [watchtowerNode] };
        }
        if (sql.includes('SQRT(POWER')) {
          // Return distances in worldgen units
          return {
            rows: [
              createMockSpatialRow(100, 0),      // watchtower itself
              createMockSpatialRow(101, 10),    // 10 units = 300 pixels
              createMockSpatialRow(102, 33.33)  // 33.33 units = ~1000 pixels
            ]
          };
        }
        if (sql.includes('LEFT JOIN user_node_discovery')) {
          return {
            rows: [
              { ...watchtowerNode, discovered: true },
              createMockNode(101, { discovered: true }),
              createMockNode(102, { discovered: false })
            ]
          };
        }
        if (sql.includes('world_node_connections')) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      const result = await getWatchtowerView(100, 1, mockQuery);

      const nodeDistances = new Map(result.revealedNodes.map(n => [n.id, n.distance_from_watchtower]));

      assert.strictEqual(nodeDistances.get(100), 0, 'Watchtower distance to itself should be 0');
      assert.strictEqual(nodeDistances.get(101), 300, 'Node 101 should be 300 pixels away (10 units * 30)');
      assert.ok(
        Math.abs(nodeDistances.get(102) - 999.9) < 1,
        'Node 102 should be ~1000 pixels away (33.33 units * 30)'
      );
    });

    it('should include discovered boolean for each revealed node', async () => {
      const watchtowerNode = createMockWatchtowerNode();

      mockQuery.mock.mockImplementation(async (sql) => {
        if (sql.includes('FROM world_nodes WHERE id')) {
          return { rows: [watchtowerNode] };
        }
        if (sql.includes('SQRT(POWER')) {
          return {
            rows: [
              createMockSpatialRow(100, 0),
              createMockSpatialRow(101, 5),
              createMockSpatialRow(102, 10)
            ]
          };
        }
        if (sql.includes('LEFT JOIN user_node_discovery')) {
          return {
            rows: [
              { ...watchtowerNode, discovered: true },
              createMockNode(101, { discovered: true }),
              createMockNode(102, { discovered: false })
            ]
          };
        }
        if (sql.includes('world_node_connections')) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      const result = await getWatchtowerView(100, 1, mockQuery);

      const node101 = result.revealedNodes.find(n => n.id === 101);
      const node102 = result.revealedNodes.find(n => n.id === 102);

      assert.strictEqual(node101.discovered, true, 'Node 101 should be discovered');
      assert.strictEqual(node102.discovered, false, 'Node 102 should not be discovered');
      assert.strictEqual(typeof node101.discovered, 'boolean', 'discovered should be boolean');
      assert.strictEqual(typeof node102.discovered, 'boolean', 'discovered should be boolean');
    });
  });

  describe('revealedConnections response', () => {
    it('should return revealedConnections array', async () => {
      const watchtowerNode = createMockWatchtowerNode();

      mockQuery.mock.mockImplementation(async (sql) => {
        if (sql.includes('FROM world_nodes WHERE id')) {
          return { rows: [watchtowerNode] };
        }
        if (sql.includes('SQRT(POWER')) {
          return {
            rows: [
              createMockSpatialRow(100, 0),
              createMockSpatialRow(101, 5),
              createMockSpatialRow(102, 10)
            ]
          };
        }
        if (sql.includes('LEFT JOIN user_node_discovery')) {
          return {
            rows: [
              { ...watchtowerNode, discovered: true },
              createMockNode(101),
              createMockNode(102)
            ]
          };
        }
        if (sql.includes('world_node_connections')) {
          return {
            rows: [
              createMockConnection(100, 101),
              createMockConnection(101, 102)
            ]
          };
        }
        return { rows: [] };
      });

      const result = await getWatchtowerView(100, 1, mockQuery);

      assert.ok(Array.isArray(result.revealedConnections), 'revealedConnections should be an array');
      assert.strictEqual(result.revealedConnections.length, 2);
      assert.deepStrictEqual(result.revealedConnections[0], { from_node_id: 100, to_node_id: 101 });
      assert.deepStrictEqual(result.revealedConnections[1], { from_node_id: 101, to_node_id: 102 });
    });

    it('should only include connections between revealed nodes', async () => {
      const watchtowerNode = createMockWatchtowerNode();

      mockQuery.mock.mockImplementation(async (sql, params) => {
        if (sql.includes('FROM world_nodes WHERE id')) {
          return { rows: [watchtowerNode] };
        }
        if (sql.includes('SQRT(POWER')) {
          return {
            rows: [
              createMockSpatialRow(100, 0),
              createMockSpatialRow(101, 5)
            ]
          };
        }
        if (sql.includes('LEFT JOIN user_node_discovery')) {
          return {
            rows: [
              { ...watchtowerNode, discovered: true },
              createMockNode(101)
            ]
          };
        }
        if (sql.includes('world_node_connections')) {
          // Only connections where BOTH nodes are in the revealed set
          const nodeIds = params[0];
          assert.ok(Array.isArray(nodeIds), 'Should pass node IDs array to connections query');
          return {
            rows: [createMockConnection(100, 101)]
          };
        }
        return { rows: [] };
      });

      const result = await getWatchtowerView(100, 1, mockQuery);

      assert.strictEqual(result.revealedConnections.length, 1);
    });
  });

  describe('error handling', () => {
    it('should return 400 error for non-watchtower nodes', async () => {
      const townNode = createMockNode(50, { node_type: 'town', name: 'Regular Town' });

      mockQuery.mock.mockImplementation(async (sql) => {
        if (sql.includes('FROM world_nodes WHERE id')) {
          return { rows: [townNode] };
        }
        return { rows: [] };
      });

      await assert.rejects(
        () => getWatchtowerView(50, 1, mockQuery),
        (err) => {
          assert.ok(err instanceof AppError);
          assert.strictEqual(err.statusCode, 400);
          assert.strictEqual(err.message, 'This node is not a watchtower');
          return true;
        }
      );
    });

    it('should return 400 error for invalid (NaN) node IDs', async () => {
      await assert.rejects(
        () => getWatchtowerView(NaN, 1, mockQuery),
        (err) => {
          assert.ok(err instanceof AppError);
          assert.strictEqual(err.statusCode, 400);
          assert.strictEqual(err.message, 'Invalid node ID');
          return true;
        }
      );
    });

    it('should return 404 error for non-existent node IDs', async () => {
      mockQuery.mock.mockImplementation(async () => {
        return { rows: [] };
      });

      await assert.rejects(
        () => getWatchtowerView(99999, 1, mockQuery),
        (err) => {
          assert.ok(err instanceof AppError);
          assert.strictEqual(err.statusCode, 404);
          assert.strictEqual(err.message, 'Node not found');
          return true;
        }
      );
    });

    it('should return 400 error for forest node type', async () => {
      const forestNode = createMockNode(60, { node_type: 'forest', name: 'Dark Forest' });

      mockQuery.mock.mockImplementation(async (sql) => {
        if (sql.includes('FROM world_nodes WHERE id')) {
          return { rows: [forestNode] };
        }
        return { rows: [] };
      });

      await assert.rejects(
        () => getWatchtowerView(60, 1, mockQuery),
        (err) => {
          assert.ok(err instanceof AppError);
          assert.strictEqual(err.statusCode, 400);
          assert.strictEqual(err.message, 'This node is not a watchtower');
          return true;
        }
      );
    });

    it('should return 400 error for castle node type', async () => {
      const castleNode = createMockNode(70, { node_type: 'castle', name: 'Grand Castle' });

      mockQuery.mock.mockImplementation(async (sql) => {
        if (sql.includes('FROM world_nodes WHERE id')) {
          return { rows: [castleNode] };
        }
        return { rows: [] };
      });

      await assert.rejects(
        () => getWatchtowerView(70, 1, mockQuery),
        (err) => {
          assert.ok(err instanceof AppError);
          assert.strictEqual(err.statusCode, 400);
          assert.strictEqual(err.message, 'This node is not a watchtower');
          return true;
        }
      );
    });
  });

  describe('reveal radius calculation', () => {
    it('should calculate correct bounding box for spatial query', async () => {
      const watchtowerNode = createMockWatchtowerNode({
        x_coord: 100,
        y_coord: 100,
        watchtower_reveal_radius: 2
      });

      let capturedParams = null;

      mockQuery.mock.mockImplementation(async (sql, params) => {
        if (sql.includes('FROM world_nodes WHERE id')) {
          return { rows: [watchtowerNode] };
        }
        if (sql.includes('SQRT(POWER')) {
          capturedParams = params;
          return { rows: [{ id: 100, distance_units: 0 }] };
        }
        if (sql.includes('LEFT JOIN user_node_discovery')) {
          return { rows: [{ ...watchtowerNode, discovered: true }] };
        }
        if (sql.includes('world_node_connections')) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      await getWatchtowerView(100, 1, mockQuery);

      // Base radius = 1500px, multiplier = 2, so 3000px
      // In worldgen units: 3000 / 30 = 100 units
      assert.ok(capturedParams, 'Should have captured spatial query params');
      assert.strictEqual(capturedParams[0], 100, 'x_coord should be 100');
      assert.strictEqual(capturedParams[1], 100, 'y_coord should be 100');
      assert.strictEqual(capturedParams[2], 100, 'radius in units should be 100 (3000px / 30)');
    });
  });

  describe('response structure completeness', () => {
    it('should return complete response structure with all three fields', async () => {
      const watchtowerNode = createMockWatchtowerNode();

      mockQuery.mock.mockImplementation(async (sql) => {
        if (sql.includes('FROM world_nodes WHERE id')) {
          return { rows: [watchtowerNode] };
        }
        if (sql.includes('SQRT(POWER')) {
          return { rows: [createMockSpatialRow(100, 0)] };
        }
        if (sql.includes('LEFT JOIN user_node_discovery')) {
          return { rows: [{ ...watchtowerNode, discovered: true }] };
        }
        if (sql.includes('world_node_connections')) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      const result = await getWatchtowerView(100, 1, mockQuery);

      // Verify top-level structure
      assert.ok('watchtowerNode' in result, 'Response should have watchtowerNode');
      assert.ok('revealedNodes' in result, 'Response should have revealedNodes');
      assert.ok('revealedConnections' in result, 'Response should have revealedConnections');

      // Verify watchtowerNode structure
      const wt = result.watchtowerNode;
      assert.ok('id' in wt, 'watchtowerNode should have id');
      assert.ok('name' in wt, 'watchtowerNode should have name');
      assert.ok('x_coord' in wt, 'watchtowerNode should have x_coord');
      assert.ok('y_coord' in wt, 'watchtowerNode should have y_coord');
      assert.ok('node_type' in wt, 'watchtowerNode should have node_type');
      assert.ok('region_id' in wt, 'watchtowerNode should have region_id');
      assert.ok('region_race' in wt, 'watchtowerNode should have region_race');
      assert.ok('reveal_radius_pixels' in wt, 'watchtowerNode should have reveal_radius_pixels');
    });

    it('should return correct node properties in revealedNodes', async () => {
      const watchtowerNode = createMockWatchtowerNode();

      mockQuery.mock.mockImplementation(async (sql) => {
        if (sql.includes('FROM world_nodes WHERE id')) {
          return { rows: [watchtowerNode] };
        }
        if (sql.includes('SQRT(POWER')) {
          return { rows: [createMockSpatialRow(100, 0)] };
        }
        if (sql.includes('LEFT JOIN user_node_discovery')) {
          return {
            rows: [{
              id: 100,
              x_coord: 50,
              y_coord: 50,
              node_type: 'watchtower',
              name: 'Northern Watchtower',
              region_id: 1,
              region_race: 'human',
              difficulty_tier: 1,
              discovered: true
            }]
          };
        }
        if (sql.includes('world_node_connections')) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      const result = await getWatchtowerView(100, 1, mockQuery);
      const node = result.revealedNodes[0];

      // Verify revealedNode structure
      assert.ok('id' in node, 'revealedNode should have id');
      assert.ok('x_coord' in node, 'revealedNode should have x_coord');
      assert.ok('y_coord' in node, 'revealedNode should have y_coord');
      assert.ok('node_type' in node, 'revealedNode should have node_type');
      assert.ok('name' in node, 'revealedNode should have name');
      assert.ok('discovered' in node, 'revealedNode should have discovered');
      assert.ok('region_id' in node, 'revealedNode should have region_id');
      assert.ok('region_race' in node, 'revealedNode should have region_race');
      assert.ok('difficulty_tier' in node, 'revealedNode should have difficulty_tier');
      assert.ok('distance_from_watchtower' in node, 'revealedNode should have distance_from_watchtower');
    });
  });
});
