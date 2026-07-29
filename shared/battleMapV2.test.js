import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BattleMapAdapter,
  MINIMAL_BATTLE_MAP_V2_CANDIDATE,
  REPRESENTATIVE_BATTLE_MAP_V2_CANDIDATE,
  REPRESENTATIVE_BATTLE_MAP_V2_CANONICAL_VECTOR,
  REPRESENTATIVE_BATTLE_MAP_V2_EXPECTED_HASHES,
  assertBattleMapAuthoritativeProjection,
  assertBattleMapV2Candidate,
  assertBattleMapV2Final,
  assertBattleMapVisualProjection,
  assertVerifiedBattleMapV2Final,
  battleMapV2FromFlatState,
  battleMapV2ToFlatState,
  canonicalJsonBytes,
  canonicalizeJson,
  computeBattleMapHashes,
  createBattleMapProjections,
  createMinimalBattleMapV2CandidateFixture,
  createRepresentativeBattleMapV2CandidateFixture,
  createRepresentativeBattleMapV2FinalFixture,
  finalizeBattleMapV2,
  loadLegacyFlatBattleState,
  parseJsonRejectDuplicateKeys,
  splitBattleMapV2FlatState,
  validateBattleMapV2Candidate,
  validateBattleMapV2Final,
  verifyBattleMapV2Final
} from './battleMap/index.js';

function clone(value) {
  return structuredClone(value);
}

function reverseObjectKeyOrder(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeyOrder);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, child]) => [key, reverseObjectKeyOrder(child)])
    );
  }
  return value;
}

test('minimal and representative candidates satisfy the closed candidate schema', () => {
  assert.equal(validateBattleMapV2Candidate(MINIMAL_BATTLE_MAP_V2_CANDIDATE).valid, true);
  assert.equal(validateBattleMapV2Candidate(REPRESENTATIVE_BATTLE_MAP_V2_CANDIDATE).valid, true);
  assert.doesNotThrow(() => assertBattleMapV2Candidate(MINIMAL_BATTLE_MAP_V2_CANDIDATE));
  assert.doesNotThrow(() => assertBattleMapV2Candidate(REPRESENTATIVE_BATTLE_MAP_V2_CANDIDATE));
});

test('candidate and final schemas are distinct and hashes are exact', async () => {
  assert.equal(validateBattleMapV2Final(MINIMAL_BATTLE_MAP_V2_CANDIDATE).valid, false);
  const finalMap = await finalizeBattleMapV2(createMinimalBattleMapV2CandidateFixture());
  assert.equal(validateBattleMapV2Final(finalMap).valid, true);
  assert.equal(validateBattleMapV2Candidate(finalMap).valid, false);

  for (const digest of Object.values(finalMap.diagnostics.hashes)) {
    assert.match(digest, /^sha256:[0-9a-f]{64}$/);
  }

  const uppercase = clone(finalMap);
  uppercase.diagnostics.hashes.fullHash = uppercase.diagnostics.hashes.fullHash.toUpperCase();
  assert.throws(() => assertBattleMapV2Final(uppercase), /must match/);
});

test('closed schema rejects additions at envelope and nested record levels', () => {
  const cases = [
    map => { map.unplannedLayer = []; },
    map => { map.terrain[0][0].opacity = 0.5; },
    map => { map.elevationConnections[0].animation = 'rise'; },
    map => { map.spawnLayout.slots[0].faction = 'heroes'; },
    map => { map.transitions[0].blendMode = 'screen'; },
    map => { map.decorations[0].blocking = true; },
    map => { map.features.waterBodies[0].flowField = []; },
    map => { map.diagnostics.resolvedRecipe.quantization.epsilon = 0.01; },
    map => { map.diagnostics.algorithms[0].durationMs = 12; },
    map => { map.diagnostics.qualityMetrics.telemetry = {}; }
  ];

  for (const mutate of cases) {
    const value = createRepresentativeBattleMapV2CandidateFixture();
    mutate(value);
    const result = validateBattleMapV2Candidate(value);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(message => message.includes('additional property')));
  }
});

test('stable feature and zone references reject dangling or duplicate identities', () => {
  const dangling = createRepresentativeBattleMapV2CandidateFixture();
  dangling.obstacles[0].featureId = 'region:missing';
  assert.equal(validateBattleMapV2Candidate(dangling).valid, false);

  const duplicate = createRepresentativeBattleMapV2CandidateFixture();
  duplicate.features.routes[0].id = duplicate.features.regions[0].id;
  assert.equal(validateBattleMapV2Candidate(duplicate).valid, false);

  const badZone = createRepresentativeBattleMapV2CandidateFixture();
  badZone.spawnLayout.exits[0].zoneId = 'zone:missing';
  assert.equal(validateBattleMapV2Candidate(badZone).valid, false);
});

test('normalized elevation and connection deltas are finite and range-bounded', () => {
  for (const elevation of [-0.01, 1.01, Number.NaN, Infinity]) {
    const candidate = createRepresentativeBattleMapV2CandidateFixture();
    candidate.elevation[0][0] = elevation;
    assert.equal(validateBattleMapV2Candidate(candidate).valid, false);
  }
  const badDelta = createRepresentativeBattleMapV2CandidateFixture();
  badDelta.elevationConnections[0].elevationDelta = 1.01;
  assert.equal(validateBattleMapV2Candidate(badDelta).valid, false);
});

test('canonical JSON is key-order invariant and uses ECMAScript number normalization', () => {
  assert.equal(
    canonicalizeJson({ b: 1, a: -0, numbers: [333333333.33333329, 1E30, 4.50, 2e-3, 1e-27] }),
    '{"a":0,"b":1,"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27]}'
  );
  assert.equal(
    canonicalizeJson({ z: { b: 2, a: 1 }, a: true }),
    canonicalizeJson({ a: true, z: { a: 1, b: 2 } })
  );
});

test('canonical JSON rejects unsupported values, sparse arrays, cycles, and lone surrogates', () => {
  const sparse = [];
  sparse.length = 1;
  const cyclic = {};
  cyclic.self = cyclic;
  for (const value of [
    { value: undefined },
    { value: Number.NaN },
    { value: Infinity },
    { value: 1n },
    { value: Symbol('x') },
    { [Symbol('key')]: 1 },
    { value() {} },
    { value: new Date(0) },
    sparse,
    cyclic,
    { value: '\ud800' },
    { '\udc00': true }
  ]) {
    assert.throws(() => canonicalizeJson(value), TypeError);
  }
});

test('duplicate-key-safe JSON parser rejects duplicate keys and malformed numeric input', () => {
  assert.deepEqual(parseJsonRejectDuplicateKeys('{"a":1,"nested":{"b":2}}'), {
    a: 1,
    nested: { b: 2 }
  });
  assert.throws(() => parseJsonRejectDuplicateKeys('{"a":1,"a":2}'), /Duplicate object key/);
  assert.throws(() => parseJsonRejectDuplicateKeys('{"a":1,"nested":{"x":1,"x":2}}'), /Duplicate object key/);
  assert.throws(() => parseJsonRejectDuplicateKeys('{"a":01}'), SyntaxError);
  assert.throws(() => parseJsonRejectDuplicateKeys('{"a":1e999}'), /finite/);
});

test('published projection, canonical-byte, and hash vectors remain exact', async () => {
  const hashes = await computeBattleMapHashes(REPRESENTATIVE_BATTLE_MAP_V2_CANDIDATE);
  assert.deepEqual(hashes, REPRESENTATIVE_BATTLE_MAP_V2_EXPECTED_HASHES);

  const projections = createBattleMapProjections(REPRESENTATIVE_BATTLE_MAP_V2_CANDIDATE);
  assert.deepEqual(projections, REPRESENTATIVE_BATTLE_MAP_V2_CANONICAL_VECTOR.projections);
  for (const key of ['authoritative', 'visual', 'full']) {
    assert.equal(
      new TextDecoder().decode(canonicalJsonBytes(projections[key])),
      REPRESENTATIVE_BATTLE_MAP_V2_CANONICAL_VECTOR.canonicalJson[key]
    );
    assert.deepEqual(
      Array.from(canonicalJsonBytes(projections[key])),
      REPRESENTATIVE_BATTLE_MAP_V2_CANONICAL_VECTOR.canonicalUtf8Bytes[key]
    );
  }
});

test('projection schemas are closed and contain only their declared domains', () => {
  const projections = createBattleMapProjections(REPRESENTATIVE_BATTLE_MAP_V2_CANDIDATE);
  assert.doesNotThrow(() => assertBattleMapAuthoritativeProjection(projections.authoritative));
  assert.doesNotThrow(() => assertBattleMapVisualProjection(projections.visual));

  const extraAuthoritative = clone(projections.authoritative);
  extraAuthoritative.units = [];
  assert.throws(() => assertBattleMapAuthoritativeProjection(extraAuthoritative), /not allowed/);

  const extraGeneration = clone(projections.authoritative);
  extraGeneration.generation.qualityMetrics = {};
  assert.throws(() => assertBattleMapAuthoritativeProjection(extraGeneration), /not allowed/);

  const extraVisual = clone(projections.visual);
  extraVisual.terrain = [];
  assert.throws(() => assertBattleMapVisualProjection(extraVisual), /not allowed/);

  const extraVisualRecord = clone(projections.visual);
  extraVisualRecord.decorations[0].blocking = false;
  assert.throws(() => assertBattleMapVisualProjection(extraVisualRecord), /not allowed/);

  const extraAuthoritativeRecord = clone(projections.authoritative);
  extraAuthoritativeRecord.terrain[0][0].unplanned = true;
  assert.throws(() => assertBattleMapAuthoritativeProjection(extraAuthoritativeRecord), /validation failed/);
});

test('visual-only changes affect visual and full hashes but not authoritative hash', async () => {
  const before = await computeBattleMapHashes(REPRESENTATIVE_BATTLE_MAP_V2_CANDIDATE);
  const changed = createRepresentativeBattleMapV2CandidateFixture();
  changed.decorations[0].variantIndex += 1;
  const after = await computeBattleMapHashes(changed);
  assert.equal(after.authoritativeHash, before.authoritativeHash);
  assert.notEqual(after.visualHash, before.visualHash);
  assert.notEqual(after.fullHash, before.fullHash);
});

test('authoritative array order is semantic and changes authoritative/full hashes', async () => {
  const before = await computeBattleMapHashes(REPRESENTATIVE_BATTLE_MAP_V2_CANDIDATE);
  const changed = createRepresentativeBattleMapV2CandidateFixture();
  changed.features.routes[0].centerline.reverse();
  const after = await computeBattleMapHashes(changed);
  assert.notEqual(after.authoritativeHash, before.authoritativeHash);
  assert.equal(after.visualHash, before.visualHash);
  assert.notEqual(after.fullHash, before.fullHash);
});

test('finalization attaches hashes without mutating candidate and recursively freezes final', async () => {
  const candidate = createRepresentativeBattleMapV2CandidateFixture();
  const before = canonicalizeJson(candidate);
  const finalMap = await finalizeBattleMapV2(candidate);

  assert.equal(canonicalizeJson(candidate), before);
  assert.equal(Object.hasOwn(candidate.diagnostics, 'hashes'), false);
  assert.equal(Object.isFrozen(finalMap), true);
  assert.equal(Object.isFrozen(finalMap.diagnostics.hashes), true);
  assert.equal(Object.isFrozen(finalMap.features.routes[0].centerline[0]), true);
  assert.equal(await verifyBattleMapV2Final(finalMap), true);
});

test('final hash verification fails closed after hashed content changes', async () => {
  const finalMap = await createRepresentativeBattleMapV2FinalFixture();
  const tampered = clone(finalMap);
  tampered.terrain[0][0].material = 'stone';
  assert.equal(await verifyBattleMapV2Final(tampered), false);
  await assert.rejects(() => assertVerifiedBattleMapV2Final(tampered), error => {
    assert.equal(error.code, 'BATTLE_MAP_HASH_MISMATCH');
    return true;
  });
});

test('flat-state adapter preserves every V2 layer and separates mutable state', async () => {
  const finalMap = await createRepresentativeBattleMapV2FinalFixture();
  const flat = await battleMapV2ToFlatState(finalMap, {
    battleId: 'battle-1',
    turnNumber: 3
  });
  const loaded = await battleMapV2FromFlatState(flat);
  assert.deepEqual(loaded, finalMap);

  const split = await splitBattleMapV2FlatState(flat);
  assert.deepEqual(split.map, finalMap);
  assert.deepEqual(split.mutableState, { battleId: 'battle-1', turnNumber: 3 });
  assert.deepEqual(await BattleMapAdapter.fromFlatState(flat), finalMap);
});

test('flat-state adapter rejects map shadowing, candidates, absent versions, and tampering', async () => {
  const finalMap = await createRepresentativeBattleMapV2FinalFixture();
  await assert.rejects(
    () => battleMapV2ToFlatState(finalMap, { terrain: [] }),
    /cannot shadow/
  );
  await assert.rejects(
    () => battleMapV2ToFlatState(REPRESENTATIVE_BATTLE_MAP_V2_CANDIDATE),
    /validation failed/
  );
  await assert.rejects(
    () => battleMapV2FromFlatState({ terrain: [] }),
    /requires both version fields/
  );
  const flat = await battleMapV2ToFlatState(finalMap);
  const tampered = clone(flat);
  tampered.variants[0].variantIndex += 1;
  await assert.rejects(() => battleMapV2FromFlatState(tampered), /hash verification failed/);
});

test('only explicit legacy loading interprets missing versions as V1', () => {
  const unversioned = { terrainSeed: 7, terrain: [['grass']] };
  const legacy = loadLegacyFlatBattleState(unversioned);
  assert.equal(legacy.battleMapSchemaVersion, 1);
  assert.equal(legacy.terrainGenerationVersion, 1);
  assert.deepEqual(legacy.terrain, [['grass']]);
  assert.equal(Object.isFrozen(legacy.terrain), true);
  assert.throws(
    () => loadLegacyFlatBattleState({ battleMapSchemaVersion: 2, terrainGenerationVersion: 2 }),
    /only version 1/
  );
});

test('JSONB-style object-key reordering preserves all hashes and adapter round trip', async () => {
  const finalMap = await createRepresentativeBattleMapV2FinalFixture();
  const reordered = reverseObjectKeyOrder(JSON.parse(JSON.stringify(finalMap)));
  assert.equal(await verifyBattleMapV2Final(reordered), true);
  const flat = await battleMapV2ToFlatState(reordered, { battleId: 'jsonb' });
  const loaded = await battleMapV2FromFlatState(reverseObjectKeyOrder(flat));
  assert.deepEqual(loaded.diagnostics.hashes, finalMap.diagnostics.hashes);
});
