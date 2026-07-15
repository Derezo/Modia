/**
 * BattleActionBar - Persistent bottom action bar for battle
 *
 * Features:
 * - Always visible during player turn
 * - Buttons: MOVE, ATTACK, SKILL (dropdown), ITEM (dropdown), WAIT
 * - Turn state indicator showing remaining actions
 * - Visual states: available, used, disabled
 * - Keyboard shortcuts: M, A, S, I, W
 */
import { escapeHtml, escapeHtmlAttribute } from '../utils/escapeHtml.js';
import { renderBattleItemIcon } from './BattleItemIcon.js';
import { renderAbilityIcon } from './AbilityIcon.js';

export class BattleActionBar {
  constructor(game) {
    this.game = game;
    this.element = null;
    this.isVisible = false;

    // State
    this.canMove = true;
    this.canAct = true;
    this.currentUnitMp = 0;

    // Callbacks
    this.callbacks = {};

    // Dropdown state
    this.activeDropdown = null;

    // Bound handlers for cleanup
    this.boundKeydownHandler = this.handleKeydown.bind(this);
    this.boundClickOutsideHandler = this.handleClickOutside.bind(this);
  }

  /**
   * Create the action bar DOM
   */
  create(callbacks = {}) {
    this.callbacks = callbacks;
    this.addStyles();

    this.element = document.createElement('div');
    this.element.id = 'battle-action-bar';
    this.element.className = 'battle-action-bar';
    this.element.innerHTML = this.generateHTML();

    this.game.uiOverlay.appendChild(this.element);
    this.setupEventListeners();
    this.hide(); // Hidden by default until player turn
  }

  /**
   * Generate HTML for the action bar
   */
  generateHTML() {
    return `
      <div class="action-bar-container">
        <div class="turn-state-indicator">
          <span class="turn-state-text">Your Turn</span>
          <div class="action-pips">
            <span class="pip pip-move" data-action="move" title="Move action"></span>
            <span class="pip pip-act" data-action="act" title="Action"></span>
          </div>
        </div>

        <div class="action-buttons">
          <button class="action-btn" data-action="move" title="Move (M)">
            <span class="btn-icon">↗</span>
            <span class="btn-label">Move</span>
            <span class="btn-key">M</span>
          </button>

          <button class="action-btn" data-action="attack" title="Attack (A)">
            <span class="btn-icon">⚔</span>
            <span class="btn-label">Attack</span>
            <span class="btn-key">A</span>
          </button>

          <button class="action-btn has-dropdown" data-action="skill" title="Skill (S)">
            <span class="btn-icon">✦</span>
            <span class="btn-label">Skill</span>
            <span class="btn-key">S</span>
            <span class="dropdown-arrow">▼</span>
          </button>

          <button class="action-btn has-dropdown" data-action="item" title="Item (I)">
            <span class="btn-icon">⚗</span>
            <span class="btn-label">Item</span>
            <span class="btn-key">I</span>
            <span class="dropdown-arrow">▼</span>
          </button>

          <div class="action-divider"></div>

          <button class="action-btn action-btn-wait" data-action="wait" title="Wait (W)">
            <span class="btn-icon">⏳</span>
            <span class="btn-label">Wait</span>
            <span class="btn-key">W</span>
          </button>
        </div>

        <div class="dropdown-panel" id="skill-dropdown">
          <div class="dropdown-header">Skills</div>
          <div class="dropdown-content" id="skill-list"></div>
        </div>

        <div class="dropdown-panel" id="item-dropdown">
          <div class="dropdown-header">Items</div>
          <div class="dropdown-content" id="item-list"></div>
        </div>
      </div>
    `;
  }

  /**
   * Add styles to document
   */
  addStyles() {
    if (document.getElementById('battle-action-bar-styles')) return;

    const style = document.createElement('style');
    style.id = 'battle-action-bar-styles';
    style.textContent = `
      /* Parchment-themed action bar */
      .battle-action-bar {
        position: fixed;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        z-index: 100;
        pointer-events: auto;
      }

      .action-bar-container {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 8px 16px 12px;
        background: linear-gradient(to bottom, #d4c4a8 0%, #c9b899 50%, #bfae8a 100%);
        border: 2px solid #8b7355;
        border-bottom: none;
        border-radius: 8px 8px 0 0;
        box-shadow:
          0 -4px 16px rgba(0, 0, 0, 0.3),
          inset 0 1px 0 rgba(255, 255, 255, 0.3),
          inset 0 -1px 0 rgba(0, 0, 0, 0.1);
        font-family: 'Georgia', 'Times New Roman', serif;
      }

      .turn-state-indicator {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 8px;
        padding: 4px 12px;
        background: rgba(139, 115, 85, 0.2);
        border: 1px solid rgba(139, 115, 85, 0.3);
        border-radius: 12px;
      }

      .turn-state-text {
        font-size: 12px;
        font-weight: bold;
        color: #2d2418;
        text-transform: uppercase;
        letter-spacing: 1px;
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      .action-pips {
        display: flex;
        gap: 6px;
      }

      .pip {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        border: 2px solid #8b7355;
        background: #f0e8d8;
        transition: all 0.2s ease;
      }

      .pip.available {
        background: #5a9e4a;
        border-color: #4a8c3a;
        box-shadow: 0 0 6px rgba(90, 158, 74, 0.5);
      }

      .pip.used {
        background: #bfae8a;
        border-color: #8b7355;
        opacity: 0.5;
      }

      .pip.pulse {
        animation: pip-pulse 1s ease-in-out infinite;
      }

      @keyframes pip-pulse {
        0%, 100% { transform: scale(1); box-shadow: 0 0 6px rgba(90, 158, 74, 0.5); }
        50% { transform: scale(1.2); box-shadow: 0 0 12px rgba(90, 158, 74, 0.8); }
      }

      .action-buttons {
        display: flex;
        gap: 8px;
        align-items: center;
      }

      .action-btn {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-width: 60px;
        height: 56px;
        padding: 6px 10px;
        background: linear-gradient(to bottom, #c9b899 0%, #bfae8a 100%);
        border: 2px solid #8b7355;
        border-radius: 4px;
        color: #2d2418;
        cursor: pointer;
        transition: all 0.15s ease;
        position: relative;
        box-shadow:
          0 2px 4px rgba(0, 0, 0, 0.2),
          inset 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      .action-btn:hover:not(:disabled) {
        background: linear-gradient(to bottom, #d4c4a8 0%, #c9b899 100%);
        transform: translateY(-2px);
        box-shadow:
          0 4px 8px rgba(0, 0, 0, 0.25),
          inset 0 1px 0 rgba(255, 255, 255, 0.4);
      }

      .action-btn:active:not(:disabled) {
        transform: translateY(0);
        box-shadow:
          0 1px 2px rgba(0, 0, 0, 0.2),
          inset 0 1px 2px rgba(0, 0, 0, 0.1);
      }

      .action-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .action-btn.used {
        opacity: 0.6;
        background: linear-gradient(to bottom, #bfae8a 0%, #b0a080 100%);
      }

      .action-btn.used::after {
        content: '✓';
        position: absolute;
        top: 2px;
        right: 4px;
        font-size: 10px;
        color: #5a9e4a;
      }

      .action-btn[data-action="move"] { border-color: #4080a0; }
      .action-btn[data-action="move"]:hover:not(:disabled) { border-color: #4080a0; background: linear-gradient(to bottom, #d4c4a8 0%, rgba(64, 128, 160, 0.15) 50%, #c9b899 100%); }

      .action-btn[data-action="attack"] { border-color: #8b4444; }
      .action-btn[data-action="attack"]:hover:not(:disabled) { border-color: #8b4444; background: linear-gradient(to bottom, #d4c4a8 0%, rgba(139, 68, 68, 0.15) 50%, #c9b899 100%); }

      .action-btn[data-action="skill"] { border-color: #6b4488; }
      .action-btn[data-action="skill"]:hover:not(:disabled) { border-color: #6b4488; background: linear-gradient(to bottom, #d4c4a8 0%, rgba(107, 68, 136, 0.15) 50%, #c9b899 100%); }

      .action-btn[data-action="item"] { border-color: #448844; }
      .action-btn[data-action="item"]:hover:not(:disabled) { border-color: #448844; background: linear-gradient(to bottom, #d4c4a8 0%, rgba(68, 136, 68, 0.15) 50%, #c9b899 100%); }

      .action-btn-wait { border-color: #6b5344; }
      .action-btn-wait:hover:not(:disabled) { border-color: #6b5344; background: linear-gradient(to bottom, #d4c4a8 0%, rgba(107, 83, 68, 0.15) 50%, #c9b899 100%); }

      .btn-icon {
        font-size: 18px;
        line-height: 1;
      }

      .btn-label {
        font-size: 11px;
        font-weight: bold;
        margin-top: 2px;
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      .btn-key {
        position: absolute;
        bottom: 2px;
        right: 4px;
        font-size: 9px;
        color: #5a4a3a;
        font-family: 'Consolas', 'Monaco', monospace;
      }

      .has-dropdown .dropdown-arrow {
        position: absolute;
        top: 2px;
        right: 4px;
        font-size: 8px;
        color: #5a4a3a;
      }

      .action-divider {
        width: 1px;
        height: 40px;
        background: #8b7355;
        margin: 0 4px;
        opacity: 0.4;
      }

      /* Parchment-themed dropdown */
      .dropdown-panel {
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        min-width: 200px;
        max-width: 280px;
        max-height: 300px;
        margin-bottom: 8px;
        background: linear-gradient(to bottom, #d4c4a8 0%, #c9b899 50%, #bfae8a 100%);
        border: 2px solid #8b7355;
        border-radius: 4px;
        box-shadow:
          0 4px 16px rgba(0, 0, 0, 0.3),
          inset 0 1px 0 rgba(255, 255, 255, 0.3);
        display: none;
        overflow: hidden;
      }

      .dropdown-panel.open {
        display: block;
        animation: dropdown-slide 0.15s ease-out;
      }

      @keyframes dropdown-slide {
        from { opacity: 0; transform: translateX(-50%) translateY(10px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
      }

      .dropdown-header {
        padding: 8px 12px;
        font-size: 12px;
        font-weight: bold;
        color: #2d2418;
        text-transform: uppercase;
        letter-spacing: 1px;
        background: linear-gradient(to bottom, #c9b899 0%, #bfae8a 100%);
        border-bottom: 1px solid #8b7355;
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      .dropdown-content {
        max-height: 250px;
        overflow-y: auto;
        padding: 4px;
      }

      .dropdown-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        cursor: pointer;
        border-radius: 4px;
        transition: background 0.15s ease;
      }

      .dropdown-item:hover:not(.disabled) {
        background: rgba(139, 115, 85, 0.2);
      }

      .dropdown-item.disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .dropdown-item-icon {
        font-size: 20px;
        width: 28px;
        text-align: center;
      }

      .dropdown-item-icon.item-icon {
        display: inline-flex;
        flex: 0 0 36px;
        width: 36px;
      }

      .dropdown-item-info {
        flex: 1;
        min-width: 0;
      }

      .dropdown-item-name {
        font-size: 13px;
        font-weight: bold;
        color: #2d2418;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .dropdown-item-desc {
        font-size: 10px;
        color: #5a4a3a;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .dropdown-item-cost {
        font-size: 11px;
        color: #4080a0;
        font-weight: bold;
        white-space: nowrap;
      }

      .dropdown-item-cost.insufficient {
        color: #8b4444;
      }

      .dropdown-empty {
        padding: 20px;
        text-align: center;
        color: #7a6a5a;
        font-size: 12px;
        font-style: italic;
      }

      /* Mobile responsive - larger touch targets */
      @media (max-width: 768px) {
        .action-bar-container {
          padding: 10px 12px 16px;
          border-radius: 12px 12px 0 0;
        }

        .action-btn {
          min-width: 60px;
          height: 50px;
          padding: 6px 8px;
          border-radius: 6px;
        }

        .btn-icon { font-size: 18px; }
        .btn-label { font-size: 11px; }
        .btn-key { display: none; } /* Hide keyboard shortcuts on mobile */

        .action-buttons {
          gap: 6px;
        }

        .turn-state-text { font-size: 11px; }

        .dropdown-panel {
          position: fixed;
          bottom: 90px;
          left: 10px;
          right: 10px;
          transform: none;
          max-width: none;
          max-height: 50vh;
          border-radius: 8px;
        }

        .dropdown-item {
          padding: 14px 16px;
          min-height: 50px;
        }

        .dropdown-item-icon {
          font-size: 24px;
          width: 32px;
        }

        .dropdown-item-name {
          font-size: 15px;
        }

        .dropdown-item-desc {
          font-size: 12px;
        }

        .dropdown-item-cost {
          font-size: 13px;
        }
      }

      /* Extra small screens */
      @media (max-width: 400px) {
        .action-btn {
          min-width: 52px;
          height: 48px;
        }

        .btn-label { font-size: 10px; }
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Button clicks
    this.element.querySelectorAll('.action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        this.handleActionClick(action);
      });
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', this.boundClickOutsideHandler);
  }

  /**
   * Handle action button click
   */
  handleActionClick(action) {
    // Close any open dropdown first
    if (this.activeDropdown && action !== this.activeDropdown) {
      this.closeDropdown();
    }

    switch (action) {
      case 'move':
        if (this.canMove) {
          this.callbacks.onMove?.();
        }
        break;
      case 'attack':
        if (this.canAct) {
          this.callbacks.onAttack?.();
        }
        break;
      case 'skill':
        if (this.canAct) {
          this.toggleDropdown('skill');
        }
        break;
      case 'item':
        if (this.canAct) {
          this.toggleDropdown('item');
        }
        break;
      case 'wait':
        this.callbacks.onWait?.();
        break;
    }
  }

  /**
   * Toggle dropdown panel
   */
  toggleDropdown(type) {
    if (this.activeDropdown === type) {
      this.closeDropdown();
      return;
    }

    this.closeDropdown();
    this.activeDropdown = type;

    const panel = this.element.querySelector(`#${type}-dropdown`);
    const list = panel.querySelector(`#${type}-list`);

    // Populate list
    if (type === 'skill') {
      this.populateSkillList(list);
    } else if (type === 'item') {
      this.populateItemList(list);
    }

    panel.classList.add('open');
  }

  /**
   * Close dropdown panel
   */
  closeDropdown() {
    if (!this.activeDropdown) return;

    const panel = this.element.querySelector(`#${this.activeDropdown}-dropdown`);
    if (panel) {
      panel.classList.remove('open');
    }
    this.activeDropdown = null;
  }

  /**
   * Populate skill list in dropdown
   */
  populateSkillList(container) {
    const skills = this.callbacks.getSkills?.() || [];

    if (skills.length === 0) {
      container.innerHTML = '<div class="dropdown-empty">No skills available</div>';
      return;
    }

    container.innerHTML = skills.map(skill => {
      const canUse = this.currentUnitMp >= skill.mpCost;
      const icon = this.getSkillIcon(skill);

      return `
        <div class="dropdown-item ${canUse ? '' : 'disabled'}" data-skill-id="${escapeHtmlAttribute(skill.id)}">
          <span class="dropdown-item-icon">${icon}</span>
          <div class="dropdown-item-info">
            <div class="dropdown-item-name">${escapeHtml(skill.name)}</div>
            <div class="dropdown-item-desc">${escapeHtml(skill.description || '')}</div>
          </div>
          <span class="dropdown-item-cost ${canUse ? '' : 'insufficient'}">${skill.mpCost} MP</span>
        </div>
      `;
    }).join('');

    // Add click handlers
    container.querySelectorAll('.dropdown-item:not(.disabled)').forEach(item => {
      item.addEventListener('click', () => {
        const skillId = item.dataset.skillId;
        this.closeDropdown();
        this.callbacks.onSkillSelect?.(skillId);
      });
    });
  }

  /**
   * Populate item list in dropdown
   */
  populateItemList(container) {
    const items = this.callbacks.getItems?.() || [];

    if (items.length === 0) {
      container.innerHTML = '<div class="dropdown-empty">No items available</div>';
      return;
    }

    container.innerHTML = items.map(item => {
      const icon = this.getItemIcon(item);

      return `
        <div class="dropdown-item" data-item-id="${escapeHtmlAttribute(item.itemId)}" data-inventory-id="${escapeHtmlAttribute(item.inventoryId)}">
          <span class="dropdown-item-icon item-icon">${icon}</span>
          <div class="dropdown-item-info">
            <div class="dropdown-item-name">${escapeHtml(item.name)}</div>
            <div class="dropdown-item-desc">${escapeHtml(item.description || '')}</div>
          </div>
          <span class="dropdown-item-cost">x${escapeHtml(String(item.quantity ?? 1))}</span>
        </div>
      `;
    }).join('');

    // Add click handlers
    container.querySelectorAll('.dropdown-item').forEach(item => {
      item.addEventListener('click', () => {
        const itemId = item.dataset.itemId;
        const inventoryId = item.dataset.inventoryId;
        this.closeDropdown();
        this.callbacks.onItemSelect?.({ itemId, inventoryId });
      });
    });
  }

  /**
   * Get icon for skill
   */
  getSkillIcon(skill) {
    return renderAbilityIcon(skill, { size: 'sm' });
  }

  /**
   * Get icon for item
   */
  getItemIcon(item) {
    return renderBattleItemIcon(item, { size: 'sm' });
  }

  /**
   * Handle keyboard shortcuts
   */
  handleKeydown(e) {
    if (!this.isVisible) return;

    const key = e.key.toLowerCase();

    switch (key) {
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
      case 'escape':
        if (this.activeDropdown) {
          e.preventDefault();
          this.closeDropdown();
        } else {
          this.callbacks.onCancel?.();
        }
        break;
    }
  }

  /**
   * Handle click outside dropdown
   */
  handleClickOutside(e) {
    if (!this.activeDropdown) return;

    const panel = this.element.querySelector(`#${this.activeDropdown}-dropdown`);
    const btn = this.element.querySelector(`[data-action="${this.activeDropdown}"]`);

    if (panel && !panel.contains(e.target) && !btn.contains(e.target)) {
      this.closeDropdown();
    }
  }

  /**
   * Update turn state (which actions are available)
   */
  updateTurnState(canMove, canAct, mp = 0) {
    this.canMove = canMove;
    this.canAct = canAct;
    this.currentUnitMp = mp;

    // Update button states
    const moveBtn = this.element.querySelector('[data-action="move"]');
    const attackBtn = this.element.querySelector('[data-action="attack"]');
    const skillBtn = this.element.querySelector('[data-action="skill"]');
    const itemBtn = this.element.querySelector('[data-action="item"]');

    // Move button
    moveBtn.disabled = !canMove;
    moveBtn.classList.toggle('used', !canMove && this.isVisible);

    // Act buttons (attack, skill, item)
    [attackBtn, skillBtn, itemBtn].forEach(btn => {
      btn.disabled = !canAct;
      btn.classList.toggle('used', !canAct && this.isVisible);
    });

    // Update pips
    const movePip = this.element.querySelector('.pip-move');
    const actPip = this.element.querySelector('.pip-act');

    movePip.classList.toggle('available', canMove);
    movePip.classList.toggle('used', !canMove);
    movePip.classList.toggle('pulse', canMove && !canAct); // Pulse if only move left

    actPip.classList.toggle('available', canAct);
    actPip.classList.toggle('used', !canAct);
    actPip.classList.toggle('pulse', canAct && !canMove); // Pulse if only act left

    // Update turn state text
    const stateText = this.element.querySelector('.turn-state-text');
    if (canMove && canAct) {
      stateText.textContent = 'Your Turn';
    } else if (canMove) {
      stateText.textContent = 'Move Left';
    } else if (canAct) {
      stateText.textContent = 'Action Left';
    } else {
      stateText.textContent = 'Turn Complete';
    }
  }

  /**
   * Show the action bar
   */
  show(canMove = true, canAct = true, mp = 0) {
    this.isVisible = true;
    this.element.style.display = 'block';
    this.updateTurnState(canMove, canAct, mp);

    // Add keyboard listener
    document.addEventListener('keydown', this.boundKeydownHandler);
  }

  /**
   * Hide the action bar
   */
  hide() {
    this.isVisible = false;
    this.element.style.display = 'none';
    this.closeDropdown();

    // Remove keyboard listener
    document.removeEventListener('keydown', this.boundKeydownHandler);
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
