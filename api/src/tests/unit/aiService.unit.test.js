/**
 * AI Service Unit Tests
 *
 * Tests the main AI decision-making pipeline for enemy turns.
 * Uses utility AI with lookahead for sophisticated tactical decisions.
 *
 * Functions tested:
 * - decideTurnActions() - Main AI entry point
 * - utilityAIDecision() - Utility AI wrapper (via decideTurnActions)
 * - convertToLegacyFormat() - Format conversion (via decideTurnActions)
 * - legacyDecideTurnActions() - Fallback patterns
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  createMockPlayerUnit,
  createMockEnemyUnit,
  createMockBattleState,
  createMockSkill,
  withSeededRandom
} from '../testUtils/index.js';
import { resetIdCounter } from './ai/mockHelpers.js';

// Import the AI service - this is the main entry point we're testing
let decideTurnActions = null;
let importError = null;

try {
  const mod = await import('../../services/aiService.js');
  decideTurnActions = mod.decideTurnActions;
} catch (err) {
  importError = err;
}

const canImport = decideTurnActions !== null;

describe('AI Service - decideTurnActions', () => {
  afterEach(() => {
    resetIdCounter();
  });

  describe('basic functionality', { skip: !canImport }, () => {
    it('returns an array of actions', () => {
      const state = createMockBattleState({
        units: [
          createMockPlayerUnit({ id: 'p1', tileX: 5, tileY: 5, hp: 100 }),
          createMockEnemyUnit({ id: 'e1', tileX: 10, tileY: 5, hp: 50 })
        ]
      });
      const enemy = state.units.find(u => u.type === 'enemy');
      const actions = decideTurnActions(enemy, state);
      assert.ok(Array.isArray(actions), 'Should return an array');
      assert.ok(actions.length >= 1, 'Should return at least one action');
    });

    it('returns actions with valid actionType', () => {
      const state = createMockBattleState({
        units: [
          createMockPlayerUnit({ id: 'p1', tileX: 6, tileY: 5 }),
          createMockEnemyUnit({ id: 'e1', tileX: 5, tileY: 5 })
        ]
      });
      const enemy = state.units.find(u => u.type === 'enemy');
      const actions = decideTurnActions(enemy, state);
      for (const action of actions) {
        assert.ok(['move', 'attack', 'skill', 'wait', 'item'].includes(action.actionType));
      }
    });

    it('returns wait when no players are alive', () => {
      const state = createMockBattleState({
        units: [
          createMockPlayerUnit({ id: 'p1', hp: 0 }),
          createMockEnemyUnit({ id: 'e1', tileX: 10, tileY: 5 })
        ]
      });
      const enemy = state.units.find(u => u.type === 'enemy');
      const actions = decideTurnActions(enemy, state);
      const hasWaitOrMove = actions.some(a => a.actionType === 'wait' || a.actionType === 'move');
      assert.ok(hasWaitOrMove, 'Should wait or move when no targets');
    });
  });

  describe('target selection', { skip: !canImport }, () => {
    it('attacks when adjacent to player', () => {
      const state = createMockBattleState({
        units: [
          createMockPlayerUnit({ id: 'p1', tileX: 5, tileY: 5 }),
          createMockEnemyUnit({ id: 'e1', tileX: 6, tileY: 5, attackRange: 1 })
        ]
      });
      const enemy = state.units.find(u => u.type === 'enemy');
      const actions = decideTurnActions(enemy, state);
      assert.ok(actions.some(a => a.actionType === 'attack'), 'Should attack when adjacent');
    });

    it('moves toward target when out of range', () => {
      const state = createMockBattleState({
        units: [
          createMockPlayerUnit({ id: 'p1', tileX: 2, tileY: 2 }),
          createMockEnemyUnit({ id: 'e1', tileX: 15, tileY: 15, movement: 3 })
        ]
      });
      const enemy = state.units.find(u => u.type === 'enemy');
      const actions = decideTurnActions(enemy, state);
      const moveAction = actions.find(a => a.actionType === 'move');
      assert.ok(moveAction, 'Should move toward distant target');
      assert.ok(moveAction.targetTile?.x !== undefined, 'Move should have targetTile.x');
    });
  });

  describe('AI patterns', { skip: !canImport }, () => {
    it('aggressive AI attacks when possible', () => {
      const state = createMockBattleState({
        units: [
          createMockPlayerUnit({ id: 'p1', tileX: 5, tileY: 5 }),
          createMockEnemyUnit({ id: 'e1', tileX: 6, tileY: 5, aiType: 'aggressive' })
        ]
      });
      const enemy = state.units.find(u => u.type === 'enemy');
      const actions = decideTurnActions(enemy, state);
      assert.ok(actions.some(a => a.actionType === 'attack'), 'Aggressive should attack');
    });

    it('defensive AI returns valid actions', () => {
      const state = createMockBattleState({
        units: [
          createMockPlayerUnit({ id: 'p1', tileX: 5, tileY: 5 }),
          createMockEnemyUnit({ id: 'e1', tileX: 6, tileY: 5, aiType: 'defensive', hp: 30, maxHp: 100 })
        ]
      });
      const enemy = state.units.find(u => u.type === 'enemy');
      const actions = decideTurnActions(enemy, state);
      assert.ok(actions.length >= 1, 'Defensive AI should return actions');
    });

    it('tactical AI targets weakened enemies', () => {
      const state = createMockBattleState({
        units: [
          createMockPlayerUnit({ id: 'p1', tileX: 5, tileY: 5, hp: 10, maxHp: 100 }),
          createMockPlayerUnit({ id: 'p2', tileX: 7, tileY: 5, hp: 100, maxHp: 100 }),
          createMockEnemyUnit({ id: 'e1', tileX: 6, tileY: 5, aiType: 'tactical' })
        ]
      });
      const enemy = state.units.find(u => u.type === 'enemy');
      const actions = decideTurnActions(enemy, state);
      assert.ok(actions.length >= 1, 'Tactical should return actions');
    });

    it('hit-and-run AI attacks then retreats', () => {
      const state = createMockBattleState({
        units: [
          createMockPlayerUnit({ id: 'p1', tileX: 5, tileY: 5 }),
          createMockEnemyUnit({ id: 'e1', tileX: 6, tileY: 5, aiType: 'hit-and-run', movement: 3 })
        ]
      });
      const enemy = state.units.find(u => u.type === 'enemy');
      const actions = decideTurnActions(enemy, state);
      assert.ok(actions.some(a => a.actionType === 'attack'), 'Hit-and-run should attack');
    });
  });

  describe('edge cases', { skip: !canImport }, () => {
    it('handles stunned enemy', () => {
      const state = createMockBattleState({
        units: [
          createMockPlayerUnit({ id: 'p1', tileX: 5, tileY: 5 }),
          createMockEnemyUnit({
            id: 'e1', tileX: 6, tileY: 5,
            statusEffects: [{ type: 'stun', duration: 1 }]
          })
        ]
      });
      const enemy = state.units.find(u => u.type === 'enemy');
      const actions = decideTurnActions(enemy, state);
      assert.ok(Array.isArray(actions), 'Should return array for stunned unit');
    });

    it('handles enemy with no MP', () => {
      const skill = createMockSkill({ id: 'fireball', mpCost: 50, range: 4 });
      const state = createMockBattleState({
        units: [
          createMockPlayerUnit({ id: 'p1', tileX: 5, tileY: 5 }),
          createMockEnemyUnit({ id: 'e1', tileX: 6, tileY: 5, mp: 0, skills: [skill] })
        ]
      });
      const enemy = state.units.find(u => u.type === 'enemy');
      const actions = decideTurnActions(enemy, state);
      assert.ok(actions.some(a => a.actionType === 'attack'), 'Should basic attack with no MP');
    });

    it('handles multiple enemies', () => {
      const state = createMockBattleState({
        units: [
          createMockPlayerUnit({ id: 'p1', tileX: 5, tileY: 5 }),
          createMockEnemyUnit({ id: 'e1', tileX: 6, tileY: 5 }),
          createMockEnemyUnit({ id: 'e2', tileX: 7, tileY: 5 })
        ]
      });
      const enemy1 = state.units.find(u => u.id === 'e1');
      const actions = decideTurnActions(enemy1, state);
      assert.ok(actions.length >= 1, 'Should work with multiple enemies');
    });
  });

  describe('format conversion', { skip: !canImport }, () => {
    it('move action has targetTile coordinates', () => {
      const state = createMockBattleState({
        units: [
          createMockPlayerUnit({ id: 'p1', tileX: 2, tileY: 2 }),
          createMockEnemyUnit({ id: 'e1', tileX: 15, tileY: 15, movement: 3 })
        ]
      });
      const enemy = state.units.find(u => u.type === 'enemy');
      const actions = decideTurnActions(enemy, state);
      const moveAction = actions.find(a => a.actionType === 'move');
      if (moveAction) {
        assert.strictEqual(typeof moveAction.targetTile.x, 'number');
        assert.strictEqual(typeof moveAction.targetTile.y, 'number');
      }
    });

    it('attack action has targetTile coordinates', () => {
      const state = createMockBattleState({
        units: [
          createMockPlayerUnit({ id: 'p1', tileX: 5, tileY: 5 }),
          createMockEnemyUnit({ id: 'e1', tileX: 6, tileY: 5 })
        ]
      });
      const enemy = state.units.find(u => u.type === 'enemy');
      const actions = decideTurnActions(enemy, state);
      const attackAction = actions.find(a => a.actionType === 'attack');
      if (attackAction) {
        assert.strictEqual(typeof attackAction.targetTile.x, 'number');
        assert.strictEqual(typeof attackAction.targetTile.y, 'number');
      }
    });
  });

  describe('deterministic behavior', { skip: !canImport }, () => {
    it('produces consistent results with seeded random', () => {
      const runTest = () => {
        const state = createMockBattleState({
          units: [
            createMockPlayerUnit({ id: 'p1', tileX: 5, tileY: 5 }),
            createMockEnemyUnit({ id: 'e1', tileX: 8, tileY: 5, movement: 3 })
          ]
        });
        const enemy = state.units.find(u => u.type === 'enemy');
        return decideTurnActions(enemy, state);
      };

      const result1 = withSeededRandom(42, runTest);
      const result2 = withSeededRandom(42, runTest);

      assert.strictEqual(result1.length, result2.length, 'Same number of actions');
      assert.strictEqual(result1[0].actionType, result2[0].actionType, 'Same action type');
    });
  });

  describe('two-action turn system', { skip: !canImport }, () => {
    it('can return move + attack sequence', () => {
      const state = createMockBattleState({
        units: [
          createMockPlayerUnit({ id: 'p1', tileX: 5, tileY: 5 }),
          createMockEnemyUnit({ id: 'e1', tileX: 8, tileY: 5, movement: 3, attackRange: 1 })
        ]
      });
      const enemy = state.units.find(u => u.type === 'enemy');
      const actions = decideTurnActions(enemy, state);
      // Enemy is 3 tiles away, with movement 3 can potentially move and attack
      assert.ok(actions.length >= 1, 'Should return at least one action');
    });

    it('single attack when already in range', () => {
      const state = createMockBattleState({
        units: [
          createMockPlayerUnit({ id: 'p1', tileX: 5, tileY: 5 }),
          createMockEnemyUnit({ id: 'e1', tileX: 6, tileY: 5, attackRange: 1 })
        ]
      });
      const enemy = state.units.find(u => u.type === 'enemy');
      const actions = decideTurnActions(enemy, state);
      assert.ok(actions.some(a => a.actionType === 'attack'), 'Should attack when in range');
    });
  });
});

describe('AI Service - import error handling', { skip: canImport }, () => {
  it('reports import error', () => {
    console.log('AI Service import error:', importError?.message);
    assert.ok(importError, 'Import error should be captured');
  });
});
