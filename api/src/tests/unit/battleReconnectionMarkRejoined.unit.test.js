/**
 * Unit tests for markRejoined in battleReconnection.js
 *
 * Tests that markRejoined correctly updates persisted state and broadcasts
 * player_reconnected when a player rejoins via WebSocket join_battle.
 *
 * Finding 4: cancelDisconnect (the join_battle reconnect path) leaves
 * state.disconnectedPlayers set and never broadcasts player_reconnected.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import battleWebsocket from '../../services/battleWebsocket.js';
import * as battleReconnection from '../../services/battleReconnection.js';
import battleStateRepository from '../../services/battle/BattleStateRepository.js';

const originalRepositoryMethods = {
  loadBattle: battleStateRepository.loadBattle,
  commitBattleState: battleStateRepository.commitBattleState
};
const originalWebsocketMethods = {
  broadcastStateUpdate: battleWebsocket.broadcastStateUpdate,
  broadcastPlayerDisconnected: battleWebsocket.broadcastPlayerDisconnected,
  broadcastPlayerReconnected: battleWebsocket.broadcastPlayerReconnected
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
  battleReconnection._clearAllTimeouts();
});

describe('battleReconnection.markRejoined', () => {
  it('should do nothing when player was not tracked as disconnected', async () => {
    const battleId = 123;
    const playerId = 456;
    const playerName = 'TestPlayer';

    let broadcastCalled = false;
    battleWebsocket.broadcastPlayerReconnected = () => {
      broadcastCalled = true;
    };

    const result = await battleReconnection.markRejoined(battleId, playerId, playerName);

    assert.strictEqual(result.cancelled, false, 'Should not cancel when not tracked');
    assert.strictEqual(result.committed, false, 'Should not commit when not tracked');
    assert.strictEqual(broadcastCalled, false, 'Should not broadcast when not tracked');
  });

  it('should commit reconnect and broadcast when player was disconnected', async () => {
    const battleId = 123;
    const playerId = 456;
    const playerName = 'TestPlayer';

    // Setup: First disconnect the player
    let envelope = {
      battleId,
      battleType: 'pve_coop',
      status: 'active',
      stateRevision: 1,
      state: {
        disconnectedPlayers: [],
        units: [
          { id: 'u1', type: 'player', ownerId: playerId, hp: 100 }
        ],
        activeUnitId: 'u1'
      }
    };

    let commitCalled = false;
    let commitType = null;
    let broadcastStateCalled = false;
    let broadcastReconnectedCalled = false;
    let broadcastReconnectedPlayerId = null;
    let broadcastReconnectedPlayerName = null;

    // Mock timeout to prevent actual timeout firing
    globalThis.setTimeout = (fn) => {
      return { unref() { return this; } };
    };
    globalThis.clearTimeout = () => {};

    battleStateRepository.loadBattle = async () => envelope;
    battleStateRepository.commitBattleState = async (command) => {
      commitCalled = true;
      commitType = command.commandType;
      envelope = {
        ...envelope,
        stateRevision: envelope.stateRevision + 1,
        state: structuredClone(command.flatState)
      };
      return {
        envelope,
        stateRevision: envelope.stateRevision,
        update: { stateRevision: envelope.stateRevision },
        idempotent: false
      };
    };
    battleWebsocket.broadcastStateUpdate = async () => {
      broadcastStateCalled = true;
    };
    battleWebsocket.broadcastPlayerDisconnected = () => {};
    battleWebsocket.broadcastPlayerReconnected = (bId, pId, pName) => {
      broadcastReconnectedCalled = true;
      broadcastReconnectedPlayerId = pId;
      broadcastReconnectedPlayerName = pName;
    };

    // Disconnect the player first
    await battleReconnection.handleDisconnect(battleId, playerId, playerName);

    // Reset tracking to verify markRejoined behavior
    commitCalled = false;
    commitType = null;
    broadcastStateCalled = false;

    // Now call markRejoined
    const result = await battleReconnection.markRejoined(battleId, playerId, playerName);

    assert.strictEqual(result.cancelled, true, 'Should cancel the disconnect tracking');
    assert.strictEqual(result.committed, true, 'Should commit the reconnect');
    assert.strictEqual(commitType, 'player_reconnect', 'Commit type should be player_reconnect');
    assert.strictEqual(broadcastStateCalled, true, 'Should broadcast state update');
    assert.strictEqual(broadcastReconnectedCalled, true, 'Should broadcast player_reconnected');
    assert.strictEqual(broadcastReconnectedPlayerId, playerId, 'Should broadcast correct player ID');
    assert.strictEqual(broadcastReconnectedPlayerName, playerName, 'Should broadcast correct player name');
  });

  it('should clear disconnectedPlayers from persisted state', async () => {
    const battleId = 123;
    const playerId = 456;
    const playerName = 'TestPlayer';

    let envelope = {
      battleId,
      battleType: 'pve_coop',
      status: 'active',
      stateRevision: 1,
      state: {
        disconnectedPlayers: [playerId],
        units: [
          { id: 'u1', type: 'player', ownerId: playerId, hp: 100 }
        ],
        activeUnitId: 'u1'
      }
    };

    let committedState = null;

    globalThis.setTimeout = () => ({ unref() { return this; } });
    globalThis.clearTimeout = () => {};

    battleStateRepository.loadBattle = async () => envelope;
    battleStateRepository.commitBattleState = async (command) => {
      committedState = command.flatState;
      envelope = {
        ...envelope,
        stateRevision: envelope.stateRevision + 1,
        state: structuredClone(command.flatState)
      };
      return {
        envelope,
        stateRevision: envelope.stateRevision,
        update: { stateRevision: envelope.stateRevision },
        idempotent: false
      };
    };
    battleWebsocket.broadcastStateUpdate = async () => {};
    battleWebsocket.broadcastPlayerDisconnected = () => {};
    battleWebsocket.broadcastPlayerReconnected = () => {};

    // First disconnect
    await battleReconnection.handleDisconnect(battleId, playerId, playerName);

    // Then rejoin
    await battleReconnection.markRejoined(battleId, playerId, playerName);

    assert.ok(committedState, 'Should have committed state');
    assert.ok(
      !committedState.disconnectedPlayers?.includes(playerId),
      'Player should be removed from disconnectedPlayers in committed state'
    );
  });

  it('should not broadcast when commit is idempotent (no-op)', async () => {
    const battleId = 123;
    const playerId = 456;
    const playerName = 'TestPlayer';

    let envelope = {
      battleId,
      battleType: 'pve_coop',
      status: 'active',
      stateRevision: 1,
      state: {
        disconnectedPlayers: [],
        units: [
          { id: 'u1', type: 'player', ownerId: playerId, hp: 100 }
        ],
        activeUnitId: 'u1'
      }
    };

    let broadcastReconnectedCalled = false;

    globalThis.setTimeout = () => ({ unref() { return this; } });
    globalThis.clearTimeout = () => {};

    battleStateRepository.loadBattle = async () => envelope;
    battleStateRepository.commitBattleState = async (command) => {
      // Player was already not in disconnectedPlayers, so this is idempotent
      return {
        envelope,
        stateRevision: envelope.stateRevision,
        update: null,
        idempotent: true
      };
    };
    battleWebsocket.broadcastStateUpdate = async () => {};
    battleWebsocket.broadcastPlayerDisconnected = () => {};
    battleWebsocket.broadcastPlayerReconnected = () => {
      broadcastReconnectedCalled = true;
    };

    // Disconnect first (to get into tracking)
    await battleReconnection.handleDisconnect(battleId, playerId, playerName);

    // Now call markRejoined - commit should be no-op since player wasn't actually
    // in the persisted disconnectedPlayers (edge case)
    const result = await battleReconnection.markRejoined(battleId, playerId, playerName);

    // cancelled should be true (in-memory tracking was cleared)
    // committed should be false (database commit was idempotent)
    assert.strictEqual(result.cancelled, true);
    assert.strictEqual(result.committed, false);
    assert.strictEqual(broadcastReconnectedCalled, false, 'Should not broadcast on idempotent commit');
  });
});
