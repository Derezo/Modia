# Asset System Index

This document provides unified navigation for Modia's asset pipeline documentation, covering AI image generation, audio generation, and asset organization.

## Table of Contents

1. [Overview Diagram](#overview-diagram)
2. [Quick Reference](#quick-reference)
3. [Document Navigation](#document-navigation)
4. [Metadata Consistency](#metadata-consistency)
5. [Asset Type Reference](#asset-type-reference)
6. [Related Documents](#related-documents)

---

## Overview Diagram

```
                         MODIA ASSET PIPELINE
                         ====================

  +-----------------+     +-------------------+     +------------------+
  |   METADATA      |     |   GENERATION      |     |   DEPLOYMENT     |
  |   DEFINITIONS   |     |   PIPELINE        |     |   STRUCTURE      |
  +-----------------+     +-------------------+     +------------------+
         |                        |                        |
         v                        v                        v
  +-------------+          +-------------+          +---------------+
  | ai-image-   |   --->   | HuggingFace |   --->   | frontend/     |
  | metadata/   |          | Flux LoRA   |          | public/       |
  |             |          | (External)  |          | assets/       |
  | - tiles/    |          +-------------+          |               |
  | - portraits/|                                   | - terrain/    |
  | - items/    |          +-------------+          | - portraits/  |
  | - icons/    |   --->   | Sharp.js    |   --->   | - items/      |
  | - nodes/    |          | Post-Proc   |          | - icons/      |
  +-------------+          +-------------+          | - nodes/      |
                                                    +---------------+
  +-------------+          +-------------+          +---------------+
  | audio-      |   --->   | Suno AI     |   --->   | frontend/     |
  | metadata/   |          | (Music)     |          | public/       |
  |             |          +-------------+          | assets/       |
  | - music/    |                                   | audio/        |
  | - sfx/      |          +-------------+          |               |
  |             |   --->   | ElevenLabs  |   --->   | - music/      |
  +-------------+          | (SFX)       |          | - sfx/        |
                           +-------------+          +---------------+

  +-------------+          +-------------+          +---------------+
  | Design      |   --->   | CSS Vars    |   --->   | Parchment UI  |
  | System      |          | Tokens      |          | Components    |
  +-------------+          +-------------+          +---------------+
```

---

## Quick Reference

### Generation Commands

| Command | Description |
|---------|-------------|
| `npm run ai:status` | Check AI image generation status |
| `npm run ai:validate` | Full validation of image files |
| `npm run ai:generate` | Generate all pending images |
| `npm run ai:generate:tiles` | Generate terrain tiles only |
| `npm run ai:generate:portraits` | Generate character portraits only |
| `npm run ai:generate:items` | Generate item sprites only |
| `npm run ai:generate:icons` | Generate UI icons only |
| `npm run ai:generate:nodes` | Generate world map nodes only |
| `npm run audio:status` | Check audio file status |
| `npm run audio:generate` | Generate all audio (music + SFX) |
| `npm run audio:generate:music` | Generate music tracks only |
| `npm run audio:generate:sfx` | Generate sound effects only |
| `npm run audio:download` | Download generated audio from Suno |
| `npm run audio:validate` | Validate audio file coverage |

### Single Asset Generation

```bash
# AI Images (with options)
npm run ai:generate:tiles -- --key forest_grass_1 --force
npm run ai:generate:tiles -- --biome forest
npm run ai:generate:portraits -- --race elf --class wizard
npm run ai:generate:tiles -- --dry-run          # Preview only
npm run ai:generate:tiles -- --lora v1          # Use specific LoRA model

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
| `v2` | wbgmsst | Isometric/textured | Tiles, terrain, obstacles |
| `modern-pixel` | umempart | Modern pixel art | Stylized assets |
| `retro-pixel` | Retro Pixel | Classic 8-bit | Retro-themed assets |

**Selection Priority:**
1. CLI `--lora` flag (override for batch operations)
2. Asset-level `loraModel` in metadata (per-asset override)
3. Category default from `manifest.json` (tiles=v2, others=v1)

**Category Defaults:**
- **Tiles:** `v2` (isometric perspective needs textured style)
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
npm run ai:generate:tiles -- --key grass_0

# HuggingFace API
npm run ai:generate:tiles -- --key grass_0 --huggingface
```

### Asset Directories

| Directory | Purpose | Sizes |
|-----------|---------|-------|
| `assets/sprites/terrain/{biome}/` | Battle map tiles | 64x64 |
| `assets/portraits/` | Character/enemy portraits | 64, 128, 256 |
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
| Terrain Tile | `{biome}_{variant}` | `forest_grass_1.png` |
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
| [AI_IMAGE_GENERATION.md](AI_IMAGE_GENERATION.md) | AI image generation pipeline | HuggingFace Flux, prompts, art direction |
| [AUDIO_STYLE_GUIDE.md](AUDIO_STYLE_GUIDE.md) | Audio generation guidelines | SFX prompts, music, regional profiles |
| [ASSET_PATH_STANDARD.md](ASSET_PATH_STANDARD.md) | Directory structure and naming | Path patterns, size conventions |
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

All asset metadata files follow a consistent JSON schema documented in [AI_IMAGE_GENERATION.md - Metadata Schema Reference](AI_IMAGE_GENERATION.md#metadata-schema-reference). Key points:

- **Required fields** for all assets: `id` (or `key` for tiles), `name`, `prompt`, `seed`, `generated`
- **Conditional fields** appear only when relevant: `generatedAt`, `loraModel`, `needsRegeneration`, `evaluation`
- **Category-specific fields** vary by asset type (see schema reference)

### Validation

Run metadata validation to check for schema compliance and missing assets:

```bash
# Full validation - checks schema, file existence, and consistency
npm run ai:validate

# Quick status check - summary counts only
npm run ai:status

# Validate specific category
npm run ai:validate -- --category tiles --verbose
```

The validation script checks:
- Required fields present in all asset entries
- `generated: true` assets have corresponding files
- `generatedAt` timestamp present when `generated: true`
- No orphaned files without metadata entries
- Consistent naming conventions

### Common Schema Patterns

| Pattern | Example | Used By |
|---------|---------|---------|
| `{type}_{name}` | `action_attack`, `rarity_epic` | Icons, overlays |
| `{race}_{gender}_{class}` | `human_male_warrior` | Portraits |
| `{terrain}_{variant}` | `grass_0`, `stone_3` | Tiles (via `key`) |
| `{category}_{material}` | `sword_short`, `armor_plate` | Items |

### Overlay System Status

Overlays (18 total) are defined in metadata for future AI generation:
- **Rarity overlays** (4): uncommon, rare, epic, legendary auras
- **Augment overlays** (14): fire, ice, lightning, poison, holy, dark, earth, wind, critical, lifesteal, speed, pierce, stun, chain

**Current status:** All 18 overlays have `generated: false`. The game currently renders rarity and augment effects using CSS styling (borders, shadows, gradients) rather than AI-generated image overlays. The metadata definitions preserve the art direction for future AI generation when needed.

---

## Asset Type Reference

### Image Assets

#### Terrain Tiles

Battle map floor, wall, and slope tiles organized by biome.

- **Metadata:** `ai-image-metadata/tiles/floors/`, `walls/`, `slopes/`
- **Output:** `frontend/public/assets/sprites/terrain/{biome}/{type}/`
- **Biomes:** forest, cave, mountain, bridge, castle
- **Size:** 64x64 pixels (isometric perspective)
- **Style:** Ink & wash, watercolor fills

#### Character Portraits

Bust shots for player characters and enemies.

- **Metadata:** `ai-image-metadata/portraits/`
- **Output:** `frontend/public/assets/portraits/{size}/`
- **Sizes:** 64 (UI), 128 (dialogs), 256 (details)
- **Player:** All race/gender/class combinations
- **Enemy:** Named enemies with `enemy_` prefix

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
- **Categories:** rarity (glow frames), augments (elemental effects)
- **Sizes:** 32, 48, 64, 128

**Rarity Overlays:**

| Rarity | Asset | Alpha | Description |
|--------|-------|-------|-------------|
| Common | `common.png` | 0.0 | No overlay (transparent) |
| Uncommon | `uncommon.png` | 0.5 | Subtle green glow |
| Rare | `rare.png` | 0.65 | Blue radiance |
| Epic | `epic.png` | 0.75 | Purple aura |
| Legendary | `legendary.png` | 0.85 | Golden shimmer |

**Augment Overlays:**

Elemental effect overlays for augmented items. Each adds visual flair to indicate augment type.

| Augment | Asset | Effect |
|---------|-------|--------|
| Fire | `fire.png` | Orange flame wisps |
| Ice | `ice.png` | Blue frost crystals |
| Lightning | `lightning.png` | Electric sparks |
| Poison | `poison.png` | Green toxic bubbles |
| Holy | `holy.png` | White divine rays |
| Dark | `dark.png` | Purple shadow tendrils |

**Compositing:**

Overlays are composited using CSS `mix-blend-mode: lighter` (additive blending) or canvas `globalCompositeOperation: 'lighter'` for runtime compositing. The base item sprite is drawn first, then the overlay is drawn on top with the appropriate alpha value.

```javascript
// Canvas compositing example
ctx.globalAlpha = 0.25; // Rare rarity alpha
ctx.globalCompositeOperation = 'lighter';
ctx.drawImage(overlayImage, x, y, width, height);
ctx.globalAlpha = 1.0;
ctx.globalCompositeOperation = 'source-over';
```

**Note:** Overlay compositing is currently documented for future implementation. The ItemIcon component handles rarity styling through CSS borders/shadows rather than runtime image compositing.

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

*Last updated: 2026-01-29 (added Metadata Consistency section, overlay status note)*
