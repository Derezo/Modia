# World Map Travel System Enhancement

## Overview

Enhance the world map to allow players to travel to any previously discovered node (not just adjacent nodes), with a stamina system that gates movement and a visual character representation with walking animations.

## Design Summary

### 1. Stamina System

**Core Mechanics:**
- **Max Stamina:** 8 points per character
- **Travel Cost:** 1 stamina per node in the shortest path
- **Regeneration:** 1 point every 2 minutes while online
- **Storage:** Database columns on `characters` table with timestamp-based calculation

**Database Schema:**
```sql
ALTER TABLE characters ADD COLUMN stamina INTEGER DEFAULT 8;
ALTER TABLE characters ADD COLUMN stamina_updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE characters ADD COLUMN max_stamina INTEGER DEFAULT 8;
```

**Stamina Calculation (on request):**
```javascript
const elapsedMinutes = (now - stamina_updated_at) / 60000;
const regenPoints = Math.floor(elapsedMinutes / 2); // 1 per 2 minutes
const currentStamina = Math.min(max_stamina, stored_stamina + regenPoints);
```

### 2. Multi-Node Travel

**Eligibility:**
- Destination must be in `user_node_discovery` (previously discovered)
- Intermediate nodes do NOT need to be discovered
- Character "knows the way" from prior exploration

**Path Calculation:**
- BFS on `world_node_connections` to find shortest path
- Returns array of node IDs from current to destination

**Server Flow:**
1. Receive `POST /api/world/travel { targetNodeId }`
2. Calculate shortest path via BFS
3. Validate: destination discovered, stamina sufficient
4. Deduct stamina, update `current_node_id` to destination
5. Discover all intermediate nodes + adjacents
6. Return `{ path: [...], cost, newDiscoveries }`

### 3. Character Visualization

**Idle Display:**
- Party leader sprite at current node position
- Scaled to ~40px (larger than 30px node icons)
- Small shadow underneath

**Walking Animation:**
- 4-frame walk cycle following bezier paths
- Speed: ~200px/second
- Direction-aware facing
- Brief pause at each intermediate node (100ms)

**Travel State:**
- `isTraveling: true` blocks all interactions
- Camera follows character smoothly
- Dust particle trail behind character

### 4. UI Components

**Stamina Bar (top-left):**
```
⚡ 6/8 Stamina [██████░░] +1 in 45s
```

**Node Hover Tooltip:**
```
🌲 Darkwood Forest
Distance: 3 nodes | Cost: 3 stamina
[Click to travel]
```
- Insufficient stamina shows "Need X more" in red

**Path Preview:**
- Golden highlight on hover showing route
- Intermediate nodes briefly labeled

**Travel Progress:**
- "Traveling to Darkwood Forest (2/4)"
- Updates as each node is passed

---

## Implementation Plan

### Phase 1: Database & Backend Stamina

**Files to modify:**
- `api/src/migrations/016_stamina_system.sql` - New migration
- `api/src/routes/characters.js` - Add stamina to character responses
- `api/src/services/staminaService.js` - New service for calculations

**Tasks:**
1. Create migration `016_stamina_system.sql`:
   - Add `stamina`, `stamina_updated_at`, `max_stamina` to characters
   - Set defaults for existing characters
2. Create `staminaService.js`:
   - `getCurrentStamina(characterId)` - Calculate with regen
   - `deductStamina(characterId, amount)` - Atomic deduction
   - `getStaminaInfo(characterId)` - Full info with `nextRegenAt` timestamp
3. Update character GET routes to include stamina info
4. Add stamina endpoint: `GET /api/characters/:id/stamina`

### Phase 2: Pathfinding & Travel API

**Files to modify:**
- `api/src/routes/world.js` - Add BFS pathfinding and enhance travel endpoint

**Note:** World graph pathfinding uses database connections, NOT the tile-based `shared/pathfinding.js`. Implement BFS directly in the route or create `api/src/services/worldPathService.js`.

**Tasks:**
1. Add `findWorldPath(fromNodeId, toNodeId, pool)` function:
   - Load adjacency from `world_node_connections`
   - BFS to find shortest path
   - Returns `{ path: [nodeIds], distance }`
2. Modify `POST /api/world/travel`:
   - Remove adjacency-only restriction (keep battle check)
   - Calculate shortest path via BFS
   - Validate: destination discovered, stamina sufficient
   - Deduct stamina via staminaService
   - Discover ALL intermediate nodes + their adjacents (player "travels through")
   - Return `{ path: [...], cost, newDiscoveries }`
3. Add `GET /api/world/path/:targetNodeId`:
   - Preview path without traveling
   - Returns path, cost, whether affordable
4. Handle edge cases:
   - No path exists (disconnected graph): return error
   - Destination not discovered: return error

### Phase 3: Frontend Character Display

**Files to modify:**
- `frontend/src/scenes/WorldMapScene.js` - Character rendering
- `frontend/src/worldmap/` - New `WorldMapCharacter.js`

**Tasks:**
1. Create `WorldMapCharacter.js` class:
   - Load party leader sprite from AssetLoader
   - Render at current node position (scaled 40px)
   - Shadow rendering beneath sprite
2. Integrate into WorldMapScene:
   - Create WorldMapCharacter instance in `enter()`
   - Call `character.render(ctx)` after nodes, before UI
   - Position based on current node coordinates
3. Add idle bobbing animation for visual life

### Phase 4: Walking Animation System

**Files to modify:**
- `frontend/src/worldmap/WorldMapCharacter.js` - Animation logic
- `frontend/src/scenes/WorldMapScene.js` - Travel orchestration

**Tasks:**
1. Add walking animation to WorldMapCharacter:
   - 4-frame walk cycle (or use existing sprites)
   - `startWalking(path)` method
   - `update(deltaTime)` for animation progression
   - Movement along bezier curves between nodes
2. Add travel orchestration to WorldMapScene:
   - `startTravel(targetNodeId)` method
   - Fetch path from new API
   - Set `isTraveling = true`, disable interactions
   - Call `character.startWalking(path)`
   - Camera follow during animation
   - On complete: update state, re-enable interactions
3. Add dust particle effect during movement

### Phase 5: Stamina UI

**Files to modify:**
- `frontend/src/scenes/WorldMapScene.js` - UI rendering
- `frontend/src/worldmap/` - New `StaminaBar.js`

**Tasks:**
1. Create `StaminaBar.js` component:
   - Medieval-styled container
   - Progress bar showing current/max
   - Timer countdown to next regen point
   - `update(deltaTime)` for timer
2. Integrate into WorldMapScene:
   - Fetch stamina on `enter()` and after travel
   - Position below party info (top-left)
   - Real-time timer updates
3. Add stamina polling or WebSocket sync

### Phase 6: Enhanced Node Interactions

**Files to modify:**
- `frontend/src/scenes/WorldMapScene.js` - Hover/click logic

**Tasks:**
1. Modify node click handler:
   - Remove adjacency restriction
   - Check if node is discovered
   - Check stamina sufficient
   - Call `startTravel()` instead of direct API call
2. Enhance node hover:
   - Fetch/calculate path to hovered node
   - Display travel cost in tooltip
   - Show "Need X more stamina" if insufficient
   - Highlight path in golden color
3. Add path preview rendering:
   - Golden glow on path segments
   - Animate subtle pulse effect

### Phase 7: Polish & Testing

**Tasks:**
1. Add sound effects (if audio system exists):
   - Footsteps during walking
   - Arrival chime
2. Handle edge cases:
   - What if stamina regens mid-travel? (ignore, deducted upfront)
   - Disconnection during travel? (server state is authoritative)
   - Rapid click attempts? (disabled during travel)
3. Test scenarios:
   - Travel 1 node (should still work)
   - Travel max distance (8 nodes)
   - Travel with insufficient stamina (blocked)
   - Stamina regeneration timing
   - Animation smoothness
4. Update existing tests for new travel behavior

---

## Files Summary

**New Files:**
- `api/src/migrations/016_stamina_system.sql` - Stamina columns
- `api/src/services/staminaService.js` - Stamina calculation/deduction
- `frontend/src/worldmap/WorldMapCharacter.js` - Character sprite on map
- `frontend/src/worldmap/StaminaBar.js` - Stamina UI component

**Modified Files:**
- `api/src/routes/world.js` - Multi-node travel with BFS pathfinding
- `api/src/routes/characters.js` - Stamina in responses
- `frontend/src/scenes/WorldMapScene.js` - Travel animation, character display
- `frontend/src/api/client.js` - New API methods (getPathPreview, getStamina)

**Reference Files (read-only):**
- `frontend/src/worldmap/WorldMapEffects.js` - Pattern for new components
- `frontend/src/core/AssetLoader.js` - Character sprite loading

---

## Design Decisions

1. **Intermediate Node Discovery:** When traveling through multiple nodes, all intermediate nodes AND their adjacents are discovered (player "travels through" them)

2. **Single-Player Focus:** This implementation applies to solo travel. Multiplayer party travel could be added later with stamina coordination.

3. **Path Caching:** Frontend caches path calculations for hover previews to avoid excessive API calls.

4. **Server-Authoritative Timestamps:** Server returns `nextRegenAt` timestamp for stamina regen display to avoid client clock drift.

---

## Verification Plan

1. **Database:** Run migration, verify columns exist with defaults
2. **Stamina API:** Test calculation with various timestamps
3. **Pathfinding:** Verify shortest path calculation
4. **Travel API:** Test multi-node travel with stamina deduction
5. **Character Display:** Verify sprite renders at correct position
6. **Walking Animation:** Test smooth movement along paths
7. **Stamina UI:** Verify bar updates and timer accuracy
8. **Integration:** Full end-to-end travel from distant node

---

## Documentation Updates Required

After implementation:
- Update `docs/GAME_DESIGN.md` with stamina system
- Update `docs/API_SPECIFICATION.md` with new endpoints
- Update `docs/DEVELOPMENT_ROADMAP.md` with completion
- Archive this plan to `docs/archive/`
