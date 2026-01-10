# Shared Battle Modules Design

## Problem

Terrain, pathfinding, and damage calculation code is duplicated between client and server. This has caused bugs where implementations drift apart (e.g., `isImpassable` including `water` on server but not client, random consumption mismatch in terrain generation).

Current duplication:
- `isImpassable()` - battle.js + BattleGrid.js
- `getTerrainMovementCost()` - battleService.js + BattleGrid.js
- `getTerrainWeights()` - battle.js + BattleGrid.js
- `seededRandom()` - battle.js + BattleGrid.js (also in shared/ but unused by frontend)
- Terrain generation - battle.js + BattleGrid.js
- Pathfinding (Dijkstra/A*) - battleService.js + BattlePathfinding.js
- Damage formulas - battleService.js + BattleScene.js

## Solution

Consolidate all battle logic into shared ESM modules. Add Vite bundler to frontend to enable imports from shared workspace.

## Architecture

### Shared Module Structure

```
shared/
├── package.json          # "type": "module"
├── constants.js          # Existing - races, classes, stats (convert to ESM)
├── nameData.js           # Existing - name pools (convert to ESM)
├── terrain.js            # NEW - terrain types, costs, passability
├── mapGeneration.js      # NEW - seeded terrain/obstacle generation
├── pathfinding.js        # NEW - Dijkstra reachable tiles, A* pathing
├── battleMath.js         # NEW - damage formulas, hit/crit calculations
└── index.js              # NEW - re-exports for convenience
```

### Module Contents

**terrain.js**
```javascript
export const IMPASSABLE_TERRAIN = ['rock', 'tree', 'lava', 'cliff'];
export const TERRAIN_COSTS = { grass: 1, stone: 1, forest: 2, water: 3 };
export const TERRAIN_WEIGHTS = { /* by biome */ };

export function isImpassable(terrain) { ... }
export function getTerrainMovementCost(terrain) { ... }
export function getTerrainWeights(nodeType) { ... }
```

**mapGeneration.js**
```javascript
import { SeededRandom } from './constants.js';
import { isImpassable, getTerrainWeights } from './terrain.js';

export function generateTerrain(seed, nodeType, width, height) {
  // Returns { terrain: [][], obstacles: [][] }
}
```

**pathfinding.js**
```javascript
import { getTerrainMovementCost, isImpassable } from './terrain.js';

export function getReachableTiles(startX, startY, range, terrain, units) { ... }
export function calculatePathCost(start, target, terrain, units, maxCost) { ... }
export function findPath(start, end, terrain, units) { ... }
```

**battleMath.js**
```javascript
export function calculatePhysicalDamage(attacker, defender, skillPower) { ... }
export function calculateMagicalDamage(attacker, defender, skillPower) { ... }
export function calculateHealing(caster, target, skillPower) { ... }
export function calculateHitChance(attacker, defender) { ... }
export function calculateCritChance(attacker) { ... }
export function calculateCritMultiplier(attacker) { ... }
```

### Frontend Vite Setup

```
frontend/
├── package.json          # Add vite dependency
├── vite.config.js        # Dev server, proxy config
├── index.html            # Entry point (moved from public/)
├── public/               # Static assets only
│   └── assets/
└── src/                  # JS source (moved from public/src/)
    └── ...
```

**vite.config.js**
```javascript
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    port: 8080,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true }
    }
  }
});
```

### API ESM Migration

- Add `"type": "module"` to api/package.json
- Convert all `require()` → `import`
- Convert all `module.exports` → `export`
- Replace `__dirname` with `import.meta.url` pattern
- Import shared modules: `import { isImpassable } from '@modia/shared/terrain.js'`

## Migration Phases

### Phase 1: Shared Module (foundation)
1. Convert shared/package.json to ESM
2. Convert constants.js, nameData.js to ESM exports
3. Create terrain.js, mapGeneration.js, pathfinding.js, battleMath.js
4. Create index.js re-exports
5. Test with Node script

### Phase 2: API Migration (backend)
1. Update api/package.json to ESM
2. Convert all require/module.exports to import/export
3. Fix __dirname usages
4. Replace duplicated code with shared imports
5. Run tests

### Phase 3: Frontend Migration (client)
1. Install Vite, update scripts
2. Move index.html to root, public/src/ to src/
3. Create vite.config.js
4. Replace duplicated code with shared imports
5. Delete unused DamagePreview.js
6. Browser test

### Phase 4: Cleanup
1. Delete dead code
2. Update CLAUDE.md
3. Update documentation

## Files to Modify

### Shared (new/convert)
- shared/package.json - add "type": "module"
- shared/constants.js - convert to ESM
- shared/nameData.js - convert to ESM
- shared/terrain.js - NEW
- shared/mapGeneration.js - NEW
- shared/pathfinding.js - NEW
- shared/battleMath.js - NEW
- shared/index.js - NEW

### API (ESM conversion + use shared)
- api/package.json
- api/src/index.js
- api/src/routes/*.js (~10 files)
- api/src/services/*.js (~15 files)
- api/src/config/*.js (~3 files)
- api/src/tests/*.js (~5 files)
- api/src/utils/*.js (~3 files)
- api/src/websocket/*.js (~1 file)
- api/src/middleware/*.js (~3 files)
- api/src/scripts/*.js (~10 files)

### Frontend (Vite + use shared)
- frontend/package.json
- frontend/vite.config.js - NEW
- frontend/index.html - MOVE from public/
- frontend/src/ - MOVE from public/src/
- frontend/src/battle/BattleGrid.js - remove duplicated code
- frontend/src/battle/BattlePathfinding.js - remove duplicated code
- frontend/src/battle/DamagePreview.js - DELETE (replaced by UI version)
- frontend/src/scenes/BattleScene.js - use shared imports

## Benefits

1. **Single source of truth** - No more drift between client/server
2. **Type safety ready** - Can add TypeScript to shared/ later
3. **Easier testing** - Test battle logic once in shared/
4. **Modern tooling** - Vite enables HMR, future optimizations
5. **Cleaner imports** - `@modia/shared/terrain.js` vs relative paths

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| ESM conversion breaks API | Run tests after each file conversion |
| Vite changes dev workflow | Proxy config maintains same ports/URLs |
| Large PR | Can split into 4 PRs per phase |
| Import path issues | Use workspace protocol in package.json |

## Completed

All four phases have been implemented as of 2026-01-09:

### Phase 1: Shared Module (foundation)
- Converted shared/package.json to ESM with `"type": "module"`
- Converted constants.js and nameData.js to ESM exports
- Created terrain.js, mapGeneration.js, pathfinding.js, battleMath.js
- Created index.js with re-exports

### Phase 2: API Migration (backend)
- Updated api/package.json to ESM
- Converted all require/module.exports to import/export across ~40 files
- Fixed __dirname usages with `import.meta.url` pattern
- Replaced duplicated terrain/pathfinding code with shared imports

### Phase 3: Frontend Migration (client)
- Installed Vite and configured dev server with API proxy
- Moved index.html to root, public/src/ to src/
- Created vite.config.js with `@shared` alias for shared workspace imports
- Replaced duplicated code in BattleGrid.js, BattlePathfinding.js with shared imports
- Updated BattleScene.js to use shared battleMath.js for damage previews

### Phase 4: Cleanup
- Deleted unused DamagePreview.js (replaced by shared/battleMath.js + ParchmentCard UI)
- Removed duplicated CLASS_MOVEMENT constant from BattleScene.js (now imports from shared)
- Removed debug console.log statements ([CT DEBUG]) from battleService.js
- Removed unused imports (isImpassable, getTerrainWeights) from battle.js route
- Updated CLAUDE.md with new architecture documentation
