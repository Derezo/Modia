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

  it('offers an enabled shrine blessing action when the cooldown is clear', () => {
    const actions = buildAvailableNodeActions({
      node_type: 'shrine',
      features: [],
      shrine_available: true,
      shrine_cooldown_until: null
    });

    assert.deepEqual(actions, [{
      type: 'visit_shrine',
      name: 'Receive Blessing',
      enabled: true,
      cooldown_until: null
    }]);
  });

  it('keeps a cooldowned shrine visible with its authoritative timing', () => {
    const cooldownUntil = new Date('2026-07-29T18:00:00.000Z');
    const actions = buildAvailableNodeActions({
      node_type: 'shrine',
      features: [],
      shrine_available: false,
      shrine_cooldown_until: cooldownUntil
    });

    assert.deepEqual(actions, [{
      type: 'visit_shrine',
      name: 'Receive Blessing',
      enabled: false,
      cooldown_until: cooldownUntil
    }]);
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
