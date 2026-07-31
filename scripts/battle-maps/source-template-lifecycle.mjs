import { createHash, randomUUID } from 'node:crypto';
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import {
  withPersistentExclusiveLock
} from './persistent-exclusive-lock.mjs';

export const SIDECAR_SCHEMA_VERSION = 'battle-map-source-template-v1';
export const MANIFEST_SCHEMA_VERSION = 'battle-map-template-manifest-v1';
export const PROMPT_PROFILE_SCHEMA_VERSION = 'battle-map-source-prompt-profile-v1';
export const INVENTORY_SCHEMA_VERSION = 'battle-map-local-binary-inventory-v1';

const SCRIPT_PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const ALLOWED_IMAGE_FORMATS = new Set(['png', 'webp']);
const ALLOWED_STATUSES = new Set(['draft', 'staged', 'approved']);
const ALLOWED_TIERS = new Set([
  'tier-1',
  'tier-2',
  'tier-3',
  'tier-4',
  'tier-5'
]);
const ALLOWED_MODES = new Set(['pve', 'pvp']);

function fail(message, location = 'value') {
  throw new Error(`${location}: ${message}`);
}

function expectObject(value, location, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('must be an object', location);
  }
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`unknown key "${key}"`, location);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) fail(`missing required key "${key}"`, location);
  }
  return value;
}

function expectString(value, location, { nonempty = true, pattern, values } = {}) {
  if (typeof value !== 'string') fail('must be a string', location);
  if (nonempty && value.trim() === '') fail('must not be empty', location);
  if (pattern && !pattern.test(value)) fail(`has invalid value "${value}"`, location);
  if (values && !values.has(value)) fail(`has unsupported value "${value}"`, location);
  return value;
}

function expectBoolean(value, location) {
  if (typeof value !== 'boolean') fail('must be a boolean', location);
  return value;
}

function expectInteger(value, location, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail(`must be an integer from ${minimum} through ${maximum}`, location);
  }
  return value;
}

function expectNullableSha256(value, location) {
  if (value !== null) expectString(value, location, { pattern: SHA256_PATTERN });
}

function expectStringArray(value, location, { minimum = 1, exact, pattern, values } = {}) {
  if (!Array.isArray(value)) fail('must be an array', location);
  if (exact !== undefined && value.length !== exact) fail(`must contain exactly ${exact} items`, location);
  if (value.length < minimum) fail(`must contain at least ${minimum} item(s)`, location);
  value.forEach((entry, index) => expectString(entry, `${location}[${index}]`, { pattern, values }));
  if (new Set(value).size !== value.length) fail('must not contain duplicates', location);
}

function validatePromptProfileReference(value, location) {
  expectObject(value, location, ['id', 'path', 'sha256']);
  expectString(value.id, `${location}.id`, { pattern: ID_PATTERN });
  validateProjectRelativePath(value.path, `${location}.path`, { extension: '.json' });
  expectString(value.sha256, `${location}.sha256`, { pattern: SHA256_PATTERN });
}

function validateSourceImage(value, location) {
  if (value === null) return;
  expectObject(value, location, ['path', 'bytes', 'width', 'height', 'format', 'sha256']);
  validateProjectRelativePath(value.path, `${location}.path`);
  expectInteger(value.bytes, `${location}.bytes`, { minimum: 1 });
  expectInteger(value.width, `${location}.width`, { minimum: 1 });
  expectInteger(value.height, `${location}.height`, { minimum: 1 });
  expectString(value.format, `${location}.format`, { values: ALLOWED_IMAGE_FORMATS });
  expectString(value.sha256, `${location}.sha256`, { pattern: SHA256_PATTERN });
  if (path.posix.extname(value.path) !== `.${value.format}`) {
    fail('extension must match format', `${location}.path`);
  }
}

function validateMapProfile(value, location) {
  expectObject(value, location, [
    'width',
    'height',
    'orientation',
    'cameraFraming',
    'playerCapacity',
    'candidatePoolSize',
    'maxAssignableOpponents'
  ]);
  expectInteger(value.width, `${location}.width`, { minimum: 1, maximum: 256 });
  expectInteger(value.height, `${location}.height`, { minimum: 1, maximum: 256 });
  expectString(value.orientation, `${location}.orientation`);
  expectString(value.cameraFraming, `${location}.cameraFraming`);
  expectObject(value.playerCapacity, `${location}.playerCapacity`, ['minimum', 'maximum']);
  expectInteger(value.playerCapacity.minimum, `${location}.playerCapacity.minimum`, { minimum: 1 });
  expectInteger(value.playerCapacity.maximum, `${location}.playerCapacity.maximum`, {
    minimum: value.playerCapacity.minimum
  });
  expectInteger(value.candidatePoolSize, `${location}.candidatePoolSize`, { minimum: 1 });
  expectInteger(value.maxAssignableOpponents, `${location}.maxAssignableOpponents`, { minimum: 1 });
}

function validateStyleAuthority(value, location) {
  expectObject(value, location, ['kind', 'usage', 'literalTraceAllowed']);
  expectString(value.kind, `${location}.kind`);
  expectString(value.usage, `${location}.usage`);
  expectBoolean(value.literalTraceAllowed, `${location}.literalTraceAllowed`);
  if (value.literalTraceAllowed) fail('must be false', `${location}.literalTraceAllowed`);
}

function validateComposition(value, location) {
  expectObject(value, location, ['summary', 'visualHierarchy', 'focalAreas', 'negativeSpace', 'density']);
  expectString(value.summary, `${location}.summary`);
  expectStringArray(value.visualHierarchy, `${location}.visualHierarchy`);
  expectStringArray(value.focalAreas, `${location}.focalAreas`);
  expectStringArray(value.negativeSpace, `${location}.negativeSpace`);
  expectStringArray(value.density, `${location}.density`);
}

function validateTopologyIntent(value, location) {
  expectObject(value, location, ['coordinateAuthority', 'areas', 'relationships']);
  if (value.coordinateAuthority !== 'semantic-only') {
    fail('must be "semantic-only"', `${location}.coordinateAuthority`);
  }
  if (!Array.isArray(value.areas) || value.areas.length < 2) fail('must contain at least two areas', `${location}.areas`);
  value.areas.forEach((area, index) => {
    const areaLocation = `${location}.areas[${index}]`;
    expectObject(area, areaLocation, ['id', 'description', 'required']);
    expectString(area.id, `${areaLocation}.id`, { pattern: ID_PATTERN });
    expectString(area.description, `${areaLocation}.description`);
    expectBoolean(area.required, `${areaLocation}.required`);
  });
  if (!Array.isArray(value.relationships) || value.relationships.length < 1) {
    fail('must contain at least one relationship', `${location}.relationships`);
  }
  const areaIds = new Set(value.areas.map(area => area.id));
  if (areaIds.size !== value.areas.length) fail('area ids must be unique', `${location}.areas`);
  value.relationships.forEach((relationship, index) => {
    const relationLocation = `${location}.relationships[${index}]`;
    expectObject(relationship, relationLocation, ['from', 'to', 'kind', 'required']);
    expectString(relationship.from, `${relationLocation}.from`, { pattern: ID_PATTERN });
    expectString(relationship.to, `${relationLocation}.to`, { pattern: ID_PATTERN });
    expectString(relationship.kind, `${relationLocation}.kind`);
    expectBoolean(relationship.required, `${relationLocation}.required`);
    if (!areaIds.has(relationship.from) || !areaIds.has(relationship.to)) {
      fail('must reference declared areas', relationLocation);
    }
  });
}

function validateHeightIntent(value, location) {
  expectObject(value, location, ['levelCount', 'landforms', 'maxGradualSlope', 'connections']);
  expectObject(value.levelCount, `${location}.levelCount`, ['minimum', 'maximum']);
  expectInteger(value.levelCount.minimum, `${location}.levelCount.minimum`, { minimum: 1 });
  expectInteger(value.levelCount.maximum, `${location}.levelCount.maximum`, {
    minimum: value.levelCount.minimum
  });
  expectStringArray(value.landforms, `${location}.landforms`);
  expectInteger(value.maxGradualSlope, `${location}.maxGradualSlope`, { minimum: 0, maximum: 8 });
  expectStringArray(value.connections, `${location}.connections`);
}

function validateRouteIntent(value, location) {
  expectObject(value, location, [
    'primaryApproaches',
    'secondaryApproaches',
    'minimumApproachesPerFormation'
  ]);
  expectStringArray(value.primaryApproaches, `${location}.primaryApproaches`);
  expectStringArray(value.secondaryApproaches, `${location}.secondaryApproaches`);
  expectInteger(value.minimumApproachesPerFormation, `${location}.minimumApproachesPerFormation`, {
    minimum: 2
  });
}

function validateBoundaryIntent(value, location) {
  expectObject(value, location, ['owners', 'irregularPlayableSilhouette', 'description']);
  expectStringArray(value.owners, `${location}.owners`);
  expectBoolean(value.irregularPlayableSilhouette, `${location}.irregularPlayableSilhouette`);
  expectString(value.description, `${location}.description`);
}

function validateSpawnIntent(value, location) {
  expectObject(value, location, [
    'sides',
    'formationCharacter',
    'minimumApproaches',
    'localClearanceTiles',
    'candidateRoles',
    'forbiddenBehavior'
  ]);
  expectStringArray(value.sides, `${location}.sides`, { exact: 2 });
  expectString(value.formationCharacter, `${location}.formationCharacter`);
  expectInteger(value.minimumApproaches, `${location}.minimumApproaches`, { minimum: 2 });
  expectInteger(value.localClearanceTiles, `${location}.localClearanceTiles`, { minimum: 1 });
  expectStringArray(value.candidateRoles, `${location}.candidateRoles`);
  expectStringArray(value.forbiddenBehavior, `${location}.forbiddenBehavior`);
}

function validateAssetHints(value, location) {
  expectObject(value, location, ['surfaces', 'connections', 'obstacles', 'decorations']);
  expectStringArray(value.surfaces, `${location}.surfaces`);
  expectStringArray(value.connections, `${location}.connections`);
  expectStringArray(value.obstacles, `${location}.obstacles`);
  expectStringArray(value.decorations, `${location}.decorations`);
}

function validateReview(value, location) {
  if (value === null) return;
  expectObject(value, location, ['decision', 'reviewer']);
  if (value.decision !== 'approved') fail('must be "approved"', `${location}.decision`);
  expectString(value.reviewer, `${location}.reviewer`);
}

export function validateSourceTemplateSidecar(value) {
  expectObject(value, 'sidecar', [
    'schemaVersion',
    'id',
    'theme',
    'status',
    'tierEligibility',
    'supportedModes',
    'mapProfile',
    'sourceImage',
    'styleAuthority',
    'composition',
    'topologyIntent',
    'heightIntent',
    'routeIntent',
    'boundaryIntent',
    'spawnIntent',
    'requiredLandmarks',
    'forbiddenPatterns',
    'assetHints',
    'promptProfile',
    'candidateMaps',
    'pins',
    'review'
  ]);
  if (value.schemaVersion !== SIDECAR_SCHEMA_VERSION) fail('unsupported schema version', 'sidecar.schemaVersion');
  expectString(value.id, 'sidecar.id', { pattern: ID_PATTERN });
  expectString(value.theme, 'sidecar.theme', { pattern: ID_PATTERN });
  expectString(value.status, 'sidecar.status', { values: ALLOWED_STATUSES });
  expectStringArray(value.tierEligibility, 'sidecar.tierEligibility', { values: ALLOWED_TIERS });
  expectStringArray(value.supportedModes, 'sidecar.supportedModes', { values: ALLOWED_MODES });
  validateMapProfile(value.mapProfile, 'sidecar.mapProfile');
  validateSourceImage(value.sourceImage, 'sidecar.sourceImage');
  validateStyleAuthority(value.styleAuthority, 'sidecar.styleAuthority');
  validateComposition(value.composition, 'sidecar.composition');
  validateTopologyIntent(value.topologyIntent, 'sidecar.topologyIntent');
  validateHeightIntent(value.heightIntent, 'sidecar.heightIntent');
  validateRouteIntent(value.routeIntent, 'sidecar.routeIntent');
  validateBoundaryIntent(value.boundaryIntent, 'sidecar.boundaryIntent');
  validateSpawnIntent(value.spawnIntent, 'sidecar.spawnIntent');
  expectStringArray(value.requiredLandmarks, 'sidecar.requiredLandmarks');
  expectStringArray(value.forbiddenPatterns, 'sidecar.forbiddenPatterns');
  validateAssetHints(value.assetHints, 'sidecar.assetHints');
  validatePromptProfileReference(value.promptProfile, 'sidecar.promptProfile');
  expectStringArray(value.candidateMaps, 'sidecar.candidateMaps', { exact: 3, pattern: ID_PATTERN });
  expectObject(value.pins, 'sidecar.pins', [
    'sourceImageSha256',
    'promptProfileSha256',
    'approvedBlueprintSha256',
    'compilerSha256'
  ]);
  expectNullableSha256(value.pins.sourceImageSha256, 'sidecar.pins.sourceImageSha256');
  expectString(value.pins.promptProfileSha256, 'sidecar.pins.promptProfileSha256', {
    pattern: SHA256_PATTERN
  });
  expectNullableSha256(value.pins.approvedBlueprintSha256, 'sidecar.pins.approvedBlueprintSha256');
  expectNullableSha256(value.pins.compilerSha256, 'sidecar.pins.compilerSha256');
  validateReview(value.review, 'sidecar.review');

  if (value.promptProfile.sha256 !== value.pins.promptProfileSha256) {
    fail('must equal promptProfile.sha256', 'sidecar.pins.promptProfileSha256');
  }
  if (value.status === 'draft') {
    if (value.sourceImage !== null || value.pins.sourceImageSha256 !== null || value.review !== null) {
      fail('draft templates cannot contain source or review pins', 'sidecar.status');
    }
  } else {
    if (value.sourceImage === null) fail('staged and approved templates require sourceImage', 'sidecar.sourceImage');
    const canonicalSourcePath =
      `ai-image-metadata/battle-maps/sources/${value.theme}/${value.id}/reference.${value.sourceImage.format}`;
    if (value.sourceImage.path !== canonicalSourcePath) {
      fail(`must equal canonical source path "${canonicalSourcePath}"`, 'sidecar.sourceImage.path');
    }
    if (value.pins.sourceImageSha256 !== value.sourceImage.sha256) {
      fail('must equal sourceImage.sha256', 'sidecar.pins.sourceImageSha256');
    }
  }
  if (value.status === 'approved' && value.review === null) {
    fail('approved templates require review', 'sidecar.review');
  }
  if (value.status === 'approved' && value.pins.compilerSha256 === null) {
    fail(
      'approved templates require a compiler pin',
      'sidecar.pins.compilerSha256'
    );
  }
  if (value.status !== 'approved' && value.review !== null) {
    fail('only approved templates may contain review', 'sidecar.review');
  }
  return value;
}

function validateTemplateDefinition(value, location) {
  expectObject(value, location, [
    'id',
    'theme',
    'sidecarPath',
    'promptProfileId',
    'tierEligibility',
    'supportedModes',
    'mapProfile',
    'styleAuthority',
    'composition',
    'topologyIntent',
    'heightIntent',
    'routeIntent',
    'boundaryIntent',
    'spawnIntent',
    'requiredLandmarks',
    'forbiddenPatterns',
    'assetHints',
    'candidateMaps'
  ]);
  expectString(value.id, `${location}.id`, { pattern: ID_PATTERN });
  expectString(value.theme, `${location}.theme`, { pattern: ID_PATTERN });
  validateProjectRelativePath(value.sidecarPath, `${location}.sidecarPath`, { extension: '.json' });
  expectString(value.promptProfileId, `${location}.promptProfileId`, { pattern: ID_PATTERN });
  expectStringArray(value.tierEligibility, `${location}.tierEligibility`, { values: ALLOWED_TIERS });
  expectStringArray(value.supportedModes, `${location}.supportedModes`, { values: ALLOWED_MODES });
  validateMapProfile(value.mapProfile, `${location}.mapProfile`);
  validateStyleAuthority(value.styleAuthority, `${location}.styleAuthority`);
  validateComposition(value.composition, `${location}.composition`);
  validateTopologyIntent(value.topologyIntent, `${location}.topologyIntent`);
  validateHeightIntent(value.heightIntent, `${location}.heightIntent`);
  validateRouteIntent(value.routeIntent, `${location}.routeIntent`);
  validateBoundaryIntent(value.boundaryIntent, `${location}.boundaryIntent`);
  validateSpawnIntent(value.spawnIntent, `${location}.spawnIntent`);
  expectStringArray(value.requiredLandmarks, `${location}.requiredLandmarks`);
  expectStringArray(value.forbiddenPatterns, `${location}.forbiddenPatterns`);
  validateAssetHints(value.assetHints, `${location}.assetHints`);
  expectStringArray(value.candidateMaps, `${location}.candidateMaps`, { exact: 3, pattern: ID_PATTERN });
}

export function validateManifest(value) {
  expectObject(value, 'manifest', ['schemaVersion', 'releaseId', 'frozen', 'promptProfiles', 'templates']);
  if (value.schemaVersion !== MANIFEST_SCHEMA_VERSION) fail('unsupported schema version', 'manifest.schemaVersion');
  expectString(value.releaseId, 'manifest.releaseId', { pattern: ID_PATTERN });
  expectBoolean(value.frozen, 'manifest.frozen');
  if (!value.frozen) fail('must be true', 'manifest.frozen');
  if (!Array.isArray(value.promptProfiles) || value.promptProfiles.length < 1) {
    fail('must contain at least one prompt profile', 'manifest.promptProfiles');
  }
  value.promptProfiles.forEach((profile, index) => {
    const location = `manifest.promptProfiles[${index}]`;
    expectObject(profile, location, ['id', 'path']);
    expectString(profile.id, `${location}.id`, { pattern: ID_PATTERN });
    validateProjectRelativePath(profile.path, `${location}.path`, { extension: '.json' });
  });
  if (!Array.isArray(value.templates) || value.templates.length < 1) {
    fail('must contain at least one template', 'manifest.templates');
  }
  value.templates.forEach((template, index) => validateTemplateDefinition(template, `manifest.templates[${index}]`));
  if (new Set(value.promptProfiles.map(profile => profile.id)).size !== value.promptProfiles.length) {
    fail('prompt profile ids must be unique', 'manifest.promptProfiles');
  }
  if (new Set(value.templates.map(template => `${template.theme}/${template.id}`)).size !== value.templates.length) {
    fail('template identities must be unique', 'manifest.templates');
  }
  const promptIds = new Set(value.promptProfiles.map(profile => profile.id));
  for (const template of value.templates) {
    if (!promptIds.has(template.promptProfileId)) {
      fail(`unknown prompt profile "${template.promptProfileId}"`, `manifest template ${template.id}`);
    }
  }
  return value;
}

export function validatePromptProfile(value) {
  expectObject(value, 'promptProfile', [
    'schemaVersion',
    'id',
    'purpose',
    'frozen',
    'prompt',
    'negativeConstraints'
  ]);
  if (value.schemaVersion !== PROMPT_PROFILE_SCHEMA_VERSION) {
    fail('unsupported schema version', 'promptProfile.schemaVersion');
  }
  expectString(value.id, 'promptProfile.id', { pattern: ID_PATTERN });
  expectString(value.purpose, 'promptProfile.purpose');
  expectBoolean(value.frozen, 'promptProfile.frozen');
  if (!value.frozen) fail('must be true', 'promptProfile.frozen');
  expectString(value.prompt, 'promptProfile.prompt');
  expectStringArray(value.negativeConstraints, 'promptProfile.negativeConstraints');
  return value;
}

export function validateProjectRelativePath(candidate, location = 'path', { extension } = {}) {
  expectString(candidate, location);
  if (path.isAbsolute(candidate) || path.posix.isAbsolute(candidate) || path.win32.isAbsolute(candidate)) {
    fail('must be project-relative', location);
  }
  if (candidate.includes('\\')) fail('must use "/" separators', location);
  const segments = candidate.split('/');
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    fail('must not contain empty, "." or ".." segments', location);
  }
  if (path.posix.normalize(candidate) !== candidate) fail('must be normalized', location);
  if (extension && path.posix.extname(candidate) !== extension) fail(`must end in ${extension}`, location);
  return candidate;
}

export function resolveWithinProject(projectRoot, relativePath, location = 'path') {
  validateProjectRelativePath(relativePath, location);
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(root, ...relativePath.split('/'));
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    fail('escapes project root', location);
  }
  return resolved;
}

async function resolveExistingWithinProject(projectRoot, relativePath, location = 'path') {
  const lexicalPath = resolveWithinProject(projectRoot, relativePath, location);
  let current = path.resolve(projectRoot);
  for (const segment of relativePath.split('/')) {
    current = path.join(current, segment);
    const entry = await lstat(current);
    if (entry.isSymbolicLink()) {
      fail(`contains symbolic-link component "${segment}"`, location);
    }
  }
  const [physicalRoot, physicalPath] = await Promise.all([
    realpath(projectRoot),
    realpath(lexicalPath)
  ]);
  if (physicalPath === physicalRoot || !physicalPath.startsWith(`${physicalRoot}${path.sep}`)) {
    fail('resolves outside the project root', location);
  }
  return physicalPath;
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256Bytes(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function hashFile(filePath) {
  return sha256Bytes(await readFile(filePath));
}

async function readJson(filePath, label) {
  let contents;
  try {
    contents = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${label} does not exist: ${filePath}`);
    throw error;
  }
  try {
    return { value: JSON.parse(contents), contents };
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

export async function assertSafeWritePath(projectRoot, filePath, location = 'write path') {
  const root = path.resolve(projectRoot);
  const target = path.resolve(filePath);
  if (target === root || !target.startsWith(`${root}${path.sep}`)) {
    fail('escapes project root', location);
  }
  const relative = path.relative(root, target);
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) fail(`contains symbolic-link component "${segment}"`, location);
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
  }
  const physicalRoot = await realpath(root);
  let existingAncestor = path.dirname(target);
  while (true) {
    try {
      const physicalAncestor = await realpath(existingAncestor);
      if (
        physicalAncestor !== physicalRoot
        && !physicalAncestor.startsWith(`${physicalRoot}${path.sep}`)
      ) fail('resolves outside project root', location);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(existingAncestor);
      if (parent === existingAncestor) throw error;
      existingAncestor = parent;
    }
  }
}

async function atomicWrite(filePath, contents, projectRoot, {
  expectedContents
} = {}) {
  await assertSafeWritePath(projectRoot, filePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await assertSafeWritePath(projectRoot, filePath);
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, 'wx', 0o600);
  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await assertSafeWritePath(projectRoot, filePath);
  if (expectedContents !== undefined) {
    let actualContents;
    try {
      actualContents = await readFile(filePath, 'utf8');
    } catch (error) {
      await rm(temporaryPath, { force: true });
      if (error.code === 'ENOENT') {
        throw new Error('sidecar changed before conditional atomic write');
      }
      throw error;
    }
    if (actualContents !== expectedContents) {
      await rm(temporaryPath, { force: true });
      throw new Error('sidecar changed before conditional atomic write');
    }
    await assertSafeWritePath(projectRoot, filePath);
  }
  await rename(temporaryPath, filePath);
}

async function prepareAtomicCopy(
  sourcePath,
  destinationPath,
  expectedImage,
  projectRoot,
  {
    cleanupBackup = rm
  } = {}
) {
  await assertSafeWritePath(projectRoot, destinationPath);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await assertSafeWritePath(projectRoot, destinationPath);
  const temporaryPath = `${destinationPath}.${process.pid}.${randomUUID()}.tmp`;
  const backupPath = `${destinationPath}.${process.pid}.${randomUUID()}.backup`;
  let hadDestination = false;
  try {
    await copyFile(sourcePath, temporaryPath);
    const copiedImage = await inspectImage(temporaryPath);
    if (!sameImagePin(copiedImage, expectedImage)) {
      throw new Error('source changed while it was being staged');
    }
    try {
      await copyFile(destinationPath, backupPath);
      hadDestination = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await assertSafeWritePath(projectRoot, destinationPath);
    await rename(temporaryPath, destinationPath);
    return {
      async commit() {
        await cleanupBackup(backupPath, { force: true });
      },
      async rollback() {
        if (hadDestination) await rename(backupPath, destinationPath);
        else await rm(destinationPath, { force: true });
      }
    };
  } catch (error) {
    await Promise.all([
      rm(temporaryPath, { force: true }),
      rm(backupPath, { force: true })
    ]);
    throw error;
  }
}

async function withTemplateLock(projectRoot, theme, template, callback, {
  holderSource
} = {}) {
  templateIdentity(theme, template);
  const relativeLock =
    `ai-image-metadata/battle-maps/sources/${theme}/${template}/.lifecycle.lock`;
  const lockPath = resolveWithinProject(projectRoot, relativeLock, 'lifecycle lock path');
  return withPersistentExclusiveLock({
    lockPath,
    label: `template lifecycle lock ${theme}/${template}`,
    assertSafePath: () => (
      assertSafeWritePath(projectRoot, lockPath, 'lifecycle lock path')
    ),
    ...(holderSource === undefined ? {} : { holderSource })
  }, callback);
}

export async function withSourceTemplateLifecycleLock({
  projectRoot = SCRIPT_PROJECT_ROOT,
  theme,
  template
}, callback) {
  if (typeof callback !== 'function') {
    throw new Error('source-template lifecycle lock callback is required');
  }
  const root = path.resolve(projectRoot);
  return withTemplateLock(root, theme, template, callback);
}

function jsonContents(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sameImagePin(first, second) {
  return (
    first.bytes === second.bytes
    && first.width === second.width
    && first.height === second.height
    && first.format === second.format
    && first.sha256 === second.sha256
  );
}

export async function inspectImage(filePath) {
  const fileStats = await stat(filePath);
  if (!fileStats.isFile()) throw new Error(`image is not a regular file: ${filePath}`);
  let metadata;
  try {
    metadata = await sharp(filePath, { failOn: 'error', limitInputPixels: 268_435_456 }).metadata();
  } catch (error) {
    throw new Error(`invalid image ${filePath}: ${error.message}`);
  }
  if (!ALLOWED_IMAGE_FORMATS.has(metadata.format)) {
    throw new Error(`unsupported image format "${metadata.format ?? 'unknown'}"; expected PNG or WebP`);
  }
  if (!Number.isInteger(metadata.width) || !Number.isInteger(metadata.height)) {
    throw new Error(`image dimensions could not be read: ${filePath}`);
  }
  return {
    bytes: fileStats.size,
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    sha256: await hashFile(filePath)
  };
}

function templateIdentity(theme, template) {
  expectString(theme, 'theme', { pattern: ID_PATTERN });
  expectString(template, 'template', { pattern: ID_PATTERN });
  return { theme, template };
}

function manifestPath(projectRoot) {
  return path.join(projectRoot, 'ai-image-metadata/battle-maps/manifest.json');
}

export async function loadManifest(projectRoot = SCRIPT_PROJECT_ROOT) {
  const root = path.resolve(projectRoot);
  const { value } = await readJson(manifestPath(root), 'battle-map template manifest');
  return validateManifest(value);
}

export async function loadTemplatePrompt({
  projectRoot = SCRIPT_PROJECT_ROOT,
  theme,
  template
}) {
  const root = path.resolve(projectRoot);
  const manifest = await loadManifest(root);
  const definition = selectTemplate(manifest, theme, template);
  const { profile, reference } = await loadPinnedPromptProfile(root, manifest, definition);
  return {
    template: definition.id,
    theme: definition.theme,
    candidateDirectory:
      `ai-image-metadata/battle-maps/candidates/${definition.theme}/${definition.id}`,
    profile,
    reference
  };
}

function selectTemplate(manifest, theme, template) {
  templateIdentity(theme, template);
  const definition = manifest.templates.find(entry => entry.theme === theme && entry.id === template);
  if (!definition) throw new Error(`template is not declared in manifest: ${theme}/${template}`);
  return definition;
}

function selectPromptProfile(manifest, id) {
  const profile = manifest.promptProfiles.find(entry => entry.id === id);
  if (!profile) throw new Error(`prompt profile is not declared in manifest: ${id}`);
  return profile;
}

async function loadPinnedPromptProfile(projectRoot, manifest, definition) {
  const reference = selectPromptProfile(manifest, definition.promptProfileId);
  const absolutePath = resolveWithinProject(projectRoot, reference.path, 'prompt profile path');
  const { value, contents } = await readJson(absolutePath, 'source-template prompt profile');
  validatePromptProfile(value);
  if (value.id !== reference.id) throw new Error('prompt profile id does not match manifest');
  return {
    profile: value,
    reference: {
      id: reference.id,
      path: reference.path,
      sha256: sha256Bytes(Buffer.from(contents))
    }
  };
}

function renderDraftSidecar(definition, promptProfile) {
  return {
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    id: definition.id,
    theme: definition.theme,
    status: 'draft',
    tierEligibility: definition.tierEligibility,
    supportedModes: definition.supportedModes,
    mapProfile: definition.mapProfile,
    sourceImage: null,
    styleAuthority: definition.styleAuthority,
    composition: definition.composition,
    topologyIntent: definition.topologyIntent,
    heightIntent: definition.heightIntent,
    routeIntent: definition.routeIntent,
    boundaryIntent: definition.boundaryIntent,
    spawnIntent: definition.spawnIntent,
    requiredLandmarks: definition.requiredLandmarks,
    forbiddenPatterns: definition.forbiddenPatterns,
    assetHints: definition.assetHints,
    promptProfile,
    candidateMaps: definition.candidateMaps,
    pins: {
      sourceImageSha256: null,
      promptProfileSha256: promptProfile.sha256,
      approvedBlueprintSha256: null,
      compilerSha256: null
    },
    review: null
  };
}

function lifecycleProjection(sidecar) {
  return {
    ...sidecar,
    status: 'draft',
    sourceImage: null,
    pins: {
      ...sidecar.pins,
      sourceImageSha256: null,
      approvedBlueprintSha256: null,
      compilerSha256: null
    },
    review: null
  };
}

async function draftTemplateUnlocked({
  projectRoot = SCRIPT_PROJECT_ROOT,
  theme,
  template,
  check = false,
  force = false
}) {
  if (check && force) throw new Error('--check and --force are mutually exclusive');
  const root = path.resolve(projectRoot);
  const manifest = await loadManifest(root);
  const definition = selectTemplate(manifest, theme, template);
  const { reference } = await loadPinnedPromptProfile(root, manifest, definition);
  const draft = renderDraftSidecar(definition, reference);
  validateSourceTemplateSidecar(draft);
  const sidecarPath = resolveWithinProject(root, definition.sidecarPath, 'sidecar path');
  let existing;
  try {
    existing = (await readJson(sidecarPath, 'source-template sidecar')).value;
  } catch (error) {
    if (!error.message.includes('does not exist')) throw error;
  }
  if (existing !== undefined) {
    validateSourceTemplateSidecar(existing);
    if (existing.id !== template || existing.theme !== theme) {
      throw new Error('sidecar identity does not match requested template');
    }
    const expectedSemantic = stableJson(draft);
    const actualSemantic = stableJson(lifecycleProjection(existing));
    if (actualSemantic === expectedSemantic) {
      return {
        ok: true,
        changed: false,
        check,
        status: existing.status,
        sidecar: definition.sidecarPath
      };
    }
    if (check) throw new Error(`sidecar does not match deterministic manifest render: ${definition.sidecarPath}`);
    if (existing.status !== 'draft') {
      throw new Error(`refusing to reset ${existing.status} sidecar; create a new template identity instead`);
    }
    if (!force) throw new Error(`${definition.sidecarPath} differs; use --force to replace the draft`);
  } else if (check) {
    throw new Error(`sidecar does not exist: ${definition.sidecarPath}`);
  }
  await atomicWrite(sidecarPath, jsonContents(draft), root);
  return {
    ok: true,
    changed: true,
    check: false,
    status: 'draft',
    sidecar: definition.sidecarPath
  };
}

export async function draftTemplate(options) {
  if (options.check) return draftTemplateUnlocked(options);
  const root = path.resolve(options.projectRoot ?? SCRIPT_PROJECT_ROOT);
  return withTemplateLock(root, options.theme, options.template, () => (
    draftTemplateUnlocked({ ...options, projectRoot: root })
  ));
}

export async function loadTemplateSidecar({ projectRoot = SCRIPT_PROJECT_ROOT, theme, template }) {
  const root = path.resolve(projectRoot);
  const manifest = await loadManifest(root);
  const definition = selectTemplate(manifest, theme, template);
  const { reference } = await loadPinnedPromptProfile(root, manifest, definition);
  const sidecarPath = resolveWithinProject(root, definition.sidecarPath, 'sidecar path');
  const { value } = await readJson(sidecarPath, 'source-template sidecar');
  validateSourceTemplateSidecar(value);
  if (value.id !== template || value.theme !== theme) {
    throw new Error('sidecar identity does not match requested template');
  }
  if (
    value.promptProfile.id !== reference.id
    || value.promptProfile.path !== reference.path
    || value.promptProfile.sha256 !== reference.sha256
    || value.pins.promptProfileSha256 !== reference.sha256
  ) {
    throw new Error('prompt profile pin mismatch');
  }
  const expectedDraft = renderDraftSidecar(definition, reference);
  if (stableJson(lifecycleProjection(value)) !== stableJson(expectedDraft)) {
    throw new Error('source-template sidecar semantic content differs from the frozen manifest');
  }
  return { root, manifest, definition, sidecar: value, sidecarPath };
}

async function stageTemplateUnlocked({
  projectRoot = SCRIPT_PROJECT_ROOT,
  theme,
  template,
  source,
  force = false,
  beforeMetadataCommit,
  cleanupBackup
}) {
  const identity = templateIdentity(theme, template);
  validateProjectRelativePath(source, 'source');
  const loaded = await loadTemplateSidecar({ projectRoot, ...identity });
  if (loaded.sidecar.status === 'approved') {
    throw new Error('approved templates cannot be restaged; draft a new template identity');
  }
  const sourcePath = await resolveExistingWithinProject(loaded.root, source, 'source');
  const sourceImage = await inspectImage(sourcePath);
  const canonicalRelative = `ai-image-metadata/battle-maps/sources/${theme}/${template}/reference.${sourceImage.format}`;
  const canonicalPath = resolveWithinProject(loaded.root, canonicalRelative, 'canonical source path');
  const nextSourceImage = { path: canonicalRelative, ...sourceImage };
  const priorPin = loaded.sidecar.sourceImage;

  let canonicalImage = null;
  try {
    canonicalImage = await inspectImage(canonicalPath);
  } catch (error) {
    if (!error.message.includes('ENOENT')) {
      try {
        await stat(canonicalPath);
        throw error;
      } catch (statError) {
        if (statError.code !== 'ENOENT') throw error;
      }
    }
  }

  const pinChanged = priorPin !== null && !sameImagePin(priorPin, nextSourceImage);
  const canonicalChanged = canonicalImage !== null && !sameImagePin(canonicalImage, nextSourceImage);
  if ((pinChanged || canonicalChanged) && !force) {
    throw new Error('staged source differs from the pinned input; use --force to replace it');
  }

  const binaryAlreadyExact = canonicalImage !== null && sameImagePin(canonicalImage, nextSourceImage);
  const metadataAlreadyExact = (
    loaded.sidecar.status === 'staged'
    && priorPin !== null
    && priorPin.path === canonicalRelative
    && sameImagePin(priorPin, nextSourceImage)
    && loaded.sidecar.pins.sourceImageSha256 === nextSourceImage.sha256
    && loaded.sidecar.review === null
  );
  if (binaryAlreadyExact && metadataAlreadyExact) {
    return {
      ok: true,
      changed: false,
      status: 'staged',
      sourceImage: nextSourceImage
    };
  }

  let replacement = null;
  if (path.resolve(sourcePath) !== path.resolve(canonicalPath) && !binaryAlreadyExact) {
    replacement = await prepareAtomicCopy(
      sourcePath,
      canonicalPath,
      sourceImage,
      loaded.root,
      { cleanupBackup }
    );
  }
  const staged = {
    ...loaded.sidecar,
    status: 'staged',
    sourceImage: nextSourceImage,
    pins: {
      ...loaded.sidecar.pins,
      sourceImageSha256: nextSourceImage.sha256
    },
    review: null
  };
  validateSourceTemplateSidecar(staged);
  let metadataCommitted = false;
  try {
    if (beforeMetadataCommit) await beforeMetadataCommit();
    await atomicWrite(loaded.sidecarPath, jsonContents(staged), loaded.root);
    metadataCommitted = true;
    if (replacement) await replacement.commit();
  } catch (error) {
    if (replacement && !metadataCommitted) await replacement.rollback();
    throw error;
  }
  return {
    ok: true,
    changed: true,
    status: 'staged',
    sourceImage: nextSourceImage
  };
}

export async function stageTemplate(options) {
  const root = path.resolve(options.projectRoot ?? SCRIPT_PROJECT_ROOT);
  return withTemplateLock(root, options.theme, options.template, () => (
    stageTemplateUnlocked({ ...options, projectRoot: root })
  ));
}

async function currentCompilerFullHash(projectRoot) {
  const { computeCurrentCompilerSourceSet } = await import(
    './content-release-lifecycle.mjs'
  );
  return (
    await computeCurrentCompilerSourceSet({ projectRoot })
  ).fullHash;
}

async function assertCurrentCompilerFullHash(projectRoot, expectedFullHash, label) {
  const actualFullHash = await currentCompilerFullHash(projectRoot);
  if (actualFullHash !== expectedFullHash) {
    throw new Error(`${label} is not current; expected ${actualFullHash}`);
  }
  return actualFullHash;
}

async function pinTemplateCompilerUnlocked({
  projectRoot = SCRIPT_PROJECT_ROOT,
  theme,
  template,
  compilerFullHash,
  beforeMetadataCommit,
  afterMetadataCommit
}) {
  expectString(compilerFullHash, 'compilerFullHash', { pattern: SHA256_PATTERN });
  const loaded = await loadTemplateSidecar({ projectRoot, theme, template });
  if (loaded.sidecar.status === 'approved') {
    throw new Error(
      'approved template compiler pins are immutable; draft a new template identity'
    );
  }
  if (loaded.sidecar.status !== 'staged') {
    throw new Error('template must be staged before pinning its compiler');
  }
  await verifyPromptPin(loaded);
  await verifySourcePin(loaded);

  await assertCurrentCompilerFullHash(
    loaded.root,
    compilerFullHash,
    'supplied compiler fullHash'
  );

  const existingPin = loaded.sidecar.pins.compilerSha256;
  if (existingPin !== null && existingPin !== compilerFullHash) {
    throw new Error(
      'staged template already pins a different compiler; draft a new template identity'
    );
  }
  if (existingPin === compilerFullHash) {
    return {
      ok: true,
      changed: false,
      status: 'staged',
      compilerFullHash
    };
  }

  const pinned = {
    ...loaded.sidecar,
    pins: {
      ...loaded.sidecar.pins,
      compilerSha256: compilerFullHash
    }
  };
  validateSourceTemplateSidecar(pinned);
  const priorContents = jsonContents(loaded.sidecar);
  const pinnedContents = jsonContents(pinned);
  if (beforeMetadataCommit) await beforeMetadataCommit();
  await assertCurrentCompilerFullHash(
    loaded.root,
    compilerFullHash,
    'supplied compiler fullHash'
  );
  let committed = false;
  try {
    await atomicWrite(
      loaded.sidecarPath,
      pinnedContents,
      loaded.root,
      { expectedContents: priorContents }
    );
    committed = true;
    if (afterMetadataCommit) await afterMetadataCommit();
    const committedLoaded = { ...loaded, sidecar: pinned };
    await Promise.all([
      verifyPromptPin(committedLoaded),
      verifySourcePin(committedLoaded),
      assertCurrentCompilerFullHash(
        loaded.root,
        compilerFullHash,
        'committed compiler fullHash'
      )
    ]);
  } catch (error) {
    if (committed) {
      try {
        await atomicWrite(
          loaded.sidecarPath,
          priorContents,
          loaded.root,
          { expectedContents: pinnedContents }
        );
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'compiler pin validation failed and sidecar rollback failed'
        );
      }
    }
    throw error;
  }
  return {
    ok: true,
    changed: true,
    status: 'staged',
    compilerFullHash
  };
}

export async function pinTemplateCompiler(options) {
  const root = path.resolve(options.projectRoot ?? SCRIPT_PROJECT_ROOT);
  return withTemplateLock(root, options.theme, options.template, () => (
    pinTemplateCompilerUnlocked({ ...options, projectRoot: root })
  ));
}

async function verifyPromptPin(loaded) {
  const { reference } = await loadPinnedPromptProfile(loaded.root, loaded.manifest, loaded.definition);
  if (
    loaded.sidecar.promptProfile.id !== reference.id
    || loaded.sidecar.promptProfile.path !== reference.path
    || loaded.sidecar.promptProfile.sha256 !== reference.sha256
    || loaded.sidecar.pins.promptProfileSha256 !== reference.sha256
  ) {
    throw new Error('prompt profile pin mismatch');
  }
}

async function verifySourcePin(loaded) {
  const sourceImage = loaded.sidecar.sourceImage;
  if (sourceImage === null) throw new Error('template has no staged source image');
  const sourcePath = await resolveExistingWithinProject(
    loaded.root,
    sourceImage.path,
    'sourceImage.path'
  );
  const actual = await inspectImage(sourcePath);
  const confirmedSourcePath = await resolveExistingWithinProject(
    loaded.root,
    sourceImage.path,
    'sourceImage.path'
  );
  if (confirmedSourcePath !== sourcePath) {
    throw new Error('source image path changed while its pin was verified');
  }
  if (!sameImagePin(actual, sourceImage) || loaded.sidecar.pins.sourceImageSha256 !== actual.sha256) {
    throw new Error('source image pin mismatch');
  }
  return actual;
}

async function approveTemplateUnlocked({
  projectRoot = SCRIPT_PROJECT_ROOT,
  theme,
  template,
  reviewer,
  decision,
  force = false,
  afterMetadataCommit
}) {
  expectString(reviewer, 'reviewer');
  if (decision !== 'approved') throw new Error('decision must be explicitly supplied as "approved"');
  const loaded = await loadTemplateSidecar({ projectRoot, theme, template });
  if (loaded.sidecar.status === 'draft') throw new Error('template must be staged before approval');
  await verifyPromptPin(loaded);
  await verifySourcePin(loaded);
  if (loaded.sidecar.pins.compilerSha256 === null) {
    throw new Error('template compiler must be pinned before approval');
  }
  await assertCurrentCompilerFullHash(
    loaded.root,
    loaded.sidecar.pins.compilerSha256,
    'template compiler pin'
  );
  if (loaded.sidecar.status === 'approved') {
    if (
      loaded.sidecar.review?.reviewer === reviewer
      && loaded.sidecar.review?.decision === decision
    ) {
      return { ok: true, changed: false, status: 'approved', review: loaded.sidecar.review };
    }
    if (!force) throw new Error('template already has a different approval; use --force to replace the review');
  }
  const review = { decision: 'approved', reviewer };
  const approved = { ...loaded.sidecar, status: 'approved', review };
  validateSourceTemplateSidecar(approved);
  const priorContents = jsonContents(loaded.sidecar);
  const approvedContents = jsonContents(approved);
  await atomicWrite(
    loaded.sidecarPath,
    approvedContents,
    loaded.root,
    { expectedContents: priorContents }
  );
  try {
    if (afterMetadataCommit) await afterMetadataCommit();
    const approvedLoaded = { ...loaded, sidecar: approved };
    await Promise.all([
      verifyPromptPin(approvedLoaded),
      verifySourcePin(approvedLoaded),
      assertCurrentCompilerFullHash(
        loaded.root,
        loaded.sidecar.pins.compilerSha256,
        'approved compiler pin'
      )
    ]);
  } catch (error) {
    try {
      await atomicWrite(
        loaded.sidecarPath,
        priorContents,
        loaded.root,
        { expectedContents: approvedContents }
      );
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        'approval validation failed and sidecar rollback failed'
      );
    }
    throw error;
  }
  return { ok: true, changed: true, status: 'approved', review };
}

export async function approveTemplate(options) {
  const root = path.resolve(options.projectRoot ?? SCRIPT_PROJECT_ROOT);
  return withTemplateLock(root, options.theme, options.template, () => (
    approveTemplateUnlocked({ ...options, projectRoot: root })
  ));
}

export async function inventoryTemplates({ projectRoot = SCRIPT_PROJECT_ROOT } = {}) {
  const root = path.resolve(projectRoot);
  const manifest = await loadManifest(root);
  const templates = [];
  const assets = [];
  const pinnedPaths = new Set();
  let ok = true;
  for (const definition of [...manifest.templates].sort((left, right) => (
    `${left.theme}/${left.id}`.localeCompare(`${right.theme}/${right.id}`)
  ))) {
    try {
      const loaded = await loadTemplateSidecar({
        projectRoot: root,
        theme: definition.theme,
        template: definition.id
      });
      const entry = {
        id: definition.id,
        theme: definition.theme,
        status: loaded.sidecar.status,
        sourceImage: loaded.sidecar.sourceImage?.path ?? null,
        error: null
      };
      templates.push(entry);
      if (loaded.sidecar.sourceImage === null) continue;
      const pinned = loaded.sidecar.sourceImage;
      pinnedPaths.add(pinned.path);
      const lexicalPath = resolveWithinProject(root, pinned.path, 'sourceImage.path');
      let present = false;
      let matchesPin = false;
      let error = null;
      let actual = null;
      try {
        const entryStat = await lstat(lexicalPath);
        present = entryStat.isFile() || entryStat.isSymbolicLink();
        actual = await inspectImage(await resolveExistingWithinProject(
          root,
          pinned.path,
          'sourceImage.path'
        ));
        matchesPin = sameImagePin(actual, pinned);
        if (!matchesPin) error = 'source image pin mismatch';
      } catch (verificationError) {
        if (verificationError.code !== 'ENOENT') error = verificationError.message;
      }
      if (!matchesPin) ok = false;
      assets.push({
        kind: 'source-template-reference',
        template: definition.id,
        theme: definition.theme,
        path: pinned.path,
        bytes: pinned.bytes,
        width: pinned.width,
        height: pinned.height,
        format: pinned.format,
        sha256: pinned.sha256,
        present,
        matchesPin,
        actual,
        error: matchesPin
          ? null
          : (error ?? (present ? 'source image pin mismatch' : 'source image is missing'))
      });
    } catch (templateError) {
      ok = false;
      templates.push({
        id: definition.id,
        theme: definition.theme,
        status: null,
        sourceImage: null,
        error: templateError.message
      });
    }
  }
  const orphans = [];
  const sourcesRoot = path.join(root, 'ai-image-metadata/battle-maps/sources');
  async function scanSources(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
      const entryStat = await lstat(absolutePath);
      if (entryStat.isSymbolicLink()) {
        ok = false;
        orphans.push({ path: relativePath, error: 'symbolic links are forbidden in source storage' });
      } else if (entry.isDirectory()) {
        await scanSources(absolutePath);
      } else if (
        entry.isFile()
        && ['.png', '.webp'].includes(path.extname(entry.name).toLowerCase())
        && !pinnedPaths.has(relativePath)
      ) {
        try {
          orphans.push({ path: relativePath, ...(await inspectImage(absolutePath)), error: null });
        } catch (error) {
          orphans.push({ path: relativePath, error: error.message });
        }
        ok = false;
      }
    }
  }
  await scanSources(sourcesRoot);
  return {
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    ok,
    templates,
    assets,
    orphans
  };
}

export function defaultProjectRoot() {
  return SCRIPT_PROJECT_ROOT;
}
