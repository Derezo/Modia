#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertTemplateMapBlueprint,
  compileTemplateMapBlueprint,
  computeTemplateMapAssetBundleManifestFullHash,
  computeTemplateMapBlueprintFullHash,
  computeTemplateMapSourceSidecarFullHash,
  computeTemplateMapTileCatalogFullHash,
  TEMPLATE_MAP_COMPILER_VERSION,
  validateTemplateMapBlueprint
} from '../../shared/battleMap/v3/index.js';
import { parseJsonRejectDuplicateKeys } from '../../shared/battleMap/canonicalJson.js';
import {
  assertSafeWritePath,
  inspectImage,
  loadTemplateSidecar,
  resolveWithinProject,
  sha256Bytes,
  stableJson,
  withSourceTemplateLifecycleLock
} from './source-template-lifecycle.mjs';
import {
  acquirePersistentExclusiveLock
} from './persistent-exclusive-lock.mjs';
import {
  auditCodexWorkerJsonl,
  buildCodexWorkerEnvironment,
  CODEX_WORKER_ENV_KEYS
} from './codex-worker-boundary.mjs';

export {
  buildCodexWorkerEnvironment,
  CODEX_WORKER_ENV_KEYS
};

export const BLUEPRINT_PROMPT_PATH =
  'ai-image-metadata/battle-maps/prompts/map-blueprint-v1.json';
export const BLUEPRINT_PROMPT_SCHEMA =
  'battle-map-blueprint-prompt-profile-v1';
export const BLUEPRINT_CANDIDATE_SCHEMA =
  'battle-map-blueprint-candidate-record-v1';
export const BLUEPRINT_APPROVAL_SCHEMA =
  'battle-map-blueprint-approval-index-v1';
export const DEFAULT_BLUEPRINT_CONCURRENCY = 2;
export const MAX_BLUEPRINT_CONCURRENCY = 4;
export const DEFAULT_BLUEPRINT_TIMEOUT_MS = 600_000;
export const MAX_BLUEPRINT_TIMEOUT_MS = 1_800_000;
export const DEFAULT_BLUEPRINT_COMPLETION_GRACE_MS = 2_000;
export const DEFAULT_BLUEPRINT_COMPLETION_POLL_MS = 100;
export const MAX_BLUEPRINT_BYTES = 2 * 1024 * 1024;
export const MAX_WORKER_LOG_BYTES = 4 * 1024 * 1024;
export const MAX_WORKSPACE_BYTES = 40 * 1024 * 1024;

const SCRIPT_PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const ID_PATTERN = /^[a-z0-9]+(?:[-_:][a-z0-9]+)*$/;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const ALLOWED_OUTPUTS = new Set(['candidate.json', 'last-message.txt']);
const INPUT_PATHS = new Set([
  'inputs/reference.png',
  'inputs/reference.webp',
  'inputs/sidecar.json',
  'inputs/contract.json'
]);
const CANDIDATE_LOCK_HOLDER_SOURCE = [
  'process.stdout.write("locked\\n");',
  'process.stdin.resume();',
  'process.stdin.on("end", () => process.exit(0));'
].join('');
const PROTECTED_GENERATION_PATHS = Object.freeze([
  'ai-image-metadata/battle-maps/prompts',
  'ai-image-metadata/battle-maps/templates',
  'ai-image-metadata/battle-maps/blueprints',
  'ai-image-metadata/battle-maps/catalog',
  'ai-image-metadata/battle-maps/compiled',
  'battle-maps/catalog',
  'battle-maps/compiled',
  'shared/battleMap/v3/runtimeCatalog.js',
  'frontend/public/assets/battle-maps'
]);

function fail(message, code = 'BATTLE_MAP_BLUEPRINT_LIFECYCLE_ERROR') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function plainObject(value, label) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || (
      Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null
    )
  ) fail(`${label} must be a plain object`);
}

function exactKeys(value, keys, label) {
  plainObject(value, label);
  const allowed = new Set(keys);
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) fail(`${label}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label}.${key} is not allowed`);
  }
}

function safeId(value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    fail(`${label} must be a lowercase safe ID`);
  }
  return value;
}

function sha256(value, label) {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    fail(`${label} must be a lowercase SHA-256 pin`);
  }
  return value;
}

async function readRegularCandidateSnapshot(candidatePath) {
  let pathBefore;
  try {
    pathBefore = await lstat(candidatePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (pathBefore.isSymbolicLink() || !pathBefore.isFile()) {
    const error = new Error('candidate.json must be a regular non-symlink file');
    error.code = 'INVALID_BLUEPRINT_CANDIDATE_OUTPUT';
    throw error;
  }

  let handle;
  try {
    handle = await open(
      candidatePath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
    );
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error.code === 'ELOOP') {
      const invalid = new Error('candidate.json must be a regular non-symlink file');
      invalid.code = 'INVALID_BLUEPRINT_CANDIDATE_OUTPUT';
      throw invalid;
    }
    throw error;
  }

  try {
    const openedBefore = await handle.stat();
    if (!openedBefore.isFile()) {
      const error = new Error('candidate.json must be a regular non-symlink file');
      error.code = 'INVALID_BLUEPRINT_CANDIDATE_OUTPUT';
      throw error;
    }
    if (
      openedBefore.dev !== pathBefore.dev
      || openedBefore.ino !== pathBefore.ino
    ) return null;

    const bytes = await handle.readFile();
    const [openedAfter, pathAfter] = await Promise.all([
      handle.stat(),
      lstat(candidatePath).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      })
    ]);
    if (!pathAfter) return null;
    if (pathAfter.isSymbolicLink() || !pathAfter.isFile()) {
      const error = new Error('candidate.json must be a regular non-symlink file');
      error.code = 'INVALID_BLUEPRINT_CANDIDATE_OUTPUT';
      throw error;
    }
    if (
      openedAfter.dev !== openedBefore.dev
      || openedAfter.ino !== openedBefore.ino
      || openedAfter.size !== openedBefore.size
      || openedAfter.mtimeMs !== openedBefore.mtimeMs
      || pathAfter.dev !== openedBefore.dev
      || pathAfter.ino !== openedBefore.ino
      || pathAfter.size !== openedBefore.size
      || pathAfter.mtimeMs !== openedBefore.mtimeMs
      || bytes.byteLength !== openedBefore.size
    ) return null;
    return { bytes, details: pathAfter };
  } finally {
    await handle.close();
  }
}

function readValue(argv, index, flag, inline) {
  if (inline !== undefined) {
    if (inline.length === 0) fail(`${flag} requires a value`);
    return { value: inline, consumed: 0 };
  }
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) fail(`${flag} requires a value`);
  return { value, consumed: 1 };
}

function positiveInteger(value, flag, maximum) {
  if (!/^[1-9][0-9]*$/.test(value)) fail(`${flag} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    fail(`${flag} must be an integer from 1 through ${maximum}`);
  }
  return parsed;
}

function parseStrictJsonBytes(bytes, label) {
  if (
    bytes.byteLength >= 3
    && bytes[0] === 0xef
    && bytes[1] === 0xbb
    && bytes[2] === 0xbf
  ) fail(`${label} must not contain a UTF-8 byte-order mark`);
  let source;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    fail(`${label} is not valid UTF-8: ${error.message}`);
  }
  try {
    return parseJsonRejectDuplicateKeys(source);
  } catch (error) {
    fail(`${label} is not strict JSON: ${error.message}`);
  }
}

async function pathExists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function releaseCandidateGenerationLock(lock) {
  try {
    if (lock.getHolderResult()) {
      fail(
        `candidate generation lock holder exited before release for ${lock.mapId}`,
        'BLUEPRINT_CANDIDATE_LOCK_FAILED'
      );
    }
    if (!lock.child.stdin.destroyed) lock.child.stdin.end();
    const result = await lock.holderCompletion;
    if (result.error || result.code !== 0) {
      fail(
        `candidate generation lock holder exited with `
          + `${result.error?.message ?? result.signal ?? `code ${result.code}`} `
          + `for ${lock.mapId}`,
        'BLUEPRINT_CANDIDATE_LOCK_FAILED'
      );
    }
    const [opened, current] = await Promise.all([
      lock.handle.stat(),
      lstat(lock.path).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      })
    ]);
    if (
      !current
      || current.isSymbolicLink()
      || !current.isFile()
      || current.dev !== lock.details.dev
      || current.ino !== lock.details.ino
      || opened.dev !== lock.details.dev
      || opened.ino !== lock.details.ino
    ) {
      fail(
        `candidate generation lock pathname changed for ${lock.mapId}`,
        'BLUEPRINT_CANDIDATE_LOCK_OWNERSHIP_CHANGED'
      );
    }
  } finally {
    await lock.handle.close();
  }
}

async function acquireCandidateGenerationLock({
  projectRoot,
  theme,
  template,
  mapId,
  holderSource = CANDIDATE_LOCK_HOLDER_SOURCE
}) {
  const candidateParent = path.dirname(candidatePaths(theme, template, mapId).root);
  const lockRoot = resolveWithinProject(
    projectRoot,
    `${candidateParent}/.locks`,
    'candidate generation lock directory'
  );
  await assertSafeWritePath(
    projectRoot,
    lockRoot,
    'candidate generation lock directory'
  );
  await mkdir(lockRoot, { recursive: true });
  await assertSafeWritePath(
    projectRoot,
    lockRoot,
    'candidate generation lock directory'
  );
  const lockPath = path.join(lockRoot, `${mapId}.lock`);
  await assertSafeWritePath(
    projectRoot,
    lockPath,
    'candidate generation lock path'
  );
  const lock = await acquirePersistentExclusiveLock({
    lockPath,
    label: `candidate generation lock for ${mapId}`,
    assertSafePath: candidateLockPath => assertSafeWritePath(
      projectRoot,
      candidateLockPath,
      'candidate generation lock path'
    ),
    holderSource
  });
  return {
    ...lock,
    path: lockPath,
    mapId,
    release() {
      return releaseCandidateGenerationLock(this);
    }
  };
}

export function parseBlueprintGenerateArgs(argv = process.argv.slice(2)) {
  const options = {
    maps: null,
    mapIds: [],
    concurrency: DEFAULT_BLUEPRINT_CONCURRENCY,
    timeoutMs: DEFAULT_BLUEPRINT_TIMEOUT_MS,
    dryRun: false,
    force: false,
    resume: false,
    textTemplateFallback: false,
    json: false,
    help: false
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const equals = argument.indexOf('=');
    const flag = equals === -1 ? argument : argument.slice(0, equals);
    const inline = equals === -1 ? undefined : argument.slice(equals + 1);
    const valueFor = () => {
      const result = readValue(argv, index, flag, inline);
      index += result.consumed;
      return result.value;
    };
    const once = (key, value) => {
      if (seen.has(flag)) fail(`${flag} may only be supplied once`);
      seen.add(flag);
      options[key] = value;
    };
    if (flag === '--theme') once('theme', valueFor());
    else if (flag === '--template') once('template', valueFor());
    else if (flag === '--map') options.mapIds.push(valueFor());
    else if (flag === '--maps') once('maps', positiveInteger(valueFor(), flag, 3));
    else if (flag === '--concurrency') {
      once('concurrency', positiveInteger(valueFor(), flag, MAX_BLUEPRINT_CONCURRENCY));
    } else if (flag === '--timeout') {
      once(
        'timeoutMs',
        positiveInteger(valueFor(), flag, MAX_BLUEPRINT_TIMEOUT_MS / 1000) * 1000
      );
    } else if (flag === '--project-root') once('projectRoot', path.resolve(valueFor()));
    else if (flag === '--dry-run' && inline === undefined) once('dryRun', true);
    else if (flag === '--force' && inline === undefined) once('force', true);
    else if (flag === '--resume' && inline === undefined) once('resume', true);
    else if (flag === '--text-template-fallback' && inline === undefined) {
      once('textTemplateFallback', true);
    }
    else if (flag === '--json' && inline === undefined) once('json', true);
    else if ((flag === '--help' || flag === '-h') && inline === undefined) {
      once('help', true);
    }
    else fail(`Unknown argument: ${argument}`);
  }
  if (options.help) return options;
  safeId(options.theme, '--theme');
  safeId(options.template, '--template');
  if (options.maps !== null && options.mapIds.length > 0) {
    fail('--maps and --map are mutually exclusive');
  }
  if (options.force && options.resume) fail('--force and --resume are mutually exclusive');
  if (new Set(options.mapIds).size !== options.mapIds.length) {
    fail('--map values must be unique');
  }
  options.mapIds.forEach(value => safeId(value, '--map'));
  return options;
}

export function parseBlueprintActionArgs(argv = process.argv.slice(2), {
  allowAll = false,
  requireReviewer = false,
  allowDecision = false,
  allowForce = false,
  allowUpdatePins = false
} = {}) {
  const options = {
    all: false,
    updatePins: false,
    force: false,
    json: false,
    help: false,
    decision: 'approved'
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const equals = argument.indexOf('=');
    const flag = equals === -1 ? argument : argument.slice(0, equals);
    const inline = equals === -1 ? undefined : argument.slice(equals + 1);
    const valueFor = () => {
      const result = readValue(argv, index, flag, inline);
      index += result.consumed;
      return result.value;
    };
    const once = (key, value) => {
      if (seen.has(flag)) fail(`${flag} may only be supplied once`);
      seen.add(flag);
      options[key] = value;
    };
    if (flag === '--theme') once('theme', valueFor());
    else if (flag === '--template') once('template', valueFor());
    else if (flag === '--map') once('mapId', valueFor());
    else if (flag === '--reviewer') once('reviewer', valueFor());
    else if (flag === '--decision' && allowDecision) once('decision', valueFor());
    else if (flag === '--project-root') once('projectRoot', path.resolve(valueFor()));
    else if (flag === '--all' && inline === undefined && allowAll) once('all', true);
    else if (flag === '--update-pins' && inline === undefined && allowUpdatePins) {
      once('updatePins', true);
    } else if (flag === '--force' && inline === undefined && allowForce) {
      once('force', true);
    } else if (flag === '--json' && inline === undefined) once('json', true);
    else if ((flag === '--help' || flag === '-h') && inline === undefined) {
      once('help', true);
    }
    else fail(`Unknown argument: ${argument}`);
  }
  if (options.help) return options;
  safeId(options.theme, '--theme');
  safeId(options.template, '--template');
  if (!options.all) safeId(options.mapId, '--map');
  if (options.all && options.mapId) fail('--all and --map are mutually exclusive');
  if (requireReviewer) safeId(options.reviewer, '--reviewer');
  if (!['approved', 'rejected'].includes(options.decision)) {
    fail('--decision must be approved or rejected');
  }
  return options;
}

async function readJson(filePath, label) {
  let source;
  try {
    source = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') fail(`${label} does not exist: ${filePath}`);
    throw error;
  }
  try {
    return { value: parseJsonRejectDuplicateKeys(source), source };
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

async function atomicWrite(projectRoot, filePath, contents) {
  await assertSafeWritePath(projectRoot, filePath, 'blueprint write path');
  await mkdir(path.dirname(filePath), { recursive: true });
  await assertSafeWritePath(projectRoot, filePath, 'blueprint write path');
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, 'wx', 0o600);
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, filePath);
}

async function atomicCopy(projectRoot, sourcePath, destinationPath) {
  await assertSafeWritePath(projectRoot, destinationPath, 'blueprint promotion path');
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await assertSafeWritePath(projectRoot, destinationPath, 'blueprint promotion path');
  const temporaryPath = `${destinationPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await copyFile(sourcePath, temporaryPath);
    await rename(temporaryPath, destinationPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function loadBlueprintPrompt(projectRoot) {
  const absolutePath = resolveWithinProject(
    projectRoot,
    BLUEPRINT_PROMPT_PATH,
    'blueprint prompt path'
  );
  await assertSafeWritePath(projectRoot, absolutePath, 'blueprint prompt read path');
  const { value, source } = await readJson(absolutePath, 'blueprint prompt profile');
  exactKeys(value, [
    'schemaVersion',
    'id',
    'purpose',
    'frozen',
    'variantBriefs',
    'prompt',
    'negativeConstraints'
  ], 'blueprint prompt profile');
  if (
    value.schemaVersion !== BLUEPRINT_PROMPT_SCHEMA
    || value.id !== 'map-blueprint-v1'
    || value.frozen !== true
  ) fail('blueprint prompt profile is not the frozen supported profile');
  plainObject(value.variantBriefs, 'blueprint prompt profile.variantBriefs');
  exactKeys(value.variantBriefs, ['a', 'b', 'c'], 'blueprint prompt profile.variantBriefs');
  for (const key of ['a', 'b', 'c']) {
    if (typeof value.variantBriefs[key] !== 'string' || value.variantBriefs[key].length === 0) {
      fail(`blueprint prompt profile.variantBriefs.${key} is required`);
    }
  }
  if (typeof value.prompt !== 'string' || value.prompt.length === 0) {
    fail('blueprint prompt profile.prompt must be non-empty');
  }
  if (
    !Array.isArray(value.negativeConstraints)
    || value.negativeConstraints.some(item => typeof item !== 'string' || item.length === 0)
  ) fail('blueprint prompt profile.negativeConstraints must contain strings');
  return {
    profile: value,
    reference: {
      id: value.id,
      path: BLUEPRINT_PROMPT_PATH,
      sha256: sha256Bytes(Buffer.from(source))
    }
  };
}

function point(x, y) {
  return { x, y };
}

/**
 * A complete, structurally valid example is attached to every isolated worker.
 * It is a shape/scale example, not approved content. The worker must still
 * author a distinct interpretation of the reviewed sidecar and image.
 */
export function createBlueprintContractExample(sidecar, mapId) {
  const width = sidecar.mapProfile.width;
  const height = sidecar.mapProfile.height;
  const rendered = (x, y) => {
    const nx = (x - (width - 1) / 2) / (width * 0.51);
    const ny = (y - (height - 1) / 2) / (height * 0.51);
    return nx * nx + ny * ny <= 1;
  };
  const playable = (x, y) => (
    rendered(x, y)
    && x >= 2
    && y >= 2
    && x < width - 2
    && y < height - 2
  );
  const renderMask = Array.from(
    { length: height },
    (_, y) => Array.from({ length: width }, (_, x) => rendered(x, y))
  );
  const playableMask = Array.from(
    { length: height },
    (_, y) => Array.from({ length: width }, (_, x) => playable(x, y))
  );
  const regionFor = (x, y) => {
    if (y >= 22) return 'lower-clearing';
    if (y <= 12 && x >= 8 && x <= 23) return 'upper-lookout';
    if (x <= 14) return 'lateral-clearing';
    return 'central-route-junction';
  };
  const surfaceGrid = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => (
      renderMask[y][x]
        ? { material: 'ground', featureId: regionFor(x, y) }
        : null
    ))
  );
  const elevationAt = (x, y) => {
    const outerTerrace =
      ((x - 15.5) / 14) ** 2 + ((y - 14) / 10) ** 2 <= 1;
    const upperLookout =
      ((x - 15.5) / 8) ** 2 + ((y - 9) / 4) ** 2 <= 1;
    if (upperLookout) return 2;
    if (outerTerrace) return 1;
    return 0;
  };
  const elevation = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => (
      renderMask[y][x] ? elevationAt(x, y) : null
    ))
  );
  const routeCellsThrough = waypoints => {
    const cells = [point(waypoints[0].x, waypoints[0].y)];
    for (let index = 1; index < waypoints.length; index += 1) {
      const target = waypoints[index];
      const cursor = { ...cells.at(-1) };
      const horizontalFirst = index % 2 === 0;
      const moveHorizontal = () => {
        while (cursor.x !== target.x) {
          cursor.x += Math.sign(target.x - cursor.x);
          cells.push(point(cursor.x, cursor.y));
        }
      };
      const moveVertical = () => {
        while (cursor.y !== target.y) {
          cursor.y += Math.sign(target.y - cursor.y);
          cells.push(point(cursor.x, cursor.y));
        }
      };
      if (horizontalFirst) {
        moveHorizontal();
        moveVertical();
      } else {
        moveVertical();
        moveHorizontal();
      }
    }
    return cells;
  };
  const routeRecords = [
    {
      id: 'route:west',
      waypoints: [
        point(9, 27),
        point(9, 24),
        point(12, 22),
        point(11, 18),
        point(8, 16),
        point(10, 12),
        point(13, 10),
        point(13, 3)
      ]
    },
    {
      id: 'route:east',
      waypoints: [
        point(22, 27),
        point(22, 24),
        point(19, 22),
        point(20, 19),
        point(23, 17),
        point(21, 13),
        point(18, 11),
        point(19, 3)
      ]
    }
  ].map(record => ({
    id: record.id,
    kind: 'primary',
    material: 'ground',
    cells: routeCellsThrough(record.waypoints),
    required: true,
    width: 2,
    featureId: 'feature:routes',
    assetFamily: 'path'
  }));
  const edgeKey = (left, right) => [
    `${left.x},${left.y}`,
    `${right.x},${right.y}`
  ].sort().join('~');
  // A terrace edge is a real barrier unless the authored route explicitly
  // crosses it. Earlier examples emitted a "slope" for every adjacent height
  // change, which produced a ragged ring of tiny ramps around each terrace.
  const connectionsByEdge = new Map();
  let crossingIndex = 0;
  for (const routeRecord of routeRecords) {
    for (let index = 1; index < routeRecord.cells.length; index += 1) {
      const from = routeRecord.cells[index - 1];
      const to = routeRecord.cells[index];
      if (elevation[from.y][from.x] === elevation[to.y][to.x]) continue;
      const key = edgeKey(from, to);
      if (connectionsByEdge.has(key)) continue;
      const kind = crossingIndex % 3 === 1 ? 'slope' : 'stairs';
      connectionsByEdge.set(key, {
        id: `connection:${from.x}:${from.y}:${to.x}:${to.y}`,
        from,
        to,
        kind,
        traversable: true,
        bidirectional: true,
        featureId: 'feature:terraces',
        assetFamily: kind
      });
      crossingIndex += 1;
    }
  }
  const connections = [...connectionsByEdge.values()];
  const boundaries = [];
  const steps = [
    ['n', 0, -1],
    ['e', 1, 0],
    ['s', 0, 1],
    ['w', -1, 0]
  ];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!renderMask[y][x]) continue;
      const edges = steps
        .filter(([, dx, dy]) => !renderMask[y + dy]?.[x + dx])
        .map(([direction]) => ({ cell: point(x, y), direction }));
      if (edges.length > 0) {
        boundaries.push({
          id: `boundary:${x}:${y}`,
          kind: 'biome-edge',
          edges,
          featureId: 'feature:boundary',
          sceneOnly: !playableMask[y][x],
          assetFamily: 'forest-edge'
        });
      }
    }
  }
  const roles = sidecar.spawnIntent.candidateRoles;
  const candidateCells = [];
  for (const x of [21, 24, 27]) {
    for (const y of [4, 7, 10, 13, 16, 19, 22, 25]) {
      if (candidateCells.length < sidecar.mapProfile.candidatePoolSize) {
        candidateCells.push(point(x, y));
      }
    }
  }
  if (candidateCells.length !== sidecar.mapProfile.candidatePoolSize) {
    fail('contract example supports exactly the approved 24-cell opponent pool');
  }
  const opponentCandidates = candidateCells.map((cell, index) => ({
    id: `opponent:${String(index + 1).padStart(2, '0')}`,
    cell,
    tags: [...new Set([
      roles[index % roles.length],
      index < 8 ? 'frontline' : 'reserve'
    ])],
    zoneId: 'opponent-zone',
    minimumClearance: sidecar.spawnIntent.localClearanceTiles,
    tacticalAnnotationIds: []
  }));
  const playerCells = [
    point(5, 25),
    point(7, 24),
    point(7, 26),
    point(9, 23),
    point(9, 27)
  ];
  const playerSlots = playerCells.map((cell, index) => ({
    id: `player:${index + 1}`,
    cell,
    role: index === 0 ? 'frontline' : 'formation',
    tags: ['player']
  }));
  return {
    schemaVersion: 1,
    candidateId: mapId,
    templateId: sidecar.id,
    dimensions: { width, height },
    renderMask,
    playableMask,
    surfaceGrid,
    elevation,
    regions: [
      {
        id: 'lower-clearing',
        kind: 'formation-clearing',
        cells: [point(5, 25), point(10, 24), point(15, 25)],
        annotations: ['player-formation']
      },
      {
        id: 'upper-lookout',
        kind: 'elevated-clearing',
        cells: [point(10, 6), point(16, 5), point(22, 7)],
        annotations: ['high-ground']
      },
      {
        id: 'lateral-clearing',
        kind: 'flank-clearing',
        cells: [point(7, 15), point(10, 17)],
        annotations: ['flank']
      },
      {
        id: 'central-route-junction',
        kind: 'route-junction',
        cells: [point(16, 15), point(18, 16)],
        annotations: ['junction']
      }
    ],
    features: [
      {
        id: 'feature:terraces',
        kind: 'terraces',
        cells: [
          point(7, 14),
          point(10, 8),
          point(15, 5),
          point(23, 12),
          point(24, 18)
        ],
        ownerFeatureId: 'central-route-junction',
        annotations: ['organic-contours', 'elevation']
      },
      {
        id: 'feature:routes',
        kind: 'route-network',
        cells: routeRecords.flatMap(record => record.cells),
        ownerFeatureId: 'central-route-junction',
        annotations: ['two-curved-approaches']
      },
      {
        id: 'feature:boundary',
        kind: 'biome-boundary',
        cells: [point(1, 15), point(30, 15)],
        ownerFeatureId: null,
        annotations: ['organic']
      }
    ],
    routes: routeRecords,
    connections,
    obstacles: [
      {
        id: 'obstacle:west-tree-cluster',
        kind: 'tree-cluster',
        cells: [point(2, 15)],
        featureId: 'feature:boundary',
        anchor: point(2, 15),
        occlusionBounds: { minX: 1, minY: 13, maxX: 3, maxY: 16 },
        assetFamily: 'ironpine'
      },
      {
        id: 'obstacle:east-root-cluster',
        kind: 'root-cluster',
        cells: [point(29, 15)],
        featureId: 'feature:boundary',
        anchor: point(29, 15),
        occlusionBounds: { minX: 28, minY: 13, maxX: 30, maxY: 16 },
        assetFamily: 'moss-boulder'
      },
      {
        id: 'obstacle:upper-west-tree',
        kind: 'tree-cluster',
        cells: [point(6, 9)],
        featureId: 'upper-lookout',
        anchor: point(6, 9),
        occlusionBounds: { minX: 5, minY: 7, maxX: 7, maxY: 10 },
        assetFamily: 'pale-birch'
      },
      {
        id: 'obstacle:upper-east-root',
        kind: 'root-cluster',
        cells: [point(16, 7)],
        featureId: 'upper-lookout',
        anchor: point(16, 7),
        occlusionBounds: { minX: 15, minY: 5, maxX: 17, maxY: 8 },
        assetFamily: 'ancient-tree'
      },
      {
        id: 'obstacle:lateral-west-tree',
        kind: 'tree-cluster',
        cells: [point(5, 18)],
        featureId: 'lateral-clearing',
        anchor: point(5, 18),
        occlusionBounds: { minX: 4, minY: 16, maxX: 6, maxY: 19 },
        assetFamily: 'ironpine'
      },
      {
        id: 'obstacle:central-root',
        kind: 'root-cluster',
        cells: [point(16, 18)],
        featureId: 'central-route-junction',
        anchor: point(16, 18),
        occlusionBounds: { minX: 15, minY: 16, maxX: 17, maxY: 19 },
        assetFamily: 'moss-boulder'
      },
      {
        id: 'obstacle:lower-west-tree',
        kind: 'tree-cluster',
        cells: [point(4, 23)],
        featureId: 'lower-clearing',
        anchor: point(4, 23),
        occlusionBounds: { minX: 3, minY: 21, maxX: 5, maxY: 24 },
        assetFamily: 'pale-birch'
      },
      {
        id: 'obstacle:lower-east-root',
        kind: 'root-cluster',
        cells: [point(17, 24)],
        featureId: 'lower-clearing',
        anchor: point(17, 24),
        occlusionBounds: { minX: 16, minY: 22, maxX: 18, maxY: 25 },
        assetFamily: 'ancient-tree'
      },
      {
        id: 'obstacle:west-edge-ironpine',
        kind: 'ironpine-tree',
        cells: [point(3, 19)],
        featureId: 'feature:boundary',
        anchor: point(3, 19),
        occlusionBounds: { minX: 2, minY: 17, maxX: 4, maxY: 20 },
        assetFamily: 'ironpine'
      },
      {
        id: 'obstacle:upper-birch',
        kind: 'pale-birch-tree',
        cells: [point(11, 7)],
        featureId: 'upper-lookout',
        anchor: point(11, 7),
        occlusionBounds: { minX: 10, minY: 5, maxX: 12, maxY: 8 },
        assetFamily: 'pale-birch'
      },
      {
        id: 'obstacle:upper-east-ironpine',
        kind: 'ironpine-tree',
        cells: [point(26, 8)],
        featureId: 'feature:boundary',
        anchor: point(26, 8),
        occlusionBounds: { minX: 25, minY: 6, maxX: 27, maxY: 9 },
        assetFamily: 'ironpine'
      },
      {
        id: 'obstacle:lateral-boulder',
        kind: 'moss-boulder',
        cells: [point(7, 14)],
        featureId: 'lateral-clearing',
        anchor: point(7, 14),
        occlusionBounds: { minX: 6, minY: 13, maxX: 8, maxY: 15 },
        assetFamily: 'moss-boulder'
      },
      {
        id: 'obstacle:east-birch',
        kind: 'pale-birch-tree',
        cells: [point(26, 20)],
        featureId: 'central-route-junction',
        anchor: point(26, 20),
        occlusionBounds: { minX: 25, minY: 18, maxX: 27, maxY: 21 },
        assetFamily: 'pale-birch'
      },
      {
        id: 'obstacle:lower-ancient-tree',
        kind: 'ancient-tree',
        cells: [point(13, 23)],
        featureId: 'lower-clearing',
        anchor: point(13, 23),
        occlusionBounds: { minX: 12, minY: 21, maxX: 14, maxY: 24 },
        assetFamily: 'ancient-tree'
      }
    ],
    decorations: [
      {
        id: 'decoration:west-accent',
        kind: 'biome-accent',
        cell: point(6, 11),
        featureId: 'lateral-clearing',
        anchor: 'tile',
        assetFamily: 'fallen-branch'
      },
      {
        id: 'decoration:east-accent',
        kind: 'biome-accent',
        cell: point(25, 18),
        featureId: 'central-route-junction',
        anchor: 'tile',
        assetFamily: 'low-shrub'
      },
      {
        id: 'decoration:upper-west-accent',
        kind: 'biome-accent',
        cell: point(8, 7),
        featureId: 'upper-lookout',
        anchor: 'tile',
        assetFamily: 'accent'
      },
      {
        id: 'decoration:upper-center-accent',
        kind: 'biome-accent',
        cell: point(15, 11),
        featureId: 'upper-lookout',
        anchor: 'tile',
        assetFamily: 'fallen-branch'
      },
      {
        id: 'decoration:upper-east-accent',
        kind: 'biome-accent',
        cell: point(24, 10),
        featureId: 'upper-lookout',
        anchor: 'tile',
        assetFamily: 'low-shrub'
      },
      {
        id: 'decoration:lateral-north-accent',
        kind: 'biome-accent',
        cell: point(5, 13),
        featureId: 'lateral-clearing',
        anchor: 'tile',
        assetFamily: 'accent'
      },
      {
        id: 'decoration:lateral-south-accent',
        kind: 'biome-accent',
        cell: point(8, 20),
        featureId: 'lateral-clearing',
        anchor: 'tile',
        assetFamily: 'fallen-branch'
      },
      {
        id: 'decoration:junction-north-accent',
        kind: 'biome-accent',
        cell: point(17, 14),
        featureId: 'central-route-junction',
        anchor: 'tile',
        assetFamily: 'low-shrub'
      },
      {
        id: 'decoration:junction-east-accent',
        kind: 'biome-accent',
        cell: point(25, 17),
        featureId: 'central-route-junction',
        anchor: 'tile',
        assetFamily: 'accent'
      },
      {
        id: 'decoration:lower-west-accent',
        kind: 'biome-accent',
        cell: point(6, 24),
        featureId: 'lower-clearing',
        anchor: 'tile',
        assetFamily: 'fallen-branch'
      },
      {
        id: 'decoration:lower-center-accent',
        kind: 'biome-accent',
        cell: point(14, 25),
        featureId: 'lower-clearing',
        anchor: 'tile',
        assetFamily: 'low-shrub'
      },
      {
        id: 'decoration:lower-east-accent',
        kind: 'biome-accent',
        cell: point(24, 24),
        featureId: 'lower-clearing',
        anchor: 'tile',
        assetFamily: 'accent'
      },
      {
        id: 'decoration:upper-ridge-branch',
        kind: 'biome-accent',
        cell: point(11, 3),
        featureId: 'upper-lookout',
        anchor: 'tile',
        assetFamily: 'fallen-branch'
      },
      {
        id: 'decoration:upper-ridge-shrub',
        kind: 'biome-accent',
        cell: point(20, 4),
        featureId: 'upper-lookout',
        anchor: 'tile',
        assetFamily: 'low-shrub'
      },
      {
        id: 'decoration:west-edge-accent',
        kind: 'biome-accent',
        cell: point(3, 9),
        featureId: 'lateral-clearing',
        anchor: 'tile',
        assetFamily: 'accent'
      },
      {
        id: 'decoration:east-edge-branch',
        kind: 'biome-accent',
        cell: point(27, 12),
        featureId: 'central-route-junction',
        anchor: 'tile',
        assetFamily: 'fallen-branch'
      },
      {
        id: 'decoration:central-shrub',
        kind: 'biome-accent',
        cell: point(13, 16),
        featureId: 'central-route-junction',
        anchor: 'tile',
        assetFamily: 'low-shrub'
      },
      {
        id: 'decoration:lower-east-accent-secondary',
        kind: 'biome-accent',
        cell: point(26, 23),
        featureId: 'lower-clearing',
        anchor: 'tile',
        assetFamily: 'accent'
      }
    ],
    boundaries,
    spawn: {
      capacities: {
        playerCapacity: sidecar.mapProfile.playerCapacity.maximum,
        candidatePoolSize: sidecar.mapProfile.candidatePoolSize,
        maxAssignableOpponents: sidecar.mapProfile.maxAssignableOpponents
      },
      formationFacing: { player: 'n', opponent: 's' },
      playerSlots,
      opponentCandidates,
      opponentZones: [{
        id: 'opponent-zone',
        cells: candidateCells,
        tags: ['opponent'],
        capacity: sidecar.mapProfile.maxAssignableOpponents
      }],
      protectedClearances: playerSlots.map(slot => ({
        id: `clearance:${slot.id}`,
        side: 'player',
        anchorId: slot.id,
        radius: sidecar.spawnIntent.localClearanceTiles
      })),
      exits: [
        {
          id: 'exit:player-west',
          side: 'player',
          cell: point(10, 22),
          approachRegionId: 'approach:player-west'
        },
        {
          id: 'exit:player-east',
          side: 'player',
          cell: point(21, 22),
          approachRegionId: 'approach:player-east'
        },
        {
          id: 'exit:opponent-west',
          side: 'opponent',
          cell: point(10, 9),
          approachRegionId: 'approach:opponent-west'
        },
        {
          id: 'exit:opponent-east',
          side: 'opponent',
          cell: point(21, 9),
          approachRegionId: 'approach:opponent-east'
        }
      ],
      approachRegions: [
        {
          id: 'approach:player-west',
          side: 'player',
          cells: [point(9, 22), point(10, 22), point(11, 22)]
        },
        {
          id: 'approach:player-east',
          side: 'player',
          cells: [point(20, 22), point(21, 22), point(22, 22)]
        },
        {
          id: 'approach:opponent-west',
          side: 'opponent',
          cells: [point(9, 9), point(10, 9), point(11, 9)]
        },
        {
          id: 'approach:opponent-east',
          side: 'opponent',
          cells: [point(20, 9), point(21, 9), point(22, 9)]
        }
      ],
      minimumRouteConstraints: {
        minimumIndependentExits: sidecar.spawnIntent.minimumApproaches,
        requireMutualReachability: true,
        maximumTraversableElevationDelta: sidecar.heightIntent.maxGradualSlope
      },
      tacticalAnnotations: [
        {
          id: 'annotation:upper-high-ground',
          kind: 'high-ground',
          cells: candidateCells.filter(cell => cell.y <= 10),
          tags: ['ranged']
        }
      ]
    },
    expectedAssetFamilies: [
      { category: 'surface', symbol: 'ground' },
      { category: 'route', symbol: 'path' },
      { category: 'connection', symbol: 'stairs' },
      { category: 'connection', symbol: 'slope' },
      { category: 'obstacle', symbol: 'ancient-tree' },
      { category: 'obstacle', symbol: 'ironpine' },
      { category: 'obstacle', symbol: 'moss-boulder' },
      { category: 'obstacle', symbol: 'pale-birch' },
      { category: 'decoration', symbol: 'accent' },
      { category: 'decoration', symbol: 'fallen-branch' },
      { category: 'decoration', symbol: 'low-shrub' },
      { category: 'boundary', symbol: 'earth-face' },
      { category: 'boundary', symbol: 'forest-edge' }
    ],
    generationNotes: [
      'Complete contract example only; author a distinct sidecar-driven composition.'
    ]
  };
}

function blueprintContract(sidecar, mapId) {
  return {
    schemaVersion: 1,
    candidateId: mapId,
    templateId: sidecar.id,
    dimensions: {
      width: sidecar.mapProfile.width,
      height: sidecar.mapProfile.height
    },
    requiredRootKeys: [
      'schemaVersion',
      'candidateId',
      'templateId',
      'dimensions',
      'renderMask',
      'playableMask',
      'surfaceGrid',
      'elevation',
      'regions',
      'features',
      'routes',
      'connections',
      'obstacles',
      'decorations',
      'boundaries',
      'spawn',
      'expectedAssetFamilies',
      'generationNotes'
    ],
    coordinate: { x: 'integer 0..width-1', y: 'integer 0..height-1' },
    surfaceCell: { material: 'safe symbolic ID', featureId: 'existing region/feature ID' },
    connectionKinds: ['flat', 'slope', 'stairs', 'cliff'],
    assetCategories: [
      'surface',
      'connection',
      'obstacle',
      'decoration',
      'boundary',
      'route'
    ],
    assetFamilyGeometry: [{
      category: 'obstacle',
      symbol: 'landmark',
      footprint: { width: 1, height: 1 },
      collisionCells: [point(0, 0)],
      authoringRule:
        'one record per tile; repeat the family with a unique id for clusters'
    }],
    spawnCapacities: {
      playerCapacity: sidecar.mapProfile.playerCapacity.maximum,
      candidatePoolSize: sidecar.mapProfile.candidatePoolSize,
      maxAssignableOpponents: sidecar.mapProfile.maxAssignableOpponents
    },
    forbiddenFields: [
      'movementCost',
      'contentHash',
      'immutableUrl',
      'fullHash',
      'catalogReleaseId',
      'validationPassed'
    ],
    completeShapeExample: createBlueprintContractExample(sidecar, mapId)
  };
}

function variantKey(mapId) {
  const match = /-([abc])$/.exec(mapId);
  if (!match) fail(`candidate map ${mapId} must end in -a, -b, or -c`);
  return match[1];
}

export function buildBlueprintPrompt({
  profile,
  sidecar,
  mapId,
  textTemplateFallback = false
}) {
  const variant = variantKey(mapId);
  const sourceInstruction = textTemplateFallback
    ? `The exact approved source image remains staged and hash-verified for audit, but this
worker must not open it or pass its path to another tool. Use the reviewed composition,
topology, height, route, boundary, spawn, landmark, and forbidden-pattern intent in
inputs/sidecar.json as the complete authoring authority.`
    : `The exact approved source image is attached and available beneath inputs/. Treat it
as composition-only inspiration and obey inputs/sidecar.json as gameplay authority.`;
  return `${profile.prompt}

Variant brief:
${profile.variantBriefs[variant]}

Negative constraints:
${profile.negativeConstraints.map(item => `- ${item}`).join('\n')}

The approved source sidecar is available at inputs/sidecar.json.
${sourceInstruction}
The closed contract summary is available at inputs/contract.json. Its
completeShapeExample is deliberately valid at the required 32 by 32 scale:
copy it mechanically first, then make bounded, deliberate variant-specific
symbolic changes rather than retyping large masks or grids by hand. A copy of
the example, or a candidate that changes only IDs, notes, or one cosmetic
record, is rejected. Implement the variant brief by changing at least two
authoritative geometry groups while preserving every invariant: mask/surface
topology, route cells, elevation/connection geometry, spawn-cell arrangement,
or obstacle/boundary/decorative feature cells.
Every position in surfaceGrid and elevation must exactly follow renderMask:
when renderMask is true, surfaceGrid must contain a plain
{ material, featureId } object and elevation must contain a safe integer; when
renderMask is false, both values must be null. Never use null for a rendered
cell, non-null values for a void cell, undefined, sparse rows, or shortened
rows in any 32 by 32 grid.
Every required route must use unique playable cells ordered as a one-cell
cardinal Manhattan chain. Never use diagonal jumps, repeated route cells, or
route cells occupied by an obstacle. Every obstacle cell must be inside
playableMask and must not overlap a player slot, opponent candidate, exit, or
required route; use boundary records for scenery outside the playable mask.
The fixed obstacle:landmark renderer has exactly a one-tile collision footprint.
Every obstacle record must therefore contain exactly one cell and use that same
cell as its anchor. Build larger clusters from separate uniquely identified
one-cell obstacle records; never make one record span multiple cells.
Every tags array must contain unique values. An opponent candidate may name a
tactical annotation only when its cell is included in that annotation's cells,
and its cell must also belong to the opponent zone named by zoneId.

Author candidate "${mapId}" for template "${sidecar.id}" and theme
"${sidecar.theme}". Write exactly one UTF-8 JSON document to candidate.json in
the current disposable workspace. Do not create directories, logs, approvals,
compiled maps, runtime assets, or any other file. Do not modify the input files.
This is a JSON-only authoring workflow. Do not call imagegen or any other image
generation tool.
Return no copy of the JSON in the final response; the file is the only candidate
output.`.trim();
}

export function buildBlueprintCodexArgs(
  workspace,
  sourceRelativePath,
  { textTemplateFallback = false } = {}
) {
  return [
    'exec',
    '--ephemeral',
    '--json',
    '--color',
    'never',
    '--sandbox',
    'workspace-write',
    '-C',
    workspace,
    ...(textTemplateFallback ? [] : ['--image', sourceRelativePath]),
    '-c',
    'model_reasoning_effort="medium"',
    '-o',
    path.join(workspace, 'last-message.txt'),
    '-'
  ];
}

export function runBlueprintCommand({
  command = 'codex',
  args,
  cwd,
  input,
  timeoutMs,
  candidateContext = null,
  completionGraceMs = DEFAULT_BLUEPRINT_COMPLETION_GRACE_MS,
  completionPollMs = DEFAULT_BLUEPRINT_COMPLETION_POLL_MS,
  spawnImpl = spawn,
  environmentSource = process.env
}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, {
      cwd,
      env: buildCodexWorkerEnvironment(environmentSource),
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let killTimer = null;
    let timeout = null;
    let completionPoll = null;
    let terminalFailure = null;
    let intentionalCompletion = null;
    let stableCandidate = null;
    let candidatePollRunning = false;
    const stopCandidateMonitor = () => {
      if (completionPoll) clearTimeout(completionPoll);
      completionPoll = null;
    };
    const finish = (callback, result) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      stopCandidateMonitor();
      callback(result);
    };
    const terminate = () => {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 1_000);
      killTimer.unref?.();
    };
    const failAfterTermination = (error) => {
      if (terminalFailure || intentionalCompletion || settled) return;
      terminalFailure = error;
      if (timeout) clearTimeout(timeout);
      stopCandidateMonitor();
      terminate();
    };
    const collect = (target, kind, chunk) => {
      if (kind === 'stdout') stdoutBytes += chunk.length;
      else stderrBytes += chunk.length;
      if (Math.max(stdoutBytes, stderrBytes) > MAX_WORKER_LOG_BYTES) {
        const error = new Error(`worker ${kind} exceeded ${MAX_WORKER_LOG_BYTES} bytes`);
        error.code = 'BLUEPRINT_WORKER_LOG_LIMIT';
        failAfterTermination(error);
      } else target.push(chunk);
    };
    child.stdout.on('data', chunk => collect(stdout, 'stdout', chunk));
    child.stderr.on('data', chunk => collect(stderr, 'stderr', chunk));
    child.once('error', error => finish(reject, error));
    child.once('close', async (code, signal) => {
      let completionChangedError = null;
      if (intentionalCompletion) {
        try {
          const finalCandidate = await readRegularCandidateSnapshot(
            path.join(cwd, 'candidate.json')
          );
          if (
            !finalCandidate
            || sha256Bytes(finalCandidate.bytes) !== intentionalCompletion.sha256
          ) {
            completionChangedError = new Error(
              'candidate blueprint changed after validated worker termination'
            );
            completionChangedError.code =
              'BLUEPRINT_CANDIDATE_CHANGED_AFTER_COMPLETION';
          }
        } catch (error) {
          completionChangedError = error;
        }
      }
      const controlledCompletion =
        Boolean(intentionalCompletion) && !completionChangedError;
      const result = {
        code,
        signal,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        command,
        args,
        completionReason: controlledCompletion
          ? 'validated-candidate'
          : 'process-exit',
        intentionallyTerminated: controlledCompletion,
        completedCandidateSha256: controlledCompletion
          ? intentionalCompletion.sha256
          : null
      };
      if (terminalFailure) {
        terminalFailure.workerResult = result;
        finish(reject, terminalFailure);
      } else if (completionChangedError) {
        completionChangedError.workerResult = result;
        finish(reject, completionChangedError);
      } else if (intentionalCompletion) {
        finish(resolve, result);
      } else if (code !== 0) {
        const error = new Error(
          `Codex blueprint worker ${signal ? `terminated by ${signal}` : `exited with ${code}`}`
        );
        error.code = 'BLUEPRINT_WORKER_EXIT';
        error.workerResult = result;
        finish(
          reject,
          error
        );
      } else finish(resolve, result);
    });
    timeout = setTimeout(() => {
      const error = new Error(`Codex blueprint worker timed out after ${timeoutMs}ms`);
      error.code = 'BLUEPRINT_WORKER_TIMEOUT';
      failAfterTermination(error);
    }, timeoutMs);
    const scheduleCandidatePoll = () => {
      if (settled || terminalFailure || intentionalCompletion) return;
      completionPoll = setTimeout(pollCandidate, completionPollMs);
      completionPoll.unref?.();
    };
    const pollCandidate = async () => {
      if (
        settled
        || terminalFailure
        || intentionalCompletion
        || candidatePollRunning
        || !candidateContext
      ) return;
      candidatePollRunning = true;
      try {
        const candidatePath = path.join(cwd, 'candidate.json');
        let details;
        try {
          details = await lstat(candidatePath);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          stableCandidate = null;
          return;
        }
        if (details.isSymbolicLink() || !details.isFile()) {
          const error = new Error('candidate.json must be a regular non-symlink file');
          error.code = 'INVALID_BLUEPRINT_CANDIDATE_OUTPUT';
          failAfterTermination(error);
          return;
        }
        if (details.size > MAX_BLUEPRINT_BYTES) {
          const error = new Error(
            `candidate blueprint must be 2..${MAX_BLUEPRINT_BYTES} bytes`
          );
          error.code = 'INVALID_BLUEPRINT_CANDIDATE_OUTPUT';
          failAfterTermination(error);
          return;
        }
        if (details.size < 2) {
          stableCandidate = null;
          return;
        }
        const candidate = await readRegularCandidateSnapshot(candidatePath);
        if (
          !candidate
          || candidate.details.dev !== details.dev
          || candidate.details.ino !== details.ino
          || candidate.details.size !== details.size
          || candidate.details.mtimeMs !== details.mtimeMs
        ) {
          stableCandidate = null;
          return;
        }
        const { bytes } = candidate;
        const candidateSha256 = sha256Bytes(bytes);
        const signature = [
          details.dev,
          details.ino,
          details.size,
          details.mtimeMs,
          candidateSha256
        ].join(':');
        const now = Date.now();
        if (stableCandidate?.signature !== signature) {
          stableCandidate = { signature, stableSince: now };
          return;
        }
        if (now - stableCandidate.stableSince < completionGraceMs) return;
        await validateCandidateBytes(bytes, candidateContext);
        const afterValidation = await readRegularCandidateSnapshot(candidatePath);
        if (
          !afterValidation
          || afterValidation.details.dev !== details.dev
          || afterValidation.details.ino !== details.ino
          || afterValidation.details.size !== details.size
          || afterValidation.details.mtimeMs !== details.mtimeMs
          || sha256Bytes(afterValidation.bytes) !== candidateSha256
          || !afterValidation.bytes.equals(bytes)
        ) {
          stableCandidate = null;
          return;
        }
        if (settled || terminalFailure || intentionalCompletion) return;
        intentionalCompletion = { sha256: candidateSha256 };
        if (timeout) clearTimeout(timeout);
        stopCandidateMonitor();
        terminate();
      } catch {
        // A stable but partial or invalid document is not accepted. The worker
        // retains the remainder of its timeout to repair the fixed output.
      } finally {
        candidatePollRunning = false;
        scheduleCandidatePoll();
      }
    };
    if (candidateContext) scheduleCandidatePoll();
    child.stdin.on('error', error => {
      if (error.code !== 'EPIPE') finish(reject, error);
    });
    child.stdin.end(`${input}\n`);
  });
}

export async function spawnBlueprintWorker({
  workspace,
  sourceRelativePath,
  prompt,
  timeoutMs,
  mapId,
  sidecar,
  completionGraceMs = DEFAULT_BLUEPRINT_COMPLETION_GRACE_MS,
  completionPollMs = DEFAULT_BLUEPRINT_COMPLETION_POLL_MS,
  textTemplateFallback = false
}) {
  return runBlueprintCommand({
    args: buildBlueprintCodexArgs(workspace, sourceRelativePath, {
      textTemplateFallback
    }),
    cwd: workspace,
    input: prompt,
    timeoutMs,
    candidateContext: { mapId, sidecar },
    completionGraceMs,
    completionPollMs
  });
}

async function snapshotTree(root) {
  const result = new Map();
  async function visit(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      const details = await lstat(absolute);
      if (details.isSymbolicLink()) fail(`workspace contains forbidden symlink ${relative}`);
      if (entry.isDirectory()) {
        result.set(relative, { type: 'directory', bytes: 0, sha256: null });
        await visit(absolute, relative);
      } else if (entry.isFile()) {
        const bytes = await readFile(absolute);
        result.set(relative, {
          type: 'file',
          bytes: bytes.byteLength,
          sha256: sha256Bytes(bytes)
        });
      } else fail(`workspace contains unsupported entry ${relative}`);
    }
  }
  await visit(root);
  return result;
}

async function snapshotProtectedGenerationContent(projectRoot) {
  const result = new Map();
  for (const relativeRoot of PROTECTED_GENERATION_PATHS) {
    const absoluteRoot = resolveWithinProject(
      projectRoot,
      relativeRoot,
      'protected generation path'
    );
    if (!await pathExists(absoluteRoot)) {
      result.set(relativeRoot, { type: 'missing', bytes: 0, sha256: null });
      continue;
    }
    const details = await lstat(absoluteRoot);
    if (details.isSymbolicLink()) {
      fail(`protected generation path contains forbidden symlink ${relativeRoot}`);
    }
    if (details.isFile()) {
      const bytes = await readFile(absoluteRoot);
      result.set(relativeRoot, {
        type: 'file',
        bytes: bytes.byteLength,
        sha256: sha256Bytes(bytes)
      });
      continue;
    }
    if (!details.isDirectory()) {
      fail(`protected generation path contains unsupported entry ${relativeRoot}`);
    }
    result.set(relativeRoot, { type: 'directory', bytes: 0, sha256: null });
    for (const [relative, entry] of await snapshotTree(absoluteRoot)) {
      result.set(`${relativeRoot}/${relative}`, entry);
    }
  }
  return result;
}

function assertSnapshotUnchanged(before, after, label) {
  const paths = new Set([...before.keys(), ...after.keys()]);
  for (const relative of paths) {
    const left = before.get(relative);
    const right = after.get(relative);
    if (
      !left
      || !right
      || left.type !== right.type
      || left.bytes !== right.bytes
      || left.sha256 !== right.sha256
    ) fail(`${label} changed protected content ${relative}`);
  }
}

function auditWorkspace(
  before,
  after,
  sourceRelativePath,
  { requireCandidate = true } = {}
) {
  const expectedInputs = new Set([
    'inputs',
    sourceRelativePath,
    'inputs/sidecar.json',
    'inputs/contract.json'
  ]);
  for (const [relative, entry] of before) {
    if (!expectedInputs.has(relative)) fail(`unexpected prepared workspace input ${relative}`);
    const current = after.get(relative);
    if (
      !current
      || current.type !== entry.type
      || current.bytes !== entry.bytes
      || current.sha256 !== entry.sha256
    ) fail(`worker modified immutable input ${relative}`);
  }
  let workspaceBytes = 0;
  for (const [relative, entry] of after) {
    workspaceBytes += entry.bytes;
    if (before.has(relative)) continue;
    if (entry.type !== 'file' || !ALLOWED_OUTPUTS.has(relative)) {
      fail(`worker created undeclared output ${relative}`);
    }
  }
  if (workspaceBytes > MAX_WORKSPACE_BYTES) {
    fail(`worker workspace exceeds ${MAX_WORKSPACE_BYTES} bytes`);
  }
  if (requireCandidate && !after.has('candidate.json')) {
    fail('worker did not create candidate.json');
  }
  return true;
}

function candidatePaths(theme, template, mapId) {
  const root =
    `ai-image-metadata/battle-maps/candidates/${theme}/${template}/blueprints/${mapId}`;
  return {
    root,
    blueprint: `${root}/candidate.json`,
    metadata: `${root}/result.json`,
    prompt: `${root}/prompt.txt`,
    stdout: `${root}/worker.jsonl`,
    stderr: `${root}/worker.stderr.log`,
    lastMessage: `${root}/last-message.txt`
  };
}

function approvedPaths(theme, template, mapId) {
  const root = `ai-image-metadata/battle-maps/blueprints/${theme}/${template}`;
  return {
    root,
    blueprint: `${root}/${mapId}.json`,
    approval: `${root}/${mapId}.approval.json`,
    index: `${root}/approvals.json`
  };
}

async function verifySource(projectRoot, sidecar) {
  if (sidecar.status !== 'approved' || sidecar.review?.decision !== 'approved') {
    fail('blueprint generation requires an approved source template');
  }
  if (!sidecar.sourceImage || sidecar.pins?.sourceImageSha256 !== sidecar.sourceImage.sha256) {
    fail('approved source template is missing its exact source-image pin');
  }
  const sourcePath = resolveWithinProject(
    projectRoot,
    sidecar.sourceImage.path,
    'approved source-image path'
  );
  await assertSafeWritePath(projectRoot, sourcePath, 'approved source-image read path');
  const actual = await inspectImage(sourcePath);
  for (const key of ['bytes', 'width', 'height', 'format', 'sha256']) {
    if (actual[key] !== sidecar.sourceImage[key]) {
      fail(`approved source-image ${key} no longer matches its sidecar pin`);
    }
  }
  return sourcePath;
}

async function readCandidateRecord(projectRoot, theme, template, mapId, {
  sidecar = null,
  promptReference = null,
  promptProfile = null
} = {}) {
  const paths = candidatePaths(theme, template, mapId);
  const metadataPath = resolveWithinProject(
    projectRoot,
    paths.metadata,
    'blueprint candidate metadata path'
  );
  let metadata;
  try {
    await assertSafeWritePath(
      projectRoot,
      metadataPath,
      'blueprint candidate metadata read path'
    );
    metadata = (await readJson(metadataPath, 'blueprint candidate metadata')).value;
  } catch (error) {
    if (error.message.includes('does not exist')) return null;
    throw error;
  }
  exactKeys(metadata, [
    'schemaVersion',
    'id',
    'theme',
    'templateId',
    'status',
    'blueprint',
    'sourceImageSha256',
    'promptProfile',
    'worker',
    'approval'
  ], 'blueprint candidate metadata');
  exactKeys(metadata.blueprint, ['path', 'bytes', 'fileSha256', 'fullHash'], 'candidate blueprint');
  exactKeys(metadata.promptProfile, ['id', 'path', 'sha256'], 'candidate prompt profile');
  const hasExplicitTextTemplateFallback =
    Object.hasOwn(metadata.worker, 'textTemplateFallback');
  exactKeys(metadata.worker, [
    'command',
    'args',
    'timeoutMs',
    'promptPath',
    'stdoutPath',
    'stderrPath',
    'lastMessagePath',
    ...(hasExplicitTextTemplateFallback ? ['textTemplateFallback'] : [])
  ], 'candidate worker');
  if (
    metadata.schemaVersion !== BLUEPRINT_CANDIDATE_SCHEMA
    || metadata.id !== mapId
    || metadata.theme !== theme
    || metadata.templateId !== template
    || metadata.status !== 'candidate-awaiting-review'
    || metadata.approval !== null
  ) fail('blueprint candidate metadata has invalid lifecycle state');
  if (
    !Number.isSafeInteger(metadata.blueprint.bytes)
    || metadata.blueprint.bytes < 2
    || metadata.blueprint.bytes > MAX_BLUEPRINT_BYTES
  ) fail(`candidate blueprint bytes must be 2..${MAX_BLUEPRINT_BYTES}`);
  sha256(metadata.blueprint.fileSha256, 'candidate blueprint fileSha256');
  sha256(metadata.blueprint.fullHash, 'candidate blueprint fullHash');
  sha256(metadata.sourceImageSha256, 'candidate sourceImageSha256');
  sha256(metadata.promptProfile.sha256, 'candidate prompt profile sha256');
  if (
    promptReference
    && (
      metadata.promptProfile.id !== promptReference.id
      || metadata.promptProfile.path !== promptReference.path
      || metadata.promptProfile.sha256 !== promptReference.sha256
    )
  ) fail('candidate prompt-profile pin is stale');
  if (
    sidecar
    && metadata.sourceImageSha256 !== sidecar.sourceImage?.sha256
  ) fail('candidate source-image pin is stale');
  if (
    metadata.worker.command !== 'codex'
    || !Array.isArray(metadata.worker.args)
    || metadata.worker.args.length > 64
    || metadata.worker.args.some(argument =>
      typeof argument !== 'string' || argument.length > 4096
    )
    || !Number.isSafeInteger(metadata.worker.timeoutMs)
    || metadata.worker.timeoutMs < 1
    || metadata.worker.timeoutMs > MAX_BLUEPRINT_TIMEOUT_MS
    || metadata.worker.promptPath !== paths.prompt
    || metadata.worker.stdoutPath !== paths.stdout
    || metadata.worker.stderrPath !== paths.stderr
    || ![null, paths.lastMessage].includes(metadata.worker.lastMessagePath)
    || (
      hasExplicitTextTemplateFallback
      && typeof metadata.worker.textTemplateFallback !== 'boolean'
    )
  ) fail('candidate worker provenance is invalid');
  if (sidecar && promptProfile) {
    const promptPath = resolveWithinProject(
      projectRoot,
      paths.prompt,
      'candidate prompt path'
    );
    await assertSafeWritePath(projectRoot, promptPath, 'candidate prompt read path');
    const actualPrompt = await readFile(promptPath);
    const fallbackModes = hasExplicitTextTemplateFallback
      ? [metadata.worker.textTemplateFallback]
      : [false, true];
    const matchingModes = fallbackModes.filter(textTemplateFallback => {
      const expectedPrompt = Buffer.from(
        `${buildBlueprintPrompt({
          profile: promptProfile,
          sidecar,
          mapId,
          textTemplateFallback
        })}\n`
      );
      return actualPrompt.byteLength === expectedPrompt.byteLength
        && actualPrompt.equals(expectedPrompt);
    });
    if (matchingModes.length !== 1) {
      fail('candidate prompt transcript does not match its frozen inputs');
    }
  }
  const blueprintPath = resolveWithinProject(
    projectRoot,
    metadata.blueprint.path,
    'blueprint candidate path'
  );
  if (metadata.blueprint.path !== paths.blueprint) fail('blueprint candidate path is not fixed');
  await assertSafeWritePath(projectRoot, blueprintPath, 'candidate blueprint read path');
  const details = await stat(blueprintPath);
  if (
    !details.isFile()
    || details.size < 2
    || details.size > MAX_BLUEPRINT_BYTES
    || details.size !== metadata.blueprint.bytes
  ) fail('blueprint candidate file size is invalid');
  const bytes = await readFile(blueprintPath);
  if (
    bytes.byteLength !== metadata.blueprint.bytes
    || sha256Bytes(bytes) !== metadata.blueprint.fileSha256
  ) fail('blueprint candidate file pin mismatch');
  const blueprint = parseStrictJsonBytes(bytes, 'candidate blueprint');
  assertTemplateMapBlueprint(blueprint);
  const fullHash = await computeTemplateMapBlueprintFullHash(blueprint);
  if (fullHash !== metadata.blueprint.fullHash) {
    fail('blueprint candidate canonical hash mismatch');
  }
  return { metadata, blueprint, paths, blueprintPath };
}

async function prepareWorkspace({
  projectRoot,
  candidateRoot,
  sourcePath,
  sidecar,
  mapId
}) {
  await mkdir(candidateRoot, { recursive: true });
  const workspace = await mkdtemp(path.join(candidateRoot, `.workspace-${mapId}-`));
  const inputs = path.join(workspace, 'inputs');
  await mkdir(inputs);
  const sourceExtension = path.extname(sourcePath).toLowerCase();
  const sourceRelativePath = `inputs/reference${sourceExtension}`;
  if (!INPUT_PATHS.has(sourceRelativePath)) {
    fail('approved source image must be PNG or WebP');
  }
  await Promise.all([
    copyFile(sourcePath, path.join(workspace, sourceRelativePath)),
    writeFile(path.join(inputs, 'sidecar.json'), `${JSON.stringify(sidecar, null, 2)}\n`),
    writeFile(
      path.join(inputs, 'contract.json'),
      `${JSON.stringify(blueprintContract(sidecar, mapId), null, 2)}\n`
    )
  ]);
  return { workspace, sourceRelativePath };
}

function deterministicPreflightHash(label) {
  return sha256Bytes(
    Buffer.from(`modia:battle-map-blueprint-candidate-preflight:v1:${label}`)
  );
}

async function preflightCandidateWithSyntheticCompilerContext(blueprint, sidecar) {
  // This in-memory context exercises compiler semantics only. Release
  // provenance, recipes, and assets remain the authority for production builds.
  const blueprintFullHash = await computeTemplateMapBlueprintFullHash(blueprint);
  const sourceSidecar = structuredClone(sidecar);
  const compilerFullHash =
    sourceSidecar.pins.compilerSha256
    ?? deterministicPreflightHash('compiler');
  sourceSidecar.pins = {
    ...sourceSidecar.pins,
    approvedBlueprintSha256:
      sourceSidecar.pins.approvedBlueprintSha256 ?? blueprintFullHash,
    compilerSha256: compilerFullHash
  };
  const familyRecords = [...blueprint.expectedAssetFamilies].sort((left, right) => {
    const leftKey = `${left.category}:${left.symbol}`;
    const rightKey = `${right.category}:${right.symbol}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  const ecologyProfile = `${sidecar.theme}-default`;
  const directions = ['n', 'e', 's', 'w'];
  const routeTopologies = [
    'isolated',
    'end-n', 'end-e', 'end-s', 'end-w',
    'straight-ns', 'straight-ew',
    'corner-ne', 'corner-es', 'corner-sw', 'corner-wn',
    'tee-nes', 'tee-esw', 'tee-nsw', 'tee-wne',
    'cross'
  ];
  const bindingCapabilities = record => {
    if (record.category === 'surface') {
      return [0, 1, 2, 3].map(surfaceVariant => ({
        surfaceVariant,
        ecologyProfile
      }));
    }
    if (record.category === 'connection') {
      return directions.map(direction => ({
        direction,
        heightDelta: 1,
        ecologyProfile
      }));
    }
    if (record.category === 'boundary') {
      return directions.map(direction => ({
        direction,
        heightDelta: 1,
        ecologyProfile
      }));
    }
    if (record.category === 'route') {
      return routeTopologies.map(routeTopology => ({
        routeTopology,
        ecologyProfile
      }));
    }
    return [{ ecologyProfile }];
  };
  const assetBindings = familyRecords.flatMap(record =>
    bindingCapabilities(record).map(match => ({
      category: record.category,
      symbol: record.symbol,
      match
    }))
  ).map((record, index) => ({
    ...record,
    assetKey: `preflight-asset-${index + 1}`
  }));
  const elevationFaceFamilies = familyRecords.filter(
    record => record.category === 'boundary'
  );
  if (elevationFaceFamilies.length === 0) {
    fail(
      'compiler preflight requires at least one declared boundary family '
      + 'for derived elevation faces'
    );
  }
  const elevationFaceFamily =
    elevationFaceFamilies.find(record => record.symbol === 'earth-face')
    ?? elevationFaceFamilies[0];
  const assets = assetBindings.map((record, index) => ({
    key: record.assetKey,
    contentVersion: 1,
    contentHash: deterministicPreflightHash(
      `asset:${record.category}:${record.symbol}:${stableJson(record.match)}`
    ),
    immutableUrl:
      `/assets/battle-map-v3/candidate-preflight-assets/v1/asset-${index + 1}.webp`
  }));
  const materialSymbols = new Set(
    blueprint.surfaceGrid.flat()
      .filter(Boolean)
      .map(cell => cell.material)
  );
  blueprint.routes.forEach(route => materialSymbols.add(route.material));
  blueprint.expectedAssetFamilies
    .filter(record => record.category === 'surface')
    .forEach(record => materialSymbols.add(record.symbol));
  const materials = [...materialSymbols].sort().map(symbol => ({
    symbol,
    material: symbol,
    passable: true,
    movementCost: 1
  }));
  const context = {
    identity: {
      contentId: blueprint.candidateId,
      contentVersion: 1,
      templateRevision: 1,
      theme: sidecar.theme,
      tierEligibility: sidecar.tierEligibility,
      supportedModes: sidecar.supportedModes
    },
    sourceSidecar,
    renderProfile: {
      schemaVersion: 'battle-map-render-profile-v2',
      id: 'candidate-preflight-profile',
      theme: sidecar.theme,
      ecologyProfile,
      assetBundleId: 'candidate-preflight-assets',
      surfaceVariantCount: 4,
      scene: {
        silhouette: sidecar.theme === 'grand_palace'
          ? 'rectangular-platform'
          : 'organic-island',
        exterior: sidecar.theme === 'forest'
          ? 'forest-canopy'
          : sidecar.theme === 'grand_palace'
            ? 'architectural-skirt'
            : 'none',
        backdrop: {
          kind: ['cave', 'crypt', 'dungeon'].includes(sidecar.theme)
            ? 'cavern-gradient'
            : sidecar.theme === 'grand_palace'
              ? 'architectural-gradient'
              : 'sky-gradient',
          topColor: '#7599B8',
          horizonColor: '#B9D5DE',
          bottomColor: '#E8DED0',
          hazeColor: '#D8E6E8'
        }
      },
      elevationFaceSymbols: Object.fromEntries(
        materials.map(material => [
          material.symbol,
          elevationFaceFamily.symbol
        ])
      ),
      assetBindings
    },
    tileCatalog: {
      id: 'candidate-preflight-tiles',
      version: 1,
      fullHash: deterministicPreflightHash('tile-catalog-placeholder'),
      renderProfileId: 'candidate-preflight-profile',
      materials
    },
    assetBundle: {
      id: 'candidate-preflight-assets',
      version: 1,
      manifestFullHash: deterministicPreflightHash('asset-bundle-placeholder'),
      rendererManifestFullHash: deterministicPreflightHash('renderer-manifest'),
      assets
    },
    provenance: {
      sourceSidecar: {
        id: sidecar.id,
        version: 1,
        fullHash: deterministicPreflightHash('source-sidecar-placeholder')
      },
      approvedBlueprint: {
        id: blueprint.candidateId,
        version: 1,
        fullHash: blueprintFullHash
      },
      compiler: {
        id: 'template-map-compiler',
        version: TEMPLATE_MAP_COMPILER_VERSION,
        fullHash: compilerFullHash
      },
      validator: {
        id: 'battle-map-v3-validator',
        version: 1,
        fullHash: deterministicPreflightHash('validator')
      }
    }
  };
  [
    context.tileCatalog.fullHash,
    context.assetBundle.manifestFullHash,
    context.provenance.sourceSidecar.fullHash
  ] = await Promise.all([
    computeTemplateMapTileCatalogFullHash(context.tileCatalog),
    computeTemplateMapAssetBundleManifestFullHash(context.assetBundle),
    computeTemplateMapSourceSidecarFullHash(context.sourceSidecar)
  ]);
  await compileTemplateMapBlueprint(blueprint, context);
}

async function validateCandidateBytes(candidateBytes, { mapId, sidecar }) {
  if (
    candidateBytes.byteLength < 2
    || candidateBytes.byteLength > MAX_BLUEPRINT_BYTES
  ) {
    fail(`candidate blueprint must be 2..${MAX_BLUEPRINT_BYTES} bytes`);
  }
  const blueprint = parseStrictJsonBytes(candidateBytes, 'candidate blueprint');
  const validation = validateTemplateMapBlueprint(blueprint);
  if (!validation.valid) {
    fail(
      `candidate blueprint failed the closed schema:\n${validation.errors.join('\n')}`,
      'INVALID_TEMPLATE_MAP_BLUEPRINT'
    );
  }
  if (blueprint.candidateId !== mapId || blueprint.templateId !== sidecar.id) {
    fail('candidate blueprint identity does not match the requested fixed output');
  }
  if (
    blueprint.dimensions.width !== sidecar.mapProfile.width
    || blueprint.dimensions.height !== sidecar.mapProfile.height
  ) fail('candidate blueprint dimensions do not match the approved sidecar');
  const expectedCapacities = {
    playerCapacity: sidecar.mapProfile.playerCapacity.maximum,
    candidatePoolSize: sidecar.mapProfile.candidatePoolSize,
    maxAssignableOpponents: sidecar.mapProfile.maxAssignableOpponents
  };
  for (const [key, value] of Object.entries(expectedCapacities)) {
    if (blueprint.spawn.capacities[key] !== value) {
      fail(`candidate blueprint spawn capacity ${key} does not match the approved sidecar`);
    }
  }
  const example = createBlueprintContractExample(sidecar, mapId);
  const familyKeys = value => value.expectedAssetFamilies
    .map(record => `${record.category}:${record.symbol}`)
    .sort();
  if (
    stableJson(familyKeys(blueprint))
    !== stableJson(familyKeys(example))
  ) {
    fail(
      'candidate expectedAssetFamilies must exactly match the fixed contract symbols',
      'INVALID_TEMPLATE_MAP_BLUEPRINT'
    );
  }
  for (const obstacle of blueprint.obstacles) {
    if (
      obstacle.cells.length !== 1
      || obstacle.anchor.x !== obstacle.cells[0].x
      || obstacle.anchor.y !== obstacle.cells[0].y
    ) {
      fail(
        `candidate obstacle ${obstacle.id} must use the fixed one-cell landmark `
        + 'footprint with its anchor on that cell',
        'INVALID_TEMPLATE_MAP_BLUEPRINT'
      );
    }
  }
  const geometryGroups = value => [
    {
      renderMask: value.renderMask,
      playableMask: value.playableMask,
      surfaceGrid: value.surfaceGrid
    },
    value.routes.map(route => ({
      cells: route.cells,
      required: route.required,
      width: route.width
    })),
    {
      elevation: value.elevation,
      connections: value.connections.map(connection => ({
        from: connection.from,
        to: connection.to,
        kind: connection.kind,
        traversable: connection.traversable
      }))
    },
    {
      playerSlots: value.spawn.playerSlots.map(slot => slot.cell),
      opponentCandidates: value.spawn.opponentCandidates.map(candidate => candidate.cell),
      opponentZones: value.spawn.opponentZones.map(zone => zone.cells),
      exits: value.spawn.exits.map(exit => exit.cell)
    },
    {
      obstacles: value.obstacles.map(obstacle => obstacle.cells),
      decorations: value.decorations.map(decoration => decoration.cell),
      boundaries: value.boundaries.map(boundary => boundary.edges)
    }
  ];
  const authoredGroups = geometryGroups(blueprint);
  const exampleGroups = geometryGroups(example);
  const changedGeometryGroups = authoredGroups.reduce(
    (count, group, index) =>
      count + (stableJson(group) === stableJson(exampleGroups[index]) ? 0 : 1),
    0
  );
  if (changedGeometryGroups < 2) {
    fail(
      'candidate blueprint must author at least two semantic geometry groups '
      + 'instead of copying the complete contract example',
      'UNAUTHORED_TEMPLATE_MAP_BLUEPRINT'
    );
  }
  await preflightCandidateWithSyntheticCompilerContext(blueprint, sidecar);
  return blueprint;
}

async function promoteWorkerResult({
  projectRoot,
  workspace,
  paths,
  sidecar,
  promptReference,
  mapId,
  prompt,
  workerResult,
  timeoutMs,
  textTemplateFallback
}) {
  const workspaceBlueprint = path.join(workspace, 'candidate.json');
  const fileStats = await stat(workspaceBlueprint);
  if (!fileStats.isFile() || fileStats.size < 2 || fileStats.size > MAX_BLUEPRINT_BYTES) {
    fail(`candidate blueprint must be 2..${MAX_BLUEPRINT_BYTES} bytes`);
  }
  const candidateBytes = await readFile(workspaceBlueprint);
  const blueprint = await validateCandidateBytes(candidateBytes, { mapId, sidecar });
  if (
    workerResult.completedCandidateSha256
    && workerResult.completedCandidateSha256 !== sha256Bytes(candidateBytes)
  ) {
    fail('candidate blueprint changed after validated worker completion');
  }
  const fullHash = await computeTemplateMapBlueprintFullHash(blueprint);
  const writes = [
    [paths.blueprint, candidateBytes],
    [paths.prompt, Buffer.from(`${prompt}\n`)],
    [paths.stdout, workerResult.stdout ?? Buffer.alloc(0)],
    [paths.stderr, workerResult.stderr ?? Buffer.alloc(0)]
  ];
  try {
    writes.push([
      paths.lastMessage,
      await readFile(path.join(workspace, 'last-message.txt'))
    ]);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const [relative, contents] of writes) {
    if (contents.byteLength > MAX_WORKER_LOG_BYTES && relative !== paths.blueprint) {
      fail(`worker log exceeds ${MAX_WORKER_LOG_BYTES} bytes: ${relative}`);
    }
    await atomicWrite(
      projectRoot,
      resolveWithinProject(projectRoot, relative, 'blueprint candidate output path'),
      contents
    );
  }
  const metadata = {
    schemaVersion: BLUEPRINT_CANDIDATE_SCHEMA,
    id: mapId,
    theme: sidecar.theme,
    templateId: sidecar.id,
    status: 'candidate-awaiting-review',
    blueprint: {
      path: paths.blueprint,
      bytes: candidateBytes.byteLength,
      fileSha256: sha256Bytes(candidateBytes),
      fullHash
    },
    sourceImageSha256: sidecar.sourceImage.sha256,
    promptProfile: promptReference,
    worker: {
      command: 'codex',
      args: workerResult.args ?? [],
      timeoutMs,
      promptPath: paths.prompt,
      stdoutPath: paths.stdout,
      stderrPath: paths.stderr,
      lastMessagePath: writes.some(([relative]) => relative === paths.lastMessage)
        ? paths.lastMessage
        : null,
      textTemplateFallback
    },
    approval: null
  };
  await atomicWrite(
    projectRoot,
    resolveWithinProject(projectRoot, paths.metadata, 'blueprint metadata path'),
    Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`)
  );
  return metadata;
}

async function preserveWorkerDiagnostics({
  projectRoot,
  workspace,
  paths,
  prompt,
  workerResult
}) {
  if (!workerResult) return false;
  const writes = [
    [paths.prompt, Buffer.from(`${prompt}\n`)],
    [paths.stdout, workerResult.stdout ?? Buffer.alloc(0)],
    [paths.stderr, workerResult.stderr ?? Buffer.alloc(0)]
  ];
  try {
    writes.push([
      paths.lastMessage,
      await readFile(path.join(workspace, 'last-message.txt'))
    ]);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const [relative, contents] of writes) {
    if (contents.byteLength > MAX_WORKER_LOG_BYTES) {
      fail(`worker log exceeds ${MAX_WORKER_LOG_BYTES} bytes: ${relative}`);
    }
    await atomicWrite(
      projectRoot,
      resolveWithinProject(projectRoot, relative, 'blueprint diagnostic output path'),
      contents
    );
  }
  return true;
}

async function runPool(items, concurrency, callback) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function consume() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await callback(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => consume())
  );
  return results;
}

export async function generateBlueprintCandidates(options, {
  worker = spawnBlueprintWorker,
  completionGraceMs = DEFAULT_BLUEPRINT_COMPLETION_GRACE_MS,
  completionPollMs = DEFAULT_BLUEPRINT_COMPLETION_POLL_MS,
  candidateLockHolderSource = CANDIDATE_LOCK_HOLDER_SOURCE
} = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? SCRIPT_PROJECT_ROOT);
  const [{ sidecar }, promptLoaded] = await Promise.all([
    loadTemplateSidecar({
      projectRoot,
      theme: options.theme,
      template: options.template
    }),
    loadBlueprintPrompt(projectRoot)
  ]);
  const sourcePath = await verifySource(projectRoot, sidecar);
  const requested = options.mapIds.length > 0
    ? options.mapIds
    : sidecar.candidateMaps.slice(0, options.maps ?? sidecar.candidateMaps.length);
  for (const mapId of requested) {
    if (!sidecar.candidateMaps.includes(mapId)) {
      fail(`candidate map ${mapId} is not declared by the approved sidecar`);
    }
  }
  const jobs = [];
  const results = [];
  for (const mapId of requested) {
    const paths = candidatePaths(options.theme, options.template, mapId);
    if (!options.dryRun) {
      jobs.push({ mapId, paths });
      continue;
    }
    const candidateRoot = resolveWithinProject(
      projectRoot,
      paths.root,
      'candidate output path'
    );
    const rootExists = await pathExists(candidateRoot);
    let existing;
    try {
      existing = await readCandidateRecord(
        projectRoot,
        options.theme,
        options.template,
        mapId,
        {
          sidecar,
          promptReference: promptLoaded.reference,
          promptProfile: promptLoaded.profile
        }
      );
    } catch (error) {
      if (!options.force && !options.resume) throw error;
      existing = null;
    }
    if (existing && options.resume) {
      results.push({
        mapId,
        status: 'skipped-complete',
        fullHash: existing.metadata.blueprint.fullHash
      });
      continue;
    }
    if (existing && !options.force) {
      fail(`candidate ${mapId} exists; use --resume to skip or --force to replace`);
    }
    if (rootExists && !existing && !options.force && !options.resume) {
      fail(`candidate ${mapId} is incomplete or invalid; use --resume or --force to replace`);
    }
    jobs.push({ mapId, paths, replace: rootExists });
  }
  const plan = {
    ok: true,
    dryRun: options.dryRun,
    theme: options.theme,
    template: options.template,
    sourceImageSha256: sidecar.sourceImage.sha256,
    promptProfile: promptLoaded.reference,
    concurrency: options.concurrency,
    timeoutMs: options.timeoutMs,
    textTemplateFallback: options.textTemplateFallback,
    jobs: jobs.map(job => ({
      mapId: job.mapId,
      outputDirectory: job.paths.root,
      status: 'pending'
    })),
    results
  };
  if (options.dryRun) return plan;
  const generated = await runPool(jobs, options.concurrency, async job => {
    const lock = await acquireCandidateGenerationLock({
      projectRoot,
      theme: options.theme,
      template: options.template,
      mapId: job.mapId,
      holderSource: candidateLockHolderSource
    });
    try {
      const candidateRoot = resolveWithinProject(
        projectRoot,
        job.paths.root,
        'candidate output path'
      );
      await assertSafeWritePath(projectRoot, candidateRoot, 'candidate output path');
      const rootExists = await pathExists(candidateRoot);
      let existing;
      try {
        existing = await readCandidateRecord(
          projectRoot,
          options.theme,
          options.template,
          job.mapId,
          {
            sidecar,
            promptReference: promptLoaded.reference,
            promptProfile: promptLoaded.profile
          }
        );
      } catch (error) {
        if (!options.force && !options.resume) throw error;
        existing = null;
      }
      if (existing && options.resume) {
        return {
          mapId: job.mapId,
          status: 'skipped-complete',
          fullHash: existing.metadata.blueprint.fullHash
        };
      }
      if (existing && !options.force) {
        fail(`candidate ${job.mapId} exists; use --resume to skip or --force to replace`);
      }
      if (rootExists && !existing && !options.force && !options.resume) {
        fail(
          `candidate ${job.mapId} is incomplete or invalid; `
            + 'use --resume or --force to replace'
        );
      }
      if (rootExists) {
        await assertSafeWritePath(
          projectRoot,
          candidateRoot,
          'candidate replacement path'
        );
        await rm(candidateRoot, { recursive: true, force: true });
      }

      let workspace = null;
      let workerResult = null;
      let diagnosticsPersisted = false;
      try {
        const prepared = await prepareWorkspace({
          projectRoot,
          candidateRoot,
          sourcePath,
          sidecar,
          mapId: job.mapId
        });
        workspace = prepared.workspace;
        const { sourceRelativePath } = prepared;
        const prompt = buildBlueprintPrompt({
          profile: promptLoaded.profile,
          sidecar,
          mapId: job.mapId,
          textTemplateFallback: options.textTemplateFallback
        });
        try {
          const before = await snapshotTree(workspace);
          const protectedBefore =
            await snapshotProtectedGenerationContent(projectRoot);
          let workerError;
          try {
            workerResult = await worker({
              workspace,
              sourceRelativePath,
              prompt,
              timeoutMs: options.timeoutMs,
              mapId: job.mapId,
              theme: options.theme,
              template: options.template,
              sidecar,
              completionGraceMs,
              completionPollMs,
              textTemplateFallback: options.textTemplateFallback
            });
          } catch (error) {
            workerError = error;
            workerResult = error.workerResult ?? null;
          }
          const protectedAfter =
            await snapshotProtectedGenerationContent(projectRoot);
          assertSnapshotUnchanged(
            protectedBefore,
            protectedAfter,
            `candidate worker ${job.mapId}`
          );
          const after = await snapshotTree(workspace);
          auditWorkspace(before, after, sourceRelativePath, {
            requireCandidate: !workerError
          });
          if (workerError) {
            diagnosticsPersisted = await preserveWorkerDiagnostics({
              projectRoot,
              workspace,
              paths: job.paths,
              prompt,
              workerResult
            });
            throw workerError;
          }
          const toolAudit = auditCodexWorkerJsonl(workerResult.stdout);
          if (toolAudit.imagegenInvocationCount !== 0) {
            fail(
              'blueprint worker must not call imagegen; '
                + `observed ${toolAudit.imagegenInvocationCount}`
            );
          }
          const metadata = await promoteWorkerResult({
            projectRoot,
            workspace,
            paths: job.paths,
            sidecar,
            promptReference: promptLoaded.reference,
            mapId: job.mapId,
            prompt,
            workerResult,
            timeoutMs: options.timeoutMs,
            textTemplateFallback: options.textTemplateFallback === true
          });
          return {
            mapId: job.mapId,
            status: 'generated-awaiting-review',
            fullHash: metadata.blueprint.fullHash
          };
        } catch (error) {
          if (!diagnosticsPersisted) {
            await rm(candidateRoot, { recursive: true, force: true });
          }
          throw error;
        } finally {
          await rm(workspace, { recursive: true, force: true });
        }
      } catch (error) {
        if (!workspace && !diagnosticsPersisted) {
          await rm(candidateRoot, { recursive: true, force: true });
        }
        throw error;
      }
    } finally {
      await lock.release();
    }
  });
  return { ...plan, results: [...results, ...generated] };
}

function previewSvg(blueprint) {
  const scale = 16;
  const width = blueprint.dimensions.width * scale;
  const height = blueprint.dimensions.height * scale;
  const players = new Map(
    blueprint.spawn.playerSlots.map(slot => [`${slot.cell.x},${slot.cell.y}`, slot])
  );
  const opponents = new Map(
    blueprint.spawn.opponentCandidates.map(slot => [`${slot.cell.x},${slot.cell.y}`, slot])
  );
  const obstacles = new Set(
    blueprint.obstacles.flatMap(obstacle =>
      obstacle.cells.map(cell => `${cell.x},${cell.y}`)
    )
  );
  const cells = [];
  for (let y = 0; y < blueprint.dimensions.height; y += 1) {
    for (let x = 0; x < blueprint.dimensions.width; x += 1) {
      if (!blueprint.renderMask[y][x]) continue;
      const key = `${x},${y}`;
      const surface = blueprint.surfaceGrid[y][x]?.material ?? 'void';
      const hue = Number.parseInt(
        createHash('sha256').update(surface).digest('hex').slice(0, 4),
        16
      ) % 360;
      const elevation = blueprint.elevation[y][x] ?? 0;
      const fill = blueprint.playableMask[y][x]
        ? `hsl(${hue} 42% ${Math.max(25, 62 - elevation * 6)}%)`
        : '#243129';
      cells.push(
        `<rect x="${x * scale}" y="${y * scale}" width="${scale}" height="${scale}" `
        + `fill="${fill}" stroke="#111" stroke-width=".35"><title>${key} ${surface} z${elevation}</title></rect>`
      );
      if (obstacles.has(key)) {
        cells.push(
          `<rect x="${x * scale + 3}" y="${y * scale + 3}" width="${scale - 6}" `
          + `height="${scale - 6}" fill="#5a351c"/>`
        );
      }
      if (players.has(key)) {
        cells.push(
          `<circle cx="${x * scale + 8}" cy="${y * scale + 8}" r="5" fill="#48a8ff"/>`
        );
      }
      if (opponents.has(key)) {
        cells.push(
          `<circle cx="${x * scale + 8}" cy="${y * scale + 8}" r="4" fill="#ff625e"/>`
        );
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" `
    + `viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">${cells.join('')}</svg>`;
}

export async function previewBlueprintCandidates(options) {
  const projectRoot = path.resolve(options.projectRoot ?? SCRIPT_PROJECT_ROOT);
  const [{ sidecar }, promptLoaded] = await Promise.all([
    loadTemplateSidecar({
      projectRoot,
      theme: options.theme,
      template: options.template
    }),
    loadBlueprintPrompt(projectRoot)
  ]);
  const mapIds = options.all ? sidecar.candidateMaps : [options.mapId];
  const results = [];
  for (const mapId of mapIds) {
    const candidate = await readCandidateRecord(
      projectRoot,
      options.theme,
      options.template,
      mapId,
      {
        sidecar,
        promptReference: promptLoaded.reference,
        promptProfile: promptLoaded.profile
      }
    );
    if (!candidate) fail(`candidate ${mapId} does not exist`);
    const reviewRoot =
      `ai-image-metadata/battle-maps/review/${options.theme}/${options.template}/${mapId}`;
    const svgPath = `${reviewRoot}/mechanical-preview.svg`;
    const reportPath = `${reviewRoot}/mechanical-report.json`;
    const report = {
      schemaVersion: 'battle-map-blueprint-mechanical-preview-v1',
      mapId,
      blueprintFullHash: candidate.metadata.blueprint.fullHash,
      dimensions: candidate.blueprint.dimensions,
      renderedCells: candidate.blueprint.renderMask.flat().filter(Boolean).length,
      playableCells: candidate.blueprint.playableMask.flat().filter(Boolean).length,
      elevationLevels: [...new Set(candidate.blueprint.elevation.flat().filter(Number.isInteger))]
        .sort((left, right) => left - right),
      playerSlots: candidate.blueprint.spawn.playerSlots.length,
      opponentCandidates: candidate.blueprint.spawn.opponentCandidates.length,
      maxAssignableOpponents:
        candidate.blueprint.spawn.capacities.maxAssignableOpponents,
      assetFamilies: candidate.blueprint.expectedAssetFamilies,
      note: 'Mechanical preview only. Production rendering requires an approved blueprint and exact asset bundle.'
    };
    await Promise.all([
      atomicWrite(
        projectRoot,
        resolveWithinProject(projectRoot, svgPath, 'mechanical preview path'),
        Buffer.from(previewSvg(candidate.blueprint))
      ),
      atomicWrite(
        projectRoot,
        resolveWithinProject(projectRoot, reportPath, 'mechanical report path'),
        Buffer.from(`${JSON.stringify(report, null, 2)}\n`)
      )
    ]);
    results.push({ mapId, svgPath, reportPath, report });
  }
  return { ok: true, theme: options.theme, template: options.template, results };
}

async function loadApprovalIndex(projectRoot, paths, theme, template) {
  const indexPath = resolveWithinProject(
    projectRoot,
    paths.index,
    'blueprint approval index path'
  );
  try {
    await assertSafeWritePath(projectRoot, indexPath, 'blueprint approval index read path');
    const value = (await readJson(indexPath, 'blueprint approval index')).value;
    exactKeys(value, [
      'schemaVersion',
      'theme',
      'templateId',
      'entries',
      'fullHash'
    ], 'blueprint approval index');
    if (
      value.schemaVersion !== BLUEPRINT_APPROVAL_SCHEMA
      || value.theme !== theme
      || value.templateId !== template
      || !Array.isArray(value.entries)
    ) fail('blueprint approval index identity is invalid');
    if (value.entries.length > 3) fail('blueprint approval index contains too many entries');
    const ids = new Set();
    let priorId = null;
    for (let index = 0; index < value.entries.length; index += 1) {
      const entry = value.entries[index];
      const label = `blueprint approval index.entries[${index}]`;
      exactKeys(entry, [
        'id',
        'blueprintPath',
        'approvalPath',
        'blueprintFullHash',
        'sourceImageSha256',
        'promptProfileSha256',
        'reviewer',
        'decision'
      ], label);
      safeId(entry.id, `${label}.id`);
      safeId(entry.reviewer, `${label}.reviewer`);
      sha256(entry.blueprintFullHash, `${label}.blueprintFullHash`);
      sha256(entry.sourceImageSha256, `${label}.sourceImageSha256`);
      sha256(entry.promptProfileSha256, `${label}.promptProfileSha256`);
      if (entry.decision !== 'approved') fail(`${label}.decision must be approved`);
      if (ids.has(entry.id)) fail(`blueprint approval index contains duplicate ${entry.id}`);
      ids.add(entry.id);
      if (priorId !== null && priorId >= entry.id) {
        fail('blueprint approval index entries are not deterministically ordered');
      }
      priorId = entry.id;
      const expectedPaths = approvedPaths(theme, template, entry.id);
      if (
        entry.blueprintPath !== expectedPaths.blueprint
        || entry.approvalPath !== expectedPaths.approval
      ) fail(`${label} paths are not fixed`);
    }
    sha256(value.fullHash, 'blueprint approval index fullHash');
    const projection = {
      schemaVersion: value.schemaVersion,
      theme: value.theme,
      templateId: value.templateId,
      entries: value.entries
    };
    const actual = sha256Bytes(Buffer.from(stableJson(projection)));
    if (actual !== value.fullHash) fail('blueprint approval index full hash mismatch');
    return value;
  } catch (error) {
    if (error.message.includes('does not exist')) {
      return {
        schemaVersion: BLUEPRINT_APPROVAL_SCHEMA,
        theme,
        templateId: template,
        entries: [],
        fullHash: null
      };
    }
    throw error;
  }
}

function finalizeApprovalIndex(value) {
  const projection = {
    schemaVersion: value.schemaVersion,
    theme: value.theme,
    templateId: value.templateId,
    entries: [...value.entries].sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0
    )
  };
  return {
    ...projection,
    fullHash: sha256Bytes(Buffer.from(stableJson(projection)))
  };
}

function validateApprovalRecord(value, {
  theme,
  template,
  mapId,
  paths,
  entry,
  promptReference,
  sourceImageSha256,
  blueprintFileSha256
}) {
  exactKeys(value, [
    'schemaVersion',
    'id',
    'theme',
    'templateId',
    'decision',
    'reviewer',
    'blueprintPath',
    'blueprintFileSha256',
    'blueprintFullHash',
    'sourceImageSha256',
    'promptProfile'
  ], 'blueprint approval record');
  exactKeys(
    value.promptProfile,
    ['id', 'path', 'sha256'],
    'blueprint approval record.promptProfile'
  );
  safeId(value.reviewer, 'blueprint approval record.reviewer');
  sha256(value.blueprintFileSha256, 'blueprint approval record.blueprintFileSha256');
  sha256(value.blueprintFullHash, 'blueprint approval record.blueprintFullHash');
  sha256(value.sourceImageSha256, 'blueprint approval record.sourceImageSha256');
  sha256(value.promptProfile.sha256, 'blueprint approval record.promptProfile.sha256');
  if (
    value.schemaVersion !== 'battle-map-blueprint-approval-v1'
    || value.id !== mapId
    || value.theme !== theme
    || value.templateId !== template
    || value.decision !== 'approved'
    || value.blueprintPath !== paths.blueprint
    || value.blueprintFileSha256 !== blueprintFileSha256
    || value.blueprintFullHash !== entry.blueprintFullHash
    || value.sourceImageSha256 !== sourceImageSha256
    || value.sourceImageSha256 !== entry.sourceImageSha256
    || value.reviewer !== entry.reviewer
    || value.promptProfile.id !== promptReference.id
    || value.promptProfile.path !== promptReference.path
    || value.promptProfile.sha256 !== promptReference.sha256
    || value.promptProfile.sha256 !== entry.promptProfileSha256
  ) fail('blueprint approval record does not match its exact reviewed inputs');
  return value;
}

async function approveBlueprintCandidateUnlocked(options, projectRoot) {
  const [loaded, promptLoaded] = await Promise.all([
    loadTemplateSidecar({
      projectRoot,
      theme: options.theme,
      template: options.template
    }),
    loadBlueprintPrompt(projectRoot)
  ]);
  const { sidecar, sidecarPath } = loaded;
  await verifySource(projectRoot, sidecar);
  if (!sidecar.candidateMaps.includes(options.mapId)) {
    fail(`map ${options.mapId} is not declared by template ${options.template}`);
  }
  const candidate = await readCandidateRecord(
    projectRoot,
    options.theme,
    options.template,
    options.mapId,
    {
      sidecar,
      promptReference: promptLoaded.reference,
      promptProfile: promptLoaded.profile
    }
  );
  if (!candidate) fail(`candidate ${options.mapId} does not exist`);
  if (candidate.metadata.sourceImageSha256 !== sidecar.sourceImage.sha256) {
    fail('candidate source-image pin no longer matches the approved template');
  }
  const paths = approvedPaths(
    options.theme,
    options.template,
    options.mapId
  );
  const approvalRecord = {
    schemaVersion: 'battle-map-blueprint-approval-v1',
    id: options.mapId,
    theme: options.theme,
    templateId: options.template,
    decision: options.decision,
    reviewer: options.reviewer,
    blueprintPath: paths.blueprint,
    blueprintFileSha256: candidate.metadata.blueprint.fileSha256,
    blueprintFullHash: candidate.metadata.blueprint.fullHash,
    sourceImageSha256: candidate.metadata.sourceImageSha256,
    promptProfile: candidate.metadata.promptProfile
  };
  if (options.decision === 'rejected') {
    const rejectionPath =
      `ai-image-metadata/battle-maps/review/${options.theme}/${options.template}/`
      + `${options.mapId}/rejection.json`;
    await atomicWrite(
      projectRoot,
      resolveWithinProject(projectRoot, rejectionPath, 'blueprint rejection path'),
      Buffer.from(`${JSON.stringify(approvalRecord, null, 2)}\n`)
    );
    return { ok: true, promoted: false, approval: approvalRecord };
  }
  const destination = resolveWithinProject(
    projectRoot,
    paths.blueprint,
    'approved blueprint path'
  );
  try {
    const existingBytes = await readFile(destination);
    if (
      !options.force
      && sha256Bytes(existingBytes) !== candidate.metadata.blueprint.fileSha256
    ) fail(`approved blueprint ${options.mapId} exists with different bytes; use --force`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const index = await loadApprovalIndex(
    projectRoot,
    paths,
    options.theme,
    options.template
  );
  const declaredIds = new Set(sidecar.candidateMaps);
  const retainedEntries = [];
  for (const entry of index.entries) {
    if (!declaredIds.has(entry.id)) {
      fail(`blueprint approval index contains undeclared map ${entry.id}`);
    }
    const stale =
      entry.sourceImageSha256 !== sidecar.sourceImage.sha256
      || entry.promptProfileSha256 !== promptLoaded.reference.sha256;
    if (stale) {
      if (!options.force) {
        fail(`blueprint approval index entry ${entry.id} has stale source or prompt pins`);
      }
      continue;
    }
    retainedEntries.push(entry);
  }
  const entries = retainedEntries
    .filter(entry => entry.id !== options.mapId)
    .concat({
      id: options.mapId,
      blueprintPath: paths.blueprint,
      approvalPath: paths.approval,
      blueprintFullHash: candidate.metadata.blueprint.fullHash,
      sourceImageSha256: candidate.metadata.sourceImageSha256,
      promptProfileSha256: candidate.metadata.promptProfile.sha256,
      reviewer: options.reviewer,
      decision: 'approved'
    });
  const nextIndex = finalizeApprovalIndex({ ...index, entries });
  const allApproved = sidecar.candidateMaps.every(id =>
    nextIndex.entries.some(entry => entry.id === id && entry.decision === 'approved')
  );
  if (options.updatePins && !allApproved) {
    fail('--update-pins requires approved entries for every declared candidate map');
  }
  await atomicCopy(projectRoot, candidate.blueprintPath, destination);
  await atomicWrite(
    projectRoot,
    resolveWithinProject(projectRoot, paths.approval, 'blueprint approval path'),
    Buffer.from(`${JSON.stringify(approvalRecord, null, 2)}\n`)
  );
  await atomicWrite(
    projectRoot,
    resolveWithinProject(projectRoot, paths.index, 'blueprint approval index path'),
    Buffer.from(`${JSON.stringify(nextIndex, null, 2)}\n`)
  );
  let sidecarUpdated = false;
  if (options.updatePins) {
    const nextSidecar = {
      ...sidecar,
      pins: {
        ...sidecar.pins,
        approvedBlueprintSha256: nextIndex.fullHash
      }
    };
    if (options.beforeSidecarUpdate) await options.beforeSidecarUpdate();
    await atomicWrite(
      projectRoot,
      sidecarPath,
      Buffer.from(`${JSON.stringify(nextSidecar, null, 2)}\n`)
    );
    sidecarUpdated = true;
  }
  return {
    ok: true,
    promoted: true,
    blueprintPath: paths.blueprint,
    approvalPath: paths.approval,
    approvalIndexPath: paths.index,
    approvalIndexFullHash: nextIndex.fullHash,
    sidecarUpdated
  };
}

export async function approveBlueprintCandidate(options) {
  const projectRoot = path.resolve(options.projectRoot ?? SCRIPT_PROJECT_ROOT);
  return withSourceTemplateLifecycleLock({
    projectRoot,
    theme: options.theme,
    template: options.template
  }, () => approveBlueprintCandidateUnlocked(options, projectRoot));
}

export async function verifyApprovedBlueprints({
  projectRoot = SCRIPT_PROJECT_ROOT,
  theme,
  template
}) {
  const root = path.resolve(projectRoot);
  const [{ sidecar }, promptLoaded] = await Promise.all([
    loadTemplateSidecar({
      projectRoot: root,
      theme,
      template
    }),
    loadBlueprintPrompt(root)
  ]);
  await verifySource(root, sidecar);
  const firstPaths = approvedPaths(theme, template, sidecar.candidateMaps[0]);
  const index = await loadApprovalIndex(root, firstPaths, theme, template);
  const declaredIds = new Set(sidecar.candidateMaps);
  for (const entry of index.entries) {
    if (!declaredIds.has(entry.id)) {
      fail(`blueprint approval index contains undeclared map ${entry.id}`);
    }
  }
  const results = [];
  for (const mapId of sidecar.candidateMaps) {
    const entry = index.entries.find(value => value.id === mapId);
    if (!entry || entry.decision !== 'approved') {
      results.push({ mapId, valid: false, error: 'missing approved entry' });
      continue;
    }
    try {
      const paths = approvedPaths(theme, template, mapId);
      const blueprintPath = resolveWithinProject(
        root,
        paths.blueprint,
        'approved blueprint path'
      );
      await assertSafeWritePath(root, blueprintPath, 'approved blueprint read path');
      const details = await lstat(blueprintPath);
      if (
        details.isSymbolicLink()
        || !details.isFile()
        || details.size < 2
        || details.size > MAX_BLUEPRINT_BYTES
      ) fail('approved blueprint file type or byte size is invalid');
      const blueprintBytes = await readFile(blueprintPath);
      const blueprintFileSha256 = sha256Bytes(blueprintBytes);
      const blueprint = parseStrictJsonBytes(blueprintBytes, 'approved blueprint');
      assertTemplateMapBlueprint(blueprint);
      if (
        blueprint.candidateId !== mapId
        || blueprint.templateId !== template
        || blueprint.dimensions.width !== sidecar.mapProfile.width
        || blueprint.dimensions.height !== sidecar.mapProfile.height
      ) fail('approved blueprint identity does not match its declared map');
      const expectedCapacities = {
        playerCapacity: sidecar.mapProfile.playerCapacity.maximum,
        candidatePoolSize: sidecar.mapProfile.candidatePoolSize,
        maxAssignableOpponents: sidecar.mapProfile.maxAssignableOpponents
      };
      for (const [key, value] of Object.entries(expectedCapacities)) {
        if (blueprint.spawn.capacities[key] !== value) {
          fail(`approved blueprint spawn capacity ${key} is stale`);
        }
      }
      const fullHash = await computeTemplateMapBlueprintFullHash(blueprint);
      if (fullHash !== entry.blueprintFullHash) {
        fail('approved blueprint canonical hash mismatch');
      }
      const approvalPath = resolveWithinProject(
        root,
        paths.approval,
        'blueprint approval record path'
      );
      await assertSafeWritePath(root, approvalPath, 'blueprint approval record read path');
      const approvalRecord = (
        await readJson(approvalPath, 'blueprint approval record')
      ).value;
      validateApprovalRecord(approvalRecord, {
        theme,
        template,
        mapId,
        paths,
        entry,
        promptReference: promptLoaded.reference,
        sourceImageSha256: sidecar.sourceImage.sha256,
        blueprintFileSha256
      });
      results.push({ mapId, valid: true, fullHash });
    } catch (error) {
      results.push({ mapId, valid: false, error: error.message });
    }
  }
  const allApproved = results.every(result => result.valid);
  const aggregatePinValid =
    allApproved
    && sidecar.pins.approvedBlueprintSha256 === index.fullHash;
  return {
    ok: allApproved && aggregatePinValid,
    theme,
    template,
    approvalIndexFullHash: index.fullHash,
    aggregatePinValid,
    results
  };
}

export const BlueprintLifecycleInternals = Object.freeze({
  candidatePaths,
  approvedPaths,
  blueprintContract,
  createBlueprintContractExample,
  auditWorkspace,
  finalizeApprovalIndex
});
