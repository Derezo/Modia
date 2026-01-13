import { parchmentToast } from '../ui/parchment/ParchmentToast.js';
import { Icon } from './Icon.js';

// Item type icon mappings
const ITEM_TYPE_ICONS = {
  weapon: { category: 'items', name: 'weapon' },
  shield: { category: 'items', name: 'shield' },
  helmet: { category: 'items', name: 'helmet' },
  armor: { category: 'items', name: 'armor' },
  boots: { category: 'items', name: 'boots' },
  accessory: { category: 'items', name: 'accessory' },
  ring: { category: 'items', name: 'ring' },
  necklace: { category: 'items', name: 'necklace' },
  consumable: { category: 'items', name: 'consumable' },
  material: { category: 'items', name: 'material' },
  key: { category: 'items', name: 'key' }
};

// Parchment theme colors for consistent styling
const PARCHMENT = {
  light: '#d4c4a8',
  mid: '#c9b899',
  dark: '#bfae8a',
  border: '#8b7355',
  borderDark: '#6b5344',
  text: {
    primary: '#2d2418',
    secondary: '#5a4a3a',
    muted: '#7a6a5a'
  },
  state: {
    success: '#4a7548',
    error: '#8b4444',
    warning: '#c9a227',  // Keep warning as gold for toast contrast
    info: '#4a6088'
  },
  accent: {
    burgundy: '#6b2d3d'  // New accent color for highlights
  }
};

export class InventoryPanel {
  constructor(game, container) {
    this.game = game;
    this.container = container;
    this.characterId = null;
    this.characters = []; // All party characters for selector
    this.equipped = {};
    this.inventory = []; // Shared inventory pool
    this.selectedItem = null;
    this.element = null;
    this.characterStats = null; // For stat comparison
    this.tooltipElement = null;
    this.confirmModalElement = null; // For themed confirm dialogs
    this.isLoading = false; // Loading state for async operations

    // Asset loader for item sprites
    this.assetLoader = game.assetLoader || null;
  }

  /**
   * Set available characters for the character selector
   */
  setCharacters(characters) {
    this.characters = characters || [];
  }

  /**
   * Set character stats for stat comparison tooltips
   */
  setCharacterStats(character) {
    this.characterStats = character;
  }

  async load(characterId) {
    this.characterId = characterId;
    try {
      // Load character's equipped items and shared inventory in parallel
      const [charData, sharedData] = await Promise.all([
        this.game.api.getInventory(characterId),
        this.game.api.getSharedInventory()
      ]);

      this.equipped = charData.equipped || {};
      this.inventory = sharedData.inventory || [];

      // Preload item sprites in background
      this.preloadItemSprites();

      this.render();
    } catch (err) {
      console.error('Failed to load inventory:', err);
      parchmentToast.error('Load Failed', 'Failed to load inventory');
    }
  }

  /**
   * Preload sprites for all items
   */
  async preloadItemSprites() {
    if (!this.assetLoader) return;

    const allItems = [
      ...Object.values(this.equipped).filter(Boolean),
      ...this.inventory
    ];

    const loadPromises = allItems.map(item =>
      this.assetLoader.loadItemIcon(item).catch(() => null)
    );

    await Promise.allSettled(loadPromises);
  }

  render() {
    if (this.element) {
      this.element.remove();
    }

    this.element = document.createElement('div');
    this.element.className = 'inventory-panel';
    this.element.innerHTML = `
      <style>
        .inventory-panel {
          display: flex;
          gap: 16px;
          height: 100%;
          font-family: Georgia, serif;
        }
        .equipment-section {
          width: 200px;
          flex-shrink: 0;
        }
        .inventory-section {
          flex: 1;
          min-width: 0;
        }
        .equipment-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 4px;
          margin-bottom: 12px;
        }
        .equipment-slot {
          width: 56px;
          height: 56px;
          background: ${PARCHMENT.mid};
          border: 2px solid ${PARCHMENT.border};
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          position: relative;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.3);
        }
        .equipment-slot:hover {
          border-color: ${PARCHMENT.accent.burgundy};
          background: ${PARCHMENT.dark};
        }
        .equipment-slot.filled {
          border-color: ${PARCHMENT.state.info};
        }
        .equipment-slot .slot-label {
          position: absolute;
          bottom: 2px;
          font-size: 8px;
          color: ${PARCHMENT.text.secondary};
        }
        .equipment-slot .item-icon {
          font-size: 24px;
        }
        .equipment-slot .item-sprite,
        .inventory-slot .item-sprite {
          width: 32px;
          height: 32px;
          image-rendering: pixelated;
          image-rendering: crisp-edges;
        }
        .inventory-slot .item-sprite {
          width: 28px;
          height: 28px;
        }
        .item-details .detail-icon {
          width: 48px;
          height: 48px;
          image-rendering: pixelated;
          float: left;
          margin-right: 12px;
        }
        .rarity-glow-uncommon { filter: drop-shadow(0 0 3px #1eff00); }
        .rarity-glow-rare { filter: drop-shadow(0 0 4px #0070dd); }
        .rarity-glow-epic { filter: drop-shadow(0 0 5px #a335ee); }
        .rarity-glow-legendary { filter: drop-shadow(0 0 6px #ff8000); }
        .stat-comparison-tooltip {
          position: fixed;
          background: linear-gradient(to bottom, ${PARCHMENT.light}, ${PARCHMENT.mid});
          border: 2px solid ${PARCHMENT.border};
          border-radius: 4px;
          padding: 12px;
          min-width: 200px;
          max-width: 280px;
          z-index: 1000;
          pointer-events: none;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
          font-family: Georgia, serif;
          color: ${PARCHMENT.text.primary};
        }
        .tooltip-item-name {
          font-weight: bold;
          margin-bottom: 8px;
          font-size: 14px;
        }
        .tooltip-item-name.common { color: ${PARCHMENT.text.primary}; }
        .tooltip-item-name.uncommon { color: #1eff00; }
        .tooltip-item-name.rare { color: #0070dd; }
        .tooltip-item-name.epic { color: #a335ee; }
        .tooltip-item-name.legendary { color: #ff8000; }
        .tooltip-stats {
          font-size: 12px;
          margin-bottom: 8px;
        }
        .tooltip-stat-row {
          display: flex;
          justify-content: space-between;
          padding: 2px 0;
          color: ${PARCHMENT.text.secondary};
        }
        .stat-positive { color: ${PARCHMENT.state.success}; }
        .stat-negative { color: ${PARCHMENT.state.error}; }
        .stat-neutral { color: ${PARCHMENT.text.muted}; }
        .tooltip-comparison {
          border-top: 1px solid ${PARCHMENT.border};
          padding-top: 8px;
          margin-top: 8px;
          font-size: 11px;
          color: ${PARCHMENT.text.secondary};
        }
        .comparison-header {
          font-weight: bold;
          margin-bottom: 4px;
          color: ${PARCHMENT.accent.burgundy};
        }
        /* Drag and drop styles */
        .inventory-slot.dragging,
        .equipment-slot.dragging {
          opacity: 0.5;
        }
        .equipment-slot.drag-over {
          border-color: ${PARCHMENT.state.success};
          background: rgba(74, 117, 72, 0.3);
          box-shadow: 0 0 8px rgba(74, 117, 72, 0.5);
        }
        .equipment-slot.drag-invalid {
          border-color: ${PARCHMENT.state.error};
          background: rgba(139, 68, 68, 0.2);
        }
        .inventory-section.drag-over {
          background: rgba(74, 96, 136, 0.15);
          border-radius: 4px;
        }
        .inventory-grid {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 4px;
          max-height: 300px;
          overflow-y: auto;
        }
        .inventory-slot {
          width: 48px;
          height: 48px;
          background: ${PARCHMENT.light};
          border: 2px solid ${PARCHMENT.border};
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          position: relative;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.3);
        }
        .inventory-slot:hover {
          border-color: ${PARCHMENT.accent.burgundy};
          background: ${PARCHMENT.mid};
        }
        .inventory-slot.selected {
          border-color: ${PARCHMENT.accent.burgundy};
          background: linear-gradient(to bottom, #e8d9a8, #d4c498);
          box-shadow: 0 0 6px rgba(201, 162, 39, 0.4);
        }
        .inventory-slot.empty {
          background: ${PARCHMENT.dark};
          opacity: 0.6;
        }
        .inventory-slot .quantity {
          position: absolute;
          bottom: 2px;
          right: 4px;
          font-size: 10px;
          color: ${PARCHMENT.text.primary};
          font-weight: bold;
          text-shadow: 0 1px 0 rgba(255,255,255,0.5);
        }
        .item-details {
          margin-top: 12px;
          padding: 12px;
          background: ${PARCHMENT.mid};
          border: 1px solid ${PARCHMENT.border};
          border-radius: 4px;
          min-height: 120px;
        }
        .item-name {
          font-weight: bold;
          margin-bottom: 8px;
        }
        .item-name.common { color: ${PARCHMENT.text.primary}; }
        .item-name.uncommon { color: #1eff00; }
        .item-name.rare { color: #0070dd; }
        .item-name.epic { color: #a335ee; }
        .item-name.legendary { color: #ff8000; }
        .item-type {
          font-size: 12px;
          color: ${PARCHMENT.text.secondary};
          margin-bottom: 8px;
        }
        .item-description {
          font-size: 12px;
          color: ${PARCHMENT.text.secondary};
          margin-bottom: 8px;
        }
        .item-stats {
          font-size: 11px;
          color: ${PARCHMENT.state.info};
        }
        .item-stats .stat-line {
          margin: 2px 0;
        }
        .item-stats .bonus-stat {
          color: ${PARCHMENT.state.success};
        }
        .item-augments {
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid ${PARCHMENT.border};
        }
        .augment-effect {
          font-size: 11px;
          color: #7c5cbf;
          margin: 2px 0;
        }
        .item-material {
          display: inline;
          color: ${PARCHMENT.accent.burgundy};
        }
        .item-actions {
          margin-top: 12px;
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .item-actions .btn {
          padding: 6px 12px;
          font-family: Georgia, serif;
          font-size: 12px;
          border: 2px solid ${PARCHMENT.border};
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .item-actions .btn-primary {
          background: linear-gradient(to bottom, ${PARCHMENT.state.info}, #3a5068);
          color: #fff;
          border-color: ${PARCHMENT.borderDark};
        }
        .item-actions .btn-primary:hover {
          background: linear-gradient(to bottom, #3a5068, ${PARCHMENT.state.info});
        }
        .item-actions .btn-secondary {
          background: linear-gradient(to bottom, ${PARCHMENT.light}, ${PARCHMENT.mid});
          color: ${PARCHMENT.text.primary};
        }
        .item-actions .btn-secondary:hover {
          background: linear-gradient(to bottom, ${PARCHMENT.mid}, ${PARCHMENT.dark});
        }
        .item-actions .btn-danger {
          background: linear-gradient(to bottom, ${PARCHMENT.state.error}, #6b3434);
          color: #fff;
          border-color: ${PARCHMENT.borderDark};
        }
        .item-actions .btn-danger:hover {
          background: linear-gradient(to bottom, #6b3434, ${PARCHMENT.state.error});
        }
        .section-title {
          font-weight: bold;
          color: ${PARCHMENT.accent.burgundy};
          margin-bottom: 8px;
          font-size: 14px;
          text-shadow: 0 1px 0 rgba(255,255,255,0.3);
        }
        .section-subtitle {
          font-size: 11px;
          color: ${PARCHMENT.text.secondary};
          font-style: italic;
          margin-left: 4px;
        }
        .equipment-section.loading,
        .inventory-section.loading {
          opacity: 0.6;
          pointer-events: none;
        }
        .loading-indicator {
          display: none;
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: ${PARCHMENT.mid};
          padding: 8px 16px;
          border-radius: 4px;
          border: 2px solid ${PARCHMENT.border};
          font-size: 12px;
          color: ${PARCHMENT.text.secondary};
          z-index: 10;
        }
        .equipment-section.loading .loading-indicator {
          display: block;
        }
        /* Confirm modal styles */
        .confirm-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2000;
        }
        .confirm-modal {
          background: linear-gradient(to bottom, ${PARCHMENT.light}, ${PARCHMENT.mid});
          border: 3px solid ${PARCHMENT.border};
          border-radius: 8px;
          padding: 20px;
          min-width: 280px;
          max-width: 400px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
          font-family: Georgia, serif;
        }
        .confirm-modal-title {
          font-weight: bold;
          font-size: 16px;
          color: ${PARCHMENT.accent.burgundy};
          margin-bottom: 12px;
        }
        .confirm-modal-message {
          font-size: 14px;
          color: ${PARCHMENT.text.primary};
          margin-bottom: 20px;
          line-height: 1.4;
        }
        .confirm-modal-buttons {
          display: flex;
          gap: 12px;
          justify-content: flex-end;
        }
        .confirm-modal-buttons .btn {
          padding: 8px 20px;
          font-family: Georgia, serif;
          font-size: 13px;
          border: 2px solid ${PARCHMENT.border};
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .character-tabs {
          display: flex;
          gap: 4px;
          margin-bottom: 8px;
          flex-wrap: wrap;
        }
        .character-tab {
          padding: 6px 10px;
          font-family: Georgia, serif;
          font-size: 11px;
          background: ${PARCHMENT.light};
          border: 2px solid ${PARCHMENT.border};
          border-radius: 4px 4px 0 0;
          cursor: pointer;
          color: ${PARCHMENT.text.secondary};
          transition: all 0.15s;
        }
        .character-tab:hover {
          background: ${PARCHMENT.mid};
          color: ${PARCHMENT.text.primary};
        }
        .character-tab.active {
          background: ${PARCHMENT.mid};
          border-bottom-color: ${PARCHMENT.mid};
          color: ${PARCHMENT.accent.burgundy};
          font-weight: bold;
        }
      </style>

      <div class="equipment-section${this.isLoading ? ' loading' : ''}" style="position: relative;">
        ${this.renderCharacterTabs()}
        <div class="section-title">${this.getCharacterName()}'s Equipment</div>
        <div class="loading-indicator">Loading...</div>
        <div class="equipment-grid">
          ${this.renderEquipmentSlot('head', 'Head')}
          <div></div>
          <div></div>
          ${this.renderEquipmentSlot('main_hand', 'Weapon')}
          ${this.renderEquipmentSlot('body', 'Body')}
          ${this.renderEquipmentSlot('off_hand', 'Off Hand')}
          <div></div>
          ${this.renderEquipmentSlot('legs', 'Legs')}
          <div></div>
          ${this.renderEquipmentSlot('feet', 'Feet')}
          <div></div>
          ${this.renderEquipmentSlot('accessory', 'Accessory')}
        </div>
      </div>

      <div class="inventory-section">
        <div class="section-title">Party Inventory<span class="section-subtitle">(Shared)</span></div>
        <div style="font-size: 11px; color: ${PARCHMENT.text.muted}; margin-bottom: 8px;">${this.inventory.length} items</div>
        <div class="inventory-grid">
          ${this.inventory.map((item, idx) => this.renderInventorySlot(item, idx)).join('')}
          ${this.renderEmptySlots(24 - this.inventory.length)}
        </div>
        <div class="item-details" id="item-details">
          <div style="color: ${PARCHMENT.text.muted}; text-align: center;">Select an item to view details</div>
        </div>
      </div>
    `;

    this.container.appendChild(this.element);
    this.setupEventListeners();
  }

  /**
   * Render character selector tabs
   */
  renderCharacterTabs() {
    if (!this.characters || this.characters.length <= 1) {
      return ''; // No tabs needed for single character
    }

    const tabs = this.characters.map(char => {
      const isActive = char.id === this.characterId;
      const shortName = char.name.length > 8 ? char.name.slice(0, 7) + '…' : char.name;
      return `
        <div class="character-tab ${isActive ? 'active' : ''}" data-character-id="${char.id}">
          ${shortName}
        </div>
      `;
    }).join('');

    return `<div class="character-tabs">${tabs}</div>`;
  }

  renderEquipmentSlot(slot, label) {
    const item = this.equipped[slot];
    const filledClass = item ? 'filled' : '';
    const iconHtml = item ? this.getItemIconHtml(item, 'equipment') : '';
    const draggable = item ? 'draggable="true"' : '';
    return `
      <div class="equipment-slot ${filledClass}" data-slot="${slot}" data-equipped="true" ${draggable}>
        ${iconHtml}
        <span class="slot-label">${label}</span>
      </div>
    `;
  }

  renderInventorySlot(item, index) {
    const iconHtml = this.getItemIconHtml(item, 'inventory');
    const quantity = item.quantity > 1 ? `<span class="quantity">x${item.quantity}</span>` : '';
    const draggable = this.isEquippable(item.type) ? 'draggable="true"' : '';
    return `
      <div class="inventory-slot" data-index="${index}" data-instance-id="${item.instanceId}" data-item-type="${item.type}" ${draggable}>
        ${iconHtml}
        ${quantity}
      </div>
    `;
  }

  /**
   * Get item icon HTML - sprite if available, emoji fallback
   */
  getItemIconHtml(item, context = 'inventory') {
    // Try to get sprite from cache
    const sprite = this.assetLoader?.getItemIcon(item);
    const rarityClass = item.rarity && item.rarity !== 'common' ? `rarity-glow-${item.rarity}` : '';

    if (sprite) {
      return `<img class="item-sprite ${rarityClass}" src="${sprite.src}" alt="${item.name || item.type}" />`;
    }

    // Fallback to emoji
    const icon = this.getItemIcon(item.type);
    return `<span class="item-icon">${icon}</span>`;
  }

  renderEmptySlots(count) {
    let html = '';
    for (let i = 0; i < count; i++) {
      html += '<div class="inventory-slot empty"></div>';
    }
    return html;
  }

  getItemIcon(type) {
    const iconConfig = ITEM_TYPE_ICONS[type];
    if (iconConfig) {
      return Icon.html(iconConfig.category, iconConfig.name, { size: 'md' });
    }
    // Fallback to question mark icon
    return Icon.html('nodes', 'question', { size: 'md' });
  }

  setupEventListeners() {
    // Character tab clicks
    this.element.querySelectorAll('.character-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const charId = parseInt(tab.dataset.characterId);
        if (charId && charId !== this.characterId) {
          this.switchCharacter(charId);
        }
      });
    });

    // Equipment slots - click and drag-drop
    this.element.querySelectorAll('.equipment-slot').forEach(slot => {
      slot.addEventListener('click', () => this.handleEquipmentSlotClick(slot));

      // Drag start for equipped items (to unequip)
      slot.addEventListener('dragstart', (e) => this.handleEquipmentDragStart(e, slot));
      slot.addEventListener('dragend', (e) => this.handleDragEnd(e, slot));

      // Drop target for inventory items
      slot.addEventListener('dragover', (e) => this.handleEquipmentDragOver(e, slot));
      slot.addEventListener('dragenter', (e) => this.handleEquipmentDragEnter(e, slot));
      slot.addEventListener('dragleave', (e) => this.handleEquipmentDragLeave(e, slot));
      slot.addEventListener('drop', (e) => this.handleEquipmentDrop(e, slot));
    });

    // Inventory slots - click, hover for tooltips, and drag-drop
    this.element.querySelectorAll('.inventory-slot:not(.empty)').forEach(slot => {
      slot.addEventListener('click', () => this.handleInventorySlotClick(slot));
      slot.addEventListener('mouseenter', (e) => this.showStatComparisonTooltip(e, slot));
      slot.addEventListener('mouseleave', () => this.hideTooltip());
      slot.addEventListener('mousemove', (e) => this.updateTooltipPosition(e));

      // Drag start for inventory items (to equip)
      slot.addEventListener('dragstart', (e) => this.handleInventoryDragStart(e, slot));
      slot.addEventListener('dragend', (e) => this.handleDragEnd(e, slot));
    });

    // Inventory section as drop target for unequipping
    const inventorySection = this.element.querySelector('.inventory-section');
    if (inventorySection) {
      inventorySection.addEventListener('dragover', (e) => this.handleInventoryDragOver(e));
      inventorySection.addEventListener('dragenter', (e) => this.handleInventoryDragEnter(e));
      inventorySection.addEventListener('dragleave', (e) => this.handleInventoryDragLeave(e));
      inventorySection.addEventListener('drop', (e) => this.handleInventoryDrop(e));
    }
  }

  // ==================== Drag-Drop Handlers ====================

  /**
   * Handle drag start from inventory slot (equipping)
   */
  handleInventoryDragStart(e, slot) {
    const index = parseInt(slot.dataset.index);
    const item = this.inventory[index];

    if (!item || !this.isEquippable(item.type)) {
      e.preventDefault();
      return;
    }

    // Hide tooltip during drag
    this.hideTooltip();

    // Store drag data
    e.dataTransfer.setData('text/plain', JSON.stringify({
      source: 'inventory',
      instanceId: item.instanceId,
      itemType: item.type,
      index: index
    }));
    e.dataTransfer.effectAllowed = 'move';

    slot.classList.add('dragging');
  }

  /**
   * Handle drag start from equipment slot (unequipping)
   */
  handleEquipmentDragStart(e, slot) {
    const slotName = slot.dataset.slot;
    const item = this.equipped[slotName];

    if (!item) {
      e.preventDefault();
      return;
    }

    e.dataTransfer.setData('text/plain', JSON.stringify({
      source: 'equipment',
      slot: slotName,
      itemType: item.type
    }));
    e.dataTransfer.effectAllowed = 'move';

    slot.classList.add('dragging');
  }

  /**
   * Handle drag end (cleanup)
   */
  handleDragEnd(e, slot) {
    slot.classList.remove('dragging');

    // Clean up any lingering drag-over states
    this.element.querySelectorAll('.drag-over, .drag-invalid').forEach(el => {
      el.classList.remove('drag-over', 'drag-invalid');
    });
  }

  /**
   * Handle drag over equipment slot
   */
  handleEquipmentDragOver(e, slot) {
    e.preventDefault();

    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain') || '{}');
      if (data.source === 'inventory') {
        e.dataTransfer.dropEffect = 'move';
      }
    } catch {
      // Drag data not available during dragover in some browsers
      e.dataTransfer.dropEffect = 'move';
    }
  }

  /**
   * Handle drag enter equipment slot (visual feedback)
   */
  handleEquipmentDragEnter(e, slot) {
    e.preventDefault();

    const slotName = slot.dataset.slot;

    // Check if we can determine item compatibility
    // During drag, we may not have access to dataTransfer data in some browsers
    // So we'll show a neutral highlight and validate on drop
    slot.classList.add('drag-over');
  }

  /**
   * Handle drag leave equipment slot
   */
  handleEquipmentDragLeave(e, slot) {
    // Only remove if we're actually leaving the slot (not entering a child)
    if (!slot.contains(e.relatedTarget)) {
      slot.classList.remove('drag-over', 'drag-invalid');
    }
  }

  /**
   * Handle drop on equipment slot (equip item)
   */
  async handleEquipmentDrop(e, slot) {
    e.preventDefault();
    slot.classList.remove('drag-over', 'drag-invalid');

    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));

      if (data.source !== 'inventory') {
        return; // Only handle drops from inventory
      }

      const slotName = slot.dataset.slot;
      const item = this.inventory.find(i => i.instanceId === data.instanceId);

      if (!item) return;

      // Validate that item can go in this slot
      const validSlots = this.getValidSlotsForItem(item.type);
      if (!validSlots.includes(slotName)) {
        parchmentToast.error('Cannot Equip', `Cannot equip ${item.name} in ${slotName} slot`);
        return;
      }

      // Equip the item to this specific slot
      const result = await this.game.api.equipItem(this.characterId, data.instanceId, slotName);
      this.equipped = result.equipped;
      // Reload shared inventory since item moved from pool to character
      const sharedData = await this.game.api.getSharedInventory();
      this.inventory = sharedData.inventory || [];
      this.render();
      parchmentToast.success('Equipped', `Equipped ${item.name}`);

    } catch (err) {
      console.error('Drop error:', err);
      parchmentToast.error('Equip Failed', err.message || 'Failed to equip item');
    }
  }

  /**
   * Handle drag over inventory section
   */
  handleInventoryDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  /**
   * Handle drag enter inventory section
   */
  handleInventoryDragEnter(e) {
    e.preventDefault();
    const section = this.element.querySelector('.inventory-section');
    if (section) {
      section.classList.add('drag-over');
    }
  }

  /**
   * Handle drag leave inventory section
   */
  handleInventoryDragLeave(e) {
    const section = this.element.querySelector('.inventory-section');
    if (section && !section.contains(e.relatedTarget)) {
      section.classList.remove('drag-over');
    }
  }

  /**
   * Handle drop on inventory section (unequip item)
   */
  async handleInventoryDrop(e) {
    e.preventDefault();

    const section = this.element.querySelector('.inventory-section');
    if (section) {
      section.classList.remove('drag-over');
    }

    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));

      if (data.source !== 'equipment') {
        return; // Only handle drops from equipment
      }

      // Unequip the item
      const result = await this.game.api.unequipItem(this.characterId, data.slot);
      this.equipped = result.equipped;
      // Reload shared inventory since item moved from character to pool
      const sharedData = await this.game.api.getSharedInventory();
      this.inventory = sharedData.inventory || [];
      this.render();
      parchmentToast.success('Unequipped', 'Item unequipped');

    } catch (err) {
      console.error('Drop error:', err);
      parchmentToast.error('Unequip Failed', err.message || 'Failed to unequip item');
    }
  }

  /**
   * Get valid equipment slots for an item type
   * Must match backend: api/src/routes/inventory.js getValidSlotsForItem()
   */
  getValidSlotsForItem(itemType) {
    const slotMap = {
      weapon: ['main_hand', 'off_hand'],
      armor: ['head', 'body', 'legs', 'feet'],
      accessory: ['accessory']
    };
    return slotMap[itemType] || [];
  }

  /**
   * Show stat comparison tooltip for equippable items
   */
  showStatComparisonTooltip(event, slot) {
    const index = parseInt(slot.dataset.index);
    const item = this.inventory[index];

    if (!item || !this.isEquippable(item.type)) return;

    // Get the slot this item would equip to
    const targetSlot = this.getDefaultSlot(item.type);
    if (!targetSlot) return;

    // Get currently equipped item in that slot
    const currentEquipped = this.equipped[targetSlot];

    // Create tooltip element
    this.tooltipElement = document.createElement('div');
    this.tooltipElement.className = 'stat-comparison-tooltip';

    // Build tooltip HTML
    let html = `<div class="tooltip-item-name ${item.rarity || 'common'}">${item.name}</div>`;
    html += `<div style="font-size: 11px; color: ${PARCHMENT.text.secondary}; margin-bottom: 8px;">${this.capitalize(item.type)} - ${this.capitalize(item.rarity || 'common')}${item.material ? ' - ' + this.capitalize(item.material) : ''}</div>`;

    // Base stats
    const itemStats = item.baseStats || {};
    if (Object.keys(itemStats).length > 0) {
      html += '<div class="tooltip-stats">';
      for (const [stat, value] of Object.entries(itemStats)) {
        html += `<div class="tooltip-stat-row"><span>${this.formatStatName(stat)}</span><span class="stat-positive">+${value}</span></div>`;
      }
      html += '</div>';
    }

    // Bonus stats from augments
    const bonusStats = item.bonusStats || {};
    if (Object.keys(bonusStats).length > 0) {
      html += `<div class="tooltip-stats" style="border-top: 1px solid ${PARCHMENT.border}; padding-top: 4px; margin-top: 4px;">`;
      for (const [stat, value] of Object.entries(bonusStats)) {
        html += `<div class="tooltip-stat-row"><span style="color: ${PARCHMENT.state.success};">${this.formatStatName(stat)} (Augment)</span><span class="stat-positive">+${value}</span></div>`;
      }
      html += '</div>';
    }

    // Augment effects
    const augments = item.augments || [];
    if (augments.length > 0) {
      html += `<div style="border-top: 1px solid ${PARCHMENT.border}; padding-top: 4px; margin-top: 4px; font-size: 10px;">`;
      for (const aug of augments) {
        html += `<div style="color: #7c5cbf;">${this.formatAugmentEffect(aug)}</div>`;
      }
      html += '</div>';
    }

    // Comparison with equipped item (combine base + bonus stats for comparison)
    if (currentEquipped) {
      const itemTotalStats = { ...itemStats };
      for (const [stat, value] of Object.entries(bonusStats)) {
        itemTotalStats[stat] = (itemTotalStats[stat] || 0) + value;
      }

      const equippedStats = currentEquipped.baseStats || {};
      const equippedBonusStats = currentEquipped.bonusStats || {};
      const equippedTotalStats = { ...equippedStats };
      for (const [stat, value] of Object.entries(equippedBonusStats)) {
        equippedTotalStats[stat] = (equippedTotalStats[stat] || 0) + value;
      }

      const comparison = this.calculateStatComparison(itemTotalStats, equippedTotalStats);

      if (comparison.length > 0) {
        html += '<div class="tooltip-comparison">';
        html += `<div class="comparison-header">vs. ${currentEquipped.name}</div>`;
        for (const { stat, diff } of comparison) {
          const diffClass = diff > 0 ? 'stat-positive' : diff < 0 ? 'stat-negative' : 'stat-neutral';
          const diffStr = diff > 0 ? `+${diff}` : diff.toString();
          html += `<div class="tooltip-stat-row"><span>${this.formatStatName(stat)}</span><span class="${diffClass}">${diffStr}</span></div>`;
        }
        html += '</div>';
      }
    } else {
      // No equipped item - show that this is a new equip
      html += `<div class="tooltip-comparison"><div style="color: ${PARCHMENT.state.success};">Slot is empty - equip for these stats</div></div>`;
    }

    this.tooltipElement.innerHTML = html;
    document.body.appendChild(this.tooltipElement);
    this.updateTooltipPosition(event);
  }

  /**
   * Calculate stat differences between new item and equipped item
   */
  calculateStatComparison(newStats, oldStats) {
    const allStats = new Set([...Object.keys(newStats), ...Object.keys(oldStats)]);
    const comparison = [];

    for (const stat of allStats) {
      const newVal = newStats[stat] || 0;
      const oldVal = oldStats[stat] || 0;
      const diff = newVal - oldVal;

      if (diff !== 0) {
        comparison.push({ stat, diff });
      }
    }

    return comparison;
  }

  /**
   * Update tooltip position to follow mouse
   */
  updateTooltipPosition(event) {
    if (!this.tooltipElement) return;

    const padding = 15;
    let x = event.clientX + padding;
    let y = event.clientY + padding;

    // Keep tooltip on screen
    const rect = this.tooltipElement.getBoundingClientRect();
    if (x + rect.width > window.innerWidth) {
      x = event.clientX - rect.width - padding;
    }
    if (y + rect.height > window.innerHeight) {
      y = event.clientY - rect.height - padding;
    }

    this.tooltipElement.style.left = `${x}px`;
    this.tooltipElement.style.top = `${y}px`;
  }

  /**
   * Hide and remove tooltip
   */
  hideTooltip() {
    if (this.tooltipElement) {
      this.tooltipElement.remove();
      this.tooltipElement = null;
    }
  }

  handleEquipmentSlotClick(slot) {
    const slotName = slot.dataset.slot;
    const item = this.equipped[slotName];

    if (item) {
      this.showItemDetails(item, true, slotName);
    }
  }

  handleInventorySlotClick(slot) {
    const index = parseInt(slot.dataset.index);
    const item = this.inventory[index];

    // Clear previous selection
    this.element.querySelectorAll('.inventory-slot.selected').forEach(s => {
      s.classList.remove('selected');
    });

    // Select this slot
    slot.classList.add('selected');
    this.selectedItem = { item, index };

    if (item) {
      this.showItemDetails(item, false);
    }
  }

  showItemDetails(item, isEquipped, slot = null) {
    const detailsEl = this.element.querySelector('#item-details');

    // Base stats
    const baseStats = item.baseStats || {};
    const baseStatsHtml = Object.entries(baseStats)
      .map(([key, val]) => `<div class="stat-line">+${val} ${this.formatStatName(key)}</div>`)
      .join('');

    // Bonus stats from augments (displayed in green)
    const bonusStats = item.bonusStats || {};
    const bonusStatsHtml = Object.keys(bonusStats).length > 0
      ? Object.entries(bonusStats)
        .map(([key, val]) => `<div class="stat-line bonus-stat">+${val} ${this.formatStatName(key)}</div>`)
        .join('')
      : '';

    // Augment effects
    const augments = item.augments || [];
    const augmentsHtml = augments.length > 0
      ? `<div class="item-augments">
          ${augments.map(a => `<div class="augment-effect">${this.formatAugmentEffect(a)}</div>`).join('')}
         </div>`
      : '';

    // Material info for equipment
    const materialHtml = item.material
      ? `<div class="item-material">${this.capitalize(item.material)}</div>`
      : '';

    let actionsHtml = '';
    if (isEquipped) {
      actionsHtml = `<button class="btn btn-secondary btn-sm" data-action="unequip" data-slot="${slot}">Unequip</button>`;
    } else {
      if (this.isEquippable(item.type)) {
        actionsHtml += `<button class="btn btn-primary btn-sm" data-action="equip" data-instance="${item.instanceId}">Equip</button>`;
      }
      if (item.type === 'consumable') {
        actionsHtml += `<button class="btn btn-secondary btn-sm" data-action="use" data-instance="${item.instanceId}">Use</button>`;
      }
      actionsHtml += `<button class="btn btn-danger btn-sm" data-action="discard" data-instance="${item.instanceId}">Discard</button>`;
    }

    // Get detail icon (sprite or emoji)
    const detailIconHtml = this.getDetailIconHtml(item);

    detailsEl.innerHTML = `
      ${detailIconHtml}
      <div class="item-name ${item.rarity || 'common'}">${item.name}</div>
      <div class="item-type">${this.capitalize(item.type)} • ${this.capitalize(item.rarity || 'common')}${materialHtml ? ' • ' + item.material : ''}</div>
      <div class="item-description">${item.description || 'No description'}</div>
      <div class="item-stats">
        ${baseStatsHtml || ''}
        ${bonusStatsHtml}
      </div>
      ${augmentsHtml}
      <div style="clear: both;"></div>
      <div class="item-actions">${actionsHtml}</div>
    `;

    // Bind action buttons
    detailsEl.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => this.handleItemAction(btn.dataset.action, btn.dataset));
    });
  }

  /**
   * Format augment effect for display
   */
  formatAugmentEffect(augment) {
    if (!augment.effect) return augment.name || '';

    const effect = augment.effect;
    switch (effect.type) {
      case 'fire_damage':
      case 'ice_damage':
      case 'lightning_damage':
      case 'holy_damage':
      case 'dark_damage':
        return `+${Math.round(effect.value * 100)}% ${effect.type.replace('_', ' ')}`;
      case 'poison_chance':
      case 'crit_chance':
      case 'block_chance':
        return `+${Math.round(effect.value * 100)}% ${effect.type.replace('_', ' ')}`;
      case 'burn_chance':
      case 'slow_chance':
      case 'stun_chance':
        return `${Math.round(effect.value * 100)}% chance to ${effect.type.split('_')[0]}`;
      case 'lifesteal':
      case 'heal_on_hit':
        return `${Math.round(effect.value * 100)}% ${effect.type.replace('_', ' ')}`;
      case 'damage_bonus':
      case 'physical_attack':
      case 'physical_defense':
      case 'magic_defense':
      case 'damage_reduction':
        return `+${Math.round(effect.value * 100)}% ${effect.type.replace(/_/g, ' ')}`;
      case 'damage_vs':
        return `+${Math.round(effect.value * 100)}% damage vs ${effect.target}`;
      case 'stat_bonus':
        return `${augment.name}`;
      case 'effect_multiplier':
        return `${Math.round((effect.value - 1) * 100)}% stronger effect`;
      case 'hot':
        return `+${effect.value} HP/turn for ${effect.duration} turns`;
      case 'hot_percent':
        return `+${Math.round(effect.value * 100)}% max HP/turn for ${effect.duration} turns`;
      case 'mp_bonus':
        return `+${effect.value} MP restored`;
      case 'mp_regen':
        return `+${effect.value} MP/turn for ${effect.duration} turns`;
      case 'cleanse':
        return effect.targets === 'all' ? 'Cures all debuffs' : `Cures ${effect.targets.join(', ')}`;
      case 'buff':
        return `+${effect.value} ${effect.stat.toUpperCase()} for ${effect.duration} turns`;
      default:
        return augment.name || '';
    }
  }

  /**
   * Get detail icon HTML for item details panel
   */
  getDetailIconHtml(item) {
    const sprite = this.assetLoader?.getItemIcon(item);
    const rarityClass = item.rarity && item.rarity !== 'common' ? `rarity-glow-${item.rarity}` : '';

    if (sprite) {
      return `<img class="detail-icon ${rarityClass}" src="${sprite.src}" alt="${item.name || item.type}" />`;
    }

    // Fallback to large emoji
    const icon = this.getItemIcon(item.type);
    return `<span style="font-size: 36px; float: left; margin-right: 12px;">${icon}</span>`;
  }

  async handleItemAction(action, data) {
    try {
      switch (action) {
        case 'equip':
          await this.equipItem(parseInt(data.instance));
          break;
        case 'unequip':
          await this.unequipItem(data.slot);
          break;
        case 'use':
          await this.useItem(parseInt(data.instance));
          break;
        case 'discard':
          await this.discardItem(parseInt(data.instance));
          break;
      }
    } catch (err) {
      parchmentToast.error('Action Failed', err.message);
    }
  }

  /**
   * Switch to viewing a different character's equipment
   * Shared inventory stays the same, only equipped items change
   */
  async switchCharacter(characterId) {
    this.characterId = characterId;
    this.isLoading = true;
    this.render(); // Show loading state immediately

    try {
      const charData = await this.game.api.getInventory(characterId);
      this.equipped = charData.equipped || {};
      this.isLoading = false;
      this.render();
    } catch (err) {
      console.error('Failed to switch character:', err);
      this.isLoading = false;
      this.render();
      parchmentToast.error('Switch Failed', 'Failed to switch character');
    }
  }

  async equipItem(instanceId) {
    const item = this.inventory.find(i => i.instanceId === instanceId);
    if (!item) return;

    const slot = this.getDefaultSlot(item.type);
    if (!slot) {
      parchmentToast.error('Cannot Equip', 'Cannot equip this item');
      return;
    }

    const result = await this.game.api.equipItem(this.characterId, instanceId, slot);
    this.equipped = result.equipped;
    // Reload shared inventory since item moved from pool to character
    const sharedData = await this.game.api.getSharedInventory();
    this.inventory = sharedData.inventory || [];
    this.render();
    parchmentToast.success('Equipped', `Equipped ${item.name}`);
  }

  async unequipItem(slot) {
    const result = await this.game.api.unequipItem(this.characterId, slot);
    this.equipped = result.equipped;
    // Reload shared inventory since item moved from character to pool
    const sharedData = await this.game.api.getSharedInventory();
    this.inventory = sharedData.inventory || [];
    this.render();
    parchmentToast.success('Unequipped', 'Item unequipped');
  }

  async useItem(instanceId) {
    const item = this.inventory.find(i => i.instanceId === instanceId);
    if (!item) return;

    // Use item from shared pool on selected character
    const result = await this.game.api.useItem(instanceId, this.characterId);
    parchmentToast.success('Used Item', result.message);
    await this.load(this.characterId);
  }

  async discardItem(instanceId) {
    const item = this.inventory.find(i => i.instanceId === instanceId);
    if (!item) return;

    // Use themed confirm dialog instead of native confirm()
    const confirmed = await this.showConfirmDialog(
      'Discard Item',
      `Are you sure you want to discard ${item.name}${item.quantity > 1 ? ` (x${item.quantity})` : ''}? This action cannot be undone.`
    );
    if (!confirmed) return;

    // Discard from shared pool
    await this.game.api.discardItem(instanceId);
    parchmentToast.success('Discarded', 'Item discarded');
    await this.load(this.characterId);
  }

  isEquippable(type) {
    // Must match backend item_type enum: weapon, armor, accessory
    return ['weapon', 'armor', 'accessory'].includes(type);
  }

  getDefaultSlot(type) {
    // Default slot for each item type (used for click-to-equip)
    // Must align with backend item types
    const slotMap = {
      weapon: 'main_hand',
      armor: 'body',
      accessory: 'accessory'
    };
    return slotMap[type];
  }

  formatStatName(stat) {
    const names = {
      hp_restore: 'HP',
      mp_restore: 'MP',
      strength: 'STR',
      vitality: 'VIT',
      agility: 'AGI',
      intelligence: 'INT',
      luck: 'LCK',
      attack: 'ATK',
      defense: 'DEF',
      magic_attack: 'M.ATK',
      magic_defense: 'M.DEF'
    };
    return names[stat] || stat.toUpperCase();
  }

  capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
  }

  /**
   * Get current character's name for display
   */
  getCharacterName() {
    if (!this.characterId || !this.characters.length) return 'Character';
    const char = this.characters.find(c => c.id === this.characterId);
    return char ? char.name : 'Character';
  }

  /**
   * Show themed confirm dialog (replaces native confirm)
   * @returns {Promise<boolean>} True if confirmed, false if cancelled
   */
  showConfirmDialog(title, message) {
    return new Promise((resolve) => {
      // Create modal overlay
      this.confirmModalElement = document.createElement('div');
      this.confirmModalElement.className = 'confirm-modal-overlay';
      this.confirmModalElement.innerHTML = `
        <div class="confirm-modal">
          <div class="confirm-modal-title">${title}</div>
          <div class="confirm-modal-message">${message}</div>
          <div class="confirm-modal-buttons">
            <button class="btn btn-secondary" data-action="cancel">Cancel</button>
            <button class="btn btn-danger" data-action="confirm">Confirm</button>
          </div>
        </div>
      `;

      // Handle button clicks
      const handleClick = (e) => {
        const action = e.target.dataset.action;
        if (action === 'confirm' || action === 'cancel') {
          this.confirmModalElement.remove();
          this.confirmModalElement = null;
          resolve(action === 'confirm');
        }
      };

      // Handle escape key
      const handleKeydown = (e) => {
        if (e.key === 'Escape') {
          this.confirmModalElement.remove();
          this.confirmModalElement = null;
          document.removeEventListener('keydown', handleKeydown);
          resolve(false);
        }
      };

      this.confirmModalElement.addEventListener('click', handleClick);
      document.addEventListener('keydown', handleKeydown);

      document.body.appendChild(this.confirmModalElement);

      // Focus the confirm button for keyboard accessibility
      this.confirmModalElement.querySelector('[data-action="confirm"]').focus();
    });
  }

  destroy() {
    this.hideTooltip();
    if (this.confirmModalElement) {
      this.confirmModalElement.remove();
      this.confirmModalElement = null;
    }
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
  }
}
