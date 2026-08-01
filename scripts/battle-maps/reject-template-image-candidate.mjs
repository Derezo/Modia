#!/usr/bin/env node

import { constants as fsConstants } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readFile
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseJsonRejectDuplicateKeys } from '../../shared/battleMap/canonicalJson.js';
import {
  auditCodexWorkerJsonl,
  verifyCodexImagegenEvidence
} from './codex-worker-boundary.mjs';
import { withPersistentExclusiveLock } from './persistent-exclusive-lock.mjs';
import {
  assertSafeWritePath,
  defaultProjectRoot,
  inspectImage,
  loadTemplatePrompt,
  loadTemplateSidecar,
  resolveWithinProject,
  sha256Bytes
} from './source-template-lifecycle.mjs';

export const REJECTION_SCHEMA_VERSION =
  'battle-map-source-image-candidate-rejection-v1';

const ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const CANDIDATE_SCHEMA_VERSION = 'battle-map-source-image-candidate-v1';
const CANDIDATE_ROOT = 'ai-image-metadata/battle-maps/candidates';
const REJECTION_ROOT = 'battle-maps/source-image-rejections';
const MAX_RESULT_BYTES = 256 * 1024;
const MAX_PROMPT_BYTES = 1024 * 1024;
const MAX_LOG_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 8192;
const MAX_REASON_LENGTH = 2000;
const MAX_WORKER_ARGS = 64;
const MAX_WORKER_ARG_LENGTH = 4096;

function readValue(argv, index, flag, inlineValue) {
  if (inlineValue !== undefined) {
    if (inlineValue === '') throw new Error(`${flag} requires a value`);
    return { value: inlineValue, consumed: 0 };
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return { value, consumed: 1 };
}

function safeId(value, flag) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new Error(`${flag} has invalid value "${value ?? ''}"`);
  }
}

function validateRejectOptions(options) {
  for (const [flag, value] of [
    ['--theme', options.theme],
    ['--template', options.template],
    ['--candidate', options.candidate],
    ['--reviewer', options.reviewer]
  ]) safeId(value, flag);
  if (options.decision !== 'rejected') {
    throw new Error('--decision must be explicitly supplied as "rejected"');
  }
  if (
    typeof options.reason !== 'string'
    || options.reason.length < 1
    || options.reason.length > MAX_REASON_LENGTH
    || options.reason.trim() !== options.reason
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(options.reason)
  ) {
    throw new Error(
      `--reason must be trimmed review text from 1 through ${MAX_REASON_LENGTH} characters`
    );
  }
  return options;
}

export function parseRejectArgs(argv = process.argv.slice(2)) {
  const options = { json: false, help: false };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const equalsIndex = argument.indexOf('=');
    const flag = equalsIndex === -1 ? argument : argument.slice(0, equalsIndex);
    const inlineValue = equalsIndex === -1 ? undefined : argument.slice(equalsIndex + 1);
    const setOnce = key => {
      if (seen.has(flag)) throw new Error(`${flag} may only be provided once`);
      seen.add(flag);
      const result = readValue(argv, index, flag, inlineValue);
      index += result.consumed;
      options[key] = result.value;
    };
    if (flag === '--theme') setOnce('theme');
    else if (flag === '--template') setOnce('template');
    else if (flag === '--candidate') setOnce('candidate');
    else if (flag === '--reviewer') setOnce('reviewer');
    else if (flag === '--decision') setOnce('decision');
    else if (flag === '--reason') setOnce('reason');
    else if (flag === '--project-root') setOnce('projectRoot');
    else if (flag === '--json' && inlineValue === undefined && !options.json) {
      options.json = true;
    } else if ((flag === '--help' || flag === '-h') && inlineValue === undefined) {
      options.help = true;
    } else {
      throw new Error(`Unknown or duplicate argument: ${argument}`);
    }
  }
  if (options.help) return options;
  validateRejectOptions(options);
  if (options.projectRoot !== undefined) {
    options.projectRoot = path.resolve(options.projectRoot);
  }
  return options;
}

function exactObject(value, keys, location) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${location} must be an object`);
  }
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) throw new Error(`${location} has unknown key "${key}"`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw new Error(`${location} is missing key "${key}"`);
  }
}

function candidatePaths(theme, template, candidate) {
  const directory = `${CANDIDATE_ROOT}/${theme}/${template}/${candidate}`;
  return {
    directory,
    result: `${directory}/result.json`,
    imagePng: `${directory}/candidate.png`,
    imageWebp: `${directory}/candidate.webp`,
    prompt: `${directory}/prompt.txt`,
    stdout: `${directory}/worker.jsonl`,
    stderr: `${directory}/worker.stderr.log`,
    lastMessage: `${directory}/last-message.txt`,
    lock: `${CANDIDATE_ROOT}/${theme}/${template}/.locks/${candidate}.lock`,
    rejection: `${REJECTION_ROOT}/${theme}/${template}/${candidate}.json`
  };
}

async function readPinnedFile(projectRoot, relativePath, location, {
  minimumBytes = 0,
  maximumBytes
} = {}) {
  const absolutePath = resolveWithinProject(projectRoot, relativePath, location);
  await assertSafeWritePath(projectRoot, absolutePath, location);
  const details = await lstat(absolutePath);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`${location} must be a regular non-symlink file`);
  }
  if (
    details.size < minimumBytes
    || (maximumBytes !== undefined && details.size > maximumBytes)
  ) {
    throw new Error(
      `${location} must be ${minimumBytes}..${maximumBytes ?? 'unbounded'} bytes`
    );
  }
  const contents = await readFile(absolutePath);
  if (contents.length !== details.size) {
    throw new Error(`${location} changed while it was being read`);
  }
  return {
    absolutePath,
    contents,
    pin: {
      path: relativePath,
      bytes: contents.length,
      sha256: sha256Bytes(contents)
    }
  };
}

function validateCandidateResult(value, expected, paths) {
  exactObject(value, [
    'schemaVersion',
    'id',
    'theme',
    'template',
    'status',
    'promptProfile',
    'image',
    'worker',
    'approval'
  ], 'candidate result');
  exactObject(value.promptProfile, ['id', 'path', 'sha256'], 'candidate promptProfile');
  exactObject(value.image, ['path', 'bytes', 'width', 'height', 'format', 'sha256'], 'candidate image');
  exactObject(value.worker, [
    'command',
    'args',
    'timeoutMs',
    'promptPath',
    'stdoutPath',
    'stderrPath',
    'lastMessagePath'
  ], 'candidate worker');
  if (
    value.schemaVersion !== CANDIDATE_SCHEMA_VERSION
    || value.id !== expected.candidate
    || value.theme !== expected.theme
    || value.template !== expected.template
    || value.status !== 'candidate-awaiting-review'
    || value.approval !== null
  ) {
    throw new Error('candidate result has invalid identity or lifecycle state');
  }
  if (
    value.promptProfile.id !== expected.promptProfile.id
    || value.promptProfile.path !== expected.promptProfile.path
    || value.promptProfile.sha256 !== expected.promptProfile.sha256
    || !SHA256_PATTERN.test(value.promptProfile.sha256)
  ) {
    throw new Error('candidate prompt-profile pin mismatch');
  }
  if (
    ![paths.imagePng, paths.imageWebp].includes(value.image.path)
    || !Number.isSafeInteger(value.image.bytes)
    || value.image.bytes < 1
    || value.image.bytes > MAX_IMAGE_BYTES
    || !Number.isSafeInteger(value.image.width)
    || !Number.isSafeInteger(value.image.height)
    || value.image.width < 1
    || value.image.height < 1
    || value.image.width > MAX_IMAGE_DIMENSION
    || value.image.height > MAX_IMAGE_DIMENSION
    || value.image.width !== value.image.height
    || !['png', 'webp'].includes(value.image.format)
    || path.posix.extname(value.image.path) !== `.${value.image.format}`
    || !SHA256_PATTERN.test(value.image.sha256)
  ) {
    throw new Error('candidate image pin is invalid');
  }
  if (
    value.worker.command !== 'codex'
    || !Array.isArray(value.worker.args)
    || value.worker.args.length !== 16
    || value.worker.args.length > MAX_WORKER_ARGS
    || value.worker.args.some(argument => (
      typeof argument !== 'string'
      || argument.length < 1
      || argument.length > MAX_WORKER_ARG_LENGTH
    ))
    || !Number.isSafeInteger(value.worker.timeoutMs)
    || value.worker.timeoutMs < 1
    || value.worker.promptPath !== paths.prompt
    || value.worker.stdoutPath !== paths.stdout
    || value.worker.stderrPath !== paths.stderr
    || ![null, paths.lastMessage].includes(value.worker.lastMessagePath)
  ) {
    throw new Error('candidate worker provenance is invalid');
  }
  const workspace = value.worker.args[10];
  const lastMessage = value.worker.args[14];
  const expectedWorkspaceParent = resolveWithinProject(
    expected.projectRoot,
    `${CANDIDATE_ROOT}/${expected.theme}/${expected.template}`,
    'candidate worker workspace parent'
  );
  const workspaceNamePattern = new RegExp(
    `^\\.workspace-${expected.candidate}-[A-Za-z0-9]+$`
  );
  if (
    value.worker.args[0] !== 'exec'
    || value.worker.args[1] !== '--ephemeral'
    || value.worker.args[2] !== '--enable'
    || value.worker.args[3] !== 'image_generation'
    || value.worker.args[4] !== '--json'
    || value.worker.args[5] !== '--color'
    || value.worker.args[6] !== 'never'
    || value.worker.args[7] !== '--sandbox'
    || value.worker.args[8] !== 'workspace-write'
    || value.worker.args[9] !== '-C'
    || !path.isAbsolute(workspace)
    || path.dirname(workspace) !== expectedWorkspaceParent
    || !workspaceNamePattern.test(path.basename(workspace))
    || value.worker.args[11] !== '-c'
    || value.worker.args[12] !== 'model_reasoning_effort="low"'
    || value.worker.args[13] !== '-o'
    || lastMessage !== path.join(workspace, 'last-message.txt')
    || value.worker.args[15] !== '-'
  ) {
    throw new Error('candidate worker arguments are not the closed generation invocation');
  }
}

function sameImagePin(actual, expected) {
  return (
    actual.bytes === expected.bytes
    && actual.width === expected.width
    && actual.height === expected.height
    && actual.format === expected.format
    && actual.sha256 === expected.sha256
  );
}

async function collectEvidence(projectRoot, options, paths) {
  const [sidecarLoaded, promptLoaded] = await Promise.all([
    loadTemplateSidecar({
      projectRoot,
      theme: options.theme,
      template: options.template
    }),
    loadTemplatePrompt({
      projectRoot,
      theme: options.theme,
      template: options.template
    })
  ]);
  const sidecarPrompt = sidecarLoaded.sidecar.promptProfile;
  if (
    sidecarPrompt.id !== promptLoaded.reference.id
    || sidecarPrompt.path !== promptLoaded.reference.path
    || sidecarPrompt.sha256 !== promptLoaded.reference.sha256
    || sidecarLoaded.sidecar.pins.promptProfileSha256 !== promptLoaded.reference.sha256
  ) {
    throw new Error('tracked source-template prompt-profile pin mismatch');
  }

  const resultFile = await readPinnedFile(
    projectRoot,
    paths.result,
    'candidate result',
    { minimumBytes: 2, maximumBytes: MAX_RESULT_BYTES }
  );
  let result;
  try {
    result = parseJsonRejectDuplicateKeys(resultFile.contents.toString('utf8'));
  } catch (error) {
    throw new Error(`candidate result is not strict JSON: ${error.message}`);
  }
  validateCandidateResult(result, {
    projectRoot,
    theme: options.theme,
    template: options.template,
    candidate: options.candidate,
    promptProfile: promptLoaded.reference
  }, paths);

  const [imageFile, promptFile, stdoutFile, stderrFile, lastMessageFile] =
    await Promise.all([
      readPinnedFile(projectRoot, result.image.path, 'candidate image', {
        minimumBytes: 1,
        maximumBytes: MAX_IMAGE_BYTES
      }),
      readPinnedFile(projectRoot, paths.prompt, 'candidate prompt', {
        minimumBytes: 1,
        maximumBytes: MAX_PROMPT_BYTES
      }),
      readPinnedFile(projectRoot, paths.stdout, 'candidate worker stdout', {
        minimumBytes: 1,
        maximumBytes: MAX_LOG_BYTES
      }),
      readPinnedFile(projectRoot, paths.stderr, 'candidate worker stderr', {
        minimumBytes: 0,
        maximumBytes: MAX_LOG_BYTES
      }),
      result.worker.lastMessagePath === null
        ? Promise.resolve(null)
        : readPinnedFile(projectRoot, paths.lastMessage, 'candidate worker last message', {
          minimumBytes: 0,
          maximumBytes: MAX_LOG_BYTES
        })
    ]);
  const actualImage = await inspectImage(imageFile.absolutePath);
  if (!sameImagePin(actualImage, result.image)) {
    throw new Error('candidate image no longer matches its result pin');
  }
  if (
    imageFile.pin.bytes !== result.image.bytes
    || imageFile.pin.sha256 !== result.image.sha256
  ) {
    throw new Error('candidate image changed while it was being inspected');
  }
  const toolAudit = auditCodexWorkerJsonl(stdoutFile.contents);
  if (toolAudit.imagegenInvocationCount !== 1) {
    throw new Error(
      'candidate worker log must prove exactly one imagegen invocation; '
      + `observed ${toolAudit.imagegenInvocationCount}`
    );
  }
  await verifyCodexImagegenEvidence(toolAudit, {
    candidatePath: imageFile.absolutePath,
    requireCandidateByteIdentity: true
  });
  return {
    schemaVersion: REJECTION_SCHEMA_VERSION,
    theme: options.theme,
    template: options.template,
    candidate: options.candidate,
    decision: 'rejected',
    reviewer: options.reviewer,
    reason: options.reason,
    evidence: {
      result: resultFile.pin,
      image: {
        path: result.image.path,
        bytes: actualImage.bytes,
        width: actualImage.width,
        height: actualImage.height,
        format: actualImage.format,
        sha256: actualImage.sha256
      },
      promptProfile: result.promptProfile,
      prompt: promptFile.pin,
      workerLogs: {
        stdout: stdoutFile.pin,
        stderr: stderrFile.pin,
        lastMessage: lastMessageFile?.pin ?? null
      },
      imagegenInvocationCount: 1
    }
  };
}

async function assertEvidenceStillMatches(projectRoot, record) {
  const pins = [
    record.evidence.result,
    record.evidence.prompt,
    record.evidence.workerLogs.stdout,
    record.evidence.workerLogs.stderr,
    record.evidence.workerLogs.lastMessage
  ].filter(Boolean);
  for (const expected of pins) {
    const actual = await readPinnedFile(
      projectRoot,
      expected.path,
      `candidate evidence ${expected.path}`,
      { minimumBytes: 0, maximumBytes: Math.max(expected.bytes, 1) }
    );
    if (actual.pin.bytes !== expected.bytes || actual.pin.sha256 !== expected.sha256) {
      throw new Error(`candidate evidence drifted during review: ${expected.path}`);
    }
  }
  const image = await readPinnedFile(
    projectRoot,
    record.evidence.image.path,
    'candidate image evidence',
    { minimumBytes: 1, maximumBytes: record.evidence.image.bytes }
  );
  if (
    image.pin.bytes !== record.evidence.image.bytes
    || image.pin.sha256 !== record.evidence.image.sha256
  ) {
    throw new Error('candidate image drifted during review');
  }
}

async function writeImmutableRecord(projectRoot, relativePath, contents) {
  const destination = resolveWithinProject(projectRoot, relativePath, 'rejection record path');
  await assertSafeWritePath(projectRoot, destination, 'rejection record path');
  await mkdir(path.dirname(destination), { recursive: true });
  await assertSafeWritePath(projectRoot, destination, 'rejection record path');
  try {
    const handle = await open(
      destination,
      fsConstants.O_WRONLY
        | fsConstants.O_CREAT
        | fsConstants.O_EXCL
        | (fsConstants.O_NOFOLLOW ?? 0),
      0o600
    );
    try {
      await handle.writeFile(contents);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  await assertSafeWritePath(projectRoot, destination, 'existing rejection record path');
  const details = await lstat(destination);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error('existing rejection record must be a regular non-symlink file');
  }
  const existing = await readFile(destination);
  if (!existing.equals(contents)) {
    throw new Error(
      `immutable rejection record already exists with different evidence or review: ${relativePath}`
    );
  }
  return false;
}

export async function rejectTemplateImageCandidate(options) {
  validateRejectOptions(options);
  const projectRoot = path.resolve(options.projectRoot ?? defaultProjectRoot());
  const paths = candidatePaths(options.theme, options.template, options.candidate);
  const lockPath = resolveWithinProject(projectRoot, paths.lock, 'candidate lock path');
  return withPersistentExclusiveLock({
    lockPath,
    label:
      `source-image candidate lock ${options.theme}/${options.template}/${options.candidate}`,
    assertSafePath: target => assertSafeWritePath(
      projectRoot,
      target,
      'candidate lock path'
    )
  }, async () => {
    const record = await collectEvidence(projectRoot, options, paths);
    await assertEvidenceStillMatches(projectRoot, record);
    const contents = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
    const changed = await writeImmutableRecord(
      projectRoot,
      paths.rejection,
      contents
    );
    return {
      ok: true,
      changed,
      promoted: false,
      activated: false,
      path: paths.rejection,
      record
    };
  });
}

function usage() {
  return `Reject one exact generated Battle Map V3 source-image candidate.

Usage:
  node scripts/battle-maps/reject-template-image-candidate.mjs \\
    --theme <id> --template <id> --candidate <id> --reviewer <id> \\
    --decision rejected --reason <review-rationale> [--json]

The command verifies and hash-pins the ignored candidate result, image, prompt,
and complete worker logs. It only creates an immutable tracked rejection record;
it never generates, stages, approves, promotes, or activates content.`;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseRejectArgs(argv);
  if (options.help) {
    console.log(usage());
    return { ok: true, help: true };
  }
  const result = await rejectTemplateImageCandidate(options);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(
      `${result.changed ? 'Wrote' : 'Verified existing'} immutable source-image rejection: `
      + result.path
    );
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Battle-map source-image rejection failed: ${error.message}`);
    process.exitCode = 1;
  });
}
