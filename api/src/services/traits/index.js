/**
 * Trait Effects Module
 *
 * Initializes all trait effect handlers. Import this module once at server startup.
 *
 * Usage:
 *   import { initializeTraitEffects } from './services/traits/index.js';
 *   initializeTraitEffects();
 */

import { initBattleStartEffects } from './effects/battleStartEffects.js';
import { initDamageEffects } from './effects/damageEffects.js';
import { initDefenseEffects } from './effects/defenseEffects.js';
import { initCombatModifierEffects } from './effects/combatModifierEffects.js';
import { initSpecialEffects } from './effects/specialEffects.js';

// Re-export registry functions for convenience
export * from './traitEffectRegistry.js';

let initialized = false;

/**
 * Initialize all trait effect handlers
 * Call this once at server startup
 */
export function initializeTraitEffects() {
  if (initialized) {
    console.log('[TraitEffects] Already initialized, skipping');
    return;
  }

  console.log('[TraitEffects] Initializing trait effect registry...');

  initBattleStartEffects();
  initDamageEffects();
  initDefenseEffects();
  initCombatModifierEffects();
  initSpecialEffects();

  initialized = true;
  console.log('[TraitEffects] All effect handlers initialized');
}

/**
 * Check if trait effects have been initialized
 */
export function isTraitEffectsInitialized() {
  return initialized;
}
