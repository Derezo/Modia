# Isometric Tile System

Modia's legacy/V2 battle terrain uses a deterministic material compiler, not
an image-generation model. The compiler turns canonical tile metadata into one
lossless WebP set whose projection, alpha, palette, and edges agree with the
renderer. Battle Map V3 regional art is a separate reviewed-source lifecycle
with the same `iso64-retina-v3` geometry; see
[BATTLE_MAP_V3_ART_LIFECYCLE.md](BATTLE_MAP_V3_ART_LIFECYCLE.md).

The source of truth is split deliberately:

- `ai-image-metadata/tiles/manifest.json` defines the versioned geometry and metadata files.
- `ai-image-metadata/tiles/{floors,walls,slopes}/{biome}.json` defines the assets.
- `scripts/tiles/isometricCompiler.js` implements the material and geometry contract.
- `scripts/tiles/generate-isometric-tiles.js` is the CLI used locally and by the admin queue.
- `scripts/tiles/validate-isometric-tiles.js` validates metadata, files, alpha geometry, and shared edges.

## Geometry contract

The current profile is `iso64-retina-v3`.

| Asset | Source image | Logical render box | Visible footprint |
|---|---:|---:|---:|
| Floor | 128x128 | 64x64 | 64x32 diamond |
| Slope or stairs | 128x128 | 64x64 | 64x32 diamond |
| Wall material | 128x32 | 64x16 | renderer-mapped exposed face |

Floor and slope footprints use an exact 2:1 diamond projection with a center anchor. Sources are authored at 2x resolution and rendered at logical size. Floor and slope alpha is straight and antialiased; wall sources are opaque material strips. Files are lossless WebP.

Variants of the same terrain share their boundary pixels. Detail is kept inside the footprint, so adjacent diamonds do not produce outlines or incompatible seams. Do not add borders, shadows, opaque corners, or a second projection transform to generated files.

## Paths and identity

All categories use a flat path inside each biome:

```text
frontend/public/assets/sprites/terrain/{biome}/{key}.webp
```

Examples:

```text
forest/grass_0.webp
cave/wall_cave_stone.webp
mountain/slope_mountain_north_1.webp
```

A tile's canonical identity is the tuple `(tileCategory, biome, key)`. Admin transport also retains the global `tiles` category and source metadata file. A key can occur in more than one biome, so tools and selections must preserve that full scope even though the runtime path is flat.

Supported biomes are `forest`, `cave`, `mountain`, `bridge`, and `castle`. Runtime node types map to one of those biomes; `forest` is the fallback rather than a separate `base` asset set.

## Local workflow

Preview before writing:

```bash
npm run tiles:generate -- --dry-run --biome forest --category floors
```

Compile missing assets, or target one contextual key:

```bash
npm run tiles:generate
npm run tiles:generate -- --biome cave --category floors --key grass_0 --force
```

Rebuild the complete canonical set and remove legacy or unexpected terrain images:

```bash
npm run tiles:rebuild
```

`--prune` is intentionally accepted only for an unfiltered full compile. It fails closed unless every manifest document and canonical WebP validates, so incomplete metadata cannot erase healthy terrain. Use `--backup` before replacing reviewed assets when a recoverable snapshot is useful. Backups retain the canonical WebPs, not obsolete PNG paths. Use `--update-metadata` when generated timestamps should be persisted; aggregate `npm run ai:generate` does this automatically, while an ordinary full local build leaves metadata timestamps stable.

Run the complete compiler and live-asset check:

```bash
npm run tiles:check
```

Focused checks are also available:

```bash
npm run tiles:test
npm run tiles:validate:metadata
npm run tiles:validate -- --strict
```

Strict validation rejects unexpected legacy images as well as missing, malformed, dimensionally incorrect, or edge-incompatible assets. Run it after changing the compiler, manifest, palette logic, or tile metadata.

## Admin workflow

The admin Tiles view and Settings > Generation use the same deterministic compiler. Tile jobs support selection by biome, category, or key plus force, dry-run, backup, metadata update, and verbose output. Queue jobs compile entries marked `needsRegeneration` and clear their markers after success.

AI backend, LoRA, request delay, and AI variant controls do not apply to terrain compilation. Existing metadata prompt and seed fields are deterministic material inputs, not AI-generation settings. AI controls remain available for portraits, items, icons, nodes, obstacles, and other AI-generated categories.

## Renderer responsibilities

The renderer owns map projection, elevation placement, visible wall-face selection, painter ordering, zoom, and hit testing. It draws the 128px sources into the logical boxes above; it must not infer dimensions from the decoded bitmap. Terrain, props, and units share one depth queue so a unit is above its floor and below foreground rows. A procedural underlay is allowed as crack protection, but generated assets remain the visible material layer.

When changing this system, update the manifest and compiler together, regenerate the full set, then run `npm run tiles:check` and the frontend battle-grid tests.
