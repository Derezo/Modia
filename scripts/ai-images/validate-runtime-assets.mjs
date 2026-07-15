#!/usr/bin/env node

/**
 * Runtime-derived asset coverage validator.
 *
 * This intentionally does not reuse the older image validators. It joins the
 * data the game actually consumes (player variants, enemy templates/spawns,
 * item templates, and the battle asset resolver) to the files shipped under
 * frontend/public/assets.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
export const ITEM_SIZES = Object.freeze([32, 64, 128]);
export const EXPECTED_ABILITY_ICON_COUNT = 164;
export const ABILITY_ICON_OUTPUT_PATTERN = '/assets/abilities/icons/{source}/{id}.webp';

const ITEM_CATEGORY_TYPES = Object.freeze({
  weapons: new Set(['weapon', 'sword', 'axe', 'staff', 'wand', 'bow', 'dagger', 'mace', 'polearm', 'fist']),
  armor: new Set(['armor', 'helmet', 'helm', 'body', 'boots', 'head', 'legs', 'feet', 'robe', 'shield']),
  accessories: new Set(['accessory', 'ring', 'amulet', 'cloak', 'belt', 'gloves', 'gauntlets']),
  consumables: new Set(['consumable', 'potion', 'scroll', 'material', 'food'])
});

const ISSUE_SEVERITIES = Object.freeze({
  error: 0,
  warning: 1,
  info: 2
});

function normalizePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function projectRelative(projectRoot, filePath) {
  return normalizePath(path.relative(projectRoot, filePath));
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function walkFiles(directory) {
  if (!(await pathExists(directory))) return [];

  const files = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(child));
    else if (entry.isFile()) files.push(child);
  }

  return files;
}

async function mapLimit(values, concurrency, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await mapper(values[index], index);
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    () => worker()
  ));
  return results;
}

function makeIssue(severity, code, scope, message, details = {}) {
  return { severity, code, scope, message, ...details };
}

function sortIssues(issues) {
  return issues.sort((a, b) => (
    ISSUE_SEVERITIES[a.severity] - ISSUE_SEVERITIES[b.severity]
    || a.scope.localeCompare(b.scope)
    || a.code.localeCompare(b.code)
    || String(a.id || a.path || '').localeCompare(String(b.id || b.path || ''))
    || String(a.animation || '').localeCompare(String(b.animation || ''))
  ));
}

/** Match the category routing used by frontend/src/components/ItemIcon.js. */
export function getRuntimeItemSubcategory(itemType) {
  const normalized = String(itemType || '').trim().toLowerCase();
  if (!normalized) return 'weapons';

  for (const [category, types] of Object.entries(ITEM_CATEGORY_TYPES)) {
    if (types.has(normalized)) return category;
  }
  return 'weapons';
}

export function publicAssetUrlToFile(projectRoot, assetUrl) {
  if (typeof assetUrl !== 'string' || !assetUrl.startsWith('/assets/')) return null;
  const relative = assetUrl.slice(1);
  const publicRoot = path.join(projectRoot, 'frontend', 'public');
  const resolved = path.resolve(publicRoot, relative);
  return resolved.startsWith(`${publicRoot}${path.sep}`) ? resolved : null;
}

export function playerSpriteContract(characterManifest) {
  const convention = characterManifest?.spriteConvention || {};
  const frameWidth = Number(convention.frameWidth);
  const frameHeight = Number(convention.frameHeight);
  const frameCount = Number(convention.framesPerAnimation);
  const width = Number(convention.sheetWidth);
  const height = Number(convention.sheetHeight);

  return {
    frameWidth,
    frameHeight,
    frameCount,
    width,
    height,
    layout: convention.layout
  };
}

export function validateSpriteContract(contract) {
  const problems = [];
  const required = {
    frameWidth: 64,
    frameHeight: 64,
    frameCount: 8,
    width: 64,
    height: 512
  };
  for (const key of ['frameWidth', 'frameHeight', 'frameCount', 'width', 'height']) {
    if (!Number.isInteger(contract[key]) || contract[key] <= 0) {
      problems.push(`${key} must be a positive integer`);
    } else if (contract[key] !== required[key]) {
      problems.push(`${key} must be ${required[key]} (received ${contract[key]})`);
    }
  }
  if (contract.layout !== 'vertical_strip') {
    problems.push(`layout must be vertical_strip (received ${String(contract.layout)})`);
  }
  if (contract.width !== contract.frameWidth) {
    problems.push('sheetWidth must equal frameWidth for a vertical strip');
  }
  if (contract.height !== contract.frameHeight * contract.frameCount) {
    problems.push('sheetHeight must equal frameHeight * framesPerAnimation');
  }
  return problems;
}

/**
 * Decode and inspect one runtime raster. Sprite sheets additionally verify
 * every vertical frame cell contains foreground and transparent background.
 */
export async function inspectRaster(filePath, options = {}) {
  const {
    width,
    height,
    format = 'webp',
    requireAlpha = true,
    frameWidth = width,
    frameHeight = height,
    frameCount = 1,
    animation = null,
    maxFrameForegroundCoverage = 0.6
  } = options;
  const problems = [];
  const warnings = [];

  try {
    const metadata = await sharp(filePath).metadata();
    if (format && metadata.format !== format) {
      problems.push({ code: 'image_format', message: `expected ${format}, received ${metadata.format || 'unknown'}` });
    }
    if (metadata.width !== width || metadata.height !== height) {
      problems.push({
        code: 'image_dimensions',
        message: `expected ${width}x${height}, received ${metadata.width || '?'}x${metadata.height || '?'}`
      });
    }
    if (requireAlpha && !metadata.hasAlpha) {
      problems.push({ code: 'image_alpha_channel', message: 'image has no alpha channel' });
    }

    const dimensionsMatch = metadata.width === width && metadata.height === height;
    if (dimensionsMatch && width > 0 && height > 0) {
      const { data, info } = await sharp(filePath)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const contentHash = crypto.createHash('sha256').update(data).digest('hex');
      const alphaOffset = info.channels - 1;
      const frameHashes = new Set();
      const frameForegroundCoverage = [];
      let globalMinAlpha = 255;
      let globalMaxAlpha = 0;

      for (let frame = 0; frame < frameCount; frame++) {
        const top = frame * frameHeight;
        const bottom = top + frameHeight;
        let minAlpha = 255;
        let maxAlpha = 0;
        let foregroundPixels = 0;
        const hash = crypto.createHash('sha1');

        for (let y = top; y < bottom; y++) {
          const start = y * width * info.channels;
          const end = start + frameWidth * info.channels;
          hash.update(data.subarray(start, end));
          for (let offset = start + alphaOffset; offset < end; offset += info.channels) {
            const alpha = data[offset];
            if (alpha > 0) foregroundPixels++;
            if (alpha < minAlpha) minAlpha = alpha;
            if (alpha > maxAlpha) maxAlpha = alpha;
          }
        }

        globalMinAlpha = Math.min(globalMinAlpha, minAlpha);
        globalMaxAlpha = Math.max(globalMaxAlpha, maxAlpha);
        frameHashes.add(hash.digest('hex'));
        const foregroundCoverage = foregroundPixels / (frameWidth * frameHeight);
        frameForegroundCoverage.push(foregroundCoverage);

        if (maxAlpha === 0) {
          problems.push({ code: 'sprite_blank_frame', message: `frame ${frame} is fully transparent`, frame });
        } else if (requireAlpha && minAlpha === 255) {
          problems.push({ code: 'sprite_opaque_frame', message: `frame ${frame} has no transparent background`, frame });
        } else if (frameCount > 1 && foregroundCoverage > maxFrameForegroundCoverage) {
          problems.push({
            code: 'sprite_background_residue',
            message: `frame ${frame} foreground covers ${(foregroundCoverage * 100).toFixed(1)}% (maximum ${(maxFrameForegroundCoverage * 100).toFixed(1)}%); likely retained backdrop or insufficient padding`,
            frame,
            foregroundCoverage,
            maxFrameForegroundCoverage
          });
        }
      }

      if (requireAlpha && globalMinAlpha === 255) {
        problems.push({ code: 'image_no_transparency', message: 'image contains no transparent pixels' });
      }
      if (globalMaxAlpha === 0) {
        problems.push({ code: 'image_empty', message: 'image is fully transparent' });
      }
      if (frameCount > 1 && frameHashes.size === 1 && animation !== 'dead') {
        warnings.push({ code: 'sprite_identical_frames', message: 'all temporal frames are byte-identical' });
      }

      return {
        valid: problems.length === 0,
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        hasAlpha: metadata.hasAlpha,
        uniqueFrames: frameHashes.size,
        frameForegroundCoverage,
        contentHash,
        problems,
        warnings
      };
    }

    return {
      valid: problems.length === 0,
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      hasAlpha: metadata.hasAlpha,
      uniqueFrames: null,
      frameForegroundCoverage: null,
      contentHash: null,
      problems,
      warnings
    };
  } catch (error) {
    return {
      valid: false,
      width: null,
      height: null,
      format: null,
      hasAlpha: null,
      uniqueFrames: null,
      frameForegroundCoverage: null,
      contentHash: null,
      problems: [{ code: 'image_decode', message: error.message }],
      warnings
    };
  }
}

async function inspectReference(filePath) {
  try {
    const metadata = await sharp(filePath).metadata();
    if (!metadata.width || !metadata.height || !metadata.format) {
      return { valid: false, message: 'reference has no decodable raster dimensions' };
    }
    return {
      valid: true,
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      hasAlpha: metadata.hasAlpha
    };
  } catch (error) {
    return { valid: false, message: error.message };
  }
}

async function loadRuntimeSources(projectRoot) {
  const importModule = relativePath => import(pathToFileURL(path.join(projectRoot, relativePath)).href);
  const [
    assetPaths,
    battleAssetConfig,
    enemyTemplatesModule,
    itemTemplatesModule,
    caravanItemsModule,
    playerMetadata,
    characterManifest,
    itemManifest,
    abilityRegistry,
    abilityManifest
  ] = await Promise.all([
    importModule('shared/assetPaths.js'),
    importModule('frontend/src/core/BattleAssetConfig.js'),
    importModule('api/src/db/templates/enemies.js'),
    importModule('api/src/db/templates/items.js'),
    importModule('api/src/db/templates/caravanItems.js'),
    readJson(path.join(projectRoot, 'ai-image-metadata/characters/player-variants.json')),
    readJson(path.join(projectRoot, 'ai-image-metadata/characters/manifest.json')),
    readJson(path.join(projectRoot, 'ai-image-metadata/items/manifest.json')),
    readJson(path.join(projectRoot, 'ai-image-metadata/abilities/abilities.json')),
    readJson(path.join(projectRoot, 'ai-image-metadata/abilities/manifest.json'))
  ]);

  const enemyMetadataFiles = (await walkFiles(path.join(projectRoot, 'ai-image-metadata/characters/enemies')))
    .filter(file => file.endsWith('.json'));
  const enemyMetadata = await Promise.all(enemyMetadataFiles.map(async file => ({
    file,
    data: await readJson(file)
  })));

  const itemMetadata = [];
  for (const [category, fileName] of Object.entries(itemManifest.categoryFiles || {})) {
    const file = path.join(projectRoot, 'ai-image-metadata/items', fileName);
    itemMetadata.push({ category, file, data: await readJson(file) });
  }

  return {
    assetPaths,
    battleAssetConfig,
    enemyTemplates: enemyTemplatesModule.ENEMY_TEMPLATES,
    itemTemplates: itemTemplatesModule.ITEM_TEMPLATES,
    caravanItems: caravanItemsModule.CARAVAN_ITEMS,
    playerMetadata,
    characterManifest,
    enemyMetadata,
    itemManifest,
    itemMetadata,
    abilityRegistry,
    abilityManifest
  };
}

function expectedPlayerSheetUrl(assetPaths, variant, animation) {
  return assetPaths.getPlayerCharacterPath(variant, { animation, extension: 'webp' });
}

function expectedPlayerFullBodyReferenceUrl(assetPaths, variant) {
  return assetPaths.getPlayerCharacterReferencePath(variant);
}

export function buildEnemySpriteCandidateUrls(
  enemyId,
  animation,
  spawnBiome,
  battleAssetConfig
) {
  const biomes = battleAssetConfig.getEnemySpriteBiomeCandidates(enemyId, spawnBiome);
  const animations = battleAssetConfig.getEnemySpriteAnimationCandidates(animation);
  const urls = [];
  for (const biome of biomes) {
    for (const candidateAnimation of animations) {
      urls.push(`/assets/characters/enemies/${biome}/${enemyId}/${enemyId}_${candidateAnimation}.webp`);
    }
  }
  return urls;
}

function runtimeItemRequirements(itemTemplates, caravanItems) {
  const requirements = new Map();
  const add = (item, source) => {
    const id = item.sprite_id || item.spriteId;
    const itemType = item.item_type || item.itemType || item.type;
    const category = getRuntimeItemSubcategory(itemType);
    const key = `${category}/${id}`;
    if (!requirements.has(key)) {
      requirements.set(key, { id, category, consumers: [] });
    }
    requirements.get(key).consumers.push({
      source,
      id: item.id || null,
      name: item.name || null,
      itemType: itemType || null
    });
  };

  for (const item of itemTemplates) add(item, 'standard');
  for (const item of caravanItems) add(item, 'caravan');
  return [...requirements.values()].sort((a, b) => (
    a.category.localeCompare(b.category) || a.id.localeCompare(b.id)
  ));
}

export function getCanonicalAbilityIconPath(ability = {}) {
  const source = String(ability.source || '').trim().toLowerCase();
  const id = String(ability.id || '').trim().toLowerCase();
  if (!/^(player|monster|zodiac)$/.test(source) || !/^[a-z0-9_]+$/.test(id)) return null;
  return ABILITY_ICON_OUTPUT_PATTERN
    .replace('{source}', source)
    .replace('{id}', id);
}

/** Inspect one canonical ability icon without assuming a generated pixel size. */
export async function inspectAbilityIconRaster(filePath) {
  let metadata;
  try {
    metadata = await sharp(filePath).metadata();
  } catch (error) {
    return {
      valid: false,
      width: null,
      height: null,
      format: null,
      hasAlpha: null,
      uniqueFrames: null,
      frameForegroundCoverage: null,
      contentHash: null,
      problems: [{ code: 'image_decode', message: error.message }],
      warnings: []
    };
  }

  const width = Number(metadata.width);
  const height = Number(metadata.height);
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    return {
      valid: false,
      width: metadata.width || null,
      height: metadata.height || null,
      format: metadata.format || null,
      hasAlpha: metadata.hasAlpha ?? null,
      uniqueFrames: null,
      frameForegroundCoverage: null,
      contentHash: null,
      problems: [{ code: 'ability_icon_dimensions', message: 'ability icon has invalid raster dimensions' }],
      warnings: []
    };
  }

  const inspection = await inspectRaster(filePath, {
    width,
    height,
    format: 'webp',
    requireAlpha: true,
    frameWidth: width,
    frameHeight: height,
    frameCount: 1
  });
  if (width !== height) {
    inspection.problems.push({
      code: 'ability_icon_not_square',
      message: `ability icon must be square, received ${width}x${height}`
    });
    inspection.valid = false;
  }
  return inspection;
}

function countRecordsBy(records, key) {
  const counts = {};
  for (const record of records) {
    const value = String(record?.[key] ?? 'none');
    counts[value] = (counts[value] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function objectsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Validate the deterministic ability icon registry against public assets. */
export async function validateAbilityAssets(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || DEFAULT_PROJECT_ROOT);
  const publicAssets = path.join(projectRoot, 'frontend/public/assets');
  const registry = options.registry || {};
  const manifest = options.manifest || {};
  const expectedTotal = options.expectedTotal ?? EXPECTED_ABILITY_ICON_COUNT;
  const abilities = Array.isArray(registry.abilities) ? registry.abilities : [];
  const issues = [];
  const checks = {
    icons: [],
    missingFiles: [],
    invalidFiles: [],
    metadataMismatches: [],
    orphanFiles: []
  };
  const referencedAbilityFiles = new Set();
  const filesToInspect = new Map();

  const recordMismatch = (code, message, details = {}) => {
    checks.metadataMismatches.push({ code, ...details });
    issues.push(makeIssue('error', code, 'abilities', message, details));
  };

  if (manifest.iconOutputPattern !== ABILITY_ICON_OUTPUT_PATTERN) {
    recordMismatch(
      'ability_manifest_output_pattern_mismatch',
      `ability manifest output pattern must be ${ABILITY_ICON_OUTPUT_PATTERN}`,
      { actual: manifest.iconOutputPattern || null, expected: ABILITY_ICON_OUTPUT_PATTERN }
    );
  }
  if (abilities.length !== expectedTotal) {
    recordMismatch(
      'ability_expected_count_mismatch',
      `expected ${expectedTotal} canonical ability icons but registry contains ${abilities.length}`,
      { actual: abilities.length, expected: expectedTotal }
    );
  }
  if (registry.totalAbilities !== abilities.length) {
    recordMismatch(
      'ability_registry_count_mismatch',
      `ability registry declares ${String(registry.totalAbilities)} entries but contains ${abilities.length}`,
      { declared: registry.totalAbilities ?? null, actual: abilities.length }
    );
  }
  if (manifest.totalAbilities !== abilities.length) {
    recordMismatch(
      'ability_manifest_count_mismatch',
      `ability manifest declares ${String(manifest.totalAbilities)} entries but registry contains ${abilities.length}`,
      { declared: manifest.totalAbilities ?? null, actual: abilities.length }
    );
  }

  const idOccurrences = new Map();
  const pathOccurrences = new Map();
  for (const ability of abilities) {
    const idKey = String(ability.id || '');
    if (!idOccurrences.has(idKey)) idOccurrences.set(idKey, []);
    idOccurrences.get(idKey).push({ source: ability.source || null, owner: ability.owner || null });

    const expectedUrl = getCanonicalAbilityIconPath(ability);
    const declaredUrl = ability.iconAssetPath || null;
    const iconCheck = {
      id: ability.id || null,
      source: ability.source || null,
      url: expectedUrl,
      declaredUrl,
      path: null,
      exists: false,
      valid: false
    };
    checks.icons.push(iconCheck);

    if (!expectedUrl) {
      recordMismatch(
        'ability_identity_invalid',
        `ability has an invalid canonical source or ID: ${String(ability.source)}/${String(ability.id)}`,
        { id: ability.id || null, source: ability.source || null }
      );
      continue;
    }
    if (!pathOccurrences.has(expectedUrl)) pathOccurrences.set(expectedUrl, []);
    pathOccurrences.get(expectedUrl).push({ id: ability.id, source: ability.source });

    if (declaredUrl !== expectedUrl) {
      recordMismatch(
        'ability_icon_path_mismatch',
        `${ability.source}/${ability.id} declares a noncanonical icon path`,
        { id: ability.id, source: ability.source, actual: declaredUrl, expected: expectedUrl }
      );
    }

    const file = publicAssetUrlToFile(projectRoot, expectedUrl);
    const relative = projectRelative(projectRoot, file);
    const exists = await pathExists(file);
    iconCheck.path = relative;
    iconCheck.exists = exists;
    referencedAbilityFiles.add(file);

    if (ability.statusOverlayAssetPath?.startsWith('/assets/abilities/')) {
      const overlayFile = publicAssetUrlToFile(projectRoot, ability.statusOverlayAssetPath);
      if (overlayFile) referencedAbilityFiles.add(overlayFile);
    }

    if (!exists) {
      const missing = {
        id: ability.id,
        source: ability.source,
        url: expectedUrl,
        path: relative
      };
      checks.missingFiles.push(missing);
      issues.push(makeIssue(
        'error',
        'ability_icon_missing',
        'abilities',
        `${ability.source}/${ability.id} is missing its canonical ability icon`,
        missing
      ));
    } else {
      filesToInspect.set(file, {
        id: ability.id,
        source: ability.source,
        path: relative,
        scope: 'abilities',
        iconCheck
      });
    }

    if (typeof ability.generated !== 'boolean' || ability.generated !== exists) {
      recordMismatch(
        'ability_generated_status_mismatch',
        `${ability.source}/${ability.id} generated=${String(ability.generated)} file=${exists ? 'present' : 'missing'}`,
        {
          id: ability.id,
          source: ability.source,
          path: relative,
          metadataGenerated: typeof ability.generated === 'boolean' ? ability.generated : null,
          fileExists: exists
        }
      );
    }
    if (!exists && ability.needsRegeneration === true) {
      recordMismatch(
        'ability_regeneration_status_mismatch',
        `${ability.source}/${ability.id} cannot need regeneration while its icon is missing`,
        { id: ability.id, source: ability.source, path: relative }
      );
    }

    const expectedStatus = exists
      ? (ability.needsRegeneration === true ? 'needs_regeneration' : 'generated')
      : 'missing';
    if (ability.status !== expectedStatus) {
      recordMismatch(
        'ability_status_mismatch',
        `${ability.source}/${ability.id} status=${String(ability.status)} but disk state requires ${expectedStatus}`,
        { id: ability.id, source: ability.source, actual: ability.status ?? null, expected: expectedStatus }
      );
    }
    if (!exists && ability.generatedAt !== null && ability.generatedAt !== undefined) {
      recordMismatch(
        'ability_generated_at_mismatch',
        `${ability.source}/${ability.id} has generatedAt metadata while its icon is missing`,
        { id: ability.id, source: ability.source, generatedAt: ability.generatedAt }
      );
    }
  }

  for (const [id, occurrences] of idOccurrences) {
    if (id && occurrences.length === 1) continue;
    recordMismatch(
      id ? 'ability_duplicate_id' : 'ability_id_missing',
      id ? `ability ID ${id} occurs ${occurrences.length} times` : 'ability registry contains an entry without an ID',
      { id: id || null, occurrences }
    );
  }
  for (const [iconPath, occurrences] of pathOccurrences) {
    if (occurrences.length === 1) continue;
    recordMismatch(
      'ability_duplicate_icon_path',
      `ability icon path ${iconPath} is shared by ${occurrences.length} registry entries`,
      { path: iconPath, occurrences }
    );
  }

  const inspections = await mapLimit([...filesToInspect], 8, async ([file, details]) => ({
    details,
    inspection: await inspectAbilityIconRaster(file)
  }));
  for (const { details, inspection } of inspections) {
    details.iconCheck.valid = inspection.valid;
    details.iconCheck.inspection = inspection;
    const serializableDetails = {
      id: details.id,
      source: details.source,
      path: details.path,
      scope: details.scope
    };
    if (!inspection.valid) checks.invalidFiles.push({ ...serializableDetails, inspection });
    addRasterInspectionIssues(issues, inspection, serializableDetails);
  }

  const actualCountsBySource = countRecordsBy(abilities, 'source');
  if (!objectsEqual(manifest.countsBySource || {}, actualCountsBySource)) {
    recordMismatch(
      'ability_manifest_source_count_mismatch',
      'ability manifest countsBySource does not match the registry',
      { declared: manifest.countsBySource || {}, actual: actualCountsBySource }
    );
  }

  const presentIcons = checks.icons.filter(icon => icon.exists).length;
  const generatedIcons = presentIcons;
  const needsRegeneration = abilities.filter(ability => ability.needsRegeneration === true && (
    checks.icons.find(icon => icon.id === ability.id && icon.source === ability.source)?.exists
  )).length;
  const manifestCounts = [
    ['generatedAbilities', generatedIcons, 'ability_manifest_generated_count_mismatch'],
    ['missingAbilities', abilities.length - generatedIcons, 'ability_manifest_missing_count_mismatch'],
    ['needsRegeneration', needsRegeneration, 'ability_manifest_regeneration_count_mismatch']
  ];
  for (const [field, expected, code] of manifestCounts) {
    if (manifest[field] !== expected) {
      recordMismatch(
        code,
        `ability manifest ${field}=${String(manifest[field])} but disk state requires ${expected}`,
        { field, declared: manifest[field] ?? null, actual: expected }
      );
    }
  }

  for (const overlay of Object.values(manifest.statusOverlays || {})) {
    for (const assetUrl of [overlay.assetPath, overlay.fallbackAssetPath]) {
      if (!assetUrl?.startsWith('/assets/abilities/')) continue;
      const file = publicAssetUrlToFile(projectRoot, assetUrl);
      if (file) referencedAbilityFiles.add(file);
    }
    if (!overlay.assetPath?.startsWith('/assets/abilities/')) continue;
    const file = publicAssetUrlToFile(projectRoot, overlay.assetPath);
    const exists = file ? await pathExists(file) : false;
    if (typeof overlay.generated !== 'boolean' || overlay.generated !== exists) {
      recordMismatch(
        'ability_status_overlay_status_mismatch',
        `${overlay.assetPath} generated=${String(overlay.generated)} file=${exists ? 'present' : 'missing'}`,
        {
          path: overlay.assetPath,
          metadataGenerated: typeof overlay.generated === 'boolean' ? overlay.generated : null,
          fileExists: exists
        }
      );
    }
    const expectedStatus = exists ? 'generated' : 'missing';
    if (overlay.status !== expectedStatus) {
      recordMismatch(
        'ability_status_overlay_state_mismatch',
        `${overlay.assetPath} status=${String(overlay.status)} but disk state requires ${expectedStatus}`,
        { path: overlay.assetPath, actual: overlay.status ?? null, expected: expectedStatus }
      );
    }
  }

  const abilityAssetRoot = path.join(publicAssets, 'abilities');
  const allAbilityFiles = await walkFiles(abilityAssetRoot);
  for (const file of allAbilityFiles) {
    if (referencedAbilityFiles.has(file)) continue;
    const orphan = { path: projectRelative(projectRoot, file) };
    checks.orphanFiles.push(orphan);
    issues.push(makeIssue(
      'warning',
      'ability_orphan_file',
      'abilities',
      `ability asset is not referenced by the deterministic registry or manifest: ${orphan.path}`,
      orphan
    ));
  }

  return {
    checks,
    issues: sortIssues(issues),
    summary: {
      registryEntries: abilities.length,
      expectedIcons: expectedTotal,
      presentIcons,
      validIcons: presentIcons - checks.invalidFiles.length,
      metadataMismatches: checks.metadataMismatches.length,
      orphanFiles: checks.orphanFiles.length
    }
  };
}

function addRasterInspectionIssues(issues, inspection, baseDetails) {
  for (const problem of inspection.problems) {
    const { code, message, ...problemDetails } = problem;
    issues.push(makeIssue(
      'error',
      code,
      baseDetails.scope,
      `${baseDetails.path}: ${message}`,
      { ...baseDetails, ...problemDetails }
    ));
  }
  for (const warning of inspection.warnings) {
    const { code, message, ...warningDetails } = warning;
    issues.push(makeIssue(
      'warning',
      code,
      baseDetails.scope,
      `${baseDetails.path}: ${message}`,
      { ...baseDetails, ...warningDetails }
    ));
  }
}

/** Build a complete runtime coverage report. */
export async function createRuntimeAssetReport(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || DEFAULT_PROJECT_ROOT);
  const sources = options.sources || await loadRuntimeSources(projectRoot);
  const publicAssets = path.join(projectRoot, 'frontend/public/assets');
  const issues = [];
  const contract = playerSpriteContract(sources.characterManifest);
  const contractProblems = validateSpriteContract(contract);
  for (const problem of contractProblems) {
    issues.push(makeIssue('error', 'sprite_contract', 'metadata', problem, {
      path: 'ai-image-metadata/characters/manifest.json'
    }));
  }

  const checks = {
    players: {
      variants: [],
      missingSheets: [],
      invalidSheets: [],
      duplicateSheets: [],
      portraitCards: [],
      portraitReferences: [],
      identityReferences: [],
      identitySources: [],
      fullBodyReferences: [],
      metadataMismatches: [],
      orphanFiles: [],
      legacyFallbackFiles: []
    },
    enemies: {
      templates: [],
      lookups: [],
      invalidSheets: [],
      metadataMismatches: [],
      orphanMetadata: [],
      orphanFiles: []
    },
    items: {
      requirements: [],
      missingFiles: [],
      invalidFiles: [],
      metadataMismatches: [],
      orphanMetadata: [],
      orphanFiles: []
    },
    abilities: {
      icons: [],
      missingFiles: [],
      invalidFiles: [],
      metadataMismatches: [],
      orphanFiles: []
    }
  };

  // -----------------------------------------------------------------------
  // Players: registry identity, declared references, canonical sheets/status.
  // -----------------------------------------------------------------------
  const playerVariants = sources.playerMetadata.variants || [];
  const expectedPlayerFiles = new Set();
  const playerFilesToInspect = new Map();
  const playerIds = new Set();
  const referenceInspectionCache = new Map();

  if (sources.playerMetadata.totalVariants !== playerVariants.length) {
    issues.push(makeIssue(
      'error',
      'player_variant_count',
      'players',
      `metadata declares ${sources.playerMetadata.totalVariants} variants but contains ${playerVariants.length}`,
      { path: 'ai-image-metadata/characters/player-variants.json' }
    ));
  }

  for (const variant of playerVariants) {
    const derivedIdentity = sources.assetPaths.getPlayerCharacterIdentity(variant);
    const variantCheck = {
      id: variant.id,
      race: variant.race,
      gender: variant.gender,
      class: variant.class,
      animations: [...(variant.animations || [])],
      presentSheets: [],
      missingSheets: []
    };
    checks.players.variants.push(variantCheck);

    if (playerIds.has(variant.id)) {
      issues.push(makeIssue('error', 'player_duplicate_identity', 'players', `duplicate player variant ${variant.id}`, { id: variant.id }));
    }
    playerIds.add(variant.id);

    if (variant.id !== derivedIdentity.id) {
      issues.push(makeIssue(
        'error',
        'player_identity_mismatch',
        'players',
        `${variant.id} does not match derived identity ${derivedIdentity.id}`,
        { id: variant.id, expectedId: derivedIdentity.id }
      ));
    }

    const expectedPortraitCard = sources.assetPaths.getAssetPath('portraits', variant.id, { size: 256 });
    const expectedPortraitReference = sources.assetPaths.getOriginalsPath('portraits', variant.id);
    if (variant.portraitCard !== expectedPortraitCard) {
      issues.push(makeIssue(
        'error',
        'player_portrait_card_identity_mismatch',
        'players',
        `${variant.id} portrait card points at another or noncanonical identity`,
        { id: variant.id, actual: variant.portraitCard || null, expected: expectedPortraitCard }
      ));
    }
    if (variant.portraitReference !== expectedPortraitReference) {
      issues.push(makeIssue(
        'error',
        'player_portrait_reference_identity_mismatch',
        'players',
        `${variant.id} portrait reference points at another or noncanonical identity`,
        { id: variant.id, actual: variant.portraitReference || null, expected: expectedPortraitReference }
      ));
    }

    const referenceRoles = [
      {
        role: 'portrait_card',
        label: 'portrait card',
        url: variant.portraitCard,
        collection: checks.players.portraitCards
      },
      {
        role: 'portrait_reference',
        label: 'portrait reference',
        url: variant.portraitReference,
        collection: checks.players.portraitReferences
      },
      {
        role: 'identity_reference',
        label: 'animation identity reference',
        // This mirrors generate-characters.js: referenceImage first, then
        // portraitReference. identitySource is provenance and checked below.
        url: variant.sd15Config?.referenceImage || variant.portraitReference,
        collection: checks.players.identityReferences
      },
      {
        role: 'identity_source',
        label: 'identity provenance source',
        url: variant.sd15Config?.identitySource || variant.portraitReference,
        collection: checks.players.identitySources
      }
    ];

    for (const reference of referenceRoles) {
      const file = publicAssetUrlToFile(projectRoot, reference.url);
      const relative = file ? projectRelative(projectRoot, file) : String(reference.url || '');
      const result = { id: variant.id, url: reference.url || null, path: relative, valid: false };
      if (!file || !(await pathExists(file))) {
        result.missing = true;
        issues.push(makeIssue(
          'error',
          `player_${reference.role}_missing`,
          'players',
          `${variant.id} ${reference.label} is missing: ${relative || '(undeclared)'}`,
          { id: variant.id, path: relative || null, url: reference.url || null }
        ));
      } else {
        if (!referenceInspectionCache.has(file)) {
          referenceInspectionCache.set(file, inspectReference(file));
        }
        const inspection = await referenceInspectionCache.get(file);
        Object.assign(result, inspection);
        if (!inspection.valid) {
          issues.push(makeIssue(
            'error',
            `player_${reference.role}_invalid`,
            'players',
            `${variant.id} ${reference.label} cannot be decoded: ${inspection.message}`,
            { id: variant.id, path: relative }
          ));
        }
      }
      reference.collection.push(result);
    }

    const fullBodyUrl = expectedPlayerFullBodyReferenceUrl(sources.assetPaths, variant);
    const fullBodyFile = publicAssetUrlToFile(projectRoot, fullBodyUrl);
    const fullBodyRelative = projectRelative(projectRoot, fullBodyFile);
    const fullBodyResult = { id: variant.id, url: fullBodyUrl, path: fullBodyRelative, valid: false };
    if (!(await pathExists(fullBodyFile))) {
      fullBodyResult.missing = true;
      issues.push(makeIssue(
        'error',
        'player_full_body_reference_missing',
        'players',
        `${variant.id} has no canonical full-body identity reference`,
        { id: variant.id, path: fullBodyRelative }
      ));
    } else {
      const inspection = await inspectReference(fullBodyFile);
      Object.assign(fullBodyResult, inspection);
      if (!inspection.valid) {
        issues.push(makeIssue(
          'error',
          'player_full_body_reference_invalid',
          'players',
          `${variant.id} full-body reference cannot be decoded: ${inspection.message}`,
          { id: variant.id, path: fullBodyRelative }
        ));
      }
    }
    checks.players.fullBodyReferences.push(fullBodyResult);

    const animations = Array.isArray(variant.animations) ? variant.animations : [];
    if (animations.length === 0) {
      issues.push(makeIssue('error', 'player_animations_empty', 'players', `${variant.id} has no expected animations`, { id: variant.id }));
    }

    let allExpectedSheetsExist = animations.length > 0;
    for (const animation of animations) {
      if (!sources.characterManifest.animations?.[animation]) {
        issues.push(makeIssue(
          'error',
          'player_animation_undefined',
          'players',
          `${variant.id} references animation not defined in the character manifest: ${animation}`,
          { id: variant.id, animation }
        ));
      }

      const url = expectedPlayerSheetUrl(sources.assetPaths, variant, animation);
      const file = publicAssetUrlToFile(projectRoot, url);
      const relative = projectRelative(projectRoot, file);
      const exists = await pathExists(file);
      expectedPlayerFiles.add(file);

      if (exists) {
        variantCheck.presentSheets.push(animation);
        playerFilesToInspect.set(file, { id: variant.id, animation, path: relative, scope: 'players' });
      } else {
        allExpectedSheetsExist = false;
        variantCheck.missingSheets.push(animation);
        const missing = { id: variant.id, animation, url, path: relative };
        checks.players.missingSheets.push(missing);
        issues.push(makeIssue(
          'error',
          'player_sheet_missing',
          'players',
          `${variant.id} is missing ${animation}: ${relative}`,
          missing
        ));
      }

      const status = variant.generatedAnimations?.[animation];
      if (typeof status !== 'boolean' || status !== exists) {
        const mismatch = {
          id: variant.id,
          animation,
          path: relative,
          metadataGenerated: typeof status === 'boolean' ? status : null,
          fileExists: exists
        };
        checks.players.metadataMismatches.push(mismatch);
        issues.push(makeIssue(
          'error',
          'player_animation_status_mismatch',
          'players',
          `${variant.id}/${animation} metadata=${String(status)} file=${exists ? 'present' : 'missing'}`,
          mismatch
        ));
      }
    }

    if (Boolean(variant.generated) !== allExpectedSheetsExist) {
      const mismatch = {
        id: variant.id,
        metadataGenerated: Boolean(variant.generated),
        allExpectedSheetsExist
      };
      checks.players.metadataMismatches.push(mismatch);
      issues.push(makeIssue(
        'error',
        'player_generated_status_mismatch',
        'players',
        `${variant.id} generated=${Boolean(variant.generated)} but complete canonical sheet coverage=${allExpectedSheetsExist}`,
        mismatch
      ));
    }
  }

  if (contractProblems.length === 0) {
    const inspections = await mapLimit([...playerFilesToInspect], 6, async ([file, details]) => ({
      file,
      details,
      inspection: await inspectRaster(file, {
        width: contract.width,
        height: contract.height,
        frameWidth: contract.frameWidth,
        frameHeight: contract.frameHeight,
        frameCount: contract.frameCount,
        animation: details.animation
      })
    }));
    const playerSheetsByContent = new Map();
    for (const { details, inspection } of inspections) {
      if (!inspection.valid) checks.players.invalidSheets.push({ ...details, inspection });
      addRasterInspectionIssues(issues, inspection, details);
      if (inspection.contentHash) {
        if (!playerSheetsByContent.has(inspection.contentHash)) playerSheetsByContent.set(inspection.contentHash, []);
        playerSheetsByContent.get(inspection.contentHash).push(details);
      }
    }
    for (const [contentHash, sheets] of playerSheetsByContent) {
      if (new Set(sheets.map(sheet => sheet.id)).size <= 1) continue;
      const duplicate = {
        contentHash,
        sheets: sheets.map(({ id, animation, path: sheetPath }) => ({ id, animation, path: sheetPath }))
      };
      checks.players.duplicateSheets.push(duplicate);
      issues.push(makeIssue(
        'error',
        'player_duplicate_sheet_content',
        'players',
        `canonical sheets for different player identities decode to identical pixels`,
        duplicate
      ));
    }
  }

  // -----------------------------------------------------------------------
  // Enemies: API templates + every spawn biome through the runtime resolver.
  // -----------------------------------------------------------------------
  const resolvedEnemyFiles = new Map();
  const enemyTemplateIds = new Set();
  for (const enemy of sources.enemyTemplates) {
    const enemyId = enemy.sprite_id;
    enemyTemplateIds.add(enemyId);
    const spawnBiomes = [...new Set(enemy.spawn_node_types || [])];
    checks.enemies.templates.push({ id: enemyId, name: enemy.name, spawnBiomes });

    for (const spawnBiome of spawnBiomes) {
      for (const animation of sources.battleAssetConfig.ENEMY_ANIMATIONS) {
        const candidateUrls = buildEnemySpriteCandidateUrls(
          enemyId,
          animation,
          spawnBiome,
          sources.battleAssetConfig
        );
        let resolved = null;
        for (const url of candidateUrls) {
          const file = publicAssetUrlToFile(projectRoot, url);
          if (await pathExists(file)) {
            resolved = { url, file, path: projectRelative(projectRoot, file) };
            break;
          }
        }

        const lookup = {
          id: enemyId,
          spawnBiome,
          animation,
          candidates: candidateUrls,
          resolved: resolved?.url || null,
          path: resolved?.path || null
        };
        checks.enemies.lookups.push(lookup);

        if (!resolved) {
          issues.push(makeIssue(
            'error',
            'enemy_animation_unresolved',
            'enemies',
            `${enemyId}/${spawnBiome}/${animation} has no runtime-resolvable sheet`,
            lookup
          ));
        } else if (!resolvedEnemyFiles.has(resolved.file)) {
          const resolvedAnimation = path.basename(resolved.file, '.webp').slice(`${enemyId}_`.length);
          resolvedEnemyFiles.set(resolved.file, {
            id: enemyId,
            animation: resolvedAnimation,
            logicalAnimations: new Set([animation]),
            path: resolved.path,
            scope: 'enemies'
          });
        } else {
          resolvedEnemyFiles.get(resolved.file).logicalAnimations.add(animation);
        }
      }
    }
  }

  const zoneIdentityGroups = new Map();
  for (const lookup of checks.enemies.lookups.filter(value => value.resolved)) {
    const key = `${lookup.id}/${lookup.animation}`;
    if (!zoneIdentityGroups.has(key)) zoneIdentityGroups.set(key, new Set());
    zoneIdentityGroups.get(key).add(lookup.resolved);
  }
  for (const [key, paths] of zoneIdentityGroups) {
    if (paths.size > 1) {
      const [id, animation] = key.split('/');
      issues.push(makeIssue(
        'error',
        'enemy_cross_zone_identity_split',
        'enemies',
        `${id}/${animation} resolves to different artwork across spawn zones`,
        { id, animation, resolvedPaths: [...paths].sort() }
      ));
    }
  }

  if (contractProblems.length === 0) {
    const inspections = await mapLimit([...resolvedEnemyFiles], 6, async ([file, details]) => ({
      details,
      inspection: await inspectRaster(file, {
        width: contract.width,
        height: contract.height,
        frameWidth: contract.frameWidth,
        frameHeight: contract.frameHeight,
        frameCount: contract.frameCount,
        animation: details.animation
      })
    }));
    for (const { details, inspection } of inspections) {
      const serializableDetails = {
        ...details,
        logicalAnimations: [...details.logicalAnimations].sort()
      };
      if (!inspection.valid) checks.enemies.invalidSheets.push({ ...serializableDetails, inspection });
      addRasterInspectionIssues(issues, inspection, serializableDetails);
    }
  }

  // Enemy metadata parity is evaluated at the resolver's canonical biome for
  // runtime IDs, and at the declared biome for metadata-only enemies.
  const enemyMetadataEntries = [];
  for (const metadataFile of sources.enemyMetadata) {
    const declaredBiome = metadataFile.data.biome;
    for (const enemy of metadataFile.data.enemies || []) {
      enemyMetadataEntries.push({
        enemy,
        declaredBiome,
        metadataFile: projectRelative(projectRoot, metadataFile.file)
      });
    }
  }

  const enemyMetadataById = new Map();
  for (const entry of enemyMetadataEntries) {
    if (!enemyMetadataById.has(entry.enemy.id)) enemyMetadataById.set(entry.enemy.id, []);
    enemyMetadataById.get(entry.enemy.id).push(entry);
  }
  for (const enemyId of enemyTemplateIds) {
    const entries = enemyMetadataById.get(enemyId) || [];
    if (entries.length === 0) {
      const mismatch = { id: enemyId };
      checks.enemies.metadataMismatches.push(mismatch);
      issues.push(makeIssue(
        'error',
        'enemy_metadata_missing',
        'enemies',
        `${enemyId} is used by an API enemy template but has no generation metadata`,
        mismatch
      ));
    } else if (entries.length > 1) {
      const mismatch = {
        id: enemyId,
        metadataFiles: entries.map(entry => entry.metadataFile).sort()
      };
      checks.enemies.metadataMismatches.push(mismatch);
      issues.push(makeIssue(
        'error',
        'enemy_metadata_duplicate',
        'enemies',
        `${enemyId} has multiple generation metadata definitions`,
        mismatch
      ));
    }
  }
  for (const entry of enemyMetadataEntries) {
    if (enemyTemplateIds.has(entry.enemy.id)) continue;
    const orphan = {
      id: entry.enemy.id,
      declaredBiome: entry.declaredBiome,
      metadataFile: entry.metadataFile
    };
    checks.enemies.orphanMetadata.push(orphan);
    issues.push(makeIssue(
      'warning',
      'enemy_orphan_metadata',
      'enemies',
      `${entry.enemy.id} has generation metadata but no API enemy template`,
      orphan
    ));
  }

  for (const entry of enemyMetadataEntries) {
    const primaryBiome = sources.battleAssetConfig.ENEMY_PRIMARY_BIOMES?.[entry.enemy.id];
    const canonicalBiome = primaryBiome || entry.declaredBiome;
    if (primaryBiome && entry.declaredBiome !== primaryBiome) {
      const mismatch = {
        id: entry.enemy.id,
        declaredBiome: entry.declaredBiome,
        canonicalBiome: primaryBiome,
        metadataFile: entry.metadataFile
      };
      checks.enemies.metadataMismatches.push(mismatch);
      issues.push(makeIssue(
        'error',
        'enemy_metadata_biome_mismatch',
        'enemies',
        `${entry.enemy.id} metadata biome ${entry.declaredBiome} differs from runtime canonical biome ${primaryBiome}`,
        mismatch
      ));
    }

    const animations = Object.keys(entry.enemy.animations || {});
    let allFilesExist = animations.length > 0;
    for (const animation of animations) {
      const file = path.join(
        publicAssets,
        'characters/enemies',
        canonicalBiome,
        entry.enemy.id,
        `${entry.enemy.id}_${animation}.webp`
      );
      const exists = await pathExists(file);
      if (!exists) allFilesExist = false;
      const status = entry.enemy.generatedAnimations?.[animation];
      if (typeof status !== 'boolean' || status !== exists) {
        const mismatch = {
          id: entry.enemy.id,
          animation,
          canonicalBiome,
          path: projectRelative(projectRoot, file),
          metadataFile: entry.metadataFile,
          metadataGenerated: typeof status === 'boolean' ? status : null,
          fileExists: exists
        };
        checks.enemies.metadataMismatches.push(mismatch);
        issues.push(makeIssue(
          'error',
          'enemy_animation_status_mismatch',
          'enemies',
          `${entry.enemy.id}/${animation} metadata=${String(status)} file=${exists ? 'present' : 'missing'}`,
          mismatch
        ));
      }
    }

    if (Boolean(entry.enemy.generated) !== allFilesExist) {
      const mismatch = {
        id: entry.enemy.id,
        canonicalBiome,
        metadataFile: entry.metadataFile,
        metadataGenerated: Boolean(entry.enemy.generated),
        allDeclaredFilesExist: allFilesExist
      };
      checks.enemies.metadataMismatches.push(mismatch);
      issues.push(makeIssue(
        'error',
        'enemy_generated_status_mismatch',
        'enemies',
        `${entry.enemy.id} generated=${Boolean(entry.enemy.generated)} but complete canonical sheet coverage=${allFilesExist}`,
        mismatch
      ));
    }
  }

  // -----------------------------------------------------------------------
  // Items: standard and caravan consumers, runtime categories, every size.
  // -----------------------------------------------------------------------
  const itemRequirements = runtimeItemRequirements(sources.itemTemplates, sources.caravanItems);
  const runtimeItemKeys = new Set(itemRequirements.map(requirement => `${requirement.category}/${requirement.id}`));
  const expectedItemFiles = new Set();
  const itemFilesToInspect = new Map();
  const itemMetadataById = new Map();
  const allItemMetadataEntries = [];

  for (const metadataFile of sources.itemMetadata) {
    for (const item of metadataFile.data.items || []) {
      const entry = {
        id: item.id,
        category: metadataFile.category,
        item,
        metadataFile: projectRelative(projectRoot, metadataFile.file)
      };
      allItemMetadataEntries.push(entry);
      if (!itemMetadataById.has(item.id)) itemMetadataById.set(item.id, []);
      itemMetadataById.get(item.id).push(entry);
    }
  }

  for (const entry of allItemMetadataEntries) {
    if (runtimeItemKeys.has(`${entry.category}/${entry.id}`)) continue;
    const orphan = {
      id: entry.id,
      category: entry.category,
      metadataFile: entry.metadataFile
    };
    checks.items.orphanMetadata.push(orphan);
    issues.push(makeIssue(
      'warning',
      'item_orphan_metadata',
      'items',
      `${entry.category}/${entry.id} has generation metadata but no standard or caravan consumer`,
      orphan
    ));
  }

  for (const requirement of itemRequirements) {
    const requirementResult = { ...requirement, sizes: {} };
    checks.items.requirements.push(requirementResult);
    const metadataEntries = itemMetadataById.get(requirement.id) || [];
    if (metadataEntries.length === 0) {
      const mismatch = { id: requirement.id, category: requirement.category, consumers: requirement.consumers };
      checks.items.metadataMismatches.push(mismatch);
      issues.push(makeIssue(
        'error',
        'item_metadata_missing',
        'items',
        `${requirement.category}/${requirement.id} is used at runtime but absent from item metadata`,
        mismatch
      ));
    } else if (!metadataEntries.some(entry => entry.category === requirement.category)) {
      const mismatch = {
        id: requirement.id,
        runtimeCategory: requirement.category,
        metadataCategories: metadataEntries.map(entry => entry.category).sort(),
        consumers: requirement.consumers
      };
      checks.items.metadataMismatches.push(mismatch);
      issues.push(makeIssue(
        'error',
        'item_category_mismatch',
        'items',
        `${requirement.id} resolves to ${requirement.category} at runtime but metadata uses ${mismatch.metadataCategories.join(', ')}`,
        mismatch
      ));
    }

    for (const size of ITEM_SIZES) {
      const file = path.join(publicAssets, 'items', String(size), requirement.category, `${requirement.id}.webp`);
      const relative = projectRelative(projectRoot, file);
      const exists = await pathExists(file);
      expectedItemFiles.add(file);
      requirementResult.sizes[size] = { path: relative, exists };
      if (!exists) {
        const missing = {
          id: requirement.id,
          category: requirement.category,
          size,
          path: relative,
          consumers: requirement.consumers
        };
        checks.items.missingFiles.push(missing);
        issues.push(makeIssue(
          'error',
          'item_size_missing',
          'items',
          `${requirement.category}/${requirement.id} is missing its ${size}px runtime asset`,
          missing
        ));
      } else {
        itemFilesToInspect.set(file, {
          id: requirement.id,
          category: requirement.category,
          size,
          path: relative,
          scope: 'items'
        });
      }
    }
  }

  const itemInspections = await mapLimit([...itemFilesToInspect], 8, async ([file, details]) => ({
    details,
    inspection: await inspectRaster(file, {
      width: details.size,
      height: details.size,
      frameWidth: details.size,
      frameHeight: details.size,
      frameCount: 1
    })
  }));
  for (const { details, inspection } of itemInspections) {
    if (!inspection.valid) checks.items.invalidFiles.push({ ...details, inspection });
    addRasterInspectionIssues(issues, inspection, details);
  }

  for (const entry of allItemMetadataEntries) {
    const sizeStates = [];
    for (const size of ITEM_SIZES) {
      const file = path.join(publicAssets, 'items', String(size), entry.category, `${entry.id}.webp`);
      sizeStates.push({ size, exists: await pathExists(file), path: projectRelative(projectRoot, file) });
    }
    const complete = sizeStates.every(state => state.exists);
    if (typeof entry.item.generated !== 'boolean' || entry.item.generated !== complete) {
      const mismatch = {
        id: entry.id,
        category: entry.category,
        metadataFile: entry.metadataFile,
        metadataGenerated: typeof entry.item.generated === 'boolean' ? entry.item.generated : null,
        completeSizeCoverage: complete,
        sizes: sizeStates
      };
      checks.items.metadataMismatches.push(mismatch);
      issues.push(makeIssue(
        'error',
        'item_generated_status_mismatch',
        'items',
        `${entry.category}/${entry.id} generated=${String(entry.item.generated)} but 32/64/128 coverage=${complete}`,
        mismatch
      ));
    }
  }

  const itemMetadataCount = allItemMetadataEntries.length;
  if (sources.itemManifest.totalAssets !== itemMetadataCount) {
    issues.push(makeIssue(
      'error',
      'item_manifest_count_mismatch',
      'metadata',
      `item manifest declares ${sources.itemManifest.totalAssets} assets but category files contain ${itemMetadataCount}`,
      { path: 'ai-image-metadata/items/manifest.json' }
    ));
  }
  for (const metadataFile of sources.itemMetadata) {
    const declared = sources.itemManifest.layeredComposition?.baseAssets?.[metadataFile.category];
    const actual = (metadataFile.data.items || []).length;
    if (Number.isInteger(declared) && declared !== actual) {
      issues.push(makeIssue(
        'error',
        'item_manifest_category_count_mismatch',
        'metadata',
        `item manifest declares ${declared} ${metadataFile.category} assets but metadata contains ${actual}`,
        { category: metadataFile.category, declared, actual, path: 'ai-image-metadata/items/manifest.json' }
      ));
    }
  }

  const abilityValidation = await validateAbilityAssets({
    projectRoot,
    registry: sources.abilityRegistry,
    manifest: sources.abilityManifest
  });
  checks.abilities = abilityValidation.checks;
  issues.push(...abilityValidation.issues);

  // -----------------------------------------------------------------------
  // Orphans and migration leftovers. These are warnings: they do not make a
  // strict run fail, but remain machine-readable until intentionally pruned.
  // -----------------------------------------------------------------------
  const playerAssetRoot = path.join(publicAssets, 'characters/player');
  const allPlayerRuntimeFiles = (await walkFiles(playerAssetRoot)).filter(file => file.endsWith('.webp'));
  const playerClassNames = new Set(playerVariants.map(variant => variant.class));
  const knownPlayerAnimations = new Set(Object.keys(sources.characterManifest.animations || {}));
  for (const file of allPlayerRuntimeFiles) {
    if (expectedPlayerFiles.has(file)) continue;
    const relativeToPlayer = normalizePath(path.relative(playerAssetRoot, file));
    const segments = relativeToPlayer.split('/');
    const detail = { path: projectRelative(projectRoot, file) };
    const [className, fileName] = segments;
    const legacyAnimation = segments.length === 2 && fileName.startsWith(`${className}_`)
      ? fileName.slice(`${className}_`.length, -'.webp'.length)
      : null;
    if (
      segments.length === 2
      && playerClassNames.has(className)
      && knownPlayerAnimations.has(legacyAnimation)
    ) {
      checks.players.legacyFallbackFiles.push(detail);
      issues.push(makeIssue(
        'warning',
        'player_legacy_fallback',
        'players',
        `class-only fallback remains outside the canonical race/gender/class layout: ${detail.path}`,
        detail
      ));
    } else {
      checks.players.orphanFiles.push(detail);
      issues.push(makeIssue('warning', 'player_orphan_file', 'players', `unreferenced player asset: ${detail.path}`, detail));
    }
  }

  const enemyAssetRoot = path.join(publicAssets, 'characters/enemies');
  const allEnemyRuntimeFiles = (await walkFiles(enemyAssetRoot)).filter(file => file.endsWith('.webp'));
  for (const file of allEnemyRuntimeFiles) {
    if (resolvedEnemyFiles.has(file)) continue;
    const detail = { path: projectRelative(projectRoot, file) };
    checks.enemies.orphanFiles.push(detail);
    issues.push(makeIssue(
      'warning',
      'enemy_orphan_file',
      'enemies',
      `enemy sheet is never selected by an API template/spawn/animation lookup: ${detail.path}`,
      detail
    ));
  }

  const itemAssetRoot = path.join(publicAssets, 'items');
  const allItemRuntimeFiles = (await walkFiles(itemAssetRoot)).filter(file => (
    file.endsWith('.webp') && !normalizePath(file).includes('/items/originals/')
  ));
  for (const file of allItemRuntimeFiles) {
    if (expectedItemFiles.has(file)) continue;
    const detail = { path: projectRelative(projectRoot, file) };
    checks.items.orphanFiles.push(detail);
    issues.push(makeIssue(
      'warning',
      'item_orphan_file',
      'items',
      `item asset is not referenced by standard or caravan templates: ${detail.path}`,
      detail
    ));
  }

  const sortedIssues = sortIssues(issues);
  const errors = sortedIssues.filter(issue => issue.severity === 'error').length;
  const warnings = sortedIssues.filter(issue => issue.severity === 'warning').length;
  const expectedPlayerSheetCount = playerVariants.reduce((sum, variant) => sum + (variant.animations?.length || 0), 0);
  const resolvedEnemyLookupCount = checks.enemies.lookups.filter(lookup => lookup.resolved).length;
  const expectedItemFileCount = itemRequirements.length * ITEM_SIZES.length;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    projectRoot,
    status: errors === 0 ? 'pass' : 'fail',
    contract: {
      playerVariantIdentity: sources.playerMetadata.identityContract || '{race}_{gender}_{class}',
      spriteSheet: contract,
      itemSizes: [...ITEM_SIZES],
      abilityIconOutputPattern: ABILITY_ICON_OUTPUT_PATTERN
    },
    summary: {
      errors,
      warnings,
      players: {
        variants: playerVariants.length,
        expectedSheets: expectedPlayerSheetCount,
        presentSheets: expectedPlayerSheetCount - checks.players.missingSheets.length,
        validSheets: playerFilesToInspect.size - checks.players.invalidSheets.length,
        duplicateSheetGroups: checks.players.duplicateSheets.length,
        portraitCards: {
          expected: playerVariants.length,
          valid: checks.players.portraitCards.filter(reference => reference.valid).length
        },
        portraitReferences: {
          expected: playerVariants.length,
          valid: checks.players.portraitReferences.filter(reference => reference.valid).length
        },
        identityReferences: {
          expected: playerVariants.length,
          valid: checks.players.identityReferences.filter(reference => reference.valid).length
        },
        identitySources: {
          expected: playerVariants.length,
          valid: checks.players.identitySources.filter(reference => reference.valid).length
        },
        fullBodyReferences: {
          expected: playerVariants.length,
          valid: checks.players.fullBodyReferences.filter(reference => reference.valid).length,
          required: true
        },
        metadataMismatches: checks.players.metadataMismatches.length,
        orphanFiles: checks.players.orphanFiles.length,
        legacyFallbackFiles: checks.players.legacyFallbackFiles.length
      },
      enemies: {
        templates: sources.enemyTemplates.length,
        spawnContexts: sources.enemyTemplates.reduce((sum, enemy) => sum + new Set(enemy.spawn_node_types || []).size, 0),
        expectedLookups: checks.enemies.lookups.length,
        resolvedLookups: resolvedEnemyLookupCount,
        uniqueResolvedSheets: resolvedEnemyFiles.size,
        validResolvedSheets: resolvedEnemyFiles.size - checks.enemies.invalidSheets.length,
        metadataMismatches: checks.enemies.metadataMismatches.length,
        orphanMetadata: checks.enemies.orphanMetadata.length,
        orphanFiles: checks.enemies.orphanFiles.length
      },
      items: {
        standardTemplates: sources.itemTemplates.length,
        caravanTemplates: sources.caravanItems.length,
        uniqueRuntimeSprites: itemRequirements.length,
        expectedFiles: expectedItemFileCount,
        presentFiles: expectedItemFileCount - checks.items.missingFiles.length,
        validFiles: itemFilesToInspect.size - checks.items.invalidFiles.length,
        metadataMismatches: checks.items.metadataMismatches.length,
        orphanMetadata: checks.items.orphanMetadata.length,
        orphanFiles: checks.items.orphanFiles.length
      },
      abilities: abilityValidation.summary
    },
    checks,
    issues: sortedIssues
  };
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function percent(found, expected) {
  if (!expected) return '100.0%';
  return `${((found / expected) * 100).toFixed(1)}%`;
}

function compactPlayerGaps(missingSheets, limit = 12) {
  const grouped = new Map();
  for (const missing of missingSheets) {
    if (!grouped.has(missing.id)) grouped.set(missing.id, []);
    grouped.get(missing.id).push(missing.animation);
  }
  return [...grouped]
    .slice(0, limit)
    .map(([id, animations]) => `  - ${id}: ${animations.join(', ')}`);
}

/** Human-readable output for local development and CI logs. */
export function formatHumanReport(report, options = {}) {
  const sampleLimit = Number(options.sampleLimit || 12);
  const { summary } = report;
  const lines = [
    'Modia runtime asset coverage',
    `Status: ${report.status.toUpperCase()} (${plural(summary.errors, 'error')}, ${plural(summary.warnings, 'warning')})`,
    '',
    'Players',
    `  Variants: ${summary.players.variants}`,
    `  Canonical sheets: ${summary.players.presentSheets}/${summary.players.expectedSheets} (${percent(summary.players.presentSheets, summary.players.expectedSheets)})`,
    `  Valid sheets: ${summary.players.validSheets}/${summary.players.presentSheets}`,
    `  Cross-identity duplicate sheet groups: ${summary.players.duplicateSheetGroups}`,
    `  Portrait cards: ${summary.players.portraitCards.valid}/${summary.players.portraitCards.expected}`,
    `  Portrait references: ${summary.players.portraitReferences.valid}/${summary.players.portraitReferences.expected}`,
    `  Animation identity references: ${summary.players.identityReferences.valid}/${summary.players.identityReferences.expected}`,
    `  Identity provenance sources: ${summary.players.identitySources.valid}/${summary.players.identitySources.expected}`,
    `  Full-body references: ${summary.players.fullBodyReferences.valid}/${summary.players.fullBodyReferences.expected}`,
    `  Metadata mismatches: ${summary.players.metadataMismatches}`,
    `  Orphans / legacy fallbacks: ${summary.players.orphanFiles} / ${summary.players.legacyFallbackFiles}`,
    '',
    'Enemies',
    `  API templates / spawn contexts: ${summary.enemies.templates} / ${summary.enemies.spawnContexts}`,
    `  Runtime-resolved lookups: ${summary.enemies.resolvedLookups}/${summary.enemies.expectedLookups} (${percent(summary.enemies.resolvedLookups, summary.enemies.expectedLookups)})`,
    `  Valid unique sheets: ${summary.enemies.validResolvedSheets}/${summary.enemies.uniqueResolvedSheets}`,
    `  Metadata mismatches: ${summary.enemies.metadataMismatches}`,
    `  Orphan metadata / sheets: ${summary.enemies.orphanMetadata} / ${summary.enemies.orphanFiles}`,
    '',
    'Items',
    `  Standard / caravan templates: ${summary.items.standardTemplates} / ${summary.items.caravanTemplates}`,
    `  Unique runtime sprite paths: ${summary.items.uniqueRuntimeSprites}`,
    `  32/64/128 files: ${summary.items.presentFiles}/${summary.items.expectedFiles} (${percent(summary.items.presentFiles, summary.items.expectedFiles)})`,
    `  Valid files: ${summary.items.validFiles}/${summary.items.presentFiles}`,
    `  Metadata mismatches: ${summary.items.metadataMismatches}`,
    `  Orphan metadata / files: ${summary.items.orphanMetadata} / ${summary.items.orphanFiles}`,
    '',
    'Abilities',
    `  Registry entries: ${summary.abilities.registryEntries}`,
    `  Canonical icons: ${summary.abilities.presentIcons}/${summary.abilities.expectedIcons} (${percent(summary.abilities.presentIcons, summary.abilities.expectedIcons)})`,
    `  Valid icons: ${summary.abilities.validIcons}/${summary.abilities.presentIcons}`,
    `  Metadata mismatches: ${summary.abilities.metadataMismatches}`,
    `  Orphan files: ${summary.abilities.orphanFiles}`
  ];

  if (report.checks.players.missingSheets.length) {
    const groupedCount = new Set(report.checks.players.missingSheets.map(item => item.id)).size;
    lines.push('', `Missing player sheets (${groupedCount} variants):`);
    lines.push(...compactPlayerGaps(report.checks.players.missingSheets, sampleLimit));
    if (groupedCount > sampleLimit) lines.push(`  ... ${groupedCount - sampleLimit} more variants (use --json for the complete list)`);
  }

  const unresolvedEnemies = report.checks.enemies.lookups.filter(lookup => !lookup.resolved);
  if (unresolvedEnemies.length) {
    lines.push('', `Unresolved enemy animations (${unresolvedEnemies.length}):`);
    for (const lookup of unresolvedEnemies.slice(0, sampleLimit)) {
      lines.push(`  - ${lookup.id}/${lookup.spawnBiome}/${lookup.animation}`);
    }
    if (unresolvedEnemies.length > sampleLimit) lines.push(`  ... ${unresolvedEnemies.length - sampleLimit} more (use --json)`);
  }

  if (report.checks.items.missingFiles.length) {
    lines.push('', `Missing item size variants (${report.checks.items.missingFiles.length}):`);
    for (const missing of report.checks.items.missingFiles.slice(0, sampleLimit)) {
      lines.push(`  - ${missing.category}/${missing.id} @ ${missing.size}px`);
    }
    if (report.checks.items.missingFiles.length > sampleLimit) {
      lines.push(`  ... ${report.checks.items.missingFiles.length - sampleLimit} more (use --json)`);
    }
  }

  if (report.checks.abilities.missingFiles.length) {
    lines.push('', `Missing ability icons (${report.checks.abilities.missingFiles.length}):`);
    for (const missing of report.checks.abilities.missingFiles.slice(0, sampleLimit)) {
      lines.push(`  - ${missing.source}/${missing.id}`);
    }
    if (report.checks.abilities.missingFiles.length > sampleLimit) {
      lines.push(`  ... ${report.checks.abilities.missingFiles.length - sampleLimit} more (use --json)`);
    }
  }

  const issueCounts = new Map();
  for (const issue of report.issues) {
    const key = `${issue.severity}:${issue.code}`;
    issueCounts.set(key, (issueCounts.get(key) || 0) + 1);
  }
  if (issueCounts.size) {
    lines.push('', 'Issue totals:');
    for (const [key, count] of [...issueCounts].sort()) {
      lines.push(`  - ${key}: ${count}`);
    }
  }

  lines.push('', report.status === 'pass'
    ? 'Strict gate: PASS'
    : options.strict
      ? 'Strict gate: FAIL'
      : 'Strict gate: FAIL (run with --strict to return a non-zero exit code)');
  return lines.join('\n');
}

export function parseCliArgs(argv) {
  const options = { json: false, strict: false, help: false, projectRoot: DEFAULT_PROJECT_ROOT };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--root') {
      const value = argv[++index];
      if (!value) throw new Error('--root requires a path');
      options.projectRoot = path.resolve(value);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function showHelp() {
  return `Runtime-derived character, NPC, item, and ability asset validator

Usage:
  node scripts/ai-images/validate-runtime-assets.mjs [options]

Options:
  --json        Emit the complete machine-readable report
  --strict      Exit non-zero when any required coverage/parity check fails
  --root <dir>  Validate another Modia checkout (primarily for tests)
  --help, -h    Show this help
`;
}

async function main() {
  let options;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    console.log(showHelp());
    return;
  }

  try {
    const report = await createRuntimeAssetReport({ projectRoot: options.projectRoot });
    console.log(options.json ? JSON.stringify(report, null, 2) : formatHumanReport(report, { strict: options.strict }));
    if (options.strict && report.status !== 'pass') process.exitCode = 1;
  } catch (error) {
    if (options.json) {
      console.log(JSON.stringify({
        schemaVersion: 1,
        status: 'fatal',
        error: error.message
      }, null, 2));
    } else {
      console.error(`Runtime asset validation failed: ${error.stack || error.message}`);
    }
    process.exitCode = 2;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
