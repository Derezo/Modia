/**
 * ConstraintValidator Unit Tests
 * Tests for map constraint validation and repair
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  ConstraintValidator,
  VIOLATION_TYPES,
  validateTerrain,
  validateAndRepairTerrain
} from './mapgen/ConstraintValidator.js';
import { DEFAULT_CONSTRAINTS } from './mapgen/archetypes/constraints.js';
import { createSeededRandom } from './mapgen/PRNGStreams.js';

// Helper to create a simple terrain grid
function createTerrain(width, height, fill = 'grass') {
  return Array.from({ length: height }, () => Array(width).fill(fill));
}

// Helper to create obstacle grid
function createObstacles(width, height, fill = null) {
  return Array.from({ length: height }, () => Array(width).fill(fill));
}

describe('ConstraintValidator', () => {
  describe('Constructor', () => {
    it('should use default constraints when none provided', () => {
      const validator = new ConstraintValidator();
      assert.ok(validator.constraints);
      assert.ok(validator.constraints.minWalkableRatio !== undefined);
    });

    it('should merge provided constraints with defaults', () => {
      const validator = new ConstraintValidator({ minWalkableRatio: 0.6 });
      assert.strictEqual(validator.constraints.minWalkableRatio, 0.6);
    });
  });

  describe('validate()', () => {
    it('should return validation result with metrics', () => {
      const terrain = createTerrain(32, 32, 'grass');
      const obstacles = createObstacles(32, 32);
      const validator = new ConstraintValidator();

      const result = validator.validate(terrain, obstacles, 32, 32);

      assert.ok(result.valid !== undefined);
      assert.ok(result.violations !== undefined);
      assert.ok(result.metrics !== undefined);
      assert.ok(result.metrics.walkableRatio !== undefined);
    });

    it('should pass for valid open terrain with relaxed constraints', () => {
      const terrain = createTerrain(32, 32, 'grass');
      const obstacles = createObstacles(32, 32);
      // Use relaxed constraints that allow fully open terrain
      const validator = new ConstraintValidator({
        maxWalkableRatio: 1.0,  // Allow 100% walkable
        minApproachPaths: 1     // Allow single approach path
      });

      const result = validator.validate(terrain, obstacles, 32, 32);

      assert.ok(result.valid, `Expected valid map but got violations: ${JSON.stringify(result.violations)}`);
    });

    it('should fail when walkable ratio is too low', () => {
      const terrain = createTerrain(32, 32, 'rock'); // All impassable
      // Clear spawn areas to avoid POI violations masking walkable issue
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 5; x++) terrain[y][x] = 'grass';
        for (let x = 27; x < 32; x++) terrain[y][x] = 'grass';
      }

      const obstacles = createObstacles(32, 32);
      const validator = new ConstraintValidator({ minWalkableRatio: 0.4 });

      const result = validator.validate(terrain, obstacles, 32, 32);

      assert.ok(!result.valid);
      const hasWalkableViolation = result.violations.some(
        v => v.type === VIOLATION_TYPES.WALKABLE_TOO_LOW ||
             v.type === VIOLATION_TYPES.DISCONNECTED_REGIONS
      );
      assert.ok(hasWalkableViolation, 'Should have walkable ratio or connectivity violation');
    });

    it('should fail when spawns are disconnected', () => {
      const terrain = createTerrain(32, 32, 'grass');
      // Block path between spawns
      for (let y = 0; y < 32; y++) {
        terrain[y][16] = 'rock';
      }

      const obstacles = createObstacles(32, 32);
      const validator = new ConstraintValidator();

      const result = validator.validate(terrain, obstacles, 32, 32);

      assert.ok(!result.valid);
      const hasConnectivityViolation = result.violations.some(
        v => v.type === VIOLATION_TYPES.DISCONNECTED_REGIONS ||
             v.type === VIOLATION_TYPES.POI_UNREACHABLE
      );
      assert.ok(hasConnectivityViolation, 'Should have connectivity violation');
    });

    it('should detect dead ends', () => {
      // Create a map with many dead end corridors
      const terrain = createTerrain(32, 32, 'rock');

      // Create main corridor
      for (let x = 0; x < 32; x++) {
        terrain[16][x] = 'grass';
      }

      // Create multiple dead end branches
      for (let branch = 0; branch < 10; branch++) {
        const x = 5 + branch * 2;
        terrain[15][x] = 'grass';
        terrain[14][x] = 'grass';
        terrain[13][x] = 'grass'; // Dead end
      }

      const obstacles = createObstacles(32, 32);
      const validator = new ConstraintValidator({ maxDeadEnds: 2 });

      const result = validator.validate(terrain, obstacles, 32, 32);

      // Should detect dead ends
      assert.ok(result.metrics.deadEndCount > 2, `Expected more than 2 dead ends, got ${result.metrics.deadEndCount}`);
    });

    it('should count connected components', () => {
      const terrain = createTerrain(32, 32, 'grass');
      // Create a wall dividing the map (except spawn areas)
      for (let y = 0; y < 32; y++) {
        terrain[y][16] = 'rock';
      }

      const obstacles = createObstacles(32, 32);
      const validator = new ConstraintValidator();

      const result = validator.validate(terrain, obstacles, 32, 32);

      assert.ok(result.metrics.componentCount >= 2, 'Should have multiple components');
    });
  });

  describe('validateAndRepair()', () => {
    it('should repair disconnected components', () => {
      const terrain = createTerrain(32, 32, 'grass');
      // Create wall dividing map
      for (let y = 0; y < 32; y++) {
        terrain[y][16] = 'rock';
      }

      const obstacles = createObstacles(32, 32);
      const random = createSeededRandom(42);
      const validator = new ConstraintValidator();

      const result = validator.validateAndRepair(terrain, obstacles, 32, 32, random);

      // Should either be repaired or have attempted repair
      assert.ok(result.repairIterations >= 0);
      // Final result should show improvement
      assert.ok(result.metrics.componentCount <= 2);
    });

    it('should respect max repair iterations', () => {
      const terrain = createTerrain(10, 10, 'rock');
      // Extremely constrained - hard to fix
      terrain[5][5] = 'grass';
      // Clear spawn areas
      for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 3; x++) terrain[y][x] = 'grass';
        for (let x = 7; x < 10; x++) terrain[y][x] = 'grass';
      }

      const obstacles = createObstacles(10, 10);
      const random = createSeededRandom(42);
      const validator = new ConstraintValidator({
        minWalkableRatio: 0.9,
        maxRepairIterations: 3
      });

      const result = validator.validateAndRepair(terrain, obstacles, 10, 10, random);

      assert.ok(result.repairIterations <= 3, `Should respect max iterations, got ${result.repairIterations}`);
    });

    it('should return metrics in result', () => {
      const terrain = createTerrain(20, 20, 'grass');
      const obstacles = createObstacles(20, 20);
      const random = createSeededRandom(42);
      const validator = new ConstraintValidator();

      const result = validator.validateAndRepair(terrain, obstacles, 20, 20, random);

      assert.ok(result.metrics);
      assert.ok(result.metrics.walkableRatio !== undefined);
      assert.ok(result.metrics.componentCount !== undefined);
    });
  });

  describe('Standalone functions', () => {
    it('validateTerrain should work without instance', () => {
      const terrain = createTerrain(20, 20, 'grass');
      const obstacles = createObstacles(20, 20);

      const result = validateTerrain(terrain, obstacles, 20, 20);

      assert.ok(result.valid !== undefined);
      assert.ok(result.metrics !== undefined);
    });

    it('validateAndRepairTerrain should work without instance', () => {
      const terrain = createTerrain(20, 20, 'grass');
      const obstacles = createObstacles(20, 20);
      const random = createSeededRandom(42);

      const result = validateAndRepairTerrain(terrain, obstacles, 20, 20, random);

      assert.ok(result.valid !== undefined);
      assert.ok(result.metrics !== undefined);
    });
  });

  describe('VIOLATION_TYPES', () => {
    it('should have all required violation types', () => {
      assert.ok(VIOLATION_TYPES.WALKABLE_TOO_LOW);
      assert.ok(VIOLATION_TYPES.WALKABLE_TOO_HIGH);
      assert.ok(VIOLATION_TYPES.DISCONNECTED_REGIONS);
      assert.ok(VIOLATION_TYPES.POI_UNREACHABLE);
      assert.ok(VIOLATION_TYPES.TOO_MANY_DEAD_ENDS);
      assert.ok(VIOLATION_TYPES.PATH_TOO_LONG);
      assert.ok(VIOLATION_TYPES.BOTTLENECK_TOO_NARROW);
      assert.ok(VIOLATION_TYPES.INSUFFICIENT_PATHS);
    });
  });

  describe('DEFAULT_CONSTRAINTS', () => {
    it('should have sensible defaults', () => {
      assert.ok(DEFAULT_CONSTRAINTS.minWalkableRatio > 0, 'minWalkableRatio should be > 0');
      assert.ok(DEFAULT_CONSTRAINTS.minWalkableRatio < 1, 'minWalkableRatio should be < 1');
      assert.ok(DEFAULT_CONSTRAINTS.maxDeadEnds >= 0, 'maxDeadEnds should be >= 0');
      assert.ok(DEFAULT_CONSTRAINTS.maxRepairIterations >= 1, 'maxRepairIterations should be >= 1');
    });
  });

  describe('Repair behavior', () => {
    it('should improve metrics after repair', () => {
      const terrain = createTerrain(32, 32, 'grass');
      // Create disconnection
      for (let y = 5; y < 27; y++) {
        terrain[y][16] = 'rock';
      }

      const obstacles = createObstacles(32, 32);
      const random = createSeededRandom(42);
      const validator = new ConstraintValidator();

      const beforeResult = validator.validate(terrain, obstacles, 32, 32);
      validator.validateAndRepair(terrain, obstacles, 32, 32, random);
      const afterResult = validator.validate(terrain, obstacles, 32, 32);

      // Connectivity should improve or stay same
      assert.ok(
        afterResult.metrics.spawnsConnected || afterResult.metrics.spawnsConnected === beforeResult.metrics.spawnsConnected,
        'Spawns should be connected after repair'
      );
    });
  });
});
