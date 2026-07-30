import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import battleStateRepository from '../../services/battle/BattleStateRepository.js';
import {
  handleTurnTimeout,
  startTurnTimerIfCurrent,
  setCompleteMatchFn
} from '../../services/coliseum/turnTimer.js';
import {
  disconnectTracking,
  turnTimeoutCounts,
  turnTimers
} from '../../services/coliseum/constants.js';
import {
  setBattleTerminalCompletionHandler
} from '../../services/battle/BattleTerminalTransition.js';

const originalLoadBattle = battleStateRepository.loadBattle;
const originalCommitBattleState = battleStateRepository.commitBattleState;

function createEnvelope({ terminalAtTurnStart = false } = {}) {
  return {
    battleId: 870,
    battleType: 'pve',
    status: 'active',
    stateRevision: 4,
    player1Id: 11,
    player2Id: 22,
    state: {
      battleType: 'pve',
      activeUnitId: 'player-a',
      activeUnitIndex: 0,
      units: [
        {
          id: 'player-a',
          name: 'Player A',
          type: 'player',
          teamId: 1,
          ownerId: 11,
          hp: 100,
          maxHp: 100,
          ct: 100,
          agility: 10,
          statusEffects: []
        },
        {
          id: 'enemy-a',
          name: 'Enemy A',
          type: 'enemy',
          teamId: 2,
          ownerId: 22,
          hp: terminalAtTurnStart ? 3 : 100,
          maxHp: 100,
          ct: 100,
          agility: 10,
          statusEffects: terminalAtTurnStart
            ? [{ type: 'zodiac_poison', damagePercent: 0.03, duration: 1 }]
            : []
        }
      ]
    }
  };
}

function installOldTimer(oldTimerId, { isPvE = true } = {}) {
  turnTimers.set(870, {
    timerId: oldTimerId,
    playerId: 11,
    isPvE,
    startTime: Date.now()
  });
}

afterEach(() => {
  battleStateRepository.loadBattle = originalLoadBattle;
  battleStateRepository.commitBattleState = originalCommitBattleState;
  setBattleTerminalCompletionHandler(null);
  setCompleteMatchFn(null);
  turnTimers.clear();
  turnTimeoutCounts.clear();
  disconnectTracking.clear();
});

describe('turn timeout concurrency', () => {
  it('does not transition when its timer generation is replaced during state load', async () => {
    const oldTimerId = { id: 'old-loading' };
    const successorTimerId = { id: 'successor-loading' };
    const envelope = createEnvelope();
    let resolveLoad;
    let commitCalled = false;
    installOldTimer(oldTimerId);
    turnTimeoutCounts.set(870, { 11: 1 });
    battleStateRepository.loadBattle = () => new Promise(resolve => {
      resolveLoad = resolve;
    });
    battleStateRepository.commitBattleState = async () => {
      commitCalled = true;
      throw new Error('commit must not be reached');
    };

    const pending = handleTurnTimeout(870, 11, true, oldTimerId);
    await Promise.resolve();
    turnTimers.set(870, {
      timerId: successorTimerId,
      playerId: 11,
      isPvE: true,
      startTime: Date.now()
    });
    resolveLoad(envelope);

    const result = await pending;
    assert.equal(result.outcome, 'stale_timer');
    assert.equal(commitCalled, false);
    assert.equal(turnTimeoutCounts.get(870)[11], 1);
    assert.equal(turnTimers.get(870).timerId, successorTimerId);
  });

  it('does not count a timeout or cancel the successor timer when active CAS loses', async () => {
    const oldTimerId = { id: 'old' };
    const successorTimerId = { id: 'successor' };
    const envelope = createEnvelope();
    installOldTimer(oldTimerId);
    turnTimeoutCounts.set(870, { 11: 1 });
    battleStateRepository.loadBattle = async () => envelope;
    battleStateRepository.commitBattleState = async () => {
      turnTimers.set(870, {
        timerId: successorTimerId,
        playerId: 11,
        isPvE: true,
        startTime: Date.now()
      });
      const error = new Error('newer action committed first');
      error.code = 'BATTLE_STATE_CONFLICT';
      throw error;
    };

    const result = await handleTurnTimeout(870, 11, true, oldTimerId);

    assert.equal(result.outcome, 'stale_transition');
    assert.equal(turnTimeoutCounts.get(870)[11], 1);
    assert.equal(turnTimers.get(870).timerId, successorTimerId);

    const replay = await handleTurnTimeout(870, 11, true, oldTimerId);
    assert.equal(replay.outcome, 'stale_timer');
    assert.equal(turnTimeoutCounts.get(870)[11], 1);
    assert.equal(turnTimers.get(870).timerId, successorTimerId);
  });

  it('does not clean up a successor timer when terminal completion loses CAS', async () => {
    const oldTimerId = { id: 'old-terminal' };
    const successorTimerId = { id: 'successor-terminal' };
    const envelope = createEnvelope({ terminalAtTurnStart: true });
    installOldTimer(oldTimerId);
    turnTimeoutCounts.set(870, { 11: 1 });
    battleStateRepository.loadBattle = async () => envelope;
    setBattleTerminalCompletionHandler(async () => {
      turnTimers.set(870, {
        timerId: successorTimerId,
        playerId: 11,
        isPvE: true,
        startTime: Date.now()
      });
      const error = new Error('terminal snapshot is stale');
      error.code = 'BATTLE_STATE_CONFLICT';
      throw error;
    });

    const result = await handleTurnTimeout(870, 11, true, oldTimerId);

    assert.equal(result.outcome, 'stale_transition');
    assert.equal(turnTimeoutCounts.get(870)[11], 1);
    assert.equal(turnTimers.get(870).timerId, successorTimerId);
  });

  it('does not trigger an early forfeit when revision-constrained completion loses', async () => {
    const oldTimerId = { id: 'old-forfeit' };
    const successorTimerId = { id: 'successor-forfeit' };
    const envelope = {
      ...createEnvelope(),
      battleType: 'pvp_coliseum',
      state: {
        ...createEnvelope().state,
        battleType: 'pvp_coliseum'
      }
    };
    installOldTimer(oldTimerId, { isPvE: false });
    turnTimeoutCounts.set(870, { 11: 2 });
    battleStateRepository.loadBattle = async () => envelope;
    setCompleteMatchFn(async (
      battleId,
      winnerId,
      loserId,
      reason,
      applyPenalty,
      options
    ) => {
      assert.equal(battleId, 870);
      assert.equal(winnerId, 22);
      assert.equal(loserId, 11);
      assert.equal(reason, 'timeout_forfeit');
      assert.equal(applyPenalty, true);
      assert.equal(options.expectedRevision, 4);
      turnTimers.set(870, {
        timerId: successorTimerId,
        playerId: 11,
        isPvE: false,
        startTime: Date.now()
      });
      const error = new Error('forfeit snapshot is stale');
      error.code = 'BATTLE_STATE_CONFLICT';
      throw error;
    });

    const result = await handleTurnTimeout(870, 11, false, oldTimerId);

    assert.equal(result.outcome, 'stale_transition');
    assert.equal(turnTimeoutCounts.get(870)[11], 2);
    assert.equal(turnTimers.get(870).timerId, successorTimerId);
  });

  it('does not install delayed grace after the captured turn advances', async () => {
    const advancedEnvelope = createEnvelope();
    advancedEnvelope.stateRevision = 5;
    advancedEnvelope.state.activeUnitId = 'enemy-a';
    battleStateRepository.loadBattle = async () => advancedEnvelope;

    const result = await startTurnTimerIfCurrent(870, 11, true, 4);

    assert.deepEqual(result, {
      installed: false,
      reason: 'stale_revision'
    });
    assert.equal(turnTimers.has(870), false);
  });

  it('preserves a successor timer installed while a grace state read is pending', async () => {
    const successorTimerId = { id: 'successor-during-grace-load' };
    const envelope = createEnvelope();
    let resolveLoad;
    battleStateRepository.loadBattle = () => new Promise(resolve => {
      resolveLoad = resolve;
    });

    const pending = startTurnTimerIfCurrent(870, 11, true, 4);
    await Promise.resolve();
    turnTimers.set(870, {
      timerId: successorTimerId,
      playerId: 22,
      isPvE: true,
      startTime: Date.now()
    });
    resolveLoad(envelope);

    const result = await pending;
    assert.deepEqual(result, {
      installed: false,
      reason: 'timer_already_active'
    });
    assert.equal(turnTimers.get(870).timerId, successorTimerId);
  });
});
