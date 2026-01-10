/**
 * Action Generator - Enumerates all legal actions for a unit
 *
 * Generates the complete action space for AI decision making,
 * including moves, attacks, skills, and composite actions.
 */

import { getReachableTiles, getAvailableActions, getTargetsInRange } from '../battleService.js';
import { canUseSkill } from '../npcSkillService.js';

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
      const skill = unit.skills?.find(s => s.id === skillInfo.id);
      if (!skill) continue;

      // Check if skill can be used
      const { canUse } = canUseSkill(unit, skill);
      if (!canUse) continue;

      // Self-targeting skills
      if (skill.range === 0 || skill.selfBuff || skill.healPercent) {
        actions.push({
          type: 'skill',
          skill: skill,
          skillId: skill.id,
          target: unit,
          targetId: unit.id
        });
        continue;
      }

      // Skills with targets
      if (skillInfo.targets) {
        for (const target of skillInfo.targets) {
          actions.push({
            type: 'skill',
            skill: skill,
            skillId: skill.id,
            target: target,
            targetId: target.id
          });
        }
      }
    }
  }

  // Generate item actions (NPCs can use items too)
  if (available.canAct && available.items && available.items.length > 0) {
    for (const item of available.items) {
      // Self-use healing/MP items when low
      if (item.effectType === 'hp_restore' || item.effectType === 'mp_restore' || item.effectType === 'elixir') {
        actions.push({
          type: 'item',
          item: item,
          itemId: item.itemId,
          target: {
            x: unit.tileX,
            y: unit.tileY,
            unitId: unit.id,
            unitName: unit.name
          },
          targetId: unit.id
        });
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

  // If can't move, just return single actions
  if (!available.canMove || !available.movement.reachableTiles) {
    const singleActions = generateAllActions(unit, state);
    return singleActions.map(action => [action]);
  }

  // For each reachable tile, generate actions from that position
  for (const tile of available.movement.reachableTiles) {
    // Create hypothetical state with unit at new position
    const hypoUnit = {
      ...unit,
      tileX: tile.x,
      tileY: tile.y,
      moveUsed: true  // Mark move as used
    };

    // Generate actions from this position
    const actionsFromPos = generateActionsAtPosition(hypoUnit, state);

    for (const action of actionsFromPos) {
      if (tile.x === unit.tileX && tile.y === unit.tileY) {
        // No move needed, just the action
        sequences.push([action]);
      } else {
        // Move then action
        sequences.push([
          { type: 'move', position: { x: tile.x, y: tile.y }, cost: tile.cost },
          action
        ]);
      }
    }
  }

  // Also add pure movement options
  for (const tile of available.movement.reachableTiles) {
    if (tile.x === unit.tileX && tile.y === unit.tileY) continue;
    sequences.push([
      { type: 'move', position: { x: tile.x, y: tile.y }, cost: tile.cost }
    ]);
  }

  // Add wait option
  sequences.push([{ type: 'wait' }]);

  return sequences;
}

/**
 * Generate actions available from a specific position (hypothetical)
 * @param {Object} unit - Unit at hypothetical position
 * @param {Object} state - Battle state
 * @returns {Array} Actions available from that position
 */
function generateActionsAtPosition(unit, state) {
  const actions = [];
  const enemyType = unit.type === 'player' ? 'enemy' : 'player';
  const allyType = unit.type;

  // Generate attacks from this position
  const attackRange = unit.attackRange || 1;
  const attackTargets = getTargetsFromPosition(
    unit.tileX, unit.tileY, attackRange, state, enemyType
  );

  for (const target of attackTargets) {
    // Normalize target format to match getTargetsInRange: {x, y, unitId, unitName}
    actions.push({
      type: 'attack',
      target: {
        x: target.tileX,
        y: target.tileY,
        unitId: target.id,
        unitName: target.name
      },
      targetId: target.id
    });
  }

  // Generate skill actions from this position
  for (const skill of (unit.skills || [])) {
    const { canUse } = canUseSkill(unit, skill);
    if (!canUse) continue;

    // Self-targeting skills
    if (skill.range === 0 || skill.selfBuff || skill.healPercent) {
      actions.push({
        type: 'skill',
        skill: skill,
        skillId: skill.id,
        target: unit,
        targetId: unit.id
      });
      continue;
    }

    // Determine target type for skill
    const skillTargetType = isHealingSkill(skill) ? allyType : enemyType;
    const skillTargets = getTargetsFromPosition(
      unit.tileX, unit.tileY, skill.range, state, skillTargetType
    );

    for (const target of skillTargets) {
      // Normalize target format to match getTargetsInRange: {x, y, unitId, unitName}
      actions.push({
        type: 'skill',
        skill: skill,
        skillId: skill.id,
        target: {
          x: target.tileX,
          y: target.tileY,
          unitId: target.id,
          unitName: target.name
        },
        targetId: target.id
      });
    }
  }

  // If no attack/skill options, add wait
  if (actions.length === 0) {
    actions.push({ type: 'wait' });
  }

  return actions;
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
function orderActionsForPruning(actions, unit) {
  // Sort: attacks > skills > moves > wait
  // Within each category, prefer higher impact
  return actions.sort((a, b) => {
    const typeOrder = { attack: 3, skill: 2, move: 1, wait: 0 };
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
  const enemyType = unit.type === 'player' ? 'enemy' : 'player';
  const threats = [];

  for (const enemy of state.units) {
    if (enemy.type !== enemyType || enemy.hp <= 0) continue;

    const dx = Math.abs(enemy.tileX - unit.tileX);
    const dy = Math.abs(enemy.tileY - unit.tileY);
    const distance = dx + dy; // Manhattan distance (matches battleService)

    // Enemy can attack us
    const attackRange = enemy.attackRange || 1;
    if (distance <= attackRange) {
      threats.push(enemy);
      continue;
    }

    // Enemy can move and attack us
    const enemyMovement = enemy.movement || 3;
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
