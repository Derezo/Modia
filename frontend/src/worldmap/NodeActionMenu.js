/**
 * NodeActionMenu - Animated expandable menu for world map nodes
 *
 * Combines the node name and action buttons into a single DOM-based
 * container that positions itself near the current node on the map.
 * Uses CSS transitions for smooth expand/collapse animations.
 *
 * Features:
 * - Node name badge always visible when at a node
 * - Action buttons expand below with smooth animation
 * - Tracks node position during camera pan/zoom
 * - Edge detection to flip above node if near screen bottom
 * - Parchment styling for visual consistency
 */

import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentShadow
} from '../ui/parchment/ParchmentTheme.js';
import { responsive } from '../core/Responsive.js';
import { Icon } from '../components/Icon.js';
import { isDevModeEnabled } from '../utils/debugLogger.js';

const STYLE_ID = 'node-action-menu-styles';

/**
 * Settlement node types where POST /api/world/stamina/restore is accepted.
 * Mirrors STAMINA_RESTORE_NODE_TYPES in api/src/routes/world/stamina.js.
 */
export const STAMINA_RESTORE_NODE_TYPES = Object.freeze(['castle', 'city', 'village', 'keep', 'palace']);

/**
 * Node types that always expose Fast Travel (Wayfarer's Compass relic,
 * checked in the handler). Nodes with a 'stables' feature also offer it.
 */
const FAST_TRAVEL_NODE_TYPES = Object.freeze(['castle', 'palace']);

/**
 * Features with a working handler in WorldMapScene.handleFeature (or the
 * onAction callback). Anything else (throne, temple, throne_room, treasury,
 * royal_guard, ...) is decorative worldgen data and is not rendered, so the
 * menu never shows dead "Coming Soon" buttons.
 */
export const HANDLED_FEATURES = Object.freeze([
  'garrison', 'blacksmith', 'marketplace', 'tavern', 'apothecary', 'coliseum',
  'farm', 'guild_hall', 'training_ground', 'guild_advancement', 'courtyard',
  'caravan', 'explore_ruins', 'fishing', 'fast_travel', 'stamina_restore'
]);

function getShrineCooldownUntil(node) {
  const value = node?.shrine_cooldown_until
    ?? node?.shrineCooldownUntil
    ?? node?.cooldown_expires_at
    ?? node?.cooldownExpiresAt
    ?? node?.next_available_at
    ?? node?.nextAvailableAt;
  const timestamp = value instanceof Date
    ? value.getTime()
    : (typeof value === 'number' ? value : Date.parse(value));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatShrineCooldown(remainingMs) {
  const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `Ready in ${minutes}m`;
  if (minutes === 0) return `Ready in ${hours}h`;
  return `Ready in ${hours}h ${minutes}m`;
}

export class NodeActionMenu {
  /**
   * @param {Object} options
   * @param {Object} options.game - Game instance
   * @param {Function} options.onAction - Callback when action button clicked (feature) => void
   */
  constructor(options) {
    this.game = options.game;
    this.onAction = options.onAction;

    this.element = null;
    this.nameElement = null;
    this.actionsElement = null;
    this.badgeElement = null;

    this.currentNode = null;
    this.isExpanded = false;
    this.isVisible = false;

    this.abortController = new AbortController();

    this.injectStyles();
    this.createElement();
    this.setupResponsive();
  }

  /**
   * Inject component styles (only once per page)
   */
  injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* Base container - positioned absolutely in viewport */
      .node-action-menu {
        position: absolute;
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        align-items: center;
        transform: translateX(-50%);
        z-index: 100;
        will-change: transform, top, left;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.15s ease-out, visibility 0.15s ease-out;
      }

      .node-action-menu--visible {
        opacity: 1;
        visibility: visible;
      }

      /* Name badge - compact pill showing node name */
      .node-action-menu__name {
        padding: 6px 14px;
        background: ${getParchmentGradient('to bottom')};
        border: ${getParchmentBorder()};
        border-radius: 16px;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: 13px;
        font-weight: bold;
        color: ${PARCHMENT_COLORS.accent.gold};
        text-shadow: 0 1px 2px rgba(0,0,0,0.5);
        box-shadow: ${getParchmentShadow()};
        white-space: nowrap;
        cursor: default;
      }

      /* Actions container - expands with max-height animation */
      .node-action-menu__actions {
        max-height: 0;
        overflow: hidden;
        opacity: 0;
        transition: max-height 0.25s ease-out, opacity 0.2s ease-out 0.05s;
        margin-top: 6px;
        background: ${getParchmentGradient('to bottom')};
        border: ${getParchmentBorder()};
        border-radius: 8px;
        box-shadow: ${getParchmentShadow()};
        min-width: 140px;
      }

      /* Expanded state */
      .node-action-menu--expanded .node-action-menu__actions {
        max-height: 300px;
        opacity: 1;
      }

      /* Actions inner wrapper for padding */
      .node-action-menu__actions-inner {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 8px;
      }

      /* Individual action buttons */
      .node-action-menu__button {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        width: 100%;
        border: none;
        background: transparent;
        border-radius: 4px;
        cursor: pointer;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: 12px;
        font-weight: 600;
        color: ${PARCHMENT_COLORS.text.primary};
        text-align: left;
        transition: background 0.15s ease, transform 0.1s ease;
      }

      .node-action-menu__button:hover {
        background: rgba(139, 115, 85, 0.15);
      }

      .node-action-menu__button:active {
        transform: scale(0.98);
        background: rgba(139, 115, 85, 0.25);
      }

      .node-action-menu__button:disabled {
        cursor: not-allowed;
        opacity: 0.7;
        transform: none;
      }

      .node-action-menu__button--pending:disabled {
        cursor: wait;
      }

      .node-action-menu__button--cooldown:disabled {
        opacity: 0.82;
      }

      /* Primary button (battle) */
      .node-action-menu__button--primary {
        background: linear-gradient(to bottom, ${PARCHMENT_COLORS.accent.copper}, #9a5f23);
        color: ${PARCHMENT_COLORS.text.inverse};
        text-shadow: 0 1px 2px rgba(0,0,0,0.4);
      }

      .node-action-menu__button--primary:hover {
        background: linear-gradient(to bottom, #d4a44a, ${PARCHMENT_COLORS.accent.copper});
      }

      /* Debug button (developer mode only) */
      .node-action-menu__button--debug {
        background: linear-gradient(to bottom, #6a5acd, #483d8b);
        color: ${PARCHMENT_COLORS.text.inverse};
        text-shadow: 0 1px 2px rgba(0,0,0,0.4);
        font-size: 10px;
        padding: 6px 10px;
        border: 1px dashed rgba(255,255,255,0.3);
      }

      .node-action-menu__button--debug:hover {
        background: linear-gradient(to bottom, #7b68ee, #6a5acd);
      }

      /* Button icon */
      .node-action-menu__button-icon {
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .node-action-menu__button-icon svg,
      .node-action-menu__button-icon img {
        width: 100% !important;
        height: 100% !important;
      }

      /* Node type badge */
      .node-action-menu__badge {
        position: absolute;
        bottom: -10px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0,0,0,0.85);
        color: white;
        padding: 2px 10px;
        border-radius: 10px;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: 10px;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        text-shadow: 0 1px 2px rgba(0,0,0,0.5);
        white-space: nowrap;
      }

      /* Position above node (when near bottom edge) */
      .node-action-menu--above {
        flex-direction: column-reverse;
      }

      .node-action-menu--above .node-action-menu__actions {
        margin-top: 0;
        margin-bottom: 6px;
      }

      .node-action-menu--above .node-action-menu__badge {
        bottom: auto;
        top: -10px;
      }

      /* Mobile adjustments */
      @media (max-width: 768px) {
        .node-action-menu__name {
          padding: 5px 12px;
          font-size: 12px;
        }

        .node-action-menu__actions {
          min-width: 130px;
        }

        .node-action-menu__actions-inner {
          padding: 6px;
          gap: 3px;
        }

        .node-action-menu__button {
          padding: 7px 10px;
          font-size: 11px;
          gap: 6px;
        }

        .node-action-menu__button-icon {
          width: 20px;
          height: 20px;
        }

        .node-action-menu__badge {
          font-size: 9px;
          padding: 2px 8px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Create the DOM structure
   */
  createElement() {
    // Main container
    this.element = document.createElement('div');
    this.element.className = 'node-action-menu';

    // Name badge
    this.nameElement = document.createElement('div');
    this.nameElement.className = 'node-action-menu__name';
    this.element.appendChild(this.nameElement);

    // Actions container (expandable)
    this.actionsElement = document.createElement('div');
    this.actionsElement.className = 'node-action-menu__actions';

    const actionsInner = document.createElement('div');
    actionsInner.className = 'node-action-menu__actions-inner';
    this.actionsElement.appendChild(actionsInner);
    this.actionsInner = actionsInner;

    this.element.appendChild(this.actionsElement);

    // Type badge
    this.badgeElement = document.createElement('div');
    this.badgeElement.className = 'node-action-menu__badge';
    this.element.appendChild(this.badgeElement);
  }

  /**
   * Setup responsive listener
   */
  setupResponsive() {
    this.responsiveUnsubscribe = responsive.onChange(() => {
      // Styles are already responsive via media queries
      // Could add dynamic adjustments here if needed
    });
  }

  /**
   * Set the current node and update menu content
   * @param {Object} node - Node data from WorldMapScene
   * @param {Object} position - Screen position { x, y, nodeSize, canvasHeight }
   */
  setNode(node, position = null) {
    this.currentNode = node;

    if (!node) {
      this.hide();
      return;
    }

    // Update name
    this.nameElement.textContent = node.name;

    // Update badge
    this.badgeElement.textContent = this.capitalize(node.node_type);

    // Rebuild action buttons
    this.rebuildActions(node);

    // Set initial position before showing (if provided)
    if (position) {
      // Temporarily set visible to allow position update
      this.isVisible = true;
      this.updatePosition(position.x, position.y, position.nodeSize, position.canvasHeight);
    }

    // Show the menu (but not expanded yet)
    this.show();
  }

  /**
   * Rebuild action buttons for the given node
   * @param {Object} node
   */
  rebuildActions(node) {
    this.actionsInner.innerHTML = '';

    let features = Array.isArray(node.features)
      ? node.features.filter(feature => !['claim_chest', 'visit_shrine'].includes(feature))
      : [];
    const chestClaimed = Boolean(node.chest_claimed || node.claimed);

    // Chest rewards are one-time claims and should be the clear primary action.
    if (node.node_type === 'chest' && !chestClaimed) {
      const claimBtn = this.createButton('claim_chest', true, node);
      this.actionsInner.appendChild(claimBtn);
    }

    // Shrines always expose their blessing as the clear primary activity.
    // The action stays visible while cooling down so its state is understandable.
    if (node.node_type === 'shrine') {
      const shrineBtn = this.createButton('visit_shrine', true, node);
      this.actionsInner.appendChild(shrineBtn);
    }

    // Auto-add guild_advancement feature for guild nodes
    if (node.guild_class && !features.includes('guild_advancement')) {
      features = [...features, 'guild_advancement'];
    }

    // Add caravan action for merchant_caravan nodes
    if (node.node_type === 'merchant_caravan' && !features.includes('caravan')) {
      features = [...features, 'caravan'];
    }

    // Add explore action for ruins nodes
    if (node.node_type === 'ruins' && !features.includes('explore_ruins')) {
      features = [...features, 'explore_ruins'];
    }

    // Add fishing action for fishing_spot nodes
    if (node.node_type === 'fishing_spot' && !features.includes('fishing')) {
      features = [...features, 'fishing'];
    }

    // Stables provide fast travel (GAME_DESIGN: Stables -> fast travel)
    if (features.includes('stables')) {
      features = features.filter(f => f !== 'stables');
      if (!features.includes('fast_travel')) {
        features = [...features, 'fast_travel'];
      }
    }

    // Add fast travel action for castle/palace nodes (requires relic, checked in handler)
    if (FAST_TRAVEL_NODE_TYPES.includes(node.node_type) && !features.includes('fast_travel')) {
      features = [...features, 'fast_travel'];
    }

    // Add garrison action for castle nodes
    if (node.node_type === 'castle' && !features.includes('garrison')) {
      features = [...features, 'garrison'];
    }

    // Add stamina restore (Rest) at settlement nodes (requires relic, checked in handler)
    if (STAMINA_RESTORE_NODE_TYPES.includes(node.node_type) && !features.includes('stamina_restore')) {
      features = [...features, 'stamina_restore'];
    }

    // Only features with a handler are rendered, in HANDLED_FEATURES priority
    // order. Every handled feature is shown: the list is bounded by the
    // handler set, so no working action is ever cut off by a cap.
    HANDLED_FEATURES
      .filter(feature => features.includes(feature))
      .forEach(feature => {
        const btn = this.createButton(feature, false, node);
        this.actionsInner.appendChild(btn);
      });

    // Add battle button for combat nodes
    if (['forest', 'cave', 'mountain', 'bridge'].includes(node.node_type)) {
      const battleBtn = this.createButton('battle', true, node);
      this.actionsInner.appendChild(battleBtn);

      // Add "Defeat Automatically" debug button if developer mode is enabled
      if (isDevModeEnabled() && !node.cleared) {
        const debugBtn = this.createDebugClearButton(node);
        this.actionsInner.appendChild(debugBtn);
      }
    }
  }

  /**
   * Create a debug button to clear a combat node without fighting
   * Only shown when developer mode is enabled
   * @param {Object} node
   * @returns {HTMLButtonElement}
   */
  createDebugClearButton(node) {
    const btn = document.createElement('button');
    btn.className = 'node-action-menu__button node-action-menu__button--debug';

    // Icon (use a skip/fast-forward style icon)
    const iconContainer = document.createElement('span');
    iconContainer.className = 'node-action-menu__button-icon';
    iconContainer.innerHTML = Icon.html('actions', 'travel', { size: 'sm' }).replace(/<span[^>]*>([^<]*)<\/span>/g, '');
    btn.appendChild(iconContainer);

    // Label
    const labelSpan = document.createElement('span');
    labelSpan.textContent = 'Defeat Auto';
    btn.appendChild(labelSpan);

    // Click handler - call debug API to clear node
    btn.addEventListener('click', async () => {
      try {
        const response = await this.game.api.post(`/debug/clear-node/${node.id}`);

        if (response.success) {
          console.log('[DEBUG] Node cleared:', response.message);
          // Notify via callback (same as battle action)
          if (this.onAction) {
            this.onAction('debug_clear');
          }
        }
      } catch (error) {
        console.error('[DEBUG] Failed to clear node:', error.message);
      }
    }, { signal: this.abortController.signal });

    return btn;
  }

  /**
   * Create an action button
   * @param {string} feature
   * @param {boolean} isPrimary
   * @param {Object} node
   * @returns {HTMLButtonElement}
   */
  createButton(feature, isPrimary, node) {
    const btn = document.createElement('button');
    btn.className = `node-action-menu__button${isPrimary ? ' node-action-menu__button--primary' : ''}`;

    // Icon mapping - menu category for locations, actions for combat
    const iconMap = {
      blacksmith: { category: 'menu', name: 'equipment' },
      marketplace: { category: 'menu', name: 'shop' },
      tavern: { category: 'menu', name: 'tavern' },
      apothecary: { category: 'menu', name: 'inventory' },
      // TODO(menu/coliseum art is near-transparent; regenerate it and restore
      // { category: 'menu', name: 'coliseum' }) - stop-gap icon below
      coliseum: { category: 'actions', name: 'attack' },
      farm: { category: 'menu', name: 'caravan' },
      guild_hall: { category: 'menu', name: 'guild' },
      training_ground: { category: 'menu', name: 'guild' },
      guild_advancement: { category: 'menu', name: 'guild' },
      courtyard: { category: 'menu', name: 'party' },
      battle: { category: 'actions', name: 'attack' },
      caravan: { category: 'menu', name: 'caravan' },
      explore_ruins: { category: 'menu', name: 'ruins' },
      fishing: { category: 'menu', name: 'fishing' },
      fast_travel: { category: 'actions', name: 'move' },
      stamina_restore: { category: 'actions', name: 'heal' },
      garrison: { category: 'menu', name: 'formation' },
      visit_shrine: { category: 'actions', name: 'heal' }
    };

    // Get label text
    let label = this.capitalize(feature);
    if (feature === 'guild_hall') {
      label = 'Recruitment';
    }
    if (feature === 'training_ground') {
      label = 'Training Grounds';
    }
    if (feature === 'guild_advancement') {
      label = 'Advancement';
    }
    if (feature === 'caravan') {
      label = 'Trade';
    }
    if (feature === 'explore_ruins') {
      label = 'Explore';
    }
    if (feature === 'fishing') {
      label = 'Fish';
    }
    if (feature === 'fast_travel') {
      label = 'Fast Travel';
    }
    if (feature === 'stamina_restore') {
      label = 'Rest';
    }
    if (feature === 'garrison') {
      label = 'Garrison';
    }
    if (feature === 'claim_chest') {
      label = 'Collect Treasure';
    }
    if (feature === 'visit_shrine') {
      label = 'Receive Blessing';
    }

    // Icon
    const iconContainer = document.createElement('span');
    iconContainer.className = 'node-action-menu__button-icon';
    const iconInfo = iconMap[feature];
    if (iconInfo) {
      // Use Icon.html() to get the inline HTML for the icon
      const iconHtml = Icon.html(iconInfo.category, iconInfo.name, { size: 'lg' });
      // Extract just the img tag, removing the wrapper span
      iconContainer.innerHTML = iconHtml.replace(/<span[^>]*>([^<]*)<\/span>/g, '');
    } else if (feature === 'claim_chest') {
      iconContainer.textContent = '🎁';
    }
    btn.appendChild(iconContainer);

    // Label
    const labelSpan = document.createElement('span');
    labelSpan.dataset.actionLabel = feature;
    labelSpan.textContent = label;
    btn.appendChild(labelSpan);

    // Click handler
    btn.dataset.action = feature;
    if (feature === 'visit_shrine') {
      const cooldownUntil = getShrineCooldownUntil(node);
      if (cooldownUntil) {
        btn.dataset.cooldownUntil = String(cooldownUntil);
      }
      this.updateShrineActionState(btn);
    }
    btn.addEventListener('click', () => {
      if (this.onAction) {
        this.onAction(feature);
      }
    }, { signal: this.abortController.signal });

    return btn;
  }

  /**
   * Toggle the pending state for a menu action.
   * @param {string} feature
   * @param {boolean} pending
   */
  setActionPending(feature, pending) {
    const button = this.actionsInner.querySelector(`[data-action="${feature}"]`);
    if (!button) return;

    button.disabled = pending;
    const label = button.querySelector(`[data-action-label="${feature}"]`);
    button.classList.toggle('node-action-menu__button--pending', pending);
    if (label && feature === 'claim_chest') {
      label.textContent = pending ? 'Collecting…' : 'Collect Treasure';
    } else if (label && feature === 'visit_shrine') {
      label.textContent = pending ? 'Receiving…' : 'Receive Blessing';
      if (!pending) {
        this.updateShrineActionState(button);
      }
    }
  }

  /**
   * Apply a successful shrine visit's cooldown without waiting for a world refresh.
   * @param {number|string|Date} cooldownUntil
   */
  setShrineCooldown(cooldownUntil) {
    const button = this.actionsInner.querySelector('[data-action="visit_shrine"]');
    if (!button) return;

    const timestamp = cooldownUntil instanceof Date
      ? cooldownUntil.getTime()
      : (typeof cooldownUntil === 'number' ? cooldownUntil : Date.parse(cooldownUntil));
    if (Number.isFinite(timestamp)) {
      button.dataset.cooldownUntil = String(timestamp);
    }
    this.updateShrineActionState(button);
  }

  /**
   * Refresh the shrine label and disabled state from its local cooldown marker.
   * @param {HTMLButtonElement} button
   * @param {number} now
   */
  updateShrineActionState(button, now = Date.now()) {
    if (!button || button.classList.contains('node-action-menu__button--pending')) return;

    const cooldownUntil = Number(button.dataset.cooldownUntil);
    const remainingMs = cooldownUntil - now;
    const onCooldown = Number.isFinite(remainingMs) && remainingMs > 0;
    const label = button.querySelector('[data-action-label="visit_shrine"]');

    button.disabled = onCooldown;
    button.classList.toggle('node-action-menu__button--cooldown', onCooldown);
    button.title = onCooldown
      ? 'This shrine is restoring its power.'
      : 'Receive this shrine’s blessing.';
    if (label) {
      label.textContent = onCooldown
        ? formatShrineCooldown(remainingMs)
        : 'Receive Blessing';
    }
  }

  /**
   * Update menu position to track the current node
   * @param {number} screenX - Node X position in screen coordinates
   * @param {number} screenY - Node Y position in screen coordinates
   * @param {number} nodeSize - Size of the node sprite
   * @param {number} canvasHeight - Height of the canvas
   */
  updatePosition(screenX, screenY, nodeSize, canvasHeight) {
    if (!this.isVisible) return;

    this.updateShrineActionState(
      this.actionsInner.querySelector('[data-action="visit_shrine"]')
    );

    // Position below the node by default
    let posY = screenY + nodeSize + 12;
    let flipAbove = false;

    // Check if too close to bottom edge
    const menuHeight = this.element.offsetHeight || 150;
    if (posY + menuHeight > canvasHeight - 20) {
      // Position above the node instead
      posY = screenY - nodeSize - 12 - menuHeight;
      flipAbove = true;
    }

    // Apply position
    this.element.style.left = `${screenX}px`;
    this.element.style.top = `${posY}px`;

    // Toggle above/below mode
    this.element.classList.toggle('node-action-menu--above', flipAbove);

    // Horizontal edge detection
    const rect = this.element.getBoundingClientRect();
    const viewportWidth = window.innerWidth;

    if (rect.left < 10) {
      // Too close to left edge
      const shift = 10 - rect.left;
      this.element.style.transform = `translateX(calc(-50% + ${shift}px))`;
    } else if (rect.right > viewportWidth - 10) {
      // Too close to right edge
      const shift = rect.right - (viewportWidth - 10);
      this.element.style.transform = `translateX(calc(-50% - ${shift}px))`;
    } else {
      this.element.style.transform = 'translateX(-50%)';
    }
  }

  /**
   * Show the menu (but not expanded)
   */
  show() {
    this.isVisible = true;
    this.element.classList.add('node-action-menu--visible');
  }

  /**
   * Hide the menu completely
   */
  hide() {
    this.isVisible = false;
    this.isExpanded = false;
    this.element.classList.remove('node-action-menu--visible', 'node-action-menu--expanded');
  }

  /**
   * Expand the menu to show action buttons
   */
  expand() {
    if (!this.isVisible) return;

    // Small delay for smoother animation sequence
    requestAnimationFrame(() => {
      this.element.classList.add('node-action-menu--expanded');
      this.isExpanded = true;
    });
  }

  /**
   * Collapse the menu (hide action buttons)
   */
  collapse() {
    this.element.classList.remove('node-action-menu--expanded');
    this.isExpanded = false;
  }

  /**
   * Capitalize and clean up feature names
   * @param {string} str
   * @returns {string}
   */
  capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ') : '';
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.responsiveUnsubscribe) {
      this.responsiveUnsubscribe();
      this.responsiveUnsubscribe = null;
    }

    if (this.element?.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }

    this.element = null;
    this.currentNode = null;
  }
}
