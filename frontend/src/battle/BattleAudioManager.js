/**
 * @module BattleAudioManager
 * @description Manages all audio playback during battle scenes.
 *
 * Key responsibilities:
 * - Battle music selection based on region and battle type
 * - Sound effect playback for skills, impacts, and status effects
 * - Turn start audio cues
 * - Victory/defeat fanfares
 * - Music transitions on battle end
 *
 * Uses delegate pattern - receives scene reference for state/component access.
 *
 * @see BattleScene.js - Main battle orchestration
 * @see AudioAssets.js - Audio manifest and helper functions
 * @see MusicContext.js - Region-aware music management
 */

import { getSkillSoundKey, RACE_TO_REGION } from '../audio/AudioAssets.js';

export class BattleAudioManager {
  /**
   * @param {BattleScene} scene - Reference to the battle scene
   */
  constructor(scene) {
    this.scene = scene;
  }

  // ===========================================================================
  // GETTERS - Access scene properties
  // ===========================================================================

  get game() { return this.scene.game; }
  get isPvP() { return this.scene.isPvP; }
  get battleType() { return this.scene.battleType; }
  get isBossBattle() { return this.scene.isBossBattle; }
  get guildmasterData() { return this.scene.guildmasterData; }

  // ===========================================================================
  // BATTLE MUSIC
  // ===========================================================================

  /**
   * Determine the battle type for music selection
   * @returns {string} Battle type: 'regular', 'boss', 'pvp', or 'story'
   */
  getBattleType() {
    if (this.isPvP || this.battleType === 'pvp') return 'pvp';
    if (this.isBossBattle || this.guildmasterData) return 'boss';
    // Could add story battle detection here if implemented
    return 'regular';
  }

  /**
   * Get the current region for music selection
   * @returns {string} Region ID (e.g., 'heartlands', 'sylvan_reaches')
   */
  getCurrentRegion() {
    // Try to get region from current node in game state
    // API returns region_race ('Human', 'Elf', etc.), map to region name ('heartlands', etc.)
    const currentNode = this.game.state.get('currentNode');
    if (currentNode?.region_race) {
      const regionName = RACE_TO_REGION[currentNode.region_race];
      if (regionName) {
        return regionName;
      }
    }
    // Fallback to musicContext's current region if available
    if (this.game.musicContext?.getRegion()) {
      return this.game.musicContext.getRegion();
    }
    // Default fallback
    return 'heartlands';
  }

  /**
   * Play battle music based on battle type and current region
   * Uses MusicContext for region-aware playback
   */
  playBattleMusic() {
    if (this.game.musicContext) {
      // Ensure region is set for music context
      const region = this.getCurrentRegion();
      if (!this.game.musicContext.getRegion()) {
        this.game.musicContext.setRegion(region);
      }
      // Play region-appropriate battle music
      const battleType = this.getBattleType();
      this.game.musicContext.playBattleMusic(battleType);
    } else if (this.game.audio) {
      // Fallback to generic battle music
      this.game.audio.playMusic('battle_combat');
    }
  }

  /**
   * Play victory or defeat fanfare
   * @param {string} status - 'victory' or 'defeat'
   */
  playBattleEndMusic(status) {
    if (this.game.musicContext) {
      if (status === 'victory') {
        this.game.musicContext.playVictory();
      } else {
        this.game.musicContext.playDefeat();
      }
    } else if (this.game.audio) {
      // Fallback to direct audio playback
      const track = status === 'victory' ? 'victory_fanfare' : 'defeat_jingle';
      this.game.audio.playMusic(track, { crossfade: false });
    }
  }

  /**
   * Resume previous music after battle ends
   * Should be called after victory/defeat fanfare completes
   */
  resumeAfterBattle() {
    if (this.game.musicContext) {
      this.game.musicContext.resumeAfterBattle();
    }
  }

  // ===========================================================================
  // SOUND EFFECTS
  // ===========================================================================

  /**
   * Play sound effect using game audio system
   * @param {string} soundId - Sound effect identifier
   * @param {Object} options - Playback options (volume, pitch, etc.)
   */
  playSound(soundId, options = {}) {
    if (!this.game.audio) {
      console.debug(`[BattleAudio] ${soundId} (audio not initialized)`);
      return;
    }
    this.game.audio.playCombat(soundId, options);
  }

  /**
   * Play sound for a skill execution
   * Tries specific skill sound first, falls back to visual category
   * @param {Object} skill - The skill being used
   * @param {Object} attacker - The unit using the skill
   */
  playSkillSound(skill, attacker) {
    if (!this.game.audio) return;

    const isMonster = attacker?.type === 'enemy';
    const skillId = skill.id || skill.skillId;

    // Get the skill sound key using AudioAssets helper
    const soundKey = getSkillSoundKey(skillId, isMonster);

    // Try to play the specific skill sound
    // The audio system will handle fallback if the sound doesn't exist
    this.game.audio.playCombat(soundKey);

    // Log for debugging
    console.debug(`[BattleAudio] Playing skill sound: ${soundKey}`);
  }

  /**
   * Play sound for a status effect being applied
   * @param {string} effectType - The status effect type (burn, freeze, poison, etc.)
   */
  playStatusEffectSound(effectType) {
    if (!this.game.audio || !effectType) return;

    // Map effect types to sound keys
    const soundKey = `status_${effectType.toLowerCase()}`;
    this.game.audio.playCombat(soundKey);
  }

  /**
   * Play combat impact sound based on attack result
   * @param {Object} result - The attack result containing damage, isCritical, missed
   */
  playImpactSound(result) {
    if (!this.game.audio) return;

    if (result.missed) {
      this.game.audio.playCombat('impact_miss');
    } else if (result.isCritical) {
      this.game.audio.playCombat('impact_critical');
    } else if (result.blocked) {
      this.game.audio.playCombat('impact_block');
    } else if (result.damage > 0) {
      this.game.audio.playCombat('impact_hit');
    }
  }

  /**
   * Play sound when a unit's turn starts
   * @param {Object} unit - The unit whose turn is starting
   */
  playTurnStartSound(unit) {
    if (!this.game.audio) return;

    // Play sound for local player's units
    // In PvP, only play for units the local player controls
    const localUserId = this.game.localUserId;
    const isLocalUnit = this.isPvP
      ? unit.isLocalPlayerUnit(localUserId)
      : (unit.type === 'player' || unit.type === 'player_local');

    if (isLocalUnit) {
      this.game.audio.playSFX('turn_start');
    }
    // Note: We don't play enemy/opponent turn sounds to avoid audio clutter
  }
}
