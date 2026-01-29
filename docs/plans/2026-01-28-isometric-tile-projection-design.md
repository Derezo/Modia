# Isometric Tile Projection Fix - Implementation Plan

## Problem Summary

Battle map tiles appear with flat square textures masked into diamond shapes, instead of proper isometric-projected textures. The diamond mask is correctly applied, but the texture content inside lacks the foreshortening expected from a 30-degree isometric view.

## Root Cause

The Python post-processing pipeline (`process_tile()` in `image_processing.py`) only applied:
1. Resize to 64x64
2. Diamond mask (corners transparent)

**Missing step**: Isometric affine transform to create proper perspective projection.

## Solution: Post-Processing Projection

Apply proper isometric projection during asset generation in Python, before tiles reach the frontend:
- Mathematically consistent results every time
- Works with any AI-generated flat texture
- No changes needed to frontend rendering code
- Handles both floor tiles AND slope tiles uniformly

## Implementation

### Files Modified

| File | Project | Change |
|------|---------|--------|
| `modia-generators/lib/image_processing.py` | image-generator | Added `apply_isometric_projection()`, `apply_slope_projection()`, updated `process_tile()` |

### Key Functions

**`apply_isometric_projection(image, output_size=64)`**
- Uses 2:1 isometric ratio (standard pixel art) with 26.565° axis angles
- Rotates texture 45° then compresses Y by 50%
- Output: 64x64 RGBA with diamond (64x32) centered vertically

**`apply_slope_projection(image, direction, levels=1, output_size=64)`**
- Direction-specific transforms for slope tiles
- Supports north, south, east, west directions
- Configurable elevation levels affect tilt angle

**`process_tile(image, size=64, tile_type='floor', direction=None, levels=1)`**
- Updated to use 2x intermediate size for quality
- Routes to appropriate projection based on tile_type

## Verification

Run the test script to verify:
```bash
cd ~/Projects/image-generator
python3 -c "
from modia_generators.lib.image_processing import apply_isometric_projection
from PIL import Image, ImageDraw
# ... test with checkerboard pattern ...
"
```

## Success Criteria

1. Tiles visually show isometric perspective (not flat square texture cut into diamond)
2. Adjacent tiles align seamlessly at edges
3. Elevation/stacking system continues working
4. Slopes connect properly to floor tiles at different elevations
5. All biomes render consistently

## Rollback Plan

Revert `image_processing.py` changes. Existing pre-generated tiles remain functional. No frontend changes to revert.
