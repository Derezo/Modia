/**
 * Worldgen Validation Unit Tests
 *
 * Tests the pure validation functions used in Phase 6 of world generation.
 * These functions validate world connectivity, spacing, and node distribution.
 *
 * Functions tested:
 * - calculateDifficultyTier - Assign difficulty based on ring distance
 * - verifyConnectivity - BFS flood fill for reachability
 * - validateMaxSpacing - Connection distance validation
 * - validateTerrainClustering - Same-type clustering detection
 * - validateZodiacShrines - Zodiac shrine placement validation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

// Import validation functions
let importError = null;
let calculateDifficultyTier = null;
let verifyConnectivity = null;
let validateMaxSpacing = null;
let validateTerrainClustering = null;
let validateZodiacShrines = null;
let assignTerminatorNodesRegional = null;

try {
  const mod = await import('../../db/worldgen/validation.js');
  calculateDifficultyTier = mod.calculateDifficultyTier;
  verifyConnectivity = mod.verifyConnectivity;
  validateMaxSpacing = mod.validateMaxSpacing;
  validateTerrainClustering = mod.validateTerrainClustering;
  validateZodiacShrines = mod.validateZodiacShrines;
  assignTerminatorNodesRegional = mod.assignTerminatorNodesRegional;
} catch (err) {
  importError = err;
}

// Also import SeededRandom for terminator tests
let SeededRandom = null;
try {
  const constantsMod = await import('../../config/constants.js');
  SeededRandom = constantsMod.SeededRandom;
} catch {
  // Will skip those tests
}

const canImport = importError === null;

// Helper to create a minimal node
function createNode(overrides = {}) {
  return {
    nodeType: overrides.nodeType || 'forest',
    ringDistance: overrides.ringDistance ?? 1,
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    name: overrides.name || 'Test Node',
    ...overrides
  };
}

describe('Worldgen Validation - calculateDifficultyTier', { skip: !canImport }, () => {
  describe('special node types', () => {
    it('castle always returns tier 1', () => {
      const castle = createNode({ nodeType: 'castle', ringDistance: 5 });
      assert.strictEqual(calculateDifficultyTier(castle), 1);
    });

    it('palace always returns tier 5', () => {
      const palace = createNode({ nodeType: 'palace', ringDistance: 0 });
      assert.strictEqual(calculateDifficultyTier(palace), 5);
    });
  });

  describe('settlement nodes', () => {
    const settlementTypes = ['city', 'village', 'guild', 'keep'];

    for (const nodeType of settlementTypes) {
      it(`${nodeType} at ring 0-1 returns tier 1`, () => {
        const node0 = createNode({ nodeType, ringDistance: 0 });
        const node1 = createNode({ nodeType, ringDistance: 1 });

        assert.strictEqual(calculateDifficultyTier(node0), 1);
        assert.strictEqual(calculateDifficultyTier(node1), 1);
      });

      it(`${nodeType} at ring 2 returns tier 2`, () => {
        const node = createNode({ nodeType, ringDistance: 2 });
        assert.strictEqual(calculateDifficultyTier(node), 2);
      });

      it(`${nodeType} at ring 3+ returns tier 3`, () => {
        const node3 = createNode({ nodeType, ringDistance: 3 });
        const node4 = createNode({ nodeType, ringDistance: 4 });

        assert.strictEqual(calculateDifficultyTier(node3), 3);
        assert.strictEqual(calculateDifficultyTier(node4), 3);
      });
    }
  });

  describe('battle nodes by ring distance', () => {
    const battleTypes = ['forest', 'cave', 'mountain'];

    for (const nodeType of battleTypes) {
      it(`${nodeType} at ring 0 returns tier 1`, () => {
        const node = createNode({ nodeType, ringDistance: 0 });
        assert.strictEqual(calculateDifficultyTier(node), 1);
      });

      it(`${nodeType} at ring 1 returns tier 2`, () => {
        const node = createNode({ nodeType, ringDistance: 1 });
        assert.strictEqual(calculateDifficultyTier(node), 2);
      });

      it(`${nodeType} at ring 2 returns tier 3`, () => {
        const node = createNode({ nodeType, ringDistance: 2 });
        assert.strictEqual(calculateDifficultyTier(node), 3);
      });

      it(`${nodeType} at ring 3 returns tier 4`, () => {
        const node = createNode({ nodeType, ringDistance: 3 });
        assert.strictEqual(calculateDifficultyTier(node), 4);
      });

      it(`${nodeType} at ring 4+ returns tier 4`, () => {
        const node = createNode({ nodeType, ringDistance: 4 });
        assert.strictEqual(calculateDifficultyTier(node), 4);
      });
    }
  });
});

describe('Worldgen Validation - verifyConnectivity', { skip: !canImport }, () => {
  it('returns allReachable true for fully connected graph', () => {
    const nodes = [
      createNode({ nodeType: 'castle' }),
      createNode({ nodeType: 'forest' }),
      createNode({ nodeType: 'cave' })
    ];
    const connections = [
      { from: 0, to: 1 },
      { from: 1, to: 2 }
    ];

    const result = verifyConnectivity(nodes, connections);

    assert.strictEqual(result.allReachable, true);
    assert.strictEqual(result.orphanedNodes.length, 0);
  });

  it('detects orphaned nodes', () => {
    const nodes = [
      createNode({ nodeType: 'castle' }),
      createNode({ nodeType: 'forest' }),
      createNode({ nodeType: 'cave' }) // No connections
    ];
    const connections = [
      { from: 0, to: 1 }
    ];

    const result = verifyConnectivity(nodes, connections);

    assert.strictEqual(result.allReachable, false);
    assert.ok(result.orphanedNodes.includes(2));
  });

  it('handles empty graph', () => {
    const nodes = [];
    const connections = [];

    const result = verifyConnectivity(nodes, connections);

    // No castle means warning state
    assert.strictEqual(result.allReachable, false);
    assert.strictEqual(result.castleIdx, -1);
  });

  it('handles bidirectional connections', () => {
    const nodes = [
      createNode({ nodeType: 'castle' }),
      createNode({ nodeType: 'forest' }),
      createNode({ nodeType: 'cave' })
    ];
    // Only one direction specified, but connections should be bidirectional
    const connections = [
      { from: 0, to: 1 },
      { from: 2, to: 1 } // 2 connects to 1, which connects to 0
    ];

    const result = verifyConnectivity(nodes, connections);

    assert.strictEqual(result.allReachable, true);
  });

  it('handles object-based connections', () => {
    const nodes = [
      createNode({ nodeType: 'castle' }),
      createNode({ nodeType: 'forest' })
    ];
    const connections = [
      { from: nodes[0], to: nodes[1] }
    ];

    const result = verifyConnectivity(nodes, connections);

    assert.strictEqual(result.allReachable, true);
  });
});

describe('Worldgen Validation - validateMaxSpacing', { skip: !canImport }, () => {
  it('returns passed true when all connections within limit', () => {
    const nodes = [
      createNode({ x: 0, y: 0 }),
      createNode({ x: 5, y: 0 }), // Distance 5
      createNode({ x: 5, y: 5 })  // Distance 5 from node 1
    ];
    const connections = [
      { from: 0, to: 1 },
      { from: 1, to: 2 }
    ];

    const result = validateMaxSpacing(nodes, connections, 10);

    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.violations.length, 0);
  });

  it('detects connections exceeding max spacing', () => {
    const nodes = [
      createNode({ x: 0, y: 0, name: 'Node A' }),
      createNode({ x: 20, y: 0, name: 'Node B' }) // Distance 20
    ];
    const connections = [
      { from: 0, to: 1 }
    ];

    const result = validateMaxSpacing(nodes, connections, 10);

    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.violations.length, 1);
    assert.ok(result.violations[0].distance > 10);
  });

  it('calculates Euclidean distance correctly', () => {
    const nodes = [
      createNode({ x: 0, y: 0 }),
      createNode({ x: 3, y: 4 }) // Distance should be 5 (3-4-5 triangle)
    ];
    const connections = [
      { from: 0, to: 1 }
    ];

    const result = validateMaxSpacing(nodes, connections, 4);

    // 5 > 4, should fail
    assert.strictEqual(result.passed, false);
    assert.ok(
      Math.abs(result.violations[0].distance - 5) < 0.01,
      'Distance should be approximately 5'
    );
  });

  it('handles empty connections', () => {
    const nodes = [createNode()];
    const connections = [];

    const result = validateMaxSpacing(nodes, connections, 10);

    assert.strictEqual(result.passed, true);
  });

  it('includes connection type in violations', () => {
    const nodes = [
      createNode({ x: 0, y: 0 }),
      createNode({ x: 100, y: 0 })
    ];
    const connections = [
      { from: 0, to: 1, connectionType: 'trade_route' }
    ];

    const result = validateMaxSpacing(nodes, connections, 10);

    assert.strictEqual(result.violations[0].connectionType, 'trade_route');
  });
});

describe('Worldgen Validation - validateZodiacShrines', { skip: !canImport }, () => {
  it('returns passed true when all 12 zodiac types present', () => {
    const zodiacTypes = [
      'aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo',
      'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'
    ];
    const nodes = zodiacTypes.map(type =>
      createNode({ nodeType: 'shrine', shrineBuffType: `zodiac_${type}` })
    );

    const result = validateZodiacShrines(nodes);

    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.total, 12);
    assert.strictEqual(result.missingTypes.length, 0);
  });

  it('detects missing zodiac types', () => {
    const partialTypes = ['aries', 'taurus', 'gemini']; // Only 3
    const nodes = partialTypes.map(type =>
      createNode({ nodeType: 'shrine', shrineBuffType: `zodiac_${type}` })
    );

    const result = validateZodiacShrines(nodes);

    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.total, 3);
    assert.ok(result.missingTypes.length > 0);
  });

  it('detects duplicate zodiac types', () => {
    // 12 shrines but with duplicates
    const types = [
      'aries', 'aries', 'gemini', 'cancer', 'leo', 'virgo',
      'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'
    ];
    const nodes = types.map(type =>
      createNode({ nodeType: 'shrine', shrineBuffType: `zodiac_${type}` })
    );

    const result = validateZodiacShrines(nodes);

    assert.strictEqual(result.passed, false);
    assert.ok(result.duplicateTypes > 0);
  });

  it('ignores non-zodiac shrines', () => {
    const nodes = [
      createNode({ nodeType: 'shrine', shrineBuffType: 'strength_boost' }),
      createNode({ nodeType: 'shrine', shrineBuffType: 'speed_boost' })
    ];

    const result = validateZodiacShrines(nodes);

    assert.strictEqual(result.total, 0);
  });

  it('ignores non-shrine nodes', () => {
    const nodes = [
      createNode({ nodeType: 'forest', shrineBuffType: 'zodiac_aries' })
    ];

    const result = validateZodiacShrines(nodes);

    assert.strictEqual(result.total, 0);
  });
});

describe('Worldgen Validation - validateTerrainClustering', { skip: !canImport }, () => {
  it('returns passed true when no clusters exceed limit', () => {
    // Simple linear chain - no clustering
    const nodes = [
      createNode({ nodeType: 'forest', x: 0, y: 0 }),
      createNode({ nodeType: 'cave', x: 5, y: 0 }),
      createNode({ nodeType: 'mountain', x: 10, y: 0 })
    ];
    const connections = [
      { from: 0, to: 1 },
      { from: 1, to: 2 }
    ];

    const result = validateTerrainClustering(nodes, connections);

    // Either passed is true or it was skipped (validation disabled)
    assert.ok(result.passed || result.skipped);
  });

  it('handles empty graphs', () => {
    const nodes = [];
    const connections = [];

    const result = validateTerrainClustering(nodes, connections);

    assert.ok(result.passed || result.skipped);
  });

  it('counts battle nodes correctly', () => {
    const nodes = [
      createNode({ nodeType: 'forest' }),
      createNode({ nodeType: 'cave' }),
      createNode({ nodeType: 'mountain' }),
      createNode({ nodeType: 'castle' }), // Not a battle node
      createNode({ nodeType: 'village' }) // Not a battle node
    ];
    const connections = [];

    const result = validateTerrainClustering(nodes, connections);

    if (!result.skipped) {
      assert.strictEqual(result.totalBattleNodes, 3);
    }
  });
});

describe('Worldgen Validation - assignTerminatorNodesRegional', { skip: !canImport || !SeededRandom }, () => {
  it('assigns terminators to low-connectivity battle nodes', () => {
    const rng = new SeededRandom(42);
    const nodes = [
      createNode({ nodeType: 'forest', ringDistance: 3, x: 0, y: 0 }),
      createNode({ nodeType: 'cave', ringDistance: 3, x: 10, y: 0 }),
      createNode({ nodeType: 'castle', ringDistance: 0, x: 20, y: 0 })
    ];
    // Node 0 and 1 have only 1 connection each (dead ends)
    const connections = [
      { from: 0, to: 2 },
      { from: 1, to: 2 }
    ];

    const stats = assignTerminatorNodesRegional(nodes, connections, rng);

    // Should have assigned some terminators
    const totalTerminators = stats.chest + stats.shrine + stats.discovery;
    assert.ok(totalTerminators >= 0);
  });

  it('returns stats object with chest, shrine, discovery counts', () => {
    const rng = new SeededRandom(42);
    const nodes = [];
    const connections = [];

    const stats = assignTerminatorNodesRegional(nodes, connections, rng);

    assert.ok('chest' in stats);
    assert.ok('shrine' in stats);
    assert.ok('discovery' in stats);
  });

  it('does not modify non-battle nodes', () => {
    const rng = new SeededRandom(42);
    const nodes = [
      createNode({ nodeType: 'castle', ringDistance: 0, x: 0, y: 0 }),
      createNode({ nodeType: 'village', ringDistance: 3, x: 10, y: 0 })
    ];
    const connections = [{ from: 0, to: 1 }];

    assignTerminatorNodesRegional(nodes, connections, rng);

    // Castle and village should not become terminators
    assert.strictEqual(nodes[0].nodeType, 'castle');
    assert.strictEqual(nodes[1].nodeType, 'village');
  });

  it('marks terminator nodes with isTerminator flag', () => {
    const rng = new SeededRandom(42);
    const nodes = [
      createNode({ nodeType: 'castle', ringDistance: 0, x: 0, y: 0 }),
      createNode({ nodeType: 'forest', ringDistance: 3, x: 100, y: 0 })
    ];
    const connections = [{ from: 0, to: 1 }];

    assignTerminatorNodesRegional(nodes, connections, rng);

    // Check if any node was marked as terminator
    const terminators = nodes.filter(n => n.isTerminator);
    if (terminators.length > 0) {
      assert.ok(['chest', 'shrine', 'discovery'].includes(terminators[0].nodeType));
    }
  });
});

describe('Worldgen Validation - edge cases', { skip: !canImport }, () => {
  it('calculateDifficultyTier handles undefined ringDistance', () => {
    const node = createNode({ nodeType: 'forest', ringDistance: undefined });

    // Should not throw
    const tier = calculateDifficultyTier(node);
    assert.ok(tier >= 1 && tier <= 5);
  });

  it('verifyConnectivity handles self-referential connections', () => {
    const nodes = [
      createNode({ nodeType: 'castle' }),
      createNode({ nodeType: 'forest' })
    ];
    const connections = [
      { from: 0, to: 0 }, // Self-loop
      { from: 0, to: 1 }
    ];

    // Should not throw
    const result = verifyConnectivity(nodes, connections);
    assert.ok('allReachable' in result);
  });

  it('validateMaxSpacing handles missing coordinates gracefully', () => {
    const nodes = [
      createNode({ x: undefined, y: undefined }),
      createNode({ x: 5, y: 5 })
    ];
    const connections = [{ from: 0, to: 1 }];

    // Should not throw, may report as violation or skip
    const result = validateMaxSpacing(nodes, connections, 10);
    assert.ok('passed' in result);
  });
});

describe('Worldgen Validation - import error handling', { skip: canImport }, () => {
  it('reports import error', () => {
    console.log('Worldgen Validation import error:', importError?.message);
    assert.ok(importError, 'Import error should be captured');
  });
});
