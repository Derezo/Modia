import { Scene } from './Scene.js';
import { WorldMapEffects } from '../worldmap/WorldMapEffects.js';
import { WorldMapMinimap } from '../worldmap/WorldMapMinimap.js';
import { WorldMapCharacter } from '../worldmap/WorldMapCharacter.js';
import { StaminaBar } from '../worldmap/StaminaBar.js';
import { generatePathControlPoints, generateSplinePoints } from '../worldmap/PathRenderer.js';
import { ProfileDropdown } from '../ui/parchment/ProfileDropdown.js';
import { parchmentToast } from '../ui/parchment/ParchmentToast.js';
import { Icon } from '../components/Icon.js';
import { responsive } from '../core/Responsive.js';
import {
  PARCHMENT_COLORS,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentShadow
} from '../ui/parchment/ParchmentTheme.js';

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
    this.cameraSettling = false; // Camera continues smooth follow after travel ends

    // Path preview state
    this.previewPath = null; // Array of node IDs for hover path preview
    this.previewCost = 0;
    this.previewAffordable = true;
    this.pathPreviewCache = new Map(); // Cache path calculations

    // Event listener cleanup
    this.abortController = null;

    // WebSocket unsubscribers
    this.wsUnsubscribers = [];

    // ProfileDropdown component
    this.profileDropdown = null;

    // Responsive subscription
    this.responsiveUnsubscribe = null;
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

    // Initialize ProfileDropdown
    this.profileDropdown = new ProfileDropdown(this.game);
    this.profileDropdown.show();

    // Subscribe to responsive changes
    this.responsiveUnsubscribe = responsive.onChange(() => {
      this.onBreakpointChange();
    });
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

    // Hide ProfileDropdown
    if (this.profileDropdown) {
      this.profileDropdown.hide();
    }

    // Unsubscribe from responsive changes
    if (this.responsiveUnsubscribe) {
      this.responsiveUnsubscribe();
      this.responsiveUnsubscribe = null;
    }

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

      // Deduplicate connections (keep only one per node pair for bidirectional paths)
      const seenPairs = new Set();
      this.connections = worldData.connections.filter(conn => {
        const key = `${Math.min(conn.from_node_id, conn.to_node_id)}-${Math.max(conn.from_node_id, conn.to_node_id)}`;
        if (seenPairs.has(key)) return false;
        seenPairs.add(key);
        return true;
      });

      this.currentNode = currentData.currentNode;

      this.game.state.set('worldNodes', this.nodes);
      this.game.state.set('currentNode', this.currentNode);

      // Update discovery state for fog of war rendering (with connections for polygon detection)
      if (this.effects) {
        this.effects.updateDiscoveryState(this.nodes, this.connections);
      }

      // Update minimap bounds if nodes changed
      if (this.minimap) {
        this.minimap.calculateWorldBounds(this.nodes);
      }
    } catch (err) {
      console.error('Failed to load world:', err);
      parchmentToast.error('World Data Error', 'Failed to load world data. Please try again.');
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

    const isMobile = responsive.isMobile();

    // Parchment-styled player info panel (top-left)
    container.innerHTML = `
      <div style="
        position: absolute;
        top: 16px;
        left: 16px;
        pointer-events: auto;
      ">
        <div style="
          padding: ${isMobile ? '8px 12px' : '10px 16px'};
          background: ${getParchmentGradient('to bottom')};
          border: ${getParchmentBorder()};
          border-radius: 6px;
          box-shadow: ${getParchmentShadow(false)};
          font-family: Georgia, serif;
        ">
          <div style="
            font-weight: bold;
            color: ${PARCHMENT_COLORS.accent.gold};
            font-size: ${isMobile ? '13px' : '14px'};
            text-shadow: 0 1px 0 rgba(0,0,0,0.2);
          ">${this.game.state.get('user')?.username || 'Adventurer'}</div>
          <div style="
            font-size: ${isMobile ? '11px' : '12px'};
            color: ${PARCHMENT_COLORS.text.secondary};
            margin-top: 2px;
            display: flex;
            align-items: center;
            gap: 4px;
          ">
            <span style="color: ${PARCHMENT_COLORS.accent.gold};">Gold:</span>
            <span>${(this.game.state.get('user')?.gold || 0).toLocaleString()}</span>
          </div>
        </div>
      </div>

      <!-- Current node info panel (bottom center) - Parchment styled -->
      <div id="node-info" style="
        position: absolute;
        bottom: ${isMobile ? '12px' : '20px'};
        left: 50%;
        transform: translateX(-50%);
        pointer-events: auto;
        display: none;
        max-width: calc(100vw - 32px);
      ">
        <div style="
          text-align: center;
          min-width: ${isMobile ? '180px' : '240px'};
          padding: ${isMobile ? '12px 16px' : '16px 24px'};
          background: ${getParchmentGradient('to bottom')};
          border: ${getParchmentBorder()};
          border-radius: 6px;
          box-shadow: ${getParchmentShadow(true)};
          font-family: Georgia, serif;
        ">
          <div id="node-name" style="
            font-weight: bold;
            color: ${PARCHMENT_COLORS.accent.gold};
            font-size: ${isMobile ? '15px' : '18px'};
            margin-bottom: 4px;
            text-shadow: 0 1px 0 rgba(0,0,0,0.15);
          "></div>
          <div id="node-type" style="
            font-size: ${isMobile ? '11px' : '12px'};
            color: ${PARCHMENT_COLORS.text.muted};
            margin-bottom: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          "></div>
          <div id="node-actions" style="
            display: flex;
            gap: ${isMobile ? '6px' : '8px'};
            justify-content: center;
            flex-wrap: wrap;
          "></div>
        </div>
      </div>
    `;

    this.game.uiOverlay.appendChild(container);
    this.uiElement = container;

    // Update current node display
    this.updateNodeInfo();
  }

  // Menu functionality is now handled by ProfileDropdown

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
        const btn = this.createParchmentButton(feature, false);
        nodeActions.appendChild(btn);
      });
    }

    // Add battle button for battle nodes
    if (['forest', 'cave', 'mountain', 'bridge'].includes(this.currentNode.node_type)) {
      const battleBtn = this.createParchmentButton('battle', true);
      nodeActions.appendChild(battleBtn);
    }
  }

  /**
   * Create a parchment-styled action button
   * @param {string} feature - Feature/action name
   * @param {boolean} isPrimary - Whether this is a primary (battle) button
   * @returns {HTMLButtonElement}
   */
  createParchmentButton(feature, isPrimary = false) {
    const isMobile = responsive.isMobile();
    const btn = document.createElement('button');

    // Get icon mapping for features
    const iconMap = {
      blacksmith: { category: 'action', name: 'craft' },
      marketplace: { category: 'action', name: 'trade' },
      tavern: { category: 'action', name: 'rest' },
      apothecary: { category: 'action', name: 'potion' },
      coliseum: { category: 'action', name: 'battle' },
      farm: { category: 'action', name: 'harvest' },
      guild_hall: { category: 'action', name: 'recruit' },
      courtyard: { category: 'action', name: 'social' },
      battle: { category: 'action', name: 'battle' }
    };

    // Get label text
    let label = this.capitalize(feature);
    if (feature === 'guild_hall' && this.currentNode.guild_class) {
      label = GUILD_ACTION_LABELS[this.currentNode.guild_class] || 'Guild Hall';
    }

    // Parchment button styling
    const bgGradient = isPrimary
      ? `linear-gradient(to bottom, ${PARCHMENT_COLORS.accent.copper}, #9a5f23)`
      : `linear-gradient(to bottom, ${PARCHMENT_COLORS.light}, ${PARCHMENT_COLORS.dark})`;

    const textColor = isPrimary ? PARCHMENT_COLORS.text.inverse : PARCHMENT_COLORS.text.primary;
    const borderColor = isPrimary ? PARCHMENT_COLORS.borderDark : PARCHMENT_COLORS.border;

    btn.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: ${isMobile ? '8px 12px' : '8px 14px'};
      background: ${bgGradient};
      border: 2px solid ${borderColor};
      border-radius: 4px;
      color: ${textColor};
      font-family: Georgia, serif;
      font-size: ${isMobile ? '11px' : '12px'};
      font-weight: bold;
      cursor: pointer;
      transition: transform 0.1s, box-shadow 0.15s;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.3);
      white-space: nowrap;
    `;

    // Hover effects
    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'translateY(-1px)';
      btn.style.boxShadow = '0 3px 6px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.3)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'translateY(0)';
      btn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.3)';
    });
    btn.addEventListener('mousedown', () => {
      btn.style.transform = 'translateY(1px)';
      btn.style.boxShadow = '0 1px 2px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.3)';
    });
    btn.addEventListener('mouseup', () => {
      btn.style.transform = 'translateY(-1px)';
    });

    // Use Icon component if available, otherwise just text
    const iconConfig = iconMap[feature];
    if (iconConfig && !isMobile) {
      // On desktop, show icon + label
      btn.innerHTML = Icon.html(iconConfig.category, iconConfig.name, {
        label: label,
        size: 'sm'
      });
    } else {
      // On mobile or no icon, show just label
      btn.textContent = label;
    }

    // Click handler
    if (feature === 'battle') {
      btn.addEventListener('click', () => this.startBattle());
    } else {
      btn.addEventListener('click', () => this.handleFeature(feature));
    }

    return btn;
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
    parchmentToast.info('Coming Soon', `${this.capitalize(feature)} feature is under development.`);
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
        parchmentToast.info('Traveler Arrived', `${payload.username} has arrived at ${this.currentNode.name}.`);
      }
    });
    this.wsUnsubscribers.push(enteredUnsub);

    // Handle player leaving current node
    const leftUnsub = socket.on('player:left_node', (payload) => {
      if (payload.nodeId === this.currentNode?.id) {
        parchmentToast.info('Traveler Departed', `${payload.username} has left ${this.currentNode.name}.`);
      }
    });
    this.wsUnsubscribers.push(leftUnsub);

    // Handle party invites
    const inviteUnsub = socket.on('party:invite_received', (payload) => {
      parchmentToast.info('Party Invite', `${payload.fromUsername} has invited you to join their party.`);
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

    canvas.addEventListener('click', () => {
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
    if (this.isTraveling) return;

    // Check if this is the current node
    if (this.currentNode && node.id === this.currentNode.id) {
      return;
    }

    // Check if destination is discovered
    if (!this.isNodeDiscovered(node)) {
      parchmentToast.warning('Unknown Territory', 'You have not discovered this location yet.');
      return;
    }

    try {
      const previousNodeId = this.currentNode?.id;

      // Call the travel API (now supports multi-node travel)
      const result = await this.game.api.travel(node.id);

      // Ensure map character is initialized for animation
      if (this.mapCharacter && !this.mapCharacter.character) {
        await this.initMapCharacter();
      }

      // Check if we can animate (have path and character)
      const canAnimate = result.pathNodes &&
                         result.pathNodes.length > 1 &&
                         this.mapCharacter &&
                         this.mapCharacter.character;

      if (canAnimate) {
        this.isTraveling = true;
        this.cameraSettling = true; // Keep camera following smoothly after travel ends

        // Convert path nodes to screen positions
        const walkPath = result.pathNodes.map(n => ({
          x: n.x_coord * this.nodeSpacing,
          y: n.y_coord * this.nodeSpacing,
          id: n.id,
          name: n.name
        }));

        // Start walking animation
        this.mapCharacter.startWalking(walkPath, () => {
          this.onTravelComplete(result, previousNodeId);
        });

        // Show travel message
        parchmentToast.info('Traveling', `Journeying to ${result.currentNode.name}... (${result.cost} stamina)`);
      } else {
        // No animation - complete immediately
        this.onTravelComplete(result, previousNodeId);
        parchmentToast.success('Arrived', `You have arrived at ${result.currentNode.name}.`);
      }
    } catch (err) {
      parchmentToast.error('Travel Failed', err.message || 'Unable to travel to this location.');
    }
  }

  /**
   * Handle travel completion (after animation finishes)
   */
  async onTravelComplete(result, previousNodeId) {
    this.isTraveling = false;

    // Update state
    this.currentNode = result.currentNode;
    this.game.state.set('currentNode', this.currentNode);

    // Update stamina from travel result
    if (result.stamina && this.staminaBar) {
      this.staminaBar.setStamina(result.stamina);
    }

    // Reload world data to get newly discovered nodes (fog of war reveal)
    await this.loadWorldData();

    // Clear path cache since we're at a new position
    this.clearPathCache();

    // Update character position to final node
    this.updateCharacterPosition();

    this.updateNodeInfo();
    parchmentToast.success('Journey Complete', `You have arrived at ${result.currentNode.name}.`);

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

      // Follow camera during travel and smoothly settle after
      if (this.mapCharacter.isTraveling() || this.cameraSettling) {
        this.followCharacter();

        // Check if camera has settled (close enough to target)
        if (!this.mapCharacter.isTraveling()) {
          const targetX = -this.mapCharacter.x + this.game.canvas.width / 2;
          const targetY = -this.mapCharacter.y + this.game.canvas.height / 2;
          const dx = targetX - this.cameraX;
          const dy = targetY - this.cameraY;
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
            this.cameraSettling = false;
          }
        }
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

    // Draw connections with organic Catmull-Rom spline paths
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

        // Calculate control point for bezier curve (legacy fallback)
        const control = this.getPathControlPoint(x1, y1, x2, y2, conn.from_node_id, conn.to_node_id);

        // Use effects system for path rendering (organic or textured)
        if (this.effects) {
          // Pass node IDs for organic path generation
          this.effects.renderTexturedPath(ctx, x1, y1, x2, y2, conn.path_type, control, conn.from_node_id, conn.to_node_id);
        } else {
          // Fallback to simple bezier path
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
      const isVisited = node.visited;
      const isMystery = !isVisited && !isCurrent;  // Discovered but not visited = mystery

      // Render glow effect for important/selected nodes (skip for mystery nodes)
      if (this.effects && (isCurrent || isImportant) && !isMystery) {
        const glowColor = isCurrent ? '#ffd700' : this.getNodeGlowColor(node.node_type);
        this.effects.renderNodeGlow(ctx, x, y, this.nodeSize, glowColor, isCurrent || isImportant);
      }

      // Try to render node sprite (but not for mystery nodes - they get a generic marker)
      const nodeSprite = isMystery ? null : this.getNodeSprite(node.node_type);

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
        // Fallback: Draw colored circle with icon
        // Mystery nodes get grayed style
        ctx.beginPath();
        ctx.arc(x, y, this.nodeSize, 0, Math.PI * 2);

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

        // Node icon - mystery nodes show "?"
        ctx.fillStyle = isMystery ? '#9a9aaa' : '#fff';
        ctx.font = isMystery ? 'bold 18px Arial' : '16px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.getNodeIcon(node.node_type, isVisited), x, y);
      }

      // Note: tooltips are rendered after fog of war for visibility
    }

    // Render fog of war overlay (before character and labels so player/text is always visible)
    if (this.effects) {
      this.effects.renderFogOfWar(ctx, this.cameraX, this.cameraY, ctx.canvas.width, ctx.canvas.height, this.nodes, this.connections);
    }

    // Second pass: Render node tooltips AFTER fog of war so they're always visible
    for (const node of this.nodes) {
      const x = node.x_coord * this.nodeSpacing + this.cameraX;
      const y = node.y_coord * this.nodeSpacing + this.cameraY;

      // Skip if off screen
      if (x < -50 || x > ctx.canvas.width + 50 || y < -50 || y > ctx.canvas.height + 50) {
        continue;
      }

      const isCurrent = this.currentNode && node.id === this.currentNode.id;
      const isHovered = this.hoveredNode && node.id === this.hoveredNode.id;

      // Node tooltip (for current and hovered nodes) - now rendered above fog
      if (isCurrent || isHovered) {
        this.renderNodeTooltip(ctx, node, x, y, isCurrent);
      }
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
   * Render path preview (golden glow along the path) using organic curves
   */
  renderPathPreview(ctx) {
    if (!this.previewPath || this.previewPath.length < 2) return;

    const pathColor = this.previewAffordable ? 'rgba(255, 215, 0, 0.6)' : 'rgba(180, 80, 80, 0.6)';
    const glowColor = this.previewAffordable ? 'rgba(255, 215, 0, 0.2)' : 'rgba(180, 80, 80, 0.2)';

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Draw glow effect along the path using organic curves
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

      // Generate organic spline points
      const controlPoints = generatePathControlPoints(x1, y1, x2, y2, fromNode.id, toNode.id);
      const splinePoints = generateSplinePoints(controlPoints, 10);

      if (splinePoints.length < 2) continue;

      // Draw glow (wider, semi-transparent)
      ctx.beginPath();
      ctx.moveTo(splinePoints[0].x, splinePoints[0].y);
      for (let j = 1; j < splinePoints.length; j++) {
        ctx.lineTo(splinePoints[j].x, splinePoints[j].y);
      }
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = 12;
      ctx.stroke();

      // Draw main path highlight
      ctx.beginPath();
      ctx.moveTo(splinePoints[0].x, splinePoints[0].y);
      for (let j = 1; j < splinePoints.length; j++) {
        ctx.lineTo(splinePoints[j].x, splinePoints[j].y);
      }
      ctx.strokeStyle = pathColor;
      ctx.lineWidth = 4;
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Render node tooltip with name and travel info
   * Shows "Undiscovered" for discovered-but-unvisited mystery nodes
   */
  renderNodeTooltip(ctx, node, x, y, isCurrent) {
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

    // Draw background - mystery nodes have slightly different style
    const isMystery = isDiscovered && !isVisited && !isCurrent;
    ctx.fillStyle = isMystery ? 'rgba(50, 45, 60, 0.9)' : 'rgba(40, 30, 20, 0.9)';
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

  /**
   * Handle responsive breakpoint changes
   * Rebuilds UI when viewport size changes significantly
   */
  onBreakpointChange() {
    // Rebuild UI to adjust for new breakpoint
    if (this.uiElement) {
      this.uiElement.remove();
      this.uiElement = null;
    }
    this.createUI();

    // Refresh ProfileDropdown
    if (this.profileDropdown) {
      this.profileDropdown.refresh();
    }
  }
}
