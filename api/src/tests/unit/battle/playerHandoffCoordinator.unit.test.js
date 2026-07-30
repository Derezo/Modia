import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createPlayerHandoffCoordinator,
  DEFAULT_MAX_COMPLETED_NOTIFICATIONS
} from '../../../services/battle/playerHandoffCoordinator.js';

function playerBattle({
  battleId = 1,
  revision = 1,
  activeUnitId = 'player:1',
  status = 'active'
} = {}) {
  return {
    battleId,
    status,
    stateRevision: revision,
    state: {
      activeUnitId,
      units: [
        { id: 'player:1', type: 'player' },
        { id: 'player:2', type: 'player' },
        { id: 'enemy:1', type: 'enemy' }
      ]
    }
  };
}

describe('player handoff coordinator', () => {
  it('coalesces concurrent notifications and deduplicates sequential replays', async () => {
    const battle = playerBattle();
    let loads = 0;
    let notifications = 0;
    const coordinator = createPlayerHandoffCoordinator({
      loadBattle: async () => {
        loads++;
        return battle;
      },
      notifyPlayerTurn: async () => {
        notifications++;
      }
    });

    const expectedState = battle.state;
    const [first, concurrent] = await Promise.all([
      coordinator.notifyPlayerTurnIfCurrent(1, expectedState, 1),
      coordinator.notifyPlayerTurnIfCurrent(1, expectedState, 1)
    ]);
    const sequential =
      await coordinator.notifyPlayerTurnIfCurrent(1, expectedState, 1);

    assert.equal(loads, 2, 'concurrent callers share one load; replay reloads');
    assert.equal(notifications, 1);
    assert.equal(first.duplicate, false);
    assert.equal(concurrent.duplicate, false);
    assert.equal(sequential.duplicate, true);
  });

  it('does not cache a failed notification and allows an exact retry', async () => {
    const battle = playerBattle();
    let attempts = 0;
    const coordinator = createPlayerHandoffCoordinator({
      loadBattle: async () => battle,
      notifyPlayerTurn: async () => {
        attempts++;
        if (attempts === 1) throw new Error('delivery failed');
      }
    });

    await assert.rejects(
      coordinator.notifyPlayerTurnIfCurrent(1, battle.state, 1),
      /delivery failed/
    );
    const retry =
      await coordinator.notifyPlayerTurnIfCurrent(1, battle.state, 1);

    assert.equal(attempts, 2);
    assert.equal(retry.notified, true);
    assert.equal(retry.duplicate, false);
  });

  it('checks persisted actor freshness before completed-success deduplication', async () => {
    let authoritative = playerBattle();
    let notifications = 0;
    const coordinator = createPlayerHandoffCoordinator({
      loadBattle: async () => authoritative,
      notifyPlayerTurn: async () => {
        notifications++;
      }
    });

    await coordinator.notifyPlayerTurnIfCurrent(1, authoritative.state, 1);
    authoritative = playerBattle({ activeUnitId: 'player:2' });
    const staleActor = await coordinator.notifyPlayerTurnIfCurrent(
      1,
      playerBattle({ activeUnitId: 'player:1' }).state,
      1
    );
    authoritative = playerBattle({
      revision: 2,
      activeUnitId: 'player:2'
    });
    const nextRevision = await coordinator.notifyPlayerTurnIfCurrent(
      1,
      authoritative.state,
      2
    );

    assert.equal(staleActor.notified, false);
    assert.equal(staleActor.duplicate, false);
    assert.equal(nextRevision.notified, true);
    assert.equal(nextRevision.duplicate, false);
    assert.equal(notifications, 2);
  });

  it('prunes prior battle revisions and bounds completed success state', async () => {
    const battles = new Map();
    let notifications = 0;
    const coordinator = createPlayerHandoffCoordinator({
      loadBattle: async battleId => battles.get(battleId),
      notifyPlayerTurn: async () => {
        notifications++;
      }
    });

    const first = playerBattle({ battleId: 1 });
    battles.set(1, first);
    await coordinator.notifyPlayerTurnIfCurrent(1, first.state, 1);
    const advanced = playerBattle({ battleId: 1, revision: 2 });
    battles.set(1, advanced);
    await coordinator.notifyPlayerTurnIfCurrent(1, advanced.state, 2);
    battles.set(1, first);
    const prunedReplay =
      await coordinator.notifyPlayerTurnIfCurrent(1, first.state, 1);
    assert.equal(prunedReplay.duplicate, false);

    for (
      let battleId = 2;
      battleId <= DEFAULT_MAX_COMPLETED_NOTIFICATIONS + 1;
      battleId++
    ) {
      const battle = playerBattle({ battleId });
      battles.set(battleId, battle);
      await coordinator.notifyPlayerTurnIfCurrent(
        battleId,
        battle.state,
        battle.stateRevision
      );
    }

    const beforeEvictedReplay = notifications;
    const evictedBattle = battles.get(1);
    const evictedReplay = await coordinator.notifyPlayerTurnIfCurrent(
      1,
      evictedBattle.state,
      evictedBattle.stateRevision
    );
    assert.equal(evictedReplay.duplicate, false);
    assert.equal(notifications, beforeEvictedReplay + 1);
  });
});
