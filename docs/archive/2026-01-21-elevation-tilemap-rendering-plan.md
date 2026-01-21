# Battle Tilemap Generation Overhaul Plan

## Executive Summary

This plan addresses a critical gap: the elevation system is fully implemented in data structures and pathfinding logic, but **visual rendering and frontend pathfinding are disabled**. The maps appear flat, elevation differences are invisible to players, and frontend movement highlights may not match backend eligibility.

## Problem Statement

### Current Issues
1. **Flat Visual Rendering**: `BattleGrid.js:270-271` explicitly disables elevation rendering
2. **Highlight Misalignment**: Previous attempts had highlights off by 8px from tile surfaces
3. **Tiles Appeared as Holes**: Elevated tiles looked like depressions, not raised surfaces
4. **Frontend/Backend Desync**: Frontend uses 2D pathfinding while backend may use 3D
5. **Elevation Data Unused**: Full elevation infrastructure exists but is bypassed
6. **Generation Pipeline Gap**: Elevation runs post-hoc, algorithms don't see it early enough

### Root Cause Analysis
When `elevationPixelsPerLevel = 8` was applied:
- Tiles rendered at `Y - elevation * 8`
- Highlights rendered at original flat `Y` position (8px mismatch)
- The coordinate system wasn't updated consistently across rendering, highlighting, and click detection

---

## Implementation Plan

### Phase 1: Elevation-Aware Coordinate System
**Goal**: Fix the core rendering alignment by making elevation part of the coordinate system.

#### 1.1 Modify `gridToScreenWorld()` in BattleGrid.js
```javascript
gridToScreenWorld(gridX, gridY, includeElevation = true) {
  const worldX = (gridX - gridY) * (this.tileWidth / 2);
  let worldY = (gridX + gridY) * (this.tileHeight / 2);

  if (includeElevation) {
    const elevation = this.getElevation(gridX, gridY);
    worldY -= elevation * this.elevationPixelsPerLevel;
  }

  return { x: worldX, y: worldY };
}
```

#### 1.2 Update `gridToScreen()` to pass elevation flag
The camera transform remains unchanged - elevation is baked into world coordinates.

#### 1.3 Update `renderTileAt()` to use elevation sprites
```javascript
renderTileAt(ctx, screenX, screenY, terrain, highlight, gridX, gridY) {
  const variant = this.getTileVariant(gridX, gridY);
  const elevation = this.getElevation(gridX, gridY);

  // Get elevation-specific sprite (grass_elev1.png, etc.)
  let sprite = null;
  if (elevation !== 0) {
    sprite = this.assetLoader?.getElevatedTile(terrain, elevation, this.nodeType);
  }
  if (!sprite) {
    sprite = this.assetLoader?.getTile(terrain, this.nodeType, variant);
  }

  // Render sprite (elevated sprites have wall faces extending below)
  // ...existing sprite rendering logic...

  // Highlight is drawn at the SAME screenX/screenY (which now includes elevation)
  if (highlight) {
    this.renderTileHighlight(ctx, screenX, screenY, highlight);
  }
}
```

#### 1.4 Update rendering order for painter's algorithm
```javascript
// Sort key includes elevation to ensure proper layering
const depth = (x + y) + (elevation * 0.01);
```

**Files**: `frontend/src/battle/BattleGrid.js`

---

### Phase 2: Unit Positioning with Elevation
**Goal**: Units render at correct height on elevated tiles.

#### 2.1 Update `BattleUnit.updateScreenPosition()`
```javascript
updateScreenPosition() {
  // gridToScreenWorld now includes elevation automatically
  const pos = this.grid.gridToScreenWorld(this.gridX, this.gridY, true);
  this.screenX = pos.x;
  this.screenY = pos.y;
}
```

#### 2.2 Update movement animation
Movement between tiles at different elevations will smoothly animate Y position change.

**Files**: `frontend/src/battle/BattleUnit.js`

---

### Phase 3: Click Detection Fix
**Goal**: Clicking on elevated tiles maps to correct grid coordinates.

#### 3.1 Update `screenToGrid()` with elevation-aware detection
When clicking, check nearby elevated tiles that might visually overlap:
1. Calculate base grid position (flat)
2. Search elevated tiles in front rows that might occlude
3. Test if click point is within any elevated tile's diamond
4. Return correct tile based on visual layering

**Files**: `frontend/src/battle/BattleGrid.js`

---

### Phase 4: Frontend/Backend Movement Sync
**Goal**: Frontend highlights exactly match backend eligibility.

#### 4.1 Server stores elevation in battle state
In `api/src/routes/battle.js`, battle initialization:
```javascript
const mapData = generateTerrain(seed, nodeType, 32, 32, { elevation: true });
const { terrain, elevation, elevationConnections } = mapData;
// Include in battleState
```

#### 4.2 Server uses 3D pathfinding
In `api/src/services/battle/movementService.js`:
```javascript
if (state.elevation) {
  return getReachableTiles3D(x, y, z, range, terrain, elevation, connections, units, w, h);
}
```

#### 4.3 Frontend receives and uses server-provided tiles
Frontend already prefers `serverAvailableActions.movement.reachableTiles` (BattleScene.js:760-770). Ensure elevation data is transmitted in battle API responses.

#### 4.4 Enable 3D pathfinding in frontend fallback
In `BattlePathfinding.js`, use `getReachableTiles3D()` when elevation data available.

**Files**:
- `api/src/routes/battle.js`
- `api/src/services/battle/movementService.js`
- `frontend/src/scenes/BattleScene.js`
- `frontend/src/battle/BattlePathfinding.js`

---

### Phase 5: Elevation Sprite Verification
**Goal**: Ensure sprites properly show wall faces.

#### 5.1 Verify existing elevation sprites
Check `grass_elev1.png`, `grass_elev2.png`, `grass_elev3.png`, `grass_pit.png` dimensions:
- Elevated tiles should be taller (64xN where N > 64 for wall faces)
- Wall faces extend BELOW the diamond top surface
- Diamond top face centered at same position as flat tiles

#### 5.2 Update AssetLoader if needed
Add `getElevatedTile(terrain, elevation, nodeType)` method if not present.

#### 5.3 Regenerate sprites if dimensions incorrect
Run `npm run generate:all` with updated tile generation scripts.

**Files**:
- `frontend/src/core/AssetLoader.js`
- `scripts/tiles/generate-tiles.js`
- `frontend/public/assets/sprites/terrain/*/`

---

### Phase 6: Generation Pipeline Improvements
**Goal**: Generate elevation early so algorithms can use it.

#### 6.1 Add elevation profiles to archetypes
```javascript
openField: {
  // ...existing...
  elevationProfile: {
    type: 'rolling',
    maxElevation: 1,
    minElevation: 0,
    noiseScale: 0.05,
    rampPreference: 0.9
  }
}
```

#### 6.2 Generate elevation in LayerContext early
```javascript
// In LayerContext
generatePreElevation(profile, random) {
  const mapper = new ElevationMapper(profile);
  this.preElevation = mapper.generateElevation(width, height, random, null);
  this.elevation = this.preElevation.elevation;
}
```

#### 6.3 Modify AlgorithmPipeline.runArchetype()
Generate elevation first if archetype has `elevationProfile`, before running terrain algorithms.

**Files**:
- `shared/mapgen/archetypes/archetypeDefinitions.js`
- `shared/mapgen/LayerContext.js`
- `shared/mapgen/AlgorithmPipeline.js`

---

### Phase 7: Archetype-Specific Improvements

#### 7.1 Open Field
- Rolling elevation (0-1 levels)
- Lane structure algorithm for cover
- Terrain-to-elevation visual mapping

#### 7.2 Cave/Dungeon
- Depression profile (center lower)
- Pits and ledges
- Hierarchical room system

#### 7.3 Bridge/Pass
- Multi-level design
- Bridge at RAISED, hazard at PIT
- Chokepoint validation

#### 7.4 Mountain
- Canyon profile (walls at HIGH/PEAK)
- High ground spawn areas
- Elevation-first terrain generation

**Files**: `shared/mapgen/archetypes/archetypeDefinitions.js`

---

### Phase 8: Elevation Constraints
**Goal**: Validate maps have usable elevation.

#### 8.1 Add elevation metrics to ConstraintValidator
- Elevation standard deviation
- Ramps per level pair
- Peak/pit coverage limits

#### 8.2 Add elevation constraint presets
```javascript
mountain: { minElevationVariation: 0.5, minRampsPerLevelPair: 3 }
bridge: { minElevationVariation: 0.3, requireElevatedSpawns: true }
```

**Files**: `shared/mapgen/archetypes/constraints.js`

---

## Critical Files Summary

| File | Changes |
|------|---------|
| `frontend/src/battle/BattleGrid.js` | Coordinate system, rendering, click detection |
| `frontend/src/battle/BattleUnit.js` | Unit positioning with elevation |
| `frontend/src/battle/BattlePathfinding.js` | Enable 3D pathfinding |
| `frontend/src/core/AssetLoader.js` | Elevation sprite loading |
| `api/src/routes/battle.js` | Store/transmit elevation data |
| `api/src/services/battle/movementService.js` | Use 3D pathfinding |
| `shared/mapgen/archetypes/archetypeDefinitions.js` | Elevation profiles |
| `shared/mapgen/LayerContext.js` | Pre-elevation support |
| `shared/mapgen/archetypes/constraints.js` | Elevation constraints |

---

## Verification Plan

### Unit Tests
- Coordinate conversion with elevation
- Movement cost calculations with elevation
- Elevation constraint validation

### Integration Tests
- Battle initiation includes elevation data
- Server movement validation matches frontend highlights
- Map generation produces valid elevation per archetype

### Manual Testing
1. Start battle on mountain node - verify tiles render at different heights
2. Verify highlights align perfectly with tile surfaces
3. Verify clicking on elevated tiles selects correct tile
4. Verify unit stands at correct height when on elevated tile
5. Verify movement animation smoothly transitions between elevations
6. Verify server rejects moves that violate elevation rules
7. Test each archetype for distinct elevation characteristics

### Visual Verification
- Tiles appear raised (not like holes)
- Highlights render ON TOP of wall faces
- Wall faces visible on south/east edges of elevated tiles
- Grid squares align with tile diamonds at all elevations

---

## Execution Order

1. **Phase 1**: Core coordinate system (enables all other phases)
2. **Phase 2**: Unit positioning (depends on Phase 1)
3. **Phase 3**: Click detection (depends on Phase 1)
4. **Phase 5**: Sprite verification (can run parallel to 1-3)
5. **Phase 4**: Frontend/backend sync (depends on Phases 1-3)
6. **Phase 6**: Generation pipeline improvements
7. **Phase 7**: Archetype improvements (depends on Phase 6)
8. **Phase 8**: Elevation constraints (depends on Phase 6)

---

## Documentation Updates

After implementation:
- Update `docs/ROADMAP_GAMEPLAY.md` to mark elevation rendering complete
- Update `docs/TECHNICAL_ARCHITECTURE.md` with elevation rendering details
- Update `CLAUDE.md` to remove elevation-disabled gotchas
- Archive this plan to `docs/archive/COMPLETED_MILESTONES.md`
