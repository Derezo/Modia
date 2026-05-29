import { responsive } from '../core/Responsive.js';

export class Scene {
  constructor(game) {
    this.game = game;
  }

  // Called when scene becomes active
  enter(_data = {}) {}

  // Called when leaving scene
  exit() {}

  // Called every frame
  update(_deltaTime) {}

  // Called every frame to render to canvas
  render(_ctx) {}

  // Called when viewport breakpoint changes (mobile/tablet/desktop)
  // Override in subclasses to rebuild UI for new breakpoint
  onBreakpointChange(_newBreakpoint, _oldBreakpoint) {}

  // Called when canvas/viewport size changes
  // Override in subclasses to update camera bounds, zoom, etc.
  onResize() {}

  // Helper to get responsive utility reference
  get responsive() {
    return responsive;
  }
}
