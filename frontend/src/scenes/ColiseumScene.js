import { Scene } from './Scene.js';
import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_SPACING,
  PARCHMENT_RADIUS,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentShadow,
  getParchmentButtonCSS,
  getParchmentPanelCSS,
  getParchmentScrollbarCSS,
  getParchmentSpinnerCSS
} from '../ui/parchment/index.js';
import { parchmentToast } from '../ui/parchment/ParchmentToast.js';

// Alias for concise color access
const P = PARCHMENT_COLORS;

// Arena-specific colors for the blood/gold PvP aesthetic
const ARENA_COLORS = {
  blood: '#ff4444',
  bloodLight: '#ff6666',
  bloodDark: '#cc0000',
  bloodDeep: '#8b0000',
  gold: '#ffd700',
  goldLight: '#ffe44d',
  goldDark: '#c9a227',
  backgroundDark: '#1a0a0a',
  backgroundMid: '#2a1a1a',
  victory: '#4caf50',
  victoryDark: '#388e3c',
  defeat: '#f44336',
  defeatDark: '#d32f2f',
  readyGreen: '#00ff00',
  readyGreenDark: '#00cc00'
};

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
      /* Arena-themed container background */
      .coliseum-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, ${ARENA_COLORS.backgroundMid} 0%, ${ARENA_COLORS.backgroundDark} 100%);
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: ${PARCHMENT_SPACING.xl};
        box-sizing: border-box;
      }

      /* Header with arena accent */
      .coliseum-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: 100%;
        max-width: 900px;
        margin-bottom: ${PARCHMENT_SPACING.xl};
      }

      .coliseum-title {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.md};
      }

      .coliseum-title h2 {
        margin: 0;
        color: ${ARENA_COLORS.blood};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        text-shadow: 0 0 10px rgba(255, 68, 68, 0.5);
      }

      .coliseum-title-icon {
        font-size: 32px;
      }

      /* Tab Navigation - Parchment styled */
      .coliseum-tabs {
        display: flex;
        gap: ${PARCHMENT_SPACING.xs};
        width: 100%;
        max-width: 900px;
        margin-bottom: ${PARCHMENT_SPACING.xl};
        ${getParchmentPanelCSS()}
        padding: ${PARCHMENT_SPACING.sm};
      }

      .coliseum-tab {
        padding: ${PARCHMENT_SPACING.md} ${PARCHMENT_SPACING.xl};
        background: ${P.light};
        border: 1px solid ${P.border};
        border-radius: ${PARCHMENT_RADIUS.md};
        color: ${P.text.secondary};
        cursor: pointer;
        transition: all 0.2s;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        flex: 1;
        text-align: center;
      }

      .coliseum-tab:hover {
        background: ${P.mid};
        color: ${P.text.primary};
        border-color: ${P.borderDark};
      }

      .coliseum-tab.active {
        background: linear-gradient(to bottom, ${P.border} 0%, ${P.borderDark} 100%);
        border-color: ${P.borderDark};
        color: ${P.text.inverse};
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

      /* Queue Selection Cards - Parchment themed */
      .coliseum-queue-selection {
        display: flex;
        gap: ${PARCHMENT_SPACING.xl};
        margin-bottom: ${PARCHMENT_SPACING.xxl};
        flex-wrap: wrap;
        justify-content: center;
      }

      .coliseum-queue-card {
        ${getParchmentPanelCSS()}
        padding: ${PARCHMENT_SPACING.xl};
        min-width: 180px;
        text-align: center;
        cursor: pointer;
        transition: all 0.3s;
      }

      .coliseum-queue-card:hover {
        border-color: ${P.accent.burgundy};
        transform: translateY(-4px);
        box-shadow: ${getParchmentShadow(true)}, 0 0 12px rgba(107, 45, 61, 0.3);
      }

      .coliseum-queue-card.selected {
        border-color: ${P.accent.burgundy};
        box-shadow: ${getParchmentShadow(true)}, 0 0 0 2px ${P.accent.burgundy};
      }

      .coliseum-queue-card.disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .coliseum-queue-card-title {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xxl};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${P.text.primary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        margin-bottom: ${PARCHMENT_SPACING.sm};
      }

      .coliseum-queue-card-desc {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${P.text.secondary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        margin-bottom: ${PARCHMENT_SPACING.md};
      }

      .coliseum-queue-card-status {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${P.text.muted};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .coliseum-queue-card-players {
        color: ${P.state.info};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      }

      /* Queue Panel - Parchment themed */
      .coliseum-queue-panel {
        ${getParchmentPanelCSS()}
        padding: ${PARCHMENT_SPACING.xxl};
        text-align: center;
        width: 100%;
        max-width: 400px;
      }

      .coliseum-queue-panel-title {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xl};
        color: ${P.text.primary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        margin-bottom: ${PARCHMENT_SPACING.xl};
      }

      /* Queue Buttons */
      .coliseum-queue-btn {
        padding: ${PARCHMENT_SPACING.lg} 40px;
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xl};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        border: none;
        border-radius: ${PARCHMENT_RADIUS.md};
        cursor: pointer;
        transition: all 0.2s;
      }

      .coliseum-queue-btn.join {
        background: linear-gradient(180deg, ${ARENA_COLORS.blood}, ${ARENA_COLORS.bloodDark});
        color: white;
        border: 1px solid ${ARENA_COLORS.bloodDeep};
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
      }

      .coliseum-queue-btn.join:hover:not(:disabled) {
        background: linear-gradient(180deg, ${ARENA_COLORS.bloodLight}, ${ARENA_COLORS.blood});
        transform: scale(1.05);
      }

      .coliseum-queue-btn.leave {
        ${getParchmentButtonCSS('secondary')}
        padding: ${PARCHMENT_SPACING.lg} 40px;
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xl};
      }

      .coliseum-queue-btn.leave:hover {
        background: ${P.mid};
      }

      .coliseum-queue-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* Queue Status - Parchment panel */
      .coliseum-queue-status {
        margin-top: ${PARCHMENT_SPACING.xl};
        padding: ${PARCHMENT_SPACING.xl};
        background: ${P.dark};
        border: 1px solid ${P.border};
        border-radius: ${PARCHMENT_RADIUS.md};
      }

      .coliseum-queue-position {
        font-size: 36px;
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${ARENA_COLORS.blood};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        margin-bottom: ${PARCHMENT_SPACING.sm};
      }

      .coliseum-queue-label {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
        color: ${P.text.muted};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        margin-bottom: ${PARCHMENT_SPACING.lg};
      }

      .coliseum-queue-waiting {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        color: ${P.text.secondary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .coliseum-queue-spinner {
        width: 20px;
        height: 20px;
        border: 3px solid ${P.border};
        border-top-color: ${ARENA_COLORS.blood};
        border-radius: 50%;
        animation: coliseum-spin 1s linear infinite;
      }

      @keyframes coliseum-spin {
        to { transform: rotate(360deg); }
      }

      /* Match Found Panel - Arena themed (gold/excitement) */
      .coliseum-match-found-panel {
        background: linear-gradient(135deg, rgba(255, 215, 0, 0.15), rgba(255, 140, 0, 0.1));
        border: 3px solid ${ARENA_COLORS.gold};
        border-radius: ${PARCHMENT_RADIUS.lg};
        padding: ${PARCHMENT_SPACING.xxl};
        text-align: center;
        width: 100%;
        max-width: 500px;
        animation: coliseum-pulse 2s ease-in-out infinite;
      }

      @keyframes coliseum-pulse {
        0%, 100% { box-shadow: 0 0 20px rgba(255, 215, 0, 0.3); }
        50% { box-shadow: 0 0 40px rgba(255, 215, 0, 0.6); }
      }

      .coliseum-match-found-title {
        font-size: 28px;
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${ARENA_COLORS.gold};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        margin-bottom: ${PARCHMENT_SPACING.xl};
        text-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
      }

      /* Opponent Info - Parchment panel inside match found */
      .coliseum-opponent-info {
        ${getParchmentPanelCSS()}
        padding: ${PARCHMENT_SPACING.lg};
        margin-bottom: ${PARCHMENT_SPACING.xl};
      }

      .coliseum-opponent-label {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${P.text.muted};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        margin-bottom: ${PARCHMENT_SPACING.sm};
      }

      .coliseum-opponent-name {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xl};
        color: ${ARENA_COLORS.blood};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .coliseum-opponent-level {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
        color: ${P.text.secondary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        margin-top: ${PARCHMENT_SPACING.xs};
      }

      .coliseum-ready-section {
        margin-top: ${PARCHMENT_SPACING.xl};
      }

      .coliseum-ready-btn {
        padding: ${PARCHMENT_SPACING.lg} 50px;
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xl};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        background: linear-gradient(180deg, ${ARENA_COLORS.victory}, ${ARENA_COLORS.victoryDark});
        color: white;
        border: none;
        border-radius: ${PARCHMENT_RADIUS.md};
        cursor: pointer;
        transition: all 0.2s;
      }

      .coliseum-ready-btn:hover:not(:disabled) {
        background: linear-gradient(180deg, #5dbf5d, ${ARENA_COLORS.victory});
        transform: scale(1.05);
      }

      .coliseum-ready-btn.ready {
        ${getParchmentButtonCSS('secondary')}
        padding: ${PARCHMENT_SPACING.lg} 50px;
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xl};
      }

      .coliseum-ready-btn:disabled {
        cursor: not-allowed;
      }

      .coliseum-ready-status {
        display: flex;
        justify-content: center;
        gap: ${PARCHMENT_SPACING.xxl};
        margin-top: ${PARCHMENT_SPACING.lg};
      }

      .coliseum-ready-indicator {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.sm};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        color: ${P.text.inverse};
      }

      .coliseum-ready-indicator .dot {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: ${P.border};
      }

      .coliseum-ready-indicator .dot.ready {
        background: ${ARENA_COLORS.readyGreen};
        box-shadow: 0 0 10px rgba(0, 255, 0, 0.5);
      }

      .coliseum-countdown {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xl};
        color: ${ARENA_COLORS.blood};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        margin-top: ${PARCHMENT_SPACING.lg};
      }

      .coliseum-countdown-number {
        font-size: 36px;
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      }

      .coliseum-match-starting {
        background: rgba(0, 255, 0, 0.1);
        border-color: ${ARENA_COLORS.readyGreen};
      }

      .coliseum-match-starting .coliseum-match-found-title {
        color: ${ARENA_COLORS.readyGreen};
      }

      /* Leaderboard Styles - Parchment themed */
      .coliseum-leaderboard-container {
        width: 100%;
        max-width: 800px;
      }

      .coliseum-leaderboard-filters {
        display: flex;
        gap: ${PARCHMENT_SPACING.lg};
        margin-bottom: ${PARCHMENT_SPACING.xl};
        flex-wrap: wrap;
      }

      .coliseum-filter-group {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.sm};
      }

      .coliseum-filter-group label {
        color: ${P.text.inverse};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .coliseum-filter-group select {
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        background: ${P.light};
        border: 1px solid ${P.border};
        border-radius: ${PARCHMENT_RADIUS.sm};
        color: ${P.text.primary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
        cursor: pointer;
      }

      .coliseum-filter-group select:hover {
        border-color: ${P.borderDark};
      }

      .coliseum-leaderboard-table {
        width: 100%;
        border-collapse: collapse;
        ${getParchmentPanelCSS()}
        overflow: hidden;
      }

      .coliseum-leaderboard-table th,
      .coliseum-leaderboard-table td {
        padding: ${PARCHMENT_SPACING.md} ${PARCHMENT_SPACING.lg};
        text-align: left;
        border-bottom: 1px solid ${P.border};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .coliseum-leaderboard-table th {
        background: linear-gradient(to bottom, ${P.border} 0%, ${P.borderDark} 100%);
        color: ${P.text.inverse};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        text-transform: uppercase;
      }

      .coliseum-leaderboard-table tr:hover {
        background: ${P.mid};
      }

      .coliseum-leaderboard-table tr.current-user {
        background: rgba(107, 45, 61, 0.2);
        border-left: 3px solid ${P.accent.burgundy};
      }

      .coliseum-leaderboard-table tr.current-user td:first-child::before {
        content: '';
        margin-right: 6px;
      }

      .coliseum-rank-cell {
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${P.text.primary};
        min-width: 60px;
      }

      .coliseum-rank-1 { color: ${ARENA_COLORS.gold}; }
      .coliseum-rank-2 { color: #c0c0c0; }
      .coliseum-rank-3 { color: #cd7f32; }

      .coliseum-crown-icon {
        font-size: 18px;
        margin-left: ${PARCHMENT_SPACING.xs};
      }

      .coliseum-player-name {
        color: ${P.state.info};
        font-weight: 500;
      }

      .coliseum-rating-cell {
        color: ${ARENA_COLORS.blood};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      }

      .coliseum-winloss-cell {
        color: ${P.text.secondary};
      }

      .coliseum-winloss-cell .wins { color: ${P.state.success}; }
      .coliseum-winloss-cell .losses { color: ${P.state.error}; }

      .coliseum-streak-cell {
        color: ${P.state.success};
      }

      .coliseum-user-rank-banner {
        margin-top: ${PARCHMENT_SPACING.xl};
        padding: ${PARCHMENT_SPACING.lg};
        ${getParchmentPanelCSS()}
        border-color: ${P.accent.burgundy};
        text-align: center;
      }

      .coliseum-user-rank-banner .rank-label {
        color: ${P.text.secondary};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        margin-bottom: ${PARCHMENT_SPACING.xs};
      }

      .coliseum-user-rank-banner .rank-value {
        color: ${P.text.primary};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xxl};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .coliseum-loading-spinner {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 40px;
        color: ${P.text.muted};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .coliseum-no-data-message {
        padding: 40px;
        text-align: center;
        color: ${P.text.muted};
        font-style: italic;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      /* Match History Styles - Parchment themed */
      .coliseum-history-container {
        width: 100%;
        max-width: 800px;
      }

      .coliseum-history-filters {
        display: flex;
        gap: ${PARCHMENT_SPACING.lg};
        margin-bottom: ${PARCHMENT_SPACING.xl};
      }

      .coliseum-history-list {
        display: flex;
        flex-direction: column;
        gap: ${PARCHMENT_SPACING.md};
      }

      .coliseum-match-card {
        ${getParchmentPanelCSS()}
        padding: ${PARCHMENT_SPACING.lg};
        display: flex;
        justify-content: space-between;
        align-items: center;
        transition: all 0.2s;
      }

      .coliseum-match-card:hover {
        border-color: ${P.borderDark};
        box-shadow: ${getParchmentShadow(true)};
      }

      .coliseum-match-card.victory {
        border-left: 4px solid ${P.state.success};
      }

      .coliseum-match-card.defeat {
        border-left: 4px solid ${P.state.error};
      }

      .coliseum-match-info {
        flex: 1;
      }

      .coliseum-match-result {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.lg};
        color: ${P.text.primary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        margin-bottom: 6px;
      }

      .coliseum-match-result .winner {
        color: ${P.state.success};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      }

      .coliseum-match-result .loser {
        color: ${P.state.error};
      }

      .coliseum-match-meta {
        display: flex;
        gap: ${PARCHMENT_SPACING.lg};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${P.text.muted};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .coliseum-match-meta span {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.xs};
      }

      .coliseum-rating-change {
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.sm};
        border-radius: ${PARCHMENT_RADIUS.sm};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
      }

      .coliseum-rating-change.positive {
        background: rgba(74, 117, 72, 0.2);
        color: ${P.state.success};
      }

      .coliseum-rating-change.negative {
        background: rgba(139, 68, 68, 0.2);
        color: ${P.state.error};
      }

      .coliseum-details-btn {
        ${getParchmentButtonCSS('secondary')}
        margin-left: ${PARCHMENT_SPACING.lg};
      }

      .coliseum-details-btn:hover {
        background: ${P.mid};
        border-color: ${P.borderDark};
      }

      .coliseum-load-more-btn {
        margin-top: ${PARCHMENT_SPACING.xl};
        ${getParchmentButtonCSS('primary')}
      }

      .coliseum-load-more-btn:hover:not(:disabled) {
        background: linear-gradient(to bottom, ${P.borderLight} 0%, ${P.border} 100%);
      }

      .coliseum-load-more-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* Match Details Modal - Parchment themed */
      .coliseum-match-details-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: ${P.overlay};
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }

      .coliseum-match-details-content {
        ${getParchmentPanelCSS()}
        padding: ${PARCHMENT_SPACING.xl};
        max-width: 800px;
        width: 90%;
        max-height: 80vh;
        overflow-y: auto;
      }

      .coliseum-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: ${PARCHMENT_SPACING.xl};
        padding-bottom: ${PARCHMENT_SPACING.lg};
        border-bottom: 1px solid ${P.border};
      }

      .coliseum-modal-header h3 {
        margin: 0;
        color: ${P.text.primary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: 22px;
      }

      .coliseum-modal-close-btn {
        background: none;
        border: none;
        color: ${P.text.muted};
        font-size: 28px;
        cursor: pointer;
        padding: 0;
        line-height: 1;
      }

      .coliseum-modal-close-btn:hover {
        color: ${P.text.primary};
      }

      .coliseum-match-details-result {
        text-align: center;
        padding: ${PARCHMENT_SPACING.xl};
        background: ${P.dark};
        border: 1px solid ${P.border};
        border-radius: ${PARCHMENT_RADIUS.lg};
        margin-bottom: ${PARCHMENT_SPACING.xl};
      }

      .coliseum-result-text {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xxl};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        margin-bottom: ${PARCHMENT_SPACING.sm};
      }

      .coliseum-result-text.victory { color: ${P.state.success}; }
      .coliseum-result-text.defeat { color: ${P.state.error}; }

      .coliseum-rating-changes {
        display: flex;
        justify-content: center;
        gap: ${PARCHMENT_SPACING.xxl};
        margin-top: ${PARCHMENT_SPACING.md};
      }

      .coliseum-rating-change-item {
        text-align: center;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .coliseum-rating-change-item .label {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${P.text.muted};
        margin-bottom: ${PARCHMENT_SPACING.xs};
      }

      .coliseum-rating-change-item .value {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xl};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      }

      .coliseum-teams-section {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: ${PARCHMENT_SPACING.xl};
        margin-bottom: ${PARCHMENT_SPACING.xl};
      }

      .coliseum-team-panel {
        background: ${P.dark};
        border: 1px solid ${P.border};
        border-radius: ${PARCHMENT_RADIUS.lg};
        padding: ${PARCHMENT_SPACING.lg};
      }

      .coliseum-team-panel.winner {
        border: 2px solid ${P.state.success};
      }

      .coliseum-team-panel.loser {
        border: 2px solid ${P.state.error};
      }

      .coliseum-team-header {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        margin-bottom: ${PARCHMENT_SPACING.md};
        padding-bottom: ${PARCHMENT_SPACING.sm};
        border-bottom: 1px solid ${P.border};
      }

      .coliseum-team-header.winner { color: ${P.state.success}; }
      .coliseum-team-header.loser { color: ${P.state.error}; }

      .coliseum-character-list {
        display: flex;
        flex-direction: column;
        gap: ${PARCHMENT_SPACING.sm};
      }

      .coliseum-character-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: ${PARCHMENT_SPACING.sm};
        background: ${P.mid};
        border-radius: ${PARCHMENT_RADIUS.sm};
      }

      .coliseum-character-name {
        color: ${P.text.primary};
        font-weight: 500;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .coliseum-character-class {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${P.text.muted};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .coliseum-character-level {
        color: ${P.text.primary};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .coliseum-equipment-list {
        margin-top: 6px;
        padding-left: ${PARCHMENT_SPACING.md};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .coliseum-equipment-item {
        color: ${P.text.muted};
        margin-bottom: 2px;
      }

      .coliseum-equipment-item.common { color: ${P.text.secondary}; }
      .coliseum-equipment-item.uncommon { color: ${P.state.success}; }
      .coliseum-equipment-item.rare { color: ${P.state.info}; }
      .coliseum-equipment-item.epic { color: #9b59b6; }
      .coliseum-equipment-item.legendary { color: ${P.accent.burgundy}; }

      .coliseum-stats-section {
        background: ${P.dark};
        border: 1px solid ${P.border};
        border-radius: ${PARCHMENT_RADIUS.lg};
        padding: ${PARCHMENT_SPACING.lg};
        margin-bottom: ${PARCHMENT_SPACING.xl};
      }

      .coliseum-stats-header {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        color: ${P.text.primary};
        margin-bottom: ${PARCHMENT_SPACING.md};
      }

      .coliseum-stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: ${PARCHMENT_SPACING.md};
      }

      .coliseum-stat-item {
        background: ${P.mid};
        padding: ${PARCHMENT_SPACING.md};
        border-radius: ${PARCHMENT_RADIUS.sm};
        text-align: center;
      }

      .coliseum-stat-item .stat-value {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xl};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        color: ${P.text.primary};
      }

      .coliseum-stat-item .stat-label {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        color: ${P.text.muted};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        margin-top: ${PARCHMENT_SPACING.xs};
      }

      /* MVP Section - Arena accent */
      .coliseum-mvp-section {
        background: linear-gradient(135deg, rgba(107, 45, 61, 0.2), rgba(139, 115, 85, 0.1));
        border: 2px solid ${P.accent.burgundy};
        border-radius: ${PARCHMENT_RADIUS.lg};
        padding: ${PARCHMENT_SPACING.lg};
        text-align: center;
      }

      .coliseum-mvp-header {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${P.text.primary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        margin-bottom: ${PARCHMENT_SPACING.sm};
        text-transform: uppercase;
        letter-spacing: 1px;
      }

      .coliseum-mvp-name {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xl};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        color: ${P.text.primary};
      }

      .coliseum-mvp-stats {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${P.text.secondary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        margin-top: ${PARCHMENT_SPACING.sm};
      }

      /* Themed Scrollbars */
      ${getParchmentScrollbarCSS('.coliseum-content')}
      ${getParchmentScrollbarCSS('.coliseum-match-details-content')}
      ${getParchmentScrollbarCSS('.coliseum-history-list')}

      /* Parchment spinner (use alongside coliseum-queue-spinner for consistency) */
      ${getParchmentSpinnerCSS()}
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
      <h3 style="color: ${P.text.inverse}; font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily}; margin-bottom: ${PARCHMENT_SPACING.xl};">Select Arena Type</h3>

      <div class="coliseum-queue-selection">
        ${queueTypes.map(q => {
          const status = this.queueStatuses.find(s => s.queueType === q.id);
          const playersInQueue = status?.queueSize || 0;
          const isSelected = this.selectedQueue === q.id;

          return `
            <div class="coliseum-queue-card ${isSelected ? 'selected' : ''}" data-queue="${q.id}">
              <div class="coliseum-queue-card-title">${q.name}</div>
              <div class="coliseum-queue-card-desc">${q.desc}</div>
              <div class="coliseum-queue-card-status">
                <span class="coliseum-queue-card-players">${playersInQueue}</span> in queue
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <div class="coliseum-queue-panel">
        <div class="coliseum-queue-panel-title">
          ${this.selectedQueue ? `Join ${this.selectedQueue} Queue` : 'Select an arena type above'}
        </div>
        <button class="coliseum-queue-btn join" id="join-queue-btn" ${!this.selectedQueue ? 'disabled' : ''}>
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
      <div class="coliseum-queue-panel" style="max-width: 500px;">
        <div class="coliseum-queue-panel-title">Searching for ${this.selectedQueue} Match...</div>

        <div class="coliseum-queue-status">
          <div class="coliseum-queue-position">#${position}</div>
          <div class="coliseum-queue-label">Position in Queue (${queueSize} players waiting)</div>

          <div class="coliseum-queue-waiting">
            <div class="coliseum-queue-spinner"></div>
            <span>Estimated wait: ${waitTime}</span>
          </div>
        </div>

        <button class="coliseum-queue-btn leave" id="leave-queue-btn" style="margin-top: ${PARCHMENT_SPACING.xl};">
          Leave Queue
        </button>
      </div>
    `;
  }

  renderMatchFound() {
    const match = this.currentMatch;
    const isStarting = this.isReady && this.opponentReady;

    return `
      <div class="coliseum-match-found-panel ${isStarting ? 'coliseum-match-starting' : ''}">
        <div class="coliseum-match-found-title">
          ${isStarting ? 'MATCH STARTING!' : 'MATCH FOUND!'}
        </div>

        <div class="coliseum-opponent-info">
          <div class="coliseum-opponent-label">Your Opponent</div>
          <div class="coliseum-opponent-name">${match.opponent?.username || 'Unknown'}</div>
          <div class="coliseum-opponent-level">Avg Level: ${match.opponent?.partyLevel || '?'}</div>
        </div>

        <div class="coliseum-ready-section">
          <button class="coliseum-ready-btn ${this.isReady ? 'ready' : ''}" id="ready-btn" ${this.isReady ? 'disabled' : ''}>
            ${this.isReady ? 'READY!' : 'Click to Ready'}
          </button>

          <div class="coliseum-ready-status">
            <div class="coliseum-ready-indicator">
              <div class="dot ${this.isReady ? 'ready' : ''}"></div>
              <span>You</span>
            </div>
            <div class="coliseum-ready-indicator">
              <div class="dot ${this.opponentReady ? 'ready' : ''}"></div>
              <span>Opponent</span>
            </div>
          </div>

          <div class="coliseum-countdown" id="ready-countdown"></div>
        </div>
      </div>
    `;
  }

  renderLeaderboard() {
    if (this.loadingLeaderboard) {
      return `
        <div class="coliseum-leaderboard-container">
          <div class="coliseum-loading-spinner">
            <div class="coliseum-queue-spinner"></div>
            <span style="margin-left: 10px;">Loading leaderboard...</span>
          </div>
        </div>
      `;
    }

    return `
      <div class="coliseum-leaderboard-container">
        <div class="coliseum-leaderboard-filters">
          <div class="coliseum-filter-group">
            <label>Queue Type:</label>
            <select id="leaderboard-queue-filter">
              <option value="1v1" ${this.leaderboardQueueType === '1v1' ? 'selected' : ''}>1v1 Duel</option>
              <option value="3v3" ${this.leaderboardQueueType === '3v3' ? 'selected' : ''}>3v3 Skirmish</option>
              <option value="5v5" ${this.leaderboardQueueType === '5v5' ? 'selected' : ''}>5v5 Battle</option>
            </select>
          </div>
          <div class="coliseum-filter-group">
            <label>Time Period:</label>
            <select id="leaderboard-time-filter">
              <option value="all" ${this.leaderboardTimeFilter === 'all' ? 'selected' : ''}>All Time</option>
              <option value="week" ${this.leaderboardTimeFilter === 'week' ? 'selected' : ''}>This Week</option>
              <option value="today" ${this.leaderboardTimeFilter === 'today' ? 'selected' : ''}>Today</option>
            </select>
          </div>
        </div>

        ${this.leaderboardData.length === 0 ? `
          <div class="coliseum-no-data-message">No rankings available yet. Be the first to compete!</div>
        ` : `
          <table class="coliseum-leaderboard-table">
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
                const crownIcon = rank === 1 ? '<span class="coliseum-crown-icon">&#128081;</span>' : '';

                return `
                  <tr class="${isCurrentUser ? 'current-user' : ''}">
                    <td class="coliseum-rank-cell coliseum-rank-${rank <= 3 ? rank : ''}">#${rank}${crownIcon}</td>
                    <td class="coliseum-player-name">${entry.username}</td>
                    <td class="coliseum-rating-cell">${entry.rating}</td>
                    <td class="coliseum-winloss-cell">
                      <span class="wins">${entry.wins}</span> / <span class="losses">${entry.losses}</span>
                    </td>
                    <td class="coliseum-streak-cell">${entry.winStreak > 0 ? entry.winStreak + ' wins' : '-'}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>

          ${this.userRank && this.userRank > 100 ? `
            <div class="coliseum-user-rank-banner">
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
        <div class="coliseum-history-container">
          <div class="coliseum-loading-spinner">
            <div class="coliseum-queue-spinner"></div>
            <span style="margin-left: 10px;">Loading match history...</span>
          </div>
        </div>
      `;
    }

    return `
      <div class="coliseum-history-container">
        <div class="coliseum-history-filters">
          <div class="coliseum-filter-group">
            <label>Filter:</label>
            <select id="history-filter">
              <option value="all" ${this.matchHistoryFilter === 'all' ? 'selected' : ''}>All Matches</option>
              <option value="mine" ${this.matchHistoryFilter === 'mine' ? 'selected' : ''}>My Matches</option>
            </select>
          </div>
        </div>

        ${this.matchHistoryData.length === 0 ? `
          <div class="coliseum-no-data-message">No matches found. Start battling to build your history!</div>
        ` : `
          <div class="coliseum-history-list">
            ${this.matchHistoryData.map(match => {
              const isWinner = match.winnerId === this.game.userId;
              const isLoser = match.loserId === this.game.userId;
              const isMyMatch = isWinner || isLoser;
              const resultClass = isMyMatch ? (isWinner ? 'victory' : 'defeat') : '';
              const ratingChange = isWinner ? match.winnerRatingChange : (isLoser ? match.loserRatingChange : null);

              return `
                <div class="coliseum-match-card ${resultClass}">
                  <div class="coliseum-match-info">
                    <div class="coliseum-match-result">
                      <span class="winner">${match.winnerUsername}</span>
                      <span style="color: ${P.text.muted};"> defeated </span>
                      <span class="loser">${match.loserUsername}</span>
                    </div>
                    <div class="coliseum-match-meta">
                      <span>${match.queueType}</span>
                      <span>${match.turnCount || '?'} turns</span>
                      <span>${this.formatTimestamp(match.createdAt)}</span>
                    </div>
                  </div>
                  ${ratingChange !== null ? `
                    <div class="coliseum-rating-change ${ratingChange >= 0 ? 'positive' : 'negative'}">
                      ${ratingChange >= 0 ? '+' : ''}${ratingChange}
                    </div>
                  ` : ''}
                  <button class="coliseum-details-btn" data-match-id="${match.id}">Details</button>
                </div>
              `;
            }).join('')}
          </div>

          ${this.hasMoreMatches ? `
            <button class="coliseum-load-more-btn" id="load-more-matches" ${this.loadingHistory ? 'disabled' : ''}>
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
        <div class="coliseum-match-details-modal">
          <div class="coliseum-match-details-content">
            <div class="coliseum-loading-spinner">
              <div class="coliseum-queue-spinner"></div>
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
      <div class="coliseum-match-details-modal" id="match-details-modal">
        <div class="coliseum-match-details-content">
          <div class="coliseum-modal-header">
            <h3>Match Details</h3>
            <button class="coliseum-modal-close-btn" id="close-match-details">&times;</button>
          </div>

          <div class="coliseum-match-details-result">
            ${isMyMatch ? `
              <div class="coliseum-result-text ${isWinner ? 'victory' : 'defeat'}">
                ${isWinner ? 'VICTORY!' : 'DEFEAT'}
              </div>
            ` : `
              <div class="coliseum-result-text" style="color: ${P.text.primary};">
                ${details.winnerUsername} defeated ${details.loserUsername}
              </div>
            `}

            <div class="coliseum-rating-changes">
              <div class="coliseum-rating-change-item">
                <div class="label">${details.winnerUsername}</div>
                <div class="value" style="color: ${P.state.success};">+${details.winnerRatingChange || 0}</div>
              </div>
              <div class="coliseum-rating-change-item">
                <div class="label">${details.loserUsername}</div>
                <div class="value" style="color: ${P.state.error};">${details.loserRatingChange || 0}</div>
              </div>
            </div>
          </div>

          <div class="coliseum-teams-section">
            <div class="coliseum-team-panel winner">
              <div class="coliseum-team-header winner">${details.winnerUsername}'s Team</div>
              <div class="coliseum-character-list">
                ${winnerTeam.length > 0 ? winnerTeam.map(char => this.renderCharacterItem(char)).join('') : `
                  <div class="coliseum-no-data-message" style="padding: 10px;">Team data not available</div>
                `}
              </div>
            </div>
            <div class="coliseum-team-panel loser">
              <div class="coliseum-team-header loser">${details.loserUsername}'s Team</div>
              <div class="coliseum-character-list">
                ${loserTeam.length > 0 ? loserTeam.map(char => this.renderCharacterItem(char)).join('') : `
                  <div class="coliseum-no-data-message" style="padding: 10px;">Team data not available</div>
                `}
              </div>
            </div>
          </div>

          ${Object.keys(stats).length > 0 ? `
            <div class="coliseum-stats-section">
              <div class="coliseum-stats-header">Battle Statistics</div>
              <div class="coliseum-stats-grid">
                ${stats.totalDamage ? `
                  <div class="coliseum-stat-item">
                    <div class="stat-value">${stats.totalDamage}</div>
                    <div class="stat-label">Total Damage</div>
                  </div>
                ` : ''}
                ${stats.totalHealing ? `
                  <div class="coliseum-stat-item">
                    <div class="stat-value">${stats.totalHealing}</div>
                    <div class="stat-label">Total Healing</div>
                  </div>
                ` : ''}
                ${stats.turnCount ? `
                  <div class="coliseum-stat-item">
                    <div class="stat-value">${stats.turnCount}</div>
                    <div class="stat-label">Turns</div>
                  </div>
                ` : ''}
                ${stats.duration ? `
                  <div class="coliseum-stat-item">
                    <div class="stat-value">${this.formatDuration(stats.duration)}</div>
                    <div class="stat-label">Duration</div>
                  </div>
                ` : ''}
              </div>
            </div>
          ` : ''}

          ${mvp ? `
            <div class="coliseum-mvp-section">
              <div class="coliseum-mvp-header">Most Valuable Player</div>
              <div class="coliseum-mvp-name">${mvp.name}</div>
              <div class="coliseum-mvp-stats">
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
      <div class="coliseum-character-item">
        <div>
          <div class="coliseum-character-name">${char.name}</div>
          <div class="coliseum-character-class">${char.class}</div>
          ${char.equipment && char.equipment.length > 0 ? `
            <div class="coliseum-equipment-list">
              ${char.equipment.map(item => `
                <div class="coliseum-equipment-item ${item.rarity || 'common'}">${item.name}</div>
              `).join('')}
            </div>
          ` : ''}
        </div>
        <div class="coliseum-character-level">Lv.${char.level}</div>
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
        parchmentToast.success('Match Found', 'Get ready!');
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
        parchmentToast.success('Ready', 'Match starting in 3 seconds!');
      },

      'coliseum:match_started': async (payload) => {
        // Transition to battle scene
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
          parchmentToast.error('Battle Error', 'Failed to load battle. Please try again.');
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
        parchmentToast.warning('Match Cancelled', payload.reason || 'Match cancelled');
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
          countdownEl.innerHTML = `Time to ready: <span class="coliseum-countdown-number">${remaining}s</span>`;
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
    // UI-only scene - arena background is CSS-based
  }
}
