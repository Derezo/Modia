/**
 * @module SettingsScene
 * @description Full-screen settings configuration scene.
 *
 * Key responsibilities:
 * - Orchestrate settings UI with tabs and panels
 * - Handle user interactions and events
 * - Coordinate state management and persistence
 * - Apply settings changes to the game
 *
 * @see SettingsPanelRenderer.js - Panel rendering
 * @see SettingsStateManager.js - State and persistence
 * @see SettingsAccessibility.js - Accessibility feature application
 */

import { Scene } from './Scene.js';
import { PARCHMENT_COLORS, injectParchmentTheme } from '../ui/parchment/index.js';
import { FeedbackModal } from '../modals/FeedbackModal.js';
import {
  SettingsPanelRenderer,
  SettingsStateManager,
  SettingsAccessibility
} from '../settings/index.js';

// Shorthand for colors in CSS template
const P = PARCHMENT_COLORS;

/**
 * SettingsScene - Full-screen settings configuration
 * Features: tabs - Battle, Audio, Display, Accessibility, Gameplay, Social, Developer, Help
 * Note: Developer tab is only shown in development mode (localhost)
 */
export class SettingsScene extends Scene {
  constructor(game) {
    super(game);
    this.uiElement = null;
    this.abortController = null;

    // State
    this.activeTab = 'battle';
    this.loading = false;

    // SECURITY: Developer options are only available in development mode
    // This matches the backend security in settings.js and debug.js
    this.isDevelopment = window.location.hostname === 'localhost' ||
                         window.location.hostname === '127.0.0.1';

    // Module instances (initialized in enter())
    this.stateManager = null;
    this.panelRenderer = null;
    this.accessibility = null;
    this.feedbackModal = null;
  }

  async enter(_data = {}) {
    try {
      // Initialize modules
      this.stateManager = new SettingsStateManager(this.game.api);
      this.accessibility = new SettingsAccessibility(this.game);

      this.addStyles();
      await this.stateManager.loadSettings();

      // Initialize panel renderer with loaded settings
      this.panelRenderer = new SettingsPanelRenderer(
        this.stateManager.getSettings(),
        this.isDevelopment
      );

      this.createUI();
      this.setupEventListeners();
    } catch (err) {
      console.error('Failed to enter SettingsScene:', err);
      // Show error UI
      this.game.toast?.error('Settings Error', 'Failed to load settings. Please try again.');
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
    if (this.feedbackModal) {
      this.feedbackModal.destroy();
      this.feedbackModal = null;
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
        color: var(--parchment-warning);
        font-style: italic;
      }

      .unsaved-indicator.visible {
        display: flex;
      }

      /* Disabled state for developer settings */
      .settings-section.disabled {
        opacity: 0.5;
        pointer-events: none;
      }

      .settings-section.disabled .settings-checkbox {
        cursor: not-allowed;
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
          <button class="settings-tab" data-tab="social">
            <span class="settings-tab-icon">&#128101;</span>
            <span class="settings-tab-label">Social</span>
          </button>
          ${this.isDevelopment ? `
          <button class="settings-tab" data-tab="developer">
            <span class="settings-tab-icon">&#128295;</span>
            <span class="settings-tab-label">Developer</span>
          </button>
          ` : ''}
          <button class="settings-tab" data-tab="help">
            <span class="settings-tab-icon">&#10068;</span>
            <span class="settings-tab-label">Help</span>
          </button>
        </div>

        <div class="settings-main">
          ${this.panelRenderer.renderBattlePanel()}
          ${this.panelRenderer.renderAudioPanel()}
          ${this.panelRenderer.renderDisplayPanel()}
          ${this.panelRenderer.renderAccessibilityPanel()}
          ${this.panelRenderer.renderGameplayPanel()}
          ${this.panelRenderer.renderSocialPanel()}
          ${this.isDevelopment ? this.panelRenderer.renderDeveloperPanel() : ''}
          ${this.panelRenderer.renderHelpPanel()}
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
        this.game.audio?.playUI('button_click');
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
        this.stateManager.setSettingValue(checkbox.dataset.setting, checkbox.checked);
        this.updateChangesIndicator();

        // Handle developer.enabled toggle - update disabled state of other developer settings
        if (checkbox.dataset.setting === 'developer.enabled') {
          this.updateDeveloperSectionsDisabledState(checkbox.checked);
        }
      }, opts);
    });

    // Sliders
    this.uiElement.querySelectorAll('.settings-slider').forEach(slider => {
      slider.addEventListener('input', () => {
        const value = parseInt(slider.value, 10);
        const scale = slider.dataset.scale ? parseFloat(slider.dataset.scale) : 1;

        // Apply scale factor for fractional values (e.g., zoom: 100 -> 1.0)
        const settingValue = scale !== 1 ? value * scale : value;
        this.stateManager.setSettingValue(slider.dataset.setting, settingValue);
        this.updateChangesIndicator();

        // Update display
        const valueEl = this.uiElement.querySelector(`#${slider.id}-value`);
        if (valueEl) valueEl.textContent = `${value}%`;
      }, opts);
    });

    // Buttons
    this.uiElement.querySelector('#cancel-btn')?.addEventListener('click', () => {
      this.game.audio?.playUI('button_click');
      this.handleCancel();
    }, opts);

    this.uiElement.querySelector('#save-btn')?.addEventListener('click', () => {
      this.game.audio?.playUI('button_click');
      this.handleSave();
    }, opts);

    this.uiElement.querySelector('#reset-btn')?.addEventListener('click', () => {
      this.game.audio?.playUI('button_click');
      this.handleReset();
    }, opts);

    // Feedback button
    this.uiElement.querySelector('#feedback-btn')?.addEventListener('click', () => {
      this.game.audio?.playUI('button_click');
      this.openFeedbackModal();
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

  /**
   * Update the disabled state of developer settings sections
   * @param {boolean} enabled - Whether developer mode is enabled
   */
  updateDeveloperSectionsDisabledState(enabled) {
    const developerPanel = this.uiElement.querySelector('#panel-developer');
    if (!developerPanel) return;

    // Get all sections except the master toggle section
    const sections = developerPanel.querySelectorAll('.settings-section');
    sections.forEach((section, index) => {
      // Skip the first section (master toggle)
      if (index === 0) return;

      // Toggle disabled class
      section.classList.toggle('disabled', !enabled);

      // Toggle disabled attribute on checkboxes
      section.querySelectorAll('.settings-checkbox').forEach(checkbox => {
        checkbox.disabled = !enabled;
      });
    });
  }

  setRadioValue(group, settingPath, value) {
    // Update UI
    group.querySelectorAll('.settings-radio-option').forEach(opt => {
      opt.classList.toggle('selected', opt.dataset.value === value);
    });

    // Update settings
    this.stateManager.setSettingValue(settingPath, value);
    this.updateChangesIndicator();
  }

  updateChangesIndicator() {
    const indicator = this.uiElement.querySelector('#unsaved-indicator');
    if (indicator) {
      indicator.classList.toggle('visible', this.stateManager.hasUnsavedChanges());
    }
  }

  openFeedbackModal() {
    if (this.feedbackModal) return; // Prevent double-opening

    this.feedbackModal = new FeedbackModal({
      game: this.game,
      onClose: () => {
        this.feedbackModal?.destroy();
        this.feedbackModal = null;
      }
    });

    this.feedbackModal.show();
  }

  handleCancel() {
    this.stateManager.cancelChanges();
    this.game.scenes.switchTo('worldMap');
  }

  async handleSave() {
    try {
      await this.stateManager.saveSettings();

      // Apply settings locally
      this.game.state.set('userSettings', this.stateManager.getSettings());

      // Apply accessibility settings immediately
      this.accessibility.applyAll(this.stateManager.getSettings().accessibility);

      this.game.toast?.success('Settings Saved', 'Your settings have been saved successfully.');
      this.game.scenes.switchTo('worldMap');
    } catch (err) {
      console.error('Failed to save settings:', err);
      this.game.toast?.error('Save Failed', 'Failed to save settings. Please try again.');
    }
  }

  async handleReset() {
    // Reset to default values
    this.stateManager.resetToDefaults();

    // Update panel renderer with new settings
    this.panelRenderer.updateSettings(this.stateManager.getSettings());

    // Rebuild UI to reflect changes
    this.uiElement.remove();
    this.createUI();
    this.setupEventListeners();

    this.updateChangesIndicator();
    this.game.toast?.info('Settings Reset', 'Settings reset to defaults. Click Save to apply.');
  }

  update(_deltaTime) {
    // No per-frame updates needed
  }

  render(ctx) {
    ctx.fillStyle = P.light;
    ctx.fillRect(0, 0, this.game.targetWidth, this.game.targetHeight);
  }
}
