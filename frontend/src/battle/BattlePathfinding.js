/**
 * BattlePathfinding - Movement and targeting calculations
 *
 * Uses shared pathfinding module for core algorithms to ensure server/client consistency.
 * This class provides a game-specific interface for the BattleScene.
 */
import {
  getReachableTiles,
  findPath,
  getAttackableTiles,
  getManhattanDistance
} from '@shared/pathfinding.js';

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
   * Get all tiles reachable within movement range
   * Uses shared Dijkstra's algorithm with terrain costs
   */
  getReachableTiles(startX, startY, movementRange) {
    // Convert Map to array format expected by shared module
    const unitsArray = this._getUnitsArray();

    return getReachableTiles(
      startX,
      startY,
      movementRange,
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
   * Uses shared pathfinding module
   */
  findPath(startX, startY, endX, endY) {
    // Convert Map to array format expected by shared module
    const unitsArray = this._getUnitsArray();

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

      case 'line':
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
