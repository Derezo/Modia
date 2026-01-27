/**
 * CharacterModal - Character detail view with equipment and skills
 *
 * Shows comprehensive character information with collapsible sections
 * for equipment management and skill tree access.
 *
 * Features:
 * - Character header with portrait, level, class, XP progress
 * - Equipment accordion with slot list and Quick Equip Best button
 * - Skills accordion with skill tree visualization
 * - Context-dependent accordion defaults (open if action available)
 *
 * Usage:
 *   const modal = new CharacterModal({
 *     game: this.game,
 *     characterId: 123,
 *     inventory: sharedInventory,
 *     onEquipmentChanged: () => refreshParty(),
 *     onSkillLevelUp: () => refreshParty()
 *   });
 *   modal.open();
 */

import { ParchmentModal } from '../../ui/parchment/ParchmentModal.js';
import { Accordion } from '../../ui/parchment/Accordion.js';
import { parchmentToast } from '../../ui/parchment/ParchmentToast.js';
import { getClassColor, getClassIcon } from '../CharacterCard.js';
import {
  PARCHMENT_COLORS,
  PARCHMENT_SPACING,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_RADIUS,
  getParchmentBorder
} from '../../ui/parchment/ParchmentTheme.js';
import { getAssetPath, getOptimalSize } from '@shared/assetPaths.js';

const STYLE_ID = 'character-modal-styles';

// Equipment slot configuration
const EQUIPMENT_SLOTS = [
  { key: 'head', name: 'Head' },
  { key: 'body', name: 'Body' },
  { key: 'main_hand', name: 'Main Hand' },
  { key: 'off_hand', name: 'Off Hand' },
  { key: 'legs', name: 'Legs' },
  { key: 'feet', name: 'Feet' },
  { key: 'accessory', name: 'Accessory' }
];

export class CharacterModal {
  /**
   * @param {Object} options - Modal configuration
   * @param {Object} options.game - Game instance with API
   * @param {number} options.characterId - Character ID to display
   * @param {Array} [options.inventory] - Shared inventory (optional, will fetch if not provided)
   * @param {Function} [options.onEquipmentChanged] - Callback when equipment changes
   * @param {Function} [options.onSkillLevelUp] - Callback when skill is leveled up
   * @param {Function} [options.onClose] - Callback when modal closes
   */
  constructor(options = {}) {
    this.game = options.game;
    this.characterId = options.characterId;
    this.inventory = options.inventory || [];
    this.onEquipmentChanged = options.onEquipmentChanged || (() => {});
    this.onSkillLevelUp = options.onSkillLevelUp || (() => {});
    this.onClose = options.onClose || (() => {});

    this.modal = null;
    this.character = null;
    this.equipment = {};
    this.skills = {};
    this.skillTree = null;
    this.availableXp = 0;

    this.equipmentAccordion = null;
    this.skillsAccordion = null;
    this.equipmentTable = null;
    this.childModal = null;

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
      .character-modal-content {
        padding: 0;
      }

      /* Character Header */
      .character-modal-header {
        display: flex;
        gap: ${PARCHMENT_SPACING.md};
        padding: ${PARCHMENT_SPACING.md};
        background: linear-gradient(to bottom, ${PARCHMENT_COLORS.mid}, ${PARCHMENT_COLORS.dark});
        border-bottom: ${getParchmentBorder()};
      }

      .character-modal-portrait {
        width: 64px;
        height: 64px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 28px;
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: white;
        text-shadow: 0 2px 4px rgba(0,0,0,0.3);
        border: 3px solid rgba(255,255,255,0.3);
        flex-shrink: 0;
        overflow: hidden;
      }

      .character-modal-portrait img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .character-modal-portrait-fallback {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
      }

      .character-modal-info {
        flex: 1;
        min-width: 0;
      }

      .character-modal-name {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xl};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${PARCHMENT_COLORS.text.primary};
        margin: 0 0 ${PARCHMENT_SPACING.xs};
      }

      .character-modal-class-level {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${PARCHMENT_COLORS.text.secondary};
        margin-bottom: ${PARCHMENT_SPACING.xs};
        text-transform: capitalize;
      }

      .character-modal-xp-bar {
        height: 8px;
        background: ${PARCHMENT_COLORS.dark};
        border-radius: 4px;
        overflow: hidden;
        border: 1px solid ${PARCHMENT_COLORS.border};
      }

      .character-modal-xp-fill {
        height: 100%;
        background: linear-gradient(to right, #6a5acd, #9370db);
        transition: width 0.3s ease;
      }

      .character-modal-xp-text {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        color: ${PARCHMENT_COLORS.text.muted};
        margin-top: 2px;
      }

      /* Stats Summary */
      .character-modal-stats {
        display: flex;
        gap: ${PARCHMENT_SPACING.sm};
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        background: ${PARCHMENT_COLORS.dark};
        border-bottom: 1px solid ${PARCHMENT_COLORS.border};
        flex-wrap: wrap;
      }

      .character-modal-stat {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
      }

      .character-modal-stat-label {
        color: ${PARCHMENT_COLORS.text.muted};
      }

      .character-modal-stat-value {
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${PARCHMENT_COLORS.text.primary};
      }

      /* Accordions Container */
      .character-modal-accordions {
        padding: ${PARCHMENT_SPACING.md};
        max-height: 400px;
        overflow-y: auto;
      }

      /* Equipment Section */
      .character-modal-equipment-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: ${PARCHMENT_SPACING.sm};
      }

      .character-modal-quick-equip-btn {
        padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.sm};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        background: ${PARCHMENT_COLORS.mid};
        border: 1px solid ${PARCHMENT_COLORS.border};
        border-radius: ${PARCHMENT_RADIUS.sm};
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .character-modal-quick-equip-btn:hover:not(:disabled) {
        background: ${PARCHMENT_COLORS.light};
      }

      .character-modal-quick-equip-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* Equipment Slots List */
      .character-modal-equipment-list {
        display: flex;
        flex-direction: column;
        gap: ${PARCHMENT_SPACING.xs};
      }

      .character-modal-equipment-slot {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.sm};
        padding: ${PARCHMENT_SPACING.sm};
        background: ${PARCHMENT_COLORS.mid};
        border: 1px solid ${PARCHMENT_COLORS.border};
        border-radius: ${PARCHMENT_RADIUS.sm};
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .character-modal-equipment-slot:hover {
        background: ${PARCHMENT_COLORS.light};
        border-color: ${PARCHMENT_COLORS.borderDark};
      }

      .character-modal-slot-name {
        width: 80px;
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${PARCHMENT_COLORS.text.secondary};
      }

      .character-modal-slot-item {
        flex: 1;
        min-width: 0;
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      }

      .character-modal-slot-empty {
        color: ${PARCHMENT_COLORS.text.muted};
        font-style: italic;
      }

      .character-modal-slot-stats {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        color: ${PARCHMENT_COLORS.state.success};
      }

      /* Skills Section */
      .character-modal-skills-list {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        gap: ${PARCHMENT_SPACING.sm};
      }

      .character-modal-skill {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: ${PARCHMENT_SPACING.sm};
        background: ${PARCHMENT_COLORS.mid};
        border: 1px solid ${PARCHMENT_COLORS.border};
        border-radius: ${PARCHMENT_RADIUS.sm};
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .character-modal-skill:hover {
        background: ${PARCHMENT_COLORS.light};
        transform: translateY(-2px);
      }

      .character-modal-skill--locked {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .character-modal-skill--locked:hover {
        transform: none;
      }

      .character-modal-skill-icon {
        font-size: 24px;
        margin-bottom: ${PARCHMENT_SPACING.xs};
      }

      .character-modal-skill-name {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        text-align: center;
        color: ${PARCHMENT_COLORS.text.primary};
      }

      .character-modal-skill-level {
        font-size: 10px;
        color: ${PARCHMENT_COLORS.text.muted};
      }

      /* Skill Branch/Category Headers */
      .character-modal-skill-branch {
        margin-bottom: ${PARCHMENT_SPACING.md};
      }

      .character-modal-branch-header {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${PARCHMENT_COLORS.accent.burgundy};
        margin-bottom: ${PARCHMENT_SPACING.xs};
        padding-bottom: ${PARCHMENT_SPACING.xs};
        border-bottom: 1px solid ${PARCHMENT_COLORS.border};
        text-transform: capitalize;
      }

      .character-modal-loading {
        padding: ${PARCHMENT_SPACING.lg};
        text-align: center;
        color: ${PARCHMENT_COLORS.text.muted};
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Open the modal
   */
  async open() {
    this.modal = new ParchmentModal({
      title: 'Character Details',
      content: '<div class="character-modal-content"><div class="character-modal-loading">Loading character data...</div></div>',
      size: 'lg',
      closable: true,
      closeOnOverlay: true,
      closeOnEscape: true,
      onClose: () => {
        this.cleanup();
        this.onClose();
      }
    });

    this.modal.open();

    try {
      await this.loadData();
      this.render();
    } catch (error) {
      console.error('Failed to load character:', error);
      parchmentToast.error('Failed to load character data');
    }
  }

  /**
   * Load character, equipment, and skills data
   */
  async loadData() {
    const [charData, skillsData, equipData] = await Promise.all([
      this.game.api.getCharacter(this.characterId),
      this.game.api.getCharacterSkills(this.characterId),
      this.game.api.getInventory(this.characterId)
    ]);

    this.character = charData.character || charData;
    this.equipment = equipData.equipped || {};
    this.skills = skillsData.skills || skillsData.learnedSkills || {};
    this.availableXp = skillsData.availableXp || skillsData.xpPool ||
      ((this.character.experience || 0) - (this.character.spent_xp || this.character.spentXp || 0));

    // Load skill tree for class
    if (this.character.class) {
      try {
        this.skillTree = await this.game.api.getSkillTree(this.character.class);
      } catch (e) {
        console.warn('Could not load skill tree:', e);
      }
    }

    // Load inventory if not provided
    if (this.inventory.length === 0) {
      const invData = await this.game.api.getSharedInventory();
      this.inventory = invData.inventory || invData || [];
    }
  }

  /**
   * Render the modal content
   */
  render() {
    const contentEl = this.modal?.contentElement;
    if (!contentEl || !this.character) return;

    const char = this.character;
    const classColor = getClassColor(char.class);
    const classIcon = getClassIcon(char.class);
    const portraitUrl = this.getPortraitUrl(char);

    // Calculate XP progress using level threshold formula: level^2.8 * 100
    const spentXp = char.spent_xp || char.spentXp || 0;
    const level = char.level || 1;
    const currentThreshold = Math.floor(Math.pow(level, 2.8) * 100);
    const nextThreshold = Math.floor(Math.pow(level + 1, 2.8) * 100);
    const xpIntoLevel = Math.max(0, spentXp - currentThreshold);
    const xpNeeded = nextThreshold - currentThreshold;
    const xpPercent = xpNeeded > 0 ? Math.min(100, Math.max(0, (xpIntoLevel / xpNeeded) * 100)) : 100;

    // Check for badges
    const hasEquipmentUpgrade = this.checkHasEquipmentUpgrade();
    const hasSkillPoints = this.availableXp > 0;

    contentEl.innerHTML = `
      <div class="character-modal-content">
        <!-- Header -->
        <div class="character-modal-header">
          <div class="character-modal-portrait" style="background: ${classColor};">
            ${portraitUrl
    ? `<img src="${portraitUrl}" alt="${this.escapeHtml(char.name)}"
               onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
             <span class="character-modal-portrait-fallback" style="display: none;">${classIcon}</span>`
    : `<span class="character-modal-portrait-fallback">${classIcon}</span>`}
          </div>
          <div class="character-modal-info">
            <h3 class="character-modal-name">${this.escapeHtml(char.name)}</h3>
            <div class="character-modal-class-level">Level ${char.level} ${char.class}</div>
            <div class="character-modal-xp-bar">
              <div class="character-modal-xp-fill" style="width: ${xpPercent}%;"></div>
            </div>
            <div class="character-modal-xp-text">${xpIntoLevel.toLocaleString()} / ${xpNeeded.toLocaleString()} XP to Level ${level + 1} (${this.availableXp.toLocaleString()} available)</div>
          </div>
        </div>

        <!-- Stats Summary -->
        <div class="character-modal-stats">
          ${this.renderStatsSummary(char)}
        </div>

        <!-- Accordions -->
        <div class="character-modal-accordions">
          <div id="equipment-accordion-container"></div>
          <div id="skills-accordion-container"></div>
        </div>
      </div>
    `;

    // Create accordions
    this.createEquipmentAccordion(hasEquipmentUpgrade);
    this.createSkillsAccordion(hasSkillPoints);
  }

  /**
   * Render stats summary
   * @param {Object} char - Character data
   * @returns {string} HTML
   */
  renderStatsSummary(char) {
    const maxHp = char.hp_max || 0;
    const maxMp = char.mp_max || 0;

    const stats = [
      { label: 'HP', value: maxHp },
      { label: 'MP', value: maxMp },
      { label: 'STR', value: char.strength },
      { label: 'INT', value: char.intelligence },
      { label: 'AGI', value: char.agility },
      { label: 'VIT', value: char.vitality }
    ];

    return stats.map(s => `
      <div class="character-modal-stat">
        <span class="character-modal-stat-label">${s.label}:</span>
        <span class="character-modal-stat-value">${s.value}</span>
      </div>
    `).join('');
  }

  /**
   * Create equipment accordion
   * @param {boolean} hasUpgrades - Whether upgrades are available
   */
  createEquipmentAccordion(hasUpgrades) {
    const container = this.modal?.contentElement?.querySelector('#equipment-accordion-container');
    if (!container) return;

    this.equipmentAccordion = new Accordion({
      id: `char-${this.characterId}-equipment`,
      title: 'Equipment',
      badge: hasUpgrades ? 'Upgrades available' : null,
      defaultOpen: hasUpgrades,
      persist: true
    });

    container.appendChild(this.equipmentAccordion.element);
    this.renderEquipmentContent();
  }

  /**
   * Render equipment accordion content
   */
  renderEquipmentContent() {
    const contentEl = this.equipmentAccordion?.getContentElement();
    if (!contentEl) return;

    contentEl.innerHTML = `
      <div class="character-modal-equipment-header">
        <span></span>
        <button class="character-modal-quick-equip-btn" data-action="quick-equip">
          Quick Equip Best
        </button>
      </div>
      <div class="character-modal-equipment-list">
        ${EQUIPMENT_SLOTS.map(slot => this.renderEquipmentSlot(slot)).join('')}
      </div>
    `;

    // Event listeners
    const quickEquipBtn = contentEl.querySelector('[data-action="quick-equip"]');
    if (quickEquipBtn) {
      quickEquipBtn.addEventListener('click', () => this.handleQuickEquip());
    }

    const slots = contentEl.querySelectorAll('.character-modal-equipment-slot');
    slots.forEach(slotEl => {
      slotEl.addEventListener('click', () => {
        const slotKey = slotEl.dataset.slot;
        this.openEquipmentSlotModal(slotKey);
      });
    });
  }

  /**
   * Render a single equipment slot
   * @param {Object} slot - Slot configuration
   * @returns {string} HTML
   */
  renderEquipmentSlot(slot) {
    const item = this.equipment[slot.key];

    if (!item) {
      return `
        <div class="character-modal-equipment-slot" data-slot="${slot.key}">
          <span class="character-modal-slot-name">${slot.name}</span>
          <span class="character-modal-slot-item character-modal-slot-empty">Empty</span>
        </div>
      `;
    }

    const stats = this.getItemStatsSummary(item);

    return `
      <div class="character-modal-equipment-slot" data-slot="${slot.key}">
        <span class="character-modal-slot-name">${slot.name}</span>
        <span class="character-modal-slot-item rarity-${item.rarity || 'common'}">${this.escapeHtml(item.name)}</span>
        ${stats ? `<span class="character-modal-slot-stats">${stats}</span>` : ''}
      </div>
    `;
  }

  /**
   * Get item stats summary string
   * @param {Object} item - Item data
   * @returns {string} Stats summary
   */
  getItemStatsSummary(item) {
    const parts = [];
    if (item.attack) parts.push(`+${item.attack} ATK`);
    if (item.defense) parts.push(`+${item.defense} DEF`);

    const stats = { ...(item.baseStats || {}), ...(item.bonusStats || {}) };
    Object.entries(stats).slice(0, 2).forEach(([k, v]) => {
      if (v) {
        const abbrev = k.substring(0, 3).toUpperCase();
        parts.push(`+${v} ${abbrev}`);
      }
    });

    return parts.slice(0, 3).join(', ');
  }

  /**
   * Create skills accordion
   * @param {boolean} hasPoints - Whether skill points available
   */
  createSkillsAccordion(hasPoints) {
    const container = this.modal?.contentElement?.querySelector('#skills-accordion-container');
    if (!container) return;

    this.skillsAccordion = new Accordion({
      id: `char-${this.characterId}-skills`,
      title: 'Skills',
      badge: hasPoints ? `${this.availableXp.toLocaleString()} XP` : null,
      defaultOpen: hasPoints,
      persist: true
    });

    container.appendChild(this.skillsAccordion.element);
    this.renderSkillsContent();
  }

  /**
   * Render skills accordion content
   */
  renderSkillsContent() {
    const contentEl = this.skillsAccordion?.getContentElement();
    if (!contentEl) return;

    const branches = this.getCharacterSkills();

    if (branches.length === 0) {
      contentEl.innerHTML = `
        <div class="character-modal-loading">No skills available</div>
      `;
      return;
    }

    contentEl.innerHTML = branches.map(branch => `
      <div class="character-modal-skill-branch">
        <div class="character-modal-branch-header">${this.escapeHtml(branch.name)}</div>
        <div class="character-modal-skills-list">
          ${branch.skills.map(skill => this.renderSkillItem(skill)).join('')}
        </div>
      </div>
    `).join('');

    // Event listeners
    const skillItems = contentEl.querySelectorAll('.character-modal-skill:not(.character-modal-skill--locked)');
    skillItems.forEach(item => {
      item.addEventListener('click', () => {
        const skillId = item.dataset.skillId;
        this.openSkillDetailModal(skillId);
      });
    });
  }

  /**
   * Get character skills from skill tree organized by branch
   * @returns {Array} Branches with skills that have learned levels
   */
  getCharacterSkills() {
    if (!this.skillTree?.branches) return [];

    return this.skillTree.branches.map(branch => ({
      name: branch.name,
      skills: (branch.skills || []).map(skill => ({
        ...skill,
        currentLevel: this.skills[skill.id] || 0,
        isLocked: !this.checkSkillRequirements(skill)
      }))
    })).filter(branch => branch.skills.length > 0);
  }

  /**
   * Check if skill requirements are met
   * @param {Object} skill - Skill definition
   * @returns {boolean}
   */
  checkSkillRequirements(skill) {
    if (!skill.requires) return true;

    for (const [reqId, reqLevel] of Object.entries(skill.requires)) {
      if ((this.skills[reqId] || 0) < reqLevel) return false;
    }
    return true;
  }

  /**
   * Render a skill item
   * @param {Object} skill - Skill data
   * @returns {string} HTML
   */
  renderSkillItem(skill) {
    const lockedClass = skill.isLocked ? 'character-modal-skill--locked' : '';
    const levelText = skill.currentLevel > 0
      ? `Lv.${skill.currentLevel}/${skill.maxLevel}`
      : (skill.isLocked ? 'Locked' : 'Not learned');

    return `
      <div class="character-modal-skill ${lockedClass}" data-skill-id="${skill.id}">
        <span class="character-modal-skill-icon">${skill.icon || '⚔️'}</span>
        <span class="character-modal-skill-name">${this.escapeHtml(skill.name)}</span>
        <span class="character-modal-skill-level">${levelText}</span>
      </div>
    `;
  }

  /**
   * Check if any equipment upgrades are available
   * @returns {boolean}
   */
  checkHasEquipmentUpgrade() {
    for (const slot of EQUIPMENT_SLOTS) {
      const current = this.equipment[slot.key];
      const currentPower = this.calculateItemPower(current);

      const better = this.inventory
        .filter(item => this.canEquipInSlot(item, slot.key))
        .find(item => this.calculateItemPower(item) > currentPower);

      if (better) return true;
    }
    return false;
  }

  /**
   * Calculate item power for comparison
   * @param {Object} item - Item data
   * @returns {number} Power value
   */
  calculateItemPower(item) {
    if (!item) return 0;

    let power = (item.attack || 0) + (item.defense || 0);
    const stats = { ...(item.baseStats || {}), ...(item.bonusStats || {}) };
    Object.values(stats).forEach(v => { power += v || 0; });
    return power;
  }

  /**
   * Check if item can be equipped in slot
   * @param {Object} item - Item data
   * @param {string} slotKey - Equipment slot key
   * @returns {boolean}
   */
  canEquipInSlot(item, slotKey) {
    if (!item) return false;

    // Check level requirement
    const levelReq = item.level_requirement || item.levelRequirement || 0;
    if (levelReq > 0 && this.character && this.character.level < levelReq) {
      return false;
    }

    // Check class restriction
    const classRestriction = item.class_restriction || item.classRestriction || [];
    if (classRestriction.length > 0 && this.character && !classRestriction.includes(this.character.class)) {
      return false;
    }

    const slotMap = {
      head: ['armor'],
      body: ['armor'],
      legs: ['armor'],
      feet: ['armor'],
      main_hand: ['weapon'],
      off_hand: ['weapon', 'shield'],
      accessory: ['accessory']
    };

    const validTypes = slotMap[slotKey] || [];
    return validTypes.includes(item.type);
  }

  /**
   * Handle Quick Equip Best button
   */
  async handleQuickEquip() {
    const btn = this.modal?.contentElement?.querySelector('[data-action="quick-equip"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Equipping...';
    }

    try {
      let equipped = 0;
      let failed = 0;

      for (const slot of EQUIPMENT_SLOTS) {
        const current = this.equipment[slot.key];
        const currentPower = this.calculateItemPower(current);

        // Find best available item for this slot
        const bestItem = this.inventory
          .filter(item => this.canEquipInSlot(item, slot.key))
          .sort((a, b) => this.calculateItemPower(b) - this.calculateItemPower(a))[0];

        if (bestItem && this.calculateItemPower(bestItem) > currentPower) {
          try {
            await this.game.api.equipItem(this.characterId, bestItem.instanceId || bestItem.id, slot.key);
            equipped++;

            // Remove from available inventory
            const idx = this.inventory.findIndex(i => i.instanceId === bestItem.instanceId);
            if (idx > -1) this.inventory.splice(idx, 1);
          } catch (itemError) {
            // Log individual item failure but continue with other slots
            console.warn(`Failed to equip ${bestItem.name} in ${slot.key}:`, itemError.message);
            failed++;
          }
        }
      }

      if (equipped > 0) {
        parchmentToast.success(`Equipped ${equipped} item${equipped > 1 ? 's' : ''}`);
        await this.loadData();
        this.render();
        this.onEquipmentChanged();
      } else if (failed > 0) {
        parchmentToast.error('Could not equip any items');
      } else {
        parchmentToast.info('No better items available');
      }

    } catch (error) {
      console.error('Quick equip failed:', error);
      parchmentToast.error('Failed to equip items');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Quick Equip Best';
      }
    }
  }

  /**
   * Open equipment slot modal
   * @param {string} slotKey - Equipment slot key
   */
  async openEquipmentSlotModal(slotKey) {
    const { EquipmentSlotModal } = await import('./EquipmentSlotModal.js');

    const slot = EQUIPMENT_SLOTS.find(s => s.key === slotKey);
    const currentItem = this.equipment[slotKey];

    this.childModal = new EquipmentSlotModal({
      game: this.game,
      characterId: this.characterId,
      slotKey,
      slotName: slot?.name || slotKey,
      currentItem,
      inventory: this.inventory,
      characterClass: this.character.class,
      characterLevel: this.character.level,
      onEquipmentChanged: async () => {
        await this.loadData();
        this.render();
        this.onEquipmentChanged();
      },
      onClose: () => {
        this.childModal = null;
      }
    });

    this.childModal.open();
  }

  /**
   * Open skill detail modal
   * @param {string} skillId - Skill ID
   */
  async openSkillDetailModal(skillId) {
    const { SkillDetailModal } = await import('./SkillDetailModal.js');

    // Find skill in tree
    let skill = null;
    if (this.skillTree?.branches) {
      for (const branch of this.skillTree.branches) {
        skill = branch.skills?.find(s => s.id === skillId);
        if (skill) break;
      }
    }

    if (!skill) {
      parchmentToast.error('Skill not found');
      return;
    }

    this.childModal = new SkillDetailModal({
      game: this.game,
      characterId: this.characterId,
      skill,
      currentLevel: this.skills[skillId] || 0,
      availableXp: this.availableXp,
      learnedSkills: this.skills,
      skillTree: this.skillTree,
      onSkillLevelUp: async () => {
        // Preserve scroll position before refresh
        const scrollContainer = this.modal?.contentElement?.querySelector('.character-modal-accordions');
        const scrollTop = scrollContainer?.scrollTop || 0;

        await this.loadData();
        this.render();

        // Restore scroll position after render
        const newScrollContainer = this.modal?.contentElement?.querySelector('.character-modal-accordions');
        if (newScrollContainer) {
          newScrollContainer.scrollTop = scrollTop;
        }

        this.onSkillLevelUp();
      },
      onClose: () => {
        this.childModal = null;
      }
    });

    this.childModal.open();
  }

  /**
   * Close the modal
   */
  close() {
    if (this.childModal) {
      this.childModal.close();
    }
    if (this.modal) {
      this.modal.close();
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
   * Get portrait URL for character
   * @param {Object} character - Character data
   * @returns {string|null} Portrait URL or null if no race/gender
   */
  getPortraitUrl(character) {
    const race = character.race?.toLowerCase();
    const charClass = character.class?.toLowerCase();
    // Handle gender with fallback (API may use snake_case or camelCase)
    let gender = character.gender || 'male';
    gender = gender.toLowerCase();

    if (!race || !charClass) return null;

    // Use shared module for consistent path construction
    // Display size is 64px, so use optimal size (64px)
    const id = `${race}_${gender}_${charClass}`;
    const optimalSize = getOptimalSize('portraits', 64);
    return getAssetPath('portraits', id, { size: optimalSize });
  }

  /**
   * Clean up resources
   */
  cleanup() {
    if (this.equipmentAccordion) {
      this.equipmentAccordion.destroy();
      this.equipmentAccordion = null;
    }
    if (this.skillsAccordion) {
      this.skillsAccordion.destroy();
      this.skillsAccordion = null;
    }
    if (this.equipmentTable) {
      this.equipmentTable.destroy();
      this.equipmentTable = null;
    }
    if (this.childModal) {
      this.childModal.close();
      this.childModal = null;
    }
    this.modal = null;
  }
}

export default CharacterModal;
