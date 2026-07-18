'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sharp = require('sharp');

const {
  COMPILER_VERSION,
  FRAME_COUNT,
  FRAME_SIZE,
  NORMALIZATION_POLICY,
  STABILIZATION_CONTRACT,
  VERTICAL_OFFSETS,
  analyzeFrame,
  analyzeEncodedPoseRoundTrip,
  canonicalizeTransparentPixels,
  compileReferenceAnimation,
  createExistingFrameManifestEntry,
  createReferenceManifestEntry,
  inspectAnimationStrip,
  normalizeSelectedFrame,
  parseArgs,
  runAnimationStabilizations,
  stabilizeIdleFrame,
  stabilizeIdleStrip,
  translateFrame,
  validateManifest
} = require('./compile-enemy-animation-stabilizations');

function drawRectangle(data, frame, box, color) {
  const frameOffset = frame * FRAME_SIZE * FRAME_SIZE * 4;
  for (let y = box.top; y < box.top + box.height; y += 1) {
    for (let x = box.left; x < box.left + box.width; x += 1) {
      const offset = frameOffset + (((y * FRAME_SIZE) + x) * 4);
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = color[3];
    }
  }
}

async function makeStrip(selectedFrame = 3) {
  const data = Buffer.alloc(FRAME_SIZE * FRAME_SIZE * FRAME_COUNT * 4);
  for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
    const selected = frame === selectedFrame;
    drawRectangle(
      data,
      frame,
      selected
        ? { left: 16, top: 10, width: 28, height: 46 }
        : { left: 12 + (frame % 3), top: 8 + frame, width: 34, height: 38 },
      selected ? [34, 123, 211, 255] : [140 + frame, 62, 41, 255]
    );
  }
  return sharp(data, {
    raw: { width: FRAME_SIZE, height: FRAME_SIZE * FRAME_COUNT, channels: 4 }
  }).webp({ lossless: true, alphaQuality: 100, effort: 6 }).toBuffer();
}

async function makeReferencePng() {
  const width = 96;
  const height = 96;
  const data = Buffer.alloc(width * height * 4);
  const paint = (left, top, boxWidth, boxHeight, color) => {
    for (let y = top; y < top + boxHeight; y += 1) {
      for (let x = left; x < left + boxWidth; x += 1) {
        const offset = ((y * width + x) * 4);
        data[offset] = color[0];
        data[offset + 1] = color[1];
        data[offset + 2] = color[2];
        data[offset + 3] = 255;
      }
    }
  };
  paint(37, 10, 22, 20, [225, 188, 121]);
  paint(28, 30, 40, 42, [42, 133, 82]);
  paint(22, 38, 8, 34, [83, 53, 35]);
  paint(68, 34, 7, 40, [196, 201, 214]);
  paint(32, 72, 12, 16, [76, 54, 41]);
  paint(52, 72, 12, 16, [76, 54, 41]);
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

function frameFromRawStrip(rawStrip, frameIndex) {
  const frame = Buffer.alloc(FRAME_SIZE * FRAME_SIZE * 4);
  for (let y = 0; y < FRAME_SIZE; y += 1) {
    const start = ((((frameIndex * FRAME_SIZE) + y) * FRAME_SIZE) * 4);
    rawStrip.copy(frame, y * FRAME_SIZE * 4, start, start + FRAME_SIZE * 4);
  }
  return frame;
}

function opaquePalette(raw) {
  const palette = new Set();
  for (let offset = 0; offset < raw.length; offset += 4) {
    if (raw[offset + 3] === 0) continue;
    palette.add(raw.subarray(offset, offset + 4).toString('hex'));
  }
  return palette;
}

function buildManifest(entries) {
  return {
    schemaVersion: 1,
    compilerVersion: COMPILER_VERSION,
    contract: { ...STABILIZATION_CONTRACT },
    coverage: {
      identities: entries.length,
      strips: entries.reduce((total, entry) => total + Object.keys(entry.animations).length, 0)
    },
    stabilizations: entries
  };
}

async function writeManifest(projectRoot, manifest) {
  const manifestPath = path.join(
    projectRoot,
    'ai-image-metadata/characters/enemy-animation-stabilizations.json'
  );
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}

async function writeEnemyAssets(projectRoot, biome, id, assets) {
  const directory = path.join(
    projectRoot,
    'frontend/public/assets/characters/enemies',
    biome,
    id
  );
  await fs.mkdir(directory, { recursive: true });
  const paths = {};
  for (const [animation, buffer] of Object.entries(assets)) {
    const file = path.join(directory, `${id}_${animation}.webp`);
    await fs.writeFile(file, buffer);
    paths[animation] = file;
  }
  return paths;
}

test('existing-frame idle mode preserves exact pixels and permits only the declared 0/-1px translation', async () => {
  const sourceFrame = 3;
  const source = await makeStrip(sourceFrame);
  const first = await stabilizeIdleStrip(source, sourceFrame);
  const second = await stabilizeIdleStrip(source, sourceFrame);
  const sourceRaw = await sharp(source).ensureAlpha().raw().toBuffer();
  const selected = frameFromRawStrip(sourceRaw, sourceFrame);
  const outputRaw = await sharp(first.buffer).ensureAlpha().raw().toBuffer();
  const inspection = await inspectAnimationStrip(first.buffer);

  assert.deepEqual(first.buffer, second.buffer);
  assert.equal(inspection.compression, 'lossless');
  assert.equal(inspection.width, 64);
  assert.equal(inspection.height, 512);
  assert.equal(inspection.hasAlpha, true);
  assert.deepEqual(first.report.verticalOffsets, VERTICAL_OFFSETS);

  const selectedReport = analyzeFrame(selected);
  for (let frameIndex = 0; frameIndex < FRAME_COUNT; frameIndex += 1) {
    const expected = translateFrame(selected, VERTICAL_OFFSETS[frameIndex]);
    const actual = frameFromRawStrip(outputRaw, frameIndex);
    assert.deepEqual(actual, expected, `frame ${frameIndex} must be translation-only`);
    assert.equal(inspection.frames[frameIndex].bounds.left, selectedReport.bounds.left);
    assert.equal(inspection.frames[frameIndex].bounds.width, selectedReport.bounds.width);
    assert.equal(inspection.frames[frameIndex].bounds.height, selectedReport.bounds.height);
    assert.equal(
      inspection.frames[frameIndex].groundAnchor,
      selectedReport.groundAnchor + VERTICAL_OFFSETS[frameIndex]
    );
  }
  assert.deepEqual(opaquePalette(outputRaw), opaquePalette(selected));
  assert.equal(new Set(inspection.frames.map(frame => frame.sha256)).size, 2);
});

test('idle compilation canonicalizes hidden transparent RGB while preserving every nonzero-alpha byte', async () => {
  const frame = Buffer.alloc(FRAME_SIZE * FRAME_SIZE * 4);
  for (let offset = 0; offset < frame.length; offset += 4) {
    frame[offset] = 173;
    frame[offset + 1] = 91;
    frame[offset + 2] = 207;
    frame[offset + 3] = 0;
  }
  drawRectangle(frame, 0, { left: 16, top: 10, width: 28, height: 46 }, [34, 123, 211, 255]);
  const transparentHole = ((20 * FRAME_SIZE + 20) * 4);
  frame.set([9, 8, 7, 0], transparentHole);
  const partialPixel = ((20 * FRAME_SIZE + 21) * 4);
  frame.set([101, 102, 103, 128], partialPixel);

  const canonical = canonicalizeTransparentPixels(frame);
  const compiled = await stabilizeIdleFrame(frame);
  const outputRaw = await sharp(compiled.buffer).ensureAlpha().raw().toBuffer();
  const outputFrame = frameFromRawStrip(outputRaw, 0);
  assert.deepEqual(outputFrame, canonical);
  assert.deepEqual([...outputFrame.subarray(partialPixel, partialPixel + 4)], [101, 102, 103, 128]);
  assert.deepEqual([...outputFrame.subarray(transparentHole, transparentHole + 4)], [0, 0, 0, 0]);
  for (let offset = 0; offset < outputFrame.length; offset += 4) {
    if (outputFrame[offset + 3] !== 0) continue;
    assert.deepEqual([...outputFrame.subarray(offset, offset + 4)], [0, 0, 0, 0]);
  }
  assert.equal(compiled.report.selectedFrame.sha256, analyzeFrame(canonical).sha256);

  const edgeFrame = Buffer.from(frame);
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < FRAME_SIZE; x += 1) {
      const offset = ((y * FRAME_SIZE + x) * 4);
      edgeFrame.set((x + y) % 7 === 0 ? [77, 66, 55, 0] : [31, 142, 89, 255], offset);
    }
  }
  const normalized = await stabilizeIdleFrame(edgeFrame, { normalizedCellSize: 56 });
  const normalizedRaw = await sharp(normalized.buffer).ensureAlpha().raw().toBuffer();
  for (let offset = 0; offset < normalizedRaw.length; offset += 4) {
    if (normalizedRaw[offset + 3] !== 0) continue;
    assert.deepEqual([...normalizedRaw.subarray(offset, offset + 4)], [0, 0, 0, 0]);
  }
});

test('decoded frame zero anchors the exact loop when WebP assigns hidden RGB around dense partial-alpha art', async () => {
  const frame = Buffer.alloc(FRAME_SIZE * FRAME_SIZE * 4);
  for (let y = 10; y < 54; y += 1) {
    for (let x = 5; x < 60; x += 1) {
      const offset = ((y * FRAME_SIZE + x) * 4);
      frame[offset] = (x * 17 + y * 3) % 256;
      frame[offset + 1] = (x * 5 + y * 19) % 256;
      frame[offset + 2] = (x * 11 + y * 7) % 256;
      frame[offset + 3] = 128;
    }
  }

  const compiled = await stabilizeIdleFrame(frame);
  const raw = await sharp(compiled.buffer).ensureAlpha().raw().toBuffer();
  const decodedPose = canonicalizeTransparentPixels(frameFromRawStrip(raw, 0));
  const poseReport = analyzeFrame(decodedPose);
  assert.equal(compiled.report.encodedPoseRoundTrip.alphaMismatchPixels, 0);
  assert.equal(compiled.report.encodedPoseRoundTrip.opaqueRgbChangedPixels, 0);
  assert.equal(compiled.report.encodedPoseRoundTrip.partialAlphaPixels, 55 * 44);
  assert.equal(compiled.report.encodedPoseRoundTrip.transparentRgbCanonicalizedPixels > 0, true);
  assert.equal(compiled.report.baseFrame.sha256, analyzeFrame(canonicalizeTransparentPixels(frame)).sha256);

  for (let frameIndex = 0; frameIndex < FRAME_COUNT; frameIndex += 1) {
    const actual = canonicalizeTransparentPixels(frameFromRawStrip(raw, frameIndex));
    const expected = translateFrame(decodedPose, VERTICAL_OFFSETS[frameIndex]);
    assert.deepEqual(actual, expected, `decoded frame ${frameIndex} must be an exact encoded-pose translation`);
    const report = analyzeFrame(actual);
    assert.equal(report.foregroundPixels, poseReport.foregroundPixels);
    assert.equal(report.bounds.width, poseReport.bounds.width);
    assert.equal(report.bounds.height, poseReport.bounds.height);
    assert.equal(report.groundAnchor, poseReport.groundAnchor + VERTICAL_OFFSETS[frameIndex]);
    assert.equal(Math.min(...Object.values(report.margins)) >= 4, true);
  }

  const before = Buffer.alloc(FRAME_SIZE * FRAME_SIZE * 4);
  const partialOffset = ((20 * FRAME_SIZE + 20) * 4);
  const opaqueOffset = ((20 * FRAME_SIZE + 21) * 4);
  before.set([30, 60, 90, 128], partialOffset);
  before.set([40, 80, 120, 255], opaqueOffset);
  const partialChanged = Buffer.from(before);
  partialChanged[partialOffset] += 3;
  const allowed = analyzeEncodedPoseRoundTrip(before, partialChanged).report;
  assert.equal(allowed.alphaMismatchPixels, 0);
  assert.equal(allowed.opaqueRgbChangedPixels, 0);
  assert.equal(allowed.partialAlphaRgbChangedPixels, 1);
  assert.equal(allowed.maximumPartialAlphaChannelDelta, 3);

  const opaqueChanged = Buffer.from(before);
  opaqueChanged[opaqueOffset] += 1;
  assert.equal(analyzeEncodedPoseRoundTrip(before, opaqueChanged).report.opaqueRgbChangedPixels, 1);
  const alphaChanged = Buffer.from(before);
  alphaChanged[partialOffset + 3] += 1;
  assert.equal(analyzeEncodedPoseRoundTrip(before, alphaChanged).report.alphaMismatchPixels, 1);
});

test('existing-frame mode is idle-only, preserves by default, requires force, and protects unknown edits', async t => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'modia-enemy-idle-stable-'));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));
  const source = await makeStrip(3);
  const paths = await writeEnemyAssets(projectRoot, 'forest', 'fixture_beast', { idle: source });
  const entry = await createExistingFrameManifestEntry({
    input: source,
    id: 'fixture_beast',
    biome: 'forest',
    sourceFrame: 3
  });
  const manifest = buildManifest([entry]);
  await writeManifest(projectRoot, manifest);
  assert.deepEqual(validateManifest(manifest), []);
  assert.deepEqual(Object.keys(entry.animations), ['idle']);

  const preserve = await runAnimationStabilizations({ projectRoot, ids: ['fixture_beast'] });
  assert.equal(preserve.ok, true);
  assert.equal(preserve.results[0].status, 'preserved');
  assert.deepEqual(await fs.readFile(paths.idle), source);

  const beforeCheck = await runAnimationStabilizations({ projectRoot, ids: ['forest/fixture_beast'], check: true });
  assert.equal(beforeCheck.ok, false);
  assert.equal(beforeCheck.results[0].status, 'needs-stabilization');

  const compiled = await runAnimationStabilizations({ projectRoot, ids: ['fixture_beast'], force: true });
  assert.equal(compiled.ok, true);
  assert.equal(compiled.coverage.compiled, 1);
  assert.equal(compiled.results[0].status, 'compiled');
  const stabilizedBytes = await fs.readFile(paths.idle);
  assert.notDeepEqual(stabilizedBytes, source);

  const afterCheck = await runAnimationStabilizations({ projectRoot, ids: ['fixture_beast'], check: true });
  assert.equal(afterCheck.ok, true);
  assert.equal(afterCheck.results[0].status, 'valid');

  const raw = await sharp(stabilizedBytes).ensureAlpha().raw().toBuffer();
  raw[0] = 201;
  raw[3] = 255;
  const unknown = await sharp(raw, {
    raw: { width: FRAME_SIZE, height: FRAME_SIZE * FRAME_COUNT, channels: 4 }
  }).webp({ lossless: true }).toBuffer();
  await fs.writeFile(paths.idle, unknown);
  const protectedRun = await runAnimationStabilizations({ projectRoot, ids: ['fixture_beast'], force: true });
  assert.equal(protectedRun.ok, false);
  assert.equal(protectedRun.results[0].status, 'protected');
  assert.deepEqual(await fs.readFile(paths.idle), unknown);
});

test('explicit normalization uniformly downsizes an edge-touching frame with nearest-neighbor pixels and a stable anchor', async t => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'modia-enemy-idle-normalized-'));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));
  const stripRaw = Buffer.alloc(FRAME_SIZE * FRAME_SIZE * FRAME_COUNT * 4);
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const offset = ((y * FRAME_SIZE + x) * 4);
      const color = ((Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0)
        ? [19, 87, 163, 255]
        : [231, 174, 61, 255];
      stripRaw[offset] = color[0];
      stripRaw[offset + 1] = color[1];
      stripRaw[offset + 2] = color[2];
      stripRaw[offset + 3] = color[3];
    }
  }
  for (let frame = 1; frame < FRAME_COUNT; frame += 1) {
    drawRectangle(stripRaw, frame, { left: 12, top: 12, width: 40, height: 40 }, [110, 70, 40, 255]);
  }
  const source = await sharp(stripRaw, {
    raw: { width: FRAME_SIZE, height: FRAME_SIZE * FRAME_COUNT, channels: 4 }
  }).webp({ lossless: true, alphaQuality: 100, effort: 6 }).toBuffer();
  const decodedSource = await sharp(source).ensureAlpha().raw().toBuffer();
  const selected = frameFromRawStrip(decodedSource, 0);

  await assert.rejects(() => stabilizeIdleStrip(source, 0), /margin/);
  const normalized = normalizeSelectedFrame(selected, 56);
  const compiled = await stabilizeIdleStrip(source, 0, { normalizedCellSize: 56 });
  const inspection = await inspectAnimationStrip(compiled.buffer);
  const outputRaw = await sharp(compiled.buffer).ensureAlpha().raw().toBuffer();
  const baseFrame = frameFromRawStrip(outputRaw, 0);

  assert.equal(compiled.report.normalization.policy, NORMALIZATION_POLICY);
  assert.deepEqual(compiled.report.normalization.sourceBounds, {
    left: 0,
    top: 0,
    width: 64,
    height: 32
  });
  assert.equal(compiled.report.normalization.uniformScale, 0.875);
  assert.deepEqual(compiled.report.normalization.outputSize, { width: 56, height: 28 });
  assert.deepEqual(compiled.report.normalization.outputBounds, {
    left: 4,
    top: 32,
    width: 56,
    height: 28
  });
  assert.deepEqual(baseFrame, normalized.frame);
  assert.equal(
    compiled.report.normalization.outputSize.width / compiled.report.normalization.outputSize.height,
    64 / 32,
    'one scale factor must preserve the source aspect ratio'
  );
  const sourcePalette = opaquePalette(selected);
  const normalizedPalette = opaquePalette(baseFrame);
  for (const color of normalizedPalette) {
    assert.equal(sourcePalette.has(color), true, `nearest-neighbor normalization introduced ${color}`);
  }
  assert.equal(inspection.frames[0].groundAnchor, 59);
  assert.deepEqual(
    inspection.frames.map(frame => frame.groundAnchor - inspection.frames[0].groundAnchor),
    VERTICAL_OFFSETS
  );
  for (const frame of inspection.frames) {
    assert.equal(Math.min(...Object.values(frame.margins)) >= 4, true);
  }

  const id = 'wide_fixture';
  const biome = 'bridge';
  await writeEnemyAssets(projectRoot, biome, id, { idle: source });
  const entry = await createExistingFrameManifestEntry({
    input: source,
    id,
    biome,
    sourceFrame: 0,
    normalizedCellSize: 56
  });
  const manifest = buildManifest([entry]);
  await writeManifest(projectRoot, manifest);
  assert.deepEqual(validateManifest(manifest), []);
  assert.equal(entry.identitySource.normalization.outputFrameSha256, analyzeFrame(baseFrame).sha256);

  const result = await runAnimationStabilizations({ projectRoot, ids: [id], force: true });
  assert.equal(result.ok, true);
  assert.equal(result.coverage.compiled, 1);

  const tampered = structuredClone(manifest);
  tampered.stabilizations[0].identitySource.normalization.uniformScale = 0.5;
  assert.equal(
    validateManifest(tampered).some(problem => problem.includes('scale does not match')),
    true
  );
});

test('canonical-reference mode deterministically derives idle, attack, hit, and death from one pinned PNG', async t => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'modia-enemy-reference-stable-'));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));
  const id = 'fixture_knight';
  const biome = 'castle';
  const reference = await makeReferencePng();
  const referenceRelative = `ai-image-metadata/characters/reference-anchors/enemies/${id}.png`;
  const referenceFile = path.join(projectRoot, referenceRelative);
  await fs.mkdir(path.dirname(referenceFile), { recursive: true });
  await fs.writeFile(referenceFile, reference);

  const sourceAssets = {
    idle: await makeStrip(2),
    attack: await makeStrip(3),
    hit: await makeStrip(4),
    death: await makeStrip(5)
  };
  const assetPaths = await writeEnemyAssets(projectRoot, biome, id, sourceAssets);
  const entry = await createReferenceManifestEntry({
    referenceInput: referenceFile,
    referencePath: referenceRelative,
    currentAssets: sourceAssets,
    id,
    biome
  });
  const manifest = buildManifest([entry]);
  await writeManifest(projectRoot, manifest);
  assert.deepEqual(validateManifest(manifest), []);
  assert.equal(entry.identitySource.mode, 'reference_png');
  assert.deepEqual(Object.keys(entry.animations), ['idle', 'attack', 'hit', 'death']);

  for (const animation of Object.keys(sourceAssets)) {
    const first = await compileReferenceAnimation({ referenceInput: referenceFile, id, biome, animation });
    const second = await compileReferenceAnimation({ referenceInput: referenceFile, id, biome, animation });
    assert.deepEqual(first.buffer, second.buffer, `${animation} compilation must be deterministic`);
    assert.deepEqual(first.report.output, entry.animations[animation].output);
  }

  const preserve = await runAnimationStabilizations({ projectRoot, ids: [id] });
  assert.equal(preserve.ok, true);
  assert.equal(preserve.coverage.preserved, 4);
  for (const animation of Object.keys(sourceAssets)) {
    assert.deepEqual(await fs.readFile(assetPaths[animation]), sourceAssets[animation]);
  }

  const beforeCheck = await runAnimationStabilizations({ projectRoot, ids: [id], check: true });
  assert.equal(beforeCheck.ok, false);
  assert.equal(beforeCheck.coverage.needsStabilization, 4);

  const force = await runAnimationStabilizations({ projectRoot, ids: [id], force: true });
  assert.equal(force.ok, true);
  assert.equal(force.coverage.compiled, 4);
  const check = await runAnimationStabilizations({ projectRoot, ids: [id], check: true });
  assert.equal(check.ok, true);
  assert.equal(check.coverage.valid, 4);

  const idle = await inspectAnimationStrip(assetPaths.idle);
  assert.equal(new Set(idle.frames.map(frame => frame.bounds.width)).size, 1);
  assert.equal(new Set(idle.frames.map(frame => frame.bounds.height)).size, 1);
  assert.deepEqual(
    idle.frames.map(frame => frame.groundAnchor - idle.frames[0].groundAnchor),
    VERTICAL_OFFSETS
  );

  const changedReference = Buffer.from(reference);
  changedReference[changedReference.length - 20] ^= 1;
  await fs.writeFile(referenceFile, changedReference);
  const changedCheck = await runAnimationStabilizations({
    projectRoot,
    ids: [id],
    animations: ['idle'],
    check: true
  });
  assert.equal(changedCheck.ok, false);
  assert.equal(['invalid', 'protected'].includes(changedCheck.results[0].status), true);
});

test('compiler rejects malformed strips and insufficient source-frame transparency', async () => {
  const png = await sharp({
    create: { width: 64, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  }).png().toBuffer();
  await assert.rejects(() => stabilizeIdleStrip(png, 0), /expected a 64x512 WebP/);

  const data = Buffer.alloc(FRAME_SIZE * FRAME_SIZE * FRAME_COUNT * 4);
  for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
    drawRectangle(data, frame, { left: 4, top: 4, width: 56, height: 56 }, [90, 120, 150, 255]);
  }
  const crowded = await sharp(data, {
    raw: { width: 64, height: 512, channels: 4 }
  }).webp({ lossless: true }).toBuffer();
  await assert.rejects(
    () => stabilizeIdleStrip(crowded, 0),
    /foreground covers|top margin must be at least/
  );
});

test('CLI supports scoped ids, animation filters, check/force/json, and rejects unsafe scope combinations', () => {
  const root = path.resolve('/tmp/modia-enemy-stabilizer');
  const manifest = path.resolve('/tmp/enemy-animation-stabilizations.json');
  assert.deepEqual(
    parseArgs([
      '--id', 'fixture_beast,castle/fixture_knight',
      '--animation', 'idle,death',
      '--check',
      '--json',
      '--root', root,
      '--manifest', manifest
    ]),
    {
      ids: ['fixture_beast', 'castle/fixture_knight'],
      animations: ['idle', 'death'],
      all: false,
      check: true,
      force: false,
      json: true,
      help: false,
      projectRoot: root,
      manifestPath: manifest
    }
  );
  assert.throws(() => parseArgs(['--id', 'fixture', '--check', '--force']), /cannot be combined/);
  assert.throws(() => parseArgs(['--all', '--id', 'fixture']), /exactly one scope/);
  assert.throws(() => parseArgs(['--id', 'fixture', '--animation', 'walk']), /unsupported/);
  assert.throws(() => parseArgs([]), /exactly one scope/);
});

test('production manifest intentionally selects no NPC until the visual audit supplies entries', async () => {
  const manifestPath = path.resolve(
    __dirname,
    '..',
    '..',
    'ai-image-metadata/characters/enemy-animation-stabilizations.json'
  );
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  assert.deepEqual(validateManifest(manifest), []);
  assert.equal(manifest.coverage.identities, 0);
  assert.equal(manifest.coverage.strips, 0);
  assert.deepEqual(manifest.stabilizations, []);
});
