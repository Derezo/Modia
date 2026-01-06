import { Scene } from './Scene.js';

export class CharacterSelectScene extends Scene {
  constructor(game) {
    super(game);
    this.uiElement = null;
    this.characters = [];
  }

  enter() {
    this.characters = this.game.state.get('characters') || [];
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
    container.className = 'auth-container';
    container.style.width = '400px';

    let charactersHtml = '';
    this.characters.forEach((char, index) => {
      const hpPercent = (char.hp_current / char.hp_max) * 100;
      const mpPercent = (char.mp_current / char.mp_max) * 100;

      charactersHtml += `
        <div class="character-card" data-id="${char.id}">
          <div class="character-avatar">${this.getRaceEmoji(char.race)}</div>
          <div class="character-info">
            <div class="character-name">${char.name}</div>
            <div class="character-details">Lv.${char.level} ${this.capitalize(char.race)} ${this.capitalize(char.class)}</div>
            <div class="stat-bar stat-bar-hp">
              <div class="stat-bar-fill" style="width: ${hpPercent}%"></div>
            </div>
          </div>
        </div>
      `;
    });

    // Add empty slots
    for (let i = this.characters.length; i < 12; i++) {
      charactersHtml += `
        <div class="character-card" data-action="create" style="opacity: 0.5; justify-content: center;">
          <span style="color: #6a6a8a;">+ Create Character</span>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="ui-panel">
        <div class="ui-panel-header">Select Character</div>
        <div style="max-height: 400px; overflow-y: auto;">
          ${charactersHtml}
        </div>
        <div style="margin-top: 16px; display: flex; gap: 8px;">
          <button class="btn btn-secondary" id="logout-btn" style="flex: 1;">Logout</button>
        </div>
      </div>
    `;

    this.game.uiOverlay.appendChild(container);
    this.uiElement = container;

    // Event listeners
    container.querySelectorAll('.character-card').forEach(card => {
      card.addEventListener('click', () => {
        const charId = card.dataset.id;
        const action = card.dataset.action;

        if (action === 'create') {
          this.game.scenes.switchTo('characterCreate');
        } else if (charId) {
          this.selectCharacter(parseInt(charId));
        }
      });
    });

    container.querySelector('#logout-btn').addEventListener('click', () => this.handleLogout());
  }

  selectCharacter(charId) {
    const character = this.characters.find(c => c.id === charId);
    if (character) {
      this.game.state.set('activeCharacter', character);
      this.game.scenes.switchTo('worldMap');
    }
  }

  async handleLogout() {
    try {
      await this.game.api.logout(this.game.refreshToken);
    } catch (err) {
      console.error('Logout error:', err);
    }

    this.game.socket.disconnect();
    this.game.state.clear();
    this.game.scenes.switchTo('login');
  }

  getRaceEmoji(race) {
    const emojis = {
      human: '👤',
      elf: '🧝',
      dwarf: '🧔',
      vampire: '🧛',
      orc: '👹'
    };
    return emojis[race] || '👤';
  }

  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
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
