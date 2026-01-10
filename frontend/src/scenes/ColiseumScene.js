import { Scene } from './Scene.js';

/**
 * ColiseumScene - PvP Arena for matchmaking and battles
 * Features: Queue selection, matchmaking status, ready check, opponent info,
 *           leaderboards, match history, and match details
 */
export class ColiseumScene extends Scene {
  constructor(game) {
    super(game);
    this.uiElement = null;

    // Tab state
    this.activeTab = 'queue'; // 'queue', 'leaderboard', 'history'

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

    // Leaderboard state
    this.leaderboardData = [];
    this.leaderboardQueueType = '1v1';
    this.leaderboardTimeFilter = 'all'; // 'all', 'week', 'today'
    this.userRank = null;
    this.loadingLeaderboard = false;

    // Match history state
    this.matchHistoryData = [];
    this.matchHistoryFilter = 'all'; // 'all', 'mine'
    this.matchHistoryOffset = 0;
    this.matchHistoryLimit = 20;
    this.hasMoreMatches = true;
    this.loadingHistory = false;

    // Match details modal
    this.selectedMatchDetails = null;
    this.loadingMatchDetails = false;

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
        max-width: 900px;
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

      /* Tab Navigation */
      .coliseum-tabs {
        display: flex;
        gap: 4px;
        width: 100%;
        max-width: 900px;
        margin-bottom: 20px;
        background: rgba(0, 0, 0, 0.3);
        padding: 8px;
        border-radius: 12px;
      }

      .coliseum-tab {
        padding: 12px 24px;
        background: rgba(0, 0, 0, 0.3);
        border: 2px solid transparent;
        border-radius: 8px;
        color: #888;
        cursor: pointer;
        transition: all 0.2s;
        font-size: 14px;
        font-weight: bold;
        flex: 1;
        text-align: center;
      }

      .coliseum-tab:hover {
        background: rgba(255, 68, 68, 0.1);
        color: #ff6666;
      }

      .coliseum-tab.active {
        background: rgba(255, 68, 68, 0.2);
        border-color: #ff4444;
        color: #ff4444;
      }

      .coliseum-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 100%;
        max-width: 900px;
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

      /* Leaderboard Styles */
      .leaderboard-container {
        width: 100%;
        max-width: 800px;
      }

      .leaderboard-filters {
        display: flex;
        gap: 16px;
        margin-bottom: 20px;
        flex-wrap: wrap;
      }

      .filter-group {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .filter-group label {
        color: #888;
        font-size: 14px;
      }

      .filter-group select {
        padding: 8px 12px;
        background: rgba(0, 0, 0, 0.5);
        border: 1px solid #444;
        border-radius: 6px;
        color: #fff;
        font-size: 14px;
        cursor: pointer;
      }

      .filter-group select:hover {
        border-color: #ff4444;
      }

      .leaderboard-table {
        width: 100%;
        border-collapse: collapse;
        background: rgba(0, 0, 0, 0.4);
        border-radius: 12px;
        overflow: hidden;
      }

      .leaderboard-table th,
      .leaderboard-table td {
        padding: 14px 16px;
        text-align: left;
        border-bottom: 1px solid #333;
      }

      .leaderboard-table th {
        background: rgba(255, 68, 68, 0.2);
        color: #ff6666;
        font-weight: bold;
        font-size: 13px;
        text-transform: uppercase;
      }

      .leaderboard-table tr:hover {
        background: rgba(255, 68, 68, 0.1);
      }

      .leaderboard-table tr.current-user {
        background: rgba(255, 215, 0, 0.15);
        border-left: 3px solid #ffd700;
      }

      .leaderboard-table tr.current-user td:first-child::before {
        content: '';
        margin-right: 6px;
      }

      .rank-cell {
        font-weight: bold;
        color: #fff;
        min-width: 60px;
      }

      .rank-1 { color: #ffd700; }
      .rank-2 { color: #c0c0c0; }
      .rank-3 { color: #cd7f32; }

      .crown-icon {
        font-size: 18px;
        margin-left: 4px;
      }

      .player-name {
        color: #4a90d9;
        font-weight: 500;
      }

      .rating-cell {
        color: #ff4444;
        font-weight: bold;
      }

      .winloss-cell {
        color: #aaa;
      }

      .winloss-cell .wins { color: #4caf50; }
      .winloss-cell .losses { color: #f44336; }

      .streak-cell {
        color: #ffd700;
      }

      .user-rank-banner {
        margin-top: 20px;
        padding: 16px;
        background: rgba(255, 215, 0, 0.1);
        border: 1px solid #ffd700;
        border-radius: 8px;
        text-align: center;
      }

      .user-rank-banner .rank-label {
        color: #888;
        font-size: 14px;
        margin-bottom: 4px;
      }

      .user-rank-banner .rank-value {
        color: #ffd700;
        font-size: 24px;
        font-weight: bold;
      }

      .loading-spinner {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 40px;
        color: #888;
      }

      .no-data-message {
        padding: 40px;
        text-align: center;
        color: #666;
        font-style: italic;
      }

      /* Match History Styles */
      .history-container {
        width: 100%;
        max-width: 800px;
      }

      .history-filters {
        display: flex;
        gap: 16px;
        margin-bottom: 20px;
      }

      .history-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .match-card {
        background: rgba(0, 0, 0, 0.4);
        border: 1px solid #333;
        border-radius: 10px;
        padding: 16px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        transition: all 0.2s;
      }

      .match-card:hover {
        border-color: #ff4444;
        background: rgba(255, 68, 68, 0.1);
      }

      .match-card.victory {
        border-left: 4px solid #4caf50;
      }

      .match-card.defeat {
        border-left: 4px solid #f44336;
      }

      .match-info {
        flex: 1;
      }

      .match-result {
        font-size: 16px;
        color: #fff;
        margin-bottom: 6px;
      }

      .match-result .winner {
        color: #4caf50;
        font-weight: bold;
      }

      .match-result .loser {
        color: #f44336;
      }

      .match-meta {
        display: flex;
        gap: 16px;
        font-size: 12px;
        color: #888;
      }

      .match-meta span {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .rating-change {
        font-weight: bold;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 14px;
      }

      .rating-change.positive {
        background: rgba(76, 175, 80, 0.2);
        color: #4caf50;
      }

      .rating-change.negative {
        background: rgba(244, 67, 54, 0.2);
        color: #f44336;
      }

      .details-btn {
        padding: 8px 16px;
        background: rgba(74, 144, 217, 0.2);
        border: 1px solid #4a90d9;
        border-radius: 6px;
        color: #4a90d9;
        cursor: pointer;
        font-size: 13px;
        transition: all 0.2s;
        margin-left: 16px;
      }

      .details-btn:hover {
        background: rgba(74, 144, 217, 0.4);
      }

      .load-more-btn {
        margin-top: 20px;
        padding: 12px 32px;
        background: rgba(255, 68, 68, 0.2);
        border: 1px solid #ff4444;
        border-radius: 8px;
        color: #ff4444;
        cursor: pointer;
        font-size: 14px;
        transition: all 0.2s;
      }

      .load-more-btn:hover:not(:disabled) {
        background: rgba(255, 68, 68, 0.4);
      }

      .load-more-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* Match Details Modal */
      .match-details-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }

      .match-details-content {
        background: linear-gradient(135deg, #2a1a1a, #1a0a0a);
        border: 2px solid #ff4444;
        border-radius: 16px;
        padding: 24px;
        max-width: 800px;
        width: 90%;
        max-height: 80vh;
        overflow-y: auto;
      }

      .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 24px;
        padding-bottom: 16px;
        border-bottom: 1px solid #444;
      }

      .modal-header h3 {
        margin: 0;
        color: #ff4444;
        font-size: 22px;
      }

      .modal-close-btn {
        background: none;
        border: none;
        color: #888;
        font-size: 28px;
        cursor: pointer;
        padding: 0;
        line-height: 1;
      }

      .modal-close-btn:hover {
        color: #ff4444;
      }

      .match-details-result {
        text-align: center;
        padding: 20px;
        background: rgba(0, 0, 0, 0.3);
        border-radius: 12px;
        margin-bottom: 24px;
      }

      .result-text {
        font-size: 24px;
        font-weight: bold;
        margin-bottom: 8px;
      }

      .result-text.victory { color: #4caf50; }
      .result-text.defeat { color: #f44336; }

      .rating-changes {
        display: flex;
        justify-content: center;
        gap: 32px;
        margin-top: 12px;
      }

      .rating-change-item {
        text-align: center;
      }

      .rating-change-item .label {
        font-size: 12px;
        color: #888;
        margin-bottom: 4px;
      }

      .rating-change-item .value {
        font-size: 18px;
        font-weight: bold;
      }

      .teams-section {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 24px;
        margin-bottom: 24px;
      }

      .team-panel {
        background: rgba(0, 0, 0, 0.3);
        border-radius: 12px;
        padding: 16px;
      }

      .team-panel.winner {
        border: 2px solid #4caf50;
      }

      .team-panel.loser {
        border: 2px solid #f44336;
      }

      .team-header {
        font-size: 14px;
        font-weight: bold;
        margin-bottom: 12px;
        padding-bottom: 8px;
        border-bottom: 1px solid #333;
      }

      .team-header.winner { color: #4caf50; }
      .team-header.loser { color: #f44336; }

      .character-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .character-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 6px;
      }

      .character-name {
        color: #fff;
        font-weight: 500;
      }

      .character-class {
        font-size: 12px;
        color: #888;
      }

      .character-level {
        color: #ffd700;
        font-size: 13px;
      }

      .equipment-list {
        margin-top: 6px;
        padding-left: 12px;
        font-size: 11px;
      }

      .equipment-item {
        color: #888;
        margin-bottom: 2px;
      }

      .equipment-item.common { color: #aaa; }
      .equipment-item.uncommon { color: #2ecc71; }
      .equipment-item.rare { color: #3498db; }
      .equipment-item.epic { color: #9b59b6; }
      .equipment-item.legendary { color: #f39c12; }

      .stats-section {
        background: rgba(0, 0, 0, 0.3);
        border-radius: 12px;
        padding: 16px;
        margin-bottom: 24px;
      }

      .stats-header {
        font-size: 14px;
        font-weight: bold;
        color: #ff6666;
        margin-bottom: 12px;
      }

      .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 12px;
      }

      .stat-item {
        background: rgba(0, 0, 0, 0.2);
        padding: 12px;
        border-radius: 6px;
        text-align: center;
      }

      .stat-item .stat-value {
        font-size: 20px;
        font-weight: bold;
        color: #fff;
      }

      .stat-item .stat-label {
        font-size: 11px;
        color: #888;
        margin-top: 4px;
      }

      .mvp-section {
        background: linear-gradient(135deg, rgba(255, 215, 0, 0.2), rgba(255, 140, 0, 0.1));
        border: 2px solid #ffd700;
        border-radius: 12px;
        padding: 16px;
        text-align: center;
      }

      .mvp-header {
        font-size: 12px;
        color: #ffd700;
        margin-bottom: 8px;
        text-transform: uppercase;
        letter-spacing: 1px;
      }

      .mvp-name {
        font-size: 20px;
        font-weight: bold;
        color: #fff;
      }

      .mvp-stats {
        font-size: 13px;
        color: #aaa;
        margin-top: 8px;
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

      <div class="coliseum-tabs">
        <button class="coliseum-tab ${this.activeTab === 'queue' ? 'active' : ''}" data-tab="queue">Queue</button>
        <button class="coliseum-tab ${this.activeTab === 'leaderboard' ? 'active' : ''}" data-tab="leaderboard">Leaderboards</button>
        <button class="coliseum-tab ${this.activeTab === 'history' ? 'active' : ''}" data-tab="history">Match History</button>
      </div>

      <div class="coliseum-content" id="coliseum-content">
        ${this.renderContent()}
      </div>
    `;

    document.body.appendChild(this.uiElement);
  }

  renderContent() {
    switch (this.activeTab) {
      case 'leaderboard':
        return this.renderLeaderboard();
      case 'history':
        return this.renderMatchHistory();
      case 'queue':
      default:
        return this.renderQueueContent();
    }
  }

  renderQueueContent() {
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

  renderLeaderboard() {
    if (this.loadingLeaderboard) {
      return `
        <div class="leaderboard-container">
          <div class="loading-spinner">
            <div class="queue-spinner"></div>
            <span style="margin-left: 10px;">Loading leaderboard...</span>
          </div>
        </div>
      `;
    }

    return `
      <div class="leaderboard-container">
        <div class="leaderboard-filters">
          <div class="filter-group">
            <label>Queue Type:</label>
            <select id="leaderboard-queue-filter">
              <option value="1v1" ${this.leaderboardQueueType === '1v1' ? 'selected' : ''}>1v1 Duel</option>
              <option value="3v3" ${this.leaderboardQueueType === '3v3' ? 'selected' : ''}>3v3 Skirmish</option>
              <option value="5v5" ${this.leaderboardQueueType === '5v5' ? 'selected' : ''}>5v5 Battle</option>
            </select>
          </div>
          <div class="filter-group">
            <label>Time Period:</label>
            <select id="leaderboard-time-filter">
              <option value="all" ${this.leaderboardTimeFilter === 'all' ? 'selected' : ''}>All Time</option>
              <option value="week" ${this.leaderboardTimeFilter === 'week' ? 'selected' : ''}>This Week</option>
              <option value="today" ${this.leaderboardTimeFilter === 'today' ? 'selected' : ''}>Today</option>
            </select>
          </div>
        </div>

        ${this.leaderboardData.length === 0 ? `
          <div class="no-data-message">No rankings available yet. Be the first to compete!</div>
        ` : `
          <table class="leaderboard-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Player</th>
                <th>Rating</th>
                <th>W/L</th>
                <th>Streak</th>
              </tr>
            </thead>
            <tbody>
              ${this.leaderboardData.map((entry, index) => {
                const rank = index + 1;
                const isCurrentUser = entry.userId === this.game.userId;
                const crownIcon = rank === 1 ? '<span class="crown-icon">&#128081;</span>' : '';

                return `
                  <tr class="${isCurrentUser ? 'current-user' : ''}">
                    <td class="rank-cell rank-${rank <= 3 ? rank : ''}">#${rank}${crownIcon}</td>
                    <td class="player-name">${entry.username}</td>
                    <td class="rating-cell">${entry.rating}</td>
                    <td class="winloss-cell">
                      <span class="wins">${entry.wins}</span> / <span class="losses">${entry.losses}</span>
                    </td>
                    <td class="streak-cell">${entry.winStreak > 0 ? entry.winStreak + ' wins' : '-'}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>

          ${this.userRank && this.userRank > 100 ? `
            <div class="user-rank-banner">
              <div class="rank-label">Your Rank</div>
              <div class="rank-value">#${this.userRank}</div>
            </div>
          ` : ''}
        `}
      </div>
    `;
  }

  renderMatchHistory() {
    if (this.loadingHistory && this.matchHistoryData.length === 0) {
      return `
        <div class="history-container">
          <div class="loading-spinner">
            <div class="queue-spinner"></div>
            <span style="margin-left: 10px;">Loading match history...</span>
          </div>
        </div>
      `;
    }

    return `
      <div class="history-container">
        <div class="history-filters">
          <div class="filter-group">
            <label>Filter:</label>
            <select id="history-filter">
              <option value="all" ${this.matchHistoryFilter === 'all' ? 'selected' : ''}>All Matches</option>
              <option value="mine" ${this.matchHistoryFilter === 'mine' ? 'selected' : ''}>My Matches</option>
            </select>
          </div>
        </div>

        ${this.matchHistoryData.length === 0 ? `
          <div class="no-data-message">No matches found. Start battling to build your history!</div>
        ` : `
          <div class="history-list">
            ${this.matchHistoryData.map(match => {
              const isWinner = match.winnerId === this.game.userId;
              const isLoser = match.loserId === this.game.userId;
              const isMyMatch = isWinner || isLoser;
              const resultClass = isMyMatch ? (isWinner ? 'victory' : 'defeat') : '';
              const ratingChange = isWinner ? match.winnerRatingChange : (isLoser ? match.loserRatingChange : null);

              return `
                <div class="match-card ${resultClass}">
                  <div class="match-info">
                    <div class="match-result">
                      <span class="winner">${match.winnerUsername}</span>
                      <span style="color: #666;"> defeated </span>
                      <span class="loser">${match.loserUsername}</span>
                    </div>
                    <div class="match-meta">
                      <span>${match.queueType}</span>
                      <span>${match.turnCount || '?'} turns</span>
                      <span>${this.formatTimestamp(match.createdAt)}</span>
                    </div>
                  </div>
                  ${ratingChange !== null ? `
                    <div class="rating-change ${ratingChange >= 0 ? 'positive' : 'negative'}">
                      ${ratingChange >= 0 ? '+' : ''}${ratingChange}
                    </div>
                  ` : ''}
                  <button class="details-btn" data-match-id="${match.id}">Details</button>
                </div>
              `;
            }).join('')}
          </div>

          ${this.hasMoreMatches ? `
            <button class="load-more-btn" id="load-more-matches" ${this.loadingHistory ? 'disabled' : ''}>
              ${this.loadingHistory ? 'Loading...' : 'Load More'}
            </button>
          ` : ''}
        `}
      </div>

      ${this.selectedMatchDetails ? this.renderMatchDetailsModal() : ''}
    `;
  }

  renderMatchDetailsModal() {
    const details = this.selectedMatchDetails;

    if (this.loadingMatchDetails) {
      return `
        <div class="match-details-modal">
          <div class="match-details-content">
            <div class="loading-spinner">
              <div class="queue-spinner"></div>
              <span style="margin-left: 10px;">Loading match details...</span>
            </div>
          </div>
        </div>
      `;
    }

    const isWinner = details.winnerId === this.game.userId;
    const isLoser = details.loserId === this.game.userId;
    const isMyMatch = isWinner || isLoser;
    const myRatingChange = isWinner ? details.winnerRatingChange : (isLoser ? details.loserRatingChange : null);

    // Parse snapshots if they exist
    const winnerTeam = details.matchSnapshot?.winner || [];
    const loserTeam = details.matchSnapshot?.loser || [];
    const stats = details.matchStats || {};
    const mvp = stats.mvp || null;

    return `
      <div class="match-details-modal" id="match-details-modal">
        <div class="match-details-content">
          <div class="modal-header">
            <h3>Match Details</h3>
            <button class="modal-close-btn" id="close-match-details">&times;</button>
          </div>

          <div class="match-details-result">
            ${isMyMatch ? `
              <div class="result-text ${isWinner ? 'victory' : 'defeat'}">
                ${isWinner ? 'VICTORY!' : 'DEFEAT'}
              </div>
            ` : `
              <div class="result-text" style="color: #fff;">
                ${details.winnerUsername} defeated ${details.loserUsername}
              </div>
            `}

            <div class="rating-changes">
              <div class="rating-change-item">
                <div class="label">${details.winnerUsername}</div>
                <div class="value" style="color: #4caf50;">+${details.winnerRatingChange || 0}</div>
              </div>
              <div class="rating-change-item">
                <div class="label">${details.loserUsername}</div>
                <div class="value" style="color: #f44336;">${details.loserRatingChange || 0}</div>
              </div>
            </div>
          </div>

          <div class="teams-section">
            <div class="team-panel winner">
              <div class="team-header winner">${details.winnerUsername}'s Team</div>
              <div class="character-list">
                ${winnerTeam.length > 0 ? winnerTeam.map(char => this.renderCharacterItem(char)).join('') : `
                  <div class="no-data-message" style="padding: 10px;">Team data not available</div>
                `}
              </div>
            </div>
            <div class="team-panel loser">
              <div class="team-header loser">${details.loserUsername}'s Team</div>
              <div class="character-list">
                ${loserTeam.length > 0 ? loserTeam.map(char => this.renderCharacterItem(char)).join('') : `
                  <div class="no-data-message" style="padding: 10px;">Team data not available</div>
                `}
              </div>
            </div>
          </div>

          ${Object.keys(stats).length > 0 ? `
            <div class="stats-section">
              <div class="stats-header">Battle Statistics</div>
              <div class="stats-grid">
                ${stats.totalDamage ? `
                  <div class="stat-item">
                    <div class="stat-value">${stats.totalDamage}</div>
                    <div class="stat-label">Total Damage</div>
                  </div>
                ` : ''}
                ${stats.totalHealing ? `
                  <div class="stat-item">
                    <div class="stat-value">${stats.totalHealing}</div>
                    <div class="stat-label">Total Healing</div>
                  </div>
                ` : ''}
                ${stats.turnCount ? `
                  <div class="stat-item">
                    <div class="stat-value">${stats.turnCount}</div>
                    <div class="stat-label">Turns</div>
                  </div>
                ` : ''}
                ${stats.duration ? `
                  <div class="stat-item">
                    <div class="stat-value">${this.formatDuration(stats.duration)}</div>
                    <div class="stat-label">Duration</div>
                  </div>
                ` : ''}
              </div>
            </div>
          ` : ''}

          ${mvp ? `
            <div class="mvp-section">
              <div class="mvp-header">Most Valuable Player</div>
              <div class="mvp-name">${mvp.name}</div>
              <div class="mvp-stats">
                ${mvp.damage ? `Damage: ${mvp.damage}` : ''}
                ${mvp.kills ? ` | Kills: ${mvp.kills}` : ''}
                ${mvp.healing ? ` | Healing: ${mvp.healing}` : ''}
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  renderCharacterItem(char) {
    return `
      <div class="character-item">
        <div>
          <div class="character-name">${char.name}</div>
          <div class="character-class">${char.class}</div>
          ${char.equipment && char.equipment.length > 0 ? `
            <div class="equipment-list">
              ${char.equipment.map(item => `
                <div class="equipment-item ${item.rarity || 'common'}">${item.name}</div>
              `).join('')}
            </div>
          ` : ''}
        </div>
        <div class="character-level">Lv.${char.level}</div>
      </div>
    `;
  }

  setupEventListeners() {
    // Back button
    this.uiElement.querySelector('#coliseum-back-btn')?.addEventListener('click', () => {
      this.game.sceneManager.changeScene('worldMap');
    });

    // Tab navigation
    this.uiElement.querySelectorAll('.coliseum-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        if (tabName !== this.activeTab) {
          this.activeTab = tabName;
          this.updateTabs();
          this.updateContent();

          // Load data for the new tab
          if (tabName === 'leaderboard') {
            this.loadLeaderboard();
          } else if (tabName === 'history') {
            this.matchHistoryData = [];
            this.matchHistoryOffset = 0;
            this.hasMoreMatches = true;
            this.loadMatchHistory();
          }
        }
      });
    });

    // Re-setup content listeners
    this.setupContentListeners();
  }

  updateTabs() {
    this.uiElement.querySelectorAll('.coliseum-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === this.activeTab);
    });
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

    // Leaderboard filters
    content.querySelector('#leaderboard-queue-filter')?.addEventListener('change', (e) => {
      this.leaderboardQueueType = e.target.value;
      this.loadLeaderboard();
    });

    content.querySelector('#leaderboard-time-filter')?.addEventListener('change', (e) => {
      this.leaderboardTimeFilter = e.target.value;
      this.loadLeaderboard();
    });

    // Match history filter
    content.querySelector('#history-filter')?.addEventListener('change', (e) => {
      this.matchHistoryFilter = e.target.value;
      this.matchHistoryData = [];
      this.matchHistoryOffset = 0;
      this.hasMoreMatches = true;
      this.loadMatchHistory();
    });

    // Load more matches button
    content.querySelector('#load-more-matches')?.addEventListener('click', () => {
      this.loadMatchHistory();
    });

    // Match details buttons
    content.querySelectorAll('.details-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const matchId = parseInt(btn.dataset.matchId, 10);
        this.loadMatchDetails(matchId);
      });
    });

    // Close match details modal
    content.querySelector('#close-match-details')?.addEventListener('click', () => {
      this.selectedMatchDetails = null;
      this.updateContent();
    });

    // Close modal on background click
    content.querySelector('#match-details-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'match-details-modal') {
        this.selectedMatchDetails = null;
        this.updateContent();
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
        this.activeTab = 'queue'; // Switch to queue tab when match found
        this.updateTabs();
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
          const response = await this.game.api.request('GET', `/battle/${payload.battleId}/rejoin`);

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

  async loadLeaderboard() {
    this.loadingLeaderboard = true;
    this.updateContent();

    try {
      const data = await this.game.api.getColiseumLeaderboard(
        this.leaderboardQueueType,
        100,
        this.leaderboardTimeFilter
      );

      this.leaderboardData = data.leaderboard || [];
      this.userRank = data.userRank || null;
    } catch (err) {
      console.error('Failed to load leaderboard:', err);
      this.game.showNotification('Failed to load leaderboard', 'error');
      this.leaderboardData = [];
    } finally {
      this.loadingLeaderboard = false;
      this.updateContent();
    }
  }

  async loadMatchHistory() {
    if (this.loadingHistory) return;

    this.loadingHistory = true;
    this.updateContent();

    try {
      const data = await this.game.api.getColiseumMatches(
        this.matchHistoryFilter,
        this.matchHistoryLimit,
        this.matchHistoryOffset
      );

      const newMatches = data.matches || [];
      this.matchHistoryData = [...this.matchHistoryData, ...newMatches];
      this.matchHistoryOffset += newMatches.length;
      this.hasMoreMatches = newMatches.length === this.matchHistoryLimit;
    } catch (err) {
      console.error('Failed to load match history:', err);
      this.game.showNotification('Failed to load match history', 'error');
    } finally {
      this.loadingHistory = false;
      this.updateContent();
    }
  }

  async loadMatchDetails(matchId) {
    this.loadingMatchDetails = true;
    this.selectedMatchDetails = { id: matchId }; // Placeholder to show loading
    this.updateContent();

    try {
      const data = await this.game.api.getColiseumMatchDetails(matchId);
      this.selectedMatchDetails = data.match || data;
    } catch (err) {
      console.error('Failed to load match details:', err);
      this.game.showNotification('Failed to load match details', 'error');
      this.selectedMatchDetails = null;
    } finally {
      this.loadingMatchDetails = false;
      this.updateContent();
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

  formatTimestamp(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  }

  formatDuration(seconds) {
    if (!seconds) return '-';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
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
