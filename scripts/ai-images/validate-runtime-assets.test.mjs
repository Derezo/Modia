import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';

import {
  buildEnemySpriteCandidateUrls,
  getCanonicalAbilityIconPath,
  getRuntimeItemSubcategory,
  inspectRaster,
  isApprovedAuthoredStatus,
  parseCliArgs,
  playerSpriteContract,
  publicAssetUrlToFile,
  validateAbilityAssets,
  validateSpriteContract
} from './validate-runtime-assets.mjs';

test('authored approval statuses match the compiler contract', () => {
  assert.equal(isApprovedAuthoredStatus('approved'), true);
  assert.equal(isApprovedAuthoredStatus('approved-pilot'), true);
  assert.equal(isApprovedAuthoredStatus('approved_manual'), true);
  assert.equal(isApprovedAuthoredStatus('draft-awaiting-generation'), false);
});

test('item categories match the ItemIcon runtime routing contract', () => {
  assert.equal(getRuntimeItemSubcategory('weapon'), 'weapons');
  assert.equal(getRuntimeItemSubcategory('shield'), 'armor');
  assert.equal(getRuntimeItemSubcategory('accessory'), 'accessories');
  assert.equal(getRuntimeItemSubcategory('material'), 'consumables');
  assert.equal(getRuntimeItemSubcategory('unknown-future-type'), 'weapons');
});

test('enemy candidate paths preserve canonical-biome and dead-animation fallback order', () => {
  const config = {
    getEnemySpriteBiomeCandidates: () => ['forest', 'mountain'],
    getEnemySpriteAnimationCandidates: () => ['dead', 'death']
  };

  assert.deepEqual(
    buildEnemySpriteCandidateUrls('gray_wolf', 'dead', 'mountain', config),
    [
      '/assets/characters/enemies/forest/gray_wolf/gray_wolf_dead.webp',
      '/assets/characters/enemies/forest/gray_wolf/gray_wolf_death.webp',
      '/assets/characters/enemies/mountain/gray_wolf/gray_wolf_dead.webp',
      '/assets/characters/enemies/mountain/gray_wolf/gray_wolf_death.webp'
    ]
  );
});

test('sprite contract is derived from metadata and rejects non-vertical layouts', () => {
  const valid = playerSpriteContract({
    spriteConvention: {
      frameWidth: 64,
      frameHeight: 64,
      framesPerAnimation: 8,
      sheetWidth: 64,
      sheetHeight: 512,
      layout: 'vertical_strip'
    }
  });
  assert.deepEqual(validateSpriteContract(valid), []);

  assert.deepEqual(
    validateSpriteContract({ ...valid, height: 64, layout: 'directional_grid' }),
    [
      'height must be 512 (received 64)',
      'layout must be vertical_strip (received directional_grid)',
      'sheetHeight must equal frameHeight * framesPerAnimation'
    ]
  );
});

test('inspectRaster validates an eight-frame transparent vertical WebP strip', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'modia-runtime-assets-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'valid.webp');
  const width = 64;
  const frameHeight = 64;
  const frameCount = 8;
  const height = frameHeight * frameCount;
  const pixels = Buffer.alloc(width * height * 4);

  for (let frame = 0; frame < frameCount; frame++) {
    for (let y = frame * frameHeight + 12; y < frame * frameHeight + 52; y++) {
      for (let x = 12; x < 52; x++) {
        const offset = (y * width + x) * 4;
        pixels[offset] = 20 + frame * 20;
        pixels[offset + 1] = 80;
        pixels[offset + 2] = 160;
        pixels[offset + 3] = 255;
      }
    }
  }

  await sharp(pixels, { raw: { width, height, channels: 4 } }).webp({ lossless: true }).toFile(file);
  const inspection = await inspectRaster(file, {
    width,
    height,
    frameWidth: width,
    frameHeight,
    frameCount,
    animation: 'walk'
  });

  assert.equal(inspection.valid, true);
  assert.equal(inspection.hasAlpha, true);
  assert.equal(inspection.uniqueFrames, 8);
  assert.match(inspection.contentHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(inspection.problems, []);
  assert.deepEqual(inspection.warnings, []);
});

test('inspectRaster reports dimensions and missing transparency without throwing', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'modia-runtime-assets-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'invalid.webp');
  await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 3,
      background: { r: 30, g: 40, b: 50 }
    }
  }).webp({ lossless: true }).toFile(file);

  const inspection = await inspectRaster(file, {
    width: 64,
    height: 512,
    frameWidth: 64,
    frameHeight: 64,
    frameCount: 8,
    animation: 'idle'
  });
  assert.equal(inspection.valid, false);
  assert.deepEqual(
    inspection.problems.map(problem => problem.code),
    ['image_dimensions', 'image_alpha_channel']
  );
});

test('inspectRaster rejects sprite frames that retain a generated backdrop', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'modia-runtime-assets-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'backdrop.webp');
  const width = 64;
  const height = 512;
  const pixels = Buffer.alloc(width * height * 4);

  for (let frame = 0; frame < 8; frame++) {
    const inset = frame === 3 ? 1 : 16;
    for (let y = frame * 64 + inset; y < (frame + 1) * 64 - inset; y++) {
      for (let x = inset; x < 64 - inset; x++) {
        const offset = (y * width + x) * 4;
        pixels[offset] = 20;
        pixels[offset + 1] = 30;
        pixels[offset + 2] = 80;
        pixels[offset + 3] = 255;
      }
    }
  }

  await sharp(pixels, { raw: { width, height, channels: 4 } }).webp({ lossless: true }).toFile(file);
  const inspection = await inspectRaster(file, {
    width,
    height,
    frameWidth: 64,
    frameHeight: 64,
    frameCount: 8,
    animation: 'idle'
  });

  assert.equal(inspection.valid, false);
  const residueProblems = inspection.problems.filter(problem =>
    problem.code === 'sprite_background_residue'
  );
  assert.deepEqual(residueProblems.map(problem => problem.frame), [3]);
  assert.equal(residueProblems[0].foregroundCoverage, 3844 / 4096);
  assert.equal(residueProblems[0].maxFrameForegroundCoverage, 0.6);
  assert.equal(inspection.frameForegroundCoverage[3], 3844 / 4096);
});

test('ability validation joins canonical paths, alpha WebPs, metadata parity, and orphans', async t => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'modia-runtime-abilities-'));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));
  const iconDirectory = path.join(
    projectRoot,
    'frontend/public/assets/abilities/icons/player'
  );
  await fs.mkdir(iconDirectory, { recursive: true });
  const iconFile = path.join(iconDirectory, 'fire_bolt.webp');
  const pixels = Buffer.alloc(32 * 32 * 4);
  for (let y = 8; y < 24; y++) {
    for (let x = 8; x < 24; x++) {
      const offset = (y * 32 + x) * 4;
      pixels[offset] = 255;
      pixels[offset + 1] = 80;
      pixels[offset + 2] = 20;
      pixels[offset + 3] = 255;
    }
  }
  await sharp(pixels, { raw: { width: 32, height: 32, channels: 4 } })
    .webp({ lossless: true })
    .toFile(iconFile);
  const orphanFile = path.join(iconDirectory, 'orphan.webp');
  await fs.copyFile(iconFile, orphanFile);

  const ability = {
    id: 'fire_bolt',
    source: 'player',
    iconAssetPath: '/assets/abilities/icons/player/fire_bolt.webp',
    generated: true,
    status: 'generated',
    needsRegeneration: false,
    generatedAt: '2026-07-15T00:00:00.000Z'
  };
  const registry = { totalAbilities: 1, abilities: [ability] };
  const manifest = {
    iconOutputPattern: '/assets/abilities/icons/{source}/{id}.webp',
    totalAbilities: 1,
    generatedAbilities: 1,
    missingAbilities: 0,
    needsRegeneration: 0,
    countsBySource: { player: 1 },
    statusOverlays: {}
  };

  assert.equal(getCanonicalAbilityIconPath(ability), ability.iconAssetPath);
  const validation = await validateAbilityAssets({
    projectRoot,
    registry,
    manifest,
    expectedTotal: 1
  });
  assert.deepEqual(validation.summary, {
    registryEntries: 1,
    expectedIcons: 1,
    presentIcons: 1,
    validIcons: 1,
    metadataMismatches: 0,
    orphanFiles: 1
  });
  assert.equal(validation.checks.icons[0].inspection.hasAlpha, true);
  assert.deepEqual(
    validation.issues.map(issue => `${issue.severity}:${issue.code}`),
    ['warning:ability_orphan_file']
  );
});

test('ability validation fails missing icons and stale generated metadata', async t => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'modia-runtime-abilities-'));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));
  const registry = {
    totalAbilities: 1,
    abilities: [{
      id: 'fire_bolt',
      source: 'player',
      iconAssetPath: '/assets/abilities/icons/player/fire_bolt.webp',
      generated: true,
      status: 'generated',
      needsRegeneration: false,
      generatedAt: '2026-07-15T00:00:00.000Z'
    }]
  };
  const manifest = {
    iconOutputPattern: '/assets/abilities/icons/{source}/{id}.webp',
    totalAbilities: 1,
    generatedAbilities: 1,
    missingAbilities: 0,
    needsRegeneration: 0,
    countsBySource: { player: 1 },
    statusOverlays: {}
  };

  const validation = await validateAbilityAssets({
    projectRoot,
    registry,
    manifest,
    expectedTotal: 1
  });
  const issueCodes = new Set(validation.issues.map(issue => issue.code));
  assert.equal(validation.summary.presentIcons, 0);
  assert.equal(validation.checks.missingFiles.length, 1);
  for (const code of [
    'ability_icon_missing',
    'ability_generated_status_mismatch',
    'ability_status_mismatch',
    'ability_generated_at_mismatch',
    'ability_manifest_generated_count_mismatch',
    'ability_manifest_missing_count_mismatch'
  ]) {
    assert.equal(issueCodes.has(code), true, `expected ${code}`);
  }
});

test('ability validation rejects non-square opaque WebP icons', async t => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'modia-runtime-abilities-'));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));
  const iconDirectory = path.join(
    projectRoot,
    'frontend/public/assets/abilities/icons/monster'
  );
  await fs.mkdir(iconDirectory, { recursive: true });
  await sharp({
    create: {
      width: 32,
      height: 24,
      channels: 3,
      background: { r: 80, g: 20, b: 10 }
    }
  }).webp({ lossless: true }).toFile(path.join(iconDirectory, 'flame_burst.webp'));

  const registry = {
    totalAbilities: 1,
    abilities: [{
      id: 'flame_burst',
      source: 'monster',
      iconAssetPath: '/assets/abilities/icons/monster/flame_burst.webp',
      generated: true,
      status: 'generated',
      needsRegeneration: false,
      generatedAt: null
    }]
  };
  const manifest = {
    iconOutputPattern: '/assets/abilities/icons/{source}/{id}.webp',
    totalAbilities: 1,
    generatedAbilities: 1,
    missingAbilities: 0,
    needsRegeneration: 0,
    countsBySource: { monster: 1 },
    statusOverlays: {}
  };
  const validation = await validateAbilityAssets({
    projectRoot,
    registry,
    manifest,
    expectedTotal: 1
  });

  assert.equal(validation.summary.presentIcons, 1);
  assert.equal(validation.summary.validIcons, 0);
  assert.equal(validation.checks.invalidFiles.length, 1);
  const issueCodes = new Set(validation.issues.map(issue => issue.code));
  for (const code of [
    'image_alpha_channel',
    'sprite_opaque_frame',
    'image_no_transparency',
    'ability_icon_not_square'
  ]) {
    assert.equal(issueCodes.has(code), true, `expected ${code}`);
  }
});

test('asset URL conversion and CLI parsing stay deterministic', () => {
  const root = path.resolve('/tmp/modia-fixture');
  assert.equal(
    publicAssetUrlToFile(root, '/assets/items/32/weapons/sword.webp'),
    path.join(root, 'frontend/public/assets/items/32/weapons/sword.webp')
  );
  assert.equal(publicAssetUrlToFile(root, 'https://example.com/not-local.webp'), null);
  assert.deepEqual(parseCliArgs(['--json', '--strict', '--root', root]), {
    json: true,
    strict: true,
    help: false,
    projectRoot: root
  });
  assert.throws(() => parseCliArgs(['--wat']), /Unknown option/);
});
