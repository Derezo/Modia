/**
 * BattleAnimations - Visual effects for tactical combat
 */
export class BattleAnimations {
  constructor() {
    this.animations = [];
  }

  /**
   * Add a damage number animation
   */
  addDamageNumber(x, y, damage, isCritical = false) {
    this.animations.push({
      type: 'damage',
      x,
      y,
      startY: y,
      value: damage,
      isCritical,
      timer: 0,
      duration: 1.2,
      velocityY: -80,
      scale: isCritical ? 1.5 : 1.0
    });
  }

  /**
   * Add a heal number animation
   */
  addHealNumber(x, y, amount) {
    this.animations.push({
      type: 'heal',
      x,
      y,
      startY: y,
      value: amount,
      timer: 0,
      duration: 1.2,
      velocityY: -60
    });
  }

  /**
   * Add a miss text animation
   */
  addMiss(x, y) {
    this.animations.push({
      type: 'miss',
      x,
      y,
      startY: y,
      timer: 0,
      duration: 1.0,
      velocityY: -40
    });
  }

  /**
   * Add a status effect applied animation
   */
  addStatusEffect(x, y, effectName) {
    this.animations.push({
      type: 'status',
      x,
      y,
      startY: y,
      value: effectName,
      timer: 0,
      duration: 1.5,
      velocityY: -30
    });
  }

  /**
   * Add a flash effect on a unit
   */
  addFlash(x, y, color = '#ffffff') {
    this.animations.push({
      type: 'flash',
      x,
      y,
      color,
      timer: 0,
      duration: 0.3,
      radius: 30
    });
  }

  /**
   * Add particle burst effect
   */
  addParticleBurst(x, y, color = '#ff4444', count = 8) {
    const angleStep = (Math.PI * 2) / count;
    for (let i = 0; i < count; i++) {
      const angle = angleStep * i + Math.random() * 0.3;
      const speed = 60 + Math.random() * 40;
      this.animations.push({
        type: 'particle',
        x,
        y,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed,
        color,
        timer: 0,
        duration: 0.6,
        size: 3 + Math.random() * 2
      });
    }
  }

  /**
   * Add attack slash effect
   */
  addSlash(startX, startY, endX, endY) {
    this.animations.push({
      type: 'slash',
      startX,
      startY,
      endX,
      endY,
      timer: 0,
      duration: 0.2
    });
  }

  /**
   * Update all animations
   */
  update(deltaTime) {
    for (let i = this.animations.length - 1; i >= 0; i--) {
      const anim = this.animations[i];
      anim.timer += deltaTime;

      // Update position based on type
      switch (anim.type) {
        case 'damage':
        case 'heal':
        case 'miss':
        case 'status':
          anim.y = anim.startY + (anim.velocityY * anim.timer);
          break;
        case 'particle':
          anim.x += anim.velocityX * deltaTime;
          anim.y += anim.velocityY * deltaTime;
          anim.velocityY += 100 * deltaTime; // Gravity
          break;
      }

      // Remove finished animations
      if (anim.timer >= anim.duration) {
        this.animations.splice(i, 1);
      }
    }
  }

  /**
   * Render all animations
   */
  render(ctx) {
    for (const anim of this.animations) {
      const progress = anim.timer / anim.duration;
      const alpha = 1 - progress;

      ctx.save();
      ctx.globalAlpha = alpha;

      switch (anim.type) {
        case 'damage':
          this.renderDamageNumber(ctx, anim);
          break;
        case 'heal':
          this.renderHealNumber(ctx, anim);
          break;
        case 'miss':
          this.renderMiss(ctx, anim);
          break;
        case 'status':
          this.renderStatusText(ctx, anim);
          break;
        case 'flash':
          this.renderFlash(ctx, anim, progress);
          break;
        case 'particle':
          this.renderParticle(ctx, anim);
          break;
        case 'slash':
          this.renderSlash(ctx, anim, progress);
          break;
      }

      ctx.restore();
    }
  }

  /**
   * Render damage number
   */
  renderDamageNumber(ctx, anim) {
    const fontSize = anim.isCritical ? 24 : 18;
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Shadow
    ctx.fillStyle = '#000';
    ctx.fillText(`-${anim.value}`, anim.x + 2, anim.y + 2);

    // Main text
    ctx.fillStyle = anim.isCritical ? '#ffcc00' : '#ff4444';
    ctx.fillText(`-${anim.value}`, anim.x, anim.y);

    // Critical indicator
    if (anim.isCritical) {
      ctx.font = '12px Arial';
      ctx.fillStyle = '#ffcc00';
      ctx.fillText('CRITICAL!', anim.x, anim.y - 20);
    }
  }

  /**
   * Render heal number
   */
  renderHealNumber(ctx, anim) {
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Shadow
    ctx.fillStyle = '#000';
    ctx.fillText(`+${anim.value}`, anim.x + 2, anim.y + 2);

    // Main text
    ctx.fillStyle = '#44ff44';
    ctx.fillText(`+${anim.value}`, anim.x, anim.y);
  }

  /**
   * Render miss text
   */
  renderMiss(ctx, anim) {
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Shadow
    ctx.fillStyle = '#000';
    ctx.fillText('MISS', anim.x + 2, anim.y + 2);

    // Main text
    ctx.fillStyle = '#aaaaaa';
    ctx.fillText('MISS', anim.x, anim.y);
  }

  /**
   * Render status effect text
   */
  renderStatusText(ctx, anim) {
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Shadow
    ctx.fillStyle = '#000';
    ctx.fillText(anim.value, anim.x + 1, anim.y + 1);

    // Main text
    ctx.fillStyle = '#ffaa00';
    ctx.fillText(anim.value, anim.x, anim.y);
  }

  /**
   * Render flash effect
   */
  renderFlash(ctx, anim, progress) {
    const radius = anim.radius * (1 - progress);
    const gradient = ctx.createRadialGradient(anim.x, anim.y, 0, anim.x, anim.y, radius);
    gradient.addColorStop(0, anim.color);
    gradient.addColorStop(1, 'transparent');

    ctx.beginPath();
    ctx.arc(anim.x, anim.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  /**
   * Render particle
   */
  renderParticle(ctx, anim) {
    ctx.beginPath();
    ctx.arc(anim.x, anim.y, anim.size, 0, Math.PI * 2);
    ctx.fillStyle = anim.color;
    ctx.fill();
  }

  /**
   * Render slash effect
   */
  renderSlash(ctx, anim, progress) {
    const midX = (anim.startX + anim.endX) / 2;
    const midY = (anim.startY + anim.endY) / 2;

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3 * (1 - progress);
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(anim.startX, anim.startY);
    ctx.lineTo(anim.endX, anim.endY);
    ctx.stroke();
  }

  /**
   * Clear all animations
   */
  clear() {
    this.animations = [];
  }

  /**
   * Check if any animations are active
   */
  isAnimating() {
    return this.animations.length > 0;
  }
}
