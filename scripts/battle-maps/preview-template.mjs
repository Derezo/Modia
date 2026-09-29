#!/usr/bin/env node

import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  unlink
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseJsonRejectDuplicateKeys } from '../../shared/battleMap/canonicalJson.js';
import {
  assertSafeWritePath,
  defaultProjectRoot,
  inspectImage,
  loadTemplateSidecar,
  resolveWithinProject,
  sha256Bytes,
  validateProjectRelativePath
} from './source-template-lifecycle.mjs';

const ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const REVIEW_ROOT = 'ai-image-metadata/battle-maps/review';
const CANDIDATE_ROOT = 'ai-image-metadata/battle-maps/candidates';
const REJECTION_ROOT = 'battle-maps/source-image-rejections';
const CANDIDATE_SCHEMA_VERSION = 'battle-map-source-image-candidate-v1';
const REJECTION_SCHEMA_VERSION = 'battle-map-source-image-candidate-rejection-v1';
const MAX_CANDIDATE_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 8192;
const MAX_RESULT_BYTES = 256 * 1024;
const MAX_REJECTION_BYTES = 256 * 1024;
const MAX_REASON_LENGTH = 2000;

function validateReviewOutput(output) {
  validateProjectRelativePath(output, '--output', { extension: '.html' });
  if (!output.startsWith(`${REVIEW_ROOT}/`)) {
    throw new Error(`--output must be below ${REVIEW_ROOT}/`);
  }
  return output;
}

function readValue(argv, index, flag, inlineValue) {
  if (inlineValue !== undefined) {
    if (inlineValue === '') throw new Error(`${flag} requires a value`);
    return { value: inlineValue, consumed: 0 };
  }
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return { value, consumed: 1 };
}

export function parsePreviewArgs(argv = process.argv.slice(2)) {
  const options = { json: false };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const equalsIndex = argument.indexOf('=');
    const flag = equalsIndex === -1 ? argument : argument.slice(0, equalsIndex);
    const inlineValue = equalsIndex === -1 ? undefined : argument.slice(equalsIndex + 1);
    const setValue = key => {
      if (seen.has(flag)) throw new Error(`${flag} may only be provided once`);
      seen.add(flag);
      const read = readValue(argv, index, flag, inlineValue);
      index += read.consumed;
      options[key] = read.value;
    };

    if (flag === '--theme') setValue('theme');
    else if (flag === '--template') setValue('template');
    else if (flag === '--output') setValue('output');
    else if (flag === '--project-root') setValue('projectRoot');
    else if (flag === '--json' && inlineValue === undefined) {
      if (options.json) throw new Error('--json may only be provided once');
      options.json = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!options.theme) throw new Error('--theme is required');
  if (!options.template) throw new Error('--template is required');
  for (const [flag, value] of [['--theme', options.theme], ['--template', options.template]]) {
    if (!ID_PATTERN.test(value)) throw new Error(`${flag} has invalid value "${value}"`);
  }
  if (options.projectRoot !== undefined) options.projectRoot = path.resolve(options.projectRoot);
  if (options.output === undefined) {
    options.output =
      `${REVIEW_ROOT}/${options.theme}/${options.template}/source-template-preview.html`;
  }
  validateReviewOutput(options.output);
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

function requireString(value, location) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${location} must be a non-empty string`);
  }
}

function requirePositiveInteger(value, location) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${location} must be a positive integer`);
  }
}

async function assertRegularUnlinkedFile(projectRoot, relativePath, location) {
  const absolute = resolveWithinProject(projectRoot, relativePath, location);
  await assertSafeWritePath(projectRoot, absolute, location);
  const details = await lstat(absolute);
  if (!details.isFile()) throw new Error(`${location} must be a regular file`);
  return { absolute, details };
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

function samePromptProfile(actual, expected) {
  return (
    actual.id === expected.id
    && actual.path === expected.path
    && actual.sha256 === expected.sha256
  );
}

function validateFilePin(value, expectedPath, location, minimumBytes = 0) {
  exactObject(value, ['path', 'bytes', 'sha256'], location);
  if (
    value.path !== expectedPath
    || !Number.isSafeInteger(value.bytes)
    || value.bytes < minimumBytes
    || !SHA256_PATTERN.test(value.sha256)
  ) {
    throw new Error(`${location} pin is invalid`);
  }
}

function validateRejectionRecord(value, expected) {
  const directory = `${CANDIDATE_ROOT}/${expected.theme}/${expected.template}/${expected.variant}`;
  exactObject(value, [
    'schemaVersion',
    'theme',
    'template',
    'candidate',
    'decision',
    'reviewer',
    'reason',
    'evidence'
  ], `candidate ${expected.variant} rejection`);
  exactObject(value.evidence, [
    'result',
    'image',
    'promptProfile',
    'prompt',
    'workerLogs',
    'imagegenInvocationCount'
  ], `candidate ${expected.variant} rejection evidence`);
  exactObject(
    value.evidence.image,
    ['path', 'bytes', 'width', 'height', 'format', 'sha256'],
    `candidate ${expected.variant} rejection image`
  );
  exactObject(
    value.evidence.promptProfile,
    ['id', 'path', 'sha256'],
    `candidate ${expected.variant} rejection promptProfile`
  );
  exactObject(
    value.evidence.workerLogs,
    ['stdout', 'stderr', 'lastMessage'],
    `candidate ${expected.variant} rejection workerLogs`
  );
  if (
    value.schemaVersion !== REJECTION_SCHEMA_VERSION
    || value.theme !== expected.theme
    || value.template !== expected.template
    || value.candidate !== expected.variant
    || value.decision !== 'rejected'
  ) {
    throw new Error(`candidate ${expected.variant} rejection identity is invalid`);
  }
  if (typeof value.reviewer !== 'string' || !ID_PATTERN.test(value.reviewer)) {
    throw new Error(`candidate ${expected.variant} rejection reviewer is invalid`);
  }
  if (
    typeof value.reason !== 'string'
    || value.reason.length < 1
    || value.reason.length > MAX_REASON_LENGTH
    || value.reason.trim() !== value.reason
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.reason)
  ) {
    throw new Error(`candidate ${expected.variant} rejection reason is invalid`);
  }
  validateFilePin(
    value.evidence.result,
    `${directory}/result.json`,
    `candidate ${expected.variant} rejection result`,
    2
  );
  validateFilePin(
    value.evidence.prompt,
    `${directory}/prompt.txt`,
    `candidate ${expected.variant} rejection prompt`,
    1
  );
  validateFilePin(
    value.evidence.workerLogs.stdout,
    `${directory}/worker.jsonl`,
    `candidate ${expected.variant} rejection stdout`,
    1
  );
  validateFilePin(
    value.evidence.workerLogs.stderr,
    `${directory}/worker.stderr.log`,
    `candidate ${expected.variant} rejection stderr`
  );
  if (value.evidence.workerLogs.lastMessage !== null) {
    validateFilePin(
      value.evidence.workerLogs.lastMessage,
      `${directory}/last-message.txt`,
      `candidate ${expected.variant} rejection lastMessage`
    );
  }
  const image = value.evidence.image;
  if (
    ![`${directory}/candidate.png`, `${directory}/candidate.webp`].includes(image.path)
    || !Number.isSafeInteger(image.bytes)
    || image.bytes < 1
    || image.bytes > MAX_CANDIDATE_BYTES
    || !Number.isSafeInteger(image.width)
    || !Number.isSafeInteger(image.height)
    || image.width < 1
    || image.height < 1
    || image.width > MAX_IMAGE_DIMENSION
    || image.height > MAX_IMAGE_DIMENSION
    || image.width !== image.height
    || !['png', 'webp'].includes(image.format)
    || path.posix.extname(image.path) !== `.${image.format}`
    || !SHA256_PATTERN.test(image.sha256)
  ) {
    throw new Error(`candidate ${expected.variant} rejection image pin is invalid`);
  }
  const promptProfile = value.evidence.promptProfile;
  if (
    !ID_PATTERN.test(promptProfile.id)
    || typeof promptProfile.path !== 'string'
    || !promptProfile.path.startsWith('ai-image-metadata/battle-maps/prompts/')
    || path.posix.extname(promptProfile.path) !== '.json'
    || !SHA256_PATTERN.test(promptProfile.sha256)
  ) {
    throw new Error(`candidate ${expected.variant} rejection prompt-profile pin is invalid`);
  }
  validateProjectRelativePath(
    promptProfile.path,
    `candidate ${expected.variant} rejection promptProfile.path`,
    { extension: '.json' }
  );
  if (value.evidence.imagegenInvocationCount !== 1) {
    throw new Error(`candidate ${expected.variant} rejection imagegen count is invalid`);
  }
}

async function loadRejections(projectRoot, sidecar) {
  const relativeRoot = `${REJECTION_ROOT}/${sidecar.theme}/${sidecar.id}`;
  const absoluteRoot = resolveWithinProject(projectRoot, relativeRoot, 'rejection directory');
  try {
    await assertSafeWritePath(projectRoot, absoluteRoot, 'rejection directory');
    const details = await lstat(absoluteRoot);
    if (!details.isDirectory()) throw new Error('rejection directory must be a directory');
  } catch (error) {
    if (error.code === 'ENOENT') return new Map();
    throw error;
  }
  const entries = await readdir(absoluteRoot, { withFileTypes: true });
  const rejections = new Map();
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const variant = path.posix.basename(entry.name, '.json');
    if (!entry.isFile() || entry.name !== `${variant}.json` || !ID_PATTERN.test(variant)) {
      throw new Error(`rejection directory has invalid entry "${entry.name}"`);
    }
    const relativePath = `${relativeRoot}/${entry.name}`;
    const { absolute, details } = await assertRegularUnlinkedFile(
      projectRoot,
      relativePath,
      `candidate ${variant} rejection`
    );
    if (details.size < 1 || details.size > MAX_REJECTION_BYTES) {
      throw new Error(
        `candidate ${variant} rejection must be 1..${MAX_REJECTION_BYTES} bytes`
      );
    }
    let value;
    try {
      value = parseJsonRejectDuplicateKeys(await readFile(absolute, 'utf8'));
    } catch (error) {
      throw new Error(`candidate ${variant} rejection is not strict JSON: ${error.message}`);
    }
    validateRejectionRecord(value, {
      theme: sidecar.theme,
      template: sidecar.id,
      variant
    });
    rejections.set(variant, value);
  }
  return rejections;
}

async function embeddedVerifiedImage(absolute, image, location) {
  const bytes = await readFile(absolute);
  if (bytes.length !== image.bytes || sha256Bytes(bytes) !== image.sha256) {
    throw new Error(`${location} changed while the preview was being created`);
  }
  return `data:image/${image.format};base64,${bytes.toString('base64')}`;
}

async function verifySourceImage(projectRoot, sidecar) {
  if (sidecar.sourceImage === null) return null;
  const { absolute } = await assertRegularUnlinkedFile(
    projectRoot,
    sidecar.sourceImage.path,
    'sourceImage.path'
  );
  const actual = await inspectImage(absolute);
  if (
    !sameImagePin(actual, sidecar.sourceImage)
    || sidecar.pins.sourceImageSha256 !== actual.sha256
  ) {
    throw new Error('source image pin mismatch');
  }
  return {
    ...sidecar.sourceImage,
    verified: true,
    embeddedSrc: await embeddedVerifiedImage(absolute, actual, 'source image')
  };
}

function validateCandidateResult(value, expected) {
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
  ], 'candidate metadata');
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
    || value.id !== expected.variant
    || value.theme !== expected.theme
    || value.template !== expected.template
    || value.status !== 'candidate-awaiting-review'
    || value.approval !== null
  ) {
    throw new Error(`candidate ${expected.variant} metadata has invalid lifecycle state`);
  }
  if (
    value.promptProfile.id !== expected.promptProfile.id
    || value.promptProfile.path !== expected.promptProfile.path
    || value.promptProfile.sha256 !== expected.promptProfile.sha256
  ) {
    throw new Error(`candidate ${expected.variant} prompt profile pin mismatch`);
  }
  const expectedDirectory =
    `${CANDIDATE_ROOT}/${expected.theme}/${expected.template}/${expected.variant}`;
  if (
    value.image.path !== `${expectedDirectory}/candidate.png`
    && value.image.path !== `${expectedDirectory}/candidate.webp`
  ) {
    throw new Error(`candidate ${expected.variant} image path is not an allowed output`);
  }
  requirePositiveInteger(value.image.bytes, 'candidate image.bytes');
  requirePositiveInteger(value.image.width, 'candidate image.width');
  requirePositiveInteger(value.image.height, 'candidate image.height');
  if (!['png', 'webp'].includes(value.image.format)) {
    throw new Error('candidate image.format must be png or webp');
  }
  if (!SHA256_PATTERN.test(value.image.sha256)) {
    throw new Error('candidate image.sha256 is invalid');
  }
  if (path.posix.extname(value.image.path) !== `.${value.image.format}`) {
    throw new Error('candidate image extension does not match its format');
  }
  requireString(value.worker.command, 'candidate worker.command');
  if (value.worker.command !== 'codex') throw new Error('candidate worker command is invalid');
  if (!Array.isArray(value.worker.args) || value.worker.args.some(argument => typeof argument !== 'string')) {
    throw new Error('candidate worker.args must be an array of strings');
  }
  const imageGenerationEnabled = value.worker.args.some(
    (argument, index) =>
      argument === '--enable'
      && value.worker.args[index + 1] === 'image_generation'
  );
  const imageGenerationDisabled = value.worker.args.some(
    (argument, index) =>
      argument === '--disable'
      && value.worker.args[index + 1] === 'image_generation'
  );
  if (
    value.worker.args[0] !== 'exec'
    || !value.worker.args.includes('--ephemeral')
    || !value.worker.args.includes('workspace-write')
    || !imageGenerationEnabled
    || imageGenerationDisabled
  ) {
    throw new Error('candidate worker provenance is invalid');
  }
  requirePositiveInteger(value.worker.timeoutMs, 'candidate worker.timeoutMs');
  const expectedLogs = {
    promptPath: `${expectedDirectory}/prompt.txt`,
    stdoutPath: `${expectedDirectory}/worker.jsonl`,
    stderrPath: `${expectedDirectory}/worker.stderr.log`,
    lastMessagePath: `${expectedDirectory}/last-message.txt`
  };
  for (const key of ['promptPath', 'stdoutPath', 'stderrPath']) {
    if (value.worker[key] !== expectedLogs[key]) {
      throw new Error(`candidate worker.${key} is invalid`);
    }
  }
  if (![null, expectedLogs.lastMessagePath].includes(value.worker.lastMessagePath)) {
    throw new Error('candidate worker.lastMessagePath is invalid');
  }
}

async function readCandidate(projectRoot, sidecar, variant, rejection) {
  const directory = `${CANDIDATE_ROOT}/${sidecar.theme}/${sidecar.id}/${variant}`;
  const metadataPath = `${directory}/result.json`;
  const { absolute, details } = await assertRegularUnlinkedFile(
    projectRoot,
    metadataPath,
    `candidate ${variant} result`
  );
  if (details.size < 1 || details.size > MAX_RESULT_BYTES) {
    throw new Error(`candidate ${variant} result must be 1..${MAX_RESULT_BYTES} bytes`);
  }
  let value;
  let resultBytes;
  try {
    resultBytes = await readFile(absolute);
    value = JSON.parse(resultBytes.toString('utf8'));
  } catch (error) {
    throw new Error(`candidate ${variant} result is not valid JSON: ${error.message}`);
  }
  if (
    rejection !== undefined
    && (
      rejection.evidence.result.bytes !== resultBytes.length
      || rejection.evidence.result.sha256 !== sha256Bytes(resultBytes)
    )
  ) {
    throw new Error(`candidate ${variant} result does not match rejection pin`);
  }
  validateCandidateResult(value, {
    variant,
    theme: sidecar.theme,
    template: sidecar.id,
    promptProfile: rejection?.evidence.promptProfile ?? sidecar.promptProfile
  });
  if (
    rejection !== undefined
    && (
      !sameImagePin(value.image, rejection.evidence.image)
      || !samePromptProfile(value.promptProfile, rejection.evidence.promptProfile)
    )
  ) {
    throw new Error(`candidate ${variant} metadata does not match rejection evidence`);
  }
  const { absolute: imagePath } = await assertRegularUnlinkedFile(
    projectRoot,
    value.image.path,
    `candidate ${variant} image`
  );
  const actual = await inspectImage(imagePath);
  if (
    actual.bytes > MAX_CANDIDATE_BYTES
    || actual.width !== actual.height
    || actual.width > MAX_IMAGE_DIMENSION
    || actual.height > MAX_IMAGE_DIMENSION
  ) {
    throw new Error(`candidate ${variant} image violates generation bounds`);
  }
  if (!sameImagePin(actual, value.image)) {
    throw new Error(`candidate ${variant} image pin mismatch`);
  }
  const selected = sidecar.sourceImage !== null && sameImagePin(actual, sidecar.sourceImage);
  return {
    id: variant,
    status: rejection === undefined ? value.status : 'rejected',
    reviewStatus: rejection !== undefined
      ? 'rejected'
      : selected
      ? (sidecar.status === 'approved' ? 'selected-and-approved' : 'selected-and-staged')
      : 'awaiting-review',
    selected,
    rejection: rejection === undefined
      ? null
      : { reviewer: rejection.reviewer, reason: rejection.reason },
    promptProfile: value.promptProfile,
    image: {
      ...value.image,
      verified: true,
      embeddedSrc: await embeddedVerifiedImage(
        imagePath,
        actual,
        `candidate ${variant} image`
      )
    }
  };
}

function rejectionHistoryCandidate(rejection) {
  return {
    id: rejection.candidate,
    status: 'rejected',
    reviewStatus: 'rejected',
    selected: false,
    rejection: { reviewer: rejection.reviewer, reason: rejection.reason },
    promptProfile: rejection.evidence.promptProfile,
    image: {
      ...rejection.evidence.image,
      verified: false
    }
  };
}

async function loadCandidates(projectRoot, sidecar, rejections) {
  const relativeRoot = `${CANDIDATE_ROOT}/${sidecar.theme}/${sidecar.id}`;
  const absoluteRoot = resolveWithinProject(projectRoot, relativeRoot, 'candidate directory');
  try {
    await assertSafeWritePath(projectRoot, absoluteRoot, 'candidate directory');
    const rootDetails = await lstat(absoluteRoot);
    if (!rootDetails.isDirectory()) throw new Error('candidate directory must be a directory');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [...rejections.values()].map(rejectionHistoryCandidate);
    }
    throw error;
  }
  const entries = await readdir(absoluteRoot, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === 'blueprints' || entry.name.startsWith('.workspace-')) continue;
    if (entry.name === '.locks') {
      const lockDirectory = resolveWithinProject(
        projectRoot,
        `${relativeRoot}/.locks`,
        'candidate lock directory'
      );
      await assertSafeWritePath(
        projectRoot,
        lockDirectory,
        'candidate lock directory'
      );
      if (!entry.isDirectory()) {
        throw new Error('candidate lock directory must be a directory');
      }
      continue;
    }
    if (!ID_PATTERN.test(entry.name)) throw new Error(`candidate directory has invalid entry "${entry.name}"`);
    const entryRelative = `${relativeRoot}/${entry.name}`;
    const entryPath = resolveWithinProject(projectRoot, entryRelative, 'candidate variant directory');
    await assertSafeWritePath(projectRoot, entryPath, 'candidate variant directory');
    if (!entry.isDirectory()) throw new Error(`candidate ${entry.name} path must be a directory`);
    const resultPath = path.join(entryPath, 'result.json');
    try {
      const resultDetails = await lstat(resultPath);
      if (!resultDetails.isFile()) throw new Error(`candidate ${entry.name} result must be a regular file`);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const rejection = rejections.get(entry.name);
    try {
      candidates.push(await readCandidate(
        projectRoot,
        sidecar,
        entry.name,
        rejection
      ));
    } catch (error) {
      if (rejection === undefined || error.code !== 'ENOENT') throw error;
      candidates.push(rejectionHistoryCandidate(rejection));
    }
    rejections.delete(entry.name);
  }
  candidates.push(...[...rejections.values()].map(rejectionHistoryCandidate));
  return candidates;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function imageHref(output, imagePath) {
  const relative = path.posix.relative(path.posix.dirname(output), imagePath);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function renderSummarySection(title, value) {
  return `<section><h2>${escapeHtml(title)}</h2><pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre></section>`;
}

export function renderPreviewHtml({ output, sidecar, sourceImage, candidates }) {
  const source = sourceImage === null
    ? '<p class="empty">No source image is staged. Review a generated candidate before staging.</p>'
    : `<figure class="source"><img src="${escapeHtml(
      sourceImage.embeddedSrc ?? imageHref(output, sourceImage.path)
    )}" `
      + `alt="${escapeHtml(`${sidecar.theme}/${sidecar.id} exact staged source`)}">`
      + `<figcaption>Verified exact source · ${sourceImage.width}×${sourceImage.height} `
      + `· ${escapeHtml(sourceImage.sha256)}</figcaption></figure>`;
  const candidateCards = candidates.length === 0
    ? '<p class="empty">No complete generated candidates are present.</p>'
    : candidates.map(candidate => (
      `<article class="candidate${candidate.selected ? ' selected' : ''}`
      + `${candidate.reviewStatus === 'rejected' ? ' rejected' : ''}">`
      + `<h3>${escapeHtml(candidate.id)}</h3>`
      + (candidate.image.verified
        ? `<img loading="lazy" src="${escapeHtml(
          candidate.image.embeddedSrc ?? imageHref(output, candidate.image.path)
        )}" alt="${escapeHtml(`${candidate.id} generated candidate`)}">`
        : '<p class="empty">Exact local candidate evidence is unavailable in this checkout.</p>')
      + `<p>${escapeHtml(candidate.reviewStatus)} · ${candidate.image.verified
        ? 'verified candidate pin'
        : 'recorded rejection pin'}</p>`
      + (candidate.rejection === null
        ? ''
        : `<p>Rejected by ${escapeHtml(candidate.rejection.reviewer)}</p>`
          + `<p>${escapeHtml(candidate.rejection.reason)}</p>`)
      + `<p class="hash">${escapeHtml(candidate.image.sha256)}</p></article>`
    )).join('');
  const review = sidecar.review === null
    ? 'No template approval recorded.'
    : `${sidecar.review.decision} by ${sidecar.review.reviewer}`;
  const pinRows = Object.entries(sidecar.pins).map(([name, value]) => (
    `<dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value ?? 'not pinned')}</dd>`
  )).join('');
  const summaries = [
    ['Composition', sidecar.composition],
    ['Topology', sidecar.topologyIntent],
    ['Height', sidecar.heightIntent],
    ['Route', sidecar.routeIntent],
    ['Boundary', sidecar.boundaryIntent],
    ['Spawn', sidecar.spawnIntent],
    ['Forbidden patterns', sidecar.forbiddenPatterns]
  ].map(([title, value]) => renderSummarySection(title, value)).join('');

  return '<!doctype html>\n'
    + '<html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta http-equiv="Content-Security-Policy" '
    + 'content="default-src &#39;none&#39;; img-src data:; style-src &#39;unsafe-inline&#39;">'
    + `<title>${escapeHtml(`${sidecar.theme}/${sidecar.id} source-template review`)}</title>`
    + '<style>:root{color-scheme:dark}body{margin:0;background:#151a17;color:#eef4ef;font:15px/1.5 '
    + 'system-ui,sans-serif}header,main{max-width:1180px;margin:auto;padding:24px}header{border-bottom:1px '
    + 'solid #536159}.status{color:#b8d8c3}.source img,.candidate img{display:block;max-width:100%;max-height:'
    + '680px;object-fit:contain;background:#0c0f0d}.grid{display:grid;grid-template-columns:repeat(auto-fit,'
    + 'minmax(240px,1fr));gap:18px}.candidate,section{padding:16px;background:#202822;border:1px solid '
    + '#465249;border-radius:8px}.candidate.selected{border-color:#9fd5af}.candidate.rejected{border-color:'
    + '#c78383}.candidate img{width:100%;'
    + 'aspect-ratio:1}.hash,dd,pre{overflow-wrap:anywhere}dl{display:grid;grid-template-columns:max-content '
    + '1fr;gap:6px 16px}dt{font-weight:700}dd{margin:0}pre{white-space:pre-wrap;margin:0}.summary{display:grid;'
    + 'gap:16px}.empty{color:#c5cec8}</style></head><body>'
    + `<header><h1>${escapeHtml(sidecar.theme)} / ${escapeHtml(sidecar.id)}</h1>`
    + `<p class="status">Lifecycle status: ${escapeHtml(sidecar.status)} · ${escapeHtml(review)}</p></header>`
    + `<main><h2>Exact staged source</h2>${source}<h2>Generated candidates</h2>`
    + `<div class="grid">${candidateCards}</div><h2>Recorded pins</h2><dl>${pinRows}</dl>`
    + `<div class="summary">${summaries}</div></main></body></html>\n`;
}

async function writeExclusiveReview(projectRoot, relativePath, contents) {
  const absolute = resolveWithinProject(projectRoot, relativePath, '--output');
  await assertSafeWritePath(projectRoot, absolute, '--output');
  await mkdir(path.dirname(absolute), { recursive: true });
  await assertSafeWritePath(projectRoot, absolute, '--output');
  let handle;
  try {
    handle = await open(absolute, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(`refusing to overwrite existing review output: ${relativePath}`);
    }
    throw error;
  }
  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } catch (error) {
    await handle.close();
    handle = null;
    await unlink(absolute).catch(unlinkError => {
      if (unlinkError.code !== 'ENOENT') throw unlinkError;
    });
    throw error;
  } finally {
    await handle?.close();
  }
}

export async function previewTemplate(options) {
  const projectRoot = path.resolve(options.projectRoot ?? defaultProjectRoot());
  const output = validateReviewOutput(
    options.output
      ?? `${REVIEW_ROOT}/${options.theme}/${options.template}/source-template-preview.html`
  );
  const loaded = await loadTemplateSidecar({
    projectRoot,
    theme: options.theme,
    template: options.template
  });
  const [sourceImage, rejections] = await Promise.all([
    verifySourceImage(projectRoot, loaded.sidecar),
    loadRejections(projectRoot, loaded.sidecar)
  ]);
  const candidates = await loadCandidates(projectRoot, loaded.sidecar, rejections);
  const html = renderPreviewHtml({
    output,
    sidecar: loaded.sidecar,
    sourceImage,
    candidates
  });
  await writeExclusiveReview(projectRoot, output, html);
  const resultSourceImage = sourceImage === null
    ? null
    : Object.fromEntries(
      Object.entries(sourceImage).filter(([key]) => key !== 'embeddedSrc')
    );
  const resultCandidates = candidates.map(candidate => ({
    ...candidate,
    image: Object.fromEntries(
      Object.entries(candidate.image).filter(([key]) => key !== 'embeddedSrc')
    )
  }));
  return {
    ok: true,
    theme: options.theme,
    template: options.template,
    status: loaded.sidecar.status,
    output,
    outputSha256: sha256Bytes(Buffer.from(html)),
    sourceImage: resultSourceImage,
    candidates: resultCandidates
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parsePreviewArgs(argv);
  const result = await previewTemplate(options);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Wrote verified source-template review: ${result.output}`);
    const verifiedCandidates = result.candidates.filter(candidate => candidate.image.verified).length;
    const rejectionHistory = result.candidates.length - verifiedCandidates;
    console.log(
      `${result.sourceImage === null ? 'No staged source' : 'Exact staged source verified'}; `
      + `${verifiedCandidates} complete generated candidate(s) verified; `
      + `${rejectionHistory} recorded rejection(s) shown without local candidate evidence.`
    );
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Battle-map source-template preview failed: ${error.message}`);
    process.exitCode = 1;
  });
}
