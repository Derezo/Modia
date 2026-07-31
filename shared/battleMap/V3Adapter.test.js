import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BATTLE_MAP_V3_FLAT_FIELDS,
  battleMapV3FromFlatState,
  battleMapV3ToFlatState,
  createMinimalBattleMapV3FinalFixture,
  splitBattleMapV3FlatState
} from './index.js';

test('BattleMapV3 flat adapter preserves a verified immutable map and mutable state', async () => {
  const map = await createMinimalBattleMapV3FinalFixture();
  const mutableState = {
    turn: 3,
    units: [{ id: 'player:1', hp: 10 }]
  };
  const flat = await battleMapV3ToFlatState(map, mutableState);
  const split = await splitBattleMapV3FlatState(flat);

  assert.equal(Object.isFrozen(flat), true);
  assert.equal(Object.isFrozen(split.map), true);
  assert.equal(split.map.hashes.fullHash, map.hashes.fullHash);
  assert.deepEqual(split.mutableState, mutableState);
  assert.deepEqual(await battleMapV3FromFlatState(flat), split.map);
  assert.ok(BATTLE_MAP_V3_FLAT_FIELDS.includes('renderMask'));
  assert.ok(BATTLE_MAP_V3_FLAT_FIELDS.includes('hashes'));
});

test('BattleMapV3 flat adapter rejects shadowing, crossed versions, and hash tampering', async () => {
  const map = await createMinimalBattleMapV3FinalFixture();

  await assert.rejects(
    battleMapV3ToFlatState(map, { playableMask: [] }),
    /cannot shadow immutable BattleMapV3 data/
  );

  const crossed = { ...map, terrainGenerationVersion: 2 };
  await assert.rejects(
    battleMapV3FromFlatState(crossed),
    /Flat state is not BattleMapV3/
  );

  const tampered = structuredClone(map);
  tampered.playableMask[0][0] = false;
  await assert.rejects(
    battleMapV3FromFlatState(tampered),
    /hash verification failed/
  );
});
