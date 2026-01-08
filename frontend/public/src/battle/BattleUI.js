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
    this.activeCardTimeout = null;
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
      <!-- Turn Order (left side) -->
      <div id="turn-order" class="battle-panel" style="
        position: absolute;
        top: 10px;
        left: 10px;
        pointer-events: auto;
        min-width: 140px;
      ">
        <div class="ui-panel">
          <div class="ui-panel-header" style="font-size: 12px;">Turn Order</div>
          <div id="turn-order-list" style="max-height: 320px; overflow-y: auto;"></div>
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
          <!-- Two-action turn phase indicator -->
          <div id="action-phase-indicator" style="text-align: center; font-size: 11px; color: #ffd700; margin-bottom: 8px; font-weight: bold;">
            Choose: Move + Action
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-secondary action-btn move-action" id="btn-move" title="Move to a new position">Move</button>
            <button class="btn btn-primary action-btn act-action" id="btn-attack" title="Attack a target">Attack</button>
            <button class="btn btn-info action-btn act-action" id="btn-skill" title="Use a skill">Skill</button>
            <button class="btn btn-success action-btn act-action" id="btn-item" title="Use an item">Item</button>
            <button class="btn btn-secondary action-btn" id="btn-wait" title="End turn">Wait</button>
          </div>
          <!-- Cancel button for targeting mode -->
          <div id="targeting-cancel" style="display: none; margin-top: 8px; text-align: center;">
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

      <!-- Active Unit Detail Card (shown after turn transition) -->
      <div id="active-unit-card" style="
        position: absolute;
        bottom: 100px;
        right: 20px;
        pointer-events: none;
        display: none;
        opacity: 0;
        transition: opacity 0.3s ease-out;
      ">
        <div class="ui-panel" style="display: flex; gap: 10px; padding: 10px; min-width: 180px;">
          <img class="auc-portrait" src="" alt="" style="
            width: 48px;
            height: 48px;
            border-radius: 4px;
            image-rendering: pixelated;
            background: #333;
          ">
          <div class="auc-info" style="flex: 1;">
            <div class="auc-name" style="font-weight: bold; color: #fff; font-size: 13px; margin-bottom: 2px;"></div>
            <div class="auc-class" style="color: #aaa; font-size: 11px; margin-bottom: 6px;"></div>
            <div class="auc-bars">
              <div class="auc-hp-bar" style="height: 6px; background: #333; border-radius: 3px; margin-bottom: 3px;">
                <div class="auc-hp-fill" style="height: 100%; background: #4caf50; border-radius: 3px; transition: width 0.3s ease;"></div>
              </div>
              <div class="auc-mp-bar" style="height: 6px; background: #333; border-radius: 3px;">
                <div class="auc-mp-fill" style="height: 100%; background: #2196f3; border-radius: 3px; transition: width 0.3s ease;"></div>
              </div>
            </div>
          </div>
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
  }

  /**
   * Update turn order display using predicted turns
   */
  updateTurnOrder(battleState) {
    const list = this.element.querySelector('#turn-order-list');
    if (!list) return;

    // Use turn predictions if available, otherwise fall back to unit list
    const predictions = battleState.turnPredictions || [];

    if (predictions.length > 0) {
      // New CT-based display: show predicted turn order
      list.innerHTML = predictions.map((pred, index) => {
        const isActive = index === 0; // First prediction is current turn
        const typeClass = pred.type === 'player' ? 'player' : 'enemy';
        const bgColor = pred.type === 'player' ? '#4a90d9' : '#d94a4a';

        return `
          <div class="turn-unit ${typeClass} ${isActive ? 'active' : ''}">
            <span class="turn-number">${index + 1}.</span>
            <div class="turn-unit-icon" style="background: ${bgColor};">
              ${this.getClassIcon(pred.class)}
            </div>
            <span class="turn-unit-name">${pred.name}</span>
          </div>
        `;
      }).join('');
    } else {
      // Fallback: old style unit list
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
            <span class="turn-unit-name">${unit.name}</span>
          </div>
        `;
      }).join('');
    }

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
   * Show active unit detail card (after turn transition)
   * @param {Object} unit - The active unit to display
   */
  showActiveUnitCard(unit) {
    const card = this.element.querySelector('#active-unit-card');
    if (!card) return;

    // Set portrait (with fallback to class icon)
    const portrait = card.querySelector('.auc-portrait');
    if (portrait) {
      const gender = unit.gender || 'other';
      const portraitUrl = `/assets/sprites/portraits/${unit.race}_${gender}_${unit.class}.png`;
      portrait.src = portraitUrl;
      portrait.onerror = () => {
        // Fallback to colored placeholder
        portrait.style.display = 'none';
      };
      portrait.style.display = 'block';
    }

    // Set name and class
    const nameEl = card.querySelector('.auc-name');
    const classEl = card.querySelector('.auc-class');
    if (nameEl) nameEl.textContent = unit.name;
    if (classEl) {
      const levelText = unit.level ? `Lv.${unit.level}` : '';
      const classText = unit.class ? this.capitalize(unit.class) : '';
      classEl.textContent = [levelText, classText].filter(Boolean).join(' ');
    }

    // Set HP/MP bars
    const hpFill = card.querySelector('.auc-hp-fill');
    const mpFill = card.querySelector('.auc-mp-fill');
    const hpPercent = (unit.hp / unit.maxHp) * 100;
    const mpPercent = (unit.mp / unit.maxMp) * 100;

    if (hpFill) hpFill.style.width = `${hpPercent}%`;
    if (mpFill) mpFill.style.width = `${mpPercent}%`;

    // Show card with fade-in
    card.style.display = 'block';
    // Use requestAnimationFrame to ensure display:block is applied before opacity transition
    requestAnimationFrame(() => {
      card.style.opacity = '1';
    });

    // Auto-hide after 2 seconds
    clearTimeout(this.activeCardTimeout);
    this.activeCardTimeout = setTimeout(() => {
      this.hideActiveUnitCard();
    }, 2000);
  }

  /**
   * Hide active unit detail card
   */
  hideActiveUnitCard() {
    const card = this.element.querySelector('#active-unit-card');
    if (!card) return;

    card.style.opacity = '0';
    // Hide after fade-out transition
    setTimeout(() => {
      card.style.display = 'none';
    }, 300);
  }

  /**
   * Capitalize a string
   */
  capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
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
   * Show targeting mode UI (cancel button visible)
   */
  showTargetingMode() {
    const cancelDiv = this.element.querySelector('#targeting-cancel');
    if (cancelDiv) cancelDiv.style.display = 'block';
  }

  /**
   * Hide targeting mode UI
   */
  hideTargetingMode() {
    const cancelDiv = this.element.querySelector('#targeting-cancel');
    if (cancelDiv) cancelDiv.style.display = 'none';
  }

  /**
   * Show skill selection panel
   * @param {Array} skills - Array of skill objects with id, name, mpCost, icon, description
   * @param {number} currentMp - Current MP of the active unit
   */
  showSkillPanel(skills, currentMp) {
    const panel = this.element.querySelector('#skill-panel');
    const list = this.element.querySelector('#skill-list');
    if (!panel || !list) return;

    list.innerHTML = skills.map(skill => `
      <button class="btn btn-secondary skill-btn"
              data-skill-id="${skill.id}"
              ${skill.mpCost > currentMp ? 'disabled' : ''}
              title="${skill.description} (${skill.mpCost} MP)">
        ${skill.icon || ''} ${skill.name}
        <span style="font-size: 10px; color: #6af; margin-left: 4px;">${skill.mpCost}MP</span>
      </button>
    `).join('');

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
   * Destroy the UI
   */
  destroy() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.activeCardTimeout) {
      clearTimeout(this.activeCardTimeout);
      this.activeCardTimeout = null;
    }
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
  }
}
