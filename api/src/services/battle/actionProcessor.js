/**
 * Action Processor - Handles move, attack, skill, item, and wait actions
 *
 * Two-action system: each turn allows 1 move + 1 act (attack/skill), in either order
 */

import * as traitService from '../traitService.js';
import { calculatePhysicalDamage, calculateMagicalDamage, checkHit } from './damageCalculator.js';
import {
  canUnitAct,
  canUnitMove,
  canUnitUseSkills,
  applyStatusEffect,
  initializeTurnState
} from './statusEffectManager.js';
import {
  getMovementRange,
  getAttackRange,
  getReachableTiles,
  getTargetsInRange,
  findAdjacentTileToTarget,
  getOppositeType,
  calculatePathCost,
  getManhattanDistance
} from './movementService.js';
import { getSkillDefinition } from './skillDefinitionService.js';
import { getAoETiles, getUnitsInAoE } from './aoeService.js';
import { CURE_POISON_EFFECTS, CURE_ALL_EFFECTS } from '../../../../shared/battleMath.js';

/**
 * Get all available actions for a unit in the current battle state
 * This is used by both player UI (sent to client) and AI decision making
 *
 * @param {Object} unit - The unit to get actions for
 * @param {Object} state - Battle state
 * @returns {Object} Available actions with targets
 */
export function getAvailableActions(unit, state) {
  const actions = {
    canMove: false,
    canAct: false,
    movement: null,
    attacks: null,
    skills: null,
    items: null
  };

  // Check two-action system state
  if (!unit.moveUsed && canUnitMove(unit)) {
    actions.canMove = true;
    actions.movement = {
      range: getMovementRange(unit),
      reachableTiles: getReachableTiles(unit, state)
    };
  }

  if (!unit.actUsed && canUnitAct(unit)) {
    actions.canAct = true;

    // Basic attack
    const attackRange = unit.attackRange || getAttackRange(unit);
    const attackTargets = getTargetsInRange(unit, state, attackRange, getOppositeType(unit.type));
    actions.attacks = {
      range: attackRange,
      targets: attackTargets
    };

    // Skills (if unit can use skills)
    if (canUnitUseSkills(unit) && unit.skills && unit.skills.length > 0) {
      actions.skills = unit.skills
        .filter(skill => {
          // Only active skills
          if (skill.type === 'passive') return false;
          // Check MP cost
          const mpCost = skill.mpCost || 0;
          if (mpCost > unit.mp) return false;
          // Check cooldown
          if (unit.skillCooldowns?.[skill.id] > 0) return false;
          return true;
        })
        .map(skill => {
          // Determine targets based on skill type
          let targets;
          const skillRange = skill.range || 1;

          if (skill.selfBuff || skill.cleanse || (skill.healPercent && !skill.targetAlly)) {
            // Self-targeting
            targets = [{ x: unit.tileX, y: unit.tileY, unitId: unit.id }];
          } else if (skill.targetAlly || skill.targetAllAllies) {
            // Ally-targeting
            targets = getTargetsInRange(unit, state, skillRange, 'ally');
            // Add self as valid target for ally skills
            targets.unshift({ x: unit.tileX, y: unit.tileY, unitId: unit.id, distance: 0 });
          } else {
            // Enemy-targeting (default)
            targets = getTargetsInRange(unit, state, skillRange, getOppositeType(unit.type));
          }

          return {
            id: skill.id,
            name: skill.name,
            mpCost: skill.mpCost || 0,
            range: skillRange,
            cooldown: skill.cooldown || 0,
            currentCooldown: unit.skillCooldowns?.[skill.id] || 0,
            power: skill.power,
            damageType: skill.damageType,
            aoeRadius: skill.aoeRadius,
            effect: skill.effect,
            targets
          };
        });
    }

    // Items for players (from state.consumables) or NPCs (from unit.consumables)
    // AUTO-BATTLE NOTE: This abstraction allows the AI system to work for player
    // auto-battle without modification. The AI's actionGenerator.js relies on this
    // method to provide available items regardless of unit type.
    const consumables = unit.type === 'player' ? state.consumables : unit.consumables;
    if (consumables && consumables.length > 0) {
      actions.items = consumables
        .filter(item => item.quantity > 0)
        .map(item => ({
          itemId: item.itemId,
          inventoryId: item.inventoryId,
          name: item.name,
          quantity: item.quantity,
          effectType: item.effectType,
          effectValue: item.effectValue
        }));
    }
  }

  return actions;
}

/**
 * Process a move action
 */
function processMoveAction(state, unit, targetTile) {
  const result = { damage: 0, moved: false, turnEnded: false };

  // Check if already moved this turn
  if (unit.moveUsed) {
    result.error = 'Already moved this turn';
    return result;
  }
  // Check if status effects prevent movement
  if (!canUnitMove(unit)) {
    result.error = 'Cannot move due to status effect';
    return result;
  }

  if (!targetTile) return result;

  // SECURITY: Validate movement range server-side (anti-cheat)
  const movementRange = getMovementRange(unit);
  const moveCost = calculatePathCost(
    unit.tileX, unit.tileY,
    targetTile.x, targetTile.y,
    state, movementRange
  );

  if (moveCost > movementRange || moveCost === Infinity) {
    result.error = `Target out of movement range (max: ${movementRange}, cost: ${moveCost === Infinity ? 'unreachable' : moveCost})`;
    return result;
  }

  // Validate target tile is within map bounds
  if (targetTile.x < 0 || targetTile.y < 0 ||
      targetTile.x >= (state.mapWidth || 32) || targetTile.y >= (state.mapHeight || 32)) {
    result.error = 'Target tile is outside map bounds';
    return result;
  }

  // Check if target tile is occupied by another unit
  const occupyingUnit = state.units.find(u =>
    u.id !== unit.id && u.hp > 0 && u.tileX === targetTile.x && u.tileY === targetTile.y
  );
  if (occupyingUnit) {
    result.error = 'Target tile is occupied';
    return result;
  }

  unit.tileX = targetTile.x;
  unit.tileY = targetTile.y;
  result.moved = true;
  result.newPosition = { x: targetTile.x, y: targetTile.y };
  unit.moveUsed = true;

  return result;
}

/**
 * Process an attack action
 */
function processAttackAction(state, unit, targetTile) {
  const result = { damage: 0, moved: false, turnEnded: false };

  // Check if already acted this turn
  if (unit.actUsed) {
    result.error = 'Already acted this turn';
    return result;
  }
  // Check if status effects prevent acting
  if (!canUnitAct(unit)) {
    result.error = 'Cannot act due to status effect';
    return result;
  }

  if (!targetTile) return result;

  // SECURITY: Validate attack range server-side (anti-cheat)
  const attackRange = getAttackRange(unit);
  const attackDistance = getManhattanDistance(unit.tileX, unit.tileY, targetTile.x, targetTile.y);

  if (attackDistance > attackRange) {
    result.error = `Target out of attack range (max: ${attackRange}, attempted: ${attackDistance})`;
    return result;
  }

  if (attackDistance === 0) {
    result.error = 'Cannot attack own tile';
    return result;
  }

  const target = state.units.find(u =>
    u.tileX === targetTile.x && u.tileY === targetTile.y && u.hp > 0
  );

  if (target) {
    // Attack target at tile
    const hits = checkHit(unit, target);
    if (hits) {
      const damageResult = calculatePhysicalDamage(unit, target);
      const actualDamage = damageResult.damage;

      // Apply damage to target (check for death save first)
      const wouldKill = target.hp - actualDamage <= 0;
      if (wouldKill && traitService.checkDeathSave(target)) {
        // Death save triggered - survive with 1 HP
        target.hp = 1;
        result.deathSaveTrigger = true;
        result.deathSaveUnitId = target.id;
      } else {
        target.hp = Math.max(0, target.hp - actualDamage);
      }

      result.damage = actualDamage;
      result.isCritical = damageResult.isCritical;
      result.targetId = target.id;
      result.targetType = target.type;

      // Apply lifesteal trait (heal attacker for % of damage dealt)
      const lifestealAmount = traitService.calculateLifesteal(unit, actualDamage);
      if (lifestealAmount > 0) {
        unit.hp = Math.min(unit.maxHp, unit.hp + lifestealAmount);
        result.lifestealAmount = lifestealAmount;
      }
    } else {
      result.missed = true;
      result.targetId = target.id;
    }
  } else {
    // Empty tile attack - animation plays but no effect
    result.attackedEmptyTile = true;
    result.targetTile = targetTile;
  }

  unit.actUsed = true;
  return result;
}

/**
 * Process a skill action
 */
function processSkillAction(state, unit, targetTile, skillId) {
  const result = { damage: 0, moved: false, turnEnded: false, skillEffects: [] };

  // Check if already acted this turn
  if (unit.actUsed) {
    result.error = 'Already acted this turn';
    return result;
  }
  // Check if status effects prevent acting or using skills
  if (!canUnitAct(unit)) {
    result.error = 'Cannot act due to status effect';
    return result;
  }
  if (!canUnitUseSkills(unit)) {
    result.error = 'Cannot use skills due to silence';
    return result;
  }

  if (!targetTile || !skillId) return result;

  // Get the unit's skill level for scaling
  let unitSkillLevel = 1;
  if (Array.isArray(unit.skills)) {
    const unitSkillData = unit.skills.find(s => s.id === skillId);
    unitSkillLevel = unitSkillData?.level || 1;
  } else if (unit.skills?.[skillId]) {
    unitSkillLevel = unit.skills[skillId];
  }

  // Pass unit to getSkillDefinition so it can check unit's skills array directly
  const skill = getSkillDefinition(unit.class, skillId, unitSkillLevel, unit);
  if (!skill) {
    result.error = 'Invalid skill';
    return result;
  }

  // SECURITY: Enforce skill cooldown server-side
  if (!unit.skillCooldowns) {
    unit.skillCooldowns = {};
  }
  if (unit.skillCooldowns[skillId] && unit.skillCooldowns[skillId] > 0) {
    result.error = `Skill on cooldown (${unit.skillCooldowns[skillId]} turns remaining)`;
    return result;
  }

  // SECURITY: Validate skill range server-side (anti-cheat)
  const isSelfTargetingSkill = skill.selfBuff || skill.cleanse || (skill.healPercent && !skill.targetAlly);
  if (!isSelfTargetingSkill) {
    const skillRange = skill.range || 1;
    const skillDistance = getManhattanDistance(unit.tileX, unit.tileY, targetTile.x, targetTile.y);

    if (skillDistance > skillRange) {
      result.error = `Target out of skill range (max: ${skillRange}, attempted: ${skillDistance})`;
      return result;
    }
  }

  // Calculate MP cost
  const mpCost = skill.mpCost || (skill.baseCost ? Math.floor(skill.baseCost / 10) : 5);
  if (unit.mp < mpCost) {
    result.error = 'Not enough MP';
    return result;
  }

  // Deduct MP
  unit.mp -= mpCost;
  result.skillUsed = skillId;
  result.skillName = skill.name;
  result.mpCost = mpCost;

  // Handle self-targeting skills (buffs, heals)
  if (skill.selfBuff || skill.healPercent || skill.cleanse) {
    if (skill.selfBuff) {
      applyStatusEffect(unit, skill.selfBuff, skill.buffDuration || 3);
      result.skillEffects.push({ type: 'buff', effect: skill.selfBuff, targetId: unit.id });
    }
    if (skill.healPercent) {
      const healAmount = Math.floor(unit.maxHp * skill.healPercent / 100);
      unit.hp = Math.min(unit.maxHp, unit.hp + healAmount);
      result.healing = healAmount;
      result.targetId = unit.id;
    }
    if (skill.mpRestore) {
      const mpAmount = Math.floor(unit.maxMp * skill.mpRestore / 100);
      unit.mp = Math.min(unit.maxMp, unit.mp + mpAmount);
      result.mpRestored = mpAmount;
    }
    if (skill.cleanse) {
      unit.statusEffects = (unit.statusEffects || []).filter(e =>
        ['rage', 'fortify', 'haste', 'regen'].includes(e.type)
      );
      result.skillEffects.push({ type: 'cleanse', targetId: unit.id });
    }
    if (skill.cooldown && skill.cooldown > 0) {
      unit.skillCooldowns[skillId] = skill.cooldown;
    }
    unit.actUsed = true;
    return result;
  }

  // Handle movement skills (like Pounce, Charge Rush)
  if (skill.movement) {
    const adjacentTile = findAdjacentTileToTarget(state, unit, targetTile);
    if (adjacentTile) {
      result.leapedFrom = { x: unit.tileX, y: unit.tileY };
      unit.tileX = adjacentTile.x;
      unit.tileY = adjacentTile.y;
      result.leapedTo = { x: adjacentTile.x, y: adjacentTile.y };
      result.isLeapAttack = true;
    }
  }

  // Find target at tile
  const target = state.units.find(u =>
    u.tileX === targetTile.x && u.tileY === targetTile.y && u.hp > 0
  );

  // Handle ally-targeting skills (heals, buffs)
  if (skill.targetAlly && target && target.type === unit.type) {
    if (skill.healPercent) {
      const healAmount = Math.floor(target.maxHp * skill.healPercent / 100);
      target.hp = Math.min(target.maxHp, target.hp + healAmount);
      result.healing = healAmount;
      result.targetId = target.id;
    }
    if (skill.effect && skill.effectChance >= Math.random()) {
      applyStatusEffect(target, skill.effect, skill.effectDuration || 3);
      result.skillEffects.push({ type: 'buff', effect: skill.effect, targetId: target.id });
    }
    if (skill.cooldown && skill.cooldown > 0) {
      unit.skillCooldowns[skillId] = skill.cooldown;
    }
    unit.actUsed = true;
    return result;
  }

  // Check if this is an AoE skill
  if (skill.aoeRadius && skill.aoeRadius > 0) {
    return processAoESkill(state, unit, targetTile, skill, skillId, result);
  }

  // Single-target skill
  if (target) {
    return processSingleTargetSkill(state, unit, target, skill, skillId, result);
  }

  // Empty tile skill - animation plays but no damage
  result.attackedEmptyTile = true;
  result.targetTile = targetTile;
  if (skill.cooldown && skill.cooldown > 0) {
    unit.skillCooldowns[skillId] = skill.cooldown;
  }
  unit.actUsed = true;
  return result;
}

/**
 * Process an AoE skill
 */
function processAoESkill(state, unit, targetTile, skill, skillId, result) {
  // Get all units in the AoE area (includes allies - friendly fire!)
  const affectedUnits = getUnitsInAoE(
    state.units,
    targetTile.x,
    targetTile.y,
    skill.aoeRadius,
    skill.aoePattern || 'circle'
  );

  // Track AoE results
  result.isAoE = true;
  result.aoeTargets = [];
  result.aoeTiles = getAoETiles(
    targetTile.x,
    targetTile.y,
    skill.aoeRadius,
    skill.aoePattern || 'circle'
  );

  const power = skill.power || 150;
  const damageType = skill.damageType || 'physical';
  const skillElement = skill.element || null;
  const hits = skill.hits || 1;

  let totalAoEDamage = 0;
  result.element = skillElement;

  for (const { unit: affectedUnit, isCenter } of affectedUnits) {
    const damageResult = damageType === 'magical'
      ? calculateMagicalDamage(unit, affectedUnit, power, skillElement)
      : calculatePhysicalDamage(unit, affectedUnit, power, skillElement);

    // Handle absorb (element heals instead of damages)
    if (damageResult.isAbsorb) {
      const healAmount = damageResult.damage;
      affectedUnit.hp = Math.min(affectedUnit.maxHp, affectedUnit.hp + healAmount);
      result.aoeTargets.push({
        targetId: affectedUnit.id,
        targetName: affectedUnit.name,
        targetType: affectedUnit.type,
        healing: healAmount,
        isAbsorb: true,
        isCenter,
        tileX: affectedUnit.tileX,
        tileY: affectedUnit.tileY,
        element: skillElement,
        elementalModifier: damageResult.elementalModifier
      });
      continue;
    }

    // Apply damage (multiply by hits if multi-hit skill)
    let totalDamage = 0;
    for (let i = 0; i < hits; i++) {
      totalDamage += damageResult.damage;
    }

    // Reduce damage for non-center targets (75% damage at edges)
    if (!isCenter) {
      totalDamage = Math.floor(totalDamage * 0.75);
    }

    // Apply damage with death save check
    const wouldKill = affectedUnit.hp - totalDamage <= 0;
    if (wouldKill && traitService.checkDeathSave(affectedUnit)) {
      affectedUnit.hp = 1;
    } else {
      affectedUnit.hp = Math.max(0, affectedUnit.hp - totalDamage);
    }

    totalAoEDamage += totalDamage;

    const targetResult = {
      targetId: affectedUnit.id,
      targetName: affectedUnit.name,
      targetType: affectedUnit.type,
      damage: totalDamage,
      isCritical: damageResult.isCritical,
      isCenter,
      tileX: affectedUnit.tileX,
      tileY: affectedUnit.tileY,
      deathSaveTrigger: wouldKill && affectedUnit.hp === 1,
      element: skillElement,
      elementalModifier: damageResult.elementalModifier
    };

    // Apply status effect if skill has one and chance succeeds
    if (skill.effect && skill.effectChance && Math.random() < skill.effectChance) {
      const effectApplied = applyStatusEffect(
        affectedUnit,
        skill.effect,
        skill.effectDuration || 3
      );
      if (effectApplied) {
        targetResult.effectApplied = skill.effect;
        targetResult.effectDuration = skill.effectDuration || 3;
        result.skillEffects.push({
          type: 'debuff',
          effect: skill.effect,
          duration: skill.effectDuration || 3,
          targetId: affectedUnit.id
        });
      }
    }

    result.aoeTargets.push(targetResult);
  }

  // Apply lifesteal for total AoE damage dealt
  const lifestealAmount = traitService.calculateLifesteal(unit, totalAoEDamage);
  if (lifestealAmount > 0) {
    unit.hp = Math.min(unit.maxHp, unit.hp + lifestealAmount);
    result.lifestealAmount = lifestealAmount;
  }

  // Set primary target info for backwards compatibility
  if (result.aoeTargets.length > 0) {
    const primaryTarget = result.aoeTargets.find(t => t.isCenter) || result.aoeTargets[0];
    result.damage = result.aoeTargets.reduce((sum, t) => sum + (t.damage || 0), 0);
    result.targetId = primaryTarget.targetId;
    result.targetType = primaryTarget.targetType;
  } else {
    result.attackedEmptyTile = true;
    result.targetTile = targetTile;
  }

  if (skill.cooldown && skill.cooldown > 0) {
    unit.skillCooldowns[skillId] = skill.cooldown;
  }
  unit.actUsed = true;
  return result;
}

/**
 * Process a single-target skill
 */
function processSingleTargetSkill(state, unit, target, skill, skillId, result) {
  const power = skill.power || 150;
  const damageType = skill.damageType || 'physical';
  const skillElement = skill.element || null;
  const damageResult = damageType === 'magical'
    ? calculateMagicalDamage(unit, target, power, skillElement)
    : calculatePhysicalDamage(unit, target, power, skillElement);

  result.element = skillElement;
  result.elementalModifier = damageResult.elementalModifier;

  // Handle absorb (element heals instead of damages)
  if (damageResult.isAbsorb) {
    const healAmount = damageResult.damage;
    target.hp = Math.min(target.maxHp, target.hp + healAmount);
    result.healing = healAmount;
    result.isAbsorb = true;
    result.targetId = target.id;
    result.targetType = target.type;
    if (skill.cooldown && skill.cooldown > 0) {
      unit.skillCooldowns[skillId] = skill.cooldown;
    }
    unit.actUsed = true;
    return result;
  }

  // Apply damage (multiply by hits if multi-hit skill)
  const hits = skill.hits || 1;
  let totalDamage = 0;
  for (let i = 0; i < hits; i++) {
    totalDamage += damageResult.damage;
  }

  // Apply damage with death save check
  const wouldKill = target.hp - totalDamage <= 0;
  if (wouldKill && traitService.checkDeathSave(target)) {
    target.hp = 1;
    result.deathSaveTrigger = true;
    result.deathSaveUnitId = target.id;
  } else {
    target.hp = Math.max(0, target.hp - totalDamage);
  }

  result.damage = totalDamage;
  result.hits = hits;
  result.isCritical = damageResult.isCritical;
  result.targetId = target.id;
  result.targetType = target.type;

  // Apply lifesteal trait
  const lifestealAmount = traitService.calculateLifesteal(unit, totalDamage);
  if (lifestealAmount > 0) {
    unit.hp = Math.min(unit.maxHp, unit.hp + lifestealAmount);
    result.lifestealAmount = lifestealAmount;
  }

  // Apply status effect if skill has one and chance succeeds
  if (skill.effect && skill.effectChance && Math.random() < skill.effectChance) {
    const effectApplied = applyStatusEffect(
      target,
      skill.effect,
      skill.effectDuration || 3
    );
    if (effectApplied) {
      result.skillEffects.push({
        type: 'debuff',
        effect: skill.effect,
        duration: skill.effectDuration || 3,
        targetId: target.id
      });
    }
  }

  if (skill.cooldown && skill.cooldown > 0) {
    unit.skillCooldowns[skillId] = skill.cooldown;
  }
  unit.actUsed = true;
  return result;
}

/**
 * Get the Throw Item skill from a unit's skills array
 * @param {Object} unit - The unit to check
 * @returns {Object|null} The throw_item skill with level, or null if not found
 */
function getThrowItemSkill(unit) {
  if (!unit?.skills) return null;
  if (Array.isArray(unit.skills)) {
    return unit.skills.find(s => s.id === 'throw_item');
  }
  // Handle object format { skillId: level }
  if (unit.skills.throw_item) {
    return { id: 'throw_item', level: unit.skills.throw_item };
  }
  return null;
}

/**
 * Get the Efficient Mixing skill from a unit's skills array
 * @param {Object} unit - The unit to check
 * @returns {Object|null} The efficient_mixing skill with level, or null if not found
 */
function getEfficientMixingSkill(unit) {
  if (!unit?.skills) return null;
  if (Array.isArray(unit.skills)) {
    return unit.skills.find(s => s.id === 'efficient_mixing');
  }
  // Handle object format { skillId: level }
  if (unit.skills.efficient_mixing) {
    return { id: 'efficient_mixing', level: unit.skills.efficient_mixing };
  }
  return null;
}

/**
 * Calculate item effectiveness multiplier based on Throw Item and Efficient Mixing skills
 * @param {Object} unit - The unit using the item
 * @param {boolean} isTargetingSelf - Whether targeting self
 * @returns {number} Effectiveness multiplier (1.0 = 100%)
 */
function calculateItemEffectiveness(unit, isTargetingSelf) {
  let effectiveness = 1.0;

  // If targeting others, apply Throw Item penalty/scaling
  if (!isTargetingSelf) {
    const throwItemSkill = getThrowItemSkill(unit);
    if (throwItemSkill) {
      // Effectiveness: 60% + (level * 2)%
      // At level 1: 62%, at level 10: 80%, at level 20: 100%
      effectiveness = 0.6 + (throwItemSkill.level * 0.02);
    }
    // Note: If no throw_item skill and targeting others, this shouldn't happen
    // as frontend/backend validation should prevent it
  }

  // Apply Efficient Mixing bonus (stacks multiplicatively)
  const efficientMixingSkill = getEfficientMixingSkill(unit);
  if (efficientMixingSkill) {
    // +10% item effectiveness per level
    const mixingBonus = 1.0 + (efficientMixingSkill.level * 0.1);
    effectiveness *= mixingBonus;
  }

  return effectiveness;
}

/**
 * Process an item action
 */
function processItemAction(state, unit, targetTile, itemId) {
  const result = { damage: 0, moved: false, turnEnded: false, itemEffects: [] };

  // Check if already acted this turn
  if (unit.actUsed) {
    result.error = 'Already acted this turn';
    return result;
  }
  // Check if status effects prevent acting
  if (!canUnitAct(unit)) {
    result.error = 'Cannot act due to status effect';
    return result;
  }

  if (!itemId) return result;

  result.itemUsed = itemId;

  // Look up item from appropriate source
  // AUTO-BATTLE NOTE: Player items are in state.consumables (shared party pool),
  // NPC items are in unit.consumables (per-unit). This abstraction ensures the AI
  // system works for player auto-battle without modification.
  const consumables = unit.type === 'player' ? (state.consumables || []) : (unit.consumables || []);
  const consumable = consumables.find(c => c.itemId === parseInt(itemId, 10) || c.itemId === itemId);

  if (!consumable || consumable.quantity <= 0) {
    result.error = 'Item not available';
    return result;
  }

  // Find target (self or ally at tile)
  let itemTarget = unit;
  let isTargetingSelf = true;
  if (targetTile) {
    const tileTarget = state.units.find(u =>
      u.tileX === targetTile.x && u.tileY === targetTile.y && u.type === unit.type
    );
    if (tileTarget && tileTarget.id !== unit.id) {
      itemTarget = tileTarget;
      isTargetingSelf = false;
    }
  }

  // SECURITY: Validate targeting restrictions (anti-cheat)
  // Without Throw Item skill, can only target self
  if (!isTargetingSelf) {
    const throwItemSkill = getThrowItemSkill(unit);
    if (!throwItemSkill) {
      result.error = 'Cannot target allies without Throw Item skill';
      return result;
    }

    // Validate range based on Throw Item skill level
    // Range: 2 + floor(level / 5) tiles
    const maxRange = 2 + Math.floor(throwItemSkill.level / 5);
    const distance = getManhattanDistance(unit.tileX, unit.tileY, targetTile.x, targetTile.y);
    if (distance > maxRange) {
      result.error = `Target out of throw range (max: ${maxRange}, attempted: ${distance})`;
      return result;
    }
  }

  // Calculate item effectiveness multiplier
  const effectiveness = calculateItemEffectiveness(unit, isTargetingSelf);
  result.effectiveness = effectiveness;

  // Apply item effects based on canonical effectType from database
  // Canonical types: heal_hp, heal_mp, heal_both, cure_poison, cure_all, revive
  const effectType = consumable.effectType;
  const baseEffectValue = consumable.effectValue || 0;
  // Apply effectiveness multiplier to effect value
  const effectValue = Math.floor(baseEffectValue * effectiveness);

  // Guard: non-revive items cannot target dead units
  if (effectType !== 'revive' && itemTarget.hp <= 0) {
    result.error = 'Cannot use this item on a defeated unit';
    return result;
  }

  // Guard: revive items require a dead target
  if (effectType === 'revive' && itemTarget.hp > 0) {
    result.error = 'Target is not defeated';
    return result;
  }

  // Handle different effect types (effectValue is absolute HP/MP, not percentage)
  if (effectType === 'heal_hp') {
    const healAmount = Math.min(effectValue, itemTarget.maxHp - itemTarget.hp);
    itemTarget.hp = Math.min(itemTarget.maxHp, itemTarget.hp + effectValue);
    result.healing = healAmount;
    result.itemEffects.push({ type: 'heal', amount: healAmount, targetId: itemTarget.id });
  }

  if (effectType === 'heal_mp') {
    const mpAmount = Math.min(effectValue, itemTarget.maxMp - itemTarget.mp);
    itemTarget.mp = Math.min(itemTarget.maxMp, itemTarget.mp + effectValue);
    result.mpRestored = mpAmount;
    result.itemEffects.push({ type: 'mpRestore', amount: mpAmount, targetId: itemTarget.id });
  }

  if (effectType === 'heal_both') {
    const healAmount = Math.min(effectValue, itemTarget.maxHp - itemTarget.hp);
    const mpAmount = Math.min(Math.floor(effectValue / 2), itemTarget.maxMp - itemTarget.mp);
    itemTarget.hp = Math.min(itemTarget.maxHp, itemTarget.hp + effectValue);
    itemTarget.mp = Math.min(itemTarget.maxMp, itemTarget.mp + Math.floor(effectValue / 2));
    result.healing = healAmount;
    result.mpRestored = mpAmount;
    result.itemEffects.push({ type: 'heal', amount: healAmount, targetId: itemTarget.id });
    result.itemEffects.push({ type: 'mpRestore', amount: mpAmount, targetId: itemTarget.id });
  }

  if (effectType === 'cure_poison' || effectType === 'cure_all') {
    // Cure effects are not affected by effectiveness multiplier
    const cleansableEffects = effectType === 'cure_poison' ? CURE_POISON_EFFECTS : CURE_ALL_EFFECTS;
    itemTarget.statusEffects = (itemTarget.statusEffects || []).filter(e =>
      !cleansableEffects.includes(e.type)
    );
    result.itemEffects.push({ type: 'cleanse', effects: cleansableEffects, targetId: itemTarget.id });
  }

  if (effectType === 'revive') {
    // Guard above ensures itemTarget.hp <= 0
    // Apply effectiveness to revive HP percentage
    const revivePercent = baseEffectValue * effectiveness;
    const reviveHp = Math.floor(itemTarget.maxHp * revivePercent / 100);
    itemTarget.hp = reviveHp;
    result.itemEffects.push({ type: 'revive', amount: reviveHp, targetId: itemTarget.id });
  }

  // Include effectType in result so frontend can select correct animation
  result.effectType = effectType;

  // Consume the item in battle state
  consumable.quantity--;
  if (consumable.quantity <= 0) {
    const filtered = consumables.filter(c => c.itemId !== consumable.itemId);
    if (unit.type === 'player') {
      state.consumables = filtered;
    } else {
      unit.consumables = filtered;
    }
  }

  // Mark inventory item for consumption (will be processed after battle or immediately)
  result.consumedInventoryId = consumable.inventoryId;
  result.targetId = itemTarget.id;
  result.itemName = consumable.name;
  unit.actUsed = true;

  return result;
}

/**
 * Process an action for any unit (player or enemy)
 * Two-action system: each turn allows 1 move + 1 act (attack/skill), in either order
 * @param {Object} state - Battle state
 * @param {Object} unit - The acting unit
 * @param {string} actionType - 'move' | 'attack' | 'skill' | 'item' | 'wait'
 * @param {Object} targetTile - { x, y } target position
 * @param {string} skillId - Optional skill ID for skill actions, or item ID for item actions
 * @returns {Object} Action result with turnEnded flag
 */
export function processAction(state, unit, actionType, targetTile, skillId = null) {
  let result = { damage: 0, moved: false, turnEnded: false };

  // Initialize two-action state if missing (migration support)
  initializeTurnState(unit);

  switch (actionType) {
    case 'move':
      result = processMoveAction(state, unit, targetTile);
      break;

    case 'attack':
      result = processAttackAction(state, unit, targetTile);
      break;

    case 'skill':
      result = processSkillAction(state, unit, targetTile, skillId);
      break;

    case 'item':
      result = processItemAction(state, unit, targetTile, skillId);
      break;

    case 'wait':
      // Wait ends turn immediately, skipping any remaining actions
      result.turnEnded = true;
      break;
  }

  // Return early if there's an error
  if (result.error) {
    return result;
  }

  // Determine if turn is complete
  if (actionType === 'wait' || (unit.moveUsed && unit.actUsed)) {
    unit.turnPhase = 'done';
    unit.hasActed = true; // backwards compatibility
    result.turnEnded = true;
  } else if (unit.moveUsed || unit.actUsed) {
    unit.turnPhase = 'partial';
  }

  // Calculate available actions for response
  const canMove = canUnitMove(unit) && !unit.moveUsed;
  const canAct = canUnitAct(unit) && !unit.actUsed;
  result.availableActions = { canMove, canAct };

  return result;
}

/**
 * Check if battle has ended
 * @param {Object} state - Battle state
 * @returns {string} 'active' | 'victory' | 'defeat'
 */
export function checkBattleEnd(state) {
  const playerUnitsAlive = state.units.filter(u => u.type === 'player' && u.hp > 0).length;
  const enemyUnitsAlive = state.units.filter(u => u.type === 'enemy' && u.hp > 0).length;

  if (enemyUnitsAlive === 0) return 'victory';
  if (playerUnitsAlive === 0) return 'defeat';
  return 'active';
}
