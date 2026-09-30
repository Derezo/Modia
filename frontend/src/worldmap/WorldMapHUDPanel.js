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

/** Panel Y position */
const PANEL_Y = 10;

/** Panel width */
const PANEL_WIDTH = 180;

/** Base panel height (no travel segment) */
const BASE_HEIGHT = 90; // header 6px + zodiac 36px + divider 4px + stamina 36px + footer 6px + 2px buffer

/** Travel segment height including its divider */
const TRAVEL_HEIGHT_WITH_DIVIDER = 40; // travel 34px + divider 4px + 2px buffer

/** Collapsed size (mobile-friendly) */
// Wide enough for labelled rows ("Stamina 12/20", "Zodiac 3/12"): the old
// 54px square rendered as an unreadable blob on phones.
const COLLAPSED_WIDTH = 112;
const COLLAPSED_HEIGHT = 50;

/**
 * On a scaled-down canvas (phones: the logical map is drawn at about half
 * size) the HUD is enlarged back toward its design size in CSS pixels, so
 * "Stamina 8/8" stays legible instead of rendering at ~5px. Capped so the
 * expanded panel does not swallow the map.
 */
const MAX_HUD_UPSCALE = 2.2;

/** Height animation smoothing factor (0-1, higher = faster) */
const HEIGHT_ANIMATION_SPEED = 0.15;

/** Content padding from frame edge */
const CONTENT_PADDING = 6;

/** Divider height in pixels */
const DIVIDER_HEIGHT = 4;

export class WorldMapHUDPanel {
  constructor({ collapsed = false } = {}) {
    // Panel position and size
    this.x = PANEL_X;
    this.y = PANEL_Y;
    this.width = PANEL_WIDTH;

    // Collapsed state — toggleable; renders a compact summary chip instead
    // of the full panel. Expand by tapping.
    this.collapsed = collapsed;
    // Panels that start collapsed (phones) can be tapped closed again
    this.collapsible = collapsed;

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

  /**
   * Apply the breakpoint layout: collapsed on phones, expanded otherwise.
   * Collapsibility follows the same breakpoint, so a panel that becomes mobile
   * after load can be folded back after expanding, and a desktop panel is not
   * folded into the phone chip by a click.
   * @param {boolean} value - true for the phone (collapsed, collapsible) layout
   */
  setCollapsed(value) {
    this.collapsed = !!value;
    this.collapsible = !!value;
  }

  /**
   * Tell the panel how many CSS pixels one logical canvas pixel occupies
   * (Game.scale). Below 1 the panel is drawn larger to compensate.
   * @param {number} scale - CSS px per logical px
   */
  setDisplayScale(scale) {
    this.displayScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  }

  /**
   * Factor the panel is enlarged by (1 on desktop).
   * @returns {number}
   */
  getUpscale() {
    const scale = this.displayScale || 1;
    return scale >= 1 ? 1 : Math.min(MAX_HUD_UPSCALE, 1 / scale);
  }

  /**
   * Bottom edge of the drawn panel (chip when collapsed), in CSS pixels from
   * the canvas top. DOM overlays anchored to the canvas (the quest HUD) use it
   * to sit below the panel instead of covering it.
   * @returns {number}
   */
  getBottomCssOffset() {
    const height = this.collapsed ? COLLAPSED_HEIGHT : Math.ceil(this.currentHeight);
    return (this.y + height * this.getUpscale()) * (this.displayScale || 1);
  }

  /**
   * Map a canvas point into the panel's unscaled drawing space.
   * @returns {{x: number, y: number}}
   */
  toPanelSpace(canvasX, canvasY) {
    const k = this.getUpscale();
    return {
      x: this.x + (canvasX - this.x) / k,
      y: this.y + (canvasY - this.y) / k
    };
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
    const k = this.getUpscale();
    if (k !== 1) {
      // Enlarge around the panel's top-left corner; hit tests use
      // toPanelSpace() to undo this.
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.scale(k, k);
      ctx.translate(-this.x, -this.y);
      this._renderPanel(ctx);
      ctx.restore();
      return;
    }
    this._renderPanel(ctx);
  }

  /**
   * Render the panel in its unscaled design space.
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   */
  _renderPanel(ctx) {
    if (this.collapsed) {
      this._renderCollapsed(ctx);
      return;
    }

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
      // The frame height eases toward its target more slowly than the
      // segment slides in, so clip to the frame's current inner area: the
      // "-> Destination 100%" row must never spill below the border.
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, width, Math.max(0, height - CONTENT_PADDING));
      ctx.clip();

      // Divider before travel
      this.renderDivider(ctx, contentX, contentY, contentWidth);
      contentY += DIVIDER_HEIGHT;

      this.travelSegment.render(ctx, contentX, contentY, contentWidth);
      ctx.restore();
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
  handleClick(rawX, rawY) {
    // Check if click is within panel bounds first
    if (!this.containsPoint(rawX, rawY)) {
      return false;
    }
    const { x: canvasX, y: canvasY } = this.toPanelSpace(rawX, rawY);

    // Collapsed chip: any tap on the chip expands the panel
    if (this.collapsed) {
      this.collapsed = false;
      return true;
    }

    // Check zodiac segment click
    if (this.zodiacSegment.containsPoint(canvasX, canvasY)) {
      this.zodiacSegment.handleClick();
      return true;
    }

    // On phones, tapping the rest of the expanded panel folds it back
    if (this.collapsible) {
      this.collapsed = true;
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
  containsPoint(rawX, rawY) {
    const { x, y } = this.toPanelSpace(rawX, rawY);
    if (this.collapsed) {
      return x >= this.x && x <= this.x + COLLAPSED_WIDTH &&
             y >= this.y && y <= this.y + COLLAPSED_HEIGHT;
    }
    return x >= this.x && x <= this.x + this.width &&
           y >= this.y && y <= this.y + this.currentHeight;
  }

  /**
   * Render the collapsed (mobile-friendly) summary chip.
   * Shows stamina fraction on top and zodiac count on bottom inside a
   * small tappable square. The whole chip is a tap target that expands.
   */
  _renderCollapsed(ctx) {
    const { x, y } = this;
    const w = COLLAPSED_WIDTH;
    const h = COLLAPSED_HEIGHT;

    // Frame (reuse frameRenderer for consistency)
    this.frameRenderer.render(ctx, x, y, w, h);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = HUD_COLORS.text?.primary || '#e8e0d5';

    const stamina = this.staminaSegment.current ?? 0;
    const staminaMax = this.staminaSegment.max ?? 0;
    const zodiac = this.zodiacSegment.collected ?? 0;

    const zodiacTotal = this.zodiacSegment.total ?? 12;

    ctx.font = 'bold 12px serif';
    ctx.fillText(`Stamina ${stamina}/${staminaMax}`, x + w / 2, y + h / 2 - 8);

    ctx.font = '11px serif';
    ctx.fillText(`Zodiac ${zodiac}/${zodiacTotal}`, x + w / 2, y + h / 2 + 9);

    ctx.restore();
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
