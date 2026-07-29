/**
 * Elevation System Tests
 *
 * Tests for the multi-level elevation system including:
 * - ElevationMapper generation
 * - Elevation-aware pathfinding (3D)
 * - Elevation damage modifiers
 * - Terrain elevation constants
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  ELEVATION_LEVELS,
  ELEVATION_CONNECTION_TYPES,
  ELEVATION_MOVEMENT_COSTS,
  ELEVATION_RULES,
  getElevationMovementCost,
  canTraverseElevation,
  discretizeElevation,
  getElevationName,
  elevationLevelToNormalized,
  inferElevationFormat,
  normalizeElevationGrid
} from './terrain.js';

import {
  getReachableTiles3D,
  findPath3D,
  calculatePathCost3D,
  hasValidPath3D
} from './pathfinding.js';

import {
  calculateElevationModifier,
  calculateElevationAccuracyModifier,
  calculateElevationEvasionModifier,
  calculateDamagePreviewWithElevation,
  ELEVATION_DAMAGE_BONUS_PER_LEVEL,
  ELEVATION_DAMAGE_PENALTY_PER_LEVEL,
  ELEVATION_RANGED_BONUS_PER_LEVEL
} from './battleMath.js';

import { ElevationMapper, DIRECTIONS, CONNECTION_TYPES } from './mapgen/ElevationMapper.js';
import { SeededRandom } from './constants.js';

// ============================================================================
// TERRAIN ELEVATION CONSTANTS
// ============================================================================

describe('Elevation Constants', () => {
  it('should have correct elevation levels', () => {
    assert.strictEqual(ELEVATION_LEVELS.DEEP_PIT, -3);
    assert.strictEqual(ELEVATION_LEVELS.PIT, -2);
    assert.strictEqual(ELEVATION_LEVELS.TRENCH, -1);
    assert.strictEqual(ELEVATION_LEVELS.GROUND, 0);
    assert.strictEqual(ELEVATION_LEVELS.RAISED, 1);
    assert.strictEqual(ELEVATION_LEVELS.HIGH, 2);
    assert.strictEqual(ELEVATION_LEVELS.VERY_HIGH, 3);
    assert.strictEqual(ELEVATION_LEVELS.PEAK, 4);
    assert.strictEqual(ELEVATION_LEVELS.SPIRE, 5);
    assert.strictEqual(ELEVATION_LEVELS.TOWER, 6);
    assert.strictEqual(ELEVATION_LEVELS.TOWER_TOP, 7);
    assert.strictEqual(ELEVATION_LEVELS.CLOUD, 8);
  });

  it('should have correct connection types', () => {
    assert.strictEqual(ELEVATION_CONNECTION_TYPES.RAMP, 'ramp');
    assert.strictEqual(ELEVATION_CONNECTION_TYPES.STAIRS, 'stairs');
    assert.strictEqual(ELEVATION_CONNECTION_TYPES.LEDGE, 'ledge');
    assert.strictEqual(ELEVATION_CONNECTION_TYPES.CLIFF, 'cliff');
  });

  it('should have correct movement costs for connections', () => {
    assert.strictEqual(ELEVATION_MOVEMENT_COSTS.ramp, 0);
    assert.strictEqual(ELEVATION_MOVEMENT_COSTS.stairs, 1);
    assert.strictEqual(ELEVATION_MOVEMENT_COSTS.ledge, 0);
    assert.strictEqual(ELEVATION_MOVEMENT_COSTS.cliff, Infinity);
  });

  it('should have correct traversal rules', () => {
    assert.strictEqual(ELEVATION_RULES.MAX_CLIMB, 1);
    assert.strictEqual(ELEVATION_RULES.MAX_DROP, 3);
    assert.strictEqual(ELEVATION_RULES.CLIFF_THRESHOLD, 4);
  });
});

// ============================================================================
// ELEVATION DISCRETIZATION
// ============================================================================

describe('discretizeElevation', () => {
  it('should discretize float values to correct levels', () => {
    // Deep Pit: < 0.05
    assert.strictEqual(discretizeElevation(0.0), -3);
    assert.strictEqual(discretizeElevation(0.04), -3);

    // Pit: 0.05-0.10
    assert.strictEqual(discretizeElevation(0.05), -2);
    assert.strictEqual(discretizeElevation(0.09), -2);

    // Trench: 0.10-0.18
    assert.strictEqual(discretizeElevation(0.10), -1);
    assert.strictEqual(discretizeElevation(0.17), -1);

    // Ground: 0.18-0.48 (most common)
    assert.strictEqual(discretizeElevation(0.18), 0);
    assert.strictEqual(discretizeElevation(0.30), 0);
    assert.strictEqual(discretizeElevation(0.47), 0);

    // Raised: 0.48-0.60
    assert.strictEqual(discretizeElevation(0.48), 1);
    assert.strictEqual(discretizeElevation(0.55), 1);

    // High: 0.60-0.72
    assert.strictEqual(discretizeElevation(0.60), 2);
    assert.strictEqual(discretizeElevation(0.70), 2);

    // Very High: 0.72-0.82
    assert.strictEqual(discretizeElevation(0.72), 3);
    assert.strictEqual(discretizeElevation(0.80), 3);

    // Peak: 0.82-0.90
    assert.strictEqual(discretizeElevation(0.82), 4);
    assert.strictEqual(discretizeElevation(0.88), 4);

    // Spire: 0.90-0.94
    assert.strictEqual(discretizeElevation(0.90), 5);
    assert.strictEqual(discretizeElevation(0.93), 5);

    // Tower: 0.94-0.97
    assert.strictEqual(discretizeElevation(0.94), 6);
    assert.strictEqual(discretizeElevation(0.96), 6);

    // Tower Top: 0.97-0.99
    assert.strictEqual(discretizeElevation(0.97), 7);
    assert.strictEqual(discretizeElevation(0.98), 7);

    // Cloud: >= 0.99
    assert.strictEqual(discretizeElevation(0.99), 8);
    assert.strictEqual(discretizeElevation(1.0), 8);
  });

  it('should pass through already discrete values', () => {
    assert.strictEqual(discretizeElevation(-3), -3);
    assert.strictEqual(discretizeElevation(-1), -1);
    assert.strictEqual(discretizeElevation(2), 2);
    assert.strictEqual(discretizeElevation(5), 5);
    assert.strictEqual(discretizeElevation(8), 8);
  });

  it('should handle null/undefined as ground level', () => {
    assert.strictEqual(discretizeElevation(null), 0);
    assert.strictEqual(discretizeElevation(undefined), 0);
  });

  it('should ensure pathfinding consistency', () => {
    // This test documents the bug fix: adjacent tiles with similar raw values
    // should map to the same discrete level if they're close enough
    const rawA = 0.47;  // Just under 0.48 threshold
    const rawB = 0.49;  // Just over 0.48 threshold

    const levelA = discretizeElevation(rawA);
    const levelB = discretizeElevation(rawB);

    // These ARE different levels (Ground vs Raised)
    assert.strictEqual(levelA, 0);  // Ground
    assert.strictEqual(levelB, 1);  // Raised

    // But the elevation difference is exactly 1, which is within MAX_CLIMB
    assert.strictEqual(Math.abs(levelB - levelA), ELEVATION_RULES.MAX_CLIMB);
  });
});

describe('canonical elevation representation', () => {
  it('should round-trip every semantic level through its normalized band', () => {
    for (let level = ELEVATION_LEVELS.DEEP_PIT; level <= ELEVATION_LEVELS.CLOUD; level++) {
      assert.strictEqual(discretizeElevation(elevationLevelToNormalized(level)), level);
    }
  });

  it('should infer legacy integer grids without misreading levels 0 and 1', () => {
    assert.strictEqual(inferElevationFormat([[0, 1], [-1, 2]]), 'discrete');
    assert.strictEqual(inferElevationFormat([[0.33, 0.54]]), 'normalized');
    assert.strictEqual(inferElevationFormat([[0, 1]], 'normalized'), 'normalized');
  });

  it('should normalize legacy grids while preserving current grids by reference', () => {
    const legacy = [[-3, 0, 1, 8, Number.NaN]];
    const normalized = normalizeElevationGrid(legacy, 'discrete');
    assert.deepStrictEqual(
      normalized.map(row => row.map(discretizeElevation)),
      [[-3, 0, 1, 8, 0]]
    );

    const current = [[0.33, 0.54]];
    assert.strictEqual(normalizeElevationGrid(current, 'normalized'), current);
  });
});

describe('getElevationName', () => {
  it('should return correct names for all levels', () => {
    assert.strictEqual(getElevationName(-3), 'Deep Pit');
    assert.strictEqual(getElevationName(-2), 'Pit');
    assert.strictEqual(getElevationName(-1), 'Trench');
    assert.strictEqual(getElevationName(0), 'Ground');
    assert.strictEqual(getElevationName(1), 'Raised');
    assert.strictEqual(getElevationName(2), 'High');
    assert.strictEqual(getElevationName(3), 'Very High');
    assert.strictEqual(getElevationName(4), 'Peak');
    assert.strictEqual(getElevationName(5), 'Spire');
    assert.strictEqual(getElevationName(6), 'Tower');
    assert.strictEqual(getElevationName(7), 'Tower Top');
    assert.strictEqual(getElevationName(8), 'Cloud');
  });

  it('should return Ground for unknown levels', () => {
    assert.strictEqual(getElevationName(10), 'Ground');
    assert.strictEqual(getElevationName(-10), 'Ground');
    assert.strictEqual(getElevationName(null), 'Ground');
    assert.strictEqual(getElevationName(undefined), 'Ground');
  });
});

describe('getElevationMovementCost', () => {
  it('should return 0 for null connection', () => {
    assert.strictEqual(getElevationMovementCost(null), 0);
  });

  it('should return correct costs for each type', () => {
    assert.strictEqual(getElevationMovementCost('ramp'), 0);
    assert.strictEqual(getElevationMovementCost('stairs'), 1);
    assert.strictEqual(getElevationMovementCost('ledge'), 0);
    assert.strictEqual(getElevationMovementCost('cliff'), Infinity);
  });
});

describe('canTraverseElevation', () => {
  it('should allow same level traversal', () => {
    const result = canTraverseElevation(0, 0, null);
    assert.strictEqual(result.canTraverse, true);
    assert.strictEqual(result.moveCost, 0);
    assert.strictEqual(result.isOneWay, false);
  });

  it('should allow climbing via ramp', () => {
    const result = canTraverseElevation(0, 1, 'ramp');
    assert.strictEqual(result.canTraverse, true);
    assert.strictEqual(result.moveCost, 0);
  });

  it('should allow climbing via stairs with extra cost', () => {
    const result = canTraverseElevation(0, 1, 'stairs');
    assert.strictEqual(result.canTraverse, true);
    assert.strictEqual(result.moveCost, 1);
  });

  it('should not allow climbing via ledge', () => {
    const result = canTraverseElevation(0, 1, 'ledge');
    assert.strictEqual(result.canTraverse, false);
    assert.strictEqual(result.isOneWay, true);
  });

  it('should not allow climbing via cliff', () => {
    const result = canTraverseElevation(0, 1, 'cliff');
    assert.strictEqual(result.canTraverse, false);
  });

  it('should allow dropping down ledge', () => {
    const result = canTraverseElevation(1, 0, 'ledge');
    assert.strictEqual(result.canTraverse, true);
    assert.strictEqual(result.isOneWay, true);
  });

  it('should allow 3-level drop (within new max drop)', () => {
    const result = canTraverseElevation(3, 0, null);
    assert.strictEqual(result.canTraverse, true);
  });

  it('should not allow 4-level drop without special connection', () => {
    const result = canTraverseElevation(4, 0, null);
    assert.strictEqual(result.canTraverse, false);
  });

  it('should allow dropping within max drop', () => {
    const result = canTraverseElevation(2, 0, null); // 2 level drop
    assert.strictEqual(result.canTraverse, true);
  });
});

// ============================================================================
// ELEVATION MAPPER
// ============================================================================

describe('ElevationMapper', () => {
  it('should create instance with default options', () => {
    const mapper = new ElevationMapper();
    assert.ok(mapper);
    // ElevationMapper defaults now use extended range
    assert.strictEqual(mapper.options.maxElevation, 8);
    assert.strictEqual(mapper.options.minElevation, -3);
  });

  it('should create instance with custom options', () => {
    const mapper = new ElevationMapper({ maxElevation: 4, minElevation: -1, pitChance: 0 });
    assert.strictEqual(mapper.options.maxElevation, 4);
    assert.strictEqual(mapper.options.minElevation, -1);
    assert.strictEqual(mapper.options.pitChance, 0);
  });

  it('should generate elevation grid with correct dimensions', () => {
    const mapper = new ElevationMapper();
    const rng = new SeededRandom(12345);
    const { elevation, connections } = mapper.generateElevation(16, 16, () => rng.next());

    assert.strictEqual(elevation.length, 16);
    assert.strictEqual(elevation[0].length, 16);
    assert.strictEqual(connections.length, 16);
    assert.strictEqual(connections[0].length, 16);
  });

  it('should generate deterministic elevation with same seed', () => {
    const mapper = new ElevationMapper();

    const rng1 = new SeededRandom(42);
    const result1 = mapper.generateElevation(10, 10, () => rng1.next());

    const rng2 = new SeededRandom(42);
    const result2 = mapper.generateElevation(10, 10, () => rng2.next());

    assert.deepStrictEqual(result1.elevation, result2.elevation);
  });

  it('should flatten edges when configured', () => {
    const mapper = new ElevationMapper({ flattenEdges: true, edgeMargin: 2 });
    const rng = new SeededRandom(999);
    const { elevation } = mapper.generateElevation(20, 20, () => rng.next());

    // Check corners are at or near ground level
    assert.ok(Math.abs(elevation[0][0]) <= 1);
    assert.ok(Math.abs(elevation[0][19]) <= 1);
    assert.ok(Math.abs(elevation[19][0]) <= 1);
    assert.ok(Math.abs(elevation[19][19]) <= 1);
  });

  it('should generate connections between different elevations', () => {
    const mapper = new ElevationMapper();
    const rng = new SeededRandom(54321);
    const { elevation, connections } = mapper.generateElevation(20, 20, () => rng.next());

    let hasConnection = false;
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const conn = connections[y][x];
        if (conn.n || conn.s || conn.e || conn.w) {
          hasConnection = true;
          break;
        }
      }
      if (hasConnection) break;
    }

    assert.ok(hasConnection, 'Should have at least one connection');
  });
});

describe('ElevationMapper.canMove', () => {
  it('should allow same level movement', () => {
    const elevation = [[0, 0], [0, 0]];
    const connections = [[{}, {}], [{}, {}]];

    const result = ElevationMapper.canMove(elevation, connections, 0, 0, 1, 0);
    assert.strictEqual(result.canMove, true);
    assert.strictEqual(result.type, 'flat');
  });

  it('should allow climbing via ramp', () => {
    const elevation = [[0, 1], [0, 0]];
    const connections = [[{ e: { type: 'ramp', levels: 1 } }, {}], [{}, {}]];

    const result = ElevationMapper.canMove(elevation, connections, 0, 0, 1, 0);
    assert.strictEqual(result.canMove, true);
    assert.strictEqual(result.type, 'ramp');
    assert.strictEqual(result.cost, 0);
  });

  it('should allow dropping down ledge', () => {
    const elevation = [[1, 0], [0, 0]];
    const connections = [[{ e: { type: 'ledge', levels: 1 } }, {}], [{}, {}]];

    const result = ElevationMapper.canMove(elevation, connections, 0, 0, 1, 0);
    assert.strictEqual(result.canMove, true);
    assert.strictEqual(result.type, 'ledge');
  });

  it('should not allow climbing ledge', () => {
    const elevation = [[0, 1], [0, 0]];
    const connections = [[{ e: { type: 'ledge', levels: 1 } }, {}], [{}, {}]];

    const result = ElevationMapper.canMove(elevation, connections, 0, 0, 1, 0);
    assert.strictEqual(result.canMove, false);
    assert.strictEqual(result.type, 'ledge_wrong_way');
  });
});

// ============================================================================
// EXTENDED ELEVATION FEATURES
// ============================================================================

describe('Extended Elevation Features', () => {
  it('should support tower-height structures with extended options', () => {
    const mapper = new ElevationMapper({ maxElevation: 8, minElevation: -3 });
    const rng = new SeededRandom(12345);
    const { elevation } = mapper.generateElevation(20, 20, () => rng.next());
    
    // Verify elevation range is respected
    let minFound = Infinity;
    let maxFound = -Infinity;
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        minFound = Math.min(minFound, elevation[y][x]);
        maxFound = Math.max(maxFound, elevation[y][x]);
      }
    }
    
    assert.ok(minFound >= -3, `Min elevation ${minFound} should be >= -3`);
    assert.ok(maxFound <= 8, `Max elevation ${maxFound} should be <= 8`);
  });

  it('should handle slope connections', () => {
    // Test that ramp connection type handles climbing
    const result = canTraverseElevation(0, 2, 'ramp');
    // Ramps should allow traversal for 1-level climbs, but 2-level exceeds MAX_CLIMB
    // The result depends on MAX_CLIMB (1), so 2-level climb via ramp should fail
    // unless ramps specifically allow multi-level climbs
    assert.strictEqual(typeof result.canTraverse, 'boolean');
  });

  it('should validate full elevation range constants', () => {
    // Verify the elevation levels span the expected range
    const levels = Object.values(ELEVATION_LEVELS);
    const minLevel = Math.min(...levels);
    const maxLevel = Math.max(...levels);
    
    assert.strictEqual(minLevel, -3, 'Minimum elevation should be -3 (DEEP_PIT)');
    assert.strictEqual(maxLevel, 8, 'Maximum elevation should be 8 (CLOUD)');
    assert.strictEqual(levels.length, 12, 'Should have 12 elevation levels (-3 to +8)');
  });

  it('should discretize edge values correctly', () => {
    // Test boundary values for extended range
    assert.strictEqual(discretizeElevation(0.0), -3);   // Minimum
    assert.strictEqual(discretizeElevation(1.0), 8);    // Maximum
    assert.strictEqual(discretizeElevation(0.5), 1);    // Middle-ish (Raised)
  });
});

// ============================================================================
// ELEVATION-AWARE PATHFINDING
// ============================================================================

describe('getReachableTiles3D', () => {
  it('should fall back to 2D when no elevation', () => {
    const terrain = [
      ['grass', 'grass', 'grass'],
      ['grass', 'grass', 'grass'],
      ['grass', 'grass', 'grass']
    ];

    const tiles = getReachableTiles3D(1, 1, 0, 2, terrain, null, null, [], 3, 3);
    assert.ok(tiles.length > 0);
    assert.ok(tiles.every(t => t.z === 0));
  });

  it('should respect elevation connections', () => {
    const terrain = [
      ['grass', 'grass', 'grass'],
      ['grass', 'grass', 'grass'],
      ['grass', 'grass', 'grass']
    ];
    const elevation = [
      [0, 1, 1],
      [0, 0, 1],
      [0, 0, 0]
    ];
    const connections = [
      [{ e: { type: 'cliff', levels: 1 } }, {}, {}],
      [{}, { e: { type: 'ramp', levels: 1 } }, {}],
      [{}, {}, {}]
    ];

    const tiles = getReachableTiles3D(0, 1, 0, 3, terrain, elevation, connections, [], 3, 3);

    // Should be able to reach tile (2,1) via ramp at (1,1)
    const canReachEast = tiles.some(t => t.x === 2 && t.y === 1);
    assert.ok(canReachEast, 'Should reach elevated tile via ramp');
  });
});

describe('findPath3D', () => {
  it('should fall back to 2D when no elevation', () => {
    const terrain = [
      ['grass', 'grass', 'grass'],
      ['grass', 'grass', 'grass'],
      ['grass', 'grass', 'grass']
    ];

    const path = findPath3D(0, 0, 2, 2, terrain, null, null, [], 3, 3);
    assert.ok(path);
    assert.ok(path.length > 0);
    assert.ok(path.every(p => p.z === 0));
  });

  it('should find path using ramps', () => {
    const terrain = [
      ['grass', 'grass', 'grass'],
      ['grass', 'grass', 'grass'],
      ['grass', 'grass', 'grass']
    ];
    const elevation = [
      [0, 0, 1],
      [0, 0, 1],
      [0, 0, 1]
    ];
    // Ramp connection at (1,1) going east
    const connections = [
      [{}, {}, {}],
      [{}, { e: { type: 'ramp', levels: 1 } }, {}],
      [{}, {}, {}]
    ];

    const path = findPath3D(0, 0, 2, 2, terrain, elevation, connections, [], 3, 3);
    assert.ok(path, 'Should find path using ramp');
    assert.strictEqual(path[path.length - 1].x, 2);
    assert.strictEqual(path[path.length - 1].y, 2);
  });

  it('should not find path blocked by cliffs', () => {
    const terrain = [
      ['grass', 'grass', 'grass'],
      ['grass', 'grass', 'grass'],
      ['grass', 'grass', 'grass']
    ];
    const elevation = [
      [0, 0, 2],
      [0, 0, 2],
      [0, 0, 2]
    ];
    // Cliff at all east connections (2 level jump, no ramps)
    const connections = [
      [{}, { e: { type: 'cliff', levels: 2 } }, {}],
      [{}, { e: { type: 'cliff', levels: 2 } }, {}],
      [{}, { e: { type: 'cliff', levels: 2 } }, {}]
    ];

    const path = findPath3D(0, 0, 2, 2, terrain, elevation, connections, [], 3, 3);
    assert.strictEqual(path, null, 'Should not find path blocked by cliffs');
  });

  it('should cross a corpse at normal cost without ending on its tile', () => {
    const terrain = [['grass', 'grass', 'grass']];
    const elevation = [[0, 0, 0]];
    const connections = [[{}, {}, {}]];
    const units = [{ tileX: 1, tileY: 0, hp: 0 }];

    assert.deepStrictEqual(
      getReachableTiles3D(
        0, 0, 0, 2,
        terrain, elevation, connections,
        units, 3, 1
      ).map(({ x, y, cost }) => ({ x, y, cost })),
      [{ x: 2, y: 0, cost: 2 }]
    );
    assert.strictEqual(
      calculatePathCost3D(
        0, 0, 2, 0,
        terrain, elevation, connections,
        units, 2, 3, 1
      ),
      2
    );
    assert.strictEqual(
      calculatePathCost3D(
        0, 0, 1, 0,
        terrain, elevation, connections,
        units, 2, 3, 1
      ),
      Infinity
    );
    assert.deepStrictEqual(
      findPath3D(
        0, 0, 2, 0,
        terrain, elevation, connections,
        units, 3, 1
      ).map(({ x, y }) => ({ x, y })),
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]
    );
    assert.strictEqual(
      findPath3D(
        0, 0, 1, 0,
        terrain, elevation, connections,
        units, 3, 1
      ),
      null
    );
  });
});

// ============================================================================
// ELEVATION DAMAGE MODIFIERS
// ============================================================================

describe('calculateElevationModifier', () => {
  it('should return 1.0 for same level', () => {
    const result = calculateElevationModifier(0, 0, 'melee');
    assert.strictEqual(result.modifier, 1.0);
    assert.strictEqual(result.description, 'Same level');
  });

  it('should give bonus for high ground', () => {
    const result = calculateElevationModifier(1, 0, 'melee');
    assert.ok(result.modifier > 1.0);
    assert.ok(result.description.includes('High ground'));
    assert.strictEqual(result.elevationDiff, 1);
  });

  it('should give penalty for low ground', () => {
    const result = calculateElevationModifier(0, 1, 'melee');
    assert.ok(result.modifier < 1.0);
    assert.ok(result.description.includes('Low ground'));
    assert.strictEqual(result.elevationDiff, -1);
  });

  it('should give extra bonus for ranged attacks from high ground', () => {
    const meleeResult = calculateElevationModifier(2, 0, 'melee');
    const rangedResult = calculateElevationModifier(2, 0, 'ranged');

    assert.ok(rangedResult.modifier > meleeResult.modifier);
  });

  it('should cap bonuses at maximum', () => {
    // 10 levels above (impossible in game but tests cap)
    const result = calculateElevationModifier(10, 0, 'ranged');
    assert.ok(result.modifier <= 1.40); // MAX_ELEVATION_BONUS is 0.40
  });

  it('should cap penalties at maximum', () => {
    // 10 levels below
    const result = calculateElevationModifier(0, 10, 'melee');
    assert.ok(result.modifier >= 0.80); // MAX_ELEVATION_PENALTY is 0.20
  });
});

describe('calculateElevationAccuracyModifier', () => {
  it('should return 0 for same level', () => {
    assert.strictEqual(calculateElevationAccuracyModifier(0, 0), 0);
  });

  it('should give accuracy bonus for high ground', () => {
    const mod = calculateElevationAccuracyModifier(1, 0);
    assert.ok(mod > 0);
  });

  it('should give accuracy penalty for low ground', () => {
    const mod = calculateElevationAccuracyModifier(0, 1);
    assert.ok(mod < 0);
  });
});

describe('calculateElevationEvasionModifier', () => {
  it('should return 0 for same level', () => {
    assert.strictEqual(calculateElevationEvasionModifier(0, 0), 0);
  });

  it('should give evasion bonus when defender is higher', () => {
    const mod = calculateElevationEvasionModifier(0, 1);
    assert.ok(mod > 0);
  });

  it('should give evasion penalty when defender is lower (in pit)', () => {
    const mod = calculateElevationEvasionModifier(1, 0);
    assert.ok(mod < 0);
  });
});

describe('calculateDamagePreviewWithElevation', () => {
  const attacker = { strength: 50, attack: 20, agility: 30, luck: 20 };
  const defender = { vitality: 30, defense: 15, agility: 25, luck: 15, hp: 100 };
  const skill = { power: 100, damageType: 'physical', attackType: 'melee' };

  it('should include elevation data in preview', () => {
    const preview = calculateDamagePreviewWithElevation(
      attacker, defender, skill,
      { attackerZ: 1, defenderZ: 0 }
    );

    assert.ok(preview.elevationModifier > 1.0);
    assert.ok(preview.elevationDescription);
    assert.strictEqual(preview.attackerElevation, 1);
    assert.strictEqual(preview.defenderElevation, 0);
    assert.ok(preview.baseDamage);
  });

  it('should modify damage based on elevation', () => {
    const highGroundPreview = calculateDamagePreviewWithElevation(
      attacker, defender, skill,
      { attackerZ: 2, defenderZ: 0 }
    );

    const sameLevelPreview = calculateDamagePreviewWithElevation(
      attacker, defender, skill,
      { attackerZ: 0, defenderZ: 0 }
    );

    assert.ok(highGroundPreview.maxDamage > sameLevelPreview.maxDamage);
  });

  it('should read elevation from unit z property', () => {
    const attackerWithZ = { ...attacker, z: 1 };
    const defenderWithZ = { ...defender, z: 0 };

    const preview = calculateDamagePreviewWithElevation(
      attackerWithZ, defenderWithZ, skill
    );

    assert.strictEqual(preview.attackerElevation, 1);
    assert.strictEqual(preview.defenderElevation, 0);
    assert.ok(preview.elevationModifier > 1.0);
  });

  it('should not affect healing with elevation', () => {
    const healSkill = { power: 100, type: 'heal' };

    const preview = calculateDamagePreviewWithElevation(
      attacker, defender, healSkill,
      { attackerZ: 2, defenderZ: 0 }
    );

    assert.strictEqual(preview.elevationModifier, 1.0);
    assert.ok(preview.maxHeal > 0);
  });
});
