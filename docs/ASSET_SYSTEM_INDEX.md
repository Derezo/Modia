# Asset System Index

This document provides unified navigation for Modia's deterministic tile compiler, AI image generation, audio generation, and asset organization.

## Table of Contents

1. [Overview Diagram](#overview-diagram)
2. [Quick Reference](#quick-reference)
3. [Document Navigation](#document-navigation)
4. [Metadata Consistency](#metadata-consistency)
5. [Overlay System](#overlay-system)
6. [Asset Type Reference](#asset-type-reference)
7. [Related Documents](#related-documents)

---

## Overview Diagram

```
tile metadata       -> deterministic material compiler -> terrain WebPs
image metadata      -> ComfyUI/HuggingFace -> Sharp     -> image assets
audio metadata      -> Suno/ElevenLabs                  -> audio assets
design tokens       -> CSS variables                    -> UI components
```

---

## Quick Reference

### Generation Commands

| Command | Description |
|---------|-------------|
| `npm run tiles:generate` | Compile missing deterministic terrain assets |
| `npm run tiles:rebuild` | Rebuild the complete terrain contract and prune legacy files |
| `npm run tiles:check` | Run tile compiler tests and strict live-asset validation |
| `npm run ai:status` | Check AI image generation status |
| `npm run ai:validate` | Full validation of image files |
| `npm run ai:generate` | Generate all pending categories; tiles are compiled deterministically |
| `npm run ai:generate:portraits` | Generate character portraits only |
| `npm run ai:generate:items` | Generate item sprites only |
| `npm run ai:generate:icons` | Generate UI icons only |
| `npm run ai:generate:nodes` | Generate world map nodes only |
| `npm run ai:draft:authored-player-animation -- --id <id>` | Create one metadata-only authored player-animation draft |
| `npm run ai:compile:authored-player-animations -- --id <id>` | Compile one enabled authored player-animation identity |
| `npm run ai:check:authored-player-animations` | Verify all enabled authored player-animation specs and outputs |
| `npm run audio:status` | Check audio file status |
| `npm run audio:generate` | Generate all audio (music + SFX) |
| `npm run audio:generate:music` | Generate music tracks only |
| `npm run audio:generate:sfx` | Generate sound effects only |
| `npm run audio:download` | Download generated audio from Suno |
| `npm run audio:validate` | Validate audio file coverage |

### Single Asset Generation

```bash
# Deterministic tiles
npm run tiles:generate -- --biome forest --category floors --key grass_0 --force
npm run tiles:generate -- --biome forest --dry-run

# AI images
npm run ai:generate:portraits -- --race elf --class wizard

# Audio (with options)
npm run audio:generate:music -- --key heartlands_tavern --wait
npm run audio:generate:music -- --region heartlands
npm run audio:generate:sfx -- --key attack_sword_1
```

### LoRA Model Selection

The image generation pipeline supports multiple LoRA models for different art styles.

| Model | Trigger Word | Style | Recommended For |
|-------|--------------|-------|-----------------|
| `v1` | GRPZA | Flat 2D pixel art | Icons, portraits, items |
| `v2` | wbgmsst | Isometric/textured | Obstacles and other isolated assets |
| `modern-pixel` | umempart | Modern pixel art | Stylized assets |
| `retro-pixel` | Retro Pixel | Classic 8-bit | Retro-themed assets |

**Selection Priority:**
1. CLI `--lora` flag (override for batch operations)
2. Asset-level `loraModel` in metadata (per-asset override)
3. Category default from `manifest.json`

**Category Defaults:**
- **Portraits:** `v1` (flat pixel art for character faces)
- **Items:** `v1` (clean flat sprites for inventory)
- **Icons:** `v1` (simple shapes for UI clarity)
- **Nodes:** `v1` (consistent with flat map style)

**Per-Asset Override:**
Add `loraModel` to any asset in metadata to override the category default:
```json
{
  "key": "boss_portrait",
  "prompt": "menacing demon lord...",
  "loraModel": "v2",  // Override v1 default for special style
  "generated": false
}
```

### Generation Backend

Images can be generated via:
- **ComfyUI (Local)** - Default, ~5-8s/image, requires local GPU
- **HuggingFace Space** - Fallback, ~30s/image, no local GPU needed

```bash
# Local ComfyUI (default)
npm run ai:generate:icons -- --key attack

# HuggingFace API
npm run ai:generate:icons -- --key attack --huggingface
```

Terrain tiles do not use either backend. See [ISOMETRIC_TILE_SYSTEM.md](ISOMETRIC_TILE_SYSTEM.md).

### Asset Directories

| Directory | Purpose | Sizes |
|-----------|---------|-------|
| `assets/sprites/terrain/{biome}/` | Lossless WebP battle tiles | 128x128 floor/slope sources; 128x32 walls |
| `assets/portraits/` | Character/enemy portraits | 32, 48, 64, 128, 256 |
| `assets/items/{subcategory}/` | Equipment/consumable icons | 32, 64, 128 |
| `assets/icons/png/` | UI action/status icons | 16, 24, 32, 48, 64 |
| `assets/icons/svg/` | Hand-crafted SVG icons | Scalable |
| `assets/nodes/` | World map node icons | 48, 96 |
| `assets/audio/music/` | Background music tracks | - |
| `assets/audio/sfx/` | Sound effects | - |
| `assets/sprites/characters/` | Animated sprite sheets | 64x512 (8 frames) |

### File Naming Conventions

| Asset Type | Pattern | Example |
|------------|---------|---------|
| Player Portrait | `{race}_{gender}_{class}` | `human_male_warrior.png` |
| Enemy Portrait | `enemy_{name}` | `enemy_goblin_warrior.png` |
| Terrain Tile | `{biome}/{key}.webp` | `forest/grass_1.webp` |
| Item | `{type}_{material}` | `sword_iron.png` |
| Action Icon | `{action}` | `attack.png` |
| Node | `{type}` | `castle.png`, `tavern.png` |
| Music | `{region}_{context}` | `heartlands_tavern.mp3` |
| SFX | `{category}_{action}` | `attack_sword_1.mp3` |

---

## Document Navigation

### Core Asset Documents

| Document | Description | Key Topics |
|----------|-------------|------------|
| [ISOMETRIC_TILE_SYSTEM.md](ISOMETRIC_TILE_SYSTEM.md) | Deterministic battle-terrain contract | Geometry, compiler, validation, admin queue |
| [AI_IMAGE_GENERATION.md](AI_IMAGE_GENERATION.md) | AI image generation pipeline | HuggingFace Flux, prompts, art direction |
| [AUTHORED_PLAYER_ANIMATIONS.md](AUTHORED_PLAYER_ANIMATIONS.md) | Authored player-animation operator runbook | Drafts, source atlases, compilation, pins, clean rebuilds |
| [AUDIO_STYLE_GUIDE.md](AUDIO_STYLE_GUIDE.md) | Audio generation guidelines | SFX prompts, music, regional profiles |
| [ASSET_PATH_STANDARD.md](ASSET_PATH_STANDARD.md) | Directory structure and naming | Path patterns, size conventions |
| [ASSET_PATH_CONFIGURATION.md](ASSET_PATH_CONFIGURATION.md) | Path system architecture | Single source of truth, consumer integration |
| [ASSET_METADATA_SCHEMA.md](ASSET_METADATA_SCHEMA.md) | Metadata JSON conventions | Underscore prefix, category schemas |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Parchment UI components | Colors, tokens, components |

### Document Purpose Map

```
AI_IMAGE_GENERATION.md         AUDIO_STYLE_GUIDE.md
          |                              |
          v                              v
   "How do I write          "How do I write
    image prompts?"          audio prompts?"
          |                              |
          +------+               +-------+
                 |               |
                 v               v
    ASSET_PATH_CONFIGURATION.md  <----  ASSET_METADATA_SCHEMA.md
    "How does the path             |    "What fields do I use
     system work?"                 |     in metadata JSON?"
                 |                 |
                 v                 v
         ASSET_PATH_STANDARD.md
                 |
                 v
         "Where do the
          files go?"
                 |
                 v
          DESIGN_SYSTEM.md
                 |
                 v
         "How do I use
          them in UI?"
```

---

## Metadata Consistency

### Schema Reference

All asset metadata files follow a consistent JSON schema documented in [ASSET_METADATA_SCHEMA.md](ASSET_METADATA_SCHEMA.md). Key points:

- **Identity fields** are common; required generation fields are category-specific. Tiles use the stricter versioned manifest contract.
- **Conditional fields** appear only when relevant: `generatedAt`, `loraModel`, `needsRegeneration`, `evaluation`
- **Category-specific fields** vary by asset type (see [Category Schemas](ASSET_METADATA_SCHEMA.md#category-schemas))
- **Underscore prefix** (`_biome`, `_category`, etc.) denotes runtime-enriched fields (see [Underscore Prefix Convention](ASSET_METADATA_SCHEMA.md#underscore-prefix-convention))

### Validation

Run metadata validation to check for schema compliance and missing assets:

```bash
# Full validation - checks schema, file existence, and consistency
npm run ai:validate

# Quick status check - summary counts only
npm run ai:status

# Validate the deterministic tile category
npm run tiles:validate -- --strict
```

AI metadata validation checks:
- Required fields present in all asset entries
- `generated: true` assets have corresponding files
- `generatedAt` timestamp present when `generated: true`
- No orphaned files without metadata entries

The tile validator additionally checks the v3 manifest geometry, lossless WebP dimensions and alpha, shared variant edges, missing outputs, and unexpected legacy images.
- Consistent naming conventions

### Common Schema Patterns

| Pattern | Example | Used By |
|---------|---------|---------|
| `{name}` | `attack`, `defend`, `poison` | Icons (unprefixed) |
| `{type}_{name}` | `rarity_epic`, `augment_fire` | Overlays |
| `{race}_{gender}_{class}` | `human_male_warrior` | Portraits |
| `{terrain}_{variant}` | `grass_0`, `stone_3` | Tiles (via `key`) |
| `{category}_{material}` | `sword_short`, `armor_plate` | Items |

---

## Overlay System

Overlays are transparent image layers composited on top of item sprites to convey rarity and augment effects. They provide visual feedback for item power and special properties.

### Overlay Types

**Rarity Overlays** (4 types): Visual glow frames indicating item rarity tier.

| Rarity | Asset | Alpha | Effect |
|--------|-------|-------|--------|
| Common | - | 0.0 | No overlay |
| Uncommon | `uncommon.png` | 0.5 | Subtle green glow |
| Rare | `rare.png` | 0.65 | Blue radiance |
| Epic | `epic.png` | 0.75 | Purple aura |
| Legendary | `legendary.png` | 0.85 | Golden shimmer |

**Augment Overlays** (18 types): Elemental and effect overlays for augmented items.

| Category | Augments | Effect Style |
|----------|----------|--------------|
| Elemental | fire, ice, lightning, poison, holy, dark, earth, wind | Elemental particles/auras |
| Combat | critical, speed, pierce, stun, chain, lifesteal | Combat effect indicators |
| Special | arcane, fortune, vitality, slayer | Unique visual effects |

### Category Mapping

Backend augment categories map to overlay asset IDs via `shared/overlayMapping.js`:

```javascript
import { CATEGORY_TO_OVERLAY, getPrimaryOverlay } from '@shared/overlayMapping.js';

// Direct mapping
CATEGORY_TO_OVERLAY['fire'];      // 'augment_fire'
CATEGORY_TO_OVERLAY['critical'];  // 'augment_critical'

// Get primary overlay for multi-augment items (priority-based)
getPrimaryOverlay(['fire', 'critical']);  // 'augment_fire' (elemental > combat)
getPrimaryOverlay(['speed', 'fortune']);  // 'augment_speed'
```

**Priority Order:** Elemental effects (1-8) > Combat effects (10-15) > Special augments (20-23)

### Usage

**ItemIcon.compositeHtml()** - Generates HTML with composited item icons:

```javascript
import { ItemIcon } from '../components/ItemIcon.js';

// From item object
const html = await ItemIcon.compositeHtml({
  item: inventoryItem,
  size: 'md'
});

// From individual properties
const html = await ItemIcon.compositeHtml({
  spriteId: 'sword_short',
  itemType: 'weapon',
  rarity: 'epic',
  augments: ['fire'],
  size: 'lg'
});
```

**OverlayCompositor** - Direct canvas compositing:

```javascript
import { overlayCompositor } from '../utils/OverlayCompositor.js';

const dataUrl = await overlayCompositor.composite({
  spriteId: 'sword_short',
  subcategory: 'weapons',
  size: 64,
  rarity: 'epic',
  augments: ['fire']
});
// Returns base64 data URL for use in <img src>
```

### File Locations

| Purpose | Path |
|---------|------|
| Metadata definitions | `ai-image-metadata/overlays/` |
| Rarity overlays | `frontend/public/assets/overlays/{size}/rarity/` |
| Augment overlays | `frontend/public/assets/overlays/{size}/augments/` |
| Category mapping | `shared/overlayMapping.js` |
| Compositor utility | `frontend/src/utils/OverlayCompositor.js` |
| ItemIcon component | `frontend/src/components/ItemIcon.js` |

**Available sizes:** 32, 48, 64, 128 pixels

### Generation

```bash
# Generate all overlays
node scripts/ai-images/generate-overlays.js --force

# Or via npm scripts
npm run ai:generate:overlays              # Regenerate missing overlays
npm run ai:generate:overlays -- --force   # Regenerate all overlays
npm run ai:generate:overlays -- --rarity  # Rarity overlays only
npm run ai:generate:overlays -- --augments  # Augment overlays only
```

---

## Asset Type Reference

### Image Assets

#### Terrain Tiles

Battle map floor, wall, and slope tiles organized by biome.

- **Metadata:** `ai-image-metadata/tiles/floors/`, `walls/`, `slopes/`
- **Output:** `frontend/public/assets/sprites/terrain/{biome}/{key}.webp`
- **Biomes:** forest, cave, mountain, bridge, castle
- **Contract:** `iso64-retina-v3` (128px retina source, 64x32 logical footprint)
- **Pipeline:** deterministic material compiler; no AI backend or LoRA
- **Reference:** [ISOMETRIC_TILE_SYSTEM.md](ISOMETRIC_TILE_SYSTEM.md)

#### Character Portraits

Bust shots for player characters and enemies.

- **Metadata:** `ai-image-metadata/portraits/`
- **Output:** `frontend/public/assets/portraits/{size}/`
- **Sizes:** 64 (UI), 128 (dialogs), 256 (details)
- **Player:** All race/gender/class combinations
- **Enemy:** Named enemies with `enemy_` prefix

#### Authored Player Animations

Higher-quality player references and eight-frame action strips are compiled from tracked, hash-pinned RGBA sources for one race/gender/class identity at a time.

- **Metadata:** `ai-image-metadata/characters/player-authored-animations/<id>.json`
- **Sources:** `ai-image-metadata/characters/player-animation-sources/<id>/`
- **Output:** `frontend/public/assets/characters/player/{race}/{gender}/{class}/`
- **Build switch:** `draft-*` is ignored; `approved`, `approved-*`, or `approved_*` enables the authored override
- **Runbook:** [AUTHORED_PLAYER_ANIMATIONS.md](AUTHORED_PLAYER_ANIMATIONS.md)

#### Item Sprites

Equipment and consumable icons.

- **Metadata:** `ai-image-metadata/items/`
- **Output:** `frontend/public/assets/items/{size}/{subcategory}/`
- **Subcategories:** weapons, armor, accessories, consumables
- **Sizes:** 32 (inventory grid), 64 (tooltips), 128 (details)

#### UI Icons

Action, status, menu, and augment icons.

- **Metadata:** `ai-image-metadata/icons/`
- **Output PNG:** `frontend/public/assets/icons/png/{size}/{category}/`
- **Output SVG:** `frontend/public/assets/icons/svg/{category}/`
- **Categories:** actions, status, menu, augments
- **Sizes:** 16, 24, 32, 48, 64

#### World Map Nodes

Landmark icons for the overworld map.

- **Metadata:** `ai-image-metadata/nodes/`
- **Output:** `frontend/public/assets/nodes/{size}/`
- **Types:** castle, city, village, tavern, shop, guild_*, etc.
- **Sizes:** 48 (zoomed out), 96 (zoomed in)

#### Overlays

Transparent overlay effects for item compositing (rarity auras, augment effects).

- **Metadata:** `ai-image-metadata/overlays/`
- **Output:** `frontend/public/assets/overlays/{size}/{category}/`
- **Categories:** rarity (4 types), augments (18 types)
- **Sizes:** 32, 48, 64, 128

See [Overlay System](#overlay-system) for detailed documentation on overlay types, category mapping, and usage patterns.

### Audio Assets

#### Music Tracks

Background music organized by region and context.

- **Metadata:** `audio-metadata/music/`
- **Output:** `frontend/public/assets/audio/music/`
- **Regions:** heartlands, sylvan_reaches, shadowmere, bloodplains, iron_depths
- **Contexts:** overworld, tavern, battle, boss
- **Generator:** Suno AI

#### Sound Effects

Game sound effects for combat, UI, and interactions.

- **Metadata:** `audio-metadata/sfx/`
- **Output:** `frontend/public/assets/audio/sfx/`
- **Categories:** combat (weapons, deaths, turns), skills, ui, ambient, interactions
- **Generator:** ElevenLabs
- **Critical:** Maximum 1 comma per prompt (see AUDIO_STYLE_GUIDE.md)

### Metadata Locations

```
ai-image-metadata/
  manifest.json           # Master index for all image types
  theme.json              # Global art direction settings
  tiles/
    manifest.json         # Tile category index
    floors/{biome}.json   # Floor tile definitions
    walls/{biome}.json    # Wall tile definitions
    slopes/{biome}.json   # Slope tile definitions
  portraits/
    manifest.json         # Portrait category index
    combinations.json     # Race/gender/class combinations
    enemies.json          # Enemy portrait definitions
  items/
    manifest.json         # Item category index
    weapons.json          # Weapon definitions
    armor.json            # Armor definitions
    accessories.json      # Accessory definitions
    consumables.json      # Consumable definitions
  icons/
    manifest.json         # Icon category index
    actions.json          # Action icon definitions
    status.json           # Status effect icons
    menu.json             # Menu icons
    augments.json         # Augment icons
  nodes/
    manifest.json         # Node category index
    locations.json        # Location node definitions
  overlays/
    manifest.json         # Overlay index
    rarity.json           # Rarity frame overlays
    augments.json         # Augment overlays

audio-metadata/
  music/
    manifest.json         # Music track index
    regions/{region}.json # Region-specific tracks
    battle/battle-themes.json
    core/core-tracks.json
  sfx/
    manifest.json         # SFX index
    combat/
      weapons.json        # Weapon sounds
      deaths.json         # Death sounds
      turns.json          # Turn indicators
      status-effects.json # Status effect sounds
    skills/
      player-skills.json  # Player ability sounds
      monster-skills.json # Monster ability sounds
      skill-templates.json
    ui/ui-sounds.json     # Interface sounds
    ambient/ambient.json  # Background ambience
    interactions/interactions.json
```

---

## Related Documents

### Asset Pipeline

- [ASSET_PATH_CONFIGURATION.md](ASSET_PATH_CONFIGURATION.md) - Path system architecture, single source of truth
- [ASSET_METADATA_SCHEMA.md](ASSET_METADATA_SCHEMA.md) - JSON metadata conventions, underscore prefix
- [AUTHORED_PLAYER_ANIMATIONS.md](AUTHORED_PLAYER_ANIMATIONS.md) - Reproducible authored player-animation workflow

### Architecture

- [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) - System design overview
- [FRONTEND_TECHNICAL_PATTERNS.md](FRONTEND_TECHNICAL_PATTERNS.md) - Canvas rendering patterns

### Game Systems

- [GAME_DESIGN.md](GAME_DESIGN.md) - Visual style context
- [BATTLE_ANIMATIONS.md](BATTLE_ANIMATIONS.md) - Animation timing and feedback
- [ENEMY_SYSTEM.md](ENEMY_SYSTEM.md) - Enemy visual requirements
- [ITEM_SYSTEM.md](ITEM_SYSTEM.md) - Item visual requirements

### Development

- [ROADMAP_TECHNICAL.md](ROADMAP_TECHNICAL.md) - Asset pipeline milestones
- [CLAUDE.md](../CLAUDE.md) - Asset generation commands reference

---

## Art Direction Summary

The visual style is **Cozy & Nostalgic** with **Ink & Wash Technique**:

| Aspect | Standard |
|--------|----------|
| Mood | Cozy, warm, inviting storybook/classic JRPG |
| Technique | Ink & wash (bold black outlines + watercolor fills) |
| Line Weight | Medium outlines (balanced visibility at all sizes) |
| Texture | Visible aged parchment with slight yellowing |

### Regional Color Palettes

| Region | Primary | Secondary | Accent |
|--------|---------|-----------|--------|
| Heartlands | Warm brown (#8B7355) | Golden tan (#D4A574) | Meadow green (#6B8E4A) |
| Sylvan Reaches | Sea green (#2E8B57) | Yellow-green (#9ACD32) | Sage (#8FBC8F) |
| Shadowmere | Deep purple (#483D8B) | Slate gray (#708090) | Ghostly blue (#87CEEB) |
| Bloodplains | Crimson (#8B0000) | Rust (#B7410E) | Bone white (#FFFAFA) |
| Iron Depths | Steel blue (#4682B4) | Charcoal (#36454F) | Copper (#B87333) |

See [AI_IMAGE_GENERATION.md](AI_IMAGE_GENERATION.md) for complete art direction guidelines.

---

*Last updated: 2026-02-02 (added ASSET_PATH_CONFIGURATION.md and ASSET_METADATA_SCHEMA.md references)*
