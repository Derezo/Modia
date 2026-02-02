# World Map Generation Technical Deep Dive

## Document Information

| Field | Value |
|-------|-------|
| Version | 1.1 |
| Last Updated | January 2026 |
| Total Code | ~5,500 lines across 9 modules |

---

## Overview

Modia's world map generation system is a sophisticated 6-phase procedural generation pipeline that creates a deterministic 5-region world from a single seed value. Each region is race-themed with a central castle, and regions are connected via bridges, wilderness zones, and trade routes.

**Key Characteristics:**
- **Deterministic:** Same seed always produces identical world
- **Regional:** 5 distinct regions with racial themes
- **Graph-based:** Nodes connected via edges, not a grid
- **Hierarchical:** Ring-based difficulty progression from castles outward

---

## System Architecture

### Module Structure

```
api/src/db/worldgen/
├── index.js                   # Module exports (96 lines)
├── constants.js               # All configuration (464 lines)
├── castlePlacement.js         # Phase 1: Castle positions (362 lines)
├── voronoiPartitioning.js     # Phase 2: Region boundaries (622 lines)
├── nodeGeneration.js          # Phase 3: Internal nodes (832 lines)
├── internalConnections.js     # Phase 4: MST + connections (965 lines)
├── interRegionConnections.js  # Phase 5: Bridges/trade routes (1,063 lines)
├── validation.js              # Phase 6: Cleanup/validation (528 lines)
└── terrain.js                 # Obstacle generation (144 lines)
```

### Coordinate System

| Property | Value | Notes |
|----------|-------|-------|
| World bounds | [-50, 50] x [-50, 50] | Total 100x100 unit area |
| Castle range | [-30, 30] | Castles avoid edges |
| 1 unit | 30 pixels | Conversion factor |
| Max node spacing | 13.3 units (400px) | **CRITICAL CONSTRAINT** |
| Min node spacing | 3.5 units | Poisson disk parameter |

---

## The 6-Phase Generation Pipeline

```
npm run db:seed
    │
    ▼
seed.js: generateWorld(WORLD_SEED)
    │
    ├─▶ Phase 1: generateCastlePlacements(rng)
    │       Output: 5 castle positions + region metadata
    │
    ├─▶ Phase 2: createVoronoiRegions(castles)
    │       Output: cells, edges, vertices, palace position
    │
    ├─▶ Phase 3: generateAllRegionNodes(castles, voronoi, rng)
    │       Output: 250-500 nodes with types (Euclidean rings)
    │
    ├─▶ Phase 4: generateAllRegionConnections(nodes, rng)
    │       Output: MST + extras + intermediates (BFS rings)
    │
    ├─▶ Phase 5: generateInterRegionConnections(...)
    │       Output: bridges, wilderness, trade routes, palace
    │
    ├─▶ Phase 6: validateAndCleanup(...)
    │       Output: difficulty tiers, terminators, validation
    │
    ▼
Database Insertion (world_regions, world_nodes, world_node_connections)
```

---

## Phase 1: Castle Placement

**File:** `castlePlacement.js` (362 lines)

**Algorithm:** Force-directed physics simulation + Lloyd's relaxation

### Process

1. **Initialization:** Generate 5 random positions in [-30, 30] range
2. **Force-Directed Simulation** (up to 500 iterations):
   - Calculate repulsion between all castle pairs
   - Apply boundary repulsion to keep castles from edges
   - Apply damping (0.95) to prevent oscillation
   - Move castles based on accumulated forces
3. **Lloyd's Relaxation** (3 iterations):
   - Calculate Voronoi cells for current positions
   - Push points AWAY from cell centroids (unconventional)
4. **Final Enforcement:** One more force pass to ensure minimum distances

### Key Constants

```javascript
CASTLE_PLACEMENT = {
  MIN_DISTANCE: 25,           // Minimum castle-to-castle distance
  POSITION_RANGE: 30,         // Bounds: [-30, 30]
  FORCE_MAX_ITERATIONS: 500,  // Max simulation iterations
  FORCE_REPULSION: 3.0,       // Repulsion strength
  FORCE_DAMPING: 0.95,        // Velocity damping
  LLOYD_ITERATIONS: 3,        // Relaxation passes
  LLOYD_STRENGTH: 0.2,        // Movement toward centroid (0-1)
  BOUNDARY_PADDING: 2         // Edge avoidance
}
```

### Output

```javascript
[
  {
    position: { x: 12.5, y: -8.3 },
    race: 'human',
    regionName: 'Heartlands',
    terrain: 'plains',
    castle: { name: 'Castle Heartlands', features: ['throne_room', 'armory', 'market'] }
  },
  // ... 4 more castles
]
```

### Pitfalls

- **Lloyd's Inversion:** Implementation pushes AWAY from centroid, opposite of traditional Lloyd's relaxation
- **Convergence:** Not guaranteed - relies on iteration limit fallback
- **Edge Cases:** Very unlucky initial positions could require maximum iterations

---

## Phase 2: Voronoi Partitioning

**File:** `voronoiPartitioning.js` (622 lines)

**Algorithm:** d3-delaunay library (Delaunay triangulation → Voronoi dual)

### Process

1. Create Delaunay triangulation from 5 castle positions
2. Generate Voronoi diagram within world bounds
3. Extract region boundaries as closed polygons
4. Identify edges between adjacent regions (for bridges)
5. Identify vertices where 3+ regions meet
6. Select Grand Palace position

### Grand Palace Selection Priority

1. Vertex where most regions meet (prefer 4-5)
2. If tied, choose vertex farthest from world center
3. Must be ≥10 units from nearest castle
4. Fallback: farthest point from all castles

### Key Constants

```javascript
VORONOI_CONFIG = {
  WORLD_BOUNDS: [-50, -50, 50, 50],  // Larger than castle range
  MIN_VERTEX_DISTANCE: 5,            // Minimum between vertices
  CENTER_THRESHOLD: 5                // "Center" definition
}
```

### Output Structure

```javascript
{
  cells: [{
    regionIndex: 0,
    polygon: [[x1,y1], [x2,y2], ...],  // CLOSED: first = last
    centroid: { x, y },
    area: 850.5
  }],
  edges: [{
    region1: 0,
    region2: 1,
    points: [[x1,y1], [x2,y2]],
    length: 18.5,
    midpoint: { x, y }
  }],
  vertices: [{
    x: 15.2,
    y: -3.8,
    adjacentRegions: [0, 1, 2],
    distanceFromCenter: 15.6
  }],
  palacePosition: { x, y, adjacentRegions: [...] }
}
```

### Pitfalls

- **Closed Polygons:** d3-delaunay returns polygons where first point = last point
- **Floating Point Precision:** Vertex matching uses tolerance=0.001, but keys use `toFixed(3)` - potential mismatch
- **Collinear Castles:** Could produce degenerate (<5) cells - not handled

---

## Phase 3: Internal Node Generation

**File:** `nodeGeneration.js` (832 lines)

**Algorithm:** Poisson disk sampling (Bridson 2007)

### Process

1. Create spatial grid with cell size = `minDistance / √2`
2. Seed with castle position (or centroid if outside polygon)
3. Active-list algorithm:
   - Pick random active point
   - Try up to 30 candidates in ring [r, 2r]
   - Accept if in polygon AND far from existing samples
4. Assign node types based on EUCLIDEAN distance from castle

### Ring Distance (Phase 3 - Euclidean)

| Ring | Distance | Node Types |
|------|----------|-----------|
| 0 | 0-5 units | Castle + guard battle nodes only |
| 1 | 5-12 units | Cities, villages, primary guild |
| 2 | 12-20 units | Keep, secondary guilds, farms |
| 3 | 20+ units | Battle nodes, activity nodes, terminators |

**IMPORTANT:** Phase 4 recalculates ring distance via BFS. This Euclidean distance is an approximation for initial type assignment.

### Node Distribution Per Region

| Type | Count | Ring |
|------|-------|------|
| Castle | 1 | 0 |
| Cities | 2-3 | 1 |
| Villages | 6-10 | 1-2 |
| Keep | 1 | 2 |
| Guilds | 3 (1 primary + 2 secondary) | 1-2 |
| Farms | 2-4 | 2+ |
| Battle nodes | 40-50% of total | All |
| Activity nodes | 20-30% of total | 2+ |

### Guild Assignment by Race

```javascript
RACE_PRIMARY_GUILD = {
  'orc': 'warrior',
  'elf': 'wizard',
  'human': 'monk',
  'dwarf': 'chemist',
  'vampire': 'wizard'  // Magic affinity
}
```

### Global Guild Same-Type Spacing

Secondary guilds (2 per region) are assigned **globally** after all regions have primary guilds. This prevents clustering of same guild types (e.g., two wizard guilds adjacent).

**Algorithm:**
1. Collect all primary guild positions and types
2. For each region needing secondary guilds:
   - Find candidate nodes in outer rings (12-25 units from castle)
   - Score by minimum distance to nearest same-type guild globally
   - Prefer underrepresented guild types
3. Assign guilds prioritizing maximum same-type spacing

**Constants:**
```javascript
GUILD_CONFIG = {
  MIN_SAME_TYPE_SPACING: 40,   // Geometrically achievable with ~25-unit castle spacing
  GLOBAL_MAX_PER_TYPE: 4,      // Max 4 of each type worldwide
  GLOBAL_MIN_PER_TYPE: 3,      // Min 3 of each type worldwide
}
```

**Note:** Elf and Vampire regions both have wizard primaries - this is acceptable as race-alignment is a hard requirement.

**Spacing Rationale:** The 40-unit threshold was chosen based on geometric analysis of the world layout. With castles approximately 25 units apart and guild placement constrained to Ring 2-3 (12-25 units from castle), the best achievable same-type spacing is typically 40-80 units. A 100-unit threshold was mathematically impossible on this world scale.

### Battle Terrain Anti-Clustering

Prevents clusters of same-type battle nodes (caves, forests, mountains) from appearing together.

**Algorithm:**
1. During assignment, track all assigned battle nodes
2. For each new battle node:
   - Count same-type neighbors within 5.0 unit radius
   - Reduce dominant terrain probability per neighbor found (40% penalty each)
   - Hard cap: if 2+ same-type nodes nearby, force different type
3. Post-validation detects remaining clusters (advisory warnings)

**Constants:**
```javascript
TERRAIN_ANTI_CLUSTERING = {
  // Assignment phase
  ANTI_CLUSTER_RADIUS: 5.0,     // Check distance during node assignment
  SAME_TYPE_PENALTY: 0.4,       // Weight reduction per neighbor
  MAX_SAME_TYPE_NEARBY: 2,      // Hard cap triggers alternate type
  MIN_DOMINANT_RATIO: 0.55,     // Preserve regional identity
  // Validation phase
  MAX_CLUSTER_SIZE: 3,          // Max same-type nodes within N hops
  CLUSTER_HOP_DISTANCE: 1,      // Check immediate neighbors only
}
```

**Clustering Validation Rationale:** The validation uses 1-hop distance to align with the ~5-unit radius used during assignment (both check immediate neighbors). MAX_CLUSTER_SIZE=3 allows natural small clusters while catching problematic 4+ node clusters. With 40-55% dominant terrain per region, some clustering is mathematically inevitable.

### Key Constants

```javascript
REGION_NODE_CONFIG = {
  MIN_SPACING: 3.5,              // Poisson disk minimum
  TARGET_NODES_PER_REGION: 70,   // ~60-80 actual
  MAX_POISSON_ATTEMPTS: 30,      // Per active point
  RING_0_MAX_DIST: 5,
  RING_1_MAX_DIST: 12,
  RING_2_MAX_DIST: 20
}
```

### Pitfalls

- **Euclidean vs BFS:** This phase uses Euclidean distance; Phase 4 recalculates via BFS
- **Point-in-Polygon:** Uses ray casting - edge cases at polygon vertices
- **Undersampling:** If sampling can't meet target, returns fewer nodes (no error)

---

## Phase 4: Internal Connections

**File:** `internalConnections.js` (965 lines)

**Algorithm:** Prim's MST + extra connections + gap infill

### Process

1. **Build MST** from castle using Prim's algorithm:
   - Invalid adjacencies get 10000× penalty (not blocked)
   - Castle can ONLY connect to battle nodes
   - Settlements cannot connect directly to settlements
2. **Add Extra Connections** (20% beyond MST):
   - Max distance: 12 units
   - Respect connection limits per node type
3. **Recalculate Ring Distance** via BFS from castle
4. **Gap Infill:** Insert intermediate nodes on edges > 13.3 units

### Adjacency Rules

| Connection | Allowed | Notes |
|------------|---------|-------|
| Battle ↔ Battle | Yes | |
| Battle ↔ Settlement | Yes | |
| Castle ↔ Battle | Yes | Castle guards |
| Settlement ↔ Settlement | No (10000× penalty) | Forces battle nodes between |
| Castle ↔ Non-battle | No (10000× penalty) | |

### Connection Limits

```javascript
MIN_CONNECTIONS = {
  castle: 5,
  city: 3,
  village: 2,
  guild: 2,
  farm: 2,
  forest/cave/mountain: 2,
  bridge: 2,
  chest/shrine/discovery: 1  // Terminators
}

MAX_CONNECTIONS = {
  bridge: 2,      // Chokepoints
  watchtower: 3,
  chest/shrine/discovery: 1  // Dead ends
}
```

### Ring Distance (Phase 4 - BFS)

| Ring | Hops from Castle |
|------|------------------|
| 0 | 0 (castle itself) |
| 1 | 1-2 hops |
| 2 | 3-5 hops |
| 3 | 6+ hops |

### Gap Infill for Long Edges

**Trigger:** Edge > 13.3 units (MAX_NODE_SPACING)

**Calculation:** `segmentCount = ceil(distance / 10)`

**Intermediate Node Names by Region:**

| Region | Terrain Types | Example Names |
|--------|---------------|---------------|
| Heartlands | meadow, woodland, roadside | Wayfarer's Rest, King's Mile |
| Sylvan Reaches | grove, glade, thicket | Starlight Glade, Moonlit Path |
| Iron Depths | tunnel, mineshaft, cavern | Deep Tunnel Junction, Forge Road |
| Shadowmere | crypt, shadow_grove, mist_hollow | Shadow Crossing, Twilight Refuge |
| Bloodplains | crag, plateau, badlands | War Camp Ruins, Bloodrock Pass |

### Key Constants

```javascript
CONNECTION_CONFIG = {
  EXTRA_CONNECTION_RATIO: 0.20,   // 20% extra beyond MST
  MAX_CONNECTION_DISTANCE: 12,    // For extra connections
  INVALID_PENALTY: 10000,         // Cost multiplier
  RING_THRESHOLDS: { RING_1: 2, RING_2: 5 }  // BFS hops
}

INTER_REGION_CONFIG = {
  MAX_NODE_SPACING: 13.3,         // 400px CRITICAL LIMIT
  INTERMEDIATE_SPACING: 10        // Target for gap infill
}
```

### Pitfalls

- **State Mutation:** Mutates input array by pushing intermediate nodes
- **Infinite Loop Escape:** Name generation at suffix limit (100) adds duplicate
- **Ring Recalculation:** Ring distance changes between Phase 3 (Euclidean) and Phase 4 (BFS)

---

## Phase 5: Inter-Region Connections

**File:** `interRegionConnections.js` (1,063 lines)

**Algorithm:** Border analysis + topology-based connection generation

### Connection Types by Border Length

| Border Length | Generated |
|---------------|-----------|
| < 10 units | Bridge only |
| 10-20 units | Bridge + wilderness (2-4 nodes) |
| ≥ 20 units | Bridge + wilderness + trade route (3-5 nodes) |

### Bridge Nodes

- **Position:** Border edge midpoint
- **Type:** Chokepoint (exactly 2 connections)
- **Names:** Thematic per region pair

```javascript
BRIDGE_NAMES = {
  'Bloodplains-Heartlands': ['Border Crossing', 'War\'s End Bridge', 'Truce Span'],
  'Heartlands-Sylvan Reaches': ['Woodland Bridge', 'Green Gate', 'Forest Crossing'],
  // ... more region pairs
}
```

### Wilderness Zones

- **Position:** Border area between frontier nodes
- **Difficulty:** +1 tier from frontier
- **Node Count:** 2-4 nodes
- **Names:** Thematic danger/wild names

```javascript
WILDERNESS_ZONE_NAMES = {
  dangerous: ['Bandit\'s Hollow', 'Outlaw Pass', 'Cutthroat Canyon', ...],
  wild: ['Untamed Wilds', 'Savage Reach', 'Feral Depths', ...],
  ominous: ['No Man\'s Land', 'Forgotten Frontier', 'Border Badlands', ...]
}
```

### Trade Routes

- **Position:** Longer borders only (≥20 units)
- **Difficulty:** -1 tier (safer alternative)
- **Node Count:** 3-5 nodes
- **Names:** Commerce/journey themes

```javascript
TRADE_ROUTE_NAMES = {
  commerce: ['Merchant\'s Rest', 'Trader\'s Crossing', 'Caravan Camp', ...],
  journey: ['Wayfarer\'s Glen', 'Traveler\'s Rest', 'Pilgrim\'s Path', ...],
  destination: ['Midway Station', 'Border Market', 'Crossroads Camp', ...]
}
```

### Grand Palace

- **Position:** Multi-region vertex (3-5 regions meet)
- **Difficulty:** Tier 5 (endgame)
- **Features:** throne_room, treasury, royal_guard

### Frontier Node Selection Priority

1. Ring 2-3 battle nodes within search distance
2. Fallback: Any battle node
3. Fallback: Any non-settlement
4. Fallback: Any node except castle

### Key Constants

```javascript
INTER_REGION_CONFIG = {
  BORDER_SHORT_THRESHOLD: 10,
  BORDER_MEDIUM_THRESHOLD: 20,
  WILDERNESS_MIN_NODES: 2,
  WILDERNESS_MAX_NODES: 4,
  TRADE_ROUTE_MIN_NODES: 3,
  TRADE_ROUTE_MAX_NODES: 5,
  MAX_FRONTIER_SEARCH_DIST: 15,
  MAX_NODE_SPACING: 13.3,      // 400px CRITICAL
  INTERMEDIATE_SPACING: 10
}
```

### Pitfalls

- **Region Index Mismatch:** Voronoi uses 0-indexed, nodesByRegion uses 1-indexed regionIds
- **Null Bridge:** bridgeNode could be null when passed to createWildernessZone
- **Gap Infill:** Also applies here for long inter-region edges

---

## Phase 6: Validation & Cleanup

**File:** `validation.js` (528 lines)

### Process

1. **Connectivity Check:** BFS from any castle - all nodes must be reachable
2. **Difficulty Tier Assignment**
3. **Terminator Assignment:** Ring 3+ dead-ends
4. **Max Spacing Validation:** All connections ≤ 13.3 units

### Difficulty Tier Matrix

| Node Type | Ring 0 | Ring 1 | Ring 2 | Ring 3 | Inter-Region |
|-----------|--------|--------|--------|--------|--------------|
| Settlement | 1 | 1-2 | 2-3 | 3 | - |
| Battle | 1 | 2 | 3 | 4 | 3-4 |
| Palace | - | - | - | - | 5 |

### Terminator Distribution

| Type | Percentage | Description |
|------|------------|-------------|
| Chest | 30% | One-time loot |
| Shrine | 30% | Zodiac shrines with buffs |
| Discovery | 40% | Lore/exploration rewards |

### Terminator Selection Criteria

- Must be Ring 3+ (MIN_RING_FOR_TERMINATOR: 3)
- Must have 1-2 connections (dead-end)
- Must be battle terrain type (forest, cave, mountain)
- Target: ~6% of total nodes

### Key Constants

```javascript
PHASE6_CONFIG = {
  TERMINATOR_CHEST_RATIO: 0.30,
  TERMINATOR_SHRINE_RATIO: 0.30,
  MIN_RING_FOR_TERMINATOR: 3,
  TARGET_TERMINATOR_RATIO: 0.06,
  SHRINE_BUFF_TYPES: ['stamina_regen', 'exp_bonus', 'gold_bonus']
}

ZODIAC_CONFIG = {
  ZODIAC_TYPES: ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo',
                 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'],
  MIN_RING: 2,
  MIN_SPACING: 15,
  PER_WORLD: 12
}
```

### Pitfalls

- **Orphaned Nodes:** Will fail connectivity check
- **Terminator Selection:** Only considers battle terrain types

---

## Critical Technical Gotchas

### 1. Ring Distance Dual Calculation

**Problem:** Phase 3 uses Euclidean distance from castle, Phase 4 recalculates via BFS

**Impact:** Node type assignment in Phase 3 may not match final ring

**Example:**
- Node at position (18, 0) from castle at (0, 0) = Euclidean distance 18 → Ring 2
- Same node via MST path: castle → A → B → C → node = 4 hops → Ring 2 (but could be 6 hops → Ring 3)

**Mitigation:** Phase 4's BFS ring is authoritative. Phase 3 Euclidean is an approximation.

### 2. Floating Point Precision in Voronoi

**Problem:** Vertex matching uses tolerance=0.001, but map keys use `toFixed(3)`

**Example:**
```javascript
// Value: 10.0009
toFixed(3) → "10.001"
// Tolerance check against 10.0005
Math.abs(10.0009 - 10.0005) = 0.0004 > 0.001? NO, passes
// But "10.001" != "10.001" (first is "10.001", second is "10.000")
```

**Location:** `voronoiPartitioning.js:201,284`

### 3. Region Index Mismatch

**Problem:** Voronoi uses 0-indexed regions, nodesByRegion uses 1-indexed regionIds

**Pattern:** Fragile `+1` conversion appears in 6 locations

**Location:** `interRegionConnections.js:288`

**Risk:** Off-by-one errors connecting wrong regions

### 4. State Mutation

**Problem:** `generateRegionConnections` mutates input node array

**Location:** `internalConnections.js:689`

**Impact:** Caller must be aware nodes array grows during execution

### 5. Infinite Loop Escape Bug

**Problem:** Name generation at suffix limit adds potentially duplicate name

```javascript
// When suffix reaches 100, loop exits and adds "${baseName} 100"
// regardless of uniqueness, potentially creating duplicates
```

**Location:** `internalConnections.js:77-98`

### 6. Closed Polygons from d3-delaunay

**Problem:** Voronoi polygons have first point = last point

**Impact:** Must handle in:
- Point-in-polygon checks
- Area calculations
- Perimeter calculations

### 7. Degenerate Voronoi Cells

**Problem:** If 3+ castles are collinear, could produce < 5 cells

**Impact:** Would break all downstream phases expecting 5 regions

**Not Currently Handled:** No validation for this edge case

---

## Performance Considerations

### Time Complexity

| Phase | Complexity | Notes |
|-------|------------|-------|
| 1. Castle Placement | O(n² × iterations) | n=5, up to 500 iterations |
| 2. Voronoi | O(n log n) | d3-delaunay optimized |
| 3. Node Generation | O(m × k) | m=attempts, k=active list |
| 4. MST | O(n³) | Could optimize to O(n² log n) |
| 5. Inter-Region | O(n × e) | n=nodes, e=edges |
| 6. Validation | O(n + e) | BFS traversal |

### Memory Usage

- ~350-500 nodes per world
- ~800-1200 edges per world
- Voronoi structures: ~50KB
- Total: ~2-5MB during generation

### Optimization Opportunities

1. MST: Use priority queue (Fibonacci heap) for O(n² log n)
2. Node lookups: Use Map instead of Array.indexOf
3. Spatial queries: Use quadtree for neighbor finding

---

## Debugging Guide

### Common Issues

#### "Orphaned nodes found"
**Cause:** Nodes not connected to main graph
**Debug:**
1. Check gap infill for edges > 13.3 units
2. Verify intermediate node creation
3. Check for failed connections in Phase 4/5

#### "Max spacing exceeded"
**Cause:** Connection > 400px (13.3 units) exists
**Debug:**
1. Run validation with logging
2. Check gap infill triggers
3. Verify INTERMEDIATE_SPACING calculation

#### "Missing region nodes"
**Cause:** Poisson disk sampling underperformed
**Debug:**
1. Check polygon area - may be too small
2. Verify MIN_SPACING isn't too large
3. Check point-in-polygon for boundary issues

#### "Wrong difficulty tier"
**Cause:** Ring distance miscalculated
**Debug:**
1. Verify BFS from castle is complete
2. Check for disconnected subgraphs
3. Verify connection list integrity

### Useful Debug Queries

```sql
-- Count nodes per region
SELECT region_id, COUNT(*) FROM world_nodes GROUP BY region_id;

-- Find long connections
SELECT n1.name, n2.name,
  SQRT(POWER(n1.x_coord - n2.x_coord, 2) + POWER(n1.y_coord - n2.y_coord, 2)) as dist
FROM world_node_connections c
JOIN world_nodes n1 ON c.from_node_id = n1.id
JOIN world_nodes n2 ON c.to_node_id = n2.id
WHERE SQRT(POWER(n1.x_coord - n2.x_coord, 2) + POWER(n1.y_coord - n2.y_coord, 2)) > 13;

-- Find terminators
SELECT name, node_type, ring_distance
FROM world_nodes
WHERE node_type IN ('chest', 'shrine', 'discovery');

-- Check connectivity from castle
WITH RECURSIVE reachable AS (
  SELECT id FROM world_nodes WHERE node_type = 'castle' LIMIT 1
  UNION
  SELECT DISTINCT CASE WHEN c.from_node_id = r.id THEN c.to_node_id ELSE c.from_node_id END
  FROM reachable r
  JOIN world_node_connections c ON c.from_node_id = r.id OR c.to_node_id = r.id
)
SELECT COUNT(*) as reachable, (SELECT COUNT(*) FROM world_nodes) as total
FROM reachable;
```

---

## Configuration Reference

### All Configuration Objects

See `api/src/db/worldgen/constants.js` for complete definitions:

- `CASTLE_PLACEMENT` - Phase 1 physics simulation
- `VORONOI_CONFIG` - Phase 2 boundaries
- `REGION_NODE_CONFIG` - Phase 3 node generation
- `CONNECTION_CONFIG` - Phase 4 MST and connections
- `INTER_REGION_CONFIG` - Phase 5 bridges and routes
- `PHASE6_CONFIG` - Phase 6 validation
- `GUILD_CONFIG` - Guild assignment rules (includes global same-type spacing)
- `NODE_DISTRIBUTION` - Type percentages
- `TERRAIN_ANTI_CLUSTERING` - Battle node anti-clustering settings
- `ZODIAC_CONFIG` - Shrine placement
- `WATCHTOWER_CONFIG` - Watchtower rules (pixel radius multiplier)
- `REGION_INTERMEDIATE_CONFIG` - Region-themed nodes

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `WORLD_SEED` | Deterministic generation seed | Random |
| `DEBUG` | Enable verbose logging | false |

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.1 | Jan 2026 | Added global guild spacing, terrain anti-clustering, removed GAP_INFILL_CONFIG |
| 1.0 | Jan 2026 | Initial document from codebase analysis |
