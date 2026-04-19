/**
 * @module BattleUI
 * @description User interface overlay for tactical turn-based combat.
 *
 * Key responsibilities:
 * - Action menu display and button state management
 * - Active unit and target info cards (ParchmentCard integration)
 * - Turn order panel coordination (TurnOrderPanel - legacy, hidden)
 * - Battle log display (BattleLogPanel - legacy, hidden)
 * - New modal-based UI: BattleMenuDropdown, TurnOrderModal, BattleLogModal
 * - Damage/heal preview overlays on target cards
 * - Skill, item, and zodiac ability selection panels
 * - Connection quality indicator (Canvas-based, rendered via BattleScene)
 *
 * Delegated to sub-modules:
 * - BattlePvPUI.js: PvP turn timer, surrender button/modal, opponent disconnect overlay
 * - BattleConfirmationUI.js: Turn indicators, confirmation dialogs, battle results, notifications
 *
 * @see BattleScene.js - Orchestrates battle and calls UI methods
 * @see ParchmentCard.js - Character/enemy info cards
 * @see BattlePvPUI.js - PvP-specific UI elements
 * @see BattleConfirmationUI.js - Dialogs and notifications
 * @see TurnOrderPanel.js - Turn order display (legacy, replaced by TurnOrderModal)
 * @see BattleLogPanel.js - Combat history log (legacy, replaced by BattleLogModal)
 * @see BattleMenuDropdown.js - Compact menu trigger with badge
 * @see TurnOrderModal.js - Full turn order modal with rich unit info
 * @see BattleLogModal.js - Full battle log modal with filtering
 * @see ConnectionIndicator.js - WebSocket connection quality display
 */
import { ParchmentCard } from '../components/ParchmentCard.js';
import { parchmentToast } from '../ui/parchment/ParchmentToast.js';
import TurnOrderPanel from './TurnOrderPanel.js';
import BattleLogPanel from './BattleLogPanel.js';
import BattleMenuDropdown from './BattleMenuDropdown.js';
import TurnOrderModal from './TurnOrderModal.js';
import BattleLogModal from './BattleLogModal.js';
import { ConnectionIndicator } from '../ui/ConnectionIndicator.js';
import { BattlePvPUI } from './BattlePvPUI.js';
import { BattleConfirmationUI } from './BattleConfirmationUI.js';
import { injectBattleUIStyles } from './ui/BattleUIStyles.js';
import {
  renderSkillPanel,
  renderItemPanel,
  renderZodiacPanel
} from './ui/BattleSelectionPanels.js';

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
    this.turnOrderPanel = null;  // TurnOrderPanel for turn order display (legacy, kept for backwards compat)
    this.battleLogPanel = null;  // BattleLogPanel for combat history (legacy, kept for backwards compat)
    this.previewUnit = null;     // Unit being previewed from turn order
    this.hoveredBattleUnit = null; // Unit hovered/tapped on battlefield
    this.confirmTargetUnit = null; // Unit being targeted for attack confirmation
    this.activeEnemyUnit = null;   // Active enemy unit (on enemy turn)

    // New modal-based UI components
    this.menuDropdown = null;    // BattleMenuDropdown - compact menu trigger
    this.turnOrderModal = null;  // TurnOrderModal - full turn order modal
    this.battleLogModal = null;  // BattleLogModal - full battle log modal
    this.scene = null;           // Reference to BattleScene for camera pan

    // Connection quality indicator (Canvas-based, rendered by BattleScene)
    this.connectionIndicator = null;
    this.canvas = null;          // Reference to canvas for indicator positioning

    // Delegated UI modules
    this.pvpUI = null;           // BattlePvPUI - PvP-specific UI
    this.confirmationUI = null;  // BattleConfirmationUI - Dialogs/notifications
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

      <!-- Turn Indicator (sticky at top, shows until next turn) -->
      <div id="turn-indicator" style="
        position: absolute;
        top: 10px;
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

      <!-- PvP Opponent Turn Indicator -->
      <div id="opponent-turn-indicator" style="
        position: absolute;
        top: 80px;
        left: 50%;
        transform: translateX(-50%);
        pointer-events: none;
        display: none;
        z-index: 102;
      ">
        <div class="opponent-turn-content">
          <span class="opponent-turn-icon">&#9203;</span>
          <span id="opponent-turn-text">Waiting for opponent...</span>
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

    // Initialize TurnOrderPanel (top left) - LEGACY: kept for backwards compatibility
    // The new BattleMenuDropdown + TurnOrderModal replaces this for the primary UI
    this.turnOrderPanel = new TurnOrderPanel({
      onUnitTap: (unit) => this.handleTurnOrderTap(unit),
      onPreviewUnit: (unit) => this.handleTurnOrderPreview(unit)
    });
    const turnOrderContainer = container.querySelector('#turn-order-container');
    if (turnOrderContainer) {
      // Hide the legacy turn order panel - replaced by menuDropdown
      turnOrderContainer.style.display = 'none';
      turnOrderContainer.appendChild(this.turnOrderPanel.element);
    }

    // Initialize BattleLogPanel (top right) - LEGACY: kept for backwards compatibility
    // The new BattleMenuDropdown + BattleLogModal replaces this for the primary UI
    const battleSettings = this.game.state?.settings?.battle || {};
    const logPosition = battleSettings.battleLogPosition || 'right';
    const logVisible = battleSettings.battleLogVisible !== false; // Default to true

    this.battleLogPanel = new BattleLogPanel({
      position: logPosition,
      maxEntries: 50
    });
    const battleLogContainer = container.querySelector('#battle-log-container');
    if (battleLogContainer) {
      // Hide the legacy battle log panel - replaced by battleLogModal
      battleLogContainer.style.display = 'none';
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

    // Initialize new modal-based UI components
    // TurnOrderModal - full modal showing next 10 turns with rich unit info
    this.turnOrderModal = new TurnOrderModal({
      onUnitClick: (unit) => this.handleModalUnitClick(unit),
      onClose: () => {}
    });

    // BattleLogModal - full modal showing complete battle history with filtering
    this.battleLogModal = new BattleLogModal({
      onUnitClick: (unit) => this.handleModalUnitClick(unit),
      onClose: () => {}
    });

    // BattleMenuDropdown - compact menu trigger at top-left
    this.menuDropdown = new BattleMenuDropdown({
      onOpenTurnOrder: () => this.openTurnOrderModal(),
      onOpenBattleLog: () => this.openBattleLogModal()
    });
    this.menuDropdown.show();

    // Initialize delegated UI modules
    this.pvpUI = new BattlePvPUI(this);
    this.confirmationUI = new BattleConfirmationUI(this);

    // Setup delegated event listeners
    this.setupDelegatedEventListeners();

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
    injectBattleUIStyles();
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

    this.element.querySelector('#btn-cancel-targeting')?.addEventListener('click', () => {
      this.actionCallbacks.onCancel?.();
    }, opts);
  }

  /**
   * Setup event listeners for delegated UI modules (called after modules are initialized)
   */
  setupDelegatedEventListeners() {
    const signal = this.abortController.signal;

    // Setup PvP-specific event listeners
    if (this.pvpUI) {
      this.pvpUI.setupEventListeners(this.actionCallbacks, signal);
    }

    // Setup confirmation-specific event listeners
    if (this.confirmationUI) {
      this.confirmationUI.setupEventListeners(this.actionCallbacks, signal);
    }
  }

  // ==========================================
  // PvP-Specific Methods (delegated to BattlePvPUI)
  // ==========================================

  /**
   * Enable PvP mode - shows PvP-specific UI elements
   */
  enablePvPMode() {
    this.pvpUI?.enablePvPMode();
  }

  /**
   * Disable PvP mode - hides PvP-specific UI elements
   */
  disablePvPMode() {
    this.pvpUI?.disablePvPMode();
  }

  /**
   * Update PvP turn timer
   * @param {number} remainingSeconds - Seconds remaining in turn
   * @param {number} totalSeconds - Total turn time (default 60)
   */
  updateTurnTimer(remainingSeconds, totalSeconds = 60) {
    this.pvpUI?.updateTurnTimer(remainingSeconds, totalSeconds);
  }

  /**
   * Hide turn timer (during opponent's turn in PvP)
   */
  hideTurnTimer() {
    this.pvpUI?.hideTurnTimer();
  }

  /**
   * Show turn timer (during player's turn in PvP)
   */
  showTurnTimer() {
    this.pvpUI?.showTurnTimer();
  }

  /**
   * Show surrender confirmation modal
   */
  showSurrenderModal() {
    this.pvpUI?.showSurrenderModal();
  }

  /**
   * Hide surrender confirmation modal
   */
  hideSurrenderModal() {
    this.pvpUI?.hideSurrenderModal();
  }

  /**
   * Show opponent disconnected overlay
   * @param {number} remainingSeconds - Seconds until forfeit
   */
  showDisconnectedOverlay(remainingSeconds) {
    this.pvpUI?.showDisconnectedOverlay(remainingSeconds);
  }

  /**
   * Hide opponent disconnected overlay
   */
  hideDisconnectedOverlay() {
    this.pvpUI?.hideDisconnectedOverlay();
  }

  /**
   * Show opponent turn indicator (PvP - waiting for opponent's action)
   * @param {string} opponentName - Name of the opponent
   */
  showOpponentTurnIndicator(opponentName) {
    this.pvpUI?.showOpponentTurnIndicator(opponentName);
  }

  /**
   * Hide opponent turn indicator
   */
  hideOpponentTurnIndicator() {
    this.pvpUI?.hideOpponentTurnIndicator();
  }

  /**
   * Update turn order display using TurnOrderPanel and new modal/dropdown system
   */
  updateTurnOrder(battleState) {
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
          class: u.class,
          hp: u.hp,
          maxHp: u.maxHp,
          ct: u.ct,
          statusEffects: u.statusEffects
        }));
    }

    // Update the legacy panel (kept for backwards compatibility)
    if (this.turnOrderPanel) {
      this.turnOrderPanel.update(predictions, battleState.activeUnitIndex || 0);
    }

    // Update the menu dropdown's "Next: [Unit]" indicator
    if (this.menuDropdown) {
      // Get the next unit (after the current one)
      const nextUnit = predictions.length > 1 ? predictions[1] : predictions[0];
      this.menuDropdown.setNextUnit(nextUnit || null);
    }

    // Update the turn order modal if it's open
    if (this.turnOrderModal && this.turnOrderModal.isOpen()) {
      this.turnOrderModal.updateTurnOrder(predictions);
    }
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
    this.confirmationUI?.showConfirmation(text);
  }

  /**
   * Hide confirmation panel
   */
  hideConfirmation() {
    this.confirmationUI?.hideConfirmation();
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

    renderSkillPanel(list, skills, currentMp, this.actionCallbacks.onSelectSkill);
    panel.style.display = 'block';
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

    renderItemPanel(list, noItems, items, this.actionCallbacks.onSelectItem);
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

    renderZodiacPanel(list, noZodiac, abilities, this.actionCallbacks.onSelectZodiacAbility);
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
   * Show battle result
   * @param {string} status - 'victory', 'defeat', 'surrender', or 'draw'
   * @param {Object|null} rewards - Optional rewards object
   */
  showResult(status, rewards = null) {
    this.confirmationUI?.showResult(status, rewards);
  }

  /**
   * Hide battle result panel
   */
  hideResult() {
    this.confirmationUI?.hideResult();
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
   * @param {Object} unitData - Unit data object with: { name, level, race, class, type }
   * @param {string} unitType - Type of unit: 'player', 'player_local', 'player_remote', 'enemy'
   */
  showTurnIndicator(unitData, unitType) {
    this.confirmationUI?.showTurnIndicator(unitData, unitType);
  }

  /**
   * Hide turn indicator immediately
   */
  hideTurnIndicator() {
    this.confirmationUI?.hideTurnIndicator();
  }

  /**
   * Hide UI elements during outro sequence (victory/defeat screen)
   * Hides portrait cards, turn indicator, and other battle HUD elements
   */
  hideForOutro() {
    // Hide active unit panel (bottom-left portrait card)
    const activePanel = this.element?.querySelector('#active-unit-panel');
    if (activePanel) activePanel.style.display = 'none';

    // Hide target panel (bottom-right portrait card)
    const targetPanel = this.element?.querySelector('#target-panel');
    if (targetPanel) targetPanel.style.display = 'none';

    // Hide turn indicator
    this.confirmationUI?.hideTurnIndicator();

    // Hide menu dropdown (top-left battle menu)
    if (this.menuDropdown) {
      this.menuDropdown.hide();
    }
  }

  /**
   * Show a temporary notification message
   * @param {string} message - The message to display
   * @param {string} type - Notification type: 'info', 'warning', 'error', 'success'
   * @param {number} duration - How long to show (ms), default 3000
   */
  showNotification(message, type = 'info', duration = 3000) {
    this.confirmationUI?.showNotification(message, type, duration);
  }

  /**
   * Clear all notifications
   */
  clearNotifications() {
    this.confirmationUI?.clearNotifications();
  }

  // ==========================================
  // Modal-Based UI Methods
  // ==========================================

  /**
   * Set reference to the BattleScene for camera pan functionality
   * @param {Object} scene - BattleScene instance
   */
  setScene(scene) {
    this.scene = scene;
  }

  // ==========================================
  // Connection Quality Indicator Methods
  // ==========================================

  /**
   * Initialize the connection quality indicator.
   * The indicator is Canvas-based and rendered by BattleScene.
   * @param {import('../api/connectionQuality.js').ConnectionQualityManager} connectionQualityManager - Connection quality manager instance
   * @param {HTMLCanvasElement} canvas - Canvas element for positioning calculations
   */
  initConnectionIndicator(connectionQualityManager, canvas) {
    if (!connectionQualityManager) {
      console.warn('[BattleUI] No connection quality manager provided');
      return;
    }

    this.canvas = canvas;
    this.connectionIndicator = new ConnectionIndicator(connectionQualityManager);

    // Position in top-right of battle area
    this.updateIndicatorPosition();
  }

  /**
   * Update the connection indicator position based on canvas size.
   * Called on initialization and when canvas resizes.
   */
  updateIndicatorPosition() {
    if (!this.connectionIndicator) return;

    // Position in top-right corner, accounting for HUD elements
    // Leave room for PvP surrender button (right: 10px, ~100px wide)
    const x = this.canvas?.width ? (this.canvas.width / (window.devicePixelRatio || 1)) - 130 : 650;
    const y = 20; // Below any top UI elements

    this.connectionIndicator.setPosition(x, y);
  }

  /**
   * Update the connection indicator animation.
   * Called by BattleScene in its update loop.
   * @param {number} deltaTime - Time since last update in milliseconds
   */
  updateConnectionIndicator(deltaTime) {
    this.connectionIndicator?.update(deltaTime);
  }

  /**
   * Render the connection indicator on the canvas.
   * Called by BattleScene in its render loop.
   * @param {CanvasRenderingContext2D} ctx - Canvas rendering context
   */
  renderConnectionIndicator(ctx) {
    this.connectionIndicator?.render(ctx);
  }

  /**
   * Handle mouse move for connection indicator tooltip.
   * @param {number} x - Mouse X coordinate in canvas space
   * @param {number} y - Mouse Y coordinate in canvas space
   */
  handleConnectionIndicatorMouseMove(x, y) {
    this.connectionIndicator?.handleMouseMove(x, y);
  }

  /**
   * Handle click on connection indicator.
   * @param {number} x - Click X coordinate in canvas space
   * @param {number} y - Click Y coordinate in canvas space
   * @returns {boolean} True if click was handled by the indicator
   */
  handleConnectionIndicatorClick(x, y) {
    if (this.connectionIndicator?.handleClick(x, y)) {
      this.showConnectionDetails();
      return true;
    }
    return false;
  }

  /**
   * Show connection details (currently logs to console).
   * Could be extended to show a modal with full diagnostics.
   */
  showConnectionDetails() {
    if (this.connectionIndicator?.qualityManager) {
      const state = this.connectionIndicator.qualityManager.getState();
      console.log('[BattleUI] Connection Details:', state);

      // Show a toast with connection info
      const label = {
        healthy: 'Connected',
        degraded: 'Slow Connection',
        unstable: 'Unstable Connection',
        disconnected: 'Disconnected',
        reconnecting: 'Reconnecting...'
      }[state.state] || 'Unknown';

      parchmentToast.info(
        `${label} - Latency: ${state.latencyMs}ms`,
        'Connection Status'
      );
    }
  }

  /**
   * Handle canvas resize - update indicator position.
   * @param {number} _width - New canvas width (unused, canvas already updated)
   * @param {number} _height - New canvas height (unused, canvas already updated)
   */
  onResize(_width, _height) {
    // Canvas dimensions are already updated by the caller
    // Just update the indicator position based on new canvas size
    this.updateIndicatorPosition();
  }

  /**
   * Open the turn order modal
   */
  openTurnOrderModal() {
    if (this.turnOrderModal) {
      this.turnOrderModal.open();
    }
  }

  /**
   * Open the battle log modal (resets badge count)
   */
  openBattleLogModal() {
    // Reset badge count when opening the log
    if (this.menuDropdown) {
      this.menuDropdown.resetBadge();
    }
    if (this.battleLogModal) {
      this.battleLogModal.open();
    }
  }

  /**
   * Handle unit click from modals - pans camera to unit and shows info card
   * @param {Object} unit - The clicked unit
   */
  handleModalUnitClick(unit) {
    if (!unit) return;

    // Pan camera to unit position
    if (this.scene && this.scene.camera && unit.position) {
      this.scene.camera.panTo(unit.position.x, unit.position.y);
    }

    // Also trigger the existing preview callback if available
    if (this.actionCallbacks.onUnitPreview) {
      this.actionCallbacks.onUnitPreview(unit);
    }

    // Show in target panel
    this.showTargetInfo(unit);
  }

  /**
   * Destroy the UI
   */
  destroy() {
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
    // Clean up new modal-based components
    if (this.menuDropdown) {
      this.menuDropdown.destroy();
      this.menuDropdown = null;
    }
    if (this.turnOrderModal) {
      this.turnOrderModal.destroy();
      this.turnOrderModal = null;
    }
    if (this.battleLogModal) {
      this.battleLogModal.destroy();
      this.battleLogModal = null;
    }
    // Clean up connection indicator
    if (this.connectionIndicator) {
      this.connectionIndicator.destroy();
      this.connectionIndicator = null;
    }
    // Clean up delegated UI modules
    if (this.pvpUI) {
      this.pvpUI.destroy();
      this.pvpUI = null;
    }
    if (this.confirmationUI) {
      this.confirmationUI.destroy();
      this.confirmationUI = null;
    }
    this.canvas = null;
    this.scene = null;
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
    // Add to legacy panel (kept for backwards compatibility)
    if (this.battleLogPanel) {
      this.battleLogPanel.addEntry(entry);
    }

    // Add to new battle log modal
    if (this.battleLogModal) {
      this.battleLogModal.addEntry(entry);
    }

    // Increment badge count on menu dropdown (only if modal is not open)
    if (this.menuDropdown && this.battleLogModal && !this.battleLogModal.isVisible()) {
      this.menuDropdown.incrementBadge();
    }
  }

  /**
   * Clear battle log (for new battle)
   */
  clearBattleLog() {
    // Clear legacy panel
    if (this.battleLogPanel) {
      this.battleLogPanel.clear();
    }

    // Clear new battle log modal
    if (this.battleLogModal) {
      this.battleLogModal.clear();
    }

    // Reset badge count on menu dropdown
    if (this.menuDropdown) {
      this.menuDropdown.resetBadge();
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
