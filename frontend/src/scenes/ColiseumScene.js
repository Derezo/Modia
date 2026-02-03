import { Scene } from './Scene.js';
import { parchmentToast } from '../ui/parchment/ParchmentToast.js';
import { getColiseumStyles } from './coliseum/coliseumStyles.js';
import { renderQueueContent, renderLeaderboard, renderMatchHistory } from './coliseum/tabs/index.js';

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
    this.queuePlayers = []; // Array of players in queue

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

    // Player stats (rating/tier)
    this.playerStats = null;
    this.playerRating = null;

    // WebSocket handlers
    this.wsHandlers = {};
  }

  async enter(_data = {}) {
    // Reset match state from any previous battle
    this.resetMatchState();

    this.addStyles();
    this.createUI();
    this.setupEventListeners();
    this.setupWebSocketHandlers();

    // Join coliseum lobby for real-time queue updates
    this.game.socket.send({ type: 'coliseum_lobby_join' });

    // Play coliseum theme music
    if (this.game.musicContext) {
      this.game.musicContext.playColiseumTheme();
    }

    // Load queue statuses and player stats
    await Promise.all([
      this.loadQueueStatuses(),
      this.loadPlayerStats()
    ]);
  }

  exit() {
    // Leave queue if in one (before resetting state)
    if (this.isInQueue) {
      this.leaveQueue();
    }

    // Leave coliseum lobby
    this.game.socket.send({ type: 'coliseum_lobby_leave' });

    // Reset match state (includes clearing countdown)
    this.resetMatchState();

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

  /**
   * Reset match-related state when entering scene
   * Called on entry to clear stale state from completed matches
   */
  resetMatchState() {
    // Clear any running countdown timer
    if (this.matchCountdown) {
      clearInterval(this.matchCountdown);
      this.matchCountdown = null;
    }

    // Reset match state
    this.currentMatch = null;
    this.isReady = false;
    this.opponentReady = false;

    // Reset queue state (match was found, so queue was left)
    this.isInQueue = false;
    this.queueStatus = null;
    this.selectedQueue = null;
  }

  addStyles() {
    if (document.getElementById('coliseum-scene-styles')) return;

    const style = document.createElement('style');
    style.id = 'coliseum-scene-styles';
    style.textContent = getColiseumStyles();
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

  /**
   * Get context object for tab components
   */
  getContext() {
    const scene = this;
    return {
      // Data access
      get game() { return scene.game; },
      get queueStatuses() { return scene.queueStatuses; },
      get selectedQueue() { return scene.selectedQueue; },
      get queueStatus() { return scene.queueStatus; },
      get isInQueue() { return scene.isInQueue; },
      get queuePlayers() { return scene.queuePlayers; },
      get currentMatch() { return scene.currentMatch; },
      get isReady() { return scene.isReady; },
      get opponentReady() { return scene.opponentReady; },
      get leaderboardData() { return scene.leaderboardData; },
      get leaderboardQueueType() { return scene.leaderboardQueueType; },
      get leaderboardTimeFilter() { return scene.leaderboardTimeFilter; },
      get userRank() { return scene.userRank; },
      get loadingLeaderboard() { return scene.loadingLeaderboard; },
      get matchHistoryData() { return scene.matchHistoryData; },
      get matchHistoryFilter() { return scene.matchHistoryFilter; },
      get hasMoreMatches() { return scene.hasMoreMatches; },
      get loadingHistory() { return scene.loadingHistory; },
      get selectedMatchDetails() { return scene.selectedMatchDetails; },
      get loadingMatchDetails() { return scene.loadingMatchDetails; },
      get playerStats() { return scene.playerStats; },
      get playerRating() { return scene.playerRating; },

      // Bound methods
      formatWaitTime: (s) => scene.formatWaitTime(s),
      formatTimestamp: (t) => scene.formatTimestamp(t),
      formatDuration: (s) => scene.formatDuration(s)
    };
  }

  renderContent() {
    const context = this.getContext();

    switch (this.activeTab) {
      case 'leaderboard':
        return renderLeaderboard(context);
      case 'history':
        return renderMatchHistory(context);
      case 'queue':
      default:
        return renderQueueContent(context);
    }
  }

  setupEventListeners() {
    // Back button
    this.uiElement.querySelector('#coliseum-back-btn')?.addEventListener('click', () => {
      this.game.audio?.playUI('button_click');
      this.game.scenes.changeScene('worldMap');
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
    content.querySelectorAll('.coliseum-queue-card').forEach(card => {
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
    content.querySelectorAll('.coliseum-details-btn').forEach(btn => {
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
        // Load queue players list
        this.loadQueuePlayers();
      },

      'coliseum:queue_left': (_payload) => {
        this.isInQueue = false;
        this.queueStatus = null;
        this.queuePlayers = [];
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

      'coliseum:queue_players_update': (payload) => {
        this.queuePlayers = payload.players || [];
        // Also update queue status from the player count
        if (this.queueStatus) {
          this.queueStatus.queueSize = payload.totalPlayers || this.queuePlayers.length;
        }
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
        // Play match found notification sound
        this.game.audio?.playInteraction('match_found');
        parchmentToast.success('Match Found', 'Get ready!');
      },

      'coliseum:opponent_ready': (_payload) => {
        this.opponentReady = true;
        this.updateContent();
      },

      'coliseum:match_ready': (_payload) => {
        // Both players ready - now waiting for formation_started
        this.isReady = true;
        this.opponentReady = true;
        this.updateContent();
        parchmentToast.success('Ready', 'Both players ready! Entering formation...');
      },

      'coliseum:formation_started': (payload) => {
        // Both players are ready - transition to formation scene
        if (this.currentMatch?.matchId === payload.matchId) {
          // Clear ready check UI state
          this.currentMatch.status = 'formation_selection';

          // Clear countdown timer
          if (this.matchCountdown) {
            clearInterval(this.matchCountdown);
            this.matchCountdown = null;
          }

          // Transition to formation scene
          this.game.scenes.changeScene('battleFormation', {
            type: 'coliseum',
            matchId: payload.matchId,
            deadline: payload.deadline,
            opponentName: this.currentMatch?.opponent?.username || 'Opponent',
            maxCharacters: 5
          });
        }
      },

      'coliseum:match_started': async (payload) => {
        // This should normally be handled by BattleFormationScene after formations are submitted.
        // Handle here as a fallback in case player is still in ColiseumScene.
        if (payload.battleId) {
          parchmentToast.success('Battle', 'Battle begins!');

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
              this.game.scenes.changeScene('battle', {
                battleId: response.battleId || payload.battleId,
                battleType: 'pvp',
                mapSeed: response.mapSeed || payload.mapSeed,
                mapWidth: response.mapWidth || 32,
                mapHeight: response.mapHeight || 32,
                state: response.state,
                opponentUsername: payload.opponentUsername,
                nodeType: response.nodeType || payload.nodeType || 'arena'
              });
            } else {
              throw new Error(response.message || 'Failed to load battle');
            }
          } catch (error) {
            console.error('[Coliseum] Failed to load PvP battle:', error);
            parchmentToast.error('Battle Error', 'Failed to load battle. Please try again.');
            // Reset to queue view
            this.updateContent();
          }
        }
      },

      'coliseum:queue_banned': (payload) => {
        // Handle queue ban notification
        const banTime = new Date(payload.banUntil).toLocaleTimeString();
        parchmentToast.error('Queue Banned', `You are banned until ${banTime}. Reason: ${payload.reason}`);
        this.isInQueue = false;
        this.updateContent();
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
        parchmentToast.warning('Match Cancelled', payload.reason || 'Match cancelled');
      },

      'coliseum:queue_stats_update': (payload) => {
        this.queueStatuses = payload.queues;
        this.updateContent();
      },

      'coliseum:error': (payload) => {
        console.warn('Coliseum error:', payload);
        parchmentToast.error('Coliseum Error', payload.message || 'An error occurred');
      }
    };

    Object.entries(handlers).forEach(([type, handler]) => {
      this.wsHandlers[type] = handler;
      this.game.socket.on(type, handler);
    });
  }

  async loadQueueStatuses() {
    try {
      const queues = await this.game.api.getColiseumQueueStatuses();
      this.queueStatuses = queues;
      this.updateContent();
    } catch (err) {
      console.error('Failed to load queue statuses:', err);
      // Fallback to zeros on error
      this.queueStatuses = [
        { queueType: '1v1', queueSize: 0 },
        { queueType: '3v3', queueSize: 0 },
        { queueType: '5v5', queueSize: 0 }
      ];
    }
  }

  async loadPlayerStats() {
    try {
      const data = await this.game.api.getColiseumStats();
      this.playerStats = data.ratings || [];

      // Get 1v1 rating as default (or first available)
      const primaryRating = this.playerStats.find(r => r.queueType === '1v1')
        || this.playerStats[0];
      this.playerRating = primaryRating?.rating || null;
    } catch (err) {
      console.error('Failed to load player stats:', err);
      this.playerStats = [];
      this.playerRating = null;
    }
  }

  async loadQueuePlayers() {
    if (!this.selectedQueue) return;

    try {
      const data = await this.game.api.getColiseumQueuePlayers(this.selectedQueue);
      this.queuePlayers = data.players || [];
      this.updateContent();
    } catch (err) {
      console.error('Failed to load queue players:', err);
      // Don't clear - keep whatever we had
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
      parchmentToast.error('Leaderboard Error', 'Failed to load leaderboard');
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
      parchmentToast.error('History Error', 'Failed to load match history');
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
      parchmentToast.error('Details Error', 'Failed to load match details');
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
    this.queuePlayers = [];
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
          countdownEl.innerHTML = `Time Remaining: <span class="countdown-number">${remaining}s</span>`;
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

  update(_deltaTime) {
    // No frame updates needed
  }

  render(_ctx) {
    // UI-only scene - arena background is CSS-based
  }
}
