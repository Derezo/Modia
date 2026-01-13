/**
 * Battle Service - Damage calculations, status effects, action processing, and battle utilities
 */

import { CLASS_MOVEMENT } from '../config/constants.js';
import { SKILL_TREES } from '../config/skillTrees.js';
import * as traitService from './traitService.js';
import { getTerrainMovementCost } from '../../../shared/terrain.js';
import {
  getReachableTiles as sharedGetReachableTiles,
  calculatePathCost as sharedCalculatePathCost,
  getManhattanDistance
} from '../../../shared/pathfinding.js';

// Default attack range for melee (1 tile adjacent)
const DEFAULT_ATTACK_RANGE = 1;

/**
 * Calculate physical damage
 * Formula: (ATK + equipmentAttack + strength) * skillPower - (DEF + equipmentDefense + vitality * 0.5)
 * Equipment attack/defense bonuses are additive to base stats
 * Trait bonuses are applied as multipliers after base calculation
 */
function calculatePhysicalDamage(attacker, defender, skillPower = 100) {
  // Base attack = strength + equipment attack bonus
  const attackPower = attacker.strength + (attacker.attack || 0);
  const baseDamage = attackPower * (skillPower / 100);

  // Defense = vitality + equipment defense bonus
  const defensePower = (defender.vitality || defender.agility / 2) + (defender.defense || 0);
  const defenseReduction = defensePower * 0.5 * 0.3;
  const rawDamage = Math.max(1, baseDamage - defenseReduction);

  // Random variance (0.9 - 1.1)
  const variance = 0.9 + Math.random() * 0.2;

  // Critical hit check (luck-based) with trait bonus
  const baseCritChance = (attacker.luck || 10) / 200;
  const traitCritBonus = traitService.getCritChanceBonus(attacker);
  const critChance = baseCritChance + traitCritBonus;
  const isCritical = Math.random() < critChance;
  const critMultiplier = isCritical ? 1.5 : 1.0;

  // Apply race bonuses
  let raceMultiplier = 1.0;
  if (attacker.race === 'orc') {
    raceMultiplier = 1.1; // +10% crit damage for orcs
  }

  // Apply trait damage multipliers
  const traitDamageMultiplier = traitService.getPhysicalDamageMultiplier(attacker, defender, isCritical);
  const traitDefenseMultiplier = traitService.getDamageReductionMultiplier(defender, 'physical');

  const finalDamage = Math.floor(rawDamage * variance * critMultiplier * raceMultiplier * traitDamageMultiplier * traitDefenseMultiplier);

  return {
    damage: Math.max(1, finalDamage),
    isCritical,
    variance,
    traitBonusApplied: traitDamageMultiplier > 1.0 || traitDefenseMultiplier < 1.0
  };
}

/**
 * Calculate magical damage
 * Formula: (INT + equipmentMagicAttack) * skillPower - (INT_DEF + equipmentMagicDefense)
 * Equipment magic attack/defense bonuses are additive to base stats
 * Trait bonuses are applied as multipliers after base calculation
 */
function calculateMagicalDamage(attacker, defender, skillPower = 100) {
  // Base magic attack = intelligence + equipment magic attack bonus
  const magicAttackPower = attacker.intelligence + (attacker.magicAttack || 0);
  const baseDamage = magicAttackPower * (skillPower / 100);

  // Magic defense = intelligence + equipment magic defense bonus
  const magicDefensePower = (defender.intelligence || 10) + (defender.magicDefense || 0);
  const defenseReduction = magicDefensePower * 0.25 * 0.3;
  const rawDamage = Math.max(1, baseDamage - defenseReduction);

  // Random variance (0.9 - 1.1)
  const variance = 0.9 + Math.random() * 0.2;

  // Critical hit check with trait bonus
  const baseCritChance = (attacker.luck || 10) / 200;
  const traitCritBonus = traitService.getCritChanceBonus(attacker);
  const critChance = baseCritChance + traitCritBonus;
  const isCritical = Math.random() < critChance;
  const critMultiplier = isCritical ? 1.5 : 1.0;

  // Apply trait damage multipliers
  const traitDamageMultiplier = traitService.getMagicalDamageMultiplier(attacker, defender, isCritical);
  const traitDefenseMultiplier = traitService.getDamageReductionMultiplier(defender, 'magical');

  const finalDamage = Math.floor(rawDamage * variance * critMultiplier * traitDamageMultiplier * traitDefenseMultiplier);

  return {
    damage: Math.max(1, finalDamage),
    isCritical,
    variance,
    traitBonusApplied: traitDamageMultiplier > 1.0 || traitDefenseMultiplier < 1.0
  };
}

/**
 * Calculate initiative for turn order
 * Includes trait bonus for initiative
 */
function calculateInitiative(unit) {
  const baseInitiative = unit.agility + Math.floor(Math.random() * 10);
  const initiativeBonus = traitService.getInitiativeBonus(unit);
  return Math.floor(baseInitiative * (1 + initiativeBonus));
}

/**
 * Sort units by initiative (descending)
 */
function sortByInitiative(units) {
  return [...units].map(unit => ({
    ...unit,
    initiative: calculateInitiative(unit)
  })).sort((a, b) => b.initiative - a.initiative);
}

/**
 * Process status effects at turn start
 * Also processes trait-based HP regeneration
 */
function processStatusEffects(unit) {
  const results = [];

  // Process trait-based HP regen (Regeneration trait: 2% per turn)
  const traitHPRegen = traitService.calculateHPRegen(unit);
  if (traitHPRegen > 0) {
    unit.hp = Math.min(unit.maxHp, unit.hp + traitHPRegen);
    results.push({ type: 'trait_regen', amount: traitHPRegen });
  }

  if (!unit.statusEffects || unit.statusEffects.length === 0) {
    return results;
  }

  for (let i = unit.statusEffects.length - 1; i >= 0; i--) {
    const effect = unit.statusEffects[i];

    // Apply effect damage/healing
    switch (effect.type) {
      case 'poison':
        const poisonDamage = Math.floor(unit.maxHp * 0.05);
        unit.hp = Math.max(0, unit.hp - poisonDamage);
        results.push({ type: 'poison_damage', damage: poisonDamage });
        break;

      case 'burn':
        const burnDamage = Math.floor(unit.maxHp * 0.03);
        unit.hp = Math.max(0, unit.hp - burnDamage);
        results.push({ type: 'burn_damage', damage: burnDamage });
        break;

      case 'regen':
        const healAmount = Math.floor(unit.maxHp * 0.05);
        unit.hp = Math.min(unit.maxHp, unit.hp + healAmount);
        results.push({ type: 'regen_heal', amount: healAmount });
        break;
    }

    // Decrement duration
    effect.duration--;
    if (effect.duration <= 0) {
      unit.statusEffects.splice(i, 1);
      results.push({ type: 'effect_expired', effect: effect.type });
    }
  }

  return results;
}

/**
 * Check if unit can act (status effects only - ignores turn state)
 */
function canUnitAct(unit) {
  if (!unit.statusEffects) return true;

  const preventActing = ['stun', 'freeze', 'sleep'];
  return !unit.statusEffects.some(e => preventActing.includes(e.type));
}

/**
 * Check if unit can move (status effects only - ignores turn state)
 */
function canUnitMove(unit) {
  if (!unit.statusEffects) return true;

  const preventMovement = ['stun', 'freeze', 'sleep', 'root'];
  return !unit.statusEffects.some(e => preventMovement.includes(e.type));
}

/**
 * Check if unit can use skills (status effects only)
 */
function canUnitUseSkills(unit) {
  if (!unit.statusEffects) return true;

  const preventSkills = ['stun', 'freeze', 'sleep', 'silence'];
  return !unit.statusEffects.some(e => preventSkills.includes(e.type));
}

/**
 * Reset unit turn state for a new turn (two-action system)
 */
function resetTurnState(unit) {
  unit.moveUsed = false;
  unit.actUsed = false;
  unit.turnPhase = 'ready';
  unit.hasActed = false;
}

/**
 * Check if unit's turn should auto-end (cannot do any action)
 */
function shouldAutoEndTurn(unit) {
  const canMove = canUnitMove(unit) && !unit.moveUsed;
  const canAct = canUnitAct(unit) && !unit.actUsed;
  return !canMove && !canAct;
}

/**
 * Apply a status effect to a unit
 */
function applyStatusEffect(unit, effectType, duration = 3) {
  if (!unit.statusEffects) {
    unit.statusEffects = [];
  }

  // Check if effect already exists
  const existing = unit.statusEffects.find(e => e.type === effectType);
  if (existing) {
    // Refresh duration
    existing.duration = Math.max(existing.duration, duration);
    return false; // Already had effect
  }

  unit.statusEffects.push({ type: effectType, duration });
  return true; // New effect applied
}

/**
 * Check miss chance based on agility and traits
 */
function checkHit(attacker, defender) {
  const baseHitChance = 0.95;
  const agilityDiff = defender.agility - attacker.agility;
  const dodgeBonus = Math.max(0, agilityDiff) * 0.01;

  // Apply trait bonuses
  const accuracyBonus = traitService.getAccuracyBonus(attacker);
  const evasionBonus = traitService.getEvasionBonus(defender);

  // Check for blind status
  const isBlinded = attacker.statusEffects?.some(e => e.type === 'blind');
  const blindPenalty = isBlinded ? 0.3 : 0;

  const hitChance = Math.max(0.5, baseHitChance - dodgeBonus - blindPenalty + accuracyBonus - evasionBonus);
  return Math.random() < hitChance;
}

/**
 * Calculate experience reward from battle
 * Includes trait bonus (Fast Learner: +10% XP)
 * @param {Array} enemies - Enemy units defeated
 * @param {number} partyLevel - Average party level
 * @param {Array} partyUnits - Player units (for trait bonuses)
 */
function calculateExperienceReward(enemies, partyLevel, partyUnits = []) {
  let totalXP = 0;

  for (const enemy of enemies) {
    const baseXP = enemy.xpReward || (50 + (enemy.maxHp / 10));
    // Scale by level difference
    const levelDiff = (enemy.level || partyLevel) - partyLevel;
    const levelMultiplier = Math.max(0.5, Math.min(2.0, 1 + levelDiff * 0.1));
    totalXP += Math.floor(baseXP * levelMultiplier);
  }

  // Apply trait XP bonuses from all party members (use highest bonus)
  let traitXPBonus = 0;
  for (const unit of partyUnits) {
    const unitBonus = traitService.getXPBonus(unit);
    if (unitBonus > traitXPBonus) {
      traitXPBonus = unitBonus;
    }
  }

  return Math.floor(totalXP * (1 + traitXPBonus));
}

/**
 * Calculate gold reward from battle
 * Includes trait bonus (Treasure Hunter: +15% gold)
 * @param {Array} enemies - Enemy units defeated
 * @param {number} difficultyTier - Difficulty tier multiplier
 * @param {Array} partyUnits - Player units (for trait bonuses)
 */
function calculateGoldReward(enemies, difficultyTier = 1, partyUnits = []) {
  let totalGold = 0;

  for (const enemy of enemies) {
    const minGold = enemy.goldMin || (10 * difficultyTier);
    const maxGold = enemy.goldMax || (30 * difficultyTier);
    totalGold += Math.floor(minGold + Math.random() * (maxGold - minGold));
  }

  // Apply trait gold bonuses from all party members (use highest bonus)
  let traitGoldBonus = 0;
  for (const unit of partyUnits) {
    const unitBonus = traitService.getGoldBonus(unit);
    if (unitBonus > traitGoldBonus) {
      traitGoldBonus = unitBonus;
    }
  }

  return Math.floor(totalGold * (1 + traitGoldBonus));
}

// ==================== Movement and Range Functions ====================

/**
 * Get movement range for a unit based on class and traits
 * Uses CLASS_MOVEMENT from constants for authoritative class movement values
 * @param {Object} unit - The unit
 * @returns {number} Maximum movement distance (Manhattan distance)
 */
function getMovementRange(unit) {
  // Use class-specific movement range from constants, default to 3 if class not found
  let baseRange = CLASS_MOVEMENT[unit.class?.toLowerCase()] || 3;

  // Apply trait movement bonus (Swift Feet: +1 tile)
  const traitMovementBonus = traitService.getMovementBonus(unit);
  baseRange += traitMovementBonus;

  // Status effect adjustments
  if (unit.statusEffects?.some(e => e.type === 'slow')) {
    baseRange = Math.max(1, baseRange - 1);
  }
  if (unit.statusEffects?.some(e => e.type === 'haste')) {
    baseRange += 1;
  }

  return baseRange;
}

/**
 * Get attack range for a unit (melee = 1, ranged classes may have more)
 * Includes trait bonus (Eagle Eye: +1 range)
 * @param {Object} unit - The unit
 * @returns {number} Maximum attack distance (Manhattan distance)
 */
function getAttackRange(unit) {
  // Base attack range (can be extended based on equipped weapon type)
  let baseRange = unit.attackRange || DEFAULT_ATTACK_RANGE;

  // Apply trait range bonus (Eagle Eye: +1 tile)
  const traitRangeBonus = traitService.getRangeBonus(unit);
  baseRange += traitRangeBonus;

  return baseRange;
}

// getManhattanDistance is now imported from shared/pathfinding.js

// ==================== Unified Tile/Action Availability ====================

/**
 * Get all tiles reachable within a unit's movement range
 * Wrapper around shared pathfinding module for server-side use
 *
 * @param {Object} unit - The unit to calculate movement for
 * @param {Object} state - Battle state with terrain and units
 * @returns {Array<{x, y, cost}>} Array of reachable tile positions with movement costs
 */
function getReachableTiles(unit, state) {
  // Check if unit can move (status effects)
  if (!canUnitMove(unit)) {
    return [];
  }

  const maxCost = getMovementRange(unit);
  const mapWidth = state.mapWidth || 32;
  const mapHeight = state.mapHeight || 32;

  // Use shared pathfinding module
  return sharedGetReachableTiles(
    unit.tileX,
    unit.tileY,
    maxCost,
    state.terrain,
    state.units,
    mapWidth,
    mapHeight
  );
}

/**
 * Get targets in range for attacks or skills
 * @param {Object} unit - The acting unit
 * @param {Object} state - Battle state
 * @param {number} range - Maximum range (Manhattan distance)
 * @param {string} targetType - 'enemy' or 'player' or 'ally' (same type as unit)
 * @returns {Array} Array of valid targets with positions
 */
function getTargetsInRange(unit, state, range, targetType) {
  const targets = [];
  const actualTargetType = targetType === 'ally' ? unit.type : targetType;

  for (const other of state.units) {
    if (other.hp <= 0) continue;
    if (other.id === unit.id) continue; // Can't target self for attacks

    // Check type matching
    if (targetType === 'ally' && other.type !== unit.type) continue;
    if (targetType !== 'ally' && other.type !== actualTargetType) continue;

    const distance = getManhattanDistance(unit.tileX, unit.tileY, other.tileX, other.tileY);
    if (distance > 0 && distance <= range) {
      targets.push({
        x: other.tileX,
        y: other.tileY,
        unitId: other.id,
        unitName: other.name,
        distance
      });
    }
  }

  return targets;
}

/**
 * Find an unoccupied tile adjacent to the target for leap attacks
 * Used by movement skills like Pounce and Charge Rush
 * @param {Object} state - Battle state
 * @param {Object} unit - The leaping unit
 * @param {Object} targetTile - The target's tile {x, y}
 * @returns {Object|null} Adjacent tile {x, y} or null if none available
 */
function findAdjacentTileToTarget(state, unit, targetTile) {
  const mapWidth = state.mapWidth || 32;
  const mapHeight = state.mapHeight || 32;

  // Cardinal directions first (most natural landing spots), then diagonals
  const directions = [
    { x: 0, y: -1 },  // Up
    { x: 0, y: 1 },   // Down
    { x: -1, y: 0 },  // Left
    { x: 1, y: 0 },   // Right
    { x: -1, y: -1 }, // Up-Left
    { x: 1, y: -1 },  // Up-Right
    { x: -1, y: 1 },  // Down-Left
    { x: 1, y: 1 }    // Down-Right
  ];

  // Sort directions to prefer tiles closer to unit's starting position
  // This makes the leap feel more natural (lands on the side they came from)
  const sortedDirs = directions.slice().sort((a, b) => {
    const distA = getManhattanDistance(
      targetTile.x + a.x, targetTile.y + a.y,
      unit.tileX, unit.tileY
    );
    const distB = getManhattanDistance(
      targetTile.x + b.x, targetTile.y + b.y,
      unit.tileX, unit.tileY
    );
    return distA - distB;
  });

  for (const dir of sortedDirs) {
    const adjX = targetTile.x + dir.x;
    const adjY = targetTile.y + dir.y;

    // Check bounds
    if (adjX < 0 || adjX >= mapWidth || adjY < 0 || adjY >= mapHeight) {
      continue;
    }

    // Check if tile is occupied by another unit
    const isOccupied = state.units.some(u =>
      u.hp > 0 && u.id !== unit.id &&
      u.tileX === adjX && u.tileY === adjY
    );
    if (isOccupied) continue;

    // Check if tile is passable (no obstacles)
    const tile = state.terrain?.find(t => t.x === adjX && t.y === adjY);
    if (tile && tile.passable === false) continue;

    // Check obstacles
    const hasObstacle = state.obstacles?.some(o =>
      o.x === adjX && o.y === adjY && o.passable === false
    );
    if (hasObstacle) continue;

    return { x: adjX, y: adjY };
  }

  // No valid adjacent tile found - unit can't complete the leap
  // In this case, the attack will still happen from the original position
  return null;
}

/**
 * Get the opposite unit type
 * @param {string} type - 'player' or 'enemy'
 * @returns {string}
 */
function getOppositeType(type) {
  return type === 'player' ? 'enemy' : 'player';
}

/**
 * Get all available actions for a unit in the current battle state
 * This is used by both player UI (sent to client) and AI decision making
 *
 * @param {Object} unit - The unit to get actions for
 * @param {Object} state - Battle state
 * @returns {Object} Available actions with targets
 */
function getAvailableActions(unit, state) {
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

// ==================== Terrain Cost Pathfinding ====================
// Note: getTerrainMovementCost is imported from shared/terrain.js

/**
 * Calculate minimum movement cost to reach target tile
 * Wrapper around shared pathfinding module for server-side use
 *
 * @param {number} startX - Starting X position
 * @param {number} startY - Starting Y position
 * @param {number} targetX - Target X position
 * @param {number} targetY - Target Y position
 * @param {Object} state - Battle state with terrain and units
 * @param {number} maxCost - Maximum movement cost (movement range)
 * @returns {number} Path cost to reach target, or Infinity if unreachable
 */
function calculatePathCost(startX, startY, targetX, targetY, state, maxCost) {
  // If no terrain data, fall back to Manhattan distance for backwards compatibility
  if (!state.terrain) {
    return getManhattanDistance(startX, startY, targetX, targetY);
  }

  const mapWidth = state.mapWidth || 32;
  const mapHeight = state.mapHeight || 32;

  // Use shared pathfinding module
  return sharedCalculatePathCost(
    startX,
    startY,
    targetX,
    targetY,
    state.terrain,
    state.units,
    maxCost,
    mapWidth,
    mapHeight
  );
}

/**
 * Get skill definition from SKILL_TREES
 * @param {string} unitClass - The unit's class (warrior, wizard, etc.)
 * @param {string} skillId - The skill ID to find
 * @returns {Object|null} Skill definition or null if not found
 */
function getSkillDefinition(unitClass, skillId) {
  const classTree = SKILL_TREES[unitClass?.toLowerCase()];
  if (!classTree) return null;

  for (const branch of classTree.branches) {
    const skill = branch.skills.find(s => s.id === skillId);
    if (skill) return skill;
  }
  return null;
}

// ==================== AoE (Area of Effect) System ====================

/**
 * Get all tiles affected by an AoE skill
 * @param {number} targetX - Center tile X
 * @param {number} targetY - Center tile Y
 * @param {number} radius - AoE radius (Manhattan distance)
 * @param {string} pattern - AoE pattern: 'circle', 'cross', 'line'
 * @param {number} direction - Direction for directional patterns (0-7)
 * @returns {Array} Array of { x, y, isCenter } objects
 */
function getAoETiles(targetX, targetY, radius = 1, pattern = 'circle', direction = 0) {
  const tiles = [];

  switch (pattern) {
    case 'cross':
      // Center + 4 cardinal directions
      tiles.push({ x: targetX, y: targetY, isCenter: true });
      for (let i = 1; i <= radius; i++) {
        // North, South, East, West
        tiles.push({ x: targetX, y: targetY - i, isCenter: false });
        tiles.push({ x: targetX, y: targetY + i, isCenter: false });
        tiles.push({ x: targetX - i, y: targetY, isCenter: false });
        tiles.push({ x: targetX + i, y: targetY, isCenter: false });
      }
      break;

    case 'line':
      // Line in specified direction
      const dirOffsets = [
        { dx: 0, dy: -1 },  // N
        { dx: 1, dy: -1 },  // NE
        { dx: 1, dy: 0 },   // E
        { dx: 1, dy: 1 },   // SE
        { dx: 0, dy: 1 },   // S
        { dx: -1, dy: 1 },  // SW
        { dx: -1, dy: 0 },  // W
        { dx: -1, dy: -1 }  // NW
      ];
      const offset = dirOffsets[direction % 8];
      for (let i = 0; i <= radius; i++) {
        const x = targetX + offset.dx * i;
        const y = targetY + offset.dy * i;
        tiles.push({ x, y, isCenter: i === 0 });
      }
      break;

    case 'circle':
    default:
      // All tiles within Manhattan distance
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          const distance = Math.abs(dx) + Math.abs(dy);
          if (distance <= radius) {
            tiles.push({
              x: targetX + dx,
              y: targetY + dy,
              isCenter: dx === 0 && dy === 0
            });
          }
        }
      }
      break;
  }

  return tiles;
}

/**
 * Get all units in the AoE area from a list of units
 * @param {Array} units - Array of all units in battle
 * @param {number} targetX - Center tile X
 * @param {number} targetY - Center tile Y
 * @param {number} radius - AoE radius
 * @param {string} pattern - AoE pattern
 * @returns {Array} Array of { unit, isCenter } for units in the AoE
 */
function getUnitsInAoE(units, targetX, targetY, radius = 1, pattern = 'circle') {
  const aoeTiles = getAoETiles(targetX, targetY, radius, pattern);
  const affectedUnits = [];

  for (const tile of aoeTiles) {
    const unit = units.find(u => u.tileX === tile.x && u.tileY === tile.y && u.hp > 0);
    if (unit) {
      affectedUnits.push({
        unit,
        isCenter: tile.isCenter
      });
    }
  }

  return affectedUnits;
}

// ==================== Charge Time System ====================

/**
 * Calculate charge time for an MP skill
 * Base CT = MP cost * 2, reduced by agility, intelligence, and skill level
 * @param {Object} unit - The unit using the skill
 * @param {Object} skill - The skill being used
 * @returns {number} Charge time in CT ticks (10-50)
 */
function calculateChargeTime(unit, skill) {
  if (!skill.mpCost || skill.mpCost <= 0) return 0;

  const baseCT = skill.mpCost * 2;
  const agilityBonus = Math.floor((unit.agility || 10) / 10);
  const intBonus = Math.floor((unit.intelligence || 10) / 10);
  const levelBonus = ((skill.level || 1) - 1) * 2;

  const chargeTime = baseCT - agilityBonus - intBonus - levelBonus;

  // Clamp between 10 and 50
  return Math.max(10, Math.min(50, chargeTime));
}

/**
 * Check if a charging skill is interrupted when the unit takes damage
 * @returns {boolean} True if the skill is interrupted (10% chance)
 */
function checkChargeInterrupt() {
  return Math.random() < 0.10;
}

/**
 * Get damage multiplier for physical damage against a charging unit
 * @returns {number} Damage multiplier (1.25 = 25% extra damage)
 */
function getChargingDamageMultiplier() {
  return 1.25;
}

/**
 * Start charging a skill for a unit
 * @param {Object} unit - The unit starting to charge
 * @param {string} skillId - The skill being charged
 * @param {Object} targetTile - The target tile for the skill
 * @param {number} chargeTime - The charge time in CT ticks
 */
function startCharging(unit, skillId, targetTile, chargeTime) {
  unit.isCharging = true;
  unit.chargingSkill = {
    skillId,
    targetTile,
    chargeTime,
    chargeRemaining: chargeTime
  };
  unit.chargeStartCT = unit.ct;
}

/**
 * Cancel a charging skill (due to interrupt or death)
 * @param {Object} unit - The unit whose charge to cancel
 */
function cancelCharging(unit) {
  unit.isCharging = false;
  unit.chargingSkill = null;
  unit.chargeStartCT = null;
}

/**
 * Update charge progress when CT advances
 * Returns true if charge is complete and ready to execute
 * @param {Object} unit - The charging unit
 * @param {number} ctAdvanced - Amount of CT advanced
 * @returns {boolean} True if charge is complete
 */
function updateChargeProgress(unit, ctAdvanced) {
  if (!unit.isCharging || !unit.chargingSkill) return false;

  unit.chargingSkill.chargeRemaining -= ctAdvanced;

  if (unit.chargingSkill.chargeRemaining <= 0) {
    return true; // Charge complete
  }

  return false;
}

// ==================== CT-Based Turn System ====================

const CT_THRESHOLD = 100;

/**
 * Initialize CT values for all units at battle start
 * Units start with CT based on their agility for initial variation
 */
function initializeCT(units) {
  for (const unit of units) {
    // Start with some CT based on agility to add variety to first turns
    unit.ct = Math.floor(unit.agility * Math.random());
  }
}

/**
 * Advance CT for all alive units until at least one can act
 * Returns the number of ticks advanced
 */
function advanceCTUntilReady(state) {
  const aliveUnits = state.units.filter(u => u.hp > 0);
  if (aliveUnits.length === 0) return 0;

  let ticks = 0;
  const maxTicks = 1000; // Safety limit

  while (ticks < maxTicks) {
    // Check if any unit can act
    if (aliveUnits.some(u => u.ct >= CT_THRESHOLD)) {
      break;
    }

    // Advance all alive units' CT by their agility
    for (const unit of aliveUnits) {
      unit.ct += unit.agility;
    }
    ticks++;
  }

  return ticks;
}

/**
 * Get the next unit to act (highest CT >= 100)
 * Tie-breakers: highest CT, then highest agility, then players before enemies
 */
function getNextActor(state) {
  const ready = state.units.filter(u => u.hp > 0 && u.ct >= CT_THRESHOLD);

  if (ready.length === 0) return null;

  ready.sort((a, b) => {
    // Highest CT first
    if (b.ct !== a.ct) return b.ct - a.ct;
    // Highest agility as tie-breaker
    if (b.agility !== a.agility) return b.agility - a.agility;
    // Players before enemies as final tie-breaker
    return (a.type === 'player' ? 0 : 1) - (b.type === 'player' ? 0 : 1);
  });

  return ready[0];
}

/**
 * Consume CT after a unit acts
 */
function consumeCT(unit) {
  unit.ct -= CT_THRESHOLD;
  // Ensure CT doesn't go negative
  if (unit.ct < 0) unit.ct = 0;
}

/**
 * Predict the next N turns without modifying actual state
 * Returns array of { id, name, type, class } for each predicted turn
 */
function predictTurnOrder(state, count = 10) {
  const predictions = [];
  const aliveUnits = state.units.filter(u => u.hp > 0);

  if (aliveUnits.length === 0) return predictions;

  // Create a simulation copy of CT values
  const simCT = {};
  for (const unit of aliveUnits) {
    simCT[unit.id] = unit.ct || 0;
  }

  const maxIterations = count * 100; // Safety limit
  let iterations = 0;

  while (predictions.length < count && iterations < maxIterations) {
    iterations++;

    // Advance CT until someone is ready
    while (!aliveUnits.some(u => simCT[u.id] >= CT_THRESHOLD)) {
      for (const unit of aliveUnits) {
        simCT[unit.id] += unit.agility;
      }
    }

    // Find who acts (same sorting as getNextActor)
    const ready = aliveUnits.filter(u => simCT[u.id] >= CT_THRESHOLD);
    ready.sort((a, b) => {
      if (simCT[b.id] !== simCT[a.id]) return simCT[b.id] - simCT[a.id];
      if (b.agility !== a.agility) return b.agility - a.agility;
      return (a.type === 'player' ? 0 : 1) - (b.type === 'player' ? 0 : 1);
    });

    const actor = ready[0];
    predictions.push({
      id: actor.id,
      name: actor.name,
      type: actor.type,
      class: actor.class
    });

    // Consume CT in simulation
    simCT[actor.id] -= CT_THRESHOLD;
  }

  return predictions;
}

/**
 * Find the unit that should act next, advancing CT if needed
 * Updates state.activeUnitId to the next actor and resets their turn state
 */
function advanceToNextActor(state) {
  // First, advance CT until someone is ready
  advanceCTUntilReady(state);

  // Get the next actor
  const nextActor = getNextActor(state);

  if (nextActor) {
    state.activeUnitId = nextActor.id;
    // Also update activeUnitIndex for backwards compatibility
    state.activeUnitIndex = state.units.findIndex(u => u.id === nextActor.id);
    // Reset turn state for the new actor (two-action system)
    resetTurnState(nextActor);
  }

  return nextActor;
}

// ==================== Action Processing ====================

/**
 * Initialize two-action turn state for a unit if not present (migration support)
 * @param {Object} unit - The unit to initialize
 */
function initializeTurnState(unit) {
  if (typeof unit.moveUsed !== 'boolean') {
    unit.moveUsed = false;
    unit.actUsed = false;
    unit.turnPhase = 'ready';
  }
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
function processAction(state, unit, actionType, targetTile, skillId = null) {
  const result = { damage: 0, moved: false, turnEnded: false };

  // Initialize two-action state if missing (migration support)
  initializeTurnState(unit);

  switch (actionType) {
    case 'move':
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
      if (targetTile) {
        // SECURITY: Validate movement range server-side (anti-cheat)
        // Uses terrain-cost pathfinding to match frontend highlighting
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
      }
      break;

    case 'attack':
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
      if (targetTile) {
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
            let actualDamage = damageResult.damage;

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
            result.targetType = target.type; // 'player' or 'enemy'

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
      }
      break;

    case 'skill':
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
      if (targetTile && skillId) {
        const skill = getSkillDefinition(unit.class, skillId);
        if (!skill) {
          result.error = 'Invalid skill';
          break;
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
        // Self-targeting skills (selfBuff, cleanse, healPercent without targetAlly) don't need range check
        const isSelfTargetingSkill = skill.selfBuff || skill.cleanse || (skill.healPercent && !skill.targetAlly);
        if (!isSelfTargetingSkill) {
          const skillRange = skill.range || 1; // Default range of 1 if not specified
          const skillDistance = getManhattanDistance(unit.tileX, unit.tileY, targetTile.x, targetTile.y);

          if (skillDistance > skillRange) {
            result.error = `Target out of skill range (max: ${skillRange}, attempted: ${skillDistance})`;
            return result;
          }
        }

        // Calculate MP cost (use mpCost from skill definition, or derive from baseCost)
        const mpCost = skill.mpCost || (skill.baseCost ? Math.floor(skill.baseCost / 10) : 5);
        if (unit.mp < mpCost) {
          result.error = 'Not enough MP';
          break;
        }

        // Deduct MP
        unit.mp -= mpCost;
        result.skillUsed = skillId;
        result.mpCost = mpCost;
        result.skillEffects = [];

        // Handle self-targeting skills (buffs, heals)
        if (skill.selfBuff || skill.healPercent || skill.cleanse) {
          // Self-buff or self-heal
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
            // Remove all negative status effects
            unit.statusEffects = (unit.statusEffects || []).filter(e =>
              ['rage', 'fortify', 'haste', 'regen'].includes(e.type)
            );
            result.skillEffects.push({ type: 'cleanse', targetId: unit.id });
          }
          // Set skill cooldown if defined
          if (skill.cooldown && skill.cooldown > 0) {
            unit.skillCooldowns[skillId] = skill.cooldown;
          }
          unit.actUsed = true;
          break;
        }

        // Handle movement skills (like Pounce, Charge Rush)
        // These skills teleport the unit to an adjacent tile of the target before attacking
        if (skill.movement) {
          const adjacentTile = findAdjacentTileToTarget(state, unit, targetTile);
          if (adjacentTile) {
            result.leapedFrom = { x: unit.tileX, y: unit.tileY };
            unit.tileX = adjacentTile.x;
            unit.tileY = adjacentTile.y;
            result.leapedTo = { x: adjacentTile.x, y: adjacentTile.y };
            result.isLeapAttack = true;
          }
          // Note: Movement skills don't consume the move action - they're part of the skill
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
          // Set skill cooldown if defined
          if (skill.cooldown && skill.cooldown > 0) {
            unit.skillCooldowns[skillId] = skill.cooldown;
          }
          unit.actUsed = true;
          break;
        }

        // Check if this is an AoE skill
        if (skill.aoeRadius && skill.aoeRadius > 0) {
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

          // Apply damage/effects to each unit in the AoE
          const power = skill.power || 150;
          const damageType = skill.damageType || 'physical';
          const hits = skill.hits || 1;

          let totalAoEDamage = 0; // Track total AoE damage for lifesteal

          for (const { unit: affectedUnit, isCenter } of affectedUnits) {
            // Calculate damage for this target
            const damageResult = damageType === 'magical'
              ? calculateMagicalDamage(unit, affectedUnit, power)
              : calculatePhysicalDamage(unit, affectedUnit, power);

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
              // Death save triggered - survive with 1 HP
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
              deathSaveTrigger: wouldKill && affectedUnit.hp === 1
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
                  type: affectedUnit.type === unit.type ? 'debuff' : 'debuff',
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
            result.damage = result.aoeTargets.reduce((sum, t) => sum + t.damage, 0);
            result.targetId = primaryTarget.targetId;
            result.targetType = primaryTarget.targetType;
          } else {
            // No units hit - still show AoE animation on tiles
            result.attackedEmptyTile = true;
            result.targetTile = targetTile;
          }
        } else if (target) {
          // Single-target skill: Apply skill damage (using power from skill or default 150%)
          const power = skill.power || 150;
          const damageType = skill.damageType || 'physical';
          const damageResult = damageType === 'magical'
            ? calculateMagicalDamage(unit, target, power)
            : calculatePhysicalDamage(unit, target, power);

          // Apply damage (multiply by hits if multi-hit skill)
          const hits = skill.hits || 1;
          let totalDamage = 0;
          for (let i = 0; i < hits; i++) {
            totalDamage += damageResult.damage;
          }

          // Apply damage with death save check
          const wouldKill = target.hp - totalDamage <= 0;
          if (wouldKill && traitService.checkDeathSave(target)) {
            // Death save triggered - survive with 1 HP
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

          // Apply lifesteal trait (heal attacker for % of damage dealt)
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
        } else {
          // Empty tile skill - animation plays but no damage
          result.attackedEmptyTile = true;
          result.targetTile = targetTile;
        }
        // Set skill cooldown if defined (applies to both hit and miss)
        if (skill.cooldown && skill.cooldown > 0) {
          unit.skillCooldowns[skillId] = skill.cooldown;
        }
        unit.actUsed = true;
      }
      break;

    case 'item':
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
      // Item usage requires itemId in skillId parameter (reusing same field)
      if (skillId) {
        result.itemUsed = skillId;
        result.itemEffects = [];

        // Look up item from appropriate source:
        // - Players use state.consumables (loaded from database inventory)
        // - NPCs use unit.consumables (generated by npcItemService)
        const consumables = unit.type === 'player' ? (state.consumables || []) : (unit.consumables || []);
        const consumable = consumables.find(c => c.itemId === parseInt(skillId, 10) || c.itemId === skillId);

        if (!consumable || consumable.quantity <= 0) {
          result.error = 'Item not available';
          break;
        }

        // Find target (self or ally at tile)
        let itemTarget = unit; // Default to self
        if (targetTile) {
          // For NPCs, can target self or allied NPCs; for players, can target self or allied players
          const tileTarget = state.units.find(u =>
            u.tileX === targetTile.x && u.tileY === targetTile.y && u.type === unit.type
          );
          if (tileTarget) {
            itemTarget = tileTarget;
          }
        }

        // Apply item effects based on effectType from database
        const effectType = consumable.effectType || consumable.name?.toLowerCase();
        const effectValue = consumable.effectValue || 25; // Default to 25% if not specified

        // Handle different effect types
        if (effectType === 'hp_restore' || consumable.name?.toLowerCase().includes('potion')) {
          const healAmount = Math.floor(itemTarget.maxHp * effectValue / 100);
          itemTarget.hp = Math.min(itemTarget.maxHp, itemTarget.hp + healAmount);
          result.healing = healAmount;
          result.itemEffects.push({ type: 'heal', amount: healAmount, targetId: itemTarget.id });
        }

        if (effectType === 'mp_restore' || consumable.name?.toLowerCase().includes('ether')) {
          const mpAmount = Math.floor(itemTarget.maxMp * effectValue / 100);
          itemTarget.mp = Math.min(itemTarget.maxMp, itemTarget.mp + mpAmount);
          result.mpRestored = mpAmount;
          result.itemEffects.push({ type: 'mpRestore', amount: mpAmount, targetId: itemTarget.id });
        }

        if (effectType === 'elixir' || consumable.name?.toLowerCase().includes('elixir')) {
          const healAmount = Math.floor(itemTarget.maxHp * effectValue / 100);
          const mpAmount = Math.floor(itemTarget.maxMp * effectValue / 100);
          itemTarget.hp = Math.min(itemTarget.maxHp, itemTarget.hp + healAmount);
          itemTarget.mp = Math.min(itemTarget.maxMp, itemTarget.mp + mpAmount);
          result.itemEffects.push({ type: 'heal', amount: healAmount, targetId: itemTarget.id });
          result.itemEffects.push({ type: 'mpRestore', amount: mpAmount, targetId: itemTarget.id });
        }

        if (effectType === 'cleanse' || consumable.name?.toLowerCase().includes('antidote')) {
          const cleansableEffects = ['poison', 'blind', 'silence', 'slow', 'burn'];
          itemTarget.statusEffects = (itemTarget.statusEffects || []).filter(e =>
            !cleansableEffects.includes(e.type)
          );
          result.itemEffects.push({ type: 'cleanse', effects: cleansableEffects, targetId: itemTarget.id });
        }

        if (effectType === 'revive' || consumable.name?.toLowerCase().includes('phoenix')) {
          if (itemTarget.hp <= 0) {
            const reviveHp = Math.floor(itemTarget.maxHp * effectValue / 100);
            itemTarget.hp = reviveHp;
            result.itemEffects.push({ type: 'revive', amount: reviveHp, targetId: itemTarget.id });
          }
        }

        // Consume the item in battle state
        consumable.quantity--;
        if (consumable.quantity <= 0) {
          state.consumables = consumables.filter(c => c.itemId !== consumable.itemId);
        }

        // Mark inventory item for consumption (will be processed after battle or immediately)
        result.consumedInventoryId = consumable.inventoryId;
        result.targetId = itemTarget.id;
        result.itemName = consumable.name;
        unit.actUsed = true;
      }
      break;

    case 'wait':
      // Wait ends turn immediately, skipping any remaining actions
      result.turnEnded = true;
      break;
  }

  // Determine if turn is complete
  // Turn ends if: wait was pressed, OR both move and act have been used
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
 * Advance to the next actor using CT system
 * Consumes the current actor's CT and finds the next one
 * @param {Object} state - Battle state
 */
function advanceToNextActorWithCT(state) {
  // Consume CT for the unit that just acted
  const currentActor = state.units.find(u => u.id === state.activeUnitId);
  if (currentActor) {
    consumeCT(currentActor);

    // Decrement skill cooldowns for the actor whose turn just ended
    if (currentActor.skillCooldowns) {
      for (const skillId in currentActor.skillCooldowns) {
        if (currentActor.skillCooldowns[skillId] > 0) {
          currentActor.skillCooldowns[skillId]--;
        }
      }
    }
  }

  // Find the next actor
  advanceToNextActor(state);
}

/**
 * Check if battle has ended
 * @param {Object} state - Battle state
 * @returns {string} 'active' | 'victory' | 'defeat'
 */
function checkBattleEnd(state) {
  const playerUnitsAlive = state.units.filter(u => u.type === 'player' && u.hp > 0).length;
  const enemyUnitsAlive = state.units.filter(u => u.type === 'enemy' && u.hp > 0).length;

  if (enemyUnitsAlive === 0) return 'victory';
  if (playerUnitsAlive === 0) return 'defeat';
  return 'active';
}

export {
  // Damage calculations
  calculatePhysicalDamage,
  calculateMagicalDamage,
  calculateInitiative,
  sortByInitiative,
  // Status effects
  processStatusEffects,
  canUnitAct,
  canUnitMove,
  canUnitUseSkills,
  resetTurnState,
  shouldAutoEndTurn,
  applyStatusEffect,
  checkHit,
  // Rewards
  calculateExperienceReward,
  calculateGoldReward,
  // Movement and range
  getMovementRange,
  getAttackRange,
  getManhattanDistance,
  getSkillDefinition,
  // Unified tile/action availability
  getReachableTiles,
  getTargetsInRange,
  getAvailableActions,
  getOppositeType,
  // AoE system
  getAoETiles,
  // Charge time system
  calculateChargeTime,
  checkChargeInterrupt,
  getChargingDamageMultiplier,
  startCharging,
  cancelCharging,
  updateChargeProgress,
  // CT-based turn system
  initializeCT,
  advanceCTUntilReady,
  getNextActor,
  consumeCT,
  predictTurnOrder,
  advanceToNextActor,
  // Action processing
  processAction,
  advanceToNextActorWithCT,
  checkBattleEnd,
  // Pathfinding (for AI movement validation)
  calculatePathCost
};
