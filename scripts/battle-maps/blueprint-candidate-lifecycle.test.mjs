import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import sharp from 'sharp';

import {
  approveBlueprintCandidate,
  BLUEPRINT_PROMPT_PATH,
  buildBlueprintCodexArgs,
  buildCodexWorkerEnvironment,
  buildBlueprintPrompt,
  createBlueprintContractExample,
  DEFAULT_BLUEPRINT_COMPLETION_GRACE_MS,
  generateBlueprintCandidates,
  MAX_BLUEPRINT_BYTES,
  parseBlueprintActionArgs,
  parseBlueprintGenerateArgs,
  previewBlueprintCandidates,
  runBlueprintCommand,
  verifyApprovedBlueprints
} from './blueprint-candidate-lifecycle.mjs';
import {
  approveTemplate,
  draftTemplate,
  loadTemplateSidecar,
  pinTemplateCompiler,
  stageTemplate
} from './source-template-lifecycle.mjs';
import {
  COMPILER_SOURCE_FILES,
  computeCurrentCompilerSourceSet
} from './content-release-lifecycle.mjs';
import {
  validateTemplateMapBlueprint
} from '../../shared/battleMap/v3/index.js';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');
const MANIFEST = 'ai-image-metadata/battle-maps/manifest.json';
const SOURCE_PROMPT =
  'ai-image-metadata/battle-maps/prompts/source-template-image-v1.json';
const THEME = 'forest';
const TEMPLATE = 'forest-template-01';
const MAP_IDS = [
  'forest-template-01-a',
  'forest-template-01-b',
  'forest-template-01-c'
];

async function temporaryDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'modia-blueprint-candidate-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function copyFixture(root, relativePath) {
  const destination = path.join(root, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, await readFile(path.join(PROJECT_ROOT, relativePath)));
}

async function createFixture(t) {
  const root = await temporaryDirectory(t);
  await Promise.all([
    copyFixture(root, MANIFEST),
    copyFixture(root, SOURCE_PROMPT),
    copyFixture(root, BLUEPRINT_PROMPT_PATH),
    ...COMPILER_SOURCE_FILES.map(relativePath => copyFixture(root, relativePath))
  ]);
  const manifestPath = path.join(root, MANIFEST);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.templates[0].tierEligibility = ['tier-1'];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await draftTemplate({ projectRoot: root, theme: THEME, template: TEMPLATE });
  const incoming = path.join(root, 'incoming/reference.png');
  await mkdir(path.dirname(incoming), { recursive: true });
  await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 4,
      background: { r: 27, g: 89, b: 42, alpha: 1 }
    }
  }).png().toFile(incoming);
  await stageTemplate({
    projectRoot: root,
    theme: THEME,
    template: TEMPLATE,
    source: 'incoming/reference.png'
  });
  const compiler = await computeCurrentCompilerSourceSet({ projectRoot: root });
  await pinTemplateCompiler({
    projectRoot: root,
    theme: THEME,
    template: TEMPLATE,
    compilerFullHash: compiler.fullHash
  });
  await approveTemplate({
    projectRoot: root,
    theme: THEME,
    template: TEMPLATE,
    reviewer: 'test-reviewer',
    decision: 'approved'
  });
  return root;
}

function generateOptions(root, overrides = {}) {
  return {
    projectRoot: root,
    theme: THEME,
    template: TEMPLATE,
    mapIds: [MAP_IDS[0]],
    maps: null,
    concurrency: 1,
    timeoutMs: 10_000,
    dryRun: false,
    force: false,
    resume: false,
    ...overrides
  };
}

function candidateRoot(root, mapId = MAP_IDS[0]) {
  return path.join(
    root,
    `ai-image-metadata/battle-maps/candidates/${THEME}/${TEMPLATE}/blueprints/${mapId}`
  );
}

function approvedRoot(root) {
  return path.join(root, `ai-image-metadata/battle-maps/blueprints/${THEME}/${TEMPLATE}`);
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function sha256Bytes(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function snapshotTree(root, relative = '') {
  const result = {};
  const absolute = path.join(root, relative);
  if (!await exists(absolute)) return result;
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(result, await snapshotTree(root, child));
    else result[child] = (await readFile(path.join(root, child))).toString('base64');
  }
  return result;
}

function validWorker(mutator = value => value) {
  return async ({ workspace, mapId }) => {
    const sidecar = JSON.parse(
      await readFile(path.join(workspace, 'inputs/sidecar.json'), 'utf8')
    );
    const authored = createBlueprintContractExample(sidecar, mapId);
    authored.decorations[0].cell.x += 1;
    authored.spawn.playerSlots[0].cell.x += 1;
    const blueprint = mutator(authored);
    await writeFile(
      path.join(workspace, 'candidate.json'),
      `${JSON.stringify(blueprint)}\n`
    );
    await writeFile(path.join(workspace, 'last-message.txt'), 'candidate written\n');
    return {
      stdout: Buffer.from('{"type":"fake-worker"}\n'),
      stderr: Buffer.alloc(0),
      args: ['fake-worker']
    };
  };
}

async function createCommandWorkspace(root, sidecar, name) {
  const workspace = path.join(root, `command-${name}`);
  await mkdir(path.join(workspace, 'inputs'), { recursive: true });
  await writeFile(
    path.join(workspace, 'inputs/sidecar.json'),
    `${JSON.stringify(sidecar)}\n`
  );
  await writeFile(
    path.join(workspace, 'inputs/contract.json'),
    `${JSON.stringify({
      completeShapeExample: createBlueprintContractExample(sidecar, MAP_IDS[0])
    })}\n`
  );
  return workspace;
}

function hangingNodeCommand(workspace, sidecar, source, {
  timeoutMs = 500,
  completionGraceMs = 40,
  completionPollMs = 10
} = {}) {
  return runBlueprintCommand({
    command: process.execPath,
    args: ['-e', source],
    cwd: workspace,
    input: '',
    timeoutMs,
    candidateContext: { mapId: MAP_IDS[0], sidecar },
    completionGraceMs,
    completionPollMs
  });
}

test('candidate CLI parsing is closed, bounded, and rejects repeated switches', () => {
  const parsed = parseBlueprintGenerateArgs([
    '--theme', THEME,
    '--template', TEMPLATE,
    '--map', MAP_IDS[0],
    '--map', MAP_IDS[1],
    '--concurrency', '4',
    '--timeout', '12',
    '--resume'
  ]);
  assert.deepEqual(parsed.mapIds, MAP_IDS.slice(0, 2));
  assert.equal(parsed.concurrency, 4);
  assert.equal(parsed.timeoutMs, 12_000);
  assert.equal(parsed.resume, true);

  assert.throws(
    () => parseBlueprintGenerateArgs([
      '--theme', THEME, '--template', TEMPLATE, '--dry-run', '--dry-run'
    ]),
    /only be supplied once/
  );
  assert.throws(
    () => parseBlueprintGenerateArgs([
      '--theme', THEME, '--template', TEMPLATE, '--maps', '4'
    ]),
    /1 through 3/
  );
  assert.throws(
    () => parseBlueprintGenerateArgs([
      '--theme', THEME, '--template', TEMPLATE, '--map', MAP_IDS[0], '--maps', '1'
    ]),
    /mutually exclusive/
  );

  assert.throws(
    () => parseBlueprintActionArgs([
      '--theme', THEME, '--template', TEMPLATE, '--map', MAP_IDS[0], '--force'
    ]),
    /Unknown argument/
  );
  const approval = parseBlueprintActionArgs([
    '--theme', THEME,
    '--template', TEMPLATE,
    '--map', MAP_IDS[0],
    '--reviewer', 'reviewer-1',
    '--decision', 'approved',
    '--update-pins',
    '--force'
  ], {
    requireReviewer: true,
    allowDecision: true,
    allowForce: true,
    allowUpdatePins: true
  });
  assert.equal(approval.updatePins, true);
  assert.equal(approval.force, true);
  assert.throws(
    () => parseBlueprintActionArgs([
      '--theme', THEME, '--template', TEMPLATE, '--all', '--all'
    ], { allowAll: true }),
    /only be supplied once/
  );
});

test('Codex worker arguments enforce an ephemeral workspace-write sandbox', () => {
  const args = buildBlueprintCodexArgs('/tmp/disposable', 'inputs/reference.png');
  assert.deepEqual(args.slice(0, 2), ['exec', '--ephemeral']);
  assert.equal(args[args.indexOf('--sandbox') + 1], 'workspace-write');
  assert.equal(args[args.indexOf('-C') + 1], '/tmp/disposable');
  assert.equal(args[args.indexOf('-c') + 1], 'model_reasoning_effort="medium"');
  assert.ok(args.includes('--image'));
  assert.equal(args.at(-1), '-');

  const fallback = buildBlueprintCodexArgs(
    '/tmp/disposable',
    'inputs/reference.png',
    { textTemplateFallback: true }
  );
  assert.equal(fallback.includes('--image'), false);
  assert.equal(
    parseBlueprintGenerateArgs([
      '--theme', THEME,
      '--template', TEMPLATE,
      '--text-template-fallback'
    ]).textTemplateFallback,
    true
  );
});

test('Codex blueprint workers receive only the minimal runtime environment', async () => {
  const source = {
    PATH: '/usr/bin',
    HOME: '/home/reviewer',
    CODEX_HOME: '/home/reviewer/.codex',
    TEMP: '/tmp/reviewer',
    LC_ALL: 'en_CA.UTF-8',
    SSL_CERT_FILE: '/etc/ssl/cert.pem',
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
    TEMP: '/tmp/reviewer',
    LC_ALL: 'en_CA.UTF-8',
    SSL_CERT_FILE: '/etc/ssl/cert.pem'
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
  await runBlueprintCommand({
    args: ['exec'],
    cwd: '/tmp/blueprint-worker',
    input: 'author',
    timeoutMs: 1_000,
    spawnImpl,
    environmentSource: source
  });
  assert.deepEqual(spawnOptions.env, buildCodexWorkerEnvironment(source));
});

test('contract example starts from organic contours and professional forest density', async () => {
  const sidecar = JSON.parse(await readFile(path.join(
    PROJECT_ROOT,
    'ai-image-metadata/battle-maps/templates/forest/forest-template-01.json'
  ), 'utf8'));
  const example = createBlueprintContractExample(sidecar, MAP_IDS[1]);
  assert.equal(validateTemplateMapBlueprint(example).valid, true);

  const horizontalTransitionCounts = [];
  for (let y = 0; y < example.dimensions.height - 1; y += 1) {
    let transitions = 0;
    for (let x = 0; x < example.dimensions.width; x += 1) {
      if (
        example.playableMask[y][x]
        && example.playableMask[y + 1][x]
        && example.elevation[y][x] !== example.elevation[y + 1][x]
      ) transitions += 1;
    }
    horizontalTransitionCounts.push(transitions);
  }
  assert.ok(
    Math.max(...horizontalTransitionCounts) < 20,
    'no elevation contour may become a near-full-width separator'
  );
  assert.ok(example.obstacles.length >= 8);
  assert.ok(example.decorations.length >= 18);
  assert.deepEqual(
    example.expectedAssetFamilies
      .filter(record => record.category === 'decoration')
      .map(record => record.symbol)
      .sort(),
    ['accent', 'fallen-branch', 'low-shrub']
  );
  assert.ok(example.connections.some(record => record.kind === 'stairs'));
  assert.ok(example.connections.some(record => record.kind === 'slope'));
});

test('blueprint prompt states the complete grid and compiler-topology invariants', async t => {
  const root = await createFixture(t);
  const { sidecar } = await loadTemplateSidecar({
    projectRoot: root,
    theme: THEME,
    template: TEMPLATE
  });
  const profile = JSON.parse(
    await readFile(path.join(root, BLUEPRINT_PROMPT_PATH), 'utf8')
  );
  const prompt = buildBlueprintPrompt({
    profile,
    sidecar,
    mapId: MAP_IDS[2],
    textTemplateFallback: true
  });

  assert.match(prompt, /Every position in surfaceGrid and elevation must exactly follow renderMask/);
  assert.match(prompt, /when renderMask is true/);
  assert.match(prompt, /Do not call imagegen or any other image\s+generation tool/);
  assert.match(prompt, /when\nrenderMask is false, both values must be null/);
  assert.match(prompt, /Never use null for a rendered\ncell, non-null values for a void cell/);
  assert.match(prompt, /undefined, sparse rows, or shortened\nrows/);
  assert.match(prompt, /required route must use unique playable cells/);
  assert.match(prompt, /Never use diagonal jumps, repeated route cells/);
  assert.match(prompt, /Every obstacle cell must be inside\nplayableMask/);
  assert.match(
    prompt,
    /obstacle:landmark renderer has exactly a one-tile collision footprint/
  );
  assert.match(
    prompt,
    /separate uniquely identified\none-cell obstacle records/
  );
  assert.match(prompt, /Every tags array must contain unique values/);
  assert.match(prompt, /tactical annotation only when its cell is included/);
  assert.match(prompt, /opponent zone named by zoneId/);
});

test('worker completion monitor accepts only a stable, strictly valid fixed candidate', async t => {
  const root = await createFixture(t);
  const { sidecar } = await loadTemplateSidecar({
    projectRoot: root,
    theme: THEME,
    template: TEMPLATE
  });
  assert.equal(DEFAULT_BLUEPRINT_COMPLETION_GRACE_MS, 2_000);

  await t.test('stable valid candidate intentionally terminates a hanging worker', async () => {
    const workspace = await createCommandWorkspace(root, sidecar, 'stable-valid');
    const result = await hangingNodeCommand(
      workspace,
      sidecar,
      `const fs=require('node:fs');
const value=JSON.parse(fs.readFileSync('inputs/contract.json','utf8')).completeShapeExample;
value.decorations[0].cell.x += 1;
value.spawn.playerSlots[0].cell.x += 1;
fs.writeFileSync('candidate.json',JSON.stringify(value));
process.stdout.write('valid candidate written\\n');
process.stderr.write('diagnostic stderr\\n');
setInterval(()=>{},1000);`
    );
    assert.equal(result.completionReason, 'validated-candidate');
    assert.equal(result.intentionallyTerminated, true);
    assert.match(result.completedCandidateSha256, /^sha256:[0-9a-f]{64}$/);
    assert.match(result.stdout.toString(), /valid candidate written/);
    assert.match(result.stderr.toString(), /diagnostic stderr/);
  });

  await t.test('partial and changing candidate is not accepted before valid stability', async () => {
    const workspace = await createCommandWorkspace(root, sidecar, 'changing');
    const startedAt = Date.now();
    const result = await hangingNodeCommand(
      workspace,
      sidecar,
      `const fs=require('node:fs');
fs.writeFileSync('candidate.json','{');
setTimeout(()=>{
  const value=JSON.parse(fs.readFileSync('inputs/contract.json','utf8')).completeShapeExample;
  value.decorations[0].cell.x += 1;
  value.spawn.playerSlots[0].cell.x += 1;
  fs.writeFileSync('candidate.json',JSON.stringify(value));
},90);
setInterval(()=>{},1000);`,
      { timeoutMs: 600, completionGraceMs: 40, completionPollMs: 10 }
    );
    assert.equal(result.completionReason, 'validated-candidate');
    assert.ok(
      Date.now() - startedAt >= 110,
      'monitor must wait for the replacement document to become stable'
    );
  });

  await t.test(
    'same-size replacement with restored mtime is revalidated before completion',
    async () => {
      const workspace = await createCommandWorkspace(
        root,
        sidecar,
        'same-size-restored-mtime'
      );
      const startedAt = Date.now();
      const result = await hangingNodeCommand(
        workspace,
        sidecar,
        `const fs=require('node:fs');
const value=JSON.parse(fs.readFileSync('inputs/contract.json','utf8')).completeShapeExample;
value.decorations[0].cell.x += 1;
value.spawn.playerSlots[0].cell.x += 1;
const replacement=structuredClone(value);
replacement.decorations[0].id=
  replacement.decorations[0].id.slice(0,-1)
  +(replacement.decorations[0].id.endsWith('t')?'u':'t');
const first=JSON.stringify(value);
const second=JSON.stringify(replacement);
if(Buffer.byteLength(first)!==Buffer.byteLength(second)) {
  throw new Error('race fixtures must have the same byte length');
}
const fixed=new Date('2020-01-02T03:04:05.000Z');
let revision=0;
const install=source=>{
  const temporary='candidate.json.'+(revision+=1)+'.tmp';
  fs.writeFileSync(temporary,source);
  fs.utimesSync(temporary,fixed,fixed);
  fs.renameSync(temporary,'candidate.json');
};
install(first);
let alternate=false;
const churn=setInterval(()=>{
  alternate=!alternate;
  install(alternate?second:first);
},1);
setTimeout(()=>{
  clearInterval(churn);
  install(second);
},180);
setInterval(()=>{},1000);`,
        { timeoutMs: 800, completionGraceMs: 30, completionPollMs: 5 }
      );
      const finalBytes = await readFile(path.join(workspace, 'candidate.json'));
      const finalDetails = await stat(path.join(workspace, 'candidate.json'));
      const fixedMtime = new Date('2020-01-02T03:04:05.000Z').getTime();
      assert.equal(finalDetails.mtimeMs, fixedMtime);
      assert.ok(
        Date.now() - startedAt >= 170,
        'monitor must not complete while same-signature replacements are still racing'
      );
      assert.equal(result.completionReason, 'validated-candidate');
      assert.equal(result.completedCandidateSha256, sha256Bytes(finalBytes));
    }
  );

  await t.test(
    'candidate replacement during controlled termination fails closed',
    async () => {
      const workspace = await createCommandWorkspace(
        root,
        sidecar,
        'changed-during-termination'
      );
      await assert.rejects(
        hangingNodeCommand(
          workspace,
          sidecar,
          `const fs=require('node:fs');
const value=JSON.parse(fs.readFileSync('inputs/contract.json','utf8')).completeShapeExample;
value.decorations[0].cell.x += 1;
value.spawn.playerSlots[0].cell.x += 1;
const replacement=structuredClone(value);
replacement.decorations[0].id=
  replacement.decorations[0].id.slice(0,-1)
  +(replacement.decorations[0].id.endsWith('t')?'u':'t');
fs.writeFileSync('candidate.json',JSON.stringify(value));
process.on('SIGTERM',()=>{
  fs.writeFileSync('candidate.json',JSON.stringify(replacement));
  process.exit(0);
});
setInterval(()=>{},1000);`,
          { timeoutMs: 600, completionGraceMs: 40, completionPollMs: 10 }
        ),
        error => {
          assert.equal(
            error.code,
            'BLUEPRINT_CANDIDATE_CHANGED_AFTER_COMPLETION'
          );
          assert.equal(error.workerResult.intentionallyTerminated, false);
          assert.equal(error.workerResult.completedCandidateSha256, null);
          return true;
        }
      );
    }
  );

  await t.test('stable invalid candidate is never treated as controlled completion', async () => {
    const workspace = await createCommandWorkspace(root, sidecar, 'invalid');
    await assert.rejects(
      hangingNodeCommand(
        workspace,
        sidecar,
        `const fs=require('node:fs');
fs.writeFileSync('candidate.json','{}');
process.stdout.write('invalid stdout\\n');
process.stderr.write('invalid stderr\\n');
setInterval(()=>{},1000);`,
        { timeoutMs: 180, completionGraceMs: 30, completionPollMs: 10 }
      ),
      error => {
        assert.equal(error.code, 'BLUEPRINT_WORKER_TIMEOUT');
        assert.equal(error.workerResult.intentionallyTerminated, false);
        assert.match(error.workerResult.stdout.toString(), /invalid stdout/);
        assert.match(error.workerResult.stderr.toString(), /invalid stderr/);
        return true;
      }
    );
  });

  await t.test(
    'compiler-invalid tactical annotation membership is never accepted as complete',
    async () => {
      const workspace = await createCommandWorkspace(
        root,
        sidecar,
        'invalid-annotation-membership'
      );
      await assert.rejects(
        hangingNodeCommand(
          workspace,
          sidecar,
          `const fs=require('node:fs');
const value=JSON.parse(fs.readFileSync('inputs/contract.json','utf8')).completeShapeExample;
value.decorations[0].cell.x += 1;
value.spawn.playerSlots[0].cell.x += 1;
value.spawn.opponentCandidates[3].tacticalAnnotationIds=[
  value.spawn.tacticalAnnotations[0].id
];
fs.writeFileSync('candidate.json',JSON.stringify(value));
setInterval(()=>{},1000);`,
          { timeoutMs: 220, completionGraceMs: 30, completionPollMs: 10 }
        ),
        error => {
          assert.equal(error.code, 'BLUEPRINT_WORKER_TIMEOUT');
          assert.equal(error.workerResult.intentionallyTerminated, false);
          assert.equal(error.workerResult.completedCandidateSha256, null);
          return true;
        }
      );
    }
  );

  await t.test('no candidate times out without a false completion', async () => {
    const workspace = await createCommandWorkspace(root, sidecar, 'no-output');
    await assert.rejects(
      hangingNodeCommand(
        workspace,
        sidecar,
        `process.stdout.write('waiting forever\\n');
setInterval(()=>{},1000);`,
        { timeoutMs: 150, completionGraceMs: 30, completionPollMs: 10 }
      ),
      error => {
        assert.equal(error.code, 'BLUEPRINT_WORKER_TIMEOUT');
        assert.equal(error.workerResult.completionReason, 'process-exit');
        assert.equal(error.workerResult.completedCandidateSha256, null);
        return true;
      }
    );
  });
});

test('compiler topology preflight blocks promotion while valid workers still succeed', async t => {
  await t.test('invented asset-family symbols are not promoted', async t => {
    const root = await createFixture(t);
    await assert.rejects(
      generateBlueprintCandidates(generateOptions(root), {
        worker: validWorker(blueprint => {
          blueprint.expectedAssetFamilies[0].symbol = 'invented-ground';
          blueprint.surfaceGrid.forEach(row => row.forEach(cell => {
            if (cell !== null) cell.material = 'invented-ground';
          }));
          return blueprint;
        })
      }),
      /expectedAssetFamilies must exactly match the fixed contract symbols/
    );
    assert.equal(await exists(candidateRoot(root)), false);
    assert.equal(await exists(approvedRoot(root)), false);
  });

  await t.test('an unusable opponent topology is not promoted', async t => {
    const root = await createFixture(t);
    await assert.rejects(
      generateBlueprintCandidates(generateOptions(root), {
        worker: validWorker(blueprint => {
          blueprint.spawn.opponentCandidates.forEach(candidate => {
            candidate.minimumClearance = 32;
          });
          return blueprint;
        })
      }),
      /usable opponent capacity 0 is below maxAssignableOpponents/
    );
    assert.equal(await exists(candidateRoot(root)), false);
    assert.equal(await exists(approvedRoot(root)), false);
  });

  await t.test(
    'a multi-cell obstacle cannot escape its fixed renderer footprint',
    async t => {
      const root = await createFixture(t);
      await assert.rejects(
        generateBlueprintCandidates(generateOptions(root), {
          worker: validWorker(blueprint => {
            const obstacle = blueprint.obstacles[0];
            obstacle.cells.push({
              x: obstacle.cells[0].x,
              y: obstacle.cells[0].y - 1
            });
            return blueprint;
          })
        }),
        /fixed one-cell landmark footprint/
      );
      assert.equal(await exists(candidateRoot(root)), false);
      assert.equal(await exists(approvedRoot(root)), false);
    }
  );

  await t.test('the same preflight accepts a valid authored worker result', async t => {
    const root = await createFixture(t);
    const result = await generateBlueprintCandidates(
      generateOptions(root),
      { worker: validWorker() }
    );
    assert.equal(result.results[0].status, 'generated-awaiting-review');
    assert.equal(await exists(path.join(candidateRoot(root), 'candidate.json')), true);
    assert.equal(await exists(approvedRoot(root)), false);
  });
});

test('timed-out worker diagnostics survive workspace cleanup without promotion', async t => {
  const root = await createFixture(t);
  const error = new Error('Codex blueprint worker timed out after 100ms');
  error.code = 'BLUEPRINT_WORKER_TIMEOUT';
  error.workerResult = {
    stdout: Buffer.from('partial jsonl\n'),
    stderr: Buffer.from('partial stderr\n'),
    args: ['fake-worker'],
    completionReason: 'process-exit',
    intentionallyTerminated: false,
    completedCandidateSha256: null
  };
  await assert.rejects(
    generateBlueprintCandidates(generateOptions(root), {
      worker: async () => {
        throw error;
      }
    }),
    /timed out/
  );
  assert.equal(
    await readFile(path.join(candidateRoot(root), 'worker.jsonl'), 'utf8'),
    'partial jsonl\n'
  );
  assert.equal(
    await readFile(path.join(candidateRoot(root), 'worker.stderr.log'), 'utf8'),
    'partial stderr\n'
  );
  assert.equal(await exists(path.join(candidateRoot(root), 'candidate.json')), false);
  assert.equal(await exists(path.join(candidateRoot(root), 'result.json')), false);
  assert.equal(
    (await readdir(candidateRoot(root))).some(name => name.startsWith('.workspace-')),
    false
  );
});

test('JSON-only blueprint generation rejects any audited imagegen invocation', async t => {
  const root = await createFixture(t);
  const worker = validWorker();
  await assert.rejects(
    generateBlueprintCandidates(generateOptions(root), {
      worker: async parameters => ({
        ...await worker(parameters),
        stdout: Buffer.from(
          '{"type":"item.completed","item":{"id":"image-call-1",'
            + '"type":"mcp_tool_call","server":"image_gen","tool":"imagegen"}}\n'
        )
      })
    }),
    /blueprint worker must not call imagegen; observed 1/
  );
  assert.equal(await exists(path.join(candidateRoot(root), 'candidate.json')), false);
  assert.equal(await exists(path.join(candidateRoot(root), 'result.json')), false);
});

test('dry-run does not invoke a worker and valid generation is candidate-only', async t => {
  const root = await createFixture(t);
  const protectedBefore = await snapshotTree(
    root,
    'ai-image-metadata/battle-maps/templates'
  );
  let calls = 0;
  const worker = async parameters => {
    calls += 1;
    return validWorker()(parameters);
  };
  const plan = await generateBlueprintCandidates(
    generateOptions(root, { dryRun: true }),
    { worker }
  );
  assert.equal(plan.dryRun, true);
  assert.equal(calls, 0);
  assert.equal(await exists(candidateRoot(root)), false);

  const result = await generateBlueprintCandidates(generateOptions(root), { worker });
  assert.equal(result.results[0].status, 'generated-awaiting-review');
  assert.equal(calls, 1);
  assert.equal(
    await exists(path.join(candidateRoot(root), 'candidate.json')),
    true
  );
  assert.equal(await exists(approvedRoot(root)), false);
  assert.equal(await exists(path.join(root, 'battle-maps/catalog')), false);
  assert.equal(await exists(path.join(root, 'battle-maps/compiled')), false);
  assert.equal(
    await exists(path.join(root, 'frontend/public/assets/battle-maps')),
    false
  );
  assert.deepEqual(
    await snapshotTree(root, 'ai-image-metadata/battle-maps/templates'),
    protectedBefore
  );
});

test('text-template fallback candidates retain a verifiable frozen prompt', async t => {
  const root = await createFixture(t);
  await generateBlueprintCandidates(
    generateOptions(root, { textTemplateFallback: true }),
    { worker: validWorker() }
  );
  const preview = await previewBlueprintCandidates({
    projectRoot: root,
    theme: THEME,
    template: TEMPLATE,
    mapId: MAP_IDS[0],
    all: false
  });
  assert.equal(preview.ok, true);
  assert.equal(preview.results[0].mapId, MAP_IDS[0]);
});

test('workspace inputs are immutable and undeclared outputs are rejected without promotion', async t => {
  await t.test('input mutation', async t => {
    const root = await createFixture(t);
    await assert.rejects(
      generateBlueprintCandidates(generateOptions(root), {
        worker: async ({ workspace }) => {
          await writeFile(path.join(workspace, 'inputs/sidecar.json'), '{}\n');
          await writeFile(path.join(workspace, 'candidate.json'), '{}\n');
          return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), args: [] };
        }
      }),
      /modified immutable input/
    );
    assert.equal(await exists(candidateRoot(root)), false);
  });

  await t.test('undeclared output', async t => {
    const root = await createFixture(t);
    await assert.rejects(
      generateBlueprintCandidates(generateOptions(root), {
        worker: async parameters => {
          const result = await validWorker()(parameters);
          await writeFile(path.join(parameters.workspace, 'surprise.txt'), 'no');
          return result;
        }
      }),
      /undeclared output/
    );
    assert.equal(await exists(candidateRoot(root)), false);
  });

  await t.test('symlink output', async t => {
    const root = await createFixture(t);
    await assert.rejects(
      generateBlueprintCandidates(generateOptions(root), {
        worker: async ({ workspace }) => {
          await symlink('inputs/sidecar.json', path.join(workspace, 'candidate.json'));
          return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), args: [] };
        }
      }),
      /forbidden symlink/
    );
    assert.equal(await exists(candidateRoot(root)), false);
  });
});

test('malformed, adversarial, oversized, and wrong-identity candidates fail closed', async t => {
  const cases = [
    {
      name: 'duplicate key',
      bytes: Buffer.from('{"schemaVersion":1,"schemaVersion":1}\n'),
      pattern: /Duplicate object key/
    },
    {
      name: 'invalid UTF-8',
      bytes: Buffer.from([0x7b, 0xff, 0x7d]),
      pattern: /not valid UTF-8/
    },
    {
      name: 'oversized',
      bytes: Buffer.alloc(MAX_BLUEPRINT_BYTES + 1, 0x20),
      pattern: /must be 2/
    }
  ];
  for (const testCase of cases) {
    await t.test(testCase.name, async t => {
      const root = await createFixture(t);
      await assert.rejects(
        generateBlueprintCandidates(generateOptions(root), {
          worker: async ({ workspace }) => {
            await writeFile(path.join(workspace, 'candidate.json'), testCase.bytes);
            return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), args: [] };
          }
        }),
        testCase.pattern
      );
      assert.equal(await exists(candidateRoot(root)), false);
    });
  }

  await t.test('closed schema and fixed identity', async t => {
    const root = await createFixture(t);
    await assert.rejects(
      generateBlueprintCandidates(generateOptions(root), {
        worker: validWorker(blueprint => ({ ...blueprint, unexpected: true }))
      }),
      /closed schema/
    );
    assert.equal(await exists(candidateRoot(root)), false);

    await assert.rejects(
      generateBlueprintCandidates(generateOptions(root), {
        worker: validWorker(blueprint => ({
          ...blueprint,
          candidateId: MAP_IDS[1]
        }))
      }),
      /identity does not match/
    );
    assert.equal(await exists(candidateRoot(root)), false);
  });

  await t.test('unmodified contract example', async t => {
    const root = await createFixture(t);
    await assert.rejects(
      generateBlueprintCandidates(generateOptions(root), {
        worker: async ({ workspace, mapId }) => {
          const sidecar = JSON.parse(
            await readFile(path.join(workspace, 'inputs/sidecar.json'), 'utf8')
          );
          await writeFile(
            path.join(workspace, 'candidate.json'),
            `${JSON.stringify(createBlueprintContractExample(sidecar, mapId))}\n`
          );
          return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), args: [] };
        }
      }),
      /must author at least two semantic geometry groups/
    );
    assert.equal(await exists(candidateRoot(root)), false);
  });
});

test('resume validates pins, replaces partial runs, and force replaces complete output', async t => {
  const root = await createFixture(t);
  let calls = 0;
  const worker = async parameters => {
    calls += 1;
    return validWorker(blueprint => ({
      ...blueprint,
      generationNotes: [...blueprint.generationNotes, `worker invocation ${calls}`]
    }))(parameters);
  };
  const first = await generateBlueprintCandidates(generateOptions(root), { worker });
  const firstHash = first.results[0].fullHash;

  const resumed = await generateBlueprintCandidates(
    generateOptions(root, { resume: true }),
    { worker }
  );
  assert.equal(resumed.results[0].status, 'skipped-complete');
  assert.equal(calls, 1);
  await assert.rejects(
    generateBlueprintCandidates(generateOptions(root), { worker }),
    /exists; use --resume/
  );

  const metadataPath = path.join(candidateRoot(root), 'result.json');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  metadata.promptProfile.sha256 = `sha256:${'0'.repeat(64)}`;
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  const regenerated = await generateBlueprintCandidates(
    generateOptions(root, { resume: true }),
    { worker }
  );
  assert.notEqual(regenerated.results[0].fullHash, firstHash);
  assert.equal(calls, 2);

  await rm(candidateRoot(root), { recursive: true, force: true });
  await mkdir(candidateRoot(root), { recursive: true });
  await writeFile(path.join(candidateRoot(root), 'partial.txt'), 'interrupted');
  await assert.rejects(
    generateBlueprintCandidates(generateOptions(root), { worker }),
    /incomplete or invalid/
  );
  await generateBlueprintCandidates(
    generateOptions(root, { resume: true }),
    { worker }
  );
  assert.equal(await exists(path.join(candidateRoot(root), 'partial.txt')), false);

  const forced = await generateBlueprintCandidates(
    generateOptions(root, { force: true }),
    { worker }
  );
  assert.equal(forced.results[0].status, 'generated-awaiting-review');
  assert.equal(calls, 4);
});

test('same-candidate generation is serialized across force and failure cleanup', async t => {
  const root = await createFixture(t);
  let releaseFailingWorker;
  let markFailingWorkerStarted;
  let markReplacementWorkerStarted;
  const failingWorkerStarted = new Promise(resolve => {
    markFailingWorkerStarted = resolve;
  });
  const replacementWorkerStarted = new Promise(resolve => {
    markReplacementWorkerStarted = resolve;
  });
  const allowFailingWorkerToFinish = new Promise(resolve => {
    releaseFailingWorker = resolve;
  });

  const failingGeneration = generateBlueprintCandidates(
    generateOptions(root),
    {
      worker: async () => {
        markFailingWorkerStarted();
        await allowFailingWorkerToFinish;
        throw new Error('intentional first-worker failure');
      }
    }
  );
  await failingWorkerStarted;

  const replacementGeneration = generateBlueprintCandidates(
    generateOptions(root, { force: true }),
    {
      worker: async parameters => {
        markReplacementWorkerStarted();
        return validWorker()(parameters);
      }
    }
  );

  const prematureReplacement = await Promise.race([
    replacementWorkerStarted.then(() => true),
    new Promise(resolve => setTimeout(() => resolve(false), 250))
  ]);
  assert.equal(
    prematureReplacement,
    false,
    'the force run must wait for the current candidate owner'
  );

  releaseFailingWorker();
  await assert.rejects(failingGeneration, /intentional first-worker failure/);
  const replacement = await replacementGeneration;
  assert.equal(replacement.results[0].status, 'generated-awaiting-review');
  assert.equal(
    await exists(path.join(candidateRoot(root), 'candidate.json')),
    true
  );
  assert.equal(
    await exists(path.join(candidateRoot(root), 'result.json')),
    true
  );
  const lockDirectory = path.join(path.dirname(candidateRoot(root)), '.locks');
  assert.deepEqual(await readdir(lockDirectory), [`${MAP_IDS[0]}.lock`]);
});

test('candidate generation locks reject symlinks and ignore stale token contents', async t => {
  const root = await createFixture(t);
  const lockDirectory = path.join(path.dirname(candidateRoot(root)), '.locks');
  const lockPath = path.join(lockDirectory, `${MAP_IDS[0]}.lock`);
  await mkdir(lockDirectory, { recursive: true });
  const sentinel = path.join(root, 'lock-sentinel.txt');
  await writeFile(sentinel, 'do not modify\n');
  await symlink(sentinel, lockPath);
  await assert.rejects(
    generateBlueprintCandidates(generateOptions(root), {
      worker: validWorker()
    }),
    /symbolic-link|non-symlink/
  );
  assert.equal(await readFile(sentinel, 'utf8'), 'do not modify\n');

  await rm(lockPath);
  const staleBytes = 'stale token contents from a crashed legacy owner\n';
  await writeFile(lockPath, staleBytes);
  const generated = await generateBlueprintCandidates(
    generateOptions(root, { force: true }),
    { worker: validWorker() }
  );
  assert.equal(generated.results[0].status, 'generated-awaiting-review');
  assert.equal(await readFile(lockPath, 'utf8'), staleBytes);
  assert.equal(
    await exists(path.join(candidateRoot(root), 'candidate.json')),
    true
  );
});

test('an exited lock holder fails closed and releases its inherited descriptor', async t => {
  const root = await createFixture(t);
  await assert.rejects(
    generateBlueprintCandidates(
      generateOptions(root),
      {
        worker: validWorker(),
        candidateLockHolderSource: [
          'process.stdout.write("locked\\n");',
          'setImmediate(() => process.exit(0));'
        ].join('')
      }
    ),
    error => {
      assert.equal(error.code, 'BLUEPRINT_CANDIDATE_LOCK_FAILED');
      return true;
    }
  );

  const recovered = await generateBlueprintCandidates(
    generateOptions(root, { force: true }),
    { worker: validWorker() }
  );
  assert.equal(recovered.results[0].status, 'generated-awaiting-review');
});

test('a worker cannot silently change tracked approval or runtime content', async t => {
  const root = await createFixture(t);
  const protectedPath = path.join(
    root,
    'ai-image-metadata/battle-maps/blueprints/sentinel.txt'
  );
  await mkdir(path.dirname(protectedPath), { recursive: true });
  await writeFile(protectedPath, 'approved content\n');
  await assert.rejects(
    generateBlueprintCandidates(generateOptions(root), {
      worker: async parameters => {
        const result = await validWorker()(parameters);
        await writeFile(protectedPath, 'mutated\n');
        return result;
      }
    }),
    /changed protected content/
  );
  assert.equal(await exists(candidateRoot(root)), false);
});

test('approval is explicit, hash-pinned, and complete release verification is closed', async t => {
  const root = await createFixture(t);
  await generateBlueprintCandidates(
    generateOptions(root, { mapIds: MAP_IDS, concurrency: 2 }),
    { worker: validWorker() }
  );
  assert.equal(await exists(approvedRoot(root)), false);

  const baseApproval = {
    projectRoot: root,
    theme: THEME,
    template: TEMPLATE,
    reviewer: 'reviewer-1',
    decision: 'approved',
    force: false,
    updatePins: false
  };
  await assert.rejects(
    approveBlueprintCandidate({
      ...baseApproval,
      mapId: MAP_IDS[0],
      updatePins: true
    }),
    /requires approved entries for every/
  );
  assert.equal(await exists(approvedRoot(root)), false);

  const rejection = await approveBlueprintCandidate({
    ...baseApproval,
    mapId: MAP_IDS[0],
    decision: 'rejected'
  });
  assert.equal(rejection.promoted, false);
  assert.equal(await exists(approvedRoot(root)), false);

  await approveBlueprintCandidate({ ...baseApproval, mapId: MAP_IDS[0] });
  await approveBlueprintCandidate({ ...baseApproval, mapId: MAP_IDS[1] });
  const incomplete = await verifyApprovedBlueprints({
    projectRoot: root,
    theme: THEME,
    template: TEMPLATE
  });
  assert.equal(incomplete.ok, false);
  let releaseSidecarUpdate;
  let signalSidecarUpdate;
  const sidecarUpdateBlocked = new Promise(resolve => {
    signalSidecarUpdate = resolve;
  });
  const sidecarUpdateRelease = new Promise(resolve => {
    releaseSidecarUpdate = resolve;
  });
  const finalBlueprintApproval = approveBlueprintCandidate({
    ...baseApproval,
    mapId: MAP_IDS[2],
    updatePins: true,
    beforeSidecarUpdate: async () => {
      signalSidecarUpdate();
      await sidecarUpdateRelease;
    }
  });
  await sidecarUpdateBlocked;
  let sourceApprovalSettled = false;
  const concurrentSourceApproval = approveTemplate({
    projectRoot: root,
    theme: THEME,
    template: TEMPLATE,
    reviewer: 'reviewer-2',
    decision: 'approved',
    force: true
  }).finally(() => {
    sourceApprovalSettled = true;
  });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(
    sourceApprovalSettled,
    false,
    'every supported sidecar writer must wait on the template lifecycle lock'
  );
  releaseSidecarUpdate();
  await finalBlueprintApproval;
  await concurrentSourceApproval;
  const verified = await verifyApprovedBlueprints({
    projectRoot: root,
    theme: THEME,
    template: TEMPLATE
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.aggregatePinValid, true);
  const { sidecar } = await loadTemplateSidecar({
    projectRoot: root,
    theme: THEME,
    template: TEMPLATE
  });
  assert.equal(
    sidecar.pins.approvedBlueprintSha256,
    verified.approvalIndexFullHash
  );
  assert.equal(sidecar.review.reviewer, 'reviewer-2');

  const approvalPath = path.join(
    approvedRoot(root),
    `${MAP_IDS[0]}.approval.json`
  );
  const approval = JSON.parse(await readFile(approvalPath, 'utf8'));
  approval.reviewer = 'spoofed-reviewer';
  await writeFile(approvalPath, `${JSON.stringify(approval, null, 2)}\n`);
  const tampered = await verifyApprovedBlueprints({
    projectRoot: root,
    theme: THEME,
    template: TEMPLATE
  });
  assert.equal(tampered.ok, false);
  assert.match(tampered.results[0].error, /exact reviewed inputs/);
});

test('force approval prunes stale prompt-era entries before rebuilding the index', async t => {
  const root = await createFixture(t);
  const generation = overrides => generateBlueprintCandidates(
    generateOptions(root, {
      mapIds: MAP_IDS,
      concurrency: 2,
      ...overrides
    }),
    { worker: validWorker() }
  );
  const approval = (mapId, overrides = {}) => approveBlueprintCandidate({
    projectRoot: root,
    theme: THEME,
    template: TEMPLATE,
    mapId,
    reviewer: 'reviewer-1',
    decision: 'approved',
    force: false,
    updatePins: false,
    ...overrides
  });

  await generation();
  await approval(MAP_IDS[0]);
  await approval(MAP_IDS[1]);
  await approval(MAP_IDS[2], { updatePins: true });

  const promptPath = path.join(root, BLUEPRINT_PROMPT_PATH);
  const prompt = JSON.parse(await readFile(promptPath, 'utf8'));
  prompt.negativeConstraints.push('new frozen prompt-era constraint');
  await writeFile(promptPath, `${JSON.stringify(prompt, null, 2)}\n`);
  await generation({ force: true });

  await assert.rejects(
    approval(MAP_IDS[0]),
    /stale source or prompt pins/
  );
  await approval(MAP_IDS[0], { force: true });
  let index = JSON.parse(
    await readFile(path.join(approvedRoot(root), 'approvals.json'), 'utf8')
  );
  assert.deepEqual(index.entries.map(entry => entry.id), [MAP_IDS[0]]);

  await approval(MAP_IDS[1], { force: true });
  await approval(MAP_IDS[2], { force: true, updatePins: true });
  index = JSON.parse(
    await readFile(path.join(approvedRoot(root), 'approvals.json'), 'utf8')
  );
  assert.deepEqual(index.entries.map(entry => entry.id), MAP_IDS);
  assert.equal(
    (await verifyApprovedBlueprints({
      projectRoot: root,
      theme: THEME,
      template: TEMPLATE
    })).ok,
    true
  );
});
