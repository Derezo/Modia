import { Scene } from './Scene.js';
import { PARCHMENT_COLORS, injectParchmentTheme } from '../ui/parchment/index.js';

// Shorthand for colors in CSS template
const P = PARCHMENT_COLORS;

/**
 * SettingsScene - Full-screen settings configuration
 * Features: Battle, Audio, Display, Accessibility tabs
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

  async enter(data = {}) {
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
        color: var(--parchment-gold);
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
        color: var(--parchment-gold);
        border-color: var(--parchment-gold);
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
        color: var(--parchment-gold);
        margin-bottom: var(--parchment-spacing-lg);
        padding-bottom: var(--parchment-spacing-sm);
        border-bottom: 2px solid var(--parchment-border);
        text-shadow: 0 1px 0 var(--parchment-highlight);
      }

      .settings-group {
        margin-bottom: var(--parchment-spacing-xl);
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
        border-color: var(--parchment-gold);
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
        accent-color: var(--parchment-gold);
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
        background: linear-gradient(to bottom, var(--parchment-gold) 0%, ${P.copper} 100%);
        border: 2px solid var(--parchment-border-dark);
        cursor: pointer;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      }

      .settings-slider::-moz-range-thumb {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: linear-gradient(to bottom, var(--parchment-gold) 0%, ${P.copper} 100%);
        border: 2px solid var(--parchment-border-dark);
        cursor: pointer;
      }

      .settings-slider-value {
        min-width: 40px;
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
        border-color: var(--parchment-gold);
        background: linear-gradient(to bottom, var(--parchment-text-inverse) 0%, var(--parchment-light) 100%);
      }

      .settings-radio-option.selected .settings-radio-label {
        color: var(--parchment-gold);
      }

      .settings-radio-label {
        font-size: 13px;
        font-weight: bold;
        color: var(--parchment-text-secondary);
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
      }
    `;
    document.head.appendChild(style);
  }

  async loadSettings() {
    try {
      const result = await this.game.api.getSettings();
      this.settings = result.settings;
      this.originalSettings = JSON.parse(JSON.stringify(this.settings));
    } catch (err) {
      console.error('Failed to load settings:', err);
      // Use defaults
      this.settings = {
        battle: { actionMenuStyle: 'radial' },
        audio: { masterVolume: 80, musicVolume: 70, sfxVolume: 80, muted: false },
        display: { animationSpeed: 'normal', showDamageNumbers: true, showBattleGrid: true },
        accessibility: { highContrast: false, reducedMotion: false, textSize: 'medium' }
      };
      this.originalSettings = JSON.parse(JSON.stringify(this.settings));
    }
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
        </div>

        <div class="settings-main">
          <!-- Battle Panel -->
          <div class="settings-panel active" id="panel-battle">
            <div class="settings-panel-title">Battle Settings</div>

            <div class="settings-group">
              <div class="settings-group-label">Action Menu Style</div>
              <div class="settings-group-description">Choose how you want to select actions during combat.</div>
              <div class="settings-radio-group" data-setting="battle.actionMenuStyle">
                <div class="settings-radio-option ${this.settings.battle?.actionMenuStyle === 'radial' ? 'selected' : ''}" data-value="radial">
                  <span class="settings-radio-label">Radial Menu</span>
                </div>
                <div class="settings-radio-option ${this.settings.battle?.actionMenuStyle === 'context' ? 'selected' : ''}" data-value="context">
                  <span class="settings-radio-label">Context Menu</span>
                </div>
                <div class="settings-radio-option ${this.settings.battle?.actionMenuStyle === 'actionbar' ? 'selected' : ''}" data-value="actionbar">
                  <span class="settings-radio-label">Action Bar</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Audio Panel -->
          <div class="settings-panel" id="panel-audio">
            <div class="settings-panel-title">Audio Settings</div>

            <div class="settings-group">
              <div class="settings-checkbox-group">
                <input type="checkbox" class="settings-checkbox" id="audio-muted" ${this.settings.audio?.muted ? 'checked' : ''} data-setting="audio.muted">
                <label class="settings-checkbox-label" for="audio-muted">Mute All Audio</label>
              </div>
            </div>

            <div class="settings-group">
              <div class="settings-group-label">Master Volume</div>
              <div class="settings-slider-container">
                <input type="range" class="settings-slider" id="audio-master" min="0" max="100" value="${this.settings.audio?.masterVolume ?? 80}" data-setting="audio.masterVolume">
                <span class="settings-slider-value" id="audio-master-value">${this.settings.audio?.masterVolume ?? 80}%</span>
              </div>
            </div>

            <div class="settings-group">
              <div class="settings-group-label">Music Volume</div>
              <div class="settings-slider-container">
                <input type="range" class="settings-slider" id="audio-music" min="0" max="100" value="${this.settings.audio?.musicVolume ?? 70}" data-setting="audio.musicVolume">
                <span class="settings-slider-value" id="audio-music-value">${this.settings.audio?.musicVolume ?? 70}%</span>
              </div>
            </div>

            <div class="settings-group">
              <div class="settings-group-label">Sound Effects Volume</div>
              <div class="settings-slider-container">
                <input type="range" class="settings-slider" id="audio-sfx" min="0" max="100" value="${this.settings.audio?.sfxVolume ?? 80}" data-setting="audio.sfxVolume">
                <span class="settings-slider-value" id="audio-sfx-value">${this.settings.audio?.sfxVolume ?? 80}%</span>
              </div>
            </div>
          </div>

          <!-- Display Panel -->
          <div class="settings-panel" id="panel-display">
            <div class="settings-panel-title">Display Settings</div>

            <div class="settings-group">
              <div class="settings-group-label">Animation Speed</div>
              <div class="settings-group-description">Controls the speed of battle animations and effects.</div>
              <div class="settings-radio-group" data-setting="display.animationSpeed">
                <div class="settings-radio-option ${this.settings.display?.animationSpeed === 'slow' ? 'selected' : ''}" data-value="slow">
                  <span class="settings-radio-label">Slow</span>
                </div>
                <div class="settings-radio-option ${this.settings.display?.animationSpeed === 'normal' ? 'selected' : ''}" data-value="normal">
                  <span class="settings-radio-label">Normal</span>
                </div>
                <div class="settings-radio-option ${this.settings.display?.animationSpeed === 'fast' ? 'selected' : ''}" data-value="fast">
                  <span class="settings-radio-label">Fast</span>
                </div>
              </div>
            </div>

            <div class="settings-group">
              <div class="settings-checkbox-group">
                <input type="checkbox" class="settings-checkbox" id="display-damage-numbers" ${this.settings.display?.showDamageNumbers ? 'checked' : ''} data-setting="display.showDamageNumbers">
                <label class="settings-checkbox-label" for="display-damage-numbers">Show Damage Numbers</label>
              </div>
            </div>

            <div class="settings-group">
              <div class="settings-checkbox-group">
                <input type="checkbox" class="settings-checkbox" id="display-battle-grid" ${this.settings.display?.showBattleGrid ? 'checked' : ''} data-setting="display.showBattleGrid">
                <label class="settings-checkbox-label" for="display-battle-grid">Show Battle Grid Lines</label>
              </div>
            </div>
          </div>

          <!-- Accessibility Panel -->
          <div class="settings-panel" id="panel-accessibility">
            <div class="settings-panel-title">Accessibility Settings</div>

            <div class="settings-group">
              <div class="settings-checkbox-group">
                <input type="checkbox" class="settings-checkbox" id="accessibility-high-contrast" ${this.settings.accessibility?.highContrast ? 'checked' : ''} data-setting="accessibility.highContrast">
                <label class="settings-checkbox-label" for="accessibility-high-contrast">High Contrast Mode</label>
              </div>
              <div class="settings-group-description">Increases contrast for better visibility.</div>
            </div>

            <div class="settings-group">
              <div class="settings-checkbox-group">
                <input type="checkbox" class="settings-checkbox" id="accessibility-reduced-motion" ${this.settings.accessibility?.reducedMotion ? 'checked' : ''} data-setting="accessibility.reducedMotion">
                <label class="settings-checkbox-label" for="accessibility-reduced-motion">Reduced Motion</label>
              </div>
              <div class="settings-group-description">Minimizes animations and visual effects.</div>
            </div>

            <div class="settings-group">
              <div class="settings-group-label">Text Size</div>
              <div class="settings-group-description">Adjusts the size of text throughout the game.</div>
              <div class="settings-radio-group" data-setting="accessibility.textSize">
                <div class="settings-radio-option ${this.settings.accessibility?.textSize === 'small' ? 'selected' : ''}" data-value="small">
                  <span class="settings-radio-label">Small</span>
                </div>
                <div class="settings-radio-option ${this.settings.accessibility?.textSize === 'medium' ? 'selected' : ''}" data-value="medium">
                  <span class="settings-radio-label">Medium</span>
                </div>
                <div class="settings-radio-option ${this.settings.accessibility?.textSize === 'large' ? 'selected' : ''}" data-value="large">
                  <span class="settings-radio-label">Large</span>
                </div>
              </div>
            </div>
          </div>
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
        this.setSettingValue(slider.dataset.setting, value);
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

      this.game.toastManager?.success('Settings', 'Settings saved successfully!');
      this.game.scenes.switchTo('worldMap');
    } catch (err) {
      console.error('Failed to save settings:', err);
      this.game.toastManager?.error('Settings', 'Failed to save settings.');
    }
  }

  async handleReset() {
    // Reset to default values
    this.settings = {
      battle: { actionMenuStyle: 'radial' },
      audio: { masterVolume: 80, musicVolume: 70, sfxVolume: 80, muted: false },
      display: { animationSpeed: 'normal', showDamageNumbers: true, showBattleGrid: true },
      accessibility: { highContrast: false, reducedMotion: false, textSize: 'medium' }
    };

    // Rebuild UI to reflect changes
    this.uiElement.remove();
    this.createUI();
    this.setupEventListeners();

    this.updateChangesIndicator();
    this.game.toastManager?.info('Settings', 'Settings reset to defaults. Click Save to apply.');
  }

  update(deltaTime) {
    // No per-frame updates needed
  }

  render(ctx) {
    ctx.fillStyle = P.light;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
}
