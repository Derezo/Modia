/**
 * AnimatedSprite - Handles directional grids and vertical animation strips
 *
 * Sprite sheet layout (8 directions, N frames per animation):
 * Row 0: Direction 0 (South)      - frames 0 to N-1
 * Row 1: Direction 1 (Southwest)  - frames 0 to N-1
 * Row 2: Direction 2 (West)       - frames 0 to N-1
 * Row 3: Direction 3 (Northwest)  - frames 0 to N-1
 * Row 4: Direction 4 (North)      - frames 0 to N-1
 * Row 5: Direction 5 (Northeast)  - frames 0 to N-1
 * Row 6: Direction 6 (East)       - frames 0 to N-1
 * Row 7: Direction 7 (Southeast)  - frames 0 to N-1
 */
export class AnimatedSprite {
  /**
   * Direction constants
   */
  static DIRECTIONS = {
    SOUTH: 0,
    SOUTHWEST: 1,
    WEST: 2,
    NORTHWEST: 3,
    NORTH: 4,
    NORTHEAST: 5,
    EAST: 6,
    SOUTHEAST: 7
  };

  /**
   * Create animated sprite
   * @param {Image} spriteSheet - The sprite sheet image
   * @param {Object} config - Configuration
   * @param {number} config.frameWidth - Width of each frame in pixels
   * @param {number} config.frameHeight - Height of each frame in pixels
   * @param {number} config.frameCount - Number of frames in animation
   * @param {number} [config.frameRate=12] - Frames per second
   * @param {number} [config.directions=8] - Number of directions in sheet (1, 4, or 8)
   * @param {boolean} [config.loop=true] - Whether animation loops
   */
  constructor(spriteSheet, config) {
    this.spriteSheet = spriteSheet;
    this.frameWidth = config.frameWidth || 64;
    this.frameHeight = config.frameHeight || 64;
    this.frameCount = config.frameCount || 4;
    this.frameRate = config.frameRate || 12;
    this.directions = config.directions || 8;
    this.loop = config.loop !== false;
    this.layout = config.layout || 'directional-grid';
    this.mirrorByDirection = config.mirrorByDirection === true;
    this.baseFacing = config.baseFacing || 'right';

    // Animation state
    this.currentFrame = 0;
    this.frameTimer = 0;
    this.currentDirection = 0;
    this.playing = true;
    this.finished = false;

    // Callbacks
    this.onComplete = null;
    this.onFrameChange = null;
  }

  /**
   * Update animation (call each frame)
   * @param {number} deltaTime - Time since last frame in seconds
   */
  update(deltaTime) {
    if (!this.playing || this.finished) return;

    this.frameTimer += deltaTime;
    const frameDuration = 1 / this.frameRate;

    while (this.frameTimer >= frameDuration) {
      this.frameTimer -= frameDuration;
      this.advanceFrame();
    }
  }

  /**
   * Advance to next frame
   */
  advanceFrame() {
    const previousFrame = this.currentFrame;
    this.currentFrame++;

    if (this.currentFrame >= this.frameCount) {
      if (this.loop) {
        this.currentFrame = 0;
      } else {
        this.currentFrame = this.frameCount - 1;
        this.finished = true;
        this.playing = false;
        if (this.onComplete) {
          this.onComplete();
        }
      }
    }

    if (previousFrame !== this.currentFrame && this.onFrameChange) {
      this.onFrameChange(this.currentFrame);
    }
  }

  /**
   * Set facing direction (0-7)
   * @param {number} direction - Direction index
   * @returns {number} The validated direction that was set
   */
  setDirection(direction) {
    // Validate input - default to 0 (South) if invalid
    if (typeof direction !== 'number' || isNaN(direction)) {
      direction = 0;
    }
    this.currentDirection = Math.floor(Math.abs(direction)) % this.directions;
    return this.currentDirection;
  }

  /**
   * Get current direction
   * @returns {number} Current direction index
   */
  getDirection() {
    return this.currentDirection;
  }

  /**
   * Set direction from angle (radians)
   * Angle 0 = East, increases counter-clockwise
   * @param {number} angle - Angle in radians
   * @returns {number} The direction that was set
   */
  setDirectionFromAngle(angle) {
    // Normalize angle to 0-2π
    const normalizedAngle = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

    // Convert to 8 directions (0 = East in math, but we want 0 = South for sprites)
    // Each direction covers π/4 radians (45 degrees)
    // Offset by π/8 to center the direction zones
    const directionIndex = Math.round(normalizedAngle / (Math.PI / 4)) % 8;

    // Map from math directions to sprite directions
    // Math: 0=E, 1=NE, 2=N, 3=NW, 4=W, 5=SW, 6=S, 7=SE
    // Sprite: 0=S, 1=SW, 2=W, 3=NW, 4=N, 5=NE, 6=E, 7=SE
    const mathToSprite = [6, 5, 4, 3, 2, 1, 0, 7];
    this.currentDirection = mathToSprite[directionIndex];
    return this.currentDirection;
  }

  /**
   * Set direction from movement vector
   * @param {number} dx - X movement delta
   * @param {number} dy - Y movement delta
   * @returns {number} The direction that was set (or current direction if no movement)
   */
  setDirectionFromMovement(dx, dy) {
    if (dx === 0 && dy === 0) return this.currentDirection;

    // Calculate angle and convert to direction
    const angle = Math.atan2(-dy, dx); // Negate Y because screen Y is inverted
    return this.setDirectionFromAngle(angle);
  }

  /**
   * Set direction from grid positions (isometric)
   * @param {number} fromX - Start grid X
   * @param {number} fromY - Start grid Y
   * @param {number} toX - End grid X
   * @param {number} toY - End grid Y
   * @returns {number} The direction that was set (or current direction if no movement)
   */
  setDirectionFromGridMovement(fromX, fromY, toX, toY) {
    const dx = toX - fromX;
    const dy = toY - fromY;

    // No movement - return current direction unchanged
    if (dx === 0 && dy === 0) return this.currentDirection;

    // For isometric: moving +X is SE, +Y is SW, -X is NW, -Y is NE
    // Combine to get 8 directions
    if (dx > 0 && dy === 0) this.currentDirection = 7;      // SE
    else if (dx > 0 && dy > 0) this.currentDirection = 0;   // S
    else if (dx === 0 && dy > 0) this.currentDirection = 1; // SW
    else if (dx < 0 && dy > 0) this.currentDirection = 2;   // W
    else if (dx < 0 && dy === 0) this.currentDirection = 3; // NW
    else if (dx < 0 && dy < 0) this.currentDirection = 4;   // N
    else if (dx === 0 && dy < 0) this.currentDirection = 5; // NE
    else if (dx > 0 && dy < 0) this.currentDirection = 6;   // E

    return this.currentDirection;
  }

  /**
   * Draw sprite at position
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {number} x - Center X position
   * @param {number} y - Bottom Y position (sprite drawn above this point)
   * @param {number} [scale=1] - Scale factor
   */
  draw(ctx, x, y, scale = 1) {
    if (!this.spriteSheet) return;

    const drawWidth = this.frameWidth * scale;
    const drawHeight = this.frameHeight * scale;
    this.drawFrame(ctx, x - drawWidth / 2, y - drawHeight, drawWidth, drawHeight);
  }

  /**
   * Draw sprite centered at position
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {number} x - Center X position
   * @param {number} y - Center Y position
   * @param {number} [scale=1] - Scale factor
   */
  drawCentered(ctx, x, y, scale = 1) {
    if (!this.spriteSheet) return;

    const drawWidth = this.frameWidth * scale;
    const drawHeight = this.frameHeight * scale;
    this.drawFrame(ctx, x - drawWidth / 2, y - drawHeight / 2, drawWidth, drawHeight);
  }

  /**
   * Draw with custom offset
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {number} x - Base X position
   * @param {number} y - Base Y position
   * @param {number} offsetX - X offset from base
   * @param {number} offsetY - Y offset from base
   * @param {number} [scale=1] - Scale factor
   */
  drawWithOffset(ctx, x, y, offsetX, offsetY, scale = 1) {
    if (!this.spriteSheet) return;

    const drawWidth = this.frameWidth * scale;
    const drawHeight = this.frameHeight * scale;
    this.drawFrame(
      ctx,
      x + offsetX - drawWidth / 2,
      y + offsetY - drawHeight,
      drawWidth,
      drawHeight
    );
  }

  /**
   * Resolve the current source rectangle for either supported sheet layout.
   * Vertical strips store animation frames top-to-bottom and use mirroring for
   * east/west facing. Directional grids store frames left-to-right and facing
   * directions top-to-bottom.
   */
  getSourceRect() {
    if (this.layout === 'vertical-strip') {
      return {
        x: 0,
        y: this.currentFrame * this.frameHeight,
        width: this.frameWidth,
        height: this.frameHeight
      };
    }

    return {
      x: this.currentFrame * this.frameWidth,
      y: this.currentDirection * this.frameHeight,
      width: this.frameWidth,
      height: this.frameHeight
    };
  }

  /**
   * Whether a non-directional strip should be mirrored for its current facing.
   */
  shouldMirror() {
    if (!this.mirrorByDirection) return false;
    const facesWest = [
      AnimatedSprite.DIRECTIONS.SOUTHWEST,
      AnimatedSprite.DIRECTIONS.WEST,
      AnimatedSprite.DIRECTIONS.NORTHWEST
    ].includes(this.currentDirection);
    return this.baseFacing === 'right' ? facesWest : !facesWest;
  }

  /**
   * Draw the current frame into a destination rectangle.
   */
  drawFrame(ctx, destX, destY, destWidth, destHeight) {
    const src = this.getSourceRect();

    if (!this.shouldMirror()) {
      ctx.drawImage(
        this.spriteSheet,
        src.x, src.y, src.width, src.height,
        destX, destY, destWidth, destHeight
      );
      return;
    }

    ctx.save();
    ctx.translate(destX + destWidth, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(
      this.spriteSheet,
      src.x, src.y, src.width, src.height,
      0, destY, destWidth, destHeight
    );
    ctx.restore();
  }

  // =====================
  // Playback Control
  // =====================

  /**
   * Play animation
   */
  play() {
    this.playing = true;
    this.finished = false;
  }

  /**
   * Pause animation
   */
  pause() {
    this.playing = false;
  }

  /**
   * Stop and reset animation
   */
  stop() {
    this.playing = false;
    this.currentFrame = 0;
    this.frameTimer = 0;
    this.finished = false;
  }

  /**
   * Reset animation to beginning
   */
  reset() {
    this.currentFrame = 0;
    this.frameTimer = 0;
    this.finished = false;
  }

  /**
   * Go to specific frame
   * @param {number} frame - Frame index
   */
  gotoFrame(frame) {
    this.currentFrame = Math.max(0, Math.min(frame, this.frameCount - 1));
    this.frameTimer = 0;
  }

  /**
   * Check if animation is complete (for non-looping)
   */
  isFinished() {
    return this.finished;
  }

  /**
   * Check if animation is playing
   */
  isPlaying() {
    return this.playing && !this.finished;
  }

  // =====================
  // Configuration
  // =====================

  /**
   * Update sprite sheet
   * @param {Image} spriteSheet - New sprite sheet
   */
  setSpriteSheet(spriteSheet) {
    this.spriteSheet = spriteSheet;
  }

  /**
   * Set frame rate
   * @param {number} fps - Frames per second
   */
  setFrameRate(fps) {
    this.frameRate = fps;
  }

  /**
   * Set loop mode
   * @param {boolean} loop - Whether to loop
   */
  setLoop(loop) {
    this.loop = loop;
    if (loop && this.finished) {
      this.finished = false;
    }
  }

  /**
   * Set completion callback
   * @param {Function} callback - Called when animation completes (non-looping only)
   */
  setOnComplete(callback) {
    this.onComplete = callback;
  }

  /**
   * Set frame change callback
   * @param {Function} callback - Called when frame changes
   */
  setOnFrameChange(callback) {
    this.onFrameChange = callback;
  }

  // =====================
  // Static Helpers
  // =====================

  /**
   * Create animated sprite from config
   * @param {Image} spriteSheet - Sprite sheet image
   * @param {string} animationType - Animation type name
   */
  static createForAnimation(spriteSheet, animationType) {
    const configs = {
      idle: { frameCount: 4, frameRate: 8, loop: true },
      walk: { frameCount: 8, frameRate: 12, loop: true },
      attack: { frameCount: 6, frameRate: 12, loop: false },
      hit: { frameCount: 4, frameRate: 10, loop: false },
      death: { frameCount: 8, frameRate: 8, loop: false },
      victory: { frameCount: 8, frameRate: 10, loop: false },
      cast: { frameCount: 8, frameRate: 10, loop: false }
    };

    const config = configs[animationType] || configs.idle;

    // Auto-detect frame dimensions if spriteSheet is loaded
    let frameWidth = 64;
    let frameHeight = 64;

    if (spriteSheet && spriteSheet.width > 0) {
      const isVerticalStrip = spriteSheet.height >= spriteSheet.width * 2;
      if (isVerticalStrip) {
        frameWidth = spriteSheet.width;
        frameHeight = spriteSheet.width;
        config.frameCount = Math.max(1, Math.floor(spriteSheet.height / frameHeight));
        return new AnimatedSprite(spriteSheet, {
          frameWidth,
          frameHeight,
          ...config,
          layout: 'vertical-strip',
          directions: 8,
          mirrorByDirection: true
        });
      }

      frameWidth = spriteSheet.width / config.frameCount;
      frameHeight = spriteSheet.height / 8;
    }

    return new AnimatedSprite(spriteSheet, {
      frameWidth,
      frameHeight,
      ...config
    });
  }

  /**
   * Get direction name from index
   * @param {number} direction - Direction index
   */
  static getDirectionName(direction) {
    const names = ['South', 'Southwest', 'West', 'Northwest', 'North', 'Northeast', 'East', 'Southeast'];
    return names[direction % 8];
  }
}
