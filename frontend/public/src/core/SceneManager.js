import { LoginScene } from '../scenes/LoginScene.js';
import { RegisterScene } from '../scenes/RegisterScene.js';
import { CharacterSelectScene } from '../scenes/CharacterSelectScene.js';
import { CharacterCreateScene } from '../scenes/CharacterCreateScene.js';
import { WorldMapScene } from '../scenes/WorldMapScene.js';
import { BattleScene } from '../scenes/BattleScene.js';
import { FormationScene } from '../scenes/FormationScene.js';
import { InventoryScene } from '../scenes/InventoryScene.js';
import { ShopScene } from '../scenes/ShopScene.js';
import { MarketplaceScene } from '../scenes/MarketplaceScene.js';
import { TavernScene } from '../scenes/TavernScene.js';
import { ColiseumScene } from '../scenes/ColiseumScene.js';

export class SceneManager {
  constructor(game) {
    this.game = game;
    this.currentScene = null;
    this.scenes = {};

    this.registerScenes();
  }

  registerScenes() {
    this.scenes = {
      login: new LoginScene(this.game),
      register: new RegisterScene(this.game),
      characterSelect: new CharacterSelectScene(this.game),
      characterCreate: new CharacterCreateScene(this.game),
      worldMap: new WorldMapScene(this.game),
      battle: new BattleScene(this.game),
      formation: new FormationScene(this.game),
      inventory: new InventoryScene(this.game),
      shop: new ShopScene(this.game),
      marketplace: new MarketplaceScene(this.game),
      tavern: new TavernScene(this.game),
      coliseum: new ColiseumScene(this.game)
    };
  }

  // Alias for backwards compatibility
  changeScene(sceneName, data = {}) {
    this.switchTo(sceneName, data);
  }

  switchTo(sceneName, data = {}) {
    if (!this.scenes[sceneName]) {
      console.error(`Scene '${sceneName}' not found`);
      return;
    }

    // Exit current scene
    if (this.currentScene) {
      this.currentScene.exit();
    }

    // Clear UI overlay
    this.game.uiOverlay.innerHTML = '';

    // Enter new scene
    this.currentScene = this.scenes[sceneName];
    this.currentScene.enter(data);

    // Update state
    this.game.state.set('currentScene', sceneName);

    console.log(`Switched to scene: ${sceneName}`);
  }

  update(deltaTime) {
    if (this.currentScene) {
      this.currentScene.update(deltaTime);
    }
  }

  render(ctx) {
    if (this.currentScene) {
      this.currentScene.render(ctx);
    }
  }
}
