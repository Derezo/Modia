/**
 * Coliseum Shared Constants and Utilities
 * Used by both frontend and backend for PvP tier calculations
 */

/**
 * Tier definitions for the Coliseum ranking system
 * Each tier has a minimum rating threshold, display name, color, and icon
 */
export const COLISEUM_TIERS = {
  GRANDMASTER: {
    name: 'Grandmaster',
    minRating: 2000,
    color: '#c45a5a',    // Crimson
    icon: 'trophy'
  },
  MASTER: {
    name: 'Master',
    minRating: 1800,
    color: '#9a6ab8',    // Purple
    icon: 'star'
  },
  PLATINUM: {
    name: 'Platinum',
    minRating: 1600,
    color: '#7ec8e8',    // Ice blue
    icon: 'diamond'
  },
  GOLD: {
    name: 'Gold',
    minRating: 1400,
    color: '#b8956a',    // Gold
    icon: 'crown'
  },
  SILVER: {
    name: 'Silver',
    minRating: 1200,
    color: '#a8a8a8',    // Silver
    icon: 'swords'
  },
  BRONZE: {
    name: 'Bronze',
    minRating: 1000,
    color: '#cd7f32',    // Bronze
    icon: 'shield'
  },
  UNRANKED: {
    name: 'Unranked',
    minRating: 0,
    color: '#6a6a6a',    // Gray
    icon: null
  }
};

/**
 * Get tier information for a given rating
 * @param {number} rating - The player's ELO rating
 * @returns {Object} Tier info with name, color, icon, and minRating
 */
export function getTier(rating) {
  if (rating >= 2000) {
    return { ...COLISEUM_TIERS.GRANDMASTER };
  }
  if (rating >= 1800) {
    return { ...COLISEUM_TIERS.MASTER };
  }
  if (rating >= 1600) {
    return { ...COLISEUM_TIERS.PLATINUM };
  }
  if (rating >= 1400) {
    return { ...COLISEUM_TIERS.GOLD };
  }
  if (rating >= 1200) {
    return { ...COLISEUM_TIERS.SILVER };
  }
  if (rating >= 1000) {
    return { ...COLISEUM_TIERS.BRONZE };
  }
  return { ...COLISEUM_TIERS.UNRANKED };
}

/**
 * Get the tier name for a given rating
 * @param {number} rating - The player's ELO rating
 * @returns {string} Tier name
 */
export function getTierName(rating) {
  return getTier(rating).name;
}

/**
 * Get the tier color for a given rating
 * @param {number} rating - The player's ELO rating
 * @returns {string} Hex color code
 */
export function getTierColor(rating) {
  return getTier(rating).color;
}

/**
 * Check if a rating qualifies for a specific tier
 * @param {number} rating - The player's ELO rating
 * @param {string} tierName - The tier name to check against
 * @returns {boolean} True if rating meets or exceeds tier threshold
 */
export function isInTier(rating, tierName) {
  const tier = Object.values(COLISEUM_TIERS).find(t => t.name === tierName);
  if (!tier) return false;
  return getTier(rating).name === tierName;
}

/**
 * Get rating required to reach next tier
 * @param {number} rating - Current rating
 * @returns {Object|null} Next tier info with pointsNeeded, or null if at max tier
 */
export function getNextTierProgress(rating) {
  // Tiers in ascending order of minRating
  const tiers = [
    COLISEUM_TIERS.BRONZE,      // 1000
    COLISEUM_TIERS.SILVER,      // 1200
    COLISEUM_TIERS.GOLD,        // 1400
    COLISEUM_TIERS.PLATINUM,    // 1600
    COLISEUM_TIERS.MASTER,      // 1800
    COLISEUM_TIERS.GRANDMASTER  // 2000
  ];

  // Find the next tier the player hasn't reached yet
  for (const tier of tiers) {
    if (rating < tier.minRating) {
      return {
        nextTier: tier,
        pointsNeeded: tier.minRating - rating
      };
    }
  }

  // Already at Grandmaster
  return null;
}

/**
 * Get all tiers sorted by minimum rating (descending)
 * @returns {Array} Array of tier objects
 */
export function getAllTiers() {
  return [
    COLISEUM_TIERS.GRANDMASTER,
    COLISEUM_TIERS.MASTER,
    COLISEUM_TIERS.PLATINUM,
    COLISEUM_TIERS.GOLD,
    COLISEUM_TIERS.SILVER,
    COLISEUM_TIERS.BRONZE,
    COLISEUM_TIERS.UNRANKED
  ];
}

/**
 * Unicode icons for tier badges (fallback when custom icons unavailable)
 * Maps icon names to unicode characters
 */
export const TIER_ICONS = {
  trophy: '\u{1F3C6}',    // Trophy emoji
  star: '\u{2B50}',       // Star emoji
  diamond: '\u{1F48E}',   // Gem/Diamond emoji
  crown: '\u{1F451}',     // Crown emoji
  swords: '\u{2694}',     // Crossed swords
  shield: '\u{1F6E1}'     // Shield emoji
};

/**
 * Get the unicode icon for a tier
 * @param {string} iconName - The icon name from tier definition
 * @returns {string} Unicode character or empty string
 */
export function getTierIcon(iconName) {
  if (!iconName) return '';
  return TIER_ICONS[iconName] || '';
}
