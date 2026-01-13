/**
 * Trait Effect Registry
 *
 * A modular, extensible system for registering and applying trait effects.
 * Effects are categorized by when they apply (phase) and can be easily extended.
 *
 * Usage:
 *   1. Import and register handlers in effect modules
 *   2. Call applyEffectsForPhase() at the appropriate time in battle logic
 *   3. Add new effects by creating a new handler and registering it
 */

/**
 * Effect application phases - when different types of effects are applied
 */
export const EFFECT_PHASES = {
  /** Applied once when unit enters battle (HP/MP bonuses, movement, range) */
  BATTLE_START: 'battleStart',

  /** Applied when calculating outgoing damage */
  ON_DAMAGE_DEALT: 'onDamageDealt',

  /** Applied when calculating incoming damage (resistance, reduction) */
  ON_DAMAGE_RECEIVED: 'onDamageReceived',

  /** Applied at the start of the unit's turn (regen, etc.) */
  ON_TURN_START: 'onTurnStart',

  /** Applied during attack calculations (accuracy, crit chance) */
  ON_ATTACK: 'onAttack',

  /** Applied when unit defeats an enemy (lifesteal, on-kill effects) */
  ON_KILL: 'onKill',

  /** Applied when unit would die (death save, second wind) */
  ON_DEATH: 'onDeath',

  /** Applied when calculating rewards (XP/gold bonuses) */
  ON_REWARD: 'onReward'
};

/**
 * Registry of all effect handlers
 * Key: effect_type from database
 * Value: { phase, apply, description }
 */
const effectHandlers = new Map();

/**
 * Register a trait effect handler
 *
 * @param {string} effectType - The effect_type from the traits table
 * @param {Object} handler - Handler configuration
 * @param {string} handler.phase - One of EFFECT_PHASES
 * @param {Function} handler.apply - (unit, effectValue, context) => result
 * @param {string} [handler.description] - Human-readable description
 *
 * @example
 * registerEffectHandler('range_bonus', {
 *   phase: EFFECT_PHASES.BATTLE_START,
 *   description: 'Adds tiles to attack range',
 *   apply(unit, effectValue) {
 *     const bonus = Math.floor(effectValue);
 *     unit.attackRange = (unit.attackRange || 1) + bonus;
 *     return { type: 'range_increase', amount: bonus };
 *   }
 * });
 */
export function registerEffectHandler(effectType, handler) {
  if (!handler.phase || !handler.apply) {
    throw new Error(`Invalid handler for ${effectType}: must have phase and apply`);
  }
  effectHandlers.set(effectType, handler);
}

/**
 * Get handler for an effect type
 * @param {string} effectType
 * @returns {Object|null} Handler or null if not registered
 */
export function getEffectHandler(effectType) {
  return effectHandlers.get(effectType) || null;
}

/**
 * Check if an effect type has a registered handler
 * @param {string} effectType
 * @returns {boolean}
 */
export function hasEffectHandler(effectType) {
  return effectHandlers.has(effectType);
}

/**
 * Get all registered effect types
 * @returns {string[]}
 */
export function getRegisteredEffectTypes() {
  return Array.from(effectHandlers.keys());
}

/**
 * Get all effect types that apply in a given phase
 * @param {string} phase - One of EFFECT_PHASES
 * @returns {string[]} Array of effect type names
 */
export function getEffectTypesForPhase(phase) {
  const types = [];
  for (const [effectType, handler] of effectHandlers) {
    if (handler.phase === phase) {
      types.push(effectType);
    }
  }
  return types;
}

/**
 * Apply all trait effects for a given phase
 *
 * @param {Object} unit - Battle unit with traits array
 * @param {string} phase - One of EFFECT_PHASES
 * @param {Object} [context={}] - Additional context (defender, damageType, etc.)
 * @returns {Object} { modified: boolean, effects: Array }
 *
 * @example
 * // At battle start
 * const results = applyEffectsForPhase(unit, EFFECT_PHASES.BATTLE_START);
 *
 * // During damage calculation
 * const results = applyEffectsForPhase(attacker, EFFECT_PHASES.ON_DAMAGE_DEALT, {
 *   defender,
 *   damageType: 'physical',
 *   isCritical: false
 * });
 */
export function applyEffectsForPhase(unit, phase, context = {}) {
  if (!unit.traits || unit.traits.length === 0) {
    return { modified: false, effects: [] };
  }

  const results = {
    modified: false,
    effects: []
  };

  for (const trait of unit.traits) {
    const handler = effectHandlers.get(trait.effectType);

    if (handler && handler.phase === phase) {
      try {
        const result = handler.apply(unit, trait.effectValue, context);
        if (result) {
          results.modified = true;
          results.effects.push({
            traitName: trait.name,
            effectType: trait.effectType,
            ...result
          });
        }
      } catch (error) {
        console.error(`[TraitRegistry] Error applying ${trait.effectType} for ${unit.name}:`, error);
      }
    }
  }

  return results;
}

/**
 * Calculate aggregate multiplier from all damage-related traits
 *
 * @param {Object} unit - Battle unit
 * @param {string} phase - Should be ON_DAMAGE_DEALT or ON_DAMAGE_RECEIVED
 * @param {Object} context - { damageType, defender, isCritical, etc. }
 * @returns {number} Combined multiplier (e.g., 1.25 for 25% bonus)
 */
export function getAggregateMultiplier(unit, phase, context = {}) {
  if (!unit.traits || unit.traits.length === 0) {
    return 1.0;
  }

  let multiplier = 1.0;

  for (const trait of unit.traits) {
    const handler = effectHandlers.get(trait.effectType);

    if (handler && handler.phase === phase) {
      try {
        const result = handler.apply(unit, trait.effectValue, context);
        if (result && result.multiplier !== undefined) {
          // Additive stacking: multiply adds to bonus
          multiplier += result.multiplier;
        }
      } catch (error) {
        console.error(`[TraitRegistry] Error in multiplier calc for ${trait.effectType}:`, error);
      }
    }
  }

  return multiplier;
}

/**
 * Debug: List all registered handlers
 */
export function debugListHandlers() {
  console.log('[TraitRegistry] Registered effect handlers:');
  for (const [effectType, handler] of effectHandlers) {
    console.log(`  - ${effectType}: phase=${handler.phase}, desc=${handler.description || 'n/a'}`);
  }
}
