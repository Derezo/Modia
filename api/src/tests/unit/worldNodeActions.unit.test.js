import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildAvailableNodeActions } from '../../routes/world/navigation.js';

describe('buildAvailableNodeActions', () => {
  it('offers a claim action for an unclaimed chest with no generated features', () => {
    const actions = buildAvailableNodeActions({
      node_type: 'chest',
      features: [],
      chest_claimed: false
    });

    assert.deepEqual(actions, [
      { type: 'claim_chest', name: 'Claim Treasure' }
    ]);
  });

  it('does not offer a claim action after the chest has been claimed', () => {
    const actions = buildAvailableNodeActions({
      node_type: 'chest',
      features: [],
      chest_claimed: true
    });

    assert.deepEqual(actions, []);
  });

  it('preserves generated feature and battle actions for other node types', () => {
    const featureActions = buildAvailableNodeActions({
      node_type: 'town',
      features: ['marketplace', 'tavern']
    });
    const battleActions = buildAvailableNodeActions({
      node_type: 'forest',
      features: []
    });

    assert.deepEqual(featureActions, [
      { type: 'feature', name: 'marketplace' },
      { type: 'feature', name: 'tavern' }
    ]);
    assert.deepEqual(battleActions, [
      { type: 'battle', name: 'Battle' }
    ]);
  });
});
