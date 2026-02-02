/**
 * @module BattleLoadingScreen
 * @description Parchment-themed loading overlay for battle transitions.
 * Displays progress, phase information, and rotating battle tips.
 *
 * Key responsibilities:
 * - Render semi-transparent parchment overlay during battle loading
 * - Display animated progress bar with phase text
 * - Rotate through shuffled battle tips every 3.5 seconds
 * - Handle fade in/out transitions
 *
 * @see battleTips.js - Source of tip data
 * @see ParchmentTheme.js - Color and typography constants
 */

import { PARCHMENT_COLORS, PARCHMENT_TYPOGRAPHY } from './ParchmentTheme.js';
import { battleTips } from '../../data/battleTips.js';

/**
 * Fisher-Yates shuffle algorithm for randomizing tip order
 * @param {Array} array - Array to shuffle (mutates in place)
 * @returns {Array} Shuffled array
 */
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Convert hex color to rgba
 * @param {string} hex - Hex color (e.g., '#d4c4a8')
 * @param {number} alpha - Alpha value (0-1)
 * @returns {string} RGBA color string
 */
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Parchment-themed battle loading screen
 */
export class BattleLoadingScreen {
  /**
   * @param {Object} game - Game instance with canvas reference
   */
  constructor(game) {
    this.game = game;
    this.visible = false;
    this.progress = 0;
    this.phase = '';
    this.currentTipIndex = 0;
    this.tipRotationTimer = 0;
    this.tips = [];
    this.fadeAlpha = 0;
    this.isFadingOut = false;

    // Configuration
    this.tipRotationInterval = 3500; // ms
    this.fadeSpeed = 0.003; // alpha per ms
  }

  /**
   * Show the loading screen
   * Resets state and shuffles tips for variety
   */
  show() {
    this.visible = true;
    this.isFadingOut = false;
    this.progress = 0;
    this.phase = 'Initializing...';
    this.currentTipIndex = 0;
    this.tipRotationTimer = 0;
    this.fadeAlpha = 0;
    this.tips = shuffleArray([...battleTips]);
  }

  /**
   * Update loading progress
   * @param {number} loaded - Number of items loaded
   * @param {number} total - Total items to load
   * @param {string} phase - Current loading phase description
   */
  updateProgress(loaded, total, phase) {
    this.progress = total > 0 ? loaded / total : 0;
    this.phase = phase;
  }

  /**
   * Update animation state
   * @param {number} deltaTime - Time since last update in milliseconds
   */
  update(deltaTime) {
    // Handle fade animation
    if (this.isFadingOut) {
      this.fadeAlpha -= this.fadeSpeed * deltaTime;
      if (this.fadeAlpha <= 0) {
        this.fadeAlpha = 0;
        this.visible = false;
      }
    } else if (this.visible) {
      this.fadeAlpha += this.fadeSpeed * deltaTime;
      if (this.fadeAlpha > 1) {
        this.fadeAlpha = 1;
      }
    }

    // Rotate tips
    if (this.visible && this.tips.length > 0) {
      this.tipRotationTimer += deltaTime;
      if (this.tipRotationTimer >= this.tipRotationInterval) {
        this.tipRotationTimer = 0;
        this.currentTipIndex = (this.currentTipIndex + 1) % this.tips.length;
      }
    }
  }

  /**
   * Render the loading screen to canvas
   * @param {CanvasRenderingContext2D} ctx - Canvas rendering context
   */
  render(ctx) {
    if (!this.visible && this.fadeAlpha <= 0) {
      return;
    }

    const { width, height } = ctx.canvas;
    const alpha = this.fadeAlpha;

    ctx.save();

    // Semi-transparent parchment overlay
    this.renderOverlay(ctx, width, height, alpha);

    // Content panel
    const panelWidth = Math.min(600, width * 0.85);
    const panelHeight = Math.min(280, height * 0.45);
    const panelX = (width - panelWidth) / 2;
    const panelY = (height - panelHeight) / 2;

    this.renderPanel(ctx, panelX, panelY, panelWidth, panelHeight, alpha);

    // Header text
    this.renderHeader(ctx, width, panelY + 35, alpha);

    // Progress bar
    const progressBarY = panelY + 80;
    this.renderProgressBar(ctx, panelX + 40, progressBarY, panelWidth - 80, 24, alpha);

    // Phase text
    this.renderPhaseText(ctx, width, progressBarY + 45, alpha);

    // Battle tip
    this.renderBattleTip(ctx, panelX + 40, panelY + panelHeight - 70, panelWidth - 80, alpha);

    ctx.restore();
  }

  /**
   * Render semi-transparent background overlay
   */
  renderOverlay(ctx, width, height, alpha) {
    ctx.fillStyle = hexToRgba(PARCHMENT_COLORS.dark, 0.85 * alpha);
    ctx.fillRect(0, 0, width, height);
  }

  /**
   * Render the central parchment panel
   */
  renderPanel(ctx, x, y, width, height, alpha) {
    // Panel shadow
    ctx.fillStyle = `rgba(0, 0, 0, ${0.4 * alpha})`;
    ctx.beginPath();
    ctx.roundRect(x + 4, y + 4, width, height, 8);
    ctx.fill();

    // Panel background gradient
    const gradient = ctx.createLinearGradient(x, y, x, y + height);
    gradient.addColorStop(0, hexToRgba(PARCHMENT_COLORS.light, alpha));
    gradient.addColorStop(0.5, hexToRgba(PARCHMENT_COLORS.mid, alpha));
    gradient.addColorStop(1, hexToRgba(PARCHMENT_COLORS.dark, alpha));

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 8);
    ctx.fill();

    // Panel border
    ctx.strokeStyle = hexToRgba(PARCHMENT_COLORS.border, alpha);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 8);
    ctx.stroke();

    // Inner highlight
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.2 * alpha})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x + 2, y + 2, width - 4, height - 4, 6);
    ctx.stroke();
  }

  /**
   * Render the header text
   */
  renderHeader(ctx, centerX, y, alpha) {
    ctx.font = `bold ${parseInt(PARCHMENT_TYPOGRAPHY.sizes.xxl, 10)}px ${PARCHMENT_TYPOGRAPHY.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Text shadow
    ctx.fillStyle = `rgba(0, 0, 0, ${0.3 * alpha})`;
    ctx.fillText('Preparing for Battle...', centerX + 2, y + 2);

    // Main text
    ctx.fillStyle = hexToRgba(PARCHMENT_COLORS.text.primary, alpha);
    ctx.fillText('Preparing for Battle...', centerX, y);
  }

  /**
   * Render the progress bar
   */
  renderProgressBar(ctx, x, y, width, height, alpha) {
    // Track background (inset)
    ctx.fillStyle = `rgba(0, 0, 0, ${0.3 * alpha})`;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 4);
    ctx.fill();

    // Track inner
    ctx.fillStyle = hexToRgba(PARCHMENT_COLORS.light, 0.5 * alpha);
    ctx.beginPath();
    ctx.roundRect(x + 2, y + 2, width - 4, height - 4, 3);
    ctx.fill();

    // Fill bar
    const fillWidth = Math.max(0, (width - 6) * this.progress);
    if (fillWidth > 0) {
      const fillGradient = ctx.createLinearGradient(x + 3, y, x + 3, y + height);
      fillGradient.addColorStop(0, hexToRgba('#8b4050', alpha));
      fillGradient.addColorStop(0.5, hexToRgba(PARCHMENT_COLORS.accent.burgundy, alpha));
      fillGradient.addColorStop(1, hexToRgba('#5a1f2d', alpha));

      ctx.fillStyle = fillGradient;
      ctx.beginPath();
      ctx.roundRect(x + 3, y + 3, fillWidth, height - 6, 2);
      ctx.fill();

      // Shine effect on fill
      ctx.fillStyle = `rgba(255, 255, 255, ${0.15 * alpha})`;
      ctx.beginPath();
      ctx.roundRect(x + 3, y + 3, fillWidth, (height - 6) / 2, 2);
      ctx.fill();
    }

    // Border
    ctx.strokeStyle = hexToRgba(PARCHMENT_COLORS.border, alpha);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 4);
    ctx.stroke();

    // Percentage text
    const percentage = Math.floor(this.progress * 100);
    ctx.font = `bold ${parseInt(PARCHMENT_TYPOGRAPHY.sizes.sm, 10)}px ${PARCHMENT_TYPOGRAPHY.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = hexToRgba(PARCHMENT_COLORS.text.inverse, alpha);
    ctx.fillText(`${percentage}%`, x + width / 2, y + height / 2);
  }

  /**
   * Render the current phase text
   */
  renderPhaseText(ctx, centerX, y, alpha) {
    ctx.font = `${parseInt(PARCHMENT_TYPOGRAPHY.sizes.base, 10)}px ${PARCHMENT_TYPOGRAPHY.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = hexToRgba(PARCHMENT_COLORS.text.secondary, alpha);
    ctx.fillText(this.phase, centerX, y);
  }

  /**
   * Render the current battle tip
   */
  renderBattleTip(ctx, x, y, maxWidth, alpha) {
    if (this.tips.length === 0) return;

    const currentTip = this.tips[this.currentTipIndex];
    if (!currentTip) return;

    // Tip category label
    const categoryLabel = this.getCategoryLabel(currentTip.category);
    ctx.font = `bold ${parseInt(PARCHMENT_TYPOGRAPHY.sizes.sm, 10)}px ${PARCHMENT_TYPOGRAPHY.fontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = hexToRgba(PARCHMENT_COLORS.accent.burgundy, alpha);
    ctx.fillText(categoryLabel, x, y);

    // Tip text (with word wrap)
    ctx.font = `${parseInt(PARCHMENT_TYPOGRAPHY.sizes.base, 10)}px ${PARCHMENT_TYPOGRAPHY.fontFamily}`;
    ctx.fillStyle = hexToRgba(PARCHMENT_COLORS.text.primary, alpha);

    const lines = this.wrapText(ctx, currentTip.text, maxWidth);
    const lineHeight = 18;
    lines.forEach((line, index) => {
      ctx.fillText(line, x, y + 18 + (index * lineHeight));
    });
  }

  /**
   * Get display label for tip category
   * @param {string} category - Tip category
   * @returns {string} Display label
   */
  getCategoryLabel(category) {
    const labels = {
      combat: 'Combat Tip:',
      class: 'Class Tip:',
      status: 'Status Effect:',
      lore: 'Lore:'
    };
    return labels[category] || 'Tip:';
  }

  /**
   * Word wrap text to fit within max width
   * @param {CanvasRenderingContext2D} ctx - Canvas context for measuring
   * @param {string} text - Text to wrap
   * @param {number} maxWidth - Maximum line width
   * @returns {string[]} Array of lines
   */
  wrapText(ctx, text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const metrics = ctx.measureText(testLine);

      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines;
  }

  /**
   * Start hiding the loading screen with fade out animation
   */
  hide() {
    this.isFadingOut = true;
  }

  /**
   * Immediately hide without animation
   */
  hideImmediate() {
    this.visible = false;
    this.fadeAlpha = 0;
    this.isFadingOut = false;
  }

  /**
   * Check if loading screen is fully visible
   * @returns {boolean} True if fully visible
   */
  isFullyVisible() {
    return this.visible && this.fadeAlpha >= 1 && !this.isFadingOut;
  }

  /**
   * Check if loading screen is currently fading
   * @returns {boolean} True if fading in or out
   */
  isFading() {
    return (this.visible && this.fadeAlpha < 1) || this.isFadingOut;
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.visible = false;
    this.tips = [];
    this.fadeAlpha = 0;
    this.isFadingOut = false;
  }
}

export default BattleLoadingScreen;
