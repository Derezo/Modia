import { responsive } from '../core/Responsive.js';

export class Scene {
  constructor(game) {
    this.game = game;
  }

  // Called when scene becomes active
  enter(data = {}) {}

  // Called when leaving scene
  exit() {}

  // Called every frame
  update(deltaTime) {}

  // Called every frame to render to canvas
  render(ctx) {}

  // Called when viewport breakpoint changes (mobile/tablet/desktop)
  // Override in subclasses to rebuild UI for new breakpoint
  onBreakpointChange(newBreakpoint, oldBreakpoint) {}

  // Helper to get responsive utility reference
  get responsive() {
    return responsive;
  }
}
