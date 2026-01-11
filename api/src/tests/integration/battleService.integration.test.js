/**
 * Unit tests for battleService - Damage calculations, status effects, and combat mechanics
 *
 * Uses SeededRandom from testUtils to ensure deterministic random values for reproducible tests.
 * Tests cover the core combat functions without requiring a running server.
 *
 * Note: The mock factories use abbreviated stat names (str, vit, int, agi, luk) but battleService
 * expects full names (strength, vitality, intelligence, agility, luck). Tests must pass full names
 * in overrides for damage calculations to work correctly.
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  SeededRandom,
  createMockPlayerUnit,
  createMockEnemyUnit,
  createMockBattleState,
  withSeededRandom
} from '../testUtils/index.js';
import * as battleService from '../../services/battleService.js';

// =============================================================================
// PHYSICAL DAMAGE TESTS
// =============================================================================

describe('calculatePhysicalDamage', () => {
  test('should calculate base damage from strength and attack', () => {
    const result = withSeededRandom(12345, () => {
      const attacker = createMockPlayerUnit({
        strength: 20,
        attack: 10,
        luck: 0
      });
      const defender = createMockEnemyUnit({
        vitality: 10,
        agility: 10, // Needed as fallback if vitality is 0
        defense: 5
      });
      return battleService.calculatePhysicalDamage(attacker, defender, 100);
    });

    // Base damage = (strength + attack) * (skillPower/100) - (vitality + defense) * 0.5 * 0.3
    assert.ok(result.damage >= 1, 'Damage should be at least 1');
    assert.ok(typeof result.damage === 'number', 'Damage should be a number');
    assert.ok(!isNaN(result.damage), 'Damage should not be NaN');
    assert.ok(typeof result.isCritical === 'boolean', 'Should return critical flag');
    assert.ok(typeof result.variance === 'number', 'Should return variance');
  });

  test('should scale damage with skill power', () => {
    // Test that higher skill power produces higher average damage over many samples
    let sum100 = 0;
    let sum150 = 0;
    const trials = 50;

    for (let seed = 0; seed < trials; seed++) {
      const result100 = withSeededRandom(seed, () => {
        const attacker = createMockPlayerUnit({ strength: 30, attack: 0, luck: 0 });
        const defender = createMockEnemyUnit({ vitality: 10, agility: 10, defense: 0 });
        return battleService.calculatePhysicalDamage(attacker, defender, 100);
      });
      sum100 += result100.damage;

      const result150 = withSeededRandom(seed + 10000, () => {
        const attacker = createMockPlayerUnit({ strength: 30, attack: 0, luck: 0 });
        const defender = createMockEnemyUnit({ vitality: 10, agility: 10, defense: 0 });
        return battleService.calculatePhysicalDamage(attacker, defender, 150);
      });
      sum150 += result150.damage;
    }

    const avg100 = sum100 / trials;
    const avg150 = sum150 / trials;
    assert.ok(!isNaN(avg100), 'avg100 should not be NaN');
    assert.ok(!isNaN(avg150), 'avg150 should not be NaN');
    assert.ok(avg150 > avg100, '150% skill power avg should exceed 100% avg');
  });

  test('should apply defense reduction', () => {
    const lowDefense = withSeededRandom(12345, () => {
      const attacker = createMockPlayerUnit({ strength: 50, attack: 0, luck: 0 });
      const defender = createMockEnemyUnit({ vitality: 5, agility: 10, defense: 5 });
      return battleService.calculatePhysicalDamage(attacker, defender, 100);
    });

    const highDefense = withSeededRandom(12345, () => {
      const attacker = createMockPlayerUnit({ strength: 50, attack: 0, luck: 0 });
      const defender = createMockEnemyUnit({ vitality: 50, agility: 10, defense: 50 });
      return battleService.calculatePhysicalDamage(attacker, defender, 100);
    });

    assert.ok(lowDefense.damage > highDefense.damage, 'Higher defense should reduce damage');
  });

  test('should always deal minimum 1 damage', () => {
    const result = withSeededRandom(12345, () => {
      const attacker = createMockPlayerUnit({ strength: 1, attack: 0, luck: 0 });
      const defender = createMockEnemyUnit({ vitality: 999, agility: 100, defense: 999 });
      return battleService.calculatePhysicalDamage(attacker, defender, 100);
    });

    assert.strictEqual(result.damage >= 1, true, 'Minimum damage should be 1');
  });

  test('should produce critical hits with high luck', () => {
    // Statistically, with luck 200, crit chance = 200/200 = 100%
    let critCount = 0;
    const trials = 100;

    for (let seed = 0; seed < trials; seed++) {
      const result = withSeededRandom(seed, () => {
        const attacker = createMockPlayerUnit({ strength: 30, attack: 0, luck: 200 });
        const defender = createMockEnemyUnit({ vitality: 10, agility: 10, defense: 0 });
        return battleService.calculatePhysicalDamage(attacker, defender, 100);
      });
      if (result.isCritical) critCount++;
    }

    // With 100% base crit chance (luck 200), should get many crits
    assert.ok(critCount > 80, 'Should get many crits with max luck, got ' + critCount + '/100');
  });

  test('should apply 1.5x critical hit multiplier', () => {
    // Compare average damage with low luck vs high luck to verify crit multiplier effect
    let lowLuckTotal = 0;
    let highLuckTotal = 0;
    const trials = 100;

    for (let seed = 0; seed < trials; seed++) {
      const lowLuckResult = withSeededRandom(seed, () => {
        const attacker = createMockPlayerUnit({ strength: 50, attack: 0, luck: 0 });
        const defender = createMockEnemyUnit({ vitality: 10, agility: 10, defense: 0 });
        return battleService.calculatePhysicalDamage(attacker, defender, 100);
      });
      lowLuckTotal += lowLuckResult.damage;

      const highLuckResult = withSeededRandom(seed, () => {
        const attacker = createMockPlayerUnit({ strength: 50, attack: 0, luck: 200 });
        const defender = createMockEnemyUnit({ vitality: 10, agility: 10, defense: 0 });
        return battleService.calculatePhysicalDamage(attacker, defender, 100);
      });
      highLuckTotal += highLuckResult.damage;
    }

    // High luck should produce significantly more damage due to crits (1.5x)
    assert.ok(highLuckTotal > lowLuckTotal * 1.3,
      'High luck total (' + highLuckTotal + ') should be >30% more than low luck (' + lowLuckTotal + ')');
  });

  test('should apply orc race bonus (10% extra damage)', () => {
    // Compare average damage over many trials
    let humanTotal = 0;
    let orcTotal = 0;
    const trials = 100;

    for (let seed = 0; seed < trials; seed++) {
      const humanResult = withSeededRandom(seed, () => {
        const attacker = createMockPlayerUnit({ strength: 50, attack: 0, luck: 0, race: 'human' });
        const defender = createMockEnemyUnit({ vitality: 10, agility: 10, defense: 0 });
        return battleService.calculatePhysicalDamage(attacker, defender, 100);
      });
      humanTotal += humanResult.damage;

      const orcResult = withSeededRandom(seed, () => {
        const attacker = createMockPlayerUnit({ strength: 50, attack: 0, luck: 0, race: 'orc' });
        const defender = createMockEnemyUnit({ vitality: 10, agility: 10, defense: 0 });
        return battleService.calculatePhysicalDamage(attacker, defender, 100);
      });
      orcTotal += orcResult.damage;
    }

    // Orc has 10% race bonus
    assert.ok(!isNaN(humanTotal), 'humanTotal should not be NaN');
    assert.ok(!isNaN(orcTotal), 'orcTotal should not be NaN');
    assert.ok(orcTotal > humanTotal, 'Orc total ' + orcTotal + ' should exceed human total ' + humanTotal);
  });

  test('should apply variance between 0.9 and 1.1', () => {
    const results = [];
    for (let seed = 0; seed < 50; seed++) {
      const result = withSeededRandom(seed, () => {
        const attacker = createMockPlayerUnit({ strength: 100, attack: 0, luck: 0 });
        const defender = createMockEnemyUnit({ vitality: 10, agility: 10, defense: 0 });
        return battleService.calculatePhysicalDamage(attacker, defender, 100);
      });
      results.push(result.variance);
    }

    const minVariance = Math.min(...results);
    const maxVariance = Math.max(...results);

    assert.ok(minVariance >= 0.9, 'Variance should not be below 0.9');
    assert.ok(maxVariance <= 1.1, 'Variance should not exceed 1.1');
  });
});

// =============================================================================
// MAGICAL DAMAGE TESTS
// =============================================================================

describe('calculateMagicalDamage', () => {
  test('should calculate base damage from intelligence and magic attack', () => {
    const result = withSeededRandom(12345, () => {
      const attacker = createMockPlayerUnit({
        intelligence: 30,
        magicAttack: 10,
        luck: 0
      });
      const defender = createMockEnemyUnit({
        intelligence: 10,
        magicDefense: 5
      });
      return battleService.calculateMagicalDamage(attacker, defender, 100);
    });

    assert.ok(result.damage >= 1, 'Damage should be at least 1');
    assert.ok(!isNaN(result.damage), 'Damage should not be NaN');
    assert.ok(typeof result.damage === 'number', 'Damage should be a number');
    assert.ok(typeof result.isCritical === 'boolean', 'Should return critical flag');
  });

  test('should apply magic defense reduction', () => {
    const lowMagicDef = withSeededRandom(12345, () => {
      const attacker = createMockPlayerUnit({ intelligence: 50, magicAttack: 0, luck: 0 });
      const defender = createMockEnemyUnit({ intelligence: 5, magicDefense: 5 });
      return battleService.calculateMagicalDamage(attacker, defender, 100);
    });

    const highMagicDef = withSeededRandom(12345, () => {
      const attacker = createMockPlayerUnit({ intelligence: 50, magicAttack: 0, luck: 0 });
      const defender = createMockEnemyUnit({ intelligence: 50, magicDefense: 50 });
      return battleService.calculateMagicalDamage(attacker, defender, 100);
    });

    assert.ok(lowMagicDef.damage > highMagicDef.damage, 'Higher magic defense should reduce damage');
  });

  test('should always deal minimum 1 magical damage', () => {
    const result = withSeededRandom(12345, () => {
      const attacker = createMockPlayerUnit({ intelligence: 1, magicAttack: 0, luck: 0 });
      const defender = createMockEnemyUnit({ intelligence: 999, magicDefense: 999 });
      return battleService.calculateMagicalDamage(attacker, defender, 100);
    });

    assert.strictEqual(result.damage >= 1, true, 'Minimum magical damage should be 1');
  });

  test('should apply skill power to magical damage', () => {
    let sum100 = 0;
    let sum200 = 0;
    const trials = 50;

    for (let seed = 0; seed < trials; seed++) {
      const result100 = withSeededRandom(seed, () => {
        const attacker = createMockPlayerUnit({ intelligence: 40, magicAttack: 0, luck: 0 });
        const defender = createMockEnemyUnit({ intelligence: 10, magicDefense: 0 });
        return battleService.calculateMagicalDamage(attacker, defender, 100);
      });
      sum100 += result100.damage;

      const result200 = withSeededRandom(seed + 10000, () => {
        const attacker = createMockPlayerUnit({ intelligence: 40, magicAttack: 0, luck: 0 });
        const defender = createMockEnemyUnit({ intelligence: 10, magicDefense: 0 });
        return battleService.calculateMagicalDamage(attacker, defender, 200);
      });
      sum200 += result200.damage;
    }

    assert.ok(sum200 > sum100, '200% skill power should deal more magical damage');
  });
});

// =============================================================================
// HIT/MISS TESTS
// =============================================================================

describe('checkHit', () => {
  test('should have 95% base hit chance', () => {
    let hits = 0;
    const trials = 100;

    for (let seed = 0; seed < trials; seed++) {
      const result = withSeededRandom(seed, () => {
        const attacker = createMockPlayerUnit({ agility: 10 });
        const defender = createMockEnemyUnit({ agility: 10, statusEffects: [] });
        return battleService.checkHit(attacker, defender);
      });
      if (result) hits++;
    }

    // With 95% hit chance, expect 85-100 hits out of 100 (statistical variance)
    assert.ok(hits >= 80, 'Hit rate ' + hits + '% should be high (base 95%)');
  });

  test('should reduce hit chance when defender has higher agility', () => {
    let lowAgiHits = 0;
    let highAgiHits = 0;
    const trials = 100;

    for (let seed = 0; seed < trials; seed++) {
      const lowAgiResult = withSeededRandom(seed, () => {
        const attacker = createMockPlayerUnit({ agility: 10 });
        const defender = createMockEnemyUnit({ agility: 10, statusEffects: [] });
        return battleService.checkHit(attacker, defender);
      });
      if (lowAgiResult) lowAgiHits++;

      const highAgiResult = withSeededRandom(seed, () => {
        const attacker = createMockPlayerUnit({ agility: 10 });
        const defender = createMockEnemyUnit({ agility: 50, statusEffects: [] }); // Much higher agility
        return battleService.checkHit(attacker, defender);
      });
      if (highAgiResult) highAgiHits++;
    }

    assert.ok(highAgiHits <= lowAgiHits, 'Higher defender agility should reduce hit rate');
  });

  test('should apply blind status penalty (30%)', () => {
    let normalHits = 0;
    let blindHits = 0;
    const trials = 100;

    for (let seed = 0; seed < trials; seed++) {
      const normalResult = withSeededRandom(seed, () => {
        const attacker = createMockPlayerUnit({ agility: 20, statusEffects: [] });
        const defender = createMockEnemyUnit({ agility: 10, statusEffects: [] });
        return battleService.checkHit(attacker, defender);
      });
      if (normalResult) normalHits++;

      const blindResult = withSeededRandom(seed, () => {
        const attacker = createMockPlayerUnit({
          agility: 20,
          statusEffects: [{ type: 'blind', duration: 2 }]
        });
        const defender = createMockEnemyUnit({ agility: 10, statusEffects: [] });
        return battleService.checkHit(attacker, defender);
      });
      if (blindResult) blindHits++;
    }

    // Blind applies 30% penalty, so hits should be noticeably lower
    assert.ok(blindHits < normalHits, 'Blind status should reduce hit rate significantly');
  });

  test('should have minimum 50% hit chance', () => {
    let hits = 0;
    const trials = 100;

    for (let seed = 0; seed < trials; seed++) {
      const result = withSeededRandom(seed, () => {
        const attacker = createMockPlayerUnit({
          agility: 1,
          statusEffects: [{ type: 'blind', duration: 2 }]
        });
        const defender = createMockEnemyUnit({ agility: 100, statusEffects: [] }); // Very high agility
        return battleService.checkHit(attacker, defender);
      });
      if (result) hits++;
    }

    // Even with worst conditions, should hit ~50%
    assert.ok(hits >= 30, 'Hit rate ' + hits + '% should be at least around 50% minimum');
  });
});

// =============================================================================
// INITIATIVE TESTS
// =============================================================================

describe('calculateInitiative', () => {
  test('should calculate initiative based on agility', () => {
    const lowAgiInit = withSeededRandom(12345, () => {
      const unit = createMockPlayerUnit({ agility: 10 });
      return battleService.calculateInitiative(unit);
    });

    const highAgiInit = withSeededRandom(12345, () => {
      const unit = createMockPlayerUnit({ agility: 50 });
      return battleService.calculateInitiative(unit);
    });

    assert.ok(highAgiInit > lowAgiInit, 'Higher agility should give higher initiative');
  });

  test('should add random variance (0-9)', () => {
    const results = [];
    const unit = createMockPlayerUnit({ agility: 20 });

    for (let seed = 0; seed < 50; seed++) {
      const result = withSeededRandom(seed, () => {
        return battleService.calculateInitiative(unit);
      });
      results.push(result);
    }

    const minInit = Math.min(...results);
    const maxInit = Math.max(...results);

    // With agility 20 and variance 0-9, range should be within 20-29 (multiplied by trait bonus)
    assert.ok(maxInit > minInit, 'Initiative should have random variance');
    assert.ok(maxInit - minInit <= 20, 'Variance should be reasonable');
  });
});

describe('sortByInitiative', () => {
  test('should sort units by initiative descending', () => {
    const sorted = withSeededRandom(12345, () => {
      const units = [
        createMockPlayerUnit({ id: 'p1', agility: 5 }),
        createMockEnemyUnit({ id: 'e1', agility: 30 }),
        createMockPlayerUnit({ id: 'p2', agility: 15 })
      ];
      return battleService.sortByInitiative(units);
    });

    // Should be sorted by initiative (calculated from agility + random)
    for (let i = 0; i < sorted.length - 1; i++) {
      assert.ok(sorted[i].initiative >= sorted[i + 1].initiative,
        'Units should be sorted by initiative descending');
    }
  });

  test('should not modify original array', () => {
    const original = [
      createMockPlayerUnit({ id: 'p1', agility: 5 }),
      createMockEnemyUnit({ id: 'e1', agility: 30 })
    ];
    const originalOrder = original.map(u => u.id);

    withSeededRandom(12345, () => {
      battleService.sortByInitiative(original);
    });

    assert.deepStrictEqual(original.map(u => u.id), originalOrder, 'Original array should not be modified');
  });

  test('should add initiative property to returned units', () => {
    const sorted = withSeededRandom(12345, () => {
      const units = [createMockPlayerUnit({ id: 'p1', agility: 10 })];
      return battleService.sortByInitiative(units);
    });

    assert.ok(typeof sorted[0].initiative === 'number', 'Should add initiative property');
  });
});

// =============================================================================
// STATUS EFFECT TESTS
// =============================================================================

describe('processStatusEffects', () => {
  test('should apply poison damage (5% max HP)', () => {
    const unit = createMockPlayerUnit({
      hp: 100,
      maxHp: 100,
      statusEffects: [{ type: 'poison', duration: 3 }]
    });

    const results = battleService.processStatusEffects(unit);

    assert.strictEqual(unit.hp, 95, 'Poison should deal 5% max HP damage');
    assert.ok(results.some(r => r.type === 'poison_damage' && r.damage === 5),
      'Should return poison damage result');
  });

  test('should apply burn damage (3% max HP)', () => {
    const unit = createMockPlayerUnit({
      hp: 100,
      maxHp: 100,
      statusEffects: [{ type: 'burn', duration: 3 }]
    });

    const results = battleService.processStatusEffects(unit);

    assert.strictEqual(unit.hp, 97, 'Burn should deal 3% max HP damage');
    assert.ok(results.some(r => r.type === 'burn_damage' && r.damage === 3),
      'Should return burn damage result');
  });

  test('should apply regen healing (5% max HP)', () => {
    const unit = createMockPlayerUnit({
      hp: 50,
      maxHp: 100,
      statusEffects: [{ type: 'regen', duration: 3 }]
    });

    const results = battleService.processStatusEffects(unit);

    assert.strictEqual(unit.hp, 55, 'Regen should heal 5% max HP');
    assert.ok(results.some(r => r.type === 'regen_heal' && r.amount === 5),
      'Should return regen heal result');
  });

  test('should not exceed max HP with regen', () => {
    const unit = createMockPlayerUnit({
      hp: 98,
      maxHp: 100,
      statusEffects: [{ type: 'regen', duration: 3 }]
    });

    battleService.processStatusEffects(unit);

    assert.strictEqual(unit.hp, 100, 'Regen should not exceed max HP');
  });

  test('should not go below 0 HP from damage effects', () => {
    const unit = createMockPlayerUnit({
      hp: 2,
      maxHp: 100,
      statusEffects: [{ type: 'poison', duration: 3 }]
    });

    battleService.processStatusEffects(unit);

    assert.strictEqual(unit.hp, 0, 'HP should not go below 0');
  });

  test('should decrement effect duration', () => {
    const unit = createMockPlayerUnit({
      hp: 100,
      maxHp: 100,
      statusEffects: [{ type: 'poison', duration: 3 }]
    });

    battleService.processStatusEffects(unit);

    assert.strictEqual(unit.statusEffects[0].duration, 2, 'Duration should decrement');
  });

  test('should remove expired effects', () => {
    const unit = createMockPlayerUnit({
      hp: 100,
      maxHp: 100,
      statusEffects: [{ type: 'poison', duration: 1 }]
    });

    const results = battleService.processStatusEffects(unit);

    assert.strictEqual(unit.statusEffects.length, 0, 'Expired effect should be removed');
    assert.ok(results.some(r => r.type === 'effect_expired' && r.effect === 'poison'),
      'Should return expired effect result');
  });

  test('should handle unit with no status effects', () => {
    const unit = createMockPlayerUnit({ statusEffects: [] });
    const results = battleService.processStatusEffects(unit);
    assert.ok(Array.isArray(results), 'Should return array even with no effects');
  });

  test('should handle unit with undefined status effects', () => {
    const unit = createMockPlayerUnit({});
    delete unit.statusEffects;
    const results = battleService.processStatusEffects(unit);
    assert.ok(Array.isArray(results), 'Should return array even with undefined effects');
  });
});

describe('canUnitAct', () => {
  test('should return true for unit with no status effects', () => {
    const unit = createMockPlayerUnit({ statusEffects: [] });
    assert.strictEqual(battleService.canUnitAct(unit), true);
  });

  test('should return false when stunned', () => {
    const unit = createMockPlayerUnit({
      statusEffects: [{ type: 'stun', duration: 2 }]
    });
    assert.strictEqual(battleService.canUnitAct(unit), false);
  });

  test('should return false when frozen', () => {
    const unit = createMockPlayerUnit({
      statusEffects: [{ type: 'freeze', duration: 2 }]
    });
    assert.strictEqual(battleService.canUnitAct(unit), false);
  });

  test('should return false when asleep', () => {
    const unit = createMockPlayerUnit({
      statusEffects: [{ type: 'sleep', duration: 2 }]
    });
    assert.strictEqual(battleService.canUnitAct(unit), false);
  });

  test('should return true with non-preventing effects like poison', () => {
    const unit = createMockPlayerUnit({
      statusEffects: [{ type: 'poison', duration: 3 }]
    });
    assert.strictEqual(battleService.canUnitAct(unit), true);
  });
});

describe('canUnitMove', () => {
  test('should return true for unit with no status effects', () => {
    const unit = createMockPlayerUnit({ statusEffects: [] });
    assert.strictEqual(battleService.canUnitMove(unit), true);
  });

  test('should return false when stunned', () => {
    const unit = createMockPlayerUnit({
      statusEffects: [{ type: 'stun', duration: 2 }]
    });
    assert.strictEqual(battleService.canUnitMove(unit), false);
  });

  test('should return false when rooted', () => {
    const unit = createMockPlayerUnit({
      statusEffects: [{ type: 'root', duration: 2 }]
    });
    assert.strictEqual(battleService.canUnitMove(unit), false);
  });

  test('should return true with non-movement-preventing effects', () => {
    const unit = createMockPlayerUnit({
      statusEffects: [{ type: 'silence', duration: 3 }]
    });
    assert.strictEqual(battleService.canUnitMove(unit), true);
  });
});

describe('canUnitUseSkills', () => {
  test('should return true for unit with no status effects', () => {
    const unit = createMockPlayerUnit({ statusEffects: [] });
    assert.strictEqual(battleService.canUnitUseSkills(unit), true);
  });

  test('should return false when silenced', () => {
    const unit = createMockPlayerUnit({
      statusEffects: [{ type: 'silence', duration: 2 }]
    });
    assert.strictEqual(battleService.canUnitUseSkills(unit), false);
  });

  test('should return false when stunned', () => {
    const unit = createMockPlayerUnit({
      statusEffects: [{ type: 'stun', duration: 2 }]
    });
    assert.strictEqual(battleService.canUnitUseSkills(unit), false);
  });

  test('should return true with non-skill-preventing effects', () => {
    const unit = createMockPlayerUnit({
      statusEffects: [{ type: 'root', duration: 3 }] // Root only prevents movement
    });
    assert.strictEqual(battleService.canUnitUseSkills(unit), true);
  });
});

describe('applyStatusEffect', () => {
  test('should add new status effect', () => {
    const unit = createMockPlayerUnit({ statusEffects: [] });
    const isNew = battleService.applyStatusEffect(unit, 'poison', 3);

    assert.strictEqual(isNew, true, 'Should return true for new effect');
    assert.strictEqual(unit.statusEffects.length, 1);
    assert.strictEqual(unit.statusEffects[0].type, 'poison');
    assert.strictEqual(unit.statusEffects[0].duration, 3);
  });

  test('should refresh existing effect duration', () => {
    const unit = createMockPlayerUnit({
      statusEffects: [{ type: 'poison', duration: 1 }]
    });
    const isNew = battleService.applyStatusEffect(unit, 'poison', 5);

    assert.strictEqual(isNew, false, 'Should return false for existing effect');
    assert.strictEqual(unit.statusEffects.length, 1);
    assert.strictEqual(unit.statusEffects[0].duration, 5, 'Duration should refresh to higher value');
  });

  test('should not reduce duration if existing is higher', () => {
    const unit = createMockPlayerUnit({
      statusEffects: [{ type: 'stun', duration: 5 }]
    });
    battleService.applyStatusEffect(unit, 'stun', 2);

    assert.strictEqual(unit.statusEffects[0].duration, 5, 'Should keep higher duration');
  });

  test('should initialize statusEffects array if undefined', () => {
    const unit = createMockPlayerUnit({});
    delete unit.statusEffects;

    battleService.applyStatusEffect(unit, 'burn', 3);

    assert.ok(Array.isArray(unit.statusEffects), 'Should initialize array');
    assert.strictEqual(unit.statusEffects.length, 1);
  });

  test('should use default duration of 3', () => {
    const unit = createMockPlayerUnit({ statusEffects: [] });
    battleService.applyStatusEffect(unit, 'slow');

    assert.strictEqual(unit.statusEffects[0].duration, 3, 'Default duration should be 3');
  });
});

// =============================================================================
// MOVEMENT AND RANGE TESTS
// =============================================================================

describe('getMovementRange', () => {
  test('should return class-specific movement for warrior', () => {
    const unit = createMockPlayerUnit({ class: 'warrior' });
    const range = battleService.getMovementRange(unit);
    assert.strictEqual(range, 3, 'Warrior should have 3 movement');
  });

  test('should return class-specific movement for monk', () => {
    const unit = createMockPlayerUnit({ class: 'monk' });
    const range = battleService.getMovementRange(unit);
    assert.strictEqual(range, 4, 'Monk should have 4 movement');
  });

  test('should return class-specific movement for ninja', () => {
    const unit = createMockPlayerUnit({ class: 'ninja' });
    const range = battleService.getMovementRange(unit);
    assert.strictEqual(range, 5, 'Ninja should have 5 movement');
  });

  test('should return default 3 for unknown class', () => {
    const unit = createMockPlayerUnit({ class: 'unknown_class' });
    const range = battleService.getMovementRange(unit);
    assert.strictEqual(range, 3, 'Unknown class should default to 3');
  });

  test('should reduce movement by 1 when slowed', () => {
    const unit = createMockPlayerUnit({
      class: 'warrior',
      statusEffects: [{ type: 'slow', duration: 2 }]
    });
    const range = battleService.getMovementRange(unit);
    assert.strictEqual(range, 2, 'Slow should reduce movement by 1');
  });

  test('should increase movement by 1 when hasted', () => {
    const unit = createMockPlayerUnit({
      class: 'warrior',
      statusEffects: [{ type: 'haste', duration: 2 }]
    });
    const range = battleService.getMovementRange(unit);
    assert.strictEqual(range, 4, 'Haste should increase movement by 1');
  });

  test('should have minimum 1 movement when heavily slowed', () => {
    const unit = createMockPlayerUnit({
      class: 'sorcerer', // 2 base movement
      statusEffects: [{ type: 'slow', duration: 2 }]
    });
    const range = battleService.getMovementRange(unit);
    assert.strictEqual(range, 1, 'Minimum movement should be 1');
  });
});

describe('getAttackRange', () => {
  test('should return unit attack range if specified', () => {
    const unit = createMockPlayerUnit({ attackRange: 3 });
    const range = battleService.getAttackRange(unit);
    assert.strictEqual(range, 3);
  });

  test('should return default 1 for melee units', () => {
    const unit = createMockPlayerUnit({});
    delete unit.attackRange;
    const range = battleService.getAttackRange(unit);
    assert.strictEqual(range, 1, 'Default attack range should be 1');
  });
});

describe('getReachableTiles', () => {
  test('should return empty array if unit cannot move', () => {
    const unit = createMockPlayerUnit({
      tileX: 5,
      tileY: 5,
      class: 'warrior',
      statusEffects: [{ type: 'stun', duration: 2 }]
    });
    const state = createMockBattleState({ units: [unit] });

    const tiles = battleService.getReachableTiles(unit, state);

    assert.strictEqual(tiles.length, 0, 'Stunned unit should have no reachable tiles');
  });

  test('should return tiles based on movement range', () => {
    const unit = createMockPlayerUnit({
      tileX: 5,
      tileY: 5,
      class: 'warrior', // 3 movement
      statusEffects: []
    });
    const state = createMockBattleState({
      units: [unit],
      terrain: [],
      mapWidth: 32,
      mapHeight: 32
    });

    const tiles = battleService.getReachableTiles(unit, state);

    // With 3 movement range, there should be multiple reachable tiles
    assert.ok(tiles.length > 0, 'Should return reachable tiles');
  });
});

// =============================================================================
// MANHATTAN DISTANCE TESTS
// =============================================================================

describe('getManhattanDistance', () => {
  test('should calculate distance correctly for same position', () => {
    const dist = battleService.getManhattanDistance(5, 5, 5, 5);
    assert.strictEqual(dist, 0);
  });

  test('should calculate horizontal distance', () => {
    const dist = battleService.getManhattanDistance(0, 0, 5, 0);
    assert.strictEqual(dist, 5);
  });

  test('should calculate vertical distance', () => {
    const dist = battleService.getManhattanDistance(0, 0, 0, 7);
    assert.strictEqual(dist, 7);
  });

  test('should calculate diagonal distance (sum of x and y)', () => {
    const dist = battleService.getManhattanDistance(2, 3, 5, 8);
    assert.strictEqual(dist, 8); // |5-2| + |8-3| = 3 + 5 = 8
  });

  test('should handle negative coordinates', () => {
    const dist = battleService.getManhattanDistance(-2, -3, 2, 3);
    assert.strictEqual(dist, 10); // |2-(-2)| + |3-(-3)| = 4 + 6 = 10
  });
});

// =============================================================================
// AOE TILES TESTS
// =============================================================================

describe('getAoETiles', () => {
  test('should return center tile for radius 0', () => {
    const tiles = battleService.getAoETiles(5, 5, 0, 'circle');
    assert.strictEqual(tiles.length, 1);
    assert.deepStrictEqual(tiles[0], { x: 5, y: 5, isCenter: true });
  });

  test('should return diamond shape for circle pattern radius 1', () => {
    const tiles = battleService.getAoETiles(5, 5, 1, 'circle');

    // Radius 1 circle should have 5 tiles: center + 4 adjacent
    assert.strictEqual(tiles.length, 5);

    // Should include center
    assert.ok(tiles.some(t => t.x === 5 && t.y === 5 && t.isCenter),
      'Should include center tile');

    // Should include cardinal directions
    assert.ok(tiles.some(t => t.x === 4 && t.y === 5), 'Should include west');
    assert.ok(tiles.some(t => t.x === 6 && t.y === 5), 'Should include east');
    assert.ok(tiles.some(t => t.x === 5 && t.y === 4), 'Should include north');
    assert.ok(tiles.some(t => t.x === 5 && t.y === 6), 'Should include south');
  });

  test('should return cross pattern correctly', () => {
    const tiles = battleService.getAoETiles(5, 5, 2, 'cross');

    // Cross pattern: center + 2 tiles in each cardinal direction = 1 + 8 = 9
    assert.strictEqual(tiles.length, 9);

    // Should include center
    assert.ok(tiles.some(t => t.x === 5 && t.y === 5 && t.isCenter));

    // Should extend 2 tiles in each direction
    assert.ok(tiles.some(t => t.x === 3 && t.y === 5), 'Should extend 2 west');
    assert.ok(tiles.some(t => t.x === 7 && t.y === 5), 'Should extend 2 east');
  });

  test('should return line pattern in specified direction', () => {
    // Direction 2 = East
    const tiles = battleService.getAoETiles(5, 5, 3, 'line', 2);

    assert.strictEqual(tiles.length, 4); // Start + 3 tiles
    assert.ok(tiles.some(t => t.x === 5 && t.y === 5 && t.isCenter), 'Should start at center');
    assert.ok(tiles.some(t => t.x === 8 && t.y === 5), 'Should extend 3 tiles east');
  });
});

// =============================================================================
// TURN STATE TESTS
// =============================================================================

describe('resetTurnState', () => {
  test('should reset all turn flags', () => {
    const unit = createMockPlayerUnit({
      moveUsed: true,
      actUsed: true,
      turnPhase: 'done',
      hasActed: true
    });

    battleService.resetTurnState(unit);

    assert.strictEqual(unit.moveUsed, false);
    assert.strictEqual(unit.actUsed, false);
    assert.strictEqual(unit.turnPhase, 'ready');
    assert.strictEqual(unit.hasActed, false);
  });
});

describe('shouldAutoEndTurn', () => {
  test('should return true when unit cannot move or act', () => {
    const unit = createMockPlayerUnit({
      moveUsed: true,
      actUsed: true,
      statusEffects: []
    });

    assert.strictEqual(battleService.shouldAutoEndTurn(unit), true);
  });

  test('should return false when unit can still move', () => {
    const unit = createMockPlayerUnit({
      moveUsed: false,
      actUsed: true,
      statusEffects: []
    });

    assert.strictEqual(battleService.shouldAutoEndTurn(unit), false);
  });

  test('should return false when unit can still act', () => {
    const unit = createMockPlayerUnit({
      moveUsed: true,
      actUsed: false,
      statusEffects: []
    });

    assert.strictEqual(battleService.shouldAutoEndTurn(unit), false);
  });

  test('should return true when stunned (cannot move or act)', () => {
    const unit = createMockPlayerUnit({
      moveUsed: false,
      actUsed: false,
      statusEffects: [{ type: 'stun', duration: 2 }]
    });

    assert.strictEqual(battleService.shouldAutoEndTurn(unit), true);
  });
});

// =============================================================================
// CT-BASED TURN SYSTEM TESTS
// =============================================================================

describe('CT System', () => {
  test('initializeCT should set initial CT based on agility', () => {
    const units = [
      createMockPlayerUnit({ id: 'p1', agility: 10, ct: 0 }),
      createMockEnemyUnit({ id: 'e1', agility: 20, ct: 0 })
    ];

    withSeededRandom(12345, () => {
      battleService.initializeCT(units);
    });

    // CT should be set to some value based on agility * random
    units.forEach(u => {
      assert.ok(typeof u.ct === 'number', 'CT should be set');
    });
  });

  test('getNextActor should return unit with CT >= 100', () => {
    const units = [
      createMockPlayerUnit({ id: 'p1', agility: 10, ct: 50, hp: 100 }),
      createMockEnemyUnit({ id: 'e1', agility: 20, ct: 150, hp: 50 })
    ];
    const state = { units };

    const next = battleService.getNextActor(state);

    assert.strictEqual(next.id, 'e1', 'Should return unit with highest CT >= 100');
  });

  test('getNextActor should return null if no unit has CT >= 100', () => {
    const units = [
      createMockPlayerUnit({ id: 'p1', agility: 10, ct: 50, hp: 100 }),
      createMockEnemyUnit({ id: 'e1', agility: 20, ct: 80, hp: 50 })
    ];
    const state = { units };

    const next = battleService.getNextActor(state);

    assert.strictEqual(next, null, 'Should return null if no unit ready');
  });

  test('consumeCT should subtract 100 from unit CT', () => {
    const unit = createMockPlayerUnit({ ct: 150 });

    battleService.consumeCT(unit);

    assert.strictEqual(unit.ct, 50, 'CT should be reduced by 100');
  });

  test('consumeCT should not let CT go negative', () => {
    const unit = createMockPlayerUnit({ ct: 80 });

    battleService.consumeCT(unit);

    assert.strictEqual(unit.ct, 0, 'CT should not go below 0');
  });

  test('predictTurnOrder should return predicted turns', () => {
    const units = [
      createMockPlayerUnit({ id: 'p1', agility: 10, ct: 90, hp: 100 }),
      createMockEnemyUnit({ id: 'e1', agility: 15, ct: 80, hp: 50 })
    ];
    const state = { units };

    const predictions = battleService.predictTurnOrder(state, 5);

    assert.strictEqual(predictions.length, 5, 'Should predict 5 turns');
    predictions.forEach(p => {
      assert.ok(p.id, 'Each prediction should have an id');
      assert.ok(p.type, 'Each prediction should have a type');
    });
  });

  test('advanceCTUntilReady should increment CT until threshold reached', () => {
    const units = [
      createMockPlayerUnit({ id: 'p1', agility: 10, ct: 0, hp: 100 }),
      createMockEnemyUnit({ id: 'e1', agility: 20, ct: 0, hp: 50 })
    ];
    const state = { units };

    battleService.advanceCTUntilReady(state);

    // At least one unit should now have CT >= 100
    const readyUnit = units.find(u => u.ct >= 100);
    assert.ok(readyUnit, 'At least one unit should be ready after advancing CT');
  });

  test('getNextActor tie-breaker should prefer players over enemies', () => {
    const units = [
      createMockEnemyUnit({ id: 'e1', agility: 15, ct: 100, hp: 50 }),
      createMockPlayerUnit({ id: 'p1', agility: 15, ct: 100, hp: 100 })
    ];
    const state = { units };

    const next = battleService.getNextActor(state);

    // With same CT and agility, player should go first
    assert.strictEqual(next.id, 'p1', 'Player should have priority in ties');
  });
});

// =============================================================================
// BATTLE END CHECK TESTS
// =============================================================================

describe('checkBattleEnd', () => {
  test('should return victory when all enemies defeated', () => {
    const state = createMockBattleState({
      units: [
        createMockPlayerUnit({ hp: 50 }),
        createMockEnemyUnit({ hp: 0 })
      ]
    });

    assert.strictEqual(battleService.checkBattleEnd(state), 'victory');
  });

  test('should return defeat when all players defeated', () => {
    const state = createMockBattleState({
      units: [
        createMockPlayerUnit({ hp: 0 }),
        createMockEnemyUnit({ hp: 50 })
      ]
    });

    assert.strictEqual(battleService.checkBattleEnd(state), 'defeat');
  });

  test('should return active when both sides have units alive', () => {
    const state = createMockBattleState({
      units: [
        createMockPlayerUnit({ hp: 50 }),
        createMockEnemyUnit({ hp: 50 })
      ]
    });

    assert.strictEqual(battleService.checkBattleEnd(state), 'active');
  });

  test('should return victory with multiple dead enemies', () => {
    const state = createMockBattleState({
      units: [
        createMockPlayerUnit({ hp: 50 }),
        createMockPlayerUnit({ id: 'p2', hp: 30 }),
        createMockEnemyUnit({ hp: 0 }),
        createMockEnemyUnit({ id: 'e2', hp: 0 }),
        createMockEnemyUnit({ id: 'e3', hp: 0 })
      ]
    });

    assert.strictEqual(battleService.checkBattleEnd(state), 'victory');
  });

  test('should return defeat with multiple dead players', () => {
    const state = createMockBattleState({
      units: [
        createMockPlayerUnit({ hp: 0 }),
        createMockPlayerUnit({ id: 'p2', hp: 0 }),
        createMockEnemyUnit({ hp: 20 })
      ]
    });

    assert.strictEqual(battleService.checkBattleEnd(state), 'defeat');
  });
});

// =============================================================================
// CHARGE TIME SYSTEM TESTS
// =============================================================================

describe('Charge Time System', () => {
  test('calculateChargeTime should return 0 for no MP cost skills', () => {
    const unit = createMockPlayerUnit({ agility: 10, intelligence: 10 });
    const skill = { mpCost: 0 };

    const ct = battleService.calculateChargeTime(unit, skill);

    assert.strictEqual(ct, 0, 'Skills without MP cost should have no charge time');
  });

  test('calculateChargeTime should scale with MP cost', () => {
    const unit = createMockPlayerUnit({ agility: 10, intelligence: 10 });
    const lowCostSkill = { mpCost: 10 };
    const highCostSkill = { mpCost: 30 };

    const lowCT = battleService.calculateChargeTime(unit, lowCostSkill);
    const highCT = battleService.calculateChargeTime(unit, highCostSkill);

    assert.ok(highCT > lowCT, 'Higher MP cost should have longer charge time');
  });

  test('calculateChargeTime should be reduced by agility', () => {
    const slowUnit = createMockPlayerUnit({ agility: 10, intelligence: 10 });
    const fastUnit = createMockPlayerUnit({ agility: 50, intelligence: 10 });
    const skill = { mpCost: 20 };

    const slowCT = battleService.calculateChargeTime(slowUnit, skill);
    const fastCT = battleService.calculateChargeTime(fastUnit, skill);

    assert.ok(fastCT < slowCT, 'Higher agility should reduce charge time');
  });

  test('calculateChargeTime should clamp between 10 and 50', () => {
    const unit = createMockPlayerUnit({ agility: 100, intelligence: 100 });

    const lowSkill = { mpCost: 1 };
    const lowCT = battleService.calculateChargeTime(unit, lowSkill);
    assert.ok(lowCT >= 10, 'Minimum charge time should be 10');

    const highUnit = createMockPlayerUnit({ agility: 1, intelligence: 1 });
    const highSkill = { mpCost: 100 };
    const highCT = battleService.calculateChargeTime(highUnit, highSkill);
    assert.ok(highCT <= 50, 'Maximum charge time should be 50');
  });

  test('startCharging should set charging state', () => {
    const unit = createMockPlayerUnit({});
    const skillId = 'fireball';
    const targetTile = { x: 5, y: 5 };
    const chargeTime = 20;

    battleService.startCharging(unit, skillId, targetTile, chargeTime);

    assert.strictEqual(unit.isCharging, true);
    assert.strictEqual(unit.chargingSkill.skillId, skillId);
    assert.deepStrictEqual(unit.chargingSkill.targetTile, targetTile);
    assert.strictEqual(unit.chargingSkill.chargeTime, chargeTime);
    assert.strictEqual(unit.chargingSkill.chargeRemaining, chargeTime);
  });

  test('cancelCharging should clear charging state', () => {
    const unit = createMockPlayerUnit({
      isCharging: true,
      chargingSkill: { skillId: 'fireball', chargeRemaining: 10 },
      chargeStartCT: 50
    });

    battleService.cancelCharging(unit);

    assert.strictEqual(unit.isCharging, false);
    assert.strictEqual(unit.chargingSkill, null);
    assert.strictEqual(unit.chargeStartCT, null);
  });

  test('updateChargeProgress should decrement remaining charge', () => {
    const unit = createMockPlayerUnit({
      isCharging: true,
      chargingSkill: { skillId: 'fireball', chargeRemaining: 20 }
    });

    const complete = battleService.updateChargeProgress(unit, 5);

    assert.strictEqual(unit.chargingSkill.chargeRemaining, 15);
    assert.strictEqual(complete, false);
  });

  test('updateChargeProgress should return true when charge completes', () => {
    const unit = createMockPlayerUnit({
      isCharging: true,
      chargingSkill: { skillId: 'fireball', chargeRemaining: 5 }
    });

    const complete = battleService.updateChargeProgress(unit, 10);

    assert.strictEqual(complete, true);
  });

  test('getChargingDamageMultiplier should return 1.25', () => {
    const multiplier = battleService.getChargingDamageMultiplier();
    assert.strictEqual(multiplier, 1.25);
  });

  test('checkChargeInterrupt should have 10% chance', () => {
    let interrupts = 0;
    const trials = 1000;

    for (let seed = 0; seed < trials; seed++) {
      const result = withSeededRandom(seed, () => {
        return battleService.checkChargeInterrupt();
      });
      if (result) interrupts++;
    }

    // With 10% chance, expect roughly 100 interrupts (+/- 50 for variance)
    assert.ok(interrupts > 50 && interrupts < 150,
      'Interrupt rate ' + interrupts + '/1000 should be around 10%');
  });
});

// =============================================================================
// TARGETS IN RANGE TESTS
// =============================================================================

describe('getTargetsInRange', () => {
  test('should find enemy targets within range', () => {
    const attacker = createMockPlayerUnit({ id: 'p1', tileX: 5, tileY: 5 });
    const enemy1 = createMockEnemyUnit({ id: 'e1', tileX: 6, tileY: 5, hp: 50 }); // Distance 1
    const enemy2 = createMockEnemyUnit({ id: 'e2', tileX: 10, tileY: 10, hp: 50 }); // Distance 10

    const state = createMockBattleState({
      units: [attacker, enemy1, enemy2]
    });

    const targets = battleService.getTargetsInRange(attacker, state, 2, 'enemy');

    assert.strictEqual(targets.length, 1, 'Should only find enemy within range 2');
    assert.strictEqual(targets[0].unitId, 'e1');
  });

  test('should not include dead units as targets', () => {
    const attacker = createMockPlayerUnit({ id: 'p1', tileX: 5, tileY: 5 });
    const deadEnemy = createMockEnemyUnit({ id: 'e1', tileX: 6, tileY: 5, hp: 0 });

    const state = createMockBattleState({
      units: [attacker, deadEnemy]
    });

    const targets = battleService.getTargetsInRange(attacker, state, 2, 'enemy');

    assert.strictEqual(targets.length, 0, 'Should not include dead enemies');
  });

  test('should not include self as target', () => {
    const attacker = createMockPlayerUnit({ id: 'p1', tileX: 5, tileY: 5 });

    const state = createMockBattleState({
      units: [attacker]
    });

    const targets = battleService.getTargetsInRange(attacker, state, 5, 'player');

    assert.strictEqual(targets.length, 0, 'Should not include self');
  });

  test('should find allies when targetType is ally', () => {
    const unit = createMockPlayerUnit({ id: 'p1', tileX: 5, tileY: 5 });
    const ally = createMockPlayerUnit({ id: 'p2', tileX: 6, tileY: 5, hp: 50 });
    const enemy = createMockEnemyUnit({ id: 'e1', tileX: 7, tileY: 5, hp: 50 });

    const state = createMockBattleState({
      units: [unit, ally, enemy]
    });

    const targets = battleService.getTargetsInRange(unit, state, 3, 'ally');

    assert.strictEqual(targets.length, 1, 'Should find ally');
    assert.strictEqual(targets[0].unitId, 'p2');
  });
});

// =============================================================================
// UTILITY FUNCTION TESTS
// =============================================================================

describe('getOppositeType', () => {
  test('should return enemy for player', () => {
    assert.strictEqual(battleService.getOppositeType('player'), 'enemy');
  });

  test('should return player for enemy', () => {
    assert.strictEqual(battleService.getOppositeType('enemy'), 'player');
  });
});
