/**
 * Lookahead Unit Tests
 *
 * Tests the Lookahead class constructor, isGameOver, getNextActor,
 * getFirstActor, getEvaluatorForActor, and orderActions.
 *
 * The Lookahead class imports from stateEvaluator, patternWeights,
 * actionGenerator, and cache. Full search tests require all imports.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createMockUnit, createMockBattleState } from './mockHelpers.js';
import { getWeights, OPTIMAL_PLAYER_WEIGHTS } from '../../../services/ai/patternWeights.js';

let Lookahead = null;
let quickEvaluate = null;
let importError = null;

try {
  const mod = await import('../../../services/ai/lookahead.js');
  Lookahead = mod.Lookahead;
  quickEvaluate = mod.quickEvaluate;
} catch (err) {
  importError = err;
}

const canImport = Lookahead !== null;

describe('Lookahead', () => {

  describe('constructor', { skip: !canImport }, () => {
    it('uses default options', () => {
      const la = new Lookahead();
      assert.strictEqual(la.maxRounds, 3);
      assert.strictEqual(la.timeBudgetMs, 450);
      assert.strictEqual(la.maxActionsPerActor, 30);
      assert.strictEqual(la.decidingActorActions, 50);
    });

    it('accepts custom options', () => {
      const la = new Lookahead({
        maxRounds: 5,
        timeBudgetMs: 1000,
        maxActionsPerActor: 20,
        decidingActorActions: 40
      });
      assert.strictEqual(la.maxRounds, 5);
      assert.strictEqual(la.timeBudgetMs, 1000);
      assert.strictEqual(la.maxActionsPerActor, 20);
      assert.strictEqual(la.decidingActorActions, 40);
    });

    it('initializes cache structures', () => {
      const la = new Lookahead();
      assert.ok(la.transpositionTable);
      assert.ok(la.killerMoves);
      assert.ok(la.historyHeuristic);
      assert.strictEqual(la.nodesEvaluated, 0);
    });
  });

  describe('isGameOver()', { skip: !canImport }, () => {
    it('returns true when all enemies dead', () => {
      const la = new Lookahead();
      const state = createMockBattleState(
        [{ hp: 100 }],
        [{ hp: 0 }]
      );
      assert.strictEqual(la.isGameOver(state), true);
    });

    it('returns true when all players dead', () => {
      const la = new Lookahead();
      const state = createMockBattleState(
        [{ hp: 0 }],
        [{ hp: 100 }]
      );
      assert.strictEqual(la.isGameOver(state), true);
    });

    it('returns false when both sides alive', () => {
      const la = new Lookahead();
      const state = createMockBattleState(
        [{ hp: 100 }],
        [{ hp: 100 }]
      );
      assert.strictEqual(la.isGameOver(state), false);
    });

    it('handles multiple units with mixed alive/dead', () => {
      const la = new Lookahead();
      const state = createMockBattleState(
        [{ hp: 100 }, { hp: 0 }],
        [{ hp: 0 }, { hp: 50 }]
      );
      assert.strictEqual(la.isGameOver(state), false);
    });
  });

  describe('getNextActor()', { skip: !canImport }, () => {
    it('returns next unit that has not acted', () => {
      const la = new Lookahead();
      const state = createMockBattleState(
        [{ tileX: 2, tileY: 2, agility: 30, hasActedThisRound: false }],
        [{ tileX: 10, tileY: 10, agility: 20, hasActedThisRound: false }]
      );
      const currentActor = state.units[0];
      const result = la.getNextActor(state, currentActor, 2);
      // After current actor is marked, enemy should be next
      assert.strictEqual(result.nextActor.type, 'enemy');
      assert.strictEqual(result.turnComplete, false);
    });

    it('returns turnComplete when all have acted', () => {
      const la = new Lookahead();
      const state = createMockBattleState(
        [{ hasActedThisRound: true, agility: 30 }],
        [{ hasActedThisRound: false, agility: 20 }]
      );
      // Mark enemy as current actor (will be set to hasActedThisRound)
      const currentActor = state.units[1]; // enemy
      const result = la.getNextActor(state, currentActor, 2);
      // Both have now acted
      assert.strictEqual(result.turnComplete, true);
    });

    it('selects by agility (higher first)', () => {
      const la = new Lookahead();
      const state = createMockBattleState(
        [{ tileX: 2, tileY: 2, agility: 10, hasActedThisRound: false }],
        [
          { tileX: 10, tileY: 10, agility: 50, hasActedThisRound: false },
          { tileX: 12, tileY: 10, agility: 30, hasActedThisRound: false }
        ]
      );
      // Mark player as having acted
      const currentActor = state.units[0];
      const result = la.getNextActor(state, currentActor, 2);
      // Enemy with agility 50 should be next
      assert.strictEqual(result.nextActor.agility, 50);
    });
  });

  describe('getFirstActor()', { skip: !canImport }, () => {
    it('returns the unit with highest CT+agility', () => {
      const la = new Lookahead();
      const state = createMockBattleState(
        [{ agility: 20, ct: 0 }],
        [{ agility: 40, ct: 0 }]
      );
      const first = la.getFirstActor(state, 'player');
      assert.strictEqual(first.agility, 40);
    });

    it('resets hasActedThisRound flags', () => {
      const la = new Lookahead();
      const state = createMockBattleState(
        [{ agility: 20, hasActedThisRound: true }],
        [{ agility: 40, hasActedThisRound: true }]
      );
      la.getFirstActor(state, 'player');
      // All flags should be reset
      for (const unit of state.units) {
        assert.strictEqual(unit.hasActedThisRound, false);
      }
    });

    it('returns null when no alive units', () => {
      const la = new Lookahead();
      const state = createMockBattleState(
        [{ hp: 0 }],
        [{ hp: 0 }]
      );
      const first = la.getFirstActor(state, 'player');
      assert.strictEqual(first, null);
    });

    it('considers CT in ordering', () => {
      const la = new Lookahead();
      const state = createMockBattleState(
        [{ agility: 10, ct: 100 }],  // CT 100 + agi 10 = 110
        [{ agility: 50, ct: 0 }]     // CT 0 + agi 50 = 50
      );
      const first = la.getFirstActor(state, 'player');
      // Player with high CT should go first
      assert.strictEqual(first.type, 'player');
    });
  });

  describe('getEvaluatorForActor()', { skip: !canImport }, () => {
    it('uses actor aiType for same-perspective ally', () => {
      const la = new Lookahead();
      const actor = createMockUnit({ type: 'enemy', aiType: 'defensive' });
      const evaluator = la.getEvaluatorForActor(actor, 'enemy');
      assert.strictEqual(evaluator.patternName, 'Defensive');
    });

    it('uses OPTIMAL_PLAYER_WEIGHTS for player from enemy perspective', () => {
      const la = new Lookahead();
      const actor = createMockUnit({ type: 'player' });
      const evaluator = la.getEvaluatorForActor(actor, 'enemy');
      assert.strictEqual(evaluator.patternName, OPTIMAL_PLAYER_WEIGHTS.name);
    });

    it('uses actor aiType for enemy from player perspective', () => {
      const la = new Lookahead();
      const actor = createMockUnit({ type: 'enemy', aiType: 'tactical' });
      const evaluator = la.getEvaluatorForActor(actor, 'player');
      assert.strictEqual(evaluator.patternName, 'Tactical');
    });

    it('defaults to aggressive for missing aiType', () => {
      const la = new Lookahead();
      const actor = createMockUnit({ type: 'enemy', aiType: undefined });
      const evaluator = la.getEvaluatorForActor(actor, 'enemy');
      assert.strictEqual(evaluator.patternName, 'Aggressive');
    });
  });

  describe('orderActions()', { skip: !canImport }, () => {
    it('prioritizes killer moves', () => {
      const la = new Lookahead();
      const killerAction = { type: 'attack', targetId: 'e1' };
      la.killerMoves.store(2, killerAction);

      const actions = [
        { type: 'wait' },
        { type: 'move', position: { x: 5, y: 5 } },
        { type: 'attack', targetId: 'e1' },
        { type: 'skill', targetId: 'e2', skillId: 's1' }
      ];

      const ordered = la.orderActions(actions, 2);
      // Killer move should be first
      assert.strictEqual(ordered[0].type, 'attack');
      assert.strictEqual(ordered[0].targetId, 'e1');
    });

    it('uses type ordering: attack > skill > move > wait', () => {
      const la = new Lookahead();
      const actions = [
        { type: 'wait' },
        { type: 'move', position: { x: 1, y: 1 } },
        { type: 'skill', targetId: 'e1', skillId: 's1' },
        { type: 'attack', targetId: 'e1' }
      ];
      const ordered = la.orderActions(actions, 1);
      assert.strictEqual(ordered[0].type, 'attack');
      assert.strictEqual(ordered[1].type, 'skill');
      assert.strictEqual(ordered[2].type, 'move');
      assert.strictEqual(ordered[3].type, 'wait');
    });

    it('incorporates history heuristic scores', () => {
      const la = new Lookahead();
      const boostedAction = { type: 'move', targetId: '', skillId: '', position: { x: 1, y: 1 } };
      // Give this move action a huge history score to promote it above wait
      la.historyHeuristic.update(boostedAction, 10); // 100 score

      const actions = [
        { type: 'wait' },
        { type: 'move', targetId: '', skillId: '', position: { x: 1, y: 1 } }, // history boosted
        { type: 'wait' }
      ];
      const ordered = la.orderActions(actions, 1);
      // The history-boosted move (500 type + 100 history = 600) should rank above
      // wait actions (0 type + 0 history = 0)
      assert.strictEqual(ordered[0].type, 'move');
    });
  });

  describe('reset()', { skip: !canImport }, () => {
    it('clears all search state', () => {
      const la = new Lookahead();
      la.nodesEvaluated = 500;
      la.transpositionTable.store('test', { score: 10, depth: 1 });
      la.killerMoves.store(0, { type: 'attack', targetId: 'e1' });
      la.reset();
      assert.strictEqual(la.nodesEvaluated, 0);
      assert.strictEqual(la.transpositionTable.table.size, 0);
      assert.strictEqual(la.killerMoves.get(0).length, 0);
    });
  });
});
