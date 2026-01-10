/**
 * BattleContextMenu - FFT-style context menu for battle
 *
 * Features:
 * - Appears at click position (constrained to screen)
 * - Menu items: Move (M), Attack (A), Skill > (S), Item > (I), Wait (W)
 * - Submenus expand to side for Skills/Items
 * - Keyboard navigation (arrows, enter, escape)
 * - Click outside dismisses
 */
export class BattleContextMenu {
  constructor(game) {
    this.game = game;
    this.element = null;
    this.isVisible = false;

    // State
    this.canMove = true;
    this.canAct = true;
    this.currentUnitMp = 0;
    this.selectedIndex = 0;

    // Callbacks
    this.callbacks = {};

    // Submenu state
    this.submenuOpen = false;
    this.submenuType = null;
    this.submenuElement = null;

    // Menu items configuration
    this.menuItems = [
      { id: 'move', label: 'Move', key: 'M', color: '#4a90d9', requiresMove: true },
      { id: 'attack', label: 'Attack', key: 'A', color: '#d94a4a', requiresAct: true },
      { id: 'skill', label: 'Skill', key: 'S', color: '#9c27b0', requiresAct: true, hasSubmenu: true },
      { id: 'item', label: 'Item', key: 'I', color: '#4caf50', requiresAct: true, hasSubmenu: true },
      { id: 'wait', label: 'Wait', key: 'W', color: '#607d8b' }
    ];

    // Bound handlers for cleanup
    this.boundKeydownHandler = this.handleKeydown.bind(this);
    this.boundClickOutsideHandler = this.handleClickOutside.bind(this);
  }

  /**
   * Create the context menu DOM
   */
  create(callbacks = {}) {
    this.callbacks = callbacks;
    this.addStyles();

    this.element = document.createElement('div');
    this.element.id = 'battle-context-menu';
    this.element.className = 'battle-context-menu';
    this.element.style.display = 'none';

    this.game.uiOverlay.appendChild(this.element);
  }

  /**
   * Add styles to document
   */
  addStyles() {
    if (document.getElementById('battle-context-menu-styles')) return;

    const style = document.createElement('style');
    style.id = 'battle-context-menu-styles';
    style.textContent = `
      /* Parchment-themed context menu */
      .battle-context-menu {
        position: absolute;
        z-index: 150;
        pointer-events: auto;
        min-width: 140px;
        background: linear-gradient(to bottom, #d4c4a8 0%, #c9b899 50%, #bfae8a 100%);
        border: 2px solid #8b7355;
        border-radius: 4px;
        box-shadow:
          0 3px 8px rgba(0, 0, 0, 0.3),
          inset 0 1px 0 rgba(255, 255, 255, 0.3),
          inset 0 -1px 0 rgba(0, 0, 0, 0.1);
        font-family: 'Georgia', 'Times New Roman', serif;
        overflow: hidden;
      }

      .context-menu-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        cursor: pointer;
        transition: background 0.15s ease;
        border-left: 3px solid transparent;
      }

      .context-menu-item:hover:not(.disabled),
      .context-menu-item.selected:not(.disabled) {
        background: rgba(139, 115, 85, 0.2);
      }

      .context-menu-item.disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .context-menu-item.disabled .item-label {
        text-decoration: line-through;
      }

      .context-menu-item[data-action="move"]:hover:not(.disabled),
      .context-menu-item[data-action="move"].selected:not(.disabled) {
        border-left-color: #4080a0;
        background: rgba(64, 128, 160, 0.15);
      }

      .context-menu-item[data-action="attack"]:hover:not(.disabled),
      .context-menu-item[data-action="attack"].selected:not(.disabled) {
        border-left-color: #8b4444;
        background: rgba(139, 68, 68, 0.15);
      }

      .context-menu-item[data-action="skill"]:hover:not(.disabled),
      .context-menu-item[data-action="skill"].selected:not(.disabled) {
        border-left-color: #6b4488;
        background: rgba(107, 68, 136, 0.15);
      }

      .context-menu-item[data-action="item"]:hover:not(.disabled),
      .context-menu-item[data-action="item"].selected:not(.disabled) {
        border-left-color: #448844;
        background: rgba(68, 136, 68, 0.15);
      }

      .context-menu-item[data-action="wait"]:hover:not(.disabled),
      .context-menu-item[data-action="wait"].selected:not(.disabled) {
        border-left-color: #6b5344;
        background: rgba(107, 83, 68, 0.15);
      }

      .item-left {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .item-label {
        font-size: 13px;
        font-weight: bold;
        color: #2d2418;
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      .item-key {
        font-size: 11px;
        font-family: 'Consolas', 'Monaco', monospace;
        color: #5a4a3a;
        background: rgba(139, 115, 85, 0.2);
        padding: 2px 6px;
        border-radius: 3px;
        border: 1px solid rgba(139, 115, 85, 0.3);
      }

      .item-arrow {
        font-size: 10px;
        color: #5a4a3a;
        margin-left: 8px;
      }

      .context-menu-divider {
        height: 1px;
        background: #8b7355;
        margin: 4px 8px;
        opacity: 0.4;
      }

      /* Parchment-themed submenu */
      .context-submenu {
        position: absolute;
        top: 0;
        min-width: 180px;
        max-width: 240px;
        max-height: 280px;
        background: linear-gradient(to bottom, #d4c4a8 0%, #c9b899 50%, #bfae8a 100%);
        border: 2px solid #8b7355;
        border-radius: 4px;
        box-shadow:
          0 3px 8px rgba(0, 0, 0, 0.3),
          inset 0 1px 0 rgba(255, 255, 255, 0.3);
        overflow: hidden;
        animation: submenu-slide 0.12s ease-out;
      }

      .context-submenu.left {
        right: 100%;
        margin-right: 4px;
      }

      .context-submenu.right {
        left: 100%;
        margin-left: 4px;
      }

      @keyframes submenu-slide {
        from { opacity: 0; transform: translateX(-8px); }
        to { opacity: 1; transform: translateX(0); }
      }

      .context-submenu.left {
        animation-name: submenu-slide-left;
      }

      @keyframes submenu-slide-left {
        from { opacity: 0; transform: translateX(8px); }
        to { opacity: 1; transform: translateX(0); }
      }

      .submenu-header {
        padding: 8px 12px;
        font-size: 11px;
        font-weight: bold;
        color: #2d2418;
        text-transform: uppercase;
        letter-spacing: 1px;
        background: linear-gradient(to bottom, #c9b899 0%, #bfae8a 100%);
        border-bottom: 1px solid #8b7355;
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      .submenu-content {
        max-height: 230px;
        overflow-y: auto;
      }

      .submenu-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        cursor: pointer;
        transition: background 0.15s ease;
      }

      .submenu-item:hover:not(.disabled) {
        background: rgba(139, 115, 85, 0.2);
      }

      .submenu-item.disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .submenu-item-icon {
        font-size: 16px;
        width: 24px;
        text-align: center;
      }

      .submenu-item-info {
        flex: 1;
        min-width: 0;
      }

      .submenu-item-name {
        font-size: 12px;
        font-weight: bold;
        color: #2d2418;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .submenu-item-cost {
        font-size: 11px;
        color: #4080a0;
        font-weight: bold;
        white-space: nowrap;
      }

      .submenu-item-cost.insufficient {
        color: #8b4444;
      }

      .submenu-empty {
        padding: 16px;
        text-align: center;
        color: #7a6a5a;
        font-size: 11px;
        font-style: italic;
      }

      /* Mobile: Convert to bottom sheet with parchment style */
      @media (max-width: 768px) {
        .battle-context-menu {
          position: fixed !important;
          bottom: 0 !important;
          left: 0 !important;
          right: 0 !important;
          top: auto !important;
          min-width: 100%;
          max-height: 60vh;
          border-radius: 12px 12px 0 0;
          border-bottom: none;
          animation: sheet-slide-up 0.2s ease-out;
        }

        @keyframes sheet-slide-up {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }

        .context-menu-item {
          padding: 16px 20px;
          min-height: 50px;
          border-left-width: 4px;
        }

        .item-label {
          font-size: 16px;
        }

        .item-key {
          font-size: 12px;
          padding: 4px 8px;
        }

        .context-submenu {
          position: fixed !important;
          bottom: 0 !important;
          left: 0 !important;
          right: 0 !important;
          top: auto !important;
          min-width: 100%;
          max-width: 100%;
          max-height: 70vh;
          border-radius: 12px 12px 0 0;
          animation: sheet-slide-up 0.2s ease-out;
        }

        .submenu-item {
          padding: 14px 20px;
          min-height: 50px;
        }

        .submenu-item-icon {
          font-size: 20px;
          width: 28px;
        }

        .submenu-item-name {
          font-size: 15px;
        }

        .submenu-item-cost {
          font-size: 13px;
        }

        .submenu-header {
          padding: 12px 20px;
          font-size: 13px;
        }

        /* Handle bar for bottom sheet */
        .battle-context-menu::before {
          content: '';
          display: block;
          width: 40px;
          height: 4px;
          background: #8b7355;
          border-radius: 2px;
          margin: 10px auto 6px;
          opacity: 0.5;
        }

        .context-submenu::before {
          content: '';
          display: block;
          width: 40px;
          height: 4px;
          background: #8b7355;
          border-radius: 2px;
          margin: 10px auto 6px;
          opacity: 0.5;
        }
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Generate menu HTML
   */
  generateMenuHTML() {
    let html = '';

    this.menuItems.forEach((item, index) => {
      const disabled = (item.requiresMove && !this.canMove) ||
                       (item.requiresAct && !this.canAct);
      const selected = index === this.selectedIndex;

      // Add divider before Wait
      if (item.id === 'wait') {
        html += '<div class="context-menu-divider"></div>';
      }

      html += `
        <div class="context-menu-item ${disabled ? 'disabled' : ''} ${selected ? 'selected' : ''}"
             data-action="${item.id}" data-index="${index}">
          <div class="item-left">
            <span class="item-label">${item.label}</span>
          </div>
          <div class="item-right">
            <span class="item-key">${item.key}</span>
            ${item.hasSubmenu ? '<span class="item-arrow">▶</span>' : ''}
          </div>
        </div>
      `;
    });

    return html;
  }

  /**
   * Show the context menu at position
   */
  show(screenX, screenY, canMove = true, canAct = true, mp = 0) {
    this.canMove = canMove;
    this.canAct = canAct;
    this.currentUnitMp = mp;
    this.selectedIndex = 0;
    this.closeSubmenu();

    // Generate menu content
    this.element.innerHTML = this.generateMenuHTML();
    this.setupMenuEventListeners();

    // Position menu (constrain to screen)
    this.element.style.display = 'block';
    const rect = this.element.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x = screenX;
    let y = screenY;

    // Constrain horizontally
    if (x + rect.width > viewportWidth - 10) {
      x = viewportWidth - rect.width - 10;
    }
    if (x < 10) x = 10;

    // Constrain vertically
    if (y + rect.height > viewportHeight - 10) {
      y = viewportHeight - rect.height - 10;
    }
    if (y < 10) y = 10;

    this.element.style.left = `${x}px`;
    this.element.style.top = `${y}px`;

    this.isVisible = true;

    // Add event listeners
    document.addEventListener('keydown', this.boundKeydownHandler);
    setTimeout(() => {
      document.addEventListener('click', this.boundClickOutsideHandler);
    }, 50);
  }

  /**
   * Hide the context menu
   */
  hide() {
    this.isVisible = false;
    this.element.style.display = 'none';
    this.closeSubmenu();

    document.removeEventListener('keydown', this.boundKeydownHandler);
    document.removeEventListener('click', this.boundClickOutsideHandler);
  }

  /**
   * Setup menu item event listeners
   */
  setupMenuEventListeners() {
    this.element.querySelectorAll('.context-menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        if (item.classList.contains('disabled')) return;

        const action = item.dataset.action;
        this.handleActionClick(action);
      });

      item.addEventListener('mouseenter', () => {
        const index = parseInt(item.dataset.index);
        this.selectedIndex = index;
        this.updateSelection();

        // Show submenu on hover for skill/item
        const action = item.dataset.action;
        if ((action === 'skill' || action === 'item') && !item.classList.contains('disabled')) {
          this.showSubmenu(action, item);
        } else {
          this.closeSubmenu();
        }
      });
    });
  }

  /**
   * Update visual selection
   */
  updateSelection() {
    this.element.querySelectorAll('.context-menu-item').forEach((item, index) => {
      item.classList.toggle('selected', index === this.selectedIndex);
    });
  }

  /**
   * Handle action click
   */
  handleActionClick(action) {
    switch (action) {
      case 'move':
        if (this.canMove) {
          this.hide();
          this.callbacks.onMove?.();
        }
        break;
      case 'attack':
        if (this.canAct) {
          this.hide();
          this.callbacks.onAttack?.();
        }
        break;
      case 'skill':
        if (this.canAct) {
          const item = this.element.querySelector('[data-action="skill"]');
          this.showSubmenu('skill', item);
        }
        break;
      case 'item':
        if (this.canAct) {
          const item = this.element.querySelector('[data-action="item"]');
          this.showSubmenu('item', item);
        }
        break;
      case 'wait':
        this.hide();
        this.callbacks.onWait?.();
        break;
    }
  }

  /**
   * Show submenu for skills or items
   */
  showSubmenu(type, parentItem) {
    if (this.submenuType === type && this.submenuOpen) return;

    this.closeSubmenu();
    this.submenuType = type;
    this.submenuOpen = true;

    this.submenuElement = document.createElement('div');
    this.submenuElement.className = 'context-submenu';

    // Determine submenu position (left or right based on space)
    const menuRect = this.element.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const expandRight = menuRect.right + 200 < viewportWidth;

    this.submenuElement.classList.add(expandRight ? 'right' : 'left');

    // Position submenu relative to parent item
    const itemRect = parentItem.getBoundingClientRect();
    const menuTop = this.element.getBoundingClientRect().top;
    this.submenuElement.style.top = `${itemRect.top - menuTop}px`;

    // Generate submenu content
    if (type === 'skill') {
      this.submenuElement.innerHTML = this.generateSkillSubmenuHTML();
    } else if (type === 'item') {
      this.submenuElement.innerHTML = this.generateItemSubmenuHTML();
    }

    this.element.appendChild(this.submenuElement);
    this.setupSubmenuEventListeners();
  }

  /**
   * Close submenu
   */
  closeSubmenu() {
    if (this.submenuElement && this.submenuElement.parentNode) {
      this.submenuElement.parentNode.removeChild(this.submenuElement);
    }
    this.submenuElement = null;
    this.submenuType = null;
    this.submenuOpen = false;
  }

  /**
   * Generate skill submenu HTML
   */
  generateSkillSubmenuHTML() {
    const skills = this.callbacks.getSkills?.() || [];

    if (skills.length === 0) {
      return `
        <div class="submenu-header">Skills</div>
        <div class="submenu-empty">No skills available</div>
      `;
    }

    let html = '<div class="submenu-header">Skills</div><div class="submenu-content">';

    skills.forEach(skill => {
      const canUse = this.currentUnitMp >= skill.mpCost;
      const icon = this.getSkillIcon(skill);

      html += `
        <div class="submenu-item ${canUse ? '' : 'disabled'}" data-skill-id="${skill.id}">
          <span class="submenu-item-icon">${icon}</span>
          <div class="submenu-item-info">
            <div class="submenu-item-name">${skill.name}</div>
          </div>
          <span class="submenu-item-cost ${canUse ? '' : 'insufficient'}">${skill.mpCost}MP</span>
        </div>
      `;
    });

    html += '</div>';
    return html;
  }

  /**
   * Generate item submenu HTML
   */
  generateItemSubmenuHTML() {
    const items = this.callbacks.getItems?.() || [];

    if (items.length === 0) {
      return `
        <div class="submenu-header">Items</div>
        <div class="submenu-empty">No items available</div>
      `;
    }

    let html = '<div class="submenu-header">Items</div><div class="submenu-content">';

    items.forEach(item => {
      const icon = this.getItemIcon(item);

      html += `
        <div class="submenu-item" data-item-id="${item.itemId}" data-inventory-id="${item.inventoryId}">
          <span class="submenu-item-icon">${icon}</span>
          <div class="submenu-item-info">
            <div class="submenu-item-name">${item.name}</div>
          </div>
          <span class="submenu-item-cost">x${item.quantity || 1}</span>
        </div>
      `;
    });

    html += '</div>';
    return html;
  }

  /**
   * Setup submenu event listeners
   */
  setupSubmenuEventListeners() {
    if (!this.submenuElement) return;

    this.submenuElement.querySelectorAll('.submenu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        if (item.classList.contains('disabled')) return;

        const skillId = item.dataset.skillId;
        const itemId = item.dataset.itemId;
        const inventoryId = item.dataset.inventoryId;

        this.hide();

        if (skillId) {
          this.callbacks.onSkillSelect?.(skillId);
        } else if (itemId) {
          this.callbacks.onItemSelect?.({ itemId, inventoryId });
        }
      });
    });
  }

  /**
   * Get icon for skill
   */
  getSkillIcon(skill) {
    const typeIcons = {
      fire: '🔥', ice: '❄️', lightning: '⚡', earth: '🪨',
      wind: '💨', water: '💧', holy: '✨', dark: '🌑',
      physical: '⚔️', heal: '💚', buff: '⬆️', debuff: '⬇️'
    };
    return typeIcons[skill.element] || typeIcons[skill.type] || '✦';
  }

  /**
   * Get icon for item
   */
  getItemIcon(item) {
    const typeIcons = {
      potion: '🧪', ether: '💎', antidote: '🍃',
      phoenix: '🔥', elixir: '⭐', bomb: '💣', food: '🍖'
    };
    return typeIcons[item.type] || '⚗️';
  }

  /**
   * Handle keyboard navigation
   */
  handleKeydown(e) {
    if (!this.isVisible) return;

    const key = e.key.toLowerCase();

    // If submenu is open, handle differently
    if (this.submenuOpen) {
      if (key === 'escape' || key === 'arrowleft') {
        e.preventDefault();
        this.closeSubmenu();
        return;
      }
    }

    switch (key) {
      case 'arrowup':
        e.preventDefault();
        this.navigateMenu(-1);
        break;
      case 'arrowdown':
        e.preventDefault();
        this.navigateMenu(1);
        break;
      case 'arrowright':
      case 'enter':
        e.preventDefault();
        this.selectCurrentItem();
        break;
      case 'escape':
        e.preventDefault();
        this.hide();
        this.callbacks.onCancel?.();
        break;
      case 'm':
        if (this.canMove) {
          e.preventDefault();
          this.handleActionClick('move');
        }
        break;
      case 'a':
        if (this.canAct) {
          e.preventDefault();
          this.handleActionClick('attack');
        }
        break;
      case 's':
        if (this.canAct) {
          e.preventDefault();
          this.handleActionClick('skill');
        }
        break;
      case 'i':
        if (this.canAct) {
          e.preventDefault();
          this.handleActionClick('item');
        }
        break;
      case 'w':
        e.preventDefault();
        this.handleActionClick('wait');
        break;
    }
  }

  /**
   * Navigate menu with arrow keys
   */
  navigateMenu(direction) {
    const items = this.element.querySelectorAll('.context-menu-item:not(.disabled)');
    if (items.length === 0) return;

    // Find current position among enabled items
    let enabledIndices = [];
    this.element.querySelectorAll('.context-menu-item').forEach((item, index) => {
      if (!item.classList.contains('disabled')) {
        enabledIndices.push(index);
      }
    });

    let currentPos = enabledIndices.indexOf(this.selectedIndex);
    if (currentPos === -1) currentPos = 0;

    currentPos += direction;
    if (currentPos < 0) currentPos = enabledIndices.length - 1;
    if (currentPos >= enabledIndices.length) currentPos = 0;

    this.selectedIndex = enabledIndices[currentPos];
    this.updateSelection();
    this.closeSubmenu();
  }

  /**
   * Select current menu item
   */
  selectCurrentItem() {
    const item = this.menuItems[this.selectedIndex];
    if (!item) return;

    const disabled = (item.requiresMove && !this.canMove) ||
                     (item.requiresAct && !this.canAct);
    if (disabled) return;

    this.handleActionClick(item.id);
  }

  /**
   * Handle click outside menu
   */
  handleClickOutside(e) {
    if (!this.isVisible) return;

    if (this.element && !this.element.contains(e.target)) {
      this.hide();
      this.callbacks.onCancel?.();
    }
  }

  /**
   * Clean up resources
   */
  destroy() {
    document.removeEventListener('keydown', this.boundKeydownHandler);
    document.removeEventListener('click', this.boundClickOutsideHandler);

    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}
