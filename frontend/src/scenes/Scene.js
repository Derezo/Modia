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
}
