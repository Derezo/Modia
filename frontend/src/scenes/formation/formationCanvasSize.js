/**
 * Logical (CSS pixel) size of the formation grid canvas for its container.
 *
 * The grid area is a flex:1 region, so on short viewports (a phone in
 * landscape) or during a zero-size layout pass it can be smaller than the
 * padding and instructions row deducted here. The result is clamped to a
 * usable minimum so the canvas, FormationGrid.setLogicalSize and the pointer
 * mapping never receive zero or negative sizes; a container that has not been
 * laid out yet (0 x 0) returns null so the caller keeps its current size.
 */

const ASPECT_RATIO = 1.8; // approximately 2:1 for the isometric grid
const HORIZONTAL_PADDING = 32;
const INSTRUCTIONS_HEIGHT = 60; // desktop only: padding + instructions row
const MOBILE_VERTICAL_PADDING = 16;
export const MIN_FORMATION_CANVAS_WIDTH = 180;
export const MIN_FORMATION_CANVAS_HEIGHT = Math.round(MIN_FORMATION_CANVAS_WIDTH / ASPECT_RATIO);

/**
 * @param {Object} params
 * @param {number} params.clientWidth - Grid area clientWidth
 * @param {number} params.clientHeight - Grid area clientHeight
 * @param {boolean} params.isMobile - Mobile layout (no instructions row)
 * @returns {{width: number, height: number}|null}
 */
export function computeFormationCanvasSize({ clientWidth, clientHeight, isMobile }) {
  const areaW = Number(clientWidth) || 0;
  const areaH = Number(clientHeight) || 0;
  if (areaW <= 0 && areaH <= 0) return null;

  const maxWidth = isMobile ? 360 : 600;
  const maxHeight = isMobile ? 200 : 320;
  const verticalDeduction = isMobile ? MOBILE_VERTICAL_PADDING : INSTRUCTIONS_HEIGHT;

  const containerWidth = Math.max(
    MIN_FORMATION_CANVAS_WIDTH,
    Math.min(areaW - HORIZONTAL_PADDING, maxWidth)
  );
  const containerHeight = Math.max(
    MIN_FORMATION_CANVAS_HEIGHT,
    Math.min(areaH - verticalDeduction, maxHeight)
  );

  let width = containerWidth;
  let height = containerWidth / ASPECT_RATIO;
  if (height > containerHeight) {
    height = containerHeight;
    width = height * ASPECT_RATIO;
  }

  return { width: Math.round(width), height: Math.round(height) };
}
