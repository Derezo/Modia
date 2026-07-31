import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalizeJson, deepCloneJsonValue } from '../canonicalJson.js';
import {
  assertTemplateMapBlueprint,
  computeTemplateMapBlueprintFullHash,
  validateTemplateMapBlueprint
} from './blueprint.js';
import {
  TEMPLATE_MAP_COMPILER_VERSION,
  compileTemplateMapBlueprint,
  computeTemplateMapAssetBundleManifestFullHash,
  computeTemplateMapSourceSidecarFullHash,
  computeTemplateMapTileCatalogFullHash
} from './compiler.js';
import {
  assignBattleMapV3Spawns,
  classifySpawnRoleV1
} from './spawnMatcher.js';
import {
  assertBattleMapV3Topology,
  createBattleMapV3TraversalView,
  findTraversalPath
} from './traversalView.js';

const hash = digit => `sha256:${digit.repeat(64)}`;
const point = (x, y) => ({ x, y });

function createBlueprint() {
  const width = 8;
  const height = 8;
  const playerSlots = Array.from({ length: 5 }, (_, index) => ({
    id: `player:${index + 1}`,
    cell: point(1, index + 1),
    role: 'formation',
    tags: ['player']
  }));
  const opponentCandidates = Array.from({ length: 7 }, (_, index) => ({
    id: `opponent:${index + 1}`,
    cell: point(6, index),
    tags: index === 0
      ? ['high-ground', 'ranged']
      : index === 1 ? ['frontline'] : ['reserve'],
    zoneId: 'zone:opponent',
    minimumClearance: 0,
    tacticalAnnotationIds: []
  }));
  return {
    schemaVersion: 1,
    candidateId: 'forest:template-01:variant-a',
    templateId: 'forest:template-01',
    dimensions: { width, height },
    renderMask: Array.from({ length: height }, () => Array(width).fill(true)),
    playableMask: Array.from({ length: height }, () => Array(width).fill(true)),
    surfaceGrid: Array.from({ length: height }, () =>
      Array.from({ length: width }, () => ({
        material: 'grass',
        featureId: 'region:field'
      }))
    ),
    elevation: Array.from({ length: height }, () => Array(width).fill(0)),
    regions: [{
      id: 'region:field',
      kind: 'clearing',
      cells: [point(0, 0)],
      annotations: ['main']
    }],
    features: [{
      id: 'feature:path',
      kind: 'route',
      cells: [point(2, 3), point(3, 3), point(4, 3), point(5, 3)],
      ownerFeatureId: 'region:field',
      annotations: ['primary']
    }, {
      id: 'feature:woods',
      kind: 'biome-boundary',
      cells: [point(0, 0), point(3, 1), point(4, 1)],
      ownerFeatureId: 'region:field',
      annotations: ['forest']
    }],
    routes: [{
      id: 'route:primary',
      kind: 'primary',
      material: 'grass',
      cells: [point(2, 3), point(3, 3), point(4, 3), point(5, 3)],
      required: true,
      width: 1,
      featureId: 'feature:path',
      assetFamily: 'dirt-center'
    }],
    connections: [],
    obstacles: [{
      id: 'obstacle:rock',
      kind: 'rock',
      cells: [point(3, 1)],
      featureId: 'feature:woods',
      anchor: point(3, 1),
      occlusionBounds: { minX: 3, minY: 1, maxX: 3, maxY: 1 },
      assetFamily: 'mossy-rock'
    }],
    decorations: [{
      id: 'decoration:fern',
      kind: 'fern',
      cell: point(4, 1),
      featureId: 'feature:woods',
      anchor: 'tile',
      assetFamily: 'fern'
    }],
    boundaries: [{
      id: 'boundary:canopy',
      kind: 'canopy',
      edges: [{ cell: point(0, 0), direction: 'n' }],
      featureId: 'feature:woods',
      sceneOnly: true,
      assetFamily: 'canopy'
    }],
    spawn: {
      capacities: {
        playerCapacity: 5,
        candidatePoolSize: 7,
        maxAssignableOpponents: 7
      },
      formationFacing: { player: 'e', opponent: 'w' },
      playerSlots,
      opponentCandidates,
      opponentZones: [{
        id: 'zone:opponent',
        cells: opponentCandidates.map(candidate => candidate.cell),
        tags: ['opponent'],
        capacity: 7
      }],
      protectedClearances: [],
      exits: [{
        id: 'exit:player',
        side: 'player',
        cell: point(2, 3),
        approachRegionId: 'approach:player'
      }, {
        id: 'exit:opponent',
        side: 'opponent',
        cell: point(5, 3),
        approachRegionId: 'approach:opponent'
      }],
      approachRegions: [{
        id: 'approach:player',
        side: 'player',
        cells: [point(2, 3)]
      }, {
        id: 'approach:opponent',
        side: 'opponent',
        cells: [point(5, 3)]
      }],
      minimumRouteConstraints: {
        minimumIndependentExits: 1,
        requireMutualReachability: true,
        maximumTraversableElevationDelta: 1
      },
      tacticalAnnotations: []
    },
    expectedAssetFamilies: [
      { category: 'surface', symbol: 'grass' },
      { category: 'route', symbol: 'dirt-center' },
      { category: 'obstacle', symbol: 'mossy-rock' },
      { category: 'decoration', symbol: 'fern' },
      { category: 'boundary', symbol: 'canopy' }
    ],
    generationNotes: ['Organic clearing interpretation; not a literal image trace.']
  };
}

async function createContext(blueprint = createBlueprint()) {
  const bindings = [
    ['surface', 'grass', 'surface:grass'],
    ['route', 'dirt-center', 'route:dirt-center'],
    ['obstacle', 'mossy-rock', 'obstacle:mossy-rock'],
    ['decoration', 'fern', 'decoration:fern'],
    ['boundary', 'canopy', 'boundary:canopy'],
    ['connection', 'stairs', 'connection:stairs']
  ];
  const assets = bindings.map(([category, symbol, key], index) => ({
    key,
    contentVersion: 1,
    contentHash: hash(String(index + 1)),
    immutableUrl: `/assets/battle-map-v3/forest-assets/${category}-${symbol}.webp`
  }));
  const context = {
    identity: {
      contentId: 'forest:map-01a',
      contentVersion: 1,
      templateRevision: 1,
      theme: 'forest',
      tierEligibility: ['tier-1', 'tier-2'],
      supportedModes: ['pve']
    },
    sourceSidecar: {
      schemaVersion: 'battle-map-source-template-v1',
      id: blueprint.templateId,
      theme: 'forest',
      status: 'approved',
      tierEligibility: ['tier-1', 'tier-2'],
      supportedModes: ['pve'],
      mapProfile: {
        width: blueprint.dimensions.width,
        height: blueprint.dimensions.height,
        orientation: 'isometric-diamond',
        cameraFraming: 'fixture',
        playerCapacity: { minimum: 1, maximum: 5 },
        candidatePoolSize: 7,
        maxAssignableOpponents: 7
      },
      topologyIntent: {
        coordinateAuthority: 'semantic-only',
        areas: [],
        relationships: []
      },
      heightIntent: {
        levelCount: { minimum: 1, maximum: 1 },
        maxGradualSlope: 1
      },
      routeIntent: {
        minimumApproachesPerFormation: 1
      },
      spawnIntent: {
        minimumApproaches: 1,
        localClearanceTiles: 0,
        candidateRoles: ['frontline', 'ranged']
      },
      candidateMaps: [blueprint.candidateId],
      pins: {
        approvedBlueprintSha256: await computeTemplateMapBlueprintFullHash(blueprint),
        compilerSha256: hash('e')
      },
      review: { decision: 'approved', reviewer: 'codex' }
    },
    renderProfile: {
      id: 'forest:v1',
      theme: 'forest',
      assetBundleId: 'forest-assets',
      elevationFaceSymbols: {
        grass: 'canopy'
      },
      assetBindings: bindings.map(([category, symbol, assetKey]) => ({
        category,
        symbol,
        assetKey
      }))
    },
    tileCatalog: {
      id: 'forest:tiles',
      version: 1,
      fullHash: hash('a'),
      renderProfileId: 'forest:v1',
      materials: [{
        symbol: 'grass',
        material: 'grass',
        passable: true,
        movementCost: 1
      }]
    },
    assetBundle: {
      id: 'forest-assets',
      version: 1,
      manifestFullHash: hash('b'),
      rendererManifestFullHash: hash('7'),
      assets
    },
    provenance: {
      sourceSidecar: { id: blueprint.templateId, version: 1, fullHash: hash('c') },
      approvedBlueprint: {
        id: 'forest:template-01:variant-a',
        version: 1,
        fullHash: await computeTemplateMapBlueprintFullHash(blueprint)
      },
      compiler: {
        id: 'template-map-compiler',
        version: TEMPLATE_MAP_COMPILER_VERSION,
        fullHash: hash('e')
      },
      validator: { id: 'battle-map-v3-validator', version: 1, fullHash: hash('f') }
    }
  };
  context.tileCatalog.fullHash =
    await computeTemplateMapTileCatalogFullHash(context.tileCatalog);
  context.assetBundle.manifestFullHash =
    await computeTemplateMapAssetBundleManifestFullHash(context.assetBundle);
  context.provenance.sourceSidecar.fullHash =
    await computeTemplateMapSourceSidecarFullHash(context.sourceSidecar);
  return context;
}

async function createV2Context(blueprint = createBlueprint()) {
  const context = await createContext(blueprint);
  const ecologyProfile = 'forest-iron-depths-borderwood';
  const tier = 1;
  const scene = {
    silhouette: 'organic-island',
    exterior: 'forest-canopy',
    backdrop: {
      kind: 'sky-gradient',
      topColor: '#6687A0',
      horizonColor: '#B5CDD2',
      bottomColor: '#E0D6C5',
      hazeColor: '#D2E0DF'
    }
  };
  const bindings = [];
  const assets = [];
  let hashIndex = 1;
  const addBinding = (category, symbol, match, assetKey) => {
    bindings.push({ category, symbol, match, assetKey });
    assets.push({
      key: assetKey,
      contentVersion: 1,
      contentHash: hash(((hashIndex++) % 16).toString(16)),
      immutableUrl: `/assets/battle-map-v3/forest-assets/${assetKey}.webp`
    });
  };
  const common = { ecologyProfile, tier };
  for (let surfaceVariant = 0; surfaceVariant < 4; surfaceVariant += 1) {
    addBinding(
      'surface',
      'grass',
      { ...common, surfaceVariant },
      `surface:grass:${surfaceVariant}`
    );
  }
  for (const routeTopology of [
    'isolated',
    'end-n', 'end-e', 'end-s', 'end-w',
    'straight-ns', 'straight-ew',
    'corner-ne', 'corner-es', 'corner-sw', 'corner-wn',
    'tee-nes', 'tee-esw', 'tee-nsw', 'tee-wne',
    'cross'
  ]) {
    addBinding(
      'route',
      'dirt-center',
      { ...common, routeTopology },
      `route:dirt-center:${routeTopology}`
    );
  }
  for (const direction of ['n', 'e', 's', 'w']) {
    for (const symbol of ['stairs', 'ramp']) {
      addBinding(
        'connection',
        symbol,
        { ...common, direction, heightDelta: 1 },
        `connection:${symbol}:${direction}`
      );
    }
    addBinding(
      'boundary',
      'canopy',
      { ...common, direction, heightDelta: 1 },
      `boundary:canopy:${direction}`
    );
  }
  addBinding('obstacle', 'mossy-rock', common, 'obstacle:mossy-rock');
  addBinding('decoration', 'fern', common, 'decoration:fern');

  context.identity.tierEligibility = ['tier-1'];
  context.sourceSidecar.tierEligibility = ['tier-1'];
  context.renderProfile = {
    schemaVersion: 'battle-map-render-profile-v2',
    id: 'forest:borderwood:v2',
    theme: 'forest',
    ecologyProfile,
    assetBundleId: 'forest-assets',
    scene,
    surfaceVariantCount: 4,
    elevationFaceSymbols: {
      grass: 'canopy'
    },
    assetBindings: bindings
  };
  context.tileCatalog.renderProfileId = context.renderProfile.id;
  context.assetBundle.assets = assets;
  context.tileCatalog.fullHash =
    await computeTemplateMapTileCatalogFullHash(context.tileCatalog);
  context.assetBundle.manifestFullHash =
    await computeTemplateMapAssetBundleManifestFullHash(context.assetBundle);
  context.provenance.sourceSidecar.fullHash =
    await computeTemplateMapSourceSidecarFullHash(context.sourceSidecar);
  return context;
}

test('TemplateMapBlueprint is closed, symbolic, and bounded', () => {
  const blueprint = createBlueprint();
  assert.equal(validateTemplateMapBlueprint(blueprint).valid, true);
  assert.equal(assertTemplateMapBlueprint(blueprint), blueprint);

  const injectedMovementCost = deepCloneJsonValue(blueprint);
  injectedMovementCost.surfaceGrid[0][0].movementCost = 999;
  const movementResult = validateTemplateMapBlueprint(injectedMovementCost);
  assert.equal(movementResult.valid, false);
  assert.match(movementResult.errors.join('\n'), /movementCost.*additional property/);

  const injectedRuntimePath = deepCloneJsonValue(blueprint);
  injectedRuntimePath.obstacles[0].immutableUrl = '/model-selected.webp';
  assert.match(
    validateTemplateMapBlueprint(injectedRuntimePath).errors.join('\n'),
    /immutableUrl.*additional property/
  );

  const uppercaseId = deepCloneJsonValue(blueprint);
  uppercaseId.candidateId = 'Forest:Candidate';
  assert.equal(validateTemplateMapBlueprint(uppercaseId).valid, false);

  const malformedCollections = deepCloneJsonValue(blueprint);
  malformedCollections.features = {};
  malformedCollections.surfaceGrid = {};
  assert.doesNotThrow(() => validateTemplateMapBlueprint(malformedCollections));
  assert.equal(validateTemplateMapBlueprint(malformedCollections).valid, false);

  for (const mutate of [
    value => { value.features = [null]; },
    value => { value.routes = [null]; },
    value => { value.obstacles = [null]; },
    value => { value.routes[0].cells = [null]; }
  ]) {
    const malformedEntry = deepCloneJsonValue(blueprint);
    mutate(malformedEntry);
    assert.doesNotThrow(() => validateTemplateMapBlueprint(malformedEntry));
    assert.equal(validateTemplateMapBlueprint(malformedEntry).valid, false);
  }
});

test('TemplateMapBlueprint rejects non-playable objects and non-cardinal required routes', () => {
  const blueprint = createBlueprint();
  assert.deepEqual(validateTemplateMapBlueprint(blueprint), {
    valid: true,
    errors: []
  });

  const invalid = deepCloneJsonValue(blueprint);
  invalid.routes[0].cells = [point(2, 3), point(4, 3)];
  invalid.playableMask[3][4] = false;
  invalid.playableMask[1][3] = false;

  const expectedErrors = [
    'TemplateMapBlueprint.routes[0].cells[1]: required route centerline step must be cardinal (Manhattan distance must equal 1)',
    'TemplateMapBlueprint.routes[0].cells[1]: required route cell must be playable',
    'TemplateMapBlueprint.obstacles[0].cells[0]: obstacle cell must be playable'
  ];
  assert.deepEqual(validateTemplateMapBlueprint(invalid), {
    valid: false,
    errors: expectedErrors
  });
  assert.throws(
    () => assertTemplateMapBlueprint(invalid),
    error => {
      assert.equal(error.code, 'INVALID_TEMPLATE_MAP_BLUEPRINT');
      assert.deepEqual(error.validationErrors, expectedErrors);
      return true;
    }
  );

  const optionalRoute = deepCloneJsonValue(invalid);
  optionalRoute.routes[0].required = false;
  optionalRoute.playableMask[1][3] = true;
  assert.equal(validateTemplateMapBlueprint(optionalRoute).valid, true);
});

test('TemplateMapBlueprint rejects obstacle cells on required routes', () => {
  const blueprint = createBlueprint();
  blueprint.obstacles[0].cells = [point(3, 3)];

  assert.deepEqual(validateTemplateMapBlueprint(blueprint), {
    valid: false,
    errors: [
      'TemplateMapBlueprint.routes[0].cells[1]: required route cell must not overlap an obstacle cell'
    ]
  });
});

test('compiler deterministically derives a byte-identical valid V3 candidate', async () => {
  const blueprint = createBlueprint();
  const context = await createContext(blueprint);
  const originalBlueprint = canonicalizeJson(blueprint);
  const originalContext = canonicalizeJson(context);
  const first = await compileTemplateMapBlueprint(blueprint, context);
  const second = await compileTemplateMapBlueprint(blueprint, context);

  assert.equal(canonicalizeJson(first), canonicalizeJson(second));
  assert.equal(canonicalizeJson(blueprint), originalBlueprint);
  assert.equal(canonicalizeJson(context), originalContext);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(first.terrain[0][0].movementCost, 1);
  assert.equal(first.visualCells[0][0].surface.key, 'surface:grass');
  assert.equal(first.obstacles[0].blocking, true);
  assert.equal(first.obstacles[0].asset.contentHash, hash('3'));
  assert.equal(first.routes[0].visualAssets[0].asset.key, 'route:dirt-center');
  assert.equal(assertBattleMapV3Topology(first), first);
});

test('compiler reserves traversable slopes and stairs for connection visuals', async () => {
  const blueprint = createBlueprint();
  for (let y = 0; y < blueprint.dimensions.height; y += 1) {
    for (let x = 0; x <= 3; x += 1) blueprint.elevation[y][x] = 1;
    blueprint.connections.push({
      id: `connection:terrace:${y}`,
      from: point(3, y),
      to: point(4, y),
      kind: y === 3 ? 'stairs' : 'slope',
      traversable: true,
      bidirectional: true,
      featureId: 'feature:path',
      assetFamily: 'stairs'
    });
  }
  blueprint.expectedAssetFamilies.push({
    category: 'connection',
    symbol: 'stairs'
  });
  const context = await createContext(blueprint);
  context.sourceSidecar.heightIntent.levelCount.maximum = 2;
  context.provenance.sourceSidecar.fullHash =
    await computeTemplateMapSourceSidecarFullHash(context.sourceSidecar);

  const map = await compileTemplateMapBlueprint(blueprint, context);
  const slopes = map.elevationConnections.filter(record => record.kind === 'slope');
  const stairs = map.elevationConnections.filter(record => record.kind === 'stairs');
  assert.equal(slopes.length, 7);
  assert.ok(slopes.every(record => record.asset === null));
  assert.equal(stairs.length, 1);
  assert.equal(stairs[0].asset.key, 'connection:stairs');

  const faces = map.boundaries.filter(record => record.kind === 'elevation-face');
  assert.equal(
    faces.length,
    0,
    'traversable slopes and stairs replace exposed-face segments'
  );

  const traversal = createBattleMapV3TraversalView(map, {
    movementPolicy: { ignoreUnits: true }
  });
  assert.equal(traversal.elevationConnections[0][3].e.type, 'ramp');
  assert.equal(traversal.elevationConnections[3][3].e.type, 'stairs');
});

test('compiler v2 resolves deterministic surfaces, route topology, and low-to-high directional crossings', async () => {
  const blueprint = createBlueprint();
  blueprint.elevation[2][3] = 1;
  blueprint.elevation[6][2] = 1;
  blueprint.connections.push({
    id: 'connection:ramp:north',
    from: point(3, 3),
    to: point(3, 2),
    kind: 'slope',
    traversable: true,
    bidirectional: true,
    featureId: 'feature:path',
    assetFamily: 'ramp'
  }, {
    id: 'connection:stairs:east',
    from: point(2, 6),
    to: point(1, 6),
    kind: 'stairs',
    traversable: true,
    bidirectional: true,
    featureId: 'feature:path',
    assetFamily: 'stairs'
  });
  blueprint.expectedAssetFamilies.push(
    { category: 'connection', symbol: 'ramp' },
    { category: 'connection', symbol: 'stairs' }
  );
  const context = await createV2Context(blueprint);
  context.sourceSidecar.heightIntent.levelCount.maximum = 2;
  context.provenance.sourceSidecar.fullHash =
    await computeTemplateMapSourceSidecarFullHash(context.sourceSidecar);

  const map = await compileTemplateMapBlueprint(blueprint, context);
  assert.equal(map.ecologyProfile, 'forest-iron-depths-borderwood');
  assert.deepEqual(map.scene, context.renderProfile.scene);
  assert.match(map.visualCells[0][0].surface.key, /^surface:grass:[0-3]$/);
  assert.ok(
    new Set(map.visualCells.flat().map(record => record.surface.key)).size > 1,
    'surface variants should break up uniform open ground deterministically'
  );
  assert.deepEqual(
    map.routes[0].visualAssets.map(record => record.role).sort(),
    ['end-e', 'end-w', 'straight-ew']
  );

  const ramp = map.elevationConnections.find(record =>
    record.id === 'connection:ramp:north'
  );
  assert.equal(ramp.direction, 'n');
  assert.equal(ramp.heightDelta, 1);
  assert.equal(ramp.asset.key, 'connection:ramp:n');

  const stairs = map.elevationConnections.find(record =>
    record.id === 'connection:stairs:east'
  );
  assert.equal(stairs.direction, 'w');
  assert.equal(stairs.heightDelta, -1);
  assert.equal(
    stairs.asset.key,
    'connection:stairs:e',
    'the authored asset follows the low-to-high direction even when the record is reversed'
  );
  assert.equal(
    map.boundaries.find(record => record.id === 'boundary:canopy').asset.key,
    'boundary:canopy:n'
  );
  assert.ok(
    map.boundaries
      .filter(record => record.kind === 'elevation-face')
      .every(record => record.edges.length === 1)
  );
  assert.equal(assertBattleMapV3Topology(map), map);

  const missingDirection = await createV2Context(blueprint);
  missingDirection.sourceSidecar.heightIntent.levelCount.maximum = 2;
  missingDirection.renderProfile.assetBindings =
    missingDirection.renderProfile.assetBindings.filter(record =>
      record.assetKey !== 'connection:ramp:n'
    );
  missingDirection.provenance.sourceSidecar.fullHash =
    await computeTemplateMapSourceSidecarFullHash(missingDirection.sourceSidecar);
  await assert.rejects(
    () => compileTemplateMapBlueprint(blueprint, missingDirection),
    error => error.code === 'MISSING_BATTLE_MAP_V3_ASSET'
      && /direction.*n/.test(error.message)
  );
});

test('compiler v2 derives route topology independently for touching route records', async () => {
  const blueprint = createBlueprint();
  blueprint.routes.push({
    id: 'route:touching',
    kind: 'secondary',
    material: 'grass',
    cells: [point(3, 4)],
    required: false,
    width: 1,
    featureId: 'feature:path',
    assetFamily: 'dirt-center'
  });
  const context = await createV2Context(blueprint);

  const map = await compileTemplateMapBlueprint(blueprint, context);
  assert.deepEqual(
    map.routes[0].visualAssets.map(record => record.role).sort(),
    ['end-e', 'end-w', 'straight-ew']
  );
  assert.deepEqual(
    map.routes[1].visualAssets.map(record => record.role),
    ['isolated']
  );
});

test('compiler stacks multi-level faces and resolves them by surface material', async () => {
  const blueprint = createBlueprint();
  blueprint.playableMask[7][0] = false;
  blueprint.elevation[7][0] = 3;
  blueprint.surfaceGrid[7][0].material = 'stone';
  blueprint.playableMask[7][4] = false;
  blueprint.elevation[7][4] = 1;
  blueprint.expectedAssetFamilies.push(
    { category: 'surface', symbol: 'stone' },
    { category: 'boundary', symbol: 'stone-face' }
  );

  const context = await createContext(blueprint);
  context.sourceSidecar.heightIntent.levelCount.maximum = 4;
  context.renderProfile.elevationFaceSymbols = {
    grass: 'canopy',
    stone: 'stone-face'
  };
  context.renderProfile.assetBindings.push(
    {
      category: 'surface',
      symbol: 'stone',
      assetKey: 'surface:stone'
    },
    {
      category: 'boundary',
      symbol: 'stone-face',
      assetKey: 'boundary:stone-face'
    }
  );
  context.tileCatalog.materials.push({
    symbol: 'stone',
    material: 'stone',
    passable: true,
    movementCost: 1
  });
  context.assetBundle.assets.push(
    {
      key: 'surface:stone',
      contentVersion: 1,
      contentHash: hash('8'),
      immutableUrl: '/assets/battle-map-v3/forest-assets/surface-stone.webp'
    },
    {
      key: 'boundary:stone-face',
      contentVersion: 1,
      contentHash: hash('9'),
      immutableUrl: '/assets/battle-map-v3/forest-assets/boundary-stone-face.webp'
    }
  );
  context.tileCatalog.fullHash =
    await computeTemplateMapTileCatalogFullHash(context.tileCatalog);
  context.assetBundle.manifestFullHash =
    await computeTemplateMapAssetBundleManifestFullHash(context.assetBundle);
  context.provenance.sourceSidecar.fullHash =
    await computeTemplateMapSourceSidecarFullHash(context.sourceSidecar);

  const map = await compileTemplateMapBlueprint(blueprint, context);
  const stoneFaces = map.boundaries.filter(record =>
    record.id.startsWith('boundary:elevation-face:0:7')
  );
  assert.equal(stoneFaces.length, 3);
  assert.deepEqual(
    stoneFaces.map(record => record.levelOffset ?? 1),
    [1, 2, 3]
  );
  assert.ok(stoneFaces.every(record => (
    record.asset.key === 'boundary:stone-face'
    && record.edges.length === 1
    && record.edges[0].direction === 'e'
  )));

  const grassFace = map.boundaries.find(
    record => record.id === 'boundary:elevation-face:4:7'
  );
  assert.equal(grassFace.levelOffset, undefined);
  assert.equal(grassFace.asset.key, 'boundary:canopy');
  assert.equal(assertBattleMapV3Topology(map), map);
});

test('compiler fails closed for missing, ambiguous, unreferenced, and tampered inputs', async () => {
  const blueprint = createBlueprint();
  const missing = await createContext(blueprint);
  missing.renderProfile.assetBindings = missing.renderProfile.assetBindings
    .filter(binding => binding.category !== 'boundary');
  await assert.rejects(
    () => compileTemplateMapBlueprint(blueprint, missing),
    error => error.code === 'MISSING_BATTLE_MAP_V3_ASSET'
  );

  const ambiguous = await createContext(blueprint);
  ambiguous.renderProfile.assetBindings.push({
    ...ambiguous.renderProfile.assetBindings[0]
  });
  await assert.rejects(
    () => compileTemplateMapBlueprint(blueprint, ambiguous),
    /ambiguous render-profile asset binding/
  );

  const unreferenced = createBlueprint();
  unreferenced.expectedAssetFamilies.push({
    category: 'connection',
    symbol: 'unused-stairs'
  });
  await assert.rejects(
    () => createContext(unreferenced).then(context =>
      compileTemplateMapBlueprint(unreferenced, context)
    ),
    error => error.code === 'INVALID_BATTLE_MAP_V3_ASSET_CLOSURE'
      && /unreferenced expected families/.test(error.message)
  );

  const tamperedAsset = await createContext(blueprint);
  tamperedAsset.assetBundle.assets[0].contentHash = hash('9');
  await assert.rejects(
    () => compileTemplateMapBlueprint(blueprint, tamperedAsset),
    error => error.code === 'TEMPLATE_MAP_ASSET_BUNDLE_HASH_MISMATCH'
  );
  const tamperedRendererGeometry = await createContext(blueprint);
  tamperedRendererGeometry.assetBundle.rendererManifestFullHash = hash('8');
  await assert.rejects(
    () => compileTemplateMapBlueprint(blueprint, tamperedRendererGeometry),
    error => error.code === 'TEMPLATE_MAP_ASSET_BUNDLE_HASH_MISMATCH'
  );
  const tamperedCatalog = await createContext(blueprint);
  tamperedCatalog.tileCatalog.materials[0].movementCost = 9;
  await assert.rejects(
    () => compileTemplateMapBlueprint(blueprint, tamperedCatalog),
    error => error.code === 'TEMPLATE_MAP_TILE_CATALOG_HASH_MISMATCH'
  );
  const tamperedSidecar = await createContext(blueprint);
  tamperedSidecar.sourceSidecar.mapProfile.cameraFraming = 'changed after approval';
  await assert.rejects(
    () => compileTemplateMapBlueprint(blueprint, tamperedSidecar),
    error => error.code === 'TEMPLATE_MAP_SOURCE_SIDECAR_HASH_MISMATCH'
  );

  const incompatibleSidecar = await createContext(blueprint);
  incompatibleSidecar.sourceSidecar.mapProfile.maxAssignableOpponents = 6;
  incompatibleSidecar.provenance.sourceSidecar.fullHash =
    await computeTemplateMapSourceSidecarFullHash(incompatibleSidecar.sourceSidecar);
  await assert.rejects(
    () => compileTemplateMapBlueprint(blueprint, incompatibleSidecar),
    /spawn capacities must exactly satisfy/
  );
  const incompatibleIntent = await createContext(blueprint);
  incompatibleIntent.sourceSidecar.heightIntent.levelCount.minimum = 2;
  incompatibleIntent.sourceSidecar.heightIntent.levelCount.maximum = 3;
  incompatibleIntent.provenance.sourceSidecar.fullHash =
    await computeTemplateMapSourceSidecarFullHash(incompatibleIntent.sourceSidecar);
  await assert.rejects(
    () => compileTemplateMapBlueprint(blueprint, incompatibleIntent),
    /elevation level count violates/
  );

  const alteredBlueprint = deepCloneJsonValue(blueprint);
  alteredBlueprint.generationNotes[0] = 'Changed after approval.';
  const approvedContext = await createContext(blueprint);
  await assert.rejects(
    () => compileTemplateMapBlueprint(alteredBlueprint, approvedContext),
    error => error.code === 'TEMPLATE_MAP_BLUEPRINT_HASH_MISMATCH'
  );
});

test('compiler treats undeclared elevation edges as blocked faces and rejects unreachable required exits', async () => {
  const terrace = createBlueprint();
  terrace.elevation[2][2] = 1;
  const terraceContext = await createContext(terrace);
  terraceContext.sourceSidecar.heightIntent.levelCount.maximum = 2;
  terraceContext.provenance.sourceSidecar.fullHash =
    await computeTemplateMapSourceSidecarFullHash(terraceContext.sourceSidecar);
  const terraceMap = await compileTemplateMapBlueprint(terrace, terraceContext);
  assert.ok(
    terraceMap.boundaries.some(record =>
      record.id.startsWith('boundary:elevation-face:2:2')
    )
  );
  assert.equal(
    terraceMap.elevationConnections.some(record =>
      record.from.x === 2 && record.from.y === 2
    ),
    false,
    'a terrace face is not silently converted into a traversable ramp'
  );

  const disconnected = createBlueprint();
  for (let y = 0; y < disconnected.dimensions.height; y += 1) {
    disconnected.playableMask[y][4] = false;
  }
  disconnected.routes[0].cells = [point(2, 3), point(3, 3)];
  await assert.rejects(
    () => createContext(disconnected).then(context =>
      compileTemplateMapBlueprint(disconnected, context)
    ),
    error => error.code === 'INVALID_BATTLE_MAP_V3_TOPOLOGY'
      && /required exits.*not mutually reachable/.test(error.message)
  );

  const insufficientZone = createBlueprint();
  insufficientZone.spawn.opponentZones[0].capacity = 3;
  await assert.rejects(
    () => createContext(insufficientZone).then(context =>
      compileTemplateMapBlueprint(insufficientZone, context)
    ),
    error => error.code === 'INVALID_BATTLE_MAP_V3_TOPOLOGY'
      && /usable opponent capacity 3.*maxAssignableOpponents 7/.test(error.message)
  );
});

test('V3 TraversalView consumes playableMask and compiler-authored blockers', async () => {
  const blueprint = createBlueprint();
  const candidate = await compileTemplateMapBlueprint(
    blueprint,
    await createContext(blueprint)
  );
  const masked = deepCloneJsonValue(candidate);
  masked.playableMask[4][4] = false;
  const view = createBattleMapV3TraversalView(masked, {
    movementPolicy: { ignoreUnits: true }
  });
  const path = findTraversalPath(view, {
    start: point(4, 3),
    goal: point(4, 5)
  });
  assert.ok(path);
  assert.equal(path.some(cell => cell.x === 4 && cell.y === 4), false);

  const obstaclePath = findTraversalPath(view, {
    start: point(2, 1),
    goal: point(4, 1)
  });
  assert.ok(obstaclePath);
  assert.equal(obstaclePath.some(cell => cell.x === 3 && cell.y === 1), false);
});

test('role classifier and spawn matcher are stable and ignore preliminary coordinates', async () => {
  assert.equal(classifySpawnRoleV1({ id: 'boss', isBoss: true }).primaryRole, 'boss');
  assert.equal(classifySpawnRoleV1({ id: 'healer', aiType: 'support' }).primaryRole, 'support');
  assert.equal(classifySpawnRoleV1({ id: 'archer', attackRange: 4 }).primaryRole, 'ranged');
  assert.equal(classifySpawnRoleV1({ id: 'scout', movement: 7 }).primaryRole, 'mobile');
  assert.equal(classifySpawnRoleV1({ id: 'guard', aiType: 'defensive' }).primaryRole, 'defender');

  const blueprint = createBlueprint();
  const map = await compileTemplateMapBlueprint(blueprint, await createContext(blueprint));
  const input = {
    map,
    playerUnits: [{ id: 'p1', x: 99, y: 99 }, { id: 'p2', x: -20, y: -20 }],
    opponentUnits: [
      { id: 'archer', attackRange: 4, x: 0, y: 0 },
      { id: 'brute', aiType: 'aggressive', x: 0, y: 0 }
    ],
    encounterSeed: 'encounter-42'
  };
  const first = assignBattleMapV3Spawns(input);
  const second = assignBattleMapV3Spawns(input);
  assert.deepEqual(first, second);
  assert.deepEqual(first.playerAssignments.map(item => item.cell), [point(1, 1), point(1, 2)]);
  assert.equal(
    new Set(first.opponentAssignments.map(item => `${item.cell.x},${item.cell.y}`)).size,
    2
  );
  const archer = first.opponentAssignments.find(item => item.unitId === 'archer');
  assert.equal(archer.role, 'ranged');
  assert.equal(archer.candidateId, 'opponent:1');
  assert.deepEqual(input.opponentUnits.map(unit => [unit.x, unit.y]), [[0, 0], [0, 0]]);

  const constrained = deepCloneJsonValue(map);
  for (const index of [2, 3]) {
    constrained.spawnContract.opponentCandidates[index].tags = ['frontline'];
    constrained.spawnContract.opponentCandidates[index].minimumClearance = 1;
  }
  const constrainedResult = assignBattleMapV3Spawns({
    map: constrained,
    playerUnits: [{ id: 'p1' }],
    opponentUnits: [
      { id: 'frontline-a', aiType: 'aggressive' },
      { id: 'frontline-b', aiType: 'aggressive' }
    ],
    encounterSeed: 'constraint-retry'
  });
  assert.equal(constrainedResult.opponentAssignments.length, 2);
  assert.ok(
    Math.abs(
      constrainedResult.opponentAssignments[0].cell.y
      - constrainedResult.opponentAssignments[1].cell.y
    ) > 1
  );
});

test('spawn matcher enforces distinct capacities and rejects ambiguity', async () => {
  const blueprint = createBlueprint();
  const map = await compileTemplateMapBlueprint(blueprint, await createContext(blueprint));
  assert.throws(
    () => assignBattleMapV3Spawns({
      map,
      playerUnits: Array.from({ length: 6 }, (_, index) => ({ id: `p${index}` })),
      opponentUnits: [{ id: 'enemy' }],
      encounterSeed: 1
    }),
    error => error.code === 'BATTLE_MAP_V3_SPAWN_CAPACITY_SHORTFALL'
      && /playerCapacity/.test(error.message)
  );
  assert.throws(
    () => assignBattleMapV3Spawns({
      map,
      playerUnits: [{ id: 'p1' }],
      opponentUnits: Array.from({ length: 8 }, (_, index) => ({ id: `e${index}` })),
      encounterSeed: 1
    }),
    error => error.code === 'BATTLE_MAP_V3_SPAWN_CAPACITY_SHORTFALL'
      && /maxAssignableOpponents/.test(error.message)
  );
  assert.throws(
    () => assignBattleMapV3Spawns({
      map,
      playerUnits: [{ id: 'duplicate' }, { id: 'duplicate' }],
      opponentUnits: [{ id: 'enemy' }],
      encounterSeed: 1
    }),
    error => error.code === 'AMBIGUOUS_BATTLE_MAP_V3_SPAWN_INPUT'
  );

  const zoneBypass = deepCloneJsonValue(map);
  zoneBypass.spawnContract.opponentCandidates[0].zoneId = null;
  assert.throws(
    () => assignBattleMapV3Spawns({
      map: zoneBypass,
      playerUnits: [{ id: 'p1' }],
      opponentUnits: [{ id: 'enemy' }],
      encounterSeed: 1
    }),
    error => error.code === 'AMBIGUOUS_BATTLE_MAP_V3_SPAWN_INPUT'
      && /zoneId does not exactly match/.test(error.message)
  );

  const protectedMap = deepCloneJsonValue(map);
  protectedMap.spawnContract.protectedClearances.push({
    id: 'clearance:player',
    side: 'player',
    anchorId: 'player:1',
    radius: 16
  });
  assert.throws(
    () => assignBattleMapV3Spawns({
      map: protectedMap,
      playerUnits: [{ id: 'p1' }],
      opponentUnits: [{ id: 'enemy' }],
      encounterSeed: 1
    }),
    error => error.code === 'BATTLE_MAP_V3_SPAWN_CAPACITY_SHORTFALL'
  );

  const unusedSlotClearance = deepCloneJsonValue(map);
  unusedSlotClearance.spawnContract.protectedClearances.push({
    id: 'clearance:unused-player-slot',
    side: 'player',
    anchorId: 'player:5',
    radius: 16
  });
  assert.doesNotThrow(() => assignBattleMapV3Spawns({
    map: unusedSlotClearance,
    playerUnits: [{ id: 'p1' }],
    opponentUnits: [{ id: 'enemy' }],
    encounterSeed: 1
  }));

  const annotationMismatch = deepCloneJsonValue(map);
  annotationMismatch.spawnContract.tacticalAnnotations.push({
    id: 'annotation:remote-high-ground',
    kind: 'high-ground',
    cells: [point(0, 0)],
    tags: ['ranged']
  });
  annotationMismatch.spawnContract.opponentCandidates[0].tacticalAnnotationIds = [
    'annotation:remote-high-ground'
  ];
  assert.throws(
    () => assignBattleMapV3Spawns({
      map: annotationMismatch,
      playerUnits: [{ id: 'p1' }],
      opponentUnits: [{ id: 'enemy' }],
      encounterSeed: 1
    }),
    error => error.code === 'AMBIGUOUS_BATTLE_MAP_V3_SPAWN_INPUT'
      && /outside its cells/.test(error.message)
  );

  const generatedCollision = deepCloneJsonValue(map);
  generatedCollision.spawnContract.opponentCandidates.pop();
  generatedCollision.spawnContract.opponentCandidates[0].id =
    'zone:zone:opponent:6:6';
  assert.throws(
    () => assignBattleMapV3Spawns({
      map: generatedCollision,
      playerUnits: [{ id: 'p1' }],
      opponentUnits: [{ id: 'enemy' }],
      encounterSeed: 1
    }),
    error => error.code === 'AMBIGUOUS_BATTLE_MAP_V3_SPAWN_INPUT'
      && /collides with an explicit candidate/.test(error.message)
  );

  const roleLocked = deepCloneJsonValue(map);
  roleLocked.spawnContract.opponentCandidates.forEach(candidate => {
    candidate.tags = ['only:ranged'];
  });
  roleLocked.spawnContract.opponentZones[0].tags = ['only:ranged'];
  assert.throws(
    () => assignBattleMapV3Spawns({
      map: roleLocked,
      playerUnits: [{ id: 'p1' }],
      opponentUnits: [{ id: 'frontliner' }],
      encounterSeed: 1
    }),
    error => error.code === 'BATTLE_MAP_V3_SPAWN_CAPACITY_SHORTFALL'
      && /role-compatible/.test(error.message)
  );
});
