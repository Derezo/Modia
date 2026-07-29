import {
  V2_QUANTIZATION_SCALE,
  coordinateHash32,
  deriveStreamSeed
} from './Determinism.js';
import { deepFreeze } from './V2Context.js';

const SCALE = V2_QUANTIZATION_SCALE;
const FLOW_NEIGHBORS = Object.freeze([
  Object.freeze({ dx: 0, dy: -1, direction: 'n' }),
  Object.freeze({ dx: 1, dy: -1, direction: 'ne' }),
  Object.freeze({ dx: 1, dy: 0, direction: 'e' }),
  Object.freeze({ dx: 1, dy: 1, direction: 'se' }),
  Object.freeze({ dx: 0, dy: 1, direction: 's' }),
  Object.freeze({ dx: -1, dy: 1, direction: 'sw' }),
  Object.freeze({ dx: -1, dy: 0, direction: 'w' }),
  Object.freeze({ dx: -1, dy: -1, direction: 'nw' })
]);
const CARDINAL = Object.freeze(FLOW_NEIGHBORS.filter(step =>
  step.dx === 0 || step.dy === 0
));

function createGrid(width, height, value) {
  return Array.from({ length: height }, () =>
    Array.from({ length: width }, () => (
      typeof value === 'function' ? value() : value
    ))
  );
}

function copyCoordinate(cell) {
  return { x: cell.x, y: cell.y };
}

function compareCoordinates(a, b) {
  return a.y - b.y || a.x - b.x;
}

function keyOf(x, y) {
  return `${x},${y}`;
}

function inBounds(x, y, width, height) {
  return x >= 0 && x < width && y >= 0 && y < height;
}

function isBoundary(x, y, width, height) {
  return x === 0 || y === 0 || x === width - 1 || y === height - 1;
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
      if (!predicate(value)) {
        throw new TypeError(`${name}[${y}][${x}] contains an invalid value`);
      }
    });
  });
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
      if (this.compare(values[child], last) >= 0) break;
      values[index] = values[child];
      index = child;
    }
    values[index] = last;
    return first;
  }
}

function makeStructureMask(width, height, structureFootprints) {
  const structureMask = createGrid(width, height, false);
  const footprintCells = [];
  for (const entry of structureFootprints) {
    if (entry && Number.isInteger(entry.x) && Number.isInteger(entry.y)) {
      footprintCells.push(entry);
      continue;
    }
    if (Array.isArray(entry?.footprint)) footprintCells.push(...entry.footprint);
  }
  for (const cell of footprintCells) {
    if (!cell || !Number.isInteger(cell.x) || !Number.isInteger(cell.y) ||
        !inBounds(cell.x, cell.y, width, height)) {
      throw new TypeError('structureFootprints contains an invalid coordinate');
    }
    structureMask[cell.y][cell.x] = true;
  }
  return structureMask;
}

function makeExcludedMask(width, height, spawnLayout, structureFootprints) {
  const excluded = spawnLayout.coreMask.map(row => [...row]);
  const structureMask = makeStructureMask(width, height, structureFootprints);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (structureMask[y][x]) excluded[y][x] = true;
    }
  }
  return excluded;
}

function basinSeeds({
  width,
  height,
  rawHeight,
  moisture,
  excludedMask,
  count,
  attemptSeed
}) {
  if (count === 0) return [];
  const seed = deriveStreamSeed(attemptSeed, 'hydrology:intentional-basins');
  const candidates = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (excludedMask[y][x]) continue;
      candidates.push({
        x,
        y,
        score: rawHeight[y][x] * 3 - moisture[y][x],
        tie: coordinateHash32(seed, x, y, 'basin-rank')
      });
    }
  }
  candidates.sort((a, b) =>
    a.score - b.score || a.tie - b.tie || compareCoordinates(a, b)
  );
  const minimumSpacing = Math.max(3, Math.floor(Math.min(width, height) / 5));
  const selected = [];
  for (const candidate of candidates) {
    if (selected.some(other =>
      Math.abs(other.x - candidate.x) + Math.abs(other.y - candidate.y) < minimumSpacing
    )) continue;
    selected.push(candidate);
    if (selected.length === count) break;
  }
  return selected.map(copyCoordinate);
}

function growIntentionalBasins({
  seeds,
  rawHeight,
  excludedMask,
  maximumCoverageTiles,
  retainedBasinArea
}) {
  const height = rawHeight.length;
  const width = rawHeight[0].length;
  const maximumAreaPerBasin = Math.max(
    1,
    Math.min(
      maximumCoverageTiles,
      retainedBasinArea
    )
  );
  return seeds.map(seed => {
    const accepted = [];
    const visited = new Set([keyOf(seed.x, seed.y)]);
    const heap = new StableMinHeap((a, b) =>
      a.height - b.height || a.distance - b.distance || compareCoordinates(a, b)
    );
    heap.push({ ...seed, height: rawHeight[seed.y][seed.x], distance: 0 });
    const riseAllowance = Math.max(
      80_000,
      Math.floor((SCALE - rawHeight[seed.y][seed.x]) / 7)
    );
    while (heap.size > 0 && accepted.length < maximumAreaPerBasin) {
      const current = heap.pop();
      if (excludedMask[current.y][current.x] ||
          rawHeight[current.y][current.x] >
            rawHeight[seed.y][seed.x] + riseAllowance) continue;
      accepted.push(copyCoordinate(current));
      for (const step of CARDINAL) {
        const x = current.x + step.dx;
        const y = current.y + step.dy;
        const key = keyOf(x, y);
        if (!inBounds(x, y, width, height) || isBoundary(x, y, width, height) ||
            visited.has(key)) continue;
        visited.add(key);
        heap.push({
          x,
          y,
          height: rawHeight[y][x],
          distance: current.distance + 1
        });
      }
    }
    accepted.sort(compareCoordinates);
    return { seed, cells: accepted };
  });
}

/**
 * Deterministic Priority-Flood conditioning. Intentional basin seeds are
 * additional legal outlets; every other discovered cell receives a parent
 * that was already settled, so its parent chain is acyclic and terminates at
 * an edge or a declared basin.
 */
export function conditionHeightWithPriorityFlood({
  heightField,
  attemptSeed,
  intentionalBasinSeeds = [],
  scanOrder = 'row-major'
}) {
  const height = heightField?.length ?? 0;
  const width = heightField?.[0]?.length ?? 0;
  if (width === 0 || height === 0) throw new TypeError('heightField cannot be empty');
  assertGrid(
    heightField,
    'heightField',
    width,
    height,
    value => Number.isSafeInteger(value) && value >= -SCALE && value <= SCALE
  );
  if (scanOrder !== 'row-major' && scanOrder !== 'reverse') {
    throw new TypeError(`Unsupported hydrology scan order: ${String(scanOrder)}`);
  }
  const tieSeed = deriveStreamSeed(attemptSeed, 'hydrology:priority-flood');
  const conditionedHeight = heightField.map(row => [...row]);
  const flowDirection = createGrid(width, height, null);
  const visited = createGrid(width, height, false);
  const settlementOrder = [];
  const heap = new StableMinHeap((a, b) =>
    a.height - b.height || a.tie - b.tie || compareCoordinates(a, b)
  );
  const addOutlet = (x, y, outletKind) => {
    if (visited[y][x]) return;
    visited[y][x] = true;
    heap.push({
      x,
      y,
      height: conditionedHeight[y][x],
      tie: coordinateHash32(tieSeed, x, y, `outlet:${outletKind}`),
      outletKind
    });
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isBoundary(x, y, width, height)) addOutlet(x, y, 'edge');
    }
  }
  for (const cell of [...intentionalBasinSeeds].sort(compareCoordinates)) {
    if (!cell || !Number.isInteger(cell.x) || !Number.isInteger(cell.y) ||
        !inBounds(cell.x, cell.y, width, height)) {
      throw new TypeError('intentionalBasinSeeds contains an invalid coordinate');
    }
    addOutlet(cell.x, cell.y, 'intentional-basin');
  }

  while (heap.size > 0) {
    const current = heap.pop();
    settlementOrder.push({
      x: current.x,
      y: current.y,
      outletKind: current.outletKind ?? null
    });
    for (const step of FLOW_NEIGHBORS) {
      const x = current.x + step.dx;
      const y = current.y + step.dy;
      if (!inBounds(x, y, width, height) || visited[y][x]) continue;
      visited[y][x] = true;
      conditionedHeight[y][x] = Math.max(
        conditionedHeight[y][x],
        conditionedHeight[current.y][current.x]
      );
      flowDirection[y][x] = {
        x: current.x,
        y: current.y,
        direction: FLOW_NEIGHBORS.find(candidate =>
          candidate.dx === -step.dx && candidate.dy === -step.dy
        ).direction
      };
      heap.push({
        x,
        y,
        height: conditionedHeight[y][x],
        tie: coordinateHash32(tieSeed, x, y, 'settled'),
        outletKind: null
      });
    }
  }

  const accumulation = createGrid(width, height, 1);
  for (let index = settlementOrder.length - 1; index >= 0; index--) {
    const { x, y } = settlementOrder[index];
    const downstream = flowDirection[y][x];
    if (downstream) {
      accumulation[downstream.y][downstream.x] += accumulation[y][x];
    }
  }
  return deepFreeze({
    algorithm: 'priority-flood-v1',
    conditionedHeight,
    flowDirection,
    accumulation,
    settlementOrder
  });
}

function traceDownstream(flowDirection, source, width, height) {
  const chain = [];
  const visited = new Set();
  let current = source;
  while (current) {
    const key = keyOf(current.x, current.y);
    if (visited.has(key) || chain.length > width * height) {
      throw new Error(`Hydrology downstream cycle at ${key}`);
    }
    visited.add(key);
    chain.push(copyCoordinate(current));
    current = flowDirection[current.y][current.x];
  }
  return chain;
}

function directionBetween(a, b) {
  return {
    dx: Math.sign(b.x - a.x),
    dy: Math.sign(b.y - a.y)
  };
}

function pathQuality(path) {
  let maximumAxisRun = 0;
  let currentAxisRun = 0;
  let priorDirection = null;
  let alternatingTurns = 0;
  let maximumStairStepTurns = 0;
  let priorTurn = 0;
  for (let index = 1; index < path.length; index++) {
    const direction = directionBetween(path[index - 1], path[index]);
    const axis = direction.dx === 0 || direction.dy === 0;
    if (axis && priorDirection &&
        direction.dx === priorDirection.dx && direction.dy === priorDirection.dy) {
      currentAxisRun++;
    } else {
      currentAxisRun = axis ? 1 : 0;
    }
    maximumAxisRun = Math.max(maximumAxisRun, currentAxisRun);
    if (priorDirection) {
      const turn = priorDirection.dx * direction.dy - priorDirection.dy * direction.dx;
      const rightAngle = (priorDirection.dx === 0) !== (direction.dx === 0) &&
        (priorDirection.dy === 0) !== (direction.dy === 0);
      if (rightAngle && turn !== 0 && priorTurn !== 0 && turn === -priorTurn) {
        alternatingTurns++;
      } else {
        alternatingTurns = rightAngle ? 1 : 0;
      }
      maximumStairStepTurns = Math.max(maximumStairStepTurns, alternatingTurns);
      if (turn !== 0) priorTurn = turn;
    }
    priorDirection = direction;
  }
  return { maximumAxisRun, maximumStairStepTurns };
}

function widthForAccumulation(accumulation, minimumArea, maximumWidth) {
  let width = 1;
  let threshold = Math.max(1, minimumArea);
  while (width < maximumWidth && accumulation >= threshold * 2) {
    width++;
    threshold *= 2;
  }
  return width;
}

function normalOffsets(previous, current, next, width, tie) {
  const direction = next
    ? directionBetween(current, next)
    : previous
      ? directionBetween(previous, current)
      : { dx: 1, dy: 0 };
  let normal = Math.abs(direction.dx) >= Math.abs(direction.dy)
    ? { dx: 0, dy: 1 }
    : { dx: 1, dy: 0 };
  if ((tie & 1) === 1) normal = { dx: -normal.dx, dy: -normal.dy };
  const offsets = [{ dx: 0, dy: 0 }];
  for (let distance = 1; offsets.length < width; distance++) {
    offsets.push({ dx: normal.dx * distance, dy: normal.dy * distance });
    if (offsets.length < width) {
      offsets.push({ dx: -normal.dx * distance, dy: -normal.dy * distance });
    }
  }
  return offsets;
}

function stampChannel({
  centerline,
  widths,
  width,
  height,
  excludedMask,
  maximumCells,
  attemptSeed,
  existingCells = new Map(),
  occupiedCells = new Set()
}) {
  const cells = new Map(existingCells);
  const widthSeed = deriveStreamSeed(attemptSeed, 'hydrology:channel-width');
  const connectivitySeed = deriveStreamSeed(
    attemptSeed,
    'hydrology:channel-connectivity'
  );
  const spine = [];
  for (let index = 0; index < centerline.length; index++) {
    const current = centerline[index];
    if (index > 0) {
      const previous = centerline[index - 1];
      const dx = current.x - previous.x;
      const dy = current.y - previous.y;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1 ||
          (dx === 0 && dy === 0)) return null;
      if (dx !== 0 && dy !== 0) {
        const bridges = [
          { x: current.x, y: previous.y },
          { x: previous.x, y: current.y }
        ].filter(cell =>
          inBounds(cell.x, cell.y, width, height) &&
          !excludedMask[cell.y][cell.x]
        ).sort((a, b) =>
          coordinateHash32(
            connectivitySeed,
            a.x,
            a.y,
            `bridge:${previous.x},${previous.y}:${current.x},${current.y}`
          ) -
          coordinateHash32(
            connectivitySeed,
            b.x,
            b.y,
            `bridge:${previous.x},${previous.y}:${current.x},${current.y}`
          ) ||
          compareCoordinates(a, b)
        );
        if (bridges.length === 0) return null;
        spine.push(bridges[0]);
      }
    }
    spine.push(current);
  }
  const requiredAdditions = new Map();
  for (const cell of spine) {
    const key = keyOf(cell.x, cell.y);
    if (occupiedCells.has(key) && !cells.has(key)) return null;
    if (!cells.has(key)) requiredAdditions.set(key, cell);
  }
  if (cells.size + requiredAdditions.size > maximumCells) return null;
  for (const [key, cell] of requiredAdditions) {
    cells.set(key, copyCoordinate(cell));
  }

  const joinsStampedChannel = (x, y) => CARDINAL.some(step =>
    cells.has(keyOf(x + step.dx, y + step.dy))
  );
  for (let index = 0; index < centerline.length; index++) {
    const current = centerline[index];
    const offsets = normalOffsets(
      centerline[index - 1],
      current,
      centerline[index + 1],
      widths[index],
      coordinateHash32(widthSeed, current.x, current.y, 'bank-side')
    );
    for (const offset of offsets) {
      const x = current.x + offset.dx;
      const y = current.y + offset.dy;
      if (!inBounds(x, y, width, height) || excludedMask[y][x]) continue;
      const key = keyOf(x, y);
      if (!cells.has(key) &&
          (occupiedCells.has(key) ||
           cells.size >= maximumCells ||
           !joinsStampedChannel(x, y))) continue;
      cells.set(key, { x, y });
    }
  }
  return cells;
}

function boundsFor(cells) {
  return {
    minX: Math.min(...cells.map(cell => cell.x)),
    minY: Math.min(...cells.map(cell => cell.y)),
    maxX: Math.max(...cells.map(cell => cell.x)),
    maxY: Math.max(...cells.map(cell => cell.y))
  };
}

function seedConnectedAvailableCells(cells, seed, occupiedCells, maximumCells) {
  if (maximumCells <= 0) return [];
  const available = new Map(cells
    .filter(cell => !occupiedCells.has(keyOf(cell.x, cell.y)))
    .map(cell => [keyOf(cell.x, cell.y), cell]));
  const seedKey = keyOf(seed.x, seed.y);
  if (!available.has(seedKey)) return [];
  const queue = [available.get(seedKey)];
  const visited = new Set([seedKey]);
  const accepted = [];
  for (let cursor = 0;
    cursor < queue.length && accepted.length < maximumCells;
    cursor++
  ) {
    const current = queue[cursor];
    accepted.push(copyCoordinate(current));
    for (const step of CARDINAL) {
      const key = keyOf(current.x + step.dx, current.y + step.dy);
      if (!available.has(key) || visited.has(key)) continue;
      visited.add(key);
      queue.push(available.get(key));
    }
  }
  return accepted.sort(compareCoordinates);
}

function selectChannelCandidates({
  width,
  height,
  flow,
  excludedMask,
  hydrology,
  attemptSeed
}) {
  const seed = deriveStreamSeed(attemptSeed, 'hydrology:sources');
  const candidates = [];
  const maximumStairSteps = Math.max(2, Math.floor(hydrology.maximumAxisRun / 2));
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (excludedMask[y][x] ||
          flow.accumulation[y][x] < hydrology.minimumContributingArea) continue;
      const downstream = flow.flowDirection[y][x];
      if (!downstream) continue;
      const childrenAboveThreshold = FLOW_NEIGHBORS.some(step => {
        const childX = x + step.dx;
        const childY = y + step.dy;
        return inBounds(childX, childY, width, height) &&
          flow.flowDirection[childY][childX]?.x === x &&
          flow.flowDirection[childY][childX]?.y === y &&
          flow.accumulation[childY][childX] >= hydrology.minimumContributingArea;
      });
      const path = traceDownstream(flow.flowDirection, { x, y }, width, height);
      const quality = pathQuality(path);
      if (path.length < Math.max(4, Math.floor(Math.min(width, height) / 3)) ||
          quality.maximumAxisRun > hydrology.maximumAxisRun ||
          quality.maximumStairStepTurns > maximumStairSteps ||
          path.some(cell => excludedMask[cell.y][cell.x])) continue;
      candidates.push({
        x,
        y,
        path,
        quality,
        thresholdHead: !childrenAboveThreshold,
        contributingArea: flow.accumulation[y][x],
        tie: coordinateHash32(seed, x, y, 'source-rank')
      });
    }
  }
  candidates.sort((a, b) =>
    Number(b.thresholdHead) - Number(a.thresholdHead) ||
    b.path.length - a.path.length ||
    b.contributingArea - a.contributingArea ||
    a.tie - b.tie ||
    compareCoordinates(a, b)
  );
  const selected = [];
  for (const candidate of candidates) {
    const keys = new Set(candidate.path.map(cell => keyOf(cell.x, cell.y)));
    const overlaps = selected.some(other => {
      const overlap = other.path.reduce(
        (total, cell) => total + (keys.has(keyOf(cell.x, cell.y)) ? 1 : 0),
        0
      );
      return overlap > Math.floor(Math.min(candidate.path.length, other.path.length) / 2);
    });
    if (overlaps) continue;
    selected.push(candidate);
    if (selected.length === hydrology.sourceCount) break;
  }
  return selected;
}

function deriveDistanceMasks(width, height, featureMask, radius) {
  const distance = createGrid(width, height, null);
  const queue = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!featureMask[y][x]) continue;
      distance[y][x] = 0;
      queue.push({ x, y });
    }
  }
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (distance[current.y][current.x] >= radius) continue;
    for (const step of CARDINAL) {
      const x = current.x + step.dx;
      const y = current.y + step.dy;
      if (!inBounds(x, y, width, height) || distance[y][x] !== null) continue;
      distance[y][x] = distance[current.y][current.x] + 1;
      queue.push({ x, y });
    }
  }
  const bankMask = createGrid(width, height, false);
  const wetnessMask = createGrid(width, height, false);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      bankMask[y][x] = distance[y][x] === 1;
      wetnessMask[y][x] = distance[y][x] !== null &&
        distance[y][x] > 0 && distance[y][x] <= radius;
    }
  }
  return { distanceToFeature: distance, bankMask, wetnessMask };
}

function findCrossingCandidates({
  centerlines,
  featureMask,
  excludedMask,
  material,
  width,
  height
}) {
  const candidates = [];
  const seen = new Set();
  for (const line of centerlines) {
    for (let index = 1; index < line.cells.length - 1; index++) {
      if (line.widths[index] > 2) continue;
      const cell = line.cells[index];
      const direction = directionBetween(line.cells[index - 1], line.cells[index + 1]);
      const sides = Math.abs(direction.dx) >= Math.abs(direction.dy)
        ? [{ x: cell.x, y: cell.y - 1 }, { x: cell.x, y: cell.y + 1 }]
        : [{ x: cell.x - 1, y: cell.y }, { x: cell.x + 1, y: cell.y }];
      if (!sides.every(side =>
        inBounds(side.x, side.y, width, height) &&
        !featureMask[side.y][side.x] &&
        !excludedMask[side.y][side.x]
      )) continue;
      const key = keyOf(cell.x, cell.y);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        id: `crossing:${cell.x}:${cell.y}`,
        x: cell.x,
        y: cell.y,
        waterBodyId: line.id,
        kind: material === 'lava' ? 'lava-connection' : 'ford-or-bridge',
        requiresConnection: material === 'lava',
        orientation: Math.abs(direction.dx) >= Math.abs(direction.dy) ? 'north-south' : 'east-west',
        bankCells: sides
      });
    }
  }
  return candidates.sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
}

function normalizeAnchorPair(pair, index, width, height) {
  const from = Array.isArray(pair) ? pair[0] : pair?.from;
  const to = Array.isArray(pair) ? pair[1] : pair?.to;
  const id = Array.isArray(pair) ? `anchor-pair:${index}` : pair?.id ?? `anchor-pair:${index}`;
  for (const [name, cell] of [['from', from], ['to', to]]) {
    if (!cell || !Number.isInteger(cell.x) || !Number.isInteger(cell.y) ||
        !inBounds(cell.x, cell.y, width, height)) {
      throw new TypeError(`requiredAnchorPairs[${index}].${name} is invalid`);
    }
  }
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError(`requiredAnchorPairs[${index}].id must be a non-empty string`);
  }
  return { id, from: copyCoordinate(from), to: copyCoordinate(to) };
}

function hasLandCorridor(from, to, featureMask, structureMask, width, height) {
  const visited = createGrid(width, height, false);
  const queue = [from];
  visited[from.y][from.x] = true;
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (current.x === to.x && current.y === to.y) return true;
    for (const step of CARDINAL) {
      const x = current.x + step.dx;
      const y = current.y + step.dy;
      if (!inBounds(x, y, width, height) || visited[y][x] ||
          featureMask[y][x] || structureMask[y][x]) continue;
      visited[y][x] = true;
      queue.push({ x, y });
    }
  }
  return false;
}

function crossingEvidence({
  requiredAnchorPairs,
  crossingCandidates,
  featureMask,
  structureMask,
  width,
  height
}) {
  return requiredAnchorPairs.map((input, index) => {
    const pair = normalizeAnchorPair(input, index, width, height);
    const landOnlyCorridor = hasLandCorridor(
      pair.from,
      pair.to,
      featureMask,
      structureMask,
      width,
      height
    );
    const rankedCrossings = crossingCandidates.map(candidate => ({
      id: candidate.id,
      distance:
        Math.abs(candidate.x - pair.from.x) + Math.abs(candidate.y - pair.from.y) +
        Math.abs(candidate.x - pair.to.x) + Math.abs(candidate.y - pair.to.y)
    })).sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
    return {
      id: pair.id,
      from: pair.from,
      to: pair.to,
      landOnlyCorridor,
      crossingCandidateIds: landOnlyCorridor || rankedCrossings.length === 0
        ? []
        : [rankedCrossings[0].id],
      satisfied: landOnlyCorridor || rankedCrossings.length > 0
    };
  });
}

function emptyHydrology(width, height, hydrology, maximumCoverageTiles) {
  const featureMask = createGrid(width, height, false);
  const maximumAllowedStairStepTurns = Math.max(
    2,
    Math.floor(hydrology.maximumAxisRun / 2)
  );
  return deepFreeze({
    hydrologyVersion: 'drainage-hydrology-v1',
    enabled: false,
    kind: hydrology.kind,
    material: hydrology.material,
    requestedSourceCount: hydrology.sourceCount,
    resolvedSourceCount: 0,
    conditionedHeight: null,
    flowDirection: createGrid(width, height, null),
    accumulation: createGrid(width, height, 0),
    intentionalBasins: [],
    centerlines: [],
    waterBodies: [],
    featureMask,
    waterMask: createGrid(width, height, false),
    lavaMask: createGrid(width, height, false),
    bankMask: createGrid(width, height, false),
    wetnessMask: createGrid(width, height, false),
    crossingMask: createGrid(width, height, false),
    crossingCandidates: [],
    anchorPairEvidence: [],
    quality: {
      coverageTiles: 0,
      maximumCoverageTiles,
      coverageRatio: 0,
      maximumObservedChannelWidth: 0,
      maximumAllowedChannelWidth: hydrology.maximumChannelWidth,
      maximumAxisRun: 0,
      maximumAllowedAxisRun: hydrology.maximumAxisRun,
      maximumStairStepTurns: 0,
      maximumAllowedStairStepTurns,
      maximumWidthJump: 0,
      maximumAllowedWidthJump: hydrology.maximumWidthJump,
      downstreamChainsValid: true,
      requiredFeaturePresent: true,
      anchorPairsSatisfied: true,
      withinCoverageBudget: true,
      valid: true
    }
  });
}

/**
 * Build immutable drainage features and the working masks consumed by route,
 * terrain, ecology, and transition stages. `waterBodies` uses the exact
 * BattleMapV2 feature-record schema; all other records are stage-local.
 */
export function generateHydrology({
  width,
  height,
  attemptSeed,
  recipe,
  feasibility,
  fields,
  regions,
  spawnLayout,
  structureFootprints = [],
  requiredAnchorPairs = [],
  scanOrder = 'row-major'
}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new TypeError('Hydrology requires positive integer width and height');
  }
  if (!Number.isSafeInteger(attemptSeed) || attemptSeed < 0) {
    throw new TypeError('Hydrology attemptSeed must be a nonnegative safe integer');
  }
  if (!recipe?.hydrology || !feasibility?.hydrology) {
    throw new TypeError('Hydrology requires resolved recipe and feasibility records');
  }
  if (recipe.hydrology.kind !== feasibility.hydrology.kind ||
      recipe.hydrology.material !== feasibility.hydrology.material) {
    throw new TypeError('Recipe and feasibility hydrology semantics do not match');
  }
  for (const name of ['height', 'moisture']) {
    assertGrid(
      fields?.[name],
      `fields.${name}`,
      width,
      height,
      value => Number.isSafeInteger(value) && value >= -SCALE && value <= SCALE
    );
  }
  assertGrid(
    spawnLayout?.coreMask,
    'spawnLayout.coreMask',
    width,
    height,
    value => typeof value === 'boolean'
  );
  assertGrid(
    regions?.regionIdGrid,
    'regions.regionIdGrid',
    width,
    height,
    value => typeof value === 'string' && value.length > 0
  );
  if (!Array.isArray(structureFootprints) || !Array.isArray(requiredAnchorPairs)) {
    throw new TypeError('structureFootprints and requiredAnchorPairs must be arrays');
  }
  if (scanOrder !== 'row-major' && scanOrder !== 'reverse') {
    throw new TypeError(`Unsupported hydrology scan order: ${String(scanOrder)}`);
  }
  const hydrology = feasibility.hydrology;
  const maximumCoverageTiles = Math.max(
    0,
    Math.floor(width * height * hydrology.maximumCoverage / SCALE)
  );
  if (!hydrology.enabled || hydrology.sourceCount === 0 || maximumCoverageTiles === 0) {
    const empty = emptyHydrology(
      width,
      height,
      hydrology,
      maximumCoverageTiles
    );
    if (requiredAnchorPairs.length === 0) return empty;
    const evidence = crossingEvidence({
      requiredAnchorPairs,
      crossingCandidates: [],
      featureMask: empty.featureMask,
      structureMask: makeStructureMask(width, height, structureFootprints),
      width,
      height
    });
    return deepFreeze({
      ...empty,
      anchorPairEvidence: evidence,
      quality: {
        ...empty.quality,
        anchorPairsSatisfied: evidence.every(item => item.satisfied),
        valid: evidence.every(item => item.satisfied)
      }
    });
  }

  const excludedMask = makeExcludedMask(
    width,
    height,
    spawnLayout,
    structureFootprints
  );
  const retainsBasins = hydrology.basinPolicy === 'retain-ranked-basins';
  const selectedBasinSeeds = retainsBasins
    ? basinSeeds({
      width,
      height,
      rawHeight: fields.height,
      moisture: fields.moisture,
      excludedMask,
      count: Math.min(hydrology.sourceCount, feasibility.budgets.waterBodyCount),
      attemptSeed
    })
    : [];
  const intentionalBasins = retainsBasins
    ? growIntentionalBasins({
      seeds: selectedBasinSeeds,
      rawHeight: fields.height,
      excludedMask,
      maximumCoverageTiles: Math.max(
        1,
        Math.floor(maximumCoverageTiles / Math.max(1, selectedBasinSeeds.length))
      ),
      retainedBasinArea: hydrology.retainedBasinArea
    })
    : [];
  const flow = conditionHeightWithPriorityFlood({
    heightField: fields.height,
    attemptSeed,
    intentionalBasinSeeds: selectedBasinSeeds,
    scanOrder
  });
  const channelCandidates = retainsBasins
    ? []
    : selectChannelCandidates({
      width,
      height,
      flow,
      excludedMask,
      hydrology,
      attemptSeed
    });

  const centerlines = [];
  const waterBodies = [];
  const occupiedCells = new Set();
  let remainingCoverage = maximumCoverageTiles;
  const channelGroups = new Map();
  for (const candidate of channelCandidates) {
    const outlet = candidate.path[candidate.path.length - 1];
    const outletKey = keyOf(outlet.x, outlet.y);
    if (!channelGroups.has(outletKey)) {
      channelGroups.set(outletKey, { outlet, candidates: [] });
    }
    channelGroups.get(outletKey).candidates.push(candidate);
  }
  const orderedChannelGroups = [...channelGroups.values()].sort((a, b) =>
    compareCoordinates(a.outlet, b.outlet)
  );
  for (const [bodyIndex, group] of orderedChannelGroups.entries()) {
    if (remainingCoverage <= 0) break;
    const id = `${hydrology.material}-body:${bodyIndex}`;
    let bodyCells = new Map();
    const sourceCells = [];
    for (const [branchIndex, candidate] of group.candidates.entries()) {
      const widths = [];
      let previousWidth = 1;
      for (const cell of candidate.path) {
        const targetWidth = widthForAccumulation(
          flow.accumulation[cell.y][cell.x],
          hydrology.minimumContributingArea,
          hydrology.maximumChannelWidth
        );
        const resolvedWidth = Math.min(
          targetWidth,
          previousWidth + hydrology.maximumWidthJump
        );
        widths.push(resolvedWidth);
        previousWidth = resolvedWidth;
      }
      const stampedCells = stampChannel({
        centerline: candidate.path,
        widths,
        width,
        height,
        excludedMask,
        maximumCells: remainingCoverage,
        attemptSeed,
        existingCells: bodyCells,
        occupiedCells
      });
      if (stampedCells === null) continue;
      bodyCells = stampedCells;
      centerlines.push({
        id,
        branchId: `${id}:branch:${branchIndex}`,
        cells: candidate.path.map(copyCoordinate),
        widths,
        sourceCell: copyCoordinate(candidate.path[0]),
        outletCell: copyCoordinate(group.outlet)
      });
      sourceCells.push(copyCoordinate(candidate.path[0]));
    }
    const cells = [...bodyCells.values()].sort(compareCoordinates);
    if (cells.length === 0) continue;
    waterBodies.push({
      id,
      kind: hydrology.kind,
      material: hydrology.material,
      bounds: boundsFor(cells),
      cells,
      sourceCells: sourceCells.sort(compareCoordinates),
      outletCell: copyCoordinate(group.outlet),
      parentRegionId:
        regions.regionIdGrid[sourceCells[0].y][sourceCells[0].x] ?? null
    });
    for (const cell of cells) {
      occupiedCells.add(keyOf(cell.x, cell.y));
    }
    remainingCoverage -= cells.length;
  }
  for (const [index, basin] of intentionalBasins.entries()) {
    if (remainingCoverage <= 0) break;
    const cells = seedConnectedAvailableCells(
      basin.cells,
      basin.seed,
      occupiedCells,
      remainingCoverage
    );
    if (cells.length === 0) continue;
    const id = `${hydrology.material}-basin:${index}`;
    waterBodies.push({
      id,
      kind: hydrology.kind,
      material: hydrology.material,
      bounds: boundsFor(cells),
      cells,
      sourceCells: [copyCoordinate(basin.seed)],
      outletCell: null,
      parentRegionId: regions.regionIdGrid[basin.seed.y][basin.seed.x] ?? null
    });
    for (const cell of cells) occupiedCells.add(keyOf(cell.x, cell.y));
    remainingCoverage -= cells.length;
  }

  const featureMask = createGrid(width, height, false);
  for (const body of waterBodies) {
    for (const cell of body.cells) featureMask[cell.y][cell.x] = true;
  }
  const { distanceToFeature, bankMask, wetnessMask } = deriveDistanceMasks(
    width,
    height,
    featureMask,
    hydrology.wetnessRadius
  );
  const crossingCandidates = findCrossingCandidates({
    centerlines,
    featureMask,
    excludedMask,
    material: hydrology.material,
    width,
    height
  });
  const crossingMask = createGrid(width, height, false);
  for (const candidate of crossingCandidates) {
    crossingMask[candidate.y][candidate.x] = true;
  }
  const evidence = crossingEvidence({
    requiredAnchorPairs,
    crossingCandidates,
    featureMask,
    structureMask: makeStructureMask(width, height, structureFootprints),
    width,
    height
  });
  const maximumAxisRun = centerlines.reduce(
    (maximum, line) => Math.max(maximum, pathQuality(line.cells).maximumAxisRun),
    0
  );
  const maximumStairStepTurns = centerlines.reduce(
    (maximum, line) =>
      Math.max(maximum, pathQuality(line.cells).maximumStairStepTurns),
    0
  );
  const maximumWidthJump = centerlines.reduce((maximum, line) => {
    for (let index = 1; index < line.widths.length; index++) {
      maximum = Math.max(maximum, Math.abs(line.widths[index] - line.widths[index - 1]));
    }
    return maximum;
  }, 0);
  const downstreamChainsValid = centerlines.every(line => {
    const traced = traceDownstream(
      flow.flowDirection,
      line.sourceCell,
      width,
      height
    );
    return traced.length === line.cells.length &&
      traced.every((cell, index) =>
        cell.x === line.cells[index].x && cell.y === line.cells[index].y
      ) &&
      line.outletCell.x === traced[traced.length - 1].x &&
      line.outletCell.y === traced[traced.length - 1].y;
  });
  const actualCoverageTiles = waterBodies.reduce(
    (total, body) => total + body.cells.length,
    0
  );
  const maximumAllowedStairStepTurns = Math.max(
    2,
    Math.floor(hydrology.maximumAxisRun / 2)
  );
  const quality = {
    coverageTiles: actualCoverageTiles,
    maximumCoverageTiles,
    coverageRatio: Math.floor(actualCoverageTiles * SCALE / (width * height)),
    maximumObservedChannelWidth: centerlines.reduce(
      (maximum, line) => Math.max(maximum, ...line.widths),
      0
    ),
    maximumAllowedChannelWidth: hydrology.maximumChannelWidth,
    maximumAxisRun,
    maximumAllowedAxisRun: hydrology.maximumAxisRun,
    maximumStairStepTurns,
    maximumAllowedStairStepTurns,
    maximumWidthJump,
    maximumAllowedWidthJump: hydrology.maximumWidthJump,
    downstreamChainsValid,
    requiredFeaturePresent:
      !feasibility.requiredFeatures.some(feature => feature.kind === hydrology.kind) ||
      waterBodies.length > 0,
    anchorPairsSatisfied: evidence.every(item => item.satisfied),
    withinCoverageBudget: actualCoverageTiles <= maximumCoverageTiles,
    valid:
      downstreamChainsValid &&
      (
        !feasibility.requiredFeatures.some(feature => feature.kind === hydrology.kind) ||
        waterBodies.length > 0
      ) &&
      evidence.every(item => item.satisfied) &&
      actualCoverageTiles <= maximumCoverageTiles &&
      maximumAxisRun <= hydrology.maximumAxisRun &&
      maximumStairStepTurns <= maximumAllowedStairStepTurns &&
      maximumWidthJump <= hydrology.maximumWidthJump
  };
  const waterMask = hydrology.material === 'water'
    ? featureMask.map(row => [...row])
    : createGrid(width, height, false);
  const lavaMask = hydrology.material === 'lava'
    ? featureMask.map(row => [...row])
    : createGrid(width, height, false);
  const publishedBasins = intentionalBasins.map((basin, index) => {
    const id = `${hydrology.material}-basin:${index}`;
    const body = waterBodies.find(candidate => candidate.id === id);
    return {
      id,
      seed: copyCoordinate(basin.seed),
      cells: body?.cells.map(copyCoordinate) ?? []
    };
  }).filter(basin => basin.cells.length > 0);
  return deepFreeze({
    hydrologyVersion: 'drainage-hydrology-v1',
    enabled: true,
    kind: hydrology.kind,
    material: hydrology.material,
    requestedSourceCount: hydrology.sourceCount,
    resolvedSourceCount: centerlines.length + publishedBasins.length,
    conditionedHeight: flow.conditionedHeight,
    flowDirection: flow.flowDirection,
    accumulation: flow.accumulation,
    intentionalBasins: publishedBasins,
    centerlines,
    waterBodies,
    featureMask,
    waterMask,
    lavaMask,
    bankMask,
    wetnessMask,
    distanceToFeature,
    crossingMask,
    crossingCandidates,
    anchorPairEvidence: evidence,
    quality
  });
}
