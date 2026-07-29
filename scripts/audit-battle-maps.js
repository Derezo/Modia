#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import {
  discretizeElevation,
  IMPASSABLE_TERRAIN,
  TERRAIN_COSTS
} from '../shared/terrain.js';
import {
  OBSTACLE_ASSET_CATALOG,
  getObstacleAssetCategory,
  isBlockingObstacle
} from '../shared/obstacles.js';
import {
  validateBattleMapV2Final
} from '../shared/battleMap/schema.js';
import {
  verifyBattleMapV2Final
} from '../shared/battleMap/hashes.js';
import {
  V2_PRODUCTION_NODE_TYPES,
  getV2Recipe
} from '../shared/mapgen/v2/RecipeRegistry.js';
import {
  assertV2AssetCapability
} from '../shared/mapgen/v2/RenderCapabilities.js';
import {
  evaluateOrganicQuality
} from '../shared/mapgen/v2/OrganicQuality.js';

export const AUDIT_SCHEMA_VERSION = 'battle-map-audit-v2';
export const MACRO_SIGNATURE_VERSION = 'battle-map-macro-signature-v1';
export const DEFAULT_NODE_TYPES = V2_PRODUCTION_NODE_TYPES;
export const SUPPORTED_MODES = Object.freeze([
  'pve',
  'guild',
  'pve_coop',
  'pvp',
  'pvp_coliseum'
]);
export const AUDIT_THRESHOLDS = Object.freeze({
  maximumCorpusMaps: 20_000,
  maximumMapDimension: 64,
  maximumMapBytes: 4 * 1024 * 1024,
  maximumGenerationMs: 10_000,
  naturalIsolatedSemanticTileRate: 0.01,
  adjacentNonCliffElevationStepPassRate: 0.95,
  sameNodeNearSimilarity: 0.97,
  crossNodeNearSimilarity: 0.98,
  organicRouteDistribution: Object.freeze({
    minimumProfileMapCount: 20,
    minimumTurnOpportunities: 4,
    maximumStraightRouteRate: 0.10
  }),
  profile: Object.freeze({
    natural: Object.freeze({ maximumExactMacroCollisionRate: 0.02, maximumNearDuplicateRate: 0.05 }),
    subterranean: Object.freeze({ maximumExactMacroCollisionRate: 0.04, maximumNearDuplicateRate: 0.08 }),
    constructed: Object.freeze({ maximumExactMacroCollisionRate: 0.05, maximumNearDuplicateRate: 0.10 }),
    arena: Object.freeze({ maximumExactMacroCollisionRate: 0.10, maximumNearDuplicateRate: 0.20 }),
    legacy: Object.freeze({ maximumExactMacroCollisionRate: 1, maximumNearDuplicateRate: 1 })
  })
});

const ROOT_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KNOWN_TERRAIN = new Set([...Object.keys(TERRAIN_COSTS), ...IMPASSABLE_TERRAIN]);
const DEFAULT_FAILURE_LIMIT = 50;

function splitValues(raw, name) {
  const values = raw.split(',').map(value => value.trim()).filter(Boolean);
  if (values.length === 0) throw new Error(`${name} must contain at least one value`);
  return values;
}

function parseInteger(raw, name, minimum = Number.MIN_SAFE_INTEGER) {
  if (!/^-?\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be a safe integer >= ${minimum}`);
  }
  return value;
}

function parseIntegerList(raw, name, minimum) {
  return splitValues(raw, name).map(value => parseInteger(value, name, minimum));
}

function parseDimensions(raw) {
  return splitValues(raw, 'dimensions').map(value => {
    const match = /^(\d+)x(\d+)$/i.exec(value);
    if (!match) throw new Error(`invalid dimension "${value}"; expected WIDTHxHEIGHT`);
    const width = parseInteger(match[1], 'map width', 1);
    const height = parseInteger(match[2], 'map height', 1);
    return { width, height };
  });
}

function parseRange(raw) {
  const match = /^(-?\d+)(?::|\.\.)(-?\d+)$/.exec(raw);
  if (!match) throw new Error('seed-range must use START:END or START..END');
  const start = parseInteger(match[1], 'seed-range start', 0);
  const end = parseInteger(match[2], 'seed-range end', 0);
  if (end < start) throw new Error('seed-range end must be >= start');
  if (end - start + 1 > AUDIT_THRESHOLDS.maximumCorpusMaps) {
    throw new Error(
      `seed-range may contain at most ${AUDIT_THRESHOLDS.maximumCorpusMaps} seeds`
    );
  }
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function valueForArgument(argv, index, name) {
  const argument = argv[index];
  const equalsIndex = argument.indexOf('=');
  if (equalsIndex !== -1) return { value: argument.slice(equalsIndex + 1), consumed: 0 };
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return { value, consumed: 1 };
}

export function parseAuditArgs(argv = process.argv.slice(2)) {
  const options = {
    versions: null,
    nodeTypes: [...DEFAULT_NODE_TYPES],
    seeds: Array.from({ length: 100 }, (_, seed) => seed),
    dimensions: [{ width: 32, height: 32 }],
    modes: ['pve'],
    outputDirectory: resolve(ROOT_DIRECTORY, 'artifacts', 'battle-map-audit'),
    shardIndex: 0,
    shardCount: 1,
    failureLimit: DEFAULT_FAILURE_LIMIT,
    emitRenderFixtures: false,
    emitGallery: false,
    deferCorpusGates: false,
    mergeInputDirectory: null,
    maximumCorpusMaps: AUDIT_THRESHOLDS.maximumCorpusMaps,
    maximumMapBytes: AUDIT_THRESHOLDS.maximumMapBytes,
    maximumGenerationMs: AUDIT_THRESHOLDS.maximumGenerationMs,
    quietGeneration: true,
    help: false
  };
  let seedSelection = null;
  let seedStart = null;
  let seedEnd = null;
  let seedCount = null;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    if (argument === '--emit-render-fixtures') {
      options.emitRenderFixtures = true;
      continue;
    }
    if (argument === '--emit-gallery') {
      options.emitGallery = true;
      options.emitRenderFixtures = true;
      continue;
    }
    if (argument === '--defer-corpus-gates') {
      options.deferCorpusGates = true;
      continue;
    }
    if (argument === '--show-generation-output') {
      options.quietGeneration = false;
      continue;
    }

    const name = argument.split('=')[0];
    const valuedArguments = new Set([
      '--versions',
      '--node-types',
      '--seeds',
      '--seed-count',
      '--seed-range',
      '--seed-start',
      '--seed-end',
      '--dimensions',
      '--sizes',
      '--modes',
      '--output-dir',
      '--shard-index',
      '--shard-count',
      '--failure-limit',
      '--max-corpus-maps',
      '--max-map-bytes',
      '--max-generation-ms',
      '--merge-input-dir'
    ]);
    if (!valuedArguments.has(name)) throw new Error(`unknown argument: ${argument}`);

    const parsed = valueForArgument(argv, index, name);
    index += parsed.consumed;
    switch (name) {
      case '--versions':
        options.versions = parseIntegerList(parsed.value, 'versions', 1);
        break;
      case '--node-types':
        options.nodeTypes = splitValues(parsed.value, 'node-types');
        break;
      case '--seeds':
        if (seedSelection && seedSelection !== 'list') {
          throw new Error('use only one seed list or range form');
        }
        seedSelection = 'list';
        options.seeds = parseIntegerList(parsed.value, 'seeds', 0);
        break;
      case '--seed-count':
        if (seedSelection && seedSelection !== 'count') {
          throw new Error('use only one seed list, count, or range form');
        }
        seedSelection = 'count';
        seedCount = parseInteger(parsed.value, 'seed-count', 1);
        if (seedCount > AUDIT_THRESHOLDS.maximumCorpusMaps) {
          throw new Error(
            `seed-count may not exceed ${AUDIT_THRESHOLDS.maximumCorpusMaps}`
          );
        }
        break;
      case '--seed-range':
        if (seedSelection) throw new Error('use only one seed list or range form');
        seedSelection = 'range';
        options.seeds = parseRange(parsed.value);
        break;
      case '--seed-start': {
        if (seedSelection && seedSelection !== 'bounds') {
          throw new Error('use only one seed list or range form');
        }
        seedSelection = 'bounds';
        seedStart = parseInteger(parsed.value, 'seed-start', 0);
        break;
      }
      case '--seed-end': {
        if (seedSelection && seedSelection !== 'bounds') {
          throw new Error('use only one seed list or range form');
        }
        seedSelection = 'bounds';
        seedEnd = parseInteger(parsed.value, 'seed-end', 0);
        break;
      }
      case '--dimensions':
      case '--sizes':
        options.dimensions = parseDimensions(parsed.value);
        break;
      case '--modes':
        options.modes = splitValues(parsed.value, 'modes');
        break;
      case '--output-dir':
        options.outputDirectory = resolve(parsed.value);
        break;
      case '--shard-index':
        options.shardIndex = parseInteger(parsed.value, 'shard-index', 0);
        break;
      case '--shard-count':
        options.shardCount = parseInteger(parsed.value, 'shard-count', 1);
        break;
      case '--failure-limit':
        options.failureLimit = parseInteger(parsed.value, 'failure-limit', 1);
        break;
      case '--max-corpus-maps':
        options.maximumCorpusMaps = parseInteger(parsed.value, 'max-corpus-maps', 1);
        break;
      case '--max-map-bytes':
        options.maximumMapBytes = parseInteger(parsed.value, 'max-map-bytes', 1);
        break;
      case '--max-generation-ms':
        options.maximumGenerationMs = parseInteger(parsed.value, 'max-generation-ms', 1);
        break;
      case '--merge-input-dir':
        options.mergeInputDirectory = resolve(parsed.value);
        break;
      default:
        break;
    }
  }

  if (seedSelection === 'bounds') {
    const start = seedStart ?? 0;
    const end = seedEnd ?? start;
    if (end < start) throw new Error('seed-end must be >= seed-start');
    if (end - start + 1 > AUDIT_THRESHOLDS.maximumCorpusMaps) {
      throw new Error(
        `seed bounds may contain at most ${AUDIT_THRESHOLDS.maximumCorpusMaps} seeds`
      );
    }
    options.seeds = Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
  }
  if (seedSelection === 'count') {
    options.seeds = Array.from({ length: seedCount }, (_, seed) => seed);
  }
  options.versions = [...new Set(options.versions ?? [1])];
  options.nodeTypes = [...new Set(options.nodeTypes)];
  options.seeds = [...new Set(options.seeds)];
  options.modes = [...new Set(options.modes)];
  options.dimensions = [...new Map(
    options.dimensions.map(value => [`${value.width}x${value.height}`, value])
  ).values()];
  if (options.seeds.length > AUDIT_THRESHOLDS.maximumCorpusMaps) {
    throw new Error(`seed selection may not exceed ${AUDIT_THRESHOLDS.maximumCorpusMaps}`);
  }
  if (options.shardIndex >= options.shardCount) {
    throw new Error('shard-index must be less than shard-count');
  }
  if (options.maximumCorpusMaps > AUDIT_THRESHOLDS.maximumCorpusMaps) {
    throw new Error(
      `max-corpus-maps may not exceed ${AUDIT_THRESHOLDS.maximumCorpusMaps}`
    );
  }
  const oversizedDimensions = options.dimensions.filter(
    ({ width, height }) =>
      width > AUDIT_THRESHOLDS.maximumMapDimension ||
      height > AUDIT_THRESHOLDS.maximumMapDimension
  );
  if (oversizedDimensions.length > 0) {
    throw new Error(
      `map dimensions may not exceed ${AUDIT_THRESHOLDS.maximumMapDimension}x` +
      `${AUDIT_THRESHOLDS.maximumMapDimension}`
    );
  }
  const unknownModes = options.modes.filter(mode => !SUPPORTED_MODES.includes(mode));
  if (unknownModes.length > 0) throw new Error(`unsupported modes: ${unknownModes.join(', ')}`);
  const unknownNodes = options.nodeTypes.filter(nodeType => !DEFAULT_NODE_TYPES.includes(nodeType));
  if (unknownNodes.length > 0) {
    throw new Error(`unsupported node types: ${unknownNodes.join(', ')}`);
  }
  if (options.versions.includes(1) && options.modes.some(mode => mode !== 'pve')) {
    throw new Error('terrain generation version 1 audit mode must be pve');
  }
  if (options.versions.includes(2)) {
    const unsupportedPairs = options.nodeTypes.flatMap(nodeType => {
      const supportedModes = getV2Recipe(nodeType).supportedModes;
      return options.modes
        .filter(mode => !supportedModes.includes(mode))
        .map(mode => `${nodeType}:${mode}`);
    });
    if (unsupportedPairs.length > 0) {
      throw new Error(`unsupported V2 node/mode pairs: ${unsupportedPairs.join(', ')}`);
    }
  }
  if (options.seeds.length === 0) throw new Error('the seed selection is empty');
  const corpusSize = options.versions.length * options.nodeTypes.length *
    options.seeds.length * options.dimensions.length * options.modes.length;
  if (corpusSize > options.maximumCorpusMaps) {
    throw new Error(
      `corpus has ${corpusSize} maps, exceeding --max-corpus-maps=${options.maximumCorpusMaps}`
    );
  }
  return options;
}

function canonicalValue(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('cannot hash a non-finite number');
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(item => canonicalValue(item ?? null));
  if (value && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) result[key] = canonicalValue(value[key]);
    }
    return result;
  }
  throw new TypeError(`cannot hash value of type ${typeof value}`);
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function hashValue(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function hashInspectableValue(value) {
  const makeInspectable = current => {
    if (typeof current === 'number' && !Number.isFinite(current)) {
      return { auditNonFiniteNumber: String(current) };
    }
    if (Array.isArray(current)) return current.map(item => makeInspectable(item));
    if (current && typeof current === 'object') {
      return Object.fromEntries(
        Object.entries(current).map(([key, item]) => [key, makeInspectable(item)])
      );
    }
    return current;
  };
  return hashValue(makeInspectable(value));
}

function makeCheck(code, passed, details = null) {
  return details === null ? { code, passed } : { code, passed, details };
}

function inspectGrid(name, grid, width, height, validateCell) {
  const problems = [];
  if (!Array.isArray(grid)) {
    return [makeCheck(`${name}.shape`, false, 'layer is not an array')];
  }
  if (grid.length !== height) {
    problems.push(`expected ${height} rows; received ${grid.length}`);
  }
  for (let y = 0; y < grid.length; y += 1) {
    const row = grid[y];
    if (!Array.isArray(row)) {
      problems.push(`row ${y} is not an array`);
      continue;
    }
    if (row.length !== width) {
      problems.push(`row ${y} expected ${width} columns; received ${row.length}`);
    }
    for (let x = 0; x < row.length; x += 1) {
      const problem = validateCell(row[x], x, y);
      if (problem && problems.length < 20) problems.push(problem);
    }
  }
  return [makeCheck(`${name}.shape-and-values`, problems.length === 0, problems)];
}

function stageResultsFor(map) {
  const source = map?.generation?.diagnostics?.stages
    ?? map?.generation?.diagnostics?.stageResults
    ?? map?.diagnostics?.stages
    ?? map?.diagnostics?.stageResults
    ?? map?.metadata?.stages
    ?? map?.metadata?.algorithms
    ?? map?.metadata?.algorithmsUsed
    ?? [];
  if (!Array.isArray(source)) return [];
  return source.map((stage, index) => ({
    name: stage?.name ?? stage?.stage ?? `stage-${index}`,
    required: stage?.required !== false,
    success: stage?.success !== false && stage?.status !== 'failed',
    ...(stage?.error ? { error: String(stage.error) } : {})
  }));
}

function explicitViolations(map, keys) {
  for (const keyPath of keys) {
    let current = map;
    for (const key of keyPath) current = current?.[key];
    if (Array.isArray(current)) return current;
    if (current === true) return [{ detected: true }];
  }
  return [];
}

function countComponents(terrain, obstacles, width, height) {
  const visited = new Set();
  let components = 0;
  let walkableTiles = 0;
  const passable = (x, y) => x >= 0
    && y >= 0
    && x < width
    && y < height
    && !IMPASSABLE_TERRAIN.includes(terrain?.[y]?.[x])
    && !isBlockingObstacle(obstacles?.[y]?.[x]);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!passable(x, y)) continue;
      walkableTiles += 1;
      const key = `${x},${y}`;
      if (visited.has(key)) continue;
      components += 1;
      visited.add(key);
      const queue = [[x, y]];
      for (let index = 0; index < queue.length; index += 1) {
        const [currentX, currentY] = queue[index];
        for (const [nextX, nextY] of [
          [currentX - 1, currentY],
          [currentX + 1, currentY],
          [currentX, currentY - 1],
          [currentX, currentY + 1]
        ]) {
          const nextKey = `${nextX},${nextY}`;
          if (passable(nextX, nextY) && !visited.has(nextKey)) {
            visited.add(nextKey);
            queue.push([nextX, nextY]);
          }
        }
      }
    }
  }
  return { components, walkableTiles };
}

function calculateMetrics(map, width, height) {
  const totalTiles = width * height;
  const terrainCounts = {};
  for (const row of map.terrain ?? []) {
    for (const terrain of Array.isArray(row) ? row : []) {
      terrainCounts[String(terrain)] = (terrainCounts[String(terrain)] ?? 0) + 1;
    }
  }

  let obstacleCount = 0;
  for (const row of map.obstacles ?? []) {
    for (const obstacle of Array.isArray(row) ? row : []) {
      if (obstacle) obstacleCount += 1;
    }
  }

  const elevationValues = (map.elevation ?? []).flat().filter(Number.isFinite);
  let elevationAdjacentDeltaMean = null;
  if (Array.isArray(map.elevation)) {
    let deltaTotal = 0;
    let deltaCount = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = map.elevation?.[y]?.[x];
        if (!Number.isFinite(value)) continue;
        for (const adjacent of [map.elevation?.[y]?.[x + 1], map.elevation?.[y + 1]?.[x]]) {
          if (Number.isFinite(adjacent)) {
            deltaTotal += Math.abs(value - adjacent);
            deltaCount += 1;
          }
        }
      }
    }
    elevationAdjacentDeltaMean = deltaCount === 0 ? null : deltaTotal / deltaCount;
  }
  const traversal = countComponents(map.terrain, map.obstacles, width, height);
  const legacyValidationSource = map.metadata?.validationResult?.finalAnalysis ?? null;
  const legacyValidation = legacyValidationSource
    ? Object.fromEntries(
        Object.entries(legacyValidationSource).filter(([key]) => key !== 'components')
      )
    : null;

  return {
    totalTiles,
    terrainCounts,
    walkableTiles: traversal.walkableTiles,
    walkableRatio: totalTiles === 0 ? 0 : traversal.walkableTiles / totalTiles,
    connectedComponentCount: traversal.components,
    obstacleCount,
    obstacleDensity: totalTiles === 0 ? 0 : obstacleCount / totalTiles,
    elevation: elevationValues.length === 0
      ? null
      : {
          minimum: Math.min(...elevationValues),
          maximum: Math.max(...elevationValues),
          mean: elevationValues.reduce((sum, value) => sum + value, 0) / elevationValues.length,
          adjacentDeltaMean: elevationAdjacentDeltaMean
        },
    legacyValidation,
    tactical: map.generation?.diagnostics?.tacticalMetrics
      ?? map.diagnostics?.tacticalMetrics
      ?? null,
    quality: map.generation?.diagnostics?.qualityMetrics
      ?? map.diagnostics?.qualityMetrics
      ?? null
  };
}

function legacyConstraintViolations(map) {
  const metrics = map?.metadata?.validationResult?.finalAnalysis;
  const constraints = map?.metadata?.constraints;
  if (!metrics || !constraints) return [];
  const violations = [];
  const add = (type, actual, expected) => violations.push({ type, actual, expected });
  if (metrics.walkableRatio < constraints.minWalkableRatio) {
    add('walkableTooLow', metrics.walkableRatio, `>= ${constraints.minWalkableRatio}`);
  }
  if (metrics.walkableRatio > constraints.maxWalkableRatio) {
    add('walkableTooHigh', metrics.walkableRatio, `<= ${constraints.maxWalkableRatio}`);
  }
  if (metrics.componentCount > 1) add('disconnectedRegions', metrics.componentCount, 1);
  if (metrics.spawnsConnected === false) add('spawnsDisconnected', false, true);
  if (metrics.deadEndCount > constraints.maxDeadEnds) {
    add('tooManyDeadEnds', metrics.deadEndCount, `<= ${constraints.maxDeadEnds}`);
  }
  if (metrics.pathLengthRatio > constraints.maxPathLengthRatio) {
    add('pathTooLong', metrics.pathLengthRatio, `<= ${constraints.maxPathLengthRatio}`);
  }
  if (metrics.approachPathCount < constraints.minApproachPaths) {
    add('insufficientPaths', metrics.approachPathCount, `>= ${constraints.minApproachPaths}`);
  }
  if (metrics.minPassageWidth < constraints.minPassableWidth) {
    add('bottleneckTooNarrow', metrics.minPassageWidth, `>= ${constraints.minPassableWidth}`);
  }
  return violations;
}

function deterministicMapProjection(map) {
  const projection = {};
  const excluded = new Set(['timing', 'timings', 'environment', 'auditEnvironment']);
  for (const [key, value] of Object.entries(map ?? {})) {
    if (!excluded.has(key)) projection[key] = value;
  }
  return projection;
}

function v2AssetKeys(map) {
  const palette = map?.diagnostics?.resolvedRecipe?.renderPalette;
  const keys = [];
  for (const row of map?.terrain ?? []) {
    for (const cell of row ?? []) {
      if (palette && cell?.material) keys.push(`${palette}:floor:${cell.material}`);
    }
  }
  for (const record of [
    ...(map?.obstacles ?? []),
    ...(map?.transitions ?? []),
    ...(map?.decorations ?? []),
    ...(map?.features?.structures ?? [])
  ]) {
    if (record?.assetKey) keys.push(record.assetKey);
  }
  for (const connection of map?.elevationConnections ?? []) {
    const variant = connection.kind === 'stairs' ? 2 : 1;
    if (palette) {
      keys.push(
        `${palette}:connection:${connection.kind}:${connection.direction}:${variant}`
      );
    }
  }
  return [...new Set(keys)].sort();
}

function countBooleanComponents(mask) {
  const height = mask.length;
  const width = mask[0]?.length ?? 0;
  const visited = new Set();
  let components = 0;
  let cells = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y]?.[x]) continue;
      cells += 1;
      const start = `${x},${y}`;
      if (visited.has(start)) continue;
      components += 1;
      visited.add(start);
      const queue = [[x, y]];
      for (let index = 0; index < queue.length; index += 1) {
        const [currentX, currentY] = queue[index];
        for (const [nextX, nextY] of [
          [currentX - 1, currentY],
          [currentX + 1, currentY],
          [currentX, currentY - 1],
          [currentX, currentY + 1]
        ]) {
          const key = `${nextX},${nextY}`;
          if (mask[nextY]?.[nextX] && !visited.has(key)) {
            visited.add(key);
            queue.push([nextX, nextY]);
          }
        }
      }
    }
  }
  return { cells, components };
}

function v2NaturalnessMetrics(map) {
  const width = map.mapWidth;
  const height = map.mapHeight;
  const excluded = new Set();
  for (const route of map.features?.routes ?? []) {
    for (const point of route.centerline ?? []) excluded.add(`${point.x},${point.y}`);
  }
  for (const water of map.features?.waterBodies ?? []) {
    for (const point of water.cells ?? []) excluded.add(`${point.x},${point.y}`);
  }
  for (const zone of map.spawnLayout?.protectedZones ?? []) {
    for (let y = zone.bounds.minY; y <= zone.bounds.maxY; y += 1) {
      for (let x = zone.bounds.minX; x <= zone.bounds.maxX; x += 1) {
        excluded.add(`${x},${y}`);
      }
    }
  }
  let eligibleSemanticTiles = 0;
  let isolatedSemanticTiles = 0;
  let adjacentElevationPairs = 0;
  let acceptableElevationPairs = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = map.terrain[y][x];
      const key = `${x},${y}`;
      if (!excluded.has(key) && cell.material !== 'water' && cell.material !== 'lava') {
        eligibleSemanticTiles += 1;
        const sameNeighbor = [
          map.terrain[y]?.[x - 1],
          map.terrain[y]?.[x + 1],
          map.terrain[y - 1]?.[x],
          map.terrain[y + 1]?.[x]
        ].some(neighbor => neighbor?.material === cell.material);
        if (!sameNeighbor) isolatedSemanticTiles += 1;
      }
      for (const [nextX, nextY] of [[x + 1, y], [x, y + 1]]) {
        if (nextX >= width || nextY >= height) continue;
        const isCliff = (map.elevationConnections ?? []).some(connection =>
          connection.kind === 'cliff' &&
          [connection.from, connection.to].some(point => point.x === x && point.y === y) &&
          [connection.from, connection.to].some(point => point.x === nextX && point.y === nextY)
        );
        if (isCliff) continue;
        adjacentElevationPairs += 1;
        const delta = Math.abs(
          discretizeElevation(map.elevation[y][x]) -
          discretizeElevation(map.elevation[nextY][nextX])
        );
        if (delta <= 1) acceptableElevationPairs += 1;
      }
    }
  }
  return {
    isolatedSemanticTiles,
    eligibleSemanticTiles,
    isolatedSemanticTileRate: eligibleSemanticTiles === 0
      ? 0
      : isolatedSemanticTiles / eligibleSemanticTiles,
    adjacentNonCliffElevationPairs: adjacentElevationPairs,
    adjacentNonCliffElevationStepPassRate: adjacentElevationPairs === 0
      ? 1
      : acceptableElevationPairs / adjacentElevationPairs
  };
}

function routeShapeMetrics(routes = []) {
  let steps = 0;
  let turns = 0;
  let directDistance = 0;
  for (const route of routes) {
    const points = route.centerline ?? [];
    if (points.length > 1) {
      directDistance += Math.abs(points.at(-1).x - points[0].x) +
        Math.abs(points.at(-1).y - points[0].y);
    }
    let previousDirection = null;
    for (let index = 1; index < points.length; index += 1) {
      const direction = `${points[index].x - points[index - 1].x},` +
        `${points[index].y - points[index - 1].y}`;
      if (previousDirection !== null && direction !== previousDirection) turns += 1;
      previousDirection = direction;
      steps += 1;
    }
  }
  return {
    routeCount: routes.length,
    steps,
    turnDensity: steps <= routes.length ? 0 : turns / (steps - routes.length),
    sinuosity: directDistance === 0 ? 1 : steps / directDistance
  };
}

function pairDistance(points) {
  if (points.length < 2) return { minimum: null, meanNearest: null };
  let minimum = Infinity;
  let nearestTotal = 0;
  for (let index = 0; index < points.length; index += 1) {
    let nearest = Infinity;
    for (let other = 0; other < points.length; other += 1) {
      if (index === other) continue;
      const distance = Math.hypot(
        points[index].x - points[other].x,
        points[index].y - points[other].y
      );
      nearest = Math.min(nearest, distance);
    }
    minimum = Math.min(minimum, nearest);
    nearestTotal += nearest;
  }
  return { minimum, meanNearest: nearestTotal / points.length };
}

function downsampleTokens(map, samples = 8) {
  const routeCells = new Set((map.features?.routes ?? [])
    .flatMap(route => route.centerline ?? [])
    .map(point => `${point.x},${point.y}`));
  const waterCells = new Set((map.features?.waterBodies ?? [])
    .flatMap(water => water.cells ?? [])
    .map(point => `${point.x},${point.y}`));
  const protectedCells = new Set();
  for (const zone of map.spawnLayout?.protectedZones ?? []) {
    for (let y = zone.bounds.minY; y <= zone.bounds.maxY; y += 1) {
      for (let x = zone.bounds.minX; x <= zone.bounds.maxX; x += 1) {
        protectedCells.add(`${x},${y}`);
      }
    }
  }
  const tokens = [];
  for (let sampleY = 0; sampleY < samples; sampleY += 1) {
    for (let sampleX = 0; sampleX < samples; sampleX += 1) {
      const minX = Math.floor(sampleX * map.mapWidth / samples);
      const maxX = Math.max(minX + 1, Math.floor((sampleX + 1) * map.mapWidth / samples));
      const minY = Math.floor(sampleY * map.mapHeight / samples);
      const maxY = Math.max(minY + 1, Math.floor((sampleY + 1) * map.mapHeight / samples));
      const materials = {};
      let elevation = 0;
      let count = 0;
      let route = 0;
      let water = 0;
      let protectedZone = 0;
      for (let y = minY; y < maxY; y += 1) {
        for (let x = minX; x < maxX; x += 1) {
          const material = map.terrain[y][x].material;
          materials[material] = (materials[material] ?? 0) + 1;
          elevation += discretizeElevation(map.elevation[y][x]);
          count += 1;
          route += Number(routeCells.has(`${x},${y}`));
          water += Number(waterCells.has(`${x},${y}`));
          protectedZone += Number(protectedCells.has(`${x},${y}`));
        }
      }
      const dominant = Object.entries(materials)
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? '-';
      tokens.push([
        dominant,
        Math.round(elevation / Math.max(1, count)),
        Math.round(route * 4 / Math.max(1, count)),
        Math.round(water * 4 / Math.max(1, count)),
        Math.round(protectedZone * 4 / Math.max(1, count))
      ].join(':'));
    }
  }
  return tokens;
}

export function createMacroSignature(map) {
  if (map?.battleMapSchemaVersion !== 2) {
    const tokens = (map?.terrain ?? []).flat().map(value => String(value));
    return { version: MACRO_SIGNATURE_VERSION, tokens, hash: hashValue(tokens) };
  }
  const tokens = downsampleTokens(map);
  const topology = {
    regionDegrees: (map.features?.regions ?? [])
      .map(region => region.adjacentRegionIds.length).sort((a, b) => a - b),
    routeLengths: (map.features?.routes ?? [])
      .map(route => route.centerline.length).sort((a, b) => a - b),
    connectionKinds: Object.entries((map.elevationConnections ?? []).reduce(
      (counts, connection) => {
        counts[connection.kind] = (counts[connection.kind] ?? 0) + 1;
        return counts;
      },
      {}
    )).sort(([left], [right]) => left.localeCompare(right))
  };
  const value = { version: MACRO_SIGNATURE_VERSION, tokens, topology };
  return { ...value, hash: hashValue(value) };
}

export function macroSimilarity(left, right) {
  const tokenCount = Math.max(left.tokens.length, right.tokens.length);
  if (tokenCount === 0) return 1;
  let matches = 0;
  for (let index = 0; index < tokenCount; index += 1) {
    if (left.tokens[index] === right.tokens[index]) matches += 1;
  }
  const tokenSimilarity = matches / tokenCount;
  const topologySimilarity = left.topology && right.topology
    ? Number(hashValue(left.topology) === hashValue(right.topology))
    : tokenSimilarity;
  return tokenSimilarity * 0.9 + topologySimilarity * 0.1;
}

function inspectBattleMapV2(map) {
  const schema = validateBattleMapV2Final(map);
  const assetFailures = [];
  for (const assetKey of v2AssetKeys(map)) {
    try {
      assertV2AssetCapability(assetKey);
    } catch (error) {
      assetFailures.push({ assetKey, message: error.message });
    }
  }
  const hardChecks = [
    makeCheck('v2-final-schema', schema.valid, schema.errors.slice(0, 20)),
    makeCheck('v2-final-hash-shape', Boolean(map?.diagnostics?.hashes)),
    makeCheck('v2-hard-validation', map?.diagnostics?.hardValidation?.valid === true,
      map?.diagnostics?.hardValidation?.checks ?? []),
    makeCheck('required-stages', (map?.diagnostics?.algorithms ?? []).every(
      algorithm => algorithm.optional || algorithm.status === 'applied'
    )),
    makeCheck('exact-assets', assetFailures.length === 0, assetFailures)
  ];
  const tacticalChecks = [
    makeCheck('v2-tactical-validation', map?.diagnostics?.tacticalValidation?.passed === true,
      map?.diagnostics?.tacticalValidation?.checks ?? [])
  ];
  const naturalness = v2NaturalnessMetrics(map);
  const recipe = getV2Recipe(map.nodeType);
  const organicQuality = evaluateOrganicQuality(map, recipe);
  const qualityChecks = [
    makeCheck(
      'adjacent-non-cliff-elevation',
      naturalness.adjacentNonCliffElevationStepPassRate >=
        AUDIT_THRESHOLDS.adjacentNonCliffElevationStepPassRate,
      naturalness
    )
  ];
  if (recipe.family === 'natural') {
    qualityChecks.push(makeCheck(
      'natural-isolated-semantic-tiles',
      naturalness.isolatedSemanticTileRate <=
        AUDIT_THRESHOLDS.naturalIsolatedSemanticTileRate,
      naturalness
    ));
  }
  qualityChecks.push(...organicQuality.checks.map(check => makeCheck(
    check.id,
    check.pass,
    {
      value: check.value,
      target: check.target,
      message: check.message
    }
  )));
  const passableMask = map.terrain.map(row => row.map(cell => cell.passable));
  const waterMask = map.terrain.map(row => row.map(cell =>
    cell.material === 'water' || cell.material === 'lava'
  ));
  const passability = countBooleanComponents(passableMask);
  const water = countBooleanComponents(waterMask);
  const materialCounts = {};
  map.terrain.flat().forEach(cell => {
    materialCounts[cell.material] = (materialCounts[cell.material] ?? 0) + 1;
  });
  const metrics = {
    totalTiles: map.mapWidth * map.mapHeight,
    terrainCounts: materialCounts,
    walkableTiles: passability.cells,
    walkableRatio: passability.cells / (map.mapWidth * map.mapHeight),
    connectedComponentCount: passability.components,
    obstacleCount: map.obstacles.length,
    obstacleDensity: map.obstacles.length / (map.mapWidth * map.mapHeight),
    elevation: {
      minimum: Math.min(...map.elevation.flat()),
      maximum: Math.max(...map.elevation.flat()),
      mean: map.elevation.flat().reduce((sum, value) => sum + value, 0) /
        (map.mapWidth * map.mapHeight)
    },
    tactical: Object.fromEntries((map.diagnostics.qualityMetrics?.metrics ?? [])
      .map(metric => [metric.id, metric.value])),
    quality: {
      score: map.diagnostics.qualityMetrics?.score ?? null,
      ...naturalness,
      organic: organicQuality.metrics,
      hydrologyIntegrity: organicQuality.hydrology,
      waterCellCount: water.cells,
      waterComponentCount: water.components,
      ...routeShapeMetrics(map.features?.routes),
      obstacleSpacing: pairDistance(map.obstacles),
      featureCounts: Object.fromEntries(
        Object.entries(map.features).map(([name, records]) => [name, records.length])
      )
    }
  };
  const macroSignature = createMacroSignature(map);
  return {
    hardChecks,
    tacticalChecks,
    qualityChecks,
    stages: map.diagnostics.algorithms,
    metrics,
    hashes: {
      authoritative: map.diagnostics.hashes.authoritativeHash,
      visual: map.diagnostics.hashes.visualHash,
      full: map.diagnostics.hashes.fullHash
    },
    macroSignature,
    projection: deterministicMapProjection(map)
  };
}

export function inspectBattleMap(map, input) {
  if (map?.battleMapSchemaVersion === 2) return inspectBattleMapV2(map);
  const { mapWidth: width, mapHeight: height } = input;
  const hardChecks = [];
  hardChecks.push(...inspectGrid(
    'terrain',
    map?.terrain,
    width,
    height,
    (value, x, y) => typeof value === 'string' && KNOWN_TERRAIN.has(value)
      ? null
      : `unknown terrain at (${x},${y}): ${String(value)}`
  ));
  hardChecks.push(...inspectGrid(
    'obstacles',
    map?.obstacles,
    width,
    height,
    (value, x, y) => {
      if (value === null || value === undefined) return null;
      if (!value || typeof value !== 'object') return `invalid obstacle at (${x},${y})`;
      const category = getObstacleAssetCategory(value.type, value.category);
      const variants = OBSTACLE_ASSET_CATALOG[category] ?? [];
      return typeof value.variant === 'string' && variants.includes(value.variant)
        ? null
        : `unknown obstacle asset at (${x},${y}): ${String(value.variant)}`;
    }
  ));
  if (map?.elevation !== undefined) {
    hardChecks.push(...inspectGrid(
      'elevation',
      map.elevation,
      width,
      height,
      (value, x, y) => Number.isFinite(value)
        ? null
        : `non-finite elevation at (${x},${y})`
    ));
  }
  if (map?.variants !== undefined) {
    hardChecks.push(...inspectGrid(
      'variants',
      map.variants,
      width,
      height,
      (value, x, y) => Number.isFinite(value)
        ? null
        : `non-finite variant at (${x},${y})`
    ));
  }

  const stages = stageResultsFor(map);
  const failedRequiredStages = stages.filter(stage => stage.required && !stage.success);
  hardChecks.push(makeCheck(
    'required-stages',
    failedRequiredStages.length === 0,
    failedRequiredStages
  ));

  const finalMutations = explicitViolations(map, [
    ['generation', 'diagnostics', 'finalMutations'],
    ['diagnostics', 'finalMutations'],
    ['metadata', 'finalMutations'],
    ['metadata', 'finalMutationDetected']
  ]);
  hardChecks.push(makeCheck('no-final-mutations', finalMutations.length === 0, finalMutations));
  const streamViolations = explicitViolations(map, [
    ['generation', 'diagnostics', 'streamIsolationViolations'],
    ['generation', 'diagnostics', 'streamIsolation', 'violations'],
    ['diagnostics', 'streamIsolationViolations'],
    ['diagnostics', 'streamIsolation', 'violations'],
    ['metadata', 'streamIsolationViolations'],
    ['metadata', 'streamIsolationViolationDetected']
  ]);
  hardChecks.push(makeCheck(
    'stream-isolation',
    streamViolations.length === 0,
    streamViolations
  ));
  const assetViolations = explicitViolations(map, [
    ['generation', 'diagnostics', 'assetViolations'],
    ['generation', 'diagnostics', 'assetValidation', 'violations'],
    ['diagnostics', 'assetViolations'],
    ['diagnostics', 'assetValidation', 'violations'],
    ['metadata', 'assetViolations']
  ]);
  hardChecks.push(makeCheck(
    'exact-assets',
    assetViolations.length === 0,
    assetViolations
  ));

  const metrics = calculateMetrics(map, width, height);
  const constraintViolations = legacyConstraintViolations(map);
  const declaredConstraintValidity = map?.metadata?.validationResult?.valid;
  const tacticalChecks = [
    makeCheck(
      'legacy-constraint-validation',
      declaredConstraintValidity ?? constraintViolations.length === 0,
      {
        iterations: map?.metadata?.validationResult?.iterations ?? null,
        repaired: map?.metadata?.validationResult?.repaired ?? null,
        violations: constraintViolations
      }
    )
  ];
  const qualityChecks = [
    makeCheck('non-empty-walkable-area', metrics.walkableTiles > 0),
    makeCheck('single-walkable-component', metrics.connectedComponentCount <= 1, {
      componentCount: metrics.connectedComponentCount
    })
  ];
  const projection = deterministicMapProjection(map);
  const hashes = {
    terrain: hashInspectableValue(map?.terrain ?? null),
    authoritative: hashInspectableValue({
      terrain: map?.terrain ?? null,
      elevation: map?.elevation ?? null,
      elevationConnections: map?.elevationConnections ?? null,
      obstacles: map?.obstacles ?? null,
      spawnLayout: map?.spawnLayout ?? null,
      features: map?.features ?? null
    }),
    visual: hashInspectableValue({
      variants: map?.variants ?? null,
      transitions: map?.transitions ?? null,
      decorations: map?.decorations ?? null
    }),
    full: hashInspectableValue(projection)
  };

  return {
    hardChecks,
    tacticalChecks,
    qualityChecks,
    stages,
    metrics,
    hashes,
    macroSignature: createMacroSignature(map),
    projection
  };
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

export function summarize(values) {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return { count: 0, min: null, p50: null, p95: null, max: null };
  return {
    count: finite.length,
    min: Math.min(...finite),
    p50: percentile(finite, 0.5),
    p95: percentile(finite, 0.95),
    max: Math.max(...finite)
  };
}

export function buildAuditMatrix(options) {
  const full = [];
  for (const terrainGenerationVersion of options.versions) {
    for (const nodeType of options.nodeTypes) {
      for (const terrainSeed of options.seeds) {
        for (const { width: mapWidth, height: mapHeight } of options.dimensions) {
          for (const mode of options.modes ?? ['pve']) {
            full.push({
              terrainGenerationVersion,
              terrainSeed,
              nodeType,
              mapWidth,
              mapHeight,
              mode,
              options: terrainGenerationVersion === 2
                ? { mode }
                : { elevation: true, includeMetadata: true }
            });
          }
        }
      }
    }
  }
  return {
    full,
    selected: full.filter((_, index) => index % options.shardCount === options.shardIndex)
  };
}

function auditRecordId(input) {
  return [
    `v${input.terrainGenerationVersion}`,
    input.nodeType,
    `s${input.terrainSeed}`,
    `${input.mapWidth}x${input.mapHeight}`,
    input.mode ?? 'pve'
  ].join('-');
}

function environmentRecord(supportedVersions) {
  return {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    cpuCount: cpus().length,
    ci: Boolean(process.env.CI),
    gitCommit: process.env.GITHUB_SHA ?? null,
    supportedTerrainGenerationVersions: [...supportedVersions]
  };
}

async function packageVersion() {
  const packageData = JSON.parse(await readFile(join(ROOT_DIRECTORY, 'package.json'), 'utf8'));
  return packageData.version;
}

async function quietCall(quiet, callback) {
  if (!quiet) return callback();
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  try {
    return await callback();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
}

function familyForRecord(record) {
  if (record.input.terrainGenerationVersion !== 2) return 'legacy';
  return getV2Recipe(record.input.nodeType).family;
}

function signatureGroupsFor(records) {
  const signatureGroups = new Map();
  for (const record of records) {
    const signatureKey = hashValue({
      tokens: record.macroSignature.tokens,
      topology: record.macroSignature.topology ?? null
    });
    const group = signatureGroups.get(signatureKey) ?? {
      key: signatureKey,
      signature: record.macroSignature,
      topologyKey: hashValue(record.macroSignature.topology ?? null),
      bandHashes: [],
      records: []
    };
    group.records.push(record);
    signatureGroups.set(signatureKey, group);
  }
  return [...signatureGroups.values()];
}

function * similarityCandidates(records) {
  const signatureGroups = signatureGroupsFor(records);
  const bucketsByBand = Array.from({ length: 4 }, () => new Map());
  for (const group of signatureGroups) {
    const tokens = group.signature.tokens;
    for (let band = 0; band < 4; band += 1) {
      const start = Math.floor(tokens.length * band / 4);
      const end = Math.floor(tokens.length * (band + 1) / 4);
      const bandHash = hashValue(tokens.slice(start, end));
      group.bandHashes.push(bandHash);
      const key = [tokens.length, group.topologyKey, bandHash].join(':');
      const buckets = bucketsByBand[band];
      const values = buckets.get(key) ?? [];
      values.push(group);
      buckets.set(key, values);
    }
  }
  for (let band = 0; band < bucketsByBand.length; band += 1) {
    for (const values of bucketsByBand[band].values()) {
      for (let left = 0; left < values.length; left += 1) {
        for (let right = left + 1; right < values.length; right += 1) {
          const leftGroup = values[left];
          const rightGroup = values[right];
          const alreadyEmitted = leftGroup.bandHashes
            .slice(0, band)
            .some((hash, priorBand) => hash === rightGroup.bandHashes[priorBand]);
          if (alreadyEmitted) continue;
          yield [leftGroup, rightGroup]
            .sort((a, b) => a.key.localeCompare(b.key));
        }
      }
    }
  }
}

function countPairsAcrossNodes(nodeCounts) {
  let pairCount = 0;
  let priorCount = 0;
  for (const count of nodeCounts.values()) {
    pairCount += priorCount * count;
    priorCount += count;
  }
  return pairCount;
}

function crossNodeBucketAnalysis(groups, failureLimit) {
  const contexts = new Map();
  for (const group of groups) {
    for (const record of group.records) {
      const contextKey = [
        record.input.mapWidth,
        record.input.mapHeight,
        record.input.mode
      ].join(':');
      const context = contexts.get(contextKey) ?? {
        nodeCounts: new Map(),
        groupNodeCounts: new Map(),
        nodeGroups: new Map()
      };
      const nodeType = record.input.nodeType;
      context.nodeCounts.set(nodeType, (context.nodeCounts.get(nodeType) ?? 0) + 1);
      const groupNodeCounts = context.groupNodeCounts.get(group.key) ?? new Map();
      groupNodeCounts.set(nodeType, (groupNodeCounts.get(nodeType) ?? 0) + 1);
      context.groupNodeCounts.set(group.key, groupNodeCounts);
      const nodeGroups = context.nodeGroups.get(nodeType) ?? new Map();
      const ids = nodeGroups.get(group.key) ?? [];
      ids.push(record.id);
      nodeGroups.set(group.key, ids);
      context.nodeGroups.set(nodeType, nodeGroups);
      contexts.set(contextKey, context);
    }
  }

  let pairCount = 0;
  const pairs = [];
  for (const context of contexts.values()) {
    pairCount += countPairsAcrossNodes(context.nodeCounts);
    for (const groupNodeCounts of context.groupNodeCounts.values()) {
      pairCount -= countPairsAcrossNodes(groupNodeCounts);
    }
    if (pairs.length >= failureLimit) continue;
    const nodes = [...context.nodeGroups.entries()]
      .sort(([left], [right]) => left.localeCompare(right));
    samplePairs:
    for (let leftNodeIndex = 0; leftNodeIndex < nodes.length; leftNodeIndex += 1) {
      for (let rightNodeIndex = leftNodeIndex + 1;
        rightNodeIndex < nodes.length;
        rightNodeIndex += 1) {
        const leftGroups = [...nodes[leftNodeIndex][1].entries()]
          .sort(([, leftIds], [, rightIds]) =>
            leftIds[0].localeCompare(rightIds[0])
          );
        const rightGroups = [...nodes[rightNodeIndex][1].entries()]
          .sort(([, leftIds], [, rightIds]) =>
            leftIds[0].localeCompare(rightIds[0])
          );
        for (const [leftGroupKey, leftIds] of leftGroups) {
          for (const [rightGroupKey, rightIds] of rightGroups) {
            if (leftGroupKey === rightGroupKey) continue;
            const sortedLeftIds = [...leftIds].sort();
            const sortedRightIds = [...rightIds].sort();
            for (const left of sortedLeftIds) {
              for (const right of sortedRightIds) {
                pairs.push({ left, right });
                if (pairs.length >= failureLimit) break samplePairs;
              }
            }
          }
        }
      }
    }
  }
  return { pairCount, pairs };
}

function analyzeCrossNodeNear(records, failureLimit) {
  const shapes = new Map();
  for (const group of signatureGroupsFor(records)) {
    const tokenCount = group.signature.tokens.length;
    const key = [tokenCount, group.topologyKey].join(':');
    const values = shapes.get(key) ?? [];
    values.push(group);
    shapes.set(key, values);
  }
  const orderedShapes = [...shapes.values()].sort((left, right) =>
    right[0].signature.tokens.length - left[0].signature.tokens.length
  );
  let duplicateCount = 0;
  const nearPairs = [];
  for (const groups of orderedShapes) {
    const tokenCount = groups[0].signature.tokens.length;
    if (tokenCount === 0) continue;
    const oneMismatchSimilarity = macroSimilarity(
      groups[0].signature,
      {
        ...groups[0].signature,
        tokens: groups[0].signature.tokens.map(
          (token, index) => index === 0 ? `${token}:audit-mismatch` : token
        )
      }
    );
    if (oneMismatchSimilarity < AUDIT_THRESHOLDS.crossNodeNearSimilarity) continue;
    for (let omittedIndex = 0; omittedIndex < tokenCount; omittedIndex += 1) {
      const buckets = new Map();
      for (const group of groups) {
        const tokens = group.signature.tokens;
        const key = hashValue([
          ...tokens.slice(0, omittedIndex),
          ...tokens.slice(omittedIndex + 1)
        ]);
        const values = buckets.get(key) ?? [];
        values.push(group);
        buckets.set(key, values);
      }
      for (const values of buckets.values()) {
        if (values.length < 2) continue;
        const bucket = crossNodeBucketAnalysis(
          values,
          Math.max(0, failureLimit - nearPairs.length)
        );
        duplicateCount += bucket.pairCount;
        for (const pair of bucket.pairs) {
          nearPairs.push({ ...pair, similarity: oneMismatchSimilarity });
        }
      }
    }
  }
  nearPairs.sort(compareNearPairs);
  return {
    duplicateCount,
    nearPairs: nearPairs.slice(0, failureLimit)
  };
}

function compareNearPairs(left, right) {
  return right.similarity - left.similarity ||
    left.left.localeCompare(right.left) ||
    left.right.localeCompare(right.right);
}

function retainBoundedNearPair(pairs, pair, limit) {
  if (limit <= 0) return;
  pairs.push(pair);
  pairs.sort(compareNearPairs);
  if (pairs.length > limit) pairs.pop();
}

export function analyzeDiversity(records, failureLimit = DEFAULT_FAILURE_LIMIT) {
  const generated = records.filter(record => record.status === 'generated');
  const profiles = new Map();
  for (const record of generated) {
    const key = [
      `v${record.input.terrainGenerationVersion}`,
      record.input.nodeType,
      `${record.input.mapWidth}x${record.input.mapHeight}`,
      record.input.mode ?? 'pve'
    ].join(':');
    const values = profiles.get(key) ?? [];
    values.push(record);
    profiles.set(key, values);
  }
  const profileReports = [];
  for (const [profile, values] of [...profiles.entries()].sort()) {
    const hashes = new Map();
    values.forEach(record => {
      const collisions = hashes.get(record.macroSignature.hash) ?? [];
      collisions.push(record.id);
      hashes.set(record.macroSignature.hash, collisions);
    });
    const exactCollisions = [...hashes.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([hash, ids]) => ({ hash, ids }));
    const nearDuplicateIds = new Set();
    const nearPairs = [];
    for (const [leftGroup, rightGroup] of similarityCandidates(values)) {
      const similarity = macroSimilarity(leftGroup.signature, rightGroup.signature);
      if (similarity < AUDIT_THRESHOLDS.sameNodeNearSimilarity) continue;
      const leftIds = leftGroup.records.map(record => record.id).sort();
      const rightIds = rightGroup.records.map(record => record.id).sort();
      leftIds.forEach(id => nearDuplicateIds.add(id));
      rightIds.forEach(id => nearDuplicateIds.add(id));
      retainBoundedNearPair(nearPairs, {
        left: leftIds[0],
        right: rightIds[0],
        similarity
      }, failureLimit);
      if (nearDuplicateIds.size === values.length &&
          nearPairs.length >= failureLimit) break;
    }
    const exactDuplicateMaps = exactCollisions.reduce(
      (count, collision) => count + collision.ids.length - 1,
      0
    );
    const nearDuplicateMaps = nearDuplicateIds.size;
    const family = familyForRecord(values[0]);
    const threshold = AUDIT_THRESHOLDS.profile[family];
    const exactRate = values.length === 0 ? 0 : exactDuplicateMaps / values.length;
    const nearRate = values.length === 0 ? 0 : nearDuplicateMaps / values.length;
    const organicRouteDistribution = values[0].input.terrainGenerationVersion === 2 &&
      values[0].input.nodeType === 'swamp'
      ? (() => {
          const threshold = AUDIT_THRESHOLDS.organicRouteDistribution;
          const eligible = values.filter(record =>
            Number.isFinite(record.metrics?.quality?.turnDensity) &&
            record.metrics?.quality?.organic?.routeTurnOpportunityCount >=
              threshold.minimumTurnOpportunities
          );
          const straightRouteMapCount = eligible.filter(
            record => record.metrics.quality.turnDensity === 0
          ).length;
          const straightRouteRate = eligible.length === 0
            ? 0
            : straightRouteMapCount / eligible.length;
          const enforced = eligible.length >= threshold.minimumProfileMapCount;
          return {
            eligibleMapCount: eligible.length,
            straightRouteMapCount,
            straightRouteRate,
            enforced,
            threshold,
            passed: !enforced ||
              straightRouteRate <= threshold.maximumStraightRouteRate
          };
        })()
      : null;
    profileReports.push({
      profile,
      family,
      mapCount: values.length,
      distinctMacroSignatureCount: hashes.size,
      exactMacroCollisionRate: exactRate,
      nearDuplicateRate: nearRate,
      thresholds: threshold,
      passed: exactRate <= threshold.maximumExactMacroCollisionRate &&
        nearRate <= threshold.maximumNearDuplicateRate &&
        (organicRouteDistribution?.passed ?? true),
      organicRouteDistribution,
      exactCollisions: exactCollisions.slice(0, failureLimit),
      nearPairs
    });
  }

  const byMacro = new Map();
  generated.filter(record => record.input.terrainGenerationVersion === 2)
    .forEach(record => {
      const values = byMacro.get(record.macroSignature.hash) ?? [];
      values.push(record);
      byMacro.set(record.macroSignature.hash, values);
    });
  const allCrossNodeExactCollisions = [...byMacro.entries()].flatMap(([hash, values]) => {
    const nodeTypes = [...new Set(values.map(record => record.input.nodeType))];
    return nodeTypes.length > 1
      ? [{ hash, nodeTypes, ids: values.map(record => record.id) }]
      : [];
  });
  const crossNodeExactCollisions = allCrossNodeExactCollisions.slice(0, failureLimit);
  const v2Generated = generated.filter(
    record => record.input.terrainGenerationVersion === 2
  );
  const crossNodeNear = new Set(
    v2Generated.map(record => record.input.nodeType)
  ).size > 1
    ? analyzeCrossNodeNear(v2Generated, failureLimit)
    : { duplicateCount: 0, nearPairs: [] };
  return {
    signatureVersion: MACRO_SIGNATURE_VERSION,
    method: '8x8 semantic/elevation/route/water/protected-zone tokens plus topology; complete four-band same-node and exact one-token-radius cross-node indexes',
    thresholds: AUDIT_THRESHOLDS,
    profileFailureCount: profileReports.filter(profile => !profile.passed).length,
    profiles: profileReports,
    crossNodeExactCollisionCount: allCrossNodeExactCollisions.length,
    crossNodeExactCollisions,
    crossNodeNearDuplicateCount: crossNodeNear.duplicateCount,
    crossNodeNearPairs: crossNodeNear.nearPairs
  };
}

export function aggregateRecords(records, fullMatrixCount, options) {
  const hardFailures = records.filter(record => record.status === 'generated'
    && record.checks.hard.some(check => !check.passed));
  const generationErrors = records.filter(record => record.status === 'generation-error');
  const tacticalFailures = records.filter(record => record.status === 'generated'
    && record.checks.tactical.some(check => !check.passed));
  const qualityFailures = records.filter(record => record.status === 'generated'
    && record.checks.quality.some(check => !check.passed));
  const fullHashes = new Map();
  for (const record of records.filter(value =>
    value.status === 'generated' && value.input.terrainGenerationVersion === 2
  )) {
    const identities = fullHashes.get(record.hashes.full) ?? [];
    identities.push(record.id);
    fullHashes.set(record.hashes.full, identities);
  }
  const collisions = [...fullHashes.entries()]
    .filter(([, identities]) => identities.length > 1)
    .map(([hash, identities]) => ({ hash, identities }));

  const diversity = analyzeDiversity(records, options.failureLimit);
  const v2RequiredQualityFailures = records.filter(record =>
    record.status === 'generated' &&
    record.input.terrainGenerationVersion === 2 &&
    record.checks.quality.some(check => !check.passed)
  );
  const guardrailFailures = records.filter(record =>
    record.status === 'generated' &&
    record.checks.guardrails.some(check => !check.passed)
  );
  const corpusGateFailureCount = collisions.length + diversity.profileFailureCount +
    diversity.crossNodeExactCollisionCount + diversity.crossNodeNearDuplicateCount;
  const requiredFailureCount = generationErrors.length + hardFailures.length +
    tacticalFailures.filter(record => record.input.terrainGenerationVersion === 2).length +
    v2RequiredQualityFailures.length + guardrailFailures.length +
    (options.deferCorpusGates ? 0 : corpusGateFailureCount);
  return {
    schema: AUDIT_SCHEMA_VERSION,
    fullMatrixMapCount: fullMatrixCount,
    selectedMapCount: records.length,
    generatedMapCount: records.length - generationErrors.length,
    generationErrorCount: generationErrors.length,
    hardFailureCount: hardFailures.length,
    tacticalFailureCount: tacticalFailures.length,
    qualityFailureCount: qualityFailures.length,
    guardrailFailureCount: guardrailFailures.length,
    diversityFailureCount: diversity.profileFailureCount +
      diversity.crossNodeExactCollisionCount + diversity.crossNodeNearDuplicateCount,
    corpusGatesDeferred: Boolean(options.deferCorpusGates),
    corpusGateFailureCount,
    requiredFailureCount,
    exactFullHashCollisionCount: collisions.length,
    exactFullHashCollisions: collisions.slice(0, options.failureLimit),
    timingMs: summarize(records.map(record => record.timing?.generationMs)),
    walkableRatio: summarize(records.map(record => record.metrics?.walkableRatio)),
    obstacleDensity: summarize(records.map(record => record.metrics?.obstacleDensity)),
    payloadBytes: summarize(records.map(record => record.metrics?.payloadBytes)),
    connectedComponentCount: summarize(
      records.map(record => record.metrics?.connectedComponentCount)
    ),
    diversity
  };
}

function failureSummary(records, limit) {
  return records
    .filter(record => record.status === 'generation-error'
      || record.checks?.hard?.some(check => !check.passed)
      || record.checks?.tactical?.some(check => !check.passed)
      || record.checks?.quality?.some(check => !check.passed)
      || record.checks?.guardrails?.some(check => !check.passed))
    .slice(0, limit)
    .map(record => ({
      id: record.id,
      status: record.status,
      error: record.error ?? null,
      failedHardChecks: record.checks?.hard?.filter(check => !check.passed) ?? [],
      failedTacticalChecks: record.checks?.tactical?.filter(check => !check.passed) ?? [],
      failedQualityChecks: record.checks?.quality?.filter(check => !check.passed) ?? [],
      failedGuardrails: record.checks?.guardrails?.filter(check => !check.passed) ?? []
    }));
}

const GALLERY_COLORS = Object.freeze({
  grass: '#6f9b55',
  plains: '#92aa62',
  forest: '#426b43',
  dirt: '#997249',
  sand: '#c7aa68',
  rock: '#77766f',
  stone: '#696b70',
  cave: '#4b4b50',
  dungeon: '#555158',
  snow: '#d7e2e4',
  ice: '#a9ced6',
  water: '#397da4',
  shallow_water: '#5a99b5',
  deep_water: '#235d84',
  swamp: '#587152',
  mud: '#715a43',
  lava: '#cf4c24',
  bridge: '#8d6842',
  floor: '#867c6c',
  wall: '#34373c',
  void: '#17191c'
});

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function galleryMaterial(cell) {
  if (typeof cell === 'string') return cell;
  return cell?.material ?? cell?.terrain ?? 'void';
}

function renderFixtureSvg(fixture) {
  const map = fixture.map;
  const width = map.mapWidth ?? map.width ?? map.terrain?.[0]?.length ?? 1;
  const height = map.mapHeight ?? map.height ?? map.terrain?.length ?? 1;
  const tile = Math.max(4, Math.floor(384 / Math.max(width, height)));
  const svgWidth = width * tile;
  const svgHeight = height * tile;
  const cells = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const material = galleryMaterial(map.terrain?.[y]?.[x]);
      const fill = GALLERY_COLORS[material] ?? '#8a6f62';
      cells.push(
        `<rect x="${x * tile}" y="${y * tile}" width="${tile}" height="${tile}" ` +
        `fill="${fill}"><title>${escapeHtml(`${x},${y}: ${material}`)}</title></rect>`
      );
    }
  }
  const obstacles = (map.obstacles ?? []).flatMap(obstacle => {
    if (!Number.isFinite(obstacle?.x) || !Number.isFinite(obstacle?.y)) return [];
    return [
      `<circle cx="${(obstacle.x + 0.5) * tile}" cy="${(obstacle.y + 0.5) * tile}" ` +
      `r="${Math.max(1.5, tile * 0.22)}" fill="#191919" fill-opacity="0.8"/>`
    ];
  });
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" role="img" ',
    `aria-label="${escapeHtml(fixture.id)} deterministic semantic map" `,
    `viewBox="0 0 ${svgWidth} ${svgHeight}" shape-rendering="crispEdges">`,
    '<rect width="100%" height="100%" fill="#17191c"/>',
    ...cells,
    ...obstacles,
    '</svg>',
    ''
  ].join('');
}

function renderGalleryHtml(entries) {
  const cards = entries.map(entry => [
    '<article>',
    `<a href="${escapeHtml(entry.svg)}"><img src="${escapeHtml(entry.svg)}" `,
    `alt="${escapeHtml(entry.id)} deterministic semantic map"></a>`,
    `<h2>${escapeHtml(entry.id)}</h2>`,
    `<p>${escapeHtml(entry.nodeType)} · seed ${entry.seed} · `,
    `${entry.width}×${entry.height} · ${escapeHtml(entry.mode)}</p>`,
    `<code>${escapeHtml(entry.hash)}</code>`,
    '</article>'
  ].join('')).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Battle-map audit gallery</title>
  <style>
    :root { color-scheme: dark; font: 14px system-ui, sans-serif; background: #15171a; color: #eee; }
    body { margin: 2rem; }
    main { display: grid; grid-template-columns: repeat(auto-fill,minmax(260px,1fr)); gap: 1rem; }
    article { background: #22262b; border: 1px solid #3c4249; border-radius: 8px; padding: .75rem; }
    img { display: block; width: 100%; aspect-ratio: 1; object-fit: contain; image-rendering: pixelated; background: #111; }
    h2 { font-size: 1rem; margin: .7rem 0 .25rem; overflow-wrap: anywhere; }
    p { margin: .25rem 0; color: #bac1ca; }
    code { display: block; font-size: .7rem; color: #94c8f3; overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <h1>Battle-map audit gallery</h1>
  <p>Deterministic semantic SVGs generated directly from audited map data; these are not runtime screenshots.</p>
  <main>${cards}</main>
</body>
</html>
`;
}

async function writeAuditFiles(result, options, fixtures) {
  await mkdir(options.outputDirectory, { recursive: true });
  const writeJson = (name, value) => writeFile(
    join(options.outputDirectory, name),
    `${JSON.stringify(value, null, 2)}\n`
  );
  await Promise.all([
    writeJson('matrix.json', result.matrix),
    writeFile(
      join(options.outputDirectory, 'maps.jsonl'),
      `${result.records.map(record => JSON.stringify(record)).join('\n')}\n`
    ),
    writeJson('aggregate.json', result.aggregate),
    writeJson('diversity.json', result.aggregate.diversity),
    writeJson('failures.json', result.failures),
    writeJson('report.json', {
      schema: AUDIT_SCHEMA_VERSION,
      generatorVersion: result.generatorVersion,
      environment: result.environment,
      matrix: result.matrix,
      aggregate: result.aggregate,
      failures: result.failures,
      merge: result.merge
    })
  ]);
  if (result.merge) await writeJson('merge.json', result.merge);

  if (options.emitRenderFixtures) {
    const fixtureDirectory = join(options.outputDirectory, 'render-fixtures');
    await mkdir(fixtureDirectory, { recursive: true });
    const manifest = [];
    for (const fixture of fixtures) {
      const fileName = `${fixture.id}.json`;
      await writeFile(join(fixtureDirectory, fileName), `${JSON.stringify(fixture, null, 2)}\n`);
      manifest.push({ id: fixture.id, file: `render-fixtures/${fileName}`, hash: fixture.hash });
    }
    await writeJson('render-manifest.json', {
      schema: AUDIT_SCHEMA_VERSION,
      fixtures: manifest
    });
  }

  if (options.emitGallery) {
    const galleryDirectory = join(options.outputDirectory, 'gallery');
    await mkdir(galleryDirectory, { recursive: true });
    const entries = [];
    for (const fixture of fixtures) {
      const fileName = `${fixture.id}.svg`;
      await writeFile(join(galleryDirectory, fileName), renderFixtureSvg(fixture));
      entries.push({
        id: fixture.id,
        nodeType: fixture.input.nodeType,
        seed: fixture.input.terrainSeed,
        width: fixture.input.mapWidth,
        height: fixture.input.mapHeight,
        mode: fixture.input.mode ?? 'pve',
        hash: fixture.hash,
        svg: `gallery/${fileName}`
      });
    }
    await writeJson('gallery-manifest.json', {
      schema: AUDIT_SCHEMA_VERSION,
      renderer: 'static-semantic-svg-v1',
      note: 'Generated directly from semantic terrain and obstacle records; not a runtime screenshot.',
      entries
    });
    await writeFile(join(options.outputDirectory, 'gallery.html'), renderGalleryHtml(entries));
  }
}

function corpusDefinition(matrix) {
  return {
    versions: matrix.versions,
    nodeTypes: matrix.nodeTypes,
    seeds: matrix.seeds,
    dimensions: matrix.dimensions,
    modes: matrix.modes,
    shardCount: matrix.shardCount,
    fullMapCount: matrix.fullMapCount,
    guardrails: matrix.guardrails
  };
}

function mergeFailure(code, message, details = null) {
  return {
    id: `merge:${code}`,
    status: 'merge-error',
    error: { name: code, message },
    details
  };
}

function recordContentHash(record) {
  if (typeof record?.deterministicRecordHash === 'string') {
    return record.deterministicRecordHash;
  }
  const { deterministicRecordHash: _recordHash, timing: _timing, ...deterministic } =
    record ?? {};
  return hashValue(deterministic);
}

export function mergeShardReportData(sources, options = {}) {
  const failureLimit = options.failureLimit ?? DEFAULT_FAILURE_LIMIT;
  const maximumCorpusMaps = options.maximumCorpusMaps ??
    AUDIT_THRESHOLDS.maximumCorpusMaps;
  const orderedSources = [...sources].sort((left, right) =>
    String(left.source ?? left.path ?? '').localeCompare(
      String(right.source ?? right.path ?? '')
    )
  );
  const mergeFailures = [];
  const groupsByKey = new Map();
  const groupAggregates = [];

  for (const source of orderedSources) {
    const sourceName = String(source.source ?? source.path ?? '<in-memory>');
    const report = source.report ?? source;
    const records = source.records;
    if (report?.schema !== AUDIT_SCHEMA_VERSION) {
      mergeFailures.push(mergeFailure(
        'invalid-report-schema',
        `${sourceName} has schema ${String(report?.schema)}`,
        { source: sourceName, expected: AUDIT_SCHEMA_VERSION }
      ));
      continue;
    }
    if (!report.matrix || !Array.isArray(records)) {
      mergeFailures.push(mergeFailure(
        'invalid-report-shape',
        `${sourceName} must contain a matrix and a maps.jsonl record array`,
        { source: sourceName }
      ));
      continue;
    }
    const matrix = report.matrix;
    if (!Array.isArray(matrix.versions) ||
        !Array.isArray(matrix.nodeTypes) ||
        !Array.isArray(matrix.seeds) ||
        !Array.isArray(matrix.dimensions) ||
        !Array.isArray(matrix.modes) ||
        !Number.isInteger(matrix.shardIndex) ||
        !Number.isInteger(matrix.shardCount) ||
        matrix.shardCount < 1 ||
        matrix.shardIndex < 0 ||
        matrix.shardIndex >= matrix.shardCount ||
        !Number.isInteger(matrix.fullMapCount) ||
        matrix.fullMapCount < 0 ||
        !Number.isInteger(matrix.selectedMapCount) ||
        matrix.selectedMapCount < 0) {
      mergeFailures.push(mergeFailure(
        'invalid-shard-matrix',
        `${sourceName} has invalid shard metadata`,
        { source: sourceName, matrix }
      ));
      continue;
    }
    const definition = corpusDefinition(matrix);
    const key = hashValue(definition);
    const group = groupsByKey.get(key) ?? {
      key,
      definition,
      sources: []
    };
    group.sources.push({ source: sourceName, matrix, records });
    groupsByKey.set(key, group);
  }

  const corpusGroups = [];
  const uniqueRecords = new Map();
  for (const group of [...groupsByKey.values()].sort((left, right) =>
    left.key.localeCompare(right.key)
  )) {
    const shardSources = new Map();
    const groupRecords = new Map();
    const expectedInputs = buildAuditMatrix({
      ...group.definition,
      shardIndex: 0
    }).full;
    const expectedIdsByShard = Array.from(
      { length: group.definition.shardCount },
      () => new Set()
    );
    const expectedInputsById = new Map();
    expectedInputs.forEach((input, index) => {
      const id = auditRecordId(input);
      expectedIdsByShard[index % group.definition.shardCount].add(id);
      expectedInputsById.set(id, input);
    });
    if (expectedInputs.length !== group.definition.fullMapCount) {
      mergeFailures.push(mergeFailure(
        'declared-full-count-mismatch',
        `corpus ${group.key} declares ${group.definition.fullMapCount} maps but its selectors define ${expectedInputs.length}`,
        {
          corpus: group.key,
          declared: group.definition.fullMapCount,
          expected: expectedInputs.length
        }
      ));
    }
    for (const source of group.sources) {
      const existingShard = shardSources.get(source.matrix.shardIndex);
      if (existingShard) {
        mergeFailures.push(mergeFailure(
          'duplicate-shard-index',
          `corpus ${group.key} has duplicate shard ${source.matrix.shardIndex}`,
          {
            corpus: group.key,
            shardIndex: source.matrix.shardIndex,
            sources: [existingShard.source, source.source]
          }
        ));
      } else {
        shardSources.set(source.matrix.shardIndex, source);
      }
      if (source.records.length !== source.matrix.selectedMapCount) {
        mergeFailures.push(mergeFailure(
          'selected-count-mismatch',
          `${source.source} declares ${source.matrix.selectedMapCount} selected maps but contains ${source.records.length}`,
          { corpus: group.key, source: source.source }
        ));
      }
      const expectedIds = expectedIdsByShard[source.matrix.shardIndex];
      const actualIds = new Set(source.records.map(record => record?.id).filter(Boolean));
      const missingIds = [...expectedIds].filter(id => !actualIds.has(id));
      const unexpectedIds = [...actualIds].filter(id => !expectedIds.has(id));
      const inputMismatches = source.records.flatMap(record => {
        const expectedInput = expectedInputsById.get(record?.id);
        return expectedInput && hashValue(record?.input) === hashValue(expectedInput)
          ? []
          : [record?.id ?? null];
      });
      if (source.matrix.selectedMapCount !== expectedIds.size ||
          missingIds.length > 0 ||
          unexpectedIds.length > 0 ||
          inputMismatches.length > 0) {
        mergeFailures.push(mergeFailure(
          'shard-membership-mismatch',
          `${source.source} does not contain the exact deterministic shard selection`,
          {
            corpus: group.key,
            source: source.source,
            shardIndex: source.matrix.shardIndex,
            expectedCount: expectedIds.size,
            declaredCount: source.matrix.selectedMapCount,
            missingIds: missingIds.slice(0, failureLimit),
            unexpectedIds: unexpectedIds.slice(0, failureLimit),
            inputMismatches: inputMismatches.slice(0, failureLimit)
          }
        ));
      }
      for (const record of source.records) {
        if (!record?.id) {
          mergeFailures.push(mergeFailure(
            'invalid-map-record',
            `${source.source} contains a map record without an id`,
            { corpus: group.key, source: source.source }
          ));
          continue;
        }
        const contentHash = recordContentHash(record);
        const existing = groupRecords.get(record.id);
        if (existing && existing.contentHash !== contentHash) {
          mergeFailures.push(mergeFailure(
            'conflicting-map-record',
            `map ${record.id} differs across shard reports`,
            {
              corpus: group.key,
              id: record.id,
              sources: [existing.source, source.source]
            }
          ));
          continue;
        }
        if (!existing) {
          groupRecords.set(record.id, {
            record,
            contentHash,
            source: source.source
          });
        }
      }
    }
    const missingShards = Array.from(
      { length: group.definition.shardCount },
      (_, shardIndex) => shardIndex
    ).filter(shardIndex => !shardSources.has(shardIndex));
    if (missingShards.length > 0) {
      mergeFailures.push(mergeFailure(
        'missing-shards',
        `corpus ${group.key} is missing shard indexes ${missingShards.join(', ')}`,
        { corpus: group.key, missingShards }
      ));
    }
    if (groupRecords.size !== group.definition.fullMapCount) {
      mergeFailures.push(mergeFailure(
        'full-count-mismatch',
        `corpus ${group.key} expects ${group.definition.fullMapCount} maps but merged ${groupRecords.size}`,
        {
          corpus: group.key,
          expected: group.definition.fullMapCount,
          actual: groupRecords.size
        }
      ));
    }
    for (const { record, contentHash, source } of groupRecords.values()) {
      const existing = uniqueRecords.get(record.id);
      if (existing && existing.contentHash !== contentHash) {
        mergeFailures.push(mergeFailure(
          'conflicting-corpus-record',
          `map ${record.id} differs across audit corpora`,
          { id: record.id, sources: [existing.source, source] }
        ));
      } else if (!existing) {
        uniqueRecords.set(record.id, { record, contentHash, source });
      }
    }
    const corpusRecords = [...groupRecords.values()]
      .map(value => value.record)
      .sort((left, right) => left.id.localeCompare(right.id));
    const corpusAggregate = aggregateRecords(
      corpusRecords,
      group.definition.fullMapCount,
      { failureLimit, deferCorpusGates: false }
    );
    groupAggregates.push({ corpus: group.key, aggregate: corpusAggregate });
    corpusGroups.push({
      corpus: group.key,
      definition: group.definition,
      sourceReportCount: group.sources.length,
      receivedShardIndexes: [...shardSources.keys()].sort((a, b) => a - b),
      missingShardIndexes: missingShards,
      mergedMapCount: groupRecords.size,
      corpusGateFailureCount: corpusAggregate.corpusGateFailureCount
    });
  }

  if (orderedSources.length === 0) {
    mergeFailures.push(mergeFailure(
      'no-shard-reports',
      'no shard report.json files were found'
    ));
  }
  const records = [...uniqueRecords.values()]
    .map(value => value.record)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (records.length > maximumCorpusMaps) {
    mergeFailures.push(mergeFailure(
      'merged-corpus-too-large',
      `merged corpus has ${records.length} maps, exceeding ${maximumCorpusMaps}`,
      { actual: records.length, maximum: maximumCorpusMaps }
    ));
  }
  const aggregate = aggregateRecords(records, records.length, {
    failureLimit,
    deferCorpusGates: true
  });
  const corpusGateFailureCount = groupAggregates.reduce(
    (count, value) => count + value.aggregate.corpusGateFailureCount,
    0
  );
  const diversity = {
    signatureVersion: MACRO_SIGNATURE_VERSION,
    method: 'Each complete shard corpus is independently re-evaluated after deterministic merge.',
    thresholds: AUDIT_THRESHOLDS,
    corpusCount: groupAggregates.length,
    profileFailureCount: groupAggregates.reduce(
      (count, value) => count + value.aggregate.diversity.profileFailureCount,
      0
    ),
    profiles: groupAggregates.flatMap(value =>
      value.aggregate.diversity.profiles.map(profile => ({
        corpus: value.corpus,
        ...profile
      }))
    ),
    crossNodeExactCollisionCount: groupAggregates.reduce(
      (count, value) =>
        count + value.aggregate.diversity.crossNodeExactCollisionCount,
      0
    ),
    crossNodeExactCollisions: groupAggregates.flatMap(value =>
      value.aggregate.diversity.crossNodeExactCollisions.map(collision => ({
        corpus: value.corpus,
        ...collision
      }))
    ).slice(0, failureLimit),
    crossNodeNearDuplicateCount: groupAggregates.reduce(
      (count, value) =>
        count + value.aggregate.diversity.crossNodeNearDuplicateCount,
      0
    ),
    crossNodeNearPairs: groupAggregates.flatMap(value =>
      value.aggregate.diversity.crossNodeNearPairs.map(pair => ({
        corpus: value.corpus,
        ...pair
      }))
    ).slice(0, failureLimit)
  };
  const exactFullHashCollisions = groupAggregates.flatMap(value =>
    value.aggregate.exactFullHashCollisions.map(collision => ({
      corpus: value.corpus,
      ...collision
    }))
  );
  aggregate.corpusGatesDeferred = false;
  aggregate.corpusGateFailureCount = corpusGateFailureCount;
  aggregate.diversityFailureCount = diversity.profileFailureCount +
    diversity.crossNodeExactCollisionCount + diversity.crossNodeNearDuplicateCount;
  aggregate.diversity = diversity;
  aggregate.exactFullHashCollisionCount = groupAggregates.reduce(
    (count, value) => count + value.aggregate.exactFullHashCollisionCount,
    0
  );
  aggregate.exactFullHashCollisions = exactFullHashCollisions.slice(0, failureLimit);
  aggregate.mergeFailureCount = mergeFailures.length;
  aggregate.requiredFailureCount += corpusGateFailureCount + mergeFailures.length;
  const failures = [
    ...failureSummary(records, failureLimit),
    ...mergeFailures
  ].slice(0, failureLimit);
  return {
    generatorVersion: {
      application: null,
      auditSchema: AUDIT_SCHEMA_VERSION
    },
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      ci: Boolean(process.env.CI),
      gitCommit: process.env.GITHUB_SHA ?? null
    },
    matrix: {
      mode: 'merged-shard-corpora',
      sourceReportCount: orderedSources.length,
      corpusGroupCount: corpusGroups.length,
      fullMapCount: records.length,
      selectedMapCount: records.length
    },
    records,
    aggregate,
    failures,
    merge: {
      schema: AUDIT_SCHEMA_VERSION,
      sourceReportCount: orderedSources.length,
      uniqueMapCount: records.length,
      corpusGroups,
      failures: mergeFailures.slice(0, failureLimit)
    }
  };
}

async function findReportFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const reports = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      reports.push(...await findReportFiles(path));
    } else if (entry.isFile() && entry.name === 'report.json') {
      reports.push(path);
    }
  }
  return reports;
}

export async function mergeAuditReportDirectory(options, dependencies = {}) {
  const reportFiles = await findReportFiles(options.mergeInputDirectory);
  const sources = [];
  for (const reportPath of reportFiles) {
    const recordsPath = join(dirname(reportPath), 'maps.jsonl');
    const [reportText, recordsText] = await Promise.all([
      readFile(reportPath, 'utf8'),
      readFile(recordsPath, 'utf8')
    ]);
    sources.push({
      source: reportPath,
      report: JSON.parse(reportText),
      records: recordsText.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
    });
  }
  const result = mergeShardReportData(sources, options);
  if (dependencies.writeFiles !== false) {
    await writeAuditFiles(result, {
      ...options,
      emitRenderFixtures: false,
      emitGallery: false
    }, []);
  }
  return result;
}

export async function runAudit(options, dependencies) {
  const { dispatch, supportedVersions, now = () => performance.now(), writeFiles = true } = dependencies;
  const unsupported = options.versions.filter(version => !supportedVersions.includes(version));
  if (unsupported.length > 0) {
    throw new Error(`unsupported terrain generation versions: ${unsupported.join(', ')}`);
  }
  const { full, selected } = buildAuditMatrix(options);
  const records = [];
  const fixtures = [];
  for (const input of selected) {
    const id = auditRecordId(input);
    const startedAt = now();
    try {
      const map = await quietCall(
        options.quietGeneration,
        () => dispatch(input)
      );
      const finishedAt = now();
      const inspected = inspectBattleMap(map, input);
      if (input.terrainGenerationVersion === 2) {
        let verified = false;
        let details = null;
        try {
          verified = await verifyBattleMapV2Final(map);
        } catch (error) {
          details = { name: error?.name ?? 'Error', message: error?.message ?? String(error) };
        }
        inspected.hardChecks.push(makeCheck('v2-final-hashes', verified, details));
      }
      const generationMs = finishedAt - startedAt;
      const serialized = JSON.stringify(map);
      const payloadBytes = Buffer.byteLength(serialized ?? '', 'utf8');
      inspected.metrics.payloadBytes = payloadBytes;
      const guardrails = [
        makeCheck('payload-bytes', payloadBytes <= options.maximumMapBytes, {
          maximum: options.maximumMapBytes,
          actual: payloadBytes
        }),
        makeCheck('generation-ms', generationMs <= options.maximumGenerationMs, {
          maximum: options.maximumGenerationMs
        })
      ];
      const deterministic = {
        schema: AUDIT_SCHEMA_VERSION,
        id,
        input,
        status: 'generated',
        checks: {
          hard: inspected.hardChecks,
          tactical: inspected.tacticalChecks,
          quality: inspected.qualityChecks,
          guardrails
        },
        stages: inspected.stages,
        metrics: inspected.metrics,
        hashes: inspected.hashes,
        macroSignature: inspected.macroSignature
      };
      records.push({
        ...deterministic,
        deterministicRecordHash: hashValue(deterministic),
        timing: { generationMs }
      });
      if (options.emitRenderFixtures) {
        fixtures.push({
          schema: AUDIT_SCHEMA_VERSION,
          id,
          input,
          hash: inspected.hashes.full,
          map: inspected.projection
        });
      }
    } catch (error) {
      const finishedAt = now();
      const deterministic = {
        schema: AUDIT_SCHEMA_VERSION,
        id,
        input,
        status: 'generation-error',
        error: {
          name: error?.name ?? 'Error',
          message: error?.message ?? String(error)
        }
      };
      records.push({
        ...deterministic,
        deterministicRecordHash: hashValue(deterministic),
        timing: { generationMs: finishedAt - startedAt }
      });
    }
  }

  const aggregate = aggregateRecords(records, full.length, options);
  const failures = failureSummary(records, options.failureLimit);
  const result = {
    generatorVersion: {
      application: await packageVersion(),
      auditSchema: AUDIT_SCHEMA_VERSION
    },
    environment: environmentRecord(supportedVersions),
    matrix: {
      versions: options.versions,
      nodeTypes: options.nodeTypes,
      seeds: options.seeds,
      dimensions: options.dimensions,
      modes: options.modes,
      shardIndex: options.shardIndex,
      shardCount: options.shardCount,
      corpusGatesDeferred: Boolean(options.deferCorpusGates),
      fullMapCount: full.length,
      selectedMapCount: selected.length,
      guardrails: {
        maximumCorpusMaps: options.maximumCorpusMaps,
        maximumMapBytes: options.maximumMapBytes,
        maximumGenerationMs: options.maximumGenerationMs
      }
    },
    records,
    aggregate,
    failures
  };
  if (writeFiles) await writeAuditFiles(result, options, fixtures);
  return result;
}

export function usage() {
  return `Usage: npm run battle-maps:audit -- [options]

Options:
  --versions=1,2             Terrain generation versions (default: 1)
  --node-types=a,b           Node/recipe types (default: all 16 configured types)
  --seeds=0,4,9              Explicit non-negative seed list
  --seed-count=100           Deterministic seed range 0 through COUNT-1
  --seed-range=0:99          Inclusive seed range (START:END or START..END)
  --seed-start=0 --seed-end=99
                             Inclusive seed range as separate arguments
  --dimensions=32x32,16x24   One or more WIDTHxHEIGHT sizes (--sizes is an alias)
  --modes=pve,guild          Closed recipe-supported mode list
  --output-dir=PATH          Artifact directory
  --shard-index=0            Zero-based deterministic shard index
  --shard-count=1            Number of deterministic modulo shards
  --defer-corpus-gates       Defer diversity/collision gates to a merged report
  --merge-input-dir=PATH     Merge shard report.json/maps.jsonl trees and re-run gates
  --failure-limit=50         Maximum detailed failures/collisions
  --max-corpus-maps=20000    Refuse a larger pre-shard matrix (hard cap: 20000)
  --max-map-bytes=4194304    Fail maps above the serialized payload limit
  --max-generation-ms=10000  Fail maps above the generation-time limit
  --emit-render-fixtures     Write deterministic semantic map fixtures
  --emit-gallery             Write fixtures plus static SVG/HTML gallery
  --show-generation-output   Do not suppress generator logging
  --help                     Show this message

Metric-only mode is the default. Gallery mode is deterministic and browser-free.`;
}

async function main() {
  const options = parseAuditArgs();
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.mergeInputDirectory) {
    const result = await mergeAuditReportDirectory(options);
    console.log(JSON.stringify({
      inputDirectory: options.mergeInputDirectory,
      outputDirectory: options.outputDirectory,
      matrix: result.matrix,
      aggregate: result.aggregate,
      failures: result.failures
    }, null, 2));
    if (result.aggregate.requiredFailureCount > 0) {
      process.exitCode = 1;
    }
    return;
  }
  const generation = await import('../shared/mapGeneration.js');
  const supportedVersions = [...generation.SUPPORTED_TERRAIN_GENERATION_VERSIONS];
  const result = await runAudit(options, {
    dispatch: generation.dispatchBattleMapGeneration,
    supportedVersions
  });
  console.log(JSON.stringify({
    outputDirectory: options.outputDirectory,
    matrix: result.matrix,
    aggregate: result.aggregate,
    failures: result.failures
  }, null, 2));
  if (result.aggregate.requiredFailureCount > 0) {
    process.exitCode = 1;
  }
}

if (pathToFileURL(process.argv[1] ?? '').href === import.meta.url) {
  main().catch(error => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
