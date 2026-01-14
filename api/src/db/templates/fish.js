/**
 * Fish Templates - Fish types and rarities for fishing system
 *
 * Fish are caught at fishing_spot nodes and can be sold for gold.
 * Some fish may be used in future crafting/cooking systems.
 */

/**
 * Fish types with rarity weights
 * Rarity determines both catch chance and base value
 */
export const FISH_TYPES = [
  // Common (50% total chance)
  { id: 'bass', name: 'Bass', rarity: 'common', baseValue: 5, description: 'A common freshwater fish.' },
  { id: 'carp', name: 'Carp', rarity: 'common', baseValue: 6, description: 'Hardy and plentiful.' },
  { id: 'trout', name: 'Trout', rarity: 'common', baseValue: 8, description: 'Popular among fishers.' },
  { id: 'perch', name: 'Perch', rarity: 'common', baseValue: 7, description: 'A striped lake dweller.' },
  { id: 'bream', name: 'Bream', rarity: 'common', baseValue: 6, description: 'Flat and silvery.' },

  // Uncommon (30% total chance)
  { id: 'salmon', name: 'Salmon', rarity: 'uncommon', baseValue: 20, description: 'Pink-fleshed and prized.' },
  { id: 'pike', name: 'Pike', rarity: 'uncommon', baseValue: 25, description: 'A fierce predator.' },
  { id: 'catfish', name: 'Catfish', rarity: 'uncommon', baseValue: 22, description: 'Whiskered bottom-dweller.' },
  { id: 'eel', name: 'Eel', rarity: 'uncommon', baseValue: 28, description: 'Slippery and elusive.' },

  // Rare (15% total chance)
  { id: 'golden_koi', name: 'Golden Koi', rarity: 'rare', baseValue: 75, description: 'Symbol of good fortune.' },
  { id: 'electric_eel', name: 'Electric Eel', rarity: 'rare', baseValue: 85, description: 'Crackling with energy.' },
  { id: 'moonfish', name: 'Moonfish', rarity: 'rare', baseValue: 90, description: 'Glows faintly in darkness.' },

  // Epic (4% total chance)
  { id: 'sea_dragon', name: 'Sea Dragon', rarity: 'epic', baseValue: 300, description: 'Mythical serpent of the deep.' },
  { id: 'ancient_carp', name: 'Ancient Carp', rarity: 'epic', baseValue: 350, description: 'Said to be centuries old.' },

  // Legendary (1% total chance)
  { id: 'leviathan_scale', name: 'Leviathan Scale', rarity: 'legendary', baseValue: 1000, description: 'A scale from the great sea beast.' }
];

/**
 * Rarity weights for weighted random selection
 */
export const RARITY_WEIGHTS = {
  common: 50,
  uncommon: 30,
  rare: 15,
  epic: 4,
  legendary: 1
};

/**
 * Fishing session configuration
 */
export const FISHING_CONFIG = {
  // Time between automatic catches (ms)
  minCatchInterval: 20000, // 20 seconds
  maxCatchInterval: 45000, // 45 seconds

  // "Big One" event configuration
  bigOneChance: 0.20, // 20% chance per catch to trigger
  bigOneWindowMs: 5000, // 5 seconds to react
  bigOneBonus: 2.0, // 2x value for successful big one catch

  // Session limits
  maxSessionDuration: 30 * 60 * 1000, // 30 minutes max session
  catchCooldown: 15000, // Minimum 15 seconds between catches

  // Value modifiers
  sizeMultiplierMin: 0.8, // Minimum size multiplier
  sizeMultiplierMax: 1.5  // Maximum size multiplier
};

/**
 * Get fish by rarity using weighted random selection
 * @param {Function} random - Random function (0-1)
 * @returns {Object} Selected fish type
 */
export function selectRandomFish(random) {
  const roll = random() * 100;
  let cumulative = 0;
  let selectedRarity = 'common';

  for (const [rarity, weight] of Object.entries(RARITY_WEIGHTS)) {
    cumulative += weight;
    if (roll < cumulative) {
      selectedRarity = rarity;
      break;
    }
  }

  // Get all fish of selected rarity
  const fishOfRarity = FISH_TYPES.filter(f => f.rarity === selectedRarity);

  // Random selection within rarity
  const index = Math.floor(random() * fishOfRarity.length);
  return fishOfRarity[index];
}

/**
 * Calculate catch value with size modifier
 * @param {Object} fish - Fish type object
 * @param {number} sizeMultiplier - Size modifier (0.8-1.5)
 * @param {boolean} isBigOne - Whether this was a successful big one catch
 * @returns {number} Final gold value
 */
export function calculateFishValue(fish, sizeMultiplier = 1.0, isBigOne = false) {
  let value = Math.floor(fish.baseValue * sizeMultiplier);

  if (isBigOne) {
    value = Math.floor(value * FISHING_CONFIG.bigOneBonus);
  }

  return value;
}

/**
 * Get fish by ID
 * @param {string} fishId - Fish ID
 * @returns {Object|null} Fish type or null
 */
export function getFishById(fishId) {
  return FISH_TYPES.find(f => f.id === fishId) || null;
}
