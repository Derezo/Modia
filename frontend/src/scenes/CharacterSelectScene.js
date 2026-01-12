import { Scene } from './Scene.js';
import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_SPACING,
  PARCHMENT_RADIUS,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentShadow,
  getParchmentButtonCSS,
  getParchmentCardCSS
} from '../ui/parchment/index.js';

// Local alias for cleaner access
const P = PARCHMENT_COLORS;

const STYLE_ID = 'charselect-scene-styles';

export class CharacterSelectScene extends Scene {
  constructor(game) {
    super(game);
    this.uiElement = null;
    this.characters = [];
  }

  enter() {
    this.characters = this.game.state.get('characters') || [];
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
      .charselect-container {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 420px;
        max-width: 90%;
        text-align: center;
      }

      .charselect-title {
        color: ${P.text.primary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: 32px;
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
        margin-bottom: ${PARCHMENT_SPACING.lg};
        letter-spacing: 1px;
      }

      .charselect-panel {
        background: ${getParchmentGradient()};
        border: ${getParchmentBorder()};
        box-shadow: ${getParchmentShadow(true)};
        border-radius: ${PARCHMENT_RADIUS.lg};
        padding: ${PARCHMENT_SPACING.xl};
      }

      .charselect-list {
        max-height: 400px;
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: ${P.border} ${P.light};
      }

      .charselect-list::-webkit-scrollbar {
        width: 8px;
      }

      .charselect-list::-webkit-scrollbar-track {
        background: ${P.light};
        border-radius: ${PARCHMENT_RADIUS.sm};
      }

      .charselect-list::-webkit-scrollbar-thumb {
        background: ${P.border};
        border-radius: ${PARCHMENT_RADIUS.sm};
      }

      .charselect-list::-webkit-scrollbar-thumb:hover {
        background: ${P.borderDark};
      }

      .charselect-card {
        ${getParchmentCardCSS({ hoverable: true })}
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.md};
        margin-bottom: ${PARCHMENT_SPACING.sm};
        text-align: left;
      }

      .charselect-card:last-child {
        margin-bottom: 0;
      }

      .charselect-card:hover {
        transform: translateY(-2px);
        box-shadow: ${getParchmentShadow(true)};
        border-color: ${P.accent.burgundy};
      }

      .charselect-card-empty {
        ${getParchmentCardCSS({ hoverable: true })}
        display: flex;
        align-items: center;
        justify-content: center;
        gap: ${PARCHMENT_SPACING.md};
        margin-bottom: ${PARCHMENT_SPACING.sm};
        opacity: 0.6;
        min-height: 64px;
      }

      .charselect-card-empty:hover {
        opacity: 1;
        transform: translateY(-2px);
        box-shadow: ${getParchmentShadow(true)};
        border-color: ${P.accent.burgundy};
      }

      .charselect-card-empty span {
        color: ${P.text.muted};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
      }

      .charselect-avatar {
        width: 48px;
        height: 48px;
        border-radius: ${PARCHMENT_RADIUS.sm};
        border: 1px solid ${P.border};
        background: ${P.dark};
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .charselect-avatar img {
        width: 48px;
        height: 48px;
        image-rendering: pixelated;
        object-fit: cover;
      }

      .charselect-avatar .fallback-emoji {
        display: none;
        font-size: 32px;
      }

      .charselect-info {
        flex: 1;
        min-width: 0;
      }

      .charselect-name {
        color: ${P.text.primary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.lg};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        margin-bottom: ${PARCHMENT_SPACING.xs};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .charselect-details {
        color: ${P.text.secondary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        margin-bottom: ${PARCHMENT_SPACING.xs};
      }

      .charselect-stat-bar {
        height: 6px;
        background: ${P.dark};
        border-radius: ${PARCHMENT_RADIUS.sm};
        overflow: hidden;
        border: 1px solid ${P.border};
      }

      .charselect-stat-bar-fill {
        height: 100%;
        background: linear-gradient(to right, ${P.state.success}, #5a8558);
        border-radius: ${PARCHMENT_RADIUS.sm};
        transition: width 0.3s ease;
      }

      .charselect-actions {
        margin-top: ${PARCHMENT_SPACING.lg};
        display: flex;
        gap: ${PARCHMENT_SPACING.sm};
      }

      .charselect-btn {
        flex: 1;
        ${getParchmentButtonCSS('secondary')}
      }

      .charselect-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
        border-color: ${P.borderDark};
      }

      .charselect-btn:active {
        transform: translateY(0);
      }

      @media (max-width: 600px) {
        .charselect-container {
          width: 90%;
          max-width: 360px;
        }

        .charselect-card {
          padding: ${PARCHMENT_SPACING.sm};
        }

        .charselect-avatar {
          width: 40px;
          height: 40px;
        }

        .charselect-avatar img {
          width: 40px;
          height: 40px;
        }

        .charselect-btn {
          min-height: 44px;
          padding: 12px 14px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  createUI() {
    const container = document.createElement('div');
    container.className = 'charselect-container';

    let charactersHtml = '';
    this.characters.forEach((char) => {
      const hpPercent = (char.hp_current / char.hp_max) * 100;
      const gender = char.gender || 'other';
      const portraitUrl = `/assets/sprites/portraits/${char.race}_${gender}_${char.class}.png`;
      const fallbackEmoji = this.getRaceEmoji(char.race);

      charactersHtml += `
        <div class="charselect-card" data-id="${char.id}">
          <div class="charselect-avatar">
            <img
              src="${portraitUrl}"
              alt="${char.name}"
              onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"
            >
            <span class="fallback-emoji">${fallbackEmoji}</span>
          </div>
          <div class="charselect-info">
            <div class="charselect-name">${char.name}</div>
            <div class="charselect-details">Lv.${char.level} ${this.capitalize(char.race)} ${this.capitalize(char.class)}</div>
            <div class="charselect-stat-bar">
              <div class="charselect-stat-bar-fill" style="width: ${hpPercent}%"></div>
            </div>
          </div>
        </div>
      `;
    });

    // Add empty slots
    for (let i = this.characters.length; i < 12; i++) {
      charactersHtml += `
        <div class="charselect-card-empty" data-action="create">
          <span>+ Create Character</span>
        </div>
      `;
    }

    container.innerHTML = `
      <h1 class="charselect-title">Select Character</h1>
      <div class="charselect-panel">
        <div class="charselect-list">
          ${charactersHtml}
        </div>
        <div class="charselect-actions">
          <button class="charselect-btn" id="logout-btn">Logout</button>
        </div>
      </div>
    `;

    this.game.uiOverlay.appendChild(container);
    this.uiElement = container;

    // Event listeners
    container.querySelectorAll('.charselect-card, .charselect-card-empty').forEach(card => {
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
      human: '\u{1F464}',
      elf: '\u{1F9DD}',
      dwarf: '\u{1F9D4}',
      vampire: '\u{1F9DB}',
      orc: '\u{1F479}'
    };
    return emojis[race] || '\u{1F464}';
  }

  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
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
