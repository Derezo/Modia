import { Scene } from './Scene.js';
import { CharacterCard } from '../components/CharacterCard.js';
import { PartyStatsSummary } from '../components/PartyStatsSummary.js';
import { CharacterModal } from '../components/modals/CharacterModal.js';
import { ItemsModal } from '../components/modals/ItemsModal.js';
import { parchmentToast } from '../ui/parchment/ParchmentToast.js';
import { PARCHMENT_COLORS, PARCHMENT_SPACING, getParchmentGradient, getParchmentScrollbarCSS } from '../ui/parchment/ParchmentTheme.js';
import { responsive } from '../core/Responsive.js';
import { Icon } from '../components/Icon.js';

/**
 * FormationScene - Unified party management hub
 *
 * Features:
 * - Character card grid with badge indicators
 * - Party stats summary bar
 * - Items button opens inventory modal
 * - Click character to open character modal
 * - Modal-based equipment and skill management
 */
export class FormationScene extends Scene {
  constructor(game) {
    super(game);
    this.uiElement = null;
    this.characters = [];
    this.inventory = [];
    this.abortController = null;
    this.characterCards = [];
    this.partySummary = null;
    this.activeModal = null;
    this.responsiveUnsubscribe = null;
    this.sortMethod = 'level';  // 'level' | 'class' | 'name'
    this.mainCharacterId = null;
  }

  async enter() {
    await this.loadData();
    this.createUI();
    this.setupEventListeners();

    // Subscribe to responsive breakpoint changes
    this.responsiveUnsubscribe = responsive.onChange(() => this.onBreakpointChange());

    // Continue exploration music (same as world map)
    if (this.game.musicContext) {
      this.game.musicContext.playExplorationMusic();
    }
  }

  exit() {
    if (this.responsiveUnsubscribe) {
      this.responsiveUnsubscribe();
      this.responsiveUnsubscribe = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.cleanupCards();
    this.cleanupPartySummary(); // Finding 67/94: cleanup summary on exit
    if (this.activeModal) {
      this.activeModal.close();
      this.activeModal = null;
    }
    if (this.uiElement) {
      this.uiElement.remove();
      this.uiElement = null;
    }
  }

  /**
   * Clean up character cards (Finding 67/94: separated from partySummary cleanup)
   */
  cleanupCards() {
    this.characterCards.forEach(card => card.destroy());
    this.characterCards = [];
    // Note: partySummary cleanup moved to cleanupPartySummary() to prevent
    // destroying the summary when re-rendering cards
  }

  /**
   * Clean up party stats summary (Finding 67/94)
   * Call this when the scene exits or before creating a new summary
   */
  cleanupPartySummary() {
    if (this.partySummary) {
      this.partySummary.destroy();
      this.partySummary = null;
    }
  }

  /**
   * Handle responsive breakpoint changes
   */
  onBreakpointChange() {
    if (this.uiElement) {
      this.uiElement.remove();
      this.cleanupCards();
      this.cleanupPartySummary(); // Finding 67/94: cleanup summary before rebuilding
      this.createUI();
      this.setupEventListeners();
    }
  }

  /**
   * Load characters and inventory data
   */
  async loadData() {
    try {
      const [charResult, invResult] = await Promise.all([
        this.game.api.getCharacters(),
        this.game.api.getSharedInventory()
      ]);
      this.characters = charResult.characters || [];
      this.inventory = invResult.inventory || invResult || [];

      // Identify main character (oldest by created_at)
      this.mainCharacterId = null;
      if (this.characters.length > 0) {
        const sorted = [...this.characters].sort((a, b) =>
          new Date(a.created_at) - new Date(b.created_at)
        );
        this.mainCharacterId = sorted[0].id;
      }
    } catch (err) {
      console.error('Failed to load data:', err);
      parchmentToast.error('Failed to load party data');
    }
  }

  /**
   * Create the UI
   */
  createUI() {
    const container = document.createElement('div');
    container.id = 'formation-scene';

    const isMobile = responsive.isMobile();
    const isTablet = responsive.isTablet();

    // Calculate grid columns based on viewport
    let gridCols = 'repeat(4, 1fr)';
    if (isMobile) gridCols = 'repeat(2, 1fr)';
    else if (isTablet) gridCols = 'repeat(3, 1fr)';

    container.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: ${getParchmentGradient('135deg')};
      display: flex;
      flex-direction: column;
      font-family: Georgia, serif;
    `;

    // Finding 108: Always show title even on mobile; Icon.html will hide text but keep tooltip
    const showLabelText = responsive.showLabels();

    container.innerHTML = `
      <!-- Header -->
      <div class="formation-header">
        <h2 class="formation-title">
          ${Icon.html('menu', 'formation', { size: 'lg' })}
          ${showLabelText ? 'Party Formation' : 'Party'}
        </h2>
        <div class="formation-header-actions">
          <button class="parchment-btn parchment-btn-primary" id="items-btn" aria-label="Items">
            ${Icon.html('menu', 'inventory', { label: 'Items', size: 'md' })}
          </button>
          <button class="parchment-btn parchment-btn-secondary" id="back-btn" aria-label="Back">
            ${Icon.html('menu', 'back', { label: 'Back', size: 'md' })}
          </button>
        </div>
      </div>

      <!-- Sort Controls -->
      <div class="formation-sort-bar">
        <span class="formation-sort-label">Sort by:</span>
        <div class="formation-sort-buttons">
          <button class="formation-sort-btn ${this.sortMethod === 'level' ? 'active' : ''}" data-sort="level">Level</button>
          <button class="formation-sort-btn ${this.sortMethod === 'class' ? 'active' : ''}" data-sort="class">Class</button>
          <button class="formation-sort-btn ${this.sortMethod === 'name' ? 'active' : ''}" data-sort="name">Name</button>
        </div>
      </div>

      <!-- Party Stats Summary -->
      <div id="party-summary-container"></div>

      <!-- Character Grid -->
      <div class="formation-grid-container">
        <div id="character-grid" class="formation-character-grid" style="grid-template-columns: ${gridCols};">
        </div>
      </div>
    `;

    this.addStyles();
    this.game.uiOverlay.appendChild(container);
    this.uiElement = container;

    // Render party summary
    this.renderPartySummary();

    // Render character cards
    this.renderCharacterCards();
  }

  /**
   * Add component styles
   */
  addStyles() {
    if (document.getElementById('formation-styles')) return;

    const style = document.createElement('style');
    style.id = 'formation-styles';
    style.textContent = `
      /* Header */
      .formation-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        background: linear-gradient(to bottom, ${PARCHMENT_COLORS.dark}, ${PARCHMENT_COLORS.borderDark});
        border-bottom: 2px solid ${PARCHMENT_COLORS.borderDark};
      }

      .formation-title {
        margin: 0;
        color: ${PARCHMENT_COLORS.text.inverse};
        font-size: 20px;
        text-shadow: 1px 1px 2px rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.sm};
      }

      .formation-header-actions {
        display: flex;
        gap: ${PARCHMENT_SPACING.sm};
      }

      /* Parchment Button Styles */
      .parchment-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 16px;
        font-family: Georgia, serif;
        font-size: 13px;
        border: 2px solid ${PARCHMENT_COLORS.border};
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.15s ease;
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      .parchment-btn-primary {
        background: linear-gradient(to bottom, #4a7c4e, #3d6940);
        color: white;
        border-color: #2d5030;
        text-shadow: 0 1px 2px rgba(0,0,0,0.3);
      }

      .parchment-btn-primary:hover {
        background: linear-gradient(to bottom, #5a8c5e, #4d7950);
      }

      .parchment-btn-secondary {
        background: linear-gradient(to bottom, ${PARCHMENT_COLORS.light}, ${PARCHMENT_COLORS.mid});
        color: ${PARCHMENT_COLORS.text.primary};
      }

      .parchment-btn-secondary:hover {
        background: linear-gradient(to bottom, ${PARCHMENT_COLORS.mid}, ${PARCHMENT_COLORS.dark});
        border-color: ${PARCHMENT_COLORS.borderDark};
      }

      /* Grid Container */
      .formation-grid-container {
        flex: 1;
        overflow-y: auto;
        padding: ${PARCHMENT_SPACING.md};
        background: ${PARCHMENT_COLORS.light};
      }

      ${getParchmentScrollbarCSS('.formation-grid-container')}

      /* Character Grid */
      .formation-character-grid {
        display: grid;
        gap: ${PARCHMENT_SPACING.md};
        max-width: 800px;
        margin: 0 auto;
      }

      /* Empty Slot */
      .formation-empty-slot {
        aspect-ratio: 1;
        max-width: 160px;
        background: ${PARCHMENT_COLORS.mid};
        border: 2px dashed ${PARCHMENT_COLORS.border};
        border-radius: 8px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: ${PARCHMENT_COLORS.text.muted};
        opacity: 0.6;
      }

      .formation-empty-slot.battle-slot {
        border-color: ${PARCHMENT_COLORS.state.success};
        opacity: 0.8;
      }

      .formation-empty-slot-icon {
        font-size: 32px;
        margin-bottom: ${PARCHMENT_SPACING.xs};
      }

      .formation-empty-slot-text {
        font-size: 12px;
        font-style: italic;
      }

      /* Sort Bar */
      .formation-sort-bar {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.sm};
        padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.md};
        background: ${PARCHMENT_COLORS.mid};
        border-bottom: 1px solid ${PARCHMENT_COLORS.border};
      }

      .formation-sort-label {
        color: ${PARCHMENT_COLORS.text.secondary};
        font-size: 12px;
        font-weight: bold;
      }

      .formation-sort-buttons {
        display: flex;
        gap: 4px;
      }

      .formation-sort-btn {
        padding: 4px 12px;
        font-family: Georgia, serif;
        font-size: 12px;
        background: ${PARCHMENT_COLORS.light};
        border: 1px solid ${PARCHMENT_COLORS.border};
        border-radius: 4px;
        cursor: pointer;
        color: ${PARCHMENT_COLORS.text.secondary};
        transition: all 0.15s ease;
      }

      .formation-sort-btn:hover {
        background: ${PARCHMENT_COLORS.dark};
        color: ${PARCHMENT_COLORS.text.primary};
      }

      .formation-sort-btn.active {
        background: linear-gradient(to bottom, #4a7c4e, #3d6940);
        color: white;
        border-color: #2d5030;
      }

      /* Responsive adjustments */
      @media (max-width: 600px) {
        .formation-header {
          padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.sm};
        }
        .formation-sort-bar {
          padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.sm};
        }
        .formation-grid-container {
          padding: ${PARCHMENT_SPACING.sm};
        }
        .formation-character-grid {
          gap: ${PARCHMENT_SPACING.sm};
        }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Render party stats summary
   * Finding 67/94: Clean up previous summary before creating new one
   */
  renderPartySummary() {
    const container = this.uiElement?.querySelector('#party-summary-container');
    if (!container) return;

    // Destroy previous summary to prevent stacking and memory leaks
    this.cleanupPartySummary();

    this.partySummary = new PartyStatsSummary({
      characters: this.characters,
      inventory: this.inventory
    });

    container.appendChild(this.partySummary.element);
  }

  /**
   * Get sorted characters based on current sort method
   * @returns {Array} Sorted characters
   */
  getSortedCharacters() {
    const chars = [...this.characters];
    switch (this.sortMethod) {
      case 'level':
        // Primary: level descending, secondary: name ascending for stability
        return chars.sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
      case 'class':
        // Primary: class alphabetical, secondary: level descending
        return chars.sort((a, b) => a.class.localeCompare(b.class) || b.level - a.level);
      case 'name':
        return chars.sort((a, b) => a.name.localeCompare(b.name));
      default:
        return chars;
    }
  }

  /**
   * Render character cards in the grid
   */
  renderCharacterCards() {
    const grid = this.uiElement?.querySelector('#character-grid');
    if (!grid) return;

    // Clear existing cards
    this.cleanupCards();
    grid.innerHTML = '';

    // Get sorted characters and render only existing ones (no empty slots)
    const sortedChars = this.getSortedCharacters();

    sortedChars.forEach(char => {
      // Check for upgrade indicators
      const hasEquipmentUpgrade = this.checkHasEquipmentUpgrade(char);
      const hasSkillPoints = this.checkHasSkillPoints(char);
      const isMainCharacter = char.id === this.mainCharacterId;

      const card = new CharacterCard({
        character: char,
        showUpgradeBadge: hasEquipmentUpgrade,
        showSkillBadge: hasSkillPoints,
        showLeaderBadge: isMainCharacter,
        onClick: () => this.openCharacterModal(char)
      });

      grid.appendChild(card.element);
      this.characterCards.push(card);
    });
  }

  /**
   * Check if character has equipment upgrades available
   * Finding 68: Code defensively for both old (no equipment) and new (with equipment) API shapes.
   * If equipment data is not available, we cannot determine upgrades so return false.
   * @param {Object} character - Character data
   * @returns {boolean}
   */
  checkHasEquipmentUpgrade(character) {
    // Support both 'equipment' and 'equipped' keys for API compatibility
    const equipment = character.equipment || character.equipped || null;

    // If equipment data is not loaded, we cannot determine upgrades
    // This prevents false positives when API doesn't include equipment
    if (!equipment || typeof equipment !== 'object') {
      return false;
    }

    // Only check slots that have content - legs and off_hand have no templates currently
    const slots = ['head', 'body', 'main_hand', 'feet', 'accessory'];

    for (const slot of slots) {
      const current = equipment[slot];
      const currentPower = this.calculateItemPower(current);

      const better = this.inventory
        .filter(item => this.canEquipInSlot(item, slot, character.class, character.level))
        .find(item => this.calculateItemPower(item) > currentPower);

      if (better) return true;
    }
    return false;
  }

  /**
   * Check if character has unspent skill points
   * @param {Object} character - Character data
   * @returns {boolean}
   */
  checkHasSkillPoints(character) {
    const experience = character.experience || 0;
    const spentXp = character.spent_xp || character.spentXp || 0;
    return (experience - spentXp) > 0;
  }

  /**
   * Calculate item power for comparison
   * @param {Object} item - Item data
   * @returns {number}
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
   * Finding 68/111: Added level check, equipment slot check, and snake_case support
   * @param {Object} item - Item data
   * @param {string} slotKey - Slot key
   * @param {string} charClass - Character class
   * @param {number} charLevel - Character level
   * @returns {boolean}
   */
  canEquipInSlot(item, slotKey, charClass, charLevel = 1) {
    if (!item) return false;

    // Check level requirement (support both camelCase and snake_case)
    const levelReq = item.levelRequirement ?? item.level_requirement ?? 1;
    if (charLevel < levelReq) return false;

    // Check equipment slot matches (Finding 111)
    // Support both camelCase and snake_case for API compatibility
    const itemSlot = item.equipmentSlot ?? item.equipment_slot ?? null;
    if (itemSlot && itemSlot !== slotKey) return false;

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
    if (!validTypes.includes(item.type)) return false;

    // Check class restrictions (support both camelCase and snake_case)
    const restrictions = item.classRestrictions ?? item.class_restriction ?? null;
    if (restrictions) {
      const restrArray = Array.isArray(restrictions) ? restrictions : [restrictions];
      if (restrArray.length > 0) {
        const allowed = restrArray.some(c => c.toLowerCase() === charClass?.toLowerCase());
        if (!allowed) return false;
      }
    }

    return true;
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    this.abortController = new AbortController();
    const opts = { signal: this.abortController.signal };

    // Back button
    this.uiElement?.querySelector('#back-btn')?.addEventListener('click', () => {
      this.game.audio?.playUI('button_click');
      this.game.scenes.switchTo('worldMap');
    }, opts);

    // Items button
    this.uiElement?.querySelector('#items-btn')?.addEventListener('click', () => {
      this.game.audio?.playUI('button_click');
      this.openItemsModal();
    }, opts);

    // Sort buttons
    this.uiElement?.querySelectorAll('.formation-sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.game.audio?.playUI('button_click');
        const newSort = btn.dataset.sort;
        if (newSort !== this.sortMethod) {
          this.sortMethod = newSort;
          // Update button active states
          this.uiElement?.querySelectorAll('.formation-sort-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.sort === newSort);
          });
          // Re-render character cards with new sort
          this.renderCharacterCards();
        }
      }, opts);
    });
  }

  /**
   * Open items modal
   */
  openItemsModal() {
    if (this.activeModal) {
      this.activeModal.close();
    }

    this.activeModal = new ItemsModal({
      game: this.game,
      onItemUsed: async () => {
        await this.loadData();
        this.renderPartySummary();
        this.renderCharacterCards();
      },
      onClose: () => {
        this.activeModal = null;
      }
    });

    this.activeModal.open();
  }

  /**
   * Open character modal
   * @param {Object} character - Character data
   */
  openCharacterModal(character) {
    if (this.activeModal) {
      this.activeModal.close();
    }

    this.activeModal = new CharacterModal({
      game: this.game,
      characterId: character.id,
      inventory: this.inventory,
      onEquipmentChanged: async () => {
        await this.loadData();
        this.renderPartySummary();
        this.renderCharacterCards();
      },
      onSkillLevelUp: async () => {
        await this.loadData();
        this.renderPartySummary();
        this.renderCharacterCards();
      },
      onClose: () => {
        this.activeModal = null;
      }
    });

    this.activeModal.open();
  }

  /**
   * Refresh the scene data and UI
   */
  async refresh() {
    await this.loadData();
    this.renderPartySummary();
    this.renderCharacterCards();
  }

  update(_deltaTime) {
    // No per-frame updates needed
  }

  render(ctx) {
    // UI is HTML-based, fill background for any canvas elements
    ctx.fillStyle = PARCHMENT_COLORS.mid;
    ctx.fillRect(0, 0, this.game.targetWidth, this.game.targetHeight);
  }
}
