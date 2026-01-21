/**
 * Movement Service - Pathfinding, movement ranges, and targeting
 */

import { CLASS_MOVEMENT } from '../../config/constants.js';
import * as traitService from '../traitService.js';
import {
  getReachableTiles as sharedGetReachableTiles,
  getReachableTiles3D as sharedGetReachableTiles3D,
  calculatePathCost as sharedCalculatePathCost,
  calculatePathCost3D as sharedCalculatePathCost3D,
  getManhattanDistance
} from '../../../../shared/pathfinding.js';
import { canUnitMove } from './statusEffectManager.js';

// Default attack range for melee (1 tile adjacent)
const DEFAULT_ATTACK_RANGE = 1;

/**
 * Get movement range for a unit based on class and traits
 * Uses CLASS_MOVEMENT from constants for authoritative class movement values
 * @param {Object} unit - The unit
 * @returns {number} Maximum movement distance (Manhattan distance)
 */
export function getMovementRange(unit) {
  // Use class-specific movement range from constants, default to 3 if class not found
  let baseRange = CLASS_MOVEMENT[unit.class?.toLowerCase()] || 3;

  // Apply trait movement bonus (Swift Feet: +1 tile)
  const traitMovementBonus = traitService.getMovementBonus(unit);
  baseRange += traitMovementBonus;

  // Status effect adjustments
  if (unit.statusEffects?.some(e => e.type === 'slow')) {
    baseRange = Math.max(1, baseRange - 1);
  }
  if (unit.statusEffects?.some(e => e.type === 'haste')) {
    baseRange += 1;
  }

  return baseRange;
}

/**
 * Get attack range for a unit (melee = 1, ranged classes may have more)
 * Includes trait bonus (Eagle Eye: +1 range)
 * @param {Object} unit - The unit
 * @returns {number} Maximum attack distance (Manhattan distance)
 */
export function getAttackRange(unit) {
  // Base attack range (can be extended based on equipped weapon type)
  let baseRange = unit.attackRange || DEFAULT_ATTACK_RANGE;

  // Apply trait range bonus (Eagle Eye: +1 tile)
  const traitRangeBonus = traitService.getRangeBonus(unit);
  baseRange += traitRangeBonus;

  return baseRange;
}

/**
 * Get all tiles reachable within a unit's movement range
 * Wrapper around shared pathfinding module for server-side use
 * Uses 3D pathfinding when elevation data is available
 *
 * @param {Object} unit - The unit to calculate movement for
 * @param {Object} state - Battle state with terrain and units
 * @returns {Array<{x, y, cost, z?}>} Array of reachable tile positions with movement costs
 */
export function getReachableTiles(unit, state) {
  // Check if unit can move (status effects)
  if (!canUnitMove(unit)) {
    return [];
  }

  const maxCost = getMovementRange(unit);
  const mapWidth = state.mapWidth || 32;
  const mapHeight = state.mapHeight || 32;

  // Use 3D pathfinding when elevation data is available
  if (state.elevation) {
    return sharedGetReachableTiles3D(
      unit.tileX,
      unit.tileY,
      null, // startZ will be looked up from elevation grid
      maxCost,
      state.terrain,
      state.elevation,
      state.elevationConnections || null,
      state.units,
      mapWidth,
      mapHeight
    );
  }

  // Fall back to 2D pathfinding
  return sharedGetReachableTiles(
    unit.tileX,
    unit.tileY,
    maxCost,
    state.terrain,
    state.units,
    mapWidth,
    mapHeight
  );
}

/**
 * Get targets in range for attacks or skills
 * @param {Object} unit - The acting unit
 * @param {Object} state - Battle state
 * @param {number} range - Maximum range (Manhattan distance)
 * @param {string} targetType - 'enemy' or 'player' or 'ally' (same type as unit)
 * @returns {Array} Array of valid targets with positions
 */
export function getTargetsInRange(unit, state, range, targetType) {
  const targets = [];
  const actualTargetType = targetType === 'ally' ? unit.type : targetType;

  for (const other of state.units) {
    if (other.hp <= 0) continue;
    if (other.id === unit.id) continue; // Can't target self for attacks

    // Check type matching
    if (targetType === 'ally' && other.type !== unit.type) continue;
    if (targetType !== 'ally' && other.type !== actualTargetType) continue;

    const distance = getManhattanDistance(unit.tileX, unit.tileY, other.tileX, other.tileY);
    if (distance > 0 && distance <= range) {
      targets.push({
        x: other.tileX,
        y: other.tileY,
        unitId: other.id,
        unitName: other.name,
        distance
      });
    }
  }

  return targets;
}

/**
 * Find an unoccupied tile adjacent to the target for leap attacks
 * Used by movement skills like Pounce and Charge Rush
 * @param {Object} state - Battle state
 * @param {Object} unit - The leaping unit
 * @param {Object} targetTile - The target's tile {x, y}
 * @returns {Object|null} Adjacent tile {x, y} or null if none available
 */
export function findAdjacentTileToTarget(state, unit, targetTile) {
  const mapWidth = state.mapWidth || 32;
  const mapHeight = state.mapHeight || 32;

  // Cardinal directions first (most natural landing spots), then diagonals
  const directions = [
    { x: 0, y: -1 },  // Up
    { x: 0, y: 1 },   // Down
    { x: -1, y: 0 },  // Left
    { x: 1, y: 0 },   // Right
    { x: -1, y: -1 }, // Up-Left
    { x: 1, y: -1 },  // Up-Right
    { x: -1, y: 1 },  // Down-Left
    { x: 1, y: 1 }    // Down-Right
  ];

  // Sort directions to prefer tiles closer to unit's starting position
  const sortedDirs = directions.slice().sort((a, b) => {
    const distA = getManhattanDistance(
      targetTile.x + a.x, targetTile.y + a.y,
      unit.tileX, unit.tileY
    );
    const distB = getManhattanDistance(
      targetTile.x + b.x, targetTile.y + b.y,
      unit.tileX, unit.tileY
    );
    return distA - distB;
  });

  for (const dir of sortedDirs) {
    const adjX = targetTile.x + dir.x;
    const adjY = targetTile.y + dir.y;

    // Check bounds
    if (adjX < 0 || adjX >= mapWidth || adjY < 0 || adjY >= mapHeight) {
      continue;
    }

    // Check if tile is occupied by another unit
    const isOccupied = state.units.some(u =>
      u.hp > 0 && u.id !== unit.id &&
      u.tileX === adjX && u.tileY === adjY
    );
    if (isOccupied) continue;

    // Check if tile is passable (no obstacles)
    const tile = state.terrain?.find(t => t.x === adjX && t.y === adjY);
    if (tile && tile.passable === false) continue;

    // Check obstacles
    const hasObstacle = state.obstacles?.some(o =>
      o.x === adjX && o.y === adjY && o.passable === false
    );
    if (hasObstacle) continue;

    return { x: adjX, y: adjY };
  }

  // No valid adjacent tile found
  return null;
}

/**
 * Get the opposite unit type
 * @param {string} type - 'player' or 'enemy'
 * @returns {string}
 */
export function getOppositeType(type) {
  return type === 'player' ? 'enemy' : 'player';
}

/**
 * Calculate minimum movement cost to reach target tile
 * Wrapper around shared pathfinding module for server-side use
 * Uses 3D pathfinding when elevation data is available
 *
 * @param {number} startX - Starting X position
 * @param {number} startY - Starting Y position
 * @param {number} targetX - Target X position
 * @param {number} targetY - Target Y position
 * @param {Object} state - Battle state with terrain and units
 * @param {number} maxCost - Maximum movement cost (movement range)
 * @returns {number} Path cost to reach target, or Infinity if unreachable
 */
export function calculatePathCost(startX, startY, targetX, targetY, state, maxCost) {
  // If no terrain data, fall back to Manhattan distance for backwards compatibility
  if (!state.terrain) {
    return getManhattanDistance(startX, startY, targetX, targetY);
  }

  const mapWidth = state.mapWidth || 32;
  const mapHeight = state.mapHeight || 32;

  // Use 3D pathfinding when elevation data is available
  if (state.elevation) {
    return sharedCalculatePathCost3D(
      startX,
      startY,
      targetX,
      targetY,
      state.terrain,
      state.elevation,
      state.elevationConnections || null,
      state.units,
      maxCost,
      mapWidth,
      mapHeight
    );
  }

  // Fall back to 2D pathfinding
  return sharedCalculatePathCost(
    startX,
    startY,
    targetX,
    targetY,
    state.terrain,
    state.units,
    maxCost,
    mapWidth,
    mapHeight
  );
}

// Re-export getManhattanDistance for convenience
export { getManhattanDistance };
