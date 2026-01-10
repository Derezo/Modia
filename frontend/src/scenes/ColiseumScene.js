import { Scene } from './Scene.js';

/**
 * ColiseumScene - PvP Arena for matchmaking and battles
 * Features: Queue selection, matchmaking status, ready check, opponent info
 */
export class ColiseumScene extends Scene {
  constructor(game) {
    super(game);
    this.uiElement = null;

    // Queue state
    this.selectedQueue = null; // '1v1', '3v3', '5v5'
    this.queueStatus = null; // { position, queueSize, estimatedWait }
    this.isInQueue = false;

    // Match state
    this.currentMatch = null; // { matchId, opponent, readyDeadline }
    this.isReady = false;
    this.opponentReady = false;
    this.matchCountdown = null;

    // Stats
    this.queueStatuses = [];

    // WebSocket handlers
    this.wsHandlers = {};
  }

  async enter(data = {}) {
    this.addStyles();
    this.createUI();
    this.setupEventListeners();
    this.setupWebSocketHandlers();

    // Load queue statuses
    await this.loadQueueStatuses();
  }

  exit() {
    // Leave queue if in one
    if (this.isInQueue) {
      this.leaveQueue();
    }

    // Clear countdown if running
    if (this.matchCountdown) {
      clearInterval(this.matchCountdown);
      this.matchCountdown = null;
    }

    // Remove WebSocket handlers
    Object.entries(this.wsHandlers).forEach(([type, handler]) => {
      this.game.socket.off(type, handler);
    });
    this.wsHandlers = {};

    if (this.uiElement) {
      this.uiElement.remove();
      this.uiElement = null;
    }
  }

  addStyles() {
    if (document.getElementById('coliseum-scene-styles')) return;

    const style = document.createElement('style');
    style.id = 'coliseum-scene-styles';
    style.textContent = `
      .coliseum-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, #2a1a1a 0%, #1a0a0a 100%);
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 20px;
        box-sizing: border-box;
      }

      .coliseum-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: 100%;
        max-width: 800px;
        margin-bottom: 20px;
      }

      .coliseum-title {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .coliseum-title h2 {
        margin: 0;
        color: #ff4444;
        text-shadow: 0 0 10px rgba(255, 68, 68, 0.5);
      }

      .coliseum-title-icon {
        font-size: 32px;
      }

      .coliseum-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 100%;
        max-width: 800px;
        overflow-y: auto;
      }

      .queue-selection {
        display: flex;
        gap: 20px;
        margin-bottom: 30px;
        flex-wrap: wrap;
        justify-content: center;
      }

      .queue-card {
        background: rgba(0, 0, 0, 0.4);
        border: 2px solid #444;
        border-radius: 12px;
        padding: 20px;
        min-width: 180px;
        text-align: center;
        cursor: pointer;
        transition: all 0.3s;
      }

      .queue-card:hover {
        border-color: #ff4444;
        transform: translateY(-4px);
        box-shadow: 0 8px 20px rgba(255, 68, 68, 0.3);
      }

      .queue-card.selected {
        border-color: #ff4444;
        background: rgba(255, 68, 68, 0.1);
      }

      .queue-card.disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .queue-card-title {
        font-size: 24px;
        font-weight: bold;
        color: #ff6666;
        margin-bottom: 8px;
      }

      .queue-card-desc {
        font-size: 13px;
        color: #aaa;
        margin-bottom: 12px;
      }

      .queue-card-status {
        font-size: 12px;
        color: #888;
      }

      .queue-card-players {
        color: #4a90d9;
      }

      .queue-panel {
        background: rgba(0, 0, 0, 0.5);
        border: 2px solid #444;
        border-radius: 12px;
        padding: 30px;
        text-align: center;
        width: 100%;
        max-width: 400px;
      }

      .queue-panel-title {
        font-size: 18px;
        color: #fff;
        margin-bottom: 20px;
      }

      .queue-btn {
        padding: 15px 40px;
        font-size: 18px;
        font-weight: bold;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .queue-btn.join {
        background: linear-gradient(180deg, #ff4444, #cc0000);
        color: white;
      }

      .queue-btn.join:hover:not(:disabled) {
        background: linear-gradient(180deg, #ff6666, #dd2222);
        transform: scale(1.05);
      }

      .queue-btn.leave {
        background: linear-gradient(180deg, #666, #444);
        color: white;
      }

      .queue-btn.leave:hover {
        background: linear-gradient(180deg, #888, #666);
      }

      .queue-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .queue-status {
        margin-top: 20px;
        padding: 20px;
        background: rgba(0, 0, 0, 0.3);
        border-radius: 8px;
      }

      .queue-position {
        font-size: 36px;
        font-weight: bold;
        color: #ff4444;
        margin-bottom: 8px;
      }

      .queue-label {
        font-size: 14px;
        color: #888;
        margin-bottom: 16px;
      }

      .queue-waiting {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        color: #aaa;
      }

      .queue-spinner {
        width: 20px;
        height: 20px;
        border: 3px solid #444;
        border-top-color: #ff4444;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      .match-found-panel {
        background: linear-gradient(135deg, rgba(255, 215, 0, 0.2), rgba(255, 140, 0, 0.2));
        border: 3px solid #ffd700;
        border-radius: 12px;
        padding: 30px;
        text-align: center;
        width: 100%;
        max-width: 500px;
        animation: pulse 2s ease-in-out infinite;
      }

      @keyframes pulse {
        0%, 100% { box-shadow: 0 0 20px rgba(255, 215, 0, 0.3); }
        50% { box-shadow: 0 0 40px rgba(255, 215, 0, 0.6); }
      }

      .match-found-title {
        font-size: 28px;
        font-weight: bold;
        color: #ffd700;
        margin-bottom: 20px;
        text-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
      }

      .opponent-info {
        background: rgba(0, 0, 0, 0.3);
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 20px;
      }

      .opponent-label {
        font-size: 12px;
        color: #888;
        margin-bottom: 8px;
      }

      .opponent-name {
        font-size: 20px;
        color: #ff4444;
        font-weight: bold;
      }

      .opponent-level {
        font-size: 14px;
        color: #aaa;
        margin-top: 4px;
      }

      .ready-section {
        margin-top: 20px;
      }

      .ready-btn {
        padding: 15px 50px;
        font-size: 20px;
        font-weight: bold;
        background: linear-gradient(180deg, #00aa00, #008800);
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .ready-btn:hover:not(:disabled) {
        background: linear-gradient(180deg, #00cc00, #00aa00);
        transform: scale(1.05);
      }

      .ready-btn.ready {
        background: linear-gradient(180deg, #888, #666);
      }

      .ready-btn:disabled {
        cursor: not-allowed;
      }

      .ready-status {
        display: flex;
        justify-content: center;
        gap: 30px;
        margin-top: 16px;
      }

      .ready-indicator {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
      }

      .ready-indicator .dot {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #444;
      }

      .ready-indicator .dot.ready {
        background: #00ff00;
        box-shadow: 0 0 10px rgba(0, 255, 0, 0.5);
      }

      .countdown {
        font-size: 18px;
        color: #ff4444;
        margin-top: 16px;
      }

      .countdown-number {
        font-size: 36px;
        font-weight: bold;
      }

      .match-starting {
        background: rgba(0, 255, 0, 0.1);
        border-color: #00ff00;
      }

      .match-starting .match-found-title {
        color: #00ff00;
      }
    `;
    document.head.appendChild(style);
  }

  createUI() {
    this.uiElement = document.createElement('div');
    this.uiElement.className = 'coliseum-container';

    this.uiElement.innerHTML = `
      <div class="coliseum-header">
        <div class="coliseum-title">
          <span class="coliseum-title-icon">&#9876;</span>
          <h2>The Coliseum</h2>
        </div>
        <button class="btn btn-secondary" id="coliseum-back-btn">Back to World</button>
      </div>

      <div class="coliseum-content" id="coliseum-content">
        ${this.renderContent()}
      </div>
    `;

    document.body.appendChild(this.uiElement);
  }

  renderContent() {
    // Match found state
    if (this.currentMatch) {
      return this.renderMatchFound();
    }

    // Queue state
    if (this.isInQueue) {
      return this.renderQueueStatus();
    }

    // Queue selection
    return this.renderQueueSelection();
  }

  renderQueueSelection() {
    const queueTypes = [
      { id: '1v1', name: '1v1 Duel', desc: 'Solo combat', partySize: 1 },
      { id: '3v3', name: '3v3 Skirmish', desc: '3 character teams', partySize: 3 },
      { id: '5v5', name: '5v5 Battle', desc: '5 character teams', partySize: 5 }
    ];

    return `
      <h3 style="color: #ccc; margin-bottom: 24px;">Select Arena Type</h3>

      <div class="queue-selection">
        ${queueTypes.map(q => {
          const status = this.queueStatuses.find(s => s.queueType === q.id);
          const playersInQueue = status?.queueSize || 0;
          const isSelected = this.selectedQueue === q.id;

          return `
            <div class="queue-card ${isSelected ? 'selected' : ''}" data-queue="${q.id}">
              <div class="queue-card-title">${q.name}</div>
              <div class="queue-card-desc">${q.desc}</div>
              <div class="queue-card-status">
                <span class="queue-card-players">${playersInQueue}</span> in queue
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <div class="queue-panel">
        <div class="queue-panel-title">
          ${this.selectedQueue ? `Join ${this.selectedQueue} Queue` : 'Select an arena type above'}
        </div>
        <button class="queue-btn join" id="join-queue-btn" ${!this.selectedQueue ? 'disabled' : ''}>
          Enter Queue
        </button>
      </div>
    `;
  }

  renderQueueStatus() {
    const position = this.queueStatus?.position || '?';
    const queueSize = this.queueStatus?.queueSize || '?';
    const waitTime = this.formatWaitTime(this.queueStatus?.estimatedWait || 0);

    return `
      <div class="queue-panel" style="max-width: 500px;">
        <div class="queue-panel-title">Searching for ${this.selectedQueue} Match...</div>

        <div class="queue-status">
          <div class="queue-position">#${position}</div>
          <div class="queue-label">Position in Queue (${queueSize} players waiting)</div>

          <div class="queue-waiting">
            <div class="queue-spinner"></div>
            <span>Estimated wait: ${waitTime}</span>
          </div>
        </div>

        <button class="queue-btn leave" id="leave-queue-btn" style="margin-top: 20px;">
          Leave Queue
        </button>
      </div>
    `;
  }

  renderMatchFound() {
    const match = this.currentMatch;
    const isStarting = this.isReady && this.opponentReady;

    return `
      <div class="match-found-panel ${isStarting ? 'match-starting' : ''}">
        <div class="match-found-title">
          ${isStarting ? 'MATCH STARTING!' : 'MATCH FOUND!'}
        </div>

        <div class="opponent-info">
          <div class="opponent-label">Your Opponent</div>
          <div class="opponent-name">${match.opponent?.username || 'Unknown'}</div>
          <div class="opponent-level">Avg Level: ${match.opponent?.partyLevel || '?'}</div>
        </div>

        <div class="ready-section">
          <button class="ready-btn ${this.isReady ? 'ready' : ''}" id="ready-btn" ${this.isReady ? 'disabled' : ''}>
            ${this.isReady ? 'READY!' : 'Click to Ready'}
          </button>

          <div class="ready-status">
            <div class="ready-indicator">
              <div class="dot ${this.isReady ? 'ready' : ''}"></div>
              <span>You</span>
            </div>
            <div class="ready-indicator">
              <div class="dot ${this.opponentReady ? 'ready' : ''}"></div>
              <span>Opponent</span>
            </div>
          </div>

          <div class="countdown" id="ready-countdown"></div>
        </div>
      </div>
    `;
  }

  setupEventListeners() {
    // Back button
    this.uiElement.querySelector('#coliseum-back-btn')?.addEventListener('click', () => {
      this.game.sceneManager.changeScene('worldMap');
    });

    // Re-setup content listeners
    this.setupContentListeners();
  }

  setupContentListeners() {
    const content = this.uiElement.querySelector('#coliseum-content');
    if (!content) return;

    // Queue selection cards
    content.querySelectorAll('.queue-card').forEach(card => {
      card.addEventListener('click', () => {
        if (!this.isInQueue && !this.currentMatch) {
          this.selectedQueue = card.dataset.queue;
          this.updateContent();
        }
      });
    });

    // Join queue button
    content.querySelector('#join-queue-btn')?.addEventListener('click', () => {
      if (this.selectedQueue) {
        this.joinQueue();
      }
    });

    // Leave queue button
    content.querySelector('#leave-queue-btn')?.addEventListener('click', () => {
      this.leaveQueue();
    });

    // Ready button
    content.querySelector('#ready-btn')?.addEventListener('click', () => {
      if (!this.isReady && this.currentMatch) {
        this.sendReady();
      }
    });
  }

  setupWebSocketHandlers() {
    const handlers = {
      'coliseum:queue_joined': (payload) => {
        this.isInQueue = true;
        this.queueStatus = {
          position: payload.position,
          queueSize: payload.queueSize,
          estimatedWait: payload.estimatedWait
        };
        this.updateContent();
      },

      'coliseum:queue_left': (payload) => {
        this.isInQueue = false;
        this.queueStatus = null;
        this.updateContent();
      },

      'coliseum:queue_update': (payload) => {
        this.queueStatus = {
          position: payload.position,
          queueSize: payload.queueSize,
          estimatedWait: payload.estimatedWait
        };
        this.updateContent();
      },

      'coliseum:match_found': (payload) => {
        this.isInQueue = false;
        this.currentMatch = {
          matchId: payload.matchId,
          opponent: payload.opponent,
          readyDeadline: payload.readyDeadline
        };
        this.isReady = false;
        this.opponentReady = false;
        this.updateContent();
        this.startReadyCountdown();
        this.game.showNotification('Match found! Get ready!', 'success');
      },

      'coliseum:opponent_ready': (payload) => {
        this.opponentReady = true;
        this.updateContent();
      },

      'coliseum:match_ready': (payload) => {
        // Both players ready - match starting
        this.isReady = true;
        this.opponentReady = true;
        this.updateContent();
        this.game.showNotification('Match starting in 3 seconds!', 'success');
      },

      'coliseum:match_started': async (payload) => {
        // Transition to battle scene
        this.game.showNotification('Battle begins!', 'success');

        // Clear match state before transitioning
        this.currentMatch = null;
        this.isReady = false;
        this.opponentReady = false;
        if (this.matchCountdown) {
          clearInterval(this.matchCountdown);
          this.matchCountdown = null;
        }

        try {
          // Fetch full battle state from the rejoin endpoint
          const response = await this.game.api.request(`/battle/${payload.battleId}/rejoin`);

          if (response.success !== false) {
            // Transition to BattleScene with full battle data
            this.game.sceneManager.changeScene('battle', {
              battleId: response.battleId || payload.battleId,
              battleType: 'pvp',
              mapSeed: response.mapSeed || payload.mapSeed,
              mapWidth: response.mapWidth || 32,
              mapHeight: response.mapHeight || 32,
              state: response.state,
              opponentUsername: payload.opponentUsername
            });
          } else {
            throw new Error(response.message || 'Failed to load battle');
          }
        } catch (error) {
          console.error('[Coliseum] Failed to load PvP battle:', error);
          this.game.showNotification('Failed to load battle. Please try again.', 'error');
          // Reset to queue view
          this.updateContent();
        }
      },

      'coliseum:match_cancelled': (payload) => {
        this.currentMatch = null;
        this.isReady = false;
        this.opponentReady = false;
        if (this.matchCountdown) {
          clearInterval(this.matchCountdown);
          this.matchCountdown = null;
        }
        this.updateContent();
        this.game.showNotification(payload.reason || 'Match cancelled', 'warning');
      }
    };

    Object.entries(handlers).forEach(([type, handler]) => {
      this.wsHandlers[type] = handler;
      this.game.socket.on(type, handler);
    });
  }

  async loadQueueStatuses() {
    try {
      // Use WebSocket to get queue statuses or fetch from API
      // For now, initialize with empty data
      this.queueStatuses = [
        { queueType: '1v1', queueSize: 0 },
        { queueType: '3v3', queueSize: 0 },
        { queueType: '5v5', queueSize: 0 }
      ];
      this.updateContent();
    } catch (err) {
      console.error('Failed to load queue statuses:', err);
    }
  }

  joinQueue() {
    if (!this.selectedQueue || this.isInQueue) return;

    // Get party info
    const partyLevel = this.getAveragePartyLevel();
    const partySize = this.getPartySize();

    // Send WebSocket message to join queue
    this.game.socket.send('coliseum_queue_join', {
      queueType: this.selectedQueue,
      partyLevel,
      partySize
    });

    // Optimistically update UI
    this.isInQueue = true;
    this.queueStatus = { position: 1, queueSize: 1, estimatedWait: 0 };
    this.updateContent();
  }

  leaveQueue() {
    if (!this.isInQueue) return;

    this.game.socket.send('coliseum_queue_leave', {
      queueType: this.selectedQueue
    });

    this.isInQueue = false;
    this.queueStatus = null;
    this.updateContent();
  }

  sendReady() {
    if (!this.currentMatch || this.isReady) return;

    this.game.socket.send('coliseum_ready', {
      matchId: this.currentMatch.matchId
    });

    this.isReady = true;
    this.updateContent();
  }

  startReadyCountdown() {
    if (this.matchCountdown) {
      clearInterval(this.matchCountdown);
    }

    const deadline = this.currentMatch?.readyDeadline;
    if (!deadline) return;

    this.matchCountdown = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      const countdownEl = this.uiElement?.querySelector('#ready-countdown');

      if (countdownEl) {
        if (remaining > 0) {
          countdownEl.innerHTML = `Time to ready: <span class="countdown-number">${remaining}s</span>`;
        } else {
          countdownEl.innerHTML = 'Time expired!';
        }
      }

      if (remaining <= 0) {
        clearInterval(this.matchCountdown);
        this.matchCountdown = null;
      }
    }, 100);
  }

  getAveragePartyLevel() {
    // Get average level of battle party
    const characters = this.game.characters || [];
    const battleParty = characters.filter(c => c.party_slot && c.party_slot <= 5);
    if (battleParty.length === 0) return 1;
    const totalLevel = battleParty.reduce((sum, c) => sum + c.level, 0);
    return Math.floor(totalLevel / battleParty.length);
  }

  getPartySize() {
    const characters = this.game.characters || [];
    return characters.filter(c => c.party_slot && c.party_slot <= 5).length || 1;
  }

  formatWaitTime(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs}s`;
  }

  updateContent() {
    const content = this.uiElement?.querySelector('#coliseum-content');
    if (content) {
      content.innerHTML = this.renderContent();
      this.setupContentListeners();

      // Restart countdown if match is active
      if (this.currentMatch && !this.matchCountdown) {
        this.startReadyCountdown();
      }
    }
  }

  update(deltaTime) {
    // No frame updates needed
  }

  render(ctx) {
    // UI-only scene
  }
}
