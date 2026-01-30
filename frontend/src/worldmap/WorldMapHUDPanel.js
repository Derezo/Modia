/**
 * WorldMapHUDPanel - Main container orchestrating all HUD segments for World Map
 *
 * Unified HUD panel that replaces separate StaminaBar, TravelProgressBar, and
 * ZodiacIndicator components with a cohesive, animated panel.
 *
 * Position & Size:
 * - x: 10, y: 70 (below player info panel)
 * - width: 180px (expanded from old 160px)
 * - Height: Dynamic based on visible segments
 *   - Normal (no travel): 90px
 *   - During travel: 124px (adds travel segment + divider)
 *
 * Layout States:
 *
 * Normal (no travel):
 * +----------------------------------+
 * | [Frame Padding: 6px]             |
 * |   Zodiac Segment (36px)          |
 * | [Divider: 4px]                   |
 * |   Stamina Segment (36px)         |
 * | [Frame Padding: 6px]             |
 * +----------------------------------+
 *
 * During Travel (animated expansion):
 * +----------------------------------+
 * | [Frame Padding: 6px]             |
 * |   Zodiac Segment (36px)          |
 * | [Divider: 4px]                   |
 * |   Stamina Segment (36px)         |
 * | [Divider: 4px]                   |
 * |   Travel Progress Segment (30px) |
 * | [Frame Padding: 6px]             |
 * +----------------------------------+
 *
 * @module WorldMapHUDPanel
 */

import { HUD_COLORS } from '../ui/parchment/ParchmentTheme.js';
import { HUDFrameRenderer } from './hud/HUDFrameRenderer.js';
import { HUDParticleSystem } from './hud/HUDParticleSystem.js';
import { StaminaSegment } from './hud/StaminaSegment.js';
import { TravelSegment } from './hud/TravelSegment.js';
import { ZodiacSegment } from './hud/ZodiacSegment.js';

/** Panel X position */
const PANEL_X = 10;

/** Panel Y position (below player info panel) */
const PANEL_Y = 70;

/** Panel width */
const PANEL_WIDTH = 180;

/** Base panel height (no travel segment) */
const BASE_HEIGHT = 90; // header 6px + zodiac 36px + divider 4px + stamina 36px + footer 6px + 2px buffer

/** Travel segment height including its divider */
const TRAVEL_HEIGHT_WITH_DIVIDER = 34; // travel 30px + divider 4px

/** Height animation smoothing factor (0-1, higher = faster) */
const HEIGHT_ANIMATION_SPEED = 0.15;

/** Content padding from frame edge */
const CONTENT_PADDING = 6;

/** Divider height in pixels */
const DIVIDER_HEIGHT = 4;

export class WorldMapHUDPanel {
  constructor() {
    // Panel position and size
    this.x = PANEL_X;
    this.y = PANEL_Y;
    this.width = PANEL_WIDTH;

    // Create child components
    this.frameRenderer = new HUDFrameRenderer();
    this.particleSystem = new HUDParticleSystem();
    this.staminaSegment = new StaminaSegment();
    this.travelSegment = new TravelSegment();
    this.zodiacSegment = new ZodiacSegment();

    // Connect particle system to stamina segment for effects
    this.staminaSegment.setParticleSystem(this.particleSystem);

    // Animation state for height changes
    this.currentHeight = BASE_HEIGHT;
    this.targetHeight = BASE_HEIGHT;
  }

  // ========== Proxy Methods to Child Segments ==========

  /**
   * Update stamina display from API response
   * @param {Object} staminaInfo - {current, max, nextRegenAt, regenIntervalSeconds}
   * @param {boolean} instant - Skip animation if true
   */
  setStamina(staminaInfo, instant = false) {
    this.staminaSegment.setStamina(staminaInfo, instant);
  }

  /**
   * Begin travel with slide-in animation
   * @param {string} destination - Name of destination node
   * @param {number} duration - Travel duration in milliseconds
   */
  startTravel(destination, duration) {
    this.travelSegment.startTravel(destination, duration);
  }

  /**
   * Mark travel as complete and trigger slide-out animation
   */
  completeTravel() {
    this.travelSegment.complete();
  }

  /**
   * Cancel travel immediately without animation
   */
  cancelTravel() {
    this.travelSegment.cancel();
  }

  /**
   * Update zodiac collection display from API response
   * @param {Object} data - { totalCollected, collectionComplete }
   */
  setZodiacCollection(data) {
    this.zodiacSegment.setCollection(data);
  }

  /**
   * Set click handler for zodiac segment
   * @param {Function} handler - () => void
   */
  setZodiacClickHandler(handler) {
    this.zodiacSegment.setClickHandler(handler);
  }

  /**
   * Check for and clear the new crystal notification flag
   */
  checkZodiacNewCrystalFlag() {
    this.zodiacSegment.checkNewCrystalFlag();
  }

  // ========== Lifecycle Methods ==========

  /**
   * Update all components and animate height changes
   * @param {number} deltaTime - Time elapsed in milliseconds
   */
  update(deltaTime) {
    // Update all child components
    this.particleSystem.update(deltaTime);
    this.staminaSegment.update(deltaTime);
    this.travelSegment.update(deltaTime);
    this.zodiacSegment.update(deltaTime);

    // Calculate target height based on travel visibility
    this.targetHeight = BASE_HEIGHT + (this.travelSegment.isVisible() ? TRAVEL_HEIGHT_WITH_DIVIDER : 0);

    // Animate height changes smoothly
    const heightDiff = this.targetHeight - this.currentHeight;
    if (Math.abs(heightDiff) > 0.5) {
      this.currentHeight += heightDiff * HEIGHT_ANIMATION_SPEED;
    } else {
      this.currentHeight = this.targetHeight;
    }
  }

  /**
   * Render the complete HUD panel
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   */
  render(ctx) {
    const { x, y, width } = this;
    const height = Math.ceil(this.currentHeight);

    // Draw ornate frame with background
    this.frameRenderer.render(ctx, x, y, width, height);

    // Content area (inset from frame)
    const contentX = x + CONTENT_PADDING;
    const contentWidth = width - CONTENT_PADDING * 2;
    let contentY = y + CONTENT_PADDING;

    // Zodiac segment (36px)
    this.zodiacSegment.render(ctx, contentX, contentY, contentWidth);
    contentY += 36;

    // Divider after zodiac
    this.renderDivider(ctx, contentX, contentY, contentWidth);
    contentY += DIVIDER_HEIGHT;

    // Stamina segment (36px)
    this.staminaSegment.render(ctx, contentX, contentY, contentWidth);
    contentY += 36;

    // Travel segment (if visible) - rendered at bottom to reduce animation jitter
    if (this.travelSegment.isVisible()) {
      // Divider before travel
      this.renderDivider(ctx, contentX, contentY, contentWidth);
      contentY += DIVIDER_HEIGHT;

      this.travelSegment.render(ctx, contentX, contentY, contentWidth);
    }

    // Render particles on top of everything
    this.particleSystem.render(ctx);
  }

  /**
   * Render a horizontal divider line
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x - Left position
   * @param {number} y - Top position
   * @param {number} width - Line width
   */
  renderDivider(ctx, x, y, width) {
    ctx.save();
    ctx.strokeStyle = HUD_COLORS.panel.divider;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + 2);
    ctx.lineTo(x + width, y + 2);
    ctx.stroke();
    ctx.restore();
  }

  // ========== Hit Detection ==========

  /**
   * Handle click events within the panel
   * @param {number} canvasX - Click X coordinate in canvas space
   * @param {number} canvasY - Click Y coordinate in canvas space
   * @returns {boolean} True if click was handled
   */
  handleClick(canvasX, canvasY) {
    // Check if click is within panel bounds first
    if (!this.containsPoint(canvasX, canvasY)) {
      return false;
    }

    // Check zodiac segment click
    if (this.zodiacSegment.containsPoint(canvasX, canvasY)) {
      this.zodiacSegment.handleClick();
      return true;
    }

    return false;
  }

  /**
   * Check if point is within panel bounds
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @returns {boolean}
   */
  containsPoint(x, y) {
    return x >= this.x && x <= this.x + this.width &&
           y >= this.y && y <= this.y + this.currentHeight;
  }

  // ========== Cleanup ==========

  /**
   * Clean up resources
   */
  destroy() {
    this.frameRenderer.destroy();
    this.particleSystem.clear();
  }
}

export default WorldMapHUDPanel;
