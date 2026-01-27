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
  calculateTargetPriority,
  strategicPathProgress,
  waitingPenalty
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
        factors.strategicPathProgress = 0; // N/A for attack
        factors.waitingPenalty = 0; // N/A for attack
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
        // Pass skill benefit to detect zero-benefit actions (buff skills always provide value)
        const isBuff = skill.selfBuff || skill.effect;
        const skillBenefit = isBuff ? 50 : (factors.DAMAGE_DEALT + factors.HEALING_VALUE);
        factors.MP_EFFICIENCY = calculateMpEfficiency(unit, skill, skillBenefit);
        factors.strategicPathProgress = 0; // N/A for skill
        factors.waitingPenalty = 0; // N/A for skill

        // Track benefit for conditional action bonus (internal fields prefixed with _)
        factors._skillBenefit = skillBenefit;
        factors._mpCost = skill.mpCost || 0;
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
        factors.strategicPathProgress = strategicPathProgress({ unit, action, state });
        factors.waitingPenalty = 0; // No waiting penalty for move actions
        break;

      case 'item': {
        const itemTarget = resolveTarget(action, state);
        const item = action.item;
        const effectType = item?.effectType;
        let healingValue = 0;

        if (effectType === 'heal_hp' || effectType === 'heal_both') {
          if (itemTarget && itemTarget.hp > 0) {
            const missingHp = itemTarget.maxHp - itemTarget.hp;
            const restored = Math.min(item.effectValue || 0, missingHp);
            const hpPercent = itemTarget.hp / itemTarget.maxHp;
            // Urgency multiplier: much more valuable at low HP
            let urgency = 0.2;
            if (hpPercent < 0.25) urgency = 3.0;
            else if (hpPercent < 0.40) urgency = 2.0;
            else if (hpPercent < 0.60) urgency = 1.2;
            else if (hpPercent < 0.80) urgency = 0.5;
            healingValue = restored * urgency;
          }
        }

        if (effectType === 'heal_mp' || effectType === 'heal_both') {
          if (itemTarget && itemTarget.hp > 0) {
            const missingMp = itemTarget.maxMp - itemTarget.mp;
            const mpValue = effectType === 'heal_both' ? Math.floor((item.effectValue || 0) / 2) : (item.effectValue || 0);
            const restored = Math.min(mpValue, missingMp);
            const mpPercent = itemTarget.mp / itemTarget.maxMp;
            const hasSkills = (itemTarget.skills && itemTarget.skills.length > 0) ? 1.5 : 0.5;
            let mpUrgency = 0.2;
            if (mpPercent < 0.2) mpUrgency = 2.0;
            else if (mpPercent < 0.4) mpUrgency = 1.5;
            else if (mpPercent < 0.6) mpUrgency = 0.8;
            healingValue += restored * mpUrgency * hasSkills;
          }
        }

        if (effectType === 'cure_poison' || effectType === 'cure_all') {
          const cleansable = effectType === 'cure_poison' ? ['poison'] : ['poison', 'blind', 'silence', 'slow', 'burn'];
          const numEffects = itemTarget ? (itemTarget.statusEffects || []).filter(e => cleansable.includes(e.type)).length : 0;
          healingValue = 80 * numEffects;
        }

        if (effectType === 'revive') {
          if (itemTarget && itemTarget.hp <= 0) {
            healingValue = 500;
          }
        }

        factors.DAMAGE_DEALT = 0;
        factors.KILL_POTENTIAL = 0;
        factors.TARGET_PRIORITY = 0;
        factors.DAMAGE_RECEIVED = calculateDamageReceived(unit, unit.tileX, unit.tileY, state);
        factors.POSITION_QUALITY = 0;
        factors.ALLY_SUPPORT = calculateAllySupport(unit, unit.tileX, unit.tileY, state);
        factors.HEALING_VALUE = healingValue;
        factors.SURVIVAL_PRIORITY = calculateSurvivalPriority(unit, unit.tileX, unit.tileY, state);
        factors.MP_EFFICIENCY = 100; // Items don't cost MP
        factors.strategicPathProgress = 0;
        factors.waitingPenalty = 0;
        break;
      }

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
        factors.strategicPathProgress = 0; // No path progress when waiting
        factors.waitingPenalty = waitingPenalty({ unit, action, state });
        break;

      default:
        // Unknown action type, return minimal score
        return { score: -1000, factors: {} };
    }

    // Calculate weighted total
    for (const [factor, value] of Object.entries(factors)) {
      // Skip internal tracking fields (prefixed with _)
      if (factor.startsWith('_')) continue;
      const weight = this.weights[factor] || 0;
      totalScore += value * weight;
    }

    // Apply unweighted penalty for wasteful resource expenditure
    // This penalty bypasses pattern weights to guarantee wasteful actions lose
    if (factors._skillBenefit === 0 && factors._mpCost > 0) {
      totalScore -= 300;
    }

    // Apply action type bonuses/penalties (conditional for skills)
    totalScore += this.getActionTypeBonus(action.type, factors._skillBenefit);

    return { score: totalScore, factors };
  }

  /**
   * Get bonus/penalty for action types based on pattern
   * @param {string} actionType - Type of action
   * @param {number|null} skillBenefit - Skill benefit value (null for non-skills)
   * @returns {number} Bonus value
   */
  getActionTypeBonus(actionType, skillBenefit = null) {
    // No bonus for zero-benefit skills - they shouldn't get rewarded
    if (actionType === 'skill' && skillBenefit !== null && skillBenefit === 0) {
      return 0;
    }

    // Aggressive patterns strongly prefer attacking, heavily penalize waiting
    if (this.patternName === 'Aggressive' || this.patternName === 'Berserker') {
      if (actionType === 'attack' || actionType === 'skill') return 50;
      if (actionType === 'item') return 10; // Aggressive units rarely use items
      if (actionType === 'move') return 10; // Moving toward enemies is good
      if (actionType === 'wait') return -150; // Strong penalty for doing nothing
    }

    // Defensive patterns prefer repositioning, neutral on waiting
    if (this.patternName === 'Defensive') {
      if (actionType === 'item') return 20; // Defensive units value items
      if (actionType === 'move') return 20;
      if (actionType === 'attack' || actionType === 'skill') return 10;
      if (actionType === 'wait') return 0;
    }

    // Hit-and-run patterns prefer attacking then moving (action order handled elsewhere)
    if (this.patternName === 'HitAndRun') {
      if (actionType === 'attack' || actionType === 'skill') return 40;
      if (actionType === 'move') return 30; // Moving away after attack is good
      if (actionType === 'item') return 15;
      if (actionType === 'wait') return -100; // Shouldn't wait when can hit-and-run
    }

    // Tactical patterns favor calculated attacks
    if (this.patternName === 'Tactical') {
      if (actionType === 'attack' || actionType === 'skill') return 30;
      if (actionType === 'item') return 20;
      if (actionType === 'move') return 15;
      if (actionType === 'wait') return -50;
    }

    // Ambush patterns prefer to wait if hidden
    if (this.patternName === 'Ambush') {
      if (actionType === 'wait') return 20;
      if (actionType === 'attack') return 10; // Springing the ambush is fine
      if (actionType === 'item') return 10;
    }

    // Default item bonus for unmatched patterns
    if (actionType === 'item') return 10;

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
    const _enemyType = perspective === 'player' ? 'enemy' : 'player';

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
