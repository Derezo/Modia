/**
 * Special Effects
 *
 * These are unique effects like lifesteal, regeneration, death saves,
 * and reward bonuses.
 */

import { registerEffectHandler, EFFECT_PHASES } from '../traitEffectRegistry.js';

/**
 * Register all special effect handlers
 */
export function initSpecialEffects() {
  // Lifesteal - Heal percentage of damage dealt
  registerEffectHandler('lifesteal', {
    phase: EFFECT_PHASES.ON_KILL,
    description: 'Heal percentage of damage dealt',
    apply(unit, effectValue, context) {
      if (!context.damageDealt) return null;
      const healAmount = Math.floor(context.damageDealt * effectValue);
      unit.hp = Math.min(unit.maxHp, unit.hp + healAmount);
      return { type: 'heal', amount: healAmount };
    }
  });

  // HP Regen - Heal percentage of max HP per turn
  registerEffectHandler('hp_regen_percent', {
    phase: EFFECT_PHASES.ON_TURN_START,
    description: 'Heal percentage of max HP at turn start',
    apply(unit, effectValue) {
      const healAmount = Math.floor(unit.maxHp * effectValue);
      const actualHeal = Math.min(healAmount, unit.maxHp - unit.hp);
      if (actualHeal > 0) {
        unit.hp += actualHeal;
        return { type: 'regen', amount: actualHeal };
      }
      return null;
    }
  });

  // Death Save - Survive killing blow once
  registerEffectHandler('death_save', {
    phase: EFFECT_PHASES.ON_DEATH,
    description: 'Survive a killing blow once per battle',
    apply(unit, effectValue, context) {
      // Check if death save already used
      if (unit.deathSaveUsed) return null;

      // Survive with percentage of max HP
      const surviveHP = Math.max(1, Math.floor(unit.maxHp * effectValue));
      unit.hp = surviveHP;
      unit.deathSaveUsed = true;
      return { type: 'death_save', survivedWith: surviveHP };
    }
  });

  // XP Bonus - Extra experience from battles
  registerEffectHandler('xp_bonus', {
    phase: EFFECT_PHASES.ON_REWARD,
    description: 'Percentage bonus to XP gained',
    apply(unit, effectValue) {
      return { xpMultiplier: effectValue };
    }
  });

  // Gold Bonus - Extra gold from battles
  registerEffectHandler('gold_bonus', {
    phase: EFFECT_PHASES.ON_REWARD,
    description: 'Percentage bonus to gold gained',
    apply(unit, effectValue) {
      return { goldMultiplier: effectValue };
    }
  });

  // Terrain Movement Bonuses
  registerEffectHandler('forest_movement', {
    phase: EFFECT_PHASES.BATTLE_START,
    description: 'Reduced movement cost in forest terrain',
    apply(unit, effectValue) {
      unit.terrainBonuses = unit.terrainBonuses || {};
      unit.terrainBonuses.forest = effectValue;
      return { type: 'terrain_bonus', terrain: 'forest', amount: effectValue };
    }
  });

  registerEffectHandler('mountain_movement', {
    phase: EFFECT_PHASES.BATTLE_START,
    description: 'Reduced movement cost in mountain terrain',
    apply(unit, effectValue) {
      unit.terrainBonuses = unit.terrainBonuses || {};
      unit.terrainBonuses.mountain = effectValue;
      return { type: 'terrain_bonus', terrain: 'mountain', amount: effectValue };
    }
  });

  // Night Bonus - Bonus during night battles
  registerEffectHandler('night_bonus', {
    phase: EFFECT_PHASES.BATTLE_START,
    description: 'Stat bonus during night battles',
    apply(unit, effectValue, context) {
      if (!context.isNight) return null;
      // Apply small stat bonus during night
      unit.nightBonus = effectValue;
      return { type: 'night_bonus', amount: effectValue };
    }
  });

  console.log('[TraitEffects] Special effects registered');
}
