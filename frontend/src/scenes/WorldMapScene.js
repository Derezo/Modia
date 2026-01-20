import { Scene } from './Scene.js';
import { WorldMapEffects } from '../worldmap/WorldMapEffects.js';
import { WorldMapMinimap } from '../worldmap/WorldMapMinimap.js';
import { WorldMapCharacter } from '../worldmap/WorldMapCharacter.js';
import { StaminaBar } from '../worldmap/StaminaBar.js';
import { TravelProgressBar } from '../worldmap/TravelProgressBar.js';
import { NodeActionMenu } from '../worldmap/NodeActionMenu.js';
import { generatePathControlPoints, generateSplinePoints } from '../worldmap/PathRenderer.js';
import { ProfileDropdown } from '../ui/parchment/ProfileDropdown.js';
import { parchmentToast } from '../ui/parchment/ParchmentToast.js';
import { PartyInviteModal } from '../components/PartyInviteModal.js';
import { Icon } from '../components/Icon.js';
import { responsive } from '../core/Responsive.js';
import { PARCHMENT_COLORS } from '../ui/parchment/ParchmentTheme.js';
import { RACE_TO_REGION } from '../audio/AudioAssets.js';

// Class-specific action labels for guild recruitment buttons
const GUILD_ACTION_LABELS = {
  warrior: 'Recruit Soldier',
  wizard: 'Take on Apprentice',
  monk: 'Accept Initiate',
  chemist: 'Hire Assistant'
};

// Cache size limit for path preview calculations (LRU eviction when exceeded)
const PATH_CACHE_MAX_SIZE = 100;

// Region colors by race - used for node tinting and boundary rendering
const REGION_COLORS = {
  human: { primary: '#8B7355', secondary: '#A08060', border: '#6B5335' },    // Brown/earth
  elf: { primary: '#2E8B57', secondary: '#3A9D68', border: '#1E6B40' },      // Forest green
  dwarf: { primary: '#708090', secondary: '#8090A0', border: '#506070' },    // Slate gray
  vampire: { primary: '#4B0082', secondary: '#5B1092', border: '#3A0062' },  // Indigo/purple
  orc: { primary: '#8B0000', secondary: '#9B1010', border: '#6B0000' }       // Dark red
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

    // Travel progress bar
    this.travelProgressBar = null;

    // Travel state
    this.isTraveling = false;
    this.cameraSettling = false; // Camera continues smooth follow after travel ends

    // Path preview state
    this.previewPath = null; // Array of node IDs for hover path preview
    this.previewCost = 0;
    this.previewAffordable = true;
    this.previewBlockedNodes = []; // Node IDs that are blocked in the path
    this.previewPathBlocked = false; // True if path is blocked by intermediate nodes
    this.previewOriginBlocked = false; // True if current node is blocked
    this.previewCannotReach = false; // True if destination cannot be reached from origin
    this.pathPreviewCache = new Map(); // Cache path calculations
    this._pathPreviewRequestId = 0; // Track async requests to prevent stale updates

    // Reachability state (for node blocking system)
    this.reachableNodes = new Set(); // Set of node IDs reachable from current position

    // Event listener cleanup
    this.abortController = null;

    // WebSocket unsubscribers
    this.wsUnsubscribers = [];

    // ProfileDropdown component
    this.profileDropdown = null;

    // Party invite modal
    this.partyInviteModal = null;

    // Responsive subscription
    this.responsiveUnsubscribe = null;

    // Node action menu (positioned near current node)
    this.nodeActionMenu = null;

    // Region system
    this.regions = [];              // Region data from API
    this.showRegionTint = true;     // Toggle for region color tinting on nodes
    this.showRegionBoundaries = false; // Toggle for region boundary lines (optional)
    this.castleNodes = [];          // Cache of castle nodes for quick access

    // Watchtower extended view
    this.watchtowerView = null;     // Extended view data from watchtower node
  }

  async enter() {
    // Get asset loader reference from game
    this.assetLoader = this.game.assetLoader;

    // Initialize effects system
    this.effects = new WorldMapEffects(this.assetLoader);
    await this.effects.init();

    await this.loadWorldData();
    await this.loadRegionData();  // Load region boundaries and castle info
    this.createUI();
    this.centerOnCurrentNode();
    this.setupInputHandlers();
    this.setupWebSocketHandlers();

    // Initialize node action menu (positioned near current node)
    this.nodeActionMenu = new NodeActionMenu({
      game: this.game,
      onAction: (feature) => {
        if (feature === 'battle') {
          this.startBattle();
        } else {
          this.handleFeature(feature);
        }
      }
    });
    this.game.uiOverlay.appendChild(this.nodeActionMenu.element);

    // Set initial node and expand menu
    if (this.currentNode) {
      const position = this.getNodeScreenPosition(this.currentNode);
      this.nodeActionMenu.setNode(this.currentNode, position);
      this.nodeActionMenu.expand();
    }

    // Initialize minimap with region data
    this.minimap = new WorldMapMinimap(this.assetLoader);
    await this.minimap.init();
    this.minimap.calculateWorldBounds(this.nodes);
    this.minimap.setRegionData(this.regions, this.castleNodes);

    // Initialize character display
    this.mapCharacter = new WorldMapCharacter(this.assetLoader);
    await this.initMapCharacter();

    // Initialize stamina bar
    this.staminaBar = new StaminaBar();
    await this.refreshStamina();

    // Initialize travel progress bar
    this.travelProgressBar = new TravelProgressBar();

    // Preload node sprites in background
    this.preloadNodeSprites();

    // Initialize ProfileDropdown
    this.profileDropdown = new ProfileDropdown(this.game);
    this.profileDropdown.show();

    // Subscribe to responsive changes
    this.responsiveUnsubscribe = responsive.onChange(() => {
      this.onBreakpointChange();
    });

    // Start world exploration music (region-aware)
    if (this.game.musicContext) {
      // Set region based on current node's race (map to region name for music)
      // API returns region_race ('human', 'elf', etc.), music uses region names ('heartlands', etc.)
      const regionRace = this.currentNode?.region_race;
      const regionName = regionRace ? RACE_TO_REGION[regionRace] : null;
      if (regionName) {
        this.game.musicContext.setRegion(regionName);
      }
      this.game.musicContext.playExplorationMusic();
    }
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
    // Track request ID to handle race conditions from rapid mouse movements
    const requestId = ++this._pathPreviewRequestId;

    // Clear preview if no node hovered, traveling, or hovering current node
    if (!node || this.isTraveling || !this.currentNode || node.id === this.currentNode.id) {
      this.previewPath = null;
      this.previewCost = 0;
      this.previewAffordable = true;
      this.previewOriginBlocked = false;
      this.previewCannotReach = false;
      return;
    }

    // Check if node is discovered
    if (!this.isNodeDiscovered(node)) {
      this.previewPath = null;
      this.previewCost = 0;
      this.previewAffordable = false;
      this.previewOriginBlocked = false;
      this.previewCannotReach = false;
      return;
    }

    // Check cache first
    const cacheKey = `${this.currentNode.id}-${node.id}`;
    if (this.pathPreviewCache.has(cacheKey)) {
      const cached = this.pathPreviewCache.get(cacheKey);
      this.previewPath = cached.path;
      this.previewCost = cached.cost;
      this.previewAffordable = this.staminaBar ? this.staminaBar.current >= cached.cost : true;
      this.previewBlockedNodes = cached.blockedNodes || [];
      this.previewPathBlocked = cached.pathBlocked || false;
      this.previewOriginBlocked = cached.originBlocked || false;
      this.previewCannotReach = cached.cannotReachFromOrigin || false;
      return;
    }

    // Fetch path from server
    try {
      const result = await this.game.api.getPathPreview(node.id);

      // Discard stale response if a newer request was made
      if (requestId !== this._pathPreviewRequestId) return;

      this.previewPath = result.path;
      this.previewCost = result.cost;
      this.previewAffordable = result.affordable;
      this.previewBlockedNodes = result.blockedNodes || [];
      this.previewPathBlocked = result.pathBlocked || false;
      this.previewOriginBlocked = result.originBlocked || false;
      this.previewCannotReach = result.cannotReachFromOrigin || false;

      // Cache the result with LRU eviction
      if (this.pathPreviewCache.size >= PATH_CACHE_MAX_SIZE) {
        // Evict oldest entry (first key in Map maintains insertion order)
        const firstKey = this.pathPreviewCache.keys().next().value;
        this.pathPreviewCache.delete(firstKey);
      }
      this.pathPreviewCache.set(cacheKey, {
        path: result.path,
        cost: result.cost,
        blockedNodes: result.blockedNodes || [],
        pathBlocked: result.pathBlocked || false,
        originBlocked: result.originBlocked || false,
        cannotReachFromOrigin: result.cannotReachFromOrigin || false
      });
    } catch (err) {
      // Log for debugging but don't show user-facing error
      console.warn('Path preview fetch failed:', err.message);

      // Discard if stale request
      if (requestId !== this._pathPreviewRequestId) return;

      this.previewPath = null;
      this.previewCost = 0;
      this.previewAffordable = false;
      this.previewBlockedNodes = [];
      this.previewPathBlocked = false;
      this.previewOriginBlocked = false;
      this.previewCannotReach = false;
    }
  }

  /**
   * Clear path cache (called after travel or world data reload)
   */
  clearPathCache() {
    this.pathPreviewCache.clear();
  }

  /**
   * Calculate which nodes are reachable from the current position.
   * Uses BFS traversal through connections, considering node blocking.
   *
   * Rules:
   * - Can reach adjacent nodes including blocked ones (to show them as potential targets)
   * - Cannot traverse THROUGH blocked nodes (they block further paths)
   * - Only considers discovered nodes
   *
   * @returns {Set<number>} Set of reachable node IDs
   */
  calculateReachableNodes() {
    this.reachableNodes = new Set();

    if (!this.currentNode || !this.nodes.length || !this.connections.length) {
      return this.reachableNodes;
    }

    // Build adjacency map from connections
    const adjacency = new Map();
    for (const conn of this.connections) {
      if (!adjacency.has(conn.from_node_id)) {
        adjacency.set(conn.from_node_id, []);
      }
      if (!adjacency.has(conn.to_node_id)) {
        adjacency.set(conn.to_node_id, []);
      }
      adjacency.get(conn.from_node_id).push(conn.to_node_id);
      adjacency.get(conn.to_node_id).push(conn.from_node_id);
    }

    // Create node lookup for quick access to blocked status
    const nodeMap = new Map();
    for (const node of this.nodes) {
      nodeMap.set(node.id, node);
    }

    // BFS from current node
    const visited = new Set();
    const queue = [this.currentNode.id];
    visited.add(this.currentNode.id);
    this.reachableNodes.add(this.currentNode.id);

    while (queue.length > 0) {
      const currentId = queue.shift();
      const currentNodeData = nodeMap.get(currentId);

      // If this node is blocked (and not the starting node), we can reach it but not traverse through it
      const isBlocked = currentNodeData?.blocked && currentId !== this.currentNode.id;

      const neighbors = adjacency.get(currentId) || [];
      for (const neighborId of neighbors) {
        if (visited.has(neighborId)) continue;

        const neighborNode = nodeMap.get(neighborId);
        if (!neighborNode) continue;

        // Only consider discovered nodes
        if (!this.isNodeDiscovered(neighborNode)) continue;

        visited.add(neighborId);
        this.reachableNodes.add(neighborId);

        // Only continue BFS from this neighbor if the current node is not blocked
        // (we can reach neighbors of a blocked node, but we can't traverse through it)
        if (!isBlocked) {
          queue.push(neighborId);
        }
      }
    }

    return this.reachableNodes;
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
    // Clear path preview cache to prevent memory buildup
    this.pathPreviewCache.clear();

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

    // Destroy party invite modal
    if (this.partyInviteModal) {
      this.partyInviteModal.destroy();
      this.partyInviteModal = null;
    }

    // Destroy node action menu
    if (this.nodeActionMenu) {
      this.nodeActionMenu.destroy();
      this.nodeActionMenu = null;
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
      // Get world nodes, current position, and terrain obstacles
      const [worldData, currentData, obstaclesData] = await Promise.all([
        this.game.api.getWorldNodes(),
        this.game.api.getCurrentNode(),
        this.game.api.getWorldObstacles().catch(() => ({ obstacles: [] }))  // Gracefully handle if not yet available
      ]);

      this.nodes = worldData.nodes;
      this.obstacles = obstaclesData.obstacles || [];

      // Deduplicate and NORMALIZE connections
      // All connections must have from_node_id < to_node_id for consistent path rendering.
      // This ensures paths look identical regardless of travel direction.
      const seenPairs = new Set();
      this.connections = worldData.connections
        .filter(conn => {
          const key = `${Math.min(conn.from_node_id, conn.to_node_id)}-${Math.max(conn.from_node_id, conn.to_node_id)}`;
          if (seenPairs.has(key)) return false;
          seenPairs.add(key);
          return true;
        })
        .map(conn => {
          // Normalize: ensure from_node_id < to_node_id
          if (conn.from_node_id > conn.to_node_id) {
            return {
              ...conn,
              from_node_id: conn.to_node_id,
              to_node_id: conn.from_node_id
            };
          }
          return conn;
        });

      this.currentNode = currentData.currentNode;

      this.game.state.set('worldNodes', this.nodes);
      this.game.state.set('currentNode', this.currentNode);

      // Calculate reachable nodes first (needed for filtering)
      this.calculateReachableNodes();

      // Update discovery state for fog of war rendering (filtered by reachability)
      if (this.effects) {
        this.effects.updateDiscoveryState(this.nodes, this.connections, this.reachableNodes);
      }

      // Update minimap bounds if nodes changed
      if (this.minimap) {
        this.minimap.calculateWorldBounds(this.nodes);
      }

      // Cache castle nodes for quick access (all 5 regional castles)
      this.castleNodes = this.nodes.filter(n => n.node_type === 'castle');

      // Check if current node is a watchtower and fetch extended view
      if (this.currentNode?.node_type === 'watchtower') {
        await this.fetchWatchtowerView(this.currentNode.id);
      } else {
        // Clear watchtower view when not at a watchtower
        this.watchtowerView = null;
      }
    } catch (err) {
      console.error('Failed to load world:', err);
      parchmentToast.error('World Data Error', 'Failed to load world data. Please try again.');
    }
  }

  /**
   * Fetch extended view from watchtower
   * @param {number} nodeId - Watchtower node ID
   */
  async fetchWatchtowerView(nodeId) {
    try {
      const result = await this.game.api.getWatchtowerView(nodeId);
      this.watchtowerView = {
        watchtowerNode: result.watchtowerNode,
        revealedNodes: result.revealedNodes,
        revealedConnections: result.revealedConnections,
        revealRadiusPixels: result.watchtowerNode.reveal_radius_pixels || 1500
      };
      console.log(`Watchtower view loaded: ${result.revealedNodes.length} nodes revealed within ${this.watchtowerView.revealRadiusPixels}px`);
    } catch (err) {
      console.warn('Failed to fetch watchtower view:', err);
      this.watchtowerView = null;
    }
  }

  /**
   * Load region data including boundaries and castle information
   * Supports the 5-region system with race-based homelands
   */
  async loadRegionData() {
    try {
      const regionData = await this.game.api.getWorldRegions();
      this.regions = regionData.regions || [];

      // Store regions in game state for other systems
      this.game.state.set('worldRegions', this.regions);

      console.log(`Loaded ${this.regions.length} regions with ${this.castleNodes.length} castles`);
    } catch (err) {
      // Non-fatal - region boundaries are optional visual enhancement
      console.warn('Failed to load region data:', err);
      this.regions = [];
    }
  }

  /**
   * Get region color configuration for a given race
   * @param {string} race - The region race (human, elf, dwarf, vampire, orc)
   * @returns {Object} Color configuration with primary, secondary, and border colors
   */
  getRegionColor(race) {
    return REGION_COLORS[race] || REGION_COLORS.human;
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
    // Create empty container for any future UI elements
    // Note: Node action menu is now a separate component (NodeActionMenu)
    const container = document.createElement('div');
    container.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;';

    this.game.uiOverlay.appendChild(container);
    this.uiElement = container;
  }

  // Menu functionality is now handled by ProfileDropdown

  updateNodeInfo() {
    // Legacy method - node info is now handled by NodeActionMenu component
    // This method is kept for backwards compatibility but does nothing
  }

  /**
   * Get viewport position for a node (for positioning DOM elements over canvas)
   * Converts canvas coordinates to viewport coordinates accounting for:
   * - Canvas scale factor (internal resolution vs display size)
   * - Canvas position within viewport (centered with letterboxing)
   * @param {Object} node - Node object with x_coord and y_coord
   * @returns {Object} Position object { x, y, nodeSize, canvasHeight }
   */
  getNodeScreenPosition(node) {
    if (!node) return null;

    // Find the full node data if we only have partial info
    const fullNode = this.nodes.find(n => n.id === node.id) || node;

    // Calculate position in canvas coordinate space
    const canvasX = fullNode.x_coord * this.nodeSpacing + this.cameraX;
    const canvasY = fullNode.y_coord * this.nodeSpacing + this.cameraY;

    // Convert canvas coordinates to viewport coordinates
    // The canvas is scaled and centered, so we need to account for:
    // 1. The canvas's position within the viewport (rect.left, rect.top)
    // 2. The scale factor between internal canvas size and display size
    const rect = this.game.canvas.getBoundingClientRect();
    const scale = this.game.scale || 1;

    const viewportX = rect.left + (canvasX * scale);
    const viewportY = rect.top + (canvasY * scale);

    return {
      x: viewportX,
      y: viewportY,
      nodeSize: this.nodeSize * scale,  // Scale the node size too
      canvasHeight: rect.height  // Use actual display height for edge detection
    };
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
    // Uses existing icons where available, new icons for farm/guild/courtyard
    const iconMap = {
      blacksmith: { category: 'actions', name: 'blacksmith' },
      marketplace: { category: 'actions', name: 'marketplace' },
      tavern: { category: 'actions', name: 'tavern' },
      apothecary: { category: 'actions', name: 'apothecary' },
      coliseum: { category: 'actions', name: 'battle' },
      farm: { category: 'actions', name: 'harvest' },
      guild_hall: { category: 'actions', name: 'recruit' },
      guild_advancement: { category: 'actions', name: 'advance' },
      courtyard: { category: 'actions', name: 'social' },
      battle: { category: 'actions', name: 'battle' }
    };

    // Get label text
    let label = this.capitalize(feature);
    if (feature === 'guild_hall' && this.currentNode.guild_class) {
      label = GUILD_ACTION_LABELS[this.currentNode.guild_class] || 'Guild Hall';
    }
    if (feature === 'guild_advancement') {
      label = 'Advancement';
    }

    // Parchment button styling
    const bgGradient = isPrimary
      ? `linear-gradient(to bottom, ${PARCHMENT_COLORS.accent.copper}, #9a5f23)`
      : `linear-gradient(to bottom, ${PARCHMENT_COLORS.light}, ${PARCHMENT_COLORS.dark})`;

    const textColor = isPrimary ? PARCHMENT_COLORS.text.inverse : PARCHMENT_COLORS.text.primary;
    const borderColor = isPrimary ? PARCHMENT_COLORS.borderDark : PARCHMENT_COLORS.border;

    btn.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 6px;
      padding: ${isMobile ? '6px 10px' : '6px 12px'};
      background: ${bgGradient};
      border: 1px solid ${borderColor};
      border-radius: 4px;
      color: ${textColor};
      font-family: Georgia, serif;
      font-size: ${isMobile ? '11px' : '12px'};
      font-weight: bold;
      cursor: pointer;
      transition: transform 0.1s, box-shadow 0.15s;
      box-shadow: 0 1px 3px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.25);
      white-space: nowrap;
      width: 100%;
      text-align: left;
    `;

    // Hover effects
    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'translateY(-1px)';
      btn.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.25)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'translateY(0)';
      btn.style.boxShadow = '0 1px 3px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.25)';
    });
    btn.addEventListener('mousedown', () => {
      btn.style.transform = 'translateY(0)';
      btn.style.boxShadow = '0 0 2px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.25)';
    });
    btn.addEventListener('mouseup', () => {
      btn.style.transform = 'translateY(-1px)';
    });

    // Use Icon component for visual consistency
    const iconConfig = iconMap[feature];
    if (iconConfig) {
      // Show icon + label with proper alignment
      const iconSize = isMobile ? 14 : 16;
      btn.innerHTML = `
        <span style="display: flex; align-items: center; justify-content: center; width: ${iconSize}px; height: ${iconSize}px; flex-shrink: 0;">
          ${Icon.html(iconConfig.category, iconConfig.name, { size: 'sm' }).replace(/<span[^>]*>[^<]*<\/span>/g, '')}
        </span>
        <span style="flex: 1;">${label}</span>
      `;
    } else {
      // Fallback to just label
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
      farm: 'farm',
      caravan: 'caravan'
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

    // Guild advancement feature opens the advancement quest scene
    if (feature === 'guild_advancement') {
      this.game.scenes.switchTo('guildAdvancement', {
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

    // Ruins exploration opens the puzzle modal
    if (feature === 'explore_ruins') {
      this.openRuinsPuzzle();
      return;
    }

    // Fishing opens the fishing scene
    if (feature === 'fishing') {
      this.game.scenes.switchTo('fishing', {
        nodeId: this.currentNode.id,
        nodeName: this.currentNode.name
      });
      return;
    }

    // Fast travel opens the fast travel modal (requires Wayfarer's Compass relic)
    if (feature === 'fast_travel') {
      this.openFastTravelModal();
      return;
    }

    // Stamina restore at town nodes (requires Vitality Charm relic)
    if (feature === 'stamina_restore') {
      this.openStaminaRestoreModal();
      return;
    }

    // Other features not yet implemented
    parchmentToast.info('Coming Soon', `${this.capitalize(feature)} feature is under development.`);
  }

  async openRuinsPuzzle() {
    // Dynamically import the modal to avoid circular dependencies
    const { RuinsPuzzleModal } = await import('../modals/RuinsPuzzleModal.js');

    const modal = new RuinsPuzzleModal({
      game: this.game,
      onClose: () => {
        modal.destroy();
      },
      onSolve: (result) => {
        // Could trigger animations or updates here
        console.log('Ruins solved:', result);
      }
    });

    await modal.show(this.currentNode.id);
  }

  async startBattle() {
    // Go to battle formation scene to let player arrange their party
    this.game.scenes.switchTo('battleFormation', {
      type: 'pve',
      node: this.currentNode
    });
  }

  /**
   * Open the fast travel modal to select a destination castle
   */
  async openFastTravelModal() {
    try {
      // Fetch available destinations and relic status
      const result = await this.game.api.getFastTravelDestinations();

      if (!result.hasRelic) {
        parchmentToast.warning(
          'Relic Required',
          'You need the Wayfarer\'s Compass relic to use fast travel.'
        );
        return;
      }

      // Import and show the modal
      const { FastTravelModal } = await import('../modals/FastTravelModal.js');
      const modal = new FastTravelModal({
        game: this.game,
        destinations: result.destinations,
        currentRegionId: result.currentRegionId,
        onTravel: async (destination) => {
          try {
            const travelResult = await this.game.api.fastTravel(destination.nodeId);
            parchmentToast.success(
              'Fast Travel Complete',
              `Arrived at ${travelResult.destination.name} (${travelResult.goldSpent}g spent)`
            );

            // Update gold in state
            this.game.state.set('gold', travelResult.newGold);

            // Reload world data to update position
            await this.loadWorldData();
            this.centerOnCurrentNode();
            this.clearPathCache();

            // Update stamina display
            if (travelResult.stamina) {
              this.staminaBar.setStamina(travelResult.stamina);
            }

            // Update node action menu
            if (this.currentNode) {
              const position = this.getNodeScreenPosition(this.currentNode);
              this.nodeActionMenu.setNode(this.currentNode, position);
              this.nodeActionMenu.expand();
            }

            modal.destroy();
          } catch (err) {
            parchmentToast.error('Fast Travel Failed', err.message);
          }
        },
        onClose: () => {
          modal.destroy();
        }
      });

      modal.show();
    } catch (err) {
      parchmentToast.error('Error', err.message);
    }
  }

  /**
   * Open the stamina restore modal to purchase stamina
   */
  async openStaminaRestoreModal() {
    try {
      // Check if user has the relic
      const relicCheck = await this.game.api.checkRelic('vitality_charm');

      if (!relicCheck.owned) {
        parchmentToast.warning(
          'Relic Required',
          'You need the Vitality Charm relic to restore stamina for gold.'
        );
        return;
      }

      // Get current stamina info
      const characters = this.game.state.get('characters') || [];
      const partyLeader = characters.find(c => c.party_slot === 1) || characters[0];

      if (!partyLeader) {
        parchmentToast.error('Error', 'No active character found.');
        return;
      }

      const staminaResult = await this.game.api.getCharacterStamina(partyLeader.id);
      const stamina = staminaResult.stamina;
      const missingStamina = stamina.max - stamina.current;

      if (missingStamina <= 0) {
        parchmentToast.info('Stamina Full', 'Your stamina is already at maximum.');
        return;
      }

      const costPerPoint = relicCheck.effects?.cost_per_point || 100;
      const userGold = this.game.state.get('gold') || 0;

      // Import and show the modal
      const { StaminaRestoreModal } = await import('../modals/StaminaRestoreModal.js');
      const modal = new StaminaRestoreModal({
        game: this.game,
        currentStamina: stamina.current,
        maxStamina: stamina.max,
        costPerPoint,
        userGold,
        onRestore: async (amount) => {
          try {
            const result = await this.game.api.restoreStaminaForGold(amount);
            parchmentToast.success(
              'Stamina Restored',
              `Restored ${result.staminaRestored} stamina for ${result.goldSpent}g`
            );

            // Update gold in state
            this.game.state.set('gold', result.newGold);

            // Update stamina display
            if (result.stamina) {
              this.staminaBar.setStamina(result.stamina);
            }

            modal.destroy();
          } catch (err) {
            parchmentToast.error('Restore Failed', err.message);
          }
        },
        onClose: () => {
          modal.destroy();
        }
      });

      modal.show();
    } catch (err) {
      parchmentToast.error('Error', err.message);
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
      // Show the party invite modal
      if (!this.partyInviteModal) {
        this.partyInviteModal = new PartyInviteModal(this.game);
      }

      this.partyInviteModal.show({
        inviteId: payload.inviteId,
        partyId: payload.partyId,
        partyName: payload.partyName,
        leaderUsername: payload.fromUsername,
        expiresAt: payload.expiresAt,
        onClose: (accepted) => {
          if (accepted) {
            // Refresh party status bar if available
            if (this.game.partyStatusBar) {
              this.game.partyStatusBar.refresh();
            }
          }
        }
      });
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
      // Skip nodes that are not reachable from current position
      if (this.reachableNodes.size > 0 && !this.reachableNodes.has(node.id)) {
        continue;
      }

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

        // Collapse node action menu during travel
        if (this.nodeActionMenu) {
          this.nodeActionMenu.collapse();
        }

        // Convert path nodes to screen positions
        const walkPath = result.pathNodes.map(n => ({
          x: n.x_coord * this.nodeSpacing,
          y: n.y_coord * this.nodeSpacing,
          id: n.id,
          name: n.name
        }));

        // Calculate estimated travel duration from path length
        let totalDistance = 0;
        for (let i = 1; i < walkPath.length; i++) {
          const dx = walkPath[i].x - walkPath[i - 1].x;
          const dy = walkPath[i].y - walkPath[i - 1].y;
          totalDistance += Math.sqrt(dx * dx + dy * dy);
        }
        // walkSpeed is 200 pixels/second, add buffer for spline curves
        const estimatedDuration = (totalDistance / 200) * 1.3 * 1000;

        // Start travel progress bar
        if (this.travelProgressBar) {
          this.travelProgressBar.startTravel(result.currentNode.name, estimatedDuration);
        }

        // Start walking animation
        this.mapCharacter.startWalking(walkPath, () => {
          this.onTravelComplete(result, previousNodeId);
        });
      } else {
        // No animation - complete immediately
        this.onTravelComplete(result, previousNodeId);
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

    // Play arrival sound
    if (this.game.audio) {
      this.game.audio.playSFX('footstep');
    }

    // Update state
    this.currentNode = result.currentNode;
    this.game.state.set('currentNode', this.currentNode);

    // Update music region if changed
    if (this.game.musicContext && this.currentNode?.region_race) {
      const regionName = RACE_TO_REGION[this.currentNode.region_race];
      if (regionName) {
        this.game.musicContext.setRegion(regionName);
      }
    }

    // Update stamina from travel result
    if (result.stamina && this.staminaBar) {
      this.staminaBar.setStamina(result.stamina);
    }

    // Reload world data to get newly discovered nodes (fog of war reveal)
    await this.loadWorldData();

    // Update minimap with latest castle nodes
    if (this.minimap) {
      this.minimap.setRegionData(this.regions, this.castleNodes);
    }

    // Clear path cache since we're at a new position
    this.clearPathCache();

    // Update character position to final node
    this.updateCharacterPosition();

    this.updateNodeInfo();

    // Update node action menu with new node and expand
    if (this.nodeActionMenu && this.currentNode) {
      const position = this.getNodeScreenPosition(this.currentNode);
      this.nodeActionMenu.setNode(this.currentNode, position);
      // Small delay before expanding for smoother animation sequence
      setTimeout(() => {
        if (this.nodeActionMenu) {
          this.nodeActionMenu.expand();
        }
      }, 50);
    }

    // Complete travel progress bar (triggers fade out)
    if (this.travelProgressBar) {
      this.travelProgressBar.complete();
    }

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

    // Update travel progress bar
    if (this.travelProgressBar) {
      this.travelProgressBar.update(deltaTime);
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

    // Render terrain obstacles (lakes, mountains, forests)
    if (this.effects && this.obstacles && this.obstacles.length > 0) {
      this.effects.renderObstacles(ctx, this.cameraX, this.cameraY, this.obstacles);
    }

    // Render region boundaries (optional, subtle background layer)
    if (this.showRegionBoundaries && this.regions.length > 0) {
      this.renderRegionBoundaries(ctx);
    }

    ctx.save();

    // Draw watchtower-revealed connections with dashed lines at reduced opacity
    if (this.watchtowerView) {
      this.renderWatchtowerRevealedConnections(ctx);
    }

    // Draw connections with organic Catmull-Rom spline paths
    for (const conn of this.connections) {
      const fromNode = this.nodes.find(n => n.id === conn.from_node_id);
      const toNode = this.nodes.find(n => n.id === conn.to_node_id);

      if (fromNode && toNode) {
        // Skip connections where either endpoint is not reachable
        if (this.reachableNodes.size > 0 &&
            !this.reachableNodes.has(fromNode.id) &&
            !this.reachableNodes.has(toNode.id)) {
          continue;
        }

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
          // Fallback to simple bezier path (with proper state isolation)
          ctx.save();
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
          ctx.restore();
        }
      }
    }

    // Draw locked path indicators ONLY when player is on a blocked node
    // and the path leads to an undiscovered destination
    const isCurrentNodeBlocked = this.currentNode?.blocked === true;

    if (isCurrentNodeBlocked) {
      for (const conn of this.connections) {
        const fromNode = this.nodes.find(n => n.id === conn.from_node_id);
        const toNode = this.nodes.find(n => n.id === conn.to_node_id);

        if (!fromNode || !toNode) continue;

        // Check if this connection involves the current node
        const currentNodeId = this.currentNode.id;
        const isCurrentNodeInConnection =
          conn.from_node_id === currentNodeId || conn.to_node_id === currentNodeId;

        if (!isCurrentNodeInConnection) continue;

        // Determine which node is the destination (the one that's not current)
        const destinationNode = conn.from_node_id === currentNodeId ? toNode : fromNode;

        // Show lock if destination is discovered but not visited
        // (discovered via adjacency, not by traveling there)
        const isDestinationUndiscovered =
          this.isNodeDiscovered(destinationNode) && !destinationNode.visited;

        if (isDestinationUndiscovered) {
          // Use normalized node ordering for consistent spline generation (smaller ID first)
          const startNode = fromNode.id < toNode.id ? fromNode : toNode;
          const endNode = fromNode.id < toNode.id ? toNode : fromNode;

          const x1 = startNode.x_coord * this.nodeSpacing + this.cameraX;
          const y1 = startNode.y_coord * this.nodeSpacing + this.cameraY;
          const x2 = endNode.x_coord * this.nodeSpacing + this.cameraX;
          const y2 = endNode.y_coord * this.nodeSpacing + this.cameraY;

          // Skip if off screen (use same 50px margin as regular connections for consistency)
          const margin = 50;
          if (Math.max(x1, x2) < -margin || Math.min(x1, x2) > ctx.canvas.width + margin ||
              Math.max(y1, y2) < -margin || Math.min(y1, y2) > ctx.canvas.height + margin) {
            continue;
          }

          // Generate organic spline points matching the actual path curves
          const controlPoints = generatePathControlPoints(x1, y1, x2, y2, startNode.id, endNode.id);
          const splinePoints = generateSplinePoints(controlPoints, 10);

          if (splinePoints.length < 2) continue;

          // Draw locked path overlay following the organic curve
          ctx.save();
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          ctx.beginPath();
          ctx.moveTo(splinePoints[0].x, splinePoints[0].y);
          for (let j = 1; j < splinePoints.length; j++) {
            ctx.lineTo(splinePoints[j].x, splinePoints[j].y);
          }
          ctx.strokeStyle = 'rgba(180, 80, 60, 0.5)';
          ctx.lineWidth = 6;
          ctx.stroke();
          ctx.restore();

          // Calculate midpoint along the spline for lock icon
          const midIndex = Math.floor(splinePoints.length / 2);
          const midX = splinePoints[midIndex].x;
          const midY = splinePoints[midIndex].y;

          // Draw lock icon background and icon (isolated canvas state)
          ctx.save();
          ctx.beginPath();
          ctx.arc(midX, midY, 12, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(60, 40, 30, 0.85)';
          ctx.fill();
          ctx.strokeStyle = '#a85040';
          ctx.lineWidth = 2;
          ctx.stroke();

          // Draw lock icon
          ctx.fillStyle = '#6b2d3d';  // Burgundy accent for blocked paths
          ctx.font = 'bold 12px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('\u{1F512}', midX, midY);
          ctx.restore();
        }
      }
    }

    // Draw path preview (golden glow along the path)
    if (this.previewPath && this.previewPath.length > 1) {
      this.renderPathPreview(ctx);
    }

    // Draw nodes
    for (const node of this.nodes) {
      // Skip nodes that are not reachable from current position
      if (this.reachableNodes.size > 0 && !this.reachableNodes.has(node.id)) {
        continue;
      }

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

        // Draw region color tint overlay (subtle ring around node)
        if (this.showRegionTint && node.region_race && !isCurrent) {
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
        const isCombatNode = ['forest', 'cave', 'mountain', 'bridge'].includes(node.node_type);
        if (isCombatNode && !isCurrent && !isMystery) {
          if (node.blocked) {
            // Red tint overlay for blocked nodes
            ctx.save();
            ctx.globalAlpha = 0.4;
            ctx.fillStyle = '#ff4444';
            ctx.beginPath();
            ctx.arc(x, y, drawSize / 2 + 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            // Lock icon (isolated state)
            ctx.save();
            ctx.fillStyle = '#ff4444';
            ctx.font = 'bold 16px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText('\u{1F512}', x, y - drawSize / 2 - 2); // Lock emoji
            ctx.restore();
          } else if (node.cleared) {
            // Green checkmark for cleared nodes (isolated state)
            ctx.save();
            ctx.fillStyle = '#44ff44';
            ctx.font = 'bold 14px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText('\u2713', x, y - drawSize / 2 - 2); // Checkmark
            ctx.restore();
          }
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

        // Node icon - mystery nodes show "?" (isolated state for text properties)
        ctx.save();
        ctx.fillStyle = isMystery ? '#9a9aaa' : '#fff';
        ctx.font = isMystery ? 'bold 18px Arial' : '16px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.getNodeIcon(node.node_type, isVisited), x, y);
        ctx.restore();

        // Draw blocked/cleared indicator for combat nodes (fallback style)
        const isCombatNode = ['forest', 'cave', 'mountain', 'bridge'].includes(node.node_type);
        if (isCombatNode && !isCurrent && !isMystery) {
          if (node.blocked) {
            // Red border for blocked
            ctx.save();
            ctx.strokeStyle = '#ff4444';
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.restore();
          } else if (node.cleared) {
            // Green checkmark above (isolated state)
            ctx.save();
            ctx.fillStyle = '#44ff44';
            ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText('\u2713', x, y - this.nodeSize - 4);
            ctx.restore();
          }
        }
      }

      // Note: tooltips are rendered after fog of war for visibility
    }

    // Render watchtower-revealed nodes at reduced opacity
    if (this.watchtowerView) {
      this.renderWatchtowerRevealedNodes(ctx);
    }

    // Render golden glow around active watchtower
    if (this.watchtowerView && this.currentNode) {
      const wtNode = this.watchtowerView.watchtowerNode;
      const x = wtNode.x_coord * this.nodeSpacing + this.cameraX;
      const y = wtNode.y_coord * this.nodeSpacing + this.cameraY;

      // Render enhanced golden glow for active watchtower
      if (this.effects) {
        this.effects.renderNodeGlow(ctx, x, y, this.nodeSize + 10, '#ffd700', true);
      }
    }

    // Render fog of war overlay (before character and labels so player/text is always visible)
    if (this.effects) {
      this.effects.renderFogOfWar(ctx, this.cameraX, this.cameraY, ctx.canvas.width, ctx.canvas.height, this.nodes, this.connections, this.watchtowerView);
    }

    // Second pass: Render node tooltips AFTER fog of war so they're always visible
    for (const node of this.nodes) {
      // Skip nodes that are not reachable from current position
      if (this.reachableNodes.size > 0 && !this.reachableNodes.has(node.id)) {
        continue;
      }

      const x = node.x_coord * this.nodeSpacing + this.cameraX;
      const y = node.y_coord * this.nodeSpacing + this.cameraY;

      // Skip if off screen
      if (x < -50 || x > ctx.canvas.width + 50 || y < -50 || y > ctx.canvas.height + 50) {
        continue;
      }

      const isCurrent = this.currentNode && node.id === this.currentNode.id;
      const isHovered = this.hoveredNode && node.id === this.hoveredNode.id;

      // Node tooltip for hovered nodes only (current node uses NodeActionMenu)
      // Skip if this is the current node - its info is shown in the DOM menu
      if (isHovered && !isCurrent) {
        this.renderNodeTooltip(ctx, node, x, y, false);
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

    // Render travel progress bar (below stamina bar)
    if (this.travelProgressBar) {
      this.travelProgressBar.render(ctx);
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

    // Update node action menu position (DOM element follows current node)
    if (this.nodeActionMenu && this.currentNode) {
      const position = this.getNodeScreenPosition(this.currentNode);
      if (position) {
        this.nodeActionMenu.updatePosition(position.x, position.y, position.nodeSize, position.canvasHeight);
      }
    }
  }

  /**
   * Render path preview (golden glow along the path) using organic curves
   * Color coding:
   * - gold = affordable path
   * - red = not affordable (insufficient stamina)
   * - orange = path blocked by intermediate node
   * - maroon = cannot reach from origin (origin is blocked)
   */
  renderPathPreview(ctx) {
    if (!this.previewPath || this.previewPath.length < 2) return;

    // Determine path color based on blocking/affordability state
    let pathColor, glowColor;
    if (this.previewCannotReach) {
      pathColor = 'rgba(128, 0, 64, 0.6)'; // Maroon for unreachable from origin
      glowColor = 'rgba(128, 0, 64, 0.2)';
    } else if (this.previewPathBlocked) {
      pathColor = 'rgba(255, 140, 0, 0.6)'; // Orange for blocked intermediate
      glowColor = 'rgba(255, 140, 0, 0.2)';
    } else if (!this.previewAffordable) {
      pathColor = 'rgba(180, 80, 80, 0.6)'; // Red for not affordable
      glowColor = 'rgba(180, 80, 80, 0.2)';
    } else {
      pathColor = 'rgba(255, 215, 0, 0.6)'; // Gold for affordable
      glowColor = 'rgba(255, 215, 0, 0.2)';
    }

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Draw glow effect along the path using organic curves
    for (let i = 0; i < this.previewPath.length - 1; i++) {
      const fromNode = this.nodes.find(n => n.id === this.previewPath[i]);
      const toNode = this.nodes.find(n => n.id === this.previewPath[i + 1]);

      if (!fromNode || !toNode) continue;

      // CRITICAL: Normalize node ordering for spline generation
      // Always generate spline with smaller ID first for consistent curves
      const startNode = fromNode.id < toNode.id ? fromNode : toNode;
      const endNode = fromNode.id < toNode.id ? toNode : fromNode;

      const x1 = startNode.x_coord * this.nodeSpacing + this.cameraX;
      const y1 = startNode.y_coord * this.nodeSpacing + this.cameraY;
      const x2 = endNode.x_coord * this.nodeSpacing + this.cameraX;
      const y2 = endNode.y_coord * this.nodeSpacing + this.cameraY;

      // Skip if off screen
      const margin = 100;
      if (Math.max(x1, x2) < -margin || Math.min(x1, x2) > ctx.canvas.width + margin ||
          Math.max(y1, y2) < -margin || Math.min(y1, y2) > ctx.canvas.height + margin) {
        continue;
      }

      // Generate organic spline points (using normalized node IDs)
      const controlPoints = generatePathControlPoints(x1, y1, x2, y2, startNode.id, endNode.id);
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
      } else if (this.previewCannotReach) {
        // Cannot reach from origin (origin is blocked)
        costLine = { text: 'Clear area first', color: '#800040' };
      } else if (this.previewPathBlocked) {
        // Path is blocked by intermediate node
        costLine = { text: 'Path blocked', color: '#ff8c00' };
      } else if (this.previewCost > 0) {
        if (this.previewAffordable) {
          costLine = { text: `${this.previewCost} stamina`, color: '#6a8a6a' };
        } else {
          const currentStamina = this.staminaBar?.current || 0;
          costLine = { text: `Need ${this.previewCost - currentStamina} more stamina`, color: '#c54545' };
        }
      }
    }

    // Add blocked indicator if destination is blocked (only for VISITED nodes)
    // Undiscovered blocked nodes should still show "Mystery location"
    const isCombatNode = ['forest', 'cave', 'mountain', 'bridge'].includes(node.node_type);
    if (isCombatNode && node.blocked && !isCurrent && isVisited) {
      costLine = { text: 'Blocked - defeat enemies first', color: '#ff4444' };
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
   * Render region boundaries as subtle colored zones
   * Uses convex hull approximation based on region castle nodes
   */
  renderRegionBoundaries(ctx) {
    ctx.save();

    for (const region of this.regions) {
      if (!region.race || !region.castleNodeId) continue;

      // Find all nodes belonging to this region
      const regionNodes = this.nodes.filter(n =>
        n.region_race === region.race &&
        this.reachableNodes.has(n.id)
      );

      if (regionNodes.length < 3) continue;

      // Get region colors
      const colors = this.getRegionColor(region.race);

      // Calculate convex hull of region nodes for boundary
      const points = regionNodes.map(n => ({
        x: n.x_coord * this.nodeSpacing + this.cameraX,
        y: n.y_coord * this.nodeSpacing + this.cameraY
      }));

      const hull = this.computeConvexHull(points);
      if (hull.length < 3) continue;

      // Draw filled region with low opacity
      ctx.beginPath();
      ctx.moveTo(hull[0].x, hull[0].y);
      for (let i = 1; i < hull.length; i++) {
        ctx.lineTo(hull[i].x, hull[i].y);
      }
      ctx.closePath();

      ctx.fillStyle = colors.primary;
      ctx.globalAlpha = 0.05;
      ctx.fill();

      // Draw boundary line
      ctx.strokeStyle = colors.border;
      ctx.globalAlpha = 0.15;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  /**
   * Compute convex hull using Graham scan algorithm
   * @param {Array<{x: number, y: number}>} points - Points to compute hull for
   * @returns {Array<{x: number, y: number}>} Convex hull vertices in CCW order
   */
  computeConvexHull(points) {
    if (points.length < 3) return points;

    // Find the bottommost point (or leftmost if tied)
    let start = 0;
    for (let i = 1; i < points.length; i++) {
      if (points[i].y > points[start].y ||
          (points[i].y === points[start].y && points[i].x < points[start].x)) {
        start = i;
      }
    }

    // Swap start point to beginning
    [points[0], points[start]] = [points[start], points[0]];
    const pivot = points[0];

    // Sort by polar angle with respect to pivot
    const sorted = points.slice(1).sort((a, b) => {
      const angleA = Math.atan2(a.y - pivot.y, a.x - pivot.x);
      const angleB = Math.atan2(b.y - pivot.y, b.x - pivot.x);
      if (angleA !== angleB) return angleA - angleB;
      // If same angle, sort by distance (closer first)
      const distA = (a.x - pivot.x) ** 2 + (a.y - pivot.y) ** 2;
      const distB = (b.x - pivot.x) ** 2 + (b.y - pivot.y) ** 2;
      return distA - distB;
    });

    // Build hull using stack
    const hull = [pivot];

    for (const p of sorted) {
      // Remove points that make a clockwise turn
      while (hull.length > 1) {
        const top = hull[hull.length - 1];
        const second = hull[hull.length - 2];
        const cross = (top.x - second.x) * (p.y - second.y) -
                     (top.y - second.y) * (p.x - second.x);
        if (cross <= 0) {
          hull.pop();
        } else {
          break;
        }
      }
      hull.push(p);
    }

    return hull;
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

  /**
   * Render watchtower-revealed connections with dashed lines at reduced opacity
   * These are connections that are visible from the watchtower but not yet discovered
   */
  renderWatchtowerRevealedConnections(ctx) {
    if (!this.watchtowerView) return;

    const { revealedNodes, revealedConnections } = this.watchtowerView;

    // Create lookup for revealed nodes (not in main nodes list)
    const discoveredNodeIds = new Set(this.nodes.map(n => n.id));
    const revealedNodeMap = new Map(revealedNodes.map(n => [n.id, n]));

    ctx.save();
    ctx.globalAlpha = 0.5;

    for (const conn of revealedConnections) {
      // Skip if both nodes are already discovered (connection already rendered)
      if (discoveredNodeIds.has(conn.from_node_id) && discoveredNodeIds.has(conn.to_node_id)) {
        continue;
      }

      // Get node data from either revealed nodes or existing nodes
      const fromNode = revealedNodeMap.get(conn.from_node_id) ||
                       this.nodes.find(n => n.id === conn.from_node_id);
      const toNode = revealedNodeMap.get(conn.to_node_id) ||
                     this.nodes.find(n => n.id === conn.to_node_id);

      if (!fromNode || !toNode) continue;

      const x1 = fromNode.x_coord * this.nodeSpacing + this.cameraX;
      const y1 = fromNode.y_coord * this.nodeSpacing + this.cameraY;
      const x2 = toNode.x_coord * this.nodeSpacing + this.cameraX;
      const y2 = toNode.y_coord * this.nodeSpacing + this.cameraY;

      // Skip if off screen
      const margin = 50;
      if (Math.max(x1, x2) < -margin || Math.min(x1, x2) > ctx.canvas.width + margin ||
          Math.max(y1, y2) < -margin || Math.min(y1, y2) > ctx.canvas.height + margin) {
        continue;
      }

      // Draw dashed connection line
      const control = this.getPathControlPoint(x1, y1, x2, y2, conn.from_node_id, conn.to_node_id);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(control.x, control.y, x2, y2);
      ctx.strokeStyle = 'rgba(180, 160, 100, 0.6)'; // Golden-brown for watchtower reveal
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  /**
   * Render watchtower-revealed nodes at 50% opacity
   * Shows node type icon but uses "?" for name unless already discovered
   */
  renderWatchtowerRevealedNodes(ctx) {
    if (!this.watchtowerView) return;

    const { revealedNodes } = this.watchtowerView;

    // Create set of already-discovered node IDs for quick lookup
    const discoveredNodeIds = new Set(this.nodes.map(n => n.id));

    for (const node of revealedNodes) {
      // Skip nodes that are already in the main nodes list (already discovered)
      if (discoveredNodeIds.has(node.id)) {
        continue;
      }

      const x = node.x_coord * this.nodeSpacing + this.cameraX;
      const y = node.y_coord * this.nodeSpacing + this.cameraY;

      // Skip if off screen
      if (x < -50 || x > ctx.canvas.width + 50 || y < -50 || y > ctx.canvas.height + 50) {
        continue;
      }

      ctx.save();
      ctx.globalAlpha = 0.5;

      // Try to render node sprite at reduced opacity
      const nodeSprite = this.getNodeSprite(node.node_type);

      if (nodeSprite) {
        const spriteSize = this.getNodeSpriteSize(node.node_type);
        const offset = spriteSize / 2;

        // Draw shadow under sprite
        ctx.save();
        ctx.globalAlpha = 0.15;
        ctx.filter = 'blur(4px)';
        ctx.drawImage(nodeSprite, x - offset + 3, y - offset + 3, spriteSize, spriteSize);
        ctx.restore();

        // Draw main sprite at 50% opacity
        ctx.globalAlpha = 0.5;
        ctx.drawImage(nodeSprite, x - offset, y - offset, spriteSize, spriteSize);

        // Draw watchtower reveal indicator (subtle golden ring)
        ctx.strokeStyle = 'rgba(255, 215, 0, 0.4)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(x, y, spriteSize / 2 + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        // Fallback: Draw colored circle with icon
        ctx.beginPath();
        ctx.arc(x, y, this.nodeSize, 0, Math.PI * 2);
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

      // Draw node name - show actual name (backend now always provides it for watchtower reveals)
      const displayName = node.name || '?';
      ctx.font = 'bold 11px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      // Text shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillText(displayName, x + 1, y + this.nodeSize + 5);

      // Main text - golden/amber for watchtower-revealed (undiscovered), white for discovered
      ctx.fillStyle = node.discovered ? 'rgba(255, 255, 255, 0.8)' : 'rgba(255, 220, 130, 0.9)';
      ctx.fillText(displayName, x, y + this.nodeSize + 4);

      ctx.restore();
    }
  }
}
