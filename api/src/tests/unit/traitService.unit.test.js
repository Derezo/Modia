/**
 * Trait Service Unit Tests
 * Tests for trait effect calculations and applications
 *
 * These tests cover pure functions that don't require database access.
 * loadCharacterTraits is excluded as it requires database mocking.
 */

import { describe, it, beforeEach, before } from 'node:test';
import assert from 'node:assert';
import {
  getTraitEffectValue,
  hasTraitEffect,
  getPhysicalDamageMultiplier,
  getMagicalDamageMultiplier,
  getDamageReductionMultiplier,
  getCritChanceBonus,
  getAccuracyBonus,
  getEvasionBonus,
  getInitiativeBonus,
  getMPCostReduction,
  calculateLifesteal,
  calculateHPRegen,
  checkDeathSave,
  getXPBonus,
  getGoldBonus,
  getMovementBonus,
  getRangeBonus,
  formatTraitsForClient,
  applyBattleStartTraits
} from '../../services/traitService.js';
import { initializeTraitEffects } from '../../services/traits/index.js';

// Initialize trait effect registry before tests run
before(() => {
  initializeTraitEffects();
});

// Helper to create a test unit with traits
function createTestUnit(traits = [], overrides = {}) {
  return {
    name: 'Test Unit',
    class: 'warrior',
    hp: 100,
    maxHp: 100,
    mp: 50,
    maxMp: 50,
    movement: 3,
    attackRange: 1,
    traits,
    ...overrides
  };
}

// Helper to create a trait object
function createTrait(effectType, effectValue, name = 'Test Trait') {
  return {
    id: Math.floor(Math.random() * 1000),
    name,
    description: `A test trait with ${effectType}`,
    category: 'combat',
    rarity: 'common',
    effectType,
    effectValue
  };
}

describe('getTraitEffectValue', () => {
  it('should return 0 for unit without traits', () => {
    const unit = createTestUnit();
    delete unit.traits;

    const value = getTraitEffectValue(unit, 'physical_damage_bonus');
    assert.strictEqual(value, 0);
  });

  it('should return 0 for unit with empty traits array', () => {
    const unit = createTestUnit([]);

    const value = getTraitEffectValue(unit, 'physical_damage_bonus');
    assert.strictEqual(value, 0);
  });

  it('should return 0 for non-existent effect type', () => {
    const unit = createTestUnit([createTrait('physical_damage_bonus', 0.15)]);

    const value = getTraitEffectValue(unit, 'nonexistent_effect');
    assert.strictEqual(value, 0);
  });

  it('should return correct value for existing effect type', () => {
    const unit = createTestUnit([createTrait('physical_damage_bonus', 0.15)]);

    const value = getTraitEffectValue(unit, 'physical_damage_bonus');
    assert.strictEqual(value, 0.15);
  });

  it('should return first matching trait value when multiple exist', () => {
    const unit = createTestUnit([
      createTrait('physical_damage_bonus', 0.10),
      createTrait('physical_damage_bonus', 0.20)
    ]);

    const value = getTraitEffectValue(unit, 'physical_damage_bonus');
    assert.strictEqual(value, 0.10);
  });
});

describe('hasTraitEffect', () => {
  it('should return false for unit without traits', () => {
    const unit = createTestUnit();
    delete unit.traits;

    assert.strictEqual(hasTraitEffect(unit, 'lifesteal'), false);
  });

  it('should return false for unit with empty traits array', () => {
    const unit = createTestUnit([]);

    assert.strictEqual(hasTraitEffect(unit, 'lifesteal'), false);
  });

  it('should return false for non-existent effect type', () => {
    const unit = createTestUnit([createTrait('physical_damage_bonus', 0.15)]);

    assert.strictEqual(hasTraitEffect(unit, 'lifesteal'), false);
  });

  it('should return true for existing effect type', () => {
    const unit = createTestUnit([createTrait('lifesteal', 0.10)]);

    assert.strictEqual(hasTraitEffect(unit, 'lifesteal'), true);
  });
});

describe('getMovementBonus', () => {
  it('should return 0 for unit without movement_bonus trait', () => {
    const unit = createTestUnit([]);

    assert.strictEqual(getMovementBonus(unit), 0);
  });

  it('should return floored movement bonus', () => {
    const unit = createTestUnit([createTrait('movement_bonus', 1.7)]);

    assert.strictEqual(getMovementBonus(unit), 1);
  });

  it('should return integer movement bonus', () => {
    const unit = createTestUnit([createTrait('movement_bonus', 2)]);

    assert.strictEqual(getMovementBonus(unit), 2);
  });
});

describe('getRangeBonus', () => {
  it('should return 0 for unit without range_bonus trait', () => {
    const unit = createTestUnit([]);

    assert.strictEqual(getRangeBonus(unit), 0);
  });

  it('should return floored range bonus', () => {
    const unit = createTestUnit([createTrait('range_bonus', 1.5)]);

    assert.strictEqual(getRangeBonus(unit), 1);
  });
});

describe('getPhysicalDamageMultiplier', () => {
  it('should return 1.0 for unit without traits', () => {
    const attacker = createTestUnit();
    delete attacker.traits;
    const defender = createTestUnit();

    assert.strictEqual(getPhysicalDamageMultiplier(attacker, defender, false), 1.0);
  });

  it('should apply physical_damage_bonus', () => {
    const attacker = createTestUnit([createTrait('physical_damage_bonus', 0.15)]);
    const defender = createTestUnit();

    assert.strictEqual(getPhysicalDamageMultiplier(attacker, defender, false), 1.15);
  });

  it('should apply all_damage_bonus', () => {
    const attacker = createTestUnit([createTrait('all_damage_bonus', 0.10)]);
    const defender = createTestUnit();

    assert.strictEqual(getPhysicalDamageMultiplier(attacker, defender, false), 1.10);
  });

  it('should apply critical_damage_bonus only on crit', () => {
    const attacker = createTestUnit([createTrait('critical_damage_bonus', 0.25)]);
    const defender = createTestUnit();

    // Not critical
    assert.strictEqual(getPhysicalDamageMultiplier(attacker, defender, false), 1.0);
    // Critical
    assert.strictEqual(getPhysicalDamageMultiplier(attacker, defender, true), 1.25);
  });

  it('should apply low_hp_damage_bonus when below 30% HP', () => {
    const attacker = createTestUnit([createTrait('low_hp_damage_bonus', 0.30)], {
      hp: 25,
      maxHp: 100
    });
    const defender = createTestUnit();

    assert.strictEqual(getPhysicalDamageMultiplier(attacker, defender, false), 1.30);
  });

  it('should not apply low_hp_damage_bonus when above 30% HP', () => {
    const attacker = createTestUnit([createTrait('low_hp_damage_bonus', 0.30)], {
      hp: 50,
      maxHp: 100
    });
    const defender = createTestUnit();

    assert.strictEqual(getPhysicalDamageMultiplier(attacker, defender, false), 1.0);
  });

  it('should apply dragon_damage_bonus against dragons', () => {
    const attacker = createTestUnit([createTrait('dragon_damage_bonus', 0.20)]);
    const defender = createTestUnit([], { archetype: 'dragon' });

    assert.strictEqual(getPhysicalDamageMultiplier(attacker, defender, false), 1.20);
  });

  it('should apply dragon_damage_bonus against dragon class', () => {
    const attacker = createTestUnit([createTrait('dragon_damage_bonus', 0.20)]);
    const defender = createTestUnit([], { class: 'dragon' });

    assert.strictEqual(getPhysicalDamageMultiplier(attacker, defender, false), 1.20);
  });

  it('should apply undead_damage_bonus against undead', () => {
    const attacker = createTestUnit([createTrait('undead_damage_bonus', 0.25)]);
    const defender = createTestUnit([], { archetype: 'undead' });

    assert.strictEqual(getPhysicalDamageMultiplier(attacker, defender, false), 1.25);
  });

  it('should apply demon_damage_bonus against demons', () => {
    const attacker = createTestUnit([createTrait('demon_damage_bonus', 0.15)]);
    const defender = createTestUnit([], { archetype: 'demon' });

    assert.strictEqual(getPhysicalDamageMultiplier(attacker, defender, false), 1.15);
  });

  it('should apply boss_damage_bonus against bosses', () => {
    const attacker = createTestUnit([createTrait('boss_damage_bonus', 0.20)]);
    const defender = createTestUnit([], { isBoss: true });

    assert.strictEqual(getPhysicalDamageMultiplier(attacker, defender, false), 1.20);
  });

  it('should apply universal_situational at 50% against archetype enemies', () => {
    const attacker = createTestUnit([createTrait('universal_situational', 0.20)]);
    const defender = createTestUnit([], { archetype: 'beast' });

    // 0.20 * 0.5 = 0.10
    assert.strictEqual(getPhysicalDamageMultiplier(attacker, defender, false), 1.10);
  });

  it('should not apply universal_situational without archetype', () => {
    const attacker = createTestUnit([createTrait('universal_situational', 0.20)]);
    const defender = createTestUnit();

    assert.strictEqual(getPhysicalDamageMultiplier(attacker, defender, false), 1.0);
  });

  it('should stack multiple damage bonuses', () => {
    const attacker = createTestUnit([
      createTrait('physical_damage_bonus', 0.10),
      createTrait('all_damage_bonus', 0.05),
      createTrait('critical_damage_bonus', 0.15)
    ], { hp: 100, maxHp: 100 });
    const defender = createTestUnit();

    // Not critical: 1.0 + 0.10 + 0.05 = 1.15
    const noCritResult = getPhysicalDamageMultiplier(attacker, defender, false);
    assert.ok(Math.abs(noCritResult - 1.15) < 0.0001, `Expected ~1.15, got ${noCritResult}`);
    // Critical: 1.0 + 0.10 + 0.05 + 0.15 = 1.30
    const critResult = getPhysicalDamageMultiplier(attacker, defender, true);
    assert.ok(Math.abs(critResult - 1.30) < 0.0001, `Expected ~1.30, got ${critResult}`);
  });
});

describe('getMagicalDamageMultiplier', () => {
  it('should return 1.0 for unit without traits', () => {
    const attacker = createTestUnit();
    delete attacker.traits;
    const defender = createTestUnit();

    assert.strictEqual(getMagicalDamageMultiplier(attacker, defender, false), 1.0);
  });

  it('should apply magic_damage_bonus', () => {
    const attacker = createTestUnit([createTrait('magic_damage_bonus', 0.20)]);
    const defender = createTestUnit();

    assert.strictEqual(getMagicalDamageMultiplier(attacker, defender, false), 1.20);
  });

  it('should apply all_damage_bonus to magic', () => {
    const attacker = createTestUnit([createTrait('all_damage_bonus', 0.12)]);
    const defender = createTestUnit();

    assert.strictEqual(getMagicalDamageMultiplier(attacker, defender, false), 1.12);
  });

  it('should apply situational bonuses to magic damage', () => {
    const attacker = createTestUnit([createTrait('undead_damage_bonus', 0.25)]);
    const defender = createTestUnit([], { archetype: 'undead' });

    assert.strictEqual(getMagicalDamageMultiplier(attacker, defender, false), 1.25);
  });
});

describe('getDamageReductionMultiplier', () => {
  it('should return 1.0 for unit without traits', () => {
    const defender = createTestUnit();
    delete defender.traits;

    assert.strictEqual(getDamageReductionMultiplier(defender, 'physical'), 1.0);
  });

  it('should apply physical_resistance for physical damage', () => {
    const defender = createTestUnit([createTrait('physical_resistance', 0.15)]);

    assert.strictEqual(getDamageReductionMultiplier(defender, 'physical'), 0.85);
  });

  it('should not apply physical_resistance for magical damage', () => {
    const defender = createTestUnit([createTrait('physical_resistance', 0.15)]);

    assert.strictEqual(getDamageReductionMultiplier(defender, 'magical'), 1.0);
  });

  it('should apply magic_resistance for magical damage', () => {
    const defender = createTestUnit([createTrait('magic_resistance', 0.20)]);

    assert.strictEqual(getDamageReductionMultiplier(defender, 'magical'), 0.80);
  });

  it('should not apply magic_resistance for physical damage', () => {
    const defender = createTestUnit([createTrait('magic_resistance', 0.20)]);

    assert.strictEqual(getDamageReductionMultiplier(defender, 'physical'), 1.0);
  });

  it('should apply all_resistance to both damage types', () => {
    const defender = createTestUnit([createTrait('all_resistance', 0.10)]);

    assert.strictEqual(getDamageReductionMultiplier(defender, 'physical'), 0.90);
    assert.strictEqual(getDamageReductionMultiplier(defender, 'magical'), 0.90);
  });

  it('should stack multiple resistances', () => {
    const defender = createTestUnit([
      createTrait('physical_resistance', 0.15),
      createTrait('all_resistance', 0.10)
    ]);

    // 1.0 - 0.15 - 0.10 = 0.75
    assert.strictEqual(getDamageReductionMultiplier(defender, 'physical'), 0.75);
  });

  it('should enforce minimum 10% damage taken', () => {
    const defender = createTestUnit([
      createTrait('all_resistance', 0.50),
      createTrait('physical_resistance', 0.50)
    ]);

    // Would be 1.0 - 0.50 - 0.50 = 0 but capped at 0.1
    assert.strictEqual(getDamageReductionMultiplier(defender, 'physical'), 0.1);
  });
});

describe('getCritChanceBonus', () => {
  it('should return 0 for unit without luck_effectiveness trait', () => {
    const unit = createTestUnit([]);

    assert.strictEqual(getCritChanceBonus(unit), 0);
  });

  it('should calculate crit bonus from luck_effectiveness', () => {
    // 0.25 luck_effectiveness * 0.1 = 0.025 (2.5% extra crit)
    const unit = createTestUnit([createTrait('luck_effectiveness', 0.25)]);

    assert.strictEqual(getCritChanceBonus(unit), 0.025);
  });
});

describe('getAccuracyBonus', () => {
  it('should return 0 without accuracy_bonus trait', () => {
    const unit = createTestUnit([]);

    assert.strictEqual(getAccuracyBonus(unit), 0);
  });

  it('should return accuracy bonus value', () => {
    const unit = createTestUnit([createTrait('accuracy_bonus', 0.08)]);

    assert.strictEqual(getAccuracyBonus(unit), 0.08);
  });
});

describe('getEvasionBonus', () => {
  it('should return 0 without evasion_bonus trait', () => {
    const unit = createTestUnit([]);

    assert.strictEqual(getEvasionBonus(unit), 0);
  });

  it('should return evasion bonus value', () => {
    const unit = createTestUnit([createTrait('evasion_bonus', 0.05)]);

    assert.strictEqual(getEvasionBonus(unit), 0.05);
  });
});

describe('getInitiativeBonus', () => {
  it('should return 0 without initiative_bonus trait', () => {
    const unit = createTestUnit([]);

    assert.strictEqual(getInitiativeBonus(unit), 0);
  });

  it('should return initiative bonus value', () => {
    const unit = createTestUnit([createTrait('initiative_bonus', 0.15)]);

    assert.strictEqual(getInitiativeBonus(unit), 0.15);
  });
});

describe('getMPCostReduction', () => {
  it('should return 0 without mp_cost_reduction trait', () => {
    const unit = createTestUnit([]);

    assert.strictEqual(getMPCostReduction(unit), 0);
  });

  it('should return MP cost reduction value', () => {
    const unit = createTestUnit([createTrait('mp_cost_reduction', 0.12)]);

    assert.strictEqual(getMPCostReduction(unit), 0.12);
  });
});

describe('calculateLifesteal', () => {
  it('should return 0 without lifesteal trait', () => {
    const attacker = createTestUnit([]);

    assert.strictEqual(calculateLifesteal(attacker, 100), 0);
  });

  it('should calculate lifesteal healing', () => {
    const attacker = createTestUnit([createTrait('lifesteal', 0.10)]);

    // 10% of 100 damage = 10 HP
    assert.strictEqual(calculateLifesteal(attacker, 100), 10);
  });

  it('should floor lifesteal healing', () => {
    const attacker = createTestUnit([createTrait('lifesteal', 0.10)]);

    // 10% of 55 damage = 5.5, floored to 5
    assert.strictEqual(calculateLifesteal(attacker, 55), 5);
  });

  it('should return 0 for zero or negative damage', () => {
    const attacker = createTestUnit([createTrait('lifesteal', 0.10)]);

    assert.strictEqual(calculateLifesteal(attacker, 0), 0);
  });
});

describe('calculateHPRegen', () => {
  it('should return 0 without hp_regen_percent trait', () => {
    const unit = createTestUnit([], { maxHp: 200 });

    assert.strictEqual(calculateHPRegen(unit), 0);
  });

  it('should calculate HP regen based on max HP', () => {
    const unit = createTestUnit([createTrait('hp_regen_percent', 0.05)], {
      maxHp: 200
    });

    // 5% of 200 = 10 HP
    assert.strictEqual(calculateHPRegen(unit), 10);
  });

  it('should floor HP regen', () => {
    const unit = createTestUnit([createTrait('hp_regen_percent', 0.03)], {
      maxHp: 150
    });

    // 3% of 150 = 4.5, floored to 4
    assert.strictEqual(calculateHPRegen(unit), 4);
  });
});

describe('checkDeathSave', () => {
  it('should return false without death_save trait', () => {
    const unit = createTestUnit([]);

    assert.strictEqual(checkDeathSave(unit), false);
  });

  it('should return true with death_save trait (first use)', () => {
    const unit = createTestUnit([createTrait('death_save', 1)]);

    assert.strictEqual(checkDeathSave(unit), true);
    assert.strictEqual(unit.deathSaveUsed, true);
  });

  it('should return false after death_save is used', () => {
    const unit = createTestUnit([createTrait('death_save', 1)], {
      deathSaveUsed: true
    });

    assert.strictEqual(checkDeathSave(unit), false);
  });

  it('should set deathSaveUsed flag on first trigger', () => {
    const unit = createTestUnit([createTrait('death_save', 1)]);

    checkDeathSave(unit);
    assert.strictEqual(unit.deathSaveUsed, true);

    // Second call should fail
    assert.strictEqual(checkDeathSave(unit), false);
  });
});

describe('getXPBonus', () => {
  it('should return 0 without xp_bonus trait', () => {
    const unit = createTestUnit([]);

    assert.strictEqual(getXPBonus(unit), 0);
  });

  it('should return XP bonus value', () => {
    const unit = createTestUnit([createTrait('xp_bonus', 0.10)]);

    assert.strictEqual(getXPBonus(unit), 0.10);
  });
});

describe('getGoldBonus', () => {
  it('should return 0 without gold_bonus trait', () => {
    const unit = createTestUnit([]);

    assert.strictEqual(getGoldBonus(unit), 0);
  });

  it('should return gold bonus value', () => {
    const unit = createTestUnit([createTrait('gold_bonus', 0.15)]);

    assert.strictEqual(getGoldBonus(unit), 0.15);
  });
});

describe('applyBattleStartTraits', () => {
  it('should do nothing for unit without traits', () => {
    const unit = createTestUnit();
    delete unit.traits;
    const originalHp = unit.maxHp;

    applyBattleStartTraits(unit);

    assert.strictEqual(unit.maxHp, originalHp);
  });

  it('should do nothing for unit with empty traits', () => {
    const unit = createTestUnit([]);
    const originalHp = unit.maxHp;

    applyBattleStartTraits(unit);

    assert.strictEqual(unit.maxHp, originalHp);
  });

  it('should apply hp_bonus trait', () => {
    const unit = createTestUnit([createTrait('hp_bonus', 0.20)], {
      hp: 100,
      maxHp: 100
    });

    applyBattleStartTraits(unit);

    // 20% of 100 = 20 bonus HP
    assert.strictEqual(unit.maxHp, 120);
    assert.strictEqual(unit.hp, 120);
  });

  it('should apply mp_bonus trait', () => {
    const unit = createTestUnit([createTrait('mp_bonus', 0.25)], {
      mp: 50,
      maxMp: 50
    });

    applyBattleStartTraits(unit);

    // 25% of 50 = 12 bonus MP (floored)
    assert.strictEqual(unit.maxMp, 62);
    assert.strictEqual(unit.mp, 62);
  });

  it('should apply hp_mp_bonus to both HP and MP', () => {
    const unit = createTestUnit([createTrait('hp_mp_bonus', 0.10)], {
      hp: 100,
      maxHp: 100,
      mp: 50,
      maxMp: 50
    });

    applyBattleStartTraits(unit);

    // 10% of 100 HP = 10 bonus
    assert.strictEqual(unit.maxHp, 110);
    assert.strictEqual(unit.hp, 110);
    // 10% of 50 MP = 5 bonus
    assert.strictEqual(unit.maxMp, 55);
    assert.strictEqual(unit.mp, 55);
  });

  it('should apply movement_bonus trait', () => {
    const unit = createTestUnit([createTrait('movement_bonus', 2)], {
      movement: 3
    });

    applyBattleStartTraits(unit);

    assert.strictEqual(unit.movement, 5);
  });

  it('should apply range_bonus trait', () => {
    const unit = createTestUnit([createTrait('range_bonus', 1)], {
      attackRange: 1
    });

    applyBattleStartTraits(unit);

    assert.strictEqual(unit.attackRange, 2);
  });

  it('should use default movement when not set', () => {
    const unit = createTestUnit([createTrait('movement_bonus', 1)]);
    delete unit.movement;

    applyBattleStartTraits(unit);

    assert.strictEqual(unit.movement, 4); // Default 3 + 1 bonus
  });

  it('should use default attackRange when not set', () => {
    const unit = createTestUnit([createTrait('range_bonus', 2)]);
    delete unit.attackRange;

    applyBattleStartTraits(unit);

    assert.strictEqual(unit.attackRange, 3); // Default 1 + 2 bonus
  });

  it('should stack hp_bonus and hp_mp_bonus sequentially', () => {
    const unit = createTestUnit([
      createTrait('hp_bonus', 0.10),
      createTrait('hp_mp_bonus', 0.10)
    ], { hp: 100, maxHp: 100 });

    applyBattleStartTraits(unit);

    // Applied sequentially:
    // hp_bonus: 100 + floor(100 * 0.1) = 110
    // hp_mp_bonus: 110 + floor(110 * 0.1) = 121
    assert.strictEqual(unit.maxHp, 121);
    assert.strictEqual(unit.hp, 121);
  });
});

describe('formatTraitsForClient', () => {
  it('should return empty array for null traits', () => {
    assert.deepStrictEqual(formatTraitsForClient(null), []);
  });

  it('should return empty array for empty traits', () => {
    assert.deepStrictEqual(formatTraitsForClient([]), []);
  });

  it('should format traits with only client-relevant fields', () => {
    const traits = [
      {
        id: 1,
        name: 'Iron Skin',
        description: 'Reduces physical damage',
        category: 'defensive',
        rarity: 'rare',
        effectType: 'physical_resistance',
        effectValue: 0.15
      }
    ];

    const formatted = formatTraitsForClient(traits);

    assert.strictEqual(formatted.length, 1);
    assert.strictEqual(formatted[0].id, 1);
    assert.strictEqual(formatted[0].name, 'Iron Skin');
    assert.strictEqual(formatted[0].description, 'Reduces physical damage');
    assert.strictEqual(formatted[0].category, 'defensive');
    assert.strictEqual(formatted[0].rarity, 'rare');
    // effectType and effectValue should not be included
    assert.strictEqual(formatted[0].effectType, undefined);
    assert.strictEqual(formatted[0].effectValue, undefined);
  });

  it('should format multiple traits', () => {
    const traits = [
      createTrait('physical_damage_bonus', 0.10, 'Strength'),
      createTrait('hp_bonus', 0.15, 'Vitality')
    ];

    const formatted = formatTraitsForClient(traits);

    assert.strictEqual(formatted.length, 2);
    assert.strictEqual(formatted[0].name, 'Strength');
    assert.strictEqual(formatted[1].name, 'Vitality');
  });
});
