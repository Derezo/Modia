import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  truncate,
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
  BLUEPRINT_PROMPT_PATH_V2,
  BlueprintLifecycleInternals,
  buildBlueprintCodexArgs,
  buildCodexWorkerEnvironment,
  buildBlueprintPrompt,
  createBlueprintContractExample,
  DEFAULT_BLUEPRINT_COMPLETION_GRACE_MS,
  generateBlueprintCandidates,
  MAX_ATTEMPT_ERROR_BYTES,
  MAX_ATTEMPT_HISTORY_BYTES,
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
import {
  acquirePersistentExclusiveLock,
  releasePersistentExclusiveLock
} from './persistent-exclusive-lock.mjs';

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
const V2_TEMPLATE = 'forest-template-03';
const V2_MAP_IDS = [
  'forest-template-03-a',
  'forest-template-03-b',
  'forest-template-03-c'
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

async function createFixture(t, {
  template = TEMPLATE,
  mapIds = MAP_IDS
} = {}) {
  const root = await temporaryDirectory(t);
  await Promise.all([
    copyFixture(root, MANIFEST),
    copyFixture(root, SOURCE_PROMPT),
    copyFixture(root, BLUEPRINT_PROMPT_PATH),
    copyFixture(root, BLUEPRINT_PROMPT_PATH_V2),
    ...COMPILER_SOURCE_FILES.map(relativePath => copyFixture(root, relativePath))
  ]);
  const manifestPath = path.join(root, MANIFEST);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.templates[0].tierEligibility = ['tier-1'];
  manifest.templates[0].id = template;
  manifest.templates[0].sidecarPath =
    `ai-image-metadata/battle-maps/templates/${THEME}/${template}.json`;
  manifest.templates[0].candidateMaps = mapIds;
  if (template === V2_TEMPLATE) {
    manifest.templates[0].routeIntent.primaryApproaches[0] =
      'Build two interlocking loops through a shared central crossing.';
    manifest.templates[0].routeIntent.secondaryApproaches[0] =
      'Keep the figure-eight centerline connected by authored route cells.';
  }
  manifest.templates = [manifest.templates[0]];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await draftTemplate({ projectRoot: root, theme: THEME, template });
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
    template,
    source: 'incoming/reference.png'
  });
  const compiler = await computeCurrentCompilerSourceSet({ projectRoot: root });
  await pinTemplateCompiler({
    projectRoot: root,
    theme: THEME,
    template,
    compilerFullHash: compiler.fullHash
  });
  await approveTemplate({
    projectRoot: root,
    theme: THEME,
    template,
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

function candidateRoot(root, mapId = MAP_IDS[0], template = TEMPLATE) {
  return path.join(
    root,
    `ai-image-metadata/battle-maps/candidates/${THEME}/${template}/blueprints/${mapId}`
  );
}

function approvedRoot(root, template = TEMPLATE) {
  return path.join(root, `ai-image-metadata/battle-maps/blueprints/${THEME}/${template}`);
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

function pointForTest(x, y) {
  return { x, y };
}

function connectionBoundaryFixture(blueprint, {
  total,
  routeTouching
}) {
  const edgeKey = (from, to) => {
    const left = `${from.x},${from.y}`;
    const right = `${to.x},${to.y}`;
    return left < right ? `${left}~${right}` : `${right}~${left}`;
  };
  const requiredRouteCellKeys = new Set(
    blueprint.routes
      .filter(route => route.required)
      .flatMap(route => route.cells)
      .map(cell => `${cell.x},${cell.y}`)
  );
  const requiredElevationCrossings = [];
  const requiredElevationEdgeKeys = new Set();
  for (const route of blueprint.routes.filter(record => record.required)) {
    for (let index = 1; index < route.cells.length; index += 1) {
      const from = route.cells[index - 1];
      const to = route.cells[index];
      if (
        blueprint.elevation[from.y][from.x]
        === blueprint.elevation[to.y][to.x]
      ) continue;
      const key = edgeKey(from, to);
      if (requiredElevationEdgeKeys.has(key)) continue;
      requiredElevationEdgeKeys.add(key);
      requiredElevationCrossings.push({ from, to });
    }
  }
  const pools = {
    routeTouching: [],
    other: []
  };
  for (let y = 0; y < blueprint.dimensions.height; y += 1) {
    for (let x = 0; x < blueprint.dimensions.width; x += 1) {
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const from = pointForTest(x, y);
        const to = pointForTest(x + dx, y + dy);
        if (
          to.x >= blueprint.dimensions.width
          || to.y >= blueprint.dimensions.height
        ) continue;
        const touchesRoute = (
          requiredRouteCellKeys.has(`${from.x},${from.y}`)
          || requiredRouteCellKeys.has(`${to.x},${to.y}`)
        );
        if (requiredElevationEdgeKeys.has(edgeKey(from, to))) continue;
        pools[touchesRoute ? 'routeTouching' : 'other'].push({ from, to });
      }
    }
  }
  const preservedCrossings = requiredElevationCrossings.slice(
    0,
    Math.min(requiredElevationCrossings.length, routeTouching, total)
  );
  const selected = [
    ...preservedCrossings,
    ...pools.routeTouching.slice(0, routeTouching - preservedCrossings.length),
    ...pools.other.slice(0, total - routeTouching)
  ];
  assert.equal(selected.length, total);
  blueprint.connections = selected.map(({ from, to }, index) => {
    const kind = index % 2 === 0 ? 'stairs' : 'slope';
    return {
      id: `connection:boundary:${index}`,
      from,
      to,
      kind,
      traversable: true,
      bidirectional: true,
      featureId: 'feature:terraces',
      assetFamily: kind
    };
  });
  return blueprint;
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
    const originalPlayerCell = { ...authored.spawn.playerSlots[0].cell };
    authored.spawn.playerSlots[0].cell.x += 1;
    if (sidecar.id === V2_TEMPLATE) {
      const playerFormation = authored.regions.find(region =>
        region.kind === 'formation-clearing'
        && region.cells.some(cell =>
          cell.x === originalPlayerCell.x && cell.y === originalPlayerCell.y
        )
      );
      const regionCell = playerFormation.cells.find(cell =>
        cell.x === originalPlayerCell.x && cell.y === originalPlayerCell.y
      );
      regionCell.x = authored.spawn.playerSlots[0].cell.x;
      regionCell.y = authored.spawn.playerSlots[0].cell.y;
    }
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

function waitForChildClose(child, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} did not close within ${timeoutMs}ms`));
    }, timeoutMs);
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

async function waitForFile(pathname, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await readFile(pathname, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`${label} was not written within ${timeoutMs}ms`);
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForProcessExit(pid, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processIsAlive(pid)) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`${label} ${pid} remained alive after ${timeoutMs}ms`);
}

function spawnIsolatedWrapper(t, source) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore']
  });
  t.after(() => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  });
  return child;
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
  const v2Approval = parseBlueprintActionArgs([
    '--theme', THEME,
    '--template', V2_TEMPLATE,
    '--map', V2_MAP_IDS[0],
    '--reviewer', 'reviewer-1',
    '--reason', 'Topology and formation routes passed review.'
  ], {
    requireReviewer: true,
    allowReason: true,
    requireReasonForNewApproval: true
  });
  assert.equal(
    v2Approval.reason,
    'Topology and formation routes passed review.'
  );
  assert.throws(
    () => parseBlueprintActionArgs([
      '--theme', THEME,
      '--template', V2_TEMPLATE,
      '--map', V2_MAP_IDS[0],
      '--reviewer', 'reviewer-1'
    ], {
      requireReviewer: true,
      allowReason: true,
      requireReasonForNewApproval: true
    }),
    /reason is required/
  );
  assert.throws(
    () => parseBlueprintActionArgs([
      '--theme', THEME,
      '--template', TEMPLATE,
      '--map', MAP_IDS[0],
      '--reviewer', 'reviewer-1',
      '--reason', 'Must not alter legacy records.'
    ], {
      requireReviewer: true,
      allowReason: true,
      requireReasonForNewApproval: true
    }),
    /not accepted for legacy/
  );
  assert.throws(
    () => parseBlueprintActionArgs([
      '--theme', THEME,
      '--template', V2_TEMPLATE,
      '--map', V2_MAP_IDS[0],
      '--reviewer', 'reviewer-1',
      '--reason', 'line one\nline two'
    ], {
      requireReviewer: true,
      allowReason: true,
      requireReasonForNewApproval: true
    }),
    /non-control/
  );
  assert.throws(
    () => parseBlueprintActionArgs([
      '--theme', THEME,
      '--template', V2_TEMPLATE,
      '--map', V2_MAP_IDS[0],
      '--reviewer', 'reviewer-1',
      '--reason', 'x'.repeat(1001)
    ], {
      requireReviewer: true,
      allowReason: true,
      requireReasonForNewApproval: true
    }),
    /at most 1000 bytes/
  );
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

  let spawnCommand;
  let spawnArgs;
  let spawnOptions;
  const spawnImpl = (command, args, childOptions) => {
    spawnCommand = command;
    spawnArgs = args;
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
  assert.equal(spawnCommand, '/usr/bin/systemd-run');
  assert.equal(spawnOptions.env, process.env);
  const scrubIndex = spawnArgs.indexOf('-i');
  assert.notEqual(scrubIndex, -1);
  assert.deepEqual(
    spawnArgs.slice(scrubIndex + 1, scrubIndex + 7),
    [
      'PATH=/usr/bin',
      'HOME=/home/reviewer',
      'CODEX_HOME=/home/reviewer/.codex',
      'TEMP=/tmp/reviewer',
      'LC_ALL=en_CA.UTF-8',
      'SSL_CERT_FILE=/etc/ssl/cert.pem'
    ]
  );
  assert.equal(spawnArgs.some(value => value.includes('must-not-reach-worker')), false);
  assert.ok(spawnArgs.includes('--property=RuntimeMaxSec=6s'));
  assert.deepEqual(spawnArgs.slice(scrubIndex + 7), ['codex', 'exec']);
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

test('V2 semantic contract localizes formations and connects loop centerlines', async t => {
  const root = await createFixture(t, {
    template: V2_TEMPLATE,
    mapIds: V2_MAP_IDS
  });
  const { sidecar } = await loadTemplateSidecar({
    projectRoot: root,
    theme: THEME,
    template: V2_TEMPLATE
  });
  const example = createBlueprintContractExample(sidecar, V2_MAP_IDS[0]);
  assert.equal(validateTemplateMapBlueprint(example).valid, true);
  assert.doesNotThrow(() =>
    BlueprintLifecycleInternals.validateV2BlueprintSemanticContract(example, sidecar)
  );
  const semanticContractSource = await readFile(
    path.join(PROJECT_ROOT, 'scripts/battle-maps/blueprint-v2-semantic-contract.mjs'),
    'utf8'
  );
  assert.doesNotMatch(semanticContractSource, /^\s*import\s/m);
  assert.equal(example.spawn.opponentCandidates.length, 24);
  assert.equal(
    new Set(example.spawn.opponentCandidates.map(record => record.cell.y)).size,
    7
  );
  assert.deepEqual(
    [
      Math.min(...example.spawn.opponentCandidates.map(record => record.cell.x)),
      Math.max(...example.spawn.opponentCandidates.map(record => record.cell.x)),
      Math.min(...example.spawn.opponentCandidates.map(record => record.cell.y)),
      Math.max(...example.spawn.opponentCandidates.map(record => record.cell.y))
    ],
    [8, 23, 3, 18]
  );
  assert.deepEqual(example.dimensions, { width: 32, height: 32 });
  assert.equal(example.spawn.playerSlots.length, 5);
  assert.equal(example.expectedAssetFamilies.length, 13);
  const referencedFamilies = new Set([
    ...example.surfaceGrid.flat()
      .filter(Boolean)
      .map(cell => `surface:${cell.material}`),
    ...example.routes.map(route => `route:${route.assetFamily}`),
    ...example.connections.map(connection =>
      `connection:${connection.assetFamily}`
    ),
    ...example.obstacles.map(obstacle => `obstacle:${obstacle.assetFamily}`),
    ...example.decorations.map(decoration =>
      `decoration:${decoration.assetFamily}`
    ),
    ...example.boundaries.map(boundary => `boundary:${boundary.assetFamily}`)
  ]);
  assert.deepEqual(
    example.expectedAssetFamilies
      .map(record => `${record.category}:${record.symbol}`)
      .filter(key => !referencedFamilies.has(key)),
    []
  );

  for (const mapId of V2_MAP_IDS) {
    const variantExample = mapId === V2_MAP_IDS[0]
      ? example
      : createBlueprintContractExample(sidecar, mapId);
    assert.equal(validateTemplateMapBlueprint(variantExample).valid, true);
    assert.doesNotThrow(() =>
      BlueprintLifecycleInternals.validateV2BlueprintSemanticContract(
        variantExample,
        sidecar
      )
    );
    const requiredRouteCellKeys = new Set(
      variantExample.routes
        .filter(route => route.required)
        .flatMap(route => route.cells)
        .map(cell => `${cell.x},${cell.y}`)
    );
    const traversableConnections =
      variantExample.connections.filter(connection => connection.traversable);
    assert.equal(traversableConnections.length, 8);
    assert.equal(
      traversableConnections.filter(connection => (
        requiredRouteCellKeys.has(`${connection.from.x},${connection.from.y}`)
        || requiredRouteCellKeys.has(`${connection.to.x},${connection.to.y}`)
      )).length,
      8
    );
  }
  const missingExactRouteCrossing = structuredClone(example);
  const westRoute = missingExactRouteCrossing.routes.find(
    route => route.id === 'route:west'
  );
  const crossingFrom = westRoute.cells[4];
  const crossingTo = westRoute.cells[5];
  assert.notEqual(
    missingExactRouteCrossing.elevation[crossingFrom.y][crossingFrom.x],
    missingExactRouteCrossing.elevation[crossingTo.y][crossingTo.x]
  );
  const crossingConnection = missingExactRouteCrossing.connections.find(
    connection => (
      [connection.from, connection.to].some(cell =>
        cell.x === crossingFrom.x && cell.y === crossingFrom.y
      )
      && [connection.from, connection.to].some(cell =>
        cell.x === crossingTo.x && cell.y === crossingTo.y
      )
    )
  );
  assert.ok(crossingConnection);
  crossingConnection.from = { ...westRoute.cells[0] };
  crossingConnection.to = { ...westRoute.cells[1] };
  assert.equal(validateTemplateMapBlueprint(missingExactRouteCrossing).valid, true);
  assert.throws(
    () => BlueprintLifecycleInternals.validateV2BlueprintSemanticContract(
      missingExactRouteCrossing,
      sidecar
    ),
    /required route route:west index 5 crosses elevation 9,23,z0->10,23,z1 without that exact undirected edge/
  );
  const singleArticulation = structuredClone(example);
  const articulationWest = singleArticulation.routes.find(
    route => route.id === 'route:west'
  );
  const articulationEast = singleArticulation.routes.find(
    route => route.id === 'route:east'
  );
  const westSharedStart = articulationWest.cells.findIndex(
    cell => cell.x === 15 && cell.y === 17
  );
  const westSharedEnd = articulationWest.cells.findIndex(
    cell => cell.x === 15 && cell.y === 12
  );
  const eastPrefixEnd = articulationEast.cells.findIndex(
    cell => cell.x === 16 && cell.y === 17
  );
  const eastSuffixStart = articulationEast.cells.findIndex(
    cell => cell.x === 16 && cell.y === 12
  );
  articulationEast.cells = [
    ...articulationEast.cells.slice(0, eastPrefixEnd + 1),
    ...articulationWest.cells.slice(westSharedStart, westSharedEnd + 1),
    ...articulationEast.cells.slice(eastSuffixStart)
  ];
  assert.equal(validateTemplateMapBlueprint(singleArticulation).valid, true);
  assert.throws(
    () => BlueprintLifecycleInternals.validateV2BlueprintSemanticContract(
      singleArticulation,
      sidecar
    ),
    /at least 2 internally vertex-disjoint.*shared articulation cell or edge/
  );

  const mixedApproachSidecar = structuredClone(sidecar);
  mixedApproachSidecar.topologyIntent.relationships.find(
    relationship => relationship.to === 'upper-lookout'
  ).kind = 'separate natural slope route and fieldstone stair route';
  const mixedApproaches = structuredClone(example);
  mixedApproaches.regions.find(
    region => region.id === 'upper-lookout'
  ).cells = [14, 15, 16, 17, 18].map(x => pointForTest(x, 6));
  const eastOverlookPortal = mixedApproaches.connections.find(connection => (
    [connection.from, connection.to].some(cell => cell.x === 18 && cell.y === 6)
    && [connection.from, connection.to].some(cell => cell.x === 18 && cell.y === 5)
  ));
  assert.ok(eastOverlookPortal);
  eastOverlookPortal.kind = 'slope';
  eastOverlookPortal.assetFamily = 'slope';
  assert.doesNotThrow(() =>
    BlueprintLifecycleInternals.validateV2BlueprintSemanticContract(
      mixedApproaches,
      mixedApproachSidecar
    )
  );
  const stairsOnlyOverlook = structuredClone(mixedApproaches);
  const stairsOnlyPortal = stairsOnlyOverlook.connections.find(
    connection => connection.id === eastOverlookPortal.id
  );
  stairsOnlyPortal.kind = 'stairs';
  stairsOnlyPortal.assetFamily = 'stairs';
  assert.throws(
    () => BlueprintLifecycleInternals.validateV2BlueprintSemanticContract(
      stairsOnlyOverlook,
      mixedApproachSidecar
    ),
    /upper-lookout requires separate required-route approaches.*natural slope portal.*stair portal/
  );
  const variantCExample = createBlueprintContractExample(sidecar, V2_MAP_IDS[2]);
  assert.equal(variantCExample.routes.filter(route => route.required).length, 3);
  assert.ok(variantCExample.routes.some(route =>
    route.id === 'route:flank-branch'
    && route.cells.some(cell => cell.x === 12 && cell.y === 16)
  ));

  const atConnectionLimit = connectionBoundaryFixture(structuredClone(example), {
    total: 32,
    routeTouching: 32
  });
  assert.equal(validateTemplateMapBlueprint(atConnectionLimit).valid, true);
  assert.doesNotThrow(() =>
    BlueprintLifecycleInternals.validateV2BlueprintSemanticContract(
      atConnectionLimit,
      sidecar
    )
  );

  const aboveConnectionLimit = connectionBoundaryFixture(structuredClone(example), {
    total: 33,
    routeTouching: 33
  });
  assert.equal(validateTemplateMapBlueprint(aboveConnectionLimit).valid, true);
  assert.throws(
    () => BlueprintLifecycleInternals.validateV2BlueprintSemanticContract(
      aboveConnectionLimit,
      sidecar
    ),
    /33 traversable elevation connections; at most the fixed map width of 32/
  );
  const candidateWidenedLimit = structuredClone(aboveConnectionLimit);
  candidateWidenedLimit.dimensions.width = 64;
  assert.throws(
    () => BlueprintLifecycleInternals.validateV2BlueprintSemanticContract(
      candidateWidenedLimit,
      sidecar
    ),
    /33 traversable elevation connections; at most the fixed map width of 32/
  );

  for (const [total, routeTouching] of [[126, 6], [93, 33]]) {
    const reviewedCandidate =
      connectionBoundaryFixture(structuredClone(example), {
        total,
        routeTouching
      });
    assert.throws(
      () => BlueprintLifecycleInternals.validateV2BlueprintSemanticContract(
        reviewedCandidate,
        sidecar
      ),
      new RegExp(
        `${total} traversable elevation connections; `
          + 'at most the fixed map width of 32'
      )
    );
  }

  const atRouteTouchingThreshold =
    connectionBoundaryFixture(structuredClone(example), {
      total: 32,
      routeTouching: 24
    });
  assert.equal(validateTemplateMapBlueprint(atRouteTouchingThreshold).valid, true);
  assert.doesNotThrow(() =>
    BlueprintLifecycleInternals.validateV2BlueprintSemanticContract(
      atRouteTouchingThreshold,
      sidecar
    )
  );

  const belowRouteTouchingThreshold =
    connectionBoundaryFixture(structuredClone(example), {
      total: 32,
      routeTouching: 23
    });
  assert.equal(validateTemplateMapBlueprint(belowRouteTouchingThreshold).valid, true);
  assert.throws(
    () => BlueprintLifecycleInternals.validateV2BlueprintSemanticContract(
      belowRouteTouchingThreshold,
      sidecar
    ),
    /at least 75%.*23\/32 qualify/
  );

  const formationFor = (blueprint, side) => {
    const cells = side === 'player'
      ? blueprint.spawn.playerSlots.map(record => record.cell)
      : blueprint.spawn.opponentCandidates.map(record => record.cell);
    return blueprint.regions.find(region =>
      region.kind === 'formation-clearing'
      && region.cells.length === cells.length
      && region.cells.every(regionCell =>
        cells.some(cell => cell.x === regionCell.x && cell.y === regionCell.y)
      )
    );
  };
  const replaceOpponentFormation = (blueprint, cells) => {
    const formation = formationFor(blueprint, 'opponent');
    blueprint.spawn.opponentCandidates.forEach((candidate, index) => {
      candidate.cell = { ...cells[index] };
    });
    blueprint.spawn.opponentZones[0].cells = cells.map(cell => ({ ...cell }));
    formation.cells = cells.map(cell => ({ ...cell }));
  };

  const overlapping = structuredClone(example);
  const playerRegion = formationFor(overlapping, 'player');
  const oldPlayerCell = overlapping.spawn.playerSlots[0].cell;
  const exitCell = overlapping.spawn.exits[0].cell;
  overlapping.spawn.playerSlots[0].cell = { ...exitCell };
  const oldRegionCell = playerRegion.cells.find(cell =>
    cell.x === oldPlayerCell.x && cell.y === oldPlayerCell.y
  );
  oldRegionCell.x = exitCell.x;
  oldRegionCell.y = exitCell.y;
  assert.throws(
    () => BlueprintLifecycleInternals.validateV2BlueprintSemanticContract(
      overlapping,
      sidecar
    ),
    /must not overlap exits or approach regions/
  );

  const inexact = structuredClone(example);
  formationFor(inexact, 'opponent').cells.push(pointForTest(7, 7));
  assert.throws(
    () => BlueprintLifecycleInternals.validateV2BlueprintSemanticContract(
      inexact,
      sidecar
    ),
    /must each exactly equal one different/
  );

  const variantA = structuredClone(example);
  const fifteenHighCells = [4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 18]
    .flatMap(y => [pointForTest(14, y), pointForTest(15, y)]);
  replaceOpponentFormation(variantA, fifteenHighCells);
  assert.doesNotThrow(() =>
    BlueprintLifecycleInternals.validateV2BlueprintSemanticContract(variantA, sidecar)
  );

  const variantB = structuredClone(example);
  replaceOpponentFormation(
    variantB,
    Array.from({ length: 24 }, (_, index) => pointForTest(15, index + 3))
  );
  assert.throws(
    () => BlueprintLifecycleInternals.validateV2BlueprintSemanticContract(
      variantB,
      sidecar
    ),
    /opponent formation inclusive bounding box 1x24 exceeds/
  );

  const variantC = structuredClone(example);
  const cPlayerCells = [3, 9, 15, 21, 27].map(y => pointForTest(5, y));
  const cPlayerFormation = formationFor(variantC, 'player');
  variantC.spawn.playerSlots.forEach((slot, index) => {
    slot.cell = { ...cPlayerCells[index] };
  });
  cPlayerFormation.cells = cPlayerCells.map(cell => ({ ...cell }));
  assert.throws(
    () => BlueprintLifecycleInternals.validateV2BlueprintSemanticContract(
      variantC,
      sidecar
    ),
    /player formation inclusive bounding box 1x25 exceeds/
  );

  const annotationOnly = structuredClone(example);
  annotationOnly.routes[1].cells =
    Array.from({ length: 25 }, (_, index) => pointForTest(25, index + 3));
  connectionBoundaryFixture(annotationOnly, {
    total: 8,
    routeTouching: 8
  });
  annotationOnly.features
    .find(feature => feature.id === 'feature:routes')
    .annotations.push('figure-eight-connected');
  assert.throws(
    () => BlueprintLifecycleInternals.validateV2BlueprintSemanticContract(
      annotationOnly,
      sidecar
    ),
    /annotations do not establish route connectivity/
  );

  const disconnectedRegion = structuredClone(example);
  disconnectedRegion.regions
    .find(region => region.kind === 'elevated-clearing')
    .cells[2] = pointForTest(22, 7);
  assert.throws(
    () => BlueprintLifecycleInternals.validateV2BlueprintSemanticContract(
      disconnectedRegion,
      sidecar
    ),
    /tactical region upper-lookout must use one cardinally connected cell set/
  );

  const detachedRegion = structuredClone(example);
  detachedRegion.regions
    .find(region => region.kind === 'elevated-clearing')
    .cells = [pointForTest(2, 2), pointForTest(3, 2)];
  assert.throws(
    () => BlueprintLifecycleInternals.validateV2BlueprintSemanticContract(
      detachedRegion,
      sidecar
    ),
    /tactical region upper-lookout must intersect or cardinally touch a required route/
  );

  const detachedSingleCellRegion = structuredClone(example);
  detachedSingleCellRegion.regions
    .find(region => region.kind === 'elevated-clearing')
    .cells = [pointForTest(2, 2)];
  assert.throws(
    () => BlueprintLifecycleInternals.validateV2BlueprintSemanticContract(
      detachedSingleCellRegion,
      sidecar
    ),
    /tactical region upper-lookout must intersect or cardinally touch a required route/
  );

  const withParallelLadder = structuredClone(example);
  withParallelLadder.routes[0].cells =
    Array.from({ length: 14 }, (_, index) => pointForTest(15, index + 3));
  withParallelLadder.routes[1].cells =
    Array.from({ length: 14 }, (_, index) => pointForTest(16, index + 3));
  connectionBoundaryFixture(withParallelLadder, {
    total: 8,
    routeTouching: 8
  });
  const ladderRegions = withParallelLadder.regions.filter(
    region => region.kind !== 'formation-clearing'
  );
  ladderRegions[0].cells = [
    pointForTest(14, 6), pointForTest(15, 6), pointForTest(15, 7)
  ];
  ladderRegions[1].cells = [
    pointForTest(14, 12), pointForTest(15, 12), pointForTest(15, 13)
  ];
  ladderRegions[2].cells = [
    pointForTest(15, 14), pointForTest(15, 15), pointForTest(16, 15)
  ];
  assert.equal(validateTemplateMapBlueprint(withParallelLadder).valid, true);
  assert.throws(
    () => BlueprintLifecycleInternals.validateV2BlueprintSemanticContract(
      withParallelLadder,
      sidecar
    ),
    /form a 14-cell side-by-side parallel adjacency ladder/
  );

  const compactJunction = structuredClone(withParallelLadder);
  compactJunction.routes[0].cells =
    Array.from({ length: 7 }, (_, index) => pointForTest(15, index + 6));
  compactJunction.routes[1].cells =
    Array.from({ length: 7 }, (_, index) => pointForTest(16, index + 6));
  connectionBoundaryFixture(compactJunction, {
    total: 8,
    routeTouching: 8
  });
  compactJunction.regions.filter(region => region.kind !== 'formation-clearing')
    .forEach((region, index) => {
      region.cells = [
        pointForTest(14, 6 + index),
        pointForTest(15, 6 + index),
        pointForTest(16, 6 + index)
      ];
    });
  assert.equal(validateTemplateMapBlueprint(compactJunction).valid, true);
  assert.doesNotThrow(() =>
    BlueprintLifecycleInternals.validateV2BlueprintSemanticContract(
      compactJunction,
      sidecar
    )
  );

  const overlongJunction = structuredClone(compactJunction);
  overlongJunction.routes[0].cells.push(pointForTest(15, 13));
  overlongJunction.routes[1].cells.push(pointForTest(16, 13));
  assert.equal(validateTemplateMapBlueprint(overlongJunction).valid, true);
  assert.throws(
    () => BlueprintLifecycleInternals.validateV2BlueprintSemanticContract(
      overlongJunction,
      sidecar
    ),
    /form an 8-cell side-by-side parallel adjacency ladder/
  );

  const cWithoutThirdSegment = structuredClone(variantCExample);
  cWithoutThirdSegment.routes = cWithoutThirdSegment.routes.slice(0, 2);
  assert.throws(
    () => BlueprintLifecycleInternals.validateV2BlueprintSemanticContract(
      cWithoutThirdSegment,
      sidecar
    ),
    /variant C requires at least three required route segments/
  );

  const cWithDetachedThirdSegment = structuredClone(variantCExample);
  cWithDetachedThirdSegment.routes[2].cells = [
    pointForTest(23, 27), pointForTest(24, 27)
  ];
  assert.throws(
    () => BlueprintLifecycleInternals.validateV2BlueprintSemanticContract(
      cWithDetachedThirdSegment,
      sidecar
    ),
    /variant C requires an additional distinct required route segment/
  );

  await assert.rejects(
    generateBlueprintCandidates(
      generateOptions(root, {
        template: V2_TEMPLATE,
        mapIds: [V2_MAP_IDS[0]]
      }),
      {
        worker: validWorker(blueprint => {
          const region = formationFor(blueprint, 'player');
          const previous = { ...blueprint.spawn.playerSlots[0].cell };
          blueprint.spawn.playerSlots[0].cell = {
            ...blueprint.spawn.exits[0].cell
          };
          const cell = region.cells.find(value =>
            value.x === previous.x && value.y === previous.y
          );
          Object.assign(cell, blueprint.spawn.playerSlots[0].cell);
          return blueprint;
        })
      }
    ),
    /must not overlap exits or approach regions/
  );

  const legacyRoot = await createFixture(t);
  const legacy = await generateBlueprintCandidates(generateOptions(legacyRoot), {
    worker: validWorker()
  });
  assert.equal(legacy.results[0].status, 'generated-awaiting-review');
});

test('blueprint prompt states the complete grid and compiler-topology invariants', async t => {
  const root = await createFixture(t, {
    template: V2_TEMPLATE,
    mapIds: V2_MAP_IDS
  });
  const { sidecar } = await loadTemplateSidecar({
    projectRoot: root,
    theme: THEME,
    template: V2_TEMPLATE
  });
  const profile = JSON.parse(
    await readFile(path.join(root, BLUEPRINT_PROMPT_PATH_V2), 'utf8')
  );
  assert.equal(
    sha256Bytes(await readFile(path.join(root, BLUEPRINT_PROMPT_PATH))),
    'sha256:954512d0cce94919913758f5bc23a204becf9f9dd010c7c4724e013d32438795'
  );
  assert.equal(
    sha256Bytes(await readFile(path.join(root, BLUEPRINT_PROMPT_PATH_V2))),
    'sha256:d9fd841812bcc9a4713d3ac8b1c81715f359e55d55098589f8970650fed7cdae'
  );
  assert.equal(profile.schemaVersion, 'battle-map-blueprint-prompt-profile-v2');
  assert.equal(profile.id, 'map-blueprint-v2');
  const prompt = buildBlueprintPrompt({
    profile,
    sidecar,
    mapId: V2_MAP_IDS[2],
    textTemplateFallback: true
  });

  assert.match(prompt, /Every position in surfaceGrid and elevation must exactly follow renderMask/);
  assert.match(prompt, /when renderMask is true/);
  assert.match(prompt, /Do not call imagegen or any other image\s+generation tool/);
  assert.match(prompt, /Do not spawn or delegate to subagents/);
  assert.match(prompt, /complete authoring and\s+validation in this worker/);
  assert.match(prompt, /when\nrenderMask is false, both values must be null/);
  assert.match(prompt, /Never use null for a rendered\ncell, non-null values for a void cell/);
  assert.match(prompt, /undefined, sparse rows, or shortened\nrows/);
  assert.match(prompt, /required route must use unique playable cells/);
  assert.match(prompt, /Never use diagonal jumps, repeated route cells/);
  assert.match(
    prompt,
    /elevations must be equal or connections must contain that exact\s+undirected edge as a traversable bidirectional slope or stairs/
  );
  assert.match(prompt, /merely touching\s+either route cell does not connect a different edge/);
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
  assert.match(
    prompt,
    /expectedAssetFamilies byte-for-byte equivalent to\s+completeShapeExample/
  );
  assert.match(prompt, /fixed 13-symbol compiler contract/);
  assert.match(prompt, /never invent ecology-specific replacements/);
  assert.match(
    prompt,
    /Every fixed expectedAssetFamilies symbol must be actually referenced at least\s+once/
  );
  assert.match(prompt, /both connection:slope and\s+connection:stairs/);
  assert.match(prompt, /at least one traversable slope connection/);
  assert.match(prompt, /at\s+least one traversable stairs connection/);
  assert.match(
    prompt,
    /no more traversable elevation-connection records than the\s+fixed map width/
  );
  assert.match(prompt, /32 on this 32 by 32 map/);
  assert.match(
    prompt,
    /at least 75% of those traversable\s+connections must have from or to on a required route centerline/
  );
  assert.match(prompt, /small set of\s+deliberate route\/landmark\/fork crossings/);
  assert.match(prompt, /other elevation edges\s+blocked\/compiler-rendered faces/);
  assert.ok(
    prompt.includes(
      `exact IDs: ${sidecar.topologyIntent.areas.map(area => area.id).join(', ')}`
    ),
    'prompt must enumerate every approved sidecar topology area ID'
  );
  assert.match(prompt, /generic completeShapeExample region IDs are placeholders/);
  assert.match(prompt, /do not mirror or transpose the completeShapeExample/i);
  assert.match(
    prompt,
    /Change the render\/playable masks, elevation, connection geometry, and spawn geometry/
  );
  assert.match(prompt, /explicit third required flank branch/);
  assert.match(prompt, /at least three required route segments/);
  assert.match(prompt, /placed on exits or inside any approach region/);
  assert.match(prompt, /exact side's spawn cells/);
  assert.match(prompt, /bounding-box width or height exceeds half/);
  assert.match(prompt, /annotations do not create route connectivity/);

  const promptA = buildBlueprintPrompt({
    profile,
    sidecar,
    mapId: V2_MAP_IDS[0],
    textTemplateFallback: true
  });
  assert.match(promptA, /Variant A retry safeguard: use every fixed/);
  assert.match(promptA, /compact interlocking junction/);
  assert.match(promptA, /internally\s+vertex-disjoint formation-to-formation crossings/);
  assert.match(promptA, /No cell or edge may be the sole articulation crossing/);
  assert.match(promptA, /one natural-slope portal and one\s+vertex-disjoint stair portal/);
  assert.match(promptA, /different required routes/);
  const promptB = buildBlueprintPrompt({
    profile,
    sidecar,
    mapId: V2_MAP_IDS[1],
    textTemplateFallback: true
  });
  assert.match(promptB, /elevated and staging clearing region cells must each/);
  assert.match(promptB, /form a cardinally connected semantic area/);
  assert.match(promptB, /routes curved and visually distinct/);
  assert.match(promptB, /long side-by-side parallel adjacency ladder/);

  for (const candidatePrompt of [promptA, promptB, prompt]) {
    assert.match(
      candidatePrompt,
      /every non-formation tactical region must\s+intersect or cardinally touch/
    );
    assert.match(candidatePrompt, /region with multiple\s+cells must form one cardinally connected set/);
  }

  const legacyProfile = JSON.parse(
    await readFile(path.join(root, BLUEPRINT_PROMPT_PATH), 'utf8')
  );
  const legacyPrompt = buildBlueprintPrompt({
    profile: legacyProfile,
    sidecar: { ...sidecar, id: TEMPLATE },
    mapId: MAP_IDS[0],
    textTemplateFallback: true
  });
  assert.doesNotMatch(legacyPrompt, /must be actually referenced at least/);
  assert.doesNotMatch(legacyPrompt, /Shared V2 composition safeguards/);
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

test('stdin failure terminates the contained worker before settlement', async t => {
  const root = await temporaryDirectory(t);
  const readyPath = path.join(root, 'direct-worker-ready.pid');
  const workerSource = `const fs=require('node:fs');
process.on('SIGTERM',()=>{});
fs.writeFileSync(${JSON.stringify(readyPath)},String(process.pid));
setInterval(()=>{},1000);`;
  let workerChild;
  const spawnWithoutGroupTracking = (command, args, options) => {
    workerChild = spawn(command, args, options);
    return workerChild;
  };
  const pending = runBlueprintCommand({
    command: process.execPath,
    args: ['-e', workerSource],
    cwd: root,
    input: '',
    timeoutMs: 3_000,
    spawnImpl: spawnWithoutGroupTracking
  });
  assert.ok(workerChild);
  t.after(() => {
    if (workerChild.exitCode === null && workerChild.signalCode === null) {
      workerChild.kill('SIGKILL');
    }
  });
  const closed = waitForChildClose(
    workerChild,
    2_000,
    'direct-worker fallback'
  );
  const workerPid = Number(
    await waitForFile(readyPath, 1_000, 'direct-worker readiness')
  );
  assert.notEqual(workerPid, workerChild.pid);
  const stdinError = Object.assign(new Error('simulated stdin failure'), {
    code: 'EIO'
  });
  workerChild.stdin.emit('error', stdinError);
  await assert.rejects(pending, error => error === stdinError);
  await closed;
  await waitForProcessExit(workerPid, 1_000, 'direct-worker fallback');
});

test('worker cancellation is checked before launch and preserves its cause', async () => {
  const controller = new AbortController();
  const originalFailure = new Error('first concurrent candidate failed');
  controller.abort(originalFailure);
  let spawnCalls = 0;
  await assert.rejects(
    runBlueprintCommand({
      args: ['exec'],
      cwd: '/tmp/blueprint-worker-never-launched',
      input: '',
      timeoutMs: 1_000,
      signal: controller.signal,
      spawnImpl: () => {
        spawnCalls += 1;
        throw new Error('spawn must not be called');
      }
    }),
    error => {
      assert.equal(error.code, 'BLUEPRINT_WORKER_CANCELLED');
      assert.equal(error.cause, originalFailure);
      return true;
    }
  );
  assert.equal(spawnCalls, 0);
});

test('completed workers remove their batch cancellation listener', async () => {
  const listeners = new Set();
  const cancellationSignal = {
    aborted: false,
    reason: undefined,
    addEventListener(type, listener, options) {
      assert.equal(type, 'abort');
      assert.deepEqual(options, { once: true });
      listeners.add(listener);
    },
    removeEventListener(type, listener) {
      assert.equal(type, 'abort');
      listeners.delete(listener);
    }
  };
  const spawnImpl = () => {
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
    cwd: '/tmp/blueprint-worker-listener-cleanup',
    input: '',
    timeoutMs: 1_000,
    signal: cancellationSignal,
    spawnImpl
  });
  assert.equal(listeners.size, 0);
});

test('worker transport errors terminate first and reject only after close', async t => {
  for (const kind of ['child', 'stdin']) {
    await t.test(`${kind} error`, async () => {
      let child;
      const kills = [];
      let loadState = 'loaded';
      const systemctlSpawnImpl = (_command, args) => {
        const control = new EventEmitter();
        control.stdout = new PassThrough();
        control.stderr = new PassThrough();
        const signalArg = args.find(value => value.startsWith('--signal='));
        if (signalArg) kills.push(signalArg.slice('--signal='.length));
        queueMicrotask(() => {
          if (args.includes('show')) control.stdout.write(`${loadState}\n`);
          if (args.includes('stop')) loadState = 'not-found';
          control.emit('close', 0, null);
        });
        return control;
      };
      const spawnImpl = () => {
        child = new EventEmitter();
        child.stdin = new PassThrough();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = signal => {
          kills.push(signal);
          return true;
        };
        return child;
      };
      const error = Object.assign(new Error(`${kind} transport failed`), {
        code: kind === 'stdin' ? 'EIO' : 'ECHILD'
      });
      let rejection = null;
      const pending = runBlueprintCommand({
        args: ['exec'],
        cwd: '/tmp/blueprint-worker-delayed-close',
        input: '',
        timeoutMs: 5_000,
        spawnImpl,
        systemctlSpawnImpl
      });
      pending.catch(value => {
        rejection = value;
      });
      if (kind === 'child') child.emit('error', error);
      else child.stdin.emit('error', error);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(rejection, null);
      assert.deepEqual(kills, ['SIGTERM']);
      child.emit('close', null, 'SIGTERM');
      await assert.rejects(pending, value => {
        assert.equal(value, error);
        assert.equal(value.workerResult.signal, 'SIGTERM');
        return true;
      });
    });
  }
});

test('generation fails closed before launch when the user systemd manager is unavailable', async () => {
  let spawnCalls = 0;
  let probeOptions;
  await assert.rejects(
    runBlueprintCommand({
      args: ['exec'],
      cwd: '/tmp/blueprint-worker',
      input: '',
      timeoutMs: 1_000,
      systemdManagerProbeImpl: (_command, _args, options) => {
        probeOptions = options;
        return {
          error: Object.assign(new Error('manager probe timed out'), {
            code: 'ETIMEDOUT'
          }),
          signal: 'SIGKILL',
          status: null
        };
      },
      spawnImpl: () => {
        spawnCalls += 1;
        throw new Error('must not spawn without systemd containment');
      }
    }),
    error => {
      assert.equal(error.code, 'BLUEPRINT_WORKER_TREE_ISOLATION_UNAVAILABLE');
      assert.deepEqual(error.managerProbe, {
        signal: 'SIGKILL',
        status: null,
        timedOut: true
      });
      return true;
    }
  );
  assert.equal(spawnCalls, 0);
  assert.equal(probeOptions.timeout, 500);
  assert.equal(probeOptions.killSignal, 'SIGKILL');
});

test('systemd containment controls stay behind the unload barrier until control recovers', async t => {
  for (const mode of ['hanging', 'nonzero', 'hanging-open-controller']) {
    await t.test(mode, async () => {
      let controller;
      const primary = new Error('controller failed without close');
      let controlsHealthy = false;
      let recoveredLoadState = mode === 'hanging-open-controller'
        ? 'loaded'
        : 'not-found';
      let settled = false;
      const fakeController = () => {
        controller = new EventEmitter();
        controller.stdin = new PassThrough();
        controller.stdout = new PassThrough();
        controller.stderr = new PassThrough();
        controller.kill = () => true;
        if (mode !== 'hanging-open-controller') {
          queueMicrotask(() => controller.emit('close', 0, null));
        }
        return controller;
      };
      const systemctlSpawnImpl = (_command, args) => {
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = () => true;
        if (controlsHealthy) {
          queueMicrotask(() => {
            if (args.includes('show')) {
              child.stdout.write(`${recoveredLoadState}\n`);
            }
            if (args.includes('stop')) recoveredLoadState = 'not-found';
            child.emit('close', 0, null);
          });
        } else if (mode === 'nonzero') {
          queueMicrotask(() => child.emit('close', 1, null));
        }
        return child;
      };
      const pending = runBlueprintCommand({
          args: ['exec'],
          cwd: '/tmp/blueprint-systemd-control-failure',
          input: '',
          timeoutMs: 1_000,
          spawnImpl: fakeController,
          systemctlSpawnImpl,
          systemdControlTimeoutMs: 20,
          systemdCleanupTimeoutMs: 100
        });
      if (mode === 'hanging-open-controller') controller.emit('error', primary);
      pending.finally(() => {
        settled = true;
      }).catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 140));
      assert.equal(settled, false);
      controlsHealthy = true;
      if (mode === 'hanging-open-controller') {
        controller.emit('close', null, 'SIGKILL');
      }
      if (mode === 'hanging-open-controller') await assert.rejects(pending, error => {
        assert.equal(error, primary);
        return true;
      });
      else {
        const result = await pending;
        assert.equal(result.code, 0);
      }
      assert.equal(settled, true);
    });
  }
});

test('proven unit unload bounds a systemd-run controller that never closes', async () => {
  let controller;
  let loadState = 'loaded';
  let unrefCalled = false;
  const primary = new Error('controller transport failed');
  const spawnImpl = () => {
    controller = new EventEmitter();
    controller.stdin = new PassThrough();
    controller.stdout = new PassThrough();
    controller.stderr = new PassThrough();
    controller.kill = () => true;
    controller.unref = () => {
      unrefCalled = true;
    };
    return controller;
  };
  const systemctlSpawnImpl = (_command, args) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    queueMicrotask(() => {
      if (args.includes('show')) child.stdout.write(`${loadState}\n`);
      if (args.includes('stop')) loadState = 'not-found';
      child.emit('close', 0, null);
    });
    return child;
  };
  const startedAt = Date.now();
  const pending = runBlueprintCommand({
    args: ['exec'],
    cwd: '/tmp/blueprint-systemd-controller-no-close',
    input: '',
    timeoutMs: 1_000,
    spawnImpl,
    systemctlSpawnImpl,
    systemdControlTimeoutMs: 20,
    systemdCleanupTimeoutMs: 100,
    systemdControllerCloseTimeoutMs: 40
  });
  controller.emit('error', primary);
  await assert.rejects(pending, error => error === primary);
  assert.ok(Date.now() - startedAt < 250);
  assert.equal(controller.stdin.destroyed, true);
  assert.equal(controller.stdout.destroyed, true);
  assert.equal(controller.stderr.destroyed, true);
  assert.equal(unrefCalled, true);
});

test('settlement drains a hanging passive observer even when its kill fails', {
  skip: process.platform !== 'linux'
}, async t => {
  const root = await temporaryDirectory(t);
  const observerPidPath = path.join(root, 'observer.pid');
  const settledPath = path.join(root, 'settled.json');
  const beforeExitPath = path.join(root, 'before-exit');
  const lifecycleUrl = new URL(
    './blueprint-candidate-lifecycle.mjs',
    import.meta.url
  ).href;
  const wrapperSource = `
const { spawn } = await import('node:child_process');
const { EventEmitter } = await import('node:events');
const { writeFileSync } = await import('node:fs');
const { PassThrough } = await import('node:stream');
const { runBlueprintCommand } = await import(${JSON.stringify(lifecycleUrl)});
let controller;
let observer;
let observerUnrefed = false;
let loadState = 'loaded';
let systemctlCalls = 0;
let lifecycleSettled = false;
process.on('beforeExit', () => {
  if (lifecycleSettled) {
    writeFileSync(${JSON.stringify(beforeExitPath)}, 'beforeExit\\n');
  }
});
const spawnImpl = () => {
  controller = new EventEmitter();
  controller.stdin = new PassThrough();
  controller.stdout = new PassThrough();
  controller.stderr = new PassThrough();
  controller.kill = () => true;
  return controller;
};
const systemctlSpawnImpl = (_command, args) => {
  systemctlCalls += 1;
  if (systemctlCalls === 1) {
    observer = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    writeFileSync(${JSON.stringify(observerPidPath)}, String(observer.pid));
    const originalUnref = observer.unref.bind(observer);
    observer.unref = () => {
      observerUnrefed = true;
      return originalUnref();
    };
    observer.kill = () => {
      const error = new Error('observer kill denied');
      error.code = 'EPERM';
      throw error;
    };
    return observer;
  }
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  queueMicrotask(() => {
    if (args.includes('show')) child.stdout.write(loadState + '\\n');
    if (args.includes('stop')) {
      loadState = 'not-found';
      queueMicrotask(() => controller.emit('close', null, 'SIGTERM'));
    }
    child.emit('close', 0, null);
  });
  return child;
};
const primary = new Error('controller transport failed');
const pending = runBlueprintCommand({
  args: ['exec'],
  cwd: ${JSON.stringify(root)},
  input: '',
  timeoutMs: 1000,
  spawnImpl,
  systemctlSpawnImpl,
  systemdControlTimeoutMs: 80,
  systemdCleanupTimeoutMs: 100
});
controller.emit('error', primary);
try {
  await pending;
} catch (error) {
  if (error !== primary) throw error;
}
lifecycleSettled = true;
writeFileSync(${JSON.stringify(settledPath)}, JSON.stringify({
  stderrDestroyed: observer.stderr.destroyed,
  stdoutDestroyed: observer.stdout.destroyed,
  unrefed: observerUnrefed
}));`;
  const wrapper = spawnIsolatedWrapper(t, wrapperSource);
  const observerPid = Number(
    await waitForFile(observerPidPath, 2_000, 'passive observer PID')
  );
  t.after(() => {
    if (processIsAlive(observerPid)) process.kill(observerPid, 'SIGKILL');
  });
  assert.deepEqual(
    await waitForChildClose(wrapper, 2_000, 'passive observer wrapper'),
    { code: 0, signal: null }
  );
  assert.deepEqual(
    JSON.parse(await readFile(settledPath, 'utf8')),
    {
      stderrDestroyed: true,
      stdoutDestroyed: true,
      unrefed: true
    }
  );
  assert.equal(await readFile(beforeExitPath, 'utf8'), 'beforeExit\n');
});

test('a loaded systemd unit blocks settlement through permanent control failures', async () => {
  let loadState = 'loaded';
  let settled = false;
  const spawnImpl = () => {
    const controller = new EventEmitter();
    controller.stdin = new PassThrough();
    controller.stdout = new PassThrough();
    controller.stderr = new PassThrough();
    controller.kill = () => true;
    queueMicrotask(() => controller.emit('close', 0, null));
    return controller;
  };
  const systemctlSpawnImpl = (_command, args) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    queueMicrotask(() => {
      if (args.includes('show')) {
        child.stdout.write(`${loadState}\n`);
        child.emit('close', 0, null);
      } else child.emit('close', 1, null);
    });
    return child;
  };
  const pending = runBlueprintCommand({
    args: ['exec'],
    cwd: '/tmp/blueprint-systemd-loaded-barrier',
    input: '',
    timeoutMs: 1_000,
    spawnImpl,
    systemctlSpawnImpl,
    systemdControlTimeoutMs: 20,
    systemdCleanupTimeoutMs: 80
  });
  pending.finally(() => {
    settled = true;
  }).catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(settled, false);
  loadState = 'not-found';
  const result = await pending;
  assert.equal(result.code, 0);
});

test('systemd cleanup observes late unit creation and loaded units after controller close', async t => {
  for (const scenario of [
    'late-creation',
    'loaded-after-close',
    'late-post-close'
  ]) {
    await t.test(scenario, async () => {
      let controller;
      let loadState = scenario === 'loaded-after-close'
        ? 'loaded'
        : 'not-found';
      let showCalls = 0;
      const controls = [];
      const spawnImpl = () => {
        controller = new EventEmitter();
        controller.stdin = new PassThrough();
        controller.stdout = new PassThrough();
        controller.stderr = new PassThrough();
        controller.kill = () => true;
        if (scenario === 'loaded-after-close') {
          queueMicrotask(() => controller.emit('close', 0, null));
        } else if (scenario === 'late-post-close') {
          queueMicrotask(() => controller.emit('close', 1, null));
        }
        return controller;
      };
      const systemctlSpawnImpl = (_command, args) => {
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = () => true;
        controls.push(args.slice(1));
        queueMicrotask(() => {
          if (args.includes('show')) {
            showCalls += 1;
            if (
              (
                scenario === 'late-creation'
                && showCalls === 3
              )
              || (
                scenario === 'late-post-close'
                && showCalls === 32
              )
            ) {
              loadState = 'loaded';
            }
            child.stdout.write(`${loadState}\n`);
          }
          if (args.includes('stop')) {
            loadState = 'not-found';
            if (scenario === 'late-creation') {
              queueMicrotask(() => controller.emit('close', null, 'SIGTERM'));
            }
          }
          child.emit('close', 0, null);
        });
        return child;
      };
      const pending = runBlueprintCommand({
        args: ['exec'],
        cwd: '/tmp/blueprint-systemd-race',
        input: '',
        timeoutMs: 1_000,
        spawnImpl,
        systemctlSpawnImpl,
        systemdControlTimeoutMs: 20,
        systemdCleanupTimeoutMs: 300
      });
      if (scenario === 'late-creation') {
        const primary = new Error('controller transport failed before activation');
        controller.emit('error', primary);
        await assert.rejects(pending, error => error === primary);
        assert.ok(showCalls >= 3);
      } else if (scenario === 'loaded-after-close') {
        const result = await pending;
        assert.equal(result.code, 0);
      } else {
        let settled = false;
        pending.finally(() => {
          settled = true;
        }).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 550));
        assert.equal(settled, false);
        await assert.rejects(
          pending,
          error => error.code === 'BLUEPRINT_WORKER_EXIT'
        );
        assert.ok(showCalls >= 3);
      }
      assert.ok(controls.some(args => args.includes('stop')));
      assert.ok(controls.some(args => args.includes('--signal=SIGTERM')));
    });
  }
});

test('parent signal restores default handling after the global shutdown deadline', {
  skip: process.platform !== 'linux'
}, async t => {
  const root = await temporaryDirectory(t);
  const readyPath = path.join(root, 'broken-systemd-control-ready');
  const lifecycleUrl = new URL(
    './blueprint-candidate-lifecycle.mjs',
    import.meta.url
  ).href;
  const wrapperSource = `
const { EventEmitter } = await import('node:events');
const { PassThrough } = await import('node:stream');
const { writeFile } = await import('node:fs/promises');
const { runBlueprintCommand } = await import(${JSON.stringify(lifecycleUrl)});
const spawnImpl = () => {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  return child;
};
const systemctlSpawnImpl = () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  return child;
};
void runBlueprintCommand({
  args: ['exec'],
  cwd: ${JSON.stringify(root)},
  input: '',
  timeoutMs: 10000,
  spawnImpl,
  systemctlSpawnImpl,
  systemdControlTimeoutMs: 50,
  systemdCleanupTimeoutMs: 100
});
await writeFile(${JSON.stringify(readyPath)}, 'ready\\n');
setInterval(() => {}, 1000);`;
  const wrapper = spawnIsolatedWrapper(t, wrapperSource);
  await waitForFile(readyPath, 2_000, 'broken systemd control wrapper');
  const startedAt = Date.now();
  wrapper.kill('SIGTERM');
  assert.deepEqual(
    await waitForChildClose(wrapper, 3_000, 'global shutdown deadline'),
    { code: null, signal: 'SIGTERM' }
  );
  assert.ok(Date.now() - startedAt >= 1_400);
  assert.ok(Date.now() - startedAt < 2_500);
});

test('Linux blueprint workers are isolated and cleaned up as process trees', {
  skip: process.platform !== 'linux'
}, async t => {
  const lifecycleUrl = new URL(
    './blueprint-candidate-lifecycle.mjs',
    import.meta.url
  ).href;

  await t.test(
    'validated termination contains a worker SIGTERM group broadcast',
    async t => {
      const root = await createFixture(t);
      const { sidecar } = await loadTemplateSidecar({
        projectRoot: root,
        theme: THEME,
        template: TEMPLATE
      });
      const workspace = await createCommandWorkspace(
        root,
        sidecar,
        'group-broadcast-survival'
      );
      const survivedPath = path.join(root, 'generator-survived.txt');
      const workerSource = `const fs=require('node:fs');
const value=JSON.parse(fs.readFileSync('inputs/contract.json','utf8')).completeShapeExample;
value.decorations[0].cell.x += 1;
value.spawn.playerSlots[0].cell.x += 1;
fs.writeFileSync('candidate.json',JSON.stringify(value));
process.on('SIGTERM',()=>{
  process.removeAllListeners('SIGTERM');
  process.kill(0,'SIGTERM');
});
setInterval(()=>{},1000);`;
      const wrapperSource = `
const { runBlueprintCommand } = await import(${JSON.stringify(lifecycleUrl)});
await runBlueprintCommand({
  command: process.execPath,
  args: ['-e', ${JSON.stringify(workerSource)}],
  cwd: ${JSON.stringify(workspace)},
  input: '',
  timeoutMs: 3000,
  candidateContext: ${JSON.stringify({ mapId: MAP_IDS[0], sidecar })},
  completionGraceMs: 40,
  completionPollMs: 10
});
await (await import('node:fs/promises')).writeFile(
  ${JSON.stringify(survivedPath)},
  'survived\\n'
);`;
      const wrapper = spawnIsolatedWrapper(t, wrapperSource);
      const outcome = await waitForChildClose(
        wrapper,
        5_000,
        'group-broadcast wrapper'
      );
      assert.deepEqual(outcome, { code: 0, signal: null });
      assert.equal(await readFile(survivedPath, 'utf8'), 'survived\n');
    }
  );

  await t.test(
    'validated termination kills a stubborn worker descendant',
    async t => {
      const root = await createFixture(t);
      const { sidecar } = await loadTemplateSidecar({
        projectRoot: root,
        theme: THEME,
        template: TEMPLATE
      });
      const workspace = await createCommandWorkspace(
        root,
        sidecar,
        'stubborn-descendant'
      );
      const descendantPidPath = path.join(root, 'descendant.pid');
      const descendantSource = `const fs=require('node:fs');
process.on('SIGTERM',()=>{});
fs.writeFileSync(${JSON.stringify(descendantPidPath)},String(process.pid));
setInterval(()=>{},1000);`;
      const workerSource = `const fs=require('node:fs');
const {spawn}=require('node:child_process');
spawn(process.execPath,['-e',${JSON.stringify(descendantSource)}],{
  stdio:'ignore'
});
const ready=setInterval(()=>{
  if(!fs.existsSync(${JSON.stringify(descendantPidPath)})) return;
  clearInterval(ready);
  const value=JSON.parse(fs.readFileSync('inputs/contract.json','utf8')).completeShapeExample;
  value.decorations[0].cell.x += 1;
  value.spawn.playerSlots[0].cell.x += 1;
  fs.writeFileSync('candidate.json',JSON.stringify(value));
},10);
setInterval(()=>{},1000);`;
      const result = await hangingNodeCommand(
        workspace,
        sidecar,
        workerSource,
        { timeoutMs: 2_000, completionGraceMs: 80, completionPollMs: 10 }
      );
      assert.equal(result.completionReason, 'validated-candidate');
      const descendantPid = Number(
        await waitForFile(descendantPidPath, 1_000, 'descendant PID')
      );
      assert.ok(Number.isSafeInteger(descendantPid) && descendantPid > 0);
      t.after(() => {
        if (processIsAlive(descendantPid)) process.kill(descendantPid, 'SIGKILL');
      });
      await waitForProcessExit(
        descendantPid,
        2_000,
        'stubborn worker descendant'
      );
    }
  );

  await t.test(
    'validated termination kills a fast double-forked setsid grandchild',
    async t => {
      const root = await createFixture(t);
      const { sidecar } = await loadTemplateSidecar({
        projectRoot: root,
        theme: THEME,
        template: TEMPLATE
      });
      const workspace = await createCommandWorkspace(
        root,
        sidecar,
        'setsid-descendant'
      );
      const descendantPidPath = path.join(root, 'setsid-descendant.pid');
      const descendantSource = `const fs=require('node:fs');
process.on('SIGTERM',()=>{});
fs.writeFileSync(${JSON.stringify(descendantPidPath)},String(process.pid));
setInterval(()=>{},1000);`;
      const intermediateSource = `const {spawn}=require('node:child_process');
const escaped=spawn(process.execPath,['-e',${JSON.stringify(descendantSource)}],{
  detached:true,
  stdio:'ignore'
});
escaped.unref();`;
      const workerSource = `const fs=require('node:fs');
const {spawn}=require('node:child_process');
const intermediate=spawn(process.execPath,['-e',${JSON.stringify(intermediateSource)}],{
  detached:true,
  stdio:'ignore'
});
intermediate.unref();
const ready=setInterval(()=>{
  if(!fs.existsSync(${JSON.stringify(descendantPidPath)})) return;
  clearInterval(ready);
  const value=JSON.parse(fs.readFileSync('inputs/contract.json','utf8')).completeShapeExample;
  value.decorations[0].cell.x += 1;
  value.spawn.playerSlots[0].cell.x += 1;
  fs.writeFileSync('candidate.json',JSON.stringify(value));
},10);
setInterval(()=>{},1000);`;
      const result = await hangingNodeCommand(
        workspace,
        sidecar,
        workerSource,
        { timeoutMs: 2_000, completionGraceMs: 80, completionPollMs: 10 }
      );
      assert.equal(result.completionReason, 'validated-candidate');
      const descendantPid = Number(
        await waitForFile(descendantPidPath, 1_000, 'setsid descendant PID')
      );
      assert.ok(Number.isSafeInteger(descendantPid) && descendantPid > 0);
      t.after(() => {
        if (processIsAlive(descendantPid)) process.kill(descendantPid, 'SIGKILL');
      });
      await waitForProcessExit(
        descendantPid,
        2_000,
        'setsid worker descendant'
      );
    }
  );

  await t.test(
    'normal worker exit fails closed after killing a resistant descendant',
    async t => {
      const root = await temporaryDirectory(t);
      const descendantPidPath = path.join(root, 'normal-exit-descendant.pid');
      const descendantSource = `const fs=require('node:fs');
process.on('SIGTERM',()=>{});
fs.writeFileSync(${JSON.stringify(descendantPidPath)},String(process.pid));
setInterval(()=>{},1000);`;
      const workerSource = `const fs=require('node:fs');
const {spawn}=require('node:child_process');
spawn(process.execPath,['-e',${JSON.stringify(descendantSource)}],{
  stdio:'ignore'
});
const ready=setInterval(()=>{
  if(!fs.existsSync(${JSON.stringify(descendantPidPath)})) return;
  clearInterval(ready);
  process.exit(0);
},10);`;
      await assert.rejects(
        runBlueprintCommand({
          command: process.execPath,
          args: ['-e', workerSource],
          cwd: root,
          input: '',
          timeoutMs: 3_000
        }),
        error => error.code === 'BLUEPRINT_WORKER_EXIT'
      );
      const descendantPid = Number(
        await waitForFile(descendantPidPath, 1_000, 'normal-exit descendant PID')
      );
      assert.ok(Number.isSafeInteger(descendantPid) && descendantPid > 0);
      t.after(() => {
        if (processIsAlive(descendantPid)) process.kill(descendantPid, 'SIGKILL');
      });
      await waitForProcessExit(
        descendantPid,
        2_000,
        'normal-exit worker descendant'
      );
    }
  );

  for (const externalSignal of ['SIGHUP', 'SIGINT', 'SIGTERM']) {
    await t.test(
      `external ${externalSignal} cleans the active worker group before parent exit`,
      async t => {
        const root = await temporaryDirectory(t);
        const workerPidPath = path.join(root, 'worker.pid');
        const descendantPidPath = path.join(root, 'descendant.pid');
        const descendantSource = `const fs=require('node:fs');
process.on('SIGTERM',()=>{});
fs.writeFileSync(${JSON.stringify(descendantPidPath)},String(process.pid));
setInterval(()=>{},1000);`;
        const workerSource = `const fs=require('node:fs');
const {spawn}=require('node:child_process');
fs.writeFileSync(${JSON.stringify(workerPidPath)},String(process.pid));
spawn(process.execPath,['-e',${JSON.stringify(descendantSource)}],{
  stdio:'ignore'
});
setInterval(()=>{},1000);`;
        const wrapperSource = `
const { runBlueprintCommand } = await import(${JSON.stringify(lifecycleUrl)});
await runBlueprintCommand({
  command: process.execPath,
  args: ['-e', ${JSON.stringify(workerSource)}],
  cwd: ${JSON.stringify(root)},
  input: '',
  timeoutMs: 10000
});`;
        const wrapper = spawnIsolatedWrapper(t, wrapperSource);
        const workerPid = Number(
          await waitForFile(workerPidPath, 3_000, 'worker PID')
        );
        const descendantPid = Number(
          await waitForFile(descendantPidPath, 3_000, 'descendant PID')
        );
        assert.ok(Number.isSafeInteger(workerPid) && workerPid > 0);
        assert.ok(Number.isSafeInteger(descendantPid) && descendantPid > 0);
        t.after(() => {
          for (const pid of [workerPid, descendantPid]) {
            if (processIsAlive(pid)) process.kill(pid, 'SIGKILL');
          }
        });
        wrapper.kill(externalSignal);
        const outcome = await waitForChildClose(
          wrapper,
          4_000,
          `${externalSignal} wrapper`
        );
        assert.deepEqual(outcome, { code: null, signal: externalSignal });
        await Promise.all([
          waitForProcessExit(workerPid, 2_000, 'external-signal worker'),
          waitForProcessExit(
            descendantPid,
            2_000,
            'external-signal worker descendant'
          )
        ]);
      }
    );
  }
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

test('timed-out worker evidence is immutable and survives resume and force', async t => {
  const root = await createFixture(t);
  const candidateBytes = Buffer.from('{"partial":true}\n');
  const worker = async ({ workspace }) => {
    await writeFile(path.join(workspace, 'candidate.json'), candidateBytes);
    await writeFile(path.join(workspace, 'last-message.txt'), 'timeout message\n');
    const error = new Error('Codex blueprint worker timed out after 100ms');
    error.code = 'BLUEPRINT_WORKER_TIMEOUT';
    error.workerResult = {
      code: null,
      signal: 'SIGTERM',
      stdout: Buffer.from('partial jsonl\n'),
      stderr: Buffer.from('partial stderr\n'),
      args: ['fake-worker'],
      completionReason: 'process-exit',
      intentionallyTerminated: false,
      completedCandidateSha256: null
    };
    throw error;
  };
  const rejectTimeout = overrides => assert.rejects(
    generateBlueprintCandidates(generateOptions(root, overrides), { worker }),
    error => {
      assert.equal(error.code, 'BLUEPRINT_WORKER_TIMEOUT');
      assert.equal(error.message, 'Codex blueprint worker timed out after 100ms');
      return true;
    }
  );
  await rejectTimeout();
  assert.equal(await exists(candidateRoot(root)), false);
  const historyRoot = path.join(
    path.dirname(candidateRoot(root)),
    '.attempt-history',
    MAP_IDS[0]
  );
  const attempts = await readdir(historyRoot);
  assert.equal(attempts.length, 1);
  assert.match(attempts[0], /^[0-9a-f]{64}$/);
  const attemptRoot = path.join(historyRoot, attempts[0]);
  assert.equal(await readFile(path.join(attemptRoot, 'prompt.txt'), 'utf8'),
    `${buildBlueprintPrompt({
      profile: JSON.parse(
        await readFile(path.join(root, BLUEPRINT_PROMPT_PATH), 'utf8')
      ),
      sidecar: (await loadTemplateSidecar({
        projectRoot: root,
        theme: THEME,
        template: TEMPLATE
      })).sidecar,
      mapId: MAP_IDS[0]
    })}\n`);
  assert.equal(
    await readFile(path.join(attemptRoot, 'worker.jsonl'), 'utf8'),
    'partial jsonl\n'
  );
  assert.equal(
    await readFile(path.join(attemptRoot, 'worker.stderr.log'), 'utf8'),
    'partial stderr\n'
  );
  assert.equal(
    await readFile(path.join(attemptRoot, 'last-message.txt'), 'utf8'),
    'timeout message\n'
  );
  assert.deepEqual(
    await readFile(path.join(attemptRoot, 'candidate.json')),
    candidateBytes
  );
  assert.equal(
    await exists(path.join(attemptRoot, 'workspace/candidate.json')),
    false
  );
  assert.equal(
    await exists(path.join(attemptRoot, 'workspace/last-message.txt')),
    false
  );
  const parentError = JSON.parse(
    await readFile(path.join(attemptRoot, 'error.json'), 'utf8')
  );
  assert.deepEqual(parentError.parentError, {
    code: 'BLUEPRINT_WORKER_TIMEOUT',
    message: 'Codex blueprint worker timed out after 100ms',
    name: 'Error'
  });
  assert.equal(parentError.workerProcess.signal, 'SIGTERM');
  const immutableSnapshot = await snapshotTree(attemptRoot);

  await rejectTimeout({ resume: true });
  assert.deepEqual(await snapshotTree(attemptRoot), immutableSnapshot);
  assert.equal((await readdir(historyRoot)).length, 1);

  await rejectTimeout({ force: true });
  assert.deepEqual(await snapshotTree(attemptRoot), immutableSnapshot);
  assert.equal((await readdir(historyRoot)).length, 1);
});

test('post-worker invalid candidate evidence survives resume and force exactly', async t => {
  const root = await createFixture(t);
  const candidateBytes = Buffer.from('{}\n');
  const worker = async ({ workspace }) => {
    await writeFile(path.join(workspace, 'candidate.json'), candidateBytes);
    await writeFile(path.join(workspace, 'last-message.txt'), 'invalid candidate\n');
    return {
      code: 0,
      signal: null,
      stdout: Buffer.from('{"type":"fake-invalid-worker"}\n'),
      stderr: Buffer.from('validation pending\n'),
      args: ['fake-worker'],
      completionReason: 'process-exit',
      intentionallyTerminated: false,
      completedCandidateSha256: null
    };
  };
  const rejectInvalid = overrides => assert.rejects(
    generateBlueprintCandidates(generateOptions(root, overrides), { worker }),
    /candidate blueprint/
  );
  await rejectInvalid();
  assert.equal(await exists(candidateRoot(root)), false);

  const historyRoot = path.join(
    path.dirname(candidateRoot(root)),
    '.attempt-history',
    MAP_IDS[0]
  );
  const attempts = await readdir(historyRoot);
  assert.equal(attempts.length, 1);
  const attemptRoot = path.join(historyRoot, attempts[0]);
  assert.deepEqual(
    await readFile(path.join(attemptRoot, 'candidate.json')),
    candidateBytes
  );
  assert.equal(
    await readFile(path.join(attemptRoot, 'last-message.txt'), 'utf8'),
    'invalid candidate\n'
  );
  const errorEvidence = JSON.parse(
    await readFile(path.join(attemptRoot, 'error.json'), 'utf8')
  );
  assert.equal(
    errorEvidence.parentError.code,
    'INVALID_TEMPLATE_MAP_BLUEPRINT'
  );
  assert.match(errorEvidence.parentError.message, /candidate blueprint/);
  assert.equal(
    Object.keys(await snapshotTree(attemptRoot)).some(file => file.endsWith('.tmp')),
    false
  );
  const immutableSnapshot = await snapshotTree(historyRoot);
  const stagingRoot = path.join(
    path.dirname(candidateRoot(root)),
    '.attempt-staging',
    MAP_IDS[0]
  );
  await mkdir(stagingRoot, { recursive: true });
  const orphanName =
    '99999.00000000-0000-4000-8000-000000000000.tmp';
  await writeFile(
    path.join(stagingRoot, orphanName),
    '{"type":"fake-invalid-worker"}\n'
  );
  await writeFile(path.join(stagingRoot, 'foreign.keep'), 'not private staging\n');
  await rm(path.join(attemptRoot, 'worker.jsonl'));

  await rejectInvalid({ resume: true });
  assert.deepEqual(await snapshotTree(historyRoot), immutableSnapshot);
  assert.deepEqual(await readdir(historyRoot), attempts);
  assert.equal(await exists(path.join(stagingRoot, orphanName)), false);
  assert.equal(
    await readFile(path.join(stagingRoot, 'foreign.keep'), 'utf8'),
    'not private staging\n'
  );

  await rejectInvalid({ force: true });
  assert.deepEqual(await snapshotTree(historyRoot), immutableSnapshot);
  assert.deepEqual(await readdir(historyRoot), attempts);

  await writeFile(path.join(attemptRoot, 'error.json'), '{"drifted":true}\n');
  await assert.rejects(
    generateBlueprintCandidates(
      generateOptions(root, { force: true }),
      { worker }
    ),
    error => {
      assert.equal(error.code, 'INVALID_TEMPLATE_MAP_BLUEPRINT');
      assert.ok(error.secondaryFailures.some(diagnostic =>
        diagnostic.code === 'BLUEPRINT_ATTEMPT_EVIDENCE_CONFLICT'
        && /immutable blueprint attempt evidence conflicts/.test(diagnostic.message)
      ));
      return true;
    }
  );
  assert.equal(await exists(candidateRoot(root)), true);
  assert.equal(
    (await readdir(candidateRoot(root))).some(
      name => name.startsWith('.failed-workspace-')
    ),
    true
  );
});

test('matched staged evidence is not double-counted at the total history cap', async t => {
  const root = await createFixture(t);
  const worker = async ({ workspace }) => {
    await writeFile(path.join(workspace, 'candidate.json'), '{}\n');
    return {
      code: 0,
      signal: null,
      stdout: Buffer.from('{"type":"fake-matched-worker"}\n'),
      stderr: Buffer.from('matched staged stderr\n'),
      args: ['fake-worker'],
      completionReason: 'process-exit',
      intentionallyTerminated: false,
      completedCandidateSha256: null
    };
  };
  const rejectInvalid = overrides => assert.rejects(
    generateBlueprintCandidates(generateOptions(root, overrides), { worker }),
    error => error.code === 'INVALID_TEMPLATE_MAP_BLUEPRINT'
  );
  await rejectInvalid();
  const historyRoot = path.join(
    path.dirname(candidateRoot(root)),
    '.attempt-history',
    MAP_IDS[0]
  );
  const [attempt] = await readdir(historyRoot);
  const attemptRoot = path.join(historyRoot, attempt);
  async function storedBytes(directory) {
    let total = 0;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) total += await storedBytes(absolute);
      else total += (await stat(absolute)).size;
    }
    return total;
  }
  const aggregateBytes = await storedBytes(attemptRoot);
  assert.ok(aggregateBytes < MAX_ATTEMPT_HISTORY_BYTES);
  const stagedBytes = await readFile(path.join(attemptRoot, 'worker.jsonl'));
  await rm(path.join(attemptRoot, 'worker.jsonl'));
  const stagingRoot = path.join(
    path.dirname(candidateRoot(root)),
    '.attempt-staging',
    MAP_IDS[0]
  );
  await mkdir(stagingRoot, { recursive: true });
  const stagedName =
    '88888.00000000-0000-4000-8000-000000000000.tmp';
  await writeFile(path.join(stagingRoot, stagedName), stagedBytes);
  const fillerRoot = path.join(historyRoot, 'e'.repeat(64));
  await mkdir(fillerRoot);
  const fillerPath = path.join(fillerRoot, 'retained-evidence.bin');
  await writeFile(fillerPath, '');
  await truncate(
    fillerPath,
    MAX_ATTEMPT_HISTORY_BYTES - aggregateBytes
  );

  await rejectInvalid({ force: true });
  assert.deepEqual(
    await readFile(path.join(attemptRoot, 'worker.jsonl')),
    stagedBytes
  );
  assert.equal(await exists(path.join(stagingRoot, stagedName)), false);
});

test('attempt error evidence is bounded with original size and hash provenance', async t => {
  const root = await createFixture(t);
  const hugeMessage = 'worker failure '.repeat(20_000);
  await assert.rejects(
    generateBlueprintCandidates(generateOptions(root), {
      worker: async () => {
        const error = new Error(hugeMessage);
        error.code = 'HUGE_BLUEPRINT_WORKER_FAILURE';
        error.workerResult = {
          stdout: Buffer.from('bounded stdout\n'),
          stderr: Buffer.from('bounded stderr\n'),
          args: [],
          completionReason: 'process-exit',
          intentionallyTerminated: false,
          completedCandidateSha256: null
        };
        throw error;
      }
    }),
    error => error.code === 'HUGE_BLUEPRINT_WORKER_FAILURE'
  );
  const historyRoot = path.join(
    path.dirname(candidateRoot(root)),
    '.attempt-history',
    MAP_IDS[0]
  );
  const [attempt] = await readdir(historyRoot);
  const errorPath = path.join(historyRoot, attempt, 'error.json');
  const details = await stat(errorPath);
  assert.ok(details.size <= MAX_ATTEMPT_ERROR_BYTES);
  const evidence = JSON.parse(await readFile(errorPath, 'utf8'));
  assert.equal(evidence.serialization.truncated, true);
  assert.ok(evidence.serialization.originalBytes > MAX_ATTEMPT_ERROR_BYTES);
  assert.match(evidence.serialization.originalSha256, /^sha256:[0-9a-f]{64}$/);
  assert.equal(evidence.parentError.code, 'HUGE_BLUEPRINT_WORKER_FAILURE');
  assert.equal(evidence.parentError.serialization.message.truncated, true);
  assert.ok(
    evidence.parentError.serialization.message.originalBytes
    > MAX_ATTEMPT_ERROR_BYTES
  );
  assert.equal(evidence.previewEncoding, 'base64');
  assert.ok(evidence.preview.length > 0);
});

test('aggregate evidence limit failure retains the uncaptured workspace', async t => {
  const root = await createFixture(t);
  const oversizedCandidateBytes = 33 * 1024 * 1024;
  await assert.rejects(
    generateBlueprintCandidates(generateOptions(root), {
      worker: async ({ workspace }) => {
        await writeFile(
          path.join(workspace, 'candidate.json'),
          Buffer.alloc(oversizedCandidateBytes, 0x61)
        );
        const error = new Error('aggregate evidence fixture');
        error.code = 'AGGREGATE_EVIDENCE_FIXTURE';
        error.workerResult = {
          stdout: Buffer.alloc(4 * 1024 * 1024, 0x62),
          stderr: Buffer.alloc(4 * 1024 * 1024, 0x63),
          args: [],
          completionReason: 'process-exit',
          intentionallyTerminated: false,
          completedCandidateSha256: null
        };
        throw error;
      }
    }),
    error => {
      assert.equal(error.code, 'AGGREGATE_EVIDENCE_FIXTURE');
      assert.ok(error.secondaryFailures.some(diagnostic =>
        diagnostic.code === 'BLUEPRINT_ATTEMPT_EVIDENCE_LIMIT'
        && /aggregate/.test(diagnostic.message)
      ));
      return true;
    }
  );
  const rootPath = candidateRoot(root);
  assert.equal(await exists(rootPath), true);
  const workspaceName = (await readdir(rootPath)).find(
    name => name.startsWith('.failed-workspace-')
  );
  assert.ok(workspaceName);
  assert.equal(
    (await stat(path.join(rootPath, workspaceName, 'candidate.json'))).size,
    oversizedCandidateBytes
  );
});

test('total history limit retains the current failure workspace', async t => {
  const root = await createFixture(t);
  let calls = 0;
  const worker = async parameters => {
    calls += 1;
    return validWorker(
      blueprint => ({ ...blueprint, unexpected: true })
    )(parameters);
  };
  await assert.rejects(
    generateBlueprintCandidates(
      generateOptions(root),
      {
        worker,
        attemptHistoryByteLimit: 1
      }
    ),
    error => {
      assert.equal(error.code, 'INVALID_TEMPLATE_MAP_BLUEPRINT');
      assert.ok(error.secondaryFailures.some(diagnostic =>
        diagnostic.code === 'BLUEPRINT_ATTEMPT_HISTORY_LIMIT'
      ));
      return true;
    }
  );
  const rootPath = candidateRoot(root);
  assert.equal(await exists(rootPath), true);
  assert.equal(
    (await readdir(rootPath)).some(
      name => name.startsWith('.failed-workspace-')
    ),
    true
  );
  assert.equal(calls, 1);
  await assert.rejects(
    generateBlueprintCandidates(
      generateOptions(root, { resume: true }),
      { worker, attemptHistoryByteLimit: 1 }
    ),
    error => error.code === 'UNRESOLVED_BLUEPRINT_ATTEMPT_QUARANTINE'
  );
  assert.equal(calls, 1);
});

test('failure quarantine excludes old-path recreation and retains late additions', async t => {
  const root = await createFixture(t);
  let originalWorkspace;
  await assert.rejects(
    generateBlueprintCandidates(
      generateOptions(root),
      {
        worker: validWorker(blueprint => ({ ...blueprint, unexpected: true })),
        failureQuarantineHook: async context => {
          originalWorkspace = context.originalWorkspace;
          await mkdir(context.originalWorkspace, { recursive: true });
          await writeFile(
            path.join(context.originalWorkspace, 'late-addition.txt'),
            'late evidence\n'
          );
        }
      }
    ),
    /closed schema/
  );
  assert.equal(await exists(candidateRoot(root)), false);
  const candidateParent = path.dirname(candidateRoot(root));
  const retainedName = (await readdir(candidateParent)).find(
    name => name.startsWith(`.failed-candidate-${MAP_IDS[0]}-`)
  );
  assert.ok(retainedName);
  const retainedRoot = path.join(candidateParent, retainedName);
  assert.equal(
    await readFile(
      path.join(retainedRoot, path.basename(originalWorkspace), 'late-addition.txt'),
      'utf8'
    ),
    'late evidence\n'
  );
  const historyRoot = path.join(
    candidateParent,
    '.attempt-history',
    MAP_IDS[0]
  );
  const [attempt] = await readdir(historyRoot);
  assert.equal(
    await exists(
      path.join(historyRoot, attempt, 'workspace/late-addition.txt')
    ),
    false
  );
});

test('cleanup retains files added after immutable evidence publication', async t => {
  const root = await createFixture(t);
  await assert.rejects(
    generateBlueprintCandidates(
      generateOptions(root),
      {
        worker: validWorker(blueprint => ({ ...blueprint, unexpected: true })),
        beforeFailureCleanup: async ({ candidateRoot: rootPath }) => {
          await writeFile(
            path.join(rootPath, 'after-capture.txt'),
            'post-capture evidence\n'
          );
        }
      }
    ),
    /closed schema/
  );
  assert.equal(await exists(candidateRoot(root)), false);
  const candidateParent = path.dirname(candidateRoot(root));
  const retainedName = (await readdir(candidateParent)).find(
    name => name.startsWith(`.failed-candidate-${MAP_IDS[0]}-`)
  );
  assert.ok(retainedName);
  assert.equal(
    await readFile(
      path.join(candidateParent, retainedName, 'after-capture.txt'),
      'utf8'
    ),
    'post-capture evidence\n'
  );
});

test('pinned failed-workspace cleanup preserves a late writer file', async t => {
  const root = await createFixture(t);
  await assert.rejects(
    generateBlueprintCandidates(
      generateOptions(root),
      {
        worker: validWorker(blueprint => ({ ...blueprint, unexpected: true })),
        beforeEvidenceTreeCleanup: async ({ root: treeRoot, kind }) => {
          if (kind === 'failed-workspace') {
            await writeFile(
              path.join(treeRoot, 'late-workspace.txt'),
              'late workspace evidence\n'
            );
          }
        }
      }
    ),
    /closed schema/
  );
  const rootPath = candidateRoot(root);
  const failedWorkspace = (await readdir(rootPath)).find(
    name => name.startsWith('.failed-workspace-')
  );
  assert.ok(failedWorkspace);
  assert.equal(
    await readFile(
      path.join(rootPath, failedWorkspace, 'late-workspace.txt'),
      'utf8'
    ),
    'late workspace evidence\n'
  );
});

test('file replacement between verification and cleanup unlink is retained', async t => {
  const root = await createFixture(t);
  let replaced = false;
  await assert.rejects(
    generateBlueprintCandidates(
      generateOptions(root),
      {
        worker: validWorker(blueprint => ({ ...blueprint, unexpected: true })),
        beforeCapturedFileQuarantine: async ({ absolute, relative }) => {
          if (!replaced && relative === 'candidate.json') {
            replaced = true;
            await rename(absolute, `${absolute}.verified-original`);
            await writeFile(absolute, 'replacement after verification\n');
          }
        }
      }
    ),
    /closed schema/
  );
  assert.equal(replaced, true);
  const rootPath = candidateRoot(root);
  const failedWorkspace = (await readdir(rootPath)).find(
    name => name.startsWith('.failed-workspace-')
  );
  assert.ok(failedWorkspace);
  const retainedRoot = path.join(rootPath, failedWorkspace);
  assert.equal(
    await exists(path.join(retainedRoot, 'candidate.json.verified-original')),
    true
  );
  const privateReplacement = (await readdir(retainedRoot)).find(
    name => name.startsWith('.captured-cleanup-')
  );
  assert.ok(privateReplacement);
  assert.equal(
    await readFile(path.join(retainedRoot, privateReplacement), 'utf8'),
    'replacement after verification\n'
  );
});

test('pinned superseded-root cleanup preserves a late writer file', async t => {
  const root = await createFixture(t);
  const rootPath = candidateRoot(root);
  await mkdir(rootPath, { recursive: true });
  await writeFile(path.join(rootPath, 'partial.txt'), 'captured partial\n');
  await assert.rejects(
    generateBlueprintCandidates(
      generateOptions(root, { resume: true }),
      {
        worker: validWorker(),
        beforeEvidenceTreeCleanup: async ({ root: treeRoot, kind }) => {
          if (kind === 'superseded-root') {
            await writeFile(
              path.join(treeRoot, 'late-superseded.txt'),
              'late superseded evidence\n'
            );
          }
        }
      }
    ),
    error => error.code === 'BLUEPRINT_ATTEMPT_EVIDENCE_DRIFT'
  );
  const parent = path.dirname(rootPath);
  const retained = (await readdir(parent)).find(
    name => name.startsWith(`.superseded-candidate-${MAP_IDS[0]}-`)
  );
  assert.ok(retained);
  assert.equal(
    await readFile(path.join(parent, retained, 'late-superseded.txt'), 'utf8'),
    'late superseded evidence\n'
  );
});

test('quarantined directory swaps are manifested without following targets', async t => {
  const root = await createFixture(t);
  const sentinelRoot = path.join(root, 'directory-swap-sentinel');
  await mkdir(sentinelRoot);
  await writeFile(path.join(sentinelRoot, 'secret.txt'), 'must not capture\n');
  await assert.rejects(
    generateBlueprintCandidates(
      generateOptions(root),
      {
        worker: validWorker(blueprint => ({ ...blueprint, unexpected: true })),
        failureQuarantineHook: async ({ quarantinedWorkspace }) => {
          await rm(
            path.join(quarantinedWorkspace, 'inputs'),
            { recursive: true, force: true }
          );
          await symlink(sentinelRoot, path.join(quarantinedWorkspace, 'inputs'));
        }
      }
    ),
    /closed schema/
  );
  const historyRoot = path.join(
    path.dirname(candidateRoot(root)),
    '.attempt-history',
    MAP_IDS[0]
  );
  const [attempt] = await readdir(historyRoot);
  const attemptRoot = path.join(historyRoot, attempt);
  const manifest = JSON.parse(
    await readFile(path.join(attemptRoot, 'workspace-manifest.json'), 'utf8')
  );
  const inputs = manifest.entries.find(entry => entry.path === 'inputs');
  assert.equal(inputs.type, 'symlink');
  assert.equal(inputs.captured, false);
  assert.equal(
    await exists(path.join(attemptRoot, 'workspace/inputs/secret.txt')),
    false
  );
  assert.equal(
    await readFile(path.join(sentinelRoot, 'secret.txt'), 'utf8'),
    'must not capture\n'
  );
});

test('mid-traversal parent symlink swap aborts publication and retains quarantine', async t => {
  const root = await createFixture(t);
  const sentinelRoot = path.join(root, 'mid-traversal-sentinel');
  await mkdir(sentinelRoot);
  await writeFile(path.join(sentinelRoot, 'secret.txt'), 'never publish\n');
  let swapped = false;
  await assert.rejects(
    generateBlueprintCandidates(
      generateOptions(root),
      {
        worker: validWorker(blueprint => ({ ...blueprint, unexpected: true })),
        treeCaptureHook: async ({ directory, relative }) => {
          if (!swapped && relative === 'inputs') {
            swapped = true;
            await rename(directory, `${directory}.captured-original`);
            await symlink(sentinelRoot, directory);
          }
        }
      }
    ),
    error => {
      assert.equal(error.code, 'INVALID_TEMPLATE_MAP_BLUEPRINT');
      assert.ok(error.secondaryFailures.some(diagnostic =>
        diagnostic.code === 'BLUEPRINT_ATTEMPT_EVIDENCE_DRIFT'
      ));
      return true;
    }
  );
  assert.equal(swapped, true);
  const historyRoot = path.join(
    path.dirname(candidateRoot(root)),
    '.attempt-history',
    MAP_IDS[0]
  );
  assert.equal(await exists(historyRoot), false);
  assert.equal(await exists(candidateRoot(root)), true);
  assert.equal(
    await readFile(path.join(sentinelRoot, 'secret.txt'), 'utf8'),
    'never publish\n'
  );
});

test('unsafe residual candidate entries are evidenced and block replacement', async t => {
  const root = await createFixture(t);
  const rootPath = candidateRoot(root);
  const sentinel = path.join(root, 'residual-sentinel.txt');
  await writeFile(sentinel, 'do not read through symlink\n');
  await mkdir(rootPath, { recursive: true });
  await writeFile(path.join(rootPath, 'partial.txt'), 'safe residual\n');
  await symlink(sentinel, path.join(rootPath, 'unsafe-link'));

  await assert.rejects(
    generateBlueprintCandidates(
      generateOptions(root, { resume: true }),
      { worker: validWorker() }
    ),
    error => error.code === 'UNSAFE_BLUEPRINT_ATTEMPT_EVIDENCE'
  );
  assert.equal(await exists(rootPath), false);
  const candidateParent = path.dirname(rootPath);
  const retainedName = (await readdir(candidateParent)).find(
    name => name.startsWith(`.superseded-candidate-${MAP_IDS[0]}-`)
  );
  assert.ok(retainedName);
  const retainedRoot = path.join(candidateParent, retainedName);
  assert.equal(await readFile(path.join(retainedRoot, 'partial.txt'), 'utf8'),
    'safe residual\n');
  assert.equal(await readFile(sentinel, 'utf8'), 'do not read through symlink\n');
  const historyRoot = path.join(
    path.dirname(rootPath),
    '.attempt-history',
    MAP_IDS[0]
  );
  const [attempt] = await readdir(historyRoot);
  assert.equal(
    await readFile(
      path.join(historyRoot, attempt, 'residual/partial.txt'),
      'utf8'
    ),
    'safe residual\n'
  );
  const manifest = JSON.parse(
    await readFile(
      path.join(historyRoot, attempt, 'residual-manifest.json'),
      'utf8'
    )
  );
  const unsafe = manifest.entries.find(entry => entry.path === 'unsafe-link');
  assert.equal(unsafe.type, 'symlink');
  assert.equal(unsafe.captured, false);
});

test('private staging orphan reclamation is bounded and all-or-nothing', async t => {
  const root = await createFixture(t);
  const stagingRoot = path.join(
    path.dirname(candidateRoot(root)),
    '.attempt-staging',
    MAP_IDS[0]
  );
  await mkdir(stagingRoot, { recursive: true });
  await Promise.all(
    Array.from({ length: 129 }, (_, index) => {
      const suffix = String(index + 1).padStart(12, '0');
      return writeFile(
        path.join(
          stagingRoot,
          `1.00000000-0000-4000-8000-${suffix}.tmp`
        ),
        ''
      );
    })
  );
  await assert.rejects(
    generateBlueprintCandidates(generateOptions(root), {
      worker: validWorker(blueprint => ({ ...blueprint, unexpected: true }))
    }),
    error => {
      assert.equal(error.code, 'INVALID_TEMPLATE_MAP_BLUEPRINT');
      assert.ok(error.secondaryFailures.some(diagnostic =>
        diagnostic.code === 'BLUEPRINT_ATTEMPT_EVIDENCE_LIMIT'
        && /staging orphan accumulation/.test(diagnostic.message)
      ));
      return true;
    }
  );
  assert.equal((await readdir(stagingRoot)).length, 129);
  assert.equal(
    (await readdir(candidateRoot(root))).some(
      name => name.startsWith('.failed-workspace-')
    ),
    true
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
    const historyRoot = path.join(
      path.dirname(candidateRoot(root)),
      '.attempt-history',
      MAP_IDS[0]
    );
    const [attempt] = await readdir(historyRoot);
    const attemptRoot = path.join(historyRoot, attempt);
    assert.equal(
      await readFile(
        path.join(attemptRoot, 'workspace/inputs/sidecar.json'),
        'utf8'
      ),
      '{}\n'
    );
    const manifest = JSON.parse(
      await readFile(path.join(attemptRoot, 'workspace-manifest.json'), 'utf8')
    );
    assert.equal(manifest.noFollow, true);
    assert.equal(
      manifest.entries.find(entry => entry.path === 'inputs/sidecar.json').changed,
      true
    );
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
    const historyRoot = path.join(
      path.dirname(candidateRoot(root)),
      '.attempt-history',
      MAP_IDS[0]
    );
    const [attempt] = await readdir(historyRoot);
    assert.equal(
      await readFile(
        path.join(historyRoot, attempt, 'workspace/surprise.txt'),
        'utf8'
      ),
      'no'
    );
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
    assert.equal(await exists(candidateRoot(root)), true);
    assert.equal(
      (await readdir(candidateRoot(root))).some(
        name => name.startsWith('.failed-workspace-')
      ),
      true
    );
    const historyRoot = path.join(
      path.dirname(candidateRoot(root)),
      '.attempt-history',
      MAP_IDS[0]
    );
    const [attempt] = await readdir(historyRoot);
    const manifest = JSON.parse(
      await readFile(
        path.join(historyRoot, attempt, 'workspace-manifest.json'),
        'utf8'
      )
    );
    const candidateEntry = manifest.entries.find(
      entry => entry.path === 'candidate.json'
    );
    assert.equal(candidateEntry.type, 'symlink');
    assert.equal(candidateEntry.captured, false);
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
  const staleResultBytes = await readFile(metadataPath);
  const staleCandidateBytes = await readFile(
    path.join(candidateRoot(root), 'candidate.json')
  );
  const regenerated = await generateBlueprintCandidates(
    generateOptions(root, { resume: true }),
    { worker }
  );
  assert.notEqual(regenerated.results[0].fullHash, firstHash);
  assert.equal(calls, 2);
  const historyRoot = path.join(
    path.dirname(candidateRoot(root)),
    '.attempt-history',
    MAP_IDS[0]
  );
  const historyEntries = await readdir(historyRoot);
  assert.equal(historyEntries.length, 1);
  const staleAttemptRoot = path.join(historyRoot, historyEntries[0]);
  const staleAttempt = JSON.parse(
    await readFile(path.join(staleAttemptRoot, 'attempt.json'), 'utf8')
  );
  assert.equal(staleAttempt.outcome, 'superseded');
  assert.deepEqual(
    await readFile(path.join(staleAttemptRoot, 'residual/candidate.json')),
    staleCandidateBytes
  );
  assert.deepEqual(
    await readFile(path.join(staleAttemptRoot, 'residual/result.json')),
    staleResultBytes
  );
  const staleReason = JSON.parse(
    await readFile(path.join(staleAttemptRoot, 'error.json'), 'utf8')
  );
  assert.equal(
    staleReason.parentError.code,
    'STALE_BLUEPRINT_CANDIDATE_SUPERSEDED'
  );
  assert.match(staleReason.parentError.message, /prompt-profile pin is stale/);

  await rm(candidateRoot(root), { recursive: true, force: true });
  await mkdir(candidateRoot(root), { recursive: true });
  await writeFile(path.join(candidateRoot(root), 'partial.txt'), 'interrupted');
  await mkdir(
    path.join(candidateRoot(root), '.workspace-orphan/inputs'),
    { recursive: true }
  );
  await writeFile(
    path.join(candidateRoot(root), '.workspace-orphan/inputs/contract.json'),
    'orphan contract\n'
  );
  await writeFile(
    path.join(candidateRoot(root), 'candidate.json.atomic-remnant'),
    'atomic remnant\n'
  );
  await assert.rejects(
    generateBlueprintCandidates(generateOptions(root), { worker }),
    /incomplete or invalid/
  );
  await generateBlueprintCandidates(
    generateOptions(root, { resume: true }),
    { worker }
  );
  assert.equal(await exists(path.join(candidateRoot(root), 'partial.txt')), false);
  const incompleteAttemptRoots = await Promise.all(
    (await readdir(historyRoot)).map(entry => path.join(historyRoot, entry))
  );
  let incompleteAttemptRoot = null;
  for (const attemptRoot of incompleteAttemptRoots) {
    const attemptError = JSON.parse(
      await readFile(path.join(attemptRoot, 'error.json'), 'utf8')
    );
    if (
      attemptError.parentError?.code
      === 'INCOMPLETE_BLUEPRINT_CANDIDATE_SUPERSEDED'
    ) {
      incompleteAttemptRoot = attemptRoot;
      break;
    }
  }
  assert.ok(incompleteAttemptRoot);
  assert.equal(
    await readFile(
      path.join(incompleteAttemptRoot, 'residual/partial.txt'),
      'utf8'
    ),
    'interrupted'
  );
  assert.equal(
    await readFile(
      path.join(
        incompleteAttemptRoot,
        'residual/.workspace-orphan/inputs/contract.json'
      ),
      'utf8'
    ),
    'orphan contract\n'
  );
  assert.equal(
    await readFile(
      path.join(
        incompleteAttemptRoot,
        'residual/candidate.json.atomic-remnant'
      ),
      'utf8'
    ),
    'atomic remnant\n'
  );

  const forced = await generateBlueprintCandidates(
    generateOptions(root, { force: true }),
    { worker }
  );
  assert.equal(forced.results[0].status, 'generated-awaiting-review');
  assert.equal(calls, 4);
});

test('concurrent semantic failure cancels and drains active worker groups', {
  skip: process.platform === 'win32'
}, async t => {
  const root = await createFixture(t, {
    template: V2_TEMPLATE,
    mapIds: V2_MAP_IDS
  });
  const activeReadyPath = path.join(root, 'active-worker-ready.pid');
  const activeWorkerSource = `const fs=require('node:fs');
process.on('SIGTERM',()=>{});
fs.writeFileSync(${JSON.stringify(activeReadyPath)},String(process.pid));
setInterval(()=>{},1000);`;
  const invalidSemanticWorker = validWorker(blueprint => {
    const opponentFormation = blueprint.regions.findIndex(region =>
      region.kind === 'formation-clearing'
      && region.annotations.includes('opponent-formation')
    );
    assert.notEqual(opponentFormation, -1);
    blueprint.regions.splice(opponentFormation, 1);
    return blueprint;
  });
  let cancellationError = null;
  const worker = async parameters => {
    if (parameters.mapId === V2_MAP_IDS[0]) {
      try {
        return await runBlueprintCommand({
          command: process.execPath,
          args: ['-e', activeWorkerSource],
          cwd: parameters.workspace,
          input: '',
          timeoutMs: 10_000,
          signal: parameters.signal
        });
      } catch (error) {
        cancellationError = error;
        throw error;
      }
    }
    if (parameters.mapId === V2_MAP_IDS[2]) {
      await waitForFile(activeReadyPath, 2_000, 'active worker readiness');
      return invalidSemanticWorker(parameters);
    }
    return validWorker()(parameters);
  };
  const generation = generateBlueprintCandidates(
    generateOptions(root, {
      template: V2_TEMPLATE,
      mapIds: V2_MAP_IDS,
      concurrency: 3,
      timeoutMs: 10_000
    }),
    { worker }
  );
  const activeWorkerPid = Number(
    await waitForFile(activeReadyPath, 2_000, 'active worker PID')
  );
  assert.ok(Number.isSafeInteger(activeWorkerPid) && activeWorkerPid > 0);
  t.after(() => {
    if (!processIsAlive(activeWorkerPid)) return;
    try {
      process.kill(-activeWorkerPid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  });
  let generationError = null;
  await assert.rejects(generation, error => {
    generationError = error;
    assert.equal(error.code, 'INVALID_TEMPLATE_MAP_BLUEPRINT');
    assert.match(error.message, /at least two exact formation-clearing regions/);
    return true;
  });
  assert.equal(cancellationError?.code, 'BLUEPRINT_WORKER_CANCELLED');
  assert.equal(cancellationError?.cause, generationError);
  await waitForProcessExit(
    activeWorkerPid,
    2_000,
    'cancelled concurrent worker'
  );
  const replacement = await generateBlueprintCandidates(
    generateOptions(root, {
      template: V2_TEMPLATE,
      mapIds: [V2_MAP_IDS[0]],
      concurrency: 1
    }),
    { worker: validWorker() }
  );
  assert.equal(replacement.results[0].status, 'generated-awaiting-review');
});

test('concurrent pool preserves its first failure and stops queued jobs', async t => {
  const root = await createFixture(t);
  const firstFailure = new Error('second worker failed first');
  firstFailure.code = 'FIRST_CONCURRENT_FAILURE';
  const started = [];
  let activeSiblingDrained = false;
  let slowCleanupObserved = false;
  let markActiveSiblingStarted;
  const activeSiblingStarted = new Promise(resolve => {
    markActiveSiblingStarted = resolve;
  });
  const worker = async ({ mapId, signal }) => {
    started.push(mapId);
    if (mapId === MAP_IDS[0]) {
      markActiveSiblingStarted();
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          activeSiblingDrained = true;
          const error = new Error('active sibling cancelled');
          error.code = 'TEST_ACTIVE_SIBLING_CANCELLED';
          reject(error);
        }, { once: true });
      });
    }
    if (mapId === MAP_IDS[1]) {
      await activeSiblingStarted;
      throw firstFailure;
    }
    assert.fail('a queued job must not start after the first failure');
  };
  await assert.rejects(
    generateBlueprintCandidates(
      generateOptions(root, {
        mapIds: MAP_IDS,
        concurrency: 2
      }),
      {
        worker,
        beforeEvidenceTreeCleanup: async ({ kind }) => {
          if (kind !== 'failed-workspace') return;
          slowCleanupObserved = true;
          assert.equal(activeSiblingDrained, true);
          assert.equal(started.includes(MAP_IDS[2]), false);
          await new Promise(resolve => setTimeout(resolve, 80));
        }
      }
    ),
    error => error === firstFailure
  );
  assert.deepEqual([...started].sort(), MAP_IDS.slice(0, 2).sort());
  assert.equal(activeSiblingDrained, true);
  assert.equal(slowCleanupObserved, true);
});

test('cleanup and lock-release failures remain bounded secondary diagnostics', async t => {
  const root = await createFixture(t);
  const originalFailure = new Error('operational worker failure');
  originalFailure.code = 'ORIGINAL_OPERATIONAL_FAILURE';
  const cleanupFailure = new Error('failure evidence cleanup failed');
  cleanupFailure.code = 'TEST_EVIDENCE_CLEANUP_FAILURE';
  await assert.rejects(
    generateBlueprintCandidates(generateOptions(root), {
      worker: async () => {
        throw originalFailure;
      },
      beforeEvidenceTreeCleanup: async ({ kind }) => {
        if (kind === 'failed-workspace') throw cleanupFailure;
      },
      candidateLockHolderSource: [
        'process.stdout.write("locked\\n");',
        'process.stdin.resume();',
        'process.stdin.on("end",()=>process.exit(7));'
      ].join('')
    }),
    error => {
      assert.equal(error, originalFailure);
      assert.ok(Array.isArray(error.secondaryFailures));
      assert.ok(error.secondaryFailures.length <= 8);
      assert.ok(error.secondaryFailures.some(diagnostic =>
        diagnostic.code === cleanupFailure.code
      ));
      assert.ok(error.secondaryFailures.some(diagnostic =>
        diagnostic.code === 'BLUEPRINT_CANDIDATE_LOCK_FAILED'
      ));
      assert.ok(error.secondaryFailures.every(diagnostic =>
        diagnostic.message.length <= 1_024
      ));
      return true;
    }
  );
});

test('hostile secondaryFailures properties cannot replace the first failure or retain its lock', async t => {
  for (const propertyKind of ['frozen-array', 'throwing-accessor']) {
    await t.test(propertyKind, async t => {
      const root = await createFixture(t);
      const originalFailure = new Error(`primary ${propertyKind} failure`);
      originalFailure.code = 'HOSTILE_SECONDARY_FAILURE_PROPERTY';
      if (propertyKind === 'frozen-array') {
        Object.defineProperty(originalFailure, 'secondaryFailures', {
          enumerable: true,
          value: Object.freeze([])
        });
      } else {
        Object.defineProperty(originalFailure, 'secondaryFailures', {
          get() {
            throw new Error('secondaryFailures accessor must not escape');
          }
        });
      }
      const cleanupFailure = new Error('secondary cleanup failure');
      await assert.rejects(
        generateBlueprintCandidates(generateOptions(root), {
          worker: async () => {
            throw originalFailure;
          },
          beforeEvidenceTreeCleanup: async ({ kind }) => {
            if (kind === 'failed-workspace') throw cleanupFailure;
          }
        }),
        error => error === originalFailure
      );
      const lockPath = path.join(
        path.dirname(candidateRoot(root)),
        '.locks',
        `${MAP_IDS[0]}.lock`
      );
      const reacquired = await acquirePersistentExclusiveLock({ lockPath });
      await releasePersistentExclusiveLock(reacquired);
    });
  }
});

test('sibling failure aborts a worker waiting on an externally held candidate lock', async t => {
  const root = await createFixture(t);
  const lockPath = path.join(
    path.dirname(candidateRoot(root)),
    '.locks',
    `${MAP_IDS[0]}.lock`
  );
  const heldLock = await acquirePersistentExclusiveLock({ lockPath });
  let heldLockReleased = false;
  t.after(async () => {
    if (!heldLockReleased) await releasePersistentExclusiveLock(heldLock);
  });
  const originalFailure = new Error('sibling failed while lock was held');
  originalFailure.code = 'HELD_LOCK_SIBLING_FAILURE';
  const startedWorkers = [];
  await assert.rejects(
    generateBlueprintCandidates(
      generateOptions(root, {
        mapIds: MAP_IDS,
        concurrency: 2
      }),
      {
        worker: async parameters => {
          startedWorkers.push(parameters.mapId);
          if (parameters.mapId === MAP_IDS[1]) throw originalFailure;
          return validWorker()(parameters);
        }
      }
    ),
    error => {
      assert.equal(error, originalFailure);
      assert.ok(error.secondaryFailures.some(diagnostic =>
        diagnostic.code === 'PERSISTENT_LOCK_CANCELLED'
      ));
      return true;
    }
  );
  assert.deepEqual(startedWorkers, [MAP_IDS[1]]);
  await releasePersistentExclusiveLock(heldLock);
  heldLockReleased = true;
  const reacquired = await acquirePersistentExclusiveLock({ lockPath });
  await releasePersistentExclusiveLock(reacquired);
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
  const legacyIndex = JSON.parse(
    await readFile(path.join(approvedRoot(root), 'approvals.json'), 'utf8')
  );
  assert.equal(
    legacyIndex.schemaVersion,
    'battle-map-blueprint-approval-index-v1'
  );
  assert.equal(Object.hasOwn(legacyIndex.entries[0], 'reason'), false);
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
  assert.deepEqual(approval.promptProfile, {
    id: 'map-blueprint-v1',
    path: BLUEPRINT_PROMPT_PATH,
    sha256:
      'sha256:954512d0cce94919913758f5bc23a204becf9f9dd010c7c4724e013d32438795'
  });
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

test('template-03 approvals require rationale and pin it in v2 record and index hashes', async t => {
  const root = await createFixture(t, {
    template: V2_TEMPLATE,
    mapIds: V2_MAP_IDS
  });
  await generateBlueprintCandidates(
    generateOptions(root, {
      template: V2_TEMPLATE,
      mapIds: V2_MAP_IDS,
      concurrency: 2
    }),
    { worker: validWorker() }
  );
  const v2PromptBytes = await readFile(path.join(root, BLUEPRINT_PROMPT_PATH_V2));
  const candidateMetadata = JSON.parse(
    await readFile(
      path.join(candidateRoot(root, V2_MAP_IDS[0], V2_TEMPLATE), 'result.json'),
      'utf8'
    )
  );
  assert.deepEqual(candidateMetadata.promptProfile, {
    id: 'map-blueprint-v2',
    path: BLUEPRINT_PROMPT_PATH_V2,
    sha256: sha256Bytes(v2PromptBytes)
  });
  const baseApproval = {
    projectRoot: root,
    theme: THEME,
    template: V2_TEMPLATE,
    reviewer: 'reviewer-1',
    decision: 'approved',
    force: false,
    updatePins: false
  };
  await assert.rejects(
    approveBlueprintCandidate({
      ...baseApproval,
      mapId: V2_MAP_IDS[0]
    }),
    /reason/
  );

  const reasons = [
    'Approved route choices and lower formation clearance.',
    'Approved alternate approach and landmark readability.',
    'Approved elevation transitions and opponent formation access.'
  ];
  for (let index = 0; index < V2_MAP_IDS.length; index += 1) {
    await approveBlueprintCandidate({
      ...baseApproval,
      mapId: V2_MAP_IDS[index],
      reason: reasons[index],
      updatePins: index === V2_MAP_IDS.length - 1
    });
  }

  const v2Root = approvedRoot(root, V2_TEMPLATE);
  const approval = JSON.parse(
    await readFile(path.join(v2Root, `${V2_MAP_IDS[0]}.approval.json`), 'utf8')
  );
  assert.equal(approval.schemaVersion, 'battle-map-blueprint-approval-v2');
  assert.equal(approval.reason, reasons[0]);
  assert.deepEqual(approval.promptProfile, candidateMetadata.promptProfile);
  assert.match(approval.fullHash, /^sha256:[0-9a-f]{64}$/);

  const indexPath = path.join(v2Root, 'approvals.json');
  const index = JSON.parse(await readFile(indexPath, 'utf8'));
  assert.equal(index.schemaVersion, 'battle-map-blueprint-approval-index-v2');
  assert.deepEqual(index.entries.map(entry => entry.reason), reasons);
  assert.deepEqual(
    index.entries.map(entry => entry.promptProfileSha256),
    V2_MAP_IDS.map(() => sha256Bytes(v2PromptBytes))
  );
  assert.equal(index.entries[0].approvalFullHash, approval.fullHash);
  assert.equal(
    (await verifyApprovedBlueprints({
      projectRoot: root,
      theme: THEME,
      template: V2_TEMPLATE
    })).ok,
    true
  );

  const changedReasonIndex = structuredClone(index);
  changedReasonIndex.entries[0].reason = 'A different bounded rationale.';
  assert.notEqual(
    BlueprintLifecycleInternals.finalizeApprovalIndex(changedReasonIndex).fullHash,
    index.fullHash
  );

  approval.reason = 'Changed after the approval hash was recorded.';
  await writeFile(
    path.join(v2Root, `${V2_MAP_IDS[0]}.approval.json`),
    `${JSON.stringify(approval, null, 2)}\n`
  );
  const tampered = await verifyApprovedBlueprints({
    projectRoot: root,
    theme: THEME,
    template: V2_TEMPLATE
  });
  assert.equal(tampered.ok, false);
  assert.match(tampered.results[0].error, /full hash mismatch/);
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
