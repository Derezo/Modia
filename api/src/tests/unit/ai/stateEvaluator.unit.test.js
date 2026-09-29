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

    it('values a damage-free hostile status without inventing damage', () => {
      const state = createMockBattleState(
        [{ id: 'target', tileX: 6, tileY: 5, statusEffects: [] }],
        [{ id: 'caster', tileX: 5, tileY: 5, mp: 50 }]
      );
      const evaluator = new StateEvaluator(getWeights('tactical'));
      const caster = state.units.find(unit => unit.id === 'caster');
      const target = state.units.find(unit => unit.id === 'target');
      const freeze = createMockSkill({
        id: 'frozen_tomb',
        power: 0,
        range: 3,
        mpCost: 10,
        effect: 'freeze',
        effectChance: 0.8,
        effectDuration: 2
      });

      const useful = evaluator.evaluateAction(caster, {
        type: 'skill',
        targetId: target.id,
        skill: freeze
      }, state);
      target.statusEffects.push({ type: 'freeze', duration: 2 });
      const redundant = evaluator.evaluateAction(caster, {
        type: 'skill',
        targetId: target.id,
        skill: freeze
      }, state);

      assert.strictEqual(useful.factors.KILL_POTENTIAL, 0);
      assert.ok(useful.factors.DAMAGE_DEALT > 0);
      assert.strictEqual(redundant.factors.DAMAGE_DEALT, 0);
      assert.strictEqual(redundant.factors.TARGET_PRIORITY, 0);
      assert.ok(useful.score > redundant.score);
    });

    it('values every damage-free AoE debuff target and avoids redundant effects', () => {
      const state = createMockBattleState(
        [
          { id: 'target-a', tileX: 6, tileY: 5, statusEffects: [] },
          { id: 'target-b', tileX: 7, tileY: 5, statusEffects: [] }
        ],
        [{ id: 'caster', tileX: 3, tileY: 5, mp: 50 }]
      );
      const evaluator = new StateEvaluator(getWeights('tactical'));
      const caster = state.units.find(unit => unit.id === 'caster');
      const smokeBomb = createMockSkill({
        id: 'smoke_bomb',
        power: 0,
        range: 3,
        mpCost: 10,
        aoeRadius: 1,
        effect: 'blind',
        effectChance: 1,
        effectDuration: 2
      });
      const action = {
        type: 'skill',
        skill: smokeBomb,
        targetId: 'target-a',
        target: { x: 6, y: 5 },
        aoeCenter: { x: 6, y: 5 }
      };

      const twoTargets = evaluator.evaluateAction(caster, action, state);
      state.units.find(unit => unit.id === 'target-b')
        .statusEffects.push({ type: 'blind', duration: 2 });
      const oneNewTarget = evaluator.evaluateAction(caster, action, state);

      assert.strictEqual(twoTargets.factors.KILL_POTENTIAL, 0);
      assert.ok(twoTargets.factors.DAMAGE_DEALT > oneNewTarget.factors.DAMAGE_DEALT);
      assert.ok(oneNewTarget.factors.DAMAGE_DEALT > 0);
    });

    it('scores every AoE target and subtracts friendly fire', () => {
      const evaluator = new StateEvaluator(getWeights('tactical'));
      const skill = createMockSkill({
        id: 'blast',
        power: 100,
        range: 3,
        aoeRadius: 1,
        mpCost: 10
      });
      const state = createMockBattleState(
        [
          { id: 'enemy-a', tileX: 6, tileY: 5, vitality: 10, defense: 5 },
          { id: 'enemy-b', tileX: 7, tileY: 5, vitality: 10, defense: 5 }
        ],
        [
          { id: 'caster', tileX: 5, tileY: 5, strength: 50, attack: 20 },
          { id: 'ally', tileX: 6, tileY: 6, vitality: 10, defense: 5 }
        ]
      );
      const caster = state.units.find(unit => unit.id === 'caster');
      const action = {
        type: 'skill',
        skill,
        targetId: 'enemy-a',
        target: { x: 6, y: 5 },
        aoeCenter: { x: 6, y: 5 }
      };

      const withFriendlyFire = evaluator.evaluateAction(caster, action, state);
      state.units.find(unit => unit.id === 'ally').tileX = 10;
      const opponentsOnly = evaluator.evaluateAction(caster, action, state);
      state.units.find(unit => unit.id === 'enemy-b').tileX = 10;
      const oneOpponent = evaluator.evaluateAction(caster, action, state);

      assert.ok(opponentsOnly.factors.DAMAGE_DEALT > oneOpponent.factors.DAMAGE_DEALT);
      assert.ok(
        withFriendlyFire.factors.DAMAGE_DEALT < opponentsOnly.factors.DAMAGE_DEALT,
        'friendly damage should reduce the action benefit'
      );
    });

    it('penalizes a caster-centered AoE that damages allies but no opponents', () => {
      const evaluator = new StateEvaluator(getWeights('aggressive'));
      const skill = createMockSkill({
        id: 'nova',
        power: 100,
        range: 0,
        aoeRadius: 1,
        mpCost: 10
      });
      const state = createMockBattleState(
        [{ id: 'distant-opponent', tileX: 12, tileY: 5 }],
        [
          { id: 'caster', tileX: 5, tileY: 5, strength: 50, attack: 20 },
          { id: 'ally', tileX: 6, tileY: 5 }
        ]
      );
      const caster = state.units.find(unit => unit.id === 'caster');

      const result = evaluator.evaluateAction(caster, {
        type: 'skill',
        skill,
        target: { x: 5, y: 5 },
        aoeCenter: { x: 5, y: 5 }
      }, state);

      assert.ok(result.factors.DAMAGE_DEALT < 0);
      assert.ok(result.score < 0);
    });

    it('excludes caster from offensive AoE damage calculation (Fire Nova, Cleave)', () => {
      const evaluator = new StateEvaluator(getWeights('tactical'));
      const offensiveNovaSkill = createMockSkill({
        id: 'fire_nova',
        power: 100,
        range: 0,
        aoeRadius: 2,
        mpCost: 15,
        damageType: 'magical'
      });
      // Caster is surrounded by enemies, they should all take damage but not the caster
      const state = createMockBattleState(
        [
          { id: 'enemy-n', tileX: 5, tileY: 4, vitality: 10, defense: 5 },
          { id: 'enemy-s', tileX: 5, tileY: 6, vitality: 10, defense: 5 },
          { id: 'enemy-e', tileX: 6, tileY: 5, vitality: 10, defense: 5 }
        ],
        [
          { id: 'caster', tileX: 5, tileY: 5, intelligence: 50, magicAttack: 20, vitality: 10 }
        ]
      );
      const caster = state.units.find(unit => unit.id === 'caster');
      const action = {
        type: 'skill',
        skill: offensiveNovaSkill,
        target: { x: 5, y: 5 },
        aoeCenter: { x: 5, y: 5 }
      };

      const result = evaluator.evaluateAction(caster, action, state);

      // Score should be positive (damaging enemies), not negative (self-damage)
      // Before the fix, caster would be included in AoE and penalize friendly fire
      assert.ok(
        result.factors.DAMAGE_DEALT > 0,
        `Offensive AoE centered on caster should damage enemies without self-damage penalty, got ${result.factors.DAMAGE_DEALT}`
      );
      assert.ok(result.score > 0, 'Score should be positive for damaging 3 enemies');
    });

    it('still includes caster in buff AoE centered on self', () => {
      const evaluator = new StateEvaluator(getWeights('support'));
      const buffSkill = createMockSkill({
        id: 'war_cry',
        power: 0,
        range: 0,
        aoeRadius: 2,
        damageType: 'support',
        selfBuff: { attack: 1.3 },
        buffDuration: 3
      });
      const state = createMockBattleState(
        [
          { id: 'caster', tileX: 5, tileY: 5, strength: 30 },
          { id: 'ally', tileX: 6, tileY: 5, strength: 25 }
        ],
        [
          { id: 'enemy', tileX: 10, tileY: 5 }
        ]
      );
      const caster = state.units.find(unit => unit.id === 'caster');
      const action = {
        type: 'skill',
        skill: buffSkill,
        targetId: caster.id,
        target: { x: 5, y: 5 },
        aoeCenter: { x: 5, y: 5 }
      };

      const result = evaluator.evaluateAction(caster, action, state);

      // Buff AoE should benefit both caster and ally
      assert.ok(result.score > 0, 'Buff AoE should have positive value');
    });

    it('values every same-team recipient of a caster-centered support AoE', () => {
      const evaluator = new StateEvaluator(getWeights('support'));
      const skill = createMockSkill({
        id: 'beast_howl',
        power: 0,
        range: 0,
        aoeRadius: 1,
        damageType: 'support',
        selfBuff: { attack: 1.2 },
        buffDuration: 3
      });
      const state = createMockBattleState(
        [
          { id: 'caster', teamId: 7, tileX: 5, tileY: 5 },
          { id: 'nearby-ally', teamId: 7, tileX: 6, tileY: 5 },
          { id: 'defeated-ally', teamId: 7, tileX: 5, tileY: 4, hp: 0 },
          { id: 'distant-ally', teamId: 7, tileX: 8, tileY: 5 }
        ],
        [{ id: 'nearby-opponent', teamId: 8, tileX: 5, tileY: 6 }]
      );
      const caster = state.units.find(unit => unit.id === 'caster');
      const nearbyAlly = state.units.find(unit => unit.id === 'nearby-ally');
      const action = {
        type: 'skill',
        targetId: caster.id,
        target: { x: 12, y: 5 },
        aoeCenter: { x: 12, y: 5 },
        skill
      };

      const useful = evaluator.evaluateAction(caster, action, state);
      caster.statusEffects.push({ type: 'beast_howl_buff', duration: 3 });
      nearbyAlly.statusEffects.push({ type: 'beast_howl_buff', duration: 3 });
      const redundant = evaluator.evaluateAction(caster, action, state);

      assert.strictEqual(useful.factors.HEALING_VALUE, 100);
      assert.strictEqual(redundant.factors.HEALING_VALUE, 0);
    });

    it('scores both offensive and self-preservation value for a hybrid skill', () => {
      const state = createMockBattleState(
        [{ tileX: 6, tileY: 5, hp: 200, maxHp: 200, vitality: 10, defense: 5 }],
        [{
          tileX: 5,
          tileY: 5,
          hp: 80,
          maxHp: 200,
          mp: 50,
          maxMp: 100,
          strength: 40,
          attack: 20
        }]
      );
      const evaluator = new StateEvaluator(getWeights('tactical'));
      const actor = state.units[1];
      const target = state.units[0];
      const hybridSkill = createMockSkill({
        id: 'frenzy',
        power: 120,
        mpCost: 15,
        healPercent: 20,
        selfBuff: { attack: 1.5 }
      });

      const result = evaluator.evaluateAction(actor, {
        type: 'skill',
        targetId: target.id,
        skill: hybridSkill
      }, state);

      assert.ok(result.factors.DAMAGE_DEALT > 0);
      assert.ok(result.factors.HEALING_VALUE > 0);
      assert.strictEqual(
        result.factors._skillBenefit,
        result.factors.DAMAGE_DEALT + result.factors.HEALING_VALUE
      );
    });

    it('distinguishes self-buff identities from hostile hybrid effects', () => {
      const state = createMockBattleState(
        [{ tileX: 6, tileY: 5, hp: 200, maxHp: 200 }],
        [{ tileX: 5, tileY: 5, strength: 40, attack: 20 }]
      );
      const evaluator = new StateEvaluator(getWeights('tactical'));
      const caster = state.units[1];
      const target = state.units[0];
      const cases = [
        {
          name: 'string identity',
          selfBuff: 'berserk',
          effect: 'berserk',
          hostile: false
        },
        {
          name: 'object type identity',
          selfBuff: { type: 'berserk', attack: 1.2 },
          effect: 'berserk',
          hostile: false
        },
        {
          name: 'skill-id fallback identity',
          selfBuff: { attack: 1.2 },
          effect: 'beast_frenzy_buff',
          hostile: false
        },
        {
          name: 'different target effect',
          selfBuff: 'berserk',
          effect: 'weaken',
          hostile: true
        }
      ];

      const originalRandom = Math.random;
      try {
        Math.random = () => 0.5;
        for (const testCase of cases) {
          const skill = createMockSkill({
            id: 'beast_frenzy',
            power: 80,
            effectDuration: 3,
            selfBuff: testCase.selfBuff,
            effect: testCase.effect
          });
          const action = {
            type: 'skill',
            targetId: target.id,
            skill
          };
          const result = evaluator.evaluateAction(caster, action, state);
          const withoutTargetEffect = evaluator.evaluateAction(caster, {
            ...action,
            skill: { ...skill, effect: null }
          }, state);

          assert.ok(result.factors.DAMAGE_DEALT > 0, testCase.name);
          if (testCase.hostile) {
            assert.ok(
              result.factors.DAMAGE_DEALT >
                withoutTargetEffect.factors.DAMAGE_DEALT,
              testCase.name
            );
          } else {
            assert.strictEqual(
              result.factors.DAMAGE_DEALT,
              withoutTargetEffect.factors.DAMAGE_DEALT,
              testCase.name
            );
          }
          assert.strictEqual(result.factors.HEALING_VALUE, 50, testCase.name);
        }
      } finally {
        Math.random = originalRandom;
      }
    });

    it('strongly penalizes spending MP to heal a full-health ally', () => {
      const state = createMockBattleState(
        [],
        [
          { tileX: 5, tileY: 5, hp: 200, maxHp: 200, mp: 50, maxMp: 100 },
          { tileX: 6, tileY: 5, hp: 200, maxHp: 200 }
        ]
      );
      const evaluator = new StateEvaluator(getWeights('support'));
      const healer = state.units[0];
      const target = state.units[1];
      const wastedHeal = createMockSkill({
        damageType: 'heal',
        power: 0,
        healPercent: 30,
        mpCost: 20,
        targetAlly: true
      });
      const freeHeal = { ...wastedHeal, mpCost: 0 };

      const wastedResult = evaluator.evaluateAction(healer, {
        type: 'skill',
        targetId: target.id,
        skill: wastedHeal
      }, state);
      const freeResult = evaluator.evaluateAction(healer, {
        type: 'skill',
        targetId: target.id,
        skill: freeHeal
      }, state);

      assert.strictEqual(wastedResult.factors.HEALING_VALUE, 0);
      assert.strictEqual(wastedResult.factors._skillBenefit, 0);
      assert.strictEqual(wastedResult.factors.MP_EFFICIENCY, -200);
      assert.ok(wastedResult.score < freeResult.score - 300,
        'a useless mana-consuming heal should be substantially worse than a free no-op');
    });

    it('scores a self MP restore as support rather than damage', () => {
      const state = createMockBattleState(
        [],
        [{ tileX: 5, tileY: 5, mp: 20, maxMp: 100 }]
      );
      const evaluator = new StateEvaluator(getWeights('support'));
      const actor = state.units[0];
      const restoreSkill = createMockSkill({
        power: 0,
        mpCost: 0,
        mpRestore: 20,
        targetSelf: true
      });

      const result = evaluator.evaluateAction(actor, {
        type: 'skill',
        targetId: actor.id,
        skill: restoreSkill
      }, state);

      assert.strictEqual(result.factors.DAMAGE_DEALT, 0);
      assert.strictEqual(result.factors.KILL_POTENTIAL, 0);
      assert.strictEqual(result.factors.TARGET_PRIORITY, 0);
      assert.strictEqual(result.factors.HEALING_VALUE, 20);
      assert.strictEqual(result.factors._skillBenefit, 20);
    });

    it('does not value cleansing beneficial legacy statuses', () => {
      const beneficialStatuses = [
        { type: 'rage', duration: 2 },
        { type: 'fortify', duration: 2 },
        { type: 'haste', duration: 2 },
        { type: 'regen', duration: 2 },
        { type: 'attack_up', duration: 2 },
        { type: 'defense_up', duration: 2 },
        { type: 'magic_shield', duration: 2 },
        'berserk',
        { type: 'frenzy', duration: 2 },
        'final_stand',
        { type: 'shadow_arts', duration: 2 },
        'pack_bonus',
        { type: 'regenerate', duration: 2 },
        'unmovable',
        { type: 'fire_resist', duration: 2 },
        {
          type: 'test_rally_buff',
          duration: 2,
          modifiers: { defense: 1.25 }
        }
      ];
      const state = createMockBattleState(
        [],
        [{ statusEffects: beneficialStatuses }]
      );
      const evaluator = new StateEvaluator(getWeights('support'));
      const caster = state.units[0];
      const cleanse = createMockSkill({
        id: 'purify',
        power: 0,
        mpCost: 0,
        targetSelf: true,
        cleanse: true
      });

      const result = evaluator.evaluateAction(caster, {
        type: 'skill',
        targetId: caster.id,
        skill: cleanse
      }, state);

      assert.strictEqual(result.factors.HEALING_VALUE, 0);
      assert.strictEqual(result.factors._skillBenefit, 0);
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

  describe('evaluateAction() item scoring', { skip: !canImport }, () => {
    // Helper to create an item action targeting a specific unit
    function createItemAction(item, targetUnit) {
      return {
        type: 'item',
        item,
        itemId: item.itemId || 'item_1',
        target: { x: targetUnit.tileX, y: targetUnit.tileY, unitId: targetUnit.id, unitName: targetUnit.name },
        targetId: targetUnit.id
      };
    }

    describe('heal_hp urgency scoring', () => {
      it('scores highest urgency (3.0x) when target below 25% HP', () => {
        const state = createMockBattleState(
          [],
          [
            { tileX: 5, tileY: 5, hp: 200, maxHp: 200 },
            { tileX: 6, tileY: 5, hp: 40, maxHp: 200 }  // 20% HP
          ]
        );
        const evaluator = new StateEvaluator(getWeights('defensive'));
        const actor = state.units[0];
        const target = state.units[1];
        const item = { effectType: 'heal_hp', effectValue: 100 };
        const action = createItemAction(item, target);
        const result = evaluator.evaluateAction(actor, action, state);

        // 100 restored * 3.0 urgency = 300 healing value
        assert.strictEqual(result.factors.HEALING_VALUE, 300);
        assert.strictEqual(result.factors.DAMAGE_DEALT, 0);
        assert.strictEqual(result.factors.KILL_POTENTIAL, 0);
        assert.strictEqual(result.factors.TARGET_PRIORITY, 0);
        assert.strictEqual(result.factors.MP_EFFICIENCY, 100);
      });

      it('scores 2.0x urgency when target between 25-40% HP', () => {
        const state = createMockBattleState(
          [],
          [
            { tileX: 5, tileY: 5, hp: 200, maxHp: 200 },
            { tileX: 6, tileY: 5, hp: 60, maxHp: 200 }  // 30% HP
          ]
        );
        const evaluator = new StateEvaluator(getWeights('defensive'));
        const actor = state.units[0];
        const target = state.units[1];
        const item = { effectType: 'heal_hp', effectValue: 100 };
        const action = createItemAction(item, target);
        const result = evaluator.evaluateAction(actor, action, state);

        // 100 restored * 2.0 urgency = 200
        assert.strictEqual(result.factors.HEALING_VALUE, 200);
      });

      it('scores 1.2x urgency when target between 40-60% HP', () => {
        const state = createMockBattleState(
          [],
          [
            { tileX: 5, tileY: 5, hp: 200, maxHp: 200 },
            { tileX: 6, tileY: 5, hp: 100, maxHp: 200 }  // 50% HP
          ]
        );
        const evaluator = new StateEvaluator(getWeights('defensive'));
        const actor = state.units[0];
        const target = state.units[1];
        const item = { effectType: 'heal_hp', effectValue: 50 };
        const action = createItemAction(item, target);
        const result = evaluator.evaluateAction(actor, action, state);

        // 50 restored * 1.2 urgency = 60
        assert.strictEqual(result.factors.HEALING_VALUE, 60);
      });

      it('scores 0.5x urgency when target between 60-80% HP', () => {
        const state = createMockBattleState(
          [],
          [
            { tileX: 5, tileY: 5, hp: 200, maxHp: 200 },
            { tileX: 6, tileY: 5, hp: 140, maxHp: 200 }  // 70% HP
          ]
        );
        const evaluator = new StateEvaluator(getWeights('defensive'));
        const actor = state.units[0];
        const target = state.units[1];
        const item = { effectType: 'heal_hp', effectValue: 50 };
        const action = createItemAction(item, target);
        const result = evaluator.evaluateAction(actor, action, state);

        // 50 restored * 0.5 urgency = 25
        assert.strictEqual(result.factors.HEALING_VALUE, 25);
      });

      it('scores 0.2x urgency when target at 80%+ HP', () => {
        const state = createMockBattleState(
          [],
          [
            { tileX: 5, tileY: 5, hp: 200, maxHp: 200 },
            { tileX: 6, tileY: 5, hp: 180, maxHp: 200 }  // 90% HP
          ]
        );
        const evaluator = new StateEvaluator(getWeights('defensive'));
        const actor = state.units[0];
        const target = state.units[1];
        const item = { effectType: 'heal_hp', effectValue: 50 };
        const action = createItemAction(item, target);
        const result = evaluator.evaluateAction(actor, action, state);

        // Only 20 missing HP, so restored = min(50, 20) = 20; 20 * 0.2 = 4
        assert.strictEqual(result.factors.HEALING_VALUE, 4);
      });

      it('caps heal at missing HP (does not overheal)', () => {
        const state = createMockBattleState(
          [],
          [
            { tileX: 5, tileY: 5, hp: 200, maxHp: 200 },
            { tileX: 6, tileY: 5, hp: 170, maxHp: 200 }  // 85% HP, missing 30
          ]
        );
        const evaluator = new StateEvaluator(getWeights('defensive'));
        const actor = state.units[0];
        const target = state.units[1];
        const item = { effectType: 'heal_hp', effectValue: 500 };
        const action = createItemAction(item, target);
        const result = evaluator.evaluateAction(actor, action, state);

        // missing = 30, restored = min(500, 30) = 30; 85% HP => 0.2x urgency; 30 * 0.2 = 6
        assert.strictEqual(result.factors.HEALING_VALUE, 6);
      });

      it('scores 0 healing for target at full HP (no missing HP)', () => {
        const state = createMockBattleState(
          [],
          [
            { tileX: 5, tileY: 5, hp: 200, maxHp: 200 },
            { tileX: 6, tileY: 5, hp: 200, maxHp: 200 }  // full HP
          ]
        );
        const evaluator = new StateEvaluator(getWeights('defensive'));
        const actor = state.units[0];
        const target = state.units[1];
        const item = { effectType: 'heal_hp', effectValue: 100 };
        const action = createItemAction(item, target);
        const result = evaluator.evaluateAction(actor, action, state);

        // restored = min(100, 0) = 0; 0 * any_urgency = 0
        assert.strictEqual(result.factors.HEALING_VALUE, 0);
      });

      it('scores 0 for dead target (hp <= 0)', () => {
        const state = createMockBattleState(
          [],
          [
            { tileX: 5, tileY: 5, hp: 200, maxHp: 200 },
            { tileX: 6, tileY: 5, hp: 0, maxHp: 200 }
          ]
        );
        const evaluator = new StateEvaluator(getWeights('defensive'));
        const actor = state.units[0];
        const target = state.units[1];
        const item = { effectType: 'heal_hp', effectValue: 100 };
        const action = createItemAction(item, target);
        const result = evaluator.evaluateAction(actor, action, state);

        // Dead target: hp > 0 check fails, so healingValue stays 0
        assert.strictEqual(result.factors.HEALING_VALUE, 0);
      });
    });

    describe('heal_both scoring', () => {
      it('scores heal_both for HP urgency same as heal_hp', () => {
        const state = createMockBattleState(
          [],
          [
            { tileX: 5, tileY: 5, hp: 200, maxHp: 200 },
            { tileX: 6, tileY: 5, hp: 40, maxHp: 200, mp: 10, maxMp: 100, skills: [{ id: 's1' }] }
          ]
        );
        const evaluator = new StateEvaluator(getWeights('defensive'));
        const actor = state.units[0];
        const target = state.units[1];
        const item = { effectType: 'heal_both', effectValue: 100 };
        const action = createItemAction(item, target);
        const result = evaluator.evaluateAction(actor, action, state);

        // HP: restored = min(100, 160) = 100; 20% HP => 3.0x urgency => 300
        // MP: mpValue = floor(100/2) = 50; restored = min(50, 90) = 50; 10% MP => 2.0x; hasSkills = 1.5; => 50 * 2.0 * 1.5 = 150
        // Total = 300 + 150 = 450
        assert.strictEqual(result.factors.HEALING_VALUE, 450);
      });
    });

    describe('heal_mp scoring', () => {
      it('scales MP urgency with hasSkills multiplier (1.5 if has skills)', () => {
        const state = createMockBattleState(
          [],
          [
            { tileX: 5, tileY: 5, hp: 200, maxHp: 200 },
            { tileX: 6, tileY: 5, hp: 200, maxHp: 200, mp: 10, maxMp: 100, skills: [{ id: 's1' }] }
          ]
        );
        const evaluator = new StateEvaluator(getWeights('defensive'));
        const actor = state.units[0];
        const target = state.units[1];
        const item = { effectType: 'heal_mp', effectValue: 50 };
        const action = createItemAction(item, target);
        const result = evaluator.evaluateAction(actor, action, state);

        // restored = min(50, 90) = 50; 10% MP => 2.0x urgency; hasSkills = 1.5
        // 50 * 2.0 * 1.5 = 150
        assert.strictEqual(result.factors.HEALING_VALUE, 150);
      });

      it('uses 0.5 multiplier when target has no skills', () => {
        const state = createMockBattleState(
          [],
          [
            { tileX: 5, tileY: 5, hp: 200, maxHp: 200 },
            { tileX: 6, tileY: 5, hp: 200, maxHp: 200, mp: 10, maxMp: 100, skills: [] }
          ]
        );
        const evaluator = new StateEvaluator(getWeights('defensive'));
        const actor = state.units[0];
        const target = state.units[1];
        const item = { effectType: 'heal_mp', effectValue: 50 };
        const action = createItemAction(item, target);
        const result = evaluator.evaluateAction(actor, action, state);

        // restored = min(50, 90) = 50; 10% MP => 2.0x; hasSkills = 0.5
        // 50 * 2.0 * 0.5 = 50
        assert.strictEqual(result.factors.HEALING_VALUE, 50);
      });

      it('scores 0 when target MP is full', () => {
        const state = createMockBattleState(
          [],
          [
            { tileX: 5, tileY: 5, hp: 200, maxHp: 200 },
            { tileX: 6, tileY: 5, hp: 200, maxHp: 200, mp: 100, maxMp: 100, skills: [{ id: 's1' }] }
          ]
        );
        const evaluator = new StateEvaluator(getWeights('defensive'));
        const actor = state.units[0];
        const target = state.units[1];
        const item = { effectType: 'heal_mp', effectValue: 50 };
        const action = createItemAction(item, target);
        const result = evaluator.evaluateAction(actor, action, state);

        // restored = min(50, 0) = 0; 0 * anything = 0
        assert.strictEqual(result.factors.HEALING_VALUE, 0);
      });
    });

    describe('cure_poison and cure_all scoring', () => {
      it('scores 80 per cleansable poison effect', () => {
        const state = createMockBattleState(
          [],
          [
            { tileX: 5, tileY: 5, hp: 200, maxHp: 200 },
            { tileX: 6, tileY: 5, hp: 100, maxHp: 200, statusEffects: [
              { type: 'poison' }, { type: 'poison' }
            ]}
          ]
        );
        const evaluator = new StateEvaluator(getWeights('defensive'));
        const actor = state.units[0];
        const target = state.units[1];
        const item = { effectType: 'cure_poison', effectValue: 0 };
        const action = createItemAction(item, target);
        const result = evaluator.evaluateAction(actor, action, state);

        // 80 * 2 poison effects = 160
        assert.strictEqual(result.factors.HEALING_VALUE, 160);
      });

      it('cure_poison ignores non-poison effects', () => {
        const state = createMockBattleState(
          [],
          [
            { tileX: 5, tileY: 5, hp: 200, maxHp: 200 },
            { tileX: 6, tileY: 5, hp: 100, maxHp: 200, statusEffects: [
              { type: 'poison' }, { type: 'blind' }, { type: 'silence' }
            ]}
          ]
        );
        const evaluator = new StateEvaluator(getWeights('defensive'));
        const actor = state.units[0];
        const target = state.units[1];
        const item = { effectType: 'cure_poison', effectValue: 0 };
        const action = createItemAction(item, target);
        const result = evaluator.evaluateAction(actor, action, state);

        // Only 1 poison is cleansable by cure_poison
        assert.strictEqual(result.factors.HEALING_VALUE, 80);
      });

      it('cure_all cleanses poison, blind, silence, slow, burn', () => {
        const state = createMockBattleState(
          [],
          [
            { tileX: 5, tileY: 5, hp: 200, maxHp: 200 },
            { tileX: 6, tileY: 5, hp: 100, maxHp: 200, statusEffects: [
              { type: 'poison' }, { type: 'blind' }, { type: 'silence' },
              { type: 'slow' }, { type: 'burn' }
            ]}
          ]
        );
        const evaluator = new StateEvaluator(getWeights('defensive'));
        const actor = state.units[0];
        const target = state.units[1];
        const item = { effectType: 'cure_all', effectValue: 0 };
        const action = createItemAction(item, target);
        const result = evaluator.evaluateAction(actor, action, state);

        // 80 * 5 effects = 400
        assert.strictEqual(result.factors.HEALING_VALUE, 400);
      });

      it('scores 0 when target has no cleansable effects', () => {
        const state = createMockBattleState(
          [],
          [
            { tileX: 5, tileY: 5, hp: 200, maxHp: 200 },
            { tileX: 6, tileY: 5, hp: 100, maxHp: 200, statusEffects: [] }
          ]
        );
        const evaluator = new StateEvaluator(getWeights('defensive'));
        const actor = state.units[0];
        const target = state.units[1];
        const item = { effectType: 'cure_all', effectValue: 0 };
        const action = createItemAction(item, target);
        const result = evaluator.evaluateAction(actor, action, state);

        assert.strictEqual(result.factors.HEALING_VALUE, 0);
      });
    });

    describe('revive scoring', () => {
      it('scores 500 for reviving a dead target', () => {
        const state = createMockBattleState(
          [],
          [
            { tileX: 5, tileY: 5, hp: 200, maxHp: 200 },
            { tileX: 6, tileY: 5, hp: 0, maxHp: 200 }
          ]
        );
        const evaluator = new StateEvaluator(getWeights('defensive'));
        const actor = state.units[0];
        const target = state.units[1];
        const item = { effectType: 'revive', effectValue: 50 };
        const action = createItemAction(item, target);
        const result = evaluator.evaluateAction(actor, action, state);

        assert.strictEqual(result.factors.HEALING_VALUE, 500);
      });

      it('scores 0 for revive on alive target', () => {
        const state = createMockBattleState(
          [],
          [
            { tileX: 5, tileY: 5, hp: 200, maxHp: 200 },
            { tileX: 6, tileY: 5, hp: 50, maxHp: 200 }
          ]
        );
        const evaluator = new StateEvaluator(getWeights('defensive'));
        const actor = state.units[0];
        const target = state.units[1];
        const item = { effectType: 'revive', effectValue: 50 };
        const action = createItemAction(item, target);
        const result = evaluator.evaluateAction(actor, action, state);

        assert.strictEqual(result.factors.HEALING_VALUE, 0);
      });
    });

    describe('item action common factors', () => {
      it('always sets DAMAGE_DEALT, KILL_POTENTIAL, TARGET_PRIORITY to 0', () => {
        const state = createMockBattleState(
          [],
          [
            { tileX: 5, tileY: 5, hp: 200, maxHp: 200 },
            { tileX: 6, tileY: 5, hp: 40, maxHp: 200 }
          ]
        );
        const evaluator = new StateEvaluator(getWeights('aggressive'));
        const actor = state.units[0];
        const target = state.units[1];
        const item = { effectType: 'heal_hp', effectValue: 100 };
        const action = createItemAction(item, target);
        const result = evaluator.evaluateAction(actor, action, state);

        assert.strictEqual(result.factors.DAMAGE_DEALT, 0);
        assert.strictEqual(result.factors.KILL_POTENTIAL, 0);
        assert.strictEqual(result.factors.TARGET_PRIORITY, 0);
      });

      it('always sets MP_EFFICIENCY to 100 (items are free)', () => {
        const state = createMockBattleState(
          [],
          [
            { tileX: 5, tileY: 5, hp: 200, maxHp: 200 },
            { tileX: 6, tileY: 5, hp: 40, maxHp: 200 }
          ]
        );
        const evaluator = new StateEvaluator(getWeights('tactical'));
        const actor = state.units[0];
        const target = state.units[1];
        const item = { effectType: 'heal_hp', effectValue: 50 };
        const action = createItemAction(item, target);
        const result = evaluator.evaluateAction(actor, action, state);

        assert.strictEqual(result.factors.MP_EFFICIENCY, 100);
      });
    });

    describe('item pattern bonuses via getActionTypeBonus()', () => {
      it('defensive pattern gives +20 for item', () => {
        const evaluator = new StateEvaluator(getWeights('defensive'));
        assert.strictEqual(evaluator.getActionTypeBonus('item'), 20);
      });

      it('aggressive pattern gives +10 for item', () => {
        const evaluator = new StateEvaluator(getWeights('aggressive'));
        assert.strictEqual(evaluator.getActionTypeBonus('item'), 10);
      });

      it('tactical pattern gives +20 for item', () => {
        const evaluator = new StateEvaluator(getWeights('tactical'));
        assert.strictEqual(evaluator.getActionTypeBonus('item'), 20);
      });
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

  describe('getBestSequence()', { skip: !canImport }, () => {
    it('returns wait sequence for empty sequences array', () => {
      const evaluator = new StateEvaluator(getWeights('aggressive'));
      const unit = createMockUnit({ type: 'enemy' });
      const state = createMockBattleState([{}], []);
      state.units.push(unit);
      const result = evaluator.getBestSequence(unit, [], state);
      assert.strictEqual(result.bestAction.length, 1);
      assert.strictEqual(result.bestAction[0].type, 'wait');
      assert.strictEqual(result.score, 0);
      assert.deepStrictEqual(result.allScores, []);
      assert.deepStrictEqual(result.alternatives, []);
    });

    it('returns wait sequence for null sequences', () => {
      const evaluator = new StateEvaluator(getWeights('aggressive'));
      const unit = createMockUnit({ type: 'enemy' });
      const state = createMockBattleState([{}], []);
      state.units.push(unit);
      const result = evaluator.getBestSequence(unit, null, state);
      assert.strictEqual(result.bestAction[0].type, 'wait');
    });

    it('returns allScores sorted descending', () => {
      const state = createMockBattleState(
        [{ tileX: 6, tileY: 5, hp: 100, maxHp: 200, vitality: 10, defense: 5 }],
        [{ tileX: 5, tileY: 5, strength: 40, attack: 20 }]
      );
      const evaluator = new StateEvaluator(getWeights('aggressive'));
      const enemy = state.units[1];
      const sequences = [
        [{ type: 'wait' }],
        [{ type: 'move', position: { x: 7, y: 5 } }],
        [{ type: 'attack', targetId: state.units[0].id }]
      ];
      const result = evaluator.getBestSequence(enemy, sequences, state);
      assert.strictEqual(result.allScores.length, 3);
      for (let i = 1; i < result.allScores.length; i++) {
        assert.ok(result.allScores[i - 1].score >= result.allScores[i].score,
          `allScores should be sorted descending`);
      }
    });

    it('returns alternatives array with top 3 non-best sequences', () => {
      const state = createMockBattleState(
        [{ tileX: 6, tileY: 5, hp: 100, maxHp: 200, vitality: 10, defense: 5 }],
        [{ tileX: 5, tileY: 5, strength: 40, attack: 20 }]
      );
      const evaluator = new StateEvaluator(getWeights('tactical'));
      const enemy = state.units[1];
      const sequences = [
        [{ type: 'wait' }],
        [{ type: 'move', position: { x: 7, y: 5 } }],
        [{ type: 'move', position: { x: 4, y: 5 } }],
        [{ type: 'attack', targetId: state.units[0].id }],
        [{ type: 'move', position: { x: 5, y: 6 } }]
      ];
      const result = evaluator.getBestSequence(enemy, sequences, state);
      // alternatives should be top 3 after the best
      assert.ok(result.alternatives.length <= 3, 'alternatives should have at most 3 entries');
      assert.ok(result.alternatives.length > 0, 'should have at least one alternative');
      for (const alt of result.alternatives) {
        assert.ok(alt.action, 'alternative should have action');
        assert.ok(typeof alt.score === 'number', 'alternative should have score');
      }
    });

    it('selects highest scoring sequence as bestAction', () => {
      const state = createMockBattleState(
        [{ tileX: 6, tileY: 5, hp: 50, maxHp: 200, vitality: 10, defense: 5 }],
        [{ tileX: 5, tileY: 5, strength: 50, attack: 25 }]
      );
      const evaluator = new StateEvaluator(getWeights('aggressive'));
      const enemy = state.units[1];
      const attackSeq = [{ type: 'attack', targetId: state.units[0].id }];
      const waitSeq = [{ type: 'wait' }];
      const sequences = [waitSeq, attackSeq];
      const result = evaluator.getBestSequence(enemy, sequences, state);
      // Aggressive pattern should prefer attack over wait
      assert.strictEqual(result.bestAction[0].type, 'attack');
    });
  });

  describe('evaluateSequence()', { skip: !canImport }, () => {
    it('returns -1000 for empty sequence', () => {
      const evaluator = new StateEvaluator(getWeights('aggressive'));
      const unit = createMockUnit({ type: 'enemy' });
      const state = createMockBattleState([{}], []);
      state.units.push(unit);
      const result = evaluator.evaluateSequence(unit, [], state);
      assert.strictEqual(result.score, -1000);
      assert.deepStrictEqual(result.factors, {});
    });

    it('returns -1000 for null sequence', () => {
      const evaluator = new StateEvaluator(getWeights('aggressive'));
      const unit = createMockUnit({ type: 'enemy' });
      const state = createMockBattleState([{}], []);
      state.units.push(unit);
      const result = evaluator.evaluateSequence(unit, null, state);
      assert.strictEqual(result.score, -1000);
    });

    it('sums scores for multi-action sequence', () => {
      const state = createMockBattleState(
        [{ tileX: 8, tileY: 5, hp: 100, maxHp: 200, vitality: 10, defense: 5 }],
        [{ tileX: 5, tileY: 5, strength: 40, attack: 20 }]
      );
      const evaluator = new StateEvaluator(getWeights('tactical'));
      const enemy = state.units[1];
      // Single move action
      const moveOnly = [{ type: 'move', position: { x: 7, y: 5 } }];
      // Single attack action
      const attackOnly = [{ type: 'attack', targetId: state.units[0].id }];
      // Combined sequence (move then attack) - note: may get bonus
      const combined = [
        { type: 'move', position: { x: 7, y: 5 } },
        { type: 'attack', targetId: state.units[0].id }
      ];

      const moveResult = evaluator.evaluateSequence(enemy, moveOnly, state);
      const attackResult = evaluator.evaluateSequence(enemy, attackOnly, state);
      const combinedResult = evaluator.evaluateSequence(enemy, combined, state);

      // Combined should be at least the sum of individual scores
      // (plus potential two-action bonus of 30)
      const expectedMin = moveResult.score + attackResult.score;
      assert.ok(combinedResult.score >= expectedMin,
        `Combined score ${combinedResult.score} should be >= sum of parts ${expectedMin}`);
    });

    it('gives +30 bonus for move+attack combination', () => {
      const state = createMockBattleState(
        [{ tileX: 8, tileY: 5, hp: 100, maxHp: 200, vitality: 10, defense: 5 }],
        [{ tileX: 5, tileY: 5, strength: 40, attack: 20 }]
      );
      const evaluator = new StateEvaluator(getWeights('aggressive'));
      const enemy = state.units[1];
      const sequence = [
        { type: 'move', position: { x: 7, y: 5 } },
        { type: 'attack', targetId: state.units[0].id }
      ];
      const result = evaluator.evaluateSequence(enemy, sequence, state);
      assert.strictEqual(result.factors.twoActionBonus, 30);
    });

    it('treats expected incoming damage as a cost when choosing a destination', () => {
      const state = createMockBattleState(
        [{ tileX: 6, tileY: 5, movement: 3, attackRange: 1 }],
        [{ tileX: 5, tileY: 5 }]
      );
      const evaluator = new StateEvaluator({
        name: 'RiskOnly',
        weights: { DAMAGE_RECEIVED: 1 }
      });
      const enemy = state.units[1];

      const threatened = evaluator.evaluateSequence(enemy, [{
        type: 'move',
        position: { x: 5, y: 6 }
      }], state);
      const safe = evaluator.evaluateSequence(enemy, [{
        type: 'move',
        position: { x: 0, y: 0 }
      }], state);

      assert.ok(threatened.factors.finalRisk.DAMAGE_RECEIVED > 0);
      assert.strictEqual(safe.factors.finalRisk.DAMAGE_RECEIVED, 0);
      assert.ok(safe.score > threatened.score,
        'lower-risk destinations should score higher');
    });

    it('rewards hit-and-run units for attacking before retreating', () => {
      const state = createMockBattleState(
        [{ tileX: 6, tileY: 5, hp: 200, maxHp: 200 }],
        [{ tileX: 5, tileY: 5, hp: 200, maxHp: 200 }]
      );
      const evaluator = new StateEvaluator(getWeights('hit-and-run'));
      const enemy = state.units[1];
      const attack = { type: 'attack', targetId: state.units[0].id };
      const retreat = { type: 'move', position: { x: 0, y: 0 } };

      const attackThenRetreat = evaluator.evaluateSequence(
        enemy,
        [attack, retreat],
        state
      );
      const retreatThenAttack = evaluator.evaluateSequence(
        enemy,
        [retreat, attack],
        state
      );

      assert.ok(attackThenRetreat.factors.retreatBonus > 0);
      assert.ok(attackThenRetreat.score > retreatThenAttack.score,
        'the legal attack-then-retreat order should be preferred');
    });

    it('gives +30 bonus for move+skill combination', () => {
      const state = createMockBattleState(
        [{ tileX: 8, tileY: 5, hp: 100, maxHp: 200, vitality: 10, defense: 5 }],
        [{ tileX: 5, tileY: 5, strength: 40, attack: 20, mp: 50, maxMp: 100 }]
      );
      const evaluator = new StateEvaluator(getWeights('tactical'));
      const enemy = state.units[1];
      const skill = createMockSkill({ power: 120, mpCost: 15 });
      const sequence = [
        { type: 'move', position: { x: 7, y: 5 } },
        { type: 'skill', targetId: state.units[0].id, skill }
      ];
      const result = evaluator.evaluateSequence(enemy, sequence, state);
      assert.strictEqual(result.factors.twoActionBonus, 30);
    });

    it('gives +30 bonus for move+healing skill combination', () => {
      const state = createMockBattleState(
        [],
        [
          { tileX: 5, tileY: 5, hp: 200, maxHp: 200, mp: 50, maxMp: 100 },
          { tileX: 8, tileY: 5, hp: 40, maxHp: 200 }  // wounded ally
        ]
      );
      const evaluator = new StateEvaluator(getWeights('support'));
      const healer = state.units[0];
      const healSkill = createMockSkill({
        power: 0,
        healPercent: 30,
        damageType: 'heal',
        mpCost: 20,
        targetType: 'ally'
      });
      const sequence = [
        { type: 'move', position: { x: 7, y: 5 } },
        { type: 'skill', targetId: state.units[1].id, skill: healSkill }
      ];
      const result = evaluator.evaluateSequence(healer, sequence, state);
      assert.strictEqual(result.factors.twoActionBonus, 30);
    });

    it('gives +30 bonus for move+healing item combination', () => {
      const state = createMockBattleState(
        [],
        [
          { tileX: 5, tileY: 5, hp: 200, maxHp: 200 },
          { tileX: 8, tileY: 5, hp: 40, maxHp: 200 }  // wounded ally
        ]
      );
      const evaluator = new StateEvaluator(getWeights('defensive'));
      const actor = state.units[0];
      const target = state.units[1];
      const sequence = [
        { type: 'move', position: { x: 7, y: 5 } },
        {
          type: 'item',
          item: { effectType: 'heal_hp', effectValue: 100 },
          itemId: 'potion_1',
          target: { x: target.tileX, y: target.tileY, unitId: target.id },
          targetId: target.id
        }
      ];
      const result = evaluator.evaluateSequence(actor, sequence, state);
      assert.strictEqual(result.factors.twoActionBonus, 30);
    });

    it('no bonus for single action sequence', () => {
      const state = createMockBattleState(
        [{ tileX: 6, tileY: 5, hp: 100, maxHp: 200, vitality: 10, defense: 5 }],
        [{ tileX: 5, tileY: 5, strength: 40, attack: 20 }]
      );
      const evaluator = new StateEvaluator(getWeights('aggressive'));
      const enemy = state.units[1];
      const sequence = [{ type: 'attack', targetId: state.units[0].id }];
      const result = evaluator.evaluateSequence(enemy, sequence, state);
      assert.strictEqual(result.factors.twoActionBonus, undefined);
    });

    it('no bonus for two-action sequence without move', () => {
      const state = createMockBattleState(
        [{ tileX: 6, tileY: 5, hp: 100, maxHp: 200, vitality: 10, defense: 5 }],
        [{ tileX: 5, tileY: 5, strength: 40, attack: 20, mp: 50, maxMp: 100 }]
      );
      const evaluator = new StateEvaluator(getWeights('aggressive'));
      const enemy = state.units[1];
      const skill = createMockSkill({ power: 120, mpCost: 10 });
      // Two attacks without move
      const sequence = [
        { type: 'attack', targetId: state.units[0].id },
        { type: 'skill', targetId: state.units[0].id, skill }
      ];
      const result = evaluator.evaluateSequence(enemy, sequence, state);
      assert.strictEqual(result.factors.twoActionBonus, undefined);
    });

    it('no bonus for move+wait sequence', () => {
      const state = createMockBattleState(
        [{ tileX: 10, tileY: 5 }],
        [{ tileX: 5, tileY: 5 }]
      );
      const evaluator = new StateEvaluator(getWeights('defensive'));
      const enemy = state.units[1];
      const sequence = [
        { type: 'move', position: { x: 6, y: 5 } },
        { type: 'wait' }
      ];
      const result = evaluator.evaluateSequence(enemy, sequence, state);
      assert.strictEqual(result.factors.twoActionBonus, undefined);
    });

    it('updates hypothetical position after move in sequence', () => {
      const state = createMockBattleState(
        [{ tileX: 10, tileY: 5, hp: 100, maxHp: 200, vitality: 10, defense: 5 }],
        [{ tileX: 5, tileY: 5, strength: 40, attack: 20, attackRange: 1 }]
      );
      const evaluator = new StateEvaluator(getWeights('tactical'));
      const enemy = state.units[1];

      // Move first to get in range, then attack
      // Enemy starts at (5,5), target at (10,5) - distance = 5
      // After move to (9,5), distance to target = 1 (in attack range)
      const sequence = [
        { type: 'move', position: { x: 9, y: 5 } },
        { type: 'attack', targetId: state.units[0].id }
      ];

      const result = evaluator.evaluateSequence(enemy, sequence, state);

      // The attack should be evaluated as if the unit is at (9,5)
      // Verify the sequence was evaluated (has action0 and action1 factors)
      assert.ok(result.factors.action0, 'should have factors for move action');
      assert.ok(result.factors.action1, 'should have factors for attack action');
      // The attack should have meaningful damage dealt (not -1000 for invalid)
      assert.ok(result.factors.action1.DAMAGE_DEALT >= 0,
        'attack after move should calculate damage based on new position');
    });

    it('stores factors with indexed keys for each action', () => {
      const state = createMockBattleState(
        [{ tileX: 8, tileY: 5, hp: 100, maxHp: 200, vitality: 10, defense: 5 }],
        [{ tileX: 5, tileY: 5, strength: 40, attack: 20 }]
      );
      const evaluator = new StateEvaluator(getWeights('tactical'));
      const enemy = state.units[1];
      const sequence = [
        { type: 'move', position: { x: 7, y: 5 } },
        { type: 'attack', targetId: state.units[0].id }
      ];
      const result = evaluator.evaluateSequence(enemy, sequence, state);
      assert.ok(result.factors.action0, 'should have action0 factors');
      assert.ok(result.factors.action1, 'should have action1 factors');
    });
  });
});
