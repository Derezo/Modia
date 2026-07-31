#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  open,
  realpath,
  unlink,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  assertBattleMapV3CatalogMapPins,
  computeTemplateMapAssetBundleManifestFullHash,
  hashCanonicalV3Value,
  loadAndFreezeBattleMapV3Final,
  normalizeBattleMapV3CatalogRelease
} from '../../shared/battleMap/v3/index.js';
import {
  parseJsonRejectDuplicateKeys
} from '../../shared/battleMap/canonicalJson.js';

export const REVIEW_SCHEMA_VERSION = 'battle-map-v3-render-review-v1';
export const GALLERY_SCHEMA_VERSION = 'battle-map-v3-render-gallery-v1';
export const ACTIVE_RELEASE_PATH = 'battle-maps/catalog/active-release.json';
export const RUNTIME_BUNDLE_PATH =
  'frontend/src/generated/battleMapV3RuntimeBundle.json';
export const DEFAULT_OUTPUT_DIRECTORY =
  'artifacts/battle-map-v3-render-reviews';
export const DEFAULT_PORT = 4173;
export const DEFAULT_TIMEOUT_MS = 60_000;
export const MAX_MAP_SELECTION = 200;

const SCRIPT_PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const FRONTEND_ROOT = 'frontend';
const HARNESS_PAGE = '/battle-map-visual.html';
const RENDERER_HASH_DOMAIN = 'modia:battle-art:renderer-manifest:v1';
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SAFE_MAP_PATH =
  /^battle-maps\/compiled\/[a-z0-9][a-z0-9._-]{0,127}\/[a-z0-9][a-z0-9._-]{0,191}\.json$/;
const MAX_JSON_BYTES = 64 * 1024 * 1024;
const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function fail(message, code = 'BATTLE_MAP_V3_RENDER_ERROR') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function parseBoundedInteger(value, label, minimum, maximum) {
  if (!/^[0-9]+$/.test(String(value))) {
    fail(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return parsed;
}

function takeValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    fail(`${option} requires a value`);
  }
  return value;
}

export function parseRenderArgs(argv = process.argv.slice(2)) {
  const mode = argv[0];
  if (mode === '--help' || mode === '-h') {
    return Object.freeze({ help: true });
  }
  if (!['preview', 'screenshot', 'gallery'].includes(mode)) {
    fail('First argument must be preview, screenshot, or gallery');
  }

  const options = {
    mode,
    maps: [],
    allApproved: false,
    outputDirectory: DEFAULT_OUTPUT_DIRECTORY,
    port: DEFAULT_PORT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    help: false
  };
  const singleUse = new Set();
  for (let index = 1; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--help' || option === '-h') {
      options.help = true;
      continue;
    }
    if (option === '--map') {
      if (options.maps.length >= MAX_MAP_SELECTION) {
        fail(`--map may be supplied at most ${MAX_MAP_SELECTION} times`);
      }
      options.maps.push(takeValue(argv, index, option));
      index += 1;
      continue;
    }
    if (option === '--all-approved') {
      if (singleUse.has(option)) fail(`${option} may only be supplied once`);
      singleUse.add(option);
      options.allApproved = true;
      continue;
    }
    if (['--output-dir', '--port', '--timeout'].includes(option)) {
      if (singleUse.has(option)) fail(`${option} may only be supplied once`);
      singleUse.add(option);
      const value = takeValue(argv, index, option);
      if (option === '--output-dir') options.outputDirectory = value;
      if (option === '--port') {
        options.port = parseBoundedInteger(value, '--port', 1024, 65535);
      }
      if (option === '--timeout') {
        options.timeoutMs =
          parseBoundedInteger(value, '--timeout', 1, 300) * 1000;
      }
      index += 1;
      continue;
    }
    fail(`Unknown argument: ${option}`);
  }

  if (options.help) return Object.freeze(options);
  if (options.allApproved && options.maps.length > 0) {
    fail('--all-approved and --map are mutually exclusive');
  }
  if (!options.allApproved && options.maps.length === 0) {
    fail('Supply --map <compiled-json> or --all-approved');
  }
  if (mode !== 'gallery' && options.allApproved) {
    fail('--all-approved is only supported by gallery mode');
  }
  if (mode !== 'gallery' && options.maps.length !== 1) {
    fail(`${mode} mode requires exactly one --map`);
  }
  if (mode === 'preview' && singleUse.has('--output-dir')) {
    fail('preview mode does not accept --output-dir');
  }
  return Object.freeze({ ...options, maps: Object.freeze([...options.maps]) });
}

export function validateProjectRelativePath(relativePath, label = 'path') {
  if (
    typeof relativePath !== 'string'
    || relativePath.length === 0
    || relativePath.length > 512
    || path.posix.isAbsolute(relativePath)
    || relativePath.includes('\\')
    || relativePath.includes('\0')
    || relativePath.includes('?')
    || relativePath.includes('#')
  ) {
    fail(`${label} must be a safe project-relative path`);
  }
  const segments = relativePath.split('/');
  if (segments.some(segment => {
    if (segment.length === 0) return true;
    try {
      const decoded = decodeURIComponent(segment);
      return decoded === '.'
        || decoded === '..'
        || decoded.includes('/')
        || decoded.includes('\\')
        || decoded.includes('\0');
    } catch {
      return true;
    }
  })) {
    fail(`${label} contains an empty, encoded, or traversal segment`);
  }
  return relativePath;
}

export function validateCompiledMapPath(relativePath) {
  validateProjectRelativePath(relativePath, 'map path');
  if (!SAFE_MAP_PATH.test(relativePath)) {
    fail(
      'map path must name final JSON under battle-maps/compiled/<theme>/',
      'UNSAFE_BATTLE_MAP_V3_PATH'
    );
  }
  return relativePath;
}

function resolveInsideProject(projectRoot, relativePath, label) {
  validateProjectRelativePath(relativePath, label);
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(root, ...relativePath.split('/'));
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    fail(`${label} escapes the project root`);
  }
  return resolved;
}

export async function assertNoSymlinkPath(
  projectRoot,
  relativePath,
  { allowMissing = false, label = 'path' } = {}
) {
  const absolute = resolveInsideProject(projectRoot, relativePath, label);
  const segments = relativePath.split('/');
  let cursor = path.resolve(projectRoot);
  for (let index = 0; index < segments.length; index += 1) {
    cursor = path.join(cursor, segments[index]);
    try {
      const details = await lstat(cursor);
      if (details.isSymbolicLink()) {
        fail(`${label} contains a forbidden symlink`);
      }
      if (index < segments.length - 1 && !details.isDirectory()) {
        fail(`${label} contains a non-directory parent`);
      }
    } catch (error) {
      if (error.code === 'ENOENT' && allowMissing) return absolute;
      throw error;
    }
  }
  return absolute;
}

export async function readSafeProjectJson(
  projectRoot,
  relativePath,
  label = 'JSON file'
) {
  const absolute = await assertNoSymlinkPath(projectRoot, relativePath, { label });
  let handle;
  try {
    handle = await open(
      absolute,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
    );
    const details = await handle.stat();
    if (!details.isFile() || details.size < 1 || details.size > MAX_JSON_BYTES) {
      fail(`${label} must be a regular file of 1..${MAX_JSON_BYTES} bytes`);
    }
    const [physicalRoot, physicalPath] = await Promise.all([
      realpath(path.resolve(projectRoot)),
      realpath(absolute)
    ]);
    const expected = path.join(physicalRoot, ...relativePath.split('/'));
    if (physicalPath !== expected) fail(`${label} resolves through a symlink`);
    const bytes = await handle.readFile();
    let source;
    try {
      source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (error) {
      fail(`${label} is not UTF-8: ${error.message}`);
    }
    try {
      return Object.freeze({
        value: parseJsonRejectDuplicateKeys(source),
        bytes
      });
    } catch (error) {
      fail(`${label} is not strict JSON: ${error.message}`);
    }
  } finally {
    await handle?.close();
  }
}

async function ensureSafeOutputDirectory(projectRoot, relativePath) {
  validateProjectRelativePath(relativePath, 'output directory');
  const root = path.resolve(projectRoot);
  let cursor = root;
  for (const segment of relativePath.split('/')) {
    cursor = path.join(cursor, segment);
    try {
      const details = await lstat(cursor);
      if (details.isSymbolicLink() || !details.isDirectory()) {
        fail('output directory contains a symlink or non-directory component');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await mkdir(cursor);
      const created = await lstat(cursor);
      if (created.isSymbolicLink() || !created.isDirectory()) {
        fail('output directory was created unsafely');
      }
    }
  }
  return cursor;
}

async function writeExclusive(filePath, bytes) {
  try {
    await writeFile(filePath, bytes, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code === 'EEXIST') {
      fail(`Refusing to overwrite existing review output: ${filePath}`);
    }
    throw error;
  }
}

async function atomicExclusiveJson(filePath, value) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  try {
    await writeExclusive(temporary, bytes);
    try {
      await link(temporary, filePath);
    } catch (error) {
      if (error.code === 'EEXIST') {
        fail(`Refusing to overwrite existing review output: ${filePath}`);
      }
      throw error;
    }
  } finally {
    await unlink(temporary).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  return bytes;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function inspectPng(bytes) {
  if (
    !Buffer.isBuffer(bytes)
    || bytes.length < 24
    || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)
    || bytes.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    fail('Screenshot is not a valid PNG');
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 16384 || height > 32768) {
    fail('Screenshot PNG dimensions are out of bounds');
  }
  return Object.freeze({ width, height });
}

export async function verifyRuntimeBundleBinding(map, runtimeBundle) {
  if (!runtimeBundle || typeof runtimeBundle !== 'object') {
    fail('BattleMapV3 runtime bundle must be an object');
  }
  if (!Array.isArray(runtimeBundle.assets) ||
      !Array.isArray(runtimeBundle.renderers) ||
      runtimeBundle.assets.length === 0 ||
      runtimeBundle.assets.length !== runtimeBundle.renderers.length) {
    fail('BattleMapV3 runtime bundle asset/renderer closure is invalid');
  }
  const expectedRendererHash = await hashCanonicalV3Value(
    RENDERER_HASH_DOMAIN,
    {
      id: runtimeBundle.id,
      version: runtimeBundle.version,
      renderProfile: runtimeBundle.renderProfile,
      renderers: runtimeBundle.renderers
    }
  );
  if (runtimeBundle.rendererManifestFullHash !== expectedRendererHash) {
    fail('BattleMapV3 runtime renderer manifest hash mismatch');
  }
  const expectedManifestHash =
    await computeTemplateMapAssetBundleManifestFullHash(runtimeBundle);
  if (runtimeBundle.manifestFullHash !== expectedManifestHash) {
    fail('BattleMapV3 runtime asset-bundle manifest hash mismatch');
  }
  const pin = map?.provenance?.assetBundle;
  if (
    pin?.id !== runtimeBundle.id
    || pin?.version !== runtimeBundle.version
    || pin?.manifestFullHash !== runtimeBundle.manifestFullHash
  ) {
    fail('Compiled map does not bind the deployed frontend runtime asset bundle');
  }
  return Object.freeze({
    id: runtimeBundle.id,
    version: runtimeBundle.version,
    manifestFullHash: runtimeBundle.manifestFullHash,
    rendererManifestFullHash: runtimeBundle.rendererManifestFullHash
  });
}

async function loadOneMap(projectRoot, relativePath) {
  validateCompiledMapPath(relativePath);
  const { value } = await readSafeProjectJson(
    projectRoot,
    relativePath,
    `compiled map ${relativePath}`
  );
  const map = await loadAndFreezeBattleMapV3Final(value);
  return Object.freeze({ path: relativePath, map });
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    fail(`${label} must contain exactly ${expected.join(', ')}`);
  }
}

async function loadAllApproved(projectRoot) {
  const { value: pin } = await readSafeProjectJson(
    projectRoot,
    ACTIVE_RELEASE_PATH,
    'active BattleMapV3 release pin'
  );
  exactKeys(pin, [
    'schemaVersion',
    'catalogReleaseId',
    'catalogPath',
    'catalogFullHash',
    'maps'
  ], 'active BattleMapV3 release pin');
  if (
    pin.schemaVersion !== 'battle-map-v3-active-release-pin-v1'
    || !HASH_PATTERN.test(pin.catalogFullHash)
    || !Array.isArray(pin.maps)
    || pin.maps.length < 1
    || pin.maps.length > MAX_MAP_SELECTION
  ) {
    fail(`Active release must select 1..${MAX_MAP_SELECTION} approved maps`);
  }
  validateProjectRelativePath(pin.catalogPath, 'active catalog path');
  if (!pin.catalogPath.startsWith('battle-maps/catalog/releases/')) {
    fail('Active catalog path is outside the immutable release directory');
  }
  const { value: catalogInput } = await readSafeProjectJson(
    projectRoot,
    pin.catalogPath,
    'active BattleMapV3 catalog'
  );
  const catalog = await normalizeBattleMapV3CatalogRelease(catalogInput);
  if (
    catalog.catalogReleaseId !== pin.catalogReleaseId
    || catalog.catalogFullHash !== pin.catalogFullHash
  ) {
    fail('Active catalog identity/hash does not match its tracked pin');
  }
  const records = [];
  let previousContentId = null;
  for (const [index, entry] of pin.maps.entries()) {
    exactKeys(
      entry,
      ['contentId', 'contentVersion', 'path', 'fullHash'],
      `active release maps[${index}]`
    );
    validateCompiledMapPath(entry.path);
    if (!HASH_PATTERN.test(entry.fullHash)) {
      fail(`active release maps[${index}].fullHash is invalid`);
    }
    if (
      previousContentId !== null
      && entry.contentId.localeCompare(previousContentId) <= 0
    ) {
      fail('Active release maps must be strictly ordered by contentId');
    }
    previousContentId = entry.contentId;
    const record = await loadOneMap(projectRoot, entry.path);
    if (
      record.map.contentId !== entry.contentId
      || record.map.contentVersion !== entry.contentVersion
      || record.map.hashes.fullHash !== entry.fullHash
    ) {
      fail(`Active release map pin is stale for ${entry.path}`);
    }
    records.push(record);
  }
  await assertBattleMapV3CatalogMapPins(
    catalog,
    records.map(record => record.map)
  );
  return records;
}

export async function loadRenderSelection({
  projectRoot = SCRIPT_PROJECT_ROOT,
  maps = [],
  allApproved = false
}) {
  const root = path.resolve(projectRoot);
  const records = allApproved
    ? await loadAllApproved(root)
    : await Promise.all(maps.map(relativePath => loadOneMap(root, relativePath)));
  if (records.length < 1 || records.length > MAX_MAP_SELECTION) {
    fail(`Render selection must contain 1..${MAX_MAP_SELECTION} maps`);
  }
  const identities = new Set();
  const paths = new Set();
  for (const record of records) {
    const identity = `${record.map.contentId}@${record.map.contentVersion}`;
    if (identities.has(identity) || paths.has(record.path)) {
      fail('Render selection contains a duplicate map identity or path');
    }
    identities.add(identity);
    paths.add(record.path);
  }
  return Object.freeze(
    [...records]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map(Object.freeze)
  );
}

function viteFsArtifactPath(projectRoot, mapPath) {
  const absolute = resolveInsideProject(projectRoot, mapPath, 'map path');
  return `/@fs/${absolute.split(path.sep).join('/')}`;
}

export function buildHarnessUrl({
  projectRoot = SCRIPT_PROJECT_ROOT,
  mapPath,
  port = DEFAULT_PORT
}) {
  validateCompiledMapPath(mapPath);
  parseBoundedInteger(port, 'port', 1024, 65535);
  const url = new URL(HARNESS_PAGE, `http://127.0.0.1:${port}`);
  url.searchParams.set('artifact', viteFsArtifactPath(projectRoot, mapPath));
  url.searchParams.set('autorun', '1');
  return url.toString();
}

export function buildViteCommand({
  projectRoot = SCRIPT_PROJECT_ROOT,
  port = DEFAULT_PORT,
  nodeExecutable = process.execPath,
  viteBin = null
} = {}) {
  parseBoundedInteger(port, 'port', 1024, 65535);
  const resolvedViteBin = viteBin ??
    path.join(
      path.dirname(require.resolve('vite/package.json')),
      'bin/vite.js'
    );
  return Object.freeze({
    command: nodeExecutable,
    args: Object.freeze([
      resolvedViteBin,
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort'
    ]),
    cwd: path.join(path.resolve(projectRoot), FRONTEND_ROOT)
  });
}

function appendBounded(current, chunk) {
  const next = `${current}${String(chunk)}`;
  return next.length <= MAX_PROCESS_OUTPUT_BYTES
    ? next
    : next.slice(next.length - MAX_PROCESS_OUTPUT_BYTES);
}

export async function waitForViteReady({
  port,
  timeoutMs,
  fetchImpl = globalThis.fetch,
  exited = null
}) {
  const deadline = Date.now() + timeoutMs;
  const readyUrl =
    `http://127.0.0.1:${port}${HARNESS_PAGE}?autorun=0`;
  while (Date.now() < deadline) {
    if (exited) {
      const result = await Promise.race([
        exited.then(value => ({ exited: true, value })),
        new Promise(resolve => setTimeout(() => resolve({ exited: false }), 0))
      ]);
      if (result.exited) {
        fail(`Vite exited before becoming ready (code ${result.value.code})`);
      }
    }
    try {
      const response = await fetchImpl(readyUrl, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(Math.min(1000, timeoutMs))
      });
      if (response.ok) return readyUrl;
    } catch {
      // Expected while the local server binds.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  fail(`Timed out waiting for the local Vite harness on port ${port}`);
}

async function terminateChild(child, exited) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const signal = name => {
    try {
      if (process.platform !== 'win32' && child.pid) {
        process.kill(-child.pid, name);
      } else {
        child.kill(name);
      }
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  signal('SIGTERM');
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise(resolve => setTimeout(() => resolve(false), 2000))
  ]);
  if (!stopped) signal('SIGKILL');
  await exited;
}

export async function launchViteHarness({
  projectRoot = SCRIPT_PROJECT_ROOT,
  port = DEFAULT_PORT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  spawnImpl = spawn,
  waitForReadyImpl = waitForViteReady,
  commandOptions = {}
} = {}) {
  const command = buildViteCommand({
    projectRoot,
    port,
    ...commandOptions
  });
  const child = spawnImpl(command.command, command.args, {
    cwd: command.cwd,
    env: { ...process.env, BROWSER: 'none' },
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', chunk => {
    stdout = appendBounded(stdout, chunk);
  });
  child.stderr?.on('data', chunk => {
    stderr = appendBounded(stderr, chunk);
  });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await terminateChild(child, exited);
  };
  try {
    await waitForReadyImpl({ port, timeoutMs, exited });
  } catch (error) {
    await stop().catch(() => {});
    const details = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n');
    if (details) error.message += `\n${details}`;
    throw error;
  }
  return Object.freeze({
    child,
    command,
    exited,
    stop,
    output: () => Object.freeze({ stdout, stderr })
  });
}

function requestViolation(urlValue, localOrigin) {
  let url;
  const local = new URL(localOrigin);
  try {
    url = new URL(urlValue);
  } catch {
    return `malformed request URL ${urlValue}`;
  }
  if (['data:', 'blob:'].includes(url.protocol)) return null;
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) {
    return `unsupported request protocol ${url.protocol}`;
  }
  const sameLoopbackEndpoint =
    url.hostname === local.hostname
    && url.port === local.port;
  if (!sameLoopbackEndpoint) {
    return `non-local network request ${url.href}`;
  }
  if (
    url.pathname === '/api'
    || url.pathname.startsWith('/api/')
    || url.pathname === '/ws'
    || url.pathname.startsWith('/ws/')
  ) {
    return `forbidden API/WebSocket request ${url.href}`;
  }
  return null;
}

export class RenderFailureCollector {
  #origin;
  #failures = [];

  constructor(harnessUrl) {
    this.#origin = new URL(harnessUrl).origin;
  }

  console(message) {
    if (message.type() === 'error') {
      this.#failures.push(`console.error: ${message.text()}`);
    }
  }

  pageError(error) {
    this.#failures.push(`pageerror: ${error?.message ?? String(error)}`);
  }

  request(request) {
    const violation = requestViolation(request.url(), this.#origin);
    if (violation) this.#failures.push(violation);
  }

  webSocket(socket) {
    const violation = requestViolation(socket.url(), this.#origin);
    if (violation) this.#failures.push(violation);
  }

  requestFailed(request) {
    this.#failures.push(
      `request failed: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`
    );
  }

  response(response) {
    if (response.status() >= 400) {
      this.#failures.push(
        `HTTP ${response.status()} while loading ${response.url()}`
      );
    }
  }

  browserDisconnected() {
    this.#failures.push('browser disconnected before review capture completed');
  }

  get failures() {
    return Object.freeze([...this.#failures]);
  }

  assertClean() {
    if (this.#failures.length > 0) {
      fail(`Visual harness failures:\n${this.#failures.join('\n')}`);
    }
  }
}

function attachPageFailures(page, collector) {
  page.on('console', message => collector.console(message));
  page.on('pageerror', error => collector.pageError(error));
  page.on('request', request => collector.request(request));
  page.on('websocket', socket => collector.webSocket(socket));
  page.on('requestfailed', request => collector.requestFailed(request));
  page.on('response', response => collector.response(response));
}

async function defaultBrowserFactory() {
  const { chromium } = await import('@playwright/test');
  return chromium.launch({ headless: true });
}

function assertHarnessResult(result, map, bundle) {
  if (!result || typeof result !== 'object' || result.error) {
    fail(`Visual harness returned an error: ${result?.error ?? 'missing result'}`);
  }
  if (
    result.battleMapSchemaVersion !== 3
    || result.contentId !== map.contentId
    || result.contentVersion !== map.contentVersion
    || result.fullHash !== map.hashes.fullHash
    || result.assetBundleManifestFullHash !== bundle.manifestFullHash
  ) {
    fail('Visual harness result does not match the exact compiled map/runtime pins');
  }
  for (const key of ['renderDurationMs', 'renderedCells', 'exactAssetSelections']) {
    if (!Number.isSafeInteger(result[key]) || result[key] < 0) {
      fail(`Visual harness result.${key} is invalid`);
    }
  }
  return result;
}

function outputStem(record) {
  const safeId = record.map.contentId
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return `${safeId}.v${record.map.contentVersion}.` +
    `${record.map.hashes.fullHash.slice('sha256:'.length, 19)}`;
}

export function buildReviewMetadata({
  record,
  runtimeBinding,
  harnessUrl,
  screenshotPath,
  screenshotBytes,
  screenshotDimensions,
  harnessResult
}) {
  return {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    map: {
      path: record.path,
      contentId: record.map.contentId,
      contentVersion: record.map.contentVersion,
      fullHash: record.map.hashes.fullHash
    },
    assetBundle: { ...runtimeBinding },
    renderer: {
      harnessPage: HARNESS_PAGE,
      harnessModule: 'frontend/src/dev/BattleMapVisualHarness.js',
      harnessUrl
    },
    screenshot: {
      path: screenshotPath,
      sha256: sha256(screenshotBytes),
      bytes: screenshotBytes.length,
      width: screenshotDimensions.width,
      height: screenshotDimensions.height
    },
    renderMetrics: {
      renderDurationMs: harnessResult.renderDurationMs,
      renderedCells: harnessResult.renderedCells,
      exactAssetSelections: harnessResult.exactAssetSelections,
      worldBounds: harnessResult.worldBounds
    }
  };
}

export async function captureMapReview({
  projectRoot = SCRIPT_PROJECT_ROOT,
  record,
  runtimeBinding,
  browser,
  port = DEFAULT_PORT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  outputDirectory
}) {
  const harnessUrl = buildHarnessUrl({
    projectRoot,
    mapPath: record.path,
    port
  });
  const context = await browser.newContext({
    viewport: { width: 1200, height: 1400 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    reducedMotion: 'reduce'
  });
  try {
    const page = await context.newPage();
    const collector = new RenderFailureCollector(harnessUrl);
    attachPageFailures(page, collector);
    await page.goto(harnessUrl, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs
    });
    collector.assertClean();
    try {
      await page.waitForFunction(
        () => ['ready', 'error'].includes(document.body.dataset.status),
        null,
        { timeout: timeoutMs }
      );
    } catch (error) {
      let diagnostic = null;
      try {
        diagnostic = await page.evaluate(() => ({
          status: document.body?.dataset?.status ?? 'missing-body',
          title: document.querySelector('#title')?.textContent ?? '',
          details: document.querySelector('#details')?.textContent ?? '',
          error: document.querySelector('#error')?.textContent ?? '',
          result: window.__battleMapVisualResult ?? null
        }));
      } catch (diagnosticError) {
        diagnostic = {
          status: 'unavailable',
          error: diagnosticError?.message ?? String(diagnosticError)
        };
      }
      const failures = collector.failures;
      const evidence = [
        `status=${diagnostic.status}`,
        diagnostic.title ? `title=${diagnostic.title}` : null,
        diagnostic.details ? `details=${diagnostic.details}` : null,
        diagnostic.error ? `error=${diagnostic.error}` : null,
        diagnostic.result
          ? `result=${JSON.stringify(diagnostic.result)}`
          : null,
        ...failures
      ].filter(Boolean);
      fail(
        `Visual harness did not reach ready/error state: ${error.message}` +
        (evidence.length > 0 ? `\n${evidence.join('\n')}` : '')
      );
    }
    const status = await page.locator('body').getAttribute('data-status');
    const result = await page.evaluate(() => window.__battleMapVisualResult);
    if (status !== 'ready') {
      fail(`Visual harness entered ${status} state: ${result?.error ?? 'unknown error'}`);
    }
    assertHarnessResult(result, record.map, runtimeBinding);
    collector.assertClean();

    const screenshotBytes = await page.locator('.capture').screenshot({
      type: 'png',
      animations: 'disabled',
      timeout: timeoutMs
    });
    collector.assertClean();
    const dimensions = inspectPng(screenshotBytes);
    const stem = outputStem(record);
    const screenshotRelative =
      `${outputDirectory}/${stem}.png`;
    const metadataRelative =
      `${outputDirectory}/${stem}.review.json`;
    const outputRoot = await ensureSafeOutputDirectory(
      projectRoot,
      outputDirectory
    );
    await writeExclusive(path.join(outputRoot, `${stem}.png`), screenshotBytes);
    const metadata = buildReviewMetadata({
      record,
      runtimeBinding,
      harnessUrl,
      screenshotPath: screenshotRelative,
      screenshotBytes,
      screenshotDimensions: dimensions,
      harnessResult: result
    });
    await atomicExclusiveJson(
      path.join(outputRoot, `${stem}.review.json`),
      metadata
    );
    return Object.freeze({
      metadata,
      metadataPath: metadataRelative,
      screenshotPath: screenshotRelative
    });
  } finally {
    await context.close();
  }
}

async function createContactSheet(projectRoot, outputDirectory, reviews) {
  const sharpModule = await import('sharp');
  const sharp = sharpModule.default;
  const columns = Math.min(3, reviews.length);
  const cellWidth = 480;
  const cellHeight = 320;
  const rows = Math.ceil(reviews.length / columns);
  const width = columns * cellWidth;
  const height = rows * cellHeight;
  if (height > 32768) fail('Gallery contact sheet exceeds PNG height limits');
  const composites = [];
  for (const [index, review] of reviews.entries()) {
    const absolute = resolveInsideProject(
      projectRoot,
      review.screenshotPath,
      'gallery screenshot'
    );
    const thumbnail = await sharp(absolute)
      .resize({
        width: cellWidth - 24,
        height: cellHeight - 56,
        fit: 'contain',
        withoutEnlargement: true
      })
      .png()
      .toBuffer();
    const label = `${review.metadata.map.contentId} ` +
      `v${review.metadata.map.contentVersion} ` +
      review.metadata.map.fullHash.slice(7, 19);
    const escaped = label.replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;'
    })[character]);
    const labelSvg = Buffer.from(
      `<svg width="${cellWidth - 24}" height="32" xmlns="http://www.w3.org/2000/svg">` +
      `<text x="0" y="22" fill="#edf4ff" font-family="monospace" font-size="14">${escaped}</text>` +
      '</svg>'
    );
    const left = (index % columns) * cellWidth + 12;
    const top = Math.floor(index / columns) * cellHeight + 12;
    composites.push(
      { input: thumbnail, left, top },
      { input: labelSvg, left, top: top + cellHeight - 48 }
    );
  }
  const bytes = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 8, g: 11, b: 16, alpha: 1 }
    }
  }).composite(composites).png().toBuffer();
  const relativePath = `${outputDirectory}/contact-sheet.png`;
  await writeExclusive(
    resolveInsideProject(projectRoot, relativePath, 'contact sheet'),
    bytes
  );
  return Object.freeze({
    path: relativePath,
    sha256: sha256(bytes),
    bytes: bytes.length,
    ...inspectPng(bytes)
  });
}

export async function renderScreenshots({
  projectRoot = SCRIPT_PROJECT_ROOT,
  selection,
  outputDirectory,
  port,
  timeoutMs,
  browserFactory = defaultBrowserFactory,
  launchHarness = launchViteHarness,
  includeGallery = false
}) {
  validateProjectRelativePath(outputDirectory, 'output directory');
  const { value: runtimeBundle } = await readSafeProjectJson(
    projectRoot,
    RUNTIME_BUNDLE_PATH,
    'frontend BattleMapV3 runtime bundle'
  );
  const bindings = new Map();
  for (const record of selection) {
    const binding = await verifyRuntimeBundleBinding(record.map, runtimeBundle);
    bindings.set(record.path, binding);
  }

  const server = await launchHarness({ projectRoot, port, timeoutMs });
  let browser;
  let closingBrowser = false;
  try {
    browser = await browserFactory();
    const browserFailures = [];
    browser.on?.('disconnected', () => {
      if (!closingBrowser) browserFailures.push('browser disconnected');
    });
    const reviews = [];
    for (const record of selection) {
      if (browserFailures.length > 0) fail(browserFailures.join('\n'));
      reviews.push(await captureMapReview({
        projectRoot,
        record,
        runtimeBinding: bindings.get(record.path),
        browser,
        port,
        timeoutMs,
        outputDirectory
      }));
    }
    let gallery = null;
    if (includeGallery) {
      const contactSheet = await createContactSheet(
        projectRoot,
        outputDirectory,
        reviews
      );
      const manifest = {
        schemaVersion: GALLERY_SCHEMA_VERSION,
        maps: reviews.map(review => ({
          contentId: review.metadata.map.contentId,
          contentVersion: review.metadata.map.contentVersion,
          fullHash: review.metadata.map.fullHash,
          screenshotPath: review.screenshotPath,
          screenshotSha256: review.metadata.screenshot.sha256,
          reviewMetadataPath: review.metadataPath
        })),
        assetBundles: [...new Map(
          reviews.map(review => [
            review.metadata.assetBundle.id,
            review.metadata.assetBundle
          ])
        ).values()].sort((left, right) => left.id.localeCompare(right.id)),
        contactSheet
      };
      const manifestPath = `${outputDirectory}/gallery-manifest.json`;
      const outputRoot = await ensureSafeOutputDirectory(
        projectRoot,
        outputDirectory
      );
      const manifestBytes = await atomicExclusiveJson(
        path.join(outputRoot, 'gallery-manifest.json'),
        manifest
      );
      gallery = Object.freeze({
        manifestPath,
        manifestSha256: sha256(manifestBytes),
        contactSheet
      });
    }
    return Object.freeze({ reviews, gallery });
  } finally {
    if (browser) {
      closingBrowser = true;
      await browser.close().catch(() => {});
    }
    await server.stop();
  }
}

async function waitForTermination(server, processLike = process) {
  let resolveSignal;
  const signal = new Promise(resolve => {
    resolveSignal = resolve;
  });
  const onSignal = name => resolveSignal({ kind: 'signal', name });
  const sigint = () => onSignal('SIGINT');
  const sigterm = () => onSignal('SIGTERM');
  processLike.once('SIGINT', sigint);
  processLike.once('SIGTERM', sigterm);
  try {
    const outcome = await Promise.race([
      signal,
      server.exited.then(result => ({ kind: 'exit', result }))
    ]);
    if (outcome.kind === 'exit') {
      fail(
        `Vite preview exited unexpectedly (code ${outcome.result.code}, ` +
        `signal ${outcome.result.signal ?? 'none'})`
      );
    }
  } finally {
    processLike.removeListener('SIGINT', sigint);
    processLike.removeListener('SIGTERM', sigterm);
    await server.stop();
  }
}

export function usage() {
  return `Render final compiled BattleMap V3 content through the production visual harness.

Usage:
  node scripts/battle-maps/render-v3-maps.mjs preview --map <project-relative-json> [--port <1024-65535>]
  node scripts/battle-maps/render-v3-maps.mjs screenshot --map <project-relative-json> [--output-dir <path>] [--port <port>] [--timeout <seconds>]
  node scripts/battle-maps/render-v3-maps.mjs gallery (--all-approved|--map <path>...) [--output-dir <path>] [--port <port>] [--timeout <seconds>]

Only final JSON under battle-maps/compiled/<theme>/ is accepted. Preview prints
the exact loopback harness URL and serves until SIGINT/SIGTERM; it never opens a
GUI. Gallery --all-approved is bounded to the tracked active release.`;
}

export async function main(
  argv = process.argv.slice(2),
  {
    projectRoot = SCRIPT_PROJECT_ROOT,
    stdout = process.stdout,
    launchHarness = launchViteHarness,
    browserFactory = defaultBrowserFactory,
    waitForTerminationImpl = waitForTermination
  } = {}
) {
  const options = parseRenderArgs(argv);
  if (options.help) {
    stdout.write(`${usage()}\n`);
    return Object.freeze({ ok: true, help: true });
  }
  const selection = await loadRenderSelection({
    projectRoot,
    maps: options.maps,
    allApproved: options.allApproved
  });
  if (options.mode === 'preview') {
    const record = selection[0];
    const { value: runtimeBundle } = await readSafeProjectJson(
      projectRoot,
      RUNTIME_BUNDLE_PATH,
      'frontend BattleMapV3 runtime bundle'
    );
    await verifyRuntimeBundleBinding(record.map, runtimeBundle);
    const server = await launchHarness({
      projectRoot,
      port: options.port,
      timeoutMs: options.timeoutMs
    });
    const url = buildHarnessUrl({
      projectRoot,
      mapPath: record.path,
      port: options.port
    });
    stdout.write(`${url}\n`);
    await waitForTerminationImpl(server);
    return Object.freeze({ ok: true, mode: options.mode, url });
  }
  const result = await renderScreenshots({
    projectRoot,
    selection,
    outputDirectory: options.outputDirectory,
    port: options.port,
    timeoutMs: options.timeoutMs,
    launchHarness,
    browserFactory,
    includeGallery: options.mode === 'gallery'
  });
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(error => {
    process.stderr.write(`BattleMapV3 render failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
