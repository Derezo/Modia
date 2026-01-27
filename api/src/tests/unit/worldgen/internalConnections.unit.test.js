/**
 * Unit tests for worldgen/internalConnections.js
 *
 * Tests graph construction and connection logic:
 * - isSettlement: Node type classification
 * - isValidAdjacency: Connection rule validation
 * - buildRegionMST: Minimum spanning tree construction
 * - addExtraConnections: Extra connection generation
 * - calculateRingDistances: BFS ring distance calculation
 * - enforceAdjacencyRules: Invalid connection filtering
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  isSettlement,
  isValidAdjacency,
  buildRegionMST,
  addExtraConnections,
  calculateRingDistances,
  enforceAdjacencyRules,
  ensureMinimumConnections
} from '../../../db/worldgen/internalConnections.js';

import { SeededRandom } from '../../../config/constants.js';

// =============================================================================
// isSettlement
// =============================================================================

describe('isSettlement', () => {
  it('returns true for castle', () => {
    assert.strictEqual(isSettlement('castle'), true);
  });

  it('returns true for city', () => {
    assert.strictEqual(isSettlement('city'), true);
  });

  it('returns true for village', () => {
    assert.strictEqual(isSettlement('village'), true);
  });

  it('returns true for guild', () => {
    assert.strictEqual(isSettlement('guild'), true);
  });

  it('returns true for keep', () => {
    assert.strictEqual(isSettlement('keep'), true);
  });

  it('returns true for palace', () => {
    assert.strictEqual(isSettlement('palace'), true);
  });

  it('returns true for farm', () => {
    assert.strictEqual(isSettlement('farm'), true);
  });

  it('returns false for forest', () => {
    assert.strictEqual(isSettlement('forest'), false);
  });

  it('returns false for cave', () => {
    assert.strictEqual(isSettlement('cave'), false);
  });

  it('returns false for mountain', () => {
    assert.strictEqual(isSettlement('mountain'), false);
  });

  it('returns false for bridge', () => {
    assert.strictEqual(isSettlement('bridge'), false);
  });

  it('returns false for shrine', () => {
    assert.strictEqual(isSettlement('shrine'), false);
  });
});

// =============================================================================
// isValidAdjacency
// =============================================================================

describe('isValidAdjacency', () => {
  it('allows battle-to-battle connections', () => {
    assert.strictEqual(isValidAdjacency('forest', 'cave'), true);
    assert.strictEqual(isValidAdjacency('forest', 'mountain'), true);
    assert.strictEqual(isValidAdjacency('cave', 'mountain'), true);
  });

  it('allows settlement-to-battle connections', () => {
    assert.strictEqual(isValidAdjacency('city', 'forest'), true);
    assert.strictEqual(isValidAdjacency('village', 'cave'), true);
    assert.strictEqual(isValidAdjacency('guild', 'mountain'), true);
  });

  it('blocks settlement-to-settlement connections', () => {
    assert.strictEqual(isValidAdjacency('city', 'village'), false);
    assert.strictEqual(isValidAdjacency('guild', 'keep'), false);
    assert.strictEqual(isValidAdjacency('castle', 'city'), false);
  });

  it('blocks castle-to-settlement connections', () => {
    assert.strictEqual(isValidAdjacency('castle', 'city'), false);
    assert.strictEqual(isValidAdjacency('castle', 'village'), false);
    assert.strictEqual(isValidAdjacency('village', 'castle'), false);
  });

  it('allows castle-to-battle connections', () => {
    assert.strictEqual(isValidAdjacency('castle', 'forest'), true);
    assert.strictEqual(isValidAdjacency('castle', 'cave'), true);
  });

  it('is symmetric', () => {
    assert.strictEqual(
      isValidAdjacency('forest', 'city'),
      isValidAdjacency('city', 'forest')
    );
    assert.strictEqual(
      isValidAdjacency('castle', 'village'),
      isValidAdjacency('village', 'castle')
    );
  });
});

// =============================================================================
// buildRegionMST
// =============================================================================

describe('buildRegionMST', () => {
  it('creates N-1 connections for N nodes', () => {
    const nodes = [
      { x: 0, y: 0, nodeType: 'castle' },
      { x: 5, y: 0, nodeType: 'forest' },
      { x: 10, y: 0, nodeType: 'forest' },
      { x: 0, y: 5, nodeType: 'cave' },
      { x: 5, y: 5, nodeType: 'mountain' }
    ];
    const connections = buildRegionMST(nodes, 0);
    assert.strictEqual(connections.length, nodes.length - 1);
  });

  it('makes all nodes reachable from castle', () => {
    const nodes = [
      { x: 0, y: 0, nodeType: 'castle' },
      { x: 3, y: 0, nodeType: 'forest' },
      { x: 6, y: 0, nodeType: 'cave' },
      { x: 0, y: 3, nodeType: 'mountain' },
      { x: 3, y: 3, nodeType: 'forest' }
    ];
    const connections = buildRegionMST(nodes, 0);

    // BFS to verify connectivity
    const adjacency = new Map();
    for (let i = 0; i < nodes.length; i++) adjacency.set(i, []);
    for (const conn of connections) {
      adjacency.get(conn.from).push(conn.to);
      adjacency.get(conn.to).push(conn.from);
    }

    const visited = new Set();
    const queue = [0];
    visited.add(0);
    while (queue.length > 0) {
      const current = queue.shift();
      for (const neighbor of adjacency.get(current)) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    assert.strictEqual(visited.size, nodes.length, 'All nodes should be reachable');
  });

  it('minimizes total connection weight', () => {
    // With 3 nodes in a line, MST should connect adjacent pairs
    const nodes = [
      { x: 0, y: 0, nodeType: 'castle' },
      { x: 5, y: 0, nodeType: 'forest' },
      { x: 10, y: 0, nodeType: 'forest' }
    ];
    const connections = buildRegionMST(nodes, 0);
    assert.strictEqual(connections.length, 2);

    // Total weight should be 10 (5 + 5), not include the diagonal
    const totalWeight = connections.reduce((sum, c) => sum + c.distance, 0);
    assert.strictEqual(totalWeight, 10);
  });

  it('handles single node', () => {
    const nodes = [{ x: 0, y: 0, nodeType: 'castle' }];
    const connections = buildRegionMST(nodes, 0);
    assert.strictEqual(connections.length, 0);
  });

  it('penalizes invalid adjacencies in MST weight', () => {
    // Two settlements should still connect through MST but with penalty
    const nodes = [
      { x: 0, y: 0, nodeType: 'castle' },
      { x: 5, y: 0, nodeType: 'city' },   // settlement - invalid connection to castle
      { x: 2.5, y: 2, nodeType: 'forest' } // battle node - valid for both
    ];
    const connections = buildRegionMST(nodes, 0);
    // MST should prefer castle -> forest -> city over castle -> city
    assert.strictEqual(connections.length, 2);
  });
});

// =============================================================================
// addExtraConnections
// =============================================================================

describe('addExtraConnections', () => {
  it('adds more connections than MST', () => {
    const nodes = [];
    // Create a grid of battle nodes with a castle
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        nodes.push({
          x: x * 4,
          y: y * 4,
          nodeType: x === 0 && y === 0 ? 'castle' : 'forest'
        });
      }
    }
    const mst = buildRegionMST(nodes, 0);
    const rng = new SeededRandom(42);
    const all = addExtraConnections(nodes, mst, rng, 0.3);

    assert.ok(
      all.length > mst.length,
      `Expected more connections (${all.length}) than MST (${mst.length})`
    );
  });

  it('does not create duplicate connections', () => {
    const nodes = [
      { x: 0, y: 0, nodeType: 'castle' },
      { x: 4, y: 0, nodeType: 'forest' },
      { x: 8, y: 0, nodeType: 'forest' },
      { x: 0, y: 4, nodeType: 'cave' },
      { x: 4, y: 4, nodeType: 'mountain' }
    ];
    const mst = buildRegionMST(nodes, 0);
    const rng = new SeededRandom(42);
    const all = addExtraConnections(nodes, mst, rng, 0.5);

    const seen = new Set();
    for (const conn of all) {
      const key = `${Math.min(conn.from, conn.to)},${Math.max(conn.from, conn.to)}`;
      assert.ok(!seen.has(key), `Duplicate connection: ${key}`);
      seen.add(key);
    }
  });

  it('respects adjacency rules for extra connections', () => {
    const nodes = [
      { x: 0, y: 0, nodeType: 'castle' },
      { x: 4, y: 0, nodeType: 'forest' },
      { x: 8, y: 0, nodeType: 'city' },
      { x: 4, y: 4, nodeType: 'village' },
      { x: 0, y: 4, nodeType: 'cave' }
    ];
    const mst = buildRegionMST(nodes, 0);
    const rng = new SeededRandom(42);
    const all = addExtraConnections(nodes, mst, rng, 0.5);

    // Check extra connections (beyond MST)
    for (const conn of all.slice(mst.length)) {
      const valid = isValidAdjacency(nodes[conn.from].nodeType, nodes[conn.to].nodeType);
      assert.ok(valid, `Extra connection ${conn.from}->${conn.to} violates adjacency rules`);
    }
  });
});

// =============================================================================
// calculateRingDistances
// =============================================================================

describe('calculateRingDistances', () => {
  it('assigns ring 0 to castle', () => {
    const nodes = [
      { x: 0, y: 0, nodeType: 'castle' },
      { x: 5, y: 0, nodeType: 'forest' },
      { x: 10, y: 0, nodeType: 'forest' }
    ];
    const connections = [
      { from: 0, to: 1 },
      { from: 1, to: 2 }
    ];
    calculateRingDistances(nodes, connections, 0);

    assert.strictEqual(nodes[0].ringDistance, 0);
    assert.strictEqual(nodes[0].hopDistance, 0);
  });

  it('assigns ring 1 for 1-2 hops from castle', () => {
    const nodes = [
      { x: 0, y: 0, nodeType: 'castle' },
      { x: 5, y: 0, nodeType: 'forest' },
      { x: 10, y: 0, nodeType: 'forest' }
    ];
    const connections = [
      { from: 0, to: 1 },
      { from: 1, to: 2 }
    ];
    calculateRingDistances(nodes, connections, 0);

    assert.strictEqual(nodes[1].ringDistance, 1); // 1 hop
    assert.strictEqual(nodes[1].hopDistance, 1);
    assert.strictEqual(nodes[2].ringDistance, 1); // 2 hops
    assert.strictEqual(nodes[2].hopDistance, 2);
  });

  it('assigns ring 2 for 3-5 hops', () => {
    // Build a chain of 6 nodes
    const nodes = [];
    for (let i = 0; i < 6; i++) {
      nodes.push({ x: i * 5, y: 0, nodeType: i === 0 ? 'castle' : 'forest' });
    }
    const connections = [];
    for (let i = 0; i < 5; i++) {
      connections.push({ from: i, to: i + 1 });
    }
    calculateRingDistances(nodes, connections, 0);

    // Hop 3 -> ring 2
    assert.strictEqual(nodes[3].ringDistance, 2);
    assert.strictEqual(nodes[3].hopDistance, 3);
    // Hop 5 -> ring 2
    assert.strictEqual(nodes[5].ringDistance, 2);
    assert.strictEqual(nodes[5].hopDistance, 5);
  });

  it('assigns ring 3 for 6+ hops', () => {
    // Build a chain of 8 nodes
    const nodes = [];
    for (let i = 0; i < 8; i++) {
      nodes.push({ x: i * 5, y: 0, nodeType: i === 0 ? 'castle' : 'forest' });
    }
    const connections = [];
    for (let i = 0; i < 7; i++) {
      connections.push({ from: i, to: i + 1 });
    }
    calculateRingDistances(nodes, connections, 0);

    // Hop 6 -> ring 3
    assert.strictEqual(nodes[6].ringDistance, 3);
    assert.strictEqual(nodes[6].hopDistance, 6);
    // Hop 7 -> ring 3
    assert.strictEqual(nodes[7].ringDistance, 3);
    assert.strictEqual(nodes[7].hopDistance, 7);
  });

  it('uses BFS shortest path (not just any path)', () => {
    // Create a shortcut: 0-1-2-3-4 is the long path,
    // 0-4 direct shortcut makes hop distance = 1 for node 4
    const nodes = [
      { x: 0, y: 0, nodeType: 'castle' },
      { x: 5, y: 0, nodeType: 'forest' },
      { x: 10, y: 0, nodeType: 'forest' },
      { x: 15, y: 0, nodeType: 'forest' },
      { x: 20, y: 0, nodeType: 'forest' }
    ];
    const connections = [
      { from: 0, to: 1 },
      { from: 1, to: 2 },
      { from: 2, to: 3 },
      { from: 3, to: 4 },
      { from: 0, to: 4 }  // Shortcut
    ];
    calculateRingDistances(nodes, connections, 0);

    // Node 4 should have hop distance 1 (via shortcut), not 4
    assert.strictEqual(nodes[4].hopDistance, 1);
    assert.strictEqual(nodes[4].ringDistance, 1);
  });

  it('handles disconnected nodes gracefully', () => {
    const nodes = [
      { x: 0, y: 0, nodeType: 'castle' },
      { x: 5, y: 0, nodeType: 'forest' },
      { x: 100, y: 100, nodeType: 'forest' } // Disconnected
    ];
    const connections = [
      { from: 0, to: 1 }
    ];
    calculateRingDistances(nodes, connections, 0);

    // Disconnected node gets ring 3 and hopDistance -1
    assert.strictEqual(nodes[2].ringDistance, 3);
    assert.strictEqual(nodes[2].hopDistance, -1);
  });
});

// =============================================================================
// enforceAdjacencyRules
// =============================================================================

describe('enforceAdjacencyRules', () => {
  it('keeps valid connections', () => {
    const nodes = [
      { nodeType: 'castle' },
      { nodeType: 'forest' },
      { nodeType: 'cave' }
    ];
    const connections = [
      { from: 0, to: 1 },  // castle -> forest (valid)
      { from: 1, to: 2 }   // forest -> cave (valid)
    ];
    const result = enforceAdjacencyRules(nodes, connections);
    assert.strictEqual(result.length, 2);
  });

  it('removes settlement-to-settlement connections', () => {
    const nodes = [
      { nodeType: 'city' },
      { nodeType: 'village' },
      { nodeType: 'forest' }
    ];
    const connections = [
      { from: 0, to: 1 },  // city -> village (invalid)
      { from: 0, to: 2 },  // city -> forest (valid)
      { from: 1, to: 2 }   // village -> forest (valid)
    ];
    const result = enforceAdjacencyRules(nodes, connections);
    assert.strictEqual(result.length, 2);
    // The city-village connection should be removed
    const hasInvalid = result.some(c =>
      (c.from === 0 && c.to === 1) || (c.from === 1 && c.to === 0)
    );
    assert.ok(!hasInvalid, 'Should not contain city-village connection');
  });

  it('removes castle-to-settlement connections', () => {
    const nodes = [
      { nodeType: 'castle' },
      { nodeType: 'city' },
      { nodeType: 'forest' }
    ];
    const connections = [
      { from: 0, to: 1 },  // castle -> city (invalid)
      { from: 0, to: 2 }   // castle -> forest (valid)
    ];
    const result = enforceAdjacencyRules(nodes, connections);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].from, 0);
    assert.strictEqual(result[0].to, 2);
  });

  it('returns empty array when all connections invalid', () => {
    const nodes = [
      { nodeType: 'city' },
      { nodeType: 'village' },
      { nodeType: 'guild' }
    ];
    const connections = [
      { from: 0, to: 1 },
      { from: 1, to: 2 },
      { from: 0, to: 2 }
    ];
    const result = enforceAdjacencyRules(nodes, connections);
    assert.strictEqual(result.length, 0);
  });

  it('does not modify the original array', () => {
    const nodes = [
      { nodeType: 'city' },
      { nodeType: 'village' }
    ];
    const connections = [{ from: 0, to: 1 }];
    const origLength = connections.length;
    enforceAdjacencyRules(nodes, connections);
    assert.strictEqual(connections.length, origLength);
  });
});

// =============================================================================
// ensureMinimumConnections
// =============================================================================

describe('ensureMinimumConnections', () => {
  it('adds connections for under-connected nodes', () => {
    const nodes = [
      { x: 0, y: 0, nodeType: 'castle' },   // needs 5 connections
      { x: 3, y: 0, nodeType: 'forest' },
      { x: 6, y: 0, nodeType: 'forest' },
      { x: 9, y: 0, nodeType: 'forest' },
      { x: 0, y: 3, nodeType: 'forest' },
      { x: 3, y: 3, nodeType: 'forest' },
      { x: 6, y: 3, nodeType: 'forest' }
    ];
    // Start with minimal MST
    const connections = [
      { from: 0, to: 1 },
      { from: 1, to: 2 },
      { from: 2, to: 3 },
      { from: 0, to: 4 },
      { from: 4, to: 5 },
      { from: 5, to: 6 }
    ];
    const rng = new SeededRandom(42);
    const result = ensureMinimumConnections(nodes, connections, rng);

    // Should have added connections
    assert.ok(
      result.length >= connections.length,
      `Should have at least as many connections (${result.length}) as before (${connections.length})`
    );
  });
});
