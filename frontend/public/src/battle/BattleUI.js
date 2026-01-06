/**
 * BattleUI - User interface for tactical combat
 */
export class BattleUI {
  constructor(game) {
    this.game = game;
    this.element = null;
    this.actionCallbacks = {};
    this.abortController = null;
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
      <!-- Turn Order (left side) -->
      <div id="turn-order" class="battle-panel" style="
        position: absolute;
        top: 10px;
        left: 10px;
        pointer-events: auto;
        min-width: 120px;
      ">
        <div class="ui-panel">
          <div class="ui-panel-header" style="font-size: 12px;">Turn Order</div>
          <div id="turn-order-list" style="max-height: 200px; overflow-y: auto;"></div>
        </div>
      </div>

      <!-- Battle Info (top center) -->
      <div id="battle-info" style="
        position: absolute;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        pointer-events: auto;
      ">
        <div class="ui-panel" style="padding: 8px 16px; text-align: center;">
          <div id="turn-counter" style="font-size: 14px; color: #ffd700;">Turn 1</div>
        </div>
      </div>

      <!-- Active Unit Panel (bottom left) -->
      <div id="active-unit-panel" class="battle-panel" style="
        position: absolute;
        bottom: 10px;
        left: 10px;
        pointer-events: auto;
        min-width: 180px;
      ">
        <div class="ui-panel">
          <div id="active-unit-name" style="font-weight: bold; color: #ffd700; margin-bottom: 8px;"></div>
          <div style="margin-bottom: 6px;">
            <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 2px;">
              <span>HP</span>
              <span id="active-unit-hp">0/0</span>
            </div>
            <div id="active-hp-bar" class="stat-bar">
              <div id="active-hp-fill" class="stat-bar-fill hp"></div>
            </div>
          </div>
          <div>
            <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 2px;">
              <span>MP</span>
              <span id="active-unit-mp">0/0</span>
            </div>
            <div id="active-mp-bar" class="stat-bar">
              <div id="active-mp-fill" class="stat-bar-fill mp"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Action Menu (bottom center) -->
      <div id="action-menu" class="battle-panel" style="
        position: absolute;
        bottom: 10px;
        left: 50%;
        transform: translateX(-50%);
        pointer-events: auto;
      ">
        <div class="ui-panel" style="padding: 10px;">
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-secondary action-btn" id="btn-move" title="Move to a new position">Move</button>
            <button class="btn btn-primary action-btn" id="btn-attack" title="Attack an enemy">Attack</button>
            <button class="btn btn-secondary action-btn" id="btn-wait" title="End turn without acting">Wait</button>
            <button class="btn btn-danger action-btn" id="btn-flee" title="Attempt to flee battle">Flee</button>
          </div>
        </div>
      </div>

      <!-- Target Info (bottom right) -->
      <div id="target-panel" class="battle-panel" style="
        position: absolute;
        bottom: 10px;
        right: 10px;
        pointer-events: auto;
        min-width: 180px;
        display: none;
      ">
        <div class="ui-panel">
          <div id="target-name" style="font-weight: bold; color: #ff6b6b; margin-bottom: 8px;"></div>
          <div style="margin-bottom: 6px;">
            <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 2px;">
              <span>HP</span>
              <span id="target-hp">0/0</span>
            </div>
            <div class="stat-bar">
              <div id="target-hp-fill" class="stat-bar-fill hp"></div>
            </div>
          </div>
          <div id="target-effects" style="font-size: 11px; color: #8a8aaa;"></div>
        </div>
      </div>

      <!-- Confirmation Panel (hidden by default) -->
      <div id="confirm-panel" style="
        position: absolute;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        pointer-events: auto;
        display: none;
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
    `;

    // Add custom styles
    this.addStyles();

    this.game.uiOverlay.appendChild(container);
    this.element = container;

    // Setup event listeners
    this.setupEventListeners();

    // Initial update
    this.updateTurnOrder(battleState);
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
      }
      .action-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
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

    this.element.querySelector('#btn-flee')?.addEventListener('click', () => {
      this.actionCallbacks.onFlee?.();
    }, opts);

    this.element.querySelector('#btn-confirm')?.addEventListener('click', () => {
      this.actionCallbacks.onConfirm?.();
    }, opts);

    this.element.querySelector('#btn-cancel')?.addEventListener('click', () => {
      this.actionCallbacks.onCancel?.();
    }, opts);

    this.element.querySelector('#btn-continue')?.addEventListener('click', () => {
      this.actionCallbacks.onContinue?.();
    }, opts);
  }

  /**
   * Update turn order display
   */
  updateTurnOrder(battleState) {
    const list = this.element.querySelector('#turn-order-list');
    if (!list) return;

    list.innerHTML = battleState.units.map((unit, index) => {
      const isActive = index === battleState.activeUnitIndex;
      const isDead = unit.hp <= 0;
      const typeClass = unit.type === 'player' ? 'player' : 'enemy';
      const bgColor = unit.type === 'player' ? '#4a90d9' : '#d94a4a';

      return `
        <div class="turn-unit ${typeClass} ${isActive ? 'active' : ''} ${isDead ? 'dead' : ''}">
          <div class="turn-unit-icon" style="background: ${bgColor};">
            ${this.getClassIcon(unit.class)}
          </div>
          <span>${unit.name}</span>
        </div>
      `;
    }).join('');

    // Update turn counter
    const turnCounter = this.element.querySelector('#turn-counter');
    if (turnCounter) {
      turnCounter.textContent = `Turn ${battleState.turn}`;
    }
  }

  /**
   * Update active unit panel
   */
  updateActiveUnit(unit) {
    const name = this.element.querySelector('#active-unit-name');
    const hp = this.element.querySelector('#active-unit-hp');
    const mp = this.element.querySelector('#active-unit-mp');
    const hpFill = this.element.querySelector('#active-hp-fill');
    const mpFill = this.element.querySelector('#active-mp-fill');

    if (name) name.textContent = unit.name;
    if (hp) hp.textContent = `${unit.hp}/${unit.maxHp}`;
    if (mp) mp.textContent = `${unit.mp}/${unit.maxMp}`;
    if (hpFill) hpFill.style.width = `${(unit.hp / unit.maxHp) * 100}%`;
    if (mpFill) mpFill.style.width = `${(unit.mp / unit.maxMp) * 100}%`;
  }

  /**
   * Show target info panel
   */
  showTargetInfo(unit) {
    const panel = this.element.querySelector('#target-panel');
    if (!panel) return;

    panel.style.display = 'block';

    const name = this.element.querySelector('#target-name');
    const hp = this.element.querySelector('#target-hp');
    const hpFill = this.element.querySelector('#target-hp-fill');
    const effects = this.element.querySelector('#target-effects');

    if (name) name.textContent = unit.name;
    if (hp) hp.textContent = `${unit.hp}/${unit.maxHp}`;
    if (hpFill) hpFill.style.width = `${(unit.hp / unit.maxHp) * 100}%`;
    if (effects) {
      effects.textContent = unit.statusEffects?.length > 0
        ? `Effects: ${unit.statusEffects.map(e => e.type).join(', ')}`
        : '';
    }
  }

  /**
   * Hide target info panel
   */
  hideTargetInfo() {
    const panel = this.element.querySelector('#target-panel');
    if (panel) panel.style.display = 'none';
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
   * Hide action menu (during enemy turn)
   */
  hideActionMenu() {
    const menu = this.element.querySelector('#action-menu');
    if (menu) menu.style.display = 'none';
  }

  /**
   * Show action menu (player turn)
   */
  showActionMenu() {
    const menu = this.element.querySelector('#action-menu');
    if (menu) menu.style.display = 'block';
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
      } else if (status === 'fled') {
        title.textContent = 'Escaped!';
        title.style.color = '#8a8aaa';
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
   * Destroy the UI
   */
  destroy() {
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
