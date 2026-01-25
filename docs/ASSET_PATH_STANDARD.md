# Asset Path Standardization

## Overview

This document describes the standardized asset path patterns used across Modia for AI-generated images and game assets. The `shared/assetPaths.js` module provides a single source of truth for path construction, ensuring consistency across the frontend, API, and asset generation scripts.

## Directory Structure

```
frontend/public/assets/
├── audio/                          # Music and SFX (see AUDIO_STYLE_GUIDE.md)
├── icons/
│   ├── png/                        # Rasterized icons (AI-generated)
│   │   ├── 16/
│   │   │   └── {subcategory}-{id}.png
│   │   ├── 24/
│   │   ├── 32/
│   │   ├── 48/
│   │   └── 64/
│   └── svg/                        # Hand-crafted SVG icons
│       ├── menu/
│       ├── resources/
│       └── stats/
├── sprites/
│   ├── characters/                 # Animated character sprites
│   │   ├── enemies/{biome}/{enemy}/
│   │   │   └── {enemy}_{action}.png
│   │   └── player/{class}/
│   │       └── {class}_{action}.png
│   ├── enemies/
│   │   └── portraits/
│   │       └── {id}.png
│   ├── icons/                      # Legacy sprite-based icons
│   │   ├── actions/
│   │   ├── augments/
│   │   ├── menu/
│   │   └── status/
│   ├── items/
│   │   ├── accessories/
│   │   │   └── {id}_{size}.png
│   │   ├── armor/
│   │   ├── consumables/
│   │   └── weapons/
│   ├── nodes/                      # World map node icons
│   │   ├── 48x48/                  # Smaller size variants (planned)
│   │   ├── backdrop/               # World map background tiles
│   │   ├── paths/                  # Road/path sprites
│   │   └── node_{type}.png         # 96px node icons
│   ├── obstacles/                  # Battle map obstacles
│   ├── overlays/
│   │   ├── augments/
│   │   └── rarity/
│   ├── portraits/                  # Player character portraits
│   │   └── {race}_{gender}_{class}.png
│   └── terrain/                    # Battle map tiles
│       ├── base/                   # Generic/shared tiles
│       ├── bridge/
│       ├── castle/
│       ├── cave/
│       ├── default/
│       ├── forest/
│       └── mountain/
```

## Path Patterns by Category

### Icons (Directory-Based Sizes)

Icons use a directory-based size organization where each size has its own folder.

- **Pattern:** `/assets/icons/png/{size}/{subcategory}-{id}.png`
- **Sizes:** 16, 24, 32, 48, 64, 128
- **Default Size:** 32
- **Subcategories:** `actions`, `status`, `ui`, `skills`

**Examples:**
```
/assets/icons/png/32/actions-action_attack.png
/assets/icons/png/48/status-poison.png
/assets/icons/png/16/ui-close.png
```

### Items (Suffix-Based Sizes)

Items use filename suffix-based sizing where the size is appended to the filename.

- **Pattern:** `/assets/sprites/items/{subcategory}/{id}_{size}.png`
- **Sizes:** 32, 48, 64, 128
- **Default Size:** 64
- **Subcategories:** `weapons`, `armor`, `accessories`, `consumables`

**Examples:**
```
/assets/sprites/items/weapons/sword_iron_64.png
/assets/sprites/items/armor/plate_chest_32.png
/assets/sprites/items/consumables/potion_health_48.png
```

### Portraits

Portraits have separate paths for player characters and enemies.

- **Player Pattern:** `/assets/sprites/portraits/{id}.png`
- **Enemy Pattern:** `/assets/sprites/enemies/portraits/{id}.png`
- **Sizes:** Currently 64px only (128, 256 planned)
- **Subcategories:** `characters` (default), `enemies`

**Naming Convention:**
- Player: `{race}_{gender}_{class}.png` (e.g., `human_male_warrior.png`)
- Enemy: `{enemy_id}.png` (e.g., `goblin_warrior.png`)

**Examples:**
```
/assets/sprites/portraits/elf_female_wizard.png
/assets/sprites/portraits/dwarf_male_berserker.png
/assets/sprites/enemies/portraits/forest_slime.png
/assets/sprites/enemies/portraits/cave_bat.png
```

### Tiles (Battle Terrain)

Tiles are terrain sprites organized by biome and category. There are three tile categories:

- **Floors:** 64x64 pixel floor tiles
- **Walls:** 64x16 pixel vertical cliff faces
- **Slopes:** 64x80 pixel ramp/stair tiles

**Patterns by Category:**

| Category | Pattern | Example |
|----------|---------|---------|
| Floors | `/terrain/{biome}/{key}.png` | `/terrain/base/grass_0.png` |
| Walls | `/terrain/{biome}/walls/{terrain}_wall.png` | `/terrain/base/walls/grass_wall.png` |
| Slopes | `/terrain/{biome}/slopes/{direction}_{levels}.png` | `/terrain/base/slopes/north_1.png` |
| Stairs | `/terrain/{biome}/slopes/stairs_{direction}_{levels}.png` | `/terrain/base/slopes/stairs_north_1.png` |

**Biomes:** `base`, `forest`, `cave`, `mountain`, `bridge`, `castle`

**Metadata Key to Filename Mapping:**

| Key Pattern | File Path |
|-------------|-----------|
| `grass_0` | `{biome}/grass_0.png` |
| `wall_base_grass` | `{biome}/walls/grass_wall.png` |
| `slope_base_north_1` | `{biome}/slopes/north_1.png` |
| `stairs_base_north_1` | `{biome}/slopes/stairs_north_1.png` |

**Examples:**
```
/assets/sprites/terrain/forest/grass_0.png           # Floor tile
/assets/sprites/terrain/base/walls/grass_wall.png    # Wall tile
/assets/sprites/terrain/base/slopes/north_1.png      # Slope tile
/assets/sprites/terrain/bridge/slopes/stairs_east_2.png  # Stairs tile
```

### Nodes (World Map)

World map node icons for locations on the overworld.

- **Pattern:** `/assets/sprites/nodes/{id}.png`
- **Sizes:** 96px (default), 48px (in `48x48/` subdirectory)
- **IDs:** `node_castle`, `node_city`, `node_village`, `node_tavern`, `node_shop`, `node_guild`, `node_forest`, `node_cave`, `node_mountain`, `node_ruins`, `node_fishing`, `node_caravan`, `node_watchtower`, etc.
- **Note:** IDs in metadata include the `node_` prefix (e.g., `node_castle`, not `castle`)

**Examples:**
```
/assets/sprites/nodes/node_castle.png
/assets/sprites/nodes/node_tavern.png
/assets/sprites/nodes/node_guild_warrior.png
/assets/sprites/nodes/48x48/node_castle.png  (planned)
```

### Overlays

Visual overlays for item rarity and augment effects.

- **Pattern:** `/assets/sprites/overlays/{subcategory}/{id}.png`
- **Sizes:** 32, 48, 64, 128 (planned)
- **Subcategories:** `rarity`, `augments`

**Examples:**
```
/assets/sprites/overlays/rarity/rare.png
/assets/sprites/overlays/rarity/epic.png
/assets/sprites/overlays/augments/fire.png
```

### Character Sprites (Animated)

Animated character sprites for battle and world map.

- **Player Pattern:** `/assets/sprites/characters/player/{class}/{class}_{action}.png`
- **Enemy Pattern:** `/assets/sprites/characters/enemies/{biome}/{enemy}/{enemy}_{action}.png`
- **Actions:** `idle`, `walk`, `attack`, `hit`, `death`

**Examples:**
```
/assets/sprites/characters/player/wizard/wizard_idle.png
/assets/sprites/characters/enemies/forest/goblin_warrior/goblin_warrior_attack.png
```

## AssetPathResolver API

The `shared/assetPaths.js` module provides utilities for consistent path construction.

### Constants

```javascript
import { SIZE_PRESETS, DEFAULT_SIZES, ASSET_CATEGORIES } from '@shared/assetPaths.js';

// Available sizes per category
SIZE_PRESETS = {
  tiles: [64],
  portraits: [64, 128, 256],
  items: [32, 64, 128],
  icons: [16, 24, 32, 48, 64, 128],
  nodes: [48, 96],
  overlays: [32, 48, 64, 128]
};

// Default size when not specified
DEFAULT_SIZES = {
  tiles: 64,
  portraits: 64,
  items: 64,
  icons: 32,
  nodes: 96,
  overlays: 64
};

// Valid categories
ASSET_CATEGORIES = ['tiles', 'portraits', 'items', 'icons', 'nodes', 'overlays'];
```

### Functions

#### `getAssetUrl(category, id, options)`

Main function for retrieving asset URLs. Returns legacy paths by default.

```javascript
import { getAssetUrl } from '@shared/assetPaths.js';

// Icon with specific size
getAssetUrl('icons', 'action_attack', { subcategory: 'actions', size: 48 });
// => '/assets/icons/png/48/actions-action_attack.png'

// Item with default size (64)
getAssetUrl('items', 'sword_iron', { subcategory: 'weapons' });
// => '/assets/sprites/items/weapons/sword_iron_64.png'

// Player portrait
getAssetUrl('portraits', 'human_male_warrior');
// => '/assets/sprites/portraits/human_male_warrior.png'

// Enemy portrait
getAssetUrl('portraits', 'goblin_warrior', { subcategory: 'enemies' });
// => '/assets/sprites/enemies/portraits/goblin_warrior.png'

// Terrain tile
getAssetUrl('tiles', 'forest_grass_1_v0', { subcategory: 'forest' });
// => '/assets/sprites/terrain/forest/forest_grass_1_v0.png'

// World map node
getAssetUrl('nodes', 'castle');
// => '/assets/sprites/nodes/node_castle.png'

// Overlay
getAssetUrl('overlays', 'rare', { subcategory: 'rarity' });
// => '/assets/sprites/overlays/rarity/rare.png'
```

#### `getLegacyPath(category, id, options)`

Get the current (legacy) path format explicitly.

```javascript
import { getLegacyPath } from '@shared/assetPaths.js';

getLegacyPath('icons', 'action_heal', { subcategory: 'actions', size: 32 });
// => '/assets/icons/png/32/actions-action_heal.png'
```

#### `getStandardizedPath(category, id, options)`

Get the future standardized path format (for migration planning).

```javascript
import { getStandardizedPath } from '@shared/assetPaths.js';

getStandardizedPath('items', 'sword_iron', { subcategory: 'weapons', size: 64 });
// => '/assets/items/png/64/weapons-sword_iron.png'
```

#### `getOutputPath(category, id, options)`

Get the filesystem path for asset generation scripts.

```javascript
import { getOutputPath } from '../../../shared/assetPaths.js';

getOutputPath('tiles', 'forest_grass_1_v0', { subcategory: 'forest' });
// => 'frontend/public/assets/sprites/terrain/forest/forest_grass_1_v0.png'

getOutputPath('icons', 'action_attack', { subcategory: 'actions', size: 32 });
// => 'frontend/public/assets/icons/png/32/actions-action_attack.png'
```

#### `getAllSizeVariants(category, id, options)`

Get all size variants for an asset.

```javascript
import { getAllSizeVariants } from '@shared/assetPaths.js';

getAllSizeVariants('items', 'sword_iron', { subcategory: 'weapons' });
// => [
//   { size: 32, url: '/assets/sprites/items/weapons/sword_iron_32.png' },
//   { size: 64, url: '/assets/sprites/items/weapons/sword_iron_64.png' },
//   { size: 128, url: '/assets/sprites/items/weapons/sword_iron_128.png' }
// ]
```

#### `isValidSize(category, size)`

Check if a size is valid for a category.

```javascript
import { isValidSize } from '@shared/assetPaths.js';

isValidSize('icons', 32);  // => true
isValidSize('icons', 50);  // => false
isValidSize('tiles', 64);  // => true
isValidSize('tiles', 128); // => false
```

#### `getDefaultSize(category)`

Get the default size for a category.

```javascript
import { getDefaultSize } from '@shared/assetPaths.js';

getDefaultSize('icons');     // => 32
getDefaultSize('items');     // => 64
getDefaultSize('portraits'); // => 64
```

#### `parseAssetFilename(filename, category)`

Parse an asset filename to extract metadata.

```javascript
import { parseAssetFilename } from '@shared/assetPaths.js';

parseAssetFilename('sword_iron_32.png', 'items');
// => { id: 'sword_iron', size: 32 }

parseAssetFilename('actions-action_attack.png', 'icons');
// => { subcategory: 'actions', id: 'action_attack' }

parseAssetFilename('node_castle.png', 'nodes');
// => { id: 'castle' }
```

## Usage Examples

### Frontend (Vite with @shared alias)

```javascript
// In a scene or component
import { getAssetUrl, DEFAULT_SIZES } from '@shared/assetPaths.js';

class InventoryUI {
  renderItem(item) {
    const iconUrl = getAssetUrl('items', item.templateId, {
      subcategory: item.type,
      size: 48
    });

    // Load and render the icon
    const img = new Image();
    img.src = iconUrl;
    // ...
  }
}
```

### API/Scripts (relative import)

```javascript
// In api/src/scripts/generate-items.js
import { getOutputPath } from '../../../shared/assetPaths.js';
import fs from 'fs';
import path from 'path';

async function saveGeneratedItem(itemId, buffer, subcategory, size) {
  const outputPath = getOutputPath('items', itemId, { subcategory, size });
  const fullPath = path.join(process.cwd(), outputPath);

  await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.promises.writeFile(fullPath, buffer);
}
```

### Admin Dashboard

```javascript
// In admin tools
import { getAssetUrl, getAllSizeVariants } from '../../../../shared/assetPaths.js';

function AssetPreview({ category, id, options }) {
  const variants = getAllSizeVariants(category, id, options);

  return variants.map(({ size, url }) => (
    <img key={size} src={url} alt={`${id} at ${size}px`} />
  ));
}
```

### Batch Asset Generation

```javascript
// Generate all size variants for an item
import { SIZE_PRESETS, getOutputPath } from '../../../shared/assetPaths.js';

async function generateAllItemSizes(itemId, subcategory, generateFn) {
  const sizes = SIZE_PRESETS.items;

  for (const size of sizes) {
    const buffer = await generateFn(itemId, size);
    const outputPath = getOutputPath('items', itemId, { subcategory, size });
    await saveFile(outputPath, buffer);
  }
}
```

## Migration Status

The table below tracks the migration from legacy path patterns to the standardized format.

| Category | Legacy Pattern | Standardized Pattern | Status |
|----------|---------------|---------------------|--------|
| icons | `/icons/png/{size}/{sub}-{id}.png` | Same | Complete |
| items | `/sprites/items/{sub}/{id}_{size}.png` | `/items/png/{size}/{sub}-{id}.png` | Pending |
| portraits | `/sprites/portraits/{id}.png` | `/portraits/png/{size}/{sub}-{id}.png` | Pending |
| nodes | `/sprites/nodes/node_{type}.png` | `/nodes/png/{size}/{sub}-{id}.png` | Pending |
| tiles | `/sprites/terrain/{biome}/{key}.png` | `/tiles/png/{size}/{sub}-{id}.png` | N/A (single size) |
| overlays | `/sprites/overlays/{sub}/{id}.png` | `/overlays/png/{size}/{sub}-{id}.png` | Pending |

### Migration Notes

1. **Icons** already follow the standardized directory-based size pattern
2. **Items** currently use suffix-based sizing; migration would adopt directory-based sizing
3. **Portraits** and **Nodes** currently have single sizes; migration would add size variants
4. **Tiles** remain at fixed 64px as battle grid standard
5. **Overlays** need size variants added for responsive UI

### Migration Checklist

When migrating a category:

- [ ] Create new directory structure
- [ ] Generate all size variants
- [ ] Update `assetPaths.js` legacy functions
- [ ] Update all frontend references
- [ ] Update asset generation scripts
- [ ] Remove old files after verification
- [ ] Update this documentation

## Best Practices

### Choosing Sizes

- **UI Elements:** Use smaller sizes (16-32px) for inline icons
- **Inventory/Shop:** Use medium sizes (48-64px) for item grids
- **Detail Views:** Use larger sizes (128px+) for inspect/preview
- **Battle Grid:** Use 64px for terrain tiles (grid standard)
- **World Map:** Use 96px for node icons (current standard)

### Adding New Assets

1. Determine the appropriate category
2. Follow the naming convention for that category
3. Generate all required size variants (check `SIZE_PRESETS`)
4. Use `getOutputPath()` for consistent file placement
5. Update relevant metadata/manifest files

### Category Selection Guide

| Asset Type | Category | Subcategory |
|------------|----------|-------------|
| Attack/skill icons | icons | actions |
| Status effect icons | icons | status |
| UI buttons/indicators | icons | ui |
| Swords, bows, staves | items | weapons |
| Helmets, chestplates | items | armor |
| Rings, necklaces | items | accessories |
| Potions, scrolls | items | consumables |
| Player faces | portraits | characters |
| Enemy faces | portraits | enemies |
| Battle terrain | tiles | {biome} |
| World map locations | nodes | - |
| Item rarity borders | overlays | rarity |
| Enchantment effects | overlays | augments |

## Related Documentation

- **AI Image Generation:** `docs/AI_IMAGE_GENERATION.md` - Image generation pipeline
- **Audio Assets:** `docs/AUDIO_STYLE_GUIDE.md` - Audio path conventions
- **Design System:** `docs/DESIGN_SYSTEM.md` - UI component usage
