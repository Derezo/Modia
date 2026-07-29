import {
  canEnterTile,
  getStepCost,
  validateTraversalView
} from '../../traversal.js';
import {
  deriveAttemptSeed,
  quantizeFixed
} from './Determinism.js';
import { evaluateOrganicQuality } from './OrganicQuality.js';

export const VALIDATION_CATEGORIES = Object.freeze([
  'hard',
  'tactical',
  'quality'
]);

export const VALIDATION_CODES = Object.freeze({
  PASS: 'PASS',
  DIMENSIONS_INVALID: 'DIMENSIONS_INVALID',
  NON_FINITE_VALUE: 'NON_FINITE_VALUE',
  SCHEMA_INVALID: 'SCHEMA_INVALID',
  PALETTE_INVALID: 'PALETTE_INVALID',
  SPAWN_CAPACITY_INSUFFICIENT: 'SPAWN_CAPACITY_INSUFFICIENT',
  AUTHORITATIVE_CONNECTIVITY_MISSING: 'AUTHORITATIVE_CONNECTIVITY_MISSING',
  REQUIRED_REGION_UNREACHABLE: 'REQUIRED_REGION_UNREACHABLE',
  ROUTE_DIVERSITY_LOW: 'ROUTE_DIVERSITY_LOW',
  CORRIDOR_CLEARANCE_LOW: 'CORRIDOR_CLEARANCE_LOW',
  USABLE_AREA_OUT_OF_BAND: 'USABLE_AREA_OUT_OF_BAND',
  ROUTE_DETOUR_HIGH: 'ROUTE_DETOUR_HIGH',
  CHOKE_BUDGET_EXCEEDED: 'CHOKE_BUDGET_EXCEEDED',
  DEAD_END_BUDGET_EXCEEDED: 'DEAD_END_BUDGET_EXCEEDED',
  APPROACH_PARITY_LOW: 'APPROACH_PARITY_LOW',
  LOS_PARITY_LOW: 'LOS_PARITY_LOW',
  ORGANIC_QUALITY_LOW: 'ORGANIC_QUALITY_LOW',
  QUALITY_MEASURED: 'QUALITY_MEASURED',
  ATTEMPT_ERROR: 'ATTEMPT_ERROR',
  CHECK_EXCEPTION: 'CHECK_EXCEPTION'
});

const CARDINAL = Object.freeze([
  Object.freeze({ x: 0, y: -1 }),
  Object.freeze({ x: 1, y: 0 }),
  Object.freeze({ x: 0, y: 1 }),
  Object.freeze({ x: -1, y: 0 })
]);

function keyOf(point) {
  return `${point.x},${point.y}`;
}

function pointOf(key) {
  const [x, y] = key.split(',').map(Number);
  return { x, y };
}

function comparePoints(a, b) {
  return a.y - b.y || a.x - b.x;
}

function uniquePoints(points, width, height) {
  const values = new Map();
  for (const point of points ?? []) {
    if (!Number.isInteger(point?.x) || !Number.isInteger(point?.y)) continue;
    if (point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) continue;
    values.set(keyOf(point), { x: point.x, y: point.y });
  }
  return [...values.values()].sort(comparePoints);
}

function maskPoints(mask, width, height) {
  const result = [];
  if (!Array.isArray(mask)) return result;
  for (let y = 0; y < Math.min(height, mask.length); y++) {
    for (let x = 0; x < Math.min(width, mask[y]?.length ?? 0); x++) {
      if (mask[y][x]) result.push({ x, y });
    }
  }
  return result;
}

function boundsPoints(bounds, width, height) {
  if (!bounds) return [];
  const points = [];
  for (let y = bounds.minY; y <= bounds.maxY; y++) {
    for (let x = bounds.minX; x <= bounds.maxX; x++) points.push({ x, y });
  }
  return uniquePoints(points, width, height);
}

function pointsFromZone(zone, width, height) {
  if (Array.isArray(zone)) return uniquePoints(zone, width, height);
  if (zone?.mask) return uniquePoints(maskPoints(zone.mask, width, height), width, height);
  if (zone?.cells) return uniquePoints(zone.cells, width, height);
  if (zone?.bounds) return boundsPoints(zone.bounds, width, height);
  if (Number.isInteger(zone?.x) && Number.isInteger(zone?.y)) {
    return uniquePoints([zone], width, height);
  }
  return [];
}

function deriveProtectedSides(spawnLayout, width, height) {
  if (!spawnLayout) return { source: [], target: [] };
  const sourceAliases = ['player', 'west', 'north', 'arena_north', 'a', 'team-a'];
  const targetAliases = ['enemy', 'east', 'south', 'arena_south', 'b', 'team-b'];
  if (spawnLayout.playerCoreMask || spawnLayout.enemyCoreMask) {
    return {
      source: maskPoints(spawnLayout.playerCoreMask, width, height),
      target: maskPoints(spawnLayout.enemyCoreMask, width, height)
    };
  }
  const zones = spawnLayout.protectedZones ?? [];
  const sourceZones = zones.filter(zone => sourceAliases.includes(zone.side));
  const targetZones = zones.filter(zone => targetAliases.includes(zone.side));
  let source = sourceZones.flatMap(zone => pointsFromZone(zone, width, height));
  let target = targetZones.flatMap(zone => pointsFromZone(zone, width, height));
  if (source.length === 0 || target.length === 0) {
    const slots = spawnLayout.slots ?? [];
    source = source.length > 0
      ? source
      : slots.filter(slot => sourceAliases.includes(slot.side));
    target = target.length > 0
      ? target
      : slots.filter(slot => targetAliases.includes(slot.side));
  }
  return {
    source: uniquePoints(source, width, height),
    target: uniquePoints(target, width, height)
  };
}

/**
 * Materialize the directed tile graph produced by the authoritative traversal
 * policy. A tile is usable only when authoritative traversal can enter it.
 */
export function buildTraversalGraph(traversalView) {
  const view = validateTraversalView(traversalView);
  const { width, height } = view.dimensions;
  const incoming = new Set();
  const rawEdges = new Map();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = { x, y };
      const fromKey = keyOf(from);
      const neighbors = [];
      for (const offset of CARDINAL) {
        const to = { x: x + offset.x, y: y + offset.y };
        if (to.x < 0 || to.y < 0 || to.x >= width || to.y >= height) continue;
        if (canEnterTile(view, from, to, { start: from })) {
          const toKey = keyOf(to);
          neighbors.push(toKey);
          incoming.add(toKey);
        }
      }
      rawEdges.set(fromKey, neighbors);
    }
  }
  const active = incoming;
  const edges = new Map();
  for (const key of [...active].sort()) {
    edges.set(
      key,
      (rawEdges.get(key) ?? []).filter(target => active.has(target)).sort()
    );
  }
  return Object.freeze({ view, width, height, active, edges });
}

function reachableKeys(graph, sourcePoints) {
  const queue = uniquePoints(sourcePoints, graph.width, graph.height)
    .map(keyOf)
    .filter(key => graph.active.has(key));
  const reached = new Set(queue);
  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor++];
    for (const neighbor of graph.edges.get(current) ?? []) {
      if (reached.has(neighbor)) continue;
      reached.add(neighbor);
      queue.push(neighbor);
    }
  }
  return reached;
}

function addCapacity(capacity, adjacency, from, to, value) {
  if (!capacity.has(from)) capacity.set(from, new Map());
  if (!capacity.has(to)) capacity.set(to, new Map());
  capacity.get(from).set(to, (capacity.get(from).get(to) ?? 0) + value);
  if (!capacity.get(to).has(from)) capacity.get(to).set(from, 0);
  if (!adjacency.has(from)) adjacency.set(from, new Set());
  if (!adjacency.has(to)) adjacency.set(to, new Set());
  adjacency.get(from).add(to);
  adjacency.get(to).add(from);
}

/**
 * Maximum number of internally vertex-disjoint authoritative routes between
 * two protected zones, using vertex splitting and integer max flow.
 */
export function countVertexDisjointRoutes(graphOrView, sourceZone, targetZone) {
  const graph = graphOrView?.active
    ? graphOrView
    : buildTraversalGraph(graphOrView);
  const sources = new Set(
    pointsFromZone(sourceZone, graph.width, graph.height)
      .map(keyOf)
      .filter(key => graph.active.has(key))
  );
  const targets = new Set(
    pointsFromZone(targetZone, graph.width, graph.height)
      .map(keyOf)
      .filter(key => graph.active.has(key))
  );
  if (sources.size === 0 || targets.size === 0) return 0;

  const capacity = new Map();
  const adjacency = new Map();
  const superSource = '@source';
  const superTarget = '@target';
  const limit = Math.max(1, Math.min(sources.size, targets.size));
  for (const key of [...graph.active].sort()) {
    addCapacity(capacity, adjacency, `${key}:in`, `${key}:out`, 1);
  }
  for (const [from, neighbors] of graph.edges) {
    if (targets.has(from)) continue;
    for (const to of neighbors) {
      if (sources.has(to)) continue;
      addCapacity(capacity, adjacency, `${from}:out`, `${to}:in`, limit);
    }
  }
  for (const source of sources) {
    addCapacity(capacity, adjacency, superSource, `${source}:in`, 1);
  }
  for (const target of targets) {
    addCapacity(capacity, adjacency, `${target}:out`, superTarget, 1);
  }

  let flow = 0;
  while (flow < limit) {
    const parents = new Map([[superSource, null]]);
    const queue = [superSource];
    let cursor = 0;
    while (cursor < queue.length && !parents.has(superTarget)) {
      const current = queue[cursor++];
      const neighbors = [...(adjacency.get(current) ?? [])].sort();
      for (const next of neighbors) {
        if (parents.has(next) || (capacity.get(current)?.get(next) ?? 0) <= 0) continue;
        parents.set(next, current);
        queue.push(next);
      }
    }
    if (!parents.has(superTarget)) break;
    let amount = limit;
    for (let at = superTarget; parents.get(at) !== null; at = parents.get(at)) {
      const parent = parents.get(at);
      amount = Math.min(amount, capacity.get(parent).get(at));
    }
    for (let at = superTarget; parents.get(at) !== null; at = parents.get(at)) {
      const parent = parents.get(at);
      capacity.get(parent).set(at, capacity.get(parent).get(at) - amount);
      capacity.get(at).set(parent, capacity.get(at).get(parent) + amount);
    }
    flow += amount;
  }
  return flow;
}

/**
 * Manhattan distance to the nearest tile which authoritative traversal cannot
 * enter. A completely open map receives the finite sentinel width + height.
 */
export function createDistanceToBlockerField(graphOrView) {
  const graph = graphOrView?.active
    ? graphOrView
    : buildTraversalGraph(graphOrView);
  const distance = Array.from(
    { length: graph.height },
    () => Array(graph.width).fill(graph.width + graph.height)
  );
  const queue = [];
  for (let y = 0; y < graph.height; y++) {
    for (let x = 0; x < graph.width; x++) {
      if (graph.active.has(`${x},${y}`)) continue;
      distance[y][x] = 0;
      queue.push({ x, y });
    }
  }
  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor++];
    const nextDistance = distance[current.y][current.x] + 1;
    for (const offset of CARDINAL) {
      const x = current.x + offset.x;
      const y = current.y + offset.y;
      if (x < 0 || y < 0 || x >= graph.width || y >= graph.height) continue;
      if (distance[y][x] <= nextDistance) continue;
      distance[y][x] = nextDistance;
      queue.push({ x, y });
    }
  }
  return distance;
}

function shortestRoute(graph, sourcePoints, targetPoints) {
  const targetKeys = new Set(
    uniquePoints(targetPoints, graph.width, graph.height).map(keyOf)
  );
  const queue = uniquePoints(sourcePoints, graph.width, graph.height)
    .map(point => ({ ...point, cost: 0 }))
    .filter(point => graph.active.has(keyOf(point)));
  const costs = new Map(queue.map(point => [keyOf(point), 0]));
  const parents = new Map();
  let reached = null;
  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost || comparePoints(a, b));
    const current = queue.shift();
    const currentKey = keyOf(current);
    if (current.cost !== costs.get(currentKey)) continue;
    if (targetKeys.has(currentKey)) {
      reached = currentKey;
      break;
    }
    for (const neighborKey of graph.edges.get(currentKey) ?? []) {
      const neighbor = pointOf(neighborKey);
      const stepCost = getStepCost(
        graph.view,
        current,
        neighbor,
        { start: current }
      );
      if (!Number.isFinite(stepCost)) continue;
      const nextCost = current.cost + stepCost;
      if (nextCost >= (costs.get(neighborKey) ?? Infinity)) continue;
      costs.set(neighborKey, nextCost);
      parents.set(neighborKey, currentKey);
      queue.push({ ...neighbor, cost: nextCost });
    }
  }
  if (reached === null) return null;
  const path = [];
  let at = reached;
  while (at) {
    path.unshift(pointOf(at));
    at = parents.get(at) ?? null;
  }
  return { path, cost: costs.get(reached) };
}

function quantile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  return sorted[Math.floor((sorted.length - 1) * fraction)];
}

export function measureCorridorClearance(
  distanceField,
  routes,
  { chokeThreshold = 1 } = {}
) {
  const values = [];
  for (const route of routes ?? []) {
    const points = route?.path ?? route?.centerline ?? route;
    for (const point of points ?? []) {
      const value = distanceField?.[point.y]?.[point.x];
      if (Number.isFinite(value)) values.push(value);
    }
  }
  values.sort((a, b) => a - b);
  const chokeCount = values.filter(value => value <= chokeThreshold).length;
  return Object.freeze({
    sampleCount: values.length,
    minimum: values[0] ?? 0,
    p25: quantile(values, 0.25),
    median: quantile(values, 0.5),
    p75: quantile(values, 0.75),
    maximum: values.at(-1) ?? 0,
    chokeCount,
    chokeRatio: values.length === 0 ? 1 : chokeCount / values.length
  });
}

function regionPoints(region, width, height) {
  if (region?.anchor) return uniquePoints([region.anchor], width, height);
  if (region?.cells) return uniquePoints(region.cells, width, height);
  if (region?.bounds) return boundsPoints(region.bounds, width, height);
  return [];
}

function measureRequiredRegions(graph, source, requiredRegions) {
  const reached = reachableKeys(graph, source);
  const required = (requiredRegions ?? []).filter(region => region.required !== false);
  const reachableIds = [];
  const unreachableIds = [];
  for (const region of required) {
    const accessible = regionPoints(region, graph.width, graph.height)
      .some(point => reached.has(keyOf(point)));
    (accessible ? reachableIds : unreachableIds).push(region.id);
  }
  return Object.freeze({
    requiredCount: required.length,
    reachableCount: reachableIds.length,
    reachableIds: Object.freeze(reachableIds.sort()),
    unreachableIds: Object.freeze(unreachableIds.sort()),
    allReachable: unreachableIds.length === 0
  });
}

function measureDeadEnds(graph, reachable, excluded, intentionalDeadEnds) {
  const intentional = new Set((intentionalDeadEnds ?? []).map(keyOf));
  const excludedKeys = new Set((excluded ?? []).map(keyOf));
  const reverseEdges = new Map();
  for (const [source, targets] of graph.edges) {
    for (const target of targets) {
      if (!reverseEdges.has(target)) reverseEdges.set(target, []);
      reverseEdges.get(target).push(source);
    }
  }
  const all = [];
  for (const key of [...reachable].sort()) {
    if (excludedKeys.has(key)) continue;
    const neighbors = new Set();
    for (const target of graph.edges.get(key) ?? []) {
      if (reachable.has(target)) neighbors.add(target);
    }
    for (const candidate of reverseEdges.get(key) ?? []) {
      if (reachable.has(candidate)) neighbors.add(candidate);
    }
    if (neighbors.size <= 1) all.push(key);
  }
  const intentionalKeys = all.filter(key => intentional.has(key));
  const accidentalKeys = all.filter(key => !intentional.has(key));
  return Object.freeze({
    total: all.length,
    intentional: intentionalKeys.length,
    accidental: accidentalKeys.length,
    intentionalKeys: Object.freeze(intentionalKeys),
    accidentalKeys: Object.freeze(accidentalKeys)
  });
}

function linePoints(from, to) {
  const result = [];
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - from.x);
  const sx = from.x < to.x ? 1 : -1;
  const dy = -Math.abs(to.y - from.y);
  const sy = from.y < to.y ? 1 : -1;
  let error = dx + dy;
  while (true) {
    result.push({ x, y });
    if (x === to.x && y === to.y) break;
    const twice = 2 * error;
    if (twice >= dy) {
      error += dy;
      x += sx;
    }
    if (twice <= dx) {
      error += dx;
      y += sy;
    }
  }
  return result;
}

function hasLineOfSight(graph, from, to) {
  const line = linePoints(from, to);
  return line.slice(1, -1).every(point => graph.active.has(keyOf(point)));
}

function average(values) {
  return values.length === 0
    ? Infinity
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizedParity(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return left === right ? 1 : 0;
  }
  return 1 - Math.min(1, Math.abs(left - right) / Math.max(1, left, right));
}

function measureCompetitiveParity(graph, competitive) {
  if (!competitive) {
    return Object.freeze({
      enabled: false,
      approachDistances: Object.freeze([]),
      approachParity: 1,
      lineOfSightCounts: Object.freeze([]),
      lineOfSightParity: 1
    });
  }
  const sides = competitive.sides ?? [];
  const objectives = uniquePoints(
    competitive.objectives ?? [],
    graph.width,
    graph.height
  );
  const approachDistances = sides.map(side => average(objectives.map(objective => {
    const route = shortestRoute(
      graph,
      pointsFromZone(side, graph.width, graph.height),
      [objective]
    );
    return route?.cost ?? Infinity;
  })));
  const lineOfSightCounts = sides.map(side => {
    const points = pointsFromZone(side, graph.width, graph.height);
    return objectives.filter(objective =>
      points.some(point => hasLineOfSight(graph, point, objective))
    ).length;
  });
  return Object.freeze({
    enabled: true,
    approachDistances: Object.freeze(approachDistances),
    approachParity: approachDistances.length === 2
      ? normalizedParity(approachDistances[0], approachDistances[1])
      : 1,
    lineOfSightCounts: Object.freeze(lineOfSightCounts),
    lineOfSightParity: lineOfSightCounts.length === 2
      ? normalizedParity(lineOfSightCounts[0], lineOfSightCounts[1])
      : 1
  });
}

/**
 * Calculate the initial BMG-02 graph metric set.
 */
export function measureTraversalMetrics({
  traversalView,
  sourceZone,
  targetZone,
  spawnLayout = null,
  requiredRegions = [],
  requiredRoutes = null,
  intentionalDeadEnds = [],
  competitive = null,
  chokeThreshold = 1
}) {
  const graph = buildTraversalGraph(traversalView);
  const derivedSides = deriveProtectedSides(spawnLayout, graph.width, graph.height);
  const source = pointsFromZone(
    sourceZone ?? derivedSides.source,
    graph.width,
    graph.height
  );
  const target = pointsFromZone(
    targetZone ?? derivedSides.target,
    graph.width,
    graph.height
  );
  const reachable = reachableKeys(graph, source);
  const shortest = shortestRoute(graph, source, target);
  const routes = requiredRoutes ?? (shortest ? [shortest.path] : []);
  const distanceField = createDistanceToBlockerField(graph);
  const clearance = measureCorridorClearance(
    distanceField,
    routes,
    { chokeThreshold }
  );
  const lowerBound = source.length > 0 && target.length > 0
    ? Math.min(...source.flatMap(from => target.map(to =>
      Math.abs(from.x - to.x) + Math.abs(from.y - to.y)
    )))
    : 0;
  const routeDiversity = countVertexDisjointRoutes(graph, source, target);
  const requiredRegionReachability = measureRequiredRegions(
    graph,
    source,
    requiredRegions
  );
  const deadEnds = measureDeadEnds(
    graph,
    reachable,
    [...source, ...target],
    intentionalDeadEnds
  );
  return Object.freeze({
    graph,
    authoritativeConnected: Boolean(shortest),
    routeDiversity,
    requiredRegionReachability,
    usableTileCount: reachable.size,
    totalTileCount: graph.width * graph.height,
    usableAreaRatio: reachable.size / (graph.width * graph.height),
    shortestRoute: shortest
      ? Object.freeze({ path: Object.freeze(shortest.path), cost: shortest.cost })
      : null,
    unobstructedLowerBound: lowerBound,
    detourRatio: shortest
      ? shortest.cost / Math.max(1, lowerBound)
      : Infinity,
    clearance,
    deadEnds,
    competitiveParity: measureCompetitiveParity(graph, competitive)
  });
}

function checkResult(pass, code, message, extra = {}) {
  return Object.freeze({ pass: Boolean(pass), code, message, ...extra });
}

function validateDimensions(candidate) {
  const width = candidate?.mapWidth;
  const height = candidate?.mapHeight;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return checkResult(false, VALIDATION_CODES.DIMENSIONS_INVALID, 'Map dimensions must be positive integers');
  }
  const gridLayers = ['terrain', 'elevation'];
  for (const layer of gridLayers) {
    const grid = candidate?.[layer];
    if (!Array.isArray(grid) || grid.length !== height ||
        grid.some(row => !Array.isArray(row) || row.length !== width)) {
      return checkResult(
        false,
        VALIDATION_CODES.DIMENSIONS_INVALID,
        `${layer} must be an exact ${width}x${height} row-major grid`,
        { layer }
      );
    }
  }
  return checkResult(true, VALIDATION_CODES.PASS, 'Dimensions are valid');
}

function findNonFinite(value, path = 'candidate', seen = new WeakSet()) {
  if (typeof value === 'number' && !Number.isFinite(value)) return path;
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const found = findNonFinite(value[index], `${path}[${index}]`, seen);
      if (found) return found;
    }
    return null;
  }
  for (const key of Object.keys(value).sort()) {
    const found = findNonFinite(value[key], `${path}.${key}`, seen);
    if (found) return found;
  }
  return null;
}

function materialOf(cell) {
  return typeof cell === 'string' ? cell : cell?.material;
}

function validateSchemaAndPalette(candidate, palette, schemaValidate) {
  if (schemaValidate) {
    const result = schemaValidate(candidate);
    if (result !== true && result?.success !== true && result?.valid !== true) {
      return checkResult(
        false,
        VALIDATION_CODES.SCHEMA_INVALID,
        'Candidate failed the configured closed-schema validator',
        { errors: result?.errors ?? [] }
      );
    }
  }
  const allowed = palette instanceof Set ? palette : new Set(palette ?? []);
  for (let y = 0; y < (candidate?.terrain?.length ?? 0); y++) {
    for (let x = 0; x < (candidate.terrain[y]?.length ?? 0); x++) {
      const material = materialOf(candidate.terrain[y][x]);
      if (typeof material !== 'string' || material.length === 0) {
        return checkResult(
          false,
          VALIDATION_CODES.SCHEMA_INVALID,
          `Terrain cell ${x},${y} has no material`
        );
      }
      if (allowed.size > 0 && !allowed.has(material)) {
        return checkResult(
          false,
          VALIDATION_CODES.PALETTE_INVALID,
          `Terrain material ${material} is outside the resolved palette`,
          { material, x, y }
        );
      }
    }
  }
  return checkResult(true, VALIDATION_CODES.PASS, 'Schema and palette basics are valid');
}

function resolvedSpawnCapacity(spawnLayout, side) {
  if (!spawnLayout) return 0;
  if (side === 'player' && Number.isInteger(spawnLayout.playerCapacity)) {
    return spawnLayout.playerCapacity;
  }
  if (side === 'enemy' && Number.isInteger(spawnLayout.enemyCapacity)) {
    return spawnLayout.enemyCapacity;
  }
  const aliases = side === 'player'
    ? ['player', 'west', 'north', 'arena_north', 'a', 'team-a']
    : ['enemy', 'east', 'south', 'arena_south', 'b', 'team-b'];
  const slots = (spawnLayout.slots ?? []).filter(slot => aliases.includes(slot.side));
  const staged = (spawnLayout.stagingRegions ?? [])
    .filter(region => aliases.includes(region.side))
    .reduce((sum, region) => sum + (Number.isInteger(region.capacity) ? region.capacity : 0), 0);
  return Math.max(slots.length, staged);
}

function validateSpawnCapacity(spawnLayout, requirements) {
  const playerRequired = requirements?.playerCount ?? 0;
  const enemyRequired = requirements?.enemyCapacity ?? 0;
  const playerCapacity = resolvedSpawnCapacity(spawnLayout, 'player');
  const enemyCapacity = resolvedSpawnCapacity(spawnLayout, 'enemy');
  const pass = playerCapacity >= playerRequired && enemyCapacity >= enemyRequired;
  return checkResult(
    pass,
    pass ? VALIDATION_CODES.PASS : VALIDATION_CODES.SPAWN_CAPACITY_INSUFFICIENT,
    pass ? 'Spawn capacity is sufficient' : 'Spawn layout cannot satisfy requested capacity',
    { playerCapacity, enemyCapacity, playerRequired, enemyRequired }
  );
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function qualityScore(metrics, preferences) {
  const desiredRoutes = preferences.desiredRouteDiversity ?? 2;
  const desiredClearance = preferences.desiredCorridorClearance ?? 3;
  const components = [
    clamp01(metrics.routeDiversity / Math.max(1, desiredRoutes)),
    clamp01(metrics.usableAreaRatio),
    clamp01(metrics.clearance.median / Math.max(1, desiredClearance)),
    Number.isFinite(metrics.detourRatio) ? clamp01(1 / Math.max(1, metrics.detourRatio)) : 0,
    clamp01(1 - metrics.clearance.chokeRatio),
    clamp01(1 / (1 + metrics.deadEnds.accidental)),
    metrics.competitiveParity.approachParity,
    metrics.competitiveParity.lineOfSightParity
  ];
  return quantizeFixed(average(components)) / 1_000_000;
}

export class ValidationCheckRegistry {
  constructor() {
    this._checks = new Map();
  }

  register(definition) {
    const id = definition?.id;
    if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)) {
      throw new TypeError('Validation check id must be a stable lowercase identifier');
    }
    if (this._checks.has(id)) throw new Error(`Duplicate validation check id: ${id}`);
    if (!VALIDATION_CATEGORIES.includes(definition.category)) {
      throw new TypeError(`Validation check ${id} has an invalid category`);
    }
    if (typeof definition.evaluate !== 'function') {
      throw new TypeError(`Validation check ${id} must provide evaluate(context)`);
    }
    const check = Object.freeze({
      id,
      category: definition.category,
      evaluate: definition.evaluate
    });
    this._checks.set(id, check);
    return check;
  }

  list() {
    return Object.freeze([...this._checks.values()]);
  }
}

export function createDefaultValidationRegistry() {
  const registry = new ValidationCheckRegistry();
  registry.register({
    id: 'dimensions',
    category: 'hard',
    evaluate: context => validateDimensions(context.candidate)
  });
  registry.register({
    id: 'finite-values',
    category: 'hard',
    evaluate(context) {
      const path = findNonFinite(context.candidate);
      return checkResult(
        path === null,
        path === null ? VALIDATION_CODES.PASS : VALIDATION_CODES.NON_FINITE_VALUE,
        path === null ? 'All candidate values are finite' : `Non-finite candidate value at ${path}`,
        path === null ? {} : { path }
      );
    }
  });
  registry.register({
    id: 'schema-palette-basics',
    category: 'hard',
    evaluate: context => validateSchemaAndPalette(
      context.candidate,
      context.palette,
      context.schemaValidate
    )
  });
  registry.register({
    id: 'spawn-capacity',
    category: 'hard',
    evaluate: context => validateSpawnCapacity(
      context.spawnLayout,
      context.spawnRequirements
    )
  });
  registry.register({
    id: 'authoritative-connectivity',
    category: 'hard',
    evaluate(context) {
      const connected = context.metrics.authoritativeConnected;
      return checkResult(
        connected,
        connected ? VALIDATION_CODES.PASS : VALIDATION_CODES.AUTHORITATIVE_CONNECTIVITY_MISSING,
        connected ? 'Protected zones are authoritatively connected' : 'Protected zones have no authoritative traversal route'
      );
    }
  });
  registry.register({
    id: 'required-region-reachability',
    category: 'hard',
    evaluate(context) {
      const reachability = context.metrics.requiredRegionReachability;
      return checkResult(
        reachability.allReachable,
        reachability.allReachable ? VALIDATION_CODES.PASS : VALIDATION_CODES.REQUIRED_REGION_UNREACHABLE,
        reachability.allReachable ? 'All required regions are reachable' : 'One or more required regions are unreachable',
        { unreachableIds: reachability.unreachableIds }
      );
    }
  });
  const tacticalChecks = [
    {
      id: 'route-diversity',
      code: VALIDATION_CODES.ROUTE_DIVERSITY_LOW,
      message: 'Route diversity is below the tactical minimum',
      pass: ({ metrics, constraints }) =>
        metrics.routeDiversity >= (constraints.minRouteDiversity ?? 1)
    },
    {
      id: 'corridor-clearance',
      code: VALIDATION_CODES.CORRIDOR_CLEARANCE_LOW,
      message: 'Required-route clearance is below the tactical minimum',
      pass: ({ metrics, constraints }) =>
        metrics.clearance.minimum >= (constraints.minCorridorClearance ?? 0)
    },
    {
      id: 'usable-area',
      code: VALIDATION_CODES.USABLE_AREA_OUT_OF_BAND,
      message: 'Usable area is outside the tactical band',
      pass: ({ metrics, constraints }) =>
        metrics.usableAreaRatio >= (constraints.minUsableAreaRatio ?? 0) &&
        metrics.usableAreaRatio <= (constraints.maxUsableAreaRatio ?? 1)
    },
    {
      id: 'route-detour',
      code: VALIDATION_CODES.ROUTE_DETOUR_HIGH,
      message: 'Required-route detour exceeds the tactical maximum',
      pass: ({ metrics, constraints }) =>
        metrics.detourRatio <= (constraints.maxDetourRatio ?? Infinity)
    },
    {
      id: 'choke-budget',
      code: VALIDATION_CODES.CHOKE_BUDGET_EXCEEDED,
      message: 'Choke distribution exceeds the tactical budget',
      pass: ({ metrics, constraints }) =>
        metrics.clearance.chokeRatio <= (constraints.maxChokeRatio ?? 1)
    },
    {
      id: 'dead-end-budget',
      code: VALIDATION_CODES.DEAD_END_BUDGET_EXCEEDED,
      message: 'Accidental dead ends exceed the tactical budget',
      pass: ({ metrics, constraints }) =>
        metrics.deadEnds.accidental <= (constraints.maxAccidentalDeadEnds ?? Infinity)
    },
    {
      id: 'approach-parity',
      code: VALIDATION_CODES.APPROACH_PARITY_LOW,
      message: 'Competitive approach parity is below the tactical minimum',
      pass: ({ metrics, constraints }) =>
        metrics.competitiveParity.approachParity >= (constraints.minApproachParity ?? 0)
    },
    {
      id: 'line-of-sight-parity',
      code: VALIDATION_CODES.LOS_PARITY_LOW,
      message: 'Competitive line-of-sight parity is below the tactical minimum',
      pass: ({ metrics, constraints }) =>
        metrics.competitiveParity.lineOfSightParity >= (constraints.minLosParity ?? 0)
    }
  ];
  for (const definition of tacticalChecks) {
    registry.register({
      id: definition.id,
      category: 'tactical',
      evaluate(context) {
        const pass = definition.pass(context);
        return checkResult(
          pass,
          pass ? VALIDATION_CODES.PASS : definition.code,
          pass ? `${definition.id} tactical requirement passes` : definition.message
        );
      }
    });
  }
  registry.register({
    id: 'recipe-quality',
    category: 'quality',
    evaluate(context) {
      const score = qualityScore(context.metrics, context.preferences);
      return checkResult(true, VALIDATION_CODES.QUALITY_MEASURED, 'Recipe quality measured', { score });
    }
  });
  registry.register({
    id: 'organic-quality',
    category: 'quality',
    evaluate(context) {
      const organicQuality = context.organicQuality;
      const failedIds = organicQuality.checks
        .filter(check => !check.pass)
        .map(check => check.id);
      return checkResult(
        organicQuality.pass,
        organicQuality.pass
          ? VALIDATION_CODES.PASS
          : VALIDATION_CODES.ORGANIC_QUALITY_LOW,
        organicQuality.pass
          ? 'Organic geometry and hydrology requirements pass'
          : `Organic quality requirements failed: ${failedIds.join(', ')}`,
        { failedIds }
      );
    }
  });
  return registry;
}

function normalizeCheckOutput(check, output) {
  if (!output || typeof output !== 'object' || typeof output.pass !== 'boolean' ||
      typeof output.code !== 'string') {
    throw new TypeError(`Validation check ${check.id} returned an invalid result`);
  }
  return Object.freeze({ id: check.id, category: check.category, ...output });
}

/**
 * Evaluate candidate-level BMG-02 checks. This is not the BMG-22 final gate.
 */
export function validateV2Candidate({
  candidate,
  traversalView,
  spawnLayout = candidate?.spawnLayout,
  spawnRequirements = {},
  sourceZone,
  targetZone,
  requiredRegions = [],
  requiredRoutes = null,
  intentionalDeadEnds = [],
  competitive = null,
  constraints = {},
  preferences = {},
  recipe = null,
  palette = [],
  schemaValidate = null,
  registry = createDefaultValidationRegistry()
}) {
  if (!(registry instanceof ValidationCheckRegistry)) {
    throw new TypeError('registry must be a ValidationCheckRegistry');
  }
  const metrics = measureTraversalMetrics({
    traversalView,
    sourceZone,
    targetZone,
    spawnLayout,
    requiredRegions,
    requiredRoutes,
    intentionalDeadEnds,
    competitive,
    chokeThreshold: constraints.chokeThreshold ?? 1
  });
  const organicQuality = evaluateOrganicQuality(candidate, recipe);
  const context = Object.freeze({
    candidate,
    traversalView,
    spawnLayout,
    spawnRequirements,
    sourceZone,
    targetZone,
    requiredRegions,
    constraints,
    preferences,
    recipe,
    palette,
    schemaValidate,
    metrics,
    organicQuality
  });
  const checks = [];
  for (const check of registry.list()) {
    try {
      checks.push(normalizeCheckOutput(check, check.evaluate(context)));
    } catch (error) {
      checks.push(Object.freeze({
        id: check.id,
        category: check.category,
        pass: false,
        code: VALIDATION_CODES.CHECK_EXCEPTION,
        message: error?.message ?? String(error)
      }));
    }
  }
  const hardChecks = Object.freeze(checks.filter(check => check.category === 'hard'));
  const tacticalChecks = Object.freeze(checks.filter(check => check.category === 'tactical'));
  const qualityChecks = Object.freeze(checks.filter(check => check.category === 'quality'));
  const hardViolations = Object.freeze(hardChecks.filter(check => !check.pass));
  const tacticalViolations = Object.freeze(tacticalChecks.filter(check => !check.pass));
  const qualityViolations = Object.freeze(qualityChecks.filter(check => !check.pass));
  const qualityValues = qualityChecks
    .map(check => check.score)
    .filter(Number.isFinite);
  const measuredQuality = qualityValues.length > 0 ? average(qualityValues) : 0;
  return Object.freeze({
    hardValid: hardViolations.length === 0,
    tacticalPass: tacticalViolations.length === 0,
    qualityPass: qualityViolations.length === 0,
    qualityScore: quantizeFixed(measuredQuality) / 1_000_000,
    hardChecks,
    tacticalChecks,
    qualityChecks,
    hardViolations,
    tacticalViolations,
    qualityViolations,
    metrics,
    organicQuality
  });
}

function diagnosticCheck(check) {
  const featureIds = check.unreachableIds ?? check.featureIds ?? [];
  return Object.freeze({
    id: `${check.id}:${check.code.toLowerCase()}`,
    passed: check.pass,
    message: check.message,
    featureIds: Object.freeze([...featureIds].sort())
  });
}

function qualityMetric(id, value, target, passed) {
  if (!Number.isFinite(value)) return null;
  return Object.freeze({ id, value, target, passed });
}

function organicDiagnosticMetric(detail) {
  const value = typeof detail.actual === 'boolean'
    ? Number(detail.actual)
    : detail.actual;
  const target = typeof detail.threshold === 'boolean'
    ? Number(detail.threshold)
    : detail.threshold;
  if (!Number.isFinite(value) || !Number.isFinite(target)) return null;
  return qualityMetric(detail.id, value, target, detail.passed);
}

/**
 * Project a runtime validation result into the closed candidate diagnostics
 * records. Graph internals and non-finite "no route" sentinels are excluded.
 */
export function toCandidateValidationDiagnostics(result, constraints = {}) {
  const metrics = result.metrics;
  const required = metrics.requiredRegionReachability;
  const requiredRatio = required.requiredCount === 0
    ? 1
    : required.reachableCount / required.requiredCount;
  const values = [
    qualityMetric(
      'route-diversity',
      metrics.routeDiversity,
      constraints.minRouteDiversity ?? null,
      metrics.routeDiversity >= (constraints.minRouteDiversity ?? 1)
    ),
    qualityMetric(
      'required-region-reachability',
      requiredRatio,
      1,
      required.allReachable
    ),
    qualityMetric(
      'usable-area-ratio',
      metrics.usableAreaRatio,
      constraints.minUsableAreaRatio ?? null,
      metrics.usableAreaRatio >= (constraints.minUsableAreaRatio ?? 0) &&
        metrics.usableAreaRatio <= (constraints.maxUsableAreaRatio ?? 1)
    ),
    qualityMetric(
      'route-detour-ratio',
      metrics.detourRatio,
      constraints.maxDetourRatio ?? null,
      metrics.detourRatio <= (constraints.maxDetourRatio ?? Infinity)
    ),
    qualityMetric(
      'corridor-minimum-clearance',
      metrics.clearance.minimum,
      constraints.minCorridorClearance ?? null,
      metrics.clearance.minimum >= (constraints.minCorridorClearance ?? 0)
    ),
    qualityMetric(
      'corridor-choke-ratio',
      metrics.clearance.chokeRatio,
      constraints.maxChokeRatio ?? null,
      metrics.clearance.chokeRatio <= (constraints.maxChokeRatio ?? 1)
    ),
    qualityMetric(
      'accidental-dead-ends',
      metrics.deadEnds.accidental,
      constraints.maxAccidentalDeadEnds ?? null,
      metrics.deadEnds.accidental <= (constraints.maxAccidentalDeadEnds ?? Infinity)
    ),
    qualityMetric(
      'competitive-approach-parity',
      metrics.competitiveParity.approachParity,
      constraints.minApproachParity ?? null,
      metrics.competitiveParity.approachParity >= (constraints.minApproachParity ?? 0)
    ),
    qualityMetric(
      'competitive-los-parity',
      metrics.competitiveParity.lineOfSightParity,
      constraints.minLosParity ?? null,
      metrics.competitiveParity.lineOfSightParity >= (constraints.minLosParity ?? 0)
    ),
    ...(result.organicQuality?.details ?? []).map(organicDiagnosticMetric)
  ].filter(Boolean);
  return Object.freeze({
    hardValidation: Object.freeze({
      valid: result.hardValid,
      checks: Object.freeze(result.hardChecks.map(diagnosticCheck))
    }),
    tacticalValidation: Object.freeze({
      passed: result.tacticalPass,
      checks: Object.freeze(result.tacticalChecks.map(diagnosticCheck))
    }),
    qualityMetrics: Object.freeze({
      score: result.qualityScore,
      metrics: Object.freeze(values)
    })
  });
}

function validationRank(candidate) {
  const validation = candidate.validation;
  return Object.freeze([
    validation.hardValid ? 1 : 0,
    validation.tacticalPass ? 1 : 0,
    validation.qualityPass ? 1 : 0,
    -validation.hardViolations.length,
    -validation.tacticalViolations.length,
    -(validation.qualityViolations?.length ?? 0),
    quantizeFixed(validation.qualityScore),
    validation.metrics?.routeDiversity ?? 0,
    quantizeFixed(validation.metrics?.clearance?.minimum ?? 0),
    quantizeFixed(validation.metrics?.usableAreaRatio ?? 0),
    -candidate.attempt
  ]);
}

/**
 * Compare candidate records by the documented lexicographic tuple:
 * hard pass, tactical pass, quality pass, violation counts, quantized quality,
 * route diversity, clearance, usable area, attempt, then stable key.
 */
export function compareValidationCandidates(left, right) {
  const leftRank = validationRank(left);
  const rightRank = validationRank(right);
  for (let index = 0; index < leftRank.length; index++) {
    if (leftRank[index] !== rightRank[index]) return rightRank[index] - leftRank[index];
  }
  const leftKey = String(left.stableKey);
  const rightKey = String(right.stableKey);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

export function selectBestValidationCandidate(
  candidates,
  {
    requireTacticalPass = true,
    requireQualityPass = false
  } = {}
) {
  const eligible = (candidates ?? []).filter(candidate =>
    candidate.validation?.hardValid === true &&
    (!requireTacticalPass || candidate.validation?.tacticalPass === true) &&
    (!requireQualityPass || candidate.validation?.qualityPass === true)
  );
  if (eligible.length === 0) return null;
  return [...eligible].sort(compareValidationCandidates)[0];
}

export class CandidateSelectionError extends Error {
  constructor(code, message, attempts) {
    super(message);
    this.name = 'CandidateSelectionError';
    this.code = code;
    this.attempts = Object.freeze(attempts);
  }
}

/**
 * Generate, validate, rank, and select from a deterministic bounded attempt
 * set. All attempts are evaluated so quality ranking cannot depend on an early
 * return or execution timing.
 */
export async function runBoundedCandidateSelection({
  terrainSeed,
  terrainGenerationVersion = 2,
  maxAttempts,
  generateCandidate,
  validateCandidate,
  stableKey = (candidate, attempt) => candidate?.id ?? `attempt:${attempt}`,
  requireTacticalPass = true,
  requireQualityPass = false
}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError('maxAttempts must be a positive integer');
  }
  if (typeof generateCandidate !== 'function' || typeof validateCandidate !== 'function') {
    throw new TypeError('generateCandidate and validateCandidate must be functions');
  }
  const attempts = [];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const attemptSeed = deriveAttemptSeed(
      terrainSeed,
      terrainGenerationVersion,
      attempt
    );
    let candidate = null;
    let validation;
    let attemptError = null;
    try {
      candidate = await generateCandidate({ attempt, attemptSeed });
      validation = await validateCandidate(candidate, { attempt, attemptSeed });
    } catch (error) {
      attemptError = Object.freeze({
        code: typeof error?.code === 'string'
          ? error.code
          : VALIDATION_CODES.ATTEMPT_ERROR,
        message: error?.message ?? String(error)
      });
      validation = Object.freeze({
        hardValid: false,
        tacticalPass: false,
        qualityPass: false,
        qualityScore: 0,
        hardViolations: Object.freeze([attemptError]),
        tacticalViolations: Object.freeze([]),
        qualityViolations: Object.freeze([]),
        metrics: Object.freeze({
          routeDiversity: 0,
          clearance: Object.freeze({ minimum: 0 }),
          usableAreaRatio: 0
        })
      });
    }
    attempts.push(Object.freeze({
      attempt,
      attemptSeed,
      stableKey: String(stableKey(candidate, attempt)),
      candidate,
      validation,
      error: attemptError
    }));
  }
  const selected = selectBestValidationCandidate(
    attempts,
    { requireTacticalPass, requireQualityPass }
  );
  if (!selected) {
    throw new CandidateSelectionError(
      'ATTEMPT_BUDGET_EXHAUSTED',
      `No acceptable V2 candidate after ${maxAttempts} deterministic attempts`,
      attempts
    );
  }
  return Object.freeze({
    selected,
    attempts: Object.freeze(attempts)
  });
}
