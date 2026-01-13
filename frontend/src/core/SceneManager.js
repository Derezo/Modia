import { TitleIntroScene } from '../scenes/TitleIntroScene.js';
import { AuthScene } from '../scenes/AuthScene.js';
import { CharacterSelectScene } from '../scenes/CharacterSelectScene.js';
import { CharacterCreateScene } from '../scenes/CharacterCreateScene.js';
import { WorldMapScene } from '../scenes/WorldMapScene.js';
import { BattleScene } from '../scenes/BattleScene.js';
import { BattleFormationScene } from '../scenes/BattleFormationScene.js';
import { FormationScene } from '../scenes/FormationScene.js';
import { InventoryScene } from '../scenes/InventoryScene.js';
import { ShopScene } from '../scenes/ShopScene.js';
import { MarketplaceScene } from '../scenes/MarketplaceScene.js';
import { TavernScene } from '../scenes/TavernScene.js';
import { ColiseumScene } from '../scenes/ColiseumScene.js';
import { RecruitmentScene } from '../scenes/RecruitmentScene.js';
import { CourtyardScene } from '../scenes/CourtyardScene.js';
import { SocialHubScene } from '../scenes/SocialHubScene.js';
import { LeaderboardScene } from '../scenes/LeaderboardScene.js';
import { SettingsScene } from '../scenes/SettingsScene.js';
import { GuildAdvancementScene } from '../scenes/GuildAdvancementScene.js';

export class SceneManager {
  constructor(game) {
    this.game = game;
    this.currentScene = null;
    this.scenes = {};

    this.registerScenes();
  }

  registerScenes() {
    // Single AuthScene handles both login and register modes
    const authScene = new AuthScene(this.game);

    this.scenes = {
      titleIntro: new TitleIntroScene(this.game),
      login: authScene,
      register: authScene,
      characterSelect: new CharacterSelectScene(this.game),
      characterCreate: new CharacterCreateScene(this.game),
      worldMap: new WorldMapScene(this.game),
      battle: new BattleScene(this.game),
      battleFormation: new BattleFormationScene(this.game),
      formation: new FormationScene(this.game),
      inventory: new InventoryScene(this.game),
      shop: new ShopScene(this.game),
      marketplace: new MarketplaceScene(this.game),
      tavern: new TavernScene(this.game),
      coliseum: new ColiseumScene(this.game),
      recruitment: new RecruitmentScene(this.game),
      courtyard: new CourtyardScene(this.game),
      socialHub: new SocialHubScene(this.game),
      leaderboard: new LeaderboardScene(this.game),
      settings: new SettingsScene(this.game),
      guildAdvancement: new GuildAdvancementScene(this.game)
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

    // Enter new scene with mode for auth scenes
    this.currentScene = this.scenes[sceneName];

    // Pass mode for login/register scenes
    if (sceneName === 'login' || sceneName === 'register') {
      data = { ...data, mode: sceneName };
    }

    this.currentScene.enter(data);

    // Update state
    this.game.state.set('currentScene', sceneName);

    // Update notification visibility based on scene
    this.game.updateNotificationVisibility(sceneName);

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

  /**
   * Get the currently active scene
   * @returns {Object|null} The current scene instance
   */
  getCurrentScene() {
    return this.currentScene;
  }
}
