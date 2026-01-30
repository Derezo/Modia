/**
 * @module turnOrderUtils
 * @description Shared utilities for turn order and unit rendering.
 *
 * Key responsibilities:
 * - Unit icon loading with fallback letter abbreviations
 * - HP/CT bar color calculations and rendering helpers
 * - Class name normalization for icon lookups
 *
 * @see TurnOrderPanel.js - Collapsible turn order display
 * @see TurnOrderModal.js - Full-featured turn order modal (future)
 */

import { PARCHMENT_COLORS } from '../ui/parchment/ParchmentTheme.js';
import { iconLoader } from '../core/IconLoader.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Color constants for bars and indicators
 */
export const BAR_COLORS = {
  // HP bar colors (by health percentage)
  hp: {
    full: '#4caf50',    // Green (> 50%)
    medium: '#ff9800',  // Orange (25-50%)
    low: '#f44336',     // Red (<= 25%)
    background: '#333',
    border: '#000'
  },
  // CT bar colors
  ct: {
    fill: '#2196f3',    // Blue
    ready: '#4caf50',   // Green when full
    background: '#333',
    border: '#000'
  },
  // MP bar colors
  mp: {
    fill: '#9c27b0',    // Purple
    low: '#e91e63',     // Pink when low
    background: '#333',
    border: '#000'
  }
};

/**
 * Default bar dimensions
 */
export const BAR_DIMENSIONS = {
  width: 32,
  height: 4,
  iconSize: 24,
  fallbackSize: 24
};

/**
 * Class letter abbreviations for fallback icons
 */
export const CLASS_LETTERS = {
  warrior: 'W',
  wizard: 'M',
  monk: 'K',
  chemist: 'C',
  berserker: 'B',
  paladin: 'P',
  guardian: 'G',
  warlord: 'L',
  sorcerer: 'S',
  summoner: 'U',
  conjurer: 'J',
  oracle: 'O',
  ninja: 'N',
  martial_artist: 'A',
  brawler: 'R',
  ascetic: 'T',
  alchemist: 'A',
  medic: 'M',
  plague_doctor: 'D',
  artificer: 'F',
  monster: 'E',
  enemy: 'E'
};

// ============================================================================
// Icon Utilities
// ============================================================================

/**
 * Normalize class/enemy name to icon file name
 * @param {string} className - Class or enemy name
 * @returns {string} Normalized name (lowercase, underscores)
 */
export function normalizeIconName(className) {
  if (!className) return 'unknown';
  return className.toLowerCase().replace(/\s+/g, '_');
}

/**
 * Get single letter abbreviation for class
 * @param {string} className - Class name
 * @returns {string} Single letter
 */
export function getClassLetter(className) {
  const name = (className || '').toLowerCase();
  return CLASS_LETTERS[name] || name.charAt(0).toUpperCase() || '?';
}

/**
 * Load unit icon with caching and fallback support
 * @param {string} category - Icon category ('classes' or 'enemies')
 * @param {string} className - Class or enemy name
 * @param {number} size - Icon size in pixels
 * @param {Map} cache - Icon cache map
 * @returns {Promise<{type: 'image'|'fallback', src?: string, letter?: string}>}
 */
export async function loadUnitIcon(category, className, size, cache) {
  const iconName = normalizeIconName(className);
  const cacheKey = `${category}-${iconName}-${size}`;

  // Check cache
  if (cache && cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  // Try to load icon
  try {
    const img = await iconLoader.load(category, iconName, size);
    if (img && img.src) {
      const result = { type: 'image', src: img.src };
      if (cache) cache.set(cacheKey, result);
      return result;
    }
  } catch (e) {
    // Icon not found, use fallback
  }

  // Fallback to letter
  const result = { type: 'fallback', letter: getClassLetter(className) };
  if (cache) cache.set(cacheKey, result);
  return result;
}

/**
 * Get icon HTML for DOM-based rendering
 * @param {Object} unit - Unit data with class and type
 * @param {Map} cache - Icon cache map
 * @param {number} size - Icon size (default 24)
 * @returns {Promise<string>} HTML string for icon
 */
export async function getUnitIconHtml(unit, cache, size = BAR_DIMENSIONS.iconSize) {
  const isPlayer = unit.type === 'player';
  const category = isPlayer ? 'classes' : 'enemies';
  const iconData = await loadUnitIcon(category, unit.class, size, cache);

  if (iconData.type === 'image') {
    return `<img src="${iconData.src}" alt="">`;
  }

  return `<div class="turn-order-item__icon-fallback">${iconData.letter}</div>`;
}

/**
 * Render unit icon to canvas context
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} unit - Unit data with class, type, name
 * @param {number} x - X position (center)
 * @param {number} y - Y position (center)
 * @param {number} size - Icon size
 * @param {Map} cache - Icon cache map
 * @returns {Promise<void>}
 */
export async function renderUnitIcon(ctx, unit, x, y, size, cache) {
  const isPlayer = unit.type === 'player';
  const category = isPlayer ? 'classes' : 'enemies';
  const iconData = await loadUnitIcon(category, unit.class, size, cache);

  if (iconData.type === 'image') {
    // Load and draw image
    const img = new Image();
    img.src = iconData.src;

    // If image is already loaded, draw immediately
    if (img.complete) {
      ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
    } else {
      // Wait for load
      await new Promise((resolve) => {
        img.onload = () => {
          ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
          resolve();
        };
        img.onerror = resolve;
      });
    }
  } else {
    // Draw fallback circle with letter
    const bgColor = isPlayer ? PARCHMENT_COLORS.state.info : PARCHMENT_COLORS.state.error;

    ctx.save();

    // Circle background
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = bgColor;
    ctx.fill();

    // Letter
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(size * 0.5)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(iconData.letter, x, y);

    ctx.restore();
  }
}

// ============================================================================
// HP Bar Utilities
// ============================================================================

/**
 * Get HP bar color based on health percentage
 * @param {number} hpPercent - HP percentage (0-1)
 * @returns {string} CSS color string
 */
export function getHPBarColor(hpPercent) {
  if (hpPercent <= 0.25) return BAR_COLORS.hp.low;
  if (hpPercent <= 0.5) return BAR_COLORS.hp.medium;
  return BAR_COLORS.hp.full;
}

/**
 * Calculate HP bar data for rendering
 * @param {number} hp - Current HP
 * @param {number} maxHp - Maximum HP
 * @returns {Object} Bar data { percent, color, text }
 */
export function formatHPBar(hp, maxHp) {
  const percent = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
  return {
    percent,
    color: getHPBarColor(percent),
    text: `${Math.ceil(hp)}/${maxHp}`,
    backgroundColor: BAR_COLORS.hp.background,
    borderColor: BAR_COLORS.hp.border
  };
}

/**
 * Render HP bar to canvas context
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} hp - Current HP
 * @param {number} maxHp - Maximum HP
 * @param {number} x - X position (center)
 * @param {number} y - Y position (top)
 * @param {number} width - Bar width
 * @param {number} height - Bar height
 */
export function renderHPBar(ctx, hp, maxHp, x, y, width = BAR_DIMENSIONS.width, height = BAR_DIMENSIONS.height) {
  const barData = formatHPBar(hp, maxHp);
  const barX = x - width / 2;

  // Background
  ctx.fillStyle = barData.backgroundColor;
  ctx.fillRect(barX, y, width, height);

  // HP fill
  ctx.fillStyle = barData.color;
  ctx.fillRect(barX, y, width * barData.percent, height);

  // Border
  ctx.strokeStyle = barData.borderColor;
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, y, width, height);
}

// ============================================================================
// CT Bar Utilities
// ============================================================================

/**
 * Get CT bar color based on charge percentage
 * @param {number} ctPercent - CT percentage (0-1)
 * @returns {string} CSS color string
 */
export function getCTBarColor(ctPercent) {
  if (ctPercent >= 1) return BAR_COLORS.ct.ready;
  return BAR_COLORS.ct.fill;
}

/**
 * Calculate CT bar data for rendering
 * @param {number} ct - Current CT
 * @param {number} maxCt - Maximum CT (usually 100)
 * @returns {Object} Bar data { percent, color, text }
 */
export function formatCTBar(ct, maxCt = 100) {
  const percent = maxCt > 0 ? Math.max(0, Math.min(1, ct / maxCt)) : 0;
  return {
    percent,
    color: getCTBarColor(percent),
    text: `${Math.floor(ct)}/${maxCt}`,
    backgroundColor: BAR_COLORS.ct.background,
    borderColor: BAR_COLORS.ct.border
  };
}

/**
 * Render CT bar to canvas context
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} ct - Current CT
 * @param {number} maxCt - Maximum CT
 * @param {number} x - X position (center)
 * @param {number} y - Y position (top)
 * @param {number} width - Bar width
 * @param {number} height - Bar height
 */
export function renderCTBar(ctx, ct, maxCt, x, y, width = BAR_DIMENSIONS.width, height = BAR_DIMENSIONS.height) {
  const barData = formatCTBar(ct, maxCt);
  const barX = x - width / 2;

  // Background
  ctx.fillStyle = barData.backgroundColor;
  ctx.fillRect(barX, y, width, height);

  // CT fill
  ctx.fillStyle = barData.color;
  ctx.fillRect(barX, y, width * barData.percent, height);

  // Border
  ctx.strokeStyle = barData.borderColor;
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, y, width, height);
}

// ============================================================================
// MP Bar Utilities
// ============================================================================

/**
 * Get MP bar color based on mana percentage
 * @param {number} mpPercent - MP percentage (0-1)
 * @returns {string} CSS color string
 */
export function getMPBarColor(mpPercent) {
  if (mpPercent <= 0.2) return BAR_COLORS.mp.low;
  return BAR_COLORS.mp.fill;
}

/**
 * Calculate MP bar data for rendering
 * @param {number} mp - Current MP
 * @param {number} maxMp - Maximum MP
 * @returns {Object} Bar data { percent, color, text }
 */
export function formatMPBar(mp, maxMp) {
  const percent = maxMp > 0 ? Math.max(0, Math.min(1, mp / maxMp)) : 0;
  return {
    percent,
    color: getMPBarColor(percent),
    text: `${Math.ceil(mp)}/${maxMp}`,
    backgroundColor: BAR_COLORS.mp.background,
    borderColor: BAR_COLORS.mp.border
  };
}

/**
 * Render MP bar to canvas context
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} mp - Current MP
 * @param {number} maxMp - Maximum MP
 * @param {number} x - X position (center)
 * @param {number} y - Y position (top)
 * @param {number} width - Bar width
 * @param {number} height - Bar height
 */
export function renderMPBar(ctx, mp, maxMp, x, y, width = BAR_DIMENSIONS.width, height = BAR_DIMENSIONS.height) {
  const barData = formatMPBar(mp, maxMp);
  const barX = x - width / 2;

  // Background
  ctx.fillStyle = barData.backgroundColor;
  ctx.fillRect(barX, y, width, height);

  // MP fill
  ctx.fillStyle = barData.color;
  ctx.fillRect(barX, y, width * barData.percent, height);

  // Border
  ctx.strokeStyle = barData.borderColor;
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, y, width, height);
}
