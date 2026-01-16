import { Scene } from './Scene.js';
import { PARCHMENT_COLORS, injectParchmentTheme } from '../ui/parchment/index.js';

// Shorthand for colors in CSS template
const P = PARCHMENT_COLORS;

// Default settings structure (mirrors backend)
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
  }
};

/**
 * SettingsScene - Full-screen settings configuration
 * Features: 7 tabs - Battle, Audio, Display, Accessibility, Gameplay, Controls, Social
 */
export class SettingsScene extends Scene {
  constructor(game) {
    super(game);
    this.uiElement = null;
    this.abortController = null;

    // State
    this.activeTab = 'battle';
    this.settings = null;
    this.originalSettings = null; // For cancel/reset
    this.loading = false;
    this.hasChanges = false;
  }

  async enter(_data = {}) {
    try {
      this.addStyles();
      await this.loadSettings();
      this.createUI();
      this.setupEventListeners();
    } catch (err) {
      console.error('Failed to enter SettingsScene:', err);
      // Show error UI
      this.game.toastManager?.error('Settings Error', 'Failed to load settings. Please try again.');
      this.game.scenes.switchTo('worldMap');
    }
  }

  exit() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.uiElement) {
      this.uiElement.remove();
      this.uiElement = null;
    }
  }

  addStyles() {
    injectParchmentTheme();

    if (document.getElementById('settings-scene-styles')) return;

    const style = document.createElement('style');
    style.id = 'settings-scene-styles';
    style.textContent = `
      .settings-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: linear-gradient(to bottom, var(--parchment-light) 0%, var(--parchment-mid) 50%, var(--parchment-dark) 100%);
        display: flex;
        flex-direction: column;
        font-family: var(--parchment-font);
        color: var(--parchment-text-primary);
      }

      .settings-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--parchment-spacing-lg) var(--parchment-spacing-xxl);
        background: linear-gradient(to bottom, var(--parchment-mid) 0%, var(--parchment-dark) 100%);
        border-bottom: 2px solid var(--parchment-border);
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }

      .settings-title {
        display: flex;
        align-items: center;
        gap: var(--parchment-spacing-md);
      }

      .settings-title h2 {
        margin: 0;
        color: var(--parchment-burgundy);
        text-shadow: 0 1px 0 var(--parchment-highlight);
        font-size: 22px;
      }

      .settings-title-icon {
        font-size: 24px;
      }

      .settings-header-actions {
        display: flex;
        gap: var(--parchment-spacing-sm);
      }

      .settings-content {
        flex: 1;
        display: flex;
        overflow: hidden;
      }

      /* Sidebar Tabs */
      .settings-sidebar {
        width: 200px;
        background: linear-gradient(to bottom, var(--parchment-mid) 0%, var(--parchment-dark) 100%);
        border-right: 2px solid var(--parchment-border);
        padding: var(--parchment-spacing-md);
        display: flex;
        flex-direction: column;
        gap: var(--parchment-spacing-xs);
        overflow-y: auto;
      }

      .settings-tab {
        padding: var(--parchment-spacing-md) var(--parchment-spacing-lg);
        background: linear-gradient(to bottom, var(--parchment-light) 0%, var(--parchment-mid) 100%);
        border: 2px solid var(--parchment-border);
        border-radius: var(--parchment-radius-lg);
        color: var(--parchment-text-secondary);
        cursor: pointer;
        transition: all 0.2s;
        font-family: var(--parchment-font);
        font-size: 14px;
        font-weight: bold;
        text-align: left;
        display: flex;
        align-items: center;
        gap: var(--parchment-spacing-sm);
      }

      .settings-tab:hover:not(.active) {
        background: linear-gradient(to bottom, var(--parchment-text-inverse) 0%, var(--parchment-light) 100%);
        color: var(--parchment-text-primary);
      }

      .settings-tab.active {
        background: linear-gradient(to bottom, var(--parchment-text-inverse) 0%, var(--parchment-light) 100%);
        color: var(--parchment-text-primary);
        border-color: var(--parchment-burgundy);
      }

      .settings-tab-icon {
        font-size: 18px;
      }

      /* Main Panel */
      .settings-main {
        flex: 1;
        overflow-y: auto;
        padding: var(--parchment-spacing-xl);
      }

      .settings-panel {
        display: none;
        max-width: 600px;
      }

      .settings-panel.active {
        display: block;
      }

      .settings-panel-title {
        font-size: 20px;
        font-weight: bold;
        color: var(--parchment-burgundy);
        margin-bottom: var(--parchment-spacing-lg);
        padding-bottom: var(--parchment-spacing-sm);
        border-bottom: 2px solid var(--parchment-border);
        text-shadow: 0 1px 0 var(--parchment-highlight);
      }

      .settings-section {
        margin-bottom: var(--parchment-spacing-xl);
        padding-bottom: var(--parchment-spacing-lg);
        border-bottom: 1px solid var(--parchment-border);
      }

      .settings-section:last-child {
        border-bottom: none;
      }

      .settings-section-title {
        font-size: 15px;
        font-weight: bold;
        color: var(--parchment-text-primary);
        margin-bottom: var(--parchment-spacing-md);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .settings-group {
        margin-bottom: var(--parchment-spacing-lg);
      }

      .settings-group-label {
        font-size: 14px;
        font-weight: bold;
        color: var(--parchment-text-primary);
        margin-bottom: var(--parchment-spacing-sm);
      }

      .settings-group-description {
        font-size: 12px;
        color: var(--parchment-text-muted);
        margin-bottom: var(--parchment-spacing-md);
      }

      /* Form Controls */
      .settings-select {
        width: 100%;
        padding: var(--parchment-spacing-sm) var(--parchment-spacing-md);
        background: linear-gradient(to bottom, var(--parchment-text-inverse) 0%, ${P.light}ee 100%);
        border: 2px solid var(--parchment-border);
        border-radius: var(--parchment-radius-md);
        color: var(--parchment-text-primary);
        font-family: var(--parchment-font);
        font-size: 14px;
        cursor: pointer;
      }

      .settings-select:focus {
        outline: none;
        border-color: var(--parchment-burgundy);
      }

      .settings-checkbox-group {
        display: flex;
        align-items: center;
        gap: var(--parchment-spacing-md);
        padding: var(--parchment-spacing-sm) 0;
      }

      .settings-checkbox {
        width: 20px;
        height: 20px;
        accent-color: var(--parchment-burgundy);
        cursor: pointer;
      }

      .settings-checkbox-label {
        font-size: 14px;
        cursor: pointer;
        flex: 1;
      }

      /* Slider/Range */
      .settings-slider-container {
        display: flex;
        align-items: center;
        gap: var(--parchment-spacing-md);
      }

      .settings-slider {
        flex: 1;
        height: 8px;
        border-radius: 4px;
        background: var(--parchment-border);
        appearance: none;
        cursor: pointer;
      }

      .settings-slider::-webkit-slider-thumb {
        appearance: none;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: linear-gradient(to bottom, var(--parchment-border) 0%, var(--parchment-border-dark) 100%);
        border: 2px solid var(--parchment-border-dark);
        cursor: pointer;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      }

      .settings-slider::-moz-range-thumb {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: linear-gradient(to bottom, var(--parchment-border) 0%, var(--parchment-border-dark) 100%);
        border: 2px solid var(--parchment-border-dark);
        cursor: pointer;
      }

      .settings-slider-value {
        min-width: 50px;
        text-align: right;
        font-size: 14px;
        font-weight: bold;
        color: var(--parchment-text-primary);
      }

      /* Radio Group */
      .settings-radio-group {
        display: flex;
        gap: var(--parchment-spacing-sm);
        flex-wrap: wrap;
      }

      .settings-radio-option {
        display: flex;
        align-items: center;
        gap: var(--parchment-spacing-xs);
        padding: var(--parchment-spacing-sm) var(--parchment-spacing-md);
        background: linear-gradient(to bottom, var(--parchment-light) 0%, var(--parchment-mid) 100%);
        border: 2px solid var(--parchment-border);
        border-radius: var(--parchment-radius-md);
        cursor: pointer;
        transition: all 0.2s;
      }

      .settings-radio-option:hover {
        background: linear-gradient(to bottom, var(--parchment-text-inverse) 0%, var(--parchment-light) 100%);
      }

      .settings-radio-option.selected {
        border-color: var(--parchment-burgundy);
        background: linear-gradient(to bottom, var(--parchment-text-inverse) 0%, var(--parchment-light) 100%);
      }

      .settings-radio-option.selected .settings-radio-label {
        color: var(--parchment-burgundy);
      }

      .settings-radio-label {
        font-size: 13px;
        font-weight: bold;
        color: var(--parchment-text-secondary);
      }

      /* Keybind Preview */
      .keybind-preview {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: var(--parchment-spacing-sm);
        padding: var(--parchment-spacing-md);
        background: var(--parchment-light);
        border: 1px solid var(--parchment-border);
        border-radius: var(--parchment-radius-md);
        margin-top: var(--parchment-spacing-sm);
      }

      .keybind-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 12px;
      }

      .keybind-action {
        color: var(--parchment-text-muted);
      }

      .keybind-key {
        padding: 2px 6px;
        background: var(--parchment-mid);
        border: 1px solid var(--parchment-border);
        border-radius: 3px;
        font-family: monospace;
        font-weight: bold;
      }

      /* Buttons */
      .settings-btn {
        padding: var(--parchment-spacing-sm) var(--parchment-spacing-lg);
        background: linear-gradient(to bottom, var(--parchment-mid) 0%, var(--parchment-dark) 100%);
        border: 2px solid var(--parchment-border);
        border-radius: var(--parchment-radius-lg);
        color: var(--parchment-text-primary);
        font-family: var(--parchment-font);
        font-size: 13px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.15s;
      }

      .settings-btn:hover {
        background: linear-gradient(to bottom, var(--parchment-light) 0%, var(--parchment-mid) 100%);
      }

      .settings-btn:active {
        transform: translateY(1px);
      }

      .settings-btn-primary {
        background: linear-gradient(to bottom, var(--parchment-border) 0%, var(--parchment-border-dark) 100%);
        color: var(--parchment-text-inverse);
        border-color: var(--parchment-border-dark);
      }

      .settings-btn-primary:hover {
        background: linear-gradient(to bottom, var(--parchment-border-light) 0%, var(--parchment-border) 100%);
      }

      .settings-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* Footer */
      .settings-footer {
        display: flex;
        justify-content: space-between;
        padding: var(--parchment-spacing-md) var(--parchment-spacing-xl);
        background: linear-gradient(to bottom, var(--parchment-mid) 0%, var(--parchment-dark) 100%);
        border-top: 2px solid var(--parchment-border);
      }

      .settings-footer-left {
        display: flex;
        gap: var(--parchment-spacing-sm);
      }

      .settings-footer-right {
        display: flex;
        gap: var(--parchment-spacing-sm);
      }

      .unsaved-indicator {
        display: none;
        align-items: center;
        gap: var(--parchment-spacing-xs);
        font-size: 12px;
        color: var(--parchment-state-warning);
        font-style: italic;
      }

      .unsaved-indicator.visible {
        display: flex;
      }

      /* Responsive */
      @media (max-width: 768px) {
        .settings-content {
          flex-direction: column;
        }

        .settings-sidebar {
          width: 100%;
          flex-direction: row;
          overflow-x: auto;
          border-right: none;
          border-bottom: 2px solid var(--parchment-border);
        }

        .settings-tab {
          padding: var(--parchment-spacing-sm) var(--parchment-spacing-md);
          font-size: 12px;
          white-space: nowrap;
        }

        .settings-tab-label {
          display: none;
        }

        .settings-main {
          padding: var(--parchment-spacing-md);
        }

        .settings-header {
          padding: var(--parchment-spacing-md);
        }

        .settings-footer {
          flex-direction: column;
          gap: var(--parchment-spacing-sm);
        }

        .settings-footer-left,
        .settings-footer-right {
          justify-content: center;
        }

        .keybind-preview {
          grid-template-columns: repeat(2, 1fr);
        }
      }
    `;
    document.head.appendChild(style);
  }

  async loadSettings() {
    try {
      const result = await this.game.api.getSettings();
      // Deep merge with defaults to ensure all fields exist
      this.settings = this.deepMerge(DEFAULT_SETTINGS, result.settings);
      this.originalSettings = JSON.parse(JSON.stringify(this.settings));
    } catch (err) {
      console.error('Failed to load settings:', err);
      // Use defaults
      this.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      this.originalSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
  }

  deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }

  createUI() {
    const container = document.createElement('div');
    container.className = 'settings-container';

    container.innerHTML = `
      <div class="settings-header">
        <div class="settings-title">
          <span class="settings-title-icon">&#9881;</span>
          <h2>Settings</h2>
        </div>
        <div class="settings-header-actions">
          <span class="unsaved-indicator" id="unsaved-indicator">
            <span>&#9888;</span> Unsaved changes
          </span>
        </div>
      </div>

      <div class="settings-content">
        <div class="settings-sidebar">
          <button class="settings-tab active" data-tab="battle">
            <span class="settings-tab-icon">&#9876;</span>
            <span class="settings-tab-label">Battle</span>
          </button>
          <button class="settings-tab" data-tab="audio">
            <span class="settings-tab-icon">&#127925;</span>
            <span class="settings-tab-label">Audio</span>
          </button>
          <button class="settings-tab" data-tab="display">
            <span class="settings-tab-icon">&#128187;</span>
            <span class="settings-tab-label">Display</span>
          </button>
          <button class="settings-tab" data-tab="accessibility">
            <span class="settings-tab-icon">&#9855;</span>
            <span class="settings-tab-label">Accessibility</span>
          </button>
          <button class="settings-tab" data-tab="gameplay">
            <span class="settings-tab-icon">&#127918;</span>
            <span class="settings-tab-label">Gameplay</span>
          </button>
          <button class="settings-tab" data-tab="controls">
            <span class="settings-tab-icon">&#9000;</span>
            <span class="settings-tab-label">Controls</span>
          </button>
          <button class="settings-tab" data-tab="social">
            <span class="settings-tab-icon">&#128101;</span>
            <span class="settings-tab-label">Social</span>
          </button>
        </div>

        <div class="settings-main">
          ${this.renderBattlePanel()}
          ${this.renderAudioPanel()}
          ${this.renderDisplayPanel()}
          ${this.renderAccessibilityPanel()}
          ${this.renderGameplayPanel()}
          ${this.renderControlsPanel()}
          ${this.renderSocialPanel()}
        </div>
      </div>

      <div class="settings-footer">
        <div class="settings-footer-left">
          <button class="settings-btn" id="reset-btn">Reset to Defaults</button>
        </div>
        <div class="settings-footer-right">
          <button class="settings-btn" id="cancel-btn">Cancel</button>
          <button class="settings-btn settings-btn-primary" id="save-btn">Save Changes</button>
        </div>
      </div>
    `;

    this.game.uiOverlay.appendChild(container);
    this.uiElement = container;
  }

  renderBattlePanel() {
    const s = this.settings.battle;
    return `
      <div class="settings-panel active" id="panel-battle">
        <div class="settings-panel-title">Battle Settings</div>

        <div class="settings-section">
          <div class="settings-section-title">Interface</div>

          <div class="settings-group">
            <div class="settings-group-label">Action Menu Style</div>
            <div class="settings-group-description">Choose how you want to select actions during combat.</div>
            <div class="settings-radio-group" data-setting="battle.actionMenuStyle">
              <div class="settings-radio-option ${s.actionMenuStyle === 'radial' ? 'selected' : ''}" data-value="radial">
                <span class="settings-radio-label">Radial Menu</span>
              </div>
              <div class="settings-radio-option ${s.actionMenuStyle === 'context' ? 'selected' : ''}" data-value="context">
                <span class="settings-radio-label">Context Menu</span>
              </div>
              <div class="settings-radio-option ${s.actionMenuStyle === 'actionbar' ? 'selected' : ''}" data-value="actionbar">
                <span class="settings-radio-label">Action Bar</span>
              </div>
            </div>
          </div>

          <div class="settings-group">
            <div class="settings-group-label">Battle Log Position</div>
            <div class="settings-group-description">Where to display the battle log during combat.</div>
            <div class="settings-radio-group" data-setting="battle.battleLogPosition">
              <div class="settings-radio-option ${s.battleLogPosition === 'left' ? 'selected' : ''}" data-value="left">
                <span class="settings-radio-label">Left</span>
              </div>
              <div class="settings-radio-option ${s.battleLogPosition === 'right' ? 'selected' : ''}" data-value="right">
                <span class="settings-radio-label">Right</span>
              </div>
              <div class="settings-radio-option ${s.battleLogPosition === 'bottom' ? 'selected' : ''}" data-value="bottom">
                <span class="settings-radio-label">Bottom</span>
              </div>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Visual Feedback</div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="battle-damage-numbers" ${s.showDamageNumbers ? 'checked' : ''} data-setting="battle.showDamageNumbers">
              <label class="settings-checkbox-label" for="battle-damage-numbers">Show Damage Numbers</label>
            </div>
          </div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="battle-grid" ${s.showBattleGrid ? 'checked' : ''} data-setting="battle.showBattleGrid">
              <label class="settings-checkbox-label" for="battle-grid">Show Battle Grid Lines</label>
            </div>
          </div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="battle-damage-preview" ${s.showDamagePreview ? 'checked' : ''} data-setting="battle.showDamagePreview">
              <label class="settings-checkbox-label" for="battle-damage-preview">Show Damage Preview on Hover</label>
            </div>
          </div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="battle-miss-chance" ${s.showMissChance ? 'checked' : ''} data-setting="battle.showMissChance">
              <label class="settings-checkbox-label" for="battle-miss-chance">Show Hit/Miss Chance</label>
            </div>
          </div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="battle-log-visible" ${s.battleLogVisible ? 'checked' : ''} data-setting="battle.battleLogVisible">
              <label class="settings-checkbox-label" for="battle-log-visible">Show Battle Log</label>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Turn Management</div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="battle-auto-end" ${s.autoEndTurn ? 'checked' : ''} data-setting="battle.autoEndTurn">
              <label class="settings-checkbox-label" for="battle-auto-end">Auto-End Turn When No Actions Available</label>
            </div>
            <div class="settings-group-description">Automatically end your turn when you have no more available actions.</div>
          </div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="battle-confirm-end" ${s.confirmEndTurn ? 'checked' : ''} data-setting="battle.confirmEndTurn">
              <label class="settings-checkbox-label" for="battle-confirm-end">Confirm Before Ending Turn</label>
            </div>
            <div class="settings-group-description">Show a confirmation dialog before ending your turn.</div>
          </div>
        </div>
      </div>
    `;
  }

  renderAudioPanel() {
    const s = this.settings.audio;
    return `
      <div class="settings-panel" id="panel-audio">
        <div class="settings-panel-title">Audio Settings</div>

        <div class="settings-section">
          <div class="settings-section-title">Master Controls</div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="audio-muted" ${s.muted ? 'checked' : ''} data-setting="audio.muted">
              <label class="settings-checkbox-label" for="audio-muted">Mute All Audio</label>
            </div>
          </div>

          <div class="settings-group">
            <div class="settings-group-label">Master Volume</div>
            <div class="settings-slider-container">
              <input type="range" class="settings-slider" id="audio-master" min="0" max="100" value="${s.masterVolume}" data-setting="audio.masterVolume">
              <span class="settings-slider-value" id="audio-master-value">${s.masterVolume}%</span>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Volume Levels</div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="audio-music-enabled" ${s.musicEnabled ? 'checked' : ''} data-setting="audio.musicEnabled">
              <label class="settings-checkbox-label" for="audio-music-enabled">Enable Music</label>
            </div>
            <div class="settings-group-label">Music Volume</div>
            <div class="settings-slider-container">
              <input type="range" class="settings-slider" id="audio-music" min="0" max="100" value="${s.musicVolume}" data-setting="audio.musicVolume">
              <span class="settings-slider-value" id="audio-music-value">${s.musicVolume}%</span>
            </div>
          </div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="audio-sfx-enabled" ${s.sfxEnabled ? 'checked' : ''} data-setting="audio.sfxEnabled">
              <label class="settings-checkbox-label" for="audio-sfx-enabled">Enable Sound Effects</label>
            </div>
            <div class="settings-group-label">Sound Effects Volume</div>
            <div class="settings-slider-container">
              <input type="range" class="settings-slider" id="audio-sfx" min="0" max="100" value="${s.sfxVolume}" data-setting="audio.sfxVolume">
              <span class="settings-slider-value" id="audio-sfx-value">${s.sfxVolume}%</span>
            </div>
          </div>

          <div class="settings-group">
            <div class="settings-group-label">UI Sound Volume</div>
            <div class="settings-slider-container">
              <input type="range" class="settings-slider" id="audio-ui" min="0" max="100" value="${s.uiVolume}" data-setting="audio.uiVolume">
              <span class="settings-slider-value" id="audio-ui-value">${s.uiVolume}%</span>
            </div>
          </div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="audio-ambient-enabled" ${s.ambientEnabled ? 'checked' : ''} data-setting="audio.ambientEnabled">
              <label class="settings-checkbox-label" for="audio-ambient-enabled">Enable Ambient Sounds</label>
            </div>
            <div class="settings-group-description">Background environmental sounds like wind, birds, etc.</div>
          </div>
        </div>
      </div>
    `;
  }

  renderDisplayPanel() {
    const s = this.settings.display;
    return `
      <div class="settings-panel" id="panel-display">
        <div class="settings-panel-title">Display Settings</div>

        <div class="settings-section">
          <div class="settings-section-title">Animation</div>

          <div class="settings-group">
            <div class="settings-group-label">Animation Speed</div>
            <div class="settings-group-description">Controls the speed of battle animations and effects.</div>
            <div class="settings-radio-group" data-setting="display.animationSpeed">
              <div class="settings-radio-option ${s.animationSpeed === 'slow' ? 'selected' : ''}" data-value="slow">
                <span class="settings-radio-label">Slow</span>
              </div>
              <div class="settings-radio-option ${s.animationSpeed === 'normal' ? 'selected' : ''}" data-value="normal">
                <span class="settings-radio-label">Normal</span>
              </div>
              <div class="settings-radio-option ${s.animationSpeed === 'fast' ? 'selected' : ''}" data-value="fast">
                <span class="settings-radio-label">Fast</span>
              </div>
            </div>
          </div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="display-floating-text" ${s.showFloatingText ? 'checked' : ''} data-setting="display.showFloatingText">
              <label class="settings-checkbox-label" for="display-floating-text">Show Floating Combat Text</label>
            </div>
          </div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="display-screen-shake" ${s.screenShake ? 'checked' : ''} data-setting="display.screenShake">
              <label class="settings-checkbox-label" for="display-screen-shake">Enable Screen Shake Effects</label>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Quality</div>

          <div class="settings-group">
            <div class="settings-group-label">Particle Quality</div>
            <div class="settings-group-description">Quality level for particle effects. Lower settings may improve performance.</div>
            <div class="settings-radio-group" data-setting="display.particleQuality">
              <div class="settings-radio-option ${s.particleQuality === 'low' ? 'selected' : ''}" data-value="low">
                <span class="settings-radio-label">Low</span>
              </div>
              <div class="settings-radio-option ${s.particleQuality === 'medium' ? 'selected' : ''}" data-value="medium">
                <span class="settings-radio-label">Medium</span>
              </div>
              <div class="settings-radio-option ${s.particleQuality === 'high' ? 'selected' : ''}" data-value="high">
                <span class="settings-radio-label">High</span>
              </div>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Scaling</div>

          <div class="settings-group">
            <div class="settings-group-label">Camera Zoom</div>
            <div class="settings-group-description">Zoom level for the battle camera.</div>
            <div class="settings-slider-container">
              <input type="range" class="settings-slider" id="display-camera-zoom" min="50" max="200" value="${Math.round(s.cameraZoom * 100)}" data-setting="display.cameraZoom" data-scale="0.01">
              <span class="settings-slider-value" id="display-camera-zoom-value">${Math.round(s.cameraZoom * 100)}%</span>
            </div>
          </div>

          <div class="settings-group">
            <div class="settings-group-label">UI Scale</div>
            <div class="settings-group-description">Scale of the user interface elements.</div>
            <div class="settings-slider-container">
              <input type="range" class="settings-slider" id="display-ui-scale" min="75" max="150" value="${Math.round(s.uiScale * 100)}" data-setting="display.uiScale" data-scale="0.01">
              <span class="settings-slider-value" id="display-ui-scale-value">${Math.round(s.uiScale * 100)}%</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderAccessibilityPanel() {
    const s = this.settings.accessibility;
    return `
      <div class="settings-panel" id="panel-accessibility">
        <div class="settings-panel-title">Accessibility Settings</div>

        <div class="settings-section">
          <div class="settings-section-title">Visual</div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="accessibility-high-contrast" ${s.highContrast ? 'checked' : ''} data-setting="accessibility.highContrast">
              <label class="settings-checkbox-label" for="accessibility-high-contrast">High Contrast Mode</label>
            </div>
            <div class="settings-group-description">Increases contrast for better visibility.</div>
          </div>

          <div class="settings-group">
            <div class="settings-group-label">Color Blind Mode</div>
            <div class="settings-group-description">Adjust colors to accommodate color vision deficiencies.</div>
            <div class="settings-radio-group" data-setting="accessibility.colorBlindMode">
              <div class="settings-radio-option ${s.colorBlindMode === 'none' ? 'selected' : ''}" data-value="none">
                <span class="settings-radio-label">None</span>
              </div>
              <div class="settings-radio-option ${s.colorBlindMode === 'protanopia' ? 'selected' : ''}" data-value="protanopia">
                <span class="settings-radio-label">Protanopia</span>
              </div>
              <div class="settings-radio-option ${s.colorBlindMode === 'deuteranopia' ? 'selected' : ''}" data-value="deuteranopia">
                <span class="settings-radio-label">Deuteranopia</span>
              </div>
              <div class="settings-radio-option ${s.colorBlindMode === 'tritanopia' ? 'selected' : ''}" data-value="tritanopia">
                <span class="settings-radio-label">Tritanopia</span>
              </div>
            </div>
          </div>

          <div class="settings-group">
            <div class="settings-group-label">Cursor Size</div>
            <div class="settings-radio-group" data-setting="accessibility.cursorSize">
              <div class="settings-radio-option ${s.cursorSize === 'small' ? 'selected' : ''}" data-value="small">
                <span class="settings-radio-label">Small</span>
              </div>
              <div class="settings-radio-option ${s.cursorSize === 'normal' ? 'selected' : ''}" data-value="normal">
                <span class="settings-radio-label">Normal</span>
              </div>
              <div class="settings-radio-option ${s.cursorSize === 'large' ? 'selected' : ''}" data-value="large">
                <span class="settings-radio-label">Large</span>
              </div>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Motion</div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="accessibility-reduced-motion" ${s.reducedMotion ? 'checked' : ''} data-setting="accessibility.reducedMotion">
              <label class="settings-checkbox-label" for="accessibility-reduced-motion">Reduced Motion</label>
            </div>
            <div class="settings-group-description">Minimizes animations and visual effects throughout the game.</div>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Text</div>

          <div class="settings-group">
            <div class="settings-group-label">Text Size</div>
            <div class="settings-group-description">Adjusts the size of text throughout the game.</div>
            <div class="settings-radio-group" data-setting="accessibility.textSize">
              <div class="settings-radio-option ${s.textSize === 'small' ? 'selected' : ''}" data-value="small">
                <span class="settings-radio-label">Small</span>
              </div>
              <div class="settings-radio-option ${s.textSize === 'medium' ? 'selected' : ''}" data-value="medium">
                <span class="settings-radio-label">Medium</span>
              </div>
              <div class="settings-radio-option ${s.textSize === 'large' ? 'selected' : ''}" data-value="large">
                <span class="settings-radio-label">Large</span>
              </div>
            </div>
          </div>

          <div class="settings-group">
            <div class="settings-group-label">Font Family</div>
            <div class="settings-group-description">Choose a font that works best for you.</div>
            <div class="settings-radio-group" data-setting="accessibility.fontFamily">
              <div class="settings-radio-option ${s.fontFamily === 'default' ? 'selected' : ''}" data-value="default">
                <span class="settings-radio-label">Default</span>
              </div>
              <div class="settings-radio-option ${s.fontFamily === 'dyslexic' ? 'selected' : ''}" data-value="dyslexic">
                <span class="settings-radio-label">Dyslexia-Friendly</span>
              </div>
              <div class="settings-radio-option ${s.fontFamily === 'monospace' ? 'selected' : ''}" data-value="monospace">
                <span class="settings-radio-label">Monospace</span>
              </div>
            </div>
          </div>

          <div class="settings-group">
            <div class="settings-group-label">Line Spacing</div>
            <div class="settings-radio-group" data-setting="accessibility.lineSpacing">
              <div class="settings-radio-option ${s.lineSpacing === 'compact' ? 'selected' : ''}" data-value="compact">
                <span class="settings-radio-label">Compact</span>
              </div>
              <div class="settings-radio-option ${s.lineSpacing === 'normal' ? 'selected' : ''}" data-value="normal">
                <span class="settings-radio-label">Normal</span>
              </div>
              <div class="settings-radio-option ${s.lineSpacing === 'relaxed' ? 'selected' : ''}" data-value="relaxed">
                <span class="settings-radio-label">Relaxed</span>
              </div>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Assistive</div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="accessibility-screen-reader" ${s.screenReaderHints ? 'checked' : ''} data-setting="accessibility.screenReaderHints">
              <label class="settings-checkbox-label" for="accessibility-screen-reader">Enable Screen Reader Hints</label>
            </div>
            <div class="settings-group-description">Add additional ARIA labels and announcements for screen readers.</div>
          </div>
        </div>
      </div>
    `;
  }

  renderGameplayPanel() {
    const s = this.settings.gameplay;
    return `
      <div class="settings-panel" id="panel-gameplay">
        <div class="settings-panel-title">Gameplay Settings</div>

        <div class="settings-section">
          <div class="settings-section-title">Progress</div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="gameplay-autosave" ${s.autoSave ? 'checked' : ''} data-setting="gameplay.autoSave">
              <label class="settings-checkbox-label" for="gameplay-autosave">Enable Auto-Save</label>
            </div>
            <div class="settings-group-description">Automatically save your progress at key moments.</div>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Navigation</div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="gameplay-confirm-travel" ${s.confirmTravel ? 'checked' : ''} data-setting="gameplay.confirmTravel">
              <label class="settings-checkbox-label" for="gameplay-confirm-travel">Confirm Before Traveling</label>
            </div>
            <div class="settings-group-description">Show a confirmation dialog before traveling to a new location.</div>
          </div>

          <div class="settings-group">
            <div class="settings-group-label">Quest Marker Style</div>
            <div class="settings-group-description">How quest objectives are displayed on the map.</div>
            <div class="settings-radio-group" data-setting="gameplay.questMarkerStyle">
              <div class="settings-radio-option ${s.questMarkerStyle === 'icon' ? 'selected' : ''}" data-value="icon">
                <span class="settings-radio-label">Icon Only</span>
              </div>
              <div class="settings-radio-option ${s.questMarkerStyle === 'arrow' ? 'selected' : ''}" data-value="arrow">
                <span class="settings-radio-label">Arrow Only</span>
              </div>
              <div class="settings-radio-option ${s.questMarkerStyle === 'both' ? 'selected' : ''}" data-value="both">
                <span class="settings-radio-label">Both</span>
              </div>
              <div class="settings-radio-option ${s.questMarkerStyle === 'none' ? 'selected' : ''}" data-value="none">
                <span class="settings-radio-label">None</span>
              </div>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Help</div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="gameplay-tutorial" ${s.showTutorialHints ? 'checked' : ''} data-setting="gameplay.showTutorialHints">
              <label class="settings-checkbox-label" for="gameplay-tutorial">Show Tutorial Hints</label>
            </div>
            <div class="settings-group-description">Display helpful tips and tutorials for new features.</div>
          </div>
        </div>
      </div>
    `;
  }

  renderControlsPanel() {
    const s = this.settings.controls;
    const keybinds = this.getKeybindsForScheme(s.keybindScheme);

    return `
      <div class="settings-panel" id="panel-controls">
        <div class="settings-panel-title">Control Settings</div>

        <div class="settings-section">
          <div class="settings-section-title">Keyboard</div>

          <div class="settings-group">
            <div class="settings-group-label">Keybind Scheme</div>
            <div class="settings-group-description">Choose a preset keyboard layout for game controls.</div>
            <div class="settings-radio-group" data-setting="controls.keybindScheme">
              <div class="settings-radio-option ${s.keybindScheme === 'wasd' ? 'selected' : ''}" data-value="wasd">
                <span class="settings-radio-label">WASD</span>
              </div>
              <div class="settings-radio-option ${s.keybindScheme === 'arrows' ? 'selected' : ''}" data-value="arrows">
                <span class="settings-radio-label">Arrow Keys</span>
              </div>
              <div class="settings-radio-option ${s.keybindScheme === 'vim' ? 'selected' : ''}" data-value="vim">
                <span class="settings-radio-label">Vim (HJKL)</span>
              </div>
              <div class="settings-radio-option ${s.keybindScheme === 'custom' ? 'selected' : ''}" data-value="custom">
                <span class="settings-radio-label">Custom</span>
              </div>
            </div>

            <div class="keybind-preview" id="keybind-preview">
              <div class="keybind-item">
                <span class="keybind-action">Move Up</span>
                <span class="keybind-key">${keybinds.up}</span>
              </div>
              <div class="keybind-item">
                <span class="keybind-action">Move Down</span>
                <span class="keybind-key">${keybinds.down}</span>
              </div>
              <div class="keybind-item">
                <span class="keybind-action">Move Left</span>
                <span class="keybind-key">${keybinds.left}</span>
              </div>
              <div class="keybind-item">
                <span class="keybind-action">Move Right</span>
                <span class="keybind-key">${keybinds.right}</span>
              </div>
              <div class="keybind-item">
                <span class="keybind-action">Confirm</span>
                <span class="keybind-key">${keybinds.confirm}</span>
              </div>
              <div class="keybind-item">
                <span class="keybind-action">Cancel</span>
                <span class="keybind-key">${keybinds.cancel}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Touch Controls</div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="controls-touch" ${s.touchGesturesEnabled ? 'checked' : ''} data-setting="controls.touchGesturesEnabled">
              <label class="settings-checkbox-label" for="controls-touch">Enable Touch Gestures</label>
            </div>
            <div class="settings-group-description">Enable swipe and tap gestures for touch devices.</div>
          </div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="controls-double-tap" ${s.doubleTapConfirm ? 'checked' : ''} data-setting="controls.doubleTapConfirm">
              <label class="settings-checkbox-label" for="controls-double-tap">Double-Tap to Confirm</label>
            </div>
            <div class="settings-group-description">Require double-tap to confirm important actions on touch devices.</div>
          </div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="controls-hold-cancel" ${s.holdToCancel ? 'checked' : ''} data-setting="controls.holdToCancel">
              <label class="settings-checkbox-label" for="controls-hold-cancel">Hold to Cancel</label>
            </div>
            <div class="settings-group-description">Hold an action to cancel it instead of tapping elsewhere.</div>
          </div>
        </div>
      </div>
    `;
  }

  renderSocialPanel() {
    const s = this.settings.social;
    return `
      <div class="settings-panel" id="panel-social">
        <div class="settings-panel-title">Social Settings</div>

        <div class="settings-section">
          <div class="settings-section-title">Privacy</div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="social-online-status" ${s.showOnlineStatus ? 'checked' : ''} data-setting="social.showOnlineStatus">
              <label class="settings-checkbox-label" for="social-online-status">Show Online Status</label>
            </div>
            <div class="settings-group-description">Allow others to see when you are online.</div>
          </div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="social-party-invites" ${s.allowPartyInvites ? 'checked' : ''} data-setting="social.allowPartyInvites">
              <label class="settings-checkbox-label" for="social-party-invites">Allow Party Invitations</label>
            </div>
            <div class="settings-group-description">Receive party invitations from other players.</div>
          </div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="social-friend-requests" ${s.allowFriendRequests ? 'checked' : ''} data-setting="social.allowFriendRequests">
              <label class="settings-checkbox-label" for="social-friend-requests">Allow Friend Requests</label>
            </div>
            <div class="settings-group-description">Receive friend requests from other players.</div>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Chat</div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="social-timestamps" ${s.chatTimestamps ? 'checked' : ''} data-setting="social.chatTimestamps">
              <label class="settings-checkbox-label" for="social-timestamps">Show Chat Timestamps</label>
            </div>
            <div class="settings-group-description">Display timestamps next to chat messages.</div>
          </div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="social-profanity" ${s.profanityFilter ? 'checked' : ''} data-setting="social.profanityFilter">
              <label class="settings-checkbox-label" for="social-profanity">Enable Profanity Filter</label>
            </div>
            <div class="settings-group-description">Filter inappropriate language in chat messages.</div>
          </div>
        </div>
      </div>
    `;
  }

  getKeybindsForScheme(scheme) {
    const schemes = {
      wasd: { up: 'W', down: 'S', left: 'A', right: 'D', confirm: 'E', cancel: 'Q' },
      arrows: { up: 'Up', down: 'Down', left: 'Left', right: 'Right', confirm: 'Enter', cancel: 'Esc' },
      vim: { up: 'K', down: 'J', left: 'H', right: 'L', confirm: 'Enter', cancel: 'Esc' },
      custom: { up: '?', down: '?', left: '?', right: '?', confirm: '?', cancel: '?' }
    };
    return schemes[scheme] || schemes.wasd;
  }

  setupEventListeners() {
    this.abortController = new AbortController();
    const opts = { signal: this.abortController.signal };

    // Tab switching
    this.uiElement.querySelectorAll('.settings-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.switchTab(tab.dataset.tab);
      }, opts);
    });

    // Radio groups
    this.uiElement.querySelectorAll('.settings-radio-group').forEach(group => {
      const settingPath = group.dataset.setting;
      group.querySelectorAll('.settings-radio-option').forEach(option => {
        option.addEventListener('click', () => {
          this.setRadioValue(group, settingPath, option.dataset.value);

          // Update keybind preview if scheme changed
          if (settingPath === 'controls.keybindScheme') {
            this.updateKeybindPreview(option.dataset.value);
          }
        }, opts);
      });
    });

    // Checkboxes
    this.uiElement.querySelectorAll('.settings-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', () => {
        this.setSettingValue(checkbox.dataset.setting, checkbox.checked);
      }, opts);
    });

    // Sliders
    this.uiElement.querySelectorAll('.settings-slider').forEach(slider => {
      slider.addEventListener('input', () => {
        const value = parseInt(slider.value, 10);
        const scale = slider.dataset.scale ? parseFloat(slider.dataset.scale) : 1;

        // Apply scale factor for fractional values (e.g., zoom: 100 -> 1.0)
        const settingValue = scale !== 1 ? value * scale : value;
        this.setSettingValue(slider.dataset.setting, settingValue);

        // Update display
        const valueEl = this.uiElement.querySelector(`#${slider.id}-value`);
        if (valueEl) valueEl.textContent = `${value}%`;
      }, opts);
    });

    // Buttons
    this.uiElement.querySelector('#cancel-btn')?.addEventListener('click', () => {
      this.handleCancel();
    }, opts);

    this.uiElement.querySelector('#save-btn')?.addEventListener('click', () => {
      this.handleSave();
    }, opts);

    this.uiElement.querySelector('#reset-btn')?.addEventListener('click', () => {
      this.handleReset();
    }, opts);
  }

  switchTab(tab) {
    this.activeTab = tab;

    // Update tabs
    this.uiElement.querySelectorAll('.settings-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });

    // Update panels
    this.uiElement.querySelectorAll('.settings-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `panel-${tab}`);
    });
  }

  setRadioValue(group, settingPath, value) {
    // Update UI
    group.querySelectorAll('.settings-radio-option').forEach(opt => {
      opt.classList.toggle('selected', opt.dataset.value === value);
    });

    // Update settings
    this.setSettingValue(settingPath, value);
  }

  setSettingValue(path, value) {
    const parts = path.split('.');
    let obj = this.settings;

    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]]) obj[parts[i]] = {};
      obj = obj[parts[i]];
    }

    obj[parts[parts.length - 1]] = value;
    this.updateChangesIndicator();
  }

  updateChangesIndicator() {
    this.hasChanges = JSON.stringify(this.settings) !== JSON.stringify(this.originalSettings);
    const indicator = this.uiElement.querySelector('#unsaved-indicator');
    if (indicator) {
      indicator.classList.toggle('visible', this.hasChanges);
    }
  }

  updateKeybindPreview(scheme) {
    const keybinds = this.getKeybindsForScheme(scheme);
    const preview = this.uiElement.querySelector('#keybind-preview');
    if (!preview) return;

    preview.innerHTML = `
      <div class="keybind-item">
        <span class="keybind-action">Move Up</span>
        <span class="keybind-key">${keybinds.up}</span>
      </div>
      <div class="keybind-item">
        <span class="keybind-action">Move Down</span>
        <span class="keybind-key">${keybinds.down}</span>
      </div>
      <div class="keybind-item">
        <span class="keybind-action">Move Left</span>
        <span class="keybind-key">${keybinds.left}</span>
      </div>
      <div class="keybind-item">
        <span class="keybind-action">Move Right</span>
        <span class="keybind-key">${keybinds.right}</span>
      </div>
      <div class="keybind-item">
        <span class="keybind-action">Confirm</span>
        <span class="keybind-key">${keybinds.confirm}</span>
      </div>
      <div class="keybind-item">
        <span class="keybind-action">Cancel</span>
        <span class="keybind-key">${keybinds.cancel}</span>
      </div>
    `;
  }

  handleCancel() {
    if (this.hasChanges) {
      // Restore original settings
      this.settings = JSON.parse(JSON.stringify(this.originalSettings));
    }
    this.game.scenes.switchTo('worldMap');
  }

  async handleSave() {
    try {
      await this.game.api.updateSettings(this.settings);
      this.originalSettings = JSON.parse(JSON.stringify(this.settings));
      this.hasChanges = false;

      // Apply settings locally
      this.game.state.set('settings', this.settings);

      // Apply accessibility settings immediately
      this.applyAccessibilitySettings();

      this.game.toast?.success('Settings Saved', 'Your settings have been saved successfully.');
      this.game.scenes.switchTo('worldMap');
    } catch (err) {
      console.error('Failed to save settings:', err);
      this.game.toast?.error('Save Failed', 'Failed to save settings. Please try again.');
    }
  }

  async handleReset() {
    // Reset to default values
    this.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

    // Rebuild UI to reflect changes
    this.uiElement.remove();
    this.createUI();
    this.setupEventListeners();

    this.updateChangesIndicator();
    this.game.toast?.info('Settings Reset', 'Settings reset to defaults. Click Save to apply.');
  }

  /**
   * Apply accessibility settings to the game
   */
  applyAccessibilitySettings() {
    const accessibility = this.settings.accessibility;

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

    // Notify game of reduced motion preference
    if (this.game.state) {
      this.game.state.set('reducedMotion', accessibility.reducedMotion);
    }
  }

  applyColorBlindFilter(mode) {
    // Remove existing filter
    let filterSvg = document.getElementById('colorblind-filters');

    if (mode === 'none') {
      this.game.canvas.style.filter = 'none';
      return;
    }

    // Create SVG filters if not present
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

    this.game.canvas.style.filter = filterMap[mode] || 'none';
  }

  applyTextSize(size) {
    const sizeMap = {
      small: '12px',
      medium: '14px',
      large: '18px'
    };

    document.documentElement.style.setProperty('--game-text-size', sizeMap[size] || '14px');
  }

  applyFontFamily(family) {
    const fontMap = {
      default: 'Georgia, serif',
      dyslexic: 'OpenDyslexic, Comic Sans MS, sans-serif',
      monospace: 'Consolas, Monaco, monospace'
    };

    document.documentElement.style.setProperty('--game-font-family', fontMap[family] || fontMap.default);
  }

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
    // Delegate to Game.js implementation for consistency
    if (this.game.applyHighContrast) {
      this.game.applyHighContrast(enabled);
    }
  }

  /**
   * Apply cursor size setting
   * Changes the cursor size via CSS
   * @param {string} size - 'small', 'normal', 'large'
   */
  applyCursorSize(size) {
    // Delegate to Game.js implementation for consistency
    if (this.game.applyCursorSize) {
      this.game.applyCursorSize(size);
    }
  }

  /**
   * Apply screen reader hints setting
   * Adds aria-live regions and enhanced ARIA labels when enabled
   * @param {boolean} enabled - Whether screen reader hints are enabled
   */
  applyScreenReaderHints(enabled) {
    // Delegate to Game.js implementation for consistency
    if (this.game.applyScreenReaderHints) {
      this.game.applyScreenReaderHints(enabled);
    }
  }

  update(_deltaTime) {
    // No per-frame updates needed
  }

  render(ctx) {
    ctx.fillStyle = P.light;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
}
