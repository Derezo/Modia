/**
 * EquipmentSlotModal - Equipment slot management modal
 *
 * Shows the currently equipped item for a slot and allows equipping
 * a different item from the available inventory.
 *
 * Features:
 * - Currently equipped item display with unequip option
 * - Available items list filtered by slot and class
 * - Stat comparison vs current item
 * - Equip/Unequip API integration
 *
 * Usage:
 *   const modal = new EquipmentSlotModal({
 *     game: this.game,
 *     characterId: 123,
 *     slotKey: 'head',
 *     slotName: 'Head',
 *     currentItem: equippedItem,
 *     inventory: sharedInventory,
 *     characterClass: 'warrior',
 *     onEquipmentChanged: () => refresh()
 *   });
 *   modal.open();
 */

import { ParchmentModal } from '../../ui/parchment/ParchmentModal.js';
import { parchmentToast } from '../../ui/parchment/ParchmentToast.js';
import { ItemIcon } from '../ItemIcon.js';
import {
  PARCHMENT_COLORS,
  PARCHMENT_SPACING,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_RADIUS,
  getParchmentBorder,
  getParchmentScrollbarCSS
} from '../../ui/parchment/ParchmentTheme.js';
import {
  formatStatValue,
  calculateStatChanges,
  calculateItemPower,
  sumItemStats,
  normalizeRarity,
  matchesEquipmentSlot,
  getEquipRestriction,
  getDisplayMaterial,
  RARITY_TEXT_COLORS
} from '../../utils/statDisplay.js';
import { renderAugmentList } from '../AugmentList.js';
import { renderItemStatRows } from '../ItemStatRows.js';
import { escapeHtml, escapeHtmlAttribute } from '../../utils/escapeHtml.js';

const STYLE_ID = 'equipment-slot-modal-styles';

export class EquipmentSlotModal {
  /**
   * @param {Object} options - Modal configuration
   * @param {Object} options.game - Game instance with API
   * @param {number} options.characterId - Character ID
   * @param {string} options.slotKey - Equipment slot key (e.g., 'head')
   * @param {string} options.slotName - Display name for slot
   * @param {Object|null} options.currentItem - Currently equipped item
   * @param {Array} options.inventory - Shared inventory items
   * @param {string} options.characterClass - Character's class for filtering
   * @param {number} [options.characterLevel] - Character's level for requirements
   * @param {Function} [options.onEquipmentChanged] - Callback when equipment changes
   * @param {Function} [options.onClose] - Callback when modal closes
   */
  constructor(options = {}) {
    this.game = options.game;
    this.characterId = options.characterId;
    this.slotKey = options.slotKey;
    this.slotName = options.slotName || this.formatSlotName(options.slotKey);
    this.currentItem = options.currentItem;
    this.inventory = options.inventory || [];
    this.characterClass = options.characterClass;
    this.characterLevel = options.characterLevel || 1;
    this.onEquipmentChanged = options.onEquipmentChanged || (() => {});
    this.onClose = options.onClose || (() => {});

    this.modal = null;
    this.selectedItem = null;
    this.isProcessing = false;
    this.abortController = null;

    this.injectStyles();
  }

  /**
   * Format slot key into display name
   * @param {string} slotKey - Slot key
   * @returns {string} Formatted name
   */
  formatSlotName(slotKey) {
    if (!slotKey) return 'Equipment';
    return slotKey.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
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
      .equipment-slot-modal-content {
        display: flex;
        flex-direction: column;
        gap: ${PARCHMENT_SPACING.md};
        max-height: 70vh;
      }

      /* Comparison Section - Side by Side */
      .equipment-slot-comparison-section {
        display: flex;
        gap: ${PARCHMENT_SPACING.md};
      }

      @media (max-width: 600px) {
        .equipment-slot-comparison-section {
          flex-direction: column;
        }
      }

      /* Item Comparison Card */
      .equipment-slot-card {
        flex: 1;
        min-width: 0;
        padding: ${PARCHMENT_SPACING.md};
        background: linear-gradient(to bottom, ${PARCHMENT_COLORS.mid}, ${PARCHMENT_COLORS.dark});
        border: ${getParchmentBorder()};
        border-radius: ${PARCHMENT_RADIUS.md};
      }

      .equipment-slot-card--empty {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 150px;
        color: ${PARCHMENT_COLORS.text.muted};
        font-style: italic;
      }

      .equipment-slot-card-header {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${PARCHMENT_COLORS.text.muted};
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: ${PARCHMENT_SPACING.sm};
      }

      .equipment-slot-card-item {
        display: flex;
        gap: ${PARCHMENT_SPACING.sm};
        margin-bottom: ${PARCHMENT_SPACING.sm};
      }

      .equipment-slot-card-icon {
        width: 48px;
        height: 48px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: ${PARCHMENT_COLORS.dark};
        border-radius: ${PARCHMENT_RADIUS.sm};
        border: 2px solid ${PARCHMENT_COLORS.border};
        flex-shrink: 0;
      }

      .equipment-slot-card-icon.rarity-uncommon { border-color: #2d6b2d; }
      .equipment-slot-card-icon.rarity-rare { border-color: #0055aa; }
      .equipment-slot-card-icon.rarity-epic { border-color: #7722aa; }
      .equipment-slot-card-icon.rarity-legendary { border-color: #cc6600; }

      .equipment-slot-card-title {
        flex: 1;
        min-width: 0;
      }

      .equipment-slot-card-name {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        margin-bottom: 2px;
        word-wrap: break-word;
      }

      .equipment-slot-card-name.rarity-common { color: #5a4a3a; }
      .equipment-slot-card-name.rarity-uncommon { color: #2d6b2d; }
      .equipment-slot-card-name.rarity-rare { color: #0055aa; }
      .equipment-slot-card-name.rarity-epic { color: #7722aa; }
      .equipment-slot-card-name.rarity-legendary { color: #cc6600; }

      .equipment-slot-available-name.rarity-common { color: #5a4a3a; }
      .equipment-slot-available-name.rarity-uncommon { color: #2d6b2d; }
      .equipment-slot-available-name.rarity-rare { color: #0055aa; }
      .equipment-slot-available-name.rarity-epic { color: #7722aa; }
      .equipment-slot-available-name.rarity-legendary { color: #cc6600; }

      /* Items the character cannot use: listed with the reason, not selectable */
      .equipment-slot-available-item.ineligible {
        cursor: not-allowed;
        opacity: 0.6;
      }

      .equipment-slot-available-item.ineligible:hover {
        background: transparent;
      }

      .equipment-slot-available-item.ineligible .equipment-slot-available-radio {
        visibility: hidden;
      }

      .equipment-slot-available-reason {
        flex-shrink: 0;
        padding: 1px 6px;
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${PARCHMENT_COLORS.state.error};
        border: 1px solid ${PARCHMENT_COLORS.state.error};
        border-radius: ${PARCHMENT_RADIUS.sm};
        white-space: nowrap;
      }

      .equipment-slot-card-badges {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
      }

      .equipment-slot-card-badge {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        padding: 1px 6px;
        background: ${PARCHMENT_COLORS.light};
        border-radius: 8px;
        color: ${PARCHMENT_COLORS.text.secondary};
        text-transform: capitalize;
      }

      .equipment-slot-card-badge--rarity {
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        border: 1px solid transparent;
      }

      .equipment-slot-card-section {
        margin-top: ${PARCHMENT_SPACING.sm};
      }

      .equipment-slot-card-section-title {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${PARCHMENT_COLORS.text.muted};
        text-transform: uppercase;
        margin-bottom: 4px;
      }

      .equipment-slot-unequip-btn {
        margin-top: ${PARCHMENT_SPACING.sm};
        width: 100%;
        padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.md};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        background: ${PARCHMENT_COLORS.state.error};
        color: white;
        border: none;
        border-radius: ${PARCHMENT_RADIUS.sm};
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .equipment-slot-unequip-btn:hover:not(:disabled) {
        background: #c62828;
      }

      .equipment-slot-unequip-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* Stat Changes Summary */
      .equipment-slot-changes {
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        background: ${PARCHMENT_COLORS.light};
        border: ${getParchmentBorder()};
        border-radius: ${PARCHMENT_RADIUS.sm};
      }

      .equipment-slot-changes-title {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${PARCHMENT_COLORS.text.muted};
        text-transform: uppercase;
        margin-bottom: ${PARCHMENT_SPACING.xs};
      }

      .equipment-slot-changes-list {
        display: flex;
        flex-wrap: wrap;
        gap: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.md};
      }

      @media (max-width: 600px) {
        .equipment-slot-changes-list {
          flex-direction: column;
          gap: 2px;
        }
      }

      .equipment-slot-change {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      }

      .equipment-slot-change.stat-positive {
        color: ${PARCHMENT_COLORS.state.success};
      }

      .equipment-slot-change.stat-negative {
        color: ${PARCHMENT_COLORS.state.error};
      }

      .equipment-slot-changes-empty {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${PARCHMENT_COLORS.text.muted};
        font-style: italic;
      }

      /* Available Items Section */
      .equipment-slot-available {
        display: flex;
        flex-direction: column;
      }

      .equipment-slot-available-header {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${PARCHMENT_COLORS.text.secondary};
        margin-bottom: ${PARCHMENT_SPACING.xs};
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .equipment-slot-available-list {
        overflow-y: auto;
        border: ${getParchmentBorder()};
        border-radius: ${PARCHMENT_RADIUS.md};
        background: ${PARCHMENT_COLORS.light};
        max-height: min(40vh, 320px);
      }

      ${getParchmentScrollbarCSS('.equipment-slot-available-list')}

      .equipment-slot-available-item {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.sm};
        padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.md};
        border-bottom: 1px solid ${PARCHMENT_COLORS.border};
        cursor: pointer;
        transition: background 0.15s ease;
      }

      .equipment-slot-available-item:last-child {
        border-bottom: none;
      }

      .equipment-slot-available-item:hover {
        background: ${PARCHMENT_COLORS.mid};
      }

      .equipment-slot-available-item.selected {
        background: linear-gradient(to bottom, #e8d9a8, #d4c498);
      }

      /* Rarity indicators */
      .equipment-slot-available-item.rarity-common {
        border-left: 3px solid #9e9e9e;
      }
      .equipment-slot-available-item.rarity-uncommon {
        border-left: 3px solid #1eff00;
      }
      .equipment-slot-available-item.rarity-rare {
        border-left: 3px solid #0070dd;
      }
      .equipment-slot-available-item.rarity-epic {
        border-left: 3px solid #a335ee;
      }
      .equipment-slot-available-item.rarity-legendary {
        border-left: 3px solid #ff8000;
      }

      .equipment-slot-available-radio {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        border: 2px solid ${PARCHMENT_COLORS.border};
        background: ${PARCHMENT_COLORS.light};
        flex-shrink: 0;
      }

      .equipment-slot-available-item.selected .equipment-slot-available-radio {
        border-color: #4a7c4e;
        background: #4a7c4e;
      }

      .equipment-slot-available-icon {
        width: 24px;
        height: 24px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .equipment-slot-available-info {
        flex: 1;
        min-width: 0;
      }

      .equipment-slot-available-name {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .equipment-slot-available-stats {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        color: ${PARCHMENT_COLORS.text.muted};
      }

      .equipment-slot-available-empty {
        padding: ${PARCHMENT_SPACING.lg};
        text-align: center;
        color: ${PARCHMENT_COLORS.text.muted};
        font-style: italic;
      }

      /* Actions Section */
      .equipment-slot-actions {
        display: flex;
        justify-content: flex-end;
        gap: ${PARCHMENT_SPACING.sm};
        padding-top: ${PARCHMENT_SPACING.sm};
        border-top: 1px solid ${PARCHMENT_COLORS.border};
      }

      .equipment-slot-equip-btn {
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.lg};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        background: linear-gradient(to bottom, #4a7c4e, #3d6940);
        color: white;
        border: 1px solid #2d5030;
        border-radius: ${PARCHMENT_RADIUS.sm};
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .equipment-slot-equip-btn:hover:not(:disabled) {
        background: linear-gradient(to bottom, #5a8c5e, #4d7950);
      }

      .equipment-slot-equip-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Open the modal
   */
  open() {
    this.modal = new ParchmentModal({
      title: `${this.slotName} Slot`,
      content: '<div class="equipment-slot-modal-content">Loading...</div>',
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
    this.render();
  }

  /**
   * Render the modal content
   */
  render() {
    const contentEl = this.modal?.contentElement;
    if (!contentEl) return;

    const availableItems = this.getAvailableItems();

    // Preserve scroll positions across re-renders (selecting an item re-renders)
    const previousList = contentEl.querySelector('.equipment-slot-available-list');
    const listScrollTop = previousList ? previousList.scrollTop : 0;
    const scrollHost = this.getScrollHost(contentEl);
    const hostScrollTop = scrollHost ? scrollHost.scrollTop : 0;

    contentEl.innerHTML = `
      <div class="equipment-slot-modal-content">
        <!-- Side-by-Side Comparison -->
        <div class="equipment-slot-comparison-section">
          ${this.renderComparisonCard(this.currentItem, true)}
          ${this.renderComparisonCard(this.selectedItem, false)}
        </div>

        <!-- Stat Changes Summary -->
        ${this.renderStatChanges()}

        <!-- Available Items -->
        <div class="equipment-slot-available">
          <div class="equipment-slot-available-header">
            Available Items (${availableItems.length})
          </div>
          <div class="equipment-slot-available-list">
            ${this.renderAvailableItems(availableItems)}
          </div>
        </div>

        <!-- Actions -->
        <div class="equipment-slot-actions">
          <button class="equipment-slot-equip-btn" data-action="equip" ${this.selectedItem ? '' : 'disabled'}>
            Equip Selected
          </button>
        </div>
      </div>
    `;

    const newList = contentEl.querySelector('.equipment-slot-available-list');
    if (newList && listScrollTop) newList.scrollTop = listScrollTop;
    if (scrollHost && hostScrollTop) scrollHost.scrollTop = hostScrollTop;

    this.updateCompositedIcons(contentEl, availableItems);

    this.bindEvents();
  }

  /**
   * Find the element that scrolls the modal body (the content element itself
   * or its nearest scrollable ancestor)
   * @param {HTMLElement} contentEl - Modal content element
   * @returns {HTMLElement|null}
   */
  getScrollHost(contentEl) {
    let el = contentEl;
    while (el && el !== document.body) {
      if (el.scrollHeight > el.clientHeight) {
        const overflowY = typeof getComputedStyle === 'function' ? getComputedStyle(el).overflowY : '';
        if (overflowY === 'auto' || overflowY === 'scroll') return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  /**
   * Render a comparison card for an item
   * @param {Object|null} item - Item to display
   * @param {boolean} isCurrentlyEquipped - Whether this is the currently equipped item
   * @returns {string} HTML
   */
  renderComparisonCard(item, isCurrentlyEquipped) {
    const headerText = isCurrentlyEquipped ? 'Currently Equipped' : 'Selected Item';

    if (!item) {
      const emptyText = isCurrentlyEquipped
        ? 'No item equipped'
        : 'Select an item to compare';

      return `
        <div class="equipment-slot-card equipment-slot-card--empty">
          <div>
            <div class="equipment-slot-card-header">${headerText}</div>
            <div>${emptyText}</div>
          </div>
        </div>
      `;
    }

    const rarity = normalizeRarity(item.rarity);
    // Shared stat block and augment list: the same item reads the same here
    // as in the item detail modal, shop and marketplace panels
    const statsHtml = renderItemStatRows(item);
    const augmentsHtml = renderAugmentList(item.augments || []);

    return `
      <div class="equipment-slot-card">
        <div class="equipment-slot-card-header">${headerText}</div>

        <!-- Item Info -->
        <div class="equipment-slot-card-item">
          <div class="equipment-slot-card-icon rarity-${rarity}"
               data-comparison-item-icon="${isCurrentlyEquipped ? 'current' : 'selected'}">
            ${ItemIcon.html({ item, size: 'md' })}
          </div>
          <div class="equipment-slot-card-title">
            <div class="equipment-slot-card-name rarity-${rarity}">
              ${escapeHtml(item.name)}
            </div>
            <div class="equipment-slot-card-badges">
              <span class="equipment-slot-card-badge equipment-slot-card-badge--rarity" style="color: ${RARITY_TEXT_COLORS[rarity] || 'inherit'}; border-color: ${RARITY_TEXT_COLORS[rarity] || 'transparent'};">${rarity}</span>
              ${getDisplayMaterial(item) ? `<span class="equipment-slot-card-badge">${escapeHtml(getDisplayMaterial(item))}</span>` : ''}
              ${this.renderRequirementBadge(item)}
            </div>
          </div>
        </div>

        <!-- Stats -->
        ${statsHtml ? `
          <div class="equipment-slot-card-section">
            <div class="equipment-slot-card-section-title">Stats</div>
            ${statsHtml}
          </div>
        ` : ''}

        <!-- Augments -->
        ${augmentsHtml ? `
          <div class="equipment-slot-card-section">
            <div class="equipment-slot-card-section-title">Augments</div>
            ${augmentsHtml}
          </div>
        ` : ''}

        <!-- Unequip Button (only for currently equipped) -->
        ${isCurrentlyEquipped ? `
          <button class="equipment-slot-unequip-btn" data-action="unequip">
            Unequip
          </button>
        ` : ''}
      </div>
    `;
  }

  /**
   * Render a badge explaining why the character cannot use an item
   * @param {Object} item - Item
   * @returns {string} HTML (empty when usable)
   */
  renderRequirementBadge(item) {
    const reason = this.getIneligibilityReason(item);
    return reason
      ? `<span class="equipment-slot-available-reason">${escapeHtml(reason)}</span>`
      : '';
  }

  /**
   * Reason this character cannot equip the item (level/class), or null
   * @param {Object} item - Item
   * @returns {string|null}
   */
  getIneligibilityReason(item) {
    return getEquipRestriction(item, { level: this.characterLevel, class: this.characterClass });
  }

  /**
   * Render stat changes summary section
   * @returns {string} HTML
   */
  renderStatChanges() {
    if (!this.selectedItem) {
      return `
        <div class="equipment-slot-changes">
          <div class="equipment-slot-changes-title">Stat Changes</div>
          <div class="equipment-slot-changes-empty">Select an item to see changes</div>
        </div>
      `;
    }

    const changes = calculateStatChanges(this.currentItem, this.selectedItem);

    if (changes.length === 0) {
      return `
        <div class="equipment-slot-changes">
          <div class="equipment-slot-changes-title">Stat Changes</div>
          <div class="equipment-slot-changes-empty">No stat changes</div>
        </div>
      `;
    }

    const changesHtml = changes.map(({ stat, diff }) => {
      const className = diff > 0 ? 'stat-positive' : 'stat-negative';
      return `<span class="equipment-slot-change ${className}">${escapeHtml(formatStatValue(stat, diff, false))}</span>`;
    }).join('');

    return `
      <div class="equipment-slot-changes">
        <div class="equipment-slot-changes-title">Stat Changes</div>
        <div class="equipment-slot-changes-list">${changesHtml}</div>
      </div>
    `;
  }

  /**
   * Get items that can be equipped in this slot
   * @returns {Array} Filtered items sorted by power
   */
  getAvailableItems() {
    const slotItems = this.inventory.filter(item => matchesEquipmentSlot(item, this.slotKey));
    const byPower = (a, b) => this.calculateItemPower(b) - this.calculateItemPower(a);
    const eligible = slotItems.filter(item => !this.getIneligibilityReason(item)).sort(byPower);
    const ineligible = slotItems.filter(item => this.getIneligibilityReason(item)).sort(byPower);
    // Usable items first; items the character can't use yet follow with a reason
    return [...eligible, ...ineligible];
  }

  /**
   * Check if item can be equipped in this slot by this character
   * @param {Object} item - Item to check
   * @returns {boolean}
   */
  canEquipInSlot(item) {
    if (!item) return false;
    return matchesEquipmentSlot(item, this.slotKey) && !this.getIneligibilityReason(item);
  }

  /**
   * Render available items list
   * @param {Array} items - Available items
   * @returns {string} HTML
   */
  renderAvailableItems(items) {
    if (items.length === 0) {
      return `
        <div class="equipment-slot-available-empty">
          No items available for this slot
        </div>
      `;
    }

    return items.map((item, index) => {
      const rarity = normalizeRarity(item.rarity);
      const stats = this.getItemStatsSummary(item);
      const itemId = item.instanceId || item.id || index;
      const isSelected = this.selectedItem &&
        (this.selectedItem.instanceId || this.selectedItem.id) === (item.instanceId || item.id);
      const iconHtml = ItemIcon.html({ item, size: 'sm' });
      const reason = this.getIneligibilityReason(item);

      return `
        <div
          class="equipment-slot-available-item rarity-${rarity}${isSelected ? ' selected' : ''}${reason ? ' ineligible' : ''}"
          data-item-id="${escapeHtmlAttribute(String(itemId))}"
          data-index="${index}"
          ${reason ? `aria-disabled="true" data-ineligible="true" title="${escapeHtmlAttribute(reason)}"` : ''}
        >
          <div class="equipment-slot-available-radio"></div>
          <div class="equipment-slot-available-icon" data-available-item-icon="${index}">${iconHtml}</div>
          <div class="equipment-slot-available-info">
            <div class="equipment-slot-available-name rarity-${rarity}" title="${escapeHtmlAttribute(item.name || '')}">
              ${escapeHtml(item.name)}
            </div>
            ${stats ? `<div class="equipment-slot-available-stats">${escapeHtml(stats)}</div>` : ''}
          </div>
          ${reason ? `<span class="equipment-slot-available-reason">${escapeHtml(reason)}</span>` : ''}
        </div>
      `;
    }).join('');
  }

  /**
   * Hydrate augmented items with the same composited ItemIcon used by item
   * detail and inventory views. Base icons remain in place if compositing is
   * unnecessary or fails.
   * @param {HTMLElement} contentEl - Modal content root
   * @param {Array<Object>} availableItems - Items rendered in the list
   */
  updateCompositedIcons(contentEl, availableItems) {
    const replacements = [
      [contentEl.querySelector('[data-comparison-item-icon="current"]'), this.currentItem, 'md'],
      [contentEl.querySelector('[data-comparison-item-icon="selected"]'), this.selectedItem, 'md']
    ];

    contentEl.querySelectorAll('[data-available-item-icon]').forEach((container) => {
      replacements.push([
        container,
        availableItems[Number(container.dataset.availableItemIcon)],
        'sm'
      ]);
    });

    replacements.forEach(([container, item, size]) => {
      const augments = item?.augments || [];
      if (!container || !item || augments.length === 0) return;

      const augmentTypes = augments
        .map(augment => typeof augment === 'string'
          ? augment
          : (augment.category || augment.type || augment.name))
        .filter(Boolean);

      ItemIcon.compositeHtml({ item, size, augments: augmentTypes })
        .then((html) => {
          if (container.isConnected) container.innerHTML = html;
        })
        .catch(() => {
          // Keep the canonical non-composited icon rendered above.
        });
    });
  }

  /**
   * Get item stats summary string (abbreviated for compact display)
   * @param {Object} item - Item data
   * @returns {string} Stats summary
   */
  getItemStatsSummary(item) {
    const stats = sumItemStats(item, { includeCombat: true });
    const parts = Object.entries(stats)
      .filter(([, v]) => typeof v === 'number' && v !== 0)
      .slice(0, 3)
      .map(([k, v]) => formatStatValue(k, v, true));
    const augmentCount = (item.augments || []).length;
    if (augmentCount > 0) {
      parts.push(`${augmentCount} augment${augmentCount > 1 ? 's' : ''}`);
    }
    return parts.join(', ');
  }

  /**
   * Calculate item power for comparison (attack + defense + summed stats)
   * @param {Object} item - Item data
   * @returns {number} Power value
   */
  calculateItemPower(item) {
    return calculateItemPower(item);
  }

  /**
   * Bind event listeners
   */
  bindEvents() {
    const contentEl = this.modal?.contentElement;
    if (!contentEl) return;

    // Abort previous listeners before adding new ones (prevents memory leaks on re-render)
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    // Unequip button
    const unequipBtn = contentEl.querySelector('[data-action="unequip"]');
    if (unequipBtn) {
      unequipBtn.addEventListener('click', () => this.handleUnequip(), { signal });
    }

    // Equip button
    const equipBtn = contentEl.querySelector('[data-action="equip"]');
    if (equipBtn) {
      equipBtn.addEventListener('click', () => this.handleEquip(), { signal });
    }

    // Available item selection
    const items = contentEl.querySelectorAll('.equipment-slot-available-item');
    items.forEach(itemEl => {
      itemEl.addEventListener('click', () => {
        const index = parseInt(itemEl.dataset.index, 10);
        this.selectItem(index);
      }, { signal });
    });
  }

  /**
   * Select an available item
   * @param {number} index - Item index
   */
  selectItem(index) {
    const availableItems = this.getAvailableItems();
    const item = availableItems[index] || null;
    // Items the character cannot use are listed for information only
    if (item && this.getIneligibilityReason(item)) return;
    this.selectedItem = item;

    // Re-render the entire content to update comparison cards and stat changes
    this.render();
  }

  /**
   * Handle unequip action
   */
  async handleUnequip() {
    if (this.isProcessing || !this.currentItem) return;

    this.isProcessing = true;
    const btn = this.modal?.contentElement?.querySelector('[data-action="unequip"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Unequipping...';
    }

    try {
      await this.game.api.unequipItem(this.characterId, this.slotKey);

      parchmentToast.success(`Unequipped ${this.currentItem.name}`);
      this.onEquipmentChanged();
      this.close();

    } catch (error) {
      console.error('Failed to unequip item:', error);
      parchmentToast.error('Failed to unequip item');
    } finally {
      this.isProcessing = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Unequip';
      }
    }
  }

  /**
   * Handle equip action
   */
  async handleEquip() {
    if (this.isProcessing || !this.selectedItem) return;

    this.isProcessing = true;
    const btn = this.modal?.contentElement?.querySelector('[data-action="equip"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Equipping...';
    }

    try {
      const itemId = this.selectedItem.instanceId || this.selectedItem.id;
      await this.game.api.equipItem(this.characterId, itemId, this.slotKey);

      parchmentToast.success(`Equipped ${this.selectedItem.name}`);
      this.onEquipmentChanged();
      this.close();

    } catch (error) {
      console.error('Failed to equip item:', error);
      parchmentToast.error('Failed to equip item');
    } finally {
      this.isProcessing = false;
      if (btn) {
        btn.disabled = !this.selectedItem;
        btn.textContent = 'Equip Selected';
      }
    }
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
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.selectedItem = null;
    this.modal = null;
  }
}

export default EquipmentSlotModal;
