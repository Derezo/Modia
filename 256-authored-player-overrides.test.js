'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { compileTargets } = require('./lib/playerAnimationCompiler');
const { compileIdentities } = require('./lib/playerIdentityFallbackCompiler');
const {
  discoverApprovedAuthoredSpecs
} = require('./lib/authoredPlayerOverrides');
const { sha256 } = require('./lib/authoredPlayerAnimationCompiler');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const ID = 'elf_other_wizard';
const SPEC_RELATIVE = `ai-image-metadata/characters/player-authored-animations/${ID}.json`;
const SOURCE_ROOT_RELATIVE = 'ai-image-metadata/characters/player-animation-sources';
const REAL_REGISTRY = require('../../ai-image-metadata/characters/player-variants.json');
const REAL_SPEC = require(`../../${SPEC_RELATIVE}`);

async function makeAuthoredFixture(t) {
  const projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'modia-authored-override-'));
  t.after(() => fs.promises.rm(projectRoot, { recursive: true, force: true }));

  const variant = structuredClone(REAL_REGISTRY.variants.find(candidate => candidate.id === ID));
  variant.generated = false;
  variant.generatedAnimations = Object.fromEntries(variant.animations.map(animation => [animation, false]));
  variant.generatedAt = null;
  variant.needsRegeneration = true;
  variant.regenerationQueuedAt = 'fixture';

  const registryPath = path.join(projectRoot, 'ai-image-metadata/characters/player-variants.json');
  const specPath = path.join(projectRoot, SPEC_RELATIVE);
  const sourceRoot = path.join(projectRoot, SOURCE_ROOT_RELATIVE);
  const portraitPath = path.join(projectRoot, 'frontend/public/assets/portraits/originals', `${ID}.png`);
  const emptySpecDirectory = path.join(projectRoot, 'no-authored-specs');
  await fs.promises.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.promises.mkdir(path.dirname(specPath), { recursive: true });
  await fs.promises.mkdir(path.dirname(portraitPath), { recursive: true });
  await fs.promises.mkdir(emptySpecDirectory, { recursive: true });
  await fs.promises.writeFile(registryPath, `${JSON.stringify({ version: 'fixture', variants: [variant] }, null, 2)}\n`);
  await fs.promises.copyFile(path.join(PROJECT_ROOT, SPEC_RELATIVE), specPath);
  for (const metadataSource of [REAL_SPEC.template, REAL_SPEC.profileSource]) {
    const destination = path.join(projectRoot, metadataSource);
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await fs.promises.copyFile(path.join(PROJECT_ROOT, metadataSource), destination);
  }
  for (const relativeSource of [
    `${ID}/reference.png`,
    `${ID}/chroma/reference.png`,
    `${ID}/inputs/identity.png`,
    `${ID}/inputs/style.png`,
    `${ID}/idle.png`,
    `${ID}/chroma/idle.png`
  ]) {
    const destination = path.join(sourceRoot, relativeSource);
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await fs.promises.copyFile(path.join(PROJECT_ROOT, SOURCE_ROOT_RELATIVE, relativeSource), destination);
  }
  await fs.promises.copyFile(
    path.join(PROJECT_ROOT, REAL_SPEC.reference.identitySource),
    portraitPath
  );

  return { projectRoot, registryPath, variant, emptySpecDirectory };
}

function canonicalDirectory(fixture) {
  return path.join(
    fixture.projectRoot,
    'frontend/public/assets/characters/player',
    fixture.variant.race,
    fixture.variant.gender,
    fixture.variant.class
  );
}

test('authored override discovery selects approved specs and ignores drafts', async t => {
  const projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'modia-authored-discovery-'));
  t.after(() => fs.promises.rm(projectRoot, { recursive: true, force: true }));
  const directory = path.join(projectRoot, 'specs');
  await fs.promises.mkdir(directory, { recursive: true });
  const templatePath = path.join(directory, 'template.json');
  const profilePath = path.join(directory, 'profile.json');
  await fs.promises.writeFile(templatePath, '{}');
  await fs.promises.writeFile(profilePath, '{}');
  const sharedPins = {
    templateSha256: sha256(await fs.promises.readFile(templatePath)),
    profileSha256: sha256(await fs.promises.readFile(profilePath)),
    reference: Object.fromEntries(['sourceSha256', 'promptSha256', 'encodedSha256', 'decodedSha256'].map(key => [key, key])),
    animations: {}
  };
  await fs.promises.writeFile(path.join(directory, 'draft.json'), JSON.stringify({ id: 'draft', status: 'draft' }));
  await fs.promises.writeFile(path.join(directory, 'approved.json'), JSON.stringify({
    id: 'approved',
    status: 'approved-pilot',
    template: 'specs/template.json',
    profileSource: 'specs/profile.json',
    pins: sharedPins
  }));

  assert.deepEqual([...discoverApprovedAuthoredSpecs(projectRoot, { specDirectory: directory }).keys()], ['approved']);

  await fs.promises.writeFile(path.join(directory, 'wrong-name.json'), JSON.stringify({
    id: 'different-id',
    status: 'approved',
    template: 'specs/template.json',
    profileSource: 'specs/profile.json',
    pins: sharedPins
  }));
  assert.throws(
    () => discoverApprovedAuthoredSpecs(projectRoot, { specDirectory: directory }),
    /has id different-id instead of wrong-name/
  );
});

test('bulk identity force compilation restores the approved authored reference', async t => {
  const fixture = await makeAuthoredFixture(t);
  const outputPath = path.join(canonicalDirectory(fixture), `${ID}_reference.png`);
  const expectedHash = REAL_SPEC.pins.reference.encodedSha256;

  const clean = await compileIdentities({
    projectRoot: fixture.projectRoot,
    registryPath: fixture.registryPath,
    all: true,
    force: true
  });
  assert.equal(clean.ok, true, clean.issues.join('\n'));
  assert.equal(sha256(await fs.promises.readFile(outputPath)), expectedHash);

  const procedural = await compileIdentities({
    projectRoot: fixture.projectRoot,
    registryPath: fixture.registryPath,
    authoredSpecDirectory: fixture.emptySpecDirectory,
    all: true,
    force: true
  });
  assert.equal(procedural.ok, true, procedural.issues.join('\n'));
  assert.notEqual(sha256(await fs.promises.readFile(outputPath)), expectedHash);

  const restored = await compileIdentities({
    projectRoot: fixture.projectRoot,
    registryPath: fixture.registryPath,
    all: true,
    force: true
  });
  assert.equal(restored.ok, true, restored.issues.join('\n'));
  assert.equal(sha256(await fs.promises.readFile(outputPath)), expectedHash);
  const checked = await compileIdentities({
    projectRoot: fixture.projectRoot,
    registryPath: fixture.registryPath,
    all: true,
    check: true
  });
  assert.equal(checked.ok, true, checked.issues.join('\n'));
});

test('bulk animation force and check use the approved authored strip instead of procedural motion', async t => {
  const fixture = await makeAuthoredFixture(t);
  const outputPath = path.join(canonicalDirectory(fixture), `${ID}_idle.webp`);
  const expectedHash = REAL_SPEC.pins.animations.idle.encodedSha256;

  const clean = await compileTargets({
    projectRoot: fixture.projectRoot,
    registryPath: fixture.registryPath,
    all: true,
    animations: ['idle'],
    force: true,
    now: 'authored'
  });
  assert.equal(clean.ok, true, clean.issues.join('\n'));
  assert.equal(sha256(await fs.promises.readFile(outputPath)), expectedHash);

  await compileIdentities({
    projectRoot: fixture.projectRoot,
    registryPath: fixture.registryPath,
    all: true,
    force: true
  });
  const procedural = await compileTargets({
    projectRoot: fixture.projectRoot,
    registryPath: fixture.registryPath,
    authoredSpecDirectory: fixture.emptySpecDirectory,
    all: true,
    animations: ['idle'],
    force: true,
    now: 'procedural'
  });
  assert.equal(procedural.ok, true, procedural.issues.join('\n'));
  assert.notEqual(sha256(await fs.promises.readFile(outputPath)), expectedHash);

  const divergent = await compileTargets({
    projectRoot: fixture.projectRoot,
    registryPath: fixture.registryPath,
    all: true,
    animations: ['idle'],
    check: true
  });
  assert.equal(divergent.ok, false);
  assert.match(divergent.issues.join('\n'), /differs from approved authored override/);

  const restored = await compileTargets({
    projectRoot: fixture.projectRoot,
    registryPath: fixture.registryPath,
    all: true,
    animations: ['idle'],
    force: true,
    now: 'restored'
  });
  assert.equal(restored.ok, true, restored.issues.join('\n'));
  assert.equal(sha256(await fs.promises.readFile(outputPath)), expectedHash);
  const checked = await compileTargets({
    projectRoot: fixture.projectRoot,
    registryPath: fixture.registryPath,
    all: true,
    animations: ['idle'],
    check: true
  });
  assert.equal(checked.ok, true, checked.issues.join('\n'));
});
