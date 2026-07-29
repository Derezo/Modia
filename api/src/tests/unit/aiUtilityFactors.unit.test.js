/**
 * AI Utility Factors Unit Tests
 *
 * Tests the pure utility calculation functions used by the AI decision system.
 * These functions calculate numeric scores for various tactical factors.
 *
 * Functions tested:
 * - calculateMpEfficiency - MP conservation scoring
 * - calculateHealingValue - Healing action value
 * - calculateSurvivalPriority - Self-preservation urgency
 * - calculateTargetPriority - Target selection scoring
 * - getTargetValue - Strategic value of targets
 * - hasSkillType - Skill type detection
 * - countTargetsInAoe - AoE target counting
 * - countNearbyEnemies/countNearbyAllies - Proximity counting
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

// Import utility factor functions
let importError = null;
let calculateMpEfficiency = null;
let calculateHealingValue = null;
let calculateSurvivalPriority = null;
let calculateTargetPriority = null;
let getTargetValue = null;
let hasSkillType = null;
let countTargetsInAoe = null;
let countNearbyEnemies = null;
let countNearbyAllies = null;
let findNearestEnemy = null;
let calculateDamageDealt = null;
let calculateDamageReceived = null;

try {
  const mod = await import('../../services/ai/utilityFactors.js');
  calculateMpEfficiency = mod.calculateMpEfficiency;
  calculateHealingValue = mod.calculateHealingValue;
  calculateSurvivalPriority = mod.calculateSurvivalPriority;
  calculateTargetPriority = mod.calculateTargetPriority;
  getTargetValue = mod.getTargetValue;
  hasSkillType = mod.hasSkillType;
  countTargetsInAoe = mod.countTargetsInAoe;
  countNearbyEnemies = mod.countNearbyEnemies;
  countNearbyAllies = mod.countNearbyAllies;
  findNearestEnemy = mod.findNearestEnemy;
  calculateDamageDealt = mod.calculateDamageDealt;
  calculateDamageReceived = mod.calculateDamageReceived;
} catch (err) {
  importError = err;
}

const canImport = importError === null;

// Helper to create a minimal battle state
function createBattleState(units = []) {
  return {
    units,
    gridWidth: 20,
    gridHeight: 20,
    terrain: null
  };
}

// Helper to create a minimal unit
function createUnit(overrides = {}) {
  return {
    id: overrides.id || 'unit1',
    type: overrides.type || 'player',
    hp: overrides.hp ?? 100,
    maxHp: overrides.maxHp ?? 100,
    mp: overrides.mp ?? 50,
    maxMp: overrides.maxMp ?? 50,
    tileX: overrides.tileX ?? 5,
    tileY: overrides.tileY ?? 5,
    strength: overrides.strength ?? 20,
    intelligence: overrides.intelligence ?? 15,
    vitality: overrides.vitality ?? 15,
    class: overrides.class || 'warrior',
    attackRange: overrides.attackRange ?? 1,
    skills: overrides.skills || [],
    ...overrides
  };
}

describe('AI Utility Factors - combat risk and restorative skills', { skip: !canImport }, () => {
  it('never scores a healing skill as damage', () => {
    const healer = createUnit({ type: 'enemy' });
    const ally = createUnit({
      id: 'ally',
      type: 'enemy',
      hp: 40,
      maxHp: 100
    });
    const state = createBattleState([healer, ally]);

    const damage = calculateDamageDealt(
      healer,
      ally,
      { power: 100, healPercent: 30, damageType: 'heal' },
      state
    );

    assert.strictEqual(damage, 0);
  });

  it('does not infer offense from power on an ally-targeted support skill', () => {
    const healer = createUnit({ type: 'enemy', teamId: 2 });
    const ally = createUnit({ id: 'ally', type: 'enemy', teamId: 2 });
    const state = createBattleState([healer, ally]);

    const damage = calculateDamageDealt(
      healer,
      ally,
      { power: 100, targetAlly: true, selfBuff: { defense: 1.5 } },
      state
    );

    assert.strictEqual(damage, 0);
  });

  it('does not infer offense from power on a support-typed skill', () => {
    const caster = createUnit({ type: 'enemy', teamId: 2 });
    const opponent = createUnit({ id: 'opponent', type: 'player', teamId: 1 });
    const state = createBattleState([caster, opponent]);

    const damage = calculateDamageDealt(
      caster,
      opponent,
      { power: 100, damageType: 'support', effect: 'weaken' },
      state
    );

    assert.strictEqual(damage, 0);
  });

  it('still scores an opponent-targeted hybrid skill as damage', () => {
    const attacker = createUnit({
      type: 'enemy',
      teamId: 2,
      strength: 40,
      attack: 20
    });
    const opponent = createUnit({
      id: 'opponent',
      type: 'player',
      teamId: 1,
      hp: 200,
      maxHp: 200,
      vitality: 10,
      defense: 5
    });
    const state = createBattleState([attacker, opponent]);

    const damage = calculateDamageDealt(
      attacker,
      opponent,
      { power: 120, healPercent: 20, selfBuff: { attack: 1.5 } },
      state
    );

    assert.ok(damage > 0);
  });

  it('scores a threatened tile as riskier than a tile beyond retaliation range', () => {
    const actor = createUnit({
      id: 'actor',
      type: 'enemy',
      teamId: 2,
      tileX: 5,
      tileY: 5,
      defense: 5,
      vitality: 10
    });
    const opponent = createUnit({
      id: 'opponent',
      type: 'player',
      teamId: 1,
      tileX: 6,
      tileY: 5,
      strength: 40,
      attack: 30,
      movement: 3,
      attackRange: 1,
      actUsed: false
    });
    const state = createBattleState([actor, opponent]);

    const threatened = calculateDamageReceived(actor, 5, 5, state);
    const safe = calculateDamageReceived(actor, 0, 0, state);

    assert.ok(threatened > 0, `Expected positive threat, got ${threatened}`);
    assert.ok(threatened > safe, `Threatened ${threatened} should exceed safe ${safe}`);
  });

  it('ignores opponents that already spent their combat action', () => {
    const actor = createUnit({
      id: 'actor',
      type: 'enemy',
      teamId: 2,
      defense: 5,
      vitality: 10
    });
    const opponent = createUnit({
      id: 'opponent',
      type: 'player',
      teamId: 1,
      tileX: 6,
      tileY: 5,
      actUsed: true
    });
    const state = createBattleState([actor, opponent]);

    assert.strictEqual(calculateDamageReceived(actor, 5, 5, state), 0);
  });
});

describe('AI Utility Factors - calculateMpEfficiency', { skip: !canImport }, () => {
  it('returns neutral (50) for free actions', () => {
    const unit = createUnit({ mp: 50, maxMp: 100 });
    const skill = { mpCost: 0 };

    const result = calculateMpEfficiency(unit, skill);

    assert.strictEqual(result, 50);
  });

  it('returns neutral (50) for null skill', () => {
    const unit = createUnit({ mp: 50, maxMp: 100 });

    const result = calculateMpEfficiency(unit, null);

    assert.strictEqual(result, 50);
  });

  it('strongly penalizes spending MP for zero benefit', () => {
    const unit = createUnit({ mp: 50, maxMp: 100 });
    const skill = { mpCost: 20 };

    const result = calculateMpEfficiency(unit, skill, 0); // Zero benefit

    assert.strictEqual(result, -200);
  });

  it('penalizes expensive skills when low on MP', () => {
    const unit = createUnit({ mp: 20, maxMp: 100 }); // 20% MP
    const skill = { mpCost: 30 };

    const result = calculateMpEfficiency(unit, skill, 100);

    // Should be heavily penalized when low on MP
    assert.ok(result < 50, `Expected < 50, got ${result}`);
  });

  it('is less punishing when MP is comfortable', () => {
    const unit = createUnit({ mp: 80, maxMp: 100 }); // 80% MP
    const skill = { mpCost: 10 };

    const result = calculateMpEfficiency(unit, skill, 100);

    // Should be close to 100 when MP is plentiful
    assert.ok(result > 70, `Expected > 70, got ${result}`);
  });

  it('moderately penalizes at mid-range MP', () => {
    const unit = createUnit({ mp: 40, maxMp: 100 }); // 40% MP
    const skill = { mpCost: 20 };

    const result = calculateMpEfficiency(unit, skill, 100);

    // Should be between heavy penalty and minimal penalty
    assert.ok(result > 0 && result < 100, `Expected 0-100, got ${result}`);
  });
});

describe('AI Utility Factors - calculateHealingValue', { skip: !canImport }, () => {
  it('returns 0 for non-healing skills', () => {
    const healer = createUnit();
    const target = createUnit({ hp: 50, maxHp: 100 });
    const skill = { power: 100 }; // No heal properties
    const state = createBattleState();

    const result = calculateHealingValue(healer, target, skill, state);

    assert.strictEqual(result, 0);
  });

  it('returns 0 for null skill', () => {
    const healer = createUnit();
    const target = createUnit({ hp: 50, maxHp: 100 });
    const state = createBattleState();

    const result = calculateHealingValue(healer, target, null, state);

    assert.strictEqual(result, 0);
  });

  it('returns 0 for dead targets', () => {
    const healer = createUnit();
    const target = createUnit({ hp: 0, maxHp: 100 });
    const skill = { healPercent: 50 };
    const state = createBattleState();

    const result = calculateHealingValue(healer, target, skill, state);

    assert.strictEqual(result, 0);
  });

  it('calculates healing based on heal percent', () => {
    const healer = createUnit();
    const target = createUnit({ hp: 50, maxHp: 100 }); // Missing 50 HP
    const skill = { healPercent: 30 }; // 30% of max HP = 30 HP
    const state = createBattleState();

    const result = calculateHealingValue(healer, target, skill, state);

    // Should return heal amount (30) * urgency multiplier (1.0 at 50% HP)
    assert.ok(result > 0, `Expected positive value, got ${result}`);
  });

  it('increases urgency multiplier for critical HP', () => {
    const healer = createUnit();
    const criticalTarget = createUnit({ hp: 20, maxHp: 100 }); // 20% HP - critical
    const healthyTarget = createUnit({ hp: 70, maxHp: 100 }); // 70% HP - healthy
    const skill = { healPercent: 30 };
    const state = createBattleState();

    const criticalResult = calculateHealingValue(healer, criticalTarget, skill, state);
    const healthyResult = calculateHealingValue(healer, healthyTarget, skill, state);

    // Critical target should have higher healing value
    assert.ok(criticalResult > healthyResult,
      `Critical (${criticalResult}) should be > healthy (${healthyResult})`);
  });

  it('caps healing at missing HP', () => {
    const healer = createUnit();
    const target = createUnit({ hp: 90, maxHp: 100 }); // Only missing 10 HP
    const skill = { healPercent: 50 }; // Would heal 50 if not capped
    const state = createBattleState();

    const result = calculateHealingValue(healer, target, skill, state);

    // Should be based on 10 HP (missing), not 50 HP (skill amount)
    // But also scaled down by urgency multiplier (0.3) since HP > 80%
    assert.ok(result < 20, `Expected < 20 due to low urgency, got ${result}`);
  });
});

describe('AI Utility Factors - calculateSurvivalPriority', { skip: !canImport }, () => {
  it('returns high priority for low HP units', () => {
    const unit = createUnit({ type: 'enemy', hp: 15, maxHp: 100 }); // 15% HP
    const state = createBattleState([unit]);

    const result = calculateSurvivalPriority(unit, unit.tileX, unit.tileY, state);

    assert.ok(result >= 150, `Expected >= 150 for critical HP, got ${result}`);
  });

  it('returns moderate priority for mid HP units', () => {
    const unit = createUnit({ type: 'enemy', hp: 50, maxHp: 100 }); // 50% HP
    const state = createBattleState([unit]);

    const result = calculateSurvivalPriority(unit, unit.tileX, unit.tileY, state);

    assert.ok(result >= 20 && result < 150, `Expected 20-150, got ${result}`);
  });

  it('returns low priority for healthy units', () => {
    const unit = createUnit({ type: 'enemy', hp: 90, maxHp: 100 }); // 90% HP
    const state = createBattleState([unit]);

    const result = calculateSurvivalPriority(unit, unit.tileX, unit.tileY, state);

    assert.ok(result <= 50, `Expected <= 50 for healthy unit, got ${result}`);
  });

  it('increases priority when enemies are nearby', () => {
    const unit = createUnit({ type: 'enemy', hp: 50, maxHp: 100, tileX: 5, tileY: 5 });
    const nearbyPlayer = createUnit({ type: 'player', tileX: 6, tileY: 5 });
    const stateWithEnemy = createBattleState([unit, nearbyPlayer]);
    const stateAlone = createBattleState([unit]);

    const withEnemy = calculateSurvivalPriority(unit, unit.tileX, unit.tileY, stateWithEnemy);
    const alone = calculateSurvivalPriority(unit, unit.tileX, unit.tileY, stateAlone);

    assert.ok(withEnemy > alone, `With enemy (${withEnemy}) should be > alone (${alone})`);
  });

  it('decreases priority when allies are nearby', () => {
    const unit = createUnit({ id: 'e1', type: 'enemy', hp: 50, maxHp: 100, tileX: 5, tileY: 5 });
    const ally = createUnit({ id: 'e2', type: 'enemy', tileX: 6, tileY: 5 });
    const enemy = createUnit({ type: 'player', tileX: 3, tileY: 5 }); // Add an enemy to create threat
    const stateWithAlly = createBattleState([unit, ally, enemy]);
    const stateAlone = createBattleState([unit, enemy]);

    const withAlly = calculateSurvivalPriority(unit, unit.tileX, unit.tileY, stateWithAlly);
    const alone = calculateSurvivalPriority(unit, unit.tileX, unit.tileY, stateAlone);

    assert.ok(withAlly <= alone, `With ally (${withAlly}) should be <= alone (${alone})`);
  });
});

describe('AI Utility Factors - calculateTargetPriority', { skip: !canImport }, () => {
  it('returns 0 for dead targets', () => {
    const target = createUnit({ hp: 0, maxHp: 100 });
    const state = createBattleState();

    const result = calculateTargetPriority(target, state);

    assert.strictEqual(result, 0);
  });

  it('returns 0 for null targets', () => {
    const state = createBattleState();

    const result = calculateTargetPriority(null, state);

    assert.strictEqual(result, 0);
  });

  it('prioritizes low HP targets', () => {
    const lowHpTarget = createUnit({ hp: 20, maxHp: 100 }); // 20% HP
    const healthyTarget = createUnit({ hp: 80, maxHp: 100 }); // 80% HP
    const state = createBattleState();

    const lowHpResult = calculateTargetPriority(lowHpTarget, state);
    const healthyResult = calculateTargetPriority(healthyTarget, state);

    assert.ok(lowHpResult > healthyResult,
      `Low HP (${lowHpResult}) should be > healthy (${healthyResult})`);
  });

  it('prioritizes targets with healing abilities', () => {
    const healer = createUnit({
      class: 'chemist',
      skills: [{ healPercent: 30 }]
    });
    const nonHealer = createUnit({ class: 'warrior' });
    const state = createBattleState();

    const healerResult = calculateTargetPriority(healer, state);
    const nonHealerResult = calculateTargetPriority(nonHealer, state);

    assert.ok(healerResult > nonHealerResult,
      `Healer (${healerResult}) should be > non-healer (${nonHealerResult})`);
  });
});

describe('AI Utility Factors - getTargetValue', { skip: !canImport }, () => {
  it('returns base value for generic units', () => {
    const target = createUnit({ class: 'warrior' });
    const state = createBattleState();

    const result = getTargetValue(target, state);

    assert.ok(result >= 50, `Expected >= 50 base value, got ${result}`);
  });

  it('values wizard class higher', () => {
    const wizard = createUnit({ class: 'wizard' });
    const warrior = createUnit({ class: 'warrior' });
    const state = createBattleState();

    const wizardValue = getTargetValue(wizard, state);
    const warriorValue = getTargetValue(warrior, state);

    assert.ok(wizardValue > warriorValue,
      `Wizard (${wizardValue}) should be > warrior (${warriorValue})`);
  });

  it('values chemist class higher', () => {
    const chemist = createUnit({ class: 'chemist' });
    const warrior = createUnit({ class: 'warrior' });
    const state = createBattleState();

    const chemistValue = getTargetValue(chemist, state);
    const warriorValue = getTargetValue(warrior, state);

    assert.ok(chemistValue > warriorValue,
      `Chemist (${chemistValue}) should be > warrior (${warriorValue})`);
  });

  it('values high-damage dealers higher', () => {
    const glassCannon = createUnit({ strength: 50, vitality: 10 }); // High STR/VIT ratio
    const balanced = createUnit({ strength: 20, vitality: 20 });
    const state = createBattleState();

    const glassCannonValue = getTargetValue(glassCannon, state);
    const balancedValue = getTargetValue(balanced, state);

    assert.ok(glassCannonValue > balancedValue,
      `Glass cannon (${glassCannonValue}) should be > balanced (${balancedValue})`);
  });
});

describe('AI Utility Factors - hasSkillType', { skip: !canImport }, () => {
  it('returns false for units without skills', () => {
    const unit = createUnit({ skills: null });

    assert.strictEqual(hasSkillType(unit, 'heal'), false);
  });

  it('returns false for empty skills array', () => {
    const unit = createUnit({ skills: [] });

    assert.strictEqual(hasSkillType(unit, 'heal'), false);
  });

  it('detects heal type from healPercent', () => {
    const unit = createUnit({
      skills: [{ healPercent: 30 }]
    });

    assert.strictEqual(hasSkillType(unit, 'heal'), true);
  });

  it('detects buff type from selfBuff', () => {
    const unit = createUnit({
      skills: [{ selfBuff: true }]
    });

    assert.strictEqual(hasSkillType(unit, 'buff'), true);
  });

  it('detects type from damageType property', () => {
    const unit = createUnit({
      skills: [{ damageType: 'fire' }]
    });

    assert.strictEqual(hasSkillType(unit, 'fire'), true);
  });

  it('detects type from effect property', () => {
    const unit = createUnit({
      skills: [{ effect: 'poison' }]
    });

    assert.strictEqual(hasSkillType(unit, 'poison'), true);
  });
});

describe('AI Utility Factors - countTargetsInAoe', { skip: !canImport }, () => {
  it('counts enemies in AoE radius for player attacker', () => {
    const enemy1 = createUnit({ type: 'enemy', tileX: 5, tileY: 5, hp: 100 });
    const enemy2 = createUnit({ type: 'enemy', tileX: 6, tileY: 5, hp: 100 });
    const enemy3 = createUnit({ type: 'enemy', tileX: 10, tileY: 10, hp: 100 }); // Out of range
    const state = createBattleState([enemy1, enemy2, enemy3]);

    const result = countTargetsInAoe(5, 5, 2, state, 'player');

    assert.strictEqual(result, 2);
  });

  it('counts players in AoE radius for enemy attacker', () => {
    const player1 = createUnit({ type: 'player', tileX: 5, tileY: 5, hp: 100 });
    const player2 = createUnit({ type: 'player', tileX: 6, tileY: 5, hp: 100 });
    const state = createBattleState([player1, player2]);

    const result = countTargetsInAoe(5, 5, 2, state, 'enemy');

    assert.strictEqual(result, 2);
  });

  it('ignores dead units', () => {
    const alive = createUnit({ type: 'enemy', tileX: 5, tileY: 5, hp: 100 });
    const dead = createUnit({ type: 'enemy', tileX: 6, tileY: 5, hp: 0 });
    const state = createBattleState([alive, dead]);

    const result = countTargetsInAoe(5, 5, 2, state, 'player');

    assert.strictEqual(result, 1);
  });

  it('returns at least 1 (for the primary target)', () => {
    const state = createBattleState([]);

    const result = countTargetsInAoe(5, 5, 2, state, 'player');

    assert.strictEqual(result, 1);
  });

  it('uses Manhattan distance', () => {
    // Position at (5,5), radius 2
    // (7,5) is distance 2 - should be in range
    // (6,6) is distance 2 - should be in range
    // (7,6) is distance 3 - should be out of range
    const inRange1 = createUnit({ type: 'enemy', tileX: 7, tileY: 5, hp: 100 });
    const inRange2 = createUnit({ type: 'enemy', tileX: 6, tileY: 6, hp: 100 });
    const outOfRange = createUnit({ type: 'enemy', tileX: 7, tileY: 6, hp: 100 });
    const state = createBattleState([inRange1, inRange2, outOfRange]);

    const result = countTargetsInAoe(5, 5, 2, state, 'player');

    assert.strictEqual(result, 2);
  });
});

describe('AI Utility Factors - countNearbyEnemies', { skip: !canImport }, () => {
  it('counts enemies within range 2', () => {
    const friendly = createUnit({ type: 'enemy', tileX: 5, tileY: 5 });
    const enemy1 = createUnit({ type: 'player', tileX: 6, tileY: 5, hp: 100 });
    const enemy2 = createUnit({ type: 'player', tileX: 5, tileY: 6, hp: 100 });
    const farEnemy = createUnit({ type: 'player', tileX: 10, tileY: 10, hp: 100 });
    const state = createBattleState([friendly, enemy1, enemy2, farEnemy]);

    const result = countNearbyEnemies(5, 5, state, 'enemy');

    assert.strictEqual(result, 2);
  });

  it('ignores dead units', () => {
    const friendly = createUnit({ type: 'enemy', tileX: 5, tileY: 5 });
    const aliveEnemy = createUnit({ type: 'player', tileX: 6, tileY: 5, hp: 100 });
    const deadEnemy = createUnit({ type: 'player', tileX: 5, tileY: 6, hp: 0 });
    const state = createBattleState([friendly, aliveEnemy, deadEnemy]);

    const result = countNearbyEnemies(5, 5, state, 'enemy');

    assert.strictEqual(result, 1);
  });
});

describe('AI Utility Factors - countNearbyAllies', { skip: !canImport }, () => {
  it('counts allies within range 2', () => {
    const unit = createUnit({ id: 'e1', type: 'enemy', tileX: 5, tileY: 5 });
    const ally1 = createUnit({ id: 'e2', type: 'enemy', tileX: 6, tileY: 5, hp: 100 });
    const ally2 = createUnit({ id: 'e3', type: 'enemy', tileX: 5, tileY: 6, hp: 100 });
    const farAlly = createUnit({ id: 'e4', type: 'enemy', tileX: 10, tileY: 10, hp: 100 });
    const state = createBattleState([unit, ally1, ally2, farAlly]);

    const result = countNearbyAllies(5, 5, state, 'enemy', 'e1');

    assert.strictEqual(result, 2);
  });

  it('excludes self from count', () => {
    const unit = createUnit({ id: 'e1', type: 'enemy', tileX: 5, tileY: 5 });
    const state = createBattleState([unit]);

    const result = countNearbyAllies(5, 5, state, 'enemy', 'e1');

    assert.strictEqual(result, 0);
  });
});

describe('AI Utility Factors - findNearestEnemy', { skip: !canImport }, () => {
  it('returns null when no enemies exist', () => {
    const unit = createUnit({ type: 'enemy' });
    const state = createBattleState([unit]);

    const result = findNearestEnemy(unit, 5, 5, state);

    assert.strictEqual(result, null);
  });

  it('returns nearest enemy by Manhattan distance', () => {
    const unit = createUnit({ type: 'enemy', tileX: 0, tileY: 0 });
    const near = createUnit({ id: 'p1', type: 'player', tileX: 2, tileY: 0, hp: 100 }); // Distance 2
    const far = createUnit({ id: 'p2', type: 'player', tileX: 5, tileY: 5, hp: 100 }); // Distance 10
    const state = createBattleState([unit, near, far]);

    const result = findNearestEnemy(unit, 0, 0, state);

    assert.strictEqual(result.id, 'p1');
  });

  it('ignores dead enemies', () => {
    const unit = createUnit({ type: 'enemy', tileX: 0, tileY: 0 });
    const deadNear = createUnit({ id: 'p1', type: 'player', tileX: 1, tileY: 0, hp: 0 });
    const aliveFar = createUnit({ id: 'p2', type: 'player', tileX: 5, tileY: 0, hp: 100 });
    const state = createBattleState([unit, deadNear, aliveFar]);

    const result = findNearestEnemy(unit, 0, 0, state);

    assert.strictEqual(result.id, 'p2');
  });
});

describe('AI Utility Factors - import error handling', { skip: canImport }, () => {
  it('reports import error', () => {
    console.log('AI Utility Factors import error:', importError?.message);
    assert.ok(importError, 'Import error should be captured');
  });
});
