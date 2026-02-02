/**
 * BattleOutroSequence - Orchestrates victory/defeat animations
 *
 * Phase State Machine:
 * - idle: Not started
 * - dim_scene: Black/sepia overlay fades in (300ms)
 * - banner_appear: "VICTORY!" or "DEFEAT!" text animates (600ms)
 * - rewards_reveal: (Victory) Gold, XP, items with fireworks
 * - summary: (Defeat) Battle summary message
 * - pvp_details: (PvP) Opponent info & rating changes (1000ms)
 * - stats_reveal: (If unitStats) Battle statistics table (1500ms)
 * - awaiting_confirmation: Continue button shown, waits for user click
 * - fade_out: Everything fades to black (400ms)
 * - complete: Trigger scene transition
 */

import { BattleFireworks } from './BattleFireworks.js';
import { BattleStatsTable } from './BattleStatsTable.js';
import { getTier, getTierColor, getNextTierProgress, getTierIcon } from '@shared/coliseum.js';

// Rarity color palette (matches RewardsModal)
const RARITY_COLORS = {
  common: '#cccccc',
  uncommon: '#1eff00',
  rare: '#0070dd',
  epic: '#a335ee',
  legendary: '#ff8000'
};

// Animation timings
const TIMINGS = {
  dimScene: 300,
  bannerAppear: 600,
  goldReveal: 400,
  xpReveal: 400,
  itemReveal: 400,
  pvpDetails: 1000,
  statsReveal: 1500,
  finaleHold: 800,
  fadeOut: 400,
  defeatTotal: 3000  // Total defeat sequence time
};

export class BattleOutroSequence {
  constructor(battleScene) {
    this.scene = battleScene;
    this.canvas = battleScene.game.canvas;

    // State
    this.phase = 'idle';
    this.timer = 0;
    this.status = null;  // 'victory' | 'defeat'
    this.rewards = null;

    // Options
    this.isPvP = false;
    this.opponentName = null;
    this.ratingChange = null;

    // Battle stats and PvP result
    this.unitStats = null;
    this.pvpResult = null;
    this.statsTable = null;
    this.ratingProgress = 0;  // For animated rating counter

    // Components
    this.fireworks = null;
    this.overlayAlpha = 0;

    // Animation state
    this.bannerProgress = 0;
    this.goldProgress = 0;
    this.xpProgress = 0;
    this.currentItemIndex = -1;
    this.itemProgress = [];
    this.fadeProgress = 0;

    // Stats table tracking
    this.statsTableShown = false;

    // Firework wave tracking
    this.fireworkWaves = {
      initial: false,
      midway: false,
      finale: false
    };

    // Callbacks
    this.onComplete = null;

    // Phase timeline (computed on start)
    this.timeline = {};

    // Continue button state (for victory confirmation)
    this.showContinueButton = false;
    this.continueButtonRect = null;
    this.continueButtonHover = false;
  }

  /**
   * Start the outro sequence
   * @param {string} status - 'victory' or 'defeat'
   * @param {Object} rewards - { gold, experience, items, levelUps, partyXP }
   * @param {Object} options - { isPvP, opponentName, ratingChange, unitStats, pvpResult, onComplete }
   */
  start(status, rewards, options = {}) {
    this.status = status;
    this.rewards = rewards || {};
    this.isPvP = options.isPvP || false;
    this.opponentName = options.opponentName || null;
    this.ratingChange = options.ratingChange || null;
    this.onComplete = options.onComplete;

    // Battle stats and PvP result
    this.unitStats = options.unitStats || null;
    this.pvpResult = options.pvpResult || null;

    // Initialize stats table if we have unit stats
    if (this.unitStats) {
      this.statsTable = new BattleStatsTable(this.scene);
    }

    // Initialize item progress array
    const itemCount = this.rewards.items?.length || 0;
    this.itemProgress = new Array(itemCount).fill(0);

    // Compute timeline
    this.computeTimeline();

    // Initialize fireworks for victory
    if (status === 'victory') {
      this.fireworks = new BattleFireworks(this.canvas);
    }

    this.phase = 'dim_scene';
    this.timer = 0;
  }

  /**
   * Compute animation timeline based on rewards
   */
  computeTimeline() {
    const t = TIMINGS;
    const itemCount = this.rewards.items?.length || 0;

    if (this.status === 'defeat') {
      // Defeat: fixed 3 second sequence
      this.timeline = {
        dimEnd: t.dimScene,
        bannerEnd: t.dimScene + t.bannerAppear,
        pvpStart: this.isPvP ? t.dimScene + t.bannerAppear : null,
        pvpEnd: this.isPvP ? t.dimScene + t.bannerAppear + t.pvpDetails : null,
        fadeStart: t.defeatTotal - t.fadeOut,
        fadeEnd: t.defeatTotal
      };
    } else {
      // Victory: variable based on rewards
      let currentTime = 0;

      currentTime += t.dimScene;
      this.timeline.dimEnd = currentTime;

      currentTime += t.bannerAppear;
      this.timeline.bannerEnd = currentTime;

      // Gold reveal
      this.timeline.goldStart = currentTime;
      currentTime += t.goldReveal;
      this.timeline.goldEnd = currentTime;

      // XP reveal
      this.timeline.xpStart = currentTime;
      currentTime += t.xpReveal;
      this.timeline.xpEnd = currentTime;

      // Items reveal
      this.timeline.itemsStart = currentTime;
      currentTime += itemCount * t.itemReveal;
      this.timeline.itemsEnd = currentTime;

      // PvP details (after items for victory)
      if (this.isPvP) {
        this.timeline.pvpStart = currentTime;
        currentTime += t.pvpDetails;
        this.timeline.pvpEnd = currentTime;
      }

      // Stats reveal phase (1500ms)
      if (this.unitStats) {
        this.timeline.statsStart = currentTime;
        currentTime += t.statsReveal;
        this.timeline.statsEnd = currentTime;
      }

      // Finale hold
      currentTime += t.finaleHold;
      this.timeline.finaleEnd = currentTime;

      // Fade out
      this.timeline.fadeStart = currentTime;
      currentTime += t.fadeOut;
      this.timeline.fadeEnd = currentTime;

      this.totalDuration = currentTime;
    }
  }

  /**
   * Update the sequence
   * @param {number} deltaTime - Delta time in milliseconds
   */
  update(deltaTime) {
    if (this.phase === 'idle' || this.phase === 'complete') return;

    this.timer += deltaTime;
    const t = this.timer;

    // Update fireworks
    if (this.fireworks) {
      this.fireworks.update(deltaTime / 1000);
    }

    // Update phase-specific animations
    if (this.status === 'defeat') {
      this.updateDefeatSequence(t);
    } else {
      this.updateVictorySequence(t);
    }
  }

  /**
   * Update defeat sequence
   */
  updateDefeatSequence(t) {
    const tl = this.timeline;

    if (t < tl.dimEnd) {
      // Dimming
      this.overlayAlpha = 0.7 * (t / tl.dimEnd);
      this.phase = 'dim_scene';
    } else if (t < tl.bannerEnd) {
      // Banner appearing
      this.overlayAlpha = 0.7;
      this.bannerProgress = (t - tl.dimEnd) / TIMINGS.bannerAppear;
      this.phase = 'banner_appear';
    } else if (this.isPvP && tl.pvpEnd && t < tl.pvpEnd) {
      // PvP details
      this.bannerProgress = 1;
      this.phase = 'pvp_details';
    } else if (this.phase !== 'awaiting_confirmation' && this.phase !== 'fade_out' && this.phase !== 'complete') {
      // After summary/PvP details, show continue button and wait for user confirmation
      this.bannerProgress = 1;
      this.showContinueButton = true;
      this.phase = 'awaiting_confirmation';
      // Stay in this phase until user clicks continue
    } else if (this.phase === 'fade_out') {
      // Fading out (triggered by proceedToFadeOut)
      const fadeElapsed = t - this.fadeStartTime;
      this.fadeProgress = Math.min(1, fadeElapsed / TIMINGS.fadeOut);
      this.overlayAlpha = 0.7 + 0.3 * this.fadeProgress;

      if (this.fadeProgress >= 1) {
        this.complete();
      }
    }
  }

  /**
   * Update victory sequence
   */
  updateVictorySequence(t) {
    const tl = this.timeline;

    if (t < tl.dimEnd) {
      // Dimming (lighter for victory)
      this.overlayAlpha = 0.5 * (t / tl.dimEnd);
      this.phase = 'dim_scene';
    } else if (t < tl.bannerEnd) {
      // Banner appearing
      this.overlayAlpha = 0.5;
      this.bannerProgress = (t - tl.dimEnd) / TIMINGS.bannerAppear;
      this.phase = 'banner_appear';

      // Launch initial fireworks
      if (!this.fireworkWaves.initial && this.bannerProgress > 0.3) {
        this.fireworkWaves.initial = true;
        this.fireworks.launchWave(3);
      }
    } else if (t < tl.goldEnd) {
      // Gold reveal
      this.bannerProgress = 1;
      this.goldProgress = (t - tl.goldStart) / TIMINGS.goldReveal;
      this.phase = 'rewards_reveal';

      // Also animate rating counter for PvP
      if (this.pvpResult) {
        this.ratingProgress = Math.min(1, (t - tl.goldStart) / (TIMINGS.goldReveal + TIMINGS.xpReveal));
      }
    } else if (t < tl.xpEnd) {
      // XP reveal
      this.goldProgress = 1;
      this.xpProgress = (t - tl.xpStart) / TIMINGS.xpReveal;

      // Continue rating animation
      if (this.pvpResult) {
        this.ratingProgress = Math.min(1, (t - tl.goldStart) / (TIMINGS.goldReveal + TIMINGS.xpReveal));
      }

      // Midway fireworks
      if (!this.fireworkWaves.midway) {
        this.fireworkWaves.midway = true;
        this.fireworks.launchWave(2);
      }
    } else if (t < tl.itemsEnd) {
      // Items reveal
      this.xpProgress = 1;
      const itemCount = this.rewards.items?.length || 0;

      if (itemCount > 0) {
        const itemsElapsed = t - tl.itemsStart;
        const currentItem = Math.floor(itemsElapsed / TIMINGS.itemReveal);
        const itemLocalProgress = (itemsElapsed % TIMINGS.itemReveal) / TIMINGS.itemReveal;

        for (let i = 0; i < itemCount; i++) {
          if (i < currentItem) {
            this.itemProgress[i] = 1;
          } else if (i === currentItem) {
            this.itemProgress[i] = itemLocalProgress;
            this.currentItemIndex = i;
          }
        }
      }
    } else if (this.isPvP && tl.pvpEnd && t < tl.pvpEnd) {
      // PvP details
      this.phase = 'pvp_details';
    } else if (this.unitStats && tl.statsEnd && t < tl.statsEnd) {
      // Stats reveal phase
      this.phase = 'stats_reveal';
      const statsProgress = (t - tl.statsStart) / TIMINGS.statsReveal;

      // Show stats table when entering phase
      if (statsProgress < 0.1 && !this.statsTableShown) {
        this.statsTableShown = true;
        const localUserId = this.scene.game.api?.userId || this.scene.game.localUserId;
        this.statsTable.show(this.unitStats, this.isPvP, this.status === 'victory', localUserId);
      }
    } else if (t < tl.finaleEnd) {
      // Finale - all items revealed
      for (let i = 0; i < this.itemProgress.length; i++) {
        this.itemProgress[i] = 1;
      }

      // Launch finale fireworks
      if (!this.fireworkWaves.finale) {
        this.fireworkWaves.finale = true;
        this.fireworks.launchWave(6);
      }
    } else if (this.phase !== 'fade_out' && this.phase !== 'complete') {
      // After finale, show continue button and wait for user confirmation
      for (let i = 0; i < this.itemProgress.length; i++) {
        this.itemProgress[i] = 1;
      }
      this.showContinueButton = true;
      this.phase = 'awaiting_confirmation';
      // Stay in this phase until user clicks continue
    } else if (this.phase === 'fade_out') {
      // Fading out (triggered by proceedToFadeOut)
      const fadeElapsed = t - this.fadeStartTime;
      this.fadeProgress = Math.min(1, fadeElapsed / TIMINGS.fadeOut);
      this.overlayAlpha = 0.5 + 0.5 * this.fadeProgress;

      if (this.fadeProgress >= 1) {
        this.complete();
      }
    }
  }

  /**
   * Render the sequence
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    if (this.phase === 'idle' || this.phase === 'complete') return;

    const w = this.canvas.width;
    const h = this.canvas.height;

    // Draw overlay
    this.renderOverlay(ctx, w, h);

    // Draw fireworks (behind text)
    if (this.fireworks) {
      this.fireworks.render(ctx);
    }

    // Draw banner
    this.renderBanner(ctx, w, h);

    // Draw rewards (victory only - during reveal and confirmation phases, but not for PvP)
    if (this.status === 'victory' && (this.phase === 'rewards_reveal' || this.phase === 'stats_reveal' || this.phase === 'awaiting_confirmation')) {
      this.renderRewards(ctx, w, h);
    }

    // Draw PvP panel (replaces rewards for PvP battles)
    if (this.isPvP && this.pvpResult && (this.phase === 'rewards_reveal' || this.phase === 'pvp_details' || this.phase === 'stats_reveal' || this.phase === 'awaiting_confirmation')) {
      this.renderPvPPanel(ctx, w, h);
    }

    // Draw summary (defeat only - during summary and confirmation phases)
    if (this.status === 'defeat' && (this.phase === 'summary' || this.phase === 'awaiting_confirmation')) {
      this.renderSummary(ctx, w, h);
    }

    // Draw PvP details (during pvp_details and confirmation phases) - legacy fallback
    if (this.isPvP && !this.pvpResult && (this.phase === 'pvp_details' || this.phase === 'awaiting_confirmation')) {
      this.renderPvPDetails(ctx, w, h);
    }

    // Draw continue button (victory/defeat confirmation)
    if (this.showContinueButton) {
      this.renderContinueButton(ctx, w, h);
    }
  }

  /**
   * Render the dimming overlay
   */
  renderOverlay(ctx, w, h) {
    ctx.save();

    if (this.status === 'victory') {
      // Sepia-tinted overlay for victory
      ctx.fillStyle = `rgba(20, 15, 5, ${this.overlayAlpha})`;
    } else {
      // Black overlay for defeat
      ctx.fillStyle = `rgba(0, 0, 0, ${this.overlayAlpha})`;
    }

    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  /**
   * Render the victory/defeat banner
   */
  renderBanner(ctx, w, h) {
    if (this.bannerProgress <= 0) return;

    const isVictory = this.status === 'victory';
    const text = isVictory ? 'VICTORY!' : 'DEFEAT!';
    const color = isVictory ? '#ffd700' : '#c45a5a';
    const glowColor = isVictory ? 'rgba(255, 215, 0, 0.6)' : 'rgba(196, 90, 90, 0.5)';

    // Calculate animation
    let scale, shake = 0;
    if (isVictory) {
      // Bounce effect for victory
      scale = this.easeOutBack(Math.min(1, this.bannerProgress));
    } else {
      // Elastic with shake for defeat
      scale = this.easeOutElastic(Math.min(1, this.bannerProgress));
      if (this.bannerProgress < 0.5) {
        shake = Math.sin(this.bannerProgress * 20) * 5 * (1 - this.bannerProgress * 2);
      }
    }

    const alpha = Math.min(1, this.bannerProgress * 2);
    const y = h * (isVictory ? 0.25 : 0.35);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(w / 2 + shake, y);
    ctx.scale(scale, scale);

    // Text shadow
    ctx.font = `bold ${isVictory ? 56 : 48}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';
    ctx.fillText(text, 3, 3);

    // Main text with glow
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = isVictory ? 40 : 30;
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);

    ctx.restore();
  }

  /**
   * Render rewards (gold, XP, items)
   */
  renderRewards(ctx, w, h) {
    // Don't show gold/XP rewards for PvP battles
    if (this.isPvP) {
      return;
    }

    // Gold counter
    if (this.goldProgress > 0) {
      this.renderGoldCounter(ctx, w, h);
    }

    // XP counter
    if (this.xpProgress > 0) {
      this.renderXPCounter(ctx, w, h);
    }

    // Items
    if (this.currentItemIndex >= 0 || this.itemProgress.some(p => p > 0)) {
      this.renderItems(ctx, w, h);
    }
  }

  /**
   * Render gold counter
   */
  renderGoldCounter(ctx, w, h) {
    const progress = this.easeOutCubic(Math.min(1, this.goldProgress));
    const displayValue = Math.floor(progress * (this.rewards.gold || 0));
    const alpha = Math.min(1, this.goldProgress * 2);

    const x = w / 2;
    const y = h * 0.45;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Gold coin icon (circle)
    ctx.fillStyle = '#ffd700';
    ctx.shadowColor = 'rgba(255, 215, 0, 0.5)';
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.arc(x - 70, y, 14, 0, Math.PI * 2);
    ctx.fill();

    // Inner detail
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#c9a227';
    ctx.beginPath();
    ctx.arc(x - 70, y, 8, 0, Math.PI * 2);
    ctx.fill();

    // Gold text
    ctx.font = 'bold 28px Georgia, serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffd700';
    ctx.shadowColor = 'rgba(255, 215, 0, 0.4)';
    ctx.shadowBlur = 10;
    ctx.fillText(`+${displayValue.toLocaleString()}`, x - 45, y);

    ctx.restore();
  }

  /**
   * Render XP counter
   */
  renderXPCounter(ctx, w, h) {
    const progress = this.easeOutCubic(Math.min(1, this.xpProgress));
    const displayValue = Math.floor(progress * (this.rewards.experience || 0));
    const alpha = Math.min(1, this.xpProgress * 2);

    const x = w / 2;
    const y = h * 0.52;

    ctx.save();
    ctx.globalAlpha = alpha;

    // XP text
    ctx.font = 'bold 24px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#4a7548';
    ctx.shadowColor = 'rgba(74, 117, 72, 0.4)';
    ctx.shadowBlur = 8;
    ctx.fillText(`+${displayValue.toLocaleString()} Experience`, x, y);

    ctx.restore();
  }

  /**
   * Render item reveals
   */
  renderItems(ctx, w, h) {
    const items = this.rewards.items || [];
    if (items.length === 0) return;

    const itemWidth = 80;
    const itemGap = 16;
    const totalWidth = items.length * itemWidth + (items.length - 1) * itemGap;
    const startX = (w - totalWidth) / 2;
    const y = h * 0.62;

    items.forEach((item, index) => {
      const progress = this.itemProgress[index] || 0;
      if (progress <= 0) return;

      this.renderItem(ctx, item, startX + index * (itemWidth + itemGap), y, progress);
    });
  }

  /**
   * Render a single item
   */
  renderItem(ctx, item, x, y, progress) {
    const scale = 0.8 + 0.2 * this.easeOutBack(progress);
    const alpha = Math.min(1, progress * 1.5);
    const rarityColor = RARITY_COLORS[item.rarity] || RARITY_COLORS.common;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x + 40, y + 40);
    ctx.scale(scale, scale);
    ctx.translate(-40, -40);

    // Background (parchment-styled)
    ctx.fillStyle = 'rgba(191, 174, 138, 0.95)';
    ctx.strokeStyle = rarityColor;
    ctx.lineWidth = 2;

    // Rounded rect background
    this.roundRect(ctx, 0, 0, 80, 80, 6);
    ctx.fill();

    // Rarity glow
    if (item.rarity !== 'common') {
      ctx.shadowColor = rarityColor;
      ctx.shadowBlur = item.rarity === 'legendary' ? 20 : 12;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Item icon placeholder (first letter)
    ctx.font = 'bold 24px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#5a4a3a';
    ctx.fillText(item.name.charAt(0).toUpperCase(), 40, 32);

    // Item name (truncated)
    ctx.font = '11px Georgia, serif';
    ctx.fillStyle = rarityColor;
    const displayName = item.name.length > 12 ? item.name.substring(0, 11) + '...' : item.name;
    ctx.fillText(displayName, 40, 55);

    // Item type
    ctx.font = '9px Georgia, serif';
    ctx.fillStyle = '#6a5a4a';
    ctx.fillText(item.itemType || 'Item', 40, 68);

    ctx.restore();
  }

  /**
   * Render defeat summary message
   */
  renderSummary(ctx, w, h) {
    const y = h * 0.5;

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.font = '18px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#bfae8a';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 4;
    ctx.fillText('Your party has fallen...', w / 2, y);
    ctx.restore();
  }

  /**
   * Render PvP details (opponent name, rating change) - legacy fallback
   */
  renderPvPDetails(ctx, w, h) {
    const y = this.status === 'victory' ? h * 0.75 : h * 0.55;

    ctx.save();
    ctx.font = '16px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#bfae8a';

    // Opponent name
    if (this.opponentName) {
      const matchText = this.status === 'victory'
        ? `Defeated ${this.opponentName}`
        : `Lost to ${this.opponentName}`;
      ctx.fillText(matchText, w / 2, y);
    }

    // Rating change
    if (this.ratingChange !== null) {
      const ratingText = this.ratingChange >= 0
        ? `+${this.ratingChange} Rating`
        : `${this.ratingChange} Rating`;
      ctx.fillStyle = this.ratingChange >= 0 ? '#4a7548' : '#c45a5a';
      ctx.font = 'bold 20px Georgia, serif';
      ctx.fillText(ratingText, w / 2, y + 28);
    }

    ctx.restore();
  }

  /**
   * Render comprehensive PvP panel with tier, rating, and progress
   */
  renderPvPPanel(ctx, w, h) {
    if (!this.pvpResult) return;

    const pvp = this.pvpResult;
    const centerX = w / 2;
    const panelY = h * 0.35;
    const panelWidth = 340;
    const panelHeight = 200;

    // Panel background
    ctx.save();
    ctx.fillStyle = 'rgba(30, 25, 20, 0.9)';
    this.roundRect(ctx, centerX - panelWidth / 2, panelY, panelWidth, panelHeight, 12);
    ctx.fill();

    // Border with tier color
    ctx.strokeStyle = getTierColor(pvp.newRating);
    ctx.lineWidth = 3;
    ctx.stroke();

    // Tier badge (emoji + name)
    const tier = getTier(pvp.newRating);
    ctx.font = 'bold 20px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = tier.color;
    const tierIcon = getTierIcon(tier.icon);
    ctx.fillText(`${tierIcon} ${tier.name}`, centerX, panelY + 35);

    // Animated rating counter
    const displayRating = Math.floor(pvp.oldRating + (pvp.newRating - pvp.oldRating) * this.ratingProgress);
    ctx.font = 'bold 42px Georgia, serif';
    ctx.fillStyle = '#e8d4b8';
    ctx.fillText(displayRating.toLocaleString(), centerX, panelY + 80);

    // Rating change indicator
    const changeColor = pvp.ratingChange >= 0 ? '#4a7548' : '#c45a5a';
    const changePrefix = pvp.ratingChange >= 0 ? '+' : '';
    ctx.font = 'bold 20px Georgia, serif';
    ctx.fillStyle = changeColor;
    ctx.fillText(`(${changePrefix}${pvp.ratingChange})`, centerX, panelY + 105);

    // Tier change notification (if applicable)
    if (pvp.tierChanged) {
      ctx.font = 'bold 18px Georgia, serif';
      ctx.fillStyle = '#ffd700';
      ctx.shadowColor = 'rgba(255, 215, 0, 0.6)';
      ctx.shadowBlur = 10;
      const direction = pvp.newRating > pvp.oldRating ? 'PROMOTED!' : 'DEMOTED!';
      ctx.fillText(direction, centerX, panelY + 130);
      ctx.shadowBlur = 0;
    }

    // Rank change (if available)
    if (pvp.oldRank && pvp.newRank) {
      ctx.font = '16px Georgia, serif';
      ctx.fillStyle = '#bfae8a';
      const rankArrow = pvp.newRank < pvp.oldRank ? '\u2191' : (pvp.newRank > pvp.oldRank ? '\u2193' : '\u2192');
      const rankColor = pvp.newRank < pvp.oldRank ? '#4a7548' : (pvp.newRank > pvp.oldRank ? '#c45a5a' : '#bfae8a');
      ctx.fillStyle = rankColor;
      ctx.fillText(`Rank #${pvp.oldRank} ${rankArrow} #${pvp.newRank}`, centerX, panelY + 155);
    }

    // Progress to next tier (if not at max)
    if (pvp.pointsToNextTier && !pvp.tierChanged) {
      this.renderTierProgressBar(ctx, centerX, panelY + 175, pvp);
    }

    // Surrender penalty indicator (defeat only)
    if (pvp.surrenderPenalty && this.status === 'defeat') {
      ctx.font = '14px Georgia, serif';
      ctx.fillStyle = '#8a5a5a';
      ctx.fillText('\u26A0 Surrender Penalty Applied', centerX, panelY + 195);
    }

    ctx.restore();
  }

  /**
   * Render progress bar showing distance to next tier
   */
  renderTierProgressBar(ctx, centerX, y, pvp) {
    const barWidth = 200;
    const barHeight = 8;
    const x = centerX - barWidth / 2;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    this.roundRect(ctx, x, y, barWidth, barHeight, 4);
    ctx.fill();

    // Calculate progress within current tier
    const nextTierInfo = getNextTierProgress(pvp.newRating);
    if (nextTierInfo) {
      const currentTier = getTier(pvp.newRating);
      const ratingInTier = pvp.newRating - currentTier.minRating;
      const tierRange = nextTierInfo.nextTier.minRating - currentTier.minRating;
      const progress = Math.min(1, ratingInTier / tierRange);

      // Fill
      if (progress > 0) {
        ctx.fillStyle = currentTier.color;
        this.roundRect(ctx, x, y, barWidth * progress, barHeight, 4);
        ctx.fill();
      }

      // Points needed text
      ctx.font = '11px Georgia, serif';
      ctx.fillStyle = '#bfae8a';
      ctx.textAlign = 'center';
      ctx.fillText(`${pvp.pointsToNextTier} pts to ${nextTierInfo.nextTier.name}`, centerX, y + 20);
    }
  }

  /**
   * Render the continue button at the bottom of the screen
   */
  renderContinueButton(ctx, w, h) {
    const buttonWidth = 180;
    const buttonHeight = 48;
    const buttonX = (w - buttonWidth) / 2;
    const buttonY = h - 100;

    // Store button rect for click detection
    this.continueButtonRect = { x: buttonX, y: buttonY, width: buttonWidth, height: buttonHeight };

    ctx.save();

    // Button background (parchment-styled)
    const isHovered = this.continueButtonHover;
    ctx.fillStyle = isHovered ? 'rgba(211, 194, 158, 0.98)' : 'rgba(191, 174, 138, 0.95)';
    ctx.strokeStyle = isHovered ? '#9a7b4f' : '#7a6a4f';
    ctx.lineWidth = 2;

    // Draw rounded rect button
    this.roundRect(ctx, buttonX, buttonY, buttonWidth, buttonHeight, 8);
    ctx.fill();

    // Button border with subtle glow
    if (isHovered) {
      ctx.shadowColor = 'rgba(255, 215, 0, 0.4)';
      ctx.shadowBlur = 10;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Button text
    ctx.font = 'bold 20px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isHovered ? '#4a3a2a' : '#5a4a3a';
    ctx.fillText('Continue', w / 2, buttonY + buttonHeight / 2);

    ctx.restore();
  }

  /**
   * Handle click event - check if continue button was clicked
   * @param {number} x - Canvas X coordinate
   * @param {number} y - Canvas Y coordinate
   * @returns {boolean} True if click was handled
   */
  handleClick(x, y) {
    if (!this.showContinueButton || this.phase !== 'awaiting_confirmation') {
      return false;
    }

    if (this.continueButtonRect && this.isPointInRect(x, y, this.continueButtonRect)) {
      this.proceedToFadeOut();
      return true;
    }

    return false;
  }

  /**
   * Handle mouse move for button hover state
   * @param {number} x - Canvas X coordinate
   * @param {number} y - Canvas Y coordinate
   */
  handleMouseMove(x, y) {
    if (!this.showContinueButton || !this.continueButtonRect) {
      this.continueButtonHover = false;
      return;
    }
    this.continueButtonHover = this.isPointInRect(x, y, this.continueButtonRect);
  }

  /**
   * Check if point is inside a rectangle
   */
  isPointInRect(x, y, rect) {
    return x >= rect.x && x <= rect.x + rect.width &&
           y >= rect.y && y <= rect.y + rect.height;
  }

  /**
   * Proceed to fade out phase after user confirmation
   */
  proceedToFadeOut() {
    this.showContinueButton = false;
    this.continueButtonRect = null;
    this.fadeStartTime = this.timer;
    this.phase = 'fade_out';
  }

  /**
   * Complete the sequence and trigger callback
   */
  complete() {
    this.phase = 'complete';

    // Cleanup
    if (this.fireworks) {
      this.fireworks.clear();
    }

    // Cleanup stats table
    if (this.statsTable) {
      this.statsTable.destroy();
      this.statsTable = null;
    }

    // Execute callback
    if (this.onComplete) {
      this.onComplete();
    }
  }

  /**
   * Check if sequence is complete
   */
  isComplete() {
    return this.phase === 'complete';
  }

  // ========== Utility Functions ==========

  /**
   * Draw a rounded rectangle
   */
  roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /**
   * Easing: ease out cubic
   */
  easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  /**
   * Easing: ease out back (slight overshoot)
   */
  easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  /**
   * Easing: ease out elastic
   */
  easeOutElastic(t) {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 :
      Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  }
}
