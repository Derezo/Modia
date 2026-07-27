'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const sharp = require('sharp');

const { parseArgs } = require('./compile-authored-player-animations');
const {
  COMPILER_VERSION,
  applyApproval,
  compileAtlasAnimation,
  compileAuthoredVariant,
  compileDeadAnimation,
  compileReferenceBuffer,
  extractAtlasFrames,
  metadataFingerprint,
  poseSignature,
  sha256
} = require('./lib/authoredPlayerAnimationCompiler');
const {
  FRAME_COUNT,
  FRAME_SIZE,
  SAFE_MARGIN,
  STRIP_HEIGHT,
  inspectStrip
} = require('./lib/playerAnimationCompiler');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const ATLAS_COLUMNS = 4;
const ATLAS_ROWS = 2;
const CELL_SIZE = 100;
const ATLAS_WIDTH = ATLAS_COLUMNS * CELL_SIZE;
const ATLAS_HEIGHT = ATLAS_ROWS * CELL_SIZE;

function paintRectangle(data, width, left, top, right, bottom, rgba = [90, 150, 230, 255]) {
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const offset = ((y * width) + x) * 4;
      data[offset] = rgba[0];
      data[offset + 1] = rgba[1];
      data[offset + 2] = rgba[2];
      data[offset + 3] = rgba[3];
    }
  }
}

async function writeRgbaPng(filePath, data, width, height) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await sharp(data, { raw: { width, height, channels: 4 } }).png().toFile(filePath);
}

async function temporaryDirectory(t, prefix) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function createRigidTranslationAtlas(t) {
  const directory = await temporaryDirectory(t, 'modia-authored-rigid-');
  const atlasPath = path.join(directory, 'rigid.png');
  const data = Buffer.alloc(ATLAS_WIDTH * ATLAS_HEIGHT * 4);
  const offsets = [
    [8, 8], [18, 12], [28, 6], [12, 20],
    [24, 14], [6, 22], [30, 18], [16, 4]
  ];

  for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
    const column = frame % ATLAS_COLUMNS;
    const row = Math.floor(frame / ATLAS_COLUMNS);
    const [dx, dy] = offsets[frame];
    const left = (column * CELL_SIZE) + 28 + dx;
    const top = (row * CELL_SIZE) + 18 + dy;
    paintRectangle(data, ATLAS_WIDTH, left, top, left + 19, top + 34);
  }
  await writeRgbaPng(atlasPath, data, ATLAS_WIDTH, ATLAS_HEIGHT);
  return atlasPath;
}

function paintArticulatedPose(data, frame) {
  const column = frame % ATLAS_COLUMNS;
  const row = Math.floor(frame / ATLAS_COLUMNS);
  const left = column * CELL_SIZE;
  const top = row * CELL_SIZE;
  const color = [70 + (frame * 12), 120, 220 - (frame * 10), 255];

  // Head, torso, and separated legs form the stable identity silhouette.
  paintRectangle(data, ATLAS_WIDTH, left + 44, top + 16, left + 55, top + 31, color);
  paintRectangle(data, ATLAS_WIDTH, left + 42, top + 28, left + 57, top + 68, color);
  paintRectangle(data, ATLAS_WIDTH, left + 42, top + 65, left + 48, top + 84, color);
  paintRectangle(data, ATLAS_WIDTH, left + 51, top + 65, left + 57, top + 84, color);

  // Each frame changes connected limb geometry, not merely canvas position.
  const limbs = [
    [[25, 35, 44, 40]],
    [[20, 45, 44, 50]],
    [[55, 35, 75, 40]],
    [[55, 45, 80, 50]],
    [[25, 34, 44, 39], [55, 48, 70, 53]],
    [[35, 34, 44, 40], [29, 29, 38, 36], [24, 24, 31, 31]],
    [[55, 34, 64, 40], [61, 29, 70, 36], [68, 24, 75, 31]],
    [[25, 30, 44, 35], [55, 30, 74, 35]]
  ];
  for (const [x1, y1, x2, y2] of limbs[frame]) {
    paintRectangle(data, ATLAS_WIDTH, left + x1, top + y1, left + x2, top + y2, color);
  }
}

async function createArticulatedAtlas(t) {
  const directory = await temporaryDirectory(t, 'modia-authored-articulated-');
  const atlasPath = path.join(directory, 'articulated.png');
  const data = Buffer.alloc(ATLAS_WIDTH * ATLAS_HEIGHT * 4);
  for (let frame = 0; frame < FRAME_COUNT; frame += 1) paintArticulatedPose(data, frame);
  await writeRgbaPng(atlasPath, data, ATLAS_WIDTH, ATLAS_HEIGHT);
  return atlasPath;
}

async function createFrameBuffer(left, top, articulated = false) {
  const data = Buffer.alloc(FRAME_SIZE * FRAME_SIZE * 4);
  paintRectangle(data, FRAME_SIZE, left, top, left + 11, top + 25);
  if (articulated) paintRectangle(data, FRAME_SIZE, left + 9, top + 8, left + 21, top + 12);
  return sharp(data, { raw: { width: FRAME_SIZE, height: FRAME_SIZE, channels: 4 } }).png().toBuffer();
}

test('CLI argument parsing accepts both assignment forms and rejects ambiguous pin updates', () => {
  const parsed = parseArgs([
    '--id=elf_other_wizard',
    '--spec', 'pilot.json',
    '--registry=registry.json',
    '--project-root', '.',
    '--force',
    '--json'
  ]);
  assert.equal(parsed.id, 'elf_other_wizard');
  assert.equal(parsed.specPath, path.resolve('pilot.json'));
  assert.equal(parsed.registryPath, path.resolve('registry.json'));
  assert.equal(parsed.projectRoot, path.resolve('.'));
  assert.equal(parsed.force, true);
  assert.equal(parsed.json, true);
  assert.throws(() => parseArgs([]), /--id or --all-approved is required/);
  assert.deepEqual(
    parseArgs(['--all-approved', '--check']),
    { allApproved: true, check: true }
  );
  assert.throws(() => parseArgs(['--all-approved']), /requires --check/);
  assert.throws(
    () => parseArgs(['--all-approved', '--id', 'elf_other_wizard', '--check']),
    /mutually exclusive/
  );
  assert.throws(
    () => parseArgs(['--id', 'elf_other_wizard', '--check', '--update-pins']),
    /mutually exclusive/
  );
  assert.throws(
    () => parseArgs(['--id', 'elf_other_wizard', '--approve']),
    /requires --update-pins/
  );
  assert.deepEqual(
    parseArgs(['--id', 'elf_other_wizard', '--update-pins', '--approve', '--force']),
    { id: 'elf_other_wizard', updatePins: true, approve: true, force: true }
  );
  assert.throws(() => parseArgs(['--id', 'elf_other_wizard', '--surprise']), /Unknown argument/);
});

test('approval transition records status and timestamp without replacing an existing approval date', () => {
  const draft = { status: 'draft-awaiting-generation', approvedAt: null };
  applyApproval(draft, '2026-07-18T15:30:00.000Z');
  assert.deepEqual(draft, { status: 'approved', approvedAt: '2026-07-18T15:30:00.000Z' });

  applyApproval(draft, '2026-07-19T00:00:00.000Z');
  assert.equal(draft.approvedAt, '2026-07-18T15:30:00.000Z');
});

test('component extraction preserves a connected pose that crosses its nominal atlas cell', async t => {
  const directory = await temporaryDirectory(t, 'modia-authored-cross-cell-');
  const atlasPath = path.join(directory, 'cross-cell.png');
  const data = Buffer.alloc(ATLAS_WIDTH * ATLAS_HEIGHT * 4);

  // Frame zero deliberately extends ten pixels into cell one, while its centroid
  // remains in cell zero. A fixed cell crop would lose those ten pixels.
  paintRectangle(data, ATLAS_WIDTH, 30, 20, 109, 70);
  for (let frame = 1; frame < FRAME_COUNT; frame += 1) {
    const column = frame % ATLAS_COLUMNS;
    const row = Math.floor(frame / ATLAS_COLUMNS);
    const left = (column * CELL_SIZE) + 30;
    const top = (row * CELL_SIZE) + 20;
    paintRectangle(data, ATLAS_WIDTH, left, top, left + 39, top + 50);
  }
  await writeRgbaPng(atlasPath, data, ATLAS_WIDTH, ATLAS_HEIGHT);

  const frames = await extractAtlasFrames(atlasPath, { columns: 4, rows: 2 });
  assert.equal(frames.length, FRAME_COUNT);
  assert.equal(frames[0].sourceFrameIndex, 0);
  assert.equal(frames[0].width, 80, 'cross-cell pixels must survive component extraction');
  assert.equal(frames[0].height, 51);
  assert.equal(frames[0].components.length, 1);
  assert.equal(frames[1].width, 40, 'the neighboring pose must remain independently assigned');
});

test('pose signatures normalize translation but still detect articulated silhouette changes', async () => {
  const first = await createFrameBuffer(7, 10);
  const translated = await createFrameBuffer(31, 28);
  const articulated = await createFrameBuffer(7, 10, true);

  assert.equal(await poseSignature(first), await poseSignature(translated));
  assert.notEqual(await poseSignature(first), await poseSignature(articulated));
});

test('atlas compilation rejects eight rigidly translated copies as one normalized pose', async t => {
  const atlasPath = await createRigidTranslationAtlas(t);
  await assert.rejects(
    compileAtlasAnimation(atlasPath, 'idle', {
      layout: { columns: 4, rows: 2 },
      minimumUniquePoses: 2
    }),
    /1 translation-normalized poses; expected at least 2/
  );
});

test('source-cell anchoring preserves authored root travel between frames', async t => {
  const atlasPath = await createRigidTranslationAtlas(t);
  const compiled = await compileAtlasAnimation(atlasPath, 'idle', {
    layout: { columns: 4, rows: 2 },
    minimumUniquePoses: 1,
    anchor: 'source-cell'
  });

  const maxX = compiled.report.frames.map(frame => frame.bounds.maxX);
  const maxY = compiled.report.frames.map(frame => frame.bounds.maxY);
  assert.ok(new Set(maxX).size > 1, 'horizontal recoil/lunge offsets should survive');
  assert.ok(new Set(maxY).size > 1, 'vertical bob/hop offsets should survive');

  const grounded = await compileAtlasAnimation(atlasPath, 'idle', {
    layout: { columns: 4, rows: 2 },
    minimumUniquePoses: 1,
    anchor: 'source-cell',
    verticalAnchor: 'bottom'
  });
  assert.ok(
    new Set(grounded.report.frames.map(frame => frame.bounds.maxX)).size > 1,
    'bottom grounding must retain authored horizontal travel'
  );
  assert.equal(
    grounded.report.frames.every(frame => frame.bounds.maxY === FRAME_SIZE - SAFE_MARGIN - 1),
    true,
    'bottom-grounded poses must share the canonical ground row'
  );
});

test('animation config rejects fail-open thresholds and unknown anchors', async t => {
  const atlasPath = await createArticulatedAtlas(t);
  await assert.rejects(
    compileAtlasAnimation(atlasPath, 'walk', { minimumUniquePoses: -1 }),
    /minimumUniquePoses/
  );
  await assert.rejects(
    compileAtlasAnimation(atlasPath, 'walk', {
      layout: { minimumDominantRatio: -1 },
      minimumUniquePoses: 1
    }),
    /minimumDominantRatio/
  );
  await assert.rejects(
    compileAtlasAnimation(atlasPath, 'walk', { anchor: 'typo', minimumUniquePoses: 1 }),
    /anchor must be/
  );
  await assert.rejects(
    compileAtlasAnimation(atlasPath, 'walk', {
      anchor: 'source-cell',
      verticalAnchor: 'floating',
      minimumUniquePoses: 1
    }),
    /verticalAnchor must be/
  );
  await assert.rejects(
    compileAtlasAnimation(atlasPath, 'walk', {
      anchor: 'bottom-center',
      verticalAnchor: 'bottom',
      minimumUniquePoses: 1
    }),
    /only supported with source-cell/
  );
});

test('reference compilation rejects opaque or non-square accepted sources', async t => {
  const directory = await temporaryDirectory(t, 'modia-authored-reference-');
  const opaquePath = path.join(directory, 'opaque.png');
  const opaque = Buffer.alloc(64 * 64 * 4, 255);
  await writeRgbaPng(opaquePath, opaque, 64, 64);
  await assert.rejects(compileReferenceBuffer(opaquePath), /corners must be transparent/);

  const nonSquarePath = path.join(directory, 'non-square.png');
  const nonSquare = Buffer.alloc(80 * 64 * 4);
  paintRectangle(nonSquare, 80, 20, 12, 50, 52);
  await writeRgbaPng(nonSquarePath, nonSquare, 80, 64);
  await assert.rejects(compileReferenceBuffer(nonSquarePath), /must be square/);
});

test('articulated compilation is byte-deterministic and emits the lossless 64x512 runtime contract', async t => {
  const atlasPath = await createArticulatedAtlas(t);
  const config = {
    layout: { columns: 4, rows: 2 },
    minimumUniquePoses: 8,
    anchor: 'bottom-center'
  };
  const first = await compileAtlasAnimation(atlasPath, 'walk', config);
  const second = await compileAtlasAnimation(atlasPath, 'walk', config);

  assert.deepEqual(first.buffer, second.buffer);
  assert.equal(new Set(first.poseSignatures).size, FRAME_COUNT);
  assert.deepEqual(first.sourceFrameIndexes, [0, 1, 2, 3, 4, 5, 6, 7]);

  const report = await inspectStrip(first.buffer);
  assert.equal(report.format, 'webp');
  assert.equal(report.compression, 'lossless');
  assert.equal(report.width, FRAME_SIZE);
  assert.equal(report.height, STRIP_HEIGHT);
  assert.equal(report.hasAlpha, true);
  assert.equal(report.frames.length, FRAME_COUNT);
  for (const frame of report.frames) {
    assert.equal(frame.blank, false);
    assert.equal(frame.safeMargin, true);
    assert.ok(frame.bounds.minX >= SAFE_MARGIN);
    assert.ok(frame.bounds.maxX < FRAME_SIZE - SAFE_MARGIN);
    assert.ok(frame.bounds.minY >= SAFE_MARGIN);
    assert.ok(frame.bounds.maxY < FRAME_SIZE - SAFE_MARGIN);
  }
});

test('death holds its terminal pose and dead deterministically derives all frames from it', async t => {
  const atlasPath = await createArticulatedAtlas(t);
  const death = await compileAtlasAnimation(atlasPath, 'death', {
    layout: { columns: 4, rows: 2 },
    outputFrameMap: [0, 1, 2, 3, 4, 5, 7, 7],
    minimumUniquePoses: 7,
    anchor: 'source-cell',
    verticalAnchor: 'bottom'
  });
  const dead = await compileDeadAnimation(death);

  assert.deepEqual(death.sourceFrameIndexes, [0, 1, 2, 3, 4, 5, 7, 7]);
  assert.equal(
    death.report.frames.every(frame => frame.bounds.maxY === FRAME_SIZE - SAFE_MARGIN - 1),
    true
  );
  assert.equal(death.frames[6].equals(death.frames[7]), true);
  assert.equal(death.report.frames[6].hash, death.report.frames[7].hash);
  assert.equal(new Set(dead.report.frames.map(frame => frame.hash)).size, 1);
  assert.equal(dead.report.frames[0].hash, death.report.frames.at(-1).hash);
  assert.equal(dead.frames.every(frame => frame.equals(death.frames[7])), true);
  assert.deepEqual(dead.sourceFrameIndexes, Array(FRAME_COUNT).fill(7));
});

test('the tracked elf wizard walk and grounded death atlases recompile to their pins', async () => {
  const specPath = path.join(
    PROJECT_ROOT,
    'ai-image-metadata/characters/player-authored-animations/elf_other_wizard.json'
  );
  const spec = JSON.parse(await fs.promises.readFile(specPath, 'utf8'));
  for (const name of ['walk', 'death']) {
    const animation = spec.animations[name];
    const sourcePath = path.join(PROJECT_ROOT, animation.source);
    const compiled = await compileAtlasAnimation(sourcePath, name, animation);
    const pins = spec.pins.animations[name];

    assert.equal(sha256(await fs.promises.readFile(sourcePath)), pins.sourceSha256);
    assert.equal(sha256(animation.prompt), pins.promptSha256);
    assert.equal(sha256(compiled.buffer), pins.encodedSha256);
    assert.equal(compiled.report.stripHash, pins.decodedSha256);
    assert.deepEqual(compiled.report.frames.map(frame => frame.hash), pins.frameSha256);
    assert.deepEqual(compiled.poseSignatures, pins.poseSha256);
    assert.deepEqual(compiled.sourceFrameIndexes, pins.sourceFrameIndexes);
    assert.deepEqual(compiled.sourceDominantRatios, pins.sourceDominantRatios);
    if (name === 'death') {
      assert.equal(
        compiled.report.frames.every(frame => frame.bounds.maxY === FRAME_SIZE - SAFE_MARGIN - 1),
        true
      );
    }
  }
});

test('pin acceptance preflights divergent outputs before changing the spec', async t => {
  const projectRoot = await temporaryDirectory(t, 'modia-authored-transaction-');
  const id = 'test_other_wizard';
  const variant = {
    id,
    race: 'testfolk',
    gender: 'other',
    class: 'wizard',
    isAdvanced: false,
    inheritsFrom: null,
    animations: ['idle'],
    visualTraits: 'opal-skinned test wizard with one staff',
    portraitReference: `/assets/portraits/originals/${id}.png`,
    seed: 42
  };
  const metadataRoot = path.join(projectRoot, 'ai-image-metadata/characters');
  const sourceRoot = path.join(metadataRoot, 'player-animation-sources', id);
  const templatePath = path.join(metadataRoot, 'player-authored-animation-template.json');
  const profilePath = path.join(metadataRoot, 'player-animation-profiles/wizard_v1.json');
  const registryPath = path.join(metadataRoot, 'player-variants.json');
  const provenancePath = path.join(metadataRoot, 'player-identity-fallbacks.json');
  const specPath = path.join(metadataRoot, 'player-authored-animations', `${id}.json`);
  await fs.promises.mkdir(path.join(sourceRoot, 'chroma'), { recursive: true });
  await fs.promises.mkdir(path.join(sourceRoot, 'inputs'), { recursive: true });

  const reference = Buffer.alloc(64 * 64 * 4);
  paintRectangle(reference, 64, 20, 8, 43, 55);
  for (const relative of ['reference.png', 'chroma/reference.png', 'inputs/identity.png', 'inputs/style.png']) {
    await writeRgbaPng(path.join(sourceRoot, relative), reference, 64, 64);
  }
  const atlasPath = await createArticulatedAtlas(t);
  await fs.promises.copyFile(atlasPath, path.join(sourceRoot, 'idle.png'));
  await fs.promises.copyFile(atlasPath, path.join(sourceRoot, 'chroma/idle.png'));

  await fs.promises.mkdir(path.dirname(templatePath), { recursive: true });
  await fs.promises.mkdir(path.dirname(profilePath), { recursive: true });
  await fs.promises.mkdir(path.dirname(specPath), { recursive: true });
  await fs.promises.writeFile(templatePath, `${JSON.stringify({
    id: 'authored-pose-atlas-v1',
    compiler: { version: COMPILER_VERSION }
  }, null, 2)}\n`);
  await fs.promises.writeFile(profilePath, `${JSON.stringify({
    id: 'wizard_v1',
    class: 'wizard',
    templateId: 'authored-pose-atlas-v1'
  }, null, 2)}\n`);
  await fs.promises.writeFile(registryPath, `${JSON.stringify({ variants: [variant] }, null, 2)}\n`);
  await fs.promises.writeFile(provenancePath, `${JSON.stringify({ version: '1.1.0', variants: {} }, null, 2)}\n`);

  const relativeRoot = `ai-image-metadata/characters/player-animation-sources/${id}`;
  const spec = {
    version: '1.0.0',
    template: 'ai-image-metadata/characters/player-authored-animation-template.json',
    compilerVersion: COMPILER_VERSION,
    id,
    profile: 'wizard_v1',
    profileSource: 'ai-image-metadata/characters/player-animation-profiles/wizard_v1.json',
    status: 'draft-awaiting-generation',
    metadataFingerprint: metadataFingerprint(variant),
    identity: { race: variant.race, gender: variant.gender, class: variant.class },
    reference: {
      source: `${relativeRoot}/reference.png`,
      chromaSource: `${relativeRoot}/chroma/reference.png`,
      identitySource: `${relativeRoot}/inputs/identity.png`,
      styleSource: `${relativeRoot}/inputs/style.png`,
      prompt: 'test reference prompt'
    },
    animations: {
      idle: {
        source: `${relativeRoot}/idle.png`,
        chromaSource: `${relativeRoot}/chroma/idle.png`,
        layout: { columns: 4, rows: 2 },
        anchor: 'source-cell',
        minimumUniquePoses: 8,
        prompt: 'test idle prompt'
      }
    },
    pins: { reference: null, animations: {} }
  };
  const outputDirectory = path.join(
    projectRoot,
    'frontend/public/assets/characters/player/testfolk/other/wizard'
  );
  const referenceOutput = path.join(outputDirectory, `${id}_reference.png`);
  await fs.promises.writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`);
  const rejectedDraft = await compileAuthoredVariant({
    projectRoot,
    registryPath,
    id,
    updatePins: true,
    force: true
  });
  assert.equal(rejectedDraft.ok, false);
  assert.match(rejectedDraft.issues.join('\n'), /is not approved for canonical compilation/);
  assert.equal(fs.existsSync(referenceOutput), false);

  const originalSpec = `${JSON.stringify(spec, null, 2)}\n`;
  await fs.promises.writeFile(specPath, originalSpec);
  await fs.promises.mkdir(outputDirectory, { recursive: true });
  await fs.promises.writeFile(referenceOutput, 'existing divergent output');

  await assert.rejects(
    compileAuthoredVariant({ projectRoot, registryPath, id, updatePins: true, approve: true }),
    /exists; use --force/
  );
  assert.equal(await fs.promises.readFile(specPath, 'utf8'), originalSpec);
  assert.equal(await fs.promises.readFile(referenceOutput, 'utf8'), 'existing divergent output');

  const accepted = await compileAuthoredVariant({
    projectRoot,
    registryPath,
    id,
    updatePins: true,
    approve: true,
    force: true
  });
  assert.equal(accepted.ok, true);
  const updatedSpec = JSON.parse(await fs.promises.readFile(specPath, 'utf8'));
  assert.equal(updatedSpec.pins.reference.encodedSha256, accepted.referencePin.encodedSha256);
  assert.equal(updatedSpec.pins.animations.idle.encodedSha256, accepted.animationPins.idle.encodedSha256);
  assert.equal(updatedSpec.status, 'approved');
  assert.match(updatedSpec.approvedAt, /^\d{4}-\d{2}-\d{2}T/);
});
