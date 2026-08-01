import assert from 'node:assert/strict';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';

import {
  parseRejectArgs,
  rejectTemplateImageCandidate
} from './reject-template-image-candidate.mjs';
import {
  draftTemplate,
  inspectImage,
  loadTemplatePrompt
} from './source-template-lifecycle.mjs';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');
const MANIFEST = 'ai-image-metadata/battle-maps/manifest.json';
const PROMPT_PROFILE =
  'ai-image-metadata/battle-maps/prompts/source-template-image-v1.json';
const THEME = 'forest';
const TEMPLATE = 'forest-template-01';
const CANDIDATE = 'candidate-01';
const CANDIDATE_DIRECTORY =
  `ai-image-metadata/battle-maps/candidates/${THEME}/${TEMPLATE}/${CANDIDATE}`;

async function exists(filePath) {
  return access(filePath).then(() => true, () => false);
}

async function createFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modia-source-rejection-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const relativePath of [MANIFEST, PROMPT_PROFILE]) {
    const destination = path.join(root, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, await readFile(path.join(PROJECT_ROOT, relativePath)));
  }
  await draftTemplate({ projectRoot: root, theme: THEME, template: TEMPLATE });
  const prompt = await loadTemplatePrompt({
    projectRoot: root,
    theme: THEME,
    template: TEMPLATE
  });
  const directory = path.join(root, CANDIDATE_DIRECTORY);
  await mkdir(directory, { recursive: true });
  const imagePath = path.join(directory, 'candidate.png');
  await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 3,
      background: { r: 24, g: 80, b: 42 }
    }
  }).png().toFile(imagePath);
  const image = await inspectImage(imagePath);
  const paths = {
    image: `${CANDIDATE_DIRECTORY}/candidate.png`,
    prompt: `${CANDIDATE_DIRECTORY}/prompt.txt`,
    stdout: `${CANDIDATE_DIRECTORY}/worker.jsonl`,
    stderr: `${CANDIDATE_DIRECTORY}/worker.stderr.log`,
    lastMessage: `${CANDIDATE_DIRECTORY}/last-message.txt`,
    result: `${CANDIDATE_DIRECTORY}/result.json`
  };
  await Promise.all([
    writeFile(path.join(root, paths.prompt), 'exact reviewed generation prompt\n'),
    writeFile(
      path.join(root, paths.stdout),
      '{"type":"item.completed","item":{"id":"image-call-1",'
        + '"type":"mcp_tool_call","server":"image_gen","tool":"imagegen"}}\n'
    ),
    writeFile(path.join(root, paths.stderr), ''),
    writeFile(path.join(root, paths.lastMessage), 'candidate generated\n')
  ]);
  const result = {
    schemaVersion: 'battle-map-source-image-candidate-v1',
    id: CANDIDATE,
    theme: THEME,
    template: TEMPLATE,
    status: 'candidate-awaiting-review',
    promptProfile: prompt.reference,
    image: { path: paths.image, ...image },
    worker: {
      command: 'codex',
      args: [
        'exec',
        '--ephemeral',
        '--enable',
        'image_generation',
        '--json',
        '--color',
        'never',
        '--sandbox',
        'workspace-write',
        '-C',
        path.join(
          root,
          `ai-image-metadata/battle-maps/candidates/${THEME}/${TEMPLATE}`,
          `.workspace-${CANDIDATE}-testAb`
        ),
        '-c',
        'model_reasoning_effort="low"',
        '-o',
        path.join(
          root,
          `ai-image-metadata/battle-maps/candidates/${THEME}/${TEMPLATE}`,
          `.workspace-${CANDIDATE}-testAb`,
          'last-message.txt'
        ),
        '-'
      ],
      timeoutMs: 300000,
      promptPath: paths.prompt,
      stdoutPath: paths.stdout,
      stderrPath: paths.stderr,
      lastMessagePath: paths.lastMessage
    },
    approval: null
  };
  await writeFile(path.join(root, paths.result), `${JSON.stringify(result, null, 2)}\n`);
  return { root, paths };
}

function options(root, overrides = {}) {
  return {
    projectRoot: root,
    theme: THEME,
    template: TEMPLATE,
    candidate: CANDIDATE,
    reviewer: 'content-reviewer',
    decision: 'rejected',
    reason: 'The lower formation clearing runs out of frame and does not preserve a forest-owned boundary.',
    ...overrides
  };
}

test('CLI requires a closed rejected decision, safe identities, and exact rationale', () => {
  const parsed = parseRejectArgs([
    '--theme', THEME,
    '--template', TEMPLATE,
    '--candidate', CANDIDATE,
    '--reviewer', 'content-reviewer',
    '--decision=rejected',
    '--reason', 'Insufficient boundary ownership.',
    '--json'
  ]);
  assert.equal(parsed.decision, 'rejected');
  assert.equal(parsed.reason, 'Insufficient boundary ownership.');
  assert.equal(parsed.json, true);
  assert.throws(
    () => parseRejectArgs([
      '--theme', '../forest',
      '--template', TEMPLATE,
      '--candidate', CANDIDATE,
      '--reviewer', 'reviewer',
      '--decision', 'rejected',
      '--reason', 'Unsafe identity.'
    ]),
    /--theme has invalid value/
  );
  assert.throws(
    () => parseRejectArgs([
      '--theme', THEME,
      '--template', TEMPLATE,
      '--candidate', CANDIDATE,
      '--reviewer', 'reviewer',
      '--decision', 'approved',
      '--reason', 'Wrong transition.'
    ]),
    /explicitly supplied as "rejected"/
  );
  assert.throws(
    () => parseRejectArgs([
      '--theme', THEME,
      '--template', TEMPLATE,
      '--candidate', CANDIDATE,
      '--reviewer', 'reviewer',
      '--decision', 'rejected',
      '--reason', ' padded '
    ]),
    /must be trimmed/
  );
});

test('rejection is tracked, complete, immutable, idempotent, and non-promoting', async t => {
  const { root, paths } = await createFixture(t);
  const sidecarPath =
    path.join(root, `ai-image-metadata/battle-maps/templates/${THEME}/${TEMPLATE}.json`);
  const sidecarBefore = await readFile(sidecarPath);
  const candidateBefore = await readFile(path.join(root, paths.result));
  const first = await rejectTemplateImageCandidate(options(root));
  assert.equal(first.changed, true);
  assert.equal(first.promoted, false);
  assert.equal(first.activated, false);
  assert.equal(
    first.path,
    `battle-maps/source-image-rejections/${THEME}/${TEMPLATE}/${CANDIDATE}.json`
  );
  assert.equal(first.record.decision, 'rejected');
  assert.equal(first.record.evidence.imagegenInvocationCount, 1);
  assert.match(first.record.evidence.result.sha256, /^sha256:[0-9a-f]{64}$/);
  assert.match(first.record.evidence.prompt.sha256, /^sha256:[0-9a-f]{64}$/);
  assert.match(first.record.evidence.workerLogs.stdout.sha256, /^sha256:[0-9a-f]{64}$/);
  assert.match(first.record.evidence.workerLogs.stderr.sha256, /^sha256:[0-9a-f]{64}$/);
  const second = await rejectTemplateImageCandidate(options(root));
  assert.equal(second.changed, false);
  assert.deepEqual(second.record, first.record);
  assert.deepEqual(await readFile(sidecarPath), sidecarBefore);
  assert.deepEqual(await readFile(path.join(root, paths.result)), candidateBefore);
  assert.equal(
    await exists(path.join(root, 'ai-image-metadata/battle-maps/templates/forest/source.png')),
    false
  );
});

test('existing record rejects candidate, prompt, log, or rationale drift', async t => {
  const { root, paths } = await createFixture(t);
  await rejectTemplateImageCandidate(options(root));

  const resultBefore = await readFile(path.join(root, paths.result));
  await writeFile(
    path.join(root, paths.result),
    Buffer.concat([resultBefore, Buffer.from('\n')])
  );
  await assert.rejects(
    rejectTemplateImageCandidate(options(root)),
    /immutable rejection record already exists with different evidence/
  );
  await writeFile(path.join(root, paths.result), resultBefore);

  await writeFile(path.join(root, paths.prompt), 'mutated reviewed generation prompt\n');
  await assert.rejects(
    rejectTemplateImageCandidate(options(root)),
    /immutable rejection record already exists with different evidence/
  );
  await writeFile(path.join(root, paths.prompt), 'exact reviewed generation prompt\n');

  const stdoutBefore = await readFile(path.join(root, paths.stdout));
  await writeFile(
    path.join(root, paths.stdout),
    Buffer.concat([
      stdoutBefore,
      Buffer.from(
        '{"type":"item.completed","item":{"id":"message-2","type":"agent_message"}}\n'
      )
    ])
  );
  await assert.rejects(
    rejectTemplateImageCandidate(options(root)),
    /immutable rejection record already exists with different evidence/
  );
  await writeFile(path.join(root, paths.stdout), stdoutBefore);
  await assert.rejects(
    rejectTemplateImageCandidate(options(root, { reason: 'A different rationale.' })),
    /immutable rejection record already exists with different evidence or review/
  );
});

test('image drift, generation bypass, and symlinked evidence fail closed', async t => {
  const imageFixture = await createFixture(t);
  await writeFile(
    path.join(imageFixture.root, imageFixture.paths.image),
    Buffer.from('not an image')
  );
  await assert.rejects(
    rejectTemplateImageCandidate(options(imageFixture.root)),
    /invalid image|pin/
  );

  const bypassFixture = await createFixture(t);
  await writeFile(
    path.join(bypassFixture.root, bypassFixture.paths.stdout),
    '{"type":"item.completed","item":{"id":"message-1","type":"agent_message"}}\n'
  );
  await assert.rejects(
    rejectTemplateImageCandidate(options(bypassFixture.root)),
    /must prove exactly one imagegen invocation/
  );

  const argsFixture = await createFixture(t);
  const argsResultPath = path.join(argsFixture.root, argsFixture.paths.result);
  const argsResult = JSON.parse(await readFile(argsResultPath, 'utf8'));
  assert.deepEqual(argsResult.worker.args.slice(2, 4), [
    '--enable',
    'image_generation'
  ]);
  argsResult.worker.args.splice(2, 2, 'image_generation', '--enable');
  await writeFile(argsResultPath, `${JSON.stringify(argsResult, null, 2)}\n`);
  await assert.rejects(
    rejectTemplateImageCandidate(options(argsFixture.root)),
    /closed generation invocation/
  );

  const symlinkFixture = await createFixture(t);
  const promptPath = path.join(symlinkFixture.root, symlinkFixture.paths.prompt);
  await unlink(promptPath);
  await symlink('/etc/hosts', promptPath);
  await assert.rejects(
    rejectTemplateImageCandidate(options(symlinkFixture.root)),
    /symbolic-link/
  );
  assert.equal(
    await exists(path.join(
      symlinkFixture.root,
      `battle-maps/source-image-rejections/${THEME}/${TEMPLATE}/${CANDIDATE}.json`
    )),
    false
  );

  const outputFixture = await createFixture(t);
  const outputPath = path.join(
    outputFixture.root,
    `battle-maps/source-image-rejections/${THEME}/${TEMPLATE}/${CANDIDATE}.json`
  );
  await mkdir(path.dirname(outputPath), { recursive: true });
  await symlink('/etc/hosts', outputPath);
  await assert.rejects(
    rejectTemplateImageCandidate(options(outputFixture.root)),
    /symbolic-link/
  );
});
