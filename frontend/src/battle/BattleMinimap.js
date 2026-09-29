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

const MINIMAP_MAX_SIZE = 120;
const MINIMAP_INSET = 5;
const MINIMAP_MARGIN = 10;

/**
 * Calculate a V3 minimap from the tile-diamond silhouette. This deliberately
 * does not use BattleGrid.getMapPixelDimensions(): that box also includes
 * tall decorative/obstacle draw bounds, which must not alter tactical map
 * framing or the world-to-minimap transform.
 */
export function getV3MinimapLayout({
  renderedCells,
  tileWidth,
  tileHeight,
  targetWidth,
  silhouette = null
}) {
  if (!Array.isArray(renderedCells) || renderedCells.length === 0) return null;

  const halfWidth = tileWidth / 2;
  const halfHeight = tileHeight / 2;
  let worldMinX = Infinity;
  let worldMinY = Infinity;
  let worldMaxX = -Infinity;
  let worldMaxY = -Infinity;
  for (const cell of renderedCells) {
    worldMinX = Math.min(worldMinX, cell.worldX - halfWidth);
    worldMinY = Math.min(worldMinY, cell.worldY - halfHeight);
    worldMaxX = Math.max(worldMaxX, cell.worldX + halfWidth);
    worldMaxY = Math.max(worldMaxY, cell.worldY + halfHeight);
  }

  const mapDim = {
    worldMinX,
    worldMinY,
    worldMaxX,
    worldMaxY,
    width: worldMaxX - worldMinX,
    height: worldMaxY - worldMinY,
    offsetX: -worldMinX,
    offsetY: -worldMinY
  };
  const inset = silhouette === 'organic-island' ? 3 : MINIMAP_INSET;
  const maxInteriorSize = MINIMAP_MAX_SIZE - inset * 2;
  const scale = maxInteriorSize / Math.max(mapDim.width, mapDim.height);
  const frameWidth = mapDim.width * scale + inset * 2;
  const frameHeight = mapDim.height * scale + inset * 2;
  const minimapX = targetWidth - frameWidth - MINIMAP_MARGIN;
  const minimapY = MINIMAP_MARGIN;

  return {
    mapDim,
    minimapX,
    minimapY,
    minimapWidth: frameWidth,
    minimapHeight: frameHeight,
    scale,
    offsetX: minimapX + inset - mapDim.worldMinX * scale,
    offsetY: minimapY + inset - mapDim.worldMinY * scale
  };
}

function traceSilhouetteCells(
  ctx,
  renderedCells,
  offsetX,
  offsetY,
  scale,
  tileWidth,
  tileHeight
) {
  const halfWidth = tileWidth * scale / 2;
  const halfHeight = tileHeight * scale / 2;
  ctx.beginPath();
  for (const cell of renderedCells) {
    const x = offsetX + cell.worldX * scale;
    const y = offsetY + cell.worldY * scale;
    ctx.moveTo(x, y - halfHeight);
    ctx.lineTo(x + halfWidth, y);
    ctx.lineTo(x, y + halfHeight);
    ctx.lineTo(x - halfWidth, y);
    ctx.closePath();
  }
}

function strokeSilhouetteOutline(
  ctx,
  renderedCells,
  offsetX,
  offsetY,
  scale,
  tileWidth,
  tileHeight
) {
  const cells = new Set(renderedCells.map(cell => `${cell.x},${cell.y}`));
  const neighbors = [
    { dx: 0, dy: -1, edge: [0, 1] },
    { dx: 1, dy: 0, edge: [1, 2] },
    { dx: 0, dy: 1, edge: [2, 3] },
    { dx: -1, dy: 0, edge: [3, 0] }
  ];
  const halfWidth = tileWidth * scale / 2;
  const halfHeight = tileHeight * scale / 2;
  ctx.beginPath();
  for (const cell of renderedCells) {
    const x = offsetX + cell.worldX * scale;
    const y = offsetY + cell.worldY * scale;
    const points = [
      { x, y: y - halfHeight },
      { x: x + halfWidth, y },
      { x, y: y + halfHeight },
      { x: x - halfWidth, y }
    ];
    for (const neighbor of neighbors) {
      if (cells.has(`${cell.x + neighbor.dx},${cell.y + neighbor.dy}`)) {
        continue;
      }
      ctx.moveTo(points[neighbor.edge[0]].x, points[neighbor.edge[0]].y);
      ctx.lineTo(points[neighbor.edge[1]].x, points[neighbor.edge[1]].y);
    }
  }
  ctx.stroke();
}

/**
 * Intersect the camera's visible world rectangle with the map bounds and map
 * the result into minimap coordinates.
 */
export function getMinimapViewportRect({
  camera,
  mapDim,
  targetWidth,
  targetHeight,
  offsetX,
  offsetY,
  scale
}) {
  const zoom = Math.max(camera.zoom || 1, Number.EPSILON);
  const visibleW = targetWidth / zoom;
  const visibleH = targetHeight / zoom;
  const mapMinX = mapDim.worldMinX ?? -mapDim.offsetX;
  const mapMinY = mapDim.worldMinY ?? -mapDim.offsetY;
  const mapMaxX = mapDim.worldMaxX ?? mapMinX + mapDim.width;
  const mapMaxY = mapDim.worldMaxY ?? mapMinY + mapDim.height;

  const worldLeft = Math.max(mapMinX, camera.x - visibleW / 2);
  const worldTop = Math.max(mapMinY, camera.y - visibleH / 2);
  const worldRight = Math.min(mapMaxX, camera.x + visibleW / 2);
  const worldBottom = Math.min(mapMaxY, camera.y + visibleH / 2);

  if (worldRight <= worldLeft || worldBottom <= worldTop) return null;

  return {
    x: offsetX + worldLeft * scale,
    y: offsetY + worldTop * scale,
    width: (worldRight - worldLeft) * scale,
    height: (worldBottom - worldTop) * scale
  };
}

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
export function renderMinimap({ ctx, units, camera, grid, targetWidth, targetHeight, localTeamId = 1 }) {
  const isV3 = grid.battleMapV3RenderData !== null
    && grid.battleMapV3RenderData !== undefined;
  const renderedCells = isV3 ? grid.getRenderedWorldCells?.() ?? [] : [];
  const silhouette = grid.battleMapV3RenderData?.scene?.silhouette ?? null;
  const v3Layout = getV3MinimapLayout({
    renderedCells,
    tileWidth: grid.tileWidth ?? 64,
    tileHeight: grid.tileHeight ?? 32,
    targetWidth,
    silhouette
  });
  // V1/V2 retain the legacy square framing. V3 frames its render-mask
  // silhouette, excluding tall art-only draw bounds.
  const legacyMapDim = v3Layout ? null : grid.getMapPixelDimensions();
  const minimapWidth = v3Layout?.minimapWidth ?? MINIMAP_MAX_SIZE;
  const minimapHeight = v3Layout?.minimapHeight ?? MINIMAP_MAX_SIZE;
  const minimapX = v3Layout?.minimapX ?? targetWidth - minimapWidth - MINIMAP_MARGIN;
  const minimapY = v3Layout?.minimapY ?? MINIMAP_MARGIN;
  const mapDim = v3Layout?.mapDim ?? legacyMapDim;

  const organic = silhouette === 'organic-island';
  if (!organic) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(minimapX, minimapY, minimapWidth, minimapHeight);
  }

  // Calculate scale to fit map in minimap
  const scale = v3Layout?.scale
    ?? (MINIMAP_MAX_SIZE - MINIMAP_INSET * 2) / Math.max(mapDim.width, mapDim.height);
  const offsetX = v3Layout?.offsetX
    ?? minimapX + MINIMAP_INSET + mapDim.offsetX * scale;
  const offsetY = v3Layout?.offsetY
    ?? minimapY + MINIMAP_INSET + mapDim.offsetY * scale;

  // V3 minimaps show the authored silhouette rather than the rectangular
  // allocation. Legacy grids do not expose rendered-world cells and retain
  // the existing background-only presentation.
  if (renderedCells.length > 0) {
    ctx.save();
    ctx.fillStyle = 'rgba(100, 142, 104, 0.72)';
    traceSilhouetteCells(
      ctx,
      renderedCells,
      offsetX,
      offsetY,
      scale,
      grid.tileWidth ?? 64,
      grid.tileHeight ?? 32
    );
    ctx.fill();
    ctx.restore();
  }

  if (organic && renderedCells.length > 0) {
    ctx.save();
    traceSilhouetteCells(
      ctx,
      renderedCells,
      offsetX,
      offsetY,
      scale,
      grid.tileWidth ?? 64,
      grid.tileHeight ?? 32
    );
    ctx.clip();
  }

  // Draw units as dots
  for (const unit of units.values()) {
    if (!unit.isAlive()) continue;

    const dotX = offsetX + unit.screenX * scale;
    const dotY = offsetY + unit.screenY * scale;

    ctx.beginPath();
    ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
    ctx.fillStyle = unit.teamId === localTeamId ? '#4a90d9' : '#d94a4a';
    ctx.fill();

    // Highlight active unit
    if (unit.isSelected) {
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // Draw only the portion of the camera viewport that overlaps the map. At a
  // mobile fit zoom the visible world can be larger than the map itself.
  const viewport = getMinimapViewportRect({
    camera,
    mapDim,
    targetWidth,
    targetHeight,
    offsetX,
    offsetY,
    scale
  });

  if (viewport) {
    const mapMinX = mapDim.worldMinX ?? -mapDim.offsetX;
    const mapMinY = mapDim.worldMinY ?? -mapDim.offsetY;
    ctx.save();
    if (!organic) {
      ctx.beginPath();
      ctx.rect(
        offsetX + mapMinX * scale,
        offsetY + mapMinY * scale,
        mapDim.width * scale,
        mapDim.height * scale
      );
      ctx.clip();
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(viewport.x, viewport.y, viewport.width, viewport.height);
    ctx.restore();
  }

  if (organic && renderedCells.length > 0) {
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = 'rgba(192, 218, 199, 0.9)';
    ctx.lineWidth = 1.5;
    strokeSilhouetteOutline(
      ctx,
      renderedCells,
      offsetX,
      offsetY,
      scale,
      grid.tileWidth ?? 64,
      grid.tileHeight ?? 32
    );
    ctx.restore();
  } else {
    // Legacy V3 and rectangular platforms retain a conventional frame.
    ctx.strokeStyle = '#4a4a6a';
    ctx.lineWidth = 2;
    ctx.strokeRect(minimapX, minimapY, minimapWidth, minimapHeight);
  }

  // Label: top-aligned a few px below the frame so it never overlaps the
  // 2px border (an alphabetic baseline at +12 put the glyph tops on it).
  ctx.save();
  ctx.fillStyle = '#888';
  ctx.font = `${responsive.getCanvasFontSize('sm')}px Arial`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(
    'Arrows: Pan | Space: Re-center',
    minimapX + minimapWidth,
    minimapY + minimapHeight + 5
  );
  ctx.restore();
}
