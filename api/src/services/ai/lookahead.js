/**
 * Multi-Actor Lookahead - Simulates 2-3 turns ahead considering all characters
 *
 * Implements minimax with alpha-beta pruning for turn-based tactical combat.
 * Simulates the entire battle turn order, including what ALL characters
 * (allies and enemies) will do.
 */

const { StateEvaluator } = require('./stateEvaluator');
const { getWeights, OPTIMAL_PLAYER_WEIGHTS } = require('./patternWeights');
const { generateAllActions, pruneActions, orderActionsForPruning } = require('./actionGenerator');
const {
  TranspositionTable,
  KillerMoves,
  HistoryHeuristic,
  cloneState,
  applyActionToState
} = require('./cache');

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

    const perspective = decidingUnit.type;
    let bestAction = { type: 'wait' };
    let bestScore = -Infinity;

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

      if (result.action && result.score > bestScore) {
        bestScore = result.score;
        bestAction = result.action;
      }

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
      return { score: evaluator.evaluateState(state, perspective), action: null };
    }

    // Terminal conditions
    if (roundsRemaining <= 0 || this.isGameOver(state)) {
      return { score: evaluator.evaluateState(state, perspective), action: null };
    }

    // Check transposition table
    const ttKey = this.transpositionTable.hashState(state, roundsRemaining, perspective);
    const ttEntry = this.transpositionTable.lookup(ttKey, roundsRemaining);
    if (ttEntry) {
      return { score: ttEntry.score, action: ttEntry.bestAction };
    }

    // Generate actions for current actor
    let actions = generateAllActions(currentActor, state);

    // Prune and order actions
    const maxActions = isDecidingActor ? this.decidingActorActions : this.maxActionsPerActor;
    actions = pruneActions(actions, maxActions);
    actions = this.orderActions(actions, roundsRemaining);

    const isMaximizing = currentActor.type === perspective;
    let bestScore = isMaximizing ? -Infinity : Infinity;
    let bestAction = actions[0];

    for (const action of actions) {
      // Apply action to cloned state
      const newState = cloneState(state);
      applyActionToState(newState, currentActor, action);

      // Determine next actor
      const { nextActor, newRoundsRemaining, turnComplete } = this.getNextActor(
        newState,
        currentActor,
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
          this.getEvaluatorForActor(nextActor, perspective),
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
        break;
      }
    }

    // Store in transposition table
    this.transpositionTable.store(ttKey, {
      score: bestScore,
      depth: roundsRemaining,
      bestAction,
      flag: bestScore <= alpha ? 'upper' : bestScore >= beta ? 'lower' : 'exact'
    });

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

      // Killer move bonus
      if (killers.some(k => this.killerMoves.actionsEqual(k, action))) {
        orderScore += 10000;
      }

      // History heuristic bonus
      orderScore += this.historyHeuristic.getScore(action);

      // Type ordering: attacks > skills > moves > wait
      const typeBonus = { attack: 1000, skill: 800, move: 500, wait: 0 };
      orderScore += typeBonus[action.type] || 0;

      return { action, orderScore };
    });

    scored.sort((a, b) => b.orderScore - a.orderScore);
    return scored.map(s => s.action);
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
  getFirstActor(state, perspective) {
    const aliveUnits = state.units.filter(u => u.hp > 0);
    if (aliveUnits.length === 0) return null;

    // Reset acted flags
    for (const unit of state.units) {
      unit.hasActedThisRound = false;
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
    if (actor.type === perspective) {
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
    const aliveEnemies = state.units.filter(u => u.type === 'enemy' && u.hp > 0);
    const alivePlayers = state.units.filter(u => u.type === 'player' && u.hp > 0);
    return aliveEnemies.length === 0 || alivePlayers.length === 0;
  }

  /**
   * Reset search state for new decision
   */
  reset() {
    this.transpositionTable.clear();
    this.killerMoves.clear();
    this.nodesEvaluated = 0;
  }
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

module.exports = {
  Lookahead,
  quickEvaluate
};
