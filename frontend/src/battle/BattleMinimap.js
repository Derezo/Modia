/**
 * @module BattleMinimap
 * @description Renders a minimap overlay showing unit positions and camera viewport.
 *
 * The minimap displays:
 * - Unit positions as colored dots (blue for players, red for enemies)
 * - Active unit highlighted with gold ring
 * - Camera viewport rectangle showing visible area
 * - Control hints below the minimap
 *
 * @see BattleScene.js - Calls renderMinimap in render()
 */

import { responsive } from '../core/Responsive.js';

/**
 * Render minimap in corner of the battle screen
 * @param {Object} params - Render parameters
 * @param {CanvasRenderingContext2D} params.ctx - Canvas 2D context
 * @param {Map} params.units - Map of unit ID to BattleUnit instances
 * @param {Object} params.camera - BattleCamera instance with x, y, zoom
 * @param {Object} params.grid - BattleGrid instance for map dimensions
 * @param {number} params.targetWidth - Logical canvas width
 * @param {number} params.targetHeight - Logical canvas height
 */
export function renderMinimap({ ctx, units, camera, grid, targetWidth, targetHeight }) {
  const minimapSize = 120;
  // Use logical width, not DPR-backing-store width
  const minimapX = targetWidth - minimapSize - 10;
  const minimapY = 10;
  const mapDim = grid.getMapPixelDimensions();

  // Background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(minimapX, minimapY, minimapSize, minimapSize);

  // Calculate scale to fit map in minimap
  const scale = (minimapSize - 10) / Math.max(mapDim.width, mapDim.height);
  const offsetX = minimapX + 5 + mapDim.offsetX * scale;
  const offsetY = minimapY + 5 + mapDim.offsetY * scale;

  // Draw units as dots
  for (const unit of units.values()) {
    if (!unit.isAlive()) continue;

    const dotX = offsetX + unit.screenX * scale;
    const dotY = offsetY + unit.screenY * scale;

    ctx.beginPath();
    ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
    ctx.fillStyle = unit.type === 'player' ? '#4a90d9' : '#d94a4a';
    ctx.fill();

    // Highlight active unit
    if (unit.isSelected) {
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // Draw camera viewport rectangle (visible world area shrinks as zoom grows)
  const zoom = camera.zoom || 1;
  const visibleW = targetWidth / zoom;
  const visibleH = targetHeight / zoom;
  const viewportWidth = visibleW * scale;
  const viewportHeight = visibleH * scale;
  const viewportX = offsetX + (camera.x - visibleW / 2) * scale;
  const viewportY = offsetY + (camera.y - visibleH / 2) * scale;

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(viewportX, viewportY, viewportWidth, viewportHeight);

  // Border
  ctx.strokeStyle = '#4a4a6a';
  ctx.lineWidth = 2;
  ctx.strokeRect(minimapX, minimapY, minimapSize, minimapSize);

  // Label
  ctx.fillStyle = '#888';
  ctx.font = `${responsive.getCanvasFontSize('sm')}px Arial`;
  ctx.textAlign = 'left';
  ctx.fillText('WASD/Arrows: Pan | Space: Re-center', minimapX, minimapY + minimapSize + 12);
}
