/**
 * AoE Service - Area of Effect calculations
 */

/**
 * Get all tiles affected by an AoE skill
 * @param {number} targetX - Center tile X
 * @param {number} targetY - Center tile Y
 * @param {number} radius - AoE radius (Manhattan distance)
 * @param {string} pattern - AoE pattern: 'circle', 'cross', 'line'
 * @param {number} direction - Direction for directional patterns (0-7)
 * @returns {Array} Array of { x, y, isCenter } objects
 */
export function getAoETiles(targetX, targetY, radius = 1, pattern = 'circle', direction = 0) {
  const tiles = [];

  switch (pattern) {
    case 'cross':
      // Center + 4 cardinal directions
      tiles.push({ x: targetX, y: targetY, isCenter: true });
      for (let i = 1; i <= radius; i++) {
        // North, South, East, West
        tiles.push({ x: targetX, y: targetY - i, isCenter: false });
        tiles.push({ x: targetX, y: targetY + i, isCenter: false });
        tiles.push({ x: targetX - i, y: targetY, isCenter: false });
        tiles.push({ x: targetX + i, y: targetY, isCenter: false });
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
        tiles.push({ x, y, isCenter: i === 0 });
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
            tiles.push({
              x: targetX + dx,
              y: targetY + dy,
              isCenter: dx === 0 && dy === 0
            });
          }
        }
      }
      break;
  }

  return tiles;
}

/**
 * Get all units in the AoE area from a list of units
 * @param {Array} units - Array of all units in battle
 * @param {number} targetX - Center tile X
 * @param {number} targetY - Center tile Y
 * @param {number} radius - AoE radius
 * @param {string} pattern - AoE pattern
 * @returns {Array} Array of { unit, isCenter } for units in the AoE
 */
export function getUnitsInAoE(units, targetX, targetY, radius = 1, pattern = 'circle') {
  const aoeTiles = getAoETiles(targetX, targetY, radius, pattern);
  const affectedUnits = [];

  for (const tile of aoeTiles) {
    const unit = units.find(u => u.tileX === tile.x && u.tileY === tile.y && u.hp > 0);
    if (unit) {
      affectedUnits.push({
        unit,
        isCenter: tile.isCenter
      });
    }
  }

  return affectedUnits;
}
