/**
 * World Generation Constants
 *
 * Centralized configuration for the 6-phase regional world generation system.
 * All CONFIG objects and constants used across worldgen phases.
 */

// Connection count constraints for world generation
export const MIN_CONNECTIONS = {
  castle: 5,
  city: 3,
  village: 2,
  guild: 2,
  farm: 2,
  forest: 2,
  cave: 2,
  mountain: 2,
  bridge: 2,
  // Activity nodes - typically 2-3 connections
  fishing_spot: 2,
  merchant_caravan: 2,
  ruins: 2,
  watchtower: 2,
  // Low-degree reward sites retain one or two connections.
  chest: 1,
  shrine: 1,
  discovery: 1
};

export const MAX_CONNECTIONS = {
  bridge: 2,  // Bridges act as chokepoints with exactly 2 connections
  watchtower: 3,  // Watchtowers can have a few connections but not many
  // Reward sites may sit on a route; only a configured minority are dead ends.
  chest: 2,
  shrine: 2,
  discovery: 2
};

// Obstacle types for terrain barriers
export const OBSTACLE_TYPES = {
  LAKE: 'lake',
  MOUNTAIN_RANGE: 'mountain_range',
  DENSE_FOREST: 'dense_forest'
};

// Node name generation data
export const NODE_NAME_PREFIXES = {
  city: ['New', 'Old', 'Port', 'Fort', 'North', 'South', 'East', 'West'],
  village: ['Little', 'Green', 'Quiet', 'Sunny', 'Misty', 'Hidden'],
  farm: ['Golden', 'Green', 'Old', 'Sunny', 'Hillside', 'River'],
  forest: ['Dark', 'Ancient', 'Whispering', 'Emerald', 'Twisted', 'Silent'],
  cave: ['Crystal', 'Shadow', 'Echo', 'Deep', 'Forgotten', 'Frost'],
  mountain: ['Storm', 'Iron', 'Snow', 'Thunder', 'Sky', 'Fire'],
  bridge: ['Stone', 'Hanging', 'Old', 'Broken', 'King\'s', 'Troll'],
  guild: ['Warriors\'', 'Wizards\'', 'Monks\'', 'Chemists\''],
  fishing_spot: ['Quiet', 'Abundant', 'Lucky', 'Shimmering', 'Deep', 'Silver'],
  merchant_caravan: ['Wandering', 'Exotic', 'Traveling', 'Fortune', 'Lucky', 'Golden'],
  ruins: ['Ancient', 'Forgotten', 'Crumbling', 'Lost', 'Haunted', 'Overgrown'],
  watchtower: ['High', 'Lone', 'Storm', 'Border', 'Eagle', 'Sentinel'],
  chest: ['Hidden', 'Ancient', 'Lost', 'Forgotten', 'Buried', 'Legendary'],
  shrine: ['Sacred', 'Ancient', 'Mystic', 'Holy', 'Blessed', 'Divine'],
  discovery: ['Ruined', 'Ancient', 'Lost', 'Forgotten', 'Mysterious', 'Legendary']
};

export const NODE_NAME_SUFFIXES = {
  city: ['Haven', 'Gate', 'Hold', 'Watch', 'Keep', 'Port'],
  village: ['Hollow', 'Dell', 'Crossing', 'Rest', 'Vale', 'Hamlet'],
  farm: ['Farm', 'Fields', 'Meadow', 'Ranch', 'Homestead', 'Acres'],
  forest: ['Woods', 'Grove', 'Thicket', 'Wilds', 'Depths', 'Glade'],
  cave: ['Caverns', 'Grotto', 'Depths', 'Tunnels', 'Lair', 'Mine'],
  mountain: ['Peak', 'Summit', 'Crag', 'Ridge', 'Heights', 'Pass'],
  bridge: ['Crossing', 'Pass', 'Span', 'Way', 'Arch', 'Ford'],
  guild: ['Hall', 'Sanctum', 'Lodge', 'Academy', 'Tower', 'Keep'],
  fishing_spot: ['Pool', 'Bend', 'Shallows', 'Waters', 'Cove', 'Bank'],
  merchant_caravan: ['Caravan', 'Traders', 'Market', 'Bazaar', 'Exchange', 'Camp'],
  ruins: ['Ruins', 'Remains', 'Citadel', 'Fortress', 'Temple', 'Keep'],
  watchtower: ['Tower', 'Spire', 'Lookout', 'Watchtower', 'Perch', 'Keep'],
  chest: ['Trove', 'Cache', 'Hoard', 'Vault', 'Treasury', 'Bounty'],
  shrine: ['Altar', 'Sanctum', 'Temple', 'Monument', 'Obelisk', 'Pillar'],
  discovery: ['Ruins', 'Monument', 'Archive', 'Relic', 'Artifact', 'Mystery']
};

// Trade Route Node Names - mix of commerce, journey, and destination themes
export const TRADE_ROUTE_NAMES = {
  commerce: [
    'Merchant\'s Rest', 'Trader\'s Crossing', 'Caravan Camp', 'Peddler\'s Way',
    'Bargain Bend', 'Haggler\'s Haven', 'Coin Counter\'s Rest', 'Market Waypoint',
    'Spice Road Station', 'Silk Route Camp', 'Gold Dust Stop', 'Barter\'s End'
  ],
  journey: [
    'Wayfarer\'s Glen', 'Traveler\'s Rest', 'Pilgrim\'s Path', 'Wanderer\'s Watch',
    'Road\'s End Camp', 'Mile Marker Hollow', 'Journey\'s Pause', 'Passage Point',
    'Sojourner\'s Shade', 'Drifter\'s Dell', 'Nomad\'s Nook', 'Rambler\'s Refuge'
  ],
  destination: [
    'Midway Station', 'Border Market', 'Crossroads Camp', 'Halfway House',
    'Twin Realms Rest', 'Realm\'s Edge Trading Post', 'Frontier Exchange',
    'Junction Dell', 'Borderland Bazaar', 'Treaty Grounds', 'Alliance Market'
  ]
};

// Wilderness Zone Node Names - dangerous/wild themes
export const WILDERNESS_ZONE_NAMES = {
  dangerous: [
    'Bandit\'s Hollow', 'Outlaw Pass', 'Lawless Woods', 'Rogue\'s Den',
    'Cutthroat Canyon', 'Brigand\'s Bluff', 'Marauder\'s Mark', 'Smuggler\'s Run',
    'Raider\'s Rest', 'Highwayman\'s Haunt', 'Thief\'s Thicket', 'Pillager\'s Path'
  ],
  wild: [
    'Untamed Wilds', 'Savage Reach', 'Feral Depths', 'Primal Grove',
    'Beast\'s Domain', 'Hunter\'s Peril', 'Predator\'s Trail', 'Wild Frontier',
    'Fang & Claw Pass', 'Howling Wastes', 'Stalker\'s Territory', 'Apex Hunting Grounds'
  ],
  ominous: [
    'No Man\'s Land', 'Forgotten Frontier', 'Border Badlands', 'Contested Ground',
    'Disputed Territory', 'Unclaimed Wastes', 'The Disputed Reach', 'Forsaken Border',
    'Twilight Zone', 'Shadowlands Edge', 'The Blighted Pass', 'War-Torn Crossing'
  ]
};

export const PALACE_FEATURES = ['throne_room', 'treasury', 'royal_guard'];

// ============================================================================
// PHASE 1: Castle Placement
// ============================================================================

export const CASTLE_PLACEMENT = {
  MIN_DISTANCE: 25,           // Minimum distance between any two castles
  POSITION_RANGE: 30,         // Castles spawn in [-30, 30] range
  FORCE_MAX_ITERATIONS: 500,  // Max iterations for force-directed simulation
  FORCE_REPULSION: 3.0,       // Repulsion force strength multiplier
  FORCE_DAMPING: 0.95,        // Velocity damping to prevent oscillation
  LLOYD_ITERATIONS: 3,        // Number of Lloyd's relaxation iterations
  LLOYD_STRENGTH: 0.2,        // How strongly points move toward centroid (0-1)
  BOUNDARY_PADDING: 2         // Keep castles this far from edge
};

// ============================================================================
// PHASE 2: Voronoi Partitioning
// ============================================================================

export const VORONOI_CONFIG = {
  WORLD_BOUNDS: [-50, -50, 50, 50],  // [xMin, yMin, xMax, yMax] - larger than castle range
  MIN_VERTEX_DISTANCE: 5,            // Minimum distance between vertices
  CENTER_THRESHOLD: 5                // Distance from center to consider as "center"
};

// ============================================================================
// PHASE 3: Internal Node Generation
// ============================================================================

export const REGION_NODE_CONFIG = {
  MIN_SPACING: 3.5,                    // Minimum distance between nodes (Poisson disk)
  TARGET_NODES_PER_REGION: 70,         // Target ~60-80 nodes per region
  MAX_POISSON_ATTEMPTS: 30,            // Attempts per active point in Poisson disk
  CITY_COUNT_MIN: 2,
  CITY_COUNT_MAX: 3,
  VILLAGE_COUNT_MIN: 6,
  VILLAGE_COUNT_MAX: 10,
  KEEP_COUNT: 1,
  GUILD_COUNT: 3,                      // 3 guilds per region (1 primary + 2 secondary)
  // Distance bands from castle (Euclidean proxy for ring assignment)
  RING_0_MAX_DIST: 5,                  // Guard battle nodes only
  RING_1_MAX_DIST: 12,                 // Cities, villages, primary guild
  RING_2_MAX_DIST: 20,                 // Keep, secondary guilds, villages, battle
  // Beyond RING_2: Ring 3 - battle nodes, reward-site candidates, watchtowers
};

// ============================================================================
// PHASE 4: Internal Connections
// ============================================================================

export const CONNECTION_CONFIG = {
  EXTRA_CONNECTION_RATIO: 0.20,        // 20% extra connections beyond MST
  MAX_CONNECTION_DISTANCE: 12,         // Maximum edge distance for extra connections
  INVALID_PENALTY: 10000,              // Cost multiplier for invalid connections in MST
  RING_THRESHOLDS: {
    RING_1: 2,                         // 1-2 hops from castle = Ring 1
    RING_2: 5,                         // 3-5 hops from castle = Ring 2
    // 6+ hops = Ring 3
  }
};

// ============================================================================
// PHASE 5: Inter-Region Connections
// ============================================================================

export const INTER_REGION_CONFIG = {
  // Border length thresholds for connection type determination
  BORDER_SHORT_THRESHOLD: 10,          // < 10 = bridge only
  BORDER_MEDIUM_THRESHOLD: 20,         // 10-20 = bridge + wilderness
  // >= 20 = bridge + wilderness + trade route

  // Wilderness zone settings
  WILDERNESS_MIN_NODES: 2,
  WILDERNESS_MAX_NODES: 4,
  WILDERNESS_SPACING: 4.0,             // Distance between wilderness nodes
  WILDERNESS_DIFFICULTY_BONUS: 1,      // Higher difficulty tier for border conflicts

  // Trade route settings
  TRADE_ROUTE_MIN_NODES: 3,
  TRADE_ROUTE_MAX_NODES: 5,
  TRADE_ROUTE_DIFFICULTY_REDUCTION: 1, // Lower difficulty for trade routes

  // Node connection settings
  MAX_FRONTIER_SEARCH_DIST: 15,        // Max distance to search for frontier nodes

  // Maximum distance between ANY connected nodes (400px = 13.3 units)
  // 1 unit = 30 pixels in world coordinate system
  MAX_NODE_SPACING: 13.3,

  // When creating intermediate nodes, target this spacing
  // ~300px provides safe margin under the 400px max
  INTERMEDIATE_SPACING: 10,
};

// Thematic bridge names based on region pairs
// Keys are sorted region names joined with '-'
export const BRIDGE_NAMES = {
  'Bloodplains-Heartlands': ['Border Crossing', 'War\'s End Bridge', 'Truce Span'],
  'Bloodplains-Iron Depths': ['Forge Pass', 'Iron Bridge', 'Anvil Crossing'],
  'Bloodplains-Shadowmere': ['Blood Moon Bridge', 'Crimson Crossing', 'Dusk Span'],
  'Bloodplains-Sylvan Reaches': ['Wildwood Bridge', 'Thorn Crossing', 'Hunter\'s Pass'],
  'Heartlands-Iron Depths': ['Deep Road Bridge', 'Mine Gate', 'Merchant\'s Crossing'],
  'Heartlands-Shadowmere': ['Twilight Bridge', 'Shadow\'s Edge', 'Dawn Crossing'],
  'Heartlands-Sylvan Reaches': ['Woodland Bridge', 'Green Gate', 'Forest Crossing'],
  'Iron Depths-Shadowmere': ['Darkmine Bridge', 'Hollow Crossing', 'Echo Pass'],
  'Iron Depths-Sylvan Reaches': ['Rootstone Bridge', 'Elder Crossing', 'Deep Green Pass'],
  'Shadowmere-Sylvan Reaches': ['Twilight Crossing', 'Moon Bridge', 'Dusk Gate']
};

// ============================================================================
// PHASE 6: Validation & Cleanup
// ============================================================================

export const PHASE6_CONFIG = {
  // Terminator distribution: 30% chest, 30% shrine, 40% discovery
  TERMINATOR_CHEST_RATIO: 0.30,
  TERMINATOR_SHRINE_RATIO: 0.30,
  // Note: Discovery gets the remainder (40%)

  // Shrine buff types available (legacy terminator shrines)
  SHRINE_BUFF_TYPES: ['stamina_regen', 'exp_bonus', 'gold_bonus'],

  // Minimum ring distance for terminators
  MIN_RING_FOR_TERMINATOR: 3,

  // Target reward-site percentage of total nodes
  TARGET_TERMINATOR_RATIO: 0.06,

  // A small minority of reward sites may remain true dead ends.
  TERMINATOR_DEAD_END_RATIO: 0.15
};

export const FINALIZED_WORLD_DOMAINS = Object.freeze({
  DIFFICULTY_TIER: Object.freeze({ MIN: 1, MAX: 5 }),
  REGIONAL_RING_DISTANCES: Object.freeze([0, 1, 2, 3]),
  INTER_REGION_RING_DISTANCE: 4,
  PALACE_RING_DISTANCE: 5
});

export const OPENING_PROGRESSION_CONFIG = Object.freeze({
  APPROVED_SAFE_TYPES: Object.freeze(['castle', 'city', 'village', 'guild', 'keep', 'farm']),
  DESIGNATED_DESTINATION_TYPES: Object.freeze(['city', 'village', 'guild', 'keep']),
  MAX_GENERATION_ATTEMPTS: 16,
  MAX_SAFE_COMPONENT_SIZE: 8,
  REQUIRED_BOUNDARY_TIER: 1
});

// ============================================================================
// GUILD CONFIGURATION
// ============================================================================

export const GUILD_CONFIG = {
  PER_REGION: 3,                          // 3 guilds per region
  TYPES: ['warrior', 'wizard', 'monk', 'chemist'],

  // Race to primary guild type mapping (guild near castle should match race)
  RACE_PRIMARY_GUILD: {
    'orc': 'warrior',
    'elf': 'wizard',
    'human': 'monk',
    'dwarf': 'chemist',
    'vampire': 'wizard'                   // Vampires favor wizard guild (magic affinity)
  },

  // Distance constraints
  RING_1_REQUIRED: true,                  // Primary guild must be in Ring 1 (near castle)
  RING_2_3_COUNT: 2,                      // 2 secondary guilds in outer rings
  MIN_GUILD_SPACING: 8,                   // Minimum distance between guilds in same region

  // Global same-type spacing (prevent wizard guilds from clustering)
  // 40 units is geometrically achievable with current world layout (castles ~25 units apart)
  // Still prevents same-type guilds in immediately adjacent regions
  MIN_SAME_TYPE_SPACING: 40,
  GLOBAL_MAX_PER_TYPE: 4,                 // Max 4 of each guild type worldwide
  GLOBAL_MIN_PER_TYPE: 3,                 // Min 3 of each guild type worldwide

  // Validation settings
  VALIDATION_ENABLED: true,
  WARN_ON_SAME_TYPE_SPACING: true         // Log warning if spacing violated
};

// ============================================================================
// NODE DISTRIBUTION TARGETS
// ============================================================================

export const NODE_DISTRIBUTION = {
  // Target percentages (should sum to ~1.0 excluding settlements which are fixed)
  BATTLE_PERCENT: { min: 0.40, max: 0.50 },
  ACTIVITY_PERCENT: { min: 0.20, max: 0.30 },
  // This is a total-activity safety floor, not a per-type quota. The normal
  // percentage target is authoritative whenever the region has enough nodes.
  ACTIVITY_FLOOR_PER_REGION: 3,
  // Settlements make up the remainder

  // Battle node types
  BATTLE_TYPES: ['forest', 'cave', 'mountain'],

  // Activity/neutral node types (non-blocking progression)
  ACTIVITY_TYPES: ['fishing_spot', 'merchant_caravan', 'ruins'],

  // Settlement types
  SETTLEMENT_TYPES: ['castle', 'city', 'village', 'guild', 'keep', 'farm'],

  // Farm placement
  FARM_COUNT_MIN: 2,
  FARM_COUNT_MAX: 4,
  FARM_MIN_RING: 2                        // Farms not too close to castle
};

/**
 * Conditional activity-type shares. These weights are applied only after the
 * density logic has selected an activity node, so regional flavor cannot
 * inflate or suppress the overall activity count.
 */
export const REGIONAL_ACTIVITY_PROFILES = Object.freeze({
  human: Object.freeze({
    fishing_spot: 0.30,
    merchant_caravan: 0.45,
    ruins: 0.25
  }),
  elf: Object.freeze({
    fishing_spot: 0.50,
    merchant_caravan: 0.15,
    ruins: 0.35
  }),
  dwarf: Object.freeze({
    fishing_spot: 0.15,
    merchant_caravan: 0.40,
    ruins: 0.45
  }),
  vampire: Object.freeze({
    fishing_spot: 0.15,
    merchant_caravan: 0.25,
    ruins: 0.60
  }),
  orc: Object.freeze({
    fishing_spot: 0.20,
    merchant_caravan: 0.45,
    ruins: 0.35
  })
});

// ============================================================================
// TERRAIN ANTI-CLUSTERING CONFIGURATION
// ============================================================================

/**
 * Prevents battle node type clustering (too many caves/forests/mountains together).
 * Uses neighbor-aware selection during assignment and post-validation.
 */
export const TERRAIN_ANTI_CLUSTERING = {
  ENABLED: true,

  // Selection phase: check nodes within this distance for same-type neighbors
  ANTI_CLUSTER_RADIUS: 5.0,

  // Reduce dominant terrain weight by this factor per same-type neighbor found
  // With 2 neighbors at 0.4 penalty each: 0.70 * 0.6 * 0.6 = 0.252 (vs base 0.70)
  SAME_TYPE_PENALTY: 0.4,

  // Hard cap: if this many same-type nodes are within radius, force different type
  MAX_SAME_TYPE_NEARBY: 2,

  // Validation phase settings
  VALIDATION_ENABLED: true,
  MAX_CLUSTER_SIZE: 3,                    // Max same-type nodes within N hops before flagging
  CLUSTER_HOP_DISTANCE: 1,                // Check within this many graph hops (aligns with ANTI_CLUSTER_RADIUS)

  // Preserve regional identity: don't drop below this dominant ratio
  MIN_DOMINANT_RATIO: 0.55,

  // Optional: post-process fix to auto-reassign peripheral cluster nodes
  POST_PROCESS_FIX: false                 // Disabled by default - just log warnings
};

// ============================================================================
// ZODIAC SHRINE CONFIGURATION
// ============================================================================

export const ZODIAC_CONFIG = {
  // 12 zodiac types - one shrine of each type in the world
  ZODIAC_TYPES: [
    'aries', 'taurus', 'gemini', 'cancer',
    'leo', 'virgo', 'libra', 'scorpio',
    'sagittarius', 'capricorn', 'aquarius', 'pisces'
  ],

  // Placement rules
  MIN_RING: 2,                            // Away from castles (outer areas)
  MIN_SPACING: 15,                        // Spread evenly across world
  PER_WORLD: 12,                          // One of each (12 total)

  // Zodiac shrine names
  SHRINE_NAMES: {
    aries: 'Shrine of the Ram',
    taurus: 'Shrine of the Bull',
    gemini: 'Shrine of the Twins',
    cancer: 'Shrine of the Crab',
    leo: 'Shrine of the Lion',
    virgo: 'Shrine of the Maiden',
    libra: 'Shrine of the Scales',
    scorpio: 'Shrine of the Scorpion',
    sagittarius: 'Shrine of the Archer',
    capricorn: 'Shrine of the Sea-Goat',
    aquarius: 'Shrine of the Water-Bearer',
    pisces: 'Shrine of the Fish'
  }
};

// ============================================================================
// WATCHTOWER CONFIGURATION
// ============================================================================

export const WATCHTOWER_CONFIG = {
  MAX_PER_REGION: 1,                      // Very rare - at most 1 per region
  SPAWN_CHANCE: 0.3,                      // Only 30% chance to spawn
  MIN_RING: 3,                            // Outer rings only
  REVEAL_RADIUS: 2                        // Pixel radius multiplier (base 1500px, so 2 = 3000px reveal)
};

// ============================================================================
// PHASE 4 INTERMEDIATE NODE CONFIGURATION
// ============================================================================

/**
 * Region-specific configuration for intermediate nodes created during Phase 4
 * gap infill. Each region has themed terrain subtypes and unique naming pools.
 *
 * Terrain subtypes map to base types for battle terrain generation but
 * provide visual/thematic variety in the world map.
 */
export const REGION_INTERMEDIATE_CONFIG = {
  heartlands: {
    // Civilized Frontier - Human territory
    terrainWeights: { meadow: 0.4, woodland: 0.35, roadside: 0.25 },
    terrainBaseTypes: { meadow: 'forest', woodland: 'forest', roadside: 'forest' },
    namePool: [
      'Wayfarer\'s Rest', 'Traveler\'s Hollow', 'Shepherd\'s Watch',
      'Border Station', 'Ranger\'s Post', 'Crossroads Camp',
      'Miller\'s Path', 'Harvest Road', 'Homestead Trail',
      'King\'s Mile', 'Merchant\'s Waypoint', 'Farmstead Junction',
      'Fieldstone Pass', 'Haymaker\'s Ridge', 'Cobblestone Crossing',
      'Pilgrim\'s Way', 'Wheelwright\'s Rest', 'Innkeeper\'s Mile',
      'Cooper\'s Trail', 'Baker\'s Path', 'Farrier\'s Rest'
    ]
  },

  sylvan_reaches: {
    // Ancient Woodland - Elf territory
    terrainWeights: { grove: 0.35, glade: 0.35, thicket: 0.30 },
    terrainBaseTypes: { grove: 'forest', glade: 'forest', thicket: 'forest' },
    namePool: [
      'Starlight Glade', 'Moonlit Path', 'Ancient Grove',
      'Whisperwood Trail', 'Silverleaf Crossing', 'Fey\'s Passage',
      'Elder\'s Rest', 'Duskwood Hollow', 'Dewdrop Dell',
      'Sunbeam Clearing', 'Thornveil Path', 'Mistwood Junction',
      'Willowshade Rest', 'Evergreen Crossing', 'Oakenshield Pass',
      'Verdant Way', 'Treesong Path', 'Branchweave Trail',
      'Rootholm Rest', 'Leafshadow Dell', 'Mossglen Hollow'
    ]
  },

  iron_depths: {
    // Underground Network - Dwarf territory
    terrainWeights: { tunnel: 0.40, mineshaft: 0.35, cavern: 0.25 },
    terrainBaseTypes: { tunnel: 'cave', mineshaft: 'cave', cavern: 'cave' },
    namePool: [
      'Deep Tunnel Junction', 'Mine Outpost', 'Stone Passage',
      'Forge Road', 'Anvil Rest', 'Hammer\'s Echo',
      'Gemstone Corridor', 'Iron Vein Crossing', 'Mithril Path',
      'Echoing Hall', 'Lantern Post', 'Ore Cart Station',
      'Pickaxe Pass', 'Smelter\'s Way', 'Bellows Rest',
      'Ingot Trail', 'Crucible Crossing', 'Grindstone Junction',
      'Coal Seam Path', 'Lodestone Rest', 'Veinstone Hollow'
    ]
  },

  shadowmere: {
    // Dark Passages - Vampire territory
    terrainWeights: { crypt: 0.35, shadow_grove: 0.35, mist_hollow: 0.30 },
    terrainBaseTypes: { crypt: 'cave', shadow_grove: 'forest', mist_hollow: 'cave' },
    namePool: [
      'Shadow Crossing', 'Twilight Refuge', 'Night\'s Passage',
      'Bloodmist Hollow', 'Dread Path', 'Whispering Dark',
      'Crypt Entrance', 'Pale Moon Rest', 'Nightshade Trail',
      'Gloom Junction', 'Shroud\'s Edge', 'Phantom\'s Way',
      'Veil\'s End Rest', 'Darksong Path', 'Wraithgate Crossing',
      'Sorrow\'s Trail', 'Murkwater Pass', 'Tombstone Junction',
      'Raven\'s Roost', 'Shade\'s Rest', 'Spectral Hollow'
    ]
  },

  bloodplains: {
    // Harsh Highlands - Orc territory
    terrainWeights: { crag: 0.40, plateau: 0.35, badlands: 0.25 },
    terrainBaseTypes: { crag: 'mountain', plateau: 'mountain', badlands: 'mountain' },
    namePool: [
      'War Camp Ruins', 'Stone Guard Post', 'Peak Watchers',
      'Bloodrock Pass', 'Skull Ridge', 'Warlord\'s Trail',
      'Iron Crag Rest', 'Battle Scar Hollow', 'Raider\'s Mark',
      'Bonfire Site', 'Trophy Road', 'Challenger\'s Path',
      'Axe-Cleave Pass', 'Warhorn Rest', 'Battlecry Junction',
      'Scarred Path', 'Ironhide Trail', 'Bloodspear Crossing',
      'Warbanner Rest', 'Shieldwall Pass', 'Conquest Road'
    ]
  }
};

/**
 * Helper: Normalize region name to config key
 * Converts "Sylvan Reaches" -> "sylvan_reaches", "Iron Depths" -> "iron_depths"
 *
 * @param {string} regionName - Display name of the region
 * @returns {string} Config key for REGION_INTERMEDIATE_CONFIG
 */
export function normalizeRegionName(regionName) {
  return regionName.toLowerCase().replace(/\s+/g, '_');
}
