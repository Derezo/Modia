# AI Image Generation Pipeline

This document describes Modia's AI image generation system for creating game assets using HuggingFace Flux LoRA models.

## Overview

The AI image generation pipeline integrates with the external `image-generator` project to create:
- **Terrain tiles** - Isometric tiles for battle maps (floors, walls, slopes)
- **Character portraits** - Bust shots for all race/gender/class combinations
- **Item sprites** - Equipment and consumable icons
- **UI icons** - Action, status, menu, and augment icons
- **World map nodes** - Landmark icons for the overworld

## Quick Start

```bash
# Check current generation status
npm run ai:status

# Preview what would be generated (dry run)
npm run ai:generate:tiles -- --dry-run

# Generate a single asset
npm run ai:generate:tiles -- --key forest_grass_1 --force

# Generate all assets for a biome/category
npm run ai:generate:tiles -- --biome forest
npm run ai:generate:portraits -- --race elf

# Generate everything
npm run ai:generate
```

## Art Direction

The visual style is **Cozy & Nostalgic** with **Ink & Wash Technique**:

| Aspect | Choice |
|--------|--------|
| **Mood** | Cozy, warm, inviting storybook/classic JRPG |
| **Technique** | Ink & wash (bold black outlines + watercolor fills) |
| **Line Weight** | Medium outlines (balanced visibility at all sizes) |
| **Texture** | Visible aged parchment with slight yellowing |

### Regional Color Palettes

| Region | Primary | Secondary | Accent |
|--------|---------|-----------|--------|
| Heartlands | Warm brown (#8B7355) | Golden tan (#D4A574) | Meadow green (#6B8E4A) |
| Sylvan Reaches | Sea green (#2E8B57) | Yellow-green (#9ACD32) | Sage (#8FBC8F) |
| Iron Depths | Dim gray (#696969) | Copper (#B87333) | Forge fire (#FF6347) |
| Shadowmere | Indigo (#4B0082) | Dark red (#8B0000) | Silver (#C0C0C0) |
| Bloodplains | Dark red (#8B0000) | Sienna (#A0522D) | Dark olive (#556B2F) |

## Directory Structure

```
Modia/
├── ai-image-metadata/           # Asset metadata and prompts
│   ├── manifest.json            # Master manifest
│   ├── tiles/                   # Terrain tile metadata
│   │   ├── manifest.json
│   │   ├── forest.json
│   │   ├── cave.json
│   │   ├── mountain.json
│   │   ├── bridge.json
│   │   └── castle.json
│   ├── portraits/               # Character portrait metadata
│   │   ├── manifest.json
│   │   └── combinations.json
│   ├── items/                   # Item sprite metadata
│   │   ├── manifest.json
│   │   ├── weapons.json
│   │   ├── armor.json
│   │   └── consumables.json
│   ├── icons/                   # UI icon metadata
│   │   ├── manifest.json
│   │   ├── actions.json
│   │   ├── status.json
│   │   ├── menu.json
│   │   └── augments.json
│   └── nodes/                   # World map node metadata
│       ├── manifest.json
│       └── locations.json
├── scripts/ai-images/           # Generation scripts
│   ├── lib/
│   │   ├── index.js
│   │   ├── imageUtils.js
│   │   ├── pythonRunner.js
│   │   ├── metadataUtils.js
│   │   └── promptBuilder.js
│   ├── generate-all.js
│   ├── generate-tiles.js
│   ├── generate-portraits.js
│   ├── generate-items.js
│   ├── generate-icons.js
│   ├── generate-nodes.js
│   └── validate-images.js
└── frontend/public/assets/sprites/  # Output directory
    ├── terrain/{biome}/         # Generated tiles
    ├── characters/portraits/    # Generated portraits
    ├── items/{category}/        # Generated item sprites
    ├── icons/{category}/        # Generated icons
    └── nodes/                   # Generated node icons
```

## Inference Modes

The pipeline supports two inference modes:

| Mode | Description | Latency | Requirements |
|------|-------------|---------|--------------|
| **Local ComfyUI** (default) | GGUF-quantized Flux via ComfyUI | ~5-8s/image | NVIDIA GPU 8GB+ VRAM |
| **HuggingFace Space** (`--huggingface`) | Cloud API via gradio_client | ~30s/image | API token |

> **Note:** Local ComfyUI is now the default. Use `--huggingface` flag for cloud API mode.

## Environment Setup

### Local ComfyUI Mode (Recommended)

1. **Clone and set up the image-generator project:**
   ```bash
   cd ~/Projects
   git clone <image-generator-repo>
   cd image-generator
   conda env create -f environment.yml && conda activate image-gen-comfyui
   python scripts/setup_comfyui.py  # Downloads ~21GB of models
   ```

2. **Start the ComfyUI server:**
   ```bash
   python scripts/start_comfyui.py --background
   ```

3. **Set environment variable in `.env`:**
   ```bash
   IMAGE_GENERATOR_ROOT=/path/to/image-generator/modia-generators
   ```

### HuggingFace Space Mode (No Local GPU)

1. **Set environment variables in `.env`:**
   ```bash
   HUGGINGFACE_API_TOKEN=hf_your_token_here
   IMAGE_GENERATOR_ROOT=/path/to/image-generator/modia-generators
   ```

2. **Install Python dependencies:**
   ```bash
   cd ~/Projects/image-generator/modia-generators
   pip install -r requirements.txt
   ```

3. **Use the `--huggingface` flag** with generation commands (see below).

## LoRA Models

The image-generator project supports multiple LoRA models trained on different pixel art styles:

| Model ID | Trigger Word | Style | Recommended For |
|----------|--------------|-------|-----------------|
| `v1` | GRPZA | Flat 2D pixel art | Icons, items (less detail) |
| `v2` | wbgmsst | Isometric/textured | Tiles, terrain, obstacles |
| `modern-pixel` | umempart | Modern pixel art | Stylized contemporary assets |
| `retro-pixel` | Retro Pixel | Classic 8-bit | Retro-themed special assets |

### Selection Priority

The LoRA model is selected with this priority:

1. **CLI Flag:** `--lora v1` overrides all other settings
2. **Asset Metadata:** `loraModel` field in individual asset JSON
3. **Category Default:** From `ai-image-metadata/manifest.json` categoryDefaults

### Category Defaults

The manifest defines sensible defaults per category:

```json
{
  "categoryDefaults": {
    "tiles": "v2",       // Isometric style for terrain
    "portraits": "v1",   // Flat pixel art for faces
    "items": "v1",       // Clean sprites for inventory
    "icons": "v1",       // Simple shapes for UI
    "nodes": "v1",       // Flat style for map icons
    "overlays": "v1"     // Flat overlays
  }
}
```

### Per-Asset Override

Override the category default by adding `loraModel` to any asset:

```json
{
  "key": "boss_portrait",
  "prompt": "menacing demon lord with glowing eyes",
  "loraModel": "v2",
  "generated": false
}
```

### Usage Examples

```bash
# Use category default (tiles use v2)
npm run ai:generate:tiles -- --key grass_0

# Override with CLI flag
npm run ai:generate:tiles -- --key grass_0 --lora v1

# Dry run shows which model will be used
npm run ai:generate:tiles -- --dry-run --key grass_0
# Output: LoRA: v2 (default)
```

## Prompt Templates

### Master Style Prefixes

Each category uses a default LoRA model (see [LoRA Models](#lora-models) section). The most common triggers are:
- **V2 (wbgmsst)**: Used for tiles and terrain (isometric/textured style)
- **V1 (GRPZA)**: Used for icons, items, portraits (flat pixel art style)

**Default Style (V2 LoRA - wbgmsst trigger):**
```
wbgmsst, medieval fantasy illustration, ink and wash technique with watercolor fills,
bold black outlines of medium weight, visible aged parchment texture with slight yellowing,
cozy nostalgic JRPG aesthetic, warm and inviting storybook quality, hand-drawn illustration style,
```

**Isometric Variant (V2 LoRA - wbgmsst trigger):**
```
wbgmsst, isometric fantasy game asset, ink and wash technique with watercolor fills,
bold black outlines of medium weight, visible aged parchment texture, cozy JRPG aesthetic,
top-down 3/4 view, clear silhouette, isolated subject,
```

### Asset-Specific Templates

**Portraits (1024→64/128/256):**
```
{trigger}, {race_traits} {gender_traits} {class_traits} portrait, bust shot from chest up,
character centered, hands not visible, expressive eyes, isolated on plain background, 64x64 game portrait
```

**Terrain Tiles (64×64):**
```
{trigger}, {terrain} floor tile, {biome_modifier}, 64x64 diamond shape game tile
```

**Icons (1024→16-128):**
```
{trigger}, {description}, {category_modifier}, simplified bold design, ink and wash style,
thick black outlines, flat watercolor fills, high contrast silhouette, clean edges, isolated on plain background
```

**Item Sprites (1024→32/64/128):**
```
{trigger}, {description}, fantasy RPG {category} sprite, ink and wash illustration,
bold black outlines, watercolor fills, slight 3D depth, {rarity_glow}, isolated subject, plain neutral background, 32x32 game sprite
```

**World Map Nodes (1024→48-256):**
```
{trigger}, {description}, fantasy map landmark icon, top-down stylized view,
ink and wash illustration, bold black outlines, watercolor fills, {regional_palette},
aged parchment texture, miniature landmark style, clear silhouette, isolated on plain background, 48x48 game icon
```

### Negative Prompt

Used for all generations:
```
photorealistic, 3D render, CGI, anime style, chibi, blurry, low quality,
watermark, signature, text, logo, modern elements, neon colors, oversaturated,
complex backgrounds, multiple subjects, deformed, bad anatomy, extra limbs, messy lines, muddy colors,
holding objects, hands in frame, full body, weapon in hand, action pose, white framing, white border
```

**Note:** The negative prompt includes composition constraints (`holding objects, hands in frame, white framing`) added in Jan 2026 to prevent white background framing and inappropriate composition in portraits.

## NPM Scripts

| Script | Description |
|--------|-------------|
| `npm run ai:generate` | Generate all pending images |
| `npm run ai:generate:tiles` | Generate terrain tiles |
| `npm run ai:generate:portraits` | Generate character portraits |
| `npm run ai:generate:items` | Generate item sprites |
| `npm run ai:generate:icons` | Generate UI icons |
| `npm run ai:generate:nodes` | Generate world map nodes |
| `npm run ai:status` | Quick status check |
| `npm run ai:validate` | Full validation |

### Common Flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Preview without generating |
| `--key <id>` | Generate specific asset by ID |
| `--force` | Regenerate even if file exists |
| `--biome <name>` | Filter tiles by biome (forest, cave, mountain, bridge, castle) |
| `--category <name>` | Filter by category (varies by asset type) |
| `--race <name>` | Filter portraits by race (human, elf, dwarf, vampire, orc) |
| `--gender <name>` | Filter portraits by gender (male, female, other) |
| `--class <name>` | Filter portraits by class (warrior, wizard, monk, chemist) |
| `--huggingface` | Use HuggingFace Space API instead of local ComfyUI |
| `--queue` | Process only assets marked for regeneration (used by admin dashboard) |
| `--lora <model>` | Override LoRA model selection (v1, v2, pixel-dever, 64bit) |
| `--list-models` | List available LoRA models and exit |

> **Note:** The `--local` flag is deprecated. Local ComfyUI is now the default.

### Tile Category Flags

Terrain tiles support three categories via `--category`:

```bash
# Generate floor tiles (default)
npm run ai:generate:tiles -- --biome forest

# Generate wall tiles
npm run ai:generate:tiles -- --category walls

# Generate slope tiles
npm run ai:generate:tiles -- --category slopes
```

| Category | Description | AI Resolution | Output |
|----------|-------------|---------------|--------|
| `floors` | Standard isometric floor tiles | 128x128 | 64x64 (diamond masked) |
| `walls` | Vertical wall segments | 128x32 | 64x16 |
| `slopes` | Elevation transition tiles | 128x160 | 64x80 |

## Post-Processing Pipeline

The pipeline has a two-stage architecture with single responsibility per stage:

- **Python (image-generator)**: Generates 1024x1024, applies semantic processing (rembg background removal, content cropping, square padding), saves processed original
- **Node.js (Modia scripts)**: Reads processed original, generates ALL size variants via ImageMagick Lanczos downscaling

Tiles are exempt from this architecture — they use diamond masking (type-specific processing) and a single 64x64 output size.

### Resolution Standards

| Asset Type | Processed Original | Output Sizes |
|------------|-------------------|--------------|
| **Tiles (floors)** | 128x128 | 64x64 (diamond masked) |
| **Tiles (walls)** | 128x32 | 64x16 |
| **Tiles (slopes)** | 128x160 | 64x80 |
| **Portraits** | 1024x1024 | 64, 128, 256 |
| **Items** | 1024x1024 | 32, 64, 128 |
| **Icons** | 1024x1024 | 16, 24, 32, 48, 64, 128 |
| **Nodes** | 1024x1024 | 48, 64, 96, 128, 256 |
| **Overlays** | 1024x1024 | 32, 48, 64, 128 |

### Diamond Mask (Isometric Tiles)

Floor tiles are automatically processed with a diamond-shaped mask to create proper isometric tiles. The mask clips the square image into a diamond shape for seamless tile rendering on the battle grid.

The diamond mask is applied during post-processing after the AI generates the base image. No manual masking is required.

### Size Variant Generation

Size variants are generated by Node.js scripts using ImageMagick Lanczos downscaling from the 1024x1024 processed original:

1. Python generates 1024x1024 image via Flux LoRA
2. Python applies `process_to_original()`: rembg → crop_to_content → ensure_square
3. Python saves processed original to `{category}/originals/{id}.png`
4. Node.js reads the processed original
5. Node.js generates all size variants via `generateCanonicalSizeVariants()`
6. Variants saved to `{category}/{size}/{id}.png`

All variants are clean downscales from the 1024x1024 source — no upscaling ever occurs.

Output directory structure:
```
assets/{category}/
  originals/{id}.png     # 1024x1024 processed original
  {size}/{id}.png        # Size variants (e.g., 64/castle.png, 96/castle.png)
```

## Adding New Assets

### 1. Add Metadata

Add an entry to the appropriate JSON file in `ai-image-metadata/`:

```json
{
  "id": "forest_mushroom_2",
  "name": "Glowing Mushroom Patch",
  "prompt": "forest floor with bioluminescent glowing mushrooms",
  "variants": 2,
  "seed": 1071,
  "generated": false
}
```

### 2. Generate

```bash
npm run ai:generate:tiles -- --key forest_mushroom_2
```

### 3. Verify

```bash
npm run ai:validate -- --category tiles --verbose
```

## Metadata Schema

### Master Manifest (manifest.json)

```json
{
  "version": "1.0.0",
  "description": "Master manifest for Modia AI-generated image assets",
  "totalAssets": 366,
  "artDirection": {
    "mood": "cozy_nostalgic",
    "technique": "ink_wash",
    "lineWeight": "medium",
    "texture": "aged_parchment"
  },
  "categories": {
    "tiles": { ... },
    "portraits": { ... },
    "items": { ... },
    "icons": { ... },
    "nodes": { ... }
  },
  "regions": { ... },
  "generationSettings": {
    "defaultSeed": 42,
    "defaultTrigger": "wbgmsst",
    "triggerV2": "wbgmsst",
    "triggerV1Legacy": "GRPZA"
  }
}
```

### Asset Entry

```json
{
  "id": "unique_asset_id",
  "name": "Human-readable name",
  "prompt": "Description for AI generation",
  "seed": 12345,
  "variants": 1,
  "generated": false,
  "generatedAt": null
}
```

## Asset Counts

| Category | Count | Notes |
|----------|-------|-------|
| Portraits | 60 | 5 races × 3 genders × 4 base classes |
| Terrain Tiles | ~96 | 8 types × 4 variants × 3 biomes |
| World Map Nodes | 20 | Location landmarks |
| Icons | 80 | Actions, status, menu, augments |
| Item Sprites | 49 | Weapons, armor, consumables |
| **Total** | **~305** | |

## Troubleshooting

### ComfyUI Server Not Running

```
ComfyUI server is not running after 3 connection attempts
```

Start the ComfyUI server:
```bash
cd ~/Projects/image-generator
python scripts/start_comfyui.py --background
```

Check server status:
```bash
python scripts/start_comfyui.py --check
```

### Missing HUGGINGFACE_API_TOKEN (HF Space Mode Only)

```
[ERROR] Missing HUGGINGFACE_API_TOKEN in environment
```

This only applies when using `--huggingface` flag. Add your token to `.env`:
```bash
HUGGINGFACE_API_TOKEN=hf_your_token_here
```

### Python Script Not Found

```
Failed to spawn Python process
```

Verify `IMAGE_GENERATOR_ROOT` points to the correct directory:
```bash
IMAGE_GENERATOR_ROOT=/path/to/image-generator/modia-generators
```

### Rate Limiting

The scripts include a 2-second delay between generations. For large batches, consider:
1. Running overnight
2. Using `--biome` or `--category` to process in smaller batches
3. Checking `npm run ai:status` periodically

### Regenerating Assets

To regenerate an existing asset:
```bash
npm run ai:generate:tiles -- --key forest_grass_1 --force
```

This will regenerate even if the file exists and is marked as generated.

### Using Different LoRA Models

To override the default model for a specific generation:
```bash
npm run ai:generate:tiles -- --key forest_grass_1 --lora v2 --force
```

List available models:
```bash
cd ~/Projects/image-generator
python modia-generators/generate_tile.py --list-models
```

## Metadata Schema Reference

This section documents the JSON schema used across all asset metadata files in `ai-image-metadata/`.

### Required Fields (All Assets)

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (tiles use `key` as alias) |
| `name` | string | Human-readable display name |
| `prompt` | string | AI generation prompt |
| `seed` | integer | Generation seed for reproducibility |
| `generated` | boolean | Whether asset has been generated |

### Conditional Fields

| Field | Type | When Present |
|-------|------|--------------|
| `generatedAt` | ISO timestamp | Only when `generated: true` |
| `loraModel` | string | When overriding category default |
| `needsRegeneration` | boolean | When queued for regeneration |
| `regenerationQueuedAt` | ISO timestamp or null | When regeneration was queued |
| `evaluation` | object | After quality review |
| `generationFailureCount` | integer or null | After failed generation attempts |
| `lastError` | string or null | Error message from last failed generation |

### Evaluation Object Schema

| Field | Type | Description |
|-------|------|-------------|
| `score` | integer (0-10) | Quality rating |
| `issues` | string[] | Issue codes (e.g., `["too_cluttered", "hard_to_read"]`) |
| `regenerate` | boolean | Whether marked for regeneration |

### Category-Specific Fields

#### Tiles

Tiles use `key` instead of `id` and include terrain metadata:

| Field | Type | Description |
|-------|------|-------------|
| `key` | string | Unique identifier (alias for `id`) |
| `terrain` | string | Terrain type (grass, stone, rock, water, lava, cliff, tree, etc.) |
| `variant` | integer | Variant number (0-3 for base tiles) |
| `outputPath` | string | Biome subdirectory for output |
| `bonus` | boolean | Optional flag for bonus/special tiles |

Example:
```json
{
  "key": "grass_0",
  "terrain": "grass",
  "variant": 0,
  "prompt": "lush forest meadow grass with dappled sunlight",
  "outputPath": "forest",
  "generated": true,
  "generatedAt": "2026-01-25T19:54:17.684Z"
}
```

#### Portraits

Portraits include character trait references:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Format: `{race}_{gender}_{class}` |
| `race` | string | human, elf, dwarf, vampire, orc |
| `gender` | string | male, female, other |
| `class` | string | Base or advanced class name |
| `_type` | string | Optional: `"enemy"` for enemy portraits |

Example:
```json
{
  "id": "human_male_warrior",
  "race": "human",
  "gender": "male",
  "class": "warrior",
  "seed": 10001,
  "generated": true,
  "loraModel": "retro-pixel",
  "generatedAt": "2026-01-27T19:52:03.258Z"
}
```

#### Nodes (World Map)

Nodes use the standard `id` field with evaluation data:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Node type identifier |
| `name` | string | Human-readable location name |

Example:
```json
{
  "id": "castle",
  "name": "Castle",
  "prompt": "castle fortress towers battlements medieval stronghold",
  "seed": 40001,
  "generated": true,
  "evaluation": { "score": 8, "issues": [], "regenerate": false },
  "loraModel": "retro-pixel",
  "generatedAt": "2026-01-27T20:49:34.825Z"
}
```

#### Icons

Icons include category context:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Format: `{category}_{action}` (e.g., `action_attack`) |
| `name` | string | Human-readable action name |

Example:
```json
{
  "id": "action_attack",
  "name": "Attack",
  "prompt": "crossed swords attack action combat strike",
  "seed": 30001,
  "generated": true,
  "loraModel": "retro-pixel",
  "generatedAt": "2026-01-29T07:44:23.416Z"
}
```

#### Items

Items include category information:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Item identifier (e.g., `sword_short`) |
| `name` | string | Human-readable item name |
| `_itemCategory` | string | Optional: weapon, armor, accessory, consumable |

Example:
```json
{
  "id": "sword_short",
  "name": "Short Sword",
  "prompt": "short sword simple blade leather grip compact",
  "seed": 20001,
  "generated": true,
  "loraModel": "v2",
  "generatedAt": "2026-01-26T14:16:47.202Z"
}
```

#### Overlays

Overlays include blending metadata:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Format: `{type}_{name}` (e.g., `rarity_epic`, `augment_fire`) |
| `rarity` | string | For rarity overlays: uncommon, rare, epic, legendary |
| `element` | string | For elemental augments: fire, ice, lightning, poison, holy, dark, earth, wind |
| `effect` | string | For effect augments: critical, lifesteal, speed, pierce, stun, chain |
| `alpha` | number | Blend opacity (0.0-1.0) |

Example:
```json
{
  "id": "augment_fire",
  "name": "Fire Augment",
  "element": "fire",
  "alpha": 0.6,
  "prompt": "orange red flames dancing around edges flickering fire particles",
  "seed": 25001,
  "generated": false
}
```

**Note on Overlay Status:** Overlays (18 total: 4 rarity + 14 augments) are defined for future AI generation but currently all have `generated: false`. The game uses CSS/procedural rendering for rarity and augment effects. See the Overlays section in [ASSET_SYSTEM_INDEX.md](ASSET_SYSTEM_INDEX.md) for current implementation details.

### File-Level Metadata

Each category JSON file includes top-level metadata:

```json
{
  "version": "1.0.0",
  "category": "actions",
  "description": "Battle action icons",
  "size": "32x32",
  "icons": [...]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `version` | string | Schema version |
| `category` | string | Asset category name |
| `subcategory` | string | Optional: subcategory (e.g., "rarity", "augments") |
| `description` | string | Human-readable description |
| `size` | string | Target output size (e.g., "32x32", "128x128") |
| `biome` | string | For tiles: biome name |
| `palette` | object | For tiles: color palette with primary, secondary, accent |
| `outputPath` | string | For tiles: output subdirectory |
| `blendMode` | string | For overlays: CSS blend mode (e.g., "lighter") |

---

## Quality Evaluation System

### Overview

Assets include an `evaluation` field for tracking quality scores and issues:

```json
{
  "id": "node_cave",
  "prompt": "cave entrance with visible rocky archway, warm torch glow inside, stone frame",
  "seed": 40005,
  "generated": false,
  "evaluation": {
    "score": 5,
    "issues": ["too_dark"],
    "regenerate": true
  }
}
```

### Evaluation Criteria

| Criterion | Weight | Description |
|-----------|--------|-------------|
| Resemblance | 25% | Does the image resemble the intended subject? |
| Style Consistency | 20% | Is the style consistent with other images? |
| Alpha Handling | 20% | Is the background properly isolated without white framing? |
| Composition | 20% | Is the composition appropriate for the asset type? |
| Clarity | 15% | Is the image clear at the target display size? |

### Score Thresholds

| Score | Status |
|-------|--------|
| 8-10 | Excellent - no action needed |
| 6-7 | Passing - acceptable quality |
| < 6 | Needs Regeneration - marked with `regenerate: true` |

### Common Issues

| Issue Code | Description | Fix |
|------------|-------------|-----|
| `too_dark` | Image is too dark to read | Add brightness guidance ("warm glow", "bright") to prompt |
| `too_cluttered` | Too many visual elements | Simplify prompt to single focal point |
| `unclear_meaning` | Abstract, unclear subject | Use concrete objects instead of concepts |
| `white_framing` | White background visible as border | Fixed in promptBuilder.js (Jan 2026) |
| `hands_in_frame` | Inappropriate hands/objects visible | Added to negative prompt (Jan 2026) |
| `full_body_rather_than_bust` | Shows more than head/shoulders | Emphasize "bust shot, chest up" in prompt |

### Evaluation Report

Generated at `ai-image-metadata/evaluation-report.json`:

```json
{
  "summary": {
    "totalEvaluated": 36,
    "passing": 30,
    "needsRegeneration": 6,
    "averageScore": 6.9
  },
  "regenerationQueue": [
    { "id": "node_discovery", "score": 3, "issues": [...], "priority": "high" }
  ],
  "regenerationCommands": [
    "npm run ai:generate:nodes -- --key node_discovery --force"
  ]
}
```

### Prompt Writing Best Practices

**DO:**
- Use single focal point ("three tall pine trees" not "dense forest")
- Include brightness guidance for dark subjects ("warm torch glow inside")
- Describe concrete objects, not abstract concepts
- Keep prompts concise (5-10 key descriptors)

**DON'T:**
- Use multiple comma-separated scene descriptions
- Say "dark" without brightness guidance
- Rely on abstract concepts ("mysterious", "secret")
- Include action verbs for static assets

### Regeneration Workflow

**Single asset:**
1. Regenerate: `npm run ai:generate:nodes -- --key <id> --force`
2. Re-evaluate and update score in metadata file

**Batch via admin dashboard:**
1. Mark assets for regeneration in the admin dashboard (sets `needsRegeneration: true`)
2. Click "Generate All" in the Queue panel, or run: `npm run ai:generate:tiles -- --queue`
3. The `--queue` flag processes only marked assets and clears their regeneration markers on success
4. All generator scripts support `--queue`: tiles, portraits, items, icons, nodes
