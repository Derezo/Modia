/**
 * Music Manifest - 55 tracks
 * Core tracks, regional exploration, and battle music
 */

export const MUSIC_MANIFEST = {
  // -------------------------------------------------------------------------
  // Core tracks (10)
  // -------------------------------------------------------------------------
  title_theme: {
    path: '/assets/audio/music/core/title_theme_short.mp3',
    volume: 0.8,
    loop: false,
    fadeIn: 500,
    fadeOut: 1000,
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
};
