/**
 * Canvas Utilities for Procedural Tile Generation
 * Helper functions for drawing isometric tiles and shapes
 */

const { hexToRgb } = require('./palettes');
const { generateNoiseMap } = require('./noise');

/**
 * Create an isometric diamond path
 */
function createIsometricDiamond(size, inset = 0) {
  const half = size / 2;
  return [
    { x: half, y: inset },
    { x: size - inset, y: half },
    { x: half, y: size - inset },
    { x: inset, y: half }
  ];
}

/**
 * Check if a point is inside an isometric diamond
 */
function isInsideDiamond(x, y, size, inset = 0) {
  const half = size / 2;
  const dx = Math.abs(x - half);
  const dy = Math.abs(y - half);
  const maxDist = half - inset;
  return (dx / maxDist + dy / maxDist) <= 1;
}

/**
 * Get distance from point to diamond edge (normalized 0-1)
 */
function distanceFromEdge(x, y, size) {
  const half = size / 2;
  const dx = Math.abs(x - half);
  const dy = Math.abs(y - half);
  const dist = dx / half + dy / half;
  return Math.max(0, 1 - dist);
}

/**
 * Create raw pixel buffer for a tile
 */
function createPixelBuffer(width, height) {
  return new Uint8Array(width * height * 4);
}

/**
 * Set a pixel in the buffer
 */
function setPixel(buffer, width, x, y, r, g, b, a = 255) {
  const idx = (y * width + x) * 4;
  buffer[idx] = r;
  buffer[idx + 1] = g;
  buffer[idx + 2] = b;
  buffer[idx + 3] = a;
}

/**
 * Get a pixel from the buffer
 */
function getPixel(buffer, width, x, y) {
  const idx = (y * width + x) * 4;
  return {
    r: buffer[idx],
    g: buffer[idx + 1],
    b: buffer[idx + 2],
    a: buffer[idx + 3]
  };
}

/**
 * Fill the entire buffer with a color
 */
function fillBuffer(buffer, width, height, hexColor, alpha = 255) {
  const { r, g, b } = hexToRgb(hexColor);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      setPixel(buffer, width, x, y, r, g, b, alpha);
    }
  }
}

/**
 * Fill diamond-shaped region with a color
 */
function fillDiamond(buffer, size, hexColor, inset = 0) {
  const { r, g, b } = hexToRgb(hexColor);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isInsideDiamond(x, y, size, inset)) {
        setPixel(buffer, size, x, y, r, g, b, 255);
      }
    }
  }
}

/**
 * Apply isometric lighting gradient
 */
function applyIsometricLighting(buffer, size, intensity = 0.3) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const pixel = getPixel(buffer, size, x, y);
      if (pixel.a === 0) continue;
      const lightFactor = 1 - ((x + y) / (size * 2)) * intensity;
      setPixel(
        buffer, size, x, y,
        Math.min(255, Math.round(pixel.r * lightFactor)),
        Math.min(255, Math.round(pixel.g * lightFactor)),
        Math.min(255, Math.round(pixel.b * lightFactor)),
        pixel.a
      );
    }
  }
}

/**
 * Apply edge alpha falloff
 */
function applyEdgeFalloff(buffer, size, falloffStart = 0.1, falloffEnd = 0.0) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const pixel = getPixel(buffer, size, x, y);
      if (pixel.a === 0) continue;
      const dist = distanceFromEdge(x, y, size);
      if (dist < falloffStart) {
        const factor = (dist - falloffEnd) / (falloffStart - falloffEnd);
        const newAlpha = Math.max(0, Math.min(255, Math.round(pixel.a * factor)));
        setPixel(buffer, size, x, y, pixel.r, pixel.g, pixel.b, newAlpha);
      }
    }
  }
}

/**
 * Apply noise texture overlay
 */
function applyNoiseTexture(buffer, size, scale = 0.15, intensity = 0.3, offsetX = 0, offsetY = 0, type = 'fbm') {
  const noiseMap = generateNoiseMap(size, size, scale, offsetX, offsetY, type);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const pixel = getPixel(buffer, size, x, y);
      if (pixel.a === 0) continue;
      const noiseValue = noiseMap[y * size + x];
      const adjustment = (noiseValue - 0.5) * 2 * intensity;
      setPixel(
        buffer, size, x, y,
        Math.max(0, Math.min(255, Math.round(pixel.r + pixel.r * adjustment))),
        Math.max(0, Math.min(255, Math.round(pixel.g + pixel.g * adjustment))),
        Math.max(0, Math.min(255, Math.round(pixel.b + pixel.b * adjustment))),
        pixel.a
      );
    }
  }
}

/**
 * Draw a simple line using Bresenham's algorithm
 */
function drawLine(buffer, width, x0, y0, x1, y1, hexColor, alpha = 255) {
  const { r, g, b } = hexToRgb(hexColor);
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;

  while (true) {
    if (x >= 0 && x < width && y >= 0 && y < width) {
      setPixel(buffer, width, x, y, r, g, b, alpha);
    }
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

/**
 * Draw a filled circle
 */
function drawFilledCircle(buffer, width, cx, cy, radius, hexColor, alpha = 255) {
  const { r, g, b } = hexToRgb(hexColor);
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= r2) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < width && y >= 0 && y < width) {
          setPixel(buffer, width, x, y, r, g, b, alpha);
        }
      }
    }
  }
}

/**
 * Draw a filled ellipse
 */
function drawFilledEllipse(buffer, width, cx, cy, rx, ry, hexColor, alpha = 255) {
  const { r, g, b } = hexToRgb(hexColor);
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) {
        const x = Math.round(cx + dx);
        const y = Math.round(cy + dy);
        if (x >= 0 && x < width && y >= 0 && y < width) {
          setPixel(buffer, width, x, y, r, g, b, alpha);
        }
      }
    }
  }
}

/**
 * Draw a filled triangle
 */
function drawFilledTriangle(buffer, width, points, hexColor, alpha = 255) {
  const { r, g, b } = hexToRgb(hexColor);
  const minX = Math.max(0, Math.floor(Math.min(points[0].x, points[1].x, points[2].x)));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(points[0].x, points[1].x, points[2].x)));
  const minY = Math.max(0, Math.floor(Math.min(points[0].y, points[1].y, points[2].y)));
  const maxY = Math.min(width - 1, Math.ceil(Math.max(points[0].y, points[1].y, points[2].y)));

  const sign = (p1, p2, p3) => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const p = { x, y };
      const d1 = sign(p, points[0], points[1]);
      const d2 = sign(p, points[1], points[2]);
      const d3 = sign(p, points[2], points[0]);
      const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
      const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
      if (!(hasNeg && hasPos)) {
        setPixel(buffer, width, x, y, r, g, b, alpha);
      }
    }
  }
}

/**
 * Blend two pixel buffers
 */
function blendBuffers(base, overlay, width, height, opacity = 1) {
  for (let i = 0; i < width * height * 4; i += 4) {
    const baseA = base[i + 3] / 255;
    const overlayA = (overlay[i + 3] / 255) * opacity;
    if (overlayA > 0) {
      const outA = overlayA + baseA * (1 - overlayA);
      if (outA > 0) {
        base[i] = Math.round((overlay[i] * overlayA + base[i] * baseA * (1 - overlayA)) / outA);
        base[i + 1] = Math.round((overlay[i + 1] * overlayA + base[i + 1] * baseA * (1 - overlayA)) / outA);
        base[i + 2] = Math.round((overlay[i + 2] * overlayA + base[i + 2] * baseA * (1 - overlayA)) / outA);
        base[i + 3] = Math.round(outA * 255);
      }
    }
  }
}

/**
 * Create a base isometric tile with watercolor effect
 */
function createIsometricTile(size, baseColor, variant = 0, options = {}) {
  const {
    noiseScale = 0.15,
    noiseIntensity = 0.3,
    lightIntensity = 0.25,
    edgeFalloff = true,
    falloffStart = 0.08,
    falloffEnd = 0.0
  } = options;

  const buffer = createPixelBuffer(size, size);
  fillDiamond(buffer, size, baseColor, 0);
  applyNoiseTexture(buffer, size, noiseScale, noiseIntensity, variant * 100, variant * 100);
  applyIsometricLighting(buffer, size, lightIntensity);
  if (edgeFalloff) {
    applyEdgeFalloff(buffer, size, falloffStart, falloffEnd);
  }
  return buffer;
}

module.exports = {
  createIsometricDiamond,
  isInsideDiamond,
  distanceFromEdge,
  createPixelBuffer,
  setPixel,
  getPixel,
  fillBuffer,
  fillDiamond,
  applyIsometricLighting,
  applyEdgeFalloff,
  applyNoiseTexture,
  drawLine,
  drawFilledCircle,
  drawFilledEllipse,
  drawFilledTriangle,
  blendBuffers,
  createIsometricTile
};
