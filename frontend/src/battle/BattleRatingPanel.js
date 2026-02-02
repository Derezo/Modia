/**
 * @module BattleRatingPanel
 * @description DOM-based PvP rating panel for post-battle display.
 *
 * Displays tier, rating, rating change, and rank change with animations.
 * Positioned above the battle stats table for proper z-index layering.
 *
 * @see BattleOutroSequence.js - Orchestrates victory/defeat animations
 * @see BattleStatsTable.js - Similar DOM-based component pattern
 */

import { getTier, getTierIcon } from '@shared/coliseum.js';

/**
 * BattleRatingPanel - PvP rating display component
 *
 * Usage:
 *   const ratingPanel = new BattleRatingPanel(battleScene);
 *   ratingPanel.show(pvpResult);
 *   // Later...
 *   ratingPanel.hide();
 *   ratingPanel.destroy();
 */
export class BattleRatingPanel {
  constructor(battleScene) {
    this.scene = battleScene;
    this.container = null;
    this.isVisible = false;
    this.animationTimeout = null;
    this.ratingAnimationFrame = null;
    this.pvpResult = null;
  }

  /**
   * Show the rating panel with animation
   * @param {Object} pvpResult - PvP result data
   * @param {number} pvpResult.oldRating - Rating before match
   * @param {number} pvpResult.newRating - Rating after match
   * @param {number} pvpResult.ratingChange - Change in rating
   * @param {number} pvpResult.oldRank - Rank before match (optional)
   * @param {number} pvpResult.newRank - Rank after match (optional)
   * @param {boolean} pvpResult.tierChanged - Whether tier changed (optional)
   * @param {boolean} pvpResult.surrenderPenalty - Whether surrender penalty applied (optional)
   */
  show(pvpResult) {
    if (this.isVisible) {
      this.hide();
    }

    this.pvpResult = pvpResult;
    this.createPanelDOM(pvpResult);
    this.isVisible = true;

    // Trigger slide-in animation after DOM insertion
    requestAnimationFrame(() => {
      if (this.container) {
        this.container.classList.add('visible');
        // Start rating counter animation
        this.animateRatingCounter();
      }
    });
  }

  /**
   * Hide the rating panel with animation
   */
  hide() {
    if (!this.isVisible || !this.container) return;

    // Cancel any ongoing animation
    if (this.ratingAnimationFrame) {
      cancelAnimationFrame(this.ratingAnimationFrame);
      this.ratingAnimationFrame = null;
    }

    this.container.classList.remove('visible');

    // Remove from DOM after animation completes
    this.animationTimeout = setTimeout(() => {
      this.cleanup();
    }, 400);
  }

  /**
   * Create the DOM structure for the rating panel
   */
  createPanelDOM(pvpResult) {
    this.addStyles();

    const tier = getTier(pvpResult.newRating);
    const tierIcon = getTierIcon(tier.icon);
    const changeColor = pvpResult.ratingChange >= 0 ? 'positive' : 'negative';
    const changePrefix = pvpResult.ratingChange >= 0 ? '+' : '';

    // Create container
    this.container = document.createElement('div');
    this.container.className = 'battle-rating-panel';
    this.container.style.borderColor = tier.color;

    let rankHtml = '';
    if (pvpResult.oldRank && pvpResult.newRank) {
      const rankImproved = pvpResult.newRank < pvpResult.oldRank;
      const rankDeclined = pvpResult.newRank > pvpResult.oldRank;
      const rankArrow = rankImproved ? '↑' : (rankDeclined ? '↓' : '→');
      const rankClass = rankImproved ? 'positive' : (rankDeclined ? 'negative' : 'neutral');
      rankHtml = `
        <div class="brp-rank brp-${rankClass}">
          <span class="brp-rank-label">Rank</span>
          <span class="brp-rank-value">#${pvpResult.oldRank} ${rankArrow} #${pvpResult.newRank}</span>
        </div>
      `;
    }

    let tierChangeHtml = '';
    if (pvpResult.tierChanged) {
      const direction = pvpResult.ratingChange > 0 ? 'PROMOTED!' : 'DEMOTED';
      tierChangeHtml = `<div class="brp-tier-change">${direction}</div>`;
    }

    this.container.innerHTML = `
      ${tierChangeHtml}
      <div class="brp-content">
        <div class="brp-tier" style="color: ${tier.color}">
          <span class="brp-tier-icon">${tierIcon}</span>
          <span class="brp-tier-name">${tier.name}</span>
        </div>
        <div class="brp-rating">
          <span class="brp-rating-value" data-start="${pvpResult.oldRating}" data-end="${pvpResult.newRating}">${pvpResult.oldRating.toLocaleString()}</span>
          <span class="brp-rating-change brp-${changeColor}">(${changePrefix}${pvpResult.ratingChange})</span>
        </div>
        ${rankHtml}
      </div>
    `;

    // Add to game UI overlay
    this.scene.game.uiOverlay.appendChild(this.container);
  }

  /**
   * Animate the rating counter from old to new value
   */
  animateRatingCounter() {
    const ratingEl = this.container?.querySelector('.brp-rating-value');
    if (!ratingEl) return;

    const startValue = parseInt(ratingEl.dataset.start, 10);
    const endValue = parseInt(ratingEl.dataset.end, 10);
    const duration = 1500; // 1.5 seconds
    const startTime = performance.now();

    const animate = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const currentValue = Math.floor(startValue + (endValue - startValue) * eased);

      ratingEl.textContent = currentValue.toLocaleString();

      if (progress < 1) {
        this.ratingAnimationFrame = requestAnimationFrame(animate);
      }
    };

    this.ratingAnimationFrame = requestAnimationFrame(animate);
  }

  /**
   * Add component styles to document head
   */
  addStyles() {
    if (document.getElementById('battle-rating-panel-styles')) return;

    const style = document.createElement('style');
    style.id = 'battle-rating-panel-styles';
    style.textContent = `
      /* Battle Rating Panel Container */
      .battle-rating-panel {
        position: absolute;
        top: 18%;
        left: 50%;
        transform: translateX(-50%) translateY(-20px);
        background: rgba(30, 25, 20, 0.95);
        border: 3px solid #5a4a3a;
        border-radius: 10px;
        padding: 12px 24px;
        opacity: 0;
        transition: opacity 0.4s ease, transform 0.4s ease;
        z-index: 145;
        box-shadow:
          0 6px 24px rgba(0, 0, 0, 0.5),
          inset 0 1px 0 rgba(255, 255, 255, 0.1);
        font-family: 'Georgia', 'Times New Roman', serif;
        min-width: 280px;
      }

      .battle-rating-panel.visible {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }

      /* Tier Change Badge */
      .brp-tier-change {
        position: absolute;
        top: -14px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(to bottom, #ffd700, #c9a227);
        color: #2a1f0a;
        font-size: 11px;
        font-weight: bold;
        padding: 3px 12px;
        border-radius: 4px;
        text-transform: uppercase;
        letter-spacing: 1px;
        box-shadow: 0 2px 8px rgba(255, 215, 0, 0.5);
        animation: tierChangePulse 1.5s ease-in-out infinite;
      }

      @keyframes tierChangePulse {
        0%, 100% { box-shadow: 0 2px 8px rgba(255, 215, 0, 0.5); }
        50% { box-shadow: 0 2px 16px rgba(255, 215, 0, 0.8); }
      }

      /* Content Layout */
      .brp-content {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
      }

      /* Tier Section */
      .brp-tier {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .brp-tier-icon {
        font-size: 24px;
      }

      .brp-tier-name {
        font-size: 16px;
        font-weight: bold;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
      }

      /* Rating Section */
      .brp-rating {
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      .brp-rating-value {
        font-size: 22px;
        font-weight: bold;
        color: #e8d4b8;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
        font-family: 'Consolas', 'Monaco', monospace;
      }

      .brp-rating-change {
        font-size: 14px;
        font-weight: bold;
      }

      .brp-rating-change.brp-positive {
        color: #4a7548;
      }

      .brp-rating-change.brp-negative {
        color: #c45a5a;
      }

      /* Rank Section */
      .brp-rank {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
      }

      .brp-rank-label {
        font-size: 10px;
        color: #8a7a6a;
        text-transform: uppercase;
        letter-spacing: 1px;
      }

      .brp-rank-value {
        font-size: 14px;
        font-weight: bold;
      }

      .brp-rank.brp-positive .brp-rank-value {
        color: #4a7548;
      }

      .brp-rank.brp-negative .brp-rank-value {
        color: #c45a5a;
      }

      .brp-rank.brp-neutral .brp-rank-value {
        color: #bfae8a;
      }

      /* Mobile Styles */
      @media (max-width: 700px) {
        .battle-rating-panel {
          min-width: 240px;
          padding: 10px 16px;
          top: 15%;
        }

        .brp-content {
          gap: 12px;
        }

        .brp-tier-icon {
          font-size: 20px;
        }

        .brp-tier-name {
          font-size: 14px;
        }

        .brp-rating-value {
          font-size: 18px;
        }

        .brp-rating-change {
          font-size: 12px;
        }

        .brp-rank-value {
          font-size: 12px;
        }

        .brp-tier-change {
          font-size: 10px;
          padding: 2px 10px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Clean up the DOM container
   */
  cleanup() {
    if (this.animationTimeout) {
      clearTimeout(this.animationTimeout);
      this.animationTimeout = null;
    }

    if (this.ratingAnimationFrame) {
      cancelAnimationFrame(this.ratingAnimationFrame);
      this.ratingAnimationFrame = null;
    }

    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }

    this.container = null;
    this.isVisible = false;
    this.pvpResult = null;
  }

  /**
   * Full cleanup and destroy
   */
  destroy() {
    this.cleanup();
    // Remove injected styles when component is destroyed
    const styleEl = document.getElementById('battle-rating-panel-styles');
    if (styleEl) {
      styleEl.remove();
    }
  }
}
