/**
 * BattleUnit - Represents a unit in tactical combat
 */
export class BattleUnit {
  constructor(unitData, grid) {
    this.id = unitData.id;
    this.type = unitData.type; // 'player' or 'enemy'
    this.name = unitData.name;
    this.class = unitData.class;

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
   * Update screen position from grid position
   */
  updateScreenPosition() {
    const pos = this.grid.gridToScreen(this.gridX, this.gridY);
    this.screenX = pos.x;
    this.screenY = pos.y;
    this.targetScreenX = pos.x;
    this.targetScreenY = pos.y;
  }

  /**
   * Start moving to a new grid position
   */
  moveTo(gridX, gridY) {
    this.gridX = gridX;
    this.gridY = gridY;
    const target = this.grid.gridToScreen(gridX, gridY);
    this.targetScreenX = target.x;
    this.targetScreenY = target.y;
    this.isMoving = true;
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
    // Idle bobbing animation
    this.idleTimer += deltaTime * 2;
    this.idleOffset = Math.sin(this.idleTimer) * 2;

    // Movement interpolation
    if (this.isMoving) {
      const dx = this.targetScreenX - this.screenX;
      const dy = this.targetScreenY - this.screenY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < this.moveSpeed * deltaTime) {
        this.screenX = this.targetScreenX;
        this.screenY = this.targetScreenY;
        this.isMoving = false;
      } else {
        this.screenX += (dx / dist) * this.moveSpeed * deltaTime;
        this.screenY += (dy / dist) * this.moveSpeed * deltaTime;
      }
    }
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
   */
  render(ctx) {
    const renderY = this.screenY - 32 + (this.isMoving ? 0 : this.idleOffset);
    const unitRadius = 16;

    // Draw shadow
    ctx.beginPath();
    ctx.ellipse(this.screenX, this.screenY + 4, unitRadius * 0.8, unitRadius * 0.3, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fill();

    // Draw unit body (colored circle)
    ctx.beginPath();
    ctx.arc(this.screenX, renderY, unitRadius, 0, Math.PI * 2);
    ctx.fillStyle = this.getColor();
    ctx.fill();

    // Draw border
    ctx.strokeStyle = this.getHighlightColor();
    ctx.lineWidth = this.isSelected ? 3 : 2;
    ctx.stroke();

    // Draw selection ring
    if (this.isSelected) {
      ctx.beginPath();
      ctx.arc(this.screenX, renderY, unitRadius + 4, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Draw target indicator
    if (this.isTargeted) {
      ctx.beginPath();
      ctx.arc(this.screenX, renderY, unitRadius + 6, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff4444';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw class icon
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.getClassIcon(), this.screenX, renderY);

    // Draw HP bar
    this.renderHPBar(ctx, this.screenX, renderY - unitRadius - 8);

    // Draw status effect icons
    if (this.statusEffects.length > 0) {
      this.renderStatusEffects(ctx, this.screenX, renderY + unitRadius + 8);
    }

    // Draw name on hover/select
    if (this.isSelected || this.isTargeted) {
      ctx.fillStyle = '#fff';
      ctx.font = '11px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(this.name, this.screenX, renderY - unitRadius - 20);
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
