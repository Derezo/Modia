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

// Arena-specific colors for the Slate Arena tactical aesthetic
export const ARENA_COLORS = {
  // Primary Accent - Steel Blue (replaces blood red)
  primary: '#4a6b8a',
  primaryLight: '#5a80a8',
  primaryDark: '#3a556a',

  // Secondary Accent - Bronze (replaces gold)
  gold: '#b8956a',
  goldLight: '#caa87a',
  goldDark: '#9a7855',

  // Backgrounds - Cool Stone
  backgroundDark: '#1a2025',
  backgroundMid: '#2a3035',

  // States
  victory: '#5a8c75',       // Muted teal-green
  victoryDark: '#4a7a65',
  defeat: '#8b6a6a',        // Muted dusty rose
  defeatDark: '#7a5a5a',
  readyGreen: '#6aa688',    // Softer green (replaces neon #00ff00)
  readyGreenDark: '#5a9678'
};

// Text on the slate arena backdrop (#1a2025-#2a3035): both pass WCAG AA
const ARENA_TEXT = {
  primary: '#efe6d2',
  secondary: '#c9bda3'
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
      gap: ${PARCHMENT_SPACING.lg};
      width: 100%;
      max-width: 900px;
      margin-bottom: ${PARCHMENT_SPACING.xl};
      padding-bottom: ${PARCHMENT_SPACING.md};
      border-bottom: 1px solid ${ARENA_COLORS.goldDark};
    }

    /* Player rating plaque: bronze-edged slate, tier coloured by --tier-color */
    .coliseum-player-rating {
      display: flex;
      align-items: baseline;
      gap: ${PARCHMENT_SPACING.sm};
      margin-left: auto;
      padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.md};
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid ${ARENA_COLORS.goldDark};
      border-radius: ${PARCHMENT_RADIUS.md};
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      color: ${ARENA_TEXT.primary};
    }

    .coliseum-player-rating:empty {
      display: none;
    }

    .coliseum-rating-tier {
      --tier-color: ${ARENA_COLORS.goldLight};
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--tier-color);
      font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      text-transform: capitalize;
    }

    .coliseum-rating-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--tier-color);
      box-shadow: 0 0 6px var(--tier-color);
    }

    .coliseum-rating-value {
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xl};
      font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      color: ${ARENA_TEXT.primary};
    }

    .coliseum-rating-label {
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      color: ${ARENA_TEXT.secondary};
    }

    .coliseum-title {
      display: flex;
      align-items: center;
      gap: ${PARCHMENT_SPACING.md};
    }

    /* Near-white parchment on slate with a dark drop shadow; the old blue
       glow softened the glyph edges and read as low contrast. */
    .coliseum-title h2 {
      margin: 0;
      color: ${ARENA_TEXT.primary};
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      letter-spacing: 0.5px;
      text-shadow: 0 2px 3px rgba(0, 0, 0, 0.6);
    }

    .coliseum-title-icon {
      font-size: 32px;
      color: ${ARENA_COLORS.goldLight};
    }

    .coliseum-back-btn {
      ${getParchmentButtonCSS('secondary')}
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

    /* Same green as the Ready button: the slate blue read as a disabled grey
       on the slate arena backdrop */
    .coliseum-queue-btn.join {
      background: linear-gradient(180deg, ${ARENA_COLORS.victory}, ${ARENA_COLORS.victoryDark});
      color: white;
      border: 1px solid ${ARENA_COLORS.victoryDark};
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
    }

    .coliseum-queue-btn.join:hover:not(:disabled) {
      background: linear-gradient(180deg, ${ARENA_COLORS.readyGreen}, ${ARENA_COLORS.victory});
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
      color: ${ARENA_COLORS.primary};
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
      border-top-color: ${ARENA_COLORS.primary};
      border-radius: 50%;
      animation: coliseum-spin 1s linear infinite;
    }

    @keyframes coliseum-spin {
      to { transform: rotate(360deg); }
    }

    /* ============================================ */
    /* MATCH FOUND PANEL - Enhanced Design         */
    /* ============================================ */

    /* Match Found Panel - Arena themed (bronze accent) */
    .coliseum-match-found-panel {
      background: linear-gradient(135deg, rgba(184, 149, 106, 0.15), rgba(154, 120, 85, 0.1));
      border: 3px solid ${ARENA_COLORS.gold};
      border-radius: ${PARCHMENT_RADIUS.lg};
      padding: ${PARCHMENT_SPACING.xxl};
      text-align: center;
      width: 100%;
      max-width: 520px;
      animation: coliseum-bronze-glow 2s ease-in-out infinite;
    }

    @keyframes coliseum-bronze-glow {
      0%, 100% {
        box-shadow: 0 0 20px rgba(184, 149, 106, 0.3),
                    0 0 40px rgba(184, 149, 106, 0.1);
      }
      50% {
        box-shadow: 0 0 30px rgba(184, 149, 106, 0.5),
                    0 0 60px rgba(184, 149, 106, 0.2);
      }
    }

    .coliseum-match-found-title {
      font-size: 26px;
      font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      color: ${ARENA_COLORS.gold};
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      margin-bottom: ${PARCHMENT_SPACING.xl};
      text-shadow: 0 0 12px rgba(184, 149, 106, 0.6);
      animation: coliseum-title-pulse 2s ease-in-out infinite;
    }

    @keyframes coliseum-title-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.85; }
    }

    /* Enhanced Opponent Card */
    .coliseum-opponent-card {
      ${getParchmentPanelCSS()}
      overflow: hidden;
      margin-bottom: ${PARCHMENT_SPACING.xl};
    }

    .coliseum-opponent-card-header {
      background: linear-gradient(to bottom, ${P.border} 0%, ${P.borderDark} 100%);
      color: ${P.text.inverse};
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      text-transform: uppercase;
      letter-spacing: 1px;
      padding: ${PARCHMENT_SPACING.md} ${PARCHMENT_SPACING.lg};
      border-bottom: 1px solid ${P.border};
    }

    .coliseum-opponent-card-body {
      padding: ${PARCHMENT_SPACING.lg};
    }

    /* Opponent name row with tier */
    .coliseum-opponent-name-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: ${PARCHMENT_SPACING.sm};
    }

    .coliseum-opponent-username {
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xl};
      font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      color: ${P.text.primary};
    }

    .coliseum-opponent-tier-display {
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    }

    .coliseum-opponent-elo {
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.lg};
      color: ${ARENA_COLORS.primary};
      font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      margin-bottom: ${PARCHMENT_SPACING.lg};
    }

    /* Stats row - 3 columns */
    .coliseum-opponent-stats-row {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: ${PARCHMENT_SPACING.sm};
      background: ${P.dark};
      border: 1px solid ${P.border};
      border-radius: ${PARCHMENT_RADIUS.md};
      padding: ${PARCHMENT_SPACING.md};
      margin-bottom: ${PARCHMENT_SPACING.lg};
    }

    .coliseum-opponent-stat-col {
      text-align: center;
      padding: ${PARCHMENT_SPACING.sm};
    }

    .coliseum-opponent-stat-col:not(:last-child) {
      border-right: 1px solid ${P.border};
    }

    .coliseum-opponent-stat-value {
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.lg};
      font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      color: ${P.text.primary};
      margin-bottom: 2px;
    }

    .coliseum-opponent-stat-value.streak-active {
      color: #ff6b35;
      text-shadow: 0 0 6px rgba(255, 107, 53, 0.4);
    }

    .coliseum-opponent-stat-label {
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
      color: ${P.text.muted};
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* Party level row with badges */
    .coliseum-opponent-party-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: ${PARCHMENT_SPACING.md};
      border-top: 1px solid ${P.border};
    }

    .coliseum-opponent-party-level {
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
      color: ${P.text.secondary};
    }

    /* Legacy opponent info styles (kept for backwards compat) */
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
      color: ${ARENA_COLORS.primary};
      font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
    }

    .coliseum-opponent-level {
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
      color: ${P.text.secondary};
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      margin-top: ${PARCHMENT_SPACING.xs};
    }

    /* Ready Section */
    .coliseum-ready-section {
      margin-top: ${PARCHMENT_SPACING.xl};
    }

    /* Large Ready Button */
    .coliseum-ready-btn-large {
      width: 100%;
      padding: ${PARCHMENT_SPACING.lg} ${PARCHMENT_SPACING.xxl};
      font-size: 22px;
      font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      background: linear-gradient(180deg, ${ARENA_COLORS.victory}, ${ARENA_COLORS.victoryDark});
      color: white;
      border: 2px solid ${ARENA_COLORS.victoryDark};
      border-radius: ${PARCHMENT_RADIUS.md};
      cursor: pointer;
      transition: all 0.2s;
      text-transform: uppercase;
      letter-spacing: 2px;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
    }

    .coliseum-ready-btn-large:hover:not(:disabled) {
      background: linear-gradient(180deg, ${ARENA_COLORS.readyGreen}, ${ARENA_COLORS.victory});
      transform: scale(1.02);
      box-shadow: 0 6px 12px rgba(0, 0, 0, 0.4);
    }

    .coliseum-ready-btn-large.ready {
      background: linear-gradient(180deg, ${P.mid}, ${P.dark});
      border-color: ${P.border};
      color: ${ARENA_COLORS.readyGreen};
      box-shadow: 0 0 10px rgba(106, 166, 136, 0.3);
    }

    .coliseum-ready-btn-large:disabled {
      cursor: not-allowed;
    }

    /* Legacy ready button styles */
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
      background: linear-gradient(180deg, ${ARENA_COLORS.readyGreen}, ${ARENA_COLORS.victory});
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

    /* Enhanced Ready Status Display */
    .coliseum-ready-status-enhanced {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: ${PARCHMENT_SPACING.sm};
      margin-top: ${PARCHMENT_SPACING.lg};
      padding: ${PARCHMENT_SPACING.md};
      background: rgba(0, 0, 0, 0.15);
      border-radius: ${PARCHMENT_RADIUS.md};
    }

    .coliseum-ready-label {
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      color: ${P.text.inverse};
      opacity: 0.8;
    }

    .coliseum-ready-indicators {
      display: flex;
      justify-content: center;
      gap: ${PARCHMENT_SPACING.xxl};
    }

    .coliseum-ready-indicator-item {
      display: flex;
      align-items: center;
      gap: ${PARCHMENT_SPACING.sm};
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
      color: ${P.text.inverse};
    }

    .ready-dot {
      font-size: 16px;
      color: ${P.border};
      transition: color 0.2s, text-shadow 0.2s;
    }

    .ready-dot.filled {
      color: ${ARENA_COLORS.primary};
      text-shadow: 0 0 8px rgba(74, 107, 138, 0.6);
    }

    /* Legacy ready status styles */
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
      box-shadow: 0 0 10px rgba(106, 166, 136, 0.5);
    }

    /* Enhanced Countdown Display */
    .coliseum-countdown-enhanced {
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.lg};
      color: ${ARENA_COLORS.gold};
      margin-top: ${PARCHMENT_SPACING.lg};
      text-shadow: 0 0 6px rgba(184, 149, 106, 0.4);
    }

    .coliseum-countdown-enhanced .countdown-number {
      font-size: 32px;
      font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
    }

    /* Legacy countdown styles */
    .coliseum-countdown {
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xl};
      color: ${ARENA_COLORS.primary};
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      margin-top: ${PARCHMENT_SPACING.lg};
    }

    .coliseum-countdown-number {
      font-size: 36px;
      font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
    }

    /* Match Starting State */
    .coliseum-match-starting {
      background: linear-gradient(135deg, rgba(106, 166, 136, 0.15), rgba(90, 150, 120, 0.1));
      border-color: ${ARENA_COLORS.readyGreen};
      animation: coliseum-starting-glow 1.5s ease-in-out infinite;
    }

    @keyframes coliseum-starting-glow {
      0%, 100% {
        box-shadow: 0 0 20px rgba(106, 166, 136, 0.4),
                    0 0 40px rgba(106, 166, 136, 0.2);
      }
      50% {
        box-shadow: 0 0 35px rgba(106, 166, 136, 0.6),
                    0 0 70px rgba(106, 166, 136, 0.3);
      }
    }

    .coliseum-match-starting .coliseum-match-found-title {
      color: ${ARENA_COLORS.readyGreen};
      text-shadow: 0 0 12px rgba(106, 166, 136, 0.6);
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
      color: ${ARENA_COLORS.primary};
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

    /* Loading/empty states sit on the dark arena backdrop: use a light tone */
    .coliseum-loading-spinner {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 40px;
      color: ${P.light};
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
    }

    /* Empty state: a bronze-framed plaque so the message reads as a panel,
       not stray text on the backdrop */
    .coliseum-no-data-message {
      margin: ${PARCHMENT_SPACING.lg} auto;
      max-width: 520px;
      padding: ${PARCHMENT_SPACING.xl} ${PARCHMENT_SPACING.lg};
      text-align: center;
      color: ${ARENA_TEXT.primary};
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.lg};
      background: rgba(0, 0, 0, 0.28);
      border: 1px solid ${ARENA_COLORS.goldDark};
      border-radius: ${PARCHMENT_RADIUS.md};
      box-shadow: inset 0 0 0 3px rgba(184, 149, 106, 0.12);
    }

    .coliseum-no-data-message::before {
      content: '\\2694';
      display: block;
      font-size: 28px;
      line-height: 1;
      margin-bottom: ${PARCHMENT_SPACING.sm};
      color: ${ARENA_COLORS.goldLight};
    }

    /* ...except inside parchment team panels, where muted text reads fine */
    .coliseum-team-panel .coliseum-no-data-message {
      color: ${P.text.muted};
      background: none;
      border: none;
      box-shadow: none;
      font-size: inherit;
      margin: 0;
      padding: ${PARCHMENT_SPACING.lg};
    }

    .coliseum-team-panel .coliseum-no-data-message::before {
      content: none;
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
      display: flex;
      align-items: center;
      gap: ${PARCHMENT_SPACING.xs};
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

    /* Unit Stats Section - Per-unit performance breakdown */
    .coliseum-unit-stats-section {
      margin-top: ${PARCHMENT_SPACING.lg};
      padding: ${PARCHMENT_SPACING.md};
      background: rgba(0, 0, 0, 0.2);
      border-radius: ${PARCHMENT_RADIUS.md};
    }

    .coliseum-unit-stats-list {
      display: flex;
      flex-direction: column;
      gap: ${PARCHMENT_SPACING.sm};
      margin-top: ${PARCHMENT_SPACING.md};
    }

    .coliseum-unit-stat-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      color: ${P.text.muted};
      padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.sm};
      background: ${P.mid};
      border-radius: ${PARCHMENT_RADIUS.sm};
    }

    .coliseum-unit-stat-row .unit-name {
      color: ${P.text.primary};
      font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
    }

    .coliseum-unit-stat-row .unit-stats {
      color: ${P.text.secondary};
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
    }

    .coliseum-unit-stat-row.mvp-unit {
      border: 1px solid ${P.accent.burgundy};
      background: linear-gradient(135deg, rgba(107, 45, 61, 0.15), rgba(139, 115, 85, 0.1));
    }

    .coliseum-unit-stat-row .mvp-badge {
      color: ${P.accent.burgundy};
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
      font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      margin-left: ${PARCHMENT_SPACING.xs};
    }

    /* Themed Scrollbars */
    ${getParchmentScrollbarCSS('.coliseum-content')}
    ${getParchmentScrollbarCSS('.coliseum-match-details-content')}
    ${getParchmentScrollbarCSS('.coliseum-history-list')}

    /* Parchment spinner (use alongside coliseum-queue-spinner for consistency) */
    ${getParchmentSpinnerCSS()}

    /* ============================================ */
    /* TIER BADGE STYLES                            */
    /* ============================================ */

    /* Full tier badge with icon and name */
    .coliseum-tier-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    }

    .coliseum-tier-badge .tier-icon {
      font-size: 14px;
    }

    .coliseum-tier-badge .tier-name {
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* Compact tier badge for match history (icon only) */
    .coliseum-tier-badge-compact {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      margin-right: 4px;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    }

    /* Tier cell in leaderboard table */
    .coliseum-tier-cell {
      white-space: nowrap;
    }

    /* Tier colors for reference (applied via inline styles) */
    /* Grandmaster: #c45a5a (Crimson) */
    /* Master: #9a6ab8 (Purple) */
    /* Platinum: #7ec8e8 (Ice Blue) */
    /* Gold: #b8956a (Gold) */
    /* Silver: #a8a8a8 (Silver) */
    /* Bronze: #cd7f32 (Bronze) */
    /* Unranked: #6a6a6a (Gray) */

    /* Tier badge glow effects for high tiers */
    .coliseum-tier-badge[style*="#c45a5a"] {
      text-shadow: 0 0 8px rgba(196, 90, 90, 0.6), 0 1px 2px rgba(0, 0, 0, 0.3);
    }

    .coliseum-tier-badge[style*="#9a6ab8"] {
      text-shadow: 0 0 8px rgba(154, 106, 184, 0.6), 0 1px 2px rgba(0, 0, 0, 0.3);
    }

    .coliseum-tier-badge[style*="#7ec8e8"] {
      text-shadow: 0 0 8px rgba(126, 200, 232, 0.6), 0 1px 2px rgba(0, 0, 0, 0.3);
    }

    .coliseum-tier-badge[style*="#b8956a"] {
      text-shadow: 0 0 6px rgba(184, 149, 106, 0.5), 0 1px 2px rgba(0, 0, 0, 0.3);
    }

    /* Opponent tier display in match found */
    .coliseum-opponent-tier {
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      color: ${P.text.secondary};
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
    }

    /* ============================================ */
    /* QUEUE PLAYERS LIST STYLES                   */
    /* ============================================ */

    /* Expanded queue panel when showing player list */
    .coliseum-queue-with-players {
      max-width: 600px;
    }

    /* Queue players panel container */
    .coliseum-queue-players-panel {
      margin-top: ${PARCHMENT_SPACING.xl};
      background: ${P.dark};
      border: 1px solid ${P.border};
      border-radius: ${PARCHMENT_RADIUS.md};
      overflow: hidden;
    }

    /* Players list header */
    .coliseum-queue-players-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: ${PARCHMENT_SPACING.md} ${PARCHMENT_SPACING.lg};
      background: linear-gradient(to bottom, ${P.border} 0%, ${P.borderDark} 100%);
      border-bottom: 1px solid ${P.border};
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      color: ${P.text.inverse};
      text-transform: uppercase;
    }

    .coliseum-queue-players-count {
      background: ${ARENA_COLORS.primary};
      color: white;
      padding: 2px 8px;
      border-radius: ${PARCHMENT_RADIUS.sm};
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
    }

    /* Scrollable player list */
    .coliseum-queue-players-list {
      max-height: 280px;
      overflow-y: auto;
      ${getParchmentScrollbarCSS('.coliseum-queue-players-list')}
    }

    /* Individual player row */
    .coliseum-queue-player-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: ${PARCHMENT_SPACING.md} ${PARCHMENT_SPACING.lg};
      border-bottom: 1px solid ${P.border};
      transition: background 0.2s;
    }

    .coliseum-queue-player-row:last-child {
      border-bottom: none;
    }

    .coliseum-queue-player-row:hover {
      background: ${P.mid};
    }

    /* Current user highlight */
    .coliseum-queue-player-row.current-user {
      background: rgba(74, 107, 138, 0.15);
      border-left: 3px solid ${ARENA_COLORS.primary};
    }

    .coliseum-queue-player-row.current-user:hover {
      background: rgba(74, 107, 138, 0.2);
    }

    /* Player main info (left side) */
    .coliseum-queue-player-main {
      display: flex;
      align-items: center;
      gap: ${PARCHMENT_SPACING.md};
    }

    /* Position number */
    .coliseum-queue-player-position {
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
      color: ${P.text.muted};
      min-width: 32px;
    }

    /* Player info container */
    .coliseum-queue-player-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    /* Player name row with tier icon */
    .coliseum-queue-player-name-row {
      display: flex;
      align-items: center;
      gap: ${PARCHMENT_SPACING.xs};
    }

    .coliseum-queue-player-name {
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
      color: ${P.text.primary};
    }

    /* YOU badge for current user */
    .queue-player-you-badge {
      background: ${ARENA_COLORS.primary};
      color: white;
      font-size: 10px;
      font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      padding: 2px 6px;
      border-radius: ${PARCHMENT_RADIUS.sm};
      margin-left: ${PARCHMENT_SPACING.xs};
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* Player stats row */
    .coliseum-queue-player-stats {
      display: flex;
      align-items: center;
      gap: ${PARCHMENT_SPACING.md};
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
    }

    .coliseum-queue-player-tier {
      font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
    }

    .coliseum-queue-player-rating {
      color: ${ARENA_COLORS.primary};
    }

    .coliseum-queue-player-level {
      color: ${P.text.muted};
    }

    /* Wait time (right side) */
    .coliseum-queue-player-wait {
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      color: ${P.text.muted};
      white-space: nowrap;
    }

    /* ============================================ */
    /* ACHIEVEMENT BADGE STYLES                    */
    /* ============================================ */

    /* Achievement badges container (in leaderboard) */
    .coliseum-achievement-badges {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-left: ${PARCHMENT_SPACING.sm};
    }

    /* Individual achievement badge */
    .coliseum-achievement-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      width: 22px;
      height: 22px;
      border-radius: ${PARCHMENT_RADIUS.sm};
      background: rgba(0, 0, 0, 0.2);
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .coliseum-achievement-badge:hover {
      transform: scale(1.15);
      z-index: 1;
    }

    /* Badge type styles */
    .coliseum-badge-streak {
      background: linear-gradient(135deg, rgba(255, 100, 0, 0.3), rgba(255, 50, 0, 0.2));
      box-shadow: 0 0 6px rgba(255, 100, 0, 0.4);
      animation: streak-pulse 2s ease-in-out infinite;
    }

    @keyframes streak-pulse {
      0%, 100% { box-shadow: 0 0 6px rgba(255, 100, 0, 0.4); }
      50% { box-shadow: 0 0 12px rgba(255, 100, 0, 0.7); }
    }

    .coliseum-badge-milestone {
      background: linear-gradient(135deg, rgba(107, 45, 61, 0.3), rgba(139, 115, 85, 0.2));
      box-shadow: 0 0 4px rgba(107, 45, 61, 0.3);
    }

    .coliseum-badge-skill {
      background: linear-gradient(135deg, rgba(74, 107, 138, 0.3), rgba(90, 128, 168, 0.2));
      box-shadow: 0 0 4px rgba(74, 107, 138, 0.3);
    }

    /* Streak badge in queue list */
    .coliseum-streak-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      margin-left: ${PARCHMENT_SPACING.xs};
    }

    /* Opponent badges on match found screen */
    .coliseum-opponent-badges {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
    }

    .coliseum-opponent-badges .coliseum-achievement-badge {
      width: 26px;
      height: 26px;
      font-size: 16px;
    }

    /* Legacy opponent badges layout (centered with border) */
    .coliseum-opponent-info .coliseum-opponent-badges {
      justify-content: center;
      margin-top: ${PARCHMENT_SPACING.md};
      padding-top: ${PARCHMENT_SPACING.sm};
      border-top: 1px solid ${P.border};
    }

    .coliseum-opponent-info .coliseum-opponent-badges .coliseum-achievement-badge {
      width: 28px;
      height: 28px;
      font-size: 18px;
    }

    /* Player name cell in leaderboard (flex container for name + badges) */
    .coliseum-player-name {
      display: flex;
      align-items: center;
      color: ${P.state.info};
      font-weight: 500;
    }

    .coliseum-player-name-text {
      color: ${P.state.info};
      font-weight: 500;
    }

    /* Responsive badge sizing for mobile */
    @media (max-width: 768px) {
      .coliseum-achievement-badges {
        gap: 2px;
        margin-left: ${PARCHMENT_SPACING.xs};
      }

      .coliseum-achievement-badge {
        width: 18px;
        height: 18px;
        font-size: 12px;
      }

      .coliseum-opponent-badges .coliseum-achievement-badge {
        width: 24px;
        height: 24px;
        font-size: 14px;
      }
    }

    /* ============================================ */
    /* MOBILE RESPONSIVE STYLES (< 600px)          */
    /* ============================================ */

    @media (max-width: 600px) {
      .coliseum-container {
        padding: ${PARCHMENT_SPACING.md};
      }

      .coliseum-header {
        flex-direction: column;
        gap: ${PARCHMENT_SPACING.md};
        align-items: stretch;
        margin-bottom: ${PARCHMENT_SPACING.md};
      }

      .coliseum-header button {
        min-height: var(--touch-target, 44px);
        width: 100%;
      }

      .coliseum-player-rating {
        margin-left: 0;
        justify-content: center;
        flex-wrap: wrap;
      }

      .coliseum-tabs {
        flex-wrap: wrap;
        margin-bottom: ${PARCHMENT_SPACING.md};
        padding: ${PARCHMENT_SPACING.xs};
      }

      .coliseum-tab {
        flex: 1 1 auto;
        min-width: 80px;
        min-height: var(--touch-target, 44px);
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        font-size: var(--font-size-sm, 12px);
      }

      .coliseum-queue-selection {
        flex-direction: column;
        gap: ${PARCHMENT_SPACING.md};
        margin-bottom: ${PARCHMENT_SPACING.lg};
      }

      .coliseum-queue-card {
        min-width: 100%;
        padding: ${PARCHMENT_SPACING.lg};
      }

      .coliseum-queue-panel {
        padding: ${PARCHMENT_SPACING.lg};
        max-width: 100%;
      }

      .coliseum-queue-btn {
        min-height: var(--touch-target, 44px);
        padding: ${PARCHMENT_SPACING.md} ${PARCHMENT_SPACING.xl};
        font-size: var(--font-size-md, 14px);
      }

      .coliseum-ready-btn,
      .coliseum-ready-btn-large {
        min-height: var(--touch-target, 44px);
        font-size: var(--font-size-lg, 18px);
      }

      .coliseum-leaderboard-filters {
        flex-direction: column;
        gap: ${PARCHMENT_SPACING.sm};
      }

      .coliseum-filter-group {
        flex-wrap: wrap;
      }

      .coliseum-filter-group select {
        min-height: var(--touch-target, 44px);
        font-size: var(--font-size-md, 14px);
      }

      .coliseum-leaderboard-table th,
      .coliseum-leaderboard-table td {
        padding: ${PARCHMENT_SPACING.sm};
        font-size: var(--font-size-sm, 12px);
      }

      .coliseum-history-filters {
        flex-direction: column;
        gap: ${PARCHMENT_SPACING.sm};
      }

      .coliseum-match-card {
        flex-direction: column;
        align-items: stretch;
        gap: ${PARCHMENT_SPACING.md};
      }

      .coliseum-details-btn {
        margin-left: 0;
        min-height: var(--touch-target, 44px);
      }

      .coliseum-match-found-panel {
        max-width: 100%;
        padding: ${PARCHMENT_SPACING.lg};
      }

      .coliseum-match-found-title {
        font-size: 20px;
      }

      .coliseum-opponent-stats-row {
        grid-template-columns: 1fr;
        gap: ${PARCHMENT_SPACING.xs};
      }

      .coliseum-opponent-stat-col {
        border-right: none !important;
        border-bottom: 1px solid ${P.border};
        padding: ${PARCHMENT_SPACING.sm};
      }

      .coliseum-opponent-stat-col:last-child {
        border-bottom: none;
      }

      .coliseum-teams-section {
        grid-template-columns: 1fr;
        gap: ${PARCHMENT_SPACING.lg};
      }

      .coliseum-match-details-content {
        width: 95%;
        padding: ${PARCHMENT_SPACING.md};
      }

      .coliseum-modal-close-btn {
        min-width: var(--touch-target, 44px);
        min-height: var(--touch-target, 44px);
      }

      .coliseum-load-more-btn {
        min-height: var(--touch-target, 44px);
        width: 100%;
      }

      .coliseum-queue-players-panel {
        margin-top: ${PARCHMENT_SPACING.md};
      }

      .coliseum-queue-player-row {
        flex-direction: column;
        align-items: flex-start;
        gap: ${PARCHMENT_SPACING.xs};
        padding: ${PARCHMENT_SPACING.md};
      }

      .coliseum-queue-player-wait {
        align-self: flex-end;
      }
    }
  `;
}
