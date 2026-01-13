/**
 * CharacterPicker - Character selection grid for consumable targeting
 *
 * A compact grid of mini character cards for selecting a target character
 * when using consumable items or targeting skills.
 *
 * Features:
 * - Grid of mini character cards
 * - Valid target filtering with visual feedback
 * - HP percentage display
 * - Keyboard navigation support
 * - Automatic selection on single valid target
 *
 * Usage:
 *   const picker = new CharacterPicker({
 *     characters: [...],
 *     onSelect: (characterId) => useItemOnCharacter(characterId),
 *     validTargets: (char) => char.currentHp < char.maxHp // Only damaged characters
 *   });
 *   container.appendChild(picker.element);
 *
 * Options:
 *   @param {Array} characters - Array of character objects
 *   @param {Function} onSelect - Selection callback (characterId)
 *   @param {Function} validTargets - Filter function (char) => boolean
 *   @param {string} emptyMessage - Message when no valid targets
 */

import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_SPACING,
  PARCHMENT_RADIUS,
  getParchmentBorder
} from '../ui/parchment/ParchmentTheme.js';
import { getClassColor, getClassIcon } from './CharacterCard.js';

const STYLE_ID = 'character-picker-styles';

export class CharacterPicker {
  /**
   * @param {Object} options - Picker configuration
   * @param {Array} options.characters - Array of character objects
   * @param {Function} options.onSelect - Selection callback (characterId)
   * @param {Function} [options.validTargets] - Filter function, default allows all
   * @param {string} [options.emptyMessage] - Message when no valid targets
   * @param {boolean} [options.autoSelectSingle] - Auto-select if only one valid target
   */
  constructor(options = {}) {
    this.options = {
      characters: options.characters || [],
      onSelect: options.onSelect || (() => {}),
      validTargets: options.validTargets || (() => true),
      emptyMessage: options.emptyMessage || 'No valid targets',
      autoSelectSingle: options.autoSelectSingle !== false
    };

    this.element = null;
    this.abortController = new AbortController();
    this.selectedIndex = -1;
    this.autoSelectTimeout = null;

    this.injectStyles();
    this.createElement();
    this.setupEventListeners();

    // Auto-select if only one valid target
    if (this.options.autoSelectSingle) {
      this.checkAutoSelect();
    }
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
      /* CharacterPicker Base */
      .character-picker {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .character-picker__label {
        display: block;
        margin-bottom: ${PARCHMENT_SPACING.sm};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${PARCHMENT_COLORS.text.secondary};
      }

      /* Grid */
      .character-picker__grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
        gap: ${PARCHMENT_SPACING.sm};
      }

      /* Mini card */
      .character-picker__card {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: ${PARCHMENT_SPACING.sm};
        background: ${PARCHMENT_COLORS.mid};
        border: ${getParchmentBorder()};
        border-radius: ${PARCHMENT_RADIUS.md};
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .character-picker__card:hover:not(.character-picker__card--disabled) {
        background: ${PARCHMENT_COLORS.light};
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
      }

      .character-picker__card--selected {
        border-color: ${PARCHMENT_COLORS.accent.burgundy};
        box-shadow: 0 0 0 2px ${PARCHMENT_COLORS.accent.burgundy};
      }

      .character-picker__card--disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      .character-picker__card:focus {
        outline: 2px solid ${PARCHMENT_COLORS.accent.burgundy};
        outline-offset: 2px;
      }

      /* Portrait */
      .character-picker__portrait {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: white;
        text-shadow: 0 1px 2px rgba(0,0,0,0.3);
        margin-bottom: ${PARCHMENT_SPACING.xs};
      }

      /* Name */
      .character-picker__name {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${PARCHMENT_COLORS.text.primary};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
        text-align: center;
      }

      /* Info line */
      .character-picker__info {
        font-size: 10px;
        color: ${PARCHMENT_COLORS.text.muted};
        margin-top: 2px;
      }

      /* HP bar */
      .character-picker__hp {
        width: 100%;
        height: 4px;
        background: ${PARCHMENT_COLORS.dark};
        border-radius: 2px;
        margin-top: ${PARCHMENT_SPACING.xs};
        overflow: hidden;
      }

      .character-picker__hp-fill {
        height: 100%;
        background: linear-gradient(to right, #4caf50, #8bc34a);
        transition: width 0.3s ease;
      }

      .character-picker__hp-fill--low {
        background: linear-gradient(to right, #ff9800, #ffb74d);
      }

      .character-picker__hp-fill--critical {
        background: linear-gradient(to right, #f44336, #e57373);
      }

      /* HP text */
      .character-picker__hp-text {
        font-size: 9px;
        color: ${PARCHMENT_COLORS.text.muted};
        margin-top: 2px;
      }

      /* Empty state */
      .character-picker__empty {
        padding: ${PARCHMENT_SPACING.lg};
        text-align: center;
        color: ${PARCHMENT_COLORS.text.muted};
        font-style: italic;
        background: ${PARCHMENT_COLORS.dark};
        border-radius: ${PARCHMENT_RADIUS.md};
      }

      /* Responsive */
      @media (max-width: 400px) {
        .character-picker__grid {
          grid-template-columns: repeat(2, 1fr);
        }
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Create the picker DOM structure
   */
  createElement() {
    const { characters, validTargets, emptyMessage } = this.options;

    this.element = document.createElement('div');
    this.element.className = 'character-picker';

    // Filter valid targets
    const validChars = characters.filter(validTargets);

    if (validChars.length === 0) {
      this.element.innerHTML = `
        <div class="character-picker__empty">${this.escapeHtml(emptyMessage)}</div>
      `;
      return;
    }

    this.element.innerHTML = `
      <span class="character-picker__label">Select a character:</span>
      <div class="character-picker__grid">
        ${characters.map((char, index) => this.renderCard(char, index, validTargets(char))).join('')}
      </div>
    `;
  }

  /**
   * Render a single character card
   * @param {Object} char - Character data
   * @param {number} index - Array index
   * @param {boolean} isValid - Whether character is a valid target
   * @returns {string} HTML string
   */
  renderCard(char, index, isValid) {
    const classColor = getClassColor(char.class);
    const classIcon = getClassIcon(char.class);
    const hpPercent = char.maxHp > 0 ? Math.round((char.currentHp / char.maxHp) * 100) : 100;
    const hpClass = hpPercent <= 25 ? 'character-picker__hp-fill--critical'
      : hpPercent <= 50 ? 'character-picker__hp-fill--low' : '';

    const disabledClass = isValid ? '' : 'character-picker__card--disabled';
    const tabIndex = isValid ? '0' : '-1';

    return `
      <div class="character-picker__card ${disabledClass}"
           data-character-id="${char.id}"
           data-index="${index}"
           tabindex="${tabIndex}"
           role="button"
           aria-label="${char.name}, Level ${char.level} ${char.class}, ${hpPercent}% HP"
           ${!isValid ? 'aria-disabled="true"' : ''}>
        <div class="character-picker__portrait" style="background: ${classColor};">
          ${classIcon}
        </div>
        <span class="character-picker__name" title="${this.escapeHtml(char.name)}">${this.escapeHtml(char.name)}</span>
        <span class="character-picker__info">Lv.${char.level} ${char.class}</span>
        <div class="character-picker__hp">
          <div class="character-picker__hp-fill ${hpClass}" style="width: ${hpPercent}%;"></div>
        </div>
        <span class="character-picker__hp-text">${char.currentHp}/${char.maxHp}</span>
      </div>
    `;
  }

  /**
   * Set up event listeners
   */
  setupEventListeners() {
    const signal = this.abortController.signal;

    // Click handling
    this.element.addEventListener('click', (e) => {
      const card = e.target.closest('.character-picker__card');
      if (!card || card.classList.contains('character-picker__card--disabled')) return;

      const charId = parseInt(card.dataset.characterId, 10);
      if (!isNaN(charId)) {
        this.select(charId);
      }
    }, { signal });

    // Keyboard navigation
    this.element.addEventListener('keydown', (e) => {
      const card = e.target.closest('.character-picker__card');
      if (!card) return;

      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!card.classList.contains('character-picker__card--disabled')) {
          const charId = parseInt(card.dataset.characterId, 10);
          if (!isNaN(charId)) {
            this.select(charId);
          }
        }
      }

      // Arrow key navigation
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        this.focusNext(card);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.focusPrevious(card);
      }
    }, { signal });
  }

  /**
   * Check if auto-select should trigger
   */
  checkAutoSelect() {
    const { characters, validTargets } = this.options;
    const validChars = characters.filter(validTargets);

    if (validChars.length === 1) {
      // Slight delay to allow UI to render
      this.autoSelectTimeout = setTimeout(() => {
        this.autoSelectTimeout = null;
        this.select(validChars[0].id);
      }, 100);
    }
  }

  /**
   * Select a character
   * @param {number} characterId - Character ID to select
   */
  select(characterId) {
    // Update visual state
    this.element.querySelectorAll('.character-picker__card').forEach(card => {
      card.classList.remove('character-picker__card--selected');
    });

    const selectedCard = this.element.querySelector(`[data-character-id="${characterId}"]`);
    if (selectedCard) {
      selectedCard.classList.add('character-picker__card--selected');
    }

    // Call callback
    this.options.onSelect(characterId);
  }

  /**
   * Focus next card
   * @param {HTMLElement} currentCard - Current focused card
   */
  focusNext(currentCard) {
    const cards = Array.from(
      this.element.querySelectorAll('.character-picker__card:not(.character-picker__card--disabled)')
    );
    const currentIndex = cards.indexOf(currentCard);
    const nextIndex = (currentIndex + 1) % cards.length;
    cards[nextIndex]?.focus();
  }

  /**
   * Focus previous card
   * @param {HTMLElement} currentCard - Current focused card
   */
  focusPrevious(currentCard) {
    const cards = Array.from(
      this.element.querySelectorAll('.character-picker__card:not(.character-picker__card--disabled)')
    );
    const currentIndex = cards.indexOf(currentCard);
    const prevIndex = (currentIndex - 1 + cards.length) % cards.length;
    cards[prevIndex]?.focus();
  }

  /**
   * Update characters and re-render
   * @param {Array} characters - New character array
   */
  update(characters) {
    this.options.characters = characters;

    // Clean up timeout from auto-select
    if (this.autoSelectTimeout) {
      clearTimeout(this.autoSelectTimeout);
      this.autoSelectTimeout = null;
    }

    // Clean up and re-create
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = new AbortController();
    }

    const parent = this.element.parentNode;
    const nextSibling = this.element.nextSibling;
    this.element.remove();

    this.createElement();
    this.setupEventListeners();

    if (parent) {
      if (nextSibling) {
        parent.insertBefore(this.element, nextSibling);
      } else {
        parent.appendChild(this.element);
      }
    }
  }

  /**
   * Get valid character count
   * @returns {number} Number of valid targets
   */
  getValidCount() {
    return this.options.characters.filter(this.options.validTargets).length;
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
    if (this.autoSelectTimeout) {
      clearTimeout(this.autoSelectTimeout);
      this.autoSelectTimeout = null;
    }

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

export default CharacterPicker;
