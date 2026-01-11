/**
 * Utility Factor Calculators
 *
 * Functions that calculate individual utility factors for AI decision making.
 * Each factor returns a numeric value that gets multiplied by its weight.
 */

import { calculatePhysicalDamage, calculateMagicalDamage } from '../battleService.js';
import { getManhattanDistance } from '../../../../shared/pathfinding.js';

/**
 * Calculate expected damage from an action
 * @param {Object} attacker - Attacking unit
 * @param {Object} target - Target unit
 * @param {Object} skill - Skill being used (null for basic attack)
 * @param {Object} state - Battle state
 * @returns {number} Expected damage value
 */
function calculateDamageDealt(attacker, target, skill, state) {
  if (!target || target.hp <= 0) return 0;

  let damage;
  if (!skill) {
    // Basic attack - calculatePhysicalDamage returns {damage, isCritical, variance}
    const result = calculatePhysicalDamage(attacker, target, 100);
    damage = result.damage;
  } else {
    const damageType = skill.damageType || 'physical';
    const power = skill.power || 100;

    if (damageType === 'magical' || damageType === 'magic' ||
        damageType === 'fire' || damageType === 'ice' ||
        damageType === 'lightning' || damageType === 'dark') {
      const result = calculateMagicalDamage(attacker, target, power);
      damage = result.damage;
    } else {
      const result = calculatePhysicalDamage(attacker, target, power);
      damage = result.damage;
    }

    // AoE multiplier - value AoE skills hitting multiple targets
    if (skill.aoeRadius && skill.aoeRadius > 0) {
      // Handle both coordinate formats: {x, y} from action targets or {tileX, tileY} from unit objects
      const centerX = target.x ?? target.tileX;
      const centerY = target.y ?? target.tileY;
      if (centerX !== undefined && centerY !== undefined) {
        const potentialTargets = countTargetsInAoe(centerX, centerY, skill.aoeRadius, state, attacker.type);
        damage *= Math.sqrt(potentialTargets); // Diminishing returns for multiple targets
      }
    }
  }

  return Math.max(0, damage);
}

/**
 * Count enemies within AoE radius
 * @param {number} centerX - Center X position
 * @param {number} centerY - Center Y position
 * @param {number} radius - AoE radius
 * @param {Object} state - Battle state
 * @param {string} attackerType - 'player' or 'enemy'
 * @returns {number} Number of targets in range
 */
function countTargetsInAoe(centerX, centerY, radius, state, attackerType) {
  const targetType = attackerType === 'player' ? 'enemy' : 'player';
  let count = 0;

  for (const unit of state.units) {
    if (unit.type !== targetType || unit.hp <= 0) continue;

    const dx = Math.abs(unit.tileX - centerX);
    const dy = Math.abs(unit.tileY - centerY);
    const distance = dx + dy; // Manhattan distance (matches server validation)

    if (distance <= radius) {
      count++;
    }
  }

  return Math.max(1, count);
}

/**
 * Calculate expected damage the unit will receive at a position
 * @param {Object} unit - Unit being evaluated
 * @param {number} tileX - Position X
 * @param {number} tileY - Position Y
 * @param {Object} state - Battle state
 * @returns {number} Expected incoming damage
 */
function calculateDamageReceived(unit, tileX, tileY, state) {
  let totalThreat = 0;
  const enemyType = unit.type === 'player' ? 'enemy' : 'player';

  for (const enemy of state.units) {
    if (enemy.type !== enemyType || enemy.hp <= 0) continue;

    const dx = Math.abs(enemy.tileX - tileX);
    const dy = Math.abs(enemy.tileY - tileY);
    const distance = dx + dy; // Manhattan distance (matches server validation)

    // Basic threat from melee range
    if (distance <= (enemy.attackRange || 1)) {
      const damageResult = calculatePhysicalDamage(enemy, unit, 100);
      totalThreat += damageResult.damage;
    }

    // Additional threat from skills
    for (const skill of (enemy.skills || [])) {
      if (skill.range && distance <= skill.range) {
        const damageResult = calculatePhysicalDamage(enemy, unit, 100);
        const skillDamage = skill.power ? (skill.power / 100) * damageResult.damage : 0;
        // Weight by how likely they are to use this skill
        totalThreat += skillDamage * 0.3;
      }
    }
  }

  return totalThreat;
}

/**
 * Calculate kill potential for an action
 * @param {Object} attacker - Attacking unit
 * @param {Object} target - Target unit
 * @param {Object} skill - Skill being used
 * @param {Object} state - Battle state
 * @returns {number} 1 if lethal, 0 otherwise (can be weighted)
 */
function calculateKillPotential(attacker, target, skill, state) {
  if (!target || target.hp <= 0) return 0;

  const expectedDamage = calculateDamageDealt(attacker, target, skill, state);

  if (expectedDamage >= target.hp) {
    // Bonus scaling with how important the target is
    const targetValue = getTargetValue(target, state);
    return 1.0 + (targetValue / 100);
  }

  // Partial credit for nearly lethal damage
  const damagePercent = expectedDamage / target.maxHp;
  if (damagePercent > 0.5) {
    return damagePercent * 0.5;
  }

  return 0;
}

/**
 * Calculate the tactical value of a position
 * @param {Object} unit - Unit being evaluated
 * @param {number} tileX - Position X
 * @param {number} tileY - Position Y
 * @param {Object} state - Battle state
 * @returns {number} Position quality score (-100 to +100)
 */
function calculatePositionQuality(unit, tileX, tileY, state) {
  let score = 0;

  // Distance to nearest enemy
  const nearestEnemy = findNearestEnemy(unit, tileX, tileY, state);
  if (nearestEnemy) {
    const distance = getManhattanDistance(tileX, tileY, nearestEnemy.tileX, nearestEnemy.tileY);

    // Melee units want to be close
    if ((unit.attackRange || 1) <= 1) {
      score += (10 - distance) * 5;
    } else {
      // Ranged units want optimal distance (attack range - 1)
      const optimalDistance = (unit.attackRange || 1) - 1;
      const distanceFromOptimal = Math.abs(distance - optimalDistance);
      score += (5 - distanceFromOptimal) * 5;
    }
  }

  // Terrain bonuses (if terrain system exists)
  if (state.terrain) {
    const terrainType = state.terrain[tileY]?.[tileX];
    if (terrainType === 'forest' || terrainType === 'rock') {
      score += 10; // Cover bonus
    }
  }

  // Avoid corners (limited escape options)
  const gridWidth = state.gridWidth || 20;
  const gridHeight = state.gridHeight || 20;
  if (tileX === 0 || tileX === gridWidth - 1) score -= 10;
  if (tileY === 0 || tileY === gridHeight - 1) score -= 10;

  // Flanking bonus (enemies on multiple sides)
  const flankedCount = countFlankingPositions(tileX, tileY, state, unit.type === 'player' ? 'enemy' : 'player');
  if (flankedCount >= 2) {
    score -= flankedCount * 15; // Penalty for being flanked
  }

  return Math.max(-100, Math.min(100, score));
}

/**
 * Find the nearest enemy unit
 * @param {Object} unit - Reference unit
 * @param {number} fromX - Position X
 * @param {number} fromY - Position Y
 * @param {Object} state - Battle state
 * @returns {Object|null} Nearest enemy unit
 */
function findNearestEnemy(unit, fromX, fromY, state) {
  const enemyType = unit.type === 'player' ? 'enemy' : 'player';
  let nearest = null;
  let nearestDistance = Infinity;

  for (const enemy of state.units) {
    if (enemy.type !== enemyType || enemy.hp <= 0) continue;

    const distance = getManhattanDistance(fromX, fromY, enemy.tileX, enemy.tileY);

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = enemy;
    }
  }

  return nearest;
}

/**
 * Count enemy positions that would flank this tile
 * @param {number} tileX - Position X
 * @param {number} tileY - Position Y
 * @param {Object} state - Battle state
 * @param {string} enemyType - Type to count as enemies
 * @returns {number} Number of flanking positions occupied
 */
function countFlankingPositions(tileX, tileY, state, enemyType) {
  let count = 0;
  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  for (const [dx, dy] of directions) {
    const checkX = tileX + dx;
    const checkY = tileY + dy;

    for (const unit of state.units) {
      if (unit.type === enemyType && unit.hp > 0 &&
          unit.tileX === checkX && unit.tileY === checkY) {
        count++;
        break;
      }
    }
  }

  return count;
}

/**
 * Calculate ally support value at a position
 * @param {Object} unit - Unit being evaluated
 * @param {number} tileX - Position X
 * @param {number} tileY - Position Y
 * @param {Object} state - Battle state
 * @returns {number} Ally support score (0-50)
 */
function calculateAllySupport(unit, tileX, tileY, state) {
  let score = 0;
  const allyType = unit.type;

  for (const ally of state.units) {
    if (ally.type !== allyType || ally.hp <= 0 || ally.id === unit.id) continue;

    const distance = getManhattanDistance(tileX, tileY, ally.tileX, ally.tileY);

    // Closer allies provide more support
    if (distance <= 2) {
      score += (3 - distance) * 10;

      // Bonus if ally has support skills
      if (hasSkillType(ally, 'heal') || hasSkillType(ally, 'buff')) {
        score += 10;
      }
    }
  }

  return Math.min(50, score);
}

/**
 * Check if a unit has a skill of a certain type
 * @param {Object} unit - Unit to check
 * @param {string} type - Skill type (heal, buff, etc.)
 * @returns {boolean}
 */
function hasSkillType(unit, type) {
  if (!unit.skills) return false;
  return unit.skills.some(skill =>
    skill.damageType === type ||
    skill.effect === type ||
    skill.healPercent > 0 && type === 'heal' ||
    skill.selfBuff && type === 'buff'
  );
}

/**
 * Calculate healing value for a support action
 * @param {Object} healer - Unit performing heal
 * @param {Object} target - Target being healed
 * @param {Object} skill - Healing skill
 * @param {Object} state - Battle state
 * @returns {number} Healing value (0-500)
 */
function calculateHealingValue(healer, target, skill, state) {
  if (!skill || !target || target.hp <= 0) return 0;
  if (!skill.healPercent && !skill.selfBuff && skill.damageType !== 'heal') return 0;

  // Calculate actual healing
  let healAmount = 0;
  if (skill.healPercent) {
    healAmount = Math.floor(target.maxHp * (skill.healPercent / 100));
  }

  // Cap at missing HP
  const missingHp = target.maxHp - target.hp;
  healAmount = Math.min(healAmount, missingHp);

  // Scale by how critical the heal is
  const hpPercent = target.hp / target.maxHp;
  let urgencyMultiplier = 1.0;
  if (hpPercent < 0.3) urgencyMultiplier = 2.5;
  else if (hpPercent < 0.5) urgencyMultiplier = 1.5;
  else if (hpPercent > 0.8) urgencyMultiplier = 0.3; // Low value to overheal

  return healAmount * urgencyMultiplier;
}

/**
 * Calculate survival priority value
 * @param {Object} unit - Unit being evaluated
 * @param {number} tileX - Position X
 * @param {number} tileY - Position Y
 * @param {Object} state - Battle state
 * @returns {number} Survival priority (0-200)
 */
function calculateSurvivalPriority(unit, tileX, tileY, state) {
  const hpPercent = unit.hp / unit.maxHp;

  // Base priority scales with missing HP
  let priority = 0;
  if (hpPercent < 0.2) priority = 200;
  else if (hpPercent < 0.4) priority = 100;
  else if (hpPercent < 0.6) priority = 50;
  else priority = 20;

  // Increase if many enemies nearby
  const nearbyEnemies = countNearbyEnemies(tileX, tileY, state, unit.type);
  priority += nearbyEnemies * 20;

  // Decrease if allies nearby for protection
  const nearbyAllies = countNearbyAllies(tileX, tileY, state, unit.type, unit.id);
  priority -= nearbyAllies * 10;

  return Math.max(0, Math.min(200, priority));
}

/**
 * Count enemies within range 2 of a position
 */
function countNearbyEnemies(tileX, tileY, state, unitType) {
  const enemyType = unitType === 'player' ? 'enemy' : 'player';
  let count = 0;

  for (const unit of state.units) {
    if (unit.type !== enemyType || unit.hp <= 0) continue;

    const distance = getManhattanDistance(tileX, tileY, unit.tileX, unit.tileY);
    if (distance <= 2) count++;
  }

  return count;
}

/**
 * Count allies within range 2 of a position
 */
function countNearbyAllies(tileX, tileY, state, unitType, excludeId) {
  let count = 0;

  for (const unit of state.units) {
    if (unit.type !== unitType || unit.hp <= 0 || unit.id === excludeId) continue;

    const distance = getManhattanDistance(tileX, tileY, unit.tileX, unit.tileY);
    if (distance <= 2) count++;
  }

  return count;
}

/**
 * Calculate MP efficiency value
 * @param {Object} unit - Unit using skill
 * @param {Object} skill - Skill being used
 * @returns {number} MP efficiency (0-100)
 */
function calculateMpEfficiency(unit, skill) {
  if (!skill || !skill.mpCost || skill.mpCost === 0) return 50; // Neutral for free actions

  const mpPercent = unit.mp / unit.maxMp;
  const skillCostPercent = skill.mpCost / unit.maxMp;

  // Penalize expensive skills when low on MP
  if (mpPercent < 0.3) {
    return 100 - (skillCostPercent * 200); // Heavy penalty when low
  } else if (mpPercent < 0.5) {
    return 100 - (skillCostPercent * 100);
  }

  // Minor consideration when MP is comfortable
  return 100 - (skillCostPercent * 50);
}

/**
 * Calculate target priority value
 * @param {Object} target - Target being evaluated
 * @param {Object} state - Battle state
 * @returns {number} Target priority (0-100)
 */
function calculateTargetPriority(target, state) {
  if (!target || target.hp <= 0) return 0;

  let priority = 50; // Base priority

  // Priority based on HP (lower HP = higher priority to finish off)
  const hpPercent = target.hp / target.maxHp;
  if (hpPercent < 0.3) priority += 30;
  else if (hpPercent < 0.5) priority += 15;

  // Priority based on class/threat
  const threatLevel = getTargetValue(target, state);
  priority += threatLevel * 0.3;

  // Priority for support units (kill healers first)
  if (hasSkillType(target, 'heal')) {
    priority += 25;
  }

  return Math.min(100, priority);
}

/**
 * Get the strategic value of a target
 * @param {Object} target - Target unit
 * @param {Object} state - Battle state
 * @returns {number} Target value (0-100)
 */
function getTargetValue(target, state) {
  let value = 50;

  // Class-based value
  const targetClass = target.class?.toLowerCase();
  if (targetClass === 'wizard' || targetClass === 'sorcerer') value += 20;
  if (targetClass === 'chemist' || targetClass === 'alchemist') value += 15;
  if (targetClass === 'monk') value += 10;

  // Damage dealers are high value
  if (target.strength > target.vitality * 1.5) value += 10;
  if (target.intelligence > target.vitality * 1.5) value += 10;

  return Math.min(100, value);
}

export {
  calculateDamageDealt,
  calculateDamageReceived,
  calculateKillPotential,
  calculatePositionQuality,
  calculateAllySupport,
  calculateHealingValue,
  calculateSurvivalPriority,
  calculateMpEfficiency,
  calculateTargetPriority,
  getTargetValue,

  // Helper functions
  findNearestEnemy,
  countTargetsInAoe,
  countNearbyEnemies,
  countNearbyAllies,
  hasSkillType
};
