/**
 * Utility AI - Main coordinator for AI decision making
 *
 * Orchestrates utility-based scoring with multi-actor lookahead
 * to produce intelligent tactical decisions for NPCs.
 */

import { StateEvaluator } from './stateEvaluator.js';
import { getWeights, patternExists } from './patternWeights.js';
import { generateAllActions, generateThreatResponseActions } from './actionGenerator.js';
import { Lookahead, quickEvaluate } from './lookahead.js';
import { PerformanceTracker } from './cache.js';

/**
 * UtilityAI - Main AI decision-making class
 */
class UtilityAI {
  /**
   * @param {string} pattern - AI pattern (aggressive, defensive, tactical, etc.)
   * @param {Object} options - Configuration options
   */
  constructor(pattern, options = {}) {
    this.pattern = patternExists(pattern) ? pattern : 'aggressive';
    this.weightConfig = getWeights(this.pattern);
    this.evaluator = new StateEvaluator(this.weightConfig);

    this.options = {
      timeBudgetMs: options.timeBudgetMs || 450,
      maxRounds: options.maxRounds || 3,
      useLookahead: options.useLookahead !== false,
      debug: options.debug || false
    };

    this.lookahead = new Lookahead({
      maxRounds: this.options.maxRounds,
      timeBudgetMs: this.options.timeBudgetMs
    });

    this.performanceTracker = new PerformanceTracker();
  }

  /**
   * Decide the best action for a unit's turn
   * @param {Object} unit - The unit making a decision
   * @param {Object} state - Current battle state
   * @returns {Object} Decided action with metadata
   */
  decideTurnActions(unit, state) {
    this.performanceTracker.startDecision(unit.id);

    try {
      let result;

      if (this.options.useLookahead) {
        // Use multi-actor lookahead for sophisticated decisions
        result = this.lookahead.iterativeDeepening(state, unit, this.evaluator);
      } else {
        // Quick single-depth evaluation
        const quickResult = quickEvaluate(state, unit, this.evaluator);
        result = {
          action: quickResult.bestAction,
          score: quickResult.score,
          stats: { nodesEvaluated: 1, timeMs: 0 }
        };
      }

      // Add decision metadata
      const decision = {
        action: result.action,
        score: result.score,
        pattern: this.pattern,
        stats: result.stats,
        unitId: unit.id
      };

      this.performanceTracker.endDecision(decision);

      if (this.options.debug) {
        console.log(`[AI ${this.pattern}] Unit ${unit.name} decides:`, {
          action: decision.action.type,
          target: decision.action.targetId || decision.action.position,
          score: decision.score.toFixed(1),
          timeMs: result.stats?.timeMs
        });
      }

      return decision;

    } catch (error) {
      console.error('[UtilityAI] Decision error:', error);
      this.performanceTracker.endDecision({ error: error.message });

      // Fallback to simple action
      return this.fallbackDecision(unit, state);
    }
  }

  /**
   * Decide both move and action for a turn
   * @param {Object} unit - Acting unit
   * @param {Object} state - Battle state
   * @returns {Object} { moveAction, combatAction }
   */
  decideFullTurn(unit, state) {
    // For units that can both move and act
    const decision = this.decideTurnActions(unit, state);

    // Parse single action into components
    if (decision.action.type === 'move') {
      return {
        moveAction: decision.action,
        combatAction: null,
        decision
      };
    }

    // If it's a move+action sequence, split them
    if (Array.isArray(decision.action)) {
      const moveAction = decision.action.find(a => a.type === 'move');
      const combatAction = decision.action.find(a => a.type !== 'move');
      return { moveAction, combatAction, decision };
    }

    // Combat action without move
    return {
      moveAction: null,
      combatAction: decision.action,
      decision
    };
  }

  /**
   * Fallback decision when main AI fails
   * @param {Object} unit - Acting unit
   * @param {Object} state - Battle state
   * @returns {Object} Simple decision
   */
  fallbackDecision(unit, state) {
    // Generate simple actions
    const actions = generateAllActions(unit, state);

    // Prefer attacks, then skills, then moves
    const attack = actions.find(a => a.type === 'attack');
    if (attack) {
      return { action: attack, score: 0, pattern: 'fallback', stats: {} };
    }

    const skill = actions.find(a => a.type === 'skill');
    if (skill) {
      return { action: skill, score: 0, pattern: 'fallback', stats: {} };
    }

    const move = actions.find(a => a.type === 'move');
    if (move) {
      return { action: move, score: 0, pattern: 'fallback', stats: {} };
    }

    return { action: { type: 'wait' }, score: 0, pattern: 'fallback', stats: {} };
  }

  /**
   * React to immediate threats (used for defensive patterns)
   * @param {Object} unit - Acting unit
   * @param {Object} state - Battle state
   * @returns {Object|null} Threat response action or null
   */
  reactToThreats(unit, state) {
    const threatActions = generateThreatResponseActions(unit, state);

    if (threatActions.length === 0) {
      return null;
    }

    // Evaluate threat responses
    const { bestAction, score } = this.evaluator.getBestAction(unit, threatActions, state);

    // Only return if score is good enough
    if (score > 100) {
      return { action: bestAction, score, isThreatResponse: true };
    }

    return null;
  }

  /**
   * Get performance statistics
   * @returns {Object} Performance stats
   */
  getPerformanceStats() {
    return this.performanceTracker.getAverageStats();
  }

  /**
   * Update AI pattern dynamically
   * @param {string} newPattern - New pattern to use
   */
  setPattern(newPattern) {
    if (patternExists(newPattern)) {
      this.pattern = newPattern;
      this.weightConfig = getWeights(this.pattern);
      this.evaluator = new StateEvaluator(this.weightConfig);
    }
  }
}

/**
 * Create a UtilityAI instance for a unit
 * @param {Object} unit - Unit to create AI for
 * @param {Object} options - Additional options
 * @returns {UtilityAI} AI instance
 */
function createAIForUnit(unit, options = {}) {
  const pattern = unit.aiType || 'aggressive';
  return new UtilityAI(pattern, options);
}

/**
 * Quick decision without full lookahead (for performance)
 * @param {Object} unit - Acting unit
 * @param {Object} state - Battle state
 * @param {string} pattern - AI pattern
 * @returns {Object} Quick decision
 */
function quickDecision(unit, state, pattern = 'aggressive') {
  const weightConfig = getWeights(pattern);
  const evaluator = new StateEvaluator(weightConfig);
  const actions = generateAllActions(unit, state);
  return evaluator.getBestAction(unit, actions, state);
}

/**
 * Batch decisions for multiple units (for turn planning)
 * @param {Array} units - Units to decide for
 * @param {Object} state - Battle state
 * @param {Object} options - Options
 * @returns {Array} Array of decisions
 */
function batchDecisions(units, state, options = {}) {
  const decisions = [];

  for (const unit of units) {
    if (unit.hp <= 0) continue;

    const ai = createAIForUnit(unit, {
      ...options,
      // Reduce time budget when processing many units
      timeBudgetMs: Math.floor((options.timeBudgetMs || 450) / units.length)
    });

    decisions.push(ai.decideTurnActions(unit, state));
  }

  return decisions;
}

export {
  UtilityAI,
  createAIForUnit,
  quickDecision,
  batchDecisions
};
