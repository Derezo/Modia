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
  finalizeStatusEffects,
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

describe('zodiac healing received', () => {
  test('boosts player regeneration status healing', () => {
    const unit = createMockPlayerUnit({
      hp: 50,
      maxHp: 2000,
      zodiacCollectionBonus: { healingReceived: 0.03 },
      statusEffects: [{ type: 'regen', duration: 2 }]
    });

    const results = processStatusEffects(unit);

    assert.strictEqual(unit.hp, 153);
    assert.ok(results.some(result =>
      result.type === 'regen_heal' && result.amount === 103
    ));
  });

  test('does not boost enemy regeneration even if enemy state has a modifier', () => {
    const unit = createMockEnemyUnit({
      hp: 50,
      maxHp: 2000,
      zodiacCollectionBonus: { healingReceived: 0.50 },
      statusEffects: [{ type: 'regen', duration: 2 }]
    });

    processStatusEffects(unit);

    assert.strictEqual(unit.hp, 150);
  });
});

describe('authoritative owner-turn status lifecycle', () => {
  test('processes poison, burn, regeneration, and zodiac poison together', () => {
    const unit = createMockPlayerUnit({
      hp: 1000,
      maxHp: 1000,
      statusEffects: [
        { type: 'poison', duration: 2 },
        { type: 'burn', duration: 2 },
        { type: 'regen', duration: 2 },
        { type: 'zodiac_poison', duration: 2, damagePercent: 0.03 }
      ]
    });

    const results = processStatusEffects(unit);

    assert.strictEqual(unit.hp, 940);
    assert.deepStrictEqual(
      results.map(result => [result.type, result.damage ?? result.amount]),
      [
        ['poison_damage', 50],
        ['burn_damage', 30],
        ['regen_heal', 50],
        ['zodiac_poison', 30]
      ]
    );
  });

  test('keeps duration-1 restrictions active until owner turn finalization', () => {
    const unit = createMockPlayerUnit({
      statusEffects: [{ type: 'stun', duration: 1 }]
    });

    processStatusEffects(unit);

    assert.strictEqual(canUnitAct(unit), false);
    assert.strictEqual(unit.statusEffects[0].duration, 0);
    assert.strictEqual(unit.statusEffects[0].expiresAfterTurn, true);

    const expired = finalizeStatusEffects(unit);
    assert.deepStrictEqual(expired, [{
      type: 'effect_expired',
      effect: 'stun'
    }]);
    assert.strictEqual(canUnitAct(unit), true);
  });

  test('applies zodiac poison for exactly four owner turns', () => {
    const unit = createMockPlayerUnit({
      hp: 100,
      maxHp: 100,
      statusEffects: [{
        type: 'zodiac_poison',
        duration: 4,
        damagePercent: 0.03
      }]
    });

    for (let turn = 1; turn <= 4; turn++) {
      processStatusEffects(unit);
      assert.strictEqual(unit.hp, 100 - (turn * 3));
      if (turn < 4) {
        assert.strictEqual(finalizeStatusEffects(unit).length, 0);
        assert.strictEqual(unit.statusEffects.length, 1);
      }
    }

    assert.strictEqual(unit.statusEffects[0].expiresAfterTurn, true);
    finalizeStatusEffects(unit);
    assert.strictEqual(unit.statusEffects.length, 0);
  });

  test('Moonshield blocks only the first periodic damage instance', () => {
    const unit = createMockPlayerUnit({
      hp: 100,
      maxHp: 100,
      damageShield: 1,
      statusEffects: [
        { type: 'poison', duration: 2 },
        { type: 'burn', duration: 2 }
      ]
    });

    const results = processStatusEffects(unit);

    assert.strictEqual(unit.hp, 97);
    assert.strictEqual(unit.damageShield, 0);
    assert.strictEqual(results[0].blockedBy, 'moonshield');
    assert.strictEqual(results[0].damage, 0);
    assert.strictEqual(results[1].damage, 3);
    assert.strictEqual(unit.damageTaken, 3);
  });

  test("counts Mountain's Endurance activation turn toward its two turns", () => {
    const unit = createMockPlayerUnit({
      zodiacAbilities: [{
        key: 'mountains_endurance',
        name: "Mountain's Endurance"
      }],
      statusEffects: []
    });
    const state = createMockBattleState({
      activeUnitId: unit.id,
      units: [unit]
    });

    // Turn 1 already started before the free Zodiac action is activated.
    const result = applyZodiacAbility(state, unit, 'mountains_endurance');
    assert.strictEqual(result.success, true);
    assert.strictEqual(getDefenseMultiplier(unit), 1.25);
    assert.strictEqual(finalizeStatusEffects(unit).length, 0);
    assert.strictEqual(getDefenseMultiplier(unit), 1.25);

    // Turn 2 is the one remaining owner turn.
    processStatusEffects(unit);
    assert.strictEqual(getDefenseMultiplier(unit), 1.25);
    finalizeStatusEffects(unit);
    assert.strictEqual(getDefenseMultiplier(unit), 1);

    // Turn 3 begins without the buff.
    processStatusEffects(unit);
    assert.strictEqual(getDefenseMultiplier(unit), 1);
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

  test('allows one use per owning party while preserving another owner use', () => {
    const ability = [{ key: 'rams_charge', name: "Ram's Charge" }];
    const firstPartyUnit = createMockPlayerUnit({
      id: 'party_1',
      ownerId: 10,
      zodiacAbilities: ability
    });
    const secondPartyUnit = createMockPlayerUnit({
      id: 'party_2',
      ownerId: 10,
      zodiacAbilities: ability
    });
    const opposingPlayer = createMockPlayerUnit({
      id: 'opponent_1',
      ownerId: 20,
      zodiacAbilities: ability
    });
    const state = createMockBattleState({
      units: [firstPartyUnit, secondPartyUnit, opposingPlayer]
    });

    const firstUse = applyZodiacAbility(
      state,
      firstPartyUnit,
      'rams_charge'
    );
    const duplicatePartyUse = applyZodiacAbility(
      state,
      secondPartyUnit,
      'rams_charge'
    );
    const opposingUse = applyZodiacAbility(
      state,
      opposingPlayer,
      'rams_charge'
    );

    assert.strictEqual(firstUse.success, true);
    assert.ok(firstPartyUnit.usedZodiacAbilities.includes('rams_charge'));
    assert.ok(secondPartyUnit.usedZodiacAbilities.includes('rams_charge'));
    assert.strictEqual(duplicatePartyUse.success, false);
    assert.match(duplicatePartyUse.error, /already been used/);
    assert.strictEqual(opposingUse.success, true);
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
    assert.strictEqual(
      defenseEffect.duration,
      1,
      'activation turn consumes the first advertised turn'
    );
    assert.strictEqual(result.effects[0].duration, 2);
    assert.deepStrictEqual(defenseEffect.modifiers, {
      defense: 1.25,
      magicDefense: 1.25
    });
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

  test('targets opposing Coliseum players by team for offensive abilities', () => {
    const attacker = createMockPlayerUnit({
      id: 'pvp_1',
      ownerId: 10,
      teamId: 1,
      tileX: 5,
      tileY: 5,
      attackRange: 3,
      zodiacAbilities: [
        { key: 'roar', name: 'Roar' },
        { key: 'venom_sting', name: 'Venom Sting' },
        { key: 'dreamwave', name: 'Dreamwave' }
      ]
    });
    const ally = createMockPlayerUnit({
      id: 'pvp_ally',
      ownerId: 10,
      teamId: 1,
      tileX: 4,
      tileY: 5,
      hp: 50,
      ct: 80
    });
    const opponent = createMockPlayerUnit({
      id: 'pvp_2',
      ownerId: 20,
      teamId: 2,
      tileX: 6,
      tileY: 5,
      hp: 50,
      ct: 80,
      statusEffects: []
    });
    const state = createMockBattleState({
      units: [attacker, ally, opponent]
    });

    const roarResult = applyZodiacAbility(state, attacker, 'roar');
    const venomResult = applyZodiacAbility(
      state,
      attacker,
      'venom_sting',
      opponent
    );
    const dreamwaveResult = applyZodiacAbility(
      state,
      attacker,
      'dreamwave',
      opponent
    );

    assert.strictEqual(roarResult.success, true);
    assert.strictEqual(ally.ct, 80);
    assert.strictEqual(opponent.ct, 50);
    assert.strictEqual(venomResult.success, true);
    assert.ok(opponent.statusEffects.some(
      effect => effect.type === 'zodiac_poison'
    ));
    assert.strictEqual(dreamwaveResult.success, true);
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

  test('should purify zodiac poison', () => {
    const unit = createMockPlayerUnit({
      zodiacAbilities: [{ key: 'purify', name: 'Purify' }],
      statusEffects: [{
        type: 'zodiac_poison',
        duration: 4,
        damagePercent: 0.03
      }]
    });
    const state = createMockBattleState({ units: [unit] });

    const result = applyZodiacAbility(state, unit, 'purify');

    assert.strictEqual(result.success, true);
    assert.strictEqual(unit.statusEffects.length, 0);
    assert.strictEqual(result.effects[0].effect, 'zodiac_poison');
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

  test('uses materialized range for targeted Zodiac abilities without double counting traits', () => {
    for (const abilityKey of ['venom_sting', 'dreamwave']) {
      const attacker = createMockPlayerUnit({
        id: `p1_${abilityKey}`,
        tileX: 5,
        tileY: 5,
        attackRange: 2,
        traits: [{
          name: 'Eagle Eye',
          effectType: 'range_bonus',
          effectValue: 1
        }],
        nextAttackRangeBonus: 2,
        zodiacAbilities: [{
          key: abilityKey,
          name: abilityKey
        }]
      });
      const target = createMockEnemyUnit({
        id: `e1_${abilityKey}`,
        tileX: 10,
        tileY: 5,
        hp: 50,
        statusEffects: []
      });
      const state = createMockBattleState({ units: [attacker, target] });

      const outOfRange = applyZodiacAbility(
        state,
        attacker,
        abilityKey,
        target
      );

      assert.strictEqual(outOfRange.success, false, abilityKey);
      assert.match(outOfRange.error, /out of range/);
      target.tileX = 9;
      target.x = 9;

      const inRange = applyZodiacAbility(
        state,
        attacker,
        abilityKey,
        target
      );

      assert.strictEqual(inRange.success, true, abilityKey);
      assert.strictEqual(
        attacker.nextAttackRangeBonus,
        2,
        `${abilityKey} must not consume Celestial Arrow`
      );
    }
  });

  test('defaults targeted Zodiac abilities to melee range', () => {
    for (const abilityKey of ['venom_sting', 'dreamwave']) {
      const attacker = createMockPlayerUnit({
        id: `p1_${abilityKey}`,
        tileX: 5,
        tileY: 5,
        zodiacAbilities: [{
          key: abilityKey,
          name: abilityKey
        }]
      });
      delete attacker.attackRange;
      const target = createMockEnemyUnit({
        id: `e1_${abilityKey}`,
        tileX: 7,
        tileY: 5,
        hp: 50,
        statusEffects: []
      });
      const state = createMockBattleState({ units: [attacker, target] });

      const result = applyZodiacAbility(
        state,
        attacker,
        abilityKey,
        target
      );

      assert.strictEqual(result.success, false, abilityKey);
      assert.match(result.error, /out of range/);
    }
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
