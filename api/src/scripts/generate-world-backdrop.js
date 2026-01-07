#!/usr/bin/env node
/**
 * Generate World Map Backdrop Tiles
 * Creates seamless tileable textures for world map background using PixelLab API
 *
 * Key differences from old approach:
 * - Prompts explicitly request SEAMLESS, TILEABLE textures with NO FOCAL POINT
 * - Generates 4 variants per terrain type for visual variety
 * - Uses createImagePixflux for better control over tile generation
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
const { getPixelLabClient } = require('../services/pixelLabService');
const { getAssetCacheManager } = require('../services/assetCacheManager');
const {
  WORLD_BACKDROP_PROMPTS,
  BACKDROP_VARIANTS,
  PATH_TEXTURE_PROMPTS
} = require('../config/pixelLabPrompts');

const ASSETS_DIR = path.join(__dirname, '../../../frontend/public/assets/sprites');

async function generateWorldBackdrop() {
  console.log('=== World Map Backdrop Generation ===\n');
  console.log('Generating seamless tileable textures for world map biomes\n');

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
    console.log(`PixelLab Credits: ${balance.credits || balance.remaining_credits || 'Unknown'}\n`);
  } catch (error) {
    console.warn('Could not fetch credit balance:', error.message);
  }

  let totalGenerated = 0;
  let totalCached = 0;
  let totalErrors = 0;

  // Generate backdrop tiles with variants
  console.log('--- Generating Backdrop Tiles ---');
  console.log(`Creating ${BACKDROP_VARIANTS} variants per terrain type\n`);

  for (const [terrainName, config] of Object.entries(WORLD_BACKDROP_PROMPTS)) {
    console.log(`\n[${terrainName}]`);

    for (let variant = 0; variant < BACKDROP_VARIANTS; variant++) {
      const filename = variant === 0 ? `${terrainName}.png` : `${terrainName}_${variant}.png`;
      const cacheKey = `backdrop_seamless_${terrainName}_v${variant}`;

      const params = {
        description: config.description,
        width: config.size,
        height: config.size,
        seed: getBackdropSeed(terrainName, variant)
      };

      try {
        const result = await cache.getOrGenerate(cacheKey, params, async (p) => {
          console.log(`  Generating: ${filename} (${config.size}px, variant ${variant})`);
          // Use createMapObject which handles API params correctly
          return await client.createMapObject({
            description: p.description,
            width: p.width,
            height: p.height,
            view: 'high top-down',
            seed: p.seed
          });
        });

        if (result.cached) {
          console.log(`  [CACHED] ${filename}`);
          totalCached++;
        } else {
          console.log(`  [GENERATED] ${filename}`);
          totalGenerated++;
        }

        // Copy to assets directory
        const destPath = `nodes/backdrop/${filename}`;
        await cache.copyToAssets(result.cacheKey, destPath);

      } catch (error) {
        console.error(`  [ERROR] ${filename}: ${error.message}`);
        totalErrors++;
      }
    }
  }

  // Generate path textures
  console.log('\n\n--- Generating Path Textures ---');
  console.log('Creating horizontal road segments for curve stamping\n');

  for (const [pathName, config] of Object.entries(PATH_TEXTURE_PROMPTS)) {
    const filename = `${pathName}.png`;
    const cacheKey = `path_seamless_${pathName}`;

    const params = {
      description: config.description,
      width: config.width,
      height: config.height,
      isometric: false,
      seed: getBackdropSeed(pathName, 0)
    };

    try {
      const result = await cache.getOrGenerate(cacheKey, params, async (p) => {
        console.log(`  Generating: ${filename} (${config.width}x${config.height})`);
        // Use createMapObject for rectangular path textures
        return await client.createMapObject({
          description: p.description,
          width: p.width,
          height: p.height,
          view: 'high top-down',
          seed: p.seed
        });
      });

      if (result.cached) {
        console.log(`  [CACHED] ${filename}`);
        totalCached++;
      } else {
        console.log(`  [GENERATED] ${filename}`);
        totalGenerated++;
      }

      const destPath = `nodes/paths/${filename}`;
      await cache.copyToAssets(result.cacheKey, destPath);

    } catch (error) {
      console.error(`  [ERROR] ${filename}: ${error.message}`);
      totalErrors++;
    }
  }

  console.log('\n=== Generation Complete ===');
  console.log(`Generated: ${totalGenerated} sprites`);
  console.log(`From cache: ${totalCached} sprites`);
  console.log(`Errors: ${totalErrors}`);
  console.log(`Total attempted: ${totalGenerated + totalCached + totalErrors}`);

  if (totalErrors > 0) {
    console.log('\nNote: Some sprites failed to generate. Re-run to retry.');
  }
}

/**
 * Generate deterministic seed for backdrop tiles
 * @param {string} terrainName - Terrain type name
 * @param {number} variant - Variant index (0-3)
 */
function getBackdropSeed(terrainName, variant) {
  const worldSeed = parseInt(process.env.WORLD_SEED || '12345');
  const terrainHash = hashString(terrainName);
  // Add variant offset to get different but deterministic results per variant
  return (worldSeed + terrainHash + variant * 7919) % 1000000;
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

// Run if called directly
if (require.main === module) {
  generateWorldBackdrop().catch(error => {
    console.error('Generation failed:', error);
    process.exit(1);
  });
}

module.exports = { generateWorldBackdrop };
