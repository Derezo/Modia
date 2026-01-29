/**
 * MusicContext - Tracks game state for region-aware music playback
 *
 * Manages current region, node type, and battle type to automatically
 * select the correct music track from the regional music library.
 *
 * Usage:
 *   // Set region when player enters a new area
 *   game.musicContext.setRegion('heartlands');
 *
 *   // Play exploration music for current region
 *   game.musicContext.playExplorationMusic();
 *
 *   // Play node-specific music
 *   game.musicContext.playNodeMusic('tavern');
 *
 *   // Play battle music (stores previous state for resume)
 *   game.musicContext.playBattleMusic('regular');
 *
 *   // After battle, resume previous music
 *   game.musicContext.resumeAfterBattle();
 */

import { debugLog } from '../utils/debugLogger.js';

export class MusicContext {
  constructor(audioManager) {
    this.audio = audioManager;

    // Current game context
    this.currentRegion = null;      // 'heartlands', 'sylvan_reaches', etc.
    this.currentNodeType = null;    // 'exploration', 'tavern', 'shop', etc.
    this.currentBattleType = null;  // 'regular', 'boss', 'pvp', 'story'
    this.isInBattle = false;

    // For resuming music after battle
    this.previousTrack = null;
  }

  /**
   * Set the current region
   * Called when player enters a new region on the world map
   * @param {string} regionId - Region identifier (e.g., 'heartlands', 'sylvan_reaches')
   */
  setRegion(regionId) {
    debugLog('audio.logRegionInfo', 'Region set:', regionId);
    this.currentRegion = regionId;
  }

  /**
   * Get the current region
   * @returns {string|null} Current region identifier
   */
  getRegion() {
    return this.currentRegion;
  }

  /**
   * Play exploration music for the current region
   * Uses track ID format: {region}_exploration
   */
  playExplorationMusic() {
    if (!this.currentRegion) {
      console.warn('MusicContext: No region set, cannot play exploration music');
      return;
    }

    this.currentNodeType = 'exploration';
    this.isInBattle = false;
    this.currentBattleType = null;

    const trackId = `${this.currentRegion}_exploration`;
    debugLog('audio.logRegionInfo', 'Building key:', trackId, { region: this.currentRegion, type: 'exploration' });
    this.audio.playMusic(trackId);
  }

  /**
   * Play node-specific music for the current region
   * Uses track ID format: {region}_{nodeType}
   * @param {string} nodeType - Node type (e.g., 'tavern', 'shop', 'fishing', 'ruins')
   */
  playNodeMusic(nodeType) {
    if (!this.currentRegion) {
      console.warn('MusicContext: No region set, cannot play node music');
      return;
    }

    this.currentNodeType = nodeType;
    this.isInBattle = false;
    this.currentBattleType = null;

    const trackId = `${this.currentRegion}_${nodeType}`;
    debugLog('audio.logRegionInfo', 'Building key:', trackId, { region: this.currentRegion, type: nodeType });
    this.audio.playMusic(trackId);
  }

  /**
   * Play battle music for the current region
   * Stores the previous track state for resuming after battle
   * Uses track ID format: {region}_battle_{battleType}
   * @param {string} battleType - Battle type ('regular', 'boss', 'pvp', 'story')
   */
  playBattleMusic(battleType = 'regular') {
    if (!this.currentRegion) {
      console.warn('MusicContext: No region set, cannot play battle music');
      return;
    }

    // Store previous state for resuming after battle
    this.previousTrack = {
      region: this.currentRegion,
      nodeType: this.currentNodeType
    };

    this.currentBattleType = battleType;
    this.isInBattle = true;

    const trackId = `${this.currentRegion}_battle_${battleType}`;
    debugLog('audio.logRegionInfo', 'Building key:', trackId, { region: this.currentRegion, type: `battle_${battleType}` });
    this.audio.playMusic(trackId);
  }

  /**
   * Play victory fanfare (non-looping)
   * Called after winning a battle
   */
  playVictory() {
    this.audio.playMusic('victory_fanfare');
  }

  /**
   * Play defeat jingle (non-looping)
   * Called after losing a battle
   */
  playDefeat() {
    this.audio.playMusic('defeat_jingle');
  }

  /**
   * Resume the previous music after a battle ends
   * Restores exploration or node music based on stored state
   */
  resumeAfterBattle() {
    this.isInBattle = false;
    this.currentBattleType = null;

    if (this.previousTrack) {
      const { nodeType } = this.previousTrack;

      if (nodeType === 'exploration') {
        this.playExplorationMusic();
      } else if (nodeType) {
        this.playNodeMusic(nodeType);
      }

      this.previousTrack = null;
    }
  }

  /**
   * Play title screen theme
   * Used on the login/register/title intro screens
   */
  playTitleTheme() {
    this.currentRegion = null;
    this.currentNodeType = null;
    this.isInBattle = false;
    this.currentBattleType = null;
    this.audio.playMusic('title_theme');
  }

  /**
   * Play character creation screen theme
   */
  playCharacterCreate() {
    this.currentNodeType = null;
    this.isInBattle = false;
    this.currentBattleType = null;
    this.audio.playMusic('character_create');
  }

  /**
   * Play coliseum/arena theme
   * Used during PvP matches
   */
  playColiseum() {
    this.currentNodeType = 'coliseum';
    this.isInBattle = false;
    this.currentBattleType = null;
    this.audio.playMusic('coliseum_theme');
  }

  /**
   * Alias for playColiseum() - for consistency with scene naming
   */
  playColiseumTheme() {
    this.playColiseum();
  }

  /**
   * Play social hub theme
   * Used in guild halls, social areas
   */
  playSocialHub() {
    this.currentNodeType = 'social';
    this.isInBattle = false;
    this.currentBattleType = null;
    this.audio.playMusic('social_hub_theme');
  }

  /**
   * Alias for playSocialHub() - for consistency with scene naming
   */
  playSocialHubTheme() {
    this.playSocialHub();
  }

  /**
   * Play guild advancement theme
   * Used in guild halls and advancement quests
   */
  playGuildAdvancement() {
    this.currentNodeType = 'guild';
    this.isInBattle = false;
    this.currentBattleType = null;
    this.audio.playMusic('guild_advancement');
  }

  /**
   * Alias for playGuildAdvancement() - for consistency with scene naming
   */
  playGuildAdvancementTheme() {
    this.playGuildAdvancement();
  }

  /**
   * Stop all music
   * @param {boolean} fadeOut - Whether to fade out (default: true)
   */
  stopMusic(fadeOut = true) {
    this.audio.stopMusic(fadeOut);
    this.isInBattle = false;
    this.currentBattleType = null;
    this.previousTrack = null;
  }

  /**
   * Get current music context state for debugging
   * @returns {Object} Current state including region, node type, and battle info
   */
  getState() {
    return {
      region: this.currentRegion,
      nodeType: this.currentNodeType,
      battleType: this.currentBattleType,
      isInBattle: this.isInBattle,
      previousTrack: this.previousTrack
    };
  }

  /**
   * Reset all context state
   * Called when player logs out or returns to title
   */
  reset() {
    this.currentRegion = null;
    this.currentNodeType = null;
    this.currentBattleType = null;
    this.isInBattle = false;
    this.previousTrack = null;
  }
}

export default MusicContext;
