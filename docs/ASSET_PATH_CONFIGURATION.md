# Asset Path Configuration

This document describes the architecture of Modia's asset path configuration system, which uses `shared/assetPaths.js` as the single source of truth for all asset path construction.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Single Source of Truth](#single-source-of-truth)
3. [Consumer Integration](#consumer-integration)
4. [CommonJS Bridge Pattern](#commonjs-bridge-pattern)
5. [Python Integration](#python-integration)
6. [Configuration Reference](#configuration-reference)
7. [Enemy Portrait Naming Convention](#enemy-portrait-naming-convention)

---

## Architecture Overview

```
                    ASSET PATH ARCHITECTURE
                    =======================

                 +---------------------------+
                 |   shared/assetPaths.js    |
                 |   (Single Source of Truth)|
                 |                           |
                 |  - SIZE_PRESETS           |
                 |  - DEFAULT_SIZES          |
                 |  - ASSET_CATEGORIES       |
                 |  - getAssetPath()         |
                 |  - getOutputPath()        |
                 |  - getOriginalsPath()     |
                 +------------+--------------+
                              |
         +--------------------+--------------------+
         |                    |                    |
         v                    v                    v
+----------------+   +----------------+   +------------------+
| Frontend       |   | API / Admin    |   | Node.js Scripts  |
| (11 files)     |   | (ESM import)   |   | (CommonJS)       |
|                |   |                |   |                  |
| @shared/       |   | Relative       |   | assetPathsBridge |
| alias (Vite)   |   | imports        |   | (dynamic import) |
+----------------+   +----------------+   +------------------+
                                                   |
                                                   v
                                         +------------------+
                                         | Python Scripts   |
                                         | (image-generator)|
                                         |                  |
                                         | Explicit paths   |
                                         | via --output-path|
                                         +------------------+
```

---

## Single Source of Truth

The `shared/assetPaths.js` module is the canonical source for all asset path construction. This ensures:

- **Consistency**: All consumers generate identical paths for the same assets
- **Maintainability**: Path pattern changes require updates in one location
- **Validation**: Size presets and category validation in a single place

### Key Exports

| Export | Type | Description |
|--------|------|-------------|
| `SIZE_PRESETS` | Object | Available sizes per category |
| `DEFAULT_SIZES` | Object | Default size per category |
| `ASSET_CATEGORIES` | Array | Valid category names |
| `CHARACTER_ANIMATIONS` | Array | Animation types for sprites |
| `CHARACTER_TYPES` | Array | Player and enemy types |
| `ENEMY_BIOMES` | Array | Biomes for enemy organization |
| `OBSTACLE_CATEGORIES` | Array | Obstacle subcategories |
| `getAssetPath()` | Function | Get URL path for display |
| `getOutputPath()` | Function | Get filesystem path for scripts |
| `getOriginalsPath()` | Function | Get path to source images |
| `getOptimalSize()` | Function | Select best size for display |
| `getAllSizeVariants()` | Function | Get all sizes for an asset |
| `getCharacterPath()` | Function | Get character sprite path |
| `getCharacterAnimationPaths()` | Function | Get all animations for character |

### Size Presets

```javascript
SIZE_PRESETS = {
  tiles: [64],                           // Single size (isometric)
  portraits: [32, 48, 64, 128, 256],     // Compact, small, UI, dialog, detail
  items: [32, 64, 128],                  // Inventory, tooltip, detail
  icons: [16, 24, 32, 48, 64, 128, 256], // Various UI contexts
  nodes: [48, 64, 96, 128, 256],         // World map zoom levels
  overlays: [32, 48, 64, 128],           // Match item sizes
  characters: [64],                       // Sprite sheets (64x512)
  obstacles: [64]                         // Battle map obstacles
};
```

### Default Sizes

```javascript
DEFAULT_SIZES = {
  tiles: 64,
  portraits: 64,
  items: 64,
  icons: 32,
  nodes: 96,
  overlays: 64,
  characters: 64,
  obstacles: 64
};
```

---

## Consumer Integration

### Frontend (11 files via Vite @shared alias)

The frontend imports using Vite's `@shared/` alias configured in `vite.config.js`:

```javascript
// Frontend code (works in browser via Vite bundling)
import { getAssetPath, getOptimalSize } from '@shared/assetPaths.js';

const size = getOptimalSize('portraits', displaySize);
const path = getAssetPath('portraits', 'human_male_warrior', { size });
```

**Frontend consumers:**
- `frontend/src/core/AssetLoader.js` - Main asset loading
- `frontend/src/core/IconLoader.js` - Icon loading
- `frontend/src/components/ParchmentCard.js` - Character cards
- `frontend/src/components/CharacterCard.js` - Character display
- `frontend/src/components/CharacterPicker.js` - Character selection
- `frontend/src/components/ItemIcon.js` - Item icon compositing
- `frontend/src/components/modals/CharacterModal.js` - Character details
- `frontend/src/utils/OverlayCompositor.js` - Overlay compositing
- `frontend/src/battle/turnOrderUtils.js` - Turn order portraits
- `frontend/src/battle/BattleLogModal.js` - Battle log icons
- `frontend/src/ui/parchment/ProfileDropdown.js` - Profile UI

### API and Admin Dashboard (ESM direct import)

API routes and admin dashboard use relative imports:

```javascript
// API route (ESM)
import { getAssetPath, SIZE_PRESETS } from '../../../shared/assetPaths.js';

// Admin dashboard (via Vite @shared alias)
import { getAssetPath } from '@shared/assetPaths.js';
```

**API/Admin consumers:**
- `api/src/routes/admin.js` - Asset management endpoints
- `admin/src/lib/assetPathHelper.js` - Admin path utilities
- `admin/src/components/AssetCard.jsx` - Asset display
- `admin/src/components/AssetDetail.jsx` - Asset details

### Node.js Scripts (CommonJS bridge)

Node.js generation scripts use CommonJS and require a bridge for ESM imports:

```javascript
// scripts/ai-images/lib/index.js (CommonJS)
const { getAssetPathsModule, getOutputDir } = require('./assetPathsBridge');

// Async access to ESM module
const assetPaths = await getAssetPathsModule();
const path = assetPaths.getOutputPath('portraits', id, { size: 64 });
```

---

## CommonJS Bridge Pattern

The `scripts/ai-images/lib/assetPathsBridge.js` provides CommonJS access to the ESM `shared/assetPaths.js` module using dynamic import caching.

### Bridge Architecture

```javascript
// assetPathsBridge.js

// Cached dynamic import (ESM from CJS)
let _cache = null;

async function getAssetPathsModule() {
  if (!_cache) {
    _cache = await import('../../../shared/assetPaths.js');
  }
  return _cache;
}

// Synchronous constants for non-async code
const CATEGORY_BASE_DIRS = {
  tiles: 'sprites/terrain',
  portraits: 'portraits',
  items: 'items',
  icons: 'icons',
  nodes: 'nodes',
  overlays: 'overlays',
  characters: 'characters',
  obstacles: 'obstacles'
};

// Sync helper for output directories
function getOutputDir(category) {
  const baseDir = CATEGORY_BASE_DIRS[category];
  if (!baseDir) return null;
  return path.join(getProjectRoot(), 'frontend/public/assets', baseDir);
}
```

### Why Dynamic Import?

Node.js scripts in the `scripts/` directory use CommonJS (`require()`) for compatibility with existing tooling. Since `shared/assetPaths.js` is ESM, we use `import()` which returns a Promise.

The cache pattern ensures:
1. Single module load regardless of how many times called
2. Consistent module instance across all consumers
3. Async-aware callers can await the module

### Script Consumer Files

| File | Usage |
|------|-------|
| `scripts/ai-images/lib/index.js` | Re-exports bridge for generators |
| `scripts/ai-images/lib/resizeUtils.js` | Size variant generation |
| `scripts/ai-images/lib/backupUtils.js` | Backup path construction |
| `scripts/ai-images/generate-characters.js` | Character sprite generation |
| `scripts/ai-images/validate-images.js` | Path validation |
| `scripts/ai-images/validate-paths.js` | Path consistency checks |
| `scripts/ai-images/validate-asset-paths.js` | Asset path validation |

---

## Python Integration

Python scripts in the external `image-generator` project do not import from `shared/assetPaths.js`. Instead, calling Node.js scripts pass explicit output paths via command-line arguments.

### Integration Pattern

```javascript
// Node.js script (generate-portraits.js)
const assetPaths = await getAssetPathsModule();
const outputPath = assetPaths.getOutputPath('portraits', id, { size, original: true });

// Spawn Python with explicit path
await pythonRunner.run('generate_portrait.py', {
  prompt: asset.prompt,
  seed: asset.seed,
  outputPath: outputPath  // <-- Explicit path passed to Python
});
```

### Python Script Expectations

Python scripts expect:
- `--output-path` argument with full filesystem path
- No knowledge of Modia's path conventions
- Simple file I/O to provided path

This separation ensures:
- Python scripts remain portable and framework-agnostic
- Path logic stays in JavaScript (single source of truth)
- No Python dependency on Modia's codebase

### Example Python Invocation

```bash
python generate_portrait.py \
  --prompt "human male warrior portrait" \
  --seed 10001 \
  --output-path /home/wizard/Projects/Modia/frontend/public/assets/portraits/originals/human_male_warrior.png
```

> **Note:** Original (source) images are always saved as `.png` files. The resizing pipeline converts them to `.webp` for size variants.

---

## Configuration Reference

### Adding a New Asset Category

1. **Update `shared/assetPaths.js`:**
   ```javascript
   // Add to ASSET_CATEGORIES
   export const ASSET_CATEGORIES = [..., 'newcategory'];

   // Add size presets
   SIZE_PRESETS.newcategory = [32, 64, 128];
   DEFAULT_SIZES.newcategory = 64;

   // Add path function if needed
   function getNewCategoryPath(id, options = {}) { ... }

   // Update getAssetPath switch
   case 'newcategory':
     return getNewCategoryPath(id, options);
   ```

2. **Update bridge if synchronous access needed:**
   ```javascript
   // assetPathsBridge.js
   CATEGORY_BASE_DIRS.newcategory = 'newcategory';
   ```

3. **Update metadata** in `ai-image-metadata/`

### Changing Size Presets

Modify `SIZE_PRESETS` in `shared/assetPaths.js`. All consumers automatically use new sizes.

```javascript
// Example: Add 512px portrait size
SIZE_PRESETS.portraits = [64, 128, 256, 512];
```

### Path Pattern Changes

All path patterns are defined in category-specific functions within `shared/assetPaths.js`:

| Category | Function | Pattern |
|----------|----------|---------|
| portraits | `getPortraitPath()` | `/assets/portraits/{size}/{id}.webp` |
| enemy portraits | (via `getPortraitPath()`) | `/assets/portraits/{size}/enemy_{sprite_id}.webp` |
| nodes | `getNodePath()` | `/assets/nodes/{size}/{id}.webp` |
| items | `getItemPath()` | `/assets/items/{size}/{subcategory}/{id}.webp` |
| icons | `getIconPath()` | `/assets/icons/png/{size}/{subcategory}/{id}.webp` |
| tiles | `getTilePath()` | `/assets/sprites/terrain/{subcategory}/{id}.webp` |
| overlays | `getOverlayPath()` | `/assets/overlays/{size}/{subcategory}/{id}.webp` |
| characters | `getCharacterPath()` | `/assets/characters/{type}/{...}/{id}_{animation}.webp` |
| obstacles | `getObstaclePath()` | `/assets/obstacles/{category}/{id}.webp` |

---

## Enemy Portrait Naming Convention

Enemy portraits use the `enemy_` prefix to distinguish from player portraits:

| Context | Format | Example |
|---------|--------|---------|
| Metadata ID (enemies.json) | `enemy_{sprite_id}` | `enemy_goblin_warrior` |
| Database sprite_id | `{sprite_id}` | `goblin_warrior` |
| File path | `/assets/portraits/{size}/enemy_{sprite_id}.webp` | `/assets/portraits/64/enemy_goblin_warrior.webp` |

### Frontend Usage

```javascript
// AssetLoader adds the 'enemy_' prefix automatically
assetLoader.getEnemyPortraitUrl('goblin_warrior', 64)
// Returns: /assets/portraits/64/enemy_goblin_warrior.webp

// WRONG: Do not pass the prefix - it will be doubled
assetLoader.getEnemyPortraitUrl('enemy_goblin_warrior', 64)
// Would incorrectly return: /assets/portraits/64/enemy_enemy_goblin_warrior.webp
```

### Why the Prefix?

The `enemy_` prefix serves two purposes:
1. **Collision prevention**: Prevents overlap with player portrait IDs (e.g., `human_male_warrior`)
2. **Asset identification**: Makes the asset type immediately identifiable in file listings and metadata

### Data Flow

```
Database (enemies table)     AssetLoader              File System
─────────────────────────────────────────────────────────────────
sprite_id: 'goblin_warrior'  → adds 'enemy_' prefix → enemy_goblin_warrior.webp
sprite_id: 'wolf'            → adds 'enemy_' prefix → enemy_wolf.webp
```

---

## Related Documentation

- **Directory Structure:** `docs/ASSET_PATH_STANDARD.md` - Physical directory layout
- **Metadata Schema:** `docs/ASSET_METADATA_SCHEMA.md` - JSON metadata conventions
- **AI Generation:** `docs/AI_IMAGE_GENERATION.md` - Image generation pipeline
- **Asset Index:** `docs/ASSET_SYSTEM_INDEX.md` - Unified asset documentation navigation
