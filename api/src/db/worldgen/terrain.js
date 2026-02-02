/**
 * Terrain Generation
 *
 * Generates terrain obstacles and node features for the world map.
 * Used by the regional world generation system to create visual barriers
 * and populate node-specific features.
 *
 * Functions:
 * - generateObstacles: Create lakes, mountain ranges, and dense forests
 * - generateNodeFeatures: Assign features based on node type (tavern, blacksmith, etc.)
 */

import { OBSTACLE_TYPES, PALACE_FEATURES } from './constants.js';
import { CASTLE_FEATURES, CITY_OPTIONS } from '../../../../shared/constants.js';

/**
 * Generate terrain obstacles (lakes, mountain ranges, dense forests)
 * These provide visual barriers that nodes are placed around
 *
 * @param {SeededRandom} rng - Seeded random generator
 * @returns {Array<Object>} Array of obstacle objects with type, position, and dimensions
 */
export function generateObstacles(rng) {
  const obstacles = [];
  const MIN_CENTER_DISTANCE = 8;  // Keep obstacles away from castle area

  // Helper to check if obstacle overlaps with existing ones
  function overlapsExisting(x, y, radius, existingObstacles) {
    for (const obs of existingObstacles) {
      const dist = Math.hypot(x - obs.x, y - obs.y);
      const minDist = (radius || 5) + (obs.radius || obs.length / 2 || 5) + 2;
      if (dist < minDist) return true;
    }
    return false;
  }

  // Generate lakes (2-3)
  const lakeCount = rng.nextInt(2, 4);
  for (let i = 0; i < lakeCount; i++) {
    let attempts = 0;
    while (attempts < 20) {
      const x = rng.nextInt(-25, 25);
      const y = rng.nextInt(-25, 25);
      const radius = rng.nextInt(4, 7);

      if (Math.hypot(x, y) > MIN_CENTER_DISTANCE && !overlapsExisting(x, y, radius, obstacles)) {
        obstacles.push({
          obstacle_type: OBSTACLE_TYPES.LAKE,
          x, y, radius,
          length: null,
          angle: null
        });
        break;
      }
      attempts++;
    }
  }

  // Generate mountain ranges (2-4)
  const mountainCount = rng.nextInt(2, 5);
  for (let i = 0; i < mountainCount; i++) {
    let attempts = 0;
    while (attempts < 20) {
      const x = rng.nextInt(-30, 30);
      const y = rng.nextInt(-30, 30);
      const length = rng.nextInt(8, 14);
      const angle = rng.next() * Math.PI * 2;

      if (Math.hypot(x, y) > MIN_CENTER_DISTANCE && !overlapsExisting(x, y, length / 2, obstacles)) {
        obstacles.push({
          obstacle_type: OBSTACLE_TYPES.MOUNTAIN_RANGE,
          x, y,
          radius: null,
          length,
          angle
        });
        break;
      }
      attempts++;
    }
  }

  // Generate dense forests (3-5)
  const forestCount = rng.nextInt(3, 6);
  for (let i = 0; i < forestCount; i++) {
    let attempts = 0;
    while (attempts < 20) {
      const x = rng.nextInt(-25, 25);
      const y = rng.nextInt(-25, 25);
      const radius = rng.nextInt(3, 5);

      if (Math.hypot(x, y) > MIN_CENTER_DISTANCE && !overlapsExisting(x, y, radius, obstacles)) {
        obstacles.push({
          obstacle_type: OBSTACLE_TYPES.DENSE_FOREST,
          x, y, radius,
          length: null,
          angle: null
        });
        break;
      }
      attempts++;
    }
  }

  console.log(`Generated ${obstacles.length} terrain obstacles`);
  return obstacles;
}

/**
 * Generate features for a node based on its type
 *
 * Feature assignments:
 * - Castle: Full set of royal features (coliseum, tavern, blacksmith, etc.)
 * - Palace: Throne room, treasury, royal guard
 * - City: Tavern + 2 random services from CITY_OPTIONS
 * - Village: Farm + optional apothecary (50% chance)
 * - Guild: Guild hall + training ground
 * - Others: No features (battle nodes, bridges, etc.)
 *
 * @param {SeededRandom} rng - Seeded random generator
 * @param {string} nodeType - Type of the node (castle, city, village, etc.)
 * @returns {Array<string>} Array of feature names for the node
 */
export function generateNodeFeatures(rng, nodeType) {
  switch (nodeType) {
    case 'castle':
      return CASTLE_FEATURES;
    case 'palace':
      return PALACE_FEATURES;
    case 'city': {
      const shuffled = rng.shuffle(CITY_OPTIONS);
      return ['tavern', shuffled[0], shuffled[1]];
    }
    case 'village': {
      const features = ['farm'];
      if (rng.next() > 0.5) features.push('apothecary');
      return features;
    }
    case 'guild':
      return ['guild_hall', 'training_ground'];
    default:
      return [];
  }
}
