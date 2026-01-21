/**
 * Obstacle Sprite Generators
 * Consolidated obstacle generation functions
 */

const { createPixelBuffer, setPixel, getPixel, isInsideDiamond } = require('../utils/canvas');
const { OBSTACLE_PALETTES, hexToRgb, lightenColor, darkenColor } = require('../utils/palettes');
const { applyPaperTexture } = require('../utils/watercolor');
const { createSeededRandom, generateNoiseMap, voronoi } = require('../utils/noise');

// ============ TREES ============
function generateOakTree(size = 96, variant = 0) {
  const buffer = createPixelBuffer(size, size);
  const random = createSeededRandom(variant * 12345);
  const palette = OBSTACLE_PALETTES.trees.oak;

  const baseX = size / 2;
  const baseY = size - 4;

  // Draw trunk
  const trunkHeight = 25 + Math.floor(random() * 10);
  const trunkWidth = 6 + Math.floor(random() * 2);
  const trunkColor = hexToRgb(palette.trunk[0]);

  for (let y = baseY - trunkHeight; y <= baseY; y++) {
    const taper = 1 - ((baseY - y) / trunkHeight) * 0.3;
    const width = (trunkWidth / 2) * taper;
    for (let dx = -width; dx <= width; dx++) {
      const x = Math.round(baseX + dx);
      if (x >= 0 && x < size && y >= 0 && y < size) {
        const grain = Math.sin(y * 0.8 + dx * 0.3) * 0.15;
        const lightFactor = 1 - (dx / width) * 0.15;
        setPixel(buffer, size, x, y,
          Math.min(255, Math.round((trunkColor.r + grain * trunkColor.r) * lightFactor)),
          Math.min(255, Math.round((trunkColor.g + grain * trunkColor.g) * lightFactor)),
          Math.min(255, Math.round((trunkColor.b + grain * trunkColor.b) * lightFactor)), 255);
      }
    }
  }

  // Draw foliage - multiple overlapping circles
  const foliageY = baseY - trunkHeight - 5;
  const foliageRadius = 22 + Math.floor(random() * 8);
  const foliageColor = hexToRgb(palette.foliage[0]);
  const highlightColor = hexToRgb(palette.highlight[0]);
  const shadowColor = hexToRgb(darkenColor(palette.foliage[0], 0.2));

  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + random() * 0.5;
    const dist = foliageRadius * 0.4 * random();
    const cx = baseX + Math.cos(angle) * dist;
    const cy = foliageY + Math.sin(angle) * dist * 0.8;
    const r = foliageRadius * (0.5 + random() * 0.3);

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > r) continue;
        const x = Math.round(cx + dx);
        const y = Math.round(cy + dy);
        if (x >= 0 && x < size && y >= 0 && y < size) {
          const lightDot = (-dx / r * 0.7 - dy / r * 0.7);
          const noise = (random() - 0.5) * 20;
          let pr, pg, pb;
          if (lightDot > 0.6) { pr = highlightColor.r; pg = highlightColor.g; pb = highlightColor.b; }
          else if (lightDot < 0.4) { pr = shadowColor.r; pg = shadowColor.g; pb = shadowColor.b; }
          else { pr = foliageColor.r; pg = foliageColor.g; pb = foliageColor.b; }
          const edgeDist = 1 - d / r;
          const alpha = edgeDist < 0.1 ? Math.round(255 * edgeDist / 0.1) : 255;
          const existing = getPixel(buffer, size, x, y);
          if (existing.a < alpha) {
            setPixel(buffer, size, x, y,
              Math.max(0, Math.min(255, Math.round(pr + noise))),
              Math.max(0, Math.min(255, Math.round(pg + noise))),
              Math.max(0, Math.min(255, Math.round(pb + noise))), alpha);
          }
        }
      }
    }
  }

  applyPaperTexture(buffer, size, 0.08, variant);
  return buffer;
}

function generatePineTree(size = 80, variant = 0) {
  const buffer = createPixelBuffer(size, size);
  const random = createSeededRandom(variant * 23456);
  const palette = OBSTACLE_PALETTES.trees.pine;

  const baseX = size / 2;
  const baseY = size - 4;
  const trunkHeight = 20 + Math.floor(random() * 8);
  const trunkWidth = 4;
  const trunkColor = hexToRgb(palette.trunk[0]);

  // Trunk
  for (let y = baseY - trunkHeight; y <= baseY; y++) {
    for (let dx = -trunkWidth / 2; dx <= trunkWidth / 2; dx++) {
      const x = Math.round(baseX + dx);
      if (x >= 0 && x < size) setPixel(buffer, size, x, y, trunkColor.r, trunkColor.g, trunkColor.b, 255);
    }
  }

  // Pine foliage - triangular layers
  const foliageColor = hexToRgb(palette.foliage[0]);
  const highlightColor = hexToRgb(palette.highlight[0]);
  const foliageBaseY = baseY - 8;
  const foliageWidth = 20 + Math.floor(random() * 6);
  const foliageHeight = 45 + Math.floor(random() * 10);
  const numLayers = 3 + Math.floor(random() * 2);
  const layerHeight = foliageHeight / numLayers;

  for (let layer = 0; layer < numLayers; layer++) {
    const layerBaseY = foliageBaseY - layer * layerHeight * 0.7;
    const layerWidth = foliageWidth * (1 - layer * 0.25);
    const layerTop = layerBaseY - layerHeight;

    for (let y = layerTop; y <= layerBaseY; y++) {
      const progress = (y - layerTop) / layerHeight;
      const rowWidth = layerWidth * progress;
      for (let dx = -rowWidth / 2; dx <= rowWidth / 2; dx++) {
        const x = Math.round(baseX + dx);
        if (x >= 0 && x < size && y >= 0 && y < size) {
          const lightFactor = 1 - (dx / (rowWidth / 2 + 1)) * 0.2 - progress * 0.15;
          const noise = (random() - 0.5) * 15;
          const c = lightFactor > 0.9 ? highlightColor : foliageColor;
          setPixel(buffer, size, x, y,
            Math.max(0, Math.min(255, Math.round(c.r + noise))),
            Math.max(0, Math.min(255, Math.round(c.g + noise))),
            Math.max(0, Math.min(255, Math.round(c.b + noise))), 255);
        }
      }
    }
  }

  applyPaperTexture(buffer, size, 0.06, variant);
  return buffer;
}

function generateDeadTree(size = 72, variant = 0) {
  const buffer = createPixelBuffer(size, size);
  const random = createSeededRandom(variant * 34567);
  const palette = OBSTACLE_PALETTES.trees.dead;
  const trunkColor = hexToRgb(palette.trunk[0]);

  const baseX = size / 2;
  const baseY = size - 4;
  const height = 50 + Math.floor(random() * 15);
  const trunkWidth = 4 + Math.floor(random() * 2);

  // Main trunk
  for (let y = baseY - height * 0.7; y <= baseY; y++) {
    const taper = 1 - ((baseY - y) / (height * 0.7)) * 0.3;
    const width = (trunkWidth / 2) * taper;
    for (let dx = -width; dx <= width; dx++) {
      const x = Math.round(baseX + dx);
      if (x >= 0 && x < size && y >= 0 && y < size) {
        setPixel(buffer, size, x, y, trunkColor.r, trunkColor.g, trunkColor.b, 255);
      }
    }
  }

  // Branches
  const numBranches = 4 + Math.floor(random() * 3);
  const branchStartY = baseY - height * 0.4;
  for (let i = 0; i < numBranches; i++) {
    const startY = branchStartY - (i / numBranches) * height * 0.4;
    const side = (i % 2 === 0) ? 1 : -1;
    const angle = (0.3 + random() * 0.4) * side;
    const length = 8 + random() * 12;
    let x = baseX, y = startY;
    for (let d = 0; d < length; d++) {
      x += Math.cos(angle - Math.PI / 2) * 1.2;
      y += Math.sin(angle - Math.PI / 2) * 0.8 + 0.3;
      const px = Math.round(x), py = Math.round(y);
      if (px >= 0 && px < size && py >= 0 && py < size) {
        setPixel(buffer, size, px, py, trunkColor.r, trunkColor.g, trunkColor.b, 255);
      }
    }
  }

  applyPaperTexture(buffer, size, 0.1, variant);
  return buffer;
}

function generateMushroomLarge(size = 64, variant = 0) {
  const buffer = createPixelBuffer(size, size);
  const random = createSeededRandom(variant * 45678);
  const palette = OBSTACLE_PALETTES.trees.mushroom;

  const baseX = size / 2;
  const baseY = size - 4;
  const stemColor = hexToRgb(palette.stem[0]);
  const capColor = hexToRgb(palette.cap[0]);
  const spotColor = hexToRgb(palette.spots[0]);

  // Stem
  const stemWidth = 8;
  const stemHeight = 20;
  for (let y = baseY - stemHeight; y <= baseY; y++) {
    const bulge = Math.sin(((y - (baseY - stemHeight)) / stemHeight) * Math.PI) * 2;
    const width = stemWidth / 2 + bulge;
    for (let dx = -width; dx <= width; dx++) {
      const x = Math.round(baseX + dx);
      if (x >= 0 && x < size && y >= 0 && y < size) {
        const lightFactor = 1 - (dx / width) * 0.15;
        setPixel(buffer, size, x, y,
          Math.round(stemColor.r * lightFactor),
          Math.round(stemColor.g * lightFactor),
          Math.round(stemColor.b * lightFactor), 255);
      }
    }
  }

  // Cap
  const capWidth = 20;
  const capHeight = 12;
  const capY = baseY - stemHeight - capHeight / 2;
  for (let dy = -capHeight / 2; dy <= capHeight / 2; dy++) {
    const progress = (dy + capHeight / 2) / capHeight;
    const rowWidth = capWidth * Math.sin(progress * Math.PI);
    for (let dx = -rowWidth / 2; dx <= rowWidth / 2; dx++) {
      const x = Math.round(baseX + dx);
      const y = Math.round(capY + dy);
      if (x >= 0 && x < size && y >= 0 && y < size) {
        const lightFactor = 1 - progress * 0.3 - (dx / (rowWidth / 2 + 1)) * 0.1;
        setPixel(buffer, size, x, y,
          Math.round(capColor.r * lightFactor),
          Math.round(capColor.g * lightFactor),
          Math.round(capColor.b * lightFactor), 255);
      }
    }
  }

  // Spots
  const numSpots = 4 + Math.floor(random() * 3);
  for (let i = 0; i < numSpots; i++) {
    const angle = random() * Math.PI * 2;
    const dist = random() * capWidth * 0.3;
    const spotX = Math.round(baseX + Math.cos(angle) * dist);
    const spotY = Math.round(capY - capHeight * 0.2 + Math.sin(angle) * dist * 0.5);
    if (spotX >= 0 && spotX < size && spotY >= 0 && spotY < size) {
      const existing = getPixel(buffer, size, spotX, spotY);
      if (existing.a > 0 && existing.r > 100) {
        setPixel(buffer, size, spotX, spotY, spotColor.r, spotColor.g, spotColor.b, existing.a);
      }
    }
  }

  applyPaperTexture(buffer, size, 0.06, variant);
  return buffer;
}

function generateMountainPine(size = 72, variant = 0) {
  const buffer = generatePineTree(size, variant);
  const random = createSeededRandom(variant * 56789);
  const snowColor = hexToRgb('#f0f0f8');

  // Add snow on branches
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const pixel = getPixel(buffer, size, x, y);
      if (pixel.a > 0 && pixel.g > pixel.r * 0.8) {
        const above = y > 0 ? getPixel(buffer, size, x, y - 1) : { a: 0 };
        if (above.a === 0 || random() < 0.15) {
          const blend = 0.4 + random() * 0.3;
          setPixel(buffer, size, x, y,
            Math.round(pixel.r * (1 - blend) + snowColor.r * blend),
            Math.round(pixel.g * (1 - blend) + snowColor.g * blend),
            Math.round(pixel.b * (1 - blend) + snowColor.b * blend), pixel.a);
        }
      }
    }
  }

  return buffer;
}

// ============ ROCKS ============
function generateRockShape(buffer, size, cx, cy, width, height, colors, random) {
  const baseColor = hexToRgb(colors.base[0]);
  const highlightColor = hexToRgb(colors.highlight[0]);
  const shadowColor = hexToRgb(colors.shadow[0]);

  for (let i = 0; i < 4; i++) {
    const offsetX = (random() - 0.5) * width * 0.3;
    const offsetY = (random() - 0.5) * height * 0.2;
    const shapeWidth = width * (0.6 + random() * 0.4);
    const shapeHeight = height * (0.6 + random() * 0.4);
    const rx = shapeWidth / 2;
    const ry = shapeHeight / 2;
    const shapeCx = cx + offsetX;
    const shapeCy = cy + offsetY;

    for (let dy = -ry; dy <= ry; dy++) {
      for (let dx = -rx; dx <= rx; dx++) {
        const distSq = (dx / rx) ** 2 + (dy / ry) ** 2;
        if (distSq > 1) continue;
        const x = Math.round(shapeCx + dx);
        const y = Math.round(shapeCy + dy);
        if (x >= 0 && x < size && y >= 0 && y < size) {
          const nx = dx / rx;
          const ny = dy / ry;
          const lightDot = -nx * 0.7 - ny * 0.7;
          let r, g, b;
          if (lightDot > 0.3) {
            const t = (lightDot - 0.3) / 0.7;
            r = baseColor.r + (highlightColor.r - baseColor.r) * t;
            g = baseColor.g + (highlightColor.g - baseColor.g) * t;
            b = baseColor.b + (highlightColor.b - baseColor.b) * t;
          } else if (lightDot < -0.2) {
            const t = (-lightDot - 0.2) / 0.8;
            r = baseColor.r + (shadowColor.r - baseColor.r) * t;
            g = baseColor.g + (shadowColor.g - baseColor.g) * t;
            b = baseColor.b + (shadowColor.b - baseColor.b) * t;
          } else {
            r = baseColor.r; g = baseColor.g; b = baseColor.b;
          }
          const noise = (random() - 0.5) * 20;
          const edgeDist = 1 - Math.sqrt(distSq);
          const alpha = edgeDist < 0.1 ? Math.round(255 * edgeDist / 0.1) : 255;
          const existing = getPixel(buffer, size, x, y);
          if (existing.a < alpha) {
            setPixel(buffer, size, x, y,
              Math.max(0, Math.min(255, Math.round(r + noise))),
              Math.max(0, Math.min(255, Math.round(g + noise))),
              Math.max(0, Math.min(255, Math.round(b + noise))), alpha);
          }
        }
      }
    }
  }
}

function generateRockSmall(size = 32, variant = 0, type = 'granite') {
  const buffer = createPixelBuffer(size, size);
  const random = createSeededRandom(variant * 11111);
  const palette = OBSTACLE_PALETTES.rocks[type] || OBSTACLE_PALETTES.rocks.granite;
  generateRockShape(buffer, size, size / 2, size / 2 + 4, 16 + random() * 6, 12 + random() * 4, palette, random);
  applyPaperTexture(buffer, size, 0.08, variant);
  return buffer;
}

function generateRockMedium(size = 48, variant = 0, type = 'granite') {
  const buffer = createPixelBuffer(size, size);
  const random = createSeededRandom(variant * 22222);
  const palette = OBSTACLE_PALETTES.rocks[type] || OBSTACLE_PALETTES.rocks.granite;
  generateRockShape(buffer, size, size / 2, size / 2 + 6, 28 + random() * 8, 20 + random() * 6, palette, random);
  applyPaperTexture(buffer, size, 0.07, variant);
  return buffer;
}

function generateRockLarge(size = 64, variant = 0, type = 'granite') {
  const buffer = createPixelBuffer(size, size);
  const random = createSeededRandom(variant * 33333);
  const palette = OBSTACLE_PALETTES.rocks[type] || OBSTACLE_PALETTES.rocks.granite;
  generateRockShape(buffer, size, size / 2, size / 2 + 8, 40 + random() * 10, 32 + random() * 8, palette, random);
  applyPaperTexture(buffer, size, 0.06, variant);
  return buffer;
}

function generateStalagmite(size = 48, variant = 0) {
  const buffer = createPixelBuffer(size, size);
  const random = createSeededRandom(variant * 44444);
  const palette = OBSTACLE_PALETTES.rocks.granite;
  const baseColor = hexToRgb(palette.base[0]);
  const highlightColor = hexToRgb(palette.highlight[0]);

  const baseX = size / 2;
  const baseY = size - 4;
  const height = 35 + Math.floor(random() * 10);
  const baseWidth = 12 + Math.floor(random() * 4);

  for (let y = baseY; y >= baseY - height; y--) {
    const progress = (baseY - y) / height;
    const width = baseWidth * (1 - progress * 0.9);
    for (let dx = -width; dx <= width; dx++) {
      const x = Math.round(baseX + dx);
      if (x >= 0 && x < size && y >= 0 && y < size) {
        const lightFactor = 1 - (dx / (width + 1)) * 0.25;
        const c = lightFactor > 0.9 ? highlightColor : baseColor;
        const noise = (random() - 0.5) * 15;
        setPixel(buffer, size, x, y,
          Math.max(0, Math.min(255, Math.round(c.r + noise))),
          Math.max(0, Math.min(255, Math.round(c.g + noise))),
          Math.max(0, Math.min(255, Math.round(c.b + noise))), 255);
      }
    }
  }

  applyPaperTexture(buffer, size, 0.08, variant);
  return buffer;
}

function generateMountainBoulder(size = 56, variant = 0) {
  const buffer = generateRockLarge(size, variant, 'granite');
  const random = createSeededRandom(variant * 55555);
  const snowColor = hexToRgb('#e8e8f0');

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const pixel = getPixel(buffer, size, x, y);
      if (pixel.a === 0) continue;
      const above = y > 0 ? getPixel(buffer, size, x, y - 1) : { a: 0 };
      if ((above.a === 0 || y < size * 0.4) && random() < 0.3) {
        const blend = 0.5 + random() * 0.3;
        setPixel(buffer, size, x, y,
          Math.round(pixel.r * (1 - blend) + snowColor.r * blend),
          Math.round(pixel.g * (1 - blend) + snowColor.g * blend),
          Math.round(pixel.b * (1 - blend) + snowColor.b * blend), pixel.a);
      }
    }
  }

  return buffer;
}

module.exports = {
  generateOakTree,
  generatePineTree,
  generateDeadTree,
  generateMushroomLarge,
  generateMountainPine,
  generateRockSmall,
  generateRockMedium,
  generateRockLarge,
  generateStalagmite,
  generateMountainBoulder
};
