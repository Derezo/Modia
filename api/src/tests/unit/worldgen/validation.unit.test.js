/**
 * Unit tests for worldgen/validation.js
 *
 * Tests validation and cleanup functions:
 * - calculateDifficultyTier: Difficulty tier assignment based on node type and ring
 * - verifyConnectivity: BFS flood fill connectivity check
 * - validateMaxSpacing: Maximum connection distance validation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  calculateDifficultyTier,
  verifyConnectivity,
  validateMaxSpacing
} from '../../../db/worldgen/validation.js';

// =============================================================================
// calculateDifficultyTier
// =============================================================================

describe('calculateDifficultyTier', () => {
  // Special cases
  it('returns tier 1 for castle', () => {
    assert.strictEqual(calculateDifficultyTier({ nodeType: 'castle', ringDistance: 0 }), 1);
  });

  it('returns tier 1 for castle regardless of ring', () => {
    assert.strictEqual(calculateDifficultyTier({ nodeType: 'castle', ringDistance: 3 }), 1);
  });

  it('returns tier 5 for palace', () => {
    assert.strictEqual(calculateDifficultyTier({ nodeType: 'palace', ringDistance: 0 }), 5);
  });

  it('returns tier 5 for palace regardless of ring', () => {
    assert.strictEqual(calculateDifficultyTier({ nodeType: 'palace', ringDistance: 1 }), 5);
  });

  // Settlements by ring distance
  it('returns tier 1 for city in ring 0', () => {
    assert.strictEqual(calculateDifficultyTier({ nodeType: 'city', ringDistance: 0 }), 1);
  });

  it('returns tier 1 for village in ring 1', () => {
    assert.strictEqual(calculateDifficultyTier({ nodeType: 'village', ringDistance: 1 }), 1);
  });

  it('returns tier 2 for guild in ring 2', () => {
    assert.strictEqual(calculateDifficultyTier({ nodeType: 'guild', ringDistance: 2 }), 2);
  });

  it('returns tier 3 for keep in ring 3', () => {
    assert.strictEqual(calculateDifficultyTier({ nodeType: 'keep', ringDistance: 3 }), 3);
  });

  it('returns tier 3 for village in ring 3+', () => {
    assert.strictEqual(calculateDifficultyTier({ nodeType: 'village', ringDistance: 4 }), 3);
  });

  // Battle nodes by ring distance
  it('returns tier 1 for battle node in ring 0', () => {
    assert.strictEqual(calculateDifficultyTier({ nodeType: 'forest', ringDistance: 0 }), 1);
  });

  it('returns tier 2 for battle node in ring 1', () => {
    assert.strictEqual(calculateDifficultyTier({ nodeType: 'cave', ringDistance: 1 }), 2);
  });

  it('returns tier 3 for battle node in ring 2', () => {
    assert.strictEqual(calculateDifficultyTier({ nodeType: 'mountain', ringDistance: 2 }), 3);
  });

  it('returns tier 4 for battle node in ring 3', () => {
    assert.strictEqual(calculateDifficultyTier({ nodeType: 'forest', ringDistance: 3 }), 4);
  });

  it('returns tier 4 for battle node beyond ring 3', () => {
    assert.strictEqual(calculateDifficultyTier({ nodeType: 'cave', ringDistance: 5 }), 4);
  });

  // Tier progression validation
  it('tiers increase or stay same as ring increases for battle nodes', () => {
    const tiers = [];
    for (let ring = 0; ring <= 4; ring++) {
      tiers.push(calculateDifficultyTier({ nodeType: 'forest', ringDistance: ring }));
    }
    for (let i = 1; i < tiers.length; i++) {
      assert.ok(tiers[i] >= tiers[i - 1],
        `Tier should not decrease: ring ${i} tier ${tiers[i]} < ring ${i - 1} tier ${tiers[i - 1]}`);
    }
  });
});

// =============================================================================
// verifyConnectivity
// =============================================================================

describe('verifyConnectivity', () => {
  it('reports all reachable for fully connected graph', () => {
    const nodes = [
      { nodeType: 'castle' },
      { nodeType: 'forest' },
      { nodeType: 'cave' },
      { nodeType: 'mountain' }
    ];
    const connections = [
      { from: 0, to: 1 },
      { from: 1, to: 2 },
      { from: 2, to: 3 }
    ];
    const result = verifyConnectivity(nodes, connections);

    assert.strictEqual(result.allReachable, true);
    assert.strictEqual(result.orphanedNodes.length, 0);
  });

  it('detects disconnected nodes', () => {
    const nodes = [
      { nodeType: 'castle' },
      { nodeType: 'forest' },
      { nodeType: 'forest' },  // Connected to castle component
      { nodeType: 'cave' },    // Disconnected island
      { nodeType: 'mountain' } // Disconnected island
    ];
    const connections = [
      { from: 0, to: 1 },
      { from: 1, to: 2 },
      { from: 3, to: 4 }  // Separate component
    ];
    const result = verifyConnectivity(nodes, connections);

    assert.strictEqual(result.allReachable, false);
    assert.strictEqual(result.orphanedNodes.length, 2);
    assert.ok(result.orphanedNodes.includes(3));
    assert.ok(result.orphanedNodes.includes(4));
  });

  it('handles single castle node', () => {
    const nodes = [{ nodeType: 'castle' }];
    const connections = [];
    const result = verifyConnectivity(nodes, connections);

    assert.strictEqual(result.allReachable, true);
    assert.strictEqual(result.orphanedNodes.length, 0);
  });

  it('handles no castle found', () => {
    const nodes = [
      { nodeType: 'forest' },
      { nodeType: 'cave' }
    ];
    const connections = [{ from: 0, to: 1 }];
    const result = verifyConnectivity(nodes, connections);

    assert.strictEqual(result.allReachable, false);
    assert.strictEqual(result.castleIdx, -1);
  });

  it('handles cycle graph correctly', () => {
    const nodes = [
      { nodeType: 'castle' },
      { nodeType: 'forest' },
      { nodeType: 'cave' },
      { nodeType: 'mountain' }
    ];
    const connections = [
      { from: 0, to: 1 },
      { from: 1, to: 2 },
      { from: 2, to: 3 },
      { from: 3, to: 0 }  // Cycle back to castle
    ];
    const result = verifyConnectivity(nodes, connections);

    assert.strictEqual(result.allReachable, true);
    assert.strictEqual(result.visited.size, 4);
  });

  it('handles complex graph with multiple paths', () => {
    const nodes = [
      { nodeType: 'castle' },
      { nodeType: 'forest' },
      { nodeType: 'cave' },
      { nodeType: 'mountain' },
      { nodeType: 'forest' }
    ];
    const connections = [
      { from: 0, to: 1 },
      { from: 0, to: 2 },
      { from: 1, to: 3 },
      { from: 2, to: 3 },
      { from: 3, to: 4 }
    ];
    const result = verifyConnectivity(nodes, connections);

    assert.strictEqual(result.allReachable, true);
    assert.strictEqual(result.orphanedNodes.length, 0);
  });

  it('detects single orphan among many connected nodes', () => {
    const nodes = [
      { nodeType: 'castle' },
      { nodeType: 'forest' },
      { nodeType: 'cave' },
      { nodeType: 'mountain' },
      { nodeType: 'forest' } // Orphan
    ];
    const connections = [
      { from: 0, to: 1 },
      { from: 1, to: 2 },
      { from: 2, to: 3 }
      // Node 4 has no connections
    ];
    const result = verifyConnectivity(nodes, connections);

    assert.strictEqual(result.allReachable, false);
    assert.strictEqual(result.orphanedNodes.length, 1);
    assert.strictEqual(result.orphanedNodes[0], 4);
  });
});

// =============================================================================
// validateMaxSpacing
// =============================================================================

describe('validateMaxSpacing', () => {
  it('passes when all connections within max spacing', () => {
    const nodes = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 }
    ];
    const connections = [
      { from: 0, to: 1 },
      { from: 1, to: 2 }
    ];
    const result = validateMaxSpacing(nodes, connections, 13.3);

    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.violations.length, 0);
    assert.strictEqual(result.totalConnections, 2);
  });

  it('fails when a connection exceeds max spacing', () => {
    const nodes = [
      { x: 0, y: 0 },
      { x: 20, y: 0 }  // 20 units apart
    ];
    const connections = [
      { from: 0, to: 1 }
    ];
    const result = validateMaxSpacing(nodes, connections, 13.3);

    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.violations.length, 1);
    assert.ok(result.violations[0].distance > 13.3);
  });

  it('reports correct violation details', () => {
    const nodes = [
      { x: 0, y: 0, name: 'Node A' },
      { x: 15, y: 0, name: 'Node B' }
    ];
    const connections = [
      { from: 0, to: 1 }
    ];
    const result = validateMaxSpacing(nodes, connections, 10);

    assert.strictEqual(result.violations.length, 1);
    assert.strictEqual(result.violations[0].from, 'Node A');
    assert.strictEqual(result.violations[0].to, 'Node B');
    assert.ok(Math.abs(result.violations[0].distance - 15) < 0.01);
    assert.strictEqual(result.violations[0].maxAllowed, 10);
  });

  it('handles mixed valid and invalid connections', () => {
    const nodes = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 25, y: 0 }
    ];
    const connections = [
      { from: 0, to: 1 },  // 5 units - OK
      { from: 1, to: 2 }   // 20 units - exceeds
    ];
    const result = validateMaxSpacing(nodes, connections, 13.3);

    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.violations.length, 1);
  });

  it('passes with empty connections array', () => {
    const nodes = [{ x: 0, y: 0 }];
    const connections = [];
    const result = validateMaxSpacing(nodes, connections, 13.3);

    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.violations.length, 0);
  });

  it('uses exact distance at boundary', () => {
    const nodes = [
      { x: 0, y: 0 },
      { x: 13.3, y: 0 }  // Exactly at max
    ];
    const connections = [{ from: 0, to: 1 }];
    const result = validateMaxSpacing(nodes, connections, 13.3);

    // At exactly max spacing, should pass (not strictly greater)
    assert.strictEqual(result.passed, true);
  });

  it('handles nodes without name property', () => {
    const nodes = [
      { x: 0, y: 0 },
      { x: 20, y: 0 }
    ];
    const connections = [{ from: 0, to: 1 }];
    const result = validateMaxSpacing(nodes, connections, 10);

    // Should not throw, uses fallback name format
    assert.strictEqual(result.violations.length, 1);
    assert.ok(typeof result.violations[0].from === 'string');
  });
});
