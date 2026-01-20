/**
 * CoverGridSystem Unit Tests
 * Tests for tactical cover placement and lane generation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  CoverGridSystem,
  COVER_LEVELS,
  COVER_BONUSES,
  DEFAULT_LANE_CONFIG,
  COVER_STRATEGIES,
  generateCoverGrid
} from './mapgen/CoverGridSystem.js';
import { createSeededRandom } from './mapgen/PRNGStreams.js';

describe('CoverGridSystem', () => {
  describe('COVER_LEVELS', () => {
    it('should define all cover levels', () => {
      assert.strictEqual(COVER_LEVELS.NONE, 0);
      assert.strictEqual(COVER_LEVELS.LOW, 1);
      assert.strictEqual(COVER_LEVELS.HIGH, 2);
    });
  });

  describe('COVER_BONUSES', () => {
    it('should define defense bonuses', () => {
      assert.strictEqual(COVER_BONUSES[COVER_LEVELS.NONE], 0);
      assert.ok(COVER_BONUSES[COVER_LEVELS.LOW] > 0);
      assert.ok(COVER_BONUSES[COVER_LEVELS.HIGH] > COVER_BONUSES[COVER_LEVELS.LOW]);
    });
  });

  describe('DEFAULT_LANE_CONFIG', () => {
    it('should have lane configuration', () => {
      assert.ok(DEFAULT_LANE_CONFIG.count > 0);
      assert.ok(DEFAULT_LANE_CONFIG.bufferFromEdge >= 0);
    });
  });

  describe('COVER_STRATEGIES', () => {
    it('should define all strategies', () => {
      assert.ok(COVER_STRATEGIES.SYMMETRIC);
      assert.ok(COVER_STRATEGIES.STAGGERED);
      assert.ok(COVER_STRATEGIES.DEFENSIVE);
      assert.ok(COVER_STRATEGIES.SCATTERED);
      assert.ok(COVER_STRATEGIES.CHOKEPOINT);
      assert.ok(COVER_STRATEGIES.PERIMETER);
    });
  });

  describe('Constructor', () => {
    it('should create grid with correct dimensions', () => {
      const system = new CoverGridSystem(20, 15);
      assert.strictEqual(system.width, 20);
      assert.strictEqual(system.height, 15);
    });

    it('should initialize empty cover grid', () => {
      const system = new CoverGridSystem(10, 10);

      // All should be NONE
      for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
          assert.strictEqual(system.getCoverAt(x, y), COVER_LEVELS.NONE);
        }
      }
    });
  });

  describe('generate()', () => {
    it('should generate cover positions', () => {
      const system = new CoverGridSystem(32, 32);
      const random = createSeededRandom(42);

      system.generate(COVER_STRATEGIES.STAGGERED, random);

      // Should have some cover
      let coverCount = 0;
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          if (system.getCoverAt(x, y) !== COVER_LEVELS.NONE) {
            coverCount++;
          }
        }
      }

      assert.ok(coverCount > 0, 'Should have placed some cover');
    });

    it('should be deterministic with same seed', () => {
      const system1 = new CoverGridSystem(20, 20);
      system1.generate(COVER_STRATEGIES.STAGGERED, createSeededRandom(42));

      const system2 = new CoverGridSystem(20, 20);
      system2.generate(COVER_STRATEGIES.STAGGERED, createSeededRandom(42));

      // Check they have same cover positions
      for (let y = 0; y < 20; y++) {
        for (let x = 0; x < 20; x++) {
          assert.strictEqual(
            system1.getCoverAt(x, y),
            system2.getCoverAt(x, y),
            `Cover mismatch at ${x},${y}`
          );
        }
      }
    });

    it('should produce different results with different seeds', () => {
      const system1 = new CoverGridSystem(20, 20);
      system1.generate(COVER_STRATEGIES.STAGGERED, createSeededRandom(1));

      const system2 = new CoverGridSystem(20, 20);
      system2.generate(COVER_STRATEGIES.STAGGERED, createSeededRandom(2));

      // Should be different (check for any difference)
      let differences = 0;
      for (let y = 0; y < 20; y++) {
        for (let x = 0; x < 20; x++) {
          if (system1.getCoverAt(x, y) !== system2.getCoverAt(x, y)) {
            differences++;
          }
        }
      }

      assert.ok(differences > 0, 'Different seeds should produce different grids');
    });
  });

  describe('Symmetric strategy', () => {
    it('should produce approximately symmetric cover', () => {
      const system = new CoverGridSystem(20, 20);
      const random = createSeededRandom(42);

      system.generate(COVER_STRATEGIES.SYMMETRIC, random);

      // Check symmetry across vertical center
      const midX = Math.floor(20 / 2);
      let symmetryMatches = 0;
      let totalChecked = 0;

      for (let y = 0; y < 20; y++) {
        for (let x = 0; x < midX; x++) {
          const mirrorX = 20 - 1 - x;
          if (system.getCoverAt(x, y) === system.getCoverAt(mirrorX, y)) {
            symmetryMatches++;
          }
          totalChecked++;
        }
      }

      // Most positions should be symmetric
      const symmetryRatio = symmetryMatches / totalChecked;
      assert.ok(
        symmetryRatio > 0.7,
        `Expected high symmetry ratio, got ${symmetryRatio}`
      );
    });
  });

  describe('getCoverAt()', () => {
    it('should return cover level at position', () => {
      const system = new CoverGridSystem(10, 10);
      const random = createSeededRandom(42);

      system.generate(COVER_STRATEGIES.SCATTERED, random);

      // Should return valid cover level
      const cover = system.getCoverAt(5, 5);
      assert.ok([COVER_LEVELS.NONE, COVER_LEVELS.LOW, COVER_LEVELS.HIGH].includes(cover));
    });

    it('should return NONE for out of bounds', () => {
      const system = new CoverGridSystem(10, 10);

      assert.strictEqual(system.getCoverAt(-1, 5), COVER_LEVELS.NONE);
      assert.strictEqual(system.getCoverAt(5, -1), COVER_LEVELS.NONE);
      assert.strictEqual(system.getCoverAt(10, 5), COVER_LEVELS.NONE);
      assert.strictEqual(system.getCoverAt(5, 10), COVER_LEVELS.NONE);
    });
  });

  describe('getDefenseBonus()', () => {
    it('should return defense bonus for position', () => {
      const system = new CoverGridSystem(10, 10);

      // Manually set a cover position
      system.grid[5][5] = COVER_LEVELS.HIGH;

      const bonus = system.getDefenseBonus(5, 5);
      assert.strictEqual(bonus, COVER_BONUSES[COVER_LEVELS.HIGH]);
    });

    it('should return 0 for no cover', () => {
      const system = new CoverGridSystem(10, 10);

      const bonus = system.getDefenseBonus(5, 5);
      assert.strictEqual(bonus, 0);
    });
  });

  describe('getCoverPositions()', () => {
    it('should return array of cover positions', () => {
      const system = new CoverGridSystem(20, 20);
      const random = createSeededRandom(42);

      system.generate(COVER_STRATEGIES.SCATTERED, random);

      const positions = system.getCoverPositions();

      assert.ok(Array.isArray(positions));
      assert.ok(positions.length > 0, 'Should have cover positions');

      // Each position should have x, y, level
      for (const pos of positions) {
        assert.ok(pos.x !== undefined);
        assert.ok(pos.y !== undefined);
        assert.ok(pos.level !== undefined);
      }
    });
  });

  describe('mapToObstacles()', () => {
    it('should convert cover grid to obstacles', () => {
      const system = new CoverGridSystem(20, 20);
      const random = createSeededRandom(42);

      system.generate(COVER_STRATEGIES.SCATTERED, random);

      const mapping = {
        [COVER_LEVELS.LOW]: { type: 'rocks', variants: ['rock_small'] },
        [COVER_LEVELS.HIGH]: { type: 'rocks', variants: ['rock_large'] }
      };

      const obstacles = system.mapToObstacles(mapping);

      // Returns array of obstacle objects, not 2D grid
      assert.ok(Array.isArray(obstacles));
      // Should have obstacles for each cover position
      const coverPositions = system.getCoverPositions();
      assert.strictEqual(obstacles.length, coverPositions.length);

      // Each obstacle should have x, y, type, variant
      if (obstacles.length > 0) {
        const first = obstacles[0];
        assert.ok(first.x !== undefined);
        assert.ok(first.y !== undefined);
        assert.ok(first.type !== undefined);
        assert.ok(first.variant !== undefined);
      }
    });
  });

  describe('getLaneAt()', () => {
    it('should return lane object for y position', () => {
      const system = new CoverGridSystem(32, 32);

      // Should return lane object or null
      const lane = system.getLaneAt(16); // Middle of map

      // If a lane is found, it should have yStart and yEnd
      if (lane !== null) {
        assert.ok(lane.yStart !== undefined);
        assert.ok(lane.yEnd !== undefined);
      }
    });
  });

  describe('getStats()', () => {
    it('should provide coverage statistics', () => {
      const system = new CoverGridSystem(20, 20);
      const random = createSeededRandom(42);

      system.generate(COVER_STRATEGIES.STAGGERED, random);

      const stats = system.getStats();

      assert.ok(stats.total !== undefined);
      assert.ok(stats.low !== undefined);
      assert.ok(stats.high !== undefined);
      assert.strictEqual(stats.total, stats.low + stats.high);
    });
  });

  describe('Spawn area clearing', () => {
    it('should not place cover in spawn areas (columns 0-4 and 27-31 for 32-wide)', () => {
      const system = new CoverGridSystem(32, 32);
      const random = createSeededRandom(42);

      system.generate(COVER_STRATEGIES.SCATTERED, random);

      // Check left spawn area (columns 0-4)
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 5; x++) {
          assert.strictEqual(
            system.getCoverAt(x, y),
            COVER_LEVELS.NONE,
            `Cover found in player spawn at ${x},${y}`
          );
        }
      }

      // Check right spawn area (columns 27-31)
      for (let y = 0; y < 32; y++) {
        for (let x = 27; x < 32; x++) {
          assert.strictEqual(
            system.getCoverAt(x, y),
            COVER_LEVELS.NONE,
            `Cover found in enemy spawn at ${x},${y}`
          );
        }
      }
    });
  });

  describe('Standalone generateCoverGrid()', () => {
    it('should work without instance', () => {
      const random = createSeededRandom(42);
      const grid = generateCoverGrid(20, 20, COVER_STRATEGIES.STAGGERED, random);

      assert.strictEqual(grid.length, 20);
      assert.strictEqual(grid[0].length, 20);
    });
  });

  describe('All strategies should work', () => {
    const strategies = [
      COVER_STRATEGIES.SYMMETRIC,
      COVER_STRATEGIES.STAGGERED,
      COVER_STRATEGIES.DEFENSIVE,
      COVER_STRATEGIES.SCATTERED,
      COVER_STRATEGIES.CHOKEPOINT,
      COVER_STRATEGIES.PERIMETER
    ];

    for (const strategy of strategies) {
      it(`should generate cover with ${strategy} strategy`, () => {
        const system = new CoverGridSystem(32, 32);
        const random = createSeededRandom(42);

        system.generate(strategy, random);

        // Should have some cover (or none is fine for some strategies)
        const positions = system.getCoverPositions();
        assert.ok(Array.isArray(positions));
      });
    }
  });
});
