# Regional World Generation Design

**Date:** 2026-01-13
**Status:** Implemented
**Scope:** Major refactor of procedural world generation system

> **Post-Implementation Updates (2026-01-19):**
> - Added max spacing constraint (13.3 units / 400px) with automatic gap infill for **Phase 5 inter-region connections**
> - Added thematic naming for trade routes ("Merchant's Rest", "Wayfarer's Glen") and wilderness zones ("Bandit's Hollow", "No Man's Land")
> - See `api/src/db/worldgen/constants.js` for `TRADE_ROUTE_NAMES` and `WILDERNESS_ZONE_NAMES`
>
> **Known Future Work:**
> - Phase 4 internal connections still lack max spacing enforcement (~320 violations)
> - See `docs/plans/2026-01-19-phase4-spacing-enforcement-design.md` for implementation plan

## Overview

Replace the current single-castle, distance-band world generation with a **5-region system** based on racial homelands. Each region has its own castle, cities, villages, and frontier, connected via bridges, border zones, and trade routes.

### Goals
- Eliminate settlement clustering (cities/villages bunched together)
- Create distinct racial regions with thematic terrain
- Use battle nodes as spacers between settlements
- Maintain existing connection rules and constraints
- Generate organic, immersive world maps

### Non-Goals
- PvP territory control (future feature)
- Dynamic region boundaries
- Procedural region names (use predefined)

## Region Foundation

### 5 Racial Regions with Voronoi Partitioning

| Region | Race | Dominant Terrain (70%) | Secondary (30%) | Castle Name |
|--------|------|------------------------|-----------------|-------------|
| Heartlands | Human | Forest | Cave, Mountain | King's Keep |
| Sylvan Reaches | Elf | Forest (ancient) | Mountain, Cave | Starlight Citadel |
| Iron Depths | Dwarf | Cave, Mountain | Forest | Stone Throne |
| Shadowmere | Vampire | Cave | Forest, Mountain | Obsidian Spire |
| Bloodplains | Orc | Mountain | Cave, Forest | Warchief's Hold |

### Castle Placement Algorithm

1. Generate 5 candidate positions using force-directed simulation
2. Enforce minimum distance of **25 units** between any two castles
3. Run Lloyd's relaxation (3-5 iterations) to spread castles evenly
4. Build Voronoi diagram from castle positions - each cell becomes a region
5. Region boundaries are organic curves, not straight lines

### Spawn Behavior

- New characters spawn at the castle matching their race
- Castle node type stores `region_race` field
- All castles have equivalent features (tavern, all services)

## Internal Region Structure

### Ring-Based Node Distribution

Each region follows a hierarchical structure radiating outward from its castle:

**Ring 0 - Castle Core (0-2 connections from castle):**
- The castle itself
- 2-3 battle nodes immediately adjacent (guards the capital)
- No cities directly connected to castle (must pass through battle nodes)

**Ring 1 - Inner Civilization (2-4 connections from castle):**
- 2-3 cities, each connected through 1-2 battle nodes
- Cities have tavern + 2 random services (blacksmith, apothecary, temple, stables)
- 3-5 villages scattered between cities
- Villages have farm + optional apothecary

**Ring 2 - Frontier (5-7 connections from castle):**
- Regional Keep (one per region) - mid-tier dungeon/challenge
- More battle nodes (dominant terrain type)
- 2-3 additional villages
- Guild hall placement zone (one guild per region)

**Ring 3 - Wilderness Edge (8+ connections from castle):**
- Primarily battle nodes
- Terminator nodes (chest, shrine, discovery) only spawn here
- Dead-ends become terminators naturally
- This is where region borders blur into each other

### Node Count Targets Per Region

| Node Type | Count Per Region |
|-----------|------------------|
| Castle | 1 |
| City | 2-3 |
| Village | 6-10 |
| Keep | 1 |
| Guild | 1 |
| Battle nodes | 40-60 |
| Terminators | 5-10 |
| **Total** | **~60-80** |

**World Total: ~300-400 nodes**

## Inter-Region Connections

Voronoi edges define where regions meet. Three connection types populate these borders:

### Bridge Chokepoints (Strategic)

- Single bridge node connecting two regions at narrow points
- Max 2 connections (one to each region)
- 1-2 bridges per region border
- Named thematically: "Twilight Crossing" (Elf-Vampire), "Iron Pass" (Dwarf-Orc)
- Future PvP/guild control potential

### Border Wilderness Zones (Neutral Territory)

- 2-4 battle nodes shared between adjacent regions
- Mixed terrain from both regions (50/50 split)
- Higher difficulty tier (border conflicts)
- Accessible from either region's frontier nodes

### Trade Routes (Safe Corridors)

- Chain of 3-5 nodes connecting region cities
- Lower difficulty than wilderness borders
- Uses low-tier forest or road terrain
- Longer but safer route between civilizations

### Connection Algorithm

1. For each Voronoi edge (region pair), determine border length
2. Short borders (< 10 units): Place 1 bridge chokepoint
3. Medium borders (10-20 units): Bridge + wilderness zone
4. Long borders (20+ units): Bridge + wilderness + trade route
5. Ensure all regions connect to at least 2 other regions

### Grand Palace Placement

- Located at the Voronoi vertex where 3+ regions meet
- Or at the farthest point from all castles (world edge)
- Single end-game destination requiring cross-region travel

## Terrain Distribution

### Hybrid Terrain Model (70/30 Split)

```javascript
function assignBattleNodeTerrain(node, region, rng) {
  const roll = rng.next();
  if (roll < 0.70) {
    return region.dominantTerrain;
  } else {
    return rng.pick(region.secondaryTerrains);
  }
}
```

### Node Type Specifications

| Type | Role | Min Connections | Max Connections |
|------|------|-----------------|-----------------|
| `castle` | Regional capital, spawn point | 4 | - |
| `city` | Trade hub, services | 3 | - |
| `village` | Small settlement | 2 | - |
| `guild` | Class training | 2 | - |
| `keep` | Mid-tier dungeon | 2 | - |
| `forest` | Battle node | 2 | - |
| `cave` | Battle node | 2 | - |
| `mountain` | Battle node | 2 | - |
| `bridge` | Region chokepoint | 2 | 2 |
| `palace` | End-game (one total) | 3 | - |
| `chest` | Terminator | 1 | 1 |
| `shrine` | Terminator | 1 | 1 |
| `discovery` | Terminator | 1 | 1 |

### Region Metadata

All nodes store:
- `region_id` (1-5) - Region identifier
- `region_race` - Owning race
- `ring_distance` (0-3) - Graph distance from regional castle

## Guild Distribution

- **5 guilds total** - One per region
- **4 classes** - Warrior, Wizard, Monk, Chemist
- **One class duplicated** - Determined by world seed (random)
- Guild placement in Ring 2 (frontier) of each region

```javascript
function assignGuilds(regions, rng) {
  const classes = ['warrior', 'wizard', 'monk', 'chemist'];
  const duplicateClass = rng.pick(classes);
  const assignments = [...classes, duplicateClass];
  rng.shuffle(assignments);

  regions.forEach((region, i) => {
    region.guildClass = assignments[i];
  });
}
```

## Generation Algorithm

### Phase 1: Castle Placement

1. Generate 5 random positions in range [-30, 30]
2. Run force-directed simulation (repulsion) until min distance 25 achieved
3. Apply Lloyd's relaxation (3 iterations) for even spread
4. Assign each castle to a race (seeded shuffle)

### Phase 2: Voronoi Partitioning

1. Build Voronoi diagram from 5 castle positions (using `d3-delaunay`)
2. Each cell becomes a region boundary (stored as polygon)
3. Identify Voronoi edges (region borders) and vertices (multi-region meeting points)
4. Place Grand Palace at vertex farthest from center

### Phase 3: Internal Node Generation (per region)

1. Generate node positions using Poisson disk (min spacing 3.5) within Voronoi cell
2. Build initial MST to establish connectivity
3. Assign rings based on graph distance from castle (BFS)
4. Place cities in Ring 1 (2-3 per region)
5. Place keep in Ring 2
6. Place guild in Ring 2
7. Scatter villages across Rings 1-2
8. Fill remaining with battle nodes (70/30 terrain split)
9. Convert dead-ends in Ring 3 to terminators

### Phase 4: Internal Connections (per region)

1. Build MST from castle outward (guarantees connectivity)
2. Add 20% extra connections for route variety
3. Enforce: castles connect only to battle nodes
4. Enforce: cities connect through battle nodes (no direct castle-city)

### Phase 5: Inter-Region Connections

1. For each Voronoi edge, calculate border length
2. Place bridge nodes at edge midpoints
3. Add border wilderness zones for medium+ borders
4. Generate trade routes between nearest cities across regions
5. Connect bridges/wilderness to nearest frontier nodes in each region

### Phase 6: Validation & Cleanup

1. Verify all nodes reachable from any castle (flood fill)
2. Enforce min/max connection constraints
3. Ensure no settlement-to-settlement direct connections
4. Assign difficulty tiers based on ring_distance

## Database Schema Changes

### Migration: `029_regional_world.sql`

```sql
-- New columns on world_nodes
ALTER TABLE world_nodes ADD COLUMN region_id INTEGER;
ALTER TABLE world_nodes ADD COLUMN region_race VARCHAR(20);
ALTER TABLE world_nodes ADD COLUMN ring_distance INTEGER;

-- New table for region metadata
CREATE TABLE world_regions (
  id SERIAL PRIMARY KEY,
  race VARCHAR(20) NOT NULL,
  castle_node_id INTEGER REFERENCES world_nodes(id),
  keep_node_id INTEGER REFERENCES world_nodes(id),
  guild_node_id INTEGER REFERENCES world_nodes(id),
  dominant_terrain VARCHAR(20) NOT NULL,
  secondary_terrains JSONB NOT NULL,
  boundary_polygon JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Character home region for spawn/respawn
ALTER TABLE characters ADD COLUMN home_region_id INTEGER REFERENCES world_regions(id);

-- Indexes
CREATE INDEX idx_world_nodes_region ON world_nodes(region_id);
CREATE INDEX idx_world_nodes_ring ON world_nodes(ring_distance);
CREATE INDEX idx_characters_home_region ON characters(home_region_id);
```

### Spawn Logic Update

```javascript
async function getSpawnLocation(race) {
  const region = await db.query(
    'SELECT castle_node_id FROM world_regions WHERE race = $1',
    [race]
  );
  return region.rows[0].castle_node_id;
}
```

## Implementation Plan

### Files Requiring Major Changes

| File | Scope | Changes |
|------|-------|---------|
| `api/src/db/seed.js` | **Rewrite** | Complete new generation algorithm |
| `api/src/routes/world.js` | Moderate | Region-aware queries, multi-castle support |
| `api/src/routes/characters.js` | Minor | Race-based spawn selection |
| `frontend/src/scenes/WorldMapScene.js` | Moderate | Render region boundaries, 5 castles |
| `shared/constants.js` | Minor | Add REGIONS, terrain mappings |

### New Dependencies

```bash
npm install d3-delaunay
```

- `d3-delaunay`: ~15KB, provides Voronoi + Delaunay triangulation
- Works in Node.js, well-tested, MIT license

### Migration Strategy

1. Create new migration `029_regional_world.sql`
2. Rewrite `seed.js` with new algorithm
3. Run `npm run db:fresh` to regenerate world
4. **Not incremental** - requires full world reset

### Existing Characters

For production deployments with existing characters:
- Option A: Full reset (recommended for pre-launch)
- Option B: Migration script to assign `home_region_id` based on race, relocate to new castles

## Testing Strategy

### Unit Tests

- Castle placement: verify min distance constraint
- Voronoi generation: verify all points assigned to regions
- Ring assignment: verify BFS distances correct
- Terrain distribution: verify 70/30 split approximately holds

### Integration Tests

- All nodes reachable from every castle
- Connection constraints (min/max) satisfied
- No settlement-to-settlement direct connections
- Each region has required nodes (castle, cities, keep, guild)

### Visual Validation

- Generate world, inspect via WorldMapScene
- Verify regions appear distinct
- Verify settlements not clustered
- Verify inter-region connections present

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Voronoi cells too small/large | Add min/max area constraints, regenerate castles if violated |
| Regions disconnected | Validation pass ensures all nodes reachable |
| Performance regression | Benchmark generation time, optimize if > 5s |
| Unbalanced regions | Target node counts per region, rebalance in Phase 3 |

## Success Criteria

1. No settlement clustering (cities/villages spread out)
2. Each region visually distinct with dominant terrain
3. Battle nodes act as spacers between all settlements
4. Inter-region travel requires passing through borders
5. All existing connection rules preserved
6. World generation completes in < 10 seconds
