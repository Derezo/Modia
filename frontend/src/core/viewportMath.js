/**
 * Pure viewport math for Game.resize (no DOM access, unit-testable).
 *
 * Every canvas scene draws in a logical coordinate space. Most scenes use the
 * fixed 800x600 (4:3) space and are contain-scaled into the container, which
 * letterboxes them. A scene that sets `fluidViewport = true` (the world map)
 * instead gets a logical space whose aspect ratio follows the container:
 *   - landscape (wider than 4:3): height stays 600, width grows up to MAX_WIDTH
 *   - portrait / narrow: width stays 800, height grows up to MAX_HEIGHT
 * Past those clamps the fluid scene letterboxes like any other.
 */

export const FIXED_VIEWPORT = Object.freeze({ width: 800, height: 600 });

export const FLUID_VIEWPORT_LIMITS = Object.freeze({
  baseWidth: 800,
  baseHeight: 600,
  maxWidth: 1400,   // ~21:9 at 600 high
  maxHeight: 1800   // ~4:9 at 800 wide (tall phones)
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Logical canvas dimensions for a container.
 * @param {number} containerWidth - CSS px
 * @param {number} containerHeight - CSS px
 * @param {{ fluid?: boolean }} [options]
 * @returns {{ width: number, height: number }}
 */
export function computeLogicalViewport(containerWidth, containerHeight, { fluid = false } = {}) {
  if (!fluid || !(containerWidth > 0) || !(containerHeight > 0)) {
    return { width: FIXED_VIEWPORT.width, height: FIXED_VIEWPORT.height };
  }

  const { baseWidth, baseHeight, maxWidth, maxHeight } = FLUID_VIEWPORT_LIMITS;
  const aspect = containerWidth / containerHeight;

  if (aspect >= baseWidth / baseHeight) {
    return {
      width: Math.round(clamp(baseHeight * aspect, baseWidth, maxWidth)),
      height: baseHeight
    };
  }

  return {
    width: baseWidth,
    height: Math.round(clamp(baseWidth / aspect, baseHeight, maxHeight))
  };
}

/**
 * Uniform contain-scale of a logical space into a container.
 * @returns {number} CSS px per logical px
 */
export function computeContainScale(containerWidth, containerHeight, logicalWidth, logicalHeight) {
  if (!(containerWidth > 0) || !(containerHeight > 0)) return 1;
  return Math.min(containerWidth / logicalWidth, containerHeight / logicalHeight);
}

/**
 * Distances from each viewport edge to the canvas, for anchoring DOM overlays
 * to the visible canvas instead of the viewport.
 * @param {{ left: number, top: number, right: number, bottom: number }} rect - canvas getBoundingClientRect()
 * @param {number} viewportWidth
 * @param {number} viewportHeight
 * @returns {{ top: number, left: number, right: number, bottom: number, width: number, height: number }}
 */
export function computeCanvasInsets(rect, viewportWidth, viewportHeight) {
  const left = Math.max(0, Math.round(rect.left));
  const top = Math.max(0, Math.round(rect.top));
  return {
    top,
    left,
    right: Math.max(0, Math.round(viewportWidth - rect.right)),
    bottom: Math.max(0, Math.round(viewportHeight - rect.bottom)),
    width: Math.round(rect.right - rect.left),
    height: Math.round(rect.bottom - rect.top)
  };
}
