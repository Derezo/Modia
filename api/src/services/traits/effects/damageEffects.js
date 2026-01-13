/**
 * Damage Effects
 *
 * These effects modify damage dealt or received during combat.
 * They return multipliers that are aggregated for final damage calculation.
 */

import { registerEffectHandler, EFFECT_PHASES } from '../traitEffectRegistry.js';

/**
 * Register all damage-related effect handlers
 */
export function initDamageEffects() {
  // Physical Damage Bonus - Applies only to physical attacks
  registerEffectHandler('physical_damage_bonus', {
    phase: EFFECT_PHASES.ON_DAMAGE_DEALT,
    description: 'Percentage bonus to physical damage',
    apply(unit, effectValue, context) {
      if (context.damageType !== 'physical') return null;
      return { multiplier: effectValue };
    }
  });

  // Magic Damage Bonus - Applies only to magical attacks
  registerEffectHandler('magic_damage_bonus', {
    phase: EFFECT_PHASES.ON_DAMAGE_DEALT,
    description: 'Percentage bonus to magical damage',
    apply(unit, effectValue, context) {
      if (context.damageType !== 'magical') return null;
      return { multiplier: effectValue };
    }
  });

  // All Damage Bonus - Applies to any damage type
  registerEffectHandler('all_damage_bonus', {
    phase: EFFECT_PHASES.ON_DAMAGE_DEALT,
    description: 'Percentage bonus to all damage',
    apply(unit, effectValue) {
      return { multiplier: effectValue };
    }
  });

  // Critical Damage Bonus - Extra damage on critical hits
  registerEffectHandler('critical_damage_bonus', {
    phase: EFFECT_PHASES.ON_DAMAGE_DEALT,
    description: 'Extra percentage on critical hits',
    apply(unit, effectValue, context) {
      if (!context.isCritical) return null;
      return { multiplier: effectValue };
    }
  });

  // Low HP Damage Bonus - Bonus when below 30% HP
  registerEffectHandler('low_hp_damage_bonus', {
    phase: EFFECT_PHASES.ON_DAMAGE_DEALT,
    description: 'Bonus damage when below 30% HP',
    apply(unit, effectValue) {
      if (unit.hp / unit.maxHp >= 0.3) return null;
      return { multiplier: effectValue };
    }
  });

  // Dragon Damage Bonus - Extra vs dragon enemies
  registerEffectHandler('dragon_damage_bonus', {
    phase: EFFECT_PHASES.ON_DAMAGE_DEALT,
    description: 'Bonus damage vs dragon-type enemies',
    apply(unit, effectValue, context) {
      const defender = context.defender;
      if (defender?.archetype !== 'dragon' && defender?.race !== 'dragon') {
        return null;
      }
      return { multiplier: effectValue };
    }
  });

  // Undead Damage Bonus - Extra vs undead enemies
  registerEffectHandler('undead_damage_bonus', {
    phase: EFFECT_PHASES.ON_DAMAGE_DEALT,
    description: 'Bonus damage vs undead-type enemies',
    apply(unit, effectValue, context) {
      const defender = context.defender;
      if (defender?.archetype !== 'undead' && defender?.race !== 'undead') {
        return null;
      }
      return { multiplier: effectValue };
    }
  });

  // Demon Damage Bonus - Extra vs demon enemies
  registerEffectHandler('demon_damage_bonus', {
    phase: EFFECT_PHASES.ON_DAMAGE_DEALT,
    description: 'Bonus damage vs demon-type enemies',
    apply(unit, effectValue, context) {
      const defender = context.defender;
      if (defender?.archetype !== 'demon' && defender?.race !== 'demon') {
        return null;
      }
      return { multiplier: effectValue };
    }
  });

  // Boss Damage Bonus - Extra vs boss enemies
  registerEffectHandler('boss_damage_bonus', {
    phase: EFFECT_PHASES.ON_DAMAGE_DEALT,
    description: 'Bonus damage vs boss enemies',
    apply(unit, effectValue, context) {
      if (!context.defender?.isBoss) return null;
      return { multiplier: effectValue };
    }
  });

  console.log('[TraitEffects] Damage effects registered');
}
