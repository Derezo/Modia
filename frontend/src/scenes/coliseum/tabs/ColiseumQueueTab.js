/**
 * ColiseumQueueTab - Queue selection, status, and match found screens
 */

import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_SPACING
} from '../../../ui/parchment/index.js';
import { getTier, getTierIcon } from '@shared/coliseum.js';

const P = PARCHMENT_COLORS;

/**
 * Render tier badge for queue/match displays
 * @param {number} rating - Player rating
 * @returns {string} HTML string
 */
function renderTierBadge(rating) {
  const tier = getTier(rating);
  const icon = tier.icon ? getTierIcon(tier.icon) : '';
  return `<span class="coliseum-tier-badge" style="color: ${tier.color};">
    ${icon ? `<span class="tier-icon">${icon}</span>` : ''}
    <span class="tier-name">${tier.name}</span>
  </span>`;
}

/**
 * Render compact tier badge (icon + color only)
 * @param {Object} player - Player object with tierIcon and tierColor
 * @returns {string} HTML string
 */
function renderCompactTierBadge(player) {
  const icon = player.tierIcon ? getTierIcon(player.tierIcon) : '';
  return `<span class="coliseum-tier-badge-compact" style="color: ${player.tierColor};">
    ${icon}
  </span>`;
}

/**
 * Format wait time for display
 * @param {number} seconds - Wait time in seconds
 * @returns {string} Formatted time string
 */
function formatWaitTimeDisplay(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}

/**
 * Render queue content based on current state
 * @param {Object} context - Shared context from ColiseumScene
 * @returns {string} HTML string
 */
export function renderQueueContent(context) {
  const { currentMatch, isInQueue } = context;

  // Match found state
  if (currentMatch) {
    return renderMatchFound(context);
  }

  // Queue state
  if (isInQueue) {
    return renderQueueStatus(context);
  }

  // Queue selection
  return renderQueueSelection(context);
}

/**
 * Render queue selection cards
 * @param {Object} context - Shared context
 * @returns {string} HTML string
 */
function renderQueueSelection(context) {
  const { queueStatuses, selectedQueue } = context;

  const queueTypes = [
    { id: '1v1', name: '1v1 Duel', desc: 'Solo combat', partySize: 1 },
    { id: '3v3', name: '3v3 Skirmish', desc: '3 character teams', partySize: 3 },
    { id: '5v5', name: '5v5 Battle', desc: '5 character teams', partySize: 5 }
  ];

  return `
    <h3 style="color: ${P.text.inverse}; font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily}; margin-bottom: ${PARCHMENT_SPACING.xl};">Select Arena Type</h3>

    <div class="coliseum-queue-selection">
      ${queueTypes.map(q => {
    const status = queueStatuses.find(s => s.queueType === q.id);
    const playersInQueue = status?.queueSize || 0;
    const isSelected = selectedQueue === q.id;

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
        ${selectedQueue ? `Join ${selectedQueue} Queue` : 'Select an arena type above'}
      </div>
      <button class="coliseum-queue-btn join" id="join-queue-btn" ${!selectedQueue ? 'disabled' : ''}>
        Enter Queue
      </button>
    </div>
  `;
}

/**
 * Render queue status while waiting for match
 * @param {Object} context - Shared context
 * @returns {string} HTML string
 */
function renderQueueStatus(context) {
  const { queueStatus, selectedQueue, formatWaitTime, queuePlayers } = context;

  const position = queueStatus?.position || '?';
  const queueSize = queueStatus?.queueSize || '?';
  const waitTime = formatWaitTime(queueStatus?.estimatedWait || 0);
  const players = queuePlayers || [];

  return `
    <div class="coliseum-queue-panel coliseum-queue-with-players">
      <div class="coliseum-queue-panel-title">Searching for ${selectedQueue} Match...</div>

      <div class="coliseum-queue-status">
        <div class="coliseum-queue-position">#${position}</div>
        <div class="coliseum-queue-label">Your Position (${queueSize} players in queue)</div>

        <div class="coliseum-queue-waiting">
          <div class="coliseum-queue-spinner"></div>
          <span>Estimated wait: ${waitTime}</span>
        </div>
      </div>

      ${players.length > 0 ? renderQueuePlayersList(players) : ''}

      <button class="coliseum-queue-btn leave" id="leave-queue-btn" style="margin-top: ${PARCHMENT_SPACING.xl};">
        Leave Queue
      </button>
    </div>
  `;
}

/**
 * Render the queue players list
 * @param {Array} players - Array of player objects in queue
 * @returns {string} HTML string
 */
function renderQueuePlayersList(players) {
  return `
    <div class="coliseum-queue-players-panel">
      <div class="coliseum-queue-players-header">
        <span>Players in Queue</span>
        <span class="coliseum-queue-players-count">${players.length}</span>
      </div>
      <div class="coliseum-queue-players-list">
        ${players.map(player => renderQueuePlayerRow(player)).join('')}
      </div>
    </div>
  `;
}

/**
 * Render a single player row in the queue list
 * @param {Object} player - Player object
 * @returns {string} HTML string
 */
function renderQueuePlayerRow(player) {
  const isCurrentUser = player.isCurrentUser;
  const waitTimeStr = formatWaitTimeDisplay(player.waitTime);

  return `
    <div class="coliseum-queue-player-row ${isCurrentUser ? 'current-user' : ''}">
      <div class="coliseum-queue-player-main">
        <span class="coliseum-queue-player-position">#${player.position}</span>
        <div class="coliseum-queue-player-info">
          <div class="coliseum-queue-player-name-row">
            ${renderCompactTierBadge(player)}
            <span class="coliseum-queue-player-name">${player.username}</span>
            ${isCurrentUser ? '<span class="queue-player-you-badge">YOU</span>' : ''}
          </div>
          <div class="coliseum-queue-player-stats">
            <span class="coliseum-queue-player-tier" style="color: ${player.tierColor};">${capitalizeFirst(player.tier)}</span>
            <span class="coliseum-queue-player-rating">${player.rating} ELO</span>
            <span class="coliseum-queue-player-level">Lv.${player.partyLevel}</span>
          </div>
        </div>
      </div>
      <div class="coliseum-queue-player-wait">
        Waiting ${waitTimeStr}
      </div>
    </div>
  `;
}

/**
 * Capitalize first letter of string
 * @param {string} str - Input string
 * @returns {string} Capitalized string
 */
function capitalizeFirst(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Render match found screen with ready check
 * @param {Object} context - Shared context
 * @returns {string} HTML string
 */
function renderMatchFound(context) {
  const { currentMatch, isReady, opponentReady, playerRating } = context;
  const isStarting = isReady && opponentReady;

  return `
    <div class="coliseum-match-found-panel ${isStarting ? 'coliseum-match-starting' : ''}">
      <div class="coliseum-match-found-title">
        ${isStarting ? 'MATCH STARTING!' : 'MATCH FOUND!'}
      </div>

      <div class="coliseum-opponent-info">
        <div class="coliseum-opponent-label">Your Opponent</div>
        <div class="coliseum-opponent-name">${currentMatch.opponent?.username || 'Unknown'}</div>
        <div class="coliseum-opponent-level">Avg Level: ${currentMatch.opponent?.partyLevel || '?'}</div>
        ${playerRating ? `
          <div class="coliseum-opponent-tier" style="margin-top: 8px;">
            Your Tier: ${renderTierBadge(playerRating)}
          </div>
        ` : ''}
      </div>

      <div class="coliseum-ready-section">
        <button class="coliseum-ready-btn ${isReady ? 'ready' : ''}" id="ready-btn" ${isReady ? 'disabled' : ''}>
          ${isReady ? 'READY!' : 'Click to Ready'}
        </button>

        <div class="coliseum-ready-status">
          <div class="coliseum-ready-indicator">
            <div class="dot ${isReady ? 'ready' : ''}"></div>
            <span>You</span>
          </div>
          <div class="coliseum-ready-indicator">
            <div class="dot ${opponentReady ? 'ready' : ''}"></div>
            <span>Opponent</span>
          </div>
        </div>

        <div class="coliseum-countdown" id="ready-countdown"></div>
      </div>
    </div>
  `;
}
