# AI Image Generation Improvements - Implementation Plan

## Summary

Overhaul the AI image generation system to fix tile quality issues, standardize resolutions, and simplify the CLI interface.

## Key Decisions Made

| Decision | Choice |
|----------|--------|
| Tile geometry | Both prompt improvement AND post-processing diamond mask |
| Tile regeneration | All ~300 tiles |
| LoRA for tiles | Stick with V2 "wbgmsst" |
| Size variants flag | **Remove entirely** - use hard-coded post-processing per asset type |
| Base resolution | 256x256 for portraits/nodes, 128x128 for tiles/items/icons |
| Tile pipeline | Standard Flux + V2 LoRA (not tilemapgen depth2img) |

## Post-Processing Size Matrix

| Asset Type | AI Resolution | Output Sizes |
|------------|---------------|--------------|
| **Tiles** | 128x128 | 64x64 (diamond masked) |
| **Portraits** | 256x256 | 64x64, 128x128, 256x256 |
| **Items** | 128x128 | 32x32, 64x64, 128x128 |
| **Icons** | 128x128 | 16x16, 24x24, 32x32, 48x48, 64x64, 128x128 |
| **Nodes** | 256x256 | 48x48, 96x96 |
| **Walls** | 128x32 | 64x16 |
| **Slopes** | 128x160 | 64x80 |

---

## Implementation Steps

### Phase 1: Script Infrastructure Changes

#### 1.1 Remove `--sizes` flag from all generators

**Files to modify:**
- `scripts/ai-images/generate-tiles.js`
- `scripts/ai-images/generate-portraits.js`
- `scripts/ai-images/generate-items.js`
- `scripts/ai-images/generate-icons.js`
- `scripts/ai-images/generate-nodes.js`
- `scripts/ai-images/lib/index.js` (exports)

**Changes:**
- Remove `--sizes` CLI option parsing
- Remove `generate-sizes.js` or repurpose as internal utility
- Update help text in all scripts

#### 1.2 Add asset-specific post-processing

**File:** `scripts/ai-images/lib/resizeUtils.js`

Add functions:
```javascript
function postProcessTile(imagePath) {
  // 1. Resize from 128x128 to 64x64
  // 2. Apply diamond mask
  // 3. Save
}

function postProcessPortrait(imagePath) {
  // Generate 64, 128, 256 variants
}

function postProcessItem(imagePath) {
  // Generate 32, 64, 128 variants
}

function postProcessIcon(imagePath) {
  // Generate 16, 24, 32, 48, 64, 128 variants
}

function postProcessNode(imagePath) {
  // Generate 48, 96 variants
}
```

#### 1.3 Update generation resolution settings

**File:** `scripts/ai-images/lib/pythonRunner.js`

Pass resolution based on asset type:
- `--resolution 256` for portraits, nodes
- `--resolution 128` for tiles, items, icons

---

### Phase 2: Tile Quality Fixes

#### 2.1 Improve tile prompts

**File:** `scripts/ai-images/lib/promptBuilder.js`

Update `STYLE_PREFIXES.tile`:
```javascript
tile: 'wbgmsst, isometric floor tile, diamond rhombus shape with sharp pointed corners, ' +
  '2:1 width-to-height aspect ratio, 30 degree orthographic projection, ' +
  'flat horizontal surface texture only, seamless tileable pattern, ' +
  'ink and wash watercolor style, bold black outline border defining diamond edges, ' +
  'clean white background outside diamond shape, 128x128 game sprite'
```

Update `buildTilePrompt()`:
```javascript
function buildTilePrompt(tile, biomeData) {
  const biomeModifier = biomeData.biomeModifier || '';
  const basePrompt = tile.prompt;

  return `${STYLE_PREFIXES.tile} ${basePrompt}, ${biomeModifier}`;
}
```

#### 2.2 Add tile-specific negative prompt

**File:** `ai-image-metadata/tiles/manifest.json`

Add:
```json
{
  "negativePrompt": "square tile, rectangular, circular, rounded corners, irregular shape, perspective view, 3D depth, raised edges, objects on tile, decorations, scattered items, grass clumps, plants, rocks, debris"
}
```

#### 2.3 Implement diamond mask post-processing

**Integration point:** After Python generator returns image, before saving

The mask function already exists in `image-generator/modia-generators/lib/image_processing.py`:
```python
def apply_diamond_mask(image: Image.Image) -> Image.Image
```

Ensure this is called in the tile generation pipeline.

---

### Phase 3: Missing Asset Metadata

#### 3.1 Create wall metadata

**New files:**
- `ai-image-metadata/tiles/walls/base.json`
- `ai-image-metadata/tiles/walls/forest.json`
- `ai-image-metadata/tiles/walls/cave.json`
- `ai-image-metadata/tiles/walls/mountain.json`
- `ai-image-metadata/tiles/walls/bridge.json`
- `ai-image-metadata/tiles/walls/castle.json`

**Wall prompt pattern:**
```
wbgmsst, seamless vertical cliff face texture, [biome] stone wall,
tileable pattern for stacking, ink and wash watercolor style,
bold black outlines, 128x32 strip for 64x16 output
```

#### 3.2 Create slope metadata

**New files:**
- `ai-image-metadata/tiles/slopes/base.json`
- `ai-image-metadata/tiles/slopes/forest.json`
- `ai-image-metadata/tiles/slopes/cave.json`
- `ai-image-metadata/tiles/slopes/mountain.json`
- `ai-image-metadata/tiles/slopes/bridge.json`
- `ai-image-metadata/tiles/slopes/castle.json`

**Slope prompt pattern:**
```
wbgmsst, isometric ramp tile, smooth elevation transition from low to high,
[biome] terrain, facing [direction], ink and wash watercolor style,
diamond footprint base, 128x160 for 64x80 output
```

#### 3.3 Add missing elevation indicators

Create indicator metadata for forest, bridge, castle biomes (base, cave, mountain already have them).

---

### Phase 4: Tile Regeneration

#### 4.1 Backup existing tiles
```bash
cd frontend/public/assets/sprites/terrain
zip -r tiles-backup-$(date +%Y%m%d).zip . -x "*.zip"
```

#### 4.2 Regenerate all floor tiles
```bash
npm run ai:generate:tiles -- --force --category floors
```

#### 4.3 Generate new walls and slopes
```bash
npm run ai:generate:tiles -- --category walls
npm run ai:generate:tiles -- --category slopes
```

#### 4.4 Visual validation

Manually inspect tiles in:
- Browser dev tools
- Battle scene preview
- Thumbnail grid view

---

### Phase 5: Documentation Update

**File:** `docs/AI_IMAGE_GENERATION.md`

Update to reflect:
- Removed `--sizes` flag
- New resolution standards
- Post-processing pipeline
- Diamond mask for tiles
- Wall and slope generation

---

## Files to Modify

### Modia Scripts (7 files)
| File | Changes |
|------|---------|
| `scripts/ai-images/generate-tiles.js` | Remove --sizes, update resolution |
| `scripts/ai-images/generate-portraits.js` | Remove --sizes, add post-process call |
| `scripts/ai-images/generate-items.js` | Remove --sizes, add post-process call |
| `scripts/ai-images/generate-icons.js` | Remove --sizes, add post-process call |
| `scripts/ai-images/generate-nodes.js` | Remove --sizes, update resolution |
| `scripts/ai-images/lib/promptBuilder.js` | Improve tile prompts |
| `scripts/ai-images/lib/resizeUtils.js` | Add post-processing functions |

### Metadata (12+ files)
| File | Changes |
|------|---------|
| `ai-image-metadata/tiles/manifest.json` | Add negativePrompt |
| `ai-image-metadata/tiles/walls/*.json` | Create 6 new files |
| `ai-image-metadata/tiles/slopes/*.json` | Create 6 new files |

### Documentation (1 file)
| File | Changes |
|------|---------|
| `docs/AI_IMAGE_GENERATION.md` | Update with new patterns |

---

## Verification Plan

1. **Unit test**: Run `--dry-run` on each generator to verify prompt construction
2. **Single tile test**: Generate one forest_grass tile, inspect for diamond shape
3. **Batch test**: Regenerate forest biome tiles, visual inspection
4. **Integration test**: Load battle scene, verify tiles render correctly
5. **Full regeneration**: After validation, regenerate all tiles

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Diamond mask clips content | Ensure prompts describe content in center of tile |
| Resolution change breaks existing code | Verify AssetLoader handles all sizes |
| Python post-processing adds latency | Acceptable - quality > speed for asset generation |
| New prompts produce worse results | Keep backups, A/B test before committing |

---

## Success Criteria

- [ ] All tiles are proper diamond shapes (no rounded/irregular edges) - *Requires tile regeneration (Phase 4)*
- [x] `--sizes` flag removed from all generators
- [x] Post-processing generates correct size variants automatically
- [x] Wall and slope metadata created for all 6 biomes
- [ ] Battle scene renders with new tiles without visual glitches - *Requires tile regeneration (Phase 4)*
- [x] Documentation updated with new patterns
