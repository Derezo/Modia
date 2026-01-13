/**
 * Trait Service - Loads and applies trait effects to characters in battle
 *
 * Traits are innate bonuses that guild recruits can have.
 * When applied in battle, they modify damage, stats, and provide special effects.
 */

import { query } from '../config/database.js';
import {
  applyEffectsForPhase,
  EFFECT_PHASES,
  hasEffectHandler
} from './traits/traitEffectRegistry.js';

/**
 * Load traits for a list of character IDs
 * @param {number[]} characterIds - Array of character IDs
 * @returns {Promise<Object>} Map of characterId -> array of trait objects
 */
async function loadCharacterTraits(characterIds) {
  if (!characterIds || characterIds.length === 0) {
    console.log('[TraitService] loadCharacterTraits called with empty/null characterIds');
    return {};
  }

  console.log('[TraitService] Loading traits for characters:', characterIds);

  const result = await query(
    `SELECT ct.character_id, t.id, t.name, t.description, t.category,
            t.rarity, t.effect_type, t.effect_value
     FROM character_traits ct
     JOIN traits t ON ct.trait_id = t.id
     WHERE ct.character_id = ANY($1)
     ORDER BY ct.character_id, t.rarity DESC`,
    [characterIds]
  );

  console.log('[TraitService] Query returned', result.rows.length, 'trait assignments');

  // Group traits by character
  const traitsByCharacter = {};
  for (const row of result.rows) {
    if (!traitsByCharacter[row.character_id]) {
      traitsByCharacter[row.character_id] = [];
    }
    traitsByCharacter[row.character_id].push({
      id: row.id,
      name: row.name,
      description: row.description,
      category: row.category,
      rarity: row.rarity,
      effectType: row.effect_type,
      effectValue: parseFloat(row.effect_value)
    });
  }

  // Log summary of what was loaded
  const summary = Object.entries(traitsByCharacter).map(([charId, traits]) => ({
    characterId: charId,
    traitCount: traits.length,
    traits: traits.map(t => `${t.name} (${t.effectType}: ${t.effectValue})`)
  }));
  console.log('[TraitService] Traits by character:', JSON.stringify(summary, null, 2));

  return traitsByCharacter;
}

/**
 * Get a specific trait effect value from a unit's traits
 * @param {Object} unit - Battle unit with traits array
 * @param {string} effectType - The effect type to look for
 * @returns {number} The effect value (0 if not found)
 */
function getTraitEffectValue(unit, effectType) {
  if (!unit.traits || unit.traits.length === 0) {
    return 0;
  }

  const trait = unit.traits.find(t => t.effectType === effectType);
  return trait ? trait.effectValue : 0;
}

/**
 * Check if unit has a specific trait effect
 * @param {Object} unit - Battle unit with traits array
 * @param {string} effectType - The effect type to check
 * @returns {boolean} True if unit has the trait
 */
function hasTraitEffect(unit, effectType) {
  if (!unit.traits || unit.traits.length === 0) {
    return false;
  }

  return unit.traits.some(t => t.effectType === effectType);
}

/**
 * Apply HP bonus trait at battle start
 * @param {Object} unit - Battle unit to modify
 */
function applyHPBonusTrait(unit) {
  const hpBonus = getTraitEffectValue(unit, 'hp_bonus');
  const hpMpBonus = getTraitEffectValue(unit, 'hp_mp_bonus');
  const totalBonus = hpBonus + hpMpBonus;

  if (totalBonus > 0) {
    const bonusHP = Math.floor(unit.maxHp * totalBonus);
    unit.maxHp += bonusHP;
    unit.hp += bonusHP; // Also increase current HP
  }
}

/**
 * Apply MP bonus trait at battle start
 * @param {Object} unit - Battle unit to modify
 */
function applyMPBonusTrait(unit) {
  const mpBonus = getTraitEffectValue(unit, 'mp_bonus');
  const hpMpBonus = getTraitEffectValue(unit, 'hp_mp_bonus');
  const totalBonus = mpBonus + hpMpBonus;

  if (totalBonus > 0) {
    const bonusMP = Math.floor(unit.maxMp * totalBonus);
    unit.maxMp += bonusMP;
    unit.mp += bonusMP; // Also increase current MP
  }
}

/**
 * Apply movement bonus trait
 * @param {Object} unit - Battle unit
 * @returns {number} Additional movement tiles
 */
function getMovementBonus(unit) {
  return Math.floor(getTraitEffectValue(unit, 'movement_bonus'));
}

/**
 * Apply attack range bonus trait
 * @param {Object} unit - Battle unit
 * @returns {number} Additional attack range tiles
 */
function getRangeBonus(unit) {
  return Math.floor(getTraitEffectValue(unit, 'range_bonus'));
}

/**
 * Calculate physical damage multiplier from traits
 * @param {Object} attacker - Attacking unit
 * @param {Object} defender - Defending unit (for situational bonuses)
 * @param {boolean} isCritical - Whether the attack is a critical hit
 * @returns {number} Damage multiplier (1.0 = no change)
 */
function getPhysicalDamageMultiplier(attacker, defender, isCritical) {
  let multiplier = 1.0;

  if (!attacker.traits) return multiplier;

  for (const trait of attacker.traits) {
    switch (trait.effectType) {
      case 'physical_damage_bonus':
        multiplier += trait.effectValue;
        break;
      case 'all_damage_bonus':
        multiplier += trait.effectValue;
        break;
      case 'critical_damage_bonus':
        if (isCritical) {
          multiplier += trait.effectValue;
        }
        break;
      case 'low_hp_damage_bonus':
        // Berserker Blood: bonus when below 30% HP
        if (attacker.hp / attacker.maxHp < 0.3) {
          multiplier += trait.effectValue;
        }
        break;
      // Situational bonuses based on enemy archetype
      case 'dragon_damage_bonus':
        if (defender?.archetype === 'dragon' || defender?.class === 'dragon') {
          multiplier += trait.effectValue;
        }
        break;
      case 'undead_damage_bonus':
        if (defender?.archetype === 'undead') {
          multiplier += trait.effectValue;
        }
        break;
      case 'demon_damage_bonus':
        if (defender?.archetype === 'demon') {
          multiplier += trait.effectValue;
        }
        break;
      case 'boss_damage_bonus':
        if (defender?.isBoss) {
          multiplier += trait.effectValue;
        }
        break;
      case 'universal_situational':
        // Chosen One: apply 50% of situational bonuses universally
        if (defender?.archetype) {
          multiplier += trait.effectValue * 0.5; // 50% bonus
        }
        break;
    }
  }

  return multiplier;
}

/**
 * Calculate magical damage multiplier from traits
 * @param {Object} attacker - Attacking unit
 * @param {Object} defender - Defending unit (for situational bonuses)
 * @param {boolean} isCritical - Whether the attack is a critical hit
 * @returns {number} Damage multiplier (1.0 = no change)
 */
function getMagicalDamageMultiplier(attacker, defender, isCritical) {
  let multiplier = 1.0;

  if (!attacker.traits) return multiplier;

  for (const trait of attacker.traits) {
    switch (trait.effectType) {
      case 'magic_damage_bonus':
        multiplier += trait.effectValue;
        break;
      case 'all_damage_bonus':
        multiplier += trait.effectValue;
        break;
      case 'critical_damage_bonus':
        if (isCritical) {
          multiplier += trait.effectValue;
        }
        break;
      case 'low_hp_damage_bonus':
        if (attacker.hp / attacker.maxHp < 0.3) {
          multiplier += trait.effectValue;
        }
        break;
      // Same situational bonuses apply to magic
      case 'dragon_damage_bonus':
        if (defender?.archetype === 'dragon' || defender?.class === 'dragon') {
          multiplier += trait.effectValue;
        }
        break;
      case 'undead_damage_bonus':
        if (defender?.archetype === 'undead') {
          multiplier += trait.effectValue;
        }
        break;
      case 'demon_damage_bonus':
        if (defender?.archetype === 'demon') {
          multiplier += trait.effectValue;
        }
        break;
      case 'boss_damage_bonus':
        if (defender?.isBoss) {
          multiplier += trait.effectValue;
        }
        break;
      case 'universal_situational':
        if (defender?.archetype) {
          multiplier += trait.effectValue * 0.5;
        }
        break;
    }
  }

  return multiplier;
}

/**
 * Calculate damage reduction multiplier from traits
 * @param {Object} defender - Defending unit
 * @param {string} damageType - 'physical' or 'magical'
 * @returns {number} Damage multiplier (values < 1.0 reduce damage)
 */
function getDamageReductionMultiplier(defender, damageType) {
  let multiplier = 1.0;

  if (!defender.traits) return multiplier;

  for (const trait of defender.traits) {
    switch (trait.effectType) {
      case 'physical_resistance':
        if (damageType === 'physical') {
          multiplier -= trait.effectValue;
        }
        break;
      case 'magic_resistance':
        if (damageType === 'magical') {
          multiplier -= trait.effectValue;
        }
        break;
      case 'all_resistance':
        multiplier -= trait.effectValue;
        break;
    }
  }

  return Math.max(0.1, multiplier); // Minimum 10% damage taken
}

/**
 * Get crit chance bonus from traits
 * @param {Object} unit - Attacking unit
 * @returns {number} Additional crit chance (0.05 = 5%)
 */
function getCritChanceBonus(unit) {
  // No specific crit_chance_bonus trait in current schema,
  // but luck_effectiveness increases luck-based calculations
  const luckBonus = getTraitEffectValue(unit, 'luck_effectiveness');
  return luckBonus * 0.1; // 25% luck effectiveness = 2.5% extra crit
}

/**
 * Get accuracy bonus from traits
 * @param {Object} unit - Attacking unit
 * @returns {number} Additional accuracy (0.08 = 8%)
 */
function getAccuracyBonus(unit) {
  return getTraitEffectValue(unit, 'accuracy_bonus');
}

/**
 * Get evasion bonus from traits
 * @param {Object} unit - Defending unit
 * @returns {number} Additional evasion (0.05 = 5%)
 */
function getEvasionBonus(unit) {
  return getTraitEffectValue(unit, 'evasion_bonus');
}

/**
 * Get initiative bonus for turn order
 * @param {Object} unit - Battle unit
 * @returns {number} Initiative bonus multiplier (0.15 = 15%)
 */
function getInitiativeBonus(unit) {
  return getTraitEffectValue(unit, 'initiative_bonus');
}

/**
 * Get MP cost reduction from traits
 * @param {Object} unit - Unit using skill
 * @returns {number} MP cost reduction (0.12 = 12% reduction)
 */
function getMPCostReduction(unit) {
  return getTraitEffectValue(unit, 'mp_cost_reduction');
}

/**
 * Calculate lifesteal healing after dealing damage
 * @param {Object} attacker - Unit that dealt damage
 * @param {number} damageDealt - Amount of damage dealt
 * @returns {number} Amount of HP to heal (0 if no lifesteal)
 */
function calculateLifesteal(attacker, damageDealt) {
  const lifestealPercent = getTraitEffectValue(attacker, 'lifesteal');
  if (lifestealPercent <= 0) return 0;

  return Math.floor(damageDealt * lifestealPercent);
}

/**
 * Calculate HP regeneration per turn
 * @param {Object} unit - Battle unit
 * @returns {number} HP to regenerate
 */
function calculateHPRegen(unit) {
  const regenPercent = getTraitEffectValue(unit, 'hp_regen_percent');
  if (regenPercent <= 0) return 0;

  return Math.floor(unit.maxHp * regenPercent);
}

/**
 * Check if death save trait triggers (survive killing blow)
 * @param {Object} unit - Unit that would die
 * @returns {boolean} True if death save triggers
 */
function checkDeathSave(unit) {
  // Second Wind trait: survive once per battle
  if (hasTraitEffect(unit, 'death_save') && !unit.deathSaveUsed) {
    unit.deathSaveUsed = true;
    return true;
  }
  return false;
}

/**
 * Get experience bonus multiplier
 * @param {Object} unit - Battle unit
 * @returns {number} XP multiplier (0.10 = 10% bonus)
 */
function getXPBonus(unit) {
  return getTraitEffectValue(unit, 'xp_bonus');
}

/**
 * Get gold bonus multiplier
 * @param {Object} unit - Battle unit
 * @returns {number} Gold multiplier (0.15 = 15% bonus)
 */
function getGoldBonus(unit) {
  return getTraitEffectValue(unit, 'gold_bonus');
}

/**
 * Apply all stat-based traits to a unit at battle start
 * Uses the modular trait effect registry for extensibility.
 * @param {Object} unit - Battle unit to modify
 */
function applyBattleStartTraits(unit) {
  console.log(`[TraitService] applyBattleStartTraits called for "${unit.name}" (${unit.class})`);
  console.log(`[TraitService] Unit has ${unit.traits?.length || 0} traits:`,
    unit.traits?.map(t => t.name) || 'none');

  if (!unit.traits || unit.traits.length === 0) {
    console.log('[TraitService] No traits to apply, returning early');
    return;
  }

  // Capture before state for logging
  const before = {
    maxHp: unit.maxHp,
    hp: unit.hp,
    maxMp: unit.maxMp,
    mp: unit.mp,
    movement: unit.movement,
    attackRange: unit.attackRange
  };

  // Use the modular trait registry to apply effects
  const results = applyEffectsForPhase(unit, EFFECT_PHASES.BATTLE_START);

  // Log applied effects
  if (results.modified) {
    console.log(`[TraitService] Applied ${results.effects.length} battle-start effects:`);
    for (const effect of results.effects) {
      console.log(`  - ${effect.traitName}: ${effect.type} ${effect.stat || ''} ${effect.amount !== undefined ? '+' + effect.amount : ''}`);
    }
  }

  // Fall back to legacy handlers for any traits not in registry
  for (const trait of unit.traits) {
    if (!hasEffectHandler(trait.effectType)) {
      console.log(`[TraitService] Warning: No registry handler for effect type "${trait.effectType}" (trait: ${trait.name})`);
      // Legacy fallback for unregistered effect types
      applyLegacyEffect(unit, trait);
    }
  }

  // Capture after state and log changes
  const after = {
    maxHp: unit.maxHp,
    hp: unit.hp,
    maxMp: unit.maxMp,
    mp: unit.mp,
    movement: unit.movement,
    attackRange: unit.attackRange
  };

  console.log('[TraitService] Stats before:', before);
  console.log('[TraitService] Stats after:', after);
}

/**
 * Legacy fallback for trait effect types not yet in the registry
 * @param {Object} unit - Battle unit
 * @param {Object} trait - Trait to apply
 */
function applyLegacyEffect(unit, trait) {
  // This handles any effect types that aren't in the modular registry yet
  // As effect types are migrated to the registry, this fallback will be used less
  switch (trait.effectType) {
    case 'hp_bonus':
    case 'mp_bonus':
    case 'hp_mp_bonus':
    case 'movement_bonus':
    case 'range_bonus':
    case 'initiative_bonus':
      // These are handled by the registry, skip
      break;
    default:
      // Unknown effect type - log for debugging
      console.log(`[TraitService] Unknown effect type: ${trait.effectType}`);
  }
}

/**
 * Format traits for client display
 * @param {Array} traits - Array of trait objects
 * @returns {Array} Simplified trait data for frontend
 */
function formatTraitsForClient(traits) {
  if (!traits || traits.length === 0) return [];

  return traits.map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    rarity: t.rarity,
    category: t.category
  }));
}

export {
  loadCharacterTraits,
  getTraitEffectValue,
  hasTraitEffect,
  applyBattleStartTraits,
  getPhysicalDamageMultiplier,
  getMagicalDamageMultiplier,
  getDamageReductionMultiplier,
  getCritChanceBonus,
  getAccuracyBonus,
  getEvasionBonus,
  getInitiativeBonus,
  getMPCostReduction,
  calculateLifesteal,
  calculateHPRegen,
  checkDeathSave,
  getXPBonus,
  getGoldBonus,
  getMovementBonus,
  getRangeBonus,
  formatTraitsForClient
};

export default {
  loadCharacterTraits,
  getTraitEffectValue,
  hasTraitEffect,
  applyBattleStartTraits,
  getPhysicalDamageMultiplier,
  getMagicalDamageMultiplier,
  getDamageReductionMultiplier,
  getCritChanceBonus,
  getAccuracyBonus,
  getEvasionBonus,
  getInitiativeBonus,
  getMPCostReduction,
  calculateLifesteal,
  calculateHPRegen,
  checkDeathSave,
  getXPBonus,
  getGoldBonus,
  getMovementBonus,
  getRangeBonus,
  formatTraitsForClient
};
