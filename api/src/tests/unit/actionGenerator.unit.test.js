/**
 * Action Generator Unit Tests
 *
 * Tests for AI action enumeration and filtering functions.
 * Focus on pure helper functions that don't require database or complex state.
 */

import { describe, it, test } from 'node:test';
import assert from 'node:assert';
import {
  getTargetsFromPosition,
  isHealingSkill,
  pruneActions,
  orderActionsForPruning,
  findImmediateThreats,
  findSaferTiles
} from '../../services/ai/actionGenerator.js';

describe('Action Generator - Pure Functions', () => {
  describe('getTargetsFromPosition', () => {
    it('should find targets within range', () => {
      const state = {
        units: [
          { id: 'p1', type: 'player', tileX: 5, tileY: 5, hp: 100 },
          { id: 'p2', type: 'player', tileX: 6, tileY: 5, hp: 100 },
          { id: 'e1', type: 'enemy', tileX: 10, tileY: 10, hp: 50 }
        ]
      };

      const targets = getTargetsFromPosition(5, 5, 2, state, 'player');
      assert.strictEqual(targets.length, 1);
      assert.strictEqual(targets[0].id, 'p2');
    });

    it('should exclude dead units', () => {
      const state = {
        units: [
          { id: 'p1', type: 'player', tileX: 5, tileY: 5, hp: 0 },  // Dead
          { id: 'p2', type: 'player', tileX: 6, tileY: 5, hp: 100 }
        ]
      };

      const targets = getTargetsFromPosition(5, 5, 2, state, 'player');
      assert.strictEqual(targets.length, 1);
      assert.strictEqual(targets[0].id, 'p2');
    });

    it('should exclude units of wrong type', () => {
      const state = {
        units: [
          { id: 'p1', type: 'player', tileX: 5, tileY: 5, hp: 100 },
          { id: 'e1', type: 'enemy', tileX: 6, tileY: 5, hp: 100 }
        ]
      };

      const targets = getTargetsFromPosition(5, 5, 2, state, 'player');
      assert.strictEqual(targets.length, 0);  // p1 is at source, e1 is enemy
    });

    it('should use Manhattan distance', () => {
      const state = {
        units: [
          { id: 'p1', type: 'player', tileX: 7, tileY: 7, hp: 100 }  // 4 tiles away (2+2)
        ]
      };

      // Range 3 should not reach
      const targets3 = getTargetsFromPosition(5, 5, 3, state, 'player');
      assert.strictEqual(targets3.length, 0);

      // Range 4 should reach
      const targets4 = getTargetsFromPosition(5, 5, 4, state, 'player');
      assert.strictEqual(targets4.length, 1);
    });

    it('should exclude source position (distance 0)', () => {
      const state = {
        units: [
          { id: 'p1', type: 'player', tileX: 5, tileY: 5, hp: 100 }
        ]
      };

      const targets = getTargetsFromPosition(5, 5, 1, state, 'player');
      assert.strictEqual(targets.length, 0);
    });

    it('should find all targets within range', () => {
      const state = {
        units: [
          { id: 'p1', type: 'player', tileX: 5, tileY: 4, hp: 100 },  // 1 tile away
          { id: 'p2', type: 'player', tileX: 6, tileY: 5, hp: 100 },  // 1 tile away
          { id: 'p3', type: 'player', tileX: 5, tileY: 6, hp: 100 },  // 1 tile away
          { id: 'p4', type: 'player', tileX: 4, tileY: 5, hp: 100 },  // 1 tile away
          { id: 'p5', type: 'player', tileX: 7, tileY: 5, hp: 100 }   // 2 tiles away
        ]
      };

      const targets = getTargetsFromPosition(5, 5, 1, state, 'player');
      assert.strictEqual(targets.length, 4);
    });
  });

  describe('isHealingSkill', () => {
    it('should return true for skills with healPercent', () => {
      assert.strictEqual(isHealingSkill({ healPercent: 25 }), true);
      assert.strictEqual(isHealingSkill({ healPercent: 50 }), true);
    });

    it('should return true for heal damageType', () => {
      assert.strictEqual(isHealingSkill({ damageType: 'heal' }), true);
    });

    it('should return true for heal effect', () => {
      assert.strictEqual(isHealingSkill({ effect: 'heal' }), true);
    });

    it('should return false for non-healing skills', () => {
      assert.strictEqual(isHealingSkill({ damageType: 'physical' }), false);
      assert.strictEqual(isHealingSkill({ damageType: 'magical' }), false);
      assert.strictEqual(isHealingSkill({ effect: 'stun' }), false);
      assert.strictEqual(isHealingSkill({}), false);
    });

    it('should return false for zero healPercent', () => {
      assert.strictEqual(isHealingSkill({ healPercent: 0 }), false);
    });
  });

  describe('pruneActions', () => {
    it('should return all actions if under max', () => {
      const actions = [
        { type: 'attack' },
        { type: 'move' },
        { type: 'wait' }
      ];

      const pruned = pruneActions(actions, 10);
      assert.strictEqual(pruned.length, 3);
    });

    it('should limit actions to maxActions', () => {
      const actions = [];
      for (let i = 0; i < 100; i++) {
        actions.push({ type: 'move', position: { x: i, y: 0 } });
      }

      const pruned = pruneActions(actions, 20);
      assert.strictEqual(pruned.length, 20);
    });

    it('should prioritize attacks over moves', () => {
      const actions = [
        { type: 'move', position: { x: 1, y: 1 } },
        { type: 'move', position: { x: 2, y: 2 } },
        { type: 'attack', target: { id: 'p1' } },
        { type: 'wait' }
      ];

      const pruned = pruneActions(actions, 2);
      assert.ok(pruned.some(a => a.type === 'attack'));
    });

    it('should preserve action objects', () => {
      const actions = [
        { type: 'attack', target: { id: 'p1', hp: 50, maxHp: 100 } }
      ];

      const pruned = pruneActions(actions, 10);
      assert.deepStrictEqual(pruned[0], actions[0]);
    });
  });

  describe('orderActionsForPruning', () => {
    it('should order attacks first', () => {
      const actions = [
        { type: 'wait' },
        { type: 'move' },
        { type: 'attack' }
      ];

      const ordered = orderActionsForPruning(actions, {});
      assert.strictEqual(ordered[0].type, 'attack');
    });

    it('should order skills after attacks', () => {
      const actions = [
        { type: 'move' },
        { type: 'skill' },
        { type: 'wait' }
      ];

      const ordered = orderActionsForPruning(actions, {});
      assert.strictEqual(ordered[0].type, 'skill');
    });

    it('should order items after skills', () => {
      const actions = [
        { type: 'move' },
        { type: 'item' },
        { type: 'wait' }
      ];

      const ordered = orderActionsForPruning(actions, {});
      assert.strictEqual(ordered[0].type, 'item');
    });

    it('should put wait last', () => {
      const actions = [
        { type: 'wait' },
        { type: 'move' },
        { type: 'attack' }
      ];

      const ordered = orderActionsForPruning(actions, {});
      assert.strictEqual(ordered[ordered.length - 1].type, 'wait');
    });

    it('should preserve full action ordering', () => {
      const actions = [
        { type: 'wait' },
        { type: 'move' },
        { type: 'item' },
        { type: 'skill' },
        { type: 'attack' }
      ];

      const ordered = orderActionsForPruning(actions, {});
      const types = ordered.map(a => a.type);
      assert.deepStrictEqual(types, ['attack', 'skill', 'item', 'move', 'wait']);
    });
  });

  describe('findImmediateThreats', () => {
    it('should find enemies within attack range', () => {
      const unit = { type: 'player', tileX: 5, tileY: 5 };
      const state = {
        units: [
          { id: 'e1', type: 'enemy', tileX: 6, tileY: 5, hp: 100, attackRange: 1, movement: 3 }
        ]
      };

      const threats = findImmediateThreats(unit, state);
      assert.strictEqual(threats.length, 1);
      assert.strictEqual(threats[0].id, 'e1');
    });

    it('should find enemies that can move and attack', () => {
      const unit = { type: 'player', tileX: 5, tileY: 5 };
      const state = {
        units: [
          { id: 'e1', type: 'enemy', tileX: 9, tileY: 5, hp: 100, attackRange: 1, movement: 3 }
          // 4 tiles away, enemy can move 3 + attack 1 = reach
        ]
      };

      const threats = findImmediateThreats(unit, state);
      assert.strictEqual(threats.length, 1);
    });

    it('should not find distant enemies', () => {
      const unit = { type: 'player', tileX: 5, tileY: 5 };
      const state = {
        units: [
          { id: 'e1', type: 'enemy', tileX: 15, tileY: 15, hp: 100, attackRange: 1, movement: 3 }
          // 20 tiles away, enemy can only move 3 + attack 1 = can't reach
        ]
      };

      const threats = findImmediateThreats(unit, state);
      assert.strictEqual(threats.length, 0);
    });

    it('should exclude dead enemies', () => {
      const unit = { type: 'player', tileX: 5, tileY: 5 };
      const state = {
        units: [
          { id: 'e1', type: 'enemy', tileX: 6, tileY: 5, hp: 0, attackRange: 1, movement: 3 }
        ]
      };

      const threats = findImmediateThreats(unit, state);
      assert.strictEqual(threats.length, 0);
    });

    it('should use default movement when not specified', () => {
      const unit = { type: 'player', tileX: 5, tileY: 5 };
      const state = {
        units: [
          { id: 'e1', type: 'enemy', tileX: 9, tileY: 5, hp: 100 }  // No movement/attackRange
          // Default attackRange is 1, default movement is 3
          // 4 tiles away, default move 3 + default attack 1 = reach
        ]
      };

      const threats = findImmediateThreats(unit, state);
      assert.strictEqual(threats.length, 1);
    });

    it('should find threats for enemy units (from players)', () => {
      const unit = { type: 'enemy', tileX: 5, tileY: 5 };
      const state = {
        units: [
          { id: 'p1', type: 'player', tileX: 6, tileY: 5, hp: 100, attackRange: 1, movement: 3 }
        ]
      };

      const threats = findImmediateThreats(unit, state);
      assert.strictEqual(threats.length, 1);
      assert.strictEqual(threats[0].id, 'p1');
    });
  });

  describe('findSaferTiles', () => {
    it('should prefer tiles farther from threats', () => {
      const unit = { tileX: 5, tileY: 5 };
      const threats = [
        { tileX: 4, tileY: 5 }  // Threat to the left
      ];
      const reachableTiles = [
        { x: 6, y: 5, cost: 1 },  // Move right (away)
        { x: 4, y: 5, cost: 1 },  // Move left (toward threat)
        { x: 5, y: 6, cost: 1 }   // Move down
      ];

      const sorted = findSaferTiles(unit, threats, reachableTiles);
      // First tile should be farthest from threat (x: 6)
      assert.strictEqual(sorted[0].x, 6);
    });

    it('should handle multiple threats', () => {
      const unit = { tileX: 5, tileY: 5 };
      const threats = [
        { tileX: 3, tileY: 5 },  // Threat to the left
        { tileX: 5, tileY: 3 }   // Threat above
      ];
      const reachableTiles = [
        { x: 6, y: 6, cost: 2 },  // Move away from both
        { x: 4, y: 4, cost: 2 },  // Move toward threats
        { x: 5, y: 5, cost: 0 }   // Stay put
      ];

      const sorted = findSaferTiles(unit, threats, reachableTiles);
      // First tile should maximize total distance from all threats
      assert.strictEqual(sorted[0].x, 6);
      assert.strictEqual(sorted[0].y, 6);
    });

    it('should return all tiles (sorted)', () => {
      const unit = { tileX: 5, tileY: 5 };
      const threats = [{ tileX: 4, tileY: 5 }];
      const reachableTiles = [
        { x: 6, y: 5, cost: 1 },
        { x: 7, y: 5, cost: 2 },
        { x: 8, y: 5, cost: 3 }
      ];

      const sorted = findSaferTiles(unit, threats, reachableTiles);
      assert.strictEqual(sorted.length, 3);
      // Should be sorted by distance to threat (descending)
      assert.strictEqual(sorted[0].x, 8);  // Farthest
      assert.strictEqual(sorted[1].x, 7);
      assert.strictEqual(sorted[2].x, 6);  // Closest safe tile
    });

    it('should preserve tile cost information', () => {
      const unit = { tileX: 5, tileY: 5 };
      const threats = [{ tileX: 4, tileY: 5 }];
      const reachableTiles = [
        { x: 6, y: 5, cost: 2 }
      ];

      const sorted = findSaferTiles(unit, threats, reachableTiles);
      assert.strictEqual(sorted[0].cost, 2);
    });

    it('should add safetyScore to each tile', () => {
      const unit = { tileX: 5, tileY: 5 };
      const threats = [{ tileX: 4, tileY: 5 }];
      const reachableTiles = [
        { x: 6, y: 5, cost: 1 }
      ];

      const sorted = findSaferTiles(unit, threats, reachableTiles);
      assert.ok(typeof sorted[0].safetyScore === 'number');
    });
  });
});

describe('Action Generator - Quick Score', () => {
  // Test the quick score function indirectly through pruneActions
  describe('scoring heuristics', () => {
    it('should score attacks higher than moves', () => {
      const actions = [
        { type: 'move', position: { x: 1, y: 1 } },
        { type: 'attack', target: { id: 'p1', hp: 100, maxHp: 100 } }
      ];

      const pruned = pruneActions(actions, 1);
      assert.strictEqual(pruned[0].type, 'attack');
    });

    it('should score skills higher than moves', () => {
      const actions = [
        { type: 'move', position: { x: 1, y: 1 } },
        { type: 'skill', skill: { power: 100 } }
      ];

      const pruned = pruneActions(actions, 1);
      assert.strictEqual(pruned[0].type, 'skill');
    });

    it('should score wait lowest', () => {
      const actions = [
        { type: 'wait' },
        { type: 'move', position: { x: 1, y: 1 } }
      ];

      const pruned = pruneActions(actions, 1);
      assert.strictEqual(pruned[0].type, 'move');
    });

    it('should give bonus for low HP targets', () => {
      const actions = [
        { type: 'attack', target: { id: 'p1', hp: 10, maxHp: 100 } },  // Low HP
        { type: 'attack', target: { id: 'p2', hp: 90, maxHp: 100 } }   // High HP
      ];

      const pruned = pruneActions(actions, 1);
      // Should prefer low HP target
      assert.strictEqual(pruned[0].target.id, 'p1');
    });

    it('should give bonus for AoE skills', () => {
      const actions = [
        { type: 'skill', skill: { power: 100, aoeRadius: 0 } },
        { type: 'skill', skill: { power: 100, aoeRadius: 2 } }
      ];

      const pruned = pruneActions(actions, 1);
      // Should prefer AoE skill
      assert.strictEqual(pruned[0].skill.aoeRadius, 2);
    });

    it('should prioritize revive items', () => {
      const actions = [
        { type: 'item', item: { effectType: 'heal_hp' } },
        { type: 'item', item: { effectType: 'revive' } }
      ];

      const pruned = pruneActions(actions, 1);
      assert.strictEqual(pruned[0].item.effectType, 'revive');
    });
  });
});
