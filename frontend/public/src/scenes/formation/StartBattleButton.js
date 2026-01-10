/**
 * StartBattleButton - Themed SVG button for initiating battle
 *
 * Creates visually distinct buttons for each battle context with
 * idle animations, hover effects, and click animations.
 */
export class StartBattleButton {
  constructor(options = {}) {
    this.type = options.type || 'swords';
    this.onClick = options.onClick || (() => {});
    this.disabled = options.disabled || false;

    this.element = null;
    this.svgElement = null;
    this.animationFrame = 0;
    this.isHovered = false;
    this.isPressed = false;
    this.animationId = null;

    this.create();
  }

  create() {
    this.element = document.createElement('button');
    this.element.className = 'start-battle-btn';
    this.element.disabled = this.disabled;

    this.element.innerHTML = `
      <div class="btn-content">
        ${this.getSVGContent()}
        <span class="btn-text">Start Battle</span>
      </div>
      <div class="btn-glow"></div>
    `;

    this.addStyles();
    this.setupEventListeners();
    this.startIdleAnimation();

    this.svgElement = this.element.querySelector('svg');
  }

  getSVGContent() {
    switch (this.type) {
      case 'swords':
        return this.getSwordsSVG();
      case 'fist':
        return this.getFistSVG();
      case 'spellbook':
        return this.getSpellbookSVG();
      case 'axe':
        return this.getAxeSVG();
      case 'palm':
        return this.getPalmSVG();
      case 'lever':
        return this.getLeverSVG();
      default:
        return this.getSwordsSVG();
    }
  }

  getSwordsSVG() {
    return `
      <svg class="btn-icon" viewBox="0 0 64 48" width="64" height="48">
        <defs>
          <linearGradient id="sword-blade" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#e8e8e8"/>
            <stop offset="50%" style="stop-color:#c0c0c0"/>
            <stop offset="100%" style="stop-color:#a0a0a0"/>
          </linearGradient>
          <linearGradient id="sword-gleam" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style="stop-color:rgba(255,255,255,0)"/>
            <stop class="gleam-stop" offset="50%" style="stop-color:rgba(255,255,255,0.8)"/>
            <stop offset="100%" style="stop-color:rgba(255,255,255,0)"/>
          </linearGradient>
          <linearGradient id="shield-gold" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:#ffd700"/>
            <stop offset="50%" style="stop-color:#daa520"/>
            <stop offset="100%" style="stop-color:#b8860b"/>
          </linearGradient>
        </defs>

        <!-- Left Sword -->
        <g class="sword-left" transform="rotate(-30, 20, 35)">
          <rect x="18" y="8" width="4" height="24" fill="url(#sword-blade)" rx="1"/>
          <rect x="18" y="8" width="4" height="24" fill="url(#sword-gleam)" rx="1" class="gleam"/>
          <rect x="14" y="30" width="12" height="4" fill="#8b4513" rx="1"/>
          <rect x="18" y="34" width="4" height="6" fill="#654321" rx="1"/>
        </g>

        <!-- Right Sword -->
        <g class="sword-right" transform="rotate(30, 44, 35)">
          <rect x="42" y="8" width="4" height="24" fill="url(#sword-blade)" rx="1"/>
          <rect x="42" y="8" width="4" height="24" fill="url(#sword-gleam)" rx="1" class="gleam"/>
          <rect x="38" y="30" width="12" height="4" fill="#8b4513" rx="1"/>
          <rect x="42" y="34" width="4" height="6" fill="#654321" rx="1"/>
        </g>

        <!-- Shield (center) -->
        <path class="shield" d="M32 18 L42 22 L42 32 Q32 42 32 42 Q32 42 22 32 L22 22 Z"
              fill="url(#shield-gold)" stroke="#8b4513" stroke-width="2"/>
        <path d="M32 22 L32 38" stroke="#8b4513" stroke-width="1.5" opacity="0.5"/>
        <path d="M26 26 L38 26" stroke="#8b4513" stroke-width="1.5" opacity="0.5"/>

        <!-- Spark effect (hidden by default) -->
        <g class="spark" opacity="0">
          <circle cx="32" cy="20" r="3" fill="#fff"/>
          <circle cx="28" cy="16" r="2" fill="#ffd700"/>
          <circle cx="36" cy="16" r="2" fill="#ffd700"/>
          <circle cx="32" cy="14" r="1.5" fill="#fff"/>
        </g>
      </svg>
    `;
  }

  getFistSVG() {
    return `
      <svg class="btn-icon" viewBox="0 0 64 48" width="64" height="48">
        <defs>
          <linearGradient id="fist-skin" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:#d4a574"/>
            <stop offset="100%" style="stop-color:#b8956a"/>
          </linearGradient>
          <linearGradient id="spike-metal" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#808080"/>
            <stop offset="100%" style="stop-color:#4a4a4a"/>
          </linearGradient>
        </defs>

        <!-- Fist -->
        <g class="fist-group">
          <!-- Main fist body -->
          <ellipse cx="32" cy="28" rx="14" ry="12" fill="url(#fist-skin)" stroke="#8b6914" stroke-width="1"/>

          <!-- Knuckles -->
          <ellipse cx="24" cy="22" rx="4" ry="3" fill="url(#fist-skin)" stroke="#8b6914" stroke-width="0.5"/>
          <ellipse cx="32" cy="20" rx="4" ry="3" fill="url(#fist-skin)" stroke="#8b6914" stroke-width="0.5"/>
          <ellipse cx="40" cy="22" rx="4" ry="3" fill="url(#fist-skin)" stroke="#8b6914" stroke-width="0.5"/>

          <!-- Spikes -->
          <polygon class="spike" points="24,18 22,10 26,10" fill="url(#spike-metal)" stroke="#333" stroke-width="0.5"/>
          <polygon class="spike" points="32,16 30,6 34,6" fill="url(#spike-metal)" stroke="#333" stroke-width="0.5"/>
          <polygon class="spike" points="40,18 38,10 42,10" fill="url(#spike-metal)" stroke="#333" stroke-width="0.5"/>

          <!-- Wrist band -->
          <rect x="20" y="36" width="24" height="6" fill="#4a3728" rx="2"/>
          <rect x="22" y="37" width="20" height="1" fill="#8b6914" opacity="0.5"/>
        </g>

        <!-- Dust burst (hidden) -->
        <g class="dust-burst" opacity="0">
          <circle cx="32" cy="42" r="8" fill="rgba(139,90,43,0.3)"/>
          <circle cx="24" cy="44" r="4" fill="rgba(139,90,43,0.2)"/>
          <circle cx="40" cy="44" r="4" fill="rgba(139,90,43,0.2)"/>
        </g>
      </svg>
    `;
  }

  getSpellbookSVG() {
    return `
      <svg class="btn-icon" viewBox="0 0 64 48" width="64" height="48">
        <defs>
          <linearGradient id="book-cover" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:#4a2882"/>
            <stop offset="100%" style="stop-color:#2d1a4e"/>
          </linearGradient>
          <linearGradient id="magic-glow" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:#ffd700"/>
            <stop offset="100%" style="stop-color:#ff6b00"/>
          </linearGradient>
        </defs>

        <!-- Book -->
        <g class="book-group">
          <!-- Back cover -->
          <rect x="18" y="12" width="28" height="32" fill="url(#book-cover)" rx="2"/>
          <!-- Pages -->
          <rect x="20" y="14" width="24" height="28" fill="#f5f5dc" rx="1"/>
          <!-- Front cover -->
          <rect x="22" y="10" width="28" height="32" fill="url(#book-cover)" rx="2"/>

          <!-- Spine decoration -->
          <rect x="22" y="10" width="3" height="32" fill="#3d1f6d"/>

          <!-- Arcane seal on cover -->
          <circle class="seal" cx="38" cy="26" r="10" fill="none" stroke="url(#magic-glow)" stroke-width="2"/>
          <circle class="seal-inner" cx="38" cy="26" r="6" fill="none" stroke="#ffd700" stroke-width="1"/>

          <!-- Runes orbiting (animated) -->
          <g class="runes">
            <text x="38" y="18" font-size="6" fill="#ffd700" text-anchor="middle" class="rune">&#x2721;</text>
            <text x="46" y="26" font-size="6" fill="#ffd700" text-anchor="middle" class="rune">&#x2606;</text>
            <text x="38" y="36" font-size="6" fill="#ffd700" text-anchor="middle" class="rune">&#x2726;</text>
            <text x="30" y="26" font-size="6" fill="#ffd700" text-anchor="middle" class="rune">&#x2605;</text>
          </g>
        </g>

        <!-- Magic burst (hidden) -->
        <g class="magic-burst" opacity="0">
          <circle cx="38" cy="26" r="15" fill="rgba(255,215,0,0.3)"/>
          <circle cx="38" cy="26" r="20" fill="rgba(255,215,0,0.1)"/>
        </g>
      </svg>
    `;
  }

  getAxeSVG() {
    return `
      <svg class="btn-icon" viewBox="0 0 64 48" width="64" height="48">
        <defs>
          <linearGradient id="axe-blade" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style="stop-color:#c0c0c0"/>
            <stop offset="50%" style="stop-color:#e0e0e0"/>
            <stop offset="100%" style="stop-color:#a0a0a0"/>
          </linearGradient>
          <linearGradient id="axe-handle" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style="stop-color:#5a3d2b"/>
            <stop offset="50%" style="stop-color:#8b5a2b"/>
            <stop offset="100%" style="stop-color:#5a3d2b"/>
          </linearGradient>
        </defs>

        <g class="axe-group">
          <!-- Handle -->
          <rect x="30" y="8" width="4" height="36" fill="url(#axe-handle)" rx="1"/>

          <!-- Axe head -->
          <path class="blade" d="M20 12 Q16 20 20 28 L30 24 L30 16 Z"
                fill="url(#axe-blade)" stroke="#666" stroke-width="1"/>
          <path class="blade" d="M44 12 Q48 20 44 28 L34 24 L34 16 Z"
                fill="url(#axe-blade)" stroke="#666" stroke-width="1"/>

          <!-- Metal band -->
          <rect x="28" y="14" width="8" height="4" fill="#4a4a4a" rx="1"/>
          <rect x="28" y="22" width="8" height="4" fill="#4a4a4a" rx="1"/>

          <!-- Gleam -->
          <path class="gleam" d="M22 14 L24 20 L22 20 Z" fill="rgba(255,255,255,0.6)"/>
          <path class="gleam" d="M42 14 L40 20 L42 20 Z" fill="rgba(255,255,255,0.6)"/>
        </g>
      </svg>
    `;
  }

  getPalmSVG() {
    return `
      <svg class="btn-icon" viewBox="0 0 64 48" width="64" height="48">
        <defs>
          <linearGradient id="energy-flow" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#fff"/>
            <stop offset="50%" style="stop-color:#87ceeb"/>
            <stop offset="100%" style="stop-color:#fff"/>
          </linearGradient>
        </defs>

        <!-- Yin-yang circle -->
        <g class="circle-group">
          <circle cx="32" cy="24" r="18" fill="none" stroke="#2d2d2d" stroke-width="3"/>

          <!-- Energy aura -->
          <circle class="aura" cx="32" cy="24" r="20" fill="none" stroke="url(#energy-flow)"
                  stroke-width="1" opacity="0.5"/>

          <!-- Palm silhouette -->
          <g class="palm-group" fill="#f5deb3" stroke="#8b7355" stroke-width="0.5">
            <!-- Palm -->
            <ellipse cx="32" cy="28" rx="8" ry="10"/>
            <!-- Fingers -->
            <ellipse cx="24" cy="18" rx="2.5" ry="6" transform="rotate(-15, 24, 18)"/>
            <ellipse cx="29" cy="14" rx="2.5" ry="7"/>
            <ellipse cx="35" cy="14" rx="2.5" ry="7"/>
            <ellipse cx="40" cy="18" rx="2.5" ry="6" transform="rotate(15, 40, 18)"/>
            <!-- Thumb -->
            <ellipse cx="22" cy="28" rx="2.5" ry="5" transform="rotate(-30, 22, 28)"/>
          </g>

          <!-- Center energy -->
          <circle class="center-energy" cx="32" cy="26" r="3" fill="rgba(135,206,235,0.6)"/>
        </g>

        <!-- Ripple effect (hidden) -->
        <g class="ripple" opacity="0">
          <circle cx="32" cy="24" r="22" fill="none" stroke="rgba(135,206,235,0.5)" stroke-width="2"/>
          <circle cx="32" cy="24" r="26" fill="none" stroke="rgba(135,206,235,0.3)" stroke-width="1"/>
        </g>
      </svg>
    `;
  }

  getLeverSVG() {
    return `
      <svg class="btn-icon" viewBox="0 0 64 48" width="64" height="48">
        <defs>
          <linearGradient id="brass" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:#d4a550"/>
            <stop offset="50%" style="stop-color:#b8860b"/>
            <stop offset="100%" style="stop-color:#8b6914"/>
          </linearGradient>
          <linearGradient id="gauge-glass" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:rgba(255,255,255,0.3)"/>
            <stop offset="100%" style="stop-color:rgba(255,255,255,0.1)"/>
          </linearGradient>
        </defs>

        <g class="lever-group">
          <!-- Base plate -->
          <rect x="10" y="36" width="44" height="8" fill="url(#brass)" rx="2"/>
          <rect x="12" y="38" width="40" height="1" fill="rgba(255,255,255,0.3)"/>

          <!-- Lever arm -->
          <g class="lever-arm">
            <rect x="20" y="12" width="6" height="26" fill="#4a4a4a" rx="2"/>
            <!-- Handle ball -->
            <circle cx="23" cy="10" r="6" fill="url(#brass)"/>
            <circle cx="21" cy="8" r="2" fill="rgba(255,255,255,0.4)"/>
          </g>

          <!-- Pressure gauge -->
          <g class="gauge">
            <circle cx="44" cy="24" r="10" fill="#2d2d2d" stroke="url(#brass)" stroke-width="2"/>
            <circle cx="44" cy="24" r="8" fill="url(#gauge-glass)"/>
            <!-- Gauge markings -->
            <path d="M44 16 L44 18" stroke="#4caf50" stroke-width="1"/>
            <path d="M44 30 L44 32" stroke="#f44336" stroke-width="1"/>
            <path d="M36 24 L38 24" stroke="#fff" stroke-width="1"/>
            <path d="M50 24 L52 24" stroke="#fff" stroke-width="1"/>
            <!-- Needle -->
            <line class="needle" x1="44" y1="24" x2="44" y2="17" stroke="#f44336" stroke-width="1.5"/>
            <circle cx="44" cy="24" r="2" fill="#333"/>
          </g>

          <!-- Steam wisps -->
          <g class="steam" opacity="0.5">
            <ellipse cx="14" cy="34" rx="3" ry="2" fill="rgba(255,255,255,0.4)"/>
            <ellipse cx="12" cy="30" rx="2" ry="1.5" fill="rgba(255,255,255,0.3)"/>
          </g>
        </g>

        <!-- Steam burst (hidden) -->
        <g class="steam-burst" opacity="0">
          <ellipse cx="16" cy="28" rx="8" ry="4" fill="rgba(255,255,255,0.5)"/>
          <ellipse cx="20" cy="22" rx="6" ry="3" fill="rgba(255,255,255,0.4)"/>
        </g>
      </svg>
    `;
  }

  addStyles() {
    if (document.getElementById('start-battle-btn-styles')) return;

    const style = document.createElement('style');
    style.id = 'start-battle-btn-styles';
    style.textContent = `
      .start-battle-btn {
        position: relative;
        padding: 12px 24px;
        min-width: 200px;
        background: linear-gradient(180deg, #4a5a3a 0%, #3a4a2a 50%, #2a3a1a 100%);
        border: 3px solid #8b7355;
        border-radius: 8px;
        cursor: pointer;
        overflow: hidden;
        transition: all 0.2s ease;
        box-shadow:
          0 4px 8px rgba(0,0,0,0.3),
          inset 0 1px 0 rgba(255,255,255,0.1),
          inset 0 -2px 0 rgba(0,0,0,0.2);
      }

      .start-battle-btn:hover:not(:disabled) {
        transform: translateY(-2px) scale(1.02);
        box-shadow:
          0 6px 12px rgba(0,0,0,0.4),
          inset 0 1px 0 rgba(255,255,255,0.15),
          inset 0 -2px 0 rgba(0,0,0,0.2);
        border-color: #a08060;
      }

      .start-battle-btn:active:not(:disabled) {
        transform: translateY(1px) scale(0.98);
        box-shadow:
          0 2px 4px rgba(0,0,0,0.3),
          inset 0 2px 4px rgba(0,0,0,0.2);
      }

      .start-battle-btn:disabled {
        filter: grayscale(0.8);
        opacity: 0.6;
        cursor: not-allowed;
      }

      .start-battle-btn .btn-content {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        position: relative;
        z-index: 1;
      }

      .start-battle-btn .btn-text {
        font-size: 16px;
        font-weight: bold;
        color: #ffd700;
        text-transform: uppercase;
        letter-spacing: 1px;
        text-shadow: 0 2px 4px rgba(0,0,0,0.5);
      }

      .start-battle-btn .btn-icon {
        filter: drop-shadow(0 2px 2px rgba(0,0,0,0.3));
      }

      .start-battle-btn .btn-glow {
        position: absolute;
        top: 0;
        left: -100%;
        width: 50%;
        height: 100%;
        background: linear-gradient(
          90deg,
          rgba(255,255,255,0) 0%,
          rgba(255,255,255,0.1) 50%,
          rgba(255,255,255,0) 100%
        );
        animation: btn-shine 3s ease-in-out infinite;
      }

      .start-battle-btn:disabled .btn-glow {
        animation: none;
        display: none;
      }

      @keyframes btn-shine {
        0%, 100% { left: -100%; }
        50% { left: 150%; }
      }

      /* Sword gleam animation */
      .start-battle-btn .gleam {
        animation: sword-gleam 3s ease-in-out infinite;
      }

      @keyframes sword-gleam {
        0%, 100% { opacity: 0; }
        50% { opacity: 0.6; }
      }

      /* Fist pulse animation */
      .start-battle-btn .fist-group {
        animation: fist-pulse 2s ease-in-out infinite;
        transform-origin: center center;
      }

      @keyframes fist-pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.03); }
      }

      /* Rune orbit animation */
      .start-battle-btn .runes {
        animation: rune-orbit 8s linear infinite;
        transform-origin: 38px 26px;
      }

      @keyframes rune-orbit {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }

      /* Axe glint animation */
      .start-battle-btn .axe-group .gleam {
        animation: axe-glint 2s ease-in-out infinite;
      }

      @keyframes axe-glint {
        0%, 100% { opacity: 0.3; }
        50% { opacity: 0.8; }
      }

      /* Palm energy flow */
      .start-battle-btn .aura {
        animation: energy-pulse 2s ease-in-out infinite;
      }

      @keyframes energy-pulse {
        0%, 100% { stroke-width: 1; opacity: 0.3; }
        50% { stroke-width: 3; opacity: 0.7; }
      }

      /* Lever needle tremble */
      .start-battle-btn .needle {
        animation: needle-tremble 0.5s ease-in-out infinite;
        transform-origin: 44px 24px;
      }

      @keyframes needle-tremble {
        0%, 100% { transform: rotate(-5deg); }
        50% { transform: rotate(5deg); }
      }

      /* Steam wisps */
      .start-battle-btn .steam {
        animation: steam-rise 2s ease-out infinite;
      }

      @keyframes steam-rise {
        0% { transform: translateY(0); opacity: 0.5; }
        100% { transform: translateY(-10px); opacity: 0; }
      }

      /* Hover intensification */
      .start-battle-btn:hover:not(:disabled) .btn-icon {
        filter: drop-shadow(0 0 8px rgba(255,215,0,0.5));
      }

      .start-battle-btn:hover:not(:disabled) .gleam {
        animation-duration: 1.5s;
      }

      .start-battle-btn:hover:not(:disabled) .runes {
        animation-duration: 4s;
      }

      /* Mobile adjustments */
      @media (max-width: 768px) {
        .start-battle-btn {
          min-width: 160px;
          padding: 10px 20px;
        }

        .start-battle-btn .btn-text {
          font-size: 14px;
        }

        .start-battle-btn .btn-icon {
          width: 48px;
          height: 36px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  setupEventListeners() {
    this.element.addEventListener('click', (e) => {
      if (!this.disabled) {
        this.playClickAnimation();
        this.onClick(e);
      }
    });

    this.element.addEventListener('mouseenter', () => {
      this.isHovered = true;
    });

    this.element.addEventListener('mouseleave', () => {
      this.isHovered = false;
    });

    this.element.addEventListener('mousedown', () => {
      this.isPressed = true;
    });

    this.element.addEventListener('mouseup', () => {
      this.isPressed = false;
    });
  }

  startIdleAnimation() {
    // CSS handles most animations, but we can add JS-based enhancements here
  }

  playClickAnimation() {
    // Trigger click-specific animations based on type
    const svg = this.element.querySelector('svg');
    if (!svg) return;

    switch (this.type) {
      case 'swords':
        this.playSwordsClash(svg);
        break;
      case 'fist':
        this.playFistSlam(svg);
        break;
      case 'spellbook':
        this.playMagicBurst(svg);
        break;
      case 'axe':
        this.playAxeSwing(svg);
        break;
      case 'palm':
        this.playPalmStrike(svg);
        break;
      case 'lever':
        this.playLeverPull(svg);
        break;
    }
  }

  playSwordsClash(svg) {
    const spark = svg.querySelector('.spark');
    const leftSword = svg.querySelector('.sword-left');
    const rightSword = svg.querySelector('.sword-right');

    if (spark) {
      spark.style.transition = 'opacity 0.1s';
      spark.style.opacity = '1';
      setTimeout(() => { spark.style.opacity = '0'; }, 200);
    }

    if (leftSword && rightSword) {
      leftSword.style.transition = 'transform 0.1s';
      rightSword.style.transition = 'transform 0.1s';
      leftSword.style.transform = 'rotate(-15, 20, 35)';
      rightSword.style.transform = 'rotate(15, 44, 35)';
      setTimeout(() => {
        leftSword.style.transform = '';
        rightSword.style.transform = '';
      }, 150);
    }
  }

  playFistSlam(svg) {
    const dust = svg.querySelector('.dust-burst');
    const fist = svg.querySelector('.fist-group');

    if (fist) {
      fist.style.transition = 'transform 0.15s ease-out';
      fist.style.transform = 'translateY(5px)';
      setTimeout(() => { fist.style.transform = ''; }, 200);
    }

    if (dust) {
      dust.style.transition = 'opacity 0.1s';
      dust.style.opacity = '1';
      setTimeout(() => { dust.style.opacity = '0'; }, 300);
    }
  }

  playMagicBurst(svg) {
    const burst = svg.querySelector('.magic-burst');
    const seal = svg.querySelector('.seal');

    if (burst) {
      burst.style.transition = 'opacity 0.2s';
      burst.style.opacity = '1';
      setTimeout(() => { burst.style.opacity = '0'; }, 400);
    }

    if (seal) {
      seal.style.transition = 'stroke-width 0.2s';
      seal.style.strokeWidth = '4';
      setTimeout(() => { seal.style.strokeWidth = ''; }, 300);
    }
  }

  playAxeSwing(svg) {
    const axe = svg.querySelector('.axe-group');

    if (axe) {
      axe.style.transition = 'transform 0.2s ease-out';
      axe.style.transformOrigin = 'center bottom';
      axe.style.transform = 'rotate(-15deg)';
      setTimeout(() => {
        axe.style.transform = 'rotate(5deg)';
        setTimeout(() => { axe.style.transform = ''; }, 150);
      }, 100);
    }
  }

  playPalmStrike(svg) {
    const ripple = svg.querySelector('.ripple');
    const palm = svg.querySelector('.palm-group');

    if (palm) {
      palm.style.transition = 'transform 0.15s ease-out';
      palm.style.transform = 'scale(1.1)';
      setTimeout(() => { palm.style.transform = ''; }, 200);
    }

    if (ripple) {
      ripple.style.transition = 'opacity 0.15s';
      ripple.style.opacity = '1';
      setTimeout(() => { ripple.style.opacity = '0'; }, 400);
    }
  }

  playLeverPull(svg) {
    const lever = svg.querySelector('.lever-arm');
    const steam = svg.querySelector('.steam-burst');
    const needle = svg.querySelector('.needle');

    if (lever) {
      lever.style.transition = 'transform 0.2s ease-out';
      lever.style.transformOrigin = 'center bottom';
      lever.style.transform = 'rotate(20deg)';
      setTimeout(() => { lever.style.transform = ''; }, 300);
    }

    if (steam) {
      steam.style.transition = 'opacity 0.2s';
      steam.style.opacity = '1';
      setTimeout(() => { steam.style.opacity = '0'; }, 500);
    }

    if (needle) {
      needle.style.transition = 'transform 0.2s';
      needle.style.transform = 'rotate(45deg)';
      setTimeout(() => { needle.style.transform = ''; }, 400);
    }
  }

  setDisabled(disabled) {
    this.disabled = disabled;
    this.element.disabled = disabled;
  }

  setType(type) {
    this.type = type;
    const content = this.element.querySelector('.btn-content');
    if (content) {
      content.innerHTML = `
        ${this.getSVGContent()}
        <span class="btn-text">Start Battle</span>
      `;
    }
    this.svgElement = this.element.querySelector('svg');
  }

  destroy() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    if (this.element && this.element.parentNode) {
      this.element.remove();
    }
  }
}
