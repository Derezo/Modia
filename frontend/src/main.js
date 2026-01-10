import { Game } from './core/Game.js';

// Initialize game when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const game = new Game();
  game.init();

  // Expose for debugging in development
  if (window.location.hostname === 'localhost') {
    window.game = game;
  }
});
