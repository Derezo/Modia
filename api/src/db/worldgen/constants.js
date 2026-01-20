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
  // Terminator nodes have exactly 1 connection
  chest: 1,
  shrine: 1,
  discovery: 1
};

export const MAX_CONNECTIONS = {
  bridge: 2,  // Bridges act as chokepoints with exactly 2 connections
  watchtower: 3,  // Watchtowers can have a few connections but not many
  // Terminator nodes are dead ends
  chest: 1,
  shrine: 1,
  discovery: 1
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
    "Merchant's Rest", "Trader's Crossing", 'Caravan Camp', "Peddler's Way",
    'Bargain Bend', "Haggler's Haven", "Coin Counter's Rest", 'Market Waypoint',
    'Spice Road Station', 'Silk Route Camp', 'Gold Dust Stop', "Barter's End"
  ],
  journey: [
    "Wayfarer's Glen", "Traveler's Rest", "Pilgrim's Path", "Wanderer's Watch",
    "Road's End Camp", 'Mile Marker Hollow', "Journey's Pause", 'Passage Point',
    "Sojourner's Shade", "Drifter's Dell", "Nomad's Nook", "Rambler's Refuge"
  ],
  destination: [
    'Midway Station', 'Border Market', 'Crossroads Camp', 'Halfway House',
    'Twin Realms Rest', "Realm's Edge Trading Post", 'Frontier Exchange',
    'Junction Dell', 'Borderland Bazaar', 'Treaty Grounds', 'Alliance Market'
  ]
};

// Wilderness Zone Node Names - dangerous/wild themes
export const WILDERNESS_ZONE_NAMES = {
  dangerous: [
    "Bandit's Hollow", 'Outlaw Pass', 'Lawless Woods', "Rogue's Den",
    'Cutthroat Canyon', "Brigand's Bluff", "Marauder's Mark", "Smuggler's Run",
    "Raider's Rest", "Highwayman's Haunt", "Thief's Thicket", "Pillager's Path"
  ],
  wild: [
    'Untamed Wilds', 'Savage Reach', 'Feral Depths', 'Primal Grove',
    "Beast's Domain", "Hunter's Peril", "Predator's Trail", 'Wild Frontier',
    'Fang & Claw Pass', 'Howling Wastes', "Stalker's Territory", 'Apex Hunting Grounds'
  ],
  ominous: [
    "No Man's Land", 'Forgotten Frontier', 'Border Badlands', 'Contested Ground',
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
  // Beyond RING_2: Ring 3 - battle nodes, terminators, watchtowers
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

  // Target terminator percentage of total nodes
  TARGET_TERMINATOR_RATIO: 0.06  // ~6% of nodes become terminators
};

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
  MIN_GUILD_SPACING: 8                    // Minimum distance between guilds in same region
};

// ============================================================================
// NODE DISTRIBUTION TARGETS
// ============================================================================

export const NODE_DISTRIBUTION = {
  // Target percentages (should sum to ~1.0 excluding settlements which are fixed)
  BATTLE_PERCENT: { min: 0.40, max: 0.50 },
  ACTIVITY_PERCENT: { min: 0.20, max: 0.30 },
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
  REVEAL_RADIUS: 2                        // Reveals nodes within 2 hops
};

// ============================================================================
// GAP INFILL CONFIGURATION (for long connections)
// ============================================================================

export const GAP_INFILL_CONFIG = {
  // Connection distance limits
  MAX_CONNECTION_DISTANCE: 12,            // Standard max connection distance
  GAP_INFILL_THRESHOLD: 20,               // Generate intermediates when gap > 20 units

  // Intermediate node generation
  INTERMEDIATE_NODE_SPACING: 6,           // Space between intermediate nodes
  INTERMEDIATE_BRANCH_CHANCE: 0.3,        // 30% chance intermediate connects to nearby nodes
  INTERMEDIATE_BRANCH_DISTANCE: 8,        // Max distance to search for branch connections

  // Type distribution for intermediate nodes (should sum to 1.0)
  INTERMEDIATE_TYPE_WEIGHTS: {
    battle: 0.40,                          // 40% battle nodes
    activity: 0.30,                        // 30% activity nodes
    settlement: 0.30                       // 30% village/farm
  }
};
