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
import { BattleRatingPanel } from './BattleRatingPanel.js';
import { getTier, getTierColor, getTierIcon } from '../../../shared/coliseum.js';
import { responsive } from '../core/Responsive.js';
import { getBattleItemCompositeSrc, getBattleItemIconSrc } from './BattleItemIcon.js';

// Rarity color palette (matches RewardsModal)
const RARITY_COLORS = {
  common: '#cccccc',
  uncommon: '#1eff00',
  rare: '#0070dd',
  epic: '#a335ee',
  legendary: '#ff8000'
};

const REWARD_PANEL_COLORS = {
  background: 'rgba(27, 22, 16, 0.94)',
  border: 'rgba(202, 174, 112, 0.72)',
  card: 'rgba(54, 45, 33, 0.96)',
  cardInset: 'rgba(15, 12, 9, 0.38)',
  heading: '#f4e6c9',
  label: '#cbbd9f',
  muted: '#a99b82'
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

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
    this.ratingPanel = null;  // DOM-based rating panel
    this.ratingPanelShown = false;
    this.ratingProgress = 0;  // For animated rating counter (legacy)

    // Components
    this.fireworks = null;
    this.overlayAlpha = 0;

    // Animation state
    this.bannerProgress = 0;
    this.goldProgress = 0;
    this.xpProgress = 0;
    this.currentItemIndex = -1;
    this.itemProgress = [];
    this.itemIconCache = new Map();
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

    // Initialize DOM-based rating panel for PvP battles
    if (this.isPvP && this.pvpResult) {
      this.ratingPanel = new BattleRatingPanel(this.scene);
    }

    // Initialize item progress array
    const itemCount = this.rewards.items?.length || 0;
    this.itemProgress = new Array(itemCount).fill(0);
    this.preloadItemIcons(this.rewards.items || []);

    // Compute timeline
    this.computeTimeline();

    // Initialize fireworks for victory
    if (status === 'victory') {
      this.fireworks = new BattleFireworks(this.canvas, this.scene.game.targetWidth, this.scene.game.targetHeight);
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
      // Defeat: variable timeline based on content
      let currentTime = 0;

      currentTime += t.dimScene;
      this.timeline.dimEnd = currentTime;

      currentTime += t.bannerAppear;
      this.timeline.bannerEnd = currentTime;

      // PvP details phase
      if (this.isPvP) {
        this.timeline.pvpStart = currentTime;
        currentTime += t.pvpDetails;
        this.timeline.pvpEnd = currentTime;
      }

      // Stats reveal phase (show stats table on defeat too)
      if (this.unitStats) {
        this.timeline.statsStart = currentTime;
        currentTime += t.statsReveal;
        this.timeline.statsEnd = currentTime;
      }

      // Finale hold before fade
      currentTime += t.finaleHold || 400;
      this.timeline.fadeStart = currentTime;
      currentTime += t.fadeOut;
      this.timeline.fadeEnd = currentTime;
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

      // Show DOM-based rating panel when entering phase
      if (!this.ratingPanelShown && this.ratingPanel) {
        this.ratingPanelShown = true;
        this.ratingPanel.show(this.pvpResult);
      }
    } else if (this.unitStats && tl.statsEnd && t < tl.statsEnd) {
      // Stats reveal phase
      this.bannerProgress = 1;
      this.phase = 'stats_reveal';
      const statsProgress = (t - tl.statsStart) / TIMINGS.statsReveal;

      // Show stats table when entering phase
      if (statsProgress < 0.1 && !this.statsTableShown) {
        this.statsTableShown = true;
        const localUserId = this.scene.game.api?.userId || this.scene.game.localUserId;
        const localUsername = this.scene.game.state?.get('user')?.username || '';
        this.statsTable.show(this.unitStats, this.isPvP, false, localUserId, localUsername);
      }
    } else if (this.phase !== 'awaiting_confirmation' && this.phase !== 'fade_out' && this.phase !== 'complete') {
      // After summary/PvP details/stats, show continue button and wait for user confirmation
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

      // Show DOM-based rating panel when entering phase
      if (!this.ratingPanelShown && this.ratingPanel) {
        this.ratingPanelShown = true;
        this.ratingPanel.show(this.pvpResult);
      }
    } else if (this.unitStats && tl.statsEnd && t < tl.statsEnd) {
      // Stats reveal phase
      this.phase = 'stats_reveal';
      const statsProgress = (t - tl.statsStart) / TIMINGS.statsReveal;

      // Show stats table when entering phase
      if (statsProgress < 0.1 && !this.statsTableShown) {
        this.statsTableShown = true;
        const localUserId = this.scene.game.api?.userId || this.scene.game.localUserId;
        const localUsername = this.scene.game.state?.get('user')?.username || '';
        this.statsTable.show(this.unitStats, this.isPvP, this.status === 'victory', localUserId, localUsername);
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

    const w = this.scene.game.targetWidth;
    const h = this.scene.game.targetHeight;

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

    // PvP rating panel is now DOM-based (BattleRatingPanel.js)
    // Shown via this.ratingPanel.show() during pvp_details phase

    // Draw summary (PvE defeat only - PvP uses renderPvPPanel instead)
    if (this.status === 'defeat' && !this.isPvP && (this.phase === 'summary' || this.phase === 'awaiting_confirmation')) {
      this.renderSummary(ctx, w, h);
    }

    // Draw PvP details (during pvp_details and confirmation phases) - legacy fallback
    if (this.isPvP && !this.pvpResult && (this.phase === 'pvp_details' || this.phase === 'awaiting_confirmation')) {
      this.renderPvPDetails(ctx, w, h);
    }

    // Draw continue button (victory/defeat confirmation)
    if (this.showContinueButton) {
      this.renderContinueButton(ctx, w, h);
      // Draw surrender penalty message (if applicable)
      this.renderSurrenderPenaltyMessage(ctx, w, h);
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
    const y = h * (isVictory ? 0.08 : 0.10);

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
   * Whether the outro was given any reward figures to show.
   * @returns {boolean}
   */
  hasRewardData() {
    const r = this.rewards || {};
    return r.gold !== undefined || r.experience !== undefined ||
      (Array.isArray(r.items) && r.items.length > 0);
  }

  /**
   * Render rewards (gold, XP, items)
   */
  renderRewards(ctx, w, h) {
    // Don't show gold/XP rewards for PvP battles
    if (this.isPvP) {
      return;
    }

    const itemCount = this.rewards.items?.length || 0;
    const layout = this.getRewardLayout(w, h, itemCount);
    this.renderRewardPanel(ctx, layout, itemCount);

    // Gold counter
    if (this.goldProgress > 0) {
      this.renderGoldCounter(ctx, w, h, layout);
    }

    // XP counter
    if (this.xpProgress > 0) {
      this.renderXPCounter(ctx, w, h, layout);
    }

    // Items
    if (this.currentItemIndex >= 0 || this.itemProgress.some(p => p > 0)) {
      this.renderItems(ctx, w, h, layout);
    }
  }

  /**
   * Build a bounded layout in logical canvas coordinates. On narrow touch
   * screens the game canvas is scaled down, so the CTA is enlarged enough to
   * remain a useful physical target and loot switches to two columns.
   */
  getRewardLayout(w, h, itemCount = 0, options = {}) {
    const totalItems = Math.max(0, Math.floor(Number(itemCount) || 0));
    const viewport = responsive.getViewport();
    const compact = options.compact ?? (responsive.isMobile() || w < 640 || h < 520);
    const viewportWidth = options.viewportWidth || viewport.width || w;
    const viewportHeight = options.viewportHeight || viewport.height || h;
    const viewportScale = Math.min(viewportWidth / w, viewportHeight / h);
    const liveCanvasScale = Number(options.canvasScale ?? this.scene.game.scale);
    const estimatedScale = clamp(
      Number.isFinite(liveCanvasScale) && liveCanvasScale > 0
        ? Math.min(viewportScale, liveCanvasScale)
        : viewportScale,
      0.35,
      1
    );

    const outerMargin = compact ? 18 : 28;
    const panelWidth = Math.min(compact ? 568 : 600, w - outerMargin * 2);
    const panelX = (w - panelWidth) / 2;
    const buttonHeight = compact ? clamp(44 / estimatedScale, 56, 126) : 48;
    const buttonWidth = compact
      ? clamp(180 / estimatedScale, 280, panelWidth - 36)
      : 220;
    const button = {
      x: (w - buttonWidth) / 2,
      y: h - buttonHeight - (compact ? 16 : 24),
      width: buttonWidth,
      height: buttonHeight
    };

    const bannerY = clamp(h * 0.1, 46, 62);
    const availableTop = bannerY + (compact ? 44 : 50);
    const availableBottom = button.y - (compact ? 12 : 16);
    const maxPanelHeight = Math.max(150, availableBottom - availableTop);
    const contentPadding = compact ? 16 : 18;
    const contentWidth = panelWidth - contentPadding * 2;
    const rowGap = compact ? 8 : 10;

    // Two generous columns keep procedural names readable while still using
    // less vertical space than the previous tall three/four-column cards.
    const columns = totalItems > 0 ? Math.min(2, totalItems) : 0;

    const baseHeight = 14 + 24 + 10 + (compact ? 58 : 54) + 16;
    const lootChromeHeight = totalItems > 0 ? 14 + 18 + 10 : 0;
    const minimumCardHeight = compact ? 50 : 48;
    const desiredCardHeight = compact ? 60 : 56;
    const possibleRows = columns > 0
      ? Math.max(1, Math.min(4, Math.floor(
        (maxPanelHeight - baseHeight - lootChromeHeight + rowGap) /
        (minimumCardHeight + rowGap)
      )))
      : 0;
    const maxSlots = columns * possibleRows;
    const hasOverflow = totalItems > maxSlots;
    const visibleItemCount = hasOverflow ? Math.max(0, maxSlots - 1) : totalItems;
    const slotCount = visibleItemCount + (hasOverflow ? 1 : 0);
    const rows = columns > 0 ? Math.ceil(slotCount / columns) : 0;
    const availableCardHeight = rows > 0
      ? (maxPanelHeight - baseHeight - lootChromeHeight - rowGap * (rows - 1)) / rows
      : 0;
    const cardHeight = rows > 0
      ? Math.min(desiredCardHeight, Math.max(minimumCardHeight, availableCardHeight))
      : 0;
    const panelHeight = Math.min(
      maxPanelHeight,
      baseHeight + lootChromeHeight + rows * cardHeight + Math.max(0, rows - 1) * rowGap
    );
    const panelY = availableTop + Math.max(0, (maxPanelHeight - panelHeight) * 0.44);
    const statY = panelY + 14 + 24 + 10;
    const statHeight = compact ? 58 : 54;
    const statGap = compact ? 8 : 10;
    const statWidth = (contentWidth - statGap) / 2;
    const lootHeadingY = statY + statHeight + 16;
    const gridY = lootHeadingY + 28;

    const cardGap = compact ? 8 : 10;
    const rawCardWidth = columns > 0
      ? (contentWidth - cardGap * (columns - 1)) / columns
      : 0;
    const twoColumnWidth = (contentWidth - cardGap) / 2;
    const cardWidth = columns === 1 ? twoColumnWidth : rawCardWidth;
    const cards = [];

    for (let index = 0; index < slotCount; index++) {
      const row = Math.floor(index / columns);
      const firstIndexInRow = row * columns;
      const countInRow = Math.min(columns, slotCount - firstIndexInRow);
      const rowWidth = countInRow * cardWidth + (countInRow - 1) * cardGap;
      const rowX = panelX + (panelWidth - rowWidth) / 2;
      const column = index - firstIndexInRow;
      cards.push({
        x: rowX + column * (cardWidth + cardGap),
        y: gridY + row * (cardHeight + rowGap),
        width: cardWidth,
        height: cardHeight,
        overflow: hasOverflow && index === slotCount - 1
      });
    }

    return {
      compact,
      panel: { x: panelX, y: panelY, width: panelWidth, height: panelHeight },
      headerY: panelY + 25,
      stats: [
        { x: panelX + contentPadding, y: statY, width: statWidth, height: statHeight },
        { x: panelX + contentPadding + statWidth + statGap, y: statY, width: statWidth, height: statHeight }
      ],
      lootHeadingY,
      cards,
      visibleItemCount,
      overflowCount: Math.max(0, totalItems - visibleItemCount),
      button
    };
  }

  renderRewardPanel(ctx, layout, itemCount) {
    const { panel } = layout;
    // A battle that ended through a state poll (not the battle:end event)
    // carries no reward breakdown; say where the rewards went instead of
    // drawing an empty, half-transparent panel.
    const hasRewardData = this.hasRewardData();
    const stats = hasRewardData ? layout.stats : [];
    const revealProgress = hasRewardData
      ? Math.max(this.goldProgress, this.xpProgress, ...this.itemProgress, 0)
      : 1;

    ctx.save();
    ctx.globalAlpha = clamp(0.25 + revealProgress * 1.5, 0, 1);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
    ctx.shadowBlur = 22;
    ctx.fillStyle = REWARD_PANEL_COLORS.background;
    this.roundRect(ctx, panel.x, panel.y, panel.width, panel.height, 12);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = REWARD_PANEL_COLORS.border;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = `bold ${layout.compact ? 17 : 15}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = REWARD_PANEL_COLORS.heading;
    ctx.fillText('REWARDS EARNED', panel.x + panel.width / 2, layout.headerY);

    if (!hasRewardData) {
      ctx.font = `${layout.compact ? 15 : 14}px Georgia, serif`;
      ctx.fillStyle = REWARD_PANEL_COLORS.heading;
      ctx.fillText('Your rewards have been added to your party.',
        panel.x + panel.width / 2, layout.stats[0].y + layout.stats[0].height / 2);
    }

    for (const stat of stats) {
      ctx.fillStyle = REWARD_PANEL_COLORS.cardInset;
      ctx.strokeStyle = 'rgba(202, 174, 112, 0.24)';
      ctx.lineWidth = 1;
      this.roundRect(ctx, stat.x, stat.y, stat.width, stat.height, 8);
      ctx.fill();
      ctx.stroke();
    }

    if (itemCount > 0) {
      ctx.font = `bold ${layout.compact ? 15 : 12}px Georgia, serif`;
      ctx.textAlign = 'left';
      ctx.fillStyle = REWARD_PANEL_COLORS.label;
      ctx.fillText(
        `LOOT FOUND  ·  ${itemCount} ${itemCount === 1 ? 'ITEM' : 'ITEMS'}`,
        panel.x + (layout.compact ? 16 : 18),
        layout.lootHeadingY
      );
    }
    ctx.restore();
  }

  /**
   * Render gold counter
   */
  renderGoldCounter(ctx, w, h, layout = this.getRewardLayout(w, h, this.rewards.items?.length || 0)) {
    const progress = this.easeOutCubic(Math.min(1, this.goldProgress));
    const displayValue = Math.floor(progress * (this.rewards.gold || 0));
    const alpha = Math.min(1, this.goldProgress * 2);

    const stat = layout.stats[0];
    const iconX = stat.x + (layout.compact ? 30 : 28);
    const y = stat.y + stat.height / 2;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Gold coin icon (circle)
    ctx.fillStyle = '#ffd700';
    ctx.shadowColor = 'rgba(255, 215, 0, 0.5)';
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.arc(iconX, y, layout.compact ? 14 : 12, 0, Math.PI * 2);
    ctx.fill();

    // Inner detail
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#c9a227';
    ctx.beginPath();
    ctx.arc(iconX, y, layout.compact ? 8 : 7, 0, Math.PI * 2);
    ctx.fill();

    // Gold text
    ctx.font = `bold ${layout.compact ? 24 : 20}px Georgia, serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f6d66f';
    ctx.shadowColor = 'rgba(255, 215, 0, 0.4)';
    ctx.shadowBlur = 10;
    ctx.fillText(`+${displayValue.toLocaleString()}`, iconX + (layout.compact ? 24 : 21), y + 7);

    ctx.shadowBlur = 0;
    ctx.font = `bold ${layout.compact ? 13 : 11}px Georgia, serif`;
    ctx.fillStyle = REWARD_PANEL_COLORS.label;
    ctx.fillText('GOLD', iconX + (layout.compact ? 24 : 21), y - 12);

    ctx.restore();
  }

  /**
   * Render XP counter
   */
  renderXPCounter(ctx, w, h, layout = this.getRewardLayout(w, h, this.rewards.items?.length || 0)) {
    const progress = this.easeOutCubic(Math.min(1, this.xpProgress));
    const displayValue = Math.floor(progress * (this.rewards.experience || 0));
    const alpha = Math.min(1, this.xpProgress * 2);

    const stat = layout.stats[1];
    const iconX = stat.x + (layout.compact ? 30 : 28);
    const y = stat.y + stat.height / 2;

    ctx.save();
    ctx.globalAlpha = alpha;

    // XP spark
    ctx.fillStyle = '#9edb8d';
    ctx.shadowColor = 'rgba(158, 219, 141, 0.45)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(iconX, y - 14);
    ctx.lineTo(iconX + 6, y);
    ctx.lineTo(iconX, y + 14);
    ctx.lineTo(iconX - 6, y);
    ctx.closePath();
    ctx.fill();

    // XP text
    ctx.font = `bold ${layout.compact ? 24 : 20}px Georgia, serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#b9e7aa';
    ctx.shadowColor = 'rgba(158, 219, 141, 0.35)';
    ctx.shadowBlur = 8;
    ctx.fillText(`+${displayValue.toLocaleString()}`, iconX + (layout.compact ? 24 : 21), y + 7);

    ctx.shadowBlur = 0;
    ctx.font = `bold ${layout.compact ? 13 : 11}px Georgia, serif`;
    ctx.fillStyle = REWARD_PANEL_COLORS.label;
    ctx.fillText('EXPERIENCE', iconX + (layout.compact ? 24 : 21), y - 12);

    ctx.restore();
  }

  /**
   * Render item reveals
   */
  renderItems(ctx, w, h, layout = this.getRewardLayout(w, h, this.rewards.items?.length || 0)) {
    const items = this.rewards.items || [];
    if (items.length === 0) return;

    layout.cards.forEach((card, index) => {
      if (card.overflow) {
        const overflowProgress = Math.max(...this.itemProgress.slice(layout.visibleItemCount), 0);
        if (overflowProgress > 0) {
          this.renderOverflowItem(ctx, card, layout.overflowCount, overflowProgress, layout.compact);
        }
        return;
      }

      const item = items[index];
      const progress = this.itemProgress[index] || 0;
      if (!item || progress <= 0) return;

      this.renderItem(ctx, item, card.x, card.y, progress, card, layout.compact);
    });
  }

  /**
   * Preload the canonical item sprites before their staggered reveal begins.
   * The sequence has more than a second of banner/counter animation before
   * loot is drawn, so ordinary browser image loads complete off-screen.
   */
  preloadItemIcons(items = []) {
    this.clearItemIconCache();

    const ImageConstructor = globalThis.Image;
    if (typeof ImageConstructor !== 'function') return;

    items.forEach(item => {
      const src = getBattleItemIconSrc(item, { size: 'md' });
      if (!src || this.itemIconCache.has(src)) return;

      const image = new ImageConstructor();
      const entry = { image, loaded: false, failed: false };

      image.onload = () => {
        entry.loaded = true;
      };
      image.onerror = () => {
        entry.failed = true;
      };

      this.itemIconCache.set(src, entry);

      const setImageSource = (imageSrc) => {
        // A restarted/destroyed sequence may have cleared this entry while an
        // optional overlay composite was being prepared.
        if (this.itemIconCache.get(src) !== entry) return;
        image.src = imageSrc || src;

        // Cached images can already be complete before onload runs.
        if (image.complete && image.naturalWidth > 0) {
          entry.loaded = true;
        }
      };

      if (item.augments?.length > 0) {
        getBattleItemCompositeSrc(item, { size: 'md' })
          .then(setImageSource)
          .catch(() => setImageSource(src));
      } else {
        setImageSource(src);
      }
    });
  }

  /**
   * Release image callbacks and cached references.
   */
  clearItemIconCache() {
    this.itemIconCache.forEach(({ image }) => {
      image.onload = null;
      image.onerror = null;
    });
    this.itemIconCache.clear();
  }

  /**
   * Render a single item
   */
  renderItem(ctx, item, x, y, progress, dimensions = {}, compact = false) {
    const width = dimensions.width || 80;
    const height = dimensions.height || 80;
    const horizontal = width >= 120;
    const scale = 0.8 + 0.2 * this.easeOutBack(progress);
    const alpha = Math.min(1, progress * 1.5);
    const rarityColor = RARITY_COLORS[item.rarity] || RARITY_COLORS.common;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x + width / 2, y + height / 2);
    ctx.scale(scale, scale);
    ctx.translate(-width / 2, -height / 2);

    // Canvas state is shared by every battle renderer. Always establish text
    // alignment here; loaded icons must not inherit the gold counter's left
    // alignment (the cause of labels spilling out of the old cards).
    ctx.textAlign = horizontal ? 'left' : 'center';
    ctx.textBaseline = 'middle';

    // Dark inset keeps common-rarity labels readable over every battlefield.
    ctx.fillStyle = REWARD_PANEL_COLORS.card;
    ctx.strokeStyle = rarityColor;
    ctx.lineWidth = item.rarity === 'common' ? 1.25 : 2;

    // Rounded rect background
    this.roundRect(ctx, 0, 0, width, height, 8);
    ctx.fill();

    // Rarity glow
    if (item.rarity !== 'common') {
      ctx.shadowColor = rarityColor;
      ctx.shadowBlur = item.rarity === 'legendary' ? 20 : 12;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Rarity accent communicates quality without lowering text contrast.
    ctx.fillStyle = rarityColor;
    this.roundRect(ctx, 0, 0, 4, height, 2);
    ctx.fill();

    const iconWellSize = horizontal ? Math.min(compact ? 34 : 32, height - 14) : 42;
    const iconWellX = horizontal ? 10 : (width - iconWellSize) / 2;
    const iconWellY = horizontal ? (height - iconWellSize) / 2 : 5;
    ctx.fillStyle = REWARD_PANEL_COLORS.cardInset;
    this.roundRect(ctx, iconWellX, iconWellY, iconWellSize, iconWellSize, 7);
    ctx.fill();

    // Canonical item sprite (same source resolver used by ItemIcon).
    const iconSrc = getBattleItemIconSrc(item, { size: 'md' });
    const iconEntry = iconSrc ? this.itemIconCache.get(iconSrc) : null;
    const iconLoaded = iconEntry && (
      iconEntry.loaded || (iconEntry.image.complete && iconEntry.image.naturalWidth > 0)
    );

    if (iconLoaded) {
      ctx.imageSmoothingEnabled = true;
      const iconSize = Math.min(horizontal ? 24 : 32, iconWellSize - 8);
      ctx.drawImage(
        iconEntry.image,
        iconWellX + (iconWellSize - iconSize) / 2,
        iconWellY + (iconWellSize - iconSize) / 2,
        iconSize,
        iconSize
      );
    } else if (!iconEntry || iconEntry.failed) {
      // Match ItemIcon's explicit missing-asset fallback; never invent a
      // misleading letter/emoji from the display name.
      ctx.font = 'bold 20px Georgia, serif';
      const previousAlignment = ctx.textAlign;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#cc3333';
      ctx.fillText('✗', iconWellX + iconWellSize / 2, iconWellY + iconWellSize / 2);
      ctx.textAlign = previousAlignment;
    }

    const itemName = String(item.name || item.templateName || 'Unknown item');
    const itemType = this.formatItemType(item.itemType || 'item');
    const rarity = this.formatItemType(item.rarity || 'common');

    if (horizontal) {
      const textX = iconWellX + iconWellSize + (compact ? 10 : 9);
      const textWidth = Math.max(24, width - textX - 10);
      let nameFontSize = compact ? 16 : 13;
      let nameLines = [];
      const minimumNameFontSize = 10;
      for (let candidateSize = nameFontSize; candidateSize >= minimumNameFontSize; candidateSize--) {
        nameFontSize = candidateSize;
        ctx.font = `bold ${candidateSize}px Georgia, serif`;
        nameLines = this.wrapCanvasText(ctx, itemName, textWidth);
        if (nameLines.length <= 2) break;
      }

      ctx.fillStyle = REWARD_PANEL_COLORS.heading;
      const metadataY = height - (compact ? 11 : 10);
      const lineHeight = nameFontSize + 2;
      const nameAreaCenter = (7 + metadataY - (compact ? 10 : 8)) / 2;
      const firstLineY = nameAreaCenter - ((nameLines.length - 1) * lineHeight) / 2;
      nameLines.forEach((line, index) => {
        ctx.fillText(line, textX, firstLineY + index * lineHeight);
      });

      const quantity = Number(item.quantity) > 1 ? `  ×${Number(item.quantity)}` : '';
      ctx.font = `${compact ? 13 : 10}px Georgia, serif`;
      ctx.fillStyle = REWARD_PANEL_COLORS.label;
      ctx.fillText(`${rarity} · ${itemType}${quantity}`, textX, metadataY);
    } else {
      ctx.textAlign = 'center';
      ctx.font = `bold ${responsive.getCanvasFontSize('sm')}px Georgia, serif`;
      ctx.fillStyle = REWARD_PANEL_COLORS.heading;
      ctx.fillText(this.fitCanvasText(ctx, itemName, width - 12), width / 2, 56);

      ctx.font = `${responsive.getCanvasFontSize('sm')}px Georgia, serif`;
      ctx.fillStyle = REWARD_PANEL_COLORS.label;
      ctx.fillText(this.fitCanvasText(ctx, itemType, width - 12), width / 2, 69);
    }

    ctx.restore();
  }

  renderOverflowItem(ctx, card, count, progress, compact = false) {
    const scale = 0.8 + 0.2 * this.easeOutBack(progress);

    ctx.save();
    ctx.globalAlpha = Math.min(1, progress * 1.5);
    ctx.translate(card.x + card.width / 2, card.y + card.height / 2);
    ctx.scale(scale, scale);
    ctx.translate(-card.width / 2, -card.height / 2);
    ctx.fillStyle = REWARD_PANEL_COLORS.cardInset;
    ctx.strokeStyle = 'rgba(202, 174, 112, 0.45)';
    ctx.lineWidth = 1;
    this.roundRect(ctx, 0, 0, card.width, card.height, 8);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${compact ? 19 : 15}px Georgia, serif`;
    ctx.fillStyle = REWARD_PANEL_COLORS.heading;
    ctx.fillText(`+${count} MORE`, card.width / 2, card.height / 2 - 8);
    ctx.font = `${compact ? 13 : 10}px Georgia, serif`;
    ctx.fillStyle = REWARD_PANEL_COLORS.muted;
    ctx.fillText('SENT TO INVENTORY', card.width / 2, card.height / 2 + 12);
    ctx.restore();
  }

  fitCanvasText(ctx, value, maxWidth) {
    const text = String(value || '');
    if (maxWidth <= 0 || typeof ctx.measureText !== 'function') return text;
    if (ctx.measureText(text).width <= maxWidth) return text;

    const ellipsis = '…';
    let low = 0;
    let high = text.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (ctx.measureText(text.slice(0, middle) + ellipsis).width <= maxWidth) low = middle;
      else high = middle - 1;
    }
    return text.slice(0, low).trimEnd() + ellipsis;
  }

  /**
   * Wrap complete canvas text without adding an ellipsis. Long generated item
   * names are allowed to use a second line; unusually long single words are
   * split only when they cannot fit a row on their own.
   */
  wrapCanvasText(ctx, value, maxWidth) {
    const text = String(value || '').trim();
    if (!text || maxWidth <= 0 || typeof ctx.measureText !== 'function') {
      return text ? [text] : [];
    }

    const lines = [];
    let currentLine = '';

    const pushWord = (word) => {
      if (ctx.measureText(word).width <= maxWidth) {
        const candidate = currentLine ? `${currentLine} ${word}` : word;
        if (!currentLine || ctx.measureText(candidate).width <= maxWidth) {
          currentLine = candidate;
        } else {
          lines.push(currentLine);
          currentLine = word;
        }
        return;
      }

      if (currentLine) {
        lines.push(currentLine);
        currentLine = '';
      }

      let fragment = '';
      for (const character of word) {
        const candidate = fragment + character;
        if (fragment && ctx.measureText(candidate).width > maxWidth) {
          lines.push(fragment);
          fragment = character;
        } else {
          fragment = candidate;
        }
      }
      currentLine = fragment;
    };

    text.split(/\s+/).forEach(pushWord);
    if (currentLine) lines.push(currentLine);
    return lines;
  }

  formatItemType(value) {
    return String(value || 'item')
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, character => character.toUpperCase());
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
   * Render compact PvP rating panel below banner
   * Shows: Tier Icon | Rating (+/-change) | Rank change
   */
  renderPvPPanel(ctx, w, h) {
    if (!this.pvpResult) return;

    const pvp = this.pvpResult;
    const centerX = w / 2;
    // Position below banner (which is now at 0.15-0.18), above stats
    const panelY = h * 0.28;
    const panelWidth = 320;
    const panelHeight = 60;

    // Panel background - compact horizontal bar
    ctx.save();
    ctx.fillStyle = 'rgba(30, 25, 20, 0.9)';
    this.roundRect(ctx, centerX - panelWidth / 2, panelY, panelWidth, panelHeight, 8);
    ctx.fill();

    // Border with tier color
    ctx.strokeStyle = getTierColor(pvp.newRating);
    ctx.lineWidth = 2;
    ctx.stroke();

    // Calculate animated rating
    const displayRating = Math.floor(pvp.oldRating + (pvp.newRating - pvp.oldRating) * this.ratingProgress);

    // Tier icon and name (left section)
    const tier = getTier(pvp.newRating);
    const tierIcon = getTierIcon(tier.icon);
    ctx.font = 'bold 16px Georgia, serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = tier.color;
    ctx.fillText(`${tierIcon} ${tier.name}`, centerX - panelWidth / 2 + 16, panelY + panelHeight / 2);

    // Rating with change (center section)
    const changeColor = pvp.ratingChange >= 0 ? '#4a7548' : '#c45a5a';
    const changePrefix = pvp.ratingChange >= 0 ? '+' : '';
    ctx.font = 'bold 18px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8d4b8';
    ctx.fillText(`${displayRating.toLocaleString()}`, centerX, panelY + panelHeight / 2 - 8);

    ctx.font = '14px Georgia, serif';
    ctx.fillStyle = changeColor;
    ctx.fillText(`(${changePrefix}${pvp.ratingChange})`, centerX, panelY + panelHeight / 2 + 10);

    // Rank change (right section) - if available
    if (pvp.oldRank && pvp.newRank) {
      const rankArrow = pvp.newRank < pvp.oldRank ? '\u2191' : (pvp.newRank > pvp.oldRank ? '\u2193' : '\u2192');
      const rankColor = pvp.newRank < pvp.oldRank ? '#4a7548' : (pvp.newRank > pvp.oldRank ? '#c45a5a' : '#bfae8a');
      ctx.font = '14px Georgia, serif';
      ctx.textAlign = 'right';
      ctx.fillStyle = rankColor;
      ctx.fillText(`#${pvp.oldRank} ${rankArrow} #${pvp.newRank}`, centerX + panelWidth / 2 - 16, panelY + panelHeight / 2);
    }

    // Tier promotion/demotion badge (if applicable)
    if (pvp.tierChanged) {
      const badgeY = panelY - 12;
      const direction = pvp.newRating > pvp.oldRating ? 'PROMOTED!' : 'DEMOTED';
      ctx.font = 'bold 12px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd700';
      ctx.shadowColor = 'rgba(255, 215, 0, 0.6)';
      ctx.shadowBlur = 8;
      ctx.fillText(direction, centerX, badgeY);
      ctx.shadowBlur = 0;
    }

    ctx.restore();
  }

  /**
   * Render the continue button at the bottom of the screen
   */
  renderContinueButton(ctx, w, h) {
    const layout = this.getRewardLayout(w, h, this.rewards?.items?.length || 0);
    const footerReserve = this.status === 'defeat' && this.pvpResult?.surrenderPenalty
      ? (layout.compact ? 36 : 48)
      : 0;
    const {
      x: buttonX,
      width: buttonWidth,
      height: buttonHeight
    } = layout.button;
    const panelBottom = layout.panel.y + layout.panel.height;
    const rewardPanelY = this.status === 'victory' && !this.isPvP
      ? panelBottom + 24
      : layout.button.y;
    const buttonY = Math.min(layout.button.y, rewardPanelY) - footerReserve;

    // Store button rect for click detection
    this.continueButtonRect = { x: buttonX, y: buttonY, width: buttonWidth, height: buttonHeight };

    ctx.save();

    // Button background (parchment-styled)
    const isHovered = this.continueButtonHover;
    ctx.fillStyle = isHovered ? '#e1cca0' : '#cdb88e';
    ctx.strokeStyle = isHovered ? '#f0cf6a' : '#9b7c49';
    ctx.lineWidth = 2;

    // Draw rounded rect button
    this.roundRect(ctx, buttonX, buttonY, buttonWidth, buttonHeight, 10);
    ctx.fill();

    // Button border with subtle glow
    if (isHovered) {
      ctx.shadowColor = 'rgba(255, 215, 0, 0.4)';
      ctx.shadowBlur = 10;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Button text
    ctx.font = `bold ${layout.compact ? 20 : 18}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#2f251b';
    ctx.fillText('Continue  ›', w / 2, buttonY + buttonHeight / 2);

    ctx.restore();
  }

  /**
   * Render surrender penalty message below continue button
   */
  renderSurrenderPenaltyMessage(ctx, w, h) {
    // Only show for defeat with surrender penalty
    if (this.status !== 'defeat' || !this.pvpResult?.surrenderPenalty) return;

    const layout = this.getRewardLayout(w, h, this.rewards?.items?.length || 0);
    const messageY = h - (layout.compact ? 18 : 22);

    ctx.save();
    ctx.font = `${layout.compact ? 16 : 14}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e3a8a8';
    ctx.fillText(
      this.fitCanvasText(ctx, '\u26A0 Surrender penalty applied (-25% additional rating loss)', w - 32),
      w / 2,
      messageY
    );
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
      return this.handleConfirm();
    }

    return false;
  }

  /**
   * Confirm the outro without requiring pointer coordinates. This is shared by
   * the canvas button and keyboard input (Enter/Space).
   */
  handleConfirm() {
    if (!this.showContinueButton || this.phase !== 'awaiting_confirmation') {
      return false;
    }

    this.proceedToFadeOut();
    return true;
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

    // Hide DOM elements during fade
    if (this.statsTable) {
      this.statsTable.hide();
    }
    if (this.ratingPanel) {
      this.ratingPanel.hide();
    }
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

    // Cleanup rating panel
    if (this.ratingPanel) {
      this.ratingPanel.destroy();
      this.ratingPanel = null;
    }

    this.clearItemIconCache();

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
