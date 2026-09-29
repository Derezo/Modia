/**
 * getStatusStatMultiplier falls back to STATUS_EFFECT_REGISTRY only when an
 * effect has no modifiers object. A partial explicit object (NPC defense_up
 * = { defense: 1.3 }) must not also pick up the registry's magicDefense 1.2.
 * Observed through the (deterministic) defenseReduction of the damage calcs.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  calculatePhysicalDamage,
  calculateMagicalDamage
} from '../../../services/battle/damageCalculator.js';

const attacker = { strength: 50, intelligence: 50, luck: 0, statusEffects: [] };
const defender = statusEffects => ({
  vitality: 40, defense: 20, intelligence: 40, magicDefense: 20, luck: 0, statusEffects
});

const magicReduction = effects =>
  calculateMagicalDamage(attacker, defender(effects), 100).defenseReduction;
const physicalReduction = effects =>
  calculatePhysicalDamage(attacker, defender(effects), 100).defenseReduction;

describe('status modifier registry fallback', () => {
  it('uses an explicit modifiers object exactly as written', () => {
    const npcBuff = [{ type: 'defense_up', duration: 3, modifiers: { defense: 1.3 } }];
    assert.equal(magicReduction(npcBuff), magicReduction([]),
      'no extra magic defense from the registry');
    assert.ok(physicalReduction(npcBuff) > physicalReduction([]));
    assert.equal(
      physicalReduction(npcBuff),
      physicalReduction([{ type: 'unregistered_marker', modifiers: { defense: 1.3 } }])
    );
  });

  it('still applies registry modifiers to a bare string-based effect', () => {
    const bare = [{ type: 'defense_up', duration: 3 }];
    assert.ok(magicReduction(bare) > magicReduction([]));
    assert.ok(physicalReduction(bare) > physicalReduction([]));
    // Registry defense_up is 1.2 for both stats
    assert.equal(
      magicReduction(bare),
      magicReduction([{ type: 'x', modifiers: { magicDefense: 1.2 } }])
    );
  });
});
