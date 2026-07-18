'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sharp = require('sharp');

const {
  buildCodexArgs,
  buildWorkerPrompt,
  normalizeReferenceResult,
  parseArgs,
  runPool
} = require('./generate-authored-player-candidates');

test('parseArgs uses a conservative reference-first default', () => {
  assert.deepEqual(parseArgs(['--id', 'dwarf_male_warrior']), {
    id: 'dwarf_male_warrior',
    phase: 'reference',
    actions: null,
    concurrency: 2,
    model: null,
    force: false,
    dryRun: false,
    help: false
  });
});

test('parseArgs validates phase and bounded concurrency', () => {
  assert.throws(
    () => parseArgs(['--id', 'dwarf_male_warrior', '--phase', 'all']),
    /reference or animations/
  );
  assert.throws(
    () => parseArgs(['--id', 'dwarf_male_warrior', '--concurrency', '5']),
    /integer from 1 to 4/
  );
});

test('worker prompt keeps generation scoped and leaves approval manual', () => {
  const prompt = buildWorkerPrompt(
    '/repo/spec.json',
    {
      name: 'idle',
      specField: 'animations.idle',
      chromaPath: '/repo/chroma/idle.png',
      rgbaPath: '/repo/idle.png',
      images: [{ path: '/repo/reference.png', role: 'identity authority' }]
    },
    { generate: true, removeMatte: true, skip: false }
  );

  assert.match(prompt, /image_gen tool exactly once/);
  assert.match(prompt, /without rewriting, shortening, or expanding/);
  assert.match(prompt, /Do not approve or/);
  assert.match(prompt, /animations\.idle\.prompt/);
});

test('Codex arguments use ephemeral headless execution and attached images', () => {
  const args = buildCodexArgs(
    {
      images: [
        { path: '/repo/identity.png' },
        { path: '/repo/style.png' }
      ]
    },
    { model: 'example-model' },
    '/repo/last.txt'
  );

  assert.ok(args.includes('--ephemeral'));
  assert.ok(args.includes('danger-full-access'));
  assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.ok(args.includes('--json'));
  assert.deepEqual(
    args.filter((value, index) => args[index - 1] === '--image'),
    ['/repo/identity.png', '/repo/style.png']
  );
  assert.ok(args.includes('example-model'));
});

test('runPool respects the requested concurrency', async () => {
  let active = 0;
  let maximum = 0;
  const results = await runPool([1, 2, 3, 4, 5], 2, async value => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    return value * 2;
  });

  assert.equal(maximum, 2);
  assert.deepEqual(results, [2, 4, 6, 8, 10]);
});

test('normalizeReferenceResult square-pads retained chroma and transparent reference pairs', async t => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'modia-reference-'));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  const chromaPath = path.join(directory, 'chroma.png');
  const rgbaPath = path.join(directory, 'reference.png');

  await Promise.all([
    sharp({
      create: {
        width: 2,
        height: 4,
        channels: 3,
        background: { r: 0, g: 255, b: 0 }
      }
    }).png().toFile(chromaPath),
    sharp({
      create: {
        width: 2,
        height: 4,
        channels: 4,
        background: { r: 80, g: 20, b: 10, alpha: 1 }
      }
    }).png().toFile(rgbaPath)
  ]);

  const result = await normalizeReferenceResult({
    name: 'reference',
    chromaPath,
    rgbaPath
  });
  const [chromaMetadata, rgbaMetadata, rgbaPixel] = await Promise.all([
    sharp(chromaPath).metadata(),
    sharp(rgbaPath).metadata(),
    sharp(rgbaPath).ensureAlpha().extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer()
  ]);

  assert.deepEqual(result, { width: 2, height: 4, size: 4 });
  assert.deepEqual(
    { width: chromaMetadata.width, height: chromaMetadata.height, channels: chromaMetadata.channels },
    { width: 4, height: 4, channels: 3 }
  );
  assert.deepEqual(
    { width: rgbaMetadata.width, height: rgbaMetadata.height, channels: rgbaMetadata.channels },
    { width: 4, height: 4, channels: 4 }
  );
  assert.equal(rgbaPixel[3], 0);
});
