import { AnimatedSprite } from '../core/AnimatedSprite.js';

/**
 * BattleUnit - Represents a unit in tactical combat
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

    // Sprite animation state
    this.animationState = 'idle'; // idle, walk, attack, hit, death
    this.animatedSprite = null;
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
    this.initializeSprite();
  }

  /**
   * Initialize animated sprite
   */
  initializeSprite() {
    if (!this.assetLoader) return;

    // Get sprite sheet based on unit type
    let sprite;
    if (this.type === 'player') {
      sprite = this.assetLoader.getCharacterSprite(this.class?.toLowerCase(), 'idle', 'player');
    } else {
      const enemyId = this.enemyId || this.class?.toLowerCase() || 'monster';
      sprite = this.assetLoader.getEnemySprite(enemyId, 'idle', this.biome);
    }

    if (sprite) {
      this.animatedSprite = new AnimatedSprite(sprite, {
        frameWidth: sprite.width / 8, // Assuming 8 frames per animation
        frameHeight: sprite.height / 8, // 8 directions
        frameCount: 8,
        frameDuration: 150,
        loop: true
      });
      this.animatedSprite.setDirection(this.direction);
      this.animatedSprite.play();
    }
  }

  /**
   * Change animation state
   */
  setAnimationState(state) {
    if (this.animationState === state) return;
    this.animationState = state;

    if (!this.assetLoader) return;

    // Load new sprite for animation state
    let sprite;
    if (this.type === 'player') {
      sprite = this.assetLoader.getCharacterSprite(this.class?.toLowerCase(), state, 'player');
    } else {
      const enemyId = this.enemyId || this.class?.toLowerCase() || 'monster';
      sprite = this.assetLoader.getEnemySprite(enemyId, state, this.biome);
    }

    if (sprite) {
      const frameCount = state === 'idle' ? 4 : (state === 'walk' ? 8 : 6);
      const loop = state === 'idle' || state === 'walk';

      this.animatedSprite = new AnimatedSprite(sprite, {
        frameWidth: sprite.width / frameCount,
        frameHeight: sprite.height / 8,
        frameCount: frameCount,
        frameDuration: state === 'attack' ? 100 : 150,
        loop: loop
      });
      this.animatedSprite.setDirection(this.direction);
      this.animatedSprite.play();
    }
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
    if (this.animatedSprite) {
      this.direction = this.animatedSprite.setDirectionFromGridMovement(
        this.prevGridX, this.prevGridY,
        this.gridX, this.gridY
      );
    }
  }

  /**
   * Face toward a target position
   */
  faceToward(targetX, targetY) {
    if (this.animatedSprite) {
      this.direction = this.animatedSprite.setDirectionFromGridMovement(
        this.gridX, this.gridY,
        targetX, targetY
      );
    } else {
      // Calculate direction even without sprite for when sprite loads later
      const dx = targetX - this.gridX;
      const dy = targetY - this.gridY;
      this.direction = this.calculateDirection(dx, dy);
    }
  }

  /**
   * Set direction directly
   * @param {number} direction - Direction constant from AnimatedSprite.DIRECTIONS
   */
  setDirection(direction) {
    this.direction = direction;
    if (this.animatedSprite) {
      this.animatedSprite.setDirection(direction);
    }
  }

  /**
   * Calculate direction from grid movement delta
   * Used when sprite is not yet loaded
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
    // Idle bobbing animation (only when not using sprites)
    this.idleTimer += deltaTime * 2;
    this.idleOffset = Math.sin(this.idleTimer) * 2;

    // Update animated sprite
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
   */
  playAttackAnimation(targetX, targetY) {
    this.faceToward(targetX, targetY);
    this.setAnimationState('attack');

    // Return to idle after attack animation completes
    setTimeout(() => {
      if (this.animationState === 'attack') {
        this.setAnimationState('idle');
      }
    }, 600);
  }

  /**
   * Play hit reaction animation
   */
  playHitAnimation() {
    this.setAnimationState('hit');

    // Return to idle after hit animation completes
    setTimeout(() => {
      if (this.animationState === 'hit') {
        this.setAnimationState('idle');
      }
    }, 400);
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
      if (!camera.isVisible(this.screenX, this.screenY, 40, 80)) {
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
    if (this.animatedSprite && this.animatedSprite.image) {
      // Draw sprite centered on position, offset upward
      const spriteHeight = this.animatedSprite.frameHeight || 64;
      const spriteWidth = this.animatedSprite.frameWidth || 64;
      this.animatedSprite.draw(ctx, drawX - spriteWidth / 2, drawY - spriteHeight + 16);
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
