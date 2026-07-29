/**
 * Authoritative runtime traversal.
 *
 * This module intentionally accepts one object-shaped TraversalView so every
 * runtime consumer evaluates the same terrain, obstacle, elevation, and unit
 * layers. Legacy positional pathfinding functions remain in pathfinding.js.
 */

import {
  ELEVATION_RULES,
  canTraverseElevation,
  discretizeElevation,
  getTerrainMovementCost
} from './terrain.js';
import { isBlockingObstacle } from './obstacles.js';

const CARDINAL_STEPS = Object.freeze([
  Object.freeze({ dx: -1, dy: 0, direction: 'w' }),
  Object.freeze({ dx: 1, dy: 0, direction: 'e' }),
  Object.freeze({ dx: 0, dy: -1, direction: 'n' }),
  Object.freeze({ dx: 0, dy: 1, direction: 's' })
]);

const SPECIAL_RAMP_CONNECTIONS = new Set(['slope', 'long_ramp', 'multi_stairs']);

export const DEFAULT_MOVEMENT_POLICY = Object.freeze({
  allowOccupiedGoal: false,
  ignoreUnits: false,
  ignoreObstacles: false,
  maxClimb: ELEVATION_RULES.MAX_CLIMB,
  maxDrop: ELEVATION_RULES.MAX_DROP
});

const POLICY_HOOKS = Object.freeze([
  'canTraverseTerrain',
  'canTraverseObstacle',
  'canTraverseOccupant',
  'canTraverseElevation',
  'canEnterTile',
  'getStepCost'
]);

function assertGrid(name, grid, width, height, { nullable = false } = {}) {
  if (nullable && grid == null) return;
  if (!Array.isArray(grid) || grid.length !== height) {
    throw new TypeError(`${name} must be a row-major grid with ${height} rows`);
  }
  for (let y = 0; y < height; y++) {
    if (!Array.isArray(grid[y]) || grid[y].length !== width) {
      throw new TypeError(`${name}[${y}] must contain ${width} columns`);
    }
  }
}

function assertPoint(name, point) {
  if (!point || !Number.isInteger(point.x) || !Number.isInteger(point.y)) {
    throw new TypeError(`${name} must contain integer x and y coordinates`);
  }
}

function resolvePolicy(policy = {}) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new TypeError('movementPolicy must be an object');
  }
  if (policy.allowOccupiedGoal !== undefined &&
      typeof policy.allowOccupiedGoal !== 'boolean') {
    throw new TypeError('movementPolicy.allowOccupiedGoal must be a boolean');
  }
  if (policy.ignoreUnits !== undefined && typeof policy.ignoreUnits !== 'boolean') {
    throw new TypeError('movementPolicy.ignoreUnits must be a boolean');
  }
  if (policy.ignoreObstacles !== undefined &&
      typeof policy.ignoreObstacles !== 'boolean') {
    throw new TypeError('movementPolicy.ignoreObstacles must be a boolean');
  }
  for (const limit of ['maxClimb', 'maxDrop']) {
    if (policy[limit] !== undefined &&
        (!Number.isFinite(policy[limit]) || policy[limit] < 0)) {
      throw new TypeError(`movementPolicy.${limit} must be a non-negative number`);
    }
  }
  for (const hook of POLICY_HOOKS) {
    if (policy[hook] !== undefined && typeof policy[hook] !== 'function') {
      throw new TypeError(`movementPolicy.${hook} must be a function`);
    }
  }
  return Object.freeze({ ...DEFAULT_MOVEMENT_POLICY, ...policy });
}

/**
 * Validate and normalize a TraversalView.
 *
 * Optional layers are represented explicitly as null (or [] for units), which
 * keeps callers from accidentally omitting a gameplay layer.
 */
export function createTraversalView({
  terrain,
  obstacles = null,
  elevation = null,
  elevationConnections = null,
  units = [],
  dimensions,
  movementPolicy = {}
} = {}) {
  if (!dimensions || !Number.isInteger(dimensions.width) ||
      !Number.isInteger(dimensions.height) ||
      dimensions.width <= 0 || dimensions.height <= 0) {
    throw new TypeError('dimensions must contain positive integer width and height');
  }

  const { width, height } = dimensions;
  assertGrid('terrain', terrain, width, height);
  assertGrid('obstacles', obstacles, width, height, { nullable: true });
  assertGrid('elevation', elevation, width, height, { nullable: true });
  assertGrid(
    'elevationConnections',
    elevationConnections,
    width,
    height,
    { nullable: true }
  );

  if (!Array.isArray(units)) {
    throw new TypeError('units must be an array');
  }

  return Object.freeze({
    terrain,
    obstacles,
    elevation,
    elevationConnections,
    units,
    dimensions: Object.freeze({ width, height }),
    movementPolicy: resolvePolicy(movementPolicy)
  });
}

/**
 * Validate an existing TraversalView. The normalized value is returned so the
 * function can be used at module boundaries.
 */
export function validateTraversalView(view) {
  return createTraversalView(view);
}

export function isWithinTraversalBounds(view, point) {
  assertPoint('point', point);
  const { width, height } = view.dimensions;
  return point.x >= 0 && point.y >= 0 && point.x < width && point.y < height;
}

export function getTraversalOccupant(view, point, { exclude } = {}) {
  for (const unit of view.units) {
    const unitX = unit?.tileX ?? unit?.gridX ?? unit?.x;
    const unitY = unit?.tileY ?? unit?.gridY ?? unit?.y;
    if (exclude && unitX === exclude.x && unitY === exclude.y) continue;
    if (unitX === point.x && unitY === point.y) return unit;
  }
  return null;
}

export function getElevationConnection(view, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const step = CARDINAL_STEPS.find(candidate =>
    candidate.dx === dx && candidate.dy === dy
  );
  if (!step) return null;
  return view.elevationConnections?.[from.y]?.[from.x]?.[step.direction] ?? null;
}

function getElevationAt(view, point) {
  return discretizeElevation(view.elevation?.[point.y]?.[point.x] ?? 0);
}

function getConnectionCost(connection, baseCost) {
  if (!connection) return baseCost;
  switch (connection.type) {
    case 'slope':
    case 'long_ramp':
      return Math.ceil((connection.levels || 1) * 0.5);
    case 'multi_stairs':
      return connection.levels || 1;
    default:
      return baseCost;
  }
}

function resolveHook(hook, context, fallback) {
  if (!hook) return fallback;
  const result = hook(context);
  return result === undefined ? fallback : result;
}

function evaluateStep(view, from, to, {
  goal = null,
  start = from
} = {}) {
  assertPoint('from', from);
  assertPoint('to', to);
  if (!isWithinTraversalBounds(view, from) || !isWithinTraversalBounds(view, to)) {
    return { canEnter: false, cost: Infinity, reason: 'out_of_bounds' };
  }
  if (Math.abs(to.x - from.x) + Math.abs(to.y - from.y) !== 1) {
    return { canEnter: false, cost: Infinity, reason: 'non_cardinal_step' };
  }

  const policy = view.movementPolicy;
  const terrain = view.terrain[to.y][to.x] ?? 'grass';
  const terrainCost = getTerrainMovementCost(terrain);
  const obstacle = view.obstacles?.[to.y]?.[to.x] ?? null;
  const occupant = policy.ignoreUnits
    ? null
    : getTraversalOccupant(view, to, { exclude: start });
  const isGoal = Boolean(goal && goal.x === to.x && goal.y === to.y);
  const connection = getElevationConnection(view, from, to);
  const fromElevation = getElevationAt(view, from);
  const toElevation = getElevationAt(view, to);
  const effectiveConnectionType = SPECIAL_RAMP_CONNECTIONS.has(connection?.type)
    ? 'ramp'
    : connection?.type ?? null;
  const elevationTraversal = canTraverseElevation(
    fromElevation,
    toElevation,
    effectiveConnectionType,
    { maxClimb: policy.maxClimb, maxDrop: policy.maxDrop }
  );

  const context = {
    view,
    from,
    to,
    start,
    goal,
    isGoal,
    terrain,
    terrainCost,
    obstacle,
    occupant,
    connection,
    fromElevation,
    toElevation,
    elevationTraversal
  };

  const terrainPassable = resolveHook(
    policy.canTraverseTerrain,
    context,
    Number.isFinite(terrainCost)
  );
  if (!terrainPassable) {
    return { canEnter: false, cost: Infinity, reason: 'terrain', context };
  }

  const obstaclePassable = policy.ignoreObstacles || resolveHook(
    policy.canTraverseObstacle,
    context,
    !isBlockingObstacle(obstacle)
  );
  if (!obstaclePassable) {
    return { canEnter: false, cost: Infinity, reason: 'obstacle', context };
  }

  const occupantPassable = !occupant || resolveHook(
    policy.canTraverseOccupant,
    context,
    isGoal && policy.allowOccupiedGoal
  );
  if (!occupantPassable) {
    return { canEnter: false, cost: Infinity, reason: 'occupied', context };
  }

  const elevationPassable = resolveHook(
    policy.canTraverseElevation,
    context,
    elevationTraversal.canTraverse
  );
  if (!elevationPassable) {
    return { canEnter: false, cost: Infinity, reason: 'elevation', context };
  }

  const canEnter = resolveHook(policy.canEnterTile, context, true);
  if (!canEnter) {
    return { canEnter: false, cost: Infinity, reason: 'policy', context };
  }

  const elevationCost = getConnectionCost(connection, elevationTraversal.moveCost);
  const defaultCost = terrainCost + elevationCost;
  const cost = resolveHook(
    policy.getStepCost,
    { ...context, elevationCost, defaultCost },
    defaultCost
  );
  if (!Number.isFinite(cost) || cost < 0) {
    return { canEnter: false, cost: Infinity, reason: 'cost', context };
  }

  return { canEnter: true, cost, reason: null, context };
}

/**
 * Return whether one cardinal step can enter a tile.
 */
export function canEnterTile(view, from, to, options = {}) {
  return evaluateStep(view, from, to, options).canEnter;
}

/**
 * Return the complete cost of one cardinal step, or Infinity when blocked.
 */
export function getStepCost(view, from, to, options = {}) {
  return evaluateStep(view, from, to, options).cost;
}

function positionKey(point) {
  return `${point.x},${point.y}`;
}

function validateSearch(view, start, goal, maxCost) {
  assertPoint('start', start);
  if (goal) assertPoint('goal', goal);
  if (!isWithinTraversalBounds(view, start) ||
      (goal && !isWithinTraversalBounds(view, goal))) {
    throw new RangeError('start and goal must be within traversal dimensions');
  }
  if (typeof maxCost !== 'number' || Number.isNaN(maxCost) || maxCost < 0) {
    throw new TypeError('maxCost/range must be a non-negative number');
  }
}

function searchTraversal(view, { start, goal = null, maxCost = Infinity }) {
  validateSearch(view, start, goal, maxCost);
  const costs = new Map([[positionKey(start), 0]]);
  const parents = new Map();
  const visited = new Set();
  const queue = [{ x: start.x, y: start.y, cost: 0 }];

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();
    const currentKey = positionKey(current);
    if (visited.has(currentKey)) continue;
    visited.add(currentKey);

    if (goal && current.x === goal.x && current.y === goal.y) {
      break;
    }

    for (const step of CARDINAL_STEPS) {
      const neighbor = { x: current.x + step.dx, y: current.y + step.dy };
      const stepCost = getStepCost(view, current, neighbor, { start, goal });
      if (!Number.isFinite(stepCost)) continue;

      const newCost = current.cost + stepCost;
      const key = positionKey(neighbor);
      if (newCost <= maxCost && (!costs.has(key) || newCost < costs.get(key))) {
        costs.set(key, newCost);
        parents.set(key, currentKey);
        queue.push({ ...neighbor, cost: newCost });
      }
    }
  }

  return { costs, parents };
}

/**
 * Dijkstra reachability for a TraversalView.
 */
export function getReachableTilesForTraversal(view, { start, range }) {
  const { costs } = searchTraversal(view, { start, maxCost: range });
  const startKey = positionKey(start);
  const reachable = [];
  for (const [key, cost] of costs) {
    if (key === startKey) continue;
    const [x, y] = key.split(',').map(Number);
    reachable.push({ x, y, z: getElevationAt(view, { x, y }), cost });
  }
  return reachable;
}

/**
 * Minimum path cost for a TraversalView.
 */
export function calculateTraversalPathCost(view, {
  start,
  goal,
  maxCost = Infinity
}) {
  const { costs } = searchTraversal(view, { start, goal, maxCost });
  return costs.get(positionKey(goal)) ?? Infinity;
}

/**
 * Minimum-cost path for a TraversalView, including start and goal.
 */
export function findTraversalPath(view, {
  start,
  goal,
  maxCost = Infinity
}) {
  const { costs, parents } = searchTraversal(view, { start, goal, maxCost });
  const goalKey = positionKey(goal);
  if (!costs.has(goalKey)) return null;

  const path = [];
  let key = goalKey;
  while (key) {
    const [x, y] = key.split(',').map(Number);
    path.unshift({ x, y, z: getElevationAt(view, { x, y }) });
    if (key === positionKey(start)) break;
    key = parents.get(key);
  }
  return path;
}

