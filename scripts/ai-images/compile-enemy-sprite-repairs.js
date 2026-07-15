#!/usr/bin/env node

/**
 * Deterministic compiler for the small set of canonical enemy strips whose
 * generated art does not leave enough transparent framing for runtime use.
 *
 * The repair manifest pins both the original decoded pixels and the compiled
 * result. A strip is only written when it still matches its recorded source;
 * already-compiled output is left byte-for-byte untouched and unknown edits
 * fail closed. Every frame in one animation receives the same nearest-neighbor
 * scale so temporal proportions, palette, and enemy identity remain stable.
 */

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const COMPILER_VERSION = 'enemy-transparent-frame-v1';
const FRAME_SIZE = 64;
const FRAME_COUNT = 8;
const STRIP_WIDTH = FRAME_SIZE;
const STRIP_HEIGHT = FRAME_SIZE * FRAME_COUNT;
const MINIMUM_TRANSPARENT_MARGIN = 4;
const VALIDATOR_MAX_FOREGROUND_COVERAGE = 0.6;
const TARGET_MAX_FOREGROUND_COVERAGE = 0.58;
const REPAIR_CONTRACT = Object.freeze({
  frameWidth: FRAME_SIZE,
  frameHeight: FRAME_SIZE,
  framesPerAnimation: FRAME_COUNT,
  sheetWidth: STRIP_WIDTH,
  sheetHeight: STRIP_HEIGHT,
  layout: 'vertical_strip',
  minimumTransparentMargin: MINIMUM_TRANSPARENT_MARGIN,
  sequenceScalePolicy: 'uniform_across_frames',
  resampling: 'nearest-neighbor',
  encoding: 'lossless WebP',
  validatorMaxForegroundCoverage: VALIDATOR_MAX_FOREGROUND_COVERAGE,
  targetMaxForegroundCoverage: TARGET_MAX_FOREGROUND_COVERAGE
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function roundCoverage(value) {
  return Number(value.toFixed(6));
}

function isLosslessWebp(buffer) {
  return buffer.indexOf(Buffer.from('VP8L')) >= 0;
}

function getFrame(rawStrip, frameIndex, channels = 4) {
  const frame = Buffer.alloc(FRAME_SIZE * FRAME_SIZE * channels);
  for (let y = 0; y < FRAME_SIZE; y += 1) {
    const sourceStart = ((((frameIndex * FRAME_SIZE) + y) * STRIP_WIDTH) * channels);
    const targetStart = y * FRAME_SIZE * channels;
    rawStrip.copy(
      frame,
      targetStart,
      sourceStart,
      sourceStart + (FRAME_SIZE * channels)
    );
  }
  return frame;
}

function analyzeFrame(frame, channels = 4) {
  const alphaOffset = channels - 1;
  let foregroundPixels = 0;
  let minX = FRAME_SIZE;
  let minY = FRAME_SIZE;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < FRAME_SIZE; y += 1) {
    for (let x = 0; x < FRAME_SIZE; x += 1) {
      const alpha = frame[((y * FRAME_SIZE + x) * channels) + alphaOffset];
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
    margins
  };
}

async function decodeStrip(input) {
  const encoded = Buffer.isBuffer(input) ? input : await fs.readFile(input);
  const image = sharp(encoded, { failOn: 'error' });
  const metadata = await image.metadata();
  if (
    metadata.format !== 'webp'
    || metadata.width !== STRIP_WIDTH
    || metadata.height !== STRIP_HEIGHT
  ) {
    throw new Error(
      `expected a ${STRIP_WIDTH}x${STRIP_HEIGHT} WebP strip, received `
      + `${metadata.format || 'unknown'} ${metadata.width || '?'}x${metadata.height || '?'}`
    );
  }
  if (!metadata.hasAlpha) throw new Error('enemy strip must contain an alpha channel');

  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) throw new Error(`expected decoded RGBA pixels, received ${info.channels} channels`);
  return { encoded, data, metadata };
}

async function inspectEnemyStrip(input) {
  const decoded = await decodeStrip(input);
  const frames = [];
  for (let frameIndex = 0; frameIndex < FRAME_COUNT; frameIndex += 1) {
    frames.push(analyzeFrame(getFrame(decoded.data, frameIndex)));
  }
  return {
    format: decoded.metadata.format,
    compression: isLosslessWebp(decoded.encoded) ? 'lossless' : 'lossy',
    width: decoded.metadata.width,
    height: decoded.metadata.height,
    hasAlpha: decoded.metadata.hasAlpha,
    fileSha256: sha256(decoded.encoded),
    decodedSha256: sha256(decoded.data),
    frames
  };
}

async function resizeFrame(frame, size) {
  return sharp(frame, {
    raw: { width: FRAME_SIZE, height: FRAME_SIZE, channels: 4 }
  })
    .resize(size, size, { fit: 'fill', kernel: sharp.kernel.nearest })
    .raw()
    .toBuffer();
}

function placeFrame(resizedFrame, size) {
  const output = Buffer.alloc(FRAME_SIZE * FRAME_SIZE * 4);
  const left = Math.floor((FRAME_SIZE - size) / 2);
  const top = Math.floor((FRAME_SIZE - size) / 2);
  for (let y = 0; y < size; y += 1) {
    const sourceStart = y * size * 4;
    const targetStart = (((top + y) * FRAME_SIZE + left) * 4);
    resizedFrame.copy(output, targetStart, sourceStart, sourceStart + (size * 4));
  }
  return output;
}

async function transformFrames(sourceFrames, size) {
  const transformed = [];
  for (const frame of sourceFrames) {
    transformed.push(placeFrame(await resizeFrame(frame, size), size));
  }
  return transformed;
}

async function chooseNormalizedCellSize(sourceFrames, options = {}) {
  const minimumMargin = options.minimumMargin ?? MINIMUM_TRANSPARENT_MARGIN;
  const targetCoverage = options.targetCoverage ?? TARGET_MAX_FOREGROUND_COVERAGE;
  const maximumSize = FRAME_SIZE - (minimumMargin * 2);

  for (let size = maximumSize; size > 0; size -= 1) {
    const frames = await transformFrames(sourceFrames, size);
    const reports = frames.map(frame => analyzeFrame(frame));
    if (reports.every(report => (
      report.foregroundPixels > 0
      && report.foregroundCoverage <= targetCoverage
      && Math.min(...Object.values(report.margins)) >= minimumMargin
    ))) {
      return { size, frames, reports };
    }
  }
  throw new Error('could not normalize enemy strip within the transparent-frame contract');
}

function joinFrames(frames) {
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

/** Normalize one canonical strip without writing it to disk. */
async function normalizeEnemyStrip(input, options = {}) {
  const decoded = await decodeStrip(input);
  const sourceFrames = Array.from(
    { length: FRAME_COUNT },
    (_, frameIndex) => getFrame(decoded.data, frameIndex)
  );
  const sourceReports = sourceFrames.map(frame => analyzeFrame(frame));
  if (sourceReports.some(report => report.foregroundPixels === 0)) {
    throw new Error('enemy strip contains a blank frame');
  }

  const originalFlaggedFrames = sourceReports
    .map((report, frame) => ({ frame, coverage: report.foregroundCoverage }))
    .filter(value => value.coverage > VALIDATOR_MAX_FOREGROUND_COVERAGE)
    .map(value => value.frame);
  if (originalFlaggedFrames.length === 0) {
    throw new Error('enemy strip does not need transparent-frame normalization');
  }

  const selected = await chooseNormalizedCellSize(sourceFrames, options);
  const rawOutput = joinFrames(selected.frames);
  const buffer = await encodeLosslessStrip(rawOutput);
  const output = await inspectEnemyStrip(buffer);

  if (output.compression !== 'lossless') throw new Error('compiler did not emit lossless WebP');
  if (output.frames.some(frame => frame.foregroundCoverage > TARGET_MAX_FOREGROUND_COVERAGE)) {
    throw new Error('compiled strip exceeds target foreground coverage');
  }

  return {
    buffer,
    report: {
      compilerVersion: COMPILER_VERSION,
      normalizedCellSize: selected.size,
      uniformScale: selected.size / FRAME_SIZE,
      originalFlaggedFrames,
      source: {
        fileSha256: sha256(decoded.encoded),
        decodedSha256: sha256(decoded.data),
        frameSha256: sourceReports.map(frame => frame.sha256),
        frameForegroundCoverage: sourceReports.map(frame => roundCoverage(frame.foregroundCoverage))
      },
      output: {
        fileSha256: output.fileSha256,
        decodedSha256: output.decodedSha256,
        frameSha256: output.frames.map(frame => frame.sha256),
        frameForegroundCoverage: output.frames.map(frame => roundCoverage(frame.foregroundCoverage)),
        frameMargins: output.frames.map(frame => frame.margins)
      }
    }
  };
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

function validateManifest(manifest) {
  const problems = [];
  if (manifest.schemaVersion !== 1) problems.push('schemaVersion must be 1');
  if (manifest.compilerVersion !== COMPILER_VERSION) {
    problems.push(`compilerVersion must be ${COMPILER_VERSION}`);
  }
  if (JSON.stringify(manifest.contract) !== JSON.stringify(REPAIR_CONTRACT)) {
    problems.push('contract does not match the compiler framing and encoding constants');
  }
  if (!Array.isArray(manifest.repairs) || manifest.repairs.length === 0) {
    problems.push('repairs must be a non-empty array');
    return problems;
  }

  const paths = new Set();
  for (const repair of manifest.repairs) {
    const expectedSuffix = `/characters/enemies/${repair.biome}/${repair.id}/${repair.id}_${repair.animation}.webp`;
    if (!repair.assetPath?.endsWith(expectedSuffix)) {
      problems.push(`${repair.id}/${repair.animation} assetPath does not match its canonical identity`);
    }
    if (paths.has(repair.assetPath)) problems.push(`duplicate repair path: ${repair.assetPath}`);
    paths.add(repair.assetPath);
    if (!/^[a-f0-9]{64}$/.test(repair.source?.decodedSha256 || '')) {
      problems.push(`${repair.id}/${repair.animation} has no pinned source decoded hash`);
    }
    if (!/^[a-f0-9]{64}$/.test(repair.source?.fileSha256 || '')) {
      problems.push(`${repair.id}/${repair.animation} has no pinned source file hash`);
    }
    if (!/^[a-f0-9]{64}$/.test(repair.output?.decodedSha256 || '')) {
      problems.push(`${repair.id}/${repair.animation} has no pinned output decoded hash`);
    }
    if (!/^[a-f0-9]{64}$/.test(repair.output?.fileSha256 || '')) {
      problems.push(`${repair.id}/${repair.animation} has no pinned output file hash`);
    }
    const flaggedFrames = repair.originalFlaggedFrames;
    if (
      !Array.isArray(flaggedFrames)
      || flaggedFrames.length === 0
      || flaggedFrames.some(frame => !Number.isInteger(frame) || frame < 0 || frame >= FRAME_COUNT)
      || new Set(flaggedFrames).size !== flaggedFrames.length
    ) {
      problems.push(`${repair.id}/${repair.animation} has an invalid original flagged-frame list`);
    }
    const sourceCoverage = repair.source?.frameForegroundCoverage;
    const expectedFlaggedFrames = Array.isArray(sourceCoverage)
      ? sourceCoverage
        .map((coverage, frame) => ({ coverage, frame }))
        .filter(value => value.coverage > VALIDATOR_MAX_FOREGROUND_COVERAGE)
        .map(value => value.frame)
      : [];
    if (
      !Array.isArray(sourceCoverage)
      || sourceCoverage.length !== FRAME_COUNT
      || JSON.stringify(flaggedFrames) !== JSON.stringify(expectedFlaggedFrames)
    ) {
      problems.push(`${repair.id}/${repair.animation} source coverage does not reproduce its flagged frames`);
    }
    if (
      !Number.isInteger(repair.normalizedCellSize)
      || repair.normalizedCellSize <= 0
      || repair.normalizedCellSize > FRAME_SIZE - (MINIMUM_TRANSPARENT_MARGIN * 2)
    ) {
      problems.push(`${repair.id}/${repair.animation} has an invalid uniform normalized cell size`);
    }
    if (
      !Array.isArray(repair.output?.frameSha256)
      || repair.output.frameSha256.length !== FRAME_COUNT
      || repair.output.frameSha256.some(hash => !/^[a-f0-9]{64}$/.test(hash))
    ) {
      problems.push(`${repair.id}/${repair.animation} has invalid pinned output frame hashes`);
    }
    if (
      !Array.isArray(repair.output?.frameForegroundCoverage)
      || repair.output.frameForegroundCoverage.length !== FRAME_COUNT
      || repair.output.frameForegroundCoverage.some(coverage => (
        typeof coverage !== 'number'
        || coverage <= 0
        || coverage > TARGET_MAX_FOREGROUND_COVERAGE
      ))
    ) {
      problems.push(`${repair.id}/${repair.animation} has invalid output frame coverage`);
    }
  }
  const flaggedFrameCount = manifest.repairs.reduce(
    (total, repair) => total + (repair.originalFlaggedFrames?.length || 0),
    0
  );
  if (
    manifest.coverage?.sheets !== manifest.repairs.length
    || manifest.coverage?.originalFlaggedFrames !== flaggedFrameCount
  ) {
    problems.push('coverage totals do not match the repair entries');
  }
  return problems;
}

function compareOutput(repair, inspection) {
  const problems = [];
  if (inspection.compression !== 'lossless') problems.push('output is not lossless WebP');
  if (inspection.decodedSha256 !== repair.output.decodedSha256) {
    problems.push('decoded output hash does not match the repair manifest');
  }
  if (inspection.fileSha256 !== repair.output.fileSha256) {
    problems.push('encoded output hash does not match the deterministic compiler result');
  }
  const frameHashes = inspection.frames.map(frame => frame.sha256);
  if (JSON.stringify(frameHashes) !== JSON.stringify(repair.output.frameSha256)) {
    problems.push('one or more output frame hashes differ from the repair manifest');
  }
  for (const [frameIndex, frame] of inspection.frames.entries()) {
    if (frame.foregroundCoverage > TARGET_MAX_FOREGROUND_COVERAGE) {
      problems.push(`frame ${frameIndex} exceeds target foreground coverage`);
    }
    if (!frame.margins || Math.min(...Object.values(frame.margins)) < MINIMUM_TRANSPARENT_MARGIN) {
      problems.push(`frame ${frameIndex} lacks the required transparent margin`);
    }
  }
  return problems;
}

async function runEnemySpriteRepairs(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || PROJECT_ROOT);
  const manifestPath = path.resolve(options.manifestPath || path.join(
    projectRoot,
    'ai-image-metadata',
    'characters',
    'enemy-sprite-repairs.json'
  ));
  const check = Boolean(options.check);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const manifestProblems = validateManifest(manifest);
  if (manifestProblems.length > 0) {
    return {
      ok: false,
      mode: check ? 'check' : 'compile',
      coverage: { sheets: 0, originalFlaggedFrames: 0 },
      results: [],
      problems: manifestProblems.map(message => ({ scope: 'manifest', message }))
    };
  }

  const results = [];
  const pendingWrites = [];
  for (const repair of manifest.repairs) {
    const file = resolveAssetPath(projectRoot, repair.assetPath);
    let inspection;
    try {
      inspection = await inspectEnemyStrip(file);
    } catch (error) {
      results.push({
        id: repair.id,
        animation: repair.animation,
        assetPath: repair.assetPath,
        status: 'invalid',
        problems: [error.message]
      });
      continue;
    }

    if (inspection.decodedSha256 === repair.output.decodedSha256) {
      const problems = compareOutput(repair, inspection);
      results.push({
        id: repair.id,
        animation: repair.animation,
        assetPath: repair.assetPath,
        status: problems.length === 0 ? 'valid' : 'invalid',
        originalFlaggedFrames: repair.originalFlaggedFrames,
        normalizedCellSize: repair.normalizedCellSize,
        problems
      });
      continue;
    }

    if (inspection.decodedSha256 !== repair.source.decodedSha256) {
      results.push({
        id: repair.id,
        animation: repair.animation,
        assetPath: repair.assetPath,
        status: 'protected',
        problems: ['current pixels match neither the pinned source nor the compiled output; refusing to overwrite user work']
      });
      continue;
    }

    if (check) {
      results.push({
        id: repair.id,
        animation: repair.animation,
        assetPath: repair.assetPath,
        status: 'needs-repair',
        originalFlaggedFrames: repair.originalFlaggedFrames,
        normalizedCellSize: repair.normalizedCellSize,
        problems: ['canonical source is present but has not been compiled']
      });
      continue;
    }

    try {
      const compiled = await normalizeEnemyStrip(file);
      const report = compiled.report;
      const problems = [];
      if (JSON.stringify(report.originalFlaggedFrames) !== JSON.stringify(repair.originalFlaggedFrames)) {
        problems.push('source flagged frames differ from the repair manifest');
      }
      if (report.normalizedCellSize !== repair.normalizedCellSize) {
        problems.push('selected uniform scale differs from the repair manifest');
      }
      if (report.output.decodedSha256 !== repair.output.decodedSha256) {
        problems.push('compiled decoded hash differs from the repair manifest');
      }
      if (report.output.fileSha256 !== repair.output.fileSha256) {
        problems.push('compiled file hash differs from the repair manifest');
      }
      if (problems.length > 0) {
        results.push({
          id: repair.id,
          animation: repair.animation,
          assetPath: repair.assetPath,
          status: 'invalid',
          problems
        });
      } else {
        pendingWrites.push({ file, buffer: compiled.buffer });
        results.push({
          id: repair.id,
          animation: repair.animation,
          assetPath: repair.assetPath,
          status: 'compiled',
          originalFlaggedFrames: repair.originalFlaggedFrames,
          normalizedCellSize: repair.normalizedCellSize,
          problems: []
        });
      }
    } catch (error) {
      results.push({
        id: repair.id,
        animation: repair.animation,
        assetPath: repair.assetPath,
        status: 'invalid',
        problems: [error.message]
      });
    }
  }

  const problems = results.flatMap(result => (
    result.problems.map(message => ({
      scope: `${result.id}/${result.animation}`,
      assetPath: result.assetPath,
      message
    }))
  ));
  if (problems.length === 0 && !check) {
    for (const write of pendingWrites) {
      const temporary = `${write.file}.enemy-repair-tmp`;
      await fs.writeFile(temporary, write.buffer);
      await fs.rename(temporary, write.file);
    }
  }

  return {
    ok: problems.length === 0,
    mode: check ? 'check' : 'compile',
    coverage: {
      sheets: manifest.repairs.length,
      originalFlaggedFrames: manifest.repairs.reduce(
        (total, repair) => total + repair.originalFlaggedFrames.length,
        0
      ),
      valid: results.filter(result => result.status === 'valid').length,
      compiled: problems.length === 0 ? results.filter(result => result.status === 'compiled').length : 0,
      needsRepair: results.filter(result => result.status === 'needs-repair').length,
      protected: results.filter(result => result.status === 'protected').length
    },
    results,
    problems
  };
}

function parseArgs(argv) {
  const options = {
    check: false,
    json: false,
    help: false,
    projectRoot: PROJECT_ROOT,
    manifestPath: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check') options.check = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--root') {
      const value = argv[++index];
      if (!value) throw new Error('--root requires a path');
      options.projectRoot = path.resolve(value);
    } else if (arg === '--manifest') {
      const value = argv[++index];
      if (!value) throw new Error('--manifest requires a path');
      options.manifestPath = path.resolve(value);
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return options;
}

function formatReport(report) {
  const lines = [
    `Enemy sprite transparent-frame ${report.mode}`,
    `Status: ${report.ok ? 'PASS' : 'FAIL'}`,
    `Coverage: ${report.coverage.sheets} sheets / ${report.coverage.originalFlaggedFrames} original flagged frames`
  ];
  for (const result of report.results) {
    lines.push(
      `  - ${result.id}/${result.animation}: ${result.status}`
      + (result.normalizedCellSize ? ` (${result.normalizedCellSize}x${result.normalizedCellSize} uniform cell)` : '')
    );
  }
  for (const problem of report.problems) lines.push(`  ! ${problem.scope}: ${problem.message}`);
  return lines.join('\n');
}

function showHelp() {
  return `Deterministically normalize canonical enemy animation framing

Usage:
  node scripts/ai-images/compile-enemy-sprite-repairs.js [options]

Options:
  --check             Verify pinned compiled outputs without writing
  --json              Emit a machine-readable report
  --root <dir>        Use another Modia checkout
  --manifest <file>   Use another repair manifest
  --help, -h          Show this help
`;
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
    const report = await runEnemySpriteRepairs(options);
    console.log(options.json ? JSON.stringify(report, null, 2) : formatReport(report));
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`Enemy sprite repair failed: ${error.stack || error.message}`);
    process.exitCode = 2;
  }
}

module.exports = {
  COMPILER_VERSION,
  FRAME_COUNT,
  FRAME_SIZE,
  MINIMUM_TRANSPARENT_MARGIN,
  REPAIR_CONTRACT,
  TARGET_MAX_FOREGROUND_COVERAGE,
  VALIDATOR_MAX_FOREGROUND_COVERAGE,
  analyzeFrame,
  inspectEnemyStrip,
  normalizeEnemyStrip,
  parseArgs,
  runEnemySpriteRepairs,
  validateManifest
};

if (require.main === module) main();
