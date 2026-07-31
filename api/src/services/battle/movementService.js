/**
 * Movement Service - Pathfinding, movement ranges, and targeting
 */

import { CLASS_MOVEMENT } from '../../config/constants.js';
import * as traitService from '../traitService.js';
import {
  createTraversalView,
  getReachableTilesForTraversal,
  calculateTraversalPathCost,
  canEnterTile,
  getManhattanDistance,
  isTraversalCellPlayable
} from '../../../../shared/pathfinding.js';
import { createTraversalObstacleGrid } from '../../../../shared/traversal.js';
import {
  discretizeElevation,
  normalizeElevationGrid
} from '../../../../shared/terrain.js';
import { isBlockingObstacle } from '../../../../shared/obstacles.js';
import { canUnitMove } from './statusEffectManager.js';

// Default attack range for melee (1 tile adjacent)
const DEFAULT_ATTACK_RANGE = 1;

function getPathfindingElevation(state) {
  return normalizeElevationGrid(state.elevation, state.elevationFormat || 'auto');
}

function getMapDimensions(state) {
  const terrainWidth = Array.isArray(state.terrain?.[0])
    ? state.terrain[0].length
    : null;
  const terrainHeight = Array.isArray(state.terrain) &&
    Array.isArray(state.terrain[0])
    ? state.terrain.length
    : null;

  return {
    width: Number.isInteger(state.mapWidth) && state.mapWidth > 0
      ? state.mapWidth
      : terrainWidth || 32,
    height: Number.isInteger(state.mapHeight) && state.mapHeight > 0
      ? state.mapHeight
      : terrainHeight || 32
  };
}

function toRowMajorLayer(layer, width, height, {
  emptyValue = null,
  mapValue = value => value,
  optional = false
} = {}) {
  if (optional && (!Array.isArray(layer) || layer.length === 0)) return null;

  const grid = Array.from(
    { length: height },
    () => Array(width).fill(emptyValue)
  );

  if (!Array.isArray(layer)) return grid;

  if (layer.some(Array.isArray)) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        grid[y][x] = mapValue(layer[y]?.[x] ?? emptyValue);
      }
    }
    return grid;
  }

  for (const entry of layer) {
    const x = entry?.x ?? entry?.tileX ?? entry?.gridX;
    const y = entry?.y ?? entry?.tileY ?? entry?.gridY;
    if (Number.isInteger(x) && Number.isInteger(y) &&
        x >= 0 && y >= 0 && x < width && y < height) {
      grid[y][x] = mapValue(entry);
    }
  }
  return grid;
}

function normalizeTerrainCell(cell) {
  if (typeof cell === 'string') return cell;
  if (!cell || typeof cell !== 'object') return 'grass';
  if (cell.passable === false) return 'rock';
  return cell.material ?? cell.terrain ?? cell.type ?? 'grass';
}

function normalizeObstacleCell(cell) {
  if (!cell || typeof cell !== 'object') return cell;
  if (typeof cell.blocking !== 'boolean') return cell;
  return {
    ...cell,
    type: cell.type ?? cell.kind,
    passable: !cell.blocking
  };
}

function getDirection(from, to) {
  if (to.x === from.x && to.y === from.y - 1) return 'n';
  if (to.x === from.x + 1 && to.y === from.y) return 'e';
  if (to.x === from.x && to.y === from.y + 1) return 's';
  if (to.x === from.x - 1 && to.y === from.y) return 'w';
  return null;
}

function reverseDirection(direction) {
  return { n: 's', e: 'w', s: 'n', w: 'e' }[direction] ?? null;
}

function toConnectionGrid(layer, width, height, elevation) {
  if (!Array.isArray(layer) || layer.length === 0) return null;
  if (layer.some(Array.isArray)) {
    return toRowMajorLayer(layer, width, height, { optional: true });
  }

  const grid = Array.from({ length: height }, () => Array(width).fill(null));
  for (const record of layer) {
    if (!record?.from || !record?.to) continue;
    if (![record.from.x, record.from.y, record.to.x, record.to.y]
      .every(Number.isInteger) ||
        record.from.x < 0 || record.from.x >= width ||
        record.from.y < 0 || record.from.y >= height ||
        record.to.x < 0 || record.to.x >= width ||
        record.to.y < 0 || record.to.y >= height) {
      continue;
    }
    const direction = record.direction ?? getDirection(record.from, record.to);
    if (!direction) continue;

    const fromElevation = discretizeElevation(
      elevation?.[record.from.y]?.[record.from.x] ?? 0
    );
    const toElevation = discretizeElevation(
      elevation?.[record.to.y]?.[record.to.x] ?? 0
    );
    const connection = {
      ...record,
      type: record.type ?? record.kind,
      levels: record.levels ?? Math.max(1, Math.abs(toElevation - fromElevation))
    };
    grid[record.from.y][record.from.x] ||= {};
    grid[record.from.y][record.from.x][direction] = connection;

    if (record.bidirectional || record.traversable === false) {
      const reverse = reverseDirection(direction);
      grid[record.to.y][record.to.x] ||= {};
      grid[record.to.y][record.to.x][reverse] = {
        ...connection,
        elevationDelta: Number.isFinite(record.elevationDelta)
          ? -record.elevationDelta
          : record.elevationDelta
      };
    }
  }
  return grid;
}

function adaptMovementPolicy(
  movementPolicy,
  terrainRecords,
  obstacleRecords
) {
  const {
    canTraverseTerrain,
    canTraverseObstacle,
    getStepCost,
    ...basePolicy
  } = movementPolicy;

  return {
    ...basePolicy,
    canTraverseTerrain(context) {
      const record = terrainRecords[context.to.y][context.to.x];
      const authoritativeCost = Number.isFinite(record?.movementCost)
        ? record.movementCost
        : context.terrainCost;
      const fallback = record && typeof record === 'object'
        ? record.passable !== false && Number.isFinite(authoritativeCost)
        : Number.isFinite(context.terrainCost);
      if (!canTraverseTerrain) return fallback;
      return canTraverseTerrain({
        ...context,
        terrain: record,
        terrainCost: authoritativeCost
      }) ?? fallback;
    },
    canTraverseObstacle(context) {
      const record = obstacleRecords?.[context.to.y]?.[context.to.x] ?? null;
      const fallback = record?.blocking === true
        ? false
        : !isBlockingObstacle(record);
      if (!canTraverseObstacle) return fallback;
      return canTraverseObstacle({ ...context, obstacle: record }) ?? fallback;
    },
    getStepCost(context) {
      const terrain = terrainRecords[context.to.y][context.to.x];
      const obstacle = obstacleRecords?.[context.to.y]?.[context.to.x] ?? null;
      const terrainCost = Number.isFinite(terrain?.movementCost)
        ? terrain.movementCost
        : context.terrainCost;
      const obstacleCost = obstacle && obstacle.blocking !== true &&
        Number.isFinite(obstacle.movementCost)
        ? obstacle.movementCost
        : 0;
      const defaultCost = terrainCost + context.elevationCost + obstacleCost;
      if (!getStepCost) return defaultCost;
      return getStepCost({
        ...context,
        terrain,
        terrainCost,
        obstacle,
        obstacleCost,
        defaultCost
      }) ?? defaultCost;
    }
  };
}

/**
 * Adapt a battle state to the authoritative runtime traversal contract.
 * Coordinate-list layers remain accepted for legacy saves and test fixtures.
 */
export function createBattleTraversalView(state, movementPolicy = {}) {
  const dimensions = getMapDimensions(state);
  const { width, height } = dimensions;
  const pathfindingElevation = getPathfindingElevation(state);
  const terrainRecords = toRowMajorLayer(state.terrain, width, height, {
    emptyValue: 'grass'
  });
  const obstacleRecords = Array.isArray(state.obstacles)
    ? createTraversalObstacleGrid(state.obstacles, dimensions)
    : null;

  return createTraversalView({
    terrain: terrainRecords.map(row => row.map(normalizeTerrainCell)),
    obstacles: obstacleRecords?.map(row => row.map(normalizeObstacleCell)) ?? null,
    elevation: toRowMajorLayer(pathfindingElevation, width, height, {
      emptyValue: 0,
      optional: true
    }),
    elevationConnections: toConnectionGrid(
      state.elevationConnections,
      width,
      height,
      pathfindingElevation
    ),
    playableMask: state.playableMask ?? null,
    units: Array.isArray(state.units) ? state.units : [],
    dimensions,
    movementPolicy: adaptMovementPolicy(
      movementPolicy,
      terrainRecords,
      obstacleRecords
    )
  });
}

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
 * unit.attackRange is the materialized effective base range, including traits.
 * @param {Object} unit - The unit
 * @returns {number} Maximum attack distance (Manhattan distance)
 */
export function getAttackRange(unit) {
  // Effective base range is materialized when the battle unit is created.
  let baseRange = unit.attackRange || DEFAULT_ATTACK_RANGE;

  // Celestial Arrow is consumed only by a valid basic attack action.
  baseRange += Number.isFinite(unit.nextAttackRangeBonus)
    ? unit.nextAttackRangeBonus
    : 0;

  return baseRange;
}

/**
 * Whether a unit is immune to push, pull, and other forced movement.
 * No forced-movement executor exists yet; callers can use this guard when one
 * is introduced without conflating it with voluntary movement.
 */
export function isForcedMovementImmune(unit) {
  return unit?.statusEffects?.some(effect => effect.type === 'unmovable') ||
    false;
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
  const traversalView = createBattleTraversalView(state);
  return getReachableTilesForTraversal(traversalView, {
    start: { x: unit.tileX, y: unit.tileY },
    range: maxCost
  });
}

/**
 * Get targets in range for attacks or skills
 * Uses team-based targeting for PvP compatibility
 * @param {Object} unit - The acting unit
 * @param {Object} state - Battle state
 * @param {number} range - Maximum range (Manhattan distance)
 * @param {string} targetType - 'enemy' or 'player' or 'ally' (same team as unit) or 'opponent' (different team)
 * @returns {Array} Array of valid targets with positions
 */
export function getTargetsInRange(unit, state, range, targetType) {
  const targets = [];
  const unitTeamId = getUnitTeamId(unit);
  const hasPlayableMask = Array.isArray(state.playableMask) &&
    state.playableMask.length > 0;

  for (const other of state.units) {
    if (other.hp <= 0) continue;
    if (other.id === unit.id) continue; // Can't target self for attacks
    if (hasPlayableMask &&
        state.playableMask?.[other.tileY]?.[other.tileX] !== true) {
      continue;
    }

    const otherTeamId = getUnitTeamId(other);

    // Team-based targeting logic
    if (targetType === 'ally') {
      // Ally targeting: same team
      if (otherTeamId !== unitTeamId) continue;
    } else if (targetType === 'opponent' || targetType === 'enemy') {
      // Opponent/enemy targeting: different team
      // 'enemy' is kept for backwards compatibility but uses team-based logic
      if (otherTeamId === unitTeamId) continue;
    } else if (targetType === 'player') {
      // Legacy type-based targeting (for backwards compatibility with old code)
      // In new code, prefer 'opponent' or 'ally'
      if (other.type !== 'player') continue;
    }

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
  const traversalView = createBattleTraversalView(state, {
    // Leap/charge landing validates the destination surface independently of
    // the elevation crossed by the special movement.
    canTraverseElevation: () => true
  });

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

    const landing = { x: adjX, y: adjY };
    if (!isTraversalCellPlayable(traversalView, landing)) {
      continue;
    }

    // canEnterTile is cardinal-step based. Use an adjacent probe solely to
    // evaluate the landing cell; the policy above intentionally ignores the
    // leap's elevation delta while retaining terrain, obstacle, and occupancy.
    const probes = [
      { x: adjX - 1, y: adjY },
      { x: adjX + 1, y: adjY },
      { x: adjX, y: adjY - 1 },
      { x: adjX, y: adjY + 1 }
    ].filter(point => isTraversalCellPlayable(traversalView, point));
    if (!probes.some(probe => canEnterTile(
      traversalView,
      probe,
      landing,
      { start: { x: unit.tileX, y: unit.tileY } }
    ))) continue;

    return { x: adjX, y: adjY };
  }

  // No valid adjacent tile found
  return null;
}

/**
 * Get the opposite unit type
 * @deprecated Use getOpposingUnits() or getAlliedUnits() for team-based logic
 * @param {string} type - 'player' or 'enemy'
 * @returns {string}
 */
export function getOppositeType(type) {
  return type === 'player' ? 'enemy' : 'player';
}

/**
 * Get a unit's team ID with fallback for backwards compatibility
 * @param {Object} unit - BattleUnit
 * @returns {number} Team ID (1 or 2)
 */
function getUnitTeamId(unit) {
  if (unit.teamId !== undefined) {
    return unit.teamId;
  }
  // Fallback: type 'enemy' implies team 2, all others imply team 1
  return unit.type === 'enemy' ? 2 : 1;
}

/**
 * Get all alive units on the opposing team
 * @param {Object} unit - The reference unit
 * @param {Object} state - Battle state containing units array
 * @returns {Array} Array of opposing units that are alive
 */
export function getOpposingUnits(unit, state) {
  const unitTeamId = getUnitTeamId(unit);
  return state.units.filter(u => u.hp > 0 && getUnitTeamId(u) !== unitTeamId);
}

/**
 * Get all alive units on the same team (including self)
 * @param {Object} unit - The reference unit
 * @param {Object} state - Battle state containing units array
 * @returns {Array} Array of allied units that are alive
 */
export function getAlliedUnits(unit, state) {
  const unitTeamId = getUnitTeamId(unit);
  return state.units.filter(u => u.hp > 0 && getUnitTeamId(u) === unitTeamId);
}

/**
 * Check if two units are on opposing teams
 * @param {Object} unitA - First unit
 * @param {Object} unitB - Second unit
 * @returns {boolean} True if units are opponents
 */
export function areOpponents(unitA, unitB) {
  return getUnitTeamId(unitA) !== getUnitTeamId(unitB);
}

/**
 * Check if two units are on the same team
 * @param {Object} unitA - First unit
 * @param {Object} unitB - Second unit
 * @returns {boolean} True if units are allies
 */
export function areAllies(unitA, unitB) {
  return getUnitTeamId(unitA) === getUnitTeamId(unitB);
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
  return calculateTraversalPathCost(createBattleTraversalView(state), {
    start: { x: startX, y: startY },
    goal: { x: targetX, y: targetY },
    maxCost
  });
}

// Re-export getManhattanDistance for convenience
export { getManhattanDistance };
