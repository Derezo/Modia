import {
  canEnterTile,
  createTraversalView,
  getReachableTilesForTraversal,
  getTraversalOccupant,
  isWithinTraversalBounds
} from '../../traversal.js';
import { discretizeElevation } from '../../terrain.js';
import { deepFreeze } from './V2Context.js';

export const V2_ENEMY_SPAWN_STRATEGIES = Object.freeze([
  'formation',
  'balanced',
  'aggressive',
  'ranged',
  'ambush'
]);

const DIRECTIONS = Object.freeze([
  Object.freeze({ dx: 0, dy: -1, name: 'n', opposite: 's' }),
  Object.freeze({ dx: 1, dy: 0, name: 'e', opposite: 'w' }),
  Object.freeze({ dx: 0, dy: 1, name: 's', opposite: 'n' }),
  Object.freeze({ dx: -1, dy: 0, name: 'w', opposite: 'e' })
]);

export class SpawnIntegrationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SpawnIntegrationError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function keyOf({ x, y }) {
  return `${x},${y}`;
}

function assertRectangularGrid(grid, name) {
  if (!Array.isArray(grid) || grid.length === 0 || !Array.isArray(grid[0]) ||
      grid[0].length === 0) {
    throw new TypeError(`${name} must be a non-empty row-major grid`);
  }
  const width = grid[0].length;
  for (let y = 0; y < grid.length; y++) {
    if (!Array.isArray(grid[y]) || grid[y].length !== width) {
      throw new TypeError(`${name}[${y}] must contain ${width} columns`);
    }
  }
  return { width, height: grid.length };
}

function assertMatchingGrid(grid, name, width, height) {
  const dimensions = assertRectangularGrid(grid, name);
  if (dimensions.width !== width || dimensions.height !== height) {
    throw new TypeError(`${name} dimensions must match terrain`);
  }
}

function materialOf(cell) {
  return typeof cell === 'string' ? cell : cell?.material;
}

function movementCostOf(cell, fallback) {
  return Number.isFinite(cell?.movementCost) ? cell.movementCost : fallback;
}

function cloneGrid(grid) {
  return grid.map(row => row.map(cell => (
    cell && typeof cell === 'object' && !Array.isArray(cell) ? { ...cell } : cell
  )));
}

function validateFeatherEdit(edit, index, width, height) {
  const allowed = ['id', 'type', 'layer', 'x', 'y', 'value'];
  if (!edit || typeof edit !== 'object' || Array.isArray(edit)) {
    throw new TypeError(`featherEdits[${index}] must be an object`);
  }
  for (const key of Object.keys(edit)) {
    if (!allowed.includes(key)) {
      throw new TypeError(`featherEdits[${index}].${key} is not allowed`);
    }
  }
  if (typeof edit.id !== 'string' || !/^[a-z][a-z0-9:_-]*$/.test(edit.id)) {
    throw new TypeError(`featherEdits[${index}].id must be a stable lowercase id`);
  }
  if (edit.type !== 'spawn-feather-cell') {
    throw new TypeError(`featherEdits[${index}].type must be spawn-feather-cell`);
  }
  if (edit.layer !== 'terrain' && edit.layer !== 'elevation') {
    throw new TypeError(`featherEdits[${index}].layer must be terrain or elevation`);
  }
  if (!Number.isInteger(edit.x) || !Number.isInteger(edit.y) ||
      edit.x < 0 || edit.x >= width || edit.y < 0 || edit.y >= height) {
    throw new RangeError(`featherEdits[${index}] coordinates are out of bounds`);
  }
  if (edit.layer === 'elevation' &&
      (!Number.isFinite(edit.value) || edit.value < 0 || edit.value > 1)) {
    throw new TypeError(`featherEdits[${index}].value must be normalized elevation`);
  }
  if (edit.layer === 'terrain' && (
    (typeof edit.value !== 'string' || edit.value.length === 0) &&
    (!edit.value || typeof edit.value !== 'object' || Array.isArray(edit.value))
  )) {
    throw new TypeError(`featherEdits[${index}].value must be a terrain value`);
  }
}

function hasEditSeam(edits, width, height) {
  const coordinates = new Set(edits.map(keyOf));
  for (let y = 0; y < height; y++) {
    let complete = true;
    for (let x = 0; x < width; x++) complete &&= coordinates.has(`${x},${y}`);
    if (complete) return true;
  }
  for (let x = 0; x < width; x++) {
    let complete = true;
    for (let y = 0; y < height; y++) complete &&= coordinates.has(`${x},${y}`);
    if (complete) return true;
  }
  return false;
}

/**
 * Apply only explicitly typed, cell-local feather edits. Core edits and
 * row/column blanket replacement seams are rejected.
 */
export function applySpawnFeatherEdits({
  spawnLayout,
  terrain,
  elevation,
  edits = []
}) {
  const { width, height } = assertRectangularGrid(terrain, 'terrain');
  assertMatchingGrid(elevation, 'elevation', width, height);
  if (!Array.isArray(edits)) throw new TypeError('featherEdits must be an array');
  const seen = new Set();
  edits.forEach((edit, index) => {
    validateFeatherEdit(edit, index, width, height);
    const coordinate = `${edit.layer}:${edit.x},${edit.y}`;
    if (seen.has(coordinate)) {
      throw new SpawnIntegrationError(
        'DUPLICATE_FEATHER_EDIT',
        `Multiple feather edits target ${coordinate}`
      );
    }
    seen.add(coordinate);
    if (!spawnLayout?.featherMask?.[edit.y]?.[edit.x] ||
        spawnLayout?.coreMask?.[edit.y]?.[edit.x]) {
      throw new SpawnIntegrationError(
        'FEATHER_EDIT_OUTSIDE_BOUNDARY',
        `Feather edit ${edit.id} must target featherMask outside coreMask`,
        { id: edit.id, x: edit.x, y: edit.y }
      );
    }
  });
  if (hasEditSeam(edits, width, height)) {
    throw new SpawnIntegrationError(
      'BLANKET_SPAWN_SEAM',
      'Spawn feather edits cannot replace an entire map row or column'
    );
  }

  const nextTerrain = cloneGrid(terrain);
  const nextElevation = cloneGrid(elevation);
  for (const edit of edits) {
    const target = edit.layer === 'terrain' ? nextTerrain : nextElevation;
    target[edit.y][edit.x] = edit.value && typeof edit.value === 'object'
      ? { ...edit.value }
      : edit.value;
  }
  return deepFreeze({
    terrain: nextTerrain,
    elevation: nextElevation,
    edits: edits.map(edit => ({ ...edit }))
  });
}

function createObstacleGrid(obstacles, width, height) {
  const result = Array.from({ length: height }, () => Array(width).fill(null));
  const assign = obstacle => {
    if (!obstacle) return;
    const blocking = obstacle.blocking ?? obstacle.passable === false;
    return { ...obstacle, passable: !blocking };
  };
  if (obstacles == null) return result;
  if (Array.isArray(obstacles) && obstacles.length === height &&
      obstacles.every(row => Array.isArray(row) && row.length === width)) {
    return obstacles.map(row => row.map(assign));
  }
  if (!Array.isArray(obstacles)) throw new TypeError('obstacles must be records or a grid');
  for (const obstacle of obstacles) {
    if (!Number.isInteger(obstacle?.x) || !Number.isInteger(obstacle?.y) ||
        obstacle.x < 0 || obstacle.x >= width || obstacle.y < 0 || obstacle.y >= height) {
      throw new RangeError('Obstacle coordinates must be in bounds');
    }
    if (result[obstacle.y][obstacle.x]) {
      throw new SpawnIntegrationError(
        'OBSTACLE_OVERLAP',
        `Multiple obstacles occupy ${obstacle.x},${obstacle.y}`
      );
    }
    result[obstacle.y][obstacle.x] = assign(obstacle);
  }
  return result;
}

function directionBetween(from, to) {
  const direction = DIRECTIONS.find(
    item => from.x + item.dx === to.x && from.y + item.dy === to.y
  );
  if (!direction) {
    throw new SpawnIntegrationError(
      'INVALID_ELEVATION_CONNECTION',
      'Elevation connections must join cardinally adjacent cells',
      { from, to }
    );
  }
  return direction;
}

function createConnectionGrid(connections, width, height) {
  if (connections == null) {
    return Array.from({ length: height }, () => Array(width).fill(null));
  }
  if (Array.isArray(connections) && connections.length === height &&
      connections.every(row => Array.isArray(row) && row.length === width)) {
    return connections;
  }
  if (!Array.isArray(connections)) {
    throw new TypeError('elevationConnections must be records or a grid');
  }
  const result = Array.from(
    { length: height },
    () => Array.from({ length: width }, () => ({}))
  );
  for (const connection of connections) {
    const from = connection?.from;
    const to = connection?.to;
    if (!from || !to || from.x < 0 || from.x >= width || from.y < 0 ||
        from.y >= height || to.x < 0 || to.x >= width || to.y < 0 ||
        to.y >= height) {
      throw new RangeError('Elevation connection coordinates must be in bounds');
    }
    const direction = directionBetween(from, to);
    const value = {
      type: connection.kind ?? connection.type,
      levels: Math.max(1, Math.round(Math.abs(connection.elevationDelta ?? 1)))
    };
    result[from.y][from.x][direction.name] = value;
    if (connection.bidirectional) {
      result[to.y][to.x][direction.opposite] = value;
    }
  }
  return result;
}

function createAuthoritativeView({
  terrain,
  elevation,
  elevationConnections,
  obstacles,
  units
}) {
  const height = terrain.length;
  const width = terrain[0].length;
  const materialGrid = terrain.map(row => row.map(cell => {
    const material = materialOf(cell);
    if (typeof material !== 'string' || material.length === 0) {
      throw new TypeError('Every terrain cell must resolve a material');
    }
    return material;
  }));
  const obstacleGrid = createObstacleGrid(obstacles, width, height);
  const connectionGrid = createConnectionGrid(elevationConnections, width, height);
  return createTraversalView({
    terrain: materialGrid,
    elevation,
    elevationConnections: connectionGrid,
    obstacles: obstacleGrid,
    units,
    dimensions: { width, height },
    movementPolicy: {
      canTraverseTerrain({ to, terrainCost }) {
        const cell = terrain[to.y][to.x];
        return cell?.passable !== false &&
          Number.isFinite(movementCostOf(cell, terrainCost));
      },
      getStepCost({ to, elevationCost, terrainCost }) {
        return movementCostOf(terrain[to.y][to.x], terrainCost) + elevationCost;
      }
    }
  });
}

function canOccupy(view, point) {
  if (!isWithinTraversalBounds(view, point) || getTraversalOccupant(view, point)) {
    return false;
  }
  for (const direction of DIRECTIONS) {
    const neighbor = { x: point.x + direction.dx, y: point.y + direction.dy };
    if (!isWithinTraversalBounds(view, neighbor)) continue;
    if (canEnterTile(view, neighbor, point, { goal: point })) {
      return true;
    }
  }
  return false;
}

function assertCoreFlatAndClear(view, mask, label) {
  let level = null;
  let count = 0;
  for (let y = 0; y < mask.length; y++) {
    for (let x = 0; x < mask[y].length; x++) {
      if (!mask[y][x]) continue;
      count++;
      const point = { x, y };
      if (!canOccupy(view, point)) {
        throw new SpawnIntegrationError(
          'PROTECTED_CORE_BLOCKED',
          `${label} protected core is not clear at ${x},${y}`,
          { side: label, x, y }
        );
      }
      const current = discretizeElevation(view.elevation[y][x]);
      if (level === null) level = current;
      if (current !== level) {
        throw new SpawnIntegrationError(
          'PROTECTED_CORE_NOT_FLAT',
          `${label} protected core spans multiple elevation levels`,
          { side: label, expected: level, actual: current, x, y }
        );
      }
    }
  }
  if (count === 0) {
    throw new SpawnIntegrationError(
      'PROTECTED_CORE_EMPTY',
      `${label} protected core contains no cells`
    );
  }
}

function pointsFromRoutes(routes) {
  const points = [];
  const records = Array.isArray(routes)
    ? routes
    : routes?.features ?? routes?.routes ?? [];
  for (const route of records) {
    const sequence = route?.centerline ??
      route?.feature?.centerline ??
      route?.path ??
      route?.cells ??
      route;
    if (!Array.isArray(sequence)) continue;
    for (const point of sequence) {
      if (Number.isInteger(point?.x) && Number.isInteger(point?.y)) points.push(point);
    }
  }
  return points;
}

function minimumManhattan(point, targets, fallback) {
  if (targets.length === 0) return fallback;
  let minimum = Infinity;
  for (const target of targets) {
    minimum = Math.min(minimum, Math.abs(point.x - target.x) + Math.abs(point.y - target.y));
  }
  return minimum;
}

function compareTuple(left, right) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function scoreCandidate({
  candidate,
  strategy,
  routePoints,
  playerSlots,
  selected,
  elevation,
  preferred
}) {
  const routeDistance = minimumManhattan(candidate, routePoints, 0);
  const playerDistance = minimumManhattan(candidate, playerSlots, 0);
  const spacing = minimumManhattan(candidate, selected, playerDistance);
  const level = discretizeElevation(elevation[candidate.y][candidate.x]);
  const stable = [candidate.y, candidate.x];
  switch (strategy) {
    case 'formation':
      return [preferred ? 0 : 1, -spacing, ...stable];
    case 'balanced':
      return [-spacing, preferred ? 0 : 1, routeDistance, -playerDistance, ...stable];
    case 'aggressive':
      return [playerDistance, routeDistance, preferred ? 0 : 1, -spacing, ...stable];
    case 'ranged':
      return [-level, -playerDistance, -spacing, preferred ? 0 : 1, ...stable];
    case 'ambush':
      return [-routeDistance, -playerDistance, -spacing, preferred ? 0 : 1, ...stable];
    default:
      throw new TypeError(`Unsupported enemy spawn strategy: ${strategy}`);
  }
}

function collectCandidates(
  spawnLayout,
  strategy,
  view,
  reserved,
  reachable
) {
  const mask = spawnLayout.strategyMasks?.enemyCandidates;
  const staging = spawnLayout.strategyMasks?.enemyStaging;
  const preferred = new Set(
    spawnLayout.enemyCandidateSlots.map(slot => keyOf(slot))
  );
  const result = [];
  for (let y = 0; y < mask.length; y++) {
    for (let x = 0; x < mask[y].length; x++) {
      const allowed = mask[y][x] || (strategy !== 'formation' && staging?.[y]?.[x]);
      const point = { x, y };
      if (!allowed || reserved.has(keyOf(point)) || !canOccupy(view, point)) continue;
      if (reachable && !reachable.has(keyOf(point))) continue;
      result.push({ ...point, preferred: preferred.has(keyOf(point)) });
    }
  }
  return result;
}

function boundsForMask(mask) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let capacity = 0;
  for (let y = 0; y < mask.length; y++) {
    for (let x = 0; x < mask[y].length; x++) {
      if (!mask[y][x]) continue;
      capacity++;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (capacity === 0) {
    throw new SpawnIntegrationError('EMPTY_SPAWN_MASK', 'Spawn mask contains no cells');
  }
  return { bounds: { minX, minY, maxX, maxY }, capacity };
}

function publicSide(spawnLayout, side) {
  if (spawnLayout.orientation === 'north-south') {
    return side === spawnLayout.playerSide ? 'arena_north' : 'arena_south';
  }
  return side === spawnLayout.playerSide ? 'player' : 'enemy';
}

function serializeSpawnLayout(spawnLayout, selectedEnemySlots, strategy) {
  const playerSide = publicSide(spawnLayout, spawnLayout.playerSide);
  const enemySide = publicSide(spawnLayout, spawnLayout.enemySide);
  const playerCore = boundsForMask(spawnLayout.playerCoreMask);
  const enemyCore = boundsForMask(spawnLayout.enemyCoreMask);
  const playerFeather = boundsForMask(
    spawnLayout.protectedZones.find(zone => zone.id === 'player-feather').mask
  );
  const enemyFeather = boundsForMask(
    spawnLayout.protectedZones.find(zone => zone.id === 'enemy-feather').mask
  );
  const playerStaging = boundsForMask(spawnLayout.strategyMasks.playerStaging);
  const enemyStaging = boundsForMask(spawnLayout.strategyMasks.enemyStaging);
  const zoneIds = new Map([
    ['player', 'zone:player-core'],
    ['enemy', 'zone:enemy-core']
  ]);
  return {
    slots: [
      ...spawnLayout.playerSlots.map((slot, index) => ({
        id: `spawn:player-${String(index + 1).padStart(2, '0')}`,
        side: playerSide,
        role: 'formation',
        x: slot.x,
        y: slot.y,
        selected: true
      })),
      ...selectedEnemySlots.map((slot, index) => ({
        id: `spawn:enemy-${String(index + 1).padStart(2, '0')}`,
        side: enemySide,
        role: strategy,
        x: slot.x,
        y: slot.y,
        selected: true
      }))
    ],
    protectedZones: [
      {
        id: zoneIds.get('player'),
        kind: 'core',
        side: playerSide,
        bounds: playerCore.bounds,
        minimumClearance: spawnLayout.resolvedCoreRadius
      },
      {
        id: zoneIds.get('enemy'),
        kind: 'core',
        side: enemySide,
        bounds: enemyCore.bounds,
        minimumClearance: spawnLayout.resolvedCoreRadius
      },
      {
        id: 'zone:player-feather',
        kind: 'feather',
        side: playerSide,
        bounds: playerFeather.bounds,
        minimumClearance: spawnLayout.featherRadius
      },
      {
        id: 'zone:enemy-feather',
        kind: 'feather',
        side: enemySide,
        bounds: enemyFeather.bounds,
        minimumClearance: spawnLayout.featherRadius
      }
    ],
    stagingRegions: [
      {
        id: 'staging:player',
        side: playerSide,
        strategy: 'formation',
        bounds: playerStaging.bounds,
        capacity: playerStaging.capacity
      },
      {
        id: 'staging:enemy',
        side: enemySide,
        strategy,
        bounds: enemyStaging.bounds,
        capacity: enemyStaging.capacity
      }
    ],
    exits: spawnLayout.exits.map(exit => {
      const playerExit = exit.side === spawnLayout.playerSide;
      return {
        id: `exit:${playerExit ? 'player' : 'enemy'}-${exit.id.split('-').at(-1)}`,
        zoneId: zoneIds.get(playerExit ? 'player' : 'enemy'),
        x: exit.x,
        y: exit.y
      };
    }),
    minimumApproachExits: spawnLayout.exits.filter(
      exit => exit.side === spawnLayout.playerSide
    ).length
  };
}

/**
 * Resolve actual player/enemy positions against finalized gameplay layers.
 * This function never clears a strip or mutates an input. Any boundary
 * conditioning is represented by explicit spawn-feather-cell edits.
 */
export function integrateActualSpawns({
  spawnLayout,
  terrain,
  elevation,
  elevationConnections = [],
  obstacles = [],
  routes = [],
  enemyCount,
  enemyStrategy = 'formation',
  existingUnits = [],
  featherEdits = []
}) {
  if (!spawnLayout || typeof spawnLayout !== 'object') {
    throw new TypeError('spawnLayout is required');
  }
  if (!V2_ENEMY_SPAWN_STRATEGIES.includes(enemyStrategy)) {
    throw new TypeError(`Unsupported enemy spawn strategy: ${enemyStrategy}`);
  }
  if (!Number.isInteger(enemyCount) || enemyCount < 1 ||
      enemyCount > spawnLayout.enemyCapacity) {
    throw new RangeError(
      `enemyCount must be an integer from 1 to ${spawnLayout.enemyCapacity}`
    );
  }
  if (!Array.isArray(existingUnits)) throw new TypeError('existingUnits must be an array');
  const feathered = applySpawnFeatherEdits({
    spawnLayout,
    terrain,
    elevation,
    edits: featherEdits
  });
  const { width, height } = assertRectangularGrid(feathered.terrain, 'terrain');
  if (spawnLayout.coreMask?.length !== height ||
      spawnLayout.coreMask?.[0]?.length !== width) {
    throw new TypeError('spawnLayout dimensions must match terrain');
  }
  const view = createAuthoritativeView({
    terrain: feathered.terrain,
    elevation: feathered.elevation,
    elevationConnections,
    obstacles,
    units: existingUnits
  });

  assertCoreFlatAndClear(view, spawnLayout.playerCoreMask, 'player');
  assertCoreFlatAndClear(view, spawnLayout.enemyCoreMask, 'enemy');
  for (const slot of spawnLayout.playerSlots) {
    if (!canOccupy(view, slot)) {
      throw new SpawnIntegrationError(
        'INVALID_PLAYER_SPAWN',
        `Player spawn ${slot.id} is not traversable and unoccupied`,
        { slot }
      );
    }
  }
  for (const exit of spawnLayout.exits) {
    if (!canOccupy(view, exit)) {
      throw new SpawnIntegrationError(
        'INVALID_APPROACH_EXIT',
        `Approach exit ${exit.id} is not traversable and unoccupied`,
        { exit }
      );
    }
  }

  const reserved = new Set(spawnLayout.playerSlots.map(keyOf));
  const routePoints = pointsFromRoutes(routes);
  const connectivityTargets = spawnLayout.exits.filter(
    exit => exit.side === spawnLayout.playerSide
  );
  const reachable = connectivityTargets.length === 0
    ? null
    : new Set(connectivityTargets.flatMap(start => [
      keyOf(start),
      ...getReachableTilesForTraversal(view, { start, range: Infinity }).map(keyOf)
    ]));
  const candidates = collectCandidates(
    spawnLayout,
    enemyStrategy,
    view,
    reserved,
    reachable
  );
  const selected = [];
  while (selected.length < enemyCount) {
    const available = candidates.filter(candidate => !reserved.has(keyOf(candidate)));
    available.sort((left, right) => compareTuple(
      scoreCandidate({
        candidate: left,
        strategy: enemyStrategy,
        routePoints,
        playerSlots: spawnLayout.playerSlots,
        selected,
        elevation: feathered.elevation,
        preferred: left.preferred
      }),
      scoreCandidate({
        candidate: right,
        strategy: enemyStrategy,
        routePoints,
        playerSlots: spawnLayout.playerSlots,
        selected,
        elevation: feathered.elevation,
        preferred: right.preferred
      })
    ));
    const next = available[0];
    if (!next) {
      throw new SpawnIntegrationError(
        'INSUFFICIENT_VALID_ENEMY_SPAWNS',
        `Strategy ${enemyStrategy} found ${selected.length} of ${enemyCount} required enemy spawns`,
        { enemyCount, selectedCount: selected.length, strategy: enemyStrategy }
      );
    }
    const point = { x: next.x, y: next.y };
    selected.push(point);
    reserved.add(keyOf(point));
  }

  const actual = [...spawnLayout.playerSlots, ...selected];
  for (const point of actual) {
    if (!canOccupy(view, point)) {
      throw new SpawnIntegrationError(
        'INVALID_ACTUAL_SPAWN',
        `Selected spawn ${point.x},${point.y} failed authoritative traversal`,
        { point }
      );
    }
  }
  const reservationMask = Array.from(
    { length: height },
    (_, y) => Array.from({ length: width }, (_, x) => reserved.has(`${x},${y}`))
  );
  const serializedSpawnLayout = serializeSpawnLayout(
    spawnLayout,
    selected,
    enemyStrategy
  );
  return deepFreeze({
    terrain: feathered.terrain,
    elevation: feathered.elevation,
    elevationConnections,
    obstacles,
    spawnLayout: serializedSpawnLayout,
    selectedPlayerSlots: spawnLayout.playerSlots.map(({ x, y }) => ({ x, y })),
    selectedEnemySlots: selected,
    reservedPositions: actual.map(({ x, y }) => ({ x, y })),
    reservationMask,
    featherEdits: feathered.edits,
    strategy: enemyStrategy,
    traversalView: view
  });
}
