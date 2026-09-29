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
  realpath,
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
  passableTraversalComponents,
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
export const BLUEPRINT_PROMPT_PATH_V3 =
  'ai-image-metadata/battle-maps/prompts/map-blueprint-v3.json';
export const BLUEPRINT_PROMPT_SCHEMA =
  'battle-map-blueprint-prompt-profile-v1';
export const BLUEPRINT_PROMPT_SCHEMA_V2 =
  'battle-map-blueprint-prompt-profile-v2';
export const BLUEPRINT_PROMPT_SCHEMA_V3 =
  'battle-map-blueprint-prompt-profile-v3';
export const BLUEPRINT_CANDIDATE_SCHEMA =
  'battle-map-blueprint-candidate-record-v1';
export const BLUEPRINT_ATTEMPT_EVIDENCE_SCHEMA =
  'battle-map-blueprint-attempt-evidence-v1';
export const BLUEPRINT_APPROVAL_SCHEMA =
  'battle-map-blueprint-approval-index-v1';
export const BLUEPRINT_APPROVAL_INDEX_SCHEMA_V2 =
  'battle-map-blueprint-approval-index-v2';
export const BLUEPRINT_APPROVAL_INDEX_SCHEMA_V3 =
  'battle-map-blueprint-approval-index-v3';
export const BLUEPRINT_APPROVAL_RECORD_SCHEMA_V1 =
  'battle-map-blueprint-approval-v1';
export const BLUEPRINT_APPROVAL_RECORD_SCHEMA_V2 =
  'battle-map-blueprint-approval-v2';
export const BLUEPRINT_APPROVAL_RECORD_SCHEMA_V3 =
  'battle-map-blueprint-approval-v3';
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
const LEGACY_BLUEPRINT_APPROVAL_TEMPLATE_IDS = new Set([
  'forest-template-01',
  'forest-template-02'
]);
const BLUEPRINT_APPROVAL_V2_TEMPLATE_IDS = new Set([
  'forest-template-03',
  'forest-template-04',
  'forest-template-05',
  'forest-template-06'
]);
const REPLAY_ONLY_BLUEPRINT_TEMPLATE_IDS = new Set([
  ...LEGACY_BLUEPRINT_APPROVAL_TEMPLATE_IDS,
  ...BLUEPRINT_APPROVAL_V2_TEMPLATE_IDS
]);
const CAVE_TEMPLATE_01_ID = 'cave-template-01';
const HISTORICAL_BLUEPRINT_PROMPT_PROFILES_BY_TEMPLATE = new Map([
  ['forest-template-07', [{
    id: 'map-blueprint-v2',
    path: BLUEPRINT_PROMPT_PATH_V2,
    schema: BLUEPRINT_PROMPT_SCHEMA_V2,
    sha256: 'sha256:d9fd841812bcc9a4713d3ac8b1c81715f359e55d55098589f8970650fed7cdae'
  }]]
]);
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;
const ALLOWED_OUTPUTS = new Set(['candidate.json', 'last-message.txt']);
const INPUT_PATHS = new Set([
  'inputs/reference.png',
  'inputs/reference.webp',
  'inputs/sidecar.json',
  'inputs/contract.json',
  'inputs/starter.json'
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
  return LEGACY_BLUEPRINT_APPROVAL_TEMPLATE_IDS.has(templateId);
}

function usesBlueprintApprovalSchemaV3(templateId) {
  return !usesLegacyBlueprintApprovalSchema(templateId)
    && !BLUEPRINT_APPROVAL_V2_TEMPLATE_IDS.has(templateId);
}

function assertV3BlueprintAuthoringIdentity(templateId) {
  if (!REPLAY_ONLY_BLUEPRINT_TEMPLATE_IDS.has(templateId)) return;
  const historicalVersion = usesLegacyBlueprintApprovalSchema(templateId)
    ? 'V1'
    : 'V2';
  fail(
    `${templateId} is a deprecated ${historicalVersion} compatibility identity. `
      + 'Its tracked blueprint evidence is replay-only and remains available to '
      + 'verification and release checks; new candidate generation, review-preview '
      + 'creation, and approval are prohibited. Create a new template identity and '
      + 'author it through the V3 lifecycle.'
  );
}

function blueprintApprovalSchemas(templateId) {
  if (usesLegacyBlueprintApprovalSchema(templateId)) {
    return {
      index: BLUEPRINT_APPROVAL_SCHEMA,
      record: BLUEPRINT_APPROVAL_RECORD_SCHEMA_V1,
      v2: false,
      v3: false
    };
  }
  if (usesBlueprintApprovalSchemaV3(templateId)) {
    return {
      index: BLUEPRINT_APPROVAL_INDEX_SCHEMA_V3,
      record: BLUEPRINT_APPROVAL_RECORD_SCHEMA_V3,
      v2: true,
      v3: true
    };
  }
  return {
    index: BLUEPRINT_APPROVAL_INDEX_SCHEMA_V2,
    record: BLUEPRINT_APPROVAL_RECORD_SCHEMA_V2,
    v2: true,
    v3: false
  };
}

function blueprintPromptProfile(templateId) {
  if (usesLegacyBlueprintApprovalSchema(templateId)) {
    return {
      id: 'map-blueprint-v1',
      path: BLUEPRINT_PROMPT_PATH,
      schema: BLUEPRINT_PROMPT_SCHEMA
    };
  }
  if (!usesBlueprintApprovalSchemaV3(templateId)) {
    return {
      id: 'map-blueprint-v2',
      path: BLUEPRINT_PROMPT_PATH_V2,
      schema: BLUEPRINT_PROMPT_SCHEMA_V2
    };
  }
  return {
    id: 'map-blueprint-v3',
    path: BLUEPRINT_PROMPT_PATH_V3,
    schema: BLUEPRINT_PROMPT_SCHEMA_V3
  };
}

function exactPromptProfileMatch(left, right) {
  return left.id === right.id
    && left.path === right.path
    && left.sha256 === right.sha256;
}

function supportedPromptProfileReference(
  candidate,
  current,
  {
    allowHistorical = false,
    historicalReferences = []
  } = {}
) {
  if (exactPromptProfileMatch(candidate, current)) return true;
  return allowHistorical
    && historicalReferences.some(historical =>
      exactPromptProfileMatch(candidate, historical)
    );
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
  requireReasonForNewApproval = false,
  requireV3AuthoringIdentity = false
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
  if (requireV3AuthoringIdentity) {
    assertV3BlueprintAuthoringIdentity(options.template);
  }
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

async function snapshotOptionalFile(projectRoot, filePath, label) {
  await assertSafeWritePath(projectRoot, filePath, `${label} snapshot path`);
  try {
    const details = await lstat(filePath);
    if (details.isSymbolicLink() || !details.isFile()) {
      fail(`${label} snapshot target must be a regular non-symlink file`);
    }
    return await readFile(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function restoreOptionalFile(projectRoot, filePath, bytes) {
  if (bytes !== null) {
    await atomicWrite(projectRoot, filePath, bytes);
    return;
  }
  await assertSafeWritePath(projectRoot, filePath, 'approval rollback path');
  try {
    await unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function loadBlueprintPromptProfile(projectRoot, expected, label) {
  const absolutePath = resolveWithinProject(
    projectRoot,
    expected.path,
    `${label} path`
  );
  await assertSafeWritePath(projectRoot, absolutePath, `${label} read path`);
  const { value, source } = await readJson(absolutePath, label);
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
  const loaded = {
    profile: value,
    reference: {
      id: value.id,
      path: expected.path,
      sha256: sha256Bytes(Buffer.from(source))
    }
  };
  if (
    expected.sha256 !== undefined
    && loaded.reference.sha256 !== expected.sha256
  ) {
    fail(`${label} no longer matches its exact historical hash pin`);
  }
  return loaded;
}

async function loadBlueprintPrompt(projectRoot, template) {
  const current = await loadBlueprintPromptProfile(
    projectRoot,
    blueprintPromptProfile(template),
    'blueprint prompt profile'
  );
  const historical = await Promise.all(
    (HISTORICAL_BLUEPRINT_PROMPT_PROFILES_BY_TEMPLATE.get(template) ?? [])
      .map(expected => loadBlueprintPromptProfile(
        projectRoot,
        expected,
        'historical blueprint prompt profile'
      ))
  );
  return {
    ...current,
    historicalPromptProfiles: historical,
    historicalReferences: historical.map(loaded => loaded.reference)
  };
}

function point(x, y) {
  return { x, y };
}

const TEMPLATE_07_ID = 'forest-template-07';
const TEMPLATE_07_SURFACE_MATERIALS = [
  {
    featureId: 'southwest-clover-glade',
    symbol: 'clover-glade'
  },
  {
    featureId: 'northeast-fern-hazel-glade',
    symbol: 'fern-hazel-glade'
  },
  {
    featureId: 'northwest-fieldstone-terrace',
    symbol: 'fieldstone-terrace'
  },
  {
    featureId: 'southeast-hawthorn-loop',
    symbol: 'hawthorn-loop'
  },
  {
    featureId: 'fallen-oak-root-seam',
    symbol: 'dry-ravine'
  }
];
const TEMPLATE_07_SURFACE_MATERIAL_BY_FEATURE = new Map(
  TEMPLATE_07_SURFACE_MATERIALS.map(record => [
    record.featureId,
    record.symbol
  ])
);
const TEMPLATE_07_LANDMARK_COLLISION_CELLS = [
  point(0, 0),
  point(1, 0),
  point(2, 0),
  point(2, 1),
  point(3, 1),
  point(4, 1),
  point(5, 1),
  point(5, 2),
  point(6, 2),
  point(7, 2)
];
const TEMPLATE_07_LANDMARK_COMPOSITIONS = {
  a: {
    landmarkAnchor: point(12, 19),
    root: point(17, 19)
  },
  b: {
    landmarkAnchor: point(18, 14),
    root: point(18, 15)
  },
  c: {
    landmarkAnchor: point(13, 19),
    root: point(18, 19)
  }
};
const TEMPLATE_07_PRIMARY_ROUTE_WAYPOINTS = {
  a: [
    {
      id: 'route:northwest',
      waypoints: [
        point(7, 24), point(7, 23), point(10, 23), point(10, 19),
        point(6, 19), point(6, 18), point(10, 18),
        point(10, 15), point(8, 15), point(8, 11), point(9, 11),
        point(9, 10), point(13, 10), point(13, 6), point(15, 6),
        point(15, 5)
      ]
    },
    {
      id: 'route:oak-seam',
      waypoints: [
        point(7, 26), point(11, 26), point(11, 18), point(14, 18),
        point(14, 16), point(17, 16), point(17, 14), point(16, 14),
        point(16, 11), point(17, 11), point(17, 5), point(18, 5),
        point(18, 6)
      ]
    },
    {
      id: 'route:southeast',
      waypoints: [
        point(9, 27), point(22, 27), point(22, 23), point(21, 23),
        point(21, 19), point(24, 19), point(24, 18),
        point(18, 18), point(18, 15), point(20, 15),
        point(20, 11), point(21, 11), point(21, 10), point(23, 10),
        point(23, 4), point(20, 4), point(20, 7), point(19, 7)
      ]
    }
  ],
  b: [
    {
      id: 'route:northwest',
      waypoints: [
        point(7, 24), point(7, 23), point(10, 23), point(10, 20),
        point(6, 20), point(6, 19), point(11, 19),
        point(11, 16), point(9, 16), point(9, 10), point(13, 10),
        point(13, 6), point(15, 6), point(15, 5)
      ]
    },
    {
      id: 'route:oak-seam',
      waypoints: [
        point(7, 26), point(12, 26), point(12, 18), point(16, 18),
        point(16, 11), point(17, 11), point(17, 5), point(18, 5),
        point(18, 6)
      ]
    },
    {
      id: 'route:southeast',
      waypoints: [
        point(9, 27), point(22, 27), point(22, 23), point(21, 23),
        point(21, 21), point(25, 21),
        point(25, 18), point(17, 18), point(17, 13), point(21, 13),
        point(21, 10), point(23, 10), point(23, 4), point(20, 4),
        point(20, 7), point(19, 7)
      ]
    }
  ],
  c: [
    {
      id: 'route:northwest',
      waypoints: [
        point(7, 24), point(7, 23), point(10, 23), point(10, 20),
        point(6, 20), point(6, 17), point(12, 17),
        point(12, 16), point(6, 16), point(6, 11), point(9, 11),
        point(9, 10), point(13, 10), point(13, 6), point(15, 6),
        point(15, 5)
      ]
    },
    {
      id: 'route:oak-seam',
      waypoints: [
        point(7, 26), point(12, 26), point(12, 18), point(15, 18),
        point(15, 17), point(16, 17), point(16, 11), point(17, 11),
        point(17, 5), point(18, 5), point(18, 6)
      ]
    },
    {
      id: 'route:southeast',
      waypoints: [
        point(9, 27), point(22, 27), point(22, 23), point(21, 23),
        point(21, 20), point(24, 20), point(24, 18), point(20, 18),
        point(20, 17), point(17, 17), point(17, 12), point(21, 12),
        point(21, 10), point(23, 10), point(23, 4), point(20, 4),
        point(20, 7), point(19, 7)
      ]
    }
  ]
};
const TEMPLATE_07_ELEVATION_PROFILES = {
  a: {
    terrace: { x: 15.5, y: 14, rx: 14, ry: 10 },
    secondary: { x: 7, y: 18, rx: 6, ry: 5 },
    lookout: { x: 15.5, y: 9, rx: 8, ry: 4 }
  },
  b: {
    terrace: { x: 17, y: 14.5, rx: 12.5, ry: 10.8 },
    secondary: { x: 23, y: 17, rx: 5, ry: 6 },
    lookout: { x: 15.5, y: 9, rx: 8, ry: 4 }
  },
  c: {
    terrace: { x: 14, y: 13, rx: 14.5, ry: 9.5 },
    secondary: { x: 6, y: 15, rx: 5, ry: 6 },
    lookout: { x: 15.5, y: 9, rx: 8, ry: 4 }
  }
};
const TEMPLATE_07_FORMATION_PROFILES = {
  a: {
    players: [
      point(5, 24), point(7, 24), point(7, 26), point(9, 23), point(9, 27)
    ],
    opponents: [
      point(15, 6), point(18, 6),
      point(12, 7), point(14, 7), point(16, 7), point(19, 7), point(20, 7),
      point(9, 8), point(10, 8), point(11, 8), point(12, 8), point(13, 8),
      point(15, 8), point(17, 8), point(19, 8), point(21, 8),
      point(9, 10), point(11, 10), point(13, 10), point(15, 10),
      point(17, 10), point(19, 10), point(21, 10),
      point(16, 11)
    ],
    exits: {
      player: [point(10, 22), point(21, 22), point(16, 27)],
      opponent: [point(10, 9), point(21, 9), point(16, 9)]
    }
  },
  b: {
    players: [
      point(6, 24), point(8, 24), point(8, 26), point(10, 26), point(10, 27)
    ],
    opponents: [
      point(15, 6), point(18, 6),
      point(12, 7), point(14, 7), point(16, 7), point(19, 7), point(21, 7),
      point(9, 8), point(10, 8), point(12, 8), point(14, 8), point(15, 8),
      point(16, 8), point(17, 8), point(19, 8), point(21, 8),
      point(10, 10), point(12, 10), point(14, 10), point(16, 10),
      point(18, 10), point(20, 10), point(22, 10),
      point(17, 11)
    ],
    exits: {
      player: [point(11, 22), point(22, 22), point(16, 28)],
      opponent: [point(9, 9), point(20, 9), point(15, 9)]
    }
  },
  c: {
    players: [
      point(7, 23), point(5, 24), point(6, 26), point(9, 26), point(8, 24)
    ],
    opponents: [
      point(15, 6), point(18, 6),
      point(13, 7), point(15, 7), point(17, 7), point(20, 7), point(21, 7),
      point(10, 8), point(11, 8), point(12, 8), point(14, 8), point(16, 8),
      point(13, 8), point(17, 8), point(19, 8), point(20, 8),
      point(10, 10), point(12, 10), point(14, 10), point(16, 10),
      point(18, 10), point(20, 10), point(22, 10),
      point(15, 11)
    ],
    exits: {
      player: [point(9, 22), point(20, 22), point(15, 28)],
      opponent: [point(11, 9), point(22, 9), point(17, 9)]
    }
  }
};
const TEMPLATE_07_ORGANIC_SURFACE_PROFILES = {
  a: {
    ravine: { intercept: 8.3, slope: 0.43, bend: 1.6, phase: 0.1 },
    fieldstone: { x: 8.5, y: 8.5, rx: 5.7, ry: 4.6, phase: 0.4 },
    clover: { x: 8, y: 23, phase: 0.2 },
    fern: { x: 23, y: 8, phase: 0.8 },
    hawthorn: { x: 24, y: 23, phase: 1.5 }
  },
  b: {
    ravine: { intercept: 25.4, slope: -0.55, bend: 1.7, phase: 1.4 },
    fieldstone: { x: 10, y: 8, rx: 6.2, ry: 4.3, phase: 1.2 },
    clover: { x: 7, y: 22, phase: 1.1 },
    fern: { x: 24, y: 9, phase: 1.8 },
    hawthorn: { x: 23, y: 24, phase: 2.4 }
  },
  c: {
    ravine: { intercept: 1.8, slope: 0.88, bend: 1.9, phase: 2.3 },
    fieldstone: { x: 8, y: 10, rx: 5.3, ry: 5.1, phase: 2.1 },
    clover: { x: 9, y: 24, phase: 2.2 },
    fern: { x: 24, y: 7, phase: 2.8 },
    hawthorn: { x: 22, y: 22, phase: 3.1 }
  }
};

function template07RenderedCell(x, y, width, height, variant) {
  const nx = (x - (width - 1) / 2) / (width * 0.51);
  const ny = (y - (height - 1) / 2) / (height * 0.51);
  // The shared inner core keeps every fixed gameplay anchor safely framed.
  // Variant-specific outer fields make the production silhouette readable at
  // thumbnail scale instead of relying on one-cell perimeter noise.
  const innerCore = nx * nx + ny * ny <= 0.78;
  let outerField;
  if (variant === 'a') {
    outerField =
      (nx / 0.91) ** 2
      + (ny / 1.08) ** 2
      + 0.075 * Math.sin(ny * 7.5)
      - 0.06 * nx * ny;
  } else if (variant === 'b') {
    outerField =
      (nx / 1.09) ** 2
      + (ny / 0.9) ** 2
      + 0.07 * Math.cos(nx * 8)
      + 0.055 * nx * ny;
  } else {
    const diagonalX = 0.86 * nx + 0.42 * ny;
    const diagonalY = -0.42 * nx + 0.86 * ny;
    outerField =
      (diagonalX / 1.05) ** 2
      + (diagonalY / 0.92) ** 2
      + 0.065 * Math.sin((nx - ny) * 6.5);
  }
  return innerCore || outerField <= 1;
}

function template07OrganicSurfaceFeature(x, y, variant, regionIds) {
  const profile = TEMPLATE_07_ORGANIC_SURFACE_PROFILES[variant];
  const ravineCenter =
    profile.ravine.intercept
    + profile.ravine.slope * y
    + profile.ravine.bend * Math.sin(y * 0.47 + profile.ravine.phase);
  const ravineHalfWidth =
    2.25 + 0.7 * (1 + Math.sin(y * 0.83 + profile.ravine.phase));
  if (Math.abs(x - ravineCenter) <= ravineHalfWidth) {
    return regionIds.central;
  }

  const terraceDx = (x - profile.fieldstone.x) / profile.fieldstone.rx;
  const terraceDy = (y - profile.fieldstone.y) / profile.fieldstone.ry;
  const terraceEdge =
    terraceDx * terraceDx
    + terraceDy * terraceDy
    + 0.16 * Math.sin(x * 0.9 + y * 0.35 + profile.fieldstone.phase)
    - 0.1 * Math.cos(y * 1.1 + profile.fieldstone.phase);
  if (terraceEdge <= 1) return regionIds.upper;

  const organicScore = (center, xScale, yScale) => (
    ((x - center.x) / xScale) ** 2
    + ((y - center.y) / yScale) ** 2
    + 0.14 * Math.sin(x * 0.43 + y * 0.31 + center.phase)
    + 0.09 * Math.cos(x * 0.21 - y * 0.57 + center.phase)
  );
  const scores = [
    [organicScore(profile.clover, 10.5, 8.5), regionIds.player],
    [organicScore(profile.fern, 9, 9.5), regionIds.opponent],
    [organicScore(profile.hawthorn, 9.5, 8), regionIds.lateral]
  ];
  scores.sort((left, right) => left[0] - right[0]);
  return scores[0][1];
}

/**
 * A complete, structurally valid example is attached to every isolated worker.
 * It is a shape/scale example, not approved content. The worker must still
 * author a distinct interpretation of the reviewed sidecar and image.
 */
export function createBlueprintContractExample(
  sidecar,
  mapId,
  { skipCaveSpecialization = false } = {}
) {
  if (sidecar.id === CAVE_TEMPLATE_01_ID && !skipCaveSpecialization) {
    return createCaveTemplate01ContractExample(sidecar, mapId);
  }
  const width = sidecar.mapProfile.width;
  const height = sidecar.mapProfile.height;
  const v2 = usesBlueprintV2SemanticContract(sidecar.id);
  const v2Variant = v2 ? variantKey(mapId) : null;
  const usesFallenOakComposition = sidecar.id === TEMPLATE_07_ID;
  const template07LandmarkComposition = usesFallenOakComposition
    ? TEMPLATE_07_LANDMARK_COMPOSITIONS[v2Variant]
    : null;
  const requiredAreas = sidecar.topologyIntent.areas
    .filter(area => area.required === true);
  const semanticAreaId = (patterns, fallback, excluded = new Set()) => (
    requiredAreas.find(area => (
      !excluded.has(area.id)
      && patterns.some(pattern => pattern.test(
        `${area.id} ${area.description}`.toLowerCase()
      ))
    ))?.id ?? fallback
  );
  const regionIds = v2
    ? (() => {
        const central = semanticAreaId(
          [
            /central/, /junction/, /hollow/, /crossing/,
            /root-seam/, /fallen-oak/, /ravine/
          ],
          'central-route-junction'
        );
        const upper = semanticAreaId(
          [/overlook/, /lookout/, /elevated/, /northern/, /ridge/],
          'upper-lookout',
          new Set([central])
        );
        const player = semanticAreaId(
          [/southwest/, /western/, /lower/, /player/, /meadow/],
          'lower-clearing',
          new Set([central, upper])
        );
        const opponent = semanticAreaId(
          [/northeast/, /eastern/, /opponent/, /coppice/],
          'opponent-formation-clearing',
          new Set([central, upper, player])
        );
        const lateral = semanticAreaId(
          [/^southeast-/, /southern/, /lateral/, /flank/, /fork/, /loop/],
          'lateral-clearing',
          new Set([central, upper, player, opponent])
        );
        return { player, opponent, upper, lateral, central };
      })()
    : {
        player: 'lower-clearing',
        opponent: 'opponent-formation-clearing',
        upper: 'upper-lookout',
        lateral: 'lateral-clearing',
        central: 'central-route-junction'
      };
  const rendered = (x, y) => {
    if (usesFallenOakComposition) {
      return template07RenderedCell(x, y, width, height, v2Variant);
    }
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
    if (y >= 22) return regionIds.player;
    if (y <= 12 && x >= 8 && x <= 23) return regionIds.upper;
    if (x <= 14) return regionIds.lateral;
    return regionIds.central;
  };
  const template07SurfaceFeatureFor = (x, y) => {
    return template07OrganicSurfaceFeature(x, y, v2Variant, regionIds);
  };
  const surfaceGrid = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => (
      renderMask[y][x]
        ? (() => {
            const featureId = usesFallenOakComposition
              ? template07SurfaceFeatureFor(x, y)
              : regionFor(x, y);
            return {
              material: usesFallenOakComposition
                ? TEMPLATE_07_SURFACE_MATERIAL_BY_FEATURE.get(featureId)
                : 'ground',
              featureId
            };
          })()
        : null
    ))
  );
  const elevationAt = (x, y) => {
    if (usesFallenOakComposition) {
      const profile = TEMPLATE_07_ELEVATION_PROFILES[v2Variant];
      const terrace =
        ((x - profile.terrace.x) / profile.terrace.rx) ** 2
        + ((y - profile.terrace.y) / profile.terrace.ry) ** 2 <= 1;
      const secondary =
        ((x - profile.secondary.x) / profile.secondary.rx) ** 2
        + ((y - profile.secondary.y) / profile.secondary.ry) ** 2 <= 1;
      const lookout =
        ((x - profile.lookout.x) / profile.lookout.rx) ** 2
        + ((y - profile.lookout.y) / profile.lookout.ry) ** 2 <= 1;
      // Digital ellipse tips at these two fixed cells otherwise become
      // one-cell pockets separated from the adjacent authored mass.
      if (v2Variant === 'b' && x === 10 && y === 6) return 2;
      if (v2Variant === 'c' && x === 2 && y === 7) return 1;
      if (lookout && terrace) return 2;
      if (terrace || secondary) return 1;
      return 0;
    }
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
  const routeSpecifications = usesFallenOakComposition
    ? TEMPLATE_07_PRIMARY_ROUTE_WAYPOINTS[v2Variant]
    : (v2 ? [
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
  ]);
  const routeRecords = routeSpecifications.map(record => ({
    id: record.id,
    kind: record.kind ?? 'primary',
    material: usesFallenOakComposition ? 'dry-ravine' : 'ground',
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
  if (usesFallenOakComposition && boundaries.length > 1) {
    boundaries[1].assetFamily = 'fieldstone-face';
  }
  const roles = sidecar.spawnIntent.candidateRoles;
  const candidateCells = [];
  if (v2) {
    const localizedRows = sidecar.spawnIntent.minimumApproaches === 3
      ? [
          [6, [15, 18]],
          [7, [12, 14, 16, 19, 20]],
          [8, [9, 10, 11, 12, 13, 15, 17, 19, 21]],
          [10, [9, 11, 13, 15, 17, 19, 21]],
          [11, [16]]
        ]
      : [
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
        id: regionIds.player,
        kind: 'formation-clearing',
        cells: v2
          ? playerCells.map(cell => ({ ...cell }))
          : [point(5, 25), point(10, 24), point(15, 25)],
        annotations: ['player-formation']
      },
      ...(v2
        ? [{
            id: regionIds.opponent,
            kind: 'formation-clearing',
            cells: candidateCells.map(cell => ({ ...cell })),
            annotations: ['opponent-formation']
          }]
        : []),
      {
        id: regionIds.upper,
        kind: 'elevated-clearing',
        cells: v2
          ? [
              point(14, 5),
              point(15, 5),
              point(16, 5),
              point(17, 5),
              point(18, 5)
            ]
          : [point(10, 6), point(16, 5), point(22, 7)],
        annotations: ['high-ground']
      },
      {
        id: regionIds.lateral,
        kind: 'flank-clearing',
        cells: v2
          ? [point(10, 16), point(11, 16), point(12, 16)]
          : [point(7, 15), point(10, 17)],
        annotations: ['flank']
      },
      {
        id: regionIds.central,
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
        ownerFeatureId: regionIds.central,
        annotations: ['organic-contours', 'elevation']
      },
      {
        id: 'feature:routes',
        kind: 'route-network',
        cells: routeRecords.flatMap(record => record.cells),
        ownerFeatureId: regionIds.central,
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
        featureId: regionIds.upper,
        anchor: point(6, 9),
        occlusionBounds: { minX: 5, minY: 7, maxX: 7, maxY: 10 },
        assetFamily: 'pale-birch'
      },
      {
        id: 'obstacle:upper-east-root',
        kind: 'root-cluster',
        cells: [point(v2 ? 18 : 16, 7)],
        featureId: regionIds.upper,
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
        featureId: regionIds.lateral,
        anchor: point(5, 18),
        occlusionBounds: { minX: 4, minY: 16, maxX: 6, maxY: 19 },
        assetFamily: 'ironpine'
      },
      ...(usesFallenOakComposition
        ? [
            {
              id: 'obstacle:fallen-oak-landmark',
              kind: 'fallen-oak-landmark',
              cells: TEMPLATE_07_LANDMARK_COLLISION_CELLS.map(cell =>
                point(
                  template07LandmarkComposition.landmarkAnchor.x + cell.x,
                  template07LandmarkComposition.landmarkAnchor.y + cell.y
                )
              ),
              featureId: regionIds.central,
              anchor: { ...template07LandmarkComposition.landmarkAnchor },
              occlusionBounds: {
                minX: template07LandmarkComposition.landmarkAnchor.x,
                minY: template07LandmarkComposition.landmarkAnchor.y,
                maxX: template07LandmarkComposition.landmarkAnchor.x + 7,
                maxY: template07LandmarkComposition.landmarkAnchor.y + 2
              },
              assetFamily: 'fallen-oak-landmark'
            },
            {
              id: 'obstacle:fallen-oak-root-mass',
              kind: 'fallen-oak-root-mass',
              cells: [{ ...template07LandmarkComposition.root }],
              featureId: regionIds.central,
              anchor: { ...template07LandmarkComposition.root },
              occlusionBounds: {
                minX: template07LandmarkComposition.root.x - 1,
                minY: template07LandmarkComposition.root.y - 2,
                maxX: template07LandmarkComposition.root.x + 1,
                maxY: template07LandmarkComposition.root.y + 1
              },
              assetFamily: 'fallen-oak-root-mass'
            }
          ]
        : [{
            id: 'obstacle:central-root',
            kind: 'root-cluster',
            cells: [point(16, 18)],
            featureId: regionIds.central,
            anchor: point(16, 18),
            occlusionBounds: { minX: 15, minY: 16, maxX: 17, maxY: 19 },
            assetFamily: 'moss-boulder'
          }]),
      {
        id: 'obstacle:lower-west-tree',
        kind: 'tree-cluster',
        cells: [point(4, 23)],
        featureId: regionIds.player,
        anchor: point(4, 23),
        occlusionBounds: { minX: 3, minY: 21, maxX: 5, maxY: 24 },
        assetFamily: 'pale-birch'
      },
      {
        id: 'obstacle:lower-east-root',
        kind: 'root-cluster',
        cells: [point(17, 24)],
        featureId: regionIds.player,
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
        featureId: regionIds.upper,
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
        featureId: regionIds.lateral,
        anchor: point(7, 14),
        occlusionBounds: { minX: 6, minY: 13, maxX: 8, maxY: 15 },
        assetFamily: 'moss-boulder'
      },
      {
        id: 'obstacle:east-birch',
        kind: 'pale-birch-tree',
        cells: [point(26, 20)],
        featureId: regionIds.central,
        anchor: point(26, 20),
        occlusionBounds: { minX: 25, minY: 18, maxX: 27, maxY: 21 },
        assetFamily: 'pale-birch'
      },
      {
        id: 'obstacle:lower-ancient-tree',
        kind: 'ancient-tree',
        cells: [point(13, 23)],
        featureId: regionIds.player,
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
        featureId: regionIds.lateral,
        anchor: 'tile',
        assetFamily: 'fallen-branch'
      },
      {
        id: 'decoration:east-accent',
        kind: 'biome-accent',
        cell: point(25, 18),
        featureId: regionIds.central,
        anchor: 'tile',
        assetFamily: 'low-shrub'
      },
      {
        id: 'decoration:upper-west-accent',
        kind: 'biome-accent',
        cell: point(8, 7),
        featureId: regionIds.upper,
        anchor: 'tile',
        assetFamily: 'accent'
      },
      {
        id: 'decoration:upper-center-accent',
        kind: 'biome-accent',
        cell: point(15, 11),
        featureId: regionIds.upper,
        anchor: 'tile',
        assetFamily: 'fallen-branch'
      },
      {
        id: 'decoration:upper-east-accent',
        kind: 'biome-accent',
        cell: point(24, 10),
        featureId: regionIds.upper,
        anchor: 'tile',
        assetFamily: 'low-shrub'
      },
      {
        id: 'decoration:lateral-north-accent',
        kind: 'biome-accent',
        cell: point(5, 13),
        featureId: regionIds.lateral,
        anchor: 'tile',
        assetFamily: 'accent'
      },
      {
        id: 'decoration:lateral-south-accent',
        kind: 'biome-accent',
        cell: point(8, 20),
        featureId: regionIds.lateral,
        anchor: 'tile',
        assetFamily: 'fallen-branch'
      },
      {
        id: 'decoration:junction-north-accent',
        kind: 'biome-accent',
        cell: point(17, 14),
        featureId: regionIds.central,
        anchor: 'tile',
        assetFamily: 'low-shrub'
      },
      {
        id: 'decoration:junction-east-accent',
        kind: 'biome-accent',
        cell: point(25, 17),
        featureId: regionIds.central,
        anchor: 'tile',
        assetFamily: 'accent'
      },
      {
        id: 'decoration:lower-west-accent',
        kind: 'biome-accent',
        cell: point(6, 24),
        featureId: regionIds.player,
        anchor: 'tile',
        assetFamily: 'fallen-branch'
      },
      {
        id: 'decoration:lower-center-accent',
        kind: 'biome-accent',
        cell: point(14, 25),
        featureId: regionIds.player,
        anchor: 'tile',
        assetFamily: 'low-shrub'
      },
      {
        id: 'decoration:lower-east-accent',
        kind: 'biome-accent',
        cell: point(24, 24),
        featureId: regionIds.player,
        anchor: 'tile',
        assetFamily: 'accent'
      },
      {
        id: 'decoration:upper-ridge-branch',
        kind: 'biome-accent',
        cell: point(11, 3),
        featureId: regionIds.upper,
        anchor: 'tile',
        assetFamily: 'fallen-branch'
      },
      {
        id: 'decoration:upper-ridge-shrub',
        kind: 'biome-accent',
        cell: point(20, 4),
        featureId: regionIds.upper,
        anchor: 'tile',
        assetFamily: 'low-shrub'
      },
      {
        id: 'decoration:west-edge-accent',
        kind: 'biome-accent',
        cell: point(3, 9),
        featureId: regionIds.lateral,
        anchor: 'tile',
        assetFamily: 'accent'
      },
      {
        id: 'decoration:east-edge-branch',
        kind: 'biome-accent',
        cell: point(27, 12),
        featureId: regionIds.central,
        anchor: 'tile',
        assetFamily: 'fallen-branch'
      },
      {
        id: 'decoration:central-shrub',
        kind: 'biome-accent',
        cell: point(13, 16),
        featureId: regionIds.central,
        anchor: 'tile',
        assetFamily: 'low-shrub'
      },
      {
        id: 'decoration:lower-east-accent-secondary',
        kind: 'biome-accent',
        cell: point(26, 23),
        featureId: regionIds.player,
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
        ...(sidecar.spawnIntent.minimumApproaches === 3 ? [{
          id: 'exit:player-center',
          side: 'player',
          cell: point(16, 27),
          approachRegionId: 'approach:player-center'
        }] : []),
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
        },
        ...(sidecar.spawnIntent.minimumApproaches === 3 ? [{
          id: 'exit:opponent-center',
          side: 'opponent',
          cell: point(16, 9),
          approachRegionId: 'approach:opponent-center'
        }] : [])
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
        ...(sidecar.spawnIntent.minimumApproaches === 3 ? [{
          id: 'approach:player-center',
          side: 'player',
          cells: [point(15, 27), point(16, 27), point(17, 27)]
        }] : []),
        {
          id: 'approach:opponent-west',
          side: 'opponent',
          cells: [point(9, 9), point(10, 9), point(11, 9)]
        },
        {
          id: 'approach:opponent-east',
          side: 'opponent',
          cells: [point(20, 9), point(21, 9), point(22, 9)]
        },
        ...(sidecar.spawnIntent.minimumApproaches === 3 ? [{
          id: 'approach:opponent-center',
          side: 'opponent',
          cells: [point(15, 9), point(16, 9), point(17, 9)]
        }] : [])
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
      ...(usesFallenOakComposition
        ? TEMPLATE_07_SURFACE_MATERIALS.map(record => ({
            category: 'surface',
            symbol: record.symbol
          }))
        : [{ category: 'surface', symbol: 'ground' }]),
      { category: 'route', symbol: 'path' },
      { category: 'connection', symbol: 'stairs' },
      { category: 'connection', symbol: 'slope' },
      { category: 'obstacle', symbol: 'ancient-tree' },
      ...(usesFallenOakComposition
        ? [
            { category: 'obstacle', symbol: 'fallen-oak-root-mass' },
            { category: 'obstacle', symbol: 'fallen-oak-landmark' }
          ]
        : []),
      { category: 'obstacle', symbol: 'ironpine' },
      { category: 'obstacle', symbol: 'moss-boulder' },
      { category: 'obstacle', symbol: 'pale-birch' },
      { category: 'decoration', symbol: 'accent' },
      { category: 'decoration', symbol: 'fallen-branch' },
      { category: 'decoration', symbol: 'low-shrub' },
      { category: 'boundary', symbol: 'earth-face' },
      ...(usesFallenOakComposition
        ? [{ category: 'boundary', symbol: 'fieldstone-face' }]
        : []),
      { category: 'boundary', symbol: 'forest-edge' }
    ],
    generationNotes: [
      'Complete contract example only; author a distinct sidecar-driven composition.'
    ]
  };
}

function createCaveTemplate01ContractExample(sidecar, mapId) {
  const blueprint = createBlueprintContractExample(sidecar, mapId, {
    skipCaveSpecialization: true
  });
  const originalRegionIds = new Map(
    blueprint.regions.map(region => [region.id, region])
  );
  const playerRegion = blueprint.regions.find(region =>
    region.kind === 'formation-clearing'
    && region.annotations.includes('player-formation')
  );
  const opponentRegion = blueprint.regions.find(region =>
    region.kind === 'formation-clearing'
    && region.annotations.includes('opponent-formation')
  );
  const elevatedRegion = blueprint.regions.find(
    region => region.kind === 'elevated-clearing'
  );
  const flankRegion = blueprint.regions.find(
    region => region.kind === 'flank-clearing'
  );
  const centralRegion = blueprint.regions.find(
    region => region.kind === 'route-junction'
  );
  const renamedRegionIds = new Map([
    [playerRegion.id, 'southern-formation-cavern'],
    [opponentRegion.id, 'northern-crystal-grotto'],
    [elevatedRegion.id, 'western-flowstone-terrace'],
    [flankRegion.id, 'eastern-stalagmite-shelf'],
    [centralRegion.id, 'central-limestone-sink']
  ]);
  const renameRegionReference = id => renamedRegionIds.get(id) ?? id;

  playerRegion.id = 'southern-formation-cavern';
  opponentRegion.id = 'northern-crystal-grotto';
  elevatedRegion.id = 'western-flowstone-terrace';
  flankRegion.id = 'eastern-stalagmite-shelf';
  centralRegion.id = 'central-limestone-sink';
  playerRegion.annotations = ['player-formation', 'southern-cavern'];
  opponentRegion.annotations = ['opponent-formation', 'crystal-grotto'];
  elevatedRegion.annotations = ['raised-flowstone', 'mixed-access'];
  flankRegion.annotations = ['stalagmite-shelf', 'eastern-route'];
  centralRegion.annotations = ['shallow-sink', 'central-route'];

  for (const row of blueprint.surfaceGrid) {
    for (const surface of row) {
      if (!surface) continue;
      surface.material = 'worn-floor';
      surface.featureId = renameRegionReference(surface.featureId);
    }
  }
  for (const feature of blueprint.features) {
    feature.ownerFeatureId = renameRegionReference(feature.ownerFeatureId);
  }
  const elevationFeature = blueprint.features.find(
    feature => feature.id === 'feature:terraces'
  );
  elevationFeature.id = 'feature:elevation';
  elevationFeature.kind = 'cave-elevation';
  elevationFeature.ownerFeatureId = 'central-limestone-sink';
  elevationFeature.annotations = ['sink', 'terrace', 'shelf'];
  const routeFeature = blueprint.features.find(
    feature => feature.id === 'feature:routes'
  );
  routeFeature.kind = 'curved-cave-passages';
  routeFeature.ownerFeatureId = 'central-limestone-sink';
  routeFeature.annotations = ['central', 'west', 'east'];
  const boundaryFeature = blueprint.features.find(
    feature => feature.id === 'feature:boundary'
  );
  boundaryFeature.kind = 'cavern-boundary';
  boundaryFeature.annotations = ['irregular-limestone'];

  const playerCells = [
    point(12, 27), point(14, 27), point(16, 27), point(18, 27), point(15, 26)
  ];
  blueprint.spawn.playerSlots.forEach((slot, index) => {
    slot.cell = { ...playerCells[index] };
  });
  playerRegion.cells = playerCells.map(cell => ({ ...cell }));
  const opponentCells = [
    ...[11, 16, 21].map(x => point(x, 6)),
    ...[10, 14, 18, 22].map(x => point(x, 7)),
    ...[9, 12, 15, 18, 21].map(x => point(x, 8)),
    ...[10, 14, 18, 22].map(x => point(x, 9)),
    ...[9, 12, 15, 18, 21].map(x => point(x, 10)),
    ...[11, 15, 21].map(x => point(x, 11))
  ];
  blueprint.spawn.opponentCandidates.forEach((candidate, index) => {
    candidate.cell = { ...opponentCells[index] };
  });
  blueprint.spawn.opponentZones[0].cells = opponentCells.map(cell => ({ ...cell }));
  opponentRegion.cells = blueprint.spawn.opponentCandidates.map(candidate => ({
    ...candidate.cell
  }));

  const verticalCells = (x, fromY, toY) => {
    const cells = [];
    for (
      let y = fromY;
      y !== toY + Math.sign(toY - fromY);
      y += Math.sign(toY - fromY)
    ) cells.push(point(x, y));
    return cells;
  };
  blueprint.routes = [
    {
      id: 'route:central-sink',
      kind: 'primary',
      material: 'worn-floor',
      cells: verticalCells(15, 25, 8),
      required: true,
      width: 2,
      featureId: 'feature:routes',
      assetFamily: 'curved-passage'
    },
    {
      id: 'route:western-terrace',
      kind: 'primary',
      material: 'worn-floor',
      cells: [
        ...verticalCells(12, 26, 20),
        point(13, 20), point(13, 19), point(13, 18), point(14, 18),
        point(14, 17), point(13, 17), point(12, 17), point(11, 17),
        ...verticalCells(11, 16, 8)
      ],
      required: true,
      width: 2,
      featureId: 'feature:routes',
      assetFamily: 'curved-passage'
    },
    {
      id: 'route:eastern-shelf',
      kind: 'primary',
      material: 'worn-floor',
      cells: [
        ...verticalCells(18, 26, 21),
        point(19, 21), point(19, 20), point(19, 19), point(18, 19),
        point(17, 19), point(16, 19), point(16, 18), point(16, 17),
        point(17, 17), point(18, 17), point(19, 17), point(20, 17),
        point(21, 17), ...verticalCells(21, 16, 8)
      ],
      required: true,
      width: 2,
      featureId: 'feature:routes',
      assetFamily: 'curved-passage'
    }
  ];
  routeFeature.cells = blueprint.routes.flatMap(route => route.cells).filter(
    (cell, index, cells) => cells.findIndex(candidate => (
      candidate.x === cell.x && candidate.y === cell.y
    )) === index
  );

  elevatedRegion.cells = [11, 12, 13, 14, 15].map(x => point(x, 17));
  flankRegion.cells = [
    point(16, 19), point(17, 19), point(18, 19),
    point(19, 19), point(19, 20)
  ];
  centralRegion.cells = [
    point(14, 14), point(15, 14), point(15, 15), point(16, 15)
  ];
  elevationFeature.cells = [
    ...elevatedRegion.cells,
    ...flankRegion.cells,
    ...centralRegion.cells
  ].map(cell => ({ ...cell }));
  for (let y = 0; y < blueprint.dimensions.height; y += 1) {
    for (let x = 0; x < blueprint.dimensions.width; x += 1) {
      if (blueprint.renderMask[y][x]) blueprint.elevation[y][x] = 1;
    }
  }
  for (let y = 3; y <= 11; y += 1) {
    for (let x = 8; x <= 23; x += 1) {
      if (blueprint.renderMask[y][x]) blueprint.elevation[y][x] = 2;
    }
  }
  for (const cell of opponentRegion.cells) blueprint.elevation[cell.y][cell.x] = 2;
  for (const cell of elevatedRegion.cells) blueprint.elevation[cell.y][cell.x] = 2;
  for (const cell of [...flankRegion.cells, ...centralRegion.cells]) {
    blueprint.elevation[cell.y][cell.x] = 0;
  }

  const cellKeyForCave = cell => `${cell.x},${cell.y}`;
  const westernKeys = new Set(elevatedRegion.cells.map(cellKeyForCave));
  const northernKeys = new Set(opponentRegion.cells.map(cellKeyForCave));
  blueprint.connections = [];
  for (const route of blueprint.routes) {
    for (let index = 1; index < route.cells.length; index += 1) {
      const from = route.cells[index - 1];
      const to = route.cells[index];
      if (blueprint.elevation[from.y][from.x] === blueprint.elevation[to.y][to.x]) {
        continue;
      }
      const westernPortal = westernKeys.has(cellKeyForCave(from))
        !== westernKeys.has(cellKeyForCave(to));
      const northernPortal = northernKeys.has(cellKeyForCave(from))
        !== northernKeys.has(cellKeyForCave(to));
      const kind = (
        (westernPortal || northernPortal)
        && route.id === 'route:central-sink'
      )
        ? 'stairs'
        : 'slope';
      blueprint.connections.push({
        id: `connection:${route.id.slice(6)}:${index}`,
        from: { ...from },
        to: { ...to },
        kind,
        traversable: true,
        bidirectional: true,
        featureId: 'feature:elevation',
        assetFamily: kind === 'stairs' ? 'carved-stairs' : 'natural-ramp'
      });
    }
  }

  const obstacleFamilies = [
    'stalagmite-cluster', 'broken-column', 'flowstone-curtain', 'fallen-rock'
  ];
  const obstacleCells = [
    point(4, 15), point(27, 15), point(6, 9), point(25, 9),
    point(5, 19), point(26, 20), point(9, 13), point(23, 13)
  ];
  blueprint.obstacles = obstacleCells.map((cell, index) => ({
    id: `obstacle:cave-${index + 1}`,
    kind: obstacleFamilies[index % obstacleFamilies.length],
    cells: [{ ...cell }],
    featureId: index < 2 ? 'feature:boundary' : 'central-limestone-sink',
    anchor: { ...cell },
    occlusionBounds: {
      minX: cell.x - 1,
      minY: cell.y - 1,
      maxX: cell.x + 1,
      maxY: cell.y + 1
    },
    assetFamily: obstacleFamilies[index % obstacleFamilies.length]
  }));
  const decorationFamilies = [
    'calcite-crystals', 'mineral-staining', 'scattered-rubble'
  ];
  const decorationCells = [
    point(6, 11), point(25, 11), point(8, 14), point(23, 14),
    point(7, 20), point(24, 20), point(10, 23), point(21, 23), point(16, 22)
  ];
  blueprint.decorations = decorationCells.map((cell, index) => ({
    id: `decoration:cave-${index + 1}`,
    kind: decorationFamilies[index % decorationFamilies.length],
    cell: { ...cell },
    featureId: index < 3
      ? 'western-flowstone-terrace'
      : index < 6
        ? 'eastern-stalagmite-shelf'
        : 'southern-formation-cavern',
    anchor: 'tile',
    assetFamily: decorationFamilies[index % decorationFamilies.length]
  }));
  blueprint.boundaries.forEach((boundary, index) => {
    boundary.kind = 'cavern-edge';
    boundary.featureId = 'feature:boundary';
    boundary.assetFamily = index % 2 === 0 ? 'flowstone-edge' : 'layered-face';
  });

  const exitCells = {
    player: [point(11, 23), point(15, 23), point(19, 23)],
    opponent: [point(11, 12), point(16, 12), point(21, 12)]
  };
  for (const side of ['player', 'opponent']) {
    const exits = blueprint.spawn.exits.filter(exit => exit.side === side);
    exits.forEach((exit, index) => {
      exit.cell = { ...exitCells[side][index] };
      const approach = blueprint.spawn.approachRegions.find(
        region => region.id === exit.approachRegionId
      );
      approach.cells = [-1, 0, 1].map(dx => point(exit.cell.x + dx, exit.cell.y));
    });
  }
  blueprint.spawn.formationFacing = { player: 'n', opponent: 's' };
  blueprint.spawn.tacticalAnnotations[0] = {
    id: 'annotation:northern-crystal-cover',
    kind: 'high-ground',
    cells: blueprint.spawn.opponentCandidates
      .filter(candidate => candidate.cell.y <= 10)
      .map(candidate => ({ ...candidate.cell })),
    tags: ['ranged']
  };
  for (const candidate of blueprint.spawn.opponentCandidates) {
    candidate.tacticalAnnotationIds = [];
  }
  blueprint.expectedAssetFamilies = [
    { category: 'surface', symbol: 'worn-floor' },
    { category: 'route', symbol: 'curved-passage' },
    { category: 'connection', symbol: 'natural-ramp' },
    { category: 'connection', symbol: 'carved-stairs' },
    { category: 'boundary', symbol: 'flowstone-edge' },
    { category: 'boundary', symbol: 'layered-face' },
    { category: 'obstacle', symbol: 'stalagmite-cluster' },
    { category: 'obstacle', symbol: 'broken-column' },
    { category: 'obstacle', symbol: 'flowstone-curtain' },
    { category: 'obstacle', symbol: 'fallen-rock' },
    { category: 'decoration', symbol: 'calcite-crystals' },
    { category: 'decoration', symbol: 'mineral-staining' },
    { category: 'decoration', symbol: 'scattered-rubble' }
  ];
  blueprint.generationNotes = [
    'Cave contract example only; author a distinct sidecar-driven composition.'
  ];
  if (originalRegionIds.size !== 5) {
    fail('cave-template-01 contract example requires exactly five semantic regions');
  }
  return blueprint;
}

function blueprintContract(sidecar, mapId) {
  const usesFallenOakComposition = sidecar.id === TEMPLATE_07_ID;
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
    assetFamilyGeometry: [
      {
        category: 'obstacle',
        symbol: 'landmark',
        footprint: { width: 1, height: 1 },
        collisionCells: [point(0, 0)],
        authoringRule: usesFallenOakComposition
          ? 'one record per tile for every family except fallen-oak-landmark'
          : 'one record per tile; repeat the family with a unique id for clusters'
      },
      ...(usesFallenOakComposition
        ? [{
            category: 'obstacle',
            symbol: 'fallen-oak-landmark',
            footprint: { width: 8, height: 3 },
            collisionCells: TEMPLATE_07_LANDMARK_COLLISION_CELLS,
            authoringRule:
              'exactly one diagonal ten-cell record; anchor at collision cell 0,0'
          }]
        : [])
    ],
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

/**
 * Produces the deterministic standalone authored starter staged for the
 * isolated worker. The contract example remains the neutral comparison
 * baseline; this starter applies two bounded, validator-safe composition
 * decisions so the worker never has to rewrite the large masks and grids.
 */
export function createBlueprintAuthoredStarter(sidecar, mapId) {
  const starter = structuredClone(
    createBlueprintContractExample(sidecar, mapId)
  );
  if (!usesBlueprintV2SemanticContract(sidecar.id)) return starter;

  if (sidecar.id === CAVE_TEMPLATE_01_ID) {
    const variant = variantKey(mapId);
    const playerSlot = starter.spawn.playerSlots[1];
    const previousPlayerCell = { ...playerSlot.cell };
    playerSlot.cell = {
      a: point(13, 27),
      b: point(14, 26),
      c: point(13, 26)
    }[variant];
    const playerRegion = starter.regions.find(
      region => region.id === 'southern-formation-cavern'
    );
    const regionCell = playerRegion.cells.find(cell => (
      cell.x === previousPlayerCell.x && cell.y === previousPlayerCell.y
    ));
    Object.assign(regionCell, playerSlot.cell);
    starter.decorations[0].cell = {
      a: point(5, 11),
      b: point(6, 12),
      c: point(7, 11)
    }[variant];
    return starter;
  }

  const variant = variantKey(mapId);
  if (sidecar.id !== TEMPLATE_07_ID) {
    const flankCells = {
      a: [
        point(12, 17), point(11, 17), point(10, 17), point(10, 18),
        point(9, 18), point(8, 18), point(7, 18), point(6, 18)
      ],
      b: [
        point(15, 15), point(14, 15), point(13, 15), point(12, 15),
        point(11, 15), point(10, 15), point(9, 15), point(8, 15),
        point(7, 15), point(6, 15)
      ],
      c: [
        point(14, 16), point(13, 16), point(12, 16), point(11, 16),
        point(10, 16), point(9, 16), point(8, 16), point(7, 16), point(7, 17)
      ]
    }[variant];
    const flankRoute = {
      id: 'route:flank-branch',
      kind: 'secondary',
      material: 'ground',
      cells: flankCells,
      required: true,
      width: 2,
      featureId: 'feature:routes',
      assetFamily: 'path'
    };
    const existingFlankIndex = starter.routes.findIndex(
      route => route.id === flankRoute.id
    );
    if (existingFlankIndex === -1) starter.routes.push(flankRoute);
    else starter.routes[existingFlankIndex] = flankRoute;
  }
  starter.features.find(feature => feature.id === 'feature:routes').cells =
    starter.routes.flatMap(route => route.cells).filter((cell, index, cells) =>
      cells.findIndex(candidate =>
        candidate.x === cell.x && candidate.y === cell.y
      ) === index
    );

  starter.features.find(feature => feature.id === 'feature:terraces').cells[0] = {
    a: point(7, 14),
    b: point(7, 15),
    c: point(8, 14)
  }[variant];
  const regionCells = {
    a: {
      upper: [14, 15, 16, 17, 18].map(x => point(x, 5)),
      lateral: [point(9, 16), point(10, 16), point(11, 16)],
      central: [point(15, 15), point(15, 16), point(16, 16)]
    },
    b: {
      upper: [14, 15, 16, 17, 18].map(x => point(x, 5)),
      lateral: [point(10, 17), point(11, 17), point(11, 18)],
      central: [point(16, 15), point(16, 16), point(17, 16)]
    },
    c: {
      upper: [14, 15, 16, 17, 18].map(x => point(x, 5)),
      lateral: [point(9, 17), point(10, 17), point(10, 18)],
      central: [point(15, 16), point(16, 16), point(16, 17)]
    }
  }[variant];
  starter.regions.find(region => region.kind === 'elevated-clearing').cells =
    regionCells.upper;
  starter.regions.find(region => region.kind === 'flank-clearing').cells =
    regionCells.lateral;
  starter.regions.find(region => region.kind === 'route-junction').cells =
    regionCells.central;

  const playerSlot = starter.spawn.playerSlots[0];
  const previousPlayerCell = { ...playerSlot.cell };
  playerSlot.cell = {
    a: point(5, 24),
    b: point(6, 25),
    c: point(4, 25)
  }[variant];
  const playerRegion = starter.regions.find(region =>
    region.kind === 'formation-clearing'
    && region.cells.some(cell =>
      cell.x === previousPlayerCell.x && cell.y === previousPlayerCell.y
    )
  );
  const playerRegionCell = playerRegion.cells.find(cell =>
    cell.x === previousPlayerCell.x && cell.y === previousPlayerCell.y
  );
  playerRegionCell.x = playerSlot.cell.x;
  playerRegionCell.y = playerSlot.cell.y;

  if (sidecar.id === TEMPLATE_07_ID) {
    const composition = TEMPLATE_07_LANDMARK_COMPOSITIONS[variant];
    const landmark = starter.obstacles.find(
      record => record.id === 'obstacle:fallen-oak-landmark'
    );
    landmark.cells = TEMPLATE_07_LANDMARK_COLLISION_CELLS.map(cell => point(
      composition.landmarkAnchor.x + cell.x,
      composition.landmarkAnchor.y + cell.y
    ));
    landmark.anchor = { ...composition.landmarkAnchor };
    landmark.occlusionBounds = {
      minX: composition.landmarkAnchor.x,
      minY: composition.landmarkAnchor.y,
      maxX: composition.landmarkAnchor.x + 7,
      maxY: composition.landmarkAnchor.y + 2
    };
    const rootMass = starter.obstacles.find(
      record => record.id === 'obstacle:fallen-oak-root-mass'
    );
    rootMass.cells = [{ ...composition.root }];
    rootMass.anchor = { ...composition.root };
    rootMass.occlusionBounds = {
      minX: composition.root.x - 1,
      minY: composition.root.y - 2,
      maxX: composition.root.x + 1,
      maxY: composition.root.y + 1
    };
    if (variant === 'a') {
      const lowerAncientTree = starter.obstacles.find(
        record => record.id === 'obstacle:lower-ancient-tree'
      );
      lowerAncientTree.cells = [point(12, 25)];
      lowerAncientTree.anchor = point(12, 25);
      lowerAncientTree.occlusionBounds = {
        minX: 11,
        minY: 23,
        maxX: 13,
        maxY: 26
      };
    }
    const formationProfile = TEMPLATE_07_FORMATION_PROFILES[variant];
    starter.spawn.playerSlots.forEach((slot, index) => {
      slot.cell = { ...formationProfile.players[index] };
    });
    starter.spawn.opponentCandidates.forEach((candidate, index) => {
      candidate.cell = { ...formationProfile.opponents[index] };
    });
    starter.spawn.opponentZones[0].cells =
      formationProfile.opponents.map(cell => ({ ...cell }));
    starter.regions.find(region =>
      region.kind === 'formation-clearing'
      && region.annotations.includes('player-formation')
    ).cells = formationProfile.players.map(cell => ({ ...cell }));
    starter.regions.find(region =>
      region.kind === 'formation-clearing'
      && region.annotations.includes('opponent-formation')
    ).cells = formationProfile.opponents.map(cell => ({ ...cell }));
    starter.spawn.tacticalAnnotations[0].cells =
      formationProfile.opponents
        .filter(cell => cell.y <= 10)
        .map(cell => ({ ...cell }));
    const exitCells = [
      ...formationProfile.exits.player,
      ...formationProfile.exits.opponent
    ];
    starter.spawn.exits.forEach((exit, index) => {
      exit.cell = { ...exitCells[index] };
      const approach = starter.spawn.approachRegions.find(
        region => region.id === exit.approachRegionId
      );
      approach.cells = [-1, 0, 1].map(dx =>
        point(exit.cell.x + dx, exit.cell.y)
      );
    });
  } else {
    const obstacle = starter.obstacles.find(
      record => record.id === 'obstacle:central-root'
    );
    const obstaclePosition = {
      a: point(16, 18),
      b: point(16, 19),
      c: point(17, 19)
    }[variant];
    const obstacleDx = obstaclePosition.x - obstacle.anchor.x;
    const obstacleDy = obstaclePosition.y - obstacle.anchor.y;
    obstacle.cells = [{ ...obstaclePosition }];
    obstacle.anchor = { ...obstaclePosition };
    obstacle.occlusionBounds = {
      minX: obstacle.occlusionBounds.minX + obstacleDx,
      minY: obstacle.occlusionBounds.minY + obstacleDy,
      maxX: obstacle.occlusionBounds.maxX + obstacleDx,
      maxY: obstacle.occlusionBounds.maxY + obstacleDy
    };
  }

  const connectionIndex = sidecar.id === TEMPLATE_07_ID
    ? 5
    : { a: 0, b: 4, c: 5 }[variant];
  const connection = starter.connections[connectionIndex];
  connection.kind = connection.kind === 'stairs' ? 'slope' : 'stairs';
  connection.assetFamily = connection.kind;

  starter.decorations[0].cell = {
    a: point(5, 11),
    b: point(6, 12),
    c: point(7, 11)
  }[variant];
  return starter;
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
  const v2 = usesBlueprintV2SemanticContract(sidecar.id);
  const usesFallenOakComposition = sidecar.id === TEMPLATE_07_ID;
  const usesCaveComposition = sidecar.id === CAVE_TEMPLATE_01_ID;
  const currentLifecycle = usesBlueprintApprovalSchemaV3(sidecar.id);
  const caveVariantSafeguard = {
    a: `Cave Variant A bounded-authoring safeguard: retain the three required
primary route identities and their distinct semantics: central through
central-limestone-sink, west through western-flowstone-terrace, and east through
eastern-stalagmite-shelf. Author a bounded route-geometry variation without merging
their internal vertices. Preserve southern player formation and northern opponent
formation placement, then coordinate one safe cave-decoration move.`,
    b: `Cave Variant B bounded-authoring safeguard: keep all three internally
vertex-disjoint southern-to-northern primary passage identities and preserve the
separate natural-ramp and carved-stairs portals into western-flowstone-terrace.
Author a bounded terrace/elevation variation, coordinate every changed route edge,
and make one safe mineral or crystal decoration move.`,
    c: `Cave Variant C bounded-authoring safeguard: do not mirror or transpose a
sibling composition. Preserve the central sink, western flowstone terrace, eastern
stalagmite shelf, all three distinct primary passages, and the separate ramp/stair
elevation semantics. Author a bounded eastern-route or obstacle/boundary variation
and coordinate every affected region, connection, and cave-decoration record.`
  }[variant];
  const expectedAssetFamilyCount =
    createBlueprintContractExample(sidecar, mapId).expectedAssetFamilies.length;
  const sourceInstruction = textTemplateFallback
    ? `The exact approved source image remains staged and hash-verified for audit, but this
worker must not open it or pass its path to another tool. Use the reviewed composition,
topology, height, route, boundary, spawn, landmark, and forbidden-pattern intent in
inputs/sidecar.json as the complete authoring authority.`
    : `The exact approved source image is attached and available beneath inputs/. Treat it
as composition-only inspiration and obey inputs/sidecar.json as gameplay authority.`;
  const variantSafeguard = v2
    ? (usesCaveComposition ? caveVariantSafeguard : {
        a: usesFallenOakComposition
          ? `Template-07 Variant A bounded-authoring safeguard: preserve every required
route record's ordered centerline cells exactly as staged in
inputs/starter.json; those centerlines already prove the required
interlocking-loop connectivity and mixed slope/stair access. Preserve the
fixed fallen-oak landmark/root composition and the staged variant-specific
formation and elevation/region macro topology. Make the required core composition
change by moving the player formation spawn at (5, 24) exactly one cardinal
step to (6, 24), and update the matching formation-clearing region cell to
preserve exact membership. Make the second authoritative change by moving
decoration:west-accent from (5, 11) exactly one cardinal step to (6, 11) while
preserving its feature ownership and avoiding spawn, route, obstacle, and
boundary cells.`
          : `Variant A retry safeguard: use every fixed expectedAssetFamilies symbol and
build a broad compact interlocking junction with at least two internally
vertex-disjoint formation-to-formation crossings in the explicit ordered route
centerlines. No cell or edge may be the sole articulation crossing, and nearby
parallel route surfaces do not repair a shared centerline choke. Give every overlook
whose reviewed relationship names both access types one natural-slope portal and one
vertex-disjoint stair portal on different required routes. Do not spend another
attempt on a sparse composition that leaves a declared family unused or stretches the
junction into parallel route rails.`,
        b: usesFallenOakComposition
          ? `Template-07 Variant B bounded-authoring safeguard: preserve every required
primary route record's ordered centerline cells exactly as staged in
inputs/starter.json, together with the fixed fallen-oak landmark/root composition
and the staged variant-specific formation and elevation/region macro topology.
Make the required core composition change by moving the player formation spawn
at (6, 24) exactly one cardinal step to (7, 24), and update the matching
formation-clearing region cell to preserve exact membership. Make the second
authoritative change by moving decoration:west-accent from (6, 12) exactly one
cardinal step to (7, 12), while avoiding spawn, route, obstacle, and boundary
cells. Do not copy a sibling variant's route, formation, elevation, feature, or
connection geometry.`
          : `Variant B retry safeguard: preserve every required route record's ordered
centerline cells exactly as staged in inputs/starter.json; those centerlines already
prove the required interlocking-loop connectivity. Express the terrace emphasis with
a bounded elevation/connection edit, not a route edit. Make the required core
composition change by moving one formation spawn cell one cardinal step to an
eligible playable neighbor and updating the matching formation-clearing region cell
to preserve exact membership. Elevated and staging clearing region cells must each
form a cardinally connected semantic area that intersects or cardinally touches a
required route. Never substitute a long side-by-side parallel adjacency ladder for
the starter's compact junction.`,
        c: usesFallenOakComposition
          ? `Template-07 Variant C bounded-authoring safeguard: do not mirror,
transpose, or copy a sibling topology. Preserve all three required primary
formation-to-formation route records and their ordered centerline cells exactly,
including the northwest, oak-seam, and southeast macro families. Preserve the
C-specific formation and elevation/region topology, connection-kind selection,
fixed fallen-oak landmark/root composition, and decoration:west-accent cell.
Make the required core composition change by moving the player formation spawn
at (7, 23) exactly one cardinal step to (8, 23), and update the matching
formation-clearing region cell to preserve exact membership. Make the second
authoritative change by moving decoration:west-accent from (7, 11) exactly one
cardinal step to (8, 11) while avoiding spawn, route, obstacle, and boundary
cells.`
          : `Variant C bounded-authoring safeguard: do not mirror or transpose
inputs/starter.json. Preserve its explicit third required flank route through
or cardinally touching the flank-clearing, its C-specific connection-kind
selection, and the fixed decoration:west-accent cell. Preserve every required
route record's ordered centerline cells exactly. Make the required core
composition change by moving one player formation spawn cell one cardinal
step to an eligible playable neighbor and updating the matching
formation-clearing region cell to preserve exact membership. Make the second
authoritative change by moving one other decoration cell one cardinal step
while preserving its feature ownership and avoiding spawn, route, obstacle,
and boundary cells. The candidate must retain three required route segments.`
      }[variant])
    : '';
  const requiredTopologyAreaIds = v2
    ? sidecar.topologyIntent.areas
      .filter(area => area.required === true)
      .map(area => area.id)
    : [];
  const v2SemanticSafeguard = v2
    ? `Shared ${currentLifecycle ? 'V3' : 'V2'} composition safeguards: every non-formation tactical region must
intersect or cardinally touch a required route, and every such region with multiple
cells must form one cardinally connected set. Required routes may meet at compact
figure-eight or interlocking junctions, but must not form a long side-by-side parallel
adjacency ladder. The explicit ordered primary-route centerlines must provide the
structurally declared
routeIntent.minimumApproachesPerFormation count of internally
vertex-disjoint formation-to-formation crossings; a shared articulation cell or edge
is a choke even when other route-painted cells are nearby. For three-approach
contracts, each required primary route record must itself run in order from the
player formation to the opponent formation; a dangling secondary branch cannot
substitute for a route family. A reviewed mixed
slope/stair relationship requires separate boundary portals on different required
routes, with no shared portal endpoint. Author no more traversable elevation-connection records than the
fixed map width (32 on this 32 by 32 map), and at least 75% of those traversable
connections must have from or to on a required route centerline. Use a small set of
deliberate route/landmark/fork crossings; leave other elevation edges
blocked/compiler-rendered faces. Create region records for every required
topologyIntent area using these exact IDs: ${requiredTopologyAreaIds.join(', ')}.
The prepared starter already carries those exact reviewed identities and valid
geometry. Preserve the identities and semantic relationships while making only
the bounded geometry edits required below.`
    : '';
  const assetClosureSafeguard = v2
    ? `
Every fixed expectedAssetFamilies symbol must be actually referenced at least
once by a matching candidate field. If both connection:slope and
connection:stairs are listed, author at least one traversable slope connection and at
least one traversable stairs connection.`
    : '';
  const template07VisualAuthorshipSafeguard = usesFallenOakComposition
    ? `
Template-07 visual-authorship contract: every rendered surfaceGrid cell must
retain exactly one of these material-to-feature pairs:
clover-glade:southwest-clover-glade,
fern-hazel-glade:northeast-fern-hazel-glade,
fieldstone-terrace:northwest-fieldstone-terrace,
hawthorn-loop:southeast-hawthorn-loop, and
dry-ravine:fallen-oak-root-seam. Each pair must cover at least one rendered
cell; do not flatten the scene back to generic ground or leave the northeast
fern-hazel glade without surface coverage. Preserve the organic, variant-specific
regions: a long irregular diagonal ravine, irregular southwest clover and
northeast fern-hazel areas, a localized northwest fieldstone terrace, and a
southeast hawthorn loop. Do not replace them with rectangles, quadrant bands,
or checkerboards. Preserve exactly one fallen-oak-landmark blocking obstacle
with ten collision cells forming its fixed 8 by 3 diagonal footprint and
exactly one cardinally adjacent one-cell
fallen-oak-root-mass obstacle. The ${variant.toUpperCase()} composition fixes
the landmark anchor at (${TEMPLATE_07_LANDMARK_COMPOSITIONS[variant].landmarkAnchor.x}, ${TEMPLATE_07_LANDMARK_COMPOSITIONS[variant].landmarkAnchor.y})
and root mass at (${TEMPLATE_07_LANDMARK_COMPOSITIONS[variant].root.x}, ${TEMPLATE_07_LANDMARK_COMPOSITIONS[variant].root.y}); keep the root in the
dry ravine, at least two landmark cells on dry-ravine, and at least one
landmark cell continuing onto a non-ravine bank. Retain boundary:fieldstone-face so the
fieldstone-terrace material has its distinct elevation-face family.`
    : '';
  const candidateAuthoringInstruction = v2
    ? `The closed contract summary is available at inputs/contract.json. A
standalone schema-valid, ${currentLifecycle ? 'V3-lifecycle-semantic-valid' : 'V2-semantic-valid'} 32 by 32 authoring starter is
available separately at inputs/starter.json. First run
\`cp inputs/starter.json candidate.json\`, then make targeted, bounded edits to
candidate.json. The finished candidate must change at least two authoritative
geometry groups relative to the starter, and at least one changed group must be
core composition: mask/surface geometry, required-route geometry, or spawn
arrangement. Connection-kind plus decorative-only edits are insufficient.
Preserve candidateId, templateId, all existing record identities, every required
topology area ID, and the fixed expectedAssetFamilies closure. Coordinate any
dependent region or feature cells needed to keep the result semantically valid.
Do not merely reserialize the starter, retype large masks or grids, or make
unbounded wholesale changes.`
    : `The closed contract summary is available at inputs/contract.json. Its
completeShapeExample is deliberately valid at the required 32 by 32 scale:
copy it mechanically first, then make bounded, deliberate variant-specific
symbolic changes rather than retyping large masks or grids by hand. A copy of
the example, or a candidate that changes only IDs, notes, or one cosmetic
record, is rejected. Implement the variant brief by changing at least two
authoritative geometry groups while preserving every invariant: mask/surface
topology, route cells, elevation/connection geometry, spawn-cell arrangement,
or obstacle/boundary/decorative feature cells.`;
  const expectedAssetFamiliesAuthority = v2
    ? 'inputs/starter.json expectedAssetFamilies'
    : 'completeShapeExample.expectedAssetFamilies';
  return `${profile.prompt}

Variant brief:
${profile.variantBriefs[variant]}
${variantSafeguard ? `\n${variantSafeguard}\n` : ''}
${v2SemanticSafeguard ? `\n${v2SemanticSafeguard}\n` : ''}

Negative constraints:
${profile.negativeConstraints.map(item => `- ${item}`).join('\n')}

The approved source sidecar is available at inputs/sidecar.json.
${sourceInstruction}
${candidateAuthoringInstruction}
${template07VisualAuthorshipSafeguard}
Keep expectedAssetFamilies byte-for-byte equivalent to
${expectedAssetFamiliesAuthority} after canonical sorting. It is a
fixed ${expectedAssetFamilyCount}-symbol compiler contract, not an inventory to rename from the authored
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
${usesFallenOakComposition
    ? `The fixed obstacle:fallen-oak-landmark renderer is the sole multi-cell
exception: it has exactly ten blocking collision cells in a fixed 8 by 3
diagonal footprint at offsets (0,0), (1,0), (2,0), (2,1), (3,1), (4,1),
(5,1), (5,2), (6,2), and (7,2). Its anchor must be the northwest collision cell. The
fallen-oak-root-mass must contain exactly one cell, use that cell as its anchor,
and cardinally touch the landmark. Every other obstacle record must contain
exactly one cell and use that same cell as its anchor.`
    : usesCaveComposition
      ? `Cave obstacle families stalagmite-cluster, broken-column,
flowstone-curtain, and fallen-rock each use exactly one collision cell per record,
with the anchor on that same cell. Build larger cave formations from separate,
uniquely identified one-cell records.`
      : `The fixed obstacle:landmark renderer has exactly a one-tile collision footprint.
Every obstacle record must therefore contain exactly one cell and use that same
cell as its anchor. Build larger clusters from separate uniquely identified
one-cell obstacle records; never make one record span multiple cells.`}
Every tags array must contain unique values. An opponent candidate may name a
tactical annotation only when its cell is included in that annotation's cells,
and its cell must also belong to the opponent zone named by zoneId.

Author candidate "${mapId}" for template "${sidecar.id}" and theme
"${sidecar.theme}". Write exactly one UTF-8 JSON document to candidate.json in
the current disposable workspace${v2 ? ' after the bounded starter edits required above' : ''}.
Do not create directories, logs, approvals,
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
  starterBytes,
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
    candidateContext: { mapId, sidecar, starterBytes },
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
    'inputs/contract.json',
    'inputs/starter.json'
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
  promptProfile = null,
  historicalPromptProfiles = [],
  historicalPromptReferences = [],
  allowHistoricalPromptProfileForRejection = false
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
    && !supportedPromptProfileReference(
      metadata.promptProfile,
      promptReference,
      {
        allowHistorical: allowHistoricalPromptProfileForRejection,
        historicalReferences: historicalPromptReferences
      }
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
    const selectedPromptProfile = (
      promptReference
      && exactPromptProfileMatch(metadata.promptProfile, promptReference)
    )
      ? promptProfile
      : historicalPromptProfiles.find(loaded =>
        exactPromptProfileMatch(metadata.promptProfile, loaded.reference)
      )?.profile;
    if (!selectedPromptProfile) {
      fail('candidate prompt transcript has no exact loaded prompt profile');
    }
    const promptPath = resolveWithinProject(
      projectRoot,
      paths.prompt,
      'candidate prompt path'
    );
    await assertSafeWritePath(projectRoot, promptPath, 'candidate prompt read path');
    let actualPrompt;
    try {
      actualPrompt = await readFile(promptPath);
    } catch (error) {
      if (error.code === 'ENOENT') fail('candidate prompt transcript does not exist');
      throw error;
    }
    const fallbackModes = hasExplicitTextTemplateFallback
      ? [metadata.worker.textTemplateFallback]
      : [false, true];
    const matchingModes = fallbackModes.filter(textTemplateFallback => {
      const expectedPrompt = Buffer.from(
        `${buildBlueprintPrompt({
          profile: selectedPromptProfile,
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
    assertV2BoundedAuthoring(
      blueprint,
      createBlueprintAuthoredStarter(sidecar, mapId)
    );
  }
  if (sidecar?.id === TEMPLATE_07_ID) {
    assertTemplate07VisualAuthorship(blueprint);
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
  const starterBytes = Buffer.from(
    `${JSON.stringify(createBlueprintAuthoredStarter(sidecar, mapId), null, 2)}\n`
  );
  await Promise.all([
    copyFile(sourcePath, path.join(workspace, sourceRelativePath)),
    writeFile(path.join(inputs, 'sidecar.json'), `${JSON.stringify(sidecar, null, 2)}\n`),
    writeFile(
      path.join(inputs, 'contract.json'),
      `${JSON.stringify(blueprintContract(sidecar, mapId), null, 2)}\n`
    ),
    writeFile(
      path.join(inputs, 'starter.json'),
      starterBytes
    )
  ]);
  return { workspace, sourceRelativePath, starterBytes };
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
  const fieldstoneFaceFamily = elevationFaceFamilies.find(
    record => record.symbol === 'fieldstone-face'
  );
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
          material.symbol === 'fieldstone-terrace' && fieldstoneFaceFamily
            ? fieldstoneFaceFamily.symbol
            : elevationFaceFamily.symbol
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

function recordsById(records, project) {
  return [...records]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(record => ({ id: record.id, ...project(record) }));
}

function cellsAsSet(cells) {
  return [...cells].sort((left, right) =>
    left.y - right.y || left.x - right.x
  );
}

function routeCellsWithoutOrientation(cells) {
  const forward = [...cells];
  const reverse = [...cells].reverse();
  for (let index = 0; index < forward.length; index += 1) {
    const difference = (
      forward[index].y - reverse[index].y
      || forward[index].x - reverse[index].x
    );
    if (difference !== 0) {
      return difference < 0 ? forward : reverse;
    }
  }
  return forward;
}

function undirectedConnectionEndpoints(connection) {
  const [from, to] = [connection.from, connection.to].sort((left, right) =>
    left.y - right.y || left.x - right.x
  );
  return { from, to };
}

function boundaryEdgesAsSet(edges) {
  return [...edges].sort((left, right) => (
    left.cell.y - right.cell.y
    || left.cell.x - right.cell.x
    || (left.direction < right.direction
      ? -1
      : left.direction > right.direction ? 1 : 0)
  ));
}

function authoritativeGeometryGroups(value) {
  return [
    {
      renderMask: value.renderMask,
      playableMask: value.playableMask,
      surfaceGrid: value.surfaceGrid
    },
    recordsById(value.routes, route => ({
      cells: routeCellsWithoutOrientation(route.cells),
      required: route.required,
      width: route.width
    })),
    {
      elevation: value.elevation,
      connections: recordsById(value.connections, connection => ({
        ...undirectedConnectionEndpoints(connection),
        kind: connection.kind,
        traversable: connection.traversable
      }))
    },
    {
      playerSlots: recordsById(
        value.spawn.playerSlots,
        slot => ({ cell: slot.cell })
      ),
      opponentCandidates: recordsById(
        value.spawn.opponentCandidates,
        candidate => ({ cell: candidate.cell })
      ),
      opponentZones: recordsById(
        value.spawn.opponentZones,
        zone => ({ cells: cellsAsSet(zone.cells) })
      ),
      exits: recordsById(
        value.spawn.exits,
        exit => ({ cell: exit.cell })
      )
    },
    {
      obstacles: recordsById(
        value.obstacles,
        obstacle => ({ cells: cellsAsSet(obstacle.cells) })
      ),
      decorations: recordsById(
        value.decorations,
        decoration => ({ cell: decoration.cell })
      ),
      boundaries: recordsById(
        value.boundaries,
        boundary => ({ edges: boundaryEdgesAsSet(boundary.edges) })
      )
    }
  ];
}

function changedGeometryGroupCount(blueprint, baseline) {
  const authoredGroups = authoritativeGeometryGroups(blueprint);
  const baselineGroups = authoritativeGeometryGroups(baseline);
  return authoredGroups.reduce(
    (count, group, index) =>
      count + (stableJson(group) === stableJson(baselineGroups[index]) ? 0 : 1),
    0
  );
}

function hasCoreCompositionChange(blueprint, baseline) {
  const groups = authoritativeGeometryGroups(blueprint);
  const baselineGroups = authoritativeGeometryGroups(baseline);
  const requiredRouteGeometry = value => recordsById(
    value.routes.filter(route => route.required),
    route => ({
      cells: routeCellsWithoutOrientation(route.cells),
      required: route.required,
      width: route.width
    })
  );
  return (
    stableJson(groups[0]) !== stableJson(baselineGroups[0])
    || stableJson(requiredRouteGeometry(blueprint))
      !== stableJson(requiredRouteGeometry(baseline))
    || stableJson(groups[3]) !== stableJson(baselineGroups[3])
  );
}

function assertV2BoundedAuthoring(blueprint, starter) {
  if (
    changedGeometryGroupCount(blueprint, starter) < 2
    || !hasCoreCompositionChange(blueprint, starter)
  ) {
    fail(
      'V2 candidate blueprint must author at least two authoritative geometry '
      + 'groups relative to inputs/starter.json, including at least one core '
      + 'composition group (mask/surface, required-route geometry, or spawn '
      + 'arrangement)',
      'UNAUTHORED_TEMPLATE_MAP_BLUEPRINT'
    );
  }
}

function template07MaterialCells(blueprint) {
  const byMaterial = new Map(
    TEMPLATE_07_SURFACE_MATERIALS.map(record => [record.symbol, []])
  );
  blueprint.surfaceGrid.forEach((row, y) => row.forEach((cell, x) => {
    if (cell !== null && byMaterial.has(cell.material)) {
      byMaterial.get(cell.material).push(point(x, y));
    }
  }));
  return byMaterial;
}

function template07RegionShape(cells) {
  const keys = new Set(cells.map(cell => `${cell.x},${cell.y}`));
  const xs = cells.map(cell => cell.x);
  const ys = cells.map(cell => cell.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const rows = new Map();
  let sharedEdges = 0;
  for (const cell of cells) {
    if (keys.has(`${cell.x + 1},${cell.y}`)) sharedEdges += 1;
    if (keys.has(`${cell.x},${cell.y + 1}`)) sharedEdges += 1;
    const row = rows.get(cell.y) ?? [];
    row.push(cell.x);
    rows.set(cell.y, row);
  }
  const rowProfiles = [...rows]
    .sort((left, right) => left[0] - right[0])
    .map(([y, rowXs]) => {
      rowXs.sort((left, right) => left - right);
      let runs = 1;
      for (let index = 1; index < rowXs.length; index += 1) {
        if (rowXs[index] !== rowXs[index - 1] + 1) runs += 1;
      }
      return {
        y,
        minX: rowXs[0],
        maxX: rowXs.at(-1),
        count: rowXs.length,
        runs
      };
    });
  const unvisited = new Set(keys);
  const componentSizes = [];
  while (unvisited.size > 0) {
    const first = unvisited.values().next().value;
    unvisited.delete(first);
    const queue = [first];
    let size = 0;
    while (queue.length > 0) {
      const current = queue.pop();
      size += 1;
      const [x, y] = current.split(',').map(Number);
      for (const neighbor of [
        `${x - 1},${y}`,
        `${x + 1},${y}`,
        `${x},${y - 1}`,
        `${x},${y + 1}`
      ]) {
        if (!unvisited.delete(neighbor)) continue;
        queue.push(neighbor);
      }
    }
    componentSizes.push(size);
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    fillRatio: cells.length / ((maxX - minX + 1) * (maxY - minY + 1)),
    sharedEdges,
    largestComponent: Math.max(...componentSizes),
    rowProfiles
  };
}

function assertTemplate07OrganicSurfaceGeometry(blueprint) {
  const materialCells = template07MaterialCells(blueprint);
  for (const [symbol, cells] of materialCells) {
    if (cells.length < 16) {
      fail(
        `Template-07 organic surface ${symbol} must cover a substantial region`,
        'INVALID_TEMPLATE_MAP_BLUEPRINT'
      );
    }
    const shape = template07RegionShape(cells);
    const rowSignatures = new Set(shape.rowProfiles.map(row =>
      `${row.minX}:${row.maxX}:${row.count}:${row.runs}`
    ));
    if (
      shape.fillRatio > 0.85
      || shape.largestComponent / cells.length < 0.5
      || shape.sharedEdges / cells.length < 1.1
      || rowSignatures.size < 4
    ) {
      fail(
        `Template-07 organic surface ${symbol} must be connected and edge-complex, `
        + 'not rectangular or checkerboard-like',
        'INVALID_TEMPLATE_MAP_BLUEPRINT'
      );
    }
  }

  const ravine = template07RegionShape(materialCells.get('dry-ravine'));
  const ravineCenters = ravine.rowProfiles.map(row =>
    (row.minX + row.maxX) / 2
  );
  const centerSteps = ravineCenters.slice(1).map(
    (center, index) => Math.round((center - ravineCenters[index]) * 2) / 2
  );
  if (
    ravine.width < 14
    || ravine.height < 20
    || new Set(ravine.rowProfiles.map(row => row.count)).size < 3
    || new Set(centerSteps).size < 3
  ) {
    fail(
      'Template-07 dry-ravine must have substantial diagonal x/y extent '
      + 'and an irregular, non-linear edge',
      'INVALID_TEMPLATE_MAP_BLUEPRINT'
    );
  }

  const fieldstone =
    template07RegionShape(materialCells.get('fieldstone-terrace'));
  if (
    fieldstone.width > 14
    || fieldstone.height > 13
    || fieldstone.maxX >= blueprint.dimensions.width * 0.6
    || fieldstone.maxY >= blueprint.dimensions.height * 0.6
  ) {
    fail(
      'Template-07 fieldstone-terrace must remain localized in the northwest',
      'INVALID_TEMPLATE_MAP_BLUEPRINT'
    );
  }

  const centroid = symbol => {
    const cells = materialCells.get(symbol);
    return {
      x: cells.reduce((sum, cell) => sum + cell.x, 0) / cells.length,
      y: cells.reduce((sum, cell) => sum + cell.y, 0) / cells.length
    };
  };
  const clover = centroid('clover-glade');
  const fern = centroid('fern-hazel-glade');
  const hawthorn = centroid('hawthorn-loop');
  if (
    !(clover.x < 16 && clover.y > 16)
    || !(fern.x > 16 && fern.y < 16)
    || !(hawthorn.x > 16 && hawthorn.y > 16)
  ) {
    fail(
      'Template-07 clover, fern-hazel, and hawthorn organic regions must '
      + 'remain centered southwest, northeast, and southeast respectively',
      'INVALID_TEMPLATE_MAP_BLUEPRINT'
    );
  }
}

function assertTemplate07DistinctMaterialSignatures(blueprints) {
  const signatures = blueprints.map(blueprint =>
    blueprint.surfaceGrid.flatMap(row =>
      row.map(cell => cell?.material ?? 'void')
    )
  );
  for (let left = 0; left < signatures.length; left += 1) {
    for (let right = left + 1; right < signatures.length; right += 1) {
      let comparable = 0;
      let differences = 0;
      signatures[left].forEach((material, index) => {
        if (material === 'void' || signatures[right][index] === 'void') return;
        comparable += 1;
        if (material !== signatures[right][index]) differences += 1;
      });
      if (comparable === 0 || differences / comparable < 0.15) {
        fail(
          'Template-07 sibling material grids must have meaningfully distinct '
          + 'organic signatures',
          'INVALID_TEMPLATE_MAP_BLUEPRINT'
        );
      }
    }
  }
}

// Route/region/formation ratios are labeled-cell Jaccard distances. Elevation
// is the fraction of mutually rendered cells whose authored level differs.
// These floors reject one-cell signature churn while leaving substantial room
// for bounded candidate edits that preserve each starter's macro composition.
const TEMPLATE_07_MINIMUM_DIVERSITY_RATIOS = Object.freeze({
  route: 0.15,
  elevation: 0.05,
  nonFormationRegions: 0.25,
  formationAndExits: 0.20,
  coarseSilhouette: 0.045,
  coarseElevation: 0.12,
  coarseSurface: 0.25,
  coarseRoutes: 0.09
});
const TEMPLATE_07_COARSE_BLOCK_SIZE = 4;

function coordinateSet(items) {
  return new Set(items.map(item => `${item.label}:${item.x},${item.y}`));
}

function jaccardDifference(left, right) {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const key of left) {
    if (right.has(key)) intersection += 1;
  }
  return 1 - intersection / union.size;
}

function template07CoarseCounts(blueprint, labels, labelAt) {
  const counts = [];
  for (
    let blockY = 0;
    blockY < blueprint.dimensions.height;
    blockY += TEMPLATE_07_COARSE_BLOCK_SIZE
  ) {
    for (
      let blockX = 0;
      blockX < blueprint.dimensions.width;
      blockX += TEMPLATE_07_COARSE_BLOCK_SIZE
    ) {
      const byLabel = new Map(labels.map(label => [label, 0]));
      for (
        let y = blockY;
        y < Math.min(
          blockY + TEMPLATE_07_COARSE_BLOCK_SIZE,
          blueprint.dimensions.height
        );
        y += 1
      ) {
        for (
          let x = blockX;
          x < Math.min(
            blockX + TEMPLATE_07_COARSE_BLOCK_SIZE,
            blueprint.dimensions.width
          );
          x += 1
        ) {
          const label = labelAt(x, y);
          if (byLabel.has(label)) {
            byLabel.set(label, byLabel.get(label) + 1);
          }
        }
      }
      labels.forEach(label => counts.push(byLabel.get(label)));
    }
  }
  return counts;
}

function normalizedCoarseDifference(left, right) {
  let difference = 0;
  let mass = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference += Math.abs(left[index] - right[index]);
    mass += Math.abs(left[index]) + Math.abs(right[index]);
  }
  return mass === 0 ? 0 : difference / mass;
}

function template07CoarseDiversityRatios(left, right) {
  const requiredRouteCells = blueprint => new Set(
    blueprint.routes
      .filter(route => route.required && route.kind === 'primary')
      .flatMap(route => route.cells.map(cell => `${cell.x},${cell.y}`))
  );
  const routeLabels = ['required-primary-route'];
  const leftRoutes = requiredRouteCells(left);
  const rightRoutes = requiredRouteCells(right);
  const vectors = {
    coarseSilhouette: [
      template07CoarseCounts(
        left,
        ['rendered'],
        (x, y) => left.renderMask[y][x] ? 'rendered' : null
      ),
      template07CoarseCounts(
        right,
        ['rendered'],
        (x, y) => right.renderMask[y][x] ? 'rendered' : null
      )
    ],
    coarseElevation: [
      template07CoarseCounts(
        left,
        [0, 1, 2],
        (x, y) => left.renderMask[y][x] ? left.elevation[y][x] : null
      ),
      template07CoarseCounts(
        right,
        [0, 1, 2],
        (x, y) => right.renderMask[y][x] ? right.elevation[y][x] : null
      )
    ],
    coarseSurface: [
      template07CoarseCounts(
        left,
        TEMPLATE_07_SURFACE_MATERIALS.map(record => record.symbol),
        (x, y) => left.surfaceGrid[y][x]?.material ?? null
      ),
      template07CoarseCounts(
        right,
        TEMPLATE_07_SURFACE_MATERIALS.map(record => record.symbol),
        (x, y) => right.surfaceGrid[y][x]?.material ?? null
      )
    ],
    coarseRoutes: [
      template07CoarseCounts(
        left,
        routeLabels,
        (x, y) => leftRoutes.has(`${x},${y}`)
          ? 'required-primary-route'
          : null
      ),
      template07CoarseCounts(
        right,
        routeLabels,
        (x, y) => rightRoutes.has(`${x},${y}`)
          ? 'required-primary-route'
          : null
      )
    ]
  };
  return Object.fromEntries(
    Object.entries(vectors).map(([dimension, [leftVector, rightVector]]) => [
      dimension,
      normalizedCoarseDifference(leftVector, rightVector)
    ])
  );
}

function template07SiblingDiversityRatios(left, right) {
  const routeSet = blueprint => coordinateSet(
    blueprint.routes
      .filter(route => route.required && route.kind === 'primary')
      .flatMap(route => route.cells.map(cell => ({
        label: 'required-primary-route',
        x: cell.x,
        y: cell.y
      })))
  );
  const regionSet = blueprint => coordinateSet(
    blueprint.regions
      .filter(region => region.kind !== 'formation-clearing')
      .flatMap(region => region.cells.map(cell => ({
        label: `region:${region.id}`,
        x: cell.x,
        y: cell.y
      })))
  );
  const formationSet = blueprint => coordinateSet([
    ...blueprint.spawn.playerSlots.map(record => ({
      label: 'formation:player',
      x: record.cell.x,
      y: record.cell.y
    })),
    ...blueprint.spawn.opponentCandidates.map(record => ({
      label: 'formation:opponent',
      x: record.cell.x,
      y: record.cell.y
    })),
    ...blueprint.spawn.exits.map(record => ({
      label: `exit:${record.side}`,
      x: record.cell.x,
      y: record.cell.y
    }))
  ]);
  let comparableElevationCells = 0;
  let differentElevationCells = 0;
  for (let y = 0; y < left.dimensions.height; y += 1) {
    for (let x = 0; x < left.dimensions.width; x += 1) {
      if (!left.renderMask[y][x] || !right.renderMask[y][x]) continue;
      comparableElevationCells += 1;
      if (left.elevation[y][x] !== right.elevation[y][x]) {
        differentElevationCells += 1;
      }
    }
  }
  return {
    route: jaccardDifference(routeSet(left), routeSet(right)),
    elevation: comparableElevationCells === 0
      ? 0
      : differentElevationCells / comparableElevationCells,
    nonFormationRegions:
      jaccardDifference(regionSet(left), regionSet(right)),
    formationAndExits:
      jaccardDifference(formationSet(left), formationSet(right)),
    ...template07CoarseDiversityRatios(left, right)
  };
}

function assertTemplate07DistinctMacroTopologies(blueprints) {
  for (let left = 0; left < blueprints.length; left += 1) {
    for (let right = left + 1; right < blueprints.length; right += 1) {
      const ratios = template07SiblingDiversityRatios(
        blueprints[left],
        blueprints[right]
      );
      for (const [dimension, minimum] of Object.entries(
        TEMPLATE_07_MINIMUM_DIVERSITY_RATIOS
      )) {
        if (ratios[dimension] >= minimum) continue;
        fail(
          `Template-07 sibling ${dimension} diversity ratio `
            + `${ratios[dimension].toFixed(4)} is below required `
            + `${minimum.toFixed(3)}; fine and coarse silhouette, route, `
            + 'elevation, surface, region, and formation compositions must '
            + 'each be materially distinct',
          'INVALID_TEMPLATE_MAP_BLUEPRINT'
        );
      }
    }
  }
}

function assertTemplate07VisualAuthorship(blueprint) {
  const coverage = new Map(
    TEMPLATE_07_SURFACE_MATERIALS.map(record => [record.symbol, 0])
  );
  for (const cell of blueprint.surfaceGrid.flat().filter(Boolean)) {
    const expectedMaterial =
      TEMPLATE_07_SURFACE_MATERIAL_BY_FEATURE.get(cell.featureId);
    if (expectedMaterial === undefined || cell.material !== expectedMaterial) {
      fail(
        'Template-07 surfaceGrid must use only the fixed semantic '
        + 'material-to-feature pairs',
        'INVALID_TEMPLATE_MAP_BLUEPRINT'
      );
    }
    coverage.set(cell.material, coverage.get(cell.material) + 1);
  }
  for (const [symbol, count] of coverage) {
    if (count === 0) {
      fail(
        `Template-07 surface material ${symbol} must cover at least one rendered cell`,
        'INVALID_TEMPLATE_MAP_BLUEPRINT'
      );
    }
  }
  assertTemplate07OrganicSurfaceGeometry(blueprint);

  const landmarks = blueprint.obstacles.filter(
    obstacle => obstacle.assetFamily === 'fallen-oak-landmark'
  );
  const rootMasses = blueprint.obstacles.filter(
    obstacle => obstacle.assetFamily === 'fallen-oak-root-mass'
  );
  if (landmarks.length !== 1 || rootMasses.length !== 1) {
    fail(
      'Template-07 must contain exactly one fallen-oak-landmark and one '
      + 'fallen-oak-root-mass obstacle',
      'INVALID_TEMPLATE_MAP_BLUEPRINT'
    );
  }
  const landmark = landmarks[0];
  const minX = Math.min(...landmark.cells.map(cell => cell.x));
  const minY = Math.min(...landmark.cells.map(cell => cell.y));
  const maxX = Math.max(...landmark.cells.map(cell => cell.x));
  const maxY = Math.max(...landmark.cells.map(cell => cell.y));
  const normalizedLandmarkCells = landmark.cells
    .map(cell => `${cell.x - minX},${cell.y - minY}`)
    .sort();
  if (
    maxX - minX + 1 !== 8
    || maxY - minY + 1 !== 3
    || stableJson(normalizedLandmarkCells)
      !== stableJson(TEMPLATE_07_LANDMARK_COLLISION_CELLS
        .map(cell => `${cell.x},${cell.y}`)
        .sort())
    || landmark.anchor.x !== minX
    || landmark.anchor.y !== minY
  ) {
    fail(
      'Template-07 fallen-oak-landmark must use the exact ten-cell 8 by 3 '
      + 'diagonal footprint anchored at its northwest cell',
      'INVALID_TEMPLATE_MAP_BLUEPRINT'
    );
  }
  const rootMass = rootMasses[0];
  const expectedComposition =
    TEMPLATE_07_LANDMARK_COMPOSITIONS[variantKey(blueprint.candidateId)];
  if (
    landmark.anchor.x !== expectedComposition.landmarkAnchor.x
    || landmark.anchor.y !== expectedComposition.landmarkAnchor.y
    || rootMass.cells.length !== 1
    || rootMass.cells[0].x !== expectedComposition.root.x
    || rootMass.cells[0].y !== expectedComposition.root.y
  ) {
    fail(
      'Template-07 fallen-oak landmark/root placement must match the fixed '
      + `${variantKey(blueprint.candidateId).toUpperCase()} composition`,
      'INVALID_TEMPLATE_MAP_BLUEPRINT'
    );
  }
  const landmarkMaterials = landmark.cells.map(
    cell => blueprint.surfaceGrid[cell.y][cell.x]?.material
  );
  if (
    landmarkMaterials.filter(material => material === 'dry-ravine').length < 2
    || !landmarkMaterials.some(material => material !== 'dry-ravine')
    || blueprint.surfaceGrid[rootMass.cells[0].y][rootMass.cells[0].x]?.material
      !== 'dry-ravine'
  ) {
    fail(
      'Template-07 fallen-oak composition must cross the dry-ravine seam '
      + 'with at least two landmark cells in the ravine, continue onto a '
      + 'non-ravine bank, and keep the root mass in the ravine',
      'INVALID_TEMPLATE_MAP_BLUEPRINT'
    );
  }
  if (
    rootMass.cells.length !== 1
    || rootMass.anchor.x !== rootMass.cells[0].x
    || rootMass.anchor.y !== rootMass.cells[0].y
    || !landmark.cells.some(cell =>
      Math.abs(cell.x - rootMass.cells[0].x)
        + Math.abs(cell.y - rootMass.cells[0].y) === 1
    )
  ) {
    fail(
      'Template-07 fallen-oak-root-mass must be one anchored cell '
      + 'cardinally adjacent to the landmark',
      'INVALID_TEMPLATE_MAP_BLUEPRINT'
    );
  }
}

async function validateCandidateBytes(
  candidateBytes,
  { mapId, sidecar, starterBytes = null }
) {
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
    if (!Buffer.isBuffer(starterBytes)) {
      fail(
        'V2 candidate validation requires the prepared inputs/starter.json baseline',
        'INVALID_TEMPLATE_MAP_BLUEPRINT'
      );
    }
    assertV2BoundedAuthoring(
      blueprint,
      parseStrictJsonBytes(starterBytes, 'V2 starter blueprint')
    );
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
  if (sidecar.id === TEMPLATE_07_ID) {
    assertTemplate07VisualAuthorship(blueprint);
  }
  for (const obstacle of blueprint.obstacles) {
    if (
      sidecar.id === TEMPLATE_07_ID
      && obstacle.assetFamily === 'fallen-oak-landmark'
    ) continue;
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
  if (changedGeometryGroupCount(blueprint, example) < 2) {
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
  textTemplateFallback,
  starterBytes
}) {
  const workspaceBlueprint = path.join(workspace, 'candidate.json');
  const fileStats = await stat(workspaceBlueprint);
  if (!fileStats.isFile() || fileStats.size < 2 || fileStats.size > MAX_BLUEPRINT_BYTES) {
    fail(`candidate blueprint must be 2..${MAX_BLUEPRINT_BYTES} bytes`);
  }
  const candidateBytes = await readFile(workspaceBlueprint);
  const blueprint = await validateCandidateBytes(candidateBytes, {
    mapId,
    sidecar,
    starterBytes
  });
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

async function readRegularAttemptEvidence(
  filePath,
  label,
  maximumBytes,
  {
    projectRoot = null,
    relativePath = null,
    afterOpen = async () => {}
  } = {}
) {
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
    await afterOpen(Object.freeze({ filePath, relativePath }));
    const bytes = await handle.readFile();
    const [openedAfter, pathAfter, physicalRoot, physicalPath] = await Promise.all([
      handle.stat(),
      lstat(filePath).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      }),
      projectRoot === null ? null : realpath(path.resolve(projectRoot)),
      projectRoot === null ? null : realpath(filePath)
    ]);
    const expectedPhysicalPath = projectRoot === null
      ? null
      : path.join(
          physicalRoot,
          ...(relativePath ?? path.relative(projectRoot, filePath)).split('/')
        );
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
      || (
        projectRoot !== null
        && physicalPath !== expectedPhysicalPath
      )
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
  assertV3BlueprintAuthoringIdentity(options.template);
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
        const { sourceRelativePath, starterBytes } = prepared;
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
              starterBytes: Buffer.from(starterBytes),
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
            textTemplateFallback: options.textTemplateFallback === true,
            starterBytes
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

function escapeSvgText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function mechanicalReviewProjection(blueprint) {
  const byId = records => [...records].sort((left, right) =>
    left.id.localeCompare(right.id)
  );
  return {
    requiredPrimaryRoutes: byId(blueprint.routes
      .filter(route => route.required && route.kind === 'primary'))
      .map(route => ({
        id: route.id,
        kind: route.kind,
        width: route.width,
        cells: route.cells.map(cell => ({ ...cell }))
      })),
    traversableConnections: byId(blueprint.connections
      .filter(connection => connection.traversable))
      .map(connection => ({
        id: connection.id,
        kind: connection.kind,
        from: { ...connection.from },
        to: { ...connection.to },
        bidirectional: connection.bidirectional
      })),
    exits: byId(blueprint.spawn.exits).map(exit => ({
      id: exit.id,
      side: exit.side,
      cell: { ...exit.cell },
      approachRegionId: exit.approachRegionId
    })),
    nonFormationRegions: byId(blueprint.regions
      .filter(region => region.kind !== 'formation-clearing'))
      .map(region => ({
        id: region.id,
        kind: region.kind,
        cells: region.cells.map(cell => ({ ...cell }))
      }))
  };
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
  const projection = mechanicalReviewProjection(blueprint);
  const regionOverlays = projection.nonFormationRegions.flatMap(
    (region, regionIndex) => {
      const hue = (regionIndex * 97 + 45) % 360;
      const overlays = region.cells.map(cell =>
        `<rect x="${cell.x * scale + 1}" y="${cell.y * scale + 1}" `
          + `width="${scale - 2}" height="${scale - 2}" `
          + `fill="hsl(${hue} 85% 55% / .22)" `
          + `stroke="hsl(${hue} 85% 32%)" stroke-width="1.25">`
          + `<title>region ${escapeSvgText(region.id)} ${escapeSvgText(region.kind)}</title></rect>`
      );
      const labelCell = region.cells[0];
      if (labelCell) {
        overlays.push(
          `<text x="${labelCell.x * scale + 2}" y="${labelCell.y * scale + 7}" `
            + `font-family="monospace" font-size="5" fill="#101010">`
            + `${escapeSvgText(region.id)}</text>`
        );
      }
      return overlays;
    }
  );
  const routeColors = ['#00e5ff', '#ffdb4d', '#ff65d4', '#7dff72'];
  const routeOverlays = projection.requiredPrimaryRoutes.flatMap(
    (route, routeIndex) => {
      const color = routeColors[routeIndex % routeColors.length];
      const points = route.cells.map(cell =>
        `${cell.x * scale + scale / 2},${cell.y * scale + scale / 2}`
      ).join(' ');
      const first = route.cells[0];
      return [
        `<polyline points="${points}" fill="none" stroke="${color}" `
          + `stroke-width="3" stroke-linecap="round" stroke-linejoin="round">`
          + `<title>required primary ${escapeSvgText(route.id)}</title></polyline>`,
        `<text x="${first.x * scale + 2}" y="${first.y * scale + 14}" `
          + `font-family="monospace" font-size="6" font-weight="bold" `
          + `fill="${color}" stroke="#111" stroke-width=".25">`
          + `${escapeSvgText(route.id)}</text>`
      ];
    }
  );
  const connectionOverlays = projection.traversableConnections.flatMap(
    connection => {
      const color = connection.kind === 'stairs' ? '#ffffff' : '#73ffb2';
      const fromX = connection.from.x * scale + scale / 2;
      const fromY = connection.from.y * scale + scale / 2;
      const toX = connection.to.x * scale + scale / 2;
      const toY = connection.to.y * scale + scale / 2;
      return [
        `<line x1="${fromX}" y1="${fromY}" x2="${toX}" y2="${toY}" `
          + `stroke="${color}" stroke-width="5" stroke-dasharray="2 1">`
          + `<title>${escapeSvgText(connection.id)} `
          + `${escapeSvgText(connection.kind)}</title></line>`,
        `<text x="${(fromX + toX) / 2 + 2}" y="${(fromY + toY) / 2 - 2}" `
          + `font-family="monospace" font-size="5" fill="${color}">`
          + `${escapeSvgText(connection.kind)}</text>`
      ];
    }
  );
  const exitOverlays = projection.exits.flatMap(exit => {
    const centerX = exit.cell.x * scale + scale / 2;
    const centerY = exit.cell.y * scale + scale / 2;
    const color = exit.side === 'player' ? '#168fff' : '#ff382f';
    return [
      `<polygon points="${centerX},${centerY - 7} ${centerX + 7},${centerY} `
        + `${centerX},${centerY + 7} ${centerX - 7},${centerY}" `
        + `fill="${color}" stroke="#fff" stroke-width="1.5">`
        + `<title>${escapeSvgText(exit.id)} ${escapeSvgText(exit.side)} exit</title></polygon>`,
      `<text x="${centerX + 7}" y="${centerY - 5}" font-family="monospace" `
        + `font-size="5" fill="#fff">${escapeSvgText(exit.id)}</text>`
    ];
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" `
    + `viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">`
    + `<g id="terrain">${cells.join('')}</g>`
    + `<g id="tactical-regions">${regionOverlays.join('')}</g>`
    + `<g id="required-primary-routes">${routeOverlays.join('')}</g>`
    + `<g id="traversable-connections">${connectionOverlays.join('')}</g>`
    + `<g id="formation-exits">${exitOverlays.join('')}</g></svg>`;
}

function mechanicalPreviewArtifacts(candidate, mapId, reviewRoot) {
  const evidenceRoot =
    `${reviewRoot}/previews/${candidate.metadata.blueprint.fullHash.slice(7)}`;
  const svgPath = `${evidenceRoot}/mechanical-preview.svg`;
  const reportPath = `${evidenceRoot}/mechanical-report.json`;
  const latestSvgPath = `${reviewRoot}/mechanical-preview.svg`;
  const latestReportPath = `${reviewRoot}/mechanical-report.json`;
  const svgBytes = Buffer.from(previewSvg(candidate.blueprint));
  const report = {
    schemaVersion: 'battle-map-blueprint-mechanical-preview-v2',
    mapId,
    blueprintFileSha256: candidate.metadata.blueprint.fileSha256,
    blueprintFullHash: candidate.metadata.blueprint.fullHash,
    previewPath: svgPath,
    previewFileSha256: sha256Bytes(svgBytes),
    dimensions: candidate.blueprint.dimensions,
    renderedCells: candidate.blueprint.renderMask.flat().filter(Boolean).length,
    playableCells: candidate.blueprint.playableMask.flat().filter(Boolean).length,
    elevationLevels: [...new Set(
      candidate.blueprint.elevation.flat().filter(Number.isInteger)
    )].sort((left, right) => left - right),
    playerSlots: candidate.blueprint.spawn.playerSlots.length,
    opponentCandidates: candidate.blueprint.spawn.opponentCandidates.length,
    maxAssignableOpponents:
      candidate.blueprint.spawn.capacities.maxAssignableOpponents,
    ...mechanicalReviewProjection(candidate.blueprint),
    assetFamilies: candidate.blueprint.expectedAssetFamilies,
    note: 'Mechanical preview only. Production rendering requires an approved blueprint and exact asset bundle.'
  };
  return {
    svgPath,
    reportPath,
    latestSvgPath,
    latestReportPath,
    svgBytes,
    report
  };
}

async function writeImmutableReviewArtifact(
  projectRoot,
  relativePath,
  bytes
) {
  const absolutePath = resolveWithinProject(
    projectRoot,
    relativePath,
    'hash-addressed mechanical review artifact path'
  );
  try {
    const existing = await readFile(absolutePath);
    if (!existing.equals(bytes)) {
      fail('hash-addressed mechanical review artifact has conflicting bytes');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await atomicWrite(projectRoot, absolutePath, bytes);
  }
}

async function removeLegacyPreviewPngs(projectRoot, reviewRoot) {
  const directory = resolveWithinProject(
    projectRoot,
    reviewRoot,
    'mechanical preview directory'
  );
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name !== 'mechanical-preview.png') continue;
    const pngPath = resolveWithinProject(
      projectRoot,
      `${reviewRoot}/${entry.name}`,
      'legacy mechanical preview PNG path'
    );
    const details = await lstat(pngPath);
    if (details.isSymbolicLink() || !details.isFile()) {
      fail('legacy mechanical preview PNG must be a regular non-symlink file');
    }
    await unlink(pngPath);
  }
}

async function assertMechanicalPreviewReview(
  projectRoot,
  candidate,
  { theme, template, mapId }
) {
  const reviewRoot =
    `ai-image-metadata/battle-maps/review/${theme}/${template}/${mapId}`;
  const expected = mechanicalPreviewArtifacts(candidate, mapId, reviewRoot);
  const reportPath = resolveWithinProject(
    projectRoot,
    expected.reportPath,
    'mechanical review report path'
  );
  const previewPath = resolveWithinProject(
    projectRoot,
    expected.svgPath,
    'mechanical review preview path'
  );
  await Promise.all([
    assertSafeWritePath(projectRoot, reportPath, 'mechanical review report read path'),
    assertSafeWritePath(projectRoot, previewPath, 'mechanical review preview read path')
  ]);
  const [reportBytes, previewBytes] = await Promise.all([
    readRegularAttemptEvidence(
      reportPath,
      'mechanical review report',
      MAX_BLUEPRINT_BYTES,
      { projectRoot, relativePath: expected.reportPath }
    ),
    readRegularAttemptEvidence(
      previewPath,
      'mechanical review preview',
      MAX_BLUEPRINT_BYTES,
      { projectRoot, relativePath: expected.svgPath }
    )
  ]);
  if (reportBytes === null || previewBytes === null) {
    fail(
      'approval requires both the exact mechanical review report and '
      + 'hash-bound preview for the candidate hash'
    );
  }
  const report = parseStrictJsonBytes(reportBytes, 'mechanical review report');
  if (stableJson(report) !== stableJson(expected.report)) {
    fail(
      'approval requires an exact mechanical review report for the candidate hash'
    );
  }
  if (
    !previewBytes.equals(expected.svgBytes)
    || sha256Bytes(previewBytes) !== report.previewFileSha256
  ) {
    fail(
      'approval requires the exact hash-bound mechanical preview artifact'
    );
  }
  return {
    schemaVersion: 'battle-map-blueprint-mechanical-review-v1',
    reportPath: expected.reportPath,
    reportFileSha256: sha256Bytes(reportBytes),
    previewPath: expected.svgPath,
    previewFileSha256: report.previewFileSha256
  };
}

export async function previewBlueprintCandidates(options) {
  assertV3BlueprintAuthoringIdentity(options.template);
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
    const artifacts = mechanicalPreviewArtifacts(candidate, mapId, reviewRoot);
    const reportBytes =
      Buffer.from(`${JSON.stringify(artifacts.report, null, 2)}\n`);
    await writeImmutableReviewArtifact(
      projectRoot,
      artifacts.svgPath,
      artifacts.svgBytes
    );
    await writeImmutableReviewArtifact(
      projectRoot,
      artifacts.reportPath,
      reportBytes
    );
    await atomicWrite(
      projectRoot,
      resolveWithinProject(
        projectRoot,
        artifacts.latestSvgPath,
        'mechanical preview path'
      ),
      artifacts.svgBytes
    );
    await atomicWrite(
      projectRoot,
      resolveWithinProject(
        projectRoot,
        artifacts.latestReportPath,
        'mechanical report path'
      ),
      reportBytes
    );
    await removeLegacyPreviewPngs(projectRoot, reviewRoot);
    results.push({
      mapId,
      svgPath: artifacts.latestSvgPath,
      reportPath: artifacts.latestReportPath,
      report: artifacts.report
    });
  }
  return { ok: true, theme: options.theme, template: options.template, results };
}

async function loadApprovalIndex(
  projectRoot,
  paths,
  theme,
  template,
  {
    allowV2ToV3Migration = false,
    allowV2ReadOnly = false
  } = {}
) {
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
    const migratesV2ToV3 =
      schemas.v3
      && value.schemaVersion === BLUEPRINT_APPROVAL_INDEX_SCHEMA_V2;
    const valueSchemas = migratesV2ToV3
      ? {
          index: BLUEPRINT_APPROVAL_INDEX_SCHEMA_V2,
          record: BLUEPRINT_APPROVAL_RECORD_SCHEMA_V2,
          v2: true,
          v3: false
        }
      : schemas;
    if (
      value.schemaVersion !== valueSchemas.index
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
        ...(valueSchemas.v3 ? ['mechanicalReviewReportSha256'] : []),
        ...(valueSchemas.v2 ? ['reason', 'approvalFullHash'] : [])
      ], label);
      safeId(entry.id, `${label}.id`);
      safeId(entry.reviewer, `${label}.reviewer`);
      sha256(entry.blueprintFullHash, `${label}.blueprintFullHash`);
      sha256(entry.sourceImageSha256, `${label}.sourceImageSha256`);
      sha256(entry.promptProfileSha256, `${label}.promptProfileSha256`);
      if (valueSchemas.v3) {
        sha256(
          entry.mechanicalReviewReportSha256,
          `${label}.mechanicalReviewReportSha256`
        );
      }
      if (valueSchemas.v2) {
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
    if (migratesV2ToV3) {
      if (allowV2ReadOnly) return value;
      if (!allowV2ToV3Migration) {
        fail(
          'blueprint approval index V2-to-V3 migration requires --force; '
            + 'legacy entries lack mechanical review provenance'
        );
      }
      return {
        schemaVersion: schemas.index,
        theme,
        templateId: template,
        entries: [],
        fullHash: null
      };
    }
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
  historicalPromptReferences,
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
    ...(schemas.v3 ? ['mechanicalReview'] : []),
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
  if (schemas.v3) {
    exactKeys(value.mechanicalReview, [
      'schemaVersion',
      'reportPath',
      'reportFileSha256',
      'previewPath',
      'previewFileSha256'
    ], 'blueprint approval record.mechanicalReview');
    sha256(
      value.mechanicalReview.reportFileSha256,
      'blueprint approval record.mechanicalReview.reportFileSha256'
    );
    sha256(
      value.mechanicalReview.previewFileSha256,
      'blueprint approval record.mechanicalReview.previewFileSha256'
    );
    const reviewRoot =
      `ai-image-metadata/battle-maps/review/${theme}/${template}/${mapId}/`
      + `previews/${value.blueprintFullHash.slice(7)}`;
    if (
      value.mechanicalReview.schemaVersion
        !== 'battle-map-blueprint-mechanical-review-v1'
      || value.mechanicalReview.reportPath
        !== `${reviewRoot}/mechanical-report.json`
      || value.mechanicalReview.previewPath
        !== `${reviewRoot}/mechanical-preview.svg`
      || value.mechanicalReview.reportFileSha256
        !== entry.mechanicalReviewReportSha256
    ) {
      fail('blueprint approval mechanical review provenance is invalid');
    }
  }
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
    || !supportedPromptProfileReference(
      value.promptProfile,
      promptReference,
      {
        allowHistorical: true,
        historicalReferences: historicalPromptReferences
      }
    )
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

async function writeImmutableRejectionRecord(
  projectRoot,
  relativePath,
  bytes,
  { write = true } = {}
) {
  const absolutePath = resolveWithinProject(
    projectRoot,
    relativePath,
    'blueprint rejection evidence path'
  );
  try {
    const existing = await readFile(absolutePath);
    if (!existing.equals(bytes)) {
      fail('hash-keyed blueprint rejection evidence has conflicting bytes');
    }
    return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (write) await atomicWrite(projectRoot, absolutePath, bytes);
  }
}

async function writeRejectionEvidence(
  projectRoot,
  { theme, template, mapId, approvalRecord }
) {
  const reviewRoot =
    `ai-image-metadata/battle-maps/review/${theme}/${template}/${mapId}`;
  const latestPath = `${reviewRoot}/rejection.json`;
  const latestAbsolutePath = resolveWithinProject(
    projectRoot,
    latestPath,
    'latest blueprint rejection path'
  );
  const currentRecordPath =
    `${reviewRoot}/rejections/${approvalRecord.blueprintFullHash.slice(7)}.json`;
  const bytes = Buffer.from(`${JSON.stringify(approvalRecord, null, 2)}\n`);
  await writeImmutableRejectionRecord(
    projectRoot,
    currentRecordPath,
    bytes,
    { write: false }
  );
  let existingRecordPath = null;
  let existingBytes = null;
  try {
    existingBytes = await readFile(latestAbsolutePath);
    const existing = parseStrictJsonBytes(
      existingBytes,
      'existing blueprint rejection record'
    );
    sha256(
      existing.blueprintFullHash,
      'existing blueprint rejection record.blueprintFullHash'
    );
    existingRecordPath =
      `${reviewRoot}/rejections/${existing.blueprintFullHash.slice(7)}.json`;
    await writeImmutableRejectionRecord(
      projectRoot,
      existingRecordPath,
      existingBytes,
      { write: false }
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await writeImmutableRejectionRecord(projectRoot, currentRecordPath, bytes);
  if (existingRecordPath !== null) {
    await writeImmutableRejectionRecord(
      projectRoot,
      existingRecordPath,
      existingBytes
    );
  }
  await atomicWrite(projectRoot, latestAbsolutePath, bytes);
}

async function hasExactRejectionEvidence(
  projectRoot,
  { theme, template, mapId, blueprintFullHash }
) {
  const reviewRoot =
    `ai-image-metadata/battle-maps/review/${theme}/${template}/${mapId}`;
  const candidates = [
    `${reviewRoot}/rejections/${blueprintFullHash.slice(7)}.json`,
    `${reviewRoot}/rejection.json`
  ];
  for (let index = 0; index < candidates.length; index += 1) {
    const relativePath = candidates[index];
    const absolutePath = resolveWithinProject(
      projectRoot,
      relativePath,
      'blueprint rejection evidence read path'
    );
    try {
      const record = parseStrictJsonBytes(
        await readFile(absolutePath),
        'blueprint rejection evidence'
      );
      if (index === 0 && record.blueprintFullHash !== blueprintFullHash) {
        fail('hash-keyed blueprint rejection evidence does not match its path');
      }
      if (record.blueprintFullHash === blueprintFullHash) return true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return false;
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
      promptProfile: promptLoaded.profile,
      historicalPromptProfiles: promptLoaded.historicalPromptProfiles,
      historicalPromptReferences: promptLoaded.historicalReferences,
      allowHistoricalPromptProfileForRejection:
        options.decision === 'rejected'
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
  let approvalProjection = {
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
  let approvalRecord = schemas.v2
    ? finalizeApprovalRecord(approvalProjection)
    : approvalProjection;
  if (options.decision === 'rejected') {
    await writeRejectionEvidence(projectRoot, {
      theme: options.theme,
      template: options.template,
      mapId: options.mapId,
      approvalRecord
    });
    const index = await loadApprovalIndex(
      projectRoot,
      paths,
      options.theme,
      options.template,
      { allowV2ReadOnly: true }
    );
    const matchingEntry = index.entries.find(entry =>
      entry.id === options.mapId
      && entry.blueprintFullHash === candidate.metadata.blueprint.fullHash
    );
    let approvalInvalidated = false;
    let sidecarUpdated = false;
    if (matchingEntry) {
      const nextIndex = finalizeApprovalIndex({
        ...index,
        entries: index.entries.filter(entry => entry !== matchingEntry)
      });
      const indexPath = resolveWithinProject(
        projectRoot,
        paths.index,
        'blueprint approval index path'
      );
      const previousIndexBytes =
        Buffer.from(`${JSON.stringify(index, null, 2)}\n`);
      try {
        await atomicWrite(
          projectRoot,
          indexPath,
          Buffer.from(`${JSON.stringify(nextIndex, null, 2)}\n`)
        );
        approvalInvalidated = true;
        if (
          sidecar.pins.approvedBlueprintSha256 !== null
          && sidecar.pins.approvedBlueprintSha256 !== nextIndex.fullHash
        ) {
          if (options.beforeSidecarUpdate) await options.beforeSidecarUpdate();
          await atomicWrite(
            projectRoot,
            sidecarPath,
            Buffer.from(`${JSON.stringify({
              ...sidecar,
              pins: {
                ...sidecar.pins,
                approvedBlueprintSha256: null
              }
            }, null, 2)}\n`)
          );
          sidecarUpdated = true;
        }
      } catch (error) {
        if (approvalInvalidated && !sidecarUpdated) {
          try {
            await atomicWrite(projectRoot, indexPath, previousIndexBytes);
          } catch (rollbackError) {
            rollbackError.cause = error;
            throw rollbackError;
          }
        }
        throw error;
      }
    }
    if (
      !matchingEntry
      && sidecar.pins.approvedBlueprintSha256 !== null
      && sidecar.pins.approvedBlueprintSha256 !== index.fullHash
    ) {
      if (options.beforeSidecarUpdate) await options.beforeSidecarUpdate();
      await atomicWrite(
        projectRoot,
        sidecarPath,
        Buffer.from(`${JSON.stringify({
          ...sidecar,
          pins: {
            ...sidecar.pins,
            approvedBlueprintSha256: null
          }
        }, null, 2)}\n`)
      );
      sidecarUpdated = true;
    }
    return {
      ok: true,
      promoted: false,
      approval: approvalRecord,
      approvalInvalidated,
      sidecarUpdated
    };
  }
  const mechanicalReview = await assertMechanicalPreviewReview(projectRoot, candidate, {
    theme: options.theme,
    template: options.template,
    mapId: options.mapId
  });
  if (schemas.v3) {
    approvalProjection = { ...approvalProjection, mechanicalReview };
  }
  approvalRecord = schemas.v2
    ? finalizeApprovalRecord(approvalProjection)
    : approvalProjection;
  if (await hasExactRejectionEvidence(projectRoot, {
    theme: options.theme,
    template: options.template,
    mapId: options.mapId,
    blueprintFullHash: candidate.metadata.blueprint.fullHash
  })) {
    fail(
      'the exact candidate hash was rejected; regenerate a new candidate before approval'
    );
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
    options.template,
    { allowV2ToV3Migration: options.force === true }
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
    if (await hasExactRejectionEvidence(projectRoot, {
      theme: options.theme,
      template: options.template,
      mapId: entry.id,
      blueprintFullHash: entry.blueprintFullHash
    })) {
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
      ...(schemas.v3
        ? {
            mechanicalReviewReportSha256: mechanicalReview.reportFileSha256
          }
        : {}),
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
  if (sidecar.id === TEMPLATE_07_ID && allApproved) {
    const prospectiveBlueprints = [];
    for (const mapId of sidecar.candidateMaps) {
      if (mapId === options.mapId) {
        prospectiveBlueprints.push(candidate.blueprint);
        continue;
      }
      const siblingPaths = approvedPaths(options.theme, options.template, mapId);
      const siblingPath = resolveWithinProject(
        projectRoot,
        siblingPaths.blueprint,
        'approved sibling blueprint path'
      );
      await assertSafeWritePath(
        projectRoot,
        siblingPath,
        'approved sibling blueprint read path'
      );
      const sibling = parseStrictJsonBytes(
        await readFile(siblingPath),
        `approved sibling blueprint ${mapId}`
      );
      assertTemplateMapBlueprint(sibling);
      assertTemplate07VisualAuthorship(sibling);
      prospectiveBlueprints.push(sibling);
    }
    assertTemplate07DistinctMaterialSignatures(prospectiveBlueprints);
    assertTemplate07DistinctMacroTopologies(prospectiveBlueprints);
  }
  if (options.updatePins && !allApproved) {
    fail('--update-pins requires approved entries for every declared candidate map');
  }
  const aggregatePinInvalidated =
    !options.updatePins
    && sidecar.pins.approvedBlueprintSha256 !== null
    && sidecar.pins.approvedBlueprintSha256 !== nextIndex.fullHash;
  const approvalPath = resolveWithinProject(
    projectRoot,
    paths.approval,
    'blueprint approval path'
  );
  const indexPath = resolveWithinProject(
    projectRoot,
    paths.index,
    'blueprint approval index path'
  );
  const transactionPaths = [
    [destination, 'approved blueprint'],
    [approvalPath, 'blueprint approval record'],
    [indexPath, 'blueprint approval index'],
    [sidecarPath, 'source template sidecar']
  ];
  const transactionSnapshots = await Promise.all(
    transactionPaths.map(([filePath, label]) =>
      snapshotOptionalFile(projectRoot, filePath, label)
    )
  );
  let sidecarUpdated = false;
  try {
    await atomicCopy(projectRoot, candidate.blueprintPath, destination);
    await atomicWrite(
      projectRoot,
      approvalPath,
      Buffer.from(`${JSON.stringify(approvalRecord, null, 2)}\n`)
    );
    await atomicWrite(
      projectRoot,
      indexPath,
      Buffer.from(`${JSON.stringify(nextIndex, null, 2)}\n`)
    );
    if (options.updatePins || aggregatePinInvalidated) {
      const nextSidecar = {
        ...sidecar,
        pins: {
          ...sidecar.pins,
          approvedBlueprintSha256:
            options.updatePins ? nextIndex.fullHash : null
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
  } catch (error) {
    let rollbackFailure = null;
    for (let index = transactionPaths.length - 1; index >= 0; index -= 1) {
      try {
        await restoreOptionalFile(
          projectRoot,
          transactionPaths[index][0],
          transactionSnapshots[index]
        );
      } catch (rollbackError) {
        rollbackFailure ??= rollbackError;
      }
    }
    if (rollbackFailure !== null) {
      rollbackFailure.cause = error;
      throw rollbackFailure;
    }
    throw error;
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
  assertV3BlueprintAuthoringIdentity(options.template);
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
  const schemas = blueprintApprovalSchemas(template);
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
  const template07Blueprints = [];
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
      if (sidecar.id === TEMPLATE_07_ID) {
        assertTemplate07VisualAuthorship(blueprint);
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
      if (await hasExactRejectionEvidence(root, {
        theme,
        template,
        mapId,
        blueprintFullHash: fullHash
      })) {
        fail('approved blueprint hash has exact rejection evidence');
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
      const validatedApproval = validateApprovalRecord(approvalRecord, {
        theme,
        template,
        mapId,
        paths,
        entry,
        promptReference: promptLoaded.reference,
        historicalPromptReferences: promptLoaded.historicalReferences,
        sourceImageSha256: sidecar.sourceImage.sha256,
        blueprintFileSha256
      });
      const reviewRoot =
        `ai-image-metadata/battle-maps/review/${theme}/${template}/${mapId}`;
      const expectedReview = mechanicalPreviewArtifacts(
        {
          blueprint,
          metadata: {
            blueprint: {
              fileSha256: blueprintFileSha256,
              fullHash
            }
          }
        },
        mapId,
        reviewRoot
      );
      const [hasReviewReport, hasReviewPreview] = schemas.v3
        ? [true, true]
        : await Promise.all([
            pathExists(resolveWithinProject(
              root,
              expectedReview.reportPath,
              'mechanical review report path'
            )),
            pathExists(resolveWithinProject(
              root,
              expectedReview.svgPath,
              'mechanical review preview path'
            ))
          ]);
      if (schemas.v3 || hasReviewReport || hasReviewPreview) {
        const actualMechanicalReview = await assertMechanicalPreviewReview(
          root,
          {
            blueprint,
            metadata: {
              blueprint: {
                fileSha256: blueprintFileSha256,
                fullHash
              }
            }
          },
          { theme, template, mapId }
        );
        if (
          schemas.v3
          && stableJson(actualMechanicalReview)
            !== stableJson(validatedApproval.mechanicalReview)
        ) {
          fail('approved blueprint mechanical review record is stale');
        }
      }
      if (sidecar.id === TEMPLATE_07_ID) {
        template07Blueprints.push(blueprint);
      }
      results.push({ mapId, valid: true, fullHash });
    } catch (error) {
      results.push({ mapId, valid: false, error: error.message });
    }
  }
  if (
    sidecar.id === TEMPLATE_07_ID
    && template07Blueprints.length === sidecar.candidateMaps.length
  ) {
    try {
      assertTemplate07DistinctMaterialSignatures(template07Blueprints);
      assertTemplate07DistinctMacroTopologies(template07Blueprints);
    } catch (error) {
      for (const result of results) {
        if (!result.valid) continue;
        result.valid = false;
        result.error = error.message;
      }
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
  assertV3BlueprintAuthoringIdentity,
  passableTraversalComponents,
  validateV2BlueprintSemanticContract,
  assertTemplate07OrganicSurfaceGeometry,
  assertTemplate07DistinctMaterialSignatures,
  TEMPLATE_07_MINIMUM_DIVERSITY_RATIOS,
  template07SiblingDiversityRatios,
  assertTemplate07DistinctMacroTopologies,
  assertTemplate07VisualAuthorship,
  previewSvg,
  mechanicalReviewProjection,
  mechanicalPreviewArtifacts,
  preflightCandidateWithSyntheticCompilerContext,
  readRegularAttemptEvidence,
  approvalReason
});
