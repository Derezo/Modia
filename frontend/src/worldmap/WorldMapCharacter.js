/**
 * WorldMapCharacter - Displays the party leader's character on the world map
 * Handles idle display, walking animations, and travel animations
 * Character follows spline curves matching the visual path rendering
 */

import { generatePathControlPoints, generateSplinePoints } from './PathRenderer.js';
import { advanceIdleFrame } from '../core/CharacterAnimationTiming.js';
import { responsive } from '../core/Responsive.js';

export class WorldMapCharacter {
  constructor(assetLoader) {
    this.assetLoader = assetLoader;

    // Character info
    this.character = null;
    this.characterClass = null;
    this.characterSprite = null;
    this.characterSprites = { idle: null, walk: null };

    // Position (world coordinates)
    this.x = 0;
    this.y = 0;

    // Display settings
    this.size = 40; // Character sprite size on map
    this.shadowOffset = 3;

    // Animation state
    this.idlePhase = 0;
    this.idleSpeed = 0.003; // Idle bobbing speed
    this.idleBobAmount = 2; // Pixels to bob up/down
    this.idleFrame = 0;
    this.idleFrameTime = 0;

    // Walking animation
    this.isWalking = false;
    this.walkPath = []; // Array of {x, y, id} positions
    this.walkPathIndex = 0;
    this.walkProgress = 0; // 0-1 progress along current spline segment
    this.walkSpeed = 200; // Pixels per second
    this.walkFrame = 0;
    this.walkFrameTime = 0;
    this.walkFrameDuration = 150; // ms per walk frame
    this.facingRight = true;

    // Spline-following data
    this.splineSegments = []; // Array of {points: [], lengths: [], totalLength: number}
    this.currentSegmentIndex = 0;

    // Travel completion callback
    this.onTravelComplete = null;

    // Dust particles
    this.dustParticles = [];
  }

  /**
   * Set the party leader character to display
   * @param {Object} character - Character data with class, race, etc.
   */
  async setCharacter(character) {
    if (!character) {
      this.character = null;
      this.characterSprite = null;
      this.characterSprites = { idle: null, walk: null };
      return;
    }

    this.character = character;
    this.characterClass = character.class;

    // Load the portrait-matched idle and walk strips. Class-only assets remain
    // an AssetLoader migration fallback until every variant is generated.
    try {
      const [idle, walk] = await Promise.all([
        this.assetLoader.loadCharacterSprite(character, 'idle', 'player'),
        this.assetLoader.loadCharacterSprite(character, 'walk', 'player')
      ]);
      this.characterSprites = { idle, walk: walk || idle };
      this.characterSprite = idle || walk;
    } catch (error) {
      console.warn('Failed to load character sprite:', error);
      this.characterSprite = null;
      this.characterSprites = { idle: null, walk: null };
    }
  }

  /**
   * Set the character position (world coordinates, not screen)
   * @param {number} x - World X coordinate
   * @param {number} y - World Y coordinate
   */
  setPosition(x, y) {
    this.x = x;
    this.y = y;
  }

  /**
   * Start walking animation along a path
   * @param {Array} pathNodes - Array of {x, y, id} positions to walk through
   * @param {Function} onComplete - Callback when travel is complete
   */
  startWalking(pathNodes, onComplete = null) {
    if (pathNodes.length < 2) {
      if (onComplete) onComplete();
      return;
    }

    this.walkPath = pathNodes;
    this.walkPathIndex = 0;
    this.walkProgress = 0;
    this.isWalking = true;
    this.onTravelComplete = onComplete;

    // Precompute spline segments for smooth curve following
    this.precomputeSplineSegments(pathNodes);
    this.currentSegmentIndex = 0;

    // Set initial position
    this.x = pathNodes[0].x;
    this.y = pathNodes[0].y;

    // Determine initial facing direction
    if (pathNodes.length > 1) {
      this.facingRight = pathNodes[1].x >= pathNodes[0].x;
    }
  }

  /**
   * Precompute spline segments for the entire walk path
   * @param {Array} pathNodes - Array of {x, y, id} positions
   */
  precomputeSplineSegments(pathNodes) {
    this.splineSegments = [];

    for (let i = 0; i < pathNodes.length - 1; i++) {
      const fromNode = pathNodes[i];
      const toNode = pathNodes[i + 1];

      // CRITICAL: Always generate the spline in NORMALIZED direction (smaller ID first)
      // This ensures both travel directions use the exact same visual curve.
      // The S-curve offset direction depends on the tangent vector, which would flip
      // if we generated from the opposite direction, creating a different curve.
      const needsReverse = fromNode.id > toNode.id;
      const startNode = needsReverse ? toNode : fromNode;
      const endNode = needsReverse ? fromNode : toNode;

      // Generate spline using PathRenderer functions (same as visual path rendering)
      const controlPoints = generatePathControlPoints(
        startNode.x, startNode.y,
        endNode.x, endNode.y,
        startNode.id, endNode.id
      );

      // Generate smooth spline points
      let splinePoints = generateSplinePoints(controlPoints, 10);

      // If traveling from higher ID to lower ID, reverse the points
      // so we walk from fromNode to toNode along the same curve
      if (needsReverse) {
        splinePoints = [...splinePoints].reverse();
      }

      // Calculate arc lengths for constant-speed interpolation
      const lengths = this.calculateSegmentLengths(splinePoints);

      this.splineSegments.push({
        points: splinePoints,
        lengths: lengths,
        totalLength: lengths.reduce((a, b) => a + b, 0)
      });
    }
  }

  /**
   * Calculate distances between consecutive spline points
   * @param {Array} points - Array of {x, y} points
   * @returns {Array} Array of distances
   */
  calculateSegmentLengths(points) {
    const lengths = [];
    for (let i = 0; i < points.length - 1; i++) {
      const dx = points[i + 1].x - points[i].x;
      const dy = points[i + 1].y - points[i].y;
      lengths.push(Math.sqrt(dx * dx + dy * dy));
    }
    return lengths;
  }

  /**
   * Update animation state
   * @param {number} deltaTime - Time since last frame in ms
   */
  update(deltaTime) {
    // Keep gentle positional bobbing independent from the deliberately slow
    // authored idle pose transitions.
    this.idlePhase += this.idleSpeed * deltaTime;
    if (this.idlePhase > Math.PI * 2) {
      this.idlePhase -= Math.PI * 2;
    }
    if (!this.isWalking) {
      const nextIdle = advanceIdleFrame(this.idleFrame, this.idleFrameTime, deltaTime);
      this.idleFrame = nextIdle.frame;
      this.idleFrameTime = nextIdle.elapsedMs;
    }

    // Update walking animation
    if (this.isWalking && this.walkPath.length > 1) {
      this.updateWalking(deltaTime);
    }

    // Update dust particles
    this.updateDustParticles(deltaTime);
  }

  /**
   * Update walking animation - follows spline curves
   */
  updateWalking(deltaTime) {
    // Check if we've completed all segments
    if (this.currentSegmentIndex >= this.splineSegments.length) {
      // Reached end of path
      this.isWalking = false;
      const lastNode = this.walkPath[this.walkPath.length - 1];
      this.x = lastNode.x;
      this.y = lastNode.y;
      if (this.onTravelComplete) {
        this.onTravelComplete();
        this.onTravelComplete = null;
      }
      return;
    }

    const segment = this.splineSegments[this.currentSegmentIndex];

    // Handle zero-length segments (shouldn't happen, but be safe)
    if (segment.totalLength < 1) {
      this.walkProgress = 0;
      this.currentSegmentIndex++;
      this.walkPathIndex++;
      return;
    }

    // Calculate distance to travel this frame
    const distanceToTravel = this.walkSpeed * deltaTime / 1000;

    // Update progress along current segment (0-1)
    const progressDelta = distanceToTravel / segment.totalLength;
    this.walkProgress += progressDelta;

    // Update walk frame animation
    this.walkFrameTime += deltaTime;
    if (this.walkFrameTime >= this.walkFrameDuration) {
      this.walkFrameTime = 0;
      this.walkFrame = (this.walkFrame + 1) % 4;
      this.spawnDustParticle();
    }

    // Check if we've completed current segment
    if (this.walkProgress >= 1) {
      this.walkProgress = 0;
      this.currentSegmentIndex++;
      this.walkPathIndex++;
      return; // Will continue next frame from new segment
    }

    // Get interpolated position and angle along the spline
    const { x, y, angle } = this.getSplinePosition(segment, this.walkProgress);
    this.x = x;
    this.y = y;

    // Update facing direction based on movement angle
    this.facingRight = Math.cos(angle) >= 0;
  }

  /**
   * Get position and angle at a given progress along a spline segment
   * @param {Object} segment - Spline segment with points, lengths, totalLength
   * @param {number} progress - Progress along segment (0-1)
   * @returns {{x: number, y: number, angle: number}}
   */
  getSplinePosition(segment, progress) {
    const { points, lengths, totalLength } = segment;

    if (points.length < 2) {
      return { x: points[0]?.x || 0, y: points[0]?.y || 0, angle: 0 };
    }

    // Target distance along the spline
    const targetDistance = progress * totalLength;

    // Find which sub-segment we're in
    let accumulatedLength = 0;
    let subSegmentIndex = 0;

    for (let i = 0; i < lengths.length; i++) {
      if (accumulatedLength + lengths[i] >= targetDistance) {
        subSegmentIndex = i;
        break;
      }
      accumulatedLength += lengths[i];
      subSegmentIndex = i;
    }

    // Clamp to valid range
    subSegmentIndex = Math.min(subSegmentIndex, points.length - 2);

    // Interpolate within sub-segment
    const remainingDistance = targetDistance - accumulatedLength;
    const segmentLength = lengths[subSegmentIndex] || 1;
    const subProgress = Math.min(1, Math.max(0, remainingDistance / segmentLength));

    const p1 = points[subSegmentIndex];
    const p2 = points[subSegmentIndex + 1] || p1;

    const x = p1.x + (p2.x - p1.x) * subProgress;
    const y = p1.y + (p2.y - p1.y) * subProgress;
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

    return { x, y, angle };
  }

  /**
   * Spawn a dust particle behind the character
   */
  spawnDustParticle() {
    const offsetX = this.facingRight ? -10 : 10;
    this.dustParticles.push({
      x: this.x + offsetX + (Math.random() - 0.5) * 10,
      y: this.y + 15,
      vx: (Math.random() - 0.5) * 20,
      vy: -Math.random() * 15 - 5,
      size: 3 + Math.random() * 4,
      alpha: 0.6,
      life: 500
    });
  }

  /**
   * Update dust particles
   */
  updateDustParticles(deltaTime) {
    for (let i = this.dustParticles.length - 1; i >= 0; i--) {
      const p = this.dustParticles[i];
      p.life -= deltaTime;
      p.x += p.vx * deltaTime / 1000;
      p.y += p.vy * deltaTime / 1000;
      p.vy += 30 * deltaTime / 1000; // Gravity
      p.alpha = Math.max(0, p.alpha - deltaTime / 500);
      p.size *= 1 + deltaTime / 2000;

      if (p.life <= 0 || p.alpha <= 0) {
        this.dustParticles.splice(i, 1);
      }
    }
  }

  /**
   * Render the character
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {number} cameraX - Camera X offset
   * @param {number} cameraY - Camera Y offset
   * @param {number} canvasWidth - Logical canvas width
   * @param {number} canvasHeight - Logical canvas height
   */
  render(ctx, cameraX, cameraY, canvasWidth, canvasHeight) {
    if (!this.character) return;

    const screenX = this.x + cameraX;
    const screenY = this.y + cameraY;

    // Skip if off screen
    if (screenX < -50 || screenX > canvasWidth + 50 ||
        screenY < -50 || screenY > canvasHeight + 50) {
      return;
    }

    // Render dust particles behind character
    this.renderDustParticles(ctx, cameraX, cameraY);

    // Calculate idle bob
    const idleBob = this.isWalking ? 0 : Math.sin(this.idlePhase) * this.idleBobAmount;
    const renderY = screenY - idleBob;

    // Draw shadow
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(
      screenX,
      screenY + this.size / 2 - 2,
      this.size / 2.5,
      this.size / 6,
      0, 0, Math.PI * 2
    );
    ctx.fill();
    ctx.restore();

    // Try to render sprite, fall back to colored circle if not available
    if (this.characterSprite) {
      this.renderSprite(ctx, screenX, renderY);
    } else {
      this.renderFallback(ctx, screenX, renderY);
    }
  }

  /**
   * Render the character sprite
   */
  renderSprite(ctx, screenX, screenY) {
    const sprite = this.isWalking
      ? (this.characterSprites.walk || this.characterSprite)
      : (this.characterSprites.idle || this.characterSprite);

    // Sprite sheets are vertical strips (64x512 = 8 frames stacked vertically)
    const frameWidth = sprite.width; // Full width (64px)
    const frameCount = 8;
    const frameHeight = sprite.height / frameCount; // 64px per frame

    // Calculate current frame based on animation
    let frameIndex = 0;
    if (this.isWalking) {
      frameIndex = this.walkFrame % frameCount;
    } else {
      frameIndex = this.idleFrame % frameCount;
    }

    const sourceX = 0;
    const sourceY = frameIndex * frameHeight;

    ctx.save();

    // Flip sprite if facing left
    if (!this.facingRight) {
      ctx.translate(screenX, screenY);
      ctx.scale(-1, 1);
      ctx.drawImage(
        sprite,
        sourceX, sourceY, frameWidth, frameHeight,
        -this.size / 2, -this.size / 2, this.size, this.size
      );
    } else {
      ctx.drawImage(
        sprite,
        sourceX, sourceY, frameWidth, frameHeight,
        screenX - this.size / 2, screenY - this.size / 2, this.size, this.size
      );
    }

    ctx.restore();
  }

  /**
   * Render dust particles
   */
  renderDustParticles(ctx, cameraX, cameraY) {
    ctx.save();
    for (const p of this.dustParticles) {
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = '#c4a574'; // Dusty brown color
      ctx.beginPath();
      ctx.arc(p.x + cameraX, p.y + cameraY, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * Render fallback when sprite is not available
   */
  renderFallback(ctx, screenX, screenY) {
    // Class colors
    const classColors = {
      warrior: '#c23c3c',
      wizard: '#4a6fd9',
      monk: '#d9a93c',
      chemist: '#3cb371'
    };

    const color = classColors[this.characterClass] || '#888888';

    // Draw circle body
    ctx.beginPath();
    ctx.arc(screenX, screenY, this.size / 2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw class initial
    ctx.fillStyle = '#fff';
    const fontSize = Math.max(responsive.getCanvasFontSize('sm'), this.size / 2);
    ctx.font = `bold ${fontSize}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      (this.characterClass || 'X')[0].toUpperCase(),
      screenX,
      screenY
    );
  }

  /**
   * Check if currently traveling
   * @returns {boolean}
   */
  isTraveling() {
    return this.isWalking;
  }

  /**
   * Get current travel progress (0-1)
   * @returns {number}
   */
  getTravelProgress() {
    if (!this.isWalking || this.walkPath.length === 0) return 0;
    const totalSegments = this.walkPath.length - 1;
    if (totalSegments <= 0) return 0;
    // walkPathIndex is the completed segment count, walkProgress is 0-1 within current segment
    return Math.min(1, (this.walkPathIndex + this.walkProgress) / totalSegments);
  }

  /**
   * Get current node in travel path
   * @returns {Object|null}
   */
  getCurrentTravelNode() {
    if (!this.isWalking || this.walkPathIndex >= this.walkPath.length) return null;
    return this.walkPath[this.walkPathIndex];
  }
}
