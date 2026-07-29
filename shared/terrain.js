// Compatibility facade. The frozen V1 generator imports its private copy,
// while runtime traversal also accepts V2 semantic terrain-cell records.
import {
  getTerrainMovementCost as getTerrainMovementCostV1,
  isImpassable as isImpassableV1
} from './mapgen/v1/terrain.js';

export * from './mapgen/v1/terrain.js';

export function isImpassable(terrain) {
  if (terrain && typeof terrain === 'object' && !Array.isArray(terrain)) {
    if (terrain.passable === false) return true;
    if (terrain.passable === true) return false;
    return isImpassableV1(terrain.material);
  }
  return isImpassableV1(terrain);
}

export function getTerrainMovementCost(terrain) {
  if (terrain && typeof terrain === 'object' && !Array.isArray(terrain)) {
    if (terrain.passable === false) return Infinity;
    if (Number.isFinite(terrain.movementCost) && terrain.movementCost >= 0) {
      return terrain.movementCost;
    }
    return getTerrainMovementCostV1(terrain.material);
  }
  return getTerrainMovementCostV1(terrain);
}
