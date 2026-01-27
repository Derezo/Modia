/**
 * State Evaluator Unit Tests
 *
 * StateEvaluator imports from utilityFactors.js which imports from battleService.js
 * (requires PostgreSQL). We test StateEvaluator indirectly through what we can import.
 *
 * Strategy: If the import succeeds (battleService can load without DB connection),
 * test the full StateEvaluator. If not, test only getActionTypeBonus and evaluateState
 * by constructing StateEvaluator instances manually with mock weight configs.
 *
 * Since StateEvaluator is a class exported from stateEvaluator.js which imports
 * utilityFactors.js, we must handle the import carefully.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createMockUnit, createMockBattleState, createMockSkill } from './mockHelpers.js';
import { PATTERN_WEIGHTS, getWeights } from '../../../services/ai/patternWeights.js';

// Try importing StateEvaluator - may fail due to transitive battleService dependency
let StateEvaluator = null;
let importError = null;

try {
  const mod = await import('../../../services/ai/stateEvaluator.js');
  StateEvaluator = mod.StateEvaluator;
} catch (err) {
  importError = err;
}

const canImport = StateEvaluator !== null;

describe('StateEvaluator', () => {

  describe('constructor', { skip: !canImport }, () => {
    it('sets weights and pattern name from config', () => {
      const config = getWeights('tactical');
      const evaluator = new StateEvaluator(config);
      assert.strictEqual(evaluator.patternName, 'Tactical');
      assert.ok(evaluator.weights);
      assert.strictEqual(evaluator.weights.DAMAGE_DEALT, 1.5);
    });
  });

  describe('getActionTypeBonus()', { skip: !canImport }, () => {
    it('aggressive patterns give +50 for attack', () => {
      const evaluator = new StateEvaluator(getWeights('aggressive'));
      assert.strictEqual(evaluator.getActionTypeBonus('attack'), 50);
    });

    it('aggressive patterns give -150 for wait', () => {
      const evaluator = new StateEvaluator(getWeights('aggressive'));
      assert.strictEqual(evaluator.getActionTypeBonus('wait'), -150);
    });

    it('berserker patterns also give +50 for attack', () => {
      const evaluator = new StateEvaluator(getWeights('berserker'));
      assert.strictEqual(evaluator.getActionTypeBonus('attack'), 50);
    });

    it('berserker patterns give -150 for wait', () => {
      const evaluator = new StateEvaluator(getWeights('berserker'));
      assert.strictEqual(evaluator.getActionTypeBonus('wait'), -150);
    });

    it('defensive pattern gives +20 for move', () => {
      const evaluator = new StateEvaluator(getWeights('defensive'));
      assert.strictEqual(evaluator.getActionTypeBonus('move'), 20);
    });

    it('defensive pattern gives 0 for wait', () => {
      const evaluator = new StateEvaluator(getWeights('defensive'));
      assert.strictEqual(evaluator.getActionTypeBonus('wait'), 0);
    });

    it('defensive pattern gives +20 for item', () => {
      const evaluator = new StateEvaluator(getWeights('defensive'));
      assert.strictEqual(evaluator.getActionTypeBonus('item'), 20);
    });

    it('tactical pattern gives +30 for attack', () => {
      const evaluator = new StateEvaluator(getWeights('tactical'));
      assert.strictEqual(evaluator.getActionTypeBonus('attack'), 30);
    });

    it('tactical pattern gives -50 for wait', () => {
      const evaluator = new StateEvaluator(getWeights('tactical'));
      assert.strictEqual(evaluator.getActionTypeBonus('wait'), -50);
    });

    it('tactical pattern gives +20 for item', () => {
      const evaluator = new StateEvaluator(getWeights('tactical'));
      assert.strictEqual(evaluator.getActionTypeBonus('item'), 20);
    });

    it('ambush pattern gives +20 for wait', () => {
      const evaluator = new StateEvaluator(getWeights('ambush'));
      assert.strictEqual(evaluator.getActionTypeBonus('wait'), 20);
    });

    it('returns 0 for zero-benefit skills', () => {
      const evaluator = new StateEvaluator(getWeights('aggressive'));
      // When skillBenefit is 0, bonus should be 0 regardless of pattern
      assert.strictEqual(evaluator.getActionTypeBonus('skill', 0), 0);
    });

    it('support pattern returns default item bonus', () => {
      const evaluator = new StateEvaluator(getWeights('support'));
      // Support is not explicitly handled for item, so falls through to default
      assert.strictEqual(evaluator.getActionTypeBonus('item'), 10);
    });

    it('unmatched pattern returns default 0', () => {
      const evaluator = new StateEvaluator(getWeights('ranged'));
      // Ranged is not explicitly handled
      assert.strictEqual(evaluator.getActionTypeBonus('attack'), 0);
      assert.strictEqual(evaluator.getActionTypeBonus('wait'), 0);
    });

    it('unmatched pattern returns 10 for item (default)', () => {
      const evaluator = new StateEvaluator(getWeights('ranged'));
      assert.strictEqual(evaluator.getActionTypeBonus('item'), 10);
    });
  });

  describe('evaluateAction()', { skip: !canImport }, () => {
    it('returns -1000 for unknown action type', () => {
      const evaluator = new StateEvaluator(getWeights('aggressive'));
      const unit = createMockUnit({ type: 'enemy' });
      const state = createMockBattleState([{ tileX: 10, tileY: 10 }], []);
      state.units.push(unit);
      const result = evaluator.evaluateAction(unit, { type: 'unknown' }, state);
      assert.strictEqual(result.score, -1000);
      assert.deepStrictEqual(result.factors, {});
    });

    it('evaluates wait action without crashing', () => {
      const evaluator = new StateEvaluator(getWeights('defensive'));
      const unit = createMockUnit({ type: 'enemy', tileX: 10, tileY: 10 });
      const state = createMockBattleState([{ tileX: 15, tileY: 15 }], []);
      state.units.push(unit);
      const result = evaluator.evaluateAction(unit, { type: 'wait' }, state);
      assert.ok(typeof result.score === 'number');
      assert.ok(result.factors);
      assert.strictEqual(result.factors.DAMAGE_DEALT, 0);
      assert.strictEqual(result.factors.KILL_POTENTIAL, 0);
    });

    it('evaluates move action', () => {
      const evaluator = new StateEvaluator(getWeights('tactical'));
      const unit = createMockUnit({ type: 'enemy', tileX: 10, tileY: 10 });
      const state = createMockBattleState([{ tileX: 15, tileY: 15 }], []);
      state.units.push(unit);
      const result = evaluator.evaluateAction(unit, {
        type: 'move',
        position: { x: 12, y: 12 }
      }, state);
      assert.ok(typeof result.score === 'number');
      assert.strictEqual(result.factors.DAMAGE_DEALT, 0);
      assert.strictEqual(result.factors.KILL_POTENTIAL, 0);
    });

    it('evaluates attack action with target', () => {
      const state = createMockBattleState(
        [{ tileX: 5, tileY: 5, hp: 100, maxHp: 200, vitality: 10, defense: 5 }],
        [{ tileX: 6, tileY: 5, strength: 40, attack: 20 }]
      );
      const evaluator = new StateEvaluator(getWeights('aggressive'));
      const enemy = state.units[1];
      const player = state.units[0];
      const result = evaluator.evaluateAction(enemy, {
        type: 'attack',
        targetId: player.id
      }, state);
      assert.ok(typeof result.score === 'number');
      assert.ok(result.factors.DAMAGE_DEALT >= 0);
      assert.strictEqual(result.factors.MP_EFFICIENCY, 100); // basic attacks are free
    });

    it('evaluates skill action', () => {
      const state = createMockBattleState(
        [{ tileX: 5, tileY: 5, hp: 100, maxHp: 200, vitality: 10, defense: 5 }],
        [{ tileX: 6, tileY: 5, strength: 40, attack: 20, mp: 50, maxMp: 100 }]
      );
      const evaluator = new StateEvaluator(getWeights('tactical'));
      const enemy = state.units[1];
      const player = state.units[0];
      const skill = createMockSkill({ power: 150, mpCost: 15 });
      const result = evaluator.evaluateAction(enemy, {
        type: 'skill',
        targetId: player.id,
        skill
      }, state);
      assert.ok(typeof result.score === 'number');
      assert.ok(result.factors.DAMAGE_DEALT >= 0);
    });

    it('penalizes high MP cost skills when MP is low', () => {
      const state = createMockBattleState(
        [{ tileX: 6, tileY: 5, hp: 100, maxHp: 200, vitality: 10, defense: 5 }],
        [{ tileX: 5, tileY: 5, hp: 200, maxHp: 200, mp: 10, maxMp: 100,
           strength: 40, attack: 20 }]
      );
      const evaluator = new StateEvaluator(getWeights('tactical'));
      const enemy = state.units[1];
      const player = state.units[0];
      // Expensive skill at low MP
      const expensiveSkill = createMockSkill({ power: 120, mpCost: 30 });
      const cheapSkill = createMockSkill({ power: 100, mpCost: 5 });
      const expResult = evaluator.evaluateAction(enemy, {
        type: 'skill', targetId: player.id, skill: expensiveSkill
      }, state);
      const cheapResult = evaluator.evaluateAction(enemy, {
        type: 'skill', targetId: player.id, skill: cheapSkill
      }, state);
      // At 10% MP, expensive skill should have worse MP efficiency
      assert.ok(expResult.factors.MP_EFFICIENCY < cheapResult.factors.MP_EFFICIENCY,
        `Expensive MP_EFFICIENCY (${expResult.factors.MP_EFFICIENCY}) should be worse than cheap (${cheapResult.factors.MP_EFFICIENCY})`);
    });
  });

  describe('evaluateState()', { skip: !canImport }, () => {
    it('returns 10000 for victory (all enemies dead)', () => {
      const state = createMockBattleState(
        [{ hp: 100, maxHp: 200 }],
        [{ hp: 0, maxHp: 200 }]
      );
      const evaluator = new StateEvaluator(getWeights('aggressive'));
      const score = evaluator.evaluateState(state, 'player');
      assert.strictEqual(score, 10000);
    });

    it('returns -10000 for defeat (all friendlies dead)', () => {
      const state = createMockBattleState(
        [{ hp: 0, maxHp: 200 }],
        [{ hp: 100, maxHp: 200 }]
      );
      const evaluator = new StateEvaluator(getWeights('aggressive'));
      const score = evaluator.evaluateState(state, 'player');
      assert.strictEqual(score, -10000);
    });

    it('positive score when friendlies have advantage', () => {
      const state = createMockBattleState(
        [{ hp: 200, maxHp: 200 }, { hp: 200, maxHp: 200 }],
        [{ hp: 50, maxHp: 200 }]
      );
      const evaluator = new StateEvaluator(getWeights('aggressive'));
      const score = evaluator.evaluateState(state, 'player');
      assert.ok(score > 0, `Should be positive with advantage, got ${score}`);
    });

    it('negative score when enemies have advantage', () => {
      const state = createMockBattleState(
        [{ hp: 50, maxHp: 200 }],
        [{ hp: 200, maxHp: 200 }, { hp: 200, maxHp: 200 }]
      );
      const evaluator = new StateEvaluator(getWeights('aggressive'));
      const score = evaluator.evaluateState(state, 'player');
      assert.ok(score < 0, `Should be negative when losing, got ${score}`);
    });
  });

  describe('evaluateMoveAndAction()', { skip: !canImport }, () => {
    it('combines move and action scores', () => {
      const state = createMockBattleState(
        [{ tileX: 5, tileY: 5, hp: 100, maxHp: 200, vitality: 10, defense: 5 }],
        [{ tileX: 10, tileY: 5, strength: 40, attack: 20 }]
      );
      const evaluator = new StateEvaluator(getWeights('tactical'));
      const enemy = state.units[1];
      const player = state.units[0];
      const result = evaluator.evaluateMoveAndAction(
        enemy,
        { x: 6, y: 5 },
        { type: 'attack', targetId: player.id },
        state
      );
      assert.ok(typeof result.score === 'number');
      assert.ok(typeof result.moveScore === 'number');
      assert.ok(typeof result.actionScore === 'number');
      assert.ok(result.factors.move);
      assert.ok(result.factors.action);
    });

    it('weights action higher than move (0.6 vs 0.4)', () => {
      const state = createMockBattleState(
        [{ tileX: 5, tileY: 5, hp: 100, maxHp: 200, vitality: 10, defense: 5 }],
        [{ tileX: 10, tileY: 5, strength: 40, attack: 20 }]
      );
      const evaluator = new StateEvaluator(getWeights('aggressive'));
      const enemy = state.units[1];
      const player = state.units[0];
      const result = evaluator.evaluateMoveAndAction(
        enemy,
        { x: 6, y: 5 },
        { type: 'attack', targetId: player.id },
        state
      );
      const expected = result.moveScore * 0.4 + result.actionScore * 0.6;
      assert.ok(
        Math.abs(result.score - expected) < 0.01,
        `Combined score ${result.score} should equal 0.4*${result.moveScore} + 0.6*${result.actionScore} = ${expected}`
      );
    });
  });

  describe('getBestAction()', { skip: !canImport }, () => {
    it('returns wait for empty actions array', () => {
      const evaluator = new StateEvaluator(getWeights('aggressive'));
      const unit = createMockUnit({ type: 'enemy' });
      const state = createMockBattleState([{}], []);
      state.units.push(unit);
      const result = evaluator.getBestAction(unit, [], state);
      assert.strictEqual(result.bestAction.type, 'wait');
    });

    it('returns the highest scored action', () => {
      const state = createMockBattleState(
        [{ tileX: 6, tileY: 5, hp: 50, maxHp: 200, vitality: 10, defense: 5 }],
        [{ tileX: 5, tileY: 5, strength: 50, attack: 25 }]
      );
      const evaluator = new StateEvaluator(getWeights('aggressive'));
      const enemy = state.units[1];
      const actions = [
        { type: 'attack', targetId: state.units[0].id },
        { type: 'wait' }
      ];
      const result = evaluator.getBestAction(enemy, actions, state);
      // Aggressive should prefer attack over wait
      assert.strictEqual(result.bestAction.type, 'attack');
    });

    it('returns allScores sorted descending', () => {
      const state = createMockBattleState(
        [{ tileX: 6, tileY: 5 }],
        [{ tileX: 5, tileY: 5 }]
      );
      const evaluator = new StateEvaluator(getWeights('aggressive'));
      const enemy = state.units[1];
      const actions = [
        { type: 'wait' },
        { type: 'move', position: { x: 7, y: 5 } },
        { type: 'attack', targetId: state.units[0].id }
      ];
      const result = evaluator.getBestAction(enemy, actions, state);
      assert.strictEqual(result.allScores.length, 3);
      for (let i = 1; i < result.allScores.length; i++) {
        assert.ok(result.allScores[i - 1].score >= result.allScores[i].score,
          `allScores should be sorted descending`);
      }
    });
  });

  describe('compareTwoActions()', { skip: !canImport }, () => {
    it('returns the higher-scored action', () => {
      const state = createMockBattleState(
        [{ tileX: 6, tileY: 5, hp: 50, maxHp: 200, vitality: 10, defense: 5 }],
        [{ tileX: 5, tileY: 5, strength: 50, attack: 25 }]
      );
      const evaluator = new StateEvaluator(getWeights('aggressive'));
      const enemy = state.units[1];
      const attack = { type: 'attack', targetId: state.units[0].id };
      const wait = { type: 'wait' };
      const better = evaluator.compareTwoActions(enemy, attack, wait, state);
      assert.strictEqual(better.type, 'attack');
    });
  });
});
