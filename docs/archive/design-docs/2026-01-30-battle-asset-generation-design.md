# Battle Asset Generation Pipeline Expansion

**Date:** 2026-01-30
**Status:** Implementation Complete
**Archived:** 2026-01-30

## Overview

This document describes the design for expanding the AI image generation pipeline to support three new asset categories required for battle rendering:

1. **Wall Textures** - Side face textures for elevated terrain tiles
2. **Obstacle Sprites** - Rocks, trees, and environmental objects
3. **Character Sprites** - Animated sprite sheets for players and enemies

**Decision:** Elevation indicators (ramp, stairs, ledge, cliff) will be **removed from the game** rather than generated, as they don't provide sufficient gameplay value.

## Problem Context

Forest node battles fail to load ~100+ assets that don't exist:

```
GET /assets/sprites/terrain/forest/wall_forest_grass.png [404]
GET /assets/obstacles/rocks/rock_large.png [404]
GET /assets/characters/enemies/forest/forest_slime/forest_slime_idle.png [404]
GET /assets/characters/player/wizard/wizard_attack.png [404]
```

The current pipeline generates tiles, portraits, items, icons, nodes, and overlays—but not the battle-specific assets above.

## Design Decisions

### D1: AI Generation for All Categories

**Decision:** Use the existing AI image generation pipeline (Flux LoRA models) for all new asset types.

**Rationale:**
- Maintains consistent visual style (watercolor/parchment aesthetic)
- Leverages existing infrastructure (Python generator, ImageMagick post-processing)
- Metadata-driven approach enables regeneration and quality tracking

### D2: Vertical Strip Format for Character Sprites

**Decision:** Generate character animations as 64x512 PNG files (8 frames stacked vertically).

**Rationale:**
- Matches existing sprite format documented in CLAUDE.md
- Compatible with current `AnimatedSprite` and `BattleUnit` rendering
- Single-direction format is sufficient for isometric battle view

### D3: Frame-by-Frame Generation with Concatenation

**Decision:** Generate each animation frame separately, then concatenate into sprite strips.

**Rationale:**
- AI models cannot reliably generate coherent multi-frame sprite sheets in one pass
- Frame-by-frame allows per-frame prompt customization for animation poses
- ImageMagick `-append` operation handles concatenation efficiently

### D4: Biome-Organized Enemy Sprites

**Decision:** Organize enemy sprites by biome (forest/, cave/, mountain/, etc.).

**Rationale:**
- Matches AssetLoader path expectations (`/enemies/{biome}/{enemyId}/`)
- Enables biome-specific enemy variants
- Aligns with existing terrain organization pattern

## Technical Architecture

### New Metadata Structure

```
ai-image-metadata/
├── obstacles/
│   ├── manifest.json      # Category config
│   ├── rocks.json         # 5 rock types
│   └── trees.json         # 5 tree types
├── tiles/
│   └── indicators.json    # 4 indicator types × 5 biomes
└── characters/
    ├── manifest.json      # Sprite format config
    ├── player.json        # 4 classes × 5 animations
    └── enemies/
        ├── forest.json    # 6 enemies × 4 animations
        ├── cave.json
        ├── mountain.json
        ├── bridge.json
        └── castle.json
```

### Character Metadata Schema

```json
{
  "id": "forest_slime",
  "name": "Forest Slime",
  "biome": "forest",
  "animations": {
    "idle": {
      "frameCount": 8,
      "frames": [
        { "index": 0, "prompt": "Green slime creature resting pose, fantasy RPG" },
        { "index": 1, "prompt": "Green slime creature slight wobble frame 2" }
      ],
      "generated": false
    },
    "attack": { /* ... */ },
    "hit": { /* ... */ },
    "death": { /* ... */ }
  }
}
```

### Generation Script Flow

```
generate-characters.js
    │
    ├── Load metadata (characters/enemies/forest.json)
    │
    ├── For each character:
    │   └── For each animation:
    │       ├── Generate 8 frames via Python (Flux model)
    │       ├── Save to temp: ai-images-temp/frame_0.png ... frame_7.png
    │       ├── Concatenate: convert frame_*.png -append output.png
    │       ├── Move to: /assets/characters/enemies/forest/{id}/{id}_{anim}.png
    │       └── Update metadata: generated = true
    │
    └── Report generation stats
```

### ImageMagick Concatenation

```javascript
// New function in resizeUtils.js
async function concatenateVerticalStrip(framePaths, outputPath) {
  const args = [...framePaths, '-append', outputPath];
  await execImageMagick('convert', args);
}
```

## Asset Specifications

### Wall Textures
| Property | Value |
|----------|-------|
| Dimensions | 64x16 pixels |
| Format | PNG with transparency |
| Variants | 7 terrain types x 5 biomes = 35 files |
| Path | `/assets/sprites/terrain/{biome}/wall_{biome}_{terrain}.png` |

### Elevation Indicators
| Property | Value |
|----------|-------|
| Dimensions | 64x64 pixels |
| Format | PNG with transparency |
| Types | ramp, stairs, ledge, cliff |
| Variants | 4 types x 5 biomes = 20 files |
| Path | `/assets/sprites/terrain/{biome}/indicators/{type}_indicator.png` |

### Obstacle Sprites
| Property | Value |
|----------|-------|
| Dimensions | 64x64 to 128x256 (varies by type) |
| Format | PNG with transparency |
| Categories | rocks (5 types), trees (5 types) |
| Path | `/assets/obstacles/{category}/{type}.png` |

### Character Sprites
| Property | Value |
|----------|-------|
| Dimensions | 64x512 pixels (8 frames x 64px) |
| Format | PNG with transparency |
| Frame size | 64x64 pixels |
| Animations | idle, walk, attack, hit, death |
| Player path | `/assets/characters/player/{class}/{class}_{animation}.png` |
| Enemy path | `/assets/characters/enemies/{biome}/{id}/{id}_{animation}.png` |

## Implementation Phases

### Phase 1: Wall Textures
- Verify existing metadata in `ai-image-metadata/tiles/walls/`
- Update prompts for "side face texture" appearance
- Run generation: `npm run ai:generate:tiles -- --category walls`

### Phase 2: Elevation Indicators
- Create `ai-image-metadata/tiles/indicators.json`
- Add indicator generation to `generate-tiles.js`
- Run generation: `npm run ai:generate:tiles -- --category indicators`

### Phase 3: Obstacles
- Create obstacle metadata files
- Create `scripts/ai-images/generate-obstacles.js`
- Add npm script: `ai:generate:obstacles`

### Phase 4: Character Sprites
- Create character metadata structure
- Add `concatenateVerticalStrip()` to resizeUtils.js
- Create `scripts/ai-images/generate-characters.js`
- Generate player classes first (4 classes)
- Generate forest enemies (test biome)
- Generate remaining biome enemies

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Frame inconsistency in animations | Medium | Use same seed for all frames; include frame number in prompts |
| Long generation time | Low | Batch processing with progress tracking; prioritize visible assets |
| Style drift between characters | Medium | Consistent style prefix; review first batch before bulk generation |
| Asset size bloat | Low | PNG optimization; consider WebP for production |

## Success Criteria

1. Zero 404 errors for battle assets in browser console
2. All terrain types render with appropriate wall textures
3. Elevation transitions show indicator sprites
4. Obstacles render on battle grid
5. Player and enemy characters animate with 8-frame cycles
6. Visual style consistent with existing game assets

## Implementation Notes

### Naming Convention Fixes Applied

During implementation, several naming conventions were corrected to maintain consistency:

| Original | Corrected | Reason |
|----------|-----------|--------|
| `player.json` | `players.json` | Plural consistency with other category files |
| Array key `"characters"` | `"players"` | Descriptive alignment with file name |
| Flat `enemies.json` | Per-biome files in `enemies/` | Matches biome-organized asset loading |

### Final Metadata Structure

```
ai-image-metadata/
├── obstacles/
│   ├── manifest.json      # Category config with categoryFiles
│   ├── rocks.json         # 5 rock types
│   └── trees.json         # 5 tree types
└── characters/
    ├── manifest.json      # Sprite format config with nested categoryFiles
    ├── players.json       # 4 classes with "players" array key
    └── enemies/
        ├── forest.json    # Per-biome enemy definitions
        ├── cave.json
        ├── mountain.json
        ├── bridge.json
        └── castle.json
```

### Manifest Structure

The `characters/manifest.json` uses nested `categoryFiles` to support the per-biome enemy organization:

```json
{
  "categoryFiles": {
    "players": "players.json",
    "enemies": {
      "forest": "enemies/forest.json",
      "cave": "enemies/cave.json",
      "mountain": "enemies/mountain.json",
      "bridge": "enemies/bridge.json",
      "castle": "enemies/castle.json"
    }
  }
}
```

### Admin Dashboard Integration

New pages added to the admin dashboard for asset management:

| Page | Purpose | Key Features |
|------|---------|--------------|
| `ObstaclesPage.jsx` | Manage rock/tree obstacle sprites | Subcategory filtering (rocks/trees) |
| `CharactersPage.jsx` | Manage player/enemy sprite sheets | Biome filtering, animation preview |

**SpritePreview Component:**
- Located at `admin/src/components/SpritePreview.jsx`
- Renders animated character sprites from vertical strip format
- Supports frame-by-frame animation playback
- Configurable frame rate and animation selection

**Filter Configurations:**
- Obstacles: Subcategory dropdown (rocks, trees)
- Characters: Category tabs (players/enemies) + biome filter for enemies

## Related Documents

- `docs/AI_IMAGE_GENERATION.md` - Existing pipeline documentation
- `docs/ASSET_SYSTEM_INDEX.md` - Asset organization reference
- `CLAUDE.md` - Character sprite format specification
