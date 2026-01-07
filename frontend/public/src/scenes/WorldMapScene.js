import { Scene } from './Scene.js';
import { WorldMapEffects } from '../worldmap/WorldMapEffects.js';

export class WorldMapScene extends Scene {
  constructor(game) {
    super(game);
    this.uiElement = null;
    this.nodes = [];
    this.connections = [];
    this.currentNode = null;
    this.hoveredNode = null;

    // Camera
    this.cameraX = 0;
    this.cameraY = 0;
    this.zoom = 1;
    this.dragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;

    // Node rendering
    this.nodeSize = 30;
    this.nodeSpacing = 60;

    // Asset loader reference
    this.assetLoader = null;

    // Effects system
    this.effects = null;

    // Event listener cleanup
    this.abortController = null;

    // WebSocket unsubscribers
    this.wsUnsubscribers = [];
  }

  async enter() {
    // Get asset loader reference from game
    this.assetLoader = this.game.assetLoader;

    // Initialize effects system
    this.effects = new WorldMapEffects(this.assetLoader);
    await this.effects.init();

    await this.loadWorldData();
    this.createUI();
    this.centerOnCurrentNode();
    this.setupInputHandlers();
    this.setupWebSocketHandlers();

    // Preload node sprites in background
    this.preloadNodeSprites();
  }

  /**
   * Preload node sprites for faster rendering
   */
  async preloadNodeSprites() {
    if (!this.assetLoader) return;

    try {
      await this.assetLoader.preloadNodes();
      console.log('Node sprites preloaded');
    } catch (error) {
      console.warn('Failed to preload node sprites:', error);
    }
  }

  exit() {
    // Abort all event listeners
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Clean up WebSocket handlers
    this.cleanupWebSocketHandlers();

    if (this.uiElement) {
      this.uiElement.remove();
      this.uiElement = null;
    }
  }

  async loadWorldData() {
    try {
      // Get world nodes and current position
      const [worldData, currentData] = await Promise.all([
        this.game.api.getWorldNodes(),
        this.game.api.getCurrentNode()
      ]);

      this.nodes = worldData.nodes;
      this.connections = worldData.connections;
      this.currentNode = currentData.currentNode;

      this.game.state.set('worldNodes', this.nodes);
      this.game.state.set('currentNode', this.currentNode);

      // Update discovery state for fog of war rendering
      if (this.effects) {
        this.effects.updateDiscoveryState(this.nodes);
      }
    } catch (err) {
      console.error('Failed to load world:', err);
      this.game.showNotification('Failed to load world data', 'error');
    }
  }

  centerOnCurrentNode() {
    if (this.currentNode) {
      const node = this.nodes.find(n => n.id === this.currentNode.id);
      if (node) {
        this.cameraX = -node.x_coord * this.nodeSpacing + this.game.canvas.width / 2;
        this.cameraY = -node.y_coord * this.nodeSpacing + this.game.canvas.height / 2;
      }
    }
  }

  createUI() {
    const container = document.createElement('div');
    container.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;';

    // Top bar with player info
    container.innerHTML = `
      <div style="
        position: absolute;
        top: 10px;
        left: 10px;
        pointer-events: auto;
      ">
        <div class="ui-panel" style="padding: 8px 12px;">
          <div style="font-weight: bold; color: #ffd700;">${this.game.state.get('user')?.username || 'Player'}</div>
          <div style="font-size: 12px; color: #8a8aaa;">Gold: ${this.game.state.get('user')?.gold || 0}</div>
        </div>
      </div>

      <!-- Menu button -->
      <div style="
        position: absolute;
        top: 10px;
        right: 10px;
        pointer-events: auto;
      ">
        <button class="btn btn-secondary" id="menu-btn">Menu</button>
      </div>

      <!-- Current node info -->
      <div id="node-info" style="
        position: absolute;
        bottom: 10px;
        left: 50%;
        transform: translateX(-50%);
        pointer-events: auto;
        display: none;
      ">
        <div class="ui-panel" style="text-align: center; min-width: 200px;">
          <div id="node-name" style="font-weight: bold; color: #ffd700; margin-bottom: 8px;"></div>
          <div id="node-type" style="font-size: 12px; color: #8a8aaa; margin-bottom: 8px;"></div>
          <div id="node-actions" style="display: flex; gap: 8px; justify-content: center;"></div>
        </div>
      </div>

      <!-- Menu panel (hidden by default) -->
      <div id="menu-panel" style="
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        pointer-events: auto;
        display: none;
      ">
        <div class="ui-panel" style="min-width: 250px;">
          <div class="ui-panel-header">Menu</div>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <button class="btn btn-secondary" id="formation-btn">Formation</button>
            <button class="btn btn-secondary" id="inventory-btn">Inventory</button>
            <button class="btn btn-secondary" id="characters-btn">Characters</button>
            <button class="btn btn-secondary" id="settings-btn">Settings</button>
            <button class="btn btn-danger" id="logout-btn">Logout</button>
          </div>
          <button class="btn btn-secondary" id="close-menu" style="width: 100%; margin-top: 12px;">Close</button>
        </div>
      </div>
    `;

    this.game.uiOverlay.appendChild(container);
    this.uiElement = container;

    // Event listeners
    container.querySelector('#menu-btn').addEventListener('click', () => this.toggleMenu());
    container.querySelector('#close-menu').addEventListener('click', () => this.toggleMenu());
    container.querySelector('#logout-btn').addEventListener('click', () => this.handleLogout());
    container.querySelector('#characters-btn').addEventListener('click', () => {
      this.toggleMenu();
      this.game.scenes.switchTo('characterSelect');
    });
    container.querySelector('#formation-btn').addEventListener('click', () => {
      this.toggleMenu();
      this.game.scenes.switchTo('formation');
    });
    container.querySelector('#inventory-btn').addEventListener('click', () => {
      this.toggleMenu();
      this.game.scenes.switchTo('inventory');
    });

    // Update current node display
    this.updateNodeInfo();
  }

  toggleMenu() {
    const panel = document.getElementById('menu-panel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  }

  async handleLogout() {
    try {
      await this.game.api.logout(this.game.refreshToken);
    } catch (err) {
      console.error('Logout error:', err);
    }

    this.game.socket.disconnect();
    this.game.state.clear();
    this.game.scenes.switchTo('login');
  }

  updateNodeInfo() {
    if (!this.currentNode) return;

    const nodeInfo = document.getElementById('node-info');
    const nodeName = document.getElementById('node-name');
    const nodeType = document.getElementById('node-type');
    const nodeActions = document.getElementById('node-actions');

    nodeInfo.style.display = 'block';
    nodeName.textContent = this.currentNode.name;
    nodeType.textContent = this.capitalize(this.currentNode.node_type);

    // Add action buttons based on node type and features
    nodeActions.innerHTML = '';

    const features = this.currentNode.features || [];
    if (Array.isArray(features)) {
      features.slice(0, 3).forEach(feature => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary';
        btn.textContent = this.capitalize(feature);
        btn.style.fontSize = '11px';
        btn.style.padding = '6px 10px';
        btn.addEventListener('click', () => this.handleFeature(feature));
        nodeActions.appendChild(btn);
      });
    }

    // Add battle button for battle nodes
    if (['forest', 'cave', 'mountain', 'bridge'].includes(this.currentNode.node_type)) {
      const battleBtn = document.createElement('button');
      battleBtn.className = 'btn btn-primary';
      battleBtn.textContent = 'Battle';
      battleBtn.style.fontSize = '11px';
      battleBtn.style.padding = '6px 10px';
      battleBtn.addEventListener('click', () => this.startBattle());
      nodeActions.appendChild(battleBtn);
    }
  }

  handleFeature(feature) {
    // Shop features open the shop scene
    const shopFeatures = {
      blacksmith: 'blacksmith',
      apothecary: 'apothecary',
      farm: 'farm'
    };

    if (shopFeatures[feature]) {
      this.game.scenes.switchTo('shop', {
        nodeId: this.currentNode.id,
        shopType: shopFeatures[feature]
      });
      return;
    }

    // Marketplace feature opens the marketplace scene
    if (feature === 'marketplace') {
      this.game.scenes.switchTo('marketplace');
      return;
    }

    // Tavern feature opens the tavern (social hub) scene
    if (feature === 'tavern') {
      this.game.scenes.switchTo('tavern');
      return;
    }

    // Other features not yet implemented
    this.game.showNotification(`${this.capitalize(feature)} - Coming soon!`, 'info');
  }

  async startBattle() {
    try {
      const result = await this.game.api.startBattle();
      this.game.scenes.switchTo('battle', result);
    } catch (err) {
      this.game.showNotification(err.message, 'error');
    }
  }

  /**
   * Setup WebSocket handlers for player movement events
   */
  setupWebSocketHandlers() {
    const socket = this.game.socket;
    if (!socket) return;

    // Join current node room
    if (this.currentNode?.id) {
      socket.joinNodeRoom(this.currentNode.id);
    }

    // Handle player entering current node
    const enteredUnsub = socket.on('player:entered_node', (payload) => {
      if (payload.nodeId === this.currentNode?.id) {
        this.game.showNotification(`${payload.username} arrived`, 'info');
      }
    });
    this.wsUnsubscribers.push(enteredUnsub);

    // Handle player leaving current node
    const leftUnsub = socket.on('player:left_node', (payload) => {
      if (payload.nodeId === this.currentNode?.id) {
        this.game.showNotification(`${payload.username} departed`, 'info');
      }
    });
    this.wsUnsubscribers.push(leftUnsub);

    // Handle party invites
    const inviteUnsub = socket.on('party:invite_received', (payload) => {
      this.game.showNotification(`Party invite from ${payload.fromUsername}`, 'info');
      // TODO: Show invite modal
    });
    this.wsUnsubscribers.push(inviteUnsub);
  }

  /**
   * Clean up WebSocket handlers
   */
  cleanupWebSocketHandlers() {
    // Unsubscribe from all events
    for (const unsub of this.wsUnsubscribers) {
      if (typeof unsub === 'function') {
        unsub();
      }
    }
    this.wsUnsubscribers = [];

    // Leave current node room
    if (this.game.socket && this.currentNode?.id) {
      this.game.socket.leaveNodeRoom(this.currentNode.id);
    }
  }

  setupInputHandlers() {
    const canvas = this.game.canvas;

    // Create abort controller for cleanup
    this.abortController = new AbortController();
    const opts = { signal: this.abortController.signal };

    canvas.addEventListener('mousedown', (e) => {
      this.dragging = true;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
    }, opts);

    canvas.addEventListener('mousemove', (e) => {
      if (this.dragging) {
        const dx = e.clientX - this.dragStartX;
        const dy = e.clientY - this.dragStartY;
        this.cameraX += dx / this.game.scale;
        this.cameraY += dy / this.game.scale;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
      }

      // Update hovered node
      const pos = this.game.input.getPointerPosition();
      this.hoveredNode = this.getNodeAtPosition(pos.x, pos.y);
    }, opts);

    canvas.addEventListener('mouseup', () => {
      this.dragging = false;
    }, opts);

    canvas.addEventListener('click', (e) => {
      const pos = this.game.input.getPointerPosition();
      const clickedNode = this.getNodeAtPosition(pos.x, pos.y);

      if (clickedNode && clickedNode.id !== this.currentNode?.id) {
        this.travelToNode(clickedNode);
      }
    }, opts);

    // Zoom with wheel
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      this.zoom = Math.max(0.5, Math.min(2, this.zoom * zoomFactor));
    }, opts);
  }

  getNodeAtPosition(screenX, screenY) {
    for (const node of this.nodes) {
      const nodeX = node.x_coord * this.nodeSpacing + this.cameraX;
      const nodeY = node.y_coord * this.nodeSpacing + this.cameraY;
      const dist = Math.sqrt((screenX - nodeX) ** 2 + (screenY - nodeY) ** 2);

      if (dist <= this.nodeSize) {
        return node;
      }
    }
    return null;
  }

  isNodeAdjacent(node) {
    if (!this.currentNode) return false;
    return this.connections.some(conn =>
      (conn.from_node_id === this.currentNode.id && conn.to_node_id === node.id) ||
      (conn.to_node_id === this.currentNode.id && conn.from_node_id === node.id)
    );
  }

  async travelToNode(node) {
    if (!this.isNodeAdjacent(node)) {
      this.game.showNotification('You can only travel to adjacent nodes', 'error');
      return;
    }

    try {
      const previousNodeId = this.currentNode?.id;

      const result = await this.game.api.travel(node.id);
      this.currentNode = result.currentNode;
      this.game.state.set('currentNode', this.currentNode);

      // Reload world data to get newly discovered nodes (fog of war reveal)
      await this.loadWorldData();

      this.updateNodeInfo();
      this.game.showNotification(`Traveled to ${result.currentNode.name}`, 'success');

      // Switch node rooms for WebSocket presence
      if (this.game.socket) {
        if (previousNodeId) {
          this.game.socket.leaveNodeRoom(previousNodeId);
        }
        this.game.socket.joinNodeRoom(this.currentNode.id);
      }
    } catch (err) {
      this.game.showNotification(err.message, 'error');
    }
  }

  capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ') : '';
  }

  update(deltaTime) {
    this.game.input.clearFrameState();

    // Update effects
    if (this.effects) {
      this.effects.update(deltaTime);

      // Spawn ambient particles near visible nodes
      for (const node of this.nodes) {
        const x = node.x_coord * this.nodeSpacing + this.cameraX;
        const y = node.y_coord * this.nodeSpacing + this.cameraY;

        // Only spawn for visible nodes
        if (x >= -100 && x <= this.game.canvas.width + 100 &&
            y >= -100 && y <= this.game.canvas.height + 100) {
          this.effects.spawnAmbientParticles(x, y, node.node_type);
        }
      }
    }
  }

  render(ctx) {
    // Render backdrop with effects system
    if (this.effects) {
      this.effects.renderBackdrop(ctx, this.cameraX, this.cameraY, ctx.canvas.width, ctx.canvas.height);
    } else {
      // Fallback background
      ctx.fillStyle = '#0a0a1a';
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }

    ctx.save();

    // Draw connections with curved bezier paths (using textured paths when available)
    for (const conn of this.connections) {
      const fromNode = this.nodes.find(n => n.id === conn.from_node_id);
      const toNode = this.nodes.find(n => n.id === conn.to_node_id);

      if (fromNode && toNode) {
        const x1 = fromNode.x_coord * this.nodeSpacing + this.cameraX;
        const y1 = fromNode.y_coord * this.nodeSpacing + this.cameraY;
        const x2 = toNode.x_coord * this.nodeSpacing + this.cameraX;
        const y2 = toNode.y_coord * this.nodeSpacing + this.cameraY;

        // Skip if completely off screen
        const margin = 50;
        const minX = Math.min(x1, x2) - margin;
        const maxX = Math.max(x1, x2) + margin;
        const minY = Math.min(y1, y2) - margin;
        const maxY = Math.max(y1, y2) + margin;
        if (maxX < 0 || minX > ctx.canvas.width || maxY < 0 || minY > ctx.canvas.height) {
          continue;
        }

        // Calculate control point for bezier curve
        const control = this.getPathControlPoint(x1, y1, x2, y2, conn.from_node_id, conn.to_node_id);

        // Use textured path rendering if effects available
        if (this.effects && this.effects.pathsLoaded) {
          this.effects.renderTexturedPath(ctx, x1, y1, x2, y2, conn.path_type, control);
        } else {
          // Fallback to simple path
          const style = this.getPathStyle(conn.path_type);

          // Draw path shadow for depth
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.quadraticCurveTo(control.x, control.y, x2, y2);
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
          ctx.lineWidth = style.width + 2;
          ctx.stroke();

          // Draw main path
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.quadraticCurveTo(control.x, control.y, x2, y2);
          ctx.strokeStyle = style.color;
          ctx.lineWidth = style.width;
          if (style.dashed) {
            ctx.setLineDash([5, 5]);
          }
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }

    // Draw nodes
    for (const node of this.nodes) {
      const x = node.x_coord * this.nodeSpacing + this.cameraX;
      const y = node.y_coord * this.nodeSpacing + this.cameraY;

      // Skip if off screen
      if (x < -50 || x > ctx.canvas.width + 50 || y < -50 || y > ctx.canvas.height + 50) {
        continue;
      }

      const isCurrent = this.currentNode && node.id === this.currentNode.id;
      const isHovered = this.hoveredNode && node.id === this.hoveredNode.id;
      const isAdjacent = this.isNodeAdjacent(node);
      const isImportant = ['castle', 'palace', 'city'].includes(node.node_type);

      // Render glow effect for important/selected nodes
      if (this.effects && (isCurrent || isImportant)) {
        const glowColor = isCurrent ? '#ffd700' : this.getNodeGlowColor(node.node_type);
        this.effects.renderNodeGlow(ctx, x, y, this.nodeSize, glowColor, isCurrent || isImportant);
      }

      // Try to render node sprite
      const nodeSprite = this.getNodeSprite(node.node_type);

      if (nodeSprite) {
        // Draw sprite with selection/hover effects
        const spriteSize = this.getNodeSpriteSize(node.node_type);
        const drawSize = isCurrent ? spriteSize + 8 : spriteSize;
        const offset = drawSize / 2;

        // Draw shadow under sprite
        ctx.save();
        ctx.globalAlpha = 0.3;
        ctx.filter = 'blur(4px)';
        ctx.drawImage(nodeSprite, x - offset + 3, y - offset + 3, drawSize, drawSize);
        ctx.restore();

        // Draw main sprite
        ctx.drawImage(nodeSprite, x - offset, y - offset, drawSize, drawSize);

        // Draw selection ring
        if (isCurrent) {
          ctx.beginPath();
          ctx.arc(x, y, drawSize / 2 + 4, 0, Math.PI * 2);
          ctx.strokeStyle = '#ffd700';
          ctx.lineWidth = 3;
          ctx.stroke();
        } else if (isAdjacent) {
          ctx.beginPath();
          ctx.arc(x, y, drawSize / 2 + 2, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(106, 176, 243, 0.6)';
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      } else {
        // Fallback: Draw colored circle with emoji
        ctx.beginPath();
        ctx.arc(x, y, this.nodeSize, 0, Math.PI * 2);

        if (isCurrent) {
          ctx.fillStyle = '#ffd700';
        } else if (isHovered && isAdjacent) {
          ctx.fillStyle = '#4a90d9';
        } else {
          ctx.fillStyle = this.getNodeColor(node.node_type);
        }
        ctx.fill();

        // Node border
        ctx.strokeStyle = isCurrent ? '#ffed4a' : isAdjacent ? '#6ab0f3' : '#2a2a4a';
        ctx.lineWidth = isCurrent ? 3 : 2;
        ctx.stroke();

        // Node emoji icon
        ctx.fillStyle = isCurrent ? '#1a1a2e' : '#fff';
        ctx.font = '16px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.getNodeIcon(node.node_type), x, y);
      }

      // Node name (only for current and hovered)
      if (isCurrent || isHovered) {
        // Draw name with background for better readability
        const nodeName = node.name;
        ctx.font = 'bold 12px Arial';
        const textWidth = ctx.measureText(nodeName).width;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(x - textWidth / 2 - 4, y + this.nodeSize + 8, textWidth + 8, 18);

        ctx.fillStyle = isCurrent ? '#ffd700' : '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(nodeName, x, y + this.nodeSize + 10);
      }
    }

    // Render fog of war overlay
    if (this.effects) {
      this.effects.renderFogOfWar(ctx, this.cameraX, this.cameraY, ctx.canvas.width, ctx.canvas.height, this.nodes);
    }

    ctx.restore();
  }

  /**
   * Get glow color for node type
   */
  getNodeGlowColor(nodeType) {
    const colors = {
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
    return colors[nodeType] || '#4a4a6a';
  }

  /**
   * Get sprite size based on node type (important nodes are larger)
   */
  getNodeSpriteSize(nodeType) {
    const sizes = {
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
    return sizes[nodeType] || 44;
  }

  /**
   * Get node sprite from asset loader
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

  getNodeColor(type) {
    const colors = {
      castle: '#8b4513',
      city: '#4a4a6a',
      village: '#2e7d32',
      forest: '#1b5e20',
      cave: '#37474f',
      mountain: '#5d4037',
      bridge: '#795548',
      guild: '#7b1fa2',
      palace: '#c9a227'
    };
    return colors[type] || '#4a4a6a';
  }

  getNodeIcon(type) {
    const icons = {
      castle: '🏰',
      city: '🏛️',
      village: '🏘️',
      forest: '🌲',
      cave: '🕳️',
      mountain: '⛰️',
      bridge: '🌉',
      guild: '⚔️',
      palace: '👑'
    };
    return icons[type] || '📍';
  }

  /**
   * Calculate bezier control point for curved path between two nodes
   */
  getPathControlPoint(x1, y1, x2, y2, fromNodeId, toNodeId) {
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length < 1) return { x: midX, y: midY }; // Avoid division by zero

    // Perpendicular vector
    const perpX = -dy / length;
    const perpY = dx / length;

    // Curve amount proportional to path length (capped)
    const curveAmount = Math.min(length * 0.2, 40);

    // Consistent direction based on node ID ordering
    const direction = fromNodeId < toNodeId ? 1 : -1;

    return {
      x: midX + perpX * curveAmount * direction,
      y: midY + perpY * curveAmount * direction
    };
  }

  /**
   * Get path styling based on path type
   */
  getPathStyle(pathType) {
    const styles = {
      road: { color: '#5a5a7a', width: 3 },
      trail: { color: '#3a5a3a', width: 2 },
      bridge: { color: '#8b7355', width: 4 },
      tunnel: { color: '#2a2a3a', width: 3, dashed: true }
    };
    return styles[pathType] || styles.road;
  }
}
