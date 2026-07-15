/**
 * Runtime obstacle contract shared by generation, validation, and rendering.
 * Keep this list aligned with ai-image-metadata/obstacles and the published
 * files under /assets/obstacles.
 */

export const OBSTACLE_ASSET_CATALOG = Object.freeze({
  rocks: Object.freeze([
    'rock_small',
    'rock_medium',
    'rock_large',
    'stalagmite',
    'mountain_boulder'
  ]),
  trees: Object.freeze([
    'oak_tree',
    'pine_tree',
    'dead_tree',
    'mushroom_large',
    'mountain_pine'
  ])
});

const TREE_DESCRIPTOR = /tree|pine|birch|mushroom|palisade|timber|wood/i;

export function getObstacleAssetCategory(obstacleType, category) {
  if (category === 'rocks' || category === 'trees') return category;
  const descriptor = `${category || ''} ${obstacleType || ''}`;
  return TREE_DESCRIPTOR.test(descriptor) ? 'trees' : 'rocks';
}

export function getObstacleVariants(category, requested = []) {
  const normalizedCategory = getObstacleAssetCategory('', category);
  const available = OBSTACLE_ASSET_CATALOG[normalizedCategory] || OBSTACLE_ASSET_CATALOG.rocks;
  const requestedList = Array.isArray(requested) ? requested : [requested];
  const validRequested = requestedList.filter(variant => available.includes(variant));
  return validRequested.length > 0 ? validRequested : available;
}

export function getObstacleTerrain(category) {
  return getObstacleAssetCategory('', category) === 'trees' ? 'tree' : 'rock';
}

export function isBlockingObstacle(obstacle) {
  if (!obstacle || obstacle.passable === true) return false;
  if (obstacle.passable === false) return true;
  return obstacle.type === 'trees' || obstacle.type === 'rocks';
}

export default {
  OBSTACLE_ASSET_CATALOG,
  getObstacleAssetCategory,
  getObstacleVariants,
  getObstacleTerrain,
  isBlockingObstacle
};
