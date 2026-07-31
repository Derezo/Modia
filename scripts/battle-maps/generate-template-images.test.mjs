import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import sharp from 'sharp';

import {
  DEFAULT_CONCURRENCY,
  DEFAULT_TIMEOUT_MS,
  MAX_CONCURRENCY,
  WorkerTimeoutError,
  buildCodexArgs,
  buildCodexWorkerEnvironment,
  generateTemplateImages,
  parseGenerateArgs,
  runCommand,
  selectedVariants
} from './generate-template-images.mjs';
import {
  draftTemplate,
  inspectImage
} from './source-template-lifecycle.mjs';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');
const MANIFEST_RELATIVE = 'ai-image-metadata/battle-maps/manifest.json';
const PROMPT_RELATIVE = 'ai-image-metadata/battle-maps/prompts/source-template-image-v1.json';
const SIDECAR_RELATIVE =
  'ai-image-metadata/battle-maps/templates/forest/forest-template-01.json';

async function temporaryDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'modia-template-generation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function copyTrackedFixture(root, relativePath) {
  const destination = path.join(root, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, await readFile(path.join(PROJECT_ROOT, relativePath)));
}

async function createFixture(t) {
  const root = await temporaryDirectory(t);
  await Promise.all([
    copyTrackedFixture(root, MANIFEST_RELATIVE),
    copyTrackedFixture(root, PROMPT_RELATIVE)
  ]);
  await draftTemplate({ projectRoot: root, theme: 'forest', template: 'forest-template-01' });
  return root;
}

function options(root, overrides = {}) {
  return {
    theme: 'forest',
    template: 'forest-template-01',
    projectRoot: root,
    variants: [],
    count: 1,
    concurrency: DEFAULT_CONCURRENCY,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    dryRun: false,
    force: false,
    resume: false,
    ...overrides
  };
}

function imageWorker(calls, mutate) {
  return async context => {
    calls.push(context);
    await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 3,
        background: { r: 30, g: 90, b: 45 }
      }
    }).png().toFile(path.join(context.workspace, 'candidate.png'));
    if (mutate) await mutate(context);
    await writeFile(path.join(context.workspace, 'last-message.txt'), 'candidate generated\n');
    return {
      stdout: Buffer.from(
        '{"type":"item.completed","item":{"id":"image-call-1",'
          + '"type":"mcp_tool_call","server":"image_gen","tool":"imagegen"}}\n'
      ),
      stderr: Buffer.alloc(0),
      args: ['exec', '--ephemeral', '--sandbox', 'workspace-write']
    };
  };
}

function workerJsonlWithImagegenCalls(count) {
  if (count === 0) {
    return Buffer.from(
      '{"type":"item.completed","item":{"id":"message-1",'
        + '"type":"agent_message","text":"saved '
        + '/tmp/generated_images/fake/call_spoof.png"}}\n'
    );
  }
  return Buffer.from(
    Array.from({ length: count }, (_, index) => JSON.stringify({
      type: 'item.completed',
      item: {
        id: `image-call-${index + 1}`,
        type: 'mcp_tool_call',
        server: 'image_gen',
        tool: 'imagegen'
      }
    })).join('\n') + (count > 0 ? '\n' : '')
  );
}

test('CLI parsing supports repeatable variants or count with bounded concurrency and timeout', () => {
  const parsed = parseGenerateArgs([
    '--theme=forest',
    '--template', 'forest-template-01',
    '--variant', 'mist',
    '--variant=dawn',
    '--concurrency', String(MAX_CONCURRENCY),
    '--timeout=45',
    '--resume',
    '--json'
  ]);
  assert.deepEqual(parsed.variants, ['mist', 'dawn']);
  assert.equal(parsed.count, null);
  assert.equal(parsed.concurrency, MAX_CONCURRENCY);
  assert.equal(parsed.timeoutMs, 45_000);
  assert.equal(parsed.resume, true);
  assert.equal(parsed.json, true);
  assert.deepEqual(selectedVariants(parsed), ['mist', 'dawn']);

  const counted = parseGenerateArgs(['--theme', 'forest', '--template', 'forest-template-01', '--count', '3']);
  assert.deepEqual(selectedVariants(counted), ['candidate-01', 'candidate-02', 'candidate-03']);
  assert.equal(
    parseGenerateArgs([
      '--theme',
      'elven_grove',
      '--template',
      'elven_grove-template-01'
    ]).theme,
    'elven_grove'
  );
  assert.throws(
    () => parseGenerateArgs(['--theme', 'forest', '--template', 'forest-template-01', '--count', '2', '--variant', 'mist']),
    /mutually exclusive/
  );
  assert.throws(
    () => parseGenerateArgs(['--theme', 'forest', '--template', 'forest-template-01', '--concurrency', '5']),
    /integer from 1 to 4/
  );
  assert.throws(
    () => parseGenerateArgs(['--theme', 'forest', '--template', 'forest-template-01', '--force', '--resume']),
    /mutually exclusive/
  );
  const codexArgs = buildCodexArgs('/tmp/disposable-workspace', '/tmp/disposable-workspace/last-message.txt');
  assert.deepEqual(codexArgs.slice(0, 2), ['exec', '--ephemeral']);
  assert.ok(codexArgs.includes('workspace-write'));
  assert.equal(codexArgs.at(-1), '-', 'prompt must be supplied on stdin');
});

test('Codex image workers receive only the minimal runtime environment', async () => {
  const source = {
    PATH: '/usr/bin',
    HOME: '/home/reviewer',
    CODEX_HOME: '/home/reviewer/.codex',
    TMPDIR: '/tmp/reviewer',
    LANG: 'en_CA.UTF-8',
    HTTPS_PROXY: 'http://localhost:3128',
    OPENAI_API_KEY: 'must-not-reach-worker',
    DATABASE_URL: 'must-not-reach-worker',
    SESSION_SECRET: 'must-not-reach-worker',
    STRIPE_API_SECRET_KEY: 'must-not-reach-worker',
    CODEX_THREAD_ID: 'must-not-reach-worker'
  };
  assert.deepEqual(buildCodexWorkerEnvironment(source), {
    PATH: '/usr/bin',
    HOME: '/home/reviewer',
    CODEX_HOME: '/home/reviewer/.codex',
    TMPDIR: '/tmp/reviewer',
    LANG: 'en_CA.UTF-8',
    HTTPS_PROXY: 'http://localhost:3128'
  });

  let spawnOptions;
  const spawnImpl = (_command, _args, childOptions) => {
    spawnOptions = childOptions;
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    queueMicrotask(() => child.emit('close', 0, null));
    return child;
  };
  await runCommand({
    command: 'codex',
    args: ['exec'],
    cwd: '/tmp/template-image-worker',
    input: 'generate',
    timeoutMs: 1_000,
    spawnImpl,
    environmentSource: source
  });
  assert.deepEqual(spawnOptions.env, buildCodexWorkerEnvironment(source));
});

test('dry-run validates frozen tracked input without creating candidates or invoking a worker', async t => {
  const root = await createFixture(t);
  let workerCalls = 0;
  const before = await readFile(path.join(root, SIDECAR_RELATIVE), 'utf8');
  const result = await generateTemplateImages(options(root, { dryRun: true, count: 2 }), {
    worker: async () => {
      workerCalls += 1;
      throw new Error('worker must not run');
    }
  });
  assert.equal(result.dryRun, true);
  assert.equal(result.jobs.length, 2);
  assert.equal(workerCalls, 0);
  await assert.rejects(
    access(path.join(root, 'ai-image-metadata/battle-maps/candidates')),
    /ENOENT/
  );
  assert.equal(await readFile(path.join(root, SIDECAR_RELATIVE), 'utf8'), before);
});

test('mocked workers produce bounded local candidates and never mutate approval metadata', async t => {
  const root = await createFixture(t);
  const calls = [];
  const before = await readFile(path.join(root, SIDECAR_RELATIVE), 'utf8');
  const result = await generateTemplateImages(options(root, {
    variants: ['mist', 'dawn'],
    count: null
  }), { worker: imageWorker(calls) });
  assert.equal(calls.length, 2);
  assert.equal(result.results.length, 2);
  assert.ok(calls.every(call => call.prompt.includes('compositional reference')));
  assert.ok(calls.every(call => call.prompt.includes('Do not create subdirectories')));
  for (const variant of ['mist', 'dawn']) {
    const directory = path.join(
      root,
      'ai-image-metadata/battle-maps/candidates/forest/forest-template-01',
      variant
    );
    const metadata = JSON.parse(await readFile(path.join(directory, 'result.json'), 'utf8'));
    assert.equal(metadata.status, 'candidate-awaiting-review');
    assert.equal(metadata.approval, null);
    assert.match(metadata.image.sha256, /^sha256:[0-9a-f]{64}$/);
    assert.equal(metadata.image.width, 64);
    assert.equal(metadata.image.height, 64);
  }
  assert.equal(await readFile(path.join(root, SIDECAR_RELATIVE), 'utf8'), before);
});

test('candidate acceptance requires exactly one audited imagegen invocation', async t => {
  for (const invocationCount of [0, 2]) {
    await t.test(`rejects ${invocationCount} calls`, async t => {
      const root = await createFixture(t);
      const worker = imageWorker([]);
      await assert.rejects(
        generateTemplateImages(options(root), {
          worker: async context => ({
            ...await worker(context),
            stdout: workerJsonlWithImagegenCalls(invocationCount)
          })
        }),
        new RegExp(
          `worker must call imagegen exactly once; observed ${invocationCount}`
        )
      );
      const outputRoot = path.join(
        root,
        'ai-image-metadata/battle-maps/candidates/forest/forest-template-01'
          + '/candidate-01'
      );
      await assert.rejects(access(path.join(outputRoot, 'candidate.png')), /ENOENT/);
      await assert.rejects(access(path.join(outputRoot, 'result.json')), /ENOENT/);
    });
  }

  for (const [label, server, tool] of [
    ['misleading server', 'untrusted_plugin', 'imagegen'],
    ['misleading tool', 'image_gen', 'imagegen_proxy']
  ]) {
    await t.test(`rejects a ${label}`, async t => {
      const root = await createFixture(t);
      const worker = imageWorker([]);
      await assert.rejects(
        generateTemplateImages(options(root), {
          worker: async context => ({
            ...await worker(context),
            stdout: Buffer.from(`${JSON.stringify({
              type: 'item.completed',
              item: {
                id: 'fake-image-call',
                type: 'mcp_tool_call',
                server,
                tool
              }
            })}\n`)
          })
        }),
        /worker must call imagegen exactly once; observed 0/
      );
      const outputRoot = path.join(
        root,
        'ai-image-metadata/battle-maps/candidates/forest/forest-template-01'
          + '/candidate-01'
      );
      await assert.rejects(access(path.join(outputRoot, 'candidate.png')), /ENOENT/);
      await assert.rejects(access(path.join(outputRoot, 'result.json')), /ENOENT/);
    });
  }
});

test('resume skips complete candidates and finishes only missing variants', async t => {
  const root = await createFixture(t);
  const initialCalls = [];
  await generateTemplateImages(options(root), { worker: imageWorker(initialCalls) });
  assert.equal(initialCalls.length, 1);

  const resumedCalls = [];
  const result = await generateTemplateImages(options(root, {
    count: 2,
    resume: true
  }), { worker: imageWorker(resumedCalls) });
  assert.equal(resumedCalls.length, 1);
  assert.equal(resumedCalls[0].variant, 'candidate-02');
  assert.deepEqual(
    result.results.map(entry => [entry.variant, entry.status]),
    [
      ['candidate-01', 'skipped-complete'],
      ['candidate-02', 'generated']
    ]
  );
});

test('resume replaces a partial candidate directory but ordinary generation refuses it', async t => {
  const root = await createFixture(t);
  const partialDirectory = path.join(
    root,
    'ai-image-metadata/battle-maps/candidates/forest/forest-template-01/candidate-01'
  );
  await mkdir(partialDirectory, { recursive: true });
  await writeFile(path.join(partialDirectory, 'worker.stderr.log'), 'interrupted');
  await assert.rejects(
    generateTemplateImages(options(root), { worker: imageWorker([]) }),
    /candidate candidate-01 is incomplete; use --resume or --force/
  );
  const calls = [];
  const result = await generateTemplateImages(options(root, { resume: true }), {
    worker: imageWorker(calls)
  });
  assert.equal(calls.length, 1);
  assert.equal(result.results[0].status, 'generated');
});

test('worker timeout terminates the process and reports a bounded timeout error', async () => {
  const started = Date.now();
  await assert.rejects(
    runCommand({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: PROJECT_ROOT,
      input: '',
      timeoutMs: 30
    }),
    error => error instanceof WorkerTimeoutError && /timed out after 30ms/.test(error.message)
  );
  assert.ok(Date.now() - started < 2_000);
});

test('filesystem delta audit rejects undeclared worker output and promotes nothing', async t => {
  const root = await createFixture(t);
  const calls = [];
  await assert.rejects(
    generateTemplateImages(options(root), {
      worker: imageWorker(calls, context => (
        writeFile(path.join(context.workspace, 'approval.json'), '{"approved":true}')
      ))
    }),
    /worker created undeclared output: approval\.json/
  );
  const candidateDirectory = path.join(
    root,
    'ai-image-metadata/battle-maps/candidates/forest/forest-template-01/candidate-01'
  );
  await assert.rejects(access(path.join(candidateDirectory, 'candidate.png')), /ENOENT/);
  await assert.rejects(access(path.join(candidateDirectory, 'result.json')), /ENOENT/);
  assert.equal(
    JSON.parse(await readFile(path.join(root, SIDECAR_RELATIVE), 'utf8')).status,
    'draft'
  );
});

test('candidate generation rejects a symlinked writable output boundary', async t => {
  const root = await createFixture(t);
  const outside = await temporaryDirectory(t);
  const candidateParent = path.join(
    root,
    'ai-image-metadata/battle-maps/candidates/forest'
  );
  await mkdir(candidateParent, { recursive: true });
  await symlink(outside, path.join(candidateParent, 'forest-template-01'));
  await assert.rejects(
    generateTemplateImages(options(root), { worker: imageWorker([]) }),
    /candidate (?:directory|generation lock path): contains symbolic-link component/
  );
});

test('same source-image candidate force runs serialize across a failed owner', async t => {
  const root = await createFixture(t);
  let releaseFirst;
  let signalFirst;
  const firstBlocked = new Promise(resolve => {
    signalFirst = resolve;
  });
  const firstRelease = new Promise(resolve => {
    releaseFirst = resolve;
  });
  const first = generateTemplateImages(options(root, { force: true }), {
    worker: async context => {
      signalFirst();
      await firstRelease;
      await imageWorker([])(context);
      throw new Error('intentional first worker failure');
    }
  });
  await firstBlocked;

  let secondEntered = false;
  const second = generateTemplateImages(options(root, { force: true }), {
    worker: async context => {
      secondEntered = true;
      return imageWorker([])(context);
    }
  });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(secondEntered, false, 'second worker must wait for candidate ownership');

  releaseFirst();
  await assert.rejects(first, /intentional first worker failure/);
  const completed = await second;
  assert.equal(completed.results[0].status, 'generated');
  const metadataPath = path.join(
    root,
    'ai-image-metadata/battle-maps/candidates/forest/forest-template-01'
      + '/candidate-01/result.json'
  );
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  assert.deepEqual(
    await inspectImage(path.join(root, metadata.image.path)),
    {
      bytes: metadata.image.bytes,
      width: metadata.image.width,
      height: metadata.image.height,
      format: metadata.image.format,
      sha256: metadata.image.sha256
    }
  );
});

test('source-image candidate locks ignore stale contents and reject symlinks', async t => {
  const root = await createFixture(t);
  const lockDirectory = path.join(
    root,
    'ai-image-metadata/battle-maps/candidates/forest/forest-template-01/.locks'
  );
  const lockPath = path.join(lockDirectory, 'candidate-01.lock');
  await mkdir(lockDirectory, { recursive: true });
  await writeFile(lockPath, '{"pid":999999999}\n');
  await generateTemplateImages(options(root), { worker: imageWorker([]) });
  assert.equal(await readFile(lockPath, 'utf8'), '{"pid":999999999}\n');

  await rm(lockPath);
  const outside = path.join(await temporaryDirectory(t), 'outside.lock');
  await writeFile(outside, '');
  await symlink(outside, lockPath);
  await assert.rejects(
    generateTemplateImages(options(root, { force: true }), {
      worker: imageWorker([])
    }),
    /candidate generation lock path: contains symbolic-link component|must be a regular non-symlink file/
  );
});
