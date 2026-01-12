/**
 * SettingsModal - Game settings panel with tabbed layout
 * Uses parchment aesthetic from DESIGN_SYSTEM.md
 */
import { parchmentToast } from '../ui/parchment/ParchmentToast.js';

const ACTION_MENU_OPTIONS = [
  {
    value: 'radial',
    label: 'Radial Menu',
    description: 'Circular menu around your unit. Click and drag to select actions.'
  },
  {
    value: 'context',
    label: 'Context Menu',
    description: 'Traditional menu appearing at click location. Point and click to select.'
  },
  {
    value: 'actionbar',
    label: 'Action Bar',
    description: 'Fixed bar at bottom of screen. Always visible for quick access.'
  }
];

export default class SettingsModal {
  constructor(game) {
    this.game = game;
    this.element = null;
    this.abortController = null;
    this.currentSettings = null;
    this.pendingSettings = null;
    this.activeTab = 'battle';
    this.isVisible = false;
    this.onClose = null;
  }

  /**
   * Show the settings modal
   * @param {Object} options - { onClose }
   */
  async show(options = {}) {
    if (this.isVisible) return;

    this.onClose = options.onClose;
    this.isVisible = true;
    this.abortController = new AbortController();

    // Load current settings from game state
    this.currentSettings = this.game.state.get('userSettings') || {
      battle: { actionMenuStyle: 'radial' }
    };
    this.pendingSettings = JSON.parse(JSON.stringify(this.currentSettings));

    this.createModal();
    this.renderTabContent();

    // Animate in
    requestAnimationFrame(() => {
      this.element.classList.add('visible');
    });
  }

  /**
   * Create the modal DOM structure
   */
  createModal() {
    this.element = document.createElement('div');
    this.element.id = 'settings-modal';
    this.element.innerHTML = `
      <style>
        #settings-modal {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 300;
          opacity: 0;
          transition: opacity 0.2s ease-out;
        }
        #settings-modal.visible {
          opacity: 1;
        }
        .settings-container {
          background: linear-gradient(to bottom, #d4c4a8 0%, #c9b899 50%, #bfae8a 100%);
          border: 2px solid #8b7355;
          border-radius: 4px;
          box-shadow:
            0 8px 24px rgba(0, 0, 0, 0.4),
            inset 0 1px 0 rgba(255, 255, 255, 0.3),
            inset 0 -1px 0 rgba(0, 0, 0, 0.1);
          min-width: 450px;
          max-width: 550px;
          max-height: 80vh;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          font-family: 'Georgia', 'Times New Roman', serif;
          color: #2d2418;
        }

        /* Header */
        .settings-header {
          padding: 12px 16px;
          border-bottom: 2px solid #8b7355;
          background: linear-gradient(to bottom, #c9b899 0%, #bfae8a 100%);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .settings-title {
          font-size: 18px;
          font-weight: bold;
          margin: 0;
          text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
        }
        .settings-close {
          background: none;
          border: none;
          font-size: 24px;
          color: #5a4a3a;
          cursor: pointer;
          padding: 0 4px;
          line-height: 1;
        }
        .settings-close:hover {
          color: #2d2418;
        }

        /* Tabs */
        .settings-tabs {
          display: flex;
          gap: 4px;
          padding: 8px 12px 0;
          border-bottom: 2px solid #8b7355;
        }
        .settings-tab {
          padding: 8px 16px;
          background: linear-gradient(to bottom, #c9b899 0%, #bfae8a 100%);
          border: 2px solid #8b7355;
          border-bottom: none;
          border-radius: 4px 4px 0 0;
          font-family: 'Georgia', 'Times New Roman', serif;
          font-size: 13px;
          color: #5a4a3a;
          cursor: pointer;
          margin-bottom: -2px;
          transition: all 0.15s ease;
        }
        .settings-tab:hover:not(.active) {
          background: linear-gradient(to bottom, #d4c4a8 0%, #c9b899 50%, #bfae8a 100%);
        }
        .settings-tab.active {
          background: linear-gradient(to bottom, #d4c4a8 0%, #c9b899 100%);
          color: #2d2418;
          font-weight: bold;
        }

        /* Content */
        .settings-content {
          flex: 1;
          padding: 16px;
          overflow-y: auto;
        }
        .settings-section {
          margin-bottom: 20px;
        }
        .settings-section-title {
          font-size: 15px;
          font-weight: bold;
          margin-bottom: 12px;
          color: #2d2418;  /* Dark brown for readable section titles */
          text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
        }

        /* Radio Options */
        .settings-radio-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .settings-radio {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 10px 12px;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid transparent;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .settings-radio:hover {
          background: rgba(139, 115, 85, 0.15);
        }
        .settings-radio.selected {
          background: rgba(139, 115, 85, 0.25);
          border-color: #8b7355;
        }
        .settings-radio-circle {
          width: 18px;
          height: 18px;
          border: 2px solid #8b7355;
          border-radius: 50%;
          background: #f0e8d8;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          margin-top: 2px;
        }
        .settings-radio.selected .settings-radio-circle::after {
          content: '';
          width: 10px;
          height: 10px;
          background: #8b7355;
          border-radius: 50%;
        }
        .settings-radio-content {
          flex: 1;
        }
        .settings-radio-label {
          font-size: 14px;
          font-weight: bold;
          color: #2d2418;
          margin-bottom: 4px;
        }
        .settings-radio-description {
          font-size: 12px;
          color: #5a4a3a;
          line-height: 1.4;
        }

        /* Footer */
        .settings-footer {
          padding: 12px 16px;
          border-top: 2px solid #8b7355;
          background: linear-gradient(to bottom, #c9b899 0%, #bfae8a 100%);
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }
        .settings-btn {
          padding: 8px 20px;
          border: 2px solid #8b7355;
          border-radius: 4px;
          font-family: 'Georgia', 'Times New Roman', serif;
          font-size: 13px;
          font-weight: bold;
          cursor: pointer;
          transition: all 0.15s ease;
          text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
        }
        .settings-btn-cancel {
          background: linear-gradient(to bottom, #c9b899 0%, #bfae8a 100%);
          color: #2d2418;
        }
        .settings-btn-cancel:hover {
          background: linear-gradient(to bottom, #d4c4a8 0%, #c9b899 100%);
        }
        .settings-btn-save {
          background: linear-gradient(to bottom, #8b7355 0%, #7a6345 100%);
          color: #f0e8d8;
          border-color: #6b5344;
        }
        .settings-btn-save:hover {
          background: linear-gradient(to bottom, #9b8365 0%, #8a7355 100%);
        }
        .settings-btn:active {
          transform: translateY(1px);
        }

        /* Toggle Switch Styles */
        .settings-toggle {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid transparent;
          border-radius: 4px;
          margin-bottom: 8px;
        }
        .settings-toggle:hover {
          background: rgba(139, 115, 85, 0.15);
        }
        .settings-toggle-label {
          font-size: 14px;
          color: #2d2418;
        }
        .settings-toggle-switch {
          position: relative;
          width: 44px;
          height: 24px;
          background: #bfae8a;
          border: 2px solid #8b7355;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .settings-toggle-switch::after {
          content: '';
          position: absolute;
          top: 2px;
          left: 2px;
          width: 16px;
          height: 16px;
          background: #f0e8d8;
          border-radius: 50%;
          transition: transform 0.2s;
          box-shadow: 0 1px 2px rgba(0,0,0,0.2);
        }
        .settings-toggle-switch.active {
          background: #6b2d3d;  /* Burgundy accent for active state */
          border-color: #5a2433;
        }
        .settings-toggle-switch.active::after {
          transform: translateX(20px);
        }

        /* Text Input Styles */
        .settings-input {
          width: 100%;
          padding: 10px 12px;
          background: linear-gradient(to bottom, #f0e8d8 0%, #e8dcc8 100%);
          border: 2px solid #8b7355;
          border-radius: 4px;
          font-family: 'Georgia', 'Times New Roman', serif;
          font-size: 14px;
          color: #2d2418;
          box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);
        }
        .settings-input::placeholder {
          color: #7a6a5a;
        }
        .settings-input:focus {
          outline: none;
          border-color: #6b2d3d;  /* Burgundy accent for focus */
          box-shadow: inset 0 1px 3px rgba(0,0,0,0.1), 0 0 0 2px rgba(107, 45, 61, 0.2);
        }

        /* Select Dropdown Styles */
        .settings-select {
          width: 100%;
          padding: 10px 12px;
          background: linear-gradient(to bottom, #f0e8d8 0%, #e8dcc8 100%);
          border: 2px solid #8b7355;
          border-radius: 4px;
          font-family: 'Georgia', 'Times New Roman', serif;
          font-size: 14px;
          color: #2d2418;
          cursor: pointer;
        }
        .settings-select:focus {
          outline: none;
          border-color: #6b2d3d;  /* Burgundy accent for focus */
        }

        /* Slider Styles */
        .settings-slider-container {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 12px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 4px;
          margin-bottom: 8px;
        }
        .settings-slider-label {
          flex: 1;
          font-size: 14px;
          color: #2d2418;
        }
        .settings-slider {
          width: 120px;
          height: 6px;
          -webkit-appearance: none;
          appearance: none;
          background: #bfae8a;
          border: 1px solid #8b7355;
          border-radius: 3px;
          outline: none;
        }
        .settings-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          background: linear-gradient(to bottom, #6b2d3d 0%, #5a2433 100%);  /* Burgundy accent */
          border: 2px solid #8b7355;
          border-radius: 50%;
          cursor: pointer;
        }
        .settings-slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          background: linear-gradient(to bottom, #6b2d3d 0%, #5a2433 100%);  /* Burgundy accent */
          border: 2px solid #8b7355;
          border-radius: 50%;
          cursor: pointer;
        }
        .settings-slider-value {
          width: 40px;
          text-align: right;
          font-size: 13px;
          color: #5a4a3a;
        }
      </style>

      <div class="settings-container">
        <div class="settings-header">
          <h2 class="settings-title">Settings</h2>
          <button class="settings-close" title="Close">&times;</button>
        </div>

        <div class="settings-tabs">
          <button class="settings-tab active" data-tab="battle">Battle Interface</button>
          <!-- Future tabs can be added here -->
        </div>

        <div class="settings-content" id="settings-tab-content">
          <!-- Tab content rendered here -->
        </div>

        <div class="settings-footer">
          <button class="settings-btn settings-btn-cancel" id="settings-cancel">Cancel</button>
          <button class="settings-btn settings-btn-save" id="settings-save">Save</button>
        </div>
      </div>
    `;

    document.body.appendChild(this.element);
    this.bindEvents();
  }

  /**
   * Bind event handlers
   */
  bindEvents() {
    const signal = this.abortController.signal;

    // Close button
    this.element.querySelector('.settings-close').addEventListener('click', () => {
      this.close(false);
    }, { signal });

    // Cancel button
    this.element.querySelector('#settings-cancel').addEventListener('click', () => {
      this.close(false);
    }, { signal });

    // Save button
    this.element.querySelector('#settings-save').addEventListener('click', () => {
      this.save();
    }, { signal });

    // Tab switching
    this.element.querySelectorAll('.settings-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.switchTab(tab.dataset.tab);
      }, { signal });
    });

    // Click outside to close
    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) {
        this.close(false);
      }
    }, { signal });

    // ESC key to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isVisible) {
        this.close(false);
      }
    }, { signal });
  }

  /**
   * Switch to a different tab
   */
  switchTab(tabName) {
    this.activeTab = tabName;

    // Update tab buttons
    this.element.querySelectorAll('.settings-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    this.renderTabContent();
  }

  /**
   * Render the content for the active tab
   */
  renderTabContent() {
    const container = this.element.querySelector('#settings-tab-content');

    switch (this.activeTab) {
      case 'battle':
        container.innerHTML = this.renderBattleTab();
        this.bindRadioEvents();
        break;
      default:
        container.innerHTML = '<p>Unknown tab</p>';
    }
  }

  /**
   * Render the Battle Interface tab content
   */
  renderBattleTab() {
    const currentStyle = this.pendingSettings.battle?.actionMenuStyle || 'radial';

    return `
      <div class="settings-section">
        <div class="settings-section-title">Action Menu Style</div>
        <div class="settings-radio-group">
          ${ACTION_MENU_OPTIONS.map(option => `
            <div class="settings-radio ${option.value === currentStyle ? 'selected' : ''}"
                 data-setting="battle.actionMenuStyle" data-value="${option.value}">
              <div class="settings-radio-circle"></div>
              <div class="settings-radio-content">
                <div class="settings-radio-label">${option.label}</div>
                <div class="settings-radio-description">${option.description}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  /**
   * Bind click events to radio options
   */
  bindRadioEvents() {
    const signal = this.abortController.signal;

    this.element.querySelectorAll('.settings-radio').forEach(radio => {
      radio.addEventListener('click', () => {
        const setting = radio.dataset.setting;
        const value = radio.dataset.value;

        // Update pending settings
        this.setNestedValue(this.pendingSettings, setting, value);

        // Update UI
        const group = radio.parentElement;
        group.querySelectorAll('.settings-radio').forEach(r => {
          r.classList.toggle('selected', r === radio);
        });
      }, { signal });
    });
  }

  /**
   * Set a nested value in an object using dot notation
   */
  setNestedValue(obj, path, value) {
    const keys = path.split('.');
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }

    current[keys[keys.length - 1]] = value;
  }

  /**
   * Save settings to the server and close
   */
  async save() {
    try {
      // Save to server
      const result = await this.game.api.updateSettings(this.pendingSettings);

      // Update game state
      this.game.state.set('userSettings', result.settings);

      this.close(true);
    } catch (err) {
      console.error('Failed to save settings:', err);
      parchmentToast.error('Settings', 'Failed to save settings: ' + err.message);
    }
  }

  /**
   * Close the modal
   * @param {boolean} saved - Whether settings were saved
   */
  close(saved = false) {
    if (!this.isVisible) return;

    this.element.classList.remove('visible');

    setTimeout(() => {
      this.destroy();

      if (this.onClose) {
        this.onClose(saved);
      }
    }, 200);
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.isVisible = false;

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.element) {
      this.element.remove();
      this.element = null;
    }
  }
}
