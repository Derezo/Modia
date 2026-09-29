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
import { ItemIcon } from '../ItemIcon.js';
import { renderAugmentList, renderAugmentLine, injectAugmentListStyles } from '../AugmentList.js';
import { renderItemStatRows } from '../ItemStatRows.js';
import {
  PARCHMENT_COLORS,
  PARCHMENT_SPACING,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_RADIUS
} from '../../ui/parchment/ParchmentTheme.js';
import {
  formatStatName,
  normalizeRarity,
  getItemRequirements,
  getDisplayMaterial,
  RARITY_TEXT_COLORS
} from '../../utils/statDisplay.js';
import { escapeHtml } from '../../utils/escapeHtml.js';

const STYLE_ID = 'item-detail-modal-styles';

// Rarity colors (shared parchment-readable palette)
const RARITY_COLORS = RARITY_TEXT_COLORS;

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
        overflow-wrap: anywhere;
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
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      }

      ${Object.entries(RARITY_COLORS).map(([key, color]) => `
      .item-detail-badge--rarity.rarity-${key} {
        color: ${color};
        border-color: ${color};
        background: color-mix(in srgb, ${color} 14%, ${PARCHMENT_COLORS.light});
      }`).join('')}

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

      .item-detail-requirements {
        display: flex;
        flex-wrap: wrap;
        gap: ${PARCHMENT_SPACING.xs};
      }

      .item-detail-requirement {
        padding: 2px 8px;
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        border-radius: ${PARCHMENT_RADIUS.sm};
        background: ${PARCHMENT_COLORS.dark};
        color: ${PARCHMENT_COLORS.text.secondary};
        border: 1px solid ${PARCHMENT_COLORS.border};
      }

      .item-detail-requirement--met {
        color: ${PARCHMENT_COLORS.state.success};
      }

      .item-detail-requirement-note {
        margin-top: ${PARCHMENT_SPACING.xs};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        font-style: italic;
        color: ${PARCHMENT_COLORS.state.error};
      }

      .item-detail-requirement--unmet {
        color: ${PARCHMENT_COLORS.state.error};
        border-color: ${PARCHMENT_COLORS.state.error};
      }

      /* Augment lines: see components/AugmentList.js */

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
    const rarity = normalizeRarity(item.rarity);

    // Shared stat + consumable effect rows (same block as the shop, equip
    // modal and marketplace panels); empty for an item with neither
    const statsHtml = renderItemStatRows(item);
    const augmentsHtml = renderAugmentList(item.augments || []);
    const requirementsHtml = this.renderRequirements();

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
              <span class="item-detail-badge item-detail-badge--type">${escapeHtml(item.type || '')}</span>
              <span class="item-detail-badge item-detail-badge--rarity rarity-${rarity}">${escapeHtml(rarity)}</span>
              ${getDisplayMaterial(item) ? `<span class="item-detail-badge item-detail-badge--type">${escapeHtml(getDisplayMaterial(item))}</span>` : ''}
            </div>
          </div>
        </div>

        <!-- Description -->
        ${item.description ? `
          <p class="item-detail-description">${escapeHtml(item.description)}</p>
        ` : ''}

        <!-- Requirements -->
        ${requirementsHtml}

        <!-- Stats -->
        ${statsHtml ? `
          <div class="item-detail-section">
            <div class="item-detail-section-title">Stats</div>
            ${statsHtml}
          </div>
        ` : ''}

        <!-- Augments -->
        ${augmentsHtml ? `
          <div class="item-detail-section">
            <div class="item-detail-section-title">Augments</div>
            ${augmentsHtml}
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
   * Render level / class requirements, coloured by whether any party member meets them
   * @returns {string} HTML
   */
  renderRequirements() {
    const { level, classes } = getItemRequirements(this.item);
    if (level <= 0 && classes.length === 0) return '';

    const characters = Array.isArray(this.characters) ? this.characters : [];
    const stateClass = (met) => {
      if (characters.length === 0) return '';
      return met ? ' item-detail-requirement--met' : ' item-detail-requirement--unmet';
    };

    const chips = [];
    const unmetNotes = [];
    if (level > 0) {
      const met = characters.some(c => Number(c.level || 0) >= level);
      chips.push(`<span class="item-detail-requirement${stateClass(met)}" title="${met ? 'A party member meets this level' : 'No party member is high enough level'}">Level ${level}+</span>`);
      if (!met && characters.length > 0) unmetNotes.push(`reach level ${level}`);
    }
    if (classes.length > 0) {
      const lower = classes.map(c => String(c).toLowerCase());
      const met = characters.some(c => lower.includes(String(c.class || c.className || '').toLowerCase()));
      const label = classes.map(c => formatStatName(String(c))).join(', ');
      chips.push(`<span class="item-detail-requirement${stateClass(met)}" title="${met ? 'A party member can use this' : 'No party member has this class'}">${escapeHtml(label)} only</span>`);
      if (!met && characters.length > 0) unmetNotes.push(`be a ${label}`);
    }

    // Colour alone did not say the item is unusable; spell it out.
    const note = unmetNotes.length > 0
      ? `<div class="item-detail-requirement-note">No one in your party can equip this yet: a character must ${escapeHtml(unmetNotes.join(' and '))}.</div>`
      : '';

    return `
      <div class="item-detail-section">
        <div class="item-detail-section-title">Requirements</div>
        <div class="item-detail-requirements">${chips.join('')}</div>
        ${note}
      </div>
    `;
  }

  /**
   * Render one augment line (the shared AugmentList line; renderContent lists
   * all of them with renderAugmentList)
   * @param {Object} aug - Augment object
   * @returns {string} HTML
   */
  renderAugment(aug) {
    injectAugmentListStyles();
    return renderAugmentLine(aug);
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
    const effectType = item.effectType || item.effect_type || item.effect || null;
    const name = item.name?.toLowerCase() || '';

    // Characters arrive either as raw /api/characters rows (hp_current/hp_max)
    // or already camelCased; read whichever is present.
    const hp = (c) => ({ cur: Number(c.currentHp ?? c.hp_current ?? 0), max: Number(c.maxHp ?? c.hp_max ?? 0) });
    const mp = (c) => ({ cur: Number(c.currentMp ?? c.mp_current ?? 0), max: Number(c.maxMp ?? c.mp_max ?? 0) });
    const alive = (c) => hp(c).cur > 0;
    const hurtHp = (c) => { const h = hp(c); return h.cur < h.max; };
    const lowMp = (c) => { const m = mp(c); return m.cur < m.max; };

    if (effectType === 'revive') {
      return (char) => !alive(char);
    }
    if (effectType === 'heal_both') {
      return (char) => alive(char) && (hurtHp(char) || lowMp(char));
    }
    if (effectType === 'heal_mp' || effectType === 'restore_mp' ||
        (!effectType && (name.includes('ether') || name.includes('mana')))) {
      return (char) => alive(char) && lowMp(char);
    }
    if (effectType === 'heal_hp' || effectType === 'heal' ||
        (!effectType && name.includes('potion'))) {
      return (char) => alive(char) && hurtHp(char);
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
    const effects = result?.effects || {};
    const hpRestored = result?.hpRestored ?? effects.hp_restored;
    const mpRestored = result?.mpRestored ?? effects.mp_restored;
    if (effects.revived) {
      return `Revived with ${hpRestored} HP`;
    }
    if (hpRestored && mpRestored) {
      return `Restored ${hpRestored} HP and ${mpRestored} MP`;
    }
    if (hpRestored) {
      return `Restored ${hpRestored} HP`;
    }
    if (mpRestored) {
      return `Restored ${mpRestored} MP`;
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
