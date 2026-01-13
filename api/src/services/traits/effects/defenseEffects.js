/**
 * Defense Effects
 *
 * These effects reduce incoming damage when the unit is attacked.
 */

import { registerEffectHandler, EFFECT_PHASES } from '../traitEffectRegistry.js';

/**
 * Register all defense-related effect handlers
 */
export function initDefenseEffects() {
  // Physical Resistance - Reduces physical damage taken
  registerEffectHandler('physical_resistance', {
    phase: EFFECT_PHASES.ON_DAMAGE_RECEIVED,
    description: 'Percentage reduction to physical damage taken',
    apply(unit, effectValue, context) {
      if (context.damageType !== 'physical') return null;
      // Return negative multiplier to indicate reduction
      return { multiplier: -effectValue };
    }
  });

  // Magic Resistance - Reduces magical damage taken
  registerEffectHandler('magic_resistance', {
    phase: EFFECT_PHASES.ON_DAMAGE_RECEIVED,
    description: 'Percentage reduction to magical damage taken',
    apply(unit, effectValue, context) {
      if (context.damageType !== 'magical') return null;
      return { multiplier: -effectValue };
    }
  });

  // All Resistance - Reduces all damage taken
  registerEffectHandler('all_resistance', {
    phase: EFFECT_PHASES.ON_DAMAGE_RECEIVED,
    description: 'Percentage reduction to all damage taken',
    apply(unit, effectValue) {
      return { multiplier: -effectValue };
    }
  });

  console.log('[TraitEffects] Defense effects registered');
}
