import { Scene } from './Scene.js';
import { TitleAnimationEngine } from '../title/TitleAnimationEngine.js';

/**
 * Title screen intro scene.
 * Plays a cinematic animation before transitioning to the login screen.
 */
export class TitleIntroScene extends Scene {
  constructor(game) {
    super(game);

    this.animationEngine = null;
    this.skipRequested = false;
  }

  /**
   * Called when scene becomes active.
   */
  enter(_data = {}) {
    console.log('TitleIntroScene: entering');

    // Create and initialize the animation engine
    this.animationEngine = new TitleAnimationEngine(this.game.canvas);
    this.animationEngine.init();

    this.skipRequested = false;
  }

  /**
   * Called when leaving scene.
   */
  exit() {
    console.log('TitleIntroScene: exiting');
    if (this.animationEngine) {
      this.animationEngine.destroy();
      this.animationEngine = null;
    }
  }

  /**
   * Called every frame.
   * @param {number} deltaTime - Time since last frame in milliseconds
   */
  update(deltaTime) {
    // Check for skip input
    if (this.checkSkipInput()) {
      this.skip();
      return;
    }

    // Clear input state
    this.game.input.clearFrameState();

    // Update animation
    if (this.animationEngine) {
      this.animationEngine.update(deltaTime);

      // Check for completion
      if (this.animationEngine.isComplete()) {
        this.complete();
      }
    }
  }

  /**
   * Called every frame to render to canvas.
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   */
  render(ctx) {
    if (this.animationEngine) {
      this.animationEngine.render(ctx);
    }
  }

  /**
   * Check if user wants to skip the animation.
   * @returns {boolean} True if skip input detected
   */
  checkSkipInput() {
    const input = this.game.input;

    // Check mouse click
    if (input.mouseClicked) {
      return true;
    }

    // Check touch
    if (input.touchTapped) {
      return true;
    }

    // Check keyboard (Space, Enter, Escape)
    if (input.isKeyPressed('Space') ||
        input.isKeyPressed('Enter') ||
        input.isKeyPressed('Escape')) {
      return true;
    }

    return false;
  }

  /**
   * Skip the animation and go directly to login.
   */
  skip() {
    if (this.skipRequested) return;
    this.skipRequested = true;

    console.log('TitleIntroScene: skipping animation');

    // Mark intro as seen
    this.markIntroSeen();

    // Switch to login scene
    this.game.scenes.switchTo('login');
  }

  /**
   * Animation completed naturally.
   */
  complete() {
    if (this.skipRequested) return;
    this.skipRequested = true;

    console.log('TitleIntroScene: animation complete');

    // Mark intro as seen
    this.markIntroSeen();

    // Switch to login scene
    this.game.scenes.switchTo('login');
  }

  /**
   * Mark the intro as seen in localStorage.
   */
  markIntroSeen() {
    try {
      localStorage.setItem('modia_intro_seen', 'true');
    } catch (e) {
      console.warn('Could not save intro seen state:', e);
    }
  }

  /**
   * Handle ESC key press (called by Game.js global handler).
   * @returns {boolean} True if handled (prevents settings modal)
   */
  handleEscape() {
    this.skip();
    return true;
  }

  /**
   * Handle breakpoint changes.
   * Reinitialize animation engine with new canvas size.
   */
  onBreakpointChange(_newBreakpoint, _oldBreakpoint) {
    // Reinitialize with new canvas dimensions
    if (this.animationEngine) {
      this.animationEngine = new TitleAnimationEngine(this.game.canvas);
      this.animationEngine.init();
      // Note: This resets the animation - for a smoother experience,
      // we could preserve state, but the intro is short enough that
      // a restart on resize is acceptable.
    }
  }
}
