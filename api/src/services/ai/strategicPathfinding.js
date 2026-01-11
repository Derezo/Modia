/**
 * Strategic Pathfinding - Multi-turn path planning for AI
 *
 * Provides long-range pathfinding for AI units to plan movement toward
 * enemies over multiple turns, preventing the AI from getting stuck or
 * waiting when enemies are far away.
 */

import { findPath, getManhattanDistance } from '../../../../shared/pathfinding.js';

/**
 * Calculate strategic path from unit to nearest enemy
 * @param {Object} unit - The AI unit planning movement
 * @param {Object} state - Current battle state with units, terrain, mapWidth, mapHeight
 * @returns {Object} { path, nextWaypoint, turnsToReach, targetEnemy }
 */
export function calculateStrategicPath(unit, state) {
  const enemies = state.units.filter(u => u.type !== unit.type && u.hp > 0);
  if (enemies.length === 0) {
    return { path: null, nextWaypoint: null, turnsToReach: Infinity, targetEnemy: null };
  }

  let bestPath = null;
  let bestEnemy = null;
  let bestCost = Infinity;

  for (const enemy of enemies) {
    const path = findPath(
      unit.tileX, unit.tileY,
      enemy.tileX, enemy.tileY,
      state.terrain,
      state.units,
      state.mapWidth || 32,
      state.mapHeight || 32
    );

    if (path && path.length < bestCost) {
      bestPath = path;
      bestEnemy = enemy;
      bestCost = path.length;
    }
  }

  if (!bestPath) {
    return { path: null, nextWaypoint: null, turnsToReach: Infinity, targetEnemy: null };
  }

  const movementPerTurn = unit.movement || 3;
  const turnsToReach = Math.ceil((bestPath.length - 1) / movementPerTurn);
  const nextWaypointIndex = Math.min(movementPerTurn, bestPath.length - 1);

  return {
    path: bestPath,
    nextWaypoint: bestPath[nextWaypointIndex],
    turnsToReach,
    targetEnemy: bestEnemy
  };
}

/**
 * Score a tile based on strategic path progress
 * Higher scores for tiles that are on the optimal path toward the target enemy
 *
 * @param {Object} tile - Tile position { x, y } to evaluate
 * @param {Object} strategicInfo - Result from calculateStrategicPath
 * @param {Object} unit - The unit considering the move
 * @returns {number} Score from 0-100 based on strategic value
 */
export function scoreStrategicMovement(tile, strategicInfo, unit) {
  if (!strategicInfo.path || !strategicInfo.nextWaypoint || !strategicInfo.targetEnemy) return 0;

  const { path, nextWaypoint, targetEnemy } = strategicInfo;
  const isOnPath = path.some(p => p.x === tile.x && p.y === tile.y);

  const distToWaypoint = getManhattanDistance(tile.x, tile.y, nextWaypoint.x, nextWaypoint.y);
  const distToEnemy = getManhattanDistance(tile.x, tile.y, targetEnemy.tileX, targetEnemy.tileY);
  const currentDistToEnemy = getManhattanDistance(unit.tileX, unit.tileY, targetEnemy.tileX, targetEnemy.tileY);

  let score = 0;

  // Bonus for being on the optimal path
  if (isOnPath) score += 40;

  // Reward proximity to next waypoint (up to 30 points)
  score += Math.max(0, 30 - distToWaypoint * 5);

  // Reward progress toward enemy (up to 30 points for each tile closer)
  score += Math.max(0, Math.min(30, (currentDistToEnemy - distToEnemy) * 10));

  return score;
}

/**
 * Find best strategic move from reachable tiles
 * Evaluates all reachable tiles and returns the one with best strategic value
 *
 * @param {Object} unit - The unit planning to move
 * @param {Array} reachableTiles - Array of { x, y, cost } tiles unit can reach
 * @param {Object} state - Current battle state
 * @returns {Object} { tile, strategicScore, strategicInfo }
 */
export function findBestStrategicMove(unit, reachableTiles, state) {
  const strategicInfo = calculateStrategicPath(unit, state);
  if (!strategicInfo.path) {
    return { tile: null, strategicScore: 0, strategicInfo };
  }

  let bestTile = null;
  let bestScore = -Infinity;

  for (const tile of reachableTiles) {
    const score = scoreStrategicMovement(tile, strategicInfo, unit);
    if (score > bestScore) {
      bestScore = score;
      bestTile = tile;
    }
  }

  return { tile: bestTile, strategicScore: bestScore, strategicInfo };
}
