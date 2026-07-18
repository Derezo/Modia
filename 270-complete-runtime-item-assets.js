#!/usr/bin/env node
/**
 * Complete runtime item sprite coverage using deterministic Sharp composites.
 *
 * The recipes live in ai-image-metadata/items/runtime-derivations.json. Each
 * recipe names a visually relevant existing raster, optional semantic accent,
 * and bounded colour/layout adjustments. No network or model invocation is
 * performed. Existing destination files are preserved unless --force is used.
 *
 * Usage:
 *   node scripts/ai-images/complete-runtime-item-assets.js
 *   node scripts/ai-images/complete-runtime-item-assets.js --check
 *   node scripts/ai-images/complete-runtime-item-assets.js --dry-run
 *   node scripts/ai-images/complete-runtime-item-assets.js --id potion_luck
 *   node scripts/ai-images/complete-runtime-item-assets.js --category weapons
 *   node scripts/ai-images/complete-runtime-item-assets.js --force
 */

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const PUBLIC_ASSET_ROOT = path.join(PROJECT_ROOT, 'frontend/public/assets');
const ITEM_METADATA_ROOT = path.join(PROJECT_ROOT, 'ai-image-metadata/items');
const REGISTRY_PATH = path.join(ITEM_METADATA_ROOT, 'runtime-derivations.json');
const ITEM_MANIFEST_PATH = path.join(ITEM_METADATA_ROOT, 'manifest.json');
const CATEGORIES = Object.freeze(['weapons', 'armor', 'accessories', 'consumables']);
const ORIGINAL_SIZE = 512;
const EXPECTED_DERIVATION_COUNT = 37;
const GENERATION_METHOD = 'deterministic-sharp-derivation';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function loadRegistry(registryPath = REGISTRY_PATH) {
  return readJson(registryPath);
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    check: false,
    dryRun: false,
    force: false,
    id: null,
    category: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check') options.check = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--id' || arg === '--key') options.id = argv[++index];
    else if (arg === '--category') options.category = argv[++index];
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.check && (options.force || options.dryRun)) {
    throw new Error('--check cannot be combined with --force or --dry-run');
  }
  return options;
}

function showHelp() {
  console.log(`Deterministically complete missing runtime item assets.

Options:
  --check                 Validate sources, outputs, uniqueness, and metadata
  --dry-run               Print planned derivations without writing
  --id, --key <id>        Limit generation to one registry item
  --category <category>   Limit generation to one item category
  --force                 Explicitly replace existing derived destinations
  --help, -h              Show this help
`);
}

function resolveAssetPath(relativeAssetPath, assetRoot = PUBLIC_ASSET_ROOT) {
  const normalized = String(relativeAssetPath || '').replace(/^\/+/, '');
  const resolved = path.resolve(assetRoot, normalized);
  if (!resolved.startsWith(`${path.resolve(assetRoot)}${path.sep}`)) {
    throw new Error(`Asset path escapes the public asset root: ${relativeAssetPath}`);
  }
  return resolved;
}

function canonicalItemAssetPaths(item, assetRoot = PUBLIC_ASSET_ROOT, sizes = [32, 64, 128]) {
  const original = path.join(assetRoot, 'items/originals', item.category, `${item.id}.webp`);
  return {
    original,
    sizes: Object.fromEntries(sizes.map(size => [
      size,
      path.join(assetRoot, 'items', String(size), item.category, `${item.id}.webp`)
    ]))
  };
}

function publicAssetUrl(filePath, assetRoot = PUBLIC_ASSET_ROOT) {
  const relative = path.relative(assetRoot, filePath).split(path.sep).join('/');
  return `/assets/${relative}`;
}

function validateComposition(composition, label) {
  const errors = [];
  const primaryScale = composition?.primaryScale ?? 0.86;
  if (!Number.isFinite(primaryScale) || primaryScale < 0.55 || primaryScale > 0.95) {
    errors.push(`${label}.composition.primaryScale must be between 0.55 and 0.95`);
  }
  if (composition?.rotate !== undefined && (
    !Number.isFinite(composition.rotate) || Math.abs(composition.rotate) > 45
  )) {
    errors.push(`${label}.composition.rotate must be between -45 and 45 degrees`);
  }
  if (composition?.accent) {
    if (!composition.accent.sourceAsset) {
      errors.push(`${label}.composition.accent.sourceAsset is required`);
    }
    const scale = composition.accent.scale ?? 0.25;
    if (!Number.isFinite(scale) || scale < 0.15 || scale > 0.4) {
      errors.push(`${label}.composition.accent.scale must be between 0.15 and 0.4`);
    }
  }
  return errors;
}

async function validateRegistry(registry, options = {}) {
  const assetRoot = options.assetRoot || PUBLIC_ASSET_ROOT;
  const requireSources = options.requireSources !== false;
  const errors = [];
  const items = Array.isArray(registry?.items) ? registry.items : [];
  const sizes = Array.isArray(registry?.sizes) ? registry.sizes : [];

  if (registry?.pipelineVersion !== 1) errors.push('pipelineVersion must be 1');
  if (items.length !== EXPECTED_DERIVATION_COUNT) {
    errors.push(`registry must contain ${EXPECTED_DERIVATION_COUNT} derivations (received ${items.length})`);
  }
  if (JSON.stringify(sizes) !== JSON.stringify([32, 64, 128])) {
    errors.push('sizes must be exactly [32, 64, 128]');
  }

  const identities = new Set();
  const seeds = new Set();
  for (const [index, item] of items.entries()) {
    const label = `items[${index}]`;
    if (!/^[a-z0-9_]+$/.test(item.id || '')) errors.push(`${label}.id is invalid`);
    if (!CATEGORIES.includes(item.category)) errors.push(`${label}.category is invalid`);
    if (!item.name || !item.prompt) errors.push(`${label} requires name and prompt`);
    if (!Number.isInteger(item.seed)) errors.push(`${label}.seed must be an integer`);
    if (!item.sourceAsset) errors.push(`${label}.sourceAsset is required`);
    const identity = `${item.category}/${item.id}`;
    if (identities.has(identity)) errors.push(`duplicate derivation identity: ${identity}`);
    identities.add(identity);
    if (seeds.has(item.seed)) errors.push(`duplicate derivation seed: ${item.seed}`);
    seeds.add(item.seed);
    errors.push(...validateComposition(item.composition || {}, label));

    if (requireSources && item.sourceAsset) {
      for (const [role, sourceAsset] of [
        ['primary', item.sourceAsset],
        ['accent', item.composition?.accent?.sourceAsset]
      ]) {
        if (!sourceAsset) continue;
        const sourcePath = resolveAssetPath(sourceAsset, assetRoot);
        if (!fs.existsSync(sourcePath)) {
          errors.push(`${identity} ${role} source is missing: ${sourceAsset}`);
          continue;
        }
        try {
          const metadata = await sharp(sourcePath).metadata();
          if (!metadata.hasAlpha) errors.push(`${identity} ${role} source lacks alpha: ${sourceAsset}`);
          if (!metadata.width || !metadata.height) errors.push(`${identity} ${role} source has invalid dimensions`);
        } catch (error) {
          errors.push(`${identity} ${role} source is unreadable: ${error.message}`);
        }
      }
    }
  }

  return errors;
}

function gravityPosition(gravity, canvasSize, layerSize, inset = 0) {
  const center = Math.round((canvasSize - layerSize) / 2);
  const far = Math.max(inset, canvasSize - layerSize - inset);
  const positions = {
    center: [center, center],
    north: [center, inset],
    south: [center, far],
    east: [far, center],
    west: [inset, center],
    northeast: [far, inset],
    northwest: [inset, inset],
    southeast: [far, far],
    southwest: [inset, far]
  };
  const [left, top] = positions[gravity] || positions.southeast;
  return { left, top };
}

function applyLayerTransforms(pipeline, transforms = {}) {
  let result = pipeline.ensureAlpha();
  if (transforms.rotate) {
    result = result.rotate(transforms.rotate, {
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    });
  }
  if (transforms.modulate) result = result.modulate(transforms.modulate);
  if (transforms.colorize) result = result.tint(transforms.colorize);
  return result;
}

async function renderLayer(sourcePath, canvasSize, scale, transforms = {}) {
  const targetSize = Math.max(1, Math.round(canvasSize * scale));
  const pipeline = applyLayerTransforms(sharp(sourcePath, { failOn: 'error' }), transforms);
  return pipeline
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
    .resize({
      width: targetSize,
      height: targetSize,
      fit: 'contain',
      kernel: sharp.kernel.lanczos3,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();
}

async function renderDerivedMaster(item, options = {}) {
  const sourceAssetRoot = options.sourceAssetRoot || PUBLIC_ASSET_ROOT;
  const canvasSize = options.canvasSize || ORIGINAL_SIZE;
  const composition = item.composition || {};
  const primaryScale = composition.primaryScale || 0.86;
  const primarySize = Math.round(canvasSize * primaryScale);
  const primary = await renderLayer(
    resolveAssetPath(item.sourceAsset, sourceAssetRoot),
    canvasSize,
    primaryScale,
    composition
  );
  const primaryPosition = gravityPosition('center', canvasSize, primarySize);
  const layers = [{ input: primary, ...primaryPosition }];

  if (composition.accent) {
    const accent = composition.accent;
    const accentSize = Math.round(canvasSize * accent.scale);
    const accentBuffer = await renderLayer(
      resolveAssetPath(accent.sourceAsset, sourceAssetRoot),
      canvasSize,
      accent.scale,
      accent
    );
    const accentPosition = gravityPosition(
      accent.gravity || 'southeast',
      canvasSize,
      accentSize,
      Math.round(canvasSize * 0.045)
    );
    layers.push({ input: accentBuffer, ...accentPosition });
  }

  return sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite(layers)
    .png()
    .toBuffer();
}

async function encodeWebp(buffer, size) {
  return sharp(buffer)
    .resize({
      width: size,
      height: size,
      fit: 'fill',
      kernel: sharp.kernel.lanczos3
    })
    .webp({ lossless: true, effort: 6 })
    .toBuffer();
}

async function writeIfAllowed(destination, buffer, options = {}) {
  const exists = fs.existsSync(destination);
  if (exists && !options.force) return 'preserved';
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  await fsp.writeFile(destination, buffer);
  return exists ? 'replaced' : 'created';
}

async function writeDerivedItem(item, options = {}) {
  const sourceAssetRoot = options.sourceAssetRoot || PUBLIC_ASSET_ROOT;
  const outputAssetRoot = options.outputAssetRoot || PUBLIC_ASSET_ROOT;
  const sizes = options.sizes || [32, 64, 128];
  const destinations = canonicalItemAssetPaths(item, outputAssetRoot, sizes);
  const allDestinations = [destinations.original, ...Object.values(destinations.sizes)];
  const missingDestination = allDestinations.some(filePath => !fs.existsSync(filePath));

  if (!missingDestination && !options.force) {
    return { item, destinations, created: [], replaced: [], preserved: allDestinations };
  }

  const master = await renderDerivedMaster(item, { sourceAssetRoot, canvasSize: ORIGINAL_SIZE });
  const buffers = new Map([[destinations.original, await encodeWebp(master, ORIGINAL_SIZE)]]);
  for (const size of sizes) buffers.set(destinations.sizes[size], await encodeWebp(master, size));

  const result = { item, destinations, created: [], replaced: [], preserved: [] };
  for (const [destination, buffer] of buffers) {
    const status = await writeIfAllowed(destination, buffer, options);
    result[status].push(destination);
  }
  return result;
}

function buildMetadataEntry(item, registry, assetRoot = PUBLIC_ASSET_ROOT) {
  const paths = canonicalItemAssetPaths(item, assetRoot, registry.sizes);
  return {
    id: item.id,
    name: item.name,
    prompt: item.prompt,
    seed: item.seed,
    generated: true,
    generatedAt: registry.generatedAt,
    needsRegeneration: false,
    generationMethod: GENERATION_METHOD,
    derivation: {
      registry: 'runtime-derivations.json',
      pipelineVersion: registry.pipelineVersion,
      sourceAsset: `/assets/${item.sourceAsset}`,
      composition: item.composition
    },
    assetPaths: {
      original: publicAssetUrl(paths.original, assetRoot),
      ...Object.fromEntries(registry.sizes.map(size => [
        String(size),
        publicAssetUrl(paths.sizes[size], assetRoot)
      ]))
    }
  };
}

function syncItemMetadata(registry, selectedItems = registry.items, options = {}) {
  const metadataRoot = options.metadataRoot || ITEM_METADATA_ROOT;
  const assetRoot = options.assetRoot || PUBLIC_ASSET_ROOT;
  const selectedByCategory = new Map(CATEGORIES.map(category => [category, []]));
  for (const item of selectedItems) selectedByCategory.get(item.category).push(item);
  const changes = [];

  for (const category of CATEGORIES) {
    const filePath = path.join(metadataRoot, `${category}.json`);
    const metadata = readJson(filePath);
    for (const item of selectedByCategory.get(category)) {
      const expected = buildMetadataEntry(item, registry, assetRoot);
      const index = metadata.items.findIndex(entry => entry.id === item.id);
      if (index >= 0 && metadata.items[index].generationMethod !== GENERATION_METHOD) {
        throw new Error(`Refusing to replace non-derived metadata entry ${category}/${item.id}`);
      }
      if (index >= 0) metadata.items[index] = expected;
      else metadata.items.push(expected);
    }
    const next = stableJson(metadata);
    const current = fs.readFileSync(filePath, 'utf8');
    if (next !== current) {
      fs.writeFileSync(filePath, next);
      changes.push(path.relative(PROJECT_ROOT, filePath));
    }
  }

  const manifestPath = path.join(metadataRoot, 'manifest.json');
  const manifest = readJson(manifestPath);
  const categoryCounts = Object.fromEntries(CATEGORIES.map(category => {
    const metadata = readJson(path.join(metadataRoot, `${category}.json`));
    return [category, metadata.items.length];
  }));
  manifest.totalAssets = Object.values(categoryCounts).reduce((sum, count) => sum + count, 0);
  manifest.format = 'webp';
  manifest.runtimeDerivations = 'runtime-derivations.json';
  manifest.layeredComposition.baseAssets = categoryCounts;
  const nextManifest = stableJson(manifest);
  if (nextManifest !== fs.readFileSync(manifestPath, 'utf8')) {
    fs.writeFileSync(manifestPath, nextManifest);
    changes.push(path.relative(PROJECT_ROOT, manifestPath));
  }
  return changes;
}

async function inspectItemRaster(filePath, expectedSize) {
  const result = {
    path: filePath,
    valid: false,
    problems: []
  };
  try {
    const image = sharp(filePath, { failOn: 'error' });
    const metadata = await image.metadata();
    result.width = metadata.width;
    result.height = metadata.height;
    result.format = metadata.format;
    result.hasAlpha = metadata.hasAlpha === true;
    if (metadata.width !== expectedSize || metadata.height !== expectedSize) {
      result.problems.push(`expected ${expectedSize}x${expectedSize}, received ${metadata.width}x${metadata.height}`);
    }
    if (metadata.format !== 'webp') result.problems.push(`expected webp, received ${metadata.format}`);
    if (!metadata.hasAlpha) result.problems.push('alpha channel is required');

    const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let foreground = 0;
    for (let offset = 3; offset < data.length; offset += info.channels) {
      if (data[offset] > 8) foreground += 1;
    }
    result.foregroundCoverage = foreground / (info.width * info.height);
    if (result.foregroundCoverage < 0.025) result.problems.push('foreground coverage is too low');
    if (result.foregroundCoverage > 0.9) result.problems.push('foreground coverage is too high');
    result.valid = result.problems.length === 0;
  } catch (error) {
    result.problems.push(error.message);
  }
  return result;
}

async function rawPixelHash(filePath) {
  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return crypto
    .createHash('sha256')
    .update(`${info.width}x${info.height}x${info.channels}:`)
    .update(data)
    .digest('hex');
}

async function itemOutputProblems(items, sizes, assetRoot = PUBLIC_ASSET_ROOT) {
  const problems = [];
  for (const item of items) {
    const destinations = canonicalItemAssetPaths(item, assetRoot, sizes);
    const checks = [[destinations.original, ORIGINAL_SIZE]];
    for (const size of sizes) checks.push([destinations.sizes[size], size]);
    for (const [filePath, size] of checks) {
      if (!fs.existsSync(filePath)) {
        problems.push(`missing derived asset: ${path.relative(PROJECT_ROOT, filePath)}`);
        continue;
      }
      const inspection = await inspectItemRaster(filePath, size);
      if (!inspection.valid) {
        problems.push(`${item.category}/${item.id} ${size}px: ${inspection.problems.join('; ')}`);
      }
    }
  }
  return problems;
}

function metadataParityProblems(registry, options = {}) {
  const metadataRoot = options.metadataRoot || ITEM_METADATA_ROOT;
  const assetRoot = options.assetRoot || PUBLIC_ASSET_ROOT;
  const problems = [];
  const categoryMetadata = Object.fromEntries(CATEGORIES.map(category => [
    category,
    readJson(path.join(metadataRoot, `${category}.json`))
  ]));

  for (const item of registry.items) {
    const matches = categoryMetadata[item.category].items.filter(entry => entry.id === item.id);
    if (matches.length !== 1) {
      problems.push(`${item.category}/${item.id} must have exactly one metadata entry (received ${matches.length})`);
      continue;
    }
    const expected = buildMetadataEntry(item, registry, assetRoot);
    if (JSON.stringify(matches[0]) !== JSON.stringify(expected)) {
      problems.push(`${item.category}/${item.id} metadata does not match the derivation registry`);
    }
  }

  const manifest = readJson(path.join(metadataRoot, 'manifest.json'));
  const counts = Object.fromEntries(CATEGORIES.map(category => [
    category,
    categoryMetadata[category].items.length
  ]));
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (manifest.totalAssets !== total) problems.push(`item manifest totalAssets must be ${total}`);
  if (manifest.format !== 'webp') problems.push('item manifest format must be webp');
  if (manifest.runtimeDerivations !== 'runtime-derivations.json') {
    problems.push('item manifest must reference runtime-derivations.json');
  }
  if (JSON.stringify(manifest.layeredComposition?.baseAssets) !== JSON.stringify(counts)) {
    problems.push('item manifest base asset counts do not match category metadata');
  }
  return problems;
}

async function checkCompletion(registry, options = {}) {
  const assetRoot = options.assetRoot || PUBLIC_ASSET_ROOT;
  const problems = await validateRegistry(registry, { assetRoot });
  const hashesBySize = new Map(registry.sizes.map(size => [size, new Map()]));
  let validFiles = 0;
  let expectedFiles = 0;

  for (const item of registry.items) {
    const destinations = canonicalItemAssetPaths(item, assetRoot, registry.sizes);
    const checks = [[destinations.original, ORIGINAL_SIZE]];
    for (const size of registry.sizes) checks.push([destinations.sizes[size], size]);
    for (const [filePath, size] of checks) {
      expectedFiles += 1;
      if (!fs.existsSync(filePath)) {
        problems.push(`missing derived asset: ${path.relative(PROJECT_ROOT, filePath)}`);
        continue;
      }
      const inspection = await inspectItemRaster(filePath, size);
      if (!inspection.valid) {
        problems.push(`${item.category}/${item.id} ${size}px: ${inspection.problems.join('; ')}`);
      } else {
        validFiles += 1;
      }
    }

    for (const size of registry.sizes) {
      const identityFile = destinations.sizes[size];
      if (!fs.existsSync(identityFile)) continue;
      const hash = await rawPixelHash(identityFile);
      const hashes = hashesBySize.get(size);
      if (hashes.has(hash)) {
        problems.push(`${item.category}/${item.id} duplicates ${hashes.get(hash)} at ${size}px`);
      } else {
        hashes.set(hash, `${item.category}/${item.id}`);
      }
    }
  }

  problems.push(...metadataParityProblems(registry, options));
  return {
    valid: problems.length === 0,
    problems,
    expectedFiles,
    validFiles,
    uniqueBySize: Object.fromEntries([...hashesBySize].map(([size, hashes]) => [size, hashes.size])),
    unique128: hashesBySize.get(128).size
  };
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    showHelp();
    return;
  }

  const registry = loadRegistry();
  const registryProblems = await validateRegistry(registry);
  if (registryProblems.length) {
    throw new Error(`Invalid runtime item derivation registry:\n- ${registryProblems.join('\n- ')}`);
  }

  if (options.check) {
    const report = await checkCompletion(registry);
    const uniqueness = registry.sizes
      .map(size => `${size}px=${report.uniqueBySize[size]}/${registry.items.length}`)
      .join(', ');
    console.log(`Runtime item derivations unique by size: ${uniqueness}`);
    console.log(`Derived raster files: ${report.validFiles}/${report.expectedFiles} valid (original + 32/64/128)`);
    if (!report.valid) {
      for (const problem of report.problems) console.error(`- ${problem}`);
      process.exitCode = 1;
    } else {
      console.log('Metadata and runtime derivation coverage are in sync.');
    }
    return;
  }

  let items = registry.items;
  if (options.id) items = items.filter(item => item.id === options.id);
  if (options.category) items = items.filter(item => item.category === options.category);
  if (!items.length) throw new Error('No runtime item derivations matched the requested filters');

  if (options.dryRun) {
    for (const item of items) {
      console.log(`${item.category}/${item.id} <- ${item.sourceAsset}`);
      if (item.composition?.accent) console.log(`  accent: ${item.composition.accent.sourceAsset}`);
    }
    console.log(`Dry run: ${items.length} deterministic derivation(s); no files written.`);
    return;
  }

  let created = 0;
  let replaced = 0;
  let preserved = 0;
  for (const item of items) {
    const result = await writeDerivedItem(item, { force: options.force });
    created += result.created.length;
    replaced += result.replaced.length;
    preserved += result.preserved.length;
    console.log(`${item.category}/${item.id}: ${result.created.length} created, ${result.replaced.length} replaced, ${result.preserved.length} preserved`);
  }
  const outputProblems = await itemOutputProblems(items, registry.sizes);
  if (outputProblems.length) {
    throw new Error(`Derived item output validation failed:\n- ${outputProblems.join('\n- ')}`);
  }
  const metadataChanges = syncItemMetadata(registry, items);
  console.log(`Files: ${created} created, ${replaced} replaced, ${preserved} preserved`);
  console.log(`Metadata files updated: ${metadataChanges.length}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  CATEGORIES,
  EXPECTED_DERIVATION_COUNT,
  GENERATION_METHOD,
  ORIGINAL_SIZE,
  buildMetadataEntry,
  canonicalItemAssetPaths,
  checkCompletion,
  inspectItemRaster,
  itemOutputProblems,
  loadRegistry,
  metadataParityProblems,
  parseArgs,
  rawPixelHash,
  renderDerivedMaster,
  resolveAssetPath,
  syncItemMetadata,
  validateRegistry,
  writeDerivedItem
};
