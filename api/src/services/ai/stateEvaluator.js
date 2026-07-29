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
  getUnitTeamId,
  isRestorativeSkill,
  strategicPathProgress,
  waitingPenalty
} from './utilityFactors.js';
import { applyActionToState, cloneState } from './cache.js';
import { getUnitsInAoE } from '../battle/aoeService.js';
import {
  isBeneficialStatusEffect,
  CURE_POISON_EFFECTS,
  CURE_ALL_EFFECTS
} from '../../../../shared/battleMath.js';

const COST_FACTORS = new Set(['DAMAGE_RECEIVED', 'SURVIVAL_PRIORITY']);

function getStatusEffectType(effect) {
  return typeof effect === 'string' ? effect : effect?.type;
}

function hasStatusEffect(unit, effectType) {
  if (!unit || !effectType) return false;
  return (unit.statusEffects || []).some(effect =>
    getStatusEffectType(effect) === effectType
  );
}

function isAllyTargetingSkill(skill) {
  return skill?.targetAlly === true || skill?.targetType === 'ally';
}

function getAlliedSkillTargets(unit, skill, state) {
  if (!skill?.targetAllAllies) return [];

  const range = skill.range ?? 0;
  return state.units
    .map(candidate => candidate.id === unit.id ? unit : candidate)
    .filter(candidate => {
      if (candidate.hp <= 0 || getUnitTeamId(candidate) !== getUnitTeamId(unit)) {
        return false;
      }
      if (range <= 0) return true;
      const distance = Math.abs(candidate.tileX - unit.tileX) +
        Math.abs(candidate.tileY - unit.tileY);
      return distance <= range;
    });
}

function hasSupportSkillComponent(skill) {
  return Boolean(
    isAllyTargetingSkill(skill) ||
    skill?.targetAllAllies ||
    skill?.targetSelf ||
    skill?.selfBuff ||
    skill?.cleanse ||
    skill?.mpRestore ||
    isRestorativeSkill(skill)
  );
}

function hasDamageSkillComponent(skill) {
  return Number(skill?.power) > 0 &&
    skill?.targetSelf !== true &&
    !isAllyTargetingSkill(skill) &&
    skill?.targetAllAllies !== true &&
    skill?.damageType !== 'support' &&
    skill?.damageType !== 'heal' &&
    skill?.effect !== 'heal';
}

function getSkillBuffEffect(skill) {
  if (typeof skill?.selfBuff === 'string') return skill.selfBuff;
  if (skill?.selfBuff && typeof skill.selfBuff === 'object') {
    return skill.selfBuff.type || `${skill.id || 'skill'}_buff`;
  }
  if (skill?.effect && skill.effect !== 'heal') return skill.effect;
  return null;
}

function isSkillEffectHandledAsBuff(skill) {
  return Boolean(skill?.selfBuff) &&
    skill.effect === getSkillBuffEffect(skill);
}

function isCasterCenteredSupportBuffAoe(skill) {
  return Boolean(skill?.selfBuff) &&
    Number(skill?.aoeRadius) > 0 &&
    (skill.range ?? 1) === 0 &&
    skill.targetAlly !== true &&
    skill.targetAllAllies !== true &&
    !hasDamageSkillComponent(skill);
}

function getCasterCenteredAlliedAoeTargets(unit, skill, state) {
  const battleUnits = state.units.map(candidate =>
    candidate.id === unit.id ? unit : candidate
  );

  return getUnitsInAoE(
    battleUnits,
    unit.tileX,
    unit.tileY,
    skill.aoeRadius,
    skill.aoePattern || 'circle'
  )
    .map(({ unit: target }) => target)
    .filter(target => getUnitTeamId(target) === getUnitTeamId(unit));
}

function hasHostileStatusSkillComponent(skill) {
  if (!skill?.effect || skill.effect === 'heal' ||
      isSkillEffectHandledAsBuff(skill) ||
      skill.targetSelf === true ||
      isAllyTargetingSkill(skill) ||
      skill.targetAllAllies === true) {
    return false;
  }

  // Match action generation/runtime targeting: a damage-free restorative,
  // cleanse, MP restore, or self-buff skill implicitly targets its caster.
  if (!hasDamageSkillComponent(skill) &&
      (skill.selfBuff || skill.cleanse || skill.mpRestore ||
       isRestorativeSkill(skill))) {
    return false;
  }

  return true;
}

function isOffensiveSkill(skill) {
  return hasDamageSkillComponent(skill) ||
    hasHostileStatusSkillComponent(skill);
}

function getSkillSupportTargets(unit, resolvedTarget, skill, state) {
  if (skill.targetAllAllies) {
    return getAlliedSkillTargets(unit, skill, state);
  }
  if (isAllyTargetingSkill(skill)) {
    return resolvedTarget &&
      getUnitTeamId(resolvedTarget) === getUnitTeamId(unit)
      ? [resolvedTarget]
      : [];
  }
  if (skill.targetSelf) {
    return [unit];
  }
  // Some legacy battle actions identify a heal solely through its resolved
  // allied target rather than a targetAlly flag. Preserve that target instead
  // of incorrectly valuing the skill as a self-heal.
  if (isRestorativeSkill(skill) && resolvedTarget &&
      getUnitTeamId(resolvedTarget) === getUnitTeamId(unit)) {
    return [resolvedTarget];
  }
  if (skill.selfBuff || skill.cleanse || skill.mpRestore ||
      isRestorativeSkill(skill)) {
    return [unit];
  }
  return [resolvedTarget].filter(Boolean);
}

function calculateSkillSupportValue(unit, resolvedTarget, skill, state) {
  if (!hasSupportSkillComponent(skill)) return 0;
  const targets = getSkillSupportTargets(unit, resolvedTarget, skill, state);
  const buffTargets = isCasterCenteredSupportBuffAoe(skill)
    ? getCasterCenteredAlliedAoeTargets(unit, skill, state)
    : targets;

  let value = 0;

  if (isRestorativeSkill(skill)) {
    for (const target of targets) {
      value += calculateHealingValue(unit, target, skill, state);
    }
  }

  if (skill.mpRestore) {
    for (const target of targets) {
      if ((target.maxMp ?? 0) <= 0) continue;
      const restoreAmount = Math.floor(target.maxMp * skill.mpRestore / 100);
      value += Math.min(restoreAmount, Math.max(0, target.maxMp - target.mp));
    }
  }

  if (skill.cleanse) {
    for (const target of targets) {
      const removableEffects = (target.statusEffects || []).filter(effect =>
        !isBeneficialStatusEffect(effect)
      ).length;
      value += removableEffects * 60;
    }
  }

  const buffType = (skill.selfBuff ? getSkillBuffEffect(skill) : null) ||
    ((isAllyTargetingSkill(skill) || skill.targetAllAllies) ? skill.effect : null);
  if (buffType && buffType !== 'heal') {
    const effectChance = skill.effectChance ?? 1;
    for (const target of buffTargets) {
      if (!hasStatusEffect(target, buffType)) {
        value += 50 * effectChance;
      }
    }
  }

  return value;
}

function calculateOffensiveStatusValue(target, skill) {
  if (!target || !hasHostileStatusSkillComponent(skill) ||
      hasStatusEffect(target, skill.effect)) {
    return 0;
  }

  const effectChance = skill.effectChance ?? 1;
  const duration = Math.max(1, skill.effectDuration ?? 1);
  return 30 * effectChance * Math.min(2, duration);
}

function getAoeCenter(unit, action, state) {
  const skill = action.skill || {};
  if ((skill.range ?? 1) === 0 && Number(skill.aoeRadius) > 0) {
    return { x: unit.tileX, y: unit.tileY };
  }

  const center = action.aoeCenter || action.target;
  const x = center?.x ?? center?.tileX;
  const y = center?.y ?? center?.tileY;
  if (x !== undefined && y !== undefined) return { x, y };

  const target = state.units.find(candidate => candidate.id === action.targetId);
  return target ? { x: target.tileX, y: target.tileY } : null;
}

function calculateOffensiveAoeValue(unit, action, state) {
  const skill = action.skill;
  const center = getAoeCenter(unit, action, state);
  if (!center) {
    return { damage: 0, killPotential: 0, targetPriority: 0 };
  }

  const affectedUnits = getUnitsInAoE(
    state.units,
    center.x,
    center.y,
    skill.aoeRadius,
    skill.aoePattern || 'circle'
  );
  const singleTargetSkill = { ...skill, aoeRadius: 0 };
  const hits = Math.max(1, Number(skill.hits) || 1);
  let damage = 0;
  let killPotential = 0;
  let targetPriority = 0;

  for (const { unit: affectedUnit, isCenter } of affectedUnits) {
    const isFriendly = getUnitTeamId(affectedUnit) === getUnitTeamId(unit);
    const direction = isFriendly ? -1 : 1;
    const edgeMultiplier = isCenter ? 1 : 0.75;
    const targetDamage = calculateDamageDealt(
      unit,
      affectedUnit,
      singleTargetSkill,
      state
    ) * hits * edgeMultiplier;
    const statusValue = calculateOffensiveStatusValue(
      affectedUnit,
      singleTargetSkill
    );
    const targetBenefit = targetDamage + statusValue;

    damage += direction * targetBenefit;
    if (hasDamageSkillComponent(singleTargetSkill)) {
      killPotential += direction * calculateKillPotential(
        unit,
        affectedUnit,
        singleTargetSkill,
        state
      );
    }
    if (targetBenefit > 0) {
      targetPriority += direction * calculateTargetPriority(affectedUnit, state);
    }
  }

  return { damage, killPotential, targetPriority };
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
        const damageSkill = hasDamageSkillComponent(skill);
        const offensiveSkill = isOffensiveSkill(skill);
        const offensiveAoe = offensiveSkill && Number(skill.aoeRadius) > 0
          ? calculateOffensiveAoeValue(unit, action, state)
          : null;
        const directDamage = damageSkill && !offensiveAoe
          ? calculateDamageDealt(unit, resolvedTarget, skill, state)
          : (offensiveAoe?.damage ?? 0);
        const statusValue = offensiveAoe
          ? 0
          : calculateOffensiveStatusValue(resolvedTarget, skill);
        const supportValue = calculateSkillSupportValue(unit, resolvedTarget, skill, state);
        const hasDirectOffensiveBenefit = directDamage + statusValue > 0;

        factors.DAMAGE_DEALT = directDamage + statusValue;
        factors.KILL_POTENTIAL = damageSkill
          ? (offensiveAoe?.killPotential ??
            calculateKillPotential(unit, resolvedTarget, skill, state))
          : 0;
        factors.TARGET_PRIORITY = offensiveSkill &&
            (offensiveAoe || hasDirectOffensiveBenefit)
          ? (offensiveAoe?.targetPriority ??
            calculateTargetPriority(resolvedTarget, state))
          : 0;
        factors.DAMAGE_RECEIVED = calculateDamageReceived(unit, unit.tileX, unit.tileY, state);
        factors.POSITION_QUALITY = 0;
        factors.ALLY_SUPPORT = calculateAllySupport(unit, unit.tileX, unit.tileY, state);
        // HEALING_VALUE is the existing support-action factor; it also carries
        // non-healing buff/cleanse value so support patterns can value them.
        factors.HEALING_VALUE = supportValue;
        factors.SURVIVAL_PRIORITY = calculateSurvivalPriority(unit, unit.tileX, unit.tileY, state);
        const skillBenefit = factors.DAMAGE_DEALT + supportValue;
        factors.MP_EFFICIENCY = calculateMpEfficiency(unit, skill, skillBenefit);
        factors.strategicPathProgress = 0; // N/A for skill
        factors.waitingPenalty = 0; // N/A for skill

        // Track benefit for conditional action bonus (internal fields prefixed with _)
        factors._skillBenefit = skillBenefit;
        factors._mpCost = skill.mpCost ?? 0;
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
          const cleansable = effectType === 'cure_poison' ? CURE_POISON_EFFECTS : CURE_ALL_EFFECTS;
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
      const direction = COST_FACTORS.has(factor) ? -1 : 1;
      totalScore += value * weight * direction;
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
    const friendlyTeam = normalizePerspectiveTeam(perspective);

    let friendlyUnits = 0;
    let friendlyTotalHp = 0;
    let friendlyMaxHp = 0;
    let enemyUnits = 0;
    let enemyTotalHp = 0;
    let enemyMaxHp = 0;

    for (const unit of state.units) {
      if (unit.hp <= 0) continue;

      if (getUnitTeamId(unit) === friendlyTeam) {
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
      if (getUnitTeamId(unit) !== friendlyTeam || unit.hp <= 0) continue;
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

  /**
   * Get the best action sequence (move + action) from a list of sequences
   * Evaluates two-action turns, giving bonus for efficient move+attack sequences.
   * @param {Object} unit - Acting unit
   * @param {Array} sequences - List of action sequences (each is an array of 1-2 actions)
   * @param {Object} state - Battle state
   * @returns {Object} { bestAction (array), score, allScores, alternatives }
   */
  getBestSequence(unit, sequences, state) {
    if (!sequences || sequences.length === 0) {
      return { bestAction: [{ type: 'wait' }], score: 0, allScores: [], alternatives: [] };
    }

    let bestSequence = sequences[0];
    let bestScore = -Infinity;
    const allScores = [];

    for (const sequence of sequences) {
      const { score, factors } = this.evaluateSequence(unit, sequence, state);
      allScores.push({ action: sequence, score, factors });

      if (score > bestScore) {
        bestScore = score;
        bestSequence = sequence;
      }
    }

    // Sort for debugging/logging
    allScores.sort((a, b) => b.score - a.score);

    // Collect top alternatives for debugging
    const alternatives = allScores.slice(1, 4).map(s => ({
      action: s.action,
      score: s.score
    }));

    return { bestAction: bestSequence, score: bestScore, allScores, alternatives };
  }

  /**
   * Evaluate a sequence of actions (typically move + action)
   * @param {Object} unit - Acting unit
   * @param {Array} sequence - Array of 1-2 actions
   * @param {Object} state - Battle state
   * @returns {Object} { score, factors }
   */
  evaluateSequence(unit, sequence, state) {
    if (!sequence || sequence.length === 0) {
      return { score: -1000, factors: {} };
    }

    let totalScore = 0;
    const allFactors = {};
    const hypotheticalState = cloneState(state);
    let hypotheticalUnit = hypotheticalState.units.find(candidate => candidate.id === unit.id) ||
      { ...unit };
    let usefulAct = false;

    for (let i = 0; i < sequence.length; i++) {
      const action = sequence[i];

      // Evaluate this action with the unit at its current (possibly hypothetical) position
      const { score, factors } = this.evaluateAction(
        hypotheticalUnit,
        action,
        hypotheticalState
      );
      totalScore += score;

      // Exposure is determined by the position where the turn ends. Remove the
      // per-action risk contribution here and add it once after the sequence.
      totalScore += (factors.DAMAGE_RECEIVED || 0) *
        (this.weights.DAMAGE_RECEIVED || 0);
      totalScore += (factors.SURVIVAL_PRIORITY || 0) *
        (this.weights.SURVIVAL_PRIORITY || 0);

      if (action.type === 'attack' && (factors.DAMAGE_DEALT || 0) > 0) {
        usefulAct = true;
      } else if (action.type === 'skill' && (factors._skillBenefit || 0) > 0) {
        usefulAct = true;
      } else if (action.type === 'item' && (factors.HEALING_VALUE || 0) > 0) {
        usefulAct = true;
      }

      // Store factors with index prefix for debugging
      allFactors[`action${i}`] = factors;

      // Carry movement, healing, statuses, MP, damage, and item effects into
      // subsequent action scoring and the final self-preservation check.
      applyActionToState(hypotheticalState, hypotheticalUnit, action);
      hypotheticalUnit = hypotheticalState.units.find(candidate =>
        candidate.id === unit.id
      ) || hypotheticalUnit;
    }

    const finalDamageRisk = calculateDamageReceived(
      hypotheticalUnit,
      hypotheticalUnit.tileX,
      hypotheticalUnit.tileY,
      hypotheticalState
    );
    const finalSurvivalRisk = calculateSurvivalPriority(
      hypotheticalUnit,
      hypotheticalUnit.tileX,
      hypotheticalUnit.tileY,
      hypotheticalState
    );
    totalScore -= finalDamageRisk * (this.weights.DAMAGE_RECEIVED || 0);
    totalScore -= finalSurvivalRisk * (this.weights.SURVIVAL_PRIORITY || 0);
    allFactors.finalRisk = {
      DAMAGE_RECEIVED: finalDamageRisk,
      SURVIVAL_PRIORITY: finalSurvivalRisk
    };

    // Bonus for making useful use of both turn resources.
    if (sequence.length === 2) {
      const hasMove = sequence.some(a => a.type === 'move');
      if (hasMove && usefulAct) {
        // +30 bonus for using both actions efficiently
        totalScore += 30;
        allFactors.twoActionBonus = 30;
      }
    }

    // Hit-and-run units explicitly prefer acting before a retreat. Other
    // wounded units receive a smaller bonus when the retreat reduces threat.
    const moveIndex = sequence.findIndex(action => action.type === 'move');
    const actIndex = sequence.findIndex(action =>
      action.type === 'attack' || action.type === 'skill' || action.type === 'item'
    );
    if (usefulAct && moveIndex > actIndex && actIndex >= 0) {
      const startingRisk = calculateDamageReceived(unit, unit.tileX, unit.tileY, state);
      const threatReduction = Math.max(0, startingRisk - finalDamageRisk);
      const hpRatio = unit.maxHp > 0 ? unit.hp / unit.maxHp : 1;
      let retreatBonus = threatReduction *
        (this.weights.DAMAGE_RECEIVED || 0) *
        (0.25 + (1 - hpRatio) * 0.5);

      if (this.patternName === 'HitAndRun' && threatReduction > 0) {
        retreatBonus += 45;
      } else if (hpRatio >= 0.5) {
        retreatBonus = 0;
      }

      if (retreatBonus > 0) {
        totalScore += retreatBonus;
        allFactors.retreatBonus = retreatBonus;
      }
    }

    return { score: totalScore, factors: allFactors };
  }
}

export { StateEvaluator };
