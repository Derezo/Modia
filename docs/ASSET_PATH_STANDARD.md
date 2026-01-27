# Asset Path Standardization

## Overview

This document describes the standardized asset path patterns used across Modia for AI-generated images and game assets. The `shared/assetPaths.js` module provides a single source of truth for path construction, ensuring consistency across the frontend, API, and asset generation scripts.

## Directory Structure

```
frontend/public/assets/
├── audio/                              # Music and SFX (see AUDIO_STYLE_GUIDE.md)
├── portraits/
│   ├── originals/                      # 1024x1024 AI source images
│   ├── 64/
│   │   ├── human_male_warrior.png      # Player: {race}_{gender}_{class}
│   │   └── enemy_goblin_warrior.png    # Enemy: enemy_{name}
│   ├── 128/
│   └── 256/
├── nodes/
│   ├── originals/                      # 1024x1024 AI source images
│   ├── 48/castle.png                   # No node_ prefix
│   ├── 64/castle.png
│   ├── 96/castle.png
│   ├── 128/castle.png
│   └── 256/castle.png
├── items/
│   ├── originals/
│   ├── 32/weapons/sword_iron.png       # Size in path, not filename
│   ├── 64/weapons/sword_iron.png
│   └── 128/weapons/sword_iron.png
├── icons/
│   ├── originals/
│   ├── png/
│   │   ├── 16/actions/attack.png
│   │   ├── 24/
│   │   ├── 32/
│   │   ├── 48/
│   │   └── 64/
│   └── svg/                            # Hand-crafted SVG icons
│       ├── menu/
│       ├── resources/
│       └── stats/
├── terrain/                            # Battle map tiles (no base/ directory)
│   ├── originals/
│   ├── forest/{floors,walls,slopes}/
│   ├── cave/
│   ├── mountain/
│   ├── bridge/
│   └── castle/
├── overlays/
│   ├── originals/
│   ├── 32/rarity/rare.png
│   ├── 64/rarity/rare.png
│   └── 128/rarity/rare.png
└── sprites/
    └── characters/                     # Animated character sprites (unchanged)
        ├── enemies/{biome}/{enemy}/
        │   └── {enemy}_{action}.png
        └── player/{class}/
            └── {class}_{action}.png
```

## Path Patterns by Category

### Portraits (Unified Directory)

Player and enemy portraits are stored in a single unified directory structure, differentiated by naming convention.

- **Pattern:** `/assets/portraits/{size}/{id}.png`
- **Sizes:** 64 (default), 128, 256
- **Player Naming:** `{race}_{gender}_{class}` (e.g., `human_male_warrior`)
- **Enemy Naming:** `enemy_{name}` (e.g., `enemy_goblin_warrior`)

**Examples:**
```
/assets/portraits/64/human_male_warrior.png      # Player portrait
/assets/portraits/128/elf_female_wizard.png      # Player portrait (larger)
/assets/portraits/64/enemy_goblin_warrior.png    # Enemy portrait
/assets/portraits/256/enemy_dragon.png           # Enemy portrait (large)
```

### Nodes (World Map)

World map node icons without the `node_` prefix.

- **Pattern:** `/assets/nodes/{size}/{id}.png`
- **Sizes:** 48, 64, 96 (default), 128, 256
- **IDs:** `castle`, `city`, `village`, `tavern`, `shop`, `guild_warrior`, etc.

**Examples:**
```
/assets/nodes/96/castle.png
/assets/nodes/48/tavern.png
/assets/nodes/96/guild_warrior.png
```

### Items (Size in Path)

Item icons with size as directory, not filename suffix.

- **Pattern:** `/assets/items/{size}/{subcategory}/{id}.png`
- **Sizes:** 32, 64 (default), 128
- **Subcategories:** `weapons`, `armor`, `accessories`, `consumables`

**Examples:**
```
/assets/items/64/weapons/sword_iron.png
/assets/items/32/armor/plate_chest.png
/assets/items/128/consumables/potion_health.png
```

### Icons

Icons use directory-based size organization.

- **Pattern:** `/assets/icons/png/{size}/{subcategory}/{id}.png`
- **Sizes:** 16, 24, 32 (default), 48, 64, 128
- **Subcategories:** `actions`, `status`, `ui`, `skills`

**Examples:**
```
/assets/icons/png/32/actions/attack.png
/assets/icons/png/48/status/poison.png
/assets/icons/png/16/ui/close.png
```

### Terrain (Battle Tiles)

Terrain tiles organized by biome. No `base/` directory - code falls back to `forest` when biome-specific tiles don't exist.

- **Floors Pattern:** `/assets/sprites/terrain/{biome}/{key}.png`
- **Walls Pattern:** `/assets/sprites/terrain/{biome}/walls/{terrain}_wall.png`
- **Slopes Pattern:** `/assets/sprites/terrain/{biome}/slopes/{direction}_{levels}.png`
- **Biomes:** `forest`, `cave`, `mountain`, `bridge`, `castle`

**Examples:**
```
/assets/sprites/terrain/forest/grass_0.png              # Floor tile
/assets/sprites/terrain/cave/walls/stone_wall.png       # Wall tile
/assets/sprites/terrain/mountain/slopes/north_1.png     # Slope tile
/assets/sprites/terrain/bridge/slopes/stairs_east_2.png # Stairs tile
```

### Overlays

Visual overlays for item rarity and augment effects with size directories.

- **Pattern:** `/assets/overlays/{size}/{subcategory}/{id}.png`
- **Sizes:** 32, 48, 64 (default), 128
- **Subcategories:** `rarity`, `augments`

**Examples:**
```
/assets/overlays/64/rarity/rare.png
/assets/overlays/128/rarity/legendary.png
/assets/overlays/64/augments/fire.png
```

### Character Sprites (Unchanged)

Animated character sprites remain in their original location.

- **Player Pattern:** `/assets/sprites/characters/player/{class}/{class}_{action}.png`
- **Enemy Pattern:** `/assets/sprites/characters/enemies/{biome}/{enemy}/{enemy}_{action}.png`
- **Actions:** `idle`, `walk`, `attack`, `hit`, `death`

## Originals Preservation

Every asset category maintains an `originals/` subdirectory containing the full-resolution AI-generated source images (typically 1024x1024). These are preserved for:

- Regenerating size variants at higher quality
- Future upscaling or processing
- Reference during asset iteration

**Pattern:** `/assets/{category}/originals/{subcategory?/}{id}.png`

**Examples:**
```
/assets/portraits/originals/human_male_warrior.png
/assets/portraits/originals/enemy_goblin_warrior.png
/assets/nodes/originals/castle.png
/assets/items/originals/weapons/sword_iron.png
/assets/sprites/terrain/originals/forest/grass_0.png
```

## AssetPaths Module API

The `shared/assetPaths.js` module provides utilities for consistent path construction.

### Constants

```javascript
import { SIZE_PRESETS, DEFAULT_SIZES, ASSET_CATEGORIES } from '@shared/assetPaths.js';

SIZE_PRESETS = {
  tiles: [64],
  portraits: [64, 128, 256],
  items: [32, 64, 128],
  icons: [16, 24, 32, 48, 64, 128],
  nodes: [48, 64, 96, 128, 256],
  overlays: [32, 48, 64, 128]
};

DEFAULT_SIZES = {
  tiles: 64,
  portraits: 64,
  items: 64,
  icons: 32,
  nodes: 96,
  overlays: 64
};

ASSET_CATEGORIES = ['tiles', 'portraits', 'items', 'icons', 'nodes', 'overlays'];
```

### Core Functions

#### `getAssetPath(category, id, options)`

Main function for retrieving asset paths.

```javascript
import { getAssetPath } from '@shared/assetPaths.js';

// Portrait (player)
getAssetPath('portraits', 'human_male_warrior', { size: 64 });
// => '/assets/portraits/64/human_male_warrior.png'

// Portrait (enemy - use enemy_ prefix in id)
getAssetPath('portraits', 'enemy_goblin_warrior', { size: 64 });
// => '/assets/portraits/64/enemy_goblin_warrior.png'

// Node
getAssetPath('nodes', 'castle', { size: 96 });
// => '/assets/nodes/96/castle.png'

// Item
getAssetPath('items', 'sword_iron', { subcategory: 'weapons', size: 64 });
// => '/assets/items/64/weapons/sword_iron.png'

// Icon
getAssetPath('icons', 'attack', { subcategory: 'actions', size: 32 });
// => '/assets/icons/png/32/actions/attack.png'

// Terrain tile
getAssetPath('tiles', 'grass_0', { subcategory: 'forest' });
// => '/assets/sprites/terrain/forest/grass_0.png'

// Overlay
getAssetPath('overlays', 'rare', { subcategory: 'rarity', size: 64 });
// => '/assets/overlays/64/rarity/rare.png'
```

#### `getOriginalsPath(category, id, options)`

Get the path to the original source image.

```javascript
import { getOriginalsPath } from '@shared/assetPaths.js';

getOriginalsPath('portraits', 'human_male_warrior');
// => '/assets/portraits/originals/human_male_warrior.png'

getOriginalsPath('items', 'sword_iron', { subcategory: 'weapons' });
// => '/assets/items/originals/weapons/sword_iron.png'
```

#### `getOutputPath(category, id, options)`

Get filesystem path for asset generation scripts.

```javascript
import { getOutputPath } from '../../../shared/assetPaths.js';

getOutputPath('portraits', 'human_male_warrior', { size: 64 });
// => 'frontend/public/assets/portraits/64/human_male_warrior.png'

getOutputPath('nodes', 'castle', { size: 96 });
// => 'frontend/public/assets/nodes/96/castle.png'
```

### Utility Functions

```javascript
import {
  getAllSizeVariants,
  isValidSize,
  getDefaultSize,
  getOptimalSize,
  parseAssetFilename
} from '@shared/assetPaths.js';

// Get all size variants
getAllSizeVariants('portraits', 'human_male_warrior');
// => [
//   { size: 64, path: '/assets/portraits/64/human_male_warrior.png' },
//   { size: 128, path: '/assets/portraits/128/human_male_warrior.png' },
//   { size: 256, path: '/assets/portraits/256/human_male_warrior.png' }
// ]

// Check valid sizes
isValidSize('icons', 32);  // => true
isValidSize('icons', 50);  // => false

// Get default size
getDefaultSize('portraits'); // => 64

// Get optimal size for display
getOptimalSize('portraits', 48);  // => 64 (smallest >= 48)
getOptimalSize('portraits', 100); // => 128 (smallest >= 100)

// Parse filename
parseAssetFilename('human_male_warrior.png', 'portraits');
// => { id: 'human_male_warrior' }
```

## Usage Examples

### Frontend (Vite with @shared alias)

```javascript
import { getAssetPath, getOptimalSize } from '@shared/assetPaths.js';

class InventoryUI {
  renderItem(item) {
    const optimalSize = getOptimalSize('items', this.displaySize);
    const iconPath = getAssetPath('items', item.templateId, {
      subcategory: item.type,
      size: optimalSize
    });

    const img = new Image();
    img.src = iconPath;
  }
}
```

### API/Scripts (relative import)

```javascript
import { getOutputPath, SIZE_PRESETS } from '../../../shared/assetPaths.js';
import fs from 'fs';
import path from 'path';

async function saveGeneratedItem(itemId, buffer, subcategory) {
  // Generate all size variants
  for (const size of SIZE_PRESETS.items) {
    const outputPath = getOutputPath('items', itemId, { subcategory, size });
    const fullPath = path.join(process.cwd(), outputPath);

    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, resizedBuffer);
  }
}
```

## Biome Fallback Strategy

When loading terrain tiles, the system falls back to `forest` biome when a biome-specific tile doesn't exist:

```javascript
// In AssetLoader.js
getSpriteBiome(nodeType) {
  const biomeMap = {
    forest: 'forest',
    cave: 'cave',
    mountain: 'mountain',
    bridge: 'bridge',
    castle: 'castle',
    // Non-terrain nodes default to forest
    village: 'forest',
    city: 'forest',
    default: 'forest'
  };
  return biomeMap[nodeType] || biomeMap.default;
}
```

This eliminates the need for a `base/` directory with generic tiles.

## Best Practices

### Choosing Sizes

- **UI Elements:** 16-32px for inline icons
- **Inventory/Shop:** 48-64px for item grids
- **Detail Views:** 128px+ for inspect/preview
- **Battle Grid:** 64px for terrain tiles
- **World Map:** 48px (zoomed out), 96px (normal), 128-256px (detail views) for nodes

### Adding New Assets

1. Generate original at highest resolution (1024x1024 for portraits/items)
2. Save original to `{category}/originals/` directory
3. Generate all required size variants from original
4. Use `getOutputPath()` for consistent file placement
5. Update relevant metadata/manifest files

### Category Selection Guide

| Asset Type | Category | Subcategory |
|------------|----------|-------------|
| Player faces | portraits | - (use naming convention) |
| Enemy faces | portraits | - (use `enemy_` prefix) |
| Attack/skill icons | icons | actions |
| Status effect icons | icons | status |
| UI buttons/indicators | icons | ui |
| Swords, bows, staves | items | weapons |
| Helmets, chestplates | items | armor |
| Rings, necklaces | items | accessories |
| Potions, scrolls | items | consumables |
| Battle terrain | tiles | {biome} |
| World map locations | nodes | - |
| Item rarity borders | overlays | rarity |
| Enchantment effects | overlays | augments |

## Migration Script

The `npm run ai:migrate-paths` command migrates assets from legacy locations to the canonical path structure and generates all required size variants.

### Usage

```bash
# Migrate all asset categories
npm run ai:migrate-paths

# Migrate specific category
npm run ai:migrate-paths -- --category portraits

# Preview without making changes
npm run ai:migrate-paths -- --dry-run

# Verbose output
npm run ai:migrate-paths -- --category portraits --verbose
```

### What It Does

1. **Scans legacy locations** for existing assets (e.g., `/assets/sprites/portraits/`)
2. **Scans external originals** from the image-generator project (`../image-generator/outputs/originals/`)
3. **Copies originals** to the canonical `originals/` directory
4. **Generates size variants** using ImageMagick (64, 128, 256 for portraits)
5. **Skips existing files** to avoid redundant processing

### External Originals Integration

The migration script automatically finds 1024x1024 originals from the external `image-generator` project and uses them as source for size variant generation. This ensures high-quality resizing even when the AI generation pipeline saves processed images to a separate location.

## Related Documentation

- **AI Image Generation:** `docs/AI_IMAGE_GENERATION.md` - Image generation pipeline
- **Audio Assets:** `docs/AUDIO_STYLE_GUIDE.md` - Audio path conventions
- **Design System:** `docs/DESIGN_SYSTEM.md` - UI component usage
