#!/usr/bin/env node
/**
 * Generate Item Icon Sprites
 * Creates item icons for weapons, armor, accessories, and consumables
 * Supports material and rarity variations
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
const { getPixelLabClient } = require('../services/pixelLabService');
const { getAssetCacheManager } = require('../services/assetCacheManager');
const { ITEM_PROMPTS, MATERIAL_MODIFIERS, RARITY_MODIFIERS } = require('../config/pixelLabPrompts');

const ASSETS_DIR = path.join(__dirname, '../../../frontend/public/assets/sprites');

// Item icon size
const ITEM_SIZE = 32;

// Materials to generate for equipment (subset for base generation)
const BASE_MATERIALS = ['iron', 'steel', 'mythril'];

// Rarities that get visual modifiers
const VISUAL_RARITIES = ['rare', 'epic', 'legendary'];

async function generateItems() {
  console.log('=== Item Icon Generation ===\n');

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

  // Generate base item icons
  for (const [category, items] of Object.entries(ITEM_PROMPTS)) {
    console.log(`\n=== Generating ${category} ===`);

    for (const [itemName, basePrompt] of Object.entries(items)) {
      console.log(`\n--- ${itemName} ---`);

      // For equipment (weapons, armor, accessories), generate material variants
      if (category !== 'consumables') {
        // Generate base version first
        await generateItemVariant(client, cache, category, itemName, basePrompt, null, null, (cached) => {
          if (cached) totalCached++; else totalGenerated++;
        });

        // Generate material variants
        for (const material of BASE_MATERIALS) {
          await generateItemVariant(client, cache, category, itemName, basePrompt, material, null, (cached) => {
            if (cached) totalCached++; else totalGenerated++;
          });
        }

        // Generate rarity variants (only for base material)
        for (const rarity of VISUAL_RARITIES) {
          await generateItemVariant(client, cache, category, itemName, basePrompt, null, rarity, (cached) => {
            if (cached) totalCached++; else totalGenerated++;
          });
        }
      } else {
        // Consumables don't have material/rarity variants
        await generateItemVariant(client, cache, category, itemName, basePrompt, null, null, (cached) => {
          if (cached) totalCached++; else totalGenerated++;
        });
      }
    }
  }

  console.log('\n=== Generation Complete ===');
  console.log(`Generated: ${totalGenerated} item icons`);
  console.log(`From cache: ${totalCached} item icons`);
  console.log(`Total: ${totalGenerated + totalCached}`);
}

/**
 * Generate a single item variant
 */
async function generateItemVariant(client, cache, category, itemName, basePrompt, material, rarity, callback) {
  // Build the full prompt
  let prompt = basePrompt;

  if (material && MATERIAL_MODIFIERS[material]) {
    prompt = `${MATERIAL_MODIFIERS[material]}, ${prompt}`;
  }

  if (rarity && RARITY_MODIFIERS[rarity]) {
    prompt = `${prompt}, ${RARITY_MODIFIERS[rarity]}`;
  }

  // Build filename
  let filename = itemName;
  if (material) filename += `_${material}`;
  if (rarity) filename += `_${rarity}`;
  filename += '.png';

  // Build cache key
  let cacheKey = `item_${category}_${itemName}`;
  if (material) cacheKey += `_${material}`;
  if (rarity) cacheKey += `_${rarity}`;

  const params = {
    description: prompt,
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    isometric: false,
    seed: getItemSeed(category, itemName, material, rarity)
  };

  try {
    const result = await cache.getOrGenerate(cacheKey, params, async (p) => {
      const variant = [material, rarity].filter(Boolean).join('/') || 'base';
      console.log(`  Generating: ${itemName} (${variant})`);
      return await client.createMapObject(p);
    });

    if (result.cached) {
      console.log(`  [CACHED] ${filename}`);
      callback(true);
    } else {
      console.log(`  [GENERATED] ${filename}`);
      callback(false);
    }

    // Copy to assets directory
    const destPath = `items/${category}/${filename}`;
    await cache.copyToAssets(result.cacheKey, destPath);

  } catch (error) {
    console.error(`  [ERROR] ${filename}: ${error.message}`);
  }
}

/**
 * Generate deterministic seed for item
 */
function getItemSeed(category, itemName, material, rarity) {
  const worldSeed = parseInt(process.env.WORLD_SEED || '12345', 10);
  const categoryHash = hashString(category);
  const itemHash = hashString(itemName);
  const materialHash = material ? hashString(material) : 0;
  const rarityHash = rarity ? hashString(rarity) : 0;
  return (worldSeed + categoryHash + itemHash + materialHash + rarityHash) % 1000000;
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
  generateItems().catch(error => {
    console.error('Generation failed:', error);
    process.exit(1);
  });
}

module.exports = { generateItems };
