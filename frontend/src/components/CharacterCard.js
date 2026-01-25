/**
 * CharacterCard - Parchment-styled character card for party grid display
 *
 * A compact card component showing character info with visual indicators
 * for available actions (equipment upgrades, skill points).
 *
 * Features:
 * - Portrait area with class-colored background
 * - Name, level badge, and class name
 * - Condensed HP bar
 * - Badge indicators for actionable items
 * - Responsive sizing (160px desktop, 140px tablet, full-width mobile)
 * - Hover and selected states
 *
 * Usage:
 *   const card = new CharacterCard({
 *     character: { id: 1, name: 'Aldric', level: 5, class: 'warrior', ... },
 *     badges: { hasEquipmentUpgrade: true, hasSkillPoints: false },
 *     onClick: (characterId) => openCharacterModal(characterId),
 *     selected: false
 *   });
 *   container.appendChild(card.element);
 *
 * Options:
 *   @param {Object} character - Character data object
 *   @param {Object} badges - Badge visibility flags
 *   @param {Function} onClick - Click callback (receives characterId)
 *   @param {boolean} selected - Whether card is in selected state
 */

import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_SPACING,
  PARCHMENT_RADIUS,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentShadow,
  getParchmentTextShadow
} from '../ui/parchment/ParchmentTheme.js';
import { getAssetUrl, getOptimalSize } from '@shared/assetPaths.js';

const STYLE_ID = 'character-card-styles';

// Class color mappings
const CLASS_COLORS = {
  warrior: '#c62828',
  wizard: '#1565c0',
  monk: '#f9a825',
  chemist: '#2e7d32',
  berserker: '#b71c1c',
  sorcerer: '#0d47a1',
  ninja: '#4a148c',
  alchemist: '#1b5e20'
};

// Class icon mappings (short letter codes)
const CLASS_ICONS = {
  warrior: 'W',
  wizard: 'M',
  monk: 'K',
  chemist: 'C',
  berserker: 'B',
  sorcerer: 'S',
  ninja: 'N',
  alchemist: 'A'
};

export class CharacterCard {
  /**
   * @param {Object} options - Card configuration
   * @param {Object} options.character - Character data
   * @param {number} options.character.id - Character ID
   * @param {string} options.character.name - Character name
   * @param {number} options.character.level - Character level
   * @param {string} options.character.class - Character class
   * @param {number} options.character.currentHp - Current HP
   * @param {number} options.character.maxHp - Max HP
   * @param {number} [options.character.currentMp] - Current MP
   * @param {number} [options.character.maxMp] - Max MP
   * @param {Object} [options.badges] - Badge visibility flags
   * @param {boolean} [options.badges.hasEquipmentUpgrade] - Show red equipment badge
   * @param {boolean} [options.badges.hasSkillPoints] - Show yellow skill badge
   * @param {Function} [options.onClick] - Click callback (characterId)
   * @param {boolean} [options.selected] - Selected state
   */
  constructor(options = {}) {
    this.options = {
      character: options.character || {},
      badges: options.badges || {},
      onClick: options.onClick || null,
      selected: options.selected || false
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
      /* CharacterCard Base */
      .character-card {
        position: relative;
        width: 160px;
        background: ${getParchmentGradient()};
        border: ${getParchmentBorder()};
        border-radius: ${PARCHMENT_RADIUS.md};
        box-shadow: ${getParchmentShadow(false)};
        cursor: pointer;
        transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
        overflow: hidden;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .character-card:hover {
        transform: translateY(-2px);
        box-shadow: ${getParchmentShadow(true)};
      }

      .character-card:active {
        transform: translateY(0);
      }

      .character-card--selected {
        border-color: ${PARCHMENT_COLORS.accent.burgundy};
        box-shadow: ${getParchmentShadow(true)}, 0 0 0 2px ${PARCHMENT_COLORS.accent.burgundy};
      }

      /* Portrait area */
      .character-card__portrait {
        position: relative;
        height: 80px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-bottom: 1px solid ${PARCHMENT_COLORS.border};
      }

      .character-card__portrait-bg {
        position: absolute;
        inset: 0;
        opacity: 0.15;
      }

      .character-card__class-icon {
        position: relative;
        width: 48px;
        height: 48px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 24px;
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: white;
        text-shadow: 0 1px 2px rgba(0,0,0,0.3);
        border: 2px solid rgba(255,255,255,0.3);
        overflow: hidden;
      }

      .character-card__portrait-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .character-card__portrait-fallback {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
      }

      /* Level badge */
      .character-card__level {
        position: absolute;
        bottom: 4px;
        right: 4px;
        padding: 2px 6px;
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${PARCHMENT_COLORS.text.inverse};
        background: rgba(0,0,0,0.6);
        border-radius: 8px;
      }

      /* Info section */
      .character-card__info {
        padding: ${PARCHMENT_SPACING.sm};
      }

      .character-card__name {
        margin: 0 0 2px;
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${PARCHMENT_COLORS.text.primary};
        text-shadow: ${getParchmentTextShadow()};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .character-card__class {
        margin: 0 0 ${PARCHMENT_SPACING.xs};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        color: ${PARCHMENT_COLORS.text.secondary};
        text-transform: capitalize;
      }

      /* HP Bar */
      .character-card__hp-bar {
        height: 6px;
        background: ${PARCHMENT_COLORS.dark};
        border-radius: 3px;
        overflow: hidden;
        border: 1px solid ${PARCHMENT_COLORS.border};
      }

      .character-card__hp-fill {
        height: 100%;
        background: linear-gradient(to bottom, #4caf50, #388e3c);
        transition: width 0.3s ease;
      }

      .character-card__hp-fill--low {
        background: linear-gradient(to bottom, #ff9800, #f57c00);
      }

      .character-card__hp-fill--critical {
        background: linear-gradient(to bottom, #f44336, #d32f2f);
      }

      /* Badge indicators */
      .character-card__badge {
        position: absolute;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        border: 2px solid ${PARCHMENT_COLORS.light};
        box-shadow: 0 1px 3px rgba(0,0,0,0.3);
      }

      .character-card__badge--equipment {
        top: 4px;
        right: 4px;
        background: #e53935;
      }

      .character-card__badge--skills {
        top: 4px;
        left: 4px;
        background: #ffc107;
      }

      /* Responsive sizing */
      @media (max-width: 768px) {
        .character-card {
          width: 140px;
        }

        .character-card__portrait {
          height: 70px;
        }

        .character-card__class-icon {
          width: 40px;
          height: 40px;
          font-size: 20px;
        }
      }

      @media (max-width: 480px) {
        .character-card {
          width: 100%;
        }

        .character-card__portrait {
          height: 60px;
        }
      }

      /* Empty slot style */
      .character-card--empty {
        opacity: 0.5;
        cursor: default;
      }

      .character-card--empty:hover {
        transform: none;
        box-shadow: ${getParchmentShadow(false)};
      }

      .character-card__empty-text {
        padding: ${PARCHMENT_SPACING.lg};
        text-align: center;
        color: ${PARCHMENT_COLORS.text.muted};
        font-style: italic;
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Create the card DOM structure
   */
  createElement() {
    const { character, badges, selected } = this.options;

    this.element = document.createElement('div');
    this.element.className = 'character-card';
    this.element.dataset.characterId = character.id || '';

    if (selected) {
      this.element.classList.add('character-card--selected');
    }

    // Handle empty character slot
    if (!character.id) {
      this.element.classList.add('character-card--empty');
      this.element.innerHTML = '<div class="character-card__empty-text">Empty Slot</div>';
      return;
    }

    const classColor = this.getClassColor(character.class);
    const classIcon = this.getClassIcon(character.class);
    // Use snake_case properties from API, fallback to camelCase for compatibility
    const maxHp = character.hp_max || character.maxHp || 0;
    const currentHp = character.hp_current || character.currentHp || maxHp;
    const hpPercent = maxHp > 0 ? (currentHp / maxHp) * 100 : 100;
    const hpClass = hpPercent <= 25 ? 'character-card__hp-fill--critical'
      : hpPercent <= 50 ? 'character-card__hp-fill--low' : '';

    const portraitUrl = this.getPortraitUrl(character);

    this.element.innerHTML = `
      ${badges.hasEquipmentUpgrade ? '<span class="character-card__badge character-card__badge--equipment" title="Equipment upgrade available"></span>' : ''}
      ${badges.hasSkillPoints ? '<span class="character-card__badge character-card__badge--skills" title="Skill points available"></span>' : ''}

      <div class="character-card__portrait">
        <div class="character-card__portrait-bg" style="background: ${classColor};"></div>
        <div class="character-card__class-icon" style="background: ${classColor};">
          ${portraitUrl
    ? `<img class="character-card__portrait-img" src="${portraitUrl}" alt="${this.escapeHtml(character.name)}"
               onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
             <span class="character-card__portrait-fallback" style="display: none;">${classIcon}</span>`
    : `<span class="character-card__portrait-fallback">${classIcon}</span>`}
        </div>
        <span class="character-card__level">Lv.${character.level}</span>
      </div>

      <div class="character-card__info">
        <h4 class="character-card__name" title="${this.escapeHtml(character.name)}">${this.escapeHtml(character.name)}</h4>
        <p class="character-card__class">${this.escapeHtml(character.class)}</p>
        <div class="character-card__hp-bar">
          <div class="character-card__hp-fill ${hpClass}" style="width: ${hpPercent}%;"></div>
        </div>
      </div>
    `;
  }

  /**
   * Set up event listeners
   */
  setupEventListeners() {
    if (!this.options.onClick || !this.options.character.id) return;

    const signal = this.abortController.signal;

    this.element.addEventListener('click', () => {
      this.options.onClick(this.options.character.id);
    }, { signal });

    // Keyboard support
    this.element.setAttribute('role', 'button');
    this.element.setAttribute('tabindex', '0');
    this.element.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.options.onClick(this.options.character.id);
      }
    }, { signal });
  }

  /**
   * Update the selected state
   * @param {boolean} selected - New selected state
   */
  setSelected(selected) {
    this.options.selected = selected;
    if (selected) {
      this.element.classList.add('character-card--selected');
    } else {
      this.element.classList.remove('character-card--selected');
    }
  }

  /**
   * Update badges
   * @param {Object} badges - New badge flags
   */
  setBadges(badges) {
    this.options.badges = { ...this.options.badges, ...badges };

    // Remove existing badges
    this.element.querySelectorAll('.character-card__badge').forEach(el => el.remove());

    // Add new badges
    if (badges.hasEquipmentUpgrade) {
      const badge = document.createElement('span');
      badge.className = 'character-card__badge character-card__badge--equipment';
      badge.title = 'Equipment upgrade available';
      this.element.appendChild(badge);
    }

    if (badges.hasSkillPoints) {
      const badge = document.createElement('span');
      badge.className = 'character-card__badge character-card__badge--skills';
      badge.title = 'Skill points available';
      this.element.appendChild(badge);
    }
  }

  /**
   * Update character data and re-render
   * @param {Object} character - Updated character data
   */
  updateCharacter(character) {
    this.options.character = { ...this.options.character, ...character };

    // Update HP bar - use snake_case with camelCase fallback
    const hpFill = this.element.querySelector('.character-card__hp-fill');
    const maxHp = character.hp_max || character.maxHp || 0;
    const currentHp = character.hp_current || character.currentHp || maxHp;
    if (hpFill && maxHp > 0) {
      const hpPercent = (currentHp / maxHp) * 100;
      hpFill.style.width = `${hpPercent}%`;
      hpFill.className = 'character-card__hp-fill';
      if (hpPercent <= 25) {
        hpFill.classList.add('character-card__hp-fill--critical');
      } else if (hpPercent <= 50) {
        hpFill.classList.add('character-card__hp-fill--low');
      }
    }

    // Update level if changed
    if (character.level !== undefined) {
      const levelEl = this.element.querySelector('.character-card__level');
      if (levelEl) {
        levelEl.textContent = `Lv.${character.level}`;
      }
    }

    // Update name if changed
    if (character.name !== undefined) {
      const nameEl = this.element.querySelector('.character-card__name');
      if (nameEl) {
        nameEl.textContent = character.name;
        nameEl.title = character.name;
      }
    }
  }

  /**
   * Get class color
   * @param {string} className - Character class
   * @returns {string} CSS color
   */
  getClassColor(className) {
    return CLASS_COLORS[className] || '#666';
  }

  /**
   * Get class icon
   * @param {string} className - Character class
   * @returns {string} Icon letter
   */
  getClassIcon(className) {
    return CLASS_ICONS[className] || '?';
  }

  /**
   * Get portrait URL for character
   * @param {Object} character - Character data
   * @returns {string|null} Portrait URL or null if no race/gender
   */
  getPortraitUrl(character) {
    const race = character.race?.toLowerCase();
    const charClass = character.class?.toLowerCase();
    // Handle gender with fallback (API may use snake_case or camelCase)
    let gender = character.gender || 'male';
    gender = gender.toLowerCase();

    if (!race || !charClass) return null;

    // Use shared module for consistent path construction
    // Display size is 48px, so use optimal size (64px)
    const id = `${race}_${gender}_${charClass}`;
    const optimalSize = getOptimalSize('portraits', 48);
    return getAssetUrl('portraits', id, { size: optimalSize });
  }

  /**
   * Get the character ID
   * @returns {number|null}
   */
  getCharacterId() {
    return this.options.character.id || null;
  }

  /**
   * Escape HTML to prevent XSS
   * @param {string} str - String to escape
   * @returns {string}
   */
  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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

/**
 * Get class color (static utility)
 * @param {string} className - Character class
 * @returns {string} CSS color
 */
export function getClassColor(className) {
  return CLASS_COLORS[className] || '#666';
}

/**
 * Get class icon (static utility)
 * @param {string} className - Character class
 * @returns {string} Icon letter
 */
export function getClassIcon(className) {
  return CLASS_ICONS[className] || '?';
}

export default CharacterCard;
