/**
 * Deterministic isometric material compiler.
 *
 * AI is useful for concepts, but independently generated diamond sprites cannot
 * guarantee matching borders, projection, palette, or readable silhouettes at
 * battle-map scale. This compiler turns tile metadata into a cohesive, retina
 * resolution material set with one geometry contract shared by the renderer.
 */

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const TILE_SPEC = Object.freeze({
  version: 3,
  logicalWidth: 64,
  logicalHeight: 64,
  logicalFootprintHeight: 32,
  sourceWidth: 128,
  sourceHeight: 128,
  sourceFootprintHeight: 64,
  wallSourceWidth: 128,
  wallSourceHeight: 32,
  projection: '2:1-diamond',
  anchor: 'center'
});

const BIOME_PALETTES = Object.freeze({
  base: {
    grass: ['#66834b', '#7c9860', '#465f38'],
    stone: ['#827d74', '#9b9588', '#5f5b55'],
    rock: ['#625a50', '#766b5d', '#443f3a'],
    forest: ['#4c5835', '#677148', '#343d29'],
    water: ['#3f7180', '#5f95a0', '#294f5e'],
    lava: ['#8e3421', '#f07832', '#421e1a'],
    cliff: ['#544f49', '#6c655b', '#373431'],
    tree: ['#55452f', '#725b3b', '#332b22'],
    wall: ['#68543e', '#826a4c', '#46382c']
  },
  forest: {
    grass: ['#5f7f45', '#83a45f', '#3d5933'],
    stone: ['#77786b', '#989b83', '#53564c'],
    rock: ['#5c5c50', '#757866', '#3e4239'],
    forest: ['#3f512f', '#657345', '#293823'],
    water: ['#397483', '#65a4a1', '#244f5d'],
    lava: ['#943822', '#f47a35', '#451e18'],
    cliff: ['#56584e', '#737768', '#393c35'],
    tree: ['#57442c', '#775e3a', '#32281f'],
    wall: ['#6b4f35', '#8a6b47', '#423125']
  },
  cave: {
    grass: ['#405f58', '#568378', '#2a403d'],
    stone: ['#555a5c', '#747b7c', '#353a3d'],
    rock: ['#474c50', '#62696d', '#292e32'],
    forest: ['#334b48', '#4f6a61', '#223432'],
    water: ['#284e61', '#477a89', '#182f3d'],
    lava: ['#8f3021', '#ff7334', '#391719'],
    cliff: ['#41474b', '#596064', '#252a2d'],
    tree: ['#494139', '#62594d', '#2b2723'],
    wall: ['#464a4c', '#606568', '#292d30']
  },
  mountain: {
    grass: ['#68765c', '#879579', '#485244'],
    stone: ['#777b7e', '#a0a6a8', '#555a5e'],
    rock: ['#656a6f', '#888e93', '#454b50'],
    forest: ['#4f5e50', '#70806c', '#344137'],
    water: ['#46798d', '#77aabd', '#2c5365'],
    lava: ['#963a24', '#ff8040', '#431d1a'],
    cliff: ['#5c6267', '#7b8288', '#3d4348'],
    tree: ['#514a3e', '#706759', '#302d28'],
    wall: ['#5c6166', '#7d848a', '#3d4246']
  },
  bridge: {
    grass: ['#667b4e', '#879767', '#46563b'],
    stone: ['#807568', '#a09280', '#5d5349'],
    rock: ['#655d55', '#81766a', '#463f3a'],
    forest: ['#55583d', '#747553', '#393b2c'],
    water: ['#376c82', '#5c95a7', '#214a61'],
    lava: ['#91341f', '#f47730', '#411b17'],
    cliff: ['#5d5750', '#797168', '#3d3935'],
    tree: ['#695035', '#8e6c46', '#402f23'],
    wall: ['#6f5135', '#966e47', '#443021']
  },
  castle: {
    grass: ['#62784d', '#849866', '#43543a'],
    stone: ['#737b82', '#9ba3a8', '#505860'],
    rock: ['#5c646a', '#7c858b', '#3e464c'],
    forest: ['#4d5844', '#6a755c', '#333c30'],
    water: ['#3c7083', '#6597a8', '#274e60'],
    lava: ['#91331f', '#f2742f', '#411a17'],
    cliff: ['#535c63', '#707a82', '#363e44'],
    tree: ['#544a3b', '#756653', '#322c25'],
    wall: ['#59636c', '#78858f', '#39434a']
  }
});

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function fract(value) {
  return value - Math.floor(value);
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hash2d(x, y, seed) {
  let value = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  value = (value ^ (value >>> 13) ^ seed) >>> 0;
  value = Math.imul(value, 1274126177) >>> 0;
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothstep(0, 1, fract(x));
  const ty = smoothstep(0, 1, fract(y));
  const a = hash2d(x0, y0, seed);
  const b = hash2d(x0 + 1, y0, seed);
  const c = hash2d(x0, y0 + 1, seed);
  const d = hash2d(x0 + 1, y0 + 1, seed);
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

function periodicValueNoise(x, y, seed, period) {
  const wrap = value => ((value % period) + period) % period;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothstep(0, 1, fract(x));
  const ty = smoothstep(0, 1, fract(y));
  const a = hash2d(wrap(x0), wrap(y0), seed);
  const b = hash2d(wrap(x0 + 1), wrap(y0), seed);
  const c = hash2d(wrap(x0), wrap(y0 + 1), seed);
  const d = hash2d(wrap(x0 + 1), wrap(y0 + 1), seed);
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

function tileableFbm(u, v, seed, octaves = 4) {
  let amplitude = 0.55;
  let total = 0;
  let weight = 0;
  for (let octave = 0; octave < octaves; octave++) {
    const period = 4 * (2 ** octave);
    total += periodicValueNoise(u * period, v * period, seed + octave * 1013, period) * amplitude;
    weight += amplitude;
    amplitude *= 0.48;
  }
  return total / weight;
}

function fbm(x, y, seed, octaves = 4) {
  let amplitude = 0.55;
  let frequency = 1;
  let total = 0;
  let weight = 0;
  for (let octave = 0; octave < octaves; octave++) {
    total += valueNoise(x * frequency, y * frequency, seed + octave * 1013) * amplitude;
    weight += amplitude;
    amplitude *= 0.48;
    frequency *= 2.03;
  }
  return total / weight;
}

function parseHex(hex) {
  const normalized = hex.replace('#', '');
  const value = Number.parseInt(normalized, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function mixColor(a, b, amount) {
  return [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount
  ];
}

function scaleColor(color, amount) {
  return color.map(channel => clamp(channel * amount, 0, 255));
}

function inferMaterial(asset) {
  const text = `${asset.key || asset.id || ''} ${asset.terrain || ''} ${asset.prompt || ''}`.toLowerCase();
  if (/lava|magma|ember|scorch/.test(text)) return 'lava';
  if (/water|stream|pool|river|brook|pond|wet/.test(text)) return 'water';
  if (/snow/.test(text)) return 'snow';
  if (/ice|frost|glacial/.test(text)) return 'ice';
  if (/carpet|runner/.test(text)) return 'carpet';
  if (/plank|timber|wooden|wood grain|rope bridge/.test(text)) return 'plank';
  if (/crystal|gem|mineral vein/.test(text)) return 'crystal';
  if (/cobble|flagstone|brick|tile|marble|pavement|stone/.test(text)) return 'stone';
  if (/rock|cliff|boulder|stalag|gravel/.test(text)) return 'rock';
  if (/forest|leaf|fern|moss|grass|lichen|root|mushroom/.test(text)) return asset.terrain === 'grass' ? 'grass' : 'forest';
  if (/tree|bark|trunk/.test(text)) return 'tree';
  return asset.terrain || 'grass';
}

function getPalette(biome, terrain, material) {
  const palette = BIOME_PALETTES[biome] || BIOME_PALETTES.base;
  const fallback = BIOME_PALETTES.base;
  const key = palette[terrain] ? terrain : palette[material] ? material : 'wall';
  return (palette[key] || fallback[key] || fallback.wall).map(parseHex);
}

function getBoundaryPalette(biome, terrain) {
  const palette = BIOME_PALETTES[biome] || BIOME_PALETTES.base;
  const fallback = BIOME_PALETTES.base;
  // Prompt-inferred materials are intentionally excluded: metadata variants
  // may describe different interior details, while a terrain's boundary must
  // remain byte-identical. Unknown terrains use the biome's stable wall tones.
  return (palette[terrain] || fallback[terrain] || palette.wall || fallback.wall).map(parseHex);
}

function inferWallPattern(asset, biome, material = inferMaterial(asset)) {
  const descriptor = `${asset.key || asset.id || ''} ${asset.terrain || ''} ${asset.prompt || ''}`.toLowerCase();
  const timber = material === 'plank' || material === 'tree' ||
    /\b(?:timber|wooden|wood|beam|rampart|trunk|bark|rope|hemp)\b/.test(descriptor);
  if (timber) return 'timber';

  const masonry = biome === 'castle' ||
    /\b(?:brick|masonry|mortar|dungeon|abutment)\b|(?:fitted|carved|cut) (?:stone|blocks?)/.test(descriptor);
  return masonry ? 'masonry' : 'strata';
}

function applyMaterialPattern(color, context) {
  const { material, u, v, x, y, seed, variantSeed, interior } = context;
  const dark = context.palette[2];
  const light = context.palette[1];
  let result = color;

  if (material === 'water') {
    const wave = Math.sin((u * 11 + v * 4) * Math.PI * 2 + (variantSeed % 17) * 0.31);
    const ripple = Math.pow(Math.max(0, wave), 12) * interior;
    result = mixColor(result, light, 0.34 * ripple);
  } else if (material === 'lava') {
    const fissureNoise = fbm(u * 7 + 3, v * 7 - 2, seed + 701, 3);
    const fissure = smoothstep(0.06, 0, Math.abs(fissureNoise - 0.51)) * interior;
    result = mixColor(result, light, 0.82 * fissure);
    result = mixColor(result, [255, 190, 68], 0.35 * smoothstep(0.55, 0.95, fissure));
  } else if (material === 'stone' || material === 'carpet') {
    const columns = material === 'carpet' ? 5 : 4;
    const rows = material === 'carpet' ? 8 : 5;
    const row = Math.floor(v * rows);
    const shiftedU = fract(u * columns + (row % 2) * 0.5);
    const shiftedV = fract(v * rows);
    const joint = Math.min(shiftedU, 1 - shiftedU, shiftedV, 1 - shiftedV);
    const mortar = smoothstep(0.035, 0.005, joint) * interior;
    result = mixColor(result, dark, (material === 'carpet' ? 0.28 : 0.48) * mortar);
    if (material === 'carpet') result = mixColor(result, [112, 29, 31], 0.58);
  } else if (material === 'plank' || material === 'tree') {
    const board = fract(v * 6);
    const seam = smoothstep(0.055, 0.006, Math.min(board, 1 - board)) * interior;
    const grain = (Math.sin((u * 17 + fbm(u * 4, v * 4, seed, 2) * 2) * Math.PI) + 1) * 0.5;
    result = mixColor(result, dark, seam * 0.55 + grain * 0.08 * interior);
  } else if (material === 'rock' || material === 'ice' || material === 'crystal') {
    const ridge = Math.abs(fbm(u * 8 + 7, v * 8 - 5, seed + 911, 3) - 0.5);
    const crack = smoothstep(0.035, 0.006, ridge) * interior;
    result = mixColor(result, dark, crack * (material === 'ice' ? 0.28 : 0.52));
    if (material === 'ice' || material === 'crystal') {
      const glint = Math.pow(hash2d(Math.floor(x / 6), Math.floor(y / 5), variantSeed), 18) * interior;
      result = mixColor(result, [190, 238, 245], glint * 0.7);
    }
  } else if (material === 'grass' || material === 'forest') {
    const cellX = Math.floor(u * 18);
    const cellY = Math.floor(v * 18);
    const fleck = hash2d(cellX, cellY, variantSeed);
    const localX = fract(u * 18);
    const localY = fract(v * 18);
    const mark = fleck > 0.84 && Math.abs(localX - 0.5) < 0.07 && localY > 0.22 && localY < 0.78;
    if (mark) result = mixColor(result, fleck > 0.94 ? light : dark, 0.42 * interior);
    if (material === 'forest') result = mixColor(result, dark, 0.12 * interior);
  } else if (material === 'snow') {
    const sparkle = Math.pow(hash2d(Math.floor(x / 5), Math.floor(y / 5), variantSeed), 24) * interior;
    result = mixColor(result, [245, 249, 242], 0.65 + sparkle * 0.25);
  }

  return result;
}

function createFloorBuffer(asset, biome) {
  const width = TILE_SPEC.sourceWidth;
  const height = TILE_SPEC.sourceHeight;
  const footprintHeight = TILE_SPEC.sourceFootprintHeight;
  const halfW = width / 2;
  const halfH = footprintHeight / 2;
  const centerY = height / 2;
  const terrain = asset.terrain || (asset.key || '').split('_')[0] || 'grass';
  const material = inferMaterial(asset);
  const palette = getPalette(biome, terrain, material);
  const boundaryPalette = getBoundaryPalette(biome, terrain);
  // Every variant for a terrain shares its boundary field. Interior material
  // detail may vary, but edge pixels must be identical for seamless adjacency.
  const commonSeed = hashString(`${biome}:${terrain}:edge-v${TILE_SPEC.version}`);
  const variantSeed = hashString(`${biome}:${asset.key || asset.id}:${asset.seed || 0}`);
  const buffer = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = (x + 0.5 - halfW) / halfW;
      const ny = (y + 0.5 - centerY) / halfH;
      const signedEdge = 1 - Math.abs(nx) - Math.abs(ny);
      if (signedEdge < -0.025) continue;

      const alpha = Math.round(255 * smoothstep(-0.018, 0.018, signedEdge));
      const u = clamp((ny + nx + 1) / 2);
      const v = clamp((ny - nx + 1) / 2);
      const interior = smoothstep(0.06, 0.28, signedEdge);
      const sharedWash = tileableFbm(u, v, commonSeed, 4);
      const variantWash = fbm(u * 7.5 + 11, v * 7.5 - 7, variantSeed, 3);
      const pigment = (sharedWash - 0.5) * 0.23 + (variantWash - 0.5) * 0.14 * interior;
      const paper = (hash2d(x, y, commonSeed + 31) - 0.5) * 0.035;
      const lightDirection = ((1 - nx) * 0.5 + (1 - ny) * 0.25) * 0.07;
      let color = mixColor(palette[0], palette[1], clamp(0.18 + sharedWash * 0.34));
      color = scaleColor(color, 1 + pigment + (paper + lightDirection) * interior);
      color = applyMaterialPattern(color, {
        material, terrain, palette, u, v, x, y,
        seed: commonSeed, variantSeed, interior
      });

      // Every variant converges on the same restrained boundary material. This
      // prevents bright seams and keeps the battlefield readable as one surface.
      const boundaryColor = scaleColor(
        mixColor(boundaryPalette[0], boundaryPalette[1], clamp(0.18 + sharedWash * 0.34)),
        1 + (sharedWash - 0.5) * 0.23
      );
      color = mixColor(boundaryColor, color, interior);

      const offset = (y * width + x) * 4;
      buffer[offset] = Math.round(clamp(color[0], 0, 255));
      buffer[offset + 1] = Math.round(clamp(color[1], 0, 255));
      buffer[offset + 2] = Math.round(clamp(color[2], 0, 255));
      buffer[offset + 3] = alpha;
    }
  }

  return buffer;
}

function createWallBuffer(asset, biome) {
  const width = TILE_SPEC.wallSourceWidth;
  const height = TILE_SPEC.wallSourceHeight;
  const terrain = asset.terrain || 'wall';
  const material = inferMaterial(asset);
  const palette = getPalette(biome, terrain === 'default' ? 'wall' : terrain, material);
  const seed = hashString(`${biome}:${asset.key || asset.id}:wall-v${TILE_SPEC.version}`);
  const buffer = Buffer.alloc(width * height * 4);
  const pattern = inferWallPattern(asset, biome, material);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Sample pixel centers from a periodic field. Wall strips are repeated
      // both along a face and once per elevation level, so both axes must meet
      // without a lighting or noise discontinuity at the wrap boundary.
      const u = (x + 0.5) / width;
      const v = (y + 0.5) / height;
      const wash = tileableFbm(u, v, seed, 4);
      let color = mixColor(palette[0], palette[1], 0.1 + wash * 0.32);
      const diffuse = 0.9 + Math.cos(v * Math.PI * 2) * 0.035;
      color = scaleColor(color, diffuse);

      if (pattern === 'masonry') {
        const rows = 3;
        const columns = 5;
        const row = Math.floor(v * rows);
        const brickU = fract(u * columns + (row % 2) * 0.5);
        const brickV = fract(v * rows);
        const joint = Math.min(brickU, 1 - brickU, brickV, 1 - brickV);
        color = mixColor(color, palette[2], smoothstep(0.08, 0.015, joint) * 0.55);
      } else if (pattern === 'timber') {
        const seam = Math.min(fract(u * 5), 1 - fract(u * 5));
        color = mixColor(color, palette[2], smoothstep(0.05, 0.01, seam) * 0.48);
        const grain = (Math.sin((v * 10 + wash * 2) * Math.PI) + 1) * 0.5;
        color = mixColor(color, palette[2], grain * 0.08);
      } else {
        const stratumNoise = tileableFbm(u, v, seed + 91, 2);
        const stratum = (Math.sin((v * 8 + stratumNoise * 2) * Math.PI) + 1) * 0.5;
        color = mixColor(color, palette[2], stratum * 0.15);
      }

      const offset = (y * width + x) * 4;
      buffer[offset] = Math.round(clamp(color[0], 0, 255));
      buffer[offset + 1] = Math.round(clamp(color[1], 0, 255));
      buffer[offset + 2] = Math.round(clamp(color[2], 0, 255));
      buffer[offset + 3] = 255;
    }
  }

  return buffer;
}

function createSlopeBuffer(asset, biome) {
  const floorAsset = {
    ...asset,
    terrain: /bridge/.test(asset.key || '') ? 'tree' : /castle|cave|mountain/.test(asset.key || '') ? 'stone' : 'grass'
  };
  const buffer = createFloorBuffer(floorAsset, biome);
  const width = TILE_SPEC.sourceWidth;
  const height = TILE_SPEC.sourceHeight;
  const direction = asset.direction || 'north';
  const isStairs = asset.type === 'stairs' || String(asset.key).startsWith('stairs_');
  const accent = getPalette(biome, floorAsset.terrain, inferMaterial(floorAsset))[2];

  // Directional contour bands make otherwise unused slope assets immediately
  // legible in the admin preview and ready for future traversal rendering.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if (buffer[offset + 3] === 0) continue;
      const nx = (x - width / 2) / (width / 2);
      const ny = (y - height / 2) / (TILE_SPEC.sourceFootprintHeight / 2);
      const axis = direction === 'north' ? ny : direction === 'south' ? -ny : direction === 'east' ? nx : -nx;
      const bands = isStairs ? 6 : 3;
      const line = Math.abs(fract((axis + 1) * bands * 0.5) - 0.5);
      if (line < (isStairs ? 0.09 : 0.035)) {
        buffer[offset] = Math.round(buffer[offset] * 0.55 + accent[0] * 0.45);
        buffer[offset + 1] = Math.round(buffer[offset + 1] * 0.55 + accent[1] * 0.45);
        buffer[offset + 2] = Math.round(buffer[offset + 2] * 0.55 + accent[2] * 0.45);
      }
    }
  }
  return buffer;
}

function getCompiledOutputPath(outputDir, asset, biome) {
  return path.join(outputDir, biome, `${asset.key || asset.id}.webp`);
}

async function compileTileAsset(asset, biome, outputPath, options = {}) {
  const category = asset._tileCategory || asset.category || 'floors';
  let buffer;
  let width;
  let height;

  if (category === 'walls') {
    buffer = createWallBuffer(asset, biome);
    width = TILE_SPEC.wallSourceWidth;
    height = TILE_SPEC.wallSourceHeight;
  } else if (category === 'slopes') {
    buffer = createSlopeBuffer(asset, biome);
    width = TILE_SPEC.sourceWidth;
    height = TILE_SPEC.sourceHeight;
  } else {
    buffer = createFloorBuffer(asset, biome);
    width = TILE_SPEC.sourceWidth;
    height = TILE_SPEC.sourceHeight;
  }

  if (options.dryRun) {
    return { success: true, outputPath, width, height, dryRun: true };
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await sharp(buffer, { raw: { width, height, channels: 4 } })
    .webp({ lossless: true, effort: 6 })
    .toFile(outputPath);

  return { success: true, outputPath, width, height };
}

module.exports = {
  TILE_SPEC,
  BIOME_PALETTES,
  inferMaterial,
  inferWallPattern,
  getCompiledOutputPath,
  compileTileAsset,
  // Exported for focused tests.
  createFloorBuffer,
  createWallBuffer,
  createSlopeBuffer
};
