/**
 * Status Effect Manager - Status effects and turn state management
 */

import * as traitService from '../traitService.js';
import { PURIFY_EFFECTS, PREVENT_ACTING, PREVENT_MOVEMENT, PREVENT_SKILLS } from '../../../../shared/battleMath.js';
import { applyHealingReceivedBonus } from '../zodiacCollectionBonusService.js';

/**
 * Process status effects at turn start
 * Also processes trait-based HP regeneration
 */
export function processStatusEffects(unit) {
  const results = [];

  // Process trait-based HP regen (Regeneration trait: 2% per turn)
  const traitHPRegen = applyHealingReceivedBonus(
    unit,
    traitService.calculateHPRegen(unit)
  );
  if (traitHPRegen > 0) {
    unit.hp = Math.min(unit.maxHp, unit.hp + traitHPRegen);
    results.push({ type: 'trait_regen', amount: traitHPRegen });
  }

  if (!unit.statusEffects || unit.statusEffects.length === 0) {
    return results;
  }

  for (const effect of unit.statusEffects) {

    // Apply effect damage/healing
    switch (effect.type) {
      case 'poison': {
        const poisonDamage = Math.floor(unit.maxHp * 0.05);
        results.push(applyPeriodicDamage(unit, poisonDamage, 'poison_damage'));
        break;
      }

      case 'burn': {
        const burnDamage = Math.floor(unit.maxHp * 0.03);
        results.push(applyPeriodicDamage(unit, burnDamage, 'burn_damage'));
        break;
      }

      case 'zodiac_poison': {
        const poisonDamage = Math.floor(
          unit.maxHp * (effect.damagePercent || 0.03)
        );
        results.push(applyPeriodicDamage(
          unit,
          poisonDamage,
          'zodiac_poison'
        ));
        break;
      }

      case 'regen': {
        if (unit.hp <= 0) break;
        const healAmount = applyHealingReceivedBonus(
          unit,
          Math.floor(unit.maxHp * 0.05)
        );
        unit.hp = Math.min(unit.maxHp, unit.hp + healAmount);
        results.push({ type: 'regen_heal', amount: healAmount });
        break;
      }
    }

    // Duration reaches zero at turn start, but the effect remains authoritative
    // until turn end. This gives restrictive duration-1 effects one full owner
    // turn instead of removing them before action validation.
    if (Number.isFinite(effect.duration)) {
      effect.duration--;
      if (effect.duration <= 0) {
        effect.duration = 0;
        effect.expiresAfterTurn = true;
      }
    }
  }

  return results;
}

/**
 * Remove effects whose final owner turn has completed.
 * @param {Object} unit - Unit whose turn just ended
 * @returns {Array<Object>} Expiration records
 */
export function finalizeStatusEffects(unit) {
  if (!Array.isArray(unit?.statusEffects)) return [];

  const expired = unit.statusEffects
    .filter(effect => effect.expiresAfterTurn)
    .map(effect => ({ type: 'effect_expired', effect: effect.type }));
  unit.statusEffects = unit.statusEffects.filter(
    effect => !effect.expiresAfterTurn
  );
  return expired;
}

/**
 * Check if unit can act (status effects only - ignores turn state)
 */
export function canUnitAct(unit) {
  if (!unit.statusEffects) return true;

  return !unit.statusEffects.some(e => PREVENT_ACTING.includes(e.type));
}

/**
 * Check if unit can move (status effects only - ignores turn state)
 */
export function canUnitMove(unit) {
  if (!unit.statusEffects) return true;

  return !unit.statusEffects.some(e => PREVENT_MOVEMENT.includes(e.type));
}

/**
 * Check if unit can use skills (status effects only)
 */
export function canUnitUseSkills(unit) {
  if (!unit.statusEffects) return true;

  return !unit.statusEffects.some(e => PREVENT_SKILLS.includes(e.type));
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
    delete existing.expiresAfterTurn;
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

// ============================================================================
// ZODIAC SIGNATURE ABILITIES
// ============================================================================

import { ZODIAC_SHRINE_BUFFS } from '../../../../shared/constants.js';
import {
  areAllies,
  getAttackRange,
  getManhattanDistance
} from './movementService.js';

/**
 * Check if a unit has an active zodiac signature ability
 * @param {Object} unit - Battle unit
 * @param {string} abilityKey - e.g., 'rams_charge', 'moonshield'
 * @returns {boolean}
 */
export function hasZodiacAbility(unit, abilityKey) {
  if (!unit.zodiacAbilities || !Array.isArray(unit.zodiacAbilities)) {
    return false;
  }
  return unit.zodiacAbilities.some(ability => ability.key === abilityKey);
}

/**
 * Check if a unit has any unused zodiac ability
 * @param {Object} unit - Battle unit
 * @returns {Object|null} First available ability or null
 */
export function getAvailableZodiacAbility(unit) {
  if (!unit.zodiacAbilities || !Array.isArray(unit.zodiacAbilities)) {
    return null;
  }
  if (!unit.usedZodiacAbilities) {
    unit.usedZodiacAbilities = [];
  }
  return unit.zodiacAbilities.find(
    ability => !unit.usedZodiacAbilities.includes(ability.key)
  ) || null;
}

/**
 * Get all available (unused) zodiac abilities for a unit
 * @param {Object} unit - Battle unit
 * @returns {Array} Array of available abilities
 */
export function getAvailableZodiacAbilities(unit) {
  if (!unit.zodiacAbilities || !Array.isArray(unit.zodiacAbilities)) {
    return [];
  }
  if (!unit.usedZodiacAbilities) {
    unit.usedZodiacAbilities = [];
  }
  return unit.zodiacAbilities.filter(
    ability => !unit.usedZodiacAbilities.includes(ability.key)
  );
}

/**
 * Mark zodiac ability as used for this battle
 * @param {Object} unit - Battle unit
 * @param {string} abilityKey - Ability key to mark as used
 */
export function markZodiacAbilityUsed(unit, abilityKey) {
  if (!unit.usedZodiacAbilities) {
    unit.usedZodiacAbilities = [];
  }
  if (!unit.usedZodiacAbilities.includes(abilityKey)) {
    unit.usedZodiacAbilities.push(abilityKey);
  }
}

/**
 * Return the player units that share one account-level shrine blessing.
 * Blessings are available once per battle for the owning party, not once for
 * every character that received the same ability in its battle snapshot.
 */
function getZodiacAbilityScopeUnits(battleState, sourceUnit, abilityKey) {
  if (sourceUnit?.ownerId == null || !Array.isArray(battleState?.units)) {
    return [sourceUnit];
  }

  const scopeUnits = battleState.units.filter(unit =>
    unit?.type === 'player'
    && unit.ownerId === sourceUnit.ownerId
    && hasZodiacAbility(unit, abilityKey)
  );
  return scopeUnits.includes(sourceUnit)
    ? scopeUnits
    : [sourceUnit, ...scopeUnits];
}

/**
 * Apply zodiac signature ability effect
 * Called when the ability is triggered in battle
 *
 * @param {Object} battleState - Current battle state
 * @param {Object} sourceUnit - Unit using the ability
 * @param {string} abilityKey - Ability to use
 * @param {Object} targetUnit - Target (if applicable)
 * @returns {Object} { success, message, effects, error }
 */
export function applyZodiacAbility(battleState, sourceUnit, abilityKey, targetUnit = null) {
  const result = {
    success: false,
    message: '',
    effects: [],
    abilityKey
  };

  // Validate the unit has this ability
  if (!hasZodiacAbility(sourceUnit, abilityKey)) {
    result.error = 'Unit does not have this zodiac ability';
    return result;
  }

  const blessingUnits = getZodiacAbilityScopeUnits(
    battleState,
    sourceUnit,
    abilityKey
  );
  if (blessingUnits.some(unit =>
    unit.usedZodiacAbilities?.includes(abilityKey)
  )) {
    result.error = 'This zodiac ability has already been used in this battle';
    return result;
  }

  // Get ability info for display
  const zodiacSign = Object.keys(ZODIAC_SHRINE_BUFFS).find(
    sign => ZODIAC_SHRINE_BUFFS[sign].signatureAbility === abilityKey
  );
  const abilityInfo = zodiacSign ? ZODIAC_SHRINE_BUFFS[zodiacSign] : null;

  // Apply ability effects based on type
  switch (abilityKey) {
    case 'rams_charge':
      // Mark next attack for +25% crit
      sourceUnit.nextAttackCritBonus = 0.25;
      result.effects.push({
        type: 'buff',
        target: 'self',
        effect: 'crit_bonus',
        value: 0.25
      });
      result.message = "Ram's Charge activated! The next basic attack gains +25 percentage points of crit chance.";
      break;

    case 'unmovable':
      // Add immunity to push/pull for entire battle
      applyStatusEffect(sourceUnit, 'unmovable', 999);
      result.effects.push({
        type: 'buff',
        target: 'self',
        effect: 'unmovable',
        duration: 'battle'
      });
      result.message = 'Unmovable activated! Immune to push/pull effects.';
      break;

    case 'twin_strike':
      // Mark next attack to hit twice at 60%
      sourceUnit.nextAttackHitsTwice = true;
      sourceUnit.twinStrikeDamageMultiplier = 0.6;
      result.effects.push({
        type: 'buff',
        target: 'self',
        effect: 'twin_strike',
        value: 0.6
      });
      result.message = 'Twin Strike activated! The next basic attack hits twice at 60% damage.';
      break;

    case 'moonshield':
      // Add damage absorption shield (blocks 1 hit)
      sourceUnit.damageShield = 1;
      result.effects.push({
        type: 'buff',
        target: 'self',
        effect: 'damage_shield',
        value: 1
      });
      result.message = 'Moonshield activated! Next damage instance will be blocked.';
      break;

    case 'roar': {
      // Reduce adjacent enemies' CT by 30
      const adjacentEnemies = battleState.units.filter(u => {
        if (areAllies(u, sourceUnit)) return false;
        if (u.hp <= 0) return false;
        const dist = getManhattanDistance(
          sourceUnit.tileX, sourceUnit.tileY,
          u.tileX, u.tileY
        );
        return dist <= 1;
      });

      for (const enemy of adjacentEnemies) {
        enemy.ct = Math.max(0, (enemy.ct || 0) - 30);
        result.effects.push({
          type: 'debuff',
          target: enemy.id,
          targetName: enemy.name,
          effect: 'ct_reduction',
          value: 30
        });
      }
      result.message = adjacentEnemies.length > 0
        ? `Roar activated! ${adjacentEnemies.length} adjacent enemies lost 30 CT.`
        : 'Roar activated! No adjacent enemies to affect.';
      break;
    }

    case 'purify': {
      // Remove 1 debuff from self
      if (!sourceUnit.statusEffects) {
        sourceUnit.statusEffects = [];
      }
      const debuffTypes = PURIFY_EFFECTS;
      const debuffIndex = sourceUnit.statusEffects.findIndex(e => debuffTypes.includes(e.type));
      if (debuffIndex >= 0) {
        const removed = sourceUnit.statusEffects.splice(debuffIndex, 1)[0];
        result.effects.push({
          type: 'cleanse',
          target: 'self',
          effect: removed.type
        });
        result.message = `Purify activated! Removed ${removed.type} debuff.`;
      } else {
        result.message = 'Purify activated! No debuffs to remove.';
      }
      break;
    }

    case 'balance':
      // Mark next attack for lifesteal
      sourceUnit.nextAttackLifesteal = true;
      result.effects.push({
        type: 'buff',
        target: 'self',
        effect: 'lifesteal'
      });
      result.message = 'Balance activated! The next basic attack heals for the actual damage dealt.';
      break;

    case 'venom_sting': {
      // Apply poison to target (3% HP for 4 turns)
      if (!targetUnit) {
        result.error = 'Venom Sting requires a target';
        return result;
      }
      if (areAllies(targetUnit, sourceUnit)) {
        result.error = 'Cannot poison allies';
        return result;
      }
      if (targetUnit.hp <= 0) {
        result.error = 'Target is already defeated';
        return result;
      }
      // Check range (within attack range)
      const venomDistance = getManhattanDistance(
        sourceUnit.tileX, sourceUnit.tileY,
        targetUnit.tileX, targetUnit.tileY
      );
      if (venomDistance > getAttackRange(sourceUnit)) {
        result.error = 'Target is out of range';
        return result;
      }
      // Apply zodiac poison (3% HP damage per turn)
      if (!targetUnit.statusEffects) {
        targetUnit.statusEffects = [];
      }
      const existingPoison = targetUnit.statusEffects.find(e => e.type === 'zodiac_poison');
      if (existingPoison) {
        existingPoison.duration = Math.max(existingPoison.duration, 4);
      } else {
        targetUnit.statusEffects.push({
          type: 'zodiac_poison',
          duration: 4,
          damagePercent: 0.03
        });
      }
      result.effects.push({
        type: 'debuff',
        target: targetUnit.id,
        targetName: targetUnit.name,
        effect: 'zodiac_poison',
        duration: 4
      });
      result.message = `Venom Sting activated! ${targetUnit.name} is poisoned for 4 turns.`;
      break;
    }

    case 'celestial_arrow':
      // Add +2 range to next attack
      sourceUnit.nextAttackRangeBonus = 2;
      result.effects.push({
        type: 'buff',
        target: 'self',
        effect: 'range_bonus',
        value: 2
      });
      result.message = 'Celestial Arrow activated! The next basic attack has +2 range.';
      break;

    case 'mountains_endurance': {
      // Zodiac abilities are free actions used after the active owner's
      // turn-start status processing. The activation turn is therefore the
      // first of the advertised two turns, leaving one future owner-turn
      // countdown to process.
      applyStatusEffect(sourceUnit, 'defense_up', 1);
      // Preserve the legacy value while also using the object-form modifiers
      // consumed by both physical and magical damage formulas.
      const defEffect = sourceUnit.statusEffects.find(e => e.type === 'defense_up');
      if (defEffect) {
        defEffect.value = 0.25;
        defEffect.modifiers = {
          ...(defEffect.modifiers || {}),
          defense: 1.25,
          magicDefense: 1.25
        };
      }
      result.effects.push({
        type: 'buff',
        target: 'self',
        effect: 'defense_up',
        value: 0.25,
        duration: 2
      });
      result.message = "Mountain's Endurance activated! +25% defense for 2 turns.";
      break;
    }

    case 'cascade': {
      // Heal 20% max HP
      const healAmount = applyHealingReceivedBonus(
        sourceUnit,
        Math.floor(sourceUnit.maxHp * 0.2)
      );
      const actualHeal = Math.min(healAmount, sourceUnit.maxHp - sourceUnit.hp);
      sourceUnit.hp = Math.min(sourceUnit.maxHp, sourceUnit.hp + healAmount);
      result.effects.push({
        type: 'heal',
        target: 'self',
        value: actualHeal
      });
      result.message = `Cascade activated! Healed ${actualHeal} HP.`;
      break;
    }

    case 'dreamwave': {
      // 50% chance to sleep target for 1 turn
      if (!targetUnit) {
        result.error = 'Dreamwave requires a target';
        return result;
      }
      if (areAllies(targetUnit, sourceUnit)) {
        result.error = 'Cannot put allies to sleep';
        return result;
      }
      if (targetUnit.hp <= 0) {
        result.error = 'Target is already defeated';
        return result;
      }
      // Check range
      const dreamDistance = getManhattanDistance(
        sourceUnit.tileX, sourceUnit.tileY,
        targetUnit.tileX, targetUnit.tileY
      );
      if (dreamDistance > getAttackRange(sourceUnit)) {
        result.error = 'Target is out of range';
        return result;
      }
      // 50% chance to apply sleep
      if (Math.random() < 0.5) {
        applyStatusEffect(targetUnit, 'sleep', 1);
        result.effects.push({
          type: 'debuff',
          target: targetUnit.id,
          targetName: targetUnit.name,
          effect: 'sleep',
          duration: 1
        });
        result.message = `Dreamwave activated! ${targetUnit.name} fell asleep.`;
      } else {
        result.effects.push({
          type: 'resisted',
          target: targetUnit.id,
          targetName: targetUnit.name
        });
        result.message = `Dreamwave activated! ${targetUnit.name} resisted the effect.`;
      }
      break;
    }

    default:
      result.error = `Unknown zodiac ability: ${abilityKey}`;
      return result;
  }

  // Persist the account-wide, once-per-battle use in every owning unit's
  // battle snapshot. Other PvP owners retain their own use of the blessing.
  for (const unit of blessingUnits) {
    markZodiacAbilityUsed(unit, abilityKey);
  }
  result.success = true;
  result.abilityName = abilityInfo?.name || abilityKey;

  return result;
}

/**
 * Process zodiac poison at turn start (different from regular poison - 3% vs 5%)
 * @param {Object} unit - The unit to process
 * @returns {Object|null} Damage result or null
 */
export function processZodiacPoison(unit) {
  if (!unit.statusEffects) return null;

  const zodiacPoison = unit.statusEffects.find(e => e.type === 'zodiac_poison');
  if (!zodiacPoison) return null;

  const damage = Math.floor(unit.maxHp * (zodiacPoison.damagePercent || 0.03));
  const result = applyPeriodicDamage(unit, damage, 'zodiac_poison');

  // This compatibility helper is not the production turn-start entry point.
  // Zodiac poison has no restrictive component, so immediate removal remains
  // safe for direct callers while processStatusEffects owns deferred expiry.
  zodiacPoison.duration--;
  if (zodiacPoison.duration <= 0) {
    unit.statusEffects = unit.statusEffects.filter(
      effect => effect !== zodiacPoison
    );
  }

  return result;
}

function applyPeriodicDamage(unit, incomingDamage, type) {
  if (unit.hp <= 0) {
    return { type, damage: 0, incomingDamage };
  }

  const shieldResult = checkMoonshield(unit, incomingDamage);
  if (shieldResult.blocked) {
    return {
      type,
      damage: 0,
      incomingDamage,
      blocked: true,
      blockedBy: 'moonshield'
    };
  }

  const hpBefore = unit.hp;
  const wouldKill = hpBefore - shieldResult.damage <= 0;
  let deathSaveTrigger = false;
  if (wouldKill && traitService.checkDeathSave(unit)) {
    unit.hp = 1;
    deathSaveTrigger = true;
  } else {
    unit.hp = Math.max(0, hpBefore - shieldResult.damage);
  }

  const damage = hpBefore - unit.hp;
  unit.damageTaken = (unit.damageTaken || 0) + damage;
  if (hpBefore > 0 && unit.hp <= 0) {
    unit.deaths = (unit.deaths || 0) + 1;
  }

  return {
    type,
    damage,
    incomingDamage,
    deathSaveTrigger
  };
}

/**
 * Check and consume moonshield when taking damage
 * @param {Object} unit - The unit taking damage
 * @param {number} damage - Incoming damage
 * @returns {Object} { blocked: boolean, damage: number }
 */
export function checkMoonshield(unit, damage) {
  if (damage > 0 && unit.damageShield && unit.damageShield > 0) {
    unit.damageShield--;
    return { blocked: true, damage: 0 };
  }
  return { blocked: false, damage };
}

/**
 * Get defense multiplier from defense_up status effect
 * @param {Object} unit - The unit to check
 * @returns {number} Defense multiplier (1.0 = no bonus)
 */
export function getDefenseMultiplier(unit) {
  if (!unit.statusEffects) return 1.0;

  const defenseUp = unit.statusEffects.find(e => e.type === 'defense_up');
  if (defenseUp && defenseUp.value) {
    return 1.0 + defenseUp.value;
  }
  return 1.0;
}
