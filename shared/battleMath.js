/**
 * Battle Math - Damage formulas, hit/crit calculations for combat
 * SINGLE SOURCE OF TRUTH for battle calculations used by both server and client
 *
 * NOTE: These functions provide PREVIEW calculations for client-side UI.
 * The SERVER remains authoritative for actual damage - it uses these same
 * formulas but adds random variance and trait bonuses during execution.
 *
 * Client uses these for damage preview tooltips; server uses for validation.
 */

/**
 * Calculate physical damage preview (deterministic, no random variance)
 * Formula: (STR + equipmentAttack) * skillPower - (VIT + equipmentDefense) * 0.5 * 0.3
 *
 * @param {Object} attacker - Attacker unit with { strength, attack, luck, race }
 * @param {Object} defender - Defender unit with { vitality, agility, defense }
 * @param {number} skillPower - Skill power percentage (default 100)
 * @returns {Object} { minDamage, maxDamage, avgDamage }
 */
export function calculatePhysicalDamage(attacker, defender, skillPower = 100) {
  // Base attack = strength + equipment attack bonus
  const attackPower = (attacker.strength || 0) + (attacker.attack || 0);
  const baseDamage = attackPower * (skillPower / 100);

  // Defense = vitality (or agility/2 fallback) + equipment defense bonus
  const defensePower = (defender.vitality || defender.agility / 2 || 0) + (defender.defense || 0);
  const defenseReduction = defensePower * 0.5 * 0.3;

  const rawDamage = Math.max(1, baseDamage - defenseReduction);

  // Variance range is 0.9 - 1.1 (10% either way)
  const minDamage = Math.max(1, Math.floor(rawDamage * 0.9));
  const maxDamage = Math.max(1, Math.floor(rawDamage * 1.1));
  const avgDamage = Math.floor((minDamage + maxDamage) / 2);

  return { minDamage, maxDamage, avgDamage };
}

/**
 * Calculate magical damage preview (deterministic, no random variance)
 * Formula: (INT + magicAttack) * skillPower - (INT_DEF + magicDefense) * 0.25 * 0.3
 *
 * @param {Object} attacker - Attacker unit with { intelligence, magicAttack, luck }
 * @param {Object} defender - Defender unit with { intelligence, magicDefense }
 * @param {number} skillPower - Skill power percentage (default 100)
 * @returns {Object} { minDamage, maxDamage, avgDamage }
 */
export function calculateMagicalDamage(attacker, defender, skillPower = 100) {
  // Base magic attack = intelligence + equipment magic attack bonus
  const magicAttackPower = (attacker.intelligence || 0) + (attacker.magicAttack || 0);
  const baseDamage = magicAttackPower * (skillPower / 100);

  // Magic defense = intelligence + equipment magic defense bonus
  const magicDefensePower = (defender.intelligence || 10) + (defender.magicDefense || 0);
  const defenseReduction = magicDefensePower * 0.25 * 0.3;

  const rawDamage = Math.max(1, baseDamage - defenseReduction);

  // Variance range is 0.9 - 1.1 (10% either way)
  const minDamage = Math.max(1, Math.floor(rawDamage * 0.9));
  const maxDamage = Math.max(1, Math.floor(rawDamage * 1.1));
  const avgDamage = Math.floor((minDamage + maxDamage) / 2);

  return { minDamage, maxDamage, avgDamage };
}

/**
 * Calculate healing preview
 * Formula: INT * skillPower
 *
 * @param {Object} caster - Healer unit with { intelligence }
 * @param {Object} target - Target unit with { hp, maxHp }
 * @param {number} skillPower - Skill power percentage (default 100)
 * @returns {Object} { minHeal, maxHeal, effectiveHeal, isOverheal }
 */
export function calculateHealing(caster, target, skillPower = 100) {
  const baseHeal = (caster.intelligence || 10) * (skillPower / 100);

  // Variance range is 0.9 - 1.1 (10% either way)
  const minHeal = Math.max(1, Math.floor(baseHeal * 0.9));
  const maxHeal = Math.max(1, Math.floor(baseHeal * 1.1));

  // Calculate how much HP target is missing
  const targetMissingHp = (target.maxHp || target.hpMax || 100) - (target.hp || 0);
  const effectiveHeal = Math.min(maxHeal, targetMissingHp);
  const isOverheal = maxHeal > targetMissingHp;

  return { minHeal, maxHeal, effectiveHeal, isOverheal };
}

/**
 * Calculate hit chance (accuracy vs evasion)
 * Base 95%, reduced by target agility advantage, affected by blind status
 *
 * @param {Object} attacker - Attacker unit with { agility, statusEffects }
 * @param {Object} defender - Defender unit with { agility }
 * @returns {number} Hit chance from 0 to 1
 */
export function calculateHitChance(attacker, defender) {
  const baseHitChance = 0.95;

  // Agility difference affects dodge
  const attackerAgility = attacker.agility || 10;
  const defenderAgility = defender.agility || 10;
  const agilityDiff = defenderAgility - attackerAgility;
  const dodgeBonus = Math.max(0, agilityDiff) * 0.01;

  // Blind status penalty
  const isBlinded = attacker.statusEffects?.some(e => e.type === 'blind');
  const blindPenalty = isBlinded ? 0.3 : 0;

  // Clamp between 50% and 100%
  return Math.max(0.5, Math.min(1.0, baseHitChance - dodgeBonus - blindPenalty));
}

/**
 * Calculate critical hit chance
 * Based on luck stat, capped at 30%
 *
 * @param {Object} attacker - Attacker unit with { luck }
 * @returns {number} Crit chance from 0 to 0.30
 */
export function calculateCritChance(attacker) {
  const luck = attacker.luck || 10;
  return Math.min(0.30, luck / 200);
}

/**
 * Calculate critical hit damage multiplier
 * Base 1.5x, orcs get +10% crit damage (1.65x total)
 *
 * @param {Object} attacker - Attacker unit with { race }
 * @returns {number} Critical multiplier (1.5 or 1.65 for orcs)
 */
export function calculateCritMultiplier(attacker) {
  const baseCritMultiplier = 1.5;

  // Orcs get +10% crit damage bonus
  if (attacker.race === 'orc') {
    return baseCritMultiplier * 1.1; // 1.65
  }

  return baseCritMultiplier;
}

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
      type: 'heal'
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
  const willKill = damageData.maxDamage >= (defender.hp || defender.currentHp || 0);

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
    type: isMagical ? 'magical' : 'physical'
  };
}

/**
 * Calculate initiative for turn order
 * Agility + random variance (0-9)
 *
 * @param {Object} unit - Unit with { agility }
 * @param {number} randomValue - Optional fixed random value (0-1) for deterministic testing
 * @returns {number} Initiative value
 */
export function calculateInitiative(unit, randomValue = null) {
  const agility = unit.agility || 10;
  const variance = randomValue !== null
    ? Math.floor(randomValue * 10)
    : Math.floor(Math.random() * 10);
  return agility + variance;
}
