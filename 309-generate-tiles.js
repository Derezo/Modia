#!/usr/bin/env node

/**
 * Legacy procedural entry point.
 *
 * Terrain work is always delegated to the canonical iso64-retina-v3 compiler.
 * The obstacle-only mode remains here for backwards compatibility with the
 * procedural obstacle sprites that are outside the terrain geometry contract.
 */

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const {
  generateOakTree,
  generatePineTree,
  generateDeadTree,
  generateMushroomLarge,
  generateMountainPine,
  generateRockSmall,
  generateRockMedium,
  generateRockLarge,
  generateStalagmite,
  generateMountainBoulder
} = require('./obstacles');
const {
  translateLegacyAiTileArgs,
  runCanonicalGenerator
} = require('./legacyTileAdapters');

// Match AssetLoader's runtime URL contract: /assets/obstacles/{category}/{id}.webp
const OBSTACLES_DIR = path.join(__dirname, '../../frontend/public/assets/obstacles');
const OBSTACLE_CONFIG = Object.freeze({
  trees: {
    oak_tree: { generator: generateOakTree, size: 96 },
    pine_tree: { generator: generatePineTree, size: 80 },
    dead_tree: { generator: generateDeadTree, size: 72 },
    mushroom_large: { generator: generateMushroomLarge, size: 64 },
    mountain_pine: { generator: generateMountainPine, size: 72 }
  },
  rocks: {
    rock_small: { generator: (size, variant) => generateRockSmall(size, variant, 'granite'), size: 32 },
    rock_medium: { generator: (size, variant) => generateRockMedium(size, variant, 'granite'), size: 48 },
    rock_large: { generator: (size, variant) => generateRockLarge(size, variant, 'granite'), size: 64 },
    stalagmite: { generator: generateStalagmite, size: 48 },
    mountain_boulder: { generator: generateMountainBoulder, size: 56 }
  }
});

function parseArgs(argv = process.argv.slice(2)) {
  let terrainOnly = false;
  let obstaclesOnly = false;
  let list = false;
  const tileArgs = [];

  for (const argument of argv) {
    if (argument === '--terrain') terrainOnly = true;
    else if (argument === '--obstacles') obstaclesOnly = true;
    else if (argument === '--list') list = true;
    else tileArgs.push(argument);
  }

  if (terrainOnly && obstaclesOnly) {
    throw new Error('--terrain and --obstacles are mutually exclusive');
  }

  const canonicalArgs = translateLegacyAiTileArgs(tileArgs);
  return {
    terrainOnly,
    obstaclesOnly,
    list,
    canonicalArgs,
    help: canonicalArgs.includes('--help') || canonicalArgs.includes('-h'),
    force: canonicalArgs.includes('--force'),
    verbose: canonicalArgs.includes('--verbose') || canonicalArgs.includes('-v'),
    quiet: canonicalArgs.includes('--quiet') || canonicalArgs.includes('-q'),
    dryRun: canonicalArgs.includes('--dry-run')
  };
}

function showHelp() {
  console.log(`
Legacy Tile/Obstacle Compatibility Command

Terrain is compiled by scripts/tiles/generate-isometric-tiles.js.
Procedural obstacle generation remains available with --obstacles.

Usage:
  node scripts/tiles/generate-tiles.js --terrain [tile options]
  node scripts/tiles/generate-tiles.js --obstacles [--force] [--verbose]
  node scripts/tiles/generate-tiles.js [tile options]  # terrain, then obstacles

Modes:
  --terrain          compile canonical terrain only
  --obstacles        generate procedural obstacles only
  --list             list the preserved obstacle outputs

Terrain options:
  --biome <name>     forest, cave, mountain, bridge, or castle
  --category <name>  floors, walls, or slopes
  --key <id>         compile one metadata key (repeatable)
  --force            replace existing outputs
  --dry-run          preview terrain work; obstacle writes are skipped
  --queue            compile metadata regeneration queue
  --backup           back up replaced terrain first
  --update-metadata  persist terrain generation status
  --prune            remove non-canonical terrain images (full run only)
  --verbose, -v      detailed output
  --quiet, -q        suppress informational output
  --help, -h         show this help
`);
}

function ensureObstacleDirectories() {
  for (const category of Object.keys(OBSTACLE_CONFIG)) {
    fs.mkdirSync(path.join(OBSTACLES_DIR, category), { recursive: true });
  }
}

async function saveAsWebp(buffer, width, height, filePath) {
  await sharp(Buffer.from(buffer), {
    raw: { width, height, channels: 4 }
  }).webp({ lossless: true, effort: 6 }).toFile(filePath);
}

async function generateObstacles(options) {
  ensureObstacleDirectories();
  let generated = 0;
  let skipped = 0;
  let failed = 0;

  if (!options.quiet) console.log('Generating legacy procedural obstacles...');
  for (const [category, items] of Object.entries(OBSTACLE_CONFIG)) {
    for (const [name, config] of Object.entries(items)) {
      const outputPath = path.join(OBSTACLES_DIR, category, `${name}.webp`);
      if (!options.force && fs.existsSync(outputPath)) {
        skipped++;
        if (options.verbose && !options.quiet) console.log(`  [SKIP] ${category}/${name}.webp`);
        continue;
      }

      try {
        const buffer = config.generator(config.size, 0);
        await saveAsWebp(buffer, config.size, config.size, outputPath);
        generated++;
        if (options.verbose && !options.quiet) console.log(`  [GEN]  ${category}/${name}.webp`);
      } catch (error) {
        failed++;
        console.error(`  [FAIL] ${category}/${name}.webp: ${error.message}`);
      }
    }
  }

  if (!options.quiet) {
    console.log(`Obstacle result: ${generated} generated, ${skipped} skipped, ${failed} failed`);
  }
  return { generated, skipped, failed };
}

function listObstacleTypes() {
  console.log('Canonical terrain: npm run tiles:generate -- --help');
  console.log('Preserved procedural obstacles:');
  for (const [category, items] of Object.entries(OBSTACLE_CONFIG)) {
    console.log(`  ${category}: ${Object.keys(items).join(', ')}`);
  }
}

async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`Legacy tile command rejected: ${error.message}`);
    console.error('Run `npm run tiles:generate -- --help` for canonical terrain options.');
    return 2;
  }

  if (options.help) {
    showHelp();
    return 0;
  }
  if (options.list) {
    listObstacleTypes();
    return 0;
  }

  if (!options.obstaclesOnly) {
    if (!options.quiet) console.error('[compat] Delegating terrain to the canonical v3 compiler.');
    const status = runCanonicalGenerator(options.canonicalArgs);
    if (status !== 0) return status;
  }

  if (!options.terrainOnly) {
    if (options.dryRun) {
      if (!options.quiet) console.log('Dry run: procedural obstacle writes skipped.');
    } else {
      const result = await generateObstacles(options);
      if (result.failed > 0) return 1;
    }
  }

  return 0;
}

if (require.main === module) {
  main().then(status => {
    process.exitCode = status;
  }).catch(error => {
    console.error(`Legacy tile command failed: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  OBSTACLES_DIR,
  OBSTACLE_CONFIG,
  parseArgs,
  generateObstacles,
  main
};
