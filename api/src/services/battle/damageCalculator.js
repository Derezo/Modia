/**
 * Damage Calculator - Damage formulas, hit checks, and battle rewards
 *
 * FORMULA DESIGN (FFT-inspired):
 * - Defense uses diminishing returns: reduction = DEF / (DEF + 100)
 * - Crit: 5% base + LCK/300 (max 50%)
 * - Evasion: 2% base + (defAGI - atkAGI)/400 + defLCK/400 (max 35%)
 */

import * as traitService from '../traitService.js';
import {
  PHYSICAL_DEFENSE_CONSTANT,
  MAGIC_DEFENSE_CONSTANT,
  calculateDefenseReduction,
  calculateEvasion,
  calculateCritChance as sharedCalculateCritChance,
  calculateCritMultiplier as sharedCalculateCritMultiplier,
  calculateElementalModifier,
  STATUS_EFFECT_REGISTRY
} from '../../../../shared/battleMath.js';
import { getZodiacCollectionModifier } from '../zodiacCollectionBonusService.js';
import { getEquipmentAugmentEffect } from './equipmentAugmentEffects.js';

/**
 * Combine object-form status modifiers for an effective combat stat.
 * Statuses are unique by type, while distinct active effects stack
 * multiplicatively. Invalid and negative values are ignored.
 *
 * Falls back to STATUS_EFFECT_REGISTRY when an effect lacks object-form
 * modifiers, so legacy string-based effects (fortify, rage, weaken, etc.)
 * still affect combat.
 */
function getStatusStatMultiplier(unit, statName) {
  if (!Array.isArray(unit?.statusEffects)) return 1;

  return unit.statusEffects.reduce((multiplier, effect) => {
    // First check object-form modifiers on the effect
    let value = effect?.modifiers?.[statName];
    // Fall back to registry if no object-form modifier
    if (value === undefined && effect?.type) {
      const registryEntry = STATUS_EFFECT_REGISTRY[effect.type];
      value = registryEntry?.modifiers?.[statName];
    }
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? multiplier * value
      : multiplier;
  }, 1);
}

/**
 * Calculate physical damage with diminishing returns defense
 * Formula: (STR + weaponAttack) * skillPower * (1 - defenseReduction) * elementalMod * variance * crit
 * Defense reduction = (VIT + armorDefense) / ((VIT + armorDefense) + 100)
 *
 * @param {Object} attacker - Attacking unit
 * @param {Object} defender - Defending unit
 * @param {number} skillPower - Skill power percentage (default 100)
 * @param {string} element - Element type for elemental damage (optional)
 */
export function calculatePhysicalDamage(
  attacker,
  defender,
  skillPower = 100,
  element = null,
  options = {}
) {
  // Base attack = strength + equipment attack bonus
  const attackPower = (
    (attacker.strength || 0) + (attacker.attack || 0)
  ) * getStatusStatMultiplier(attacker, 'attack') *
    (1 + getZodiacCollectionModifier(attacker, 'physicalDamage'));
  const rawDamage = attackPower * (skillPower / 100);

  // Defense with diminishing returns: DEF / (DEF + 100)
  const defensePower = (
    (defender.vitality || 0) + (defender.defense || 0)
  ) * getStatusStatMultiplier(defender, 'defense') *
    (1 + getZodiacCollectionModifier(defender, 'defense'));
  const defenseReduction = calculateDefenseReduction(defensePower, PHYSICAL_DEFENSE_CONSTANT);

  // Apply defense reduction
  const reducedDamage = Math.max(1, rawDamage * (1 - defenseReduction));

  // Apply elemental modifier
  const elementalModifier = calculateElementalModifier(defender, element);
  const elementalDamage = reducedDamage * Math.abs(elementalModifier);

  // Random variance (0.9 - 1.1)
  const variance = 0.9 + Math.random() * 0.2;

  // Critical hit check with new formula: 5% base + LCK/300 (max 50%)
  const traitCritBonus = traitService.getCritChanceBonus(attacker);
  const crystalCritBonus = getZodiacCollectionModifier(attacker, 'critChance');
  const equipCritBonus = getEquipmentAugmentEffect(attacker, 'crit_chance');
  const critChance = sharedCalculateCritChance(
    attacker,
    traitCritBonus + crystalCritBonus + equipCritBonus + (options.critChanceBonus || 0)
  );
  const isCritical = Math.random() < critChance;

  // Critical multiplier: 1.5 base + LCK/500 + race bonus (orcs +15%) + equipment crit_damage
  const equipCritDamage = getEquipmentAugmentEffect(attacker, 'crit_damage');
  const critMultiplier = isCritical
    ? sharedCalculateCritMultiplier(attacker) + equipCritDamage
    : 1.0;

  // Apply trait damage multipliers
  const traitDamageMultiplier = traitService.getPhysicalDamageMultiplier(attacker, defender, isCritical);
  const traitDefenseMultiplier = traitService.getDamageReductionMultiplier(defender, 'physical');

  const finalDamage = Math.floor(elementalDamage * variance * critMultiplier * traitDamageMultiplier * traitDefenseMultiplier);

  return {
    damage: Math.max(1, finalDamage),
    isCritical,
    variance,
    defenseReduction,
    traitBonusApplied: traitDamageMultiplier > 1.0 || traitDefenseMultiplier < 1.0,
    element,
    elementalModifier,
    isAbsorb: elementalModifier < 0 // Negative modifier means absorb (heal instead of damage)
  };
}

/**
 * Calculate magical damage with diminishing returns defense
 * Formula: (INT + magicAttack) * skillPower * (1 - magicDefenseReduction) * elementalMod * variance * crit
 * Magic defense reduction = (INT/2 + magicDefense) / ((INT/2 + magicDefense) + 80)
 *
 * @param {Object} attacker - Attacking unit
 * @param {Object} defender - Defending unit
 * @param {number} skillPower - Skill power percentage (default 100)
 * @param {string} element - Element type for elemental damage (optional)
 */
export function calculateMagicalDamage(
  attacker,
  defender,
  skillPower = 100,
  element = null,
  options = {}
) {
  // Base magic attack = intelligence + equipment magic attack bonus
  const magicAttackPower = (
    (attacker.intelligence || 0) + (attacker.magicAttack || 0)
  ) * getStatusStatMultiplier(attacker, 'magicAttack');
  const rawDamage = magicAttackPower * (skillPower / 100);

  // Magic defense with diminishing returns: (INT/2 + MDEF) / (value + 80)
  const defenderInt = defender.intelligence || 0;
  const magicDefensePower = (
    Math.floor(defenderInt / 2) + (defender.magicDefense || 0)
  ) * getStatusStatMultiplier(defender, 'magicDefense') *
    (1 + getZodiacCollectionModifier(defender, 'defense'));
  const defenseReduction = calculateDefenseReduction(magicDefensePower, MAGIC_DEFENSE_CONSTANT);

  // Apply defense reduction
  const reducedDamage = Math.max(1, rawDamage * (1 - defenseReduction));

  // Apply elemental modifier
  const elementalModifier = calculateElementalModifier(defender, element);
  const elementalDamage = reducedDamage * Math.abs(elementalModifier);

  // Random variance (0.9 - 1.1)
  const variance = 0.9 + Math.random() * 0.2;

  // Critical hit check with new formula: 5% base + LCK/300 (max 50%)
  const traitCritBonus = traitService.getCritChanceBonus(attacker);
  const crystalCritBonus = getZodiacCollectionModifier(attacker, 'critChance');
  const equipCritBonus = getEquipmentAugmentEffect(attacker, 'crit_chance');
  const critChance = sharedCalculateCritChance(
    attacker,
    traitCritBonus + crystalCritBonus + equipCritBonus + (options.critChanceBonus || 0)
  );
  const isCritical = Math.random() < critChance;

  // Critical multiplier: 1.5 base + LCK/500 + race bonus + equipment crit_damage
  const equipCritDamage = getEquipmentAugmentEffect(attacker, 'crit_damage');
  const critMultiplier = isCritical
    ? sharedCalculateCritMultiplier(attacker) + equipCritDamage
    : 1.0;

  // Apply trait damage multipliers
  const traitDamageMultiplier = traitService.getMagicalDamageMultiplier(attacker, defender, isCritical);
  const traitDefenseMultiplier = traitService.getDamageReductionMultiplier(defender, 'magical');

  const finalDamage = Math.floor(elementalDamage * variance * critMultiplier * traitDamageMultiplier * traitDefenseMultiplier);

  return {
    damage: Math.max(1, finalDamage),
    isCritical,
    variance,
    defenseReduction,
    traitBonusApplied: traitDamageMultiplier > 1.0 || traitDefenseMultiplier < 1.0,
    element,
    elementalModifier,
    isAbsorb: elementalModifier < 0 // Negative modifier means absorb (heal instead of damage)
  };
}

/**
 * Check hit/miss using new evasion formula
 * Evasion: 2% base + (defAGI - atkAGI)/400 + defLCK/400 (max 35%)
 * Hit chance: 95% base - evasion - blindPenalty + traitBonuses (50% min, 98% max)
 */
/**
 * Check if an attack/skill hits the target.
 * @param {Object} attacker - Attacking unit
 * @param {Object} defender - Defending unit
 * @param {Object} options - Optional parameters
 * @param {number} options.accuracyMultiplier - Multiply final hit chance (e.g., 0.5 for wild_swing)
 * @returns {boolean} Whether the attack hits
 */
export function checkHit(attacker, defender, options = {}) {
  const { accuracyMultiplier = 1 } = options;

  // Apply trait bonuses
  const accuracyBonus = traitService.getAccuracyBonus(attacker);
  const evasionBonus = traitService.getEvasionBonus(defender);

  // Calculate evasion using formula from battleMath
  const targetEvasion = calculateEvasion(attacker, defender, evasionBonus);

  // Check for blind status
  const isBlinded = attacker.statusEffects?.some(e => e.type === 'blind');
  const blindPenalty = isBlinded ? 0.30 : 0;

  // Calculate hit chance: 95% base - evasion - blind + accuracy
  // Then apply accuracyMultiplier (skill-specific accuracy like wild_swing's 50%)
  const baseHitChance = 0.95;
  const clampedHitChance = Math.max(0.50, Math.min(0.98, baseHitChance - targetEvasion - blindPenalty + accuracyBonus));
  const hitChance = clampedHitChance * accuracyMultiplier;

  return Math.random() < hitChance;
}

/**
 * Calculate experience reward from battle
 * Formula: baseXP * (enemyLevel / 10) * levelMultiplier * traitBonus
 * @param {Array} enemies - Enemy units defeated
 * @param {number} partyLevel - Average party level
 * @param {Array} partyUnits - Player units (for trait bonuses)
 */
export function calculateExperienceReward(enemies, partyLevel, partyUnits = []) {
  let totalXP = 0;

  for (const enemy of enemies) {
    // Base XP scales with enemy level
    const baseXP = enemy.xpReward || (50 + (enemy.maxHp / 10));
    const enemyLevel = enemy.level || partyLevel;
    const scaledBaseXP = baseXP * (enemyLevel / 10);

    // Level difference multiplier: ±5% per level difference
    const levelDiff = enemyLevel - partyLevel;
    const levelMultiplier = Math.max(0.5, Math.min(1.5, 1 + levelDiff * 0.05));

    totalXP += Math.floor(scaledBaseXP * levelMultiplier);
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
export function calculateGoldReward(enemies, difficultyTier = 1, partyUnits = []) {
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
