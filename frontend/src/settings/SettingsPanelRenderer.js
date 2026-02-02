/**
 * @module SettingsPanelRenderer
 * @description Renders all settings panel content for the SettingsScene.
 *
 * Key responsibilities:
 * - Render Battle, Audio, Display, Accessibility, Gameplay, Controls, Social, Developer, Help panels
 * - Generate HTML for radio groups, checkboxes, sliders, and keybind previews
 * - Provide keybind scheme mappings
 *
 * @see SettingsScene.js - Main scene orchestration
 * @see SettingsStateManager.js - State and persistence
 * @see SettingsAccessibility.js - Accessibility feature application
 */

/**
 * Renders settings panel HTML content
 */
export class SettingsPanelRenderer {
  /**
   * @param {Object} settings - Current settings object
   * @param {boolean} isDevelopment - Whether in development mode
   */
  constructor(settings, isDevelopment) {
    this.settings = settings;
    this.isDevelopment = isDevelopment;
  }

  /**
   * Update settings reference
   * @param {Object} settings - New settings object
   */
  updateSettings(settings) {
    this.settings = settings;
  }

  /**
   * Render the Battle settings panel
   * @returns {string} HTML string
   */
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

  /**
   * Render the Audio settings panel
   * @returns {string} HTML string
   */
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

  /**
   * Render the Display settings panel
   * @returns {string} HTML string
   */
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

  /**
   * Render the Accessibility settings panel
   * @returns {string} HTML string
   */
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

  /**
   * Render the Gameplay settings panel
   * @returns {string} HTML string
   */
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

  /**
   * Render the Controls settings panel
   * @returns {string} HTML string
   */
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
              ${this.renderKeybindPreviewContent(keybinds)}
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

  /**
   * Render the Social settings panel
   * @returns {string} HTML string
   */
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

  /**
   * Render the Developer settings panel
   * @returns {string} HTML string
   */
  renderDeveloperPanel() {
    const d = this.settings.developer;
    const disabled = !d.enabled;
    const disabledClass = disabled ? 'disabled' : '';
    const disabledAttr = disabled ? 'disabled' : '';

    return `
      <div class="settings-panel" id="panel-developer">
        <div class="settings-panel-title">Developer Settings</div>

        <div class="settings-section">
          <div class="settings-section-title">Master Toggle</div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="developer-enabled" ${d.enabled ? 'checked' : ''} data-setting="developer.enabled">
              <label class="settings-checkbox-label" for="developer-enabled">Enable Developer Mode</label>
            </div>
            <div class="settings-group-description">Master toggle for all debug features. When disabled, no debug output will be logged.</div>
          </div>
        </div>

        <div class="settings-section ${disabledClass}">
          <div class="settings-section-title">Audio Debugging</div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="developer-audio-music" ${d.audio.logMusicChanges ? 'checked' : ''} ${disabledAttr} data-setting="developer.audio.logMusicChanges">
              <label class="settings-checkbox-label" for="developer-audio-music">Log Music Track Changes</label>
            </div>
            <div class="settings-group-description">Log when playing a new music track.</div>
          </div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="developer-audio-region" ${d.audio.logRegionInfo ? 'checked' : ''} ${disabledAttr} data-setting="developer.audio.logRegionInfo">
              <label class="settings-checkbox-label" for="developer-audio-region">Log Region Audio Keys</label>
            </div>
            <div class="settings-group-description">Log when building audio keys for regions.</div>
          </div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="developer-audio-sfx" ${d.audio.logSFXPlayback ? 'checked' : ''} ${disabledAttr} data-setting="developer.audio.logSFXPlayback">
              <label class="settings-checkbox-label" for="developer-audio-sfx">Log Sound Effect Playback</label>
            </div>
            <div class="settings-group-description">Log when playing sound effects.</div>
          </div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="developer-audio-missing" ${d.audio.logMissingAssets ? 'checked' : ''} ${disabledAttr} data-setting="developer.audio.logMissingAssets">
              <label class="settings-checkbox-label" for="developer-audio-missing">Show Missing Asset Warnings</label>
            </div>
            <div class="settings-group-description">Show "npm run audio:generate" messages for missing audio files.</div>
          </div>
        </div>

        <div class="settings-section ${disabledClass}">
          <div class="settings-section-title">Network Debugging</div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="developer-network-api" ${d.network.logAPIRequests ? 'checked' : ''} ${disabledAttr} data-setting="developer.network.logAPIRequests">
              <label class="settings-checkbox-label" for="developer-network-api">Log API Requests</label>
            </div>
            <div class="settings-group-description">Log HTTP requests and responses.</div>
          </div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="developer-network-ws" ${d.network.logWebSocketMessages ? 'checked' : ''} ${disabledAttr} data-setting="developer.network.logWebSocketMessages">
              <label class="settings-checkbox-label" for="developer-network-ws">Log WebSocket Messages</label>
            </div>
            <div class="settings-group-description">Log WebSocket messages.</div>
          </div>
        </div>

        <div class="settings-section ${disabledClass}">
          <div class="settings-section-title">State Debugging</div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="developer-state-changes" ${d.state.logStateChanges ? 'checked' : ''} ${disabledAttr} data-setting="developer.state.logStateChanges">
              <label class="settings-checkbox-label" for="developer-state-changes">Log State Changes</label>
            </div>
            <div class="settings-group-description">Log StateManager changes.</div>
          </div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="developer-state-scenes" ${d.state.logSceneTransitions ? 'checked' : ''} ${disabledAttr} data-setting="developer.state.logSceneTransitions">
              <label class="settings-checkbox-label" for="developer-state-scenes">Log Scene Transitions</label>
            </div>
            <div class="settings-group-description">Log scene enter/exit events.</div>
          </div>
        </div>

        <div class="settings-section ${disabledClass}">
          <div class="settings-section-title">Battle Debugging</div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="developer-battle-turns" ${d.battle.logTurnEvents ? 'checked' : ''} ${disabledAttr} data-setting="developer.battle.logTurnEvents">
              <label class="settings-checkbox-label" for="developer-battle-turns">Log Turn Events</label>
            </div>
            <div class="settings-group-description">Log turn transitions and battle events.</div>
          </div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="developer-battle-damage" ${d.battle.logDamageCalculations ? 'checked' : ''} ${disabledAttr} data-setting="developer.battle.logDamageCalculations">
              <label class="settings-checkbox-label" for="developer-battle-damage">Log Damage Calculations</label>
            </div>
            <div class="settings-group-description">Show damage formula breakdowns.</div>
          </div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="developer-battle-ai" ${d.battle.logAIDecisions ? 'checked' : ''} ${disabledAttr} data-setting="developer.battle.logAIDecisions">
              <label class="settings-checkbox-label" for="developer-battle-ai">Log AI Decisions</label>
            </div>
            <div class="settings-group-description">Show AI decision-making process.</div>
          </div>
        </div>

        <div class="settings-section ${disabledClass}">
          <div class="settings-section-title">Performance</div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="developer-performance-fps" ${d.performance.showFPS ? 'checked' : ''} ${disabledAttr} data-setting="developer.performance.showFPS">
              <label class="settings-checkbox-label" for="developer-performance-fps">Show FPS Counter</label>
            </div>
            <div class="settings-group-description">Display FPS counter overlay on the game canvas.</div>
          </div>

          <div class="settings-group">
            <div class="settings-checkbox-group">
              <input type="checkbox" class="settings-checkbox" id="developer-performance-slow" ${d.performance.logSlowFrames ? 'checked' : ''} ${disabledAttr} data-setting="developer.performance.logSlowFrames">
              <label class="settings-checkbox-label" for="developer-performance-slow">Log Slow Frames</label>
            </div>
            <div class="settings-group-description">Log frames that take longer than 32ms (below 30 FPS).</div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render the Help settings panel
   * @returns {string} HTML string
   */
  renderHelpPanel() {
    return `
      <div class="settings-panel" id="panel-help">
        <div class="settings-panel-title">Help & Feedback</div>

        <div class="settings-section">
          <div class="settings-section-title">Send Feedback</div>

          <div class="settings-group">
            <div class="settings-group-description">
              Have a suggestion, found a bug, or need to report another player?
              We'd love to hear from you.
            </div>
            <button class="settings-btn settings-btn-primary" id="feedback-btn">
              Open Feedback Form
            </button>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">About</div>

          <div class="settings-group">
            <div class="settings-group-description">
              <strong>Modia</strong> - A browser-based MMORPG with tactical turn-based combat.
              <br><br>
              Version: 1.0.0-alpha
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Get keybinds for a given scheme
   * @param {string} scheme - 'wasd', 'arrows', 'vim', or 'custom'
   * @returns {Object} Keybind mappings
   */
  getKeybindsForScheme(scheme) {
    const schemes = {
      wasd: { up: 'W', down: 'S', left: 'A', right: 'D', confirm: 'E', cancel: 'Q' },
      arrows: { up: 'Up', down: 'Down', left: 'Left', right: 'Right', confirm: 'Enter', cancel: 'Esc' },
      vim: { up: 'K', down: 'J', left: 'H', right: 'L', confirm: 'Enter', cancel: 'Esc' },
      custom: { up: '?', down: '?', left: '?', right: '?', confirm: '?', cancel: '?' }
    };
    return schemes[scheme] || schemes.wasd;
  }

  /**
   * Render keybind preview content
   * @param {Object} keybinds - Keybind mappings
   * @returns {string} HTML string
   */
  renderKeybindPreviewContent(keybinds) {
    return `
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
}
