/**
 * Multi-Actor Lookahead - Simulates 2-3 turns ahead considering all characters
 *
 * Implements minimax with alpha-beta pruning for turn-based tactical combat.
 * Simulates the entire battle turn order, including what ALL characters
 * (allies and enemies) will do.
 */

import { StateEvaluator } from './stateEvaluator.js';
import { getWeights, OPTIMAL_PLAYER_WEIGHTS } from './patternWeights.js';
import { generateAllActions, generateMoveActionSequences } from './actionGenerator.js';
import { getUnitTeamId } from './utilityFactors.js';
import {
  TranspositionTable,
  KillerMoves,
  HistoryHeuristic,
  cloneState,
  applyActionToState
} from './cache.js';

/**
 * Lookahead - Multi-actor minimax search
 */
class Lookahead {
  /**
   * @param {Object} options - Configuration options
   */
  constructor(options = {}) {
    this.maxRounds = options.maxRounds || 3;
    this.timeBudgetMs = options.timeBudgetMs || 450;
    this.maxActionsPerActor = options.maxActionsPerActor || 30;
    this.decidingActorActions = options.decidingActorActions || 50;

    this.transpositionTable = new TranspositionTable();
    this.killerMoves = new KillerMoves();
    this.historyHeuristic = new HistoryHeuristic();

    this.nodesEvaluated = 0;
    this.startTime = 0;
    this.searchTimedOut = false;
  }

  /**
   * Find best action using iterative deepening
   * @param {Object} state - Current battle state
   * @param {Object} decidingUnit - Unit making decision
   * @param {Object} evaluator - StateEvaluator instance
   * @returns {Object} { action, score, stats }
   */
  iterativeDeepening(state, decidingUnit, evaluator) {
    this.startTime = Date.now();
    this.nodesEvaluated = 0;
    this.searchTimedOut = false;

    const perspective = getUnitTeamId(decidingUnit);
    let bestAction = [{ type: 'wait' }];
    let bestScore = -Infinity;
    let hasCompletedDepth = false;

    // Clear transposition table for new search
    this.transpositionTable.clear();
    this.killerMoves.clear();

    // Iterate from 1 round to maxRounds
    for (let rounds = 1; rounds <= this.maxRounds; rounds++) {
      // Check time budget
      const elapsed = Date.now() - this.startTime;
      if (elapsed > this.timeBudgetMs * 0.7) {
        break;
      }

      this.searchTimedOut = false;
      const result = this.search(
        cloneState(state),
        decidingUnit,
        rounds,
        perspective,
        -Infinity,
        Infinity,
        evaluator,
        true // isDecidingActor
      );

      // Scores from different depths are not directly comparable. A completed
      // deeper search supersedes the shallower result even when it exposes a
      // worse position overall. If the deeper search times out, retain the last
      // fully searched depth (or use its partial result only as a last resort).
      if (result.action && (!this.searchTimedOut || !hasCompletedDepth)) {
        bestScore = result.score;
        bestAction = result.action;
      }
      if (this.searchTimedOut) break;
      hasCompletedDepth = true;

      // Early exit if we found a winning line
      if (bestScore > 5000) break;
    }

    return {
      action: bestAction,
      score: bestScore,
      stats: {
        nodesEvaluated: this.nodesEvaluated,
        timeMs: Date.now() - this.startTime,
        cacheStats: this.transpositionTable.getStats()
      }
    };
  }

  /**
   * Main search function - simulates full turn order
   * @param {Object} state - Battle state
   * @param {Object} currentActor - Unit whose turn it is
   * @param {number} roundsRemaining - Rounds left to simulate
   * @param {string} perspective - 'player' or 'enemy' (who we're optimizing for)
   * @param {number} alpha - Alpha value for pruning
   * @param {number} beta - Beta value for pruning
   * @param {Object} evaluator - StateEvaluator instance
   * @param {boolean} isDecidingActor - Whether this is the original deciding unit
   * @returns {Object} { score, action }
   */
  search(state, currentActor, roundsRemaining, perspective, alpha, beta, evaluator, isDecidingActor) {
    this.nodesEvaluated++;

    // Check time budget
    if (Date.now() - this.startTime > this.timeBudgetMs) {
      this.searchTimedOut = true;
      return { score: evaluator.evaluateState(state, perspective), action: null };
    }

    // Terminal conditions
    if (roundsRemaining <= 0 || this.isGameOver(state)) {
      return { score: evaluator.evaluateState(state, perspective), action: null };
    }

    // Resolve the actor from the simulated state before hashing. The actor whose
    // turn it is changes both legal actions and whether this is a maximizing node.
    const stateActor = state.units.find(unit =>
      unit.id === currentActor?.id && unit.hp > 0
    );
    if (!stateActor) {
      return { score: evaluator.evaluateState(state, perspective), action: null };
    }

    // Check transposition table. Only exact entries are safe to return as a
    // complete minimax result; alpha/beta bounds need separate bound handling.
    const ttKey = this.transpositionTable.hashState(
      state,
      roundsRemaining,
      perspective,
      stateActor.id
    );
    const ttEntry = this.transpositionTable.lookup(ttKey, roundsRemaining);
    if (ttEntry && (!ttEntry.flag || ttEntry.flag === 'exact')) {
      return { score: ttEntry.score, action: ttEntry.bestAction };
    }

    // Generate complete turn sequences for the current actor. Resolve the actor
    // from the simulated state so prior movement, damage, and MP use are honored.
    let actions = generateMoveActionSequences(stateActor, state);

    // Order complete sequences, then limit the branching factor. orderActions()
    // also accepts legacy single-action objects for public helper compatibility.
    const maxActions = isDecidingActor ? this.decidingActorActions : this.maxActionsPerActor;
    actions = this.orderActions(actions, roundsRemaining);
    actions = this.limitActions(actions, maxActions);

    const isMaximizing = getUnitTeamId(stateActor) === normalizePerspectiveTeam(perspective);
    let bestScore = isMaximizing ? -Infinity : Infinity;
    let bestAction = actions[0];
    let fullySearched = true;

    for (const action of actions) {
      // Apply every action in the sequence before advancing to the next actor.
      const newState = cloneState(state);
      this.applyActionSequence(newState, stateActor, action);

      // Determine next actor
      const { nextActor, newRoundsRemaining, turnComplete } = this.getNextActor(
        newState,
        stateActor,
        roundsRemaining
      );

      let result;
      if (!nextActor || turnComplete) {
        // Round complete or no more actors
        result = this.search(
          newState,
          this.getFirstActor(newState, perspective),
          newRoundsRemaining - 1,
          perspective,
          alpha,
          beta,
          evaluator,
          false
        );
      } else {
        // Continue to next actor in same round
        result = this.search(
          newState,
          nextActor,
          newRoundsRemaining,
          perspective,
          alpha,
          beta,
          evaluator,
          false
        );
      }

      // Update best score
      if (isMaximizing) {
        if (result.score > bestScore) {
          bestScore = result.score;
          bestAction = action;
        }
        alpha = Math.max(alpha, result.score);
      } else {
        if (result.score < bestScore) {
          bestScore = result.score;
          bestAction = action;
        }
        beta = Math.min(beta, result.score);
      }

      // Alpha-beta pruning
      if (beta <= alpha) {
        this.killerMoves.store(roundsRemaining, action);
        this.historyHeuristic.update(action, roundsRemaining);
        fullySearched = false;
        break;
      }
    }

    // A cut-off returns a bound, not an exact result. Keep the table exact-only
    // so a later node with a different alpha/beta window cannot reuse a bound as
    // though the entire branch had been searched.
    if (fullySearched) {
      this.transpositionTable.store(ttKey, {
        score: bestScore,
        depth: roundsRemaining,
        bestAction,
        flag: 'exact'
      });
    }

    return { score: bestScore, action: bestAction };
  }

  /**
   * Order actions for better pruning
   * @param {Array} actions - Actions to order
   * @param {number} depth - Current depth
   * @returns {Array} Ordered actions
   */
  orderActions(actions, depth) {
    // Get killer moves for this depth
    const killers = this.killerMoves.get(depth);

    // Score each action
    const scored = actions.map(action => {
      let orderScore = 0;
      const sequence = Array.isArray(action) ? action : [action];

      // Killer move bonus
      if (killers.some(k => this.killerMoves.actionsEqual(k, action))) {
        orderScore += 10000;
      }

      // History heuristic bonus
      orderScore += this.historyHeuristic.getScore(action);

      // Type ordering: attacks > skills > moves > wait. Summing the actions
      // favors complete turns without changing legacy single-action ordering.
      const typeBonus = { attack: 1000, skill: 800, move: 500, wait: 0 };
      for (const sequenceAction of sequence) {
        orderScore += typeBonus[sequenceAction.type] || 0;
      }

      return { action, orderScore };
    });

    scored.sort((a, b) => b.orderScore - a.orderScore);
    return scored.map(s => s.action);
  }

  /**
   * Limit branching while retaining representatives of strategically distinct
   * turns. A plain slice can fill the whole budget with move-then-attacks and
   * discard every heal, retreat, or attack-then-move option before evaluation.
   *
   * @param {Array} actions - Already ordered actions or action sequences
   * @param {number} maxActions - Branch budget
   * @returns {Array} Diverse subset in the original ordering
   */
  limitActions(actions, maxActions) {
    if (actions.length <= maxActions) return actions;
    if (maxActions <= 0) return [];

    const representatives = new Map();
    actions.forEach((action, index) => {
      const category = this.getSequenceCategory(action);
      if (!representatives.has(category)) {
        representatives.set(category, { action, index, category });
      }
    });

    const categoryPriority = entry => {
      if (entry.category.includes('skill-support')) return 0;
      if (entry.category.includes('item-support')) return 1;
      if (/^(attack|skill-offense|skill-hybrid|item-support)>move$/.test(entry.category)) {
        return 2;
      }
      if (entry.category === 'move') return 3;
      if (entry.category.startsWith('move>')) return 4;
      if (entry.category === 'wait') return 6;
      return 5;
    };

    const reserved = [...representatives.values()]
      .sort((first, second) =>
        categoryPriority(first) - categoryPriority(second) ||
        first.index - second.index
      )
      .slice(0, maxActions);
    const selected = new Set(reserved.map(entry => entry.action));

    for (const action of actions) {
      if (selected.size >= maxActions) break;
      selected.add(action);
    }

    // Preserve the move ordering used by alpha-beta after reserving diversity.
    return actions.filter(action => selected.has(action)).slice(0, maxActions);
  }

  getSequenceCategory(actionOrSequence) {
    const sequence = Array.isArray(actionOrSequence)
      ? actionOrSequence
      : [actionOrSequence];
    return sequence.map(action => {
      if (action.type === 'skill') {
        const skill = action.skill || {};
        const support = skill.targetAlly === true ||
          skill.targetAllAllies === true ||
          skill.targetSelf === true ||
          Boolean(skill.selfBuff) ||
          Boolean(skill.cleanse) ||
          skill.healPercent > 0 ||
          skill.mpRestore > 0 ||
          skill.damageType === 'heal' ||
          skill.effect === 'heal';
        const offense = Number(skill.power) > 0 &&
          skill.targetSelf !== true &&
          skill.targetAlly !== true &&
          skill.targetAllAllies !== true &&
          skill.damageType !== 'heal' &&
          skill.effect !== 'heal';
        if (support && offense) return 'skill-hybrid';
        return support ? 'skill-support' : 'skill-offense';
      }
      if (action.type === 'item') return 'item-support';
      return action.type;
    }).join('>');
  }

  /**
   * Apply a complete actor turn to a simulated state.
   * Accepts a legacy single action as well as an ordered action sequence.
   * @param {Object} state - Battle state (will be modified)
   * @param {Object} actor - Acting unit
   * @param {Object|Array} actionOrSequence - Action or ordered turn sequence
   * @returns {Object} Modified state
   */
  applyActionSequence(state, actor, actionOrSequence) {
    const sequence = Array.isArray(actionOrSequence) ? actionOrSequence : [actionOrSequence];
    for (const action of sequence) {
      if (action) {
        applyActionToState(state, actor, action);
      }
    }
    return state;
  }

  /**
   * Get the next actor in turn order
   * @param {Object} state - Battle state
   * @param {Object} currentActor - Actor who just acted
   * @param {number} roundsRemaining - Current rounds remaining
   * @returns {Object} { nextActor, newRoundsRemaining, turnComplete }
   */
  getNextActor(state, currentActor, roundsRemaining) {
    // Mark current actor as having acted this round
    const stateActor = state.units.find(u => u.id === currentActor.id);
    if (stateActor) {
      stateActor.hasActedThisRound = true;
    }

    // Find next actor who hasn't acted (simplified CT-based ordering)
    const aliveUnits = state.units.filter(u => u.hp > 0 && !u.hasActedThisRound);

    if (aliveUnits.length === 0) {
      // All units have acted, reset and start new round
      for (const unit of state.units) {
        unit.hasActedThisRound = false;
      }
      return {
        nextActor: null,
        newRoundsRemaining: roundsRemaining,
        turnComplete: true
      };
    }

    // Sort by CT (agility-based) - higher acts first
    const sorted = aliveUnits.sort((a, b) => {
      const ctA = (a.ct || 0) + (a.agility || 10);
      const ctB = (b.ct || 0) + (b.agility || 10);
      return ctB - ctA;
    });

    return {
      nextActor: sorted[0],
      newRoundsRemaining: roundsRemaining,
      turnComplete: false
    };
  }

  /**
   * Get the first actor for a new round
   * @param {Object} state - Battle state
   * @param {string} perspective - Whose perspective
   * @returns {Object} First actor
   */
  getFirstActor(state, _perspective) {
    const aliveUnits = state.units.filter(u => u.hp > 0);
    if (aliveUnits.length === 0) return null;

    // Reset acted flags
    for (const unit of state.units) {
      unit.hasActedThisRound = false;
      unit.moveUsed = false;
      unit.actUsed = false;
      // The runtime advances a used skill's cooldown once per completed turn.
      // In this round-based simulation, each unit completes one turn per round,
      // so advance every active cooldown at the round boundary.
      for (const skillId of Object.keys(unit.skillCooldowns || {})) {
        if (unit.skillCooldowns[skillId] > 0) {
          unit.skillCooldowns[skillId]--;
        }
      }
    }

    // Sort by CT
    const sorted = aliveUnits.sort((a, b) => {
      const ctA = (a.ct || 0) + (a.agility || 10);
      const ctB = (b.ct || 0) + (b.agility || 10);
      return ctB - ctA;
    });

    return sorted[0];
  }

  /**
   * Get appropriate evaluator for an actor
   * @param {Object} actor - Actor to evaluate for
   * @param {string} perspective - Original perspective
   * @returns {Object} StateEvaluator instance
   */
  getEvaluatorForActor(actor, perspective) {
    if (getUnitTeamId(actor) === normalizePerspectiveTeam(perspective)) {
      // Ally - use same evaluator
      const pattern = actor.aiType || 'aggressive';
      return new StateEvaluator(getWeights(pattern));
    } else if (actor.type === 'player') {
      // Simulating player from enemy perspective
      return new StateEvaluator(OPTIMAL_PLAYER_WEIGHTS);
    } else {
      // Simulating enemy from player perspective
      const pattern = actor.aiType || 'aggressive';
      return new StateEvaluator(getWeights(pattern));
    }
  }

  /**
   * Check if game is over
   * @param {Object} state - Battle state
   * @returns {boolean}
   */
  isGameOver(state) {
    const aliveTeams = new Set(
      state.units
        .filter(unit => unit.hp > 0)
        .map(unit => getUnitTeamId(unit))
    );
    return aliveTeams.size <= 1;
  }

  /**
   * Reset search state for new decision
   */
  reset() {
    this.transpositionTable.clear();
    this.killerMoves.clear();
    this.nodesEvaluated = 0;
    this.searchTimedOut = false;
  }
}

function normalizePerspectiveTeam(perspective) {
  if (perspective && typeof perspective === 'object') {
    return getUnitTeamId(perspective);
  }
  if (perspective === 'player') return 1;
  if (perspective === 'enemy') return 2;
  return perspective;
}

/**
 * Quick single-depth evaluation (fallback for time pressure)
 * @param {Object} state - Battle state
 * @param {Object} unit - Acting unit
 * @param {Object} evaluator - StateEvaluator
 * @returns {Object} { action, score }
 */
function quickEvaluate(state, unit, evaluator) {
  const actions = generateAllActions(unit, state);
  return evaluator.getBestAction(unit, actions, state);
}

export {
  Lookahead,
  quickEvaluate
};
