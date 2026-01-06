import { Scene } from './Scene.js';

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

export class CharacterCreateScene extends Scene {
  constructor(game) {
    super(game);
    this.uiElement = null;
    this.selectedRace = null;
    this.selectedClass = null;
    this.loading = false;
  }

  enter() {
    this.selectedRace = null;
    this.selectedClass = null;
    this.loading = false;
    this.createUI();
  }

  exit() {
    if (this.uiElement) {
      this.uiElement.remove();
      this.uiElement = null;
    }
  }

  createUI() {
    const container = document.createElement('div');
    container.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 500px;
    `;

    container.innerHTML = `
      <div class="ui-panel">
        <div class="ui-panel-header">Create Character</div>
        <div id="create-error" class="auth-error" style="display: none;"></div>

        <div class="form-group">
          <label for="char-name">Character Name</label>
          <input type="text" id="char-name" class="input-field" placeholder="2-24 characters" maxlength="24" required>
        </div>

        <div class="form-group">
          <label>Race</label>
          <div id="race-select" style="display: flex; gap: 8px; flex-wrap: wrap;">
            ${RACES.map(race => `
              <div class="race-option" data-race="${race.id}" style="
                flex: 1;
                min-width: 80px;
                padding: 12px 8px;
                background: #0f0f1a;
                border: 2px solid #4a4a6a;
                border-radius: 4px;
                text-align: center;
                cursor: pointer;
                transition: all 0.2s;
              ">
                <div style="font-size: 24px;">${race.emoji}</div>
                <div style="font-size: 12px; margin-top: 4px;">${race.name}</div>
              </div>
            `).join('')}
          </div>
          <div id="race-desc" style="font-size: 12px; color: #8a8aaa; margin-top: 8px; min-height: 18px;"></div>
        </div>

        <div class="form-group">
          <label>Class</label>
          <div id="class-select" style="display: flex; gap: 8px; flex-wrap: wrap;">
            ${CLASSES.map(cls => `
              <div class="class-option" data-class="${cls.id}" style="
                flex: 1;
                min-width: 100px;
                padding: 12px 8px;
                background: #0f0f1a;
                border: 2px solid #4a4a6a;
                border-radius: 4px;
                text-align: center;
                cursor: pointer;
                transition: all 0.2s;
              ">
                <div style="font-size: 24px;">${cls.emoji}</div>
                <div style="font-size: 12px; margin-top: 4px;">${cls.name}</div>
              </div>
            `).join('')}
          </div>
          <div id="class-desc" style="font-size: 12px; color: #8a8aaa; margin-top: 8px; min-height: 18px;"></div>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 16px;">
          <button class="btn btn-secondary" id="back-btn">Back</button>
          <button class="btn btn-primary" id="create-btn" style="flex: 1;" disabled>Create Character</button>
        </div>
      </div>
    `;

    this.game.uiOverlay.appendChild(container);
    this.uiElement = container;

    // Race selection
    container.querySelectorAll('.race-option').forEach(option => {
      option.addEventListener('click', () => {
        this.selectedRace = option.dataset.race;
        this.updateRaceSelection();
      });
    });

    // Class selection
    container.querySelectorAll('.class-option').forEach(option => {
      option.addEventListener('click', () => {
        this.selectedClass = option.dataset.class;
        this.updateClassSelection();
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
    this.uiElement.querySelectorAll('.race-option').forEach(option => {
      if (option.dataset.race === this.selectedRace) {
        option.style.borderColor = '#ffd700';
        option.style.background = '#1e1e3f';
      } else {
        option.style.borderColor = '#4a4a6a';
        option.style.background = '#0f0f1a';
      }
    });

    const race = RACES.find(r => r.id === this.selectedRace);
    document.getElementById('race-desc').textContent = race ? race.desc : '';
    this.updateCreateButton();
  }

  updateClassSelection() {
    this.uiElement.querySelectorAll('.class-option').forEach(option => {
      if (option.dataset.class === this.selectedClass) {
        option.style.borderColor = '#ffd700';
        option.style.background = '#1e1e3f';
      } else {
        option.style.borderColor = '#4a4a6a';
        option.style.background = '#0f0f1a';
      }
    });

    const cls = CLASSES.find(c => c.id === this.selectedClass);
    document.getElementById('class-desc').textContent = cls ? cls.desc : '';
    this.updateCreateButton();
  }

  updateCreateButton() {
    const name = document.getElementById('char-name').value.trim();
    const btn = document.getElementById('create-btn');
    btn.disabled = !name || name.length < 2 || !this.selectedRace || !this.selectedClass || this.loading;
  }

  async handleCreate() {
    const name = document.getElementById('char-name').value.trim();

    if (!name || !this.selectedRace || !this.selectedClass) return;

    this.loading = true;
    this.updateCreateButton();

    try {
      const result = await this.game.api.createCharacter(name, this.selectedRace, this.selectedClass);

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
    }
  }

  showError(message) {
    const errorEl = document.getElementById('create-error');
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.style.display = 'block';
    }
  }

  update(deltaTime) {}

  render(ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
    gradient.addColorStop(0, '#16213e');
    gradient.addColorStop(1, '#1a1a2e');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
}
