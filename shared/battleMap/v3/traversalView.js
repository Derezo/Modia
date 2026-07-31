import {
  calculateTraversalPathCost,
  createTraversalView,
  findTraversalPath,
  getStepCost as getTraversalStepCost,
  getReachableTilesForTraversal
} from '../../traversal.js';
import {
  assertBattleMapV3Candidate,
  assertBattleMapV3Final
} from './schema.js';

const DIRECTIONS = Object.freeze({
  n: Object.freeze({ dx: 0, dy: -1, reverse: 's' }),
  e: Object.freeze({ dx: 1, dy: 0, reverse: 'w' }),
  s: Object.freeze({ dx: 0, dy: 1, reverse: 'n' }),
  w: Object.freeze({ dx: -1, dy: 0, reverse: 'e' })
});

function assertMap(map) {
  if (map && Object.prototype.hasOwnProperty.call(map, 'hashes')) {
    return assertBattleMapV3Final(map);
  }
  return assertBattleMapV3Candidate(map);
}

function createGrid(width, height, fill = null) {
  return Array.from({ length: height }, () => Array(width).fill(fill));
}

function obstacleGrid(map) {
  const grid = createGrid(map.dimensions.width, map.dimensions.height);
  for (const obstacle of map.obstacles) {
    for (const cell of obstacle.cells) {
      if (grid[cell.y][cell.x] !== null) {
        const error = new TypeError(`multiple blocking obstacles occupy ${cell.x},${cell.y}`);
        error.code = 'INVALID_BATTLE_MAP_V3_TOPOLOGY';
        throw error;
      }
      grid[cell.y][cell.x] = Object.freeze({
        id: obstacle.id,
        type: obstacle.kind,
        passable: false
      });
    }
  }
  return grid;
}

function connectionGrid(map) {
  const grid = Array.from(
    { length: map.dimensions.height },
    () => Array.from({ length: map.dimensions.width }, () => Object.create(null))
  );
  const install = (cell, direction, record) => {
    if (grid[cell.y][cell.x][direction]) {
      const error = new TypeError(
        `ambiguous elevation connection at ${cell.x},${cell.y}:${direction}`
      );
      error.code = 'INVALID_BATTLE_MAP_V3_TOPOLOGY';
      throw error;
    }
    grid[cell.y][cell.x][direction] = Object.freeze({
      id: record.id,
      type: record.kind === 'slope' ? 'ramp' : record.kind === 'flat' ? null : record.kind,
      traversable: record.traversable,
      levels: Math.abs(record.heightDelta)
    });
  };
  for (const record of map.elevationConnections) {
    install(record.from, record.direction, record);
    if (record.bidirectional) {
      install(record.to, DIRECTIONS[record.direction].reverse, record);
    }
  }
  return grid;
}

/**
 * Build the occupancy-free/static or runtime V3 traversal view.
 *
 * V3 elevation edges fail closed: a non-level step requires an explicit
 * compiler-authored traversable connection. A caller hook may further
 * restrict traversal but cannot make a compiler-blocked edge legal.
 */
export function createBattleMapV3TraversalView(map, {
  units = [],
  movementPolicy = {}
} = {}) {
  assertMap(map);
  if (!movementPolicy || typeof movementPolicy !== 'object' || Array.isArray(movementPolicy)) {
    throw new TypeError('movementPolicy must be an object');
  }
  const callerElevationHook = movementPolicy.canTraverseElevation;
  const strictPolicy = {
    ...movementPolicy,
    canTraverseElevation(context) {
      const level = context.fromElevation === context.toElevation;
      const compilerAllows = level
        ? context.connection === null || context.connection?.traversable !== false
        : context.connection?.traversable === true;
      if (!compilerAllows) return false;
      return callerElevationHook ? callerElevationHook(context) !== false : true;
    }
  };
  return createTraversalView({
    terrain: map.terrain,
    obstacles: obstacleGrid(map),
    elevation: map.elevation,
    elevationConnections: connectionGrid(map),
    elevationFormat: 'discrete',
    playableMask: map.playableMask,
    units,
    dimensions: map.dimensions,
    movementPolicy: strictPolicy
  });
}

function pointKey(point) {
  return `${point.x},${point.y}`;
}

function undirectedEdgeKey(from, to) {
  return [pointKey(from), pointKey(to)].sort().join('~');
}

function fail(messages) {
  const error = new TypeError(`BattleMapV3 topology validation failed:\n${messages.join('\n')}`);
  error.code = 'INVALID_BATTLE_MAP_V3_TOPOLOGY';
  error.validationErrors = messages;
  throw error;
}

function countVertexIndependentExitPaths(view, anchor, exits, limit) {
  const { width, height } = view.dimensions;
  const cellIndex = point => point.y * width + point.x;
  const source = width * height * 2;
  const sink = source + 1;
  const graph = Array.from({ length: sink + 1 }, () => []);
  const addEdge = (from, to, capacity) => {
    const forward = { to, reverse: graph[to].length, capacity };
    const reverse = { to: from, reverse: graph[from].length, capacity: 0 };
    graph[from].push(forward);
    graph[to].push(reverse);
  };
  const exitKeys = new Set(exits.map(exit => pointKey(exit.cell)));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = { x, y };
      if (view.playableMask[y][x] !== true || view.terrain[y][x]?.passable !== true
        || view.obstacles?.[y]?.[x]) continue;
      const index = cellIndex(cell);
      const isAnchor = pointKey(cell) === pointKey(anchor);
      addEdge(index * 2, index * 2 + 1, isAnchor ? limit : 1);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const neighbor = { x: x + dx, y: y + dy };
        if (neighbor.x < 0 || neighbor.y < 0 || neighbor.x >= width || neighbor.y >= height) {
          continue;
        }
        if (Number.isFinite(getTraversalStepCost(view, cell, neighbor, {
          start: anchor,
          goal: neighbor
        }))) {
          addEdge(index * 2 + 1, cellIndex(neighbor) * 2, limit);
        }
      }
      if (exitKeys.has(pointKey(cell))) addEdge(index * 2 + 1, sink, 1);
    }
  }
  addEdge(source, cellIndex(anchor) * 2, limit);
  let flow = 0;
  while (flow < limit) {
    const levels = Array(graph.length).fill(-1);
    levels[source] = 0;
    const queue = [source];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const node = queue[cursor];
      for (const edge of graph[node]) {
        if (edge.capacity > 0 && levels[edge.to] < 0) {
          levels[edge.to] = levels[node] + 1;
          queue.push(edge.to);
        }
      }
    }
    if (levels[sink] < 0) break;
    const cursors = Array(graph.length).fill(0);
    const send = (node, amount) => {
      if (node === sink) return amount;
      for (; cursors[node] < graph[node].length; cursors[node] += 1) {
        const edge = graph[node][cursors[node]];
        if (edge.capacity <= 0 || levels[edge.to] !== levels[node] + 1) continue;
        const sent = send(edge.to, Math.min(amount, edge.capacity));
        if (sent > 0) {
          edge.capacity -= sent;
          graph[edge.to][edge.reverse].capacity += sent;
          return sent;
        }
      }
      return 0;
    };
    let sent;
    while ((sent = send(source, limit - flow)) > 0) flow += sent;
  }
  return flow;
}

/**
 * Validate topology facts intentionally outside the structural V3 schema.
 */
export function assertBattleMapV3Topology(map) {
  assertMap(map);
  const errors = [];
  const connections = new Map();
  for (const connection of map.elevationConnections) {
    const key = undirectedEdgeKey(connection.from, connection.to);
    if (connections.has(key)) errors.push(`ambiguous duplicate connection edge ${key}`);
    connections.set(key, connection);
    if (connection.traversable
      && Math.abs(connection.heightDelta)
        > map.spawnContract.minimumRouteConstraints.maximumTraversableElevationDelta) {
      errors.push(
        `traversable connection ${connection.id} exceeds maximumTraversableElevationDelta`
      );
    }
  }

  const { width, height } = map.dimensions;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (map.playableMask[y][x] !== true || map.terrain[y][x]?.passable !== true) continue;
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= width || ny >= height
          || map.playableMask[ny][nx] !== true
          || map.terrain[ny][nx]?.passable !== true) continue;
        const from = { x, y };
        const to = { x: nx, y: ny };
        const delta = map.elevation[ny][nx] - map.elevation[y][x];
        const connection = connections.get(undirectedEdgeKey(from, to));
        if (delta === 0) {
          if (connection && (connection.kind !== 'flat' || connection.traversable !== true
            || connection.bidirectional !== true)) {
            errors.push(`level playable edge ${x},${y}~${nx},${ny} must be an optional traversable flat connection`);
          }
        } else if (Math.abs(delta) === 1) {
          // An omitted connection is an intentional, compiler-rendered terrace
          // face and therefore blocks movement. Only authored crossings need a
          // connection record.
          if (connection && (
            !['slope', 'stairs'].includes(connection.kind)
            || connection.traversable !== true
            || connection.bidirectional !== true
          )) {
            errors.push(`authored one-level crossing ${x},${y}~${nx},${ny} must be a bidirectional traversable slope or stairs`);
          }
        } else if (connection && (
          connection.kind !== 'cliff'
          || connection.traversable !== false
        )) {
          errors.push(`authored multi-level edge ${x},${y}~${nx},${ny} must be a blocked cliff`);
        }
      }
    }
  }
  if (errors.length > 0) fail(errors);

  const view = createBattleMapV3TraversalView(map, {
    movementPolicy: { ignoreUnits: true }
  });
  for (const route of map.routes) {
    if (!route.required) continue;
    for (let index = 1; index < route.cells.length; index += 1) {
      const previous = route.cells[index - 1];
      const current = route.cells[index];
      if (Math.abs(previous.x - current.x) + Math.abs(previous.y - current.y) !== 1) {
        errors.push(`required route ${route.id} is not a cardinal centerline at index ${index}`);
      } else if (!Number.isFinite(getTraversalStepCost(view, previous, current, {
        start: previous,
        goal: current
      }))) {
        errors.push(`required route ${route.id} is blocked at index ${index}`);
      }
    }
  }

  const exitsBySide = side => map.spawnContract.exits.filter(exit => exit.side === side);
  const opponentExits = exitsBySide('opponent');
  const annotations = new Map(
    map.spawnContract.tacticalAnnotations.map(annotation => [annotation.id, annotation])
  );
  const candidateByCell = new Map(
    map.spawnContract.opponentCandidates.map(candidate => [pointKey(candidate.cell), candidate])
  );
  const explicitCandidateIds = new Set(
    map.spawnContract.opponentCandidates.map(candidate => candidate.id)
  );
  const zoneOwnerByCell = new Map();
  const eligibleByZone = new Map();
  const eligibleCandidates = [];
  const blockingCells = new Set(
    map.obstacles.flatMap(obstacle => obstacle.cells.map(pointKey))
  );
  const playerSlotsById = new Map(
    map.spawnContract.playerSlots.map(slot => [slot.id, slot.cell])
  );
  const playerProtected = map.spawnContract.protectedClearances
    .filter(clearance => clearance.side === 'player')
    .map(clearance => ({ ...clearance, cell: playerSlotsById.get(clearance.anchorId) }));
  for (const zone of map.spawnContract.opponentZones) {
    eligibleByZone.set(zone.id, 0);
    for (const cell of zone.cells) {
      const key = pointKey(cell);
      if (zoneOwnerByCell.has(key) && zoneOwnerByCell.get(key) !== zone.id) {
        errors.push(`opponent candidate cell ${key} belongs to multiple zones`);
      }
      zoneOwnerByCell.set(key, zone.id);
    }
  }
  let unzonedEligible = 0;
  const pool = new Map();
  for (const zone of map.spawnContract.opponentZones) {
    zone.cells.forEach(cell => pool.set(pointKey(cell), cell));
  }
  map.spawnContract.opponentCandidates.forEach(candidate =>
    pool.set(pointKey(candidate.cell), candidate.cell)
  );
  for (const [key, cell] of pool) {
    const candidate = candidateByCell.get(key);
    const owningZoneId = zoneOwnerByCell.get(key) ?? null;
    if (candidate && candidate.zoneId !== owningZoneId) {
      errors.push(`candidate ${candidate.id} zoneId does not match zone ownership at ${key}`);
      continue;
    }
    const zone = owningZoneId === null
      ? null
      : map.spawnContract.opponentZones.find(record => record.id === owningZoneId);
    const tags = new Set([...(zone?.tags ?? []), ...(candidate?.tags ?? [])]);
    for (const annotationId of candidate?.tacticalAnnotationIds ?? []) {
      const annotation = annotations.get(annotationId);
      if (annotation) {
        if (!annotation.cells.some(annotationCell => pointKey(annotationCell) === key)) {
          errors.push(`candidate ${candidate.id} references annotation ${annotationId} outside its cells`);
          continue;
        }
        tags.add(annotation.kind);
        annotation.tags.forEach(tag => tags.add(tag));
      }
    }
    if (tags.has('no-spawn')) continue;
    const minimumClearance = candidate?.minimumClearance ?? 0;
    let staticClearance = true;
    for (let dy = -minimumClearance; dy <= minimumClearance && staticClearance; dy += 1) {
      for (let dx = -minimumClearance; dx <= minimumClearance; dx += 1) {
        if (Math.abs(dx) + Math.abs(dy) > minimumClearance) continue;
        const x = cell.x + dx;
        const y = cell.y + dy;
        if (x < 0 || y < 0 || x >= width || y >= height
          || map.playableMask[y][x] !== true
          || map.terrain[y][x]?.passable !== true
          || blockingCells.has(`${x},${y}`)) {
          staticClearance = false;
          break;
        }
      }
    }
    if (!staticClearance || playerProtected.some(clearance =>
      clearance.cell
      && Math.abs(clearance.cell.x - cell.x) + Math.abs(clearance.cell.y - cell.y)
        <= clearance.radius
    )) continue;
    const reachable = opponentExits.some(exit =>
      Number.isFinite(calculateTraversalPathCost(view, { start: cell, goal: exit.cell }))
    );
    if (!reachable) {
      errors.push(`opponent candidate pool cell ${key} cannot reach a required opponent exit`);
      continue;
    }
    const candidateId = candidate?.id ?? `zone:${owningZoneId}:${cell.x}:${cell.y}`;
    if (!candidate && explicitCandidateIds.has(candidateId)) {
      errors.push(`generated zone candidate id ${candidateId} collides with an explicit candidate`);
      continue;
    }
    eligibleCandidates.push({
      id: candidateId,
      cell,
      zoneId: owningZoneId,
      minimumClearance
    });
    if (owningZoneId === null) unzonedEligible += 1;
    else eligibleByZone.set(owningZoneId, eligibleByZone.get(owningZoneId) + 1);
  }
  const assignableCapacity = unzonedEligible
    + map.spawnContract.opponentZones.reduce(
      (total, zone) => total + Math.min(zone.capacity, eligibleByZone.get(zone.id) ?? 0),
      0
    );
  if (assignableCapacity < map.spawnContract.capacities.maxAssignableOpponents) {
    errors.push(
      `usable opponent capacity ${assignableCapacity} is below maxAssignableOpponents `
      + `${map.spawnContract.capacities.maxAssignableOpponents}`
    );
  } else {
    const target = map.spawnContract.capacities.maxAssignableOpponents;
    const zoneCapacities = new Map(
      map.spawnContract.opponentZones.map(zone => [zone.id, zone.capacity])
    );
    const opponentProtected = map.spawnContract.protectedClearances
      .filter(clearance => clearance.side === 'opponent');
    const selected = [];
    const zoneCounts = new Map();
    let capacitySearchNodes = 0;
    let capacitySearchExhausted = false;
    const occupancyLegal = () => {
      const playerAssignments = map.spawnContract.playerSlots.map(slot => ({
        side: 'player',
        cell: slot.cell
      }));
      const opponentAssignments = selected.map(candidate => ({
        side: 'opponent',
        cell: candidate.cell
      }));
      const occupiedView = createBattleMapV3TraversalView(map, {
        units: [...playerAssignments, ...opponentAssignments].map((assignment, index) => ({
          id: `validation:${index}`,
          x: assignment.cell.x,
          y: assignment.cell.y,
          hp: 1
        }))
      });
      return [...playerAssignments, ...opponentAssignments].every(assignment =>
        exitsBySide(assignment.side).some(exit =>
          Number.isFinite(calculateTraversalPathCost(occupiedView, {
            start: assignment.cell,
            goal: exit.cell
          }))
        )
      );
    };
    const search = start => {
      if (capacitySearchExhausted) return false;
      capacitySearchNodes += 1;
      if (capacitySearchNodes > 25_000) {
        capacitySearchExhausted = true;
        errors.push('opponent capacity validation exceeded deterministic work limit 25000');
        return false;
      }
      if (selected.length === target) return occupancyLegal();
      if (eligibleCandidates.length - start < target - selected.length) return false;
      for (let index = start; index < eligibleCandidates.length; index += 1) {
        const candidate = eligibleCandidates[index];
        if (candidate.zoneId !== null
          && (zoneCounts.get(candidate.zoneId) ?? 0) >= zoneCapacities.get(candidate.zoneId)) {
          continue;
        }
        const compatible = selected.every(other => {
          const distance = Math.abs(candidate.cell.x - other.cell.x)
            + Math.abs(candidate.cell.y - other.cell.y);
          if (distance <= Math.max(candidate.minimumClearance, other.minimumClearance)) {
            return false;
          }
          return opponentProtected.every(clearance =>
            ![candidate.id, other.id].includes(clearance.anchorId)
            || distance > clearance.radius
          );
        });
        if (!compatible) continue;
        selected.push(candidate);
        if (candidate.zoneId !== null) {
          zoneCounts.set(candidate.zoneId, (zoneCounts.get(candidate.zoneId) ?? 0) + 1);
        }
        if (search(index + 1)) return true;
        selected.pop();
        if (candidate.zoneId !== null) {
          const count = zoneCounts.get(candidate.zoneId) - 1;
          if (count === 0) zoneCounts.delete(candidate.zoneId);
          else zoneCounts.set(candidate.zoneId, count);
        }
      }
      return false;
    };
    if (!search(0)) {
      errors.push(
        `opponent clearance and zone constraints cannot satisfy maxAssignableOpponents ${target}`
      );
    }
  }

  const anchorsBySide = side => side === 'player'
    ? map.spawnContract.playerSlots.map(slot => slot.cell)
    : [...pool.values()];
  for (const side of ['player', 'opponent']) {
    const exits = exitsBySide(side);
    const exitCells = exits.map(exit => pointKey(exit.cell));
    const approachIds = exits.map(exit => exit.approachRegionId);
    if (new Set(exitCells).size !== exitCells.length) {
      errors.push(`${side} exits must use distinct cells`);
    }
    if (new Set(approachIds).size !== approachIds.length) {
      errors.push(`${side} exits must use distinct approach regions`);
    }
    for (const anchor of anchorsBySide(side)) {
      if (!exits.some(exit => Number.isFinite(calculateTraversalPathCost(view, {
        start: anchor,
        goal: exit.cell
      })))) {
        errors.push(`${side} spawn ${pointKey(anchor)} cannot reach a required ${side} exit`);
      }
    }
    const required = map.spawnContract.minimumRouteConstraints.minimumIndependentExits;
    for (const anchor of anchorsBySide(side)) {
      if (countVertexIndependentExitPaths(view, anchor, exits, required) < required) {
        errors.push(
          `${side} spawn ${pointKey(anchor)} does not have ${required} vertex-independent exit paths`
        );
      }
    }
  }
  if (map.spawnContract.minimumRouteConstraints.requireMutualReachability) {
    const exits = map.spawnContract.exits;
    for (let left = 0; left < exits.length; left += 1) {
      for (let right = left + 1; right < exits.length; right += 1) {
        if (!Number.isFinite(calculateTraversalPathCost(view, {
          start: exits[left].cell,
          goal: exits[right].cell
        }))) {
          errors.push(`required exits ${exits[left].id} and ${exits[right].id} are not mutually reachable`);
        }
      }
    }
  }
  if (errors.length > 0) fail(errors);
  return map;
}

export {
  calculateTraversalPathCost,
  findTraversalPath,
  getReachableTilesForTraversal
};
