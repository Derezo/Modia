#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
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
import {
  usesBlueprintV2SemanticContract,
  validateV2BlueprintSemanticContract
} from './blueprint-v2-semantic-contract.mjs';

export {
  buildCodexWorkerEnvironment,
  CODEX_WORKER_ENV_KEYS
};

export const BLUEPRINT_PROMPT_PATH =
  'ai-image-metadata/battle-maps/prompts/map-blueprint-v1.json';
export const BLUEPRINT_PROMPT_PATH_V2 =
  'ai-image-metadata/battle-maps/prompts/map-blueprint-v2.json';
export const BLUEPRINT_PROMPT_SCHEMA =
  'battle-map-blueprint-prompt-profile-v1';
export const BLUEPRINT_PROMPT_SCHEMA_V2 =
  'battle-map-blueprint-prompt-profile-v2';
export const BLUEPRINT_CANDIDATE_SCHEMA =
  'battle-map-blueprint-candidate-record-v1';
export const BLUEPRINT_ATTEMPT_EVIDENCE_SCHEMA =
  'battle-map-blueprint-attempt-evidence-v1';
export const BLUEPRINT_APPROVAL_SCHEMA =
  'battle-map-blueprint-approval-index-v1';
export const BLUEPRINT_APPROVAL_INDEX_SCHEMA_V2 =
  'battle-map-blueprint-approval-index-v2';
export const BLUEPRINT_APPROVAL_RECORD_SCHEMA_V1 =
  'battle-map-blueprint-approval-v1';
export const BLUEPRINT_APPROVAL_RECORD_SCHEMA_V2 =
  'battle-map-blueprint-approval-v2';
export const MAX_BLUEPRINT_APPROVAL_REASON_BYTES = 1000;
export const DEFAULT_BLUEPRINT_CONCURRENCY = 2;
export const MAX_BLUEPRINT_CONCURRENCY = 4;
export const DEFAULT_BLUEPRINT_TIMEOUT_MS = 600_000;
export const MAX_BLUEPRINT_TIMEOUT_MS = 1_800_000;
export const DEFAULT_BLUEPRINT_COMPLETION_GRACE_MS = 2_000;
export const DEFAULT_BLUEPRINT_COMPLETION_POLL_MS = 100;
export const MAX_BLUEPRINT_BYTES = 2 * 1024 * 1024;
export const MAX_WORKER_LOG_BYTES = 4 * 1024 * 1024;
export const MAX_WORKSPACE_BYTES = 40 * 1024 * 1024;
export const MAX_ATTEMPT_ERROR_BYTES = 64 * 1024;
const ATTEMPT_ERROR_PREVIEW_BYTES = 24 * 1024;
const MAX_ATTEMPT_TREE_ENTRIES = 1024;
const MAX_ATTEMPT_STAGING_ORPHANS = 128;
const MAX_ATTEMPT_HISTORY_RECORDS = 64;
export const MAX_ATTEMPT_HISTORY_BYTES = 4 * MAX_WORKSPACE_BYTES;
const ATTEMPT_STAGING_FILE_PATTERN =
  /^[1-9][0-9]*\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;

const SCRIPT_PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const ID_PATTERN = /^[a-z0-9]+(?:[-_:][a-z0-9]+)*$/;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const LEGACY_BLUEPRINT_APPROVAL_TEMPLATE_PATTERN = /-template-(?:01|02)$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;
const ALLOWED_OUTPUTS = new Set(['candidate.json', 'last-message.txt']);
const INPUT_PATHS = new Set([
  'inputs/reference.png',
  'inputs/reference.webp',
  'inputs/sidecar.json',
  'inputs/contract.json'
]);
const SYSTEMD_RUN_COMMAND = '/usr/bin/systemd-run';
const SYSTEMCTL_COMMAND = '/usr/bin/systemctl';
const ENV_COMMAND = '/usr/bin/env';
const SYSTEMD_CONTROL_TIMEOUT_MS = 500;
const SYSTEMD_UNIT_CLEANUP_TIMEOUT_MS = 5_000;
const SYSTEMD_MANAGER_PROBE_TIMEOUT_MS = 500;
const SYSTEMD_CONTROLLER_CLOSE_TIMEOUT_MS = 500;
const SYSTEMD_PARENT_SHUTDOWN_TIMEOUT_MS = 1_500;
const ACTIVE_WORKER_UNITS = new Map();
let workerSignalHandlersInstalled = false;
let workerShutdownSignal = null;

function systemdWorkerUnitName() {
  return `modia-blueprint-${process.pid}-${randomUUID().replaceAll('-', '')}.service`;
}

function spawnSystemctl(
  args,
  spawnImpl = spawn,
  timeoutMs = SYSTEMD_CONTROL_TIMEOUT_MS
) {
  return new Promise(resolve => {
    let settled = false;
    let child;
    let timeout;
    const disposeChild = () => {
      for (const stream of [child?.stdin, child?.stdout, child?.stderr]) {
        try {
          stream?.destroy();
        } catch {
          // Disposal remains best-effort across injected control children.
        }
      }
      try {
        child?.unref?.();
      } catch {
        // Stream destruction above still removes referenced pipe handles.
      }
    };
    const finish = result => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve(result);
    };
    try {
      child = spawnImpl(SYSTEMCTL_COMMAND, ['--user', ...args], {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      finish({
        code: null,
        error,
        signal: null,
        stderr: '',
        stdout: '',
        timedOut: false
      });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => {
      stdout = `${stdout}${chunk}`.slice(-4_096);
    });
    child.stderr?.on('data', chunk => {
      stderr = `${stderr}${chunk}`.slice(-4_096);
    });
    child.once('error', error => {
      disposeChild();
      finish({
        code: null,
        error,
        signal: null,
        stderr,
        stdout,
        timedOut: false
      });
    });
    child.once('close', (code, signal) => {
      finish({
        code,
        error: null,
        signal,
        stderr,
        stdout,
        timedOut: false
      });
    });
    timeout = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // The bounded result below remains authoritative.
      }
      disposeChild();
      const error = new Error(
        `${path.basename(SYSTEMCTL_COMMAND)} ${args[0]} timed out after `
          + `${timeoutMs}ms`
      );
      error.code = 'BLUEPRINT_SYSTEMD_CONTROL_TIMEOUT';
      finish({
        code: null,
        error,
        signal: 'SIGKILL',
        stderr,
        stdout,
        timedOut: true
      });
    }, timeoutMs);
  });
}

function successfulSystemctl(result) {
  return !result.error && result.code === 0 && !result.timedOut;
}

async function observeWorkerUnitActivation(
  unit,
  record,
  controlTimeoutMs = SYSTEMD_CONTROL_TIMEOUT_MS
) {
  while (
    ACTIVE_WORKER_UNITS.has(unit)
    && !record.cleanupStarted
    && !record.observedLoaded
  ) {
    const status = await spawnSystemctl([
      'show',
      '--property=LoadState',
      '--value',
      unit
    ], record.systemctlSpawnImpl, controlTimeoutMs);
    const loadState = successfulSystemctl(status)
      ? status.stdout.trim()
      : '';
    if (loadState && loadState !== 'not-found') {
      record.observedLoaded = true;
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

async function ensureWorkerUnitRemoved(unit, {
  cleanupTimeoutMs = SYSTEMD_UNIT_CLEANUP_TIMEOUT_MS,
  controlTimeoutMs = SYSTEMD_CONTROL_TIMEOUT_MS,
  canAcceptUnobservedAbsence = () => false,
  markObservedLoaded = () => {},
  wasObservedLoaded = () => false,
  spawnImpl = spawn
} = {}) {
  let cleanupCycleStartedAt = Date.now();
  let observedLoaded = wasObservedLoaded();
  let sentTerm = false;
  let sentKill = false;
  while (true) {
    observedLoaded ||= wasObservedLoaded();
    const status = await spawnSystemctl([
      'show',
      '--property=LoadState',
      '--value',
      unit
    ], spawnImpl, controlTimeoutMs);
    if (!successfulSystemctl(status)) {
      await new Promise(resolve => setTimeout(resolve, 20));
      continue;
    }
    const loadState = status.stdout.trim();
    if (loadState === 'not-found') {
      if (
        observedLoaded
        || canAcceptUnobservedAbsence()
      ) return;
      await new Promise(resolve => setTimeout(resolve, 20));
      continue;
    }
    if (loadState === '') {
      await new Promise(resolve => setTimeout(resolve, 20));
      continue;
    }
    observedLoaded = true;
    markObservedLoaded();
    if (!sentTerm) {
      const term = await spawnSystemctl([
        'kill',
        '--kill-whom=all',
        '--signal=SIGTERM',
        unit
      ], spawnImpl, controlTimeoutMs);
      if (successfulSystemctl(term)) sentTerm = true;
    }
    const stop = await spawnSystemctl([
      'stop',
      '--no-block',
      unit
    ], spawnImpl, controlTimeoutMs);
    if (
      !sentKill
      && Date.now() - cleanupCycleStartedAt
        >= Math.min(1_000, cleanupTimeoutMs)
    ) {
      const kill = await spawnSystemctl([
        'kill',
        '--kill-whom=all',
        '--signal=SIGKILL',
        unit
      ], spawnImpl, controlTimeoutMs);
      if (successfulSystemctl(kill)) sentKill = true;
    }
    if (Date.now() - cleanupCycleStartedAt >= cleanupTimeoutMs) {
      cleanupCycleStartedAt = Date.now();
      sentTerm = false;
      sentKill = false;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

async function shutdownActiveWorkerUnits() {
  while (ACTIVE_WORKER_UNITS.size > 0) {
    const results = await Promise.allSettled(
      [...ACTIVE_WORKER_UNITS.entries()].map(async ([unit, record]) => {
        record.cleanupStarted = true;
        await ensureWorkerUnitRemoved(unit, {
          canAcceptUnobservedAbsence: () => (
            record.controllerClosed
            && record.controllerCloseClean
          ),
          markObservedLoaded: () => {
            record.observedLoaded = true;
          },
          spawnImpl: record.systemctlSpawnImpl,
          wasObservedLoaded: () => record.observedLoaded
        });
        await record.observerPromise;
        ACTIVE_WORKER_UNITS.delete(unit);
      })
    );
    if (results.every(result => result.status === 'fulfilled')) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

function blueprintWorkerCancellationError(reason) {
  const error = new Error(
    'Codex blueprint worker cancelled after concurrent candidate failure',
    reason === undefined ? undefined : { cause: reason }
  );
  error.code = 'BLUEPRINT_WORKER_CANCELLED';
  return error;
}

function attachSecondaryFailure(primary, secondary, context = {}) {
  try {
    if (
      !primary
      || secondary === primary
      || typeof primary !== 'object'
    ) return;
    let diagnostics;
    try {
      diagnostics = primary.secondaryFailures;
    } catch {
      return;
    }
    if (!Array.isArray(diagnostics)) {
      diagnostics = [];
      Object.defineProperty(primary, 'secondaryFailures', {
        configurable: true,
        enumerable: true,
        value: diagnostics,
        writable: false
      });
    }
    if (diagnostics.length >= 8 || Object.isFrozen(diagnostics)) return;
    const bounded = value => {
      try {
        return String(value ?? '').slice(0, 1_024);
      } catch {
        return '[unavailable]';
      }
    };
    diagnostics.push(Object.freeze({
      stage: bounded(context.stage || 'concurrent-cleanup'),
      mapId: bounded(context.mapId || ''),
      name: bounded(secondary?.name || 'Error'),
      code: bounded(secondary?.code || 'BATTLE_MAP_BLUEPRINT_LIFECYCLE_ERROR'),
      message: bounded(secondary?.message || secondary)
    }));
  } catch {
    // Secondary diagnostics must never replace the first operational failure.
  }
}

function installWorkerSignalHandlers() {
  if (workerSignalHandlersInstalled) return;
  workerSignalHandlersInstalled = true;
  for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM']) {
    const handler = () => {
      if (workerShutdownSignal !== null) return;
      workerShutdownSignal = signal;
      const shutdownDeadline = new Promise(resolve => {
        setTimeout(resolve, SYSTEMD_PARENT_SHUTDOWN_TIMEOUT_MS);
      });
      void Promise.race([
        shutdownActiveWorkerUnits(),
        shutdownDeadline
      ]).then(() => {
        process.removeListener(signal, handler);
        process.kill(process.pid, signal);
      });
    };
    process.on(signal, handler);
  }
}

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

function usesLegacyBlueprintApprovalSchema(templateId) {
  return LEGACY_BLUEPRINT_APPROVAL_TEMPLATE_PATTERN.test(templateId);
}

function blueprintApprovalSchemas(templateId) {
  return usesLegacyBlueprintApprovalSchema(templateId)
    ? {
        index: BLUEPRINT_APPROVAL_SCHEMA,
        record: BLUEPRINT_APPROVAL_RECORD_SCHEMA_V1,
        v2: false
      }
    : {
        index: BLUEPRINT_APPROVAL_INDEX_SCHEMA_V2,
        record: BLUEPRINT_APPROVAL_RECORD_SCHEMA_V2,
        v2: true
      };
}

function blueprintPromptProfile(templateId) {
  return usesLegacyBlueprintApprovalSchema(templateId)
    ? {
        id: 'map-blueprint-v1',
        path: BLUEPRINT_PROMPT_PATH,
        schema: BLUEPRINT_PROMPT_SCHEMA
      }
    : {
        id: 'map-blueprint-v2',
        path: BLUEPRINT_PROMPT_PATH_V2,
        schema: BLUEPRINT_PROMPT_SCHEMA_V2
      };
}

function approvalReason(value, label = 'approval reason') {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value !== value.trim()
    || CONTROL_CHARACTER_PATTERN.test(value)
    || Buffer.byteLength(value, 'utf8') > MAX_BLUEPRINT_APPROVAL_REASON_BYTES
  ) {
    fail(
      `${label} must be a trimmed, non-empty, non-control UTF-8 string of at most `
      + `${MAX_BLUEPRINT_APPROVAL_REASON_BYTES} bytes`
    );
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
  holderSource = CANDIDATE_LOCK_HOLDER_SOURCE,
  signal = null
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
    holderSource,
    signal
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
  allowUpdatePins = false,
  allowReason = false,
  requireReasonForNewApproval = false
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
    else if (flag === '--reason' && allowReason) once('reason', valueFor());
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
  if (options.reason !== undefined) approvalReason(options.reason, '--reason');
  if (requireReasonForNewApproval) {
    const { v2 } = blueprintApprovalSchemas(options.template);
    if (v2 && options.reason === undefined) {
      fail('--reason is required for template-03 and newer blueprint approvals');
    }
    if (!v2 && options.reason !== undefined) {
      fail('--reason is not accepted for legacy template-01/-02 approvals');
    }
  }
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

async function loadBlueprintPrompt(projectRoot, template) {
  const expected = blueprintPromptProfile(template);
  const absolutePath = resolveWithinProject(
    projectRoot,
    expected.path,
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
    value.schemaVersion !== expected.schema
    || value.id !== expected.id
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
      path: expected.path,
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
  const v2 = usesBlueprintV2SemanticContract(sidecar.id);
  const v2Variant = v2 ? variantKey(mapId) : null;
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
  const routeRecords = (v2 ? [
    {
      id: 'route:west',
      waypoints: [
        point(9, 27),
        point(9, 23),
        point(12, 20),
        point(12, 17),
        point(15, 16),
        point(14, 12),
        point(12, 10),
        point(12, 6),
        point(14, 3)
      ]
    },
    {
      id: 'route:east',
      waypoints: [
        point(22, 27),
        point(22, 23),
        point(19, 20),
        point(19, 17),
        point(16, 16),
        point(17, 12),
        point(20, 10),
        point(20, 6),
        point(18, 3)
      ]
    },
    ...(v2Variant === 'c' ? [{
      id: 'route:flank-branch',
      kind: 'secondary',
      waypoints: [
        point(14, 16),
        point(12, 16),
        point(9, 16),
        point(7, 17)
      ]
    }] : [])
  ] : [
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
  ]).map(record => ({
    id: record.id,
    kind: record.kind ?? 'primary',
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
  if (v2 && boundaries.length > 0) {
    boundaries[0].assetFamily = 'earth-face';
  }
  const roles = sidecar.spawnIntent.candidateRoles;
  const candidateCells = [];
  if (v2) {
    const localizedRows = [
      [3, [8, 13, 18, 23]],
      [5, [10, 15, 20]],
      [8, [8, 13, 18, 23]],
      [10, [10, 20]],
      [13, [8, 13, 18, 23]],
      [15, [10, 15, 20]],
      [18, [8, 13, 18, 23]]
    ];
    for (const [y, xs] of localizedRows) {
      for (const x of xs) candidateCells.push(point(x, y));
    }
  } else {
    for (const x of [21, 24, 27]) {
      for (const y of [4, 7, 10, 13, 16, 19, 22, 25]) {
        if (candidateCells.length < sidecar.mapProfile.candidatePoolSize) {
          candidateCells.push(point(x, y));
        }
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
        cells: v2
          ? playerCells.map(cell => ({ ...cell }))
          : [point(5, 25), point(10, 24), point(15, 25)],
        annotations: ['player-formation']
      },
      ...(v2
        ? [{
            id: 'opponent-formation-clearing',
            kind: 'formation-clearing',
            cells: candidateCells.map(cell => ({ ...cell })),
            annotations: ['opponent-formation']
          }]
        : []),
      {
        id: 'upper-lookout',
        kind: 'elevated-clearing',
        cells: v2
          ? [point(12, 6), point(13, 6), point(14, 6)]
          : [point(10, 6), point(16, 5), point(22, 7)],
        annotations: ['high-ground']
      },
      {
        id: 'lateral-clearing',
        kind: 'flank-clearing',
        cells: v2
          ? [point(10, 16), point(11, 16), point(12, 16)]
          : [point(7, 15), point(10, 17)],
        annotations: ['flank']
      },
      {
        id: 'central-route-junction',
        kind: 'route-junction',
        cells: v2
          ? [point(15, 15), point(15, 16), point(16, 16)]
          : [point(16, 15), point(18, 16)],
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
        cells: [point(v2 ? 18 : 16, 7)],
        featureId: 'upper-lookout',
        anchor: point(v2 ? 18 : 16, 7),
        occlusionBounds: v2
          ? { minX: 17, minY: 5, maxX: 19, maxY: 8 }
          : { minX: 15, minY: 5, maxX: 17, maxY: 8 },
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
  const variantSafeguard = usesBlueprintV2SemanticContract(sidecar.id)
    ? {
        a: `Variant A retry safeguard: use every fixed expectedAssetFamilies symbol and
build a broad compact interlocking junction with at least two internally
vertex-disjoint formation-to-formation crossings in the explicit ordered route
centerlines. No cell or edge may be the sole articulation crossing, and nearby
parallel route surfaces do not repair a shared centerline choke. Give every overlook
whose reviewed relationship names both access types one natural-slope portal and one
vertex-disjoint stair portal on different required routes. Do not spend another
attempt on a sparse composition that leaves a declared family unused or stretches the
junction into parallel route rails.`,
        b: `Variant B retry safeguard: elevated and staging clearing region cells must each
form a cardinally connected semantic area that intersects or cardinally touches a
required route. Keep required routes curved and visually distinct; never substitute
a long side-by-side parallel adjacency ladder for a compact junction.`,
        c: `Variant C retry safeguard: do not mirror or transpose the completeShapeExample.
Change the render/playable masks, elevation, connection geometry, and spawn geometry,
and author an explicit third required flank branch through or cardinally touching the
flank-clearing. The candidate must contain at least three required route segments.`
      }[variant]
    : '';
  const requiredTopologyAreaIds = usesBlueprintV2SemanticContract(sidecar.id)
    ? sidecar.topologyIntent.areas
      .filter(area => area.required === true)
      .map(area => area.id)
    : [];
  const v2SemanticSafeguard = usesBlueprintV2SemanticContract(sidecar.id)
    ? `Shared V2 composition safeguards: every non-formation tactical region must
intersect or cardinally touch a required route, and every such region with multiple
cells must form one cardinally connected set. Required routes may meet at compact
figure-eight or interlocking junctions, but must not form a long side-by-side parallel
adjacency ladder. When the reviewed intent calls for interlocking loops, the explicit
ordered primary-route centerlines must provide the required count of internally
vertex-disjoint formation-to-formation crossings; a shared articulation cell or edge
is a choke even when other route-painted cells are nearby. A reviewed mixed
slope/stair relationship requires separate boundary portals on different required
routes, with no shared portal endpoint. Author no more traversable elevation-connection records than the
fixed map width (32 on this 32 by 32 map), and at least 75% of those traversable
connections must have from or to on a required route centerline. Use a small set of
deliberate route/landmark/fork crossings; leave other elevation edges
blocked/compiler-rendered faces. Create region records for every required
topologyIntent area using these exact IDs: ${requiredTopologyAreaIds.join(', ')}.
The generic completeShapeExample region IDs are placeholders, not substitutes for
the approved sidecar IDs.`
    : '';
  const assetClosureSafeguard = usesBlueprintV2SemanticContract(sidecar.id)
    ? `
Every fixed expectedAssetFamilies symbol must be actually referenced at least
once by a matching candidate field. If both connection:slope and
connection:stairs are listed, author at least one traversable slope connection and at
least one traversable stairs connection.`
    : '';
  return `${profile.prompt}

Variant brief:
${profile.variantBriefs[variant]}
${variantSafeguard ? `\n${variantSafeguard}\n` : ''}
${v2SemanticSafeguard ? `\n${v2SemanticSafeguard}\n` : ''}

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
Keep expectedAssetFamilies byte-for-byte equivalent to
completeShapeExample.expectedAssetFamilies after canonical sorting. It is a
fixed 13-symbol compiler contract, not an inventory to rename from the authored
scene. Every material and family symbol referenced by the candidate must use
that fixed set; never invent ecology-specific replacements.${assetClosureSafeguard}
Every position in surfaceGrid and elevation must exactly follow renderMask:
when renderMask is true, surfaceGrid must contain a plain
{ material, featureId } object and elevation must contain a safe integer; when
renderMask is false, both values must be null. Never use null for a rendered
cell, non-null values for a void cell, undefined, sparse rows, or shortened
rows in any 32 by 32 grid.
Every required route must use unique playable cells ordered as a one-cell
cardinal Manhattan chain. Never use diagonal jumps, repeated route cells, or
route cells occupied by an obstacle. For every consecutive pair in every
required route, elevations must be equal or connections must contain that exact
undirected edge as a traversable bidirectional slope or stairs; merely touching
either route cell does not connect a different edge. Every obstacle cell must be inside
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
generation tool. Do not spawn or delegate to subagents; complete authoring and
validation in this worker within the configured timeout.
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
  systemctlSpawnImpl = spawn,
  systemdManagerProbeImpl = spawnSync,
  systemdControlTimeoutMs = SYSTEMD_CONTROL_TIMEOUT_MS,
  systemdCleanupTimeoutMs = SYSTEMD_UNIT_CLEANUP_TIMEOUT_MS,
  systemdControllerCloseTimeoutMs = SYSTEMD_CONTROLLER_CLOSE_TIMEOUT_MS,
  environmentSource = process.env,
  signal: cancellationSignal = null
}) {
  return new Promise((resolve, reject) => {
    if (cancellationSignal?.aborted) {
      reject(blueprintWorkerCancellationError(cancellationSignal.reason));
      return;
    }
    let managerProbe;
    try {
      managerProbe = systemdManagerProbeImpl(
        SYSTEMCTL_COMMAND,
        ['--user', 'show-environment'],
        {
          env: process.env,
          killSignal: 'SIGKILL',
          stdio: 'ignore',
          timeout: SYSTEMD_MANAGER_PROBE_TIMEOUT_MS
        }
      );
    } catch (error) {
      managerProbe = { error, status: null };
    }
    if (managerProbe?.error || managerProbe?.status !== 0) {
      const error = new Error(
        'Codex blueprint workers require an available user systemd manager '
          + 'for kernel-owned process-tree containment',
        managerProbe?.error === undefined
          ? undefined
          : { cause: managerProbe.error }
      );
      error.code = 'BLUEPRINT_WORKER_TREE_ISOLATION_UNAVAILABLE';
      error.managerProbe = {
        signal: managerProbe?.signal ?? null,
        status: managerProbe?.status ?? null,
        timedOut: managerProbe?.error?.code === 'ETIMEDOUT'
      };
      reject(error);
      return;
    }
    if (workerShutdownSignal !== null) {
      reject(new Error(
        `Codex blueprint worker launch refused during ${workerShutdownSignal} shutdown`
      ));
      return;
    }
    const unit = systemdWorkerUnitName();
    const workerEnvironment = buildCodexWorkerEnvironment(environmentSource);
    const child = spawnImpl(SYSTEMD_RUN_COMMAND, [
      '--user',
      '--quiet',
      '--wait',
      '--collect',
      '--pipe',
      `--unit=${unit}`,
      '--service-type=exec',
      '--property=KillMode=control-group',
      '--property=TimeoutStopSec=1s',
      `--property=RuntimeMaxSec=${
        Math.max(
          1,
          Math.ceil((timeoutMs + Math.max(0, systemdCleanupTimeoutMs)) / 1_000)
        )
      }s`,
      `--working-directory=${cwd}`,
      ENV_COMMAND,
      '-i',
      ...Object.entries(workerEnvironment).map(([key, value]) => (
        `${key}=${value}`
      )),
      command,
      ...args
    ], {
      cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false
    });
    installWorkerSignalHandlers();
    const workerUnitRecord = {
      cleanupStarted: false,
      controllerCloseClean: false,
      controllerClosed: false,
      observedLoaded: false,
      observerPromise: null,
      systemctlSpawnImpl
    };
    ACTIVE_WORKER_UNITS.set(unit, workerUnitRecord);
    workerUnitRecord.observerPromise = observeWorkerUnitActivation(
      unit,
      workerUnitRecord,
      systemdControlTimeoutMs
    );
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timeout = null;
    let completionPoll = null;
    let terminalFailure = null;
    let intentionalCompletion = null;
    let stableCandidate = null;
    let candidatePollRunning = false;
    let workerProcessCleaned = false;
    let abortHandler = null;
    let containmentCleanupPromise = null;
    let controllerTransportFailed = false;
    let controllerSettlementStarted = false;
    let controllerKillTimer = null;
    let controllerSettlementTimer = null;
    const stopCandidateMonitor = () => {
      if (completionPoll) clearTimeout(completionPoll);
      completionPoll = null;
    };
    const cleanupWorkerProcess = () => {
      if (workerProcessCleaned) return;
      workerProcessCleaned = true;
      ACTIVE_WORKER_UNITS.delete(unit);
    };
    const finish = (callback, result) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (controllerKillTimer) clearTimeout(controllerKillTimer);
      if (controllerSettlementTimer) clearTimeout(controllerSettlementTimer);
      stopCandidateMonitor();
      if (abortHandler) {
        cancellationSignal.removeEventListener('abort', abortHandler);
        abortHandler = null;
      }
      if (workerShutdownSignal !== null) return;
      callback(result);
    };
    const beginContainmentCleanup = () => {
      workerUnitRecord.cleanupStarted = true;
      containmentCleanupPromise ??= ensureWorkerUnitRemoved(unit, {
        cleanupTimeoutMs: systemdCleanupTimeoutMs,
        controlTimeoutMs: systemdControlTimeoutMs,
        canAcceptUnobservedAbsence: () => (
          workerUnitRecord.controllerClosed
          && workerUnitRecord.controllerCloseClean
        ),
        markObservedLoaded: () => {
          workerUnitRecord.observedLoaded = true;
        },
        spawnImpl: systemctlSpawnImpl,
        wasObservedLoaded: () => workerUnitRecord.observedLoaded
      });
      return containmentCleanupPromise;
    };
    const settleControllerProcess = async (code, signal) => {
      if (controllerSettlementStarted) return;
      controllerSettlementStarted = true;
      if (controllerKillTimer) clearTimeout(controllerKillTimer);
      if (controllerSettlementTimer) clearTimeout(controllerSettlementTimer);
      let containmentCleanupError = null;
      try {
        await beginContainmentCleanup();
        await workerUnitRecord.observerPromise;
        cleanupWorkerProcess();
      } catch (error) {
        containmentCleanupError = error;
      }
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
        if (containmentCleanupError) {
          attachSecondaryFailure(terminalFailure, containmentCleanupError, {
            stage: 'worker-unit-cleanup'
          });
        }
        terminalFailure.workerResult = result;
        finish(reject, terminalFailure);
      } else if (containmentCleanupError) {
        containmentCleanupError.workerResult = result;
        finish(reject, containmentCleanupError);
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
        finish(reject, error);
      } else finish(resolve, result);
    };
    const terminateControllerAfterUnload = () => {
      if (workerUnitRecord.controllerClosed || settled) return;
      try {
        child.kill('SIGTERM');
      } catch {
        // The controller is trusted and the exact worker unit is already gone.
      }
      if (workerUnitRecord.controllerClosed || settled) return;
      controllerKillTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // Bounded synthetic settlement below does not depend on this signal.
        }
      }, Math.min(100, systemdControllerCloseTimeoutMs));
      controllerSettlementTimer = setTimeout(() => {
        if (workerUnitRecord.controllerClosed || settled) return;
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref?.();
        void settleControllerProcess(null, 'SIGKILL');
      }, systemdControllerCloseTimeoutMs);
    };
    const terminate = () => {
      void beginContainmentCleanup().then(terminateControllerAfterUnload);
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
    child.once('error', error => {
      controllerTransportFailed = true;
      failAfterTermination(error);
    });
    child.once('close', async (code, signal) => {
      workerUnitRecord.controllerClosed = true;
      workerUnitRecord.controllerCloseClean = (
        !controllerTransportFailed
        && code === 0
        && signal === null
      );
      await settleControllerProcess(code, signal);
    });
    if (cancellationSignal) {
      abortHandler = () => failAfterTermination(
        blueprintWorkerCancellationError(cancellationSignal.reason)
      );
      if (cancellationSignal.aborted) abortHandler();
      else {
        cancellationSignal.addEventListener('abort', abortHandler, {
          once: true
        });
      }
    }
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
      if (error.code !== 'EPIPE') failAfterTermination(error);
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
  textTemplateFallback = false,
  signal = null
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
    completionPollMs,
    signal
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
  const parent =
    `ai-image-metadata/battle-maps/candidates/${theme}/${template}/blueprints`;
  const root = `${parent}/${mapId}`;
  return {
    root,
    blueprint: `${root}/candidate.json`,
    metadata: `${root}/result.json`,
    prompt: `${root}/prompt.txt`,
    stdout: `${root}/worker.jsonl`,
    stderr: `${root}/worker.stderr.log`,
    lastMessage: `${root}/last-message.txt`,
    attemptHistoryRoot: `${parent}/.attempt-history/${mapId}`,
    attemptStagingRoot: `${parent}/.attempt-staging/${mapId}`
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
  if (sidecar && usesBlueprintV2SemanticContract(sidecar.id)) {
    validateV2BlueprintSemanticContract(blueprint, sidecar);
  }
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
  if (usesBlueprintV2SemanticContract(sidecar.id)) {
    validateV2BlueprintSemanticContract(blueprint, sidecar);
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

async function readRegularAttemptEvidence(filePath, label, maximumBytes) {
  let pathBefore;
  try {
    pathBefore = await lstat(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (pathBefore.isSymbolicLink() || !pathBefore.isFile()) {
    fail(
      `${label} must be a regular non-symlink file`,
      'UNSAFE_BLUEPRINT_ATTEMPT_EVIDENCE'
    );
  }
  if (pathBefore.size > maximumBytes) {
    fail(
      `${label} exceeds the evidence limit of ${maximumBytes} bytes`,
      'BLUEPRINT_ATTEMPT_EVIDENCE_LIMIT'
    );
  }

  let handle;
  try {
    handle = await open(
      filePath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
    );
  } catch (error) {
    if (error.code === 'ENOENT') {
      fail(`${label} disappeared while being captured`, 'BLUEPRINT_ATTEMPT_EVIDENCE_DRIFT');
    }
    if (error.code === 'ELOOP') {
      fail(
        `${label} must be a regular non-symlink file`,
        'UNSAFE_BLUEPRINT_ATTEMPT_EVIDENCE'
      );
    }
    throw error;
  }

  try {
    const openedBefore = await handle.stat();
    if (
      !openedBefore.isFile()
      || openedBefore.dev !== pathBefore.dev
      || openedBefore.ino !== pathBefore.ino
      || openedBefore.size !== pathBefore.size
      || openedBefore.mtimeMs !== pathBefore.mtimeMs
    ) {
      fail(`${label} changed while being opened`, 'BLUEPRINT_ATTEMPT_EVIDENCE_DRIFT');
    }
    const bytes = await handle.readFile();
    const [openedAfter, pathAfter] = await Promise.all([
      handle.stat(),
      lstat(filePath).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      })
    ]);
    if (
      !pathAfter
      || pathAfter.isSymbolicLink()
      || !pathAfter.isFile()
      || openedAfter.dev !== openedBefore.dev
      || openedAfter.ino !== openedBefore.ino
      || openedAfter.size !== openedBefore.size
      || openedAfter.mtimeMs !== openedBefore.mtimeMs
      || pathAfter.dev !== openedBefore.dev
      || pathAfter.ino !== openedBefore.ino
      || pathAfter.size !== openedBefore.size
      || pathAfter.mtimeMs !== openedBefore.mtimeMs
      || bytes.byteLength !== openedBefore.size
    ) {
      fail(`${label} changed while being captured`, 'BLUEPRINT_ATTEMPT_EVIDENCE_DRIFT');
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function collectBoundedTreeEvidence({
  root,
  artifactPrefix,
  before = null,
  changedOnly = false,
  afterDirectoryRead = async () => {},
  label
}) {
  const artifacts = new Map();
  const identities = new Map();
  const entries = [];
  const uncapturable = [];
  let totalRegularBytes = 0;
  let entryCount = 0;
  let truncated = false;
  let unstableDirectory = false;
  const observedPaths = new Set();
  const recordUncapturable = (relative, code, message) => {
    const failure = { path: relative, code, message };
    uncapturable.push(failure);
    return failure;
  };
  async function visit(directory, prefix = '', expectedDirectory = null) {
    let directoryBefore;
    try {
      directoryBefore = await lstat(directory);
    } catch (error) {
      const relative = prefix || '.';
      entries.push({
        path: relative,
        type: 'directory',
        captured: false,
        error: recordUncapturable(
          relative,
          typeof error.code === 'string'
            ? error.code
            : 'BLUEPRINT_ATTEMPT_EVIDENCE_CAPTURE_ERROR',
          error.message
        )
      });
      return;
    }
    if (
      directoryBefore.isSymbolicLink()
      || !directoryBefore.isDirectory()
      || (
        expectedDirectory
        && (
          directoryBefore.dev !== expectedDirectory.dev
          || directoryBefore.ino !== expectedDirectory.ino
        )
      )
    ) {
      unstableDirectory = true;
      const relative = prefix || '.';
      entries.push({
        path: relative,
        type: directoryBefore.isSymbolicLink() ? 'symlink' : 'directory',
        captured: false,
        error: recordUncapturable(
          relative,
          'UNSAFE_BLUEPRINT_ATTEMPT_EVIDENCE',
          `${label} directory identity is unsafe or changed`
        )
      });
      return;
    }
    identities.set(prefix || '.', {
      type: 'directory',
      dev: directoryBefore.dev,
      ino: directoryBefore.ino
    });
    let children;
    try {
      children = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      const relative = prefix || '.';
      entries.push({
        path: relative,
        type: 'directory',
        captured: false,
        error: recordUncapturable(
          relative,
          typeof error.code === 'string'
            ? error.code
            : 'BLUEPRINT_ATTEMPT_EVIDENCE_CAPTURE_ERROR',
          error.message
        )
      });
      return;
    }
    children.sort((left, right) => left.name.localeCompare(right.name));
    await afterDirectoryRead({
      root,
      directory,
      relative: prefix || '.'
    });
    const directoryAfterRead = await lstat(directory).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (
      !directoryAfterRead
      || directoryAfterRead.isSymbolicLink()
      || !directoryAfterRead.isDirectory()
      || directoryAfterRead.dev !== directoryBefore.dev
      || directoryAfterRead.ino !== directoryBefore.ino
    ) {
      unstableDirectory = true;
      recordUncapturable(
        prefix || '.',
        'BLUEPRINT_ATTEMPT_EVIDENCE_DRIFT',
        `${label} directory changed before child capture`
      );
      return;
    }
    for (const child of children) {
      const relative = prefix ? `${prefix}/${child.name}` : child.name;
      observedPaths.add(relative);
      entryCount += 1;
      if (entryCount > MAX_ATTEMPT_TREE_ENTRIES) {
        if (!truncated) {
          truncated = true;
          recordUncapturable(
            relative,
            'BLUEPRINT_ATTEMPT_EVIDENCE_ENTRY_LIMIT',
            `${label} exceeds ${MAX_ATTEMPT_TREE_ENTRIES} entries`
          );
        }
        continue;
      }
      const absolute = path.join(directory, child.name);
      let details;
      try {
        details = await lstat(absolute);
      } catch (error) {
        entries.push({
          path: relative,
          type: 'unknown',
          captured: false,
          error: recordUncapturable(
            relative,
            typeof error.code === 'string'
              ? error.code
              : 'BLUEPRINT_ATTEMPT_EVIDENCE_CAPTURE_ERROR',
            error.message
          )
        });
        continue;
      }
      if (details.isSymbolicLink()) {
        entries.push({
          path: relative,
          type: 'symlink',
          captured: false,
          error: recordUncapturable(
            relative,
            'UNSAFE_BLUEPRINT_ATTEMPT_EVIDENCE',
            `${label} contains a forbidden symlink`
          )
        });
        continue;
      }
      if (details.isDirectory()) {
        identities.set(relative, {
          type: 'directory',
          dev: details.dev,
          ino: details.ino
        });
        entries.push({
          path: relative,
          type: 'directory',
          changed: !before?.has(relative),
          captured: true
        });
        await visit(absolute, relative, details);
        continue;
      }
      if (!details.isFile()) {
        entries.push({
          path: relative,
          type: 'special',
          captured: false,
          error: recordUncapturable(
            relative,
            'UNSAFE_BLUEPRINT_ATTEMPT_EVIDENCE',
            `${label} contains an unsupported special entry`
          )
        });
        continue;
      }
      if (
        details.size > MAX_WORKSPACE_BYTES
        || totalRegularBytes + details.size > MAX_WORKSPACE_BYTES
      ) {
        entries.push({
          path: relative,
          type: 'file',
          bytes: details.size,
          captured: false,
          error: recordUncapturable(
            relative,
            'BLUEPRINT_ATTEMPT_EVIDENCE_LIMIT',
            `${label} exceeds ${MAX_WORKSPACE_BYTES} captured bytes`
          )
        });
        continue;
      }
      try {
        const bytes = await readRegularAttemptEvidence(
          absolute,
          `${label} ${relative}`,
          MAX_WORKSPACE_BYTES
        );
        if (!bytes) {
          fail(
            `${label} ${relative} disappeared while being captured`,
            'BLUEPRINT_ATTEMPT_EVIDENCE_DRIFT'
          );
        }
        totalRegularBytes += bytes.byteLength;
        const sha256 = sha256Bytes(bytes);
        identities.set(relative, {
          type: 'file',
          dev: details.dev,
          ino: details.ino,
          bytes: bytes.byteLength,
          mtimeMs: details.mtimeMs,
          sha256
        });
        const previous = before?.get(relative);
        const changed = (
          !previous
          || previous.type !== 'file'
          || previous.bytes !== bytes.byteLength
          || previous.sha256 !== sha256
        );
        entries.push({
          path: relative,
          type: 'file',
          bytes: bytes.byteLength,
          sha256,
          changed,
          captured: !changedOnly || changed
        });
        if (!changedOnly || changed) {
          artifacts.set(`${artifactPrefix}/${relative}`, bytes);
        }
      } catch (error) {
        entries.push({
          path: relative,
          type: 'file',
          bytes: details.size,
          captured: false,
          error: recordUncapturable(
            relative,
            typeof error.code === 'string'
              ? error.code
              : 'BLUEPRINT_ATTEMPT_EVIDENCE_CAPTURE_ERROR',
            error.message
          )
        });
      }
    }
    const directoryAfter = await lstat(directory).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (
      !directoryAfter
      || directoryAfter.isSymbolicLink()
      || !directoryAfter.isDirectory()
      || directoryAfter.dev !== directoryBefore.dev
      || directoryAfter.ino !== directoryBefore.ino
    ) {
      unstableDirectory = true;
      recordUncapturable(
        prefix || '.',
        'BLUEPRINT_ATTEMPT_EVIDENCE_DRIFT',
        `${label} directory changed during no-follow capture`
      );
    }
  }
  await visit(root);
  const missingFromBefore = before
    ? [...before.keys()]
        .filter(relative => !observedPaths.has(relative))
        .sort()
    : [];
  const manifest = {
    schemaVersion: BLUEPRINT_ATTEMPT_EVIDENCE_SCHEMA,
    label,
    noFollow: true,
    changedOnly,
    entryLimit: MAX_ATTEMPT_TREE_ENTRIES,
    capturedByteLimit: MAX_WORKSPACE_BYTES,
    observedEntries: entryCount,
    totalRegularBytes,
    truncated,
    missingFromBefore,
    captureFailures: uncapturable,
    entries
  };
  const manifestBytes = Buffer.from(`${stableJson(manifest)}\n`);
  if (manifestBytes.byteLength > MAX_WORKER_LOG_BYTES) {
    fail(
      `${label} manifest exceeds ${MAX_WORKER_LOG_BYTES} bytes`,
      'BLUEPRINT_ATTEMPT_EVIDENCE_LIMIT'
    );
  }
  return {
    artifacts,
    identities,
    manifestBytes,
    uncapturable,
    unstableDirectory
  };
}

function attemptArtifactPin(file, bytes) {
  return {
    file,
    bytes: bytes.byteLength,
    sha256: sha256Bytes(bytes)
  };
}

function structuredAttemptError(error, workerResult, captureFailures) {
  const nullableString = value => (
    typeof value === 'string' && value.length > 0 ? value : null
  );
  return {
    schemaVersion: BLUEPRINT_ATTEMPT_EVIDENCE_SCHEMA,
    parentError: {
      name: nullableString(error?.name) ?? 'Error',
      code: nullableString(error?.code) ?? 'BATTLE_MAP_BLUEPRINT_LIFECYCLE_ERROR',
      message: nullableString(error?.message) ?? String(error)
    },
    workerProcess: workerResult
      ? {
          code: Number.isSafeInteger(workerResult.code) ? workerResult.code : null,
          signal: nullableString(workerResult.signal),
          completionReason: nullableString(workerResult.completionReason),
          intentionallyTerminated: workerResult.intentionallyTerminated === true,
          completedCandidateSha256:
            nullableString(workerResult.completedCandidateSha256)
        }
      : null,
    captureFailures
  };
}

function boundedAttemptErrorBytes(errorRecord) {
  const original = Buffer.from(stableJson(errorRecord));
  const serialization = {
    encoding: 'stable-json-utf8',
    originalBytes: original.byteLength,
    originalSha256: sha256Bytes(original),
    truncated: false
  };
  let bounded = {
    ...errorRecord,
    serialization
  };
  let bytes = Buffer.from(`${stableJson(bounded)}\n`);
  if (bytes.byteLength <= MAX_ATTEMPT_ERROR_BYTES) return bytes;
  const boundedField = (value, maximumBytes) => {
    const originalField = Buffer.from(String(value));
    const truncatedField = originalField.byteLength > maximumBytes;
    return {
      value: truncatedField
        ? originalField.subarray(0, maximumBytes).toString('utf8')
        : String(value),
      serialization: {
        originalBytes: originalField.byteLength,
        originalSha256: sha256Bytes(originalField),
        truncated: truncatedField
      }
    };
  };
  const boundedName = boundedField(errorRecord.parentError.name, 1024);
  const boundedCode = boundedField(errorRecord.parentError.code, 1024);
  const boundedMessage = boundedField(errorRecord.parentError.message, 8192);
  bounded = {
    schemaVersion: BLUEPRINT_ATTEMPT_EVIDENCE_SCHEMA,
    parentError: {
      name: boundedName.value,
      code: boundedCode.value,
      message: boundedMessage.value,
      serialization: {
        name: boundedName.serialization,
        code: boundedCode.serialization,
        message: boundedMessage.serialization
      }
    },
    serialization: {
      ...serialization,
      truncated: true
    },
    previewEncoding: 'base64',
    preview: original.subarray(0, ATTEMPT_ERROR_PREVIEW_BYTES).toString('base64')
  };
  bytes = Buffer.from(`${stableJson(bounded)}\n`);
  if (bytes.byteLength > MAX_ATTEMPT_ERROR_BYTES) {
    fail(
      'bounded blueprint attempt error evidence exceeds its fixed limit',
      'BLUEPRINT_ATTEMPT_EVIDENCE_LIMIT'
    );
  }
  return bytes;
}

async function loadAttemptStagingOrphans(projectRoot, stagingRoot) {
  await assertSafeWritePath(
    projectRoot,
    stagingRoot,
    'blueprint attempt staging path'
  );
  let stagingDetails;
  try {
    stagingDetails = await lstat(stagingRoot);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  if (stagingDetails.isSymbolicLink() || !stagingDetails.isDirectory()) {
    fail(
      'blueprint attempt staging path must be a regular directory',
      'UNSAFE_BLUEPRINT_ATTEMPT_EVIDENCE'
    );
  }
  const candidates = [];
  let totalBytes = 0;
  const entries = await readdir(stagingRoot, { withFileTypes: true });
  if (entries.length > MAX_ATTEMPT_TREE_ENTRIES) {
    fail(
      'blueprint attempt staging directory exceeds its fixed entry bound',
      'BLUEPRINT_ATTEMPT_EVIDENCE_LIMIT'
    );
  }
  for (const entry of entries) {
    if (!ATTEMPT_STAGING_FILE_PATTERN.test(entry.name)) continue;
    const absolute = path.join(stagingRoot, entry.name);
    const details = await lstat(absolute);
    if (details.isSymbolicLink() || !details.isFile()) {
      fail(
        `blueprint attempt staging orphan is unsafe: ${entry.name}`,
        'UNSAFE_BLUEPRINT_ATTEMPT_EVIDENCE'
      );
    }
    candidates.push({ absolute, details });
    totalBytes += details.size;
  }
  if (
    candidates.length > MAX_ATTEMPT_STAGING_ORPHANS
    || totalBytes > MAX_WORKSPACE_BYTES
  ) {
    fail(
      'blueprint attempt staging orphan accumulation exceeds its fixed bounds',
      'BLUEPRINT_ATTEMPT_EVIDENCE_LIMIT'
    );
  }
  const staged = [];
  for (const candidate of candidates) {
    let handle;
    try {
      handle = await open(
        candidate.absolute,
        fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
      );
      const opened = await handle.stat();
      if (
        !opened.isFile()
        || opened.dev !== candidate.details.dev
        || opened.ino !== candidate.details.ino
        || opened.size !== candidate.details.size
        || opened.mtimeMs !== candidate.details.mtimeMs
      ) {
        fail(
          'blueprint attempt staging orphan changed while being reclaimed',
          'BLUEPRINT_ATTEMPT_EVIDENCE_DRIFT'
        );
      }
    } catch (error) {
      if (error.code === 'ELOOP') {
        fail(
          'blueprint attempt staging orphan became a symlink',
          'UNSAFE_BLUEPRINT_ATTEMPT_EVIDENCE'
        );
      }
      throw error;
    } finally {
      await handle?.close();
    }
    const current = await lstat(candidate.absolute).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (
      !current
      || current.isSymbolicLink()
      || !current.isFile()
      || current.dev !== candidate.details.dev
      || current.ino !== candidate.details.ino
      || current.size !== candidate.details.size
      || current.mtimeMs !== candidate.details.mtimeMs
    ) {
      fail(
        'blueprint attempt staging orphan changed before reclamation',
        'BLUEPRINT_ATTEMPT_EVIDENCE_DRIFT'
      );
    }
    const bytes = await readRegularAttemptEvidence(
      candidate.absolute,
      'blueprint attempt staging orphan',
      MAX_WORKSPACE_BYTES
    );
    if (!bytes) {
      fail(
        'blueprint attempt staging orphan disappeared during reconciliation',
        'BLUEPRINT_ATTEMPT_EVIDENCE_DRIFT'
      );
    }
    staged.push({ ...candidate, bytes });
  }
  return staged;
}

async function writeImmutableAttemptFile(
  projectRoot,
  filePath,
  bytes,
  stagingRoot,
  stagedOrphans
) {
  await assertSafeWritePath(projectRoot, filePath, 'blueprint attempt evidence path');
  await mkdir(path.dirname(filePath), { recursive: true });
  await assertSafeWritePath(projectRoot, filePath, 'blueprint attempt evidence path');
  await assertSafeWritePath(
    projectRoot,
    stagingRoot,
    'blueprint attempt staging path'
  );
  await mkdir(stagingRoot, { recursive: true });
  await assertSafeWritePath(
    projectRoot,
    stagingRoot,
    'blueprint attempt staging path'
  );
  const stagedIndex = stagedOrphans.findIndex(
    candidate => candidate.bytes.equals(bytes)
  );
  const staged = stagedIndex === -1
    ? null
    : stagedOrphans.splice(stagedIndex, 1)[0];
  const temporaryPath = staged?.absolute ?? path.join(
    stagingRoot,
    `${process.pid}.${randomUUID()}.tmp`
  );
  await assertSafeWritePath(
    projectRoot,
    temporaryPath,
    'blueprint attempt staging path'
  );
  let handle;
  let durablePublished = false;
  try {
    if (!staged) {
      handle = await open(temporaryPath, 'wx', 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = null;
    }
    try {
      await link(temporaryPath, filePath);
      durablePublished = true;
      return true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const existing = await readRegularAttemptEvidence(
      filePath,
      'existing blueprint attempt evidence',
      Math.max(bytes.byteLength, 1)
    );
    if (!existing || !existing.equals(bytes)) {
      fail(
        `immutable blueprint attempt evidence conflicts at ${filePath}`,
        'BLUEPRINT_ATTEMPT_EVIDENCE_CONFLICT'
      );
    }
    durablePublished = true;
    return false;
  } finally {
    await handle?.close();
    if (durablePublished) {
      await unlink(temporaryPath).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }
}

async function assertAttemptHistoryCapacity({
  projectRoot,
  historyRoot,
  currentAttemptName,
  additionalBytes,
  historyByteLimit
}) {
  await assertSafeWritePath(
    projectRoot,
    historyRoot,
    'blueprint attempt-history root'
  );
  let entries;
  try {
    entries = await readdir(historyRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      if (additionalBytes > historyByteLimit) {
        fail(
          'blueprint attempt history retention limit is exhausted; '
          + 'current failure evidence remains quarantined locally',
          'BLUEPRINT_ATTEMPT_HISTORY_LIMIT'
        );
      }
      return;
    }
    throw error;
  }
  let recordCount = 0;
  let historyBytes = 0;
  let observedEntries = 0;
  async function measure(directory) {
    const children = await readdir(directory, { withFileTypes: true });
    for (const child of children) {
      observedEntries += 1;
      if (
        observedEntries
        > MAX_ATTEMPT_HISTORY_RECORDS * MAX_ATTEMPT_TREE_ENTRIES
      ) {
        fail(
          'blueprint attempt history exceeds its fixed entry bound',
          'BLUEPRINT_ATTEMPT_EVIDENCE_LIMIT'
        );
      }
      const absolute = path.join(directory, child.name);
      const details = await lstat(absolute);
      if (details.isSymbolicLink()) {
        fail(
          'blueprint attempt history contains a forbidden symlink',
          'UNSAFE_BLUEPRINT_ATTEMPT_EVIDENCE'
        );
      }
      if (details.isDirectory()) await measure(absolute);
      else if (details.isFile()) historyBytes += details.size;
      else {
        fail(
          'blueprint attempt history contains a special entry',
          'UNSAFE_BLUEPRINT_ATTEMPT_EVIDENCE'
        );
      }
    }
  }
  for (const entry of entries) {
    if (entry.name === currentAttemptName) continue;
    if (!/^[0-9a-f]{64}$/.test(entry.name)) {
      fail(
        `blueprint attempt history contains unexpected entry ${entry.name}`,
        'BLUEPRINT_ATTEMPT_EVIDENCE_CONFLICT'
      );
    }
    const absolute = path.join(historyRoot, entry.name);
    const details = await lstat(absolute);
    if (details.isSymbolicLink() || !details.isDirectory()) {
      fail(
        `blueprint attempt history record is unsafe: ${entry.name}`,
        'UNSAFE_BLUEPRINT_ATTEMPT_EVIDENCE'
      );
    }
    recordCount += 1;
    await measure(absolute);
  }
  if (
    recordCount + 1 > MAX_ATTEMPT_HISTORY_RECORDS
    || historyBytes + additionalBytes > historyByteLimit
  ) {
    fail(
      'blueprint attempt history retention limit is exhausted; '
      + 'current failure evidence remains quarantined locally',
      'BLUEPRINT_ATTEMPT_HISTORY_LIMIT'
    );
  }
}

function unmatchedStagingBytes(stagedOrphans, expectedArtifacts) {
  const expected = expectedArtifacts.map(bytes => ({
    bytes,
    sha256: sha256Bytes(bytes),
    matched: false
  }));
  let unmatchedBytes = 0;
  for (const staged of stagedOrphans) {
    const stagedSha256 = sha256Bytes(staged.bytes);
    const match = expected.find(candidate => (
      !candidate.matched
      && candidate.sha256 === stagedSha256
      && candidate.bytes.byteLength === staged.bytes.byteLength
      && candidate.bytes.equals(staged.bytes)
    ));
    if (match) match.matched = true;
    else unmatchedBytes += staged.bytes.byteLength;
  }
  return unmatchedBytes;
}

async function publishAttemptEvidence({
  projectRoot,
  paths,
  theme,
  template,
  mapId,
  outcome,
  artifactBytes,
  historyByteLimit = MAX_ATTEMPT_HISTORY_BYTES
}) {
  for (const file of artifactBytes.keys()) {
    if (
      typeof file !== 'string'
      || file.length === 0
      || path.posix.isAbsolute(file)
      || path.posix.normalize(file) !== file
      || file === '..'
      || file.startsWith('../')
    ) {
      fail(
        `invalid blueprint attempt artifact path ${String(file)}`,
        'UNSAFE_BLUEPRINT_ATTEMPT_EVIDENCE'
      );
    }
  }
  const artifacts = Object.fromEntries(
    [...artifactBytes].map(([file, bytes]) => [file, attemptArtifactPin(file, bytes)])
  );
  const identity = {
    schemaVersion: BLUEPRINT_ATTEMPT_EVIDENCE_SCHEMA,
    id: mapId,
    theme,
    templateId: template,
    outcome,
    artifacts
  };
  const contentHash = sha256Bytes(Buffer.from(stableJson(identity)));
  const record = {
    ...identity,
    contentHash
  };
  const recordBytes = Buffer.from(`${stableJson(record)}\n`);
  const aggregateBytes = (
    recordBytes.byteLength
    + [...artifactBytes.values()].reduce(
      (total, bytes) => total + bytes.byteLength,
      0
    )
  );
  if (aggregateBytes > MAX_WORKSPACE_BYTES) {
    fail(
      `blueprint attempt evidence exceeds the aggregate `
      + `${MAX_WORKSPACE_BYTES}-byte limit`,
      'BLUEPRINT_ATTEMPT_EVIDENCE_LIMIT'
    );
  }
  const attemptRoot = resolveWithinProject(
    projectRoot,
    `${paths.attemptHistoryRoot}/${contentHash.slice('sha256:'.length)}`,
    'blueprint attempt-history path'
  );
  const historyRoot = path.dirname(attemptRoot);
  const stagingRoot = resolveWithinProject(
    projectRoot,
    paths.attemptStagingRoot,
    'blueprint attempt staging path'
  );
  const stagedOrphans = await loadAttemptStagingOrphans(
    projectRoot,
    stagingRoot
  );
  const retainedStagingBytes = unmatchedStagingBytes(
    stagedOrphans,
    [...artifactBytes.values(), recordBytes]
  );
  await assertAttemptHistoryCapacity({
    projectRoot,
    historyRoot,
    currentAttemptName: path.basename(attemptRoot),
    additionalBytes:
      aggregateBytes
      + retainedStagingBytes,
    historyByteLimit
  });
  await assertSafeWritePath(
    projectRoot,
    attemptRoot,
    'blueprint attempt-history path'
  );
  await mkdir(attemptRoot, { recursive: true });
  await assertSafeWritePath(
    projectRoot,
    attemptRoot,
    'blueprint attempt-history path'
  );
  const attemptDetails = await lstat(attemptRoot);
  if (attemptDetails.isSymbolicLink() || !attemptDetails.isDirectory()) {
    fail(
      'blueprint attempt-history path must be a regular directory',
      'UNSAFE_BLUEPRINT_ATTEMPT_EVIDENCE'
    );
  }
  for (const [file, bytes] of artifactBytes) {
    await writeImmutableAttemptFile(
      projectRoot,
      path.join(attemptRoot, file),
      bytes,
      stagingRoot,
      stagedOrphans
    );
  }
  await writeImmutableAttemptFile(
    projectRoot,
    path.join(attemptRoot, 'attempt.json'),
    recordBytes,
    stagingRoot,
    stagedOrphans
  );

  const expectedBytes = new Map(artifactBytes);
  expectedBytes.set('attempt.json', recordBytes);
  const expectedFiles = new Set(expectedBytes.keys());
  const expectedDirectories = new Set();
  for (const file of expectedFiles) {
    let directory = path.posix.dirname(file);
    while (directory !== '.') {
      expectedDirectories.add(directory);
      directory = path.posix.dirname(directory);
    }
  }
  const actualFiles = new Set();
  const actualDirectories = new Set();
  async function inspect(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      const details = await lstat(absolute);
      if (details.isSymbolicLink()) {
        fail(
          `immutable blueprint attempt evidence contains unsafe entry ${relative}`,
          'UNSAFE_BLUEPRINT_ATTEMPT_EVIDENCE'
        );
      }
      if (details.isDirectory()) {
        actualDirectories.add(relative);
        await inspect(absolute, relative);
      } else if (details.isFile()) {
        actualFiles.add(relative);
      } else {
        fail(
          `immutable blueprint attempt evidence contains unsafe entry ${relative}`,
          'UNSAFE_BLUEPRINT_ATTEMPT_EVIDENCE'
        );
      }
    }
  }
  await inspect(attemptRoot);
  if (
    actualFiles.size !== expectedFiles.size
    || actualDirectories.size !== expectedDirectories.size
    || [...actualFiles].some(file => !expectedFiles.has(file))
    || [...actualDirectories].some(directory => !expectedDirectories.has(directory))
  ) {
    fail(
      'immutable blueprint attempt evidence contains conflicting entries',
      'BLUEPRINT_ATTEMPT_EVIDENCE_CONFLICT'
    );
  }
  for (const [file, bytes] of expectedBytes) {
    const verified = await readRegularAttemptEvidence(
      path.join(attemptRoot, file),
      `immutable blueprint attempt evidence ${file}`,
      Math.max(bytes.byteLength, 1)
    );
    if (!verified || !verified.equals(bytes)) {
      fail(
        `immutable blueprint attempt evidence drifted at ${file}`,
        'BLUEPRINT_ATTEMPT_EVIDENCE_CONFLICT'
      );
    }
  }
  return {
    path: path.relative(projectRoot, attemptRoot).split(path.sep).join('/'),
    contentHash
  };
}

async function preserveFailedAttempt({
  projectRoot,
  workspace,
  paths,
  theme,
  template,
  mapId,
  prompt,
  workerResult,
  workspaceBefore,
  historyByteLimit,
  treeCaptureHook,
  error
}) {
  const captureFailures = {};
  const workspaceEvidenceOptions = {
    root: workspace,
    artifactPrefix: 'workspace',
    before: workspaceBefore,
    changedOnly: true,
    afterDirectoryRead: treeCaptureHook,
    label: 'post-worker workspace'
  };
  const workspaceEvidence = await collectBoundedTreeEvidence(
    workspaceEvidenceOptions
  );
  const workspaceVerification = await collectBoundedTreeEvidence(
    workspaceEvidenceOptions
  );
  const workspaceArtifactsMatch = (
    workspaceEvidence.artifacts.size === workspaceVerification.artifacts.size
    && [...workspaceEvidence.artifacts].every(([file, bytes]) =>
      workspaceVerification.artifacts.get(file)?.equals(bytes)
    )
  );
  if (
    !workspaceEvidence.manifestBytes.equals(workspaceVerification.manifestBytes)
    || !workspaceArtifactsMatch
  ) {
    fail(
      'post-worker workspace changed during quarantined capture',
      'BLUEPRINT_ATTEMPT_EVIDENCE_DRIFT'
    );
  }
  if (
    workspaceEvidence.unstableDirectory
    || workspaceVerification.unstableDirectory
  ) {
    fail(
      'post-worker workspace directory identity drifted during capture',
      'BLUEPRINT_ATTEMPT_EVIDENCE_DRIFT'
    );
  }
  if (workspaceEvidence.uncapturable.length > 0) {
    captureFailures.workspace = {
      code: 'BLUEPRINT_ATTEMPT_EVIDENCE_CAPTURE_ERROR',
      message:
        `${workspaceEvidence.uncapturable.length} workspace entries `
        + 'could not be captured; see workspace-manifest.json'
    };
  }
  const candidate = workspaceEvidence.artifacts.get('workspace/candidate.json') ?? null;
  const lastMessage =
    workspaceEvidence.artifacts.get('workspace/last-message.txt') ?? null;
  if (candidate) workspaceEvidence.artifacts.delete('workspace/candidate.json');
  if (lastMessage) {
    workspaceEvidence.artifacts.delete('workspace/last-message.txt');
    if (lastMessage.byteLength > MAX_WORKER_LOG_BYTES) {
      captureFailures['last-message.txt'] = {
        code: 'BLUEPRINT_ATTEMPT_EVIDENCE_LIMIT',
        message: `last-message.txt exceeds ${MAX_WORKER_LOG_BYTES} bytes`
      };
    }
  }
  const promptBytes = Buffer.from(`${prompt}\n`);
  const stdoutBytes = Buffer.from(workerResult?.stdout ?? Buffer.alloc(0));
  const stderrBytes = Buffer.from(workerResult?.stderr ?? Buffer.alloc(0));
  for (const [label, bytes] of [
    ['prompt.txt', promptBytes],
    ['worker.jsonl', stdoutBytes],
    ['worker.stderr.log', stderrBytes]
  ]) {
    if (bytes.byteLength > MAX_WORKER_LOG_BYTES) {
      fail(
        `${label} exceeds the evidence limit of ${MAX_WORKER_LOG_BYTES} bytes`,
        'BLUEPRINT_ATTEMPT_EVIDENCE_LIMIT'
      );
    }
  }

  const errorBytes = boundedAttemptErrorBytes(
    structuredAttemptError(error, workerResult, captureFailures)
  );
  const artifactBytes = new Map([
    ['prompt.txt', promptBytes],
    ['worker.jsonl', stdoutBytes],
    ['worker.stderr.log', stderrBytes],
    ['error.json', errorBytes],
    ['workspace-manifest.json', workspaceEvidence.manifestBytes],
    ...workspaceEvidence.artifacts
  ]);
  if (lastMessage && lastMessage.byteLength <= MAX_WORKER_LOG_BYTES) {
    artifactBytes.set('last-message.txt', lastMessage);
  }
  if (candidate) artifactBytes.set('candidate.json', candidate);
  const published = await publishAttemptEvidence({
    projectRoot,
    paths,
    theme,
    template,
    mapId,
    outcome: 'failed',
    artifactBytes,
    historyByteLimit
  });
  return {
    ...published,
    complete: Object.keys(captureFailures).length === 0,
    cleanupIdentities: workspaceEvidence.identities
  };
}

async function preserveSupersededCandidate({
  projectRoot,
  candidateRoot,
  paths,
  theme,
  template,
  mapId,
  reason,
  historyByteLimit
}) {
  const residualEvidence = await collectBoundedTreeEvidence({
    root: candidateRoot,
    artifactPrefix: 'residual',
    changedOnly: false,
    label: 'superseded candidate root'
  });
  const residualVerification = await collectBoundedTreeEvidence({
    root: candidateRoot,
    artifactPrefix: 'residual',
    changedOnly: false,
    label: 'superseded candidate root'
  });
  const artifactsMatch = (
    residualEvidence.artifacts.size === residualVerification.artifacts.size
    && [...residualEvidence.artifacts].every(([file, bytes]) =>
      residualVerification.artifacts.get(file)?.equals(bytes)
    )
  );
  if (
    !residualEvidence.manifestBytes.equals(residualVerification.manifestBytes)
    || !artifactsMatch
  ) {
    fail(
      'superseded candidate root changed during evidence capture',
      'BLUEPRINT_ATTEMPT_EVIDENCE_DRIFT'
    );
  }
  if (
    residualEvidence.unstableDirectory
    || residualVerification.unstableDirectory
  ) {
    fail(
      'superseded candidate root directory identity drifted during capture',
      'BLUEPRINT_ATTEMPT_EVIDENCE_DRIFT'
    );
  }
  const captureFailures = residualEvidence.uncapturable.length > 0
    ? {
        residual: {
          code: 'BLUEPRINT_ATTEMPT_EVIDENCE_CAPTURE_ERROR',
          message:
            `${residualEvidence.uncapturable.length} residual entries `
            + 'could not be captured; see residual-manifest.json'
        }
      }
    : {};
  const artifactBytes = new Map(residualEvidence.artifacts);
  artifactBytes.set('residual-manifest.json', residualEvidence.manifestBytes);
  artifactBytes.set(
    'error.json',
    boundedAttemptErrorBytes(
      structuredAttemptError(reason, null, captureFailures)
    )
  );
  const published = await publishAttemptEvidence({
    projectRoot,
    paths,
    theme,
    template,
    mapId,
    outcome: 'superseded',
    artifactBytes,
    historyByteLimit
  });
  if (Object.keys(captureFailures).length > 0) {
    fail(
      'superseded blueprint candidate contains unsafe or drifting evidence',
      'UNSAFE_BLUEPRINT_ATTEMPT_EVIDENCE'
    );
  }
  return {
    ...published,
    cleanupIdentities: residualEvidence.identities
  };
}

async function quarantineFailureWorkspace({
  projectRoot,
  candidateRoot,
  workspace
}) {
  const relative = path.relative(candidateRoot, workspace);
  if (
    relative.length === 0
    || relative.startsWith('..')
    || path.isAbsolute(relative)
    || relative.includes(path.sep)
  ) {
    fail(
      'failed workspace is not a direct child of its candidate root',
      'UNSAFE_BLUEPRINT_ATTEMPT_EVIDENCE'
    );
  }
  await assertSafeWritePath(projectRoot, workspace, 'failed workspace path');
  const before = await lstat(workspace);
  if (before.isSymbolicLink() || !before.isDirectory()) {
    fail(
      'failed workspace must be a regular directory',
      'UNSAFE_BLUEPRINT_ATTEMPT_EVIDENCE'
    );
  }
  const quarantined = path.join(
    candidateRoot,
    `.failed-workspace-${randomUUID()}`
  );
  await assertSafeWritePath(
    projectRoot,
    quarantined,
    'failed workspace quarantine path'
  );
  await rename(workspace, quarantined);
  const after = await lstat(quarantined);
  if (
    after.isSymbolicLink()
    || !after.isDirectory()
    || after.dev !== before.dev
    || after.ino !== before.ino
  ) {
    fail(
      'failed workspace identity changed during quarantine',
      'BLUEPRINT_ATTEMPT_EVIDENCE_DRIFT'
    );
  }
  return quarantined;
}

async function quarantineCandidateRootForEvidence({
  projectRoot,
  candidateRoot,
  mapId
}) {
  await assertSafeWritePath(
    projectRoot,
    candidateRoot,
    'candidate evidence quarantine source'
  );
  const before = await lstat(candidateRoot);
  if (before.isSymbolicLink() || !before.isDirectory()) {
    fail(
      'candidate evidence quarantine source must be a regular directory',
      'UNSAFE_BLUEPRINT_ATTEMPT_EVIDENCE'
    );
  }
  const quarantined = path.join(
    path.dirname(candidateRoot),
    `.superseded-candidate-${mapId}-${randomUUID()}`
  );
  await assertSafeWritePath(
    projectRoot,
    quarantined,
    'candidate evidence quarantine path'
  );
  await rename(candidateRoot, quarantined);
  const after = await lstat(quarantined);
  if (
    after.isSymbolicLink()
    || !after.isDirectory()
    || after.dev !== before.dev
    || after.ino !== before.ino
  ) {
    fail(
      'candidate root identity changed during evidence quarantine',
      'BLUEPRINT_ATTEMPT_EVIDENCE_DRIFT'
    );
  }
  return quarantined;
}

async function cleanupCapturedTree({
  projectRoot,
  root,
  identities,
  beforeFileQuarantine = async () => {}
}) {
  let retained = false;
  const files = [...identities]
    .filter(([, identity]) => identity.type === 'file')
    .sort(([left], [right]) => right.length - left.length);
  for (const [relative, identity] of files) {
    const absolute = path.join(root, relative);
    try {
      await assertSafeWritePath(
        projectRoot,
        absolute,
        'captured evidence cleanup path'
      );
      const details = await lstat(absolute);
      if (
        details.isSymbolicLink()
        || !details.isFile()
        || details.dev !== identity.dev
        || details.ino !== identity.ino
        || details.size !== identity.bytes
        || details.mtimeMs !== identity.mtimeMs
      ) {
        retained = true;
        continue;
      }
      const bytes = await readRegularAttemptEvidence(
        absolute,
        'captured evidence cleanup file',
        Math.max(identity.bytes, 1)
      );
      if (!bytes || sha256Bytes(bytes) !== identity.sha256) {
        retained = true;
        continue;
      }
      await beforeFileQuarantine({ root, relative, absolute });
      const quarantined = path.join(
        path.dirname(absolute),
        `.captured-cleanup-${randomUUID()}`
      );
      await assertSafeWritePath(
        projectRoot,
        quarantined,
        'captured evidence private cleanup path'
      );
      await rename(absolute, quarantined);
      const moved = await lstat(quarantined);
      if (
        moved.isSymbolicLink()
        || !moved.isFile()
        || moved.dev !== identity.dev
        || moved.ino !== identity.ino
        || moved.size !== identity.bytes
        || moved.mtimeMs !== identity.mtimeMs
      ) {
        retained = true;
        continue;
      }
      const movedBytes = await readRegularAttemptEvidence(
        quarantined,
        'captured evidence private cleanup file',
        Math.max(identity.bytes, 1)
      );
      if (!movedBytes || sha256Bytes(movedBytes) !== identity.sha256) {
        retained = true;
        continue;
      }
      await unlink(quarantined);
    } catch (error) {
      if (error.code !== 'ENOENT') retained = true;
    }
  }
  const directories = [...identities]
    .filter(([, identity]) => identity.type === 'directory')
    .sort(([left], [right]) => {
      const depth = value => value === '.' ? -1 : value.split('/').length;
      return depth(right) - depth(left);
    });
  for (const [relative, identity] of directories) {
    const absolute = relative === '.' ? root : path.join(root, relative);
    try {
      await assertSafeWritePath(
        projectRoot,
        absolute,
        'captured evidence cleanup directory'
      );
      const details = await lstat(absolute);
      if (
        details.isSymbolicLink()
        || !details.isDirectory()
        || details.dev !== identity.dev
        || details.ino !== identity.ino
      ) {
        retained = true;
        continue;
      }
      await rmdir(absolute);
    } catch (error) {
      if (!['ENOENT'].includes(error.code)) retained = true;
    }
  }
  return { removed: !await pathExists(root), retained };
}

async function cleanupCapturedCandidateRoot({
  projectRoot,
  candidateRoot,
  mapId
}) {
  let before;
  try {
    before = await lstat(candidateRoot);
  } catch (error) {
    if (error.code === 'ENOENT') return { removed: true, retainedPath: null };
    throw error;
  }
  if (before.isSymbolicLink() || !before.isDirectory()) {
    return { removed: false, retainedPath: candidateRoot };
  }
  const retainedPath = path.join(
    path.dirname(candidateRoot),
    `.failed-candidate-${mapId}-${randomUUID()}`
  );
  await assertSafeWritePath(
    projectRoot,
    retainedPath,
    'failed candidate quarantine path'
  );
  await rename(candidateRoot, retainedPath);
  const after = await lstat(retainedPath);
  if (
    after.isSymbolicLink()
    || !after.isDirectory()
    || after.dev !== before.dev
    || after.ino !== before.ino
  ) {
    return { removed: false, retainedPath };
  }
  const entries = await readdir(retainedPath);
  if (entries.length !== 0) return { removed: false, retainedPath };
  try {
    await rmdir(retainedPath);
  } catch (error) {
    if (['ENOTEMPTY', 'EEXIST'].includes(error.code)) {
      return { removed: false, retainedPath };
    }
    throw error;
  }
  return { removed: true, retainedPath: null };
}

async function assertNoUnresolvedAttemptQuarantine({
  projectRoot,
  candidateRoot,
  mapId
}) {
  const parent = path.dirname(candidateRoot);
  await assertSafeWritePath(
    projectRoot,
    parent,
    'candidate quarantine parent'
  );
  let siblings = [];
  try {
    siblings = await readdir(parent);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const siblingPrefixes = [
    `.failed-candidate-${mapId}-`,
    `.superseded-candidate-${mapId}-`
  ];
  if (siblings.some(name => siblingPrefixes.some(prefix => name.startsWith(prefix)))) {
    fail(
      `candidate ${mapId} has unresolved quarantined evidence`,
      'UNRESOLVED_BLUEPRINT_ATTEMPT_QUARANTINE'
    );
  }
  try {
    const details = await lstat(candidateRoot);
    if (details.isSymbolicLink() || !details.isDirectory()) return;
    const entries = await readdir(candidateRoot);
    if (entries.some(name => name.startsWith('.failed-workspace-'))) {
      fail(
        `candidate ${mapId} has an unresolved failed workspace`,
        'UNRESOLVED_BLUEPRINT_ATTEMPT_QUARANTINE'
      );
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function runPool(items, concurrency, callback, abortController) {
  const results = new Array(items.length);
  let nextIndex = 0;
  let firstFailure = null;
  const notifyFailure = (error, context = {}) => {
    if (firstFailure === null) {
      firstFailure = error;
      abortController.abort(error);
    } else {
      attachSecondaryFailure(firstFailure, error, context);
    }
  };
  async function consume() {
    while (firstFailure === null && nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await callback(
          items[index],
          index,
          (error, context = {}) => notifyFailure(error, {
            mapId: items[index]?.mapId,
            ...context
          })
        );
      } catch (error) {
        notifyFailure(error, {
          stage: 'consumer-settlement',
          mapId: items[index]?.mapId
        });
        return;
      }
    }
  }
  await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, items.length) }, () => consume())
  );
  if (firstFailure !== null) throw firstFailure;
  return results;
}

export async function generateBlueprintCandidates(options, {
  worker = spawnBlueprintWorker,
  completionGraceMs = DEFAULT_BLUEPRINT_COMPLETION_GRACE_MS,
  completionPollMs = DEFAULT_BLUEPRINT_COMPLETION_POLL_MS,
  candidateLockHolderSource = CANDIDATE_LOCK_HOLDER_SOURCE,
  attemptHistoryByteLimit = MAX_ATTEMPT_HISTORY_BYTES,
  failureQuarantineHook = async () => {},
  beforeFailureCleanup = async () => {},
  beforeEvidenceTreeCleanup = async () => {},
  beforeCapturedFileQuarantine = async () => {},
  treeCaptureHook = async () => {}
} = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? SCRIPT_PROJECT_ROOT);
  const [{ sidecar }, promptLoaded] = await Promise.all([
    loadTemplateSidecar({
      projectRoot,
      theme: options.theme,
      template: options.template
    }),
    loadBlueprintPrompt(projectRoot, options.template)
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
  const batchAbortController = new AbortController();
  const generated = await runPool(
    jobs,
    options.concurrency,
    async (job, _index, notifyFailure) => {
      let lock;
      try {
        lock = await acquireCandidateGenerationLock({
          projectRoot,
          theme: options.theme,
          template: options.template,
          mapId: job.mapId,
          holderSource: candidateLockHolderSource,
          signal: batchAbortController.signal
        });
      } catch (error) {
        notifyFailure(error, { stage: 'lock-acquisition' });
        throw error;
      }
      let jobFailure = null;
      let releaseFailure = null;
      let jobResult;
      try {
        jobResult = await (async () => {
      const candidateRoot = resolveWithinProject(
        projectRoot,
        job.paths.root,
        'candidate output path'
      );
      await assertSafeWritePath(projectRoot, candidateRoot, 'candidate output path');
      await assertNoUnresolvedAttemptQuarantine({
        projectRoot,
        candidateRoot,
        mapId: job.mapId
      });
      const rootExists = await pathExists(candidateRoot);
      let existing;
      let existingError = null;
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
        existingError = error;
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
        const reason = new Error(
          existingError
            ? `candidate ${job.mapId} is stale or invalid and is being superseded: `
              + existingError.message
            : existing
              ? `unapproved candidate ${job.mapId} is being superseded by force`
              : `incomplete candidate ${job.mapId} is being superseded`
        );
        reason.name = 'SupersededBlueprintCandidate';
        reason.code = existingError
          ? 'STALE_BLUEPRINT_CANDIDATE_SUPERSEDED'
          : existing
            ? 'UNAPPROVED_BLUEPRINT_CANDIDATE_SUPERSEDED'
            : 'INCOMPLETE_BLUEPRINT_CANDIDATE_SUPERSEDED';
        const supersededRoot = await quarantineCandidateRootForEvidence({
          projectRoot,
          candidateRoot,
          mapId: job.mapId
        });
        const supersededEvidence = await preserveSupersededCandidate({
          projectRoot,
          candidateRoot: supersededRoot,
          paths: job.paths,
          theme: options.theme,
          template: options.template,
          mapId: job.mapId,
          reason,
          historyByteLimit: attemptHistoryByteLimit
        });
        await beforeEvidenceTreeCleanup({
          root: supersededRoot,
          kind: 'superseded-root'
        });
        const supersededCleanup = await cleanupCapturedTree({
          projectRoot,
          root: supersededRoot,
          identities: supersededEvidence.cleanupIdentities,
          beforeFileQuarantine: beforeCapturedFileQuarantine
        });
        if (!supersededCleanup.removed) {
          fail(
            'superseded candidate root changed after evidence capture',
            'BLUEPRINT_ATTEMPT_EVIDENCE_DRIFT'
          );
        }
      }

      let workspace = null;
      let workerResult = null;
      let retainFailedWorkspace = false;
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
        let workspaceBefore = null;
        try {
          workspaceBefore = await snapshotTree(workspace);
          const protectedBefore =
            await snapshotProtectedGenerationContent(projectRoot);
          let workerError;
          try {
            if (batchAbortController.signal.aborted) {
              throw blueprintWorkerCancellationError(
                batchAbortController.signal.reason
              );
            }
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
              textTemplateFallback: options.textTemplateFallback,
              signal: batchAbortController.signal
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
          auditWorkspace(workspaceBefore, after, sourceRelativePath, {
            requireCandidate: !workerError
          });
          if (workerError) {
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
          notifyFailure(error, { stage: 'worker-or-validation' });
          let failure = error;
          let cleanupIdentities = null;
          try {
            const originalWorkspace = workspace;
            workspace = await quarantineFailureWorkspace({
              projectRoot,
              candidateRoot,
              workspace
            });
            await failureQuarantineHook({
              originalWorkspace,
              quarantinedWorkspace: workspace,
              candidateRoot
            });
            const evidence = await preserveFailedAttempt({
              projectRoot,
              workspace,
              paths: job.paths,
              theme: options.theme,
              template: options.template,
              mapId: job.mapId,
              prompt,
              workerResult,
              workspaceBefore,
              historyByteLimit: attemptHistoryByteLimit,
              treeCaptureHook,
              error
            });
            retainFailedWorkspace = evidence.complete !== true;
            cleanupIdentities = evidence.cleanupIdentities;
          } catch (evidenceError) {
            evidenceError.cause = error;
            failure = evidenceError;
            retainFailedWorkspace = true;
          }
          if (!retainFailedWorkspace) {
            await beforeEvidenceTreeCleanup({
              root: workspace,
              kind: 'failed-workspace'
            });
            const workspaceCleanup = await cleanupCapturedTree({
              projectRoot,
              root: workspace,
              identities: cleanupIdentities,
              beforeFileQuarantine: beforeCapturedFileQuarantine
            });
            if (workspaceCleanup.removed) {
              workspace = null;
              await beforeFailureCleanup({ candidateRoot });
              await cleanupCapturedCandidateRoot({
                projectRoot,
                candidateRoot,
                mapId: job.mapId
              });
            } else {
              retainFailedWorkspace = true;
            }
          }
          throw failure;
        } finally {
          // Failed evidence is removed only through identity-pinned cleanup
          // above. Any incomplete or changed tree remains quarantined.
        }
      } catch (error) {
        throw error;
      }
        })();
    } catch (error) {
      jobFailure = error;
      notifyFailure(error, { stage: 'job-cleanup' });
    }
    try {
      await lock.release();
    } catch (error) {
      releaseFailure = error;
      notifyFailure(error, { stage: 'lock-release' });
    }
    if (jobFailure) throw jobFailure;
    if (releaseFailure) throw releaseFailure;
    return jobResult;
    },
    batchAbortController
  );
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
    loadBlueprintPrompt(projectRoot, options.template)
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
  const schemas = blueprintApprovalSchemas(template);
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
      value.schemaVersion !== schemas.index
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
        'decision',
        ...(schemas.v2 ? ['reason', 'approvalFullHash'] : [])
      ], label);
      safeId(entry.id, `${label}.id`);
      safeId(entry.reviewer, `${label}.reviewer`);
      sha256(entry.blueprintFullHash, `${label}.blueprintFullHash`);
      sha256(entry.sourceImageSha256, `${label}.sourceImageSha256`);
      sha256(entry.promptProfileSha256, `${label}.promptProfileSha256`);
      if (schemas.v2) {
        approvalReason(entry.reason, `${label}.reason`);
        sha256(entry.approvalFullHash, `${label}.approvalFullHash`);
      }
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
        schemaVersion: schemas.index,
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

function finalizeApprovalRecord(value) {
  const projection = { ...value };
  delete projection.fullHash;
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
  const schemas = blueprintApprovalSchemas(template);
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
    'promptProfile',
    ...(schemas.v2 ? ['reason', 'fullHash'] : [])
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
  if (schemas.v2) {
    approvalReason(value.reason, 'blueprint approval record.reason');
    sha256(value.fullHash, 'blueprint approval record.fullHash');
    const projection = { ...value };
    delete projection.fullHash;
    if (sha256Bytes(Buffer.from(stableJson(projection))) !== value.fullHash) {
      fail('blueprint approval record full hash mismatch');
    }
  }
  if (
    value.schemaVersion !== schemas.record
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
    || (
      schemas.v2
      && (
        value.reason !== entry.reason
        || value.fullHash !== entry.approvalFullHash
      )
    )
  ) fail('blueprint approval record does not match its exact reviewed inputs');
  return value;
}

async function approveBlueprintCandidateUnlocked(options, projectRoot) {
  const schemas = blueprintApprovalSchemas(options.template);
  if (schemas.v2) {
    approvalReason(options.reason, '--reason');
  } else if (options.reason !== undefined) {
    fail('--reason is not accepted for legacy template-01/-02 approvals');
  }
  const [loaded, promptLoaded] = await Promise.all([
    loadTemplateSidecar({
      projectRoot,
      theme: options.theme,
      template: options.template
    }),
    loadBlueprintPrompt(projectRoot, options.template)
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
  const approvalProjection = {
    schemaVersion: schemas.record,
    id: options.mapId,
    theme: options.theme,
    templateId: options.template,
    decision: options.decision,
    reviewer: options.reviewer,
    blueprintPath: paths.blueprint,
    blueprintFileSha256: candidate.metadata.blueprint.fileSha256,
    blueprintFullHash: candidate.metadata.blueprint.fullHash,
    sourceImageSha256: candidate.metadata.sourceImageSha256,
    promptProfile: candidate.metadata.promptProfile,
    ...(schemas.v2 ? { reason: options.reason } : {})
  };
  const approvalRecord = schemas.v2
    ? finalizeApprovalRecord(approvalProjection)
    : approvalProjection;
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
      decision: 'approved',
      ...(schemas.v2
        ? {
            reason: options.reason,
            approvalFullHash: approvalRecord.fullHash
          }
        : {})
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
    loadBlueprintPrompt(root, template)
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
      if (usesBlueprintV2SemanticContract(sidecar.id)) {
        validateV2BlueprintSemanticContract(blueprint, sidecar);
      }
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
  finalizeApprovalIndex,
  finalizeApprovalRecord,
  blueprintApprovalSchemas,
  blueprintPromptProfile,
  validateV2BlueprintSemanticContract,
  approvalReason
});
