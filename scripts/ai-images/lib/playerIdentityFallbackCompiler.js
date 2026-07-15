'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const COMPILER_VERSION = '1.1.0';
const SOURCE_SIZE = 64;
const OUTPUT_SIZE = 512;
const ALPHA_THRESHOLD = 8;
const DEFAULT_REGISTRY = 'ai-image-metadata/characters/player-variants.json';
const DEFAULT_PROVENANCE = 'ai-image-metadata/characters/player-identity-fallbacks.json';

const CLASS_SIGNATURES = Object.freeze({
  warrior: 'longsword-and-kite-shield',
  wizard: 'crystal-staff-and-arcane-robe',
  monk: 'wrapped-fists-and-prayer-beads',
  chemist: 'potion-flask-vials-and-satchel',
  berserker: 'paired-battle-axes-and-spikes',
  paladin: 'holy-sword-cross-shield-and-cape',
  guardian: 'tower-shield-and-heavy-plate',
  warlord: 'command-banner-and-polearm',
  sorcerer: 'crackling-orb-and-dark-cowl',
  summoner: 'open-grimoire-and-bound-wisps',
  conjurer: 'crystal-staff-and-elemental-orbs',
  oracle: 'blindfold-and-prophetic-runes',
  ninja: 'face-mask-kunai-and-shadow-cloth',
  martial_artist: 'gi-headband-and-guarded-fists',
  brawler: 'spiked-gauntlets-and-rugged-vest',
  ascetic: 'prayer-beads-and-spiritual-aura',
  alchemist: 'goggles-vial-bandolier-and-bomb',
  medic: 'white-coat-medical-cross-and-satchel',
  plague_doctor: 'beaked-mask-censer-and-dark-coat',
  artificer: 'goggles-mechanical-arm-and-gears'
});

const RACE_PROFILES = Object.freeze({
  human: Object.freeze({ top: 7, bottom: 59, headWidth: 18, headHeight: 18, shoulderWidth: 20, hipWidth: 13 }),
  elf: Object.freeze({ top: 5, bottom: 59, headWidth: 17, headHeight: 18, shoulderWidth: 18, hipWidth: 12 }),
  dwarf: Object.freeze({ top: 10, bottom: 59, headWidth: 21, headHeight: 19, shoulderWidth: 24, hipWidth: 17 }),
  vampire: Object.freeze({ top: 6, bottom: 59, headWidth: 18, headHeight: 18, shoulderWidth: 19, hipWidth: 12 }),
  orc: Object.freeze({ top: 6, bottom: 59, headWidth: 21, headHeight: 19, shoulderWidth: 25, hipWidth: 16 })
});

const GENDER_PROFILES = Object.freeze({
  male: Object.freeze({ shoulderDelta: 2, hipDelta: 0, torsoTaper: 3 }),
  female: Object.freeze({ shoulderDelta: 0, hipDelta: 2, torsoTaper: 4 }),
  other: Object.freeze({ shoulderDelta: 0, hipDelta: 1, torsoTaper: 3 })
});

const RACE_SKIN = Object.freeze({
  human: Object.freeze([210, 151, 116, 255]),
  elf: Object.freeze([225, 177, 145, 255]),
  dwarf: Object.freeze([215, 148, 104, 255]),
  vampire: Object.freeze([210, 198, 206, 255]),
  orc: Object.freeze([112, 157, 78, 255])
});

const ANCHOR_PATHS = Object.freeze({
  dwarf_female: 'ai-image-metadata/characters/reference-anchors/dwarf_female_neutral.png',
  dwarf_other: 'ai-image-metadata/characters/reference-anchors/dwarf_other_neutral.png'
});

const ANCHOR_REASONS = Object.freeze({
  dwarf_female: 'The canonical dwarf-female portrait cohort is strongly male-coded and contradicts female identity metadata; the approved neutral anchor supplies the feminine face and full-body silhouette while each class portrait remains the palette and costume-cue source.',
  dwarf_other: 'The canonical dwarf-other portrait cohort is strongly male-coded and contradicts androgynous identity metadata; the approved neutral anchor supplies the androgynous face and full-body silhouette while each class portrait remains the palette and costume-cue source.'
});

const SEMANTIC_COLORS = Object.freeze({
  glass: Object.freeze([98, 225, 176, 255]),
  magic: Object.freeze([111, 190, 255, 255]),
  holy: Object.freeze([255, 224, 111, 255]),
  poison: Object.freeze([133, 215, 74, 255]),
  medic: Object.freeze([230, 64, 71, 255]),
  metal: Object.freeze([194, 207, 219, 255]),
  brass: Object.freeze([218, 157, 61, 255]),
  leather: Object.freeze([112, 70, 45, 255]),
  outline: Object.freeze([23, 19, 29, 255]),
  white: Object.freeze([235, 237, 229, 255])
});

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function clamp(value, minimum = 0, maximum = 255) {
  return Math.max(minimum, Math.min(maximum, value));
}

function color(values, alpha = 255) {
  return [clamp(Math.round(values[0])), clamp(Math.round(values[1])), clamp(Math.round(values[2])), alpha];
}

function shade(input, factor) {
  return color(input.map((value, index) => index < 3 ? value * factor : value));
}

function mix(first, second, amount) {
  return color(first.map((value, index) => index < 3 ? value + ((second[index] - value) * amount) : value));
}

function distance(first, second) {
  return Math.sqrt(
    ((first[0] - second[0]) ** 2) +
    ((first[1] - second[1]) ** 2) +
    ((first[2] - second[2]) ** 2)
  );
}

function relativePath(projectRoot, absolutePath) {
  return path.relative(projectRoot, absolutePath).split(path.sep).join('/');
}

function canonicalOutputPath(projectRoot, variant) {
  return path.join(
    projectRoot,
    'frontend/public/assets/characters/player',
    variant.race,
    variant.gender,
    variant.class,
    `${variant.id}_reference.png`
  );
}

function resolveAssetPath(projectRoot, assetPath) {
  if (!assetPath) throw new Error('Variant has no portraitReference.');
  if (path.isAbsolute(assetPath) && !assetPath.startsWith('/assets/')) return assetPath;
  const normalized = assetPath.replace(/^\/+/, '');
  if (normalized.startsWith('assets/')) return path.join(projectRoot, 'frontend/public', normalized);
  return path.resolve(projectRoot, normalized);
}

function findAlphaBounds(data, width, height, channels = 4, threshold = ALPHA_THRESHOLD) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let alphaPixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[((y * width) + x) * channels + 3];
      if (alpha <= threshold) continue;
      alphaPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    alphaPixels
  };
}

function borderPixelIndexes(width, height) {
  const indexes = [];
  for (let x = 0; x < width; x += 1) indexes.push(x);
  for (let y = 1; y < height; y += 1) indexes.push(y * width + (width - 1));
  if (height > 1) {
    for (let x = width - 2; x >= 0; x -= 1) indexes.push((height - 1) * width + x);
  }
  if (width > 1) {
    for (let y = height - 2; y > 0; y -= 1) indexes.push(y * width);
  }
  return indexes;
}

function estimateBorderMatte(data, width, height, channels = 4) {
  const indexes = borderPixelIndexes(width, height);
  const clusters = new Map();
  for (const pixelIndex of indexes) {
    const offset = pixelIndex * channels;
    const key = [data[offset], data[offset + 1], data[offset + 2]]
      .map(value => Math.floor(value / 16))
      .join(',');
    const cluster = clusters.get(key) || { count: 0, samples: [] };
    cluster.count += 1;
    cluster.samples.push([data[offset], data[offset + 1], data[offset + 2]]);
    clusters.set(key, cluster);
  }
  const dominant = [...clusters.entries()]
    .sort((first, second) => second[1].count - first[1].count || first[0].localeCompare(second[0]))[0]?.[1];
  if (!dominant) return null;

  const median = channel => {
    const values = dominant.samples.map(sample => sample[channel]).sort((first, second) => first - second);
    return values[Math.floor(values.length / 2)];
  };
  const background = [median(0), median(1), median(2)];
  const deviations = dominant.samples
    .map(sample => Math.max(
      Math.abs(sample[0] - background[0]),
      Math.abs(sample[1] - background[1]),
      Math.abs(sample[2] - background[2])
    ))
    .sort((first, second) => first - second);
  const percentile95 = deviations[Math.floor((deviations.length - 1) * 0.95)] || 0;
  return {
    background,
    coverage: dominant.count / indexes.length,
    tolerance: clamp(percentile95 + 12, 12, 30)
  };
}

/**
 * Remove only matte-colored pixels reachable from the outer image edge. Interior
 * whites (eyes, costume, highlights) remain opaque because outlines disconnect
 * them from the border. Images that already contain transparency are returned
 * byte-for-byte unchanged so approved cutouts are never reinterpreted.
 */
function removeEdgeConnectedMatte(data, width, height, channels = 4) {
  if (channels < 4) throw new Error('Edge-connected matte removal requires RGBA pixels.');
  for (let offset = 3; offset < data.length; offset += channels) {
    if (data[offset] < 255) {
      return {
        data,
        bounds: findAlphaBounds(data, width, height, channels),
        applied: false,
        reason: 'source-already-transparent',
        removedPixels: 0,
        background: null,
        tolerance: null
      };
    }
  }

  const estimate = estimateBorderMatte(data, width, height, channels);
  if (!estimate || estimate.coverage < 0.2) {
    return {
      data,
      bounds: findAlphaBounds(data, width, height, channels),
      applied: false,
      reason: 'no-dominant-border-matte',
      removedPixels: 0,
      background: estimate?.background || null,
      tolerance: estimate?.tolerance || null
    };
  }

  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let queueStart = 0;
  let queueEnd = 0;
  const matchesMatte = pixelIndex => {
    const offset = pixelIndex * channels;
    return Math.max(
      Math.abs(data[offset] - estimate.background[0]),
      Math.abs(data[offset + 1] - estimate.background[1]),
      Math.abs(data[offset + 2] - estimate.background[2])
    ) <= estimate.tolerance;
  };
  const enqueue = pixelIndex => {
    if (visited[pixelIndex] || !matchesMatte(pixelIndex)) return;
    visited[pixelIndex] = 1;
    queue[queueEnd] = pixelIndex;
    queueEnd += 1;
  };
  for (const pixelIndex of borderPixelIndexes(width, height)) enqueue(pixelIndex);

  while (queueStart < queueEnd) {
    const pixelIndex = queue[queueStart];
    queueStart += 1;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    if (x > 0) enqueue(pixelIndex - 1);
    if (x + 1 < width) enqueue(pixelIndex + 1);
    if (y > 0) enqueue(pixelIndex - width);
    if (y + 1 < height) enqueue(pixelIndex + width);
  }

  if (queueEnd === 0) {
    return {
      data,
      bounds: findAlphaBounds(data, width, height, channels),
      applied: false,
      reason: 'border-does-not-match-dominant-matte',
      removedPixels: 0,
      background: estimate.background,
      tolerance: estimate.tolerance
    };
  }

  const output = Buffer.from(data);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    if (!visited[pixelIndex]) continue;
    const offset = pixelIndex * channels;
    output[offset] = 0;
    output[offset + 1] = 0;
    output[offset + 2] = 0;
    output[offset + 3] = 0;
  }
  return {
    data: output,
    bounds: findAlphaBounds(output, width, height, channels),
    applied: true,
    reason: 'edge-connected-dominant-matte',
    removedPixels: queueEnd,
    background: estimate.background,
    tolerance: estimate.tolerance
  };
}

function prepareImageMatte(image) {
  if (image.matte) return image;
  const matte = removeEdgeConnectedMatte(image.data, image.info.width, image.info.height, image.info.channels);
  if (!matte.bounds) throw new Error('Image has no visible pixels after edge-connected matte removal.');
  return { ...image, data: matte.data, bounds: matte.bounds, matte };
}

class PixelCanvas {
  constructor(width = SOURCE_SIZE, height = SOURCE_SIZE) {
    this.width = width;
    this.height = height;
    this.data = Buffer.alloc(width * height * 4);
  }

  blendPixel(x, y, rgba) {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height || rgba[3] <= 0) return;
    const offset = ((py * this.width) + px) * 4;
    const incoming = rgba[3] / 255;
    const existing = this.data[offset + 3] / 255;
    const combined = incoming + (existing * (1 - incoming));
    if (combined <= 0) return;
    for (let channel = 0; channel < 3; channel += 1) {
      this.data[offset + channel] = Math.round(
        ((rgba[channel] * incoming) + (this.data[offset + channel] * existing * (1 - incoming))) / combined
      );
    }
    this.data[offset + 3] = Math.round(combined * 255);
  }

  rect(x, y, width, height, rgba) {
    for (let py = Math.round(y); py < Math.round(y + height); py += 1) {
      for (let px = Math.round(x); px < Math.round(x + width); px += 1) this.blendPixel(px, py, rgba);
    }
  }

  ellipse(cx, cy, rx, ry, rgba) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y += 1) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x += 1) {
        const normalized = (((x - cx) / rx) ** 2) + (((y - cy) / ry) ** 2);
        if (normalized <= 1) this.blendPixel(x, y, rgba);
      }
    }
  }

  polygon(points, rgba) {
    const minY = Math.floor(Math.min(...points.map(point => point[1])));
    const maxY = Math.ceil(Math.max(...points.map(point => point[1])));
    for (let y = minY; y <= maxY; y += 1) {
      const intersections = [];
      for (let index = 0; index < points.length; index += 1) {
        const first = points[index];
        const second = points[(index + 1) % points.length];
        if ((first[1] <= y && second[1] > y) || (second[1] <= y && first[1] > y)) {
          intersections.push(first[0] + (((y - first[1]) * (second[0] - first[0])) / (second[1] - first[1])));
        }
      }
      intersections.sort((a, b) => a - b);
      for (let index = 0; index + 1 < intersections.length; index += 2) {
        for (let x = Math.ceil(intersections[index]); x <= Math.floor(intersections[index + 1]); x += 1) {
          this.blendPixel(x, y, rgba);
        }
      }
    }
  }

  line(x0, y0, x1, y1, rgba, thickness = 1) {
    let x = Math.round(x0);
    let y = Math.round(y0);
    const targetX = Math.round(x1);
    const targetY = Math.round(y1);
    const dx = Math.abs(targetX - x);
    const sx = x < targetX ? 1 : -1;
    const dy = -Math.abs(targetY - y);
    const sy = y < targetY ? 1 : -1;
    let error = dx + dy;
    const radius = Math.floor((thickness - 1) / 2);
    while (true) {
      for (let oy = -radius; oy <= radius; oy += 1) {
        for (let ox = -radius; ox <= radius; ox += 1) this.blendPixel(x + ox, y + oy, rgba);
      }
      if (x === targetX && y === targetY) break;
      const doubled = 2 * error;
      if (doubled >= dy) { error += dy; x += sx; }
      if (doubled <= dx) { error += dx; y += sy; }
    }
  }

  outlinePolygon(points, fill, outline = SEMANTIC_COLORS.outline, inset = 1) {
    this.polygon(points, outline);
    const centerX = points.reduce((sum, point) => sum + point[0], 0) / points.length;
    const centerY = points.reduce((sum, point) => sum + point[1], 0) / points.length;
    const inner = points.map(([x, y]) => [
      x + Math.sign(centerX - x) * inset,
      y + Math.sign(centerY - y) * inset
    ]);
    this.polygon(inner, fill);
  }

  compositeRaw(raw, width, height, left, top, transform) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = ((y * width) + x) * 4;
        let rgba = [raw[offset], raw[offset + 1], raw[offset + 2], raw[offset + 3]];
        if (transform) rgba = transform(rgba, x, y);
        this.blendPixel(left + x, top + y, rgba);
      }
    }
  }
}

function quantizePixelArt(raw) {
  const output = Buffer.from(raw);
  for (let offset = 0; offset < output.length; offset += 4) {
    const alpha = output[offset + 3];
    if (alpha < 96) {
      output[offset] = 0;
      output[offset + 1] = 0;
      output[offset + 2] = 0;
      output[offset + 3] = 0;
      continue;
    }
    output[offset] = clamp(Math.round(output[offset] / 24) * 24);
    output[offset + 1] = clamp(Math.round(output[offset + 1] / 24) * 24);
    output[offset + 2] = clamp(Math.round(output[offset + 2] / 24) * 24);
    output[offset + 3] = 255;
  }
  return output;
}

function isSkinLike(red, green, blue) {
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  return red > 75 && green > 38 && blue > 20 && red >= green && green >= blue * 0.72 && maximum - minimum > 18;
}

function extractPalette(data, info, bounds) {
  const counts = new Map();
  const startY = Math.round(bounds.minY + (bounds.height * 0.47));
  for (let y = startY; y <= bounds.maxY; y += 2) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 2) {
      const offset = ((y * info.width) + x) * info.channels;
      if (data[offset + 3] < 128) continue;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const luminance = (red * 0.299) + (green * 0.587) + (blue * 0.114);
      if (luminance < 24 || luminance > 242 || isSkinLike(red, green, blue)) continue;
      const quantized = [
        clamp(Math.round(red / 32) * 32),
        clamp(Math.round(green / 32) * 32),
        clamp(Math.round(blue / 32) * 32),
        255
      ];
      const key = quantized.slice(0, 3).join(',');
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  const ranked = [...counts.entries()]
    .sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0]))
    .map(([key]) => [...key.split(',').map(Number), 255]);
  const saturation = candidate => Math.max(...candidate.slice(0, 3)) - Math.min(...candidate.slice(0, 3));
  const luminance = candidate => (candidate[0] * 0.299) + (candidate[1] * 0.587) + (candidate[2] * 0.114);
  // Portraits frequently contain large black sleeves or white page margins. Prefer the
  // first genuinely chromatic costume color so the tiny sprite retains its class palette.
  const primary = ranked.find(candidate => saturation(candidate) >= 28 && luminance(candidate) >= 42 && luminance(candidate) <= 222)
    || ranked.find(candidate => luminance(candidate) >= 42 && luminance(candidate) <= 222)
    || ranked[0]
    || [72, 104, 144, 255];
  const secondary = ranked.find(candidate => distance(candidate, primary) > 72) || shade(primary, 0.62);
  const accent = ranked
    .slice(0, 24)
    .sort((first, second) => {
      return saturation(second) - saturation(first);
    })[0] || shade(primary, 1.35);

  return {
    primary: color(primary),
    secondary: color(secondary),
    accent: color(accent),
    dark: shade(primary, 0.48),
    light: mix(primary, SEMANTIC_COLORS.white, 0.42)
  };
}

async function loadImage(pathname) {
  const source = await fs.promises.readFile(pathname);
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bounds = findAlphaBounds(data, info.width, info.height, info.channels);
  if (!bounds) throw new Error(`Image has no visible pixels: ${pathname}`);
  return prepareImageMatte({ source, data, info, bounds, hash: sha256(source) });
}

async function extractHeadPatch(image, width, height) {
  const prepared = prepareImageMatte(image);
  const cropWidth = Math.max(1, Math.round(prepared.bounds.width * 0.66));
  const cropHeight = Math.max(1, Math.min(
    Math.round(prepared.bounds.height * 0.59),
    Math.round(cropWidth * 1.12)
  ));
  const centerX = prepared.bounds.minX + (prepared.bounds.width / 2);
  const left = clamp(Math.round(centerX - (cropWidth / 2)), 0, prepared.info.width - cropWidth);
  const top = prepared.bounds.minY;
  const raw = await sharp(prepared.data, {
    raw: {
      width: prepared.info.width,
      height: prepared.info.height,
      channels: prepared.info.channels
    }
  })
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .resize({ width, height, fit: 'contain', kernel: sharp.kernel.lanczos3, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer();
  return quantizePixelArt(raw);
}

async function extractAnchorSprite(anchor, width, height) {
  const prepared = prepareImageMatte(anchor);
  const raw = await sharp(prepared.data, {
    raw: {
      width: prepared.info.width,
      height: prepared.info.height,
      channels: prepared.info.channels
    }
  })
    .extract({
      left: prepared.bounds.minX,
      top: prepared.bounds.minY,
      width: prepared.bounds.width,
      height: prepared.bounds.height
    })
    .resize({ width, height, fit: 'contain', kernel: sharp.kernel.lanczos3, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer();
  return quantizePixelArt(raw);
}

function anchorTransform(palette) {
  return rgba => {
    if (rgba[3] === 0) return rgba;
    const [red, green, blue] = rgba;
    if (blue > red * 1.14 && blue > green * 1.05 && blue > 55) {
      const luminance = ((red + green + blue) / 3) / 255;
      return luminance > 0.55 ? palette.light : luminance > 0.3 ? palette.primary : palette.dark;
    }
    return rgba;
  };
}

function bodyProfile(variant) {
  const race = RACE_PROFILES[variant.race];
  const gender = GENDER_PROFILES[variant.gender];
  if (!race) throw new Error(`Unsupported race: ${variant.race}`);
  if (!gender) throw new Error(`Unsupported gender: ${variant.gender}`);
  const shoulderWidth = race.shoulderWidth + gender.shoulderDelta;
  const hipWidth = race.hipWidth + gender.hipDelta;
  const headBottom = race.top + race.headHeight - 1;
  const torsoTop = headBottom - 1;
  const legHeight = variant.race === 'dwarf' ? 14 : variant.race === 'orc' ? 19 : 20;
  const hipY = race.bottom - legHeight;
  return {
    ...race,
    shoulderWidth,
    hipWidth,
    torsoTaper: gender.torsoTaper,
    torsoTop,
    hipY,
    centerX: 32,
    anchorWidth: variant.race === 'dwarf' ? 35 : 31,
    anchorHeight: variant.race === 'dwarf' ? 50 : 52
  };
}

function drawCape(canvas, profile, palette, variant) {
  if (!['paladin', 'sorcerer', 'summoner', 'oracle', 'plague_doctor'].includes(variant.class) && variant.race !== 'vampire') return;
  const colorValue = variant.class === 'paladin' ? mix(palette.secondary, [178, 44, 54, 255], 0.55) : shade(palette.secondary, 0.55);
  canvas.outlinePolygon([
    [profile.centerX - 8, profile.torsoTop + 2],
    [profile.centerX + 8, profile.torsoTop + 2],
    [profile.centerX + 12, profile.hipY + 11],
    [profile.centerX, profile.hipY + 6],
    [profile.centerX - 11, profile.hipY + 11]
  ], colorValue);
}

function drawProceduralBody(canvas, profile, palette, variant) {
  const outline = SEMANTIC_COLORS.outline;
  const skin = RACE_SKIN[variant.race];
  const center = profile.centerX;
  const shoulderHalf = Math.round(profile.shoulderWidth / 2);
  const hipHalf = Math.round(profile.hipWidth / 2);
  const waistHalf = Math.max(5, shoulderHalf - profile.torsoTaper);

  drawCape(canvas, profile, palette, variant);

  const leftLeg = [[center - hipHalf, profile.hipY - 1], [center - 1, profile.hipY], [center - 2, profile.bottom - 4], [center - hipHalf + 1, profile.bottom - 4]];
  const rightLeg = [[center + 1, profile.hipY], [center + hipHalf, profile.hipY - 1], [center + hipHalf - 1, profile.bottom - 4], [center + 2, profile.bottom - 4]];
  canvas.outlinePolygon(leftLeg, shade(palette.secondary, 0.72), outline);
  canvas.outlinePolygon(rightLeg, shade(palette.secondary, 0.63), outline);
  canvas.rect(center - hipHalf, profile.bottom - 5, hipHalf - 1, 5, outline);
  canvas.rect(center + 2, profile.bottom - 5, hipHalf - 1, 5, outline);
  canvas.rect(center - hipHalf + 1, profile.bottom - 4, hipHalf - 2, 3, shade(SEMANTIC_COLORS.leather, 0.82));
  canvas.rect(center + 3, profile.bottom - 4, hipHalf - 2, 3, shade(SEMANTIC_COLORS.leather, 0.72));

  const torso = [
    [center - shoulderHalf, profile.torsoTop + 3],
    [center - waistHalf, profile.hipY],
    [center + hipHalf, profile.hipY],
    [center + shoulderHalf, profile.torsoTop + 3],
    [center + 5, profile.torsoTop]
  ];
  canvas.outlinePolygon(torso, palette.primary, outline);
  canvas.polygon([
    [center - 3, profile.torsoTop + 1],
    [center + 3, profile.torsoTop + 1],
    [center + 2, profile.hipY - 2],
    [center - 1, profile.hipY - 1]
  ], palette.light);

  const shoulderY = profile.torsoTop + 5;
  const handY = Math.min(profile.hipY + 3, profile.bottom - 12);
  canvas.line(center - shoulderHalf + 1, shoulderY, center - hipHalf - 3, handY, outline, 5);
  canvas.line(center + shoulderHalf - 1, shoulderY, center + hipHalf + 3, handY, outline, 5);
  canvas.line(center - shoulderHalf + 1, shoulderY, center - hipHalf - 3, handY, shade(palette.primary, 0.82), 3);
  canvas.line(center + shoulderHalf - 1, shoulderY, center + hipHalf + 3, handY, shade(palette.primary, 0.74), 3);
  canvas.ellipse(center - hipHalf - 3, handY + 1, 2, 2, skin);
  canvas.ellipse(center + hipHalf + 3, handY + 1, 2, 2, skin);

  canvas.rect(center - hipHalf, profile.hipY - 2, hipHalf * 2, 3, outline);
  canvas.rect(center - hipHalf + 1, profile.hipY - 1, (hipHalf * 2) - 2, 1, SEMANTIC_COLORS.leather);
  canvas.rect(center - 2, profile.hipY - 2, 4, 3, SEMANTIC_COLORS.brass);
}

function drawSword(canvas, x1, y1, x2, y2, palette = SEMANTIC_COLORS.metal) {
  canvas.line(x1, y1, x2, y2, SEMANTIC_COLORS.outline, 3);
  canvas.line(x1, y1, x2, y2, palette, 1);
  canvas.line(x1 - 2, y1, x1 + 2, y1, SEMANTIC_COLORS.brass, 1);
}

function drawStaff(canvas, x, top, bottom, crystal = SEMANTIC_COLORS.magic) {
  canvas.line(x, top + 3, x, bottom, SEMANTIC_COLORS.outline, 3);
  canvas.line(x, top + 3, x, bottom, shade(SEMANTIC_COLORS.leather, 1.25), 1);
  canvas.polygon([[x, top], [x + 3, top + 3], [x, top + 7], [x - 3, top + 3]], SEMANTIC_COLORS.outline);
  canvas.polygon([[x, top + 1], [x + 2, top + 3], [x, top + 5], [x - 2, top + 3]], crystal);
}

function drawShield(canvas, cx, cy, width, height, fill, cross = false) {
  canvas.outlinePolygon([
    [cx - width / 2, cy - height / 2],
    [cx + width / 2, cy - height / 2],
    [cx + width / 2 - 1, cy + height / 3],
    [cx, cy + height / 2],
    [cx - width / 2 + 1, cy + height / 3]
  ], fill);
  if (cross) {
    canvas.rect(cx - 1, cy - 4, 3, 9, SEMANTIC_COLORS.holy);
    canvas.rect(cx - 4, cy - 1, 9, 3, SEMANTIC_COLORS.holy);
  }
}

function drawAxe(canvas, x, top, bottom, facing) {
  canvas.line(x, top + 4, x, bottom, SEMANTIC_COLORS.outline, 3);
  canvas.line(x, top + 4, x, bottom, SEMANTIC_COLORS.leather, 1);
  const direction = facing < 0 ? -1 : 1;
  canvas.polygon([[x, top + 5], [x + (direction * 6), top + 2], [x + (direction * 6), top + 8]], SEMANTIC_COLORS.outline);
  canvas.polygon([[x + direction, top + 5], [x + (direction * 5), top + 3], [x + (direction * 5), top + 7]], SEMANTIC_COLORS.metal);
}

function drawFlask(canvas, cx, cy, liquid = SEMANTIC_COLORS.glass, scale = 1) {
  const outline = SEMANTIC_COLORS.outline;
  canvas.rect(cx - scale, cy - (5 * scale), (2 * scale) + 1, 3 * scale, outline);
  canvas.polygon([
    [cx - scale, cy - (2 * scale)],
    [cx - (3 * scale), cy + scale],
    [cx - (2 * scale), cy + (3 * scale)],
    [cx + (2 * scale), cy + (3 * scale)],
    [cx + (3 * scale), cy + scale],
    [cx + scale, cy - (2 * scale)]
  ], outline);
  canvas.polygon([
    [cx - scale, cy - scale],
    [cx - (2 * scale), cy + scale],
    [cx - scale, cy + (2 * scale)],
    [cx + scale, cy + (2 * scale)],
    [cx + (2 * scale), cy + scale],
    [cx + scale, cy - scale]
  ], liquid);
  canvas.rect(cx - scale, cy - (5 * scale), (2 * scale) + 1, scale, SEMANTIC_COLORS.brass);
  canvas.blendPixel(cx - scale, cy, mix(liquid, SEMANTIC_COLORS.white, 0.6));
}

function drawClassGear(canvas, profile, palette, variant) {
  const center = profile.centerX;
  const headCenterY = profile.top + Math.floor(profile.headHeight / 2);
  const shoulderY = profile.torsoTop + 5;
  const beltY = profile.hipY - 1;
  const left = center - Math.round(profile.shoulderWidth / 2);
  const right = center + Math.round(profile.shoulderWidth / 2);
  switch (variant.class) {
    case 'warrior':
      drawSword(canvas, right + 3, beltY + 2, right + 10, profile.top + 7);
      drawShield(canvas, left + 1, shoulderY + 8, 10, 15, palette.secondary);
      break;
    case 'wizard':
      drawStaff(canvas, right + 7, profile.top + 1, profile.bottom - 1, palette.accent);
      canvas.polygon([[center - 8, profile.hipY - 1], [center + 8, profile.hipY - 1], [center + 12, profile.bottom - 1], [center - 12, profile.bottom - 1]], shade(palette.primary, 0.8));
      break;
    case 'monk':
      canvas.rect(left - 3, beltY - 4, 5, 4, SEMANTIC_COLORS.white);
      canvas.rect(right - 1, beltY - 4, 5, 4, SEMANTIC_COLORS.white);
      for (let index = -3; index <= 3; index += 2) canvas.ellipse(center + index, profile.torsoTop + 5 + Math.abs(index), 1, 1, SEMANTIC_COLORS.brass);
      break;
    case 'chemist':
      canvas.line(center - 6, profile.torsoTop + 3, center + 6, beltY + 2, SEMANTIC_COLORS.outline, 3);
      canvas.line(center - 6, profile.torsoTop + 3, center + 6, beltY + 2, SEMANTIC_COLORS.leather, 1);
      canvas.outlinePolygon([
        [center - 4, profile.torsoTop + 8],
        [center + 4, profile.torsoTop + 8],
        [center + 6, beltY + 1],
        [center - 6, beltY + 1]
      ], mix(palette.primary, SEMANTIC_COLORS.white, 0.38));
      drawFlask(canvas, left - 4, shoulderY + 6, SEMANTIC_COLORS.glass);
      for (let index = 0; index < 3; index += 1) {
        const liquids = [SEMANTIC_COLORS.glass, [245, 184, 66, 255], [100, 172, 245, 255]];
        canvas.rect(center - 5 + (index * 4), beltY - 4, 3, 5, SEMANTIC_COLORS.outline);
        canvas.rect(center - 4 + (index * 4), beltY - 2, 1, 2, liquids[index]);
      }
      canvas.outlinePolygon([[right + 1, beltY], [right + 6, beltY + 1], [right + 5, beltY + 7], [right, beltY + 6]], SEMANTIC_COLORS.leather);
      break;
    case 'berserker':
      drawAxe(canvas, left - 6, profile.top + 8, beltY + 8, -1);
      drawAxe(canvas, right + 6, profile.top + 8, beltY + 8, 1);
      for (const x of [left, left + 5, right - 5, right]) canvas.polygon([[x, shoulderY], [x + 2, shoulderY - 5], [x + 3, shoulderY + 1]], SEMANTIC_COLORS.metal);
      break;
    case 'paladin':
      drawSword(canvas, right + 4, beltY + 4, right + 9, profile.top + 5, SEMANTIC_COLORS.holy);
      drawShield(canvas, left, shoulderY + 8, 11, 16, SEMANTIC_COLORS.metal, true);
      canvas.rect(center - 1, profile.torsoTop + 4, 3, 10, SEMANTIC_COLORS.holy);
      canvas.rect(center - 5, profile.torsoTop + 7, 11, 3, SEMANTIC_COLORS.holy);
      break;
    case 'guardian':
      drawShield(canvas, left - 2, shoulderY + 10, 14, 25, shade(palette.secondary, 0.82));
      for (let y = shoulderY; y < beltY; y += 4) canvas.line(center - 7, y, center + 7, y, SEMANTIC_COLORS.metal, 1);
      break;
    case 'warlord':
      canvas.line(right + 7, profile.top + 2, right + 7, profile.bottom - 1, SEMANTIC_COLORS.outline, 3);
      canvas.line(right + 7, profile.top + 2, right + 7, profile.bottom - 1, SEMANTIC_COLORS.brass, 1);
      canvas.outlinePolygon([[right + 7, profile.top + 3], [right + 14, profile.top + 6], [right + 8, profile.top + 14]], palette.accent);
      break;
    case 'sorcerer':
      canvas.ellipse(right + 6, shoulderY + 3, 5, 5, SEMANTIC_COLORS.outline);
      canvas.ellipse(right + 6, shoulderY + 3, 3, 3, [180, 93, 245, 255]);
      for (let index = 0; index < 7; index += 1) {
        const angle = (index / 7) * Math.PI * 2;
        canvas.blendPixel(right + 6 + Math.round(Math.cos(angle) * 7), shoulderY + 3 + Math.round(Math.sin(angle) * 7), SEMANTIC_COLORS.magic);
      }
      canvas.polygon([[center - 8, profile.top + 3], [center + 8, profile.top + 3], [center + 5, profile.top + 9], [center - 5, profile.top + 9]], palette.dark);
      break;
    case 'summoner':
      canvas.outlinePolygon([[left - 6, beltY], [left, beltY - 3], [left + 5, beltY], [left, beltY + 4]], palette.secondary);
      canvas.line(left, beltY - 2, left, beltY + 3, SEMANTIC_COLORS.holy);
      for (const [x, y] of [[left - 5, profile.top + 7], [right + 6, profile.top + 11]]) {
        canvas.ellipse(x, y, 2, 3, SEMANTIC_COLORS.magic);
        canvas.blendPixel(x, y - 1, SEMANTIC_COLORS.white);
      }
      break;
    case 'conjurer':
      drawStaff(canvas, right + 7, profile.top + 1, profile.bottom - 1, [117, 235, 227, 255]);
      [[left - 4, shoulderY, [246, 102, 62, 255]], [left - 6, shoulderY + 6, [92, 178, 248, 255]], [left - 3, shoulderY + 12, [112, 207, 91, 255]]]
        .forEach(([x, y, gearColor]) => canvas.ellipse(x, y, 2, 2, gearColor));
      break;
    case 'oracle':
      canvas.rect(center - Math.floor(profile.headWidth / 2) + 2, headCenterY - 1, profile.headWidth - 4, 3, SEMANTIC_COLORS.outline);
      canvas.rect(center - Math.floor(profile.headWidth / 2) + 3, headCenterY, profile.headWidth - 6, 1, palette.accent);
      for (const [x, y] of [[left - 3, shoulderY], [right + 3, shoulderY + 5], [left - 2, beltY + 4]]) {
        canvas.rect(x, y, 3, 3, SEMANTIC_COLORS.magic);
        canvas.blendPixel(x + 1, y + 1, SEMANTIC_COLORS.outline);
      }
      break;
    case 'ninja':
      canvas.rect(center - Math.floor(profile.headWidth / 2) + 2, headCenterY + 1, profile.headWidth - 4, 6, palette.dark);
      canvas.line(right + 2, beltY + 5, right + 10, shoulderY + 2, SEMANTIC_COLORS.outline, 3);
      canvas.line(right + 2, beltY + 5, right + 10, shoulderY + 2, SEMANTIC_COLORS.metal, 1);
      canvas.polygon([[right + 10, shoulderY + 2], [right + 5, shoulderY + 2], [right + 9, shoulderY + 7]], SEMANTIC_COLORS.metal);
      break;
    case 'martial_artist':
      canvas.rect(center - 8, profile.top + 5, 16, 2, palette.accent);
      canvas.line(center + 7, profile.top + 6, center + 13, profile.top + 10, palette.accent, 2);
      canvas.rect(center - 8, beltY - 1, 16, 3, SEMANTIC_COLORS.outline);
      canvas.rect(left - 3, beltY - 5, 5, 5, SEMANTIC_COLORS.white);
      canvas.rect(right - 1, beltY - 5, 5, 5, SEMANTIC_COLORS.white);
      break;
    case 'brawler':
      for (const x of [left - 3, right + 3]) {
        canvas.ellipse(x, beltY - 3, 4, 4, SEMANTIC_COLORS.outline);
        canvas.ellipse(x, beltY - 3, 3, 3, SEMANTIC_COLORS.leather);
        for (const dx of [-2, 0, 2]) canvas.polygon([[x + dx, beltY - 6], [x + dx + 1, beltY - 9], [x + dx + 2, beltY - 6]], SEMANTIC_COLORS.metal);
      }
      break;
    case 'ascetic':
      for (let index = 0; index < 9; index += 1) {
        const angle = (index / 9) * Math.PI * 2;
        canvas.ellipse(center + Math.round(Math.cos(angle) * 6), profile.torsoTop + 7 + Math.round(Math.sin(angle) * 5), 1, 1, SEMANTIC_COLORS.brass);
      }
      {
        const auraCenterY = shoulderY + 8;
        const auraRadiusY = Math.min(18, auraCenterY - 4, 59 - auraCenterY);
        for (let index = 0; index < 10; index += 1) {
        const angle = (index / 10) * Math.PI * 2;
          canvas.blendPixel(center + Math.round(Math.cos(angle) * 17), auraCenterY + Math.round(Math.sin(angle) * auraRadiusY), SEMANTIC_COLORS.holy);
        }
      }
      break;
    case 'alchemist':
      canvas.rect(center - 7, profile.top + 5, 6, 3, SEMANTIC_COLORS.brass);
      canvas.rect(center + 1, profile.top + 5, 6, 3, SEMANTIC_COLORS.brass);
      canvas.line(center - 8, profile.torsoTop + 4, center + 7, beltY + 3, SEMANTIC_COLORS.leather, 3);
      for (let index = 0; index < 4; index += 1) canvas.rect(center - 7 + (index * 4), profile.torsoTop + 6 + (index * 3), 3, 4, [78 + (index * 38), 205 - (index * 18), 150 + (index * 20), 255]);
      drawFlask(canvas, right + 7, beltY + 1, [244, 116, 68, 255]);
      break;
    case 'medic':
      canvas.outlinePolygon([[center - 8, profile.torsoTop + 4], [center + 8, profile.torsoTop + 4], [center + 9, profile.hipY + 6], [center - 9, profile.hipY + 6]], SEMANTIC_COLORS.white);
      canvas.rect(center - 1, profile.torsoTop + 7, 3, 9, SEMANTIC_COLORS.medic);
      canvas.rect(center - 4, profile.torsoTop + 10, 9, 3, SEMANTIC_COLORS.medic);
      canvas.outlinePolygon([[right + 1, beltY], [right + 7, beltY], [right + 7, beltY + 8], [right + 1, beltY + 8]], palette.secondary);
      break;
    case 'plague_doctor':
      canvas.polygon([[center - 6, headCenterY - 2], [center + 3, headCenterY - 2], [center + 11, headCenterY + 2], [center + 2, headCenterY + 4], [center - 6, headCenterY + 3]], SEMANTIC_COLORS.outline);
      canvas.polygon([[center - 5, headCenterY - 1], [center + 2, headCenterY - 1], [center + 9, headCenterY + 2], [center + 1, headCenterY + 3], [center - 5, headCenterY + 2]], mix(SEMANTIC_COLORS.white, palette.light, 0.35));
      canvas.line(right + 5, shoulderY + 6, right + 7, beltY + 8, SEMANTIC_COLORS.brass, 1);
      canvas.ellipse(right + 7, beltY + 9, 3, 4, SEMANTIC_COLORS.outline);
      canvas.ellipse(right + 7, beltY + 9, 2, 3, SEMANTIC_COLORS.brass);
      canvas.blendPixel(right + 9, beltY + 7, SEMANTIC_COLORS.poison);
      break;
    case 'artificer':
      canvas.rect(center - 7, profile.top + 5, 6, 3, SEMANTIC_COLORS.brass);
      canvas.rect(center + 1, profile.top + 5, 6, 3, SEMANTIC_COLORS.brass);
      canvas.line(right - 1, shoulderY, right + 5, beltY + 5, SEMANTIC_COLORS.outline, 7);
      canvas.line(right - 1, shoulderY, right + 5, beltY + 5, SEMANTIC_COLORS.brass, 5);
      for (const [x, y] of [[right, shoulderY + 3], [right + 3, beltY]]) {
        canvas.ellipse(x, y, 3, 3, SEMANTIC_COLORS.metal);
        canvas.blendPixel(x, y, SEMANTIC_COLORS.outline);
      }
      break;
    default:
      throw new Error(`Unsupported class: ${variant.class}`);
  }
}

function drawRaceDetails(canvas, profile, variant) {
  const center = profile.centerX;
  const headCenterY = profile.top + Math.floor(profile.headHeight / 2);
  if (variant.race === 'elf') {
    const skin = RACE_SKIN.elf;
    canvas.polygon([[center - 8, headCenterY], [center - 14, headCenterY - 3], [center - 8, headCenterY + 3]], SEMANTIC_COLORS.outline);
    canvas.polygon([[center - 9, headCenterY], [center - 13, headCenterY - 2], [center - 9, headCenterY + 2]], skin);
    canvas.polygon([[center + 8, headCenterY], [center + 14, headCenterY - 3], [center + 8, headCenterY + 3]], SEMANTIC_COLORS.outline);
    canvas.polygon([[center + 9, headCenterY], [center + 13, headCenterY - 2], [center + 9, headCenterY + 2]], skin);
  } else if (variant.race === 'orc') {
    canvas.polygon([[center - 4, profile.top + profile.headHeight - 4], [center - 2, profile.top + profile.headHeight - 8], [center - 1, profile.top + profile.headHeight - 3]], [238, 224, 172, 255]);
    canvas.polygon([[center + 4, profile.top + profile.headHeight - 4], [center + 2, profile.top + profile.headHeight - 8], [center + 1, profile.top + profile.headHeight - 3]], [238, 224, 172, 255]);
  } else if (variant.race === 'vampire') {
    canvas.polygon([[center - 8, profile.torsoTop + 3], [center - 2, profile.torsoTop + 8], [center - 5, profile.torsoTop + 11]], [124, 27, 46, 255]);
    canvas.polygon([[center + 8, profile.torsoTop + 3], [center + 2, profile.torsoTop + 8], [center + 5, profile.torsoTop + 11]], [124, 27, 46, 255]);
  }
}

function drawIdentityStitching(canvas, profile, palette, id) {
  const [race, gender, ...classParts] = id.split('_');
  const className = classParts.join('_');
  const raceIndex = Object.keys(RACE_PROFILES).indexOf(race);
  const genderIndex = Object.keys(GENDER_PROFILES).indexOf(gender);
  const classIndex = Object.keys(CLASS_SIGNATURES).indexOf(className);
  const identityCode = (classIndex * 15) + (genderIndex * 5) + raceIndex;
  const y = profile.hipY + 2;
  for (let index = 0; index < 9; index += 1) {
    const stitchColor = (identityCode >>> index) & 1 ? palette.accent : shade(palette.light, 0.52);
    canvas.blendPixel(profile.centerX - 4 + index, y, stitchColor);
  }
}

async function selectAnchor(projectRoot, variant) {
  const key = `${variant.race}_${variant.gender}`;
  const configured = ANCHOR_PATHS[key];
  if (!configured) return null;
  const absolutePath = path.join(projectRoot, configured);
  try {
    await fs.promises.access(absolutePath, fs.constants.R_OK);
  } catch {
    if (key === 'dwarf_female') throw new Error(`Required dwarf-female identity anchor is missing: ${absolutePath}`);
    return null;
  }
  return { key, absolutePath, reason: ANCHOR_REASONS[key], image: await loadImage(absolutePath) };
}

async function renderIdentity64(projectRoot, variant, options = {}) {
  if (!CLASS_SIGNATURES[variant.class]) throw new Error(`Unsupported class: ${variant.class}`);
  const portraitPath = options.portraitPath || resolveAssetPath(projectRoot, variant.portraitReference);
  const portrait = prepareImageMatte(options.portraitImage || await loadImage(portraitPath));
  const palette = extractPalette(portrait.data, portrait.info, portrait.bounds);
  const profile = bodyProfile(variant);
  const anchor = options.anchor === undefined ? await selectAnchor(projectRoot, variant) : options.anchor;
  const canvas = new PixelCanvas();

  if (anchor) {
    drawCape(canvas, profile, palette, variant);
    const sprite = await extractAnchorSprite(anchor.image, profile.anchorWidth, profile.anchorHeight);
    const left = profile.centerX - Math.floor(profile.anchorWidth / 2);
    const top = profile.bottom - profile.anchorHeight + 1;
    canvas.compositeRaw(sprite, profile.anchorWidth, profile.anchorHeight, left, top, anchorTransform(palette));
  } else {
    drawProceduralBody(canvas, profile, palette, variant);
    drawRaceDetails(canvas, profile, variant);
    const head = await extractHeadPatch(portrait, profile.headWidth, profile.headHeight);
    canvas.compositeRaw(
      head,
      profile.headWidth,
      profile.headHeight,
      profile.centerX - Math.floor(profile.headWidth / 2),
      profile.top
    );
  }

  drawClassGear(canvas, profile, palette, variant);
  drawIdentityStitching(canvas, profile, palette, variant.id);

  const bounds = findAlphaBounds(canvas.data, SOURCE_SIZE, SOURCE_SIZE, 4);
  if (!bounds) throw new Error(`Rendered identity is empty: ${variant.id}`);
  if (bounds.minX < 3 || bounds.minY < 3 || bounds.maxX > 60 || bounds.maxY > 60) {
    throw new Error(`Rendered identity violates the 3px safety margin: ${variant.id} (${JSON.stringify(bounds)})`);
  }

  return {
    raw: canvas.data,
    bounds,
    palette,
    profile,
    portrait: { path: portraitPath, hash: portrait.hash },
    anchor: anchor ? { key: anchor.key, path: anchor.absolutePath, hash: anchor.image.hash, reason: anchor.reason } : null,
    method: anchor ? `${anchor.key}-fullbody-anchor` : 'portrait-head-procedural-fullbody',
    semanticSignature: CLASS_SIGNATURES[variant.class]
  };
}

async function encodeOutput(raw) {
  return sharp(raw, { raw: { width: SOURCE_SIZE, height: SOURCE_SIZE, channels: 4 } })
    .resize({ width: OUTPUT_SIZE, height: OUTPUT_SIZE, fit: 'fill', kernel: sharp.kernel.nearest })
    .ensureAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false, force: true })
    .toBuffer();
}

async function atomicWrite(pathname, buffer) {
  await fs.promises.mkdir(path.dirname(pathname), { recursive: true });
  const temporary = path.join(path.dirname(pathname), `.${path.basename(pathname)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    await fs.promises.writeFile(temporary, buffer, { flag: 'wx' });
    await fs.promises.rename(temporary, pathname);
  } catch (error) {
    await fs.promises.unlink(temporary).catch(() => {});
    throw error;
  }
}

function stableProvenanceDocument(existing = {}) {
  const variants = existing.variants && typeof existing.variants === 'object' ? existing.variants : {};
  return {
    version: COMPILER_VERSION,
    description: 'Deterministic portrait-faithful canonical player identity fallback provenance',
    compiler: 'scripts/ai-images/compile-player-identity-fallbacks.js',
    sourceSize: SOURCE_SIZE,
    outputSize: OUTPUT_SIZE,
    variants: Object.fromEntries(Object.entries(variants).sort(([first], [second]) => first.localeCompare(second)))
  };
}

async function readProvenance(provenancePath) {
  try {
    return stableProvenanceDocument(JSON.parse(await fs.promises.readFile(provenancePath, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return stableProvenanceDocument();
    throw error;
  }
}

async function writeProvenance(provenancePath, document) {
  const stable = stableProvenanceDocument(document);
  await atomicWrite(provenancePath, Buffer.from(`${JSON.stringify(stable, null, 2)}\n`));
}

function provenanceEntry(projectRoot, variant, rendered, outputPath, output) {
  return {
    compilerVersion: COMPILER_VERSION,
    race: variant.race,
    gender: variant.gender,
    class: variant.class,
    method: rendered.method,
    semanticSignature: rendered.semanticSignature,
    sourcePortrait: relativePath(projectRoot, rendered.portrait.path),
    sourcePortraitSha256: rendered.portrait.hash,
    genderAnchor: rendered.anchor ? relativePath(projectRoot, rendered.anchor.path) : null,
    genderAnchorSha256: rendered.anchor ? rendered.anchor.hash : null,
    genderAnchorReason: rendered.anchor ? rendered.anchor.reason : null,
    sourcePixelSha256: sha256(rendered.raw),
    output: relativePath(projectRoot, outputPath),
    outputSha256: sha256(output),
    dimensions: `${OUTPUT_SIZE}x${OUTPUT_SIZE}`,
    encoding: 'lossless-rgba-png-nearest-neighbor-8x',
    alphaBounds64: rendered.bounds,
    palette: {
      primary: rendered.palette.primary.slice(0, 3),
      secondary: rendered.palette.secondary.slice(0, 3),
      accent: rendered.palette.accent.slice(0, 3)
    }
  };
}

async function inspectOutput(outputPath) {
  const source = await fs.promises.readFile(outputPath);
  const metadata = await sharp(source).metadata();
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bounds = findAlphaBounds(data, info.width, info.height, info.channels);
  const corners = [
    data[3],
    data[((info.width - 1) * info.channels) + 3],
    data[(((info.height - 1) * info.width) * info.channels) + 3],
    data[((((info.height - 1) * info.width) + info.width - 1) * info.channels) + 3]
  ];
  const issues = [];
  if (metadata.format !== 'png') issues.push(`expected lossless PNG, got ${metadata.format || 'unknown format'}`);
  if (info.width !== info.height || info.width < OUTPUT_SIZE) {
    issues.push(`expected square canonical reference at least ${OUTPUT_SIZE}x${OUTPUT_SIZE}, got ${info.width}x${info.height}`);
  }
  if (!metadata.hasAlpha || metadata.channels !== 4) issues.push(`expected source RGBA, got ${metadata.channels || 'unknown'} channels with hasAlpha=${Boolean(metadata.hasAlpha)}`);
  if (!bounds) issues.push('no visible subject');
  if (corners.some(alpha => alpha > ALPHA_THRESHOLD)) issues.push('corners are not transparent');
  const proportionalMargin = Math.floor(Math.min(info.width, info.height) * (24 / OUTPUT_SIZE));
  if (bounds && (
    bounds.minX < proportionalMargin ||
    bounds.minY < proportionalMargin ||
    bounds.maxX > info.width - 1 - proportionalMargin ||
    bounds.maxY > info.height - 1 - proportionalMargin
  )) {
    issues.push(`subject violates ${proportionalMargin}px proportional output margin (${JSON.stringify(bounds)})`);
  }
  if (bounds && bounds.alphaPixels / (info.width * info.height) > 0.58) issues.push('subject covers more than 58% of the canvas');
  return { source, metadata, info, bounds, hash: sha256(source), issues };
}

function selectVariants(registry, options, projectRoot) {
  const variants = registry.variants || [];
  if (options.all) return variants;
  if (options.ids && options.ids.length) {
    const requested = new Set(options.ids);
    const selected = variants.filter(variant => requested.has(variant.id));
    const missing = [...requested].filter(id => !selected.some(variant => variant.id === id));
    if (missing.length) throw new Error(`Unknown player identity: ${missing.join(', ')}`);
    return selected;
  }
  if (options.sample) {
    const preferred = ['dwarf_female_chemist', 'dwarf_other_artificer', 'human_female_chemist'];
    for (const id of preferred) {
      const variant = variants.find(candidate => candidate.id === id);
      if (variant && (options.force || !fs.existsSync(canonicalOutputPath(projectRoot, variant)))) return [variant];
    }
    const missing = variants.find(variant => !fs.existsSync(canonicalOutputPath(projectRoot, variant)));
    return [missing || variants.find(variant => variant.id === preferred[0]) || variants[0]].filter(Boolean);
  }
  throw new Error('Choose exactly one scope: --id <identity>, --sample, or --all.');
}

async function compileIdentities(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || path.join(__dirname, '../../..'));
  const registryPath = path.resolve(options.registryPath || path.join(projectRoot, DEFAULT_REGISTRY));
  const provenancePath = path.resolve(options.provenancePath || path.join(projectRoot, DEFAULT_PROVENANCE));
  const registry = JSON.parse(await fs.promises.readFile(registryPath, 'utf8'));
  const variants = selectVariants(registry, options, projectRoot);
  const provenance = await readProvenance(provenancePath);
  const result = {
    ok: true,
    check: Boolean(options.check),
    targets: variants.length,
    generated: [],
    skipped: [],
    verified: [],
    issues: [],
    provenance: relativePath(projectRoot, provenancePath)
  };

  for (const variant of variants) {
    const outputPath = canonicalOutputPath(projectRoot, variant);
    const outputRelative = relativePath(projectRoot, outputPath);
    if (options.check) {
      try {
        const inspected = await inspectOutput(outputPath);
        const entry = provenance.variants[variant.id];
        for (const issue of inspected.issues) result.issues.push(`${variant.id}: ${issue}`);
        if (entry && entry.outputSha256 !== inspected.hash) result.issues.push(`${variant.id}: output hash differs from fallback provenance`);
        if (entry) {
          if (entry.compilerVersion !== COMPILER_VERSION) {
            result.issues.push(`${variant.id}: fallback provenance compiler version ${entry.compilerVersion || 'missing'} differs from ${COMPILER_VERSION}`);
          }
          const portraitPath = resolveAssetPath(projectRoot, variant.portraitReference);
          const portraitHash = sha256(await fs.promises.readFile(portraitPath));
          if (entry.sourcePortraitSha256 !== portraitHash) result.issues.push(`${variant.id}: source portrait hash differs from fallback provenance`);
          if (entry.genderAnchor) {
            const anchorHash = sha256(await fs.promises.readFile(path.join(projectRoot, entry.genderAnchor)));
            if (entry.genderAnchorSha256 !== anchorHash) result.issues.push(`${variant.id}: gender anchor hash differs from fallback provenance`);
          }
        }
        result.verified.push(outputRelative);
      } catch (error) {
        result.issues.push(`${variant.id}: ${error.code === 'ENOENT' ? 'canonical reference is missing' : error.message}`);
      }
      continue;
    }

    if (!options.force && fs.existsSync(outputPath)) {
      result.skipped.push(outputRelative);
      continue;
    }

    try {
      const rendered = await renderIdentity64(projectRoot, variant);
      const output = await encodeOutput(rendered.raw);
      await atomicWrite(outputPath, output);
      provenance.variants[variant.id] = provenanceEntry(projectRoot, variant, rendered, outputPath, output);
      result.generated.push(outputRelative);
    } catch (error) {
      result.issues.push(`${variant.id}: ${error.message}`);
    }
  }

  if (!options.check && result.generated.length) await writeProvenance(provenancePath, provenance);
  result.ok = result.issues.length === 0;
  return result;
}

module.exports = {
  ALPHA_THRESHOLD,
  ANCHOR_PATHS,
  ANCHOR_REASONS,
  CLASS_SIGNATURES,
  COMPILER_VERSION,
  DEFAULT_PROVENANCE,
  DEFAULT_REGISTRY,
  GENDER_PROFILES,
  OUTPUT_SIZE,
  PixelCanvas,
  RACE_PROFILES,
  SOURCE_SIZE,
  bodyProfile,
  canonicalOutputPath,
  compileIdentities,
  encodeOutput,
  extractPalette,
  findAlphaBounds,
  inspectOutput,
  prepareImageMatte,
  removeEdgeConnectedMatte,
  renderIdentity64,
  resolveAssetPath,
  selectVariants,
  sha256
};
