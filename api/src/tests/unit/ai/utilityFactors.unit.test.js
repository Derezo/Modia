/**
 * Utility Factors Unit Tests
 *
 * The utilityFactors module imports from battleService.js (which requires PostgreSQL)
 * and strategicPathfinding.js. We cannot use mock.module() reliably (experimental).
 *
 * Strategy: Test only the pure functions that do NOT depend on battleService's
 * calculatePhysicalDamage/calculateMagicalDamage. Functions like
 * calculatePositionQuality, calculateAllySupport, calculateHealingValue,
 * calculateSurvivalPriority, calculateMpEfficiency, calculateTargetPriority,
 * and waitingPenalty (partially) use those imports.
 *
 * We import directly from utilityFactors.js which will fail if battleService.js
 * cannot be loaded. Instead, we test the pure subset: calculateHealingValue,
 * calculateMpEfficiency, calculateAllySupport, calculateSurvivalPriority,
 * calculatePositionQuality, calculateTargetPriority - these can be tested
 * IF we can import the module. If import fails, tests skip gracefully.
 *
 * NOTE: Many functions in utilityFactors call calculatePhysicalDamage internally
 * (e.g., calculateDamageDealt, calculateDamageReceived, calculateKillPotential).
 * We skip those. Functions that only use getManhattanDistance from shared/pathfinding
 * and local logic can be tested.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { createMockUnit, createMockBattleState, createMockSkill } from './mockHelpers.js';

// Attempt to import - may fail due to battleService dependency
let utilityFactors = null;
let importError = null;

try {
  utilityFactors = await import('../../../services/ai/utilityFactors.js');
} catch (err) {
  importError = err;
}

const canImport = utilityFactors !== null;

describe('UtilityFactors', () => {

  before(() => {
    if (!canImport) {
      console.log(`[SKIP] utilityFactors import failed: ${importError?.message}`);
    }
  });

  describe('calculateHealingValue()', { skip: !canImport }, () => {
    const calculateHealingValue = () => utilityFactors.calculateHealingValue;

    it('returns 0 for non-healing skill', () => {
      const healer = createMockUnit({});
      const target = createMockUnit({ hp: 100, maxHp: 200 });
      const skill = createMockSkill({ healPercent: 0, selfBuff: false, damageType: 'physical' });
      const result = calculateHealingValue()(healer, target, skill, {});
      assert.strictEqual(result, 0);
    });

    it('returns 0 for null skill or target', () => {
      const healer = createMockUnit({});
      const target = createMockUnit({ hp: 100, maxHp: 200 });
      assert.strictEqual(calculateHealingValue()(healer, target, null, {}), 0);
      assert.strictEqual(calculateHealingValue()(healer, null, createMockSkill({ healPercent: 50 }), {}), 0);
    });

    it('returns 0 for dead target', () => {
      const healer = createMockUnit({});
      const target = createMockUnit({ hp: 0, maxHp: 200 });
      const skill = createMockSkill({ healPercent: 50 });
      assert.strictEqual(calculateHealingValue()(healer, target, skill, {}), 0);
    });

    it('calculates heal amount based on healPercent', () => {
      const healer = createMockUnit({});
      const target = createMockUnit({ hp: 100, maxHp: 200 });
      const skill = createMockSkill({ healPercent: 50, damageType: 'heal' });
      const result = calculateHealingValue()(healer, target, skill, {});
      // 50% of 200 maxHp = 100, missing = 100, heal = min(100,100) = 100
      // hpPercent = 100/200 = 0.5 -> urgency between 0.5 thresholds = 1.0
      // Between 0.5 and 0.8 -> urgency = 1.0 (default)
      assert.ok(result > 0, `Expected positive healing value, got ${result}`);
    });

    it('caps heal at missing HP', () => {
      const healer = createMockUnit({});
      const target = createMockUnit({ hp: 190, maxHp: 200 });
      const skill = createMockSkill({ healPercent: 50, damageType: 'heal' });
      const result = calculateHealingValue()(healer, target, skill, {});
      // 50% of 200 = 100 heal, but only 10 HP missing -> heal = 10
      // hpPercent = 190/200 = 0.95 -> urgency = 0.3
      assert.ok(result <= 10 * 0.3 + 1, `Overhealing should be low value, got ${result}`);
    });

    it('high urgency for critically wounded target', () => {
      const healer = createMockUnit({});
      const target = createMockUnit({ hp: 20, maxHp: 200 });
      const skill = createMockSkill({ healPercent: 50, damageType: 'heal' });
      const result = calculateHealingValue()(healer, target, skill, {});
      // hpPercent = 20/200 = 0.1 -> urgency = 2.5
      // heal = min(100, 180) = 100, value = 100 * 2.5 = 250
      assert.ok(result >= 200, `Critical heal should be very valuable, got ${result}`);
    });

    it('low urgency for nearly full HP target', () => {
      const healer = createMockUnit({});
      const lowTarget = createMockUnit({ hp: 40, maxHp: 200 });
      const highTarget = createMockUnit({ hp: 170, maxHp: 200 });
      const skill = createMockSkill({ healPercent: 50, damageType: 'heal' });
      const lowResult = calculateHealingValue()(healer, lowTarget, skill, {});
      const highResult = calculateHealingValue()(healer, highTarget, skill, {});
      assert.ok(lowResult > highResult, `Low HP heal (${lowResult}) should be more valuable than high HP heal (${highResult})`);
    });
  });

  describe('calculateMpEfficiency()', { skip: !canImport }, () => {
    const calculateMpEfficiency = () => utilityFactors.calculateMpEfficiency;

    it('returns 50 for free actions (no skill)', () => {
      const unit = createMockUnit({ mp: 50, maxMp: 100 });
      assert.strictEqual(calculateMpEfficiency()(unit, null), 50);
    });

    it('returns 50 for zero-cost skills', () => {
      const unit = createMockUnit({ mp: 50, maxMp: 100 });
      assert.strictEqual(calculateMpEfficiency()(unit, { mpCost: 0 }), 50);
    });

    it('returns -200 for zero-benefit skill with MP cost', () => {
      const unit = createMockUnit({ mp: 50, maxMp: 100 });
      const skill = { mpCost: 10 };
      assert.strictEqual(calculateMpEfficiency()(unit, skill, 0), -200);
    });

    it('penalizes expensive skills when low on MP', () => {
      const unit = createMockUnit({ mp: 20, maxMp: 100 }); // 20% MP
      const cheapSkill = { mpCost: 5 };
      const expensiveSkill = { mpCost: 30 };
      const cheapResult = calculateMpEfficiency()(unit, cheapSkill, 100);
      const expensiveResult = calculateMpEfficiency()(unit, expensiveSkill, 100);
      assert.ok(cheapResult > expensiveResult,
        `Cheap skill (${cheapResult}) should be more efficient than expensive (${expensiveResult}) at low MP`);
    });

    it('is less penalizing when MP is comfortable', () => {
      const lowMpUnit = createMockUnit({ mp: 20, maxMp: 100 });
      const highMpUnit = createMockUnit({ mp: 80, maxMp: 100 });
      const skill = { mpCost: 20 };
      const lowResult = calculateMpEfficiency()(lowMpUnit, skill, 100);
      const highResult = calculateMpEfficiency()(highMpUnit, skill, 100);
      assert.ok(highResult > lowResult,
        `High MP efficiency (${highResult}) should be better than low MP (${lowResult})`);
    });
  });

  describe('calculateAllySupport()', { skip: !canImport }, () => {
    const calculateAllySupport = () => utilityFactors.calculateAllySupport;

    it('returns 0 when no allies nearby', () => {
      const state = createMockBattleState(
        [{ tileX: 2, tileY: 2 }],
        [{ tileX: 15, tileY: 15 }]
      );
      const unit = state.units[1]; // enemy
      const result = calculateAllySupport()(unit, unit.tileX, unit.tileY, state);
      assert.strictEqual(result, 0);
    });

    it('increases with nearby allies', () => {
      const state = createMockBattleState(
        [],
        [
          { tileX: 5, tileY: 5 },
          { tileX: 6, tileY: 5 }, // distance 1
          { tileX: 7, tileY: 5 }  // distance 2
        ]
      );
      const unit = state.units[0];
      const result = calculateAllySupport()(unit, unit.tileX, unit.tileY, state);
      assert.ok(result > 0, `Ally support should be positive, got ${result}`);
    });

    it('caps at 50', () => {
      // Pack many allies adjacent
      const state = createMockBattleState(
        [],
        [
          { tileX: 5, tileY: 5 },
          { tileX: 4, tileY: 5 },
          { tileX: 6, tileY: 5 },
          { tileX: 5, tileY: 4 },
          { tileX: 5, tileY: 6 },
          { tileX: 4, tileY: 4 }
        ]
      );
      const unit = state.units[0];
      const result = calculateAllySupport()(unit, unit.tileX, unit.tileY, state);
      assert.ok(result <= 50, `Ally support should cap at 50, got ${result}`);
    });

    it('gives bonus for allies with heal skills', () => {
      const state = createMockBattleState(
        [],
        [
          { tileX: 5, tileY: 5, skills: [] },
          { tileX: 6, tileY: 5, skills: [{ healPercent: 30 }] }
        ]
      );
      const unit = state.units[0];
      const withHealer = calculateAllySupport()(unit, unit.tileX, unit.tileY, state);

      const state2 = createMockBattleState(
        [],
        [
          { tileX: 5, tileY: 5, skills: [] },
          { tileX: 6, tileY: 5, skills: [] }
        ]
      );
      const unit2 = state2.units[0];
      const withoutHealer = calculateAllySupport()(unit2, unit2.tileX, unit2.tileY, state2);

      assert.ok(withHealer > withoutHealer,
        `Healer ally support (${withHealer}) should be > non-healer (${withoutHealer})`);
    });
  });

  describe('calculateSurvivalPriority()', { skip: !canImport }, () => {
    const calculateSurvivalPriority = () => utilityFactors.calculateSurvivalPriority;

    it('returns high priority for low HP', () => {
      const unit = createMockUnit({ type: 'enemy', hp: 20, maxHp: 200, tileX: 10, tileY: 10 });
      const state = createMockBattleState([{ tileX: 15, tileY: 15 }], []);
      state.units.push(unit);
      const result = calculateSurvivalPriority()(unit, unit.tileX, unit.tileY, state);
      assert.ok(result >= 100, `Low HP should mean high survival priority, got ${result}`);
    });

    it('returns low priority for full HP', () => {
      const unit = createMockUnit({ type: 'enemy', hp: 200, maxHp: 200, tileX: 10, tileY: 10 });
      const state = createMockBattleState([{ tileX: 15, tileY: 15 }], []);
      state.units.push(unit);
      const result = calculateSurvivalPriority()(unit, unit.tileX, unit.tileY, state);
      assert.ok(result <= 50, `Full HP should mean low survival priority, got ${result}`);
    });

    it('increases with nearby enemies', () => {
      const unit = createMockUnit({ type: 'enemy', hp: 100, maxHp: 200, tileX: 5, tileY: 5 });
      const farState = createMockBattleState([{ tileX: 15, tileY: 15 }], []);
      farState.units.push(unit);
      const farResult = calculateSurvivalPriority()(unit, unit.tileX, unit.tileY, farState);

      const unit2 = createMockUnit({ type: 'enemy', hp: 100, maxHp: 200, tileX: 5, tileY: 5 });
      const nearState = createMockBattleState(
        [{ tileX: 6, tileY: 5 }, { tileX: 5, tileY: 6 }],
        []
      );
      nearState.units.push(unit2);
      const nearResult = calculateSurvivalPriority()(unit2, unit2.tileX, unit2.tileY, nearState);

      assert.ok(nearResult > farResult,
        `Nearby enemies (${nearResult}) should increase priority vs far (${farResult})`);
    });

    it('clamps between 0 and 200', () => {
      const unit = createMockUnit({ type: 'enemy', hp: 10, maxHp: 200, tileX: 5, tileY: 5 });
      const state = createMockBattleState(
        [{ tileX: 4, tileY: 5 }, { tileX: 6, tileY: 5 }, { tileX: 5, tileY: 4 }, { tileX: 5, tileY: 6 }],
        []
      );
      state.units.push(unit);
      const result = calculateSurvivalPriority()(unit, unit.tileX, unit.tileY, state);
      assert.ok(result >= 0 && result <= 200, `Should clamp 0-200, got ${result}`);
    });
  });

  describe('calculatePositionQuality()', { skip: !canImport }, () => {
    const calculatePositionQuality = () => utilityFactors.calculatePositionQuality;

    it('penalizes edge positions', () => {
      const unit = createMockUnit({ type: 'enemy', tileX: 0, tileY: 0 });
      const state = createMockBattleState([{ tileX: 10, tileY: 10 }], []);
      state.units.push(unit);
      const edgeResult = calculatePositionQuality()(unit, 0, 0, state);

      const unit2 = createMockUnit({ type: 'enemy', tileX: 10, tileY: 10 });
      state.units.push(unit2);
      const centerResult = calculatePositionQuality()(unit2, 10, 10, state);

      assert.ok(edgeResult < centerResult,
        `Edge position (${edgeResult}) should score lower than center (${centerResult})`);
    });

    it('gives terrain bonus for forest/rock', () => {
      const terrain = Array.from({ length: 20 }, () =>
        Array.from({ length: 20 }, () => 'grass')
      );
      terrain[5][5] = 'forest';
      const state = createMockBattleState(
        [{ tileX: 10, tileY: 10 }],
        [{ tileX: 5, tileY: 5 }],
        { terrain }
      );
      const unit = state.units[1]; // enemy at forest
      const forestResult = calculatePositionQuality()(unit, 5, 5, state);
      const grassResult = calculatePositionQuality()(unit, 6, 5, state);
      // Forest should have cover bonus of +10
      assert.ok(forestResult >= grassResult,
        `Forest (${forestResult}) should score >= grass (${grassResult})`);
    });

    it('clamps between -100 and 100', () => {
      const unit = createMockUnit({ type: 'enemy', tileX: 0, tileY: 0 });
      const state = createMockBattleState([{ tileX: 1, tileY: 0 }, { tileX: 0, tileY: 1 }], []);
      state.units.push(unit);
      const result = calculatePositionQuality()(unit, 0, 0, state);
      assert.ok(result >= -100 && result <= 100, `Should clamp -100 to 100, got ${result}`);
    });
  });

  describe('calculateTargetPriority()', { skip: !canImport }, () => {
    const calculateTargetPriority = () => utilityFactors.calculateTargetPriority;

    it('returns 0 for null/dead target', () => {
      assert.strictEqual(calculateTargetPriority()(null, {}), 0);
      assert.strictEqual(calculateTargetPriority()({ hp: 0, maxHp: 100 }, {}), 0);
    });

    it('higher priority for low HP targets', () => {
      const lowHpTarget = createMockUnit({ hp: 20, maxHp: 200 });
      const fullHpTarget = createMockUnit({ hp: 200, maxHp: 200 });
      const state = createMockBattleState([], []);
      const lowResult = calculateTargetPriority()(lowHpTarget, state);
      const fullResult = calculateTargetPriority()(fullHpTarget, state);
      assert.ok(lowResult > fullResult,
        `Low HP (${lowResult}) should have higher priority than full HP (${fullResult})`);
    });

    it('higher priority for healers', () => {
      const healer = createMockUnit({ hp: 100, maxHp: 200, skills: [{ healPercent: 30 }] });
      const nonHealer = createMockUnit({ hp: 100, maxHp: 200, skills: [] });
      const state = createMockBattleState([], []);
      const healerPriority = calculateTargetPriority()(healer, state);
      const nonHealerPriority = calculateTargetPriority()(nonHealer, state);
      assert.ok(healerPriority > nonHealerPriority,
        `Healer (${healerPriority}) should be higher priority than non-healer (${nonHealerPriority})`);
    });

    it('caps at 100', () => {
      const target = createMockUnit({
        hp: 10, maxHp: 200,
        class: 'wizard',
        intelligence: 100, vitality: 10,
        skills: [{ healPercent: 50 }]
      });
      const state = createMockBattleState([], []);
      const result = calculateTargetPriority()(target, state);
      assert.ok(result <= 100, `Should cap at 100, got ${result}`);
    });
  });

  describe('waitingPenalty()', { skip: !canImport }, () => {
    const waitingPenalty = () => utilityFactors.waitingPenalty;

    it('returns 0 for non-wait actions', () => {
      const unit = createMockUnit({ type: 'enemy' });
      const state = createMockBattleState([{}], []);
      state.units.push(unit);
      assert.strictEqual(waitingPenalty()({ unit, action: { type: 'attack' }, state }), 0);
      assert.strictEqual(waitingPenalty()({ unit, action: { type: 'move' }, state }), 0);
    });
  });

  describe('strategicPathProgress()', { skip: !canImport }, () => {
    const strategicPathProgress = () => utilityFactors.strategicPathProgress;

    it('returns 0 for non-move actions', () => {
      const unit = createMockUnit({ type: 'enemy' });
      const state = createMockBattleState([{}], []);
      state.units.push(unit);
      assert.strictEqual(strategicPathProgress()({ unit, action: { type: 'attack' }, state }), 0);
    });
  });
});
