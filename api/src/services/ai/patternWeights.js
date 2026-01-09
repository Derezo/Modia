/**
 * AI Pattern Weights Configuration
 *
 * Defines weight matrices for different AI behavioral patterns.
 * Higher weights = more importance placed on that factor.
 *
 * Factors:
 * - DAMAGE_DEALT: Expected damage from action (0-1000+)
 * - DAMAGE_RECEIVED: Expected incoming damage at position (0-1000+)
 * - KILL_POTENTIAL: Bonus for lethal actions (0/1)
 * - POSITION_QUALITY: Tactical value of position (-100 to +100)
 * - ALLY_SUPPORT: Proximity to friendly units (0-50)
 * - HEALING_VALUE: Value of support actions (0-500)
 * - SURVIVAL_PRIORITY: Self-preservation importance (0-200)
 * - MP_EFFICIENCY: Value of conserving MP (0-100)
 * - TARGET_PRIORITY: Preference for specific targets (0-100)
 */

const PATTERN_WEIGHTS = {
  /**
   * Aggressive pattern - Prioritizes damage and kills
   * Best for: Predators, berserkers, aggressive monsters
   */
  aggressive: {
    name: 'Aggressive',
    description: 'Maximizes damage dealt, seeks kills, low self-preservation',
    weights: {
      DAMAGE_DEALT: 2.0,
      DAMAGE_RECEIVED: 0.3,
      KILL_POTENTIAL: 2.5,
      POSITION_QUALITY: 0.8,
      ALLY_SUPPORT: 0.5,
      HEALING_VALUE: 0.3,
      SURVIVAL_PRIORITY: 0.3,
      MP_EFFICIENCY: 0.5,
      TARGET_PRIORITY: 1.2
    }
  },

  /**
   * Defensive pattern - Prioritizes survival and protection
   * Best for: Tanks, guardians, constructs
   */
  defensive: {
    name: 'Defensive',
    description: 'Prioritizes survival, safe positions, protective actions',
    weights: {
      DAMAGE_DEALT: 0.8,
      DAMAGE_RECEIVED: 2.0,
      KILL_POTENTIAL: 1.0,
      POSITION_QUALITY: 1.5,
      ALLY_SUPPORT: 1.5,
      HEALING_VALUE: 1.5,
      SURVIVAL_PRIORITY: 2.5,
      MP_EFFICIENCY: 1.0,
      TARGET_PRIORITY: 0.8
    }
  },

  /**
   * Support pattern - Prioritizes helping allies
   * Best for: Healers, buffers, pack leaders
   */
  support: {
    name: 'Support',
    description: 'Focuses on healing, buffing, and ally protection',
    weights: {
      DAMAGE_DEALT: 0.5,
      DAMAGE_RECEIVED: 1.8,
      KILL_POTENTIAL: 0.5,
      POSITION_QUALITY: 1.2,
      ALLY_SUPPORT: 2.5,
      HEALING_VALUE: 3.0,
      SURVIVAL_PRIORITY: 2.0,
      MP_EFFICIENCY: 1.5,
      TARGET_PRIORITY: 0.5
    }
  },

  /**
   * Tactical pattern - Balanced, position-focused
   * Best for: Intelligent enemies, strategists, boss units
   */
  tactical: {
    name: 'Tactical',
    description: 'Balanced approach with focus on positioning and target priority',
    weights: {
      DAMAGE_DEALT: 1.5,
      DAMAGE_RECEIVED: 1.2,
      KILL_POTENTIAL: 3.0,
      POSITION_QUALITY: 2.0,
      ALLY_SUPPORT: 1.0,
      HEALING_VALUE: 1.0,
      SURVIVAL_PRIORITY: 1.5,
      MP_EFFICIENCY: 1.2,
      TARGET_PRIORITY: 2.0
    }
  },

  /**
   * Pack pattern - Coordinates with allies
   * Best for: Wolves, goblins, swarm creatures
   */
  pack: {
    name: 'Pack',
    description: 'Works closely with allies, flanking maneuvers',
    weights: {
      DAMAGE_DEALT: 1.5,
      DAMAGE_RECEIVED: 0.8,
      KILL_POTENTIAL: 1.5,
      POSITION_QUALITY: 1.5,
      ALLY_SUPPORT: 3.0,
      HEALING_VALUE: 1.2,
      SURVIVAL_PRIORITY: 1.0,
      MP_EFFICIENCY: 0.8,
      TARGET_PRIORITY: 1.5
    }
  },

  /**
   * Ambush pattern - Waits then strikes hard
   * Best for: Assassins, spiders, hidden enemies
   */
  ambush: {
    name: 'Ambush',
    description: 'Stays hidden, strikes vulnerable targets',
    weights: {
      DAMAGE_DEALT: 2.5,
      DAMAGE_RECEIVED: 1.5,
      KILL_POTENTIAL: 3.5,
      POSITION_QUALITY: 2.5,
      ALLY_SUPPORT: 0.3,
      HEALING_VALUE: 0.2,
      SURVIVAL_PRIORITY: 1.8,
      MP_EFFICIENCY: 1.0,
      TARGET_PRIORITY: 2.5
    }
  },

  /**
   * Berserker pattern - Maximum aggression, ignores safety
   * Best for: Raging creatures, desperate enemies
   */
  berserker: {
    name: 'Berserker',
    description: 'Pure aggression, no regard for self-preservation',
    weights: {
      DAMAGE_DEALT: 3.0,
      DAMAGE_RECEIVED: 0.0,
      KILL_POTENTIAL: 2.0,
      POSITION_QUALITY: 0.3,
      ALLY_SUPPORT: 0.0,
      HEALING_VALUE: 0.0,
      SURVIVAL_PRIORITY: 0.0,
      MP_EFFICIENCY: 0.0,
      TARGET_PRIORITY: 1.0
    }
  },

  /**
   * Ranged pattern - Maintains distance while attacking
   * Best for: Archers, mages, elementals
   */
  ranged: {
    name: 'Ranged',
    description: 'Maintains safe distance, kites enemies',
    weights: {
      DAMAGE_DEALT: 1.8,
      DAMAGE_RECEIVED: 1.5,
      KILL_POTENTIAL: 1.5,
      POSITION_QUALITY: 2.5,
      ALLY_SUPPORT: 0.8,
      HEALING_VALUE: 0.5,
      SURVIVAL_PRIORITY: 1.8,
      MP_EFFICIENCY: 1.5,
      TARGET_PRIORITY: 1.5
    }
  },

  /**
   * Boss pattern - Smart, adaptive, hard to predict
   * Best for: Boss encounters, elite enemies
   */
  boss: {
    name: 'Boss',
    description: 'Intelligent, adaptive behavior with varied tactics',
    weights: {
      DAMAGE_DEALT: 1.5,
      DAMAGE_RECEIVED: 1.0,
      KILL_POTENTIAL: 2.0,
      POSITION_QUALITY: 1.5,
      ALLY_SUPPORT: 1.0,
      HEALING_VALUE: 1.5,
      SURVIVAL_PRIORITY: 1.5,
      MP_EFFICIENCY: 1.0,
      TARGET_PRIORITY: 1.8
    }
  }
};

/**
 * Weight set for predicting player behavior
 * Used when simulating player turns in lookahead
 */
const OPTIMAL_PLAYER_WEIGHTS = {
  name: 'Optimal Player',
  description: 'Assumed player behavior for lookahead simulation',
  weights: {
    DAMAGE_DEALT: 1.8,
    DAMAGE_RECEIVED: 1.2,
    KILL_POTENTIAL: 2.5,
    POSITION_QUALITY: 1.5,
    ALLY_SUPPORT: 1.0,
    HEALING_VALUE: 1.5,
    SURVIVAL_PRIORITY: 1.5,
    MP_EFFICIENCY: 0.8,
    TARGET_PRIORITY: 2.0
  }
};

/**
 * Get weights for a pattern
 * @param {string} pattern - Pattern name
 * @returns {Object} Weight configuration
 */
function getWeights(pattern) {
  const patternLower = pattern?.toLowerCase() || 'aggressive';
  return PATTERN_WEIGHTS[patternLower] || PATTERN_WEIGHTS.aggressive;
}

/**
 * Get all available patterns
 * @returns {Array} Array of pattern names
 */
function getAvailablePatterns() {
  return Object.keys(PATTERN_WEIGHTS);
}

/**
 * Check if a pattern exists
 * @param {string} pattern - Pattern name
 * @returns {boolean}
 */
function patternExists(pattern) {
  return pattern?.toLowerCase() in PATTERN_WEIGHTS;
}

module.exports = {
  PATTERN_WEIGHTS,
  OPTIMAL_PLAYER_WEIGHTS,
  getWeights,
  getAvailablePatterns,
  patternExists
};
