/**
 * PartyStatsSummary - Horizontal bar showing party composition and stats
 *
 * Displays a summary of the party including class composition, average level,
 * total power rating, and available skill points.
 *
 * Features:
 * - Class composition with icons: "2W 1M 1Mk 1C"
 * - Average party level
 * - Total party power (sum of character stats)
 * - Skill points indicator
 * - Responsive layout
 *
 * Usage:
 *   const summary = new PartyStatsSummary({
 *     characters: [...],
 *     onSkillPointsClick: () => { ... }
 *   });
 *   container.appendChild(summary.element);
 *
 * Options:
 *   @param {Array} characters - Array of character objects
 *   @param {Function} onSkillPointsClick - Click callback for skill points section
 */

import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_SPACING,
  PARCHMENT_RADIUS,
  getParchmentBorder,
  getParchmentInsetShadow
} from '../ui/parchment/ParchmentTheme.js';
import { getClassColor, getClassIcon } from './CharacterCard.js';

const STYLE_ID = 'party-stats-summary-styles';

export class PartyStatsSummary {
  /**
   * @param {Object} options - Summary configuration
   * @param {Array} options.characters - Array of character objects
   * @param {Function} [options.onSkillPointsClick] - Click callback for skill points
   */
  constructor(options = {}) {
    this.options = {
      characters: options.characters || [],
      onSkillPointsClick: options.onSkillPointsClick || null
    };

    this.element = null;
    this.abortController = new AbortController();

    this.injectStyles();
    this.createElement();
    this.setupEventListeners();
  }

  /**
   * Inject component styles (only once per page)
   */
  injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* PartyStatsSummary Base */
      .party-stats-summary {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: ${PARCHMENT_SPACING.sm};
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        background: linear-gradient(135deg, rgba(100, 80, 60, 0.08) 0%, transparent 50%),
                    linear-gradient(225deg, rgba(100, 80, 60, 0.08) 0%, transparent 50%),
                    ${PARCHMENT_COLORS.dark};
        border: ${getParchmentBorder()};
        border-radius: ${PARCHMENT_RADIUS.md};
        box-shadow: ${getParchmentInsetShadow()};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${PARCHMENT_COLORS.text.primary};
      }

      /* Stat item */
      .party-stats-summary__item {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.xs};
        padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.sm};
        background: ${PARCHMENT_COLORS.mid};
        border-radius: ${PARCHMENT_RADIUS.sm};
        border: 1px solid ${PARCHMENT_COLORS.border};
      }

      .party-stats-summary__item--clickable {
        cursor: pointer;
        transition: background 0.2s ease, transform 0.1s ease;
      }

      .party-stats-summary__item--clickable:hover {
        background: ${PARCHMENT_COLORS.light};
        transform: translateY(-1px);
      }

      .party-stats-summary__item--highlight {
        background: linear-gradient(to bottom, ${PARCHMENT_COLORS.state.warning}, #d4a700);
        color: ${PARCHMENT_COLORS.text.primary};
        border-color: #b08900;
      }

      .party-stats-summary__label {
        color: ${PARCHMENT_COLORS.text.muted};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
      }

      .party-stats-summary__value {
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${PARCHMENT_COLORS.text.primary};
      }

      /* Class composition */
      .party-stats-summary__composition {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-wrap: wrap;
      }

      .party-stats-summary__class {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 2px 6px;
        border-radius: ${PARCHMENT_RADIUS.sm};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: white;
        text-shadow: 0 1px 1px rgba(0,0,0,0.3);
      }

      .party-stats-summary__class-count {
        opacity: 0.9;
      }

      .party-stats-summary__class-icon {
        font-size: 10px;
      }

      /* Divider between sections */
      .party-stats-summary__divider {
        width: 1px;
        height: 20px;
        background: ${PARCHMENT_COLORS.border};
        margin: 0 ${PARCHMENT_SPACING.xs};
      }

      /* Responsive */
      @media (max-width: 600px) {
        .party-stats-summary {
          justify-content: center;
        }

        .party-stats-summary__divider {
          display: none;
        }
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Create the summary DOM structure
   */
  createElement() {
    const { characters } = this.options;

    this.element = document.createElement('div');
    this.element.className = 'party-stats-summary';

    const stats = this.calculateStats(characters);

    this.element.innerHTML = `
      <!-- Class Composition -->
      <div class="party-stats-summary__item">
        <span class="party-stats-summary__label">Party:</span>
        <div class="party-stats-summary__composition">
          ${this.renderClassComposition(stats.classComposition)}
        </div>
      </div>

      <span class="party-stats-summary__divider"></span>

      <!-- Average Level -->
      <div class="party-stats-summary__item">
        <span class="party-stats-summary__label">Avg Lv</span>
        <span class="party-stats-summary__value">${stats.avgLevel}</span>
      </div>

      <span class="party-stats-summary__divider"></span>

      <!-- Total Power -->
      <div class="party-stats-summary__item">
        <span class="party-stats-summary__label">Power</span>
        <span class="party-stats-summary__value">${this.formatNumber(stats.totalPower)}</span>
      </div>

      ${stats.totalSkillPoints > 0 ? `
        <span class="party-stats-summary__divider"></span>

        <!-- Skill Points -->
        <div class="party-stats-summary__item party-stats-summary__item--clickable party-stats-summary__item--highlight" data-action="skill-points">
          <span class="party-stats-summary__label">SP</span>
          <span class="party-stats-summary__value">${stats.totalSkillPoints}</span>
        </div>
      ` : ''}
    `;
  }

  /**
   * Set up event listeners
   */
  setupEventListeners() {
    if (!this.options.onSkillPointsClick) return;

    const signal = this.abortController.signal;
    const spItem = this.element.querySelector('[data-action="skill-points"]');

    if (spItem) {
      spItem.addEventListener('click', () => {
        this.options.onSkillPointsClick();
      }, { signal });
    }
  }

  /**
   * Calculate party statistics
   * @param {Array} characters - Character array
   * @returns {Object} Calculated stats
   */
  calculateStats(characters) {
    if (!characters || characters.length === 0) {
      return {
        classComposition: {},
        avgLevel: 0,
        totalPower: 0,
        totalSkillPoints: 0
      };
    }

    // Class composition
    const classComposition = {};
    characters.forEach(char => {
      if (char.class) {
        classComposition[char.class] = (classComposition[char.class] || 0) + 1;
      }
    });

    // Average level
    const totalLevel = characters.reduce((sum, char) => sum + (char.level || 1), 0);
    const avgLevel = Math.round(totalLevel / characters.length);

    // Total power (simplified: sum of key stats)
    const totalPower = characters.reduce((sum, char) => {
      const power =
        (char.strength || 0) +
        (char.intelligence || 0) +
        (char.agility || 0) +
        (char.vitality || 0) +
        (char.attack || 0) +
        (char.defense || 0);
      return sum + power;
    }, 0);

    // Total skill points (experience - spentXp, or xpPool if provided)
    const totalSkillPoints = characters.reduce((sum, char) => {
      if (char.xpPool !== undefined) {
        return sum + char.xpPool;
      }
      // Fallback: calculate from experience and spent_xp
      const available = (char.experience || 0) - (char.spent_xp || char.spentXp || 0);
      return sum + Math.max(0, available);
    }, 0);

    return {
      classComposition,
      avgLevel,
      totalPower,
      totalSkillPoints
    };
  }

  /**
   * Render class composition badges
   * @param {Object} composition - Class counts
   * @returns {string} HTML string
   */
  renderClassComposition(composition) {
    const entries = Object.entries(composition);
    if (entries.length === 0) {
      return '<span style="color: ' + PARCHMENT_COLORS.text.muted + '">No characters</span>';
    }

    return entries
      .sort((a, b) => b[1] - a[1]) // Sort by count descending
      .map(([className, count]) => {
        const color = getClassColor(className);
        const icon = getClassIcon(className);
        return `
          <span class="party-stats-summary__class" style="background: ${color};">
            <span class="party-stats-summary__class-count">${count}</span>
            <span class="party-stats-summary__class-icon">${icon}</span>
          </span>
        `;
      })
      .join('');
  }

  /**
   * Format large numbers (e.g., 1250 -> 1.2K)
   * @param {number} num - Number to format
   * @returns {string} Formatted string
   */
  formatNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return String(num);
  }

  /**
   * Update with new character data
   * @param {Array} characters - Updated character array
   */
  update(characters) {
    this.options.characters = characters;

    // Re-render
    const parent = this.element.parentNode;
    const nextSibling = this.element.nextSibling;

    // Clean up old element
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = new AbortController();
    }
    this.element.remove();

    // Create new element
    this.createElement();
    this.setupEventListeners();

    // Re-insert into DOM
    if (parent) {
      if (nextSibling) {
        parent.insertBefore(this.element, nextSibling);
      } else {
        parent.appendChild(this.element);
      }
    }
  }

  /**
   * Get calculated stats
   * @returns {Object} Current stats
   */
  getStats() {
    return this.calculateStats(this.options.characters);
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }

    this.element = null;
  }
}

export default PartyStatsSummary;
