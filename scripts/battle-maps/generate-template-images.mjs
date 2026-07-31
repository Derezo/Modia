#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertSafeWritePath,
  inspectImage,
  loadTemplatePrompt,
  loadTemplateSidecar,
  resolveWithinProject
} from './source-template-lifecycle.mjs';
import {
  withPersistentExclusiveLock
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

export const DEFAULT_CONCURRENCY = 2;
export const MAX_CONCURRENCY = 4;
export const DEFAULT_TIMEOUT_MS = 300_000;
export const MAX_TIMEOUT_MS = 1_800_000;
export const MAX_WORKER_OUTPUT_BYTES = 4 * 1024 * 1024;
export const MAX_CANDIDATE_BYTES = 32 * 1024 * 1024;
export const MAX_WORKSPACE_BYTES = 40 * 1024 * 1024;
export const MAX_WORKSPACE_FILES = 2;
export const MAX_IMAGE_DIMENSION = 8192;

const SCRIPT_PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const CANDIDATE_SCHEMA_VERSION = 'battle-map-source-image-candidate-v1';
const ALLOWED_WORKSPACE_FILES = new Set(['candidate.png', 'candidate.webp', 'last-message.txt']);

function readValue(argv, index, flag, inlineValue) {
  if (inlineValue !== undefined) {
    if (!inlineValue) throw new Error(`${flag} requires a value`);
    return { value: inlineValue, consumed: 0 };
  }
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return { value, consumed: 1 };
}

function parsePositiveInteger(value, flag, maximum) {
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`${flag} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new Error(`${flag} must be an integer from 1 to ${maximum}`);
  }
  return parsed;
}

export function parseGenerateArgs(argv = process.argv.slice(2)) {
  const options = {
    variants: [],
    count: null,
    concurrency: DEFAULT_CONCURRENCY,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    dryRun: false,
    force: false,
    resume: false,
    json: false,
    help: false
  };
  const singleValueFlags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const equalsIndex = argument.indexOf('=');
    const flag = equalsIndex === -1 ? argument : argument.slice(0, equalsIndex);
    const inlineValue = equalsIndex === -1 ? undefined : argument.slice(equalsIndex + 1);
    const valueFor = () => {
      const result = readValue(argv, index, flag, inlineValue);
      index += result.consumed;
      return result.value;
    };
    const setOnce = (key, value) => {
      if (singleValueFlags.has(flag)) throw new Error(`${flag} may only be provided once`);
      singleValueFlags.add(flag);
      options[key] = value;
    };

    if (flag === '--theme') setOnce('theme', valueFor());
    else if (flag === '--template') setOnce('template', valueFor());
    else if (flag === '--variant') options.variants.push(valueFor());
    else if (flag === '--count') setOnce('count', parsePositiveInteger(valueFor(), flag, 99));
    else if (flag === '--concurrency') {
      setOnce('concurrency', parsePositiveInteger(valueFor(), flag, MAX_CONCURRENCY));
    } else if (flag === '--timeout') {
      const seconds = parsePositiveInteger(valueFor(), flag, MAX_TIMEOUT_MS / 1000);
      setOnce('timeoutMs', seconds * 1000);
    } else if (flag === '--project-root') setOnce('projectRoot', path.resolve(valueFor()));
    else if (flag === '--dry-run' && inlineValue === undefined) options.dryRun = true;
    else if (flag === '--force' && inlineValue === undefined) options.force = true;
    else if (flag === '--resume' && inlineValue === undefined) options.resume = true;
    else if (flag === '--json' && inlineValue === undefined) options.json = true;
    else if ((flag === '--help' || flag === '-h') && inlineValue === undefined) options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }

  if (options.help) return options;
  if (!options.theme) throw new Error('--theme is required');
  if (!options.template) throw new Error('--template is required');
  for (const [label, value] of [['--theme', options.theme], ['--template', options.template]]) {
    if (!ID_PATTERN.test(value)) throw new Error(`${label} has invalid value "${value}"`);
  }
  if (options.variants.length && options.count !== null) {
    throw new Error('--variant and --count are mutually exclusive');
  }
  if (options.force && options.resume) throw new Error('--force and --resume are mutually exclusive');
  if (options.variants.length === 0 && options.count === null) options.count = 1;
  if (new Set(options.variants).size !== options.variants.length) {
    throw new Error('--variant values must be unique');
  }
  for (const variant of options.variants) {
    if (!ID_PATTERN.test(variant)) throw new Error(`--variant has invalid value "${variant}"`);
  }
  return options;
}

export function selectedVariants(options) {
  if (options.variants.length) return [...options.variants];
  return Array.from(
    { length: options.count },
    (_, index) => `candidate-${String(index + 1).padStart(2, '0')}`
  );
}

function candidatePaths(theme, template, variant) {
  const directory = `ai-image-metadata/battle-maps/candidates/${theme}/${template}/${variant}`;
  return {
    directory,
    imagePng: `${directory}/candidate.png`,
    imageWebp: `${directory}/candidate.webp`,
    metadata: `${directory}/result.json`,
    promptLog: `${directory}/prompt.txt`,
    stdoutLog: `${directory}/worker.jsonl`,
    stderrLog: `${directory}/worker.stderr.log`,
    lastMessage: `${directory}/last-message.txt`
  };
}

function candidateLockPath(root, theme, template, variant) {
  return resolveWithinProject(
    root,
    `ai-image-metadata/battle-maps/candidates/${theme}/${template}`
      + `/.locks/${variant}.lock`,
    'candidate generation lock path'
  );
}

function withCandidateGenerationLock(root, theme, template, variant, callback) {
  const lockPath = candidateLockPath(root, theme, template, variant);
  return withPersistentExclusiveLock({
    lockPath,
    label: `source-image candidate lock ${theme}/${template}/${variant}`,
    assertSafePath: () => (
      assertSafeWritePath(root, lockPath, 'candidate generation lock path')
    )
  }, callback);
}

export function buildGenerationPrompt(context, variant) {
  return `${context.profile.prompt}

Negative constraints:
${context.profile.negativeConstraints.map(constraint => `- ${constraint}`).join('\n')}

This is source-image candidate variant "${variant}" for ${context.theme}/${context.template}.
Use the imagegen skill and call the image generation tool exactly once. Write exactly one
square PNG or WebP candidate to candidate.png or candidate.webp in the current disposable
workspace. Do not create subdirectories, metadata, source pins, approvals, maps, runtime
content, or any other file. The image is compositional reference only and must not be a
literal coordinate trace or tile extraction.`.trim();
}

export function buildCodexArgs(workspace, lastMessagePath) {
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
    '-c',
    'model_reasoning_effort="low"',
    '-o',
    lastMessagePath,
    '-'
  ];
}

export class WorkerTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`Codex worker timed out after ${timeoutMs}ms`);
    this.name = 'WorkerTimeoutError';
  }
}

export function runCommand({
  command,
  args,
  cwd,
  input,
  timeoutMs,
  maxOutputBytes = MAX_WORKER_OUTPUT_BYTES,
  spawnImpl = spawn,
  environmentSource = process.env
}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildCodexWorkerEnvironment(environmentSource)
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timedOut = false;
    let killTimer = null;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      callback(value);
    };
    const terminateForLimit = streamName => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1_000).unref();
      finish(reject, new Error(`${streamName} exceeded ${maxOutputBytes} bytes`));
    };
    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxOutputBytes) terminateForLimit('worker stdout');
      else stdout.push(chunk);
    });
    child.stderr.on('data', chunk => {
      stderrBytes += chunk.length;
      if (stderrBytes > maxOutputBytes) terminateForLimit('worker stderr');
      else stderr.push(chunk);
    });
    child.once('error', error => finish(reject, error));
    child.once('close', (code, signal) => {
      const result = {
        code,
        signal,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr)
      };
      if (timedOut) finish(reject, new WorkerTimeoutError(timeoutMs));
      else if (code !== 0) {
        finish(reject, new Error(
          `Codex worker ${signal ? `terminated by ${signal}` : `exited with code ${code}`}`
        ));
      } else finish(resolve, result);
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 1_000);
    }, timeoutMs);
    child.stdin.once('error', error => {
      if (error.code !== 'EPIPE') finish(reject, error);
    });
    child.stdin.end(`${input}\n`);
  });
}

export async function spawnCodexWorker({ workspace, prompt, timeoutMs }) {
  const lastMessagePath = path.join(workspace, 'last-message.txt');
  const args = buildCodexArgs(workspace, lastMessagePath);
  const result = await runCommand({
    command: 'codex',
    args,
    cwd: workspace,
    input: prompt,
    timeoutMs
  });
  return { ...result, command: 'codex', args };
}

async function snapshotWorkspace(directory) {
  const snapshot = new Map();
  async function visit(current, relative = '') {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
      const absolutePath = path.join(current, entry.name);
      const entryStat = await lstat(absolutePath);
      if (entryStat.isSymbolicLink()) throw new Error(`workspace contains forbidden symlink: ${relativePath}`);
      if (entry.isDirectory()) {
        snapshot.set(relativePath, { type: 'directory', bytes: 0 });
        await visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        snapshot.set(relativePath, { type: 'file', bytes: entryStat.size });
      } else {
        throw new Error(`workspace contains unsupported filesystem entry: ${relativePath}`);
      }
    }
  }
  await visit(directory);
  return snapshot;
}

function auditWorkspace(before, after) {
  if (before.size !== 0) throw new Error('disposable workspace was not empty before the worker started');
  const files = [...after].filter(([, entry]) => entry.type === 'file');
  const directories = [...after].filter(([, entry]) => entry.type === 'directory');
  if (directories.length) {
    throw new Error(`worker created undeclared directory: ${directories[0][0]}`);
  }
  let totalBytes = 0;
  for (const [relativePath, entry] of files) {
    totalBytes += entry.bytes;
    if (!ALLOWED_WORKSPACE_FILES.has(relativePath)) {
      throw new Error(`worker created undeclared output: ${relativePath}`);
    }
  }
  if (files.length > MAX_WORKSPACE_FILES) {
    throw new Error(`worker created ${files.length} files; maximum is ${MAX_WORKSPACE_FILES}`);
  }
  if (totalBytes > MAX_WORKSPACE_BYTES) {
    throw new Error(`worker workspace exceeds ${MAX_WORKSPACE_BYTES} bytes`);
  }
  const candidates = files.filter(([relativePath]) => (
    relativePath === 'candidate.png' || relativePath === 'candidate.webp'
  ));
  if (candidates.length !== 1) {
    throw new Error(`worker must create exactly one PNG or WebP candidate; found ${candidates.length}`);
  }
  return candidates[0][0];
}

async function inspectCandidate(candidatePath) {
  const image = await inspectImage(candidatePath);
  if (image.bytes > MAX_CANDIDATE_BYTES) {
    throw new Error(`candidate exceeds ${MAX_CANDIDATE_BYTES} bytes`);
  }
  if (image.width !== image.height) throw new Error('source-template candidate must be square');
  if (image.width > MAX_IMAGE_DIMENSION || image.height > MAX_IMAGE_DIMENSION) {
    throw new Error(`candidate dimensions exceed ${MAX_IMAGE_DIMENSION}`);
  }
  return image;
}

async function atomicWrite(filePath, contents, projectRoot) {
  await assertSafeWritePath(projectRoot, filePath, 'candidate write path');
  await mkdir(path.dirname(filePath), { recursive: true });
  await assertSafeWritePath(projectRoot, filePath, 'candidate write path');
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, 'wx', 0o600);
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await assertSafeWritePath(projectRoot, filePath, 'candidate write path');
  await rename(temporaryPath, filePath);
}

async function atomicPromote(sourcePath, destinationPath, projectRoot) {
  await assertSafeWritePath(projectRoot, destinationPath, 'candidate image path');
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await assertSafeWritePath(projectRoot, destinationPath, 'candidate image path');
  const temporaryPath = `${destinationPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await copyFile(sourcePath, temporaryPath);
    await assertSafeWritePath(projectRoot, destinationPath, 'candidate image path');
    await rename(temporaryPath, destinationPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

function assertExactKeys(value, keys, location) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${location} must be an object`);
  }
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${location} has unknown key "${key}"`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw new Error(`${location} is missing key "${key}"`);
  }
}

async function readCandidateResult(root, paths, expected) {
  const metadataPath = resolveWithinProject(root, paths.metadata, 'candidate metadata path');
  let contents;
  try {
    contents = await readFile(metadataPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(`candidate metadata is not valid JSON: ${error.message}`);
  }
  assertExactKeys(parsed, [
    'schemaVersion',
    'id',
    'theme',
    'template',
    'status',
    'promptProfile',
    'image',
    'worker',
    'approval'
  ], 'candidate metadata');
  assertExactKeys(parsed.promptProfile, ['id', 'path', 'sha256'], 'candidate promptProfile');
  assertExactKeys(parsed.image, ['path', 'bytes', 'width', 'height', 'format', 'sha256'], 'candidate image');
  assertExactKeys(parsed.worker, [
    'command',
    'args',
    'timeoutMs',
    'promptPath',
    'stdoutPath',
    'stderrPath',
    'lastMessagePath'
  ], 'candidate worker');
  if (
    parsed.schemaVersion !== CANDIDATE_SCHEMA_VERSION
    || parsed.id !== expected.variant
    || parsed.theme !== expected.theme
    || parsed.template !== expected.template
    || parsed.status !== 'candidate-awaiting-review'
    || parsed.approval !== null
  ) {
    throw new Error('candidate metadata has invalid lifecycle state');
  }
  if (
    parsed.promptProfile.id !== expected.promptProfile.id
    || parsed.promptProfile.path !== expected.promptProfile.path
    || parsed.promptProfile.sha256 !== expected.promptProfile.sha256
  ) {
    throw new Error('candidate prompt profile pin mismatch');
  }
  if (
    parsed.worker.command !== 'codex'
    || !Array.isArray(parsed.worker.args)
    || parsed.worker.args.some(argument => typeof argument !== 'string')
    || parsed.worker.args[0] !== 'exec'
    || !parsed.worker.args.includes('--ephemeral')
    || !parsed.worker.args.includes('workspace-write')
    || !Number.isInteger(parsed.worker.timeoutMs)
    || parsed.worker.timeoutMs < 1
    || parsed.worker.promptPath !== paths.promptLog
    || parsed.worker.stdoutPath !== paths.stdoutLog
    || parsed.worker.stderrPath !== paths.stderrLog
    || ![null, paths.lastMessage].includes(parsed.worker.lastMessagePath)
  ) {
    throw new Error('candidate worker provenance is invalid');
  }
  if (![paths.imagePng, paths.imageWebp].includes(parsed.image.path)) {
    throw new Error('candidate image path is not an allowed output');
  }
  const imagePath = resolveWithinProject(root, parsed.image.path, 'candidate image path');
  const actual = await inspectCandidate(imagePath);
  if (
    parsed.image.bytes !== actual.bytes
    || parsed.image.width !== actual.width
    || parsed.image.height !== actual.height
    || parsed.image.format !== actual.format
    || parsed.image.sha256 !== actual.sha256
  ) throw new Error('candidate image pin mismatch; use --force to replace it');
  return parsed;
}

async function removeIncompleteCandidate(root, paths) {
  for (const [key, relativePath] of Object.entries(paths)) {
    if (key === 'directory') continue;
    const absolutePath = resolveWithinProject(root, relativePath, 'candidate cleanup path');
    await assertSafeWritePath(root, absolutePath, 'candidate cleanup path');
    await rm(absolutePath, { force: true, recursive: false });
  }
}

async function inspectCandidateDisposition({
  root,
  context,
  variant,
  paths,
  options
}) {
  let existing;
  try {
    existing = await readCandidateResult(root, paths, {
      variant,
      theme: options.theme,
      template: options.template,
      promptProfile: context.reference
    });
  } catch (error) {
    if (!options.force) throw error;
    existing = null;
  }
  if (existing && options.resume) {
    return {
      result: {
        variant,
        status: 'skipped-complete',
        image: existing.image
      },
      shouldGenerate: false
    };
  }
  if (existing && !options.force) {
    throw new Error(
      `candidate ${variant} already exists; use --resume to skip or --force to replace it`
    );
  }
  if (!existing) {
    const directory = resolveWithinProject(root, paths.directory, 'candidate path');
    try {
      const directoryStat = await lstat(directory);
      if (directoryStat.isSymbolicLink()) {
        throw new Error(`candidate ${variant} path must not be a symbolic link`);
      }
      if (directoryStat.isDirectory() && !options.resume && !options.force) {
        throw new Error(
          `candidate ${variant} is incomplete; use --resume or --force`
        );
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return { result: null, shouldGenerate: true };
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function consume() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => consume())
  );
  return results;
}

async function loadGenerationContext(projectRoot, theme, template) {
  const [sidecarLoaded, promptLoaded] = await Promise.all([
    loadTemplateSidecar({ projectRoot, theme, template }),
    loadTemplatePrompt({ projectRoot, theme, template })
  ]);
  const expectedPrompt = sidecarLoaded.sidecar.promptProfile;
  if (
    expectedPrompt.id !== promptLoaded.reference.id
    || expectedPrompt.path !== promptLoaded.reference.path
    || expectedPrompt.sha256 !== promptLoaded.reference.sha256
    || sidecarLoaded.sidecar.pins.promptProfileSha256 !== promptLoaded.reference.sha256
  ) {
    throw new Error('source-template prompt profile pin mismatch');
  }
  return {
    ...promptLoaded,
    sidecarStatus: sidecarLoaded.sidecar.status
  };
}

async function generateOne({
  root,
  context,
  variant,
  paths,
  options,
  worker
}) {
  const candidateRoot = resolveWithinProject(root, context.candidateDirectory, 'candidate directory');
  await assertSafeWritePath(root, candidateRoot, 'candidate directory');
  await mkdir(candidateRoot, { recursive: true });
  await assertSafeWritePath(root, candidateRoot, 'candidate directory');
  const workspace = await mkdtemp(path.join(candidateRoot, `.workspace-${variant}-`));
  const prompt = buildGenerationPrompt(context, variant);
  try {
    const before = await snapshotWorkspace(workspace);
    const workerResult = await worker({
      workspace,
      prompt,
      timeoutMs: options.timeoutMs,
      variant,
      theme: context.theme,
      template: context.template
    });
    const toolAudit = auditCodexWorkerJsonl(workerResult.stdout);
    if (toolAudit.imagegenInvocationCount !== 1) {
      throw new Error(
        'worker must call imagegen exactly once; '
          + `observed ${toolAudit.imagegenInvocationCount}`
      );
    }
    const after = await snapshotWorkspace(workspace);
    const candidateName = auditWorkspace(before, after);
    const workspaceCandidate = path.join(workspace, candidateName);
    const image = await inspectCandidate(workspaceCandidate);
    const finalImageRelative = image.format === 'png' ? paths.imagePng : paths.imageWebp;
    const finalImagePath = resolveWithinProject(root, finalImageRelative, 'candidate image path');
    await atomicPromote(workspaceCandidate, finalImagePath, root);

    const logValues = [
      [paths.promptLog, `${prompt}\n`],
      [paths.stdoutLog, workerResult.stdout ?? Buffer.alloc(0)],
      [paths.stderrLog, workerResult.stderr ?? Buffer.alloc(0)]
    ];
    const workspaceLastMessage = path.join(workspace, 'last-message.txt');
    try {
      logValues.push([paths.lastMessage, await readFile(workspaceLastMessage)]);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    for (const [relativePath, contents] of logValues) {
      const absolutePath = resolveWithinProject(root, relativePath, 'candidate log path');
      const bytes = Buffer.byteLength(contents);
      if (bytes > MAX_WORKER_OUTPUT_BYTES) {
        throw new Error(`candidate log exceeds ${MAX_WORKER_OUTPUT_BYTES} bytes: ${relativePath}`);
      }
      await atomicWrite(absolutePath, contents, root);
    }

    const result = {
      schemaVersion: CANDIDATE_SCHEMA_VERSION,
      id: variant,
      theme: context.theme,
      template: context.template,
      status: 'candidate-awaiting-review',
      promptProfile: context.reference,
      image: {
        path: finalImageRelative,
        ...image
      },
      worker: {
        command: 'codex',
        args: workerResult.args ?? [],
        timeoutMs: options.timeoutMs,
        promptPath: paths.promptLog,
        stdoutPath: paths.stdoutLog,
        stderrPath: paths.stderrLog,
        lastMessagePath: logValues.some(([entry]) => entry === paths.lastMessage)
          ? paths.lastMessage
          : null
      },
      approval: null
    };
    await atomicWrite(
      resolveWithinProject(root, paths.metadata, 'candidate metadata path'),
      `${JSON.stringify(result, null, 2)}\n`,
      root
    );
    return { variant, status: 'generated', image: result.image };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

export async function generateTemplateImages(options, {
  worker = spawnCodexWorker
} = {}) {
  const root = path.resolve(options.projectRoot ?? SCRIPT_PROJECT_ROOT);
  const context = await loadGenerationContext(root, options.theme, options.template);
  const variants = selectedVariants(options);
  const requestedJobs = variants.map(variant => ({
    variant,
    paths: candidatePaths(options.theme, options.template, variant)
  }));
  const jobs = [];
  const results = [];
  if (options.dryRun) {
    for (const job of requestedJobs) {
      const disposition = await inspectCandidateDisposition({
        root,
        context,
        variant: job.variant,
        paths: job.paths,
        options
      });
      if (disposition.shouldGenerate) jobs.push(job);
      else results.push(disposition.result);
    }
  }
  const plan = {
    ok: true,
    dryRun: options.dryRun,
    theme: options.theme,
    template: options.template,
    promptProfile: context.reference,
    sidecarStatus: context.sidecarStatus,
    concurrency: options.concurrency,
    timeoutMs: options.timeoutMs,
    jobs: jobs.map(job => ({
      variant: job.variant,
      outputDirectory: job.paths.directory,
      status: 'pending'
    })),
    results
  };
  if (options.dryRun) return plan;

  const generated = await runPool(
    requestedJobs,
    options.concurrency,
    job => withCandidateGenerationLock(
      root,
      options.theme,
      options.template,
      job.variant,
      async () => {
        const disposition = await inspectCandidateDisposition({
          root,
          context,
          variant: job.variant,
          paths: job.paths,
          options
        });
        if (!disposition.shouldGenerate) return disposition.result;
        if (options.resume || options.force) {
          await removeIncompleteCandidate(root, job.paths);
        }
        try {
          return await generateOne({
            root,
            context,
            variant: job.variant,
            paths: job.paths,
            options,
            worker
          });
        } catch (error) {
          await removeIncompleteCandidate(root, job.paths);
          throw error;
        }
      }
    )
  );
  return {
    ...plan,
    jobs: generated
      .filter(entry => entry.status === 'generated')
      .map(entry => {
        const requested = requestedJobs.find(job => job.variant === entry.variant);
        return {
          variant: entry.variant,
          outputDirectory: requested.paths.directory,
          status: 'pending'
        };
      }),
    results: generated
  };
}

function usage() {
  return `Generate isolated battle-map source-image candidates through Codex CLI.

Usage:
  node scripts/battle-maps/generate-template-images.mjs --theme <theme> --template <id> [options]

Options:
  --variant <id>       Generate a named variant; repeat for multiple variants
  --count <n>          Generate candidate-01 through candidate-N (default: 1)
  --concurrency <n>    Parallel disposable workers, 1-${MAX_CONCURRENCY} (default: ${DEFAULT_CONCURRENCY})
  --timeout <seconds>  Per-worker timeout, maximum ${MAX_TIMEOUT_MS / 1000} (default: ${DEFAULT_TIMEOUT_MS / 1000})
  --dry-run            Validate frozen inputs and print the plan without writes or Codex
  --resume             Skip complete pinned candidates and finish partial work
  --force              Replace requested local candidates; never stages or approves
  --json               Print a machine-readable result
  --project-root <p>   Override project root for isolated tests
  --help               Show this help

Candidates and complete worker logs are written only below the ignored
ai-image-metadata/battle-maps/candidates/<theme>/<template>/ tree.`;
}

export async function main(argv = process.argv.slice(2), dependencies) {
  const options = parseGenerateArgs(argv);
  if (options.help) {
    console.log(usage());
    return { ok: true, help: true };
  }
  const result = await generateTemplateImages(options, dependencies);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(
      `${result.dryRun ? 'Planned' : 'Completed'} ${result.jobs.length} source-template candidate job(s) for `
      + `${result.theme}/${result.template}; ${result.results.filter(entry => entry.status === 'skipped-complete').length} skipped.`
    );
    console.log('No source was staged or approved.');
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Battle-map source candidate generation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
