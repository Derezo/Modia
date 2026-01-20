/**
 * ArchetypeSelector - Weighted archetype selection by node type
 *
 * Maps node/biome types to appropriate map archetypes with weighted
 * selection probabilities. This replaces the random algorithm pool
 * selection with curated, intentional map generation.
 *
 * Selection is deterministic - same seed always produces same archetype.
 */

import { ARCHETYPES, getArchetype } from './archetypeDefinitions.js';

// ============================================================================
// NODE TYPE TO ARCHETYPE WEIGHTS
// ============================================================================

/**
 * Weighted archetype selection for each node type
 * Weights are relative probabilities (will be normalized)
 *
 * Higher weight = more likely to be selected
 */
export const NODE_TYPE_ARCHETYPE_WEIGHTS = {
  /**
   * Forest nodes - Natural woodland environments
   */
  forest: {
    openField: 0.15,
    forestClearing: 0.40,
    plains: 0.20,
    swamp: 0.15,
    ruinedCastle: 0.10
  },

  /**
   * Cave nodes - Underground environments
   */
  cave: {
    caveRooms: 0.45,
    tunnelNetwork: 0.30,
    crystalCavern: 0.15,
    crypt: 0.10
  },

  /**
   * Mountain nodes - Rocky highland terrain
   */
  mountain: {
    mountainPass: 0.35,
    openField: 0.20,
    caveRooms: 0.15,
    plains: 0.15,
    ruinedCastle: 0.15
  },

  /**
   * Bridge nodes - River/chasm crossings
   */
  bridge: {
    bridgeCrossing: 0.70,
    mountainPass: 0.20,
    plains: 0.10
  },

  /**
   * Castle nodes - Structured interiors
   */
  castle: {
    dungeonHalls: 0.45,
    crypt: 0.20,
    ruinedCastle: 0.20,
    arena: 0.15
  },

  /**
   * Dungeon nodes - Underground structures
   */
  dungeon: {
    dungeonHalls: 0.40,
    crypt: 0.30,
    tunnelNetwork: 0.15,
    caveRooms: 0.15
  },

  /**
   * Swamp nodes - Wet, difficult terrain
   */
  swamp: {
    swamp: 0.50,
    forestClearing: 0.20,
    plains: 0.15,
    caveRooms: 0.15
  },

  /**
   * Volcano nodes - Hazardous terrain
   */
  volcano: {
    volcano: 0.60,
    caveRooms: 0.20,
    mountainPass: 0.20
  },

  /**
   * Plains nodes - Open terrain
   */
  plains: {
    openField: 0.35,
    plains: 0.35,
    forestClearing: 0.15,
    ruinedCastle: 0.15
  },

  /**
   * Arena nodes - Combat arenas
   */
  arena: {
    arena: 0.70,
    openField: 0.15,
    dungeonHalls: 0.15
  },

  // --------------------------------------------------------------------------
  // RACE SUBTYPE NODE MAPPINGS
  // --------------------------------------------------------------------------

  /**
   * Elven Grove - Sacred elven forests
   */
  elven_grove: {
    forestClearing: 0.50,
    forest: 0.25,
    swamp: 0.15,
    ruinedCastle: 0.10
  },

  /**
   * Dwarven Mine - Underground mining complexes
   */
  dwarven_mine: {
    tunnelNetwork: 0.40,
    dungeonHalls: 0.35,
    caveRooms: 0.15,
    crypt: 0.10
  },

  /**
   * Vampiric Crypt - Gothic undead lairs
   */
  vampiric_crypt: {
    crypt: 0.50,
    dungeonHalls: 0.25,
    tunnelNetwork: 0.15,
    caveRooms: 0.10
  },

  /**
   * Orcish Warcamp - Military encampments
   */
  orcish_warcamp: {
    openField: 0.30,
    plains: 0.25,
    ruinedCastle: 0.25,
    forestClearing: 0.20
  },

  /**
   * Human Ruins - Abandoned settlements
   */
  human_ruins: {
    ruinedCastle: 0.50,
    dungeonHalls: 0.20,
    plains: 0.15,
    forestClearing: 0.15
  }
};

// ============================================================================
// DEFAULT FALLBACK
// ============================================================================

/**
 * Default weights when node type is unknown
 */
export const DEFAULT_ARCHETYPE_WEIGHTS = {
  openField: 0.20,
  forestClearing: 0.20,
  caveRooms: 0.15,
  dungeonHalls: 0.15,
  plains: 0.15,
  arena: 0.15
};

// ============================================================================
// ARCHETYPE SELECTOR CLASS
// ============================================================================

/**
 * ArchetypeSelector - Handles weighted archetype selection
 */
export class ArchetypeSelector {
  /**
   * Create an archetype selector
   *
   * @param {Object} options - Configuration options
   * @param {Object} options.customWeights - Override weights for specific node types
   * @param {string[]} options.excludeArchetypes - Archetypes to never select
   */
  constructor(options = {}) {
    this.customWeights = options.customWeights || {};
    this.excludeArchetypes = new Set(options.excludeArchetypes || []);
  }

  /**
   * Get archetype weights for a node type
   *
   * @param {string} nodeType - Node/biome type
   * @returns {Object} Weight map {archetypeName: weight}
   */
  getWeightsForNodeType(nodeType) {
    // Check custom weights first
    if (this.customWeights[nodeType]) {
      return this._filterExcluded(this.customWeights[nodeType]);
    }

    // Check standard mappings
    if (NODE_TYPE_ARCHETYPE_WEIGHTS[nodeType]) {
      return this._filterExcluded(NODE_TYPE_ARCHETYPE_WEIGHTS[nodeType]);
    }

    // Fallback to defaults
    return this._filterExcluded(DEFAULT_ARCHETYPE_WEIGHTS);
  }

  /**
   * Filter out excluded archetypes from weight map
   * @private
   */
  _filterExcluded(weights) {
    if (this.excludeArchetypes.size === 0) return weights;

    const filtered = {};
    for (const [archetype, weight] of Object.entries(weights)) {
      if (!this.excludeArchetypes.has(archetype)) {
        filtered[archetype] = weight;
      }
    }
    return filtered;
  }

  /**
   * Select an archetype for a node type using weighted random selection
   *
   * @param {string} nodeType - Node/biome type
   * @param {function} random - Seeded random function returning 0-1
   * @returns {Object} Selected archetype definition
   */
  selectArchetype(nodeType, random) {
    const weights = this.getWeightsForNodeType(nodeType);
    const archetypes = Object.keys(weights);

    if (archetypes.length === 0) {
      // Fallback to first available archetype
      console.warn(`No archetypes available for node type: ${nodeType}`);
      return getArchetype('openField');
    }

    // Normalize weights
    const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);

    if (totalWeight === 0) {
      // Equal weights if all zero
      const index = Math.floor(random() * archetypes.length);
      return getArchetype(archetypes[index]);
    }

    // Weighted selection
    const roll = random() * totalWeight;
    let cumulative = 0;

    for (const archetypeName of archetypes) {
      cumulative += weights[archetypeName];
      if (roll < cumulative) {
        return getArchetype(archetypeName);
      }
    }

    // Fallback to last archetype (shouldn't reach here)
    return getArchetype(archetypes[archetypes.length - 1]);
  }

  /**
   * Select an archetype by name (no randomization)
   *
   * @param {string} archetypeName - Archetype name
   * @returns {Object|null} Archetype definition or null
   */
  selectByName(archetypeName) {
    if (this.excludeArchetypes.has(archetypeName)) {
      return null;
    }
    return getArchetype(archetypeName);
  }

  /**
   * Get all valid archetypes for a node type (sorted by weight)
   *
   * @param {string} nodeType - Node/biome type
   * @returns {Array<{archetype: Object, weight: number}>} Archetypes with weights
   */
  getValidArchetypes(nodeType) {
    const weights = this.getWeightsForNodeType(nodeType);
    const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);

    const result = [];
    for (const [name, weight] of Object.entries(weights)) {
      const archetype = getArchetype(name);
      if (archetype) {
        result.push({
          archetype,
          weight,
          probability: totalWeight > 0 ? weight / totalWeight : 1 / Object.keys(weights).length
        });
      }
    }

    // Sort by weight descending
    result.sort((a, b) => b.weight - a.weight);
    return result;
  }

  /**
   * Add custom weights for a node type
   *
   * @param {string} nodeType - Node type to configure
   * @param {Object} weights - Weight map {archetypeName: weight}
   */
  setCustomWeights(nodeType, weights) {
    this.customWeights[nodeType] = { ...weights };
  }

  /**
   * Exclude an archetype from selection
   *
   * @param {string} archetypeName - Archetype to exclude
   */
  excludeArchetype(archetypeName) {
    this.excludeArchetypes.add(archetypeName);
  }

  /**
   * Remove archetype from exclusion list
   *
   * @param {string} archetypeName - Archetype to include
   */
  includeArchetype(archetypeName) {
    this.excludeArchetypes.delete(archetypeName);
  }

  /**
   * Get probability of selecting a specific archetype for a node type
   *
   * @param {string} nodeType - Node type
   * @param {string} archetypeName - Archetype name
   * @returns {number} Selection probability (0-1)
   */
  getSelectionProbability(nodeType, archetypeName) {
    const weights = this.getWeightsForNodeType(nodeType);
    const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);

    if (totalWeight === 0 || weights[archetypeName] === undefined) {
      return 0;
    }

    return weights[archetypeName] / totalWeight;
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Select an archetype for a node type (convenience function)
 *
 * @param {string} nodeType - Node/biome type
 * @param {function} random - Seeded random function
 * @returns {Object} Selected archetype definition
 */
export function selectArchetypeForNode(nodeType, random) {
  const selector = new ArchetypeSelector();
  return selector.selectArchetype(nodeType, random);
}

/**
 * Get recommended archetype for a node type (highest weight)
 *
 * @param {string} nodeType - Node/biome type
 * @returns {Object} Recommended archetype definition
 */
export function getRecommendedArchetype(nodeType) {
  const selector = new ArchetypeSelector();
  const valid = selector.getValidArchetypes(nodeType);
  return valid.length > 0 ? valid[0].archetype : getArchetype('openField');
}

/**
 * Check if a node type has defined archetype weights
 *
 * @param {string} nodeType - Node type to check
 * @returns {boolean} True if weights are defined
 */
export function hasDefinedWeights(nodeType) {
  return nodeType in NODE_TYPE_ARCHETYPE_WEIGHTS;
}

export default ArchetypeSelector;
