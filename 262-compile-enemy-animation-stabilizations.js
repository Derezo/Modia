#!/usr/bin/env node
'use strict';

/**
 * Deterministically stabilize selected enemy animation strips.
 *
 * A manifest entry either chooses one audited frame from an existing 64x512
 * idle strip (idle-only mode), or pins one canonical transparent PNG identity
 * reference (idle/attack/hit/death mode). Every declared animation derives
 * from that one identity source.
 *
 * Idle repeats the same pixels with only manifest-pinned 0/-1px vertical
 * translations. It never resizes, rotates, mirrors, interpolates, recolors, or
 * synthesizes idle pixels. Action animations use the project's deterministic
 * nearest-neighbor motion profiles while retaining the same reference source.
 *
 * Existing canonical assets are preserved unless --force is explicit. Source
 * and output pixels are pinned in the manifest so an unrelated edit fails
 * closed instead of being overwritten.
 */

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const {
  compileAnimationBuffer,
  normalizeReference,
  validateStripContract
} = require('./lib/playerAnimationCompiler');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const COMPILER_VERSION = 'enemy-animation-stabilizer-v1';
const FRAME_SIZE = 64;
const FRAME_COUNT = 8;
const STRIP_WIDTH = FRAME_SIZE;
const STRIP_HEIGHT = FRAME_SIZE * FRAME_COUNT;
const MINIMUM_TRANSPARENT_MARGIN = 4;
const MAX_FOREGROUND_COVERAGE = 0.6;
const MAX_NORMALIZED_CELL_SIZE = FRAME_SIZE - (MINIMUM_TRANSPARENT_MARGIN * 2);
const NORMALIZATION_POLICY = 'crop_alpha_bounds_uniform_nearest_downscale_center_bottom';
const SUPPORTED_ANIMATIONS = Object.freeze(['idle', 'attack', 'hit', 'death']);
const PLAYER_ANIMATION_NAMES = Object.freeze({ attack: 'attack', hit: 'hurt', death: 'death' });
const VERTICAL_OFFSETS = Object.freeze([0, 0, -1, -1, -1, -1, 0, 0]);
const STABILIZATION_CONTRACT = Object.freeze({
  frameWidth: FRAME_SIZE,
  frameHeight: FRAME_SIZE,
  framesPerAnimation: FRAME_COUNT,
  sheetWidth: STRIP_WIDTH,
  sheetHeight: STRIP_HEIGHT,
  layout: 'vertical_strip',
  animations: SUPPORTED_ANIMATIONS,
  identitySourceModes: ['reference_png', 'existing_idle_frame'],
  identityPolicy: 'one_manifest_pinned_source_per_enemy',
  idleMotion: {
    policy: 'integer_vertical_translation_only',
    verticalOffsets: VERTICAL_OFFSETS,
    maximumGroundAnchorDelta: 1,
    scaling: 'none',
    rotation: 'none',
    mirroring: 'none',
    interpolation: 'none'
  },
  optionalIdleNormalization: {
    policy: NORMALIZATION_POLICY,
    maximumCellSize: MAX_NORMALIZED_CELL_SIZE,
    scalePolicy: 'uniform_downscale_only',
    maximumOutputWidth: FRAME_SIZE - (MINIMUM_TRANSPARENT_MARGIN * 2),
    maximumOutputHeight: FRAME_SIZE - (MINIMUM_TRANSPARENT_MARGIN * 2) - 1,
    placement: 'horizontally_centered_bottom_anchor',
    baseGroundAnchor: FRAME_SIZE - MINIMUM_TRANSPARENT_MARGIN - 1,
    resampling: 'nearest-neighbor'
  },
  actionMotion: {
    policy: 'deterministic_player_motion_profiles',
    animationMap: PLAYER_ANIMATION_NAMES,
    resampling: 'nearest-neighbor'
  },
  minimumTransparentMargin: MINIMUM_TRANSPARENT_MARGIN,
  maximumForegroundCoverage: MAX_FOREGROUND_COVERAGE,
  encoding: 'lossless WebP'
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function roundCoverage(value) {
  return Number(value.toFixed(6));
}

function hasRiffChunk(buffer, expectedFourCc) {
  if (
    buffer.length < 12
    || buffer.toString('ascii', 0, 4) !== 'RIFF'
    || buffer.toString('ascii', 8, 12) !== 'WEBP'
  ) {
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

function isLosslessWebp(buffer) {
  return hasRiffChunk(buffer, 'VP8L');
}

function getFrame(rawStrip, frameIndex) {
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= FRAME_COUNT) {
    throw new Error(`sourceFrame must be an integer from 0 through ${FRAME_COUNT - 1}`);
  }
  const frame = Buffer.alloc(FRAME_SIZE * FRAME_SIZE * 4);
  for (let y = 0; y < FRAME_SIZE; y += 1) {
    const sourceStart = ((((frameIndex * FRAME_SIZE) + y) * STRIP_WIDTH) * 4);
    const targetStart = y * FRAME_SIZE * 4;
    rawStrip.copy(frame, targetStart, sourceStart, sourceStart + (FRAME_SIZE * 4));
  }
  return frame;
}

function analyzeFrame(frame) {
  let foregroundPixels = 0;
  let minX = FRAME_SIZE;
  let minY = FRAME_SIZE;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < FRAME_SIZE; y += 1) {
    for (let x = 0; x < FRAME_SIZE; x += 1) {
      const alpha = frame[((y * FRAME_SIZE + x) * 4) + 3];
      if (alpha === 0) continue;
      foregroundPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  const blank = foregroundPixels === 0;
  const bounds = blank ? null : {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
  const margins = blank ? null : {
    left: minX,
    top: minY,
    right: FRAME_SIZE - maxX - 1,
    bottom: FRAME_SIZE - maxY - 1
  };

  return {
    sha256: sha256(frame),
    foregroundPixels,
    foregroundCoverage: foregroundPixels / (FRAME_SIZE * FRAME_SIZE),
    bounds,
    margins,
    groundAnchor: blank ? null : maxY
  };
}

function canonicalizeTransparentPixels(frame) {
  if (!Buffer.isBuffer(frame) || frame.length !== FRAME_SIZE * FRAME_SIZE * 4) {
    throw new Error(`expected one ${FRAME_SIZE}x${FRAME_SIZE} RGBA frame`);
  }
  const canonical = Buffer.from(frame);
  for (let offset = 0; offset < canonical.length; offset += 4) {
    if (canonical[offset + 3] !== 0) continue;
    canonical[offset] = 0;
    canonical[offset + 1] = 0;
    canonical[offset + 2] = 0;
  }
  return canonical;
}

function analyzeEncodedPoseRoundTrip(preEncodeFrame, decodedFrame) {
  const before = canonicalizeTransparentPixels(preEncodeFrame);
  const after = canonicalizeTransparentPixels(decodedFrame);
  let alphaMismatchPixels = 0;
  let opaqueRgbChangedPixels = 0;
  let partialAlphaPixels = 0;
  let partialAlphaRgbChangedPixels = 0;
  let partialAlphaRgbChangedChannels = 0;
  let maximumPartialAlphaChannelDelta = 0;
  let transparentRgbCanonicalizedPixels = 0;

  for (let offset = 0; offset < before.length; offset += 4) {
    const beforeAlpha = before[offset + 3];
    const decodedAlpha = decodedFrame[offset + 3];
    if (beforeAlpha !== decodedAlpha) alphaMismatchPixels += 1;
    if (
      decodedAlpha === 0
      && (decodedFrame[offset] !== 0 || decodedFrame[offset + 1] !== 0 || decodedFrame[offset + 2] !== 0)
    ) {
      transparentRgbCanonicalizedPixels += 1;
    }

    let pixelRgbChanged = false;
    for (let channel = 0; channel < 3; channel += 1) {
      if (before[offset + channel] === after[offset + channel]) continue;
      pixelRgbChanged = true;
      if (beforeAlpha > 0 && beforeAlpha < 255) {
        partialAlphaRgbChangedChannels += 1;
        maximumPartialAlphaChannelDelta = Math.max(
          maximumPartialAlphaChannelDelta,
          Math.abs(before[offset + channel] - after[offset + channel])
        );
      }
    }
    if (beforeAlpha === 255 && pixelRgbChanged) opaqueRgbChangedPixels += 1;
    if (beforeAlpha > 0 && beforeAlpha < 255) {
      partialAlphaPixels += 1;
      if (pixelRgbChanged) partialAlphaRgbChangedPixels += 1;
    }
  }

  return {
    canonicalDecodedFrame: after,
    report: {
      preEncodeFrameSha256: sha256(before),
      decodedCanonicalFrameSha256: sha256(after),
      alphaMismatchPixels,
      opaqueRgbChangedPixels,
      partialAlphaPixels,
      partialAlphaRgbChangedPixels,
      partialAlphaRgbChangedChannels,
      maximumPartialAlphaChannelDelta,
      transparentRgbCanonicalizedPixels
    }
  };
}

async function decodeAnimationStrip(input) {
  const encoded = Buffer.isBuffer(input) ? input : await fs.readFile(input);
  const image = sharp(encoded, { failOn: 'error' });
  const metadata = await image.metadata();
  if (
    metadata.format !== 'webp'
    || metadata.width !== STRIP_WIDTH
    || metadata.height !== STRIP_HEIGHT
  ) {
    throw new Error(
      `expected a ${STRIP_WIDTH}x${STRIP_HEIGHT} WebP idle strip, received `
      + `${metadata.format || 'unknown'} ${metadata.width || '?'}x${metadata.height || '?'}`
    );
  }
  if (!metadata.hasAlpha) throw new Error('enemy animation strip must contain an alpha channel');

  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) throw new Error(`expected decoded RGBA pixels, received ${info.channels} channels`);
  return { encoded, data, metadata };
}

async function inspectAnimationStrip(input) {
  const decoded = await decodeAnimationStrip(input);
  const canonicalFrames = Array.from(
    { length: FRAME_COUNT },
    (_, frameIndex) => canonicalizeTransparentPixels(getFrame(decoded.data, frameIndex))
  );
  const frames = canonicalFrames.map(frame => analyzeFrame(frame));
  return {
    format: decoded.metadata.format,
    compression: isLosslessWebp(decoded.encoded) ? 'lossless' : 'lossy',
    width: decoded.metadata.width,
    height: decoded.metadata.height,
    hasAlpha: decoded.metadata.hasAlpha,
    fileSha256: sha256(decoded.encoded),
    decodedSha256: sha256(joinFrames(canonicalFrames)),
    frames
  };
}

function translateFrame(source, dy) {
  if (!Number.isInteger(dy) || ![0, -1].includes(dy)) {
    throw new Error(`unsupported idle translation dy=${dy}; only 0 and -1 are allowed`);
  }
  const output = Buffer.alloc(FRAME_SIZE * FRAME_SIZE * 4);
  for (let sourceY = 0; sourceY < FRAME_SIZE; sourceY += 1) {
    const targetY = sourceY + dy;
    if (targetY < 0 || targetY >= FRAME_SIZE) continue;
    const sourceStart = sourceY * FRAME_SIZE * 4;
    const targetStart = targetY * FRAME_SIZE * 4;
    source.copy(output, targetStart, sourceStart, sourceStart + (FRAME_SIZE * 4));
  }
  return output;
}

function normalizeSelectedFrame(sourceFrame, normalizedCellSize) {
  if (
    !Number.isInteger(normalizedCellSize)
    || normalizedCellSize <= 0
    || normalizedCellSize > MAX_NORMALIZED_CELL_SIZE
  ) {
    throw new Error(`normalizedCellSize must be an integer from 1 through ${MAX_NORMALIZED_CELL_SIZE}`);
  }
  const canonicalSource = canonicalizeTransparentPixels(sourceFrame);
  const sourceReport = analyzeFrame(canonicalSource);
  if (!sourceReport.bounds) throw new Error('selected source frame is blank');
  const sourceBounds = sourceReport.bounds;
  const maximumWidth = Math.min(
    normalizedCellSize,
    FRAME_SIZE - (MINIMUM_TRANSPARENT_MARGIN * 2)
  );
  const maximumHeight = Math.min(
    normalizedCellSize,
    FRAME_SIZE - (MINIMUM_TRANSPARENT_MARGIN * 2) - 1
  );
  const uniformScale = Math.min(
    1,
    maximumWidth / sourceBounds.width,
    maximumHeight / sourceBounds.height
  );
  const outputWidth = Math.max(1, Math.floor((sourceBounds.width * uniformScale) + 1e-9));
  const outputHeight = Math.max(1, Math.floor((sourceBounds.height * uniformScale) + 1e-9));
  const scaled = Buffer.alloc(outputWidth * outputHeight * 4);

  const nearestSourceCoordinate = (coordinate, maximum) => Math.max(
    0,
    Math.min(maximum - 1, Math.round((((coordinate + 0.5) / uniformScale) - 0.5)))
  );
  for (let y = 0; y < outputHeight; y += 1) {
    const sourceY = sourceBounds.top + nearestSourceCoordinate(y, sourceBounds.height);
    for (let x = 0; x < outputWidth; x += 1) {
      const sourceX = sourceBounds.left + nearestSourceCoordinate(x, sourceBounds.width);
      const sourceOffset = ((sourceY * FRAME_SIZE + sourceX) * 4);
      const targetOffset = ((y * outputWidth + x) * 4);
      canonicalSource.copy(scaled, targetOffset, sourceOffset, sourceOffset + 4);
    }
  }

  const baseGroundAnchor = FRAME_SIZE - MINIMUM_TRANSPARENT_MARGIN - 1;
  const left = Math.floor((FRAME_SIZE - outputWidth) / 2);
  const top = baseGroundAnchor - outputHeight + 1;
  const output = Buffer.alloc(FRAME_SIZE * FRAME_SIZE * 4);
  for (let y = 0; y < outputHeight; y += 1) {
    const sourceStart = y * outputWidth * 4;
    const targetStart = (((top + y) * FRAME_SIZE + left) * 4);
    scaled.copy(output, targetStart, sourceStart, sourceStart + (outputWidth * 4));
  }

  const outputReport = analyzeFrame(output);
  if (!outputReport.bounds) throw new Error('normalization removed every visible source pixel');
  return {
    frame: output,
    report: {
      policy: NORMALIZATION_POLICY,
      normalizedCellSize,
      sourceBounds,
      uniformScale: Number(uniformScale.toFixed(8)),
      outputSize: { width: outputWidth, height: outputHeight },
      outputBounds: outputReport.bounds,
      outputFrameSha256: outputReport.sha256
    }
  };
}

function joinFrames(frames) {
  if (frames.length !== FRAME_COUNT) throw new Error(`expected exactly ${FRAME_COUNT} frames`);
  const strip = Buffer.alloc(STRIP_WIDTH * STRIP_HEIGHT * 4);
  frames.forEach((frame, frameIndex) => {
    for (let y = 0; y < FRAME_SIZE; y += 1) {
      const sourceStart = y * FRAME_SIZE * 4;
      const targetStart = ((((frameIndex * FRAME_SIZE) + y) * STRIP_WIDTH) * 4);
      frame.copy(strip, targetStart, sourceStart, sourceStart + (FRAME_SIZE * 4));
    }
  });
  return strip;
}

async function encodeLosslessStrip(rawStrip) {
  return sharp(rawStrip, {
    raw: { width: STRIP_WIDTH, height: STRIP_HEIGHT, channels: 4 }
  })
    .webp({ lossless: true, alphaQuality: 100, effort: 6 })
    .toBuffer();
}

function validateSelectedFrame(report) {
  const problems = [];
  if (report.foregroundPixels === 0) problems.push('selected source frame is blank');
  if (report.foregroundCoverage > MAX_FOREGROUND_COVERAGE) {
    problems.push(
      `selected source frame foreground covers ${(report.foregroundCoverage * 100).toFixed(1)}% `
      + `(maximum ${(MAX_FOREGROUND_COVERAGE * 100).toFixed(1)}%)`
    );
  }
  if (report.margins) {
    for (const edge of ['left', 'right', 'bottom']) {
      if (report.margins[edge] < MINIMUM_TRANSPARENT_MARGIN) {
        problems.push(`selected source frame ${edge} margin is less than ${MINIMUM_TRANSPARENT_MARGIN}px`);
      }
    }
    const requiredTop = MINIMUM_TRANSPARENT_MARGIN + Math.abs(Math.min(...VERTICAL_OFFSETS));
    if (report.margins.top < requiredTop) {
      problems.push(`selected source frame top margin must be at least ${requiredTop}px for the -1px breath`);
    }
  }
  return problems;
}

function summarizeSource(decoded, sourceFrame, selected) {
  return {
    fileSha256: sha256(decoded.encoded),
    decodedSha256: sha256(decoded.data),
    selectedFrameSha256: selected.sha256,
    selectedFrameForegroundCoverage: roundCoverage(selected.foregroundCoverage),
    selectedFrameBounds: selected.bounds,
    selectedFrameMargins: selected.margins,
    selectedFrameGroundAnchor: selected.groundAnchor,
    sourceFrame
  };
}

function summarizeOutput(inspection) {
  return {
    fileSha256: inspection.fileSha256,
    decodedSha256: inspection.decodedSha256,
    frameSha256: inspection.frames.map(frame => frame.sha256),
    frameForegroundCoverage: inspection.frames.map(frame => roundCoverage(frame.foregroundCoverage)),
    frameBounds: inspection.frames.map(frame => frame.bounds),
    frameMargins: inspection.frames.map(frame => frame.margins),
    groundAnchors: inspection.frames.map(frame => frame.groundAnchor)
  };
}

async function stabilizeIdleFrame(selectedPixels, options = {}) {
  const canonicalSelectedPixels = canonicalizeTransparentPixels(selectedPixels);
  const sourceSelected = analyzeFrame(canonicalSelectedPixels);
  let basePixels = canonicalSelectedPixels;
  let normalization = null;
  if (options.normalizedCellSize != null) {
    const normalized = normalizeSelectedFrame(canonicalSelectedPixels, options.normalizedCellSize);
    basePixels = normalized.frame;
    normalization = normalized.report;
  }
  const selected = analyzeFrame(basePixels);
  const sourceProblems = validateSelectedFrame(selected);
  if (sourceProblems.length > 0) throw new Error(sourceProblems.join('; '));

  const frames = VERTICAL_OFFSETS.map(dy => translateFrame(basePixels, dy));
  const rawOutput = joinFrames(frames);
  const buffer = await encodeLosslessStrip(rawOutput);
  const decodedOutput = await decodeAnimationStrip(buffer);
  const decodedFrames = Array.from(
    { length: FRAME_COUNT },
    (_, frameIndex) => getFrame(decodedOutput.data, frameIndex)
  );
  const roundTrip = analyzeEncodedPoseRoundTrip(basePixels, decodedFrames[0]);
  const canonicalEncodedPose = roundTrip.canonicalDecodedFrame;
  const canonicalEncodedPoseReport = analyzeFrame(canonicalEncodedPose);
  const canonicalEncodedBounds = canonicalEncodedPoseReport.bounds || selected.bounds;
  const inspection = await inspectAnimationStrip(buffer);

  if (inspection.compression !== 'lossless') throw new Error('compiler did not emit lossless WebP');
  const frameProblems = [];
  if (roundTrip.report.alphaMismatchPixels > 0) {
    frameProblems.push('encoded frame 0 changes one or more alpha values');
  }
  if (roundTrip.report.opaqueRgbChangedPixels > 0) {
    frameProblems.push('encoded frame 0 changes RGB on one or more opaque pixels');
  }
  if (
    canonicalEncodedPoseReport.foregroundPixels !== selected.foregroundPixels
    || JSON.stringify(canonicalEncodedPoseReport.bounds) !== JSON.stringify(selected.bounds)
  ) {
    frameProblems.push('encoded frame 0 changes the source alpha bounds or foreground count');
  }
  inspection.frames.forEach((frame, frameIndex) => {
    const dy = VERTICAL_OFFSETS[frameIndex];
    const actualPixels = canonicalizeTransparentPixels(decodedFrames[frameIndex]);
    const expectedPixels = translateFrame(canonicalEncodedPose, dy);
    const expected = analyzeFrame(expectedPixels);
    if (!actualPixels.equals(expectedPixels)) {
      frameProblems.push(`frame ${frameIndex} is not the declared translation of encoded frame 0`);
    }
    if (frame.sha256 !== expected.sha256) {
      frameProblems.push(`frame ${frameIndex} canonical hash differs from its declared translation`);
    }
    if (frame.foregroundPixels !== canonicalEncodedPoseReport.foregroundPixels) {
      frameProblems.push(`frame ${frameIndex} clips or adds visible pixels`);
    }
    if (frame.foregroundCoverage > MAX_FOREGROUND_COVERAGE) {
      frameProblems.push(`frame ${frameIndex} exceeds maximum foreground coverage`);
    }
    if (!frame.margins || Math.min(...Object.values(frame.margins)) < MINIMUM_TRANSPARENT_MARGIN) {
      frameProblems.push(`frame ${frameIndex} lacks the required transparent margin`);
    }
    if (
      frame.bounds
      && (
        frame.bounds.left !== canonicalEncodedBounds.left
        || frame.bounds.top !== canonicalEncodedBounds.top + dy
        || frame.bounds.width !== canonicalEncodedBounds.width
        || frame.bounds.height !== canonicalEncodedBounds.height
      )
    ) {
      frameProblems.push(`frame ${frameIndex} is not an exact vertical translation of the selected frame`);
    }
    if (frame.groundAnchor !== canonicalEncodedPoseReport.groundAnchor + dy) {
      frameProblems.push(`frame ${frameIndex} ground anchor does not match its declared breathing offset`);
    }
  });
  if (frameProblems.length > 0) throw new Error(frameProblems.join('; '));

  return {
    buffer,
    report: {
      compilerVersion: COMPILER_VERSION,
      verticalOffsets: [...VERTICAL_OFFSETS],
      selectedFrame: sourceSelected,
      baseFrame: selected,
      encodedPoseRoundTrip: roundTrip.report,
      ...(normalization ? { normalization } : {}),
      output: summarizeOutput(inspection)
    }
  };
}

/** Compile one audited frame from an existing idle strip without writing it. */
async function stabilizeIdleStrip(input, sourceFrame, options = {}) {
  const decoded = await decodeAnimationStrip(input);
  const selectedPixels = getFrame(decoded.data, sourceFrame);
  const compiled = await stabilizeIdleFrame(selectedPixels, options);
  compiled.report.source = summarizeSource(decoded, sourceFrame, compiled.report.selectedFrame);
  return compiled;
}

async function inspectReferencePng(input) {
  const encoded = Buffer.isBuffer(input) ? input : await fs.readFile(input);
  const image = sharp(encoded, { failOn: 'error' });
  const metadata = await image.metadata();
  if (metadata.format !== 'png') {
    throw new Error(`canonical enemy identity reference must be PNG, received ${metadata.format || 'unknown'}`);
  }
  if (!metadata.hasAlpha) throw new Error('canonical enemy identity reference must contain an alpha channel');
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let visiblePixels = 0;
  let transparentPixels = 0;
  for (let offset = 3; offset < data.length; offset += 4) {
    if (data[offset] === 0) transparentPixels += 1;
    else visiblePixels += 1;
  }
  if (visiblePixels === 0) throw new Error('canonical enemy identity reference is blank');
  if (transparentPixels === 0) throw new Error('canonical enemy identity reference has no transparent background');
  return {
    format: metadata.format,
    width: info.width,
    height: info.height,
    hasAlpha: metadata.hasAlpha,
    fileSha256: sha256(encoded),
    decodedSha256: sha256(data)
  };
}

async function referenceIdleFrame(referenceInput) {
  const normalized = await normalizeReference(referenceInput);
  const left = Math.round((FRAME_SIZE - normalized.width) / 2);
  const top = FRAME_SIZE - MINIMUM_TRANSPARENT_MARGIN - normalized.height;
  const { data } = await sharp({
    create: {
      width: FRAME_SIZE,
      height: FRAME_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: normalized.input, left, top }])
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

async function validateCompiledAction(buffer, animation) {
  const mappedAnimation = PLAYER_ANIMATION_NAMES[animation];
  const validation = await validateStripContract(buffer, {
    animation: mappedAnimation,
    requireMotion: true
  });
  if (!validation.ok) throw new Error(validation.issues.join('; '));
  const inspection = await inspectAnimationStrip(buffer);
  const problems = [];
  inspection.frames.forEach((frame, frameIndex) => {
    if (frame.foregroundCoverage > MAX_FOREGROUND_COVERAGE) {
      problems.push(`frame ${frameIndex} exceeds maximum foreground coverage`);
    }
    if (!frame.margins || Math.min(...Object.values(frame.margins)) < MINIMUM_TRANSPARENT_MARGIN) {
      problems.push(`frame ${frameIndex} lacks the required transparent margin`);
    }
  });
  if (problems.length > 0) throw new Error(problems.join('; '));
  return inspection;
}

async function compileReferenceAnimation({ referenceInput, id, biome, animation }) {
  if (!SUPPORTED_ANIMATIONS.includes(animation)) {
    throw new Error(`unsupported enemy animation: ${animation}`);
  }
  if (animation === 'idle') {
    const selectedPixels = await referenceIdleFrame(referenceInput);
    return stabilizeIdleFrame(selectedPixels);
  }
  const mappedAnimation = PLAYER_ANIMATION_NAMES[animation];
  const buffer = await compileAnimationBuffer({
    referencePath: referenceInput,
    id: `enemy_${biome}_${id}`,
    animation: mappedAnimation
  });
  const inspection = await validateCompiledAction(buffer, animation);
  return {
    buffer,
    report: {
      compilerVersion: COMPILER_VERSION,
      motionProfile: mappedAnimation,
      output: summarizeOutput(inspection)
    }
  };
}

function stripSourceHashes(inspection) {
  return {
    fileSha256: inspection.fileSha256,
    decodedSha256: inspection.decodedSha256
  };
}

async function createExistingFrameManifestEntry({
  input,
  id,
  biome,
  sourceFrame,
  normalizedCellSize
}) {
  const compiled = await stabilizeIdleStrip(input, sourceFrame, { normalizedCellSize });
  return {
    id,
    biome,
    identitySource: {
      mode: 'existing_idle_frame',
      sourceFrame,
      selectedFrameSha256: compiled.report.source.selectedFrameSha256,
      selectedFrameForegroundCoverage: compiled.report.source.selectedFrameForegroundCoverage,
      selectedFrameBounds: compiled.report.source.selectedFrameBounds,
      selectedFrameMargins: compiled.report.source.selectedFrameMargins,
      selectedFrameGroundAnchor: compiled.report.source.selectedFrameGroundAnchor,
      ...(compiled.report.normalization ? { normalization: compiled.report.normalization } : {})
    },
    animations: {
      idle: {
        assetPath: `/assets/characters/enemies/${biome}/${id}/${id}_idle.webp`,
        source: {
          fileSha256: compiled.report.source.fileSha256,
          decodedSha256: compiled.report.source.decodedSha256
        },
        output: compiled.report.output
      }
    }
  };
}

async function createReferenceManifestEntry({
  referenceInput,
  referencePath,
  currentAssets,
  id,
  biome
}) {
  const reference = await inspectReferencePng(referenceInput);
  const animations = {};
  for (const [animation, currentInput] of Object.entries(currentAssets || {})) {
    if (!SUPPORTED_ANIMATIONS.includes(animation)) throw new Error(`unsupported enemy animation: ${animation}`);
    const current = await inspectAnimationStrip(currentInput);
    const compiled = await compileReferenceAnimation({ referenceInput, id, biome, animation });
    animations[animation] = {
      assetPath: `/assets/characters/enemies/${biome}/${id}/${id}_${animation}.webp`,
      source: stripSourceHashes(current),
      output: compiled.report.output
    };
  }
  if (Object.keys(animations).length === 0) throw new Error('reference manifest entry requires at least one animation');

  return {
    id,
    biome,
    identitySource: {
      mode: 'reference_png',
      referencePath,
      fileSha256: reference.fileSha256,
      decodedSha256: reference.decodedSha256,
      width: reference.width,
      height: reference.height
    },
    animations
  };
}

function isHash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isBox(value) {
  return Boolean(
    value
    && Number.isInteger(value.left)
    && Number.isInteger(value.top)
    && Number.isInteger(value.width)
    && Number.isInteger(value.height)
    && value.width > 0
    && value.height > 0
  );
}

function isMargins(value) {
  return Boolean(
    value
    && ['left', 'top', 'right', 'bottom'].every(edge => (
      Number.isInteger(value[edge]) && value[edge] >= MINIMUM_TRANSPARENT_MARGIN
    ))
  );
}

function isNonnegativeMargins(value) {
  return Boolean(
    value
    && ['left', 'top', 'right', 'bottom'].every(edge => (
      Number.isInteger(value[edge]) && value[edge] >= 0
    ))
  );
}

function validateNormalization(normalization, identitySource, label) {
  const problems = [];
  if (normalization.policy !== NORMALIZATION_POLICY) {
    problems.push(`${label} normalization policy must be ${NORMALIZATION_POLICY}`);
  }
  if (
    !Number.isInteger(normalization.normalizedCellSize)
    || normalization.normalizedCellSize <= 0
    || normalization.normalizedCellSize > MAX_NORMALIZED_CELL_SIZE
  ) {
    problems.push(`${label} normalizedCellSize must be from 1 through ${MAX_NORMALIZED_CELL_SIZE}`);
  }
  if (JSON.stringify(normalization.sourceBounds) !== JSON.stringify(identitySource.selectedFrameBounds)) {
    problems.push(`${label} normalization source bounds do not match the selected frame`);
  }
  if (
    typeof normalization.uniformScale !== 'number'
    || normalization.uniformScale <= 0
    || normalization.uniformScale > 1
  ) {
    problems.push(`${label} normalization must use one downscale-only factor`);
  }
  if (
    !normalization.outputSize
    || !Number.isInteger(normalization.outputSize.width)
    || !Number.isInteger(normalization.outputSize.height)
    || normalization.outputSize.width <= 0
    || normalization.outputSize.height <= 0
    || normalization.outputSize.width > MAX_NORMALIZED_CELL_SIZE
    || normalization.outputSize.height > MAX_NORMALIZED_CELL_SIZE - 1
  ) {
    problems.push(`${label} normalization has invalid output size`);
  }
  if (!isBox(normalization.outputBounds)) problems.push(`${label} normalization has invalid output bounds`);
  if (!isHash(normalization.outputFrameSha256)) problems.push(`${label} normalization has no output frame hash`);

  if (
    Number.isInteger(normalization.normalizedCellSize)
    && isBox(identitySource.selectedFrameBounds)
    && normalization.outputSize
  ) {
    const maximumWidth = Math.min(normalization.normalizedCellSize, MAX_NORMALIZED_CELL_SIZE);
    const maximumHeight = Math.min(normalization.normalizedCellSize, MAX_NORMALIZED_CELL_SIZE - 1);
    const expectedScale = Math.min(
      1,
      maximumWidth / identitySource.selectedFrameBounds.width,
      maximumHeight / identitySource.selectedFrameBounds.height
    );
    const expectedSize = {
      width: Math.max(1, Math.floor((identitySource.selectedFrameBounds.width * expectedScale) + 1e-9)),
      height: Math.max(1, Math.floor((identitySource.selectedFrameBounds.height * expectedScale) + 1e-9))
    };
    if (normalization.uniformScale !== Number(expectedScale.toFixed(8))) {
      problems.push(`${label} normalization scale does not match its source bounds and cell size`);
    }
    if (JSON.stringify(normalization.outputSize) !== JSON.stringify(expectedSize)) {
      problems.push(`${label} normalization output size does not match its uniform scale`);
    }
    const expectedBounds = {
      left: Math.floor((FRAME_SIZE - expectedSize.width) / 2),
      top: (FRAME_SIZE - MINIMUM_TRANSPARENT_MARGIN) - expectedSize.height,
      width: expectedSize.width,
      height: expectedSize.height
    };
    if (JSON.stringify(normalization.outputBounds) !== JSON.stringify(expectedBounds)) {
      problems.push(`${label} normalization is not centered on the stable bottom anchor`);
    }
  }
  return problems;
}

function validateOutputPins(output, label) {
  const problems = [];
  for (const key of ['fileSha256', 'decodedSha256']) {
    if (!isHash(output?.[key])) problems.push(`${label} output.${key} must be a SHA-256 hash`);
  }
  if (
    !Array.isArray(output?.frameSha256)
    || output.frameSha256.length !== FRAME_COUNT
    || output.frameSha256.some(hash => !isHash(hash))
  ) {
    problems.push(`${label} has invalid output frame hashes`);
  }
  if (
    !Array.isArray(output?.frameForegroundCoverage)
    || output.frameForegroundCoverage.length !== FRAME_COUNT
    || output.frameForegroundCoverage.some(value => (
      typeof value !== 'number' || value <= 0 || value > MAX_FOREGROUND_COVERAGE
    ))
  ) {
    problems.push(`${label} has invalid output frame coverage`);
  }
  if (
    !Array.isArray(output?.frameBounds)
    || output.frameBounds.length !== FRAME_COUNT
    || output.frameBounds.some(value => !isBox(value))
  ) {
    problems.push(`${label} has invalid output frame bounds`);
  }
  if (
    !Array.isArray(output?.frameMargins)
    || output.frameMargins.length !== FRAME_COUNT
    || output.frameMargins.some(value => !isMargins(value))
  ) {
    problems.push(`${label} has invalid output frame margins`);
  }
  if (
    !Array.isArray(output?.groundAnchors)
    || output.groundAnchors.length !== FRAME_COUNT
    || output.groundAnchors.some(value => !Number.isInteger(value))
  ) {
    problems.push(`${label} has invalid output ground anchors`);
  }
  return problems;
}

function validateManifest(manifest) {
  const problems = [];
  if (manifest.schemaVersion !== 1) problems.push('schemaVersion must be 1');
  if (manifest.compilerVersion !== COMPILER_VERSION) {
    problems.push(`compilerVersion must be ${COMPILER_VERSION}`);
  }
  if (JSON.stringify(manifest.contract) !== JSON.stringify(STABILIZATION_CONTRACT)) {
    problems.push('contract does not match the compiler motion, framing, and encoding constants');
  }
  if (!Array.isArray(manifest.stabilizations)) {
    problems.push('stabilizations must be an array');
    return problems;
  }

  const paths = new Set();
  const identities = new Set();
  for (const entry of manifest.stabilizations) {
    const label = `${entry.biome}/${entry.id}`;
    if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(entry.id || '')) problems.push(`${label} has an invalid id`);
    if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(entry.biome || '')) problems.push(`${label} has an invalid biome`);
    if (identities.has(label)) problems.push(`duplicate stabilization identity: ${label}`);
    identities.add(label);

    const identitySource = entry.identitySource;
    if (identitySource?.mode === 'existing_idle_frame') {
      if (!Number.isInteger(identitySource.sourceFrame) || identitySource.sourceFrame < 0 || identitySource.sourceFrame >= FRAME_COUNT) {
        problems.push(`${label} sourceFrame must be an integer from 0 through ${FRAME_COUNT - 1}`);
      }
      if (!isHash(identitySource.selectedFrameSha256)) problems.push(`${label} has no selected-frame hash`);
      if (
        typeof identitySource.selectedFrameForegroundCoverage !== 'number'
        || identitySource.selectedFrameForegroundCoverage <= 0
        || identitySource.selectedFrameForegroundCoverage > (identitySource.normalization ? 1 : MAX_FOREGROUND_COVERAGE)
      ) {
        problems.push(`${label} has invalid selected-frame foreground coverage`);
      }
      if (!isBox(identitySource.selectedFrameBounds)) problems.push(`${label} has invalid selected-frame bounds`);
      if (
        identitySource.normalization
          ? !isNonnegativeMargins(identitySource.selectedFrameMargins)
          : !isMargins(identitySource.selectedFrameMargins)
      ) {
        problems.push(`${label} has invalid selected-frame margins`);
      }
      if (!Number.isInteger(identitySource.selectedFrameGroundAnchor)) {
        problems.push(`${label} has an invalid selected-frame ground anchor`);
      }
      if (identitySource.normalization) {
        problems.push(...validateNormalization(identitySource.normalization, identitySource, label));
      }
      if (JSON.stringify(Object.keys(entry.animations || {})) !== JSON.stringify(['idle'])) {
        problems.push(`${label} existing_idle_frame mode may compile idle only`);
      }
    } else if (identitySource?.mode === 'reference_png') {
      if (
        typeof identitySource.referencePath !== 'string'
        || path.isAbsolute(identitySource.referencePath)
        || !identitySource.referencePath.endsWith('.png')
      ) {
        problems.push(`${label} referencePath must be a project-relative PNG path`);
      }
      for (const key of ['fileSha256', 'decodedSha256']) {
        if (!isHash(identitySource[key])) problems.push(`${label} identitySource.${key} must be a SHA-256 hash`);
      }
      if (!Number.isInteger(identitySource.width) || identitySource.width <= 0) problems.push(`${label} has invalid reference width`);
      if (!Number.isInteger(identitySource.height) || identitySource.height <= 0) problems.push(`${label} has invalid reference height`);
    } else {
      problems.push(`${label} has an unsupported identity source mode`);
    }

    const animationEntries = Object.entries(entry.animations || {});
    if (animationEntries.length === 0) problems.push(`${label} must declare at least one animation`);
    for (const [animation, target] of animationEntries) {
      const animationLabel = `${label}/${animation}`;
      if (!SUPPORTED_ANIMATIONS.includes(animation)) {
        problems.push(`${animationLabel} is not supported`);
        continue;
      }
      const expectedPath = `/assets/characters/enemies/${entry.biome}/${entry.id}/${entry.id}_${animation}.webp`;
      if (target.assetPath !== expectedPath) problems.push(`${animationLabel} assetPath is not canonical`);
      if (paths.has(target.assetPath)) problems.push(`duplicate stabilization path: ${target.assetPath}`);
      paths.add(target.assetPath);
      for (const key of ['fileSha256', 'decodedSha256']) {
        if (!isHash(target.source?.[key])) problems.push(`${animationLabel} source.${key} must be a SHA-256 hash`);
      }
      problems.push(...validateOutputPins(target.output, animationLabel));
    }
  }

  const stripCount = manifest.stabilizations.reduce(
    (total, entry) => total + Object.keys(entry.animations || {}).length,
    0
  );
  if (manifest.coverage?.identities !== manifest.stabilizations.length) {
    problems.push('coverage.identities does not match the stabilization entries');
  }
  if (manifest.coverage?.strips !== stripCount) {
    problems.push('coverage.strips does not match the declared animations');
  }
  return problems;
}

function resolveAssetPath(projectRoot, assetPath) {
  if (typeof assetPath !== 'string' || !assetPath.startsWith('/assets/')) {
    throw new Error(`invalid public asset path: ${String(assetPath)}`);
  }
  const publicRoot = path.join(projectRoot, 'frontend', 'public');
  const resolved = path.resolve(publicRoot, assetPath.slice(1));
  if (!resolved.startsWith(`${publicRoot}${path.sep}`)) {
    throw new Error(`asset path escapes the public directory: ${assetPath}`);
  }
  return resolved;
}

function resolveReferencePath(projectRoot, referencePath) {
  if (typeof referencePath !== 'string' || path.isAbsolute(referencePath)) {
    throw new Error(`invalid project-relative reference path: ${String(referencePath)}`);
  }
  const resolved = path.resolve(projectRoot, referencePath);
  if (!resolved.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error(`reference path escapes the project: ${referencePath}`);
  }
  return resolved;
}

function compareObject(actual, expected, label) {
  return JSON.stringify(actual) === JSON.stringify(expected) ? [] : [`${label} differs from the manifest`];
}

function compareExistingFrameIdentity(identitySource, compiled) {
  const source = compiled.report.source;
  const actual = {
    mode: 'existing_idle_frame',
    sourceFrame: source.sourceFrame,
    selectedFrameSha256: source.selectedFrameSha256,
    selectedFrameForegroundCoverage: source.selectedFrameForegroundCoverage,
    selectedFrameBounds: source.selectedFrameBounds,
    selectedFrameMargins: source.selectedFrameMargins,
    selectedFrameGroundAnchor: source.selectedFrameGroundAnchor,
    ...(compiled.report.normalization ? { normalization: compiled.report.normalization } : {})
  };
  return compareObject(actual, identitySource, 'selected idle identity frame');
}

function compareCurrentOutput(entry, inspection) {
  const actual = summarizeOutput(inspection);
  const problems = compareObject(actual, entry.output, 'current output report');
  if (inspection.compression !== 'lossless') problems.push('current output is not lossless WebP');
  return problems;
}

function appendSelectors(target, rawValue) {
  if (rawValue == null) throw new Error('--id requires a value');
  for (const value of String(rawValue).split(',')) {
    const normalized = value.trim().toLowerCase();
    if (normalized && !target.includes(normalized)) target.push(normalized);
  }
  if (target.length === 0) throw new Error('--id requires a value');
}

function appendAnimations(target, rawValue) {
  if (rawValue == null) throw new Error('--animation requires a value');
  for (const value of String(rawValue).split(',')) {
    const normalized = value.trim().toLowerCase();
    if (!normalized) continue;
    if (!SUPPORTED_ANIMATIONS.includes(normalized)) {
      throw new Error(`unsupported enemy animation: ${normalized}`);
    }
    if (!target.includes(normalized)) target.push(normalized);
  }
  if (target.length === 0) throw new Error('--animation requires a value');
}

function selectEntries(entries, options) {
  if (options.all) return { selected: entries, unknown: [] };
  const selected = [];
  const unknown = [];
  for (const selector of options.ids || []) {
    const matches = entries.filter(entry => (
      entry.id === selector || `${entry.biome}/${entry.id}` === selector
    ));
    if (matches.length === 0) unknown.push(selector);
    for (const entry of matches) {
      if (!selected.includes(entry)) selected.push(entry);
    }
  }
  return { selected, unknown };
}

async function writeFileAtomic(file, buffer) {
  const temporary = `${file}.enemy-animation-stabilizer-${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, buffer);
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

function selectedAnimations(entry, options) {
  const declared = Object.keys(entry.animations || {});
  if (!options.animations?.length) return { animations: declared, missing: [] };
  return {
    animations: options.animations.filter(animation => declared.includes(animation)),
    missing: options.animations.filter(animation => !declared.includes(animation))
  };
}

async function validateReferenceIdentity(projectRoot, entry) {
  const file = resolveReferencePath(projectRoot, entry.identitySource.referencePath);
  const inspection = await inspectReferencePng(file);
  const actual = {
    mode: 'reference_png',
    referencePath: entry.identitySource.referencePath,
    fileSha256: inspection.fileSha256,
    decodedSha256: inspection.decodedSha256,
    width: inspection.width,
    height: inspection.height
  };
  return {
    file,
    problems: compareObject(actual, entry.identitySource, 'canonical identity reference')
  };
}

async function runAnimationStabilizations(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || PROJECT_ROOT);
  const manifestPath = path.resolve(options.manifestPath || path.join(
    projectRoot,
    'ai-image-metadata',
    'characters',
    'enemy-animation-stabilizations.json'
  ));
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const manifestProblems = validateManifest(manifest);
  const mode = options.check ? 'check' : (options.force ? 'compile' : 'preserve');
  if (manifestProblems.length > 0) {
    return {
      ok: false,
      mode,
      coverage: { selectedIdentities: 0, selectedStrips: 0, valid: 0, compiled: 0, preserved: 0, protected: 0 },
      results: [],
      problems: manifestProblems.map(message => ({ scope: 'manifest', message }))
    };
  }

  const selection = selectEntries(manifest.stabilizations, options);
  const results = [];
  const pendingWrites = [];
  for (const selector of selection.unknown) {
    results.push({ selector, status: 'unknown', problems: ['no manifest entry matches this selector'] });
  }

  for (const entry of selection.selected) {
    const animationSelection = selectedAnimations(entry, options);
    for (const animation of animationSelection.missing) {
      results.push({
        id: entry.id,
        biome: entry.biome,
        animation,
        status: 'unknown',
        problems: ['animation is not declared for this manifest identity']
      });
    }

    let referenceInput = null;
    if (entry.identitySource.mode === 'reference_png') {
      try {
        const reference = await validateReferenceIdentity(projectRoot, entry);
        referenceInput = reference.file;
        if (reference.problems.length > 0) {
          for (const animation of animationSelection.animations) {
            results.push({
              id: entry.id,
              biome: entry.biome,
              animation,
              status: 'protected',
              problems: reference.problems
            });
          }
          continue;
        }
      } catch (error) {
        for (const animation of animationSelection.animations) {
          results.push({
            id: entry.id,
            biome: entry.biome,
            animation,
            status: 'invalid',
            problems: [error.message]
          });
        }
        continue;
      }
    }

    for (const animation of animationSelection.animations) {
      const target = entry.animations[animation];
      const file = resolveAssetPath(projectRoot, target.assetPath);
      let inspection;
      try {
        inspection = await inspectAnimationStrip(file);
      } catch (error) {
        results.push({
          id: entry.id,
          biome: entry.biome,
          animation,
          assetPath: target.assetPath,
          status: 'invalid',
          problems: [error.message]
        });
        continue;
      }

      const currentMatchesOutput = (
        inspection.fileSha256 === target.output.fileSha256
        && inspection.decodedSha256 === target.output.decodedSha256
      );
      if (currentMatchesOutput) {
        const problems = compareCurrentOutput(target, inspection);
        results.push({
          id: entry.id,
          biome: entry.biome,
          animation,
          assetPath: target.assetPath,
          status: problems.length === 0 ? 'valid' : 'invalid',
          problems
        });
        continue;
      }

      const currentMatchesSource = (
        inspection.fileSha256 === target.source.fileSha256
        && inspection.decodedSha256 === target.source.decodedSha256
      );
      if (!currentMatchesSource) {
        results.push({
          id: entry.id,
          biome: entry.biome,
          animation,
          assetPath: target.assetPath,
          status: 'protected',
          problems: ['current pixels match neither the pinned source nor output; refusing to overwrite user work']
        });
        continue;
      }

      let compiled;
      try {
        compiled = entry.identitySource.mode === 'reference_png'
          ? await compileReferenceAnimation({
            referenceInput,
            id: entry.id,
            biome: entry.biome,
            animation
          })
          : await stabilizeIdleStrip(file, entry.identitySource.sourceFrame, {
            normalizedCellSize: entry.identitySource.normalization?.normalizedCellSize
          });
      } catch (error) {
        results.push({
          id: entry.id,
          biome: entry.biome,
          animation,
          assetPath: target.assetPath,
          status: 'invalid',
          problems: [error.message]
        });
        continue;
      }
      const problems = compareObject(compiled.report.output, target.output, 'compiled output report');
      if (entry.identitySource.mode === 'existing_idle_frame') {
        problems.push(...compareExistingFrameIdentity(entry.identitySource, compiled));
      }
      if (problems.length > 0) {
        results.push({
          id: entry.id,
          biome: entry.biome,
          animation,
          assetPath: target.assetPath,
          status: 'invalid',
          problems
        });
        continue;
      }

      if (options.check) {
        results.push({
          id: entry.id,
          biome: entry.biome,
          animation,
          assetPath: target.assetPath,
          status: 'needs-stabilization',
          problems: ['pinned source is still present; run the same --id with --force to replace it']
        });
      } else if (!options.force) {
        results.push({
          id: entry.id,
          biome: entry.biome,
          animation,
          assetPath: target.assetPath,
          status: 'preserved',
          problems: []
        });
      } else {
        pendingWrites.push({ file, buffer: compiled.buffer });
        results.push({
          id: entry.id,
          biome: entry.biome,
          animation,
          assetPath: target.assetPath,
          status: 'compiled',
          problems: []
        });
      }
    }
  }

  const problems = results.flatMap(result => result.problems.map(message => ({
    scope: result.id
      ? `${result.biome}/${result.id}${result.animation ? `/${result.animation}` : ''}`
      : `selector:${result.selector}`,
    assetPath: result.assetPath,
    message
  })));
  if (problems.length === 0 && options.force && !options.check) {
    for (const write of pendingWrites) await writeFileAtomic(write.file, write.buffer);
  }

  return {
    ok: problems.length === 0,
    mode,
    coverage: {
      selectedIdentities: selection.selected.length,
      selectedStrips: results.filter(result => result.id && result.assetPath).length,
      valid: results.filter(result => result.status === 'valid').length,
      compiled: problems.length === 0 ? results.filter(result => result.status === 'compiled').length : 0,
      preserved: results.filter(result => result.status === 'preserved').length,
      needsStabilization: results.filter(result => result.status === 'needs-stabilization').length,
      protected: results.filter(result => result.status === 'protected').length
    },
    results,
    problems
  };
}

function parseArgs(argv) {
  const options = {
    ids: [],
    animations: [],
    all: false,
    check: false,
    force: false,
    json: false,
    help: false,
    projectRoot: PROJECT_ROOT,
    manifestPath: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--all') options.all = true;
    else if (arg === '--id') appendSelectors(options.ids, argv[++index]);
    else if (arg.startsWith('--id=')) appendSelectors(options.ids, arg.slice('--id='.length));
    else if (arg === '--animation' || arg === '--animations') appendAnimations(options.animations, argv[++index]);
    else if (arg.startsWith('--animation=')) appendAnimations(options.animations, arg.slice('--animation='.length));
    else if (arg.startsWith('--animations=')) appendAnimations(options.animations, arg.slice('--animations='.length));
    else if (arg === '--check') options.check = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--root' || arg === '--project-root') {
      const value = argv[++index];
      if (!value) throw new Error(`${arg} requires a path`);
      options.projectRoot = path.resolve(value);
    } else if (arg.startsWith('--root=')) options.projectRoot = path.resolve(arg.slice('--root='.length));
    else if (arg.startsWith('--project-root=')) options.projectRoot = path.resolve(arg.slice('--project-root='.length));
    else if (arg === '--manifest') {
      const value = argv[++index];
      if (!value) throw new Error('--manifest requires a path');
      options.manifestPath = path.resolve(value);
    } else if (arg.startsWith('--manifest=')) options.manifestPath = path.resolve(arg.slice('--manifest='.length));
    else throw new Error(`unknown option: ${arg}`);
  }

  if (options.check && options.force) throw new Error('--check and --force cannot be combined');
  const scopes = [options.all, options.ids.length > 0].filter(Boolean).length;
  if (!options.help && scopes !== 1) throw new Error('choose exactly one scope: --id <enemy> or --all');
  return options;
}

function formatReport(report) {
  const lines = [
    `Enemy animation stabilization ${report.mode}`,
    `Status: ${report.ok ? 'PASS' : 'FAIL'}`,
    `Coverage: ${report.coverage.selectedIdentities} identities / ${report.coverage.selectedStrips} strips / `
      + `${report.coverage.valid} valid / `
      + `${report.coverage.compiled} compiled / ${report.coverage.preserved} preserved`
  ];
  for (const result of report.results) {
    const label = result.id
      ? `${result.biome}/${result.id}${result.animation ? `/${result.animation}` : ''}`
      : result.selector;
    lines.push(`  - ${label}: ${result.status}`);
  }
  for (const problem of report.problems) lines.push(`  ! ${problem.scope}: ${problem.message}`);
  return lines.join('\n');
}

function showHelp() {
  return `Deterministically stabilize audited enemy animation strips

Usage:
  node scripts/ai-images/compile-enemy-animation-stabilizations.js --id <enemy> [options]
  node scripts/ai-images/compile-enemy-animation-stabilizations.js --all --check

Options:
  --id <id[,id]>              Select manifest entries by id or biome/id (repeatable)
  --animation <name[,name]>   Limit to idle, attack, hit, and/or death
  --all                       Select every manifest entry
  --check                     Validate selected canonical outputs without writing
  --force                     Explicitly replace pinned source strips
  --json                      Emit a machine-readable report
  --root <dir>                Use another Modia checkout
  --manifest <file>           Use another stabilization manifest
  --help, -h                  Show this help

Without --force, selected existing sources are validated and preserved.`;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(showHelp());
    return;
  }

  try {
    const report = await runAnimationStabilizations(options);
    console.log(options.json ? JSON.stringify(report, null, 2) : formatReport(report));
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`Enemy animation stabilization failed: ${error.stack || error.message}`);
    process.exitCode = 2;
  }
}

module.exports = {
  COMPILER_VERSION,
  FRAME_COUNT,
  FRAME_SIZE,
  MAX_FOREGROUND_COVERAGE,
  MAX_NORMALIZED_CELL_SIZE,
  MINIMUM_TRANSPARENT_MARGIN,
  NORMALIZATION_POLICY,
  PLAYER_ANIMATION_NAMES,
  STABILIZATION_CONTRACT,
  SUPPORTED_ANIMATIONS,
  VERTICAL_OFFSETS,
  analyzeFrame,
  analyzeEncodedPoseRoundTrip,
  canonicalizeTransparentPixels,
  compileReferenceAnimation,
  createExistingFrameManifestEntry,
  createReferenceManifestEntry,
  inspectReferencePng,
  inspectAnimationStrip,
  normalizeSelectedFrame,
  parseArgs,
  runAnimationStabilizations,
  stabilizeIdleFrame,
  stabilizeIdleStrip,
  translateFrame,
  validateManifest
};

if (require.main === module) main();
