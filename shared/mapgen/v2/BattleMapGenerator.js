import {
  BATTLE_MAP_HASH_VERSION,
  BATTLE_MAP_SCHEMA_VERSION,
  ELEVATION_FORMAT,
  TERRAIN_GENERATION_VERSION,
  assertBattleMapV2Candidate,
  validateBattleMapV2Candidate
} from '../../battleMap/schema.js';
import {
  finalizeBattleMapV2,
  verifyBattleMapV2Final
} from '../../battleMap/hashes.js';
import {
  discretizeElevation,
  getTerrainMovementCost,
  isImpassable
} from '../../terrain.js';
import { compileFeasibilityProfile } from './Feasibility.js';
import { generateHydrology } from './Hydrology.js';
import {
  generateCoherentElevation,
  generateLandscapeFieldSet
} from './LandscapeFields.js';
import { generateTerrainRegions } from './Regions.js';
import {
  V2_PRODUCTION_NODE_TYPES,
  getV2Recipe
} from './RecipeRegistry.js';
import {
  V2_RENDER_CAPABILITY_CATALOG,
  assertV2AssetCapability,
  getV2VisualCapabilities
} from './RenderCapabilities.js';
import { planFeatureRoutes } from './RoutePlanner.js';
import { integrateActualSpawns } from './SpawnIntegration.js';
import { resolveSpawnLayout } from './SpawnLayoutContract.js';
import { placeEcologyAndBlockers } from './EcologyPlacement.js';
import { generateVisualLayers } from './VisualLayers.js';
import {
  coordinateHash32,
  V2_QUANTIZATION_SCALE,
  V2_STREAM_VERSION
} from './Determinism.js';
import { createV2Context, deepFreeze } from './V2Context.js';
import {
  createStageRegistry,
  executeStagePipeline
} from './StageRegistry.js';
import {
  runBoundedCandidateSelection,
  toCandidateValidationDiagnostics,
  validateV2Candidate
} from './Validation.js';

const REQUEST_KEYS = Object.freeze([
  'terrainSeed',
  'nodeType',
  'mapWidth',
  'mapHeight',
  'mode',
  'playerCount',
  'enemyCapacity',
  'enemyCount',
  'enemyStrategy',
  'existingUnits',
  'maxAttempts'
]);
const REQUEST_KEY_SET = new Set(REQUEST_KEYS);
const CARDINAL = Object.freeze([
  Object.freeze({ dx: 0, dy: -1 }),
  Object.freeze({ dx: 1, dy: 0 }),
  Object.freeze({ dx: 0, dy: 1 }),
  Object.freeze({ dx: -1, dy: 0 })
]);
const STAGE_IDS = Object.freeze([
  'landscape-fields',
  'coherent-elevation',
  'terrain-regions',
  'hydrology',
  'route-network',
  'semantic-layers',
  'ecology',
  'actual-spawns',
  'visual-layers',
  'feature-index'
]);

function positiveInteger(value, name, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${name} must be an integer from 1 to ${maximum}`);
  }
  return value;
}

/**
 * Normalize the closed public generation request before any attempt seed is
 * consumed. Unknown fields fail closed so replay inputs cannot be ambiguous.
 */
export function normalizeBattleMapV2Request(input = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('BattleMapV2 generation request must be an object');
  }
  for (const key of Object.keys(input)) {
    if (!REQUEST_KEY_SET.has(key)) {
      throw new TypeError(`Unknown BattleMapV2 generation request field: ${key}`);
    }
  }
  if (!Number.isSafeInteger(input.terrainSeed)) {
    throw new TypeError('terrainSeed must be a safe integer');
  }
  if (!V2_PRODUCTION_NODE_TYPES.includes(input.nodeType)) {
    getV2Recipe(input.nodeType);
  }
  const mode = input.mode ?? 'pve';
  const playerCount = positiveInteger(input.playerCount ?? 5, 'playerCount', 5);
  const defaultEnemyCapacity = mode === 'pvp' || mode === 'pvp_coliseum'
    ? playerCount
    : Math.max(6, playerCount);
  const enemyCapacity = positiveInteger(
    input.enemyCapacity ?? defaultEnemyCapacity,
    'enemyCapacity',
    24
  );
  const enemyCount = positiveInteger(
    input.enemyCount ?? Math.min(defaultEnemyCapacity, enemyCapacity),
    'enemyCount',
    enemyCapacity
  );
  const existingUnits = input.existingUnits ?? [];
  if (!Array.isArray(existingUnits)) {
    throw new TypeError('existingUnits must be an array');
  }
  if (input.maxAttempts !== undefined) {
    positiveInteger(input.maxAttempts, 'maxAttempts', 16);
  }
  const request = {
    terrainSeed: input.terrainSeed,
    nodeType: input.nodeType,
    mapWidth: positiveInteger(input.mapWidth ?? 32, 'mapWidth', 64),
    mapHeight: positiveInteger(input.mapHeight ?? 32, 'mapHeight', 64),
    mode,
    playerCount,
    enemyCapacity,
    enemyCount,
    enemyStrategy: input.enemyStrategy ?? 'formation',
    existingUnits: existingUnits.map(unit => ({ ...unit })),
    maxAttempts: input.maxAttempts ?? null
  };
  return deepFreeze(request);
}

function anchorPairs(spawnContract) {
  const players = spawnContract.exits
    .filter(exit => exit.side === spawnContract.playerSide);
  const enemies = spawnContract.exits
    .filter(exit => exit.side === spawnContract.enemySide);
  return players.map((from, index) => ({
    id: `protected-anchor-pair:${String(index + 1).padStart(2, '0')}`,
    from: { x: from.x, y: from.y },
    to: { x: enemies[index % enemies.length].x, y: enemies[index % enemies.length].y }
  }));
}

function routeAnchors(spawnContract, regions) {
  return spawnContract.exits.map(exit => ({
    id: exit.id,
    required: true,
    x: exit.x,
    y: exit.y,
    featureId: regions.regionIdGrid[exit.y][exit.x]
  }));
}

function directionOf(from, to) {
  if (to.x === from.x && to.y === from.y - 1) return 'n';
  if (to.x === from.x + 1 && to.y === from.y) return 'e';
  if (to.x === from.x && to.y === from.y + 1) return 's';
  if (to.x === from.x - 1 && to.y === from.y) return 'w';
  throw new TypeError(`Elevation connection is not cardinal: ${from.x},${from.y} -> ${to.x},${to.y}`);
}

function semanticLayers(context) {
  const recipe = context.require('resolvedRecipe');
  const regions = context.require('regionIndex');
  const hydrology = context.require('hydrology');
  const routes = context.require('routes');
  const levels = context.require('elevationLevels');
  const terrain = regions.materialGrid.map((row, y) => row.map((regionMaterial, x) => {
    // A route's shoulder is part of its authoritative traversable footprint,
    // not just a visual accent. This keeps the generated route at the recipe's
    // declared clearance even when the surrounding region is blocking.
    const route = routes.masks.pathMask[y][x] || routes.masks.shoulderMask[y][x];
    const proposedMaterial = route
      ? recipe.routeMaterial
      : hydrology.featureMask[y][x]
        ? hydrology.material
        : regionMaterial;
    const material = V2_RENDER_CAPABILITY_CATALOG.has(
      `${recipe.renderPalette}:floor:${proposedMaterial}`
    )
      ? proposedMaterial
      : recipe.baseMaterial;
    // Volcanic "rock" is an authored basalt floor material; blockers remain
    // explicit ecology records. Treating it as the legacy blocking terrain
    // token makes the recipe's 60% usable-area contract mathematically
    // impossible on most seeds.
    const passable = route ||
      (recipe.nodeType === 'volcano' && material === 'rock') ||
      !isImpassable(material);
    const movementCost = passable
      ? (route ? 1 : getTerrainMovementCost(material))
      : 0;
    return {
      material,
      movementCost: Number.isFinite(movementCost) ? movementCost : 0,
      passable,
      regionId: regions.regionIdGrid[y][x]
    };
  }));

  const kind = ['constructed', 'subterranean', 'arena'].includes(recipe.family)
    ? 'stairs'
    : 'slope';
  const seen = new Set();
  const selectedConnections = [];
  for (const reconciliation of routes.reconciliationRequests) {
    for (const request of reconciliation.connectionRequests) {
      const from = request.from;
      const to = request.to;
      const edgeKey = [
        `${from.x},${from.y}`,
        `${to.x},${to.y}`
      ].sort().join('|');
      if (seen.has(edgeKey)) continue;
      const delta = levels[to.y][to.x] - levels[from.y][from.x];
      if (Math.abs(delta) !== 1) continue;
      seen.add(edgeKey);
      selectedConnections.push({
        id: `elevation-connection:${String(selectedConnections.length + 1).padStart(4, '0')}`,
        from: { x: from.x, y: from.y },
        to: { x: to.x, y: to.y },
        kind,
        direction: directionOf(from, to),
        elevationDelta: delta,
        bidirectional: true,
        featureId: reconciliation.routeId
      });
    }
  }
  for (let y = 0; y < terrain.length; y++) {
    for (let x = 0; x < terrain[y].length; x++) {
      if (!terrain[y][x].passable) continue;
      for (const { dx, dy } of [{ dx: 1, dy: 0 }, { dx: 0, dy: 1 }]) {
        const to = { x: x + dx, y: y + dy };
        if (!terrain[to.y]?.[to.x]?.passable) continue;
        const from = { x, y };
        const edgeKey = [`${from.x},${from.y}`, `${to.x},${to.y}`].sort().join('|');
        if (seen.has(edgeKey)) continue;
        const delta = levels[to.y][to.x] - levels[from.y][from.x];
        if (Math.abs(delta) !== 1) continue;
        seen.add(edgeKey);
        selectedConnections.push({
          id: `elevation-connection:${String(selectedConnections.length + 1).padStart(4, '0')}`,
          from,
          to,
          kind,
          direction: directionOf(from, to),
          elevationDelta: delta,
          bidirectional: true,
          featureId: null
        });
      }
    }
  }
  return { terrain, selectedConnections };
}

function clearingBudget(feasibility) {
  return feasibility.budgets.clearingCount ??
    feasibility.optionalFeatures.find(feature => feature.kind === 'clearing')?.budget ??
    1;
}

function createClearings(context) {
  const request = context.require('request');
  const fields = context.require('landscapeFields');
  const regions = context.require('regionIndex');
  const hydrology = context.require('hydrology');
  const routes = context.require('routes');
  const terrain = context.require('spawnIntegration').terrain;
  const obstacles = new Set(context.require('obstacles').map(item => `${item.x},${item.y}`));
  const spawnContract = context.require('spawnContract');
  const feasibility = context.require('feasibility');
  const width = request.mapWidth;
  const height = request.mapHeight;
  const desiredSize = Math.max(8, Math.min(36, Math.floor(width * height / 60)));
  const candidates = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (!terrain[y][x].passable || hydrology.featureMask[y][x] ||
          routes.masks.pathMask[y][x] || spawnContract.featherMask[y][x] ||
          obstacles.has(`${x},${y}`)) continue;
      candidates.push({
        x,
        y,
        regionId: regions.regionIdGrid[y][x],
        score: Math.abs(fields.roughness[y][x]) + Math.abs(fields.detail[y][x]) / 2,
        tie: coordinateHash32(context.attemptSeed, x, y, 'clearing')
      });
    }
  }
  candidates.sort((a, b) => a.score - b.score || a.tie - b.tie || a.y - b.y || a.x - b.x);
  const claimed = new Set();
  const clearings = [];
  for (const seed of candidates) {
    if (clearings.length >= clearingBudget(feasibility) || claimed.has(`${seed.x},${seed.y}`)) break;
    const queue = [seed];
    const queued = new Set([`${seed.x},${seed.y}`]);
    const cells = [];
    for (let index = 0; index < queue.length && cells.length < desiredSize; index++) {
      const point = queue[index];
      const key = `${point.x},${point.y}`;
      if (claimed.has(key) || obstacles.has(key) ||
          regions.regionIdGrid[point.y][point.x] !== seed.regionId ||
          !terrain[point.y][point.x].passable ||
          hydrology.featureMask[point.y][point.x] ||
          routes.masks.pathMask[point.y][point.x] ||
          spawnContract.featherMask[point.y][point.x]) continue;
      cells.push({ x: point.x, y: point.y });
      const next = CARDINAL.map(({ dx, dy }) => ({ x: point.x + dx, y: point.y + dy }))
        .filter(point => point.x > 0 && point.y > 0 &&
          point.x < width - 1 && point.y < height - 1)
        .sort((a, b) => coordinateHash32(context.attemptSeed, a.x, a.y, 'clearing-grow') -
          coordinateHash32(context.attemptSeed, b.x, b.y, 'clearing-grow'));
      for (const point of next) {
        const nextKey = `${point.x},${point.y}`;
        if (!queued.has(nextKey)) {
          queued.add(nextKey);
          queue.push(point);
        }
      }
    }
    if (cells.length < Math.min(8, desiredSize)) continue;
    cells.sort((a, b) => a.y - b.y || a.x - b.x);
    cells.forEach(point => claimed.add(`${point.x},${point.y}`));
    clearings.push({
      id: `clearing:${String(clearings.length + 1).padStart(3, '0')}`,
      kind: 'clearing',
      bounds: {
        minX: Math.min(...cells.map(cell => cell.x)),
        minY: Math.min(...cells.map(cell => cell.y)),
        maxX: Math.max(...cells.map(cell => cell.x)),
        maxY: Math.max(...cells.map(cell => cell.y))
      },
      cells,
      parentRegionId: seed.regionId
    });
  }
  return clearings;
}

function preserveRouteClearance(obstacles, routes, minimumClearance) {
  const requiredCells = routes.features
    .filter(route => route.required)
    .flatMap(route => route.centerline);
  return obstacles.filter(obstacle => requiredCells.every(point =>
    Math.abs(obstacle.x - point.x) + Math.abs(obstacle.y - point.y) >= minimumClearance
  ));
}

function buildFeatureIndex(context) {
  return {
    regions: context.require('regionIndex').regions,
    waterBodies: context.require('hydrology').waterBodies,
    routes: context.require('routes').features,
    clearings: createClearings(context),
    structures: context.require('ecology').structures
  };
}

function createRegistry() {
  const registry = createStageRegistry();
  registry.register({
    id: 'landscape-fields',
    inputs: ['request', 'resolvedRecipe', 'feasibility'],
    outputs: ['landscapeFields'],
    stream: 'landscape-fields',
    run(context) {
      const request = context.require('request');
      return {
        landscapeFields: generateLandscapeFieldSet({
          width: request.mapWidth,
          height: request.mapHeight,
          attemptSeed: context.attemptSeed,
          recipe: context.require('resolvedRecipe'),
          feasibility: context.require('feasibility')
        })
      };
    }
  });
  registry.register({
    id: 'coherent-elevation',
    inputs: ['landscapeFields', 'resolvedRecipe', 'spawnContract'],
    outputs: ['continuousElevation', 'elevationLevels', 'elevation', 'connectionCandidates'],
    stream: 'coherent-elevation',
    run(context) {
      const result = generateCoherentElevation({
        fields: context.require('landscapeFields'),
        recipe: context.require('resolvedRecipe'),
        spawnLayout: context.require('spawnContract')
      });
      return {
        continuousElevation: result.continuousElevation,
        elevationLevels: result.discreteElevation,
        elevation: result.elevation,
        connectionCandidates: result.connectionCandidates
      };
    }
  });
  registry.register({
    id: 'terrain-regions',
    inputs: ['request', 'resolvedRecipe', 'landscapeFields', 'spawnContract'],
    outputs: ['regionIndex'],
    stream: 'terrain-regions',
    run(context) {
      const request = context.require('request');
      return {
        regionIndex: generateTerrainRegions({
          width: request.mapWidth,
          height: request.mapHeight,
          recipe: context.require('resolvedRecipe'),
          fields: context.require('landscapeFields'),
          spawnLayout: context.require('spawnContract'),
          structuredOverlays: []
        })
      };
    }
  });
  registry.register({
    id: 'hydrology',
    inputs: ['request', 'resolvedRecipe', 'feasibility', 'landscapeFields', 'regionIndex', 'spawnContract'],
    outputs: ['hydrology'],
    stream: 'hydrology',
    run(context) {
      const request = context.require('request');
      const result = generateHydrology({
        width: request.mapWidth,
        height: request.mapHeight,
        attemptSeed: context.attemptSeed,
        recipe: context.require('resolvedRecipe'),
        feasibility: context.require('feasibility'),
        fields: context.require('landscapeFields'),
        regions: context.require('regionIndex'),
        spawnLayout: context.require('spawnContract'),
        structureFootprints: [],
        requiredAnchorPairs: anchorPairs(context.require('spawnContract'))
      });
      return {
        hydrology: {
          ...result,
          routeAnchorEvidence: (result.anchorPairEvidence ?? []).map(evidence => ({
            fromAnchorId: context.require('spawnContract').exits.find(exit =>
              exit.x === evidence.from.x && exit.y === evidence.from.y
            )?.id,
            toAnchorId: context.require('spawnContract').exits.find(exit =>
              exit.x === evidence.to.x && exit.y === evidence.to.y
            )?.id,
            required: true,
            landOnly: evidence.landOnlyCorridor,
            crossingCandidateIds: evidence.crossingCandidateIds
          }))
        }
      };
    }
  });
  registry.register({
    id: 'route-network',
    inputs: ['request', 'resolvedRecipe', 'landscapeFields', 'hydrology', 'regionIndex', 'spawnContract', 'elevationLevels', 'connectionCandidates'],
    outputs: ['routes'],
    stream: 'route-network',
    run(context) {
      const request = context.require('request');
      const recipe = context.require('resolvedRecipe');
      const spawnContract = context.require('spawnContract');
      return {
        routes: planFeatureRoutes({
          anchors: routeAnchors(spawnContract, context.require('regionIndex')),
          dimensions: { width: request.mapWidth, height: request.mapHeight },
          fields: context.require('landscapeFields'),
          hydrology: context.require('hydrology'),
          spawnLayout: spawnContract,
          elevationLevels: context.require('elevationLevels'),
          connectionCandidates: context.require('connectionCandidates'),
          requiredRegionGrid: context.require('regionIndex').regionIdGrid,
          requiredRegionIds: [],
          recipe,
          attemptSeed: context.attemptSeed,
          minimumClearance: recipe.tactical.minimumRouteClearance,
          loopCount: recipe.family === 'arena' ? 1 : 0
        })
      };
    }
  });
  registry.register({
    id: 'semantic-layers',
    inputs: ['resolvedRecipe', 'regionIndex', 'hydrology', 'routes', 'elevationLevels'],
    outputs: ['terrain', 'selectedConnections'],
    stream: 'semantic-layers',
    run: semanticLayers
  });
  registry.register({
    id: 'ecology',
    inputs: ['request', 'resolvedRecipe', 'landscapeFields', 'regionIndex', 'terrain', 'elevation', 'selectedConnections', 'routes', 'hydrology', 'spawnContract'],
    outputs: ['ecology', 'obstacles'],
    stream: 'ecology',
    run(context) {
      const request = context.require('request');
      const preliminary = integrateActualSpawns({
        spawnLayout: context.require('spawnContract'),
        terrain: context.require('terrain'),
        elevation: context.require('elevation'),
        elevationConnections: context.require('selectedConnections'),
        obstacles: [],
        routes: context.require('routes').features,
        enemyCount: request.enemyCount,
        enemyStrategy: request.enemyStrategy,
        existingUnits: request.existingUnits
      });
      const placedEcology = placeEcologyAndBlockers({
        width: request.mapWidth,
        height: request.mapHeight,
        attemptSeed: context.attemptSeed,
        recipe: context.require('resolvedRecipe'),
        fields: context.require('landscapeFields'),
        regions: context.require('regionIndex'),
        terrain: preliminary.terrain,
        elevation: preliminary.elevation,
        spawnLayout: context.require('spawnContract'),
        routePlan: context.require('routes'),
        hydrology: context.require('hydrology'),
        elevationConnections: context.require('selectedConnections'),
        reservationMask: preliminary.reservationMask
      });
      const obstacles = preserveRouteClearance(
        placedEcology.obstacles,
        context.require('routes'),
        context.require('resolvedRecipe').tactical.minimumRouteClearance
      );
      const ecology = { ...placedEcology, obstacles };
      return { ecology, obstacles };
    }
  });
  registry.register({
    id: 'actual-spawns',
    inputs: ['request', 'spawnContract', 'terrain', 'elevation', 'selectedConnections', 'obstacles', 'routes'],
    outputs: ['spawnIntegration', 'spawnLayout'],
    stream: 'actual-spawns',
    run(context) {
      const request = context.require('request');
      const spawnIntegration = integrateActualSpawns({
        spawnLayout: context.require('spawnContract'),
        terrain: context.require('terrain'),
        elevation: context.require('elevation'),
        elevationConnections: context.require('selectedConnections'),
        obstacles: context.require('obstacles'),
        routes: context.require('routes').features,
        enemyCount: request.enemyCount,
        enemyStrategy: request.enemyStrategy,
        existingUnits: request.existingUnits
      });
      return {
        spawnIntegration,
        spawnLayout: spawnIntegration.spawnLayout
      };
    }
  });
  registry.register({
    id: 'visual-layers',
    inputs: ['request', 'resolvedRecipe', 'landscapeFields', 'regionIndex', 'hydrology', 'routes', 'ecology', 'spawnContract', 'spawnIntegration', 'selectedConnections'],
    outputs: ['visualLayers', 'variants', 'transitions', 'decorations'],
    stream: 'visual-layers',
    run(context) {
      const request = context.require('request');
      const recipe = context.require('resolvedRecipe');
      const spawnIntegration = context.require('spawnIntegration');
      const visualLayers = generateVisualLayers({
        width: request.mapWidth,
        height: request.mapHeight,
        attemptSeed: context.attemptSeed,
        recipe,
        terrain: spawnIntegration.terrain,
        elevation: spawnIntegration.elevation,
        fields: context.require('landscapeFields'),
        regions: context.require('regionIndex'),
        hydrology: context.require('hydrology'),
        routes: context.require('routes'),
        ecology: context.require('ecology'),
        elevationConnections: context.require('selectedConnections'),
        capabilities: getV2VisualCapabilities(recipe),
        spawnLayout: context.require('spawnContract'),
        reservationMask: spawnIntegration.reservationMask
      });
      return {
        visualLayers,
        variants: visualLayers.variants,
        transitions: visualLayers.transitions,
        decorations: visualLayers.decorations
      };
    }
  });
  registry.register({
    id: 'feature-index',
    inputs: ['request', 'feasibility', 'landscapeFields', 'regionIndex', 'hydrology', 'routes', 'ecology', 'obstacles', 'spawnContract', 'spawnIntegration'],
    outputs: ['features'],
    stream: 'feature-index',
    run(context) {
      return { features: buildFeatureIndex(context) };
    }
  });
  return registry;
}

function scalarParameters(request, recipe) {
  const records = [];
  const visit = (prefix, value) => {
    if (typeof value === 'string' || typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))) {
      records.push({ name: prefix, value });
      return;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    for (const key of Object.keys(value).sort()) {
      visit(prefix ? `${prefix}.${key}` : key, value[key]);
    }
  };
  visit('recipe', recipe);
  visit('request', {
    ...request,
    existingUnits: undefined,
    existingUnitCount: request.existingUnits.length,
    maxAttempts: request.maxAttempts ?? 0
  });
  return records.sort((a, b) => a.name.localeCompare(b.name));
}

function diagnostics(context, validation = null) {
  const recipe = context.require('resolvedRecipe');
  const resolved = validation
    ? toCandidateValidationDiagnostics(validation.result, validation.constraints)
    : {
        hardValidation: { valid: false, checks: [] },
        tacticalValidation: { passed: false, checks: [] },
        qualityMetrics: { score: 0, metrics: [] }
      };
  return {
    resolvedRecipe: {
      recipeId: recipe.nodeType,
      recipeVersion: recipe.schemaVersion,
      renderPalette: recipe.renderPalette,
      quantization: {
        scale: V2_QUANTIZATION_SCALE,
        rounding: 'half-away-from-zero'
      },
      parameters: scalarParameters(context.require('request'), recipe)
    },
    attempt: context.attempt,
    streamVersion: V2_STREAM_VERSION,
    hashVersion: BATTLE_MAP_HASH_VERSION,
    algorithms: context.getStageEvents().map(event => ({
      id: `algorithm:${event.stageId}`,
      stage: event.stageId,
      version: '1',
      optional: false,
      status: 'applied',
      outputFeatureIds: []
    })),
    ...resolved
  };
}

function buildCandidate(context) {
  const request = context.require('request');
  const recipe = context.require('resolvedRecipe');
  const spawnIntegration = context.require('spawnIntegration');
  return {
    battleMapSchemaVersion: BATTLE_MAP_SCHEMA_VERSION,
    terrainGenerationVersion: TERRAIN_GENERATION_VERSION,
    terrainSeed: request.terrainSeed,
    mapWidth: request.mapWidth,
    mapHeight: request.mapHeight,
    nodeType: recipe.nodeType,
    biome: recipe.biome,
    archetype: recipe.archetype,
    elevationFormat: ELEVATION_FORMAT,
    terrain: spawnIntegration.terrain,
    elevation: spawnIntegration.elevation,
    elevationConnections: context.require('selectedConnections'),
    obstacles: context.require('obstacles'),
    spawnLayout: context.require('spawnLayout'),
    variants: context.require('variants'),
    transitions: context.require('transitions'),
    decorations: context.require('decorations'),
    features: context.require('features'),
    diagnostics: diagnostics(context)
  };
}

function paletteOf(candidate) {
  return [...new Set(candidate.terrain.flat().map(cell => cell.material))];
}

function requiredRegionRecords(candidate) {
  const requiredIds = new Set(candidate.features.routes.flatMap(route =>
    route.anchorFeatureIds
  ));
  const byId = new Map(candidate.features.regions
    .filter(region => requiredIds.has(region.id))
    .map(region => [region.id, { id: region.id, required: true, cells: [] }]));
  for (let y = 0; y < candidate.mapHeight; y++) {
    for (let x = 0; x < candidate.mapWidth; x++) {
      const cell = candidate.terrain[y][x];
      if (cell.passable && byId.has(cell.regionId)) {
        byId.get(cell.regionId).cells.push({ x, y });
      }
    }
  }
  return [...byId.values()].filter(region => region.cells.length > 0);
}

function requiredValidationRoutes(candidate, spawnContract) {
  return candidate.features.routes
    .filter(route => route.required)
    .map(route => {
      const outsideFeather = route.centerline.filter(point =>
        !spawnContract.featherMask[point.y][point.x]
      );
      // Compact and narrow maps can legitimately have overlapping feather
      // envelopes. Validate their complete required route rather than passing
      // an empty sample to the clearance check.
      return {
        ...route,
        centerline: outsideFeather.length > 0
          ? outsideFeather
          : route.centerline
      };
    });
}

function tacticalConstraints(recipe, area) {
  const fixed = value => value / V2_QUANTIZATION_SCALE;
  return {
    minRouteDiversity: recipe.tactical.minimumDisjointRoutes,
    minUsableAreaRatio: fixed(recipe.tactical.minimumUsableArea),
    maxUsableAreaRatio: 1,
    maxDetourRatio: fixed(recipe.tactical.maximumDetour),
    minCorridorClearance: recipe.tactical.minimumRouteClearance,
    chokeThreshold: 1,
    maxChokeRatio: 0.8,
    maxAccidentalDeadEnds: Math.max(4, Math.floor(area / 20)),
    minApproachParity: recipe.family === 'arena'
      ? 1 - fixed(recipe.tactical.competitiveParityTolerance)
      : 0,
    minLosParity: recipe.family === 'arena'
      ? 1 - fixed(recipe.tactical.competitiveParityTolerance)
      : 0
  };
}

function competitiveInput(candidate, spawnContract, recipe) {
  if (recipe.family !== 'arena') return null;
  const left = Math.floor((candidate.mapWidth - 1) / 2);
  const right = Math.ceil((candidate.mapWidth - 1) / 2);
  const top = Math.floor((candidate.mapHeight - 1) / 2);
  const bottom = Math.ceil((candidate.mapHeight - 1) / 2);
  return {
    sides: [
      { mask: spawnContract.playerCoreMask },
      { mask: spawnContract.enemyCoreMask }
    ],
    objectives: [
      { x: left, y: top },
      ...(left === right && top === bottom ? [] : [{ x: right, y: bottom }])
    ]
  };
}

function strictCandidateGate(candidate, recipe, requireValidation) {
  assertBattleMapV2Candidate(candidate);
  for (const cell of candidate.terrain.flat()) {
    assertV2AssetCapability(`${recipe.renderPalette}:floor:${cell.material}`);
  }
  for (const record of [
    ...candidate.obstacles,
    ...candidate.transitions,
    ...candidate.decorations,
    ...candidate.features.structures
  ]) {
    assertV2AssetCapability(record.assetKey);
  }
  for (const connection of candidate.elevationConnections) {
    const direction = directionOf(connection.from, connection.to);
    const fromLevel = discretizeElevation(
      candidate.elevation[connection.from.y][connection.from.x]
    );
    const toLevel = discretizeElevation(
      candidate.elevation[connection.to.y][connection.to.x]
    );
    if (direction !== connection.direction ||
        toLevel - fromLevel !== connection.elevationDelta ||
        Math.abs(connection.elevationDelta) !== 1) {
      throw new TypeError(`Elevation connection ${connection.id} disagrees with semantic elevation`);
    }
    const variant = connection.kind === 'stairs' ? 2 : 1;
    assertV2AssetCapability(
      `${recipe.renderPalette}:connection:${connection.kind}:${direction}:${variant}`
    );
  }
  if (requireValidation &&
      (!candidate.diagnostics.hardValidation.valid ||
       !candidate.diagnostics.tacticalValidation.passed ||
       !candidate.diagnostics.qualityMetrics.metrics.every(metric => metric.passed))) {
    throw new TypeError(
      'BattleMapV2 finalization requires hard, tactical, and quality validation passes'
    );
  }
}

/**
 * Generate, validate, rank, hash, and verify one deterministic BattleMapV2.
 * Every feasible attempt is evaluated before the winning candidate is chosen.
 */
export async function generateBattleMapV2(input) {
  const request = normalizeBattleMapV2Request(input);
  const recipe = getV2Recipe(request.nodeType);
  const feasibility = compileFeasibilityProfile(request, {
    capabilityCatalog: V2_RENDER_CAPABILITY_CATALOG
  });
  const minimumExits = Math.min(
    3,
    recipe.family === 'arena' ? 3 : recipe.tactical.minimumDisjointRoutes
  );
  const spawnContract = resolveSpawnLayout({
    ...request,
    minimumExits,
    coreRadius: 1,
    featherRadius: 3
  });
  const maximumAttempts = request.maxAttempts === null
    ? feasibility.budgets.maximumAttempts
    : Math.min(request.maxAttempts, feasibility.budgets.maximumAttempts);
  const metadata = new WeakMap();
  const registry = createRegistry();
  const selection = await runBoundedCandidateSelection({
    terrainSeed: request.terrainSeed,
    terrainGenerationVersion: TERRAIN_GENERATION_VERSION,
    maxAttempts: maximumAttempts,
    async generateCandidate({ attempt, attemptSeed }) {
      const context = createV2Context({
        width: request.mapWidth,
        height: request.mapHeight,
        terrainSeed: request.terrainSeed,
        attempt,
        attemptSeed
      });
      context.publish('request', request, 'bootstrap');
      context.publish('resolvedRecipe', recipe, 'bootstrap');
      context.publish('feasibility', feasibility, 'bootstrap');
      context.publish('spawnContract', spawnContract, 'bootstrap');
      await executeStagePipeline({
        registry,
        stageIds: STAGE_IDS,
        context
      });
      const candidate = buildCandidate(context);
      strictCandidateGate(candidate, recipe, false);
      const constraints = tacticalConstraints(recipe, request.mapWidth * request.mapHeight);
      metadata.set(candidate, { context, constraints });
      return candidate;
    },
    validateCandidate(candidate) {
      const { context, constraints } = metadata.get(candidate);
      return validateV2Candidate({
        candidate,
        traversalView: context.require('spawnIntegration').traversalView,
        spawnLayout: candidate.spawnLayout,
        spawnRequirements: {
          playerCount: request.playerCount,
          enemyCapacity: request.enemyCapacity
        },
        sourceZone: { mask: spawnContract.playerCoreMask },
        targetZone: { mask: spawnContract.enemyCoreMask },
        requiredRegions: requiredRegionRecords(candidate),
        requiredRoutes: requiredValidationRoutes(candidate, spawnContract),
        competitive: competitiveInput(candidate, spawnContract, recipe),
        constraints,
        preferences: {
          desiredRouteDiversity: recipe.tactical.minimumDisjointRoutes,
          desiredCorridorClearance: recipe.tactical.minimumRouteClearance
        },
        recipe,
        palette: paletteOf(candidate),
        schemaValidate: validateBattleMapV2Candidate
      });
    },
    stableKey(candidate, attempt) {
      return candidate
        ? `${candidate.nodeType}:${candidate.terrainSeed}:${attempt}`
        : `failed:${attempt}`;
    },
    requireTacticalPass: true,
    requireQualityPass: true
  });
  const selected = selection.selected;
  const selectedMetadata = metadata.get(selected.candidate);
  const candidate = {
    ...selected.candidate,
    diagnostics: diagnostics(selectedMetadata.context, {
      result: selected.validation,
      constraints: selectedMetadata.constraints
    })
  };
  strictCandidateGate(candidate, recipe, true);
  const finalMap = await finalizeBattleMapV2(candidate);
  if (!await verifyBattleMapV2Final(finalMap)) {
    throw new Error('Final BattleMapV2 hash verification failed');
  }
  return finalMap;
}
