/**
 * WorldMapCharacter - Displays the party leader's character on the world map
 * Handles idle display, walking animations, and travel animations
 */

export class WorldMapCharacter {
  constructor(assetLoader) {
    this.assetLoader = assetLoader;

    // Character info
    this.character = null;
    this.characterClass = null;
    this.characterSprite = null;

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

    // Walking animation
    this.isWalking = false;
    this.walkPath = []; // Array of {x, y} positions
    this.walkPathIndex = 0;
    this.walkProgress = 0; // 0-1 progress between current and next position
    this.walkSpeed = 200; // Pixels per second
    this.walkFrame = 0;
    this.walkFrameTime = 0;
    this.walkFrameDuration = 150; // ms per walk frame
    this.facingRight = true;

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
      return;
    }

    this.character = character;
    this.characterClass = character.class;

    // Load character sprite
    try {
      this.characterSprite = await this.assetLoader.loadCharacterSprite(
        this.characterClass,
        'idle',
        'player'
      );
    } catch (error) {
      console.warn('Failed to load character sprite:', error);
      this.characterSprite = null;
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

    // Set initial position
    this.x = pathNodes[0].x;
    this.y = pathNodes[0].y;

    // Determine initial facing direction
    if (pathNodes.length > 1) {
      this.facingRight = pathNodes[1].x >= pathNodes[0].x;
    }
  }

  /**
   * Update animation state
   * @param {number} deltaTime - Time since last frame in ms
   */
  update(deltaTime) {
    // Update idle animation
    this.idlePhase += this.idleSpeed * deltaTime;
    if (this.idlePhase > Math.PI * 2) {
      this.idlePhase -= Math.PI * 2;
    }

    // Update walking animation
    if (this.isWalking && this.walkPath.length > 1) {
      this.updateWalking(deltaTime);
    }

    // Update dust particles
    this.updateDustParticles(deltaTime);
  }

  /**
   * Update walking animation
   */
  updateWalking(deltaTime) {
    const currentNode = this.walkPath[this.walkPathIndex];
    const nextNode = this.walkPath[this.walkPathIndex + 1];

    if (!nextNode) {
      // Reached end of path
      this.isWalking = false;
      this.x = currentNode.x;
      this.y = currentNode.y;
      if (this.onTravelComplete) {
        this.onTravelComplete();
        this.onTravelComplete = null;
      }
      return;
    }

    // Calculate distance between nodes
    const dx = nextNode.x - currentNode.x;
    const dy = nextNode.y - currentNode.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Update progress based on speed
    const progressDelta = (this.walkSpeed * deltaTime / 1000) / distance;
    this.walkProgress += progressDelta;

    // Update facing direction
    this.facingRight = dx >= 0;

    // Update walk frame
    this.walkFrameTime += deltaTime;
    if (this.walkFrameTime >= this.walkFrameDuration) {
      this.walkFrameTime = 0;
      this.walkFrame = (this.walkFrame + 1) % 4;

      // Spawn dust particle
      this.spawnDustParticle();
    }

    // Check if reached next node
    if (this.walkProgress >= 1) {
      this.walkProgress = 0;
      this.walkPathIndex++;

      // Brief pause at intermediate nodes
      if (this.walkPathIndex < this.walkPath.length - 1) {
        // Could add pause logic here if desired
      }
    }

    // Interpolate position
    this.x = currentNode.x + dx * this.walkProgress;
    this.y = currentNode.y + dy * this.walkProgress;
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
   */
  render(ctx, cameraX, cameraY) {
    if (!this.character) return;

    const screenX = this.x + cameraX;
    const screenY = this.y + cameraY;

    // Skip if off screen
    if (screenX < -50 || screenX > ctx.canvas.width + 50 ||
        screenY < -50 || screenY > ctx.canvas.height + 50) {
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
    const sprite = this.characterSprite;

    // Sprite sheets are vertical strips (64x512 = 8 frames stacked vertically)
    const frameWidth = sprite.width; // Full width (64px)
    const frameCount = 8;
    const frameHeight = sprite.height / frameCount; // 64px per frame

    // Calculate current frame based on animation
    let frameIndex = 0;
    if (this.isWalking) {
      frameIndex = this.walkFrame % frameCount;
    } else {
      // Idle animation - gentle breathing cycle (use first 4 frames for idle)
      frameIndex = Math.floor((this.idlePhase / (Math.PI * 2)) * 4) % 4;
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
    ctx.font = `bold ${this.size / 2}px serif`;
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
    const nodeProgress = this.walkPathIndex / (this.walkPath.length - 1);
    const segmentProgress = this.walkProgress / (this.walkPath.length - 1);
    return Math.min(1, nodeProgress + segmentProgress);
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
