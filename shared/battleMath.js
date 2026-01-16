/**
 * Battle Math - Damage formulas, hit/crit calculations for combat
 * SINGLE SOURCE OF TRUTH for battle calculations used by both server and client
 *
 * NOTE: These functions provide PREVIEW calculations for client-side UI.
 * The SERVER remains authoritative for actual damage - it uses these same
 * formulas but adds random variance and trait bonuses during execution.
 *
 * FORMULA DESIGN (FFT-inspired):
 * - Defense uses diminishing returns: reduction = DEF / (DEF + 100)
 * - CT system: ctGain = 5 + (AGI / 10) for diminishing returns on turn frequency
 * - Crit: 5% base + LCK/300 (max 50%)
 * - Evasion: 2% base + (defAGI - atkAGI)/400 + defLCK/400 (max 35%)
 * - Status resistance: 10% base + LCK/200 (max 50%)
 * - Elemental damage: 8 elements with resistance/weakness mechanics
 */

// Import elemental constants from shared constants
import {
  ELEMENTS,
  MAX_ELEMENTAL_RESISTANCE,
  RACIAL_RESISTANCES
} from './constants.js';

// ============================================================================
// CONSTANTS
// ============================================================================

// Defense scaling constants (diminishing returns)
export const PHYSICAL_DEFENSE_CONSTANT = 100;  // 100 DEF = 50% reduction
export const MAGIC_DEFENSE_CONSTANT = 80;      // 80 MDEF = 50% reduction

// CT system constants
export const CT_THRESHOLD = 100;
export const CT_BASE_GAIN = 5;
export const CT_AGI_DIVISOR = 10;

// Action CT costs (FFT-style)
export const CT_COST = {
  MOVE_AND_ACT: 100,
  MOVE_OR_ACT: 80,
  WAIT: 60
};

// Crit constants
export const BASE_CRIT_CHANCE = 0.05;          // 5% base
export const CRIT_LUCK_DIVISOR = 300;          // +1% per 3 LCK
export const MAX_CRIT_CHANCE = 0.50;           // 50% cap
export const BASE_CRIT_MULTIPLIER = 1.5;
export const CRIT_LUCK_DAMAGE_DIVISOR = 500;   // +0.2% crit damage per LCK
export const ORC_CRIT_BONUS = 0.15;            // Orcs get +15% crit damage

// Evasion/accuracy constants
export const BASE_EVASION = 0.02;              // 2% base dodge
export const EVASION_AGI_DIVISOR = 400;        // ±0.25% per AGI difference
export const EVASION_LUCK_DIVISOR = 400;       // +0.25% per defender LCK
export const MAX_EVASION = 0.35;               // 35% cap
export const MIN_EVASION = 0.02;               // 2% floor
export const BASE_ACCURACY = 0.95;             // 95% base hit
export const MIN_HIT_CHANCE = 0.50;            // 50% minimum hit
export const MAX_HIT_CHANCE = 0.98;            // 98% maximum hit
export const BLIND_PENALTY = 0.30;             // -30% accuracy when blinded

// Status resistance constants
export const BASE_STATUS_RESIST = 0.10;        // 10% base
export const STATUS_LUCK_DIVISOR = 200;        // +0.5% per LCK
export const MAX_STATUS_RESIST = 0.50;         // 50% cap

// Damage variance
export const DAMAGE_VARIANCE_MIN = 0.9;
export const DAMAGE_VARIANCE_MAX = 1.1;

// ============================================================================
// DAMAGE FORMULAS
// ============================================================================

/**
 * Calculate defense reduction using diminishing returns formula
 * Formula: reduction = defense / (defense + constant)
 *
 * @param {number} defense - Total defense value (stat + equipment)
 * @param {number} constant - Defense constant (100 for physical, 80 for magic)
 * @returns {number} Damage reduction as decimal (0 to ~0.8)
 */
export function calculateDefenseReduction(defense, constant) {
  if (defense <= 0) return 0;
  return defense / (defense + constant);
}

/**
 * Calculate physical damage preview (deterministic, no random variance)
 * Formula: (STR + weaponAttack) * skillPower * (1 - defenseReduction)
 * Defense reduction = (VIT + armorDefense) / ((VIT + armorDefense) + 100)
 *
 * @param {Object} attacker - Attacker unit with { strength, attack }
 * @param {Object} defender - Defender unit with { vitality, defense }
 * @param {number} skillPower - Skill power percentage (default 100)
 * @returns {Object} { minDamage, maxDamage, avgDamage, defenseReduction }
 */
export function calculatePhysicalDamage(attacker, defender, skillPower = 100) {
  // Base attack = strength + equipment attack bonus
  const attackPower = (attacker.strength || 0) + (attacker.attack || 0);
  const rawDamage = attackPower * (skillPower / 100);

  // Defense with diminishing returns
  const defensePower = (defender.vitality || 0) + (defender.defense || 0);
  const defenseReduction = calculateDefenseReduction(defensePower, PHYSICAL_DEFENSE_CONSTANT);

  // Apply defense reduction
  const reducedDamage = Math.max(1, rawDamage * (1 - defenseReduction));

  // Variance range is 0.9 - 1.1 (10% either way)
  const minDamage = Math.max(1, Math.floor(reducedDamage * DAMAGE_VARIANCE_MIN));
  const maxDamage = Math.max(1, Math.floor(reducedDamage * DAMAGE_VARIANCE_MAX));
  const avgDamage = Math.floor((minDamage + maxDamage) / 2);

  return { minDamage, maxDamage, avgDamage, defenseReduction };
}

/**
 * Calculate magical damage preview (deterministic, no random variance)
 * Formula: (INT + magicAttack) * skillPower * (1 - magicDefenseReduction)
 * Magic defense reduction = (INT/2 + magicDefense) / ((INT/2 + magicDefense) + 80)
 *
 * @param {Object} attacker - Attacker unit with { intelligence, magicAttack }
 * @param {Object} defender - Defender unit with { intelligence, magicDefense }
 * @param {number} skillPower - Skill power percentage (default 100)
 * @returns {Object} { minDamage, maxDamage, avgDamage, defenseReduction }
 */
export function calculateMagicalDamage(attacker, defender, skillPower = 100) {
  // Base magic attack = intelligence + equipment magic attack bonus
  const magicAttackPower = (attacker.intelligence || 0) + (attacker.magicAttack || 0);
  const rawDamage = magicAttackPower * (skillPower / 100);

  // Magic defense: INT/2 + equipment magic defense (INT provides some innate magic resist)
  const defenderInt = defender.intelligence || 0;
  const magicDefensePower = Math.floor(defenderInt / 2) + (defender.magicDefense || 0);
  const defenseReduction = calculateDefenseReduction(magicDefensePower, MAGIC_DEFENSE_CONSTANT);

  // Apply defense reduction
  const reducedDamage = Math.max(1, rawDamage * (1 - defenseReduction));

  // Variance range is 0.9 - 1.1 (10% either way)
  const minDamage = Math.max(1, Math.floor(reducedDamage * DAMAGE_VARIANCE_MIN));
  const maxDamage = Math.max(1, Math.floor(reducedDamage * DAMAGE_VARIANCE_MAX));
  const avgDamage = Math.floor((minDamage + maxDamage) / 2);

  return { minDamage, maxDamage, avgDamage, defenseReduction };
}

/**
 * Calculate healing preview
 * Formula: (INT + magicAttack) * skillPower
 *
 * @param {Object} caster - Healer unit with { intelligence, magicAttack }
 * @param {Object} target - Target unit with { hp, maxHp }
 * @param {number} skillPower - Skill power percentage (default 100)
 * @returns {Object} { minHeal, maxHeal, effectiveHeal, isOverheal }
 */
export function calculateHealing(caster, target, skillPower = 100) {
  const healPower = (caster.intelligence || 0) + (caster.magicAttack || 0);
  const baseHeal = healPower * (skillPower / 100);

  // Variance range is 0.9 - 1.1 (10% either way)
  const minHeal = Math.max(1, Math.floor(baseHeal * DAMAGE_VARIANCE_MIN));
  const maxHeal = Math.max(1, Math.floor(baseHeal * DAMAGE_VARIANCE_MAX));

  // Calculate how much HP target is missing
  const targetMaxHp = target.maxHp || target.hpMax || 100;
  const targetCurrentHp = target.hp || target.currentHp || 0;
  const targetMissingHp = targetMaxHp - targetCurrentHp;
  const effectiveHeal = Math.min(maxHeal, targetMissingHp);
  const isOverheal = maxHeal > targetMissingHp;

  return { minHeal, maxHeal, effectiveHeal, isOverheal };
}

// ============================================================================
// CRITICAL HIT FORMULAS
// ============================================================================

/**
 * Calculate critical hit chance
 * Formula: 5% base + LCK/300, capped at 50%
 *
 * @param {Object} attacker - Attacker unit with { luck }
 * @param {number} traitBonus - Additional crit chance from traits (default 0)
 * @returns {number} Crit chance from 0 to 0.50
 */
export function calculateCritChance(attacker, traitBonus = 0) {
  const luck = attacker.luck || 0;
  const luckBonus = luck / CRIT_LUCK_DIVISOR;
  return Math.min(MAX_CRIT_CHANCE, BASE_CRIT_CHANCE + luckBonus + traitBonus);
}

/**
 * Calculate critical hit damage multiplier
 * Formula: 1.5 base + LCK/500 + race bonuses
 * Orcs get +15% crit damage base
 *
 * @param {Object} attacker - Attacker unit with { race, luck }
 * @returns {number} Critical multiplier (1.5+)
 */
export function calculateCritMultiplier(attacker) {
  const luck = attacker.luck || 0;
  const luckBonus = luck / CRIT_LUCK_DAMAGE_DIVISOR;

  let multiplier = BASE_CRIT_MULTIPLIER + luckBonus;

  // Orcs get +15% crit damage bonus
  if (attacker.race === 'orc') {
    multiplier += ORC_CRIT_BONUS;
  }

  return multiplier;
}

// ============================================================================
// HIT/EVASION FORMULAS
// ============================================================================

/**
 * Calculate evasion (dodge chance)
 * Formula: 2% base + (defAGI - atkAGI)/400 + defLCK/400
 * Clamped between 2% and 35%
 *
 * @param {Object} attacker - Attacker unit with { agility }
 * @param {Object} defender - Defender unit with { agility, luck }
 * @param {number} traitBonus - Additional evasion from traits (default 0)
 * @returns {number} Evasion chance from 0.02 to 0.35
 */
export function calculateEvasion(attacker, defender, traitBonus = 0) {
  const attackerAgility = attacker.agility || 0;
  const defenderAgility = defender.agility || 0;
  const defenderLuck = defender.luck || 0;

  // AGI difference bonus (can be negative if attacker faster)
  const agilityDiff = defenderAgility - attackerAgility;
  const agiBonus = agilityDiff / EVASION_AGI_DIVISOR;

  // Luck bonus for defender
  const luckBonus = defenderLuck / EVASION_LUCK_DIVISOR;

  // Total evasion
  const evasion = BASE_EVASION + agiBonus + luckBonus + traitBonus;

  return Math.max(MIN_EVASION, Math.min(MAX_EVASION, evasion));
}

/**
 * Calculate hit chance (accuracy vs evasion)
 * Formula: 95% base - evasion - blindPenalty + accuracyBonus
 * Clamped between 50% and 98%
 *
 * @param {Object} attacker - Attacker unit with { agility, statusEffects }
 * @param {Object} defender - Defender unit with { agility, luck }
 * @param {number} accuracyBonus - Additional accuracy from traits (default 0)
 * @param {number} evasionBonus - Additional evasion from traits (default 0)
 * @returns {number} Hit chance from 0.50 to 0.98
 */
export function calculateHitChance(attacker, defender, accuracyBonus = 0, evasionBonus = 0) {
  // Calculate target's evasion
  const targetEvasion = calculateEvasion(attacker, defender, evasionBonus);

  // Blind status penalty
  const isBlinded = attacker.statusEffects?.some(e => e.type === 'blind');
  const blindPenalty = isBlinded ? BLIND_PENALTY : 0;

  // Calculate hit chance
  const hitChance = BASE_ACCURACY - targetEvasion - blindPenalty + accuracyBonus;

  return Math.max(MIN_HIT_CHANCE, Math.min(MAX_HIT_CHANCE, hitChance));
}

// ============================================================================
// STATUS EFFECT FORMULAS
// ============================================================================

/**
 * Calculate status effect resistance
 * Formula: 10% base + LCK/200, capped at 50%
 *
 * @param {Object} defender - Defender unit with { luck }
 * @param {number} traitBonus - Additional resist from traits (default 0)
 * @returns {number} Status resistance from 0 to 0.50
 */
export function calculateStatusResistance(defender, traitBonus = 0) {
  const luck = defender.luck || 0;
  const luckBonus = luck / STATUS_LUCK_DIVISOR;
  return Math.min(MAX_STATUS_RESIST, BASE_STATUS_RESIST + luckBonus + traitBonus);
}

/**
 * Calculate effective status effect chance after resistance
 * Formula: baseChance * (1 - resistance)
 *
 * @param {number} baseChance - Base chance to apply status (0 to 1)
 * @param {Object} defender - Defender unit with { luck }
 * @param {number} traitBonus - Additional resist from traits (default 0)
 * @returns {number} Effective chance after resistance
 */
export function calculateEffectiveStatusChance(baseChance, defender, traitBonus = 0) {
  const resistance = calculateStatusResistance(defender, traitBonus);
  return baseChance * (1 - resistance);
}

// ============================================================================
// CT/TURN ORDER FORMULAS
// ============================================================================

/**
 * Calculate CT gain per tick (FFT-style with diminishing returns)
 * Formula: 5 + (AGI / 10)
 * This means AGI 10 = 6 CT/tick, AGI 50 = 10 CT/tick, AGI 100 = 15 CT/tick
 * Doubling AGI doesn't double turn frequency.
 *
 * @param {Object} unit - Unit with { agility, statusEffects }
 * @returns {number} CT gain per tick
 */
export function calculateCTGain(unit) {
  const agility = unit.agility || 0;
  let ctGain = CT_BASE_GAIN + (agility / CT_AGI_DIVISOR);

  // Haste increases CT gain by 50%
  const hasHaste = unit.statusEffects?.some(e => e.type === 'haste');
  if (hasHaste) {
    ctGain *= 1.5;
  }

  // Slow decreases CT gain by 50%
  const hasSlow = unit.statusEffects?.some(e => e.type === 'slow');
  if (hasSlow) {
    ctGain *= 0.5;
  }

  return ctGain;
}

/**
 * Calculate initial CT at battle start
 * Formula: (AGI / 2) + random(0, 20)
 *
 * @param {Object} unit - Unit with { agility }
 * @param {number} randomValue - Optional fixed random value (0-1) for deterministic testing
 * @returns {number} Initial CT value
 */
export function calculateInitialCT(unit, randomValue = null) {
  const agility = unit.agility || 0;
  const baseInitial = agility / 2;
  const variance = randomValue !== null
    ? Math.floor(randomValue * 21)  // 0-20
    : Math.floor(Math.random() * 21);
  return Math.floor(baseInitial + variance);
}

/**
 * Calculate initiative for turn order (legacy - for backwards compatibility)
 * Now returns initial CT value
 *
 * @param {Object} unit - Unit with { agility }
 * @param {number} randomValue - Optional fixed random value (0-1) for deterministic testing
 * @returns {number} Initiative value
 */
export function calculateInitiative(unit, randomValue = null) {
  return calculateInitialCT(unit, randomValue);
}

/**
 * Predict number of ticks until a unit reaches CT threshold
 *
 * @param {Object} unit - Unit with current CT and agility
 * @param {number} currentCT - Current CT value
 * @returns {number} Number of ticks until CT >= 100
 */
export function predictTicksToAct(unit, currentCT = 0) {
  const ctNeeded = CT_THRESHOLD - currentCT;
  if (ctNeeded <= 0) return 0;

  const ctGain = calculateCTGain(unit);
  return Math.ceil(ctNeeded / ctGain);
}

// ============================================================================
// DAMAGE PREVIEW (UI)
// ============================================================================

/**
 * Calculate full damage preview for UI display
 * Combines all damage calculations into a single result object
 *
 * @param {Object} attacker - Attacker unit
 * @param {Object} defender - Defender unit
 * @param {Object} skill - Skill object with { power, damageType, effect, type }
 * @returns {Object} Complete preview data for UI display
 */
export function calculateDamagePreview(attacker, defender, skill) {
  const skillPower = skill?.power || 100;
  const damageType = skill?.damageType || 'physical';
  const isHeal = skill?.effect === 'heal' || skill?.type === 'heal';

  // Calculate based on skill type
  if (isHeal) {
    const healData = calculateHealing(attacker, defender, skillPower);
    return {
      minDamage: null,
      maxDamage: null,
      minHeal: healData.minHeal,
      maxHeal: healData.maxHeal,
      effectiveHeal: healData.effectiveHeal,
      hitChance: 1.0, // Heals always hit
      critChance: 0,
      critDamage: null,
      willKill: false,
      isOverheal: healData.isOverheal,
      type: 'heal',
      defenseReduction: 0
    };
  }

  // Damage calculation
  const isMagical = damageType === 'magical' || damageType === 'magic';
  const damageData = isMagical
    ? calculateMagicalDamage(attacker, defender, skillPower)
    : calculatePhysicalDamage(attacker, defender, skillPower);

  const hitChance = calculateHitChance(attacker, defender);
  const critChance = calculateCritChance(attacker);
  const critMultiplier = calculateCritMultiplier(attacker);
  const critDamage = Math.floor(damageData.maxDamage * critMultiplier);

  // Will this kill the target at max damage?
  const targetHp = defender.hp || defender.currentHp || 0;
  const willKill = damageData.maxDamage >= targetHp;

  return {
    minDamage: damageData.minDamage,
    maxDamage: damageData.maxDamage,
    avgDamage: damageData.avgDamage,
    minHeal: null,
    maxHeal: null,
    hitChance,
    critChance,
    critDamage,
    willKill,
    isOverheal: false,
    type: isMagical ? 'magical' : 'physical',
    defenseReduction: damageData.defenseReduction
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Apply random variance to a base value
 * Returns a value between base * 0.9 and base * 1.1
 *
 * @param {number} base - Base value
 * @param {number} randomValue - Optional fixed random value (0-1) for testing
 * @returns {number} Value with variance applied
 */
export function applyVariance(base, randomValue = null) {
  const random = randomValue !== null ? randomValue : Math.random();
  const variance = DAMAGE_VARIANCE_MIN + (random * (DAMAGE_VARIANCE_MAX - DAMAGE_VARIANCE_MIN));
  return Math.floor(base * variance);
}

/**
 * Clamp a value between min and max
 *
 * @param {number} value - Value to clamp
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Clamped value
 */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// ============================================================================
// ELEMENTAL DAMAGE SYSTEM
// ============================================================================

/**
 * Get total elemental resistance for a defender against a specific element
 * Combines: racial innate + equipment + buff sources
 *
 * @param {Object} defender - Defender unit with { race, elementalResistances, statusEffects }
 * @param {string} element - Element type (fire, ice, lightning, etc.)
 * @returns {number} Total resistance value (-100 to 100+, will be capped during calculation)
 */
export function getElementalResistance(defender, element) {
  if (!element || element === 'physical') return 0;

  let totalResistance = 0;

  // 1. Racial innate resistance
  const race = defender.race?.toLowerCase();
  if (race && RACIAL_RESISTANCES[race]) {
    const racialResist = RACIAL_RESISTANCES[race][element] || 0;
    totalResistance += racialResist;
  }

  // 2. Enemy innate resistances (from elemental_resistances field)
  if (defender.elementalResistances && defender.elementalResistances[element]) {
    totalResistance += defender.elementalResistances[element];
  }

  // 3. Equipment resistances (from equipped items with elemental_resistance property)
  if (defender.equipment) {
    for (const slot of Object.values(defender.equipment)) {
      if (slot?.elementalResistances && slot.elementalResistances[element]) {
        totalResistance += slot.elementalResistances[element];
      }
    }
  }

  // 4. Buff-based resistances (from status effects like 'fire_resist')
  if (defender.statusEffects) {
    for (const effect of defender.statusEffects) {
      // Handle resistance buffs like 'fire_resist', 'ice_resist', etc.
      if (effect.type === `${element}_resist`) {
        totalResistance += effect.value || 25; // Default +25% resist from buff
      }
      // Handle elemental shield that provides resistance to all elements
      if (effect.type === 'elemental_shield') {
        totalResistance += effect.value || 15;
      }
    }
  }

  return totalResistance;
}

/**
 * Calculate elemental damage modifier based on defender's resistance
 * Formula:
 * - Resistance is capped at MAX_ELEMENTAL_RESISTANCE (90%) to ensure some damage always gets through
 * - Negative resistance (weakness) increases damage
 * - Absorb (150+ resistance) converts damage to healing (returns negative modifier)
 *
 * @param {Object} defender - Defender unit
 * @param {string} element - Element type (fire, ice, lightning, etc.)
 * @returns {number} Damage multiplier (0.1 minimum, can be negative for absorb)
 */
export function calculateElementalModifier(defender, element) {
  // Physical/non-elemental attacks have no modifier
  if (!element || element === 'physical') return 1.0;

  const resistance = getElementalResistance(defender, element);

  // Handle absorb (heals instead of damages)
  if (resistance >= 150) {
    return -0.5; // Negative means healing (50% of damage becomes healing)
  }

  // Handle immunity
  if (resistance >= 100) {
    return 0;
  }

  // Cap resistance at 90% (always at least 10% damage gets through)
  const cappedResistance = Math.min(resistance, MAX_ELEMENTAL_RESISTANCE);

  // Calculate modifier:
  // - resistance 0 = 100% damage (1.0)
  // - resistance 50 = 50% damage (0.5)
  // - resistance 90 = 10% damage (0.1)
  // - resistance -50 = 150% damage (1.5)
  // - resistance -100 = 200% damage (2.0)
  const modifier = (100 - cappedResistance) / 100;

  // Minimum 10% damage (0.1 modifier) even with high resistance
  return Math.max(0.1, modifier);
}

/**
 * Get display text for elemental effectiveness
 *
 * @param {number} modifier - Elemental damage modifier
 * @returns {Object} { text, color } for UI display
 */
export function getElementalEffectivenessDisplay(modifier) {
  if (modifier < 0) {
    return { text: 'ABSORB', color: '#44ff88' }; // Green for healing
  }
  if (modifier === 0) {
    return { text: 'IMMUNE', color: '#888888' }; // Gray for no effect
  }
  if (modifier <= 0.25) {
    return { text: 'RESIST', color: '#4488ff' }; // Blue for high resist
  }
  if (modifier <= 0.75) {
    return { text: 'Resist', color: '#88aaff' }; // Light blue for resist
  }
  if (modifier >= 1.5) {
    return { text: 'WEAK!', color: '#ff4444' }; // Red for very weak
  }
  if (modifier > 1.0) {
    return { text: 'Weak', color: '#ffaa44' }; // Orange for weak
  }
  return null; // Normal damage, no special display
}

/**
 * Element color mapping for damage numbers
 */
export const ELEMENT_COLORS = {
  physical: '#ff4444',    // Red (default damage)
  fire: '#ff4400',        // Orange-red
  ice: '#88ccff',         // Light blue
  lightning: '#ffff44',   // Yellow
  earth: '#886644',       // Brown
  wind: '#aaccaa',        // Sage green
  water: '#4488ff',       // Blue
  holy: '#ffff88',        // Bright yellow
  dark: '#aa66cc'         // Purple (lighter for visibility)
};

/**
 * Get damage number color for an element
 *
 * @param {string} element - Element type
 * @param {boolean} isCritical - Whether the hit was critical
 * @returns {string} Hex color string
 */
export function getElementDamageColor(element, isCritical = false) {
  if (isCritical) {
    return '#ffcc00'; // Gold for criticals always
  }
  return ELEMENT_COLORS[element] || ELEMENT_COLORS.physical;
}
