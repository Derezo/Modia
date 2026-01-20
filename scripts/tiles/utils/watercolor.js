/**
 * Watercolor Effect Utilities for Procedural Tile Generation
 */

const { createPixelBuffer, setPixel, getPixel, fillDiamond, isInsideDiamond } = require('./canvas');
const { hexToRgb } = require('./palettes');
const { generateNoiseMap, createSeededRandom } = require('./noise');

/**
 * Apply watercolor wash effect
 */
function applyWatercolorWash(buffer, size, baseColor, variant = 0, options = {}) {
  const { pigmentDensity = 0.7, waterAmount = 0.3, granulation = 0.2 } = options;
  const baseRgb = hexToRgb(baseColor);
  const pigmentNoise = generateNoiseMap(size, size, 0.12, variant * 50, variant * 50, 'fbm');
  const granulationNoise = generateNoiseMap(size, size, 0.25, variant * 80, variant * 80, 'turbulence');

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isInsideDiamond(x, y, size, 0)) continue;
      const pixel = getPixel(buffer, size, x, y);
      if (pixel.a === 0) continue;

      const idx = y * size + x;
      const pigmentVar = pigmentNoise[idx] * pigmentDensity;
      const grain = granulationNoise[idx] * granulation;
      const brightness = 1 + (pigmentVar - 0.5) * 0.4 + grain * 0.2;

      setPixel(
        buffer, size, x, y,
        Math.max(0, Math.min(255, Math.round(baseRgb.r * brightness))),
        Math.max(0, Math.min(255, Math.round(baseRgb.g * brightness))),
        Math.max(0, Math.min(255, Math.round(baseRgb.b * brightness))),
        pixel.a
      );
    }
  }
}

/**
 * Apply paper texture effect
 */
function applyPaperTexture(buffer, size, roughness = 0.15, variant = 0) {
  const textureNoise = generateNoiseMap(size, size, 0.3, variant * 200, variant * 200, 'turbulence');
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const pixel = getPixel(buffer, size, x, y);
      if (pixel.a === 0) continue;
      const texture = textureNoise[y * size + x];
      const adjustment = (texture - 0.5) * roughness;
      setPixel(
        buffer, size, x, y,
        Math.max(0, Math.min(255, Math.round(pixel.r * (1 + adjustment)))),
        Math.max(0, Math.min(255, Math.round(pixel.g * (1 + adjustment)))),
        Math.max(0, Math.min(255, Math.round(pixel.b * (1 + adjustment)))),
        pixel.a
      );
    }
  }
}

/**
 * Apply wet blending effect
 */
function applyWetBlending(buffer, size, bleedRadius = 2, intensity = 0.3) {
  const tempBuffer = new Uint8Array(buffer);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const pixel = getPixel(buffer, size, x, y);
      if (pixel.a === 0) continue;
      let totalR = 0, totalG = 0, totalB = 0, count = 0;
      for (let dy = -bleedRadius; dy <= bleedRadius; dy++) {
        for (let dx = -bleedRadius; dx <= bleedRadius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
            const neighbor = getPixel(buffer, size, nx, ny);
            if (neighbor.a > 0) {
              const dist = Math.sqrt(dx * dx + dy * dy);
              const weight = Math.max(0, 1 - dist / bleedRadius);
              totalR += neighbor.r * weight;
              totalG += neighbor.g * weight;
              totalB += neighbor.b * weight;
              count += weight;
            }
          }
        }
      }
      if (count > 0) {
        setPixel(
          tempBuffer, size, x, y,
          Math.round(pixel.r * (1 - intensity) + (totalR / count) * intensity),
          Math.round(pixel.g * (1 - intensity) + (totalG / count) * intensity),
          Math.round(pixel.b * (1 - intensity) + (totalB / count) * intensity),
          pixel.a
        );
      }
    }
  }
  buffer.set(tempBuffer);
}

/**
 * Create a complete watercolor-style isometric tile
 */
function createWatercolorTile(size, baseColor, variant = 0, options = {}) {
  const {
    pigmentDensity = 0.7,
    waterAmount = 0.25,
    granulation = 0.15,
    wetBlending = 0.2,
    paperTexture = 0.1,
    lightIntensity = 0.25
  } = options;

  const buffer = createPixelBuffer(size, size);
  fillDiamond(buffer, size, baseColor, 0);
  applyWatercolorWash(buffer, size, baseColor, variant, { pigmentDensity, waterAmount, granulation });
  if (wetBlending > 0) applyWetBlending(buffer, size, 2, wetBlending);
  if (paperTexture > 0) applyPaperTexture(buffer, size, paperTexture, variant);

  // Apply isometric lighting
  const baseRgb = hexToRgb(baseColor);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const pixel = getPixel(buffer, size, x, y);
      if (pixel.a === 0) continue;
      const lightFactor = 1 - ((x + y) / (size * 2)) * lightIntensity;
      setPixel(
        buffer, size, x, y,
        Math.min(255, Math.round(pixel.r * lightFactor)),
        Math.min(255, Math.round(pixel.g * lightFactor)),
        Math.min(255, Math.round(pixel.b * lightFactor)),
        pixel.a
      );
    }
  }

  // Apply edge falloff
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isInsideDiamond(x, y, size, 0)) continue;
      const dx = Math.abs(x - half);
      const dy = Math.abs(y - half);
      const dist = dx / half + dy / half;
      if (dist > 0.9) {
        const pixel = getPixel(buffer, size, x, y);
        const alpha = Math.round(255 * Math.max(0, (1 - dist) / 0.1));
        setPixel(buffer, size, x, y, pixel.r, pixel.g, pixel.b, alpha);
      }
    }
  }

  return buffer;
}

/**
 * Add watercolor details
 */
function addWatercolorDetails(buffer, size, color, variant, type = 'dots') {
  const random = createSeededRandom(variant * 54321);
  const { r, g, b } = hexToRgb(color);

  if (type === 'dots') {
    const numDots = 5 + Math.floor(random() * 10);
    for (let i = 0; i < numDots; i++) {
      const x = Math.floor(random() * size);
      const y = Math.floor(random() * size);
      if (isInsideDiamond(x, y, size, 4)) {
        const existing = getPixel(buffer, size, x, y);
        if (existing.a > 0) {
          const blendFactor = 0.3;
          setPixel(
            buffer, size, x, y,
            Math.round(existing.r * (1 - blendFactor) + r * blendFactor),
            Math.round(existing.g * (1 - blendFactor) + g * blendFactor),
            Math.round(existing.b * (1 - blendFactor) + b * blendFactor),
            existing.a
          );
        }
      }
    }
  }
}

module.exports = {
  applyWatercolorWash,
  applyPaperTexture,
  applyWetBlending,
  createWatercolorTile,
  addWatercolorDetails
};
