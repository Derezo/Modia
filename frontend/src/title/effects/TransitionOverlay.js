import { TITLE_COLORS } from '../TitleColors.js';

/**
 * Handles the transition from the title animation to the login screen.
 * Manages fade overlays and cross-dissolve effects.
 */
export class TransitionOverlay {
  constructor(targetWidth = 800, targetHeight = 600) {
    this.targetWidth = targetWidth;
    this.targetHeight = targetHeight;
    this.phase = 'inactive'; // 'inactive' | 'fading' | 'complete'
    this.timer = 0;
    this.duration = 1200; // 1.2 second transition

    // Overlay states
    this.blackAlpha = 1; // For initial fade-in (starts black)
    this.whiteAlpha = 0; // For light burst fade
    this.parchmentRevealed = 0; // How much parchment shows through
  }

  /**
   * Start the initial fade-in from black.
   */
  startFadeIn() {
    this.phase = 'fade_in';
    this.timer = 0;
    this.blackAlpha = 1;
  }

  /**
   * Start the fade to login (from light burst).
   */
  startFadeToLogin() {
    this.phase = 'fading';
    this.timer = 0;
    this.whiteAlpha = 0.9; // Start bright from light burst
  }

  update(deltaTime) {
    if (this.phase === 'inactive') return;

    const _dt = deltaTime / 1000;
    this.timer += deltaTime;

    if (this.phase === 'fade_in') {
      // Fade from black to scene
      const progress = Math.min(1, this.timer / 800);
      this.blackAlpha = 1 - this.easeOutCubic(progress);

      if (progress >= 1) {
        this.phase = 'inactive';
        this.blackAlpha = 0;
      }
    } else if (this.phase === 'fading') {
      const progress = Math.min(1, this.timer / this.duration);
      const eased = this.easeInOutCubic(progress);

      // White overlay fades out
      this.whiteAlpha = Math.max(0, 0.9 * (1 - progress));

      // Parchment background reveals
      this.parchmentRevealed = eased;

      if (progress >= 1) {
        this.phase = 'complete';
        this.whiteAlpha = 0;
        this.parchmentRevealed = 1;
      }
    }
  }

  /**
   * Render the parchment background gradient.
   */
  renderParchmentBackground(ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 0, this.targetHeight);
    gradient.addColorStop(0, TITLE_COLORS.parchment.light);
    gradient.addColorStop(0.5, TITLE_COLORS.parchment.mid);
    gradient.addColorStop(1, TITLE_COLORS.parchment.dark);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.targetWidth, this.targetHeight);
  }

  render(ctx) {
    ctx.save();

    // Render parchment if revealing
    if (this.parchmentRevealed > 0 && this.phase === 'fading') {
      ctx.globalAlpha = this.parchmentRevealed;
      this.renderParchmentBackground(ctx);
    }

    // White overlay (from light burst)
    if (this.whiteAlpha > 0) {
      ctx.globalAlpha = this.whiteAlpha;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, this.targetWidth, this.targetHeight);
    }

    // Black overlay (for fade-in)
    if (this.blackAlpha > 0) {
      ctx.globalAlpha = this.blackAlpha;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, this.targetWidth, this.targetHeight);
    }

    ctx.restore();
  }

  /**
   * Check if transition is complete.
   */
  isComplete() {
    return this.phase === 'complete';
  }

  /**
   * Check if currently in fade-in phase.
   */
  isFadingIn() {
    return this.phase === 'fade_in';
  }

  /**
   * Check if currently transitioning to login.
   */
  isFadingToLogin() {
    return this.phase === 'fading';
  }

  /**
   * Get the parchment reveal progress (0-1).
   */
  getRevealProgress() {
    return this.parchmentRevealed;
  }

  easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
}
