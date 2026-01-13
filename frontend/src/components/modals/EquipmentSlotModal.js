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
import {
  PARCHMENT_COLORS,
  PARCHMENT_SPACING,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_RADIUS,
  getParchmentBorder,
  getParchmentScrollbarCSS
} from '../../ui/parchment/ParchmentTheme.js';

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
    this.onEquipmentChanged = options.onEquipmentChanged || (() => {});
    this.onClose = options.onClose || (() => {});

    this.modal = null;
    this.selectedItem = null;
    this.isProcessing = false;

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
        max-height: 500px;
      }

      /* Currently Equipped Section */
      .equipment-slot-current {
        padding: ${PARCHMENT_SPACING.md};
        background: linear-gradient(to bottom, ${PARCHMENT_COLORS.mid}, ${PARCHMENT_COLORS.dark});
        border: ${getParchmentBorder()};
        border-radius: ${PARCHMENT_RADIUS.md};
      }

      .equipment-slot-current-header {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${PARCHMENT_COLORS.text.secondary};
        margin-bottom: ${PARCHMENT_SPACING.sm};
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .equipment-slot-current-item {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.md};
      }

      .equipment-slot-item-info {
        flex: 1;
        min-width: 0;
      }

      .equipment-slot-item-name {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.md};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        margin-bottom: 2px;
      }

      .equipment-slot-item-name.rarity-common { color: #5a4a3a; }
      .equipment-slot-item-name.rarity-uncommon { color: #2d6b2d; }
      .equipment-slot-item-name.rarity-rare { color: #0055aa; }
      .equipment-slot-item-name.rarity-epic { color: #7722aa; }
      .equipment-slot-item-name.rarity-legendary { color: #cc6600; }

      .equipment-slot-item-stats {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${PARCHMENT_COLORS.state.success};
      }

      .equipment-slot-empty {
        color: ${PARCHMENT_COLORS.text.muted};
        font-style: italic;
        padding: ${PARCHMENT_SPACING.sm} 0;
      }

      .equipment-slot-unequip-btn {
        padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.md};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        background: ${PARCHMENT_COLORS.state.error};
        color: white;
        border: none;
        border-radius: ${PARCHMENT_RADIUS.sm};
        cursor: pointer;
        transition: all 0.2s ease;
        flex-shrink: 0;
      }

      .equipment-slot-unequip-btn:hover:not(:disabled) {
        background: #c62828;
      }

      .equipment-slot-unequip-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* Available Items Section */
      .equipment-slot-available {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }

      .equipment-slot-available-header {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${PARCHMENT_COLORS.text.secondary};
        margin-bottom: ${PARCHMENT_SPACING.sm};
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .equipment-slot-available-list {
        flex: 1;
        overflow-y: auto;
        border: ${getParchmentBorder()};
        border-radius: ${PARCHMENT_RADIUS.md};
        background: ${PARCHMENT_COLORS.light};
        max-height: 300px;
      }

      ${getParchmentScrollbarCSS('.equipment-slot-available-list')}

      .equipment-slot-available-item {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.sm};
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
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

      .equipment-slot-comparison {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        white-space: nowrap;
      }

      .equipment-slot-comparison .stat-positive {
        color: ${PARCHMENT_COLORS.state.success};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      }

      .equipment-slot-comparison .stat-negative {
        color: ${PARCHMENT_COLORS.state.error};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      }

      .equipment-slot-comparison .stat-neutral {
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
        <!-- Currently Equipped -->
        <div class="equipment-slot-current">
          <div class="equipment-slot-current-header">Currently Equipped</div>
          ${this.renderCurrentItem()}
        </div>

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
          <button class="equipment-slot-equip-btn" data-action="equip" disabled>
            Equip Selected
          </button>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  /**
   * Render current item section
   * @returns {string} HTML
   */
  renderCurrentItem() {
    if (!this.currentItem) {
      return `
        <div class="equipment-slot-empty">
          No item equipped in this slot
        </div>
      `;
    }

    const item = this.currentItem;
    const stats = this.getItemStatsSummary(item);

    return `
      <div class="equipment-slot-current-item">
        <div class="equipment-slot-item-info">
          <div class="equipment-slot-item-name rarity-${item.rarity || 'common'}">
            ${this.escapeHtml(item.name)}
          </div>
          ${stats ? `<div class="equipment-slot-item-stats">${stats}</div>` : ''}
        </div>
        <button class="equipment-slot-unequip-btn" data-action="unequip">
          Unequip
        </button>
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

    // Check class restrictions
    if (item.classRestrictions && item.classRestrictions.length > 0) {
      const charClass = (this.characterClass || '').toLowerCase();
      const allowed = item.classRestrictions.some(c => c.toLowerCase() === charClass);
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
      const comparison = this.getStatComparison(item);
      const itemId = item.instanceId || item.id || index;

      return `
        <div
          class="equipment-slot-available-item rarity-${rarity}"
          data-item-id="${itemId}"
          data-index="${index}"
        >
          <div class="equipment-slot-available-info">
            <div class="equipment-slot-available-name rarity-${rarity}">
              ${this.escapeHtml(item.name)}
            </div>
            ${stats ? `<div class="equipment-slot-available-stats">${stats}</div>` : ''}
          </div>
          <div class="equipment-slot-comparison">${comparison}</div>
        </div>
      `;
    }).join('');
  }

  /**
   * Get item stats summary string
   * @param {Object} item - Item data
   * @returns {string} Stats summary
   */
  getItemStatsSummary(item) {
    const parts = [];
    if (item.attack) parts.push(`+${item.attack} ATK`);
    if (item.defense) parts.push(`+${item.defense} DEF`);

    const stats = { ...(item.baseStats || {}), ...(item.bonusStats || {}) };
    Object.entries(stats).slice(0, 2).forEach(([k, v]) => {
      if (v) {
        const abbrev = this.formatStatAbbrev(k);
        parts.push(`+${v} ${abbrev}`);
      }
    });

    return parts.slice(0, 3).join(', ');
  }

  /**
   * Format stat name to abbreviation
   * @param {string} stat - Stat name
   * @returns {string} Abbreviation
   */
  formatStatAbbrev(stat) {
    const abbrevMap = {
      strength: 'STR',
      intelligence: 'INT',
      agility: 'AGI',
      vitality: 'VIT',
      dexterity: 'DEX',
      luck: 'LCK',
      attack: 'ATK',
      defense: 'DEF',
      magicAttack: 'MATK',
      magicDefense: 'MDEF'
    };
    return abbrevMap[stat.toLowerCase()] || stat.substring(0, 3).toUpperCase();
  }

  /**
   * Get stat comparison HTML vs current item
   * @param {Object} item - Item to compare
   * @returns {string} HTML with colored comparison
   */
  getStatComparison(item) {
    const current = this.currentItem;

    // If no current item, show all stats as positive
    if (!current) {
      const itemPower = this.calculateItemPower(item);
      if (itemPower > 0) {
        return `<span class="stat-positive">+${itemPower}</span>`;
      }
      return '<span class="stat-neutral">-</span>';
    }

    // Get stats from both items
    const itemStats = { ...(item?.baseStats || {}), ...(item?.bonusStats || {}) };
    const currentStats = { ...(current?.baseStats || {}), ...(current?.bonusStats || {}) };

    const diffs = [];

    // Check attack/defense first
    const attackDiff = (item?.attack || 0) - (current?.attack || 0);
    const defenseDiff = (item?.defense || 0) - (current?.defense || 0);

    if (attackDiff !== 0) {
      const sign = attackDiff > 0 ? '+' : '';
      const cls = attackDiff > 0 ? 'stat-positive' : 'stat-negative';
      diffs.push(`<span class="${cls}">${sign}${attackDiff} ATK</span>`);
    }

    if (defenseDiff !== 0) {
      const sign = defenseDiff > 0 ? '+' : '';
      const cls = defenseDiff > 0 ? 'stat-positive' : 'stat-negative';
      diffs.push(`<span class="${cls}">${sign}${defenseDiff} DEF</span>`);
    }

    // Check other stats
    const allStatKeys = new Set([...Object.keys(itemStats), ...Object.keys(currentStats)]);
    for (const key of allStatKeys) {
      if (diffs.length >= 2) break;
      const diff = (itemStats[key] || 0) - (currentStats[key] || 0);
      if (diff !== 0) {
        const sign = diff > 0 ? '+' : '';
        const cls = diff > 0 ? 'stat-positive' : 'stat-negative';
        diffs.push(`<span class="${cls}">${sign}${diff} ${this.formatStatAbbrev(key)}</span>`);
      }
    }

    if (diffs.length === 0) {
      // No stat differences, show overall comparison
      const itemPower = this.calculateItemPower(item);
      const currentPower = this.calculateItemPower(current);
      if (itemPower > currentPower) {
        return '<span class="stat-positive">Better</span>';
      } else if (itemPower < currentPower) {
        return '<span class="stat-negative">Worse</span>';
      }
      return '<span class="stat-neutral">Same</span>';
    }

    return diffs.join(' ');
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

    // Unequip button
    const unequipBtn = contentEl.querySelector('[data-action="unequip"]');
    if (unequipBtn) {
      unequipBtn.addEventListener('click', () => this.handleUnequip());
    }

    // Equip button
    const equipBtn = contentEl.querySelector('[data-action="equip"]');
    if (equipBtn) {
      equipBtn.addEventListener('click', () => this.handleEquip());
    }

    // Available item selection
    const items = contentEl.querySelectorAll('.equipment-slot-available-item');
    items.forEach(itemEl => {
      itemEl.addEventListener('click', () => {
        const index = parseInt(itemEl.dataset.index, 10);
        this.selectItem(index);
      });
    });
  }

  /**
   * Select an available item
   * @param {number} index - Item index
   */
  selectItem(index) {
    const availableItems = this.getAvailableItems();
    this.selectedItem = availableItems[index] || null;

    const contentEl = this.modal?.contentElement;
    if (!contentEl) return;

    // Update selection visual
    const items = contentEl.querySelectorAll('.equipment-slot-available-item');
    items.forEach((el, i) => {
      el.classList.toggle('selected', i === index);
    });

    // Enable/disable equip button
    const equipBtn = contentEl.querySelector('[data-action="equip"]');
    if (equipBtn) {
      equipBtn.disabled = !this.selectedItem;
    }
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
      await this.game.api.equipItem(itemId, this.characterId, this.slotKey);

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
    this.selectedItem = null;
    this.modal = null;
  }
}

export default EquipmentSlotModal;
