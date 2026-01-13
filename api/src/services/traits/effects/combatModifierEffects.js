/**
 * Combat Modifier Effects
 *
 * These effects modify combat rolls like accuracy, crit chance, and evasion.
 */

import { registerEffectHandler, EFFECT_PHASES } from '../traitEffectRegistry.js';

/**
 * Register all combat modifier effect handlers
 */
export function initCombatModifierEffects() {
  // Accuracy Bonus - Improves hit chance
  registerEffectHandler('accuracy_bonus', {
    phase: EFFECT_PHASES.ON_ATTACK,
    description: 'Bonus to hit chance',
    apply(unit, effectValue) {
      return { accuracyBonus: effectValue };
    }
  });

  // Evasion Bonus - Improves dodge chance
  registerEffectHandler('evasion_bonus', {
    phase: EFFECT_PHASES.ON_DAMAGE_RECEIVED,
    description: 'Bonus to dodge chance',
    apply(unit, effectValue) {
      return { evasionBonus: effectValue };
    }
  });

  // Critical Chance Bonus - Improves crit rate
  registerEffectHandler('crit_chance_bonus', {
    phase: EFFECT_PHASES.ON_ATTACK,
    description: 'Bonus to critical hit chance',
    apply(unit, effectValue) {
      return { critBonus: effectValue };
    }
  });

  // Luck Effectiveness - Multiplier on luck-based calculations
  registerEffectHandler('luck_effectiveness', {
    phase: EFFECT_PHASES.ON_ATTACK,
    description: 'Multiplier on luck-based rolls (crit, drops)',
    apply(unit, effectValue) {
      return { luckMultiplier: effectValue };
    }
  });

  // MP Cost Reduction - Reduces skill MP costs
  registerEffectHandler('mp_cost_reduction', {
    phase: EFFECT_PHASES.ON_ATTACK,
    description: 'Percentage reduction to skill MP costs',
    apply(unit, effectValue) {
      return { mpCostReduction: effectValue };
    }
  });

  console.log('[TraitEffects] Combat modifier effects registered');
}
