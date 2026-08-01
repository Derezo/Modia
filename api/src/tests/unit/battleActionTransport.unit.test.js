import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createMinimalBattleMapV3FinalFixture
} from '../../../../shared/battleMap/index.js';
import {
  createBattleMutableStateUpdateV1,
  createBattleMutableStateV1
} from '../../../../shared/battleStateProtocol.js';
import {
  createBattleActionProcessingState,
  createBattleActionReplayStateTransport,
  createBattleActionStateTransport
} from '../../services/battle/BattleActionTransport.js';

async function v3Battle() {
  const map = await createMinimalBattleMapV3FinalFixture();
  const mutableState = createBattleMutableStateV1({
    turn: 2,
    units: [{
      id: 'player:1',
      type: 'player',
      name: 'Scout',
      hp: 20,
      tileX: 2,
      tileY: 3
    }]
  });
  return {
    battleId: 71,
    battleMapSchemaVersion: map.battleMapSchemaVersion,
    terrainGenerationVersion: map.terrainGenerationVersion,
    fullHash: map.hashes.fullHash,
    map,
    mutableState,
    state: { ...map, ...mutableState }
  };
}

function updateFor(battle, mutableState = battle.mutableState) {
  return createBattleMutableStateUpdateV1({
    battleId: battle.battleId,
    battleMapSchemaVersion: battle.battleMapSchemaVersion,
    terrainGenerationVersion: battle.terrainGenerationVersion,
    fullHash: battle.fullHash,
    baseStateRevision: 3,
    stateRevision: 4,
    mutableState
  });
}

describe('BattleMapV3 action hot path', () => {
  it('clones mutable combat data while reusing the verified frozen map', async () => {
    const battle = await v3Battle();
    const processingState = createBattleActionProcessingState(battle);

    assert.strictEqual(processingState.playableMask, battle.map.playableMask);
    assert.strictEqual(processingState.hashes, battle.map.hashes);
    assert.notStrictEqual(processingState.units, battle.mutableState.units);

    processingState.units[0].hp = 1;
    assert.equal(battle.mutableState.units[0].hp, 20);
    assert.equal(Object.isFrozen(processingState.playableMask), true);
  });

  it('returns only a revisioned mutable update for a V3 action', async () => {
    const battle = await v3Battle();
    const update = updateFor(battle);
    const payload = createBattleActionStateTransport({
      battle,
      state: battle.state,
      update
    });

    assert.deepEqual(payload, { update });
    assert.equal(payload.state, undefined);
    assert.equal(JSON.stringify(payload).includes('playableMask'), false);
    assert.ok(
      Buffer.byteLength(JSON.stringify(payload)) <
        Buffer.byteLength(JSON.stringify({ state: battle.state })) / 2,
      'the mutable action response should be substantially smaller than the V3 flat state'
    );
  });

  it('builds the same bounded transport for an idempotent V3 replay', async () => {
    const battle = await v3Battle();
    const update = updateFor(battle);
    const payload = createBattleActionReplayStateTransport({
      battle,
      state: battle.state,
      receipt: update
    });

    assert.deepEqual(payload, { update });
    assert.equal(payload.state, undefined);
  });

  it('fails closed when a V3 update references another map', async () => {
    const battle = await v3Battle();
    const wrongUpdate = createBattleMutableStateUpdateV1({
      ...updateFor(battle),
      fullHash: `sha256:${'f'.repeat(64)}`
    });

    assert.throws(
      () => createBattleActionStateTransport({
        battle,
        state: battle.state,
        update: wrongUpdate
      }),
      /does not match its authoritative map envelope/
    );
  });

  it('retains legacy flat-state responses', () => {
    const state = { units: [{ id: 1 }] };
    assert.deepEqual(
      createBattleActionStateTransport({
        battle: { battleMapSchemaVersion: 2 },
        state,
        update: null
      }),
      { state }
    );
  });
});
