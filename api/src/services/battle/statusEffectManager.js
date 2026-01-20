/**
 * Status Effect Manager - Status effects and turn state management
 */

import * as traitService from '../traitService.js';

/**
 * Process status effects at turn start
 * Also processes trait-based HP regeneration
 */
export function processStatusEffects(unit) {
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
      case 'poison': {
        const poisonDamage = Math.floor(unit.maxHp * 0.05);
        unit.hp = Math.max(0, unit.hp - poisonDamage);
        results.push({ type: 'poison_damage', damage: poisonDamage });
        break;
      }

      case 'burn': {
        const burnDamage = Math.floor(unit.maxHp * 0.03);
        unit.hp = Math.max(0, unit.hp - burnDamage);
        results.push({ type: 'burn_damage', damage: burnDamage });
        break;
      }

      case 'regen': {
        const healAmount = Math.floor(unit.maxHp * 0.05);
        unit.hp = Math.min(unit.maxHp, unit.hp + healAmount);
        results.push({ type: 'regen_heal', amount: healAmount });
        break;
      }
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
export function canUnitAct(unit) {
  if (!unit.statusEffects) return true;

  const preventActing = ['stun', 'freeze', 'sleep'];
  return !unit.statusEffects.some(e => preventActing.includes(e.type));
}

/**
 * Check if unit can move (status effects only - ignores turn state)
 */
export function canUnitMove(unit) {
  if (!unit.statusEffects) return true;

  const preventMovement = ['stun', 'freeze', 'sleep', 'root'];
  return !unit.statusEffects.some(e => preventMovement.includes(e.type));
}

/**
 * Check if unit can use skills (status effects only)
 */
export function canUnitUseSkills(unit) {
  if (!unit.statusEffects) return true;

  const preventSkills = ['stun', 'freeze', 'sleep', 'silence'];
  return !unit.statusEffects.some(e => preventSkills.includes(e.type));
}

/**
 * Reset unit turn state for a new turn (two-action system)
 */
export function resetTurnState(unit) {
  unit.moveUsed = false;
  unit.actUsed = false;
  unit.turnPhase = 'ready';
  unit.hasActed = false;
}

/**
 * Check if unit's turn should auto-end (cannot do any action)
 */
export function shouldAutoEndTurn(unit) {
  const canMove = canUnitMove(unit) && !unit.moveUsed;
  const canAct = canUnitAct(unit) && !unit.actUsed;
  return !canMove && !canAct;
}

/**
 * Apply a status effect to a unit
 */
export function applyStatusEffect(unit, effectType, duration = 3) {
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
 * Initialize two-action turn state for a unit if not present (migration support)
 * @param {Object} unit - The unit to initialize
 */
export function initializeTurnState(unit) {
  if (typeof unit.moveUsed !== 'boolean') {
    unit.moveUsed = false;
    unit.actUsed = false;
    unit.turnPhase = 'ready';
  }
}
