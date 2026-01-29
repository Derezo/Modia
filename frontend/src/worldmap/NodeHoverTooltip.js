/**
 * NodeHoverTooltip - Rich hover tooltip for world map nodes
 *
 * Shows contextual information when hovering over non-current nodes.
 * Uses progressive disclosure:
 * - Level 1 (immediate): Node name, type icon, stamina cost
 * - Level 2 (200ms delay): Extended info based on node category
 *
 * Categories:
 * - Combat: Enemy level range, loot tier, blocked status
 * - Settlement: Service icons, guild info
 * - Activity: Reward preview, cooldown status
 * - Special: Unique mechanic description
 */

import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentShadow
} from '../ui/parchment/ParchmentTheme.js';
import { Icon } from '../components/Icon.js';
import { responsive } from '../core/Responsive.js';
import { ZODIAC_SHRINE_BUFFS, ZODIAC_CRYSTALS } from '@shared/constants.js';

const STYLE_ID = 'node-hover-tooltip-styles';

// Element colors for zodiac
const ELEMENT_COLORS = {
  fire: '#ff6b4a',
  earth: '#4a8b4a',
  air: '#4aafcf',
  water: '#4a6acf'
};

// Node category mappings
const COMBAT_NODES = ['forest', 'cave', 'mountain', 'bridge'];
const SETTLEMENT_NODES = ['castle', 'city', 'village', 'palace', 'keep', 'guild'];
const ACTIVITY_NODES = ['shrine', 'merchant_caravan', 'ruins', 'fishing_spot', 'watchtower'];
const SPECIAL_NODES = ['chest', 'discovery'];

// Node type display names and icons
const NODE_TYPE_INFO = {
  forest: { name: 'Forest', icon: 'terrain', color: '#4a8a4a' },
  cave: { name: 'Cave', icon: 'terrain', color: '#6a6a8a' },
  mountain: { name: 'Mountain', icon: 'terrain', color: '#8a7a6a' },
  bridge: { name: 'Bridge', icon: 'terrain', color: '#7a6a5a' },
  castle: { name: 'Castle', icon: 'settlement', color: '#b87333' },
  city: { name: 'City', icon: 'settlement', color: '#8a7a6a' },
  village: { name: 'Village', icon: 'settlement', color: '#6a8a6a' },
  palace: { name: 'Palace', icon: 'settlement', color: '#ffd700' },
  keep: { name: 'Keep', icon: 'settlement', color: '#708090' },
  guild: { name: 'Guild Hall', icon: 'settlement', color: '#8b4513' },
  shrine: { name: 'Shrine', icon: 'special', color: '#9370db' },
  merchant_caravan: { name: 'Caravan', icon: 'special', color: '#b87333' },
  ruins: { name: 'Ruins', icon: 'special', color: '#6b5344' },
  fishing_spot: { name: 'Fishing', icon: 'special', color: '#4682b4' },
  watchtower: { name: 'Watchtower', icon: 'special', color: '#708090' },
  chest: { name: 'Treasure', icon: 'special', color: '#ffd700' },
  discovery: { name: 'Discovery', icon: 'special', color: '#daa520' }
};

// Feature icons for settlements - use menu category for location icons
const FEATURE_ICONS = {
  blacksmith: { category: 'menu', name: 'shop', label: 'Blacksmith' },
  marketplace: { category: 'menu', name: 'shop', label: 'Marketplace' },
  tavern: { category: 'menu', name: 'tavern', label: 'Tavern' },
  apothecary: { category: 'menu', name: 'shop', label: 'Apothecary' },
  coliseum: { category: 'menu', name: 'coliseum', label: 'Coliseum' },
  guild_hall: { category: 'menu', name: 'guild', label: 'Guild Hall' },
  courtyard: { category: 'menu', name: 'party', label: 'Courtyard' }
};

// Extended delay for showing full tooltip (ms)
const EXTENDED_DELAY = 200;

export class NodeHoverTooltip {
  /**
   * @param {Object} options
   * @param {Object} options.game - Game instance for API access
   */
  constructor(options) {
    this.game = options.game;

    this.element = null;
    this.currentNode = null;
    this.isVisible = false;
    this.isExtended = false;
    this.extendedTimer = null;

    // Mobile support
    this.isMobile = responsive.isMobile();

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
      /* Base container */
      .node-hover-tooltip {
        position: absolute;
        pointer-events: none;
        z-index: 90;
        transform: translateX(-50%);
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.15s ease-out, visibility 0.15s ease-out;
        will-change: transform, opacity;
      }

      .node-hover-tooltip--visible {
        opacity: 1;
        visibility: visible;
      }

      /* Main tooltip card */
      .node-hover-tooltip__card {
        background: ${getParchmentGradient('to bottom')};
        border: ${getParchmentBorder()};
        border-radius: 6px;
        box-shadow: ${getParchmentShadow()};
        padding: 8px 12px;
        min-width: 120px;
        max-width: 220px;
      }

      /* Header row: name + type badge */
      .node-hover-tooltip__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 4px;
      }

      .node-hover-tooltip__name {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: 13px;
        font-weight: bold;
        color: ${PARCHMENT_COLORS.text.primary};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 140px;
      }

      .node-hover-tooltip__name--mystery {
        color: ${PARCHMENT_COLORS.text.muted};
        font-style: italic;
      }

      .node-hover-tooltip__type {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 2px 6px;
        border-radius: 10px;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        white-space: nowrap;
      }

      .node-hover-tooltip__type-icon {
        width: 12px;
        height: 12px;
        border-radius: 50%;
      }

      /* Status line (stamina cost, blocked, etc.) */
      .node-hover-tooltip__status {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: 11px;
        padding: 2px 0;
      }

      .node-hover-tooltip__status--affordable {
        color: ${PARCHMENT_COLORS.state.success};
      }

      .node-hover-tooltip__status--expensive {
        color: ${PARCHMENT_COLORS.state.error};
      }

      .node-hover-tooltip__status--blocked {
        color: #ff8c00;
      }

      .node-hover-tooltip__status--muted {
        color: ${PARCHMENT_COLORS.text.muted};
      }

      /* Extended info section */
      .node-hover-tooltip__extended {
        max-height: 0;
        overflow: hidden;
        opacity: 0;
        transition: max-height 0.2s ease-out, opacity 0.15s ease-out;
        border-top: 1px solid transparent;
        margin-top: 0;
        padding-top: 0;
      }

      .node-hover-tooltip--extended .node-hover-tooltip__extended {
        max-height: 150px;
        opacity: 1;
        border-top-color: ${PARCHMENT_COLORS.border};
        margin-top: 6px;
        padding-top: 6px;
      }

      /* Extended info rows */
      .node-hover-tooltip__row {
        display: flex;
        align-items: center;
        gap: 6px;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: 11px;
        color: ${PARCHMENT_COLORS.text.secondary};
        margin-bottom: 4px;
      }

      .node-hover-tooltip__row:last-child {
        margin-bottom: 0;
      }

      .node-hover-tooltip__row-label {
        color: ${PARCHMENT_COLORS.text.muted};
        min-width: 50px;
      }

      .node-hover-tooltip__row-value {
        color: ${PARCHMENT_COLORS.text.primary};
        font-weight: 600;
      }

      /* Feature icons row */
      .node-hover-tooltip__features {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 4px;
      }

      .node-hover-tooltip__feature {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        background: rgba(139, 115, 85, 0.15);
        border-radius: 4px;
      }

      .node-hover-tooltip__feature img {
        width: 14px;
        height: 14px;
        opacity: 0.9;
      }

      /* Position variants */
      .node-hover-tooltip--above {
        transform: translateX(-50%) translateY(-100%);
      }

      /* Mobile adjustments */
      @media (max-width: 768px) {
        .node-hover-tooltip__card {
          padding: 6px 10px;
          min-width: 100px;
        }

        .node-hover-tooltip__name {
          font-size: 12px;
          max-width: 100px;
        }

        .node-hover-tooltip__type {
          font-size: 9px;
          padding: 1px 4px;
        }

        .node-hover-tooltip__status,
        .node-hover-tooltip__row {
          font-size: 10px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Create the DOM structure
   */
  createElement() {
    this.element = document.createElement('div');
    this.element.className = 'node-hover-tooltip';

    const card = document.createElement('div');
    card.className = 'node-hover-tooltip__card';

    // Header
    this.headerElement = document.createElement('div');
    this.headerElement.className = 'node-hover-tooltip__header';

    this.nameElement = document.createElement('span');
    this.nameElement.className = 'node-hover-tooltip__name';

    this.typeElement = document.createElement('span');
    this.typeElement.className = 'node-hover-tooltip__type';

    this.headerElement.appendChild(this.nameElement);
    this.headerElement.appendChild(this.typeElement);
    card.appendChild(this.headerElement);

    // Status line
    this.statusElement = document.createElement('div');
    this.statusElement.className = 'node-hover-tooltip__status';
    card.appendChild(this.statusElement);

    // Extended info container
    this.extendedElement = document.createElement('div');
    this.extendedElement.className = 'node-hover-tooltip__extended';
    card.appendChild(this.extendedElement);

    this.element.appendChild(card);
  }

  /**
   * Setup responsive listener
   */
  setupResponsive() {
    this.responsiveUnsubscribe = responsive.onChange(() => {
      this.isMobile = responsive.isMobile();
    });
  }

  /**
   * Show tooltip for a node
   * @param {Object} node - Node data
   * @param {number} screenX - X position in viewport
   * @param {number} screenY - Y position in viewport
   * @param {Object} context - Additional context
   * @param {number} context.nodeSize - Node sprite size
   * @param {number} context.canvasHeight - Canvas display height
   * @param {number} context.previewCost - Stamina cost to travel
   * @param {boolean} context.previewAffordable - Whether travel is affordable
   * @param {boolean} context.previewPathBlocked - Whether path is blocked
   * @param {boolean} context.previewCannotReach - Whether origin is blocked
   * @param {boolean} context.isDiscovered - Whether node is discovered
   * @param {boolean} context.isVisited - Whether node is visited
   */
  show(node, screenX, screenY, context = {}) {
    if (!node) {
      this.hide();
      return;
    }

    // Skip if same node and already visible
    if (this.currentNode?.id === node.id && this.isVisible) {
      this.updatePosition(screenX, screenY, context.nodeSize, context.canvasHeight);
      return;
    }

    this.currentNode = node;
    this.isExtended = false;
    this.element.classList.remove('node-hover-tooltip--extended');

    // Clear any pending extended timer
    if (this.extendedTimer) {
      clearTimeout(this.extendedTimer);
      this.extendedTimer = null;
    }

    // Render Level 1 content
    this.renderQuickInfo(node, context);

    // Position and show
    this.updatePosition(screenX, screenY, context.nodeSize, context.canvasHeight);
    this.isVisible = true;
    this.element.classList.add('node-hover-tooltip--visible');

    // Schedule Level 2 extended info
    const delay = this.isMobile ? 300 : EXTENDED_DELAY;
    this.extendedTimer = setTimeout(() => {
      this.showExtended(node, context);
    }, delay);
  }

  /**
   * Show extended info (Level 2)
   * @param {Object} node
   * @param {Object} context
   */
  showExtended(node, context) {
    if (!this.isVisible || this.currentNode?.id !== node.id) {
      return;
    }

    this.renderExtendedInfo(node, context);
    this.isExtended = true;
    this.element.classList.add('node-hover-tooltip--extended');
  }

  /**
   * Hide tooltip
   */
  hide() {
    this.isVisible = false;
    this.isExtended = false;
    this.currentNode = null;
    this.element.classList.remove('node-hover-tooltip--visible', 'node-hover-tooltip--extended');

    if (this.extendedTimer) {
      clearTimeout(this.extendedTimer);
      this.extendedTimer = null;
    }
  }

  /**
   * Update tooltip position
   * @param {number} screenX
   * @param {number} screenY
   * @param {number} nodeSize
   * @param {number} canvasHeight
   */
  updatePosition(screenX, screenY, nodeSize = 30, canvasHeight = 600) {
    if (!this.isVisible) return;

    // Position below node by default
    let posY = screenY + nodeSize + 8;
    let flipAbove = false;

    // Check if too close to bottom
    const tooltipHeight = this.element.offsetHeight || 80;
    if (posY + tooltipHeight > canvasHeight - 20) {
      posY = screenY - nodeSize - 8;
      flipAbove = true;
    }

    this.element.style.left = `${screenX}px`;
    this.element.style.top = `${posY}px`;
    this.element.classList.toggle('node-hover-tooltip--above', flipAbove);
  }

  /**
   * Render Level 1 quick info
   * @param {Object} node
   * @param {Object} context
   */
  renderQuickInfo(node, context) {
    const { isDiscovered = true, isVisited = true } = context;
    const isMystery = isDiscovered && !isVisited;

    // Node name
    const displayName = isMystery ? 'Undiscovered' : node.name;
    this.nameElement.textContent = displayName;
    this.nameElement.classList.toggle('node-hover-tooltip__name--mystery', isMystery);

    // Node type badge
    const typeInfo = NODE_TYPE_INFO[node.node_type] || { name: node.node_type, color: '#8a8a8a' };
    this.typeElement.innerHTML = '';

    const typeIcon = document.createElement('span');
    typeIcon.className = 'node-hover-tooltip__type-icon';
    typeIcon.style.backgroundColor = typeInfo.color;
    this.typeElement.appendChild(typeIcon);

    const typeName = document.createElement('span');
    typeName.textContent = typeInfo.name;
    this.typeElement.appendChild(typeName);
    this.typeElement.style.backgroundColor = `${typeInfo.color}20`;
    this.typeElement.style.color = typeInfo.color;

    // Status line
    this.renderStatusLine(node, context);
  }

  /**
   * Render status line (stamina cost, blocked, etc.)
   * @param {Object} node
   * @param {Object} context
   */
  renderStatusLine(node, context) {
    const {
      previewCost = 0,
      previewAffordable = true,
      previewPathBlocked = false,
      previewCannotReach = false,
      isDiscovered = true,
      isVisited = true,
      currentStamina = 0
    } = context;

    let text = '';
    let statusClass = 'node-hover-tooltip__status--muted';

    if (!isDiscovered) {
      text = 'Unknown territory';
    } else if (!isVisited) {
      text = 'Mystery location';
    } else if (previewCannotReach) {
      text = 'Clear area first';
      statusClass = 'node-hover-tooltip__status--blocked';
    } else if (previewPathBlocked) {
      text = 'Path blocked';
      statusClass = 'node-hover-tooltip__status--blocked';
    } else if (COMBAT_NODES.includes(node.node_type) && node.blocked) {
      text = 'Defeat enemies first';
      statusClass = 'node-hover-tooltip__status--blocked';
    } else if (previewCost > 0) {
      if (previewAffordable) {
        text = `${previewCost} stamina`;
        statusClass = 'node-hover-tooltip__status--affordable';
      } else {
        const needed = previewCost - currentStamina;
        text = `Need ${needed} more stamina`;
        statusClass = 'node-hover-tooltip__status--expensive';
      }
    } else {
      text = 'Adjacent';
      statusClass = 'node-hover-tooltip__status--affordable';
    }

    this.statusElement.textContent = text;
    this.statusElement.className = `node-hover-tooltip__status ${statusClass}`;
  }

  /**
   * Render Level 2 extended info based on node category
   * @param {Object} node
   * @param {Object} context
   */
  renderExtendedInfo(node, context) {
    this.extendedElement.innerHTML = '';

    const { isVisited = true } = context;

    // Don't show extended info for mystery nodes
    if (!isVisited) {
      return;
    }

    if (COMBAT_NODES.includes(node.node_type)) {
      this.renderCombatInfo(node, context);
    } else if (SETTLEMENT_NODES.includes(node.node_type)) {
      this.renderSettlementInfo(node, context);
    } else if (ACTIVITY_NODES.includes(node.node_type)) {
      this.renderActivityInfo(node, context);
    } else if (SPECIAL_NODES.includes(node.node_type)) {
      this.renderSpecialInfo(node, context);
    }
  }

  /**
   * Render combat node info (enemy level, loot tier)
   * @param {Object} node
   * @param {Object} context
   */
  renderCombatInfo(node, _context) {
    // Difficulty tier
    if (node.difficulty_tier != null) {
      const tierNames = ['Easy', 'Medium', 'Hard', 'Elite'];
      const tierColors = ['#4a8a4a', '#b87333', '#8b4444', '#9370db'];
      const tier = Math.min(node.difficulty_tier, 3);
      this.addRow('Difficulty', tierNames[tier], tierColors[tier]);
    }

    // Enemy level range (estimated from node position)
    if (node.enemy_level_min != null && node.enemy_level_max != null) {
      this.addRow('Enemies', `Lv ${node.enemy_level_min}-${node.enemy_level_max}`);
    } else if (node.difficulty_tier != null) {
      // Estimate level range from difficulty tier
      const baseLevel = (node.difficulty_tier || 0) * 5 + 1;
      this.addRow('Enemies', `Lv ${baseLevel}-${baseLevel + 5}`);
    }

    // Cleared status
    if (node.cleared) {
      this.addRow('Status', 'Cleared', PARCHMENT_COLORS.state.success);
    } else if (node.blocked) {
      this.addRow('Status', 'Active Threat', PARCHMENT_COLORS.state.error);
    }
  }

  /**
   * Render settlement node info (features, guild)
   * @param {Object} node
   * @param {Object} context
   */
  renderSettlementInfo(node, _context) {
    // Guild class
    if (node.guild_class) {
      const guildNames = {
        warrior: 'Warrior Guild',
        mage: 'Mage Guild',
        rogue: 'Rogue Guild',
        cleric: 'Cleric Guild'
      };
      this.addRow('Guild', guildNames[node.guild_class] || node.guild_class);
    }

    // Features (show as icons)
    const features = node.features || [];
    if (features.length > 0) {
      const featuresContainer = document.createElement('div');
      featuresContainer.className = 'node-hover-tooltip__features';

      const showFeatures = features.slice(0, 6);
      showFeatures.forEach(feature => {
        const iconInfo = FEATURE_ICONS[feature];
        if (iconInfo) {
          const featureEl = document.createElement('div');
          featureEl.className = 'node-hover-tooltip__feature';
          featureEl.title = iconInfo.label;

          const iconHtml = Icon.html(iconInfo.category, iconInfo.name, { size: 'sm' });
          // Extract just the img, remove wrapper span
          featureEl.innerHTML = iconHtml.replace(/<span[^>]*>([^<]*)<\/span>/g, '');

          featuresContainer.appendChild(featureEl);
        }
      });

      if (features.length > 6) {
        const moreEl = document.createElement('span');
        moreEl.className = 'node-hover-tooltip__feature';
        moreEl.textContent = `+${features.length - 6}`;
        moreEl.style.fontSize = '9px';
        moreEl.style.color = PARCHMENT_COLORS.text.muted;
        featuresContainer.appendChild(moreEl);
      }

      this.extendedElement.appendChild(featuresContainer);
    }

    // Region info
    if (node.region_name) {
      this.addRow('Region', node.region_name);
    }
  }

  /**
   * Render activity node info (shrine, caravan, ruins, fishing, watchtower)
   * @param {Object} node
   * @param {Object} context
   */
  renderActivityInfo(node, _context) {
    switch (node.node_type) {
      case 'shrine':
        this.renderShrineInfo(node, _context);
        break;
      case 'merchant_caravan':
        this.addRow('Type', 'Traveling Merchant');
        this.addRow('Goods', 'Exotic Items');
        break;
      case 'ruins':
        this.addRow('Type', 'Ancient Ruins');
        this.addRow('Activity', 'Puzzle Challenge');
        break;
      case 'fishing_spot':
        this.addRow('Type', 'Fishing Spot');
        this.addRow('Activity', 'Auto-fishing');
        break;
      case 'watchtower':
        this.addRow('Type', 'Watchtower');
        this.addRow('Ability', 'Reveal nearby nodes');
        break;
    }
  }

  /**
   * Render shrine-specific info
   * @param {Object} node
   * @param {Object} context
   */
  renderShrineInfo(node, context) {
    const { zodiacCollection } = context;

    // Zodiac sign if applicable
    if (node.zodiac_sign) {
      const zodiacBuff = ZODIAC_SHRINE_BUFFS[node.zodiac_sign];
      const crystal = ZODIAC_CRYSTALS[node.zodiac_sign];
      const element = zodiacBuff?.element;
      const elementColor = element ? ELEMENT_COLORS[element] : null;

      // Show sign name with element color
      this.addRow('Sign', this.capitalize(node.zodiac_sign), elementColor);

      // Show blessing name
      if (zodiacBuff) {
        this.addRow('Blessing', zodiacBuff.name);
      }

      // Show crystal collection status if zodiacCollection is available
      if (zodiacCollection && crystal) {
        const isCollected = zodiacCollection.crystals?.find(
          c => c.sign === node.zodiac_sign && c.collected
        );
        if (isCollected) {
          this.addRow('Crystal', 'Collected', PARCHMENT_COLORS.state.success);
        } else {
          this.addRow('Crystal', 'Available', PARCHMENT_COLORS.accent.copper);
        }
      }
    } else {
      // Non-zodiac shrine
      if (node.buff_type) {
        const buffNames = {
          stamina_regen: "Pilgrim's Rest",
          exp_bonus: "Scholar's Insight",
          gold_bonus: "Merchant's Fortune"
        };
        this.addRow('Blessing', buffNames[node.buff_type] || node.buff_type);
      }
      this.addRow('Type', 'Sacred Shrine');
    }
  }

  /**
   * Render special node info (chest, discovery)
   * @param {Object} node
   * @param {Object} context
   */
  renderSpecialInfo(node, _context) {
    if (node.node_type === 'chest') {
      this.addRow('Type', 'Treasure Chest');
      if (node.opened) {
        this.addRow('Status', 'Already Opened', PARCHMENT_COLORS.text.muted);
      } else {
        this.addRow('Status', 'Unopened', PARCHMENT_COLORS.state.success);
      }
    } else if (node.node_type === 'discovery') {
      this.addRow('Type', 'Point of Interest');
      this.addRow('Reward', 'Exploration XP');
    }
  }

  /**
   * Add a row to extended info
   * @param {string} label
   * @param {string} value
   * @param {string} color - Optional value color
   */
  addRow(label, value, color = null) {
    const row = document.createElement('div');
    row.className = 'node-hover-tooltip__row';

    const labelEl = document.createElement('span');
    labelEl.className = 'node-hover-tooltip__row-label';
    labelEl.textContent = label + ':';

    const valueEl = document.createElement('span');
    valueEl.className = 'node-hover-tooltip__row-value';
    valueEl.textContent = value;
    if (color) {
      valueEl.style.color = color;
    }

    row.appendChild(labelEl);
    row.appendChild(valueEl);
    this.extendedElement.appendChild(row);
  }

  /**
   * Capitalize string
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
    if (this.extendedTimer) {
      clearTimeout(this.extendedTimer);
      this.extendedTimer = null;
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
