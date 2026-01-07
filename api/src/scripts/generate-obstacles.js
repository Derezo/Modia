#!/usr/bin/env node
/**
 * Generate Obstacle Sprites
 * Creates map obstacles (rocks, trees, decorative) using PixelLab API
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
const { getPixelLabClient } = require('../services/pixelLabService');
const { getAssetCacheManager } = require('../services/assetCacheManager');
const { OBSTACLE_PROMPTS } = require('../config/pixelLabPrompts');

const ASSETS_DIR = path.join(__dirname, '../../../frontend/public/assets/sprites');

// Size configurations for obstacles (minimum 32px per PixelLab API)
const OBSTACLE_SIZES = {
  rocks: {
    rock_small: 32,
    rock_medium: 48,
    rock_large: 64,
    stalagmite: 48,
    mountain_boulder: 56
  },
  trees: {
    oak_tree: 96,
    pine_tree: 80,
    dead_tree: 72,
    mushroom_large: 64,
    mountain_pine: 72
  },
  decorative: {
    grass_tufts: 32,    // Min 32px
    wildflowers: 32,    // Min 32px
    cave_crystals: 32,
    fallen_log: 48,
    stone_ruins: 56
  }
};

async function generateObstacles() {
  console.log('=== Obstacle Sprite Generation ===\n');

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

  const categories = Object.keys(OBSTACLE_PROMPTS);
  let totalGenerated = 0;
  let totalCached = 0;

  for (const category of categories) {
    console.log(`\n--- Generating ${category} ---`);
    const obstacles = OBSTACLE_PROMPTS[category];

    for (const [obstacleName, prompt] of Object.entries(obstacles)) {
      const size = OBSTACLE_SIZES[category]?.[obstacleName] || 48;
      const filename = `${obstacleName}.png`;

      const params = {
        description: prompt,
        width: size,
        height: size,
        view: 'low top-down',  // Isometric-like perspective (API requires space not underscore)
        seed: getObstacleSeed(category, obstacleName)
      };

      try {
        const result = await cache.getOrGenerate('obstacle', params, async (p) => {
          console.log(`  Generating: ${category}/${filename} (${size}px)`);
          return await client.createMapObject(p);
        });

        if (result.cached) {
          console.log(`  [CACHED] ${category}/${filename}`);
          totalCached++;
        } else {
          console.log(`  [GENERATED] ${category}/${filename}`);
          totalGenerated++;
        }

        // Copy to assets directory
        const destPath = `obstacles/${category}/${filename}`;
        await cache.copyToAssets(result.cacheKey, destPath);

      } catch (error) {
        console.error(`  [ERROR] ${category}/${filename}: ${error.message}`);
      }
    }
  }

  console.log('\n=== Generation Complete ===');
  console.log(`Generated: ${totalGenerated} obstacles`);
  console.log(`From cache: ${totalCached} obstacles`);
  console.log(`Total: ${totalGenerated + totalCached} obstacles`);
}

/**
 * Generate deterministic seed for obstacle
 */
function getObstacleSeed(category, obstacleName) {
  const worldSeed = parseInt(process.env.WORLD_SEED || '12345');
  const categoryHash = hashString(category);
  const nameHash = hashString(obstacleName);
  return (worldSeed + categoryHash + nameHash) % 1000000;
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
  generateObstacles().catch(error => {
    console.error('Generation failed:', error);
    process.exit(1);
  });
}

module.exports = { generateObstacles };
