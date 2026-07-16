'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const FRAME_SIZE = 64;
const FRAME_COUNT = 8;
const STRIP_WIDTH = FRAME_SIZE;
const STRIP_HEIGHT = FRAME_SIZE * FRAME_COUNT;
const SAFE_MARGIN = 4;
const INNER_SIZE = FRAME_SIZE - (SAFE_MARGIN * 2);
const ALPHA_THRESHOLD = 8;

const APPROVED_GOLDEN_STRIPS = Object.freeze({
  'human_male_warrior/idle': Object.freeze({
    encodedSha256: 'a8c76dfccee3de3840d6ad1899268caff0f1ee9ce28499d6b6edcb7029c1d6be',
    allowedIssuePatterns: Object.freeze([
      /^expected lossless WebP compression, received lossy$/,
      /^frame [0-7] violates the 4px safe margin$/
    ])
  })
});

const SUPPORTED_ANIMATIONS = Object.freeze([
  'idle',
  'walk',
  'attack',
  'hurt',
  'death',
  'dead',
  'cast',
  'victory'
]);

const MOTION_PROFILES = Object.freeze({
  idle: Object.freeze([
    { dy: 0 },
    { dy: 0 },
    { dy: -1 },
    { dy: -2 },
    { dy: -2 },
    { dy: -1 },
    { dy: 0 },
    { dy: 0 }
  ]),
  walk: Object.freeze([
    { dx: -1, dy: 0, stride: -2, scaleY: 0.99 },
    { dx: 0, dy: -2, stride: -1, scaleY: 1 },
    { dx: 1, dy: -4, stride: 0, scaleY: 1.01 },
    { dx: 0, dy: -2, stride: 1, scaleY: 1 },
    { dx: -1, dy: 0, stride: 2, scaleY: 0.99 },
    { dx: 0, dy: -2, stride: 1, scaleY: 1 },
    { dx: 1, dy: -4, stride: 0, scaleY: 1.01 },
    { dx: 0, dy: -2, stride: -1, scaleY: 1 }
  ]),
  attack: Object.freeze([
    { dx: 0, dy: 0 },
    { dx: -1, dy: 0, rotate: 3, scaleX: 0.98 },
    { dx: 1, dy: -1, rotate: -3, scaleX: 1.02, effect: 'slash-windup' },
    { dx: 4, dy: -1, rotate: -7, scaleX: 1.06, effect: 'slash' },
    { dx: 6, dy: 0, rotate: -9, scaleX: 1.08, effect: 'slash' },
    { dx: 5, dy: 0, rotate: -5, scaleX: 1.05, effect: 'slash-fade' },
    { dx: 2, dy: 0, rotate: -2, scaleX: 1.02 },
    { dx: 0, dy: 0 }
  ]),
  hurt: Object.freeze([
    { dx: 0, dy: 0 },
    { dx: -2, dy: -1, rotate: 2, flash: 0.28 },
    { dx: -5, dy: -1, rotate: 5, flash: 0.62 },
    { dx: -6, dy: 0, rotate: 6, flash: 0.42 },
    { dx: -4, dy: 0, rotate: 4, flash: 0.18 },
    { dx: -2, dy: 0, rotate: 2 },
    { dx: 0, dy: 0 },
    { dx: 0, dy: 0 }
  ]),
  death: Object.freeze([
    { dx: 0, dy: 3, rotate: 0, anchor: 'center' },
    { dx: -1, dy: 4, rotate: -8, anchor: 'center' },
    { dx: -1, dy: 6, rotate: -20, anchor: 'center' },
    { dx: 0, dy: 8, rotate: -36, anchor: 'center' },
    { dx: 1, dy: 10, rotate: -55, anchor: 'center' },
    { dx: 1, dy: 12, rotate: -75, anchor: 'center' },
    { dx: 0, dy: 13, rotate: -90, anchor: 'center' },
    { dx: 0, dy: 13, rotate: -90, anchor: 'center' }
  ]),
  dead: Object.freeze(Array.from({ length: FRAME_COUNT }, () => Object.freeze({
    dx: 0,
    dy: 13,
    rotate: -90,
    anchor: 'center',
    scaleX: 0.98,
    scaleY: 0.94
  }))),
  cast: Object.freeze([
    { dy: 0, effect: 'aura-0' },
    { dy: -1, scaleY: 1.01, effect: 'aura-1' },
    { dy: -2, scaleY: 1.02, effect: 'aura-2' },
    { dy: -3, scaleX: 1.02, scaleY: 1.03, effect: 'aura-3' },
    { dy: -2, scaleX: 1.03, scaleY: 1.03, effect: 'aura-4' },
    { dy: -3, scaleX: 1.02, scaleY: 1.02, effect: 'aura-5' },
    { dy: -1, scaleY: 1.01, effect: 'aura-6' },
    { dy: 0, effect: 'aura-7' }
  ]),
  victory: Object.freeze([
    { dy: 0, scaleX: 1.02, scaleY: 0.98, effect: 'spark-0' },
    { dy: -2, scaleY: 1.01, effect: 'spark-1' },
    { dy: -5, scaleY: 1.03, effect: 'spark-2' },
    { dy: -7, scaleX: 0.98, scaleY: 1.04, effect: 'spark-3' },
    { dy: -4, scaleY: 1.02, effect: 'spark-4' },
    { dy: -1, scaleX: 1.03, scaleY: 0.98, effect: 'spark-5' },
    { dy: -3, scaleY: 1.02, effect: 'spark-6' },
    { dy: 0, effect: 'spark-7' }
  ])
});

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableHash(value) {
  const digest = crypto.createHash('sha256').update(String(value)).digest();
  return digest.readUInt32BE(0);
}

function isApprovedGoldenStrip(label, encodedHash, issues) {
  const approval = APPROVED_GOLDEN_STRIPS[label];
  return Boolean(
    approval &&
    encodedHash === approval.encodedSha256 &&
    issues.length > 0 &&
    issues.every(issue => approval.allowedIssuePatterns.some(pattern => pattern.test(issue)))
  );
}

function hasRiffChunk(buffer, expectedFourCc) {
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    return false;
  }
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const fourCc = buffer.toString('ascii', offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    if (fourCc === expectedFourCc) return true;
    offset += 8 + length + (length % 2);
  }
  return false;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function findAlphaBounds(data, width, height, channels = 4, threshold = ALPHA_THRESHOLD) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let alphaPixels = 0;
  let sumX = 0;
  let sumY = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[((y * width) + x) * channels + (channels - 1)];
      if (alpha <= threshold) continue;
      alphaPixels += 1;
      sumX += x;
      sumY += y;
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
    alphaPixels,
    centroidX: sumX / alphaPixels,
    centroidY: sumY / alphaPixels
  };
}

async function normalizeReference(referencePath) {
  const { data, info } = await sharp(referencePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bounds = findAlphaBounds(data, info.width, info.height, info.channels);
  if (!bounds) throw new Error(`Reference has no visible pixels: ${referencePath}`);

  const maxWidth = 40;
  const maxHeight = 46;
  const scale = Math.min(maxWidth / bounds.width, maxHeight / bounds.height);
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  const input = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels }
  })
    .extract({ left: bounds.minX, top: bounds.minY, width: bounds.width, height: bounds.height })
    .resize({ width, height, fit: 'fill', kernel: sharp.kernel.nearest })
    .png()
    .toBuffer();

  return { input, width, height, sourceBounds: bounds };
}

async function applyStride(input, width, height, stride) {
  if (!stride) return { input, width, height };
  const splitY = clamp(Math.round(height * 0.68), 1, height - 1);
  const splitX = Math.floor(width / 2);
  const lowerHeight = height - splitY;
  const direction = Math.sign(stride);
  const distance = Math.abs(stride);
  const canvasHeight = height + distance;

  const upper = await sharp(input).extract({ left: 0, top: 0, width, height: splitY }).png().toBuffer();
  const lowerLeft = await sharp(input)
    .extract({ left: 0, top: splitY, width: splitX, height: lowerHeight })
    .png()
    .toBuffer();
  const lowerRight = await sharp(input)
    .extract({ left: splitX, top: splitY, width: width - splitX, height: lowerHeight })
    .png()
    .toBuffer();

  const leftOffset = direction < 0 ? distance : 0;
  const rightOffset = direction > 0 ? distance : 0;
  const output = await sharp({
    create: { width, height: canvasHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite([
      { input: upper, left: 0, top: 0 },
      { input: lowerLeft, left: 0, top: splitY + leftOffset },
      { input: lowerRight, left: splitX, top: splitY + rightOffset }
    ])
    .png()
    .toBuffer();

  return { input: output, width, height: canvasHeight };
}

async function tintPose(input, amount) {
  if (!amount) return input;
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const overlay = Buffer.alloc(data.length);
  const opacity = clamp(amount, 0, 0.8);
  for (let offset = 0; offset < data.length; offset += info.channels) {
    overlay[offset] = 255;
    overlay[offset + 1] = 62;
    overlay[offset + 2] = 62;
    overlay[offset + 3] = Math.round(data[offset + 3] * opacity);
  }
  return sharp(input)
    .composite([{
      input: overlay,
      raw: { width: info.width, height: info.height, channels: info.channels },
      blend: 'over'
    }])
    .png()
    .toBuffer();
}

function effectPalette(id) {
  const palettes = [
    [[92, 214, 255], [196, 116, 255]],
    [[255, 212, 92], [255, 121, 76]],
    [[126, 255, 166], [64, 194, 255]],
    [[255, 132, 214], [155, 123, 255]]
  ];
  return palettes[stableHash(id) % palettes.length];
}

function createEffectBuffer(id, animation, frameIndex, effect) {
  if (!effect) return null;
  const data = Buffer.alloc(FRAME_SIZE * FRAME_SIZE * 4);
  const palette = effectPalette(id);

  const putPixel = (x, y, color, alpha = 255) => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < SAFE_MARGIN || px >= FRAME_SIZE - SAFE_MARGIN || py < SAFE_MARGIN || py >= FRAME_SIZE - SAFE_MARGIN) return;
    const offset = ((py * FRAME_SIZE) + px) * 4;
    const existingAlpha = data[offset + 3] / 255;
    const incomingAlpha = alpha / 255;
    const combinedAlpha = incomingAlpha + (existingAlpha * (1 - incomingAlpha));
    if (combinedAlpha <= 0) return;
    for (let channel = 0; channel < 3; channel += 1) {
      data[offset + channel] = Math.round(
        ((color[channel] * incomingAlpha) + (data[offset + channel] * existingAlpha * (1 - incomingAlpha))) /
        combinedAlpha
      );
    }
    data[offset + 3] = Math.round(combinedAlpha * 255);
  };

  if (animation === 'cast') {
    const phase = frameIndex / FRAME_COUNT;
    const radiusX = 20 + ((frameIndex % 3) * 2);
    const radiusY = 25 + ((frameIndex % 2) * 2);
    for (let degree = 0; degree < 360; degree += 5) {
      const radians = ((degree / 360) + phase) * Math.PI * 2;
      const x = 32 + (Math.cos(radians) * radiusX);
      const y = 33 + (Math.sin(radians) * radiusY);
      const color = ((degree / 5) + frameIndex) % 2 ? palette[0] : palette[1];
      putPixel(x, y, color, 135);
      if ((degree + frameIndex) % 20 === 0) putPixel(x + 1, y, color, 82);
    }
    const floorRadius = 14 + (frameIndex % 4);
    for (let degree = 0; degree < 360; degree += 8) {
      const radians = degree * Math.PI / 180;
      putPixel(32 + (Math.cos(radians) * floorRadius), 56 + (Math.sin(radians) * 3), palette[0], 150);
    }
  } else if (animation === 'attack') {
    const phase = effect === 'slash-windup' ? 0 : effect === 'slash-fade' ? 2 : 1;
    const alpha = phase === 1 ? 210 : 105;
    for (let step = 0; step <= 22; step += 1) {
      const angle = (-1.05 + (step / 22) * 1.75) + (phase * 0.04);
      const radius = 18 + (step % 3);
      const x = 36 + (Math.cos(angle) * radius);
      const y = 30 + (Math.sin(angle) * radius);
      putPixel(x, y, palette[phase % 2], alpha);
      if (phase === 1 && step % 2 === 0) putPixel(x + 1, y, [255, 255, 236], 170);
    }
  } else if (animation === 'victory') {
    const seed = stableHash(`${id}:${frameIndex}`);
    for (let index = 0; index < 7; index += 1) {
      const x = SAFE_MARGIN + 2 + ((seed >>> (index % 16)) + (index * 13)) % (INNER_SIZE - 4);
      const y = SAFE_MARGIN + 2 + ((seed >>> ((index + 7) % 16)) + (index * 19)) % 36;
      const color = palette[index % palette.length];
      putPixel(x, y, color, 210);
      if ((index + frameIndex) % 2 === 0) {
        putPixel(x - 1, y, color, 120);
        putPixel(x + 1, y, color, 120);
        putPixel(x, y - 1, color, 120);
        putPixel(x, y + 1, color, 120);
      }
    }
  }

  return { input: data, raw: { width: FRAME_SIZE, height: FRAME_SIZE, channels: 4 } };
}

async function renderPose(normalized, descriptor, id, animation, frameIndex) {
  const scaleX = descriptor.scaleX ?? 1;
  const scaleY = descriptor.scaleY ?? 1;
  let width = Math.max(1, Math.round(normalized.width * scaleX));
  let height = Math.max(1, Math.round(normalized.height * scaleY));
  let input = await sharp(normalized.input)
    .resize({ width, height, fit: 'fill', kernel: sharp.kernel.nearest })
    .png()
    .toBuffer();

  ({ input, width, height } = await applyStride(input, width, height, descriptor.stride ?? 0));

  if (descriptor.rotate) {
    input = await sharp(input)
      .rotate(descriptor.rotate, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const rotatedMetadata = await sharp(input).metadata();
    width = rotatedMetadata.width;
    height = rotatedMetadata.height;
  }

  if (width > INNER_SIZE || height > INNER_SIZE) {
    input = await sharp(input)
      .resize({ width: INNER_SIZE, height: INNER_SIZE, fit: 'inside', kernel: sharp.kernel.nearest })
      .png()
      .toBuffer();
    const fittedMetadata = await sharp(input).metadata();
    width = fittedMetadata.width;
    height = fittedMetadata.height;
  }

  input = await tintPose(input, descriptor.flash ?? 0);

  const dx = descriptor.dx ?? 0;
  const dy = descriptor.dy ?? 0;
  let left = Math.round((FRAME_SIZE - width) / 2) + dx;
  let top;
  if (descriptor.anchor === 'center') {
    top = Math.round((FRAME_SIZE - height) / 2) + dy;
  } else {
    top = (FRAME_SIZE - SAFE_MARGIN - height) + dy;
  }
  left = clamp(left, SAFE_MARGIN, FRAME_SIZE - SAFE_MARGIN - width);
  top = clamp(top, SAFE_MARGIN, FRAME_SIZE - SAFE_MARGIN - height);

  const effect = createEffectBuffer(id, animation, frameIndex, descriptor.effect);
  const composites = [];
  if (effect) composites.push(effect);
  composites.push({ input, left, top });

  return sharp({
    create: {
      width: FRAME_SIZE,
      height: FRAME_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite(composites)
    .png()
    .toBuffer();
}

async function compileAnimationBuffer({ referencePath, id, animation }) {
  if (!SUPPORTED_ANIMATIONS.includes(animation)) {
    throw new Error(`Unsupported player animation: ${animation}`);
  }
  const normalized = await normalizeReference(referencePath);
  const profile = MOTION_PROFILES[animation];
  const frames = [];
  for (let frameIndex = 0; frameIndex < FRAME_COUNT; frameIndex += 1) {
    frames.push(await renderPose(normalized, profile[frameIndex], id, animation, frameIndex));
  }

  return sharp({
    create: {
      width: STRIP_WIDTH,
      height: STRIP_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite(frames.map((input, index) => ({ input, left: 0, top: index * FRAME_SIZE })))
    .webp({ lossless: true, alphaQuality: 100, effort: 6 })
    .toBuffer();
}

async function inspectStrip(input) {
  const encoded = Buffer.isBuffer(input) ? input : await fs.promises.readFile(input);
  const image = sharp(input);
  const metadata = await image.metadata();
  const isLosslessWebp = hasRiffChunk(encoded, 'VP8L');
  const report = {
    format: metadata.format,
    compression: metadata.format === 'webp' ? (isLosslessWebp ? 'lossless' : 'lossy') : metadata.compression,
    width: metadata.width,
    height: metadata.height,
    hasAlpha: metadata.hasAlpha,
    channels: metadata.channels,
    stripHash: sha256(await image.clone().ensureAlpha().raw().toBuffer()),
    frames: []
  };

  if (metadata.width !== STRIP_WIDTH || metadata.height !== STRIP_HEIGHT) return report;

  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let frameIndex = 0; frameIndex < FRAME_COUNT; frameIndex += 1) {
    const frame = Buffer.alloc(FRAME_SIZE * FRAME_SIZE * info.channels);
    for (let y = 0; y < FRAME_SIZE; y += 1) {
      const sourceStart = ((((frameIndex * FRAME_SIZE) + y) * FRAME_SIZE) * info.channels);
      const targetStart = ((y * FRAME_SIZE) * info.channels);
      data.copy(frame, targetStart, sourceStart, sourceStart + (FRAME_SIZE * info.channels));
    }
    const bounds = findAlphaBounds(frame, FRAME_SIZE, FRAME_SIZE, info.channels, 0);
    report.frames.push({
      index: frameIndex,
      hash: sha256(frame),
      bounds,
      blank: bounds === null,
      safeMargin: bounds !== null &&
        bounds.minX >= SAFE_MARGIN && bounds.minY >= SAFE_MARGIN &&
        bounds.maxX < FRAME_SIZE - SAFE_MARGIN && bounds.maxY < FRAME_SIZE - SAFE_MARGIN
    });
  }

  return report;
}

function numericRange(values) {
  return Math.max(...values) - Math.min(...values);
}

function validateMotionProfile(report, animation) {
  const issues = [];
  if (report.frames.length !== FRAME_COUNT || report.frames.some(frame => !frame.bounds)) return issues;
  const frames = report.frames;
  const centroidX = frames.map(frame => frame.bounds.centroidX);
  const centroidY = frames.map(frame => frame.bounds.centroidY);
  const uniqueFrames = new Set(frames.map(frame => frame.hash)).size;

  if (animation === 'idle' && (numericRange(centroidY) < 0.5 || uniqueFrames < 3)) {
    issues.push('idle must contain a subtle breathing/bob cycle');
  }
  if (animation === 'walk' && (numericRange(centroidY) < 1 || uniqueFrames < 5)) {
    issues.push('walk must contain a bob and alternating stride');
  }
  if (animation === 'attack' && Math.max(...centroidX) - centroidX[0] < 2) {
    issues.push('attack must visibly lunge forward');
  }
  if (animation === 'hurt' && centroidX[0] - Math.min(...centroidX) < 2) {
    issues.push('hurt must visibly recoil');
  }
  if (animation === 'death') {
    const first = frames[0].bounds;
    const last = frames[frames.length - 1].bounds;
    const penultimate = frames[frames.length - 2];
    const settled = penultimate.hash === frames[frames.length - 1].hash;
    const dropped = last.centroidY - first.centroidY >= 3 || last.maxY - first.maxY >= 3;
    // Shields, staves, wings, and other equipment can make an otherwise
    // upright source wider than it is tall. The terminal silhouette is the
    // authoritative evidence that the pose has fallen; requiring the first
    // frame itself to be portrait-oriented rejects valid broad characters.
    const rotatedToFallen = last.width > last.height;
    if (!settled || (!dropped && !rotatedToFallen) || uniqueFrames < 6) {
      issues.push('death must transition from standing to fallen');
    }
  }
  if (animation === 'dead' && uniqueFrames !== 1) {
    issues.push('dead must hold one stable fallen pose');
  }
  if (animation === 'cast' && uniqueFrames < 7) {
    issues.push('cast must contain a changing aura');
  }
  if (animation === 'victory' && (numericRange(centroidY) < 3 || uniqueFrames < 6)) {
    issues.push('victory must contain a celebratory bounce');
  }
  return issues;
}

async function validateStripContract(input, { animation, requireMotion = false } = {}) {
  const report = await inspectStrip(input);
  const issues = [];
  if (report.format !== 'webp') issues.push(`expected WebP, received ${String(report.format)}`);
  if (report.compression !== 'lossless') {
    issues.push(`expected lossless WebP compression, received ${report.compression}`);
  }
  if (report.width !== STRIP_WIDTH || report.height !== STRIP_HEIGHT) {
    issues.push(`expected ${STRIP_WIDTH}x${STRIP_HEIGHT}, received ${report.width}x${report.height}`);
  }
  if (!report.hasAlpha || report.channels !== 4) issues.push('expected a four-channel alpha sprite strip');
  if (report.frames.length === FRAME_COUNT) {
    for (const frame of report.frames) {
      if (frame.blank) issues.push(`frame ${frame.index} is blank`);
      else if (!frame.safeMargin) issues.push(`frame ${frame.index} violates the ${SAFE_MARGIN}px safe margin`);
    }
  }
  if (requireMotion && animation) issues.push(...validateMotionProfile(report, animation));
  return { ok: issues.length === 0, issues, report };
}

function getCanonicalPaths(projectRoot, variant, animation) {
  const directory = path.join(
    projectRoot,
    'frontend/public/assets/characters/player',
    variant.race,
    variant.gender,
    variant.class
  );
  return {
    directory,
    referencePath: path.join(directory, `${variant.id}_reference.png`),
    outputPath: path.join(directory, `${variant.id}_${animation}.webp`)
  };
}

function applyGeneratedAnimationStatus(registry, completions, now = new Date().toISOString()) {
  const next = cloneJson(registry);
  const byId = new Map((next.variants || []).map(variant => [variant.id, variant]));
  for (const completion of completions) {
    const variant = byId.get(completion.id);
    if (!variant) throw new Error(`Cannot update unknown player variant: ${completion.id}`);
    const before = variant.generatedAnimations?.[completion.animation] === true;
    variant.generatedAnimations = { ...(variant.generatedAnimations || {}), [completion.animation]: true };
    variant.generated = (variant.animations || []).every(animation => variant.generatedAnimations[animation] === true);
    if (!before || completion.written) variant.generatedAt = now;
    if (variant.generated) {
      variant.needsRegeneration = false;
      variant.regenerationQueuedAt = null;
    }
  }
  return next;
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeFileAtomic(filePath, contents) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    await fs.promises.writeFile(temporaryPath, contents);
    await fs.promises.rename(temporaryPath, filePath);
  } finally {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

function selectTargets(registry, projectRoot, options) {
  const variants = registry.variants || [];
  let selected;
  if (options.sample) {
    const sample = variants.find(variant => {
      const { referencePath } = getCanonicalPaths(projectRoot, variant, 'idle');
      return fs.existsSync(referencePath);
    });
    selected = sample ? [sample] : [];
  } else if (options.all) {
    selected = variants;
  } else {
    const ids = new Set(options.ids || []);
    if (ids.size === 0) throw new Error('Choose --id <identity>, --sample, or --all. Bulk compilation is never implicit.');
    selected = variants.filter(variant => ids.has(variant.id));
    const missingIds = [...ids].filter(id => !selected.some(variant => variant.id === id));
    if (missingIds.length > 0) throw new Error(`Unknown player variant(s): ${missingIds.join(', ')}`);
  }

  const targets = [];
  for (const variant of selected) {
    let animations = options.animations?.length ? options.animations : variant.animations;
    if (options.sample && !options.animations?.length) {
      animations = variant.animations.filter(animation => {
        const { outputPath } = getCanonicalPaths(projectRoot, variant, animation);
        return !fs.existsSync(outputPath);
      }).slice(0, 1);
      if (animations.length === 0) animations = variant.animations.slice(0, 1);
    }
    for (const animation of animations) {
      if (!SUPPORTED_ANIMATIONS.includes(animation)) {
        throw new Error(`Unsupported player animation: ${animation}`);
      }
      if (!(variant.animations || []).includes(animation)) {
        throw new Error(`${variant.id} does not declare animation ${animation} in player-variants metadata`);
      }
      targets.push({ variant, animation, ...getCanonicalPaths(projectRoot, variant, animation) });
    }
  }
  return targets;
}

async function compileTargets(options = {}) {
  // Loaded lazily to avoid a module cycle: authored compilation reuses the
  // strip contract helpers exported by this module.
  const {
    compileAuthoredAnimationOverride,
    discoverApprovedAuthoredSpecs
  } = require('./authoredPlayerOverrides');
  const projectRoot = path.resolve(options.projectRoot || path.resolve(__dirname, '../../..'));
  const registryPath = path.resolve(options.registryPath || path.join(
    projectRoot,
    'ai-image-metadata/characters/player-variants.json'
  ));
  const originalRegistryText = await fs.promises.readFile(registryPath, 'utf8');
  const registry = JSON.parse(originalRegistryText);
  const targets = selectTargets(registry, projectRoot, options);
  const authoredSpecs = discoverApprovedAuthoredSpecs(projectRoot, {
    specDirectory: options.authoredSpecDirectory
  });
  const result = {
    ok: true,
    check: options.check === true,
    targets: targets.length,
    generated: [],
    skipped: [],
    approvedGolden: [],
    verified: [],
    issues: []
  };
  const completions = [];
  const staged = [];

  if (targets.length === 0) {
    result.ok = false;
    result.issues.push('No canonical full-body player reference is available for the requested scope.');
    return result;
  }

  for (const target of targets) {
    const label = `${target.variant.id}/${target.animation}`;
    const authoredEntry = authoredSpecs.get(target.variant.id);
    if (!authoredEntry && !fs.existsSync(target.referencePath)) {
      result.issues.push(`${label}: missing canonical reference ${path.relative(projectRoot, target.referencePath)}`);
      continue;
    }

    const outputExists = fs.existsSync(target.outputPath);
    if (outputExists && !options.force) {
      const validation = await validateStripContract(target.outputPath, { animation: target.animation });
      const encodedHash = validation.ok ? null : sha256(await fs.promises.readFile(target.outputPath));
      const approvedGolden = !validation.ok && isApprovedGoldenStrip(label, encodedHash, validation.issues);
      if (!validation.ok && !approvedGolden) {
        result.issues.push(`${label}: existing strip is preserved but invalid (${validation.issues.join('; ')}); use --force to replace it`);
        continue;
      }
      if (options.check && authoredEntry) {
        const approved = await compileAuthoredAnimationOverride({
          projectRoot,
          variant: target.variant,
          animation: target.animation,
          entry: authoredEntry
        });
        const existingHash = sha256(await fs.promises.readFile(target.outputPath));
        if (existingHash !== sha256(approved.buffer)) {
          result.issues.push(`${label}: canonical strip differs from approved authored override`);
          continue;
        }
      }
      if (approvedGolden) result.approvedGolden.push(label);
      if (options.check) result.verified.push(label);
      else result.skipped.push(label);
      completions.push({ id: target.variant.id, animation: target.animation, written: false });
      continue;
    }

    if (options.check) {
      result.issues.push(`${label}: canonical strip is missing`);
      continue;
    }

    const buffer = authoredEntry
      ? (await compileAuthoredAnimationOverride({
          projectRoot,
          variant: target.variant,
          animation: target.animation,
          entry: authoredEntry
        })).buffer
      : await compileAnimationBuffer({
          referencePath: target.referencePath,
          id: target.variant.id,
          animation: target.animation
        });
    const validation = await validateStripContract(buffer, { animation: target.animation, requireMotion: true });
    if (!validation.ok) {
      result.issues.push(`${label}: compiled strip failed validation (${validation.issues.join('; ')})`);
      continue;
    }
    staged.push({ ...target, buffer, hash: validation.report.stripHash });
  }

  const hashOwners = new Map();
  for (const entry of staged) {
    const owner = hashOwners.get(entry.hash);
    if (owner) result.issues.push(`${entry.variant.id}/${entry.animation}: duplicates ${owner}`);
    else hashOwners.set(entry.hash, `${entry.variant.id}/${entry.animation}`);
  }

  if (options.check) {
    for (const target of targets) {
      if (!fs.existsSync(target.outputPath)) continue;
      if (target.variant.generatedAnimations?.[target.animation] !== true) {
        result.issues.push(`${target.variant.id}/${target.animation}: file exists but generatedAnimations metadata is not true`);
      }
    }
    const selectedVariants = new Map(targets.map(target => [target.variant.id, target.variant]));
    for (const variant of selectedVariants.values()) {
      const expectedGenerated = (variant.animations || []).every(
        animation => variant.generatedAnimations?.[animation] === true
      );
      if (variant.generated !== expectedGenerated) {
        result.issues.push(`${variant.id}: generated metadata does not match its declared animation statuses`);
      }
      if (expectedGenerated && (variant.needsRegeneration === true || variant.regenerationQueuedAt != null)) {
        result.issues.push(`${variant.id}: complete identity still carries regeneration state`);
      }
    }
    result.ok = result.issues.length === 0;
    return result;
  }

  if (result.issues.length > 0) {
    result.ok = false;
    return result;
  }

  for (const entry of staged) {
    await writeFileAtomic(entry.outputPath, entry.buffer);
    completions.push({ id: entry.variant.id, animation: entry.animation, written: true });
    result.generated.push(`${entry.variant.id}/${entry.animation}`);
  }

  const nextRegistry = applyGeneratedAnimationStatus(registry, completions, options.now);
  const nextRegistryText = serializeJson(nextRegistry);
  if (nextRegistryText !== originalRegistryText) {
    const currentRegistryText = await fs.promises.readFile(registryPath, 'utf8');
    if (currentRegistryText !== originalRegistryText) {
      throw new Error('Player variant metadata changed during compilation; assets were written but metadata was not overwritten. Re-run the scoped command.');
    }
    await writeFileAtomic(registryPath, nextRegistryText);
  }

  result.ok = true;
  return result;
}

module.exports = {
  ALPHA_THRESHOLD,
  APPROVED_GOLDEN_STRIPS,
  FRAME_COUNT,
  FRAME_SIZE,
  INNER_SIZE,
  MOTION_PROFILES,
  SAFE_MARGIN,
  STRIP_HEIGHT,
  STRIP_WIDTH,
  SUPPORTED_ANIMATIONS,
  applyGeneratedAnimationStatus,
  compileAnimationBuffer,
  compileTargets,
  findAlphaBounds,
  getCanonicalPaths,
  hasRiffChunk,
  inspectStrip,
  isApprovedGoldenStrip,
  normalizeReference,
  selectTargets,
  serializeJson,
  validateMotionProfile,
  validateStripContract
};
