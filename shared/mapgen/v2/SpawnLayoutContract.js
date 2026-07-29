import { MAX_BATTLE_PARTY_SIZE } from '../../constants.js';
import { deepFreeze } from './V2Context.js';

export const V2_BATTLE_MODES = Object.freeze([
  'pve',
  'guild',
  'pvp',
  'pvp_coliseum',
  'pve_coop'
]);

function assertCount(value, name, maximum) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${name} must be an integer from 1 to ${maximum}`);
  }
}

function booleanGrid(width, height, initial = false) {
  return Array.from({ length: height }, () => Array(width).fill(initial));
}

function centerOutOffsets(count) {
  const offsets = [0];
  for (let distance = 1; offsets.length < count; distance++) {
    offsets.push(-distance);
    if (offsets.length < count) offsets.push(distance);
  }
  return offsets;
}

function formationSlots({ side, count, width, height, prefix }) {
  const depthCount = Math.min(3, Math.max(2, Math.ceil(Math.sqrt(count))));
  const lateralCount = Math.ceil(count / depthCount);
  const lateralOffsets = centerOutOffsets(lateralCount);
  const horizontal = side === 'west' || side === 'east';
  const center = Math.floor(((horizontal ? height : width) - 1) / 2);
  const slots = [];
  const inwardSign = side === 'west' || side === 'north' ? 1 : -1;
  const edge = side === 'west'
    ? 1
    : side === 'east'
      ? width - 2
      : side === 'north'
        ? 1
        : height - 2;

  for (let index = 0; index < count; index++) {
    const depth = Math.floor(index / lateralCount);
    const lateral = index % lateralCount;
    const x = horizontal ? edge + inwardSign * depth : center + lateralOffsets[lateral];
    const y = horizontal ? center + lateralOffsets[lateral] : edge + inwardSign * depth;
    if (x < 0 || x >= width || y < 0 || y >= height) {
      throw new RangeError(
        `Map ${width}x${height} cannot fit ${count} ${side} formation slots`
      );
    }
    slots.push({
      id: `${prefix}-${String(index + 1).padStart(2, '0')}`,
      side,
      slot: index,
      x,
      y
    });
  }
  return slots;
}

function markRadius(mask, slots, radius) {
  const height = mask.length;
  const width = mask[0]?.length ?? 0;
  for (const slot of slots) {
    for (let y = Math.max(0, slot.y - radius); y <= Math.min(height - 1, slot.y + radius); y++) {
      for (let x = Math.max(0, slot.x - radius); x <= Math.min(width - 1, slot.x + radius); x++) {
        if (Math.abs(x - slot.x) + Math.abs(y - slot.y) <= radius) mask[y][x] = true;
      }
    }
  }
}

function mergeMasks(...masks) {
  const height = masks[0]?.length ?? 0;
  const width = masks[0]?.[0]?.length ?? 0;
  return Array.from(
    { length: height },
    (_, y) => Array.from({ length: width }, (_, x) => masks.some(mask => mask[y][x]))
  );
}

function hasMapSpanningSeam(mask) {
  const height = mask.length;
  const width = mask[0]?.length ?? 0;
  if (mask.some(row => row.every(Boolean))) return true;
  for (let x = 0; x < width; x++) {
    let fillsColumn = true;
    for (let y = 0; y < height; y++) {
      if (!mask[y][x]) {
        fillsColumn = false;
        break;
      }
    }
    if (fillsColumn) return true;
  }
  return false;
}

function makeDistanceField(coreMask) {
  const height = coreMask.length;
  const width = coreMask[0]?.length ?? 0;
  const distance = Array.from({ length: height }, () => Array(width).fill(width + height));
  const queue = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (coreMask[y][x]) {
        distance[y][x] = 0;
        queue.push({ x, y });
      }
    }
  }
  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor++];
    const nextDistance = distance[current.y][current.x] + 1;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const x = current.x + dx;
      const y = current.y + dy;
      if (x < 0 || x >= width || y < 0 || y >= height) continue;
      if (distance[y][x] <= nextDistance) continue;
      distance[y][x] = nextDistance;
      queue.push({ x, y });
    }
  }
  return distance;
}

function createCandidateMask(width, height, side, coreMask) {
  const result = booleanGrid(width, height);
  const horizontal = side === 'west' || side === 'east';
  const longSize = horizontal ? width : height;
  const start = side === 'west' || side === 'north'
    ? 1
    : Math.max(1, Math.floor(longSize * 0.62));
  const end = side === 'west' || side === 'north'
    ? Math.min(longSize - 2, Math.ceil(longSize * 0.38))
    : longSize - 2;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const longitudinal = horizontal ? x : y;
      if (longitudinal >= start && longitudinal <= end && !coreMask[y][x]) {
        result[y][x] = true;
      }
    }
  }
  return result;
}

function createSlotMask(width, height, slots) {
  const result = booleanGrid(width, height);
  for (const slot of slots) result[slot.y][slot.x] = true;
  return result;
}

function findExits(slots, side, width, height, minimumExits) {
  const horizontal = side === 'west' || side === 'east';
  const laterals = [...new Set(slots.map(slot => horizontal ? slot.y : slot.x))]
    .sort((a, b) => a - b);
  const chosen = [];
  const preferred = [
    laterals[Math.floor((laterals.length - 1) / 2)],
    laterals[0],
    laterals[laterals.length - 1]
  ];
  const lateralSize = horizontal ? height : width;
  const formationCenter = Math.round(
    laterals.reduce((sum, value) => sum + value, 0) / laterals.length
  );
  for (const offset of centerOutOffsets(lateralSize)) {
    const lateral = formationCenter + offset;
    if (lateral >= 1 && lateral < lateralSize - 1 && !preferred.includes(lateral)) {
      preferred.push(lateral);
    }
  }
  for (const lateral of preferred) {
    if (lateral === undefined ||
        chosen.some(exit => (horizontal ? exit.y : exit.x) === lateral)) continue;
    const depthCoordinates = slots.map(slot => horizontal ? slot.x : slot.y);
    const depth = side === 'west' || side === 'north'
      ? Math.min(horizontal ? width - 1 : height - 1, Math.max(...depthCoordinates) + 1)
      : Math.max(0, Math.min(...depthCoordinates) - 1);
    chosen.push({
      id: `${side}-exit-${chosen.length + 1}`,
      side,
      x: horizontal ? depth : Math.max(0, Math.min(width - 1, lateral)),
      y: horizontal ? Math.max(0, Math.min(height - 1, lateral)) : depth
    });
    if (chosen.length === minimumExits) break;
  }
  if (chosen.length < minimumExits) {
    throw new RangeError(`Formation cannot expose ${minimumExits} distinct ${side} exits`);
  }
  return chosen;
}

/**
 * Resolve immutable formation geometry before any topology is generated.
 * Protected masks are compact Manhattan-distance envelopes, never full-height
 * edge strips.
 */
export function resolveSpawnLayout(request) {
  const {
    mapWidth,
    mapHeight,
    mode = 'pve',
    playerCount = MAX_BATTLE_PARTY_SIZE,
    enemyCapacity = mode === 'pvp' || mode === 'pvp_coliseum'
      ? MAX_BATTLE_PARTY_SIZE
      : Math.max(6, playerCount),
    minimumExits = 2,
    coreRadius = 1,
    featherRadius = 3
  } = request ?? {};

  if (!Number.isInteger(mapWidth) || !Number.isInteger(mapHeight) ||
      mapWidth < 10 || mapHeight < 10) {
    throw new RangeError('V2 spawn layout requires mapWidth and mapHeight of at least 10');
  }
  if (!V2_BATTLE_MODES.includes(mode)) throw new TypeError(`Unsupported battle mode: ${mode}`);
  assertCount(playerCount, 'playerCount', MAX_BATTLE_PARTY_SIZE);
  assertCount(enemyCapacity, 'enemyCapacity', 24);
  if (!Number.isInteger(minimumExits) || minimumExits < 1 || minimumExits > 3) {
    throw new RangeError('minimumExits must be an integer from 1 to 3');
  }
  if (!Number.isInteger(coreRadius) || coreRadius < 0 || coreRadius > 2) {
    throw new RangeError('coreRadius must be an integer from 0 to 2');
  }
  if (!Number.isInteger(featherRadius) || featherRadius <= coreRadius || featherRadius > 6) {
    throw new RangeError('featherRadius must be greater than coreRadius and at most 6');
  }

  const arenaMode = mode === 'pvp' || mode === 'pvp_coliseum';
  const playerSide = arenaMode ? 'north' : 'west';
  const enemySide = arenaMode ? 'south' : 'east';
  const playerSlots = formationSlots({
    side: playerSide,
    count: playerCount,
    width: mapWidth,
    height: mapHeight,
    prefix: 'player'
  });
  const enemySlots = formationSlots({
    side: enemySide,
    count: enemyCapacity,
    width: mapWidth,
    height: mapHeight,
    prefix: 'enemy-candidate'
  });
  let resolvedCoreRadius = coreRadius;
  let playerCoreMask;
  let enemyCoreMask;
  let coreMask;
  do {
    playerCoreMask = booleanGrid(mapWidth, mapHeight);
    enemyCoreMask = booleanGrid(mapWidth, mapHeight);
    markRadius(playerCoreMask, playerSlots, resolvedCoreRadius);
    markRadius(enemyCoreMask, enemySlots, resolvedCoreRadius);
    coreMask = mergeMasks(playerCoreMask, enemyCoreMask);
    if (!hasMapSpanningSeam(coreMask) || resolvedCoreRadius === 0) break;
    resolvedCoreRadius--;
  } while (true);

  let resolvedFeatherRadius = featherRadius;
  let playerFeatherMask;
  let enemyFeatherMask;
  let featherMask;
  do {
    playerFeatherMask = booleanGrid(mapWidth, mapHeight);
    enemyFeatherMask = booleanGrid(mapWidth, mapHeight);
    markRadius(playerFeatherMask, playerSlots, resolvedFeatherRadius);
    markRadius(enemyFeatherMask, enemySlots, resolvedFeatherRadius);
    featherMask = mergeMasks(playerFeatherMask, enemyFeatherMask);
    if (!hasMapSpanningSeam(featherMask) ||
        resolvedFeatherRadius === resolvedCoreRadius + 1) break;
    resolvedFeatherRadius--;
  } while (true);

  const playerExits = findExits(
    playerSlots,
    playerSide,
    mapWidth,
    mapHeight,
    minimumExits
  );
  const enemyExits = findExits(
    enemySlots,
    enemySide,
    mapWidth,
    mapHeight,
    minimumExits
  );

  return deepFreeze({
    mode,
    orientation: arenaMode ? 'north-south' : 'west-east',
    playerSide,
    enemySide,
    playerCapacity: playerCount,
    enemyCapacity,
    requestedCoreRadius: coreRadius,
    resolvedCoreRadius,
    requestedFeatherRadius: featherRadius,
    featherRadius: resolvedFeatherRadius,
    playerSlots,
    enemyCandidateSlots: enemySlots,
    selectedEnemySlots: [],
    protectedZones: [
      { id: 'player-core', kind: 'spawn-core', side: playerSide, mask: playerCoreMask },
      { id: 'enemy-core', kind: 'spawn-core', side: enemySide, mask: enemyCoreMask },
      {
        id: 'player-feather',
        kind: 'spawn-feather',
        side: playerSide,
        mask: playerFeatherMask
      },
      {
        id: 'enemy-feather',
        kind: 'spawn-feather',
        side: enemySide,
        mask: enemyFeatherMask
      }
    ],
    exits: [...playerExits, ...enemyExits],
    strategyMasks: {
      playerCandidates: createSlotMask(mapWidth, mapHeight, playerSlots),
      enemyCandidates: createSlotMask(mapWidth, mapHeight, enemySlots),
      playerStaging: createCandidateMask(mapWidth, mapHeight, playerSide, coreMask),
      enemyStaging: createCandidateMask(mapWidth, mapHeight, enemySide, coreMask)
    },
    playerCoreMask,
    enemyCoreMask,
    coreMask,
    featherMask,
    distanceToProtectedZone: makeDistanceField(coreMask)
  });
}
