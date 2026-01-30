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
import { Icon } from '../Icon.js';
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
  formatStatName,
  formatStatValue,
  formatAugmentEffect,
  calculateStatChanges
} from '../../utils/statDisplay.js';

const STYLE_ID = 'equipment-slot-modal-styles';

// Slot to equipment type mapping
const SLOT_TYPE_MAP = {
  head: ['armor'],
  body: ['armor'],
  legs: ['armor'],
  feet: ['armor'],
  main_hand: ['weapon'],
  off_hand: ['weapon', 'shield'],
  accessory: ['accessory']
};

// Slot to valid sub-slots (if equipment has slot property)
const SLOT_SUBSLOT_MAP = {
  head: ['head'],
  body: ['body', 'chest'],
  legs: ['legs'],
  feet: ['feet'],
  main_hand: ['main_hand', 'weapon', 'one_hand', 'two_hand'],
  off_hand: ['off_hand', 'shield', 'one_hand'],
  accessory: ['accessory', 'ring', 'amulet', 'trinket']
};

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

      .equipment-slot-card-stats {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .equipment-slot-card-stat {
        display: flex;
        justify-content: space-between;
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        padding: 2px ${PARCHMENT_SPACING.xs};
        background: ${PARCHMENT_COLORS.dark};
        border-radius: 3px;
      }

      .equipment-slot-card-stat-label {
        color: ${PARCHMENT_COLORS.text.secondary};
      }

      .equipment-slot-card-stat-value {
        color: ${PARCHMENT_COLORS.state.success};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      }

      .equipment-slot-card-effects {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .equipment-slot-card-effect {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.xs};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        padding: 2px ${PARCHMENT_SPACING.xs};
        background: ${PARCHMENT_COLORS.dark};
        border-radius: 3px;
      }

      .equipment-slot-card-effect-icon {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
      }

      .equipment-slot-card-effect-text {
        color: ${PARCHMENT_COLORS.text.primary};
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
        max-height: 180px;
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

    this.bindEvents();
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

    const rarity = item.rarity || 'common';
    const allStats = this.getAllItemStats(item);
    const hasStats = Object.keys(allStats).length > 0;
    const augments = item.augments || [];

    return `
      <div class="equipment-slot-card">
        <div class="equipment-slot-card-header">${headerText}</div>

        <!-- Item Info -->
        <div class="equipment-slot-card-item">
          <div class="equipment-slot-card-icon rarity-${rarity}">
            ${ItemIcon.html({ item, size: 'md' })}
          </div>
          <div class="equipment-slot-card-title">
            <div class="equipment-slot-card-name rarity-${rarity}">
              ${this.escapeHtml(item.name)}
            </div>
            <div class="equipment-slot-card-badges">
              <span class="equipment-slot-card-badge">${rarity}</span>
              ${item.material ? `<span class="equipment-slot-card-badge">${item.material}</span>` : ''}
            </div>
          </div>
        </div>

        <!-- Stats -->
        ${hasStats ? `
          <div class="equipment-slot-card-section">
            <div class="equipment-slot-card-section-title">Stats</div>
            <div class="equipment-slot-card-stats">
              ${this.renderCardStats(allStats)}
            </div>
          </div>
        ` : ''}

        <!-- Effects (Augments) -->
        ${augments.length > 0 ? `
          <div class="equipment-slot-card-section">
            <div class="equipment-slot-card-section-title">Effects</div>
            <div class="equipment-slot-card-effects">
              ${augments.map(aug => this.renderCardAugment(aug)).join('')}
            </div>
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
   * Render stats for a comparison card
   * @param {Object} stats - Stats object
   * @returns {string} HTML
   */
  renderCardStats(stats) {
    return Object.entries(stats)
      .filter(([, v]) => v && v !== 0)
      .map(([k, v]) => {
        const label = formatStatName(k, false);
        const sign = v > 0 ? '+' : '';
        return `
          <div class="equipment-slot-card-stat">
            <span class="equipment-slot-card-stat-label">${label}</span>
            <span class="equipment-slot-card-stat-value">${sign}${v}</span>
          </div>
        `;
      })
      .join('');
  }

  /**
   * Render an augment effect for a comparison card
   * @param {Object} aug - Augment object
   * @returns {string} HTML
   */
  renderCardAugment(aug) {
    const category = aug.category || aug.type || 'holy';
    const effectText = formatAugmentEffect(aug);

    return `
      <div class="equipment-slot-card-effect">
        <span class="equipment-slot-card-effect-icon">
          ${Icon.html('augments', category, { size: 'sm' }) || ''}
        </span>
        <span class="equipment-slot-card-effect-text">${this.escapeHtml(effectText)}</span>
      </div>
    `;
  }

  /**
   * Get all stats from an item (attack, defense, baseStats, bonusStats combined)
   * @param {Object} item - Item data
   * @returns {Object} Combined stats
   */
  getAllItemStats(item) {
    if (!item) return {};

    const stats = {};
    if (item.attack) stats.attack = item.attack;
    if (item.defense) stats.defense = item.defense;

    const baseStats = item.baseStats || {};
    const bonusStats = item.bonusStats || {};

    Object.entries(baseStats).forEach(([k, v]) => {
      if (v) stats[k] = (stats[k] || 0) + v;
    });
    Object.entries(bonusStats).forEach(([k, v]) => {
      if (v) stats[k] = (stats[k] || 0) + v;
    });

    return stats;
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
      const statName = formatStatName(stat, false);
      const sign = diff > 0 ? '+' : '';
      const className = diff > 0 ? 'stat-positive' : 'stat-negative';
      return `<span class="equipment-slot-change ${className}">${statName} ${sign}${diff}</span>`;
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
    return this.inventory
      .filter(item => this.canEquipInSlot(item))
      .sort((a, b) => this.calculateItemPower(b) - this.calculateItemPower(a));
  }

  /**
   * Check if item can be equipped in this slot
   * @param {Object} item - Item to check
   * @returns {boolean}
   */
  canEquipInSlot(item) {
    if (!item) return false;

    // Check level requirement
    const levelReq = item.level_requirement || item.levelRequirement || 0;
    if (levelReq > 0 && this.characterLevel < levelReq) {
      return false;
    }

    // Check type matches slot
    const validTypes = SLOT_TYPE_MAP[this.slotKey] || [];
    const itemType = (item.type || '').toLowerCase();

    if (!validTypes.includes(itemType)) {
      return false;
    }

    // Check sub-slot if item specifies one
    if (item.slot) {
      const validSubslots = SLOT_SUBSLOT_MAP[this.slotKey] || [];
      const itemSlot = item.slot.toLowerCase();
      if (!validSubslots.includes(itemSlot)) {
        return false;
      }
    }

    // Check class restrictions (handle both API naming conventions)
    const classRestrictions = item.classRestrictions || item.class_restriction || item.classRestriction || [];
    if (classRestrictions.length > 0) {
      const charClass = (this.characterClass || '').toLowerCase();
      const allowed = classRestrictions.some(c => c.toLowerCase() === charClass);
      if (!allowed) return false;
    }

    return true;
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
      const rarity = item.rarity || 'common';
      const stats = this.getItemStatsSummary(item);
      const itemId = item.instanceId || item.id || index;
      const isSelected = this.selectedItem &&
        (this.selectedItem.instanceId || this.selectedItem.id) === (item.instanceId || item.id);
      const iconHtml = ItemIcon.html({ item, size: 'sm' });

      return `
        <div
          class="equipment-slot-available-item rarity-${rarity}${isSelected ? ' selected' : ''}"
          data-item-id="${itemId}"
          data-index="${index}"
        >
          <div class="equipment-slot-available-radio"></div>
          <div class="equipment-slot-available-icon">${iconHtml}</div>
          <div class="equipment-slot-available-info">
            <div class="equipment-slot-available-name">
              ${this.escapeHtml(item.name)}
            </div>
            ${stats ? `<div class="equipment-slot-available-stats">${stats}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  /**
   * Get item stats summary string (abbreviated for compact display)
   * @param {Object} item - Item data
   * @returns {string} Stats summary
   */
  getItemStatsSummary(item) {
    const parts = [];
    if (item.attack) parts.push(formatStatValue('attack', item.attack, true));
    if (item.defense) parts.push(formatStatValue('defense', item.defense, true));

    const stats = { ...(item.baseStats || {}), ...(item.bonusStats || {}) };
    Object.entries(stats).slice(0, 2).forEach(([k, v]) => {
      if (v) {
        parts.push(formatStatValue(k, v, true));
      }
    });

    return parts.slice(0, 3).join(', ');
  }

  /**
   * Calculate item power for comparison
   * @param {Object} item - Item data
   * @returns {number} Power value
   */
  calculateItemPower(item) {
    if (!item) return 0;

    let power = (item.attack || 0) + (item.defense || 0);
    const stats = { ...(item.baseStats || {}), ...(item.bonusStats || {}) };
    Object.values(stats).forEach(v => { power += v || 0; });
    return power;
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
    this.selectedItem = availableItems[index] || null;

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
   * Escape HTML
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
