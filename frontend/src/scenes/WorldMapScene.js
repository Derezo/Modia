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
import { WorldMapConnectionRenderer } from '../worldmap/WorldMapConnectionRenderer.js';
import { WorldMapRegionRenderer } from '../worldmap/WorldMapRegionRenderer.js';
import { WorldMapQuestMarkerRenderer } from '../worldmap/WorldMapQuestMarkerRenderer.js';
import {
  findInteractiveNodeAtPosition,
  WorldMapInputHandler
} from '../worldmap/WorldMapInputHandler.js';
import { ProfileDropdown } from '../ui/parchment/ProfileDropdown.js';
import { parchmentToast } from '../ui/parchment/ParchmentToast.js';
import { PartyInviteModal } from '../components/PartyInviteModal.js';
import { responsive } from '../core/Responsive.js';
import { RACE_TO_REGION } from '../audio/AudioAssets.js';

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

    // Connection renderer (handles path and locked path rendering)
    this.connectionRenderer = new WorldMapConnectionRenderer(this);

    // Region renderer (handles region boundaries)
    this.regionRenderer = new WorldMapRegionRenderer(this);

    // Quest marker renderer (handles quest objective markers on nodes)
    this.questMarkerRenderer = new WorldMapQuestMarkerRenderer(this);

    // Input handler (manages mouse, touch, wheel events)
    this.inputHandler = new WorldMapInputHandler(this);

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
    this.chestClaimPending = false;

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
    this.inputHandler.setup();
    this.setupWebSocketHandlers();

    // Initialize node action menu (positioned near current node)
    this.nodeActionMenu = new NodeActionMenu({
      game: this.game,
      onAction: (feature) => {
        if (feature === 'battle') {
          this.startBattle();
        } else if (feature === 'claim_chest') {
          return this.claimCurrentChest();
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
    // Start collapsed on mobile to keep the map unobstructed
    this.hudPanel = new WorldMapHUDPanel({ collapsed: responsive.isMobile() });
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

    // Scale factor = CSS pixels per logical pixel. mainCanvas.width is the
    // DPR-multiplied backing store after P1.1, so use targetWidth/Height.
    const scaleX = mainRect.width / this.game.targetWidth;
    const scaleY = mainRect.height / this.game.targetHeight;

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

    const targetX = -this.mapCharacter.x + this.game.targetWidth / 2;
    const targetY = -this.mapCharacter.y + this.game.targetHeight / 2;

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
      zodiacCollection: this.zodiacCollectionData, // Pass for shrine tooltips
      routeDescriptions: this.connectionRenderer.getRouteDescriptionsForNode(node.id)
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

    // Clean up input handler
    if (this.inputHandler) {
      this.inputHandler.destroy();
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
      this.cameraX = -node.x_coord * this.nodeSpacing + this.game.targetWidth / 2;
      this.cameraY = -node.y_coord * this.nodeSpacing + this.game.targetHeight / 2;
    } else {
      console.error('Cannot center camera - no coordinates for current node:', this.currentNode?.id);

      // GRACEFUL FALLBACK: Center on ANY discovered castle instead of showing nothing
      const anyCastle = this.nodes.find(n => n.node_type === 'castle');
      if (anyCastle && anyCastle.x_coord !== undefined) {
        console.log(`Centering on fallback castle: ${anyCastle.id} (${anyCastle.name})`);
        this.cameraX = -anyCastle.x_coord * this.nodeSpacing + this.game.targetWidth / 2;
        this.cameraY = -anyCastle.y_coord * this.nodeSpacing + this.game.targetHeight / 2;

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

    // Training grounds opens the guild's focused skill training view
    if (feature === 'training_ground') {
      this.game.scenes.switchTo('guildAdvancement', {
        nodeId: this.currentNode.id,
        guildClass: this.currentNode.guild_class,
        activeTab: 'training'
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

  /**
   * Claim the one-time reward at the current chest node.
   */
  async claimCurrentChest() {
    if (this.chestClaimPending || !this.currentNode || this.currentNode.node_type !== 'chest') {
      return;
    }

    if (this.currentNode.chest_claimed || this.currentNode.claimed) {
      return;
    }

    const chestNodeId = this.currentNode.id;

    this.chestClaimPending = true;
    this.nodeActionMenu?.setActionPending('claim_chest', true);

    try {
      const result = await this.game.api.claimChest(chestNodeId);

      if (result.new_gold_balance !== null && result.new_gold_balance !== undefined) {
        this.game.state.set('gold', result.new_gold_balance);
      }

      // Remove the one-time action immediately. The server has committed the
      // claim even if the following world-state refresh encounters a network error.
      this.nodes = this.nodes.map(node => (
        node.id === chestNodeId
          ? { ...node, chest_claimed: true, claimed: true }
          : node
      ));
      this.game.state.set('worldNodes', this.nodes);

      // Navigation may complete while the claim request is in flight. Only
      // replace and rebuild the current node if it is still the claimed chest.
      if (this.currentNode?.id === chestNodeId) {
        this.currentNode = {
          ...this.currentNode,
          chest_claimed: true,
          claimed: true
        };
        this.game.state.set('currentNode', this.currentNode);
        this.nodeActionMenu?.rebuildActions(this.currentNode);
      }

      parchmentToast.success(
        result.already_claimed ? 'Treasure Already Collected' : 'Treasure Collected',
        result.message || (
          result.already_claimed
            ? 'This treasure was already collected.'
            : `You found ${result.gold_awarded || 0} gold.`
        )
      );

      // Refresh authoritative node claim state and rebuild the current menu.
      try {
        await this.refreshNodes();
      } catch (refreshError) {
        console.warn('Treasure claimed, but world state refresh failed:', refreshError);
      }
    } catch (error) {
      parchmentToast.error(
        'Treasure Unavailable',
        error.message || 'Unable to collect this treasure. Please try again.'
      );
    } finally {
      this.chestClaimPending = false;
      this.nodeActionMenu?.setActionPending('claim_chest', false);
    }
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

  getNodeAtPosition(screenX, screenY) {
    return findInteractiveNodeAtPosition(this, screenX, screenY);
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
    // World-location mutations are mutually exclusive. The server also locks
    // the party leader during a chest claim, but avoiding the race here keeps
    // the map interaction predictable while that request is pending.
    if (this.isTraveling || this.chestClaimPending) return;

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
          const targetX = -this.mapCharacter.x + this.game.targetWidth / 2;
          const targetY = -this.mapCharacter.y + this.game.targetHeight / 2;
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
        if (x >= -100 && x <= this.game.targetWidth + 100 &&
            y >= -100 && y <= this.game.targetHeight + 100) {
          this.effects.spawnAmbientParticles(x, y, node.node_type);
        }
      }
    }
  }

  render(ctx) {
    // Render backdrop with effects system
    if (this.effects) {
      this.effects.renderBackdrop(ctx, this.cameraX, this.cameraY, this.game.targetWidth, this.game.targetHeight);
    } else {
      // Fallback background
      ctx.fillStyle = '#0a0a1a';
      ctx.fillRect(0, 0, this.game.targetWidth, this.game.targetHeight);
    }

    // Render decorative world-map landmarks (lakes, mountains, forests)
    if (this.effects && this.obstacles && this.obstacles.length > 0) {
      this.effects.renderObstacles(ctx, this.cameraX, this.cameraY, this.obstacles);
    }

    // Render region boundaries (optional, subtle background layer)
    if (this.showRegionBoundaries && this.regions.length > 0) {
      this.regionRenderer.renderRegionBoundaries(ctx);
    }

    ctx.save();

    // Draw watchtower-revealed connections with dashed lines at reduced opacity
    this.connectionRenderer.renderWatchtowerConnections(ctx);

    // Draw connections with organic Catmull-Rom spline paths
    this.connectionRenderer.renderConnections(ctx);

    // Draw locked path indicators when on a blocked node
    this.connectionRenderer.renderLockedPaths(ctx);

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
      if (x < -50 || x > this.game.targetWidth + 50 || y < -50 || y > this.game.targetHeight + 50) {
        continue;
      }

      // Delegate node rendering to the node renderer
      this.nodeRenderer.renderNode(ctx, node, x, y);
    }

    // Render quest markers on nodes (after nodes, before watchtower/fog)
    this.questMarkerRenderer.render(ctx);

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

    // Render character on map (after fog so always visible)
    if (this.mapCharacter) {
      this.mapCharacter.render(ctx, this.cameraX, this.cameraY, this.game.targetWidth, this.game.targetHeight);
    }

    ctx.restore();

    // Render HUD panel to separate canvas (above fog overlay)
    if (this.hudPanel && this.hudCtx) {
      // Clear HUD canvas with transparent background
      this.hudCtx.clearRect(0, 0, this.hudCanvas.width, this.hudCanvas.height);
      // Render HUD panel
      this.hudPanel.render(this.hudCtx);
      // Route guidance is UI, so keep it above fog and world objects.
      this.connectionRenderer.renderRouteLegend(this.hudCtx);
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
      this.minimap.render(ctx, {
        nodes: this.nodes,
        connections: this.connections,
        currentNode: this.currentNode,
        discoveredNodes: this.effects.discoveredNodes,
        visitedNodes: this.effects.visitedNodes,
        cameraX: this.cameraX,
        cameraY: this.cameraY,
        canvasWidth: this.game.targetWidth,
        canvasHeight: this.game.targetHeight,
        nodeSpacing: this.nodeSpacing
      });
    }
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

    // Collapse HUD on mobile; expand on tablet/desktop.
    if (this.hudPanel) {
      this.hudPanel.setCollapsed(responsive.isMobile());
    }
  }
}
