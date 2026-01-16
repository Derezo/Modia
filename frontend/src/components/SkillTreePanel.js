// REVIEW: This component appears unused after FormationScene v8.2 redesign.
// Skills are now accessed via CharacterModal → SkillDetailModal.
// Consider removing if confirmed unused, or re-integrating if needed elsewhere.
import { PARCHMENT_COLORS } from '../ui/parchment/ParchmentTheme.js';
import { parchmentToast } from '../ui/parchment/ParchmentToast.js';

/**
 * Default scaling increments per level for skill attributes
 * Mirrors api/src/config/skillScaling.js for frontend preview
 */
const DEFAULT_SCALING = {
  power: 0.5,
  effectChance: 0.005,
  effectDuration: 0.02,
  healPercent: 0.1,
  mpRestore: 0.1,
  buffDuration: 0.02,
  range: 0,
  aoeRadius: 0
};

/**
 * Calculate scaled skill attributes at a given level
 * @param {object} skill - Skill definition
 * @param {number} level - Level to calculate for
 * @returns {object} Object with scaled attribute values
 */
function getScaledAttributes(skill, level) {
  if (!skill || level <= 1) {
    return {
      power: skill?.power,
      effectChance: skill?.effectChance,
      effectDuration: skill?.effectDuration,
      healPercent: skill?.healPercent,
      mpRestore: skill?.mpRestore,
      range: skill?.range,
      aoeRadius: skill?.aoeRadius
    };
  }

  const scaling = skill.scaling || {};
  const result = {};

  // Helper to scale a value
  const scale = (attr, base) => {
    if (base === undefined || base === null) return undefined;
    const increment = scaling[attr] ?? DEFAULT_SCALING[attr] ?? 0;
    return base + (level - 1) * increment;
  };

  result.power = skill.power !== undefined
    ? Math.round(scale('power', skill.power) * 10) / 10
    : undefined;

  result.effectChance = skill.effectChance !== undefined
    ? Math.min(1.0, scale('effectChance', skill.effectChance))
    : undefined;

  result.effectDuration = skill.effectDuration !== undefined
    ? Math.floor(scale('effectDuration', skill.effectDuration))
    : undefined;

  result.healPercent = skill.healPercent !== undefined
    ? Math.round(scale('healPercent', skill.healPercent) * 10) / 10
    : undefined;

  result.mpRestore = skill.mpRestore !== undefined
    ? Math.round(scale('mpRestore', skill.mpRestore) * 10) / 10
    : undefined;

  result.range = skill.range !== undefined && scaling.range
    ? Math.floor(scale('range', skill.range))
    : skill.range;

  result.aoeRadius = skill.aoeRadius !== undefined && scaling.aoeRadius
    ? Math.floor(scale('aoeRadius', skill.aoeRadius))
    : skill.aoeRadius;

  return result;
}

export class SkillTreePanel {
  constructor(game, container) {
    this.game = game;
    this.container = container;
    this.characterId = null;
    this.characterClass = null;
    this.xpPool = 0;
    this.spentXP = 0;
    this.levelProgress = null;
    this.learnedSkills = {};
    this.skillTree = null;
    this.selectedSkill = null;
    this.element = null;
  }

  async load(characterId, characterClass) {
    this.characterId = characterId;
    this.characterClass = characterClass;

    try {
      const [treeData, skillData] = await Promise.all([
        this.game.api.getSkillTree(characterClass),
        this.game.api.getCharacterSkills(characterId)
      ]);

      this.skillTree = treeData;
      this.learnedSkills = skillData.skills || {};
      this.xpPool = skillData.xpPool || 0;
      this.spentXP = skillData.spentXP || 0;
      this.levelProgress = skillData.levelProgress || null;
      this.render();
    } catch (err) {
      console.error('Failed to load skill tree:', err);
      parchmentToast.error('Load Failed', 'Failed to load skills');
    }
  }

  render() {
    if (this.element) {
      this.element.remove();
    }

    this.element = document.createElement('div');
    this.element.className = 'skill-tree-panel';
    this.element.innerHTML = `
      <style>
        .skill-tree-panel {
          display: flex;
          gap: 16px;
          height: 100%;
        }
        .skill-branches {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 16px;
          overflow-y: auto;
        }
        .skill-branch {
          background: rgba(0, 0, 0, 0.3);
          border-radius: 4px;
          padding: 12px;
        }
        .branch-name {
          font-weight: bold;
          color: ${PARCHMENT_COLORS.text.primary};
          margin-bottom: 12px;
          font-size: 14px;
          border-bottom: 1px solid ${PARCHMENT_COLORS.border};
          padding-bottom: 6px;
        }
        .branch-skills {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .skill-node {
          width: 64px;
          height: 64px;
          background: rgba(0, 0, 0, 0.4);
          border: 2px solid #3a3a5a;
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          position: relative;
          transition: all 0.2s;
        }
        .skill-node:hover {
          border-color: #6ab0f3;
          transform: scale(1.05);
        }
        .skill-node.learned {
          border-color: #4a90d9;
          background: rgba(74, 144, 217, 0.2);
        }
        .skill-node.maxed {
          border-color: #ffd700;
          background: rgba(255, 215, 0, 0.2);
        }
        .skill-node.locked {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .skill-node.selected {
          border-color: #ffd700;
          box-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
        }
        .skill-icon {
          font-size: 24px;
        }
        .skill-level {
          font-size: 10px;
          color: #fff;
          margin-top: 2px;
        }
        .skill-details-panel {
          width: 280px;
          flex-shrink: 0;
        }
        .skill-details {
          background: rgba(0, 0, 0, 0.3);
          border-radius: 4px;
          padding: 16px;
          min-height: 200px;
        }
        .xp-pool-display {
          background: rgba(0, 0, 0, 0.4);
          border-radius: 4px;
          padding: 12px;
          margin-bottom: 12px;
          text-align: center;
        }
        .xp-label {
          font-size: 12px;
          color: ${PARCHMENT_COLORS.text.secondary};
        }
        .xp-value {
          font-size: 24px;
          font-weight: bold;
          color: ${PARCHMENT_COLORS.text.primary};
        }
        .level-progress-section {
          background: rgba(0, 0, 0, 0.4);
          border-radius: 4px;
          padding: 12px;
          margin-bottom: 12px;
        }
        .level-display {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 6px;
        }
        .level-value {
          font-size: 16px;
          font-weight: bold;
          color: ${PARCHMENT_COLORS.text.primary};
        }
        .level-xp-text {
          font-size: 11px;
          color: ${PARCHMENT_COLORS.text.secondary};
        }
        .level-progress-bar {
          height: 10px;
          background: rgba(0, 0, 0, 0.5);
          border-radius: 5px;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .level-progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #6ab0f3, #4a90d9);
          transition: width 0.3s;
        }
        .level-progress-fill.maxed {
          background: linear-gradient(90deg, #ffd700, #ffaa00);
        }
        .skill-name {
          font-weight: bold;
          font-size: 16px;
          margin-bottom: 4px;
        }
        .skill-type {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          color: ${PARCHMENT_COLORS.text.primary};
          margin-bottom: 8px;
          padding: 3px 8px;
          border-radius: 3px;
        }
        .skill-type-icon {
          font-size: 14px;
        }
        .skill-type.active {
          background: ${PARCHMENT_COLORS.element.fire.bg};
          border: 1px solid ${PARCHMENT_COLORS.element.fire.border};
        }
        .skill-type.passive {
          background: ${PARCHMENT_COLORS.element.passive.bg};
          border: 1px solid ${PARCHMENT_COLORS.element.passive.border};
        }
        .skill-type.fire {
          background: ${PARCHMENT_COLORS.element.fire.bg};
          border: 1px solid ${PARCHMENT_COLORS.element.fire.border};
        }
        .skill-type.ice {
          background: ${PARCHMENT_COLORS.element.ice.bg};
          border: 1px solid ${PARCHMENT_COLORS.element.ice.border};
        }
        .skill-type.lightning {
          background: ${PARCHMENT_COLORS.element.lightning.bg};
          border: 1px solid ${PARCHMENT_COLORS.element.lightning.border};
        }
        .skill-type.physical {
          background: ${PARCHMENT_COLORS.element.physical.bg};
          border: 1px solid ${PARCHMENT_COLORS.element.physical.border};
        }
        .skill-description {
          font-size: 13px;
          color: #ccc;
          margin-bottom: 12px;
          line-height: 1.4;
        }
        .skill-progress {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
        }
        .progress-bar {
          flex: 1;
          height: 8px;
          background: rgba(0, 0, 0, 0.4);
          border-radius: 4px;
          overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #4a90d9, #6ab0f3);
          transition: width 0.3s;
        }
        .progress-text {
          font-size: 12px;
          color: ${PARCHMENT_COLORS.text.primary};
          min-width: 50px;
          text-align: right;
          font-weight: bold;
          text-shadow:
            -1px -1px 0 rgba(255, 255, 255, 0.5),
            1px -1px 0 rgba(255, 255, 255, 0.5),
            -1px 1px 0 rgba(255, 255, 255, 0.5),
            1px 1px 0 rgba(255, 255, 255, 0.5);
        }
        .skill-cost {
          font-size: 12px;
          margin-bottom: 8px;
          color: ${PARCHMENT_COLORS.text.secondary};
        }
        .skill-cost.affordable { color: ${PARCHMENT_COLORS.state.info}; }
        .skill-cost.expensive { color: ${PARCHMENT_COLORS.state.error}; }
        .skill-requires {
          font-size: 11px;
          color: ${PARCHMENT_COLORS.state.warning};
          margin-bottom: 12px;
        }
        .skill-requires.met { color: ${PARCHMENT_COLORS.state.success}; }
        .learn-button {
          width: 100%;
        }
        .level-controls {
          display: flex;
          gap: 8px;
          margin-bottom: 12px;
        }
        .level-btn {
          flex: 1;
        }
        .skill-attributes {
          background: rgba(0, 0, 0, 0.2);
          border-radius: 4px;
          padding: 8px;
          margin-bottom: 12px;
        }
        .skill-attributes-title {
          font-size: 11px;
          color: ${PARCHMENT_COLORS.text.secondary};
          margin-bottom: 6px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .skill-attr-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 12px;
          margin-bottom: 3px;
        }
        .skill-attr-name {
          color: ${PARCHMENT_COLORS.text.secondary};
        }
        .skill-attr-values {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .skill-attr-current {
          color: ${PARCHMENT_COLORS.text.primary};
          font-weight: bold;
        }
        .skill-attr-arrow {
          color: ${PARCHMENT_COLORS.state.success};
          font-size: 10px;
        }
        .skill-attr-next {
          color: ${PARCHMENT_COLORS.state.success};
          font-weight: bold;
        }
      </style>

      <div class="skill-branches">
        ${this.renderBranches()}
      </div>

      <div class="skill-details-panel">
        ${this.renderLevelProgress()}
        <div class="xp-pool-display">
          <div class="xp-label">Available XP</div>
          <div class="xp-value">${this.xpPool.toLocaleString()}</div>
        </div>
        <div class="skill-details" id="skill-details">
          <div style="color: #8a8aaa; text-align: center;">Select a skill to view details</div>
        </div>
      </div>
    `;

    this.container.appendChild(this.element);
    this.setupEventListeners();
  }

  renderBranches() {
    if (!this.skillTree || !this.skillTree.branches) {
      return '<div style="color: #8a8aaa;">No skill tree available</div>';
    }

    return this.skillTree.branches.map(branch => `
      <div class="skill-branch">
        <div class="branch-name">${branch.name}</div>
        <div class="branch-skills">
          ${branch.skills.map(skill => this.renderSkillNode(skill)).join('')}
        </div>
      </div>
    `).join('');
  }

  renderSkillNode(skill) {
    const currentLevel = this.learnedSkills[skill.id] || 0;
    const isLearned = currentLevel > 0;
    const isMaxed = currentLevel >= skill.maxLevel;
    const isLocked = !this.checkRequirements(skill);

    let classes = 'skill-node';
    if (isMaxed) classes += ' maxed';
    else if (isLearned) classes += ' learned';
    if (isLocked) classes += ' locked';

    return `
      <div class="${classes}" data-skill-id="${skill.id}">
        <span class="skill-icon">${skill.icon}</span>
        <span class="skill-level">${currentLevel}/${skill.maxLevel}</span>
      </div>
    `;
  }

  renderLevelProgress() {
    if (!this.levelProgress) {
      return '';
    }

    const { currentLevel, xpIntoLevel, xpNeededForNext, percentToNext, isMaxLevel } = this.levelProgress;
    const percent = isMaxLevel ? 100 : percentToNext;
    const fillClass = isMaxLevel ? 'level-progress-fill maxed' : 'level-progress-fill';

    const xpText = isMaxLevel
      ? 'Max Level'
      : `${xpIntoLevel.toLocaleString()} / ${xpNeededForNext.toLocaleString()} XP`;

    return `
      <div class="level-progress-section">
        <div class="level-display">
          <span class="level-value">Level ${currentLevel}</span>
          <span class="level-xp-text">${xpText}</span>
        </div>
        <div class="level-progress-bar">
          <div class="${fillClass}" style="width: ${percent}%"></div>
        </div>
      </div>
    `;
  }

  checkRequirements(skill) {
    if (!skill.requires) return true;
    for (const [reqId, reqLevel] of Object.entries(skill.requires)) {
      const current = this.learnedSkills[reqId] || 0;
      if (current < reqLevel) return false;
    }
    return true;
  }

  calculateCost(skill, fromLevel, toLevel) {
    let total = 0;
    for (let i = fromLevel; i < toLevel; i++) {
      total += Math.floor(skill.baseCost * Math.pow(1.2, i));
    }
    return total;
  }

  setupEventListeners() {
    this.element.querySelectorAll('.skill-node').forEach(node => {
      node.addEventListener('click', () => {
        const skillId = node.dataset.skillId;
        this.selectSkill(skillId);
      });
    });
    // Note: Class advancement is now handled through guild hall quests,
    // not through the skill tree panel. See ROADMAP_GAMEPLAY.md for details.
  }

  selectSkill(skillId) {
    // Find the skill in the tree
    let skill = null;
    for (const branch of this.skillTree.branches) {
      const found = branch.skills.find(s => s.id === skillId);
      if (found) {
        skill = found;
        break;
      }
    }

    if (!skill) return;

    // Update visual selection
    this.element.querySelectorAll('.skill-node.selected').forEach(n => {
      n.classList.remove('selected');
    });
    this.element.querySelector(`[data-skill-id="${skillId}"]`)?.classList.add('selected');

    this.selectedSkill = skill;
    this.showSkillDetails(skill);
  }

  showSkillDetails(skill) {
    const detailsEl = this.element.querySelector('#skill-details');
    const currentLevel = this.learnedSkills[skill.id] || 0;
    const isMaxed = currentLevel >= skill.maxLevel;
    const meetsRequirements = this.checkRequirements(skill);
    const nextLevelCost = isMaxed ? 0 : this.calculateCost(skill, currentLevel, currentLevel + 1);
    const canAfford = this.xpPool >= nextLevelCost;

    // Build requirements text
    let requiresHtml = '';
    if (skill.requires) {
      const reqTexts = [];
      for (const [reqId, reqLevel] of Object.entries(skill.requires)) {
        const current = this.learnedSkills[reqId] || 0;
        const met = current >= reqLevel;
        const reqSkill = this.findSkillById(reqId);
        const name = reqSkill ? reqSkill.name : reqId;
        reqTexts.push(`<span class="${met ? 'met' : ''}">${name} Lv.${reqLevel}</span>`);
      }
      requiresHtml = `<div class="skill-requires ${meetsRequirements ? 'met' : ''}">Requires: ${reqTexts.join(', ')}</div>`;
    }

    const progressPercent = (currentLevel / skill.maxLevel) * 100;
    const costClass = canAfford ? 'affordable' : 'expensive';

    let actionsHtml = '';
    if (!isMaxed && meetsRequirements) {
      actionsHtml = `
        <div class="level-controls">
          <button class="btn btn-secondary btn-sm level-btn" data-action="learn" data-levels="1" ${!canAfford ? 'disabled' : ''}>+1 Level</button>
          <button class="btn btn-secondary btn-sm level-btn" data-action="learn" data-levels="5" ${this.xpPool < this.calculateCost(skill, currentLevel, Math.min(skill.maxLevel, currentLevel + 5)) ? 'disabled' : ''}>+5 Levels</button>
        </div>
        <button class="btn btn-primary learn-button" data-action="max" ${this.xpPool < this.calculateCost(skill, currentLevel, skill.maxLevel) ? 'disabled' : ''}>Max Out (${this.calculateCost(skill, currentLevel, skill.maxLevel).toLocaleString()} XP)</button>
      `;
    } else if (isMaxed) {
      actionsHtml = `<div style="text-align: center; color: ${PARCHMENT_COLORS.state.success}; font-weight: bold;">MASTERED</div>`;
    } else if (!meetsRequirements) {
      actionsHtml = `<div style="text-align: center; color: ${PARCHMENT_COLORS.state.error};">Requirements not met</div>`;
    }

    // Determine element class and icon for skill type
    const elementClass = skill.element ? skill.element.toLowerCase() : skill.type;
    const elementIcon = this.getSkillTypeIcon(skill.element || skill.type);

    detailsEl.innerHTML = `
      <div class="skill-name">${skill.icon} ${skill.name}</div>
      <div class="skill-type ${elementClass}">
        <span class="skill-type-icon">${elementIcon}</span>
        ${skill.type.charAt(0).toUpperCase() + skill.type.slice(1)}${skill.element ? ` (${skill.element})` : ''}
      </div>
      <div class="skill-description">${skill.description}</div>
      <div class="skill-progress">
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${progressPercent}%"></div>
        </div>
        <div class="progress-text">${currentLevel} / ${skill.maxLevel}</div>
      </div>
      ${this.renderSkillAttributes(skill, currentLevel, isMaxed)}
      ${!isMaxed ? `<div class="skill-cost ${costClass}">Next level: ${nextLevelCost.toLocaleString()} XP</div>` : ''}
      ${requiresHtml}
      ${actionsHtml}
    `;

    // Bind action buttons
    detailsEl.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        const levels = action === 'max'
          ? skill.maxLevel - currentLevel
          : parseInt(btn.dataset.levels);
        this.learnSkill(skill, levels);
      });
    });
  }

  findSkillById(skillId) {
    for (const branch of this.skillTree.branches) {
      const found = branch.skills.find(s => s.id === skillId);
      if (found) return found;
    }
    return null;
  }

  /**
   * Render skill attributes with current/next level comparison
   */
  renderSkillAttributes(skill, currentLevel, isMaxed) {
    const displayLevel = Math.max(1, currentLevel);
    const nextLevel = isMaxed ? displayLevel : displayLevel + 1;

    const current = getScaledAttributes(skill, displayLevel);
    const next = getScaledAttributes(skill, nextLevel);

    const attrs = [];

    // Attribute display config: name, label, format function
    const attrConfig = [
      { key: 'power', label: 'Power', format: v => `${v}%` },
      { key: 'effectChance', label: 'Effect Chance', format: v => `${Math.round(v * 100)}%` },
      { key: 'effectDuration', label: 'Effect Duration', format: v => `${v} turns` },
      { key: 'healPercent', label: 'Heal', format: v => `${v}%` },
      { key: 'mpRestore', label: 'MP Restore', format: v => `${v}%` },
      { key: 'range', label: 'Range', format: v => `${v} tiles` },
      { key: 'aoeRadius', label: 'AOE Radius', format: v => `${v} tiles` }
    ];

    for (const { key, label, format } of attrConfig) {
      const currVal = current[key];
      const nextVal = next[key];

      if (currVal !== undefined && currVal !== null && currVal !== 0) {
        const improved = !isMaxed && nextVal > currVal;
        attrs.push(`
          <div class="skill-attr-row">
            <span class="skill-attr-name">${label}</span>
            <span class="skill-attr-values">
              <span class="skill-attr-current">${format(currVal)}</span>
              ${improved ? `<span class="skill-attr-arrow">→</span><span class="skill-attr-next">${format(nextVal)}</span>` : ''}
            </span>
          </div>
        `);
      }
    }

    // Add static attributes (mpCost, cooldown)
    if (skill.mpCost !== undefined && skill.mpCost > 0) {
      attrs.push(`
        <div class="skill-attr-row">
          <span class="skill-attr-name">MP Cost</span>
          <span class="skill-attr-values">
            <span class="skill-attr-current">${skill.mpCost}</span>
          </span>
        </div>
      `);
    }

    if (skill.cooldown !== undefined && skill.cooldown > 0) {
      attrs.push(`
        <div class="skill-attr-row">
          <span class="skill-attr-name">Cooldown</span>
          <span class="skill-attr-values">
            <span class="skill-attr-current">${skill.cooldown} turns</span>
          </span>
        </div>
      `);
    }

    if (attrs.length === 0) {
      return '';
    }

    return `
      <div class="skill-attributes">
        <div class="skill-attributes-title">Attributes${!isMaxed && currentLevel > 0 ? ' (Lv.' + displayLevel + ' → ' + nextLevel + ')' : ''}</div>
        ${attrs.join('')}
      </div>
    `;
  }

  async learnSkill(skill, levels) {
    const currentLevel = this.learnedSkills[skill.id] || 0;
    const targetLevel = Math.min(skill.maxLevel, currentLevel + levels);
    const actualLevels = targetLevel - currentLevel;

    if (actualLevels <= 0) return;

    try {
      const result = await this.game.api.learnSkill(this.characterId, skill.id, actualLevels);

      // Update local state
      this.learnedSkills[skill.id] = result.skill.level;
      this.xpPool = result.xpRemaining;
      this.spentXP = result.spentXP;
      this.levelProgress = result.levelProgress;

      // Update displays
      this.element.querySelector('.xp-value').textContent = this.xpPool.toLocaleString();
      this.render();
      this.selectSkill(skill.id);

      // Show skill learned toast
      parchmentToast.success('Skill Learned', `Learned ${skill.name} (Lv.${result.skill.level})! Spent ${result.xpSpent.toLocaleString()} XP`);

      // Show level-up toast if character leveled up
      if (result.levelUp) {
        const { oldLevel, newLevel, statGains } = result.levelUp;
        const statText = Object.entries(statGains || {})
          .filter(([, val]) => val > 0)
          .map(([stat, val]) => `+${val} ${stat.toUpperCase()}`)
          .join(', ');

        parchmentToast.success(
          'Level Up!',
          `Reached Level ${newLevel}!${statText ? ` (${statText})` : ''}`
        );
      }
    } catch (err) {
      parchmentToast.error('Learn Failed', err.message);
    }
  }

  /**
   * Get icon for skill type/element
   */
  getSkillTypeIcon(type) {
    const icons = {
      fire: PARCHMENT_COLORS.element.fire.icon,
      ice: PARCHMENT_COLORS.element.ice.icon,
      lightning: PARCHMENT_COLORS.element.lightning.icon,
      wind: PARCHMENT_COLORS.element.wind.icon,
      earth: PARCHMENT_COLORS.element.earth.icon,
      water: PARCHMENT_COLORS.element.water.icon,
      light: PARCHMENT_COLORS.element.light.icon,
      dark: PARCHMENT_COLORS.element.dark.icon,
      passive: PARCHMENT_COLORS.element.passive.icon,
      physical: PARCHMENT_COLORS.element.physical.icon,
      active: PARCHMENT_COLORS.element.physical.icon
    };
    return icons[type?.toLowerCase()] || '✦';
  }

  destroy() {
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
  }
}
