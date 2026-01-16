/**
 * AudioAssets - Asset manifest and preloading for game audio
 *
 * Defines all music tracks, sound effects, and UI sounds used in the game.
 * Supports placeholder audio generation via Web Audio API oscillators.
 *
 * Total: 55 music tracks + 244 sound effects = 299 audio assets
 */

// =============================================================================
// CONSTANTS AND HELPERS
// =============================================================================

/** Region IDs for music context */
export const REGIONS = ['heartlands', 'sylvan_reaches', 'iron_depths', 'shadowmere', 'bloodplains'];

/** Node types that have regional music */
export const NODE_TYPES = ['exploration', 'tavern', 'shop', 'fishing', 'ruins'];

/** Battle types with regional variations */
export const BATTLE_TYPES = ['regular', 'boss', 'pvp', 'story'];

/** Player skill guilds */
export const PLAYER_GUILDS = ['warrior', 'wizard', 'monk', 'chemist', 'berserker', 'sorcerer', 'ninja', 'alchemist'];

/** Monster archetypes */
export const MONSTER_ARCHETYPES = ['beast', 'dragon', 'undead', 'elemental', 'humanoid', 'construct', 'demon', 'insect', 'plant'];

/**
 * Helper to get regional music key
 * @param {string} region - Region ID
 * @param {string} type - Node type (exploration, tavern, shop, fishing, ruins)
 * @returns {string} Music key
 */
export function getRegionalMusicKey(region, type) {
  return `${region}_${type}`;
}

/**
 * Helper to get battle music key
 * @param {string} region - Region ID
 * @param {string} battleType - Battle type (regular, boss, pvp, story)
 * @returns {string} Music key
 */
export function getBattleMusicKey(region, battleType) {
  return `${region}_battle_${battleType}`;
}

/**
 * Helper to get skill sound key
 * @param {string} skillId - Skill identifier
 * @param {boolean} isMonster - Whether it's a monster skill
 * @returns {string} SFX key
 */
export function getSkillSoundKey(skillId, isMonster = false) {
  return isMonster ? `monster_${skillId}` : `skill_${skillId}`;
}

/**
 * Helper to get UI sound key
 * @param {string} id - UI sound identifier
 * @returns {string} UI sound key
 */
export function getUiSoundKey(id) {
  return `ui_${id}`;
}

/**
 * Helper to get interaction sound key
 * @param {string} id - Interaction identifier
 * @returns {string} Interaction sound key
 */
export function getInteractionSoundKey(id) {
  return `interaction_${id}`;
}

/**
 * Helper to get ambient sound key
 * @param {string} id - Ambient identifier
 * @returns {string} Ambient sound key
 */
export function getAmbientSoundKey(id) {
  return `ambient_${id}`;
}

// =============================================================================
// AUDIO MANIFEST - 294 total entries
// =============================================================================

// Audio asset definitions organized by category
export const AUDIO_MANIFEST = {
  // ===========================================================================
  // MUSIC - 55 tracks
  // ===========================================================================
  music: {
    // -------------------------------------------------------------------------
    // Core tracks (10)
    // -------------------------------------------------------------------------
    title_theme: {
      path: '/assets/audio/music/core/title_theme.mp3',
      volume: 0.8,
      loop: true,
      fadeIn: 2000,
      fadeOut: 2000,
      category: 'core'
    },
    character_select: {
      path: '/assets/audio/music/core/character_select.mp3',
      volume: 0.7,
      loop: true,
      fadeIn: 1500,
      fadeOut: 1500,
      category: 'core'
    },
    victory_fanfare: {
      path: '/assets/audio/music/core/victory_fanfare.mp3',
      volume: 0.8,
      loop: false,
      fadeIn: 0,
      fadeOut: 500,
      category: 'core'
    },
    defeat_jingle: {
      path: '/assets/audio/music/core/defeat_jingle.mp3',
      volume: 0.75,
      loop: false,
      fadeIn: 0,
      fadeOut: 1000,
      category: 'core'
    },
    level_up_fanfare: {
      path: '/assets/audio/music/core/level_up_fanfare.mp3',
      volume: 0.8,
      loop: false,
      fadeIn: 0,
      fadeOut: 300,
      category: 'core'
    },
    coliseum_theme: {
      path: '/assets/audio/music/core/coliseum_theme.mp3',
      volume: 0.7,
      loop: true,
      fadeIn: 1500,
      fadeOut: 1500,
      category: 'core'
    },
    social_hub_theme: {
      path: '/assets/audio/music/core/social_hub_theme.mp3',
      volume: 0.65,
      loop: true,
      fadeIn: 2000,
      fadeOut: 1500,
      category: 'core'
    },
    guild_advancement: {
      path: '/assets/audio/music/core/guild_advancement.mp3',
      volume: 0.7,
      loop: true,
      fadeIn: 1500,
      fadeOut: 1500,
      category: 'core'
    },
    wilderness_ambient: {
      path: '/assets/audio/music/core/wilderness_ambient.mp3',
      volume: 0.5,
      loop: true,
      fadeIn: 3000,
      fadeOut: 2500,
      category: 'core'
    },
    palace_theme: {
      path: '/assets/audio/music/core/palace_theme.mp3',
      volume: 0.75,
      loop: true,
      fadeIn: 2000,
      fadeOut: 2000,
      category: 'core'
    },

    // -------------------------------------------------------------------------
    // Heartlands - Regional tracks (5)
    // -------------------------------------------------------------------------
    heartlands_exploration: {
      path: '/assets/audio/music/regions/heartlands_exploration.mp3',
      volume: 0.7,
      loop: true,
      fadeIn: 2000,
      fadeOut: 1500,
      category: 'region',
      region: 'heartlands'
    },
    heartlands_tavern: {
      path: '/assets/audio/music/regions/heartlands_tavern.mp3',
      volume: 0.65,
      loop: true,
      fadeIn: 1500,
      fadeOut: 1500,
      category: 'region',
      region: 'heartlands'
    },
    heartlands_shop: {
      path: '/assets/audio/music/regions/heartlands_shop.mp3',
      volume: 0.6,
      loop: true,
      fadeIn: 1500,
      fadeOut: 1500,
      category: 'region',
      region: 'heartlands'
    },
    heartlands_fishing: {
      path: '/assets/audio/music/regions/heartlands_fishing.mp3',
      volume: 0.55,
      loop: true,
      fadeIn: 2000,
      fadeOut: 2000,
      category: 'region',
      region: 'heartlands'
    },
    heartlands_ruins: {
      path: '/assets/audio/music/regions/heartlands_ruins.mp3',
      volume: 0.6,
      loop: true,
      fadeIn: 2000,
      fadeOut: 1500,
      category: 'region',
      region: 'heartlands'
    },

    // -------------------------------------------------------------------------
    // Sylvan Reaches - Regional tracks (5)
    // -------------------------------------------------------------------------
    sylvan_reaches_exploration: {
      path: '/assets/audio/music/regions/sylvan_reaches_exploration.mp3',
      volume: 0.7,
      loop: true,
      fadeIn: 2500,
      fadeOut: 2000,
      category: 'region',
      region: 'sylvan_reaches'
    },
    sylvan_reaches_tavern: {
      path: '/assets/audio/music/regions/sylvan_reaches_tavern.mp3',
      volume: 0.6,
      loop: true,
      fadeIn: 2000,
      fadeOut: 1500,
      category: 'region',
      region: 'sylvan_reaches'
    },
    sylvan_reaches_shop: {
      path: '/assets/audio/music/regions/sylvan_reaches_shop.mp3',
      volume: 0.55,
      loop: true,
      fadeIn: 1500,
      fadeOut: 1500,
      category: 'region',
      region: 'sylvan_reaches'
    },
    sylvan_reaches_fishing: {
      path: '/assets/audio/music/regions/sylvan_reaches_fishing.mp3',
      volume: 0.5,
      loop: true,
      fadeIn: 2500,
      fadeOut: 2500,
      category: 'region',
      region: 'sylvan_reaches'
    },
    sylvan_reaches_ruins: {
      path: '/assets/audio/music/regions/sylvan_reaches_ruins.mp3',
      volume: 0.6,
      loop: true,
      fadeIn: 2000,
      fadeOut: 2000,
      category: 'region',
      region: 'sylvan_reaches'
    },

    // -------------------------------------------------------------------------
    // Iron Depths - Regional tracks (5)
    // -------------------------------------------------------------------------
    iron_depths_exploration: {
      path: '/assets/audio/music/regions/iron_depths_exploration.mp3',
      volume: 0.7,
      loop: true,
      fadeIn: 2000,
      fadeOut: 1500,
      category: 'region',
      region: 'iron_depths'
    },
    iron_depths_tavern: {
      path: '/assets/audio/music/regions/iron_depths_tavern.mp3',
      volume: 0.65,
      loop: true,
      fadeIn: 1500,
      fadeOut: 1500,
      category: 'region',
      region: 'iron_depths'
    },
    iron_depths_shop: {
      path: '/assets/audio/music/regions/iron_depths_shop.mp3',
      volume: 0.6,
      loop: true,
      fadeIn: 1500,
      fadeOut: 1500,
      category: 'region',
      region: 'iron_depths'
    },
    iron_depths_fishing: {
      path: '/assets/audio/music/regions/iron_depths_fishing.mp3',
      volume: 0.55,
      loop: true,
      fadeIn: 2000,
      fadeOut: 2000,
      category: 'region',
      region: 'iron_depths'
    },
    iron_depths_ruins: {
      path: '/assets/audio/music/regions/iron_depths_ruins.mp3',
      volume: 0.6,
      loop: true,
      fadeIn: 2000,
      fadeOut: 1500,
      category: 'region',
      region: 'iron_depths'
    },

    // -------------------------------------------------------------------------
    // Shadowmere - Regional tracks (5)
    // -------------------------------------------------------------------------
    shadowmere_exploration: {
      path: '/assets/audio/music/regions/shadowmere_exploration.mp3',
      volume: 0.7,
      loop: true,
      fadeIn: 2000,
      fadeOut: 1500,
      category: 'region',
      region: 'shadowmere'
    },
    shadowmere_tavern: {
      path: '/assets/audio/music/regions/shadowmere_tavern.mp3',
      volume: 0.6,
      loop: true,
      fadeIn: 1500,
      fadeOut: 1500,
      category: 'region',
      region: 'shadowmere'
    },
    shadowmere_shop: {
      path: '/assets/audio/music/regions/shadowmere_shop.mp3',
      volume: 0.55,
      loop: true,
      fadeIn: 1500,
      fadeOut: 1500,
      category: 'region',
      region: 'shadowmere'
    },
    shadowmere_fishing: {
      path: '/assets/audio/music/regions/shadowmere_fishing.mp3',
      volume: 0.5,
      loop: true,
      fadeIn: 2500,
      fadeOut: 2000,
      category: 'region',
      region: 'shadowmere'
    },
    shadowmere_ruins: {
      path: '/assets/audio/music/regions/shadowmere_ruins.mp3',
      volume: 0.6,
      loop: true,
      fadeIn: 2000,
      fadeOut: 1500,
      category: 'region',
      region: 'shadowmere'
    },

    // -------------------------------------------------------------------------
    // Bloodplains - Regional tracks (5)
    // -------------------------------------------------------------------------
    bloodplains_exploration: {
      path: '/assets/audio/music/regions/bloodplains_exploration.mp3',
      volume: 0.7,
      loop: true,
      fadeIn: 1500,
      fadeOut: 1500,
      category: 'region',
      region: 'bloodplains'
    },
    bloodplains_tavern: {
      path: '/assets/audio/music/regions/bloodplains_tavern.mp3',
      volume: 0.65,
      loop: true,
      fadeIn: 1500,
      fadeOut: 1500,
      category: 'region',
      region: 'bloodplains'
    },
    bloodplains_shop: {
      path: '/assets/audio/music/regions/bloodplains_shop.mp3',
      volume: 0.6,
      loop: true,
      fadeIn: 1500,
      fadeOut: 1500,
      category: 'region',
      region: 'bloodplains'
    },
    bloodplains_fishing: {
      path: '/assets/audio/music/regions/bloodplains_fishing.mp3',
      volume: 0.55,
      loop: true,
      fadeIn: 2000,
      fadeOut: 2000,
      category: 'region',
      region: 'bloodplains'
    },
    bloodplains_ruins: {
      path: '/assets/audio/music/regions/bloodplains_ruins.mp3',
      volume: 0.6,
      loop: true,
      fadeIn: 2000,
      fadeOut: 1500,
      category: 'region',
      region: 'bloodplains'
    },

    // -------------------------------------------------------------------------
    // Battle tracks - Heartlands (4)
    // -------------------------------------------------------------------------
    heartlands_battle_regular: {
      path: '/assets/audio/music/battle/heartlands_battle_regular.mp3',
      volume: 0.75,
      loop: true,
      fadeIn: 500,
      fadeOut: 1000,
      category: 'battle',
      region: 'heartlands',
      battleType: 'regular'
    },
    heartlands_battle_boss: {
      path: '/assets/audio/music/battle/heartlands_battle_boss.mp3',
      volume: 0.8,
      loop: true,
      fadeIn: 300,
      fadeOut: 1500,
      category: 'battle',
      region: 'heartlands',
      battleType: 'boss'
    },
    heartlands_battle_pvp: {
      path: '/assets/audio/music/battle/heartlands_battle_pvp.mp3',
      volume: 0.75,
      loop: true,
      fadeIn: 500,
      fadeOut: 1000,
      category: 'battle',
      region: 'heartlands',
      battleType: 'pvp'
    },
    heartlands_battle_story: {
      path: '/assets/audio/music/battle/heartlands_battle_story.mp3',
      volume: 0.75,
      loop: true,
      fadeIn: 500,
      fadeOut: 1500,
      category: 'battle',
      region: 'heartlands',
      battleType: 'story'
    },

    // -------------------------------------------------------------------------
    // Battle tracks - Sylvan Reaches (4)
    // -------------------------------------------------------------------------
    sylvan_reaches_battle_regular: {
      path: '/assets/audio/music/battle/sylvan_reaches_battle_regular.mp3',
      volume: 0.75,
      loop: true,
      fadeIn: 500,
      fadeOut: 1000,
      category: 'battle',
      region: 'sylvan_reaches',
      battleType: 'regular'
    },
    sylvan_reaches_battle_boss: {
      path: '/assets/audio/music/battle/sylvan_reaches_battle_boss.mp3',
      volume: 0.8,
      loop: true,
      fadeIn: 300,
      fadeOut: 1500,
      category: 'battle',
      region: 'sylvan_reaches',
      battleType: 'boss'
    },
    sylvan_reaches_battle_pvp: {
      path: '/assets/audio/music/battle/sylvan_reaches_battle_pvp.mp3',
      volume: 0.75,
      loop: true,
      fadeIn: 500,
      fadeOut: 1000,
      category: 'battle',
      region: 'sylvan_reaches',
      battleType: 'pvp'
    },
    sylvan_reaches_battle_story: {
      path: '/assets/audio/music/battle/sylvan_reaches_battle_story.mp3',
      volume: 0.75,
      loop: true,
      fadeIn: 500,
      fadeOut: 1500,
      category: 'battle',
      region: 'sylvan_reaches',
      battleType: 'story'
    },

    // -------------------------------------------------------------------------
    // Battle tracks - Iron Depths (4)
    // -------------------------------------------------------------------------
    iron_depths_battle_regular: {
      path: '/assets/audio/music/battle/iron_depths_battle_regular.mp3',
      volume: 0.75,
      loop: true,
      fadeIn: 500,
      fadeOut: 1000,
      category: 'battle',
      region: 'iron_depths',
      battleType: 'regular'
    },
    iron_depths_battle_boss: {
      path: '/assets/audio/music/battle/iron_depths_battle_boss.mp3',
      volume: 0.8,
      loop: true,
      fadeIn: 300,
      fadeOut: 1500,
      category: 'battle',
      region: 'iron_depths',
      battleType: 'boss'
    },
    iron_depths_battle_pvp: {
      path: '/assets/audio/music/battle/iron_depths_battle_pvp.mp3',
      volume: 0.75,
      loop: true,
      fadeIn: 500,
      fadeOut: 1000,
      category: 'battle',
      region: 'iron_depths',
      battleType: 'pvp'
    },
    iron_depths_battle_story: {
      path: '/assets/audio/music/battle/iron_depths_battle_story.mp3',
      volume: 0.75,
      loop: true,
      fadeIn: 500,
      fadeOut: 1500,
      category: 'battle',
      region: 'iron_depths',
      battleType: 'story'
    },

    // -------------------------------------------------------------------------
    // Battle tracks - Shadowmere (4)
    // -------------------------------------------------------------------------
    shadowmere_battle_regular: {
      path: '/assets/audio/music/battle/shadowmere_battle_regular.mp3',
      volume: 0.75,
      loop: true,
      fadeIn: 500,
      fadeOut: 1000,
      category: 'battle',
      region: 'shadowmere',
      battleType: 'regular'
    },
    shadowmere_battle_boss: {
      path: '/assets/audio/music/battle/shadowmere_battle_boss.mp3',
      volume: 0.8,
      loop: true,
      fadeIn: 300,
      fadeOut: 1500,
      category: 'battle',
      region: 'shadowmere',
      battleType: 'boss'
    },
    shadowmere_battle_pvp: {
      path: '/assets/audio/music/battle/shadowmere_battle_pvp.mp3',
      volume: 0.75,
      loop: true,
      fadeIn: 500,
      fadeOut: 1000,
      category: 'battle',
      region: 'shadowmere',
      battleType: 'pvp'
    },
    shadowmere_battle_story: {
      path: '/assets/audio/music/battle/shadowmere_battle_story.mp3',
      volume: 0.75,
      loop: true,
      fadeIn: 500,
      fadeOut: 1500,
      category: 'battle',
      region: 'shadowmere',
      battleType: 'story'
    },

    // -------------------------------------------------------------------------
    // Battle tracks - Bloodplains (4)
    // -------------------------------------------------------------------------
    bloodplains_battle_regular: {
      path: '/assets/audio/music/battle/bloodplains_battle_regular.mp3',
      volume: 0.75,
      loop: true,
      fadeIn: 500,
      fadeOut: 1000,
      category: 'battle',
      region: 'bloodplains',
      battleType: 'regular'
    },
    bloodplains_battle_boss: {
      path: '/assets/audio/music/battle/bloodplains_battle_boss.mp3',
      volume: 0.8,
      loop: true,
      fadeIn: 300,
      fadeOut: 1500,
      category: 'battle',
      region: 'bloodplains',
      battleType: 'boss'
    },
    bloodplains_battle_pvp: {
      path: '/assets/audio/music/battle/bloodplains_battle_pvp.mp3',
      volume: 0.75,
      loop: true,
      fadeIn: 500,
      fadeOut: 1000,
      category: 'battle',
      region: 'bloodplains',
      battleType: 'pvp'
    },
    bloodplains_battle_story: {
      path: '/assets/audio/music/battle/bloodplains_battle_story.mp3',
      volume: 0.75,
      loop: true,
      fadeIn: 500,
      fadeOut: 1500,
      category: 'battle',
      region: 'bloodplains',
      battleType: 'story'
    }
  },

  // ===========================================================================
  // SFX - 187 effects (combat: 47, skills: 140)
  // ===========================================================================
  sfx: {
    // -------------------------------------------------------------------------
    // Combat - Weapon attacks (14)
    // -------------------------------------------------------------------------
    attack_sword_1: {
      path: '/assets/audio/sfx/combat/attack_sword_1.mp3',
      volume: 0.8,
      category: 'combat',
      subcategory: 'weapon'
    },
    attack_sword_2: {
      path: '/assets/audio/sfx/combat/attack_sword_2.mp3',
      volume: 0.8,
      category: 'combat',
      subcategory: 'weapon'
    },
    attack_sword_3: {
      path: '/assets/audio/sfx/combat/attack_sword_3.mp3',
      volume: 0.8,
      category: 'combat',
      subcategory: 'weapon'
    },
    attack_axe_1: {
      path: '/assets/audio/sfx/combat/attack_axe_1.mp3',
      volume: 0.8,
      category: 'combat',
      subcategory: 'weapon'
    },
    attack_axe_2: {
      path: '/assets/audio/sfx/combat/attack_axe_2.mp3',
      volume: 0.85,
      category: 'combat',
      subcategory: 'weapon'
    },
    attack_bow_1: {
      path: '/assets/audio/sfx/combat/attack_bow_1.mp3',
      volume: 0.75,
      category: 'combat',
      subcategory: 'weapon'
    },
    attack_bow_2: {
      path: '/assets/audio/sfx/combat/attack_bow_2.mp3',
      volume: 0.8,
      category: 'combat',
      subcategory: 'weapon'
    },
    attack_staff_1: {
      path: '/assets/audio/sfx/combat/attack_staff_1.mp3',
      volume: 0.75,
      category: 'combat',
      subcategory: 'weapon'
    },
    attack_staff_2: {
      path: '/assets/audio/sfx/combat/attack_staff_2.mp3',
      volume: 0.8,
      category: 'combat',
      subcategory: 'weapon'
    },
    attack_fist_1: {
      path: '/assets/audio/sfx/combat/attack_fist_1.mp3',
      volume: 0.75,
      category: 'combat',
      subcategory: 'weapon'
    },
    attack_fist_2: {
      path: '/assets/audio/sfx/combat/attack_fist_2.mp3',
      volume: 0.8,
      category: 'combat',
      subcategory: 'weapon'
    },
    attack_fist_3: {
      path: '/assets/audio/sfx/combat/attack_fist_3.mp3',
      volume: 0.85,
      category: 'combat',
      subcategory: 'weapon'
    },
    attack_dagger_1: {
      path: '/assets/audio/sfx/combat/attack_dagger_1.mp3',
      volume: 0.75,
      category: 'combat',
      subcategory: 'weapon'
    },
    attack_dagger_2: {
      path: '/assets/audio/sfx/combat/attack_dagger_2.mp3',
      volume: 0.75,
      category: 'combat',
      subcategory: 'weapon'
    },

    // -------------------------------------------------------------------------
    // Combat - Impacts (6)
    // -------------------------------------------------------------------------
    impact_hit: {
      path: '/assets/audio/sfx/combat/impact_hit.mp3',
      volume: 0.8,
      category: 'combat',
      subcategory: 'impact'
    },
    impact_critical: {
      path: '/assets/audio/sfx/combat/impact_critical.mp3',
      volume: 0.9,
      category: 'combat',
      subcategory: 'impact'
    },
    impact_miss: {
      path: '/assets/audio/sfx/combat/impact_miss.mp3',
      volume: 0.6,
      category: 'combat',
      subcategory: 'impact'
    },
    impact_block: {
      path: '/assets/audio/sfx/combat/impact_block.mp3',
      volume: 0.8,
      category: 'combat',
      subcategory: 'impact'
    },
    impact_parry: {
      path: '/assets/audio/sfx/combat/impact_parry.mp3',
      volume: 0.8,
      category: 'combat',
      subcategory: 'impact'
    },
    impact_armor: {
      path: '/assets/audio/sfx/combat/impact_armor.mp3',
      volume: 0.75,
      category: 'combat',
      subcategory: 'impact'
    },

    // -------------------------------------------------------------------------
    // Combat - Status effects (15)
    // -------------------------------------------------------------------------
    status_burn: {
      path: '/assets/audio/sfx/combat/status_burn.mp3',
      volume: 0.75,
      category: 'combat',
      subcategory: 'status'
    },
    status_freeze: {
      path: '/assets/audio/sfx/combat/status_freeze.mp3',
      volume: 0.75,
      category: 'combat',
      subcategory: 'status'
    },
    status_poison: {
      path: '/assets/audio/sfx/combat/status_poison.mp3',
      volume: 0.7,
      category: 'combat',
      subcategory: 'status'
    },
    status_stun: {
      path: '/assets/audio/sfx/combat/status_stun.mp3',
      volume: 0.8,
      category: 'combat',
      subcategory: 'status'
    },
    status_slow: {
      path: '/assets/audio/sfx/combat/status_slow.mp3',
      volume: 0.7,
      category: 'combat',
      subcategory: 'status'
    },
    status_bleed: {
      path: '/assets/audio/sfx/combat/status_bleed.mp3',
      volume: 0.7,
      category: 'combat',
      subcategory: 'status'
    },
    status_blind: {
      path: '/assets/audio/sfx/combat/status_blind.mp3',
      volume: 0.7,
      category: 'combat',
      subcategory: 'status'
    },
    status_fear: {
      path: '/assets/audio/sfx/combat/status_fear.mp3',
      volume: 0.75,
      category: 'combat',
      subcategory: 'status'
    },
    status_taunt: {
      path: '/assets/audio/sfx/combat/status_taunt.mp3',
      volume: 0.8,
      category: 'combat',
      subcategory: 'status'
    },
    status_weaken: {
      path: '/assets/audio/sfx/combat/status_weaken.mp3',
      volume: 0.7,
      category: 'combat',
      subcategory: 'status'
    },
    status_corrode: {
      path: '/assets/audio/sfx/combat/status_corrode.mp3',
      volume: 0.75,
      category: 'combat',
      subcategory: 'status'
    },
    status_curse: {
      path: '/assets/audio/sfx/combat/status_curse.mp3',
      volume: 0.75,
      category: 'combat',
      subcategory: 'status'
    },
    status_haste: {
      path: '/assets/audio/sfx/combat/status_haste.mp3',
      volume: 0.75,
      category: 'combat',
      subcategory: 'status'
    },
    status_rage: {
      path: '/assets/audio/sfx/combat/status_rage.mp3',
      volume: 0.8,
      category: 'combat',
      subcategory: 'status'
    },
    status_fortify: {
      path: '/assets/audio/sfx/combat/status_fortify.mp3',
      volume: 0.75,
      category: 'combat',
      subcategory: 'status'
    },

    // -------------------------------------------------------------------------
    // Combat - Deaths (10)
    // -------------------------------------------------------------------------
    player_ko: {
      path: '/assets/audio/sfx/combat/player_ko.mp3',
      volume: 0.8,
      category: 'combat',
      subcategory: 'death'
    },
    enemy_death_beast: {
      path: '/assets/audio/sfx/combat/enemy_death_beast.mp3',
      volume: 0.8,
      category: 'combat',
      subcategory: 'death'
    },
    enemy_death_humanoid: {
      path: '/assets/audio/sfx/combat/enemy_death_humanoid.mp3',
      volume: 0.8,
      category: 'combat',
      subcategory: 'death'
    },
    enemy_death_undead: {
      path: '/assets/audio/sfx/combat/enemy_death_undead.mp3',
      volume: 0.8,
      category: 'combat',
      subcategory: 'death'
    },
    enemy_death_elemental: {
      path: '/assets/audio/sfx/combat/enemy_death_elemental.mp3',
      volume: 0.8,
      category: 'combat',
      subcategory: 'death'
    },
    enemy_death_dragon: {
      path: '/assets/audio/sfx/combat/enemy_death_dragon.mp3',
      volume: 0.9,
      category: 'combat',
      subcategory: 'death'
    },
    enemy_death_demon: {
      path: '/assets/audio/sfx/combat/enemy_death_demon.mp3',
      volume: 0.85,
      category: 'combat',
      subcategory: 'death'
    },
    enemy_death_construct: {
      path: '/assets/audio/sfx/combat/enemy_death_construct.mp3',
      volume: 0.85,
      category: 'combat',
      subcategory: 'death'
    },
    enemy_death_insect: {
      path: '/assets/audio/sfx/combat/enemy_death_insect.mp3',
      volume: 0.75,
      category: 'combat',
      subcategory: 'death'
    },
    enemy_death_plant: {
      path: '/assets/audio/sfx/combat/enemy_death_plant.mp3',
      volume: 0.75,
      category: 'combat',
      subcategory: 'death'
    },

    // -------------------------------------------------------------------------
    // Turn Indicators (2)
    // -------------------------------------------------------------------------
    turn_start: {
      path: '/assets/audio/sfx/combat/turn_start.mp3',
      volume: 0.6,
      category: 'combat',
      subcategory: 'turn'
    },
    enemy_turn: {
      path: '/assets/audio/sfx/combat/enemy_turn.mp3',
      volume: 0.5,
      category: 'combat',
      subcategory: 'turn'
    },

    // -------------------------------------------------------------------------
    // Player Skills - Warrior (7)
    // -------------------------------------------------------------------------
    skill_power_strike: {
      path: '/assets/audio/sfx/skills/power_strike.mp3',
      volume: 0.8,
      category: 'skill',
      guild: 'warrior'
    },
    skill_cleave: {
      path: '/assets/audio/sfx/skills/cleave.mp3',
      volume: 0.85,
      category: 'skill',
      guild: 'warrior'
    },
    skill_rage: {
      path: '/assets/audio/sfx/skills/rage.mp3',
      volume: 0.8,
      category: 'skill',
      guild: 'warrior'
    },
    skill_rend: {
      path: '/assets/audio/sfx/skills/rend.mp3',
      volume: 0.8,
      category: 'skill',
      guild: 'warrior'
    },
    skill_shield_bash: {
      path: '/assets/audio/sfx/skills/shield_bash.mp3',
      volume: 0.85,
      category: 'skill',
      guild: 'warrior'
    },
    skill_fortify: {
      path: '/assets/audio/sfx/skills/fortify.mp3',
      volume: 0.75,
      category: 'skill',
      guild: 'warrior'
    },
    skill_taunt: {
      path: '/assets/audio/sfx/skills/taunt.mp3',
      volume: 0.85,
      category: 'skill',
      guild: 'warrior'
    },

    // -------------------------------------------------------------------------
    // Player Skills - Wizard (6)
    // -------------------------------------------------------------------------
    skill_fireball: {
      path: '/assets/audio/sfx/skills/fireball.mp3',
      volume: 0.8,
      category: 'skill',
      guild: 'wizard'
    },
    skill_inferno: {
      path: '/assets/audio/sfx/skills/inferno.mp3',
      volume: 0.9,
      category: 'skill',
      guild: 'wizard'
    },
    skill_ice_shard: {
      path: '/assets/audio/sfx/skills/ice_shard.mp3',
      volume: 0.8,
      category: 'skill',
      guild: 'wizard'
    },
    skill_blizzard: {
      path: '/assets/audio/sfx/skills/blizzard.mp3',
      volume: 0.85,
      category: 'skill',
      guild: 'wizard'
    },
    skill_lightning_bolt: {
      path: '/assets/audio/sfx/skills/lightning_bolt.mp3',
      volume: 0.85,
      category: 'skill',
      guild: 'wizard'
    },
    skill_chain_lightning: {
      path: '/assets/audio/sfx/skills/chain_lightning.mp3',
      volume: 0.85,
      category: 'skill',
      guild: 'wizard'
    },

    // -------------------------------------------------------------------------
    // Player Skills - Monk (5)
    // -------------------------------------------------------------------------
    skill_palm_strike: {
      path: '/assets/audio/sfx/skills/palm_strike.mp3',
      volume: 0.8,
      category: 'skill',
      guild: 'monk'
    },
    skill_flying_kick: {
      path: '/assets/audio/sfx/skills/flying_kick.mp3',
      volume: 0.85,
      category: 'skill',
      guild: 'monk'
    },
    skill_thousand_fists: {
      path: '/assets/audio/sfx/skills/thousand_fists.mp3',
      volume: 0.85,
      category: 'skill',
      guild: 'monk'
    },
    skill_meditation: {
      path: '/assets/audio/sfx/skills/meditation.mp3',
      volume: 0.7,
      category: 'skill',
      guild: 'monk'
    },
    skill_inner_peace: {
      path: '/assets/audio/sfx/skills/inner_peace.mp3',
      volume: 0.75,
      category: 'skill',
      guild: 'monk'
    },

    // -------------------------------------------------------------------------
    // Player Skills - Chemist (6)
    // -------------------------------------------------------------------------
    skill_potion_toss: {
      path: '/assets/audio/sfx/skills/potion_toss.mp3',
      volume: 0.75,
      category: 'skill',
      guild: 'chemist'
    },
    skill_mega_potion: {
      path: '/assets/audio/sfx/skills/mega_potion.mp3',
      volume: 0.8,
      category: 'skill',
      guild: 'chemist'
    },
    skill_acid_flask: {
      path: '/assets/audio/sfx/skills/acid_flask.mp3',
      volume: 0.8,
      category: 'skill',
      guild: 'chemist'
    },
    skill_poison_cloud: {
      path: '/assets/audio/sfx/skills/poison_cloud.mp3',
      volume: 0.75,
      category: 'skill',
      guild: 'chemist'
    },
    skill_smoke_bomb: {
      path: '/assets/audio/sfx/skills/smoke_bomb.mp3',
      volume: 0.75,
      category: 'skill',
      guild: 'chemist'
    },
    skill_haste_potion: {
      path: '/assets/audio/sfx/skills/haste_potion.mp3',
      volume: 0.75,
      category: 'skill',
      guild: 'chemist'
    },

    // -------------------------------------------------------------------------
    // Player Skills - Berserker (12)
    // -------------------------------------------------------------------------
    skill_rage_strike: {
      path: '/assets/audio/sfx/skills/rage_strike.mp3',
      volume: 0.85,
      category: 'skill',
      guild: 'berserker'
    },
    skill_blood_frenzy: {
      path: '/assets/audio/sfx/skills/blood_frenzy.mp3',
      volume: 0.8,
      category: 'skill',
      guild: 'berserker'
    },
    skill_enraged_fury: {
      path: '/assets/audio/sfx/skills/enraged_fury.mp3',
      volume: 0.9,
      category: 'skill',
      guild: 'berserker'
    },
    skill_reckless_power: {
      path: '/assets/audio/sfx/skills/reckless_power.mp3',
      volume: 0.85,
      category: 'skill',
      guild: 'berserker'
    },
    skill_berserker_rage: {
      path: '/assets/audio/sfx/skills/berserker_rage.mp3',
      volume: 0.9,
      category: 'skill',
      guild: 'berserker'
    },
    skill_rampage: {
      path: '/assets/audio/sfx/skills/rampage.mp3',
      volume: 0.9,
      category: 'skill',
      guild: 'berserker'
    },
    skill_reckless_charge: {
      path: '/assets/audio/sfx/skills/reckless_charge.mp3',
      volume: 0.85,
      category: 'skill',
      guild: 'berserker'
    },
    skill_wild_swing: {
      path: '/assets/audio/sfx/skills/wild_swing.mp3',
      volume: 0.85,
      category: 'skill',
      guild: 'berserker'
    },
    skill_self_destruction: {
      path: '/assets/audio/sfx/skills/self_destruction.mp3',
      volume: 0.95,
      category: 'skill',
      guild: 'berserker'
    },
    skill_berserker_leap: {
      path: '/assets/audio/sfx/skills/berserker_leap.mp3',
      volume: 0.9,
      category: 'skill',
      guild: 'berserker'
    },
    skill_final_stand: {
      path: '/assets/audio/sfx/skills/final_stand.mp3',
      volume: 0.85,
      category: 'skill',
      guild: 'berserker'
    },
    skill_martyrs_resolve: {
      path: '/assets/audio/sfx/skills/martyrs_resolve.mp3',
      volume: 0.8,
      category: 'skill',
      guild: 'berserker'
    },

    // -------------------------------------------------------------------------
    // Player Skills - Sorcerer (10)
    // -------------------------------------------------------------------------
    skill_arcane_bolt: {
      path: '/assets/audio/sfx/skills/arcane_bolt.mp3',
      volume: 0.8,
      category: 'skill',
      guild: 'sorcerer'
    },
    skill_mana_shield: {
      path: '/assets/audio/sfx/skills/mana_shield.mp3',
      volume: 0.75,
      category: 'skill',
      guild: 'sorcerer'
    },
    skill_spell_amplify: {
      path: '/assets/audio/sfx/skills/spell_amplify.mp3',
      volume: 0.8,
      category: 'skill',
      guild: 'sorcerer'
    },
    skill_arcane_explosion: {
      path: '/assets/audio/sfx/skills/arcane_explosion.mp3',
      volume: 0.9,
      category: 'skill',
      guild: 'sorcerer'
    },
    skill_armageddon: {
      path: '/assets/audio/sfx/skills/armageddon.mp3',
      volume: 0.95,
      category: 'skill',
      guild: 'sorcerer'
    },
    skill_tri_element: {
      path: '/assets/audio/sfx/skills/tri_element.mp3',
      volume: 0.9,
      category: 'skill',
      guild: 'sorcerer'
    },
    skill_avatar_of_elements: {
      path: '/assets/audio/sfx/skills/avatar_of_elements.mp3',
      volume: 0.95,
      category: 'skill',
      guild: 'sorcerer'
    },
    skill_elemental_overload: {
      path: '/assets/audio/sfx/skills/elemental_overload.mp3',
      volume: 0.85,
      category: 'skill',
      guild: 'sorcerer'
    },
    skill_elemental_shield: {
      path: '/assets/audio/sfx/skills/elemental_shield.mp3',
      volume: 0.75,
      category: 'skill',
      guild: 'sorcerer'
    },
    skill_element_shift: {
      path: '/assets/audio/sfx/skills/element_shift.mp3',
      volume: 0.75,
      category: 'skill',
      guild: 'sorcerer'
    },
    skill_prismatic_blast: {
      path: '/assets/audio/sfx/skills/prismatic_blast.mp3',
      volume: 0.85,
      category: 'skill',
      guild: 'sorcerer'
    },

    // -------------------------------------------------------------------------
    // Player Skills - Ninja (13)
    // -------------------------------------------------------------------------
    skill_shadow_step: {
      path: '/assets/audio/sfx/skills/shadow_step.mp3',
      volume: 0.75,
      category: 'skill',
      guild: 'ninja'
    },
    skill_vanish: {
      path: '/assets/audio/sfx/skills/vanish.mp3',
      volume: 0.7,
      category: 'skill',
      guild: 'ninja'
    },
    skill_backstab: {
      path: '/assets/audio/sfx/skills/backstab.mp3',
      volume: 0.8,
      category: 'skill',
      guild: 'ninja'
    },
    skill_assassination: {
      path: '/assets/audio/sfx/skills/assassination.mp3',
      volume: 0.85,
      category: 'skill',
      guild: 'ninja'
    },
    skill_shadow_clone: {
      path: '/assets/audio/sfx/skills/shadow_clone.mp3',
      volume: 0.75,
      category: 'skill',
      guild: 'ninja'
    },
    skill_shuriken: {
      path: '/assets/audio/sfx/skills/shuriken.mp3',
      volume: 0.75,
      category: 'skill',
      guild: 'ninja'
    },
    skill_kunai_barrage: {
      path: '/assets/audio/sfx/skills/kunai_barrage.mp3',
      volume: 0.8,
      category: 'skill',
      guild: 'ninja'
    },
    skill_death_mark: {
      path: '/assets/audio/sfx/skills/death_mark.mp3',
      volume: 0.8,
      category: 'skill',
      guild: 'ninja'
    },
    skill_explosive_tag: {
      path: '/assets/audio/sfx/skills/explosive_tag.mp3',
      volume: 0.85,
      category: 'skill',
      guild: 'ninja'
    },
    skill_ninja_smoke_bomb: {
      path: '/assets/audio/sfx/skills/ninja_smoke_bomb.mp3',
      volume: 0.75,
      category: 'skill',
      guild: 'ninja'
    },
    skill_one_thousand_cuts: {
      path: '/assets/audio/sfx/skills/one_thousand_cuts.mp3',
      volume: 0.9,
      category: 'skill',
      guild: 'ninja'
    },
    skill_poison_blade: {
      path: '/assets/audio/sfx/skills/poison_blade.mp3',
      volume: 0.8,
      category: 'skill',
      guild: 'ninja'
    },
    skill_shadow_arts: {
      path: '/assets/audio/sfx/skills/shadow_arts.mp3',
      volume: 0.75,
      category: 'skill',
      guild: 'ninja'
    },

    // -------------------------------------------------------------------------
    // Player Skills - Alchemist (13)
    // -------------------------------------------------------------------------
    skill_transmute: {
      path: '/assets/audio/sfx/skills/transmute.mp3',
      volume: 0.75,
      category: 'skill',
      guild: 'alchemist'
    },
    skill_gold_touch: {
      path: '/assets/audio/sfx/skills/gold_touch.mp3',
      volume: 0.75,
      category: 'skill',
      guild: 'alchemist'
    },
    skill_volatile_mix: {
      path: '/assets/audio/sfx/skills/volatile_mix.mp3',
      volume: 0.85,
      category: 'skill',
      guild: 'alchemist'
    },
    skill_napalm: {
      path: '/assets/audio/sfx/skills/napalm.mp3',
      volume: 0.85,
      category: 'skill',
      guild: 'alchemist'
    },
    skill_elemental_bomb: {
      path: '/assets/audio/sfx/skills/elemental_bomb.mp3',
      volume: 0.9,
      category: 'skill',
      guild: 'alchemist'
    },
    skill_tactical_nuke: {
      path: '/assets/audio/sfx/skills/tactical_nuke.mp3',
      volume: 0.95,
      category: 'skill',
      guild: 'alchemist'
    },
    skill_alchemical_warfare: {
      path: '/assets/audio/sfx/skills/alchemical_warfare.mp3',
      volume: 0.9,
      category: 'skill',
      guild: 'alchemist'
    },
    skill_element_convert: {
      path: '/assets/audio/sfx/skills/element_convert.mp3',
      volume: 0.75,
      category: 'skill',
      guild: 'alchemist'
    },
    skill_equivalent_exchange: {
      path: '/assets/audio/sfx/skills/equivalent_exchange.mp3',
      volume: 0.8,
      category: 'skill',
      guild: 'alchemist'
    },
    skill_matter_shift: {
      path: '/assets/audio/sfx/skills/matter_shift.mp3',
      volume: 0.8,
      category: 'skill',
      guild: 'alchemist'
    },
    skill_perfect_transmutation: {
      path: '/assets/audio/sfx/skills/perfect_transmutation.mp3',
      volume: 0.9,
      category: 'skill',
      guild: 'alchemist'
    },
    skill_scatter_shot: {
      path: '/assets/audio/sfx/skills/scatter_shot.mp3',
      volume: 0.85,
      category: 'skill',
      guild: 'alchemist'
    },

    // -------------------------------------------------------------------------
    // Monster Skills - Beast (7)
    // -------------------------------------------------------------------------
    monster_bite: {
      path: '/assets/audio/sfx/skills/monster/bite.mp3',
      volume: 0.8,
      category: 'skill',
      archetype: 'beast'
    },
    monster_claw_swipe: {
      path: '/assets/audio/sfx/skills/monster/claw_swipe.mp3',
      volume: 0.8,
      category: 'skill',
      archetype: 'beast'
    },
    monster_pounce: {
      path: '/assets/audio/sfx/skills/monster/pounce.mp3',
      volume: 0.85,
      category: 'skill',
      archetype: 'beast'
    },
    monster_ferocious_roar: {
      path: '/assets/audio/sfx/skills/monster/ferocious_roar.mp3',
      volume: 0.85,
      category: 'skill',
      archetype: 'beast'
    },
    monster_rending_bite: {
      path: '/assets/audio/sfx/skills/monster/rending_bite.mp3',
      volume: 0.85,
      category: 'skill',
      archetype: 'beast'
    },
    monster_savage_assault: {
      path: '/assets/audio/sfx/skills/monster/savage_assault.mp3',
      volume: 0.85,
      category: 'skill',
      archetype: 'beast'
    },
    monster_howl: {
      path: '/assets/audio/sfx/skills/monster/howl.mp3',
      volume: 0.8,
      category: 'skill',
      archetype: 'beast'
    },

    // -------------------------------------------------------------------------
    // Monster Skills - Dragon (10)
    // -------------------------------------------------------------------------
    monster_fire_breath: {
      path: '/assets/audio/sfx/skills/monster/fire_breath.mp3',
      volume: 0.9,
      category: 'skill',
      archetype: 'dragon'
    },
    monster_frost_breath: {
      path: '/assets/audio/sfx/skills/monster/frost_breath.mp3',
      volume: 0.9,
      category: 'skill',
      archetype: 'dragon'
    },
    monster_lightning_breath: {
      path: '/assets/audio/sfx/skills/monster/lightning_breath.mp3',
      volume: 0.9,
      category: 'skill',
      archetype: 'dragon'
    },
    monster_poison_breath: {
      path: '/assets/audio/sfx/skills/monster/poison_breath.mp3',
      volume: 0.85,
      category: 'skill',
      archetype: 'dragon'
    },
    monster_tail_swipe: {
      path: '/assets/audio/sfx/skills/monster/tail_swipe.mp3',
      volume: 0.85,
      category: 'skill',
      archetype: 'dragon'
    },
    monster_claw_rend: {
      path: '/assets/audio/sfx/skills/monster/claw_rend.mp3',
      volume: 0.85,
      category: 'skill',
      archetype: 'dragon'
    },
    monster_wing_buffet: {
      path: '/assets/audio/sfx/skills/monster/wing_buffet.mp3',
      volume: 0.8,
      category: 'skill',
      archetype: 'dragon'
    },
    monster_crushing_stomp: {
      path: '/assets/audio/sfx/skills/monster/crushing_stomp.mp3',
      volume: 0.9,
      category: 'skill',
      archetype: 'dragon'
    },
    monster_intimidating_roar: {
      path: '/assets/audio/sfx/skills/monster/intimidating_roar.mp3',
      volume: 0.9,
      category: 'skill',
      archetype: 'dragon'
    },

    // -------------------------------------------------------------------------
    // Monster Skills - Undead (7)
    // -------------------------------------------------------------------------
    monster_life_drain: {
      path: '/assets/audio/sfx/skills/monster/life_drain.mp3',
      volume: 0.8,
      category: 'skill',
      archetype: 'undead'
    },
    monster_death_touch: {
      path: '/assets/audio/sfx/skills/monster/death_touch.mp3',
      volume: 0.8,
      category: 'skill',
      archetype: 'undead'
    },
    monster_soul_siphon: {
      path: '/assets/audio/sfx/skills/monster/soul_siphon.mp3',
      volume: 0.8,
      category: 'skill',
      archetype: 'undead'
    },
    monster_wail_of_doom: {
      path: '/assets/audio/sfx/skills/monster/wail_of_doom.mp3',
      volume: 0.85,
      category: 'skill',
      archetype: 'undead'
    },
    monster_bone_shatter: {
      path: '/assets/audio/sfx/skills/monster/bone_shatter.mp3',
      volume: 0.8,
      category: 'skill',
      archetype: 'undead'
    },
    monster_ghoul_bite: {
      path: '/assets/audio/sfx/skills/monster/ghoul_bite.mp3',
      volume: 0.8,
      category: 'skill',
      archetype: 'undead'
    },
    monster_unholy_strike: {
      path: '/assets/audio/sfx/skills/monster/unholy_strike.mp3',
      volume: 0.85,
      category: 'skill',
      archetype: 'undead'
    },

    // -------------------------------------------------------------------------
    // Monster Skills - Elemental (12)
    // -------------------------------------------------------------------------
    monster_flame_burst: {
      path: '/assets/audio/sfx/skills/monster/flame_burst.mp3',
      volume: 0.8,
      category: 'skill',
      archetype: 'elemental'
    },
    monster_fire_nova: {
      path: '/assets/audio/sfx/skills/monster/fire_nova.mp3',
      volume: 0.85,
      category: 'skill',
      archetype: 'elemental'
    },
    monster_immolate: {
      path: '/assets/audio/sfx/skills/monster/immolate.mp3',
      volume: 0.8,
      category: 'skill',
      archetype: 'elemental'
    },
    monster_frost_bolt: {
      path: '/assets/audio/sfx/skills/monster/frost_bolt.mp3',
      volume: 0.8,
      category: 'skill',
      archetype: 'elemental'
    },
    monster_ice_storm: {
      path: '/assets/audio/sfx/skills/monster/ice_storm.mp3',
      volume: 0.85,
      category: 'skill',
      archetype: 'elemental'
    },
    monster_frozen_tomb: {
      path: '/assets/audio/sfx/skills/monster/frozen_tomb.mp3',
      volume: 0.8,
      category: 'skill',
      archetype: 'elemental'
    },
    monster_shock: {
      path: '/assets/audio/sfx/skills/monster/shock.mp3',
      volume: 0.8,
      category: 'skill',
      archetype: 'elemental'
    },
    monster_chain_lightning: {
      path: '/assets/audio/sfx/skills/monster/chain_lightning.mp3',
      volume: 0.85,
      category: 'skill',
      archetype: 'elemental'
    },
    monster_thunderbolt: {
      path: '/assets/audio/sfx/skills/monster/thunderbolt.mp3',
      volume: 0.9,
      category: 'skill',
      archetype: 'elemental'
    },
    monster_rock_throw: {
      path: '/assets/audio/sfx/skills/monster/rock_throw.mp3',
      volume: 0.8,
      category: 'skill',
      archetype: 'elemental'
    },
    monster_earthquake: {
      path: '/assets/audio/sfx/skills/monster/earthquake.mp3',
      volume: 0.9,
      category: 'skill',
      archetype: 'elemental'
    },
    monster_stone_skin: {
      path: '/assets/audio/sfx/skills/monster/stone_skin.mp3',
      volume: 0.75,
      category: 'skill',
      archetype: 'elemental'
    },

    // -------------------------------------------------------------------------
    // Monster Skills - Humanoid (10)
    // -------------------------------------------------------------------------
    monster_slash: {
      path: '/assets/audio/sfx/skills/monster/slash.mp3',
      volume: 0.8,
      category: 'skill',
      archetype: 'humanoid'
    },
    monster_heavy_blow: {
      path: '/assets/audio/sfx/skills/monster/heavy_blow.mp3',
      volume: 0.85,
      category: 'skill',
      archetype: 'humanoid'
    },
    monster_shield_slam: {
      path: '/assets/audio/sfx/skills/monster/shield_slam.mp3',
      volume: 0.85,
      category: 'skill',
      archetype: 'humanoid'
    },
    monster_whirlwind: {
      path: '/assets/audio/sfx/skills/monster/whirlwind.mp3',
      volume: 0.85,
      category: 'skill',
      archetype: 'humanoid'
    },
    monster_arrow_shot: {
      path: '/assets/audio/sfx/skills/monster/arrow_shot.mp3',
      volume: 0.75,
      category: 'skill',
      archetype: 'humanoid'
    },
    monster_poison_arrow: {
      path: '/assets/audio/sfx/skills/monster/poison_arrow.mp3',
      volume: 0.75,
      category: 'skill',
      archetype: 'humanoid'
    },
    monster_volley: {
      path: '/assets/audio/sfx/skills/monster/volley.mp3',
      volume: 0.8,
      category: 'skill',
      archetype: 'humanoid'
    },
    monster_magic_bolt: {
      path: '/assets/audio/sfx/skills/monster/magic_bolt.mp3',
      volume: 0.8,
      category: 'skill',
      archetype: 'humanoid'
    },
    monster_heal_ally: {
      path: '/assets/audio/sfx/skills/monster/heal_ally.mp3',
      volume: 0.75,
      category: 'skill',
      archetype: 'humanoid'
    },
    monster_arcane_blast: {
      path: '/assets/audio/sfx/skills/monster/arcane_blast.mp3',
      volume: 0.85,
      category: 'skill',
      archetype: 'humanoid'
    },

    // -------------------------------------------------------------------------
    // Monster Skills - Construct (5)
    // -------------------------------------------------------------------------
    monster_slam: {
      path: '/assets/audio/sfx/skills/monster/slam.mp3',
      volume: 0.85,
      category: 'skill',
      archetype: 'construct'
    },
    monster_ground_pound: {
      path: '/assets/audio/sfx/skills/monster/ground_pound.mp3',
      volume: 0.9,
      category: 'skill',
      archetype: 'construct'
    },
    monster_boulder_hurl: {
      path: '/assets/audio/sfx/skills/monster/boulder_hurl.mp3',
      volume: 0.9,
      category: 'skill',
      archetype: 'construct'
    },
    monster_overload: {
      path: '/assets/audio/sfx/skills/monster/overload.mp3',
      volume: 0.9,
      category: 'skill',
      archetype: 'construct'
    },
    monster_charge_rush: {
      path: '/assets/audio/sfx/skills/monster/charge_rush.mp3',
      volume: 0.85,
      category: 'skill',
      archetype: 'construct'
    },

    // -------------------------------------------------------------------------
    // Monster Skills - Demon (7)
    // -------------------------------------------------------------------------
    monster_hellfire_bolt: {
      path: '/assets/audio/sfx/skills/monster/hellfire_bolt.mp3',
      volume: 0.85,
      category: 'skill',
      archetype: 'demon'
    },
    monster_infernal_wave: {
      path: '/assets/audio/sfx/skills/monster/infernal_wave.mp3',
      volume: 0.85,
      category: 'skill',
      archetype: 'demon'
    },
    monster_soul_burn: {
      path: '/assets/audio/sfx/skills/monster/soul_burn.mp3',
      volume: 0.8,
      category: 'skill',
      archetype: 'demon'
    },
    monster_rain_of_fire: {
      path: '/assets/audio/sfx/skills/monster/rain_of_fire.mp3',
      volume: 0.9,
      category: 'skill',
      archetype: 'demon'
    },
    monster_corrupt: {
      path: '/assets/audio/sfx/skills/monster/corrupt.mp3',
      volume: 0.8,
      category: 'skill',
      archetype: 'demon'
    },
    monster_shadow_grasp: {
      path: '/assets/audio/sfx/skills/monster/shadow_grasp.mp3',
      volume: 0.8,
      category: 'skill',
      archetype: 'demon'
    },
    monster_doom: {
      path: '/assets/audio/sfx/skills/monster/doom.mp3',
      volume: 0.85,
      category: 'skill',
      archetype: 'demon'
    },

    // -------------------------------------------------------------------------
    // Monster Skills - Insect (5)
    // -------------------------------------------------------------------------
    monster_sting: {
      path: '/assets/audio/sfx/skills/monster/sting.mp3',
      volume: 0.75,
      category: 'skill',
      archetype: 'insect'
    },
    monster_web_shot: {
      path: '/assets/audio/sfx/skills/monster/web_shot.mp3',
      volume: 0.75,
      category: 'skill',
      archetype: 'insect'
    },
    monster_swarm_attack: {
      path: '/assets/audio/sfx/skills/monster/swarm_attack.mp3',
      volume: 0.8,
      category: 'skill',
      archetype: 'insect'
    },
    monster_paralytic_venom: {
      path: '/assets/audio/sfx/skills/monster/paralytic_venom.mp3',
      volume: 0.8,
      category: 'skill',
      archetype: 'insect'
    },
    monster_acid_spray: {
      path: '/assets/audio/sfx/skills/monster/acid_spray.mp3',
      volume: 0.8,
      category: 'skill',
      archetype: 'insect'
    },

    // -------------------------------------------------------------------------
    // Monster Skills - Plant (6)
    // -------------------------------------------------------------------------
    monster_vine_lash: {
      path: '/assets/audio/sfx/skills/monster/vine_lash.mp3',
      volume: 0.75,
      category: 'skill',
      archetype: 'plant'
    },
    monster_entangle: {
      path: '/assets/audio/sfx/skills/monster/entangle.mp3',
      volume: 0.75,
      category: 'skill',
      archetype: 'plant'
    },
    monster_spore_cloud: {
      path: '/assets/audio/sfx/skills/monster/spore_cloud.mp3',
      volume: 0.75,
      category: 'skill',
      archetype: 'plant'
    },
    monster_thorn_burst: {
      path: '/assets/audio/sfx/skills/monster/thorn_burst.mp3',
      volume: 0.8,
      category: 'skill',
      archetype: 'plant'
    },
    monster_life_leech: {
      path: '/assets/audio/sfx/skills/monster/life_leech.mp3',
      volume: 0.75,
      category: 'skill',
      archetype: 'plant'
    },
    monster_regenerate: {
      path: '/assets/audio/sfx/skills/monster/regenerate.mp3',
      volume: 0.7,
      category: 'skill',
      archetype: 'plant'
    }
  },

  // ===========================================================================
  // UI SOUNDS - 24 effects
  // ===========================================================================
  ui: {
    // -------------------------------------------------------------------------
    // Buttons (2)
    // -------------------------------------------------------------------------
    button_click: {
      path: '/assets/audio/sfx/ui/button_click.mp3',
      volume: 0.6,
      category: 'ui',
      subcategory: 'buttons'
    },
    button_hover: {
      path: '/assets/audio/sfx/ui/button_hover.mp3',
      volume: 0.4,
      category: 'ui',
      subcategory: 'buttons'
    },

    // -------------------------------------------------------------------------
    // Navigation (5)
    // -------------------------------------------------------------------------
    menu_open: {
      path: '/assets/audio/sfx/ui/menu_open.mp3',
      volume: 0.6,
      category: 'ui',
      subcategory: 'navigation'
    },
    menu_close: {
      path: '/assets/audio/sfx/ui/menu_close.mp3',
      volume: 0.5,
      category: 'ui',
      subcategory: 'navigation'
    },
    tab_switch: {
      path: '/assets/audio/sfx/ui/tab_switch.mp3',
      volume: 0.55,
      category: 'ui',
      subcategory: 'navigation'
    },
    panel_open: {
      path: '/assets/audio/sfx/ui/panel_open.mp3',
      volume: 0.6,
      category: 'ui',
      subcategory: 'navigation'
    },
    panel_close: {
      path: '/assets/audio/sfx/ui/panel_close.mp3',
      volume: 0.5,
      category: 'ui',
      subcategory: 'navigation'
    },

    // -------------------------------------------------------------------------
    // Feedback (6)
    // -------------------------------------------------------------------------
    error: {
      path: '/assets/audio/sfx/ui/error.mp3',
      volume: 0.65,
      category: 'ui',
      subcategory: 'feedback'
    },
    success: {
      path: '/assets/audio/sfx/ui/success.mp3',
      volume: 0.65,
      category: 'ui',
      subcategory: 'feedback'
    },
    warning: {
      path: '/assets/audio/sfx/ui/warning.mp3',
      volume: 0.65,
      category: 'ui',
      subcategory: 'feedback'
    },
    confirm: {
      path: '/assets/audio/sfx/ui/confirm.mp3',
      volume: 0.65,
      category: 'ui',
      subcategory: 'feedback'
    },
    cancel: {
      path: '/assets/audio/sfx/ui/cancel.mp3',
      volume: 0.55,
      category: 'ui',
      subcategory: 'feedback'
    },

    // -------------------------------------------------------------------------
    // Notifications (6)
    // -------------------------------------------------------------------------
    notification_general: {
      path: '/assets/audio/sfx/ui/notification_general.mp3',
      volume: 0.6,
      category: 'ui',
      subcategory: 'notifications'
    },
    notification_chat: {
      path: '/assets/audio/sfx/ui/notification_chat.mp3',
      volume: 0.55,
      category: 'ui',
      subcategory: 'notifications'
    },
    notification_party: {
      path: '/assets/audio/sfx/ui/notification_party.mp3',
      volume: 0.6,
      category: 'ui',
      subcategory: 'notifications'
    },
    notification_trade: {
      path: '/assets/audio/sfx/ui/notification_trade.mp3',
      volume: 0.6,
      category: 'ui',
      subcategory: 'notifications'
    },
    notification_battle: {
      path: '/assets/audio/sfx/ui/notification_battle.mp3',
      volume: 0.7,
      category: 'ui',
      subcategory: 'notifications'
    },
    notification_guild: {
      path: '/assets/audio/sfx/ui/notification_guild.mp3',
      volume: 0.6,
      category: 'ui',
      subcategory: 'notifications'
    },

    // -------------------------------------------------------------------------
    // Timing (2)
    // -------------------------------------------------------------------------
    countdown_tick: {
      path: '/assets/audio/sfx/ui/countdown_tick.mp3',
      volume: 0.5,
      category: 'ui',
      subcategory: 'timing'
    },
    countdown_complete: {
      path: '/assets/audio/sfx/ui/countdown_complete.mp3',
      volume: 0.7,
      category: 'ui',
      subcategory: 'timing'
    },

    // -------------------------------------------------------------------------
    // Controls (4)
    // -------------------------------------------------------------------------
    toggle_on: {
      path: '/assets/audio/sfx/ui/toggle_on.mp3',
      volume: 0.55,
      category: 'ui',
      subcategory: 'controls'
    },
    toggle_off: {
      path: '/assets/audio/sfx/ui/toggle_off.mp3',
      volume: 0.5,
      category: 'ui',
      subcategory: 'controls'
    },
    scroll: {
      path: '/assets/audio/sfx/ui/scroll.mp3',
      volume: 0.35,
      category: 'ui',
      subcategory: 'controls'
    },
    typing: {
      path: '/assets/audio/sfx/ui/typing.mp3',
      volume: 0.35,
      category: 'ui',
      subcategory: 'controls'
    }
  },

  // ===========================================================================
  // AMBIENT - 8 effects
  // ===========================================================================
  ambient: {
    tavern_chatter: {
      path: '/assets/audio/sfx/ambient/tavern_chatter.mp3',
      volume: 0.5,
      loop: true,
      category: 'ambient',
      nodeType: 'tavern'
    },
    shop_bustle: {
      path: '/assets/audio/sfx/ambient/shop_bustle.mp3',
      volume: 0.5,
      loop: true,
      category: 'ambient',
      nodeType: 'shop'
    },
    fishing_water: {
      path: '/assets/audio/sfx/ambient/fishing_water.mp3',
      volume: 0.5,
      loop: true,
      category: 'ambient',
      nodeType: 'fishing'
    },
    ruins_echoes: {
      path: '/assets/audio/sfx/ambient/ruins_echoes.mp3',
      volume: 0.5,
      loop: true,
      category: 'ambient',
      nodeType: 'ruins'
    },
    forest: {
      path: '/assets/audio/sfx/ambient/forest.mp3',
      volume: 0.5,
      loop: true,
      category: 'ambient',
      region: 'sylvan_reaches'
    },
    cave_drips: {
      path: '/assets/audio/sfx/ambient/cave_drips.mp3',
      volume: 0.5,
      loop: true,
      category: 'ambient',
      region: 'iron_depths'
    },
    mountain_wind: {
      path: '/assets/audio/sfx/ambient/mountain_wind.mp3',
      volume: 0.5,
      loop: true,
      category: 'ambient',
      region: 'bloodplains'
    },
    palace_echoes: {
      path: '/assets/audio/sfx/ambient/palace_echoes.mp3',
      volume: 0.5,
      loop: true,
      category: 'ambient',
      nodeType: 'palace'
    }
  },

  // ===========================================================================
  // INTERACTIONS - 25 effects
  // ===========================================================================
  interactions: {
    // -------------------------------------------------------------------------
    // Equipment (3)
    // -------------------------------------------------------------------------
    equip_weapon: {
      path: '/assets/audio/sfx/interactions/equip_weapon.mp3',
      volume: 0.75,
      category: 'interaction',
      subcategory: 'equipment'
    },
    equip_armor: {
      path: '/assets/audio/sfx/interactions/equip_armor.mp3',
      volume: 0.75,
      category: 'interaction',
      subcategory: 'equipment'
    },
    unequip: {
      path: '/assets/audio/sfx/interactions/unequip.mp3',
      volume: 0.7,
      category: 'interaction',
      subcategory: 'equipment'
    },

    // -------------------------------------------------------------------------
    // Inventory (3)
    // -------------------------------------------------------------------------
    item_pickup: {
      path: '/assets/audio/sfx/interactions/item_pickup.mp3',
      volume: 0.75,
      category: 'interaction',
      subcategory: 'inventory'
    },
    item_drop: {
      path: '/assets/audio/sfx/interactions/item_drop.mp3',
      volume: 0.7,
      category: 'interaction',
      subcategory: 'inventory'
    },
    item_use: {
      path: '/assets/audio/sfx/interactions/item_use.mp3',
      volume: 0.75,
      category: 'interaction',
      subcategory: 'inventory'
    },

    // -------------------------------------------------------------------------
    // Currency (2)
    // -------------------------------------------------------------------------
    gold_gain: {
      path: '/assets/audio/sfx/interactions/gold_gain.mp3',
      volume: 0.75,
      category: 'interaction',
      subcategory: 'currency'
    },
    gold_spend: {
      path: '/assets/audio/sfx/interactions/gold_spend.mp3',
      volume: 0.7,
      category: 'interaction',
      subcategory: 'currency'
    },

    // -------------------------------------------------------------------------
    // Progress (3)
    // -------------------------------------------------------------------------
    quest_complete: {
      path: '/assets/audio/sfx/interactions/quest_complete.mp3',
      volume: 0.8,
      category: 'interaction',
      subcategory: 'progress'
    },
    quest_accept: {
      path: '/assets/audio/sfx/interactions/quest_accept.mp3',
      volume: 0.75,
      category: 'interaction',
      subcategory: 'progress'
    },
    level_up: {
      path: '/assets/audio/sfx/interactions/level_up.mp3',
      volume: 0.85,
      category: 'interaction',
      subcategory: 'progress'
    },

    // -------------------------------------------------------------------------
    // Discovery (3)
    // -------------------------------------------------------------------------
    chest_open: {
      path: '/assets/audio/sfx/interactions/chest_open.mp3',
      volume: 0.8,
      category: 'interaction',
      subcategory: 'discovery'
    },
    shrine_activate: {
      path: '/assets/audio/sfx/interactions/shrine_activate.mp3',
      volume: 0.8,
      category: 'interaction',
      subcategory: 'discovery'
    },
    discovery_found: {
      path: '/assets/audio/sfx/interactions/discovery_found.mp3',
      volume: 0.75,
      category: 'interaction',
      subcategory: 'discovery'
    },

    // -------------------------------------------------------------------------
    // Travel (2)
    // -------------------------------------------------------------------------
    travel_start: {
      path: '/assets/audio/sfx/interactions/travel_start.mp3',
      volume: 0.7,
      category: 'interaction',
      subcategory: 'travel'
    },
    travel_arrive: {
      path: '/assets/audio/sfx/interactions/travel_arrive.mp3',
      volume: 0.75,
      category: 'interaction',
      subcategory: 'travel'
    },

    // -------------------------------------------------------------------------
    // Social (2)
    // -------------------------------------------------------------------------
    party_join: {
      path: '/assets/audio/sfx/interactions/party_join.mp3',
      volume: 0.75,
      category: 'interaction',
      subcategory: 'social'
    },
    party_leave: {
      path: '/assets/audio/sfx/interactions/party_leave.mp3',
      volume: 0.7,
      category: 'interaction',
      subcategory: 'social'
    },

    // -------------------------------------------------------------------------
    // Activities (4)
    // -------------------------------------------------------------------------
    fishing_cast: {
      path: '/assets/audio/sfx/interactions/fishing_cast.mp3',
      volume: 0.75,
      category: 'interaction',
      subcategory: 'activity'
    },
    fishing_reel: {
      path: '/assets/audio/sfx/interactions/fishing_reel.mp3',
      volume: 0.8,
      category: 'interaction',
      subcategory: 'activity'
    },
    fishing_big_one: {
      path: '/assets/audio/sfx/interactions/fishing_big_one.mp3',
      volume: 0.85,
      category: 'interaction',
      subcategory: 'activity'
    },
    puzzle_solve: {
      path: '/assets/audio/sfx/interactions/puzzle_solve.mp3',
      volume: 0.8,
      category: 'interaction',
      subcategory: 'activity'
    },

    // -------------------------------------------------------------------------
    // Movement (1)
    // -------------------------------------------------------------------------
    footstep: {
      path: '/assets/audio/sfx/interactions/footstep.mp3',
      volume: 0.4,
      category: 'interaction',
      subcategory: 'movement'
    },

    // -------------------------------------------------------------------------
    // Matchmaking (2)
    // -------------------------------------------------------------------------
    match_found: {
      path: '/assets/audio/sfx/interactions/match_found.mp3',
      volume: 0.7,
      category: 'interaction',
      subcategory: 'matchmaking'
    },
    gold_receive: {
      path: '/assets/audio/sfx/interactions/gold_receive.mp3',
      volume: 0.6,
      category: 'interaction',
      subcategory: 'currency'
    }
  }
};

// =============================================================================
// PLACEHOLDER CONFIG
// =============================================================================

/**
 * Placeholder audio generator configuration
 * Used when actual audio files are not available
 */
export const PLACEHOLDER_CONFIG = {
  music: {
    // Core tracks
    title_theme: { frequency: 262, type: 'sine', duration: 0.5, silent: true },
    character_select: { frequency: 294, type: 'sine', duration: 0.5, silent: true },
    victory_fanfare: { frequency: 440, type: 'sine', duration: 2, silent: false },
    defeat_jingle: { frequency: 165, type: 'sine', duration: 2, silent: false },
    level_up_fanfare: { frequency: 880, type: 'sine', duration: 0.5, silent: false },
    coliseum_theme: { frequency: 330, type: 'sine', duration: 0.5, silent: true },
    social_hub_theme: { frequency: 247, type: 'sine', duration: 0.5, silent: true },
    guild_advancement: { frequency: 294, type: 'sine', duration: 0.5, silent: true },
    wilderness_ambient: { frequency: 196, type: 'sine', duration: 0.5, silent: true },
    palace_theme: { frequency: 330, type: 'sine', duration: 0.5, silent: true },
    // Regional exploration - all silent (background music)
    heartlands_exploration: { frequency: 294, type: 'sine', duration: 0.5, silent: true },
    sylvan_reaches_exploration: { frequency: 220, type: 'sine', duration: 0.5, silent: true },
    iron_depths_exploration: { frequency: 165, type: 'sine', duration: 0.5, silent: true },
    shadowmere_exploration: { frequency: 247, type: 'sine', duration: 0.5, silent: true },
    bloodplains_exploration: { frequency: 196, type: 'sine', duration: 0.5, silent: true },
    // Battle tracks - all silent (background music)
    heartlands_battle_regular: { frequency: 330, type: 'sawtooth', duration: 0.5, silent: true },
    heartlands_battle_boss: { frequency: 440, type: 'sawtooth', duration: 0.5, silent: true },
    heartlands_battle_pvp: { frequency: 370, type: 'sawtooth', duration: 0.5, silent: true },
    heartlands_battle_story: { frequency: 350, type: 'sawtooth', duration: 0.5, silent: true }
  },
  sfx: {
    // Combat - weapon attacks
    attack_sword_1: { frequency: 200, type: 'square', duration: 0.1, silent: false },
    attack_sword_2: { frequency: 220, type: 'square', duration: 0.1, silent: false },
    attack_sword_3: { frequency: 180, type: 'square', duration: 0.15, silent: false },
    attack_axe_1: { frequency: 150, type: 'square', duration: 0.12, silent: false },
    attack_axe_2: { frequency: 130, type: 'square', duration: 0.15, silent: false },
    attack_bow_1: { frequency: 400, type: 'triangle', duration: 0.2, silent: false },
    attack_bow_2: { frequency: 450, type: 'triangle', duration: 0.25, silent: false },
    attack_fist_1: { frequency: 120, type: 'square', duration: 0.08, silent: false },
    attack_fist_2: { frequency: 140, type: 'square', duration: 0.1, silent: false },
    attack_fist_3: { frequency: 100, type: 'square', duration: 0.12, silent: false },
    // Combat - impacts
    impact_hit: { frequency: 200, type: 'square', duration: 0.1, silent: false },
    impact_critical: { frequency: 800, type: 'sawtooth', duration: 0.15, silent: false },
    impact_miss: { frequency: 100, type: 'triangle', duration: 0.2, silent: false },
    impact_block: { frequency: 300, type: 'square', duration: 0.1, silent: false },
    impact_parry: { frequency: 350, type: 'square', duration: 0.08, silent: false },
    impact_armor: { frequency: 250, type: 'square', duration: 0.1, silent: false },
    // Combat - status effects
    status_burn: { frequency: 600, type: 'sawtooth', duration: 0.3, silent: false },
    status_freeze: { frequency: 800, type: 'sine', duration: 0.3, silent: false },
    status_poison: { frequency: 150, type: 'triangle', duration: 0.4, silent: false },
    status_stun: { frequency: 500, type: 'square', duration: 0.2, silent: false },
    // Skills
    skill_fireball: { frequency: 300, type: 'sawtooth', duration: 0.4, silent: false },
    skill_inferno: { frequency: 250, type: 'sawtooth', duration: 0.6, silent: false },
    skill_ice_shard: { frequency: 600, type: 'sine', duration: 0.3, silent: false },
    skill_blizzard: { frequency: 500, type: 'sine', duration: 0.5, silent: false },
    skill_lightning_bolt: { frequency: 800, type: 'sawtooth', duration: 0.2, silent: false },
    skill_chain_lightning: { frequency: 700, type: 'sawtooth', duration: 0.4, silent: false },
    // Deaths
    player_ko: { frequency: 150, type: 'sine', duration: 0.5, silent: false },
    enemy_death_beast: { frequency: 200, type: 'sawtooth', duration: 0.4, silent: false },
    enemy_death_humanoid: { frequency: 180, type: 'square', duration: 0.3, silent: false },
    enemy_death_undead: { frequency: 100, type: 'triangle', duration: 0.5, silent: false }
  },
  ui: {
    button_click: { frequency: 800, type: 'square', duration: 0.05, silent: false },
    button_hover: { frequency: 600, type: 'sine', duration: 0.03, silent: false },
    menu_open: { frequency: 400, type: 'sine', duration: 0.1, silent: false },
    menu_close: { frequency: 300, type: 'sine', duration: 0.1, silent: false },
    tab_switch: { frequency: 500, type: 'sine', duration: 0.05, silent: false },
    panel_open: { frequency: 450, type: 'sine', duration: 0.1, silent: false },
    panel_close: { frequency: 350, type: 'sine', duration: 0.08, silent: false },
    error: { frequency: 150, type: 'sawtooth', duration: 0.2, silent: false },
    success: { frequency: 660, type: 'sine', duration: 0.15, silent: false },
    warning: { frequency: 350, type: 'sawtooth', duration: 0.15, silent: false },
    confirm: { frequency: 550, type: 'sine', duration: 0.1, silent: false },
    cancel: { frequency: 250, type: 'triangle', duration: 0.1, silent: false },
    notification_general: { frequency: 550, type: 'sine', duration: 0.1, silent: false },
    notification_chat: { frequency: 500, type: 'sine', duration: 0.08, silent: false },
    notification_party: { frequency: 600, type: 'sine', duration: 0.1, silent: false },
    notification_trade: { frequency: 580, type: 'sine', duration: 0.1, silent: false },
    notification_battle: { frequency: 700, type: 'square', duration: 0.12, silent: false },
    notification_guild: { frequency: 520, type: 'sine', duration: 0.1, silent: false },
    countdown_tick: { frequency: 400, type: 'square', duration: 0.05, silent: false },
    countdown_complete: { frequency: 800, type: 'sine', duration: 0.2, silent: false },
    toggle_on: { frequency: 600, type: 'sine', duration: 0.05, silent: false },
    toggle_off: { frequency: 400, type: 'sine', duration: 0.05, silent: false },
    scroll: { frequency: 300, type: 'triangle', duration: 0.03, silent: false },
    typing: { frequency: 500, type: 'square', duration: 0.02, silent: false }
  },
  ambient: {
    tavern_chatter: { frequency: 200, type: 'sine', duration: 0.5, silent: true },
    shop_bustle: { frequency: 220, type: 'sine', duration: 0.5, silent: true },
    fishing_water: { frequency: 180, type: 'sine', duration: 0.5, silent: true },
    ruins_echoes: { frequency: 150, type: 'sine', duration: 0.5, silent: true },
    forest: { frequency: 190, type: 'sine', duration: 0.5, silent: true },
    cave_drips: { frequency: 160, type: 'sine', duration: 0.5, silent: true },
    mountain_wind: { frequency: 140, type: 'sine', duration: 0.5, silent: true },
    palace_echoes: { frequency: 200, type: 'sine', duration: 0.5, silent: true }
  },
  interactions: {
    equip_weapon: { frequency: 350, type: 'square', duration: 0.15, silent: false },
    equip_armor: { frequency: 300, type: 'square', duration: 0.2, silent: false },
    unequip: { frequency: 280, type: 'triangle', duration: 0.12, silent: false },
    item_pickup: { frequency: 600, type: 'sine', duration: 0.1, silent: false },
    item_drop: { frequency: 400, type: 'triangle', duration: 0.1, silent: false },
    item_use: { frequency: 500, type: 'sine', duration: 0.15, silent: false },
    gold_gain: { frequency: 800, type: 'sine', duration: 0.15, silent: false },
    gold_spend: { frequency: 600, type: 'triangle', duration: 0.12, silent: false },
    quest_complete: { frequency: 880, type: 'sine', duration: 0.4, silent: false },
    quest_accept: { frequency: 660, type: 'sine', duration: 0.2, silent: false },
    level_up: { frequency: 880, type: 'sine', duration: 0.5, silent: false },
    chest_open: { frequency: 400, type: 'square', duration: 0.2, silent: false },
    shrine_activate: { frequency: 700, type: 'sine', duration: 0.3, silent: false },
    discovery_found: { frequency: 600, type: 'sine', duration: 0.2, silent: false },
    travel_start: { frequency: 350, type: 'triangle', duration: 0.15, silent: false },
    travel_arrive: { frequency: 500, type: 'sine', duration: 0.15, silent: false },
    party_join: { frequency: 550, type: 'sine', duration: 0.15, silent: false },
    party_leave: { frequency: 400, type: 'triangle', duration: 0.12, silent: false },
    fishing_cast: { frequency: 300, type: 'triangle', duration: 0.2, silent: false },
    fishing_reel: { frequency: 400, type: 'triangle', duration: 0.25, silent: false },
    fishing_big_one: { frequency: 700, type: 'square', duration: 0.2, silent: false },
    puzzle_solve: { frequency: 660, type: 'sine', duration: 0.25, silent: false },
    // Movement
    footstep: { frequency: 100, type: 'triangle', duration: 0.05, silent: false },
    // Matchmaking
    match_found: { frequency: 880, type: 'sine', duration: 0.3, silent: false },
    gold_receive: { frequency: 700, type: 'sine', duration: 0.15, silent: false }
  },
  sfx: {
    // Turn indicators
    turn_start: { frequency: 600, type: 'sine', duration: 0.15, silent: false },
    enemy_turn: { frequency: 350, type: 'triangle', duration: 0.12, silent: false }
  }
};

// =============================================================================
// AUDIO ASSETS CLASS
// =============================================================================

/**
 * AudioAssets - Handles loading and caching of audio assets
 */
export class AudioAssets {
  constructor(audioContext) {
    this.context = audioContext;
    this.bufferCache = new Map();
    this.loadingPromises = new Map();
    this.usePlaceholders = true; // Use generated placeholders by default
  }

  /**
   * Get audio asset configuration
   * @param {string} category - 'music', 'sfx', 'ui', 'ambient', or 'interactions'
   * @param {string} id - Asset identifier
   * @returns {Object|null} Asset configuration
   */
  getAssetConfig(category, id) {
    return AUDIO_MANIFEST[category]?.[id] || null;
  }

  /**
   * Load an audio file into a buffer
   * @param {string} path - Path to audio file
   * @returns {Promise<AudioBuffer>}
   */
  async loadAudioBuffer(path) {
    // Check cache
    if (this.bufferCache.has(path)) {
      return this.bufferCache.get(path);
    }

    // Check if already loading
    if (this.loadingPromises.has(path)) {
      return this.loadingPromises.get(path);
    }

    // Start loading
    const loadPromise = this._fetchAndDecode(path);
    this.loadingPromises.set(path, loadPromise);

    try {
      const buffer = await loadPromise;
      this.bufferCache.set(path, buffer);
      this.loadingPromises.delete(path);
      return buffer;
    } catch (error) {
      this.loadingPromises.delete(path);
      throw error;
    }
  }

  /**
   * Fetch and decode audio file
   * @private
   */
  async _fetchAndDecode(path) {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Failed to load audio: ${path}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return this.context.decodeAudioData(arrayBuffer);
  }

  /**
   * Get or generate audio buffer for an asset
   * @param {string} category - Asset category
   * @param {string} id - Asset identifier
   * @param {number} [variation] - Optional variation index
   * @returns {Promise<AudioBuffer>}
   */
  async getBuffer(category, id, variation = null) {
    const config = this.getAssetConfig(category, id);
    if (!config) {
      console.warn(`Unknown audio asset: ${category}/${id}`);
      return this.generatePlaceholder(category, id);
    }

    let path = config.path;

    // Handle variations
    if (variation !== null && config.variations) {
      const ext = path.substring(path.lastIndexOf('.'));
      const base = path.substring(0, path.lastIndexOf('.'));
      path = `${base}_${variation}${ext}`;
    }

    try {
      // Try to load actual audio file
      return await this.loadAudioBuffer(path);
    } catch (error) {
      // Fall back to placeholder
      if (this.usePlaceholders) {
        console.debug(`Using placeholder for ${category}/${id}: ${error.message}`);
        return this.generatePlaceholder(category, id);
      }
      throw error;
    }
  }

  /**
   * Generate a placeholder audio buffer using oscillator
   * @param {string} category - Asset category
   * @param {string} id - Asset identifier
   * @returns {AudioBuffer}
   */
  generatePlaceholder(category, id) {
    const cacheKey = `placeholder:${category}/${id}`;
    if (this.bufferCache.has(cacheKey)) {
      return this.bufferCache.get(cacheKey);
    }

    const config = PLACEHOLDER_CONFIG[category]?.[id] || {
      frequency: 440,
      type: 'sine',
      duration: 0.1,
      silent: false
    };

    const sampleRate = this.context.sampleRate;
    const duration = config.duration;
    const numSamples = Math.floor(sampleRate * duration);
    const buffer = this.context.createBuffer(1, numSamples, sampleRate);
    const channelData = buffer.getChannelData(0);

    if (config.silent) {
      // Generate silence for background music placeholders
      for (let i = 0; i < numSamples; i++) {
        channelData[i] = 0;
      }
    } else {
      // Generate a simple tone with envelope
      const frequency = config.frequency;
      const attackTime = 0.01;
      const releaseTime = Math.min(0.1, duration * 0.3);
      const attackSamples = Math.floor(sampleRate * attackTime);
      const releaseSamples = Math.floor(sampleRate * releaseTime);

      for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        let sample;

        // Generate waveform based on type
        switch (config.type) {
          case 'square':
            sample = Math.sin(2 * Math.PI * frequency * t) > 0 ? 0.3 : -0.3;
            break;
          case 'sawtooth':
            sample = 0.3 * (2 * ((frequency * t) % 1) - 1);
            break;
          case 'triangle':
            sample = 0.4 * (2 * Math.abs(2 * ((frequency * t) % 1) - 1) - 1);
            break;
          case 'sine':
          default:
            sample = 0.4 * Math.sin(2 * Math.PI * frequency * t);
        }

        // Apply envelope (attack and release)
        let envelope = 1;
        if (i < attackSamples) {
          envelope = i / attackSamples;
        } else if (i > numSamples - releaseSamples) {
          envelope = (numSamples - i) / releaseSamples;
        }

        channelData[i] = sample * envelope;
      }
    }

    this.bufferCache.set(cacheKey, buffer);
    return buffer;
  }

  /**
   * Preload all assets in a category
   * @param {string} category - 'music', 'sfx', 'ui', 'ambient', or 'interactions'
   * @returns {Promise<void>}
   */
  async preloadCategory(category) {
    const assets = AUDIO_MANIFEST[category];
    if (!assets) return;

    const promises = Object.keys(assets).map(id =>
      this.getBuffer(category, id).catch(err => {
        console.warn(`Failed to preload ${category}/${id}:`, err.message);
      })
    );

    await Promise.allSettled(promises);
    console.log(`Preloaded ${Object.keys(assets).length} ${category} assets`);
  }

  /**
   * Preload specific assets
   * @param {Array<{category: string, id: string}>} assets - Assets to preload
   */
  async preload(assets) {
    const promises = assets.map(({ category, id }) =>
      this.getBuffer(category, id).catch(err => {
        console.warn(`Failed to preload ${category}/${id}:`, err.message);
      })
    );

    await Promise.allSettled(promises);
  }

  /**
   * Preload assets for a specific region
   * @param {string} region - Region ID
   * @returns {Promise<void>}
   */
  async preloadRegion(region) {
    const assets = [];

    // Regional music
    for (const nodeType of NODE_TYPES) {
      const key = getRegionalMusicKey(region, nodeType);
      if (AUDIO_MANIFEST.music[key]) {
        assets.push({ category: 'music', id: key });
      }
    }

    // Battle music
    for (const battleType of BATTLE_TYPES) {
      const key = getBattleMusicKey(region, battleType);
      if (AUDIO_MANIFEST.music[key]) {
        assets.push({ category: 'music', id: key });
      }
    }

    await this.preload(assets);
    console.log(`Preloaded ${assets.length} assets for region: ${region}`);
  }

  /**
   * Clear audio buffer cache
   */
  clearCache() {
    this.bufferCache.clear();
    this.loadingPromises.clear();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      cachedBuffers: this.bufferCache.size,
      loading: this.loadingPromises.size,
      totalManifestEntries: {
        music: Object.keys(AUDIO_MANIFEST.music).length,
        sfx: Object.keys(AUDIO_MANIFEST.sfx).length,
        ui: Object.keys(AUDIO_MANIFEST.ui).length,
        ambient: Object.keys(AUDIO_MANIFEST.ambient).length,
        interactions: Object.keys(AUDIO_MANIFEST.interactions).length
      }
    };
  }
}
