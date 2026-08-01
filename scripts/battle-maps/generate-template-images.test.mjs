import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { constants as fsConstants } from 'node:fs';
import {
  access,
  link,
  mkdir,
  mkdtemp,
  open as openFile,
  readFile,
  rename,
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
  buildGenerationPrompt,
  buildCodexArgs,
  buildCodexWorkerEnvironment,
  generateTemplateImages,
  parseGenerateArgs,
  runCommand,
  selectedVariants
} from './generate-template-images.mjs';
import {
  auditCodexWorkerJsonl,
  verifyCodexImagegenEvidence
} from './codex-worker-boundary.mjs';
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
      args: [
        'exec',
        '--ephemeral',
        '--enable',
        'image_generation',
        '--sandbox',
        'workspace-write'
      ]
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

function artifactWorkerJsonl(threadId, artifactPath) {
  return Buffer.from([
    JSON.stringify({ type: 'thread.started', thread_id: threadId }),
    JSON.stringify({
      type: 'item.completed',
      item: {
        id: 'copy-generated-image',
        type: 'command_execution',
        command: `/bin/cp ${artifactPath} candidate.png`,
        status: 'completed',
        exit_code: 0
      }
    })
  ].join('\n') + '\n');
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
  assert.deepEqual(
    codexArgs.slice(codexArgs.indexOf('--enable'), codexArgs.indexOf('--enable') + 2),
    ['--enable', 'image_generation']
  );
  assert.ok(codexArgs.includes('workspace-write'));
  assert.equal(codexArgs.at(-1), '-', 'prompt must be supplied on stdin');
});

test('template prompt makes camera framing and dual-access height intent explicit', async () => {
  const [sidecar, profile] = await Promise.all([
    readFile(
      path.join(
        PROJECT_ROOT,
        'ai-image-metadata/battle-maps/templates/forest/forest-template-03.json'
      ),
      'utf8'
    ).then(JSON.parse),
    readFile(path.join(PROJECT_ROOT, PROMPT_RELATIVE), 'utf8').then(JSON.parse)
  ]);
  const prompt = buildGenerationPrompt({
    sidecar,
    profile,
    theme: 'forest',
    template: 'forest-template-03'
  }, 'candidate-review');
  assert.match(prompt, /Keep the complete irregular oak-meadow basin, both loops/);
  assert.match(prompt, /visibly show separate connected slope and stair approaches/);
  assert.match(prompt, /never as a rock-ringed isolated summit/);
  assert.match(prompt, /one standalone\s+command that must exit successfully/);
  assert.match(prompt, /do not chain file, identify, or any other inspection\s+utility/);
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
  assert.ok(calls.every(call =>
    call.prompt.includes('Tracked template-specific source-image semantic contract')
  ));
  assert.ok(calls.every(call =>
    call.prompt.includes(
      'An enclosed woodland composition organized around differently sized clearings'
    )
  ));
  assert.ok(calls.every(call =>
    call.prompt.includes('surfaces: forest grass, packed dirt, mossy rock')
  ));
  assert.ok(calls.every(call => call.prompt.includes('Required negative space:')));
  assert.ok(calls.every(call => call.prompt.includes('Density distribution:')));
  assert.ok(calls.every(call => call.prompt.includes(
    'Camera framing: Keep the irregular forest boundary and all formation areas readable'
  )));
  assert.ok(calls.every(call => call.prompt.includes(
    'Make every required topology relationship visibly readable'
  )));
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

test('publishes the exact candidate bytes held by verification', async t => {
  const root = await createFixture(t);
  const replacementBytes = await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 3,
      background: { r: 180, g: 30, b: 20 }
    }
  }).png().toBuffer();
  let verifiedBytes;
  await generateTemplateImages(options(root), {
    worker: imageWorker([]),
    afterCandidateVerified: async ({
      workspaceCandidate,
      verifiedCandidateBytes
    }) => {
      verifiedBytes = Buffer.from(verifiedCandidateBytes);
      await writeFile(workspaceCandidate, replacementBytes);
    }
  });
  const publishedPath = path.join(
    root,
    'ai-image-metadata/battle-maps/candidates/forest/forest-template-01'
      + '/candidate-01/candidate.png'
  );
  const publishedBytes = await readFile(publishedPath);
  assert.deepEqual(publishedBytes, verifiedBytes);
  assert.notDeepEqual(publishedBytes, replacementBytes);
  assert.equal(
    (await inspectImage(publishedPath)).sha256,
    `sha256:${createHash('sha256').update(verifiedBytes).digest('hex')}`
  );
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
      assert.match(
        await readFile(path.join(outputRoot, 'prompt.txt'), 'utf8'),
        /source-image candidate variant "candidate-01"/
      );
      assert.equal(
        await readFile(path.join(outputRoot, 'worker.jsonl'), 'utf8'),
        workerJsonlWithImagegenCalls(invocationCount).toString()
      );
      assert.equal(
        await readFile(path.join(outputRoot, 'worker.stderr.log'), 'utf8'),
        ''
      );
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
  await t.test('rejects one successful and one failed call as two attempts', async t => {
    const root = await createFixture(t);
    const worker = imageWorker([]);
    await assert.rejects(
      generateTemplateImages(options(root), {
        worker: async context => ({
          ...await worker(context),
          stdout: Buffer.from([
            JSON.stringify({
              type: 'item.completed',
              item: {
                id: 'image-call-success',
                type: 'mcp_tool_call',
                server: 'image_gen',
                tool: 'imagegen',
                status: 'completed'
              }
            }),
            JSON.stringify({
              type: 'item.failed',
              item: {
                id: 'image-call-failed',
                type: 'mcp_tool_call',
                server: 'image_gen',
                tool: 'imagegen',
                status: 'failed'
              }
            })
          ].join('\n') + '\n')
        })
      }),
      /worker must call imagegen exactly once; observed 2/
    );
  });
});

test('explicit imagegen audit counts the complete correlated lifecycle set', async () => {
  function toolEvent(eventType, {
    id = 'image-call-1',
    callId,
    server = 'image_gen',
    tool = 'imagegen',
    status,
    envelopeStatus,
    itemError,
    envelopeError
  } = {}) {
    return JSON.stringify({
      type: eventType,
      ...(envelopeStatus === undefined ? {} : { status: envelopeStatus }),
      ...(envelopeError === undefined ? {} : { error: envelopeError }),
      item: {
        id,
        ...(callId === undefined ? {} : { call_id: callId }),
        type: 'mcp_tool_call',
        server,
        tool,
        ...(status === undefined ? {} : { status }),
        ...(itemError === undefined ? {} : { error: itemError })
      }
    });
  }

  function audit(...events) {
    return auditCodexWorkerJsonl(Buffer.from(`${events.join('\n')}\n`));
  }

  for (const unsuccessful of [
    [toolEvent('item.started', { status: 'in_progress' })],
    [toolEvent('item.completed', { status: 'failed' })],
    [toolEvent('item.cancelled', { status: 'cancelled' })],
    [
      toolEvent('item.started', { status: 'in_progress' }),
      toolEvent('item.failed', { status: 'failed' })
    ]
  ]) {
    const result = audit(...unsuccessful);
    assert.equal(result.imagegenInvocationCount, 1);
    assert.equal(result.imagegenEvidence, 'none');
    await assert.rejects(
      verifyCodexImagegenEvidence(result),
      /no verifiable imagegen evidence/
    );
  }

  const successful = audit(
    toolEvent('item.started', { status: 'in_progress' }),
    toolEvent('item.completed', { status: 'completed' })
  );
  assert.equal(successful.imagegenInvocationCount, 1);
  assert.equal(successful.imagegenEvidence, 'explicit-tool-call');

  for (const unsuccessfulTerminal of [
    ['item.failed', 'failed'],
    ['item.cancelled', 'cancelled'],
    ['item.started', 'in_progress']
  ]) {
    const mixed = audit(
      toolEvent('item.completed', {
        id: 'image-call-success',
        status: 'completed'
      }),
      toolEvent(unsuccessfulTerminal[0], {
        id: 'image-call-unsuccessful',
        status: unsuccessfulTerminal[1]
      })
    );
    assert.equal(mixed.imagegenInvocationCount, 2);
    assert.equal(mixed.imagegenEvidence, 'none');
  }
  assert.throws(
    () => audit(toolEvent('item.completed', {
      status: 'failed',
      envelopeStatus: 'completed'
    })),
    /contradictory item\/envelope status/
  );
  assert.throws(
    () => audit(toolEvent('item.completed', {
      status: 'completed',
      envelopeError: { message: 'failed outside the item' }
    })),
    /contradictory status and error/
  );

  assert.equal(
    audit(
      toolEvent('item.completed', { status: 'completed' }),
      toolEvent('item.completed', { status: 'completed' })
    ).imagegenInvocationCount,
    1,
    'identical duplicate terminal records correlate to one invocation'
  );
  assert.throws(
    () => audit(
      toolEvent('item.completed', { status: 'completed' }),
      toolEvent('item.completed', { status: 'failed' })
    ),
    /conflicting terminal lifecycle/
  );
  assert.throws(
    () => audit(
      toolEvent('item.started', { status: 'in_progress' }),
      toolEvent('item.completed', {
        server: 'untrusted_plugin',
        tool: 'imagegen'
      })
    ),
    /conflicting tool identities/
  );
  assert.throws(
    () => audit(
      toolEvent('item.completed', { status: 'completed' }),
      toolEvent('item.started', { status: 'in_progress' })
    ),
    /nonterminal record after terminal/
  );
  for (const terminalOrder of [
    ['completed', 'failed'],
    ['failed', 'completed']
  ]) {
    assert.throws(
      () => audit(
        toolEvent('item.completed', {
          id: 'item-A',
          callId: 'call-X',
          status: terminalOrder[0]
        }),
        toolEvent('item.completed', {
          id: 'item-B',
          callId: 'call-X',
          status: terminalOrder[1]
        })
      ),
      /conflicting terminal lifecycle/
    );
  }
  assert.equal(
    audit(
      toolEvent('item.completed', {
        id: 'item-A',
        callId: 'call-X',
        status: 'completed'
      }),
      toolEvent('item.completed', {
        id: 'item-B',
        callId: 'call-X',
        status: 'completed'
      })
    ).imagegenInvocationCount,
    1
  );
  assert.throws(
    () => audit(
      toolEvent('item.started', {
        id: 'item-A',
        callId: 'call-X',
        status: 'in_progress'
      }),
      toolEvent('item.completed', {
        id: 'item-A',
        callId: 'call-Y',
        status: 'completed'
      })
    ),
    /contradictory call IDs/
  );
});

test('imagegen audit accepts only current-thread artifact evidence from command records', () => {
  const currentThread = '019fb575-8501-7683-bdd9-5902725c883c';
  const artifactPath = `/home/test/.codex/generated_images/${currentThread}`
    + '/exec-2f23f121-8633-4142-b38b-c5fce4c44af3.png';
  const valid = [
    JSON.stringify({ type: 'thread.started', thread_id: currentThread }),
    JSON.stringify({
      type: 'item.completed',
      item: {
        id: 'copy-generated-image',
        type: 'command_execution',
        command: `/bin/cp ${artifactPath} candidate.png`,
        status: 'completed',
        exit_code: 0
      }
    })
  ].join('\n');
  assert.equal(auditCodexWorkerJsonl(Buffer.from(`${valid}\n`)).imagegenInvocationCount, 1);
  const quotedLiteralCopy = [
    JSON.stringify({ type: 'thread.started', thread_id: currentThread }),
    JSON.stringify({
      type: 'item.completed',
      item: {
        id: 'quoted-copy-generated-image',
        type: 'command_execution',
        command: `/bin/bash -lc '/bin/cp "${artifactPath}" "candidate.png"'`,
        status: 'completed',
        exit_code: 0
      }
    })
  ].join('\n');
  assert.equal(
    auditCodexWorkerJsonl(
      Buffer.from(`${quotedLiteralCopy}\n`)
    ).imagegenInvocationCount,
    1,
    'safe quoted source and literal destination remain auditable'
  );
  for (const unsafeDestination of [
    '"$TARGET"',
    '"candidate.png; /bin/true"',
    '"candidate.png $(printf bad)"',
    '"../candidate.png"',
    '"candidate.png" extra'
  ]) {
    const unsafeCopy = [
      JSON.stringify({ type: 'thread.started', thread_id: currentThread }),
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'unsafe-destination-copy',
          type: 'command_execution',
          command:
            `/bin/bash -lc '/bin/cp "${artifactPath}" ${unsafeDestination}'`,
          status: 'completed',
          exit_code: 0
        }
      })
    ].join('\n');
    assert.equal(
      auditCodexWorkerJsonl(
        Buffer.from(`${unsafeCopy}\n`)
      ).imagegenInvocationCount,
      0,
      `must reject unsafe artifact copy destination: ${unsafeDestination}`
    );
  }
  const legacyBashC = [
    JSON.stringify({ type: 'thread.started', thread_id: currentThread }),
    JSON.stringify({
      type: 'item.completed',
      item: {
        id: 'copy-generated-image-through-bash-c',
        type: 'command_execution',
        command: `/bin/bash -c 'cp ${artifactPath} candidate.png'`,
        status: 'completed',
        exit_code: 0
      }
    })
  ].join('\n');
  assert.equal(
    auditCodexWorkerJsonl(Buffer.from(`${legacyBashC}\n`)).imagegenInvocationCount,
    1,
    'legacy structured bash -c artifact copies remain auditable'
  );
  assert.equal(
    auditCodexWorkerJsonl(artifactWorkerJsonl(
      currentThread,
      `/home/test/.codex/generated_images/${currentThread}/call_Abc123.png`
    )).imagegenInvocationCount,
    1,
    'legacy call_ artifacts remain supported'
  );

  const agentMessageSpoof = [
    JSON.stringify({ type: 'thread.started', thread_id: currentThread }),
    JSON.stringify({
      type: 'item.completed',
      item: {
        id: 'message-1',
        type: 'agent_message',
        text: `saved ${artifactPath}`
      }
    })
  ].join('\n');
  assert.equal(
    auditCodexWorkerJsonl(Buffer.from(`${agentMessageSpoof}\n`)).imagegenInvocationCount,
    0
  );

  const crossThread = [
    JSON.stringify({ type: 'thread.started', thread_id: currentThread }),
    JSON.stringify({
      type: 'item.completed',
      item: {
        id: 'wrong-thread-copy',
        type: 'command_execution',
        command: '/bin/cp /home/test/.codex/generated_images/other-thread/'
          + 'exec-98e50c0c-760c-42c3-8f18-e34ac3228802.png candidate.png',
        status: 'completed',
        exit_code: 0
      }
    })
  ].join('\n');
  assert.throws(
    () => auditCodexWorkerJsonl(Buffer.from(`${crossThread}\n`)),
    /different JSONL thread/
  );

  const failedCopy = [
    JSON.stringify({ type: 'thread.started', thread_id: currentThread }),
    JSON.stringify({
      type: 'item.completed',
      item: {
        id: 'failed-copy',
        type: 'command_execution',
        command: `/bin/cp ${artifactPath} candidate.png`,
        status: 'failed',
        exit_code: 1
      }
    })
  ].join('\n');
  assert.equal(
    auditCodexWorkerJsonl(Buffer.from(`${failedCopy}\n`)).imagegenInvocationCount,
    0
  );

  const multipleThreads = [
    JSON.stringify({ type: 'thread.started', thread_id: currentThread }),
    JSON.stringify({ type: 'thread.started', thread_id: 'other-thread' }),
    valid.split('\n')[1]
  ].join('\n');
  assert.throws(
    () => auditCodexWorkerJsonl(Buffer.from(`${multipleThreads}\n`)),
    /exactly one thread\.started/
  );
  assert.throws(
    () => auditCodexWorkerJsonl(Buffer.from(
      `${JSON.stringify({ type: 'thread.started', thread_id: currentThread })}\n`
        + `${valid}\n`
    )),
    /exactly one thread\.started/
  );
  assert.throws(
    () => auditCodexWorkerJsonl(Buffer.from(
      `${JSON.stringify({ type: 'thread.started', thread_id: '' })}\n`
        + `${valid.split('\n')[1]}\n`
    )),
    /thread ID must be a safe path component/
  );

  const dotSegmentThread = [
    JSON.stringify({ type: 'thread.started', thread_id: '..' }),
    JSON.stringify({
      type: 'item.completed',
      item: {
        id: 'escaped-copy',
        type: 'command_execution',
        command: '/bin/cp /home/test/.codex/generated_images/../call_Escape.png '
          + 'candidate.png',
        status: 'completed',
        exit_code: 0
      }
    })
  ].join('\n');
  assert.throws(
    () => auditCodexWorkerJsonl(Buffer.from(`${dotSegmentThread}\n`)),
    /thread ID must be a safe path component/
  );

  const explicitCall = JSON.stringify({
    type: 'item.completed',
    item: {
      id: 'image-call-1',
      type: 'mcp_tool_call',
      server: 'image_gen',
      tool: 'imagegen'
    }
  });
  assert.throws(
    () => auditCodexWorkerJsonl(Buffer.from(`${valid}\n${explicitCall}\n`)),
    /ambiguous mixed explicit-tool-call and generated-artifact evidence/
  );
  const failedExplicitCall = JSON.stringify({
    type: 'item.completed',
    item: {
      id: 'failed-image-call',
      type: 'mcp_tool_call',
      server: 'image_gen',
      tool: 'imagegen',
      status: 'failed'
    }
  });
  assert.throws(
    () => auditCodexWorkerJsonl(
      Buffer.from(`${valid}\n${failedExplicitCall}\n`)
    ),
    /ambiguous mixed explicit-tool-call and generated-artifact evidence/
  );
  assert.throws(
    () => auditCodexWorkerJsonl(Buffer.from(`${valid}\n${valid.split('\n')[1]}\n`)),
    /duplicate artifact evidence/
  );
  assert.equal(
    auditCodexWorkerJsonl(
      Buffer.from(`${valid}\n${valid.split('\n')[1]}\n`),
      { allowExactDuplicateArtifactEvidence: true }
    ).imagegenInvocationCount,
    1,
    'exact duplicate copy evidence is available only to explicit legacy callers'
  );
  const legacyArtifact =
    `/home/test/.codex/generated_images/${currentThread}/call_Abc123.png`;
  const legacyCopy = JSON.stringify({
    type: 'item.completed',
    item: {
      id: 'copy-legacy-generated-image',
      type: 'command_execution',
      command: `/bin/cp ${legacyArtifact} candidate.png`,
      status: 'completed',
      exit_code: 0
    }
  });
  const differentExtension = legacyCopy.replace(
    'call_Abc123.png',
    'call_Abc123.webp'
  );
  assert.throws(
    () => auditCodexWorkerJsonl(
      Buffer.from(
        `${JSON.stringify({ type: 'thread.started', thread_id: currentThread })}\n`
          + `${legacyCopy}\n${differentExtension}\n`
      ),
      { allowExactDuplicateArtifactEvidence: true }
    ),
    /duplicate artifact evidence/
  );
  assert.throws(
    () => auditCodexWorkerJsonl(
      Buffer.from(`${valid}\n`),
      { allowExactDuplicateArtifactEvidence: 'legacy' }
    ),
    /duplicate-artifact policy must be boolean/
  );
});

test('legacy chroma-key postprocessing is opt-in generated-artifact evidence', async t => {
  const root = await temporaryDirectory(t);
  const codexHome = path.join(root, '.codex');
  const currentThread = 'legacy-postprocess-thread';
  const artifactName = 'call_LegacyChromaSource.png';
  const threadRoot = path.join(codexHome, 'generated_images', currentThread);
  const artifactPath = path.join(threadRoot, artifactName);
  const helperPath = path.join(
    codexHome,
    'skills/.system/imagegen/scripts/remove_chroma_key.py'
  );
  await mkdir(threadRoot, { recursive: true });
  await writeFile(artifactPath, Buffer.from('generated raster evidence'));

  function commandEvent(command, {
    id = 'remove-chroma-key',
    status = 'completed',
    exitCode = 0
  } = {}) {
    return JSON.stringify({
      type: 'item.completed',
      item: {
        id,
        type: 'command_execution',
        command,
        status,
        exit_code: exitCode
      }
    });
  }

  function workerJsonl(...commands) {
    return Buffer.from([
      JSON.stringify({ type: 'thread.started', thread_id: currentThread }),
      ...commands
    ].join('\n') + '\n');
  }

  const command =
    `/bin/bash -lc 'python3 ${helperPath} --input "${artifactPath}" `
      + "--out candidate.png --auto-key border --soft-matte --despill'";
  const event = commandEvent(command);
  const defaultAudit = auditCodexWorkerJsonl(workerJsonl(event));
  assert.equal(defaultAudit.imagegenInvocationCount, 0);
  assert.equal(defaultAudit.imagegenEvidence, 'none');

  const audit = auditCodexWorkerJsonl(workerJsonl(event), {
    allowPostprocessedArtifactEvidence: true
  });
  assert.equal(audit.imagegenInvocationCount, 1);
  assert.equal(audit.imagegenEvidence, 'generated-artifact');
  assert.deepEqual(audit.imagegenArtifacts, [{
    path: artifactPath,
    threadId: currentThread,
    callId: 'call_LegacyChromaSource'
  }]);
  const verification = await verifyCodexImagegenEvidence(audit, {
    environmentSource: { CODEX_HOME: codexHome }
  });
  assert.equal(verification.evidence, 'generated-artifact');
  assert.equal(verification.artifacts.length, 1);
  assert.equal(verification.artifacts[0].path, artifactPath);

  const duplicateAudit = auditCodexWorkerJsonl(workerJsonl(
    event,
    commandEvent(command, { id: 'remove-chroma-key-again' })
  ), {
    allowPostprocessedArtifactEvidence: true
  });
  assert.equal(duplicateAudit.imagegenInvocationCount, 1);
  assert.deepEqual(duplicateAudit.imagegenArtifacts, audit.imagegenArtifacts);

  const copyEvent = commandEvent(`/bin/cp ${artifactPath} candidate.png`, {
    id: 'copy-generated-image'
  });
  for (const mixedOrder of [
    [event, copyEvent],
    [copyEvent, event]
  ]) {
    assert.throws(
      () => auditCodexWorkerJsonl(workerJsonl(...mixedOrder), {
        allowPostprocessedArtifactEvidence: true
      }),
      /duplicate artifact evidence/
    );
  }

  const suffixSpoofHelper = path.join(
    root,
    'spoof-codex-home/skills/.system/imagegen/scripts/remove_chroma_key.py'
  );
  for (const rejectedCommand of [
    `/usr/bin/convert ${artifactPath} candidate.png`,
    `python3 /tmp/remove_chroma_key.py --input ${artifactPath} --out candidate.png`,
    `python3 ${suffixSpoofHelper} --input ${artifactPath} --out candidate.png`,
    `/tmp/python3 ${helperPath} --input ${artifactPath} --out candidate.png`,
    `python3 ${helperPath} --input relative.png --out candidate.png`,
    `python3 ${helperPath} --input ${artifactPath} --input ${artifactPath} `
      + '--out candidate.png',
    `python3 ${helperPath} --input ${artifactPath} --out candidate.png; /bin/true`,
    `/bin/sh -c "python3 ${helperPath} --input $(printf bad) --out candidate.png"`
  ]) {
    assert.equal(
      auditCodexWorkerJsonl(
        workerJsonl(commandEvent(rejectedCommand)),
        { allowPostprocessedArtifactEvidence: true }
      ).imagegenInvocationCount,
      0,
      `must reject non-canonical or unsafe command: ${rejectedCommand}`
    );
  }

  assert.equal(
    auditCodexWorkerJsonl(workerJsonl(commandEvent(command, {
      status: 'failed',
      exitCode: 1
    })), {
      allowPostprocessedArtifactEvidence: true
    }).imagegenInvocationCount,
    0
  );

  const otherThreadArtifact = path.join(
    codexHome,
    'generated_images/other-thread',
    artifactName
  );
  assert.throws(
    () => auditCodexWorkerJsonl(workerJsonl(commandEvent(
      `python3 ${helperPath} --input ${otherThreadArtifact} --out candidate.png`
    )), {
      allowPostprocessedArtifactEvidence: true
    }),
    /different JSONL thread/
  );

  const secondArtifact = path.join(
    codexHome,
    'generated_images',
    currentThread,
    'call_SecondSource.png'
  );
  assert.throws(
    () => auditCodexWorkerJsonl(workerJsonl(
      event,
      commandEvent(
        `python3 ${helperPath} --input ${secondArtifact} --out second.png`,
        { id: 'remove-second-chroma-key' }
      )
    ), {
      allowPostprocessedArtifactEvidence: true
    }),
    /requires exactly one distinct artifact/
  );

  const conflictingSameCall = path.join(
    codexHome,
    'generated_images',
    currentThread,
    'call_LegacyChromaSource.webp'
  );
  assert.throws(
    () => auditCodexWorkerJsonl(workerJsonl(
      event,
      commandEvent(
        `python3 ${helperPath} --input ${conflictingSameCall} --out conflict.png`,
        { id: 'remove-conflicting-chroma-key' }
      )
    ), {
      allowPostprocessedArtifactEvidence: true
    }),
    /duplicate artifact evidence/
  );

  const explicitCall = JSON.stringify({
    type: 'item.completed',
    item: {
      id: 'explicit-imagegen',
      type: 'mcp_tool_call',
      server: 'image_gen',
      tool: 'imagegen'
    }
  });
  assert.throws(
    () => auditCodexWorkerJsonl(workerJsonl(event, explicitCall), {
      allowPostprocessedArtifactEvidence: true
    }),
    /ambiguous mixed explicit-tool-call and generated-artifact evidence/
  );
  assert.throws(
    () => auditCodexWorkerJsonl(workerJsonl(event), {
      allowPostprocessedArtifactEvidence: 'legacy'
    }),
    /postprocessed-artifact policy must be boolean/
  );
});

test('artifact fallback requires one existing byte-identical current-thread raster', async t => {
  async function setupArtifact(root, threadId, name, color) {
    const codexHome = path.join(root, '.codex');
    const threadRoot = path.join(codexHome, 'generated_images', threadId);
    await mkdir(threadRoot, { recursive: true });
    const artifactPath = path.join(threadRoot, name);
    await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 3,
        background: color
      }
    }).png().toFile(artifactPath);
    return { codexHome, threadRoot, artifactPath };
  }

  await t.test('can securely return the sole generated artifact bytes', async t => {
    const root = await temporaryDirectory(t);
    const threadId = 'thread-return-artifact-bytes';
    const artifact = await setupArtifact(
      root,
      threadId,
      'call_ReturnArtifactBytes.png',
      { r: 35, g: 75, b: 115 }
    );
    const expected = await readFile(artifact.artifactPath);
    const audit = auditCodexWorkerJsonl(
      artifactWorkerJsonl(threadId, artifact.artifactPath)
    );
    const verification = await verifyCodexImagegenEvidence(audit, {
      environmentSource: { CODEX_HOME: artifact.codexHome },
      returnGeneratedArtifactBytes: true
    });
    assert.equal(verification.candidateBytes, null);
    assert.deepEqual(verification.generatedArtifactBytes, expected);
  });

  for (const [label, artifactName] of [
    ['legacy', 'call_One.png'],
    ['current', 'exec-2f23f121-8633-4142-b38b-c5fce4c44af3.png']
  ]) {
    await t.test(`accepts exactly one matching ${label} generated artifact`, async t => {
      const root = await createFixture(t);
      const threadId = `thread-one-${label}`;
      const { codexHome, artifactPath } = await setupArtifact(
        root,
        threadId,
        artifactName,
        { r: 30, g: 90, b: 45 }
      );
      const worker = async context => {
        await writeFile(
          path.join(context.workspace, 'candidate.png'),
          await readFile(artifactPath)
        );
        return {
          stdout: artifactWorkerJsonl(threadId, artifactPath),
          stderr: Buffer.alloc(0),
          args: [
            'exec',
            '--ephemeral',
            '--enable',
            'image_generation',
            '--sandbox',
            'workspace-write'
          ]
        };
      };
      const result = await generateTemplateImages(options(root), {
        worker,
        environmentSource: { CODEX_HOME: codexHome }
      });
      assert.equal(result.results[0].status, 'generated');
    });
  }

  await t.test('accepts a quoted generated-artifact path containing spaces', async t => {
    const root = await createFixture(t);
    const threadId = 'thread-quoted-path';
    const codexHome = path.join(root, 'codex home');
    const threadRoot = path.join(codexHome, 'generated_images', threadId);
    await mkdir(threadRoot, { recursive: true });
    const artifactPath = path.join(
      threadRoot,
      'exec-98e50c0c-760c-42c3-8f18-e34ac3228802.png'
    );
    await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 3,
        background: { r: 30, g: 90, b: 45 }
      }
    }).png().toFile(artifactPath);
    const worker = async context => {
      await writeFile(
        path.join(context.workspace, 'candidate.png'),
        await readFile(artifactPath)
      );
      return {
        stdout: Buffer.from([
          JSON.stringify({ type: 'thread.started', thread_id: threadId }),
          JSON.stringify({
            type: 'item.completed',
            item: {
              id: 'copy-generated-image',
              type: 'command_execution',
              command: `/bin/bash -lc 'cp "${artifactPath}" candidate.png'`,
              status: 'completed',
              exit_code: 0
            }
          })
        ].join('\n') + '\n'),
        stderr: Buffer.alloc(0),
        args: [
          'exec',
          '--ephemeral',
          '--enable',
          'image_generation',
          '--sandbox',
          'workspace-write'
        ]
      };
    };
    const result = await generateTemplateImages(options(root), {
      worker,
      environmentSource: { CODEX_HOME: codexHome }
    });
    assert.equal(result.results[0].status, 'generated');
  });

  await t.test('rejects a successful no-op reference to a nonexistent artifact', async t => {
    const root = await createFixture(t);
    const threadId = 'thread-missing';
    const codexHome = path.join(root, '.codex');
    const threadRoot = path.join(codexHome, 'generated_images', threadId);
    await mkdir(threadRoot, { recursive: true });
    const missing = path.join(threadRoot, 'call_Missing.png');
    const baseWorker = imageWorker([]);
    await assert.rejects(
      generateTemplateImages(options(root), {
        worker: async context => ({
          ...await baseWorker(context),
          stdout: artifactWorkerJsonl(threadId, missing)
        }),
        environmentSource: { CODEX_HOME: codexHome }
      }),
      /exactly the referenced imagegen artifact set/
    );
  });

  await t.test('rejects a successful no-op reference to an existing artifact', async t => {
    const root = await createFixture(t);
    const threadId = 'thread-existing-no-op';
    const artifact = await setupArtifact(
      root,
      threadId,
      'exec-98e50c0c-760c-42c3-8f18-e34ac3228802.png',
      { r: 30, g: 90, b: 45 }
    );
    const baseWorker = imageWorker([]);
    const noOpJsonl = Buffer.from([
      JSON.stringify({ type: 'thread.started', thread_id: threadId }),
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'no-op-reference',
          type: 'command_execution',
          command: `/bin/true ${artifact.artifactPath}`,
          status: 'completed',
          exit_code: 0
        }
      })
    ].join('\n') + '\n');
    await assert.rejects(
      generateTemplateImages(options(root), {
        worker: async context => ({
          ...await baseWorker(context),
          stdout: noOpJsonl
        }),
        environmentSource: { CODEX_HOME: artifact.codexHome }
      }),
      /worker must call imagegen exactly once; observed 0/
    );
  });

  await t.test('rejects an unmentioned second generated artifact', async t => {
    const root = await createFixture(t);
    const threadId = 'thread-two-artifacts';
    const first = await setupArtifact(
      root,
      threadId,
      'call_First.png',
      { r: 30, g: 90, b: 45 }
    );
    await setupArtifact(
      root,
      threadId,
      'exec-98e50c0c-760c-42c3-8f18-e34ac3228802.png',
      { r: 35, g: 95, b: 50 }
    );
    const baseWorker = imageWorker([]);
    await assert.rejects(
      generateTemplateImages(options(root), {
        worker: async context => ({
          ...await baseWorker(context),
          stdout: artifactWorkerJsonl(threadId, first.artifactPath)
        }),
        environmentSource: { CODEX_HOME: first.codexHome }
      }),
      /found 2, referenced 1/
    );
  });

  await t.test('rejects a same-thread generated artifact symlink', async t => {
    const root = await createFixture(t);
    const threadId = 'thread-symlink';
    const codexHome = path.join(root, '.codex');
    const threadRoot = path.join(codexHome, 'generated_images', threadId);
    await mkdir(threadRoot, { recursive: true });
    const outsideArtifact = path.join(root, 'outside.png');
    await writeFile(outsideArtifact, Buffer.from('not trusted'));
    const artifactPath = path.join(
      threadRoot,
      'exec-98e50c0c-760c-42c3-8f18-e34ac3228802.png'
    );
    await symlink(outsideArtifact, artifactPath);
    const baseWorker = imageWorker([]);
    await assert.rejects(
      generateTemplateImages(options(root), {
        worker: async context => ({
          ...await baseWorker(context),
          stdout: artifactWorkerJsonl(threadId, artifactPath)
        }),
        environmentSource: { CODEX_HOME: codexHome }
      }),
      /thread artifact must be a regular non-symlink file/
    );
  });

  await t.test('rejects a generated-images thread-directory symlink', async t => {
    const root = await createFixture(t);
    const threadId = 'thread-directory-symlink';
    const codexHome = path.join(root, '.codex');
    const generatedImagesRoot = path.join(codexHome, 'generated_images');
    const outsideThreadRoot = path.join(root, 'outside-thread');
    await Promise.all([
      mkdir(generatedImagesRoot, { recursive: true }),
      mkdir(outsideThreadRoot, { recursive: true })
    ]);
    const artifactName = 'exec-98e50c0c-760c-42c3-8f18-e34ac3228802.png';
    const outsideArtifact = path.join(outsideThreadRoot, artifactName);
    await writeFile(outsideArtifact, Buffer.from('not trusted'));
    await symlink(outsideThreadRoot, path.join(generatedImagesRoot, threadId));
    const artifactPath = path.join(generatedImagesRoot, threadId, artifactName);
    const baseWorker = imageWorker([]);
    await assert.rejects(
      generateTemplateImages(options(root), {
        worker: async context => ({
          ...await baseWorker(context),
          stdout: artifactWorkerJsonl(threadId, artifactPath)
        }),
        environmentSource: { CODEX_HOME: codexHome }
      }),
      /thread root must be a real directory/
    );
  });

  await t.test('rejects artifact pathname replacement before secure read', async t => {
    const root = await temporaryDirectory(t);
    const threadId = 'thread-artifact-race';
    const artifact = await setupArtifact(
      root,
      threadId,
      'call_RacedArtifact.png',
      { r: 20, g: 60, b: 100 }
    );
    const candidatePath = path.join(root, 'candidate.png');
    await writeFile(candidatePath, await readFile(artifact.artifactPath));
    const audit = auditCodexWorkerJsonl(
      artifactWorkerJsonl(threadId, artifact.artifactPath)
    );
    let replaced = false;
    let artifactOpenFlags = null;
    await assert.rejects(
      verifyCodexImagegenEvidence(audit, {
        environmentSource: { CODEX_HOME: artifact.codexHome },
        candidatePath,
        requireCandidateByteIdentity: true,
        filesystemSource: {
          open: async (target, flags) => {
            if (target === artifact.artifactPath && !replaced) {
              artifactOpenFlags = flags;
              replaced = true;
              const originalPath = `${artifact.artifactPath}.original`;
              await rename(artifact.artifactPath, originalPath);
              await writeFile(
                artifact.artifactPath,
                await readFile(originalPath)
              );
            }
            return openFile(target, flags);
          }
        }
      }),
      /artifact changed before secure read/
    );
    assert.equal(replaced, true);
    assert.equal(
      artifactOpenFlags & fsConstants.O_NOFOLLOW,
      fsConstants.O_NOFOLLOW
    );
  });

  await t.test('rejects candidate pathname replacement before secure read', async t => {
    const root = await temporaryDirectory(t);
    const threadId = 'thread-candidate-race';
    const artifact = await setupArtifact(
      root,
      threadId,
      'call_CandidateRace.png',
      { r: 25, g: 65, b: 105 }
    );
    const candidatePath = path.join(root, 'candidate.png');
    await writeFile(candidatePath, await readFile(artifact.artifactPath));
    const audit = auditCodexWorkerJsonl(
      artifactWorkerJsonl(threadId, artifact.artifactPath)
    );
    let replaced = false;
    let candidateOpenFlags = null;
    await assert.rejects(
      verifyCodexImagegenEvidence(audit, {
        environmentSource: { CODEX_HOME: artifact.codexHome },
        candidatePath,
        requireCandidateByteIdentity: true,
        filesystemSource: {
          open: async (target, flags) => {
            if (target === candidatePath) {
              candidateOpenFlags = flags;
              if (!replaced) {
                replaced = true;
                const originalPath = `${candidatePath}.original`;
                await rename(candidatePath, originalPath);
                await writeFile(candidatePath, await readFile(originalPath));
              }
            }
            return openFile(target, flags);
          }
        }
      }),
      /Codex worker candidate changed before secure read/
    );
    assert.equal(replaced, true);
    assert.equal(
      candidateOpenFlags & fsConstants.O_NOFOLLOW,
      fsConstants.O_NOFOLLOW
    );
  });

  await t.test('rejects thread pathname replacement during secure read', async t => {
    const root = await temporaryDirectory(t);
    const threadId = 'thread-directory-race';
    const artifact = await setupArtifact(
      root,
      threadId,
      'call_ThreadRace.png',
      { r: 40, g: 80, b: 120 }
    );
    const candidatePath = path.join(root, 'candidate.png');
    await writeFile(candidatePath, await readFile(artifact.artifactPath));
    const audit = auditCodexWorkerJsonl(
      artifactWorkerJsonl(threadId, artifact.artifactPath)
    );
    let replaced = false;
    await assert.rejects(
      verifyCodexImagegenEvidence(audit, {
        environmentSource: { CODEX_HOME: artifact.codexHome },
        candidatePath,
        requireCandidateByteIdentity: true,
        filesystemSource: {
          open: async (target, flags) => {
            if (target === artifact.artifactPath && !replaced) {
              replaced = true;
              const originalThreadRoot = `${artifact.threadRoot}.original`;
              await rename(artifact.threadRoot, originalThreadRoot);
              await mkdir(artifact.threadRoot);
              await link(
                path.join(originalThreadRoot, path.basename(artifact.artifactPath)),
                artifact.artifactPath
              );
            }
            return openFile(target, flags);
          }
        }
      }),
      /(?:artifact changed before secure read|thread path changed during verification)/
    );
    assert.equal(replaced, true);
  });

  await t.test('rejects candidate bytes that do not match the generated artifact', async t => {
    const root = await createFixture(t);
    const threadId = 'thread-mismatch';
    const artifact = await setupArtifact(
      root,
      threadId,
      'call_Artifact.png',
      { r: 200, g: 40, b: 30 }
    );
    const baseWorker = imageWorker([]);
    await assert.rejects(
      generateTemplateImages(options(root), {
        worker: async context => ({
          ...await baseWorker(context),
          stdout: artifactWorkerJsonl(threadId, artifact.artifactPath)
        }),
        environmentSource: { CODEX_HOME: artifact.codexHome }
      }),
      /byte-identical to the one generated artifact/
    );
  });
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

test('resume rejects candidate provenance without explicit image-generation enablement', async t => {
  const root = await createFixture(t);
  await generateTemplateImages(options(root), { worker: imageWorker([]) });
  const metadataPath = path.join(
    root,
    'ai-image-metadata/battle-maps/candidates/forest/forest-template-01'
      + '/candidate-01/result.json'
  );
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  metadata.worker.args = metadata.worker.args.filter(
    argument => !['--enable', 'image_generation'].includes(argument)
  );
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  await assert.rejects(
    generateTemplateImages(options(root, { resume: true }), {
      worker: imageWorker([])
    }),
    /candidate worker provenance is invalid/
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
