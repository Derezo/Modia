import { Scene } from './Scene.js';
import { WorldMapEffects } from '../worldmap/WorldMapEffects.js';
import { WorldMapMinimap } from '../worldmap/WorldMapMinimap.js';
import { WorldMapCharacter } from '../worldmap/WorldMapCharacter.js';
import { StaminaBar } from '../worldmap/StaminaBar.js';

// Class-specific action labels for guild recruitment buttons
const GUILD_ACTION_LABELS = {
  warrior: 'Recruit Soldier',
  wizard: 'Take on Apprentice',
  monk: 'Accept Initiate',
  chemist: 'Hire Assistant'
};

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

    // Minimap
    this.minimap = null;

    // Character display on map
    this.mapCharacter = null;

    // Stamina bar
    this.staminaBar = null;

    // Travel state
    this.isTraveling = false;

    // Path preview state
    this.previewPath = null; // Array of node IDs for hover path preview
    this.previewCost = 0;
    this.previewAffordable = true;
    this.pathPreviewCache = new Map(); // Cache path calculations

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

    // Initialize minimap
    this.minimap = new WorldMapMinimap(this.assetLoader);
    await this.minimap.init();
    this.minimap.calculateWorldBounds(this.nodes);

    // Initialize character display
    this.mapCharacter = new WorldMapCharacter(this.assetLoader);
    await this.initMapCharacter();

    // Initialize stamina bar
    this.staminaBar = new StaminaBar();
    await this.refreshStamina();

    // Preload node sprites in background
    this.preloadNodeSprites();
  }

  /**
   * Refresh stamina from the server
   */
  async refreshStamina() {
    try {
      const characters = this.game.state.get('characters') || [];
      console.log('refreshStamina - characters from state:', characters.length);
      const partyLeader = characters.find(c => c.party_slot === 1) || characters[0];

      if (partyLeader) {
        console.log('refreshStamina - fetching for character:', partyLeader.id, partyLeader.name);
        const result = await this.game.api.getCharacterStamina(partyLeader.id);
        console.log('refreshStamina - API result:', result);
        if (result.stamina) {
          this.staminaBar.setStamina(result.stamina);
        }
      } else {
        console.warn('refreshStamina - no party leader found');
      }
    } catch (err) {
      console.warn('Failed to fetch stamina:', err);
    }
  }

  /**
   * Initialize the map character with the party leader
   */
  async initMapCharacter() {
    let characters = this.game.state.get('characters') || [];

    // Fetch characters from API if not in state
    if (characters.length === 0) {
      try {
        const result = await this.game.api.getCharacters();
        characters = result.characters || [];
        this.game.state.set('characters', characters);
      } catch (err) {
        console.warn('Failed to fetch characters for map display:', err);
        return;
      }
    }

    if (characters.length === 0) {
      console.warn('No characters available for map display');
      return;
    }

    // Find party leader (party_slot === 1) or use first character
    let partyLeader = characters.find(c => c.party_slot === 1);
    if (!partyLeader) {
      // If no party_slot set, use first character
      partyLeader = characters[0];
    }

    if (partyLeader) {
      console.log('Setting map character:', partyLeader.name, partyLeader.class);
      await this.mapCharacter.setCharacter(partyLeader);
      this.updateCharacterPosition();
      console.log('Map character initialized, position:', this.mapCharacter.x, this.mapCharacter.y);
    }
  }

  /**
   * Update character position to current node
   */
  updateCharacterPosition() {
    if (!this.mapCharacter || !this.currentNode) return;

    const node = this.nodes.find(n => n.id === this.currentNode.id);
    if (node) {
      this.mapCharacter.setPosition(
        node.x_coord * this.nodeSpacing,
        node.y_coord * this.nodeSpacing
      );
    }
  }

  /**
   * Smoothly follow the character during travel
   */
  followCharacter() {
    if (!this.mapCharacter) return;

    const targetX = -this.mapCharacter.x + this.game.canvas.width / 2;
    const targetY = -this.mapCharacter.y + this.game.canvas.height / 2;

    // Smooth interpolation
    const smoothing = 0.1;
    this.cameraX += (targetX - this.cameraX) * smoothing;
    this.cameraY += (targetY - this.cameraY) * smoothing;
  }

  /**
   * Update path preview when hovering over a node
   */
  async updatePathPreview(node) {
    // Clear preview if no node hovered, traveling, or hovering current node
    if (!node || this.isTraveling || !this.currentNode || node.id === this.currentNode.id) {
      this.previewPath = null;
      this.previewCost = 0;
      this.previewAffordable = true;
      return;
    }

    // Check if node is discovered
    if (!this.isNodeDiscovered(node)) {
      this.previewPath = null;
      this.previewCost = 0;
      this.previewAffordable = false;
      return;
    }

    // Check cache first
    const cacheKey = `${this.currentNode.id}-${node.id}`;
    if (this.pathPreviewCache.has(cacheKey)) {
      const cached = this.pathPreviewCache.get(cacheKey);
      this.previewPath = cached.path;
      this.previewCost = cached.cost;
      this.previewAffordable = this.staminaBar ? this.staminaBar.current >= cached.cost : true;
      return;
    }

    // Fetch path from server
    try {
      const result = await this.game.api.getPathPreview(node.id);
      this.previewPath = result.path;
      this.previewCost = result.cost;
      this.previewAffordable = result.affordable;

      // Cache the result
      this.pathPreviewCache.set(cacheKey, {
        path: result.path,
        cost: result.cost
      });
    } catch (err) {
      // Silently fail - just don't show preview
      this.previewPath = null;
      this.previewCost = 0;
      this.previewAffordable = false;
    }
  }

  /**
   * Clear path cache (called after travel or world data reload)
   */
  clearPathCache() {
    this.pathPreviewCache.clear();
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

      // Update minimap bounds if nodes changed
      if (this.minimap) {
        this.minimap.calculateWorldBounds(this.nodes);
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
      // Prioritize essential features (shops, social hubs) over decorative ones
      const essentialFeatures = ['blacksmith', 'marketplace', 'tavern', 'apothecary', 'coliseum', 'farm', 'guild_hall', 'courtyard'];
      const decorativeFeatures = ['throne', 'temple', 'stables', 'training_ground'];

      // Sort features: essential first, then others, decorative last
      const prioritizedFeatures = [
        ...essentialFeatures.filter(f => features.includes(f)),
        ...features.filter(f => !essentialFeatures.includes(f) && !decorativeFeatures.includes(f)),
        ...decorativeFeatures.filter(f => features.includes(f))
      ];

      // Show up to 4 features for important nodes, 3 for others
      const maxFeatures = ['castle', 'palace', 'city'].includes(this.currentNode.node_type) ? 4 : 3;

      prioritizedFeatures.slice(0, maxFeatures).forEach(feature => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary';

        // Use class-specific label for guild_hall feature
        if (feature === 'guild_hall' && this.currentNode.guild_class) {
          btn.textContent = GUILD_ACTION_LABELS[this.currentNode.guild_class] || 'Guild Hall';
        } else {
          btn.textContent = this.capitalize(feature);
        }

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

    // Coliseum feature opens the PvP arena scene
    if (feature === 'coliseum') {
      this.game.scenes.switchTo('coliseum');
      return;
    }

    // Guild hall feature opens the recruitment scene
    if (feature === 'guild_hall') {
      this.game.scenes.switchTo('recruitment', {
        nodeId: this.currentNode.id,
        guildClass: this.currentNode.guild_class
      });
      return;
    }

    // Courtyard feature opens the social hub / LFG scene
    if (feature === 'courtyard') {
      this.game.scenes.switchTo('courtyard', { nodeId: this.currentNode.id });
      return;
    }

    // Other features not yet implemented
    this.game.showNotification(`${this.capitalize(feature)} - Coming soon!`, 'info');
  }

  async startBattle() {
    // Go to battle formation scene to let player arrange their party
    this.game.scenes.switchTo('battleFormation', {
      type: 'pve',
      node: this.currentNode
    });
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
      const newHoveredNode = this.getNodeAtPosition(pos.x, pos.y);

      // If hovered node changed, update path preview
      if (newHoveredNode?.id !== this.hoveredNode?.id) {
        this.hoveredNode = newHoveredNode;
        this.updatePathPreview(newHoveredNode);
      }
    }, opts);

    canvas.addEventListener('mouseup', () => {
      this.dragging = false;
    }, opts);

    canvas.addEventListener('click', (e) => {
      const pos = this.game.input.getPointerPosition();

      // Check minimap click first
      if (this.minimap) {
        const minimapNode = this.minimap.handleClick(
          pos.x, pos.y,
          canvas.width, canvas.height,
          this.nodes,
          this.currentNode?.id,
          (node) => this.isNodeAdjacent(node)
        );
        if (minimapNode) {
          this.travelToNode(minimapNode);
          return;
        }
      }

      // Regular map click
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

  /**
   * Check if a node has been discovered
   */
  isNodeDiscovered(node) {
    return node.visited || node.discovery_method;
  }

  /**
   * Travel to a node with walking animation
   */
  async travelToNode(node) {
    // Block travel if already traveling
    if (this.isTraveling) {
      console.log('Travel blocked - already traveling');
      return;
    }

    // Check if this is the current node
    if (this.currentNode && node.id === this.currentNode.id) {
      return;
    }

    // Check if destination is discovered
    if (!this.isNodeDiscovered(node)) {
      this.game.showNotification('You have not discovered this location yet', 'error');
      return;
    }

    try {
      const previousNodeId = this.currentNode?.id;

      // Call the travel API (now supports multi-node travel)
      const result = await this.game.api.travel(node.id);
      console.log('Travel API result:', result);
      console.log('Stamina from API:', result.stamina);

      // Ensure map character is initialized for animation
      if (this.mapCharacter && !this.mapCharacter.character) {
        console.log('Character not set, initializing...');
        await this.initMapCharacter();
        console.log('After init, character:', this.mapCharacter?.character);
      }

      // Check if we can animate (have path and character)
      const canAnimate = result.pathNodes &&
                         result.pathNodes.length > 1 &&
                         this.mapCharacter &&
                         this.mapCharacter.character;

      console.log('Can animate:', canAnimate, {
        hasPathNodes: !!result.pathNodes,
        pathLength: result.pathNodes?.length,
        hasMapCharacter: !!this.mapCharacter,
        hasCharacter: !!this.mapCharacter?.character
      });

      if (canAnimate) {
        this.isTraveling = true;

        // Convert path nodes to screen positions
        const walkPath = result.pathNodes.map(n => ({
          x: n.x_coord * this.nodeSpacing,
          y: n.y_coord * this.nodeSpacing,
          id: n.id,
          name: n.name
        }));

        console.log('Starting walk animation with path:', walkPath);

        // Start walking animation
        this.mapCharacter.startWalking(walkPath, () => {
          console.log('Walk animation complete');
          this.onTravelComplete(result, previousNodeId);
        });

        // Show travel message
        this.game.showNotification(`Traveling to ${result.currentNode.name}... (${result.cost} stamina)`, 'info');
      } else {
        // No animation - complete immediately
        console.log('No animation, completing immediately');
        this.onTravelComplete(result, previousNodeId);
        this.game.showNotification(`Arrived at ${result.currentNode.name}`, 'success');
      }
    } catch (err) {
      console.error('Travel error:', err);
      this.game.showNotification(err.message, 'error');
    }
  }

  /**
   * Handle travel completion (after animation finishes)
   */
  async onTravelComplete(result, previousNodeId) {
    console.log('onTravelComplete called');
    this.isTraveling = false;

    // Update state
    this.currentNode = result.currentNode;
    this.game.state.set('currentNode', this.currentNode);

    // Update stamina from travel result
    if (result.stamina && this.staminaBar) {
      console.log('Updating stamina bar with:', result.stamina);
      this.staminaBar.setStamina(result.stamina);
      console.log('Stamina bar current after update:', this.staminaBar.current);
    } else {
      console.warn('No stamina in result or no stamina bar:', { stamina: result.stamina, hasBar: !!this.staminaBar });
    }

    // Reload world data to get newly discovered nodes (fog of war reveal)
    await this.loadWorldData();

    // Clear path cache since we're at a new position
    this.clearPathCache();

    // Update character position to final node
    this.updateCharacterPosition();

    this.updateNodeInfo();
    this.game.showNotification(`Arrived at ${result.currentNode.name}`, 'success');

    // Switch node rooms for WebSocket presence
    if (this.game.socket) {
      if (previousNodeId) {
        this.game.socket.leaveNodeRoom(previousNodeId);
      }
      this.game.socket.joinNodeRoom(this.currentNode.id);
    }
  }

  capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ') : '';
  }

  update(deltaTime) {
    this.game.input.clearFrameState();

    // Update character animation
    if (this.mapCharacter) {
      this.mapCharacter.update(deltaTime);

      // Follow camera during travel
      if (this.mapCharacter.isTraveling()) {
        this.followCharacter();
      }
    }

    // Update stamina bar
    if (this.staminaBar) {
      this.staminaBar.update(deltaTime);
    }

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

    // Draw path preview (golden glow along the path)
    if (this.previewPath && this.previewPath.length > 1) {
      this.renderPathPreview(ctx);
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

        // Draw selection ring (only for adjacent nodes, not current - character sprite shows current location)
        if (isAdjacent) {
          ctx.beginPath();
          ctx.arc(x, y, drawSize / 2 + 2, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(106, 176, 243, 0.6)';
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      } else {
        // Fallback: Draw colored circle with emoji (no special highlighting for current node - character sprite shows location)
        ctx.beginPath();
        ctx.arc(x, y, this.nodeSize, 0, Math.PI * 2);

        if (isHovered && isAdjacent) {
          ctx.fillStyle = '#4a90d9';
        } else {
          ctx.fillStyle = this.getNodeColor(node.node_type);
        }
        ctx.fill();

        // Node border
        ctx.strokeStyle = isAdjacent ? '#6ab0f3' : '#2a2a4a';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Node emoji icon
        ctx.fillStyle = '#fff';
        ctx.font = '16px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.getNodeIcon(node.node_type), x, y);
      }

      // Node tooltip (for current and hovered nodes)
      if (isCurrent || isHovered) {
        this.renderNodeTooltip(ctx, node, x, y, isCurrent);
      }
    }

    // Render fog of war overlay (before character so player is always visible)
    if (this.effects) {
      this.effects.renderFogOfWar(ctx, this.cameraX, this.cameraY, ctx.canvas.width, ctx.canvas.height, this.nodes, this.connections);
    }

    // Render character on map (after fog so always visible)
    if (this.mapCharacter) {
      this.mapCharacter.render(ctx, this.cameraX, this.cameraY);
    }

    ctx.restore();

    // Render stamina bar (UI layer)
    if (this.staminaBar) {
      this.staminaBar.render(ctx);
    }

    // Render minimap (on top of everything)
    if (this.minimap && this.effects) {
      this.minimap.render(ctx, {
        nodes: this.nodes,
        connections: this.connections,
        currentNode: this.currentNode,
        discoveredNodes: this.effects.discoveredNodes,
        visitedNodes: this.effects.visitedNodes,
        cameraX: this.cameraX,
        cameraY: this.cameraY,
        canvasWidth: ctx.canvas.width,
        canvasHeight: ctx.canvas.height,
        nodeSpacing: this.nodeSpacing
      });
    }
  }

  /**
   * Render path preview (golden glow along the path)
   */
  renderPathPreview(ctx) {
    if (!this.previewPath || this.previewPath.length < 2) return;

    const pathColor = this.previewAffordable ? 'rgba(255, 215, 0, 0.6)' : 'rgba(180, 80, 80, 0.6)';
    const glowColor = this.previewAffordable ? 'rgba(255, 215, 0, 0.2)' : 'rgba(180, 80, 80, 0.2)';

    ctx.save();

    // Draw glow effect along the path
    for (let i = 0; i < this.previewPath.length - 1; i++) {
      const fromNode = this.nodes.find(n => n.id === this.previewPath[i]);
      const toNode = this.nodes.find(n => n.id === this.previewPath[i + 1]);

      if (!fromNode || !toNode) continue;

      const x1 = fromNode.x_coord * this.nodeSpacing + this.cameraX;
      const y1 = fromNode.y_coord * this.nodeSpacing + this.cameraY;
      const x2 = toNode.x_coord * this.nodeSpacing + this.cameraX;
      const y2 = toNode.y_coord * this.nodeSpacing + this.cameraY;

      // Skip if off screen
      const margin = 100;
      if (Math.max(x1, x2) < -margin || Math.min(x1, x2) > ctx.canvas.width + margin ||
          Math.max(y1, y2) < -margin || Math.min(y1, y2) > ctx.canvas.height + margin) {
        continue;
      }

      const control = this.getPathControlPoint(x1, y1, x2, y2, fromNode.id, toNode.id);

      // Draw glow (wider, semi-transparent)
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(control.x, control.y, x2, y2);
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = 12;
      ctx.stroke();

      // Draw main path highlight
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(control.x, control.y, x2, y2);
      ctx.strokeStyle = pathColor;
      ctx.lineWidth = 4;
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Render node tooltip with name and travel info
   */
  renderNodeTooltip(ctx, node, x, y, isCurrent) {
    const nodeName = node.name;
    const isDiscovered = this.isNodeDiscovered(node);

    // Calculate tooltip content
    let lines = [nodeName];
    let costLine = null;

    if (!isCurrent) {
      if (!isDiscovered) {
        lines.push('Undiscovered');
      } else if (this.previewCost > 0) {
        if (this.previewAffordable) {
          costLine = { text: `${this.previewCost} stamina`, color: '#6a8a6a' };
        } else {
          const currentStamina = this.staminaBar?.current || 0;
          costLine = { text: `Need ${this.previewCost - currentStamina} more stamina`, color: '#c54545' };
        }
      }
    }

    // Measure text
    ctx.font = 'bold 12px Arial';
    const nameWidth = ctx.measureText(nodeName).width;
    let tooltipWidth = nameWidth + 16;

    if (costLine) {
      ctx.font = '11px Arial';
      const costWidth = ctx.measureText(costLine.text).width;
      tooltipWidth = Math.max(tooltipWidth, costWidth + 16);
    }

    const tooltipHeight = costLine ? 36 : 22;
    const tooltipY = y + this.nodeSize + 8;

    // Draw background
    ctx.fillStyle = 'rgba(40, 30, 20, 0.9)';
    const radius = 4;
    const tx = x - tooltipWidth / 2;
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

    // Draw border
    ctx.strokeStyle = 'rgba(139, 115, 85, 0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Draw name
    ctx.font = 'bold 12px Arial';
    ctx.fillStyle = isCurrent ? '#ffd700' : '#e0d0b0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(nodeName, x, tooltipY + 4);

    // Draw cost line
    if (costLine) {
      ctx.font = '11px Arial';
      ctx.fillStyle = costLine.color;
      ctx.fillText(costLine.text, x, tooltipY + 20);
    }
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
