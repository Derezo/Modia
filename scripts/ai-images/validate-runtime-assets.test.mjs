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
  validateEnemyAnimationProvenance,
  validateSpriteContract
} from './validate-runtime-assets.mjs';

const ENEMY_SOURCE_ACTIONS = ['reference', 'idle', 'attack', 'hit', 'death'];

function makeAuthoredEnemySpec(biome, id, status = 'approved') {
  const root = `ai-image-metadata/characters/enemy-animation-sources/${biome}/${id}`;
  return {
    id,
    biome,
    status,
    inputs: {
      identity: { staged: `${root}/inputs/identity.png` },
      style: { staged: `${root}/inputs/style.png` }
    },
    reference: {
      source: `${root}/reference.png`,
      chromaSource: `${root}/chroma/reference.png`,
      identitySource: `${root}/inputs/identity.png`,
      styleSource: `${root}/inputs/style.png`
    },
    animations: Object.fromEntries(
      ENEMY_SOURCE_ACTIONS
        .filter(animation => animation !== 'reference')
        .map(animation => [
          animation,
          {
            source: `${root}/${animation}.png`,
            chromaSource: `${root}/chroma/${animation}.png`
          }
        ])
    )
  };
}

async function writeCompleteEnemySourceSet(projectRoot, biome, id) {
  const root = path.join(
    projectRoot,
    'ai-image-metadata/characters/enemy-animation-sources',
    biome,
    id
  );
  await fs.mkdir(path.join(root, 'inputs'), { recursive: true });
  await fs.mkdir(path.join(root, 'chroma'), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(root, 'inputs/identity.png'), 'identity'),
    fs.writeFile(path.join(root, 'inputs/style.png'), 'style'),
    ...ENEMY_SOURCE_ACTIONS.flatMap(animation => [
      fs.writeFile(path.join(root, `${animation}.png`), `accepted-${animation}`),
      fs.writeFile(path.join(root, 'chroma', `${animation}.png`), `chroma-${animation}`)
    ])
  ]);
}

async function writeAuthoredEnemySpec(projectRoot, biome, id, spec) {
  const file = path.join(
    projectRoot,
    'ai-image-metadata/characters/enemy-authored-animations',
    biome,
    `${id}.json`
  );
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(spec, null, 2)}\n`);
  return file;
}

test('authored approval statuses match the compiler contract', () => {
  assert.equal(isApprovedAuthoredStatus('approved'), true);
  assert.equal(isApprovedAuthoredStatus('approved-pilot'), true);
  assert.equal(isApprovedAuthoredStatus('approved_manual'), true);
  assert.equal(isApprovedAuthoredStatus('draft-awaiting-generation'), false);
});

test('enemy provenance requires one approved spec and every new-pipeline source stage', async t => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'modia-enemy-provenance-'));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));
  await writeCompleteEnemySourceSet(projectRoot, 'forest', 'gray_wolf');
  const spec = makeAuthoredEnemySpec('forest', 'gray_wolf', 'approved-pilot');
  const specFile = await writeAuthoredEnemySpec(projectRoot, 'forest', 'gray_wolf', spec);
  const compilerCalls = [];

  const validation = await validateEnemyAnimationProvenance({
    projectRoot,
    runtimeEnemyIds: ['gray_wolf'],
    authoredEnemySpecs: [{
      file: specFile,
      data: spec
    }],
    primaryBiomes: { gray_wolf: 'forest' },
    verifyAuthoredEnemy: async options => {
      compilerCalls.push(options);
      return { ok: true, issues: [] };
    }
  });

  assert.deepEqual(validation.summary, {
    runtimeIdentities: 1,
    completeIdentities: 1,
    missingSpecs: 0,
    duplicateSpecs: 0,
    unapprovedSpecs: 0,
    biomeMismatches: 0,
    pathMismatches: 0,
    unsafeSpecPaths: 0,
    incompleteSources: 0,
    unsafeIdentities: 0,
    compilerFailures: 0
  });
  assert.deepEqual(validation.issues, []);
  assert.equal(validation.checks[0].complete, true);
  assert.equal(validation.checks[0].compilerVerified, true);
  assert.deepEqual(compilerCalls, [{
    projectRoot,
    id: 'gray_wolf',
    biome: 'forest',
    check: true
  }]);
});

test('enemy provenance reports missing, duplicate, unapproved, biome, and path spec errors', async t => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'modia-enemy-provenance-'));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));
  const duplicateSpec = makeAuthoredEnemySpec('forest', 'duplicate_enemy');
  const authoredEnemySpecs = [
    { data: duplicateSpec },
    { data: structuredClone(duplicateSpec) },
    { data: makeAuthoredEnemySpec('forest', 'draft_enemy', 'draft-awaiting-generation') },
    { data: makeAuthoredEnemySpec('cave', 'wrong_biome_enemy') },
    {
      file: path.join(
        projectRoot,
        'ai-image-metadata/characters/enemy-authored-animations/cave/not_misplaced_enemy.json'
      ),
      data: makeAuthoredEnemySpec('forest', 'misplaced_enemy')
    }
  ];

  const validation = await validateEnemyAnimationProvenance({
    projectRoot,
    runtimeEnemyIds: [
      'missing_enemy',
      'duplicate_enemy',
      'draft_enemy',
      'misplaced_enemy',
      'wrong_biome_enemy'
    ],
    authoredEnemySpecs,
    primaryBiomes: {
      missing_enemy: 'forest',
      duplicate_enemy: 'forest',
      draft_enemy: 'forest',
      misplaced_enemy: 'forest',
      wrong_biome_enemy: 'forest'
    }
  });

  assert.deepEqual(
    validation.issues.map(issue => `${issue.id}:${issue.code}`),
    [
      'wrong_biome_enemy:enemy_authored_spec_biome_mismatch',
      'duplicate_enemy:enemy_authored_spec_duplicate',
      'missing_enemy:enemy_authored_spec_missing',
      'misplaced_enemy:enemy_authored_spec_path_mismatch',
      'draft_enemy:enemy_authored_spec_unapproved'
    ]
  );
  assert.equal(validation.summary.completeIdentities, 0);
  assert.equal(validation.summary.missingSpecs, 1);
  assert.equal(validation.summary.duplicateSpecs, 1);
  assert.equal(validation.summary.unapprovedSpecs, 1);
  assert.equal(validation.summary.biomeMismatches, 1);
  assert.equal(validation.summary.pathMismatches, 1);
});

test('enemy provenance reports missing files and source declarations actionably', async t => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'modia-enemy-provenance-'));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));
  await writeCompleteEnemySourceSet(projectRoot, 'bridge', 'bridge_troll');
  await fs.rm(path.join(
    projectRoot,
    'ai-image-metadata/characters/enemy-animation-sources/bridge/bridge_troll/chroma/death.png'
  ));
  const spec = makeAuthoredEnemySpec('bridge', 'bridge_troll');
  spec.animations.attack.source = 'legacy/enemies/bridge_troll_attack.png';
  const specFile = await writeAuthoredEnemySpec(projectRoot, 'bridge', 'bridge_troll', spec);

  const validation = await validateEnemyAnimationProvenance({
    projectRoot,
    runtimeEnemyIds: ['bridge_troll'],
    authoredEnemySpecs: [{
      file: specFile,
      data: spec
    }],
    primaryBiomes: { bridge_troll: 'bridge' }
  });

  assert.equal(validation.summary.incompleteSources, 1);
  assert.equal(validation.checks[0].complete, false);
  assert.deepEqual(validation.checks[0].missingFiles, [{
    stage: 'chroma',
    asset: 'death',
    path: 'ai-image-metadata/characters/enemy-animation-sources/bridge/bridge_troll/chroma/death.png'
  }]);
  assert.deepEqual(validation.checks[0].declarationMismatches, [{
    stage: 'accepted',
    asset: 'attack',
    field: 'animations.attack.source',
    actual: 'legacy/enemies/bridge_troll_attack.png',
    expected: 'ai-image-metadata/characters/enemy-animation-sources/bridge/bridge_troll/attack.png'
  }]);
  assert.match(validation.issues[0].message, /1 missing or empty file.*1 incorrect source declaration/);
});

test('enemy provenance surfaces compiler pin, output, and source verification failures', async t => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'modia-enemy-provenance-'));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));
  const enemyIds = ['missing_pin_enemy', 'corrupt_output_enemy', 'corrupt_source_enemy'];
  const authoredEnemySpecs = [];
  for (const id of enemyIds) {
    const spec = makeAuthoredEnemySpec('forest', id);
    await writeCompleteEnemySourceSet(projectRoot, 'forest', id);
    authoredEnemySpecs.push({
      file: await writeAuthoredEnemySpec(projectRoot, 'forest', id, spec),
      data: spec
    });
  }

  const validation = await validateEnemyAnimationProvenance({
    projectRoot,
    runtimeEnemyIds: enemyIds,
    authoredEnemySpecs,
    primaryBiomes: Object.fromEntries(enemyIds.map(id => [id, 'forest'])),
    verifyAuthoredEnemy: async ({ id }) => {
      if (id === 'missing_pin_enemy') {
        return {
          ok: false,
          issues: ['reference is not pinned; run with --update-pins after approval']
        };
      }
      if (id === 'corrupt_output_enemy') {
        return {
          ok: false,
          issues: [
            'frontend/public/assets/characters/enemies/forest/corrupt_output_enemy/corrupt_output_enemy_idle.webp differs from deterministic compilation'
          ]
        };
      }
      throw new Error('Input buffer contains unsupported image format');
    }
  });

  assert.equal(validation.summary.completeIdentities, 0);
  assert.equal(validation.summary.compilerFailures, 3);
  assert.deepEqual(
    validation.issues.map(issue => `${issue.id}:${issue.code}`),
    enemyIds
      .toSorted()
      .map(id => `${id}:enemy_authored_compiler_check_failed`)
  );
  assert.match(
    validation.checks.find(check => check.id === 'missing_pin_enemy').compilerIssues[0],
    /not pinned/
  );
  assert.match(
    validation.checks.find(check => check.id === 'corrupt_output_enemy').compilerIssues[0],
    /differs from deterministic compilation/
  );
  assert.match(
    validation.checks.find(check => check.id === 'corrupt_source_enemy').compilerIssues[0],
    /unsupported image format/
  );
});

test('enemy provenance rejects traversal identity segments before resolving source paths', async () => {
  const validation = await validateEnemyAnimationProvenance({
    projectRoot: path.resolve(os.tmpdir(), 'modia-enemy-provenance-does-not-need-to-exist'),
    runtimeEnemyIds: ['../escape', 'safe_enemy'],
    authoredEnemySpecs: [],
    primaryBiomes: {
      '../escape': 'forest',
      safe_enemy: '../forest'
    },
    verifyAuthoredEnemy: async () => {
      assert.fail('unsafe identities must not reach compiler verification');
    }
  });

  assert.equal(validation.summary.unsafeIdentities, 2);
  assert.equal(validation.summary.missingSpecs, 0);
  assert.deepEqual(
    validation.issues.map(issue => issue.code),
    ['enemy_authored_identity_unsafe', 'enemy_authored_identity_unsafe']
  );
});

test('enemy provenance rejects new-pipeline sources reached through external symlinks', async t => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'modia-enemy-provenance-'));
  const externalRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'modia-enemy-external-'));
  t.after(() => Promise.all([
    fs.rm(projectRoot, { recursive: true, force: true }),
    fs.rm(externalRoot, { recursive: true, force: true })
  ]));
  await writeCompleteEnemySourceSet(projectRoot, 'forest', 'symlink_enemy');

  const externalSource = path.join(externalRoot, 'attack.png');
  const sourcePath = path.join(
    projectRoot,
    'ai-image-metadata/characters/enemy-animation-sources/forest/symlink_enemy/attack.png'
  );
  await fs.writeFile(externalSource, 'external-source');
  await fs.rm(sourcePath);
  await fs.symlink(externalSource, sourcePath);
  const spec = makeAuthoredEnemySpec('forest', 'symlink_enemy');
  const specFile = await writeAuthoredEnemySpec(
    projectRoot,
    'forest',
    'symlink_enemy',
    spec
  );

  const validation = await validateEnemyAnimationProvenance({
    projectRoot,
    runtimeEnemyIds: ['symlink_enemy'],
    authoredEnemySpecs: [{
      file: specFile,
      data: spec
    }],
    primaryBiomes: { symlink_enemy: 'forest' },
    verifyAuthoredEnemy: async () => {
      assert.fail('unsafe source paths must not reach compiler verification');
    }
  });

  assert.equal(validation.summary.incompleteSources, 1);
  assert.equal(validation.summary.compilerFailures, 0);
  assert.deepEqual(validation.checks[0].missingFiles, []);
  assert.deepEqual(validation.checks[0].sourceViolations, [{
    stage: 'accepted',
    asset: 'attack',
    path: 'ai-image-metadata/characters/enemy-animation-sources/forest/symlink_enemy/attack.png',
    reason: 'path contains a symbolic link at ai-image-metadata/characters/enemy-animation-sources/forest/symlink_enemy/attack.png'
  }]);
  assert.match(validation.issues[0].message, /1 unsafe or invalid source file/);
});

test('enemy provenance rejects canonical authored specs reached through external symlinks', async t => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'modia-enemy-provenance-'));
  const externalRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'modia-enemy-spec-external-'));
  t.after(() => Promise.all([
    fs.rm(projectRoot, { recursive: true, force: true }),
    fs.rm(externalRoot, { recursive: true, force: true })
  ]));

  const spec = makeAuthoredEnemySpec('forest', 'external_spec_enemy');
  await writeCompleteEnemySourceSet(projectRoot, 'forest', 'external_spec_enemy');
  const externalSpec = path.join(externalRoot, 'forest', 'external_spec_enemy.json');
  await fs.mkdir(path.dirname(externalSpec), { recursive: true });
  await fs.writeFile(externalSpec, `${JSON.stringify(spec, null, 2)}\n`);
  const lexicalSpecRoot = path.join(
    projectRoot,
    'ai-image-metadata/characters/enemy-authored-animations'
  );
  await fs.mkdir(path.dirname(lexicalSpecRoot), { recursive: true });
  await fs.symlink(externalRoot, lexicalSpecRoot);
  const lexicalSpec = path.join(lexicalSpecRoot, 'forest', 'external_spec_enemy.json');

  const validation = await validateEnemyAnimationProvenance({
    projectRoot,
    runtimeEnemyIds: ['external_spec_enemy'],
    authoredEnemySpecs: [{ file: lexicalSpec, data: spec }],
    primaryBiomes: { external_spec_enemy: 'forest' },
    verifyAuthoredEnemy: async () => {
      assert.fail('unsafe spec paths must not reach compiler verification');
    }
  });

  assert.equal(validation.summary.unsafeSpecPaths, 1);
  assert.equal(validation.summary.completeIdentities, 0);
  assert.equal(validation.issues[0].code, 'enemy_authored_spec_path_unsafe');
  assert.match(validation.issues[0].reason, /symbolic link/);
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
