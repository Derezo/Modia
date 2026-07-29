/**
 * Action Generator - Enumerates all legal actions for a unit
 *
 * Generates the complete action space for AI decision making,
 * including moves, attacks, skills, and composite actions.
 *
 * AUTO-BATTLE COMPATIBILITY NOTE:
 * This module is unit-type agnostic and will work for player auto-battle.
 * Item availability is determined by getAvailableActions() in actionProcessor.js,
 * which handles the storage location difference:
 *   - Player items: state.consumables (shared party pool)
 *   - NPC items: unit.consumables (per-unit storage)
 *
 * To enable player auto-battle, simply invoke the AI system for player units.
 * No changes to this file are required.
 */

import { getAvailableActions } from '../battleService.js';
import {
  canUseSkill,
  normalizeLegacyNpcSkill,
  isExecutableLegacyNpcSkill
} from '../npcSkillService.js';
import { getUnitsInAoE } from '../battle/aoeService.js';
import {
  isBeneficialStatusEffect,
  CURE_POISON_EFFECTS,
  CURE_ALL_EFFECTS
} from '../../../../shared/battleMath.js';

/**
 * Generate all possible actions for a unit
 * @param {Object} unit - The acting unit
 * @param {Object} state - Current battle state
 * @returns {Array} Array of action objects
 */
function generateAllActions(unit, state) {
  const actions = [];

  // Get available actions from battle service
  const available = getAvailableActions(unit, state);

  // Generate movement actions
  if (available.canMove && available.movement.reachableTiles) {
    for (const tile of available.movement.reachableTiles) {
      // Skip current position
      if (tile.x === unit.tileX && tile.y === unit.tileY) continue;

      actions.push({
        type: 'move',
        position: { x: tile.x, y: tile.y },
        cost: tile.cost
      });
    }
  }

  // Generate attack actions
  if (available.canAct && available.attacks.targets) {
    for (const target of available.attacks.targets) {
      actions.push({
        type: 'attack',
        target: target,
        targetId: target.unitId  // battleService returns unitId, not id
      });
    }
  }

  // Generate skill actions
  if (available.canAct && available.skills) {
    for (const skillInfo of available.skills) {
      const unitSkill = unit.skills?.find(s => s.id === skillInfo.id);
      if (!unitSkill) continue;
      const skill = normalizeLegacyNpcSkill(unitSkill);
      if (!isExecutableLegacyNpcSkill(skill)) continue;

      // Check if skill can be used
      const { canUse } = canUseSkill(unit, skill);
      if (!canUse) continue;

      const targetMode = getSkillTargetMode(skill);

      if (targetMode === 'self') {
        if (!isUsefulSkillTarget(skill, unit)) continue;

        actions.push({
          type: 'skill',
          skill: skill,
          skillId: skill.id,
          target: unit,
          targetId: unit.id
        });
        continue;
      }

      if (targetMode === 'caster-area') {
        if (!hasDamageSkillComponent(skill) && skill.selfBuff) {
          const battleUnits = state.units.map(candidate =>
            candidate.id === unit.id ? unit : candidate
          );
          const affectedAllies = getUnitsInAoE(
            battleUnits,
            unit.tileX,
            unit.tileY,
            skill.aoeRadius,
            skill.aoePattern || 'circle'
          )
            .map(({ unit: affectedUnit }) => affectedUnit)
            .filter(affectedUnit => isSameTeam(unit, affectedUnit));

          if (!isUsefulGroupSkill(skill, affectedAllies)) continue;
        }

        const aoeCenter = { x: unit.tileX, y: unit.tileY };
        actions.push({
          type: 'skill',
          skill: skill,
          skillId: skill.id,
          // Keep the cast center distinct from a damage target. Caster-centered
          // AoEs include the caster through their affected area, not because
          // the caster is the primary target.
          target: aoeCenter,
          aoeCenter
        });
        continue;
      }

      const targets = (skillInfo.targets || [])
        .map(target => ({
          descriptor: target,
          unit: resolveTargetUnit(target, state, unit)
        }))
        .filter(({ unit: target }) => target && isSameTeam(unit, target));

      if (targetMode === 'all-allies') {
        const skillRange = skill.range ?? 1;
        const affectedAllies = state.units
          .filter(target => target.hp > 0 && isSameTeam(unit, target))
          .map(target => target.id === unit.id ? unit : target)
          .filter(target => skillRange <= 0 ||
            getDistance(unit, target) <= skillRange);
        if (!isUsefulGroupSkill(skill, affectedAllies)) continue;

        // A group skill is one cast, regardless of the number of affected allies.
        actions.push({
          type: 'skill',
          skill: skill,
          skillId: skill.id,
          target: unit,
          targetId: unit.id
        });
        continue;
      }

      const candidateTargets = targetMode === 'ally'
        ? targets
        : (skillInfo.targets || []).map(target => ({
          descriptor: target,
          unit: resolveTargetUnit(target, state, unit)
        }));

      for (const { descriptor, unit: target } of candidateTargets) {
        if (!target || !isUsefulSkillTarget(skill, target)) continue;

        const aoeCenter = skill.aoeRadius > 0
          ? {
            x: descriptor.x ?? target.tileX,
            y: descriptor.y ?? target.tileY
          }
          : null;
        actions.push({
          type: 'skill',
          skill: skill,
          skillId: skill.id,
          target: descriptor,
          targetId: descriptor.unitId || descriptor.id,
          ...(aoeCenter ? { aoeCenter } : {})
        });
      }
    }
  }

  // Generate item actions (NPCs can use items too)
  if (available.canAct && available.items && available.items.length > 0) {
    const battleUnits = state.units
      .map(candidate => candidate.id === unit.id ? unit : candidate);
    const allies = battleUnits.filter(u => isSameTeam(unit, u) && u.hp > 0);
    const deadAllies = battleUnits.filter(u => isSameTeam(unit, u) && u.hp <= 0);

    for (const item of available.items) {
      if (item.quantity <= 0) continue;

      if (item.effectType === 'heal_hp' || item.effectType === 'heal_both') {
        // Dual-restoration items are useful when either resource is missing,
        // but still produce only one action per target.
        for (const ally of allies) {
          const needsHp = ally.hp < ally.maxHp;
          const needsMp = item.effectType === 'heal_both' &&
            (ally.mp ?? 0) < (ally.maxMp ?? 0);
          if (!needsHp && !needsMp) continue;
          actions.push({
            type: 'item',
            item: item,
            itemId: item.itemId,
            target: { x: ally.tileX, y: ally.tileY, unitId: ally.id, unitName: ally.name },
            targetId: ally.id
          });
        }
      }

      if (item.effectType === 'heal_mp') {
        // Target self and allies with MP deficit
        for (const ally of allies) {
          if (ally.mp >= ally.maxMp) continue;
          actions.push({
            type: 'item',
            item: item,
            itemId: item.itemId,
            target: { x: ally.tileX, y: ally.tileY, unitId: ally.id, unitName: ally.name },
            targetId: ally.id
          });
        }
      }

      if (item.effectType === 'cure_poison' || item.effectType === 'cure_all') {
        // Only generate if an ally has cleansable status effects
        const cleansable = item.effectType === 'cure_poison' ? CURE_POISON_EFFECTS : CURE_ALL_EFFECTS;
        for (const ally of allies) {
          const hasCleansable = (ally.statusEffects || []).some(e => cleansable.includes(e.type));
          if (!hasCleansable) continue;
          actions.push({
            type: 'item',
            item: item,
            itemId: item.itemId,
            target: { x: ally.tileX, y: ally.tileY, unitId: ally.id, unitName: ally.name },
            targetId: ally.id
          });
        }
      }

      if (item.effectType === 'revive') {
        // Target dead allies
        for (const ally of deadAllies) {
          actions.push({
            type: 'item',
            item: item,
            itemId: item.itemId,
            target: { x: ally.tileX, y: ally.tileY, unitId: ally.id, unitName: ally.name },
            targetId: ally.id
          });
        }
      }
    }
  }

  // Always add wait option
  actions.push({ type: 'wait' });

  return actions;
}

/**
 * Generate composite move+action sequences
 * @param {Object} unit - The acting unit
 * @param {Object} state - Current battle state
 * @returns {Array} Array of composite action sequences
 */
function generateMoveActionSequences(unit, state) {
  const sequences = [];
  const available = getAvailableActions(unit, state);
  const currentActions = available.canAct
    ? generateActionsAtPosition(unit, state)
    : [];

  // Acting without moving is always a complete legal option.
  for (const action of currentActions) {
    sequences.push([action]);
  }

  if (available.canMove && available.movement?.reachableTiles) {
    for (const tile of available.movement.reachableTiles) {
      if (tile.x === unit.tileX && tile.y === unit.tileY) continue;

      const moveAction = {
        type: 'move',
        position: { x: tile.x, y: tile.y },
        cost: tile.cost
      };

      // Pure movement is a complete legal option.
      sequences.push([moveAction]);

      if (available.canAct) {
        const hypoUnit = {
          ...unit,
          tileX: tile.x,
          tileY: tile.y,
          moveUsed: true
        };

        for (const action of generateActionsAtPosition(hypoUnit, state)) {
          // Normal move followed by the act.
          sequences.push([moveAction, action]);
        }
      }
    }
  }

  for (const action of currentActions) {
    // A movement skill changes the actor's position, so a normal move cannot
    // safely be planned from the original tile afterward.
    if (action.type === 'skill' && action.skill?.movement) continue;

    const postActionUnit = getUnitAfterAction(unit, action);
    const postActionAvailable = getAvailableActions(postActionUnit, state);
    if (!postActionAvailable.canMove ||
        !postActionAvailable.movement?.reachableTiles) continue;

    for (const tile of postActionAvailable.movement.reachableTiles) {
      if (tile.x === unit.tileX && tile.y === unit.tileY) continue;

      sequences.push([
        action,
        {
          type: 'move',
          position: { x: tile.x, y: tile.y },
          cost: tile.cost
        }
      ]);
    }
  }

  // Add wait option
  sequences.push([{ type: 'wait' }]);

  return deduplicateSequences(sequences);
}

/**
 * Generate actions available from a specific position (hypothetical)
 * @param {Object} unit - Unit at hypothetical position
 * @param {Object} state - Battle state
 * @returns {Array} Actions available from that position
 */
function generateActionsAtPosition(unit, state) {
  return generateAllActions(unit, state).filter(action =>
    action.type === 'attack' || action.type === 'skill' || action.type === 'item'
  );
}

function getUnitTeamId(unit) {
  return unit.teamId !== undefined ? unit.teamId : (unit.type === 'enemy' ? 2 : 1);
}

function isSameTeam(unit, other) {
  return getUnitTeamId(unit) === getUnitTeamId(other);
}

function resolveTargetUnit(target, state, fallbackUnit) {
  const targetId = target?.unitId || target?.id;
  if (targetId === fallbackUnit.id) return fallbackUnit;

  return state.units.find(candidate =>
    candidate.id === targetId ||
    (candidate.tileX === target?.x && candidate.tileY === target?.y)
  );
}

function getDistance(first, second) {
  return Math.abs(first.tileX - second.tileX) +
    Math.abs(first.tileY - second.tileY);
}

function getUnitAfterAction(unit, action) {
  let statusEffects = [...(unit.statusEffects || [])];
  const affectsActor = action.targetId === unit.id ||
    action.skill?.targetAllAllies === true ||
    Boolean(action.skill?.selfBuff) ||
    (action.skill?.healPercent > 0 &&
      action.skill?.targetAlly !== true &&
      action.skill?.targetAllAllies !== true);

  if (affectsActor && action.type === 'skill') {
    if (action.skill.cleanse) {
      statusEffects = statusEffects.filter(isBeneficialStatusEffect);
    }

    const effect = typeof action.skill.selfBuff === 'string'
      ? action.skill.selfBuff
      : action.skill.effect;
    if ((effect === 'haste' || effect === 'slow') &&
        (action.skill.effectChance ?? 1) >= 1 &&
        !statusEffects.some(status => status.type === effect)) {
      statusEffects.push({ type: effect, duration: action.skill.effectDuration || 1 });
    }
  }

  if (affectsActor && action.type === 'item' &&
      (action.item.effectType === 'cure_poison' ||
       action.item.effectType === 'cure_all')) {
    const cleansable = action.item.effectType === 'cure_poison'
      ? CURE_POISON_EFFECTS
      : CURE_ALL_EFFECTS;
    statusEffects = statusEffects.filter(effect => !cleansable.includes(effect.type));
  }

  return {
    ...unit,
    actUsed: true,
    statusEffects
  };
}

function hasDamageSkillComponent(skill) {
  return Number(skill?.power) > 0 &&
    skill?.targetSelf !== true &&
    skill?.targetAlly !== true &&
    skill?.targetAllAllies !== true &&
    skill?.damageType !== 'support' &&
    skill?.damageType !== 'heal' &&
    skill?.effect !== 'heal';
}

function getSkillTargetMode(skill) {
  if (skill.targetAllAllies === true) return 'all-allies';
  if (skill.targetAlly === true) return 'ally';
  if (skill.targetSelf === true) return 'self';
  if (skill.range === 0 && skill.aoeRadius > 0) return 'caster-area';
  if (!hasDamageSkillComponent(skill) &&
      (skill.selfBuff || skill.cleanse || skill.mpRestore || isHealingSkill(skill))) {
    return 'self';
  }
  return 'enemy';
}

const SKILL_METADATA_KEYS = new Set([
  'id', 'name', 'description', 'type', 'level', 'currentLevel', 'maxLevel',
  'baseCost', 'requires', 'range', 'mpCost', 'mp_cost', 'cooldown',
  'currentCooldown', 'priority', 'source', 'branch', 'visualCategory', 'icon',
  'animation', 'animationConfig', 'sound', 'element', 'aoeRadius', 'targetSelf',
  'targetAlly', 'targetAllAllies', 'targetType', 'healPercent', 'damageType', 'effect',
  'effectChance', 'effectDuration', 'buffDuration', 'power', 'scaling',
  'selfBuff', 'cleanse', 'mpRestore', 'movement'
]);

function hasUnrecognizedUtility(skill) {
  return Object.entries(skill).some(([key, value]) =>
    !SKILL_METADATA_KEYS.has(key) &&
    value !== undefined &&
    value !== null &&
    value !== false &&
    value !== 0
  );
}

function getPureBuffEffect(skill) {
  let effect = null;
  if (typeof skill.selfBuff === 'string') {
    effect = skill.selfBuff;
  } else if (skill.selfBuff && typeof skill.selfBuff === 'object') {
    effect = skill.selfBuff.type || `${skill.id || 'skill'}_buff`;
  } else if (typeof skill.effect === 'string' && skill.effect !== 'heal') {
    effect = skill.effect;
  }

  if (!effect || skill.healPercent > 0 || hasDamageSkillComponent(skill) ||
      skill.cleanse || skill.mpRestore || skill.movement ||
      hasUnrecognizedUtility(skill)) {
    return null;
  }

  return effect;
}

function hasStatusEffect(unit, effectType) {
  return (unit.statusEffects || []).some(effect =>
    (typeof effect === 'string' ? effect : effect?.type) === effectType
  );
}

function isUsefulSkillTarget(skill, target) {
  // Any offensive, movement, or unknown mechanic can still be valuable even
  // when its restorative component would be wasted.
  if (hasDamageSkillComponent(skill) ||
      skill.movement ||
      hasUnrecognizedUtility(skill)) {
    return true;
  }

  let hasKnownUtility = false;
  let useful = false;

  if (skill.healPercent > 0) {
    hasKnownUtility = true;
    useful ||= target.hp < target.maxHp;
  } else if (skill.damageType === 'heal' || skill.effect === 'heal') {
    // Preserve healing mechanics whose amount is supplied outside healPercent.
    return true;
  }

  if (skill.mpRestore > 0) {
    hasKnownUtility = true;
    useful ||= (target.mp ?? 0) < (target.maxMp ?? 0);
  }

  if (skill.cleanse) {
    hasKnownUtility = true;
    useful ||= (target.statusEffects || []).some(effect =>
      !isBeneficialStatusEffect(effect)
    );
  }

  const buffEffect = getPureBuffEffect({
    ...skill,
    healPercent: 0,
    mpRestore: 0,
    cleanse: false
  });
  if (buffEffect) {
    hasKnownUtility = true;
    useful ||= !hasStatusEffect(target, buffEffect);
  }

  return !hasKnownUtility || useful;
}

function isUsefulGroupSkill(skill, targets) {
  return targets.some(target => isUsefulSkillTarget(skill, target));
}

function getActionKey(action) {
  if (action.type === 'move') {
    return `move:${action.position?.x},${action.position?.y}`;
  }
  if (action.type === 'skill') {
    const center = action.aoeCenter
      ? `:${action.aoeCenter.x},${action.aoeCenter.y}`
      : '';
    return `skill:${action.skillId}:${action.targetId || ''}${center}`;
  }
  if (action.type === 'item') {
    return `item:${action.itemId}:${action.targetId}`;
  }
  if (action.type === 'attack') {
    return `attack:${action.targetId}`;
  }
  return action.type;
}

function deduplicateSequences(sequences) {
  const seen = new Set();
  return sequences.filter(sequence => {
    const key = sequence.map(getActionKey).join('>');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Get targets in range from a position
 * @param {number} fromX - Source X
 * @param {number} fromY - Source Y
 * @param {number} range - Attack/skill range
 * @param {Object} state - Battle state
 * @param {string} targetType - 'player' or 'enemy'
 * @returns {Array} Units in range
 */
function getTargetsFromPosition(fromX, fromY, range, state, targetType) {
  const targets = [];

  for (const unit of state.units) {
    if (unit.type !== targetType || unit.hp <= 0) continue;

    const dx = Math.abs(unit.tileX - fromX);
    const dy = Math.abs(unit.tileY - fromY);
    const distance = dx + dy; // Manhattan distance (matches battleService)

    if (distance > 0 && distance <= range) {
      targets.push(unit);
    }
  }

  return targets;
}

/**
 * Check if a skill is a healing skill
 * @param {Object} skill - Skill to check
 * @returns {boolean}
 */
function isHealingSkill(skill) {
  return skill.healPercent > 0 ||
         skill.damageType === 'heal' ||
         skill.effect === 'heal';
}

/**
 * Prune action list to top N by quick heuristic
 * @param {Array} actions - Full action list
 * @param {number} maxActions - Maximum to keep
 * @returns {Array} Pruned action list
 */
function pruneActions(actions, maxActions = 50) {
  if (actions.length <= maxActions) return actions;

  // Quick heuristic scoring for pruning
  const scored = actions.map(action => ({
    action,
    quickScore: getQuickScore(action)
  }));

  scored.sort((a, b) => b.quickScore - a.quickScore);
  return scored.slice(0, maxActions).map(s => s.action);
}

/**
 * Quick heuristic score for action pruning
 * @param {Object} action - Action to score
 * @returns {number} Quick score
 */
function getQuickScore(action) {
  let score = 0;

  switch (action.type) {
    case 'attack':
      score = 100;
      // Bonus for low HP targets
      if (action.target) {
        const hpPercent = action.target.hp / action.target.maxHp;
        if (hpPercent < 0.3) score += 50;
      }
      break;

    case 'skill':
      score = 80;
      // Bonus for high power skills
      if (action.skill?.power) score += action.skill.power / 5;
      // Bonus for AoE
      if (action.skill?.aoeRadius) score += action.skill.aoeRadius * 20;
      break;

    case 'item':
      score = 70;
      // Bonus for using item on low HP target
      if (action.target) {
        const targetUnit = typeof action.target.hp === 'number' ? action.target : null;
        if (targetUnit && targetUnit.hp / targetUnit.maxHp < 0.3) score += 60;
      }
      // High priority for revive
      if (action.item?.effectType === 'revive') score += 80;
      break;

    case 'move':
      score = 50;
      break;

    case 'wait':
      score = 10;
      break;
  }

  return score;
}

/**
 * Order actions for better alpha-beta pruning
 * @param {Array} actions - Actions to order
 * @param {Object} unit - Acting unit
 * @returns {Array} Ordered actions
 */
function orderActionsForPruning(actions, _unit) {
  // Sort: attacks > skills > moves > wait
  // Within each category, prefer higher impact
  return actions.sort((a, b) => {
    const typeOrder = { attack: 4, skill: 3, item: 2, move: 1, wait: 0 };
    const typeA = typeOrder[a.type] || 0;
    const typeB = typeOrder[b.type] || 0;

    if (typeA !== typeB) return typeB - typeA;

    // Within same type, use quick score
    return getQuickScore(b) - getQuickScore(a);
  });
}

/**
 * Generate immediate threat actions (for defensive AI)
 * @param {Object} unit - Acting unit
 * @param {Object} state - Battle state
 * @returns {Array} Actions that address immediate threats
 */
function generateThreatResponseActions(unit, state) {
  const actions = [];
  const available = getAvailableActions(unit, state);

  // Find immediate threats (enemies that can attack us)
  const threats = findImmediateThreats(unit, state);

  if (threats.length === 0) return [];

  // Attack threats if in range
  if (available.canAct && available.attacks.targets) {
    for (const threat of threats) {
      const inRange = available.attacks.targets.some(t => t.unitId === threat.id);
      if (inRange) {
        actions.push({
          type: 'attack',
          target: threat,
          targetId: threat.id,
          isThreatResponse: true
        });
      }
    }
  }

  // Move away from threats
  if (available.canMove && available.movement.reachableTiles) {
    const safeTiles = findSaferTiles(unit, threats, available.movement.reachableTiles);
    for (const tile of safeTiles.slice(0, 3)) {
      actions.push({
        type: 'move',
        position: { x: tile.x, y: tile.y },
        cost: tile.cost,
        isThreatResponse: true
      });
    }
  }

  return actions;
}

/**
 * Find enemies that can attack this unit
 * @param {Object} unit - Unit to check
 * @param {Object} state - Battle state
 * @returns {Array} Threatening enemy units
 */
function findImmediateThreats(unit, state) {
  const threats = [];

  for (const enemy of state.units) {
    if (isSameTeam(unit, enemy) || enemy.hp <= 0 ||
        enemy.actUsed || enemy.hasActedThisRound) {
      continue;
    }

    const dx = Math.abs(enemy.tileX - unit.tileX);
    const dy = Math.abs(enemy.tileY - unit.tileY);
    const distance = dx + dy; // Manhattan distance (matches battleService)

    // Enemy can attack us
    const attackRange = enemy.attackRange ?? 1;
    if (distance <= attackRange) {
      threats.push(enemy);
      continue;
    }

    // Enemy can move and attack us
    const enemyMovement = enemy.moveUsed ? 0 : (enemy.movement ?? 3);
    if (distance <= attackRange + enemyMovement) {
      threats.push(enemy);
    }
  }

  return threats;
}

/**
 * Find tiles that are safer from threats
 * @param {Object} unit - Unit moving
 * @param {Array} threats - Threat list
 * @param {Array} reachableTiles - Available tiles
 * @returns {Array} Tiles sorted by safety
 */
function findSaferTiles(unit, threats, reachableTiles) {
  const scored = reachableTiles.map(tile => {
    let threatScore = 0;

    for (const threat of threats) {
      const dx = Math.abs(threat.tileX - tile.x);
      const dy = Math.abs(threat.tileY - tile.y);
      const distance = dx + dy; // Manhattan distance (matches battleService)
      threatScore += distance; // Higher distance = safer
    }

    return { ...tile, safetyScore: threatScore };
  });

  return scored.sort((a, b) => b.safetyScore - a.safetyScore);
}

export {
  generateAllActions,
  generateMoveActionSequences,
  generateActionsAtPosition,
  getTargetsFromPosition,
  pruneActions,
  orderActionsForPruning,
  generateThreatResponseActions,
  findImmediateThreats,
  findSaferTiles,
  isHealingSkill
};
