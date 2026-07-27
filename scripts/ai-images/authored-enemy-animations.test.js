'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { parseArgs: parseDraft } = require('./draft-authored-enemy-animation');
const { parseArgs: parseCompile } = require('./compile-authored-enemy-animations');
const { parseArgs: parseStage } = require('./stage-authored-enemy-inputs');
const { renderAuthoredEnemyDraft } = require('./lib/authoredEnemyAnimationDraft');
const { applyApproval, runtimeOutputPaths } = require('./lib/authoredEnemyAnimationCompiler');

test('enemy draft requires an explicit biome-scoped identity', () => {
  assert.deepEqual(parseDraft(['--biome', 'forest', '--id', 'gray_wolf']), { biome: 'forest', id: 'gray_wolf' });
  assert.deepEqual(parseDraft(['--biome', 'forest', '--all']), { biome: 'forest', all: true });
  assert.throws(() => parseDraft(['--id', 'gray_wolf']), /--biome is required/);
  assert.throws(() => parseDraft(['--biome', 'forest', '--id', 'gray_wolf', '--all']), /exactly one/);
  assert.deepEqual(parseStage(['--biome', 'forest', '--all', '--force']), { biome: 'forest', all: true, force: true });
});

test('enemy compiler keeps promotion explicit', () => {
  assert.deepEqual(parseCompile(['--biome', 'forest', '--id', 'gray_wolf', '--check']), { biome: 'forest', id: 'gray_wolf', check: true });
  assert.throws(() => parseCompile(['--all-approved']), /requires --check/);
  assert.throws(() => parseCompile(['--biome', 'forest', '--id', 'gray_wolf', '--check', '--update-pins']), /mutually exclusive/);
  assert.throws(() => parseCompile(['--biome', 'forest', '--id', 'gray_wolf', '--approve']), /requires --update-pins/);
  assert.deepEqual(
    parseCompile(['--biome', 'forest', '--id', 'gray_wolf', '--update-pins', '--approve', '--force']),
    { biome: 'forest', id: 'gray_wolf', updatePins: true, approve: true, force: true }
  );
});

test('approval transition records status and timestamp without replacing an existing approval date', () => {
  const draft = { status: 'draft-awaiting-generation', approvedAt: null };
  applyApproval(draft, '2026-07-18T15:30:00.000Z');
  assert.deepEqual(draft, { status: 'approved', approvedAt: '2026-07-18T15:30:00.000Z' });

  applyApproval(draft, '2026-07-19T00:00:00.000Z');
  assert.equal(draft.approvedAt, '2026-07-18T15:30:00.000Z');
});

test('enemy draft uses tracked sources and canonical biome identity', async () => {
  const rendered = await renderAuthoredEnemyDraft({ projectRoot: path.resolve(__dirname, '../..'), biome: 'forest', id: 'gray_wolf' });
  assert.equal(rendered.output, 'ai-image-metadata/characters/enemy-authored-animations/forest/gray_wolf.json');
  assert.equal(rendered.spec.inputs.identity.origin, 'frontend/public/assets/portraits/originals/enemy_gray_wolf.png');
  assert.equal(rendered.spec.reference.identitySource, 'ai-image-metadata/characters/enemy-animation-sources/forest/gray_wolf/inputs/identity.png');
  assert.equal(rendered.spec.reference.source, 'ai-image-metadata/characters/enemy-animation-sources/forest/gray_wolf/reference.png');
  assert.equal(rendered.spec.animations.hit.source, 'ai-image-metadata/characters/enemy-animation-sources/forest/gray_wolf/hit.png');
  assert.deepEqual(rendered.spec.animations.dead.deriveFrom, { animation: 'death', frame: 7 });
  assert.match(rendered.spec.animations.attack.prompt, /Existing action direction:/);
  assert.match(rendered.spec.reference.prompt, /Image 1 is authoritative enemy identity/);
  assert.match(rendered.spec.reference.prompt, /Image 2 is rendering-style authority only/);
});

test('authored-only enemy identity inherits choreography without losing its portrait identity', async () => {
  const rendered = await renderAuthoredEnemyDraft({
    projectRoot: path.resolve(__dirname, '../..'),
    biome: 'bridge',
    id: 'bandit_captain'
  });
  assert.equal(rendered.spec.id, 'bandit_captain');
  assert.equal(rendered.spec.identity.name, 'Bandit Captain');
  assert.equal(rendered.spec.inputs.identity.origin, 'frontend/public/assets/portraits/originals/enemy_bandit_captain.png');
  assert.equal(rendered.spec.draftProvenance.authoredAliasRegistry, 'ai-image-metadata/characters/enemy-authored-identity-aliases.json');
  assert.match(rendered.spec.animations.attack.prompt, /Bandit Captain/);
});

test('enemy compiler destinations match BattleAssetConfig conventions', () => {
  const root = '/repo';
  const outputs = runtimeOutputPaths(root, 'forest', 'gray_wolf');
  assert.equal(outputs.reference, '/repo/frontend/public/assets/characters/enemies/forest/gray_wolf/gray_wolf_reference.png');
  assert.equal(outputs.animations.hit, '/repo/frontend/public/assets/characters/enemies/forest/gray_wolf/gray_wolf_hit.webp');
  assert.equal(outputs.animations.dead, '/repo/frontend/public/assets/characters/enemies/forest/gray_wolf/gray_wolf_dead.webp');
});

test('enemy Codex runner uses portrait identity then rendering style', () => {
  const modulePath = require.resolve('./generate-authored-player-candidates');
  delete require.cache[modulePath];
  process.env.MODIA_AUTHORED_CHARACTER_KIND = 'enemy';
  const { buildJobs, parseArgs } = require('./generate-authored-player-candidates');
  assert.equal(parseArgs(['--biome', 'forest', '--id', 'gray_wolf']).biome, 'forest');
  assert.equal(parseArgs(['--biome', 'forest', '--all']).all, true);
  const jobs = buildJobs({
    id: 'gray_wolf',
    inputs: {
      identity: { staged: 'sources/identity.png' },
      style: { staged: 'sources/style.png' }
    },
    reference: { source: 'sources/reference.png', chromaSource: 'sources/chroma/reference.png' }
  }, { phase: 'reference' });
  assert.deepEqual(jobs[0].images.map(image => image.role), [
    'identity authority (Image 1)',
    'rendering-style authority (Image 2)'
  ]);
});
