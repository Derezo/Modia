/**
 * DamagePreview - Shows damage/healing estimates on hover during targeting
 *
 * Features:
 * - Calculates damage range using existing formulas from battleService.js
 * - Shows RANGE not exact number (due to ±10% server variance): "95-115 damage"
 * - Shows hit chance percentage: "94% hit"
 * - Shows crit probability and crit damage: "~5% crit for 173"
 * - Healing preview: Shows estimated heal amount for healing skills/items
 * - Rendered as floating numbers above target on hover
 *
 * Note: This is an ESTIMATE. Server calculates actual damage with full data.
 */
export class DamagePreview {
  constructor(game) {
    this.game = game;

    // Current preview data
    this.previewData = null;
    this.targetUnit = null;
    this.screenX = 0;
    this.screenY = 0;

    // Animation
    this.opacity = 0;
    this.fadeSpeed = 8;
    this.bobOffset = 0;
    this.bobSpeed = 3;
    this.visible = false;
  }

  /**
   * Calculate physical damage estimate
   */
  calculatePhysicalDamage(attacker, defender, skillPower = 100) {
    // Base attack = strength + equipment attack bonus
    const attackPower = attacker.strength + (attacker.attack || 0);
    const baseDamage = attackPower * (skillPower / 100);

    // Defense = vitality + equipment defense bonus
    const defensePower = (defender.vitality || defender.agility / 2) + (defender.defense || 0);
    const defenseReduction = defensePower * 0.5 * 0.3;
    const rawDamage = Math.max(1, baseDamage - defenseReduction);

    // Apply variance range (0.9 - 1.1 on server)
    const minDamage = Math.floor(rawDamage * 0.9);
    const maxDamage = Math.floor(rawDamage * 1.1);

    // Critical hit calculation
    const critChance = Math.min(0.30, (attacker.luck || 10) / 200);
    const critMultiplier = attacker.race === 'orc' ? 1.5 * 1.1 : 1.5;
    const critDamage = Math.floor(maxDamage * critMultiplier);

    return {
      minDamage: Math.max(1, minDamage),
      maxDamage: Math.max(1, maxDamage),
      avgDamage: Math.floor((minDamage + maxDamage) / 2),
      critChance,
      critDamage,
      type: 'physical'
    };
  }

  /**
   * Calculate magical damage estimate
   */
  calculateMagicalDamage(attacker, defender, skillPower = 100) {
    // Base magic attack = intelligence + equipment magic attack bonus
    const magicAttackPower = attacker.intelligence + (attacker.magicAttack || 0);
    const baseDamage = magicAttackPower * (skillPower / 100);

    // Magic defense
    const magicDefensePower = (defender.intelligence || 10) + (defender.magicDefense || 0);
    const defenseReduction = magicDefensePower * 0.25 * 0.3;
    const rawDamage = Math.max(1, baseDamage - defenseReduction);

    // Apply variance range
    const minDamage = Math.floor(rawDamage * 0.9);
    const maxDamage = Math.floor(rawDamage * 1.1);

    // Critical hit calculation
    const critChance = Math.min(0.30, (attacker.luck || 10) / 200);
    const critDamage = Math.floor(maxDamage * 1.5);

    return {
      minDamage: Math.max(1, minDamage),
      maxDamage: Math.max(1, maxDamage),
      avgDamage: Math.floor((minDamage + maxDamage) / 2),
      critChance,
      critDamage,
      type: 'magical'
    };
  }

  /**
   * Calculate healing estimate
   */
  calculateHealing(caster, target, skillPower = 100) {
    // Healing based on caster's intelligence
    const baseHeal = (caster.intelligence || 10) * (skillPower / 100);

    // Apply variance range
    const minHeal = Math.floor(baseHeal * 0.9);
    const maxHeal = Math.floor(baseHeal * 1.1);

    // Calculate overheal
    const targetMissingHp = target.maxHp - target.hp;
    const effectiveHeal = Math.min(maxHeal, targetMissingHp);

    return {
      minHeal: Math.max(1, minHeal),
      maxHeal: Math.max(1, maxHeal),
      avgHeal: Math.floor((minHeal + maxHeal) / 2),
      effectiveHeal,
      isOverheal: maxHeal > targetMissingHp,
      type: 'heal'
    };
  }

  /**
   * Calculate hit chance
   */
  calculateHitChance(attacker, defender) {
    const baseHitChance = 0.95;
    const agilityDiff = (defender.agility || 10) - (attacker.agility || 10);
    const dodgeBonus = Math.max(0, agilityDiff) * 0.01;

    // Check for blind status
    const isBlinded = attacker.statusEffects?.some(e => e.type === 'blind');
    const blindPenalty = isBlinded ? 0.3 : 0;

    return Math.max(0.5, Math.min(1.0, baseHitChance - dodgeBonus - blindPenalty));
  }

  /**
   * Show damage preview for attack/skill
   */
  showDamagePreview(attacker, defender, skill, screenX, screenY) {
    this.targetUnit = defender;
    this.screenX = screenX;
    this.screenY = screenY;
    this.visible = true;

    const skillPower = skill?.power || 100;
    const damageType = skill?.damageType || 'physical';

    // Calculate damage based on type
    let damageCalc;
    if (skill?.effect === 'heal' || skill?.type === 'heal') {
      damageCalc = this.calculateHealing(attacker, defender, skillPower);
    } else if (damageType === 'magical' || damageType === 'magic') {
      damageCalc = this.calculateMagicalDamage(attacker, defender, skillPower);
    } else {
      damageCalc = this.calculatePhysicalDamage(attacker, defender, skillPower);
    }

    // Calculate hit chance
    const hitChance = this.calculateHitChance(attacker, defender);

    // Check if this would kill
    const willKill = damageCalc.type !== 'heal' && damageCalc.maxDamage >= defender.hp;

    this.previewData = {
      ...damageCalc,
      hitChance,
      willKill,
      targetName: defender.name
    };
  }

  /**
   * Show healing preview for items
   */
  showHealingPreview(user, target, item, screenX, screenY) {
    this.targetUnit = target;
    this.screenX = screenX;
    this.screenY = screenY;
    this.visible = true;

    const healPower = item?.power || 50;
    const healCalc = this.calculateHealing(user, target, healPower);

    this.previewData = {
      ...healCalc,
      hitChance: 1.0, // Items always hit
      willKill: false,
      targetName: target.name
    };
  }

  /**
   * Hide the preview
   */
  hide() {
    this.visible = false;
    this.previewData = null;
    this.targetUnit = null;
  }

  /**
   * Update animation
   */
  update(deltaTime) {
    // Fade in/out
    if (this.visible && this.previewData) {
      this.opacity = Math.min(1, this.opacity + this.fadeSpeed * deltaTime);
    } else {
      this.opacity = Math.max(0, this.opacity - this.fadeSpeed * deltaTime);
    }

    // Bob animation
    this.bobOffset = Math.sin(Date.now() / 300) * 3;
  }

  /**
   * Render the damage preview
   */
  render(ctx) {
    if (this.opacity < 0.01 || !this.previewData) return;

    const data = this.previewData;
    const x = this.screenX;
    const y = this.screenY - 60 + this.bobOffset;

    ctx.save();
    ctx.globalAlpha = this.opacity;

    // Background panel
    const panelWidth = 100;
    const panelHeight = data.type === 'heal' ? 50 : 70;
    const panelX = x - panelWidth / 2;
    const panelY = y - panelHeight / 2;

    // Draw panel background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.beginPath();
    ctx.roundRect(panelX, panelY, panelWidth, panelHeight, 6);
    ctx.fill();

    // Border
    ctx.strokeStyle = data.type === 'heal' ? '#4caf50' : (data.willKill ? '#ff4444' : '#ffd700');
    ctx.lineWidth = 2;
    ctx.stroke();

    // Text settings
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (data.type === 'heal') {
      // Healing preview
      ctx.fillStyle = '#4caf50';
      ctx.font = 'bold 16px monospace';
      ctx.fillText(`+${data.minHeal}-${data.maxHeal}`, x, y - 10);

      ctx.fillStyle = '#aaa';
      ctx.font = '11px sans-serif';
      ctx.fillText('HP', x, y + 10);

      if (data.isOverheal) {
        ctx.fillStyle = '#888';
        ctx.font = '10px sans-serif';
        ctx.fillText('(overheal)', x, y + 22);
      }
    } else {
      // Damage preview
      // Main damage range
      ctx.fillStyle = data.willKill ? '#ff4444' : '#ff8844';
      ctx.font = 'bold 16px monospace';
      ctx.fillText(`${data.minDamage}-${data.maxDamage}`, x, y - 18);

      // KILL indicator
      if (data.willKill) {
        ctx.fillStyle = '#ff4444';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText('KILL!', x, y - 4);
      }

      // Hit chance
      const hitPercent = Math.round(data.hitChance * 100);
      ctx.fillStyle = hitPercent >= 90 ? '#4caf50' : (hitPercent >= 70 ? '#ffd700' : '#ff8844');
      ctx.font = '11px sans-serif';
      ctx.fillText(`${hitPercent}% hit`, x, y + 8);

      // Crit info
      if (data.critChance > 0.01) {
        const critPercent = Math.round(data.critChance * 100);
        ctx.fillStyle = '#9c27b0';
        ctx.font = '10px sans-serif';
        ctx.fillText(`${critPercent}% crit → ${data.critDamage}`, x, y + 22);
      }
    }

    ctx.restore();
  }
}
