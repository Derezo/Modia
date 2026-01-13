/**
 * SkillDetailModal - Skill detail view with level-up functionality
 *
 * Shows comprehensive skill information with progression table
 * and ability to level up skills using available XP.
 *
 * Features:
 * - Skill header with icon, name, category
 * - Stats at current level (power, MP cost, cooldown, etc.)
 * - Level progression table showing scaling
 * - Prerequisites display with status
 * - Level up with XP cost and multi-level options
 *
 * Usage:
 *   const modal = new SkillDetailModal({
 *     game: this.game,
 *     characterId: 123,
 *     skill: skillDefinition,
 *     currentLevel: 5,
 *     availableXp: 1000,
 *     learnedSkills: { skillId: level, ... },
 *     onSkillLevelUp: () => refresh()
 *   });
 *   modal.open();
 */

import { ParchmentModal } from '../../ui/parchment/ParchmentModal.js';
import { parchmentToast } from '../../ui/parchment/ParchmentToast.js';
import {
  PARCHMENT_COLORS,
  PARCHMENT_SPACING,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_RADIUS,
  getParchmentBorder,
  getParchmentScrollbarCSS
} from '../../ui/parchment/ParchmentTheme.js';

const STYLE_ID = 'skill-detail-modal-styles';

// Default scaling increments per level (mirrors backend skillScaling.js)
const DEFAULT_SCALING_CONFIG = {
  power: 0.5,
  effectChance: 0.005,
  effectDuration: 0.02,
  healPercent: 0.1,
  mpRestore: 0.1,
  buffDuration: 0.02,
  range: 0,
  aoeRadius: 0,
  hits: 0,
  chainTargets: 0
};

// Default base cost for skills (matches backend default)
const DEFAULT_BASE_COST = 50;

export class SkillDetailModal {
  /**
   * @param {Object} options - Modal configuration
   * @param {Object} options.game - Game instance with API
   * @param {number} options.characterId - Character ID
   * @param {Object} options.skill - Skill definition from skill tree
   * @param {number} [options.currentLevel=0] - Current skill level
   * @param {number} [options.availableXp=0] - Available XP pool
   * @param {Object} [options.learnedSkills={}] - All learned skills { skillId: level }
   * @param {Function} [options.onSkillLevelUp] - Callback when skill is leveled
   * @param {Function} [options.onClose] - Callback when modal closes
   */
  constructor(options = {}) {
    this.game = options.game;
    this.characterId = options.characterId;
    this.skill = options.skill;
    this.currentLevel = options.currentLevel || 0;
    this.availableXp = options.availableXp || 0;
    this.learnedSkills = options.learnedSkills || {};
    this.onSkillLevelUp = options.onSkillLevelUp || (() => {});
    this.onClose = options.onClose || (() => {});

    this.modal = null;
    this.selectedLevelUp = 1;
    this.isProcessing = false;

    this.injectStyles();
  }

  /**
   * Inject component styles
   */
  injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .skill-detail-modal-content {
        display: flex;
        flex-direction: column;
        gap: ${PARCHMENT_SPACING.md};
        max-height: 550px;
      }

      /* Skill Header */
      .skill-detail-header {
        display: flex;
        gap: ${PARCHMENT_SPACING.md};
        padding: ${PARCHMENT_SPACING.md};
        background: linear-gradient(to bottom, ${PARCHMENT_COLORS.mid}, ${PARCHMENT_COLORS.dark});
        border: ${getParchmentBorder()};
        border-radius: ${PARCHMENT_RADIUS.md};
      }

      .skill-detail-icon {
        width: 64px;
        height: 64px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 40px;
        background: linear-gradient(135deg, ${PARCHMENT_COLORS.light}, ${PARCHMENT_COLORS.mid});
        border: 2px solid ${PARCHMENT_COLORS.border};
        border-radius: ${PARCHMENT_RADIUS.md};
        flex-shrink: 0;
      }

      .skill-detail-info {
        flex: 1;
        min-width: 0;
      }

      .skill-detail-name {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xl};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${PARCHMENT_COLORS.text.primary};
        margin: 0 0 ${PARCHMENT_SPACING.xs};
      }

      .skill-detail-badges {
        display: flex;
        gap: ${PARCHMENT_SPACING.xs};
        flex-wrap: wrap;
        margin-bottom: ${PARCHMENT_SPACING.xs};
      }

      .skill-detail-badge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: ${PARCHMENT_RADIUS.sm};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        text-transform: uppercase;
        letter-spacing: 0.3px;
      }

      .skill-detail-badge--category {
        background: linear-gradient(to bottom, #5a7eb3, #4a6ea3);
        color: white;
      }

      .skill-detail-badge--level {
        background: linear-gradient(to bottom, #6a5acd, #5a4abd);
        color: white;
      }

      .skill-detail-badge--locked {
        background: linear-gradient(to bottom, #8b4444, #7a3333);
        color: white;
      }

      .skill-detail-description {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${PARCHMENT_COLORS.text.secondary};
        line-height: 1.4;
      }

      /* Current Stats Section */
      .skill-detail-current-stats {
        padding: ${PARCHMENT_SPACING.md};
        background: ${PARCHMENT_COLORS.light};
        border: ${getParchmentBorder()};
        border-radius: ${PARCHMENT_RADIUS.md};
      }

      .skill-detail-section-title {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${PARCHMENT_COLORS.text.secondary};
        margin-bottom: ${PARCHMENT_SPACING.sm};
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .skill-detail-stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
        gap: ${PARCHMENT_SPACING.sm};
      }

      .skill-detail-stat {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .skill-detail-stat-label {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        color: ${PARCHMENT_COLORS.text.muted};
      }

      .skill-detail-stat-value {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.md};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${PARCHMENT_COLORS.text.primary};
      }

      /* Progression Table */
      .skill-detail-progression {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }

      .skill-detail-progression-table {
        border: ${getParchmentBorder()};
        border-radius: ${PARCHMENT_RADIUS.md};
        overflow: hidden;
        flex: 1;
        display: flex;
        flex-direction: column;
      }

      .skill-detail-progression-header {
        display: flex;
        background: linear-gradient(to bottom, ${PARCHMENT_COLORS.dark}, ${PARCHMENT_COLORS.borderDark});
        padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.sm};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${PARCHMENT_COLORS.text.inverse};
        text-transform: uppercase;
      }

      .skill-detail-progression-header span {
        flex: 1;
        text-align: center;
      }

      .skill-detail-progression-header span:first-child {
        flex: 0 0 50px;
        text-align: left;
      }

      .skill-detail-progression-body {
        flex: 1;
        overflow-y: auto;
        max-height: 150px;
        background: ${PARCHMENT_COLORS.light};
      }

      ${getParchmentScrollbarCSS('.skill-detail-progression-body')}

      .skill-detail-progression-row {
        display: flex;
        padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.sm};
        border-bottom: 1px solid ${PARCHMENT_COLORS.border};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
      }

      .skill-detail-progression-row:last-child {
        border-bottom: none;
      }

      .skill-detail-progression-row--current {
        background: linear-gradient(to right, #e8d9a8, #f8edc8);
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      }

      .skill-detail-progression-row--future {
        color: ${PARCHMENT_COLORS.text.muted};
      }

      .skill-detail-progression-row span {
        flex: 1;
        text-align: center;
      }

      .skill-detail-progression-row span:first-child {
        flex: 0 0 50px;
        text-align: left;
      }

      /* Prerequisites Section */
      .skill-detail-prerequisites {
        padding: ${PARCHMENT_SPACING.sm};
        background: ${PARCHMENT_COLORS.mid};
        border: ${getParchmentBorder()};
        border-radius: ${PARCHMENT_RADIUS.sm};
      }

      .skill-detail-prereq-list {
        display: flex;
        flex-direction: column;
        gap: ${PARCHMENT_SPACING.xs};
      }

      .skill-detail-prereq {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.xs};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      }

      .skill-detail-prereq--met {
        color: ${PARCHMENT_COLORS.state.success};
      }

      .skill-detail-prereq--unmet {
        color: ${PARCHMENT_COLORS.state.error};
      }

      /* Level Up Section */
      .skill-detail-level-up {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: ${PARCHMENT_SPACING.md};
        background: linear-gradient(to bottom, ${PARCHMENT_COLORS.mid}, ${PARCHMENT_COLORS.light});
        border: ${getParchmentBorder()};
        border-radius: ${PARCHMENT_RADIUS.md};
      }

      .skill-detail-level-up-options {
        display: flex;
        gap: ${PARCHMENT_SPACING.xs};
      }

      .skill-detail-level-option {
        padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.sm};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        background: ${PARCHMENT_COLORS.light};
        border: 1px solid ${PARCHMENT_COLORS.border};
        border-radius: ${PARCHMENT_RADIUS.sm};
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .skill-detail-level-option:hover:not(:disabled) {
        background: ${PARCHMENT_COLORS.mid};
      }

      .skill-detail-level-option.selected {
        background: linear-gradient(to bottom, #6a5acd, #5a4abd);
        color: white;
        border-color: #4a3a9d;
      }

      .skill-detail-level-option:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .skill-detail-level-up-info {
        text-align: right;
      }

      .skill-detail-xp-cost {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${PARCHMENT_COLORS.text.secondary};
        margin-bottom: ${PARCHMENT_SPACING.xs};
      }

      .skill-detail-xp-cost--insufficient {
        color: ${PARCHMENT_COLORS.state.error};
      }

      .skill-detail-level-up-btn {
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.lg};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        background: linear-gradient(to bottom, #6a5acd, #5a4abd);
        color: white;
        border: 1px solid #4a3a9d;
        border-radius: ${PARCHMENT_RADIUS.sm};
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .skill-detail-level-up-btn:hover:not(:disabled) {
        background: linear-gradient(to bottom, #7a6add, #6a5acd);
      }

      .skill-detail-level-up-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .skill-detail-max-level {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${PARCHMENT_COLORS.text.muted};
        font-style: italic;
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Open the modal
   */
  open() {
    this.modal = new ParchmentModal({
      title: 'Skill Details',
      content: '<div class="skill-detail-modal-content">Loading...</div>',
      size: 'md',
      closable: true,
      closeOnOverlay: true,
      closeOnEscape: true,
      onClose: () => {
        this.cleanup();
        this.onClose();
      }
    });

    this.modal.open();
    this.render();
  }

  /**
   * Render the modal content
   */
  render() {
    const contentEl = this.modal?.contentElement;
    if (!contentEl || !this.skill) return;

    const skill = this.skill;
    const maxLevel = skill.maxLevel || 100;
    const isMaxed = this.currentLevel >= maxLevel;
    const isLocked = !this.checkPrerequisites();
    const scaledSkill = this.scaleSkillAttributes(skill, Math.max(1, this.currentLevel));

    contentEl.innerHTML = `
      <div class="skill-detail-modal-content">
        <!-- Header -->
        ${this.renderHeader(skill, isLocked)}

        <!-- Current Stats -->
        ${this.renderCurrentStats(scaledSkill)}

        <!-- Prerequisites -->
        ${this.renderPrerequisites()}

        <!-- Level Progression Table -->
        ${this.renderProgressionTable(skill, maxLevel)}

        <!-- Level Up Section -->
        ${this.renderLevelUpSection(isMaxed, isLocked)}
      </div>
    `;

    this.bindEvents();
  }

  /**
   * Render skill header
   * @param {Object} skill - Skill definition
   * @param {boolean} isLocked - Whether skill is locked
   * @returns {string} HTML
   */
  renderHeader(skill, isLocked) {
    const maxLevel = skill.maxLevel || 100;
    const levelText = this.currentLevel > 0
      ? `Level ${this.currentLevel}/${maxLevel}`
      : 'Not Learned';

    return `
      <div class="skill-detail-header">
        <div class="skill-detail-icon">${skill.icon || '?'}</div>
        <div class="skill-detail-info">
          <h3 class="skill-detail-name">${this.escapeHtml(skill.name)}</h3>
          <div class="skill-detail-badges">
            ${skill.category ? `<span class="skill-detail-badge skill-detail-badge--category">${skill.category}</span>` : ''}
            <span class="skill-detail-badge skill-detail-badge--level">${levelText}</span>
            ${isLocked ? '<span class="skill-detail-badge skill-detail-badge--locked">Locked</span>' : ''}
          </div>
          <div class="skill-detail-description">${this.escapeHtml(skill.description || 'No description available.')}</div>
        </div>
      </div>
    `;
  }

  /**
   * Render current stats section
   * @param {Object} scaledSkill - Skill with current level scaling applied
   * @returns {string} HTML
   */
  renderCurrentStats(scaledSkill) {
    const stats = [];

    // Core stats
    if (scaledSkill.power !== undefined) {
      stats.push({ label: 'Power', value: `${scaledSkill.power}%` });
    }
    if (scaledSkill.mpCost !== undefined) {
      stats.push({ label: 'MP Cost', value: scaledSkill.mpCost });
    }
    if (scaledSkill.cooldown !== undefined) {
      stats.push({ label: 'Cooldown', value: `${scaledSkill.cooldown} turns` });
    }
    if (scaledSkill.range !== undefined) {
      stats.push({ label: 'Range', value: scaledSkill.range });
    }

    // Optional stats
    if (scaledSkill.aoeRadius) {
      stats.push({ label: 'AOE', value: `${scaledSkill.aoeRadius} tiles` });
    }
    if (scaledSkill.healPercent) {
      stats.push({ label: 'Heal', value: `${scaledSkill.healPercent}%` });
    }
    if (scaledSkill.effectChance !== undefined && scaledSkill.effectChance < 1) {
      stats.push({ label: 'Effect Chance', value: `${Math.round(scaledSkill.effectChance * 100)}%` });
    }
    if (scaledSkill.effectDuration) {
      stats.push({ label: 'Effect Duration', value: `${scaledSkill.effectDuration} turns` });
    }
    if (scaledSkill.hits && scaledSkill.hits > 1) {
      stats.push({ label: 'Hits', value: scaledSkill.hits });
    }

    if (stats.length === 0) {
      return '';
    }

    return `
      <div class="skill-detail-current-stats">
        <div class="skill-detail-section-title">Stats at Current Level</div>
        <div class="skill-detail-stats-grid">
          ${stats.map(s => `
            <div class="skill-detail-stat">
              <span class="skill-detail-stat-label">${s.label}</span>
              <span class="skill-detail-stat-value">${s.value}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  /**
   * Render prerequisites section
   * @returns {string} HTML
   */
  renderPrerequisites() {
    const requires = this.skill.requires;
    if (!requires || Object.keys(requires).length === 0) {
      return '';
    }

    const prereqHtml = Object.entries(requires).map(([skillId, requiredLevel]) => {
      const currentLevel = this.learnedSkills[skillId] || 0;
      const isMet = currentLevel >= requiredLevel;
      const statusClass = isMet ? 'skill-detail-prereq--met' : 'skill-detail-prereq--unmet';
      const icon = isMet ? '✓' : '✗';

      return `
        <div class="skill-detail-prereq ${statusClass}">
          <span>${icon}</span>
          <span>${skillId} Lv.${requiredLevel} (Current: ${currentLevel})</span>
        </div>
      `;
    }).join('');

    return `
      <div class="skill-detail-prerequisites">
        <div class="skill-detail-section-title">Prerequisites</div>
        <div class="skill-detail-prereq-list">
          ${prereqHtml}
        </div>
      </div>
    `;
  }

  /**
   * Render level progression table
   * @param {Object} skill - Base skill definition
   * @param {number} maxLevel - Maximum level
   * @returns {string} HTML
   */
  renderProgressionTable(skill, maxLevel) {
    // Determine which columns to show based on skill properties
    const columns = [{ key: 'level', label: 'Lv' }];

    if (skill.power !== undefined) columns.push({ key: 'power', label: 'Power' });
    if (skill.healPercent !== undefined) columns.push({ key: 'healPercent', label: 'Heal' });
    if (skill.effectChance !== undefined) columns.push({ key: 'effectChance', label: 'Chance' });
    if (skill.effectDuration !== undefined) columns.push({ key: 'effectDuration', label: 'Duration' });

    // Generate rows for key levels (1, 5, 10, 20, 50, 100, or current +/- 2)
    const keyLevels = new Set([1, 5, 10, 20, 50, maxLevel]);

    // Add levels around current level
    for (let i = Math.max(1, this.currentLevel - 1); i <= Math.min(maxLevel, this.currentLevel + 3); i++) {
      keyLevels.add(i);
    }

    const sortedLevels = Array.from(keyLevels).sort((a, b) => a - b).filter(l => l <= maxLevel);

    const headerHtml = columns.map(c => `<span>${c.label}</span>`).join('');

    const rowsHtml = sortedLevels.map(level => {
      const scaled = this.scaleSkillAttributes(skill, level);
      const isCurrent = level === this.currentLevel;
      const isFuture = level > this.currentLevel;
      const rowClass = isCurrent ? 'skill-detail-progression-row--current'
        : (isFuture ? 'skill-detail-progression-row--future' : '');

      const cells = columns.map(col => {
        if (col.key === 'level') {
          return `<span>${level}${isCurrent ? '*' : ''}</span>`;
        }
        const value = scaled[col.key];
        if (value === undefined) return '<span>-</span>';

        // Format value based on type
        if (col.key === 'power' || col.key === 'healPercent') {
          return `<span>${value}%</span>`;
        }
        if (col.key === 'effectChance') {
          return `<span>${Math.round(value * 100)}%</span>`;
        }
        return `<span>${value}</span>`;
      }).join('');

      return `<div class="skill-detail-progression-row ${rowClass}">${cells}</div>`;
    }).join('');

    return `
      <div class="skill-detail-progression">
        <div class="skill-detail-section-title">Level Progression</div>
        <div class="skill-detail-progression-table">
          <div class="skill-detail-progression-header">${headerHtml}</div>
          <div class="skill-detail-progression-body">${rowsHtml}</div>
        </div>
      </div>
    `;
  }

  /**
   * Render level up section
   * @param {boolean} isMaxed - Whether skill is at max level
   * @param {boolean} isLocked - Whether skill is locked
   * @returns {string} HTML
   */
  renderLevelUpSection(isMaxed, isLocked) {
    const maxLevel = this.skill.maxLevel || 100;
    const levelsToMax = maxLevel - this.currentLevel;

    if (isMaxed) {
      return `
        <div class="skill-detail-level-up">
          <span class="skill-detail-max-level">Skill is at maximum level</span>
        </div>
      `;
    }

    if (isLocked) {
      return `
        <div class="skill-detail-level-up">
          <span class="skill-detail-max-level">Complete prerequisites to unlock this skill</span>
        </div>
      `;
    }

    // Level up options: +1, +5, +10, Max
    const options = [1];
    if (levelsToMax >= 5) options.push(5);
    if (levelsToMax >= 10) options.push(10);
    if (levelsToMax > 10) options.push(levelsToMax);

    const optionsHtml = options.map(levels => {
      const cost = this.calculateXpCost(levels);
      const canAfford = cost <= this.availableXp;
      const label = levels === levelsToMax ? 'Max' : `+${levels}`;
      const selectedClass = levels === this.selectedLevelUp ? 'selected' : '';

      return `
        <button
          class="skill-detail-level-option ${selectedClass}"
          data-levels="${levels}"
          ${!canAfford ? 'disabled' : ''}
        >
          ${label}
        </button>
      `;
    }).join('');

    const totalCost = this.calculateXpCost(this.selectedLevelUp);
    const canAfford = totalCost <= this.availableXp;
    const costClass = canAfford ? '' : 'skill-detail-xp-cost--insufficient';

    return `
      <div class="skill-detail-level-up">
        <div class="skill-detail-level-up-options">
          ${optionsHtml}
        </div>
        <div class="skill-detail-level-up-info">
          <div class="skill-detail-xp-cost ${costClass}">
            Cost: ${totalCost.toLocaleString()} XP (${this.availableXp.toLocaleString()} available)
          </div>
          <button
            class="skill-detail-level-up-btn"
            data-action="level-up"
            ${!canAfford ? 'disabled' : ''}
          >
            Level Up
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Calculate XP cost for leveling up
   * Uses exponential formula matching backend: baseCost * 1.2^level
   * @param {number} levels - Number of levels to gain
   * @returns {number} Total XP cost
   */
  calculateXpCost(levels) {
    const baseCost = this.skill.baseCost || DEFAULT_BASE_COST;
    let total = 0;
    for (let i = 0; i < levels; i++) {
      const targetLevel = this.currentLevel + i;
      total += Math.floor(baseCost * Math.pow(1.2, targetLevel));
    }
    return total;
  }

  /**
   * Check if prerequisites are met
   * @returns {boolean}
   */
  checkPrerequisites() {
    const requires = this.skill.requires;
    if (!requires) return true;

    for (const [skillId, requiredLevel] of Object.entries(requires)) {
      if ((this.learnedSkills[skillId] || 0) < requiredLevel) {
        return false;
      }
    }
    return true;
  }

  /**
   * Scale skill attributes based on level (mirrors backend logic)
   * @param {Object} skill - Base skill definition
   * @param {number} level - Target level
   * @returns {Object} Scaled skill
   */
  scaleSkillAttributes(skill, level) {
    if (!skill || level <= 1) return { ...skill };

    const scaled = { ...skill };
    const customScaling = skill.scaling || {};

    const getScaledValue = (attr, baseValue) => {
      if (baseValue === undefined || baseValue === null) return baseValue;
      const increment = customScaling[attr] ?? DEFAULT_SCALING_CONFIG[attr] ?? 0;
      return baseValue + (level - 1) * increment;
    };

    // Scale power
    if (skill.power !== undefined) {
      scaled.power = Math.round(getScaledValue('power', skill.power) * 10) / 10;
    }

    // Scale effect chance (cap at 100%)
    if (skill.effectChance !== undefined) {
      scaled.effectChance = Math.min(1.0, getScaledValue('effectChance', skill.effectChance));
    }

    // Scale effect duration
    if (skill.effectDuration !== undefined) {
      scaled.effectDuration = Math.floor(getScaledValue('effectDuration', skill.effectDuration));
    }

    // Scale heal percent
    if (skill.healPercent !== undefined) {
      scaled.healPercent = Math.round(getScaledValue('healPercent', skill.healPercent) * 10) / 10;
    }

    // Scale MP restore
    if (skill.mpRestore !== undefined) {
      scaled.mpRestore = Math.round(getScaledValue('mpRestore', skill.mpRestore) * 10) / 10;
    }

    // Scale buff duration
    if (skill.buffDuration !== undefined) {
      scaled.buffDuration = Math.floor(getScaledValue('buffDuration', skill.buffDuration));
    }

    // Scale range (opt-in only)
    if (skill.range !== undefined && customScaling.range) {
      scaled.range = Math.floor(getScaledValue('range', skill.range));
    }

    // Scale AOE radius (opt-in only)
    if (skill.aoeRadius !== undefined && customScaling.aoeRadius) {
      scaled.aoeRadius = Math.floor(getScaledValue('aoeRadius', skill.aoeRadius));
    }

    return scaled;
  }

  /**
   * Bind event listeners
   */
  bindEvents() {
    const contentEl = this.modal?.contentElement;
    if (!contentEl) return;

    // Level option buttons
    const optionBtns = contentEl.querySelectorAll('.skill-detail-level-option');
    optionBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const levels = parseInt(btn.dataset.levels, 10);
        this.selectLevelUp(levels);
      });
    });

    // Level up button
    const levelUpBtn = contentEl.querySelector('[data-action="level-up"]');
    if (levelUpBtn) {
      levelUpBtn.addEventListener('click', () => this.handleLevelUp());
    }
  }

  /**
   * Select level up amount
   * @param {number} levels - Number of levels
   */
  selectLevelUp(levels) {
    this.selectedLevelUp = levels;
    this.render();
  }

  /**
   * Handle level up action
   */
  async handleLevelUp() {
    if (this.isProcessing) return;

    const cost = this.calculateXpCost(this.selectedLevelUp);
    if (cost > this.availableXp) {
      parchmentToast.error('Not enough XP');
      return;
    }

    this.isProcessing = true;
    const btn = this.modal?.contentElement?.querySelector('[data-action="level-up"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Leveling...';
    }

    try {
      // Call API to learn/level up skill
      await this.game.api.learnSkill(this.characterId, this.skill.id, this.selectedLevelUp);

      const newLevel = this.currentLevel + this.selectedLevelUp;
      parchmentToast.success(`${this.skill.name} is now Level ${newLevel}!`);

      this.onSkillLevelUp();
      this.close();

    } catch (error) {
      console.error('Failed to level up skill:', error);
      parchmentToast.error(error.message || 'Failed to level up skill');
    } finally {
      this.isProcessing = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Level Up';
      }
    }
  }

  /**
   * Escape HTML
   * @param {string} str - String to escape
   * @returns {string}
   */
  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Close the modal
   */
  close() {
    if (this.modal) {
      this.modal.close();
    }
  }

  /**
   * Clean up resources
   */
  cleanup() {
    this.modal = null;
  }
}

export default SkillDetailModal;
