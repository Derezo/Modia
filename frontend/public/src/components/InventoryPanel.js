export class InventoryPanel {
  constructor(game, container) {
    this.game = game;
    this.container = container;
    this.characterId = null;
    this.equipped = {};
    this.inventory = [];
    this.selectedItem = null;
    this.element = null;
  }

  async load(characterId) {
    this.characterId = characterId;
    try {
      const data = await this.game.api.getInventory(characterId);
      this.equipped = data.equipped || {};
      this.inventory = data.inventory || [];
      this.render();
    } catch (err) {
      console.error('Failed to load inventory:', err);
      this.game.showNotification('Failed to load inventory', 'error');
    }
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
          ${this.renderEquipmentSlot('body', 'Armor')}
          ${this.renderEquipmentSlot('off_hand', 'Shield')}
          <div></div>
          ${this.renderEquipmentSlot('feet', 'Boots')}
          <div></div>
          ${this.renderEquipmentSlot('accessory1', 'Acc 1')}
          <div></div>
          ${this.renderEquipmentSlot('accessory2', 'Acc 2')}
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
    const icon = item ? this.getItemIcon(item.type) : '';
    const filledClass = item ? 'filled' : '';
    return `
      <div class="equipment-slot ${filledClass}" data-slot="${slot}" data-equipped="true">
        <span class="item-icon">${icon}</span>
        <span class="slot-label">${label}</span>
      </div>
    `;
  }

  renderInventorySlot(item, index) {
    const icon = this.getItemIcon(item.type);
    const quantity = item.quantity > 1 ? `<span class="quantity">x${item.quantity}</span>` : '';
    return `
      <div class="inventory-slot" data-index="${index}" data-instance-id="${item.instanceId}">
        <span class="item-icon">${icon}</span>
        ${quantity}
      </div>
    `;
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

    // Inventory slots
    this.element.querySelectorAll('.inventory-slot:not(.empty)').forEach(slot => {
      slot.addEventListener('click', () => this.handleInventorySlotClick(slot));
    });
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

    detailsEl.innerHTML = `
      <div class="item-name ${item.rarity || 'common'}">${item.name}</div>
      <div class="item-type">${this.capitalize(item.type)} • ${this.capitalize(item.rarity || 'common')}</div>
      <div class="item-description">${item.description || 'No description'}</div>
      <div class="item-stats">${statsHtml || 'No stats'}</div>
      <div class="item-actions">${actionsHtml}</div>
    `;

    // Bind action buttons
    detailsEl.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => this.handleItemAction(btn.dataset.action, btn.dataset));
    });
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
    return ['weapon', 'shield', 'helmet', 'armor', 'boots', 'accessory', 'ring', 'necklace'].includes(type);
  }

  getDefaultSlot(type) {
    const slotMap = {
      weapon: 'main_hand',
      shield: 'off_hand',
      helmet: 'head',
      armor: 'body',
      boots: 'feet',
      accessory: 'accessory1',
      ring: 'accessory1',
      necklace: 'accessory1'
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
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
  }
}
