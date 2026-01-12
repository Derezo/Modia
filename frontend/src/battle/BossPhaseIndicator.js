import {
  PARCHMENT_COLORS,
  getParchmentGradient,
  getParchmentBorder
} from '../ui/parchment/index.js';

const P = PARCHMENT_COLORS;

/**
 * BossPhaseIndicator - Displays boss health, phase progress, and phase transitions
 * Shows at the top of the battle screen when fighting a boss enemy
 */
export class BossPhaseIndicator {
  constructor(game) {
    this.game = game;
    this.element = null;
    this.bossData = null;
    this.isTransitioning = false;
    this.transitionTimeout = null;
    this.shakeAnimationId = null;
    this.shakeTimeoutId = null;
  }

  /**
   * Create the boss phase indicator UI
   * @param {Object} bossData - Initial boss data { name, title, currentPhase, maxPhases, hp, maxHp, phaseName }
   */
  create(bossData) {
    this.bossData = bossData;

    const container = document.createElement('div');
    container.id = 'boss-phase-indicator';
    container.style.cssText = `
      position: absolute;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      pointer-events: none;
      min-width: 320px;
      max-width: 400px;
      font-family: Georgia, 'Times New Roman', serif;
      z-index: 100;
      transition: opacity 0.3s ease;
    `;

    container.innerHTML = this.renderContent();
    this.game.uiOverlay.appendChild(container);
    this.element = container;
  }

  /**
   * Render the indicator content
   */
  renderContent() {
    if (!this.bossData) return '';

    const { name, title, currentPhase, maxPhases, hp, maxHp, phaseName } = this.bossData;
    const hpPercent = Math.max(0, Math.min(100, (hp / maxHp) * 100));

    // Generate phase dots
    const phaseDots = [];
    for (let i = 1; i <= maxPhases; i++) {
      const isComplete = i < currentPhase;
      const isCurrent = i === currentPhase;
      phaseDots.push(`
        <div style="
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: ${isComplete ? P.state.success : (isCurrent ? P.accent.burgundy : P.dark)};
          border: 2px solid ${isCurrent ? P.accent.burgundy : P.border};
          box-shadow: ${isCurrent ? '0 0 6px rgba(201, 162, 39, 0.6)' : 'none'};
          transition: all 0.3s ease;
        "></div>
      `);
    }

    return `
      <div style="
        background: ${getParchmentGradient()};
        border: ${getParchmentBorder(2)};
        border-radius: 6px;
        padding: 12px 16px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      ">
        <!-- Boss Name and Title -->
        <div style="
          text-align: center;
          margin-bottom: 8px;
        ">
          <div style="
            color: ${P.state.error};
            font-size: 16px;
            font-weight: bold;
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
          ">${name}</div>
          ${title ? `<div style="
            color: ${P.text.secondary};
            font-size: 11px;
            font-style: italic;
          ">${title}</div>` : ''}
        </div>

        <!-- HP Bar -->
        <div style="
          position: relative;
          height: 18px;
          background: ${P.dark};
          border: 2px solid ${P.border};
          border-radius: 9px;
          overflow: hidden;
          margin-bottom: 10px;
        ">
          <div id="boss-hp-bar" style="
            position: absolute;
            top: 0;
            left: 0;
            height: 100%;
            width: ${hpPercent}%;
            background: linear-gradient(to bottom, #c62828, #8b0000);
            border-radius: 7px;
            transition: width 0.3s ease;
          "></div>
          <div style="
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 11px;
            font-weight: bold;
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
          ">${hp} / ${maxHp}</div>
        </div>

        <!-- Phase Indicator -->
        <div style="
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        ">
          <span style="
            color: ${P.text.secondary};
            font-size: 11px;
          ">Phase:</span>
          <div style="
            display: flex;
            gap: 6px;
            align-items: center;
          ">
            ${phaseDots.join('')}
          </div>
          <span style="
            color: ${P.accent.burgundy};
            font-size: 11px;
            font-weight: bold;
            margin-left: 8px;
          ">${phaseName || `Phase ${currentPhase}`}</span>
        </div>
      </div>

      <!-- Phase Transition Overlay (hidden by default) -->
      <div id="boss-phase-transition" style="
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        margin-top: 10px;
        padding: 12px 24px;
        background: linear-gradient(to bottom, rgba(139, 0, 0, 0.95), rgba(80, 0, 0, 0.95));
        border: 2px solid ${P.accent.burgundy};
        border-radius: 6px;
        box-shadow: 0 4px 20px rgba(139, 0, 0, 0.6);
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.3s ease, visibility 0.3s ease;
        text-align: center;
        pointer-events: none;
      ">
        <div style="
          color: ${P.accent.burgundy};
          font-size: 14px;
          font-weight: bold;
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
        ">Phase Transition!</div>
        <div id="boss-new-phase-name" style="
          color: white;
          font-size: 16px;
          font-weight: bold;
          margin-top: 4px;
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
        "></div>
      </div>
    `;
  }

  /**
   * Update the boss data and refresh display
   * @param {Object} updates - Updated boss data
   */
  update(updates) {
    if (!this.element || !this.bossData) return;

    // Merge updates
    this.bossData = { ...this.bossData, ...updates };

    // Update HP bar
    const hpBar = this.element.querySelector('#boss-hp-bar');
    if (hpBar && updates.hp !== undefined) {
      const hpPercent = Math.max(0, Math.min(100, (this.bossData.hp / this.bossData.maxHp) * 100));
      hpBar.style.width = `${hpPercent}%`;

      // Update HP text
      const hpText = hpBar.nextElementSibling;
      if (hpText) {
        hpText.textContent = `${this.bossData.hp} / ${this.bossData.maxHp}`;
      }
    }

    // If phase changed, re-render
    if (updates.currentPhase !== undefined || updates.phaseName !== undefined) {
      this.element.innerHTML = this.renderContent();
    }
  }

  /**
   * Play phase transition animation
   * @param {Object} transition - Transition data { newPhase, phaseName, message }
   */
  playPhaseTransition(transition) {
    if (!this.element || this.isTransitioning) return;

    this.isTransitioning = true;

    // Update boss data
    this.bossData.currentPhase = transition.newPhase;
    this.bossData.phaseName = transition.phaseName;

    // Show transition overlay
    const overlay = this.element.querySelector('#boss-phase-transition');
    const phaseNameEl = this.element.querySelector('#boss-new-phase-name');

    if (overlay && phaseNameEl) {
      phaseNameEl.textContent = transition.phaseName || `Phase ${transition.newPhase}`;
      overlay.style.opacity = '1';
      overlay.style.visibility = 'visible';

      // Screen shake effect (if available)
      this.triggerScreenShake();

      // Hide after delay and update main display
      this.transitionTimeout = setTimeout(() => {
        overlay.style.opacity = '0';
        overlay.style.visibility = 'hidden';

        // Re-render with new phase
        this.element.innerHTML = this.renderContent();

        this.isTransitioning = false;
      }, 2500);
    }
  }

  /**
   * Trigger screen shake effect
   */
  triggerScreenShake() {
    const canvas = this.game.canvas;
    if (!canvas) return;

    // Cancel any existing shake animation
    this.cancelShakeAnimation();

    // Add shake class or trigger shake animation
    const originalTransform = canvas.style.transform;
    let shakeCount = 0;
    const maxShakes = 10;
    const shakeIntensity = 4;

    const shake = () => {
      if (shakeCount >= maxShakes) {
        canvas.style.transform = originalTransform;
        this.shakeAnimationId = null;
        this.shakeTimeoutId = null;
        return;
      }

      const x = (Math.random() - 0.5) * shakeIntensity * (1 - shakeCount / maxShakes);
      const y = (Math.random() - 0.5) * shakeIntensity * (1 - shakeCount / maxShakes);
      canvas.style.transform = `translate(${x}px, ${y}px)`;
      shakeCount++;

      this.shakeAnimationId = requestAnimationFrame(() => {
        this.shakeTimeoutId = setTimeout(shake, 50);
      });
    };

    shake();
  }

  /**
   * Cancel ongoing shake animation
   */
  cancelShakeAnimation() {
    if (this.shakeAnimationId) {
      cancelAnimationFrame(this.shakeAnimationId);
      this.shakeAnimationId = null;
    }
    if (this.shakeTimeoutId) {
      clearTimeout(this.shakeTimeoutId);
      this.shakeTimeoutId = null;
    }
  }

  /**
   * Show the indicator
   */
  show() {
    if (this.element) {
      this.element.style.opacity = '1';
    }
  }

  /**
   * Hide the indicator
   */
  hide() {
    if (this.element) {
      this.element.style.opacity = '0';
    }
  }

  /**
   * Check if we have a boss to display
   */
  hasBoss() {
    return this.bossData !== null;
  }

  /**
   * Destroy the indicator
   */
  destroy() {
    // Cancel any ongoing shake animation
    this.cancelShakeAnimation();

    if (this.transitionTimeout) {
      clearTimeout(this.transitionTimeout);
      this.transitionTimeout = null;
    }

    if (this.element) {
      this.element.remove();
      this.element = null;
    }

    this.bossData = null;
    this.isTransitioning = false;
  }
}
