/**
 * Timed terminal transitions (coliseum turn timeout, disconnect abandonment)
 * pass the acting unit's team to checkBattleEnd so a PvP mutual knockout is
 * resolved against the team whose turn was forced to end.
 *
 * The acting unit here is on team 2 on purpose: checkBattleEnd's fallback
 * without actingTeamId awards team 2, so only a correctly passed team makes
 * team 1 the winner.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import battleWebsocket from '../../services/battleWebsocket.js';
import * as battleReconnection from '../../services/battleReconnection.js';
import battleStateRepository from '../../services/battle/BattleStateRepository.js';
import {
  setBattleTerminalCompletionHandler
} from '../../services/battle/BattleTerminalTransition.js';
import { skipPlayerTurn } from '../../services/coliseum/turnTimer.js';

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

const TEAM_2_PLAYER = 22;

/**
 * PvP state where both teams are down when team 2's turn is force-ended.
 *
 * advanceToNextActor stops as soon as at most one team is alive and
 * turn-start effects only damage the selected actor, so the turn advance
 * cannot itself produce a double KO today. The acting team is passed
 * defensively; this fixture seeds the wiped state directly so the
 * tie-break is exercised.
 */
function mutualKnockoutEnvelope(battleId, stateRevision = 4) {
  return {
    battleId,
    battleType: 'pvp_coliseum',
    status: 'active',
    stateRevision,
    player1Id: 11,
    player2Id: TEAM_2_PLAYER,
    state: {
      battleType: 'pvp_coliseum',
      activeUnitId: 'team2-a',
      activeUnitIndex: 1,
      units: [
        {
          id: 'team1-a',
          type: 'player',
          teamId: 1,
          ownerId: 11,
          hp: 0,
          maxHp: 100,
          ct: 100,
          agility: 10,
          statusEffects: []
        },
        {
          id: 'team2-a',
          type: 'player',
          teamId: 2,
          ownerId: TEAM_2_PLAYER,
          hp: 0,
          maxHp: 100,
          ct: 100,
          agility: 10,
          statusEffects: []
        }
      ]
    }
  };
}

describe('timed terminal transitions pass the acting team', () => {
  it('turn timeout: the timed-out team loses a PvP mutual knockout', async () => {
    const envelope = mutualKnockoutEnvelope(880);
    const completions = [];
    battleStateRepository.commitBattleState = async () => {
      throw new Error('terminal path must not commit an active state');
    };
    setBattleTerminalCompletionHandler(async payload => {
      completions.push(payload);
      return { stateRevision: payload.expectedRevision + 1 };
    });

    const result = await skipPlayerTurn(880, TEAM_2_PLAYER, false, envelope);

    assert.equal(result.outcome, 'terminal');
    assert.equal(completions.length, 1);
    assert.equal(completions[0].battleEndResult.status, 'ended');
    assert.equal(completions[0].battleEndResult.winningTeamId, 1);
    assert.equal(completions[0].reason, 'turn_timeout');
  });

  it('abandonment: the abandoning team loses a PvP mutual knockout', async () => {
    let envelope = mutualKnockoutEnvelope(881);
    const completions = [];

    globalThis.setTimeout = () => ({ unref() { return this; } });
    globalThis.clearTimeout = () => {};
    battleStateRepository.loadBattle = async () => envelope;
    battleStateRepository.commitBattleState = async command => {
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
    battleWebsocket.broadcastActionExecuted = () => {};
    battleWebsocket.broadcastTurnStart = () => {};
    setBattleTerminalCompletionHandler(async payload => {
      completions.push(payload);
      return { stateRevision: payload.expectedRevision + 1 };
    });

    await battleReconnection.handleDisconnect(881, TEAM_2_PLAYER, 'Team Two');
    const result = await battleReconnection.handleAbandonTimeout(
      881,
      TEAM_2_PLAYER
    );

    assert.equal(result.outcome, 'terminal');
    assert.equal(completions.length, 1);
    assert.equal(completions[0].battleEndResult.status, 'ended');
    assert.equal(completions[0].battleEndResult.winningTeamId, 1);
    assert.equal(completions[0].reason, 'disconnect_abandonment');
  });
});
