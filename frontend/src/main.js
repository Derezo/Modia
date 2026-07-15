import { Game } from './core/Game.js';
import { installImageFallbackHandler } from './utils/imageFallback.js';

// Image load failures do not bubble, so install one captured listener before
// the game renders any HTML-string components. Components opt in with
// `data-image-fallback` instead of CSP-blocked inline `onerror` handlers.
installImageFallbackHandler();

// Initialize game when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const game = new Game();
  game.init();

  // Expose for debugging in development
  if (window.location.hostname === 'localhost') {
    window.game = game;
  }
});
