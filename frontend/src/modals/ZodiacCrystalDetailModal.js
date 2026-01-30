/**
 * ZodiacCrystalDetailModal - Detailed view of a single zodiac crystal
 *
 * Shows when clicking a crystal in the collection grid.
 * Features animated orb with constellation, blessing info, and collection details.
 */

import {
  PARCHMENT_COLORS,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentShadow
} from '../ui/parchment/index.js';
import { ZODIAC_SHRINE_BUFFS, ZODIAC_CRYSTALS } from '@shared/constants.js';
import { CrystalOrb } from './zodiac/CrystalOrb.js';
import { ZODIAC_INFO, ELEMENT_COLORS } from './zodiac/ConstellationData.js';

const P = PARCHMENT_COLORS;
const STYLE_ID = 'zodiac-crystal-detail-modal-styles';

// Region hints for uncollected crystals (by element)
const REGION_HINTS = {
  fire: 'Bloodplains',
  earth: 'Iron Depths',
  air: 'Sylvan Reaches',
  water: 'Shadowmere'
};

// Bonus type display names
const BONUS_TYPE_NAMES = {
  physical_damage: 'Physical Damage',
  defense: 'Defense',
  crit_chance: 'Critical Chance',
  healing_received: 'Healing Received'
};

export class ZodiacCrystalDetailModal {
  /**
   * @param {Object} options
   * @param {Object} options.game - Game instance
   * @param {string} options.sign - Zodiac sign name (lowercase)
   * @param {Object} options.crystal - API data for this crystal
   * @param {Function} options.onClose - Callback when modal closes
   */
  constructor(options) {
    this.game = options.game;
    this.sign = options.sign;
    this.crystal = options.crystal;
    this.onClose = options.onClose;

    this.element = null;
    this.orbCanvas = null;
    this.crystalOrb = null;
    this.animationId = null;
    this.abortController = null;

    // Get zodiac info
    this.zodiacInfo = ZODIAC_INFO[this.sign] || ZODIAC_INFO.aries;
    this.colors = ELEMENT_COLORS[this.zodiacInfo.element] || ELEMENT_COLORS.fire;
    this.blessing = ZODIAC_SHRINE_BUFFS[this.sign];
    this.crystalInfo = ZODIAC_CRYSTALS[this.sign];

    this.injectStyles();
  }

  injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .zodiac-detail-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.75);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1001;
        font-family: Georgia, 'Times New Roman', serif;
      }

      .zodiac-detail-modal {
        background: ${getParchmentGradient()};
        border: ${getParchmentBorder(3)};
        border-radius: 12px;
        box-shadow: ${getParchmentShadow()}, 0 0 60px rgba(0, 0, 0, 0.6);
        width: 420px;
        max-width: 95%;
        max-height: 90vh;
        overflow: hidden;
        transform: scale(0.8);
        opacity: 0;
        transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease;
      }

      .zodiac-detail-modal--visible {
        transform: scale(1);
        opacity: 1;
      }

      .zodiac-detail-close {
        position: absolute;
        top: 12px;
        right: 12px;
        width: 28px;
        height: 28px;
        border: none;
        background: rgba(0, 0, 0, 0.3);
        color: ${P.text.inverse};
        font-size: 18px;
        line-height: 1;
        border-radius: 50%;
        cursor: pointer;
        transition: background 0.2s ease;
        z-index: 10;
      }

      .zodiac-detail-close:hover {
        background: rgba(0, 0, 0, 0.5);
      }

      .zodiac-detail-content {
        padding: 24px;
        text-align: center;
        position: relative;
      }

      .zodiac-detail-orb-container {
        width: 256px;
        height: 256px;
        margin: 0 auto 20px;
        transform: scale(0.5);
        opacity: 0;
        transition: transform 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55), opacity 0.4s ease;
      }

      .zodiac-detail-orb-container--visible {
        transform: scale(1);
        opacity: 1;
      }

      .zodiac-detail-orb-canvas {
        width: 256px;
        height: 256px;
      }

      .zodiac-detail-name {
        font-size: 22px;
        font-weight: bold;
        margin: 0 0 4px 0;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
      }

      .zodiac-detail-symbol {
        font-size: 48px;
        margin: 8px 0;
        text-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
      }

      .zodiac-detail-sign {
        font-size: 16px;
        color: ${P.text.secondary};
        margin-bottom: 8px;
        text-transform: capitalize;
      }

      .zodiac-detail-element-badge {
        display: inline-block;
        padding: 4px 16px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-bottom: 20px;
      }

      .zodiac-detail-divider {
        display: flex;
        align-items: center;
        gap: 12px;
        margin: 16px 0;
        color: ${P.text.muted};
        font-size: 12px;
      }

      .zodiac-detail-divider::before,
      .zodiac-detail-divider::after {
        content: '';
        flex: 1;
        height: 1px;
        background: ${P.border};
      }

      .zodiac-detail-blessing {
        background: rgba(139, 115, 85, 0.1);
        border: 1px solid rgba(139, 115, 85, 0.3);
        border-radius: 8px;
        padding: 12px 16px;
        margin-bottom: 16px;
      }

      .zodiac-detail-blessing-name {
        font-size: 15px;
        font-weight: bold;
        color: ${P.text.primary};
        margin-bottom: 4px;
      }

      .zodiac-detail-blessing-desc {
        font-size: 13px;
        color: ${P.text.secondary};
      }

      .zodiac-detail-collected {
        font-size: 12px;
        color: ${P.text.muted};
        font-style: italic;
      }

      .zodiac-detail-collected-date {
        color: ${P.text.secondary};
        font-weight: bold;
      }

      /* Uncollected state */
      .zodiac-detail-unknown-title {
        color: ${P.text.muted};
      }

      .zodiac-detail-unknown-badge {
        background: rgba(60, 50, 40, 0.6);
        color: ${P.text.muted};
        border: 1px dashed ${P.border};
      }

      .zodiac-detail-hint {
        font-size: 13px;
        color: ${P.text.muted};
        font-style: italic;
        padding: 12px 16px;
        background: rgba(139, 115, 85, 0.08);
        border-radius: 8px;
        margin-top: 12px;
      }

      .zodiac-detail-hint-region {
        color: ${P.accent.copper};
        font-weight: bold;
      }

      @media (max-width: 480px) {
        .zodiac-detail-modal {
          width: 95%;
        }

        .zodiac-detail-content {
          padding: 16px;
        }

        .zodiac-detail-orb-container {
          width: 200px;
          height: 200px;
        }

        .zodiac-detail-orb-canvas {
          width: 200px;
          height: 200px;
        }

        .zodiac-detail-symbol {
          font-size: 36px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  show() {
    this.abortController = new AbortController();
    this.createElement();
    this.createOrb();
    this.game.uiOverlay.appendChild(this.element);
    this.startAnimation();
    this.playEntryAnimation();
  }

  createElement() {
    this.element = document.createElement('div');
    this.element.className = 'zodiac-detail-overlay';

    const modal = document.createElement('div');
    modal.className = 'zodiac-detail-modal';
    this.modalElement = modal;

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'zodiac-detail-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => this.close(), { signal: this.abortController.signal });
    modal.appendChild(closeBtn);

    // Content
    const content = document.createElement('div');
    content.className = 'zodiac-detail-content';

    // Orb container
    const orbContainer = document.createElement('div');
    orbContainer.className = 'zodiac-detail-orb-container';
    this.orbContainer = orbContainer;

    this.orbCanvas = document.createElement('canvas');
    this.orbCanvas.className = 'zodiac-detail-orb-canvas';
    this.orbCanvas.width = 256;
    this.orbCanvas.height = 256;
    orbContainer.appendChild(this.orbCanvas);
    content.appendChild(orbContainer);

    // Crystal info
    if (this.crystal.collected) {
      content.appendChild(this.createCollectedContent());
    } else {
      content.appendChild(this.createUncollectedContent());
    }

    modal.appendChild(content);
    this.element.appendChild(modal);

    // Close on overlay click
    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) {
        this.close();
      }
    }, { signal: this.abortController.signal });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.close();
      }
    }, { signal: this.abortController.signal });
  }

  createCollectedContent() {
    const fragment = document.createDocumentFragment();

    // Crystal name
    const name = document.createElement('h2');
    name.className = 'zodiac-detail-name';
    name.style.color = this.colors.primary;
    name.textContent = this.crystalInfo?.name || `Crystal of ${this.zodiacInfo.name}`;
    fragment.appendChild(name);

    // Zodiac symbol
    const symbol = document.createElement('div');
    symbol.className = 'zodiac-detail-symbol';
    symbol.style.color = this.colors.primary;
    symbol.textContent = this.zodiacInfo.symbol;
    fragment.appendChild(symbol);

    // Sign name
    const sign = document.createElement('div');
    sign.className = 'zodiac-detail-sign';
    sign.textContent = this.zodiacInfo.name;
    fragment.appendChild(sign);

    // Element badge
    const badge = document.createElement('div');
    badge.className = 'zodiac-detail-element-badge';
    badge.style.background = `${this.colors.primary}33`;
    badge.style.color = this.colors.primary;
    badge.style.border = `1px solid ${this.colors.primary}66`;
    badge.textContent = `${this.zodiacInfo.element.toUpperCase()} ELEMENT`;
    fragment.appendChild(badge);

    // Blessing divider
    const divider = document.createElement('div');
    divider.className = 'zodiac-detail-divider';
    divider.textContent = 'Blessing';
    fragment.appendChild(divider);

    // Blessing info
    const blessing = document.createElement('div');
    blessing.className = 'zodiac-detail-blessing';
    blessing.style.borderColor = `${this.colors.primary}44`;

    const blessingName = document.createElement('div');
    blessingName.className = 'zodiac-detail-blessing-name';
    blessingName.style.color = this.colors.primary;
    blessingName.textContent = `"${this.blessing?.name || 'Unknown Blessing'}"`;

    const blessingDesc = document.createElement('div');
    blessingDesc.className = 'zodiac-detail-blessing-desc';
    const bonusType = BONUS_TYPE_NAMES[this.crystalInfo?.bonus?.type] || 'Stats';
    const bonusValue = this.crystalInfo?.bonus?.value
      ? `+${Math.round(this.crystalInfo.bonus.value * 100)}%`
      : '+1%';
    blessingDesc.textContent = `${bonusValue} ${bonusType}`;

    blessing.appendChild(blessingName);
    blessing.appendChild(blessingDesc);
    fragment.appendChild(blessing);

    // Collection info
    const collected = document.createElement('div');
    collected.className = 'zodiac-detail-collected';

    const collectedDate = this.crystal.collected_at
      ? new Date(this.crystal.collected_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      })
      : 'Unknown date';

    const shrineName = this.crystal.shrine_name || this.getDefaultShrineName();

    collected.innerHTML = `
      Collected: <span class="zodiac-detail-collected-date">${collectedDate}</span><br>
      Shrine: ${shrineName}
    `;
    fragment.appendChild(collected);

    return fragment;
  }

  createUncollectedContent() {
    const fragment = document.createDocumentFragment();

    // Unknown title
    const name = document.createElement('h2');
    name.className = 'zodiac-detail-name zodiac-detail-unknown-title';
    name.textContent = '??? Unknown Crystal';
    fragment.appendChild(name);

    // Question mark symbol
    const symbol = document.createElement('div');
    symbol.className = 'zodiac-detail-symbol';
    symbol.style.color = P.text.muted;
    symbol.textContent = '?';
    fragment.appendChild(symbol);

    // Unknown sign
    const sign = document.createElement('div');
    sign.className = 'zodiac-detail-sign';
    sign.style.color = P.text.muted;
    sign.textContent = 'Unknown Sign';
    fragment.appendChild(sign);

    // Undiscovered badge
    const badge = document.createElement('div');
    badge.className = 'zodiac-detail-element-badge zodiac-detail-unknown-badge';
    badge.textContent = 'UNDISCOVERED';
    fragment.appendChild(badge);

    // Hint
    const hint = document.createElement('div');
    hint.className = 'zodiac-detail-hint';
    const region = REGION_HINTS[this.zodiacInfo.element] || 'distant';
    hint.innerHTML = `Seek the shrine in the <span class="zodiac-detail-hint-region">${region}</span> lands...`;
    fragment.appendChild(hint);

    return fragment;
  }

  getDefaultShrineName() {
    // Generate a thematic shrine name based on element
    const shrineNames = {
      fire: 'Ember Peak',
      earth: 'Stone Circle',
      air: 'Wind Spire',
      water: 'Moonpool Grotto'
    };
    return shrineNames[this.zodiacInfo.element] || 'Ancient Shrine';
  }

  createOrb() {
    this.crystalOrb = new CrystalOrb({
      sign: this.sign,
      size: 256,
      collected: this.crystal.collected,
      animated: true
    });
  }

  startAnimation() {
    let lastTime = performance.now();

    const animate = (time) => {
      const deltaTime = time - lastTime;
      lastTime = time;

      if (this.crystalOrb) {
        this.crystalOrb.update(deltaTime);
        this.renderOrb();
      }

      this.animationId = requestAnimationFrame(animate);
    };

    this.animationId = requestAnimationFrame(animate);
  }

  renderOrb() {
    if (!this.orbCanvas || !this.crystalOrb) return;

    const ctx = this.orbCanvas.getContext('2d');
    ctx.clearRect(0, 0, this.orbCanvas.width, this.orbCanvas.height);
    const orbCanvas = this.crystalOrb.render();
    ctx.drawImage(orbCanvas, 0, 0);
  }

  playEntryAnimation() {
    // Delay to allow initial render
    requestAnimationFrame(() => {
      // Modal scale animation
      this.modalElement.classList.add('zodiac-detail-modal--visible');

      // Orb elastic animation with delay
      setTimeout(() => {
        this.orbContainer.classList.add('zodiac-detail-orb-container--visible');
      }, 100);
    });
  }

  close() {
    if (this.onClose) {
      this.onClose();
    }
    this.destroy();
  }

  destroy() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    if (this.crystalOrb) {
      this.crystalOrb.destroy();
      this.crystalOrb = null;
    }

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.element?.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }

    this.element = null;
    this.orbCanvas = null;
    this.modalElement = null;
    this.orbContainer = null;
  }
}
