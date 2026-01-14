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
  forest: 2,
  cave: 2,
  mountain: 2,
  bridge: 2,
  // Terminator nodes have exactly 1 connection
  chest: 1,
  shrine: 1,
  discovery: 1
};

export const MAX_CONNECTIONS = {
  bridge: 2,  // Bridges act as chokepoints with exactly 2 connections
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
  forest: ['Dark', 'Ancient', 'Whispering', 'Emerald', 'Twisted', 'Silent'],
  cave: ['Crystal', 'Shadow', 'Echo', 'Deep', 'Forgotten', 'Frost'],
  mountain: ['Storm', 'Iron', 'Snow', 'Thunder', 'Sky', 'Fire'],
  bridge: ['Stone', 'Hanging', 'Old', 'Broken', 'King\'s', 'Troll'],
  guild: ['Warriors\'', 'Wizards\'', 'Monks\'', 'Chemists\''],
  chest: ['Hidden', 'Ancient', 'Lost', 'Forgotten', 'Buried', 'Legendary'],
  shrine: ['Sacred', 'Ancient', 'Mystic', 'Holy', 'Blessed', 'Divine'],
  discovery: ['Ruined', 'Ancient', 'Lost', 'Forgotten', 'Mysterious', 'Legendary']
};

export const NODE_NAME_SUFFIXES = {
  city: ['Haven', 'Gate', 'Hold', 'Watch', 'Keep', 'Port'],
  village: ['Hollow', 'Dell', 'Crossing', 'Rest', 'Vale', 'Hamlet'],
  forest: ['Woods', 'Grove', 'Thicket', 'Wilds', 'Depths', 'Glade'],
  cave: ['Caverns', 'Grotto', 'Depths', 'Tunnels', 'Lair', 'Mine'],
  mountain: ['Peak', 'Summit', 'Crag', 'Ridge', 'Heights', 'Pass'],
  bridge: ['Crossing', 'Pass', 'Span', 'Way', 'Arch', 'Ford'],
  guild: ['Hall', 'Sanctum', 'Lodge', 'Academy', 'Tower', 'Keep'],
  chest: ['Trove', 'Cache', 'Hoard', 'Vault', 'Treasury', 'Bounty'],
  shrine: ['Altar', 'Sanctum', 'Temple', 'Monument', 'Obelisk', 'Pillar'],
  discovery: ['Ruins', 'Monument', 'Archive', 'Relic', 'Artifact', 'Mystery']
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
  GUILD_COUNT: 1,
  // Distance bands from castle (Euclidean proxy for ring assignment)
  RING_0_MAX_DIST: 5,                  // Guard battle nodes only
  RING_1_MAX_DIST: 12,                 // Cities, villages
  RING_2_MAX_DIST: 20,                 // Keep, guild, villages, battle
  // Beyond RING_2: Ring 3 - battle nodes, future terminators
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

  // Shrine buff types available
  SHRINE_BUFF_TYPES: ['stamina_regen', 'exp_bonus', 'gold_bonus'],

  // Minimum ring distance for terminators
  MIN_RING_FOR_TERMINATOR: 3,

  // Target terminator percentage of total nodes
  TARGET_TERMINATOR_RATIO: 0.06  // ~6% of nodes become terminators
};
