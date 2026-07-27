'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const {
  FRAME_COUNT,
  FRAME_SIZE,
  SAFE_MARGIN,
  STRIP_HEIGHT,
  findAlphaBounds,
  inspectStrip,
  validateStripContract
} = require('./playerAnimationCompiler');

const COMPILER_VERSION = '1.2.0';
const DEFAULT_REGISTRY = 'ai-image-metadata/characters/player-variants.json';
const DEFAULT_SPEC_DIRECTORY = 'ai-image-metadata/characters/player-authored-animations';
const DEFAULT_FALLBACK_PROVENANCE = 'ai-image-metadata/characters/player-identity-fallbacks.json';
const REFERENCE_SIZE = 512;
const INNER_SIZE = FRAME_SIZE - (SAFE_MARGIN * 2);
const ALPHA_THRESHOLD = 8;
const APPROVED_STATUS = /^approved(?:[-_]|$)/;

const MINIMUM_UNIQUE_POSES = Object.freeze({
  idle: 4,
  walk: 6,
  attack: 6,
  hurt: 6,
  death: 7,
  cast: 7,
  victory: 7,
  dead: 1
});

function applyApproval(spec, approvedAt = new Date().toISOString()) {
  if (!APPROVED_STATUS.test(String(spec.status || ''))) {
    spec.status = 'approved';
    spec.approvedAt = approvedAt;
  } else if (!spec.approvedAt) {
    spec.approvedAt = approvedAt;
  }
  return spec;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([first], [second]) => first.localeCompare(second))
        .map(([key, child]) => [key, stableValue(child)])
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function metadataSnapshot(variant) {
  return {
    id: variant.id,
    race: variant.race,
    gender: variant.gender,
    class: variant.class,
    isAdvanced: Boolean(variant.isAdvanced),
    inheritsFrom: variant.inheritsFrom || null,
    animations: variant.animations || [],
    visualTraits: variant.visualTraits || '',
    portraitReference: variant.portraitReference,
    seed: variant.seed
  };
}

function metadataFingerprint(variant) {
  return sha256(stableJson(metadataSnapshot(variant)));
}

function resolveProjectPath(projectRoot, relativePath, label = 'path') {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be a non-empty project-relative path`);
  }
  const resolved = path.resolve(projectRoot, relativePath);
  const rootPrefix = `${path.resolve(projectRoot)}${path.sep}`;
  if (!resolved.startsWith(rootPrefix)) throw new Error(`${label} escapes the project root: ${relativePath}`);
  if (fs.existsSync(resolved)) {
    const realRoot = fs.realpathSync(projectRoot);
    const realPath = fs.realpathSync(resolved);
    if (realPath !== realRoot && !realPath.startsWith(`${realRoot}${path.sep}`)) {
      throw new Error(`${label} resolves outside the project root: ${relativePath}`);
    }
  }
  return resolved;
}

function requireFiniteNumber(value, label, { integer = false, min = -Infinity, max = Infinity } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || (integer && !Number.isInteger(number)) || number < min || number > max) {
    const kind = integer ? 'integer' : 'number';
    throw new Error(`${label} must be a finite ${kind} between ${min} and ${max}`);
  }
  return number;
}

function validateAnchor(anchor) {
  const value = anchor || 'bottom-center';
  if (!['bottom-center', 'center', 'source-cell'].includes(value)) {
    throw new Error(`anchor must be bottom-center, center, or source-cell; got ${String(value)}`);
  }
  return value;
}

function validateVerticalAnchor(verticalAnchor, anchor) {
  if (verticalAnchor === undefined || verticalAnchor === null) {
    return anchor === 'source-cell' ? 'source-cell' : null;
  }
  if (anchor !== 'source-cell') {
    throw new Error('verticalAnchor is only supported with source-cell anchoring');
  }
  if (!['source-cell', 'bottom'].includes(verticalAnchor)) {
    throw new Error(`verticalAnchor must be source-cell or bottom; got ${String(verticalAnchor)}`);
  }
  return verticalAnchor;
}

function validateVariantPathSegments(variant) {
  for (const key of ['id', 'race', 'gender', 'class']) {
    if (typeof variant[key] !== 'string' || !/^[a-z0-9_]+$/.test(variant[key])) {
      throw new Error(`player metadata ${key} is not a safe path segment: ${String(variant[key])}`);
    }
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
}

async function imageEvidence(filePath) {
  const bytes = await fs.promises.readFile(filePath);
  const metadata = await sharp(bytes).metadata();
  return {
    bytes,
    sha256: sha256(bytes),
    dimensions: `${metadata.width}x${metadata.height}`,
    format: metadata.format || null,
    channels: metadata.channels || null,
    hasAlpha: Boolean(metadata.hasAlpha)
  };
}

async function atomicWrite(filePath, contents) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`
  );
  try {
    await fs.promises.writeFile(temporary, contents, { flag: 'wx' });
    await fs.promises.rename(temporary, filePath);
  } catch (error) {
    await fs.promises.unlink(temporary).catch(() => {});
    throw error;
  }
}

function alphaAt(data, pixelIndex, channels) {
  return data[(pixelIndex * channels) + channels - 1];
}

function connectedComponents(data, width, height, channels, threshold = ALPHA_THRESHOLD) {
  const pixelCount = width * height;
  const labels = new Int32Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const components = [];
  let nextLabel = 1;

  for (let start = 0; start < pixelCount; start += 1) {
    if (labels[start] !== 0 || alphaAt(data, start, channels) <= threshold) continue;
    let head = 0;
    let tail = 0;
    let count = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    labels[start] = nextLabel;
    queue[tail++] = start;

    while (head < tail) {
      const pixel = queue[head++];
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      count += 1;
      sumX += x;
      sumY += y;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      const neighbors = [];
      if (x > 0) neighbors.push(pixel - 1);
      if (x + 1 < width) neighbors.push(pixel + 1);
      if (y > 0) neighbors.push(pixel - width);
      if (y + 1 < height) neighbors.push(pixel + width);
      if (x > 0 && y > 0) neighbors.push(pixel - width - 1);
      if (x + 1 < width && y > 0) neighbors.push(pixel - width + 1);
      if (x > 0 && y + 1 < height) neighbors.push(pixel + width - 1);
      if (x + 1 < width && y + 1 < height) neighbors.push(pixel + width + 1);
      for (const neighbor of neighbors) {
        if (labels[neighbor] !== 0 || alphaAt(data, neighbor, channels) <= threshold) continue;
        labels[neighbor] = nextLabel;
        queue[tail++] = neighbor;
      }
    }

    components.push({
      label: nextLabel,
      count,
      centroidX: sumX / count,
      centroidY: sumY / count,
      minX,
      minY,
      maxX,
      maxY
    });
    nextLabel += 1;
  }

  return { labels, components };
}

function assignComponentToFrame(component, width, height, columns, rows) {
  const column = Math.max(0, Math.min(columns - 1, Math.floor(component.centroidX / (width / columns))));
  const row = Math.max(0, Math.min(rows - 1, Math.floor(component.centroidY / (height / rows))));
  return (row * columns) + column;
}

function extractComponentGroup(data, info, labels, components) {
  const minX = Math.min(...components.map(component => component.minX));
  const minY = Math.min(...components.map(component => component.minY));
  const maxX = Math.max(...components.map(component => component.maxX));
  const maxY = Math.max(...components.map(component => component.maxY));
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const output = Buffer.alloc(width * height * 4);
  const allowedLabels = new Set(components.map(component => component.label));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const sourcePixel = (y * info.width) + x;
      if (!allowedLabels.has(labels[sourcePixel])) continue;
      const sourceOffset = sourcePixel * info.channels;
      const targetOffset = (((y - minY) * width) + (x - minX)) * 4;
      output[targetOffset] = data[sourceOffset];
      output[targetOffset + 1] = data[sourceOffset + 1];
      output[targetOffset + 2] = data[sourceOffset + 2];
      output[targetOffset + 3] = data[sourceOffset + info.channels - 1];
    }
  }

  return {
    data: output,
    width,
    height,
    components,
    sourceBounds: { minX, minY, maxX, maxY }
  };
}

async function extractAtlasFrames(sourcePath, layout = {}) {
  const columns = requireFiniteNumber(layout.columns ?? 4, 'layout.columns', { integer: true, min: 1, max: FRAME_COUNT });
  const rows = requireFiniteNumber(layout.rows ?? 2, 'layout.rows', { integer: true, min: 1, max: FRAME_COUNT });
  const frameCount = columns * rows;
  if (frameCount !== FRAME_COUNT) {
    throw new Error(`authored atlas layout must contain exactly ${FRAME_COUNT} cells`);
  }

  const metadata = await sharp(sourcePath).metadata();
  if (metadata.format !== 'png' || !metadata.hasAlpha || metadata.channels !== 4) {
    throw new Error('accepted authored atlas source must be an RGBA PNG');
  }
  const { data, info } = await sharp(sourcePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const cornerAlpha = [
    data[3],
    data[((info.width - 1) * info.channels) + 3],
    data[(((info.height - 1) * info.width) * info.channels) + 3],
    data[((((info.height - 1) * info.width) + info.width - 1) * info.channels) + 3]
  ];
  if (cornerAlpha.some(alpha => alpha > ALPHA_THRESHOLD)) {
    throw new Error('accepted authored atlas source corners must be transparent');
  }
  const { labels, components } = connectedComponents(
    data,
    info.width,
    info.height,
    info.channels,
    requireFiniteNumber(layout.alphaThreshold ?? ALPHA_THRESHOLD, 'layout.alphaThreshold', {
      integer: true,
      min: 0,
      max: 254
    })
  );
  const minimumPixels = requireFiniteNumber(layout.minimumComponentPixels ?? 12, 'layout.minimumComponentPixels', {
    integer: true,
    min: 1,
    max: info.width * info.height
  });
  const minimumDominantRatio = requireFiniteNumber(
    layout.minimumDominantRatio ?? 0.35,
    'layout.minimumDominantRatio',
    { min: Number.EPSILON, max: 1 }
  );
  const minimumSubjectPixels = requireFiniteNumber(
    layout.minimumSubjectPixels ?? 64,
    'layout.minimumSubjectPixels',
    { integer: true, min: 1, max: info.width * info.height }
  );
  const frameComponents = Array.from({ length: FRAME_COUNT }, () => []);

  for (const component of components) {
    if (component.count < minimumPixels) continue;
    const frameIndex = assignComponentToFrame(component, info.width, info.height, columns, rows);
    frameComponents[frameIndex].push(component);
  }

  return frameComponents.map((group, frameIndex) => {
    if (group.length === 0) throw new Error(`authored atlas frame ${frameIndex} has no visible subject`);
    const totalPixels = group.reduce((sum, component) => sum + component.count, 0);
    if (totalPixels < minimumSubjectPixels) {
      throw new Error(`authored atlas frame ${frameIndex} has only ${totalPixels} visible pixels`);
    }
    const dominantPixels = Math.max(...group.map(component => component.count));
    const dominantRatio = dominantPixels / totalPixels;
    if (dominantRatio < minimumDominantRatio) {
      throw new Error(
        `authored atlas frame ${frameIndex} has no dominant subject (${(dominantRatio * 100).toFixed(1)}%)`
      );
    }
    const column = frameIndex % columns;
    const row = Math.floor(frameIndex / columns);
    return {
      ...extractComponentGroup(data, info, labels, group),
      dominantRatio,
      sourceFrameIndex: frameIndex,
      sourceCell: {
        left: column * (info.width / columns),
        top: row * (info.height / rows),
        width: info.width / columns,
        height: info.height / rows
      }
    };
  });
}

async function renderNormalizedFrame(
  frame,
  scale,
  anchor = 'bottom-center',
  placement = null,
  verticalAnchor = null
) {
  const width = Math.max(1, Math.round(frame.width * scale));
  const height = Math.max(1, Math.round(frame.height * scale));
  const resized = await sharp(frame.data, {
    raw: { width: frame.width, height: frame.height, channels: 4 }
  })
    .resize({ width, height, fit: 'fill', kernel: sharp.kernel.nearest })
    .png()
    .toBuffer();
  let left;
  let top;
  if (anchor === 'source-cell') {
    if (!placement || !frame.sourceBounds || !frame.sourceCell) {
      throw new Error('source-cell anchoring requires atlas cell placement metadata');
    }
    left = Math.round(
      ((frame.sourceBounds.minX - frame.sourceCell.left) * scale) + placement.offsetX
    );
    top = verticalAnchor === 'bottom'
      ? FRAME_SIZE - SAFE_MARGIN - height
      : Math.round(
        ((frame.sourceBounds.minY - frame.sourceCell.top) * scale) + placement.offsetY
      );
  } else {
    left = Math.max(SAFE_MARGIN, Math.min(
      FRAME_SIZE - SAFE_MARGIN - width,
      Math.round((FRAME_SIZE - width) / 2)
    ));
    const centeredTop = Math.round((FRAME_SIZE - height) / 2);
    const bottomTop = FRAME_SIZE - SAFE_MARGIN - height;
    top = Math.max(SAFE_MARGIN, Math.min(
      FRAME_SIZE - SAFE_MARGIN - height,
      anchor === 'center' ? centeredTop : bottomTop
    ));
  }

  if (left < SAFE_MARGIN || top < SAFE_MARGIN ||
      left + width > FRAME_SIZE - SAFE_MARGIN || top + height > FRAME_SIZE - SAFE_MARGIN) {
    throw new Error(`normalized authored frame violates the ${SAFE_MARGIN}px safety margin`);
  }

  return sharp({
    create: {
      width: FRAME_SIZE,
      height: FRAME_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: resized, left, top }])
    .png()
    .toBuffer();
}

async function poseSignature(frameBuffer) {
  const { data, info } = await sharp(frameBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bounds = findAlphaBounds(data, info.width, info.height, info.channels, 0);
  if (!bounds) return null;
  const normalized = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels }
  })
    .extract({ left: bounds.minX, top: bounds.minY, width: bounds.width, height: bounds.height })
    .resize({ width: 32, height: 32, fit: 'fill', kernel: sharp.kernel.nearest })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const mask = Buffer.alloc(32 * 32);
  for (let pixel = 0; pixel < mask.length; pixel += 1) mask[pixel] = normalized[(pixel * 4) + 3] > 32 ? 1 : 0;
  return sha256(mask);
}

async function compileAtlasAnimation(sourcePath, animation, config = {}) {
  const extracted = await extractAtlasFrames(sourcePath, config.layout);
  const anchor = validateAnchor(config.anchor);
  const verticalAnchor = validateVerticalAnchor(config.verticalAnchor, anchor);
  const frameMap = config.outputFrameMap || Array.from({ length: FRAME_COUNT }, (_, index) => index);
  if (!Array.isArray(frameMap) || frameMap.length !== FRAME_COUNT || frameMap.some(index => !Number.isInteger(index) || index < 0 || index >= extracted.length)) {
    throw new Error(`${animation} outputFrameMap must contain ${FRAME_COUNT} valid source frame indexes`);
  }

  const selected = frameMap.map(index => extracted[index]);
  let scale;
  let placement = null;
  if (anchor === 'source-cell') {
    const extents = selected.map(frame => ({
      minX: frame.sourceBounds.minX - frame.sourceCell.left,
      minY: frame.sourceBounds.minY - frame.sourceCell.top,
      maxX: (frame.sourceBounds.maxX + 1) - frame.sourceCell.left,
      maxY: (frame.sourceBounds.maxY + 1) - frame.sourceCell.top
    }));
    const minX = Math.min(...extents.map(extent => extent.minX));
    const minY = Math.min(...extents.map(extent => extent.minY));
    const maxX = Math.max(...extents.map(extent => extent.maxX));
    const maxY = Math.max(...extents.map(extent => extent.maxY));
    scale = Math.min(INNER_SIZE / (maxX - minX), INNER_SIZE / (maxY - minY));
    placement = {
      offsetX: SAFE_MARGIN + ((INNER_SIZE - ((maxX - minX) * scale)) / 2) - (minX * scale),
      offsetY: SAFE_MARGIN + ((INNER_SIZE - ((maxY - minY) * scale)) / 2) - (minY * scale)
    };
  } else {
    const maxWidth = Math.max(...selected.map(frame => frame.width));
    const maxHeight = Math.max(...selected.map(frame => frame.height));
    scale = Math.min(INNER_SIZE / maxWidth, INNER_SIZE / maxHeight);
  }
  const frames = [];
  for (const frame of selected) {
    frames.push(await renderNormalizedFrame(frame, scale, anchor, placement, verticalAnchor));
  }

  const poseSignatures = [];
  for (const frame of frames) poseSignatures.push(await poseSignature(frame));
  const uniquePoseCount = new Set(poseSignatures).size;
  const minimumUnique = requireFiniteNumber(
    config.minimumUniquePoses ?? MINIMUM_UNIQUE_POSES[animation] ?? 6,
    `${animation}.minimumUniquePoses`,
    { integer: true, min: 1, max: FRAME_COUNT }
  );
  if (uniquePoseCount < minimumUnique) {
    throw new Error(`${animation} has ${uniquePoseCount} translation-normalized poses; expected at least ${minimumUnique}`);
  }

  const buffer = await sharp({
    create: {
      width: FRAME_SIZE,
      height: STRIP_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite(frames.map((input, index) => ({ input, left: 0, top: index * FRAME_SIZE })))
    .webp({ lossless: true, alphaQuality: 100, effort: 6 })
    .toBuffer();
  const validation = await validateStripContract(buffer, { animation });
  if (!validation.ok) throw new Error(`${animation} failed runtime strip validation: ${validation.issues.join('; ')}`);

  return {
    buffer,
    frames,
    poseSignatures,
    sourceFrameIndexes: selected.map(frame => frame.sourceFrameIndex),
    sourceDominantRatios: selected.map(frame => Number(frame.dominantRatio.toFixed(6))),
    report: validation.report
  };
}

async function compileDeadAnimation(death) {
  const terminal = death.frames[FRAME_COUNT - 1];
  const frames = Array.from({ length: FRAME_COUNT }, () => terminal);
  const buffer = await sharp({
    create: {
      width: FRAME_SIZE,
      height: STRIP_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite(frames.map((input, index) => ({ input, left: 0, top: index * FRAME_SIZE })))
    .webp({ lossless: true, alphaQuality: 100, effort: 6 })
    .toBuffer();
  const validation = await validateStripContract(buffer, { animation: 'dead', requireMotion: true });
  if (!validation.ok) throw new Error(`dead failed runtime strip validation: ${validation.issues.join('; ')}`);
  return {
    buffer,
    frames,
    poseSignatures: Array.from({ length: FRAME_COUNT }, () => death.poseSignatures[FRAME_COUNT - 1]),
    sourceFrameIndexes: Array.from({ length: FRAME_COUNT }, () => death.sourceFrameIndexes[FRAME_COUNT - 1]),
    sourceDominantRatios: Array.from({ length: FRAME_COUNT }, () => death.sourceDominantRatios[FRAME_COUNT - 1]),
    report: validation.report
  };
}

async function compileReferenceBuffer(sourcePath) {
  const metadata = await sharp(sourcePath).metadata();
  const { data, info } = await sharp(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (metadata.format !== 'png') throw new Error(`authored reference source must be PNG, got ${metadata.format || 'unknown'}`);
  if (info.width !== info.height) {
    throw new Error(`authored reference source must be square, got ${info.width}x${info.height}`);
  }
  if (!metadata.hasAlpha || metadata.channels !== 4) {
    throw new Error('authored reference source must be RGBA with transparency');
  }
  const bounds = findAlphaBounds(data, info.width, info.height, info.channels, 0);
  if (!bounds) throw new Error('authored reference source has no visible subject');
  const corners = [
    data[3],
    data[((info.width - 1) * info.channels) + 3],
    data[(((info.height - 1) * info.width) * info.channels) + 3],
    data[((((info.height - 1) * info.width) + info.width - 1) * info.channels) + 3]
  ];
  if (corners.some(alpha => alpha > ALPHA_THRESHOLD)) {
    throw new Error('authored reference source corners must be transparent');
  }
  const minimumMargin = Math.max(1, Math.floor(info.width * 0.02));
  if (bounds.minX < minimumMargin || bounds.minY < minimumMargin ||
      bounds.maxX >= info.width - minimumMargin || bounds.maxY >= info.height - minimumMargin) {
    throw new Error(`authored reference source violates the ${minimumMargin}px proportional margin`);
  }
  if (bounds.alphaPixels / (info.width * info.height) > 0.75) {
    throw new Error('authored reference subject covers more than 75% of the canvas');
  }

  return sharp(sourcePath)
    .ensureAlpha()
    .resize({
      width: REFERENCE_SIZE,
      height: REFERENCE_SIZE,
      fit: 'contain',
      kernel: sharp.kernel.nearest,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false, force: true })
    .toBuffer();
}

async function decodedImageHash(input) {
  return sha256(await sharp(input).ensureAlpha().raw().toBuffer());
}

function outputPin(compiled) {
  return {
    encodedSha256: sha256(compiled.buffer),
    decodedSha256: compiled.report.stripHash,
    frameSha256: compiled.report.frames.map(frame => frame.hash),
    poseSha256: compiled.poseSignatures,
    sourceFrameIndexes: compiled.sourceFrameIndexes,
    sourceDominantRatios: compiled.sourceDominantRatios
  };
}

function comparePins(label, actual, expected, issues) {
  if (!expected || stableJson(actual) !== stableJson(expected)) issues.push(`${label} provenance pins differ`);
}

async function updateFallbackProvenance(projectRoot, variant, spec, referenceBuffer) {
  const provenancePath = resolveProjectPath(projectRoot, DEFAULT_FALLBACK_PROVENANCE, 'fallback provenance');
  const provenance = await readJson(provenancePath);
  const existing = provenance.variants?.[variant.id] || {};
  const portraitPath = resolveProjectPath(projectRoot, spec.reference.identitySource, 'identity source');
  const stylePath = resolveProjectPath(projectRoot, spec.reference.styleSource, 'style source');
  const chromaPath = resolveProjectPath(projectRoot, spec.reference.chromaSource, 'reference chroma source');
  const { data, info } = await sharp(referenceBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  provenance.variants = provenance.variants || {};
  provenance.variants[variant.id] = {
    compilerVersion: provenance.version,
    race: variant.race,
    gender: variant.gender,
    class: variant.class,
    method: 'openai-built-in-imagegen-authored-reference',
    semanticSignature: existing.semanticSignature || `${variant.class}-authored-equipment`,
    sourcePortrait: spec.reference.identitySource,
    sourcePortraitSha256: sha256(await fs.promises.readFile(portraitPath)),
    genderAnchor: null,
    genderAnchorSha256: null,
    genderAnchorReason: null,
    sourcePixelSha256: await decodedImageHash(resolveProjectPath(projectRoot, spec.reference.source, 'reference source')),
    output: `frontend/public/assets/characters/player/${variant.race}/${variant.gender}/${variant.class}/${variant.id}_reference.png`,
    outputSha256: sha256(referenceBuffer),
    dimensions: `${REFERENCE_SIZE}x${REFERENCE_SIZE}`,
    encoding: 'lossless-rgba-png-authored-source-nearest-downscale',
    alphaBounds512: findAlphaBounds(data, info.width, info.height, info.channels, 0),
    authoredCompilerVersion: COMPILER_VERSION,
    authoredPromptSha256: sha256(spec.reference.prompt || ''),
    authoredChromaSource: spec.reference.chromaSource,
    authoredChromaSourceSha256: sha256(await fs.promises.readFile(chromaPath)),
    authoredStyleSource: spec.reference.styleSource,
    authoredStyleSourceSha256: sha256(await fs.promises.readFile(stylePath)),
    authoredAnimationSpec: path.relative(projectRoot, spec.__filePath).split(path.sep).join('/'),
    authoredAnimationSpecSha256: sha256(await fs.promises.readFile(spec.__filePath))
  };
  await atomicWrite(provenancePath, Buffer.from(serializeJson(provenance)));
}

async function compileAuthoredVariant(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || path.join(__dirname, '../../..'));
  const id = String(options.id || '').trim().toLowerCase();
  if (!id) throw new Error('--id is required');
  if (options.approve && !options.updatePins) throw new Error('--approve requires --update-pins');
  if (options.approve && options.check) throw new Error('--approve and --check are mutually exclusive');
  const registryPath = path.resolve(options.registryPath || path.join(projectRoot, DEFAULT_REGISTRY));
  const specPath = path.resolve(options.specPath || path.join(projectRoot, DEFAULT_SPEC_DIRECTORY, `${id}.json`));
  const registry = await readJson(registryPath);
  const variant = (registry.variants || []).find(entry => entry.id === id);
  if (!variant) throw new Error(`unknown player variant: ${id}`);
  validateVariantPathSegments(variant);
  const specBytes = await fs.promises.readFile(specPath);
  const specInitialSha256 = sha256(specBytes);
  const spec = JSON.parse(specBytes.toString('utf8'));
  spec.__filePath = specPath;
  const issues = [];
  const inputSnapshots = [];

  if (!APPROVED_STATUS.test(String(spec.status || '')) && !options.approve) {
    return {
      ok: false,
      check: Boolean(options.check),
      id,
      issues: [`spec status ${String(spec.status || 'missing')} is not approved for canonical compilation`],
      generated: []
    };
  }

  const templatePath = resolveProjectPath(projectRoot, spec.template, 'authored template');
  const templateBytes = await fs.promises.readFile(templatePath);
  const template = JSON.parse(templateBytes.toString('utf8'));
  const templateSha256 = sha256(templateBytes);
  inputSnapshots.push([templatePath, templateSha256, 'authored template']);
  if (template.compiler?.version !== COMPILER_VERSION) {
    issues.push(`template compiler version ${String(template.compiler?.version || 'missing')} differs from ${COMPILER_VERSION}`);
  }
  if (!options.updatePins && spec.pins?.templateSha256 !== templateSha256) {
    issues.push('authored template provenance pin differs');
  }
  const profilePath = resolveProjectPath(projectRoot, spec.profileSource, 'animation profile');
  const profileBytes = await fs.promises.readFile(profilePath);
  const profile = JSON.parse(profileBytes.toString('utf8'));
  const profileSha256 = sha256(profileBytes);
  inputSnapshots.push([profilePath, profileSha256, 'animation profile']);
  if (profile.id !== spec.profile || profile.class !== variant.class || profile.templateId !== template.id) {
    issues.push('animation profile identity/class/template contract differs from the authored spec');
  }
  if (!options.updatePins && spec.pins?.profileSha256 !== profileSha256) {
    issues.push('animation profile provenance pin differs');
  }

  if (spec.id !== id) issues.push(`spec id ${String(spec.id)} does not match ${id}`);
  if (!options.updatePins && spec.compilerVersion !== COMPILER_VERSION) {
    issues.push(`spec compiler version ${String(spec.compilerVersion || 'missing')} differs from ${COMPILER_VERSION}`);
  }
  for (const key of ['race', 'gender', 'class']) {
    if (spec.identity?.[key] !== variant[key]) issues.push(`spec identity ${key} differs from player metadata`);
  }
  const fingerprint = metadataFingerprint(variant);
  if (!options.updatePins && spec.metadataFingerprint !== fingerprint) issues.push('player metadata fingerprint differs');

  const referenceSource = resolveProjectPath(projectRoot, spec.reference?.source, 'reference source');
  const referenceChromaPath = resolveProjectPath(projectRoot, spec.reference?.chromaSource, 'reference chroma source');
  const identitySourcePath = resolveProjectPath(projectRoot, spec.reference?.identitySource, 'identity source');
  const styleSourcePath = resolveProjectPath(projectRoot, spec.reference?.styleSource, 'style source');
  const referenceSourceEvidence = await imageEvidence(referenceSource);
  const referenceChromaEvidence = await imageEvidence(referenceChromaPath);
  const identitySourceEvidence = await imageEvidence(identitySourcePath);
  const styleSourceEvidence = await imageEvidence(styleSourcePath);
  inputSnapshots.push(
    [referenceSource, referenceSourceEvidence.sha256, 'reference source'],
    [referenceChromaPath, referenceChromaEvidence.sha256, 'reference chroma source'],
    [identitySourcePath, identitySourceEvidence.sha256, 'identity source'],
    [styleSourcePath, styleSourceEvidence.sha256, 'style source']
  );
  const referenceBuffer = await compileReferenceBuffer(referenceSource);
  const referencePin = {
    sourceSha256: referenceSourceEvidence.sha256,
    sourceDimensions: referenceSourceEvidence.dimensions,
    chromaSourceSha256: referenceChromaEvidence.sha256,
    chromaSourceDimensions: referenceChromaEvidence.dimensions,
    identitySourceSha256: identitySourceEvidence.sha256,
    identitySourceDimensions: identitySourceEvidence.dimensions,
    styleSourceSha256: styleSourceEvidence.sha256,
    styleSourceDimensions: styleSourceEvidence.dimensions,
    promptSha256: sha256(spec.reference?.prompt || ''),
    encodedSha256: sha256(referenceBuffer),
    decodedSha256: await decodedImageHash(referenceBuffer)
  };
  if (!options.updatePins) comparePins('reference', referencePin, spec.pins?.reference, issues);

  const compiledAnimations = {};
  for (const animation of variant.animations || []) {
    if (animation === 'dead') continue;
    const animationSpec = spec.animations?.[animation];
    if (!animationSpec?.source) {
      issues.push(`${animation} authored source is missing from the spec`);
      continue;
    }
    const sourcePath = resolveProjectPath(projectRoot, animationSpec.source, `${animation} source`);
    const chromaSourcePath = resolveProjectPath(
      projectRoot,
      animationSpec.chromaSource,
      `${animation} chroma source`
    );
    const sourceEvidence = await imageEvidence(sourcePath);
    const chromaSourceEvidence = await imageEvidence(chromaSourcePath);
    inputSnapshots.push(
      [sourcePath, sourceEvidence.sha256, `${animation} source`],
      [chromaSourcePath, chromaSourceEvidence.sha256, `${animation} chroma source`]
    );
    const compiled = await compileAtlasAnimation(sourcePath, animation, animationSpec);
    compiled.sourceSha256 = sourceEvidence.sha256;
    compiled.sourceDimensions = sourceEvidence.dimensions;
    compiled.chromaSourceSha256 = chromaSourceEvidence.sha256;
    compiled.chromaSourceDimensions = chromaSourceEvidence.dimensions;
    compiled.promptSha256 = sha256(animationSpec.prompt || '');
    compiledAnimations[animation] = compiled;
  }

  if (compiledAnimations.death && (variant.animations || []).includes('dead')) {
    const dead = await compileDeadAnimation(compiledAnimations.death);
    dead.sourceSha256 = compiledAnimations.death.sourceSha256;
    dead.sourceDimensions = compiledAnimations.death.sourceDimensions;
    dead.chromaSourceSha256 = compiledAnimations.death.chromaSourceSha256;
    dead.chromaSourceDimensions = compiledAnimations.death.chromaSourceDimensions;
    dead.promptSha256 = sha256(spec.animations?.dead?.prompt || 'derived-from-death-terminal-frame');
    compiledAnimations.dead = dead;
  }

  const animationPins = {};
  const decodedOwners = new Map();
  for (const [animation, compiled] of Object.entries(compiledAnimations)) {
    const pin = {
      sourceSha256: compiled.sourceSha256,
      sourceDimensions: compiled.sourceDimensions,
      chromaSourceSha256: compiled.chromaSourceSha256,
      chromaSourceDimensions: compiled.chromaSourceDimensions,
      promptSha256: compiled.promptSha256,
      ...outputPin(compiled)
    };
    animationPins[animation] = pin;
    const owner = decodedOwners.get(pin.decodedSha256);
    if (owner) issues.push(`${animation} duplicates authored output ${owner}`);
    else decodedOwners.set(pin.decodedSha256, animation);
    if (!options.updatePins) comparePins(animation, pin, spec.pins?.animations?.[animation], issues);
  }

  const outputDirectory = path.join(
    projectRoot,
    'frontend/public/assets/characters/player',
    variant.race,
    variant.gender,
    variant.class
  );
  const referenceOutput = path.join(outputDirectory, `${id}_reference.png`);

  if (options.check) {
    try {
      if (sha256(await fs.promises.readFile(referenceOutput)) !== referencePin.encodedSha256) {
        issues.push('canonical reference output differs from authored compilation');
      }
    } catch (error) {
      issues.push(`canonical reference output is ${error.code === 'ENOENT' ? 'missing' : error.message}`);
    }
    for (const [animation, compiled] of Object.entries(compiledAnimations)) {
      const outputPath = path.join(outputDirectory, `${id}_${animation}.webp`);
      try {
        if (sha256(await fs.promises.readFile(outputPath)) !== sha256(compiled.buffer)) {
          issues.push(`${animation} canonical output differs from authored compilation`);
        }
      } catch (error) {
        issues.push(`${animation} canonical output is ${error.code === 'ENOENT' ? 'missing' : error.message}`);
      }
    }
  }

  if (issues.length > 0) {
    return { ok: false, check: Boolean(options.check), id, issues, generated: [] };
  }

  for (const [inputPath, expectedHash, label] of inputSnapshots) {
    if (sha256(await fs.promises.readFile(inputPath)) !== expectedHash) {
      throw new Error(`${label} changed while authored compilation was running`);
    }
  }
  if (sha256(await fs.promises.readFile(specPath)) !== specInitialSha256) {
    throw new Error('authored animation spec changed while compilation was running');
  }

  const generated = [];
  if (!options.check) {
    await fs.promises.mkdir(outputDirectory, { recursive: true });
    const writes = [[referenceOutput, referenceBuffer]];
    for (const [animation, compiled] of Object.entries(compiledAnimations)) {
      writes.push([path.join(outputDirectory, `${id}_${animation}.webp`), compiled.buffer]);
    }
    const pendingWrites = [];
    for (const [outputPath, buffer] of writes) {
      if (fs.existsSync(outputPath)) {
        const existingHash = sha256(await fs.promises.readFile(outputPath));
        if (existingHash === sha256(buffer)) continue;
        if (!options.force) throw new Error(`${path.relative(projectRoot, outputPath)} exists; use --force`);
      }
      pendingWrites.push([outputPath, buffer]);
    }
    for (const [outputPath, buffer] of pendingWrites) {
      await atomicWrite(outputPath, buffer);
      generated.push(path.relative(projectRoot, outputPath).split(path.sep).join('/'));
    }

    if (options.updatePins) {
      spec.compilerVersion = COMPILER_VERSION;
      spec.metadataFingerprint = fingerprint;
      spec.pins = { templateSha256, profileSha256, reference: referencePin, animations: animationPins };
      if (options.approve) applyApproval(spec);
      delete spec.__filePath;
      await atomicWrite(specPath, Buffer.from(serializeJson(spec)));
      spec.__filePath = specPath;
    }
    await updateFallbackProvenance(projectRoot, variant, spec, referenceBuffer);
  }

  return {
    ok: true,
    check: Boolean(options.check),
    id,
    generated,
    templateSha256,
    profileSha256,
    referencePin,
    animationPins,
    issues: []
  };
}

module.exports = {
  ALPHA_THRESHOLD,
  APPROVED_STATUS,
  COMPILER_VERSION,
  DEFAULT_SPEC_DIRECTORY,
  MINIMUM_UNIQUE_POSES,
  applyApproval,
  compileAtlasAnimation,
  compileAuthoredVariant,
  compileDeadAnimation,
  compileReferenceBuffer,
  connectedComponents,
  extractAtlasFrames,
  metadataFingerprint,
  metadataSnapshot,
  poseSignature,
  resolveProjectPath,
  sha256,
  stableJson
};
