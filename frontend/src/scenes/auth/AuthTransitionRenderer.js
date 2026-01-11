import { AuthParticleSystem } from './AuthParticleSystem.js';

/**
 * Handles the cinematic transition from light burst to auth scene.
 * Phases: white_hold → gradient_reveal → title_appear → complete
 */
export class AuthTransitionRenderer {
  constructor(width, height) {
    this.width = width;
    this.height = height;

    // Phase management
    this.phase = 'white_hold';
    this.phaseTimer = 0;

    // Phase durations (in ms)
    this.PHASES = {
      white_hold: 300,
      gradient_reveal: 500,
      title_appear: 400,
      complete: Infinity
    };

    // Transition progress (0-1)
    this.gradientProgress = 0;
    this.titleAlpha = 0;

    // Particle system (starts after gradient begins)
    this.particles = new AuthParticleSystem(width, height, 20);
    this.particlesStarted = false;

    // Final gradient colors
    this.colors = {
      center: { r: 26, g: 26, b: 46 },      // #1a1a2e - midnight blue
      mid: { r: 22, g: 33, b: 62 },         // #16213e - deep purple-blue
      edge: { r: 10, g: 10, b: 20 }         // #0a0a14 - near black
    };

    // Title font loaded flag
    this.fontReady = false;
  }

  /**
   * Signal that the font has been loaded.
   */
  setFontReady() {
    this.fontReady = true;
  }

  /**
   * Update transition state.
   * @param {number} deltaTime - Time in milliseconds
   */
  update(deltaTime) {
    this.phaseTimer += deltaTime;

    // Process current phase
    switch (this.phase) {
      case 'white_hold':
        if (this.phaseTimer >= this.PHASES.white_hold) {
          this.advancePhase();
        }
        break;

      case 'gradient_reveal':
        // Animate gradient from white to final colors
        this.gradientProgress = Math.min(1, this.phaseTimer / this.PHASES.gradient_reveal);
        // Use easeOutQuad for smooth deceleration
        this.gradientProgress = this.easeOutQuad(this.gradientProgress);

        // Start particles partway through gradient reveal
        if (!this.particlesStarted && this.phaseTimer > 200) {
          this.particlesStarted = true;
        }

        if (this.phaseTimer >= this.PHASES.gradient_reveal) {
          this.gradientProgress = 1;
          this.advancePhase();
        }
        break;

      case 'title_appear':
        // Fade in the title
        this.titleAlpha = Math.min(1, this.phaseTimer / this.PHASES.title_appear);
        // Use easeOutQuad for smooth appearance
        this.titleAlpha = this.easeOutQuad(this.titleAlpha);

        if (this.phaseTimer >= this.PHASES.title_appear) {
          this.titleAlpha = 1;
          this.advancePhase();
        }
        break;

      case 'complete':
        // Just keep particles alive
        break;
    }

    // Update particles if started
    if (this.particlesStarted) {
      this.particles.update(deltaTime);
    }
  }

  /**
   * Advance to the next phase.
   */
  advancePhase() {
    const phases = ['white_hold', 'gradient_reveal', 'title_appear', 'complete'];
    const currentIndex = phases.indexOf(this.phase);
    if (currentIndex < phases.length - 1) {
      this.phase = phases[currentIndex + 1];
      this.phaseTimer = 0;
    }
  }

  /**
   * Check if the transition is ready to show the modal.
   * Modal should appear after title starts to appear.
   */
  isReadyForModal() {
    return this.phase === 'title_appear' && this.phaseTimer > 200 ||
           this.phase === 'complete';
  }

  /**
   * Render the transition.
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    // Render gradient background
    this.renderBackground(ctx);

    // Render particles
    if (this.particlesStarted) {
      this.particles.render(ctx);
    }

    // Render title
    if (this.titleAlpha > 0 && this.fontReady) {
      this.renderTitle(ctx);
    }
  }

  /**
   * Render the animated gradient background.
   */
  renderBackground(ctx) {
    const centerX = this.width / 2;
    const centerY = this.height / 2;
    const radius = Math.max(this.width, this.height) * 0.8;

    // Create radial gradient
    const gradient = ctx.createRadialGradient(
      centerX, centerY * 0.7, 0,  // Offset center slightly up
      centerX, centerY, radius
    );

    // Interpolate from white to final colors based on progress
    const p = this.gradientProgress;

    // Center color (white → midnight blue)
    const centerColor = this.interpolateColor(
      { r: 255, g: 255, b: 255 },
      this.colors.center,
      p
    );

    // Mid color (white → deep purple-blue)
    const midColor = this.interpolateColor(
      { r: 255, g: 255, b: 255 },
      this.colors.mid,
      p
    );

    // Edge color (white → near black)
    const edgeColor = this.interpolateColor(
      { r: 250, g: 250, b: 255 },
      this.colors.edge,
      p
    );

    gradient.addColorStop(0, `rgb(${centerColor.r}, ${centerColor.g}, ${centerColor.b})`);
    gradient.addColorStop(0.5, `rgb(${midColor.r}, ${midColor.g}, ${midColor.b})`);
    gradient.addColorStop(1, `rgb(${edgeColor.r}, ${edgeColor.g}, ${edgeColor.b})`);

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);

    // Add subtle noise/grain texture when gradient is visible
    if (p > 0.3) {
      this.renderNoiseTexture(ctx, (p - 0.3) / 0.7 * 0.03);
    }
  }

  /**
   * Render subtle noise texture overlay.
   */
  renderNoiseTexture(ctx, intensity) {
    if (intensity <= 0) return;

    ctx.save();
    ctx.globalAlpha = intensity;

    // Simple pseudo-noise using rectangles (cheaper than imageData)
    const cellSize = 4;
    for (let x = 0; x < this.width; x += cellSize * 3) {
      for (let y = 0; y < this.height; y += cellSize * 3) {
        // Deterministic pseudo-random based on position
        const noise = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        const val = (noise - Math.floor(noise)) > 0.5 ? 255 : 0;
        ctx.fillStyle = `rgba(${val}, ${val}, ${val}, 0.5)`;
        ctx.fillRect(x, y, cellSize, cellSize);
      }
    }

    ctx.restore();
  }

  /**
   * Render the MODIA title with emboss effect.
   */
  renderTitle(ctx) {
    ctx.save();
    ctx.globalAlpha = this.titleAlpha;

    const x = this.width / 2;
    const y = this.height * 0.15;

    // Scale font based on canvas size
    const baseFontSize = Math.min(this.width, this.height) * 0.08;
    const fontSize = Math.max(36, Math.min(72, baseFontSize));

    ctx.font = `bold ${fontSize}px "Cinzel Decorative", Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Multi-layer emboss effect

    // Deep shadow (furthest)
    ctx.fillStyle = '#1a0a05';
    ctx.fillText('MODIA', x + 3, y + 4);

    // Mid shadow
    ctx.fillStyle = '#3a2a1a';
    ctx.fillText('MODIA', x + 2, y + 3);

    // Light shadow
    ctx.fillStyle = '#5a4a3a';
    ctx.fillText('MODIA', x + 1, y + 2);

    // Main text with golden gradient
    const textGradient = ctx.createLinearGradient(
      x - fontSize * 2, y - fontSize * 0.4,
      x + fontSize * 2, y + fontSize * 0.4
    );
    textGradient.addColorStop(0, '#c9b899');
    textGradient.addColorStop(0.3, '#e8dcc8');
    textGradient.addColorStop(0.5, '#f5efe5');
    textGradient.addColorStop(0.7, '#e8dcc8');
    textGradient.addColorStop(1, '#c9b899');

    ctx.fillStyle = textGradient;
    ctx.fillText('MODIA', x, y);

    // Subtle highlight on top edge
    ctx.globalAlpha = this.titleAlpha * 0.3;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('MODIA', x - 0.5, y - 0.5);

    ctx.restore();
  }

  /**
   * Interpolate between two colors.
   */
  interpolateColor(from, to, progress) {
    return {
      r: Math.round(from.r + (to.r - from.r) * progress),
      g: Math.round(from.g + (to.g - from.g) * progress),
      b: Math.round(from.b + (to.b - from.b) * progress)
    };
  }

  /**
   * Ease out quadratic.
   */
  easeOutQuad(t) {
    return t * (2 - t);
  }

  /**
   * Handle resize.
   */
  resize(width, height) {
    this.width = width;
    this.height = height;
    this.particles.resize(width, height);
  }

  /**
   * Get current phase.
   */
  getPhase() {
    return this.phase;
  }
}
