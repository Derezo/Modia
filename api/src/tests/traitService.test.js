/**
 * Unit tests for traitService.js
 * Tests trait effects on damage, stats, and combat modifiers
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';

import {
  getTraitEffectValue,
  hasTraitEffect,
  applyBattleStartTraits,
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
  formatTraitsForClient
} from '../services/traitService.js';

import { createMockPlayerUnit, createMockEnemyUnit, createMockTrait } from './testUtils/index.js';

// ============================================================================
// Helper functions
// ============================================================================

function createUnitWithTraits(traits) {
  return createMockPlayerUnit({ traits });
}

function createEnemyWithArchetype(archetype, additionalProps = {}) {
  return createMockEnemyUnit({ archetype, ...additionalProps });
}

/**
 * Compare floating point numbers with tolerance for precision errors
 */
function assertApproximatelyEqual(actual, expected, tolerance = 0.0001, message = '') {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new assert.AssertionError({
      message: message || `Expected ${expected} but got ${actual} (diff: ${diff})`,
      actual,
      expected,
      operator: 'approximatelyEqual'
    });
  }
}

// ============================================================================
// Basic Trait Utility Tests
// ============================================================================

describe('traitService - Basic Utilities', () => {
  test('getTraitEffectValue returns 0 for unit with no traits', () => {
    const unit = createMockPlayerUnit({ traits: [] });
    const value = getTraitEffectValue(unit, 'physical_damage_bonus');
    assert.strictEqual(value, 0);
  });

  test('getTraitEffectValue returns 0 for unit with undefined traits', () => {
    const unit = createMockPlayerUnit();
    delete unit.traits;
    const value = getTraitEffectValue(unit, 'physical_damage_bonus');
    assert.strictEqual(value, 0);
  });

  test('getTraitEffectValue returns correct value when trait exists', () => {
    const trait = createMockTrait({ effectType: 'physical_damage_bonus', effectValue: 0.15 });
    const unit = createUnitWithTraits([trait]);
    const value = getTraitEffectValue(unit, 'physical_damage_bonus');
    assert.strictEqual(value, 0.15);
  });

  test('hasTraitEffect returns false for unit with no traits', () => {
    const unit = createMockPlayerUnit({ traits: [] });
    assert.strictEqual(hasTraitEffect(unit, 'death_save'), false);
  });

  test('hasTraitEffect returns true when trait exists', () => {
    const trait = createMockTrait({ effectType: 'death_save', effectValue: 1 });
    const unit = createUnitWithTraits([trait]);
    assert.strictEqual(hasTraitEffect(unit, 'death_save'), true);
  });

  test('hasTraitEffect returns false for non-existent effect type', () => {
    const trait = createMockTrait({ effectType: 'hp_bonus', effectValue: 0.1 });
    const unit = createUnitWithTraits([trait]);
    assert.strictEqual(hasTraitEffect(unit, 'death_save'), false);
  });
});

// ============================================================================
// Physical Damage Multiplier Tests
// ============================================================================

describe('traitService - getPhysicalDamageMultiplier', () => {
  test('returns 1.0 for unit with no traits', () => {
    const attacker = createMockPlayerUnit({ traits: [] });
    const defender = createMockEnemyUnit();
    const multiplier = getPhysicalDamageMultiplier(attacker, defender, false);
    assert.strictEqual(multiplier, 1.0);
  });

  test('applies physical_damage_bonus correctly', () => {
    const trait = createMockTrait({ effectType: 'physical_damage_bonus', effectValue: 0.2 });
    const attacker = createUnitWithTraits([trait]);
    const defender = createMockEnemyUnit();
    const multiplier = getPhysicalDamageMultiplier(attacker, defender, false);
    assertApproximatelyEqual(multiplier, 1.2);
  });

  test('applies all_damage_bonus correctly', () => {
    const trait = createMockTrait({ effectType: 'all_damage_bonus', effectValue: 0.1 });
    const attacker = createUnitWithTraits([trait]);
    const defender = createMockEnemyUnit();
    const multiplier = getPhysicalDamageMultiplier(attacker, defender, false);
    assertApproximatelyEqual(multiplier, 1.1);
  });

  test('applies critical_damage_bonus only on critical hits', () => {
    const trait = createMockTrait({ effectType: 'critical_damage_bonus', effectValue: 0.5 });
    const attacker = createUnitWithTraits([trait]);
    const defender = createMockEnemyUnit();

    const nonCritMultiplier = getPhysicalDamageMultiplier(attacker, defender, false);
    const critMultiplier = getPhysicalDamageMultiplier(attacker, defender, true);

    assert.strictEqual(nonCritMultiplier, 1.0);
    assertApproximatelyEqual(critMultiplier, 1.5);
  });

  test('applies low_hp_damage_bonus when attacker below 30% HP', () => {
    const trait = createMockTrait({ effectType: 'low_hp_damage_bonus', effectValue: 0.3 });
    const attackerLowHP = createMockPlayerUnit({
      hp: 20,
      maxHp: 100,
      traits: [trait]
    });
    const attackerHighHP = createMockPlayerUnit({
      hp: 80,
      maxHp: 100,
      traits: [trait]
    });
    const defender = createMockEnemyUnit();

    const lowHPMultiplier = getPhysicalDamageMultiplier(attackerLowHP, defender, false);
    const highHPMultiplier = getPhysicalDamageMultiplier(attackerHighHP, defender, false);

    assertApproximatelyEqual(lowHPMultiplier, 1.3);
    assert.strictEqual(highHPMultiplier, 1.0);
  });

  test('applies dragon_damage_bonus against dragon archetype', () => {
    const trait = createMockTrait({ effectType: 'dragon_damage_bonus', effectValue: 0.25 });
    const attacker = createUnitWithTraits([trait]);
    const dragon = createEnemyWithArchetype('dragon');
    const goblin = createEnemyWithArchetype('goblin');

    const vsDragon = getPhysicalDamageMultiplier(attacker, dragon, false);
    const vsGoblin = getPhysicalDamageMultiplier(attacker, goblin, false);

    assertApproximatelyEqual(vsDragon, 1.25);
    assert.strictEqual(vsGoblin, 1.0);
  });

  test('applies undead_damage_bonus against undead archetype', () => {
    const trait = createMockTrait({ effectType: 'undead_damage_bonus', effectValue: 0.2 });
    const attacker = createUnitWithTraits([trait]);
    const undead = createEnemyWithArchetype('undead');

    const multiplier = getPhysicalDamageMultiplier(attacker, undead, false);
    assertApproximatelyEqual(multiplier, 1.2);
  });

  test('applies demon_damage_bonus against demon archetype', () => {
    const trait = createMockTrait({ effectType: 'demon_damage_bonus', effectValue: 0.15 });
    const attacker = createUnitWithTraits([trait]);
    const demon = createEnemyWithArchetype('demon');

    const multiplier = getPhysicalDamageMultiplier(attacker, demon, false);
    assertApproximatelyEqual(multiplier, 1.15);
  });

  test('applies boss_damage_bonus against boss enemies', () => {
    const trait = createMockTrait({ effectType: 'boss_damage_bonus', effectValue: 0.2 });
    const attacker = createUnitWithTraits([trait]);
    const boss = createMockEnemyUnit({ isBoss: true });
    const regular = createMockEnemyUnit({ isBoss: false });

    const vsBoss = getPhysicalDamageMultiplier(attacker, boss, false);
    const vsRegular = getPhysicalDamageMultiplier(attacker, regular, false);

    assertApproximatelyEqual(vsBoss, 1.2);
    assert.strictEqual(vsRegular, 1.0);
  });

  test('stacks multiple damage bonuses', () => {
    const traits = [
      createMockTrait({ effectType: 'physical_damage_bonus', effectValue: 0.1 }),
      createMockTrait({ effectType: 'all_damage_bonus', effectValue: 0.1 }),
      createMockTrait({ effectType: 'critical_damage_bonus', effectValue: 0.2 })
    ];
    const attacker = createUnitWithTraits(traits);
    const defender = createMockEnemyUnit();

    const critMultiplier = getPhysicalDamageMultiplier(attacker, defender, true);
    // 1.0 + 0.1 + 0.1 + 0.2 = 1.4
    assertApproximatelyEqual(critMultiplier, 1.4);
  });
});

// ============================================================================
// Magical Damage Multiplier Tests
// ============================================================================

describe('traitService - getMagicalDamageMultiplier', () => {
  test('returns 1.0 for unit with no traits', () => {
    const attacker = createMockPlayerUnit({ traits: [] });
    const defender = createMockEnemyUnit();
    const multiplier = getMagicalDamageMultiplier(attacker, defender, false);
    assert.strictEqual(multiplier, 1.0);
  });

  test('applies magic_damage_bonus correctly', () => {
    const trait = createMockTrait({ effectType: 'magic_damage_bonus', effectValue: 0.25 });
    const attacker = createUnitWithTraits([trait]);
    const defender = createMockEnemyUnit();
    const multiplier = getMagicalDamageMultiplier(attacker, defender, false);
    assertApproximatelyEqual(multiplier, 1.25);
  });

  test('applies all_damage_bonus to magical damage', () => {
    const trait = createMockTrait({ effectType: 'all_damage_bonus', effectValue: 0.15 });
    const attacker = createUnitWithTraits([trait]);
    const defender = createMockEnemyUnit();
    const multiplier = getMagicalDamageMultiplier(attacker, defender, false);
    assertApproximatelyEqual(multiplier, 1.15);
  });

  test('applies critical_damage_bonus on magical critical', () => {
    const trait = createMockTrait({ effectType: 'critical_damage_bonus', effectValue: 0.4 });
    const attacker = createUnitWithTraits([trait]);
    const defender = createMockEnemyUnit();

    const critMultiplier = getMagicalDamageMultiplier(attacker, defender, true);
    assertApproximatelyEqual(critMultiplier, 1.4);
  });

  test('applies archetype bonuses to magical damage', () => {
    const trait = createMockTrait({ effectType: 'undead_damage_bonus', effectValue: 0.3 });
    const attacker = createUnitWithTraits([trait]);
    const undead = createEnemyWithArchetype('undead');

    const multiplier = getMagicalDamageMultiplier(attacker, undead, false);
    assertApproximatelyEqual(multiplier, 1.3);
  });
});

// ============================================================================
// Damage Reduction Multiplier Tests
// ============================================================================

describe('traitService - getDamageReductionMultiplier', () => {
  test('returns 1.0 for unit with no traits', () => {
    const defender = createMockPlayerUnit({ traits: [] });
    const multiplier = getDamageReductionMultiplier(defender, 'physical');
    assert.strictEqual(multiplier, 1.0);
  });

  test('applies physical_resistance to physical damage', () => {
    const trait = createMockTrait({ effectType: 'physical_resistance', effectValue: 0.2 });
    const defender = createUnitWithTraits([trait]);

    const physicalMult = getDamageReductionMultiplier(defender, 'physical');
    const magicalMult = getDamageReductionMultiplier(defender, 'magical');

    assertApproximatelyEqual(physicalMult, 0.8);
    assert.strictEqual(magicalMult, 1.0);
  });

  test('applies magic_resistance to magical damage', () => {
    const trait = createMockTrait({ effectType: 'magic_resistance', effectValue: 0.15 });
    const defender = createUnitWithTraits([trait]);

    const physicalMult = getDamageReductionMultiplier(defender, 'physical');
    const magicalMult = getDamageReductionMultiplier(defender, 'magical');

    assert.strictEqual(physicalMult, 1.0);
    assertApproximatelyEqual(magicalMult, 0.85);
  });

  test('applies all_resistance to both damage types', () => {
    const trait = createMockTrait({ effectType: 'all_resistance', effectValue: 0.1 });
    const defender = createUnitWithTraits([trait]);

    const physicalMult = getDamageReductionMultiplier(defender, 'physical');
    const magicalMult = getDamageReductionMultiplier(defender, 'magical');

    assertApproximatelyEqual(physicalMult, 0.9);
    assertApproximatelyEqual(magicalMult, 0.9);
  });

  test('enforces minimum 10% damage taken', () => {
    const trait = createMockTrait({ effectType: 'all_resistance', effectValue: 0.95 });
    const defender = createUnitWithTraits([trait]);

    const multiplier = getDamageReductionMultiplier(defender, 'physical');
    assertApproximatelyEqual(multiplier, 0.1);
  });

  test('stacks multiple resistance traits', () => {
    const traits = [
      createMockTrait({ effectType: 'physical_resistance', effectValue: 0.1 }),
      createMockTrait({ effectType: 'all_resistance', effectValue: 0.1 })
    ];
    const defender = createUnitWithTraits(traits);

    const physicalMult = getDamageReductionMultiplier(defender, 'physical');
    // 1.0 - 0.1 - 0.1 = 0.8
    assertApproximatelyEqual(physicalMult, 0.8);
  });
});

// ============================================================================
// Stat Bonus Tests - applyBattleStartTraits
// ============================================================================

describe('traitService - applyBattleStartTraits', () => {
  test('does nothing for unit with no traits', () => {
    const unit = createMockPlayerUnit({ hp: 100, maxHp: 100, traits: [] });
    applyBattleStartTraits(unit);
    assert.strictEqual(unit.hp, 100);
    assert.strictEqual(unit.maxHp, 100);
  });

  test('applies hp_bonus correctly', () => {
    const trait = createMockTrait({ effectType: 'hp_bonus', effectValue: 0.2 });
    const unit = createMockPlayerUnit({ hp: 100, maxHp: 100, traits: [trait] });

    applyBattleStartTraits(unit);

    assert.strictEqual(unit.maxHp, 120);
    assert.strictEqual(unit.hp, 120);
  });

  test('applies mp_bonus correctly', () => {
    const trait = createMockTrait({ effectType: 'mp_bonus', effectValue: 0.25 });
    const unit = createMockPlayerUnit({ mp: 50, maxMp: 50, traits: [trait] });

    applyBattleStartTraits(unit);

    assert.strictEqual(unit.maxMp, 62);
    assert.strictEqual(unit.mp, 62);
  });

  test('applies hp_mp_bonus to both HP and MP', () => {
    const trait = createMockTrait({ effectType: 'hp_mp_bonus', effectValue: 0.1 });
    const unit = createMockPlayerUnit({
      hp: 100, maxHp: 100,
      mp: 50, maxMp: 50,
      traits: [trait]
    });

    applyBattleStartTraits(unit);

    assert.strictEqual(unit.maxHp, 110);
    assert.strictEqual(unit.hp, 110);
    assert.strictEqual(unit.maxMp, 55);
    assert.strictEqual(unit.mp, 55);
  });

  test('applies movement_bonus correctly', () => {
    const trait = createMockTrait({ effectType: 'movement_bonus', effectValue: 2 });
    const unit = createMockPlayerUnit({ movement: 3, traits: [trait] });

    applyBattleStartTraits(unit);

    assert.strictEqual(unit.movement, 5);
  });

  test('applies range_bonus correctly', () => {
    const trait = createMockTrait({ effectType: 'range_bonus', effectValue: 1 });
    const unit = createMockPlayerUnit({ attackRange: 1, traits: [trait] });

    applyBattleStartTraits(unit);

    assert.strictEqual(unit.attackRange, 2);
  });

  test('stacks hp_bonus and hp_mp_bonus', () => {
    const traits = [
      createMockTrait({ effectType: 'hp_bonus', effectValue: 0.1 }),
      createMockTrait({ effectType: 'hp_mp_bonus', effectValue: 0.1 })
    ];
    const unit = createMockPlayerUnit({ hp: 100, maxHp: 100, traits });

    applyBattleStartTraits(unit);

    // 100 * (0.1 + 0.1) = 20 bonus HP
    assert.strictEqual(unit.maxHp, 120);
    assert.strictEqual(unit.hp, 120);
  });
});

// ============================================================================
// Movement and Range Bonus Tests
// ============================================================================

describe('traitService - getMovementBonus', () => {
  test('returns 0 for unit with no movement trait', () => {
    const unit = createMockPlayerUnit({ traits: [] });
    assert.strictEqual(getMovementBonus(unit), 0);
  });

  test('returns correct movement bonus', () => {
    const trait = createMockTrait({ effectType: 'movement_bonus', effectValue: 2 });
    const unit = createUnitWithTraits([trait]);
    assert.strictEqual(getMovementBonus(unit), 2);
  });

  test('floors decimal movement values', () => {
    const trait = createMockTrait({ effectType: 'movement_bonus', effectValue: 1.7 });
    const unit = createUnitWithTraits([trait]);
    assert.strictEqual(getMovementBonus(unit), 1);
  });
});

describe('traitService - getRangeBonus', () => {
  test('returns 0 for unit with no range trait', () => {
    const unit = createMockPlayerUnit({ traits: [] });
    assert.strictEqual(getRangeBonus(unit), 0);
  });

  test('returns correct range bonus', () => {
    const trait = createMockTrait({ effectType: 'range_bonus', effectValue: 1 });
    const unit = createUnitWithTraits([trait]);
    assert.strictEqual(getRangeBonus(unit), 1);
  });
});

// ============================================================================
// Initiative Bonus Tests
// ============================================================================

describe('traitService - getInitiativeBonus', () => {
  test('returns 0 for unit with no initiative trait', () => {
    const unit = createMockPlayerUnit({ traits: [] });
    assert.strictEqual(getInitiativeBonus(unit), 0);
  });

  test('returns correct initiative bonus', () => {
    const trait = createMockTrait({ effectType: 'initiative_bonus', effectValue: 0.15 });
    const unit = createUnitWithTraits([trait]);
    assert.strictEqual(getInitiativeBonus(unit), 0.15);
  });
});

// ============================================================================
// MP Cost Reduction Tests
// ============================================================================

describe('traitService - getMPCostReduction', () => {
  test('returns 0 for unit with no MP reduction trait', () => {
    const unit = createMockPlayerUnit({ traits: [] });
    assert.strictEqual(getMPCostReduction(unit), 0);
  });

  test('returns correct MP cost reduction', () => {
    const trait = createMockTrait({ effectType: 'mp_cost_reduction', effectValue: 0.12 });
    const unit = createUnitWithTraits([trait]);
    assert.strictEqual(getMPCostReduction(unit), 0.12);
  });
});

// ============================================================================
// Combat Modifier Tests
// ============================================================================

describe('traitService - getCritChanceBonus', () => {
  test('returns 0 for unit with no luck effectiveness trait', () => {
    const unit = createMockPlayerUnit({ traits: [] });
    assert.strictEqual(getCritChanceBonus(unit), 0);
  });

  test('returns crit bonus based on luck effectiveness', () => {
    const trait = createMockTrait({ effectType: 'luck_effectiveness', effectValue: 0.25 });
    const unit = createUnitWithTraits([trait]);
    // 0.25 * 0.1 = 0.025 (2.5% extra crit)
    assertApproximatelyEqual(getCritChanceBonus(unit), 0.025);
  });
});

describe('traitService - getAccuracyBonus', () => {
  test('returns 0 for unit with no accuracy trait', () => {
    const unit = createMockPlayerUnit({ traits: [] });
    assert.strictEqual(getAccuracyBonus(unit), 0);
  });

  test('returns correct accuracy bonus', () => {
    const trait = createMockTrait({ effectType: 'accuracy_bonus', effectValue: 0.08 });
    const unit = createUnitWithTraits([trait]);
    assert.strictEqual(getAccuracyBonus(unit), 0.08);
  });
});

describe('traitService - getEvasionBonus', () => {
  test('returns 0 for unit with no evasion trait', () => {
    const unit = createMockPlayerUnit({ traits: [] });
    assert.strictEqual(getEvasionBonus(unit), 0);
  });

  test('returns correct evasion bonus', () => {
    const trait = createMockTrait({ effectType: 'evasion_bonus', effectValue: 0.05 });
    const unit = createUnitWithTraits([trait]);
    assert.strictEqual(getEvasionBonus(unit), 0.05);
  });
});

// ============================================================================
// Special Mechanics Tests
// ============================================================================

describe('traitService - calculateLifesteal', () => {
  test('returns 0 for unit with no lifesteal trait', () => {
    const attacker = createMockPlayerUnit({ traits: [] });
    assert.strictEqual(calculateLifesteal(attacker, 100), 0);
  });

  test('calculates correct lifesteal amount', () => {
    const trait = createMockTrait({ effectType: 'lifesteal', effectValue: 0.1 });
    const attacker = createUnitWithTraits([trait]);
    // 100 damage * 0.1 = 10 HP healed
    assert.strictEqual(calculateLifesteal(attacker, 100), 10);
  });

  test('floors lifesteal to whole numbers', () => {
    const trait = createMockTrait({ effectType: 'lifesteal', effectValue: 0.15 });
    const attacker = createUnitWithTraits([trait]);
    // 33 damage * 0.15 = 4.95, floored to 4
    assert.strictEqual(calculateLifesteal(attacker, 33), 4);
  });

  test('returns 0 for zero or negative damage', () => {
    const trait = createMockTrait({ effectType: 'lifesteal', effectValue: 0.1 });
    const attacker = createUnitWithTraits([trait]);
    assert.strictEqual(calculateLifesteal(attacker, 0), 0);
  });
});

describe('traitService - calculateHPRegen', () => {
  test('returns 0 for unit with no HP regen trait', () => {
    const unit = createMockPlayerUnit({ traits: [] });
    assert.strictEqual(calculateHPRegen(unit), 0);
  });

  test('calculates correct HP regeneration', () => {
    const trait = createMockTrait({ effectType: 'hp_regen_percent', effectValue: 0.05 });
    const unit = createMockPlayerUnit({ maxHp: 200, traits: [trait] });
    // 200 * 0.05 = 10 HP regen
    assert.strictEqual(calculateHPRegen(unit), 10);
  });

  test('floors HP regen to whole numbers', () => {
    const trait = createMockTrait({ effectType: 'hp_regen_percent', effectValue: 0.03 });
    const unit = createMockPlayerUnit({ maxHp: 150, traits: [trait] });
    // 150 * 0.03 = 4.5, floored to 4
    assert.strictEqual(calculateHPRegen(unit), 4);
  });
});

describe('traitService - checkDeathSave', () => {
  test('returns false for unit with no death save trait', () => {
    const unit = createMockPlayerUnit({ traits: [] });
    assert.strictEqual(checkDeathSave(unit), false);
  });

  test('returns true and marks used on first death save', () => {
    const trait = createMockTrait({ effectType: 'death_save', effectValue: 1 });
    const unit = createMockPlayerUnit({ traits: [trait], deathSaveUsed: false });

    const result = checkDeathSave(unit);

    assert.strictEqual(result, true);
    assert.strictEqual(unit.deathSaveUsed, true);
  });

  test('returns false when death save already used', () => {
    const trait = createMockTrait({ effectType: 'death_save', effectValue: 1 });
    const unit = createMockPlayerUnit({ traits: [trait], deathSaveUsed: true });

    assert.strictEqual(checkDeathSave(unit), false);
  });

  test('death save can only trigger once per battle', () => {
    const trait = createMockTrait({ effectType: 'death_save', effectValue: 1 });
    const unit = createMockPlayerUnit({ traits: [trait] });

    const firstSave = checkDeathSave(unit);
    const secondSave = checkDeathSave(unit);

    assert.strictEqual(firstSave, true);
    assert.strictEqual(secondSave, false);
  });
});

// ============================================================================
// XP and Gold Bonus Tests
// ============================================================================

describe('traitService - getXPBonus', () => {
  test('returns 0 for unit with no XP bonus trait', () => {
    const unit = createMockPlayerUnit({ traits: [] });
    assert.strictEqual(getXPBonus(unit), 0);
  });

  test('returns correct XP bonus', () => {
    const trait = createMockTrait({ effectType: 'xp_bonus', effectValue: 0.1 });
    const unit = createUnitWithTraits([trait]);
    assert.strictEqual(getXPBonus(unit), 0.1);
  });
});

describe('traitService - getGoldBonus', () => {
  test('returns 0 for unit with no gold bonus trait', () => {
    const unit = createMockPlayerUnit({ traits: [] });
    assert.strictEqual(getGoldBonus(unit), 0);
  });

  test('returns correct gold bonus', () => {
    const trait = createMockTrait({ effectType: 'gold_bonus', effectValue: 0.15 });
    const unit = createUnitWithTraits([trait]);
    assert.strictEqual(getGoldBonus(unit), 0.15);
  });
});

// ============================================================================
// Format Traits for Client Tests
// ============================================================================

describe('traitService - formatTraitsForClient', () => {
  test('returns empty array for null traits', () => {
    const result = formatTraitsForClient(null);
    assert.deepStrictEqual(result, []);
  });

  test('returns empty array for empty traits', () => {
    const result = formatTraitsForClient([]);
    assert.deepStrictEqual(result, []);
  });

  test('formats traits correctly for client', () => {
    const traits = [
      {
        id: 1,
        name: 'Iron Will',
        description: '+10% HP',
        rarity: 'rare',
        category: 'defensive',
        effectType: 'hp_bonus',
        effectValue: 0.1
      }
    ];

    const result = formatTraitsForClient(traits);

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 1);
    assert.strictEqual(result[0].name, 'Iron Will');
    assert.strictEqual(result[0].description, '+10% HP');
    assert.strictEqual(result[0].rarity, 'rare');
    assert.strictEqual(result[0].category, 'defensive');
    // Should not include effectType and effectValue
    assert.strictEqual(result[0].effectType, undefined);
    assert.strictEqual(result[0].effectValue, undefined);
  });
});

// ============================================================================
// Edge Cases and Integration Tests
// ============================================================================

describe('traitService - Edge Cases', () => {
  test('handles undefined traits gracefully', () => {
    const unit = createMockPlayerUnit();
    delete unit.traits;

    // All these should not throw and return default values
    assert.strictEqual(getPhysicalDamageMultiplier(unit, null, false), 1.0);
    assert.strictEqual(getMagicalDamageMultiplier(unit, null, false), 1.0);
    assert.strictEqual(getDamageReductionMultiplier(unit, 'physical'), 1.0);
    assert.strictEqual(getMovementBonus(unit), 0);
    assert.strictEqual(getRangeBonus(unit), 0);
    assert.strictEqual(calculateLifesteal(unit, 100), 0);
    assert.strictEqual(calculateHPRegen(unit), 0);
    assert.strictEqual(checkDeathSave(unit), false);
  });

  test('handles null defender in damage calculations', () => {
    const trait = createMockTrait({ effectType: 'physical_damage_bonus', effectValue: 0.1 });
    const attacker = createUnitWithTraits([trait]);

    // Should not throw with null defender
    const multiplier = getPhysicalDamageMultiplier(attacker, null, false);
    assertApproximatelyEqual(multiplier, 1.1);
  });

  test('universal_situational applies 50% bonus against any archetype', () => {
    const trait = createMockTrait({ effectType: 'universal_situational', effectValue: 0.2 });
    const attacker = createUnitWithTraits([trait]);
    const enemyWithArchetype = createEnemyWithArchetype('goblin');
    const enemyNoArchetype = createMockEnemyUnit();
    delete enemyNoArchetype.archetype;

    const withArchetype = getPhysicalDamageMultiplier(attacker, enemyWithArchetype, false);
    const withoutArchetype = getPhysicalDamageMultiplier(attacker, enemyNoArchetype, false);

    // 0.2 * 0.5 = 0.1 bonus
    assertApproximatelyEqual(withArchetype, 1.1);
    assert.strictEqual(withoutArchetype, 1.0);
  });

  test('dragon_damage_bonus also applies to class dragon', () => {
    const trait = createMockTrait({ effectType: 'dragon_damage_bonus', effectValue: 0.3 });
    const attacker = createUnitWithTraits([trait]);
    const dragonClass = createMockEnemyUnit({ class: 'dragon', archetype: null });

    const multiplier = getPhysicalDamageMultiplier(attacker, dragonClass, false);
    assertApproximatelyEqual(multiplier, 1.3);
  });
});
