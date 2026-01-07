/**
 * RewardsModal - Animated victory/defeat rewards display
 * Features:
 * - Animated gold/XP counters
 * - Per-character XP breakdown
 * - Item reveal with rarity glow
 * - Victory confetti particles
 * - Level-up celebration
 */

const RARITY_COLORS = {
  common: '#cccccc',
  uncommon: '#1eff00',
  rare: '#0070dd',
  epic: '#a335ee',
  legendary: '#ff8000'
};

const ANIMATION_PHASES = {
  MODAL_FADE: { duration: 300 },
  BANNER_SLIDE: { duration: 400 },
  GOLD_COUNT: { duration: 1000 },
  XP_COUNT: { duration: 1000 },
  PARTY_XP: { duration: 800 },
  ITEM_REVEAL: { duration: 400 }, // per item
  LEVEL_UP: { duration: 600 },
  CONTINUE_FADE: { duration: 300 }
};

export default class RewardsModal {
  constructor(game) {
    this.game = game;
    this.element = null;
    this.canvas = null;
    this.ctx = null;
    this.particles = [];
    this.animationFrame = null;
    this.abortController = new AbortController();
    this.callbacks = {};
  }

  /**
   * Show the rewards modal
   * @param {string} status - 'victory', 'defeat', or 'fled'
   * @param {Object} rewards - { gold, experience, items, levelUps, partyXP }
   * @param {Object} options - { onClose, onSound }
   */
  async show(status, rewards, options = {}) {
    this.callbacks = options;
    this.status = status;
    this.rewards = rewards || {};

    this.createModal();
    await this.runAnimations();
  }

  /**
   * Create the modal DOM structure
   */
  createModal() {
    this.element = document.createElement('div');
    this.element.id = 'rewards-modal';
    this.element.innerHTML = `
      <style>
        #rewards-modal {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.85);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 1000;
          opacity: 0;
          transition: opacity 0.3s ease;
        }
        #rewards-modal.visible {
          opacity: 1;
        }
        .rewards-container {
          background: linear-gradient(180deg, #2a2a4a 0%, #1a1a2e 100%);
          border: 2px solid #4a4a6a;
          border-radius: 12px;
          padding: 24px;
          min-width: 400px;
          max-width: 600px;
          max-height: 80vh;
          overflow-y: auto;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        }
        .rewards-banner {
          text-align: center;
          margin-bottom: 20px;
          transform: translateY(-50px);
          opacity: 0;
          transition: all 0.4s ease;
        }
        .rewards-banner.visible {
          transform: translateY(0);
          opacity: 1;
        }
        .rewards-banner h1 {
          font-size: 32px;
          margin: 0;
          text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
        }
        .rewards-banner.victory h1 {
          color: #ffd700;
        }
        .rewards-banner.defeat h1 {
          color: #f44336;
        }
        .rewards-banner.fled h1 {
          color: #8a8aaa;
        }
        .rewards-section {
          margin-bottom: 16px;
          opacity: 0;
          transform: translateY(20px);
          transition: all 0.3s ease;
        }
        .rewards-section.visible {
          opacity: 1;
          transform: translateY(0);
        }
        .rewards-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 12px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 6px;
          margin-bottom: 8px;
        }
        .rewards-label {
          font-size: 14px;
          color: #aaa;
        }
        .rewards-value {
          font-size: 20px;
          font-weight: bold;
        }
        .gold-value {
          color: #ffd700;
        }
        .xp-value {
          color: #4caf50;
        }
        .party-xp-section {
          margin-top: 16px;
        }
        .party-member {
          display: flex;
          align-items: center;
          margin-bottom: 8px;
          padding: 8px;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 4px;
        }
        .party-member-name {
          flex: 1;
          color: #fff;
          font-size: 14px;
        }
        .xp-bar-container {
          flex: 2;
          height: 16px;
          background: #333;
          border-radius: 8px;
          overflow: hidden;
          margin-left: 12px;
        }
        .xp-bar {
          height: 100%;
          background: linear-gradient(90deg, #4caf50, #8bc34a);
          width: 0%;
          transition: width 0.8s ease;
        }
        .xp-gained {
          margin-left: 12px;
          color: #4caf50;
          font-size: 12px;
          min-width: 60px;
        }
        .items-section {
          margin-top: 16px;
        }
        .items-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .item-card {
          background: rgba(0, 0, 0, 0.3);
          border: 2px solid #444;
          border-radius: 8px;
          padding: 8px 12px;
          opacity: 0;
          transform: scale(0.8);
          transition: all 0.4s ease;
        }
        .item-card.visible {
          opacity: 1;
          transform: scale(1);
        }
        .item-card.common { border-color: ${RARITY_COLORS.common}; }
        .item-card.uncommon { border-color: ${RARITY_COLORS.uncommon}; box-shadow: 0 0 8px ${RARITY_COLORS.uncommon}40; }
        .item-card.rare { border-color: ${RARITY_COLORS.rare}; box-shadow: 0 0 12px ${RARITY_COLORS.rare}60; }
        .item-card.epic { border-color: ${RARITY_COLORS.epic}; box-shadow: 0 0 16px ${RARITY_COLORS.epic}80; }
        .item-card.legendary { border-color: ${RARITY_COLORS.legendary}; box-shadow: 0 0 20px ${RARITY_COLORS.legendary}a0; animation: legendary-pulse 1s infinite; }
        @keyframes legendary-pulse {
          0%, 100% { box-shadow: 0 0 20px ${RARITY_COLORS.legendary}a0; }
          50% { box-shadow: 0 0 30px ${RARITY_COLORS.legendary}ff; }
        }
        .item-name {
          font-size: 13px;
          font-weight: bold;
          margin-bottom: 4px;
        }
        .item-type {
          font-size: 11px;
          color: #888;
        }
        .level-up-section {
          margin-top: 16px;
          text-align: center;
        }
        .level-up-card {
          display: inline-block;
          background: linear-gradient(135deg, #ffd700, #ff8c00);
          color: #000;
          padding: 12px 24px;
          border-radius: 8px;
          margin: 4px;
          opacity: 0;
          transform: scale(0);
          animation: level-up-appear 0.6s ease forwards;
        }
        @keyframes level-up-appear {
          0% { opacity: 0; transform: scale(0); }
          50% { transform: scale(1.2); }
          100% { opacity: 1; transform: scale(1); }
        }
        .level-up-name {
          font-weight: bold;
          font-size: 14px;
        }
        .level-up-levels {
          font-size: 12px;
          margin-top: 4px;
        }
        .continue-btn {
          display: block;
          width: 100%;
          padding: 12px;
          margin-top: 20px;
          background: linear-gradient(180deg, #4a4a8a, #3a3a6a);
          border: 2px solid #6a6aaa;
          border-radius: 8px;
          color: #fff;
          font-size: 16px;
          cursor: pointer;
          opacity: 0;
          transition: all 0.3s ease;
        }
        .continue-btn.visible {
          opacity: 1;
        }
        .continue-btn:hover {
          background: linear-gradient(180deg, #5a5a9a, #4a4a7a);
          border-color: #8a8acc;
        }
        #confetti-canvas {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
        }
      </style>
      <canvas id="confetti-canvas"></canvas>
      <div class="rewards-container">
        <div class="rewards-banner ${this.status}">
          <h1>${this.getBannerText()}</h1>
        </div>

        ${this.status === 'victory' ? `
        <div class="rewards-section" id="gold-section">
          <div class="rewards-row">
            <span class="rewards-label">Gold Earned</span>
            <span class="rewards-value gold-value">+<span id="gold-counter">0</span></span>
          </div>
        </div>

        <div class="rewards-section" id="xp-section">
          <div class="rewards-row">
            <span class="rewards-label">Experience Gained</span>
            <span class="rewards-value xp-value">+<span id="xp-counter">0</span></span>
          </div>
        </div>

        ${this.rewards.partyXP ? `
        <div class="rewards-section party-xp-section" id="party-section">
          ${this.rewards.partyXP.map(member => `
            <div class="party-member">
              <span class="party-member-name">${member.name}</span>
              <div class="xp-bar-container">
                <div class="xp-bar" data-target="${(member.totalXP / member.xpToNext * 100).toFixed(1)}"></div>
              </div>
              <span class="xp-gained">+${member.xpGained}</span>
            </div>
          `).join('')}
        </div>
        ` : ''}

        ${this.rewards.items && this.rewards.items.length > 0 ? `
        <div class="rewards-section items-section" id="items-section">
          <div class="rewards-label" style="margin-bottom: 8px;">Items Found</div>
          <div class="items-grid">
            ${this.rewards.items.map((item, idx) => `
              <div class="item-card ${item.rarity}" data-index="${idx}">
                <div class="item-name" style="color: ${RARITY_COLORS[item.rarity] || '#fff'}">${item.name}</div>
                <div class="item-type">${item.itemType} ${item.equipmentSlot ? `(${item.equipmentSlot})` : ''}</div>
              </div>
            `).join('')}
          </div>
        </div>
        ` : ''}

        ${this.rewards.levelUps && this.rewards.levelUps.length > 0 ? `
        <div class="rewards-section level-up-section" id="levelup-section">
          ${this.rewards.levelUps.map(lu => `
            <div class="level-up-card">
              <div class="level-up-name">${lu.name}</div>
              <div class="level-up-levels">Level ${lu.oldLevel} -> ${lu.newLevel}</div>
            </div>
          `).join('')}
        </div>
        ` : ''}
        ` : ''}

        <button class="continue-btn" id="continue-btn">Continue</button>
      </div>
    `;

    document.body.appendChild(this.element);

    // Setup canvas for confetti
    this.canvas = this.element.querySelector('#confetti-canvas');
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.ctx = this.canvas.getContext('2d');

    // Setup continue button
    const continueBtn = this.element.querySelector('#continue-btn');
    continueBtn.addEventListener('click', () => this.close(), { signal: this.abortController.signal });
  }

  /**
   * Get banner text based on status
   */
  getBannerText() {
    switch (this.status) {
      case 'victory': return 'Victory!';
      case 'defeat': return 'Defeat';
      case 'fled': return 'Escaped!';
      default: return 'Battle End';
    }
  }

  /**
   * Run all animations in sequence
   */
  async runAnimations() {
    // Phase 0: Modal fade in
    await this.delay(50);
    this.element.classList.add('visible');
    this.playSound('modal_open');
    await this.delay(ANIMATION_PHASES.MODAL_FADE.duration);

    // Phase 1: Banner slide
    const banner = this.element.querySelector('.rewards-banner');
    banner.classList.add('visible');
    this.playSound(this.status === 'victory' ? 'victory_fanfare' : 'defeat');
    await this.delay(ANIMATION_PHASES.BANNER_SLIDE.duration);

    // Start confetti for victory
    if (this.status === 'victory') {
      this.startConfetti();
    }

    if (this.status !== 'victory') {
      // Show continue button early for non-victory
      const continueBtn = this.element.querySelector('#continue-btn');
      continueBtn.classList.add('visible');
      return;
    }

    // Phase 2: Gold counter
    const goldSection = this.element.querySelector('#gold-section');
    if (goldSection) {
      goldSection.classList.add('visible');
      await this.animateCounter('gold-counter', this.rewards.gold || 0);
      this.playSound('gold_gain');
    }

    // Phase 3: XP counter
    const xpSection = this.element.querySelector('#xp-section');
    if (xpSection) {
      xpSection.classList.add('visible');
      await this.animateCounter('xp-counter', this.rewards.experience || 0);
      this.playSound('xp_gain');
    }

    // Phase 4: Party XP bars
    const partySection = this.element.querySelector('#party-section');
    if (partySection) {
      partySection.classList.add('visible');
      await this.delay(100);
      const bars = partySection.querySelectorAll('.xp-bar');
      bars.forEach(bar => {
        bar.style.width = bar.dataset.target + '%';
      });
      await this.delay(ANIMATION_PHASES.PARTY_XP.duration);
    }

    // Phase 5: Items reveal
    const itemsSection = this.element.querySelector('#items-section');
    if (itemsSection && this.rewards.items) {
      itemsSection.classList.add('visible');
      const itemCards = itemsSection.querySelectorAll('.item-card');
      for (const card of itemCards) {
        await this.delay(ANIMATION_PHASES.ITEM_REVEAL.duration);
        card.classList.add('visible');
        this.playSound('item_drop');
      }
    }

    // Phase 6: Level ups
    const levelupSection = this.element.querySelector('#levelup-section');
    if (levelupSection) {
      levelupSection.classList.add('visible');
      this.playSound('level_up');
      await this.delay(ANIMATION_PHASES.LEVEL_UP.duration);
    }

    // Phase 7: Continue button
    const continueBtn = this.element.querySelector('#continue-btn');
    continueBtn.classList.add('visible');
  }

  /**
   * Animate a number counter
   */
  animateCounter(elementId, target) {
    return new Promise(resolve => {
      const el = this.element.querySelector(`#${elementId}`);
      if (!el) {
        resolve();
        return;
      }

      const duration = ANIMATION_PHASES.GOLD_COUNT.duration;
      const startTime = performance.now();

      const update = (currentTime) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Ease out cubic
        const easeProgress = 1 - Math.pow(1 - progress, 3);
        const current = Math.floor(easeProgress * target);

        el.textContent = current.toLocaleString();

        if (progress < 1) {
          requestAnimationFrame(update);
        } else {
          el.textContent = target.toLocaleString();
          resolve();
        }
      };

      requestAnimationFrame(update);
    });
  }

  /**
   * Start confetti particle system
   */
  startConfetti() {
    const colors = ['#ffd700', '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7'];

    // Create initial particles
    for (let i = 0; i < 100; i++) {
      this.particles.push({
        x: Math.random() * this.canvas.width,
        y: Math.random() * this.canvas.height - this.canvas.height,
        vx: (Math.random() - 0.5) * 4,
        vy: Math.random() * 3 + 2,
        size: Math.random() * 8 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.2
      });
    }

    this.animateConfetti();
  }

  /**
   * Animate confetti particles
   */
  animateConfetti() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];

      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.rotationSpeed;
      p.vy += 0.1; // gravity

      // Draw particle
      this.ctx.save();
      this.ctx.translate(p.x, p.y);
      this.ctx.rotate(p.rotation);
      this.ctx.fillStyle = p.color;
      this.ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      this.ctx.restore();

      // Remove off-screen particles
      if (p.y > this.canvas.height + 50) {
        this.particles.splice(i, 1);
      }
    }

    if (this.particles.length > 0) {
      this.animationFrame = requestAnimationFrame(() => this.animateConfetti());
    }
  }

  /**
   * Play sound effect
   */
  playSound(soundId) {
    if (this.callbacks.onSound) {
      this.callbacks.onSound(soundId);
    }
  }

  /**
   * Utility delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Close the modal
   */
  close() {
    this.playSound('button_click');

    // Stop confetti
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }

    // Fade out
    this.element.classList.remove('visible');

    setTimeout(() => {
      this.destroy();
      if (this.callbacks.onClose) {
        this.callbacks.onClose();
      }
    }, 300);
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this.abortController) {
      this.abortController.abort();
    }
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
    this.particles = [];
    this.ctx = null;
    this.canvas = null;
  }
}
