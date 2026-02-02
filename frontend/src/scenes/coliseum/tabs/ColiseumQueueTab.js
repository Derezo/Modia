/**
 * ColiseumQueueTab - Queue selection, status, and match found screens
 */

import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_SPACING
} from '../../../ui/parchment/index.js';
import { getTier, getTierIcon, getStreakBadge } from '@shared/coliseum.js';

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
 * Render streak badge for a player
 * @param {number} winStreak - Current win streak
 * @returns {string} HTML string
 */
function renderStreakBadge(winStreak) {
  const streakBadge = getStreakBadge(winStreak);
  if (!streakBadge) {
    return '';
  }

  return `<span class="coliseum-streak-badge coliseum-badge-streak" title="${streakBadge.name}: ${streakBadge.description}">
    ${streakBadge.icon}
  </span>`;
}

/**
 * Render achievement badges for opponent on match found screen
 * @param {Array} badges - Array of badge objects with key, name, icon, type
 * @returns {string} HTML string for badges
 */
function renderOpponentBadges(badges) {
  if (!badges || badges.length === 0) {
    return '';
  }

  return `<div class="coliseum-opponent-badges">
    ${badges.map(badge => `
      <span class="coliseum-achievement-badge coliseum-badge-${badge.type}" title="${badge.name}">
        ${badge.icon}
      </span>
    `).join('')}
  </div>`;
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
  // Get streak badge based on current win streak (if available from server)
  const streakBadgeHtml = player.winStreak ? renderStreakBadge(player.winStreak) : '';

  return `
    <div class="coliseum-queue-player-row ${isCurrentUser ? 'current-user' : ''}">
      <div class="coliseum-queue-player-main">
        <span class="coliseum-queue-player-position">#${player.position}</span>
        <div class="coliseum-queue-player-info">
          <div class="coliseum-queue-player-name-row">
            ${renderCompactTierBadge(player)}
            <span class="coliseum-queue-player-name">${player.username}</span>
            ${streakBadgeHtml}
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
 * Format a number with comma separators
 * @param {number} num - Number to format
 * @returns {string} Formatted number string
 */
function formatNumber(num) {
  if (num == null || isNaN(num)) return '0';
  return num.toLocaleString();
}

/**
 * Calculate win rate percentage from wins and total matches
 * @param {number} wins - Number of wins
 * @param {number} total - Total matches
 * @returns {string} Win rate as percentage string
 */
function calculateWinRate(wins, total) {
  if (!total || total === 0) return 'N/A';
  const rate = (wins / total) * 100;
  return `${rate.toFixed(1)}%`;
}

/**
 * Render the opponent stats row (3 columns: Win Rate, Matches, Streak)
 * @param {Object} opponent - Opponent data
 * @returns {string} HTML string
 */
function renderOpponentStatsRow(opponent) {
  const wins = opponent.wins ?? null;
  const totalMatches = opponent.totalMatches ?? null;
  const winStreak = opponent.winStreak || 0;

  const winRate = (wins !== null && totalMatches !== null)
    ? calculateWinRate(wins, totalMatches)
    : 'N/A';

  const matchCount = totalMatches !== null ? formatNumber(totalMatches) : 'N/A';
  const streakDisplay = winStreak > 0 ? `\u{1F525} ${winStreak}` : '-';

  return `
    <div class="coliseum-opponent-stats-row">
      <div class="coliseum-opponent-stat-col">
        <div class="coliseum-opponent-stat-value">${winRate}</div>
        <div class="coliseum-opponent-stat-label">Win Rate</div>
      </div>
      <div class="coliseum-opponent-stat-col">
        <div class="coliseum-opponent-stat-value">${matchCount}</div>
        <div class="coliseum-opponent-stat-label">Matches</div>
      </div>
      <div class="coliseum-opponent-stat-col">
        <div class="coliseum-opponent-stat-value ${winStreak >= 3 ? 'streak-active' : ''}">${streakDisplay}</div>
        <div class="coliseum-opponent-stat-label">Streak</div>
      </div>
    </div>
  `;
}

/**
 * Render match found screen with ready check
 * @param {Object} context - Shared context
 * @returns {string} HTML string
 */
function renderMatchFound(context) {
  const { currentMatch, isReady, opponentReady } = context;
  const isStarting = isReady && opponentReady;
  const opponent = currentMatch.opponent || {};
  const opponentBadges = opponent.badges || [];

  // Get opponent tier info
  const opponentRating = opponent.rating || 0;
  const opponentTier = getTier(opponentRating);
  const tierIcon = opponentTier.icon ? getTierIcon(opponentTier.icon) : '';

  return `
    <div class="coliseum-match-found-panel ${isStarting ? 'coliseum-match-starting' : ''}">
      <div class="coliseum-match-found-title">
        \u{2694}\u{FE0F} ${isStarting ? 'MATCH STARTING!' : 'MATCH FOUND!'} \u{2694}\u{FE0F}
      </div>

      <div class="coliseum-opponent-card">
        <div class="coliseum-opponent-card-header">YOUR OPPONENT</div>

        <div class="coliseum-opponent-card-body">
          <div class="coliseum-opponent-name-row">
            <span class="coliseum-opponent-username">${opponent.username || 'Unknown'}</span>
            <span class="coliseum-opponent-tier-display" style="color: ${opponentTier.color};">
              ${opponentTier.name} ${tierIcon}
            </span>
          </div>

          <div class="coliseum-opponent-elo">
            ${formatNumber(opponentRating)} ELO
          </div>

          ${renderOpponentStatsRow(opponent)}

          <div class="coliseum-opponent-party-row">
            <span class="coliseum-opponent-party-level">Party Level: ${opponent.partyLevel || '?'}</span>
            ${opponentBadges.length > 0 ? renderOpponentBadges(opponentBadges) : ''}
          </div>
        </div>
      </div>

      <div class="coliseum-ready-section">
        <button class="coliseum-ready-btn-large ${isReady ? 'ready' : ''}" id="ready-btn" ${isReady ? 'disabled' : ''}>
          ${isReady ? 'READY!' : 'READY'}
        </button>

        <div class="coliseum-ready-status-enhanced">
          <span class="coliseum-ready-label">Ready Status:</span>
          <div class="coliseum-ready-indicators">
            <span class="coliseum-ready-indicator-item">
              <span class="ready-dot ${isReady ? 'filled' : ''}">${isReady ? '\u25CF' : '\u25CB'}</span>
              <span>You</span>
            </span>
            <span class="coliseum-ready-indicator-item">
              <span class="ready-dot ${opponentReady ? 'filled' : ''}">${opponentReady ? '\u25CF' : '\u25CB'}</span>
              <span>Opponent</span>
            </span>
          </div>
        </div>

        <div class="coliseum-countdown-enhanced" id="ready-countdown"></div>
      </div>
    </div>
  `;
}
