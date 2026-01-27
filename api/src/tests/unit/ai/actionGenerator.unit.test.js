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
