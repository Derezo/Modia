# Terrain Cost Visibility Design

**Status:** Implemented (commit ea96311)
**Date:** 2026-01-08

## Problem

Players see movement tiles highlighted uniformly, but some tiles (forest, water) cost more movement than others. This makes movement feel inconsistent and broken when players can't reach tiles they expect to.

## Solution

Three-part solution to communicate terrain costs:

### 1. Opacity Gradient for Movement Tiles

Tile opacity scales based on movement cost:

```javascript
const remainingMovement = movementRange - tile.cost;
const opacity = 0.2 + (remainingMovement / movementRange) * 0.5;
// Result: 20% (hard to reach) → 70% (easy to reach)
```

Example for Wizard (3 movement):
| Tile Cost | Remaining | Opacity |
|-----------|-----------|---------|
| 1 (grass) | 2 | ~53% |
| 2 (forest) | 1 | ~37% |
| 3 (edge) | 0 | ~20% |

### 2. Terrain Tooltip (Desktop)

On hover over any tile in move mode:
- Show floating tooltip near cursor
- Content: "Forest (2 mov)" format
- Semi-transparent dark background, white text
- Positioned up-right from cursor to not obscure tile

### 3. Two-Tap Mobile Support

Touch devices use two-tap pattern:
| Tap | Action |
|-----|--------|
| First tap | Select tile, show tooltip persistently |
| Second tap (same) | Confirm movement |
| Tap elsewhere | Change selection |

Visual feedback: Selected tile pulses or shows brighter highlight (0.7 opacity).

## Implementation

**File:** `frontend/public/src/scenes/BattleScene.js`

### Changes Required

1. **Opacity gradient** (~line 1819 in highlight building):
   - Use `tile.cost` from reachableTiles array
   - Calculate opacity based on remaining movement

2. **Tooltip rendering** (in render method):
   - Track hovered tile terrain type
   - Render tooltip text on HUD layer
   - Query `grid.getTerrain(x, y)` and `grid.getMovementCost(x, y)`

3. **Mobile two-tap** (in handleTileClick):
   - Add `selectedMoveTile` state
   - First tap selects, second tap confirms
   - Detect touch via `'ontouchstart' in window`

### Terrain Costs (existing in BattleGrid.js:293)

```javascript
const costs = {
  grass: 1,
  stone: 1,
  forest: 2,
  water: 3
};
```

## Success Criteria

- [x] Distant/costly tiles visibly dimmer than nearby/cheap tiles
- [x] Hovering tile shows "Terrain (X mov)" tooltip
- [x] Mobile players can preview terrain before confirming move
- [x] Players understand why some tiles are reachable and others aren't
