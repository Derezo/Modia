/**
 * @module BattleUI
 * @description User interface overlay for tactical turn-based combat.
 *
 * Key responsibilities:
 * - Action menu display and button state management
 * - Active unit and target info cards (ParchmentCard integration)
 * - Turn order panel coordination (TurnOrderPanel)
 * - Battle log display (BattleLogPanel)
 * - Damage/heal preview overlays on target cards
 * - PvP-specific UI (turn timer, surrender, disconnect overlay)
 * - Skill, item, and zodiac ability selection panels
 * - Confirmation dialogs and battle result display
 *
 * @see BattleScene.js - Orchestrates battle and calls UI methods
 * @see ParchmentCard.js - Character/enemy info cards
 * @see TurnOrderPanel.js - Turn order display
 * @see BattleLogPanel.js - Combat history log
 */
import { ParchmentCard } from '../components/ParchmentCard.js';
import { parchmentToast } from '../ui/parchment/ParchmentToast.js';
import TurnOrderPanel from './TurnOrderPanel.js';
import BattleLogPanel from './BattleLogPanel.js';

/**
 * BattleUI - User interface for tactical combat
 */
export class BattleUI {
  constructor(game) {
    this.game = game;
    this.element = null;
    this.actionCallbacks = {};
    this.abortController = null;
    this.isVisible = true;
    this.activeUnitCard = null;  // ParchmentCard for active unit
    this.targetCard = null;      // ParchmentCard for target/enemy
    this.targetSticky = false;   // Keep target panel visible during targeting
    this.turnOrderPanel = null;  // TurnOrderPanel for turn order display
    this.battleLogPanel = null;  // BattleLogPanel for combat history
    this.previewUnit = null;     // Unit being previewed from turn order
    this.hoveredBattleUnit = null; // Unit hovered/tapped on battlefield
    this.confirmTargetUnit = null; // Unit being targeted for attack confirmation
    this.activeEnemyUnit = null;   // Active enemy unit (on enemy turn)
  }

  /**
   * Show the battle UI
   */
  show() {
    this.isVisible = true;
    if (this.element) {
      this.element.style.display = '';
    }
  }

  /**
   * Hide the battle UI
   */
  hide() {
    this.isVisible = false;
    if (this.element) {
      this.element.style.display = 'none';
    }
  }

  /**
   * Create the battle UI overlay
   */
  create(battleState, callbacks = {}) {
    this.actionCallbacks = callbacks;
    this.abortController = new AbortController();

    const container = document.createElement('div');
    container.id = 'battle-ui';
    container.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;';

    container.innerHTML = `
      <!-- Turn Order Panel Container (left side) -->
      <div id="turn-order-container" style="
        position: absolute;
        top: 10px;
        left: 10px;
        pointer-events: auto;
      "></div>

      <!-- Active Unit Panel (bottom left) - ParchmentCard container -->
      <div id="active-unit-panel" style="
        position: absolute;
        bottom: 10px;
        left: 10px;
        pointer-events: auto;
      ">
        <!-- ParchmentCard will be inserted here -->
      </div>

      <!-- Action Menu - DEPRECATED: Replaced by RadialMenu, kept for targeting cancel only -->
      <div id="action-menu" class="battle-panel" style="
        position: absolute;
        bottom: 10px;
        left: 50%;
        transform: translateX(-50%);
        pointer-events: auto;
        display: none;
      ">
        <div class="ui-panel" style="padding: 10px;">
          <!-- Cancel button for targeting mode -->
          <div id="targeting-cancel" style="margin-top: 0; text-align: center;">
            <button class="btn btn-secondary" id="btn-cancel-targeting">Cancel (Esc)</button>
          </div>
        </div>
      </div>

      <!-- Skill Selection Panel (hidden by default) -->
      <div id="skill-panel" class="battle-panel" style="
        position: absolute;
        bottom: 70px;
        left: 50%;
        transform: translateX(-50%);
        pointer-events: auto;
        display: none;
      ">
        <div class="ui-panel" style="padding: 10px; max-width: 400px;">
          <div style="font-size: 12px; color: #888; margin-bottom: 8px;">Select Skill</div>
          <div id="skill-list" style="display: flex; flex-wrap: wrap; gap: 6px;"></div>
        </div>
      </div>

      <!-- Item Selection Panel (hidden by default) -->
      <div id="item-panel" class="battle-panel" style="
        position: absolute;
        bottom: 70px;
        left: 50%;
        transform: translateX(-50%);
        pointer-events: auto;
        display: none;
      ">
        <div class="ui-panel" style="padding: 10px; max-width: 400px;">
          <div style="font-size: 12px; color: #888; margin-bottom: 8px;">Use Item</div>
          <div id="item-list" style="display: flex; flex-wrap: wrap; gap: 6px;"></div>
          <div id="no-items" style="color: #666; font-style: italic; display: none;">No consumable items</div>
        </div>
      </div>

      <!-- Zodiac Ability Panel (hidden by default) -->
      <div id="zodiac-panel" class="battle-panel" style="
        position: absolute;
        bottom: 70px;
        left: 50%;
        transform: translateX(-50%);
        pointer-events: auto;
        display: none;
      ">
        <div class="ui-panel" style="padding: 10px; max-width: 400px;">
          <div style="font-size: 12px; color: #d4af37; margin-bottom: 8px;">Zodiac Signature Ability (Once per Battle)</div>
          <div id="zodiac-list" style="display: flex; flex-wrap: wrap; gap: 6px;"></div>
          <div id="no-zodiac" style="color: #666; font-style: italic; display: none;">No zodiac abilities available</div>
        </div>
      </div>

      <!-- Target Info (bottom right) - ParchmentCard container -->
      <div id="target-panel" style="
        position: absolute;
        bottom: 10px;
        right: 10px;
        pointer-events: auto;
        display: none;
      ">
        <!-- ParchmentCard for target/enemy will be inserted here -->
      </div>

      <!-- Confirmation Panel (hidden by default) -->
      <div id="confirm-panel" style="
        position: absolute;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        pointer-events: auto;
        display: none;
        z-index: 200;
      ">
        <div class="ui-panel" style="padding: 10px;">
          <div id="confirm-text" style="margin-bottom: 10px; text-align: center;"></div>
          <div style="display: flex; gap: 8px; justify-content: center;">
            <button class="btn btn-primary" id="btn-confirm">Confirm</button>
            <button class="btn btn-secondary" id="btn-cancel">Cancel</button>
          </div>
        </div>
      </div>

      <!-- Battle Result (hidden by default) -->
      <div id="battle-result" style="
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        pointer-events: auto;
        display: none;
      ">
        <div class="ui-panel" style="min-width: 300px; text-align: center;">
          <div id="result-title" style="font-size: 24px; font-weight: bold; margin-bottom: 16px;"></div>
          <div id="result-rewards" style="margin-bottom: 16px;"></div>
          <button class="btn btn-primary" id="btn-continue">Continue</button>
        </div>
      </div>

      <!-- Turn Indicator (shown briefly when turn changes) -->
      <div id="turn-indicator" style="
        position: absolute;
        top: 80px;
        left: 50%;
        transform: translateX(-50%);
        pointer-events: none;
        display: none;
        z-index: 100;
      ">
        <div class="turn-indicator-content">
          <span id="turn-indicator-text"></span>
        </div>
      </div>

      <!-- PvP Turn Timer (shown only in PvP battles) -->
      <div id="pvp-turn-timer" style="
        position: absolute;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        pointer-events: none;
        display: none;
        z-index: 101;
      ">
        <div class="pvp-timer-container">
          <svg class="pvp-timer-svg" viewBox="0 0 100 100">
            <circle class="pvp-timer-bg" cx="50" cy="50" r="45" />
            <circle class="pvp-timer-progress" cx="50" cy="50" r="45" />
          </svg>
          <span class="pvp-timer-text" id="pvp-timer-text">60</span>
        </div>
      </div>

      <!-- PvP Surrender Button (shown only in PvP battles) -->
      <div id="pvp-surrender-panel" style="
        position: absolute;
        top: 10px;
        right: 10px;
        pointer-events: auto;
        display: none;
      ">
        <button class="btn btn-danger pvp-surrender-btn" id="btn-surrender">
          Surrender
        </button>
      </div>

      <!-- PvP Surrender Confirmation Modal -->
      <div id="surrender-confirm-modal" style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        display: none;
        align-items: center;
        justify-content: center;
        pointer-events: auto;
        z-index: 1000;
      ">
        <div class="ui-panel surrender-confirm-content">
          <h3 style="color: #f44336; margin: 0 0 16px 0;">Confirm Surrender</h3>
          <p style="color: #ccc; margin-bottom: 16px;">
            Are you sure you want to surrender?<br>
            <span style="color: #f44336; font-size: 12px;">
              You will receive a 25% rating penalty.
            </span>
          </p>
          <div style="display: flex; gap: 12px; justify-content: center;">
            <button class="btn btn-danger" id="btn-confirm-surrender">Surrender</button>
            <button class="btn btn-secondary" id="btn-cancel-surrender">Cancel</button>
          </div>
        </div>
      </div>

      <!-- PvP Opponent Disconnected Overlay -->
      <div id="opponent-disconnected-overlay" style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.6);
        display: none;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        z-index: 999;
      ">
        <div class="ui-panel disconnect-content">
          <h3 style="color: #ffd700; margin: 0 0 12px 0;">Opponent Disconnected</h3>
          <p style="color: #aaa; margin-bottom: 8px;">Waiting for reconnection...</p>
          <div class="disconnect-countdown" id="disconnect-countdown">5:00</div>
        </div>
      </div>

      <!-- Notification Container (for temporary messages) -->
      <div id="notification-container" style="
        position: absolute;
        top: 120px;
        right: 10px;
        pointer-events: none;
        z-index: 99;
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-width: 300px;
      "></div>

      <!-- Battle Log Panel Container (right side, below notifications) -->
      <div id="battle-log-container" style="
        position: absolute;
        top: 10px;
        right: 10px;
        pointer-events: auto;
      "></div>

    `;

    // Add custom styles
    this.addStyles();

    this.game.uiOverlay.appendChild(container);
    this.element = container;

    // Setup event listeners
    this.setupEventListeners();

    // Initialize ParchmentCard for active unit (bottom left)
    this.activeUnitCard = new ParchmentCard({
      mode: 'compact',
      type: 'player',
      showStats: true
    });
    const activePanel = container.querySelector('#active-unit-panel');
    if (activePanel) {
      activePanel.appendChild(this.activeUnitCard.element);
    }

    // Initialize ParchmentCard for target/enemy (bottom right)
    this.targetCard = new ParchmentCard({
      mode: 'compact',
      type: 'enemy',
      showStats: true
    });
    const targetPanel = container.querySelector('#target-panel');
    if (targetPanel) {
      targetPanel.appendChild(this.targetCard.element);
    }

    // Initialize TurnOrderPanel (top left)
    this.turnOrderPanel = new TurnOrderPanel({
      onUnitTap: (unit) => this.handleTurnOrderTap(unit),
      onPreviewUnit: (unit) => this.handleTurnOrderPreview(unit)
    });
    const turnOrderContainer = container.querySelector('#turn-order-container');
    if (turnOrderContainer) {
      turnOrderContainer.appendChild(this.turnOrderPanel.element);
    }

    // Initialize BattleLogPanel (top right)
    const battleSettings = this.game.state?.settings?.battle || {};
    const logPosition = battleSettings.battleLogPosition || 'right';
    const logVisible = battleSettings.battleLogVisible !== false; // Default to true

    this.battleLogPanel = new BattleLogPanel({
      position: logPosition,
      maxEntries: 50
    });
    const battleLogContainer = container.querySelector('#battle-log-container');
    if (battleLogContainer) {
      battleLogContainer.appendChild(this.battleLogPanel.element);
      // Update position based on settings
      if (logPosition === 'left') {
        battleLogContainer.style.right = 'auto';
        battleLogContainer.style.left = '180px'; // After turn order panel
      }
      // Hide if settings say so
      if (!logVisible) {
        this.battleLogPanel.hide();
      }
    }

    // Initial update
    this.updateTurnOrder(battleState);
  }

  /**
   * Handle tap on turn order item - pan camera and show preview
   * @param {Object} unit - The tapped unit
   */
  handleTurnOrderTap(unit) {
    if (!unit) return;

    // Set as preview unit
    this.previewUnit = unit;

    // Notify scene to pan camera (via callback)
    if (this.actionCallbacks.onUnitPreview) {
      this.actionCallbacks.onUnitPreview(unit);
    }

    // Update target panel with priority system
    this.updateTargetPanel();
  }

  /**
   * Handle preview from turn order (shows unit in target panel)
   * @param {Object} _unit - The unit to preview (unused, handled by handleTurnOrderTap)
   */
  handleTurnOrderPreview(_unit) {
    // This is handled by handleTurnOrderTap which calls updateTargetPanel
  }

  /**
   * Clear the turn order preview
   */
  clearTurnOrderPreview() {
    this.previewUnit = null;
    if (this.turnOrderPanel) {
      this.turnOrderPanel.clearPreview();
    }
    this.updateTargetPanel();
  }

  /**
   * Set hovered/tapped battlefield unit
   * @param {Object} unit - The unit on the battlefield
   */
  setHoveredBattleUnit(unit) {
    this.hoveredBattleUnit = unit;
    // Clear turn order preview if tapping somewhere else
    if (unit && this.previewUnit) {
      this.clearTurnOrderPreview();
    }
    this.updateTargetPanel();
  }

  /**
   * Set confirm target unit (when confirming attack/skill)
   * @param {Object} unit - The targeted unit
   */
  setConfirmTargetUnit(unit) {
    this.confirmTargetUnit = unit;
    this.updateTargetPanel();
  }

  /**
   * Set active enemy unit (on enemy turn)
   * @param {Object} unit - The active enemy unit
   */
  setActiveEnemyUnit(unit) {
    this.activeEnemyUnit = unit;
    this.updateTargetPanel();
  }

  /**
   * Update target panel based on priority system
   * Priority: confirmTarget > hoveredBattle > turnOrderPreview > activeEnemy
   */
  updateTargetPanel() {
    // Don't update if sticky mode is active
    if (this.targetSticky) return;

    const unitToShow =
      this.confirmTargetUnit ||
      this.hoveredBattleUnit ||
      this.previewUnit ||
      this.activeEnemyUnit;

    if (unitToShow) {
      this.showTargetInfo(unitToShow);
    } else {
      this.hideTargetInfo();
    }
  }

  /**
   * Add battle-specific CSS styles
   */
  addStyles() {
    if (document.getElementById('battle-styles')) return;

    const style = document.createElement('style');
    style.id = 'battle-styles';
    style.textContent = `
      .stat-bar {
        height: 8px;
        background: #333;
        border-radius: 4px;
        overflow: hidden;
      }
      .stat-bar-fill {
        height: 100%;
        transition: width 0.3s ease;
      }
      .stat-bar-fill.hp {
        background: linear-gradient(to right, #f44336, #4caf50);
        background-size: 200% 100%;
      }
      .stat-bar-fill.mp {
        background: #2196f3;
      }
      .action-btn {
        min-width: 60px;
        font-size: 12px;
        padding: 8px 12px;
        transition: opacity 0.2s ease;
      }
      .action-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .action-btn.action-unavailable {
        background: #333 !important;
        border-color: #555 !important;
      }
      #action-phase-indicator {
        transition: color 0.3s ease;
      }
      #turn-order-list .turn-unit {
        display: flex;
        align-items: center;
        padding: 4px 8px;
        margin: 2px 0;
        border-radius: 4px;
        font-size: 11px;
      }
      #turn-order-list .turn-unit.active {
        background: rgba(255, 215, 0, 0.2);
        border: 1px solid #ffd700;
      }
      #turn-order-list .turn-unit.player {
        color: #4a90d9;
      }
      #turn-order-list .turn-unit.enemy {
        color: #d94a4a;
      }
      #turn-order-list .turn-unit.dead {
        opacity: 0.4;
        text-decoration: line-through;
      }
      .turn-number {
        width: 18px;
        font-size: 10px;
        color: #666;
        margin-right: 4px;
        text-align: right;
      }
      .turn-unit-icon {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        margin-right: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        font-weight: bold;
        color: #fff;
      }
      .turn-unit-name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Turn Indicator Styles */
      .turn-indicator-content {
        background: rgba(0, 0, 0, 0.85);
        border: 2px solid #ffd700;
        border-radius: 8px;
        padding: 12px 24px;
        font-size: 18px;
        font-weight: bold;
        text-align: center;
        animation: turnIndicatorPulse 0.5s ease-out;
      }
      .turn-indicator-content.player {
        border-color: #4a90d9;
        color: #4a90d9;
      }
      .turn-indicator-content.player_local {
        border-color: #4aff4a;
        color: #4aff4a;
      }
      .turn-indicator-content.player_remote {
        border-color: #d9d94a;
        color: #d9d94a;
      }
      .turn-indicator-content.enemy {
        border-color: #d94a4a;
        color: #d94a4a;
      }
      @keyframes turnIndicatorPulse {
        0% { transform: scale(0.8); opacity: 0; }
        50% { transform: scale(1.1); }
        100% { transform: scale(1); opacity: 1; }
      }

      /* Notification Styles */
      .battle-notification {
        background: rgba(0, 0, 0, 0.9);
        border-radius: 6px;
        padding: 10px 16px;
        font-size: 13px;
        animation: notificationSlideIn 0.3s ease-out;
        border-left: 4px solid #888;
      }
      .battle-notification.info {
        border-left-color: #4a90d9;
        color: #4a90d9;
      }
      .battle-notification.warning {
        border-left-color: #d9a54a;
        color: #d9a54a;
      }
      .battle-notification.error {
        border-left-color: #d94a4a;
        color: #d94a4a;
      }
      .battle-notification.success {
        border-left-color: #4ad94a;
        color: #4ad94a;
      }
      @keyframes notificationSlideIn {
        0% { transform: translateX(100%); opacity: 0; }
        100% { transform: translateX(0); opacity: 1; }
      }
      @keyframes notificationFadeOut {
        0% { opacity: 1; }
        100% { opacity: 0; transform: translateX(50%); }
      }

      /* PvP Turn Timer Styles */
      .pvp-timer-container {
        position: relative;
        width: 80px;
        height: 80px;
      }
      .pvp-timer-svg {
        width: 100%;
        height: 100%;
        transform: rotate(-90deg);
      }
      .pvp-timer-bg {
        fill: none;
        stroke: rgba(0, 0, 0, 0.5);
        stroke-width: 8;
      }
      .pvp-timer-progress {
        fill: none;
        stroke: #4caf50;
        stroke-width: 8;
        stroke-linecap: round;
        stroke-dasharray: 283;
        stroke-dashoffset: 0;
        transition: stroke-dashoffset 0.5s linear, stroke 0.3s ease;
      }
      .pvp-timer-progress.warning {
        stroke: #ff9800;
        animation: timerPulse 1s ease-in-out infinite;
      }
      .pvp-timer-progress.critical {
        stroke: #f44336;
        animation: timerPulse 0.5s ease-in-out infinite;
      }
      @keyframes timerPulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.6; }
      }
      .pvp-timer-text {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 24px;
        font-weight: bold;
        color: #fff;
        text-shadow: 0 0 10px rgba(0, 0, 0, 0.8);
      }

      /* PvP Surrender Button Styles */
      .pvp-surrender-btn {
        background: linear-gradient(180deg, #c62828, #8b1c1c) !important;
        border-color: #e53935 !important;
        padding: 8px 16px !important;
        font-size: 12px !important;
        opacity: 0.8;
        transition: opacity 0.2s ease, transform 0.2s ease;
      }
      .pvp-surrender-btn:hover {
        opacity: 1;
        transform: scale(1.05);
      }

      /* Surrender Confirmation Modal */
      .surrender-confirm-content {
        padding: 24px;
        max-width: 320px;
        text-align: center;
      }

      /* Opponent Disconnected Overlay */
      .disconnect-content {
        padding: 24px;
        text-align: center;
      }
      .disconnect-countdown {
        font-size: 32px;
        font-weight: bold;
        color: #ffd700;
        margin-top: 8px;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Setup button event listeners
   */
  setupEventListeners() {
    const opts = { signal: this.abortController.signal };

    this.element.querySelector('#btn-move')?.addEventListener('click', () => {
      this.actionCallbacks.onMove?.();
    }, opts);

    this.element.querySelector('#btn-attack')?.addEventListener('click', () => {
      this.actionCallbacks.onAttack?.();
    }, opts);

    this.element.querySelector('#btn-wait')?.addEventListener('click', () => {
      this.actionCallbacks.onWait?.();
    }, opts);

    this.element.querySelector('#btn-skill')?.addEventListener('click', () => {
      this.actionCallbacks.onSkill?.();
    }, opts);

    this.element.querySelector('#btn-item')?.addEventListener('click', () => {
      this.actionCallbacks.onItem?.();
    }, opts);

    this.element.querySelector('#btn-confirm')?.addEventListener('click', () => {
      this.actionCallbacks.onConfirm?.();
    }, opts);

    this.element.querySelector('#btn-cancel')?.addEventListener('click', () => {
      this.actionCallbacks.onCancel?.();
    }, opts);

    this.element.querySelector('#btn-cancel-targeting')?.addEventListener('click', () => {
      this.actionCallbacks.onCancel?.();
    }, opts);

    this.element.querySelector('#btn-continue')?.addEventListener('click', () => {
      this.actionCallbacks.onContinue?.();
    }, opts);

    // PvP Surrender button
    this.element.querySelector('#btn-surrender')?.addEventListener('click', () => {
      this.showSurrenderModal();
    }, opts);

    // Surrender modal confirm
    this.element.querySelector('#btn-confirm-surrender')?.addEventListener('click', () => {
      this.hideSurrenderModal();
      this.actionCallbacks.onSurrender?.();
    }, opts);

    // Surrender modal cancel
    this.element.querySelector('#btn-cancel-surrender')?.addEventListener('click', () => {
      this.hideSurrenderModal();
    }, opts);
  }

  // ==========================================
  // PvP-Specific Methods
  // ==========================================

  /**
   * Enable PvP mode - shows PvP-specific UI elements
   */
  enablePvPMode() {
    this.isPvPMode = true;

    // Show surrender button
    const surrenderPanel = this.element.querySelector('#pvp-surrender-panel');
    if (surrenderPanel) {
      surrenderPanel.style.display = 'block';
    }

    // Show turn timer
    const timerPanel = this.element.querySelector('#pvp-turn-timer');
    if (timerPanel) {
      timerPanel.style.display = 'block';
    }
  }

  /**
   * Update PvP turn timer
   * @param {number} remainingSeconds - Seconds remaining in turn
   * @param {number} totalSeconds - Total turn time (default 60)
   */
  updateTurnTimer(remainingSeconds, totalSeconds = 60) {
    const timerText = this.element.querySelector('#pvp-timer-text');
    const timerProgress = this.element.querySelector('.pvp-timer-progress');

    if (!timerText || !timerProgress) return;

    // Update text
    timerText.textContent = Math.ceil(remainingSeconds);

    // Update progress circle (283 is the circumference of r=45 circle)
    const circumference = 283;
    const progress = remainingSeconds / totalSeconds;
    const offset = circumference * (1 - progress);
    timerProgress.style.strokeDashoffset = offset;

    // Update color based on remaining time
    timerProgress.classList.remove('warning', 'critical');
    if (remainingSeconds <= 10) {
      timerProgress.classList.add('critical');
    } else if (remainingSeconds <= 15) {
      timerProgress.classList.add('warning');
    }
  }

  /**
   * Hide turn timer (during opponent's turn in PvP)
   */
  hideTurnTimer() {
    const timerPanel = this.element.querySelector('#pvp-turn-timer');
    if (timerPanel) {
      timerPanel.style.display = 'none';
    }
  }

  /**
   * Show turn timer (during player's turn in PvP)
   */
  showTurnTimer() {
    if (!this.isPvPMode) return;

    const timerPanel = this.element.querySelector('#pvp-turn-timer');
    if (timerPanel) {
      timerPanel.style.display = 'block';
    }
  }

  /**
   * Show surrender confirmation modal
   */
  showSurrenderModal() {
    const modal = this.element.querySelector('#surrender-confirm-modal');
    if (modal) {
      modal.style.display = 'flex';
    }
  }

  /**
   * Hide surrender confirmation modal
   */
  hideSurrenderModal() {
    const modal = this.element.querySelector('#surrender-confirm-modal');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  /**
   * Show opponent disconnected overlay
   * @param {number} remainingSeconds - Seconds until forfeit
   */
  showDisconnectedOverlay(remainingSeconds) {
    const overlay = this.element.querySelector('#opponent-disconnected-overlay');
    const countdown = this.element.querySelector('#disconnect-countdown');

    if (overlay && countdown) {
      overlay.style.display = 'flex';
      const minutes = Math.floor(remainingSeconds / 60);
      const seconds = remainingSeconds % 60;
      countdown.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
  }

  /**
   * Hide opponent disconnected overlay
   */
  hideDisconnectedOverlay() {
    const overlay = this.element.querySelector('#opponent-disconnected-overlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  /**
   * Update turn order display using TurnOrderPanel
   */
  updateTurnOrder(battleState) {
    if (!this.turnOrderPanel) return;

    // Use turn predictions if available, otherwise build from units
    let predictions = battleState.turnPredictions || [];

    // If no predictions, build from unit list as fallback
    if (predictions.length === 0 && battleState.units) {
      predictions = battleState.units
        .filter(u => u.hp > 0)
        .map(u => ({
          id: u.id,
          name: u.name,
          type: u.type,
          class: u.class
        }));
    }

    // Update the panel
    this.turnOrderPanel.update(predictions, battleState.activeUnitIndex || 0);
  }

  /**
   * Update active unit panel using ParchmentCard
   */
  updateActiveUnit(unit) {
    if (!this.activeUnitCard) return;

    // Determine card type based on unit type
    const isEnemy = unit.type === 'enemy';
    if (isEnemy !== (this.activeUnitCard.type === 'enemy')) {
      // Recreate card with correct type if needed
      const panel = this.element.querySelector('#active-unit-panel');
      if (panel) {
        this.activeUnitCard.destroy();
        this.activeUnitCard = new ParchmentCard({
          mode: 'compact',
          type: isEnemy ? 'enemy' : 'player',
          showStats: true
        });
        panel.appendChild(this.activeUnitCard.element);
      }
    }

    this.activeUnitCard.setCharacter(unit);
  }

  /**
   * Show target info panel using ParchmentCard
   */
  showTargetInfo(unit) {
    const panel = this.element.querySelector('#target-panel');
    if (!panel || !this.targetCard) return;

    panel.style.display = 'block';

    // Determine card type based on unit type
    const isEnemy = unit.type === 'enemy';
    if (isEnemy !== (this.targetCard.type === 'enemy')) {
      // Recreate card with correct type if needed
      this.targetCard.destroy();
      this.targetCard = new ParchmentCard({
        mode: 'compact',
        type: isEnemy ? 'enemy' : 'player',
        showStats: true
      });
      panel.appendChild(this.targetCard.element);
    }

    this.targetCard.setCharacter(unit);
  }

  /**
   * Hide target info panel
   */
  hideTargetInfo() {
    // Don't hide if sticky mode is active
    if (this.targetSticky) return;

    const panel = this.element.querySelector('#target-panel');
    if (panel) panel.style.display = 'none';

    // Also hide damage preview when target info is hidden
    if (this.targetCard) {
      this.targetCard.hideDamagePreview();
    }
  }

  /**
   * Make target panel sticky (stays visible during targeting)
   * @param {Object} unit - The unit to show
   */
  setTargetSticky(unit) {
    this.targetSticky = true;
    if (unit) {
      this.showTargetInfo(unit);
    }
  }

  /**
   * Clear sticky mode and hide target panel
   */
  clearTargetSticky() {
    this.targetSticky = false;
    this.hideTargetInfo();
    if (this.targetCard) {
      this.targetCard.hideDamagePreview();
    }
  }

  /**
   * Show damage preview on the target card
   * @param {Object} data - Damage preview data
   */
  showDamagePreview(data) {
    if (this.targetCard) {
      this.targetCard.showDamagePreview(data);
    }
  }

  /**
   * Hide damage preview on the target card
   */
  hideDamagePreview() {
    if (this.targetCard) {
      this.targetCard.hideDamagePreview();
    }
  }

  /**
   * Show damage preview on the active unit card (for self-targeting skills/items)
   * @param {Object} data - Damage/heal preview data
   */
  showActiveUnitPreview(data) {
    if (this.activeUnitCard) {
      this.activeUnitCard.showDamagePreview(data);
    }
  }

  /**
   * Hide damage preview on the active unit card
   */
  hideActiveUnitPreview() {
    if (this.activeUnitCard) {
      this.activeUnitCard.hideDamagePreview();
    }
  }

  /**
   * Show active unit detail card (after turn transition)
   * Now uses the main ParchmentCard - just updates it
   * @param {Object} unit - The active unit to display
   */
  showActiveUnitCard(unit) {
    // The active unit card is always visible, just update it
    this.updateActiveUnit(unit);
  }

  /**
   * Hide active unit detail card
   * Note: With ParchmentCard, we keep the card visible but could hide if needed
   */
  hideActiveUnitCard() {
    // No-op - the active unit card stays visible in battle
  }

  /**
   * Show confirmation panel
   */
  showConfirmation(text) {
    const panel = this.element.querySelector('#confirm-panel');
    const textEl = this.element.querySelector('#confirm-text');
    if (panel) panel.style.display = 'block';
    if (textEl) textEl.textContent = text;
  }

  /**
   * Hide confirmation panel
   */
  hideConfirmation() {
    const panel = this.element.querySelector('#confirm-panel');
    if (panel) panel.style.display = 'none';
  }

  /**
   * Enable/disable action buttons
   */
  setActionsEnabled(enabled) {
    const buttons = this.element.querySelectorAll('.action-btn');
    buttons.forEach(btn => {
      btn.disabled = !enabled;
    });
  }

  /**
   * Update available actions based on two-action turn state
   * @param {boolean} canMove - Whether movement is available
   * @param {boolean} canAct - Whether attack/skill is available
   */
  updateAvailableActions(canMove, canAct) {
    const moveBtn = this.element.querySelector('#btn-move');
    const attackBtn = this.element.querySelector('#btn-attack');
    const skillBtn = this.element.querySelector('#btn-skill');
    const itemBtn = this.element.querySelector('#btn-item');
    const phaseIndicator = this.element.querySelector('#action-phase-indicator');

    // Update move button state
    if (moveBtn) {
      moveBtn.disabled = !canMove;
      moveBtn.style.opacity = canMove ? '1' : '0.4';
      moveBtn.classList.toggle('action-unavailable', !canMove);
    }

    // Update attack button state
    if (attackBtn) {
      attackBtn.disabled = !canAct;
      attackBtn.style.opacity = canAct ? '1' : '0.4';
      attackBtn.classList.toggle('action-unavailable', !canAct);
    }

    // Update skill button state
    if (skillBtn) {
      skillBtn.disabled = !canAct;
      skillBtn.style.opacity = canAct ? '1' : '0.4';
      skillBtn.classList.toggle('action-unavailable', !canAct);
    }

    // Update item button state (items use the act action)
    if (itemBtn) {
      itemBtn.disabled = !canAct;
      itemBtn.style.opacity = canAct ? '1' : '0.4';
      itemBtn.classList.toggle('action-unavailable', !canAct);
    }

    // Update phase indicator text
    if (phaseIndicator) {
      if (canMove && canAct) {
        phaseIndicator.textContent = 'Choose: Move + Action';
        phaseIndicator.style.color = '#ffd700';
      } else if (canMove) {
        phaseIndicator.textContent = 'Move remaining (or Wait)';
        phaseIndicator.style.color = '#4a90d9';
      } else if (canAct) {
        phaseIndicator.textContent = 'Action remaining (or Wait)';
        phaseIndicator.style.color = '#d94a4a';
      } else {
        phaseIndicator.textContent = 'Turn complete';
        phaseIndicator.style.color = '#888';
      }
    }
  }

  /**
   * Hide action menu (during enemy turn or when not needed)
   * Note: Old action buttons removed - RadialMenu now handles actions
   */
  hideActionMenu() {
    const menu = this.element.querySelector('#action-menu');
    if (menu) menu.style.display = 'none';
  }

  /**
   * Show action menu (player turn)
   * Note: RadialMenu now handles action selection - this is a no-op
   */
  showActionMenu() {
    // RadialMenu handles action selection now
    // This method is kept for API compatibility
  }

  /**
   * Show targeting mode UI (cancel button visible)
   */
  showTargetingMode() {
    const menu = this.element.querySelector('#action-menu');
    if (menu) menu.style.display = 'block';
  }

  /**
   * Hide targeting mode UI
   */
  hideTargetingMode() {
    const menu = this.element.querySelector('#action-menu');
    if (menu) menu.style.display = 'none';
  }

  /**
   * Show skill selection panel
   * @param {Array} skills - Array of skill objects with id, name, mpCost, icon, description, cooldown, currentCooldown
   * @param {number} currentMp - Current MP of the active unit
   */
  showSkillPanel(skills, currentMp) {
    const panel = this.element.querySelector('#skill-panel');
    const list = this.element.querySelector('#skill-list');
    if (!panel || !list) return;

    list.innerHTML = skills.map(skill => {
      const onCooldown = skill.currentCooldown && skill.currentCooldown > 0;
      const notEnoughMp = skill.mpCost > currentMp;
      const isDisabled = onCooldown || notEnoughMp;
      const _cooldownText = onCooldown ? ` (${skill.currentCooldown}⏱)` : '';
      const titleText = onCooldown
        ? `On cooldown: ${skill.currentCooldown} turn(s) remaining`
        : `${skill.description || skill.name} (${skill.mpCost} MP)`;

      return `
        <button class="btn btn-secondary skill-btn ${onCooldown ? 'on-cooldown' : ''}"
                data-skill-id="${skill.id}"
                ${isDisabled ? 'disabled' : ''}
                title="${titleText}"
                style="${onCooldown ? 'opacity: 0.5; position: relative;' : ''}">
          ${skill.icon || ''} ${skill.name}
          <span style="font-size: 10px; color: ${onCooldown ? '#f88' : '#6af'}; margin-left: 4px;">
            ${onCooldown ? `${skill.currentCooldown}⏱` : `${skill.mpCost}MP`}
          </span>
        </button>
      `;
    }).join('');

    panel.style.display = 'block';

    // Add click handlers for skill buttons
    list.querySelectorAll('.skill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const skillId = btn.dataset.skillId;
        this.actionCallbacks.onSelectSkill?.(skillId);
      });
    });
  }

  /**
   * Hide skill selection panel
   */
  hideSkillPanel() {
    const panel = this.element.querySelector('#skill-panel');
    if (panel) panel.style.display = 'none';
  }

  /**
   * Show item selection panel
   * @param {Array} items - Array of item objects with inventoryId, name, quantity, description
   */
  showItemPanel(items) {
    const panel = this.element.querySelector('#item-panel');
    const list = this.element.querySelector('#item-list');
    const noItems = this.element.querySelector('#no-items');
    if (!panel || !list) return;

    if (!items || items.length === 0) {
      list.innerHTML = '';
      if (noItems) noItems.style.display = 'block';
    } else {
      if (noItems) noItems.style.display = 'none';
      list.innerHTML = items.map(item => `
        <button class="btn btn-secondary item-btn"
                data-item-id="${item.itemId}"
                data-inventory-id="${item.inventoryId}"
                title="${item.description || item.name}">
          ${this.getItemIcon(item.name)} ${item.name}
          <span style="font-size: 10px; color: #8f8; margin-left: 4px;">x${item.quantity}</span>
        </button>
      `).join('');

      // Add click handlers for item buttons
      list.querySelectorAll('.item-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const itemId = btn.dataset.itemId;
          const inventoryId = btn.dataset.inventoryId;
          this.actionCallbacks.onSelectItem?.({ itemId, inventoryId });
        });
      });
    }

    panel.style.display = 'block';
  }

  /**
   * Hide item selection panel
   */
  hideItemPanel() {
    const panel = this.element.querySelector('#item-panel');
    if (panel) panel.style.display = 'none';
  }

  /**
   * Show zodiac ability panel
   * @param {Array} abilities - Array of zodiac ability objects with key, name, description, element
   */
  showZodiacPanel(abilities) {
    const panel = this.element.querySelector('#zodiac-panel');
    const list = this.element.querySelector('#zodiac-list');
    const noZodiac = this.element.querySelector('#no-zodiac');
    if (!panel || !list) return;

    if (!abilities || abilities.length === 0) {
      list.innerHTML = '';
      if (noZodiac) noZodiac.style.display = 'block';
    } else {
      if (noZodiac) noZodiac.style.display = 'none';
      list.innerHTML = abilities.map(ability => {
        const elementIcon = this.getElementIcon(ability.element);
        return `
          <button class="btn btn-secondary zodiac-btn"
                  data-ability-key="${ability.key}"
                  data-needs-target="${ability.needsTarget || false}"
                  title="${ability.description || ability.name}"
                  style="background: linear-gradient(135deg, #2a1f4e 0%, #1a1a2e 100%); border-color: #d4af37;">
            ${elementIcon} ${ability.name}
          </button>
        `;
      }).join('');

      // Add click handlers for zodiac buttons
      list.querySelectorAll('.zodiac-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const abilityKey = btn.dataset.abilityKey;
          const needsTarget = btn.dataset.needsTarget === 'true';
          this.actionCallbacks.onSelectZodiacAbility?.(abilityKey, needsTarget);
        });
      });
    }

    panel.style.display = 'block';
  }

  /**
   * Hide zodiac ability panel
   */
  hideZodiacPanel() {
    const panel = this.element.querySelector('#zodiac-panel');
    if (panel) panel.style.display = 'none';
  }

  /**
   * Get element icon for zodiac abilities
   */
  getElementIcon(element) {
    const icons = {
      fire: String.fromCodePoint(0x1F525),    // Fire emoji
      water: String.fromCodePoint(0x1F4A7),   // Droplet emoji
      earth: String.fromCodePoint(0x26F0),    // Mountain emoji
      air: String.fromCodePoint(0x1F4A8),     // Dashing away emoji
      neutral: String.fromCodePoint(0x2728)   // Sparkles emoji
    };
    return icons[element] || icons.neutral;
  }

  /**
   * Get icon for an item based on its name
   * @param {string} itemName - The item name
   * @returns {string} Icon emoji
   */
  getItemIcon(itemName) {
    const name = itemName.toLowerCase();
    if (name.includes('potion')) return '🧪';
    if (name.includes('ether')) return '💧';
    if (name.includes('elixir')) return '✨';
    if (name.includes('antidote')) return '💊';
    if (name.includes('remedy')) return '💚';
    if (name.includes('phoenix')) return '🔥';
    if (name.includes('bomb')) return '💣';
    if (name.includes('eye')) return '👁️';
    return '📦';
  }

  /**
   * Show battle result
   */
  showResult(status, rewards = null) {
    const panel = this.element.querySelector('#battle-result');
    const title = this.element.querySelector('#result-title');
    const rewardsEl = this.element.querySelector('#result-rewards');

    if (!panel) return;

    panel.style.display = 'block';

    if (title) {
      if (status === 'victory') {
        title.textContent = 'Victory!';
        title.style.color = '#ffd700';
      } else if (status === 'defeat') {
        title.textContent = 'Defeat';
        title.style.color = '#f44336';
      }
    }

    if (rewardsEl && rewards) {
      rewardsEl.innerHTML = `
        <div style="margin-bottom: 8px;">
          <span style="color: #ffd700;">Gold:</span>
          <span style="color: #fff;">+${rewards.gold}</span>
        </div>
        <div>
          <span style="color: #4caf50;">Experience:</span>
          <span style="color: #fff;">+${rewards.experience}</span>
        </div>
      `;
    } else if (rewardsEl) {
      rewardsEl.innerHTML = '';
    }
  }

  /**
   * Get class icon character
   */
  getClassIcon(className) {
    const icons = {
      warrior: 'W',
      wizard: 'M',
      monk: 'K',
      chemist: 'C',
      monster: 'E'
    };
    return icons[className?.toLowerCase()] || '?';
  }

  /**
   * Show turn indicator (displays whose turn it is)
   * @param {string} unitName - Name of the unit whose turn it is
   * @param {string} unitType - Type of unit: 'player', 'player_local', 'player_remote', 'enemy'
   * @param {number} duration - How long to show the indicator (ms), default 2000
   */
  showTurnIndicator(unitName, unitType, duration = 2000) {
    const indicator = this.element?.querySelector('#turn-indicator');
    const content = this.element?.querySelector('.turn-indicator-content');
    const text = this.element?.querySelector('#turn-indicator-text');

    if (!indicator || !content || !text) return;

    // Clear any existing timeout
    if (this.turnIndicatorTimeout) {
      clearTimeout(this.turnIndicatorTimeout);
    }

    // Set text and style based on unit type
    let displayText = '';
    if (unitType === 'player_local') {
      displayText = 'Your Turn!';
    } else if (unitType === 'player_remote') {
      displayText = `${unitName}'s Turn`;
    } else if (unitType === 'enemy') {
      displayText = `Enemy: ${unitName}`;
    } else {
      displayText = `${unitName}'s Turn`;
    }

    text.textContent = displayText;

    // Remove old type classes and add new one
    content.classList.remove('player', 'player_local', 'player_remote', 'enemy');
    content.classList.add(unitType || 'player');

    // Reset animation by forcing reflow
    indicator.style.display = 'none';
    void indicator.offsetWidth; // Force reflow
    indicator.style.display = 'block';

    // Hide after duration
    this.turnIndicatorTimeout = setTimeout(() => {
      indicator.style.display = 'none';
    }, duration);
  }

  /**
   * Hide turn indicator immediately
   */
  hideTurnIndicator() {
    const indicator = this.element?.querySelector('#turn-indicator');
    if (indicator) {
      indicator.style.display = 'none';
    }
    if (this.turnIndicatorTimeout) {
      clearTimeout(this.turnIndicatorTimeout);
      this.turnIndicatorTimeout = null;
    }
  }

  /**
   * Show a temporary notification message
   * @param {string} message - The message to display
   * @param {string} type - Notification type: 'info', 'warning', 'error', 'success'
   * @param {number} duration - How long to show (ms), default 3000
   */
  showNotification(message, type = 'info', duration = 3000) {
    // Use unified parchment toast system for consistent styling
    const toastMethod = parchmentToast[type] || parchmentToast.info;
    toastMethod.call(parchmentToast, message, '', duration);
  }

  /**
   * Clear all notifications
   */
  clearNotifications() {
    const container = this.element?.querySelector('#notification-container');
    if (container) {
      container.innerHTML = '';
    }
  }

  /**
   * Destroy the UI
   */
  destroy() {
    if (this.turnIndicatorTimeout) {
      clearTimeout(this.turnIndicatorTimeout);
      this.turnIndicatorTimeout = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.activeUnitCard) {
      this.activeUnitCard.destroy();
      this.activeUnitCard = null;
    }
    if (this.targetCard) {
      this.targetCard.destroy();
      this.targetCard = null;
    }
    if (this.turnOrderPanel) {
      this.turnOrderPanel.destroy();
      this.turnOrderPanel = null;
    }
    if (this.battleLogPanel) {
      this.battleLogPanel.destroy();
      this.battleLogPanel = null;
    }
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
  }

  /**
   * Add entry to battle log
   * @param {Object} entry - Log entry data
   */
  addBattleLogEntry(entry) {
    if (this.battleLogPanel) {
      this.battleLogPanel.addEntry(entry);
    }
  }

  /**
   * Clear battle log (for new battle)
   */
  clearBattleLog() {
    if (this.battleLogPanel) {
      this.battleLogPanel.clear();
    }
  }

  /**
   * Show/hide battle log based on settings
   * @param {boolean} visible - Whether to show the log
   */
  setBattleLogVisible(visible) {
    if (this.battleLogPanel) {
      if (visible) {
        this.battleLogPanel.show();
      } else {
        this.battleLogPanel.hide();
      }
    }
  }

  /**
   * Update battle log position
   * @param {string} position - 'left' or 'right'
   */
  setBattleLogPosition(position) {
    if (this.battleLogPanel) {
      this.battleLogPanel.setPosition(position);
      const container = this.element?.querySelector('#battle-log-container');
      if (container) {
        if (position === 'left') {
          container.style.right = 'auto';
          container.style.left = '180px';
        } else {
          container.style.left = 'auto';
          container.style.right = '10px';
        }
      }
    }
  }
}
