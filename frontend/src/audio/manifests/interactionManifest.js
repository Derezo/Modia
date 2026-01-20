/**
 * Interaction Sound Manifest - 25 effects
 * Equipment, inventory, and game interaction sounds
 */

export const INTERACTION_MANIFEST = {
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
};
