# Modia - Completed Milestones Archive

This document archives all completed features, resolved issues, and historical development progress. The main roadmap now focuses only on remaining work.

**Archived:** January 2026

---

## Version History Summary

| Version | Date | Major Accomplishments |
|---------|------|----------------------|
| 9.11 | Jan 2026 | Battle Tile Rendering & Height System - Tile cycling for overlapping elevations, occlusion transparency, height movement animation with parabolic arc |
| 9.10 | Jan 2026 | Security & Testing Infrastructure - Redis-backed rate limiting, 70+ endpoint protection, Artillery load testing, E2E expansion (character creation, battle flow, error handling), enhanced health checks |
| 9.9 | Jan 2026 | Documentation Audit & Consolidation - Formula updates (level 2.8, skill polynomial costs), implementation status marking, roadmap verification, ~78% documentation alignment |
| 9.8 | Jan 2026 | Battle Map Visual Overhaul - 64 isometric terrain sprites, elevation rendering, movement sync fix (flat modifiers), removed decorative obstacles and cover system |
| 9.7 | Jan 2026 | Elevation-Aware Tilemap Rendering - Visual elevation in battle maps, coordinate transformation, 3D pathfinding sync, archetype elevation profiles |
| 9.6 | Jan 2026 | World & Progression Polish - Zodiac shrine system complete, relic collection modal, zodiac indicator HUD, quest markers system |
| 9.5 | Jan 2026 | Legacy Map Generation Removal - Removed all backward-compatibility code, archetype system is now the only code path |
| 9.4 | Jan 2026 | Battle Map Generation Overhaul - 8-phase modular system with archetypes, PRNG streams, constraint validation (tactical cover later removed) |
| 9.3 | Jan 2026 | Codebase Cleanup - Database fixes, constant deduplication, dead code removal, documentation updates |
| 9.2 | Jan 2026 | Daily/Weekly Quest System - Auto-assignment, progress hooks, streaks, bonuses, QuestBoardScene |
| 9.1 | Jan 2026 | Documentation Consolidation - Roadmap updates, quest documentation restructure, TODO audit |
| 9.0 | Jan 2026 | Gameplay Features - Audio system, settings expansion, elemental damage, battle log, gold sinks, relics |
| 1.0 | Jan 2026 | Initial project setup |
| 2.0 | Jan 2026 | XP-spending system, SKILL_TREES.md, ENEMY_SYSTEM.md |
| 3.0 | Jan 2026 | Status correction and blocking issues audit |
| 4.0 | Jan 2026 | Many working features verified (shop, marketplace, skills) |
| 5.0 | Jan 2026 | Real skills in battle, 4 advanced guilds, ColiseumScene |
| 5.1 | Jan 2026 | Turn event queue, camera fixes |
| 6.0 | Jan 2026 | Advanced AI system with utility-based scoring |
| 6.1 | Jan 2026 | Guild recruitment system |
| 6.2 | Jan 2026 | Comprehensive code review, 225+ new tests |
| 7.0 | Jan 2026 | Social & PvP systems, notifications, friends |
| 7.1 | Jan 2026 | Item naming conventions, marketplace augments design |
| 7.2 | Jan 2026 | Parchment UI theme overhaul |
| 7.3 | Jan 2026 | World map path system overhaul |
| 7.4 | Jan 2026 | Boss mechanics, Phase 6 progress |
| 7.5 | Jan 2026 | Map generation validation, AI strategic pathfinding |
| 7.6 | Jan 2026 | Title screen canvas animation |
| 7.7 | Jan 2026 | Comprehensive UI/UX styling overhaul |
| 7.8 | Jan 2026 | PixelLab integration removal, rate limiter refactoring |
| 7.9 | Jan 2026 | Icon system completion - 54 new SVG icons, emoji replacement |
| 8.0 | Jan 2026 | Roadmap audit, documentation cleanup, code fixes |
| 8.1 | Jan 2026 | ItemDataTable & Marketplace Enhancement - parchment price chart, order expiration |
| 8.2 | Jan 2026 | Profile Image Generation System - 92 programmatic SVG portraits for missing races and enemies |
| 8.3 | Jan 2026 | Formation System Improvements - BattleFormationScene shows all 12 characters, sorting options |
| 8.4 | Jan 2026 | Regional World Generation - 5-region Voronoi system with racial homelands |
| 8.5 | Jan 2026 | World Generation Improvements - New node types, guild distribution, zodiac shrines |
| 8.6 | Jan 2026 | Activity Nodes - Fishing, ruins puzzles, caravan merchants, watchtowers |
| 8.7 | Jan 2026 | Security Hardening - Trust proxy, per-user rate limiting, VPS deployment scripts |
| 8.8 | Jan 2026 | FFT-Style Formula Overhaul - CT turn system, defense diminishing returns, LCK scaling |
| 10.0 | Jan 2026 | Stacking Tile System & Extended Elevation - Extended elevation -3 to +8, stacking tile renderer, occlusion transparency, AI tile metadata reorganization |
| 10.1 | Jan 2026 | LoRA Model Selection & Admin Asset Pipeline - Per-asset style model selection, /api/admin/config endpoint, canonical asset paths, integration tests |

---

## 10.1 - LoRA Model Selection & Admin Asset Pipeline (Jan 2026)

Added per-asset LoRA model selection to the admin dashboard, enabling different visual styles for generated assets.

### LoRA Model Selection

**Available Models:**
| Model ID | Name | Trigger Word | Best For |
|----------|------|--------------|----------|
| `v1` | Flat 2D Pixel Art | `GRPZA` | Icons, portraits |
| `v2` | Isometric/Textured | `wbgmsst` | Terrain tiles |
| `modern-pixel` | Modern Pixel Art | `umempart` | Smooth gradients |
| `retro-pixel` | Retro 8-bit | `Retro Pixel` | Classic aesthetic |

**API Changes (`api/src/routes/admin.js`):**
- Added `loraModel` to `allowedFields` array for asset updates
- Added validation using centralized `VALID_LORA_MODELS` from `assetConstants.js`
- Added `GET /api/admin/config` endpoint returning `validLoraModels`, `loraModels`, `defaultLoraByCategory`

**UI Changes (`admin/src/components/AssetDetail.jsx`):**
- Added Style Model dropdown below Prompt field
- Shows category default hint when no model explicitly set
- Loads LoRA config from API (eliminates hardcoded model names)

### Asset Pipeline Improvements

**Canonical Path System:**
- `admin/src/lib/assetPathHelper.js` - Helper for canonical path generation with legacy fallback
- Updated `AssetCard`, `AssetPreviewCard`, audio components for consistent asset handling
- `generateCanonicalSizeVariants()` in `resizeUtils.js` for size variant generation

**Integration Tests:**
- `api/src/tests/integration/admin.integration.test.js` - 15 test cases for config endpoint and loraModel validation

### Files Modified
- `api/src/routes/admin.js` - loraModel validation, config endpoint
- `admin/src/components/AssetDetail.jsx` - Style Model dropdown
- `admin/src/lib/assetPathHelper.js` - NEW: canonical path helper
- `api/src/tests/integration/admin.integration.test.js` - NEW: integration tests
- `scripts/ai-images/lib/resizeUtils.js` - canonical size variant generation

---

## 9.10 - Security & Testing Infrastructure (Jan 2026)

Major infrastructure improvements addressing critical security gaps and expanding test coverage.

### Phase 1: Security Hardening

**Debug Endpoint Gating:**
- `api/src/routes/debug.js` - Debug endpoints now blocked in production regardless of DEBUG env var
- Added rate limiter as backup protection (5/min)

**Comprehensive Rate Limiting (70+ endpoints protected):**

| Limiter File | Endpoints Protected |
|--------------|---------------------|
| `economyRateLimiter.js` | Chest claims (10/min), stamina restore (5/min), shrines (5/min), relics (5/min), ruins solve (10/min), shop buy/sell (30/min), fast travel (10/min), discovery (10/min), fishing (30/min) |
| `characterRateLimiter.js` | Character create (3/15min), delete (2/15min), update (10/min), party manage (30/min) |
| `socialRateLimiter.js` | Friend requests (20/min), friend actions (30/min), block user (10/min), clan create (2/15min), clan invites (20/min), clan messages (30/min), clan manage (20/min) |

### Phase 2: Redis Integration

**Redis Configuration (`api/src/config/redis.js`):**
- Singleton client with reconnection logic
- `getRedisClient()`, `isRedisConnected()`, `isRedisConfigured()`
- `pingRedis()` for health checks
- Graceful fallback to in-memory when Redis unavailable

**Rate Limiter Factory Updates:**
- Added `rate-limit-redis` dependency
- `initializeRateLimiterStore()` - Initializes Redis store
- `isUsingRedisStore()` - Reports current store type
- Graceful fallback to memory store if Redis unavailable

**WebSocket Rate Limiting:**
- Redis sorted sets for sliding window algorithm
- `checkRedisRateLimit()` using ZADD/ZCOUNT operations
- Async `checkRateLimit()` with Redis fallback

### Phase 3: E2E Test Expansion

**Shared Test Helpers (`e2e/helpers/index.js`):**
- `TEST_USER` constant for consistent test credentials
- `login()`, `register()` - Authentication helpers
- `selectCharacter()`, `navigateToWorldMap()` - Navigation helpers
- `startBattle()`, `waitForBattleLoaded()`, `clickBattleAction()` - Battle helpers
- `debugWinBattle()` - Debug endpoint for quick battle completion

**New E2E Test Files:**

| File | Tests | Coverage |
|------|-------|----------|
| `character-creation.spec.js` | 8 | Race selection, class selection, name validation, creation success |
| `battle-complete.spec.js` | 13 | Enter battle, turn order, actions, rewards, state persistence |
| `error-handling.spec.js` | 11 | Auth errors, session handling, network errors, rate limiting, input validation |

### Phase 4: Load Testing Infrastructure

**Artillery.io Configuration (`load-tests/config.yml`):**
- 4 phases: warm-up (30s), ramp-up to 25 users (60s), sustained (120s), cool-down (30s)
- HTTP pool: 50 connections, 10s timeout
- Success metrics: p95 < 200ms, error rate < 1%

**Gameplay Scenarios (`load-tests/scenarios/gameplay.yml`):**

| Scenario | Weight | Flow |
|----------|--------|------|
| Shop interaction | 2 | Login → shop inventory → sell inventory |
| Inventory management | 3 | Login → full inventory → equipment |
| Social features | 2 | Login → friends list → requests → search |
| Quest and daily tasks | 2 | Login → active quests → daily quests |
| Leaderboard and rankings | 1 | Login → leaderboard categories → specific board |

**npm Scripts Added:**
```bash
npm run test:load           # Full load test
npm run test:load:quick     # Quick 10 users × 20 requests
npm run test:load:report    # Generate HTML report
npm run test:load:gameplay  # Gameplay scenarios only
```

### Phase 5: Enhanced Health Checks

**Health Endpoints (`api/src/routes/health.js`):**

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | Basic health for load balancers |
| `GET /api/health/ready` | Readiness with DB + Redis latency |
| `GET /api/health/live` | Liveness for Kubernetes probes |
| `GET /api/health/metrics` | Full metrics dashboard |

**Metrics Response Structure:**
```json
{
  "status": "healthy|degraded|unhealthy",
  "requests": { "total": 1000, "errors": 5, "errorRate": "0.5%" },
  "memory": { "heapUsedMB": 150, "heapTotalMB": 512, "rssMB": 200 },
  "database": { "status": "connected", "latency": 5, "pool": {...} },
  "redis": { "configured": true, "connected": true, "latency": 2 },
  "rateLimiter": { "store": "redis|memory", "stats": {...} },
  "websocket": { "connections": 12, "rooms": 5 }
}
```

### Files Created

| File | Purpose |
|------|---------|
| `api/src/config/redis.js` | Redis client singleton |
| `api/src/middleware/economyRateLimiter.js` | Economy endpoint protection |
| `api/src/middleware/characterRateLimiter.js` | Character endpoint protection |
| `api/src/middleware/socialRateLimiter.js` | Social endpoint protection |
| `e2e/helpers/index.js` | Shared E2E test utilities |
| `e2e/character-creation.spec.js` | Character creation E2E tests |
| `e2e/battle-complete.spec.js` | Battle flow E2E tests |
| `e2e/error-handling.spec.js` | Error handling E2E tests |
| `load-tests/config.yml` | Artillery configuration |
| `load-tests/scenarios/gameplay.yml` | Gameplay load test scenarios |

### Files Modified

| File | Changes |
|------|---------|
| `api/src/routes/debug.js` | Production gating, rate limiter |
| `api/src/routes/world.js` | Economy rate limiters applied |
| `api/src/routes/relics.js` | Relic claim rate limiter |
| `api/src/routes/ruins.js` | Ruins solve rate limiter |
| `api/src/routes/shop.js` | Buy/sell rate limiters |
| `api/src/routes/characters.js` | Character rate limiters |
| `api/src/routes/friends.js` | Friend action rate limiters |
| `api/src/routes/clans.js` | Clan operation rate limiters |
| `api/src/routes/health.js` | Enhanced metrics and Redis checks |
| `api/src/middleware/rateLimiterFactory.js` | Redis store support |
| `api/src/websocket/index.js` | Redis-backed rate limiting |
| `api/package.json` | redis, rate-limit-redis dependencies |
| `package.json` | Artillery dependency, load test scripts |
| `.env.example` | REDIS_URL configuration |

### Dependencies Added

```json
{
  "redis": "^4.x",
  "rate-limit-redis": "^4.x",
  "artillery": "^2.0.0"
}
```

---

## 10.0 - Stacking Tile System & Extended Elevation (Jan 2026)

Major refactoring of the battle map tile system to support taller structures and improved visual rendering.

### Elevation System Changes

| Component | Before | After |
|-----------|--------|-------|
| Elevation range | -1 to +3 | -3 to +8 (12 levels) |
| Pixels per level | 8 | 16 |
| Elevation names | PIT, GROUND, RAISED, HIGH, PEAK | DEEP_PIT, PIT, TRENCH, GROUND, RAISED, HIGH, VERY_HIGH, PEAK, SPIRE, TOWER, TOWER_TOP, CLOUD |
| MAX_DROP | 2 | 3 |
| CLIFF_THRESHOLD | 4 | 4 |

### Frontend Rendering

- **Stacking tile system**: Dynamic wall rendering based on elevation height
- **Occlusion transparency**: Tiles blocking unit visibility become 35% transparent
- **AssetLoader updates**: `getWallTexture()`, `getSlopeSprite()`, `getTopTileSprite()` methods
- **Fixed biome mapping**: Forest/bridge/castle now load from their directories (not base fallback)

### AI Tile Metadata Structure

- Reorganized `ai-image-metadata/tiles/` into floors/walls/slopes subdirectories
- Added base biome with fallback tiles for all terrain types
- Standardized terrain naming (grass_0, grass_1 instead of forest_grass_1)
- Updated manifest.json with categories, biome colors, and categoryFiles mappings

### Generation Scripts

- Local ComfyUI generation is now the default (`--local`)
- HuggingFace API available as fallback (`--huggingface`)
- Fixed output path to not add duplicate variant suffix
- `metadataUtils.js` now handles array values in categoryFiles

### Files Changed

| Category | Files |
|----------|-------|
| Backend | `shared/terrain.js`, `shared/mapgen/ElevationMapper.js`, `shared/pathfinding.js` |
| Frontend | `frontend/src/battle/BattleGrid.js`, `frontend/src/core/AssetLoader.js` |
| Scripts | `scripts/ai-images/generate-tiles.js`, `scripts/ai-images/lib/metadataUtils.js` |
| Metadata | `ai-image-metadata/tiles/**/*.json` (manifest + 16 biome/category files) |

---

## 9.9 - Documentation Audit & Consolidation (Jan 2026)

Comprehensive audit of all documentation with ~78% alignment between docs and implementation. Updated documentation to match actual implementation per user decision.

### Core Documentation Updates

| Document | Version | Key Changes |
|----------|---------|-------------|
| CHARACTER_PROGRESSION.md | 3.0 | Level formula to 2.8 exponent, polynomial skill costs `baseCost × (level+1)^1.5`, removed unimplemented tier multipliers |
| SKILL_TREES.md | 2.0 | Removed guild-level tier requirements, updated cost formula, simplified prerequisites |
| BATTLE_MODES.md | 1.1 | Added prominent implementation status section, marked PVE_COOP/PVP_TEAM/PVP_FFA as Post-MVP |
| GAME_DESIGN.md | 3.0 | Updated damage formulas with diminishing returns defense `DEF/(DEF+100)`, added reduction curve table |
| ITEM_SYSTEM.md | 3.0 | Added Section 12: Relic System (templates, acquisition, bonuses, UI) |
| API_SPECIFICATION.md | 2.3 | Verified all 24 route files documented |

### Roadmap Updates

| Document | Version | Key Changes |
|----------|---------|-------------|
| DEVELOPMENT_ROADMAP.md | 31.0 | Phase completion % adjusted, version alignment notes |
| ROADMAP_TECHNICAL.md | 2.1 | File sizes verified, known issues audited (2 resolved: party:invite_received naming, SkillTreePanel removed) |
| ROADMAP_GAMEPLAY.md | 7.0 | Deferred items marked, TavernScene status updated, BATTLE_MODES.md linked |

### Known Issues Resolved

| Issue | Resolution |
|-------|------------|
| Event name mismatch (party:invite) | Uses `party:invite_received` consistently |
| SkillTreePanel.js potentially unused | File removed from codebase |

### Formula Alignment Summary

| Formula | Old Documentation | Actual Implementation |
|---------|------------------|----------------------|
| Character Level | `100 × N^2.2` | `100 × N^2.8` |
| Skill Cost | `baseCost × (1 + (level-1) × 0.1)` | `baseCost × (level+1)^1.5` |
| Physical Defense | `DEF × 0.3` reduction | `DEF / (DEF + 100)` reduction |
| Magical Defense | `MDEF × 0.3` reduction | `MDEF / (MDEF + 80)` reduction |
| Guild Advancement | Guild Level 50 | Character Level 10 |

---

## 9.8 - Battle Map Visual Overhaul (Jan 2026)

Complete visual refresh of battle maps with procedurally generated isometric sprites, elevation rendering improvements, and critical movement synchronization fixes.

### Terrain Sprite System

| Component | File | Description |
|-----------|------|-------------|
| Sprite Generator | `scripts/generate-terrain-tiles.js` | Sharp-based SVG-to-PNG, 64 sprites total |
| Base Sprites | `terrain/base/{type}_{0-3}.png` | 7 terrain types × 4 variants |
| Elevation Sprites | `terrain/base/{type}_elev{1-3}.png` | Height variants for elevated tiles |
| Pit Sprites | `terrain/base/{type}_pit.png` | Darker recessed tiles for negative elevation |
| Asset Loading | `AssetLoader.js:getElevatedTile()` | Biome-specific sprite resolution with fallback |

### Color Palette Changes

| Terrain | Old Color | New Color | Purpose |
|---------|-----------|-----------|---------|
| rock | Gray (#808080) | Brown-red (#8b4513) | Clear distinction from stone |
| stone | Gray (#708090) | Warm gray (#8b8682) | Walkable tile clarity |

### Movement Sync Fix

| Issue | Fix | File |
|-------|-----|------|
| Percentage vs flat modifiers | Changed slow/haste from 50% to +/-1 | `BattlePathfinding.js` |
| Status effect structure | Added `e.type` check to match server | `BattlePathfinding.js` |
| Missing effects | Added stun/freeze/sleep to movement blockers | `BattlePathfinding.js` |
| Test coverage | 20 new tests validating sync | `movement-sync.integration.test.js` |

### Removed Systems

| System | Files Deleted | Reason |
|--------|---------------|--------|
| Decorative Obstacles | `obstacles/decorative/*.png` | Visual clutter, no gameplay value |
| CoverGridSystem | `CoverGridSystem.js`, test file | Tactical cover unnecessary for game design |
| Cover Strategy | Properties from 14 archetypes | Simplified map generation |

---

## 9.7 - Elevation-Aware Tilemap Rendering (Jan 2026)

Complete implementation of elevation-aware rendering for battle maps, enabling visual distinction of terrain height with proper coordinate transformation, click detection, and pathfinding synchronization.

### Core Rendering System

| Feature | File | Description |
|---------|------|-------------|
| Coordinate Transformation | `BattleGrid.js:gridToScreenWorld()` | Y offset by elevation × 8px per level |
| Depth Sorting | `BattleGrid.js:buildRenderOrder()` | Painter's algorithm with elevation consideration |
| Click Detection | `BattleGrid.js:screenToGrid()` | Diamond intersection test for elevated tiles |
| Tile Rendering | `BattleGrid.js:renderTileAt()` | Elevation sprite selection with wall face rendering |
| Cleanup | `BattleGrid.js:destroy()` | Intent highlight timer cleanup (memory leak fix) |

### Pathfinding Synchronization

- **Frontend**: `BattlePathfinding.js` now uses `getReachableTiles3D()` when elevation data available
- **Backend**: `movementService.js` validates movement using 3D pathfinding
- **Battle State**: Elevation data transmitted in battle API responses
- **Validation**: Server-side dimension validation for elevation arrays

### Generation Pipeline

| Feature | File | Description |
|---------|------|-------------|
| Elevation Profiles | `archetypeDefinitions.js` | 6 archetypes with elevation profiles (openField, caveRooms, mountainPass, bridgeCrossing, arena, volcano) |
| Generation Types | `AlgorithmPipeline.js:generateElevation()` | 4 types: rolling, depression, canyon, multiLevel |
| Deterministic Noise | `AlgorithmPipeline.js:_hashNoise()` | Fixed to use seed offset for determinism |
| Early Generation | `AlgorithmPipeline.js:runArchetype()` | Elevation generated before terrain when profile exists |

### Elevation Constraints

Added to `constraints.js`:
- `minElevationVariation` - Minimum elevation standard deviation
- `maxElevationVariation` - Maximum elevation standard deviation
- `minRampsPerLevelPair` - Accessibility requirement
- `maxPeakRatio` - Peak tile limit (default 10%)
- `maxPitRatio` - Pit tile limit (default 15%)
- `requireElevationAccessibility` - No stranded elevated areas
- `requireSpawnElevationAccess` - Spawns on traversable elevation

### Archetype Elevation Profiles

| Archetype | Type | Description |
|-----------|------|-------------|
| openField | rolling | Gentle hills (0-1 levels) |
| caveRooms | depression | Center lower, stalactite pits |
| mountainPass | canyon | High walls, canyon floor |
| bridgeCrossing | multiLevel | Raised bridge, pit hazards |
| arena | depression | Central depression, elevated edges |
| volcano | multiLevel | Raised platforms, lava pits |

### Files Modified

| File | Changes |
|------|---------|
| `frontend/src/battle/BattleGrid.js` | Coordinate system, rendering, click detection, cleanup |
| `frontend/src/battle/BattlePathfinding.js` | 3D pathfinding integration |
| `api/src/routes/battle.js` | Elevation data generation and validation |
| `api/src/services/battle/movementService.js` | 3D pathfinding for movement validation |
| `shared/mapgen/AlgorithmPipeline.js` | Elevation generation, deterministic noise |
| `shared/mapgen/archetypes/archetypeDefinitions.js` | Elevation profiles for 6 archetypes |
| `shared/mapgen/archetypes/constraints.js` | Elevation constraint definitions |
| `shared/mapgen/archetypes/index.js` | Export cleanup |

### Code Quality Fixes

- **Memory Leak**: Added `destroy()` method to BattleGrid.js for intent highlight timer cleanup
- **Determinism**: Fixed `_hashNoise()` to incorporate seed offset from random function
- **Validation**: Added dimension checks for elevation data in battle route

---

## 9.6 - World & Progression Polish (Jan 2026)

Completed the Zodiac Shrine Blessings system with full UI integration and enhanced the world map with quest markers and node tooltips.

### Zodiac Crystal Collection System

| Feature | File | Description |
|---------|------|-------------|
| RelicCollectionModal | `frontend/src/modals/RelicCollectionModal.js` | Modal displaying zodiac crystals and adventure relics with element-based coloring |
| ZodiacIndicator | `frontend/src/worldmap/ZodiacIndicator.js` | HUD element showing collection progress (X/12), click to open modal |
| NodeHoverTooltip | `frontend/src/worldmap/NodeHoverTooltip.js` | Enhanced with zodiac sign, element, blessing name, and crystal status |

### Zodiac Features

- 12 zodiac crystals with element-based coloring (fire/earth/air/water)
- Collection progress indicator in world map HUD
- Glow animation when new crystal collected
- Shrine tooltips show crystal availability status
- Relic modal shows all relics and zodiac collection

### API Endpoints (existing)

- `GET /api/world/zodiac-collection` - Returns collection progress and crystal status
- `GET /api/relics/owned` - Returns owned adventure relics

### Quest Markers System (existing, documented)

- `QuestMarkerManager.js` - Manages quest marker data for world map nodes
- `QuestProgressHUD.js` - Collapsible panel showing active quest progress

---

## 9.5 - Legacy Map Generation Removal (Jan 2026)

Removed all backward-compatibility code from the map generation system since there has never been a release. The archetype-based system is now the only code path.

### Removed Functions

- `generateTerrainLegacy()` - Old terrain generation
- `generateWithPipeline()` - Old pipeline wrapper
- `generateObstacleForTerrainLegacy()` - Old obstacle placement
- `generateObstacleForTile()` - Per-tile obstacle selection
- `generateObstacles()` - Old obstacle batch placement

### Removed Constants

- `OBSTACLE_MAP` - Terrain-to-obstacle mapping

### Removed Flags

- `useArchetypes` - Feature flag for new system
- `useNewPipeline` - Feature flag for pipeline mode

### Changes

- `generateTerrain()` now directly calls `generateWithArchetypes()`
- Unknown node types fall back to 'openField' archetype
- Removed unused imports (`getTerrainWeights`, `getObstacleRulesForTerrain`)
- Updated module documentation header

### Impact

- File reduced from 989 to 693 lines (~296 lines removed)
- All 265 tests continue to pass
- No changes to public API (same function signatures)

---

## 9.4 - Battle Map Generation Overhaul (Jan 2026)

Complete overhaul of the procedural map generation system for battle maps, implementing an 8-phase architecture with deterministic PRNG streams, curated archetypes, and tactical features.

### New Architecture

| Phase | Module | Purpose |
|-------|--------|---------|
| 8 | `PRNGStreams.js` | Isolated random streams (Mulberry32) for deterministic subsystems |
| 1 | `archetypes/` | 14 map archetypes with weighted node-type selection |
| 2 | `LayerContext.js` | Algorithm cooperation via shared state (noiseMap, seedRegions) |
| 3 | `graph/` | Topology-driven generation with POIs, MST + extra edges |
| 4 | `ConstraintValidator.js` | Constraint validation and automatic repair |
| 5 | ~~`CoverGridSystem.js`~~ | ~~Tactical cover (REMOVED - deemed unnecessary)~~ |
| 6 | `ElevationMapper.js` | First-class elevation integration |
| 7 | `StyleProfiles.js` | Style presets with parameter validation |

### New Files Created

```
shared/mapgen/
├── PRNGStreams.js           # Phase 8: Modular PRNG streams
├── LayerContext.js          # Phase 2: Algorithm cooperation
├── ConstraintValidator.js   # Phase 4: Validation & repair
├── ParameterSchema.js       # Phase 7: Parameter definitions
├── StyleProfiles.js         # Phase 7: Style presets
├── archetypes/
│   ├── index.js             # Re-exports
│   ├── archetypeDefinitions.js  # 14 archetype definitions
│   ├── ArchetypeSelector.js     # Weighted selection
│   └── constraints.js           # Constraint presets
└── graph/
    ├── index.js             # Re-exports
    ├── TopologyGraph.js     # Graph data structure
    ├── POIGenerator.js      # POI placement
    └── GraphBuilder.js      # MST + edge generation
```

### Unit Tests Added

- `PRNGStreams.test.js` - Stream isolation, determinism, forking
- `constraintValidator.test.js` - Validation, repair, violation detection
- `archetypes.test.js` - Archetype structure, selection, constraints

### Integration

- `generateWithArchetypes()` function integrating all 8 phases
- 265 tests pass (all existing + 4 new test suites)
- *Note: Legacy code and flags removed in v9.5*

### Key Features

- **Determinism:** Same seed always produces identical maps across all subsystems
- **Archetypes:** 14 curated map types (openField, forestClearing, caveRooms, tunnelNetwork, etc.)
- **Constraints:** Automatic validation and repair for walkable ratio, connectivity, dead ends
- **Style Profiles:** 6 profiles (clean, cluttered, natural, structured, organic, maze)

---

## 9.3 - Codebase Cleanup (Jan 2026)

Conservative cleanup of deprecated code, database mismatches, dead code, and documentation.

### Database Fixes

- **guildmasterBattleService.js:** Fixed column name mismatch (`base_stats`/`bonus_stats` → `stat_bonuses`)
- **Migration 038:** Added missing `base_vitality`, `base_luck`, `archetype`, `elemental_resistances` columns to `enemy_templates`
- **seed.js:** Updated enemy template INSERT to include all new columns

### Code Deduplication

- **COMBAT_NODE_TYPES:** Added to `shared/constants.js`, removed 8 duplicate definitions across:
  - `api/src/routes/world.js`
  - `api/src/routes/debug.js`
  - `api/src/routes/battle.js`
  - `frontend/src/scenes/WorldMapScene.js`
- **Pathfinding functions:** Removed duplicate `buildAdjacencyMap` and `bfsPath` from `world.js`, now imports from `pathfindingService.js`

### Dead Code Removal

Files removed:
- `api/src/db/testCastlePlacement.js` - Debug/test file
- `api/src/scripts/auditInvalidSkills.js` - One-time audit script
- `frontend/src/components/SkillTreePanel.js` - Unused since v8.2

Exports removed:
- `PathRenderer.js`: `catmullRomPoint` (made private), `getLegacyControlPoint` (deleted)
- `debugLogger.js`: `clearGameInstance`, `getGameInstance`

### Documentation Updates

- **TECHNICAL_ARCHITECTURE.md:** Added migrations 023-038 to index
- **API_SPECIFICATION.md:** Added 11 missing endpoint sections (Fishing, Ruins, Relics, Friends, LFG, Notifications, Advancement Quest, Daily/Weekly Quests, Coliseum, Clans, Chat)

---

## 9.2 - Daily/Weekly Quest System (Jan 2026)

Complete implementation of the Daily/Weekly Quest system with auto-assignment, progress tracking across 10 objective types, streak bonuses, and three bonus mechanics.

### Quest Assignment System

- **Auto-assignment:** 3 daily + 2 weekly quests assigned on first login of each period
- **Level-appropriate quests:** Selection filtered by character level with weighted randomization
- **Period management:** Daily reset at midnight UTC, weekly reset on Monday
- **Template system:** 25 quest templates covering 10 objective types

### Objective Types (10 Total)

| Objective | Trigger Location | Description |
|-----------|------------------|-------------|
| `kill_enemies` | battle.js | Count enemies defeated |
| `complete_battles` | battle.js | Complete N battles |
| `party_battles` | battle.js | Battles with multiple players |
| `visit_nodes` | world.js | Travel to unique nodes |
| `visit_regions` | world.js | Visit different regions |
| `fish_catches` | fishingService.js | Catch fish (any type) |
| `puzzle_solves` | ruins.js | Complete ruin puzzles |
| `gold_earned` | Multiple files | Cumulative gold from rewards |
| `items_sold` | marketplaceService.js | Sell items on marketplace |
| `coliseum_wins` | coliseumService.js | Win PvP matches |

### Streak System

- **Bonus scaling:** +10% per consecutive day (capped at +100%)
- **Streak tracking:** Database tracks current and longest streaks
- **Reset on miss:** Streak resets if daily quests aren't completed

### Three Bonus Mechanics

**Completion Bonus (25%):**
- Extra reward when ALL daily quests completed same day
- 25% bonus on total gold and XP earned
- Tracked per period in `completion_bonuses` table

**First Blood (+50%):**
- Server-wide race to complete each quest first
- First completer gets 50% bonus rewards
- Atomic claiming with partial unique index
- Leaderboard shows today's First Blood winners

**Perfect Week (7 consecutive days):**
- Complete all quests for 7 days straight
- Grants badge on profile/leaderboard
- Unlocks elite quest access
- 10% reward boost for following week
- Tracked in `character_perfect_weeks` table

### Backend Implementation

**New Service:** `api/src/services/dailyQuestService.js`
- `refreshQuestsIfNeeded()` - Auto-assign quests on login
- `getDailyQuests()` / `getWeeklyQuests()` - Fetch current quests
- `updateProgress()` - Fire-and-forget progress hooks
- `claimReward()` / `claimAllRewards()` - Atomic reward claiming
- `getStreakInfo()` - Streak and bonus calculations
- `tryClaimFirstBlood()` - Race-safe First Blood claiming
- `startCleanupScheduler()` - Expired quest cleanup

**New Routes:** `api/src/routes/quests.js`

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/quests/daily/:characterId` | Daily quests + streak |
| GET | `/api/quests/weekly/:characterId` | Weekly quests |
| POST | `/api/quests/:questId/claim` | Claim single quest |
| POST | `/api/quests/claim-all` | Claim all completed |
| GET | `/api/quests/streaks/:characterId` | Streak info |
| GET | `/api/quests/first-blood` | Today's First Blood winners |
| GET | `/api/quests/champions` | Perfect Week leaderboard |

### Progress Integration Hooks

Added fire-and-forget hooks to 7 files:
- `api/src/routes/battle.js` - Battle completion, kills, gold
- `api/src/routes/world.js` - Node visits, region visits
- `api/src/services/fishingService.js` - Fish catches
- `api/src/routes/ruins.js` - Puzzle completions
- `api/src/services/marketplaceService.js` - Item sales
- `api/src/services/coliseumService.js` - PvP wins

### Frontend Implementation

**New Scene:** `frontend/src/scenes/QuestBoardScene.js`
- Tab-based UI (Daily / Weekly tabs)
- Quest cards with progress bars
- Streak display with fire animation at 5+ days
- Live countdown to reset timer
- Claim All + individual claim buttons
- First Blood banner showing today's winners

**UI Integration:**
- Quest Board menu item in ProfileDropdown
- Scene registered in SceneManager.js
- 7 new API methods in client.js

### Database Changes

**Migration:** `api/src/migrations/035_quest_bonuses.sql`
- `first_blood` column on `daily_quest_history`
- Partial unique index for First Blood race safety
- `completion_bonuses` table for daily completion tracking
- `character_perfect_weeks` table with day tracking
- `quest_champions` view for leaderboard
- `todays_first_blood` view for winners
- Helper functions: `get_current_day_of_week()`, `get_weekly_period_start()`

### Files Created

| File | Purpose |
|------|---------|
| `api/src/services/dailyQuestService.js` | Quest service logic |
| `api/src/routes/quests.js` | API endpoints |
| `api/src/migrations/035_quest_bonuses.sql` | Bonus tracking schema |
| `frontend/src/scenes/QuestBoardScene.js` | Quest UI scene |
| `api/src/tests/unit/dailyQuestService.test.js` | Unit tests |
| `api/src/tests/integration/quests.integration.test.js` | Integration tests |

### Files Modified

| File | Changes |
|------|---------|
| `api/src/index.js` | Register routes, start scheduler |
| `api/src/routes/battle.js` | Progress hooks |
| `api/src/routes/world.js` | Progress hooks |
| `api/src/services/fishingService.js` | Progress hooks |
| `api/src/routes/ruins.js` | Progress hooks |
| `api/src/services/marketplaceService.js` | Progress hooks |
| `api/src/services/coliseumService.js` | Progress hooks |
| `frontend/src/api/client.js` | Quest API methods |
| `frontend/src/core/SceneManager.js` | Scene registration |
| `frontend/src/ui/parchment/ProfileDropdown.js` | Menu item |

---

## 9.1 - Documentation Consolidation (Jan 2026)

Comprehensive documentation audit and roadmap maintenance ensuring alignment between code and specifications.

### Items Marked Complete

Previously marked as "Not Started" but found fully implemented:

- **Skill Cooldowns** (battleService.js:1317-1322, 1777-1781): Backend fully implemented with skillCooldowns object tracking per-unit cooldowns, enforcement before skill use, and decrement at end of turn
- **Status Effect Duration Display** (BattleUnit.js): Duration numbers now displayed on status effect icons
- **Mini-map Display** (WorldMapMinimap.js): Full 700+ line implementation with click-to-navigate, fog of war, region colors, parchment frame styling

### TODO Items Documented

Code audit discovered stubbed/placeholder features now tracked in roadmaps:

| Item | Location | Status |
|------|----------|--------|
| Quest completion verification for relics | relicService.js:206 | TODO |
| Item drops from treasure chests | world.js:973 | Stubbed (gold only) |
| Lore content system | world.js:1147 | Generic placeholder |
| Quick party formation UI | SocialHubScene.js:479 | Placeholder |
| Clan chat/management | SocialHubScene.js:518 | Placeholder |
| Debug endpoint gating | battle.js:900 | Security TODO |

### Quest Documentation Restructure

Reorganized quest documentation from single file to modular structure:

- **QUEST_SYSTEM.md** - Index document linking quest types
- **GUILD_ADVANCEMENT.md** - Detailed guild progression quest spec (from original QUEST_SYSTEM.md)
- **DAILY_WEEKLY_QUESTS.md** - New daily/weekly quest specification

### Files Modified

- `docs/DEVELOPMENT_ROADMAP.md` - v25.0, skill cooldowns marked complete
- `docs/ROADMAP_GAMEPLAY.md` - v6.0, status duration/minimap complete, TODO items added
- `docs/ROADMAP_TECHNICAL.md` - v1.6, debug endpoint added to security checklist
- `docs/archive/completed/COMPLETED_MILESTONES.md` - v9.1 entry added
- `docs/QUEST_SYSTEM.md` - Restructured as index document
- `docs/GUILD_ADVANCEMENT.md` - New file (from QUEST_SYSTEM.md content)
- `docs/DAILY_WEEKLY_QUESTS.md` - New specification file
- `docs/archive/deprecated/QUEST_SYSTEM_v1.md` - Archived original

---

## 9.0 - Gameplay Features (Jan 2026)

Major gameplay feature release implementing 5 key systems for enhanced player experience.

### Settings Expansion (7 Categories, ~44 Settings)

Complete settings system overhaul with 7 organized categories:

- **Battle Settings:** Camera follow mode, pan speed, lerp speed, movement/attack previews, terrain costs, confirm actions, auto-end turn, skip enemy animations, turn order display, health bars, status icons, battle log verbosity
- **Audio Settings:** Master volume, music volume, SFX volume, individual mute toggles
- **Display Settings:** Animation quality, damage numbers, grid overlay, health bar visibility
- **Accessibility Settings:** Colorblind modes (protanopia, deuteranopia, tritanopia), high contrast mode, reduced motion, text size scaling
- **Gameplay Settings:** Tutorial toggles, auto-save settings, purchase confirmations
- **Social Settings:** Online status visibility, party invite preferences, chat settings
- **Controls Settings:** Keybind customization, mouse sensitivity, touch gesture settings

### Audio System (Web Audio API)

Complete audio implementation using Web Audio API:

- **AudioManager.js:** Centralized audio control with volume management
- **Scene-based music:** Different tracks for world map, battle, menus
- **SFX system:** UI sounds (clicks, hovers), battle sounds (attacks, damage, healing)
- **Volume controls:** Master, music, and SFX sliders wired to settings
- **Mute toggles:** Individual channel muting with visual feedback

### Elemental Damage System (8 Elements)

Tactical depth through elemental interactions:

- **8 Elements:** Fire, Ice, Lightning, Earth, Wind, Water, Light, Dark
- **Resistance system:** Enemies and races have elemental resistances/weaknesses
- **Enemy templates:** Elemental affinities per enemy type (e.g., fire slimes weak to ice)
- **Racial templates:** Player races have innate elemental modifiers
- **Skill integration:** Skills can have elemental types affecting damage calculation

### Battle Log Panel

Scrollable combat history for tactical awareness:

- **BattleLogPanel.js:** Dedicated UI component in battle scene
- **Color-coded entries:** Damage (red), healing (green), status effects (yellow), movement (blue)
- **Auto-scroll:** Follows latest action with manual scroll override
- **Verbosity settings:** Configurable detail level (minimal, normal, detailed)
- **Entry persistence:** Full battle history preserved during combat

### Gold Sinks + Relic System

Economy balancing with valuable collectibles:

**Gold Sinks:**
- Marketplace fee: 5% seller fee on all sales
- Fast travel costs: 50-500g based on distance
- Stamina restore: 100g per stamina point

**Relic System:**
- Relic item category with unique templates
- Discovery through ruins exploration and special events
- Permanent stat bonuses from owned relics
- Collection UI showing owned relics and effects

### Files Created/Modified

**New Files:**
- `frontend/src/audio/AudioManager.js`
- `frontend/src/battle/BattleLogPanel.js`
- `frontend/src/config/elements.js`
- `api/src/config/elements.js`
- `api/src/db/templates/relics.js`

**Modified Files:**
- `frontend/src/scenes/SettingsScene.js` - Complete redesign with 7 tabs
- `frontend/src/core/SettingsManager.js` - Event-driven settings updates
- `api/src/services/battleService.js` - Elemental damage calculation
- `api/src/db/templates/enemies.js` - Elemental resistances
- `shared/constants.js` - Racial elemental modifiers
- `api/src/routes/marketplace.js` - 5% seller fee
- `api/src/routes/world.js` - Fast travel costs, stamina purchase

---

## 8.8 - FFT-Style Formula Overhaul (Jan 2026)

Complete tactical combat rebalance implementing FFT-style mechanics with meaningful stat choices.

### Defense Formula Rebalance
- Percentage-based damage reduction with diminishing returns
- Physical: `defense / (defense + 100)`
- Magical: `defense / (defense + 80)`
- Effective cap at ~80% reduction (300+ defense)
- VIT contributes to physical defense, INT/2 to magic defense

### CT Turn Order System
- CT gain formula: `5 + (AGI / 10)` - diminishing returns
- Haste/Slow modifiers (1.5x / 0.5x)
- Action at CT >= 100 threshold
- Initial CT: `(AGI / 2) + random(0, 20)`

### LCK Stat Overhaul
- LCK now grows with level (0.3-1.5 per level by class)
- Crit chance: `5% base + LCK/300` (cap 50%)
- Crit damage: `1.5 + LCK/500` (orcs +15% bonus)
- Evasion: `2% base + agiDiff/400 + LCK/400` (cap 35%)
- Status resistance: `10% base + LCK/200` (cap 50%)

### VIT HP Bonus
- HP formula: `baseHP + floor(level/2 + VIT * 0.5)`
- High VIT builds have significantly more HP

### Enemy Scaling
- Archetype-based growth rates (beast, humanoid, undead, elemental, dragon, boss)
- Tier multipliers: 0.8x/1.0x/1.25x/1.5x/2.0x

### Skill Progression
- Polynomial cost: `baseCost * level^1.5` (achievable max level)
- Power scaling: +0.8%/level for basic, +0.5%/level for advanced

### Files Modified
- `shared/battleMath.js` - Core damage and CT formulas
- `api/src/services/battleService.js` - Damage calculation integration
- `api/src/config/skillScaling.js` - Skill cost and power curves
- `api/src/db/templates/enemies.js` - Archetype-based scaling

### Tests Added
- `api/src/tests/unit/formulaValidation.test.js` - 31 balance tests

---

## 8.7 - Security Hardening & VPS Deployment (Jan 2026)

Comprehensive security improvements and production deployment infrastructure.

### Trust Proxy Configuration
- Express `trust proxy` properly configured for reverse proxy IP detection
- X-Forwarded-For header parsing for real client IPs
- Per-user rate limiting now works correctly behind Nginx

### Rate Limiting Improvements
- Per-user rate limiting for authenticated requests
- New rate limiters:
  - `auth/refresh`: 20 requests / 15 minutes (IP-based)
  - `world/travel`: 60 requests / minute (per-user)
  - Gameplay actions: skill 30/min, inventory 45/min
- Increased global limits (300 base, 600 production, 1500 development)

### JWT Token Security
- Access tokens extended to 1 hour (from 15 minutes)
- Automatic refresh 1 minute before expiry
- `TokenRefreshManager` for seamless token renewal
- 7-day refresh token rotation

### VPS Deployment Scripts
- `deploy/setup.sh` - Node.js 20 LTS, PM2, PostgreSQL, Nginx installation
- `deploy/deploy.sh` - Zero-downtime deployment with PM2 reload, rollback support
- `deploy/nginx.conf.template` - WebSocket upgrade, SSL, compression, caching
- `deploy/backup.sh` - Automated pg_dump with 7-day retention, S3 support ready

### Files Created
- `deploy/setup.sh`
- `deploy/deploy.sh`
- `deploy/nginx.conf.template`
- `deploy/backup.sh`
- `api/src/utils/tokenRefreshManager.js`

---

## 8.6 - Activity Nodes Implementation (Jan 2026)

Complete implementation of all 4 activity node systems providing non-combat content.

### Fishing System
- `FishingScene.js` - Auto-fishing UI with idle mechanics
- `fishingService.js` - Session management, catch calculation
- 15 fish types across 5 rarity tiers
- "Big One" events with weight multipliers
- Regional fish distribution

### Ruins Puzzle System
- `RuinsPuzzleModal.js` - Sliding tile puzzle minigame
- 3x3 / 4x4 / 5x5 grid sizes by difficulty tier
- Regional themes (forest ruins, mountain ruins, etc.)
- One-time completion per ruins node
- Gold and item rewards by tier

### Caravan Merchant System
- Extended `ShopScene.js` with caravan tab
- `caravanService.js` - Exclusive item management
- 23 exclusive items not available in regular shops
- 48-hour seeded refresh cycle
- Stock tracking per caravan

### Watchtower System
- `world.js` watchtower-view endpoint
- Fog reveal for nearby undiscovered nodes
- One-time activation per watchtower
- Reveal radius based on watchtower tier
- **Enhanced (Jan 2026):** Pixel-based radius (3000px default), revealed nodes show actual names with golden styling, individual fog clearing per node with distance-based opacity

### Security
- FOR UPDATE locks on concurrent access
- MAX_GOLD caps preventing overflow
- Input validation on all endpoints

---

## 8.5 - World Generation Improvements (Jan 2026)

Enhanced world variety with new node types and better distribution.

### New Node Types
- Fishing spots - Resource mini-game locations
- Merchant caravans - Traveling traders with exclusive inventory
- Ruins - Puzzle/exploration for treasure
- Watchtowers - Reveal nearby undiscovered nodes
- Farms - Additional settlement type for outer areas

### Guild Distribution Enhancement
- 3 guilds per region (up from 1)
- Primary guild in Ring 1 (race-appropriate type)
- 2 secondary guilds in Rings 2-3 (different types)
- Race-to-guild mapping: Orc→Warrior, Elf→Wizard, Human→Monk, Dwarf→Chemist

### Zodiac Shrine System
- 12 zodiac shrines placed (one of each type)
- Shrine placement: outer areas, MIN_SPACING=15
- `shrine_buff_type` column for zodiac identification
- Future: Unique blessings per zodiac type

### Node Distribution Rebalancing
- Target: 40-50% battle nodes (down from 60-70%)
- Target: 20-30% activity/neutral nodes
- Target: 20-30% settlements

- Farms in outer areas, not near castles

### Migration
- `031_expanded_node_types.sql`

---

## 8.4 - Regional World Generation (Jan 2026)

Major world generation overhaul replacing single-castle world with 5-region Voronoi-based system.

### 5-Region System
- Voronoi partitioning from castle positions (d3-delaunay)
- Force-directed castle placement (25 unit minimum distance)
- Lloyd's relaxation for even spread
- Organic region boundaries stored as polygons

### Racial Regions
- Heartlands (Human) - Forest dominant
- Sylvan Reaches (Elf) - Forest dominant
- Iron Depths (Dwarf) - Cave dominant
- Shadowmere (Vampire) - Cave dominant
- Bloodplains (Orc) - Mountain dominant

### Ring-Based Structure
- Ring 0 - Castle core (battle node guards)
- Ring 1 - Inner civilization (cities, villages)
- Ring 2 - Frontier (keeps, guilds)
- Ring 3 - Wilderness edge (terminators)

### Inter-Region Connections
- Bridge chokepoints (1-2 per border)
- Border wilderness zones (mixed terrain)
- Trade routes (safe corridors between cities)
- Grand Palace at multi-region vertex

### Character Spawning
- Race-based spawn at racial homeland castle
- `home_region_id` tracking for respawn
- Updated character creation flow

### Worldgen Modules
- `api/src/db/worldgen/castlePlacement.js`
- `api/src/db/worldgen/voronoiPartitioning.js`
- `api/src/db/worldgen/nodeGeneration.js`
- `api/src/db/worldgen/internalConnections.js`
- `api/src/db/worldgen/interRegionConnections.js`
- `api/src/db/worldgen/validation.js`

### Migration
- `029_regional_world.sql`

---

## 8.3 - Formation System Improvements (Jan 2026)

Enhanced BattleFormationScene and FormationScene with better character management.

### BattleFormationScene Enhancements
- Show all 12 party characters (was limited to 5)
- Click-to-cycle through all 12 characters for placement
- Direction indicator (red border highlight) showing enemy side
- Level-based default sorting for character roster

### FormationScene Improvements
- Sorting options (Level, Class, Name) with toggle buttons
- Remove empty slot placeholders (show only existing characters)

### Code Quality
- Timer cleanup on scene exit
- Canvas save/restore for proper state management
- Stable sorting algorithm for consistent ordering

---

## 8.2 - Profile Image Generation System (Jan 2026)

Programmatic SVG-based portrait generation system for character races and enemies, extending the existing icon generation infrastructure.

### Scope
- **92 new portraits total:** 76 character portraits + 16 enemy portraits
- **Character coverage:** Dwarf, Vampire, Orc races (all 8 classes × 3 genders each = 72) + 4 missing Elf other variants
- **Enemy coverage:** All 16 enemy types (goblin_warrior, gray_wolf, forest_slime, cave_bat, giant_spider, skeleton_warrior, stone_golem, mountain_troll, troll_shaman, harpy, bridge_bandit, bandit_captain, bridge_troll, dark_knight, shadow_assassin, palace_guard)

### New Files Created
- `scripts/icons/portraits/utils.js` - Pixel-art portrait utilities, color palettes (SKIN_PALETTES, HAIR_PALETTES, EQUIPMENT_PALETTES), helper functions (pixel, fillRect, pixelEllipse, drawEyes, drawNose, drawMouth, drawTusks, etc.)
- `scripts/icons/portraits/races.js` - Race+gender base template generators for Human, Elf, Dwarf, Vampire, Orc with distinct features (pointed ears, beards, tusks, fangs)
- `scripts/icons/portraits/classes.js` - Class equipment overlay generators for 8 classes (warrior helmet, wizard hat, monk headband, chemist goggles, berserker horns, sorcerer circlet, ninja mask, alchemist gear)
- `scripts/icons/portraits/enemies.js` - 16 detailed enemy portrait generators using PALETTES from parent utils
- `scripts/generate-svg-portraits.js` - Main orchestration script combining race + gender + class layers

### Files Modified
- `scripts/generate-icons.js` - Added `--portraits` flag and `generatePortraits()` function for SVG→PNG conversion
- `package.json` - Added `generate:svg-portraits` and `generate:portrait-pngs` npm scripts

### Generated Assets
- **SVG source files:** `frontend/public/assets/sprites/portraits/svg/` (76 character SVGs)
- **Character PNGs:** `frontend/public/assets/sprites/portraits/` (120 total: 44 existing + 76 new)
- **Enemy SVGs/PNGs:** `frontend/public/assets/sprites/enemies/` (16 files)

### Technical Approach
- **Hybrid SVG rendering:** Rects for pixel details, paths for large fills (efficient file size)
- **64×64 viewBox:** Matches typical portrait resolution
- **shape-rendering="crispEdges":** Prevents anti-aliasing for pixel-art style
- **Layered composition:** Background → shoulders → face → features → hair → equipment
- **No overwrites:** Generator skips existing files to preserve hand-crafted portraits

### Commands
```bash
npm run generate:svg-portraits   # Generate SVG portraits
npm run generate:portrait-pngs   # Convert to PNG (via generate-icons.js --portraits)
```

---

## 8.1 - ItemDataTable & Marketplace Enhancement (Jan 2026)

Complete marketplace overhaul with modular ItemDataTable component, parchment-themed price charts, and backend scheduling services.

### New Files Created
- `frontend/src/components/MarketDashboard.js` - Canvas-based price chart with hand-drawn parchment aesthetic
- `api/src/services/shopRefreshService.js` - Periodic shop restocking (blacksmith 24h, apothecary 12h, farm 6h)
- `api/src/services/orderExpirationService.js` - 7-day order expiration with gold/item release
- `api/src/migrations/023_order_expiration.sql` - 'expired' status enum, expiration index
- `api/src/tests/unit/orderExpirationService.unit.test.js` - 8 unit tests for expiration service
- `api/src/tests/unit/shopRefreshService.unit.test.js` - 11 unit tests for shop refresh service
- `api/src/tests/integration/marketplace.integration.test.js` - 21 integration tests for marketplace API

### Frontend Enhancements
- **ShopScene.js:** ItemDataTable integration for Buy/Sell tabs with supply level badges
- **MarketplaceScene.js:** ItemDataTable for Browse tab, My Listings tab (fixed), My Inventory tab (new)
- **MarketDashboard.js:** Price history chart (7-day), bid/ask spread, 24h activity stats
- **itemDataTableColumns.js:** supplyLevel column, JSDoc documentation for all columns
- **ParchmentTheme.js:** Button CSS helper for consistent styling

### Backend Features
- **Order Expiration System:** Hourly scheduler expires orders > 7 days, releases reserved gold (buy orders) or escrowed items (sell orders), WebSocket notifications, audit logging
- **Shop Refresh Service:** Additive restocking (25% per cycle), transaction-wrapped updates, configurable intervals per shop type
- **Sellable Inventory API:** `GET /api/marketplace/inventory/sellable` - returns unequipped, tradeable items not already listed
- **Augment Filter Fix:** Corrected parameter indexing in searchItemsWithAugments()

### Code Quality Fixes
- SQL injection fixed in orderExpirationService.js (parameterized query)
- Column reference fixed (item_listings vs marketplace_listings)
- Canvas save/restore added to MarketDashboard.js
- Event listener memory leak fixed in MarketDashboard buy button
- Transaction handling added to shopRefreshService.js

### Tests Added (40 total)
- Order expiration service: 8 unit tests
- Shop refresh service: 11 unit tests
- Marketplace API: 21 integration tests

---

## 8.0 - Roadmap Audit & Documentation Cleanup (Jan 2026)

Comprehensive audit of TODO markers, roadmaps, and documentation to ensure alignment between code and docs.

### Roadmap Updates
- **ROADMAP_GAMEPLAY.md (v2.2):** Added Section 2.4 Battle Balance (defense formula, agility, enemy abilities), Section 3.4 Gold Sinks, Section 5.3 Social Features (FriendsScene, Tavern 2.0)
- **ROADMAP_TECHNICAL.md (v1.1):** Added completed integration tests to Section 3.2 (battle reconnection, coliseum, item drop, party WebSocket)
- **DEVELOPMENT_ROADMAP.md (v10.0):** Updated phase percentages, sprint focus

### Documentation Archived
- `GAME_MECHANICS_IMPROVEMENTS.md` → `docs/archive/deprecated/` with consolidation notice
- `TECHNICAL_IMPROVEMENTS.md` → `docs/archive/deprecated/` with consolidation notice
- `pending-features-consolidated.md` updated with completion status (v4.0)

### Code Fixes
- **WorldMapScene.js:** Wired up PartyInviteModal in `party:invite_received` handler
- **ProfileDropdown.js:** Friends button now navigates to CourtyardScene (until FriendsScene created)
- **CourtyardScene.js:** Friend request button now calls `/api/friends/request/:username` API

### New Documentation
- **QUEST_SYSTEM.md (v1.0):** Comprehensive documentation of guild advancement quest system including database schema, API endpoints, progress tracking, boss mechanics

### Technical Updates
- **TECHNICAL_ARCHITECTURE.md:** Migration index updated with migrations 014-022

### Findings Summary
| Category | Finding | Resolution |
|----------|---------|------------|
| Code TODO | PartyInviteModal exists but not wired | Wired in WorldMapScene |
| Code TODO | Friends button shows "coming soon" | Navigates to CourtyardScene |
| Code TODO | CourtyardScene friend button broken | API call implemented |
| Documentation | Migration index outdated (013) | Updated to 022 |
| Documentation | No QUEST_SYSTEM.md | Created from code analysis |
| Status discrepancy | Boss Mechanics marked "Not started" | Corrected to COMPLETE (v7.4) |
| Status discrepancy | Friend System marked complete | Clarified: backend only, no FriendsScene |

---

## 7.9 - Icon System Completion (Jan 2026)

Comprehensive icon system overhaul replacing emoji icons with consistent SVG-based icons.

### New Icon Categories Created
- **notifications/** (7 icons) - friend-request, friend-accepted, party-invite, match-found, match-result, lfg-application, system
- **classes/** (6 icons) - warrior, mage, rogue, cleric, ranger, paladin
- **items/** (11 icons) - weapon, shield, helmet, armor, boots, accessory, ring, necklace, consumable, material, key
- **augments/** (16 icons) - fire, ice, lightning, poison, holy, dark, strength, intelligence, agility, vitality, luck, critical, defense, dragon-slayer, undead-slayer, demon-slayer

### Core Icons Added
- **actions/** - back, harvest, recruit, advance, social (5 new)
- **menu/** - stats, skills, leaderboard (3 new)
- **nodes/** - throne, temple, stables, training (4 new)

### Code Fixes
- Fixed category naming mismatch (`'action'` → `'actions'`) in FormationScene.js, InventoryScene.js, WorldMapScene.js
- Updated WorldMapScene iconMap to use existing asset names instead of action-verb names

### Component Updates
- ProfileDropdown.js - Uses Icon component for menu items, notifications, class avatars, gold display
- InventoryPanel.js - Uses Icon component for item type fallbacks
- MarketplaceItemPanel.js - Uses Icon component for augment icons

### Total Icons
- 90 SVG source files across 10 categories
- 360 PNG files generated (4 sizes: 16, 24, 32, 48px)

---

## Resolved Blocking Issues

All critical blocking issues have been resolved:

| Issue | Resolution |
|-------|------------|
| PvP action endpoint broken | Fixed in battle.js:action |
| PvP battle transition incomplete | ColiseumScene now transitions correctly |
| Party invite modal missing | PartyInviteModal.js implemented |
| No multi-player party tables | 009_multiplayer_support.sql migration |
| Database 2-player limit | battle_players table added |
| Leaderboards missing | LeaderboardScene.js implemented |
| Skill-based matchmaking | PPR-based matchmaking implemented |
| Rate limiting on marketplace batch | marketplaceRateLimiter.js |
| Rate limiting on battle actions | battleRateLimiter.js |
| Rate limiting on WebSocket messages | checkRateLimit in websocket/index.js |
| Event listener leak in Game.js | destroy method with cleanup |
| Event listener leak in InputHandler.js | destroy method with cleanup |
| Doc: Race traits mismatch | GAME_DESIGN.md corrected |
| Doc: Critical chance cap | GAME_DESIGN.md corrected |
| Doc: XP formula exponent | GAME_DESIGN.md corrected |

---

## Major Feature Completions

### Battle System Architecture (v5.1)
- Hybrid HTTP/WebSocket battle system
- Turn event queue system
- Camera transition timing
- AI pathfinding with obstacles
- Async-only architecture (deprecated sync mode removed)

### Battle Formation Scene Enhancement (v7.2)
- Refactored layout with side drawer
- 6 themed environments (Battlefield, Pit Fighter, Arcane Chamber, Armory, Dojo, Clockwork)
- Mobile responsive layout with bottom sheet
- Environmental animations and rising tension system

### Guild Recruitment System (v6.1)
- 5 new database tables (traits, guild_recruits, recruit_traits, recruit_skills, character_traits)
- 31 traits in 4 categories (combat, survival, utility, situational)
- Procedural name generator (300 names)
- Lazy refresh system, RecruitmentScene UI

### Advanced AI System (v6.0)
- Utility-based scoring with 9 weighted factors
- Multi-actor lookahead (2-3 turns)
- 9 AI patterns (aggressive, defensive, support, tactical, pack, ambush, berserker, ranged, boss)
- Monster skill trees (9 archetypes)
- Performance optimized with alpha-beta pruning, transposition table

### Social & PvP Systems (v7.0)
- Notification system (service, API, ToastManager, NotificationBell, NotificationCenter)
- Friend system (requests, blocking, favorites, search)
- Party system fixes (PartyInviteModal, PartyStatusBar)
- CourtyardScene (Palace social hub with LFG board)
- PPR-based matchmaking with weighted ELO
- PvP turn timer (60s), surrender/forfeit with rating penalties

### Marketplace Security & UI Enhancement
- Rate limiting middleware, max 10 open orders per user
- Audit logging system
- Castle node access middleware
- WebSocket real-time updates
- Medieval parchment UI theme

### UI/UX Parchment Theme Overhaul (v7.2)
- 8 reusable parchment-styled components
- Responsive framework with 3 breakpoints
- SVG icon system with 6 categories
- All 15 scenes migrated to parchment theme

### World Map Enhancements (v7.3)
- Multi-node travel with stamina system
- Character visualization with walking animation
- Catmull-Rom spline paths
- Progressive fog-of-war reveal
- Dynamic curve variance system

### Map Generation & AI Pathfinding (v7.5)
- Path validation with hasValidPath, analyzeMapConnectivity
- Deterministic path carving for seeded consistency
- Rebalanced mountain terrain (40% → 25% impassable)
- Strategic pathfinding for multi-turn AI movement
- 51 new tests (26 map generation, 25 AI pathfinding)

### Title Screen Animation (v7.6)
- Canvas-drawn pixel art cinematic intro
- 15 new files in frontend/src/title/
- 8-phase state machine, 6.5s timeline
- Skip detection with localStorage persistence

### UI/UX Styling Overhaul (v7.7)
- Element color system in ParchmentTheme (fire, ice, lightning, passive, physical, nature, dark, light, arcane)
- Gold display fix: ProfileDropdown now uses user.gold instead of party.gold
- Gold display redesigned with floating element below profile button, black text outline for readability
- Profile button visibility restricted to WorldMapScene only
- Blocked node display: undiscovered blocked nodes show "Mystery Location", lock icon only on visited blocked nodes
- Locked path indicator: red tint + lock icon on paths leading to undiscovered blocked nodes
- SkillTreePanel color corrections: dark brown text, element icons with muted backgrounds
- FormationScene widget titles fixed: dark brown text with gold left border accent
- Progress bar text readability: dark outline + shadow on stamina bar and skill panels
- Toast consolidation: BattleUI, RecruitmentScene, InventoryPanel migrated to parchmentToast
- Icon component fix: empty alt attribute when label exists to prevent duplication

### PixelLab Integration Removal & Rate Limiter Refactoring (v7.8)
- Removed AI sprite generation integration (17 files deleted, 6000+ lines)
- Archived prompt templates to `docs/archive/deprecated/IMAGE_GENERATION_PROMPTS.md` for future use
- Existing generated sprite assets preserved in `frontend/public/assets/sprites/`
- Rate limiter factory pattern introduced (`rateLimiterFactory.js`)
- Test reorganization: moved to `integration/`, `unit/`, `ratelimit/` directories
- New rate limit tests for auth, battle, and marketplace endpoints

---

## Test Coverage Improvements (v6.2)

| Test File | Tests Added | Coverage Area |
|-----------|-------------|---------------|
| chatService.test.js | 21 | Message persistence, history, DMs, reactions |
| presenceService.test.js | 27 | Typing indicators, node presence, cache |
| coliseumService.test.js | 28 | Queue management, matchmaking, cleanup |
| partyWebsocket.test.js | 31 | Invites, broadcasts, room management |
| websocketIndex.test.js | 44 | Core WebSocket module, utilities, rooms |
| battleMechanics.test.js | 75+ | CT turn order, AI patterns, damage formulas, status effects |

**Total New Tests:** 225+ across 6 new test files.

---

## Phase Completion Summary

| Phase | Name | Status |
|-------|------|--------|
| 1 | Foundation | 100% Complete |
| 2 | Characters & World | 95% Complete |
| 3 | Combat System | 90% Complete |
| 4 | Economy & Inventory | 95% Complete |
| 5 | Multiplayer | 85% Complete |
| 6 | Polish & Launch | 45% In Progress |

---

## Documentation Created

- PROJECT_REQUIREMENTS.md (v2.0)
- TECHNICAL_ARCHITECTURE.md (v2.0)
- GAME_DESIGN.md (v2.0)
- API_SPECIFICATION.md (v2.0)
- CHARACTER_PROGRESSION.md (v2.0)
- ITEM_SYSTEM.md (v2.0)
- ECONOMY_SYSTEM.md (v2.0)
- SKILL_TREES.md (v1.0)
- ENEMY_SYSTEM.md (v1.0)
- BATTLE_TURN_SYSTEM.md (v1.0)
- BATTLE_MESSAGING_PROTOCOL.md (v1.0)
- BATTLE_RECONNECTION.md (v1.0)
- BATTLE_ANIMATIONS.md (v1.0)
- AI_SYSTEM.md (v1.0)
- GUILD_RECRUITMENT_SYSTEM.md (v1.0)
- DESIGN_SYSTEM.md (v1.0)
- FRONTEND_TECHNICAL_PATTERNS.md (v1.0)
