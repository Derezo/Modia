import test from 'node:test';
import assert from 'node:assert/strict';

import { validateBattleMapV2Candidate } from '../../battleMap/schema.js';
import { deriveAttemptSeed } from './Determinism.js';
import {
  ECOLOGY_RUNTIME_CATALOG,
  placeEcologyAndBlockers,
  selectMinimumDistanceCandidates
} from './EcologyPlacement.js';
import { compileFeasibilityProfile } from './Feasibility.js';
import { generateLandscapeFieldSet } from './LandscapeFields.js';
import { generateTerrainRegions } from './Regions.js';
import { getV2Recipe, V2_PRODUCTION_NODE_TYPES } from './RecipeRegistry.js';
import { resolveSpawnLayout } from './SpawnLayoutContract.js';

function booleanGrid(width, height, value = false) {
  return Array.from({ length: height }, () => Array(width).fill(value));
}

function routePlan(width, height) {
  return {
    masks: {
      centerlineMask: booleanGrid(width, height),
      pathMask: booleanGrid(width, height)
    }
  };
}

function generatedFixture(nodeType, width, height, terrainSeed) {
  const request = {
    nodeType,
    mode: 'pve',
    mapWidth: width,
    mapHeight: height,
    playerCount: 4,
    enemyCapacity: 6
  };
  const recipe = getV2Recipe(nodeType);
  const feasibility = compileFeasibilityProfile(request);
  const spawnLayout = resolveSpawnLayout(request);
  const attemptSeed = deriveAttemptSeed(terrainSeed, 2, 0);
  const fields = generateLandscapeFieldSet({
    width,
    height,
    attemptSeed,
    recipe,
    feasibility
  });
  const regions = generateTerrainRegions({
    width,
    height,
    recipe,
    fields,
    spawnLayout
  });
  const terrain = regions.materialGrid.map((row, y) => row.map((material, x) => ({
    material,
    movementCost: 1,
    passable: true,
    regionId: regions.regionIdGrid[y][x]
  })));
  return {
    width,
    height,
    attemptSeed,
    recipe,
    fields,
    regions,
    terrain,
    elevation: booleanGrid(width, height, 0),
    spawnLayout,
    routePlan: routePlan(width, height),
    hydrology: { featureMask: booleanGrid(width, height) }
  };
}

function diagnostics() {
  return {
    resolvedRecipe: {
      recipeId: 'ecology-test',
      recipeVersion: '1',
      renderPalette: 'forest',
      quantization: { scale: 1_000_000, rounding: 'floor' },
      parameters: []
    },
    attempt: 0,
    streamVersion: 'bmg-v2-streams-v1',
    hashVersion: 'sha256-cjson-v1',
    algorithms: [],
    hardValidation: { valid: true, checks: [] },
    tacticalValidation: { passed: true, checks: [] },
    qualityMetrics: { score: 1, metrics: [] }
  };
}

function candidateFrom(fixture, ecology) {
  return {
    battleMapSchemaVersion: 2,
    terrainGenerationVersion: 2,
    terrainSeed: fixture.attemptSeed,
    mapWidth: fixture.width,
    mapHeight: fixture.height,
    nodeType: fixture.recipe.nodeType,
    biome: fixture.recipe.biome,
    archetype: fixture.recipe.archetype,
    elevationFormat: 'normalized',
    terrain: fixture.terrain,
    elevation: fixture.elevation,
    elevationConnections: [],
    obstacles: ecology.obstacles,
    spawnLayout: {
      slots: [],
      protectedZones: [],
      stagingRegions: [],
      exits: [],
      minimumApproachExits: 0
    },
    variants: [],
    transitions: [],
    decorations: ecology.decorations,
    features: {
      regions: fixture.regions.regions,
      waterBodies: [],
      routes: [],
      clearings: [],
      structures: ecology.structures
    },
    diagnostics: diagnostics()
  };
}

function syntheticFixture({
  width = 31,
  height = 19,
  nodeType = 'forest',
  regionKind = 'grove',
  material = 'grass'
} = {}) {
  const recipe = getV2Recipe(nodeType);
  const regionId = `region:${regionKind}:0:0`;
  const fields = {
    height: booleanGrid(width, height, 0),
    moisture: Array.from({ length: height }, () =>
      Array.from(
        { length: width },
        (_, x) => Math.floor(-1_000_000 + x * 2_000_000 / Math.max(1, width - 1))
      )
    ),
    roughness: booleanGrid(width, height, 300_000),
    disturbance: booleanGrid(width, height, -400_000)
  };
  const spawnLayout = {
    coreMask: booleanGrid(width, height),
    featherMask: booleanGrid(width, height)
  };
  return {
    width,
    height,
    attemptSeed: deriveAttemptSeed(48151, 2, 0),
    recipe,
    fields,
    regions: {
      regionIdGrid: booleanGrid(width, height, regionId),
      kindGrid: booleanGrid(width, height, regionKind),
      regions: [{
        id: regionId,
        kind: regionKind,
        material,
        bounds: { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 },
        area: width * height,
        adjacentRegionIds: [],
        parentFeatureId: null
      }]
    },
    terrain: Array.from({ length: height }, () =>
      Array.from({ length: width }, () => ({
        material,
        movementCost: 1,
        passable: true,
        regionId
      }))
    ),
    elevation: booleanGrid(width, height, 0),
    spawnLayout,
    routePlan: routePlan(width, height),
    hydrology: { featureMask: booleanGrid(width, height) }
  };
}

test('minimum-distance selection is ranking-driven and input-order invariant', () => {
  const candidates = [
    { x: 0, y: 0, family: 'tree', parentFeatureId: 'r', rank: 10 },
    { x: 1, y: 0, family: 'tree', parentFeatureId: 'r', rank: 20 },
    { x: 4, y: 0, family: 'tree', parentFeatureId: 'r', rank: 5 }
  ];
  const forward = selectMinimumDistanceCandidates(candidates, {
    minimumDistance: 3
  });
  const reverse = selectMinimumDistanceCandidates([...candidates].reverse(), {
    minimumDistance: 3
  });
  assert.deepEqual(forward, reverse);
  assert.deepEqual(
    forward.selected.map(({ x, y }) => ({ x, y })),
    [{ x: 1, y: 0 }, { x: 4, y: 0 }]
  );
});

test('natural, constructed, and cave recipes populate deterministic schema-exact records', () => {
  const cases = [
    ['forest', 31, 19, 73019, false],
    ['castle', 33, 21, 99017, true],
    ['cave', 35, 23, 44191, false]
  ];
  for (const [nodeType, width, height, seed, expectsStructures] of cases) {
    const fixture = generatedFixture(nodeType, width, height, seed);
    const rowMajor = placeEcologyAndBlockers(fixture);
    const reverse = placeEcologyAndBlockers({ ...fixture, scanOrder: 'reverse' });
    assert.deepEqual(rowMajor, reverse, `${nodeType} scan order`);
    assert.ok(Object.isFrozen(rowMajor));
    assert.ok(rowMajor.obstacles.length > 0, `${nodeType} blockers`);
    assert.ok(rowMajor.decorations.length > 0, `${nodeType} decorations`);
    assert.equal(rowMajor.structures.length > 0, expectsStructures);
    assert.equal(rowMajor.diagnostics.budgets.blockingCoverageWithinBand, true);
    for (const obstacle of rowMajor.obstacles) {
      assert.deepEqual(Object.keys(obstacle), [
        'id', 'x', 'y', 'kind', 'assetKey', 'blocking', 'movementCost', 'featureId'
      ]);
      assert.equal(obstacle.blocking, true);
      assert.equal(obstacle.movementCost, 0);
    }
    for (const decoration of rowMajor.decorations) {
      assert.deepEqual(Object.keys(decoration), [
        'id', 'x', 'y', 'kind', 'assetKey', 'variantIndex', 'anchor', 'featureId'
      ]);
      assert.equal(Object.hasOwn(decoration, 'blocking'), false);
      assert.equal(Object.hasOwn(decoration, 'passable'), false);
    }
    for (const structure of rowMajor.structures) {
      assert.deepEqual(Object.keys(structure), [
        'id', 'kind', 'assetKey', 'footprint', 'entrances', 'parentRegionId'
      ]);
      const cell = structure.footprint[0];
      const obstacle = rowMajor.obstacles.find(
        entry => entry.x === cell.x && entry.y === cell.y
      );
      assert.equal(structure.assetKey, obstacle.assetKey);
    }
    const validation = validateBattleMapV2Candidate(
      candidateFrom(fixture, rowMajor)
    );
    assert.deepEqual(validation.errors, [], `${nodeType}: ${validation.errors.join('\n')}`);
  }
});

test('swamp corpus places sparse blockers in common wetland regions', () => {
  for (const terrainSeed of [0, 997]) {
    const fixture = generatedFixture('swamp', 32, 32, terrainSeed);
    const rowMajor = placeEcologyAndBlockers(fixture);
    const reverse = placeEcologyAndBlockers({
      ...fixture,
      scanOrder: 'reverse'
    });
    const kinds = new Set(rowMajor.obstacles.map(obstacle => obstacle.kind));

    assert.deepEqual(reverse, rowMajor, `swamp seed ${terrainSeed} determinism`);
    assert.ok(rowMajor.obstacles.length >= 2);
    assert.ok(rowMajor.obstacles.length <= 25);
    assert.ok(kinds.has('tree'));
    assert.ok(kinds.has('rock'));
    assert.equal(
      rowMajor.diagnostics.budgets.blockingCoverageWithinBand,
      true
    );
  }
});

test('every production recipe stays within its blocker coverage and spacing bands', () => {
  assert.deepEqual(
    Object.keys(ECOLOGY_RUNTIME_CATALOG.profiles).sort(),
    [...V2_PRODUCTION_NODE_TYPES].sort()
  );
  V2_PRODUCTION_NODE_TYPES.forEach((nodeType, index) => {
    const fixture = generatedFixture(nodeType, 27, 17, 81013 + index * 97);
    const result = placeEcologyAndBlockers(fixture);
    assert.equal(
      result.diagnostics.budgets.blockingCoverageWithinBand,
      true,
      `${nodeType} blocker coverage`
    );
    assert.ok(
      result.diagnostics.budgets.blockingPlaced <=
        result.diagnostics.budgets.blockingRequested,
      `${nodeType} blocker budget`
    );
    assert.ok(
      result.diagnostics.budgets.decorationPlaced <=
        result.diagnostics.budgets.decorationRequested,
      `${nodeType} decoration budget`
    );
    const observed = result.diagnostics.spacing.observedFixed;
    if (observed !== null) {
      assert.ok(
        observed >= result.diagnostics.spacing.requiredTiles * 1_000_000,
        `${nodeType} blocker spacing`
      );
    }
  });
});

test('blockers exclude reservations, protected zones, routes, water, connections, and bad substrate', () => {
  const fixture = syntheticFixture();
  const { width, height } = fixture;
  fixture.spawnLayout.coreMask[2][2] = true;
  fixture.spawnLayout.featherMask[2][3] = true;
  const reservationMask = booleanGrid(width, height);
  reservationMask[3][3] = true;
  for (let x = 0; x < width; x++) {
    fixture.routePlan.masks.centerlineMask[8][x] = true;
    fixture.routePlan.masks.pathMask[8][x] = true;
  }
  for (let y = 0; y < height; y++) fixture.hydrology.featureMask[y][14] = true;
  fixture.terrain[4][4] = { ...fixture.terrain[4][4], passable: false };
  const elevationConnections = [{
    from: { x: 6, y: 6 },
    to: { x: 7, y: 6 }
  }];
  const result = placeEcologyAndBlockers({
    ...fixture,
    reservationMask,
    elevationConnections,
    parameters: { blockingDensity: 450_000, minimumBlockerSpacing: 2 }
  });
  assert.ok(result.obstacles.length > 0);
  const excluded = new Set([
    '2,2', '3,2', '3,3', '4,4', '6,6', '7,6'
  ]);
  for (let x = 0; x < width; x++) excluded.add(`${x},8`);
  for (let y = 0; y < height; y++) excluded.add(`14,${y}`);
  for (const obstacle of result.obstacles) {
    assert.equal(excluded.has(`${obstacle.x},${obstacle.y}`), false);
  }
  for (let index = 0; index < result.obstacles.length; index++) {
    for (let other = index + 1; other < result.obstacles.length; other++) {
      const dx = result.obstacles[index].x - result.obstacles[other].x;
      const dy = result.obstacles[index].y - result.obstacles[other].y;
      assert.ok(dx * dx + dy * dy >= 4);
    }
  }
  assert.ok(result.diagnostics.exclusions.protected > 0);
  assert.ok(result.diagnostics.exclusions.reserved > 0);
  assert.ok(result.diagnostics.exclusions.route > 0);
  assert.ok(result.diagnostics.exclusions.water > 0);
  assert.ok(result.diagnostics.exclusions.connection > 0);
  assert.ok(result.diagnostics.exclusions.invalidSubstrate > 0);
});

test('suitability and parent-region clustering produce positive association evidence', () => {
  const fixture = syntheticFixture({ width: 35, height: 21 });
  for (let y = 0; y < fixture.height; y++) {
    for (let x = 0; x < 5; x++) {
      fixture.fields.disturbance[y][x] = 1_000_000;
      fixture.fields.height[y][x] = (x + y) % 2 === 0 ? -1_000_000 : 1_000_000;
    }
  }
  const result = placeEcologyAndBlockers({
    ...fixture,
    parameters: { blockingDensity: 100_000 }
  });
  const treeEvidence = result.diagnostics.associations.find(entry => entry.kind === 'tree');
  assert.ok(treeEvidence);
  assert.ok(treeEvidence.averageMoisture > 100_000);
  assert.equal(treeEvidence.parentFeatureCount, 1);
  assert.deepEqual(treeEvidence.parentRegionKinds, ['grove']);
  assert.ok(
    result.diagnostics.clusters.concentration >= 220_000,
    String(result.diagnostics.clusters.concentration)
  );
  assert.ok(result.diagnostics.clusters.voidFraction >= 250_000);
  assert.ok(result.diagnostics.exclusions.lowSuitability > 0);
});

test('traversal isolation rejects blockers on a protected-endpoint corridor', () => {
  const fixture = syntheticFixture({ width: 13, height: 11 });
  for (let y = 0; y < fixture.height; y++) {
    for (let x = 0; x < fixture.width; x++) {
      fixture.terrain[y][x] = {
        ...fixture.terrain[y][x],
        passable: y === 5 && x >= 1 && x <= 11
      };
    }
  }
  fixture.spawnLayout.coreMask[5][1] = true;
  fixture.spawnLayout.coreMask[5][11] = true;
  const result = placeEcologyAndBlockers({
    ...fixture,
    parameters: { blockingDensity: 1_000_000, minimumBlockerSpacing: 1 }
  });
  assert.equal(result.obstacles.length, 0);
  assert.ok(result.diagnostics.exclusions.traversalIsolation > 0);
});

test('elevation-aware isolation rejects cliff/one-way bypasses and backfills safely', () => {
  const fixture = syntheticFixture({ width: 5, height: 3 });
  for (let y = 0; y < fixture.height; y++) {
    for (let x = 0; x < fixture.width; x++) {
      const onMain = y === 1;
      const onBypass = y === 0 && x >= 1 && x <= 3;
      fixture.terrain[y][x] = {
        ...fixture.terrain[y][x],
        material: onBypass ? 'path' : 'grass',
        passable: onMain || onBypass
      };
      fixture.fields.moisture[y][x] = -1_000_000;
      fixture.fields.disturbance[y][x] = 0;
    }
  }
  fixture.fields.moisture[1][2] = 1_000_000;
  fixture.fields.disturbance[1][2] = -1_000_000;
  const parameters = {
    blockingDensity: 300_000,
    minimumBlockerSpacing: 1,
    decorationDensity: 0
  };
  const flat = placeEcologyAndBlockers({ ...fixture, parameters });
  assert.equal(flat.diagnostics.budgets.blockingRequested, 1);
  assert.deepEqual(
    flat.obstacles.map(({ x, y }) => ({ x, y })),
    [{ x: 2, y: 1 }]
  );

  const cliffElevation = structuredClone(fixture.elevation);
  cliffElevation[0][2] = 1;
  const cliff = placeEcologyAndBlockers({
    ...fixture,
    elevation: cliffElevation,
    parameters
  });
  assert.equal(cliff.diagnostics.budgets.blockingRequested, 1);
  assert.equal(cliff.obstacles.length, 1);
  assert.equal(cliff.obstacles.some(({ x, y }) => x === 2 && y === 1), false);
  assert.ok(cliff.diagnostics.exclusions.traversalIsolation > 0);
  assert.equal(cliff.diagnostics.budgets.blockingCoverageWithinBand, true);

  const rampConnections = [
    {
      id: 'connection:ramp-left',
      from: { x: 1, y: 0 },
      to: { x: 2, y: 0 },
      kind: 'ramp',
      direction: 'e',
      elevationDelta: 1,
      bidirectional: false,
      featureId: null
    },
    {
      id: 'connection:ramp-right',
      from: { x: 2, y: 0 },
      to: { x: 3, y: 0 },
      kind: 'ramp',
      direction: 'e',
      elevationDelta: -1,
      bidirectional: true,
      featureId: null
    }
  ];
  const oneWayBypass = placeEcologyAndBlockers({
    ...fixture,
    elevation: cliffElevation,
    elevationConnections: rampConnections,
    parameters
  });
  assert.equal(
    oneWayBypass.obstacles.some(({ x, y }) => x === 2 && y === 1),
    false
  );

  const downhillElevation = structuredClone(fixture.elevation);
  downhillElevation[1][1] = 0.75;
  downhillElevation[1][2] = 0.55;
  downhillElevation[1][3] = 0.3;
  const downhillSpawnLayout = structuredClone(fixture.spawnLayout);
  downhillSpawnLayout.coreMask[1][1] = true;
  downhillSpawnLayout.coreMask[1][3] = true;
  const downhillOnlyCandidate = placeEcologyAndBlockers({
    ...fixture,
    elevation: downhillElevation,
    spawnLayout: downhillSpawnLayout,
    parameters: {
      ...parameters,
      blockingDensity: 500_000
    }
  });
  assert.equal(downhillOnlyCandidate.diagnostics.budgets.blockingRequested, 1);
  assert.equal(downhillOnlyCandidate.obstacles.length, 1);
  assert.equal(
    downhillOnlyCandidate.obstacles.some(({ x, y }) => x === 2 && y === 1),
    false
  );
  assert.ok(downhillOnlyCandidate.diagnostics.exclusions.traversalIsolation > 0);
  assert.equal(
    downhillOnlyCandidate.diagnostics.budgets.blockingCoverageWithinBand,
    true
  );
});

test('decoration tuning is isolated from traversal-authoritative placement and inputs', () => {
  const fixture = syntheticFixture({ width: 29, height: 17 });
  const terrainSnapshot = structuredClone(fixture.terrain);
  const sparse = placeEcologyAndBlockers({
    ...fixture,
    parameters: { decorationDensity: 0 }
  });
  const lush = placeEcologyAndBlockers({
    ...fixture,
    parameters: { decorationDensity: 800_000 }
  });
  assert.deepEqual(sparse.obstacles, lush.obstacles);
  assert.deepEqual(sparse.structures, lush.structures);
  assert.deepEqual(sparse.blockingMask, lush.blockingMask);
  assert.deepEqual(sparse.diagnostics.associations, lush.diagnostics.associations);
  assert.deepEqual(sparse.diagnostics.spacing, lush.diagnostics.spacing);
  assert.equal(sparse.decorations.length, 0);
  assert.ok(lush.decorations.length > 0);
  assert.deepEqual(fixture.terrain, terrainSnapshot);
});

test('runtime catalog is closed and recipes cannot silently fall back', () => {
  assert.ok(Object.isFrozen(ECOLOGY_RUNTIME_CATALOG));
  const fixture = syntheticFixture();
  assert.throws(
    () => placeEcologyAndBlockers({
      ...fixture,
      recipe: { ...fixture.recipe, nodeType: 'unregistered-biome' }
    }),
    /No explicit V2 ecology profile/
  );
  assert.throws(
    () => placeEcologyAndBlockers({
      ...fixture,
      recipe: {
        ...fixture.recipe,
        decorationFamilies: [...fixture.recipe.decorationFamilies, 'moss']
      }
    }),
    /must exactly cover its declared families/
  );
});
