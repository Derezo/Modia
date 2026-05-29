import { StateManager } from './StateManager.js';
import { SceneManager } from './SceneManager.js';
import { InputHandler } from './InputHandler.js';
import { ApiClient } from '../api/client.js';
import { TokenRefreshManager } from '../api/TokenRefreshManager.js';
import { GameWebSocket } from '../api/websocket.js';
import { AssetLoader } from './AssetLoader.js';
import { AudioManager } from '../audio/AudioManager.js';
import { responsive } from './Responsive.js';
import { injectParchmentTheme } from '../ui/parchment/ParchmentTheme.js';
import { parchmentToast } from '../ui/parchment/ParchmentToast.js';
import { ProfileDropdown } from '../ui/parchment/ProfileDropdown.js';
import SettingsModal from '../components/SettingsModal.js';
import { NotificationCenter } from '../components/NotificationCenter.js';
import { PartyStatusBar } from '../components/PartyStatusBar.js';
import { PartyInviteModal } from '../components/PartyInviteModal.js';
import { setGameInstance as setDebugGameInstance, debugLog, isDebugEnabled } from '../utils/debugLogger.js';
import { ConnectionIndicatorDOM } from '../ui/ConnectionIndicatorDOM.js';
import { connectionQuality } from '../api/connectionQuality.js';

// Default settings structure
// IMPORTANT: This structure is mirrored in:
// - api/src/routes/settings.js (backend validation)
// - frontend/src/scenes/SettingsScene.js (UI)
// Keep all three in sync when making changes.
const DEFAULT_SETTINGS = {
  battle: {
    actionMenuStyle: 'radial',
    showDamageNumbers: true,
    showBattleGrid: true,
    autoEndTurn: false,
    confirmEndTurn: true,
    showDamagePreview: true,
    showMissChance: true,
    battleLogPosition: 'right',
    battleLogVisible: true
  },
  audio: {
    masterVolume: 80,
    musicVolume: 70,
    sfxVolume: 80,
    uiVolume: 70,
    muted: false,
    musicEnabled: true,
    sfxEnabled: true,
    ambientEnabled: true
  },
  display: {
    animationSpeed: 'normal',
    cameraZoom: 1.0,
    uiScale: 1.0,
    showFloatingText: true,
    particleQuality: 'high',
    screenShake: true
  },
  accessibility: {
    highContrast: false,
    reducedMotion: false,
    textSize: 'medium',
    colorBlindMode: 'none',
    fontFamily: 'default',
    lineSpacing: 'normal',
    cursorSize: 'normal',
    screenReaderHints: false
  },
  gameplay: {
    autoSave: true,
    confirmTravel: false,
    showTutorialHints: true,
    questMarkerStyle: 'icon'
  },
  controls: {
    keybindScheme: 'wasd',
    touchGesturesEnabled: true,
    doubleTapConfirm: true,
    holdToCancel: true
  },
  social: {
    showOnlineStatus: true,
    allowPartyInvites: true,
    allowFriendRequests: true,
    chatTimestamps: true,
    profanityFilter: true
  },
  developer: {
    enabled: false,
    audio: {
      logMusicChanges: false,
      logRegionInfo: false,
      logSFXPlayback: false,
      logMissingAssets: true
    },
    network: {
      logAPIRequests: false,
      logWebSocketMessages: false
    },
    state: {
      logStateChanges: false,
      logSceneTransitions: false
    },
    battle: {
      logTurnEvents: false,
      logDamageCalculations: false,
      logAIDecisions: false
    },
    performance: {
      showFPS: false,
      logSlowFrames: false
    }
  }
};

export class Game {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.uiOverlay = null;

    this.state = new StateManager();
    this.scenes = null;
    this.input = null;
    this.api = null;
    this.tokenRefreshManager = null;
    this.socket = null;
    this.assetLoader = null;
    this.audio = null;

    this.lastTime = 0;
    this.running = false;

    // FPS tracking for developer debug
    this.fpsFrameTimes = [];
    this.fpsLastUpdate = 0;
    this.currentFPS = 0;

    // Target dimensions (will be scaled to fit screen)
    this.targetWidth = 800;
    this.targetHeight = 600;
    this.scale = 1;

    // Settings modal
    this.settingsModal = null;

    // Notification system
    this.toast = parchmentToast;  // Unified toast system
    this.profileDropdown = null;  // Profile/menu dropdown (replaces NotificationBell)
    this.notificationCenter = null;

    // Party system
    this.partyStatusBar = null;
    this.partyInviteModal = null;

    // Connection indicator (DOM-based, global)
    this.connectionIndicator = null;

    // Bound handler references for cleanup (window-level listeners)
    this._boundResize = null;
    this._boundKeyHandler = null;

    // Responsive utility reference
    this.responsive = responsive;
    this._responsiveUnsubscribe = null;
  }

  async init() {
    // Get canvas and context
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.uiOverlay = document.getElementById('ui-overlay');

    // Initialize subsystems
    this.api = new ApiClient(this.getApiUrl());
    this.tokenRefreshManager = new TokenRefreshManager(this);
    this.api.setTokenRefreshManager(this.tokenRefreshManager);
    this.socket = new GameWebSocket(this.getWebSocketUrl());
    this.input = new InputHandler(this.canvas);
    this.scenes = new SceneManager(this);

    // Initialize debug logger with game instance
    setDebugGameInstance(this);

    // Initialize asset loader
    this.assetLoader = new AssetLoader();
    await this.assetLoader.init();
    console.log('Asset loader initialized');

    // Initialize audio system
    this.audio = new AudioManager(this);
    await this.audio.init();
    console.log('Audio system initialized');

    // Inject parchment theme CSS variables
    injectParchmentTheme();
    console.log('Parchment theme injected');

    // Subscribe to responsive breakpoint changes
    this._responsiveUnsubscribe = this.responsive.onChange((breakpoint, info) => {
      console.log(`Breakpoint changed: ${info.previous} → ${breakpoint}`);
      // Notify current scene of breakpoint change
      const currentScene = this.scenes?.getCurrentScene();
      if (currentScene?.onBreakpointChange) {
        currentScene.onBreakpointChange(breakpoint, info.previous);
      }
    });

    // Setup canvas sizing
    this.resize();
    this._boundResize = () => this.resize();
    window.addEventListener('resize', this._boundResize);

    // Add visual viewport and orientation change listeners
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', this._boundResize);
    }
    window.addEventListener('orientationchange', this._boundResize);

    // Add load listener for initial layout settling
    this._boundLoad = () => this.resize();
    window.addEventListener('load', this._boundLoad);

    // Schedule deferred re-measure after layout settles
    requestAnimationFrame(() => this.resize());

    // Setup global ESC handler for settings modal
    this.setupGlobalKeyHandler();

    // Hydrate state from localStorage
    this.state.hydrate();

    // Check for existing session
    this.checkSession();

    // Start game loop
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame((time) => this.gameLoop(time));

    console.log('Modia initialized');
  }

  /**
   * Get the music context for region-aware music playback
   * @returns {MusicContext|null} The music context instance
   */
  get musicContext() {
    return this.audio?.musicContext;
  }

  /**
   * Get the local user's ID for player identity checks
   * @returns {number|null} The current user's ID, or null if not logged in
   */
  get localUserId() {
    return this.state.get('user')?.id ?? null;
  }

  getApiUrl() {
    // In development, API runs on port 3000. In production, same origin with /api prefix
    if (window.location.hostname === 'localhost') {
      return 'http://localhost:3000/api';
    }
    return '/api';
  }

  getWebSocketUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    const port = window.location.hostname === 'localhost' ? ':3000' : '';
    return `${protocol}//${host}${port}/ws`;
  }

  async checkSession() {
    const token = this.state.get('token');

    if (token) {
      try {
        // Set token on API client before validating
        this.api.setToken(token);

        const response = await this.api.get('/auth/me');
        this.state.set('user', response.user);

        // Start token refresh manager for automatic token refresh
        this.tokenRefreshManager.start(token);

        // Load user settings
        await this.loadSettings();

        // Connect WebSocket
        this.socket.connect(token);

        // Initialize notification system after WebSocket is ready
        this.initNotificationSystem();

        // Check if player is in an active battle
        try {
          const battleData = await this.api.getCurrentBattle();
          // Active battle found - restore to battle scene
          this.scenes.switchTo('battle', battleData);
        } catch (battleErr) {
          // No active battle (404) or other error - go to world map
          this.scenes.switchTo('worldMap');
        }
      } catch (err) {
        // Distinguish between auth failures and network failures
        // Note: 'Unable to connect to server' is thrown by ApiClient when fetch fails
        // 'Failed to fetch' is the raw browser error message
        // TypeError with 'fetch' in message catches browser variations
        const isNetworkError = err.message === 'Unable to connect to server' ||
                              err.message === 'Failed to fetch' ||
                              (err.name === 'TypeError' && err.message.toLowerCase().includes('fetch'));

        if (isNetworkError) {
          // Network failure - preserve auth state, show error, go to login with option to retry
          console.warn('[Session] Network error during session check:', err.message);
          parchmentToast.error('Connection Error', 'Unable to reach server. Please check your connection.');
          this.scenes.switchTo('login');
        } else {
          // Auth failure (401, invalid token, etc.) - clear state and redirect
          this.tokenRefreshManager.stop();
          this.state.set('token', null);
          this.state.set('refreshToken', null);
          this.state.set('user', null);
          this.state.persist();
          this.scenes.switchTo('login');
        }
      }
    } else {
      // Always show the title intro animation
      this.scenes.switchTo('titleIntro');
    }
  }

  resize() {
    // Prefer visualViewport for accurate mobile viewport measurement
    let containerWidth, containerHeight;

    if (window.visualViewport) {
      // Use visual viewport (excludes mobile browser chrome)
      containerWidth = window.visualViewport.width;
      containerHeight = window.visualViewport.height;
    } else {
      // Fallback to container or window dimensions
      const container = this.canvas.parentElement;
      containerWidth = container.clientWidth || window.innerWidth;
      containerHeight = container.clientHeight || window.innerHeight;
    }

    // Calculate scale to fit target dimensions
    const scaleX = containerWidth / this.targetWidth;
    const scaleY = containerHeight / this.targetHeight;
    this.scale = Math.min(scaleX, scaleY);

    // Get device pixel ratio for crisp rendering on high-DPI displays
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;

    // Set canvas backing store size (DPR-scaled for crisp rendering)
    this.canvas.width = this.targetWidth * dpr;
    this.canvas.height = this.targetHeight * dpr;

    // Scale canvas with CSS (logical size unchanged)
    this.canvas.style.width = `${this.targetWidth * this.scale}px`;
    this.canvas.style.height = `${this.targetHeight * this.scale}px`;

    // Apply DPR transform to context for logical coordinate space
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Update input handler scale
    if (this.input) {
      this.input.setScale(this.scale);
    }

    // Notify active scene of resize
    const currentScene = this.scenes?.getCurrentScene();
    if (currentScene?.onResize) {
      currentScene.onResize();
    }
  }

  /**
   * Main game loop - called via requestAnimationFrame
   *
   * IMPORTANT: deltaTime is passed in MILLISECONDS to all scenes/components.
   * Components that need seconds for physics calculations should convert internally:
   *   const dt = deltaTime / 1000;
   *
   * See docs/FRONTEND_TECHNICAL_PATTERNS.md for the full convention.
   */
  gameLoop(currentTime) {
    if (!this.running) return;

    // deltaTime in MILLISECONDS - this is the project convention
    // Components convert to seconds internally where needed for physics
    const deltaTime = currentTime - this.lastTime;
    this.lastTime = currentTime;

    // Performance tracking for developer debug
    this.trackFramePerformance(deltaTime, currentTime);

    // Update current scene (passes deltaTime in ms)
    this.scenes.update(deltaTime);

    // Render
    this.render();

    // Render FPS overlay if enabled
    this.renderFPSOverlay();

    requestAnimationFrame((time) => this.gameLoop(time));
  }

  /**
   * Track frame performance for debug logging
   * @param {number} deltaTime - Frame time in milliseconds
   * @param {number} currentTime - Current timestamp
   */
  trackFramePerformance(deltaTime, currentTime) {
    // Log slow frames (> 32ms = below 30 FPS)
    if (deltaTime > 32) {
      debugLog('performance.logSlowFrames', `Slow frame: ${deltaTime.toFixed(1)}ms (${(1000 / deltaTime).toFixed(1)} FPS)`);
    }

    // Calculate FPS over a rolling window
    this.fpsFrameTimes.push(deltaTime);
    if (this.fpsFrameTimes.length > 60) {
      this.fpsFrameTimes.shift();
    }

    // Update FPS calculation every 500ms
    if (currentTime - this.fpsLastUpdate > 500) {
      const avgFrameTime = this.fpsFrameTimes.reduce((a, b) => a + b, 0) / this.fpsFrameTimes.length;
      this.currentFPS = Math.round(1000 / avgFrameTime);
      this.fpsLastUpdate = currentTime;
    }
  }

  /**
   * Render FPS counter overlay if enabled
   */
  renderFPSOverlay() {
    if (!isDebugEnabled('performance.showFPS')) return;

    this.ctx.save();
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    this.ctx.fillRect(10, 10, 70, 24);
    this.ctx.fillStyle = this.currentFPS >= 55 ? '#4caf50' : this.currentFPS >= 30 ? '#ff9800' : '#f44336';
    this.ctx.font = 'bold 14px monospace';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(`FPS: ${this.currentFPS}`, 18, 22);
    this.ctx.restore();
  }

  render() {
    // Ensure DPR transform is set (in case any code reset it)
    const dpr = this.dpr || 1;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear canvas using logical dimensions (context is pre-scaled)
    this.ctx.fillStyle = '#1a1a2e';
    this.ctx.fillRect(0, 0, this.targetWidth, this.targetHeight);

    // Render current scene
    this.scenes.render(this.ctx);
  }

  // Convenience methods for scenes
  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      background: ${type === 'error' ? '#d94a4a' : type === 'success' ? '#4caf50' : '#4a90d9'};
      color: white;
      border-radius: 4px;
      font-size: 14px;
      z-index: 1000;
      animation: slideIn 0.3s ease;
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  /**
   * Setup global ESC key handler for settings modal
   */
  setupGlobalKeyHandler() {
    this._boundKeyHandler = (e) => {
      if (e.key === 'Escape') {
        // Check if settings modal is already open
        if (this.settingsModal?.isVisible) {
          return; // Let the modal handle its own ESC
        }

        // Check if current scene wants to handle ESC
        const currentScene = this.scenes?.getCurrentScene();
        if (currentScene?.handleEscape?.()) {
          return; // Scene handled the escape
        }

        // Only show settings if user is logged in
        if (this.state.get('token')) {
          this.showSettings();
        }
      }
    };

    window.addEventListener('keydown', this._boundKeyHandler);
  }

  /**
   * Load user settings from the server
   */
  async loadSettings() {
    try {
      const result = await this.api.getSettings();
      this.state.set('userSettings', result.settings);
      console.log('User settings loaded:', result.settings);

      // Apply accessibility settings immediately
      this.applyAccessibilitySettings(result.settings);

      // Setup developer debug tools if enabled
      this.setupDebugTools();
    } catch (err) {
      console.error('Failed to load settings:', err);
      // Set full defaults if load fails to ensure accessibility settings work
      this.state.set('userSettings', JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));

      // Setup debug tools even with defaults (dev mode disabled by default)
      this.setupDebugTools();
    }
  }

  /**
   * Apply accessibility settings to the game
   * @param {Object} settings - Full settings object
   */
  applyAccessibilitySettings(settings) {
    const accessibility = settings?.accessibility;
    if (!accessibility) return;

    // Apply colorblind filter
    this.applyColorBlindFilter(accessibility.colorBlindMode);

    // Apply text size
    this.applyTextSize(accessibility.textSize);

    // Apply font family
    this.applyFontFamily(accessibility.fontFamily);

    // Apply line spacing
    this.applyLineSpacing(accessibility.lineSpacing);

    // Apply high contrast mode
    this.applyHighContrast(accessibility.highContrast);

    // Apply cursor size
    this.applyCursorSize(accessibility.cursorSize);

    // Apply screen reader hints
    this.applyScreenReaderHints(accessibility.screenReaderHints);

    // Store reduced motion preference in state
    this.state.set('reducedMotion', accessibility.reducedMotion);
  }

  /**
   * Apply colorblind filter via SVG feColorMatrix
   * @param {string} mode - 'none', 'protanopia', 'deuteranopia', 'tritanopia'
   */
  applyColorBlindFilter(mode) {
    if (!mode || mode === 'none') {
      this.canvas.style.filter = 'none';
      return;
    }

    // Create SVG filters if not present
    let filterSvg = document.getElementById('colorblind-filters');
    if (!filterSvg) {
      filterSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      filterSvg.id = 'colorblind-filters';
      filterSvg.setAttribute('style', 'position: absolute; width: 0; height: 0;');
      filterSvg.innerHTML = `
        <defs>
          <filter id="protanopia-filter">
            <feColorMatrix type="matrix" values="
              0.567, 0.433, 0,     0, 0
              0.558, 0.442, 0,     0, 0
              0,     0.242, 0.758, 0, 0
              0,     0,     0,     1, 0"/>
          </filter>
          <filter id="deuteranopia-filter">
            <feColorMatrix type="matrix" values="
              0.625, 0.375, 0,   0, 0
              0.7,   0.3,   0,   0, 0
              0,     0.3,   0.7, 0, 0
              0,     0,     0,   1, 0"/>
          </filter>
          <filter id="tritanopia-filter">
            <feColorMatrix type="matrix" values="
              0.95, 0.05,  0,     0, 0
              0,    0.433, 0.567, 0, 0
              0,    0.475, 0.525, 0, 0
              0,    0,     0,     1, 0"/>
          </filter>
        </defs>
      `;
      document.body.appendChild(filterSvg);
    }

    // Apply filter to canvas
    const filterMap = {
      protanopia: 'url(#protanopia-filter)',
      deuteranopia: 'url(#deuteranopia-filter)',
      tritanopia: 'url(#tritanopia-filter)'
    };

    this.canvas.style.filter = filterMap[mode] || 'none';
  }

  /**
   * Apply text size setting via CSS custom property
   * @param {string} size - 'small', 'medium', 'large'
   */
  applyTextSize(size) {
    const sizeMap = {
      small: '12px',
      medium: '14px',
      large: '18px'
    };
    document.documentElement.style.setProperty('--game-text-size', sizeMap[size] || '14px');
  }

  /**
   * Apply font family setting via CSS custom property
   * @param {string} family - 'default', 'dyslexic', 'monospace'
   */
  applyFontFamily(family) {
    const fontMap = {
      default: 'Georgia, serif',
      dyslexic: 'OpenDyslexic, Comic Sans MS, sans-serif',
      monospace: 'Consolas, Monaco, monospace'
    };
    document.documentElement.style.setProperty('--game-font-family', fontMap[family] || fontMap.default);
  }

  /**
   * Apply line spacing setting via CSS custom property
   * @param {string} spacing - 'compact', 'normal', 'relaxed'
   */
  applyLineSpacing(spacing) {
    const spacingMap = {
      compact: '1.2',
      normal: '1.5',
      relaxed: '1.8'
    };
    document.documentElement.style.setProperty('--game-line-height', spacingMap[spacing] || '1.5');
  }

  /**
   * Apply high contrast mode
   * Increases text contrast and applies darker backgrounds for better visibility
   * @param {boolean} enabled - Whether high contrast mode is enabled
   */
  applyHighContrast(enabled) {
    const root = document.documentElement;

    if (enabled) {
      root.classList.add('high-contrast');

      // Inject high contrast styles if not present
      if (!document.getElementById('high-contrast-styles')) {
        const style = document.createElement('style');
        style.id = 'high-contrast-styles';
        style.textContent = `
          .high-contrast {
            --parchment-text-primary: #000000;
            --parchment-text-secondary: #1a1a1a;
            --parchment-text-muted: #333333;
            --parchment-light: #ffffff;
            --parchment-mid: #f5f5f5;
            --parchment-dark: #e0e0e0;
            --parchment-border: #000000;
            --parchment-border-dark: #000000;
          }

          .high-contrast .settings-container,
          .high-contrast .parchment-panel,
          .high-contrast .parchment-modal {
            background: #ffffff !important;
            color: #000000 !important;
          }

          .high-contrast button,
          .high-contrast .settings-btn,
          .high-contrast .parchment-button {
            border-width: 3px !important;
            font-weight: bold !important;
          }

          .high-contrast input[type="checkbox"],
          .high-contrast input[type="radio"] {
            outline: 2px solid #000000;
          }

          .high-contrast a,
          .high-contrast .link {
            text-decoration: underline !important;
            color: #0000cc !important;
          }

          .high-contrast .settings-radio-option.selected {
            background: #ffff00 !important;
            border-color: #000000 !important;
          }

          .high-contrast .settings-tab.active {
            background: #ffff00 !important;
            border-color: #000000 !important;
          }
        `;
        document.head.appendChild(style);
      }
    } else {
      root.classList.remove('high-contrast');
    }

    // Store in state for canvas rendering code to check
    this.state.set('highContrast', enabled);
  }

  /**
   * Apply cursor size setting
   * Changes the cursor size via CSS custom property
   * @param {string} size - 'small', 'normal', 'large'
   */
  applyCursorSize(size) {
    const sizeMap = {
      small: '16px',
      normal: '24px',
      large: '32px'
    };

    const cursorSize = sizeMap[size] || '24px';
    document.documentElement.style.setProperty('--cursor-size', cursorSize);

    // Inject cursor styles if not present
    if (!document.getElementById('cursor-size-styles')) {
      const style = document.createElement('style');
      style.id = 'cursor-size-styles';
      style.textContent = `
        :root {
          --cursor-size: 24px;
        }

        .cursor-large #game-canvas,
        .cursor-large .settings-container,
        .cursor-large .parchment-panel,
        .cursor-large .parchment-modal {
          cursor: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><polygon points="0,0 0,24 6,18 12,28 16,26 10,16 18,16" fill="black" stroke="white" stroke-width="1"/></svg>') 0 0, auto;
        }

        .cursor-small #game-canvas,
        .cursor-small .settings-container,
        .cursor-small .parchment-panel,
        .cursor-small .parchment-modal {
          cursor: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><polygon points="0,0 0,12 3,9 6,14 8,13 5,8 9,8" fill="black" stroke="white" stroke-width="0.5"/></svg>') 0 0, auto;
        }
      `;
      document.head.appendChild(style);
    }

    // Apply cursor class to root element
    const root = document.documentElement;
    root.classList.remove('cursor-small', 'cursor-normal', 'cursor-large');

    if (size === 'small') {
      root.classList.add('cursor-small');
    } else if (size === 'large') {
      root.classList.add('cursor-large');
    }
    // Normal size uses default cursor

    // Store in state
    this.state.set('cursorSize', size);
  }

  /**
   * Apply screen reader hints setting
   * Adds aria-live regions and enhanced ARIA labels when enabled
   * @param {boolean} enabled - Whether screen reader hints are enabled
   */
  applyScreenReaderHints(enabled) {
    const root = document.documentElement;

    if (enabled) {
      root.setAttribute('data-screen-reader-hints', 'true');

      // Create or update the live region for announcements
      let liveRegion = document.getElementById('game-announcements');
      if (!liveRegion) {
        liveRegion = document.createElement('div');
        liveRegion.id = 'game-announcements';
        liveRegion.setAttribute('aria-live', 'polite');
        liveRegion.setAttribute('aria-atomic', 'true');
        liveRegion.setAttribute('role', 'status');
        liveRegion.className = 'sr-only';
        document.body.appendChild(liveRegion);
      }

      // Create assertive live region for urgent announcements
      let urgentRegion = document.getElementById('game-alerts');
      if (!urgentRegion) {
        urgentRegion = document.createElement('div');
        urgentRegion.id = 'game-alerts';
        urgentRegion.setAttribute('aria-live', 'assertive');
        urgentRegion.setAttribute('aria-atomic', 'true');
        urgentRegion.setAttribute('role', 'alert');
        urgentRegion.className = 'sr-only';
        document.body.appendChild(urgentRegion);
      }

      // Inject screen reader styles if not present
      if (!document.getElementById('screen-reader-styles')) {
        const style = document.createElement('style');
        style.id = 'screen-reader-styles';
        style.textContent = `
          .sr-only {
            position: absolute;
            width: 1px;
            height: 1px;
            padding: 0;
            margin: -1px;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
            white-space: nowrap;
            border: 0;
          }

          [data-screen-reader-hints="true"] #game-canvas {
            outline-offset: 2px;
          }

          [data-screen-reader-hints="true"] .focusable:focus {
            outline: 3px solid #4a90d9;
            outline-offset: 2px;
          }
        `;
        document.head.appendChild(style);
      }

      // Add ARIA label to canvas
      if (this.canvas) {
        this.canvas.setAttribute('aria-label', 'Modia game canvas - Use keyboard shortcuts for navigation');
        this.canvas.setAttribute('role', 'application');
      }
    } else {
      root.removeAttribute('data-screen-reader-hints');

      // Remove ARIA attributes from canvas
      if (this.canvas) {
        this.canvas.removeAttribute('aria-label');
        this.canvas.removeAttribute('role');
      }
    }

    // Store in state for components to check
    this.state.set('screenReaderHints', enabled);
  }

  /**
   * Announce a message to screen readers
   * Only announces if screen reader hints are enabled
   * @param {string} message - The message to announce
   * @param {boolean} urgent - If true, uses assertive announcement
   */
  announceToScreenReader(message, urgent = false) {
    if (!this.state.get('screenReaderHints')) return;

    const regionId = urgent ? 'game-alerts' : 'game-announcements';
    const region = document.getElementById(regionId);

    if (region) {
      // Clear and set message to trigger announcement
      region.textContent = '';
      // Use setTimeout to ensure the clear takes effect before new content
      setTimeout(() => {
        region.textContent = message;
      }, 50);
    }
  }

  /**
   * Get a user setting by path (e.g., 'battle.actionMenuStyle')
   * @param {string} path - Dot-notation path to setting
   * @param {*} defaultValue - Default value if setting not found
   * @returns {*} The setting value
   */
  getUserSetting(path, defaultValue = null) {
    const settings = this.state.get('userSettings') || {};
    const keys = path.split('.');
    let value = settings;

    for (const key of keys) {
      if (value === undefined || value === null) {
        return defaultValue;
      }
      value = value[key];
    }

    return value !== undefined ? value : defaultValue;
  }

  /**
   * Show the settings modal
   */
  showSettings() {
    if (this.settingsModal?.isVisible) {
      return;
    }

    this.settingsModal = new SettingsModal(this);
    this.settingsModal.show({
      onClose: (saved) => {
        this.settingsModal = null;
        if (saved) {
          console.log('Settings saved');
        }
      }
    });
  }

  /**
   * Initialize the notification system components
   * Called after successful login and WebSocket connection
   */
  initNotificationSystem() {
    // Clean up existing instances if any
    this.destroyNotificationSystem();

    // Create notification components (parchment-styled)
    this.profileDropdown = new ProfileDropdown(this);
    this.notificationCenter = new NotificationCenter(this);

    // Create party components
    this.partyStatusBar = new PartyStatusBar(this);

    // Create connection indicator (DOM-based, global)
    // Position in top-right, show latency in tooltip, hide when healthy to reduce visual noise
    this.connectionIndicator = new ConnectionIndicatorDOM(connectionQuality, {
      showLatency: true,
      hideWhenHealthy: true,
      position: 'top-right'
    });

    // Show the profile dropdown (replaces old notification bell + menu)
    this.profileDropdown.show();

    // Check if user is already in a party
    this.partyStatusBar.checkPartyStatus();

    // Setup party invite handler for notifications
    this.setupPartyInviteHandler();

    console.log('Notification system initialized');
  }

  /**
   * Setup handler for party invite notifications
   */
  setupPartyInviteHandler() {
    if (!this.socket) return;

    this.socket.on('party:invite_received', (data) => {
      // Show toast notification
      const partyText = data.partyName ? ` (${data.partyName})` : '';
      this.toast.info(
        'Party Invite',
        `${data.fromUsername} invited you to join their party${partyText}`
      );

      // Show party invite modal
      this.showPartyInviteModal({
        inviteId: data.inviteId,
        partyId: data.partyId,
        partyName: data.partyName,
        leaderUsername: data.fromUsername,
        expiresAt: data.expiresAt
      });
    });
  }

  /**
   * Show party invite modal
   * @param {Object} inviteData - Invite details
   */
  showPartyInviteModal(inviteData) {
    // Close existing modal if open
    if (this.partyInviteModal) {
      this.partyInviteModal.destroy();
    }

    this.partyInviteModal = new PartyInviteModal(this);
    this.partyInviteModal.show({
      ...inviteData,
      onClose: (accepted) => {
        this.partyInviteModal = null;

        // If accepted, refresh party status bar
        if (accepted && this.partyStatusBar) {
          this.partyStatusBar.refresh();
        }
      }
    });
  }

  /**
   * Destroy notification system components
   * Called on logout or cleanup
   */
  destroyNotificationSystem() {
    this.profileDropdown?.destroy();
    this.notificationCenter?.destroy();
    this.partyStatusBar?.destroy();
    this.partyInviteModal?.destroy();
    this.connectionIndicator?.destroy();

    this.profileDropdown = null;
    this.notificationCenter = null;
    this.partyStatusBar = null;
    this.partyInviteModal = null;
    this.connectionIndicator = null;
  }

  /**
   * Clean up all resources and event listeners
   * Call this before creating a new Game instance to prevent memory leaks
   */
  destroy() {
    this.running = false;

    // Remove window-level event listeners
    if (this._boundResize) {
      window.removeEventListener('resize', this._boundResize);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', this._boundResize);
      }
      window.removeEventListener('orientationchange', this._boundResize);
      this._boundResize = null;
    }
    if (this._boundLoad) {
      window.removeEventListener('load', this._boundLoad);
      this._boundLoad = null;
    }
    if (this._boundKeyHandler) {
      window.removeEventListener('keydown', this._boundKeyHandler);
      this._boundKeyHandler = null;
    }

    // Clean up responsive subscription
    if (this._responsiveUnsubscribe) {
      this._responsiveUnsubscribe();
      this._responsiveUnsubscribe = null;
    }

    // Clean up subsystems
    this.input?.destroy();
    this.tokenRefreshManager?.stop();
    this.socket?.disconnect();
    this.audio?.destroy();
    this.destroyNotificationSystem();
  }

  /**
   * Show/hide profile dropdown and party bar based on current scene
   * @param {string} sceneName - Name of the current scene
   */
  updateNotificationVisibility(sceneName) {
    // Profile dropdown should ONLY be visible on the world map
    const profileVisibleScenes = ['worldMap'];
    if (profileVisibleScenes.includes(sceneName)) {
      this.profileDropdown?.show();
    } else {
      this.profileDropdown?.hide();
    }

    // Party status bar visibility is separate from profile dropdown
    const partyHiddenScenes = ['login', 'register', 'titleIntro'];
    if (partyHiddenScenes.includes(sceneName)) {
      this.partyStatusBar?.hide();
    } else if (this.partyStatusBar?.party) {
      this.partyStatusBar.show();
    }
  }

  /**
   * Setup developer debug tools (console functions)
   * Only available when developer mode is enabled in settings
   */
  setupDebugTools() {
    const settings = this.state.get('userSettings');
    const devEnabled = settings?.developer?.enabled === true;

    if (devEnabled) {
      // Expose win_battle() function to console
      window.win_battle = async () => {
        const currentScene = this.scenes?.getCurrentScene();

        if (!currentScene || !currentScene.battleId) {
          console.error('[DEBUG] win_battle(): Not in a battle. Navigate to a battle scene first.');
          return;
        }

        const battleId = currentScene.battleId;
        console.log(`[DEBUG] Winning battle ${battleId}...`);

        try {
          const response = await this.api.post(`/debug/win-battle/${battleId}`);

          if (response.success) {
            console.log('[DEBUG] Battle won!', response);
            // The backend will broadcast battle:end via WebSocket which will trigger the victory sequence
          } else {
            console.error('[DEBUG] Failed to win battle:', response);
          }
        } catch (error) {
          console.error('[DEBUG] Error winning battle:', error.message);
        }
      };

      // Expose clear_node() function to console
      window.clear_node = async (nodeId) => {
        if (!nodeId) {
          // Try to get current node if not provided
          const currentNode = this.state.get('currentNode');
          if (currentNode?.id) {
            nodeId = currentNode.id;
          } else {
            console.error('[DEBUG] clear_node(nodeId): Please provide a node ID');
            return;
          }
        }

        console.log(`[DEBUG] Clearing node ${nodeId}...`);

        try {
          const response = await this.api.post(`/debug/clear-node/${nodeId}`);

          if (response.success) {
            console.log('[DEBUG] Node cleared!', response);
            // Refresh world map if currently on it
            const currentScene = this.scenes?.getCurrentScene();
            if (currentScene?.refreshNodes) {
              currentScene.refreshNodes();
            }
          } else {
            console.error('[DEBUG] Failed to clear node:', response);
          }
        } catch (error) {
          console.error('[DEBUG] Error clearing node:', error.message);
        }
      };

      console.log('[DEBUG] Developer tools enabled. Available commands:');
      console.log('  win_battle() - Instantly win the current battle');
      console.log('  clear_node(nodeId?) - Clear a combat node without fighting');
    } else {
      // Remove debug functions if dev mode is disabled
      delete window.win_battle;
      delete window.clear_node;
    }
  }
}
