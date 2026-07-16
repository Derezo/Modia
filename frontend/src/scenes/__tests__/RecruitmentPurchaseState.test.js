import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  RecruitmentPurchaseLifecycle,
  synchronizeRecruitPurchaseState
} from '../recruitment/RecruitmentPurchaseState.js';

function createState(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get(key) { return values.get(key); },
    set(key, value) { values.set(key, value); }
  };
}

describe('RecruitmentPurchaseLifecycle', () => {
  it('rejects duplicate submits within one scene entry', () => {
    const lifecycle = new RecruitmentPurchaseLifecycle();

    assert.equal(lifecycle.beginPurchase(), null);
    lifecycle.activateEntry();
    const first = lifecycle.beginPurchase();

    assert.ok(first);
    assert.equal(lifecycle.inProgress, true);
    assert.equal(lifecycle.beginPurchase(), null);
    assert.equal(lifecycle.isCurrent(first), true);
    assert.equal(lifecycle.finishPurchase(first), true);
    assert.equal(lifecycle.inProgress, false);
  });

  it('invalidates stale completions and frees a fresh entry from a hung request', () => {
    const lifecycle = new RecruitmentPurchaseLifecycle();
    lifecycle.activateEntry();
    const stalePurchase = lifecycle.beginPurchase();

    lifecycle.invalidateEntry();
    lifecycle.activateEntry();
    const currentPurchase = lifecycle.beginPurchase();

    assert.ok(currentPurchase);
    assert.notEqual(currentPurchase.generation, stalePurchase.generation);
    assert.equal(lifecycle.isCurrent(stalePurchase), false);
    assert.equal(lifecycle.finishPurchase(stalePurchase), false);
    assert.equal(lifecycle.inProgress, true);
    assert.equal(lifecycle.isCurrent(currentPurchase), true);
  });
});

describe('synchronizeRecruitPurchaseState', () => {
  it('updates both gold caches and appends the recruit without switching leaders', () => {
    const leader = { id: 1, name: 'Leader', party_slot: 1 };
    const recruit = { id: 2, name: 'Ellis', party_slot: 2 };
    const state = createState({
      user: { id: 7, username: 'player', gold: 100 },
      gold: 100,
      characters: [leader],
      activeCharacter: leader
    });

    synchronizeRecruitPurchaseState(state, {
      remainingGold: 60,
      character: recruit
    });

    assert.deepEqual(state.get('user'), { id: 7, username: 'player', gold: 60 });
    assert.equal(state.get('gold'), 60);
    assert.deepEqual(state.get('characters'), [leader, recruit]);
    assert.equal(state.get('activeCharacter'), leader);
  });

  it('replaces an existing cached character and refreshes it when active', () => {
    const staleRecruit = { id: 2, name: 'Ellis', level: 1 };
    const refreshedRecruit = { id: 2, name: 'Ellis', level: 2 };
    const state = createState({
      characters: [staleRecruit],
      activeCharacter: staleRecruit
    });

    synchronizeRecruitPurchaseState(state, { character: refreshedRecruit });

    assert.deepEqual(state.get('characters'), [refreshedRecruit]);
    assert.equal(state.get('activeCharacter'), refreshedRecruit);
  });

  it('uses the recruited character when no active character is cached', () => {
    const recruit = { id: 2, name: 'Ellis' };
    const state = createState();

    synchronizeRecruitPurchaseState(state, { character: recruit });

    assert.deepEqual(state.get('characters'), [recruit]);
    assert.equal(state.get('activeCharacter'), recruit);
  });
});
