import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BATTLE_MAP_V3_CATALOG_HASH_DOMAIN,
  BATTLE_MAP_V3_CATALOG_PROJECTION_SCHEMA,
  assertBattleMapV3Candidate,
  assertBattleMapV3CatalogRelease,
  assertBattleMapV3CatalogMapPins,
  assertVerifiedBattleMapV3CatalogRelease,
  assertVerifiedBattleMapV3Final,
  computeBattleMapV3CatalogHash,
  computeBattleMapV3Hashes,
  createBattleMapV3CatalogHashProjection,
  createMinimalBattleMapV3FinalFixture,
  finalizeBattleMapV3,
  finalizeBattleMapV3CatalogRelease,
  validateBattleMapV3Candidate,
  validateBattleMapV3CatalogRelease,
  validateBattleMapV3CatalogReleaseCandidate,
  verifyBattleMapV3CatalogRelease,
  verifyBattleMapV3Final
} from './index.js';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const HASH_C = `sha256:${'c'.repeat(64)}`;
const ASSET_BUNDLE_ID = 'forest-assets';
const EXPECTED_MAP_HASHES = Object.freeze({
  authoritativeHash: 'sha256:7d5f52f8fcce0ebbf9b4c9808e80d703219c48b7d65ab9fc6abea0fe5e23a238',
  visualHash: 'sha256:b9e70cad6f489acd9df34e0cadc9b85b684fca0b4db6ad581884bac0c2941a62',
  fullHash: 'sha256:27268fc68e4f1fc66d3fa3a06ed4a39355cf76a03d39486e0fb72180a4affba3'
});
const EXPECTED_CATALOG_HASH = 'sha256:98a5cfe0f98ba176a2f3102098d5f2cd0292e18959ee44194b11e617e53842e6';

function clone(value) {
  return structuredClone(value);
}

function asset(key) {
  return {
    assetBundleId: ASSET_BUNDLE_ID,
    key,
    contentVersion: 1,
    contentHash: HASH_A,
    immutableUrl: `https://assets.example.test/${ASSET_BUNDLE_ID}/v1/${key}.webp`
  };
}

function coord(x, y) {
  return { x, y };
}

function createCandidate() {
  const width = 32;
  const height = 32;
  const renderMask = Array.from({ length: height }, () => Array(width).fill(true));
  const playableMask = Array.from({ length: height }, () => Array(width).fill(true));
  const terrain = Array.from({ length: height }, () => Array.from({ length: width }, () => ({
    material: 'grass',
    passable: true,
    movementCost: 1,
    featureId: 'feature:field'
  })));
  const elevation = Array.from({ length: height }, () => Array(width).fill(0));
  const visualCells = Array.from({ length: height }, () => Array.from({ length: width }, () => ({
    surface: asset('surface:grass'),
    overlays: []
  })));
  const playerSlots = Array.from({ length: 5 }, (_, index) => ({
    id: `player:${index + 1}`,
    cell: coord(2, 10 + index),
    role: index === 0 ? 'frontline' : 'formation',
    tags: ['player']
  }));
  const opponentCandidates = Array.from({ length: 7 }, (_, index) => ({
    id: `opponent:${index + 1}`,
    cell: coord(28, 8 + index),
    tags: ['opponent'],
    zoneId: 'zone:opponent',
    minimumClearance: 1,
    tacticalAnnotationIds: ['annotation:opponent']
  }));
  return {
    battleMapSchemaVersion: 3,
    terrainGenerationVersion: 3,
    contentId: 'forest:template-1:map-1',
    contentVersion: 1,
    templateId: 'forest:template-1',
    templateRevision: 1,
    theme: 'forest',
    renderProfileId: 'forest:pve:v1',
    tierEligibility: ['tier-1'],
    supportedModes: ['pve'],
    dimensions: { width, height },
    provenance: {
      sourceSidecar: { id: 'source:forest-1', version: 1, fullHash: HASH_A },
      approvedBlueprint: { id: 'blueprint:forest-1', version: 1, fullHash: HASH_B },
      assetBundle: { id: ASSET_BUNDLE_ID, version: 1, manifestFullHash: HASH_C },
      tileCatalog: { id: 'tiles:forest', version: 1, fullHash: HASH_A },
      compiler: { id: 'compiler:v3', version: 1, fullHash: HASH_B },
      validator: { id: 'validator:v3', version: 1, fullHash: HASH_C }
    },
    renderMask,
    playableMask,
    terrain,
    elevation,
    elevationConnections: [{
      id: 'connection:1',
      from: coord(15, 15),
      to: coord(16, 15),
      direction: 'e',
      kind: 'flat',
      heightDelta: 0,
      traversable: true,
      bidirectional: true,
      featureId: 'feature:route',
      asset: asset('connection:flat:e')
    }],
    visualCells,
    obstacles: [{
      id: 'obstacle:tree',
      kind: 'tree',
      cells: [coord(8, 8)],
      blocking: true,
      movementCost: 0,
      featureId: 'feature:field',
      anchor: coord(8, 8),
      occlusionBounds: { minX: 8, minY: 7, maxX: 9, maxY: 9 },
      asset: asset('obstacle:tree')
    }],
    decorations: [{
      id: 'decoration:flowers',
      kind: 'flowers',
      cell: coord(9, 9),
      featureId: 'feature:field',
      anchor: 'tile',
      asset: asset('decoration:flowers')
    }],
    boundaries: [{
      id: 'boundary:north',
      kind: 'forest-edge',
      edges: [{ cell: coord(0, 0), direction: 'n' }],
      featureId: 'feature:field',
      sceneOnly: true,
      asset: asset('boundary:forest:n')
    }],
    routes: [{
      id: 'route:main',
      kind: 'approach',
      material: 'dirt',
      cells: [coord(15, 15), coord(16, 15)],
      required: true,
      width: 1,
      featureId: 'feature:route',
      visualAssets: [{
        role: 'center',
        cells: [coord(15, 15), coord(16, 15)],
        asset: asset('route:center')
      }]
    }],
    features: [{
      id: 'feature:field',
      kind: 'biome-region',
      cells: [coord(0, 0), coord(8, 8), coord(9, 9)],
      ownerFeatureId: null,
      annotations: ['organic']
    }, {
      id: 'feature:route',
      kind: 'route',
      cells: [coord(15, 15), coord(16, 15)],
      ownerFeatureId: 'feature:field',
      annotations: ['required']
    }],
    spawnContract: {
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
        cells: opponentCandidates.map(record => record.cell),
        tags: ['opponent'],
        capacity: 7
      }],
      protectedClearances: [{
        id: 'clearance:player',
        side: 'player',
        anchorId: 'player:1',
        radius: 1
      }],
      exits: [{
        id: 'exit:player',
        side: 'player',
        cell: coord(4, 12),
        approachRegionId: 'approach:player'
      }, {
        id: 'exit:opponent',
        side: 'opponent',
        cell: coord(26, 12),
        approachRegionId: 'approach:opponent'
      }],
      approachRegions: [{
        id: 'approach:player',
        side: 'player',
        cells: [coord(3, 12), coord(4, 12)]
      }, {
        id: 'approach:opponent',
        side: 'opponent',
        cells: [coord(26, 12), coord(27, 12)]
      }],
      minimumRouteConstraints: {
        minimumIndependentExits: 1,
        requireMutualReachability: true,
        maximumTraversableElevationDelta: 1
      },
      tacticalAnnotations: [{
        id: 'annotation:opponent',
        kind: 'ranged-opportunity',
        cells: opponentCandidates.map(record => record.cell),
        tags: ['ranged']
      }]
    },
    hashVersion: 'sha256-cjson-v1'
  };
}

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).reverse().map(([key, child]) => [key, reverseObjectKeys(child)])
    );
  }
  return value;
}

async function mutateDuringNextDigest(mutate, run) {
  const subtle = globalThis.crypto.subtle;
  const descriptor = Object.getOwnPropertyDescriptor(subtle, 'digest');
  const original = subtle.digest;
  let mutated = false;
  Object.defineProperty(subtle, 'digest', {
    configurable: true,
    writable: true,
    value(...args) {
      const result = Reflect.apply(original, this, args);
      if (!mutated) {
        mutated = true;
        mutate();
      }
      return result;
    }
  });
  try {
    return await run();
  } finally {
    if (descriptor) Object.defineProperty(subtle, 'digest', descriptor);
    else delete subtle.digest;
  }
}

function createCatalogCandidate(finalMap) {
  return {
    catalogSchemaVersion: 1,
    catalogReleaseId: 'catalog:2026-07-30',
    selectorVersion: 1,
    assetBundlePins: [{
      assetBundleId: ASSET_BUNDLE_ID,
      manifestFullHash: HASH_C
    }],
    entries: [{
      id: 'entry:forest-map-1',
      mapContentId: finalMap.contentId,
      mapContentVersion: finalMap.contentVersion,
      mapFullHash: finalMap.hashes.fullHash,
      catalogReleaseId: 'catalog:2026-07-30',
      theme: finalMap.theme,
      renderProfileId: finalMap.renderProfileId,
      tierEligibility: finalMap.tierEligibility,
      supportedModes: finalMap.supportedModes,
      orientation: 'west-v-east',
      teamLayout: 'two-sided',
      dimensions: finalMap.dimensions,
      playerCapacity: finalMap.spawnContract.capacities.playerCapacity,
      candidatePoolSize: finalMap.spawnContract.capacities.candidatePoolSize,
      maxAssignableOpponents: finalMap.spawnContract.capacities.maxAssignableOpponents,
      assetBundleId: ASSET_BUNDLE_ID,
      assetBundleManifestFullHash: HASH_C,
      weight: 100,
      bossCapable: false,
      competitiveParity: false,
      sourceTemplateId: finalMap.templateId
    }]
  };
}

function createV2CatalogCandidate(finalMap) {
  const candidate = createCatalogCandidate(finalMap);
  candidate.catalogSchemaVersion = 2;
  candidate.selectorVersion = 2;
  candidate.entries[0].ecologyProfile = finalMap.ecologyProfile;
  return candidate;
}

function createV3CatalogCandidate(finalMap) {
  const candidate = createV2CatalogCandidate(finalMap);
  candidate.catalogSchemaVersion = 3;
  candidate.assetBundlePins[0].assetBundleVersion =
    finalMap.provenance.assetBundle.version;
  candidate.entries[0].assetBundleVersion =
    finalMap.provenance.assetBundle.version;
  return candidate;
}

test('BattleMap V3 accepts a complete 32x32 artifact and rejects unknown fields', () => {
  const candidate = createCandidate();
  assert.equal(validateBattleMapV3Candidate(candidate).valid, true);
  assert.doesNotThrow(() => assertBattleMapV3Candidate(candidate));

  for (const mutate of [
    value => { value.unplannedLayer = []; },
    value => { value.provenance.compiler.command = 'compile'; },
    value => { value.visualCells[0][0].surface.fallbackKey = 'generic'; },
    value => { value.spawnContract.opponentCandidates[0].score = 10; }
  ]) {
    const changed = clone(candidate);
    mutate(changed);
    const result = validateBattleMapV3Candidate(changed);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(message => message.includes('additional property')));
  }

  const rootRelativeAsset = createCandidate();
  rootRelativeAsset.visualCells[0][0].surface.immutableUrl =
    '/assets/battle-map-v3/forest-assets/v1/surface-grass.webp';
  assert.equal(validateBattleMapV3Candidate(rootRelativeAsset).valid, true);

  const uppercaseId = createCandidate();
  uppercaseId.contentId = 'Forest:map';
  assert.equal(validateBattleMapV3Candidate(uppercaseId).valid, false);

  for (const immutableUrl of [
    '/assets/battle-map-v3/../latest/surface.webp',
    '/assets/battle-map-v3/surface.webp?version=latest'
  ]) {
    const mutableAsset = createCandidate();
    mutableAsset.visualCells[0][0].surface.immutableUrl = immutableUrl;
    assert.equal(validateBattleMapV3Candidate(mutableAsset).valid, false);
  }

  const regional = createCandidate();
  regional.ecologyProfile = 'forest-iron-depths-borderwood';
  regional.scene = {
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
  assert.equal(validateBattleMapV3Candidate(regional).valid, true);
  regional.scene.backdrop.topColor = 'black';
  assert.match(
    validateBattleMapV3Candidate(regional).errors.join('\n'),
    /topColor.*#RRGGBB/
  );
});

test('playableMask is a strict subset of renderMask and void layers stay empty', () => {
  const outsideRender = createCandidate();
  outsideRender.renderMask[4][4] = false;
  assert.match(
    validateBattleMapV3Candidate(outsideRender).errors.join('\n'),
    /playable cell must also be rendered/
  );

  const populatedVoid = createCandidate();
  populatedVoid.renderMask[4][4] = false;
  populatedVoid.playableMask[4][4] = false;
  assert.match(
    validateBattleMapV3Candidate(populatedVoid).errors.join('\n'),
    /void cell terrain must be null/
  );

  const validVoid = createCandidate();
  validVoid.renderMask[4][4] = false;
  validVoid.playableMask[4][4] = false;
  validVoid.terrain[4][4] = null;
  validVoid.elevation[4][4] = null;
  validVoid.visualCells[4][4] = null;
  assert.equal(
    validateBattleMapV3Candidate(validVoid).valid,
    true,
    'void terrain has no feature reference and must not be reported as unknown'
  );
});

test('spawn capacities remain distinct and candidate cells must be occupiable', () => {
  const countMismatch = createCandidate();
  countMismatch.spawnContract.capacities.candidatePoolSize = 24;
  assert.match(
    validateBattleMapV3Candidate(countMismatch).errors.join('\n'),
    /must equal the unique candidate-cell and zone-cell pool size/
  );

  const blocked = createCandidate();
  blocked.obstacles[0].cells = [clone(blocked.spawnContract.opponentCandidates[0].cell)];
  assert.match(
    validateBattleMapV3Candidate(blocked).errors.join('\n'),
    /must not contain a blocking obstacle/
  );
});

test('spawn route metadata preserves side, membership, and minimum-exit invariants', () => {
  const wrongSide = createCandidate();
  wrongSide.spawnContract.exits[0].approachRegionId = 'approach:opponent';
  assert.match(validateBattleMapV3Candidate(wrongSide).errors.join('\n'), /same side/);

  const outsideRegion = createCandidate();
  outsideRegion.spawnContract.exits[0].cell = coord(5, 12);
  assert.match(validateBattleMapV3Candidate(outsideRegion).errors.join('\n'), /referenced approach region/);

  const insufficientExits = createCandidate();
  insufficientExits.spawnContract.minimumRouteConstraints.minimumIndependentExits = 2;
  assert.match(validateBattleMapV3Candidate(insufficientExits).errors.join('\n'), /has only 1 exits/);

  const wrongClearanceSide = createCandidate();
  wrongClearanceSide.spawnContract.protectedClearances[0].side = 'opponent';
  assert.match(validateBattleMapV3Candidate(wrongClearanceSide).errors.join('\n'), /spawn anchor side/);
});

test('visual placements, blockers, routes, and connection edges fail closed', () => {
  const nonblockingObstacle = createCandidate();
  nonblockingObstacle.obstacles[0].blocking = false;
  assert.match(
    validateBattleMapV3Candidate(nonblockingObstacle).errors.join('\n'),
    /must equal true for an obstacle/
  );

  const voidDecoration = createCandidate();
  voidDecoration.renderMask[9][9] = false;
  voidDecoration.playableMask[9][9] = false;
  voidDecoration.terrain[9][9] = null;
  voidDecoration.elevation[9][9] = null;
  voidDecoration.visualCells[9][9] = null;
  assert.match(
    validateBattleMapV3Candidate(voidDecoration).errors.join('\n'),
    /decoration cell must be rendered/
  );

  const impassableRoute = createCandidate();
  impassableRoute.terrain[15][15].passable = false;
  assert.match(
    validateBattleMapV3Candidate(impassableRoute).errors.join('\n'),
    /route cells must be playable and passable/
  );

  const duplicateEdge = createCandidate();
  duplicateEdge.elevationConnections.push({
    ...clone(duplicateEdge.elevationConnections[0]),
    id: 'connection:duplicate'
  });
  assert.match(
    validateBattleMapV3Candidate(duplicateEdge).errors.join('\n'),
    /duplicate directed connection edge/
  );

  const assetlessSlope = createCandidate();
  assetlessSlope.elevation[15][15] = 1;
  assetlessSlope.elevationConnections[0].kind = 'slope';
  assetlessSlope.elevationConnections[0].heightDelta = -1;
  assetlessSlope.elevationConnections[0].asset = null;
  assert.equal(validateBattleMapV3Candidate(assetlessSlope).valid, true);

  const assetlessStairs = clone(assetlessSlope);
  assetlessStairs.elevationConnections[0].kind = 'stairs';
  assert.match(
    validateBattleMapV3Candidate(assetlessStairs).errors.join('\n'),
    /asset.*must be a plain object/
  );

  const regionalAssetlessSlope = clone(assetlessSlope);
  regionalAssetlessSlope.ecologyProfile = 'forest-iron-depths-borderwood';
  assert.match(
    validateBattleMapV3Candidate(regionalAssetlessSlope).errors.join('\n'),
    /asset.*must be a plain object/
  );
});

test('malformed nested collection entries report validation errors instead of throwing', () => {
  for (const mutate of [
    value => { value.features[0] = null; },
    value => { value.obstacles[0] = null; },
    value => { value.spawnContract.opponentCandidates[0] = null; },
    value => { value.spawnContract.opponentZones[0] = null; },
    value => { value.spawnContract.exits[0] = null; },
    value => { value.spawnContract.playerSlots = 'not-an-array'; },
    value => { value.features = 'not-an-array'; },
    value => { value.obstacles = 'not-an-array'; }
  ]) {
    const malformed = createCandidate();
    mutate(malformed);
    assert.doesNotThrow(() => validateBattleMapV3Candidate(malformed));
    assert.equal(validateBattleMapV3Candidate(malformed).valid, false);
  }
});

test('map hashing is canonical, domain-separated, and detects visual and authoritative tampering', async () => {
  const candidate = createCandidate();
  const hashes = await computeBattleMapV3Hashes(candidate);
  assert.deepEqual(hashes, EXPECTED_MAP_HASHES);
  const reorderedHashes = await computeBattleMapV3Hashes(reverseObjectKeys(candidate));
  assert.deepEqual(reorderedHashes, hashes);
  assert.equal(new Set(Object.values(hashes)).size, 3);

  const visualChange = createCandidate();
  visualChange.decorations[0].asset.contentVersion = 2;
  const visualHashes = await computeBattleMapV3Hashes(visualChange);
  assert.equal(visualHashes.authoritativeHash, hashes.authoritativeHash);
  assert.notEqual(visualHashes.visualHash, hashes.visualHash);
  assert.notEqual(visualHashes.fullHash, hashes.fullHash);

  const authoritativeChange = createCandidate();
  authoritativeChange.terrain[0][0].movementCost = 2;
  const authoritativeHashes = await computeBattleMapV3Hashes(authoritativeChange);
  assert.notEqual(authoritativeHashes.authoritativeHash, hashes.authoritativeHash);
  assert.notEqual(authoritativeHashes.fullHash, hashes.fullHash);
});

test('finalization is immutable and stale map hashes fail closed', async () => {
  const candidate = createCandidate();
  const finalMap = await finalizeBattleMapV3(candidate);
  assert.equal(Object.isFrozen(finalMap), true);
  assert.equal(Object.isFrozen(finalMap.visualCells[0][0].surface), true);
  assert.equal(await verifyBattleMapV3Final(finalMap), true);
  assert.equal(Object.hasOwn(candidate, 'hashes'), false);

  const tampered = clone(finalMap);
  tampered.terrain[0][0].material = 'mud';
  assert.equal(await verifyBattleMapV3Final(tampered), false);
  await assert.rejects(() => assertVerifiedBattleMapV3Final(tampered), error => {
    assert.equal(error.code, 'BATTLE_MAP_V3_HASH_MISMATCH');
    return true;
  });

  const concurrentlyMutated = clone(finalMap);
  assert.equal(await mutateDuringNextDigest(
    () => { concurrentlyMutated.terrain[0][0].material = 'mud'; },
    () => verifyBattleMapV3Final(concurrentlyMutated)
  ), false);
});

test('catalog release is closed, ordered, integer-weighted, and exactly pinned', async () => {
  const finalMap = await finalizeBattleMapV3(createCandidate());
  const candidate = createCatalogCandidate(finalMap);
  assert.equal(await computeBattleMapV3CatalogHash(candidate), EXPECTED_CATALOG_HASH);
  assert.equal(validateBattleMapV3CatalogReleaseCandidate(candidate).valid, true);
  const release = await finalizeBattleMapV3CatalogRelease(candidate);
  assert.equal(validateBattleMapV3CatalogRelease(release).valid, true);
  assert.doesNotThrow(() => assertBattleMapV3CatalogRelease(release));
  assert.deepEqual(await assertBattleMapV3CatalogMapPins(release, [finalMap]), release);
  assert.equal(Object.isFrozen(release.entries[0]), true);

  const cases = [
    value => { value.reviewState = 'approved'; },
    value => { value.entries[0].holdout = false; },
    value => { value.entries[0].weight = 0.5; },
    value => { value.entries[0].weight = 1_000_001; },
    value => { value.entries[0].assetBundleManifestFullHash = HASH_B; },
    value => { value.entries[0].mapFullHash = 'not-a-hash'; }
  ];
  for (const mutate of cases) {
    const changed = clone(candidate);
    mutate(changed);
    assert.equal(validateBattleMapV3CatalogReleaseCandidate(changed).valid, false);
  }

  const inconsistentCandidate = createCatalogCandidate(finalMap);
  inconsistentCandidate.entries[0].theme = 'cave';
  const inconsistentRelease = await finalizeBattleMapV3CatalogRelease(inconsistentCandidate);
  await assert.rejects(
    () => assertBattleMapV3CatalogMapPins(inconsistentRelease, [finalMap]),
    error => error.code === 'BATTLE_MAP_V3_CATALOG_MAP_PIN_MISMATCH'
  );
});

test('catalog hash is deterministic and stale release hashes fail closed', async () => {
  const finalMap = await finalizeBattleMapV3(createCandidate());
  const candidate = createCatalogCandidate(finalMap);
  assert.equal(
    await computeBattleMapV3CatalogHash(candidate),
    await computeBattleMapV3CatalogHash(reverseObjectKeys(candidate))
  );
  const release = await finalizeBattleMapV3CatalogRelease(candidate);
  assert.equal(await verifyBattleMapV3CatalogRelease(release), true);

  const tampered = clone(release);
  tampered.entries[0].weight = 101;
  assert.equal(await verifyBattleMapV3CatalogRelease(tampered), false);
  await assert.rejects(() => assertVerifiedBattleMapV3CatalogRelease(tampered), error => {
    assert.equal(error.code, 'BATTLE_MAP_V3_CATALOG_HASH_MISMATCH');
    return true;
  });

  const concurrentlyMutated = clone(release);
  assert.equal(await mutateDuringNextDigest(
    () => { concurrentlyMutated.entries[0].weight = 102; },
    () => verifyBattleMapV3CatalogRelease(concurrentlyMutated)
  ), false);
});

test('catalog v2 pins exact map ecology while v1 remains byte-compatible', async () => {
  const candidate = createCandidate();
  candidate.ecologyProfile = 'forest-iron-depths-borderwood';
  candidate.scene = {
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
  const finalMap = await finalizeBattleMapV3(candidate);
  const catalogCandidate = createV2CatalogCandidate(finalMap);
  const release = await finalizeBattleMapV3CatalogRelease(catalogCandidate);

  assert.equal(validateBattleMapV3CatalogRelease(release).valid, true);
  assert.deepEqual(await assertBattleMapV3CatalogMapPins(release, [finalMap]), release);

  const wrongEcologyCandidate = clone(catalogCandidate);
  wrongEcologyCandidate.entries[0].ecologyProfile =
    'forest-shadowmere-gloomwood';
  const wrongEcologyRelease =
    await finalizeBattleMapV3CatalogRelease(wrongEcologyCandidate);
  await assert.rejects(
    () => assertBattleMapV3CatalogMapPins(wrongEcologyRelease, [finalMap]),
    error => error.code === 'BATTLE_MAP_V3_CATALOG_MAP_PIN_MISMATCH'
  );
});

test('catalog v3 pins exact asset bundle releases while v1 and v2 remain readable', async () => {
  const candidate = createCandidate();
  candidate.ecologyProfile = 'forest-iron-depths-borderwood';
  candidate.scene = {
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
  const finalMap = await finalizeBattleMapV3(candidate);
  const catalogCandidate = createV3CatalogCandidate(finalMap);
  catalogCandidate.assetBundlePins.push({
    assetBundleId: ASSET_BUNDLE_ID,
    assetBundleVersion: 2,
    manifestFullHash: HASH_B
  });
  const release = await finalizeBattleMapV3CatalogRelease(catalogCandidate);

  assert.equal(
    BATTLE_MAP_V3_CATALOG_HASH_DOMAIN,
    'modia:battle-map-v3:catalog-release:v3'
  );
  assert.equal(
    BATTLE_MAP_V3_CATALOG_PROJECTION_SCHEMA,
    'battle-map-v3-catalog-release/projection-v3'
  );
  assert.equal(
    createBattleMapV3CatalogHashProjection(createCatalogCandidate(finalMap))
      .projectionSchema,
    'battle-map-v3-catalog-release/projection-v1'
  );
  assert.equal(
    createBattleMapV3CatalogHashProjection(createV2CatalogCandidate(finalMap))
      .projectionSchema,
    'battle-map-v3-catalog-release/projection-v2'
  );
  assert.equal(
    createBattleMapV3CatalogHashProjection(catalogCandidate).projectionSchema,
    BATTLE_MAP_V3_CATALOG_PROJECTION_SCHEMA
  );
  assert.equal(release.catalogSchemaVersion, 3);
  assert.equal(release.selectorVersion, 2);
  assert.deepEqual(await assertBattleMapV3CatalogMapPins(release, [finalMap]), release);

  const duplicateIdentity = clone(catalogCandidate);
  duplicateIdentity.assetBundlePins[1] = {
    assetBundleId: ASSET_BUNDLE_ID,
    assetBundleVersion: 1,
    manifestFullHash: HASH_B
  };
  assert.equal(
    validateBattleMapV3CatalogReleaseCandidate(duplicateIdentity).valid,
    false
  );

  const descendingVersions = clone(catalogCandidate);
  descendingVersions.assetBundlePins.reverse();
  assert.equal(
    validateBattleMapV3CatalogReleaseCandidate(descendingVersions).valid,
    false
  );

  const unpinnedVersion = clone(catalogCandidate);
  unpinnedVersion.entries[0].assetBundleVersion = 3;
  assert.equal(
    validateBattleMapV3CatalogReleaseCandidate(unpinnedVersion).valid,
    false
  );

  const wrongVersionHash = clone(catalogCandidate);
  wrongVersionHash.entries[0].assetBundleVersion = 2;
  assert.equal(
    validateBattleMapV3CatalogReleaseCandidate(wrongVersionHash).valid,
    false
  );

  const wrongMapVersion = clone(catalogCandidate);
  wrongMapVersion.entries[0].assetBundleVersion = 2;
  wrongMapVersion.entries[0].assetBundleManifestFullHash = HASH_B;
  const wrongMapVersionRelease =
    await finalizeBattleMapV3CatalogRelease(wrongMapVersion);
  await assert.rejects(
    () => assertBattleMapV3CatalogMapPins(wrongMapVersionRelease, [finalMap]),
    error => error.code === 'BATTLE_MAP_V3_CATALOG_MAP_PIN_MISMATCH'
  );
});

test('minimal public final fixture is deterministic, frozen, and verified', async () => {
  const first = await createMinimalBattleMapV3FinalFixture();
  const second = await createMinimalBattleMapV3FinalFixture();
  assert.deepEqual(first.hashes, second.hashes);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(await verifyBattleMapV3Final(first), true);
});
