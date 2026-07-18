/**
 * ItemsModal - Full party inventory view modal
 *
 * Displays the shared party inventory with filtering and search capabilities.
 * Clicking an item opens ItemDetailModal for details and actions.
 *
 * Features:
 * - ItemDataTable with inventory variant
 * - Search and filter controls
 * - Click row to view item details
 * - Empty state handling
 * - Auto-refresh after item use
 *
 * Usage:
 *   const modal = new ItemsModal({
 *     game: this.game,
 *     onItemUsed: () => refreshPartyData()
 *   });
 *   modal.open();
 */

import { ParchmentModal } from '../../ui/parchment/ParchmentModal.js';
import { ItemDataTable } from '../ItemDataTable/ItemDataTable.js';
import { Icon } from '../Icon.js';
import { parchmentToast } from '../../ui/parchment/ParchmentToast.js';
import {
  PARCHMENT_COLORS,
  PARCHMENT_SPACING
} from '../../ui/parchment/ParchmentTheme.js';

const STYLE_ID = 'items-modal-styles';

export class ItemsModal {
  /**
   * @param {Object} options - Modal configuration
   * @param {Object} options.game - Game instance with API
   * @param {Function} [options.onItemUsed] - Callback when item is used
   * @param {Function} [options.onClose] - Callback when modal closes
   */
  constructor(options = {}) {
    this.game = options.game;
    this.onItemUsed = options.onItemUsed || (() => {});
    this.onClose = options.onClose || (() => {});

    this.modal = null;
    this.dataTable = null;
    this.inventory = [];
    this.characters = [];
    this.detailModal = null;

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
      .items-modal-content {
        min-height: 300px;
        display: flex;
        flex-direction: column;
      }

      .items-modal-table-container {
        flex: 1;
        min-height: 250px;
      }

      .items-modal-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: ${PARCHMENT_SPACING.xl};
        color: ${PARCHMENT_COLORS.text.muted};
        text-align: center;
        min-height: 200px;
      }

      .items-modal-empty-icon {
        font-size: 48px;
        margin-bottom: ${PARCHMENT_SPACING.md};
        opacity: 0.5;
      }

      .items-modal-empty-text {
        font-style: italic;
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Open the modal and load inventory
   */
  async open() {
    // Create modal
    this.modal = new ParchmentModal({
      title: 'Party Inventory',
      content: '<div class="items-modal-content"><div class="items-modal-loading">Loading inventory...</div></div>',
      size: 'lg',
      closable: true,
      closeOnOverlay: true,
      closeOnEscape: true,
      onClose: () => {
        this.cleanup();
        this.onClose();
      }
    });

    this.modal.open();

    // Load data
    try {
      await this.loadData();
      this.render();
    } catch (error) {
      console.error('Failed to load inventory:', error);
      parchmentToast.error('Failed to load inventory');
      this.renderError();
    }
  }

  /**
   * Load inventory and character data
   */
  async loadData() {
    const [inventoryData, charactersData] = await Promise.all([
      this.game.api.getSharedInventory(),
      this.game.api.getCharacters()
    ]);

    this.inventory = inventoryData.inventory || inventoryData || [];
    this.characters = charactersData.characters || charactersData || [];
  }

  /**
   * Render the inventory table
   */
  render() {
    const contentEl = this.modal.contentElement;
    if (!contentEl) return;

    if (this.inventory.length === 0) {
      contentEl.innerHTML = `
        <div class="items-modal-content">
          <div class="items-modal-empty">
            <div class="items-modal-empty-icon">${Icon.html('menu', 'inventory', { size: 'lg' })}</div>
            <div class="items-modal-empty-text">Your party has no items</div>
          </div>
        </div>
      `;
      return;
    }

    contentEl.innerHTML = `
      <div class="items-modal-content">
        <div class="items-modal-table-container"></div>
      </div>
    `;

    const tableContainer = contentEl.querySelector('.items-modal-table-container');

    // Create data table
    this.dataTable = new ItemDataTable(tableContainer, {
      variant: 'inventory',
      selectionMode: 'single',
      showFilters: true,
      maxHeight: '400px',
      onRowSelect: (item) => this.openItemDetail(item)
    });

    this.dataTable.setItems(this.inventory);
  }

  /**
   * Render error state
   */
  renderError() {
    const contentEl = this.modal?.contentElement;
    if (!contentEl) return;

    contentEl.innerHTML = `
      <div class="items-modal-content">
        <div class="items-modal-empty">
          <div class="items-modal-empty-icon">⚠️</div>
          <div class="items-modal-empty-text">Failed to load inventory</div>
        </div>
      </div>
    `;
  }

  /**
   * Open item detail modal
   * @param {Object} item - Selected item
   */
  async openItemDetail(item) {
    // Dynamically import ItemDetailModal to avoid circular dependency
    const { ItemDetailModal } = await import('./ItemDetailModal.js');

    this.detailModal = new ItemDetailModal({
      game: this.game,
      item,
      characters: this.characters,
      onItemUsed: async () => {
        // Refresh inventory
        await this.loadData();
        this.render();
        this.onItemUsed();
      },
      onClose: () => {
        this.detailModal = null;
      }
    });

    this.detailModal.open();
  }

  /**
   * Refresh the inventory data
   */
  async refresh() {
    try {
      await this.loadData();
      this.render();
    } catch (error) {
      console.error('Failed to refresh inventory:', error);
    }
  }

  /**
   * Close the modal
   */
  close() {
    if (this.detailModal) {
      this.detailModal.close();
    }
    if (this.modal) {
      this.modal.close();
    }
  }

  /**
   * Clean up resources
   */
  cleanup() {
    if (this.dataTable) {
      this.dataTable.destroy();
      this.dataTable = null;
    }
    if (this.detailModal) {
      this.detailModal.close();
      this.detailModal = null;
    }
    this.modal = null;
  }
}

export default ItemsModal;
