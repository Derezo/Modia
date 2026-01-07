# PixelLab Tileset Generation Plan

## Research Summary

### PixelLab Tile Generation APIs

Based on research of the [PixelLab API documentation](https://www.pixellab.ai/docs/tools/create-tileset) and [MCP tools](https://www.pixellab.ai/mcp):

#### 1. Wang Tilesets (`/create-tileset`)
- **Purpose**: Generates 16-23 seamlessly connecting tiles for terrain transitions
- **View**: Top-down only ("high top-down" or "low top-down")
- **Parameters**:
  - `lower_description`: Base terrain (water, grass, lava)
  - `upper_description`: Elevated terrain (beach, dirt, rock)
  - `transition_description`: Transition between levels
  - `tile_size`: 16x16 or 32x32
  - `transition_size`: 0.25-1.0 (elevation effect)
- **Output**: Set of tiles with corner metadata (NW, NE, SW, SE terrain types)
- **Use case**: Seamless 2D top-down terrain

#### 2. Isometric Tiles (`/create-isometric-tile`)
- **Purpose**: Individual isometric sprites with transparent backgrounds
- **Parameters**:
  - `description`: Visual description
  - `image_size`: 16-64 pixels (24+ recommended)
  - `isometric_tile_shape`: "thin tile" (~15% height), "thick tile" (~25%), "block" (~50%)
- **Output**: Single isometric sprite
- **Use case**: Individual decorative tiles, NOT seamless terrain

### The Problem

| Feature | Wang Tilesets | Isometric Tiles | Our Game |
|---------|--------------|-----------------|----------|
| View | Top-down | Isometric | Isometric |
| Grid | Square | Diamond | Diamond (64x32) |
| Seamless | Yes (Wang algorithm) | No | Need seamless |
| Transitions | Built-in | None | Need transitions |

**Core Issue**: Wang tilesets provide seamless terrain but only for top-down view. Isometric tiles match our perspective but don't tile seamlessly.

---

## Solution Options

### Option A: Switch to Top-Down View
- **Approach**: Change game from isometric to top-down
- **Pros**: Perfect seamless terrain via Wang tilesets
- **Cons**: Major visual redesign, loses isometric aesthetic
- **Effort**: Very High
- **Recommendation**: Not recommended

### Option B: Improved Isometric Tiles (Recommended)
- **Approach**: Generate cohesive isometric tile sets with consistent styling
- **Pros**: Keeps isometric style, works with current engine
- **Cons**: Not truly seamless, visible tile borders
- **Effort**: Medium
- **Recommendation**: Best balance of effort vs result

### Option C: Top-Down Ground + Isometric Objects
- **Approach**: Wang tileset as ground layer, isometric objects on top
- **Pros**: Seamless ground
- **Cons**: Visual style clash between layers
- **Effort**: High
- **Recommendation**: Not recommended (inconsistent look)

### Option D: Pre-rendered Isometric Tileset
- **Approach**: Generate a large isometric scene, slice into tiles
- **Pros**: Consistent look, seamless within slices
- **Cons**: Requires post-processing, limited variety
- **Effort**: High
- **Recommendation**: Possible future enhancement

---

## Recommended Implementation: Option B

### Strategy: Cohesive Isometric Tile System

Instead of seamless mathematical tiling, create visually cohesive tiles through:

1. **Consistent Style Parameters** across all tiles
2. **Shared Color Palettes** per biome
3. **Edge-aware Prompts** describing tile borders
4. **Deterministic Seeds** for reproducibility

### Tile Categories

#### Ground Tiles (walkable)
Generate with `isometric_tile_shape: "thin tile"` for flat ground:
- `grass` - Basic walkable terrain
- `stone` - Stone/rock floor
- `dirt` - Path/dirt ground
- `sand` - Desert/beach terrain

#### Elevated Tiles (impassable)
Generate with `isometric_tile_shape: "thick tile"` for obstacles:
- `rock` - Rocky outcrops
- `forest` - Dense vegetation
- `water` - Bodies of water
- `cliff` - Cliff edges

#### Block Tiles (structures)
Generate with `isometric_tile_shape: "block"` for solid objects:
- `wall` - Castle/dungeon walls
- `building` - Structural blocks

### Generation Parameters

```javascript
const TILE_CONFIG = {
  // Consistent across all tiles
  image_size: { width: 32, height: 32 },
  outline: 'medium',
  shading: 'soft',
  detail: 'medium',

  // Per-biome style suffix
  styleSuffix: 'pixel art, 16-bit fantasy RPG, cohesive color palette',

  // Biome color palettes (for consistency)
  biomes: {
    forest: {
      primary: ['#3d5c3d', '#4a7a4a', '#2d4a2d'],
      accent: ['#8b7355', '#6b8e23']
    },
    cave: {
      primary: ['#4a4a5a', '#3a3a4a', '#5a5a6a'],
      accent: ['#6a5acd', '#ff6347']
    },
    mountain: {
      primary: ['#696969', '#808080', '#a9a9a9'],
      accent: ['#ffffff', '#87ceeb']
    }
  }
};
```

### Improved Prompts

Current prompts describe the tile content. Improved prompts should also describe:
- **Edge treatment**: "seamless edges", "blending borders"
- **Perspective**: "isometric view", "45-degree angle"
- **Consistency**: "flat ground plane", "uniform lighting from top-left"

Example improved prompt:
```
"Grass terrain tile, lush green with subtle texture variation,
isometric perspective, seamless edges that blend with adjacent tiles,
consistent top-left lighting, pixel art style, 16-bit fantasy RPG"
```

### Grid Size Adjustment

Current issue: 32x32 sprites scaled to 64x32 grid

**Option 1**: Generate at 64x32 native (if API supports)
**Option 2**: Generate at 32x32 and accept scaling
**Option 3**: Generate at 64x64 and crop/adjust

Recommendation: Test 64x64 generation with specific isometric framing

---

## Implementation Plan

### Phase 1: Tile Generation Script Updates

1. **Update `generate-tiles.js`** with improved prompts
2. **Add biome-specific style parameters**
3. **Implement consistent seed system** per biome
4. **Add tile shape selection** based on terrain type

### Phase 2: Test Single Biome

1. **Generate forest biome tiles** (4 terrain types)
2. **Verify visual consistency**
3. **Test in-game rendering**
4. **Iterate on prompts if needed**

### Phase 3: Generate All Biomes

1. **Forest**: grass, stone, forest, rock (4 types × 4 variants = 16 tiles)
2. **Cave**: stone, grass, rock, water, lava (5 types × 4 variants = 20 tiles)
3. **Mountain**: stone, rock, grass, cliff (4 types × 4 variants = 16 tiles)
4. **Bridge**: stone, water, grass (3 types × 4 variants = 12 tiles)
5. **Castle**: stone, grass (2 types × 4 variants = 8 tiles)

**Total**: ~72 terrain tiles

### Phase 4: Obstacles and Decorations

Generate obstacle sprites separately:
- Trees (oak, pine, dead)
- Rocks (small, medium, large)
- Decorative (flowers, crystals, ruins)

---

## Credit Budget

Current balance: **4 generations remaining** (out of 40)

### Conservative Approach (4 credits)
- Generate 4 high-quality base tiles
- Copy/recolor for variants
- Focus on forest biome only

### Full Generation (requires more credits)
- 72 terrain tiles = 72 credits
- 15 obstacles = 15 credits
- **Total needed**: ~90 credits

### Recommendation
1. Test with remaining 4 credits on forest biome
2. Evaluate results before purchasing more
3. Consider subscription for ongoing generation

---

## Alternative: Wang Tileset Hybrid

If visual seams remain unacceptable, consider:

1. Generate Wang tileset (top-down) for ground texture
2. Apply perspective transform to fake isometric view
3. Overlay true isometric objects

This is complex but could achieve better ground blending.

---

## Next Steps

1. [ ] Approve this plan
2. [ ] Update tile generation script with improved prompts
3. [ ] Test generation of 4 forest tiles with remaining credits
4. [ ] Evaluate results and iterate
5. [ ] Decide on credit purchase for full generation

---

## Sources

- [PixelLab Create Tileset Documentation](https://www.pixellab.ai/docs/tools/create-tileset)
- [PixelLab MCP Tools](https://www.pixellab.ai/mcp)
- [PixelLab API Overview](https://www.pixellab.ai/pixellab-api)
