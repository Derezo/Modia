/**
 * @module WorldMapNodeRenderer
 * @description Handles all visual rendering of world map nodes.
 *
 * Key responsibilities:
 * - Node sprite rendering with proper sizing
 * - Node color and icon determination
 * - Visual state rendering (visited, blocked, cleared, mystery)
 * - Region tint overlays
 * - Glow effects for important/current nodes
 * - Watchtower-revealed node rendering
 * - Canvas-based tooltip fallback rendering
 *
 * @see WorldMapScene.js - Main scene orchestration
 * @see WorldMapEffects.js - Glow and particle effects
 * @see NodeHoverTooltip.js - DOM-based hover tooltips
 */

import { COMBAT_NODE_TYPES } from '@shared/constants.js';
import { responsive } from '../core/Responsive.js';

// Region colors by race - used for node tinting and boundary rendering
const REGION_COLORS = {
  human: { primary: '#8B7355', secondary: '#A08060', border: '#6B5335' },    // Brown/earth
  elf: { primary: '#2E8B57', secondary: '#3A9D68', border: '#1E6B40' },      // Forest green
  dwarf: { primary: '#708090', secondary: '#8090A0', border: '#506070' },    // Slate gray
  vampire: { primary: '#4B0082', secondary: '#5B1092', border: '#3A0062' },  // Indigo/purple
  orc: { primary: '#8B0000', secondary: '#9B1010', border: '#6B0000' }       // Dark red
};

// Node glow colors by type
const NODE_GLOW_COLORS = {
  castle: '#c0c0c0',
  city: '#4a90d9',
  village: '#4a7c4a',
  forest: '#2d5a2d',
  cave: '#5a5a7a',
  mountain: '#7a7a9a',
  bridge: '#8b7355',
  guild: '#9a6acd',
  palace: '#ffd700'
};

// Node sprite sizes by type (important nodes are larger)
const NODE_SPRITE_SIZES = {
  castle: 56,
  city: 52,
  village: 44,
  forest: 44,
  cave: 44,
  mountain: 52,
  bridge: 44,
  palace: 64,
  guild_warrior: 44,
  guild_wizard: 44,
  guild_monk: 44,
  guild_chemist: 44
};

// Node base colors for fallback circle rendering
const NODE_COLORS = {
  // Settlements
  castle: '#8b4513',
  city: '#4a4a6a',
  village: '#2e7d32',
  keep: '#6d4c41',
  palace: '#c9a227',
  // Battle terrain
  forest: '#1b5e20',
  cave: '#37474f',
  mountain: '#5d4037',
  bridge: '#795548',
  // Activity nodes
  fishing_spot: '#4682b4',
  fishing: '#4682b4',
  ruins: '#696969',
  watchtower: '#a0522d',
  farm: '#9acd32',
  caravan: '#cd853f',
  merchant_caravan: '#cd853f',
  // Terminators
  chest: '#daa520',
  shrine: '#9370db',
  discovery: '#20b2aa',
  // Commerce
  tavern: '#8b4513',
  shop: '#daa520',
  blacksmith: '#4a4a4a',
  apothecary: '#228b22',
  // Guilds
  guild: '#7b1fa2',
  guild_warrior: '#b22222',
  guild_wizard: '#4169e1',
  guild_monk: '#ffd700',
  guild_chemist: '#32cd32'
};

// Node icons for fallback rendering (emoji)
const NODE_ICONS = {
  // Settlements
  castle: '\u{1F3F0}',
  city: '\u{1F3DB}\uFE0F',
  village: '\u{1F3D8}\uFE0F',
  keep: '\u{1F3EF}',
  palace: '\u{1F451}',
  // Battle terrain
  forest: '\u{1F332}',
  cave: '\u{1F573}\uFE0F',
  mountain: '\u26F0\uFE0F',
  bridge: '\u{1F309}',
  // Activity nodes
  fishing_spot: '\u{1F3A3}',
  fishing: '\u{1F3A3}',
  ruins: '\u{1F3DA}\uFE0F',
  watchtower: '\u{1F5FC}',
  farm: '\u{1F33E}',
  caravan: '\u{1F42B}',
  merchant_caravan: '\u{1F42B}',
  // Terminators
  chest: '\u{1F4E6}',
  shrine: '\u26E9\uFE0F',
  discovery: '\u2728',
  // Commerce
  tavern: '\u{1F37A}',
  shop: '\u{1F3EA}',
  blacksmith: '\u2692\uFE0F',
  apothecary: '\u2697\uFE0F',
  // Guilds
  guild: '\u2694\uFE0F',
  guild_warrior: '\u2694\uFE0F',
  guild_wizard: '\u{1F52E}',
  guild_monk: '\u262F\uFE0F',
  guild_chemist: '\u2697\uFE0F'
};

export class WorldMapNodeRenderer {
  /**
   * @param {Object} scene - WorldMapScene instance
   */
  constructor(scene) {
    this.scene = scene;
  }

  /**
   * Get the game instance from scene
   * @returns {Object} Game instance
   */
  get game() {
    return this.scene.game;
  }

  /**
   * Get the asset loader from scene
   * @returns {Object} AssetLoader instance
   */
  get assetLoader() {
    return this.scene.assetLoader;
  }

  /**
   * Get the effects system from scene
   * @returns {Object} WorldMapEffects instance
   */
  get effects() {
    return this.scene.effects;
  }

  /**
   * Get glow color for node type
   * @param {string} nodeType - Node type identifier
   * @returns {string} Hex color for glow effect
   */
  getNodeGlowColor(nodeType) {
    return NODE_GLOW_COLORS[nodeType] || '#4a4a6a';
  }

  /**
   * Get sprite size based on node type (important nodes are larger)
   * @param {string} nodeType - Node type identifier
   * @returns {number} Sprite size in pixels
   */
  getNodeSpriteSize(nodeType) {
    return NODE_SPRITE_SIZES[nodeType] || 44;
  }

  /**
   * Get node sprite from asset loader
   * @param {string} nodeType - Node type identifier
   * @returns {HTMLImageElement|null} Sprite image or null
   */
  getNodeSprite(nodeType) {
    if (!this.assetLoader) return null;

    // Handle guild nodes specially
    if (nodeType.startsWith('guild_')) {
      const guildClass = nodeType.replace('guild_', '');
      return this.assetLoader.getNodeSprite('guild', guildClass);
    }

    return this.assetLoader.getNodeSprite(nodeType);
  }

  /**
   * Get node color for fallback rendering
   * @param {string} type - Node type identifier
   * @returns {string} Hex color
   */
  getNodeColor(type) {
    return NODE_COLORS[type] || '#4a4a6a';
  }

  /**
   * Get node icon for fallback rendering
   * @param {string} type - Node type
   * @param {boolean} isVisited - Whether the node has been visited
   * @returns {string} Icon character
   */
  getNodeIcon(type, isVisited = true) {
    // Mystery nodes show "?" instead of type icon
    if (!isVisited) {
      return '?';
    }

    return NODE_ICONS[type] || '\u{1F4CD}';
  }

  /**
   * Get region color for race
   * @param {string} race - Race identifier
   * @returns {Object} Color object with primary, secondary, border
   */
  getRegionColor(race) {
    return REGION_COLORS[race] || REGION_COLORS.human;
  }

  /**
   * Check if a node is adjacent to the current node
   * @param {Object} node - Node to check
   * @returns {boolean} True if adjacent
   */
  isNodeAdjacent(node) {
    return this.scene.isNodeAdjacent(node);
  }

  /**
   * Check if a node has been discovered
   * @param {Object} node - Node to check
   * @returns {boolean} True if discovered
   */
  isNodeDiscovered(node) {
    return this.scene.isNodeDiscovered(node);
  }

  /**
   * Render a single node with all visual states
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {Object} node - Node data
   * @param {number} x - Screen X position
   * @param {number} y - Screen Y position
   */
  renderNode(ctx, node, x, y) {
    const { scene } = this;
    const isCurrent = scene.currentNode && node.id === scene.currentNode.id;
    const isHovered = scene.hoveredNode && node.id === scene.hoveredNode.id;
    const isAdjacent = this.isNodeAdjacent(node);
    const isImportant = ['castle', 'palace', 'city'].includes(node.node_type);
    const isVisited = node.visited;
    const isMystery = !isVisited && !isCurrent;  // Discovered but not visited = mystery

    // Render glow effect for important/selected nodes (skip for mystery nodes)
    if (this.effects && (isCurrent || isImportant) && !isMystery) {
      const glowColor = isCurrent ? '#ffd700' : this.getNodeGlowColor(node.node_type);
      this.effects.renderNodeGlow(ctx, x, y, scene.nodeSize, glowColor, isCurrent || isImportant);
    }

    // Try to render node sprite (but not for mystery nodes - they get a generic marker)
    const nodeSprite = isMystery ? null : this.getNodeSprite(node.node_type);

    if (nodeSprite) {
      this.renderSpriteNode(ctx, node, x, y, nodeSprite, {
        isCurrent,
        isHovered,
        isAdjacent,
        isVisited,
        isMystery
      });
    } else {
      this.renderFallbackNode(ctx, node, x, y, {
        isCurrent,
        isHovered,
        isAdjacent,
        isVisited,
        isMystery
      });
    }
  }

  /**
   * Render node using sprite
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {Object} node - Node data
   * @param {number} x - Screen X position
   * @param {number} y - Screen Y position
   * @param {HTMLImageElement} sprite - Node sprite
   * @param {Object} state - Node visual state flags
   */
  renderSpriteNode(ctx, node, x, y, sprite, state) {
    const { scene } = this;
    const { isCurrent, isAdjacent, isMystery } = state;

    const spriteSize = this.getNodeSpriteSize(node.node_type);
    const drawSize = isCurrent ? spriteSize + 8 : spriteSize;
    const offset = drawSize / 2;

    // Draw shadow under sprite
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.filter = 'blur(4px)';
    ctx.drawImage(sprite, x - offset + 3, y - offset + 3, drawSize, drawSize);
    ctx.restore();

    // Draw main sprite
    ctx.drawImage(sprite, x - offset, y - offset, drawSize, drawSize);

    // Draw region color tint overlay (subtle ring around node)
    if (scene.showRegionTint && node.region_race && !isCurrent) {
      const regionColors = this.getRegionColor(node.region_race);
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = regionColors.primary;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, drawSize / 2 + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Draw selection ring (only for adjacent nodes, not current - character sprite shows current location)
    if (isAdjacent) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, drawSize / 2 + 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(106, 176, 243, 0.6)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.restore();
    }

    // Draw blocked/cleared indicator for combat nodes (only for VISITED nodes)
    // Mystery/undiscovered nodes should not reveal blocked status
    const isCombatNode = COMBAT_NODE_TYPES.includes(node.node_type);
    if (isCombatNode && !isCurrent && !isMystery) {
      this.renderCombatIndicator(ctx, node, x, y, drawSize, true);
    }
  }

  /**
   * Render node using fallback (colored circle with icon)
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {Object} node - Node data
   * @param {number} x - Screen X position
   * @param {number} y - Screen Y position
   * @param {Object} state - Node visual state flags
   */
  renderFallbackNode(ctx, node, x, y, state) {
    const { scene } = this;
    const { isCurrent, isHovered, isAdjacent, isVisited, isMystery } = state;

    // Draw colored circle
    ctx.beginPath();
    ctx.arc(x, y, scene.nodeSize, 0, Math.PI * 2);

    if (isMystery) {
      // Mystery node: grayed out appearance
      ctx.fillStyle = isHovered ? '#7a7a8a' : '#5a5a6a';
    } else if (isHovered && isAdjacent) {
      ctx.fillStyle = '#4a90d9';
    } else {
      ctx.fillStyle = this.getNodeColor(node.node_type);
    }
    ctx.fill();

    // Node border - mystery nodes have purple tint
    if (isMystery) {
      ctx.strokeStyle = isAdjacent ? '#8a7ab3' : '#4a4a5a';
    } else {
      ctx.strokeStyle = isAdjacent ? '#6ab0f3' : '#2a2a4a';
    }
    ctx.lineWidth = 2;
    ctx.stroke();

    // Node icon - mystery nodes show "?" (isolated state for text properties)
    ctx.save();
    ctx.fillStyle = isMystery ? '#9a9aaa' : '#fff';
    ctx.font = isMystery ? 'bold 18px Arial' : '16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.getNodeIcon(node.node_type, isVisited), x, y);
    ctx.restore();

    // Draw blocked/cleared indicator for combat nodes (fallback style)
    const isCombatNode = COMBAT_NODE_TYPES.includes(node.node_type);
    if (isCombatNode && !isCurrent && !isMystery) {
      this.renderCombatIndicator(ctx, node, x, y, scene.nodeSize, false);
    }
  }

  /**
   * Render combat node blocked/cleared indicator
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {Object} node - Node data
   * @param {number} x - Screen X position
   * @param {number} y - Screen Y position
   * @param {number} size - Node size
   * @param {boolean} isSprite - Whether using sprite rendering
   */
  renderCombatIndicator(ctx, node, x, y, size, isSprite) {
    if (node.blocked) {
      if (isSprite) {
        // Red tint overlay for blocked nodes
        ctx.save();
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = '#ff4444';
        ctx.beginPath();
        ctx.arc(x, y, size / 2 + 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Lock icon
        ctx.save();
        ctx.fillStyle = '#ff4444';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('\u{1F512}', x, y - size / 2 - 2);
        ctx.restore();
      } else {
        // Red border for blocked (fallback)
        ctx.save();
        ctx.strokeStyle = '#ff4444';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.restore();
      }
    } else if (node.cleared) {
      // Green checkmark for cleared nodes
      ctx.save();
      ctx.fillStyle = '#44ff44';
      ctx.font = isSprite ? 'bold 14px Arial' : 'bold 12px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('\u2713', x, y - size / 2 - (isSprite ? 2 : 4));
      ctx.restore();
    }
  }

  /**
   * Render watchtower-revealed nodes at reduced opacity
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   */
  renderWatchtowerRevealedNodes(ctx) {
    const { scene } = this;
    if (!scene.watchtowerView) return;

    const { revealedNodes } = scene.watchtowerView;

    // Create set of already-discovered node IDs for quick lookup
    const discoveredNodeIds = new Set(scene.nodes.map(n => n.id));

    for (const node of revealedNodes) {
      // Skip nodes that are already in the main nodes list (already discovered)
      if (discoveredNodeIds.has(node.id)) {
        continue;
      }

      const x = node.x_coord * scene.nodeSpacing + scene.cameraX;
      const y = node.y_coord * scene.nodeSpacing + scene.cameraY;

      // Skip if off screen
      if (x < -50 || x > this.game.targetWidth + 50 || y < -50 || y > this.game.targetHeight + 50) {
        continue;
      }

      ctx.save();
      ctx.globalAlpha = 0.5;

      // Try to render node sprite at reduced opacity
      const nodeSprite = this.getNodeSprite(node.node_type);

      if (nodeSprite) {
        this.renderWatchtowerSpriteNode(ctx, node, x, y, nodeSprite);
      } else {
        this.renderWatchtowerFallbackNode(ctx, node, x, y);
      }

      // Draw node name
      this.renderWatchtowerNodeName(ctx, node, x, y);

      ctx.restore();
    }
  }

  /**
   * Render watchtower-revealed node with sprite
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {Object} node - Node data
   * @param {number} x - Screen X position
   * @param {number} y - Screen Y position
   * @param {HTMLImageElement} sprite - Node sprite
   */
  renderWatchtowerSpriteNode(ctx, node, x, y, sprite) {
    const spriteSize = this.getNodeSpriteSize(node.node_type);
    const offset = spriteSize / 2;

    // Draw shadow under sprite
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.filter = 'blur(4px)';
    ctx.drawImage(sprite, x - offset + 3, y - offset + 3, spriteSize, spriteSize);
    ctx.restore();

    // Draw main sprite at 50% opacity
    ctx.globalAlpha = 0.5;
    ctx.drawImage(sprite, x - offset, y - offset, spriteSize, spriteSize);

    // Draw watchtower reveal indicator (subtle golden ring)
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.4)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(x, y, spriteSize / 2 + 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /**
   * Render watchtower-revealed node with fallback (colored circle)
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {Object} node - Node data
   * @param {number} x - Screen X position
   * @param {number} y - Screen Y position
   */
  renderWatchtowerFallbackNode(ctx, node, x, y) {
    const { scene } = this;

    ctx.beginPath();
    ctx.arc(x, y, scene.nodeSize, 0, Math.PI * 2);
    ctx.fillStyle = this.getNodeColor(node.node_type);
    ctx.fill();

    // Golden border for watchtower-revealed nodes
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Node icon
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.font = '16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.getNodeIcon(node.node_type, true), x, y);
  }

  /**
   * Render watchtower-revealed node name label
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {Object} node - Node data
   * @param {number} x - Screen X position
   * @param {number} y - Screen Y position
   */
  renderWatchtowerNodeName(ctx, node, x, y) {
    const { scene } = this;
    const displayName = node.name || '?';

    ctx.font = `bold ${responsive.getCanvasFontSize('sm')}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // Text shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillText(displayName, x + 1, y + scene.nodeSize + 5);

    // Main text - golden/amber for watchtower-revealed (undiscovered), white for discovered
    ctx.fillStyle = node.discovered ? 'rgba(255, 255, 255, 0.8)' : 'rgba(255, 220, 130, 0.9)';
    ctx.fillText(displayName, x, y + scene.nodeSize + 4);
  }

  /**
   * Render node tooltip with name and travel info (canvas fallback)
   * Shows "Undiscovered" for discovered-but-unvisited mystery nodes
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {Object} node - Node data
   * @param {number} x - Screen X position
   * @param {number} y - Screen Y position
   * @param {boolean} isCurrent - Whether this is the current node
   */
  renderNodeTooltip(ctx, node, x, y, isCurrent) {
    const { scene } = this;
    const isVisited = node.visited;
    const isDiscovered = this.isNodeDiscovered(node);

    // Mystery nodes show "Undiscovered" instead of actual name
    const nodeName = (isDiscovered && !isVisited && !isCurrent) ? 'Undiscovered' : node.name;

    // Calculate tooltip content
    let costLine = null;

    if (!isCurrent) {
      if (!isDiscovered) {
        // Completely undiscovered - shouldn't normally be shown
        costLine = { text: 'Unknown territory', color: '#8a6a6a' };
      } else if (!isVisited) {
        // Mystery node - discovered but not visited
        costLine = { text: 'Mystery location', color: '#6a6a8a' };
      } else if (scene.previewCannotReach) {
        // Cannot reach from origin (origin is blocked)
        costLine = { text: 'Clear area first', color: '#800040' };
      } else if (scene.previewPathBlocked) {
        // Path is blocked by intermediate node
        costLine = { text: 'Path blocked', color: '#ff8c00' };
      } else if (scene.previewCost > 0) {
        if (scene.previewAffordable) {
          costLine = { text: `${scene.previewCost} stamina`, color: '#6a8a6a' };
        } else {
          const currentStamina = scene.hudPanel?.staminaSegment?.current || 0;
          costLine = { text: `Need ${scene.previewCost - currentStamina} more stamina`, color: '#c54545' };
        }
      }
    }

    // Add blocked indicator if destination is blocked (only for VISITED nodes)
    // Undiscovered blocked nodes should still show "Mystery location"
    const isCombatNode = COMBAT_NODE_TYPES.includes(node.node_type);
    if (isCombatNode && node.blocked && !isCurrent && isVisited) {
      costLine = { text: 'Blocked - defeat enemies first', color: '#ff4444' };
    }

    // Measure text
    ctx.font = 'bold 12px Arial';
    const nameWidth = ctx.measureText(nodeName).width;
    let tooltipWidth = nameWidth + 16;

    if (costLine) {
      ctx.font = `${responsive.getCanvasFontSize('sm')}px Arial`;
      const costWidth = ctx.measureText(costLine.text).width;
      tooltipWidth = Math.max(tooltipWidth, costWidth + 16);
    }

    const tooltipHeight = costLine ? 36 : 22;
    const tooltipY = y + scene.nodeSize + 8;

    // Draw background - mystery nodes have slightly different style
    const isMystery = isDiscovered && !isVisited && !isCurrent;
    ctx.fillStyle = isMystery ? 'rgba(50, 45, 60, 0.9)' : 'rgba(40, 30, 20, 0.9)';
    const radius = 4;
    const tx = x - tooltipWidth / 2;

    // Draw rounded rectangle
    ctx.beginPath();
    ctx.moveTo(tx + radius, tooltipY);
    ctx.lineTo(tx + tooltipWidth - radius, tooltipY);
    ctx.quadraticCurveTo(tx + tooltipWidth, tooltipY, tx + tooltipWidth, tooltipY + radius);
    ctx.lineTo(tx + tooltipWidth, tooltipY + tooltipHeight - radius);
    ctx.quadraticCurveTo(tx + tooltipWidth, tooltipY + tooltipHeight, tx + tooltipWidth - radius, tooltipY + tooltipHeight);
    ctx.lineTo(tx + radius, tooltipY + tooltipHeight);
    ctx.quadraticCurveTo(tx, tooltipY + tooltipHeight, tx, tooltipY + tooltipHeight - radius);
    ctx.lineTo(tx, tooltipY + radius);
    ctx.quadraticCurveTo(tx, tooltipY, tx + radius, tooltipY);
    ctx.closePath();
    ctx.fill();

    // Draw border - mystery nodes have purple tint
    ctx.strokeStyle = isMystery ? 'rgba(120, 100, 150, 0.6)' : 'rgba(139, 115, 85, 0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Draw name - mystery nodes are grayed
    ctx.font = 'bold 12px Arial';
    ctx.fillStyle = isCurrent ? '#ffd700' : (isMystery ? '#9a9aaa' : '#e0d0b0');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(nodeName, x, tooltipY + 4);

    // Draw cost line
    if (costLine) {
      ctx.font = `${responsive.getCanvasFontSize('sm')}px Arial`;
      ctx.fillStyle = costLine.color;
      ctx.fillText(costLine.text, x, tooltipY + 20);
    }
  }

  /**
   * Dispose of renderer resources
   */
  dispose() {
    // Currently no resources to dispose
  }
}
