/**
 * ColiseumHistoryTab - Match history display and filtering
 */

import { PARCHMENT_COLORS } from '../../../ui/parchment/index.js';
import { getTier, getTierIcon } from '@shared/coliseum.js';

const P = PARCHMENT_COLORS;

/**
 * Render a compact tier badge for match history
 * @param {string} tierName - Tier name
 * @param {string} tierColor - Tier color
 * @param {string} tierIcon - Tier icon name
 * @returns {string} HTML string
 */
function renderCompactTierBadge(tierName, tierColor, tierIcon) {
  const icon = tierIcon ? getTierIcon(tierIcon) : '';
  return `<span class="coliseum-tier-badge-compact" style="color: ${tierColor};" title="${tierName}">${icon || tierName.charAt(0)}</span>`;
}

/**
 * Render match history content
 * @param {Object} context - Shared context from ColiseumScene
 * @returns {string} HTML string
 */
export function renderMatchHistory(context) {
  const {
    loadingHistory,
    matchHistoryData,
    matchHistoryFilter,
    hasMoreMatches,
    selectedMatchDetails,
    game,
    formatTimestamp
  } = context;

  if (loadingHistory && matchHistoryData.length === 0) {
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
            <option value="all" ${matchHistoryFilter === 'all' ? 'selected' : ''}>All Matches</option>
            <option value="mine" ${matchHistoryFilter === 'mine' ? 'selected' : ''}>My Matches</option>
          </select>
        </div>
      </div>

      ${matchHistoryData.length === 0 ? `
        <div class="coliseum-no-data-message">No matches found. Start battling to build your history!</div>
      ` : `
        <div class="coliseum-history-list">
          ${matchHistoryData.map(match => {
    const isWinner = match.winnerId === game.userId;
    const isLoser = match.loserId === game.userId;
    const isMyMatch = isWinner || isLoser;
    const resultClass = isMyMatch ? (isWinner ? 'victory' : 'defeat') : '';
    const ratingChange = isWinner ? match.winnerRatingChange : (isLoser ? match.loserRatingChange : null);

    // Get tier info for winner and loser
    const winnerTierInfo = match.winnerTierColor
      ? { name: match.winnerTier, color: match.winnerTierColor, icon: match.winnerTierIcon }
      : getTier(match.winnerRating || 1000);
    const loserTierInfo = match.loserTierColor
      ? { name: match.loserTier, color: match.loserTierColor, icon: match.loserTierIcon }
      : getTier(match.loserRating || 1000);

    return `
              <div class="coliseum-match-card ${resultClass}">
                <div class="coliseum-match-info">
                  <div class="coliseum-match-result">
                    ${renderCompactTierBadge(winnerTierInfo.name, winnerTierInfo.color, winnerTierInfo.icon)}
                    <span class="winner">${match.winnerUsername}</span>
                    <span style="color: ${P.text.muted};"> defeated </span>
                    ${renderCompactTierBadge(loserTierInfo.name, loserTierInfo.color, loserTierInfo.icon)}
                    <span class="loser">${match.loserUsername}</span>
                  </div>
                  <div class="coliseum-match-meta">
                    <span>${match.queueType}</span>
                    <span>${match.turnCount || '?'} turns</span>
                    <span>${formatTimestamp(match.createdAt)}</span>
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

        ${hasMoreMatches ? `
          <button class="coliseum-load-more-btn" id="load-more-matches" ${loadingHistory ? 'disabled' : ''}>
            ${loadingHistory ? 'Loading...' : 'Load More'}
          </button>
        ` : ''}
      `}
    </div>

    ${selectedMatchDetails ? renderMatchDetailsModal(context) : ''}
  `;
}

/**
 * Render match details modal
 * @param {Object} context - Shared context
 * @returns {string} HTML string
 */
function renderMatchDetailsModal(context) {
  const { selectedMatchDetails: details, loadingMatchDetails, game, formatDuration } = context;

  if (loadingMatchDetails) {
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

  const isWinner = details.winnerId === game.userId;
  const isLoser = details.loserId === game.userId;
  const isMyMatch = isWinner || isLoser;

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
              ${winnerTeam.length > 0 ? winnerTeam.map(char => renderCharacterItem(char)).join('') : `
                <div class="coliseum-no-data-message" style="padding: 10px;">Team data not available</div>
              `}
            </div>
          </div>
          <div class="coliseum-team-panel loser">
            <div class="coliseum-team-header loser">${details.loserUsername}'s Team</div>
            <div class="coliseum-character-list">
              ${loserTeam.length > 0 ? loserTeam.map(char => renderCharacterItem(char)).join('') : `
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
                  <div class="stat-value">${formatDuration(stats.duration)}</div>
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

/**
 * Render a character item in the team list
 * @param {Object} char - Character data
 * @returns {string} HTML string
 */
function renderCharacterItem(char) {
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
