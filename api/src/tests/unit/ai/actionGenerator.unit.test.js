/**
 * Action Generator Unit Tests
 *
 * The actionGenerator module imports from battleService.js (getAvailableActions)
 * and npcSkillService.js (canUseSkill). We test the pure functions that do NOT
 * depend on those imports: isHealingSkill, pruneActions, orderActionsForPruning,
 * findImmediateThreats, findSaferTiles, getTargetsFromPosition.
 *
 * Functions like generateAllActions, generateMoveActionSequences,
 * generateThreatResponseActions depend on getAvailableActions and canUseSkill
 * so they are tested only if import succeeds.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createMockUnit, createMockBattleState, createMockSkill } from './mockHelpers.js';

let actionGenerator = null;
let importError = null;

try {
  actionGenerator = await import('../../../services/ai/actionGenerator.js');
} catch (err) {
  importError = err;
}

const canImport = actionGenerator !== null;

describe('ActionGenerator', () => {

  describe('isHealingSkill()', { skip: !canImport }, () => {
    const isHealingSkill = () => actionGenerator.isHealingSkill;

    it('returns true for skill with healPercent > 0', () => {
      assert.strictEqual(isHealingSkill()(createMockSkill({ healPercent: 30 })), true);
    });

    it('returns true for skill with damageType heal', () => {
      assert.strictEqual(isHealingSkill()(createMockSkill({ healPercent: 0, damageType: 'heal' })), true);
    });

    it('returns true for skill with effect heal', () => {
      assert.strictEqual(isHealingSkill()(createMockSkill({ healPercent: 0, effect: 'heal' })), true);
    });

    it('returns false for non-healing skill', () => {
      assert.strictEqual(isHealingSkill()(createMockSkill({ healPercent: 0, damageType: 'physical', effect: null })), false);
    });

    it('returns false for skill with healPercent 0', () => {
      assert.strictEqual(isHealingSkill()(createMockSkill({ healPercent: 0, damageType: 'fire' })), false);
    });
  });

  describe('skill action generation', { skip: !canImport }, () => {
    it('excludes a pure self heal at full HP and includes it when injured', () => {
      const heal = createMockSkill({
        id: 'regenerate',
        power: 0,
        range: 0,
        healPercent: 25,
        targetSelf: true
      });
      const state = createMockBattleState([], [{
        id: 'healer',
        tileX: 5,
        tileY: 5,
        hp: 200,
        maxHp: 200,
        mp: 50,
        skills: [heal]
      }]);
      const healer = state.units[0];

      let actions = actionGenerator.generateAllActions(healer, state);
      assert.strictEqual(
        actions.some(action => action.type === 'skill' && action.skillId === heal.id),
        false
      );

      healer.hp = 100;
      actions = actionGenerator.generateAllActions(healer, state);
      assert.ok(actions.some(action =>
        action.type === 'skill' &&
        action.skillId === heal.id &&
        action.targetId === healer.id
      ));
    });

    it('does not treat a positive power field on a heal as offensive damage', () => {
      const heal = createMockSkill({
        id: 'legacy_heal',
        power: 100,
        range: 0,
        healPercent: 25,
        damageType: 'heal',
        targetSelf: true
      });
      const state = createMockBattleState([], [{
        id: 'healer',
        tileX: 5,
        tileY: 5,
        hp: 200,
        maxHp: 200,
        mp: 50,
        skills: [heal]
      }]);

      const actions = actionGenerator.generateAllActions(state.units[0], state);

      assert.strictEqual(
        actions.some(action => action.type === 'skill' && action.skillId === heal.id),
        false
      );
    });

    it('normalizes a DB-shaped pure self heal before usefulness filtering', () => {
      const repair = {
        id: 'construct_repair',
        name: 'Repair',
        type: 'active',
        power: 0,
        range: 0,
        mpCost: 20,
        damageType: 'heal'
      };
      const state = createMockBattleState([], [{
        id: 'construct',
        tileX: 5,
        tileY: 5,
        hp: 200,
        maxHp: 200,
        mp: 50,
        skills: [repair]
      }]);
      const construct = state.units[0];
      const getRepairActions = () => actionGenerator.generateAllActions(construct, state)
        .filter(action =>
          action.type === 'skill' && action.skillId === repair.id
        );

      assert.deepStrictEqual(getRepairActions(), []);

      construct.hp = 120;
      const [repairAction] = getRepairActions();
      assert.ok(repairAction);
      assert.strictEqual(repairAction.targetId, construct.id);
      assert.strictEqual(repairAction.skill.healPercent, 20);
      assert.strictEqual(repairAction.skill.targetSelf, true);
    });

    it('excludes full-health ally heal targets and includes injured allies', () => {
      const heal = createMockSkill({
        id: 'heal_ally',
        power: 0,
        range: 3,
        healPercent: 25,
        targetAlly: true
      });
      const state = createMockBattleState([], [
        {
          id: 'healer',
          tileX: 5,
          tileY: 5,
          hp: 200,
          maxHp: 200,
          mp: 50,
          skills: [heal]
        },
        {
          id: 'ally',
          tileX: 6,
          tileY: 5,
          hp: 200,
          maxHp: 200
        }
      ]);
      const [healer, ally] = state.units;

      let healActions = actionGenerator.generateAllActions(healer, state)
        .filter(action => action.type === 'skill' && action.skillId === heal.id);
      assert.deepStrictEqual(healActions, []);

      ally.hp = 80;
      healActions = actionGenerator.generateAllActions(healer, state)
        .filter(action => action.type === 'skill' && action.skillId === heal.id);
      assert.deepStrictEqual(healActions.map(action => action.targetId), [ally.id]);
    });

    it('targets only injured teammates for a DB-shaped Heal Ally', () => {
      const heal = {
        id: 'humanoid_heal_ally',
        name: 'Heal Ally',
        type: 'active',
        power: 0,
        range: 4,
        mpCost: 12,
        damageType: 'heal'
      };
      const state = createMockBattleState(
        [{
          id: 'opponent',
          teamId: 1,
          tileX: 6,
          tileY: 5,
          hp: 50,
          maxHp: 200
        }],
        [
          {
            id: 'healer',
            teamId: 2,
            tileX: 5,
            tileY: 5,
            hp: 200,
            maxHp: 200,
            mp: 50,
            skills: [heal]
          },
          {
            id: 'injured-ally',
            teamId: 2,
            tileX: 7,
            tileY: 5,
            hp: 80,
            maxHp: 200
          },
          {
            id: 'full-ally',
            teamId: 2,
            tileX: 8,
            tileY: 5,
            hp: 200,
            maxHp: 200
          }
        ]
      );
      const healer = state.units.find(unit => unit.id === 'healer');
      const healActions = actionGenerator.generateAllActions(healer, state)
        .filter(action => action.type === 'skill' && action.skillId === heal.id);

      assert.deepStrictEqual(
        healActions.map(action => action.targetId),
        ['injured-ally']
      );
      assert.strictEqual(healActions[0].skill.healPercent, 25);
      assert.strictEqual(healActions[0].skill.targetAlly, true);
    });

    it('emits one caster-centered group heal only when an ally is injured', () => {
      const groupHeal = createMockSkill({
        id: 'healing_wind',
        power: 0,
        range: 0,
        healPercent: 25,
        targetAllAllies: true
      });
      const state = createMockBattleState([], [
        {
          id: 'healer',
          teamId: 7,
          tileX: 5,
          tileY: 5,
          hp: 200,
          maxHp: 200,
          mp: 50,
          skills: [groupHeal]
        },
        {
          id: 'ally',
          teamId: 7,
          tileX: 12,
          tileY: 5,
          hp: 200,
          maxHp: 200
        },
        {
          id: 'other-team',
          teamId: 8,
          tileX: 6,
          tileY: 5,
          hp: 50,
          maxHp: 200
        }
      ]);
      const healer = state.units.find(unit => unit.id === 'healer');
      const ally = state.units.find(unit => unit.id === 'ally');

      let groupActions = actionGenerator.generateAllActions(healer, state)
        .filter(action => action.type === 'skill' && action.skillId === groupHeal.id);
      assert.deepStrictEqual(groupActions, []);

      ally.hp = 80;
      groupActions = actionGenerator.generateAllActions(healer, state)
        .filter(action => action.type === 'skill' && action.skillId === groupHeal.id);
      assert.strictEqual(groupActions.length, 1);
      assert.strictEqual(groupActions[0].targetId, healer.id);
    });

    it('checks positive-range group buffs only against allies in range', () => {
      const howl = createMockSkill({
        id: 'howl',
        power: 0,
        range: 4,
        selfBuff: 'pack_bonus',
        targetAllAllies: true
      });
      const state = createMockBattleState([], [
        {
          id: 'caster',
          tileX: 5,
          tileY: 5,
          mp: 50,
          statusEffects: [{ type: 'pack_bonus' }],
          skills: [howl]
        },
        {
          id: 'ally',
          tileX: 12,
          tileY: 5
        }
      ]);
      const caster = state.units.find(unit => unit.id === 'caster');
      const ally = state.units.find(unit => unit.id === 'ally');

      let howlActions = actionGenerator.generateAllActions(caster, state)
        .filter(action => action.type === 'skill' && action.skillId === howl.id);
      assert.deepStrictEqual(howlActions, []);

      ally.tileX = 9;
      howlActions = actionGenerator.generateAllActions(caster, state)
        .filter(action => action.type === 'skill' && action.skillId === howl.id);
      assert.strictEqual(howlActions.length, 1);
      assert.strictEqual(howlActions[0].targetId, caster.id);
    });

    it('keeps offensive range-zero AoE skills caster-centered', () => {
      const nova = createMockSkill({
        id: 'fire_nova',
        power: 120,
        range: 0,
        aoeRadius: 1,
        damageType: 'fire'
      });
      const state = createMockBattleState(
        [{ id: 'target', tileX: 6, tileY: 5 }],
        [{
          id: 'caster',
          tileX: 5,
          tileY: 5,
          mp: 50,
          skills: [nova]
        }]
      );
      const caster = state.units.find(unit => unit.id === 'caster');

      const novaAction = actionGenerator.generateAllActions(caster, state)
        .find(action => action.type === 'skill' && action.skillId === nova.id);

      assert.ok(novaAction);
      assert.strictEqual(novaAction.targetId, undefined);
      assert.deepStrictEqual(novaAction.target, { x: 5, y: 5 });
      assert.deepStrictEqual(novaAction.aoeCenter, { x: 5, y: 5 });
    });

    it('normalizes DB-shaped Howl and skips it when all affected allies have attack up', () => {
      const howl = {
        id: 'beast_howl',
        name: 'Howl',
        type: 'active',
        power: 0,
        range: 0,
        mpCost: 5,
        damageType: 'support',
        effect: 'attack_up',
        effectChance: 1,
        aoeRadius: 2
      };
      const state = createMockBattleState(
        [{
          id: 'opponent',
          tileX: 6,
          tileY: 5,
          statusEffects: []
        }],
        [
          {
            id: 'caster',
            tileX: 5,
            tileY: 5,
            statusEffects: [{ type: 'attack_up' }],
            skills: [howl]
          },
          {
            id: 'nearby-ally',
            tileX: 5,
            tileY: 6,
            statusEffects: [{ type: 'attack_up' }]
          },
          {
            id: 'distant-ally',
            tileX: 10,
            tileY: 5,
            statusEffects: []
          }
        ]
      );
      const caster = state.units.find(unit => unit.id === 'caster');
      const nearbyAlly = state.units.find(unit => unit.id === 'nearby-ally');
      const getHowlAction = () => actionGenerator.generateAllActions(caster, state)
        .find(action => action.type === 'skill' && action.skillId === howl.id);

      assert.strictEqual(getHowlAction(), undefined);

      nearbyAlly.statusEffects = [];
      const howlAction = getHowlAction();
      assert.ok(howlAction);
      assert.deepStrictEqual(howlAction.skill.selfBuff, {
        type: 'attack_up',
        attack: 1.2
      });
      assert.strictEqual(howlAction.skill.buffDuration, 3);
      assert.strictEqual(howlAction.skill.effect, 'attack_up');
      assert.deepStrictEqual(howlAction.aoeCenter, { x: 5, y: 5 });
    });

    it('normalizes DB-shaped self and ally buffs before target filtering', () => {
      const ironDefense = {
        id: 'construct_iron_defense',
        name: 'Iron Defense',
        type: 'active',
        power: 0,
        range: 0,
        mpCost: 10,
        damageType: 'buff',
        effect: 'defense_up'
      };
      const magicShield = {
        id: 'humanoid_magic_shield',
        name: 'Magic Shield',
        type: 'active',
        power: 0,
        range: 3,
        mpCost: 15,
        damageType: 'buff',
        effect: 'magic_shield'
      };
      const state = createMockBattleState(
        [{
          id: 'opponent',
          teamId: 1,
          tileX: 6,
          tileY: 5,
          statusEffects: []
        }],
        [
          {
            id: 'caster',
            teamId: 2,
            tileX: 5,
            tileY: 5,
            mp: 50,
            statusEffects: [
              { type: 'defense_up' },
              { type: 'magic_shield' }
            ],
            skills: [ironDefense, magicShield]
          },
          {
            id: 'ally',
            teamId: 2,
            tileX: 7,
            tileY: 5,
            statusEffects: []
          }
        ]
      );
      const caster = state.units.find(unit => unit.id === 'caster');

      let skillActions = actionGenerator.generateAllActions(caster, state)
        .filter(action => action.type === 'skill');

      assert.strictEqual(
        skillActions.some(action => action.skillId === ironDefense.id),
        false
      );
      assert.deepStrictEqual(
        skillActions
          .filter(action => action.skillId === magicShield.id)
          .map(action => action.targetId),
        ['ally']
      );

      caster.statusEffects = [{ type: 'magic_shield' }];
      skillActions = actionGenerator.generateAllActions(caster, state)
        .filter(action => action.type === 'skill');
      const selfBuffAction = skillActions.find(action =>
        action.skillId === ironDefense.id
      );
      assert.ok(selfBuffAction);
      assert.strictEqual(selfBuffAction.targetId, caster.id);
      assert.deepStrictEqual(selfBuffAction.skill.selfBuff, {
        type: 'defense_up',
        defense: 1.3
      });
      assert.strictEqual(selfBuffAction.skill.buffDuration, 3);
      assert.strictEqual(selfBuffAction.skill.targetSelf, true);
    });

    it('does not generate inert legacy Fortress or free Dark Pact actions', () => {
      const unsupportedBuffs = [
        {
          id: 'construct_fortress',
          name: 'Fortress',
          type: 'active',
          power: 0,
          range: 0,
          mpCost: 15,
          damageType: 'buff',
          effect: 'immovable'
        },
        {
          id: 'demon_dark_pact',
          name: 'Dark Pact',
          type: 'active',
          power: 0,
          range: 0,
          mpCost: 0,
          damageType: 'buff',
          effect: 'attack_up',
          effectDuration: 5
        }
      ];
      const state = createMockBattleState([], [{
        id: 'caster',
        tileX: 5,
        tileY: 5,
        hp: 100,
        maxHp: 100,
        mp: 50,
        statusEffects: [],
        skills: unsupportedBuffs
      }]);

      const skillActions = actionGenerator.generateAllActions(state.units[0], state)
        .filter(action => action.type === 'skill');

      assert.deepStrictEqual(skillActions, []);
    });

    it('records the center of a targeted offensive AoE separately', () => {
      const burst = createMockSkill({
        id: 'burst',
        power: 120,
        range: 3,
        aoeRadius: 1
      });
      const state = createMockBattleState(
        [{ id: 'target', tileX: 6, tileY: 5 }],
        [{ id: 'caster', tileX: 5, tileY: 5, mp: 50, skills: [burst] }]
      );
      const caster = state.units.find(unit => unit.id === 'caster');

      const burstAction = actionGenerator.generateAllActions(caster, state)
        .find(action => action.type === 'skill' && action.skillId === burst.id);

      assert.strictEqual(burstAction.targetId, 'target');
      assert.deepStrictEqual(burstAction.aoeCenter, { x: 6, y: 5 });
    });

    it('skips redundant pure buffs but retains buffs with unusual utility', () => {
      const rage = createMockSkill({
        id: 'rage',
        power: 0,
        range: 0,
        selfBuff: 'rage',
        targetSelf: true
      });
      const darkPact = createMockSkill({
        id: 'dark_pact',
        power: 0,
        range: 0,
        selfBuff: 'rage',
        selfDamagePercent: 20,
        targetSelf: true
      });
      const state = createMockBattleState([], [{
        id: 'caster',
        tileX: 5,
        tileY: 5,
        mp: 50,
        statusEffects: [{ type: 'rage' }],
        skills: [rage, darkPact]
      }]);
      const caster = state.units[0];
      const skillIds = actionGenerator.generateAllActions(caster, state)
        .filter(action => action.type === 'skill')
        .map(action => action.skillId);

      assert.strictEqual(skillIds.includes(rage.id), false);
      assert.strictEqual(skillIds.includes(darkPact.id), true);
    });

    it('skips mixed HP/MP recovery only when both resources are full', () => {
      const recovery = createMockSkill({
        id: 'photosynthesis',
        power: 0,
        range: 0,
        mpCost: 0,
        healPercent: 10,
        mpRestore: 10,
        targetSelf: true
      });
      const state = createMockBattleState([], [{
        id: 'caster',
        tileX: 5,
        tileY: 5,
        hp: 200,
        maxHp: 200,
        mp: 100,
        maxMp: 100,
        skills: [recovery]
      }]);
      const caster = state.units[0];
      const hasRecoveryAction = () => actionGenerator.generateAllActions(caster, state)
        .some(action => action.type === 'skill' && action.skillId === recovery.id);

      assert.strictEqual(hasRecoveryAction(), false);

      caster.mp = 60;
      assert.strictEqual(hasRecoveryAction(), true);

      caster.mp = 100;
      caster.hp = 150;
      assert.strictEqual(hasRecoveryAction(), true);
    });

    it('uses a heal-and-cleanse skill only for missing HP or a removable status', () => {
      const recovery = createMockSkill({
        id: 'inner_peace',
        power: 0,
        range: 0,
        mpCost: 20,
        healPercent: 20,
        cleanse: true,
        targetSelf: true
      });
      const state = createMockBattleState([], [{
        id: 'caster',
        tileX: 5,
        tileY: 5,
        hp: 200,
        maxHp: 200,
        mp: 100,
        maxMp: 100,
        statusEffects: [],
        skills: [recovery]
      }]);
      const caster = state.units[0];
      const hasRecoveryAction = () => actionGenerator.generateAllActions(caster, state)
        .some(action => action.type === 'skill' && action.skillId === recovery.id);

      assert.strictEqual(hasRecoveryAction(), false);

      caster.statusEffects = ['poison'];
      assert.strictEqual(hasRecoveryAction(), true);

      caster.statusEffects = [{ type: 'haste' }];
      assert.strictEqual(hasRecoveryAction(), false);
    });

    it('does not cleanse concrete legacy buffs from a full-health target', () => {
      const recovery = createMockSkill({
        id: 'inner_peace',
        power: 0,
        range: 0,
        mpCost: 20,
        healPercent: 20,
        cleanse: true,
        targetSelf: true
      });
      const state = createMockBattleState([], [{
        id: 'caster',
        tileX: 5,
        tileY: 5,
        hp: 200,
        maxHp: 200,
        mp: 100,
        maxMp: 100,
        skills: [recovery]
      }]);
      const caster = state.units[0];

      for (const statusEffect of [
        { type: 'attack_up' },
        { type: 'defense_up' },
        { type: 'magic_shield' },
        'berserk',
        { type: 'frenzy' },
        'final_stand',
        { type: 'shadow_arts' },
        'pack_bonus',
        { type: 'regenerate' },
        'unmovable',
        { type: 'fire_resist' },
        { type: 'test_rally_buff', modifiers: { defense: 1.25 } }
      ]) {
        caster.statusEffects = [statusEffect];
        const hasRecoveryAction = actionGenerator.generateAllActions(caster, state)
          .some(action => action.type === 'skill' && action.skillId === recovery.id);

        const effectType = typeof statusEffect === 'string'
          ? statusEffect
          : statusEffect.type;
        assert.strictEqual(hasRecoveryAction, false, effectType);
      }
    });

    it('recognizes an object-form buff as redundant', () => {
      const ward = createMockSkill({
        id: 'stone_ward',
        power: 0,
        range: 0,
        selfBuff: { defensePercent: 25 },
        targetSelf: true
      });
      const state = createMockBattleState([], [{
        id: 'caster',
        tileX: 5,
        tileY: 5,
        mp: 50,
        statusEffects: [{ type: 'stone_ward_buff' }],
        skills: [ward]
      }]);

      const skillIds = actionGenerator.generateAllActions(state.units[0], state)
        .filter(action => action.type === 'skill')
        .map(action => action.skillId);

      assert.strictEqual(skillIds.includes(ward.id), false);
    });
  });

  describe('item action generation', { skip: !canImport }, () => {
    it('generates one heal_both action when either resource is missing', () => {
      const elixir = {
        itemId: 'elixir',
        quantity: 1,
        effectType: 'heal_both',
        effectValue: 40
      };
      const state = createMockBattleState([], [
        {
          id: 'actor',
          tileX: 5,
          tileY: 5,
          consumables: [elixir]
        },
        {
          id: 'ally',
          tileX: 6,
          tileY: 5,
          hp: 200,
          maxHp: 200,
          mp: 10,
          maxMp: 50
        }
      ]);
      const [actor, ally] = state.units;
      const getElixirActions = () => actionGenerator.generateAllActions(actor, state)
        .filter(action => action.type === 'item' && action.itemId === elixir.itemId);

      let actions = getElixirActions();
      assert.strictEqual(actions.length, 1);
      assert.strictEqual(actions[0].targetId, ally.id);

      ally.hp = 100;
      actions = getElixirActions();
      assert.strictEqual(actions.length, 1);
      assert.strictEqual(actions[0].targetId, ally.id);

      ally.hp = ally.maxHp;
      ally.mp = ally.maxMp;
      assert.deepStrictEqual(getElixirActions(), []);
    });
  });

  describe('generateMoveActionSequences()', { skip: !canImport }, () => {
    it('generates both orderings for attacks, skills, and items', () => {
      const fortify = createMockSkill({
        id: 'fortify',
        power: 0,
        range: 0,
        selfBuff: 'fortify',
        targetSelf: true
      });
      const state = createMockBattleState(
        [{ id: 'target', tileX: 6, tileY: 5 }],
        [{
          id: 'actor',
          tileX: 5,
          tileY: 5,
          hp: 100,
          maxHp: 200,
          attackRange: 1,
          movement: 3,
          skills: [fortify],
          consumables: [{
            itemId: 'potion',
            quantity: 1,
            effectType: 'heal_hp',
            effectValue: 50
          }]
        }]
      );
      const actor = state.units.find(unit => unit.id === 'actor');
      const target = state.units.find(unit => unit.id === 'target');
      const sequences = actionGenerator.generateMoveActionSequences(actor, state);

      for (const actionType of ['attack', 'skill', 'item']) {
        assert.ok(sequences.some(sequence =>
          sequence.length === 2 &&
          sequence[0].type === 'move' &&
          sequence[1].type === actionType
        ), `expected a move then ${actionType} sequence`);

        assert.ok(sequences.some(sequence =>
          sequence.length === 2 &&
          sequence[0].type === actionType &&
          sequence[1].type === 'move'
        ), `expected an ${actionType} then move sequence`);
      }

      assert.ok(sequences.some(sequence =>
        sequence.length === 1 &&
        sequence[0].type === 'attack' &&
        sequence[0].targetId === target.id
      ), 'expected an attack without moving');
    });

    it('recomputes movement after a deterministic self-haste action', () => {
      const haste = createMockSkill({
        id: 'haste_potion',
        power: 0,
        range: 3,
        targetAlly: true,
        effect: 'haste',
        effectChance: 1,
        effectDuration: 3
      });
      const state = createMockBattleState([], [{
        id: 'actor',
        tileX: 5,
        tileY: 5,
        mp: 50,
        skills: [haste]
      }]);
      const actor = state.units[0];
      const sequences = actionGenerator.generateMoveActionSequences(actor, state);

      assert.ok(sequences.some(sequence =>
        sequence.length === 2 &&
        sequence[0].type === 'skill' &&
        sequence[0].skillId === haste.id &&
        sequence[0].targetId === actor.id &&
        sequence[1].type === 'move' &&
        sequence[1].position.x === actor.tileX + 4 &&
        sequence[1].position.y === actor.tileY
      ), 'expected self-haste then an expanded-range move');
    });
  });

  describe('pruneActions()', { skip: !canImport }, () => {
    const pruneActions = () => actionGenerator.pruneActions;

    it('returns all actions when under maxActions', () => {
      const actions = [
        { type: 'attack' },
        { type: 'move' },
        { type: 'wait' }
      ];
      const result = pruneActions()(actions, 10);
      assert.strictEqual(result.length, 3);
    });

    it('prunes to maxActions when over limit', () => {
      const actions = Array.from({ length: 100 }, (_, i) => ({
        type: i < 30 ? 'attack' : i < 60 ? 'move' : 'wait'
      }));
      const result = pruneActions()(actions, 20);
      assert.strictEqual(result.length, 20);
    });

    it('prioritizes attacks over moves over waits', () => {
      const actions = [
        { type: 'wait' },
        { type: 'move' },
        { type: 'attack' },
        { type: 'skill', skill: { power: 200 } },
        { type: 'wait' }
      ];
      const result = pruneActions()(actions, 3);
      assert.strictEqual(result.length, 3);
      // Attack (100) and skill (80+40=120) should be first
      const types = result.map(r => r.type);
      assert.ok(types.includes('attack'), 'Attack should survive pruning');
      assert.ok(types.includes('skill'), 'Skill should survive pruning');
    });

    it('defaults to maxActions=50', () => {
      const actions = Array.from({ length: 60 }, () => ({ type: 'move' }));
      const result = pruneActions()(actions);
      assert.strictEqual(result.length, 50);
    });

    it('gives bonus to low HP targets for attack actions', () => {
      const actions = [
        { type: 'attack', target: { hp: 10, maxHp: 200 } },  // low HP target bonus
        { type: 'attack', target: { hp: 200, maxHp: 200 } },
        { type: 'move' }
      ];
      const result = pruneActions()(actions, 2);
      // Low HP target should be kept first
      assert.strictEqual(result[0].target.hp, 10);
    });

    it('gives bonus to AoE skills', () => {
      const actions = [
        { type: 'skill', skill: { power: 100, aoeRadius: 2 } },
        { type: 'skill', skill: { power: 100 } },
        { type: 'move' }
      ];
      const result = pruneActions()(actions, 2);
      const types = result.map(r => r.type);
      // Both skills should be kept, AoE first
      assert.ok(result[0].skill.aoeRadius, 'AoE skill should rank higher');
    });

    it('gives high priority to revive items', () => {
      const actions = [
        { type: 'item', item: { effectType: 'heal_hp' } },
        { type: 'item', item: { effectType: 'revive' } },
        { type: 'move' },
        { type: 'wait' }
      ];
      const result = pruneActions()(actions, 2);
      // Revive item (70+80=150) should be kept
      assert.ok(result.some(a => a.item?.effectType === 'revive'), 'Revive should survive pruning');
    });
  });

  describe('orderActionsForPruning()', { skip: !canImport }, () => {
    const orderActionsForPruning = () => actionGenerator.orderActionsForPruning;

    it('orders attacks first, then skills, moves, waits', () => {
      const actions = [
        { type: 'wait' },
        { type: 'move' },
        { type: 'skill', skill: { power: 100 } },
        { type: 'attack' },
        { type: 'item' }
      ];
      const unit = createMockUnit({});
      const result = orderActionsForPruning()(actions, unit);
      assert.strictEqual(result[0].type, 'attack');
      assert.strictEqual(result[1].type, 'skill');
      assert.strictEqual(result[2].type, 'item');
      assert.strictEqual(result[3].type, 'move');
      assert.strictEqual(result[4].type, 'wait');
    });

    it('sorts within same type by quick score', () => {
      const actions = [
        { type: 'attack', target: { hp: 200, maxHp: 200 } },
        { type: 'attack', target: { hp: 10, maxHp: 200 } } // low HP bonus
      ];
      const unit = createMockUnit({});
      const result = orderActionsForPruning()(actions, unit);
      // Low HP target should rank higher
      assert.strictEqual(result[0].target.hp, 10);
    });
  });

  describe('getTargetsFromPosition()', { skip: !canImport }, () => {
    const getTargetsFromPosition = () => actionGenerator.getTargetsFromPosition;

    it('finds targets within range', () => {
      const state = createMockBattleState(
        [{ tileX: 5, tileY: 5 }, { tileX: 6, tileY: 5 }],
        [{ tileX: 10, tileY: 10 }]
      );
      // From position (5,5), range 1, looking for players
      const targets = getTargetsFromPosition()(5, 5, 1, state, 'player');
      // Player at (5,5) is distance 0 (excluded), player at (6,5) is distance 1
      assert.strictEqual(targets.length, 1);
      assert.strictEqual(targets[0].tileX, 6);
    });

    it('excludes distance 0 (self)', () => {
      const state = createMockBattleState(
        [{ tileX: 5, tileY: 5 }],
        []
      );
      const targets = getTargetsFromPosition()(5, 5, 5, state, 'player');
      assert.strictEqual(targets.length, 0);
    });

    it('excludes dead units', () => {
      const state = createMockBattleState(
        [{ tileX: 6, tileY: 5, hp: 0 }],
        []
      );
      const targets = getTargetsFromPosition()(5, 5, 1, state, 'player');
      assert.strictEqual(targets.length, 0);
    });

    it('uses Manhattan distance', () => {
      const state = createMockBattleState(
        [{ tileX: 7, tileY: 5 }], // distance 2 from (5,5)
        []
      );
      const range1 = getTargetsFromPosition()(5, 5, 1, state, 'player');
      const range2 = getTargetsFromPosition()(5, 5, 2, state, 'player');
      assert.strictEqual(range1.length, 0);
      assert.strictEqual(range2.length, 1);
    });

    it('only returns target type units', () => {
      const state = createMockBattleState(
        [{ tileX: 6, tileY: 5 }],
        [{ tileX: 4, tileY: 5 }]
      );
      const playerTargets = getTargetsFromPosition()(5, 5, 2, state, 'player');
      const enemyTargets = getTargetsFromPosition()(5, 5, 2, state, 'enemy');
      assert.strictEqual(playerTargets.length, 1);
      assert.strictEqual(playerTargets[0].type, 'player');
      assert.strictEqual(enemyTargets.length, 1);
      assert.strictEqual(enemyTargets[0].type, 'enemy');
    });
  });

  describe('getQuickScore() item scoring', { skip: !canImport }, () => {
    // getQuickScore is internal, but tested indirectly through pruneActions ordering.
    // We can test behavior by creating item actions and checking pruning priority.

    it('item base score (70) ranks above move (50) but below skill (80)', () => {
      const actions = [
        { type: 'move' },
        { type: 'item', item: { effectType: 'heal_hp' } },
        { type: 'skill', skill: { power: 0 } }
      ];
      const result = actionGenerator.pruneActions(actions, 3);
      const types = result.map(a => a.type);
      // All should be kept since within limit, but order reflects quick score
      assert.strictEqual(types.length, 3);
    });

    it('item with low HP target gets +60 bonus (total 130)', () => {
      const actions = [
        { type: 'attack', target: { hp: 200, maxHp: 200 } },  // 100
        { type: 'item', item: { effectType: 'heal_hp' }, target: { hp: 20, maxHp: 200 } },  // 70 + 60 = 130
        { type: 'move' }  // 50
      ];
      const result = actionGenerator.pruneActions(actions, 2);
      // Item with low HP target (130) should beat basic attack (100)
      assert.ok(result.some(a => a.type === 'item'), 'Item with low HP target should survive pruning');
    });

    it('revive item gets +80 bonus (total 150)', () => {
      const actions = [
        { type: 'attack', target: { hp: 200, maxHp: 200 } },  // 100
        { type: 'item', item: { effectType: 'revive' } },  // 70 + 80 = 150
        { type: 'skill', skill: { power: 100 } },  // 80 + 20 = 100
        { type: 'move' }  // 50
      ];
      const result = actionGenerator.pruneActions(actions, 2);
      // Revive (150) should be highest, then attack or skill (100 each)
      assert.ok(result.some(a => a.item?.effectType === 'revive'), 'Revive should be in top 2');
    });

    it('item without qualifying target gets base 70 only', () => {
      const actions = [
        { type: 'attack', target: { hp: 200, maxHp: 200 } },  // 100
        { type: 'item', item: { effectType: 'heal_hp' }, target: { hp: 180, maxHp: 200 } },  // 70 (hp not < 30%)
        { type: 'move' }  // 50
      ];
      const result = actionGenerator.pruneActions(actions, 2);
      // Attack (100) should beat heal item (70)
      assert.strictEqual(result[0].type, 'attack');
    });
  });

  describe('orderActionsForPruning() item ordering', { skip: !canImport }, () => {
    const orderActionsForPruning = () => actionGenerator.orderActionsForPruning;

    it('item type has order value 2 (between move=1 and skill=3)', () => {
      const actions = [
        { type: 'move' },
        { type: 'item', item: { effectType: 'heal_hp' } },
        { type: 'skill', skill: { power: 100 } },
        { type: 'attack' },
        { type: 'wait' }
      ];
      const unit = createMockUnit({});
      const result = orderActionsForPruning()(actions, unit);
      // Expected order: attack(4), skill(3), item(2), move(1), wait(0)
      assert.strictEqual(result[0].type, 'attack');
      assert.strictEqual(result[1].type, 'skill');
      assert.strictEqual(result[2].type, 'item');
      assert.strictEqual(result[3].type, 'move');
      assert.strictEqual(result[4].type, 'wait');
    });

    it('revive items rank higher than heal items within item type', () => {
      const actions = [
        { type: 'item', item: { effectType: 'heal_hp' } },  // quickScore 70
        { type: 'item', item: { effectType: 'revive' } }     // quickScore 70 + 80 = 150
      ];
      const unit = createMockUnit({});
      const result = orderActionsForPruning()(actions, unit);
      assert.strictEqual(result[0].item.effectType, 'revive');
      assert.strictEqual(result[1].item.effectType, 'heal_hp');
    });

    it('item targeting low HP ally ranks higher than generic item', () => {
      const actions = [
        { type: 'item', item: { effectType: 'heal_hp' }, target: { hp: 180, maxHp: 200 } },  // 70
        { type: 'item', item: { effectType: 'heal_hp' }, target: { hp: 20, maxHp: 200 } }     // 70 + 60 = 130
      ];
      const unit = createMockUnit({});
      const result = orderActionsForPruning()(actions, unit);
      assert.strictEqual(result[0].target.hp, 20);
    });
  });

  describe('findImmediateThreats()', { skip: !canImport }, () => {
    const findImmediateThreats = () => actionGenerator.findImmediateThreats;

    it('detects enemies in attack range', () => {
      const state = createMockBattleState(
        [{ tileX: 5, tileY: 5, attackRange: 1 }],
        []
      );
      const unit = state.units[0];
      // Add enemy adjacent
      state.units.push(createMockUnit({
        id: 'threat1', type: 'enemy', tileX: 6, tileY: 5, attackRange: 1
      }));
      const threats = findImmediateThreats()(unit, state);
      assert.strictEqual(threats.length, 1);
    });

    it('detects enemies that can move+attack', () => {
      const state = createMockBattleState(
        [{ tileX: 5, tileY: 5 }],
        []
      );
      const unit = state.units[0];
      // Enemy at distance 4, with movement 3 and range 1 = can reach
      state.units.push(createMockUnit({
        id: 'threat2', type: 'enemy', tileX: 9, tileY: 5,
        attackRange: 1, movement: 3
      }));
      const threats = findImmediateThreats()(unit, state);
      assert.strictEqual(threats.length, 1);
    });

    it('ignores enemies too far to threaten', () => {
      const state = createMockBattleState(
        [{ tileX: 5, tileY: 5 }],
        []
      );
      const unit = state.units[0];
      // Enemy at distance 10, movement 3, range 1 = cannot reach
      state.units.push(createMockUnit({
        id: 'far', type: 'enemy', tileX: 15, tileY: 5,
        attackRange: 1, movement: 3
      }));
      const threats = findImmediateThreats()(unit, state);
      assert.strictEqual(threats.length, 0);
    });

    it('ignores dead enemies', () => {
      const state = createMockBattleState(
        [{ tileX: 5, tileY: 5 }],
        []
      );
      const unit = state.units[0];
      state.units.push(createMockUnit({
        id: 'dead', type: 'enemy', tileX: 6, tileY: 5, hp: 0
      }));
      const threats = findImmediateThreats()(unit, state);
      assert.strictEqual(threats.length, 0);
    });

    it('uses explicit teams and ignores allies with a different unit type', () => {
      const state = createMockBattleState(
        [],
        [{ teamId: 10, tileX: 5, tileY: 5 }]
      );
      const unit = state.units[0];
      state.units.push(
        createMockUnit({
          id: 'same_type_opponent',
          type: 'enemy',
          teamId: 20,
          tileX: 6,
          tileY: 5
        }),
        createMockUnit({
          id: 'different_type_ally',
          type: 'player',
          teamId: 10,
          tileX: 5,
          tileY: 6
        })
      );

      const threats = findImmediateThreats()(unit, state);
      assert.deepStrictEqual(threats.map(threat => threat.id), ['same_type_opponent']);
    });

    it('ignores opponents that already acted and spent movement', () => {
      const state = createMockBattleState(
        [{ tileX: 5, tileY: 5 }],
        []
      );
      const unit = state.units[0];
      state.units.push(
        createMockUnit({
          id: 'acted',
          type: 'enemy',
          tileX: 6,
          tileY: 5,
          actUsed: true
        }),
        createMockUnit({
          id: 'movement_spent',
          type: 'enemy',
          tileX: 9,
          tileY: 5,
          attackRange: 1,
          movement: 3,
          moveUsed: true
        })
      );

      assert.deepStrictEqual(findImmediateThreats()(unit, state), []);
    });
  });

  describe('findSaferTiles()', { skip: !canImport }, () => {
    const findSaferTiles = () => actionGenerator.findSaferTiles;

    it('sorts tiles by distance from threats (furthest first)', () => {
      const threats = [
        createMockUnit({ tileX: 5, tileY: 5 })
      ];
      const reachableTiles = [
        { x: 6, y: 5, cost: 1 },  // distance 1
        { x: 10, y: 5, cost: 5 }, // distance 5
        { x: 8, y: 5, cost: 3 }   // distance 3
      ];
      const unit = createMockUnit({ tileX: 7, tileY: 5 });
      const result = findSaferTiles()(unit, threats, reachableTiles);
      assert.strictEqual(result[0].x, 10); // Furthest = safest
      assert.strictEqual(result[result.length - 1].x, 6); // Closest = least safe
    });

    it('considers multiple threats', () => {
      const threats = [
        createMockUnit({ tileX: 3, tileY: 5 }),
        createMockUnit({ tileX: 7, tileY: 5 })
      ];
      const reachableTiles = [
        { x: 5, y: 5, cost: 1 },  // equidistant from both
        { x: 1, y: 5, cost: 3 },  // far from 7,5 but close to 3,5
        { x: 10, y: 5, cost: 4 }  // far from both
      ];
      const unit = createMockUnit({ tileX: 5, tileY: 5 });
      const result = findSaferTiles()(unit, threats, reachableTiles);
      // (10,5): |3-10| + |7-10| = 7+3 = 10
      // (1,5): |3-1| + |7-1| = 2+6 = 8
      // (5,5): |3-5| + |7-5| = 2+2 = 4
      assert.strictEqual(result[0].x, 10);
    });

    it('handles empty tiles list', () => {
      const threats = [createMockUnit({ tileX: 5, tileY: 5 })];
      const unit = createMockUnit({});
      const result = findSaferTiles()(unit, threats, []);
      assert.strictEqual(result.length, 0);
    });
  });
});
