# AI Image Generation Pipeline

This document describes Modia's hybrid image-asset pipeline. Portraits and selected source art may use local or hosted generative models; canonical player references, player animation strips, battle terrain, abilities, and runtime item completions use deterministic compilers with explicit validation contracts.

> **Terrain boundary:** Battle floor, wall, and slope tiles moved to the deterministic `iso64-retina-v3` material compiler. They do not use ComfyUI, HuggingFace, LoRA, or AI post-processing; metadata prompt text is only a deterministic material hint. See [ISOMETRIC_TILE_SYSTEM.md](ISOMETRIC_TILE_SYSTEM.md). The old AI tile workflow is historical; `ai:generate:tiles` remains only as a compatibility alias to the deterministic compiler.

> **Player-character boundary:** Canonical race/gender/class references and temporal battle strips are deterministic outputs. Local diffusion may stage a full-body reference candidate, but it cannot publish that candidate without an explicit target ID, manual semantic review, and targeted promotion. See [Canonical Player Character Pipeline](#canonical-player-character-pipeline).

## Overview

The AI image generation pipeline integrates with the external `image-generator` project to create:
- **Character portraits** - Bust shots for all race/gender/class combinations
- **Player reference candidates** - Optional local-diffusion candidates staged outside runtime paths for manual review
- **Item sprites** - Equipment and consumable icons
- **UI icons** - Action, status, menu, and augment icons
- **World map nodes** - Landmark icons for the overworld

The repository-owned deterministic compilers then create canonical full-body player references and eight-frame animation strips. These canonical steps do not require a diffusion backend.

## Quick Start

```bash
# Check current generation status
npm run ai:status

# Preview what would be generated (dry run)
npm run ai:generate:portraits -- --dry-run

# Generate a single asset
npm run ai:generate:icons -- --key attack --force

# Generate an AI category
npm run ai:generate:portraits -- --race elf

# Generate everything (the tile category is compiled deterministically)
npm run ai:generate

# Compile battle tiles directly
npm run tiles:generate -- --biome forest --dry-run

# Compile and validate all missing canonical player references (explicit --all is embedded in this named script)
npm run ai:compile:player-identities
npm run ai:check:player-identities

# Compile and validate deterministic eight-frame player animation strips
npm run ai:compile:player-animations
npm run ai:check:player-animations
```

## Art Direction

The visual style is **Cozy & Nostalgic** with **Ink & Wash Technique**:

| Aspect | Choice |
|--------|--------|
| **Mood** | Cozy, warm, inviting storybook/classic JRPG |
| **Technique** | Ink & wash (bold black outlines + watercolor fills) |
| **Line Weight** | Medium outlines (balanced visibility at all sizes) |
| **Texture** | Visible aged parchment with slight yellowing |

## Canonical Player Character Pipeline

Canonical player art uses the identity tuple `{race}_{gender}_{class}` from `ai-image-metadata/characters/player-variants.json`. The accepted production flow is deterministic:

1. Treat `/assets/portraits/originals/{id}.png` as the identity and class-cue source.
2. Compile a 64×64 full-body pixel source, then upscale it exactly 8× with nearest-neighbor resampling to a lossless 512×512 RGBA canonical reference.
3. Compile each canonical reference into an eight-frame, 64×512 lossless WebP temporal strip.
4. Run the player identity, animation, and runtime validators. Existing valid canonical art is preserved unless a targeted `--force` is explicit.

The canonical reference path is:

```text
/assets/characters/player/{race}/{gender}/{class}/{id}_reference.png
```

The animation path is:

```text
/assets/characters/player/{race}/{gender}/{class}/{id}_{animation}.webp
```

### Deterministic reference compiler

`scripts/ai-images/compile-player-identity-fallbacks.js` derives the head, upper-costume detail, palette, and class gear from the canonical portrait. Deterministic race/gender proportions and one of 20 class signatures complete a single padded, head-to-toe subject. Provenance, portrait/anchor hashes, 64px source hashes, and encoded output hashes live in `ai-image-metadata/characters/player-identity-fallbacks.json`.

The compiler requires exactly one scope. There is no implicit batch:

```bash
# One preferred missing sample
node scripts/ai-images/compile-player-identity-fallbacks.js --sample

# One explicit identity
node scripts/ai-images/compile-player-identity-fallbacks.js --id elf_female_wizard

# Full registry; --all is the required bulk safety gate
npm run ai:compile:player-identities

# Read-only full-registry contract/provenance check
npm run ai:check:player-identities

# Semantic, determinism, anchor, atomic-write, and all-300 uniqueness tests
npm run ai:test:player-identities
```

`--force` may replace only the selected scope. Without it, every existing canonical reference—including accepted golden or manually promoted art—is preserved.

### Corrected dwarf identity anchors

Two portrait cohorts contradict their registry gender metadata. The compiler uses corrected anchors for face/body presentation while still deriving each class palette, costume cues, and gear from that identity's portrait.

| Cohort | Corrected anchor | SHA-256 | Override reason |
|---|---|---|---|
| `dwarf_female_*` | `ai-image-metadata/characters/reference-anchors/dwarf_female_neutral.png` | `270e0d901825504bad05d24167b4da55390a5bcc47a204140f8c07c0abec2dc4` | The source portrait cohort is strongly male-coded; the anchor supplies the approved feminine face and full-body silhouette. |
| `dwarf_other_*` | `ai-image-metadata/characters/reference-anchors/dwarf_other_neutral.png` | `3a93e0c22a2773be423ce1b5c78f818ff83f5763900b42249f0f07c2057a3e6f` | The source portrait cohort is strongly male-coded; the anchor supplies the approved androgynous face and full-body silhouette. |

These are narrow identity overrides, not substitute class designs. The exact reasons and hashes are also machine-readable in `ai-image-metadata/characters/visual-style-profile.json` and the fallback provenance file.

### Deterministic temporal-strip compiler

`scripts/ai-images/compile-player-animations.js` converts the canonical full-body reference into genuine temporal motion for `idle`, `walk`, `attack`, `hurt`, `death`, `dead`, and class-declared `cast`/`victory` actions. It uses deterministic pose transforms, lower-body stride segmentation, action effects, and per-identity effect palettes; the eight rows are animation frames, not facing directions.

```bash
# One identity/action sample
node scripts/ai-images/compile-player-animations.js --id dwarf_female_chemist --animation idle

# Full declared matrix; package command supplies the explicit --all gate
npm run ai:compile:player-animations

# Validate geometry, lossless alpha, temporal motion, uniqueness, and metadata parity
npm run ai:check:player-animations
npm run ai:test:player-animations
```

The compiler stages and validates outputs before atomic writes, preserves valid strips unless `--force`, and refuses to overwrite concurrently changed player-variant metadata.

### Diffusion candidates and targeted promotion

Local SD1.5/ControlNet/IP-Adapter generation is an optional candidate path, not the canonical completion path. `ai:generate:identity-references` writes technically valid candidates under `ai-images-temp/characters/identity-candidates/`; generation does not publish them to `/assets/characters/player/`.

```bash
# Stage one candidate outside canonical runtime paths
npm run ai:generate:identity-references -- --id elf_female_wizard

# After manual review, promote only this explicit ID into a missing canonical path
npm run ai:generate:identity-references -- --id elf_female_wizard --promote

# Replacing an existing canonical additionally requires --force
npm run ai:generate:identity-references -- --id elf_female_wizard --promote --force
```

`--promote` is rejected unless at least one `--id` is present. There is intentionally no bulk promotion command. Automatic checks cover dimensions, RGBA/alpha, foreground coverage, backdrop-like rows, and dominant connected subject; they cannot approve semantics. Before promotion, a human must verify:

- portrait identity and race/gender/class presentation;
- one complete head-to-toe subject with readable feet and margins;
- portrait-faithful palette and costume with the intended class signature;
- exactly one of each weapon, staff, shield, vial, or other class prop;
- no duplicate face, extra anatomy, scenery, floor, circular backdrop, shadow, matte fringe, text, or watermark.

Failed technical candidates are moved to `ai-images-temp/rejected/identity-references/`. Diffusion animation experiments are likewise non-canonical; the supported production animation bulk path is the deterministic temporal-strip compiler.

### Preserved golden baseline

`human_male_warrior_reference.png` remains the accepted OpenAI built-in image-generation baseline (SHA-256 `3ad9972a646e70f21331c495dd9f0b4774531d1e124b602c427c278a199ac3c9`). Its accepted `idle` strip remains the golden motion gate (SHA-256 `a8c76dfccee3de3840d6ad1899268caff0f1ee9ce28499d6b6edcb7029c1d6be`). Bulk deterministic compilers skip both while valid; a replacement requires targeted `--force`, a new manual semantic audit, and updated hashes in the visual style profile.

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
│   ├── characters/              # Canonical identity/animation contracts
│   │   ├── player-variants.json
│   │   ├── player-identity-fallbacks.json
│   │   ├── visual-style-profile.json
│   │   └── reference-anchors/
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
│   │   ├── augments.json
│   │   └── resources.json
│   └── nodes/                   # World map node metadata
│       ├── manifest.json
│       └── locations.json
├── scripts/ai-images/           # Generation scripts
│   ├── lib/
│   │   ├── index.js
│   │   ├── imageUtils.js
│   │   ├── pythonRunner.js
│   │   ├── metadataUtils.js
│   │   ├── playerIdentityFallbackCompiler.js
│   │   ├── playerAnimationCompiler.js
│   │   └── promptBuilder.js
│   ├── compile-player-identity-fallbacks.js
│   ├── compile-player-animations.js
│   ├── generate-player-identity-references.js
│   ├── generate-all.js
│   ├── generate-portraits.js
│   ├── generate-items.js
│   ├── generate-icons.js
│   ├── generate-nodes.js
│   └── validate-images.js
├── scripts/tiles/               # Deterministic battle-terrain compiler
│   ├── generate-isometric-tiles.js
│   ├── isometricCompiler.js
│   └── validate-isometric-tiles.js
└── frontend/public/assets/      # Output directory
    ├── sprites/terrain/{biome}/ # Deterministically compiled tiles
    ├── portraits/               # Generated portraits
    ├── items/                   # Generated item sprites
    ├── icons/                   # Generated icons
    ├── nodes/                   # Generated node icons
    └── characters/player/       # Canonical references and temporal strips
```

## Generative Source Inference Modes

Generative source tools support the following backends. The canonical player-reference and animation compilers use none of them.

| Mode | Description | Latency | Requirements |
|------|-------------|---------|--------------|
| **Local ComfyUI** (default) | GGUF-quantized Flux via ComfyUI | ~5-8s/image | NVIDIA GPU 8GB+ VRAM |
| **Local SD1.5 candidate** | ControlNet and IP-Adapter full-body candidate staging via ComfyUI | ~5-8s/image | NVIDIA GPU 8GB+ VRAM and local SD1.5 models |
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
| `v2` | wbgmsst | Isometric/textured | Obstacles and other isolated assets |
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
# Use an asset's category default
npm run ai:generate:icons -- --key attack

# Override with CLI flag
npm run ai:generate:icons -- --key attack --lora v1

# Dry run shows which model will be used
npm run ai:generate:icons -- --dry-run --key attack
```

## Prompt Templates

### Master Style Prefixes

Each category uses a default LoRA model (see [LoRA Models](#lora-models) section). The most common triggers are:
- **V2 (wbgmsst)**: Used for textured isolated assets such as obstacles
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

**Terrain tiles:**

Terrain is not generated from a LoRA prompt. The deterministic compiler produces
lossless 128×128 retina floor/slope sources and 128×32 wall strips from metadata.
See [ISOMETRIC_TILE_SYSTEM.md](ISOMETRIC_TILE_SYSTEM.md) for the active contract.

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
| `npm run ai:generate` | Generate all pending categories; tile jobs use the deterministic compiler |
| `npm run tiles:generate` | Compile deterministic terrain tiles |
| `npm run tiles:check` | Test and strictly validate the tile contract |
| `npm run ai:generate:portraits` | Generate character portraits |
| `npm run ai:generate:identity-references -- --id <id>` | Stage a local-diffusion full-body candidate; does not publish canonical art |
| `npm run ai:compile:player-identities` | Deterministically compile all missing canonical player references (`--all` is embedded) |
| `npm run ai:check:player-identities` | Read-only full-registry reference/provenance check |
| `npm run ai:test:player-identities` | Test identity semantics, determinism, anchors, safety, and all-300 uniqueness |
| `npm run ai:compile:player-animations` | Deterministically compile the full declared animation matrix (`--all` is embedded) |
| `npm run ai:check:player-animations` | Read-only full-matrix strip and metadata check |
| `npm run ai:test:player-animations` | Test temporal motion, encoding, preservation, and atomic writes |
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
| `--id <identity>` | Select an explicit player identity for reference, animation, or promotion work |
| `--sample` | Select one bounded compiler sample; never implies the full registry |
| `--all` | Explicit bulk safety gate required by both deterministic player compilers |
| `--check` | Validate the selected canonical scope without writing |
| `--promote` | Promote only explicitly named, manually approved diffusion reference candidates |
| `--force` | Regenerate even if file exists |
| `--biome <name>` | Filter tiles by biome (forest, cave, mountain, bridge, castle) |
| `--category <name>` | Filter by category (varies by asset type) |
| `--race <name>` | Filter portraits by race (human, elf, dwarf, vampire, orc) |
| `--gender <name>` | Filter portraits by gender (male, female, other) |
| `--class <name>` | Filter portraits by class (warrior, wizard, monk, chemist) |
| `--huggingface` | Use HuggingFace Space API instead of local ComfyUI (AI categories only) |
| `--queue` | Process only assets marked for regeneration (used by admin dashboard) |
| `--lora <model>` | Override LoRA model selection (AI categories only) |
| `--list-models` | List available LoRA models and exit |

> **Note:** The `--local` flag is deprecated. Local ComfyUI is now the default.

For player compilers, `--force` never broadens scope: the command still requires `--id`, `--sample`, or `--all`. For diffusion promotion, `--promote` requires an explicit `--id`; replacing an existing canonical also requires `--force`.

### Deterministic terrain exception

Tiles accept `--biome`, `--category`, repeatable `--key`, `--queue`, `--force`, `--backup`, `--update-metadata`, `--prune`, and `--dry-run`. They reject AI backend and LoRA flags. Their 128px source geometry and 64x32 logical footprint are documented in [ISOMETRIC_TILE_SYSTEM.md](ISOMETRIC_TILE_SYSTEM.md).

## Post-Processing Pipeline

For portrait, item, icon, node, and overlay categories, the generative pipeline has a two-stage architecture with single responsibility per stage:

- **Python (image-generator)**: Generates 1024x1024, applies semantic processing (rembg background removal, content cropping, square padding), saves processed original
- **Node.js (Modia scripts)**: Reads processed original, generates ALL size variants via ImageMagick Lanczos downscaling

Tiles and canonical player characters are outside this architecture. Tiles compile directly from material metadata. Player references compile a deterministic 64×64 portrait-derived full body and encode an exact nearest-neighbor 512×512 canonical PNG; player animations compile eight deterministic 64×64 temporal frames into a 64×512 lossless WebP.

### Resolution Standards

| Asset Type | Processed Original | Output Sizes |
|------------|-------------------|--------------|
| **Portraits** | 1024x1024 | 64, 128, 256 |
| **Items** | 1024x1024 | 32, 64, 128 |
| **Icons** | 1024x1024 | 16, 24, 32, 48, 64, 128 |
| **Nodes** | 1024x1024 | 48, 64, 96, 128, 256 |
| **Overlays** | 1024x1024 | 32, 48, 64, 128 |
| **Canonical Player Reference** | Deterministic 64x64 pixel source | 512x512 lossless RGBA PNG (nearest-neighbor 8x) |
| **Player Animation** | Canonical full-body reference | 64x512 lossless RGBA WebP (8 temporal frames) |

### Size Variant Generation

Size variants are generated by Node.js scripts using ImageMagick Lanczos downscaling from the 1024x1024 processed original:

1. Python generates 1024x1024 image via Flux LoRA
2. Python applies `process_to_original()`: rembg → crop_to_content → ensure_square
3. Python saves processed original to `{category}/originals/{id}.png`
4. Node.js reads the processed original
5. Node.js generates all size variants via `generateCanonicalSizeVariants()`
6. Variants saved to `{category}/{size}/{id}.png`

All legacy size variants in this subsection are clean downscales from their 1024x1024 source. The canonical player-reference compiler is the deliberate exception: it authors at the runtime pixel grid (64×64) and performs an exact nearest-neighbor 8× encode so the 512×512 PNG preserves the authored pixel topology without invented detail.

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
  "id": "ancient_observatory",
  "name": "Ancient Observatory",
  "prompt": "weathered fantasy observatory landmark",
  "seed": 1071,
  "generated": false
}
```

### 2. Generate

```bash
npm run ai:generate:nodes -- --key ancient_observatory
```

### 3. Verify

```bash
npm run ai:validate:images -- --category nodes --verbose
```

## Adding New Asset Categories

When adding an entirely new category (e.g., zodiac icons) or subcategory, follow this complete checklist. Missing any step will cause generation or display failures.

### Checklist

> **See also:** [Metadata Schema](#metadata-schema) section below for detailed manifest structure.

#### Metadata Layer
1. **Create category JSON file**: `ai-image-metadata/{category}/{subcategory}.json`
   - Include version, category name, description, styleGuide
   - Define each asset with id, prompt, seed, generated flag

2. **Update category manifest**: `ai-image-metadata/{category}/manifest.json`
   - Add new file to `categoryFiles` array
   - Update `totalAssets` count

3. **Update master manifest**: `ai-image-metadata/manifest.json`
   - Add new category file to file list
   - Update `assetCount` total

#### Generation Script Layer
4. **Update output directory list** in `scripts/ai-images/generate-{category}.js`
   - Find the hardcoded category array for directory creation
   - Add your new subcategory name

5. **Verify metadata loading** works for new category:
   ```bash
   node scripts/ai-images/generate-{category}.js --category {subcategory} --dry-run
   ```

#### Path Configuration Layer
6. **Verify SIZE_PRESETS** in `shared/assetPaths.js` includes your category
   - Add new category if top-level (e.g., new asset type)
   - Subcategories use parent category's size presets
   ```javascript
   // Example structure in shared/assetPaths.js:
   SIZE_PRESETS = {
     icons: [16, 24, 32, 48, 64, 128, 256],  // Zodiac uses this (subcategory of icons)
     items: [32, 64, 128],
     // Add here for new top-level categories
   }
   ```

#### Admin Dashboard Layer
7. **Subcategory filter** appears automatically if metadata is correct
   - The admin loads categories from metadata files
   - Verify filter works in Icons/Items page

#### Frontend Layer
8. **AssetLoader** typically handles new subcategories automatically
   - Uses canonical paths from `@shared/assetPaths.js`
   - Test loading in game context

### Example: Adding Zodiac Icons

```bash
# 1. Create metadata file
# ai-image-metadata/icons/zodiac.json with 12 zodiac sign icons

# 2. Update icons manifest
# Add "zodiac.json" to categoryFiles in ai-image-metadata/icons/manifest.json

# 3. Update master manifest
# Add "icons/zodiac.json" to ai-image-metadata/manifest.json

# 4. Add to generation script output dirs
# Add 'zodiac' to output directory array in generate-icons.js (search for "ensureDirectoryExists")

# 5. Generate icons
npm run ai:generate:icons -- --category zodiac

# 6. Verify in admin dashboard
npm run dev:admin
# Navigate to Icons > filter by zodiac
```

### Common Pitfalls

| Issue | Cause | Fix |
|-------|-------|-----|
| 404 in admin panel | Missing from output dir list | Add to generation script category array |
| Icon shows wrong name | ID normalization mismatch | Check if ID includes category prefix |
| Missing size variant | Size not in SIZE_PRESETS | Add size to appropriate preset array |
| Filter not showing | Manifest not updated | Update categoryFiles in manifest |

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
| Terrain Tiles | 281 | Deterministic floors, walls, and slopes across biomes |
| Item Sprites | 133 | Weapons, armor, consumables, accessories |
| Icons | 143 | Actions, status, menu, augments, resources, zodiac |
| Portraits | 316 | Race, gender, class, and advanced-class combinations |
| World Map Nodes | 26 | Location landmarks |
| Overlays | 22 | Rarity auras and augment effects |
| Obstacles | 10 | Runtime rocks and trees |
| Characters | 54 | Player and enemy sprite definitions |
| **Total** | **985** | |

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
2. Using category-specific filters to process smaller batches
3. Checking `npm run ai:status` periodically

### Regenerating Assets

To regenerate an existing asset:
```bash
npm run ai:generate:icons -- --key attack --force
```

This will regenerate even if the file exists and is marked as generated.

### Using Different LoRA Models

To override the default model for a specific generation:
```bash
npm run ai:generate:icons -- --key attack --lora v2 --force
```

List available models:
```bash
npm run ai:generate:icons -- --list-models
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

Tiles use `key` instead of `id` and include compiler metadata. Legacy prompt, seed, and LoRA fields may remain for provenance but do not select an AI backend:

| Field | Type | Description |
|-------|------|-------------|
| `key` | string | Unique identifier (alias for `id`) |
| `terrain` | string | Terrain type (grass, stone, rock, water, lava, cliff, tree, etc.) |
| `variant` | integer | Variant number (0-3 for base tiles) |
| `direction` | string | North, south, east, or west for slopes and stairs |
| `levels` | integer | Elevation span represented by a slope or stairs asset |

Example:
```json
{
  "key": "grass_0",
  "terrain": "grass",
  "variant": 0,
  "prompt": "lush forest meadow grass with dappled sunlight",
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

Icons use unprefixed IDs (matching the filename without extension):

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unprefixed action name (e.g., `attack`, `defend`, `poison`) |
| `name` | string | Human-readable action name |

Example:
```json
{
  "id": "attack",
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

**Note on Overlay Status:** All 22 overlays (4 rarity + 18 augments) are generated. The game can also use CSS/procedural rendering for compatible rarity and augment effects. See the Overlays section in [ASSET_SYSTEM_INDEX.md](ASSET_SYSTEM_INDEX.md) for current implementation details.

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
2. Click "Generate All" in the Queue panel. For tiles, the CLI equivalent is `npm run tiles:generate -- --queue`.
3. The `--queue` flag processes only marked assets and clears their regeneration markers on success
4. Tile queue jobs use the deterministic compiler; the remaining categories use their category generator.
