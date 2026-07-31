import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createMinimalBattleMapV3FinalFixture,
  finalizeBattleMapV3CatalogRelease
} from './v3/index.js';
import {
  createBattleMapV3SelectionQuery,
  selectBattleMapV3CatalogEntry
} from './BattleMapV3Selector.js';

function entry(map, {
  id = 'entry:forest:1',
  mapContentId = map.contentId,
  weight = 7,
  maxAssignableOpponents = map.spawnContract.capacities.maxAssignableOpponents,
  ecologyProfile
} = {}) {
  const record = {
    id,
    mapContentId,
    mapContentVersion: map.contentVersion,
    mapFullHash: map.hashes.fullHash,
    catalogReleaseId: 'catalog:test-v1',
    theme: map.theme,
    renderProfileId: map.renderProfileId,
    tierEligibility: ['tier-1'],
    supportedModes: ['pve'],
    orientation: 'west-east',
    teamLayout: 'players-vs-opponents',
    dimensions: map.dimensions,
    playerCapacity: map.spawnContract.capacities.playerCapacity,
    candidatePoolSize: map.spawnContract.capacities.candidatePoolSize,
    maxAssignableOpponents,
    assetBundleId: map.provenance.assetBundle.id,
    assetBundleManifestFullHash: map.provenance.assetBundle.manifestFullHash,
    weight,
    bossCapable: false,
    competitiveParity: false,
    sourceTemplateId: map.templateId
  };
  if (ecologyProfile !== undefined) record.ecologyProfile = ecologyProfile;
  return record;
}

async function release(
  entries,
  catalogReleaseId = 'catalog:test-v1',
  catalogSchemaVersion = 1
) {
  const map = await createMinimalBattleMapV3FinalFixture();
  return finalizeBattleMapV3CatalogRelease({
    catalogSchemaVersion,
    catalogReleaseId,
    selectorVersion: catalogSchemaVersion,
    assetBundlePins: [{
      assetBundleId: map.provenance.assetBundle.id,
      manifestFullHash: map.provenance.assetBundle.manifestFullHash
    }],
    entries: entries.map(record => ({ ...record, catalogReleaseId }))
  });
}

function query(overrides = {}) {
  return createBattleMapV3SelectionQuery({
    encounterSeed: 731,
    theme: 'forest',
    sourceTier: 1,
    selectionBand: 'tier-1',
    mode: 'pve',
    partyCapacityBand: 'players-1-5',
    opposingRosterCapacityBand: 'opponents-1-7',
    dimensions: { width: 8, height: 8 },
    teamLayout: 'players-vs-opponents',
    playerCount: 5,
    opponentCount: 7,
    ...overrides
  });
}

test('BattleMapV3 selector is deterministic, ordered by map ID, and records exact provenance', async () => {
  const map = await createMinimalBattleMapV3FinalFixture();
  const second = entry(map, {
    id: 'entry:forest:2',
    mapContentId: 'forest:template-1:map-2',
    weight: 11
  });
  const catalog = await release([entry(map), second]);
  const first = await selectBattleMapV3CatalogEntry(catalog, query());
  const repeated = await selectBattleMapV3CatalogEntry(catalog, query());

  assert.deepEqual(first, repeated);
  assert.equal(first.coverage, 'selected');
  assert.deepEqual(first.eligibleMapContentIds, [
    map.contentId,
    'forest:template-1:map-2'
  ]);
  assert.equal(first.provenance.catalogReleaseId, catalog.catalogReleaseId);
  assert.equal(first.provenance.catalogFullHash, catalog.catalogFullHash);
  assert.equal(first.provenance.mapFullHash, first.entry.mapFullHash);
  assert.equal(
    first.selectorDigest,
    'sha256:91edb963a7f74a7237b31009059f0f25bfc39f6ada2b85773b535a6a9eed8998'
  );
  assert.equal(first.entry.mapContentId, 'forest:template-1:map-2');
  assert.equal(Object.isFrozen(first), true);
});

test('BattleMapV3 selector reports only genuine catalog coverage absence', async () => {
  const map = await createMinimalBattleMapV3FinalFixture();
  const catalog = await release([entry(map)]);
  const absent = await selectBattleMapV3CatalogEntry(catalog, query({
    selectionBand: 'tier-5'
  }));

  assert.equal(absent.coverage, 'absent');
  assert.equal(absent.entry, null);
  assert.equal(absent.provenance, null);
  assert.deepEqual(absent.eligibleMapContentIds, []);
});

test('BattleMapV3 selector v2 uses exact ecology coverage in its digest and provenance', async () => {
  const map = await createMinimalBattleMapV3FinalFixture();
  const catalog = await release([
    entry(map, {
      id: 'entry:forest:borderwood',
      mapContentId: 'forest:template-1:borderwood',
      ecologyProfile: 'forest-iron-depths-borderwood'
    }),
    entry(map, {
      id: 'entry:forest:heartlands',
      mapContentId: 'forest:template-1:heartlands',
      ecologyProfile: 'forest-heartlands-woodland'
    })
  ], 'catalog:test-v2', 2);
  const borderwood = await selectBattleMapV3CatalogEntry(catalog, query({
    ecologyProfile: 'forest-iron-depths-borderwood'
  }));
  const heartlands = await selectBattleMapV3CatalogEntry(catalog, query({
    ecologyProfile: 'forest-heartlands-woodland'
  }));
  const absent = await selectBattleMapV3CatalogEntry(catalog, query({
    ecologyProfile: 'forest-shadowmere-gloomwood'
  }));

  assert.equal(borderwood.coverage, 'selected');
  assert.equal(borderwood.entry.mapContentId, 'forest:template-1:borderwood');
  assert.equal(
    borderwood.selectorInput.ecologyProfile,
    'forest-iron-depths-borderwood'
  );
  assert.equal(
    borderwood.provenance.ecologyProfile,
    'forest-iron-depths-borderwood'
  );
  assert.equal(heartlands.coverage, 'selected');
  assert.notEqual(borderwood.selectorDigest, heartlands.selectorDigest);
  assert.equal(absent.coverage, 'absent');
});

test('BattleMapV3 selector fails closed on invalid capacity and zero weights', async () => {
  const map = await createMinimalBattleMapV3FinalFixture();
  const tooSmall = await release([entry(map, { maxAssignableOpponents: 6 })]);
  await assert.rejects(
    selectBattleMapV3CatalogEntry(tooSmall, query()),
    error => error.code === 'BATTLE_MAP_V3_SELECTED_MAP_CAPACITY_MISMATCH'
  );

  const zero = await release([entry(map, { weight: 0 })]);
  await assert.rejects(
    selectBattleMapV3CatalogEntry(zero, query()),
    error => error.code === 'BATTLE_MAP_V3_SELECTOR_ZERO_WEIGHT'
  );
});

test('BattleMapV3 selector keeps a pinned node seed stable across formation and roster changes', async () => {
  const map = await createMinimalBattleMapV3FinalFixture();
  const second = entry(map, {
    id: 'entry:forest:2',
    mapContentId: 'forest:template-1:map-2',
    weight: 11
  });
  const catalog = await release([entry(map), second]);
  const selections = await Promise.all([
    selectBattleMapV3CatalogEntry(catalog, query({
      playerCount: 1,
      opponentCount: 1
    })),
    selectBattleMapV3CatalogEntry(catalog, query({
      partyCapacityBand: 'players-1-5',
      opposingRosterCapacityBand: 'opponents-1-7',
      playerCount: 5,
      opponentCount: 7
    }))
  ]);

  assert.equal(selections[0].coverage, 'selected');
  assert.equal(selections[1].coverage, 'selected');
  assert.equal(selections[0].entry.mapContentId, selections[1].entry.mapContentId);
  assert.equal(selections[0].selectorDigest, selections[1].selectorDigest);
  assert.equal(
    selections[0].selectorInput.partyCapacityBand,
    'players-1-5'
  );
  assert.equal(
    selections[0].selectorInput.opposingRosterCapacityBand,
    'opponents-1-7'
  );
});

test('BattleMapV3 selector rejects an over-capacity selected map instead of reselecting', async () => {
  const map = await createMinimalBattleMapV3FinalFixture();
  const selectedWhenFitting = entry(map, {
    id: 'entry:forest:2',
    mapContentId: 'forest:template-1:map-2',
    weight: 11,
    maxAssignableOpponents: 6
  });
  const catalog = await release([entry(map), selectedWhenFitting]);
  const fitting = await selectBattleMapV3CatalogEntry(catalog, query({ opponentCount: 6 }));

  assert.equal(fitting.entry.mapContentId, 'forest:template-1:map-2');
  await assert.rejects(
    selectBattleMapV3CatalogEntry(catalog, query({ opponentCount: 7 })),
    error => (
      error.code === 'BATTLE_MAP_V3_SELECTED_MAP_CAPACITY_MISMATCH'
      && error.selectorDigest === fitting.selectorDigest
      && error.selectedEntryId === 'entry:forest:2'
      && error.maxAssignableOpponents === 6
    )
  );
  // The other entry can host seven opponents, proving this is not a coverage
  // absence or a capacity-driven reselection. A malformed catalog fails
  // closed, so V2 compatibility remains exclusive to genuine zero coverage.
  assert.equal(catalog.entries.find(record => record.mapContentId === map.contentId)
    .maxAssignableOpponents, 7);
});

test('BattleMapV3 selector lets a deliberate pinned catalog release change remap a seed', async () => {
  const map = await createMinimalBattleMapV3FinalFixture();
  const entries = [
    entry(map),
    entry(map, {
      id: 'entry:forest:2',
      mapContentId: 'forest:template-1:map-2',
      weight: 11
    })
  ];
  const firstRelease = await release(entries, 'catalog:test-v1');
  const replacementRelease = await release(entries, 'catalog:test-v2');
  const [first, replacement] = await Promise.all([
    selectBattleMapV3CatalogEntry(firstRelease, query()),
    selectBattleMapV3CatalogEntry(replacementRelease, query())
  ]);

  assert.notEqual(first.selectorDigest, replacement.selectorDigest);
  assert.equal(first.selectorInput.catalogReleaseId, 'catalog:test-v1');
  assert.equal(replacement.selectorInput.catalogReleaseId, 'catalog:test-v2');
});

test('the existing Whispering Woods node keeps its pinned forest-B identity', async () => {
  const catalog = JSON.parse(await readFile(new URL(
    '../../battle-maps/catalog/releases/'
      + 'battle-map-v3-forest-pilot-2026-07-30-r3.json',
    import.meta.url
  ), 'utf8'));
  const selection = await selectBattleMapV3CatalogEntry(catalog, query({
    encounterSeed: 1665986859,
    dimensions: { width: 32, height: 32 },
    playerCount: 1,
    opponentCount: 1
  }));

  assert.equal(selection.coverage, 'selected');
  assert.equal(selection.entry.mapContentId, 'forest-template-01-b');
  assert.equal(
    selection.selectorDigest,
    'sha256:ae22b72b05f7e5ed8de7bb05f5e9f5ef707f3cc425bb7111e7abad938fad6c77'
  );
});

test('the current forest release keeps Whispering Woods on approved B v9 for every covered roster', async () => {
  const catalog = JSON.parse(await readFile(new URL(
    '../../battle-maps/catalog/releases/'
      + 'battle-map-v3-forest-pilot-2026-07-30-r4.json',
    import.meta.url
  ), 'utf8'));
  const selections = await Promise.all(
    Array.from({ length: 5 }, (_, playerIndex) =>
      Array.from({ length: 7 }, (_, opponentIndex) =>
        selectBattleMapV3CatalogEntry(catalog, query({
          encounterSeed: 1665986859,
          dimensions: { width: 32, height: 32 },
          playerCount: playerIndex + 1,
          opponentCount: opponentIndex + 1
        }))
      )
    ).flat()
  );

  assert.equal(selections.length, 35);
  for (const selection of selections) {
    assert.equal(selection.coverage, 'selected');
    assert.equal(selection.entry.mapContentId, 'forest-template-01-b');
    assert.equal(selection.entry.mapContentVersion, 9);
    assert.equal(
      selection.selectorDigest,
      'sha256:7315e88190a47dffb42f30cc29fd1114d2cf0dc76aa606e04c388aaea19ec6b9'
    );
    assert.equal(
      selection.provenance.catalogReleaseId,
      'battle-map-v3-forest-pilot-2026-07-30-r4'
    );
  }
});

test('the ecology-qualified r5 release keeps Whispering Woods on approved B v11 for every roster', async () => {
  const catalog = JSON.parse(await readFile(new URL(
    '../../battle-maps/catalog/releases/'
      + 'battle-map-v3-forest-pilot-2026-07-30-r5.json',
    import.meta.url
  ), 'utf8'));
  const selections = await Promise.all(
    Array.from({ length: 5 }, (_, playerIndex) =>
      Array.from({ length: 7 }, (_, opponentIndex) =>
        selectBattleMapV3CatalogEntry(catalog, query({
          encounterSeed: 1665986859,
          ecologyProfile: 'forest-iron-depths-borderwood',
          dimensions: { width: 32, height: 32 },
          playerCount: playerIndex + 1,
          opponentCount: opponentIndex + 1
        }))
      )
    ).flat()
  );

  assert.equal(catalog.catalogSchemaVersion, 2);
  assert.equal(catalog.selectorVersion, 2);
  assert.equal(selections.length, 35);
  for (const selection of selections) {
    assert.equal(selection.coverage, 'selected');
    assert.equal(selection.entry.mapContentId, 'forest-template-01-b');
    assert.equal(selection.entry.mapContentVersion, 11);
    assert.equal(
      selection.entry.ecologyProfile,
      'forest-iron-depths-borderwood'
    );
    assert.equal(
      selection.selectorDigest,
      'sha256:4a4afbb5dd4ca4798c4487645211127953cbcdb82919ff1bf6db7916cf32d7b1'
    );
    assert.equal(
      selection.provenance.catalogReleaseId,
      'battle-map-v3-forest-pilot-2026-07-30-r5'
    );
    assert.equal(
      selection.provenance.ecologyProfile,
      'forest-iron-depths-borderwood'
    );
  }
});

test('the fail-closed r6 release keeps Whispering Woods on approved B v12 for every roster', async () => {
  const catalog = JSON.parse(await readFile(new URL(
    '../../battle-maps/catalog/releases/'
      + 'battle-map-v3-forest-pilot-2026-07-30-r6.json',
    import.meta.url
  ), 'utf8'));
  const selections = await Promise.all(
    Array.from({ length: 5 }, (_, playerIndex) =>
      Array.from({ length: 7 }, (_, opponentIndex) =>
        selectBattleMapV3CatalogEntry(catalog, query({
          encounterSeed: 1665986859,
          ecologyProfile: 'forest-iron-depths-borderwood',
          dimensions: { width: 32, height: 32 },
          playerCount: playerIndex + 1,
          opponentCount: opponentIndex + 1
        }))
      )
    ).flat()
  );

  assert.equal(catalog.catalogSchemaVersion, 2);
  assert.equal(catalog.selectorVersion, 2);
  assert.equal(selections.length, 35);
  for (const selection of selections) {
    assert.equal(selection.coverage, 'selected');
    assert.equal(selection.entry.mapContentId, 'forest-template-01-b');
    assert.equal(selection.entry.mapContentVersion, 12);
    assert.equal(
      selection.entry.ecologyProfile,
      'forest-iron-depths-borderwood'
    );
    assert.equal(
      selection.selectorDigest,
      'sha256:42edbb23a97eabe4433cf26d9054047e42610a416e956ff9fdd6b11f3789f23b'
    );
    assert.equal(
      selection.provenance.catalogReleaseId,
      'battle-map-v3-forest-pilot-2026-07-30-r6'
    );
    assert.equal(
      selection.provenance.ecologyProfile,
      'forest-iron-depths-borderwood'
    );
  }
});
