/**
 * Battle Service - Damage calculations, status effects, and battle utilities
 */

/**
 * Calculate physical damage
 * Formula: (ATK + equipmentAttack + strength) * skillPower - (DEF + equipmentDefense + vitality * 0.5)
 * Equipment attack/defense bonuses are additive to base stats
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

  // Critical hit check (luck-based)
  const critChance = (attacker.luck || 10) / 200;
  const isCritical = Math.random() < critChance;
  const critMultiplier = isCritical ? 1.5 : 1.0;

  // Apply race bonuses
  let raceMultiplier = 1.0;
  if (attacker.race === 'orc') {
    raceMultiplier = 1.1; // +10% crit damage for orcs
  }

  const finalDamage = Math.floor(rawDamage * variance * critMultiplier * raceMultiplier);

  return {
    damage: Math.max(1, finalDamage),
    isCritical,
    variance
  };
}

/**
 * Calculate magical damage
 * Formula: (INT + equipmentMagicAttack) * skillPower - (INT_DEF + equipmentMagicDefense)
 * Equipment magic attack/defense bonuses are additive to base stats
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

  // Critical hit check
  const critChance = (attacker.luck || 10) / 200;
  const isCritical = Math.random() < critChance;
  const critMultiplier = isCritical ? 1.5 : 1.0;

  const finalDamage = Math.floor(rawDamage * variance * critMultiplier);

  return {
    damage: Math.max(1, finalDamage),
    isCritical,
    variance
  };
}

/**
 * Calculate initiative for turn order
 */
function calculateInitiative(unit) {
  return unit.agility + Math.floor(Math.random() * 10);
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
 */
function processStatusEffects(unit) {
  const results = [];

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
 * Check miss chance based on agility
 */
function checkHit(attacker, defender) {
  const baseHitChance = 0.95;
  const agilityDiff = defender.agility - attacker.agility;
  const dodgeBonus = Math.max(0, agilityDiff) * 0.01;

  // Check for blind status
  const isBlinded = attacker.statusEffects?.some(e => e.type === 'blind');
  const blindPenalty = isBlinded ? 0.3 : 0;

  const hitChance = Math.max(0.5, baseHitChance - dodgeBonus - blindPenalty);
  return Math.random() < hitChance;
}

/**
 * Calculate experience reward from battle
 */
function calculateExperienceReward(enemies, partyLevel) {
  let totalXP = 0;

  for (const enemy of enemies) {
    const baseXP = enemy.xpReward || (50 + (enemy.maxHp / 10));
    // Scale by level difference
    const levelDiff = (enemy.level || partyLevel) - partyLevel;
    const levelMultiplier = Math.max(0.5, Math.min(2.0, 1 + levelDiff * 0.1));
    totalXP += Math.floor(baseXP * levelMultiplier);
  }

  return totalXP;
}

/**
 * Calculate gold reward from battle
 */
function calculateGoldReward(enemies, difficultyTier = 1) {
  let totalGold = 0;

  for (const enemy of enemies) {
    const minGold = enemy.goldMin || (10 * difficultyTier);
    const maxGold = enemy.goldMax || (30 * difficultyTier);
    totalGold += Math.floor(minGold + Math.random() * (maxGold - minGold));
  }

  return totalGold;
}

/**
 * Get movement range based on class and status
 */
function getMovementRange(unit) {
  let baseRange = 3;

  // Class-based adjustments
  if (unit.class === 'monk' || unit.class === 'ninja') {
    baseRange = 4;
  } else if (unit.class === 'warrior' || unit.class === 'berserker') {
    baseRange = 3;
  } else if (unit.class === 'wizard' || unit.class === 'sorcerer') {
    baseRange = 2;
  }

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
 * Get attack range based on class
 */
function getAttackRange(unit) {
  // Ranged classes
  if (unit.class === 'wizard' || unit.class === 'sorcerer' || unit.class === 'chemist') {
    return 3;
  }
  // Melee with extended reach
  if (unit.class === 'monk' || unit.class === 'ninja') {
    return 2;
  }
  // Standard melee
  return 1;
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

module.exports = {
  calculatePhysicalDamage,
  calculateMagicalDamage,
  calculateInitiative,
  sortByInitiative,
  processStatusEffects,
  canUnitAct,
  canUnitMove,
  canUnitUseSkills,
  resetTurnState,
  shouldAutoEndTurn,
  applyStatusEffect,
  checkHit,
  calculateExperienceReward,
  calculateGoldReward,
  getMovementRange,
  getAttackRange,
  // AoE system
  getAoETiles,
  getUnitsInAoE,
  // Charge time system
  calculateChargeTime,
  checkChargeInterrupt,
  getChargingDamageMultiplier,
  startCharging,
  cancelCharging,
  updateChargeProgress,
  // CT-based turn system
  CT_THRESHOLD,
  initializeCT,
  advanceCTUntilReady,
  getNextActor,
  consumeCT,
  predictTurnOrder,
  advanceToNextActor
};
