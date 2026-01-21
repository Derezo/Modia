#!/usr/bin/env node
/**
 * Procedural Tile Graphics Generation Script
 * Generates terrain tiles and obstacle sprites for the battle system
 *
 * Usage:
 *   node scripts/tiles/generate-tiles.js                    # Generate all tiles
 *   node scripts/tiles/generate-tiles.js --terrain          # Terrain only
 *   node scripts/tiles/generate-tiles.js --obstacles        # Obstacles only
 *   node scripts/tiles/generate-tiles.js --biome=forest     # Specific biome
 *   node scripts/tiles/generate-tiles.js --force            # Regenerate all
 *   node scripts/tiles/generate-tiles.js --help             # Show help
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Terrain generators
const {
  generateGrassTile,
  generateStoneTile,
  generateCobblestoneTile,
  generateWaterTile,
  generateLavaTile,
  generateIceTile,
  generateSnowTile
} = require('./terrain');

// Obstacle generators
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
  generateMountainBoulder,
  generateGrassTufts,
  generateWildflowers,
  generateFallenLog,
  generateStoneRuins,
  generateCaveCrystalsDecorative
} = require('./obstacles');

const OUTPUT_DIR = path.join(__dirname, '../../frontend/public/assets/sprites');
const TERRAIN_DIR = path.join(OUTPUT_DIR, 'terrain');
const OBSTACLES_DIR = path.join(OUTPUT_DIR, 'obstacles');

const TILE_SIZE = 64;

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    help: args.includes('--help') || args.includes('-h'),
    force: args.includes('--force'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    terrainOnly: args.includes('--terrain'),
    obstaclesOnly: args.includes('--obstacles'),
    biome: null,
    list: args.includes('--list')
  };

  const biomeArg = args.find(a => a.startsWith('--biome='));
  if (biomeArg) {
    options.biome = biomeArg.split('=')[1];
  }

  return options;
}

/**
 * Show help message
 */
function showHelp() {
  console.log(`
Procedural Tile Graphics Generation Script
Generates terrain tiles and obstacle sprites with watercolor styling.

Usage:
  node scripts/tiles/generate-tiles.js [options]

Options:
  --help, -h       Show this help message
  --force          Regenerate all tiles, ignoring existing files
  --verbose, -v    Show detailed progress
  --terrain        Generate terrain tiles only
  --obstacles      Generate obstacles only
  --biome=NAME     Generate for specific biome (forest, cave, mountain, bridge, castle)
  --list           List all generated tile types and counts

Output Directories:
  Terrain:    frontend/public/assets/sprites/terrain/{biome}/
  Obstacles:  frontend/public/assets/sprites/obstacles/{category}/

Examples:
  node scripts/tiles/generate-tiles.js                    # Generate all
  node scripts/tiles/generate-tiles.js --terrain          # Terrain only
  node scripts/tiles/generate-tiles.js --biome=cave       # Cave biome only
  node scripts/tiles/generate-tiles.js --force --verbose  # Regenerate with details
`);
}

/**
 * Ensure directories exist
 */
function ensureDirectories(biomes) {
  for (const biome of biomes) {
    const dir = path.join(TERRAIN_DIR, biome);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    }
  }

  const obstacleCategories = ['trees', 'rocks', 'crystals'];
  for (const category of obstacleCategories) {
    const dir = path.join(OBSTACLES_DIR, category);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    }
  }
}

/**
 * Save pixel buffer as PNG file
 */
async function saveAsPng(buffer, width, height, filePath) {
  await sharp(Buffer.from(buffer), {
    raw: { width, height, channels: 4 }
  })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(filePath);
}

/**
 * Check if file needs regeneration
 */
function needsRegeneration(filePath, force) {
  if (force) return true;
  return !fs.existsSync(filePath);
}

/**
 * Terrain tile configuration
 */
const TERRAIN_CONFIG = {
  forest: {
    grass: { generator: generateGrassTile, variants: 4 },
    stone: { generator: (s, b, v) => generateStoneTile(s, b, v, { cracked: true, crackDensity: 'light' }), variants: 4 },
    forest: { generator: (s, b, v) => generateGrassTile(s, b, v, { density: 'dense', withFlowers: false }), variants: 4 },
    rock: { generator: (s, b, v) => generateStoneTile(s, b, v, { withMoss: true, mossCoverage: 0.3 }), variants: 4 }
  },
  cave: {
    stone: { generator: generateStoneTile, variants: 4 },
    grass: { generator: (s, b, v) => generateGrassTile(s, 'cave', v, { density: 'sparse' }), variants: 4 },
    rock: { generator: (s, b, v) => generateStoneTile(s, b, v, { cracked: true, crackDensity: 'heavy' }), variants: 4 },
    water: { generator: (s, b, v) => generateWaterTile(s, 'cave', v, { type: 'murky' }), variants: 4 },
    lava: { generator: generateLavaTile, variants: 4 },
    stone_floor: { generator: (s, b, v) => generateStoneTile(s, b, v, { smooth: true, cracked: false }), variants: 3 }
  },
  mountain: {
    mountain_stone: { generator: (s, b, v) => generateStoneTile(s, b, v, { cracked: true, crackDensity: 'medium' }), variants: 3 },
    snow_patch: { generator: (s, b, v) => generateSnowTile(s, 'mountain', v, { type: 'packed' }), variants: 2 },
    rocky_terrain: { generator: (s, b, v) => generateStoneTile(s, b, v, { cracked: true, withMoss: false }), variants: 2 },
    cliff_edge: { generator: (s, b, v) => generateStoneTile(s, b, v, { cracked: true, crackDensity: 'heavy' }), variants: 1 },
    alpine_grass: { generator: (s, b, v) => generateGrassTile(s, 'mountain', v, { density: 'sparse' }), variants: 2 },
    ice: { generator: generateIceTile, variants: 4 },
    snow: { generator: generateSnowTile, variants: 4 }
  },
  bridge: {
    wooden_planks: { generator: (s, b, v) => generateStoneTile(s, b, v, { smooth: true }), variants: 2 },
    stone_bridge: { generator: (s, b, v) => generateCobblestoneTile(s, 'bridge', v), variants: 2 },
    bridge_water: { generator: (s, b, v) => generateWaterTile(s, 'bridge', v, { type: 'deep' }), variants: 1 },
    cobblestone: { generator: generateCobblestoneTile, variants: 2 }
  },
  castle: {
    cobblestone: { generator: generateCobblestoneTile, variants: 3 },
    marble: { generator: (s, b, v) => generateStoneTile(s, b, v, { smooth: true, cracked: false }), variants: 2 },
    carpet_red: { generator: (s, b, v) => generateGrassTile(s, 'castle', v, { density: 'sparse' }), variants: 1 },
    throne_tile: { generator: (s, b, v) => generateStoneTile(s, b, v, { smooth: true }), variants: 1 },
    stone: { generator: generateStoneTile, variants: 2 }
  }
};

/**
 * Obstacle configuration
 */
const OBSTACLE_CONFIG = {
  trees: {
    oak_tree: { generator: generateOakTree, size: 96 },
    pine_tree: { generator: generatePineTree, size: 80 },
    dead_tree: { generator: generateDeadTree, size: 72 },
    mushroom_large: { generator: generateMushroomLarge, size: 64 },
    mountain_pine: { generator: generateMountainPine, size: 72 }
  },
  rocks: {
    rock_small: { generator: (s, v) => generateRockSmall(s, v, 'granite'), size: 32 },
    rock_medium: { generator: (s, v) => generateRockMedium(s, v, 'granite'), size: 48 },
    rock_large: { generator: (s, v) => generateRockLarge(s, v, 'granite'), size: 64 },
    stalagmite: { generator: generateStalagmite, size: 48 },
    mountain_boulder: { generator: generateMountainBoulder, size: 56 }
  }
};

/**
 * Generate terrain tiles for a biome
 */
async function generateTerrainForBiome(biome, options) {
  const config = TERRAIN_CONFIG[biome];
  if (!config) {
    console.log(`Unknown biome: ${biome}`);
    return { generated: 0, skipped: 0, failed: 0 };
  }

  const biomeDir = path.join(TERRAIN_DIR, biome);
  let generated = 0, skipped = 0, failed = 0;

  console.log(`\nGenerating terrain for ${biome}...`);

  for (const [terrainType, terrainConfig] of Object.entries(config)) {
    for (let v = 0; v < terrainConfig.variants; v++) {
      const filename = `${terrainType}_${v}.png`;
      const filePath = path.join(biomeDir, filename);

      if (!needsRegeneration(filePath, options.force)) {
        if (options.verbose) console.log(`  [SKIP] ${filename}`);
        skipped++;
        continue;
      }

      try {
        const buffer = terrainConfig.generator(TILE_SIZE, biome, v);
        await saveAsPng(buffer, TILE_SIZE, TILE_SIZE, filePath);
        if (options.verbose) console.log(`  [GEN]  ${filename}`);
        generated++;
      } catch (error) {
        console.error(`  [FAIL] ${filename}: ${error.message}`);
        failed++;
      }
    }
  }

  if (!options.verbose) {
    const total = generated + skipped;
    console.log(`  Generated ${generated}/${total} tiles${failed > 0 ? `, ${failed} failed` : ''}`);
  }

  return { generated, skipped, failed };
}

/**
 * Generate obstacle sprites
 */
async function generateObstacles(options) {
  let totalGenerated = 0, totalSkipped = 0, totalFailed = 0;

  console.log('\nGenerating obstacles...');

  for (const [category, items] of Object.entries(OBSTACLE_CONFIG)) {
    const categoryDir = path.join(OBSTACLES_DIR, category);
    if (options.verbose) console.log(`\n  Category: ${category}`);

    for (const [name, config] of Object.entries(items)) {
      const filename = `${name}.png`;
      const filePath = path.join(categoryDir, filename);

      if (!needsRegeneration(filePath, options.force)) {
        if (options.verbose) console.log(`    [SKIP] ${filename}`);
        totalSkipped++;
        continue;
      }

      try {
        const buffer = config.generator(config.size, 0);
        await saveAsPng(buffer, config.size, config.size, filePath);
        if (options.verbose) console.log(`    [GEN]  ${filename}`);
        totalGenerated++;
      } catch (error) {
        console.error(`    [FAIL] ${filename}: ${error.message}`);
        totalFailed++;
      }
    }
  }

  if (!options.verbose) {
    const total = totalGenerated + totalSkipped;
    console.log(`  Generated ${totalGenerated}/${total} obstacles${totalFailed > 0 ? `, ${totalFailed} failed` : ''}`);
  }

  return { generated: totalGenerated, skipped: totalSkipped, failed: totalFailed };
}

/**
 * List all tile types
 */
function listTileTypes() {
  console.log('\n=== Terrain Tiles ===\n');

  let totalTerrain = 0;
  for (const [biome, config] of Object.entries(TERRAIN_CONFIG)) {
    const count = Object.values(config).reduce((sum, c) => sum + c.variants, 0);
    totalTerrain += count;
    console.log(`  ${biome.padEnd(12)} ${String(count).padStart(3)} tiles`);
    for (const [type, typeConfig] of Object.entries(config)) {
      console.log(`    - ${type}: ${typeConfig.variants} variants`);
    }
  }
  console.log(`\n  Total terrain tiles: ${totalTerrain}`);

  console.log('\n=== Obstacle Sprites ===\n');

  let totalObstacles = 0;
  for (const [category, items] of Object.entries(OBSTACLE_CONFIG)) {
    const count = Object.keys(items).length;
    totalObstacles += count;
    console.log(`  ${category.padEnd(12)} ${String(count).padStart(3)} sprites`);
    for (const name of Object.keys(items)) {
      console.log(`    - ${name}`);
    }
  }
  console.log(`\n  Total obstacle sprites: ${totalObstacles}`);
  console.log(`\n=== Grand Total: ${totalTerrain + totalObstacles} assets ===\n`);
}

/**
 * Main entry point
 */
async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  if (options.list) {
    listTileTypes();
    process.exit(0);
  }

  console.log('=== Procedural Tile Generation ===');
  console.log(`Force regenerate: ${options.force ? 'yes' : 'no'}`);

  const biomes = options.biome ? [options.biome] : Object.keys(TERRAIN_CONFIG);
  ensureDirectories(biomes);

  let totalGenerated = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  if (!options.obstaclesOnly) {
    for (const biome of biomes) {
      const result = await generateTerrainForBiome(biome, options);
      totalGenerated += result.generated;
      totalSkipped += result.skipped;
      totalFailed += result.failed;
    }
  }

  if (!options.terrainOnly) {
    const result = await generateObstacles(options);
    totalGenerated += result.generated;
    totalSkipped += result.skipped;
    totalFailed += result.failed;
  }

  console.log('\n=== Generation Complete ===');
  console.log(`Generated: ${totalGenerated} files`);
  console.log(`Skipped:   ${totalSkipped} up-to-date files`);
  if (totalFailed > 0) console.log(`Failed:    ${totalFailed} files`);

  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Generation failed:', err);
  process.exit(1);
});
