/**
 * Deterministic guard for replaying a terminal (victory) battle action.
 *
 * When a battle-ending action is retried with the same commandId after the
 * rewards already committed, distributeRewards takes its idempotent path and
 * handleBattleEnd returns a completion summary. The route must replay the
 * stored command receipt, not that summary: the summary has no battleId or
 * map reference, so building the V3 update from it threw and the retry
 * answered 500. The concurrent integration test only reaches this in a race.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  createMinimalBattleMapV3FinalFixture
} from '../../../../shared/battleMap/index.js';
import { createBattleMutableStateV1 } from '../../../../shared/battleStateProtocol.js';
import battleStateRepository from '../../services/battle/BattleStateRepository.js';
import { distributeRewards } from '../../services/battleRewardService.js';
import {
  createBattleActionReplayStateTransport,
  getTerminalReplayReceipt
} from '../../services/battle/BattleActionTransport.js';

const originalLoadBattle = battleStateRepository.loadBattle;
const originalFindCommandReceipt = battleStateRepository.findCommandReceipt;

afterEach(() => {
  battleStateRepository.loadBattle = originalLoadBattle;
  battleStateRepository.findCommandReceipt = originalFindCommandReceipt;
});

async function completedV3Battle() {
  const map = await createMinimalBattleMapV3FinalFixture();
  const mutableState = createBattleMutableStateV1({
    turn: 5,
    units: [{ id: 'player:41', type: 'player', name: 'Scout', hp: 12, tileX: 2, tileY: 3 }]
  });
  return {
    battleId: 702,
    battleMapSchemaVersion: map.battleMapSchemaVersion,
    terrainGenerationVersion: map.terrainGenerationVersion,
    fullHash: map.hashes.fullHash,
    map,
    mutableState,
    stateRevision: 8,
    status: 'victory',
    rewards: { gold: 10, experience: 20, items: [], appliedBonuses: [] },
    isAdvancementBattle: false
  };
}

describe('terminal battle action replay', () => {
  it('replays the stored receipt as a V3 update when rewards already committed', async () => {
    const battle = await completedV3Battle();
    // What the command log stored for the original victory action
    const storedReceipt = Object.freeze({
      battleId: battle.battleId,
      battleMapSchemaVersion: battle.battleMapSchemaVersion,
      terrainGenerationVersion: battle.terrainGenerationVersion,
      fullHash: battle.fullHash,
      baseStateRevision: 7,
      stateRevision: 8,
      mutableState: battle.mutableState,
      replayMetadata: { battleStatus: 'victory', actionResult: { success: true } },
      idempotent: true
    });
    battleStateRepository.loadBattle = async () => battle;
    battleStateRepository.findCommandReceipt = async () => storedReceipt;

    const distributed = await distributeRewards(
      9,
      {
        gold: 10,
        experience: 20,
        droppedItems: [],
        items: [],
        players: [{ id: 41, type: 'player', ownerId: 9 }]
      },
      battle.battleId,
      {
        finalState: null,
        expectedRevision: 7,
        client: { query: async () => ({ rows: [] }) },
        battleCommand: {
          commandType: 'battle_action',
          idempotencyKey: 'cmd-victory-1',
          idempotencyRequest: { battleId: String(battle.battleId) }
        }
      }
    );
    assert.equal(distributed.idempotent, true);
    assert.strictEqual(distributed.commandReceipt, storedReceipt);

    // handleBattleEnd's completion summary carries the receipt alongside
    // fields that are not a receipt
    const completion = {
      rewards: distributed.rewards,
      state: {},
      stateRevision: storedReceipt.stateRevision,
      idempotent: true,
      replayMetadata: storedReceipt.replayMetadata,
      commandReceipt: distributed.commandReceipt
    };

    const replay = createBattleActionReplayStateTransport({
      battle,
      receipt: getTerminalReplayReceipt(completion)
    });
    assert.equal(replay.update.battleId, battle.battleId);
    assert.equal(replay.update.stateRevision, 8);
    assert.equal(replay.update.fullHash, battle.fullHash);

    // The summary itself is not replayable (the old 500)
    assert.throws(() => createBattleActionReplayStateTransport({ battle, receipt: completion }));
  });
});
