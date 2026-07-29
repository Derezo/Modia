import {
  canEnterTile,
  validateTraversalView
} from '../../traversal.js';
import { createDistanceToBlockerField } from './Validation.js';
import {
  V2_QUANTIZATION_SCALE,
  coordinateHash32,
  deriveStreamSeed
} from './Determinism.js';
import { defineTypedRepair } from './TypedRepair.js';
import { deepFreeze } from './V2Context.js';

const SCALE = V2_QUANTIZATION_SCALE;
const NO_HEADING = 4;
const DIRECTIONS = Object.freeze([
  Object.freeze({ dx: 0, dy: -1, name: 'n', index: 0 }),
  Object.freeze({ dx: 1, dy: 0, name: 'e', index: 1 }),
  Object.freeze({ dx: 0, dy: 1, name: 's', index: 2 }),
  Object.freeze({ dx: -1, dy: 0, name: 'w', index: 3 })
]);

export const ROUTE_PLANNER_VERSION = 'least-cost-routes-v1';

export const DEFAULT_ROUTE_COST_MODEL = Object.freeze({
  baseCost: 1000,
  slopePenalty: 1800,
  waterPenalty: 6000,
  bankPenalty: 500,
  roughnessPenalty: 900,
  protectedPenalty: 0,
  headingChangePenalty: 400,
  preferredBonus: 250,
  crossingBonus: 200,
  minimumStepCost: 1,
  scoreCurvature: true,
  heuristic: 'manhattan'
});

export class RoutePlanningError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RoutePlanningError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function pointKey(point) {
  return `${point.x},${point.y}`;
}

function comparePoints(left, right) {
  return left.y - right.y || left.x - right.x;
}

function compareIds(left, right) {
  return String(left).localeCompare(String(right));
}

function assertPoint(point, name, width, height) {
  if (!Number.isInteger(point?.x) || !Number.isInteger(point?.y)) {
    throw new TypeError(`${name} must contain integer x and y coordinates`);
  }
  if (point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) {
    throw new RangeError(`${name} is outside the ${width}x${height} route grid`);
  }
}

function assertGrid(grid, name, width, height, { optional = true } = {}) {
  if (optional && grid == null) return;
  if (!Array.isArray(grid) || grid.length !== height) {
    throw new TypeError(`${name} must contain ${height} rows`);
  }
  for (let y = 0; y < height; y++) {
    if (!Array.isArray(grid[y]) || grid[y].length !== width) {
      throw new TypeError(`${name}[${y}] must contain ${width} columns`);
    }
  }
}

function booleanGrid(width, height) {
  return Array.from({ length: height }, () => Array(width).fill(false));
}

function integerGrid(width, height) {
  return Array.from({ length: height }, () => Array(width).fill(0));
}

function normalizeInteger(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${name} must be a safe integer >= ${minimum}`);
  }
  return value;
}

export function resolveRouteCostModel(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('route cost model must be an object');
  }
  const model = { ...DEFAULT_ROUTE_COST_MODEL, ...value };
  for (const name of [
    'baseCost',
    'slopePenalty',
    'waterPenalty',
    'bankPenalty',
    'roughnessPenalty',
    'protectedPenalty',
    'headingChangePenalty',
    'preferredBonus',
    'crossingBonus'
  ]) {
    normalizeInteger(model[name], `route cost ${name}`);
  }
  normalizeInteger(model.minimumStepCost, 'route cost minimumStepCost', 1);
  if (typeof model.scoreCurvature !== 'boolean') {
    throw new TypeError('route cost scoreCurvature must be a boolean');
  }
  if (!['manhattan', 'dijkstra'].includes(model.heuristic)) {
    throw new TypeError('route cost heuristic must be manhattan or dijkstra');
  }
  return Object.freeze(model);
}

function maskFromCandidates(candidates, width, height) {
  const mask = booleanGrid(width, height);
  if (candidates == null) return mask;
  if (Array.isArray(candidates) &&
      candidates.length === height &&
      candidates.every(row => Array.isArray(row) && row.length === width)) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) mask[y][x] = Boolean(candidates[y][x]);
    }
    return mask;
  }
  if (!Array.isArray(candidates)) {
    throw new TypeError('hydrology.crossingCandidates must be a grid or array');
  }
  for (const candidate of candidates) {
    const cells = candidate?.cells ?? (candidate?.cell ? [candidate.cell] : [candidate]);
    for (const point of cells) {
      if (!Number.isInteger(point?.x) || !Number.isInteger(point?.y)) continue;
      if (point.x >= 0 && point.y >= 0 && point.x < width && point.y < height) {
        mask[point.y][point.x] = true;
      }
    }
  }
  return mask;
}

function normalizeWorkingSet({
  traversalView,
  dimensions,
  fields = {},
  hydrology = {},
  spawnLayout = null,
  elevationLevels = null,
  preferredMask = null,
  requiredRegionGrid = null,
  connectionCandidates = []
}) {
  const view = traversalView ? validateTraversalView(traversalView) : null;
  const resolvedDimensions = view?.dimensions ?? dimensions;
  if (!Number.isInteger(resolvedDimensions?.width) ||
      !Number.isInteger(resolvedDimensions?.height) ||
      resolvedDimensions.width <= 0 ||
      resolvedDimensions.height <= 0) {
    throw new TypeError('route planning requires traversalView or positive dimensions');
  }
  const { width, height } = resolvedDimensions;
  const roughness = fields.roughness ?? null;
  const waterMask = hydrology.waterMask ?? null;
  const bankMask = hydrology.bankMask ?? null;
  const protectedMask = spawnLayout?.coreMask ?? null;
  assertGrid(roughness, 'fields.roughness', width, height);
  assertGrid(waterMask, 'hydrology.waterMask', width, height);
  assertGrid(bankMask, 'hydrology.bankMask', width, height);
  assertGrid(protectedMask, 'spawnLayout.coreMask', width, height);
  assertGrid(elevationLevels, 'elevationLevels', width, height);
  assertGrid(preferredMask, 'preferredMask', width, height);
  assertGrid(requiredRegionGrid, 'requiredRegionGrid', width, height);
  const crossingMask = maskFromCandidates(
    hydrology.crossingCandidates,
    width,
    height
  );
  return {
    view,
    width,
    height,
    roughness,
    waterMask,
    bankMask,
    crossingMask,
    protectedMask,
    elevationLevels,
    preferredMask,
    requiredRegionGrid,
    connectionCandidates
  };
}

function isMaskSet(mask, point) {
  return Boolean(mask?.[point.y]?.[point.x]);
}

function elevationAt(working, point) {
  return working.elevationLevels?.[point.y]?.[point.x] ?? 0;
}

function roughnessCost(working, point, weight) {
  if (!working.roughness || weight === 0) return 0;
  const raw = working.roughness[point.y][point.x];
  if (!Number.isSafeInteger(raw) || raw < -SCALE || raw > SCALE) {
    throw new RoutePlanningError(
      'ROUTE_ROUGHNESS_INVALID',
      'Route roughness values must be fixed-point integers in [-1000000, 1000000]',
      { point, value: raw }
    );
  }
  return Math.floor(((raw + SCALE) * weight) / (2 * SCALE));
}

/**
 * Calculate one strictly-positive, integer route edge cost.
 *
 * Bonuses are applied last and the result is clamped to minimumStepCost, which
 * is also the Manhattan heuristic multiplier. This makes that heuristic both
 * admissible and consistent for the built-in cost terms.
 */
export function calculateRouteStepCost({
  working,
  model,
  from,
  to,
  previousHeading = NO_HEADING,
  heading
}) {
  let cost = model.baseCost;
  const slope = Math.abs(elevationAt(working, to) - elevationAt(working, from));
  cost += slope * model.slopePenalty;
  if (isMaskSet(working.waterMask, to)) cost += model.waterPenalty;
  if (isMaskSet(working.bankMask, to)) cost += model.bankPenalty;
  if (isMaskSet(working.protectedMask, to)) cost += model.protectedPenalty;
  cost += roughnessCost(working, to, model.roughnessPenalty);
  if (model.scoreCurvature &&
      previousHeading !== NO_HEADING &&
      previousHeading !== heading) {
    cost += model.headingChangePenalty;
  }
  if (isMaskSet(working.preferredMask, to)) cost -= model.preferredBonus;
  if (isMaskSet(working.crossingMask, to)) cost -= model.crossingBonus;
  return Math.max(model.minimumStepCost, cost);
}

class StableMinHeap {
  constructor(compare) {
    this.values = [];
    this.compare = compare;
  }

  get size() {
    return this.values.length;
  }

  push(value) {
    const values = this.values;
    values.push(value);
    let index = values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(values[parent], value) <= 0) break;
      values[index] = values[parent];
      index = parent;
    }
    values[index] = value;
  }

  pop() {
    const values = this.values;
    const first = values[0];
    const last = values.pop();
    if (values.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= values.length) break;
      let child = left;
      if (right < values.length && this.compare(values[right], values[left]) < 0) {
        child = right;
      }
      if (this.compare(last, values[child]) <= 0) break;
      values[index] = values[child];
      index = child;
    }
    values[index] = last;
    return first;
  }
}

function stateKey(x, y, heading, waterRun, scoreCurvature) {
  return scoreCurvature
    ? `${x},${y},${heading},${waterRun}`
    : `${x},${y},${waterRun}`;
}

function heuristic(point, goal, model, algorithm) {
  if (algorithm === 'dijkstra' || model.heuristic === 'dijkstra') return 0;
  return (
    Math.abs(point.x - goal.x) + Math.abs(point.y - goal.y)
  ) * model.minimumStepCost;
}

function compareOpen(left, right) {
  return (
    left.f - right.f ||
    left.g - right.g ||
    left.y - right.y ||
    left.x - right.x ||
    left.heading - right.heading ||
    left.waterRun - right.waterRun ||
    left.sequence - right.sequence
  );
}

function routeStepAllowed({
  working,
  from,
  to,
  start,
  goal,
  maximumSlope,
  maximumWaterCrossingLength,
  waterRun
}) {
  if (to.x < 0 || to.y < 0 || to.x >= working.width || to.y >= working.height) {
    return { allowed: false };
  }
  if (working.view && !canEnterTile(working.view, from, to, { start, goal })) {
    return { allowed: false };
  }
  if (isMaskSet(working.protectedMask, to) &&
      pointKey(to) !== pointKey(start) &&
      pointKey(to) !== pointKey(goal)) {
    return { allowed: false };
  }
  const slope = Math.abs(elevationAt(working, to) - elevationAt(working, from));
  if (slope > maximumSlope) return { allowed: false };
  const entersWater = isMaskSet(working.waterMask, to);
  if (entersWater && !isMaskSet(working.crossingMask, to)) {
    return { allowed: false };
  }
  const nextWaterRun = entersWater ? waterRun + 1 : 0;
  if (nextWaterRun > maximumWaterCrossingLength) return { allowed: false };
  return { allowed: true, waterRun: nextWaterRun };
}

function reconstructPath(cameFrom, states, goalStateKey) {
  const path = [];
  let key = goalStateKey;
  while (key) {
    const state = states.get(key);
    path.push({ x: state.x, y: state.y });
    key = cameFrom.get(key) ?? null;
  }
  return path.reverse();
}

function eraseCoordinateLoops(path) {
  const result = [];
  const indices = new Map();
  for (const point of path) {
    const key = pointKey(point);
    if (indices.has(key)) {
      const keepIndex = indices.get(key);
      for (let index = result.length - 1; index > keepIndex; index--) {
        indices.delete(pointKey(result[index]));
      }
      result.length = keepIndex + 1;
      continue;
    }
    indices.set(key, result.length);
    result.push(point);
  }
  return result;
}

function directionBetween(from, to) {
  return DIRECTIONS.find(direction =>
    from.x + direction.dx === to.x && from.y + direction.dy === to.y
  ) ?? null;
}

function centerlineIsLegal(path, options) {
  let waterRun = isMaskSet(options.working.waterMask, path[0]) ? 1 : 0;
  for (let index = 1; index < path.length; index++) {
    const permitted = routeStepAllowed({
      ...options,
      from: path[index - 1],
      to: path[index],
      waterRun
    });
    if (!permitted.allowed) return false;
    waterRun = permitted.waterRun;
  }
  return true;
}

function removeOneTileCaps(path, options) {
  let result = [...path];
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 0; index + 3 < result.length; index++) {
      const a = result[index];
      const b = result[index + 1];
      const c = result[index + 2];
      const d = result[index + 3];
      const first = directionBetween(a, b);
      const second = directionBetween(b, c);
      const third = directionBetween(c, d);
      if (!first || !second || !third ||
          first.index !== (third.index + 2) % 4 ||
          first.index === second.index ||
          first.index === (second.index + 2) % 4) {
        continue;
      }
      const allowed = routeStepAllowed({
        ...options,
        from: a,
        to: d,
        waterRun: 0
      });
      if (!allowed.allowed) continue;
      const candidate = [
        ...result.slice(0, index + 1),
        ...result.slice(index + 3)
      ];
      if (!centerlineIsLegal(candidate, options)) continue;
      result = candidate;
      changed = true;
      break;
    }
  }
  return result;
}

export function cleanupRouteCenterline(path, options) {
  if (!Array.isArray(path) || path.length < 2) {
    throw new TypeError('route centerline must contain at least two points');
  }
  const loopFree = eraseCoordinateLoops(path);
  const cleaned = removeOneTileCaps(loopFree, options);
  for (let index = 1; index < cleaned.length; index++) {
    if (!directionBetween(cleaned[index - 1], cleaned[index])) {
      throw new RoutePlanningError(
        'ROUTE_CLEANUP_DISCONNECTED',
        'Route cleanup produced a non-cardinal centerline'
      );
    }
  }
  return cleaned;
}

/**
 * Deterministic cardinal least-cost search.
 *
 * `algorithm: "astar"` uses Manhattan × minimumStepCost. Because every built-in
 * edge is clamped to that lower bound, the heuristic is consistent even when
 * bonuses and prior-heading curvature costs are enabled. `algorithm:
 * "dijkstra"` is the explicit zero-heuristic oracle mode.
 */
export function findLeastCostRoute({
  start,
  goal,
  traversalView = null,
  dimensions = null,
  fields = {},
  hydrology = {},
  spawnLayout = null,
  elevationLevels = null,
  preferredMask = null,
  requiredRegionGrid = null,
  connectionCandidates = [],
  costModel = {},
  maximumSlope = 1,
  maximumWaterCrossingLength = 4,
  algorithm = 'astar',
  cleanup = true
}) {
  if (!['astar', 'dijkstra'].includes(algorithm)) {
    throw new TypeError('route search algorithm must be astar or dijkstra');
  }
  normalizeInteger(maximumSlope, 'maximumSlope');
  normalizeInteger(
    maximumWaterCrossingLength,
    'maximumWaterCrossingLength'
  );
  const working = normalizeWorkingSet({
    traversalView,
    dimensions,
    fields,
    hydrology,
    spawnLayout,
    elevationLevels,
    preferredMask,
    requiredRegionGrid,
    connectionCandidates
  });
  assertPoint(start, 'route start', working.width, working.height);
  assertPoint(goal, 'route goal', working.width, working.height);
  if (pointKey(start) === pointKey(goal)) {
    throw new TypeError('route start and goal must be distinct coordinates');
  }
  const model = resolveRouteCostModel(costModel);
  const initialWaterRun = isMaskSet(working.waterMask, start) ? 1 : 0;
  const initialKey = stateKey(
    start.x,
    start.y,
    NO_HEADING,
    initialWaterRun,
    model.scoreCurvature
  );
  const states = new Map();
  const cameFrom = new Map();
  const best = new Map([[initialKey, 0]]);
  const queue = new StableMinHeap(compareOpen);
  let sequence = 0;
  const initial = {
    x: start.x,
    y: start.y,
    heading: NO_HEADING,
    waterRun: initialWaterRun,
    g: 0,
    f: heuristic(start, goal, model, algorithm),
    sequence: sequence++
  };
  states.set(initialKey, initial);
  queue.push(initial);
  let goalKey = null;

  while (queue.size > 0) {
    const current = queue.pop();
    const currentKey = stateKey(
      current.x,
      current.y,
      current.heading,
      current.waterRun,
      model.scoreCurvature
    );
    if (current.g !== best.get(currentKey)) continue;
    if (current.x === goal.x && current.y === goal.y) {
      goalKey = currentKey;
      break;
    }
    for (const direction of DIRECTIONS) {
      const from = { x: current.x, y: current.y };
      const to = {
        x: current.x + direction.dx,
        y: current.y + direction.dy
      };
      const permitted = routeStepAllowed({
        working,
        from,
        to,
        start,
        goal,
        maximumSlope,
        maximumWaterCrossingLength,
        waterRun: current.waterRun
      });
      if (!permitted.allowed) continue;
      const stepCost = calculateRouteStepCost({
        working,
        model,
        from,
        to,
        previousHeading: current.heading,
        heading: direction.index
      });
      if (!Number.isSafeInteger(stepCost) || stepCost < 1) {
        throw new RoutePlanningError(
          'ROUTE_COST_INVALID',
          'Every route edge cost must be a strictly positive safe integer',
          { from, to, stepCost }
        );
      }
      const nextHeading = model.scoreCurvature ? direction.index : NO_HEADING;
      const nextKey = stateKey(
        to.x,
        to.y,
        nextHeading,
        permitted.waterRun,
        model.scoreCurvature
      );
      const nextCost = current.g + stepCost;
      if (!Number.isSafeInteger(nextCost)) {
        throw new RoutePlanningError(
          'ROUTE_COST_OVERFLOW',
          'Accumulated route cost exceeds the safe integer range',
          { from, to, currentCost: current.g, stepCost }
        );
      }
      const previousCost = best.get(nextKey);
      if (previousCost !== undefined && nextCost >= previousCost) continue;
      const state = {
        x: to.x,
        y: to.y,
        heading: nextHeading,
        waterRun: permitted.waterRun,
        g: nextCost,
        f: nextCost + heuristic(to, goal, model, algorithm),
        sequence: sequence++
      };
      best.set(nextKey, nextCost);
      states.set(nextKey, state);
      cameFrom.set(nextKey, currentKey);
      queue.push(state);
    }
  }

  if (!goalKey) {
    throw new RoutePlanningError(
      'ROUTE_NOT_FOUND',
      `No legal route connects ${pointKey(start)} to ${pointKey(goal)}`,
      { start, goal }
    );
  }
  const rawPath = reconstructPath(cameFrom, states, goalKey);
  const centerline = cleanup
    ? cleanupRouteCenterline(rawPath, {
      working,
      start,
      goal,
      maximumSlope,
      maximumWaterCrossingLength
    })
    : rawPath;
  return deepFreeze({
    algorithm: algorithm === 'dijkstra' || model.heuristic === 'dijkstra'
      ? 'dijkstra'
      : 'astar',
    centerline,
    searchCost: best.get(goalKey),
    exploredStateCount: best.size,
    costModel: model
  });
}

class DisjointSet {
  constructor(ids) {
    this.parent = new Map(ids.map(id => [id, id]));
  }

  find(id) {
    let root = id;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    let current = id;
    while (this.parent.get(current) !== current) {
      const next = this.parent.get(current);
      this.parent.set(current, root);
      current = next;
    }
    return root;
  }

  union(left, right) {
    const a = this.find(left);
    const b = this.find(right);
    if (a === b) return false;
    const [parent, child] = compareIds(a, b) <= 0 ? [a, b] : [b, a];
    this.parent.set(child, parent);
    return true;
  }
}

function normalizeAnchors(anchors, width, height) {
  if (!Array.isArray(anchors) || anchors.length < 2) {
    throw new TypeError('route planning requires at least two anchors');
  }
  const ids = new Set();
  const coordinates = new Set();
  return anchors.map((anchor, index) => {
    if (typeof anchor?.id !== 'string' || anchor.id.length === 0) {
      throw new TypeError(`anchors[${index}].id must be a non-empty string`);
    }
    if (ids.has(anchor.id)) throw new TypeError(`duplicate route anchor id ${anchor.id}`);
    ids.add(anchor.id);
    assertPoint(anchor, `anchors[${index}]`, width, height);
    const coordinate = pointKey(anchor);
    if (coordinates.has(coordinate)) {
      throw new TypeError(`duplicate route anchor coordinate ${coordinate}`);
    }
    coordinates.add(coordinate);
    return {
      id: anchor.id,
      featureId: typeof anchor.featureId === 'string' ? anchor.featureId : null,
      regionId: typeof anchor.regionId === 'string' ? anchor.regionId : null,
      required: anchor.required !== false,
      x: anchor.x,
      y: anchor.y
    };
  }).sort((left, right) => compareIds(left.id, right.id));
}

function edgeId(left, right) {
  return compareIds(left, right) <= 0 ? `${left}--${right}` : `${right}--${left}`;
}

function evidenceEdges(routeAnchorEvidence, anchorIds) {
  const result = new Map();
  for (const evidence of routeAnchorEvidence ?? []) {
    const from = evidence?.fromAnchorId ?? evidence?.from;
    const to = evidence?.toAnchorId ?? evidence?.to;
    if (!anchorIds.has(from) || !anchorIds.has(to) || from === to) continue;
    const id = edgeId(from, to);
    result.set(id, {
      id,
      from: compareIds(from, to) <= 0 ? from : to,
      to: compareIds(from, to) <= 0 ? to : from,
      required: evidence.required !== false,
      loop: false,
      evidence
    });
  }
  return result;
}

/**
 * Connect anchors as a deterministic graph before carving. Evidence-declared
 * required edges are retained, then Kruskal adds a spanning tree. Constructed
 * and subterranean families receive deliberate non-tree loop edges.
 */
export function buildRouteAnchorGraph({
  anchors,
  dimensions,
  family = 'natural',
  loopCount = null,
  routeAnchorEvidence = []
}) {
  const { width, height } = dimensions ?? {};
  const nodes = normalizeAnchors(anchors, width, height);
  const byId = new Map(nodes.map(node => [node.id, node]));
  const pairs = [];
  for (let left = 0; left < nodes.length; left++) {
    for (let right = left + 1; right < nodes.length; right++) {
      const a = nodes[left];
      const b = nodes[right];
      pairs.push({
        id: edgeId(a.id, b.id),
        from: a.id,
        to: b.id,
        distance: Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
      });
    }
  }
  pairs.sort((a, b) =>
    a.distance - b.distance ||
    compareIds(a.from, b.from) ||
    compareIds(a.to, b.to)
  );
  const selected = evidenceEdges(routeAnchorEvidence, new Set(byId.keys()));
  const disjoint = new DisjointSet(nodes.map(node => node.id));
  for (const edge of [...selected.values()].sort((a, b) => compareIds(a.id, b.id))) {
    disjoint.union(edge.from, edge.to);
  }
  for (const pair of pairs) {
    if (selected.has(pair.id) || !disjoint.union(pair.from, pair.to)) continue;
    selected.set(pair.id, {
      id: pair.id,
      from: pair.from,
      to: pair.to,
      required: true,
      loop: false,
      evidence: null
    });
  }
  const wantsLoops = family === 'constructed' ||
    family === 'subterranean' ||
    family === 'arena';
  const resolvedLoopCount = loopCount == null
    ? (wantsLoops && nodes.length >= 3 ? Math.max(1, Math.floor(nodes.length / 4)) : 0)
    : normalizeInteger(loopCount, 'route loopCount');
  const loopCandidates = pairs
    .filter(pair => !selected.has(pair.id))
    .sort((a, b) =>
      b.distance - a.distance ||
      compareIds(a.from, b.from) ||
      compareIds(a.to, b.to)
    );
  for (const pair of loopCandidates.slice(0, resolvedLoopCount)) {
    selected.set(pair.id, {
      id: pair.id,
      from: pair.from,
      to: pair.to,
      required: false,
      loop: true,
      evidence: null
    });
  }
  return deepFreeze({
    nodes,
    edges: [...selected.values()].sort((a, b) =>
      Number(a.loop) - Number(b.loop) || compareIds(a.id, b.id)
    )
  });
}

function evidenceWaypoints(edge, hydrology, from, to) {
  const evidence = edge.evidence;
  if (!evidence || evidence.landOnly === true) return [];
  const requestedIds = new Set(evidence.crossingCandidateIds ?? []);
  const candidates = (hydrology.crossingCandidates ?? [])
    .filter(candidate => {
      if (requestedIds.size === 0) return true;
      return requestedIds.has(candidate?.id);
    });
  const points = [];
  for (const candidate of candidates) {
    const cells = candidate?.cells ??
      (candidate?.cell ? [candidate.cell] :
        (Number.isInteger(candidate?.x) && Number.isInteger(candidate?.y)
          ? [candidate]
          : []));
    for (const cell of cells) {
      if (Number.isInteger(cell?.x) && Number.isInteger(cell?.y)) {
        points.push({ x: cell.x, y: cell.y, id: candidate.id ?? '' });
      }
    }
  }
  points.sort((left, right) =>
    (
      Math.abs(from.x - left.x) +
      Math.abs(from.y - left.y) +
      Math.abs(to.x - left.x) +
      Math.abs(to.y - left.y)
    ) - (
      Math.abs(from.x - right.x) +
      Math.abs(from.y - right.y) +
      Math.abs(to.x - right.x) +
      Math.abs(to.y - right.y)
    ) ||
    compareIds(left.id, right.id) ||
    comparePoints(left, right)
  );
  return points.length > 0 ? [{ x: points[0].x, y: points[0].y }] : [];
}

function naturalWaypointCandidates({
  edge,
  from,
  to,
  working,
  routeSeed
}) {
  const horizontal = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);
  const directDistance = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
  if (directDistance < 8) return [];

  const midpoint = {
    x: Math.floor((from.x + to.x) / 2),
    y: Math.floor((from.y + to.y) / 2)
  };
  const maximumAmplitude = Math.min(3, Math.max(2, Math.floor(directDistance / 5)));
  const preferredSign = coordinateHash32(
    routeSeed,
    midpoint.x,
    midpoint.y,
    `${edge.id}:natural-bend`
  ) % 2 === 0 ? -1 : 1;
  const candidates = [];
  for (let amplitude = maximumAmplitude; amplitude >= 2; amplitude--) {
    for (const sign of [preferredSign, -preferredSign]) {
      const point = horizontal
        ? { x: midpoint.x, y: midpoint.y + amplitude * sign }
        : { x: midpoint.x + amplitude * sign, y: midpoint.y };
      if (
        point.x <= 0 ||
        point.y <= 0 ||
        point.x >= working.width - 1 ||
        point.y >= working.height - 1 ||
        isMaskSet(working.protectedMask, point) ||
        (
          isMaskSet(working.waterMask, point) &&
          !isMaskSet(working.crossingMask, point)
        )
      ) {
        continue;
      }
      candidates.push(point);
    }
  }
  return candidates;
}

function stitchSegments(segments) {
  const result = [];
  for (const segment of segments) {
    result.push(...segment.slice(result.length === 0 ? 0 : 1));
  }
  return result;
}

function createRouteMasks({
  centerline,
  width,
  widthVariance,
  widthChangeInterval,
  seed,
  routeId,
  working,
  anchorKeys
}) {
  const pathMask = booleanGrid(working.width, working.height);
  const centerlineMask = booleanGrid(working.width, working.height);
  const shoulderMask = booleanGrid(working.width, working.height);
  const wearMask = booleanGrid(working.width, working.height);
  const widthField = integerGrid(working.width, working.height);
  let resolvedWidth = Math.max(1, Math.round(width));
  const maximumWidth = resolvedWidth + widthVariance;
  const minimumWidth = Math.max(1, resolvedWidth - widthVariance);
  const sideBias = coordinateHash32(seed, 0, 0, `${routeId}:width-side`) % 2 === 0
    ? -1
    : 1;

  for (let index = 0; index < centerline.length; index++) {
    const point = centerline[index];
    if (index > 0 && index % widthChangeInterval === 0 && widthVariance > 0) {
      const choice = coordinateHash32(seed, point.x, point.y, `${routeId}:width`) % 3;
      resolvedWidth = Math.max(
        minimumWidth,
        Math.min(maximumWidth, resolvedWidth + choice - 1)
      );
    }
    centerlineMask[point.y][point.x] = true;
    const previous = centerline[Math.max(0, index - 1)];
    const next = centerline[Math.min(centerline.length - 1, index + 1)];
    const heading = directionBetween(point, next) ?? directionBetween(previous, point);
    const perpendicular = heading.dx !== 0
      ? { x: 0, y: sideBias }
      : { x: sideBias, y: 0 };
    const negativeExtent = Math.floor((resolvedWidth - 1) / 2);
    const positiveExtent = Math.floor(resolvedWidth / 2);
    for (let offset = -negativeExtent; offset <= positiveExtent; offset++) {
      const x = point.x + perpendicular.x * offset;
      const y = point.y + perpendicular.y * offset;
      if (x < 0 || y < 0 || x >= working.width || y >= working.height) continue;
      if (isMaskSet(working.protectedMask, { x, y }) && !anchorKeys.has(`${x},${y}`)) {
        continue;
      }
      if (isMaskSet(working.waterMask, { x, y }) &&
          !isMaskSet(working.crossingMask, { x, y })) {
        continue;
      }
      pathMask[y][x] = true;
      widthField[y][x] = Math.max(widthField[y][x], resolvedWidth);
    }
  }
  for (let y = 0; y < working.height; y++) {
    for (let x = 0; x < working.width; x++) {
      if (pathMask[y][x]) {
        wearMask[y][x] = centerlineMask[y][x] ||
          coordinateHash32(seed, x, y, `${routeId}:wear`) % 4 !== 0;
        continue;
      }
      shoulderMask[y][x] = DIRECTIONS.some(direction =>
        pathMask[y + direction.dy]?.[x + direction.dx]
      );
      if (isMaskSet(working.protectedMask, { x, y })) shoulderMask[y][x] = false;
      if (isMaskSet(working.waterMask, { x, y })) shoulderMask[y][x] = false;
    }
  }
  return { centerlineMask, pathMask, shoulderMask, wearMask, widthField };
}

function straightRuns(centerline) {
  if (centerline.length < 2) return [];
  const runs = [];
  let currentDirection = directionBetween(centerline[0], centerline[1]).index;
  let length = 1;
  for (let index = 2; index < centerline.length; index++) {
    const direction = directionBetween(centerline[index - 1], centerline[index]).index;
    if (direction === currentDirection) {
      length++;
    } else {
      runs.push(length);
      currentDirection = direction;
      length = 1;
    }
  }
  runs.push(length);
  return runs;
}

function fixedRatio(numerator, denominator, empty = SCALE) {
  if (denominator === 0) return empty;
  return Math.round(numerator * SCALE / denominator);
}

function stepCosts(centerline, working, model) {
  const costs = [];
  let previousHeading = NO_HEADING;
  for (let index = 1; index < centerline.length; index++) {
    const from = centerline[index - 1];
    const to = centerline[index];
    const heading = directionBetween(from, to).index;
    costs.push(calculateRouteStepCost({
      working,
      model,
      from,
      to,
      previousHeading,
      heading
    }));
    previousHeading = heading;
  }
  return costs;
}

function regionsVisited(centerline, regionGrid) {
  const result = new Set();
  if (!regionGrid) return result;
  for (const point of centerline) {
    const value = regionGrid[point.y][point.x];
    const id = typeof value === 'string' ? value : value?.regionId;
    if (typeof id === 'string') result.add(id);
  }
  return result;
}

function crossingRuns(centerline, waterMask) {
  const runs = [];
  let current = 0;
  for (const point of centerline) {
    if (isMaskSet(waterMask, point)) {
      current++;
    } else if (current > 0) {
      runs.push(current);
      current = 0;
    }
  }
  if (current > 0) runs.push(current);
  return runs;
}

function connectionRequests(routeId, centerline, working) {
  const requests = [];
  for (let index = 1; index < centerline.length; index++) {
    const from = centerline[index - 1];
    const to = centerline[index];
    const delta = elevationAt(working, to) - elevationAt(working, from);
    if (delta === 0) continue;
    const matches = working.connectionCandidates.filter(candidate => {
      const direct = candidate.from?.x === from.x &&
        candidate.from?.y === from.y &&
        candidate.to?.x === to.x &&
        candidate.to?.y === to.y;
      const reverse = candidate.from?.x === to.x &&
        candidate.from?.y === to.y &&
        candidate.to?.x === from.x &&
        candidate.to?.y === from.y;
      return direct || reverse;
    }).map(candidate => candidate.id).filter(Boolean).sort(compareIds);
    requests.push({
      id: `${routeId}:connection:${String(index).padStart(4, '0')}`,
      from,
      to,
      kind: 'slope',
      elevationDelta: delta,
      bidirectional: true,
      candidateIds: matches
    });
  }
  return requests;
}

/**
 * Materialize a route elevation reconciliation as a layer-complete TypedRepair.
 * The planner itself only emits immutable requests because it does not own the
 * candidate map layers. The integration stage resolves those requests and then
 * calls this helper with complete replacement layers.
 */
export function createRouteReconciliationRepair({
  id,
  elevation,
  elevationConnections,
  transitions,
  features,
  reason = 'Reconcile route slope and reciprocal connection requests'
}) {
  return defineTypedRepair({
    id,
    type: 'route-elevation-reconcile',
    reason,
    affectedLayers: ['elevation', 'elevationConnections'],
    dependentLayers: ['features', 'transitions'],
    updates: {
      elevation,
      elevationConnections,
      transitions,
      features
    }
  });
}

export function measureRouteMetrics({
  centerline,
  start,
  goal,
  working,
  model,
  clearanceField,
  requiredRegionIds = [],
  minimumClearance = 1
}) {
  const steps = centerline.length - 1;
  const direct = Math.abs(start.x - goal.x) + Math.abs(start.y - goal.y);
  const euclidean = Math.hypot(start.x - goal.x, start.y - goal.y);
  const runs = straightRuns(centerline);
  const turns = Math.max(0, runs.length - 1);
  const clearances = centerline.map(point => clearanceField[point.y][point.x]);
  const visited = regionsVisited(centerline, working.requiredRegionGrid);
  const requiredCovered = requiredRegionIds.filter(id => visited.has(id)).length;
  const costs = stepCosts(centerline, working, model);
  const midpoint = Math.floor(costs.length / 2);
  const firstCost = costs.slice(0, midpoint).reduce((sum, value) => sum + value, 0);
  const secondCost = costs.slice(midpoint).reduce((sum, value) => sum + value, 0);
  const crossingLengths = crossingRuns(centerline, working.waterMask);
  return deepFreeze({
    detourRatio: fixedRatio(steps, direct),
    sinuosity: fixedRatio(steps, euclidean),
    turnDensity: fixedRatio(turns, Math.max(1, steps - 1), 0),
    minimumStraightRun: Math.min(...runs),
    maximumStraightRun: Math.max(...runs),
    minimumClearance: Math.min(...clearances),
    meanClearance: Math.round(
      clearances.reduce((sum, value) => sum + value, 0) / clearances.length
    ),
    chokeCount: clearances.filter(value => value < minimumClearance).length,
    clearanceDistribution: [...clearances].sort((a, b) => a - b),
    requiredRegionCoverage: fixedRatio(requiredCovered, requiredRegionIds.length),
    requiredRegionsVisited: [...visited].sort(compareIds),
    approachParity: fixedRatio(
      Math.min(firstCost, secondCost),
      Math.max(firstCost, secondCost)
    ),
    lineOfSightParity: fixedRatio(
      Math.min(runs[0], runs[runs.length - 1]),
      Math.max(runs[0], runs[runs.length - 1])
    ),
    maximumSlope: Math.max(
      0,
      ...centerline.slice(1).map((point, index) =>
        Math.abs(elevationAt(working, point) - elevationAt(working, centerline[index]))
      )
    ),
    crossingCount: crossingLengths.length,
    maximumCrossingLength: Math.max(0, ...crossingLengths)
  });
}

function graphDeadEnds(routes, anchorKeys) {
  const adjacency = new Map();
  const link = (left, right) => {
    if (!adjacency.has(left)) adjacency.set(left, new Set());
    adjacency.get(left).add(right);
  };
  for (const route of routes) {
    for (let index = 1; index < route.centerline.length; index++) {
      const left = pointKey(route.centerline[index - 1]);
      const right = pointKey(route.centerline[index]);
      link(left, right);
      link(right, left);
    }
  }
  return [...adjacency].filter(([key, neighbors]) =>
    neighbors.size === 1 && !anchorKeys.has(key)
  ).length;
}

function resolveRouteQualityProfile(recipe, dimensions) {
  const family = recipe.family;
  const area = dimensions.width * dimensions.height;
  const isCompact = Math.min(dimensions.width, dimensions.height) < 14 || area < 196;
  return Object.freeze({
    maximumSinuosity: recipe.routes.maximumSinuosity ??
      recipe.tactical.maximumDetour,
    maximumTurnDensity: recipe.routes.maximumTurnDensity ??
      (family === 'subterranean' ? 750_000 : (family === 'constructed' ? 650_000 : 700_000)),
    minimumStraightRun: recipe.routes.minimumStraightRun ?? 1,
    maximumChokeCount: recipe.routes.maximumChokeCount ??
      (isCompact ? Math.ceil((dimensions.width + dimensions.height) / 4) : area),
    requiredRegionCoverage: requiredCoverageTarget(recipe)
  });
}

function requiredCoverageTarget(recipe) {
  return recipe.routes.requiredRegionCoverage ?? SCALE;
}

function mergeBooleanMask(target, source) {
  for (let y = 0; y < target.length; y++) {
    for (let x = 0; x < target[y].length; x++) target[y][x] ||= source[y][x];
  }
}

/**
 * Plan the complete feature-route working layer.
 *
 * Inputs are immutable working data: a TraversalView (or dimensions for
 * topology-only staging), fixed-point roughness, discrete elevation levels,
 * SpawnLayoutContract masks, optional region IDs, reciprocal connection
 * candidates, and hydrology's water/bank/crossing/evidence object. Output
 * `features` are closed BattleMapV2 route records; masks, metrics, graph, and
 * reconciliation requests are working-stage data and are not schema records.
 */
export function planFeatureRoutes({
  anchors,
  traversalView = null,
  dimensions = null,
  fields = {},
  hydrology = {},
  spawnLayout = null,
  elevationLevels = null,
  connectionCandidates = [],
  preferredMask = null,
  requiredRegionGrid = null,
  requiredRegionIds = [],
  recipe,
  attemptSeed,
  costModel = {},
  maximumWaterCrossingLength = 4,
  minimumClearance = null,
  loopCount = null,
  widthVariance = 1,
  widthChangeInterval = 5
}) {
  if (!recipe?.routes || !recipe?.tactical) {
    throw new TypeError('planFeatureRoutes requires resolved recipe route/tactical parameters');
  }
  if (!Number.isFinite(recipe.routes.width) || recipe.routes.width <= 0) {
    throw new TypeError('recipe.routes.width must be a positive finite number');
  }
  normalizeInteger(recipe.routes.maximumSlope, 'recipe.routes.maximumSlope');
  if (typeof recipe.routeMaterial !== 'string' || recipe.routeMaterial.length === 0) {
    throw new TypeError('recipe.routeMaterial must be a non-empty string');
  }
  normalizeInteger(attemptSeed, 'attemptSeed');
  normalizeInteger(widthVariance, 'widthVariance');
  normalizeInteger(widthChangeInterval, 'widthChangeInterval', 1);
  const working = normalizeWorkingSet({
    traversalView,
    dimensions,
    fields,
    hydrology,
    spawnLayout,
    elevationLevels,
    preferredMask,
    requiredRegionGrid,
    connectionCandidates
  });
  const model = resolveRouteCostModel({
    headingChangePenalty: recipe.routes.wanderStrength > 0
      ? Math.max(1, Math.floor(recipe.routes.wanderStrength / 1000))
      : 0,
    scoreCurvature: recipe.routes.wanderStrength > 0,
    ...costModel
  });
  const graph = buildRouteAnchorGraph({
    anchors,
    dimensions: { width: working.width, height: working.height },
    family: recipe.family,
    loopCount,
    routeAnchorEvidence: hydrology.routeAnchorEvidence ?? []
  });
  const byId = new Map(graph.nodes.map(anchor => [anchor.id, anchor]));
  const routeSeed = deriveStreamSeed(attemptSeed, 'routes');
  const qualityProfile = resolveRouteQualityProfile(
    recipe,
    { width: working.width, height: working.height }
  );
  const aggregate = {
    centerlineMask: booleanGrid(working.width, working.height),
    pathMask: booleanGrid(working.width, working.height),
    shoulderMask: booleanGrid(working.width, working.height),
    wearMask: booleanGrid(working.width, working.height)
  };
  const anchorKeys = new Set(graph.nodes.map(pointKey));
  const routeResults = [];
  const routeFeatures = [];
  const reconciliationRequests = [];
  const blockerDistance = traversalView
    ? createDistanceToBlockerField(traversalView)
    : null;
  const clearanceField = Array.from(
    { length: working.height },
    (_, y) => Array.from(
      { length: working.width },
      (_, x) => Math.min(
        blockerDistance?.[y]?.[x] ?? working.width + working.height,
        x + 1,
        y + 1,
        working.width - x,
        working.height - y
      )
    )
  );

  for (let routeIndex = 0; routeIndex < graph.edges.length; routeIndex++) {
    const edge = graph.edges[routeIndex];
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    const evidence = evidenceWaypoints(edge, hydrology, from, to);
    const naturalCandidates = recipe.family === 'natural' && evidence.length === 0
      ? naturalWaypointCandidates({
          edge,
          from,
          to,
          working,
          routeSeed
        })
      : [];
    const targetSets = [
      ...naturalCandidates.map(waypoint => [from, waypoint, to]),
      [from, ...evidence, to]
    ];
    let segments = null;
    let searchCost = 0;
    let routeNotFound = null;
    for (const targets of targetSets) {
      const candidateSegments = [];
      let candidateSearchCost = 0;
      try {
        for (let index = 1; index < targets.length; index++) {
          const combinedPreferredMask = preferredMask
            ? preferredMask.map((row, y) => row.map(
              (value, x) => Boolean(value || aggregate.centerlineMask[y][x])
            ))
            : aggregate.centerlineMask;
          const result = findLeastCostRoute({
            start: targets[index - 1],
            goal: targets[index],
            traversalView,
            dimensions: { width: working.width, height: working.height },
            fields,
            hydrology,
            spawnLayout,
            elevationLevels,
            preferredMask: combinedPreferredMask,
            requiredRegionGrid,
            connectionCandidates,
            costModel: model,
            maximumSlope: recipe.routes.maximumSlope,
            maximumWaterCrossingLength,
            algorithm: 'astar',
            cleanup: false
          });
          candidateSegments.push(result.centerline);
          candidateSearchCost += result.searchCost;
        }
        segments = candidateSegments;
        searchCost = candidateSearchCost;
        break;
      } catch (error) {
        if (!(error instanceof RoutePlanningError) ||
            error.code !== 'ROUTE_NOT_FOUND') {
          throw error;
        }
        routeNotFound = error;
      }
    }
    if (!segments) throw routeNotFound;
    const rawCenterline = stitchSegments(segments);
    const centerline = cleanupRouteCenterline(rawCenterline, {
      working,
      start: from,
      goal: to,
      maximumSlope: recipe.routes.maximumSlope,
      maximumWaterCrossingLength
    });
    const routeId = `route:${String(routeIndex + 1).padStart(3, '0')}:${edge.id}`;
    const masks = createRouteMasks({
      centerline,
      width: recipe.routes.width,
      widthVariance,
      widthChangeInterval,
      seed: routeSeed,
      routeId,
      working,
      anchorKeys
    });
    for (const key of Object.keys(aggregate)) mergeBooleanMask(aggregate[key], masks[key]);
    const anchorFeatureIds = [from.featureId, to.featureId]
      .filter(value => typeof value === 'string')
      .filter((value, index, values) => values.indexOf(value) === index)
      .sort(compareIds);
    const feature = {
      id: routeId,
      kind: edge.loop ? 'loop' : (recipe.family === 'subterranean' ? 'passage' : 'path'),
      material: recipe.routeMaterial,
      centerline,
      width: recipe.routes.width,
      required: edge.required,
      anchorFeatureIds
    };
    const metrics = measureRouteMetrics({
      centerline,
      start: from,
      goal: to,
      working,
      model,
      clearanceField,
      requiredRegionIds,
      minimumClearance: minimumClearance ?? recipe.tactical.minimumRouteClearance
    });
    const connections = connectionRequests(routeId, centerline, working);
    reconciliationRequests.push({
      id: `${routeId}:elevation-reconcile`,
      type: 'route-elevation-reconcile',
      routeId,
      affectedLayers: ['elevation', 'elevationConnections'],
      maximumSlope: recipe.routes.maximumSlope,
      connectionRequests: connections
    });
    routeFeatures.push(feature);
    routeResults.push({
      edge,
      feature,
      searchCost,
      metrics,
      widthField: masks.widthField
    });
  }

  for (let y = 0; y < working.height; y++) {
    for (let x = 0; x < working.width; x++) {
      if (aggregate.pathMask[y][x]) aggregate.shoulderMask[y][x] = false;
      if (!aggregate.pathMask[y][x]) aggregate.wearMask[y][x] = false;
    }
  }

  const deadEndCount = graphDeadEnds(routeFeatures, anchorKeys);
  const maximumDetour = Math.max(
    0,
    ...routeResults.map(route => route.metrics.detourRatio)
  );
  const minimumResolvedClearance = Math.min(
    ...routeResults.map(route => route.metrics.minimumClearance)
  );
  const maximumSlope = Math.max(
    0,
    ...routeResults.map(route => route.metrics.maximumSlope)
  );
  const maximumCrossing = Math.max(
    0,
    ...routeResults.map(route => route.metrics.maximumCrossingLength)
  );
  const intentionalDeadEndBudget = recipe.family === 'constructed'
    ? Math.max(1, Math.floor(graph.nodes.length / 3))
    : 0;
  const visitedRequiredRegions = new Set(
    routeResults.flatMap(route => route.metrics.requiredRegionsVisited)
  );
  const requiredRegionCoverage = fixedRatio(
    requiredRegionIds.filter(id => visitedRequiredRegions.has(id)).length,
    requiredRegionIds.length
  );
  const totalChokeCount = routeResults.reduce(
    (sum, route) => sum + route.metrics.chokeCount,
    0
  );
  const violations = [];
  if (maximumDetour > recipe.tactical.maximumDetour) violations.push('route-detour-high');
  if (minimumResolvedClearance < (
    minimumClearance ?? recipe.tactical.minimumRouteClearance
  )) {
    violations.push('route-clearance-low');
  }
  if (deadEndCount > intentionalDeadEndBudget) violations.push('route-dead-end-budget');
  if (maximumSlope > recipe.routes.maximumSlope) violations.push('route-slope-limit');
  if (maximumCrossing > maximumWaterCrossingLength) {
    violations.push('route-crossing-limit');
  }
  if (requiredRegionCoverage < qualityProfile.requiredRegionCoverage) {
    violations.push('route-required-region-coverage');
  }
  if (totalChokeCount > qualityProfile.maximumChokeCount) {
    violations.push('route-choke-budget');
  }
  if (routeResults.some(route =>
    route.metrics.sinuosity > qualityProfile.maximumSinuosity
  )) {
    violations.push('route-sinuosity-high');
  }
  if (routeResults.some(route =>
    route.metrics.turnDensity > qualityProfile.maximumTurnDensity
  )) {
    violations.push('route-turn-density-high');
  }
  if (routeResults.some(route =>
    route.metrics.minimumStraightRun < qualityProfile.minimumStraightRun
  )) {
    violations.push('route-straight-run-low');
  }
  if (reconciliationRequests.some(request =>
    request.connectionRequests.some(connection =>
      connection.candidateIds.length < 2
    )
  )) {
    violations.push('route-connection-candidate-missing');
  }
  if (recipe.family === 'arena') {
    const minimumApproachParity = Math.min(
      ...routeResults.map(route => route.metrics.approachParity)
    );
    const minimumLosParity = Math.min(
      ...routeResults.map(route => route.metrics.lineOfSightParity)
    );
    if (SCALE - minimumApproachParity > recipe.tactical.competitiveParityTolerance) {
      violations.push('route-approach-parity');
    }
    if (SCALE - minimumLosParity > recipe.tactical.competitiveParityTolerance) {
      violations.push('route-los-parity');
    }
  }

  return deepFreeze({
    plannerVersion: ROUTE_PLANNER_VERSION,
    graph,
    features: routeFeatures,
    routes: routeResults,
    masks: aggregate,
    reconciliationRequests,
    metrics: {
      maximumDetour,
      minimumClearance: minimumResolvedClearance,
      deadEndCount,
      intentionalDeadEndBudget,
      requiredRegionCoverage,
      totalChokeCount,
      maximumSlope,
      maximumCrossingLength: maximumCrossing,
      qualityProfile
    },
    validation: {
      valid: violations.length === 0,
      violations
    }
  });
}
