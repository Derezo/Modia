import { StateManager } from './StateManager.js';
import { SceneManager } from './SceneManager.js';
import { InputHandler } from './InputHandler.js';
import { ApiClient } from '../api/client.js';
import { TokenRefreshManager } from '../api/TokenRefreshManager.js';
import { GameWebSocket } from '../api/websocket.js';
import { AssetLoader } from './AssetLoader.js';
import { responsive } from './Responsive.js';
import { injectParchmentTheme } from '../ui/parchment/ParchmentTheme.js';
import { parchmentToast } from '../ui/parchment/ParchmentToast.js';
import { ProfileDropdown } from '../ui/parchment/ProfileDropdown.js';
import SettingsModal from '../components/SettingsModal.js';
import { NotificationCenter } from '../components/NotificationCenter.js';
import { PartyStatusBar } from '../components/PartyStatusBar.js';
import { PartyInviteModal } from '../components/PartyInviteModal.js';

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

    this.lastTime = 0;
    this.running = false;

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

    // Initialize asset loader
    this.assetLoader = new AssetLoader();
    await this.assetLoader.init();
    console.log('Asset loader initialized');

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
        // Token invalid, stop refresh manager and clear state
        this.tokenRefreshManager.stop();
        this.state.set('token', null);
        this.state.set('refreshToken', null);
        this.state.set('user', null);
        this.state.persist();
        this.scenes.switchTo('login');
      }
    } else {
      // Always show the title intro animation
      this.scenes.switchTo('titleIntro');
    }
  }

  resize() {
    const container = this.canvas.parentElement;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    // Calculate scale to fit target dimensions
    const scaleX = containerWidth / this.targetWidth;
    const scaleY = containerHeight / this.targetHeight;
    this.scale = Math.min(scaleX, scaleY);

    // Set canvas size
    this.canvas.width = this.targetWidth;
    this.canvas.height = this.targetHeight;

    // Scale canvas with CSS
    this.canvas.style.width = `${this.targetWidth * this.scale}px`;
    this.canvas.style.height = `${this.targetHeight * this.scale}px`;

    // Update input handler scale
    if (this.input) {
      this.input.setScale(this.scale);
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

    // Update current scene (passes deltaTime in ms)
    this.scenes.update(deltaTime);

    // Render
    this.render();

    requestAnimationFrame((time) => this.gameLoop(time));
  }

  render() {
    // Clear canvas
    this.ctx.fillStyle = '#1a1a2e';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

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
    } catch (err) {
      console.error('Failed to load settings:', err);
      // Set defaults if load fails
      this.state.set('userSettings', {
        battle: { actionMenuStyle: 'radial' }
      });
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

    this.profileDropdown = null;
    this.notificationCenter = null;
    this.partyStatusBar = null;
    this.partyInviteModal = null;
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
      this._boundResize = null;
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
}
