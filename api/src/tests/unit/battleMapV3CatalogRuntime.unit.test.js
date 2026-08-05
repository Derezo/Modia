import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMinimalBattleMapV3CandidateFixture,
  createMinimalBattleMapV3FinalFixture,
  finalizeBattleMapV3,
  finalizeBattleMapV3CatalogRelease
} from '../../../../shared/index.js';
import {
  BATTLE_MAP_V3_ACTIVE_RELEASE_SCHEMA,
  assertBattleMapV3ActiveReleasePin,
  loadBattleMapV3ReleaseFromPin,
  selectDeployedBattleMapV3
} from '../../services/battle/BattleMapV3CatalogRuntime.js';

const BORDERWOOD_ECOLOGY_PROFILE = 'forest-iron-depths-borderwood';

async function fixture({
  catalogSchemaVersion = 1,
  ecologyProfile
} = {}) {
  const map = ecologyProfile === undefined
    ? await createMinimalBattleMapV3FinalFixture()
    : await finalizeBattleMapV3({
      ...createMinimalBattleMapV3CandidateFixture(),
      ecologyProfile
    });
  const release = await finalizeBattleMapV3CatalogRelease({
    catalogSchemaVersion,
    catalogReleaseId: 'catalog:runtime-test',
    selectorVersion: catalogSchemaVersion,
    assetBundlePins: [{
      assetBundleId: map.provenance.assetBundle.id,
      ...(catalogSchemaVersion >= 3
        ? { assetBundleVersion: map.provenance.assetBundle.version }
        : {}),
      manifestFullHash: map.provenance.assetBundle.manifestFullHash
    }],
    entries: [{
      id: 'entry:runtime-test',
      mapContentId: map.contentId,
      mapContentVersion: map.contentVersion,
      mapFullHash: map.hashes.fullHash,
      catalogReleaseId: 'catalog:runtime-test',
      theme: map.theme,
      renderProfileId: map.renderProfileId,
      tierEligibility: map.tierEligibility,
      supportedModes: ['pve'],
      orientation: 'west-east',
      teamLayout: 'players-vs-opponents',
      dimensions: map.dimensions,
      playerCapacity: map.spawnContract.capacities.playerCapacity,
      candidatePoolSize: map.spawnContract.capacities.candidatePoolSize,
      maxAssignableOpponents: map.spawnContract.capacities.maxAssignableOpponents,
      assetBundleId: map.provenance.assetBundle.id,
      ...(catalogSchemaVersion >= 3
        ? { assetBundleVersion: map.provenance.assetBundle.version }
        : {}),
      assetBundleManifestFullHash: map.provenance.assetBundle.manifestFullHash,
      weight: 1,
      bossCapable: false,
      competitiveParity: false,
      sourceTemplateId: map.templateId,
      ...(ecologyProfile === undefined ? {} : { ecologyProfile })
    }]
  });
  const pin = {
    schemaVersion: BATTLE_MAP_V3_ACTIVE_RELEASE_SCHEMA,
    catalogReleaseId: release.catalogReleaseId,
    catalogPath: 'battle-maps/catalog/releases/runtime-test.json',
    catalogFullHash: release.catalogFullHash,
    maps: [{
      contentId: map.contentId,
      contentVersion: map.contentVersion,
      path: 'battle-maps/compiled/forest/runtime-test.json',
      fullHash: map.hashes.fullHash
    }]
  };
  const values = new Map([
    [pin.catalogPath, release],
    [pin.maps[0].path, map]
  ]);
  const workspaceRootUrl = new URL('file:///workspace/');
  const readJson = async url => {
    const path = url.href.replace(workspaceRootUrl.href, '');
    if (!values.has(path)) throw new Error(`Unexpected path ${path}`);
    return structuredClone(values.get(path));
  };
  return { map, release, pin, readJson, workspaceRootUrl };
}

test('tracked V3 release pin loads and verifies catalog and exact maps as one unit', async () => {
  const value = await fixture();
  const loaded = await loadBattleMapV3ReleaseFromPin(value.pin, value);
  assert.equal(loaded.release.catalogFullHash, value.release.catalogFullHash);
  assert.equal(loaded.mapsByIdentity.get(
    `${value.map.contentId}@${value.map.contentVersion}`
  ).hashes.fullHash, value.map.hashes.fullHash);
});

test('deployed selector returns automatic V3 coverage without any activation input', async () => {
  const value = await fixture();
  const deployed = await loadBattleMapV3ReleaseFromPin(value.pin, value);
  const selected = await selectDeployedBattleMapV3({
    encounterSeed: 731,
    theme: 'forest',
    sourceTier: 1,
    selectionBand: 'default',
    mode: 'pve',
    partyCapacityBand: 'players-1-5',
    opposingRosterCapacityBand: 'opponents-1-7',
    dimensions: value.map.dimensions,
    teamLayout: 'players-vs-opponents',
    playerCount: 5,
    opponentCount: 7,
    requireBossCapable: false,
    requireCompetitiveParity: false
  }, {
    loadCatalog: async () => deployed
  });

  assert.equal(selected.coverage, 'selected');
  assert.equal(selected.map.hashes.fullHash, value.map.hashes.fullHash);
  assert.equal(selected.provenance.catalogReleaseId, value.release.catalogReleaseId);
});

test('active r16 coverage automatically selects every approved Heartlands variant', async () => {
  const query = {
    theme: 'forest',
    ecologyProfile: 'forest-heartlands-woodland',
    sourceTier: 5,
    selectionBand: 'tier-5',
    mode: 'pve',
    partyCapacityBand: 'players-1-5',
    opposingRosterCapacityBand: 'opponents-1-7',
    dimensions: { width: 32, height: 32 },
    teamLayout: 'players-vs-opponents',
    playerCount: 5,
    opponentCount: 7,
    requireBossCapable: false,
    requireCompetitiveParity: false
  };
  const selected = await Promise.all([0, 1, 3, 4, 7, 8].map(encounterSeed =>
    selectDeployedBattleMapV3({ ...query, encounterSeed })
  ));

  assert.deepEqual(
    new Set(selected.map(result => result.map.contentId)),
    new Set([
      'forest-template-04-a',
      'forest-template-04-b',
      'forest-template-04-c',
      'forest-template-07-a',
      'forest-template-07-b',
      'forest-template-07-c'
    ])
  );
  assert.ok(selected.every(result => (
    result.coverage === 'selected'
    && result.provenance.catalogReleaseId
      === 'battle-map-v3-forest-pilot-2026-07-30-r16'
  )));
});

test('active r16 coverage automatically selects every approved Borderwood variant', async () => {
  const query = {
    theme: 'forest',
    ecologyProfile: BORDERWOOD_ECOLOGY_PROFILE,
    sourceTier: 1,
    selectionBand: 'tier-1',
    mode: 'pve',
    partyCapacityBand: 'players-1-5',
    opposingRosterCapacityBand: 'opponents-1-7',
    dimensions: { width: 32, height: 32 },
    teamLayout: 'players-vs-opponents',
    playerCount: 5,
    opponentCount: 7,
    requireBossCapable: false,
    requireCompetitiveParity: false
  };
  const selected = await Promise.all([0, 1, 5, 6].map(encounterSeed =>
    selectDeployedBattleMapV3({ ...query, encounterSeed })
  ));

  assert.deepEqual(
    new Set(selected.map(result => result.map.contentId)),
    new Set([
      'forest-template-01-b',
      'forest-template-05-a',
      'forest-template-05-b',
      'forest-template-05-c'
    ])
  );
  assert.ok(selected.every(result => (
    result.coverage === 'selected'
    && result.provenance.catalogReleaseId
      === 'battle-map-v3-forest-pilot-2026-07-30-r16'
  )));
});

test('active r16 deliberately withholds boss eligibility pending boss coverage acceptance', async () => {
  const selection = await selectDeployedBattleMapV3({
    encounterSeed: 17,
    theme: 'forest',
    ecologyProfile: BORDERWOOD_ECOLOGY_PROFILE,
    sourceTier: 1,
    selectionBand: 'tier-1',
    mode: 'pve',
    partyCapacityBand: 'players-1-5',
    opposingRosterCapacityBand: 'opponents-1-7',
    dimensions: { width: 32, height: 32 },
    teamLayout: 'players-vs-opponents',
    playerCount: 5,
    opponentCount: 7,
    requireBossCapable: true,
    requireCompetitiveParity: false
  });

  assert.equal(selection.coverage, 'absent');
  assert.deepEqual(selection.eligibleMapContentIds, []);
  assert.equal(selection.entry, null);
  assert.equal(selection.map, null);
});

test('schema-2 deployed selector automatically requires exact ecology coverage', async () => {
  const value = await fixture({
    catalogSchemaVersion: 2,
    ecologyProfile: BORDERWOOD_ECOLOGY_PROFILE
  });
  const deployed = await loadBattleMapV3ReleaseFromPin(value.pin, value);
  const query = {
    encounterSeed: 731,
    theme: 'forest',
    sourceTier: 1,
    selectionBand: 'default',
    mode: 'pve',
    partyCapacityBand: 'players-1-5',
    opposingRosterCapacityBand: 'opponents-1-7',
    dimensions: value.map.dimensions,
    teamLayout: 'players-vs-opponents',
    playerCount: 5,
    opponentCount: 7,
    requireBossCapable: false,
    requireCompetitiveParity: false
  };
  const loadCatalog = async () => deployed;

  const selected = await selectDeployedBattleMapV3({
    ...query,
    ecologyProfile: BORDERWOOD_ECOLOGY_PROFILE
  }, { loadCatalog });
  const absent = await selectDeployedBattleMapV3({
    ...query,
    ecologyProfile: 'forest-shadowmere-gloomwood'
  }, { loadCatalog });

  assert.equal(value.release.catalogSchemaVersion, 2);
  assert.equal(value.release.selectorVersion, 2);
  assert.equal(selected.coverage, 'selected');
  assert.equal(selected.map.hashes.fullHash, value.map.hashes.fullHash);
  assert.equal(
    selected.provenance.ecologyProfile,
    BORDERWOOD_ECOLOGY_PROFILE
  );
  assert.equal(absent.coverage, 'absent');
  assert.equal(absent.entry, null);
  assert.equal(absent.map, null);
  assert.equal(absent.provenance, null);
  assert.deepEqual(absent.eligibleMapContentIds, []);
});

test('active release pin rejects path traversal and stale hashes', async () => {
  const value = await fixture();
  assert.throws(
    () => assertBattleMapV3ActiveReleasePin({
      ...value.pin,
      catalogPath: '../outside.json'
    }),
    /traversal/
  );
  await assert.rejects(
    loadBattleMapV3ReleaseFromPin({
      ...value.pin,
      catalogFullHash: `sha256:${'f'.repeat(64)}`
    }, value),
    /does not match/
  );
});
