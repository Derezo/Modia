/**
 * Coliseum disconnect / reconnect forfeit timer (Finding 57)
 *
 * A player who reconnects must never be forfeited by the 5-minute
 * disconnect timer, including when the reconnect lands before the
 * pvp_disconnects insert has resolved.
 *
 * Runs turnTimer in-process against the dev database (recordDisconnect
 * needs a real user row). Timers are mocked; battleStateRepository.loadBattle
 * is spied on because the forfeit callback's first step is to reload the
 * battle, so a loadBattle call after the forfeit delay means a forfeit ran.
 */
import { describe, it, before, after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { createTestContext, query } from '../testHelper.js';
import {
  handlePlayerDisconnect,
  handlePlayerReconnect
} from '../../services/coliseum/turnTimer.js';
import {
  disconnectTracking,
  DISCONNECT_FORFEIT_TIME
} from '../../services/coliseum/constants.js';
import battleStateRepository from '../../services/battle/BattleStateRepository.js';

// Battle ids far outside real data; loadBattle is stubbed anyway.
let nextBattleId = 900000000 + Math.floor(Math.random() * 1000000);

async function waitForDisconnectRow(userId, count) {
  for (let i = 0; i < 100; i++) {
    const rows = await query(
      'SELECT COUNT(*)::int AS n FROM pvp_disconnects WHERE user_id = $1',
      [userId]
    );
    if (rows.rows[0].n >= count) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('pvp_disconnects row not written');
}

// Let the recordDisconnect .then continuation run after the row exists
async function flushMicrotasks() {
  for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
}

describe('coliseum disconnect forfeit timer', () => {
  const ctx = createTestContext();
  let user;
  let loadCalls;

  before(async () => {
    user = await ctx.createUser();
  });

  afterEach(() => {
    mock.timers.reset();
    mock.restoreAll();
  });

  after(async () => {
    await query('DELETE FROM pvp_disconnects WHERE user_id = $1', [user.userId]);
    await ctx.cleanup();
  });

  function stubBattleLoads() {
    loadCalls = [];
    mock.method(battleStateRepository, 'loadBattle', async (...args) => {
      loadCalls.push(args);
      const error = new Error('not found');
      error.code = 'BATTLE_NOT_FOUND';
      throw error;
    });
  }

  it('does not forfeit when the reconnect lands before the disconnect insert resolves', async () => {
    const battleId = nextBattleId++;
    stubBattleLoads();
    mock.timers.enable({ apis: ['setTimeout'] });

    handlePlayerDisconnect(battleId, user.userId);
    handlePlayerReconnect(battleId, user.userId);
    await waitForDisconnectRow(user.userId, 1);
    await flushMicrotasks();

    const entry = disconnectTracking.get(battleId)[user.userId];
    assert.equal(entry.reconnected, true);
    assert.equal(entry.timerId, null, 'no forfeit timer armed');

    const loadsBefore = loadCalls.length;
    mock.timers.tick(DISCONNECT_FORFEIT_TIME + 1000);
    await flushMicrotasks();
    assert.equal(loadCalls.length, loadsBefore, 'forfeit callback never ran');
    disconnectTracking.delete(battleId);
  });

  it('cancels an armed forfeit timer on reconnect', async () => {
    const battleId = nextBattleId++;
    stubBattleLoads();
    mock.timers.enable({ apis: ['setTimeout'] });

    handlePlayerDisconnect(battleId, user.userId);
    await waitForDisconnectRow(user.userId, 2);
    await flushMicrotasks();
    assert.notEqual(disconnectTracking.get(battleId)[user.userId].timerId, null, 'timer armed');

    handlePlayerReconnect(battleId, user.userId);
    const loadsBefore = loadCalls.length;
    mock.timers.tick(DISCONNECT_FORFEIT_TIME + 1000);
    await flushMicrotasks();
    assert.equal(loadCalls.length, loadsBefore, 'forfeit callback never ran');
    disconnectTracking.delete(battleId);
  });

  it('still forfeits a player who stays disconnected', async () => {
    const battleId = nextBattleId++;
    stubBattleLoads();
    mock.timers.enable({ apis: ['setTimeout'] });

    handlePlayerDisconnect(battleId, user.userId);
    await waitForDisconnectRow(user.userId, 3);
    await flushMicrotasks();

    mock.timers.tick(DISCONNECT_FORFEIT_TIME + 1000);
    await flushMicrotasks();
    assert.ok(
      loadCalls.some(([id, options]) => id === battleId && options?.requireActive === true),
      'forfeit callback reloaded the battle'
    );
    disconnectTracking.delete(battleId);
  });

  it('leaves the turn-timer restart to the HTTP reconnect grace period when asked', async () => {
    const battleId = nextBattleId++;
    stubBattleLoads();
    mock.timers.enable({ apis: ['setTimeout'] });

    handlePlayerDisconnect(battleId, user.userId);
    await waitForDisconnectRow(user.userId, 4);
    await flushMicrotasks();

    // battleReconnection.handleReconnect: cancel the forfeit only
    const loadsBefore = loadCalls.length;
    handlePlayerReconnect(battleId, user.userId, { restartTimer: false });
    await flushMicrotasks();
    assert.equal(disconnectTracking.get(battleId)[user.userId].reconnected, true);
    assert.equal(loadCalls.length, loadsBefore, 'no immediate turn-timer restart (no battle reload)');

    mock.timers.tick(DISCONNECT_FORFEIT_TIME + 1000);
    await flushMicrotasks();
    assert.equal(loadCalls.length, loadsBefore, 'and no forfeit');
    disconnectTracking.delete(battleId);
  });

  it('restarts the turn timer immediately by default (WebSocket rejoin)', async () => {
    const battleId = nextBattleId++;
    stubBattleLoads();
    mock.timers.enable({ apis: ['setTimeout'] });

    handlePlayerDisconnect(battleId, user.userId);
    await waitForDisconnectRow(user.userId, 5);
    await flushMicrotasks();

    const loadsBefore = loadCalls.length;
    handlePlayerReconnect(battleId, user.userId);
    await flushMicrotasks();
    assert.ok(
      loadCalls.slice(loadsBefore).some(([id, options]) => id === battleId && options?.requireActive === true),
      'reloaded the battle to restart the timer'
    );
    disconnectTracking.delete(battleId);
  });
});

