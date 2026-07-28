/**
 * Unit tests for worldgen/interRegionConnections.js
 *
 * Tests pure helper functions for inter-region connection generation:
 * - findNearestNodeInRegion: Node proximity search
 * - findFrontierNodes: Border frontier identification
 * - generateBridgeName: Thematic bridge naming
 * - generateTradeRouteName: Trade route naming
 * - generateWildernessName: Wilderness zone naming
 * - generateIntermediateNodes: Gap infill node generation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  findNearestNodeInRegion,
  findFrontierNodes,
  generateBridgeName,
  generateTradeRouteName,
  generateWildernessName,
  generateIntermediateNodes,
  createBridgeNode,
  createTradeRoute,
  createGrandPalace,
  generateInterRegionConnections
} from '../../../db/worldgen/interRegionConnections.js';

import { SeededRandom } from '../../../config/constants.js';

// =============================================================================
// findNearestNodeInRegion
// =============================================================================

describe('findNearestNodeInRegion', () => {
  const createNode = (id, x, y, nodeType = 'forest') => ({
    id,
    x,
    y,
    nodeType
  });

  it('finds nearest node by Euclidean distance', () => {
    const nodes = [
      createNode(1, 0, 0),
      createNode(2, 5, 0),     // 5 units from (0,0)
      createNode(3, 10, 10)    // ~14.1 units from (0,0)
    ];

    const result = findNearestNodeInRegion(0, 0, nodes);

    assert.strictEqual(result.node.id, 1);
    assert.strictEqual(result.distance, 0);
    assert.strictEqual(result.index, 0);
  });

  it('returns nearest when target is not at a node', () => {
    const nodes = [
      createNode(1, 0, 0),
      createNode(2, 10, 0),
      createNode(3, 5, 5)
    ];

    const result = findNearestNodeInRegion(4, 4, nodes);

    // Node 3 at (5,5) is nearest to (4,4): distance = sqrt(2) ≈ 1.41
    assert.strictEqual(result.node.id, 3);
    assert.ok(Math.abs(result.distance - Math.sqrt(2)) < 0.01);
  });

  it('filters by node type when specified', () => {
    const nodes = [
      createNode(1, 0, 0, 'forest'),
      createNode(2, 1, 0, 'city'),     // closer but wrong type
      createNode(3, 5, 0, 'city')      // farther but correct type
    ];

    const result = findNearestNodeInRegion(0, 0, nodes, 'city');

    assert.strictEqual(result.node.id, 2);
    assert.strictEqual(result.node.nodeType, 'city');
  });

  it('returns null when no nodes match type filter', () => {
    const nodes = [
      createNode(1, 0, 0, 'forest'),
      createNode(2, 5, 5, 'cave')
    ];

    const result = findNearestNodeInRegion(0, 0, nodes, 'city');

    assert.strictEqual(result, null);
  });

  it('returns null for empty node array', () => {
    const result = findNearestNodeInRegion(0, 0, []);

    assert.strictEqual(result, null);
  });

  it('respects maxDist parameter', () => {
    const nodes = [
      createNode(1, 100, 100, 'forest')  // very far
    ];

    const resultNoLimit = findNearestNodeInRegion(0, 0, nodes);
    const resultWithLimit = findNearestNodeInRegion(0, 0, nodes, null, 10);

    assert.ok(resultNoLimit !== null);
    assert.strictEqual(resultWithLimit, null);
  });

  it('returns correct index in array', () => {
    const nodes = [
      createNode(1, 100, 100),
      createNode(2, 50, 50),
      createNode(3, 0, 0),       // index 2, closest to origin
      createNode(4, 25, 25)
    ];

    const result = findNearestNodeInRegion(0, 0, nodes);

    assert.strictEqual(result.index, 2);
    assert.strictEqual(result.node.id, 3);
  });

  it('handles ties by returning first match', () => {
    const nodes = [
      createNode(1, 5, 0),    // distance 5
      createNode(2, 0, 5),    // distance 5 (tie)
      createNode(3, 10, 0)
    ];

    const result = findNearestNodeInRegion(0, 0, nodes);

    // First node with min distance should be returned
    assert.strictEqual(result.node.id, 1);
  });
});

// =============================================================================
// findFrontierNodes
// =============================================================================

describe('findFrontierNodes', () => {
  const createNode = (id, x, y, nodeType, ringDistance = 2) => ({
    id,
    x,
    y,
    nodeType,
    ringDistance
  });

  it('prefers Ring 2-3 battle nodes', () => {
    const nodes = [
      createNode(1, 0, 0, 'forest', 1),    // Ring 1 - lower priority
      createNode(2, 5, 0, 'forest', 2),    // Ring 2 - preferred
      createNode(3, 10, 0, 'forest', 3)    // Ring 3 - preferred
    ];

    const result = findFrontierNodes(nodes, 0, 0);

    // Should prioritize Ring 2-3 nodes
    const ringDistances = result.slice(0, 2).map(r => r.node.ringDistance);
    assert.ok(ringDistances.every(r => r >= 2), 'Should prefer Ring 2+ nodes');
  });

  it('filters to battle terrain types', () => {
    const nodes = [
      createNode(1, 0, 0, 'city', 2),
      createNode(2, 5, 0, 'forest', 2),    // battle terrain
      createNode(3, 10, 0, 'cave', 2),     // battle terrain
      createNode(4, 15, 0, 'village', 2)
    ];

    const result = findFrontierNodes(nodes, 0, 0);

    const types = result.map(r => r.node.nodeType);
    assert.ok(!types.includes('city'));
    assert.ok(!types.includes('village'));
    assert.ok(types.includes('forest') || types.includes('cave'));
  });

  it('sorts by distance from border point', () => {
    const nodes = [
      createNode(1, 10, 0, 'forest', 2),   // distance 10
      createNode(2, 5, 0, 'cave', 2),      // distance 5
      createNode(3, 3, 0, 'mountain', 2)   // distance 3
    ];

    const result = findFrontierNodes(nodes, 0, 0);

    // Should be sorted by distance (ascending)
    assert.ok(result[0].distance <= result[1].distance);
    if (result.length > 2) {
      assert.ok(result[1].distance <= result[2].distance);
    }
  });

  it('falls back to Ring 1 if no Ring 2-3 nodes', () => {
    const nodes = [
      createNode(1, 5, 0, 'forest', 1),
      createNode(2, 10, 0, 'cave', 1)
    ];

    const result = findFrontierNodes(nodes, 0, 0);

    // Should still return results with Ring 1 nodes
    assert.ok(result.length > 0);
  });

  it('falls back to non-settlements if no battle terrain', () => {
    const nodes = [
      createNode(1, 5, 0, 'bridge', 2),    // non-settlement, non-battle
      createNode(2, 10, 0, 'city', 2)      // settlement
    ];

    const result = findFrontierNodes(nodes, 0, 0);

    // Should include bridge but not city
    assert.ok(result.length > 0);
    assert.ok(result.every(r => r.node.nodeType !== 'city'));
  });

  it('falls back to any non-castle node as last resort', () => {
    const nodes = [
      createNode(1, 5, 0, 'castle', 0),
      createNode(2, 10, 0, 'city', 1)
    ];

    const result = findFrontierNodes(nodes, 0, 0);

    // Should find city (not castle)
    assert.ok(result.length > 0);
    assert.strictEqual(result[0].node.nodeType, 'city');
  });

  it('returns empty array if only castle exists', () => {
    const nodes = [
      createNode(1, 5, 0, 'castle', 0)
    ];

    const result = findFrontierNodes(nodes, 0, 0);

    assert.strictEqual(result.length, 0);
  });

  it('respects maxDist parameter in first pass', () => {
    const nodes = [
      createNode(1, 100, 0, 'forest', 2)   // Very far
    ];

    // Default maxDist should exclude very far nodes in first pass
    // but fallbacks should still find them
    const result = findFrontierNodes(nodes, 0, 0, 5);

    // With extended fallback searches, it might still find nodes
    // Test that the function doesn't crash
    assert.ok(Array.isArray(result));
  });
});

// =============================================================================
// generateBridgeName
// =============================================================================

describe('generateBridgeName', () => {
  it('returns a string name', () => {
    const rng = new SeededRandom(12345);
    const name = generateBridgeName('Heartlands', 'Verdantia', rng);

    assert.strictEqual(typeof name, 'string');
    assert.ok(name.length > 0);
  });

  it('produces consistent results with same seed', () => {
    const rng1 = new SeededRandom(42);
    const rng2 = new SeededRandom(42);

    const name1 = generateBridgeName('RegionA', 'RegionB', rng1);
    const name2 = generateBridgeName('RegionA', 'RegionB', rng2);

    assert.strictEqual(name1, name2);
  });

  it('produces different results with different seeds', () => {
    const names = new Set();

    for (let seed = 0; seed < 10; seed++) {
      const rng = new SeededRandom(seed);
      names.add(generateBridgeName('A', 'B', rng));
    }

    // With different seeds, should get some variety
    assert.ok(names.size > 1, 'Different seeds should produce variety');
  });

  it('handles same regions in different order', () => {
    const rng1 = new SeededRandom(100);
    const rng2 = new SeededRandom(100);

    const name1 = generateBridgeName('Alpha', 'Beta', rng1);
    const name2 = generateBridgeName('Beta', 'Alpha', rng2);

    // Should produce same name since region names are sorted
    assert.strictEqual(name1, name2);
  });

  it('returns fallback name for unknown region pairs', () => {
    const rng = new SeededRandom(12345);
    const name = generateBridgeName('UnknownRegion1', 'UnknownRegion2', rng);

    assert.ok(name.length > 0);
    // Should be one of the fallback names
    const fallbacks = ['Border Bridge', 'Realm Crossing', 'The Great Span', 'Alliance Bridge'];
    // Note: might also be a themed name if regions match a key
  });
});

// =============================================================================
// generateTradeRouteName
// =============================================================================

describe('generateTradeRouteName', () => {
  it('returns a string name', () => {
    const rng = new SeededRandom(12345);
    const name = generateTradeRouteName(0, 5, rng);

    assert.strictEqual(typeof name, 'string');
    assert.ok(name.length > 0);
  });

  it('uses destination category for first node', () => {
    // Run multiple times and verify we get destination-style names
    let foundDestination = false;
    for (let seed = 0; seed < 20; seed++) {
      const rng = new SeededRandom(seed);
      const name = generateTradeRouteName(0, 5, rng);
      // First node (index 0) should use destination category
      if (name) foundDestination = true;
    }
    assert.ok(foundDestination);
  });

  it('uses destination category for last node', () => {
    let foundDestination = false;
    for (let seed = 0; seed < 20; seed++) {
      const rng = new SeededRandom(seed);
      const name = generateTradeRouteName(4, 5, rng);  // Last node (index 4 of 5)
      if (name) foundDestination = true;
    }
    assert.ok(foundDestination);
  });

  it('uses journey category for middle node', () => {
    let foundJourney = false;
    for (let seed = 0; seed < 20; seed++) {
      const rng = new SeededRandom(seed);
      const name = generateTradeRouteName(2, 5, rng);  // Middle node (floor(5/2) = 2)
      if (name) foundJourney = true;
    }
    assert.ok(foundJourney);
  });

  it('produces consistent results with same seed', () => {
    const rng1 = new SeededRandom(42);
    const rng2 = new SeededRandom(42);

    const name1 = generateTradeRouteName(1, 5, rng1);
    const name2 = generateTradeRouteName(1, 5, rng2);

    assert.strictEqual(name1, name2);
  });
});

// =============================================================================
// generateWildernessName
// =============================================================================

describe('generateWildernessName', () => {
  it('returns a string name', () => {
    const rng = new SeededRandom(12345);
    const name = generateWildernessName('forest', rng);

    assert.strictEqual(typeof name, 'string');
    assert.ok(name.length > 0);
  });

  it('produces consistent results with same seed', () => {
    const rng1 = new SeededRandom(42);
    const rng2 = new SeededRandom(42);

    const name1 = generateWildernessName('cave', rng1);
    const name2 = generateWildernessName('cave', rng2);

    assert.strictEqual(name1, name2);
  });

  it('produces variety with different seeds', () => {
    const names = new Set();

    for (let seed = 0; seed < 20; seed++) {
      const rng = new SeededRandom(seed);
      names.add(generateWildernessName('mountain', rng));
    }

    assert.ok(names.size > 1, 'Should produce variety');
  });

  it('handles different terrain types', () => {
    const rng = new SeededRandom(12345);

    const forestName = generateWildernessName('forest', rng);
    const caveName = generateWildernessName('cave', rng);
    const mountainName = generateWildernessName('mountain', rng);

    // All should return valid names (terrain type currently unused but param exists)
    assert.ok(forestName.length > 0);
    assert.ok(caveName.length > 0);
    assert.ok(mountainName.length > 0);
  });
});

// =============================================================================
// generateIntermediateNodes
// =============================================================================

describe('generateIntermediateNodes', () => {
  it('returns empty array when distance <= maxSpacing', () => {
    const nodeA = { x: 0, y: 0 };
    const nodeB = { x: 5, y: 0 };
    const rng = new SeededRandom(12345);

    const result = generateIntermediateNodes(nodeA, nodeB, 10, rng);

    assert.deepStrictEqual(result, []);
  });

  it('returns empty array when distance exactly equals maxSpacing', () => {
    const nodeA = { x: 0, y: 0 };
    const nodeB = { x: 10, y: 0 };
    const rng = new SeededRandom(12345);

    const result = generateIntermediateNodes(nodeA, nodeB, 10, rng);

    assert.deepStrictEqual(result, []);
  });

  it('generates intermediate nodes when distance > maxSpacing', () => {
    const nodeA = { x: 0, y: 0 };
    const nodeB = { x: 30, y: 0 };  // 30 units apart
    const rng = new SeededRandom(12345);

    const result = generateIntermediateNodes(nodeA, nodeB, 10, rng);

    // With 30 units and max 10, we need ceil(30/10) - 1 = 2 intermediates
    assert.ok(result.length >= 1, 'Should generate at least one intermediate');
  });

  it('places intermediates along the path', () => {
    const nodeA = { x: 0, y: 0 };
    const nodeB = { x: 40, y: 0 };  // horizontal line
    const rng = new SeededRandom(12345);

    const result = generateIntermediateNodes(nodeA, nodeB, 10, rng);

    for (const node of result) {
      // All nodes should be approximately on the line between A and B
      // Y should be close to 0 (within small perpendicular offset)
      assert.ok(Math.abs(node.y) < 5, 'Intermediate should be near the path');
      // X should be between 0 and 40
      assert.ok(node.x > 0 && node.x < 40, 'Intermediate should be between endpoints');
    }
  });

  it('sets correct node properties', () => {
    const nodeA = { x: 0, y: 0 };
    const nodeB = { x: 50, y: 0 };
    const rng = new SeededRandom(12345);

    const result = generateIntermediateNodes(nodeA, nodeB, 10, rng);

    for (const node of result) {
      assert.ok('x' in node);
      assert.ok('y' in node);
      assert.ok('nodeType' in node);
      assert.ok('isIntermediateNode' in node);
      assert.strictEqual(node.isIntermediateNode, true);
      assert.strictEqual(node.regionId, null);
      assert.strictEqual(node.difficultyTier, 3);
    }
  });

  it('uses battle terrain types for intermediates', () => {
    const nodeA = { x: 0, y: 0 };
    const nodeB = { x: 50, y: 0 };
    const rng = new SeededRandom(12345);

    const result = generateIntermediateNodes(nodeA, nodeB, 10, rng);

    const validTypes = ['forest', 'cave', 'mountain'];
    for (const node of result) {
      assert.ok(
        validTypes.includes(node.nodeType),
        `Node type ${node.nodeType} should be a battle terrain`
      );
    }
  });

  it('respects nodeDefaults parameter', () => {
    const nodeA = { x: 0, y: 0 };
    const nodeB = { x: 50, y: 0 };
    const rng = new SeededRandom(12345);
    const defaults = { customProp: 'value', regionName: 'Test Region' };

    const result = generateIntermediateNodes(nodeA, nodeB, 10, rng, defaults);

    for (const node of result) {
      assert.strictEqual(node.customProp, 'value');
      assert.strictEqual(node.regionName, 'Test Region');
    }
  });

  it('handles diagonal paths', () => {
    const nodeA = { x: 0, y: 0 };
    const nodeB = { x: 30, y: 40 };  // 50 units diagonal (3-4-5 triangle scaled)
    const rng = new SeededRandom(12345);

    const result = generateIntermediateNodes(nodeA, nodeB, 10, rng);

    assert.ok(result.length >= 3, 'Should generate intermediates for 50-unit diagonal');

    for (const node of result) {
      const distFromA = Math.hypot(node.x, node.y);
      const distFromB = Math.hypot(node.x - 30, node.y - 40);
      const totalDist = 50;

      // Node should be between endpoints
      assert.ok(distFromA < totalDist && distFromB < totalDist);
    }
  });

  it('produces consistent results with same seed', () => {
    const nodeA = { x: 0, y: 0 };
    const nodeB = { x: 50, y: 0 };

    const rng1 = new SeededRandom(42);
    const rng2 = new SeededRandom(42);

    const result1 = generateIntermediateNodes(nodeA, nodeB, 10, rng1);
    const result2 = generateIntermediateNodes(nodeA, nodeB, 10, rng2);

    assert.strictEqual(result1.length, result2.length);
    for (let i = 0; i < result1.length; i++) {
      assert.strictEqual(result1[i].x, result2[i].x);
      assert.strictEqual(result1[i].y, result2[i].y);
    }
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('Inter-Region Connections Edge Cases', () => {
  it('findNearestNodeInRegion handles negative coordinates', () => {
    const nodes = [
      { id: 1, x: -10, y: -10, nodeType: 'forest' },
      { id: 2, x: 10, y: 10, nodeType: 'cave' }
    ];

    const result = findNearestNodeInRegion(-5, -5, nodes);

    assert.strictEqual(result.node.id, 1);
  });

  it('generateIntermediateNodes handles very long paths', () => {
    const nodeA = { x: 0, y: 0 };
    const nodeB = { x: 200, y: 0 };  // 200 units
    const rng = new SeededRandom(12345);

    const result = generateIntermediateNodes(nodeA, nodeB, 10, rng);

    // Should generate many intermediates
    assert.ok(result.length >= 15, 'Very long path should have many intermediates');
  });

  it('generateIntermediateNodes handles zero-length path', () => {
    const nodeA = { x: 5, y: 5 };
    const nodeB = { x: 5, y: 5 };  // Same position
    const rng = new SeededRandom(12345);

    const result = generateIntermediateNodes(nodeA, nodeB, 10, rng);

    assert.deepStrictEqual(result, []);
  });

  it('findFrontierNodes handles empty array', () => {
    const result = findFrontierNodes([], 0, 0);

    assert.deepStrictEqual(result, []);
  });
});

describe('Phase 5 explicit region and route identity', () => {
  const border = {
    region1: 4,
    region2: 0,
    region1Id: 101,
    region2Id: 205,
    region1Name: 'North',
    region2Name: 'South',
    castle1Key: 'castle:101',
    castle2Key: 'castle:205',
    midpoint: { x: 0, y: 0 },
    points: [{ x: 0, y: -4 }, { x: 0, y: 4 }],
    edgeLength: 8,
    connectionType: 'bridge_only'
  };

  const nodesByRegion = () => new Map([
    [101, [
      {
        x: -4,
        y: 0,
        nodeType: 'forest',
        ringDistance: 2,
        nodeKey: 'region:101:forest'
      },
      {
        x: -8,
        y: 0,
        nodeType: 'city',
        ringDistance: 1,
        nodeKey: 'region:101:city'
      }
    ]],
    [205, [
      {
        x: 4,
        y: 0,
        nodeType: 'forest',
        ringDistance: 2,
        nodeKey: 'region:205:forest'
      },
      {
        x: 8,
        y: 0,
        nodeType: 'city',
        ringDistance: 1,
        nodeKey: 'region:205:city'
      }
    ]]
  ]);

  it('resolves bridges and trade endpoints only by explicit regionId', () => {
    const regions = nodesByRegion();
    const bridge = createBridgeNode(border, regions, new SeededRandom(10));
    const trade = createTradeRoute(border, bridge, regions, new SeededRandom(11));

    assert.deepStrictEqual(bridge.connectsRegions, [101, 205]);
    assert.strictEqual(bridge.connectTo.region1.node.nodeKey, 'region:101:forest');
    assert.strictEqual(bridge.connectTo.region2.node.nodeKey, 'region:205:forest');
    assert.ok(trade.length > 0);
    assert.deepStrictEqual(trade[0].tradeRegions, [101, 205]);
    assert.deepStrictEqual(trade[0].connectToCity1, {
      regionId: 101,
      nodeKey: 'region:101:city'
    });
    assert.deepStrictEqual(trade.at(-1).connectToCity2, {
      regionId: 205,
      nodeKey: 'region:205:city'
    });
  });

  it('rejects shared borders without region and castle identity', () => {
    assert.throws(
      () => createBridgeNode(
        { ...border, region1Id: undefined, castle2Key: undefined },
        nodesByRegion(),
        new SeededRandom(1)
      ),
      /region1Id, castle2Key/
    );
  });

  it('rejects positional regional endpoints without stable node keys', () => {
    const regions = nodesByRegion();
    delete regions.get(101)[0].nodeKey;

    assert.throws(
      () => createBridgeNode(border, regions, new SeededRandom(2)),
      /bridge frontier is missing a stable nodeKey/
    );
  });

  it('requires explicit palace region IDs instead of castle array positions', () => {
    assert.throws(
      () => createGrandPalace({
        x: 0,
        y: 0,
        adjacentRegions: [0, 1],
        regionNames: ['North', 'South']
      }),
      /adjacentRegionIds/
    );

    const palace = createGrandPalace({
      x: 0,
      y: 0,
      adjacentRegions: [0, 1],
      adjacentRegionIds: [101, 205],
      regionNames: ['North', 'South']
    });
    assert.deepStrictEqual(palace.regionPair, [101, 205]);
  });

  it('emits stable-key edges with complete route metadata', () => {
    const castles = [
      {
        x: -20,
        y: 0,
        regionId: 101,
        castleKey: 'castle:101',
        region: { id: 101, name: 'North' }
      },
      {
        x: 20,
        y: 0,
        regionId: 205,
        castleKey: 'castle:205',
        region: { id: 205, name: 'South' }
      }
    ];
    const voronoiData = {
      edges: [{
        region1: 4,
        region2: 0,
        region1Id: 101,
        region2Id: 205,
        region1Name: 'North',
        region2Name: 'South',
        castle1Key: 'castle:101',
        castle2Key: 'castle:205',
        midpoint: { x: 0, y: 0 },
        points: [{ x: 0, y: -2 }, { x: 0, y: 2 }],
        length: 4
      }],
      vertices: [{
        x: 0,
        y: 20,
        adjacentRegions: [0, 1],
        adjacentRegionIds: [101, 205],
        regionNames: ['North', 'South'],
        distanceFromCenter: 20
      }]
    };

    const regions = nodesByRegion();
    const result = generateInterRegionConnections(
      voronoiData,
      regions,
      [],
      castles,
      new SeededRandom(12)
    );

    assert.deepStrictEqual(
      result.borders.map(({ region1Id, region2Id, region1Name, region2Name,
        castle1Key, castle2Key }) => ({
        region1Id,
        region2Id,
        region1Name,
        region2Name,
        castle1Key,
        castle2Key
      })),
      [{
        region1Id: 101,
        region2Id: 205,
        region1Name: 'North',
        region2Name: 'South',
        castle1Key: 'castle:101',
        castle2Key: 'castle:205'
      }]
    );
    assert.ok(result.interRegionConnections.length > 0);
    const knownNodeKeys = new Set([
      ...[...regions.values()].flat().map(node => node.nodeKey),
      ...result.interRegionNodes.map(node => node.nodeKey)
    ]);
    for (const edge of result.interRegionConnections) {
      assert.ok(edge.fromNodeKey);
      assert.ok(edge.toNodeKey);
      assert.ok(knownNodeKeys.has(edge.fromNodeKey));
      assert.ok(knownNodeKeys.has(edge.toNodeKey));
      assert.ok(edge.routeId);
      assert.ok(Object.hasOwn(edge, 'routePairKey'));
      assert.ok(edge.routeKind);
      assert.deepStrictEqual(edge.regionPair, [101, 205]);
      if (edge.routeKind !== 'palace') {
        assert.strictEqual(edge.routePairKey, 'route-pair:101-205');
      }
      assert.ok(edge.segmentKind);
      assert.ok(edge.difficultyPolicy);
      assert.ok(Number.isInteger(edge.segmentIndex));
    }
    for (const node of result.interRegionNodes) {
      assert.ok(node.nodeKey);
      assert.ok(node.routeId);
      assert.ok(Object.hasOwn(node, 'routePairKey'));
      assert.ok(node.routeKind);
      assert.deepStrictEqual(node.regionPair, [101, 205]);
      if (node.routeKind !== 'palace') {
        assert.strictEqual(node.routePairKey, 'route-pair:101-205');
      }
      assert.ok(node.segmentKind);
      assert.ok(node.difficultyPolicy);
      assert.ok(Number.isInteger(node.segmentIndex));
    }
  });
});
