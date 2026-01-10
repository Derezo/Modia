/**
 * FormationTheme - Base class for battle formation scene themes
 *
 * Each theme defines the visual appearance and ambient effects for a specific
 * battle context (standard nodes, coliseum, guild advancement, etc.)
 */
export class FormationTheme {
  constructor(scene) {
    this.scene = scene;
    this.animationFrame = 0;
    this.particles = [];
    this.tension = 0; // 0-1 based on placed characters
  }

  /**
   * Theme configuration - override in subclasses
   */
  static get config() {
    return {
      name: 'base',

      // Background layers
      background: {
        gradient: ['#1a1a2e', '#16213e'],
        gradientAngle: 135
      },

      // Grid appearance
      grid: {
        tileColor: '#252535',
        tileColorOccupied: '#2a4a2a',
        tileColorHover: '#3a4a5a',
        tileBorder: '#3a3a5a',
        tileBorderOccupied: '#4caf50',
        tileBorderHover: '#6ab0f3',
        highlightPulse: true,
        highlightColor: 'rgba(255, 215, 0, 0.4)'
      },

      // UI chrome styling
      chrome: {
        borderColor: '#4a4a6a',
        backgroundColor: 'rgba(0,0,0,0.4)',
        accentColor: '#ffd700'
      },

      // Ambient effects
      ambient: {
        particles: [],
        lightFlicker: false,
        lightIntensity: 1.0
      },

      // Start button variant
      button: {
        type: 'swords', // swords, fist, spellbook, axe, palm, lever
        primaryColor: '#4a90d9',
        secondaryColor: '#357abd'
      }
    };
  }

  /**
   * Initialize theme - called when scene enters
   */
  init() {
    this.particles = [];
    this.animationFrame = 0;
    this.tension = 0;
  }

  /**
   * Clean up theme resources
   */
  destroy() {
    this.particles = [];
  }

  /**
   * Update tension level based on placed characters
   * @param {number} placedCount - Number of placed characters
   * @param {number} maxCount - Maximum characters (usually 5)
   */
  updateTension(placedCount, maxCount) {
    this.tension = Math.min(1, placedCount / Math.max(1, maxCount));
  }

  /**
   * Get vignette intensity based on tension
   * @returns {number} Vignette intensity 0-0.15
   */
  getVignetteIntensity() {
    // 0 chars = 0%, 1-2 = 5%, 3 = 10%, 4+ = 15%
    if (this.tension === 0) return 0;
    if (this.tension <= 0.4) return 0.05;
    if (this.tension <= 0.6) return 0.10;
    return 0.15;
  }

  /**
   * Get particle multiplier based on tension
   * @returns {number} Multiplier for particle count
   */
  getParticleMultiplier() {
    // 0 = 1.0x, 1-2 = 1.25x, 3 = 1.35x, 4+ = 1.5x
    if (this.tension === 0) return 1.0;
    if (this.tension <= 0.4) return 1.25;
    if (this.tension <= 0.6) return 1.35;
    return 1.5;
  }

  /**
   * Update animation frame - called each frame
   * @param {number} deltaTime - Time since last frame in ms
   */
  update(deltaTime) {
    this.animationFrame += deltaTime;
    this.updateParticles(deltaTime);
  }

  /**
   * Update particle positions
   * @param {number} deltaTime
   */
  updateParticles(deltaTime) {
    const dt = deltaTime / 1000;

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;

      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  /**
   * Spawn particles based on theme
   * Override in subclasses for specific particle effects
   */
  spawnParticles() {
    // Base implementation does nothing
  }

  /**
   * Render background layers
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} width
   * @param {number} height
   */
  renderBackground(ctx, width, height) {
    const config = this.constructor.config;
    const bg = config.background;

    // Gradient background
    const gradient = ctx.createLinearGradient(
      0, 0,
      Math.cos(bg.gradientAngle * Math.PI / 180) * width,
      Math.sin(bg.gradientAngle * Math.PI / 180) * height
    );
    gradient.addColorStop(0, bg.gradient[0]);
    gradient.addColorStop(1, bg.gradient[1]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  /**
   * Render vignette overlay based on tension
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} width
   * @param {number} height
   */
  renderVignette(ctx, width, height) {
    const intensity = this.getVignetteIntensity();
    if (intensity === 0) return;

    const gradient = ctx.createRadialGradient(
      width / 2, height / 2, 0,
      width / 2, height / 2, Math.max(width, height) * 0.7
    );
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, `rgba(0,0,0,${intensity})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  /**
   * Render ambient particles
   * @param {CanvasRenderingContext2D} ctx
   */
  renderParticles(ctx) {
    for (const p of this.particles) {
      const alpha = Math.min(1, p.life / p.maxLife);
      ctx.globalAlpha = alpha * p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Get tile color for grid rendering
   * @param {boolean} isOccupied
   * @param {boolean} isHovered
   * @param {boolean} isPressed
   * @returns {string} CSS color
   */
  getTileColor(isOccupied, isHovered, isPressed) {
    const grid = this.constructor.config.grid;

    if (isPressed) return '#8b0000';
    if (isOccupied) return grid.tileColorOccupied;
    if (isHovered) return grid.tileColorHover;
    return grid.tileColor;
  }

  /**
   * Get tile border color
   * @param {boolean} isOccupied
   * @param {boolean} isHovered
   * @returns {string} CSS color
   */
  getTileBorderColor(isOccupied, isHovered) {
    const grid = this.constructor.config.grid;

    if (isOccupied) return grid.tileBorderOccupied;
    if (isHovered) return grid.tileBorderHover;
    return grid.tileBorder;
  }

  /**
   * Get highlight pulse value for empty placement slots
   * @returns {number} Opacity value 0.3-0.6
   */
  getHighlightPulse() {
    const grid = this.constructor.config.grid;
    if (!grid.highlightPulse) return 0.4;

    // 2-second pulse cycle
    const cycle = (this.animationFrame % 2000) / 2000;
    return 0.3 + Math.sin(cycle * Math.PI * 2) * 0.15;
  }

  /**
   * Create container styles for the scene
   * @returns {string} CSS text
   */
  getContainerStyles() {
    const config = this.constructor.config;
    const bg = config.background;

    return `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(${bg.gradientAngle}deg, ${bg.gradient[0]} 0%, ${bg.gradient[1]} 100%);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    `;
  }

  /**
   * Get header styles
   * @returns {string} CSS text
   */
  getHeaderStyles() {
    const chrome = this.constructor.config.chrome;
    return `
      padding: 12px 16px;
      background: ${chrome.backgroundColor};
      border-bottom: 2px solid ${chrome.borderColor};
      display: flex;
      align-items: center;
      gap: 12px;
    `;
  }

  /**
   * Get title for the scene
   * @returns {string}
   */
  getTitle() {
    return 'Prepare for Battle!';
  }

  /**
   * Get button configuration
   * @returns {object}
   */
  getButtonConfig() {
    return this.constructor.config.button;
  }
}
