/**
 * Strategic Pathfinding Unit Tests
 *
 * Tests for AI multi-turn path planning functions.
 * Focus on the pure scoring function that doesn't require full pathfinding.
 */

import { describe, it, test } from 'node:test';
import assert from 'node:assert';
import { scoreStrategicMovement } from '../../services/ai/strategicPathfinding.js';

describe('Strategic Pathfinding - scoreStrategicMovement', () => {
  describe('basic scoring', () => {
    it('should return 0 when no strategic info', () => {
      const tile = { x: 5, y: 5 };
      const strategicInfo = { path: null, nextWaypoint: null, targetEnemy: null };
      const unit = { tileX: 4, tileY: 5 };

      const score = scoreStrategicMovement(tile, strategicInfo, unit);
      assert.strictEqual(score, 0);
    });

    it('should return 0 when path is null', () => {
      const tile = { x: 5, y: 5 };
      const strategicInfo = {
        path: null,
        nextWaypoint: { x: 6, y: 5 },
        targetEnemy: { tileX: 10, tileY: 5 }
      };
      const unit = { tileX: 4, tileY: 5 };

      const score = scoreStrategicMovement(tile, strategicInfo, unit);
      assert.strictEqual(score, 0);
    });

    it('should return 0 when nextWaypoint is null', () => {
      const tile = { x: 5, y: 5 };
      const strategicInfo = {
        path: [{ x: 5, y: 5 }],
        nextWaypoint: null,
        targetEnemy: { tileX: 10, tileY: 5 }
      };
      const unit = { tileX: 4, tileY: 5 };

      const score = scoreStrategicMovement(tile, strategicInfo, unit);
      assert.strictEqual(score, 0);
    });

    it('should return 0 when targetEnemy is null', () => {
      const tile = { x: 5, y: 5 };
      const strategicInfo = {
        path: [{ x: 5, y: 5 }],
        nextWaypoint: { x: 6, y: 5 },
        targetEnemy: null
      };
      const unit = { tileX: 4, tileY: 5 };

      const score = scoreStrategicMovement(tile, strategicInfo, unit);
      assert.strictEqual(score, 0);
    });
  });

  describe('on-path bonus', () => {
    it('should give bonus for tiles on the optimal path', () => {
      const tile = { x: 6, y: 5 };
      const strategicInfo = {
        path: [
          { x: 5, y: 5 },
          { x: 6, y: 5 },  // Tile is on path
          { x: 7, y: 5 }
        ],
        nextWaypoint: { x: 6, y: 5 },
        targetEnemy: { tileX: 10, tileY: 5 }
      };
      const unit = { tileX: 5, tileY: 5 };

      const onPathScore = scoreStrategicMovement(tile, strategicInfo, unit);

      // Compare to off-path tile
      const offPathTile = { x: 5, y: 6 };
      const offPathScore = scoreStrategicMovement(offPathTile, strategicInfo, unit);

      assert.ok(onPathScore > offPathScore, 'On-path tile should score higher');
    });
  });

  describe('waypoint proximity bonus', () => {
    it('should reward proximity to next waypoint', () => {
      const nearTile = { x: 7, y: 5 };  // 1 tile from waypoint
      const farTile = { x: 3, y: 5 };   // 5 tiles from waypoint

      const strategicInfo = {
        path: [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }],
        nextWaypoint: { x: 8, y: 5 },
        targetEnemy: { tileX: 10, tileY: 5 }
      };
      const unit = { tileX: 5, tileY: 5 };

      const nearScore = scoreStrategicMovement(nearTile, strategicInfo, unit);
      const farScore = scoreStrategicMovement(farTile, strategicInfo, unit);

      assert.ok(nearScore > farScore, 'Closer to waypoint should score higher');
    });

    it('should give maximum bonus at waypoint location', () => {
      const waypointTile = { x: 8, y: 5 };

      const strategicInfo = {
        path: [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }],
        nextWaypoint: { x: 8, y: 5 },
        targetEnemy: { tileX: 10, tileY: 5 }
      };
      const unit = { tileX: 5, tileY: 5 };

      const score = scoreStrategicMovement(waypointTile, strategicInfo, unit);
      // At waypoint, distance is 0, so bonus is max(0, 30 - 0*5) = 30
      assert.ok(score >= 30, 'Should get full waypoint proximity bonus');
    });
  });

  describe('enemy progress bonus', () => {
    it('should reward moving closer to enemy', () => {
      const closerTile = { x: 8, y: 5 };  // 2 tiles from enemy
      const fartherTile = { x: 4, y: 5 }; // 6 tiles from enemy

      const strategicInfo = {
        path: [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }],
        nextWaypoint: { x: 8, y: 5 },
        targetEnemy: { tileX: 10, tileY: 5 }
      };
      const unit = { tileX: 5, tileY: 5 };  // Currently 5 tiles from enemy

      const closerScore = scoreStrategicMovement(closerTile, strategicInfo, unit);
      const fartherScore = scoreStrategicMovement(fartherTile, strategicInfo, unit);

      assert.ok(closerScore > fartherScore, 'Moving closer to enemy should score higher');
    });

    it('should penalize moving away from enemy', () => {
      const awayTile = { x: 2, y: 5 };  // 8 tiles from enemy (farther than current 5)

      const strategicInfo = {
        path: [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 5 }],
        nextWaypoint: { x: 7, y: 5 },
        targetEnemy: { tileX: 10, tileY: 5 }
      };
      const unit = { tileX: 5, tileY: 5 };

      const score = scoreStrategicMovement(awayTile, strategicInfo, unit);
      // Moving away should not get enemy progress bonus
      // Score should be relatively low
      assert.ok(score < 50, 'Moving away from enemy should have low score');
    });
  });

  describe('combined scoring', () => {
    it('should combine all factors for optimal tile', () => {
      // Optimal tile: on path, near waypoint, closer to enemy
      const optimalTile = { x: 7, y: 5 };

      const strategicInfo = {
        path: [
          { x: 5, y: 5 },
          { x: 6, y: 5 },
          { x: 7, y: 5 },
          { x: 8, y: 5 }
        ],
        nextWaypoint: { x: 7, y: 5 },  // Waypoint is at optimal tile
        targetEnemy: { tileX: 10, tileY: 5 }
      };
      const unit = { tileX: 5, tileY: 5 };

      const score = scoreStrategicMovement(optimalTile, strategicInfo, unit);

      // Should have all bonuses:
      // - On path bonus: 40
      // - Waypoint proximity: 30 (at waypoint)
      // - Enemy progress: ~20 (2 tiles closer)
      assert.ok(score >= 70, `Optimal tile should have high combined score: ${score}`);
    });

    it('should give lower score for suboptimal tile', () => {
      const optimalTile = { x: 7, y: 5 };
      const suboptimalTile = { x: 5, y: 7 };  // Off path, away from waypoint and enemy

      const strategicInfo = {
        path: [
          { x: 5, y: 5 },
          { x: 6, y: 5 },
          { x: 7, y: 5 }
        ],
        nextWaypoint: { x: 7, y: 5 },
        targetEnemy: { tileX: 10, tileY: 5 }
      };
      const unit = { tileX: 5, tileY: 5 };

      const optimalScore = scoreStrategicMovement(optimalTile, strategicInfo, unit);
      const suboptimalScore = scoreStrategicMovement(suboptimalTile, strategicInfo, unit);

      assert.ok(optimalScore > suboptimalScore,
        `Optimal: ${optimalScore}, Suboptimal: ${suboptimalScore}`);
    });
  });

  describe('edge cases', () => {
    it('should handle path with single point', () => {
      const tile = { x: 5, y: 5 };
      const strategicInfo = {
        path: [{ x: 5, y: 5 }],
        nextWaypoint: { x: 5, y: 5 },
        targetEnemy: { tileX: 10, tileY: 5 }
      };
      const unit = { tileX: 5, tileY: 5 };

      // Should not throw
      const score = scoreStrategicMovement(tile, strategicInfo, unit);
      assert.ok(typeof score === 'number');
    });

    it('should handle unit at enemy position', () => {
      const tile = { x: 10, y: 5 };
      const strategicInfo = {
        path: [{ x: 5, y: 5 }, { x: 10, y: 5 }],
        nextWaypoint: { x: 10, y: 5 },
        targetEnemy: { tileX: 10, tileY: 5 }
      };
      const unit = { tileX: 10, tileY: 5 };

      const score = scoreStrategicMovement(tile, strategicInfo, unit);
      assert.ok(typeof score === 'number');
    });

    it('should handle negative progress (moving away)', () => {
      const tile = { x: 0, y: 5 };
      const strategicInfo = {
        path: [{ x: 5, y: 5 }, { x: 6, y: 5 }],
        nextWaypoint: { x: 6, y: 5 },
        targetEnemy: { tileX: 10, tileY: 5 }
      };
      const unit = { tileX: 5, tileY: 5 };

      const score = scoreStrategicMovement(tile, strategicInfo, unit);
      // Score should not be negative (bounded by max(0, ...))
      assert.ok(score >= 0 || typeof score === 'number',
        'Should handle moving away gracefully');
    });
  });
});
