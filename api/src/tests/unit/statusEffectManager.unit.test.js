/**
 * Unit tests for statusEffectManager.js
 * Tests status effect processing, zodiac abilities, and turn state management
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert';
import {
  createMockPlayerUnit,
  createMockEnemyUnit,
  createMockBattleState,
  withSeededRandom
} from '../testUtils/index.js';
import {
  processStatusEffects,
  canUnitAct,
  canUnitMove,
  canUnitUseSkills,
  resetTurnState,
  shouldAutoEndTurn,
  applyStatusEffect,
  initializeTurnState,
  hasZodiacAbility,
  getAvailableZodiacAbility,
  getAvailableZodiacAbilities,
  markZodiacAbilityUsed,
  applyZodiacAbility,
  processZodiacPoison,
  checkMoonshield,
  getDefenseMultiplier
} from '../../services/battle/statusEffectManager.js';

// =============================================================================
// TURN STATE MANAGEMENT TESTS
// =============================================================================

describe('initializeTurnState', () => {
  test('should initialize turn state when not present', () => {
    const unit = createMockPlayerUnit({});
    delete unit.moveUsed;
    delete unit.actUsed;
    delete unit.turnPhase;

    initializeTurnState(unit);

    assert.strictEqual(unit.moveUsed, false);
    assert.strictEqual(unit.actUsed, false);
    assert.strictEqual(unit.turnPhase, 'ready');
  });

  test('should not overwrite existing turn state', () => {
    const unit = createMockPlayerUnit({
      moveUsed: true,
      actUsed: true,
      turnPhase: 'done'
    });

    initializeTurnState(unit);

    assert.strictEqual(unit.moveUsed, true);
    assert.strictEqual(unit.actUsed, true);
    assert.strictEqual(unit.turnPhase, 'done');
  });
});

// =============================================================================
// ZODIAC ABILITY TESTS
// =============================================================================

describe('hasZodiacAbility', () => {
  test('should return true when unit has the ability', () => {
    const unit = createMockPlayerUnit({
      zodiacAbilities: [
        { key: 'rams_charge', name: "Ram's Charge" },
        { key: 'moonshield', name: 'Moonshield' }
      ]
    });

    assert.strictEqual(hasZodiacAbility(unit, 'rams_charge'), true);
    assert.strictEqual(hasZodiacAbility(unit, 'moonshield'), true);
  });

  test('should return false when unit does not have the ability', () => {
    const unit = createMockPlayerUnit({
      zodiacAbilities: [{ key: 'rams_charge', name: "Ram's Charge" }]
    });

    assert.strictEqual(hasZodiacAbility(unit, 'moonshield'), false);
  });

  test('should return false when zodiacAbilities is undefined', () => {
    const unit = createMockPlayerUnit({});
    delete unit.zodiacAbilities;

    assert.strictEqual(hasZodiacAbility(unit, 'rams_charge'), false);
  });

  test('should return false when zodiacAbilities is not an array', () => {
    const unit = createMockPlayerUnit({ zodiacAbilities: null });

    assert.strictEqual(hasZodiacAbility(unit, 'rams_charge'), false);
  });
});

describe('getAvailableZodiacAbility', () => {
  test('should return first unused ability', () => {
    const unit = createMockPlayerUnit({
      zodiacAbilities: [
        { key: 'rams_charge', name: "Ram's Charge" },
        { key: 'moonshield', name: 'Moonshield' }
      ],
      usedZodiacAbilities: ['rams_charge']
    });

    const ability = getAvailableZodiacAbility(unit);

    assert.strictEqual(ability.key, 'moonshield');
  });

  test('should return null when all abilities used', () => {
    const unit = createMockPlayerUnit({
      zodiacAbilities: [{ key: 'rams_charge', name: "Ram's Charge" }],
      usedZodiacAbilities: ['rams_charge']
    });

    const ability = getAvailableZodiacAbility(unit);

    assert.strictEqual(ability, null);
  });

  test('should return null when no zodiac abilities', () => {
    const unit = createMockPlayerUnit({});
    delete unit.zodiacAbilities;

    const ability = getAvailableZodiacAbility(unit);

    assert.strictEqual(ability, null);
  });

  test('should initialize usedZodiacAbilities if not present', () => {
    const unit = createMockPlayerUnit({
      zodiacAbilities: [{ key: 'rams_charge', name: "Ram's Charge" }]
    });
    delete unit.usedZodiacAbilities;

    getAvailableZodiacAbility(unit);

    assert.ok(Array.isArray(unit.usedZodiacAbilities));
  });
});

describe('getAvailableZodiacAbilities', () => {
  test('should return all unused abilities', () => {
    const unit = createMockPlayerUnit({
      zodiacAbilities: [
        { key: 'rams_charge', name: "Ram's Charge" },
        { key: 'moonshield', name: 'Moonshield' },
        { key: 'twin_strike', name: 'Twin Strike' }
      ],
      usedZodiacAbilities: ['rams_charge']
    });

    const abilities = getAvailableZodiacAbilities(unit);

    assert.strictEqual(abilities.length, 2);
    assert.ok(abilities.some(a => a.key === 'moonshield'));
    assert.ok(abilities.some(a => a.key === 'twin_strike'));
  });

  test('should return empty array when all abilities used', () => {
    const unit = createMockPlayerUnit({
      zodiacAbilities: [{ key: 'rams_charge', name: "Ram's Charge" }],
      usedZodiacAbilities: ['rams_charge']
    });

    const abilities = getAvailableZodiacAbilities(unit);

    assert.strictEqual(abilities.length, 0);
  });

  test('should return empty array when no zodiac abilities', () => {
    const unit = createMockPlayerUnit({});
    delete unit.zodiacAbilities;

    const abilities = getAvailableZodiacAbilities(unit);

    assert.strictEqual(abilities.length, 0);
  });
});

describe('markZodiacAbilityUsed', () => {
  test('should add ability to used list', () => {
    const unit = createMockPlayerUnit({
      usedZodiacAbilities: []
    });

    markZodiacAbilityUsed(unit, 'rams_charge');

    assert.ok(unit.usedZodiacAbilities.includes('rams_charge'));
  });

  test('should initialize usedZodiacAbilities if not present', () => {
    const unit = createMockPlayerUnit({});
    delete unit.usedZodiacAbilities;

    markZodiacAbilityUsed(unit, 'moonshield');

    assert.ok(Array.isArray(unit.usedZodiacAbilities));
    assert.ok(unit.usedZodiacAbilities.includes('moonshield'));
  });

  test('should not add duplicate entries', () => {
    const unit = createMockPlayerUnit({
      usedZodiacAbilities: ['rams_charge']
    });

    markZodiacAbilityUsed(unit, 'rams_charge');

    assert.strictEqual(unit.usedZodiacAbilities.length, 1);
  });
});

describe('applyZodiacAbility', () => {
  test('should fail if unit does not have ability', () => {
    const unit = createMockPlayerUnit({
      zodiacAbilities: []
    });
    const state = createMockBattleState({ units: [unit] });

    const result = applyZodiacAbility(state, unit, 'rams_charge');

    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('does not have'));
  });

  test('should fail if ability already used', () => {
    const unit = createMockPlayerUnit({
      zodiacAbilities: [{ key: 'rams_charge', name: "Ram's Charge" }],
      usedZodiacAbilities: ['rams_charge']
    });
    const state = createMockBattleState({ units: [unit] });

    const result = applyZodiacAbility(state, unit, 'rams_charge');

    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('already been used'));
  });

  test('should apply rams_charge correctly', () => {
    const unit = createMockPlayerUnit({
      zodiacAbilities: [{ key: 'rams_charge', name: "Ram's Charge" }]
    });
    const state = createMockBattleState({ units: [unit] });

    const result = applyZodiacAbility(state, unit, 'rams_charge');

    assert.strictEqual(result.success, true);
    assert.strictEqual(unit.nextAttackCritBonus, 0.25);
    assert.ok(unit.usedZodiacAbilities.includes('rams_charge'));
  });

  test('should apply moonshield correctly', () => {
    const unit = createMockPlayerUnit({
      zodiacAbilities: [{ key: 'moonshield', name: 'Moonshield' }]
    });
    const state = createMockBattleState({ units: [unit] });

    const result = applyZodiacAbility(state, unit, 'moonshield');

    assert.strictEqual(result.success, true);
    assert.strictEqual(unit.damageShield, 1);
  });

  test('should apply twin_strike correctly', () => {
    const unit = createMockPlayerUnit({
      zodiacAbilities: [{ key: 'twin_strike', name: 'Twin Strike' }]
    });
    const state = createMockBattleState({ units: [unit] });

    const result = applyZodiacAbility(state, unit, 'twin_strike');

    assert.strictEqual(result.success, true);
    assert.strictEqual(unit.nextAttackHitsTwice, true);
    assert.strictEqual(unit.twinStrikeDamageMultiplier, 0.6);
  });

  test('should apply unmovable correctly', () => {
    const unit = createMockPlayerUnit({
      zodiacAbilities: [{ key: 'unmovable', name: 'Unmovable' }],
      statusEffects: []
    });
    const state = createMockBattleState({ units: [unit] });

    const result = applyZodiacAbility(state, unit, 'unmovable');

    assert.strictEqual(result.success, true);
    assert.ok(unit.statusEffects.some(e => e.type === 'unmovable'));
  });

  test('should apply balance (lifesteal) correctly', () => {
    const unit = createMockPlayerUnit({
      zodiacAbilities: [{ key: 'balance', name: 'Balance' }]
    });
    const state = createMockBattleState({ units: [unit] });

    const result = applyZodiacAbility(state, unit, 'balance');

    assert.strictEqual(result.success, true);
    assert.strictEqual(unit.nextAttackLifesteal, true);
  });

  test('should apply celestial_arrow correctly', () => {
    const unit = createMockPlayerUnit({
      zodiacAbilities: [{ key: 'celestial_arrow', name: 'Celestial Arrow' }]
    });
    const state = createMockBattleState({ units: [unit] });

    const result = applyZodiacAbility(state, unit, 'celestial_arrow');

    assert.strictEqual(result.success, true);
    assert.strictEqual(unit.nextAttackRangeBonus, 2);
  });

  test('should apply mountains_endurance correctly', () => {
    const unit = createMockPlayerUnit({
      zodiacAbilities: [{ key: 'mountains_endurance', name: "Mountain's Endurance" }],
      statusEffects: []
    });
    const state = createMockBattleState({ units: [unit] });

    const result = applyZodiacAbility(state, unit, 'mountains_endurance');

    assert.strictEqual(result.success, true);
    const defenseEffect = unit.statusEffects.find(e => e.type === 'defense_up');
    assert.ok(defenseEffect);
    assert.strictEqual(defenseEffect.value, 0.25);
    assert.strictEqual(defenseEffect.duration, 2);
  });

  test('should apply cascade (heal) correctly', () => {
    const unit = createMockPlayerUnit({
      hp: 50,
      maxHp: 100,
      zodiacAbilities: [{ key: 'cascade', name: 'Cascade' }]
    });
    const state = createMockBattleState({ units: [unit] });

    const result = applyZodiacAbility(state, unit, 'cascade');

    assert.strictEqual(result.success, true);
    assert.strictEqual(unit.hp, 70); // 50 + 20% of 100
  });

  test('should apply roar to adjacent enemies', () => {
    const player = createMockPlayerUnit({
      id: 'p1',
      tileX: 5,
      tileY: 5,
      type: 'player',
      zodiacAbilities: [{ key: 'roar', name: 'Roar' }]
    });
    const adjacentEnemy = createMockEnemyUnit({
      id: 'e1',
      tileX: 6,
      tileY: 5,
      hp: 50,
      ct: 80
    });
    const farEnemy = createMockEnemyUnit({
      id: 'e2',
      tileX: 10,
      tileY: 10,
      hp: 50,
      ct: 80
    });
    const state = createMockBattleState({
      units: [player, adjacentEnemy, farEnemy]
    });

    const result = applyZodiacAbility(state, player, 'roar');

    assert.strictEqual(result.success, true);
    assert.strictEqual(adjacentEnemy.ct, 50); // 80 - 30
    assert.strictEqual(farEnemy.ct, 80); // Unchanged (too far)
  });

  test('should apply purify to remove debuff', () => {
    const unit = createMockPlayerUnit({
      zodiacAbilities: [{ key: 'purify', name: 'Purify' }],
      statusEffects: [{ type: 'poison', duration: 3 }]
    });
    const state = createMockBattleState({ units: [unit] });

    const result = applyZodiacAbility(state, unit, 'purify');

    assert.strictEqual(result.success, true);
    assert.strictEqual(unit.statusEffects.length, 0);
  });

  test('should handle purify when no debuffs present', () => {
    const unit = createMockPlayerUnit({
      zodiacAbilities: [{ key: 'purify', name: 'Purify' }],
      statusEffects: []
    });
    const state = createMockBattleState({ units: [unit] });

    const result = applyZodiacAbility(state, unit, 'purify');

    assert.strictEqual(result.success, true);
    assert.ok(result.message.includes('No debuffs'));
  });

  test('should apply venom_sting to target', () => {
    const attacker = createMockPlayerUnit({
      id: 'p1',
      tileX: 5,
      tileY: 5,
      type: 'player',
      attackRange: 3,
      zodiacAbilities: [{ key: 'venom_sting', name: 'Venom Sting' }]
    });
    const target = createMockEnemyUnit({
      id: 'e1',
      tileX: 6,
      tileY: 5,
      hp: 50,
      statusEffects: []
    });
    const state = createMockBattleState({ units: [attacker, target] });

    const result = applyZodiacAbility(state, attacker, 'venom_sting', target);

    assert.strictEqual(result.success, true);
    assert.ok(target.statusEffects.some(e => e.type === 'zodiac_poison'));
  });

  test('should fail venom_sting without target', () => {
    const attacker = createMockPlayerUnit({
      zodiacAbilities: [{ key: 'venom_sting', name: 'Venom Sting' }]
    });
    const state = createMockBattleState({ units: [attacker] });

    const result = applyZodiacAbility(state, attacker, 'venom_sting', null);

    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('requires a target'));
  });

  test('should fail venom_sting on ally', () => {
    const attacker = createMockPlayerUnit({
      id: 'p1',
      type: 'player',
      zodiacAbilities: [{ key: 'venom_sting', name: 'Venom Sting' }]
    });
    const ally = createMockPlayerUnit({
      id: 'p2',
      type: 'player',
      tileX: 6,
      tileY: 5,
      hp: 50
    });
    const state = createMockBattleState({ units: [attacker, ally] });

    const result = applyZodiacAbility(state, attacker, 'venom_sting', ally);

    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('Cannot poison allies'));
  });

  test('should fail venom_sting on dead target', () => {
    const attacker = createMockPlayerUnit({
      id: 'p1',
      type: 'player',
      zodiacAbilities: [{ key: 'venom_sting', name: 'Venom Sting' }]
    });
    const target = createMockEnemyUnit({
      id: 'e1',
      hp: 0,
      tileX: 6,
      tileY: 5
    });
    const state = createMockBattleState({ units: [attacker, target] });

    const result = applyZodiacAbility(state, attacker, 'venom_sting', target);

    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('already defeated'));
  });

  test('should fail venom_sting when target out of range', () => {
    const attacker = createMockPlayerUnit({
      id: 'p1',
      tileX: 0,
      tileY: 0,
      type: 'player',
      attackRange: 2,
      zodiacAbilities: [{ key: 'venom_sting', name: 'Venom Sting' }]
    });
    const target = createMockEnemyUnit({
      id: 'e1',
      tileX: 10,
      tileY: 10,
      hp: 50,
      statusEffects: []
    });
    const state = createMockBattleState({ units: [attacker, target] });

    const result = applyZodiacAbility(state, attacker, 'venom_sting', target);

    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('out of range'));
  });

  test('should apply dreamwave with 50% success rate', () => {
    let sleepCount = 0;
    let resistCount = 0;
    const trials = 100;

    for (let seed = 0; seed < trials; seed++) {
      const result = withSeededRandom(seed, () => {
        const attacker = createMockPlayerUnit({
          id: 'p1',
          tileX: 5,
          tileY: 5,
          type: 'player',
          attackRange: 3,
          zodiacAbilities: [{ key: 'dreamwave', name: 'Dreamwave' }]
        });
        const target = createMockEnemyUnit({
          id: 'e1',
          tileX: 6,
          tileY: 5,
          hp: 50,
          statusEffects: []
        });
        const state = createMockBattleState({ units: [attacker, target] });
        return applyZodiacAbility(state, attacker, 'dreamwave', target);
      });

      if (result.effects.some(e => e.effect === 'sleep')) {
        sleepCount++;
      } else if (result.effects.some(e => e.type === 'resisted')) {
        resistCount++;
      }
    }

    // Should be around 50% each with variance
    assert.ok(sleepCount > 25 && sleepCount < 75,
      `Sleep rate ${sleepCount}/100 should be around 50%`);
    assert.ok(resistCount > 25 && resistCount < 75,
      `Resist rate ${resistCount}/100 should be around 50%`);
  });

  test('should fail for unknown ability', () => {
    const unit = createMockPlayerUnit({
      zodiacAbilities: [{ key: 'unknown_ability', name: 'Unknown' }]
    });
    const state = createMockBattleState({ units: [unit] });

    const result = applyZodiacAbility(state, unit, 'unknown_ability');

    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('Unknown zodiac ability'));
  });
});

describe('processZodiacPoison', () => {
  test('should deal 3% max HP damage', () => {
    const unit = createMockPlayerUnit({
      hp: 100,
      maxHp: 100,
      statusEffects: [{ type: 'zodiac_poison', duration: 3, damagePercent: 0.03 }]
    });

    const result = processZodiacPoison(unit);

    assert.strictEqual(result.type, 'zodiac_poison');
    assert.strictEqual(result.damage, 3);
    assert.strictEqual(unit.hp, 97);
  });

  test('should decrement duration', () => {
    const unit = createMockPlayerUnit({
      hp: 100,
      maxHp: 100,
      statusEffects: [{ type: 'zodiac_poison', duration: 3, damagePercent: 0.03 }]
    });

    processZodiacPoison(unit);

    assert.strictEqual(unit.statusEffects[0].duration, 2);
  });

  test('should remove effect when duration expires', () => {
    const unit = createMockPlayerUnit({
      hp: 100,
      maxHp: 100,
      statusEffects: [{ type: 'zodiac_poison', duration: 1, damagePercent: 0.03 }]
    });

    processZodiacPoison(unit);

    assert.strictEqual(unit.statusEffects.length, 0);
  });

  test('should return null when no zodiac poison', () => {
    const unit = createMockPlayerUnit({
      hp: 100,
      maxHp: 100,
      statusEffects: []
    });

    const result = processZodiacPoison(unit);

    assert.strictEqual(result, null);
  });

  test('should return null when statusEffects undefined', () => {
    const unit = createMockPlayerUnit({});
    delete unit.statusEffects;

    const result = processZodiacPoison(unit);

    assert.strictEqual(result, null);
  });

  test('should not reduce HP below 0', () => {
    const unit = createMockPlayerUnit({
      hp: 1,
      maxHp: 100,
      statusEffects: [{ type: 'zodiac_poison', duration: 3, damagePercent: 0.03 }]
    });

    processZodiacPoison(unit);

    assert.strictEqual(unit.hp, 0);
  });
});

describe('checkMoonshield', () => {
  test('should block damage when shield is active', () => {
    const unit = createMockPlayerUnit({ damageShield: 1 });

    const result = checkMoonshield(unit, 50);

    assert.strictEqual(result.blocked, true);
    assert.strictEqual(result.damage, 0);
    assert.strictEqual(unit.damageShield, 0);
  });

  test('should not block when no shield', () => {
    const unit = createMockPlayerUnit({ damageShield: 0 });

    const result = checkMoonshield(unit, 50);

    assert.strictEqual(result.blocked, false);
    assert.strictEqual(result.damage, 50);
  });

  test('should not block when damageShield undefined', () => {
    const unit = createMockPlayerUnit({});
    delete unit.damageShield;

    const result = checkMoonshield(unit, 50);

    assert.strictEqual(result.blocked, false);
    assert.strictEqual(result.damage, 50);
  });
});

describe('getDefenseMultiplier', () => {
  test('should return 1.0 when no defense_up effect', () => {
    const unit = createMockPlayerUnit({ statusEffects: [] });

    const multiplier = getDefenseMultiplier(unit);

    assert.strictEqual(multiplier, 1.0);
  });

  test('should return multiplier from defense_up effect', () => {
    const unit = createMockPlayerUnit({
      statusEffects: [{ type: 'defense_up', duration: 2, value: 0.25 }]
    });

    const multiplier = getDefenseMultiplier(unit);

    assert.strictEqual(multiplier, 1.25);
  });

  test('should return 1.0 when statusEffects undefined', () => {
    const unit = createMockPlayerUnit({});
    delete unit.statusEffects;

    const multiplier = getDefenseMultiplier(unit);

    assert.strictEqual(multiplier, 1.0);
  });

  test('should return 1.0 when defense_up has no value', () => {
    const unit = createMockPlayerUnit({
      statusEffects: [{ type: 'defense_up', duration: 2 }]
    });

    const multiplier = getDefenseMultiplier(unit);

    assert.strictEqual(multiplier, 1.0);
  });
});
