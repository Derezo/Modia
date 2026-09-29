import { Scene } from './Scene.js';
import { ParchmentCard } from '../components/ParchmentCard.js';
import { responsive } from '../core/Responsive.js';
import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_SPACING,
  PARCHMENT_RADIUS,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentShadow,
  getParchmentInputCSS,
  getParchmentButtonCSS
} from '../ui/parchment/index.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import {
  RACES,
  CLASSES,
  GENDERS,
  renderOptionArt,
  refreshOptionArt,
  bindOptionArtFallback,
  getOptionArtCSS
} from './auth/characterOptions.js';

// Local alias for cleaner access
const P = PARCHMENT_COLORS;

const STYLE_ID = 'charcreate-scene-styles';
/** Display face used by the login card (preloaded by AuthScene), with the parchment serif as fallback. */
const DISPLAY_FONT = `'Cinzel Decorative', ${PARCHMENT_TYPOGRAPHY.fontFamily}`;
const DEFAULT_PREVIEW_NAME = 'Your Hero';

// Racial trait data for preview before API call
const RACIAL_TRAITS = {
  human: { name: 'Quick Learner', description: '+10% experience gained', type: 'racial' },
  elf: { name: 'Arcane Flow', description: '+20% MP regeneration', type: 'racial' },
  dwarf: { name: 'Lucky Find', description: '+15% gold from battles', type: 'racial' },
  vampire: { name: 'Blood Hunger', description: '10% of damage dealt heals HP', type: 'racial' },
  orc: { name: 'Savage Strikes', description: '+25% critical hit damage', type: 'racial' }
};

export class CharacterCreateScene extends Scene {
  constructor(game) {
    super(game);
    this.uiElement = null;
    this.selectedRace = null;
    this.selectedClass = null;
    this.selectedGender = null;
    this.loading = false;
    this.isWizardMode = false;
    this.previewCard = null;
    this.previewData = null;
    this.previewFetchAbort = null;

    // Responsive subscription
    this._responsiveUnsubscribe = null;
  }

  enter() {
    this.selectedRace = null;
    this.selectedClass = null;
    this.selectedGender = null;
    this.loading = false;
    this.isWizardMode = this.game.state.get('isNewRegistration') === true;
    this.previewData = null;
    this.addStyles();
    this.createUI();

    // Subscribe to responsive breakpoint changes
    this._responsiveUnsubscribe = responsive.onChange(() => this.onBreakpointChange());

    // Play character creation music
    if (this.game.musicContext) {
      this.game.musicContext.playCharacterCreate();
    }
  }

  exit() {
    // Unsubscribe from responsive changes
    if (this._responsiveUnsubscribe) {
      this._responsiveUnsubscribe();
      this._responsiveUnsubscribe = null;
    }

    // Cancel pending preview fetch
    if (this.previewFetchAbort) {
      this.previewFetchAbort.abort();
      this.previewFetchAbort = null;
    }

    // Clean up preview card
    if (this.previewCard) {
      this.previewCard.destroy();
      this.previewCard = null;
    }

    if (this.uiElement) {
      this.uiElement.remove();
      this.uiElement = null;
    }
    // Clean up styles
    const styleEl = document.getElementById(STYLE_ID);
    if (styleEl) styleEl.remove();
  }

  addStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .charcreate-container {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 900px;
        max-width: 95%;
      }

      .charcreate-title {
        color: ${P.text.primary};
        font-family: ${DISPLAY_FONT};
        font-size: 30px;
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.2);
        margin-bottom: ${PARCHMENT_SPACING.lg};
        text-align: center;
        letter-spacing: 1px;
      }

      .charcreate-panel {
        background: ${getParchmentGradient()};
        border: ${getParchmentBorder()};
        box-shadow: ${getParchmentShadow(true)};
        border-radius: ${PARCHMENT_RADIUS.lg};
        padding: ${PARCHMENT_SPACING.xl};
      }

      .charcreate-layout {
        display: grid;
        grid-template-columns: 1fr 1fr;
        align-items: start;
        gap: 24px;
      }

      .charcreate-selection-panel {
        display: flex;
        flex-direction: column;
        gap: ${PARCHMENT_SPACING.md};
      }

      .charcreate-preview-panel {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 20px;
        background: rgba(212, 196, 168, 0.3);
        border-radius: 8px;
        border: 1px solid rgba(139, 115, 85, 0.3);
      }

      .charcreate-preview-title {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${P.text.secondary};
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-bottom: ${PARCHMENT_SPACING.xs};
        font-family: ${DISPLAY_FONT};
      }

      .charcreate-preview-card-wrapper {
        display: flex;
        justify-content: center;
      }

      .charcreate-preview-card-wrapper .parchment-card {
        min-width: 280px;
        width: 100%;
        max-width: 320px;
      }

      .charcreate-traits-section {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .charcreate-trait-placeholder {
        color: ${P.text.muted};
        font-style: italic;
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        padding: 8px 12px;
        background: rgba(0, 0, 0, 0.05);
        border-radius: ${PARCHMENT_RADIUS.sm};
        text-align: center;
      }

      .charcreate-error {
        background: rgba(139, 68, 68, 0.15);
        border: 1px solid ${P.state.error};
        border-radius: ${PARCHMENT_RADIUS.sm};
        color: ${P.state.error};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        margin-bottom: ${PARCHMENT_SPACING.md};
        animation: charcreate-shake 0.4s ease;
      }

      .charcreate-form-group {
        text-align: left;
      }

      .charcreate-label {
        display: block;
        color: ${P.text.primary};
        font-family: ${DISPLAY_FONT};
        font-size: 13px;
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        letter-spacing: 1px;
        margin-bottom: ${PARCHMENT_SPACING.xs};
      }

      .charcreate-input {
        width: 100%;
        box-sizing: border-box;
        ${getParchmentInputCSS()}
        /* Body font: the display face renders as capitals, so typed names
           and placeholders were hard to read. */
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        letter-spacing: 0.5px;
      }

      .charcreate-input:focus {
        border-color: ${P.borderDark};
        box-shadow: 0 0 0 2px rgba(139, 115, 85, 0.2);
      }

      .charcreate-input::placeholder {
        color: ${P.text.muted};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        text-transform: none;
      }

      /* One row per group: a fixed column count per group means the last
         tile (e.g. the 5th race) never wraps onto its own stretched row. */
      .charcreate-option-grid,
      .charcreate-gender-grid {
        display: grid;
        grid-template-columns: repeat(var(--charcreate-cols, 4), minmax(0, 1fr));
        gap: ${PARCHMENT_SPACING.sm};
      }

      .charcreate-option {
        min-width: 0;
        padding: ${PARCHMENT_SPACING.md} ${PARCHMENT_SPACING.sm};
        background: ${P.light};
        border: 2px solid ${P.border};
        border-radius: ${PARCHMENT_RADIUS.md};
        text-align: center;
        cursor: pointer;
        transition: all 0.2s ease;
        font-family: ${DISPLAY_FONT};
      }

      .charcreate-option:hover {
        background: ${P.mid};
        border-color: ${P.borderDark};
        transform: translateY(-2px);
      }

      .charcreate-option.selected {
        border-color: ${P.accent.burgundy};
        background: ${P.mid};
        box-shadow: 0 0 0 2px ${P.accent.burgundy}, ${getParchmentShadow()};
      }

      ${getOptionArtCSS('charcreate', {
    size: 48,
    borderColor: P.border,
    background: P.mid,
    textColor: P.text.secondary,
    fontFamily: DISPLAY_FONT
  })}

      .charcreate-option.selected .charcreate-option-art,
      .charcreate-gender-option.selected .charcreate-option-art {
        border-color: ${P.accent.burgundy};
      }

      .charcreate-option-name {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${P.text.primary};
        margin-top: ${PARCHMENT_SPACING.xs};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .charcreate-desc {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${P.text.muted};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        margin-top: ${PARCHMENT_SPACING.xs};
        min-height: 16px;
        font-style: italic;
      }

      .charcreate-gender-option {
        min-width: 0;
        padding: ${PARCHMENT_SPACING.md} ${PARCHMENT_SPACING.sm};
        background: ${P.light};
        border: 2px solid ${P.border};
        border-radius: ${PARCHMENT_RADIUS.md};
        text-align: center;
        cursor: pointer;
        transition: all 0.2s ease;
        font-family: ${DISPLAY_FONT};
      }

      .charcreate-gender-option:hover {
        background: ${P.mid};
        border-color: ${P.borderDark};
      }

      .charcreate-gender-option.selected {
        border-color: ${P.accent.burgundy};
        background: ${P.mid};
        box-shadow: 0 0 0 2px ${P.accent.burgundy};
      }

      .charcreate-gender-name {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        color: ${P.text.primary};
        margin-top: ${PARCHMENT_SPACING.xs};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      }

      .charcreate-button-row {
        display: flex;
        gap: ${PARCHMENT_SPACING.sm};
        margin-top: ${PARCHMENT_SPACING.lg};
      }

      .charcreate-btn {
        ${getParchmentButtonCSS('primary')}
        font-family: ${DISPLAY_FONT};
        letter-spacing: 1px;
      }

      .charcreate-btn:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1);
      }

      .charcreate-btn:active:not(:disabled) {
        transform: translateY(0);
      }

      .charcreate-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .charcreate-btn-secondary {
        ${getParchmentButtonCSS('secondary')}
        font-family: ${DISPLAY_FONT};
        letter-spacing: 1px;
      }

      .charcreate-btn-secondary:hover:not(:disabled) {
        background: ${P.mid};
        border-color: ${P.borderDark};
      }

      .charcreate-btn-primary {
        flex: 1;
      }

      .charcreate-btn.btn-loading {
        background: ${P.border};
      }

      .charcreate-back-row {
        display: flex;
        justify-content: flex-start;
        margin-top: ${PARCHMENT_SPACING.lg};
        padding-top: ${PARCHMENT_SPACING.md};
        border-top: 1px solid rgba(139, 115, 85, 0.2);
      }

      @keyframes charcreate-shake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-5px); }
        75% { transform: translateX(5px); }
      }

      /* Tablet breakpoint */
      @media (max-width: 768px) {
        .charcreate-container {
          width: 95%;
        }

        .charcreate-layout {
          grid-template-columns: 1fr;
        }

        .charcreate-preview-panel {
          order: -1;
        }

        .charcreate-option {
          padding: ${PARCHMENT_SPACING.sm};
        }

        .charcreate-option-name {
          font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        }
      }

      /* Mobile breakpoint - enhanced touch targets and font floors */
      @media (max-width: 600px) {
        .charcreate-container {
          width: 100%;
          max-width: 100%;
          top: 0;
          left: 0;
          transform: none;
          height: 100%;
          position: absolute;
          overflow-y: auto;
        }

        .charcreate-title {
          font-size: 24px;
          margin-bottom: ${PARCHMENT_SPACING.md};
        }

        .charcreate-panel {
          padding: ${PARCHMENT_SPACING.md};
          border-radius: 0;
        }

        .charcreate-option-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .charcreate-option {
          min-height: var(--touch-target, 44px);
          padding: ${PARCHMENT_SPACING.sm};
        }

        .charcreate-option-name {
          font-size: var(--font-size-sm, 12px);
        }

        .charcreate-gender-option {
          min-height: var(--touch-target, 44px);
          padding: ${PARCHMENT_SPACING.sm};
        }

        .charcreate-gender-name {
          font-size: var(--font-size-sm, 12px);
        }

        .charcreate-btn,
        .charcreate-btn-secondary {
          min-height: var(--touch-target, 44px);
          font-size: var(--font-size-md, 14px);
        }

        .charcreate-input {
          min-height: var(--input-height, 44px);
          font-size: var(--font-size-md, 14px);
        }

        .charcreate-label {
          font-size: var(--font-size-sm, 12px);
        }

        .charcreate-desc {
          font-size: var(--font-size-sm, 12px);
        }

        .charcreate-preview-panel {
          padding: ${PARCHMENT_SPACING.md};
        }

        .charcreate-button-row {
          margin-top: ${PARCHMENT_SPACING.md};
        }
      }
    `;

    document.head.appendChild(style);
  }

  createUI() {
    const container = document.createElement('div');
    container.className = 'charcreate-container';

    container.innerHTML = `
      <h1 class="charcreate-title">${this.isWizardMode ? 'Create Your Hero' : 'Create Character'}</h1>
      <div class="charcreate-panel">
        <div id="create-error" class="charcreate-error" style="display: none;"></div>

        <div class="charcreate-layout">
          <!-- Left Column: Selection Panel -->
          <div class="charcreate-selection-panel">
            <div class="charcreate-form-group">
              <label class="charcreate-label">Race</label>
              <div id="race-select" class="charcreate-option-grid" style="--charcreate-cols: ${RACES.length}">
                ${RACES.map(race => `
                  <div class="charcreate-option" data-race="${race.id}">
                    ${renderOptionArt('charcreate', 'race', race, this.getSelection())}
                    <div class="charcreate-option-name">${escapeHtml(race.name)}</div>
                  </div>
                `).join('')}
              </div>
              <div id="race-desc" class="charcreate-desc"></div>
            </div>

            <div class="charcreate-form-group">
              <label class="charcreate-label">Class</label>
              <div id="class-select" class="charcreate-option-grid" style="--charcreate-cols: ${CLASSES.length}">
                ${CLASSES.map(cls => `
                  <div class="charcreate-option" data-class="${cls.id}">
                    ${renderOptionArt('charcreate', 'class', cls, this.getSelection())}
                    <div class="charcreate-option-name">${escapeHtml(cls.name)}</div>
                  </div>
                `).join('')}
              </div>
              <div id="class-desc" class="charcreate-desc"></div>
            </div>

            <div class="charcreate-form-group">
              <label class="charcreate-label">Gender</label>
              <div id="gender-select" class="charcreate-gender-grid" style="--charcreate-cols: ${GENDERS.length}">
                ${GENDERS.map(gender => `
                  <div class="charcreate-gender-option" data-gender="${gender.id}">
                    ${renderOptionArt('charcreate', 'gender', gender, this.getSelection())}
                    <div class="charcreate-gender-name">${escapeHtml(gender.name)}</div>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>

          <!-- Right Column: Preview Panel -->
          <div class="charcreate-preview-panel">
            <div class="charcreate-preview-title">Character Preview</div>
            <div id="preview-card-container" class="charcreate-preview-card-wrapper"></div>

            <div class="charcreate-traits-section">
              <div class="charcreate-preview-title">Traits</div>
              <div id="traits-placeholder" class="charcreate-trait-placeholder">
                Select race and class to see traits
              </div>
            </div>

            <div class="charcreate-form-group">
              <label for="char-name" class="charcreate-label">Character Name</label>
              <input type="text" id="char-name" class="charcreate-input" placeholder="2-24 characters" maxlength="24" required>
            </div>

            <div class="charcreate-button-row">
              <button class="charcreate-btn charcreate-btn-primary" id="create-btn" disabled>Create Character</button>
            </div>
          </div>
        </div>

        <!-- Back button row (outside columns) -->
        <div class="charcreate-back-row" ${this.isWizardMode ? 'style="display:none;"' : ''}>
          <button class="charcreate-btn charcreate-btn-secondary" id="back-btn">Back</button>
        </div>
      </div>
    `;

    this.game.uiOverlay.appendChild(container);
    this.uiElement = container;

    // Create ParchmentCard for preview
    this.previewCard = new ParchmentCard({
      mode: 'detailed',
      showTraits: true,
      showStats: true
    });
    const cardContainer = container.querySelector('#preview-card-container');
    cardContainer.appendChild(this.previewCard.element);

    bindOptionArtFallback(container);

    // Race selection
    container.querySelectorAll('.charcreate-option[data-race]').forEach(option => {
      option.addEventListener('click', () => {
        this.game.audio?.playUI('button_click');
        this.selectedRace = option.dataset.race;
        this.updateRaceSelection();
        this.updatePreview();
      });
    });

    // Class selection
    container.querySelectorAll('.charcreate-option[data-class]').forEach(option => {
      option.addEventListener('click', () => {
        this.game.audio?.playUI('button_click');
        this.selectedClass = option.dataset.class;
        this.updateClassSelection();
        this.updatePreview();
      });
    });

    // Gender selection
    container.querySelectorAll('.charcreate-gender-option').forEach(option => {
      option.addEventListener('click', () => {
        this.game.audio?.playUI('button_click');
        this.selectedGender = option.dataset.gender;
        this.updateGenderSelection();
        this.updatePreview();
      });
    });

    // Buttons
    container.querySelector('#back-btn').addEventListener('click', () => {
      this.game.audio?.playUI('button_click');
      const characters = this.game.state.get('characters') || [];
      if (characters.length > 0) {
        // Go back to world map if user has characters (e.g., accessed from recruitment)
        this.game.scenes.switchTo('worldMap');
      } else {
        this.game.scenes.switchTo('login');
      }
    });

    container.querySelector('#create-btn').addEventListener('click', () => {
      this.game.audio?.playUI('button_click');
      this.handleCreate();
    });

    // Name input validation
    container.querySelector('#char-name').addEventListener('input', () => {
      this.updateCreateButton();
      this.updatePreviewName();
    });

    // Initialize with empty state
    this.updatePreview();
  }

  /** Current race/class/gender choices, in the shape characterOptions expects. */
  getSelection() {
    return {
      race: this.selectedRace,
      characterClass: this.selectedClass,
      gender: this.selectedGender
    };
  }

  /** Point every tile's portrait at its option combined with the other current choices. */
  refreshOptionArt() {
    refreshOptionArt(this.uiElement, this.getSelection());
  }

  /** Display name for the preview card: the typed name, or a placeholder. */
  getPreviewName() {
    const typed = this.uiElement?.querySelector('#char-name')?.value || '';
    return typed.trim() || DEFAULT_PREVIEW_NAME;
  }

  /**
   * Update only the preview card's name, on every keystroke, without
   * refetching stats. No-op until a race or class has put a card on screen.
   */
  updatePreviewName() {
    if (!this.previewCard?.character) return;
    const name = this.getPreviewName();
    if (this.previewCard.character.name === name) return;
    this.previewCard.update({ name });
  }

  updateRaceSelection() {
    this.uiElement.querySelectorAll('.charcreate-option[data-race]').forEach(option => {
      if (option.dataset.race === this.selectedRace) {
        option.classList.add('selected');
      } else {
        option.classList.remove('selected');
      }
    });

    const race = RACES.find(r => r.id === this.selectedRace);
    document.getElementById('race-desc').textContent = race ? race.desc : '';
    this.refreshOptionArt();
    this.updateCreateButton();
  }

  updateClassSelection() {
    this.uiElement.querySelectorAll('.charcreate-option[data-class]').forEach(option => {
      if (option.dataset.class === this.selectedClass) {
        option.classList.add('selected');
      } else {
        option.classList.remove('selected');
      }
    });

    const cls = CLASSES.find(c => c.id === this.selectedClass);
    document.getElementById('class-desc').textContent = cls ? cls.desc : '';
    this.refreshOptionArt();
    this.updateCreateButton();
  }

  updateGenderSelection() {
    this.uiElement.querySelectorAll('.charcreate-gender-option').forEach(option => {
      if (option.dataset.gender === this.selectedGender) {
        option.classList.add('selected');
      } else {
        option.classList.remove('selected');
      }
    });

    this.refreshOptionArt();
    this.updateCreateButton();
  }

  updatePreview() {
    const traitsPlaceholder = document.getElementById('traits-placeholder');

    // Nothing selected - show empty placeholder card
    if (!this.selectedRace && !this.selectedClass) {
      this.previewCard.setCharacter(null);
      this.previewCard.setTraits([]);
      if (traitsPlaceholder) {
        traitsPlaceholder.textContent = 'Select race and class to see traits';
        traitsPlaceholder.style.display = 'block';
      }
      return;
    }

    // Race only - show racial trait, placeholder stats
    if (this.selectedRace && !this.selectedClass) {
      const racialTrait = RACIAL_TRAITS[this.selectedRace];
      const traits = racialTrait ? [racialTrait] : [];

      // Show placeholder character with just race info
      const placeholderChar = {
        name: this.getPreviewName(),
        level: 1,
        race: this.selectedRace,
        class: 'unknown',
        gender: this.selectedGender || 'other',
        hp: 1,
        maxHp: 1,
        mp: 1,
        maxMp: 1,
        strength: '?',
        intelligence: '?',
        agility: '?',
        vitality: '?',
        luck: '?'
      };

      this.previewCard.setCharacter(placeholderChar);
      this.previewCard.setTraits(traits);

      if (traitsPlaceholder) {
        traitsPlaceholder.textContent = 'Select a class to see full preview';
        traitsPlaceholder.style.display = 'block';
      }
      return;
    }

    // Class only - show placeholder, no traits yet
    if (!this.selectedRace && this.selectedClass) {
      const placeholderChar = {
        name: this.getPreviewName(),
        level: 1,
        race: 'unknown',
        class: this.selectedClass,
        gender: this.selectedGender || 'other',
        hp: 1,
        maxHp: 1,
        mp: 1,
        maxMp: 1,
        strength: '?',
        intelligence: '?',
        agility: '?',
        vitality: '?',
        luck: '?'
      };

      this.previewCard.setCharacter(placeholderChar);
      this.previewCard.setTraits([]);

      if (traitsPlaceholder) {
        traitsPlaceholder.textContent = 'Select a race to see traits';
        traitsPlaceholder.style.display = 'block';
      }
      return;
    }

    // Both race and class selected - fetch full preview from API
    if (traitsPlaceholder) {
      traitsPlaceholder.textContent = 'Loading preview...';
      traitsPlaceholder.style.display = 'block';
    }

    this.fetchPreview();
  }

  async fetchPreview() {
    // Cancel any pending fetch
    if (this.previewFetchAbort) {
      this.previewFetchAbort.abort();
    }
    this.previewFetchAbort = new AbortController();

    try {
      const response = await this.game.api.getCharacterPreview(
        this.selectedRace,
        this.selectedClass
      );

      // Check if we're still on this scene and selections haven't changed
      if (!this.uiElement) return;

      const { stats, traits } = response;
      const traitsPlaceholder = document.getElementById('traits-placeholder');

      // Build preview character data
      const previewChar = {
        name: this.getPreviewName(),
        level: 1,
        race: this.selectedRace,
        class: this.selectedClass,
        gender: this.selectedGender || 'other',
        // Transform API snake_case to camelCase for ParchmentCard
        hp: stats.hp_max || stats.maxHp || 100,
        maxHp: stats.hp_max || stats.maxHp || 100,
        mp: stats.mp_max || stats.maxMp || 50,
        maxMp: stats.mp_max || stats.maxMp || 50,
        strength: stats.strength || stats.str || 10,
        intelligence: stats.intelligence || stats.int || 10,
        agility: stats.agility || stats.agi || 10,
        vitality: stats.vitality || stats.vit || 10,
        luck: stats.luck || stats.lck || 10
      };

      this.previewData = previewChar;
      this.previewCard.setCharacter(previewChar);

      // Build traits array from response
      const traitList = [];
      if (traits?.racial) {
        traitList.push({
          name: traits.racial.name,
          description: traits.racial.description,
          type: 'racial'
        });
      }
      if (traits?.starting) {
        traitList.push({
          name: traits.starting.name,
          description: traits.starting.description,
          type: 'starting'
        });
      }

      this.previewCard.setTraits(traitList);

      // Hide placeholder since traits are now shown in the card
      if (traitsPlaceholder) {
        traitsPlaceholder.style.display = 'none';
      }

    } catch (err) {
      // Ignore abort errors
      if (err.name === 'AbortError') return;

      console.error('Failed to fetch character preview:', err);

      // Fallback to local data on error
      const racialTrait = RACIAL_TRAITS[this.selectedRace];
      const traits = racialTrait ? [racialTrait] : [];

      const fallbackChar = {
        name: this.getPreviewName(),
        level: 1,
        race: this.selectedRace,
        class: this.selectedClass,
        gender: this.selectedGender || 'other',
        hp: 100,
        maxHp: 100,
        mp: 50,
        maxMp: 50,
        strength: 10,
        intelligence: 10,
        agility: 10,
        vitality: 10,
        luck: 10
      };

      this.previewCard.setCharacter(fallbackChar);
      this.previewCard.setTraits(traits);

      const traitsPlaceholder = document.getElementById('traits-placeholder');
      if (traitsPlaceholder) {
        traitsPlaceholder.textContent = 'Preview unavailable - using defaults';
        traitsPlaceholder.style.display = 'block';
      }
    }
  }

  updateCreateButton() {
    const nameEl = document.getElementById('char-name');
    const btn = document.getElementById('create-btn');
    // Safety check - elements may not exist if scene was exited
    if (!nameEl || !btn) return;
    const name = nameEl.value.trim();
    btn.disabled = !name || name.length < 2 || !this.selectedRace || !this.selectedClass || !this.selectedGender || this.loading;
  }

  async handleCreate() {
    const name = document.getElementById('char-name').value.trim();

    if (!name || !this.selectedRace || !this.selectedClass || !this.selectedGender) return;

    this.loading = true;
    this.updateCreateButton();
    this.updateLoadingState();

    try {
      const result = await this.game.api.createCharacter(name, this.selectedRace, this.selectedClass, this.selectedGender);

      // Update characters list
      const characters = this.game.state.get('characters') || [];
      characters.push(result.character);
      this.game.state.set('characters', characters);
      this.game.state.set('activeCharacter', result.character);

      // Clear wizard mode flag
      this.game.state.set('isNewRegistration', false);

      // Go to world map
      this.game.scenes.switchTo('worldMap');
    } catch (err) {
      this.showError(err.message);
    } finally {
      this.loading = false;
      this.updateCreateButton();
      this.updateLoadingState();
    }
  }

  updateLoadingState() {
    const btn = document.getElementById('create-btn');
    if (btn) {
      if (this.loading) {
        btn.classList.add('btn-loading');
        btn.textContent = 'Creating...';
      } else {
        btn.classList.remove('btn-loading');
        btn.textContent = 'Create Character';
      }
    }
  }

  showError(message) {
    const errorEl = document.getElementById('create-error');
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.style.display = 'block';
      // Re-trigger animation
      errorEl.style.animation = 'none';
      errorEl.offsetHeight; // Trigger reflow
      errorEl.style.animation = null;
    }
  }

  /**
   * Handle responsive breakpoint changes
   * Rebuild UI to adapt layout for new breakpoint
   */
  onBreakpointChange() {
    // Preserve current selections
    const savedRace = this.selectedRace;
    const savedClass = this.selectedClass;
    const savedGender = this.selectedGender;
    const savedName = document.getElementById('char-name')?.value || '';

    // Rebuild UI
    if (this.uiElement) {
      this.uiElement.remove();
      this.uiElement = null;
    }
    if (this.previewCard) {
      this.previewCard.destroy();
      this.previewCard = null;
    }

    this.createUI();

    // Restore selections
    this.selectedRace = savedRace;
    this.selectedClass = savedClass;
    this.selectedGender = savedGender;

    const nameInput = document.getElementById('char-name');
    if (nameInput) {
      nameInput.value = savedName;
    }

    // Update UI state
    this.updateRaceSelection();
    this.updateClassSelection();
    this.updateGenderSelection();
    this.updatePreview();
  }

  update(_deltaTime) {}

  render(ctx) {
    // Draw parchment-themed background gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, this.game.targetHeight);
    gradient.addColorStop(0, P.light);
    gradient.addColorStop(0.5, P.mid);
    gradient.addColorStop(1, P.dark);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.game.targetWidth, this.game.targetHeight);

    // Draw subtle decorative elements with gold accents
    ctx.fillStyle = 'rgba(201, 162, 39, 0.08)';
    for (let i = 0; i < 5; i++) {
      const x = 100 + i * 150;
      const y = 450 + Math.sin(Date.now() / 1000 + i) * 20;
      ctx.beginPath();
      ctx.arc(x, y, 30 + i * 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Add subtle corner flourishes
    ctx.strokeStyle = P.border;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.3;

    // Top-left flourish
    ctx.beginPath();
    ctx.moveTo(20, 60);
    ctx.quadraticCurveTo(20, 20, 60, 20);
    ctx.stroke();

    // Top-right flourish
    ctx.beginPath();
    ctx.moveTo(this.game.targetWidth - 20, 60);
    ctx.quadraticCurveTo(this.game.targetWidth - 20, 20, this.game.targetWidth - 60, 20);
    ctx.stroke();

    // Bottom-left flourish
    ctx.beginPath();
    ctx.moveTo(20, this.game.targetHeight - 60);
    ctx.quadraticCurveTo(20, this.game.targetHeight - 20, 60, this.game.targetHeight - 20);
    ctx.stroke();

    // Bottom-right flourish
    ctx.beginPath();
    ctx.moveTo(this.game.targetWidth - 20, this.game.targetHeight - 60);
    ctx.quadraticCurveTo(this.game.targetWidth - 20, this.game.targetHeight - 20, this.game.targetWidth - 60, this.game.targetHeight - 20);
    ctx.stroke();

    ctx.globalAlpha = 1.0;
  }
}
