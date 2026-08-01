#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BATTLE_MAP_V3_CATALOG_SCHEMA_VERSION,
  BATTLE_MAP_V3_SELECTOR_VERSION,
  TEMPLATE_MAP_COMPILER_VERSION,
  assertBattleMapV3CatalogMapPins,
  assertTemplateMapBlueprint,
  compileTemplateMapBlueprint,
  computeTemplateMapAssetBundleManifestFullHash,
  computeTemplateMapBlueprintFullHash,
  computeTemplateMapSourceSidecarFullHash,
  computeTemplateMapTileCatalogFullHash,
  finalizeBattleMapV3,
  finalizeBattleMapV3CatalogRelease,
  normalizeBattleMapV3CatalogRelease,
  normalizeBattleMapV3Final,
  assignBattleMapV3Spawns,
  calculateTraversalPathCost,
  createBattleMapV3TraversalView,
  getReachableTilesForTraversal
} from '../../shared/battleMap/v3/index.js';
import {
  canonicalizeJson,
  parseJsonRejectDuplicateKeys
} from '../../shared/battleMap/canonicalJson.js';
import {
  BATTLE_MAP_V3_SUPPORTED_THEMES
} from '../../shared/battleMap/BattleMapV3Resolvers.js';
import {
  BATTLE_MAP_V3_ECOLOGY_PROFILES_BY_THEME
} from '../../shared/battleMap/BattleMapV3EcologyProfiles.js';
import {
  createBattleMapV3SelectionQuery,
  selectBattleMapV3CatalogEntry
} from '../../shared/battleMap/BattleMapV3Selector.js';
import {
  BUNDLE_REGISTRY_PATH,
  buildBundle as buildBattleArtBundle,
  buildBundleRegistry as buildBattleArtBundleRegistry,
  checkBattleArt,
  computeBattleArtRendererManifestFullHash,
  loadBattleArt,
  resolveArchivedRuntimeBundle,
  toCompilerAssetBundle
} from '../battle-art/lifecycle.mjs';
import { inspectImage } from './source-template-lifecycle.mjs';
import {
  usesBlueprintV2SemanticContract,
  validateV2BlueprintSemanticContract
} from './blueprint-v2-semantic-contract.mjs';

export const COMPILE_RECIPE_SCHEMA = 'battle-map-v3-compile-recipe-v1';
export const MAP_VISUAL_APPROVAL_SCHEMA = 'battle-map-v3-visual-approval-v1';
export const CATALOG_DEFINITION_SCHEMA = 'battle-map-v3-catalog-definition-v1';
export const ACTIVE_RELEASE_SCHEMA = 'battle-map-v3-active-release-pin-v1';
export const COMPILER_SOURCE_SET_DOMAIN = 'modia:battle-map-v3:compiler-source-set:v1';
export const VALIDATOR_SOURCE_SET_DOMAIN = 'modia:battle-map-v3:validator-source-set:v1';
export const RENDER_PROFILE_HASH_DOMAIN = 'modia:battle-map-v3:render-profile:v1';
export const MAP_APPROVAL_CHECKLIST_VERSION = 1;
export const COMPILER_SOURCE_FILES = Object.freeze([
  'shared/battleMap/canonicalJson.js',
  'shared/battleMap/v3/blueprint.js',
  'shared/battleMap/v3/compiler.js',
  'shared/battleMap/v3/hashes.js',
  'shared/battleMap/v3/schema.js',
  'shared/battleMap/v3/traversalView.js',
  'shared/battleMap/v3/validation.js',
  'shared/mapgen/v1/obstacles.js',
  'shared/mapgen/v1/terrain.js',
  'shared/obstacles.js',
  'shared/terrain.js',
  'shared/traversal.js'
]);
export const VALIDATOR_SOURCE_FILES = Object.freeze([
  'package-lock.json',
  'scripts/battle-art/candidate-lock.mjs',
  'scripts/battle-art/lifecycle.mjs',
  'scripts/battle-art/raster-contract.mjs',
  'scripts/battle-maps/blueprint-v2-semantic-contract.mjs',
  'scripts/battle-maps/content-release-lifecycle.mjs',
  'scripts/battle-maps/persistent-exclusive-lock.mjs',
  'scripts/battle-maps/source-template-lifecycle.mjs',
  'shared/battleMap/BattleMapV3EcologyProfiles.js',
  'shared/battleMap/BattleMapV3Resolvers.js',
  'shared/battleMap/BattleMapV3Selector.js',
  'shared/battleMap/canonicalJson.js',
  'shared/battleMap/v3/blueprint.js',
  'shared/battleMap/v3/catalog.js',
  'shared/battleMap/v3/compiler.js',
  'shared/battleMap/v3/hashes.js',
  'shared/battleMap/v3/index.js',
  'shared/battleMap/v3/schema.js',
  'shared/battleMap/v3/spawnMatcher.js',
  'shared/battleMap/v3/traversalView.js',
  'shared/battleMap/v3/validation.js',
  'shared/mapgen/v1/obstacles.js',
  'shared/mapgen/v1/terrain.js',
  'shared/obstacles.js',
  'shared/terrain.js',
  'shared/traversal.js'
]);
const BLUEPRINT_PROMPT_PATH_V1 =
  'ai-image-metadata/battle-maps/prompts/map-blueprint-v1.json';
const BLUEPRINT_PROMPT_PATH_V2 =
  'ai-image-metadata/battle-maps/prompts/map-blueprint-v2.json';
const ART_BUNDLE_PATH =
  'ai-image-metadata/battle-art/runtime-asset-bundle.json';
const FRONTEND_ART_BUNDLE_MIRROR_PATH =
  'frontend/src/generated/battleMapV3RuntimeBundle.json';
const LEGACY_BLUEPRINT_APPROVAL_TEMPLATE_PATTERN = /-template-(?:01|02)$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;
const MAX_BLUEPRINT_APPROVAL_REASON_BYTES = 1000;

const SCRIPT_PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const SAFE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._:/-]{0,127})$/;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MAX_JSON_BYTES = 64 * 1024 * 1024;
const THEME_SET = new Set(BATTLE_MAP_V3_SUPPORTED_THEMES);
const BINARY_MODES = new Set(['require', 'metadata']);
const PVE_THEMES = BATTLE_MAP_V3_SUPPORTED_THEMES.filter(
  theme => theme !== 'arena' && theme !== 'guild'
);
const MAP_RENDERER_CATEGORIES = Object.freeze({
  surface: 'surface',
  obstacle: 'blocking-obstacle',
  decoration: 'nonblocking-decoration',
  boundary: 'exposed-face-boundary',
  route: 'route-transition'
});

const RECIPE_KEYS = Object.freeze([
  'schemaVersion',
  'theme',
  'templateId',
  'sourceSidecar',
  'blueprintApprovalIndex',
  'renderProfile',
  'tileCatalog',
  'assetBundle',
  'compiler',
  'validator',
  'maps'
]);
const JSON_PIN_KEYS = Object.freeze(['path', 'fullHash']);
const ASSET_PIN_KEYS = Object.freeze(['path', 'manifestFullHash']);
const SOURCE_SET_KEYS = Object.freeze(['id', 'version', 'fullHash', 'sourceFiles']);
const SOURCE_FILE_KEYS = Object.freeze(['path', 'sha256']);
const RECIPE_MAP_KEYS = Object.freeze([
  'blueprintId',
  'contentId',
  'contentVersion',
  'templateRevision'
]);
const CATALOG_DEFINITION_KEYS = Object.freeze([
  'schemaVersion',
  'catalogReleaseId',
  'entries',
  'coverageQueries'
]);
const DEFINITION_ENTRY_KEYS = Object.freeze([
  'id',
  'mapPath',
  'approvalPath',
  'approvalFileSha256',
  'orientation',
  'teamLayout',
  'weight',
  'bossCapable',
  'competitiveParity'
]);
const COVERAGE_QUERY_KEYS = Object.freeze([
  'id',
  'theme',
  'ecologyProfile',
  'sourceTier',
  'selectionBand',
  'mode',
  'dimensions',
  'teamLayout',
  'playerCounts',
  'opponentCounts',
  'requireBossCapable',
  'requireCompetitiveParity'
]);
const APPROVAL_KEYS = Object.freeze([
  'schemaVersion',
  'decision',
  'reviewer',
  'checklistVersion',
  'theme',
  'templateId',
  'contentId',
  'contentVersion',
  'mapPath',
  'hashes',
  'sourceSidecar',
  'blueprint',
  'renderProfile',
  'tileCatalog',
  'assetBundle',
  'capabilityReport',
  'screenshot'
]);

function fail(message, code = 'BATTLE_MAP_V3_CONTENT_RELEASE_ERROR') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys, label) {
  if (!isPlainObject(value)) fail(`${label} must be a plain object`);
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) fail(`${label}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail(`${label}.${key} is not allowed`);
  }
  return value;
}

function safeId(value, label) {
  if (typeof value !== 'string' || !SAFE_ID_PATTERN.test(value)) {
    fail(`${label} must be a lowercase safe identifier`);
  }
  return value;
}

function supportedTheme(value, label) {
  safeId(value, label);
  if (!THEME_SET.has(value)) fail(`${label} is not a supported BattleMapV3 theme`);
  return value;
}

function sha256Pin(value, label) {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    fail(`${label} must be a lowercase sha256 pin`);
  }
  return value;
}

function blueprintApprovalSchemas(templateId) {
  const legacy = LEGACY_BLUEPRINT_APPROVAL_TEMPLATE_PATTERN.test(templateId);
  return legacy
    ? {
        index: 'battle-map-blueprint-approval-index-v1',
        record: 'battle-map-blueprint-approval-v1',
        v2: false
      }
    : {
        index: 'battle-map-blueprint-approval-index-v2',
        record: 'battle-map-blueprint-approval-v2',
        v2: true
      };
}

function blueprintPromptProfile(templateId) {
  const legacy = LEGACY_BLUEPRINT_APPROVAL_TEMPLATE_PATTERN.test(templateId);
  return legacy
    ? {
        id: 'map-blueprint-v1',
        path: BLUEPRINT_PROMPT_PATH_V1,
        schema: 'battle-map-blueprint-prompt-profile-v1'
      }
    : {
        id: 'map-blueprint-v2',
        path: BLUEPRINT_PROMPT_PATH_V2,
        schema: 'battle-map-blueprint-prompt-profile-v2'
      };
}

function approvalReason(value, label) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value !== value.trim()
    || CONTROL_CHARACTER_PATTERN.test(value)
    || Buffer.byteLength(value, 'utf8') > MAX_BLUEPRINT_APPROVAL_REASON_BYTES
  ) {
    fail(
      `${label} must be a non-empty, trimmed, control-free rationale of at most `
        + `${MAX_BLUEPRINT_APPROVAL_REASON_BYTES} UTF-8 bytes`
    );
  }
  return value;
}

function positiveInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    fail(`${label} must be an integer from 1 through ${maximum}`);
  }
  return value;
}

function boolean(value, label) {
  if (typeof value !== 'boolean') fail(`${label} must be a boolean`);
  return value;
}

function stableSha256(value, domain = null) {
  const hash = createHash('sha256');
  if (domain !== null) {
    hash.update(domain);
    hash.update(Buffer.from([0]));
  }
  hash.update(canonicalizeJson(value));
  return `sha256:${hash.digest('hex')}`;
}

function bytesSha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function trackedPath(value, label) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 512
    || path.posix.isAbsolute(value)
    || value.includes('\\')
    || value.includes('\0')
    || value.includes('?')
    || value.includes('#')
  ) fail(`${label} must be a root-relative tracked path`);
  const segments = value.split('/');
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
  })) fail(`${label} contains an empty, encoded, or traversal segment`);
  return value;
}

function resolveTracked(projectRoot, relativePath, label) {
  trackedPath(relativePath, label);
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(root, ...relativePath.split('/'));
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    fail(`${label} escapes the project root`);
  }
  return resolved;
}

async function assertNoSymlinkPath(projectRoot, relativePath, {
  allowMissingLeaf = false,
  label = 'tracked path'
} = {}) {
  const absolute = resolveTracked(projectRoot, relativePath, label);
  const segments = relativePath.split('/');
  let cursor = path.resolve(projectRoot);
  for (let index = 0; index < segments.length; index += 1) {
    cursor = path.join(cursor, segments[index]);
    let details;
    try {
      details = await lstat(cursor);
    } catch (error) {
      if (
        error.code === 'ENOENT'
        && allowMissingLeaf
        && index === segments.length - 1
      ) return absolute;
      throw error;
    }
    if (details.isSymbolicLink()) fail(`${label} contains forbidden symlink ${relativePath}`);
    if (index < segments.length - 1 && !details.isDirectory()) {
      fail(`${label} has a non-directory parent component`);
    }
  }
  return absolute;
}

async function readTrackedBytes(projectRoot, relativePath, label, {
  maxBytes = MAX_JSON_BYTES
} = {}) {
  const absolute = await assertNoSymlinkPath(projectRoot, relativePath, { label });
  let handle;
  try {
    handle = await open(
      absolute,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
    );
    const details = await handle.stat();
    if (!details.isFile()) fail(`${label} must be a regular file`);
    if (details.size < 1 || details.size > maxBytes) {
      fail(`${label} byte size must be 1..${maxBytes}`);
    }
    const [physicalRoot, physicalPath] = await Promise.all([
      realpath(path.resolve(projectRoot)),
      realpath(absolute)
    ]);
    const expectedPhysical = path.join(physicalRoot, ...relativePath.split('/'));
    if (physicalPath !== expectedPhysical) {
      fail(`${label} resolves through a forbidden symlink`);
    }
    return await handle.readFile();
  } finally {
    await handle?.close();
  }
}

async function readTrackedJson(projectRoot, relativePath, label) {
  const bytes = await readTrackedBytes(projectRoot, relativePath, label);
  let source;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    fail(`${label} is not UTF-8: ${error.message}`);
  }
  let value;
  try {
    value = parseJsonRejectDuplicateKeys(source);
  } catch (error) {
    fail(`${label} is not strict JSON: ${error.message}`);
  }
  return { value, bytes };
}

async function ensureSafeParent(projectRoot, relativePath, label) {
  const absolute = resolveTracked(projectRoot, relativePath, label);
  const parentRelative = path.posix.dirname(relativePath);
  if (parentRelative !== '.') {
    const segments = parentRelative.split('/');
    let cursor = path.resolve(projectRoot);
    for (const segment of segments) {
      cursor = path.join(cursor, segment);
      try {
        const details = await lstat(cursor);
        if (details.isSymbolicLink()) fail(`${label} parent contains a forbidden symlink`);
        if (!details.isDirectory()) fail(`${label} parent is not a directory`);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        try {
          await mkdir(cursor);
        } catch (mkdirError) {
          if (mkdirError.code !== 'EEXIST') throw mkdirError;
          const details = await lstat(cursor);
          if (details.isSymbolicLink() || !details.isDirectory()) {
            fail(`${label} concurrently created an unsafe parent component`);
          }
        }
      }
    }
  }
  try {
    const details = await lstat(absolute);
    if (details.isSymbolicLink()) fail(`${label} is a forbidden symlink`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return absolute;
}

async function atomicWrite(projectRoot, relativePath, bytes, {
  immutable = false,
  checkOnly = false,
  label = 'tracked output'
} = {}) {
  if (checkOnly) {
    let existing;
    try {
      existing = await readTrackedBytes(projectRoot, relativePath, label);
    } catch (error) {
      if (error.code === 'ENOENT') {
        fail(`${label} does not exist`, 'MISSING_BATTLE_MAP_V3_CONTENT');
      }
      throw error;
    }
    if (Buffer.compare(existing, bytes) !== 0) {
      fail(`${label} is stale`, 'STALE_BATTLE_MAP_V3_CONTENT');
    }
    return { path: relativePath, changed: false };
  }
  const absolute = await ensureSafeParent(projectRoot, relativePath, label);
  try {
    const existing = await readTrackedBytes(projectRoot, relativePath, label);
    if (Buffer.compare(existing, bytes) === 0) {
      return { path: relativePath, changed: false };
    }
    if (immutable) fail(`${label} already exists with different bytes`, 'IMMUTABLE_CONTENT_CONFLICT');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temporary = `${absolute}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    if (immutable) {
      try {
        await link(temporary, absolute);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = await readTrackedBytes(projectRoot, relativePath, label);
        if (Buffer.compare(existing, bytes) === 0) {
          return { path: relativePath, changed: false };
        }
        fail(`${label} concurrently published different immutable bytes`, 'IMMUTABLE_CONTENT_CONFLICT');
      }
      return { path: relativePath, changed: true };
    }
    await assertNoSymlinkPath(projectRoot, relativePath, {
      allowMissingLeaf: true,
      label
    });
    await rename(temporary, absolute);
    return { path: relativePath, changed: true };
  } finally {
    await handle?.close();
    try {
      await unlink(temporary);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function compileRecipePath(theme, templateId) {
  return `battle-maps/compile-recipes/${theme}/${templateId}.json`;
}

function compiledMapPath(theme, contentId, contentVersion) {
  return `battle-maps/compiled/${theme}/${contentId}.v${contentVersion}.json`;
}

function visualApprovalPath(theme, contentId, contentVersion) {
  return `battle-maps/approvals/${theme}/${contentId}.v${contentVersion}.json`;
}

function releaseDefinitionPath(releaseId) {
  return `battle-maps/catalog/definitions/${releaseId}.json`;
}

function catalogReleasePath(releaseId) {
  return `battle-maps/catalog/releases/${releaseId}.json`;
}

export function computeSourceSetFullHash(identity, domain) {
  exactObject(identity, SOURCE_SET_KEYS, 'source set');
  const projection = {
    id: identity.id,
    version: identity.version,
    sourceFiles: identity.sourceFiles
  };
  return stableSha256(projection, domain);
}

export async function computeCurrentCompilerSourceSet({
  projectRoot = SCRIPT_PROJECT_ROOT
} = {}) {
  const root = path.resolve(projectRoot);
  const sourceFiles = [];
  for (const relativePath of COMPILER_SOURCE_FILES) {
    const bytes = await readTrackedBytes(
      root,
      relativePath,
      `current compiler source file ${relativePath}`
    );
    sourceFiles.push({
      path: relativePath,
      sha256: bytesSha256(bytes)
    });
  }
  const sourceSet = {
    id: 'template-map-compiler',
    version: TEMPLATE_MAP_COMPILER_VERSION,
    fullHash: '',
    sourceFiles
  };
  sourceSet.fullHash = computeSourceSetFullHash(
    sourceSet,
    COMPILER_SOURCE_SET_DOMAIN
  );
  await validateSourceSet(
    root,
    sourceSet,
    'current compiler source set',
    COMPILER_SOURCE_SET_DOMAIN,
    COMPILER_SOURCE_FILES
  );
  return sourceSet;
}

async function validateSourceSet(projectRoot, value, label, domain, expectedPaths) {
  exactObject(value, SOURCE_SET_KEYS, label);
  safeId(value.id, `${label}.id`);
  positiveInteger(value.version, `${label}.version`);
  sha256Pin(value.fullHash, `${label}.fullHash`);
  if (!Array.isArray(value.sourceFiles) || value.sourceFiles.length === 0) {
    fail(`${label}.sourceFiles must be a non-empty array`);
  }
  if (
    canonicalizeJson(value.sourceFiles.map(record => record?.path))
      !== canonicalizeJson(expectedPaths)
  ) fail(`${label}.sourceFiles must equal the complete project-owned source set`);
  let prior = null;
  for (let index = 0; index < value.sourceFiles.length; index += 1) {
    const record = value.sourceFiles[index];
    const itemLabel = `${label}.sourceFiles[${index}]`;
    exactObject(record, SOURCE_FILE_KEYS, itemLabel);
    trackedPath(record.path, `${itemLabel}.path`);
    sha256Pin(record.sha256, `${itemLabel}.sha256`);
    if (prior !== null && prior >= record.path) {
      fail(`${label}.sourceFiles must be strictly ordered by path`);
    }
    prior = record.path;
    const bytes = await readTrackedBytes(projectRoot, record.path, `${itemLabel}.path`);
    if (bytesSha256(bytes) !== record.sha256) fail(`${itemLabel} file hash mismatch`);
  }
  if (computeSourceSetFullHash(value, domain) !== value.fullHash) {
    fail(`${label}.fullHash does not match its exact source-file projection`);
  }
  return value;
}

function validateJsonPin(value, label) {
  exactObject(value, JSON_PIN_KEYS, label);
  trackedPath(value.path, `${label}.path`);
  sha256Pin(value.fullHash, `${label}.fullHash`);
}

function validateAssetPin(value, label) {
  exactObject(value, ASSET_PIN_KEYS, label);
  trackedPath(value.path, `${label}.path`);
  sha256Pin(value.manifestFullHash, `${label}.manifestFullHash`);
}

function validateRecipeShape(recipe, theme, templateId) {
  exactObject(recipe, RECIPE_KEYS, 'compile recipe');
  if (recipe.schemaVersion !== COMPILE_RECIPE_SCHEMA) {
    fail(`compile recipe.schemaVersion must equal ${COMPILE_RECIPE_SCHEMA}`);
  }
  supportedTheme(recipe.theme, 'compile recipe.theme');
  safeId(recipe.templateId, 'compile recipe.templateId');
  if (recipe.theme !== theme || recipe.templateId !== templateId) {
    fail('compile recipe identity does not match its fixed path');
  }
  validateJsonPin(recipe.sourceSidecar, 'compile recipe.sourceSidecar');
  validateJsonPin(recipe.blueprintApprovalIndex, 'compile recipe.blueprintApprovalIndex');
  validateJsonPin(recipe.renderProfile, 'compile recipe.renderProfile');
  validateJsonPin(recipe.tileCatalog, 'compile recipe.tileCatalog');
  validateAssetPin(recipe.assetBundle, 'compile recipe.assetBundle');
  const expectedTemplateRoot =
    `ai-image-metadata/battle-maps/templates/${theme}/${templateId}.json`;
  const expectedApprovalIndex =
    `ai-image-metadata/battle-maps/blueprints/${theme}/${templateId}/approvals.json`;
  if (recipe.sourceSidecar.path !== expectedTemplateRoot) {
    fail('compile recipe.sourceSidecar.path is not the fixed template path');
  }
  if (recipe.blueprintApprovalIndex.path !== expectedApprovalIndex) {
    fail('compile recipe.blueprintApprovalIndex.path is not the fixed approval-index path');
  }
  if (recipe.assetBundle.path !== ART_BUNDLE_PATH) {
    fail('compile recipe.assetBundle.path is not the deployed runtime bundle path');
  }
  if (!Array.isArray(recipe.maps) || recipe.maps.length !== 3) {
    fail('compile recipe.maps must contain exactly three approved variants');
  }
  const ids = new Set();
  let prior = null;
  recipe.maps.forEach((record, index) => {
    const label = `compile recipe.maps[${index}]`;
    exactObject(record, RECIPE_MAP_KEYS, label);
    safeId(record.blueprintId, `${label}.blueprintId`);
    safeId(record.contentId, `${label}.contentId`);
    positiveInteger(record.contentVersion, `${label}.contentVersion`);
    positiveInteger(record.templateRevision, `${label}.templateRevision`);
    if (ids.has(record.blueprintId)) fail(`${label}.blueprintId is duplicated`);
    ids.add(record.blueprintId);
    if (prior !== null && prior >= record.blueprintId) {
      fail('compile recipe.maps must be strictly ordered by blueprintId');
    }
    prior = record.blueprintId;
  });
  return recipe;
}

function validateApprovalIndex(index, { theme, templateId, expectedPath, expectedHash }) {
  const schemas = blueprintApprovalSchemas(templateId);
  exactObject(
    index,
    ['schemaVersion', 'theme', 'templateId', 'entries', 'fullHash'],
    'blueprint approval index'
  );
  if (
    index.schemaVersion !== schemas.index
    || index.theme !== theme
    || index.templateId !== templateId
  ) fail('blueprint approval index identity is invalid');
  if (!Array.isArray(index.entries) || index.entries.length !== 3) {
    fail('blueprint approval index must contain exactly three entries');
  }
  let prior = null;
  const ids = new Set();
  index.entries.forEach((entry, position) => {
    const label = `blueprint approval index.entries[${position}]`;
    exactObject(entry, [
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
    trackedPath(entry.blueprintPath, `${label}.blueprintPath`);
    trackedPath(entry.approvalPath, `${label}.approvalPath`);
    sha256Pin(entry.blueprintFullHash, `${label}.blueprintFullHash`);
    sha256Pin(entry.sourceImageSha256, `${label}.sourceImageSha256`);
    sha256Pin(entry.promptProfileSha256, `${label}.promptProfileSha256`);
    if (schemas.v2) {
      approvalReason(entry.reason, `${label}.reason`);
      sha256Pin(entry.approvalFullHash, `${label}.approvalFullHash`);
    }
    if (entry.decision !== 'approved') fail(`${label}.decision must be approved`);
    if (ids.has(entry.id)) fail(`${label}.id is duplicated`);
    ids.add(entry.id);
    if (prior !== null && prior >= entry.id) {
      fail('blueprint approval index entries must be strictly ordered');
    }
    prior = entry.id;
    const fixedRoot = `ai-image-metadata/battle-maps/blueprints/${theme}/${templateId}`;
    if (
      entry.blueprintPath !== `${fixedRoot}/${entry.id}.json`
      || entry.approvalPath !== `${fixedRoot}/${entry.id}.approval.json`
    ) fail(`${label} does not use its fixed approved path`);
  });
  sha256Pin(index.fullHash, 'blueprint approval index.fullHash');
  const projection = {
    schemaVersion: index.schemaVersion,
    theme: index.theme,
    templateId: index.templateId,
    entries: index.entries
  };
  if (stableSha256(projection) !== index.fullHash || index.fullHash !== expectedHash) {
    fail(`blueprint approval index hash mismatch at ${expectedPath}`);
  }
  return index;
}

function validateBlueprintApprovalRecord(
  approval,
  entry,
  { theme, templateId, sidecar, blueprintPrompt }
) {
  const schemas = blueprintApprovalSchemas(templateId);
  exactObject(approval, [
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
  ], `blueprint approval ${entry.id}`);
  exactObject(
    approval.promptProfile,
    ['id', 'path', 'sha256'],
    `blueprint approval ${entry.id}.promptProfile`
  );
  if (schemas.v2) {
    approvalReason(approval.reason, `blueprint approval ${entry.id}.reason`);
    sha256Pin(approval.fullHash, `blueprint approval ${entry.id}.fullHash`);
    const approvalProjection = { ...approval };
    delete approvalProjection.fullHash;
    if (stableSha256(approvalProjection) !== approval.fullHash) {
      fail(`blueprint approval ${entry.id} full hash mismatch`);
    }
  }
  if (
    approval.schemaVersion !== schemas.record
    || approval.id !== entry.id
    || approval.theme !== theme
    || approval.templateId !== templateId
    || approval.decision !== 'approved'
    || approval.reviewer !== entry.reviewer
    || approval.blueprintPath !== entry.blueprintPath
    || approval.blueprintFullHash !== entry.blueprintFullHash
    || approval.sourceImageSha256 !== sidecar.sourceImage?.sha256
    || approval.sourceImageSha256 !== entry.sourceImageSha256
    || approval.promptProfile.id !== blueprintPrompt.id
    || approval.promptProfile.path !== blueprintPrompt.path
    || approval.promptProfile.sha256 !== blueprintPrompt.sha256
    || approval.promptProfile.sha256 !== entry.promptProfileSha256
    || (
      schemas.v2
      && (
        approval.reason !== entry.reason
        || approval.fullHash !== entry.approvalFullHash
      )
    )
  ) fail(`blueprint approval ${entry.id} is stale or mismatched`);
  return approval;
}

async function validateBlueprintApproval(
  projectRoot,
  entry,
  { theme, templateId, sidecar, blueprintPrompt }
) {
  const [{ value: blueprint }, { value: approval, bytes: approvalBytes }] =
    await Promise.all([
      readTrackedJson(projectRoot, entry.blueprintPath, 'approved blueprint'),
      readTrackedJson(projectRoot, entry.approvalPath, 'blueprint approval record')
    ]);
  assertTemplateMapBlueprint(blueprint);
  if (blueprint.candidateId !== entry.id || blueprint.templateId !== templateId) {
    fail(`approved blueprint ${entry.id} identity mismatch`);
  }
  const fullHash = await computeTemplateMapBlueprintFullHash(blueprint);
  if (fullHash !== entry.blueprintFullHash) {
    fail(`approved blueprint ${entry.id} full hash mismatch`);
  }
  validateBlueprintApprovalRecord(approval, entry, {
    theme,
    templateId,
    sidecar,
    blueprintPrompt
  });
  const blueprintBytes = await readTrackedBytes(
    projectRoot,
    entry.blueprintPath,
    `approved blueprint ${entry.id}`
  );
  if (bytesSha256(blueprintBytes) !== approval.blueprintFileSha256) {
    fail(`approved blueprint ${entry.id} file hash mismatch`);
  }
  // Reading the exact approval bytes above is intentional: the approval record
  // itself is tracked evidence and must be a regular, non-symlink JSON file.
  if (approvalBytes.length === 0) fail(`blueprint approval ${entry.id} is empty`);
  if (usesBlueprintV2SemanticContract(templateId)) {
    validateV2BlueprintSemanticContract(blueprint, sidecar);
  }
  return { blueprint, entry, approval, fullHash };
}

async function compilerAssetBundleProjection(bundle) {
  if (Object.hasOwn(bundle, 'rendererManifestFullHash')) {
    sha256Pin(bundle.rendererManifestFullHash, 'art bundle.rendererManifestFullHash');
    if (!Array.isArray(bundle.renderers) || bundle.renderers.length === 0) {
      fail('art bundle.renderers must be a non-empty array');
    }
    const rendererHash = await computeBattleArtRendererManifestFullHash(bundle);
    if (rendererHash !== bundle.rendererManifestFullHash) {
      fail('art bundle renderer manifest hash mismatch');
    }
    if (
      !Array.isArray(bundle.assets)
      || bundle.assets.length === 0
      || bundle.assets.length !== bundle.renderers.length
    ) {
      fail('art bundle assets and renderer records must have one-to-one membership');
    }
    for (let index = 0; index < bundle.renderers.length; index += 1) {
      const renderer = bundle.renderers[index];
      const asset = bundle.assets[index];
      if (
        renderer.id !== asset.key
        || renderer.contentVersion !== asset.contentVersion
        || renderer.sha256 !== asset.contentHash
        || renderer.immutableUrl !== asset.immutableUrl
      ) fail(`art bundle renderer ${renderer.id} does not match its exact asset record`);
    }
  }
  const base = toCompilerAssetBundle(bundle);
  const extended = Object.hasOwn(bundle, 'rendererManifestFullHash')
    ? { ...base, rendererManifestFullHash: bundle.rendererManifestFullHash }
    : base;
  const [baseHash, extendedHash] = await Promise.all([
    computeTemplateMapAssetBundleManifestFullHash(base),
    computeTemplateMapAssetBundleManifestFullHash(extended)
  ]);
  if (extendedHash !== baseHash) {
    if (extendedHash !== bundle.manifestFullHash) {
      fail('art bundle renderer-aware manifest hash mismatch');
    }
    return extended;
  }
  if (baseHash !== bundle.manifestFullHash) {
    fail('art bundle compiler manifest hash mismatch');
  }
  return base;
}

function assertRuntimeBundleMirror(authoritative, mirror) {
  if (canonicalizeJson(authoritative) !== canonicalizeJson(mirror)) {
    fail('frontend BattleMapV3 runtime bundle mirror is stale or mismatched');
  }
}

async function validateBinaryPin(projectRoot, pin, label, binaryMode, skipped) {
  if (!isPlainObject(pin)) fail(`${label} pin must be a plain object`);
  trackedPath(pin.path, `${label}.path`);
  sha256Pin(pin.sha256, `${label}.sha256`);
  if (pin.bytes !== undefined) positiveInteger(pin.bytes, `${label}.bytes`, 256 * 1024 * 1024);
  if (binaryMode === 'metadata') {
    skipped.push({ path: pin.path, expectedSha256: pin.sha256, reason: 'metadata-only' });
    return false;
  }
  const bytes = await readTrackedBytes(projectRoot, pin.path, label, {
    maxBytes: 256 * 1024 * 1024
  });
  if (bytesSha256(bytes) !== pin.sha256) fail(`${label} hash mismatch`);
  if (pin.bytes !== undefined && bytes.length !== pin.bytes) fail(`${label} byte length mismatch`);
  return true;
}

async function validateScreenshotEvidence(
  projectRoot,
  pin,
  binaryMode,
  skipped
) {
  exactObject(
    pin,
    ['path', 'bytes', 'width', 'height', 'format', 'sha256'],
    'screenshot evidence'
  );
  trackedPath(pin.path, 'screenshot evidence.path');
  positiveInteger(pin.bytes, 'screenshot evidence.bytes', 256 * 1024 * 1024);
  positiveInteger(pin.width, 'screenshot evidence.width', 8192);
  positiveInteger(pin.height, 'screenshot evidence.height', 8192);
  if (pin.width < 512 || pin.height < 512) {
    fail('screenshot evidence dimensions must each be at least 512 pixels');
  }
  if (pin.format !== 'png' || !pin.path.endsWith('.png')) {
    fail('screenshot evidence must be a PNG with a .png path');
  }
  sha256Pin(pin.sha256, 'screenshot evidence.sha256');
  if (binaryMode === 'metadata') {
    skipped.push({ path: pin.path, expectedSha256: pin.sha256, reason: 'metadata-only' });
    return false;
  }
  const absolute = await assertNoSymlinkPath(projectRoot, pin.path, {
    label: 'screenshot evidence'
  });
  const actual = await inspectImage(absolute);
  for (const key of ['bytes', 'width', 'height', 'format', 'sha256']) {
    if (actual[key] !== pin[key]) fail(`screenshot evidence ${key} mismatch`);
  }
  return true;
}

function requiredCoverageQueries() {
  const records = [];
  const playerCounts = [1, 2, 3, 4, 5];
  const opponentCounts = [1, 2, 3, 4, 5, 6, 7];
  for (const theme of PVE_THEMES) {
    for (let tier = 1; tier <= 5; tier += 1) {
      records.push({
        id: `coverage:${theme}:pve:tier-${tier}`,
        theme,
        sourceTier: tier,
        selectionBand: `tier-${tier}`,
        mode: 'pve',
        dimensions: { width: 32, height: 32 },
        teamLayout: 'players-vs-opponents',
        playerCounts,
        opponentCounts,
        requireBossCapable: false,
        requireCompetitiveParity: false
      });
    }
  }
  for (let tier = 1; tier <= 5; tier += 1) {
    records.push({
      id: `coverage:guild:guild:tier-${tier}`,
      theme: 'guild',
      sourceTier: tier,
      selectionBand: `tier-${tier}`,
      mode: 'guild',
      dimensions: { width: 32, height: 32 },
      teamLayout: 'players-vs-opponents',
      playerCounts,
      opponentCounts,
      requireBossCapable: true,
      requireCompetitiveParity: false
    });
  }
  for (const size of [1, 3, 5]) {
    records.push({
      id: `coverage:arena:pvp-coliseum:${size}v${size}`,
      theme: 'arena',
      sourceTier: null,
      selectionBand: `${size}v${size}`,
      mode: 'pvp_coliseum',
      dimensions: { width: 32, height: 32 },
      teamLayout: 'team-one-vs-team-two',
      playerCounts: [size],
      opponentCounts: [size],
      requireBossCapable: false,
      requireCompetitiveParity: true
    });
  }
  return records.sort((left, right) => left.id.localeCompare(right.id));
}

export const REQUIRED_BATTLE_MAP_V3_COVERAGE_QUERIES =
  Object.freeze(requiredCoverageQueries().map(record => Object.freeze({
    ...record,
    dimensions: Object.freeze({ ...record.dimensions }),
    playerCounts: Object.freeze([...record.playerCounts]),
    opponentCounts: Object.freeze([...record.opponentCounts])
  })));

function requiredEcologyCoverageQueries() {
  const records = REQUIRED_BATTLE_MAP_V3_COVERAGE_QUERIES.flatMap(query =>
    BATTLE_MAP_V3_ECOLOGY_PROFILES_BY_THEME[query.theme].map(
      ecologyProfile => Object.freeze({
        ...query,
        ecologyProfile
      })
    )
  );
  return records.sort((left, right) => {
    const leftCase = `${left.id}\0${left.ecologyProfile}`;
    const rightCase = `${right.id}\0${right.ecologyProfile}`;
    return leftCase < rightCase ? -1 : leftCase > rightCase ? 1 : 0;
  });
}

export const REQUIRED_BATTLE_MAP_V3_ECOLOGY_COVERAGE_QUERIES =
  Object.freeze(requiredEcologyCoverageQueries());

function collectMapAssetRefs(map) {
  const refs = [];
  const collect = ref => {
    if (ref !== null) refs.push(ref);
  };
  map.visualCells.forEach(row => row.forEach(cell => {
    if (cell !== null) {
      collect(cell.surface);
      cell.overlays.forEach(collect);
    }
  }));
  map.elevationConnections.forEach(record => collect(record.asset));
  map.obstacles.forEach(record => collect(record.asset));
  map.decorations.forEach(record => collect(record.asset));
  map.boundaries.forEach(record => collect(record.asset));
  map.routes.forEach(record =>
    record.visualAssets.forEach(asset => collect(asset.asset))
  );
  return refs;
}

function assertExactMapAssets(map, assetBundle) {
  const assets = new Map(assetBundle.assets.map(record => [record.key, record]));
  for (const ref of collectMapAssetRefs(map)) {
    const record = assets.get(ref.key);
    if (
      !record
      || ref.assetBundleId !== assetBundle.id
      || ref.contentVersion !== record.contentVersion
      || ref.contentHash !== record.contentHash
      || ref.immutableUrl !== record.immutableUrl
    ) fail(`map asset reference ${ref.key} does not exactly match its pinned bundle`);
  }
}

function assertRendererFootprint(renderer, cells, direction, label) {
  const xs = cells.map(cell => cell.x);
  const ys = cells.map(cell => cell.y);
  const actual = {
    width: Math.max(...xs) - Math.min(...xs) + 1,
    height: Math.max(...ys) - Math.min(...ys) + 1
  };
  const authoredDirectional = renderer.variant?.direction !== undefined;
  const directionalSwap =
    !authoredDirectional && (direction === 'e' || direction === 'w');
  const expected = directionalSwap
    ? {
      width: renderer.footprint.height,
      height: renderer.footprint.width
    }
    : {
      width: renderer.footprint.width,
      height: renderer.footprint.height
    };
  if (actual.width !== expected.width || actual.height !== expected.height) {
    fail(
      `${label} footprint ${actual.width}x${actual.height} does not match `
      + `renderer footprint ${expected.width}x${expected.height}`
    );
  }
}

function assertMapRendererContracts(map, artBundle) {
  if (!Array.isArray(artBundle.renderers) || artBundle.renderers.length === 0) {
    fail('authoritative art bundle has no renderer descriptors');
  }
  const renderers = new Map();
  for (const renderer of artBundle.renderers) {
    if (renderers.has(renderer.id)) {
      fail(`authoritative art bundle duplicates renderer ${renderer.id}`);
    }
    renderers.set(renderer.id, renderer);
  }
  const resolve = (ref, layer, label, categoryOverride = null) => {
    const renderer = renderers.get(ref.key);
    const expectedCategory = categoryOverride ?? MAP_RENDERER_CATEGORIES[layer];
    if (
      !renderer
      || renderer.id !== ref.key
      || renderer.contentVersion !== ref.contentVersion
      || renderer.sha256 !== ref.contentHash
      || renderer.immutableUrl !== ref.immutableUrl
    ) fail(`${label} does not match its exact renderer descriptor`);
    if (renderer.theme !== map.theme) {
      fail(`${label} renderer theme ${renderer.theme} does not match map theme ${map.theme}`);
    }
    if (renderer.category !== expectedCategory) {
      fail(
        `${label} requires ${expectedCategory} renderer, received ${renderer.category}`
      );
    }
    if (Object.hasOwn(map, 'ecologyProfile')) {
      if (
        !renderer.variant
        || renderer.variant.ecologyProfile !== map.ecologyProfile
      ) {
        fail(
          `${label} must carry exact ecology variant ${map.ecologyProfile}`
        );
      }
      if (
        Object.hasOwn(renderer.variant, 'tier')
        && !map.tierEligibility.includes(`tier-${renderer.variant.tier}`)
      ) {
        fail(
          `${label} renderer tier ${renderer.variant.tier} is outside map eligibility`
        );
      }
    }
    return renderer;
  };

  map.visualCells.forEach((row, y) => row.forEach((cell, x) => {
    if (cell === null) return;
    resolve(cell.surface, 'surface', `map visualCells[${y}][${x}].surface`);
    if (cell.overlays.length > 0) {
      fail(`map visualCells[${y}][${x}] contains unsupported untyped overlays`);
    }
  }));
  for (const connection of map.elevationConnections) {
    const label = `map connection ${connection.id}`;
    if (!['stairs', 'slope'].includes(connection.kind)) {
      // Legacy non-stairs may retain an exact pinned asset reference, but the
      // current renderer contract draws only explicit traversable crossings.
      continue;
    }
    if (connection.asset === null) {
      if (Object.hasOwn(map, 'ecologyProfile')) {
        fail(`${label} requires an exact directional connection renderer`);
      }
      continue;
    }
    const expectedCategory = connection.kind === 'stairs'
      ? 'connection-stairs'
      : 'connection-slope';
    const renderer = resolve(
      connection.asset,
      'connection',
      label,
      expectedCategory
    );
    if (!['n', 'e', 's', 'w'].includes(connection.direction)) {
      fail(`${label} requires a cardinal direction`);
    }
    if (renderer.variant) {
      const reverse = { n: 's', e: 'w', s: 'n', w: 'e' };
      const renderDirection = connection.heightDelta < 0
        ? reverse[connection.direction]
        : connection.direction;
      if (
        renderer.variant.direction !== renderDirection
        || renderer.variant.heightDelta !== Math.abs(connection.heightDelta)
      ) {
        fail(
          `${label} renderer variant must exactly match direction `
          + `${renderDirection} and height ${Math.abs(connection.heightDelta)}`
        );
      }
    }
    assertRendererFootprint(
      renderer,
      [connection.from, connection.to],
      connection.direction,
      label
    );
  }
  for (const obstacle of map.obstacles) {
    const label = `map obstacle ${obstacle.id}`;
    const renderer = resolve(obstacle.asset, 'obstacle', label);
    assertRendererFootprint(renderer, obstacle.cells, null, label);
  }
  for (const decoration of map.decorations) {
    resolve(
      decoration.asset,
      'decoration',
      `map decoration ${decoration.id}`
    );
  }
  for (const boundary of map.boundaries) {
    const label = `map boundary ${boundary.id}`;
    const renderer = resolve(boundary.asset, 'boundary', label);
    if (renderer.variant) {
      const directions = new Set(boundary.edges.map(edge => edge.direction));
      if (
        directions.size !== 1
        || renderer.variant.direction !== [...directions][0]
      ) {
        fail(`${label} renderer variant direction does not match its exact edge`);
      }
    }
  }
  for (const route of map.routes) {
    for (const visual of route.visualAssets) {
      const label = `map route ${route.id} role ${visual.role}`;
      const renderer = resolve(visual.asset, 'route', label);
      if (
        renderer.variant
        && renderer.variant.routeTopology !== visual.role
      ) {
        fail(`${label} renderer variant has mismatched route topology`);
      }
    }
  }
}

function resolveRecipeArtBundle(
  historicalReleases,
  registry,
  recipeManifestFullHash,
  assetBundlePin = null
) {
  sha256Pin(recipeManifestFullHash, 'compile recipe.assetBundle.manifestFullHash');
  let pin = assetBundlePin;
  if (pin === null) {
    const candidates = registry?.bundles?.filter(bundle =>
      bundle.manifestFullHash === recipeManifestFullHash
    ) ?? [];
    if (candidates.length !== 1) {
      fail(
        `compile recipe asset bundle ${recipeManifestFullHash} `
        + 'is missing or ambiguous in immutable battle-art history'
      );
    }
    pin = {
      id: candidates[0].id,
      version: candidates[0].version,
      manifestFullHash: candidates[0].manifestFullHash
    };
  }
  if (
    !isPlainObject(pin)
    || pin.manifestFullHash !== recipeManifestFullHash
  ) {
    fail('map-pinned asset bundle does not match the compile recipe manifest pin');
  }
  try {
    return resolveArchivedRuntimeBundle(historicalReleases, registry, pin);
  } catch (error) {
    fail(error.message);
  }
}

function runtimeAssetPath(asset) {
  if (
    typeof asset.immutableUrl !== 'string'
    || !asset.immutableUrl.startsWith('/')
    || asset.immutableUrl.startsWith('//')
  ) fail(`asset ${asset.key} requires a root-relative immutable URL for local release validation`);
  return `frontend/public${asset.immutableUrl}`;
}

async function verifyRuntimeBundleBinaries(projectRoot, assetBundle, binaryMode, skipped) {
  let verified = 0;
  for (const asset of assetBundle.assets) {
    const relativePath = runtimeAssetPath(asset);
    const didVerify = await validateBinaryPin(projectRoot, {
      path: relativePath,
      sha256: asset.contentHash
    }, `runtime asset ${asset.key}`, binaryMode, skipped);
    if (didVerify) verified += 1;
  }
  return verified;
}

export async function loadCompileRecipe({
  projectRoot = SCRIPT_PROJECT_ROOT,
  theme,
  templateId,
  binaryMode = 'metadata',
  skipStrictBattleArtCheck = false,
  assetBundlePin = null
}) {
  const root = path.resolve(projectRoot);
  supportedTheme(theme, 'theme');
  safeId(templateId, 'templateId');
  const expectedBlueprintPrompt = blueprintPromptProfile(templateId);
  if (!BINARY_MODES.has(binaryMode)) fail('binaryMode must be require or metadata');
  const recipePath = compileRecipePath(theme, templateId);
  const { value: recipe } = await readTrackedJson(root, recipePath, 'compile recipe');
  validateRecipeShape(recipe, theme, templateId);

  const [
    sidecarLoaded,
    indexLoaded,
    profileLoaded,
    tileCatalogLoaded,
    artBundleLoaded,
    artBundleRegistryLoaded,
    artBundleMirrorLoaded,
    blueprintPromptLoaded,
    battleArtLoaded
  ] = await Promise.all([
    readTrackedJson(root, recipe.sourceSidecar.path, 'approved source sidecar'),
    readTrackedJson(root, recipe.blueprintApprovalIndex.path, 'blueprint approval index'),
    readTrackedJson(root, recipe.renderProfile.path, 'render profile'),
    readTrackedJson(root, recipe.tileCatalog.path, 'tile catalog'),
    readTrackedJson(root, recipe.assetBundle.path, 'art runtime bundle'),
    readTrackedJson(
      root,
      BUNDLE_REGISTRY_PATH,
      'art runtime bundle registry'
    ),
    readTrackedJson(
      root,
      FRONTEND_ART_BUNDLE_MIRROR_PATH,
      'frontend art runtime bundle mirror'
    ),
    readTrackedJson(root, expectedBlueprintPrompt.path, 'blueprint prompt profile'),
    loadBattleArt(root),
    validateSourceSet(
      root,
      recipe.compiler,
      'compile recipe.compiler',
      COMPILER_SOURCE_SET_DOMAIN,
      COMPILER_SOURCE_FILES
    ),
    validateSourceSet(
      root,
      recipe.validator,
      'compile recipe.validator',
      VALIDATOR_SOURCE_SET_DOMAIN,
      VALIDATOR_SOURCE_FILES
    )
  ]);
  const sidecar = sidecarLoaded.value;
  if (
    sidecar.id !== templateId
    || sidecar.theme !== theme
    || sidecar.status !== 'approved'
    || sidecar.review?.decision !== 'approved'
  ) fail('source sidecar is not the exact approved template');
  const sourceFullHash = await computeTemplateMapSourceSidecarFullHash(sidecar);
  if (
    sourceFullHash !== recipe.sourceSidecar.fullHash
    || sidecar.pins?.compilerSha256 !== recipe.compiler.fullHash
  ) fail('source sidecar/compiler pins are stale');

  const approvalIndex = validateApprovalIndex(indexLoaded.value, {
    theme,
    templateId,
    expectedPath: recipe.blueprintApprovalIndex.path,
    expectedHash: recipe.blueprintApprovalIndex.fullHash
  });
  if (sidecar.pins?.approvedBlueprintSha256 !== approvalIndex.fullHash) {
    fail('source sidecar approved-blueprint index pin is stale');
  }
  const blueprintPromptProfileValue = blueprintPromptLoaded.value;
  if (
    blueprintPromptProfileValue.schemaVersion !== expectedBlueprintPrompt.schema
    || blueprintPromptProfileValue.id !== expectedBlueprintPrompt.id
    || blueprintPromptProfileValue.frozen !== true
  ) fail('blueprint prompt profile is not the frozen supported profile');
  const blueprintPrompt = {
    id: blueprintPromptProfileValue.id,
    path: expectedBlueprintPrompt.path,
    sha256: bytesSha256(blueprintPromptLoaded.bytes)
  };
  const recipeBlueprintIds = recipe.maps.map(record => record.blueprintId);
  const approvedIds = approvalIndex.entries.map(record => record.id);
  if (canonicalizeJson(recipeBlueprintIds) !== canonicalizeJson(approvedIds)
    || canonicalizeJson(sidecar.candidateMaps) !== canonicalizeJson(approvedIds)) {
    fail('compile recipe, sidecar, and approval index membership differ');
  }
  const approvedBlueprints = await Promise.all(
    approvalIndex.entries.map(entry =>
      validateBlueprintApproval(root, entry, {
        theme,
        templateId,
        sidecar,
        blueprintPrompt
      })
    )
  );

  const renderProfile = profileLoaded.value;
  if (
    stableSha256(renderProfile, RENDER_PROFILE_HASH_DOMAIN)
      !== recipe.renderProfile.fullHash
    || renderProfile.theme !== theme
  ) fail('render profile identity/hash mismatch');
  const tileCatalog = tileCatalogLoaded.value;
  if (
    await computeTemplateMapTileCatalogFullHash(tileCatalog)
      !== recipe.tileCatalog.fullHash
    || tileCatalog.fullHash !== recipe.tileCatalog.fullHash
  ) fail('tile catalog identity/hash mismatch');

  const currentArtBundle = artBundleLoaded.value;
  assertRuntimeBundleMirror(currentArtBundle, artBundleMirrorLoaded.value);
  const expectedCurrentArtBundle = await buildBattleArtBundle(
    battleArtLoaded.manifest,
    battleArtLoaded.descriptors
  );
  if (
    canonicalizeJson(currentArtBundle)
      !== canonicalizeJson(expectedCurrentArtBundle)
  ) {
    fail('art runtime bundle does not match its strict descriptor/placement catalog');
  }
  const artBundleRegistry = artBundleRegistryLoaded.value;
  const expectedArtBundleRegistry = buildBattleArtBundleRegistry(
    battleArtLoaded.historicalReleases,
    expectedCurrentArtBundle
  );
  if (
    canonicalizeJson(artBundleRegistry)
      !== canonicalizeJson(expectedArtBundleRegistry)
  ) fail('art runtime bundle registry does not match immutable release history');
  if (binaryMode === 'require' && !skipStrictBattleArtCheck) {
    await checkBattleArt({ root });
  }
  const resolvedArtBundle = resolveRecipeArtBundle(
    battleArtLoaded.historicalReleases,
    artBundleRegistry,
    recipe.assetBundle.manifestFullHash,
    assetBundlePin
  );
  const artBundle = resolvedArtBundle.bundle;
  const assetBundle = await compilerAssetBundleProjection(artBundle);
  if (
    assetBundle.manifestFullHash !== recipe.assetBundle.manifestFullHash
    || assetBundle.id !== renderProfile.assetBundleId
  ) fail('asset bundle identity/hash mismatch');

  const skippedBinaryChecks = [];
  for (const { descriptor } of battleArtLoaded.descriptors) {
    if (descriptor.status === 'approved' || descriptor.status === 'compiled') {
      await validateBinaryPin(root, {
        path: descriptor.source.imagePath,
        sha256: descriptor.source.imageSha256
      }, `approved battle-art source ${descriptor.id}`, binaryMode, skippedBinaryChecks);
    }
  }
  if (!sidecar.sourceImage) fail('approved source sidecar has no source-image pin');
  await validateBinaryPin(
    root,
    sidecar.sourceImage,
    'approved source image',
    binaryMode,
    skippedBinaryChecks
  );
  const verifiedRuntimeAssetCount = await verifyRuntimeBundleBinaries(
    root,
    assetBundle,
    binaryMode,
    skippedBinaryChecks
  );
  return {
    root,
    recipePath,
    recipe,
    sidecar,
    approvalIndex,
    approvedBlueprints,
    renderProfile,
    tileCatalog,
    artBundle,
    artBundleReleasePath: resolvedArtBundle.path,
    artBundleRegistry,
    historicalArtReleases: battleArtLoaded.historicalReleases,
    assetBundle,
    binaryMode,
    skippedBinaryChecks,
    verifiedRuntimeAssetCount
  };
}

function compilerContext(loaded, mapRecord, approved) {
  return {
    identity: {
      contentId: mapRecord.contentId,
      contentVersion: mapRecord.contentVersion,
      templateRevision: mapRecord.templateRevision,
      theme: loaded.recipe.theme,
      tierEligibility: loaded.sidecar.tierEligibility,
      supportedModes: loaded.sidecar.supportedModes
    },
    sourceSidecar: loaded.sidecar,
    renderProfile: loaded.renderProfile,
    tileCatalog: loaded.tileCatalog,
    assetBundle: loaded.assetBundle,
    provenance: {
      sourceSidecar: {
        id: loaded.sidecar.id,
        version: mapRecord.templateRevision,
        fullHash: loaded.recipe.sourceSidecar.fullHash
      },
      approvedBlueprint: {
        id: approved.entry.id,
        version: 1,
        fullHash: approved.entry.blueprintFullHash
      },
      compiler: {
        id: loaded.recipe.compiler.id,
        version: loaded.recipe.compiler.version,
        fullHash: loaded.recipe.compiler.fullHash
      },
      validator: {
        id: loaded.recipe.validator.id,
        version: loaded.recipe.validator.version,
        fullHash: loaded.recipe.validator.fullHash
      }
    }
  };
}

async function compileOne(loaded, mapRecord, dependencies) {
  const approved = loaded.approvedBlueprints.find(
    record => record.entry.id === mapRecord.blueprintId
  );
  if (!approved) fail(`compile recipe references unapproved blueprint ${mapRecord.blueprintId}`);
  const context = compilerContext(loaded, mapRecord, approved);
  const compile = dependencies.compileTemplateMapBlueprint ?? compileTemplateMapBlueprint;
  const finalize = dependencies.finalizeBattleMapV3 ?? finalizeBattleMapV3;
  const first = await finalize(await compile(approved.blueprint, context));
  const second = await finalize(await compile(approved.blueprint, context));
  const firstBytes = jsonBytes(first);
  const secondBytes = jsonBytes(second);
  if (Buffer.compare(firstBytes, secondBytes) !== 0) {
    fail(`map ${mapRecord.contentId} did not compile byte-identically`);
  }
  assertExactMapAssets(first, loaded.assetBundle);
  assertMapRendererContracts(first, loaded.artBundle);
  validateSpawnCorpus(first);
  return {
    map: first,
    bytes: firstBytes,
    path: compiledMapPath(
      loaded.recipe.theme,
      mapRecord.contentId,
      mapRecord.contentVersion
    ),
    blueprintId: mapRecord.blueprintId
  };
}

function validateSpawnCorpus(map) {
  const roleFixtures = [
    { aiType: 'aggressive', attackRange: 1, movement: 4 },
    { aiType: 'ranged', attackRange: 4, movement: 4 },
    { aiType: 'support', attackRange: 2, movement: 4, abilities: [{ type: 'heal' }] },
    { aiType: 'defensive', attackRange: 1, movement: 3 },
    { aiType: 'mobile', attackRange: 1, movement: 7 },
    { aiType: 'ambush', attackRange: 1, movement: 5, startsHidden: true },
    { isBoss: true, attackRange: 2, movement: 4 }
  ];
  const { playerCapacity, maxAssignableOpponents } = map.spawnContract.capacities;
  for (let playerCount = 1; playerCount <= playerCapacity; playerCount += 1) {
    for (
      let opponentCount = 1;
      opponentCount <= maxAssignableOpponents;
      opponentCount += 1
    ) {
      const playerUnits = Array.from({ length: playerCount }, (_, index) => ({
        id: `validation-player-${index + 1}`
      }));
      const opponentUnits = Array.from({ length: opponentCount }, (_, index) => ({
        id: `validation-opponent-${index + 1}`,
        ...roleFixtures[index % roleFixtures.length]
      }));
      assignBattleMapV3Spawns({
        map,
        playerUnits,
        opponentUnits,
        encounterSeed: `release-validation:${playerCount}:${opponentCount}`
      });
    }
  }
}

function rounded(value) {
  return Math.round(value * 1000) / 1000;
}

function average(values) {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sideCapabilityMetrics(map, view, cells, opposingCells, opposingExits) {
  const routeCosts = cells.map(cell =>
    Math.min(...opposingExits.map(exit =>
      calculateTraversalPathCost(view, { start: cell, goal: exit.cell })
    ))
  );
  if (routeCosts.some(value => !Number.isFinite(value))) {
    fail('capability report encountered a spawn with no opposing route');
  }
  const reachableArea = cells.map(cell =>
    getReachableTilesForTraversal(view, { start: cell, range: 6 }).length
  );
  const heightOpportunity = cells.map(cell => map.elevation[cell.y][cell.x]);
  const candidateQuality = cells.map(cell => {
    let count = 0;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const x = cell.x + dx;
      const y = cell.y + dy;
      if (
        x >= 0
        && y >= 0
        && x < map.dimensions.width
        && y < map.dimensions.height
        && map.playableMask[y][x] === true
        && map.terrain[y][x]?.passable === true
      ) count += 1;
    }
    return count;
  });
  const rangeOpportunity = cells.map(cell =>
    opposingCells.filter(other =>
      Math.abs(cell.x - other.x) + Math.abs(cell.y - other.y) <= 4
    ).length
  );
  return {
    meanRouteCost: rounded(average(routeCosts)),
    meanReachableArea: rounded(average(reachableArea)),
    meanHeight: rounded(average(heightOpportunity)),
    meanCandidateQuality: rounded(average(candidateQuality)),
    meanRangeTargets: rounded(average(rangeOpportunity))
  };
}

function withinParity(left, right, absolute, ratio = 0.2) {
  return Math.abs(left - right) <= Math.max(
    absolute,
    Math.max(Math.abs(left), Math.abs(right)) * ratio
  );
}

function deriveMapCapabilityReport(map) {
  const tagSet = new Set([
    ...map.spawnContract.opponentCandidates.flatMap(record => record.tags),
    ...map.spawnContract.opponentZones.flatMap(record => record.tags)
  ]);
  let bossCapable = false;
  if (tagSet.has('boss')) {
    try {
      assignBattleMapV3Spawns({
        map,
        playerUnits: [{ id: 'capability-player' }],
        opponentUnits: [{ id: 'capability-boss', isBoss: true }],
        encounterSeed: 'capability:boss'
      });
      bossCapable = true;
    } catch {
      bossCapable = false;
    }
  }

  let competitiveParity = false;
  let parityCases = null;
  const capacities = map.spawnContract.capacities;
  if (
    map.supportedModes.some(mode => mode === 'pvp' || mode === 'pvp_coliseum')
    && capacities.playerCapacity === capacities.maxAssignableOpponents
  ) {
    const declaredSizes = map.tierEligibility
      .map(band => /^([135])v\1$/.exec(band))
      .filter(Boolean)
      .map(match => Number(match[1]))
      .filter(size =>
        size <= capacities.playerCapacity
        && size <= capacities.maxAssignableOpponents
      );
    const sizes = [...new Set(
      declaredSizes.length > 0
        ? declaredSizes
        : [1, 3, 5].filter(size => size <= capacities.playerCapacity)
    )].sort((left, right) => left - right);
    parityCases = [];
    for (const size of sizes) {
      try {
        const assignment = assignBattleMapV3Spawns({
          map,
          playerUnits: Array.from({ length: size }, (_, index) => ({
            id: `parity-player-${index + 1}`
          })),
          opponentUnits: Array.from({ length: size }, (_, index) => ({
            id: `parity-opponent-${index + 1}`,
            attackRange: index % 2 === 0 ? 4 : 1,
            aiType: index % 2 === 0 ? 'ranged' : 'aggressive'
          })),
          encounterSeed: `capability:competitive-parity:${size}`
        });
        const view = createBattleMapV3TraversalView(map, {
          movementPolicy: { ignoreUnits: true }
        });
        const playerCells = assignment.playerAssignments.map(record => record.cell);
        const opponentCells = assignment.opponentAssignments.map(record => record.cell);
        const playerMetrics = sideCapabilityMetrics(
          map,
          view,
          playerCells,
          opponentCells,
          map.spawnContract.exits.filter(exit => exit.side === 'opponent')
        );
        const opponentMetrics = sideCapabilityMetrics(
          map,
          view,
          opponentCells,
          playerCells,
          map.spawnContract.exits.filter(exit => exit.side === 'player')
        );
        const passed =
          withinParity(playerMetrics.meanRouteCost, opponentMetrics.meanRouteCost, 2)
          && withinParity(
            playerMetrics.meanReachableArea,
            opponentMetrics.meanReachableArea,
            4
          )
          && withinParity(playerMetrics.meanHeight, opponentMetrics.meanHeight, 1, 0)
          && withinParity(
            playerMetrics.meanCandidateQuality,
            opponentMetrics.meanCandidateQuality,
            1,
            0
          )
          && withinParity(
            playerMetrics.meanRangeTargets,
            opponentMetrics.meanRangeTargets,
            1,
            0
          );
        parityCases.push({
          size,
          player: playerMetrics,
          opponent: opponentMetrics,
          passed
        });
      } catch {
        parityCases.push({
          size,
          player: null,
          opponent: null,
          passed: false
        });
      }
    }
    competitiveParity =
      parityCases.length > 0 && parityCases.every(record => record.passed);
  }
  return {
    schemaVersion: 'battle-map-v3-capability-report-v1',
    mapFullHash: map.hashes.fullHash,
    bossCapable,
    competitiveParity,
    parityCases
  };
}

function assertCapabilityClaims(definitionEntry, report, contentId) {
  if (definitionEntry.bossCapable && !report.bossCapable) {
    fail(`catalog map ${contentId} falsely claims boss capability`);
  }
  if (definitionEntry.competitiveParity && !report.competitiveParity) {
    fail(`catalog map ${contentId} falsely claims competitive parity`);
  }
}

export async function compileApprovedTemplate({
  projectRoot = SCRIPT_PROJECT_ROOT,
  theme,
  templateId,
  mapId = null,
  allApproved = false,
  binaryMode = 'metadata',
  checkOnly = false
}, dependencies = {}) {
  if ((mapId === null) === (allApproved === false)) {
    fail('supply exactly one of mapId or allApproved');
  }
  if (mapId !== null) safeId(mapId, 'mapId');
  const loaded = await loadCompileRecipe({
    projectRoot,
    theme,
    templateId,
    binaryMode
  });
  if (loaded.recipe.compiler.version !== TEMPLATE_MAP_COMPILER_VERSION) {
    fail(`compiler recipe version must equal ${TEMPLATE_MAP_COMPILER_VERSION}`);
  }
  const selected = allApproved
    ? loaded.recipe.maps
    : loaded.recipe.maps.filter(record =>
      record.blueprintId === mapId || record.contentId === mapId
    );
  if (selected.length !== (allApproved ? 3 : 1)) {
    fail(`requested map ${mapId} is not in the compile recipe`);
  }
  const results = [];
  for (const record of selected) {
    const compiled = await compileOne(loaded, record, dependencies);
    const write = await atomicWrite(loaded.root, compiled.path, compiled.bytes, {
      immutable: true,
      checkOnly,
      label: `compiled map ${record.contentId}`
    });
    results.push({
      contentId: compiled.map.contentId,
      contentVersion: compiled.map.contentVersion,
      fullHash: compiled.map.hashes.fullHash,
      path: compiled.path,
      changed: write.changed
    });
  }
  return {
    ok: true,
    theme,
    templateId,
    binaryMode,
    binaryEvidenceVerified: binaryMode === 'require',
    verifiedRuntimeAssetCount: loaded.verifiedRuntimeAssetCount,
    skippedBinaryChecks: loaded.skippedBinaryChecks,
    results
  };
}

export async function validateCompiledTemplate(options, dependencies = {}) {
  return compileApprovedTemplate({ ...options, checkOnly: true }, dependencies);
}

function validateMapApprovalRecord(record, expected = {}) {
  exactObject(record, APPROVAL_KEYS, 'map visual approval');
  if (
    record.schemaVersion !== MAP_VISUAL_APPROVAL_SCHEMA
    || record.decision !== 'approved'
    || record.checklistVersion !== MAP_APPROVAL_CHECKLIST_VERSION
  ) fail('map visual approval state/schema is invalid');
  safeId(record.reviewer, 'map visual approval.reviewer');
  supportedTheme(record.theme, 'map visual approval.theme');
  safeId(record.templateId, 'map visual approval.templateId');
  safeId(record.contentId, 'map visual approval.contentId');
  positiveInteger(record.contentVersion, 'map visual approval.contentVersion');
  trackedPath(record.mapPath, 'map visual approval.mapPath');
  exactObject(
    record.hashes,
    ['authoritativeHash', 'visualHash', 'fullHash'],
    'map visual approval.hashes'
  );
  Object.entries(record.hashes).forEach(([key, value]) =>
    sha256Pin(value, `map visual approval.hashes.${key}`)
  );
  exactObject(
    record.sourceSidecar,
    ['path', 'fullHash'],
    'map visual approval.sourceSidecar'
  );
  exactObject(
    record.blueprint,
    ['id', 'fullHash', 'approvalIndexFullHash'],
    'map visual approval.blueprint'
  );
  exactObject(
    record.renderProfile,
    ['id', 'path', 'fullHash'],
    'map visual approval.renderProfile'
  );
  exactObject(
    record.tileCatalog,
    ['id', 'version', 'path', 'fullHash'],
    'map visual approval.tileCatalog'
  );
  exactObject(
    record.assetBundle,
    ['id', 'version', 'path', 'manifestFullHash'],
    'map visual approval.assetBundle'
  );
  exactObject(
    record.capabilityReport,
    [
      'schemaVersion',
      'mapFullHash',
      'bossCapable',
      'competitiveParity',
      'parityCases'
    ],
    'map visual approval.capabilityReport'
  );
  if (
    record.capabilityReport.schemaVersion !== 'battle-map-v3-capability-report-v1'
    || record.capabilityReport.mapFullHash !== record.hashes.fullHash
  ) fail('map visual approval capability report identity is invalid');
  boolean(
    record.capabilityReport.bossCapable,
    'map visual approval.capabilityReport.bossCapable'
  );
  boolean(
    record.capabilityReport.competitiveParity,
    'map visual approval.capabilityReport.competitiveParity'
  );
  if (record.capabilityReport.parityCases !== null) {
    if (
      !Array.isArray(record.capabilityReport.parityCases)
      || record.capabilityReport.parityCases.length === 0
    ) fail('map visual approval parityCases must be null or a non-empty array');
    let priorSize = 0;
    record.capabilityReport.parityCases.forEach((parityCase, index) => {
      const label = `map visual approval.capabilityReport.parityCases[${index}]`;
      exactObject(
        parityCase,
        ['size', 'player', 'opponent', 'passed'],
        label
      );
      positiveInteger(parityCase.size, `${label}.size`, 5);
      if (parityCase.size <= priorSize) fail('capability parity case sizes must increase');
      priorSize = parityCase.size;
      boolean(parityCase.passed, `${label}.passed`);
      for (const side of ['player', 'opponent']) {
        if (parityCase[side] === null) {
          if (parityCase.passed) fail(`${label}.${side} is required when passed`);
          continue;
        }
        exactObject(
          parityCase[side],
          [
            'meanRouteCost',
            'meanReachableArea',
            'meanHeight',
            'meanCandidateQuality',
            'meanRangeTargets'
          ],
          `${label}.${side}`
        );
        for (const value of Object.values(parityCase[side])) {
          if (!Number.isFinite(value)) {
            fail('map visual approval capability metrics must be finite');
          }
        }
      }
    });
  }
  exactObject(
    record.screenshot,
    ['path', 'bytes', 'width', 'height', 'format', 'sha256'],
    'map visual approval.screenshot'
  );
  for (const item of [
    record.sourceSidecar,
    record.renderProfile,
    record.tileCatalog,
    record.assetBundle,
    record.screenshot
  ]) trackedPath(item.path, 'map visual approval pinned path');
  for (const value of [
    record.sourceSidecar.fullHash,
    record.blueprint.fullHash,
    record.blueprint.approvalIndexFullHash,
    record.renderProfile.fullHash,
    record.tileCatalog.fullHash,
    record.assetBundle.manifestFullHash,
    record.screenshot.sha256
  ]) sha256Pin(value, 'map visual approval hash');
  positiveInteger(record.tileCatalog.version, 'map visual approval.tileCatalog.version');
  positiveInteger(record.assetBundle.version, 'map visual approval.assetBundle.version');
  positiveInteger(record.screenshot.bytes, 'map visual approval.screenshot.bytes');
  positiveInteger(record.screenshot.width, 'map visual approval.screenshot.width', 8192);
  positiveInteger(record.screenshot.height, 'map visual approval.screenshot.height', 8192);
  if (
    record.screenshot.width < 512
    || record.screenshot.height < 512
    || record.screenshot.format !== 'png'
    || !record.screenshot.path.endsWith('.png')
  ) fail('map visual approval screenshot must be a PNG at least 512x512');
  for (const [key, value] of Object.entries(expected)) {
    if (canonicalizeJson(record[key]) !== canonicalizeJson(value)) {
      fail(`map visual approval.${key} does not match its exact map input`);
    }
  }
  return record;
}

export async function approveCompiledMap({
  projectRoot = SCRIPT_PROJECT_ROOT,
  theme,
  templateId,
  mapId,
  screenshotPath,
  reviewer
}) {
  safeId(mapId, 'mapId');
  safeId(reviewer, 'reviewer');
  trackedPath(screenshotPath, 'screenshotPath');
  const loaded = await loadCompileRecipe({
    projectRoot,
    theme,
    templateId,
    binaryMode: 'require'
  });
  const recipeMap = loaded.recipe.maps.find(
    record => record.blueprintId === mapId || record.contentId === mapId
  );
  if (!recipeMap) fail(`map ${mapId} is not in the compile recipe`);
  const expectedScreenshotRoot =
    `ai-image-metadata/battle-maps/review/${theme}/${templateId}/`
    + `${recipeMap.contentId}/`;
  if (!screenshotPath.startsWith(expectedScreenshotRoot)) {
    fail(`screenshotPath must be beneath ${expectedScreenshotRoot}`);
  }
  const mapPath = compiledMapPath(theme, recipeMap.contentId, recipeMap.contentVersion);
  const { value: mapInput, bytes: mapBytes } =
    await readTrackedJson(loaded.root, mapPath, 'compiled map');
  const map = await normalizeBattleMapV3Final(mapInput);
  if (
    map.provenance.assetBundle.id !== loaded.assetBundle.id
    || map.provenance.assetBundle.version !== loaded.assetBundle.version
    || map.provenance.assetBundle.manifestFullHash
      !== loaded.assetBundle.manifestFullHash
  ) fail('compiled map does not resolve its exact immutable battle-art bundle');
  const recomputed = await compileOne(loaded, recipeMap, {});
  if (Buffer.compare(recomputed.bytes, mapBytes) !== 0) {
    fail('compiled map is not byte-identical to an exact approved-input recompile');
  }
  assertExactMapAssets(map, loaded.assetBundle);
  const skipped = [];
  await verifyRuntimeBundleBinaries(loaded.root, loaded.assetBundle, 'require', skipped);
  const screenshotAbsolute = await assertNoSymlinkPath(
    loaded.root,
    screenshotPath,
    { label: 'reviewed map screenshot' }
  );
  const screenshot = await inspectImage(screenshotAbsolute);
  if (
    screenshot.format !== 'png'
    || screenshot.width < 512
    || screenshot.height < 512
  ) fail('reviewed map screenshot must decode as a PNG at least 512x512');
  const approved = loaded.approvedBlueprints.find(
    record => record.entry.id === recipeMap.blueprintId
  );
  const record = {
    schemaVersion: MAP_VISUAL_APPROVAL_SCHEMA,
    decision: 'approved',
    reviewer,
    checklistVersion: MAP_APPROVAL_CHECKLIST_VERSION,
    theme,
    templateId,
    contentId: map.contentId,
    contentVersion: map.contentVersion,
    mapPath,
    hashes: map.hashes,
    sourceSidecar: {
      path: loaded.recipe.sourceSidecar.path,
      fullHash: loaded.recipe.sourceSidecar.fullHash
    },
    blueprint: {
      id: approved.entry.id,
      fullHash: approved.entry.blueprintFullHash,
      approvalIndexFullHash: loaded.approvalIndex.fullHash
    },
    renderProfile: {
      id: loaded.renderProfile.id,
      path: loaded.recipe.renderProfile.path,
      fullHash: loaded.recipe.renderProfile.fullHash
    },
    tileCatalog: {
      id: loaded.tileCatalog.id,
      version: loaded.tileCatalog.version,
      path: loaded.recipe.tileCatalog.path,
      fullHash: loaded.tileCatalog.fullHash
    },
    assetBundle: {
      id: loaded.assetBundle.id,
      version: loaded.assetBundle.version,
      path: loaded.artBundleReleasePath,
      manifestFullHash: loaded.assetBundle.manifestFullHash
    },
    capabilityReport: deriveMapCapabilityReport(map),
    screenshot: {
      path: screenshotPath,
      bytes: screenshot.bytes,
      width: screenshot.width,
      height: screenshot.height,
      format: screenshot.format,
      sha256: screenshot.sha256
    }
  };
  validateMapApprovalRecord(record);
  const approvalPath = visualApprovalPath(theme, map.contentId, map.contentVersion);
  const approvalBytes = jsonBytes(record);
  const approvalFileSha256 = bytesSha256(approvalBytes);
  const write = await atomicWrite(loaded.root, approvalPath, approvalBytes, {
    immutable: true,
    label: 'map visual approval'
  });
  return {
    ok: true,
    approvalPath,
    changed: write.changed,
    approvalFileSha256,
    mapFullHash: map.hashes.fullHash,
    screenshotSha256: record.screenshot.sha256
  };
}

function validateCatalogDefinition(definition, releaseId) {
  exactObject(definition, CATALOG_DEFINITION_KEYS, 'catalog definition');
  if (
    definition.schemaVersion !== CATALOG_DEFINITION_SCHEMA
    || definition.catalogReleaseId !== releaseId
  ) fail('catalog definition identity/schema is invalid');
  safeId(definition.catalogReleaseId, 'catalog definition.catalogReleaseId');
  if (!Array.isArray(definition.entries) || definition.entries.length === 0) {
    fail('catalog definition.entries must be non-empty');
  }
  const ids = new Set();
  let priorMapPath = null;
  definition.entries.forEach((entry, index) => {
    const label = `catalog definition.entries[${index}]`;
    exactObject(entry, DEFINITION_ENTRY_KEYS, label);
    safeId(entry.id, `${label}.id`);
    trackedPath(entry.mapPath, `${label}.mapPath`);
    trackedPath(entry.approvalPath, `${label}.approvalPath`);
    sha256Pin(entry.approvalFileSha256, `${label}.approvalFileSha256`);
    safeId(entry.orientation, `${label}.orientation`);
    safeId(entry.teamLayout, `${label}.teamLayout`);
    positiveInteger(entry.weight, `${label}.weight`, 1_000_000);
    boolean(entry.bossCapable, `${label}.bossCapable`);
    boolean(entry.competitiveParity, `${label}.competitiveParity`);
    if (ids.has(entry.id)) fail(`${label}.id is duplicated`);
    ids.add(entry.id);
    if (priorMapPath !== null && priorMapPath >= entry.mapPath) {
      fail('catalog definition.entries must be strictly ordered by mapPath');
    }
    priorMapPath = entry.mapPath;
  });
  if (!Array.isArray(definition.coverageQueries) || definition.coverageQueries.length === 0) {
    fail('catalog definition.coverageQueries must be non-empty');
  }
  const queryCases = new Set();
  let priorQueryCase = null;
  definition.coverageQueries.forEach((query, index) => {
    const label = `catalog definition.coverageQueries[${index}]`;
    exactObject(
      query,
      Object.hasOwn(query, 'ecologyProfile')
        ? COVERAGE_QUERY_KEYS
        : COVERAGE_QUERY_KEYS.filter(key => key !== 'ecologyProfile'),
      label
    );
    safeId(query.id, `${label}.id`);
    supportedTheme(query.theme, `${label}.theme`);
    if (Object.hasOwn(query, 'ecologyProfile')) {
      safeId(query.ecologyProfile, `${label}.ecologyProfile`);
    }
    if (query.sourceTier !== null) positiveInteger(query.sourceTier, `${label}.sourceTier`, 5);
    safeId(query.selectionBand, `${label}.selectionBand`);
    safeId(query.mode, `${label}.mode`);
    exactObject(query.dimensions, ['width', 'height'], `${label}.dimensions`);
    positiveInteger(query.dimensions.width, `${label}.dimensions.width`, 256);
    positiveInteger(query.dimensions.height, `${label}.dimensions.height`, 256);
    safeId(query.teamLayout, `${label}.teamLayout`);
    for (const [field, maximum] of [['playerCounts', 5], ['opponentCounts', 64]]) {
      if (!Array.isArray(query[field]) || query[field].length === 0) {
        fail(`${label}.${field} must be non-empty`);
      }
      let prior = null;
      query[field].forEach((count, countIndex) => {
        const minimum = field === 'opponentCounts' ? 0 : 1;
        if (!Number.isSafeInteger(count) || count < minimum || count > maximum) {
          fail(`${label}.${field}[${countIndex}] is outside ${minimum}..${maximum}`);
        }
        if (prior !== null && prior >= count) {
          fail(`${label}.${field} must be strictly increasing`);
        }
        prior = count;
      });
    }
    boolean(query.requireBossCapable, `${label}.requireBossCapable`);
    boolean(query.requireCompetitiveParity, `${label}.requireCompetitiveParity`);
    const queryCase = `${query.id}\0${query.ecologyProfile ?? ''}`;
    if (queryCases.has(queryCase)) {
      fail(`${label} duplicates an id/ecologyProfile coverage case`);
    }
    queryCases.add(queryCase);
    if (priorQueryCase !== null && priorQueryCase >= queryCase) {
      fail(
        'catalog definition.coverageQueries must be strictly ordered by '
        + 'id and ecologyProfile'
      );
    }
    priorQueryCase = queryCase;
  });
  const authoritativeById = new Map(
    REQUIRED_BATTLE_MAP_V3_COVERAGE_QUERIES.map(query => [query.id, query])
  );
  for (const query of definition.coverageQueries) {
    const authoritative = authoritativeById.get(query.id);
    const {
      ecologyProfile: _ecologyProfile,
      ...baseQuery
    } = query;
    if (
      !authoritative
      || canonicalizeJson(baseQuery) !== canonicalizeJson(authoritative)
    ) {
      fail(
        `catalog coverage query ${query.id} is not an exact authoritative `
        + 'PvE/guild/Coliseum tier-mode-capacity profile'
      );
    }
  }
  return definition;
}

async function verifyVisualApproval(
  projectRoot,
  definitionEntry,
  binaryMode,
  { recipeCache = null, strictBattleArtAlreadyVerified = false } = {}
) {
  const [
    { value: mapInput, bytes: mapBytes },
    { value: approval, bytes: approvalBytes }
  ] = await Promise.all([
    readTrackedJson(projectRoot, definitionEntry.mapPath, 'catalog compiled map'),
    readTrackedJson(projectRoot, definitionEntry.approvalPath, 'map visual approval')
  ]);
  if (bytesSha256(approvalBytes) !== definitionEntry.approvalFileSha256) {
    fail(`catalog map approval file hash mismatch for ${definitionEntry.approvalPath}`);
  }
  const map = await normalizeBattleMapV3Final(mapInput);
  const expectedMapPath = compiledMapPath(map.theme, map.contentId, map.contentVersion);
  const expectedApprovalPath = visualApprovalPath(map.theme, map.contentId, map.contentVersion);
  if (
    definitionEntry.mapPath !== expectedMapPath
    || definitionEntry.approvalPath !== expectedApprovalPath
  ) fail(`catalog map ${map.contentId} does not use its fixed paths`);
  validateMapApprovalRecord(approval, {
    theme: map.theme,
    templateId: map.templateId,
    contentId: map.contentId,
    contentVersion: map.contentVersion,
    mapPath: definitionEntry.mapPath,
    hashes: map.hashes
  });
  if (
    canonicalizeJson(approval.capabilityReport)
      !== canonicalizeJson(deriveMapCapabilityReport(map))
  ) fail(`map ${map.contentId} capability report is stale`);
  assertCapabilityClaims(
    definitionEntry,
    approval.capabilityReport,
    map.contentId
  );
  const recipeCacheKey =
    `${map.theme}\0${map.templateId}\0`
    + `${map.provenance.assetBundle.id}\0`
    + `${map.provenance.assetBundle.version}\0`
    + map.provenance.assetBundle.manifestFullHash;
  let loadedPromise = recipeCache?.get(recipeCacheKey);
  if (!loadedPromise) {
    loadedPromise = loadCompileRecipe({
      projectRoot,
      theme: map.theme,
      templateId: map.templateId,
      binaryMode,
      skipStrictBattleArtCheck: strictBattleArtAlreadyVerified,
      assetBundlePin: map.provenance.assetBundle
    });
    recipeCache?.set(recipeCacheKey, loadedPromise);
  }
  const loaded = await loadedPromise;
  const recipeMap = loaded.recipe.maps.find(record =>
    record.contentId === map.contentId
    && record.contentVersion === map.contentVersion
  );
  if (!recipeMap) fail(`catalog map ${map.contentId} is absent from its compile recipe`);
  const recompiled = await compileOne(loaded, recipeMap, {});
  if (Buffer.compare(recompiled.bytes, mapBytes) !== 0) {
    fail(`catalog map ${map.contentId} is not byte-identical to its approved-input recompile`);
  }
  const approvedBlueprint = loaded.approvedBlueprints.find(
    record => record.entry.id === recipeMap.blueprintId
  );
  const expectedApprovalPins = {
    sourceSidecar: {
      path: loaded.recipe.sourceSidecar.path,
      fullHash: loaded.recipe.sourceSidecar.fullHash
    },
    blueprint: {
      id: approvedBlueprint.entry.id,
      fullHash: approvedBlueprint.entry.blueprintFullHash,
      approvalIndexFullHash: loaded.approvalIndex.fullHash
    },
    renderProfile: {
      id: loaded.renderProfile.id,
      path: loaded.recipe.renderProfile.path,
      fullHash: loaded.recipe.renderProfile.fullHash
    },
    tileCatalog: {
      id: loaded.tileCatalog.id,
      version: loaded.tileCatalog.version,
      path: loaded.recipe.tileCatalog.path,
      fullHash: loaded.tileCatalog.fullHash
    },
    assetBundle: {
      id: loaded.assetBundle.id,
      version: loaded.assetBundle.version,
      path: loaded.artBundleReleasePath,
      manifestFullHash: loaded.assetBundle.manifestFullHash
    }
  };
  for (const [key, expected] of Object.entries(expectedApprovalPins)) {
    if (canonicalizeJson(approval[key]) !== canonicalizeJson(expected)) {
      fail(`map ${map.contentId} visual approval has stale ${key} pins`);
    }
  }
  const skippedBinaryChecks = [...loaded.skippedBinaryChecks];
  await validateScreenshotEvidence(
    projectRoot,
    approval.screenshot,
    binaryMode,
    skippedBinaryChecks
  );
  const assetBundle = loaded.assetBundle;
  if (
    assetBundle.id !== approval.assetBundle.id
    || assetBundle.version !== approval.assetBundle.version
    || assetBundle.manifestFullHash !== approval.assetBundle.manifestFullHash
    || map.provenance.assetBundle.id !== assetBundle.id
    || map.provenance.assetBundle.version !== assetBundle.version
    || map.provenance.assetBundle.manifestFullHash !== assetBundle.manifestFullHash
  ) fail(`map ${map.contentId} asset-bundle approval pin mismatch`);
  assertExactMapAssets(map, assetBundle);
  const verifiedAssetCount = loaded.verifiedRuntimeAssetCount;
  const sidecar = loaded.sidecar;
  if (
    await computeTemplateMapSourceSidecarFullHash(sidecar)
      !== approval.sourceSidecar.fullHash
    || sidecar.mapProfile?.orientation !== definitionEntry.orientation
  ) fail(`map ${map.contentId} source sidecar/orientation pin mismatch`);
  return {
    map,
    approval,
    assetBundle,
    skippedBinaryChecks,
    verifiedAssetCount
  };
}

function catalogEntryFromMap(releaseId, definitionEntry, map) {
  return {
    id: definitionEntry.id,
    mapContentId: map.contentId,
    mapContentVersion: map.contentVersion,
    mapFullHash: map.hashes.fullHash,
    catalogReleaseId: releaseId,
    theme: map.theme,
    renderProfileId: map.renderProfileId,
    ecologyProfile: map.ecologyProfile,
    tierEligibility: map.tierEligibility,
    supportedModes: map.supportedModes,
    orientation: definitionEntry.orientation,
    teamLayout: definitionEntry.teamLayout,
    dimensions: map.dimensions,
    playerCapacity: map.spawnContract.capacities.playerCapacity,
    candidatePoolSize: map.spawnContract.capacities.candidatePoolSize,
    maxAssignableOpponents: map.spawnContract.capacities.maxAssignableOpponents,
    assetBundleId: map.provenance.assetBundle.id,
    assetBundleManifestFullHash: map.provenance.assetBundle.manifestFullHash,
    weight: definitionEntry.weight,
    bossCapable: definitionEntry.bossCapable,
    competitiveParity: definitionEntry.competitiveParity,
    sourceTemplateId: map.templateId
  };
}

function capacityBand(opponentCount) {
  if (opponentCount === 0) return 'opponents-0';
  if (opponentCount <= 7) return 'opponents-1-7';
  if (opponentCount <= 12) return 'opponents-8-12';
  if (opponentCount <= 24) return 'opponents-13-24';
  return 'opponents-25-64';
}

function capacityBandMaximum(band) {
  return ({
    'opponents-0': 0,
    'opponents-1-7': 7,
    'opponents-8-12': 12,
    'opponents-13-24': 24,
    'opponents-25-64': 64
  })[band] ?? fail(`unknown opposing-roster capacity band ${band}`);
}

function expandCoverageQueries(definition) {
  const expanded = [];
  for (const record of definition.coverageQueries) {
    for (const playerCount of record.playerCounts) {
      for (const opponentCount of record.opponentCounts) {
        expanded.push({
          coverageId: record.id,
          query: createBattleMapV3SelectionQuery({
            encounterSeed: 0,
            theme: record.theme,
            ecologyProfile: record.ecologyProfile ?? null,
            sourceTier: record.sourceTier,
            selectionBand: record.selectionBand,
            mode: record.mode,
            partyCapacityBand: 'players-1-5',
            opposingRosterCapacityBand: capacityBand(opponentCount),
            dimensions: record.dimensions,
            teamLayout: record.teamLayout,
            playerCount,
            opponentCount,
            requireBossCapable: record.requireBossCapable,
            requireCompetitiveParity: record.requireCompetitiveParity
          })
        });
      }
    }
  }
  return expanded;
}

function isCoverageEntryEligible(entry, query) {
  return entry.theme === query.theme
    && (!Object.hasOwn(entry, 'ecologyProfile')
      || entry.ecologyProfile === (query.ecologyProfile ?? null))
    && entry.tierEligibility.includes(query.selectionBand)
    && entry.supportedModes.includes(query.mode)
    && entry.dimensions.width === query.dimensions.width
    && entry.dimensions.height === query.dimensions.height
    && entry.teamLayout === query.teamLayout
    && (!query.requireBossCapable || entry.bossCapable)
    && (!query.requireCompetitiveParity || entry.competitiveParity);
}

function assertCoverageEntryCapacities(release, definition) {
  for (const query of definition.coverageQueries) {
    const maximumPlayerCount = 5;
    const declaredOpponentBands = new Set();
    for (const opponentCount of query.opponentCounts) {
      declaredOpponentBands.add(capacityBand(opponentCount));
    }
    const eligibleEntries = release.entries.filter(entry =>
      entry.weight > 0 && isCoverageEntryEligible(entry, query)
    );
    for (const band of declaredOpponentBands) {
      const maximumOpponentCount = capacityBandMaximum(band);
      for (const entry of eligibleEntries) {
        if (
          entry.playerCapacity < maximumPlayerCount
          || entry.maxAssignableOpponents < maximumOpponentCount
        ) {
          fail(
            `catalog entry ${entry.id} is eligible for coverage case `
            + `${query.id} capacity band ${band} but supports only `
            + `${entry.playerCapacity} players and `
            + `${entry.maxAssignableOpponents} opponents; the case requires `
            + `${maximumPlayerCount} players and ${maximumOpponentCount} opponents`,
            'INCOMPLETE_BATTLE_MAP_V3_CATALOG_COVERAGE'
          );
        }
      }
    }
  }
}

export async function checkReleaseCoverage(release, definition, {
  requireComplete = false
} = {}) {
  const normalizedRelease = await normalizeBattleMapV3CatalogRelease(release);
  const authoritativeCoverageProjection = [...new Map(
    definition.coverageQueries.map(
      ({ ecologyProfile: _ecologyProfile, ...query }) => [query.id, query]
    )
  ).values()].sort((left, right) => left.id.localeCompare(right.id));
  if (
    requireComplete
    && canonicalizeJson(authoritativeCoverageProjection)
      !== canonicalizeJson(REQUIRED_BATTLE_MAP_V3_COVERAGE_QUERIES)
  ) {
    fail(
      'complete release acceptance requires the full authoritative '
      + '16-theme PvE/guild/Coliseum tier-mode-capacity matrix',
      'INCOMPLETE_BATTLE_MAP_V3_CATALOG_COVERAGE'
    );
  }
  if (
    requireComplete
    && canonicalizeJson(definition.coverageQueries)
      !== canonicalizeJson(REQUIRED_BATTLE_MAP_V3_ECOLOGY_COVERAGE_QUERIES)
  ) {
    fail(
      'complete release acceptance requires the full authoritative '
      + '118-case theme/ecology coverage matrix',
      'INCOMPLETE_BATTLE_MAP_V3_CATALOG_COVERAGE'
    );
  }
  assertCoverageEntryCapacities(normalizedRelease, definition);
  const misses = [];
  const selections = [];
  for (const item of expandCoverageQueries(definition)) {
    const result = await selectBattleMapV3CatalogEntry(
      normalizedRelease,
      item.query
    );
    if (result.coverage !== 'selected') {
      misses.push({ coverageId: item.coverageId, query: item.query });
    } else {
      selections.push({
        coverageId: item.coverageId,
        playerCount: item.query.playerCount,
        opponentCount: item.query.opponentCount,
        selectedEntryId: result.entry.id
      });
    }
  }
  if (misses.length > 0) {
    fail(
      `catalog release has ${misses.length} uncovered required queries`,
      'INCOMPLETE_BATTLE_MAP_V3_CATALOG_COVERAGE'
    );
  }
  return { queryCount: selections.length, selections };
}

function canonicalizeCoordinateItems(items) {
  if (items.length === 0) return '[]';
  const transforms = [
    (x, y) => [x, y],
    (x, y) => [x, -y],
    (x, y) => [-x, y],
    (x, y) => [-x, -y],
    (x, y) => [y, x],
    (x, y) => [y, -x],
    (x, y) => [-y, x],
    (x, y) => [-y, -x]
  ];
  const projections = transforms.map(transform => {
    const transformed = items.map(item => {
      const [x, y] = transform(item.x, item.y);
      return { label: item.label, x, y };
    });
    const minX = Math.min(...transformed.map(item => item.x));
    const minY = Math.min(...transformed.map(item => item.y));
    return canonicalizeJson(transformed
      .map(item => ({
        label: item.label,
        x: item.x - minX,
        y: item.y - minY
      }))
      .sort((left, right) =>
        left.label.localeCompare(right.label)
        || left.x - right.x
        || left.y - right.y
      ));
  });
  projections.sort();
  return projections[0];
}

function authoredDiversitySignatures(map) {
  const routeItems = map.routes.flatMap(route =>
    route.cells.map(cell => ({
      label: `route:${route.kind}:${route.width}`,
      x: cell.x,
      y: cell.y
    }))
  );
  const elevationRegionItems = [];
  map.elevation.forEach((row, y) => row.forEach((level, x) => {
    if (level !== null) elevationRegionItems.push({ label: `elevation:${level}`, x, y });
  }));
  map.features.forEach(feature => feature.cells.forEach(cell => {
    elevationRegionItems.push({
      label: `feature:${feature.kind}`,
      x: cell.x,
      y: cell.y
    });
  }));
  const formationItems = [
    ...map.spawnContract.playerSlots.map(record => ({
      label: 'formation:player',
      x: record.cell.x,
      y: record.cell.y
    })),
    ...map.spawnContract.opponentCandidates.map(record => ({
      label: 'formation:opponent',
      x: record.cell.x,
      y: record.cell.y
    })),
    ...map.spawnContract.exits.map(record => ({
      label: `exit:${record.side}`,
      x: record.cell.x,
      y: record.cell.y
    }))
  ];
  const obstacleBoundaryItems = [
    ...map.obstacles.flatMap(record => record.cells.map(cell => ({
      label: `obstacle:${record.kind}`,
      x: cell.x,
      y: cell.y
    }))),
    ...map.boundaries.flatMap(record => record.edges.map(edge => ({
      label: `boundary:${record.kind}`,
      x: edge.cell.x,
      y: edge.cell.y
    })))
  ];
  return {
    route: stableSha256(canonicalizeCoordinateItems(routeItems)),
    elevationAndRegions:
      stableSha256(canonicalizeCoordinateItems(elevationRegionItems)),
    formation: stableSha256(canonicalizeCoordinateItems(formationItems)),
    obstacleAndBoundary:
      stableSha256(canonicalizeCoordinateItems(obstacleBoundaryItems))
  };
}

function assertCompleteReleaseCorpus(release, maps) {
  if (release.entries.length !== 144 || maps.length !== 144) {
    fail(
      'complete release acceptance requires exactly 144 catalog maps',
      'INCOMPLETE_BATTLE_MAP_V3_CATALOG_CORPUS'
    );
  }
  const identities = new Set();
  const fullHashes = new Set();
  const mapsByTheme = new Map(
    BATTLE_MAP_V3_SUPPORTED_THEMES.map(theme => [theme, []])
  );
  for (const map of maps) {
    const identity = `${map.contentId}@${map.contentVersion}`;
    if (identities.has(identity) || fullHashes.has(map.hashes.fullHash)) {
      fail('complete release corpus contains a duplicate map identity or full hash');
    }
    identities.add(identity);
    fullHashes.add(map.hashes.fullHash);
    mapsByTheme.get(map.theme)?.push(map);
  }
  for (const theme of BATTLE_MAP_V3_SUPPORTED_THEMES) {
    const themeMaps = mapsByTheme.get(theme);
    if (themeMaps.length !== 9) {
      fail(`complete release theme ${theme} must contain exactly nine maps`);
    }
    const byTemplate = new Map();
    for (const map of themeMaps) {
      if (!byTemplate.has(map.templateId)) byTemplate.set(map.templateId, []);
      byTemplate.get(map.templateId).push(map);
    }
    if (byTemplate.size !== 3) {
      fail(`complete release theme ${theme} must contain exactly three templates`);
    }
    const templateCompositions = new Set();
    for (const [templateId, templateMaps] of byTemplate) {
      if (templateMaps.length !== 3) {
        fail(`complete release template ${templateId} must contain exactly three maps`);
      }
      for (const hashKey of ['authoritativeHash', 'visualHash', 'fullHash']) {
        if (new Set(templateMaps.map(map => map.hashes[hashKey])).size !== 3) {
          fail(`complete release template ${templateId} repeats ${hashKey}`);
        }
      }
      const signatures = templateMaps.map(authoredDiversitySignatures);
      for (const dimension of [
        'route',
        'elevationAndRegions',
        'formation',
        'obstacleAndBoundary'
      ]) {
        if (new Set(signatures.map(record => record[dimension])).size !== 3) {
          fail(
            `complete release template ${templateId} lacks ${dimension} diversity`
          );
        }
      }
      templateCompositions.add(stableSha256(
        signatures
          .map(signature => canonicalizeJson(signature))
          .sort()
      ));
    }
    if (templateCompositions.size !== 3) {
      fail(`complete release theme ${theme} repeats a template composition`);
    }
  }
  return { mapCount: maps.length, themeCount: mapsByTheme.size };
}

export async function buildCatalogRelease({
  projectRoot = SCRIPT_PROJECT_ROOT,
  releaseId,
  binaryMode = 'metadata',
  activate = false,
  checkOnly = false,
  requireCompleteCoverage = false
}) {
  safeId(releaseId, 'releaseId');
  if (!BINARY_MODES.has(binaryMode)) fail('binaryMode must be require or metadata');
  if (activate && binaryMode !== 'require') {
    fail('activating a catalog release requires restored local binary verification');
  }
  const root = path.resolve(projectRoot);
  const definitionPath = releaseDefinitionPath(releaseId);
  const { value: definition } = await readTrackedJson(
    root,
    definitionPath,
    'catalog definition'
  );
  validateCatalogDefinition(definition, releaseId);
  const strictBattleArtAlreadyVerified = binaryMode === 'require';
  if (strictBattleArtAlreadyVerified) await checkBattleArt({ root });
  const recipeCache = new Map();
  const verified = [];
  for (const entry of definition.entries) {
    verified.push(await verifyVisualApproval(root, entry, binaryMode, {
      recipeCache,
      strictBattleArtAlreadyVerified
    }));
  }
  const maps = verified.map(record => record.map);
  const entries = definition.entries
    .map((entry, index) => catalogEntryFromMap(releaseId, entry, maps[index]))
    .sort((left, right) => left.mapContentId.localeCompare(right.mapContentId));
  const assetPinMap = new Map();
  for (const map of maps) {
    const id = map.provenance.assetBundle.id;
    const hash = map.provenance.assetBundle.manifestFullHash;
    if (assetPinMap.has(id) && assetPinMap.get(id) !== hash) {
      fail(`catalog release mixes hashes for asset bundle ${id}`);
    }
    assetPinMap.set(id, hash);
  }
  const candidate = {
    catalogSchemaVersion: BATTLE_MAP_V3_CATALOG_SCHEMA_VERSION,
    catalogReleaseId: releaseId,
    selectorVersion: BATTLE_MAP_V3_SELECTOR_VERSION,
    assetBundlePins: [...assetPinMap]
      .map(([assetBundleId, manifestFullHash]) => ({
        assetBundleId,
        manifestFullHash
      }))
      .sort((left, right) => left.assetBundleId.localeCompare(right.assetBundleId)),
    entries
  };
  if (candidate.assetBundlePins.length !== 1) {
    fail('a deployed catalog release must bind exactly one frontend runtime asset bundle');
  }
  const release = await finalizeBattleMapV3CatalogRelease(candidate);
  await assertBattleMapV3CatalogMapPins(release, maps);
  if (release.entries.length !== maps.length) {
    fail('catalog release and active map set differ');
  }
  const corpus = requireCompleteCoverage
    ? assertCompleteReleaseCorpus(release, maps)
    : null;
  const coverage = await checkReleaseCoverage(release, definition, {
    requireComplete: requireCompleteCoverage
  });
  const releasePath = catalogReleasePath(releaseId);
  const releaseWrite = await atomicWrite(root, releasePath, jsonBytes(release), {
    immutable: true,
    checkOnly,
    label: 'immutable catalog release'
  });
  const activePin = {
    schemaVersion: ACTIVE_RELEASE_SCHEMA,
    catalogReleaseId: releaseId,
    catalogPath: releasePath,
    catalogFullHash: release.catalogFullHash,
    maps: [...maps]
      .sort((left, right) => left.contentId.localeCompare(right.contentId))
      .map(map => ({
        contentId: map.contentId,
        contentVersion: map.contentVersion,
        path: compiledMapPath(map.theme, map.contentId, map.contentVersion),
        fullHash: map.hashes.fullHash
      }))
  };
  let activeWrite = null;
  if (activate) {
    activeWrite = await atomicWrite(
      root,
      'battle-maps/catalog/active-release.json',
      jsonBytes(activePin),
      { checkOnly, label: 'tracked active catalog release pin' }
    );
  }
  return {
    ok: true,
    releaseId,
    releasePath,
    catalogFullHash: release.catalogFullHash,
    mapCount: maps.length,
    coverageQueryCount: coverage.queryCount,
    completeCoverageVerified: requireCompleteCoverage,
    completeCorpus: corpus,
    binaryMode,
    binaryEvidenceVerified: binaryMode === 'require',
    skippedBinaryChecks: verified.flatMap(record => record.skippedBinaryChecks),
    changed: releaseWrite.changed,
    active: activate,
    activeChanged: activeWrite?.changed ?? false
  };
}

function readArgumentValue(argv, index, flag, inline) {
  if (inline !== undefined) {
    if (inline.length === 0) fail(`${flag} requires a value`);
    return { value: inline, consumed: 0 };
  }
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) fail(`${flag} requires a value`);
  return { value, consumed: 1 };
}

function parseArgs(argv, allowed) {
  const options = {
    json: false,
    help: false,
    metadataOnly: false,
    checkOnly: false,
    activate: false,
    allApproved: false
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const equals = argument.indexOf('=');
    const flag = equals === -1 ? argument : argument.slice(0, equals);
    const inline = equals === -1 ? undefined : argument.slice(equals + 1);
    if (!allowed.has(flag) && !['--json', '--help', '-h'].includes(flag)) {
      fail(`Unknown argument: ${argument}`);
    }
    const once = (key, value) => {
      if (seen.has(flag)) fail(`${flag} may only be supplied once`);
      seen.add(flag);
      options[key] = value;
    };
    const valueFor = () => {
      const result = readArgumentValue(argv, index, flag, inline);
      index += result.consumed;
      return result.value;
    };
    if (flag === '--theme') once('theme', valueFor());
    else if (flag === '--template') once('templateId', valueFor());
    else if (flag === '--map') once('mapId', valueFor());
    else if (flag === '--screenshot') once('screenshotPath', valueFor());
    else if (flag === '--reviewer') once('reviewer', valueFor());
    else if (flag === '--release') once('releaseId', valueFor());
    else if (flag === '--project-root') once('projectRoot', path.resolve(valueFor()));
    else if (flag === '--metadata-only' && inline === undefined) once('metadataOnly', true);
    else if (flag === '--check' && inline === undefined) once('checkOnly', true);
    else if (flag === '--activate' && inline === undefined) once('activate', true);
    else if (flag === '--all-approved' && inline === undefined) once('allApproved', true);
    else if (flag === '--json' && inline === undefined) once('json', true);
    else if ((flag === '--help' || flag === '-h') && inline === undefined) once('help', true);
    else fail(`Unknown argument: ${argument}`);
  }
  return options;
}

export function parseCompileArgs(argv = process.argv.slice(2)) {
  const options = parseArgs(argv, new Set([
    '--theme',
    '--template',
    '--map',
    '--all-approved',
    '--metadata-only',
    '--check',
    '--project-root'
  ]));
  if (options.help) return options;
  supportedTheme(options.theme, '--theme');
  safeId(options.templateId, '--template');
  if ((options.mapId !== undefined) === options.allApproved) {
    fail('supply exactly one of --map or --all-approved');
  }
  if (options.mapId !== undefined) safeId(options.mapId, '--map');
  return {
    ...options,
    mapId: options.mapId ?? null,
    binaryMode: options.metadataOnly ? 'metadata' : 'require'
  };
}

export function parseApprovalArgs(argv = process.argv.slice(2)) {
  const options = parseArgs(argv, new Set([
    '--theme',
    '--template',
    '--map',
    '--screenshot',
    '--reviewer',
    '--project-root'
  ]));
  if (options.help) return options;
  supportedTheme(options.theme, '--theme');
  safeId(options.templateId, '--template');
  safeId(options.mapId, '--map');
  safeId(options.reviewer, '--reviewer');
  trackedPath(options.screenshotPath, '--screenshot');
  return options;
}

export function parseCatalogArgs(argv = process.argv.slice(2)) {
  const options = parseArgs(argv, new Set([
    '--release',
    '--metadata-only',
    '--activate',
    '--check',
    '--project-root'
  ]));
  if (options.help) return options;
  safeId(options.releaseId, '--release');
  if (options.activate && options.metadataOnly) {
    fail('--activate cannot be combined with --metadata-only');
  }
  return {
    ...options,
    binaryMode: options.metadataOnly ? 'metadata' : 'require'
  };
}

export const ContentReleaseInternals = Object.freeze({
  stableSha256,
  bytesSha256,
  trackedPath,
  resolveTracked,
  compileRecipePath,
  compiledMapPath,
  visualApprovalPath,
  releaseDefinitionPath,
  catalogReleasePath,
  compilerAssetBundleProjection,
  collectMapAssetRefs,
  assertExactMapAssets,
  assertMapRendererContracts,
  resolveRecipeArtBundle,
  validateCatalogDefinition,
  validateRecipeShape,
  validateApprovalIndex,
  validateBlueprintApproval,
  validateBlueprintApprovalRecord,
  blueprintPromptProfile,
  validateMapApprovalRecord,
  expandCoverageQueries,
  jsonBytes,
  assertNoSymlinkPath,
  validateSpawnCorpus,
  assertRuntimeBundleMirror,
  validateSourceSet,
  deriveMapCapabilityReport,
  assertCompleteReleaseCorpus,
  assertCapabilityClaims,
  validateBinaryPin,
  validateScreenshotEvidence,
  atomicWrite,
  readTrackedBytes,
  canonicalizeCoordinateItems,
  authoredDiversitySignatures
});
