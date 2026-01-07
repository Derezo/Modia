export class InventoryPanel {
  constructor(game, container) {
    this.game = game;
    this.container = container;
    this.characterId = null;
    this.equipped = {};
    this.inventory = [];
    this.selectedItem = null;
    this.element = null;
    this.characterStats = null; // For stat comparison
    this.tooltipElement = null;

    // Asset loader for item sprites
    this.assetLoader = game.assetLoader || null;
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
      const data = await this.game.api.getInventory(characterId);
      this.equipped = data.equipped || {};
      this.inventory = data.inventory || [];

      // Preload item sprites in background
      this.preloadItemSprites();

      this.render();
    } catch (err) {
      console.error('Failed to load inventory:', err);
      this.game.showNotification('Failed to load inventory', 'error');
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
          background: rgba(0, 0, 0, 0.4);
          border: 2px solid #3a3a5a;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          position: relative;
        }
        .equipment-slot:hover {
          border-color: #6ab0f3;
        }
        .equipment-slot.filled {
          border-color: #4a90d9;
        }
        .equipment-slot .slot-label {
          position: absolute;
          bottom: 2px;
          font-size: 8px;
          color: #8a8aaa;
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
          background: rgba(20, 20, 40, 0.95);
          border: 2px solid #4a4a6a;
          border-radius: 8px;
          padding: 12px;
          min-width: 200px;
          max-width: 280px;
          z-index: 1000;
          pointer-events: none;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
        }
        .tooltip-item-name {
          font-weight: bold;
          margin-bottom: 8px;
          font-size: 14px;
        }
        .tooltip-item-name.common { color: #ccc; }
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
        }
        .stat-positive { color: #4caf50; }
        .stat-negative { color: #f44336; }
        .stat-neutral { color: #8a8aaa; }
        .tooltip-comparison {
          border-top: 1px solid #3a3a5a;
          padding-top: 8px;
          margin-top: 8px;
          font-size: 11px;
          color: #8a8aaa;
        }
        .comparison-header {
          font-weight: bold;
          margin-bottom: 4px;
          color: #ffd700;
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
          background: rgba(0, 0, 0, 0.3);
          border: 2px solid #2a2a4a;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          position: relative;
        }
        .inventory-slot:hover {
          border-color: #6ab0f3;
        }
        .inventory-slot.selected {
          border-color: #ffd700;
          background: rgba(255, 215, 0, 0.1);
        }
        .inventory-slot .quantity {
          position: absolute;
          bottom: 2px;
          right: 4px;
          font-size: 10px;
          color: #fff;
          text-shadow: 1px 1px 1px #000;
        }
        .item-details {
          margin-top: 12px;
          padding: 12px;
          background: rgba(0, 0, 0, 0.3);
          border-radius: 4px;
          min-height: 120px;
        }
        .item-name {
          font-weight: bold;
          margin-bottom: 8px;
        }
        .item-name.common { color: #ccc; }
        .item-name.uncommon { color: #1eff00; }
        .item-name.rare { color: #0070dd; }
        .item-name.epic { color: #a335ee; }
        .item-name.legendary { color: #ff8000; }
        .item-type {
          font-size: 12px;
          color: #8a8aaa;
          margin-bottom: 8px;
        }
        .item-description {
          font-size: 12px;
          color: #aaa;
          margin-bottom: 8px;
        }
        .item-stats {
          font-size: 11px;
          color: #4a90d9;
        }
        .item-actions {
          margin-top: 12px;
          display: flex;
          gap: 8px;
        }
        .section-title {
          font-weight: bold;
          color: #ffd700;
          margin-bottom: 8px;
          font-size: 14px;
        }
      </style>

      <div class="equipment-section">
        <div class="section-title">Equipment</div>
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
        <div class="section-title">Inventory (${this.inventory.length} items)</div>
        <div class="inventory-grid">
          ${this.inventory.map((item, idx) => this.renderInventorySlot(item, idx)).join('')}
          ${this.renderEmptySlots(24 - this.inventory.length)}
        </div>
        <div class="item-details" id="item-details">
          <div style="color: #8a8aaa; text-align: center;">Select an item to view details</div>
        </div>
      </div>
    `;

    this.container.appendChild(this.element);
    this.setupEventListeners();
  }

  renderEquipmentSlot(slot, label) {
    const item = this.equipped[slot];
    const filledClass = item ? 'filled' : '';
    const iconHtml = item ? this.getItemIconHtml(item, 'equipment') : '';
    return `
      <div class="equipment-slot ${filledClass}" data-slot="${slot}" data-equipped="true">
        ${iconHtml}
        <span class="slot-label">${label}</span>
      </div>
    `;
  }

  renderInventorySlot(item, index) {
    const iconHtml = this.getItemIconHtml(item, 'inventory');
    const quantity = item.quantity > 1 ? `<span class="quantity">x${item.quantity}</span>` : '';
    return `
      <div class="inventory-slot" data-index="${index}" data-instance-id="${item.instanceId}">
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
    const icons = {
      weapon: '⚔️',
      shield: '🛡️',
      helmet: '🪖',
      armor: '🎽',
      boots: '👢',
      accessory: '💍',
      ring: '💍',
      necklace: '📿',
      consumable: '🧪',
      material: '📦',
      key: '🔑'
    };
    return icons[type] || '❓';
  }

  setupEventListeners() {
    // Equipment slots
    this.element.querySelectorAll('.equipment-slot').forEach(slot => {
      slot.addEventListener('click', () => this.handleEquipmentSlotClick(slot));
    });

    // Inventory slots - click and hover for tooltips
    this.element.querySelectorAll('.inventory-slot:not(.empty)').forEach(slot => {
      slot.addEventListener('click', () => this.handleInventorySlotClick(slot));
      slot.addEventListener('mouseenter', (e) => this.showStatComparisonTooltip(e, slot));
      slot.addEventListener('mouseleave', () => this.hideTooltip());
      slot.addEventListener('mousemove', (e) => this.updateTooltipPosition(e));
    });
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
    html += `<div style="font-size: 11px; color: #8a8aaa; margin-bottom: 8px;">${this.capitalize(item.type)} - ${this.capitalize(item.rarity || 'common')}</div>`;

    // Item stats
    const itemStats = item.baseStats || {};
    if (Object.keys(itemStats).length > 0) {
      html += '<div class="tooltip-stats">';
      for (const [stat, value] of Object.entries(itemStats)) {
        html += `<div class="tooltip-stat-row"><span>${this.formatStatName(stat)}</span><span class="stat-positive">+${value}</span></div>`;
      }
      html += '</div>';
    }

    // Comparison with equipped item
    if (currentEquipped) {
      const equippedStats = currentEquipped.baseStats || {};
      const comparison = this.calculateStatComparison(itemStats, equippedStats);

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
      html += '<div class="tooltip-comparison"><div style="color: #4caf50;">Slot is empty - equip for these stats</div></div>';
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
    const stats = item.baseStats || {};
    const statsHtml = Object.entries(stats)
      .map(([key, val]) => `<div>+${val} ${this.formatStatName(key)}</div>`)
      .join('');

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
      <div class="item-type">${this.capitalize(item.type)} • ${this.capitalize(item.rarity || 'common')}</div>
      <div class="item-description">${item.description || 'No description'}</div>
      <div class="item-stats">${statsHtml || 'No stats'}</div>
      <div style="clear: both;"></div>
      <div class="item-actions">${actionsHtml}</div>
    `;

    // Bind action buttons
    detailsEl.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => this.handleItemAction(btn.dataset.action, btn.dataset));
    });
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
      this.game.showNotification(err.message, 'error');
    }
  }

  async equipItem(instanceId) {
    const item = this.inventory.find(i => i.instanceId === instanceId);
    if (!item) return;

    const slot = this.getDefaultSlot(item.type);
    if (!slot) {
      this.game.showNotification('Cannot equip this item', 'error');
      return;
    }

    const result = await this.game.api.equipItem(this.characterId, instanceId, slot);
    this.equipped = result.equipped;
    this.inventory = result.inventory;
    this.render();
    this.game.showNotification(`Equipped ${item.name}`, 'success');
  }

  async unequipItem(slot) {
    const result = await this.game.api.unequipItem(this.characterId, slot);
    this.equipped = result.equipped;
    this.inventory = result.inventory;
    this.render();
    this.game.showNotification('Item unequipped', 'success');
  }

  async useItem(instanceId) {
    const item = this.inventory.find(i => i.instanceId === instanceId);
    if (!item) return;

    const result = await this.game.api.useItem(this.characterId, instanceId);
    this.game.showNotification(result.message, 'success');
    await this.load(this.characterId);
  }

  async discardItem(instanceId) {
    const item = this.inventory.find(i => i.instanceId === instanceId);
    if (!item) return;

    if (!confirm(`Discard ${item.name}?`)) return;

    await this.game.api.discardItem(this.characterId, instanceId);
    this.game.showNotification('Item discarded', 'success');
    await this.load(this.characterId);
  }

  isEquippable(type) {
    return ['weapon', 'shield', 'helmet', 'armor', 'legs', 'boots', 'accessory', 'ring', 'necklace'].includes(type);
  }

  getDefaultSlot(type) {
    const slotMap = {
      weapon: 'main_hand',
      shield: 'off_hand',
      helmet: 'head',
      armor: 'body',
      legs: 'legs',
      boots: 'feet',
      accessory: 'accessory',
      ring: 'accessory',
      necklace: 'accessory'
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

  destroy() {
    this.hideTooltip();
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
  }
}
