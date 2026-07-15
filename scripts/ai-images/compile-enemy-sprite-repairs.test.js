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
  MINIMUM_TRANSPARENT_MARGIN,
  REPAIR_CONTRACT,
  TARGET_MAX_FOREGROUND_COVERAGE,
  inspectEnemyStrip,
  normalizeEnemyStrip,
  parseArgs,
  runEnemySpriteRepairs,
  validateManifest
} = require('./compile-enemy-sprite-repairs');

function drawRectangle(data, frame, inset, color) {
  for (let y = inset; y < FRAME_SIZE - inset; y += 1) {
    for (let x = inset; x < FRAME_SIZE - inset; x += 1) {
      const offset = ((((frame * FRAME_SIZE) + y) * FRAME_SIZE + x) * 4);
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = color[3];
    }
  }
}

async function makeStrip() {
  const data = Buffer.alloc(FRAME_SIZE * FRAME_SIZE * FRAME_COUNT * 4);
  for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
    const inset = frame === 0 ? 1 : 10 + (frame % 3);
    drawRectangle(data, frame, inset, [30 + frame * 20, 90, 170, 255]);
  }
  return sharp(data, {
    raw: {
      width: FRAME_SIZE,
      height: FRAME_SIZE * FRAME_COUNT,
      channels: 4
    }
  }).webp({ lossless: true, effort: 6 }).toBuffer();
}

function opaquePalette(raw) {
  const colors = new Set();
  for (let offset = 0; offset < raw.length; offset += 4) {
    if (raw[offset + 3] === 0) continue;
    colors.add(raw.subarray(offset, offset + 4).toString('hex'));
  }
  return colors;
}

function manifestRepair(report) {
  return {
    id: 'fixture_beast',
    biome: 'forest',
    animation: 'idle',
    assetPath: '/assets/characters/enemies/forest/fixture_beast/fixture_beast_idle.webp',
    originalFlaggedFrames: report.originalFlaggedFrames,
    normalizedCellSize: report.normalizedCellSize,
    source: report.source,
    output: report.output
  };
}

test('normalizer emits deterministic lossless strips with one scale and real transparent framing', async () => {
  const source = await makeStrip();
  const first = await normalizeEnemyStrip(source);
  const second = await normalizeEnemyStrip(source);
  const inspection = await inspectEnemyStrip(first.buffer);

  assert.deepEqual(first.buffer, second.buffer);
  assert.equal(first.report.normalizedCellSize <= 56, true);
  assert.equal(first.report.uniformScale, first.report.normalizedCellSize / FRAME_SIZE);
  assert.deepEqual(first.report.originalFlaggedFrames, [0]);
  assert.equal(inspection.compression, 'lossless');
  assert.equal(inspection.width, 64);
  assert.equal(inspection.height, 512);
  assert.equal(inspection.hasAlpha, true);
  for (const frame of inspection.frames) {
    assert.equal(frame.foregroundCoverage <= TARGET_MAX_FOREGROUND_COVERAGE, true);
    assert.equal(Math.min(...Object.values(frame.margins)) >= MINIMUM_TRANSPARENT_MARGIN, true);
  }

  const sourceRaw = await sharp(source).ensureAlpha().raw().toBuffer();
  const outputRaw = await sharp(first.buffer).ensureAlpha().raw().toBuffer();
  const sourceColors = opaquePalette(sourceRaw);
  const outputColors = opaquePalette(outputRaw);
  assert.equal(outputColors.size, sourceColors.size);
  for (const color of outputColors) {
    assert.equal(sourceColors.has(color), true, `nearest-neighbor output introduced ${color}`);
  }
});

test('compiler check is idempotent and refuses to overwrite pixels outside the manifest', async t => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'modia-enemy-repair-'));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));
  const directory = path.join(
    projectRoot,
    'frontend/public/assets/characters/enemies/forest/fixture_beast'
  );
  await fs.mkdir(directory, { recursive: true });
  const asset = path.join(directory, 'fixture_beast_idle.webp');
  const source = await makeStrip();
  await fs.writeFile(asset, source);
  const unrelatedAsset = path.join(directory, 'already_valid.webp');
  const unrelatedBytes = await sharp({
    create: {
      width: FRAME_SIZE,
      height: FRAME_SIZE * FRAME_COUNT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  }).webp({ lossless: true }).toBuffer();
  await fs.writeFile(unrelatedAsset, unrelatedBytes);

  const compiled = await normalizeEnemyStrip(source);
  const manifest = {
    schemaVersion: 1,
    compilerVersion: COMPILER_VERSION,
    contract: { ...REPAIR_CONTRACT },
    coverage: {
      sheets: 1,
      originalFlaggedFrames: compiled.report.originalFlaggedFrames.length
    },
    repairs: [manifestRepair(compiled.report)]
  };
  const manifestPath = path.join(
    projectRoot,
    'ai-image-metadata/characters/enemy-sprite-repairs.json'
  );
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const checkBefore = await runEnemySpriteRepairs({ projectRoot, check: true });
  assert.equal(checkBefore.ok, false);
  assert.equal(checkBefore.results[0].status, 'needs-repair');

  const repair = await runEnemySpriteRepairs({ projectRoot });
  assert.equal(repair.ok, true);
  assert.equal(repair.coverage.compiled, 1);
  assert.equal(repair.results[0].status, 'compiled');
  const repairedBytes = await fs.readFile(asset);
  assert.deepEqual(repairedBytes, compiled.buffer);
  assert.deepEqual(await fs.readFile(unrelatedAsset), unrelatedBytes);

  const checkAfter = await runEnemySpriteRepairs({ projectRoot, check: true });
  assert.equal(checkAfter.ok, true);
  assert.equal(checkAfter.coverage.valid, 1);
  assert.equal(checkAfter.results[0].status, 'valid');
  const noOp = await runEnemySpriteRepairs({ projectRoot });
  assert.equal(noOp.ok, true);
  assert.equal(noOp.coverage.compiled, 0);
  assert.deepEqual(await fs.readFile(asset), repairedBytes);

  const raw = await sharp(repairedBytes).ensureAlpha().raw().toBuffer();
  raw[0] = 123;
  raw[3] = 255;
  const unknownEdit = await sharp(raw, {
    raw: { width: FRAME_SIZE, height: FRAME_SIZE * FRAME_COUNT, channels: 4 }
  }).webp({ lossless: true }).toBuffer();
  await fs.writeFile(asset, unknownEdit);
  const protectedRun = await runEnemySpriteRepairs({ projectRoot });
  assert.equal(protectedRun.ok, false);
  assert.equal(protectedRun.coverage.protected, 1);
  assert.equal(protectedRun.results[0].status, 'protected');
  assert.deepEqual(await fs.readFile(asset), unknownEdit);
});

test('production manifest pins the complete 12-sheet, 40-frame repair boundary', async () => {
  const manifestPath = path.resolve(
    __dirname,
    '..',
    '..',
    'ai-image-metadata/characters/enemy-sprite-repairs.json'
  );
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  assert.deepEqual(validateManifest(manifest), []);
  assert.equal(manifest.repairs.length, 12);
  assert.equal(
    manifest.repairs.reduce((total, repair) => total + repair.originalFlaggedFrames.length, 0),
    40
  );
  assert.equal(new Set(manifest.repairs.map(repair => repair.assetPath)).size, 12);
});

test('CLI parsing exposes a read-only check mode', () => {
  const root = path.resolve('/tmp/modia-enemy-fixture');
  const manifest = path.resolve('/tmp/enemy-manifest.json');
  assert.deepEqual(parseArgs(['--check', '--json', '--root', root, '--manifest', manifest]), {
    check: true,
    json: true,
    help: false,
    projectRoot: root,
    manifestPath: manifest
  });
  assert.throws(() => parseArgs(['--wat']), /unknown option/);
});
