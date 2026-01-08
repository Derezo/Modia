#!/usr/bin/env node
/**
 * Generate Terrain Tiles
 * Creates isometric terrain tiles for all biomes using PixelLab API
 * Uses improved prompts for cohesive visual style
 */

const path = require('path');
const fs = require('fs').promises;
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const { getPixelLabClient } = require('../services/pixelLabService');
const { getAssetCacheManager } = require('../services/assetCacheManager');
const { TERRAIN_PROMPTS, TILE_CONFIG } = require('../config/pixelLabPrompts');

const ASSETS_DIR = path.join(__dirname, '../../../frontend/public/assets/sprites');

/**
 * Determine tile shape based on terrain type
 * All ground tiles are flat (thin) for visual consistency and seamless tiling.
 * Only structural obstacles like cliffs get elevation.
 */
function getTileShape(terrainType) {
  // Only these terrain types get elevated (thick) tiles
  const elevatedTypes = ['cliff'];
  if (elevatedTypes.includes(terrainType)) {
    return 'thick';
  }
  return 'thin';  // Default flat for seamless tiling
}

/**
 * Generate deterministic seed for terrain
 */
function getTerrainSeed(biome, terrainType, variant) {
  const worldSeed = parseInt(process.env.WORLD_SEED || '12345', 10);
  const biomeHash = hashString(biome);
  const terrainHash = hashString(terrainType);
  return (worldSeed + biomeHash + terrainHash + variant * 1000) % 1000000;
}

/**
 * Simple string hash
 */
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

/**
 * Clear existing tiles for a biome
 */
async function clearBiomeTiles(biome) {
  const biomeDir = path.join(ASSETS_DIR, 'terrain', biome);
  try {
    const files = await fs.readdir(biomeDir);
    for (const file of files) {
      if (file.endsWith('.png')) {
        await fs.unlink(path.join(biomeDir, file));
      }
    }
    console.log(`  Cleared existing tiles in ${biome}/`);
  } catch (err) {
    // Directory may not exist yet
    await fs.mkdir(biomeDir, { recursive: true });
  }
}

async function generateTiles(options = {}) {
  const {
    biomesToGenerate = null, // null = all biomes, or ['forest', 'cave']
    clearExisting = true,
    maxTilesPerBiome = null // null = all tiles
  } = options;

  console.log('=== Terrain Tile Generation ===\n');

  if (!process.env.PIXELLAB_API_KEY && !process.env.PIXELLABS_API_KEY) {
    console.error('Error: PIXELLAB_API_KEY not found in environment');
    console.log('Please add your PixelLab API key to .env file');
    process.exit(1);
  }

  const client = getPixelLabClient();
  const cache = getAssetCacheManager();

  // Check credits
  try {
    const balance = await client.getBalance();
    const remaining = balance.subscription?.generations || balance.credits?.usd || 'Unknown';
    console.log(`PixelLab Credits: ${remaining}\n`);
  } catch (error) {
    console.warn('Could not fetch credit balance:', error.message);
  }

  // Filter biomes if specified
  const biomes = biomesToGenerate || Object.keys(TERRAIN_PROMPTS);
  let totalGenerated = 0;
  let totalCached = 0;
  let totalFailed = 0;

  for (const biome of biomes) {
    if (!TERRAIN_PROMPTS[biome]) {
      console.warn(`Unknown biome: ${biome}, skipping`);
      continue;
    }

    console.log(`\n--- Generating ${biome} tiles ---`);

    if (clearExisting) {
      await clearBiomeTiles(biome);
    }

    const terrainTypes = TERRAIN_PROMPTS[biome];
    let tilesInBiome = 0;

    for (const [terrainType, promptData] of Object.entries(terrainTypes)) {
      // Check max tiles limit
      if (maxTilesPerBiome && tilesInBiome >= maxTilesPerBiome) {
        console.log(`  Reached max tiles (${maxTilesPerBiome}) for ${biome}, stopping`);
        break;
      }

      // Handle single prompt or array of variants
      const prompts = Array.isArray(promptData) ? promptData : [promptData];
      const tileShape = getTileShape(terrainType);

      for (let variant = 0; variant < prompts.length; variant++) {
        if (maxTilesPerBiome && tilesInBiome >= maxTilesPerBiome) break;

        const prompt = prompts[variant];
        const filename = `${terrainType}_${variant}.png`;

        const params = {
          description: prompt,
          image_size: 64,  // 64x64 for proper isometric tiles without stretching
          tile_shape: tileShape,
          seed: getTerrainSeed(biome, terrainType, variant),
          ...TILE_CONFIG.defaultParams // outline, shading, detail
        };

        try {
          console.log(`  Generating: ${biome}/${filename} (${tileShape} tile)`);

          const result = await cache.getOrGenerate('terrain_tile', params, async (p) => {
            return await client.createIsometricTile(p);
          });

          if (result.cached) {
            console.log(`    [CACHED] ${filename}`);
            totalCached++;
          } else {
            console.log(`    [GENERATED] ${filename}`);
            totalGenerated++;
          }

          // Copy to assets directory
          const destPath = `terrain/${biome}/${filename}`;
          await cache.copyToAssets(result.cacheKey, destPath);

          // Verify the file was saved correctly
          const fullDestPath = path.join(ASSETS_DIR, destPath);
          const stats = await fs.stat(fullDestPath);
          if (stats.size < 100) {
            throw new Error(`Generated file too small: ${stats.size} bytes`);
          }
          console.log(`    ✓ Saved: ${destPath} (${stats.size} bytes)`);
          tilesInBiome++;

        } catch (error) {
          console.error(`    ✗ FAILED: ${filename}: ${error.message}`);
          totalFailed++;
          // Continue with next tile instead of stopping entirely
        }
      }
    }

    console.log(`  Completed ${biome}: ${tilesInBiome} tiles`);
  }

  // Print summary
  console.log('\n=== Generation Complete ===');
  console.log(`Generated: ${totalGenerated} new tiles`);
  console.log(`From cache: ${totalCached} tiles`);
  console.log(`Failed: ${totalFailed} tiles`);
  console.log(`Total successful: ${totalGenerated + totalCached} tiles`);

  // Check final balance
  try {
    const balance = await client.getBalance();
    const remaining = balance.subscription?.generations || balance.credits?.usd || 'Unknown';
    console.log(`\nRemaining credits: ${remaining}`);
  } catch (error) {
    // Ignore
  }

  return { generated: totalGenerated, cached: totalCached, failed: totalFailed };
}

// CLI argument parsing
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};

  // --biomes=forest,cave
  const biomesArg = args.find(arg => arg.startsWith('--biomes='));
  if (biomesArg) {
    options.biomesToGenerate = biomesArg.split('=')[1].split(',');
  }

  // --max=N (max tiles per biome)
  const maxArg = args.find(arg => arg.startsWith('--max='));
  if (maxArg) {
    options.maxTilesPerBiome = parseInt(maxArg.split('=')[1], 10);
  }

  // --no-clear (don't clear existing tiles)
  if (args.includes('--no-clear')) {
    options.clearExisting = false;
  }

  // --help
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: node generate-tiles.js [options]

Options:
  --biomes=forest,cave   Only generate specific biomes
  --max=N                Max tiles per biome (for testing)
  --no-clear             Don't clear existing tiles before generating
  --help, -h             Show this help message

Examples:
  node generate-tiles.js                        # Generate all biomes
  node generate-tiles.js --biomes=forest        # Only forest biome
  node generate-tiles.js --biomes=forest --max=4  # Test with 4 forest tiles
`);
    process.exit(0);
  }

  return options;
}

// Run if called directly
if (require.main === module) {
  const options = parseArgs();
  generateTiles(options).catch(error => {
    console.error('Generation failed:', error);
    process.exit(1);
  });
}

module.exports = { generateTiles };
