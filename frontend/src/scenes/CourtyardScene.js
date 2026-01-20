import { Scene } from './Scene.js';

/**
 * CourtyardScene - DEPRECATED
 *
 * This scene has been consolidated into SocialHubScene.
 * All LFG functionality is now available in the LFG tab of the Social Hub.
 *
 * This stub exists only for backward compatibility - it immediately
 * redirects to the Social Hub with the LFG tab active.
 */
export class CourtyardScene extends Scene {
  constructor(game) {
    super(game);
    this.name = 'courtyard';
  }

  async enter(_data = {}) {
    // Redirect to Social Hub LFG tab
    this.game.scenes.switchTo('socialHub', { tab: 'lfg' });
  }

  update() {
    // No-op: redirect happens in enter()
  }

  render() {
    // No-op: redirect happens in enter()
  }

  exit() {
    // No-op: no resources to clean up
  }
}
