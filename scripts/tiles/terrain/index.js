/**
 * Terrain Tile Generators
 * Consolidated terrain generation functions
 */

const { createPixelBuffer, setPixel, getPixel, fillDiamond, isInsideDiamond } = require('../utils/canvas');
const { BIOME_PALETTES, hexToRgb, lightenColor, darkenColor } = require('../utils/palettes');
const { createWatercolorTile, addWatercolorDetails, applyPaperTexture } = require('../utils/watercolor');
const { createSeededRandom, generateNoiseMap, voronoi } = require('../utils/noise');

// ============ GRASS ============
function generateGrassTile(size = 64, biome = 'forest', variant = 0, options = {}) {
  const { density = 'medium', withFlowers = false } = options;
  const palette = BIOME_PALETTES[biome] || BIOME_PALETTES.forest;
  const grassColors = palette.grass || BIOME_PALETTES.forest.grass;
  const baseColor = grassColors[variant % grassColors.length];

  const buffer = createWatercolorTile(size, baseColor, variant, {
    pigmentDensity: 0.65, waterAmount: 0.2, granulation: 0.12,
    wetBlending: 0.15, paperTexture: 0.08, lightIntensity: 0.22
  });

  const random = createSeededRandom(variant * 11111);
  const numTufts = density === 'sparse' ? 4 : density === 'dense' ? 14 : 8;
  const detailColor = darkenColor(baseColor, 0.15);

  for (let i = 0; i < numTufts; i++) {
    const x = 8 + Math.floor(random() * (size - 16));
    const y = 16 + Math.floor(random() * (size - 24));
    if (isInsideDiamond(x, y, size, 6)) {
      for (let h = 0; h < 3 + random() * 4; h++) {
        const px = Math.round(x + (random() - 0.5) * 1.5 * h);
        const py = y - h;
        if (px >= 0 && px < size && py >= 0 && py < size && isInsideDiamond(px, py, size, 2)) {
          const existing = getPixel(buffer, size, px, py);
          if (existing.a > 0) {
            const { r, g, b } = hexToRgb(detailColor);
            setPixel(buffer, size, px, py,
              Math.round(existing.r * 0.7 + r * 0.3),
              Math.round(existing.g * 0.7 + g * 0.3),
              Math.round(existing.b * 0.7 + b * 0.3), existing.a);
          }
        }
      }
    }
  }

  if (withFlowers) {
    const flowerColors = ['#c04040', '#d0b040', '#4060c0', '#f0f0f0'];
    for (let i = 0; i < 3; i++) {
      if (random() < 0.4) {
        const fx = 12 + Math.floor(random() * (size - 24));
        const fy = 12 + Math.floor(random() * (size - 24));
        if (isInsideDiamond(fx, fy, size, 8)) {
          const { r, g, b } = hexToRgb(flowerColors[Math.floor(random() * flowerColors.length)]);
          const existing = getPixel(buffer, size, fx, fy);
          if (existing.a > 0) setPixel(buffer, size, fx, fy, r, g, b, existing.a);
        }
      }
    }
  }

  return buffer;
}

// ============ STONE ============
function generateStoneTile(size = 64, biome = 'cave', variant = 0, options = {}) {
  const { cracked = true, crackDensity = 'medium', withMoss = false, mossCoverage = 0.2, smooth = false } = options;
  const palette = BIOME_PALETTES[biome] || BIOME_PALETTES.cave;
  const stoneColors = palette.stone || BIOME_PALETTES.cave.stone;
  const baseColor = stoneColors[variant % stoneColors.length];

  const buffer = createWatercolorTile(size, baseColor, variant, {
    pigmentDensity: smooth ? 0.8 : 0.6, waterAmount: smooth ? 0.1 : 0.15,
    granulation: smooth ? 0.05 : 0.2, wetBlending: smooth ? 0.1 : 0.15,
    paperTexture: smooth ? 0.03 : 0.12, lightIntensity: 0.28
  });

  const random = createSeededRandom(variant * 22222);

  // Stone texture
  if (!smooth) {
    const scale = 0.08 + variant * 0.02;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!isInsideDiamond(x, y, size, 0)) continue;
        const pixel = getPixel(buffer, size, x, y);
        if (pixel.a === 0) continue;
        const v = voronoi(x, y, scale, variant);
        const colorMod = lightenColor(baseColor, (v - 0.5) * 0.2);
        const { r, g, b } = hexToRgb(colorMod);
        setPixel(buffer, size, x, y,
          Math.round(pixel.r * 0.7 + r * 0.3),
          Math.round(pixel.g * 0.7 + g * 0.3),
          Math.round(pixel.b * 0.7 + b * 0.3), pixel.a);
      }
    }
  }

  // Cracks
  if (cracked && crackDensity !== 'none') {
    const numCracks = crackDensity === 'light' ? 2 : crackDensity === 'heavy' ? 7 : 4;
    const crackColor = hexToRgb(darkenColor(baseColor, 0.3));
    for (let i = 0; i < numCracks; i++) {
      let x = 10 + random() * (size - 20);
      let y = 10 + random() * (size - 20);
      if (!isInsideDiamond(x, y, size, 8)) continue;
      let angle = random() * Math.PI * 2;
      const length = 8 + random() * 15;
      for (let d = 0; d < length; d++) {
        angle += (random() - 0.5) * 0.6;
        x += Math.cos(angle);
        y += Math.sin(angle);
        const px = Math.round(x), py = Math.round(y);
        if (px >= 0 && px < size && py >= 0 && py < size && isInsideDiamond(px, py, size, 3)) {
          const existing = getPixel(buffer, size, px, py);
          if (existing.a > 0) {
            const fade = 1 - d / length * 0.6;
            setPixel(buffer, size, px, py,
              Math.round(existing.r * (1 - 0.5 * fade) + crackColor.r * 0.5 * fade),
              Math.round(existing.g * (1 - 0.5 * fade) + crackColor.g * 0.5 * fade),
              Math.round(existing.b * (1 - 0.5 * fade) + crackColor.b * 0.5 * fade), existing.a);
          }
        }
      }
    }
  }

  // Moss
  if (withMoss) {
    const noiseMap = generateNoiseMap(size, size, 0.1, variant * 77, variant * 77, 'fbm');
    const { r: mr, g: mg, b: mb } = hexToRgb(palette.moss?.[0] || '#3a5a3a');
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!isInsideDiamond(x, y, size, 4)) continue;
        const pixel = getPixel(buffer, size, x, y);
        if (pixel.a === 0) continue;
        const noise = noiseMap[y * size + x];
        const positionBias = (x + y) / (size * 2) * 0.3;
        if (noise + positionBias > 1 - mossCoverage) {
          const blend = Math.min(0.7, (noise + positionBias - (1 - mossCoverage)) * 0.8);
          setPixel(buffer, size, x, y,
            Math.round(pixel.r * (1 - blend) + mr * blend),
            Math.round(pixel.g * (1 - blend) + mg * blend),
            Math.round(pixel.b * (1 - blend) + mb * blend), pixel.a);
        }
      }
    }
  }

  return buffer;
}

// ============ COBBLESTONE ============
function generateCobblestoneTile(size = 64, biome = 'castle', variant = 0) {
  const palette = BIOME_PALETTES[biome] || BIOME_PALETTES.castle;
  const stoneColors = palette.cobblestone || palette.stone || ['#707070'];
  const baseColor = stoneColors[variant % stoneColors.length];

  const buffer = createWatercolorTile(size, baseColor, variant, {
    pigmentDensity: 0.7, waterAmount: 0.12, granulation: 0.15,
    wetBlending: 0.1, paperTexture: 0.1, lightIntensity: 0.25
  });

  const random = createSeededRandom(variant * 44444);
  const gridSize = 12 + Math.floor(random() * 4);
  const gapColor = hexToRgb(darkenColor(baseColor, 0.35));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isInsideDiamond(x, y, size, 2)) continue;
      const pixel = getPixel(buffer, size, x, y);
      if (pixel.a === 0) continue;

      const row = Math.floor(y / gridSize);
      const offsetX = (row % 2) * (gridSize / 2);
      const cellX = (x + offsetX) % gridSize;
      const cellY = y % gridSize;

      if (cellX < 1.5 || cellY < 1.5) {
        setPixel(buffer, size, x, y,
          Math.round(pixel.r * 0.4 + gapColor.r * 0.6),
          Math.round(pixel.g * 0.4 + gapColor.g * 0.6),
          Math.round(pixel.b * 0.4 + gapColor.b * 0.6), pixel.a);
      }
    }
  }

  return buffer;
}

// ============ WATER ============
function generateWaterTile(size = 64, biome = 'forest', variant = 0, options = {}) {
  const { type = 'clear' } = options;
  const waterColors = {
    forest: { base: '#4080a0', deep: '#306080' },
    cave: { base: '#3a5060', deep: '#2a4050' },
    swamp: { base: '#3a5040', deep: '#2a4030' },
    bridge: { base: '#4080a0', deep: '#306080' },
    mountain: { base: '#5090b0', deep: '#407090' }
  };

  const colors = waterColors[biome] || waterColors.forest;
  let baseColor = colors.base;
  if (type === 'murky') baseColor = darkenColor(colors.base, 0.2);
  else if (type === 'shallow') baseColor = lightenColor(colors.base, 0.15);

  const buffer = createWatercolorTile(size, baseColor, variant, {
    pigmentDensity: 0.5, waterAmount: 0.4, granulation: 0.08,
    wetBlending: 0.25, paperTexture: 0.05, lightIntensity: 0.15
  });

  // Wave pattern
  const phaseOffset = variant * 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isInsideDiamond(x, y, size, 0)) continue;
      const pixel = getPixel(buffer, size, x, y);
      if (pixel.a === 0) continue;
      const wave = Math.sin((x * 0.12 + phaseOffset) * 2) * 0.5 + Math.sin((y * 0.1 + phaseOffset * 0.7) * 2) * 0.3;
      const factor = 1 + wave * 0.15;
      setPixel(buffer, size, x, y,
        Math.max(0, Math.min(255, Math.round(pixel.r * factor))),
        Math.max(0, Math.min(255, Math.round(pixel.g * factor))),
        Math.max(0, Math.min(255, Math.round(pixel.b * factor))), pixel.a);
    }
  }

  // Depth gradient
  if (type !== 'shallow') {
    const { r: dr, g: dg, b: db } = hexToRgb(colors.deep);
    const center = size / 2;
    const depthIntensity = type === 'deep' ? 0.4 : 0.25;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!isInsideDiamond(x, y, size, 0)) continue;
        const pixel = getPixel(buffer, size, x, y);
        if (pixel.a === 0) continue;
        const dx = Math.abs(x - center) / center;
        const dy = Math.abs(y - center) / center;
        const depthFactor = Math.max(0, 1 - (dx + dy)) * depthIntensity;
        setPixel(buffer, size, x, y,
          Math.round(pixel.r * (1 - depthFactor) + dr * depthFactor),
          Math.round(pixel.g * (1 - depthFactor) + dg * depthFactor),
          Math.round(pixel.b * (1 - depthFactor) + db * depthFactor), pixel.a);
      }
    }
  }

  return buffer;
}

// ============ LAVA ============
function generateLavaTile(size = 64, biome = 'cave', variant = 0, options = {}) {
  const colors = ['#a03020', '#c04030', '#e06040', '#ff8050'];
  const baseColor = colors[1];

  const buffer = createPixelBuffer(size, size);
  fillDiamond(buffer, size, baseColor, 0);

  // Lava flow pattern
  const flowNoise = generateNoiseMap(size, size, 0.08, variant * 40, variant * 40, 'turbulence');
  const colorRgbs = colors.map(c => hexToRgb(c));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isInsideDiamond(x, y, size, 0)) continue;
      const pixel = getPixel(buffer, size, x, y);
      if (pixel.a === 0) continue;
      const flow = flowNoise[y * size + x];
      const colorIndex = Math.min(colorRgbs.length - 1, Math.floor(flow * colorRgbs.length));
      const c = colorRgbs[colorIndex];
      setPixel(buffer, size, x, y, c.r, c.g, c.b, pixel.a);
    }
  }

  // Edge falloff
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isInsideDiamond(x, y, size, 0)) continue;
      const dx = Math.abs(x - half);
      const dy = Math.abs(y - half);
      const dist = dx / half + dy / half;
      if (dist > 0.85) {
        const pixel = getPixel(buffer, size, x, y);
        const alpha = Math.round(255 * Math.max(0, (1 - dist) / 0.15));
        setPixel(buffer, size, x, y, pixel.r, pixel.g, pixel.b, alpha);
      }
    }
  }

  return buffer;
}

// ============ ICE ============
function generateIceTile(size = 64, biome = 'mountain', variant = 0, options = {}) {
  const palette = BIOME_PALETTES[biome] || BIOME_PALETTES.mountain;
  const iceColors = palette.ice || BIOME_PALETTES.mountain.ice;
  const baseColor = iceColors[variant % iceColors.length];

  const buffer = createWatercolorTile(size, baseColor, variant, {
    pigmentDensity: 0.75, waterAmount: 0.15, granulation: 0.08,
    wetBlending: 0.2, paperTexture: 0.05, lightIntensity: 0.2
  });

  // Ice cracks using voronoi
  const crackColor = hexToRgb(darkenColor(baseColor, 0.25));
  const scale = 0.07 + variant * 0.01;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isInsideDiamond(x, y, size, 2)) continue;
      const pixel = getPixel(buffer, size, x, y);
      if (pixel.a === 0) continue;
      const v = voronoi(x, y, scale, variant);
      if (v < 0.15) {
        const intensity = 1 - v / 0.15;
        const blend = intensity * 0.6;
        setPixel(buffer, size, x, y,
          Math.round(pixel.r * (1 - blend) + crackColor.r * blend),
          Math.round(pixel.g * (1 - blend) + crackColor.g * blend),
          Math.round(pixel.b * (1 - blend) + crackColor.b * blend), pixel.a);
      }
    }
  }

  return buffer;
}

// ============ SNOW ============
function generateSnowTile(size = 64, biome = 'mountain', variant = 0, options = {}) {
  const palette = BIOME_PALETTES[biome] || BIOME_PALETTES.mountain;
  const snowColors = palette.snow || BIOME_PALETTES.mountain.snow;
  const baseColor = snowColors[variant % snowColors.length];

  const buffer = createWatercolorTile(size, baseColor, variant, {
    pigmentDensity: 0.85, waterAmount: 0.1, granulation: 0.12,
    wetBlending: 0.15, paperTexture: 0.08, lightIntensity: 0.18
  });

  // Snow sparkles
  const random = createSeededRandom(variant * 44444);
  const numSparkles = 5 + Math.floor(random() * 8);
  for (let i = 0; i < numSparkles; i++) {
    const x = Math.floor(8 + random() * (size - 16));
    const y = Math.floor(8 + random() * (size - 16));
    if (isInsideDiamond(x, y, size, 6)) {
      const pixel = getPixel(buffer, size, x, y);
      if (pixel.a > 0) setPixel(buffer, size, x, y, 255, 255, 255, pixel.a);
    }
  }

  return buffer;
}

module.exports = {
  generateGrassTile,
  generateStoneTile,
  generateCobblestoneTile,
  generateWaterTile,
  generateLavaTile,
  generateIceTile,
  generateSnowTile
};
