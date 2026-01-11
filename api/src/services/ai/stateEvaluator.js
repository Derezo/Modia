/**
 * State Evaluator - Combines utility factors with weights to score actions and positions
 *
 * This module provides the core scoring logic that the AI uses to evaluate
 * potential actions and board states.
 */

import {
  calculateDamageDealt,
  calculateDamageReceived,
  calculateKillPotential,
  calculatePositionQuality,
  calculateAllySupport,
  calculateHealingValue,
  calculateSurvivalPriority,
  calculateMpEfficiency,
  calculateTargetPriority
} from './utilityFactors.js';

/**
 * Resolve a target from an action to get the full unit object
 * Actions store targets as {x, y, unitId, unitName} but utility functions need full unit stats
 * @param {Object} action - Action with target/targetId
 * @param {Object} state - Battle state with units array
 * @returns {Object|null} Full unit object or null if not found
 */
function resolveTarget(action, state) {
  // If no target or targetId, return null
  if (!action.targetId && !action.target) return null;

  // Look up unit by targetId first (most reliable)
  if (action.targetId) {
    const unit = state.units.find(u => u.id === action.targetId);
    if (unit) return unit;
  }

  // Fall back to looking up by target.unitId
  if (action.target?.unitId) {
    const unit = state.units.find(u => u.id === action.target.unitId);
    if (unit) return unit;
  }

  // If target is already a full unit object (has hp property), use it directly
  if (action.target?.hp !== undefined) {
    return action.target;
  }

  // Could not resolve - return null
  return null;
}

/**
 * StateEvaluator class - scores actions and states using weighted utility factors
 */
class StateEvaluator {
  /**
   * @param {Object} weightConfig - Weight configuration from patternWeights
   */
  constructor(weightConfig) {
    this.weights = weightConfig.weights;
    this.patternName = weightConfig.name;
  }

  /**
   * Evaluate a specific action for a unit
   * @param {Object} unit - Unit taking the action
   * @param {Object} action - Action to evaluate {type, target?, skill?, position?}
   * @param {Object} state - Current battle state
   * @returns {Object} { score, factors }
   */
  evaluateAction(unit, action, state) {
    const factors = {};
    let totalScore = 0;

    switch (action.type) {
      case 'attack': {
        // Resolve target to full unit object for accurate damage calculation
        const resolvedTarget = resolveTarget(action, state);
        factors.DAMAGE_DEALT = calculateDamageDealt(unit, resolvedTarget, null, state);
        factors.KILL_POTENTIAL = calculateKillPotential(unit, resolvedTarget, null, state);
        factors.TARGET_PRIORITY = calculateTargetPriority(resolvedTarget, state);
        factors.DAMAGE_RECEIVED = calculateDamageReceived(unit, unit.tileX, unit.tileY, state);
        factors.POSITION_QUALITY = 0; // No movement in attack
        factors.ALLY_SUPPORT = calculateAllySupport(unit, unit.tileX, unit.tileY, state);
        factors.HEALING_VALUE = 0;
        factors.SURVIVAL_PRIORITY = calculateSurvivalPriority(unit, unit.tileX, unit.tileY, state);
        factors.MP_EFFICIENCY = 100; // Basic attacks are free
        break;
      }

      case 'skill': {
        // Resolve target to full unit object for accurate damage calculation
        const resolvedTarget = resolveTarget(action, state);
        const skill = action.skill;
        factors.DAMAGE_DEALT = calculateDamageDealt(unit, resolvedTarget, skill, state);
        factors.KILL_POTENTIAL = calculateKillPotential(unit, resolvedTarget, skill, state);
        factors.TARGET_PRIORITY = calculateTargetPriority(resolvedTarget, state);
        factors.DAMAGE_RECEIVED = calculateDamageReceived(unit, unit.tileX, unit.tileY, state);
        factors.POSITION_QUALITY = 0;
        factors.ALLY_SUPPORT = calculateAllySupport(unit, unit.tileX, unit.tileY, state);
        factors.HEALING_VALUE = calculateHealingValue(unit, resolvedTarget, skill, state);
        factors.SURVIVAL_PRIORITY = calculateSurvivalPriority(unit, unit.tileX, unit.tileY, state);
        factors.MP_EFFICIENCY = calculateMpEfficiency(unit, skill);
        break;
      }

      case 'move':
        factors.DAMAGE_DEALT = 0;
        factors.KILL_POTENTIAL = 0;
        factors.TARGET_PRIORITY = 0;
        factors.DAMAGE_RECEIVED = calculateDamageReceived(unit, action.position.x, action.position.y, state);
        factors.POSITION_QUALITY = calculatePositionQuality(unit, action.position.x, action.position.y, state);
        factors.ALLY_SUPPORT = calculateAllySupport(unit, action.position.x, action.position.y, state);
        factors.HEALING_VALUE = 0;
        factors.SURVIVAL_PRIORITY = calculateSurvivalPriority(unit, action.position.x, action.position.y, state);
        factors.MP_EFFICIENCY = 50; // Neutral
        break;

      case 'wait':
        factors.DAMAGE_DEALT = 0;
        factors.KILL_POTENTIAL = 0;
        factors.TARGET_PRIORITY = 0;
        factors.DAMAGE_RECEIVED = calculateDamageReceived(unit, unit.tileX, unit.tileY, state);
        factors.POSITION_QUALITY = calculatePositionQuality(unit, unit.tileX, unit.tileY, state);
        factors.ALLY_SUPPORT = calculateAllySupport(unit, unit.tileX, unit.tileY, state);
        factors.HEALING_VALUE = 0;
        factors.SURVIVAL_PRIORITY = calculateSurvivalPriority(unit, unit.tileX, unit.tileY, state);
        factors.MP_EFFICIENCY = 100; // Perfect efficiency (no cost)
        break;

      default:
        // Unknown action type, return minimal score
        return { score: -1000, factors: {} };
    }

    // Calculate weighted total
    for (const [factor, value] of Object.entries(factors)) {
      const weight = this.weights[factor] || 0;
      totalScore += value * weight;
    }

    // Apply action type bonuses/penalties
    totalScore += this.getActionTypeBonus(action.type);

    return { score: totalScore, factors };
  }

  /**
   * Get bonus/penalty for action types based on pattern
   * @param {string} actionType - Type of action
   * @returns {number} Bonus value
   */
  getActionTypeBonus(actionType) {
    // Aggressive patterns strongly prefer attacking, heavily penalize waiting
    if (this.patternName === 'Aggressive' || this.patternName === 'Berserker') {
      if (actionType === 'attack' || actionType === 'skill') return 50;
      if (actionType === 'move') return 10; // Moving toward enemies is good
      if (actionType === 'wait') return -150; // Strong penalty for doing nothing
    }

    // Defensive patterns prefer repositioning, neutral on waiting
    if (this.patternName === 'Defensive') {
      if (actionType === 'move') return 20;
      if (actionType === 'attack' || actionType === 'skill') return 10;
      if (actionType === 'wait') return 0;
    }

    // Hit-and-run patterns prefer attacking then moving (action order handled elsewhere)
    if (this.patternName === 'HitAndRun') {
      if (actionType === 'attack' || actionType === 'skill') return 40;
      if (actionType === 'move') return 30; // Moving away after attack is good
      if (actionType === 'wait') return -100; // Shouldn't wait when can hit-and-run
    }

    // Tactical patterns favor calculated attacks
    if (this.patternName === 'Tactical') {
      if (actionType === 'attack' || actionType === 'skill') return 30;
      if (actionType === 'move') return 15;
      if (actionType === 'wait') return -50;
    }

    // Ambush patterns prefer to wait if hidden
    if (this.patternName === 'Ambush') {
      if (actionType === 'wait') return 20;
      if (actionType === 'attack') return 10; // Springing the ambush is fine
    }

    return 0;
  }

  /**
   * Evaluate a move+action combination (common decision pattern)
   * @param {Object} unit - Unit taking action
   * @param {Object} movePos - Position to move to {x, y}
   * @param {Object} action - Action after move
   * @param {Object} state - Current battle state
   * @returns {Object} { score, factors, moveScore, actionScore }
   */
  evaluateMoveAndAction(unit, movePos, action, state) {
    // Create hypothetical state with unit at new position
    const hypotheticalUnit = { ...unit, tileX: movePos.x, tileY: movePos.y };

    // Score the move
    const moveAction = { type: 'move', position: movePos };
    const moveEval = this.evaluateAction(unit, moveAction, state);

    // Score the action from new position
    const actionEval = this.evaluateAction(hypotheticalUnit, action, state);

    // Combined score - slightly favor the action over movement
    const combinedScore = moveEval.score * 0.4 + actionEval.score * 0.6;

    return {
      score: combinedScore,
      factors: {
        move: moveEval.factors,
        action: actionEval.factors
      },
      moveScore: moveEval.score,
      actionScore: actionEval.score
    };
  }

  /**
   * Evaluate overall board state from a perspective
   * Used for lookahead evaluation
   * @param {Object} state - Battle state
   * @param {string} perspective - 'player' or 'enemy'
   * @returns {number} State evaluation score
   */
  evaluateState(state, perspective) {
    let score = 0;
    const friendlyType = perspective;
    const enemyType = perspective === 'player' ? 'enemy' : 'player';

    let friendlyUnits = 0;
    let friendlyTotalHp = 0;
    let friendlyMaxHp = 0;
    let enemyUnits = 0;
    let enemyTotalHp = 0;
    let enemyMaxHp = 0;

    for (const unit of state.units) {
      if (unit.hp <= 0) continue;

      if (unit.type === friendlyType) {
        friendlyUnits++;
        friendlyTotalHp += unit.hp;
        friendlyMaxHp += unit.maxHp;
      } else {
        enemyUnits++;
        enemyTotalHp += unit.hp;
        enemyMaxHp += unit.maxHp;
      }
    }

    // Win/lose conditions
    if (enemyUnits === 0) return 10000; // Victory
    if (friendlyUnits === 0) return -10000; // Defeat

    // HP advantage
    const friendlyHpPercent = friendlyMaxHp > 0 ? friendlyTotalHp / friendlyMaxHp : 0;
    const enemyHpPercent = enemyMaxHp > 0 ? enemyTotalHp / enemyMaxHp : 0;
    score += (friendlyHpPercent - enemyHpPercent) * 500;

    // Unit count advantage
    score += (friendlyUnits - enemyUnits) * 200;

    // Position quality for our units
    for (const unit of state.units) {
      if (unit.type !== friendlyType || unit.hp <= 0) continue;
      score += calculatePositionQuality(unit, unit.tileX, unit.tileY, state) * 0.5;
    }

    return score;
  }

  /**
   * Compare two actions and return the better one
   * @param {Object} unit - Acting unit
   * @param {Object} action1 - First action
   * @param {Object} action2 - Second action
   * @param {Object} state - Battle state
   * @returns {Object} Better action
   */
  compareTwoActions(unit, action1, action2, state) {
    const score1 = this.evaluateAction(unit, action1, state).score;
    const score2 = this.evaluateAction(unit, action2, state).score;
    return score1 >= score2 ? action1 : action2;
  }

  /**
   * Get the best action from a list
   * @param {Object} unit - Acting unit
   * @param {Array} actions - List of possible actions
   * @param {Object} state - Battle state
   * @returns {Object} { bestAction, score, allScores }
   */
  getBestAction(unit, actions, state) {
    if (!actions || actions.length === 0) {
      return { bestAction: { type: 'wait' }, score: 0, allScores: [] };
    }

    let bestAction = actions[0];
    let bestScore = -Infinity;
    const allScores = [];

    for (const action of actions) {
      const { score, factors } = this.evaluateAction(unit, action, state);
      allScores.push({ action, score, factors });

      if (score > bestScore) {
        bestScore = score;
        bestAction = action;
      }
    }

    // Sort for debugging/logging
    allScores.sort((a, b) => b.score - a.score);

    return { bestAction, score: bestScore, allScores };
  }
}

export { StateEvaluator };
