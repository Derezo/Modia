/**
 * BattleAnimations - Visual effects for tactical combat
 */
import { SKILL_EFFECT_CATEGORIES, getRandomCategoryColor, ITEM_EFFECT_VISUAL_MAP } from './SkillEffectCategories.js';
import { ELEMENT_COLORS } from '@shared/battleMath.js';
import { responsive } from '../core/Responsive.js';

/**
 * Animation timing constants (milliseconds)
 * Used by BattleWebSocketManager for queue timing synchronization
 */
export const ANIMATION_TIMING = {
  DAMAGE_NUMBER_DURATION: 1200,
  ACTION_WAIT_SHORT: 600,      // Minimum wait after attack animations
  ACTION_WAIT_FULL: 1200,      // Wait for damage numbers to complete
  TURN_SETTLE_DELAY: 400,      // Buffer after actions before next turn
  CAMERA_PAN_DURATION: 500,    // Standard camera pan time
  MOVEMENT_PER_TILE_MS: 150,   // Consistent timing per tile moved
  MOVEMENT_MIN_MS: 400,        // Minimum movement wait
};

export class BattleAnimations {
  constructor() {
    this.animations = [];
  }

  /**
   * Add skill effect animation based on visual category
   * @param {number} x - Center X position
   * @param {number} y - Center Y position
   * @param {string} categoryName - Visual category (fire, ice, etc.)
   * @param {Object} skill - Optional skill object for more context
   */
  addSkillEffect(x, y, categoryName, _skill = null) {
    const config = SKILL_EFFECT_CATEGORIES[categoryName] || SKILL_EFFECT_CATEGORIES.physical;

    // Flash effect with category color
    this.addFlash(x, y, config.flashColor);

    // Primary particle burst
    this.addCategoryParticleBurst(x, y, categoryName, config.particleCount);

    // Secondary particles after delay (handled via animation queue)
    setTimeout(() => {
      this.addCategoryParticleBurst(x, y, categoryName, Math.floor(config.particleCount / 2), config.colors.secondary);
    }, 100);

    // Add glow effect
    this.addGlow(x, y, config.glowColor, 40);
  }

  /**
   * Add category-aware particle burst
   * @param {number} x - Center X position
   * @param {number} y - Center Y position
   * @param {string} categoryName - Visual category
   * @param {number} count - Number of particles
   * @param {string} overrideColor - Optional color override
   */
  addCategoryParticleBurst(x, y, categoryName, count = 8, overrideColor = null) {
    const config = SKILL_EFFECT_CATEGORIES[categoryName] || SKILL_EFFECT_CATEGORIES.physical;
    const style = config.particleStyle || 'burst';

    for (let i = 0; i < count; i++) {
      const color = overrideColor || getRandomCategoryColor(categoryName);
      const angle = (Math.PI * 2 / count) * i + Math.random() * 0.3;

      switch (style) {
        case 'burst':
          this.addBurstParticle(x, y, angle, color);
          break;
        case 'rise':
          this.addRisingParticle(x, y, color);
          break;
        case 'fall':
          this.addFallingParticle(x, y, color);
          break;
        case 'orbit':
          this.addOrbitParticle(x, y, angle, color);
          break;
        case 'swirl':
          this.addSwirlParticle(x, y, angle, color);
          break;
        default:
          this.addBurstParticle(x, y, angle, color);
      }
    }
  }

  /**
   * Add a burst particle (outward explosion)
   */
  addBurstParticle(x, y, angle, color) {
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

  /**
   * Add a rising particle (floats upward - for healing/buff)
   */
  addRisingParticle(x, y, color) {
    const offsetX = (Math.random() - 0.5) * 30;
    this.animations.push({
      type: 'rising',
      x: x + offsetX,
      y,
      velocityY: -40 - Math.random() * 20,
      color,
      timer: 0,
      duration: 1.0,
      size: 3 + Math.random() * 3,
      sway: Math.random() * Math.PI * 2
    });
  }

  /**
   * Add a falling particle (falls down - for ice/debuff)
   */
  addFallingParticle(x, y, color) {
    const offsetX = (Math.random() - 0.5) * 40;
    this.animations.push({
      type: 'falling',
      x: x + offsetX,
      y: y - 40 - Math.random() * 20,
      velocityY: 30 + Math.random() * 20,
      color,
      timer: 0,
      duration: 0.8,
      size: 2 + Math.random() * 3
    });
  }

  /**
   * Add an orbiting particle (circles around center - for aura)
   */
  addOrbitParticle(centerX, centerY, startAngle, color) {
    this.animations.push({
      type: 'orbit',
      centerX,
      centerY,
      angle: startAngle,
      radius: 25 + Math.random() * 10,
      color,
      timer: 0,
      duration: 1.5,
      size: 3 + Math.random() * 2,
      speed: 3 + Math.random() * 2
    });
  }

  /**
   * Add a swirling particle (spirals inward/outward - for shadow/wind)
   */
  addSwirlParticle(x, y, startAngle, color) {
    this.animations.push({
      type: 'swirl',
      centerX: x,
      centerY: y,
      angle: startAngle,
      radius: 5,
      color,
      timer: 0,
      duration: 0.8,
      size: 3 + Math.random() * 2,
      speed: 4 + Math.random() * 2
    });
  }

  /**
   * Add self-targeting aura effect (orbiting particles)
   * @param {number} x - Center X position
   * @param {number} y - Center Y position
   * @param {string} categoryName - Visual category (default: selfAura)
   */
  addSelfAuraEffect(x, y, categoryName = 'selfAura') {
    const config = SKILL_EFFECT_CATEGORIES[categoryName] || SKILL_EFFECT_CATEGORIES.selfAura;
    const particleCount = 8;

    // Add glow
    this.addGlow(x, y, config.glowColor, 50);

    // Add orbiting particles
    for (let i = 0; i < particleCount; i++) {
      const angle = (Math.PI * 2 / particleCount) * i;
      const color = i % 2 === 0 ? config.colors.primary : config.colors.secondary;
      this.animations.push({
        type: 'orbit',
        centerX: x,
        centerY: y,
        angle,
        radius: 30,
        color,
        timer: 0,
        duration: 1.5,
        size: 4,
        speed: 3
      });
    }

    // Add rising sparkles
    for (let i = 0; i < 6; i++) {
      setTimeout(() => {
        this.addRisingParticle(x, y, config.colors.tertiary);
      }, i * 100);
    }
  }

  /**
   * Add glow effect
   */
  addGlow(x, y, color, radius = 40) {
    this.animations.push({
      type: 'glow',
      x,
      y,
      color,
      timer: 0,
      duration: 0.5,
      radius
    });
  }

  /**
   * Element-to-color mapping for damage numbers
   * Imported from @shared/battleMath.js - this static property provides
   * backwards compatibility for any code referencing BattleAnimations.ELEMENT_COLORS
   */
  static ELEMENT_COLORS = ELEMENT_COLORS;

  /**
   * Add a damage number animation
   * @param {number} x - X position
   * @param {number} y - Y position
   * @param {number} damage - Damage amount
   * @param {boolean} isCritical - Whether hit was critical
   * @param {string} element - Element type for color (optional)
   * @param {number} elementalModifier - Elemental effectiveness (optional)
   */
  addDamageNumber(x, y, damage, isCritical = false, element = null, elementalModifier = null) {
    // Determine color based on element
    let color = BattleAnimations.ELEMENT_COLORS.physical;
    if (isCritical) {
      color = '#ffcc00'; // Gold for criticals always
    } else if (element && BattleAnimations.ELEMENT_COLORS[element]) {
      color = BattleAnimations.ELEMENT_COLORS[element];
    }

    // Determine effectiveness text
    let effectivenessText = null;
    if (elementalModifier !== null && elementalModifier !== 1.0) {
      if (elementalModifier === 0) {
        effectivenessText = 'IMMUNE';
      } else if (elementalModifier >= 1.5) {
        effectivenessText = 'WEAK!';
      } else if (elementalModifier > 1.0) {
        effectivenessText = 'Weak';
      } else if (elementalModifier <= 0.25) {
        effectivenessText = 'RESIST';
      } else if (elementalModifier < 1.0) {
        effectivenessText = 'Resist';
      }
    }

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
      scale: isCritical ? 1.5 : 1.0,
      color,
      element,
      elementalModifier,
      effectivenessText
    });
  }

  /**
   * Add an absorb (healing from elemental damage) animation
   * @param {number} x - X position
   * @param {number} y - Y position
   * @param {number} amount - Healing amount
   * @param {string} element - Element type that was absorbed
   */
  addAbsorbNumber(x, y, amount, element = null) {
    const color = element && BattleAnimations.ELEMENT_COLORS[element]
      ? BattleAnimations.ELEMENT_COLORS[element]
      : '#44ff88';

    this.animations.push({
      type: 'absorb',
      x,
      y,
      startY: y,
      value: amount,
      timer: 0,
      duration: 1.2,
      velocityY: -60,
      color,
      element
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
   * Add MP restore floating number (blue text)
   * @param {number} x - X position
   * @param {number} y - Y position
   * @param {number} amount - MP restored
   */
  addMpRestoreNumber(x, y, amount) {
    this.animations.push({
      type: 'mp_restore',
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
   * Add item use effect - parabolic arc from user to target with particle effects
   * Three phases: item arc (0-400ms), effect particles (400-800ms), result numbers (800ms+)
   * @param {number} userX - User screen X
   * @param {number} userY - User screen Y
   * @param {number} targetX - Target screen X
   * @param {number} targetY - Target screen Y
   * @param {string} effectType - Canonical effectType (heal_hp, heal_mp, etc.)
   */
  addItemUseEffect(userX, userY, targetX, targetY, effectType) {
    const visual = ITEM_EFFECT_VISUAL_MAP[effectType] || ITEM_EFFECT_VISUAL_MAP.heal_hp;

    // Phase 1: Item arc animation (colored orb flies in parabolic arc)
    this.animations.push({
      type: 'item_arc',
      startX: userX,
      startY: userY - 20,
      endX: targetX,
      endY: targetY - 20,
      color: visual.orbColor,
      timer: 0,
      duration: 0.4,
      size: 6
    });

    // Phase 2: Effect particles at target after arc completes
    setTimeout(() => {
      this.addSkillEffect(targetX, targetY - 20, visual.category);
    }, 400);
  }

  /**
   * Update all animations
   */
  update(deltaTime) {
    const dt = deltaTime / 1000; // Convert ms to seconds for physics
    for (let i = this.animations.length - 1; i >= 0; i--) {
      const anim = this.animations[i];
      anim.timer += dt;

      // Update position based on type
      switch (anim.type) {
        case 'damage':
        case 'heal':
        case 'mp_restore':
        case 'miss':
        case 'status':
          anim.y = anim.startY + (anim.velocityY * anim.timer);
          break;
        case 'item_arc': {
          // Quadratic bezier: start -> apex -> end
          const t = Math.min(anim.timer / anim.duration, 1);
          const midX = (anim.startX + anim.endX) / 2;
          const midY = Math.min(anim.startY, anim.endY) - 60; // Arc apex above both points
          anim.x = (1 - t) * (1 - t) * anim.startX + 2 * (1 - t) * t * midX + t * t * anim.endX;
          anim.y = (1 - t) * (1 - t) * anim.startY + 2 * (1 - t) * t * midY + t * t * anim.endY;
          break;
        }
        case 'particle':
          anim.x += anim.velocityX * dt;
          anim.y += anim.velocityY * dt;
          anim.velocityY += 100 * dt; // Gravity
          break;
        case 'rising':
          anim.y += anim.velocityY * dt;
          anim.x += Math.sin(anim.sway + anim.timer * 3) * 0.5; // Gentle sway
          break;
        case 'falling':
          anim.y += anim.velocityY * dt;
          anim.velocityY += 60 * dt; // Gravity acceleration
          break;
        case 'orbit':
          anim.angle += anim.speed * dt;
          break;
        case 'swirl':
          anim.angle += anim.speed * dt;
          anim.radius += 40 * dt; // Spiral outward
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
        case 'absorb':
          this.renderAbsorbNumber(ctx, anim);
          break;
        case 'heal':
          this.renderHealNumber(ctx, anim);
          break;
        case 'mp_restore':
          this.renderMpRestoreNumber(ctx, anim);
          break;
        case 'item_arc':
          this.renderItemArc(ctx, anim, progress);
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
        case 'rising':
        case 'falling':
          this.renderParticle(ctx, anim);
          break;
        case 'orbit':
          this.renderOrbitParticle(ctx, anim, progress);
          break;
        case 'swirl':
          this.renderSwirlParticle(ctx, anim, progress);
          break;
        case 'glow':
          this.renderGlow(ctx, anim, progress);
          break;
        case 'slash':
          this.renderSlash(ctx, anim, progress);
          break;
      }

      ctx.restore();
    }
  }

  /**
   * Render damage number with elemental coloring
   */
  renderDamageNumber(ctx, anim) {
    const fontSize = anim.isCritical ? 24 : 18;
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Shadow
    ctx.fillStyle = '#000';
    ctx.fillText(`-${anim.value}`, anim.x + 2, anim.y + 2);

    // Main text - use element color or critical gold
    ctx.fillStyle = anim.color || (anim.isCritical ? '#ffcc00' : '#ff4444');
    ctx.fillText(`-${anim.value}`, anim.x, anim.y);

    // Critical indicator
    if (anim.isCritical) {
      ctx.font = '12px Arial';
      ctx.fillStyle = '#ffcc00';
      ctx.fillText('CRITICAL!', anim.x, anim.y - 20);
    }
    // Elemental effectiveness indicator (below critical if both exist)
    else if (anim.effectivenessText) {
      ctx.font = `${responsive.getCanvasFontSize('sm')}px Arial`;
      // Color based on effectiveness: weak=red, resist=blue, immune=gray
      if (anim.elementalModifier > 1.0) {
        ctx.fillStyle = '#ff6644'; // Red/orange for weakness
      } else if (anim.elementalModifier === 0) {
        ctx.fillStyle = '#888888'; // Gray for immunity
      } else {
        ctx.fillStyle = '#4488ff'; // Blue for resistance
      }
      ctx.fillText(anim.effectivenessText, anim.x, anim.y - 18);
    }
  }

  /**
   * Render absorb (healing from element) number
   */
  renderAbsorbNumber(ctx, anim) {
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Shadow
    ctx.fillStyle = '#000';
    ctx.fillText(`+${anim.value}`, anim.x + 2, anim.y + 2);

    // Main text with element tint
    ctx.fillStyle = anim.color || '#44ff88';
    ctx.fillText(`+${anim.value}`, anim.x, anim.y);

    // Absorb indicator
    ctx.font = `${responsive.getCanvasFontSize('sm')}px Arial`;
    ctx.fillStyle = anim.color || '#44ff88';
    ctx.fillText('ABSORB', anim.x, anim.y - 18);
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
   * Render MP restore number (blue floating text)
   */
  renderMpRestoreNumber(ctx, anim) {
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Shadow
    ctx.fillStyle = '#000';
    ctx.fillText(`+${anim.value} MP`, anim.x + 2, anim.y + 2);

    // Main text (blue)
    ctx.fillStyle = '#44aaff';
    ctx.fillText(`+${anim.value} MP`, anim.x, anim.y);
  }

  /**
   * Render item arc (colored orb with trailing glow)
   */
  renderItemArc(ctx, anim, progress) {
    const size = anim.size * (1 + Math.sin(progress * Math.PI) * 0.5);

    // Trailing glow
    const gradient = ctx.createRadialGradient(anim.x, anim.y, 0, anim.x, anim.y, size * 3);
    gradient.addColorStop(0, anim.color);
    gradient.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.arc(anim.x, anim.y, size * 3, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();

    // Core orb
    ctx.beginPath();
    ctx.arc(anim.x, anim.y, size, 0, Math.PI * 2);
    ctx.fillStyle = anim.color;
    ctx.fill();

    // Bright center
    ctx.beginPath();
    ctx.arc(anim.x, anim.y, size * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
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
    const _midX = (anim.startX + anim.endX) / 2;
    const _midY = (anim.startY + anim.endY) / 2;

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3 * (1 - progress);
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(anim.startX, anim.startY);
    ctx.lineTo(anim.endX, anim.endY);
    ctx.stroke();
  }

  /**
   * Render orbiting particle
   */
  renderOrbitParticle(ctx, anim, progress) {
    const x = anim.centerX + Math.cos(anim.angle) * anim.radius;
    const y = anim.centerY + Math.sin(anim.angle) * anim.radius;
    const size = anim.size * (1 - progress * 0.5);

    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fillStyle = anim.color;
    ctx.fill();
  }

  /**
   * Render swirling particle
   */
  renderSwirlParticle(ctx, anim, progress) {
    const x = anim.centerX + Math.cos(anim.angle) * anim.radius;
    const y = anim.centerY + Math.sin(anim.angle) * anim.radius;
    const size = anim.size * (1 - progress);

    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fillStyle = anim.color;
    ctx.fill();
  }

  /**
   * Render glow effect
   */
  renderGlow(ctx, anim, progress) {
    const radius = anim.radius * (1 + progress * 0.5);
    const gradient = ctx.createRadialGradient(anim.x, anim.y, 0, anim.x, anim.y, radius);
    gradient.addColorStop(0, anim.color);
    gradient.addColorStop(0.5, anim.color.replace(')', ', 0.3)').replace('rgba', 'rgba').replace('rgb', 'rgba'));
    gradient.addColorStop(1, 'transparent');

    ctx.beginPath();
    ctx.arc(anim.x, anim.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  /**
   * Clear all animations
   */
  clear() {
    this.animations = [];
  }

  /**
   * Force all animations to complete immediately
   * Used when queue times out to prevent animation hangs
   */
  forceComplete() {
    for (const anim of this.animations) {
      anim.timer = anim.duration;
    }
  }

  /**
   * Check if any animations are active
   */
  isAnimating() {
    return this.animations.length > 0;
  }
}
