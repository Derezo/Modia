#!/usr/bin/env node
/**
 * Generate World Map Node Sprites
 * Creates node icons for the world map using PixelLab API
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
const { getPixelLabClient } = require('../services/pixelLabService');
const { getAssetCacheManager } = require('../services/assetCacheManager');
const { NODE_PROMPTS } = require('../config/pixelLabPrompts');

const ASSETS_DIR = path.join(__dirname, '../../../frontend/public/assets/sprites');

// Node sizes - larger for important locations
const NODE_SIZES = {
  castle: 64,
  city: 56,
  village: 48,
  forest: 48,
  cave: 48,
  mountain: 56,
  bridge: 48,
  palace: 72,
  guild_warrior: 48,
  guild_wizard: 48,
  guild_monk: 48,
  guild_chemist: 48
};

async function generateNodes() {
  console.log('=== World Map Node Generation ===\n');

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

  for (const [nodeType, prompt] of Object.entries(NODE_PROMPTS)) {
    const size = NODE_SIZES[nodeType] || 48;
    const filename = `${nodeType}.png`;

    const params = {
      description: prompt,
      width: size,
      height: size,
      isometric: false, // Top-down view for map nodes
      seed: getNodeSeed(nodeType)
    };

    try {
      const result = await cache.getOrGenerate(`node_${nodeType}`, params, async (p) => {
        console.log(`  Generating: ${filename} (${size}px)`);
        return await client.createMapObject(p);
      });

      if (result.cached) {
        console.log(`  [CACHED] ${filename}`);
        totalCached++;
      } else {
        console.log(`  [GENERATED] ${filename}`);
        totalGenerated++;
      }

      // Copy to assets directory
      const destPath = `nodes/${filename}`;
      await cache.copyToAssets(result.cacheKey, destPath);

    } catch (error) {
      console.error(`  [ERROR] ${filename}: ${error.message}`);
    }
  }

  // Generate path textures for roads between nodes
  console.log('\n--- Generating Path Textures ---');

  const pathTypes = [
    { name: 'dirt_road', prompt: 'Worn dirt road segment, packed earth, wagon wheel marks, medieval path, pixel art, fantasy RPG style' },
    { name: 'stone_path', prompt: 'Cobblestone road segment, medieval paved path, well-maintained, pixel art, fantasy RPG style' },
    { name: 'bridge_planks', prompt: 'Wooden bridge planks segment, rope bindings, weathered wood, pixel art, fantasy RPG style' }
  ];

  for (const pathType of pathTypes) {
    const params = {
      description: pathType.prompt,
      width: 32,
      height: 32,
      isometric: false,
      seed: getNodeSeed(pathType.name)
    };

    try {
      const result = await cache.getOrGenerate(`path_${pathType.name}`, params, async (p) => {
        console.log(`  Generating: ${pathType.name}.png`);
        return await client.createMapObject(p);
      });

      if (result.cached) {
        console.log(`  [CACHED] ${pathType.name}.png`);
        totalCached++;
      } else {
        console.log(`  [GENERATED] ${pathType.name}.png`);
        totalGenerated++;
      }

      const destPath = `nodes/paths/${pathType.name}.png`;
      await cache.copyToAssets(result.cacheKey, destPath);

    } catch (error) {
      console.error(`  [ERROR] ${pathType.name}: ${error.message}`);
    }
  }

  // Generate world map backdrop tiles
  console.log('\n--- Generating World Map Backdrop ---');

  const backdropTiles = [
    { name: 'world_grass', prompt: 'World map grass texture, green meadow, bird-eye view, seamless tile, pixel art, fantasy map style' },
    { name: 'world_water', prompt: 'World map ocean/sea texture, blue water, bird-eye view, seamless tile, pixel art, fantasy map style' },
    { name: 'world_forest', prompt: 'World map forest canopy texture, dense green trees from above, bird-eye view, seamless tile, pixel art' },
    { name: 'world_mountain', prompt: 'World map mountain range texture, gray rocky peaks from above, bird-eye view, seamless tile, pixel art' },
    { name: 'world_desert', prompt: 'World map desert texture, sandy dunes from above, bird-eye view, seamless tile, pixel art' }
  ];

  for (const tile of backdropTiles) {
    const params = {
      description: tile.prompt,
      width: 64,
      height: 64,
      isometric: false,
      seed: getNodeSeed(tile.name)
    };

    try {
      const result = await cache.getOrGenerate(`backdrop_${tile.name}`, params, async (p) => {
        console.log(`  Generating: ${tile.name}.png`);
        return await client.createMapObject(p);
      });

      if (result.cached) {
        console.log(`  [CACHED] ${tile.name}.png`);
        totalCached++;
      } else {
        console.log(`  [GENERATED] ${tile.name}.png`);
        totalGenerated++;
      }

      const destPath = `nodes/backdrop/${tile.name}.png`;
      await cache.copyToAssets(result.cacheKey, destPath);

    } catch (error) {
      console.error(`  [ERROR] ${tile.name}: ${error.message}`);
    }
  }

  console.log('\n=== Generation Complete ===');
  console.log(`Generated: ${totalGenerated} sprites`);
  console.log(`From cache: ${totalCached} sprites`);
  console.log(`Total: ${totalGenerated + totalCached}`);
}

/**
 * Generate deterministic seed for node
 */
function getNodeSeed(nodeType) {
  const worldSeed = parseInt(process.env.WORLD_SEED || '12345');
  const nodeHash = hashString(nodeType);
  return (worldSeed + nodeHash) % 1000000;
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
  generateNodes().catch(error => {
    console.error('Generation failed:', error);
    process.exit(1);
  });
}

module.exports = { generateNodes };
