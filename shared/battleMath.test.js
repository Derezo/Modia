/**
 * Battle Math Unit Tests
 * Tests for damage formulas, hit/crit calculations
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  calculatePhysicalDamage,
  calculateMagicalDamage,
  calculateHealing,
  calculateHitChance,
  calculateCritChance,
  calculateCritMultiplier,
  calculateDamagePreview,
  calculateInitiative
} from './battleMath.js';

describe('calculatePhysicalDamage', () => {
  it('should calculate base damage from strength and attack', () => {
    const attacker = { strength: 20, attack: 10 };
    const defender = { vitality: 10, defense: 0 };
    const result = calculatePhysicalDamage(attacker, defender, 100);

    assert.ok(result.avgDamage > 0, 'Should deal positive damage');
    assert.ok(result.minDamage <= result.avgDamage, 'Min should be <= avg');
    assert.ok(result.maxDamage >= result.avgDamage, 'Max should be >= avg');
  });

  it('should scale damage with skill power', () => {
    const attacker = { strength: 20, attack: 10 };
    const defender = { vitality: 10, defense: 0 };

    const result100 = calculatePhysicalDamage(attacker, defender, 100);
    const result150 = calculatePhysicalDamage(attacker, defender, 150);
    const result200 = calculatePhysicalDamage(attacker, defender, 200);

    assert.ok(result150.avgDamage > result100.avgDamage, '150% should do more than 100%');
    assert.ok(result200.avgDamage > result150.avgDamage, '200% should do more than 150%');
  });

  it('should reduce damage with defense', () => {
    const attacker = { strength: 20, attack: 10 };
    const lowDef = { vitality: 10, defense: 0 };
    const highDef = { vitality: 10, defense: 50 };

    const resultLow = calculatePhysicalDamage(attacker, lowDef, 100);
    const resultHigh = calculatePhysicalDamage(attacker, highDef, 100);

    assert.ok(resultHigh.avgDamage < resultLow.avgDamage, 'High defense should reduce damage');
  });

  it('should guarantee minimum 1 damage', () => {
    const attacker = { strength: 1, attack: 0 };
    const defender = { vitality: 100, defense: 100 };
    const result = calculatePhysicalDamage(attacker, defender, 100);

    assert.ok(result.minDamage >= 1, 'Min damage should be at least 1');
    assert.ok(result.maxDamage >= 1, 'Max damage should be at least 1');
  });

  it('should have 10% variance range', () => {
    const attacker = { strength: 50, attack: 50 };
    const defender = { vitality: 20, defense: 20 };
    const result = calculatePhysicalDamage(attacker, defender, 100);

    // Variance should be roughly 20% of base (0.9 to 1.1)
    const range = result.maxDamage - result.minDamage;
    const expectedRange = result.avgDamage * 0.2;

    // Allow some tolerance due to floor operations
    assert.ok(Math.abs(range - expectedRange) < 3, 'Variance should be ~20% of average');
  });

  it('should handle missing stats gracefully', () => {
    const attacker = {};
    const defender = {};
    const result = calculatePhysicalDamage(attacker, defender, 100);

    assert.ok(result.minDamage >= 1, 'Should handle missing stats');
  });
});

describe('calculateMagicalDamage', () => {
  it('should calculate base damage from intelligence and magicAttack', () => {
    const attacker = { intelligence: 30, magicAttack: 20 };
    const defender = { intelligence: 10, magicDefense: 0 };
    const result = calculateMagicalDamage(attacker, defender, 100);

    assert.ok(result.avgDamage > 0, 'Should deal positive damage');
  });

  it('should scale damage with skill power', () => {
    const attacker = { intelligence: 30, magicAttack: 20 };
    const defender = { intelligence: 10, magicDefense: 0 };

    const result100 = calculateMagicalDamage(attacker, defender, 100);
    const result200 = calculateMagicalDamage(attacker, defender, 200);

    assert.ok(result200.avgDamage > result100.avgDamage, '200% should do more than 100%');
  });

  it('should reduce damage with magic defense', () => {
    const attacker = { intelligence: 30, magicAttack: 20 };
    const lowDef = { intelligence: 10, magicDefense: 0 };
    const highDef = { intelligence: 10, magicDefense: 100 };

    const resultLow = calculateMagicalDamage(attacker, lowDef, 100);
    const resultHigh = calculateMagicalDamage(attacker, highDef, 100);

    assert.ok(resultHigh.avgDamage < resultLow.avgDamage, 'High magic defense should reduce damage');
  });

  it('should guarantee minimum 1 damage', () => {
    const attacker = { intelligence: 1, magicAttack: 0 };
    const defender = { intelligence: 100, magicDefense: 100 };
    const result = calculateMagicalDamage(attacker, defender, 100);

    assert.ok(result.minDamage >= 1, 'Min damage should be at least 1');
  });
});

describe('calculateHealing', () => {
  it('should calculate healing based on intelligence', () => {
    const caster = { intelligence: 30 };
    const target = { hp: 50, maxHp: 100 };
    const result = calculateHealing(caster, target, 100);

    assert.ok(result.minHeal > 0, 'Should heal positive amount');
    assert.ok(result.maxHeal >= result.minHeal, 'Max should be >= min');
  });

  it('should scale with skill power', () => {
    const caster = { intelligence: 30 };
    const target = { hp: 50, maxHp: 100 };

    const result100 = calculateHealing(caster, target, 100);
    const result200 = calculateHealing(caster, target, 200);

    assert.ok(result200.maxHeal > result100.maxHeal, '200% should heal more');
  });

  it('should detect overheal', () => {
    const caster = { intelligence: 100 };
    const target = { hp: 95, maxHp: 100 }; // Only 5 HP missing

    const result = calculateHealing(caster, target, 100);

    assert.strictEqual(result.isOverheal, true, 'Should detect overheal');
    assert.ok(result.effectiveHeal <= 5, 'Effective heal should be capped at missing HP');
  });

  it('should not report overheal when target needs more', () => {
    const caster = { intelligence: 10 };
    const target = { hp: 10, maxHp: 100 }; // 90 HP missing

    const result = calculateHealing(caster, target, 100);

    assert.strictEqual(result.isOverheal, false, 'Should not overheal');
  });
});

describe('calculateHitChance', () => {
  it('should have 95% base hit chance', () => {
    const attacker = { agility: 10, statusEffects: [] };
    const defender = { agility: 10 };
    const hitChance = calculateHitChance(attacker, defender);

    assert.strictEqual(hitChance, 0.95, 'Base hit chance should be 95%');
  });

  it('should reduce hit chance against faster targets', () => {
    const attacker = { agility: 10, statusEffects: [] };
    const fastDefender = { agility: 30 };
    const hitChance = calculateHitChance(attacker, fastDefender);

    assert.ok(hitChance < 0.95, 'Hit chance should be reduced against faster target');
  });

  it('should not increase hit chance against slower targets', () => {
    const attacker = { agility: 30, statusEffects: [] };
    const slowDefender = { agility: 10 };
    const hitChance = calculateHitChance(attacker, slowDefender);

    assert.strictEqual(hitChance, 0.95, 'Hit chance should not exceed 95% against slow target');
  });

  it('should reduce hit chance when blinded', () => {
    const attacker = { agility: 10, statusEffects: [{ type: 'blind' }] };
    const defender = { agility: 10 };
    const hitChance = calculateHitChance(attacker, defender);

    assert.ok(hitChance < 0.95, 'Blind should reduce hit chance');
    assert.ok(hitChance >= 0.5, 'Hit chance should not go below 50%');
  });

  it('should have minimum 50% hit chance', () => {
    const attacker = { agility: 1, statusEffects: [{ type: 'blind' }] };
    const defender = { agility: 100 };
    const hitChance = calculateHitChance(attacker, defender);

    assert.ok(hitChance >= 0.5, 'Hit chance should be at least 50%');
  });

  it('should have maximum 100% hit chance', () => {
    const attacker = { agility: 100, statusEffects: [] };
    const defender = { agility: 1 };
    const hitChance = calculateHitChance(attacker, defender);

    assert.ok(hitChance <= 1.0, 'Hit chance should not exceed 100%');
  });
});

describe('calculateCritChance', () => {
  it('should scale crit chance with luck', () => {
    const lowLuck = { luck: 10 };
    const highLuck = { luck: 40 };

    const critLow = calculateCritChance(lowLuck);
    const critHigh = calculateCritChance(highLuck);

    assert.ok(critHigh > critLow, 'Higher luck should mean higher crit chance');
  });

  it('should cap crit chance at 30%', () => {
    const maxLuck = { luck: 200 };
    const critChance = calculateCritChance(maxLuck);

    assert.strictEqual(critChance, 0.30, 'Crit chance should cap at 30%');
  });

  it('should have reasonable crit chance at normal luck', () => {
    const normalLuck = { luck: 20 };
    const critChance = calculateCritChance(normalLuck);

    assert.strictEqual(critChance, 0.10, 'Luck 20 should give 10% crit');
  });

  it('should handle missing luck stat', () => {
    const noLuck = {};
    const critChance = calculateCritChance(noLuck);

    assert.strictEqual(critChance, 0.05, 'Default luck 10 should give 5% crit');
  });
});

describe('calculateCritMultiplier', () => {
  it('should return 1.5 base crit multiplier', () => {
    const attacker = { race: 'human' };
    const multiplier = calculateCritMultiplier(attacker);

    assert.strictEqual(multiplier, 1.5, 'Base crit multiplier should be 1.5');
  });

  it('should give orcs 1.65 crit multiplier', () => {
    const orc = { race: 'orc' };
    const multiplier = calculateCritMultiplier(orc);

    // Use approximate equality for floating point
    assert.ok(Math.abs(multiplier - 1.65) < 0.0001, 'Orc crit multiplier should be ~1.65');
  });

  it('should return base multiplier for non-orcs', () => {
    const races = ['human', 'elf', 'dwarf', 'vampire', undefined];
    for (const race of races) {
      const multiplier = calculateCritMultiplier({ race });
      assert.strictEqual(multiplier, 1.5, `${race} should have base 1.5 multiplier`);
    }
  });
});

describe('calculateDamagePreview', () => {
  it('should return physical damage type by default', () => {
    const attacker = { strength: 20, attack: 10 };
    const defender = { vitality: 10, defense: 5, hp: 100 };
    const skill = { power: 100 };

    const preview = calculateDamagePreview(attacker, defender, skill);

    assert.strictEqual(preview.type, 'physical');
    assert.ok(preview.minDamage > 0);
    assert.ok(preview.maxDamage >= preview.minDamage);
  });

  it('should return magical damage type when specified', () => {
    const attacker = { intelligence: 20, magicAttack: 10 };
    const defender = { intelligence: 10, magicDefense: 5, hp: 100 };
    const skill = { power: 100, damageType: 'magical' };

    const preview = calculateDamagePreview(attacker, defender, skill);

    assert.strictEqual(preview.type, 'magical');
  });

  it('should return heal type for healing skills', () => {
    const caster = { intelligence: 30 };
    const target = { hp: 50, maxHp: 100 };
    const skill = { power: 100, effect: 'heal' };

    const preview = calculateDamagePreview(caster, target, skill);

    assert.strictEqual(preview.type, 'heal');
    assert.ok(preview.minHeal > 0);
    assert.strictEqual(preview.hitChance, 1.0, 'Heals should always hit');
    assert.strictEqual(preview.minDamage, null, 'Heals should not have damage');
  });

  it('should indicate willKill when damage exceeds HP', () => {
    const attacker = { strength: 100, attack: 50 };
    const defender = { vitality: 5, defense: 0, hp: 10 };
    const skill = { power: 100 };

    const preview = calculateDamagePreview(attacker, defender, skill);

    assert.strictEqual(preview.willKill, true, 'Should indicate will kill');
  });

  it('should include crit damage calculation', () => {
    const attacker = { strength: 20, attack: 10, luck: 20, race: 'human' };
    const defender = { vitality: 10, defense: 5, hp: 100 };
    const skill = { power: 100 };

    const preview = calculateDamagePreview(attacker, defender, skill);

    assert.ok(preview.critDamage > preview.maxDamage, 'Crit damage should exceed max damage');
    assert.ok(preview.critChance > 0, 'Should have crit chance');
  });
});

describe('calculateInitiative', () => {
  it('should base initiative on agility', () => {
    const slowUnit = { agility: 10 };
    const fastUnit = { agility: 50 };

    // Use fixed random value for deterministic testing
    const slowInit = calculateInitiative(slowUnit, 0.5);
    const fastInit = calculateInitiative(fastUnit, 0.5);

    assert.ok(fastInit > slowInit, 'Faster unit should have higher initiative');
  });

  it('should add random variance', () => {
    const unit = { agility: 20 };

    const initLow = calculateInitiative(unit, 0);
    const initHigh = calculateInitiative(unit, 0.99);

    assert.strictEqual(initLow, 20, 'Min variance should be 0');
    assert.strictEqual(initHigh, 29, 'Max variance should be 9');
  });

  it('should handle missing agility', () => {
    const unit = {};
    const init = calculateInitiative(unit, 0.5);

    assert.strictEqual(init, 15, 'Default agility 10 + variance 5');
  });
});
