import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  refreshPostBattleSessionState,
  transitionFromBattleIfCurrent,
  waitForPostBattleSessionRefresh
} from '../BattleSessionState.js';

function createState(initial = {}) {
  const values = new Map(Object.entries(initial));
  const calls = [];
  let persistCount = 0;

  return {
    calls,
    get persistCount() { return persistCount; },
    get(key) { return values.get(key); },
    set(key, value) {
      values.set(key, value);
      calls.push([key, value]);
    },
    persist() { persistCount++; }
  };
}

describe('refreshPostBattleSessionState', () => {
  it('replaces stale gold and character experience before the next scene reads them', async () => {
    const staleLeader = { id: 11, name: 'Ellis', experience: 100, party_slot: 1 };
    const refreshedLeader = { ...staleLeader, experience: 145 };
    const refreshedAlly = { id: 12, name: 'Mira', experience: 75, party_slot: 2 };
    const state = createState({
      user: { id: 5, gold: 20 },
      gold: 20,
      characters: [staleLeader],
      activeCharacter: staleLeader
    });
    const requests = [];
    const game = {
      state,
      api: {
        async get(path) {
          requests.push(path);
          return { user: { id: 5, gold: 57 } };
        },
        async getCharacters() {
          requests.push('/characters');
          return { characters: [refreshedLeader, refreshedAlly] };
        }
      }
    };

    const result = await refreshPostBattleSessionState(game);

    assert.deepEqual(requests.sort(), ['/auth/me', '/characters']);
    assert.deepEqual(result, { userUpdated: true, charactersUpdated: true });
    assert.equal(state.get('user').gold, 57);
    assert.equal(state.get('gold'), 57);
    assert.equal(state.get('characters')[0].experience, 145);
    assert.strictEqual(state.get('activeCharacter'), refreshedLeader);
    assert.equal(state.persistCount, 1);
  });

  it('applies a refreshed character snapshot even when the account request fails', async () => {
    const staleLeader = { id: 11, experience: 100, party_slot: 1 };
    const refreshedLeader = { ...staleLeader, experience: 130 };
    const state = createState({
      user: { id: 5, gold: 20 },
      characters: [staleLeader],
      activeCharacter: staleLeader
    });
    const game = {
      state,
      api: {
        async get() { throw new Error('account unavailable'); },
        async getCharacters() { return { characters: [refreshedLeader] }; }
      }
    };

    const result = await refreshPostBattleSessionState(game);

    assert.deepEqual(result, { userUpdated: false, charactersUpdated: true });
    assert.equal(state.get('user').gold, 20);
    assert.equal(state.get('characters')[0].experience, 130);
    assert.strictEqual(state.get('activeCharacter'), refreshedLeader);
    assert.equal(state.persistCount, 0);
  });

  it('settles network failures without mutating the existing session snapshot', async () => {
    const user = { id: 5, gold: 20 };
    const leader = { id: 11, experience: 100, party_slot: 1 };
    const state = createState({
      user,
      gold: 20,
      characters: [leader],
      activeCharacter: leader
    });
    const game = {
      state,
      api: {
        async get() { throw new Error('offline'); },
        async getCharacters() { throw new Error('offline'); }
      }
    };

    const result = await refreshPostBattleSessionState(game);

    assert.deepEqual(result, { userUpdated: false, charactersUpdated: false });
    assert.strictEqual(state.get('user'), user);
    assert.strictEqual(state.get('characters')[0], leader);
    assert.equal(state.calls.length, 0);
  });
});

describe('waitForPostBattleSessionRefresh', () => {
  it('times out without waiting for never-settling snapshot requests', async () => {
    const never = new Promise(() => {});
    const state = createState({ user: { id: 5, gold: 20 } });
    let scheduledDelay = null;
    const game = {
      state,
      api: {
        get() { return never; },
        getCharacters() { return never; }
      }
    };

    const result = await waitForPostBattleSessionRefresh(game, {
      timeoutMs: 25,
      scheduleTimeout(callback, delay) {
        scheduledDelay = delay;
        queueMicrotask(callback);
        return 1;
      },
      cancelTimeout() {}
    });

    assert.equal(result.timedOut, true);
    assert.equal(scheduledDelay, 25);
    assert.equal(state.calls.length, 0);
  });

  it('allows a successful refresh to update the same session after timeout', async () => {
    let resolveUser;
    let resolveCharacters;
    let expireWait;
    const userRequest = new Promise(resolve => { resolveUser = resolve; });
    const characterRequest = new Promise(resolve => { resolveCharacters = resolve; });
    const staleLeader = { id: 11, experience: 100, party_slot: 1 };
    const refreshedLeader = { ...staleLeader, experience: 180 };
    const state = createState({
      user: { id: 5, gold: 20 },
      gold: 20,
      characters: [staleLeader],
      activeCharacter: staleLeader
    });
    const game = {
      state,
      api: {
        get() { return userRequest; },
        getCharacters() { return characterRequest; }
      }
    };

    const wait = waitForPostBattleSessionRefresh(game, {
      timeoutMs: 25,
      scheduleTimeout(callback) {
        expireWait = callback;
        return 1;
      },
      cancelTimeout() {}
    });
    await Promise.resolve();
    expireWait();
    const result = await wait;
    assert.equal(result.timedOut, true);

    resolveUser({ user: { id: 5, gold: 77 } });
    resolveCharacters({ characters: [refreshedLeader] });
    await result.completion;

    assert.equal(state.get('user').gold, 77);
    assert.equal(state.get('gold'), 77);
    assert.strictEqual(state.get('activeCharacter'), refreshedLeader);
  });

  it('observes a late refresh but does not restore state after the session changes', async () => {
    let resolveUser;
    let resolveCharacters;
    let expireWait;
    const userRequest = new Promise(resolve => { resolveUser = resolve; });
    const characterRequest = new Promise(resolve => { resolveCharacters = resolve; });
    const state = createState({
      user: { id: 5, gold: 20 },
      characters: [{ id: 11, experience: 100 }]
    });
    const game = {
      state,
      api: {
        get() { return userRequest; },
        getCharacters() { return characterRequest; }
      }
    };

    const wait = waitForPostBattleSessionRefresh(game, {
      timeoutMs: 25,
      scheduleTimeout(callback) {
        expireWait = callback;
        return 1;
      },
      cancelTimeout() {}
    });
    await Promise.resolve();
    expireWait();
    const result = await wait;
    assert.equal(result.timedOut, true);

    state.set('user', null);
    state.set('characters', []);
    resolveUser({ user: { id: 5, gold: 99 } });
    resolveCharacters({ characters: [{ id: 11, experience: 999 }] });
    await result.completion;

    assert.equal(state.get('user'), null);
    assert.deepEqual(state.get('characters'), []);
  });
});

describe('transitionFromBattleIfCurrent', () => {
  it('switches to the requested destination while battle is still current', () => {
    const battleScene = {};
    const transitions = [];
    const game = {
      scenes: {
        getCurrentScene: () => battleScene,
        switchTo: sceneName => transitions.push(sceneName)
      }
    };

    assert.equal(transitionFromBattleIfCurrent(game, battleScene, 'worldMap'), true);
    assert.deepEqual(transitions, ['worldMap']);
  });

  it('preserves a newer login or other scene transition', () => {
    const battleScene = {};
    const loginScene = {};
    const transitions = [];
    const game = {
      scenes: {
        getCurrentScene: () => loginScene,
        switchTo: sceneName => transitions.push(sceneName)
      }
    };

    assert.equal(transitionFromBattleIfCurrent(game, battleScene, 'worldMap'), false);
    assert.deepEqual(transitions, []);
  });
});
