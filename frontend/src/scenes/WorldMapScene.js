import { Scene } from './Scene.js';
import { WorldMapEffects } from '../worldmap/WorldMapEffects.js';
import { WorldMapMinimap } from '../worldmap/WorldMapMinimap.js';
import { WorldMapCharacter } from '../worldmap/WorldMapCharacter.js';
import { WorldMapHUDPanel } from '../worldmap/WorldMapHUDPanel.js';
import { NodeActionMenu } from '../worldmap/NodeActionMenu.js';
import { NodeHoverTooltip } from '../worldmap/NodeHoverTooltip.js';
import { QuestMarkerManager } from '../worldmap/QuestMarkerManager.js';
import { QuestProgressHUD } from '../worldmap/QuestProgressHUD.js';
import { DOMFogOverlay } from '../worldmap/DOMFogOverlay.js';
import { WorldMapPathSystem } from '../worldmap/WorldMapPathSystem.js';
import { WorldMapNodeRenderer } from '../worldmap/WorldMapNodeRenderer.js';
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

    // Node renderer (handles all node visual rendering)
    this.nodeRenderer = new WorldMapNodeRenderer(this);

    // Asset loader reference
    this.assetLoader = null;

    // Effects system
    this.effects = null;

    // Minimap
    this.minimap = null;

    // Character display on map
    this.mapCharacter = null;

    // Unified HUD panel (stamina, travel progress, zodiac)
    this.hudPanel = null;

    // Separate HUD canvas layer (renders above fog overlay)
    this.hudCanvas = null;
    this.hudCtx = null;

    // Travel state
    this.isTraveling = false;
    this.cameraSettling = false; // Camera continues smooth follow after travel ends

    // Path system (handles preview, caching, reachability)
    this.pathSystem = new WorldMapPathSystem(this);

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

    // Node hover tooltip (for non-current nodes)
    this.nodeHoverTooltip = null;

    // Region system
    this.regions = [];              // Region data from API
    this.showRegionTint = true;     // Toggle for region color tinting on nodes
    this.showRegionBoundaries = false; // Toggle for region boundary lines (optional)
    this.castleNodes = [];          // Cache of castle nodes for quick access

    // Watchtower extended view
    this.watchtowerView = null;     // Extended view data from watchtower node

    // Quest marker system
    this.questMarkerManager = null; // Manages quest marker data
    this.questProgressHUD = null;   // Collapsible quest progress panel

    // Zodiac collection data cache for tooltip display
    this.zodiacCollectionData = null;

    // DOM-based fog of war overlay (replaces canvas-based fog rendering)
    this.fogOverlay = null;
  }

  async enter() {
    // Get asset loader reference from game
    this.assetLoader = this.game.assetLoader;

    // Initialize effects system
    this.effects = new WorldMapEffects(this.assetLoader);
    await this.effects.init();

    // Initialize DOM-based fog overlay (replaces canvas fog rendering)
    // Pass the canvas so the overlay can match its position and dimensions
    this.fogOverlay = new DOMFogOverlay(this.game.canvas);
    this.fogOverlay.init();
    this.fogOverlay.setNodeSpacing(this.nodeSpacing);

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
        } else if (feature === 'debug_clear') {
          // Debug mode: node was auto-cleared, refresh the map
          this.refreshNodes();
          this.game.toast.success('Debug', 'Node cleared automatically');
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

    // Initialize node hover tooltip
    this.nodeHoverTooltip = new NodeHoverTooltip({ game: this.game });
    this.game.uiOverlay.appendChild(this.nodeHoverTooltip.element);

    // Initialize quest marker system
    this.questMarkerManager = new QuestMarkerManager(this.game);
    this.questProgressHUD = new QuestProgressHUD({ game: this.game });
    this.game.uiOverlay.appendChild(this.questProgressHUD.element);

    // Fetch initial quest markers (non-blocking)
    this.refreshQuestMarkers();

    // Initialize minimap with region data
    this.minimap = new WorldMapMinimap(this.assetLoader);
    await this.minimap.init();
    this.minimap.calculateWorldBounds(this.nodes);
    this.minimap.setRegionData(this.regions, this.castleNodes);

    // Initialize character display
    this.mapCharacter = new WorldMapCharacter(this.assetLoader);
    await this.initMapCharacter();

    // Initialize unified HUD panel (stamina, travel progress, zodiac)
    this.hudPanel = new WorldMapHUDPanel();
    this.hudPanel.setZodiacClickHandler(() => this.openZodiacCrystalModal());
    this.hudPanel.checkZodiacNewCrystalFlag(); // Check for new crystal notification
    await this.refreshStamina();
    this.refreshZodiacCollection(); // Fetch collection data (non-blocking)

    // Create separate HUD canvas layer (renders above fog overlay)
    this.createHUDCanvas();

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
      // Default to 'heartlands' if region cannot be determined or race not in mapping
      const regionRace = this.currentNode?.region_race;
      const regionName = (regionRace && RACE_TO_REGION[regionRace]) || 'heartlands';
      this.game.musicContext.setRegion(regionName);
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
          this.hudPanel.setStamina(result.stamina);
        }
      } else {
        console.warn('refreshStamina - no party leader found');
      }
    } catch (err) {
      console.warn('Failed to fetch stamina:', err);
    }
  }

  /**
   * Refresh quest markers from the server and update the HUD
   */
  async refreshQuestMarkers() {
    if (!this.questMarkerManager) return;

    try {
      const characters = this.game.state.get('characters') || [];
      const partyLeader = characters.find(c => c.party_slot === 1) || characters[0];

      if (partyLeader) {
        await this.questMarkerManager.refresh(partyLeader.id);

        // Update the HUD with active quests
        if (this.questProgressHUD) {
          const activeQuests = this.questMarkerManager.getActiveQuests();
          this.questProgressHUD.update(activeQuests);
        }

        // Update minimap with quest marker data
        if (this.minimap) {
          this.minimap.setQuestMarkers(this.questMarkerManager);
        }
      }
    } catch (err) {
      console.warn('Failed to refresh quest markers:', err);
    }
  }

  /**
   * Refresh zodiac crystal collection from the server
   */
  async refreshZodiacCollection() {
    if (!this.hudPanel) return;

    try {
      const result = await this.game.api.get('/world/zodiac-collection');
      this.hudPanel.setZodiacCollection(result);
      this.zodiacCollectionData = result; // Cache for tooltip use
    } catch (err) {
      console.warn('Failed to refresh zodiac collection:', err);
    }
  }

  /**
   * Open the relic collection modal
   */
  async openRelicCollectionModal() {
    try {
      const { RelicCollectionModal } = await import('../modals/RelicCollectionModal.js');
      const modal = new RelicCollectionModal({
        game: this.game,
        onClose: () => {
          modal.destroy();
        }
      });
      await modal.show();
    } catch (err) {
      console.error('Failed to open relic collection modal:', err);
      parchmentToast.error('Error', 'Failed to load relic collection.');
    }
  }

  /**
   * Open the zodiac crystal collection modal
   */
  async openZodiacCrystalModal() {
    try {
      const { ZodiacCrystalModal } = await import('../modals/ZodiacCrystalModal.js');
      const modal = new ZodiacCrystalModal({
        game: this.game,
        onClose: () => {
          modal.destroy();
        },
        onCrystalSelect: (sign, crystal) => {
          modal.destroy();
          this.openZodiacCrystalDetailModal(sign, crystal);
        }
      });
      await modal.show();
    } catch (err) {
      console.error('Failed to open zodiac crystal modal:', err);
      parchmentToast.error('Error', 'Failed to load zodiac collection.');
    }
  }

  /**
   * Open the zodiac crystal detail modal for a specific crystal
   * @param {string} sign - Zodiac sign (e.g., 'aries', 'taurus')
   * @param {Object} crystal - Crystal data object
   */
  async openZodiacCrystalDetailModal(sign, crystal) {
    try {
      const { ZodiacCrystalDetailModal } = await import('../modals/ZodiacCrystalDetailModal.js');
      const modal = new ZodiacCrystalDetailModal({
        game: this.game,
        sign,
        crystal,
        onClose: () => {
          modal.destroy();
        }
      });
      await modal.show();
    } catch (err) {
      console.error('Failed to open zodiac crystal detail modal:', err);
      parchmentToast.error('Error', 'Failed to load crystal details.');
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

      // Ensure activeCharacter is set in state for marketplace and other scenes
      if (!this.game.state.get('activeCharacter')) {
        this.game.state.set('activeCharacter', partyLeader);
      }
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
   * Create a separate canvas for HUD rendering above the fog overlay
   */
  createHUDCanvas() {
    // Create canvas element
    this.hudCanvas = document.createElement('canvas');
    this.hudCanvas.id = 'hud-canvas';
    this.hudCanvas.width = 200;  // Enough for HUD panel (180px + padding)
    this.hudCanvas.height = 150; // Enough for expanded HUD (~130px + padding)

    // Position to match main canvas top-left, above fog overlay
    this.hudCanvas.style.cssText = `
      position: absolute;
      pointer-events: none;
      z-index: 3;
    `;

    // Get context
    this.hudCtx = this.hudCanvas.getContext('2d');

    // Insert into game container
    this.game.canvas.parentElement.appendChild(this.hudCanvas);

    // Position to match main canvas
    this.updateHUDCanvasPosition();

    // Listen for window resize to keep position updated
    this._hudResizeHandler = () => this.updateHUDCanvasPosition();
    window.addEventListener('resize', this._hudResizeHandler);
  }

  /**
   * Update HUD canvas position to align with main canvas top-left
   */
  updateHUDCanvasPosition() {
    if (!this.hudCanvas) return;

    const mainCanvas = this.game.canvas;
    const mainRect = mainCanvas.getBoundingClientRect();
    const containerRect = mainCanvas.parentElement.getBoundingClientRect();

    // Calculate offset from container
    const offsetX = mainRect.left - containerRect.left;
    const offsetY = mainRect.top - containerRect.top;

    // Calculate scale factor (main canvas CSS size vs logical size)
    const scaleX = mainRect.width / mainCanvas.width;
    const scaleY = mainRect.height / mainCanvas.height;

    // Position HUD canvas at top-left of main canvas
    this.hudCanvas.style.left = `${offsetX}px`;
    this.hudCanvas.style.top = `${offsetY}px`;

    // Scale HUD canvas to match main canvas scaling
    this.hudCanvas.style.width = `${this.hudCanvas.width * scaleX}px`;
    this.hudCanvas.style.height = `${this.hudCanvas.height * scaleY}px`;
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
   * Update hover tooltip for a node (shows rich contextual info)
   * @param {Object|null} node - The hovered node or null to hide
   */
  updateHoverTooltip(node) {
    if (!this.nodeHoverTooltip) return;

    // Hide tooltip if no node, traveling, or hovering current node
    if (!node || this.isTraveling || (this.currentNode && node.id === this.currentNode.id)) {
      this.nodeHoverTooltip.hide();
      return;
    }

    // Get screen position for the node
    const position = this.getNodeScreenPosition(node);
    if (!position) {
      this.nodeHoverTooltip.hide();
      return;
    }

    // Prepare context with path preview info
    const context = {
      nodeSize: position.nodeSize,
      canvasHeight: position.canvasHeight,
      previewCost: this.pathSystem.previewCost || 0,
      previewAffordable: this.pathSystem.previewAffordable !== false,
      previewPathBlocked: this.pathSystem.previewPathBlocked || false,
      previewCannotReach: this.pathSystem.previewCannotReach || false,
      isDiscovered: this.isNodeDiscovered(node),
      isVisited: node.visited === true,
      currentStamina: this.hudPanel?.staminaSegment?.current || 0,
      zodiacCollection: this.zodiacCollectionData // Pass for shrine tooltips
    };

    // Show the tooltip
    this.nodeHoverTooltip.show(node, position.x, position.y, context);
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
    // Clean up path system
    if (this.pathSystem) {
      this.pathSystem.destroy();
    }

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

    // Destroy HUD panel
    if (this.hudPanel) {
      this.hudPanel.destroy();
      this.hudPanel = null;
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

    // Destroy node hover tooltip
    if (this.nodeHoverTooltip) {
      this.nodeHoverTooltip.destroy();
      this.nodeHoverTooltip = null;
    }

    // Destroy quest marker system
    if (this.questMarkerManager) {
      this.questMarkerManager.destroy();
      this.questMarkerManager = null;
    }
    if (this.questProgressHUD) {
      this.questProgressHUD.destroy();
      this.questProgressHUD = null;
    }

    // Destroy fog overlay
    if (this.fogOverlay) {
      this.fogOverlay.destroy();
      this.fogOverlay = null;
    }

    // Clean up HUD canvas
    if (this.hudCanvas) {
      if (this._hudResizeHandler) {
        window.removeEventListener('resize', this._hudResizeHandler);
        this._hudResizeHandler = null;
      }
      if (this.hudCanvas.parentNode) {
        this.hudCanvas.parentNode.removeChild(this.hudCanvas);
      }
      this.hudCanvas = null;
      this.hudCtx = null;
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

      // Check if current node exists in loaded nodes (orphan detection)
      if (this.currentNode) {
        const currentNodeData = this.nodes.find(n => n.id === this.currentNode.id);
        if (!currentNodeData) {
          console.error(`Current node ${this.currentNode.id} not found in discovered nodes - character may be orphaned`);

          // Show toast with error message - self-healing on login should fix this on next login
          parchmentToast.error(
            'Position Error',
            'Your character is at an unknown location. Please log out and back in to fix this.',
            { duration: 10000 }
          );

          // Flag for UI
          this.characterOrphaned = true;
        } else {
          this.characterOrphaned = false;
        }
      }

      // Calculate reachable nodes first (needed for filtering)
      this.pathSystem.calculateReachableNodes();

      // Update discovery state for fog of war rendering (filtered by reachability)
      if (this.effects) {
        this.effects.updateDiscoveryState(this.nodes, this.connections, this.pathSystem.reachableNodes);
      }

      // Update DOM fog overlay discovery state
      if (this.fogOverlay && this.effects) {
        this.fogOverlay.updateDiscoveryState(
          this.nodes,
          this.connections,
          this.effects.discoveredNodes,
          this.effects.visitedNodes,
          this.effects.fogState
        );
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
   * Refresh nodes data and update the UI
   * Used after node state changes (e.g., clearing a node via debug)
   */
  async refreshNodes() {
    await this.loadWorldData();

    // Update node action menu with refreshed node data
    if (this.currentNode && this.nodeActionMenu) {
      const position = this.getNodeScreenPosition(this.currentNode);
      this.nodeActionMenu.setNode(this.currentNode, position);
      this.nodeActionMenu.expand();
    }

    // Update minimap
    if (this.minimap) {
      this.minimap.setRegionData(this.regions, this.castleNodes);
    }

    // Clear path cache since node states changed
    this.pathSystem.clearPathCache();
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

  centerOnCurrentNode() {
    if (!this.currentNode) return;

    // Try to find in discovered nodes first
    let node = this.nodes.find(n => n.id === this.currentNode.id);

    // Fallback: use currentNode's coordinates directly (from /api/world/current)
    if (!node && this.currentNode.x_coord !== undefined) {
      node = this.currentNode;
    }

    if (node && node.x_coord !== undefined && node.y_coord !== undefined) {
      this.cameraX = -node.x_coord * this.nodeSpacing + this.game.canvas.width / 2;
      this.cameraY = -node.y_coord * this.nodeSpacing + this.game.canvas.height / 2;
    } else {
      console.error('Cannot center camera - no coordinates for current node:', this.currentNode?.id);

      // GRACEFUL FALLBACK: Center on ANY discovered castle instead of showing nothing
      const anyCastle = this.nodes.find(n => n.node_type === 'castle');
      if (anyCastle && anyCastle.x_coord !== undefined) {
        console.log(`Centering on fallback castle: ${anyCastle.id} (${anyCastle.name})`);
        this.cameraX = -anyCastle.x_coord * this.nodeSpacing + this.game.canvas.width / 2;
        this.cameraY = -anyCastle.y_coord * this.nodeSpacing + this.game.canvas.height / 2;

        // Flag for UI - character may be orphaned
        this.characterOrphaned = true;
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
    // Uses menu category for location/building icons, actions for combat
    const iconMap = {
      blacksmith: { category: 'menu', name: 'shop' },
      marketplace: { category: 'menu', name: 'shop' },
      tavern: { category: 'menu', name: 'tavern' },
      apothecary: { category: 'menu', name: 'shop' },
      coliseum: { category: 'menu', name: 'coliseum' },
      farm: { category: 'menu', name: 'caravan' },
      guild_hall: { category: 'menu', name: 'guild' },
      guild_advancement: { category: 'menu', name: 'guild' },
      courtyard: { category: 'menu', name: 'party' },
      battle: { category: 'actions', name: 'attack' }
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

    // Garrison feature opens the garrison scene for castle nodes
    if (feature === 'garrison') {
      this.game.scenes.switchTo('garrison', {
        nodeId: this.currentNode.id,
        nodeName: this.currentNode.name,
        regionId: this.currentNode.region_id
      });
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
        // Modal already cleaned up in close() - this callback is for scene notification only
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
            this.pathSystem.clearPathCache();

            // Update stamina display
            if (travelResult.stamina) {
              this.hudPanel.setStamina(travelResult.stamina);
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
              this.hudPanel.setStamina(result.stamina);
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
        // Toast notification removed - was spammy
      }
    });
    this.wsUnsubscribers.push(enteredUnsub);

    // Handle player leaving current node
    const leftUnsub = socket.on('player:left_node', (payload) => {
      if (payload.nodeId === this.currentNode?.id) {
        // Toast notification removed - was spammy
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

      // If hovered node changed, update path preview and tooltip
      if (newHoveredNode?.id !== this.hoveredNode?.id) {
        this.hoveredNode = newHoveredNode;
        this.pathSystem.updatePathPreview(newHoveredNode);
        this.updateHoverTooltip(newHoveredNode);
      }
    }, opts);

    canvas.addEventListener('mouseup', () => {
      this.dragging = false;
    }, opts);

    canvas.addEventListener('click', () => {
      const pos = this.game.input.getPointerPosition();

      // Check HUD panel click first (handles zodiac and other elements)
      if (this.hudPanel && this.hudPanel.handleClick(pos.x, pos.y)) {
        return;
      }

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

    // Mobile touch support for tooltips
    let touchStartX = 0;
    let touchStartY = 0;
    let touchMoved = false;

    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchMoved = false;

        // Update hovered node on touch start for tooltip
        const pos = this.game.input.getPointerPosition();
        const touchedNode = this.getNodeAtPosition(pos.x, pos.y);

        if (touchedNode?.id !== this.hoveredNode?.id) {
          this.hoveredNode = touchedNode;
          this.pathSystem.updatePathPreview(touchedNode);
          this.updateHoverTooltip(touchedNode);
        }
      }
    }, opts);

    canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1) {
        const dx = e.touches[0].clientX - touchStartX;
        const dy = e.touches[0].clientY - touchStartY;

        // If moved more than 10px, consider it a drag
        if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
          touchMoved = true;
          // Hide tooltip during drag
          if (this.nodeHoverTooltip) {
            this.nodeHoverTooltip.hide();
          }
        }
      }
    }, opts);

    canvas.addEventListener('touchend', () => {
      // If touch moved, don't handle as tap
      if (touchMoved) {
        touchMoved = false;
        return;
      }

      // Hide tooltip when tapping on empty space
      const pos = this.game.input.getPointerPosition();
      const touchedNode = this.getNodeAtPosition(pos.x, pos.y);

      if (!touchedNode) {
        this.hoveredNode = null;
        if (this.nodeHoverTooltip) {
          this.nodeHoverTooltip.hide();
        }
      }
    }, opts);
  }

  getNodeAtPosition(screenX, screenY) {
    for (const node of this.nodes) {
      // Skip nodes that are not reachable from current position
      if (!this.pathSystem.isNodeReachable(node.id)) {
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

    // Hide hover tooltip when travel starts
    if (this.nodeHoverTooltip) {
      this.nodeHoverTooltip.hide();
    }
    this.hoveredNode = null;

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
        if (this.hudPanel) {
          this.hudPanel.startTravel(result.currentNode.name, estimatedDuration);
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
    if (result.stamina && this.hudPanel) {
      this.hudPanel.setStamina(result.stamina);
    }

    // Reload world data to get newly discovered nodes (fog of war reveal)
    await this.loadWorldData();

    // Update minimap with latest castle nodes
    if (this.minimap) {
      this.minimap.setRegionData(this.regions, this.castleNodes);
    }

    // Clear path cache since we're at a new position
    this.pathSystem.clearPathCache();

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
    if (this.hudPanel) {
      this.hudPanel.completeTravel();
    }

    // Switch node rooms for WebSocket presence
    if (this.game.socket) {
      if (previousNodeId) {
        this.game.socket.leaveNodeRoom(previousNodeId);
      }
      this.game.socket.joinNodeRoom(this.currentNode.id);
    }

    // Refresh quest markers (travel may affect quest progress)
    this.refreshQuestMarkers();
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

    // Update HUD panel (stamina, travel progress, zodiac)
    if (this.hudPanel) {
      this.hudPanel.update(deltaTime);
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
        if (!this.pathSystem.isNodeReachable(fromNode.id) &&
            !this.pathSystem.isNodeReachable(toNode.id)) {
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
    if (this.pathSystem.hasPathPreview()) {
      this.pathSystem.renderPathPreview(ctx);
    }

    // Draw nodes using the node renderer
    for (const node of this.nodes) {
      // Skip nodes that are not reachable from current position
      if (!this.pathSystem.isNodeReachable(node.id)) {
        continue;
      }

      const x = node.x_coord * this.nodeSpacing + this.cameraX;
      const y = node.y_coord * this.nodeSpacing + this.cameraY;

      // Skip if off screen
      if (x < -50 || x > ctx.canvas.width + 50 || y < -50 || y > ctx.canvas.height + 50) {
        continue;
      }

      // Delegate node rendering to the node renderer
      this.nodeRenderer.renderNode(ctx, node, x, y);
    }

    // Render quest markers on nodes (after nodes, before watchtower/fog)
    this.renderQuestMarkers(ctx);

    // Render watchtower-revealed nodes at reduced opacity
    if (this.watchtowerView) {
      this.nodeRenderer.renderWatchtowerRevealedNodes(ctx);
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

    // Update DOM fog overlay camera position (DOM-based, no canvas rendering)
    // The fog overlay is a DOM element positioned over the canvas
    if (this.fogOverlay) {
      this.fogOverlay.updateCamera(this.cameraX, this.cameraY);
    }

    // Second pass: Render node tooltips AFTER fog of war so they're always visible
    for (const node of this.nodes) {
      // Skip nodes that are not reachable from current position
      if (!this.pathSystem.isNodeReachable(node.id)) {
        continue;
      }

      const x = node.x_coord * this.nodeSpacing + this.cameraX;
      const y = node.y_coord * this.nodeSpacing + this.cameraY;

      // Skip if off screen
      if (x < -50 || x > ctx.canvas.width + 50 || y < -50 || y > ctx.canvas.height + 50) {
        continue;
      }

      // Note: Node hover tooltip is now handled by DOM-based NodeHoverTooltip component
      // The canvas-based renderNodeTooltip is kept for fallback but not called here
    }

    // Render character on map (after fog so always visible)
    if (this.mapCharacter) {
      this.mapCharacter.render(ctx, this.cameraX, this.cameraY);
    }

    ctx.restore();

    // Render HUD panel to separate canvas (above fog overlay)
    if (this.hudPanel && this.hudCtx) {
      // Clear HUD canvas with transparent background
      this.hudCtx.clearRect(0, 0, this.hudCanvas.width, this.hudCanvas.height);
      // Render HUD panel
      this.hudPanel.render(this.hudCtx);
    }

    // Update node action menu position (DOM element follows current node)
    if (this.nodeActionMenu && this.currentNode) {
      const position = this.getNodeScreenPosition(this.currentNode);
      if (position) {
        this.nodeActionMenu.updatePosition(position.x, position.y, position.nodeSize, position.canvasHeight);
      }
    }

    // Update node hover tooltip position (DOM element follows hovered node)
    if (this.nodeHoverTooltip && this.hoveredNode && this.hoveredNode.id !== this.currentNode?.id) {
      const position = this.getNodeScreenPosition(this.hoveredNode);
      if (position) {
        this.nodeHoverTooltip.updatePosition(position.x, position.y, position.nodeSize, position.canvasHeight);
      }
    }

    // Render minimap (on top of everything)
    if (this.minimap && this.effects) {
      //console.log("MINIMAP: ", this.nodes, this.connections, this.currentNode, this.effects.discoveredNodes, this.effects.visitedNodes, this.nodeSpacing)
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
   * Render quest markers on nodes that have active quest objectives
   * Markers are small colored badges positioned above/to-the-side of nodes
   */
  renderQuestMarkers(ctx) {
    if (!this.questMarkerManager) return;

    for (const node of this.nodes) {
      // Skip nodes without markers
      if (!this.questMarkerManager.hasMarker(node.id)) continue;

      // Skip nodes that are not reachable
      if (!this.pathSystem.isNodeReachable(node.id)) continue;

      const x = node.x_coord * this.nodeSpacing + this.cameraX;
      const y = node.y_coord * this.nodeSpacing + this.cameraY;

      // Skip if off screen
      if (x < -50 || x > ctx.canvas.width + 50 || y < -50 || y > ctx.canvas.height + 50) {
        continue;
      }

      const marker = this.questMarkerManager.getMarkerForNode(node.id);
      this.renderMarkerBadge(ctx, x, y, marker, node);
    }
  }

  /**
   * Render a quest marker badge at a node position
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {number} x - Node X position (screen coords)
   * @param {number} y - Node Y position (screen coords)
   * @param {Object} marker - Marker data from QuestMarkerManager
   * @param {Object} node - Node object for sprite lookup
   */
  renderMarkerBadge(ctx, x, y, marker, node) {
    if (!marker) return;

    const badges = QuestMarkerManager.getBadgeColors(marker);
    if (badges.length === 0) return;

    // Position badges above and to the right of the node
    const nodeSprite = node ? this.nodeRenderer.getNodeSprite(node.node_type) : null;
    const spriteSize = nodeSprite ? this.nodeRenderer.getNodeSpriteSize(node.node_type) : this.nodeSize;
    const badgeRadius = 5;
    const badgeSpacing = 4;
    const startX = x + spriteSize / 2 - 4;
    const startY = y - spriteSize / 2 - 4;

    ctx.save();

    // Draw each badge (max 3, with overlap)
    for (let i = 0; i < Math.min(badges.length, 3); i++) {
      const badgeX = startX - i * badgeSpacing;
      const badgeY = startY;
      const color = badges[i];

      // Badge background with glow
      if (marker.nearComplete) {
        // Pulse glow for near-complete quests
        const pulse = 0.4 + Math.sin(Date.now() * 0.005) * 0.3;
        ctx.beginPath();
        ctx.arc(badgeX, badgeY, badgeRadius + 3, 0, Math.PI * 2);
        ctx.fillStyle = color.replace(')', `, ${pulse})`).replace('rgb', 'rgba').replace('#', '');
        // Convert hex to rgba for glow
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${pulse})`;
        ctx.fill();
      }

      // Badge circle
      ctx.beginPath();
      ctx.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // Badge border
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Inner highlight
      ctx.beginPath();
      ctx.arc(badgeX - 1, badgeY - 1, badgeRadius - 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Show "+N" indicator if more than 3 quests
    if (marker.questCount > 3) {
      const extraX = startX - 3 * badgeSpacing - 8;
      const extraY = startY;

      ctx.font = 'bold 9px Arial';
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.lineWidth = 2;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const text = `+${marker.questCount - 3}`;
      ctx.strokeText(text, extraX, extraY);
      ctx.fillText(text, extraX, extraY);
    }

    ctx.restore();
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
        this.pathSystem.isNodeReachable(n.id)
      );

      if (regionNodes.length < 3) continue;

      // Get region colors
      const colors = this.nodeRenderer.getRegionColor(region.race);

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

      // Use Catmull-Rom splines to match visible path rendering
      // generatePathControlPoints already handles coordinate normalization
      const controlPoints = generatePathControlPoints(x1, y1, x2, y2, fromNode.id, toNode.id);
      const splinePoints = generateSplinePoints(controlPoints, 10);

      ctx.beginPath();
      if (splinePoints.length >= 2) {
        ctx.moveTo(splinePoints[0].x, splinePoints[0].y);
        for (let i = 1; i < splinePoints.length; i++) {
          ctx.lineTo(splinePoints[i].x, splinePoints[i].y);
        }
      } else {
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.strokeStyle = 'rgba(180, 160, 100, 0.6)'; // Golden-brown for watchtower reveal
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

}
