# Asset Metadata Schema

This document describes the JSON metadata schema conventions used across Modia's AI-generated asset system. Metadata files in `ai-image-metadata/` define asset properties, generation parameters, and runtime enrichment.

## Table of Contents

1. [Overview](#overview)
2. [Underscore Prefix Convention](#underscore-prefix-convention)
3. [Common Fields](#common-fields)
4. [Category Schemas](#category-schemas)
5. [Metadata Loading Flow](#metadata-loading-flow)
6. [Manifest Structure](#manifest-structure)

---

## Overview

Asset metadata is stored in JSON files under `ai-image-metadata/`. Each category has its own directory structure with manifest files linking individual asset definitions.

Battle tiles are compiled deterministically. Their prompt text and seed can act as material and variation hints, but no AI backend or LoRA is selected. The versioned geometry and validation rules are documented in [ISOMETRIC_TILE_SYSTEM.md](ISOMETRIC_TILE_SYSTEM.md).

```
ai-image-metadata/
  manifest.json              # Master manifest
  theme.json                 # Global art direction
  tiles/
    manifest.json            # Category manifest
    floors/{biome}.json      # Floor tile definitions
    walls/{biome}.json       # Wall tile definitions
    slopes/{biome}.json      # Slope tile definitions
  portraits/
    manifest.json
    combinations.json        # Player portraits
    enemies.json             # Enemy portraits
  items/
    manifest.json
    weapons.json
    armor.json
    accessories.json
    consumables.json
  icons/
    manifest.json
    actions.json
    status.json
    menu.json
    resources.json
    augments.json
    zodiac.json
  nodes/
    manifest.json
    locations.json
  overlays/
    manifest.json
    rarity.json
    augments.json
  characters/
    manifest.json
    players.json
    enemies/{biome}.json
  obstacles/
    manifest.json
    rocks.json
    trees.json
```

---

## Underscore Prefix Convention

Fields prefixed with underscore (`_`) are **runtime-enriched fields** added during metadata loading. They are not stored in the source JSON files but computed from context (directory path, manifest settings, etc.).

### Runtime Fields

| Field | Type | Description | Added By |
|-------|------|-------------|----------|
| `_biome` | string | Biome name from directory path | Tile loader |
| `_category` | string | Parent category (tiles, icons, etc.) | All loaders |
| `_subcategory` | string | Subcategory from directory or manifest | Most loaders |
| `_type` | string | Asset type disambiguation | Portrait loader |
| `_itemCategory` | string | Item classification | Item loader |
| `_tileCategory` | string | Tile type (floors, walls, slopes) | Tile loader |

### Example: Tile Loading

Source file `ai-image-metadata/tiles/floors/forest.json`:
```json
{
  "key": "grass_0",
  "terrain": "grass",
  "variant": 0,
  "prompt": "lush forest meadow grass",
  "generated": true
}
```

After loading and enrichment:
```json
{
  "key": "grass_0",
  "terrain": "grass",
  "variant": 0,
  "prompt": "lush forest meadow grass",
  "generated": true,
  "_biome": "forest",
  "_category": "tiles",
  "_subcategory": "floors",
  "_tileCategory": "floors"
}
```

### Why Underscore Prefix?

1. **Distinction**: Clearly separates stored vs computed data
2. **Safety**: Prevents accidental serialization of runtime data
3. **Debugging**: Easy to identify enriched fields in logs
4. **Convention**: Common pattern in JavaScript for internal/private fields

---

## Common Fields

Asset categories share these base concepts, but their required fields differ. In particular, tile requirements are category-specific and are validated against `tiles/manifest.json`.

### Core identity and generation fields

| Field | Type | Description |
|-------|------|-------------|
| `id` or `key` | string | Unique identifier (tiles use `key`) |
| `name` | string | Human-readable display name (AI categories) |
| `prompt` | string | AI prompt, or deterministic material hint for tiles |
| `seed` | integer | Reproducible AI or compiler variation seed |
| `generated` | boolean | Whether the asset has been generated |

### Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `generatedAt` | ISO timestamp | null | When asset was generated |
| `loraModel` | string | category default | LoRA model override for AI categories; ignored by the tile compiler |
| `needsRegeneration` | boolean | false | Queued for regeneration |
| `regenerationQueuedAt` | ISO timestamp | null | When queued |
| `evaluation` | object | null | Quality review data |
| `generationFailureCount` | integer | null | Failed attempt count |
| `lastError` | string | null | Most recent error message |

### Evaluation Object

```json
{
  "evaluation": {
    "score": 8,
    "issues": ["too_dark", "unclear_meaning"],
    "regenerate": false
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `score` | integer (0-10) | Quality rating |
| `issues` | string[] | Issue codes |
| `regenerate` | boolean | Whether marked for regeneration |

---

## Category Schemas

### Tiles

Tiles use `key` instead of `id` and follow the deterministic `iso64-retina-v3` contract. Their canonical identity is `(tileCategory, biome, key)`; admin requests additionally retain the global `tiles` category and source file.

**File structure:** `tiles/{tileCategory}/{biome}.json`

```json
{
  "biome": "forest",
  "category": "floors",
  "description": "Forest biome floor tiles",
  "palette": {
    "primary": "#6B8E4A",
    "secondary": "#8B7355",
    "accent": "#4A6B2A"
  },
  "tiles": [
    {
      "key": "grass_0",
      "terrain": "grass",
      "variant": 0,
      "prompt": "lush forest meadow grass with dappled sunlight",
      "generated": true,
      "generatedAt": "2026-01-25T19:54:17.684Z"
    }
  ]
}
```

**Tile-specific fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `key` | string | Yes | Safe identifier, unique within its category and biome |
| `terrain` | string | Floors/walls | Material family (grass, stone, water, lava, etc.) |
| `variant` | integer | No | Non-negative floor variation index |
| `direction` | string | Slopes | `north`, `south`, `east`, or `west` |
| `levels` | integer | No | Elevation span represented by a slope or stairs tile |
| `type` | string | No | `stairs` for stair variants |
| `prompt` | string | No | Material inference hint; never sent to an AI backend |
| `seed` | integer | No | Additional deterministic variation input |

**File-level fields:**

| Field | Type | Description |
|-------|------|-------------|
| `biome` | string | Biome name |
| `category` | string | Tile category (floors, walls, slopes) |
| `palette` | object | Color palette with primary, secondary, accent |
| `description` | string | Human-readable metadata group description |

### Portraits

Portraits include character trait references for prompt construction.

**Files:** `portraits/combinations.json` (players), `portraits/enemies.json`

```json
{
  "version": "2.0.0",
  "description": "All player portrait combinations",
  "raceTraits": {
    "human": "human features balanced proportions warm skin tone",
    "elf": "elf pointed ears angular features fair complexion"
  },
  "genderTraits": {
    "male": "male masculine features",
    "female": "female feminine features"
  },
  "classTraits": {
    "warrior": "warrior heavy armor sword shield battle-worn"
  },
  "portraits": [
    {
      "id": "human_male_warrior",
      "race": "human",
      "gender": "male",
      "class": "warrior",
      "seed": 10001,
      "generated": true,
      "generatedAt": "2026-01-27T19:52:03.258Z"
    }
  ]
}
```

**Portrait-specific fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Format: `{race}_{gender}_{class}` or `enemy_{name}` |
| `race` | string | Yes | human, elf, dwarf, vampire, orc |
| `gender` | string | Yes | male, female, other |
| `class` | string | Yes | Base or advanced class name |
| `_type` | string | Runtime | Set to `"enemy"` for enemy portraits |

### Authored Player Animations

An authored animation spec freezes the source paths, rendered prompts, extraction settings, frame mapping, and reproducibility pins for one player identity.

**Files:** `characters/player-authored-animations/<id>.json`, with tracked PNGs under `characters/player-animation-sources/<id>/`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Exact player-variant ID; the filename must be `<id>.json` |
| `status` | string | Yes | Simple build switch: `draft-*` is ignored; `approved`, `approved-*`, or `approved_*` enables the authored override |
| `template`, `profileSource` | string | Yes | Project-relative drafting-contract sources, retained and hash-pinned |
| `reference`, `animations` | object | Yes | Accepted source paths, prompts, atlas settings, and frame mappings |
| `pins` | object | Enabled specs | Source, prompt, pose, frame, and encoded/decoded output hashes written by the compiler |

See [AUTHORED_PLAYER_ANIMATIONS.md](AUTHORED_PLAYER_ANIMATIONS.md) for the complete draft, source-art, compile, and rebuild commands.

### Items

Items include category information for path construction.

**Files:** `items/weapons.json`, `items/armor.json`, `items/accessories.json`, `items/consumables.json`

```json
{
  "version": "1.0.0",
  "category": "weapons",
  "description": "Weapon item sprites",
  "items": [
    {
      "id": "sword_short",
      "name": "Short Sword",
      "prompt": "short sword simple blade leather grip compact",
      "seed": 20001,
      "generated": true,
      "generatedAt": "2026-01-26T14:16:47.202Z"
    }
  ]
}
```

**Item-specific fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Item identifier |
| `name` | string | Yes | Display name |
| `_itemCategory` | string | Runtime | weapon, armor, accessory, consumable |

### Icons

Icons include category context and use simplified identifiers.

**Files:** `icons/actions.json`, `icons/status.json`, `icons/menu.json`, `icons/resources.json`, `icons/augments.json`, `icons/zodiac.json`

```json
{
  "version": "1.0.0",
  "category": "actions",
  "description": "Battle action icons",
  "size": "32x32",
  "icons": [
    {
      "id": "attack",
      "name": "Attack",
      "prompt": "crossed swords attack action combat strike",
      "seed": 30001,
      "generated": true,
      "generatedAt": "2026-01-29T07:44:23.416Z"
    }
  ]
}
```

**Icon-specific fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Icon identifier |
| `name` | string | Yes | Display name |

**File-level fields:**

| Field | Type | Description |
|-------|------|-------------|
| `category` | string | Icon category (actions, status, menu, etc.) |
| `size` | string | Target output size (e.g., "32x32") |

### Nodes (World Map)

Nodes represent world map locations with evaluation data.

**File:** `nodes/locations.json`

```json
{
  "version": "1.0.0",
  "description": "World map node icons",
  "nodes": [
    {
      "id": "castle",
      "name": "Castle",
      "prompt": "castle fortress towers battlements medieval stronghold",
      "seed": 40001,
      "generated": true,
      "generatedAt": "2026-01-27T20:49:34.825Z"
    }
  ]
}
```

**Node-specific fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Node type (no `node_` prefix) |
| `name` | string | Yes | Location display name |

### Overlays

Overlays include blending metadata for compositing.

**Files:** `overlays/rarity.json`, `overlays/augments.json`

```json
{
  "version": "1.0.0",
  "category": "rarity",
  "subcategory": "rarity",
  "description": "Item rarity overlays",
  "blendMode": "lighter",
  "overlays": [
    {
      "id": "rare",
      "name": "Rare",
      "rarity": "rare",
      "alpha": 0.65,
      "prompt": "blue radiance glow mystical aura",
      "seed": 24001,
      "generated": false
    }
  ]
}
```

**Rarity overlay fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Format: `{rarity}` |
| `rarity` | string | Yes | uncommon, rare, epic, legendary |
| `alpha` | number | Yes | Blend opacity (0.0-1.0) |

**Augment overlay fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Format: `{type}` |
| `element` | string | Conditional | fire, ice, lightning, poison, holy, dark, earth, wind |
| `effect` | string | Conditional | critical, lifesteal, speed, pierce, stun, chain |
| `alpha` | number | Yes | Blend opacity (0.0-1.0) |

**File-level fields:**

| Field | Type | Description |
|-------|------|-------------|
| `blendMode` | string | CSS blend mode (e.g., "lighter") |

### Characters (Animated Sprites)

Characters define animated sprite sheet generation.

**Files:** `characters/players.json`, `characters/enemies/{biome}.json`

```json
{
  "version": "1.0.0",
  "description": "Player character sprite sheets",
  "animations": ["idle", "walk", "attack", "hurt", "death", "dead", "cast", "victory"],
  "characters": [
    {
      "id": "warrior",
      "name": "Warrior",
      "class": "warrior",
      "prompt": "medieval warrior knight heavy armor sword shield",
      "seed": 50001,
      "generated": true,
      "generatedAt": "2026-01-30T12:00:00.000Z"
    }
  ]
}
```

**Character-specific fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Class name (players) or enemy ID |
| `class` | string | Yes | Character class |
| `biome` | string | Enemies | Biome for enemy organization |

### Obstacles

Obstacles define battle map decorative elements.

**Files:** `obstacles/rocks.json`, `obstacles/trees.json`

```json
{
  "version": "1.0.0",
  "category": "rocks",
  "description": "Rock obstacle sprites",
  "obstacles": [
    {
      "id": "rock_small",
      "name": "Small Rock",
      "prompt": "small grey boulder rocky formation",
      "seed": 60001,
      "generated": true
    }
  ]
}
```

**Obstacle-specific fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Obstacle identifier |
| `name` | string | Yes | Display name |

---

## Metadata Loading Flow

```
    JSON File                    Metadata Loader                  Enriched Asset
  +---------------+            +------------------+            +------------------+
  | tiles/floors/ |   ------>  | loadTileAssets() |   ------>  | { key, terrain,  |
  | forest.json   |            |                  |            |   _biome,        |
  |               |            | 1. Parse JSON    |            |   _category,     |
  | { key, prompt |            | 2. Extract path  |            |   _subcategory } |
  |   terrain }   |            | 3. Add _ fields  |            |                  |
  +---------------+            +------------------+            +------------------+
```

### Loading Steps

1. **Parse JSON**: Read and parse the JSON file
2. **Extract context**: Get biome/category from file path or manifest
3. **Enrich assets**: Add underscore-prefixed runtime fields
4. **Normalize IDs**: Ensure consistent `id` field (tiles: `key` -> `id`)
5. **Return array**: Flat array of enriched asset objects

### Example Loader Code

```javascript
async function loadTileAssets(biome, tileCategory) {
  const filePath = `ai-image-metadata/tiles/${tileCategory}/${biome}.json`;
  const data = JSON.parse(await fs.readFile(filePath, 'utf8'));

  return data.tiles.map(tile => ({
    ...tile,
    id: tile.key,  // Normalize to id
    _biome: biome,
    _category: 'tiles',
    _subcategory: tileCategory,
    _tileCategory: tileCategory
  }));
}
```

---

## Manifest Structure

### Master Manifest

`ai-image-metadata/manifest.json` provides global configuration. Its `categoryDefaults.tiles` value is retained for API compatibility and is ignored by the tile compiler:

```json
{
  "version": "1.0.0",
  "description": "Master manifest for Modia generated visual assets, including deterministic battle terrain",
  "totalAssets": 985,
  "artDirection": {
    "mood": "cozy_nostalgic",
    "technique": "ink_wash",
    "lineWeight": "medium",
    "texture": "aged_parchment"
  },
  "categoryDefaults": {
    "tiles": "v2",
    "portraits": "v1",
    "items": "v1",
    "icons": "v1",
    "nodes": "v1",
    "overlays": "v1"
  },
  "generationSettings": {
    "defaultSeed": 42,
    "defaultTrigger": "wbgmsst"
  }
}
```

### Category Manifests

Each category has its own manifest linking to asset files:

```json
{
  "version": "1.0.0",
  "category": "icons",
  "description": "UI icons",
  "totalAssets": 143,
  "categoryFiles": [
    "actions.json",
    "status.json",
    "menu.json",
    "resources.json",
    "augments.json",
    "zodiac.json"
  ]
}
```

---

## Related Documentation

- **Path Configuration:** `docs/ASSET_PATH_CONFIGURATION.md` - Single source of truth architecture
- **Directory Structure:** `docs/ASSET_PATH_STANDARD.md` - Physical file organization
- **AI Generation:** `docs/AI_IMAGE_GENERATION.md` - Generation pipeline and prompts
- **Asset Index:** `docs/ASSET_SYSTEM_INDEX.md` - Unified navigation
