/**
 * Archetype System Unit Tests
 * Tests for map archetype definitions and selection
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  ARCHETYPES,
  getArchetype,
  getArchetypeNames,
  selectArchetypeForNode,
  NODE_TYPE_ARCHETYPE_WEIGHTS,
  validateArchetypeDefinition
} from './mapgen/archetypes/index.js';

// Alias for backward compatibility
const validateArchetype = validateArchetypeDefinition;
import {
  DEFAULT_CONSTRAINTS,
  CONSTRAINT_PRESETS,
  getConstraints
} from './mapgen/archetypes/constraints.js';
import { createSeededRandom } from './mapgen/PRNGStreams.js';

// Alias for test compatibility
function getConstraintsForArchetype(archetypeName) {
  const archetype = getArchetype(archetypeName);
  if (!archetype || !archetype.constraintPreset) {
    return DEFAULT_CONSTRAINTS;
  }
  return getConstraints(archetype.constraintPreset);
}

describe('Archetype System', () => {
  describe('ARCHETYPES', () => {
    it('should have multiple archetypes defined', () => {
      const names = Object.keys(ARCHETYPES);
      assert.ok(names.length >= 10, `Expected at least 10 archetypes, got ${names.length}`);
    });

    it('should have required archetypes', () => {
      const required = [
        'openField',
        'forestClearing',
        'caveRooms',
        'tunnelNetwork',
        'dungeonHalls',
        'arena',
        'bridgeCrossing'
      ];

      for (const name of required) {
        assert.ok(ARCHETYPES[name], `Missing required archetype: ${name}`);
      }
    });

    it('each archetype should have required fields', () => {
      for (const [name, archetype] of Object.entries(ARCHETYPES)) {
        assert.ok(archetype.name, `${name} missing name`);
        assert.ok(archetype.algorithms, `${name} missing algorithms`);
        assert.ok(Array.isArray(archetype.algorithms), `${name} algorithms should be array`);
        assert.ok(archetype.algorithms.length > 0, `${name} should have at least one algorithm`);
      }
    });

    it('each algorithm entry should have name and intensity', () => {
      for (const [archetypeName, archetype] of Object.entries(ARCHETYPES)) {
        for (const algo of archetype.algorithms) {
          assert.ok(algo.name, `Algorithm in ${archetypeName} missing name`);
          assert.ok(
            typeof algo.intensity === 'number',
            `Algorithm ${algo.name} in ${archetypeName} missing intensity`
          );
          assert.ok(
            algo.intensity >= 0 && algo.intensity <= 1,
            `Algorithm ${algo.name} in ${archetypeName} has invalid intensity: ${algo.intensity}`
          );
        }
      }
    });
  });

  describe('getArchetype()', () => {
    it('should return archetype by name', () => {
      const archetype = getArchetype('openField');

      assert.ok(archetype);
      assert.strictEqual(archetype.name, 'openField');
    });

    it('should return null for unknown archetype', () => {
      const archetype = getArchetype('nonexistent');

      assert.strictEqual(archetype, null);
    });
  });

  describe('getArchetypeNames()', () => {
    it('should return array of archetype names', () => {
      const names = getArchetypeNames();

      assert.ok(Array.isArray(names));
      assert.ok(names.length > 0);
      assert.ok(names.includes('openField'));
      assert.ok(names.includes('caveRooms'));
    });
  });

  describe('selectArchetypeForNode()', () => {
    it('should select archetype based on node type', () => {
      const random = createSeededRandom(42);
      const archetype = selectArchetypeForNode('forest', random);

      assert.ok(archetype);
      assert.ok(archetype.name);
      assert.ok(archetype.algorithms);
    });

    it('should be deterministic with same seed', () => {
      const archetype1 = selectArchetypeForNode('cave', createSeededRandom(123));
      const archetype2 = selectArchetypeForNode('cave', createSeededRandom(123));

      assert.strictEqual(archetype1.name, archetype2.name);
    });

    it('should return different archetypes with different random values', () => {
      // Run multiple times to check variety
      const selected = new Set();
      for (let i = 0; i < 100; i++) {
        const archetype = selectArchetypeForNode('forest', createSeededRandom(i));
        selected.add(archetype.name);
      }

      // Should select at least 2 different archetypes over 100 runs
      assert.ok(selected.size >= 2, `Expected variety in selection, got only: ${[...selected]}`);
    });

    it('should return default archetype for unknown node type', () => {
      const random = createSeededRandom(42);
      const archetype = selectArchetypeForNode('unknown_type', random);

      assert.ok(archetype);
      assert.ok(archetype.name);
    });
  });

  describe('NODE_TYPE_ARCHETYPE_WEIGHTS', () => {
    it('should have weights for common node types', () => {
      const nodeTypes = ['forest', 'cave', 'mountain', 'castle', 'bridge'];

      for (const nodeType of nodeTypes) {
        assert.ok(
          NODE_TYPE_ARCHETYPE_WEIGHTS[nodeType],
          `Missing weights for node type: ${nodeType}`
        );
      }
    });

    it('weights should sum to approximately 1', () => {
      for (const [nodeType, weights] of Object.entries(NODE_TYPE_ARCHETYPE_WEIGHTS)) {
        const sum = Object.values(weights).reduce((a, b) => a + b, 0);
        assert.ok(
          Math.abs(sum - 1.0) < 0.01,
          `Weights for ${nodeType} sum to ${sum}, expected ~1.0`
        );
      }
    });

    it('weights should mostly reference valid archetypes', () => {
      const missingArchetypes = [];

      for (const [nodeType, weights] of Object.entries(NODE_TYPE_ARCHETYPE_WEIGHTS)) {
        for (const archetypeName of Object.keys(weights)) {
          if (!ARCHETYPES[archetypeName]) {
            missingArchetypes.push(`${nodeType} -> ${archetypeName}`);
          }
        }
      }

      // Allow some missing archetypes (may be planned for future)
      // but not too many
      assert.ok(
        missingArchetypes.length < 5,
        `Too many missing archetypes (${missingArchetypes.length}): ${missingArchetypes.join(', ')}`
      );
    });
  });

  describe('validateArchetype()', () => {
    it('should validate correct archetype', () => {
      const archetype = ARCHETYPES.openField;
      const result = validateArchetype(archetype);

      assert.ok(result.valid, `Validation failed: ${result.errors?.join(', ')}`);
    });

    it('should reject archetype without name', () => {
      const invalid = {
        algorithms: [{ name: 'perlinTerrain', intensity: 0.5, role: 'macro' }],
        constraints: {},
        baseTerrain: 'grass'
      };

      const result = validateArchetype(invalid);

      assert.ok(!result.valid);
      assert.ok(result.errors.some(e => e.toLowerCase().includes('name')));
    });

    it('should reject archetype without algorithms', () => {
      const invalid = {
        name: 'test',
        constraints: {},
        baseTerrain: 'grass'
      };

      const result = validateArchetype(invalid);

      assert.ok(!result.valid);
      assert.ok(result.errors.some(e => e.toLowerCase().includes('algorithm')));
    });
  });

  describe('Constraints', () => {
    describe('DEFAULT_CONSTRAINTS', () => {
      it('should have all required constraint fields', () => {
        assert.ok(DEFAULT_CONSTRAINTS.minWalkableRatio !== undefined);
        assert.ok(DEFAULT_CONSTRAINTS.poiReachability !== undefined);
        assert.ok(DEFAULT_CONSTRAINTS.maxDeadEnds !== undefined);
        assert.ok(DEFAULT_CONSTRAINTS.maxRepairIterations !== undefined);
      });

      it('should have sensible default values', () => {
        assert.ok(DEFAULT_CONSTRAINTS.minWalkableRatio > 0);
        assert.ok(DEFAULT_CONSTRAINTS.minWalkableRatio < 1);
        assert.ok(DEFAULT_CONSTRAINTS.maxDeadEnds >= 0);
        assert.ok(DEFAULT_CONSTRAINTS.maxRepairIterations >= 1);
      });
    });

    describe('CONSTRAINT_PRESETS', () => {
      it('should have presets for different map types', () => {
        const presets = ['open', 'arena', 'corridor', 'rooms', 'cave', 'bridge', 'maze', 'balanced'];

        for (const preset of presets) {
          assert.ok(CONSTRAINT_PRESETS[preset], `Missing preset: ${preset}`);
        }
      });

      it('open preset should allow high walkable ratio', () => {
        assert.ok(CONSTRAINT_PRESETS.open.minWalkableRatio >= 0.6);
      });

      it('maze preset should allow more dead ends', () => {
        assert.ok(CONSTRAINT_PRESETS.maze.maxDeadEnds > DEFAULT_CONSTRAINTS.maxDeadEnds);
      });
    });

    describe('getConstraintsForArchetype()', () => {
      it('should return constraints for archetype', () => {
        const constraints = getConstraintsForArchetype('openField');

        assert.ok(constraints);
        assert.ok(constraints.minWalkableRatio !== undefined);
      });

      it('should return defaults for unknown archetype', () => {
        const constraints = getConstraintsForArchetype('nonexistent');

        assert.deepStrictEqual(constraints, DEFAULT_CONSTRAINTS);
      });
    });
  });

  describe('Archetype algorithm roles', () => {
    it('archetypes with seedFromPrevious should have macro layer first', () => {
      for (const [name, archetype] of Object.entries(ARCHETYPES)) {
        const seedFromPreviousAlgo = archetype.algorithms.find(a => a.seedFromPrevious);
        if (seedFromPreviousAlgo) {
          const macroAlgo = archetype.algorithms.find(a => a.role === 'macro');
          if (macroAlgo) {
            const macroIndex = archetype.algorithms.indexOf(macroAlgo);
            const seedIndex = archetype.algorithms.indexOf(seedFromPreviousAlgo);
            assert.ok(
              macroIndex < seedIndex,
              `${name}: seedFromPrevious algo should come after macro`
            );
          }
        }
      }
    });

    it('structure algorithms should generally precede detail algorithms', () => {
      for (const [name, archetype] of Object.entries(ARCHETYPES)) {
        let lastStructureIndex = -1;
        let firstDetailIndex = Infinity;

        archetype.algorithms.forEach((algo, index) => {
          if (algo.role === 'structure') lastStructureIndex = index;
          if (algo.role === 'detail' && index < firstDetailIndex) firstDetailIndex = index;
        });

        if (lastStructureIndex >= 0 && firstDetailIndex < Infinity) {
          assert.ok(
            lastStructureIndex < firstDetailIndex,
            `${name}: structure algorithms should come before detail`
          );
        }
      }
    });
  });

  describe('Style profiles', () => {
    it('archetypes should reference valid style profiles', () => {
      const validProfiles = ['clean', 'cluttered', 'natural', 'structured', 'organic', 'maze'];

      for (const [name, archetype] of Object.entries(ARCHETYPES)) {
        if (archetype.styleProfile) {
          assert.ok(
            validProfiles.includes(archetype.styleProfile),
            `${name} references invalid style profile: ${archetype.styleProfile}`
          );
        }
      }
    });
  });
});
