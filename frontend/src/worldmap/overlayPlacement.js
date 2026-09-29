/**
 * Placement math for DOM overlays that follow a world-map node (the node
 * action menu and the hover tooltip). Pure, so it is unit-testable.
 *
 * Overlays are kept inside the visible canvas rect rather than the viewport:
 * with a letterboxed canvas the viewport has empty gutters, and an overlay
 * placed there floats away from the map.
 *
 * Vertical rule: prefer below the node; flip above only when below does not
 * fit and above does. When neither fits (short phone canvas), use the side
 * with more room and clamp inside the canvas.
 */

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * @param {Object} params
 * @param {number} params.nodeX - node centre, viewport px
 * @param {number} params.nodeY - node centre, viewport px
 * @param {number} params.nodeSize - node radius-ish offset, viewport px
 * @param {number} params.width - overlay width, px
 * @param {number} params.height - overlay height, px
 * @param {{left:number, top:number, right:number, bottom:number}} params.bounds - canvas rect
 * @param {number} [params.gap=12] - space between node and overlay
 * @param {number} [params.margin=8] - minimum inset from the bounds
 * @returns {{ centerX: number, top: number, above: boolean }}
 *   centerX is the overlay's horizontal centre (overlays use translateX(-50%)),
 *   top is the overlay's top edge.
 */
export function placeNodeOverlay({
  nodeX,
  nodeY,
  nodeSize,
  width,
  height,
  bounds,
  gap = 12,
  margin = 8
}) {
  const minTop = bounds.top + margin;
  const maxBottom = bounds.bottom - margin;

  const belowTop = nodeY + nodeSize + gap;
  const aboveTop = nodeY - nodeSize - gap - height;
  const fitsBelow = belowTop + height <= maxBottom;
  const fitsAbove = aboveTop >= minTop;

  let above;
  if (fitsBelow) {
    above = false;
  } else if (fitsAbove) {
    above = true;
  } else {
    above = (nodeY - bounds.top) > (bounds.bottom - nodeY);
  }

  const rawTop = above ? aboveTop : belowTop;
  const top = clamp(rawTop, minTop, Math.max(minTop, maxBottom - height));

  const half = width / 2;
  const minCenter = bounds.left + margin + half;
  const maxCenter = bounds.right - margin - half;
  const centerX = minCenter > maxCenter
    ? (bounds.left + bounds.right) / 2
    : clamp(nodeX, minCenter, maxCenter);

  return { centerX, top, above };
}

/**
 * Bounds fallback when no canvas rect is available: the whole viewport,
 * optionally capped to a legacy canvasHeight.
 */
export function viewportBounds(canvasHeight) {
  const width = typeof window !== 'undefined' ? window.innerWidth : 800;
  const height = typeof window !== 'undefined' ? window.innerHeight : 600;
  return {
    left: 0,
    top: 0,
    right: width,
    bottom: Number.isFinite(canvasHeight) ? canvasHeight : height
  };
}
