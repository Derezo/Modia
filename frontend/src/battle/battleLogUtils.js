/**
 * @module battleLogUtils
 * @description Shared utilities for battle log formatting and display.
 *
 * Key responsibilities:
 * - Color definitions for different log entry types
 * - Damage result formatting with critical hit breakdown
 * - Status effect badge rendering
 * - Action type to color mapping
 *
 * @see BattleLogPanel.js - Collapsible inline log panel
 * @see BattleLogModal.js - Full-featured log modal dialog
 */

/**
 * Color palette for log entry types
 */
export const LOG_COLORS = {
  damage: '#cc4444',      // Red for damage dealt
  healing: '#44aa66',     // Green for healing
  buff: '#4488cc',        // Blue for buffs
  debuff: '#cc8844',      // Orange for debuffs
  status: '#ccaa44',      // Yellow for status effects
  movement: '#888888',    // Gray for movement
  critical: '#ffcc00',    // Gold for critical hits
  miss: '#666666',        // Dark gray for misses
  wait: '#999999',        // Light gray for wait actions
  item: '#aa88cc'         // Purple for item usage
};

/**
 * Get the color associated with an action type
 * @param {string} actionType - The type of action (damage, healing, buff, etc.)
 * @returns {string} The hex color code for the action type
 */
export function getActionColor(actionType) {
  return LOG_COLORS[actionType] || LOG_COLORS.damage;
}

/**
 * Format a damage result for display
 * @param {Object} result - The damage result object
 * @param {number} result.damage - Total damage dealt
 * @param {boolean} result.isCritical - Whether this was a critical hit
 * @param {number} [result.baseDamage] - Base damage before crit multiplier
 * @param {number} [result.critBonus] - Bonus damage from critical hit
 * @param {boolean} [result.missed] - Whether the attack missed
 * @param {Object} [options] - Formatting options
 * @param {boolean} [options.includeBreakdown=true] - Include crit breakdown if available
 * @param {string} [options.mutedColor='#8b7355'] - Color for muted text (crit breakdown)
 * @returns {Object} Formatted result with html and plain text
 */
export function formatDamageResult(result, options = {}) {
  const { includeBreakdown = true, mutedColor = '#8b7355' } = options;

  if (!result) {
    return { html: '', text: '', isEmpty: true };
  }

  if (result.missed) {
    return {
      html: '<span class="battle-log-entry__miss">MISS</span>',
      text: 'MISS',
      isMiss: true
    };
  }

  if (result.damage > 0) {
    const critHtml = result.isCritical
      ? '<span class="battle-log-entry__critical"> CRIT!</span>'
      : '';
    const critText = result.isCritical ? ' CRIT!' : '';

    let html = `<span class="battle-log-entry__damage" style="color: ${LOG_COLORS.damage}">-${result.damage} HP</span>${critHtml}`;
    let text = `-${result.damage} HP${critText}`;

    // Add breakdown if available and requested
    if (includeBreakdown && result.baseDamage && result.isCritical && result.critBonus) {
      html += `<div style="font-size: 9px; color: ${mutedColor};">(${result.baseDamage} base + ${result.critBonus} crit)</div>`;
      text += ` (${result.baseDamage} base + ${result.critBonus} crit)`;
    }

    return {
      html,
      text,
      isDamage: true,
      isCritical: result.isCritical
    };
  }

  if (result.healing > 0) {
    return {
      html: `<span class="battle-log-entry__healing">+${result.healing} HP</span>`,
      text: `+${result.healing} HP`,
      isHealing: true
    };
  }

  return { html: '', text: '', isEmpty: true };
}

/**
 * Format a status effect for display
 * @param {string} effect - The status effect name
 * @param {Object} [options] - Formatting options
 * @param {boolean} [options.showAppliedPrefix=true] - Include "Applied:" prefix
 * @returns {Object} Formatted result with html and plain text
 */
export function formatStatusEffect(effect, options = {}) {
  const { showAppliedPrefix = true } = options;

  if (!effect) {
    return { html: '', text: '', isEmpty: true };
  }

  const escapedEffect = escapeHtml(effect);
  const prefix = showAppliedPrefix ? 'Applied: ' : '';

  return {
    html: `<span class="battle-log-entry__status">${prefix}${escapedEffect}</span>`,
    text: `${prefix}${effect}`,
    effect,
    isDebuff: isDebuffEffect(effect)
  };
}

/**
 * Determine if a status effect is a debuff
 * @param {string} effect - The status effect name
 * @returns {boolean} True if the effect is a debuff
 */
export function isDebuffEffect(effect) {
  if (!effect) return false;
  const debuffs = ['poison', 'blind', 'slow', 'silence', 'paralyze', 'confuse', 'bleed'];
  return debuffs.includes(effect.toLowerCase());
}

/**
 * Get the entry type based on action and result for styling purposes
 * @param {Object} action - Action info { type, name }
 * @param {Object} result - Result data
 * @returns {string} Entry type for CSS class
 */
export function getEntryType(action, result) {
  const actionType = action?.type || 'unknown';

  if (actionType === 'move') return 'movement';
  if (actionType === 'wait') return 'wait';
  if (actionType === 'item') return 'item';

  if (result?.healing > 0) return 'healing';
  if (result?.damage > 0) return 'damage';
  if (result?.statusApplied) {
    return isDebuffEffect(result.statusApplied) ? 'debuff' : 'buff';
  }

  return 'damage'; // Default
}

/**
 * Escape HTML special characters
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
export function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
