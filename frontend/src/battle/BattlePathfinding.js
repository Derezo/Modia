/**
 * BattlePathfinding - Movement and targeting calculations
 *
 * Uses shared pathfinding module for core algorithms to ensure server/client consistency.
 * This class provides a game-specific interface for the BattleScene.
 *
 * IMPORTANT: Movement calculations must match server-side logic exactly to prevent
 * desync where client highlights tiles that server rejects. Key factors:
 * - Status effect modifiers (slow, haste, root)
 * - Terrain movement costs
 * - Elevation traversal rules
 * - Unit collision
 */
import {
  getReachableTiles,
  getReachableTiles3D,
  findPath,
  findPath3D,
  getAttackableTiles,
  getManhattanDistance
} from '@shared/pathfinding.js';
import { PREVENT_MOVEMENT } from '@shared/battleMath.js';

export class BattlePathfinding {
  constructor(grid, units) {
    this.grid = grid;
    this.units = units;
  }

  /**
   * Update units reference
   */
  setUnits(units) {
    this.units = units;
  }

  /**
   * Apply status effect modifiers to movement range
   * MUST match server-side status effect handling to prevent desync
   *
   * @param {number} baseRange - Base movement range from unit stats
   * @param {Object} unit - Unit object with statusEffects array
   * @returns {number} Modified movement range
   */
  applyMovementModifiers(baseRange, unit) {
    if (!unit || !unit.statusEffects) return baseRange;

    let range = baseRange;
    const effects = unit.statusEffects;

    // Check for effects by type, name, or id (server uses e.type)
    const hasEffect = (name) => effects.some(e =>
      (typeof e === 'string' && e.toLowerCase() === name) ||
      (e?.type?.toLowerCase() === name) ||
      (e?.name?.toLowerCase() === name) ||
      (e?.id?.toLowerCase() === name)
    );

    // Movement-preventing effects (shared with server via PREVENT_MOVEMENT constant)
    if (effects.some(e => {
      const type = typeof e === 'string' ? e.toLowerCase() : (e?.type?.toLowerCase() ?? '');
      return PREVENT_MOVEMENT.includes(type);
    })) {
      return 0;
    }

    // Slow reduces movement by 1 (minimum 1) - matches server flat modifier
    if (hasEffect('slow')) {
      range = Math.max(1, range - 1);
    }

    // Haste increases movement by 1 - matches server flat modifier
    if (hasEffect('haste')) {
      range += 1;
    }

    return Math.max(0, range);
  }

  /**
   * Get all tiles reachable within movement range
   * Applies status effect modifiers for consistent client/server behavior
   * Uses 3D pathfinding when elevation data is available
   *
   * @param {number} startX - Starting grid X position
   * @param {number} startY - Starting grid Y position
   * @param {number} movementRange - Base movement range
   * @param {Object} unit - Optional unit object for status effect modifiers
   * @returns {Array} Array of { x, y, cost, z? } reachable tiles
   */
  getReachableTiles(startX, startY, movementRange, unit = null) {
    // Apply status effect modifiers if unit provided
    const effectiveRange = unit
      ? this.applyMovementModifiers(movementRange, unit)
      : movementRange;

    // If rooted or range is 0, no tiles are reachable
    if (effectiveRange <= 0) {
      return [];
    }

    // Convert Map to array format expected by shared module
    const unitsArray = this._getUnitsArray();

    // Use 3D pathfinding when elevation data is available
    if (this.grid.elevation && this.grid.elevation.length > 0) {
      return getReachableTiles3D(
        startX,
        startY,
        null, // startZ will be looked up from elevation grid
        effectiveRange,
        this.grid.terrain,
        this.grid.elevation,
        this.grid.elevationConnections || null,
        unitsArray,
        this.grid.width,
        this.grid.height
      );
    }

    // Fall back to 2D pathfinding
    return getReachableTiles(
      startX,
      startY,
      effectiveRange,
      this.grid.terrain,
      unitsArray,
      this.grid.width,
      this.grid.height
    );
  }

  /**
   * Get tiles within attack range (Manhattan distance)
   * Uses shared pathfinding module
   */
  getAttackableTiles(startX, startY, attackRange) {
    return getAttackableTiles(
      startX,
      startY,
      attackRange,
      this.grid.width,
      this.grid.height
    );
  }

  /**
   * Get enemy units within attack range
   */
  getTargetsInRange(startX, startY, attackRange, targetType = 'enemy') {
    const targets = [];
    const attackableTiles = this.getAttackableTiles(startX, startY, attackRange);

    for (const tile of attackableTiles) {
      const unit = this.getUnitAt(tile.x, tile.y);
      if (unit && unit.type === targetType && unit.isAlive()) {
        targets.push({ unit, distance: tile.distance });
      }
    }

    return targets;
  }

  /**
   * Check if a tile is a valid move destination
   */
  isValidMove(x, y, excludeX = null, excludeY = null) {
    // Check bounds
    if (!this.grid.isInBounds(x, y)) return false;

    // Check terrain
    if (!this.grid.isWalkable(x, y)) return false;

    // Check for other units (excluding source position)
    const occupant = this.getUnitAt(x, y);
    if (occupant && !(x === excludeX && y === excludeY)) {
      return false;
    }

    return true;
  }

  /**
   * Get unit at position
   */
  getUnitAt(x, y) {
    for (const unit of this.units.values()) {
      if (unit.gridX === x && unit.gridY === y && unit.isAlive()) {
        return unit;
      }
    }
    return null;
  }

  /**
   * Check if there's a clear line of sight (for ranged attacks)
   */
  hasLineOfSight(startX, startY, endX, endY) {
    // Use Bresenham's line algorithm
    const dx = Math.abs(endX - startX);
    const dy = Math.abs(endY - startY);
    const sx = startX < endX ? 1 : -1;
    const sy = startY < endY ? 1 : -1;
    let err = dx - dy;

    let x = startX;
    let y = startY;

    while (x !== endX || y !== endY) {
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }

      // Skip start and end positions
      if ((x === startX && y === startY) || (x === endX && y === endY)) continue;

      // Check for blocking terrain
      if (this.grid.isImpassable(this.grid.getTerrain(x, y))) {
        return false;
      }
    }

    return true;
  }

  /**
   * Find path between two points using A*
   * Uses 3D pathfinding when elevation data is available
   *
   * @param {number} startX - Starting X position
   * @param {number} startY - Starting Y position
   * @param {number} endX - Destination X position
   * @param {number} endY - Destination Y position
   * @returns {Array|null} Array of { x, y, z? } waypoints, or null if no path
   */
  findPath(startX, startY, endX, endY) {
    // Convert Map to array format expected by shared module
    const unitsArray = this._getUnitsArray();

    // Use 3D pathfinding when elevation data is available
    if (this.grid.elevation && this.grid.elevation.length > 0) {
      return findPath3D(
        startX,
        startY,
        endX,
        endY,
        this.grid.terrain,
        this.grid.elevation,
        this.grid.elevationConnections || null,
        unitsArray,
        this.grid.width,
        this.grid.height
      );
    }

    // Fall back to 2D pathfinding
    return findPath(
      startX,
      startY,
      endX,
      endY,
      this.grid.terrain,
      unitsArray,
      this.grid.width,
      this.grid.height
    );
  }

  /**
   * Get the Manhattan distance between two points
   * Uses shared pathfinding module
   */
  getDistance(x1, y1, x2, y2) {
    return getManhattanDistance(x1, y1, x2, y2);
  }

  /**
   * Find closest enemy to a position
   */
  findClosestEnemy(x, y, fromType = 'player') {
    const targetType = fromType === 'player' ? 'enemy' : 'player';
    let closest = null;
    let closestDist = Infinity;

    for (const unit of this.units.values()) {
      if (unit.type !== targetType || !unit.isAlive()) continue;

      const dist = this.getDistance(x, y, unit.gridX, unit.gridY);
      if (dist < closestDist) {
        closestDist = dist;
        closest = unit;
      }
    }

    return closest;
  }

  /**
   * Find weakest enemy (lowest HP)
   */
  findWeakestEnemy(fromType = 'player') {
    const targetType = fromType === 'player' ? 'enemy' : 'player';
    let weakest = null;
    let lowestHP = Infinity;

    for (const unit of this.units.values()) {
      if (unit.type !== targetType || !unit.isAlive()) continue;

      if (unit.hp < lowestHP) {
        lowestHP = unit.hp;
        weakest = unit;
      }
    }

    return weakest;
  }

  /**
   * Get tiles affected by an AoE skill
   * @param {number} targetX - Center tile X
   * @param {number} targetY - Center tile Y
   * @param {number} radius - AoE radius (Manhattan distance)
   * @param {string} pattern - AoE pattern: 'circle', 'cross', 'line', 'cone'
   * @param {number} direction - Direction for directional patterns (0-7)
   * @returns {Array} Array of { x, y, isCenter } objects
   */
  getAoETiles(targetX, targetY, radius = 1, pattern = 'circle', direction = 0) {
    const tiles = [];

    switch (pattern) {
      case 'cross':
        // Center + 4 cardinal directions
        tiles.push({ x: targetX, y: targetY, isCenter: true });
        for (let i = 1; i <= radius; i++) {
          // North, South, East, West
          if (this.grid.isInBounds(targetX, targetY - i)) {
            tiles.push({ x: targetX, y: targetY - i, isCenter: false });
          }
          if (this.grid.isInBounds(targetX, targetY + i)) {
            tiles.push({ x: targetX, y: targetY + i, isCenter: false });
          }
          if (this.grid.isInBounds(targetX - i, targetY)) {
            tiles.push({ x: targetX - i, y: targetY, isCenter: false });
          }
          if (this.grid.isInBounds(targetX + i, targetY)) {
            tiles.push({ x: targetX + i, y: targetY, isCenter: false });
          }
        }
        break;

      case 'line': {
        // Line in specified direction
        const dirOffsets = [
          { dx: 0, dy: -1 },  // N
          { dx: 1, dy: -1 },  // NE
          { dx: 1, dy: 0 },   // E
          { dx: 1, dy: 1 },   // SE
          { dx: 0, dy: 1 },   // S
          { dx: -1, dy: 1 },  // SW
          { dx: -1, dy: 0 },  // W
          { dx: -1, dy: -1 }  // NW
        ];
        const offset = dirOffsets[direction % 8];
        for (let i = 0; i <= radius; i++) {
          const x = targetX + offset.dx * i;
          const y = targetY + offset.dy * i;
          if (this.grid.isInBounds(x, y)) {
            tiles.push({ x, y, isCenter: i === 0 });
          }
        }
        break;
      }

      case 'circle':
      default:
        // All tiles within Manhattan distance
        for (let dx = -radius; dx <= radius; dx++) {
          for (let dy = -radius; dy <= radius; dy++) {
            const distance = Math.abs(dx) + Math.abs(dy);
            if (distance <= radius) {
              const x = targetX + dx;
              const y = targetY + dy;
              if (this.grid.isInBounds(x, y)) {
                tiles.push({
                  x,
                  y,
                  isCenter: dx === 0 && dy === 0
                });
              }
            }
          }
        }
        break;
    }

    return tiles;
  }

  /**
   * Get all units affected by an AoE at the given position
   * @param {number} targetX - Center tile X
   * @param {number} targetY - Center tile Y
   * @param {number} radius - AoE radius
   * @param {string} pattern - AoE pattern
   * @returns {Array} Array of units in the AoE area
   */
  getUnitsInAoE(targetX, targetY, radius = 1, pattern = 'circle') {
    const aoeTiles = this.getAoETiles(targetX, targetY, radius, pattern);
    const affectedUnits = [];

    for (const tile of aoeTiles) {
      const unit = this.getUnitAt(tile.x, tile.y);
      if (unit && unit.isAlive()) {
        affectedUnits.push({
          unit,
          isCenter: tile.isCenter
        });
      }
    }

    return affectedUnits;
  }

  /**
   * Convert units Map to array format for shared pathfinding module
   * @private
   */
  _getUnitsArray() {
    const unitsArray = [];
    for (const unit of this.units.values()) {
      if (unit.isAlive()) {
        unitsArray.push({
          gridX: unit.gridX,
          gridY: unit.gridY,
          hp: unit.hp
        });
      }
    }
    return unitsArray;
  }
}
