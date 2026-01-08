import { AnimatedSprite } from '../core/AnimatedSprite.js';

/**
 * BattleUnit - Represents a unit in tactical combat
 *
 * Animation Architecture:
 * - Sprites for each animation state (idle, walk, attack, hit, death) are cached
 * - Direction is tracked independently and applied when switching animations
 * - Non-looping animations (attack, hit, death) use onComplete callbacks
 * - Fallback to colored circle if no sprite is available
 */
export class BattleUnit {
  constructor(unitData, grid) {
    this.id = unitData.id;
    this.type = unitData.type; // 'player' or 'enemy'
    this.name = unitData.name;
    this.class = unitData.class;
    this.enemyId = unitData.enemyId || null; // For enemy sprite lookup
    this.biome = unitData.biome || 'forest'; // For enemy sprite lookup

    // Stats
    this.hp = unitData.hp;
    this.maxHp = unitData.maxHp;
    this.mp = unitData.mp || 0;
    this.maxMp = unitData.maxMp || 0;
    this.strength = unitData.strength;
    this.intelligence = unitData.intelligence;
    this.agility = unitData.agility;

    // Grid position
    this.gridX = unitData.tileX;
    this.gridY = unitData.tileY;

    // Previous grid position (for direction calculation)
    this.prevGridX = this.gridX;
    this.prevGridY = this.gridY;

    // Screen position (for smooth movement)
    this.screenX = 0;
    this.screenY = 0;
    this.targetScreenX = 0;
    this.targetScreenY = 0;

    // Animation state
    this.isMoving = false;
    this.moveSpeed = 200; // pixels per second
    this.idleOffset = 0;
    this.idleTimer = Math.random() * Math.PI * 2; // Random start phase

    // Sprite animation system
    this.animationState = 'idle'; // idle, walk, attack, hit, death
    this.spriteCache = {}; // Cache of AnimatedSprite objects by animation state
    this.animatedSprite = null; // Current active sprite
    this.animationTimeout = null; // Timer for single-frame animation completion
    this.assetLoader = null;

    // Set initial facing direction based on unit type
    // Players spawn on left side, face East (toward enemies)
    // Enemies spawn on right side, face West (toward players)
    this.direction = this.type === 'player'
      ? AnimatedSprite.DIRECTIONS.EAST
      : AnimatedSprite.DIRECTIONS.WEST;

    // Battle state
    this.hasActed = unitData.hasActed || false;
    this.statusEffects = unitData.statusEffects || [];
    this.isSelected = false;
    this.isTargeted = false;

    // Charging state
    this.isCharging = unitData.isCharging || false;
    this.chargingSkill = unitData.chargingSkill || null;

    // Reference to grid for coordinate conversion
    this.grid = grid;

    // Initialize screen position
    this.updateScreenPosition();
  }

  /**
   * Set asset loader for sprite rendering
   */
  setAssetLoader(assetLoader) {
    this.assetLoader = assetLoader;
    this.initializeSprites();
  }

  /**
   * Initialize all animation sprites and cache them
   */
  initializeSprites() {
    if (!this.assetLoader) return;

    const animations = ['idle', 'walk', 'attack', 'hit', 'death'];

    for (const anim of animations) {
      const sprite = this.getSpriteForAnimation(anim);
      if (sprite) {
        const animatedSprite = this.createAnimatedSprite(sprite, anim);
        if (animatedSprite) {
          this.spriteCache[anim] = animatedSprite;
        }
      }
    }

    // Set the current sprite to idle
    this.setAnimationState('idle', true);

    // Log status for debugging
    const cachedAnims = Object.keys(this.spriteCache);
    if (cachedAnims.length > 0) {
      console.log(`[BattleUnit] ${this.name}: cached animations: [${cachedAnims.join(', ')}]`);
    } else {
      console.log(`[BattleUnit] ${this.name}: no animations cached, using fallback`);
    }
  }

  /**
   * Get sprite image for a specific animation
   */
  getSpriteForAnimation(animation) {
    if (this.type === 'player') {
      return this.assetLoader.getCharacterSprite(this.class?.toLowerCase(), animation, 'player');
    } else {
      const enemyId = this.enemyId || this.class?.toLowerCase() || 'monster';
      return this.assetLoader.getEnemySprite(enemyId, animation, this.biome);
    }
  }

  /**
   * Create an AnimatedSprite from a sprite image
   */
  createAnimatedSprite(sprite, animationType) {
    if (!sprite) return null;

    // Detect sprite sheet format
    const isVerticalSheet = sprite.height >= sprite.width * 7; // 8 directions stacked

    // Animation configuration based on type
    const animConfigs = {
      idle: { frameCount: 1, frameRate: 8, loop: true },
      walk: { frameCount: 1, frameRate: 12, loop: true },
      attack: { frameCount: 1, frameRate: 12, loop: false },
      hit: { frameCount: 1, frameRate: 10, loop: false },
      death: { frameCount: 1, frameRate: 8, loop: false }
    };

    const config = animConfigs[animationType] || animConfigs.idle;

    if (isVerticalSheet) {
      // Our generated sprites are vertical: 1 frame, 8 directions (e.g., 64x512)
      const frameHeight = sprite.height / 8;
      const animSprite = new AnimatedSprite(sprite, {
        frameWidth: sprite.width,
        frameHeight: frameHeight,
        frameCount: 1, // Single frame per direction
        frameRate: config.frameRate,
        loop: config.loop,
        directions: 8
      });
      animSprite.setDirection(this.direction);
      return animSprite;
    } else if (sprite.width > 128 && sprite.height > 128) {
      // Full sprite sheet: multiple frames and directions
      const animSprite = new AnimatedSprite(sprite, {
        frameWidth: sprite.width / config.frameCount,
        frameHeight: sprite.height / 8,
        frameCount: config.frameCount,
        frameRate: config.frameRate,
        loop: config.loop,
        directions: 8
      });
      animSprite.setDirection(this.direction);
      return animSprite;
    } else {
      // Single-frame sprite (non-directional)
      const animSprite = new AnimatedSprite(sprite, {
        frameWidth: sprite.width,
        frameHeight: sprite.height,
        frameCount: 1,
        frameRate: 8,
        loop: true,
        directions: 1
      });
      return animSprite;
    }
  }

  /**
   * Change animation state
   * @param {string} state - New animation state (idle, walk, attack, hit, death)
   * @param {boolean} force - Force the change even if already in this state
   */
  setAnimationState(state, force = false) {
    if (this.animationState === state && !force) return;

    this.animationState = state;

    // Clear any pending animation timeout
    if (this.animationTimeout) {
      clearTimeout(this.animationTimeout);
      this.animationTimeout = null;
    }

    // Try to use cached sprite
    if (this.spriteCache[state]) {
      this.animatedSprite = this.spriteCache[state];
      this.animatedSprite.setDirection(this.direction);
      this.animatedSprite.reset();
      this.animatedSprite.play();

      // For non-looping animations, set up completion handling
      if (!this.animatedSprite.loop) {
        // For single-frame sprites (our generated sprites), use timer-based completion
        // For multi-frame sprites, use frame-based completion
        const isSingleFrame = this.animatedSprite.frameCount <= 1;

        if (isSingleFrame) {
          // Use duration-based completion for single-frame animations
          const durations = { attack: 500, hit: 300, death: 800 };
          const duration = durations[state] || 500;

          this.animationTimeout = setTimeout(() => {
            this.animationTimeout = null;
            this.onAnimationComplete(state);
          }, duration);
        } else {
          // Use frame-based completion for multi-frame animations
          this.animatedSprite.setOnComplete(() => {
            this.onAnimationComplete(state);
          });
        }
      }
    } else {
      // Try to load sprite on-demand if not cached
      const sprite = this.getSpriteForAnimation(state);
      if (sprite) {
        const animSprite = this.createAnimatedSprite(sprite, state);
        if (animSprite) {
          this.spriteCache[state] = animSprite;
          this.animatedSprite = animSprite;
          this.animatedSprite.setDirection(this.direction);
          this.animatedSprite.play();

          if (!this.animatedSprite.loop) {
            const isSingleFrame = this.animatedSprite.frameCount <= 1;
            if (isSingleFrame) {
              const durations = { attack: 500, hit: 300, death: 800 };
              const duration = durations[state] || 500;
              this.animationTimeout = setTimeout(() => {
                this.animationTimeout = null;
                this.onAnimationComplete(state);
              }, duration);
            } else {
              this.animatedSprite.setOnComplete(() => {
                this.onAnimationComplete(state);
              });
            }
          }
        }
      }
      // If still no sprite, keep the previous one (or null)
      // The render function will use fallback
    }
  }

  /**
   * Called when a non-looping animation completes
   */
  onAnimationComplete(completedState) {
    // After attack or hit, return to idle
    if (completedState === 'attack' || completedState === 'hit') {
      this.setAnimationState('idle');
    }
    // Death animation stays on last frame (no transition)
  }

  /**
   * Update screen position from grid position (uses world coordinates)
   */
  updateScreenPosition() {
    const pos = this.grid.gridToScreenWorld(this.gridX, this.gridY);
    this.screenX = pos.x;
    this.screenY = pos.y;
    this.targetScreenX = pos.x;
    this.targetScreenY = pos.y;
  }

  /**
   * Start moving to a new grid position
   */
  moveTo(gridX, gridY) {
    // Store previous position for direction calculation
    this.prevGridX = this.gridX;
    this.prevGridY = this.gridY;

    this.gridX = gridX;
    this.gridY = gridY;
    const target = this.grid.gridToScreenWorld(gridX, gridY);
    this.targetScreenX = target.x;
    this.targetScreenY = target.y;
    this.isMoving = true;

    // Update direction based on movement
    this.updateDirectionFromMovement();
    this.setAnimationState('walk');
  }

  /**
   * Update facing direction based on movement
   */
  updateDirectionFromMovement() {
    const newDirection = this.calculateDirection(
      this.gridX - this.prevGridX,
      this.gridY - this.prevGridY
    );
    this.setDirection(newDirection);
  }

  /**
   * Face toward a target position
   */
  faceToward(targetX, targetY) {
    const dx = targetX - this.gridX;
    const dy = targetY - this.gridY;

    // Only update if there's an actual direction to face
    if (dx !== 0 || dy !== 0) {
      const newDirection = this.calculateDirection(dx, dy);
      this.setDirection(newDirection);
    }
  }

  /**
   * Set direction directly
   * @param {number} direction - Direction constant from AnimatedSprite.DIRECTIONS
   */
  setDirection(direction) {
    // Validate direction
    if (typeof direction !== 'number' || isNaN(direction)) {
      return; // Keep current direction
    }

    this.direction = Math.floor(Math.abs(direction)) % 8;

    // Update current sprite direction
    if (this.animatedSprite) {
      this.animatedSprite.setDirection(this.direction);
    }

    // Also update all cached sprites so they're ready when switched to
    for (const sprite of Object.values(this.spriteCache)) {
      sprite.setDirection(this.direction);
    }
  }

  /**
   * Calculate direction from grid movement delta
   */
  calculateDirection(dx, dy) {
    // For isometric grid: +X is SE, +Y is SW, -X is NW, -Y is NE
    if (dx > 0 && dy === 0) return AnimatedSprite.DIRECTIONS.SOUTHEAST;
    if (dx > 0 && dy > 0) return AnimatedSprite.DIRECTIONS.SOUTH;
    if (dx === 0 && dy > 0) return AnimatedSprite.DIRECTIONS.SOUTHWEST;
    if (dx < 0 && dy > 0) return AnimatedSprite.DIRECTIONS.WEST;
    if (dx < 0 && dy === 0) return AnimatedSprite.DIRECTIONS.NORTHWEST;
    if (dx < 0 && dy < 0) return AnimatedSprite.DIRECTIONS.NORTH;
    if (dx === 0 && dy < 0) return AnimatedSprite.DIRECTIONS.NORTHEAST;
    if (dx > 0 && dy < 0) return AnimatedSprite.DIRECTIONS.EAST;
    return this.direction; // No change if no movement
  }

  /**
   * Instantly set position (no animation)
   */
  setPosition(gridX, gridY) {
    this.gridX = gridX;
    this.gridY = gridY;
    this.updateScreenPosition();
    this.isMoving = false;
  }

  /**
   * Update unit state (called each frame)
   */
  update(deltaTime) {
    // Idle bobbing animation (for fallback circle)
    this.idleTimer += deltaTime * 2;
    this.idleOffset = Math.sin(this.idleTimer) * 2;

    // Update current animated sprite
    if (this.animatedSprite) {
      this.animatedSprite.update(deltaTime * 1000); // Convert to ms
    }

    // Movement interpolation
    if (this.isMoving) {
      const dx = this.targetScreenX - this.screenX;
      const dy = this.targetScreenY - this.screenY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < this.moveSpeed * deltaTime) {
        this.screenX = this.targetScreenX;
        this.screenY = this.targetScreenY;
        this.isMoving = false;
        // Return to idle animation when movement completes
        this.setAnimationState('idle');
      } else {
        this.screenX += (dx / dist) * this.moveSpeed * deltaTime;
        this.screenY += (dy / dist) * this.moveSpeed * deltaTime;
      }
    }
  }

  /**
   * Play attack animation
   * @param {number} targetX - Target grid X to face toward
   * @param {number} targetY - Target grid Y to face toward
   */
  playAttackAnimation(targetX, targetY) {
    this.faceToward(targetX, targetY);
    this.setAnimationState('attack');

    // If no sprite exists at all, use a timeout to return to idle
    if (!this.animatedSprite && !this.spriteCache['attack']) {
      setTimeout(() => {
        if (this.animationState === 'attack') {
          this.setAnimationState('idle');
        }
      }, 500);
    }
  }

  /**
   * Play hit reaction animation
   */
  playHitAnimation() {
    this.setAnimationState('hit');

    // If no sprite exists at all, use a timeout to return to idle
    if (!this.animatedSprite && !this.spriteCache['hit']) {
      setTimeout(() => {
        if (this.animationState === 'hit') {
          this.setAnimationState('idle');
        }
      }, 300);
    }
  }

  /**
   * Play death animation
   */
  playDeathAnimation() {
    this.setAnimationState('death');
  }

  /**
   * Apply damage to unit
   */
  takeDamage(amount) {
    this.hp = Math.max(0, this.hp - amount);
    return this.hp <= 0;
  }

  /**
   * Heal unit
   */
  heal(amount) {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  /**
   * Check if unit is alive
   */
  isAlive() {
    return this.hp > 0;
  }

  /**
   * Get class icon for display
   */
  getClassIcon() {
    const icons = {
      warrior: 'W',
      wizard: 'M',
      monk: 'K',
      chemist: 'C',
      monster: 'E',
      berserker: 'B',
      sorcerer: 'S',
      ninja: 'N',
      alchemist: 'A'
    };
    return icons[this.class?.toLowerCase()] || '?';
  }

  /**
   * Get unit color based on type
   */
  getColor() {
    if (!this.isAlive()) return '#555555';
    return this.type === 'player' ? '#4a90d9' : '#d94a4a';
  }

  /**
   * Get highlight color based on type
   */
  getHighlightColor() {
    if (!this.isAlive()) return '#777777';
    return this.type === 'player' ? '#6ab0f3' : '#f36a6a';
  }

  /**
   * Render the unit
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {BattleCamera} camera - Optional camera for world-to-screen transform
   */
  render(ctx, camera = null) {
    // Get screen position from world position
    let drawX = this.screenX;
    let drawY = this.screenY;

    if (camera) {
      // Skip rendering if off-screen
      const visible = camera.isVisible(this.screenX, this.screenY, 40, 80);
      if (!visible) {
        return;
      }
      const screenPos = camera.worldToScreen(this.screenX, this.screenY);
      drawX = screenPos.x;
      drawY = screenPos.y;
    }

    const unitRadius = 16;

    // Draw shadow
    ctx.beginPath();
    ctx.ellipse(drawX, drawY + 4, unitRadius * 0.8, unitRadius * 0.3, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fill();

    // Try to render animated sprite
    if (this.animatedSprite && this.animatedSprite.spriteSheet) {
      // AnimatedSprite.draw() centers on x and draws upward from y
      this.animatedSprite.draw(ctx, drawX, drawY);
    } else {
      // Fallback: Draw colored circle with letter
      const renderY = drawY - 32 + (this.isMoving ? 0 : this.idleOffset);

      // Draw unit body (colored circle)
      ctx.beginPath();
      ctx.arc(drawX, renderY, unitRadius, 0, Math.PI * 2);
      ctx.fillStyle = this.getColor();
      ctx.fill();

      // Draw border
      ctx.strokeStyle = this.getHighlightColor();
      ctx.lineWidth = this.isSelected ? 3 : 2;
      ctx.stroke();

      // Draw class icon
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.getClassIcon(), drawX, renderY);
    }

    // Calculate renderY for UI elements
    const renderY = drawY - 32;

    // Draw selection ring
    if (this.isSelected) {
      ctx.beginPath();
      ctx.arc(drawX, renderY, unitRadius + 4, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Draw target indicator
    if (this.isTargeted) {
      ctx.beginPath();
      ctx.arc(drawX, renderY, unitRadius + 6, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff4444';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw HP bar
    this.renderHPBar(ctx, drawX, renderY - unitRadius - 8);

    // Draw charging bar if charging
    if (this.isCharging && this.chargingSkill) {
      this.renderChargingBar(ctx, drawX, renderY - unitRadius - 16);
    }

    // Draw status effect icons
    if (this.statusEffects.length > 0) {
      this.renderStatusEffects(ctx, drawX, renderY + unitRadius + 8);
    }

    // Draw name on hover/select
    if (this.isSelected || this.isTargeted) {
      ctx.fillStyle = '#fff';
      ctx.font = '11px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(this.name, drawX, renderY - unitRadius - 20);
    }
  }

  /**
   * Render HP bar above unit
   */
  renderHPBar(ctx, x, y) {
    const width = 32;
    const height = 4;
    const hpPercent = this.hp / this.maxHp;

    // Background
    ctx.fillStyle = '#333';
    ctx.fillRect(x - width / 2, y, width, height);

    // HP fill
    let hpColor = '#4caf50'; // Green
    if (hpPercent <= 0.5) hpColor = '#ff9800'; // Orange
    if (hpPercent <= 0.25) hpColor = '#f44336'; // Red

    ctx.fillStyle = hpColor;
    ctx.fillRect(x - width / 2, y, width * hpPercent, height);

    // Border
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - width / 2, y, width, height);
  }

  /**
   * Render charging bar above HP bar
   */
  renderChargingBar(ctx, x, y) {
    if (!this.chargingSkill) return;

    const width = 32;
    const height = 4;
    const chargeProgress = 1 - (this.chargingSkill.chargeRemaining / this.chargingSkill.chargeTime);
    const clampedProgress = Math.max(0, Math.min(1, chargeProgress));

    // Background
    ctx.fillStyle = '#1a1a3a';
    ctx.fillRect(x - width / 2, y, width, height);

    // Charge fill (purple gradient effect)
    const gradient = ctx.createLinearGradient(x - width / 2, y, x + width / 2, y);
    gradient.addColorStop(0, '#7c3aed');
    gradient.addColorStop(1, '#a855f7');
    ctx.fillStyle = gradient;
    ctx.fillRect(x - width / 2, y, width * clampedProgress, height);

    // Border
    ctx.strokeStyle = '#9333ea';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - width / 2, y, width, height);

    // "Charging..." text
    ctx.fillStyle = '#d8b4fe';
    ctx.font = '8px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Charging...', x, y - 2);
  }

  /**
   * Render status effect icons
   */
  renderStatusEffects(ctx, x, y) {
    const iconSize = 12;
    const spacing = 14;
    const startX = x - ((this.statusEffects.length - 1) * spacing) / 2;

    const effectColors = {
      poison: '#9c27b0',
      burn: '#ff5722',
      freeze: '#03a9f4',
      stun: '#ffeb3b',
      slow: '#607d8b',
      blind: '#424242',
      silence: '#e91e63'
    };

    this.statusEffects.forEach((effect, i) => {
      const effectX = startX + i * spacing;
      ctx.beginPath();
      ctx.arc(effectX, y, iconSize / 2, 0, Math.PI * 2);
      ctx.fillStyle = effectColors[effect.type] || '#888';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }

  /**
   * Get distance to another unit (Manhattan distance)
   */
  distanceTo(other) {
    return Math.abs(this.gridX - other.gridX) + Math.abs(this.gridY - other.gridY);
  }

  /**
   * Check if this unit can attack a target at given position
   */
  canAttack(targetX, targetY, attackRange = 1) {
    const distance = Math.abs(this.gridX - targetX) + Math.abs(this.gridY - targetY);
    return distance <= attackRange && distance > 0;
  }
}
