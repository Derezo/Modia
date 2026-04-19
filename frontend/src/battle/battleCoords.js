/**
 * @module battleCoords
 * @description Coordinate conversion utilities for battle canvas and DOM overlay.
 *
 * The canvas uses a fixed logical coordinate system (e.g., 800x600) that is
 * scaled via CSS to fit the viewport. DOM elements in the UI overlay need
 * screen pixel coordinates. These utilities handle the conversion.
 *
 * @see BattleScene.js - Uses for radial menu and context menu positioning
 * @see BattleUI.js - Could use for tooltip positioning
 */

/**
 * Convert canvas logical coordinates to UI overlay screen coordinates.
 * The canvas uses a fixed logical coordinate system, but is scaled and centered
 * via CSS. DOM elements in the UI overlay need screen pixel coordinates.
 *
 * @param {Object} params - Conversion parameters
 * @param {number} params.canvasX - X coordinate in canvas logical space
 * @param {number} params.canvasY - Y coordinate in canvas logical space
 * @param {HTMLCanvasElement} params.canvas - The canvas element
 * @param {HTMLElement} params.uiOverlay - The UI overlay element
 * @param {number} params.logicalWidth - Canvas logical width (e.g., 800)
 * @param {number} params.logicalHeight - Canvas logical height (e.g., 600)
 * @returns {Object} { x, y } in screen pixels relative to UI overlay
 */
export function canvasToOverlayCoords({
  canvasX,
  canvasY,
  canvas,
  uiOverlay,
  logicalWidth,
  logicalHeight
}) {
  const canvasRect = canvas.getBoundingClientRect();
  const overlayRect = uiOverlay.getBoundingClientRect();

  // Convert logical coords to screen coords
  // Scale factor: canvasRect.width / logicalWidth
  const scaleX = canvasRect.width / logicalWidth;
  const scaleY = canvasRect.height / logicalHeight;

  // Position in screen pixels relative to canvas
  const canvasScreenX = canvasX * scaleX;
  const canvasScreenY = canvasY * scaleY;

  // Add canvas offset relative to overlay
  const offsetX = canvasRect.left - overlayRect.left;
  const offsetY = canvasRect.top - overlayRect.top;

  return {
    x: offsetX + canvasScreenX,
    y: offsetY + canvasScreenY
  };
}
