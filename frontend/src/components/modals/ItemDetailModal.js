/**
 * ItemDetailModal - Item details and actions modal
 *
 * Displays full item information and provides actions like using consumables.
 * For consumables, shows an inline CharacterPicker for target selection.
 *
 * Features:
 * - Large item icon with rarity glow
 * - Full description and stats
 * - Augment effects display
 * - Use action for consumables with character targeting
 * - View-only for equipment items
 *
 * Usage:
 *   const modal = new ItemDetailModal({
 *     game: this.game,
 *     item: selectedItem,
 *     characters: partyCharacters,
 *     onItemUsed: () => refreshInventory()
 *   });
 *   modal.open();
 */

import { ParchmentModal } from '../../ui/parchment/ParchmentModal.js';
import { CharacterPicker } from '../CharacterPicker.js';
import { parchmentToast } from '../../ui/parchment/ParchmentToast.js';
import { Icon } from '../Icon.js';
import { ItemIcon } from '../ItemIcon.js';
import {
  PARCHMENT_COLORS,
  PARCHMENT_SPACING,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_RADIUS
} from '../../ui/parchment/ParchmentTheme.js';
import {
  formatStatName,
  formatAugmentEffect as formatAugmentEffectUtil
} from '../../utils/statDisplay.js';
import { escapeHtml } from '../../utils/escapeHtml.js';

const STYLE_ID = 'item-detail-modal-styles';

// Rarity colors
const RARITY_COLORS = {
  common: '#5a4a3a',
  uncommon: '#2d6b2d',
  rare: '#0055aa',
  epic: '#7722aa',
  legendary: '#cc6600'
};

export class ItemDetailModal {
  /**
   * @param {Object} options - Modal configuration
   * @param {Object} options.game - Game instance with API
   * @param {Object} options.item - Item to display
   * @param {Array} options.characters - Party characters for consumable targeting
   * @param {Function} [options.onItemUsed] - Callback when item is used
   * @param {Function} [options.onClose] - Callback when modal closes
   */
  constructor(options = {}) {
    this.game = options.game;
    this.item = options.item;
    this.characters = options.characters || [];
    this.onItemUsed = options.onItemUsed || (() => {});
    this.onClose = options.onClose || (() => {});

    this.modal = null;
    this.characterPicker = null;
    this.showingPicker = false;
    this.isLoading = false;

    this.injectStyles();
  }

  /**
   * Inject component styles
   */
  injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .item-detail-content {
        padding: ${PARCHMENT_SPACING.sm};
      }

      .item-detail-header {
        display: flex;
        gap: ${PARCHMENT_SPACING.md};
        margin-bottom: ${PARCHMENT_SPACING.md};
        padding-bottom: ${PARCHMENT_SPACING.md};
        border-bottom: 1px solid ${PARCHMENT_COLORS.border};
      }

      .item-detail-icon-wrapper {
        width: 64px;
        height: 64px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: ${PARCHMENT_RADIUS.md};
        background: ${PARCHMENT_COLORS.dark};
        border: 2px solid ${PARCHMENT_COLORS.border};
        flex-shrink: 0;
      }

      .item-detail-icon-wrapper.rarity-uncommon {
        border-color: ${RARITY_COLORS.uncommon};
        box-shadow: 0 0 8px rgba(45, 107, 45, 0.3);
      }

      .item-detail-icon-wrapper.rarity-rare {
        border-color: ${RARITY_COLORS.rare};
        box-shadow: 0 0 8px rgba(0, 85, 170, 0.3);
      }

      .item-detail-icon-wrapper.rarity-epic {
        border-color: ${RARITY_COLORS.epic};
        box-shadow: 0 0 12px rgba(119, 34, 170, 0.4);
      }

      .item-detail-icon-wrapper.rarity-legendary {
        border-color: ${RARITY_COLORS.legendary};
        box-shadow: 0 0 16px rgba(204, 102, 0, 0.5);
      }

      .item-detail-icon-wrapper img {
        width: 40px;
        height: 40px;
      }

      .item-detail-title-section {
        flex: 1;
        min-width: 0;
      }

      .item-detail-name {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xl};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        margin: 0 0 ${PARCHMENT_SPACING.xs};
        color: ${PARCHMENT_COLORS.text.primary};
      }

      .item-detail-name.rarity-common { color: ${RARITY_COLORS.common}; }
      .item-detail-name.rarity-uncommon { color: ${RARITY_COLORS.uncommon}; }
      .item-detail-name.rarity-rare { color: ${RARITY_COLORS.rare}; }
      .item-detail-name.rarity-epic { color: ${RARITY_COLORS.epic}; }
      .item-detail-name.rarity-legendary { color: ${RARITY_COLORS.legendary}; }

      .item-detail-badges {
        display: flex;
        gap: ${PARCHMENT_SPACING.xs};
        flex-wrap: wrap;
      }

      .item-detail-badge {
        display: inline-block;
        padding: 2px 8px;
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        border-radius: 10px;
        background: ${PARCHMENT_COLORS.mid};
        color: ${PARCHMENT_COLORS.text.secondary};
        border: 1px solid ${PARCHMENT_COLORS.border};
      }

      .item-detail-badge--type {
        text-transform: capitalize;
      }

      .item-detail-badge--rarity {
        text-transform: capitalize;
      }

      .item-detail-description {
        margin-bottom: ${PARCHMENT_SPACING.md};
        color: ${PARCHMENT_COLORS.text.secondary};
        font-style: italic;
        line-height: 1.4;
      }

      .item-detail-section {
        margin-bottom: ${PARCHMENT_SPACING.md};
      }

      .item-detail-section-title {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${PARCHMENT_COLORS.text.muted};
        text-transform: uppercase;
        margin-bottom: ${PARCHMENT_SPACING.xs};
        letter-spacing: 0.5px;
      }

      .item-detail-stats {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: ${PARCHMENT_SPACING.xs};
      }

      .item-detail-stat {
        display: flex;
        justify-content: space-between;
        padding: ${PARCHMENT_SPACING.xs};
        background: ${PARCHMENT_COLORS.dark};
        border-radius: ${PARCHMENT_RADIUS.sm};
      }

      .item-detail-stat-label {
        color: ${PARCHMENT_COLORS.text.muted};
      }

      .item-detail-stat-value {
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${PARCHMENT_COLORS.state.success};
      }

      .item-detail-augments {
        display: flex;
        flex-direction: column;
        gap: ${PARCHMENT_SPACING.xs};
      }

      .item-detail-augment {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.sm};
        padding: ${PARCHMENT_SPACING.xs};
        background: ${PARCHMENT_COLORS.dark};
        border-radius: ${PARCHMENT_RADIUS.sm};
      }

      .item-detail-augment-icon {
        width: 20px;
        height: 20px;
      }

      .item-detail-augment-text {
        flex: 1;
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${PARCHMENT_COLORS.text.primary};
      }

      .item-detail-actions {
        margin-top: ${PARCHMENT_SPACING.md};
        padding-top: ${PARCHMENT_SPACING.md};
        border-top: 1px solid ${PARCHMENT_COLORS.border};
      }

      .item-detail-action-btn {
        width: 100%;
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        border-radius: ${PARCHMENT_RADIUS.md};
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .item-detail-action-btn--primary {
        background: linear-gradient(to bottom, ${PARCHMENT_COLORS.border} 0%, ${PARCHMENT_COLORS.borderDark} 100%);
        color: ${PARCHMENT_COLORS.text.inverse};
        border: 1px solid ${PARCHMENT_COLORS.borderDark};
      }

      .item-detail-action-btn--primary:hover:not(:disabled) {
        background: linear-gradient(to bottom, ${PARCHMENT_COLORS.borderLight} 0%, ${PARCHMENT_COLORS.border} 100%);
      }

      .item-detail-action-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .item-detail-picker-section {
        margin-top: ${PARCHMENT_SPACING.md};
        padding: ${PARCHMENT_SPACING.md};
        background: ${PARCHMENT_COLORS.dark};
        border-radius: ${PARCHMENT_RADIUS.md};
        border: 1px solid ${PARCHMENT_COLORS.border};
      }

      .item-detail-picker-title {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${PARCHMENT_COLORS.text.secondary};
        margin-bottom: ${PARCHMENT_SPACING.sm};
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Open the modal
   */
  open() {
    this.modal = new ParchmentModal({
      title: 'Item Details',
      content: this.renderContent(),
      size: 'md',
      closable: true,
      closeOnOverlay: true,
      closeOnEscape: true,
      onClose: () => {
        this.cleanup();
        this.onClose();
      }
    });

    this.modal.open();
    this.setupEventListeners();

    // If item has augments, update icon with composited version
    this.updateCompositedIcon();
  }

  /**
   * Render modal content
   * @returns {string} HTML content
   */
  renderContent() {
    const item = this.item;
    const rarity = item.rarity || 'common';

    // Combine base and bonus stats
    const allStats = { ...(item.baseStats || {}), ...(item.bonusStats || {}) };
    const hasStats = Object.keys(allStats).length > 0 || item.attack || item.defense;

    // Check if consumable
    const isConsumable = item.type === 'consumable';

    return `
      <div class="item-detail-content">
        <!-- Header -->
        <div class="item-detail-header">
          <div class="item-detail-icon-wrapper rarity-${rarity}" data-icon-container>
            ${ItemIcon.html({ item, size: 'lg' })}
          </div>
          <div class="item-detail-title-section">
            <h3 class="item-detail-name rarity-${rarity}">${escapeHtml(item.name)}</h3>
            <div class="item-detail-badges">
              <span class="item-detail-badge item-detail-badge--type">${escapeHtml(item.type)}</span>
              <span class="item-detail-badge item-detail-badge--rarity">${escapeHtml(rarity)}</span>
              ${item.material ? `<span class="item-detail-badge">${escapeHtml(item.material)}</span>` : ''}
            </div>
          </div>
        </div>

        <!-- Description -->
        ${item.description ? `
          <p class="item-detail-description">${escapeHtml(item.description)}</p>
        ` : ''}

        <!-- Stats -->
        ${hasStats ? `
          <div class="item-detail-section">
            <div class="item-detail-section-title">Stats</div>
            <div class="item-detail-stats">
              ${item.attack ? `<div class="item-detail-stat"><span class="item-detail-stat-label">Attack</span><span class="item-detail-stat-value">+${item.attack}</span></div>` : ''}
              ${item.defense ? `<div class="item-detail-stat"><span class="item-detail-stat-label">Defense</span><span class="item-detail-stat-value">+${item.defense}</span></div>` : ''}
              ${this.renderStats(allStats)}
            </div>
          </div>
        ` : ''}

        <!-- Effects -->
        ${item.augments && item.augments.length > 0 ? `
          <div class="item-detail-section">
            <div class="item-detail-section-title">Effects</div>
            <div class="item-detail-augments">
              ${item.augments.map(aug => this.renderAugment(aug)).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Actions -->
        ${isConsumable ? `
          <div class="item-detail-actions">
            <button class="item-detail-action-btn item-detail-action-btn--primary" data-action="use" ${this.isLoading ? 'disabled' : ''}>
              ${this.isLoading ? 'Using...' : 'Use Item'}
            </button>
          </div>
          <div class="item-detail-picker-section" style="display: ${this.showingPicker ? 'block' : 'none'};">
            <div class="item-detail-picker-title">Select target character:</div>
            <div class="item-detail-picker-container"></div>
          </div>
        ` : ''}
      </div>
    `;
  }

  /**
   * Render stats grid items
   * @param {Object} stats - Stats object
   * @returns {string} HTML
   */
  renderStats(stats) {
    return Object.entries(stats)
      .filter(([, v]) => v && v !== 0)
      .map(([k, v]) => {
        const label = formatStatName(k, false); // Use full stat names
        const sign = v > 0 ? '+' : '';
        return `
          <div class="item-detail-stat">
            <span class="item-detail-stat-label">${label}</span>
            <span class="item-detail-stat-value">${sign}${v}</span>
          </div>
        `;
      })
      .join('');
  }

  /**
   * Render an augment
   * @param {Object} aug - Augment object
   * @returns {string} HTML
   */
  renderAugment(aug) {
    const category = aug.category || aug.type || 'holy';
    const effect = this.formatAugmentEffect(aug);

    return `
      <div class="item-detail-augment">
        <span class="item-detail-augment-icon">
          ${Icon.html('augments', category, { size: 'sm' }) || ''}
        </span>
        <span class="item-detail-augment-text">${escapeHtml(effect)}</span>
      </div>
    `;
  }

  /**
   * Format augment effect for display
   * @param {Object} aug - Augment object
   * @returns {string} Formatted effect text
   */
  formatAugmentEffect(aug) {
    // Use the centralized utility for consistent formatting
    return formatAugmentEffectUtil(aug);
  }

  /**
   * Set up event listeners
   */
  setupEventListeners() {
    const contentEl = this.modal?.contentElement;
    if (!contentEl) return;

    // Use button
    const useBtn = contentEl.querySelector('[data-action="use"]');
    if (useBtn) {
      useBtn.addEventListener('click', () => this.handleUseClick());
    }
  }

  /**
   * Update the icon with a composited version including augment overlays
   * This is called after the modal is opened to asynchronously render the composited icon
   */
  async updateCompositedIcon() {
    const item = this.item;

    // Only composite if the item has augments
    const augments = item.augments || [];
    if (augments.length === 0) {
      return; // No augments, keep the standard icon
    }

    const iconContainer = this.modal?.contentElement?.querySelector('[data-icon-container]');
    if (!iconContainer) {
      return;
    }

    try {
      // Extract augment types for compositing
      const augmentTypes = augments.map(aug => aug.category || aug.type).filter(Boolean);

      // Generate composited HTML with augment overlays
      const compositedHtml = await ItemIcon.compositeHtml({
        item,
        size: 'lg',
        augments: augmentTypes
      });

      // Update the container with the composited icon
      iconContainer.innerHTML = compositedHtml;
    } catch (error) {
      // On error, keep the existing non-composited icon
      console.warn('Failed to composite item icon:', error);
    }
  }

  /**
   * Handle use button click
   */
  handleUseClick() {
    if (this.showingPicker) {
      this.hidePicker();
    } else {
      this.showPicker();
    }
  }

  /**
   * Show character picker
   */
  showPicker() {
    this.showingPicker = true;

    const pickerSection = this.modal?.contentElement?.querySelector('.item-detail-picker-section');
    const pickerContainer = this.modal?.contentElement?.querySelector('.item-detail-picker-container');

    if (pickerSection) {
      pickerSection.style.display = 'block';
    }

    if (pickerContainer) {
      // Determine valid targets based on item effect
      const validTargets = this.getValidTargetsFilter();

      this.characterPicker = new CharacterPicker({
        characters: this.characters,
        onSelect: (characterId) => this.useItemOnCharacter(characterId),
        validTargets,
        emptyMessage: 'No valid targets for this item',
        autoSelectSingle: true
      });

      pickerContainer.innerHTML = '';
      pickerContainer.appendChild(this.characterPicker.element);
    }

    // Update button text
    const useBtn = this.modal?.contentElement?.querySelector('[data-action="use"]');
    if (useBtn) {
      useBtn.textContent = 'Cancel';
    }
  }

  /**
   * Hide character picker
   */
  hidePicker() {
    this.showingPicker = false;

    const pickerSection = this.modal?.contentElement?.querySelector('.item-detail-picker-section');
    if (pickerSection) {
      pickerSection.style.display = 'none';
    }

    if (this.characterPicker) {
      this.characterPicker.destroy();
      this.characterPicker = null;
    }

    // Update button text
    const useBtn = this.modal?.contentElement?.querySelector('[data-action="use"]');
    if (useBtn) {
      useBtn.textContent = 'Use Item';
    }
  }

  /**
   * Get valid targets filter based on item effect
   * @returns {Function} Filter function
   */
  getValidTargetsFilter() {
    const item = this.item;

    // Healing items - only damaged characters
    if (item.effect === 'heal' || item.name?.toLowerCase().includes('potion')) {
      return (char) => char.currentHp < char.maxHp;
    }

    // MP restoration - only characters with less than max MP
    if (item.effect === 'restore_mp' || item.name?.toLowerCase().includes('ether')) {
      return (char) => char.currentMp < char.maxMp;
    }

    // Default - all characters valid
    return () => true;
  }

  /**
   * Use item on selected character
   * @param {number} characterId - Target character ID
   */
  async useItemOnCharacter(characterId) {
    if (this.isLoading) return;

    this.isLoading = true;
    const useBtn = this.modal?.contentElement?.querySelector('[data-action="use"]');
    if (useBtn) {
      useBtn.disabled = true;
      useBtn.textContent = 'Using...';
    }

    try {
      const result = await this.game.api.useItem(this.item.instanceId || this.item.id, characterId);

      // Show success toast
      const character = this.characters.find(c => c.id === characterId);
      const charName = character?.name || 'character';
      const effectMsg = this.getEffectMessage(result);

      parchmentToast.success(`${effectMsg} on ${charName}`);

      // Close modal and trigger callback
      this.onItemUsed();
      this.close();

    } catch (error) {
      console.error('Failed to use item:', error);
      parchmentToast.error(error.message || 'Failed to use item');

      this.isLoading = false;
      if (useBtn) {
        useBtn.disabled = false;
        useBtn.textContent = 'Cancel';
      }
    }
  }

  /**
   * Get effect message for toast
   * @param {Object} result - API result
   * @returns {string} Effect message
   */
  getEffectMessage(result) {
    if (result.hpRestored) {
      return `Restored ${result.hpRestored} HP`;
    }
    if (result.mpRestored) {
      return `Restored ${result.mpRestored} MP`;
    }
    return `Used ${this.item.name}`;
  }

  /**
   * Close the modal
   */
  close() {
    if (this.modal) {
      this.modal.close();
    }
  }

  /**
   * Clean up resources
   */
  cleanup() {
    if (this.characterPicker) {
      this.characterPicker.destroy();
      this.characterPicker = null;
    }
    this.modal = null;
  }
}

export default ItemDetailModal;
