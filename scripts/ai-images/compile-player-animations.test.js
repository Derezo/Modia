'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const sharp = require('sharp');

const {
  FRAME_COUNT,
  FRAME_SIZE,
  MOTION_PROFILES,
  APPROVED_GOLDEN_STRIPS,
  SAFE_MARGIN,
  STRIP_HEIGHT,
  SUPPORTED_ANIMATIONS,
  applyGeneratedAnimationStatus,
  compileAnimationBuffer,
  compileTargets,
  inspectStrip,
  isApprovedGoldenStrip,
  validateStripContract
} = require('./lib/playerAnimationCompiler');
const { parseArgs } = require('./compile-player-animations');

async function createReference(filePath, accent = [46, 126, 224]) {
  const width = 96;
  const height = 112;
  const data = Buffer.alloc(width * height * 4);
  const paint = (left, top, right, bottom, color) => {
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const offset = ((y * width) + x) * 4;
        data[offset] = color[0];
        data[offset + 1] = color[1];
        data[offset + 2] = color[2];
        data[offset + 3] = 255;
      }
    }
  };
  paint(38, 8, 57, 27, [232, 190, 142]);
  paint(31, 28, 63, 72, accent);
  paint(21, 34, 30, 67, [210, 210, 220]);
  paint(64, 34, 78, 65, [238, 186, 65]);
  paint(34, 73, 45, 103, [65, 72, 100]);
  paint(50, 73, 61, 103, [65, 72, 100]);
  paint(12, 52, 20, 99, [190, 198, 214]);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await sharp(data, { raw: { width, height, channels: 4 } }).png().toFile(filePath);
}

async function createFixture(t, animations = ['idle', 'walk']) {
  const projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'modia-player-compiler-'));
  t.after(() => fs.promises.rm(projectRoot, { recursive: true, force: true }));
  const id = 'human_male_warrior';
  const referencePath = path.join(
    projectRoot,
    'frontend/public/assets/characters/player/human/male/warrior',
    `${id}_reference.png`
  );
  const registryPath = path.join(projectRoot, 'ai-image-metadata/characters/player-variants.json');
  const registry = {
    version: 'test',
    preservedRootField: { keep: true },
    variants: [{
      id,
      race: 'human',
      gender: 'male',
      class: 'warrior',
      animations,
      generated: false,
      generatedAnimations: Object.fromEntries(animations.map(animation => [animation, false])),
      generatedAt: null,
      needsRegeneration: true,
      regenerationQueuedAt: '2026-07-15T00:00:00.000Z',
      preservedVariantField: 'keep'
    }]
  };
  await createReference(referencePath);
  await fs.promises.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.promises.writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
  return { projectRoot, registryPath, referencePath, id };
}

test('all motion profiles are explicit eight-frame temporal sequences', () => {
  assert.deepEqual(Object.keys(MOTION_PROFILES), SUPPORTED_ANIMATIONS);
  for (const animation of SUPPORTED_ANIMATIONS) {
    assert.equal(MOTION_PROFILES[animation].length, FRAME_COUNT, animation);
  }
  for (const frame of MOTION_PROFILES.idle) {
    assert.equal(frame.scaleX, undefined, 'idle must not horizontally warp identity art');
    assert.equal(frame.scaleY, undefined, 'idle must not vertically warp identity art');
    assert.equal(frame.rotate, undefined, 'idle must not rotate identity art');
  }
});

test('compiler is byte-deterministic and every animation strip is unique', async t => {
  const { referencePath, id } = await createFixture(t, SUPPORTED_ANIMATIONS);
  const hashes = new Map();

  for (const animation of SUPPORTED_ANIMATIONS) {
    const first = await compileAnimationBuffer({ referencePath, id, animation });
    const second = await compileAnimationBuffer({ referencePath, id, animation });
    assert.deepEqual(first, second, `${animation} bytes changed between identical runs`);

    const validation = await validateStripContract(first, { animation, requireMotion: true });
    assert.equal(validation.ok, true, `${animation}: ${validation.issues.join('; ')}`);
    assert.equal(validation.report.compression, 'lossless');
    assert.equal(validation.report.frames.length, FRAME_COUNT);
    assert.equal(hashes.has(validation.report.stripHash), false, `${animation} duplicated ${hashes.get(validation.report.stripHash)}`);
    hashes.set(validation.report.stripHash, animation);
  }
});

test('different full-body identity references cannot collapse to one fallback strip', async t => {
  const first = await createFixture(t, ['idle']);
  const secondRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'modia-player-identity-'));
  t.after(() => fs.promises.rm(secondRoot, { recursive: true, force: true }));
  const secondReference = path.join(secondRoot, 'elf_female_wizard_reference.png');
  await createReference(secondReference, [178, 76, 214]);

  const human = await compileAnimationBuffer({
    referencePath: first.referencePath,
    id: first.id,
    animation: 'idle'
  });
  const elf = await compileAnimationBuffer({
    referencePath: secondReference,
    id: 'elf_female_wizard',
    animation: 'idle'
  });
  assert.notEqual((await inspectStrip(human)).stripHash, (await inspectStrip(elf)).stripHash);
});

test('compiled strips satisfy the 64x512 alpha and four-pixel margin contract', async t => {
  const { referencePath, id } = await createFixture(t, ['attack']);
  const buffer = await compileAnimationBuffer({ referencePath, id, animation: 'attack' });
  const report = await inspectStrip(buffer);

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

test('motion profiles encode bob, lunge, recoil, fall, hold, aura, and bounce', async t => {
  const { referencePath, id } = await createFixture(t, SUPPORTED_ANIMATIONS);
  const reports = {};
  for (const animation of SUPPORTED_ANIMATIONS) {
    reports[animation] = await inspectStrip(await compileAnimationBuffer({ referencePath, id, animation }));
  }

  const centroids = (animation, axis) => reports[animation].frames.map(frame => frame.bounds[axis]);
  const range = values => Math.max(...values) - Math.min(...values);
  assert.ok(range(centroids('idle', 'centroidY')) >= 0.5, 'idle breathing');
  assert.ok(range(centroids('walk', 'centroidY')) >= 1, 'walk bob');
  assert.ok(Math.max(...centroids('attack', 'centroidX')) - centroids('attack', 'centroidX')[0] >= 2, 'attack lunge');
  assert.ok(centroids('hurt', 'centroidX')[0] - Math.min(...centroids('hurt', 'centroidX')) >= 2, 'hurt recoil');
  assert.ok(reports.death.frames.at(-1).bounds.width > reports.death.frames[0].bounds.width, 'death fall width');
  assert.ok(reports.death.frames.at(-1).bounds.height < reports.death.frames[0].bounds.height, 'death fall height');
  assert.equal(new Set(reports.dead.frames.map(frame => frame.hash)).size, 1, 'dead pose hold');
  assert.ok(new Set(reports.cast.frames.map(frame => frame.hash)).size >= 7, 'cast aura');
  assert.ok(range(centroids('victory', 'centroidY')) >= 3, 'victory bounce');
});

test('contract validation rejects lossy strips and occupied safe margins', async () => {
  const data = Buffer.alloc(FRAME_SIZE * STRIP_HEIGHT * 4);
  for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
    const offset = ((((frame * FRAME_SIZE) + 1) * FRAME_SIZE) + 1) * 4;
    data[offset] = 255;
    data[offset + 3] = 255;
  }
  const lossy = await sharp(data, {
    raw: { width: FRAME_SIZE, height: STRIP_HEIGHT, channels: 4 }
  }).webp({ lossless: false, quality: 80 }).toBuffer();
  const validation = await validateStripContract(lossy, { animation: 'idle' });

  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some(issue => issue.includes('lossless')));
  assert.ok(validation.issues.some(issue => issue.includes('safe margin')));
});

test('only the exact hashed golden idle can carry its documented encoding and margin exceptions', () => {
  const approval = APPROVED_GOLDEN_STRIPS['human_male_warrior/idle'];
  const acceptedIssues = [
    'expected lossless WebP compression, received lossy',
    'frame 0 violates the 4px safe margin',
    'frame 7 violates the 4px safe margin'
  ];
  assert.equal(
    isApprovedGoldenStrip('human_male_warrior/idle', approval.encodedSha256, acceptedIssues),
    true
  );
  assert.equal(isApprovedGoldenStrip('human_male_warrior/idle', '0'.repeat(64), acceptedIssues), false);
  assert.equal(
    isApprovedGoldenStrip('human_male_warrior/idle', approval.encodedSha256, [...acceptedIssues, 'frame 3 is blank']),
    false
  );
  assert.equal(isApprovedGoldenStrip('elf_female_wizard/cast', approval.encodedSha256, acceptedIssues), false);
});

test('wide equipment silhouettes still validate a settled death transition', async t => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'modia-wide-death-'));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  const referencePath = path.join(directory, 'wide_berserker_reference.png');
  const width = 160;
  const height = 110;
  const pixels = Buffer.alloc(width * height * 4);
  const paint = (left, top, right, bottom, rgba) => {
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const offset = ((y * width) + x) * 4;
        pixels.set(rgba, offset);
      }
    }
  };
  paint(8, 42, 151, 67, [90, 70, 55, 255]);
  paint(61, 5, 98, 104, [190, 76, 52, 255]);
  await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toFile(referencePath);

  const buffer = await compileAnimationBuffer({
    referencePath,
    id: 'orc_male_berserker',
    animation: 'death'
  });
  const validation = await validateStripContract(buffer, { animation: 'death', requireMotion: true });
  assert.equal(validation.ok, true, validation.issues.join('; '));
  assert.equal(
    validation.report.frames.at(-1).hash,
    validation.report.frames.at(-2).hash,
    'fallen pose must settle for the final two frames'
  );
});

test('scoped compilation preserves existing strips unless force is explicit', async t => {
  const { projectRoot, registryPath, referencePath, id } = await createFixture(t, ['idle']);
  const now = '2026-07-15T12:00:00.000Z';
  const first = await compileTargets({ projectRoot, registryPath, ids: [id], animations: ['idle'], now });
  assert.equal(first.ok, true);
  assert.deepEqual(first.generated, [`${id}/idle`]);

  const outputPath = path.join(path.dirname(referencePath), `${id}_idle.webp`);
  const original = await fs.promises.readFile(outputPath);
  await createReference(referencePath, [214, 64, 92]);

  const preserved = await compileTargets({ projectRoot, registryPath, ids: [id], animations: ['idle'] });
  assert.equal(preserved.ok, true);
  assert.deepEqual(preserved.skipped, [`${id}/idle`]);
  assert.deepEqual(await fs.promises.readFile(outputPath), original);

  const forced = await compileTargets({ projectRoot, registryPath, ids: [id], animations: ['idle'], force: true });
  assert.equal(forced.ok, true);
  assert.notDeepEqual(await fs.promises.readFile(outputPath), original);
});

test('metadata updates preserve unrelated fields and only clear regeneration when complete', () => {
  const registry = {
    untouched: true,
    variants: [{
      id: 'hero',
      animations: ['idle', 'walk'],
      generated: false,
      generatedAnimations: { idle: false, walk: false },
      generatedAt: null,
      needsRegeneration: true,
      regenerationQueuedAt: 'queued',
      custom: { keep: true }
    }]
  };
  const afterIdle = applyGeneratedAnimationStatus(registry, [{ id: 'hero', animation: 'idle', written: true }], 'first');
  assert.equal(afterIdle.variants[0].generated, false);
  assert.equal(afterIdle.variants[0].needsRegeneration, true);
  assert.equal(afterIdle.variants[0].regenerationQueuedAt, 'queued');
  assert.deepEqual(afterIdle.variants[0].custom, { keep: true });
  assert.equal(registry.variants[0].generatedAnimations.idle, false, 'input was mutated');

  const complete = applyGeneratedAnimationStatus(afterIdle, [{ id: 'hero', animation: 'walk', written: true }], 'second');
  assert.equal(complete.variants[0].generated, true);
  assert.equal(complete.variants[0].needsRegeneration, false);
  assert.equal(complete.variants[0].regenerationQueuedAt, null);
  assert.equal(complete.variants[0].generatedAt, 'second');
  assert.equal(complete.untouched, true);
});

test('--check validates files and metadata without modifying either', async t => {
  const { projectRoot, registryPath, referencePath, id } = await createFixture(t, ['idle']);
  await compileTargets({ projectRoot, registryPath, ids: [id], animations: ['idle'], now: 'fixed' });
  const outputPath = path.join(path.dirname(referencePath), `${id}_idle.webp`);
  const beforeAsset = await fs.promises.readFile(outputPath);
  const beforeMetadata = await fs.promises.readFile(registryPath);

  const checked = await compileTargets({ projectRoot, registryPath, ids: [id], animations: ['idle'], check: true });
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.verified, [`${id}/idle`]);
  assert.deepEqual(await fs.promises.readFile(outputPath), beforeAsset);
  assert.deepEqual(await fs.promises.readFile(registryPath), beforeMetadata);

  const registry = JSON.parse(beforeMetadata);
  registry.variants[0].generatedAnimations.idle = false;
  await fs.promises.writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
  const mismatch = await compileTargets({ projectRoot, registryPath, ids: [id], animations: ['idle'], check: true });
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.issues.some(issue => issue.includes('generatedAnimations metadata')));
});

test('CLI parsing makes bulk work explicit and supports repeatable scoped filters', () => {
  assert.throws(() => parseArgs([]), /Choose exactly one scope/);
  assert.throws(() => parseArgs(['--all', '--sample']), /Choose exactly one scope/);
  assert.deepEqual(
    parseArgs(['--id', 'human_male_warrior', '--id=elf_female_wizard', '--animations', 'idle,walk', '--check']),
    {
      ids: ['human_male_warrior', 'elf_female_wizard'],
      animations: ['idle', 'walk'],
      check: true
    }
  );
});
