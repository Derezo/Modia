import { Scene } from './Scene.js';
import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_SPACING,
  PARCHMENT_RADIUS,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentShadow,
  getParchmentInputCSS,
  getParchmentButtonCSS,
  getParchmentCardCSS
} from '../ui/parchment/index.js';

// Local alias for cleaner access
const P = PARCHMENT_COLORS;

const STYLE_ID = 'charcreate-scene-styles';

const RACES = [
  { id: 'human', name: 'Human', emoji: '👤', desc: '+10% EXP gain, balanced stats' },
  { id: 'elf', name: 'Elf', emoji: '🧝', desc: '+20% MP regen, high INT/AGI' },
  { id: 'dwarf', name: 'Dwarf', emoji: '🧔', desc: '+15% gold find, high STR/VIT' },
  { id: 'vampire', name: 'Vampire', emoji: '🧛', desc: '10% lifesteal, high AGI' },
  { id: 'orc', name: 'Orc', emoji: '👹', desc: '+25% crit damage, high STR' }
];

const CLASSES = [
  { id: 'warrior', name: 'Warrior', emoji: '⚔️', desc: 'Tank/DPS, high HP and STR' },
  { id: 'wizard', name: 'Wizard', emoji: '🧙', desc: 'Magic DPS, high MP and INT' },
  { id: 'monk', name: 'Monk', emoji: '🥋', desc: 'Mobile DPS, high AGI' },
  { id: 'chemist', name: 'Chemist', emoji: '⚗️', desc: 'Support/Healer, balanced' }
];

const GENDERS = [
  { id: 'male', name: 'Male', emoji: '♂️' },
  { id: 'female', name: 'Female', emoji: '♀️' },
  { id: 'other', name: 'Other', emoji: '⚧️' }
];

export class CharacterCreateScene extends Scene {
  constructor(game) {
    super(game);
    this.uiElement = null;
    this.selectedRace = null;
    this.selectedClass = null;
    this.selectedGender = null;
    this.loading = false;
  }

  enter() {
    this.selectedRace = null;
    this.selectedClass = null;
    this.selectedGender = null;
    this.loading = false;
    this.addStyles();
    this.createUI();
  }

  exit() {
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
        width: 520px;
        max-width: 95%;
      }

      .charcreate-title {
        color: ${P.text.primary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: 32px;
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
        margin-bottom: ${PARCHMENT_SPACING.lg};
        text-align: left;
      }

      .charcreate-label {
        display: block;
        color: ${P.text.primary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        margin-bottom: ${PARCHMENT_SPACING.xs};
      }

      .charcreate-input {
        width: 100%;
        box-sizing: border-box;
        ${getParchmentInputCSS()}
      }

      .charcreate-input:focus {
        border-color: ${P.borderDark};
        box-shadow: 0 0 0 2px rgba(139, 115, 85, 0.2);
      }

      .charcreate-input::placeholder {
        color: ${P.text.muted};
      }

      .charcreate-option-grid {
        display: flex;
        gap: ${PARCHMENT_SPACING.sm};
        flex-wrap: wrap;
      }

      .charcreate-option {
        flex: 1;
        min-width: 80px;
        padding: ${PARCHMENT_SPACING.md} ${PARCHMENT_SPACING.sm};
        background: ${P.light};
        border: 2px solid ${P.border};
        border-radius: ${PARCHMENT_RADIUS.md};
        text-align: center;
        cursor: pointer;
        transition: all 0.2s ease;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .charcreate-option:hover {
        background: ${P.mid};
        border-color: ${P.borderDark};
        transform: translateY(-2px);
      }

      .charcreate-option.selected {
        border-color: ${P.accent.gold};
        background: ${P.mid};
        box-shadow: 0 0 0 2px ${P.accent.gold}, ${getParchmentShadow()};
      }

      .charcreate-option-emoji {
        font-size: 24px;
        line-height: 1.2;
      }

      .charcreate-option-name {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${P.text.primary};
        margin-top: ${PARCHMENT_SPACING.xs};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      }

      .charcreate-class-option {
        min-width: 100px;
      }

      .charcreate-desc {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${P.text.muted};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        margin-top: ${PARCHMENT_SPACING.sm};
        min-height: 18px;
        font-style: italic;
      }

      .charcreate-gender-row {
        display: flex;
        gap: ${PARCHMENT_SPACING.lg};
        align-items: flex-start;
      }

      .charcreate-gender-options {
        flex: 1;
      }

      .charcreate-gender-grid {
        display: flex;
        gap: ${PARCHMENT_SPACING.sm};
      }

      .charcreate-gender-option {
        flex: 1;
        padding: ${PARCHMENT_SPACING.md} ${PARCHMENT_SPACING.sm};
        background: ${P.light};
        border: 2px solid ${P.border};
        border-radius: ${PARCHMENT_RADIUS.md};
        text-align: center;
        cursor: pointer;
        transition: all 0.2s ease;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .charcreate-gender-option:hover {
        background: ${P.mid};
        border-color: ${P.borderDark};
      }

      .charcreate-gender-option.selected {
        border-color: ${P.accent.gold};
        background: ${P.mid};
        box-shadow: 0 0 0 2px ${P.accent.gold};
      }

      .charcreate-gender-emoji {
        font-size: 20px;
        line-height: 1.2;
      }

      .charcreate-gender-name {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        color: ${P.text.primary};
        margin-top: ${PARCHMENT_SPACING.xs};
      }

      .charcreate-portrait {
        width: 80px;
        height: 80px;
        background: ${P.light};
        border: 2px solid ${P.border};
        border-radius: ${PARCHMENT_RADIUS.md};
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        transition: border-color 0.2s ease;
      }

      .charcreate-portrait.has-portrait {
        border-color: ${P.accent.gold};
      }

      .charcreate-portrait-placeholder {
        color: ${P.text.muted};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        text-align: center;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        line-height: 1.3;
      }

      .charcreate-portrait img {
        width: 64px;
        height: 64px;
        image-rendering: pixelated;
      }

      .charcreate-button-row {
        display: flex;
        gap: ${PARCHMENT_SPACING.sm};
        margin-top: ${PARCHMENT_SPACING.lg};
      }

      .charcreate-btn {
        ${getParchmentButtonCSS('primary')}
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

      @keyframes charcreate-shake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-5px); }
        75% { transform: translateX(5px); }
      }

      @media (max-width: 600px) {
        .charcreate-container {
          width: 95%;
        }

        .charcreate-option {
          min-width: 60px;
          padding: ${PARCHMENT_SPACING.sm};
        }

        .charcreate-option-emoji {
          font-size: 20px;
        }

        .charcreate-option-name {
          font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        }

        .charcreate-class-option {
          min-width: 70px;
        }

        .charcreate-gender-row {
          flex-direction: column;
          gap: ${PARCHMENT_SPACING.md};
        }

        .charcreate-portrait {
          align-self: center;
        }
      }
    `;

    document.head.appendChild(style);
  }

  createUI() {
    const container = document.createElement('div');
    container.className = 'charcreate-container';

    container.innerHTML = `
      <h1 class="charcreate-title">Create Character</h1>
      <div class="charcreate-panel">
        <div id="create-error" class="charcreate-error" style="display: none;"></div>

        <div class="charcreate-form-group">
          <label for="char-name" class="charcreate-label">Character Name</label>
          <input type="text" id="char-name" class="charcreate-input" placeholder="2-24 characters" maxlength="24" required>
        </div>

        <div class="charcreate-form-group">
          <label class="charcreate-label">Race</label>
          <div id="race-select" class="charcreate-option-grid">
            ${RACES.map(race => `
              <div class="charcreate-option" data-race="${race.id}">
                <div class="charcreate-option-emoji">${race.emoji}</div>
                <div class="charcreate-option-name">${race.name}</div>
              </div>
            `).join('')}
          </div>
          <div id="race-desc" class="charcreate-desc"></div>
        </div>

        <div class="charcreate-form-group">
          <label class="charcreate-label">Class</label>
          <div id="class-select" class="charcreate-option-grid">
            ${CLASSES.map(cls => `
              <div class="charcreate-option charcreate-class-option" data-class="${cls.id}">
                <div class="charcreate-option-emoji">${cls.emoji}</div>
                <div class="charcreate-option-name">${cls.name}</div>
              </div>
            `).join('')}
          </div>
          <div id="class-desc" class="charcreate-desc"></div>
        </div>

        <div class="charcreate-form-group">
          <div class="charcreate-gender-row">
            <div class="charcreate-gender-options">
              <label class="charcreate-label">Gender</label>
              <div id="gender-select" class="charcreate-gender-grid">
                ${GENDERS.map(gender => `
                  <div class="charcreate-gender-option" data-gender="${gender.id}">
                    <div class="charcreate-gender-emoji">${gender.emoji}</div>
                    <div class="charcreate-gender-name">${gender.name}</div>
                  </div>
                `).join('')}
              </div>
            </div>
            <div id="portrait-preview" class="charcreate-portrait">
              <span class="charcreate-portrait-placeholder">Select all<br>options</span>
            </div>
          </div>
        </div>

        <div class="charcreate-button-row">
          <button class="charcreate-btn charcreate-btn-secondary" id="back-btn">Back</button>
          <button class="charcreate-btn charcreate-btn-primary" id="create-btn" disabled>Create Character</button>
        </div>
      </div>
    `;

    this.game.uiOverlay.appendChild(container);
    this.uiElement = container;

    // Race selection
    container.querySelectorAll('.charcreate-option[data-race]').forEach(option => {
      option.addEventListener('click', () => {
        this.selectedRace = option.dataset.race;
        this.updateRaceSelection();
      });
    });

    // Class selection
    container.querySelectorAll('.charcreate-option[data-class]').forEach(option => {
      option.addEventListener('click', () => {
        this.selectedClass = option.dataset.class;
        this.updateClassSelection();
      });
    });

    // Gender selection
    container.querySelectorAll('.charcreate-gender-option').forEach(option => {
      option.addEventListener('click', () => {
        this.selectedGender = option.dataset.gender;
        this.updateGenderSelection();
      });
    });

    // Buttons
    container.querySelector('#back-btn').addEventListener('click', () => {
      const characters = this.game.state.get('characters') || [];
      if (characters.length > 0) {
        this.game.scenes.switchTo('characterSelect');
      } else {
        this.game.scenes.switchTo('login');
      }
    });

    container.querySelector('#create-btn').addEventListener('click', () => this.handleCreate());

    // Name input validation
    container.querySelector('#char-name').addEventListener('input', () => this.updateCreateButton());

    container.querySelector('#char-name').focus();
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
    this.updatePortraitPreview();
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
    this.updatePortraitPreview();
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

    this.updatePortraitPreview();
    this.updateCreateButton();
  }

  updatePortraitPreview() {
    const previewEl = document.getElementById('portrait-preview');
    if (!previewEl) return;

    if (this.selectedRace && this.selectedClass && this.selectedGender) {
      const portraitUrl = `/assets/sprites/portraits/${this.selectedRace}_${this.selectedGender}_${this.selectedClass}.png`;
      previewEl.classList.add('has-portrait');
      previewEl.innerHTML = `
        <img
          src="${portraitUrl}"
          alt="Portrait Preview"
          onerror="this.parentElement.innerHTML = '<span class=\\'charcreate-portrait-placeholder\\'>Portrait<br>pending</span>'; this.parentElement.classList.remove('has-portrait');"
        >
      `;
    } else {
      previewEl.classList.remove('has-portrait');
      previewEl.innerHTML = '<span class="charcreate-portrait-placeholder">Select all<br>options</span>';
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

  update(deltaTime) {}

  render(ctx) {
    // Draw parchment-themed background gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
    gradient.addColorStop(0, P.light);
    gradient.addColorStop(0.5, P.mid);
    gradient.addColorStop(1, P.dark);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

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
    ctx.moveTo(ctx.canvas.width - 20, 60);
    ctx.quadraticCurveTo(ctx.canvas.width - 20, 20, ctx.canvas.width - 60, 20);
    ctx.stroke();

    // Bottom-left flourish
    ctx.beginPath();
    ctx.moveTo(20, ctx.canvas.height - 60);
    ctx.quadraticCurveTo(20, ctx.canvas.height - 20, 60, ctx.canvas.height - 20);
    ctx.stroke();

    // Bottom-right flourish
    ctx.beginPath();
    ctx.moveTo(ctx.canvas.width - 20, ctx.canvas.height - 60);
    ctx.quadraticCurveTo(ctx.canvas.width - 20, ctx.canvas.height - 20, ctx.canvas.width - 60, ctx.canvas.height - 20);
    ctx.stroke();

    ctx.globalAlpha = 1.0;
  }
}
