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
  initializeTurnState,
  checkMoonshield
} from './statusEffectManager.js';
import {
  getMovementRange,
  getAttackRange,
  getReachableTiles,
  getTargetsInRange,
  findAdjacentTileToTarget,
  calculatePathCost,
  getManhattanDistance,
  createBattleTraversalView
} from './movementService.js';
import { getSkillDefinition } from './skillDefinitionService.js';
import { getAoETiles, getUnitsInAoE } from './aoeService.js';
import { isTraversalCellPlayable } from '../../../../shared/pathfinding.js';
import {
  normalizeLegacyNpcSkill,
  isExecutableLegacyNpcSkill
} from '../npcSkillService.js';
import {
  isBeneficialStatusEffect,
  CURE_POISON_EFFECTS,
  CURE_ALL_EFFECTS,
  calculateEffectiveStatusChance
} from '../../../../shared/battleMath.js';
import { applyHealingReceivedBonus } from '../zodiacCollectionBonusService.js';
import { getEquipmentAugmentEffect } from './equipmentAugmentEffects.js';

function applyDamageInstance(attacker, target, incomingDamage) {
  if (target.hp <= 0 || incomingDamage <= 0) {
    return {
      damage: 0,
      incomingDamage: Math.max(0, incomingDamage),
      blocked: false,
      killed: false,
      deathSaveTrigger: false
    };
  }

  const shieldResult = checkMoonshield(target, incomingDamage);
  if (shieldResult.blocked) {
    return {
      damage: 0,
      incomingDamage,
      blocked: true,
      blockedBy: 'moonshield',
      killed: false,
      deathSaveTrigger: false
    };
  }

  const hpBefore = target.hp;
  const wouldKill = hpBefore - shieldResult.damage <= 0;
  let deathSaveTrigger = false;
  if (wouldKill && traitService.checkDeathSave(target)) {
    target.hp = 1;
    deathSaveTrigger = true;
  } else {
    target.hp = Math.max(0, hpBefore - shieldResult.damage);
  }

  const damage = hpBefore - target.hp;
  const killed = hpBefore > 0 && target.hp <= 0;
  attacker.damageDealt = (attacker.damageDealt || 0) + damage;
  target.damageTaken = (target.damageTaken || 0) + damage;
  if (killed) {
    attacker.kills = (attacker.kills || 0) + 1;
    target.deaths = (target.deaths || 0) + 1;
  }

  return {
    damage,
    incomingDamage,
    blocked: false,
    killed,
    deathSaveTrigger
  };
}

function getBasicAttackEffects(unit) {
  const twinStrike = unit.nextAttackHitsTwice === true;
  return {
    critChanceBonus: Number.isFinite(unit.nextAttackCritBonus)
      ? unit.nextAttackCritBonus
      : 0,
    hits: twinStrike ? 2 : 1,
    damageMultiplier: twinStrike &&
      Number.isFinite(unit.twinStrikeDamageMultiplier)
      ? unit.twinStrikeDamageMultiplier
      : twinStrike ? 0.6 : 1,
    balance: unit.nextAttackLifesteal === true,
    rangeBonus: Number.isFinite(unit.nextAttackRangeBonus)
      ? unit.nextAttackRangeBonus
      : 0
  };
}

function consumeBasicAttackEffects(unit, effects) {
  const consumed = [];
  if (effects.critChanceBonus) consumed.push('rams_charge');
  if (effects.hits === 2) consumed.push('twin_strike');
  if (effects.balance) consumed.push('balance');
  if (effects.rangeBonus) consumed.push('celestial_arrow');

  delete unit.nextAttackCritBonus;
  delete unit.nextAttackHitsTwice;
  delete unit.twinStrikeDamageMultiplier;
  delete unit.nextAttackLifesteal;
  delete unit.nextAttackRangeBonus;
  return consumed;
}

function hasOffensiveSkillComponent(skill) {
  return Number(skill?.power) > 0 &&
    skill?.targetSelf !== true &&
    skill?.targetAlly !== true &&
    skill?.targetAllAllies !== true &&
    skill?.damageType !== 'support' &&
    skill?.damageType !== 'heal' &&
    skill?.effect !== 'heal';
}

function hasSelfSkillComponent(skill) {
  return skill?.targetSelf === true ||
    Boolean(skill?.selfBuff) ||
    Boolean(skill?.cleanse) ||
    skill?.mpRestore > 0 ||
    (skill?.healPercent > 0 &&
      skill?.targetAlly !== true &&
      skill?.targetAllAllies !== true);
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

function applySkillBuff(target, skill, result) {
  const buffEffect = getSkillBuffEffect(skill);
  if (!buffEffect || (skill.effectChance ?? 1) < Math.random()) return false;

  applyStatusEffect(
    target,
    buffEffect,
    skill.buffDuration || skill.effectDuration || 3
  );

  if (skill.selfBuff && typeof skill.selfBuff === 'object') {
    const appliedEffect = target.statusEffects?.find(effect =>
      effect.type === buffEffect
    );
    if (appliedEffect) {
      const modifiers = { ...skill.selfBuff };
      delete modifiers.type;
      appliedEffect.modifiers = modifiers;
    }
  }

  result.skillEffects.push({
    type: 'buff',
    effect: buffEffect,
    targetId: target.id
  });
  return true;
}

function applySelfSkillEffects(unit, skill, result, applyBuff = true) {
  if (applyBuff && (skill.selfBuff ||
      (skill.targetSelf === true && skill.effect && skill.effect !== 'heal'))) {
    applySkillBuff(unit, skill, result);
  }

  if (skill.healPercent > 0 &&
      skill.targetAlly !== true &&
      skill.targetAllAllies !== true) {
    const healAmount = applyHealingReceivedBonus(
      unit,
      Math.floor(unit.maxHp * skill.healPercent / 100)
    );
    const actualHeal = Math.min(healAmount, Math.max(0, unit.maxHp - unit.hp));
    unit.hp = Math.min(unit.maxHp, unit.hp + healAmount);
    unit.healingDone = (unit.healingDone || 0) + actualHeal;
    result.healing = (result.healing || 0) + actualHeal;
    result.selfHealing = actualHeal;
  }

  if (skill.mpRestore > 0 &&
      skill.targetAlly !== true &&
      skill.targetAllAllies !== true) {
    const mpAmount = Math.floor(unit.maxMp * skill.mpRestore / 100);
    const actualMpRestore = Math.min(mpAmount, Math.max(0, unit.maxMp - unit.mp));
    unit.mp = Math.min(unit.maxMp, unit.mp + mpAmount);
    result.mpRestored = (result.mpRestored || 0) + actualMpRestore;
  }

  if (skill.cleanse &&
      skill.targetAlly !== true &&
      skill.targetAllAllies !== true) {
    unit.statusEffects = (unit.statusEffects || []).filter(isBeneficialStatusEffect);
    result.skillEffects.push({ type: 'cleanse', targetId: unit.id });
  }
}

function createTargetingTileView(state) {
  return createBattleTraversalView(state, {
    ignoreUnits: true,
    ignoreObstacles: true
  });
}

function getTargetingTiles(state, unit, range, { includeCaster }) {
  const view = createTargetingTileView(state);
  const { width, height } = view.dimensions;
  const maxRange = Number.isFinite(range) && range >= 0
    ? Math.floor(range)
    : 0;
  const tiles = [];

  for (let y = Math.max(0, unit.tileY - maxRange);
    y <= Math.min(height - 1, unit.tileY + maxRange);
    y++) {
    for (let x = Math.max(0, unit.tileX - maxRange);
      x <= Math.min(width - 1, unit.tileX + maxRange);
      x++) {
      const distance = getManhattanDistance(unit.tileX, unit.tileY, x, y);
      if (distance > maxRange || (!includeCaster && distance === 0)) continue;
      if (!isTraversalCellPlayable(view, { x, y })) continue;
      tiles.push({ x, y, distance });
    }
  }

  return tiles;
}

function validateTargetTile(state, targetTile) {
  if (!Number.isInteger(targetTile?.x) ||
      !Number.isInteger(targetTile?.y)) {
    return 'Target tile coordinates must be finite integers';
  }

  const view = createTargetingTileView(state);
  const { width, height } = view.dimensions;
  if (targetTile.x < 0 || targetTile.y < 0 ||
      targetTile.x >= width || targetTile.y >= height) {
    return 'Target tile is outside map bounds';
  }
  if (!isTraversalCellPlayable(view, targetTile)) {
    return 'Target tile is not playable';
  }
  return null;
}

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
    canWait: true,
    turnPhase: unit.turnPhase ?? 'ready',
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
    const attackRange = getAttackRange(unit);
    const attackTargets = getTargetsInRange(unit, state, attackRange, 'opponent');
    actions.attacks = {
      range: attackRange,
      targets: attackTargets,
      tiles: getTargetingTiles(
        state,
        unit,
        attackRange,
        { includeCaster: false }
      )
    };

    // Skills (if unit can use skills)
    if (canUnitUseSkills(unit) && unit.skills && unit.skills.length > 0) {
      actions.skills = unit.skills
        .filter(skill => {
          // Only active skills
          if (skill.type === 'passive') return false;
          // Check MP cost
          const mpCost = skill.mpCost ?? 0;
          if (mpCost > unit.mp) return false;
          // Check cooldown
          if (unit.skillCooldowns?.[skill.id] > 0) return false;
          return true;
        })
        .map(skill => normalizeLegacyNpcSkill(skill))
        .filter(skill => isExecutableLegacyNpcSkill(skill))
        .map(skill => {
          // Determine targets based on skill type
          let targets;
          const skillRange = skill.range ?? 1;
          const isCasterCenteredAoE = skillRange === 0 && (skill.aoeRadius ?? 0) > 0;
          const isIntrinsicSelfTargetingSkill =
            hasSelfSkillComponent(skill) &&
            !hasOffensiveSkillComponent(skill) &&
            skill.targetAlly !== true;

          if (skill.targetAllAllies || isCasterCenteredAoE) {
            // Group ally skills and range-zero AoEs are cast from the unit's tile.
            targets = [{ x: unit.tileX, y: unit.tileY, unitId: unit.id, distance: 0 }];
          } else if (hasSelfSkillComponent(skill) &&
              !hasOffensiveSkillComponent(skill) &&
              skill.targetAlly !== true) {
            // Self-targeting
            targets = [{ x: unit.tileX, y: unit.tileY, unitId: unit.id, distance: 0 }];
          } else if (skill.targetAlly) {
            // Ally-targeting
            targets = getTargetsInRange(unit, state, skillRange, 'ally');
            // Add self as valid target for ally skills
            targets.unshift({ x: unit.tileX, y: unit.tileY, unitId: unit.id, distance: 0 });
          } else {
            // Enemy-targeting (default)
            targets = getTargetsInRange(unit, state, skillRange, 'opponent');
          }

          return {
            // Preserve targeting and utility metadata for AI classification as
            // well as the client. Omitting heal/buff flags made restorative
            // skills look like generic attacks to downstream consumers.
            ...skill,
            mpCost: skill.mpCost ?? 0,
            range: skillRange,
            cooldown: skill.cooldown || 0,
            currentCooldown: unit.skillCooldowns?.[skill.id] || 0,
            targets,
            tiles: skill.targetAllAllies ||
              isCasterCenteredAoE ||
              isIntrinsicSelfTargetingSkill
              ? [{ x: unit.tileX, y: unit.tileY, distance: 0 }]
              : getTargetingTiles(
                state,
                unit,
                skillRange,
                { includeCaster: true }
              )
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

  if (!Number.isInteger(targetTile.x) || !Number.isInteger(targetTile.y)) {
    result.error = 'Target tile coordinates must be finite integers';
    return result;
  }

  const terrainWidth = Array.isArray(state.terrain?.[0])
    ? state.terrain[0].length
    : null;
  const terrainHeight = Array.isArray(state.terrain) &&
    Array.isArray(state.terrain[0])
    ? state.terrain.length
    : null;
  const mapWidth = Number.isInteger(state.mapWidth) && state.mapWidth > 0
    ? state.mapWidth
    : terrainWidth || 32;
  const mapHeight = Number.isInteger(state.mapHeight) && state.mapHeight > 0
    ? state.mapHeight
    : terrainHeight || 32;

  // Validate target tile before passing coordinates into traversal.
  if (targetTile.x < 0 || targetTile.y < 0 ||
      targetTile.x >= mapWidth || targetTile.y >= mapHeight) {
    result.error = 'Target tile is outside map bounds';
    return result;
  }

  // Every unit still reserves its tile as a destination. Shared traversal may
  // cross defeated units while calculating a route to a different free tile.
  const occupyingUnit = state.units.find(u =>
    u.id !== unit.id && u.tileX === targetTile.x && u.tileY === targetTile.y
  );
  if (occupyingUnit) {
    result.error = 'Target tile is occupied';
    return result;
  }

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

  const targetTileError = validateTargetTile(state, targetTile);
  if (targetTileError) {
    result.error = targetTileError;
    return result;
  }

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

  const basicAttackEffects = getBasicAttackEffects(unit);
  const target = state.units.find(u =>
    u.tileX === targetTile.x && u.tileY === targetTile.y && u.hp > 0
  );

  if (target) {
    // Attack target at tile
    const hits = checkHit(unit, target);
    if (hits) {
      result.hitResults = [];
      result.attemptedHits = basicAttackEffects.hits;
      for (let hitIndex = 0;
        hitIndex < basicAttackEffects.hits && target.hp > 0;
        hitIndex++) {
        const damageResult = calculatePhysicalDamage(
          unit,
          target,
          basicAttackEffects.damageMultiplier * 100,
          null,
          { critChanceBonus: basicAttackEffects.critChanceBonus }
        );
        const instanceResult = applyDamageInstance(
          unit,
          target,
          damageResult.damage
        );
        result.hitResults.push({
          hit: hitIndex + 1,
          ...instanceResult,
          isCritical: damageResult.isCritical
        });
      }

      const actualDamage = result.hitResults.reduce(
        (total, hitResult) => total + hitResult.damage,
        0
      );
      result.damage = actualDamage;
      result.incomingDamage = result.hitResults.reduce(
        (total, hitResult) => total + hitResult.incomingDamage,
        0
      );
      result.hits = result.hitResults.length;
      result.isCritical = result.hitResults.some(hit => hit.isCritical);
      result.criticalHits = result.hitResults.filter(
        hit => hit.isCritical
      ).length;
      result.blockedHits = result.hitResults.filter(hit => hit.blocked).length;
      if (result.hitResults.some(hit => hit.deathSaveTrigger)) {
        result.deathSaveTrigger = true;
        result.deathSaveUnitId = target.id;
      }
      result.targetId = target.id;
      result.targetType = target.type;

      // Apply lifesteal from traits and equipment augments
      const traitLifesteal = traitService.calculateLifesteal(unit, actualDamage);
      const equipLifestealPercent = getEquipmentAugmentEffect(unit, 'lifesteal');
      const equipLifesteal = Math.floor(actualDamage * equipLifestealPercent);
      const lifestealAmount = applyHealingReceivedBonus(
        unit,
        traitLifesteal + equipLifesteal
      );
      if (lifestealAmount > 0) {
        unit.hp = Math.min(unit.maxHp, unit.hp + lifestealAmount);
        result.lifestealAmount = lifestealAmount;
      }

      if (basicAttackEffects.balance) {
        const balanceHeal = applyHealingReceivedBonus(unit, actualDamage);
        const actualBalanceHeal = Math.min(
          balanceHeal,
          Math.max(0, unit.maxHp - unit.hp)
        );
        unit.hp = Math.min(unit.maxHp, unit.hp + balanceHeal);
        unit.healingDone = (unit.healingDone || 0) + actualBalanceHeal;
        result.balanceHealing = actualBalanceHeal;
        result.balanceHealingRequested = balanceHeal;
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

  result.zodiacEffectsConsumed = consumeBasicAttackEffects(
    unit,
    basicAttackEffects
  );
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
  const skill = normalizeLegacyNpcSkill(
    getSkillDefinition(unit.class, skillId, unitSkillLevel, unit)
  );
  if (!skill || !isExecutableLegacyNpcSkill(skill)) {
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
  const isAllAlliesTargetingSkill = skill.targetAllAllies === true;
  const isAllyTargetingSkill = skill.targetAlly === true && !isAllAlliesTargetingSkill;
  const skillRange = skill.range ?? 1;
  const isCasterCenteredAoE = !isAllAlliesTargetingSkill &&
    !isAllyTargetingSkill &&
    skillRange === 0 &&
    (skill.aoeRadius ?? 0) > 0;
  const isSelfTargetingSkill = !isAllAlliesTargetingSkill &&
    !isAllyTargetingSkill &&
    !isCasterCenteredAoE &&
    hasSelfSkillComponent(skill) &&
    !hasOffensiveSkillComponent(skill);
  const isCasterCenteredSkill = isSelfTargetingSkill ||
    isAllAlliesTargetingSkill ||
    isCasterCenteredAoE;
  const targetingTraversalView = Array.isArray(state.playableMask) &&
    state.playableMask.length > 0
    ? createBattleTraversalView(state)
    : null;

  if (!isCasterCenteredSkill) {
    const targetTileError = validateTargetTile(state, targetTile);
    if (targetTileError) {
      result.error = targetTileError;
      return result;
    }

    const skillDistance = getManhattanDistance(unit.tileX, unit.tileY, targetTile.x, targetTile.y);

    if (skillDistance > skillRange) {
      result.error = `Target out of skill range (max: ${skillRange}, attempted: ${skillDistance})`;
      return result;
    }
  } else if (isCasterCenteredAoE || isAllAlliesTargetingSkill) {
    // These skills are always centered on the caster, regardless of a stale or
    // malicious client-provided tile.
    targetTile = { x: unit.tileX, y: unit.tileY };
  }

  // Targeted support skills apply to any living occupant. Empty tiles (and
  // tiles holding only defeated units) still consume the action as a deliberate
  // tile target, but have no unit effect.
  let target = null;
  if (isAllyTargetingSkill) {
    target = state.units.find(u =>
      u.tileX === targetTile.x && u.tileY === targetTile.y && u.hp > 0
    );
  }

  // Calculate MP cost
  const mpCost = skill.mpCost ??
    (skill.baseCost ? Math.floor(skill.baseCost / 10) : 5);
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
  if (isSelfTargetingSkill) {
    applySelfSkillEffects(unit, skill, result);
    result.targetId = unit.id;
    if (skill.cooldown && skill.cooldown > 0) {
      unit.skillCooldowns[skillId] = skill.cooldown;
    }
    unit.actUsed = true;
    return result;
  }

  // Handle party-wide healing and buffs. A range of zero means the whole
  // living team; positive ranges limit recipients by distance from the caster.
  if (isAllAlliesTargetingSkill) {
    const recipients = state.units.filter(candidate => {
      if (candidate.hp <= 0 || getUnitTeamId(candidate) !== getUnitTeamId(unit)) {
        return false;
      }
      return skillRange <= 0 ||
        getManhattanDistance(unit.tileX, unit.tileY, candidate.tileX, candidate.tileY) <= skillRange;
    });

    let totalHealing = 0;
    let totalMpRestored = 0;
    const buffEffect = getSkillBuffEffect(skill);

    for (const recipient of recipients) {
      if (skill.healPercent) {
        const healAmount = applyHealingReceivedBonus(
          recipient,
          Math.floor(recipient.maxHp * skill.healPercent / 100)
        );
        const actualHeal = Math.min(healAmount, recipient.maxHp - recipient.hp);
        recipient.hp = Math.min(recipient.maxHp, recipient.hp + healAmount);
        totalHealing += actualHeal;
      }

      if (skill.mpRestore) {
        const mpAmount = Math.floor(recipient.maxMp * skill.mpRestore / 100);
        const actualMpRestore = Math.min(mpAmount, recipient.maxMp - recipient.mp);
        recipient.mp = Math.min(recipient.maxMp, recipient.mp + mpAmount);
        totalMpRestored += actualMpRestore;
      }

      if (skill.cleanse) {
        recipient.statusEffects = (recipient.statusEffects || [])
          .filter(isBeneficialStatusEffect);
        result.skillEffects.push({ type: 'cleanse', targetId: recipient.id });
      }

      if (buffEffect) {
        applySkillBuff(recipient, skill, result);
      }
    }

    unit.healingDone = (unit.healingDone || 0) + totalHealing;
    result.healing = totalHealing;
    result.mpRestored = totalMpRestored;
    result.targetIds = recipients.map(recipient => recipient.id);

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
  if (!target) {
    target = state.units.find(u =>
      u.tileX === targetTile.x && u.tileY === targetTile.y && u.hp > 0
    );
  }

  // Handle ally-targeting skills (heals, buffs)
  if (isAllyTargetingSkill) {
    if (target && skill.healPercent) {
      const healAmount = applyHealingReceivedBonus(
        target,
        Math.floor(target.maxHp * skill.healPercent / 100)
      );
      const actualHeal = Math.min(healAmount, target.maxHp - target.hp);
      target.hp = Math.min(target.maxHp, target.hp + healAmount);
      // Track healing statistics
      unit.healingDone = (unit.healingDone || 0) + actualHeal;
      result.healing = actualHeal;
    }

    if (target && skill.mpRestore) {
      const mpAmount = Math.floor(target.maxMp * skill.mpRestore / 100);
      const actualMpRestore = Math.min(mpAmount, Math.max(0, target.maxMp - target.mp));
      target.mp = Math.min(target.maxMp, target.mp + mpAmount);
      result.mpRestored = actualMpRestore;
    }

    if (target && skill.cleanse) {
      target.statusEffects = (target.statusEffects || [])
        .filter(isBeneficialStatusEffect);
      result.skillEffects.push({ type: 'cleanse', targetId: target.id });
    }

    if (target && getSkillBuffEffect(skill)) {
      applySkillBuff(target, skill, result);
    }

    if (target) {
      result.targetId = target.id;
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

  // Check if this is an AoE skill
  if (skill.aoeRadius && skill.aoeRadius > 0) {
    return processAoESkill(
      state,
      unit,
      targetTile,
      skill,
      skillId,
      result,
      targetingTraversalView
    );
  }

  // Single-target skill
  if (target) {
    return processSingleTargetSkill(state, unit, target, skill, skillId, result);
  }

  // Empty tile skill - animation plays but no damage
  result.attackedEmptyTile = true;
  result.targetTile = targetTile;
  if (hasSelfSkillComponent(skill)) {
    applySelfSkillEffects(unit, skill, result);
  }
  if (skill.cooldown && skill.cooldown > 0) {
    unit.skillCooldowns[skillId] = skill.cooldown;
  }
  unit.actUsed = true;
  return result;
}

/**
 * Process an AoE skill
 */
function processAoESkill(
  state,
  unit,
  targetTile,
  skill,
  skillId,
  result,
  targetingTraversalView
) {
  const aoeTiles = getAoETiles(
    targetTile.x,
    targetTile.y,
    skill.aoeRadius,
    skill.aoePattern || 'circle'
  ).filter(tile =>
    !targetingTraversalView ||
    isTraversalCellPlayable(targetingTraversalView, tile)
  );

  // Get all units in the AoE area (includes allies - friendly fire!)
  // For offensive skills, exclude the caster to prevent self-damage
  const isOffensiveAoE = hasOffensiveSkillComponent(skill);
  const affectedUnits = getUnitsInAoE(
    state.units,
    targetTile.x,
    targetTile.y,
    skill.aoeRadius,
    skill.aoePattern || 'circle'
  ).filter(({ unit: affectedUnit }) => {
    // Exclude caster from offensive AoE unless skill explicitly includes self
    if (isOffensiveAoE && affectedUnit.id === unit.id && !skill.includesSelf) {
      return false;
    }
    return !targetingTraversalView ||
      isTraversalCellPlayable(targetingTraversalView, {
        x: affectedUnit.tileX,
        y: affectedUnit.tileY
      });
  });

  // Track AoE results
  result.isAoE = true;
  result.aoeTargets = [];
  result.aoeTiles = aoeTiles;

  // Reuse isOffensiveAoE computed above for caster exclusion
  const isOffensive = isOffensiveAoE;
  const appliesBuffInArea = !isOffensive && Boolean(skill.selfBuff);
  const power = skill.power ?? 150;
  const damageType = skill.damageType || 'physical';
  const skillElement = skill.element || null;
  const hits = skill.hits ?? 1;

  let totalAoEDamage = 0;
  result.element = skillElement;

  for (const { unit: affectedUnit, isCenter } of affectedUnits) {
    const targetResult = {
      targetId: affectedUnit.id,
      targetName: affectedUnit.name,
      targetType: affectedUnit.type,
      isCenter,
      tileX: affectedUnit.tileX,
      tileY: affectedUnit.tileY,
      element: skillElement,
    };

    if (isOffensive) {
      // Check hit for offensive targets (evasion, Blind, skill accuracy)
      const isTargetEnemy = getUnitTeamId(affectedUnit) !== getUnitTeamId(unit);
      if (isTargetEnemy) {
        const skillAccuracy = skill.accuracy ?? 1;
        const didHit = checkHit(unit, affectedUnit, { accuracyMultiplier: skillAccuracy });
        if (!didHit) {
          targetResult.missed = true;
          targetResult.damage = 0;
          result.aoeTargets.push(targetResult);
          continue;
        }
      }

      const damageResult = damageType === 'magical'
        ? calculateMagicalDamage(unit, affectedUnit, power, skillElement)
        : calculatePhysicalDamage(unit, affectedUnit, power, skillElement);

      targetResult.elementalModifier = damageResult.elementalModifier;

      // Handle absorb (element heals instead of damages)
      if (damageResult.isAbsorb) {
        const healAmount = applyHealingReceivedBonus(
          affectedUnit,
          damageResult.damage
        );
        affectedUnit.hp = Math.min(affectedUnit.maxHp, affectedUnit.hp + healAmount);
        targetResult.healing = healAmount;
        targetResult.isAbsorb = true;
      } else {
        const totalIncomingDamage = Math.floor(
          damageResult.damage * hits * (isCenter ? 1 : 0.75)
        );
        const damagePerHit = Math.floor(totalIncomingDamage / hits);
        let remainder = totalIncomingDamage % hits;
        const hitResults = [];
        for (let hitIndex = 0;
          hitIndex < hits && affectedUnit.hp > 0;
          hitIndex++) {
          const incomingDamage = damagePerHit + (remainder-- > 0 ? 1 : 0);
          hitResults.push({
            hit: hitIndex + 1,
            ...applyDamageInstance(unit, affectedUnit, incomingDamage)
          });
        }
        const totalDamage = hitResults.reduce(
          (sum, hitResult) => sum + hitResult.damage,
          0
        );

        totalAoEDamage += totalDamage;
        targetResult.damage = totalDamage;
        targetResult.incomingDamage = hitResults.reduce(
          (sum, hitResult) => sum + hitResult.incomingDamage,
          0
        );
        targetResult.hitResults = hitResults;
        targetResult.blockedHits = hitResults.filter(
          hitResult => hitResult.blocked
        ).length;
        targetResult.isCritical = damageResult.isCritical;
        targetResult.deathSaveTrigger = hitResults.some(
          hitResult => hitResult.deathSaveTrigger
        );
      }
    }

    // Support-only radial buffs affect living teammates in the area, without
    // sending the skill through a damage formula.
    if (appliesBuffInArea &&
        getUnitTeamId(affectedUnit) === getUnitTeamId(unit)) {
      if (applySkillBuff(affectedUnit, skill, result)) {
        targetResult.effectApplied = getSkillBuffEffect(skill);
      }
    }

    // Apply status effect if skill has one and chance succeeds
    // For debuffs on enemies, apply status resistance
    if (skill.effect &&
        skill.effect !== 'heal' &&
        !isSkillEffectHandledAsBuff(skill)) {
      const isDebuff = getUnitTeamId(affectedUnit) !== getUnitTeamId(unit);
      const baseChance = skill.effectChance ?? 1;
      const effectiveChance = isDebuff
        ? calculateEffectiveStatusChance(baseChance, affectedUnit, affectedUnit.statusResist || 0)
        : baseChance;

      if (Math.random() < effectiveChance) {
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
      } else if (isDebuff && effectiveChance < baseChance) {
        // Target resisted the effect
        targetResult.effectResisted = skill.effect;
        result.skillEffects.push({
          type: 'resisted',
          effect: skill.effect,
          targetId: affectedUnit.id
        });
      }
    }

    result.aoeTargets.push(targetResult);
  }

  // Apply lifesteal for total AoE damage dealt
  const lifestealAmount = applyHealingReceivedBonus(
    unit,
    traitService.calculateLifesteal(unit, totalAoEDamage)
  );
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

  if (hasSelfSkillComponent(skill)) {
    // A support-only radial buff already included the caster in its recipients.
    applySelfSkillEffects(unit, skill, result, !appliesBuffInArea);
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
  const isOffensive = hasOffensiveSkillComponent(skill);
  const power = skill.power ?? 150;
  const damageType = skill.damageType || 'physical';
  const skillElement = skill.element || null;

  result.element = skillElement;
  result.targetId = target.id;
  result.targetType = target.type;

  // Damage-free debuffs (fear, freeze, weaken, taunt, and similar skills)
  // still consume the action and can apply their status, but must not fall
  // through to the legacy 150-power damage default.
  if (!isOffensive) {
    result.damage = 0;

    if (hasSelfSkillComponent(skill)) {
      applySelfSkillEffects(unit, skill, result);
    }

    // Apply status effect if skill has one and chance succeeds
    // For debuffs on enemies, apply status resistance
    if (skill.effect &&
        skill.effect !== 'heal' &&
        !isSkillEffectHandledAsBuff(skill)) {
      const isDebuff = getUnitTeamId(target) !== getUnitTeamId(unit);
      const baseChance = skill.effectChance ?? 1;
      const effectiveChance = isDebuff
        ? calculateEffectiveStatusChance(baseChance, target, target.statusResist || 0)
        : baseChance;

      if (Math.random() < effectiveChance) {
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
      } else if (isDebuff && effectiveChance < baseChance) {
        // Target resisted the effect
        result.effectResisted = skill.effect;
        result.skillEffects.push({
          type: 'resisted',
          effect: skill.effect,
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

  // Check hit for offensive single-target skills (evasion, Blind, skill accuracy)
  const isTargetEnemy = getUnitTeamId(target) !== getUnitTeamId(unit);
  if (isTargetEnemy) {
    const skillAccuracy = skill.accuracy ?? 1;
    const didHit = checkHit(unit, target, { accuracyMultiplier: skillAccuracy });
    if (!didHit) {
      result.missed = true;
      result.damage = 0;
      result.targetId = target.id;
      result.targetType = target.type;
      if (skill.cooldown && skill.cooldown > 0) {
        unit.skillCooldowns[skillId] = skill.cooldown;
      }
      unit.actUsed = true;
      return result;
    }
  }

  const damageResult = damageType === 'magical'
    ? calculateMagicalDamage(unit, target, power, skillElement)
    : calculatePhysicalDamage(unit, target, power, skillElement);

  result.elementalModifier = damageResult.elementalModifier;

  // Handle absorb (element heals instead of damages)
  if (damageResult.isAbsorb) {
    const healAmount = applyHealingReceivedBonus(target, damageResult.damage);
    target.hp = Math.min(target.maxHp, target.hp + healAmount);
    result.healing = healAmount;
    result.isAbsorb = true;
    result.targetId = target.id;
    result.targetType = target.type;
    if (hasSelfSkillComponent(skill)) {
      applySelfSkillEffects(unit, skill, result);
    }
    if (skill.cooldown && skill.cooldown > 0) {
      unit.skillCooldowns[skillId] = skill.cooldown;
    }
    unit.actUsed = true;
    return result;
  }

  // Apply each hit independently so Moonshield blocks exactly one instance.
  const hits = skill.hits || 1;
  const hitResults = [];
  for (let hitIndex = 0; hitIndex < hits && target.hp > 0; hitIndex++) {
    hitResults.push({
      hit: hitIndex + 1,
      ...applyDamageInstance(unit, target, damageResult.damage)
    });
  }
  const totalDamage = hitResults.reduce(
    (sum, hitResult) => sum + hitResult.damage,
    0
  );
  if (hitResults.some(hitResult => hitResult.deathSaveTrigger)) {
    result.deathSaveTrigger = true;
    result.deathSaveUnitId = target.id;
  }

  result.damage = totalDamage;
  result.incomingDamage = hitResults.reduce(
    (sum, hitResult) => sum + hitResult.incomingDamage,
    0
  );
  result.hits = hitResults.length;
  result.attemptedHits = hits;
  result.hitResults = hitResults;
  result.blockedHits = hitResults.filter(hitResult => hitResult.blocked).length;
  result.isCritical = damageResult.isCritical;
  result.targetId = target.id;
  result.targetType = target.type;

  // Apply lifesteal trait
  const lifestealAmount = applyHealingReceivedBonus(
    unit,
    traitService.calculateLifesteal(unit, totalDamage)
  );
  if (lifestealAmount > 0) {
    unit.hp = Math.min(unit.maxHp, unit.hp + lifestealAmount);
    result.lifestealAmount = lifestealAmount;
  }

  if (hasSelfSkillComponent(skill)) {
    applySelfSkillEffects(unit, skill, result);
  }

  // Apply status effect if skill has one and chance succeeds
  // For debuffs on enemies, apply status resistance
  if (skill.effect &&
      skill.effect !== 'heal' &&
      !isSkillEffectHandledAsBuff(skill)) {
    const isDebuff = getUnitTeamId(target) !== getUnitTeamId(unit);
    const baseChance = skill.effectChance ?? 1;
    const effectiveChance = isDebuff
      ? calculateEffectiveStatusChance(baseChance, target, target.statusResist || 0)
      : baseChance;

    if (Math.random() < effectiveChance) {
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
    } else if (isDebuff && effectiveChance < baseChance) {
      // Target resisted the effect
      result.effectResisted = skill.effect;
      result.skillEffects.push({
        type: 'resisted',
        effect: skill.effect,
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
    const boostedEffectValue = applyHealingReceivedBonus(itemTarget, effectValue);
    const healAmount = Math.min(boostedEffectValue, itemTarget.maxHp - itemTarget.hp);
    itemTarget.hp = Math.min(itemTarget.maxHp, itemTarget.hp + boostedEffectValue);
    // Track healing statistics
    unit.healingDone = (unit.healingDone || 0) + healAmount;
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
    const boostedEffectValue = applyHealingReceivedBonus(itemTarget, effectValue);
    const healAmount = Math.min(boostedEffectValue, itemTarget.maxHp - itemTarget.hp);
    const mpAmount = Math.min(Math.floor(effectValue / 2), itemTarget.maxMp - itemTarget.mp);
    itemTarget.hp = Math.min(itemTarget.maxHp, itemTarget.hp + boostedEffectValue);
    itemTarget.mp = Math.min(itemTarget.maxMp, itemTarget.mp + Math.floor(effectValue / 2));
    // Track healing statistics
    unit.healingDone = (unit.healingDone || 0) + healAmount;
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
    const reviveHp = applyHealingReceivedBonus(
      itemTarget,
      Math.floor(itemTarget.maxHp * revivePercent / 100)
    );
    itemTarget.hp = reviveHp;
    // Track healing statistics (revive counts as healing)
    unit.healingDone = (unit.healingDone || 0) + reviveHp;
    // Reset death counter since unit was revived
    itemTarget.deaths = 0;
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
  result.availableActions = {
    canMove,
    canAct,
    canWait: true,
    turnPhase: unit.turnPhase
  };

  return result;
}

/**
 * Get a unit's team ID with fallback for backwards compatibility
 * @param {Object} unit - BattleUnit
 * @returns {number} Team ID (1 or 2)
 */
export function getUnitTeamId(unit) {
  if (unit.teamId !== undefined) {
    return unit.teamId;
  }
  // Fallback: type 'enemy' implies team 2, all others imply team 1
  return unit.type === 'enemy' ? 2 : 1;
}

/**
 * Check if battle has ended using team-based victory conditions
 * Supports both PvE (type-based fallback) and PvP (team-based)
 *
 * Returns a result object with:
 *   - status: 'active' | 'ended'
 *   - winningTeamId: 1 | 2 (only when status is 'ended')
 *
 * The result object also has a valueOf() method for backwards compatibility:
 *   - Returns 'active' when battle continues
 *   - Returns 'victory' when team 1 wins (player team in PvE)
 *   - Returns 'defeat' when team 2 wins (enemy team in PvE)
 *
 * This allows existing code like `if (result === 'active')` to still work,
 * while new code can use `result.status` and `result.winningTeamId`.
 *
 * Mutual knockout handling:
 *   - In PvE: Team 2 (enemies) wins by default (player defeat).
 *   - In PvP: The acting team loses (opponent wins). If actingTeamId is provided
 *     and battleType is 'pvp' or 'pvp_coliseum', the opponent wins.
 *
 * @param {Object} state - Battle state
 * @param {Object} options - Optional parameters
 * @param {number} options.actingTeamId - Team ID of the unit whose action caused the double KO
 * @returns {Object} Battle end status with backwards-compatible valueOf()
 */
export function checkBattleEnd(state, { actingTeamId } = {}) {
  // Count alive units per team
  const team1Alive = state.units.filter(u => u.hp > 0 && getUnitTeamId(u) === 1).length;
  const team2Alive = state.units.filter(u => u.hp > 0 && getUnitTeamId(u) === 2).length;

  if (team2Alive === 0 && team1Alive > 0) {
    return createBattleEndResult('ended', 1);
  }
  if (team1Alive === 0 && team2Alive > 0) {
    return createBattleEndResult('ended', 2);
  }
  // Mutual knockout: both teams wiped out at the same time
  // Only applies when there were units on both teams (not empty array scenario)
  if (team1Alive === 0 && team2Alive === 0 && state.units.length > 0) {
    // Check that both teams actually had units to begin with
    const hadTeam1 = state.units.some(u => getUnitTeamId(u) === 1);
    const hadTeam2 = state.units.some(u => getUnitTeamId(u) === 2);
    if (hadTeam1 && hadTeam2) {
      // In PvP (pvp or pvp_coliseum), the acting team loses - opponent wins
      const isPvP = state.battleType === 'pvp' || state.battleType === 'pvp_coliseum';
      if (isPvP && actingTeamId !== undefined) {
        // Acting team caused mutual destruction, so opponent wins
        const winningTeamId = actingTeamId === 1 ? 2 : 1;
        return createBattleEndResult('ended', winningTeamId);
      }
      // PvE: team 2 wins (player defeat)
      return createBattleEndResult('ended', 2);
    }
  }

  return createBattleEndResult('active', null);
}

/**
 * Create a battle end result object with backwards-compatible valueOf()
 * @param {string} status - 'active' | 'ended'
 * @param {number|null} winningTeamId - 1 | 2 | null
 * @returns {Object} Result object with valueOf() for string comparison
 */
function createBattleEndResult(status, winningTeamId) {
  const result = {
    status,
    winningTeamId,
    // valueOf() enables backwards-compatible string comparisons
    // e.g., `if (checkBattleEnd(state) === 'active')` still works
    valueOf() {
      if (status === 'active') return 'active';
      // For backwards compatibility: team 1 win = 'victory', team 2 win = 'defeat'
      return winningTeamId === 1 ? 'victory' : 'defeat';
    },
    // toString() for consistent string representation
    toString() {
      return this.valueOf();
    }
  };
  return result;
}

/**
 * Get the legacy status string from a battle end result
 * For backwards compatibility with code expecting 'active', 'victory', or 'defeat'
 * @param {Object} result - Result from checkBattleEnd()
 * @returns {string} 'active' | 'victory' | 'defeat'
 */
export function getBattleStatusString(result) {
  if (!result || result.status === 'active') {
    return 'active';
  }
  // Team 1 win = 'victory' (player team in PvE)
  // Team 2 win = 'defeat' (enemy team in PvE)
  return result.winningTeamId === 1 ? 'victory' : 'defeat';
}
