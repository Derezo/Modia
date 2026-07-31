import { Game } from './core/Game.js';
import battleMapV3RuntimeBundles from './generated/battleMapV3RuntimeBundles.json';
import {
  installBattleMapV3RuntimeBundleRegistry
} from './battle/BattleMapAssets.js';
import { installImageFallbackHandler } from './utils/imageFallback.js';

async function bootstrap() {
  // Verify and install the tracked V3 descriptor bundle before Game constructs
  // the API client and emits renderer capabilities. A malformed artifact is a
  // fatal bootstrap error, never a reason to negotiate a lower map version.
  await installBattleMapV3RuntimeBundleRegistry(battleMapV3RuntimeBundles);

  // Image load failures do not bubble, so install one captured listener before
  // the game renders any HTML-string components. Components opt in with
  // `data-image-fallback` instead of CSP-blocked inline `onerror` handlers.
  installImageFallbackHandler();

  const initializeGame = () => {
    const game = new Game();
    game.init();

    // Expose for debugging in development
    if (window.location.hostname === 'localhost') {
      window.game = game;
    }
  };

  // SHA-256 verification may finish before or after DOMContentLoaded.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeGame, { once: true });
  } else {
    initializeGame();
  }
}

bootstrap();
