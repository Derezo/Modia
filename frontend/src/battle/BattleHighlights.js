/**
 * @module BattleHighlights
 * @description Builds tile highlight colors for the battle grid based on current action state.
 *
 * This module computes highlight colors for:
 * - Movement range (blue gradient based on terrain cost)
 * - Attack range (red for enemies, orange for allies, dim for empty)
 * - Skill targeting (purple for enemies, blue for allies, with AoE preview)
 * - Hovered tile indicator
 *
 * @see BattleScene.js - Orchestrator that calls buildHighlights in render()
 * @see BattleGrid.js - Renders the highlights on the isometric grid
 */

/**
 * Build tile highlights map based on current action state
 * @param {Object} params - Highlight parameters
 * @param {string|null} params.currentAction - Current action mode: 'move' | 'attack' | 'skill' | null
 * @param {Array} params.validTiles - Array of valid target tiles for current action
 * @param {number} params.movementRange - Maximum movement range for cost calculations
 * @param {Object|null} params.selectedMoveTile - Selected tile for two-tap mobile movement
 * @param {Object|null} params.hoveredTile - Currently hovered tile {x, y}
 * @param {Object} params.pathfinding - BattlePathfinding instance for AoE calculations
 * @param {Object|null} params.skill - Active skill object (for AoE preview)
 * @param {Function} params.getUnitAt - Function to get unit at position (x, y)
 * @param {boolean} params.isPvP - Whether this is a PvP battle
 * @param {string} params.localUserId - Local player's user ID
 * @param {number} params.localTeamId - Local player's team ID
 * @returns {Object} Map of "x,y" -> highlight color string
 */
export function buildHighlights({
  currentAction,
  validTiles,
  movementRange,
  selectedMoveTile,
  hoveredTile,
  pathfinding,
  skill,
  getUnitAt,
  isPvP,
  localUserId,
  localTeamId
}) {
  const highlights = {};

  // Movement range highlights with opacity gradient based on terrain cost
  if (currentAction === 'move') {
    for (const tile of validTiles) {
      // Calculate opacity: tiles that cost more to reach are dimmer
      // Formula: 0.2 (min) + (remaining movement / max range) * 0.5
      const remainingMovement = movementRange - tile.cost;
      const opacity = 0.2 + (remainingMovement / movementRange) * 0.5;
      highlights[`${tile.x},${tile.y}`] = `rgba(74, 144, 217, ${opacity.toFixed(2)})`;
    }

    // Mobile: highlight selected tile brighter for two-tap feedback
    if (selectedMoveTile) {
      const key = `${selectedMoveTile.x},${selectedMoveTile.y}`;
      highlights[key] = 'rgba(100, 180, 255, 0.75)'; // Brighter blue for selected
    }
  }

  // Attack range highlights (tile-based targeting)
  if (currentAction === 'attack') {
    for (const tile of validTiles) {
      const unit = getUnitAt(tile.x, tile.y);
      const isEnemy = unit && (isPvP ? unit.isOpponent(localUserId, localTeamId) : unit.type === 'enemy');
      const isAlly = unit && (isPvP ? unit.isAlly(localUserId, localTeamId) : unit.type === 'player');

      if (isEnemy) {
        highlights[`${tile.x},${tile.y}`] = 'rgba(217, 74, 74, 0.6)';  // Bright red for enemies
      } else if (isAlly) {
        highlights[`${tile.x},${tile.y}`] = 'rgba(217, 174, 74, 0.5)'; // Orange for allies
      } else {
        highlights[`${tile.x},${tile.y}`] = 'rgba(217, 74, 74, 0.3)';  // Dim red for empty tiles
      }
    }
  }

  // Skill range highlights (tile-based targeting)
  if (currentAction === 'skill') {
    for (const tile of validTiles) {
      const unit = getUnitAt(tile.x, tile.y);
      const isEnemy = unit && (isPvP ? unit.isOpponent(localUserId, localTeamId) : unit.type === 'enemy');
      const isAlly = unit && (isPvP ? unit.isAlly(localUserId, localTeamId) : unit.type === 'player');

      if (isEnemy) {
        highlights[`${tile.x},${tile.y}`] = 'rgba(148, 74, 217, 0.6)';  // Purple for enemies
      } else if (isAlly) {
        highlights[`${tile.x},${tile.y}`] = 'rgba(74, 144, 217, 0.5)';  // Blue for allies
      } else {
        highlights[`${tile.x},${tile.y}`] = 'rgba(148, 74, 217, 0.3)';  // Dim purple for empty tiles
      }
    }

    // Show AoE preview when hovering over a valid tile
    if (hoveredTile && skill && skill.aoeRadius) {
      const isValidHover = validTiles.some(t => t.x === hoveredTile.x && t.y === hoveredTile.y);
      if (isValidHover) {
        const aoeTiles = pathfinding.getAoETiles(
          hoveredTile.x,
          hoveredTile.y,
          skill.aoeRadius,
          skill.aoePattern || 'circle'
        );

        for (const aoeTile of aoeTiles) {
          const key = `${aoeTile.x},${aoeTile.y}`;
          if (aoeTile.isCenter) {
            // Bright orange for center tile
            highlights[key] = 'rgba(255, 140, 0, 0.8)';
          } else {
            // Softer orange for adjacent AoE tiles
            highlights[key] = 'rgba(255, 165, 0, 0.5)';
          }
        }
      }
    }
  }

  // Hovered tile highlight - always show hover indicator
  if (hoveredTile) {
    const key = `${hoveredTile.x},${hoveredTile.y}`;
    // If tile is already highlighted for targeting, make it brighter on hover
    if (highlights[key]) {
      // Intensify existing highlight on hover
      highlights[key] = highlights[key].replace(/[\d.]+\)$/, '0.8)');
    } else {
      // Show white hover indicator for non-highlighted tiles
      highlights[key] = 'rgba(255, 255, 255, 0.4)';
    }
  }

  return highlights;
}
