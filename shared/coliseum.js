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

// =============================================================================
// ACHIEVEMENT BADGES SYSTEM
// =============================================================================

/**
 * Achievement badge definitions for Coliseum PvP
 * Includes milestone badges (permanent), skill badges (earned through feats),
 * and streak badges (dynamic, computed from winStreak)
 */
export const ACHIEVEMENT_BADGES = {
  // Milestone Badges (Permanent) - Earned through cumulative progress
  first_blood: {
    name: 'First Blood',
    icon: '\u{2694}\u{FE0F}',  // Crossed swords
    description: 'Win your first PvP match',
    type: 'milestone'
  },
  veteran: {
    name: 'Veteran',
    icon: '\u{1F3AF}',  // Target/Bullseye
    description: 'Win 50 PvP matches',
    type: 'milestone'
  },
  legend: {
    name: 'Coliseum Legend',
    icon: '\u{1F3DB}\u{FE0F}',  // Classical building
    description: 'Win 200 PvP matches',
    type: 'milestone'
  },
  climber: {
    name: 'Climber',
    icon: '\u{1F4C8}',  // Chart increasing
    description: 'Reach Gold tier',
    type: 'milestone'
  },
  elite: {
    name: 'Elite',
    icon: '\u{1F451}',  // Crown
    description: 'Reach Master tier',
    type: 'milestone'
  },
  champion: {
    name: 'Champion',
    icon: '\u{1F3C6}',  // Trophy
    description: 'Reach Grandmaster tier',
    type: 'milestone'
  },

  // Skill Badges (Earned Through Feats) - Earned in specific matches
  giant_slayer: {
    name: 'Giant Slayer',
    icon: '\u{1F4AA}',  // Flexed biceps
    description: 'Beat opponent 200+ ELO above you',
    type: 'skill'
  },
  underdog: {
    name: 'Underdog',
    icon: '\u{1F423}',  // Hatching chick
    description: 'Win with 20%+ PPR disadvantage',
    type: 'skill'
  },
  flawless: {
    name: 'Flawless',
    icon: '\u{2728}',  // Sparkles
    description: 'Win without losing a single unit',
    type: 'skill'
  },
  comeback: {
    name: 'Comeback Kid',
    icon: '\u{1F504}',  // Counterclockwise arrows
    description: 'Win after losing 50%+ of units first',
    type: 'skill'
  },

  // Streak Badges (Dynamic - not stored, computed from winStreak)
  on_fire: {
    name: 'On Fire',
    icon: '\u{1F525}',  // Fire
    description: 'Active 3+ win streak',
    type: 'streak',
    minStreak: 3
  },
  unstoppable: {
    name: 'Unstoppable',
    icon: '\u{1F480}',  // Skull
    description: 'Active 5+ win streak',
    type: 'streak',
    minStreak: 5
  },
  dominating: {
    name: 'Dominating',
    icon: '\u{26A1}',  // Lightning bolt
    description: 'Active 10+ win streak',
    type: 'streak',
    minStreak: 10
  }
};

/**
 * Get the streak badge for a given win streak
 * Returns the highest applicable streak badge or null
 * @param {number} winStreak - Current win streak
 * @returns {Object|null} Badge info or null if no streak badge applies
 */
export function getStreakBadge(winStreak) {
  if (winStreak >= 10) {
    return { key: 'dominating', ...ACHIEVEMENT_BADGES.dominating };
  }
  if (winStreak >= 5) {
    return { key: 'unstoppable', ...ACHIEVEMENT_BADGES.unstoppable };
  }
  if (winStreak >= 3) {
    return { key: 'on_fire', ...ACHIEVEMENT_BADGES.on_fire };
  }
  return null;
}

/**
 * Get all badges for a user, combining stored achievements with dynamic streak badge
 * @param {Array} achievements - Array of achievement records from database
 * @param {number} winStreak - Current win streak for dynamic badges
 * @returns {Array} Array of badge objects with key, name, icon, description, earnedAt
 */
export function getUserBadges(achievements = [], winStreak = 0) {
  const badges = [];

  // Add stored achievements
  for (const achievement of achievements) {
    const badgeDef = ACHIEVEMENT_BADGES[achievement.achievement_key];
    if (badgeDef) {
      badges.push({
        key: achievement.achievement_key,
        ...badgeDef,
        earnedAt: achievement.earned_at
      });
    }
  }

  // Add dynamic streak badge
  const streakBadge = getStreakBadge(winStreak);
  if (streakBadge) {
    badges.push({
      ...streakBadge,
      earnedAt: null,  // Dynamic badges have no earned date
      isDynamic: true
    });
  }

  return badges;
}

/**
 * Get priority-sorted badges for display (max count limited)
 * Priority: streak > tier (champion/elite/climber) > skill > milestone
 * @param {Array} badges - Array of badge objects
 * @param {number} maxBadges - Maximum badges to return (default 3)
 * @returns {Array} Priority-sorted array of badges
 */
export function getPriorityBadges(badges, maxBadges = 3) {
  // Define priority scores (higher = more important)
  const getPriority = (badge) => {
    // Streak badges always highest priority
    if (badge.type === 'streak') return 100 + (badge.minStreak || 0);

    // Tier badges second priority
    if (badge.key === 'champion') return 50;
    if (badge.key === 'elite') return 45;
    if (badge.key === 'climber') return 40;

    // Skill badges third priority
    if (badge.type === 'skill') return 30;

    // Milestone badges (non-tier) lowest priority
    if (badge.key === 'legend') return 20;
    if (badge.key === 'veteran') return 15;
    if (badge.key === 'first_blood') return 10;

    return 0;
  };

  return [...badges]
    .sort((a, b) => getPriority(b) - getPriority(a))
    .slice(0, maxBadges);
}
