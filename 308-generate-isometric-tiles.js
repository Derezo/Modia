#!/usr/bin/env node
/**
 * Compile the canonical high-resolution isometric terrain set from metadata.
 * This command is dependency-free beyond the project's existing `sharp` package
 * and is the production default used by the admin tile queue.
 */

const path = require('path');
const fs = require('fs');
const {
  loadTileMetadata,
  markAssetGenerated,
  loadRegenerationQueue,
  clearRegenerationMarker,
  createBackup,
  getProjectRoot,
  log
} = require('../ai-images/lib');
const {
  TILE_SPEC,
  compileTileAsset,
  getCompiledOutputPath
} = require('./isometricCompiler');
const { validate: validateCanonicalTiles } = require('./validate-isometric-tiles');

const PROJECT_ROOT = getProjectRoot();
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'frontend/public/assets/sprites/terrain');
const METADATA_DIR = path.join(PROJECT_ROOT, 'ai-image-metadata/tiles');
const SAFE_IDENTIFIER = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * Verify that the permissive legacy metadata loader returned the complete
 * manifest contract before its result can define a destructive prune set.
 */
function assertCompleteCanonicalMetadata(metadata) {
  const manifest = metadata?.manifest;
  const assets = metadata?.tiles;
  const errors = [];

  if (!manifest || !Array.isArray(assets)) {
    throw new Error('Refusing --prune: canonical tile metadata could not be loaded');
  }

  const categories = manifest.categories;
  const biomes = manifest.biomes;
  if (!Array.isArray(categories) || categories.length === 0 ||
      new Set(categories).size !== categories.length) {
    errors.push('manifest categories are missing or duplicated');
  }
  if (!Array.isArray(biomes) || biomes.length === 0 ||
      new Set(biomes).size !== biomes.length) {
    errors.push('manifest biomes are missing or duplicated');
  }
  if (!Number.isInteger(manifest.assetCount) || manifest.assetCount <= 0 ||
      assets.length !== manifest.assetCount) {
    errors.push(`manifest declares ${manifest.assetCount} assets but loader returned ${assets.length}`);
  }

  const outputOwners = new Set();
  for (const asset of assets) {
    if (!SAFE_IDENTIFIER.test(asset?.id || '') ||
        !categories?.includes(asset?._tileCategory) ||
        !biomes?.includes(asset?._biome)) {
      errors.push(`unsafe or unscoped asset ${JSON.stringify(asset?.id)}`);
      continue;
    }
    const outputKey = `${asset._biome}/${asset.id}.webp`;
    if (outputOwners.has(outputKey)) errors.push(`duplicate output ${outputKey}`);
    outputOwners.add(outputKey);
  }

  for (const category of categories || []) {
    const actualCategoryCount = assets.filter(asset => asset._tileCategory === category).length;
    const expectedCategoryCount = manifest.categoryCounts?.[category];
    if (!Number.isInteger(expectedCategoryCount) || actualCategoryCount !== expectedCategoryCount) {
      errors.push(
        `${category} declares ${expectedCategoryCount} assets but loader returned ${actualCategoryCount}`
      );
    }

    for (const biome of biomes || []) {
      const metadataFile = manifest.categoryFiles?.[category]?.[biome];
      const pairCount = assets.filter(asset =>
        asset._tileCategory === category && asset._biome === biome
      ).length;
      if (typeof metadataFile !== 'string' || metadataFile.length === 0 || pairCount === 0) {
        errors.push(`${category}/${biome} has no complete metadata document`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Refusing --prune: canonical tile metadata is incomplete (${errors.join('; ')})`);
  }
}

function validationOptions(metadataOnly) {
  return {
    metadataDir: METADATA_DIR,
    assetsDir: OUTPUT_DIR,
    metadataOnly,
    allowMissing: false,
    strict: false,
    verbose: false,
    json: false,
    help: false,
    biome: null,
    category: null,
    keys: []
  };
}

async function assertPruneContract(metadata, metadataOnly) {
  assertCompleteCanonicalMetadata(metadata);
  const report = await validateCanonicalTiles(validationOptions(metadataOnly));
  if (report.errors.length > 0) {
    const summary = report.errors.slice(0, 3).map(issue => `${issue.code}: ${issue.message}`).join('; ');
    throw new Error(`Refusing --prune: canonical tile validation failed (${summary})`);
  }
}

function parseArgs(argv) {
  const options = {
    biome: null,
    category: null,
    keys: [],
    queue: false,
    force: false,
    backup: false,
    updateMetadata: false,
    prune: false,
    dryRun: false,
    verbose: false,
    quiet: false,
    help: false
  };

  const readValue = (argument, index, prefix) => {
    const inline = argument.startsWith(prefix) ? argument.slice(prefix.length) : null;
    if (inline !== null) {
      if (!inline) throw new Error(`${prefix.slice(0, -1)} requires a value`);
      return { value: inline, consumed: 0 };
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('-')) throw new Error(`${argument} requires a value`);
    return { value, consumed: 1 };
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--biome' || arg.startsWith('--biome=')) {
      const result = readValue(arg, i, '--biome=');
      options.biome = result.value;
      i += result.consumed;
    } else if (arg === '--category' || arg.startsWith('--category=')) {
      const result = readValue(arg, i, '--category=');
      options.category = result.value;
      i += result.consumed;
    } else if (arg === '--key' || arg.startsWith('--key=')) {
      const result = readValue(arg, i, '--key=');
      options.keys.push(result.value);
      i += result.consumed;
    } else if (arg === '--queue') options.queue = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--backup') options.backup = true;
    else if (arg === '--update-metadata') options.updateMetadata = true;
    else if (arg === '--prune') options.prune = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--verbose' || arg === '-v') options.verbose = true;
    else if (arg === '--quiet' || arg === '-q') options.quiet = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function showHelp() {
  console.log(`
Isometric Tile Material Compiler

Usage:
  node scripts/tiles/generate-isometric-tiles.js [options]

Options:
  --biome <name>      forest, cave, mountain, bridge, or castle
  --category <name>   floors, walls, or slopes
  --key <id>          compile one key (repeatable)
  --queue             compile assets marked needsRegeneration
  --force             compile even when output exists
  --backup            back up replaced assets first
  --update-metadata   persist generated timestamps (admin/queue workflows)
  --prune             remove obsolete terrain images after a full compile
  --dry-run           show selected assets without writing
  --verbose, -v       print every output path
  --quiet, -q         only print errors

Geometry contract:
  Floor source: ${TILE_SPEC.sourceWidth}x${TILE_SPEC.sourceHeight}
  Floor footprint: ${TILE_SPEC.sourceWidth}x${TILE_SPEC.sourceFootprintHeight}
  Logical render: ${TILE_SPEC.logicalWidth}x${TILE_SPEC.logicalHeight}
  Wall source: ${TILE_SPEC.wallSourceWidth}x${TILE_SPEC.wallSourceHeight}
`);
}

function pruneUnexpectedAssets(canonicalAssets, dryRun = false) {
  const imageExtensions = new Set(['.png', '.webp', '.jpg', '.jpeg', '.avif']);
  const expected = new Set(canonicalAssets.map(asset =>
    path.resolve(getCompiledOutputPath(OUTPUT_DIR, asset, asset._biome))
  ));
  const obsolete = [];

  const visit = directory => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile() && imageExtensions.has(path.extname(entry.name).toLowerCase()) &&
               !expected.has(path.resolve(absolutePath))) {
        obsolete.push(absolutePath);
      }
    }
  };

  visit(OUTPUT_DIR);
  if (!dryRun) {
    obsolete.forEach(filePath => fs.unlinkSync(filePath));
  }
  return obsolete;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    showHelp();
    return;
  }

  if (options.prune && (options.biome || options.category || options.keys.length > 0 || options.queue)) {
    throw new Error('--prune is only allowed for an unfiltered full tile contract');
  }

  const canonicalMetadata = loadTileMetadata();
  if (options.prune) {
    // Validate raw JSON as well as the legacy loader's aggregate. Missing,
    // corrupt, empty, duplicate, or count-mismatched metadata must never
    // shorten the expected set used by pruneUnexpectedAssets().
    await assertPruneContract(canonicalMetadata, true);
  }
  const knownBiomes = new Set(canonicalMetadata.manifest.biomes || []);
  const knownCategories = new Set(canonicalMetadata.manifest.categories || []);
  const knownKeys = new Set(canonicalMetadata.tiles.flatMap(asset => [asset.id, asset.key].filter(Boolean)));

  if (options.biome && !knownBiomes.has(options.biome)) {
    throw new Error(`Unsupported tile biome "${options.biome}". Use ${[...knownBiomes].join(', ')}.`);
  }
  if (options.category && !knownCategories.has(options.category)) {
    throw new Error(`Unsupported tile category "${options.category}". Use ${[...knownCategories].join(', ')}.`);
  }
  const unknownKeys = options.keys.filter(key => !knownKeys.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(`Unknown tile key${unknownKeys.length > 1 ? 's' : ''}: ${unknownKeys.join(', ')}`);
  }

  const metadata = options.queue
    ? { tiles: loadRegenerationQueue('tiles') }
    : canonicalMetadata;

  let assets = metadata.tiles;
  if (options.keys.length > 0) {
    const wanted = new Set(options.keys);
    assets = assets.filter(asset => wanted.has(asset.id) || wanted.has(asset.key));
  }
  if (options.biome) assets = assets.filter(asset => asset._biome === options.biome);
  if (options.category) assets = assets.filter(asset => asset._tileCategory === options.category);

  if (!options.queue && assets.length === 0 &&
      (options.biome || options.category || options.keys.length > 0)) {
    throw new Error('No tile assets match the selected biome, category, and key filters.');
  }

  assets = assets.filter(asset => {
    if (options.force || options.queue || options.dryRun ||
        (options.updateMetadata && asset.generated !== true)) return true;
    const outputPath = getCompiledOutputPath(OUTPUT_DIR, asset, asset._biome);
    try {
      require('fs').accessSync(outputPath);
      return false;
    } catch {
      return true;
    }
  });

  if (!options.quiet) {
    console.log(`Isometric material compiler v${TILE_SPEC.version}`);
    console.log(`Selected ${assets.length} asset(s)`);
  }
  if (assets.length === 0) {
    if (options.prune) {
      if (!options.dryRun) await assertPruneContract(canonicalMetadata, false);
      const obsolete = pruneUnexpectedAssets(canonicalMetadata.tiles, options.dryRun);
      if (!options.quiet) console.log(`${options.dryRun ? 'Would prune' : 'Pruned'} ${obsolete.length} obsolete image(s)`);
    }
    return;
  }

  if (options.backup && !options.dryRun) {
    const result = createBackup(assets, { reason: 'isometric material compiler regeneration' });
    if (!result.success) log(`Backup failed: ${result.error}`, 'warn');
  }

  let succeeded = 0;
  const failures = [];
  for (let index = 0; index < assets.length; index++) {
    const asset = assets[index];
    const outputPath = getCompiledOutputPath(OUTPUT_DIR, asset, asset._biome);
    try {
      await compileTileAsset(asset, asset._biome, outputPath, { dryRun: options.dryRun });
      if (!options.dryRun && (options.updateMetadata || options.queue || options.keys.length > 0)) {
        asset._category = 'tiles';
        markAssetGenerated(asset);
        if (options.queue && asset.needsRegeneration) clearRegenerationMarker(asset);
      }
      succeeded++;
      if (options.verbose && !options.quiet) {
        console.log(`[${index + 1}/${assets.length}] ${asset._tileCategory}/${asset._biome}/${asset.id} -> ${outputPath}`);
      }
    } catch (error) {
      failures.push({ id: asset.id, error: error.message });
      console.error(`[${index + 1}/${assets.length}] Failed ${asset.id}: ${error.message}`);
    }
  }

  if (!options.quiet) {
    console.log(`${options.dryRun ? 'Would compile' : 'Compiled'} ${succeeded}/${assets.length} asset(s)`);
  }
  if (options.prune && failures.length === 0) {
    if (!options.dryRun) await assertPruneContract(canonicalMetadata, false);
    const obsolete = pruneUnexpectedAssets(canonicalMetadata.tiles, options.dryRun);
    if (!options.quiet) console.log(`${options.dryRun ? 'Would prune' : 'Pruned'} ${obsolete.length} obsolete image(s)`);
  }
  if (failures.length > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  pruneUnexpectedAssets,
  assertCompleteCanonicalMetadata,
  assertPruneContract
};
