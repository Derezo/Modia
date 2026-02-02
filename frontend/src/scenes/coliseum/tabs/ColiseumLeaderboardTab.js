/**
 * ColiseumLeaderboardTab - Leaderboard display and filtering
 */

import { getTier, getTierIcon } from '@shared/coliseum.js';

/**
 * Render a tier badge with icon and color
 * @param {number} rating - Player rating
 * @param {Object} tierData - Optional pre-computed tier data from API
 * @returns {string} HTML string for tier badge
 */
function renderTierBadge(rating, tierData = null) {
  const tier = tierData || getTier(rating);
  const icon = tier.icon ? getTierIcon(tier.icon) : '';

  return `<span class="coliseum-tier-badge" style="color: ${tier.color};" title="${tier.name}">
    ${icon ? `<span class="tier-icon">${icon}</span>` : ''}
    <span class="tier-name">${tier.name}</span>
  </span>`;
}

/**
 * Render achievement badges for a player
 * @param {Array} badges - Array of badge objects with key, name, icon, type
 * @returns {string} HTML string for badges
 */
function renderAchievementBadges(badges) {
  if (!badges || badges.length === 0) {
    return '';
  }

  return `<span class="coliseum-achievement-badges">
    ${badges.map(badge => `
      <span class="coliseum-achievement-badge coliseum-badge-${badge.type}" title="${badge.name}">
        ${badge.icon}
      </span>
    `).join('')}
  </span>`;
}

/**
 * Render leaderboard content
 * @param {Object} context - Shared context from ColiseumScene
 * @returns {string} HTML string
 */
export function renderLeaderboard(context) {
  const { loadingLeaderboard, leaderboardData, leaderboardQueueType, leaderboardTimeFilter, userRank, game } = context;

  if (loadingLeaderboard) {
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
            <option value="1v1" ${leaderboardQueueType === '1v1' ? 'selected' : ''}>1v1 Duel</option>
            <option value="3v3" ${leaderboardQueueType === '3v3' ? 'selected' : ''}>3v3 Skirmish</option>
            <option value="5v5" ${leaderboardQueueType === '5v5' ? 'selected' : ''}>5v5 Battle</option>
          </select>
        </div>
        <div class="coliseum-filter-group">
          <label>Time Period:</label>
          <select id="leaderboard-time-filter">
            <option value="all" ${leaderboardTimeFilter === 'all' ? 'selected' : ''}>All Time</option>
            <option value="week" ${leaderboardTimeFilter === 'week' ? 'selected' : ''}>This Week</option>
            <option value="today" ${leaderboardTimeFilter === 'today' ? 'selected' : ''}>Today</option>
          </select>
        </div>
      </div>

      ${leaderboardData.length === 0 ? `
        <div class="coliseum-no-data-message">No rankings available yet. Be the first to compete!</div>
      ` : `
        <table class="coliseum-leaderboard-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Player</th>
              <th>Tier</th>
              <th>Rating</th>
              <th>W/L</th>
              <th>Streak</th>
            </tr>
          </thead>
          <tbody>
            ${leaderboardData.map((entry, index) => {
    const rank = index + 1;
    const isCurrentUser = entry.userId === game.userId;
    const crownIcon = rank === 1 ? '<span class="coliseum-crown-icon">&#128081;</span>' : '';
    const tierData = entry.tierColor ? { name: entry.tier, color: entry.tierColor, icon: entry.tierIcon } : null;
    const badges = entry.badges || [];

    return `
                <tr class="${isCurrentUser ? 'current-user' : ''}">
                  <td class="coliseum-rank-cell coliseum-rank-${rank <= 3 ? rank : ''}">#${rank}${crownIcon}</td>
                  <td class="coliseum-player-name">
                    <span class="coliseum-player-name-text">${entry.username}</span>
                    ${renderAchievementBadges(badges)}
                  </td>
                  <td class="coliseum-tier-cell">${renderTierBadge(entry.rating, tierData)}</td>
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

        ${userRank && userRank > 100 ? `
          <div class="coliseum-user-rank-banner">
            <div class="rank-label">Your Rank</div>
            <div class="rank-value">#${userRank}</div>
          </div>
        ` : ''}
      `}
    </div>
  `;
}
