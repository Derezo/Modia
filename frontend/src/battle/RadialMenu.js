/**
 * RadialMenu - Wheel-style action menu for battle
 *
 * Layout:
 *           MOVE (top)
 *            /\
 *   WAIT    /  \    ATTACK
 *    (W)   | ESC |   (A)
 *           \  /
 *   ITEM    \/     SKILL
 *    (I)  (bottom)  (S)
 */
import { escapeHtml } from '../utils/escapeHtml.js';
import { renderAbilityIcon } from './AbilityIcon.js';
import { renderBattleItemIcon } from './BattleItemIcon.js';

export class RadialMenu {
  constructor(game) {
    this.game = game;
    this.element = null;
    this.isVisible = false;

    // Menu configuration
    this.segments = [
      { id: 'move', label: 'Move', icon: 'M', color: '#4a90d9', angle: -90 },
      { id: 'attack', label: 'Attack', icon: 'A', color: '#d94a4a', angle: -18 },
      { id: 'skill', label: 'Skill', icon: 'S', color: '#9c27b0', angle: 54 },
      { id: 'item', label: 'Item', icon: 'I', color: '#4caf50', angle: 126 },
      { id: 'wait', label: 'Wait', icon: 'W', color: '#607d8b', angle: 198 }
    ];

    // Geometry
    this.outerRadius = 80;
    this.innerRadius = 25;
    this.segmentAngle = 72; // degrees per segment (360 / 5)

    // Position (updated on show)
    this.centerX = 0;
    this.centerY = 0;

    // State
    this.enabledSegments = new Set(['move', 'attack', 'skill', 'item', 'wait']);
    this.hoveredSegment = null;
    this.currentUnitMp = 0;

    // Callbacks
    this.callbacks = {};

    // Submenu state
    this.submenuOpen = false;
    this.submenuType = null;

    // Bound handlers for cleanup
    this.boundKeydownHandler = this.handleKeydown.bind(this);
    this.boundClickOutsideHandler = this.handleClickOutside.bind(this);
  }

  /**
   * Create the radial menu DOM
   */
  create(callbacks = {}) {
    this.callbacks = callbacks;

    const size = (this.outerRadius + 30) * 2;
    const cx = size / 2;
    const cy = size / 2;

    this.element = document.createElement('div');
    this.element.id = 'radial-menu';
    this.element.style.cssText = `
      position: absolute;
      width: ${size}px;
      height: ${size}px;
      pointer-events: auto;
      display: none;
      z-index: 100;
    `;

    this.element.innerHTML = this.generateSVG(cx, cy);
    this.game.uiOverlay.appendChild(this.element);

    this.setupEventListeners();
  }

  /**
   * Generate SVG markup for the radial menu
   */
  generateSVG(cx, cy) {
    let svg = `<svg width="${cx * 2}" height="${cy * 2}" viewBox="0 0 ${cx * 2} ${cy * 2}">`;

    // Define glow filter for hover effect
    svg += `
      <defs>
        <filter id="radial-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur"/>
          <feFlood flood-color="#fff" flood-opacity="0.3"/>
          <feComposite in2="blur" operator="in"/>
          <feMerge>
            <feMergeNode/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
    `;

    // Draw each segment as an arc path
    this.segments.forEach((seg) => {
      const startAngle = ((seg.angle - this.segmentAngle / 2) * Math.PI) / 180;
      const endAngle = ((seg.angle + this.segmentAngle / 2) * Math.PI) / 180;

      // Calculate arc points
      const outerStart = {
        x: cx + Math.cos(startAngle) * this.outerRadius,
        y: cy + Math.sin(startAngle) * this.outerRadius
      };
      const outerEnd = {
        x: cx + Math.cos(endAngle) * this.outerRadius,
        y: cy + Math.sin(endAngle) * this.outerRadius
      };
      const innerStart = {
        x: cx + Math.cos(endAngle) * this.innerRadius,
        y: cy + Math.sin(endAngle) * this.innerRadius
      };
      const innerEnd = {
        x: cx + Math.cos(startAngle) * this.innerRadius,
        y: cy + Math.sin(startAngle) * this.innerRadius
      };

      // Arc path: outer arc + inner arc
      const path = `
        M ${outerStart.x} ${outerStart.y}
        A ${this.outerRadius} ${this.outerRadius} 0 0 1 ${outerEnd.x} ${outerEnd.y}
        L ${innerStart.x} ${innerStart.y}
        A ${this.innerRadius} ${this.innerRadius} 0 0 0 ${innerEnd.x} ${innerEnd.y}
        Z
      `;

      svg += `
        <path
          d="${path}"
          fill="${seg.color}"
          fill-opacity="0.85"
          stroke="#222"
          stroke-width="2"
          class="radial-segment"
          data-action="${seg.id}"
          style="cursor: pointer; transition: fill-opacity 0.15s;"
        />
      `;

      // Icon position (middle of segment arc)
      const midAngle = (seg.angle * Math.PI) / 180;
      const iconRadius = (this.outerRadius + this.innerRadius) / 2;
      const iconX = cx + Math.cos(midAngle) * iconRadius;
      const iconY = cy + Math.sin(midAngle) * iconRadius;

      // Label position (outside the arc)
      const labelRadius = this.outerRadius + 15;
      const labelX = cx + Math.cos(midAngle) * labelRadius;
      const labelY = cy + Math.sin(midAngle) * labelRadius;

      svg += `
        <text
          x="${iconX}" y="${iconY}"
          text-anchor="middle"
          dominant-baseline="middle"
          fill="#fff"
          font-size="16"
          font-weight="bold"
          pointer-events="none"
        >${seg.icon}</text>
        <text
          x="${labelX}" y="${labelY}"
          text-anchor="middle"
          dominant-baseline="middle"
          fill="#ccc"
          font-size="10"
          pointer-events="none"
        >${seg.label}</text>
      `;
    });

    // Center cancel zone
    svg += `
      <circle
        cx="${cx}" cy="${cy}" r="${this.innerRadius}"
        fill="#1a1a2e"
        stroke="#333"
        stroke-width="2"
        class="radial-center"
        style="cursor: pointer;"
      />
      <text
        x="${cx}" y="${cy}"
        text-anchor="middle"
        dominant-baseline="middle"
        fill="#888"
        font-size="10"
        pointer-events="none"
      >ESC</text>
    `;

    svg += '</svg>';
    return svg;
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Segment hover and click
    this.element.querySelectorAll('.radial-segment').forEach((segment) => {
      const action = segment.dataset.action;

      segment.addEventListener('mouseenter', () => {
        if (this.enabledSegments.has(action)) {
          segment.style.fillOpacity = '1';
          segment.style.filter = 'url(#radial-glow)';
          this.hoveredSegment = action;
        }
      });

      segment.addEventListener('mouseleave', () => {
        segment.style.fillOpacity = '0.85';
        segment.style.filter = 'none';
        this.hoveredSegment = null;
      });

      segment.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectSegment(action);
      });
    });

    // Center = cancel
    this.element.querySelector('.radial-center')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onCancel?.();
      this.hide();
    });
  }

  /**
   * Handle segment selection
   */
  selectSegment(action) {
    if (!this.enabledSegments.has(action)) return;

    if (action === 'skill') {
      this.openSubmenu('skill');
    } else if (action === 'item') {
      this.openSubmenu('item');
    } else {
      const callbackName = `on${this.capitalize(action)}`;
      this.callbacks[callbackName]?.();
      this.hide();
    }
  }

  /**
   * Handle keydown for keyboard shortcuts
   */
  handleKeydown(e) {
    if (!this.isVisible) return;

    // If submenu is open, handle submenu keys
    if (this.submenuOpen) {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeSubmenu();
      }
      return;
    }

    const keyMap = {
      m: 'move',
      a: 'attack',
      s: 'skill',
      i: 'item',
      w: 'wait',
      Escape: 'cancel'
    };

    const action = keyMap[e.key.toLowerCase()] || keyMap[e.key];
    if (!action) return;

    e.preventDefault();

    if (action === 'cancel') {
      this.callbacks.onCancel?.();
      this.hide();
    } else {
      this.selectSegment(action);
    }
  }

  /**
   * Handle clicks outside the menu
   */
  handleClickOutside(e) {
    if (!this.isVisible) return;
    if (this.element && !this.element.contains(e.target)) {
      this.callbacks.onCancel?.();
      this.hide();
    }
  }

  /**
   * Open skill/item submenu
   */
  openSubmenu(type) {
    this.submenuOpen = true;
    this.submenuType = type;

    // Request data from callback
    const items =
      type === 'skill'
        ? this.callbacks.getSkills?.() || []
        : this.callbacks.getItems?.() || [];

    this.renderSubmenu(items, type);
  }

  /**
   * Render submenu panel
   */
  renderSubmenu(items, type) {
    // Remove existing submenu
    const existing = this.element.querySelector('.radial-submenu');
    if (existing) existing.remove();

    const submenu = document.createElement('div');
    submenu.className = 'radial-submenu';
    submenu.style.cssText = `
      position: absolute;
      left: ${this.outerRadius * 2 + 40}px;
      top: 50%;
      transform: translateY(-50%);
      background: rgba(20, 20, 40, 0.95);
      border: 2px solid #ffd700;
      border-radius: 8px;
      padding: 10px;
      min-width: 160px;
      max-height: 300px;
      overflow-y: auto;
    `;

    const title = type === 'skill' ? 'Select Skill' : 'Select Item';
    submenu.innerHTML = `
      <div style="color: #ffd700; font-weight: bold; margin-bottom: 10px; font-size: 12px; text-align: center;">
        ${title}
      </div>
      <div class="submenu-items"></div>
    `;

    const itemsContainer = submenu.querySelector('.submenu-items');

    if (items.length === 0) {
      itemsContainer.innerHTML = '<div style="color: #666; font-style: italic; font-size: 11px; text-align: center; padding: 10px;">None available</div>';
    } else {
      items.forEach((item) => {
        const onCooldown = type === 'skill' && item.currentCooldown && item.currentCooldown > 0;
        const notEnoughMp = type === 'skill' && item.mpCost > this.currentUnitMp;
        const disabled = onCooldown || notEnoughMp;
        const btn = document.createElement('button');
        btn.className = 'submenu-btn';
        btn.disabled = disabled;
        btn.style.cssText = `
          display: block;
          width: 100%;
          padding: 8px 10px;
          margin-bottom: 4px;
          background: ${disabled ? '#222' : '#2a2a4a'};
          border: 1px solid ${disabled ? '#444' : '#4a4a6a'};
          border-radius: 4px;
          color: ${disabled ? '#555' : '#fff'};
          cursor: ${disabled ? 'not-allowed' : 'pointer'};
          text-align: left;
          font-size: 11px;
          transition: background 0.15s;
        `;

        const icon = type === 'skill'
          ? renderAbilityIcon(item, { size: 'sm' })
          : renderBattleItemIcon(item, { size: 'sm' });
        const costOrQty =
          type === 'skill'
            ? onCooldown
              ? `<span style="color: #f88; margin-left: 6px;">${item.currentCooldown}⏱</span>`
              : `<span style="color: ${disabled ? '#446' : '#6af'}; margin-left: 6px;">${item.mpCost}MP</span>`
            : `<span style="color: #8f8; margin-left: 6px;">x${item.quantity}</span>`;

        btn.innerHTML = `
          <span>${icon} ${escapeHtml(item.name)}</span>
          ${costOrQty}
        `;

        if (!disabled) {
          btn.addEventListener('mouseenter', () => {
            btn.style.background = '#3a3a5a';
          });
          btn.addEventListener('mouseleave', () => {
            btn.style.background = '#2a2a4a';
          });
          btn.addEventListener('click', () => {
            if (type === 'skill') {
              this.callbacks.onSkillSelect?.(item.id);
            } else {
              this.callbacks.onItemSelect?.({ itemId: item.itemId, inventoryId: item.inventoryId });
            }
            this.closeSubmenu();
            this.hide();
          });
        }

        itemsContainer.appendChild(btn);
      });
    }

    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = `
      display: block;
      width: 100%;
      padding: 8px 10px;
      margin-top: 10px;
      background: #333;
      border: 1px solid #555;
      border-radius: 4px;
      color: #aaa;
      cursor: pointer;
      font-size: 11px;
      transition: background 0.15s;
    `;
    cancelBtn.addEventListener('mouseenter', () => {
      cancelBtn.style.background = '#444';
    });
    cancelBtn.addEventListener('mouseleave', () => {
      cancelBtn.style.background = '#333';
    });
    cancelBtn.addEventListener('click', () => this.closeSubmenu());
    itemsContainer.appendChild(cancelBtn);

    this.element.appendChild(submenu);
  }

  /**
   * Close submenu
   */
  closeSubmenu() {
    const submenu = this.element.querySelector('.radial-submenu');
    if (submenu) submenu.remove();
    this.submenuOpen = false;
    this.submenuType = null;
  }

  /**
   * Show the radial menu at position
   */
  show(screenX, screenY, unitMp = 100) {
    this.centerX = screenX;
    this.centerY = screenY;
    this.currentUnitMp = unitMp;

    // Position centered on screen coordinates
    const halfSize = this.outerRadius + 30;
    this.element.style.left = `${screenX - halfSize}px`;
    this.element.style.top = `${screenY - halfSize}px`;
    this.element.style.display = 'block';
    this.isVisible = true;

    // Update visual state of segments
    this.updateSegmentVisuals();

    // Add global event listeners
    document.addEventListener('keydown', this.boundKeydownHandler);
    setTimeout(() => {
      document.addEventListener('click', this.boundClickOutsideHandler);
    }, 100);
  }

  /**
   * Hide the radial menu
   */
  hide() {
    this.closeSubmenu();
    this.element.style.display = 'none';
    this.isVisible = false;

    // Remove global event listeners
    document.removeEventListener('keydown', this.boundKeydownHandler);
    document.removeEventListener('click', this.boundClickOutsideHandler);
  }

  /**
   * Update visual state of segments based on enabled/disabled
   */
  updateSegmentVisuals() {
    this.element.querySelectorAll('.radial-segment').forEach((segment) => {
      const action = segment.dataset.action;
      const enabled = this.enabledSegments.has(action);
      segment.style.opacity = enabled ? '1' : '0.3';
      segment.style.cursor = enabled ? 'pointer' : 'not-allowed';
    });
  }

  /**
   * Set segment enabled/disabled
   */
  setSegmentEnabled(segmentId, enabled) {
    if (enabled) {
      this.enabledSegments.add(segmentId);
    } else {
      this.enabledSegments.delete(segmentId);
    }

    // Update visual if visible
    if (this.isVisible) {
      this.updateSegmentVisuals();
    }
  }

  /**
   * Capitalize string
   */
  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Destroy the radial menu
   */
  destroy() {
    document.removeEventListener('keydown', this.boundKeydownHandler);
    document.removeEventListener('click', this.boundClickOutsideHandler);
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
  }
}
