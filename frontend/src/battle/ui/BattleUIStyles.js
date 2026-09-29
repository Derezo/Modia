/**
 * @module BattleUIStyles
 * @description CSS styles for battle UI components.
 * Extracted from BattleUI.js for maintainability.
 */

/**
 * Get battle UI stylesheet content.
 * @returns {string} CSS styles
 */
export function getBattleUIStyles() {
  return `
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

    /* Turn Indicator Styles - Frosted Glass */
    .turn-indicator-content {
      background: rgba(20, 20, 30, 0.6);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      padding: 10px 20px;
      font-size: 15px;
      font-weight: 600;
      text-align: center;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
      animation: turnIndicatorFadeIn 0.3s ease-out;
    }

    /* Player's turn (local) - subtle green */
    .turn-indicator-content.player {
      border-color: rgba(74, 144, 217, 0.4);
      color: #7ab8ff;
      text-shadow: 0 0 8px rgba(74, 144, 217, 0.3);
    }
    .turn-indicator-content.player_local {
      border-color: rgba(74, 255, 74, 0.4);
      color: #7aff7a;
      text-shadow: 0 0 8px rgba(74, 255, 74, 0.3);
    }

    /* Remote player's turn - subtle yellow */
    .turn-indicator-content.player_remote {
      border-color: rgba(217, 217, 74, 0.4);
      color: #e9e97a;
      text-shadow: 0 0 8px rgba(217, 217, 74, 0.3);
    }

    /* Enemy turn - subtle red */
    .turn-indicator-content.enemy {
      border-color: rgba(217, 74, 74, 0.4);
      color: #ff7a7a;
      text-shadow: 0 0 8px rgba(217, 74, 74, 0.3);
    }

    /* Softer animation */
    @keyframes turnIndicatorFadeIn {
      0% { opacity: 0; transform: translateY(-10px); }
      100% { opacity: 1; transform: translateY(0); }
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

    /* Opponent Turn Indicator */
    .opponent-turn-content {
      background: linear-gradient(135deg, rgba(40, 40, 60, 0.95), rgba(30, 30, 45, 0.95));
      border: 2px solid #d4af37;
      border-radius: 8px;
      padding: 12px 24px;
      display: flex;
      align-items: center;
      gap: 10px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    }
    .opponent-turn-icon {
      font-size: 20px;
      animation: opponentPulse 1.5s ease-in-out infinite;
    }
    #opponent-turn-text {
      color: #f0e6d2;
      font-size: 14px;
      font-weight: 600;
    }
    @keyframes opponentPulse {
      0%, 100% { opacity: 0.6; }
      50% { opacity: 1; }
    }

    /* Move/attack confirmation and the targeting Cancel bar: parchment, not
       the legacy navy .ui-panel/.btn system style */
    #battle-ui #confirm-panel .ui-panel,
    #battle-ui #action-menu .ui-panel {
      background: linear-gradient(to bottom, #f0e6d2 0%, #e2d3b4 100%);
      border: 2px solid #8b7355;
      border-radius: 6px;
      color: #2d2418;
      font-family: Georgia, serif;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    }
    #battle-ui #confirm-text {
      font-weight: bold;
      color: #2d2418;
    }
    #battle-ui #confirm-panel .btn,
    #battle-ui #action-menu .btn {
      font-family: Georgia, serif;
      text-transform: none;
      letter-spacing: 0;
    }
    #battle-ui #confirm-panel .btn-primary {
      background: linear-gradient(to bottom, #5a9e4a 0%, #3d7530 100%);
      border: 2px solid #2f5c25;
      color: #fff;
    }
    #battle-ui #confirm-panel .btn-secondary,
    #battle-ui #action-menu .btn-secondary {
      background: linear-gradient(to bottom, #e8dcc8 0%, #c9b899 100%);
      border: 2px solid #8b7355;
      color: #2d2418;
    }
    #battle-ui #confirm-panel .btn-secondary:hover,
    #battle-ui #action-menu .btn-secondary:hover {
      background: linear-gradient(to bottom, #f0e8d8 0%, #d4c4a8 100%);
    }
  `;
}

/**
 * Inject battle UI styles into the document head.
 * Only injects if not already present.
 */
export function injectBattleUIStyles() {
  if (document.getElementById('battle-styles')) return;

  const style = document.createElement('style');
  style.id = 'battle-styles';
  style.textContent = getBattleUIStyles();
  document.head.appendChild(style);
}
