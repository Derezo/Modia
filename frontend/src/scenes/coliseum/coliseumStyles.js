/**
 * Coliseum Scene Styles
 * Extracted from ColiseumScene.js for modularization
 */

import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_SPACING,
  PARCHMENT_RADIUS,
  getParchmentShadow,
  getParchmentButtonCSS,
  getParchmentPanelCSS,
  getParchmentScrollbarCSS,
  getParchmentSpinnerCSS
} from '../../ui/parchment/index.js';

// Alias for concise color access
const P = PARCHMENT_COLORS;

// Arena-specific colors for the blood/gold PvP aesthetic
export const ARENA_COLORS = {
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
 * Generate the coliseum scene CSS
 * @returns {string} The complete CSS string
 */
export function getColiseumStyles() {
  return `
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
}
