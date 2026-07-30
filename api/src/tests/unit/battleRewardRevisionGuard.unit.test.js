import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import battleStateRepository from '../../services/battle/BattleStateRepository.js';
import { distributeRewards } from '../../services/battleRewardService.js';

const originalLoadBattle = battleStateRepository.loadBattle;
const originalCompleteBattle = battleStateRepository.completeBattle;

afterEach(() => {
  battleStateRepository.loadBattle = originalLoadBattle;
  battleStateRepository.completeBattle = originalCompleteBattle;
});

describe('PvE reward revision guard', () => {
  it('rejects a stale terminal snapshot before rewards or state can commit', async () => {
    const latestEnvelope = {
      battleId: 701,
      stateRevision: 12,
      status: 'active',
      rewards: null,
      isAdvancementBattle: false,
      mutableState: {
        units: [{ id: 41, type: 'player', ownerId: 9 }]
      }
    };
    let completed = false;
    battleStateRepository.loadBattle = async () => latestEnvelope;
    battleStateRepository.completeBattle = async () => {
      completed = true;
      assert.fail('a stale terminal snapshot must not reach completion');
    };

    await assert.rejects(
      distributeRewards(
        9,
        {
          gold: 10,
          experience: 20,
          droppedItems: [],
          items: [],
          players: [{ id: 41, type: 'player', ownerId: 9 }]
        },
        701,
        {
          finalState: {
            units: [{ id: 41, type: 'player', ownerId: 9 }]
          },
          expectedRevision: 11,
          client: { query: async () => ({ rows: [] }) }
        }
      ),
      error => {
        assert.equal(error.code, 'BATTLE_STATE_CONFLICT');
        assert.equal(error.expectedRevision, 11);
        assert.equal(error.actualRevision, 12);
        return true;
      }
    );
    assert.equal(completed, false);
  });
});
