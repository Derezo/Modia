/**
 * Marketplace Utilities - Shared helper functions
 */

/**
 * Format a date/time for display
 * @param {string|Date} dateStr - Date to format
 * @returns {string} Formatted time string
 */
export function formatTime(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/**
 * Capitalize a string (first letter uppercase, replace underscores with spaces)
 * @param {string} str - String to capitalize
 * @returns {string} Capitalized string
 */
export function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ') : '';
}

/**
 * Map rarity number to string name
 * @param {number|string} rarity - Rarity value
 * @returns {string} Rarity name
 */
export function getRarityName(rarity) {
  const rarityMap = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  if (typeof rarity === 'number') {
    return rarityMap[rarity - 1] || 'common';
  }
  return rarity || 'common';
}

/**
 * Format stat name for display
 * @param {string} stat - Stat key name
 * @returns {string} Formatted stat name
 */
export function formatStatName(stat) {
  return stat.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
}

/**
 * Format listing stats for display
 * @param {Object} listing - Listing data
 * @returns {string} HTML string of stats
 */
export function formatListingStats(listing) {
  const stats = { ...(listing.baseStats || {}), ...(listing.bonusStats || {}) };
  const entries = Object.entries(stats).filter(([, v]) => v && v !== 0);

  if (entries.length === 0) return '';

  const statNames = {
    strength: 'STR', intelligence: 'INT', agility: 'AGI', vitality: 'VIT',
    defense: 'DEF', magicDefense: 'MDEF', attack: 'ATK', magicAttack: 'MATK'
  };

  return entries.map(([k, v]) => {
    const name = statNames[k] || k.toUpperCase();
    const sign = v > 0 ? '+' : '';
    return `<div style="display: flex; justify-content: space-between; padding: 2px 0;">
      <span style="color: #5a4a3a;">${name}</span>
      <span style="color: #3d6b35; font-family: Consolas, monospace;">${sign}${v}</span>
    </div>`;
  }).join('');
}

/**
 * Rarity colors for styling
 */
export const RARITY_COLORS = {
  common: '#7a6a5a',
  uncommon: '#4a7548',
  rare: '#4a6a8b',
  epic: '#6b4488',
  legendary: '#aa8833'
};
