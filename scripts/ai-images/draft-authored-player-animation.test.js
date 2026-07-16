'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { parseArgs } = require('./draft-authored-player-animation');
const {
  draftAuthoredVariant,
  renderAuthoredDraft,
  renderTemplate,
  resolveWithinProject
} = require('./lib/authoredPlayerAnimationDraft');
const {
  COMPILER_VERSION,
  metadataFingerprint,
  sha256,
  stableJson
} = require('./lib/authoredPlayerAnimationCompiler');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const TEMPLATE_RELATIVE = 'ai-image-metadata/characters/player-authored-animation-template.json';
const PROFILE_RELATIVE = 'ai-image-metadata/characters/player-animation-profiles/wizard_v1.json';
const REGISTRY_RELATIVE = 'ai-image-metadata/characters/player-variants.json';

async function temporaryDirectory(t, prefix) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function writeJson(filePath, value) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function fixtureVariant(overrides = {}) {
  return {
    id: 'test_other_wizard',
    race: 'testfolk',
    gender: 'other',
    class: 'wizard',
    isAdvanced: false,
    inheritsFrom: 'wizard',
    animations: ['idle', 'walk', 'attack', 'hurt', 'death', 'cast', 'dead', 'victory'],
    visualTraits: 'opal skin swept black hair copper eyes non-binary robed mage carved staff luminous sigils',
    portraitReference: '/assets/portraits/originals/test_other_wizard.png',
    seed: 4242,
    ...overrides
  };
}

async function createFixture(t, variants = [fixtureVariant()]) {
  const root = await temporaryDirectory(t, 'modia-authored-draft-');
  const templateTarget = path.join(root, TEMPLATE_RELATIVE);
  const profileTarget = path.join(root, PROFILE_RELATIVE);
  await fs.promises.mkdir(path.dirname(templateTarget), { recursive: true });
  await fs.promises.mkdir(path.dirname(profileTarget), { recursive: true });
  await Promise.all([
    fs.promises.copyFile(path.join(PROJECT_ROOT, TEMPLATE_RELATIVE), templateTarget),
    fs.promises.copyFile(path.join(PROJECT_ROOT, PROFILE_RELATIVE), profileTarget),
    writeJson(path.join(root, REGISTRY_RELATIVE), { version: 'test', variants })
  ]);
  return root;
}

test('CLI requires exactly one explicit identity and parses guarded draft options', () => {
  const parsed = parseArgs([
    '--id=test_other_wizard',
    '--profile', 'wizard_v1',
    '--template=custom-template.json',
    '--registry', 'custom-registry.json',
    '--output=tmp/draft.json',
    '--project-root', '.',
    '--check',
    '--json'
  ]);
  assert.equal(parsed.id, 'test_other_wizard');
  assert.equal(parsed.profile, 'wizard_v1');
  assert.equal(parsed.templatePath, 'custom-template.json');
  assert.equal(parsed.registryPath, 'custom-registry.json');
  assert.equal(parsed.outputPath, 'tmp/draft.json');
  assert.equal(parsed.projectRoot, '.');
  assert.equal(parsed.check, true);
  assert.equal(parsed.json, true);

  assert.throws(() => parseArgs([]), /--id is required.*bulk drafting is intentionally unsupported/);
  assert.throws(() => parseArgs(['--all']), /Unknown argument: --all/);
  assert.throws(() => parseArgs(['--id']), /--id requires a value/);
  assert.throws(() => parseArgs(['--id=']), /--id requires a value/);
  assert.throws(
    () => parseArgs(['--id', 'test_other_wizard', '--id=second_male_wizard']),
    /--id may only be provided once/
  );
  assert.throws(
    () => parseArgs(['--id', 'test_other_wizard', '--check', '--force']),
    /mutually exclusive/
  );
});

test('tracked wizard profile deterministically renders identity metadata, prompts, frames, and paths', async () => {
  const registry = JSON.parse(await fs.promises.readFile(path.join(PROJECT_ROOT, REGISTRY_RELATIVE)));
  const template = JSON.parse(await fs.promises.readFile(path.join(PROJECT_ROOT, TEMPLATE_RELATIVE)));
  const profile = JSON.parse(await fs.promises.readFile(path.join(PROJECT_ROOT, PROFILE_RELATIVE)));
  const variant = registry.variants.find(entry => entry.id === 'human_female_wizard');
  const first = await renderAuthoredDraft({ id: variant.id, projectRoot: PROJECT_ROOT });
  const second = await renderAuthoredDraft({ id: variant.id, projectRoot: PROJECT_ROOT });

  assert.equal(first.contents, second.contents);
  assert.equal(first.spec.compilerVersion, COMPILER_VERSION);
  assert.equal(first.spec.metadataFingerprint, metadataFingerprint(variant));
  assert.deepEqual(first.spec.draftProvenance, {
    registry: REGISTRY_RELATIVE,
    templateSha256: sha256(stableJson(template)),
    profileSha256: sha256(stableJson(profile))
  });
  assert.equal(first.spec.status, 'draft-awaiting-generation');
  assert.equal(first.spec.identity.race, variant.race);
  assert.equal(first.spec.identity.gender, variant.gender);
  assert.equal(first.spec.identity.class, variant.class);
  assert.equal(first.spec.identity.visualTraits, variant.visualTraits);
  assert.equal(first.spec.inputs.identity.origin, 'frontend/public/assets/portraits/originals/human_female_wizard.png');
  assert.equal(
    first.spec.reference.identitySource,
    'ai-image-metadata/characters/player-animation-sources/human_female_wizard/inputs/identity.png'
  );
  assert.match(first.spec.reference.prompt, /Human Wizard \(female presentation\)/);
  assert.ok(first.spec.reference.prompt.includes(variant.visualTraits));
  assert.doesNotMatch(first.spec.reference.prompt, /silver-white|amber-gold|pale fair angular elven/i);
  assert.deepEqual(Object.keys(first.spec.animations), variant.animations);
  assert.equal(first.spec.animations.walk.frameDescriptions.length, 8);
  assert.equal(first.spec.animations.walk.anchor, 'source-cell');
  assert.match(first.spec.animations.walk.prompt, /left foot forward contact/);
  assert.match(first.spec.animations.walk.prompt, new RegExp(variant.visualTraits));
  assert.deepEqual(first.spec.animations.death.outputFrameMap, [0, 1, 2, 3, 4, 5, 7, 7]);
  assert.equal(first.spec.animations.death.anchor, 'source-cell');
  assert.equal(first.spec.animations.death.verticalAnchor, 'bottom');
  assert.equal(first.spec.animations.victory.frameDescriptions.at(-1), 'final triumphant held pose');
  assert.equal(first.spec.animations.dead.deriveFrom.animation, 'death');
  assert.equal(first.spec.pins.reference, null);
  assert.deepEqual(first.spec.pins.animations, {});
});

test('different identities reuse wizard motion without inheriting another character description', async t => {
  const firstVariant = fixtureVariant();
  const secondVariant = fixtureVariant({
    id: 'second_male_wizard',
    race: 'stonekin',
    gender: 'male',
    visualTraits: 'granite skin braided red hair blue eyes male rune-robed mage iron staff',
    portraitReference: '/assets/portraits/originals/second_male_wizard.png',
    seed: 9393
  });
  const root = await createFixture(t, [firstVariant, secondVariant]);
  const first = await renderAuthoredDraft({ id: firstVariant.id, projectRoot: root });
  const second = await renderAuthoredDraft({ id: secondVariant.id, projectRoot: root });

  assert.ok(first.spec.reference.prompt.includes(firstVariant.visualTraits));
  assert.ok(second.spec.reference.prompt.includes(secondVariant.visualTraits));
  assert.ok(!first.spec.reference.prompt.includes(secondVariant.visualTraits));
  assert.ok(!second.spec.reference.prompt.includes(firstVariant.visualTraits));
  assert.notEqual(first.spec.metadataFingerprint, second.spec.metadataFingerprint);
  assert.deepEqual(
    first.spec.animations.cast.frameDescriptions,
    second.spec.animations.cast.frameDescriptions,
    'class motion comes from one reusable profile'
  );
});

test('draft writes are single-identity, refuse overwrite, and support exact drift checks', async t => {
  const root = await createFixture(t);
  const options = { id: 'test_other_wizard', projectRoot: root };

  const created = await draftAuthoredVariant(options);
  assert.equal(created.ok, true);
  assert.equal(created.generatedImages, false);
  assert.equal(created.output, 'ai-image-metadata/characters/player-authored-animations/test_other_wizard.json');
  const outputPath = path.join(root, created.output);
  assert.equal((await fs.promises.stat(outputPath)).isFile(), true);
  assert.equal(
    fs.existsSync(path.join(root, 'ai-image-metadata/characters/player-animation-sources/test_other_wizard')),
    false,
    'drafting metadata must not create or copy image sources'
  );

  await assert.rejects(draftAuthoredVariant(options), /exists; use --force or --check/);
  assert.deepEqual(await draftAuthoredVariant({ ...options, check: true }), {
    ok: true,
    check: true,
    id: 'test_other_wizard',
    output: created.output,
    issues: [],
    generatedImages: false
  });

  await fs.promises.appendFile(outputPath, ' ');
  const drifted = await draftAuthoredVariant({ ...options, check: true });
  assert.equal(drifted.ok, false);
  assert.deepEqual(drifted.issues, ['draft spec differs from current metadata, profile, or template']);

  const replaced = await draftAuthoredVariant({ ...options, force: true });
  assert.equal(replaced.ok, true);
  assert.equal((await draftAuthoredVariant({ ...options, check: true })).ok, true);
});

test('check reports a missing draft without creating it', async t => {
  const root = await createFixture(t);
  const result = await draftAuthoredVariant({ id: 'test_other_wizard', projectRoot: root, check: true });
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues, ['draft spec is missing']);
  assert.equal(fs.existsSync(path.join(root, result.output)), false);
});

test('project path containment, profile compatibility, and template placeholders fail closed', async t => {
  const root = await createFixture(t);
  assert.throws(() => resolveWithinProject(root, '../outside.json', 'output path'), /escapes the project root/);
  await assert.rejects(
    renderAuthoredDraft({ id: 'test_other_wizard', projectRoot: root, outputPath: '../outside.json' }),
    /escapes the project root/
  );
  await assert.rejects(
    renderAuthoredDraft({ id: 'test_other_wizard', projectRoot: root, outputPath: 'tmp/not-json.txt' }),
    /must end in \.json/
  );
  await assert.rejects(
    renderAuthoredDraft({ id: '../../escape', projectRoot: root }),
    /invalid player variant id/
  );
  await assert.rejects(
    renderAuthoredDraft({ id: 'unknown_other_wizard', projectRoot: root }),
    /unknown player variant/
  );
  assert.throws(
    () => renderTemplate('identity {{missing.token}}', {}, 'test prompt'),
    /missing template token/
  );

  const profilePath = path.join(root, PROFILE_RELATIVE);
  const profile = JSON.parse(await fs.promises.readFile(profilePath));
  profile.class = 'warrior';
  await writeJson(profilePath, profile);
  await assert.rejects(
    renderAuthoredDraft({ id: 'test_other_wizard', projectRoot: root }),
    /targets warrior, not wizard/
  );
});
