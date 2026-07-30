import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import battleWebsocket from '../../services/battleWebsocket.js';
import * as battleReconnection from '../../services/battleReconnection.js';
import battleStateRepository from '../../services/battle/BattleStateRepository.js';
import {
  setBattleTerminalCompletionHandler
} from '../../services/battle/BattleTerminalTransition.js';

const originalRepositoryMethods = {
  loadBattle: battleStateRepository.loadBattle,
  commitBattleState: battleStateRepository.commitBattleState
};
const originalWebsocketMethods = {
  broadcastStateUpdate: battleWebsocket.broadcastStateUpdate,
  broadcastPlayerDisconnected: battleWebsocket.broadcastPlayerDisconnected,
  broadcastActionExecuted: battleWebsocket.broadcastActionExecuted,
  broadcastTurnStart: battleWebsocket.broadcastTurnStart
};
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;

afterEach(() => {
  battleStateRepository.loadBattle = originalRepositoryMethods.loadBattle;
  battleStateRepository.commitBattleState =
    originalRepositoryMethods.commitBattleState;
  Object.assign(battleWebsocket, originalWebsocketMethods);
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  setBattleTerminalCompletionHandler(null);
  battleReconnection._clearAllTimeouts();
});

describe('battle reconnection terminal abandonment', () => {
  it('hands last-team turn-start poison to completion without active commit or turn events', async () => {
    const battleId = 991;
    const abandoningPlayerId = 11;
    let envelope = {
      battleId,
      battleType: 'pve',
      status: 'active',
      stateRevision: 4,
      state: {
        battleType: 'pve',
        activeUnitId: 'player-a',
        activeUnitIndex: 0,
        units: [
          {
            id: 'player-a',
            type: 'player',
            teamId: 1,
            ownerId: abandoningPlayerId,
            hp: 100,
            maxHp: 100,
            ct: 100,
            agility: 10,
            statusEffects: []
          },
          {
            id: 'enemy-a',
            type: 'enemy',
            teamId: 2,
            ownerId: null,
            hp: 3,
            maxHp: 100,
            ct: 100,
            agility: 10,
            statusEffects: [
              { type: 'zodiac_poison', damagePercent: 0.03, duration: 1 }
            ]
          }
        ]
      }
    };
    const activeCommits = [];
    const presentationEvents = [];
    const completions = [];

    globalThis.setTimeout = () => ({ unref() { return this; } });
    globalThis.clearTimeout = () => {};
    battleStateRepository.loadBattle = async () => envelope;
    battleStateRepository.commitBattleState = async command => {
      activeCommits.push(command.commandType);
      assert.equal(command.commandType, 'player_disconnect');
      envelope = {
        ...envelope,
        stateRevision: envelope.stateRevision + 1,
        state: structuredClone(command.flatState)
      };
      return {
        envelope,
        stateRevision: envelope.stateRevision,
        update: { stateRevision: envelope.stateRevision }
      };
    };
    battleWebsocket.broadcastStateUpdate = async () => {};
    battleWebsocket.broadcastPlayerDisconnected = () => {};
    battleWebsocket.broadcastActionExecuted = () => {
      presentationEvents.push('action');
    };
    battleWebsocket.broadcastTurnStart = () => {
      presentationEvents.push('turn_start');
    };
    setBattleTerminalCompletionHandler(async payload => {
      completions.push(payload);
      return { stateRevision: payload.expectedRevision + 1 };
    });

    await battleReconnection.handleDisconnect(
      battleId,
      abandoningPlayerId,
      'Disconnected Hero'
    );
    const result = await battleReconnection.handleAbandonTimeout(
      battleId,
      abandoningPlayerId
    );

    assert.equal(result.outcome, 'terminal');
    assert.deepEqual(activeCommits, ['player_disconnect']);
    assert.deepEqual(presentationEvents, []);
    assert.equal(completions.length, 1);
    assert.equal(completions[0].expectedRevision, 5);
    assert.equal(completions[0].battleEndResult.winningTeamId, 1);
    assert.equal(completions[0].finalState.units[1].hp, 0);
    assert.deepEqual(completions[0].finalState.abandonedPlayers, [11]);
    assert.equal(completions[0].reason, 'disconnect_abandonment');
    assert.equal(completions[0].commandType, 'player_abandon_terminal');
  });
});

