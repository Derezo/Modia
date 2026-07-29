import {
  V2_QUANTIZATION_SCALE,
  coordinateHash32,
  deriveStreamSeed,
  stableLexicographicCompare
} from './Determinism.js';
import { deepFreeze } from './V2Context.js';
import { canEnterTile, createTraversalView } from '../../traversal.js';

const SCALE = V2_QUANTIZATION_SCALE;
export const ECOLOGY_PLACEMENT_VERSION = 'ecology-placement-v1';
export const ECOLOGY_CATALOG_VERSION = 'battle-map-v2-ecology-catalog-v1';

const BLOCKER_CATALOG = {
  tree: {
    obstacleKind: 'tree',
    allowedMaterials: ['dirt', 'forest', 'grass'],
    structureKind: null
  },
  rock: {
    obstacleKind: 'rock',
    allowedMaterials: ['dirt', 'forest', 'grass', 'rock', 'stone'],
    structureKind: null
  },
  pillar: {
    obstacleKind: 'rock',
    allowedMaterials: ['dirt', 'grass', 'rock', 'stone'],
    structureKind: 'pillar'
  },
  barricade: {
    obstacleKind: 'rock',
    allowedMaterials: ['dirt', 'grass', 'rock', 'stone'],
    structureKind: 'barricade'
  }
};

const DECORATION_CATALOG = {
  'ground-cover': { mode: 'ground-cover' },
  'leaf-litter': { mode: 'leaf-litter' },
  mushroom: { mode: 'moist' },
  crystal: { mode: 'rough' },
  talus: { mode: 'rough' },
  scrub: { mode: 'dry' },
  reeds: { mode: 'waterside' },
  debris: { mode: 'disturbed' },
  rubble: { mode: 'rough-disturbed' },
  moss: { mode: 'moist' },
  ash: { mode: 'dry-disturbed' }
};

function profile(blockers, decorationFamilies) {
  return { blockers, decorationFamilies };
}

/*
 * Profiles are deliberately closed by node type. A newly registered recipe
 * must declare its ecology semantics here instead of silently inheriting a
 * biome/family default.
 */
const PROFILES = {
  forest: profile([
    { family: 'tree', regionKinds: ['grove'], suitability: 'tree' },
    { family: 'rock', regionKinds: ['outcrop'], suitability: 'rock' }
  ], ['ground-cover', 'leaf-litter']),
  cave: profile([
    { family: 'rock', regionKinds: ['cave-solid', 'broken-floor'], suitability: 'cave-rock' }
  ], ['mushroom', 'crystal']),
  mountain: profile([
    { family: 'rock', regionKinds: ['ridge', 'talus'], suitability: 'rock' }
  ], ['talus', 'scrub']),
  bridge: profile([
    { family: 'pillar', regionKinds: ['embankment', 'worn-approach'], suitability: 'constructed' }
  ], ['reeds', 'debris']),
  castle: profile([
    { family: 'pillar', regionKinds: ['courtyard', 'weathered-court', 'overgrown-edge'], suitability: 'constructed' }
  ], ['rubble', 'moss']),
  dungeon: profile([
    { family: 'pillar', regionKinds: ['dungeon-floor', 'broken-masonry', 'earthen-seam'], suitability: 'constructed' }
  ], ['rubble', 'moss']),
  swamp: profile([
    {
      family: 'tree',
      regionKinds: ['wet-meadow', 'swamp-grove'],
      suitability: 'tree'
    },
    {
      family: 'rock',
      regionKinds: ['marsh', 'hummock'],
      suitability: 'rock'
    }
  ], ['reeds', 'ground-cover']),
  volcano: profile([
    { family: 'rock', regionKinds: ['volcanic-ridge', 'basalt-face'], suitability: 'rock' }
  ], ['ash', 'talus']),
  plains: profile([
    { family: 'tree', regionKinds: ['scrub'], suitability: 'tree' },
    { family: 'rock', regionKinds: ['rocky-rise'], suitability: 'rock' }
  ], ['ground-cover']),
  arena: profile([
    { family: 'pillar', regionKinds: ['arena-edge'], suitability: 'constructed' }
  ], ['rubble']),
  guild: profile([
    { family: 'barricade', regionKinds: ['training-verge'], suitability: 'constructed' }
  ], ['rubble', 'moss']),
  elven_grove: profile([
    { family: 'tree', regionKinds: ['ancient-grove'], suitability: 'tree' },
    { family: 'rock', regionKinds: ['mossy-outcrop'], suitability: 'rock' }
  ], ['ground-cover', 'leaf-litter']),
  dwarven_mine: profile([
    { family: 'rock', regionKinds: ['mine-solid', 'ore-face'], suitability: 'cave-rock' }
  ], ['crystal', 'rubble']),
  vampiric_crypt: profile([
    { family: 'pillar', regionKinds: ['crypt-floor', 'collapsed-crypt', 'damp-crypt'], suitability: 'constructed' }
  ], ['rubble', 'moss']),
  orcish_warcamp: profile([
    { family: 'barricade', regionKinds: ['camp-ground', 'defensive-rise'], suitability: 'constructed' }
  ], ['ash', 'debris']),
  human_ruins: profile([
    { family: 'pillar', regionKinds: ['ruined-court', 'rubble-field'], suitability: 'constructed' }
  ], ['rubble', 'moss'])
};

export const ECOLOGY_RUNTIME_CATALOG = deepFreeze({
  catalogVersion: ECOLOGY_CATALOG_VERSION,
  blockers: BLOCKER_CATALOG,
  decorations: DECORATION_CATALOG,
  profiles: PROFILES
});

function createGrid(width, height, value = false) {
  return Array.from({ length: height }, () => Array(width).fill(value));
}

function assertGrid(grid, name, width, height, predicate) {
  if (!Array.isArray(grid) || grid.length !== height) {
    throw new TypeError(`${name} must contain exactly ${height} rows`);
  }
  grid.forEach((row, y) => {
    if (!Array.isArray(row) || row.length !== width) {
      throw new TypeError(`${name}[${y}] must contain exactly ${width} cells`);
    }
    row.forEach((value, x) => {
      if (!predicate(value)) throw new TypeError(`${name}[${y}][${x}] is invalid`);
    });
  });
}

function optionalBooleanMask(mask, name, width, height) {
  if (mask === undefined || mask === null) return createGrid(width, height);
  assertGrid(mask, name, width, height, value => typeof value === 'boolean');
  return mask;
}

function fixedRatio(numerator, denominator) {
  return denominator === 0 ? 0 : Math.floor(numerator * SCALE / denominator);
}

function clamp(value, minimum = 0, maximum = SCALE) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizedSigned(value) {
  return Math.floor((clamp(value, -SCALE, SCALE) + SCALE) / 2);
}

function distanceField(mask) {
  const height = mask.length;
  const width = mask[0]?.length ?? 0;
  const unreachable = width + height + 1;
  const result = createGrid(width, height, unreachable);
  const queue = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y][x]) continue;
      result[y][x] = 0;
      queue.push({ x, y });
    }
  }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    const nextDistance = result[current.y][current.x] + 1;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const x = current.x + dx;
      const y = current.y + dy;
      if (x < 0 || x >= width || y < 0 || y >= height ||
          result[y][x] <= nextDistance) continue;
      result[y][x] = nextDistance;
      queue.push({ x, y });
    }
  }
  return result;
}

function mergeMasks(width, height, ...masks) {
  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => masks.some(mask => mask[y][x]))
  );
}

function connectionMask(width, height, elevationConnections) {
  const result = createGrid(width, height);
  for (const connection of elevationConnections) {
    for (const coordinate of [connection?.from, connection?.to]) {
      if (!Number.isInteger(coordinate?.x) || !Number.isInteger(coordinate?.y) ||
          coordinate.x < 0 || coordinate.x >= width ||
          coordinate.y < 0 || coordinate.y >= height) {
        throw new TypeError('elevationConnections contain an invalid endpoint');
      }
      result[coordinate.y][coordinate.x] = true;
    }
  }
  return result;
}

const CARDINAL_DIRECTIONS = Object.freeze([
  Object.freeze({ dx: 0, dy: -1, name: 'n', opposite: 's' }),
  Object.freeze({ dx: 1, dy: 0, name: 'e', opposite: 'w' }),
  Object.freeze({ dx: 0, dy: 1, name: 's', opposite: 'n' }),
  Object.freeze({ dx: -1, dy: 0, name: 'w', opposite: 'e' })
]);

function createElevationConnectionGrid(connections, width, height) {
  const result = Array.from(
    { length: height },
    () => Array.from({ length: width }, () => ({}))
  );
  for (const connection of connections) {
    const direction = CARDINAL_DIRECTIONS.find(candidate =>
      connection.from.x + candidate.dx === connection.to.x &&
      connection.from.y + candidate.dy === connection.to.y
    );
    if (!direction) {
      throw new TypeError('elevationConnections must join cardinally adjacent cells');
    }
    const value = {
      type: connection.kind ?? connection.type,
      levels: Math.max(1, Math.round(Math.abs(connection.elevationDelta ?? 1)))
    };
    result[connection.from.y][connection.from.x][direction.name] = value;
    if (connection.bidirectional) {
      result[connection.to.y][connection.to.x][direction.opposite] = value;
    }
  }
  return result;
}

function createTraversalAdjacency({
  width,
  height,
  terrain,
  elevation,
  elevationConnections
}) {
  const view = createTraversalView({
    terrain: terrain.map(row => row.map(cell => cell.material)),
    elevation,
    elevationConnections: createElevationConnectionGrid(
      elevationConnections,
      width,
      height
    ),
    dimensions: { width, height },
    movementPolicy: {
      canTraverseTerrain({ to, terrainCost }) {
        return terrain[to.y][to.x].passable &&
          Number.isFinite(terrain[to.y][to.x].movementCost ?? terrainCost);
      }
    }
  });
  const directionalIncidentMask = createGrid(width, height);
  const mutual = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      if (!terrain[y][x].passable) return [];
      const from = { x, y };
      return CARDINAL_DIRECTIONS.flatMap(({ dx, dy }) => {
        const to = { x: x + dx, y: y + dy };
        if (to.x < 0 || to.x >= width || to.y < 0 || to.y >= height ||
            !terrain[to.y][to.x].passable) return [];
        const forward = canEnterTile(view, from, to);
        const reverse = canEnterTile(view, to, from);
        if (forward !== reverse) directionalIncidentMask[y][x] = true;
        /*
         * Isolation uses mutually traversable edges. This is conservative for
         * one-way ledges: a geometric detour is never treated as a safe bypass
         * unless runtime traversal supports it in both directions.
         */
        return forward && reverse ? [to] : [];
      });
    })
  );
  return { mutual, directionalIncidentMask };
}

function maximumSlope(fields, x, y) {
  const center = fields.height[y][x];
  let slope = 0;
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    const adjacent = fields.height[y + dy]?.[x + dx];
    if (adjacent === undefined) continue;
    slope = Math.max(slope, Math.abs(center - adjacent));
  }
  return clamp(slope);
}

function proximity(distance, radius) {
  return clamp(SCALE - Math.floor(Math.min(distance, radius) * SCALE / radius));
}

function remoteness(distance, radius) {
  return clamp(Math.floor(Math.min(distance, radius) * SCALE / radius));
}

function blockerSuitability(mode, evidence) {
  const moisture = normalizedSigned(evidence.moisture);
  const roughness = normalizedSigned(evidence.roughness);
  const height = normalizedSigned(evidence.height);
  const disturbance = normalizedSigned(evidence.disturbance);
  const slope = evidence.slope;
  const routeFar = remoteness(evidence.routeDistance, 6);
  const routeNear = proximity(evidence.routeDistance, 5);
  const waterNear = proximity(Math.abs(evidence.waterDistance - 2), 5);
  if (mode === 'tree') {
    return Math.floor(
      moisture * 30 / 100 +
      (SCALE - disturbance) * 25 / 100 +
      (SCALE - slope) * 15 / 100 +
      routeFar * 15 / 100 +
      waterNear * 15 / 100
    );
  }
  if (mode === 'rock') {
    return Math.floor(
      roughness * 30 / 100 +
      slope * 20 / 100 +
      height * 20 / 100 +
      disturbance * 10 / 100 +
      routeFar * 20 / 100
    );
  }
  if (mode === 'cave-rock') {
    return Math.floor(
      roughness * 35 / 100 +
      slope * 20 / 100 +
      moisture * 10 / 100 +
      disturbance * 15 / 100 +
      routeFar * 20 / 100
    );
  }
  if (mode === 'constructed') {
    return Math.floor(
      disturbance * 30 / 100 +
      routeNear * 25 / 100 +
      roughness * 15 / 100 +
      height * 10 / 100 +
      (SCALE - moisture) * 20 / 100
    );
  }
  throw new TypeError(`Unsupported blocker suitability mode: ${mode}`);
}

function decorationSuitability(mode, evidence) {
  const moisture = normalizedSigned(evidence.moisture);
  const roughness = normalizedSigned(evidence.roughness);
  const disturbance = normalizedSigned(evidence.disturbance);
  const slope = evidence.slope;
  const waterNear = proximity(evidence.waterDistance, 4);
  const routeNear = proximity(evidence.routeDistance, 4);
  switch (mode) {
    case 'ground-cover':
      return Math.floor((moisture * 2 + SCALE - disturbance) / 3);
    case 'leaf-litter':
      return Math.floor((SCALE - disturbance + moisture) / 2);
    case 'moist':
      return Math.floor((moisture * 3 + waterNear) / 4);
    case 'rough':
      return Math.floor((roughness * 2 + slope) / 3);
    case 'dry':
      return Math.floor(((SCALE - moisture) * 2 + roughness) / 3);
    case 'waterside':
      return Math.floor((waterNear * 3 + moisture) / 4);
    case 'disturbed':
      return Math.floor((disturbance * 2 + routeNear) / 3);
    case 'rough-disturbed':
      return Math.floor((roughness + disturbance + slope) / 3);
    case 'dry-disturbed':
      return Math.floor((SCALE - moisture + disturbance + roughness) / 3);
    default:
      throw new TypeError(`Unsupported decoration suitability mode: ${mode}`);
  }
}

function compareCandidates(left, right) {
  return right.rank - left.rank ||
    stableLexicographicCompare(
      [left.y, left.x, left.family, left.parentFeatureId],
      [right.y, right.x, right.family, right.parentFeatureId]
    );
}

/**
 * Deterministic greedy Poisson/minimum-distance selection. Ranking must already
 * be quantized; input iteration order is deliberately irrelevant.
 */
export function selectMinimumDistanceCandidates(candidates, {
  minimumDistance,
  limit = candidates.length
}) {
  if (!Number.isInteger(minimumDistance) || minimumDistance < 1) {
    throw new RangeError('minimumDistance must be a positive integer');
  }
  if (!Number.isInteger(limit) || limit < 0) {
    throw new RangeError('limit must be a nonnegative integer');
  }
  const cellSize = minimumDistance;
  const buckets = new Map();
  const selected = [];
  const rejected = [];
  const key = (x, y) => `${x},${y}`;
  for (const candidate of [...candidates].sort(compareCandidates)) {
    if (selected.length >= limit) break;
    const bucketX = Math.floor(candidate.x / cellSize);
    const bucketY = Math.floor(candidate.y / cellSize);
    let collision = false;
    for (let by = bucketY - 1; by <= bucketY + 1 && !collision; by++) {
      for (let bx = bucketX - 1; bx <= bucketX + 1 && !collision; bx++) {
        for (const other of buckets.get(key(bx, by)) ?? []) {
          const dx = other.x - candidate.x;
          const dy = other.y - candidate.y;
          if (dx * dx + dy * dy < minimumDistance * minimumDistance) {
            collision = true;
            break;
          }
        }
      }
    }
    if (collision) {
      rejected.push(candidate);
      continue;
    }
    selected.push(candidate);
    const bucketKey = key(bucketX, bucketY);
    const entries = buckets.get(bucketKey) ?? [];
    entries.push(candidate);
    buckets.set(bucketKey, entries);
  }
  return { selected, rejected };
}

function selectTraversalSafeCandidates(candidates, {
  minimumDistance,
  limit,
  traversalAdjacency,
  occupiedMask
}) {
  const buckets = new Map();
  const selected = [];
  let minimumSpacingRejected = 0;
  let traversalRejected = 0;
  const bucketKey = (x, y) => `${x},${y}`;
  for (const candidate of [...candidates].sort(compareCandidates)) {
    if (selected.length >= limit) break;
    const bucketX = Math.floor(candidate.x / minimumDistance);
    const bucketY = Math.floor(candidate.y / minimumDistance);
    let collision = false;
    for (let by = bucketY - 1; by <= bucketY + 1 && !collision; by++) {
      for (let bx = bucketX - 1; bx <= bucketX + 1 && !collision; bx++) {
        for (const other of buckets.get(bucketKey(bx, by)) ?? []) {
          const dx = other.x - candidate.x;
          const dy = other.y - candidate.y;
          if (dx * dx + dy * dy < minimumDistance * minimumDistance) {
            collision = true;
            break;
          }
        }
      }
    }
    if (collision) {
      minimumSpacingRejected++;
      continue;
    }
    if (!traversalSafe(candidate, traversalAdjacency, occupiedMask)) {
      traversalRejected++;
      continue;
    }
    selected.push(candidate);
    occupiedMask[candidate.y][candidate.x] = true;
    const key = bucketKey(bucketX, bucketY);
    const entries = buckets.get(key) ?? [];
    entries.push(candidate);
    buckets.set(key, entries);
  }
  return { selected, minimumSpacingRejected, traversalRejected };
}

function traversalSafe(candidate, traversalAdjacency, occupiedMask) {
  const { x, y } = candidate;
  if (traversalAdjacency.directionalIncidentMask[y][x]) return false;
  const adjacency = traversalAdjacency.mutual;
  const neighbors = adjacency[y][x].filter(
    neighbor => !occupiedMask[neighbor.y][neighbor.x]
  );
  if (neighbors.length <= 1) return true;
  const targetKeys = new Set(neighbors.slice(1).map(cell => `${cell.x},${cell.y}`));
  const visited = createGrid(adjacency[0].length, adjacency.length);
  const queue = [neighbors[0]];
  visited[neighbors[0].y][neighbors[0].x] = true;
  for (let cursor = 0; cursor < queue.length && targetKeys.size > 0; cursor++) {
    const current = queue[cursor];
    targetKeys.delete(`${current.x},${current.y}`);
    for (const next of adjacency[current.y][current.x]) {
      if (next.x === x && next.y === y) continue;
      if (occupiedMask[next.y][next.x] || visited[next.y][next.x]) continue;
      visited[next.y][next.x] = true;
      queue.push(next);
    }
  }
  return targetKeys.size === 0;
}

function assertClosedRecord(value, keys, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !keys.includes(key)) ||
      keys.some(key => !Object.hasOwn(value, key))) {
    throw new TypeError(`${name} must contain exactly ${keys.join(', ')}`);
  }
}

export function serializeObstacle(value) {
  const keys = ['id', 'x', 'y', 'kind', 'assetKey', 'blocking', 'movementCost', 'featureId'];
  assertClosedRecord(value, keys, 'Obstacle record');
  return deepFreeze({ ...value });
}

export function serializeDecoration(value) {
  const keys = ['id', 'x', 'y', 'kind', 'assetKey', 'variantIndex', 'anchor', 'featureId'];
  assertClosedRecord(value, keys, 'Decoration record');
  return deepFreeze({ ...value });
}

export function serializeStructure(value) {
  const keys = ['id', 'kind', 'assetKey', 'footprint', 'entrances', 'parentRegionId'];
  assertClosedRecord(value, keys, 'Structure record');
  return deepFreeze({
    ...value,
    footprint: value.footprint.map(cell => ({ ...cell })),
    entrances: value.entrances.map(cell => ({ ...cell }))
  });
}

function validateInputs(options) {
  const {
    width,
    height,
    attemptSeed,
    recipe,
    fields,
    regions,
    terrain,
    elevation,
    spawnLayout,
    routePlan,
    elevationConnections = [],
    parameters = {}
  } = options;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new TypeError('Ecology placement requires positive integer width and height');
  }
  if (!Number.isSafeInteger(attemptSeed) || attemptSeed < 0) {
    throw new TypeError('Ecology placement attemptSeed must be a nonnegative safe integer');
  }
  if (!recipe || !Object.hasOwn(PROFILES, recipe.nodeType)) {
    throw new TypeError(`No explicit V2 ecology profile for ${String(recipe?.nodeType)}`);
  }
  if (!recipe.ecology || !Array.isArray(recipe.obstacleFamilies) ||
      !Array.isArray(recipe.decorationFamilies)) {
    throw new TypeError('Ecology placement requires a resolved V2 recipe');
  }
  const profileDefinition = PROFILES[recipe.nodeType];
  for (const rule of profileDefinition.blockers) {
    const catalog = BLOCKER_CATALOG[rule.family];
    if (!catalog || !recipe.obstacleFamilies.includes(catalog.obstacleKind)) {
      throw new TypeError(
        `Ecology profile ${recipe.nodeType} requires undeclared obstacle family ${rule.family}`
      );
    }
  }
  if (profileDefinition.decorationFamilies.some(
    family => !recipe.decorationFamilies.includes(family) || !DECORATION_CATALOG[family]
  )) {
    throw new TypeError(`Ecology profile ${recipe.nodeType} does not match its decoration families`);
  }
  const declaredBlockers = [...new Set(recipe.obstacleFamilies)].sort();
  const profiledBlockers = [...new Set(profileDefinition.blockers.map(
    rule => BLOCKER_CATALOG[rule.family].obstacleKind
  ))].sort();
  const declaredDecorations = [...new Set(recipe.decorationFamilies)].sort();
  const profiledDecorations = [...new Set(profileDefinition.decorationFamilies)].sort();
  if (stableLexicographicCompare(declaredBlockers, profiledBlockers) !== 0 ||
      stableLexicographicCompare(declaredDecorations, profiledDecorations) !== 0) {
    throw new TypeError(
      `Ecology profile ${recipe.nodeType} must exactly cover its declared families`
    );
  }
  for (const name of ['height', 'moisture', 'roughness', 'disturbance']) {
    assertGrid(
      fields?.[name],
      `fields.${name}`,
      width,
      height,
      value => Number.isSafeInteger(value) && value >= -SCALE && value <= SCALE
    );
  }
  assertGrid(
    regions?.regionIdGrid,
    'regions.regionIdGrid',
    width,
    height,
    value => typeof value === 'string' && value.length > 0
  );
  assertGrid(
    regions?.kindGrid,
    'regions.kindGrid',
    width,
    height,
    value => typeof value === 'string' && value.length > 0
  );
  if (!Array.isArray(regions?.regions)) throw new TypeError('regions.regions must be an array');
  assertGrid(
    terrain,
    'terrain',
    width,
    height,
    value => value && typeof value.material === 'string' && typeof value.passable === 'boolean'
  );
  assertGrid(
    elevation,
    'elevation',
    width,
    height,
    value => Number.isFinite(value) && value >= 0 && value <= 1
  );
  assertGrid(
    spawnLayout?.coreMask,
    'spawnLayout.coreMask',
    width,
    height,
    value => typeof value === 'boolean'
  );
  if (!routePlan?.masks) throw new TypeError('Ecology placement requires finalized route masks');
  for (const name of ['centerlineMask', 'pathMask']) {
    assertGrid(
      routePlan.masks[name],
      `routePlan.masks.${name}`,
      width,
      height,
      value => typeof value === 'boolean'
    );
  }
  if (!Array.isArray(elevationConnections)) {
    throw new TypeError('elevationConnections must be an array');
  }
  for (const [name, recipeValue] of [
    ['blockingDensity', recipe.ecology.blockingDensity],
    ['decorationDensity', recipe.ecology.decorationDensity]
  ]) {
    const value = parameters[name] ?? recipeValue;
    if (!Number.isSafeInteger(value) || value < 0 || value > SCALE) {
      throw new RangeError(`${name} must be a fixed-point integer from 0 to ${SCALE}`);
    }
  }
  const spacing = parameters.minimumBlockerSpacing ?? recipe.ecology.minimumBlockerSpacing;
  if (!Number.isInteger(spacing) || spacing < 1 || spacing > Math.max(width, height)) {
    throw new RangeError('minimumBlockerSpacing must be a valid positive tile distance');
  }
  if (options.scanOrder !== undefined &&
      options.scanOrder !== 'row-major' && options.scanOrder !== 'reverse') {
    throw new TypeError(`Unsupported ecology scan order: ${String(options.scanOrder)}`);
  }
  return profileDefinition;
}

function makeEvidence(fields, distances, x, y) {
  return {
    height: fields.height[y][x],
    moisture: fields.moisture[y][x],
    roughness: fields.roughness[y][x],
    disturbance: fields.disturbance[y][x],
    slope: maximumSlope(fields, x, y),
    waterDistance: distances.water[y][x],
    routeDistance: distances.route[y][x],
    protectedDistance: distances.protected[y][x]
  };
}

function exclusionReason({
  x,
  y,
  catalog,
  terrain,
  protectedMask,
  reservationMask,
  routeMask,
  waterMask,
  connectionEndpoints
}) {
  if (protectedMask[y][x]) return 'protected';
  if (reservationMask[y][x]) return 'reserved';
  if (routeMask[y][x]) return 'route';
  if (waterMask[y][x]) return 'water';
  if (connectionEndpoints[y][x]) return 'connection';
  if (!terrain[y][x].passable || !catalog.allowedMaterials.includes(terrain[y][x].material)) {
    return 'invalidSubstrate';
  }
  return null;
}

function clusterCenters(candidates, seed) {
  const grouped = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.family}\0${candidate.parentFeatureId}`;
    const entries = grouped.get(key) ?? [];
    entries.push(candidate);
    grouped.set(key, entries);
  }
  const result = new Map();
  for (const [key, entries] of grouped) {
    const xs = entries.map(entry => entry.x).sort((a, b) => a - b);
    const ys = entries.map(entry => entry.y).sort((a, b) => a - b);
    const medianX = xs[Math.floor((xs.length - 1) / 2)];
    const medianY = ys[Math.floor((ys.length - 1) / 2)];
    const center = [...entries].sort((left, right) => {
      const leftDistance = Math.abs(left.x - medianX) + Math.abs(left.y - medianY);
      const rightDistance = Math.abs(right.x - medianX) + Math.abs(right.y - medianY);
      return leftDistance - rightDistance ||
        right.suitability - left.suitability ||
        (
          coordinateHash32(seed, left.x, left.y, `cluster:${key}`) -
          coordinateHash32(seed, right.x, right.y, `cluster:${key}`)
        ) ||
        left.y - right.y ||
        left.x - right.x;
    })[0];
    result.set(key, { x: center.x, y: center.y });
  }
  return result;
}

function finalizeBlockerCandidates(candidates, seed, width, height) {
  const centers = clusterCenters(candidates, seed);
  const radius = Math.max(4, Math.floor(Math.min(width, height) * 2 / 5));
  return candidates.map(candidate => {
    const key = `${candidate.family}\0${candidate.parentFeatureId}`;
    const center = centers.get(key);
    const distance = Math.abs(center.x - candidate.x) + Math.abs(center.y - candidate.y);
    const clusterBoost = proximity(distance, radius);
    const jitter = coordinateHash32(seed, candidate.x, candidate.y, `blocker:${key}`) % 100_001;
    return {
      ...candidate,
      clusterCenter: center,
      clusterRadius: radius,
      rank: candidate.suitability + Math.floor(clusterBoost * 65 / 100) + jitter
    };
  });
}

function blockerRecords(candidates, recipe) {
  const structures = [];
  const obstacles = [];
  for (const candidate of [...candidates].sort((a, b) =>
    a.y - b.y || a.x - b.x || a.family.localeCompare(b.family)
  )) {
    const catalog = BLOCKER_CATALOG[candidate.family];
    let featureId = candidate.parentFeatureId;
    if (catalog.structureKind) {
      featureId = `structure:ecology:${catalog.structureKind}:${candidate.x}:${candidate.y}`;
      structures.push(serializeStructure({
        id: featureId,
        kind: catalog.structureKind,
        /*
         * Constructed feature semantics reuse the recipe-declared obstacle
         * asset. A separate structure asset family must not bypass capability
         * preflight before that family exists in the recipe contract.
         */
        assetKey: `${recipe.renderPalette}:obstacle-family:${catalog.obstacleKind}`,
        footprint: [{ x: candidate.x, y: candidate.y }],
        entrances: [],
        parentRegionId: candidate.parentFeatureId
      }));
    }
    obstacles.push(serializeObstacle({
      id: `obstacle:${catalog.obstacleKind}:${candidate.x}:${candidate.y}`,
      x: candidate.x,
      y: candidate.y,
      kind: catalog.obstacleKind,
      assetKey: `${recipe.renderPalette}:obstacle-family:${catalog.obstacleKind}`,
      blocking: true,
      movementCost: 0,
      featureId
    }));
  }
  return { obstacles, structures };
}

function minimumObservedSpacing(candidates) {
  let minimumSquared = Infinity;
  for (let index = 0; index < candidates.length; index++) {
    for (let other = index + 1; other < candidates.length; other++) {
      const dx = candidates[index].x - candidates[other].x;
      const dy = candidates[index].y - candidates[other].y;
      minimumSquared = Math.min(minimumSquared, dx * dx + dy * dy);
    }
  }
  return minimumSquared === Infinity ? null : Math.floor(Math.sqrt(minimumSquared) * SCALE);
}

function associationRecords(candidates) {
  const grouped = new Map();
  for (const candidate of candidates) {
    const entries = grouped.get(candidate.family) ?? [];
    entries.push(candidate);
    grouped.set(candidate.family, entries);
  }
  return [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([kind, entries]) => ({
    kind,
    count: entries.length,
    averageSuitability: Math.floor(
      entries.reduce((sum, item) => sum + item.suitability, 0) / entries.length
    ),
    averageMoisture: Math.floor(
      entries.reduce((sum, item) => sum + item.evidence.moisture, 0) / entries.length
    ),
    averageSlope: Math.floor(
      entries.reduce((sum, item) => sum + item.evidence.slope, 0) / entries.length
    ),
    averageWaterDistance: Math.floor(
      entries.reduce((sum, item) => sum + item.evidence.waterDistance, 0) / entries.length
    ),
    averageRouteDistance: Math.floor(
      entries.reduce((sum, item) => sum + item.evidence.routeDistance, 0) / entries.length
    ),
    averageDisturbance: Math.floor(
      entries.reduce((sum, item) => sum + item.evidence.disturbance, 0) / entries.length
    ),
    parentFeatureCount: new Set(entries.map(item => item.parentFeatureId)).size,
    parentRegionKinds: [...new Set(entries.map(item => item.parentRegionKind))].sort()
  }));
}

function blockerVoidFraction(candidates, selected) {
  const selectedKeys = new Set(selected.map(
    candidate => `${candidate.family}\0${candidate.parentFeatureId}`
  ));
  let eligibleCount = 0;
  let voidCount = 0;
  for (const candidate of candidates) {
    const key = `${candidate.family}\0${candidate.parentFeatureId}`;
    if (!selectedKeys.has(key)) continue;
    eligibleCount++;
    const distance = Math.abs(candidate.x - candidate.clusterCenter.x) +
      Math.abs(candidate.y - candidate.clusterCenter.y);
    if (distance > candidate.clusterRadius) voidCount++;
  }
  return fixedRatio(voidCount, eligibleCount);
}

function decorationCandidates({
  width,
  height,
  profileDefinition,
  fields,
  regions,
  distances,
  excludedMask,
  occupiedMask,
  seed,
  scanOrder
}) {
  const result = [];
  const coordinates = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) coordinates.push({ x, y });
  }
  if (scanOrder === 'reverse') coordinates.reverse();
  for (const { x, y } of coordinates) {
    if (excludedMask[y][x] || occupiedMask[y][x]) continue;
    const evidence = makeEvidence(fields, distances, x, y);
    for (const family of profileDefinition.decorationFamilies) {
      const suitability = decorationSuitability(DECORATION_CATALOG[family].mode, evidence);
      if (suitability < 180_000) continue;
      result.push({
        x,
        y,
        family,
        parentFeatureId: regions.regionIdGrid[y][x],
        suitability,
        rank: suitability +
          coordinateHash32(seed, x, y, `decoration:${family}`) % 150_001
      });
    }
  }
  return result;
}

function chooseDecorations(candidates, limit, seed, recipe) {
  const selected = [];
  const occupied = new Set();
  for (const candidate of [...candidates].sort(compareCandidates)) {
    if (selected.length >= limit) break;
    const key = `${candidate.x},${candidate.y}`;
    if (occupied.has(key)) continue;
    occupied.add(key);
    selected.push(candidate);
  }
  return selected.sort((a, b) =>
    a.y - b.y || a.x - b.x || a.family.localeCompare(b.family)
  ).map(candidate => serializeDecoration({
    id: `decoration:${candidate.family}:${candidate.x}:${candidate.y}`,
    x: candidate.x,
    y: candidate.y,
    kind: candidate.family,
    assetKey: `${recipe.renderPalette}:decoration-family:${candidate.family}`,
    variantIndex: coordinateHash32(
      seed,
      candidate.x,
      candidate.y,
      `variant:${candidate.family}`
    ) % 4,
    anchor: 'tile_top',
    featureId: candidate.parentFeatureId
  }));
}

/**
 * Populate schema-exact obstacle, structure, and nonblocking-decoration
 * records without mutating terrain or any upstream feature layer.
 */
export function placeEcologyAndBlockers(options) {
  const profileDefinition = validateInputs(options);
  const {
    width,
    height,
    attemptSeed,
    recipe,
    fields,
    regions,
    terrain,
    elevation,
    spawnLayout,
    routePlan,
    hydrology = {},
    elevationConnections = [],
    reservationMask: suppliedReservationMask,
    scanOrder = 'row-major',
    parameters = {}
  } = options;
  const reservationMask = optionalBooleanMask(
    suppliedReservationMask,
    'reservationMask',
    width,
    height
  );
  const featherMask = optionalBooleanMask(
    spawnLayout.featherMask,
    'spawnLayout.featherMask',
    width,
    height
  );
  const protectedMask = mergeMasks(width, height, spawnLayout.coreMask, featherMask);
  const routeMask = mergeMasks(
    width,
    height,
    routePlan.masks.centerlineMask,
    routePlan.masks.pathMask
  );
  const waterMask = optionalBooleanMask(
    hydrology.featureMask,
    'hydrology.featureMask',
    width,
    height
  );
  const connectionEndpoints = connectionMask(width, height, elevationConnections);
  const excludedMask = mergeMasks(
    width,
    height,
    protectedMask,
    reservationMask,
    routeMask,
    waterMask,
    connectionEndpoints
  );
  const passableMask = terrain.map(row => row.map(cell => cell.passable));
  const decorationExcludedMask = mergeMasks(
    width,
    height,
    excludedMask,
    passableMask.map(row => row.map(value => !value))
  );
  const distances = {
    route: distanceField(routeMask),
    water: distanceField(waterMask),
    protected: spawnLayout.distanceToProtectedZone ?? distanceField(protectedMask)
  };
  assertGrid(
    distances.protected,
    'spawnLayout.distanceToProtectedZone',
    width,
    height,
    value => Number.isSafeInteger(value) && value >= 0
  );
  const traversalAdjacency = createTraversalAdjacency({
    width,
    height,
    terrain,
    elevation,
    elevationConnections
  });

  const rejectionCounts = {
    protected: 0,
    reserved: 0,
    route: 0,
    water: 0,
    connection: 0,
    invalidSubstrate: 0,
    lowSuitability: 0,
    minimumSpacing: 0,
    traversalIsolation: 0
  };
  const blockerSeed = deriveStreamSeed(attemptSeed, 'ecology:blockers');
  const rawBlockerCandidates = [];
  const rulesByKind = new Map();
  for (const rule of profileDefinition.blockers) {
    for (const kind of rule.regionKinds) {
      const entries = rulesByKind.get(kind) ?? [];
      entries.push(rule);
      rulesByKind.set(kind, entries);
    }
  }
  const coordinates = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) coordinates.push({ x, y });
  }
  if (scanOrder === 'reverse') coordinates.reverse();
  for (const { x, y } of coordinates) {
    const rules = rulesByKind.get(regions.kindGrid[y][x]) ?? [];
    for (const rule of rules) {
      const catalog = BLOCKER_CATALOG[rule.family];
      const reason = exclusionReason({
        x,
        y,
        catalog,
        terrain,
        protectedMask,
        reservationMask,
        routeMask,
        waterMask,
        connectionEndpoints
      });
      if (reason) {
        rejectionCounts[reason]++;
        continue;
      }
      const evidence = makeEvidence(fields, distances, x, y);
      const suitability = blockerSuitability(rule.suitability, evidence);
      if (suitability < 220_000) {
        rejectionCounts.lowSuitability++;
        continue;
      }
      rawBlockerCandidates.push({
        x,
        y,
        family: rule.family,
        parentFeatureId: regions.regionIdGrid[y][x],
        parentRegionKind: regions.kindGrid[y][x],
        suitability,
        evidence
      });
    }
  }
  const blockingDensity = parameters.blockingDensity ?? recipe.ecology.blockingDensity;
  const averageBlockerSuitability = rawBlockerCandidates.length === 0
    ? 0
    : Math.floor(
      rawBlockerCandidates.reduce((sum, candidate) => sum + candidate.suitability, 0) /
      rawBlockerCandidates.length
    );
  const blockerLimit = Math.min(
    rawBlockerCandidates.length,
    Math.floor(
      rawBlockerCandidates.length *
      blockingDensity *
      (500_000 + Math.floor(averageBlockerSuitability / 2)) /
      SCALE /
      SCALE
    )
  );
  const rankedBlockers = finalizeBlockerCandidates(
    rawBlockerCandidates,
    blockerSeed,
    width,
    height
  );
  const occupiedMask = createGrid(width, height);
  const selected = selectTraversalSafeCandidates(rankedBlockers, {
    minimumDistance: parameters.minimumBlockerSpacing ??
      recipe.ecology.minimumBlockerSpacing,
    limit: blockerLimit,
    traversalAdjacency,
    occupiedMask
  });
  rejectionCounts.minimumSpacing += selected.minimumSpacingRejected;
  rejectionCounts.traversalIsolation += selected.traversalRejected;
  const selectedBlockers = selected.selected;
  const records = blockerRecords(selectedBlockers, recipe);

  const decorationSeed = deriveStreamSeed(attemptSeed, 'ecology:decorations');
  const decorationPool = decorationCandidates({
    width,
    height,
    profileDefinition,
    fields,
    regions,
    distances,
    excludedMask: decorationExcludedMask,
    occupiedMask,
    seed: decorationSeed,
    scanOrder
  });
  const decorationDensity = parameters.decorationDensity ??
    recipe.ecology.decorationDensity;
  const decorationLimit = Math.min(
    decorationPool.length,
    Math.floor(width * height * decorationDensity / SCALE)
  );
  const decorations = chooseDecorations(
    decorationPool,
    decorationLimit,
    decorationSeed,
    recipe
  );

  const insideCluster = selectedBlockers.filter(candidate =>
    Math.abs(candidate.x - candidate.clusterCenter.x) +
      Math.abs(candidate.y - candidate.clusterCenter.y) <= candidate.clusterRadius
  ).length;
  const minimumCoverage = Math.floor(blockerLimit * 7 / 10);
  const diagnostics = {
    placementVersion: ECOLOGY_PLACEMENT_VERSION,
    catalogVersion: ECOLOGY_CATALOG_VERSION,
    nodeType: recipe.nodeType,
    budgets: {
      blockingDensity,
      blockingRequested: blockerLimit,
      blockingMinimumCoverage: minimumCoverage,
      blockingPlaced: records.obstacles.length,
      blockingCoverageWithinBand: records.obstacles.length >= minimumCoverage &&
        records.obstacles.length <= blockerLimit,
      decorationDensity,
      decorationRequested: decorationLimit,
      decorationPlaced: decorations.length
    },
    exclusions: rejectionCounts,
    spacing: {
      requiredTiles: parameters.minimumBlockerSpacing ??
        recipe.ecology.minimumBlockerSpacing,
      observedFixed: minimumObservedSpacing(selectedBlockers)
    },
    clusters: {
      parentFeatureCount: new Set(
        rawBlockerCandidates.map(candidate => candidate.parentFeatureId)
      ).size,
      occupiedParentFeatureCount: new Set(
        selectedBlockers.map(candidate => candidate.parentFeatureId)
      ).size,
      concentration: fixedRatio(insideCluster, selectedBlockers.length),
      voidFraction: blockerVoidFraction(rankedBlockers, selectedBlockers)
    },
    associations: associationRecords(selectedBlockers)
  };

  return deepFreeze({
    placementVersion: ECOLOGY_PLACEMENT_VERSION,
    obstacles: records.obstacles,
    decorations,
    structures: records.structures,
    blockingMask: occupiedMask,
    diagnostics
  });
}
