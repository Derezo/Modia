import { ParchmentCard } from '../components/ParchmentCard.js';

/**
 * BattleIntro - Dramatic battle introduction sequence with ParchmentCard components
 *
 * Timeline (example with 3 enemies + player = 4 waypoints = 4000ms pan):
 * 0-500ms:      Title fades in, overlay appears
 * 500-1500ms:   Title holds, dramatic pause
 * 1500-5500ms:  Camera pans through waypoints
 *               - Player cards fade in sequentially (staggered, during first 60%)
 *               - Enemy cards slide in from right as camera reaches each enemy waypoint
 * 5500-6000ms:  Post-pan pause, all cards visible
 * 6000-6500ms:  Cards and overlay fade out
 * 6500ms+:      Complete, battle begins
 */
export class BattleIntro {
  constructor(battleScene) {
    this.scene = battleScene;

    // Intro state
    this.phase = 'idle';  // 'idle' | 'title_hold' | 'camera_pan' | 'post_pause' | 'fade_out' | 'complete'
    this.timer = 0;

    // Phase durations (milliseconds)
    this.titleFadeInDuration = 500;       // Title fade in
    this.titleHoldDuration = 1000;        // Dramatic hold on title
    this.cameraPanDuration = 3000;        // Camera pan (adjusts based on waypoints)
    this.postPanPauseDuration = 500;      // Pause after pan ends
    this.cardsFadeOutDuration = 500;      // Cards fade out
    this.totalDuration = 5500;            // Will be recalculated

    // Card instances (ParchmentCard components)
    this.playerCardInstances = [];
    this.enemyCardInstances = [];
    this.cardContainer = null;
    this.titleElement = null;
    this.overlayElement = null;

    // Card animation states
    this.playerCardStates = [];  // { shown: boolean }
    this.enemyCardStates = [];   // { shown: boolean }

    // Camera waypoints for pan
    this.cameraWaypoints = [];
    this.cameraStartPos = null;
  }

  /**
   * Start the intro sequence
   */
  start() {
    this.phase = 'title_hold';
    this.timer = 0;

    // Store starting camera position BEFORE calculating waypoints
    this.cameraStartPos = {
      x: this.scene.camera.targetX,
      y: this.scene.camera.targetY
    };

    // Build DOM elements for cards
    this.createDOMElements();

    // Build ParchmentCard instances
    this.buildCharacterCards();

    // Calculate camera waypoints
    this.calculateCameraWaypoints();

    // Recalculate total duration based on waypoints
    this.totalDuration = this.titleFadeInDuration + this.titleHoldDuration +
                         this.cameraPanDuration + this.postPanPauseDuration +
                         this.cardsFadeOutDuration;
  }

  /**
   * Create DOM container for cards overlay
   */
  createDOMElements() {
    // Create overlay
    this.overlayElement = document.createElement('div');
    this.overlayElement.id = 'battle-intro-overlay';
    this.overlayElement.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0);
      pointer-events: none;
      z-index: 100;
      transition: background 0.5s ease;
    `;

    // Create title
    this.titleElement = document.createElement('div');
    this.titleElement.style.cssText = `
      position: absolute;
      top: 30px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 28px;
      font-weight: bold;
      color: #ffd700;
      text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8), 0 0 20px rgba(255, 215, 0, 0.5);
      font-family: 'Georgia', serif;
      letter-spacing: 3px;
      opacity: 0;
      transition: opacity 0.5s ease;
    `;
    this.titleElement.textContent = 'BATTLE START';

    // Create card container
    this.cardContainer = document.createElement('div');
    this.cardContainer.id = 'battle-intro-cards';
    this.cardContainer.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    `;

    this.overlayElement.appendChild(this.titleElement);
    this.overlayElement.appendChild(this.cardContainer);

    // Add to game UI overlay
    this.scene.game.uiOverlay.appendChild(this.overlayElement);

    // Trigger overlay fade in immediately
    requestAnimationFrame(() => {
      this.overlayElement.style.background = 'rgba(0, 0, 0, 0.3)';
      this.titleElement.style.opacity = '1';
    });
  }

  /**
   * Build ParchmentCard instances for allies (left) and opponents (right)
   * In PvE: allies = player characters, opponents = enemy monsters
   * In PvP: allies = local player's party, opponents = other player's party
   */
  buildCharacterCards() {
    const state = this.scene.battleState;
    if (!state || !state.units) return;

    const { allies, opponents } = this.getTeamUnits();

    // Ally cards on LEFT side (stacked vertically)
    const allyCardHeight = 85;
    const allyStartY = 80;

    this.playerCardInstances = allies.map((unit, i) => {
      const card = new ParchmentCard({
        mode: 'compact',
        type: 'player',  // Blue styling for local player's team
        showStats: false
      });
      card.setCharacter(unit);

      // Position card on left, initially hidden
      const targetY = allyStartY + i * (allyCardHeight + 10);
      card.element.style.cssText = `
        position: absolute;
        left: 15px;
        top: ${targetY}px;
        opacity: 0;
        transform: scale(0.9) translateX(-20px);
        transition: opacity 0.4s ease-out, transform 0.4s ease-out;
        pointer-events: none;
      `;

      this.cardContainer.appendChild(card.element);
      this.playerCardStates.push({ shown: false });
      return card;
    });

    // Opponent cards on RIGHT side (stacked vertically, starting off-screen)
    const opponentCardHeight = 85;
    const opponentStartY = 80;

    this.enemyCardInstances = opponents.map((unit, i) => {
      const card = new ParchmentCard({
        mode: 'compact',
        type: 'enemy',  // Red styling for opponents
        showStats: false
      });
      card.setCharacter(unit);

      // Position card starting off-screen right (using CSS right positioning)
      const targetY = opponentStartY + i * (opponentCardHeight + 10);

      card.element.style.cssText = `
        position: absolute;
        right: -320px;
        top: ${targetY}px;
        opacity: 0;
        transition: right 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.3s ease;
        pointer-events: none;
      `;

      this.cardContainer.appendChild(card.element);
      this.enemyCardStates.push({ shown: false });
      return card;
    });
  }

  /**
   * Calculate camera waypoints for the pan sequence
   * In PvE: start -> each enemy -> player lead -> active unit
   * In PvP: start -> each opponent -> ally lead -> active unit
   */
  calculateCameraWaypoints() {
    const state = this.scene.battleState;
    if (!state || !state.units) return;

    const { allies, opponents } = this.getTeamUnits();
    const activeUnit = state.units.find(u => u.id === state.activeUnitId);

    // Build waypoints: start position -> each opponent -> ally lead -> active unit
    this.cameraWaypoints = [];

    // Add starting camera position for smooth transition
    if (this.cameraStartPos) {
      this.cameraWaypoints.push({ x: this.cameraStartPos.x, y: this.cameraStartPos.y });
    }

    // Add each opponent as a waypoint (camera pans to opponents FIRST)
    for (const opponent of opponents) {
      this.cameraWaypoints.push(this.getUnitScreenPos(opponent));
    }

    // Add ally lead (controlling player's first character)
    if (allies.length > 0) {
      this.cameraWaypoints.push(this.getUnitScreenPos(allies[0]));
    }

    // Add active unit if different
    if (activeUnit) {
      const activePos = this.getUnitScreenPos(activeUnit);
      const lastWaypoint = this.cameraWaypoints[this.cameraWaypoints.length - 1];
      if (!lastWaypoint || activePos.x !== lastWaypoint.x || activePos.y !== lastWaypoint.y) {
        this.cameraWaypoints.push(activePos);
      }
    }

    // Adjust camera pan duration (~1s per waypoint, min 2s)
    const waypointCount = this.cameraWaypoints.length;
    this.cameraPanDuration = Math.max(2000, waypointCount * 1000);

    // Recalculate total
    this.totalDuration = this.titleFadeInDuration + this.titleHoldDuration +
                         this.cameraPanDuration + this.postPanPauseDuration +
                         this.cardsFadeOutDuration;
  }

  /**
   * Get ally and opponent units based on battle mode
   * PvE: allies = type 'player', opponents = type 'enemy'
   * PvP: allies = units owned by local player, opponents = other player's units
   */
  getTeamUnits() {
    const state = this.scene.battleState;
    if (!state?.units) return { allies: [], opponents: [] };

    if (this.scene.isPvP) {
      const localUserId = this.scene.game.localUserId;
      const allies = state.units.filter(u => u.ownerId === localUserId);
      const opponents = state.units.filter(u => u.ownerId !== localUserId && u.type === 'player');
      return { allies, opponents };
    } else {
      // PvE mode - use existing type-based logic
      const allies = state.units.filter(u => u.type === 'player');
      const opponents = state.units.filter(u => u.type === 'enemy');
      return { allies, opponents };
    }
  }

  /**
   * Get world position of a unit for camera targeting
   */
  getUnitScreenPos(unit) {
    if (this.scene.grid) {
      return this.scene.grid.gridToScreenWorld(unit.tileX, unit.tileY);
    }
    return { x: unit.tileX * 64, y: unit.tileY * 32 };
  }

  /**
   * Update intro animation
   */
  update(deltaTime) {
    if (this.phase === 'complete' || this.phase === 'idle') return;

    this.timer += deltaTime; // deltaTime already in ms
    const t = this.timer;

    // Calculate phase boundaries
    const titleHoldEnd = this.titleFadeInDuration + this.titleHoldDuration;
    const cameraPanEnd = titleHoldEnd + this.cameraPanDuration;
    const postPauseEnd = cameraPanEnd + this.postPanPauseDuration;

    if (this.phase === 'title_hold') {
      // Wait for title to be displayed before camera pan
      if (t >= titleHoldEnd) {
        this.phase = 'camera_pan';
      }
    } else if (this.phase === 'camera_pan') {
      // Update camera pan
      const panElapsed = t - titleHoldEnd;
      this.updateCameraPan(panElapsed);

      // Animate player cards (fade in during first 60% of pan)
      this.updatePlayerCardAnimations(panElapsed);

      // Animate enemy cards (slide in, arriving as pan ends)
      this.updateEnemyCardAnimations(panElapsed);

      // Check if camera pan is complete
      if (t >= cameraPanEnd) {
        this.phase = 'post_pause';
        // Ensure all cards are fully visible
        this.ensureAllCardsVisible();
      }
    } else if (this.phase === 'post_pause') {
      // Brief pause after camera pan
      if (t >= postPauseEnd) {
        this.phase = 'fade_out';
        this.startFadeOut();
      }
    } else if (this.phase === 'fade_out') {
      // Wait for fade out to complete
      if (t >= this.totalDuration) {
        this.phase = 'complete';
        this.cleanup();
      }
    }
  }

  /**
   * Animate player cards fading in one-at-a-time
   * Cards appear during the first 60% of camera pan, staggered
   */
  updatePlayerCardAnimations(panElapsed) {
    const cardCount = this.playerCardInstances.length;
    if (cardCount === 0) return;

    // Cards fade in during the first 60% of camera pan
    const fadeWindow = this.cameraPanDuration * 0.6;
    const delayBetweenCards = cardCount > 1 ? fadeWindow / (cardCount - 1) : 0;

    this.playerCardInstances.forEach((card, i) => {
      const cardTriggerTime = i * delayBetweenCards;
      if (panElapsed >= cardTriggerTime && !this.playerCardStates[i].shown) {
        this.playerCardStates[i].shown = true;
        // Trigger CSS transition
        card.element.style.opacity = '1';
        card.element.style.transform = 'scale(1) translateX(0)';
      }
    });
  }

  /**
   * Animate enemy cards sliding in from right
   * Each card slides in when camera reaches that enemy's waypoint
   */
  updateEnemyCardAnimations(panElapsed) {
    const cardCount = this.enemyCardInstances.length;
    if (cardCount === 0 || this.cameraWaypoints.length === 0) return;

    // Calculate current camera position in waypoint sequence
    const panProgress = Math.min(1, panElapsed / this.cameraPanDuration);
    const easedProgress = this.easeInOutCubic(panProgress);

    const waypointCount = this.cameraWaypoints.length;
    const segmentProgress = easedProgress * (waypointCount - 1);
    const currentSegment = Math.floor(segmentProgress);

    // Enemies occupy waypoints 0 through (cardCount - 1)
    this.enemyCardInstances.forEach((card, i) => {
      const state = this.enemyCardStates[i];

      // Trigger slide when camera reaches or passes this enemy's waypoint
      if (currentSegment >= i && !state.shown) {
        state.shown = true;
        // Trigger CSS transition to target position (right: 10px)
        card.element.style.right = '10px';
        card.element.style.opacity = '1';
      }
    });
  }

  /**
   * Ensure all cards are visible (called when entering post_pause)
   */
  ensureAllCardsVisible() {
    // Force all player cards visible
    this.playerCardInstances.forEach((card, i) => {
      if (!this.playerCardStates[i].shown) {
        this.playerCardStates[i].shown = true;
        card.element.style.opacity = '1';
        card.element.style.transform = 'scale(1) translateX(0)';
      }
    });

    // Force all enemy cards at target position
    this.enemyCardInstances.forEach((card, i) => {
      const state = this.enemyCardStates[i];
      if (!state.shown) {
        state.shown = true;
        card.element.style.right = '10px';
        card.element.style.opacity = '1';
      }
    });
  }

  /**
   * Update camera position during pan
   */
  updateCameraPan(panElapsed) {
    const panProgress = Math.min(1, panElapsed / this.cameraPanDuration);

    if (this.cameraWaypoints.length === 0) return;

    // Handle single waypoint case
    if (this.cameraWaypoints.length === 1) {
      const pos = this.cameraWaypoints[0];
      if (this.scene.camera) {
        this.scene.camera.targetX = pos.x;
        this.scene.camera.targetY = pos.y;
        this.scene.camera.x = pos.x;
        this.scene.camera.y = pos.y;
      }
      return;
    }

    // Ease in-out for smooth camera movement
    const easedProgress = this.easeInOutCubic(panProgress);

    // Interpolate through waypoints
    const waypointCount = this.cameraWaypoints.length;
    const segmentProgress = easedProgress * (waypointCount - 1);
    const segmentIndex = Math.min(Math.floor(segmentProgress), waypointCount - 2);
    const segmentT = segmentProgress - segmentIndex;

    const from = this.cameraWaypoints[segmentIndex];
    const to = this.cameraWaypoints[segmentIndex + 1];

    const targetX = from.x + (to.x - from.x) * segmentT;
    const targetY = from.y + (to.y - from.y) * segmentT;

    if (this.scene.camera) {
      this.scene.camera.targetX = targetX;
      this.scene.camera.targetY = targetY;
      this.scene.camera.x = targetX;
      this.scene.camera.y = targetY;
    }
  }

  /**
   * Start the fade out phase
   */
  startFadeOut() {
    // Fade out overlay and title
    if (this.overlayElement) {
      this.overlayElement.style.background = 'rgba(0, 0, 0, 0)';
      this.overlayElement.style.transition = 'background 0.5s ease';
    }
    if (this.titleElement) {
      this.titleElement.style.opacity = '0';
    }

    // Fade out all cards with slight scale down
    for (const card of this.playerCardInstances) {
      card.element.style.opacity = '0';
      card.element.style.transform = 'scale(0.95) translateX(-10px)';
    }
    for (const card of this.enemyCardInstances) {
      card.element.style.opacity = '0';
      card.element.style.transform = 'translateX(20px)';
    }
  }

  /**
   * Clean up DOM elements
   */
  cleanup() {
    // Destroy ParchmentCard instances
    for (const card of this.playerCardInstances) {
      card.destroy();
    }
    for (const card of this.enemyCardInstances) {
      card.destroy();
    }

    // Remove overlay from DOM
    if (this.overlayElement && this.overlayElement.parentNode) {
      this.overlayElement.parentNode.removeChild(this.overlayElement);
    }

    this.playerCardInstances = [];
    this.enemyCardInstances = [];
    this.playerCardStates = [];
    this.enemyCardStates = [];
    this.cardContainer = null;
    this.titleElement = null;
    this.overlayElement = null;
  }

  /**
   * Render - now a no-op since we use DOM elements
   */
  render(_ctx) {
    // DOM-based rendering, no canvas drawing needed
  }

  /**
   * Check if intro is complete
   */
  isComplete() {
    return this.phase === 'complete';
  }

  /**
   * Skip the intro
   */
  skip() {
    this.phase = 'complete';
    this.timer = this.totalDuration;
    this.cleanup();
  }

  // Easing functions
  easeInCubic(t) {
    return t * t * t;
  }

  easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
}
