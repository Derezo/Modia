#!/usr/bin/env node
/**
 * Generate Enemy Sprites
 * Creates enemy sprites for all biomes using PixelLab API
 * Downloads all 8 directions and combines into sprite sheets
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
const fs = require('fs').promises;
const sharp = require('sharp');
const { getPixelLabClient } = require('../services/pixelLabService');
const { ENEMY_PROMPTS, ENEMY_ANIMATION_ACTIONS, buildEnemyAnimationPrompt } = require('../config/pixelLabPrompts');

const ASSETS_DIR = path.join(__dirname, '../../../frontend/public/assets/sprites');

// Enemy size configurations
const ENEMY_SIZES = {
  forest: {
    gray_wolf: 64,
    alpha_wolf: 64,
    goblin_warrior: 64,
    goblin_archer: 64,
    treant: 96,
    forest_sprite: 48,
    spider: 64,
    giant_spider: 64,
    forest_slime: 48
  },
  cave: {
    stone_golem: 80,
    skeleton_warrior: 64,
    skeleton_mage: 64,
    cave_bat: 48,
    slime: 48,
    ghost: 64
  },
  mountain: {
    mountain_troll: 80,
    troll_shaman: 72,
    harpy: 64,
    ice_elemental: 64,
    yeti: 80,
    gargoyle: 64
  },
  bridge: {
    bandit_captain: 64,
    bridge_bandit: 64,
    bandit_archer: 64,
    bandit_rogue: 64,
    mercenary: 64,
    toll_troll: 72,
    bridge_troll: 72
  },
  palace: {
    dark_knight: 72,
    shadow_assassin: 64,
    palace_guard: 72
  },
  bosses: {
    troll_king: 112,
    frost_wyvern: 128,
    dragon: 144
  }
};

// Animations to generate for enemies
const ENEMY_ANIMATIONS = ['idle', 'attack', 'hit', 'death'];

// Direction order for sprite sheet (matches AnimatedSprite.DIRECTIONS)
const DIRECTION_ORDER = ['south', 'south-west', 'west', 'north-west', 'north', 'north-east', 'east', 'south-east'];

/**
 * Download all 8 directions and combine into sprite sheet
 */
async function createSpriteSheet(client, rotationUrls, outputPath) {
  console.log('    Downloading all directions...');

  const directionBuffers = [];
  for (const direction of DIRECTION_ORDER) {
    const url = rotationUrls[direction];
    if (!url) {
      console.warn(`      Warning: No URL for direction '${direction}'`);
      continue;
    }

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      directionBuffers.push({ direction, buffer });
      console.log(`      Downloaded: ${direction}`);
    } catch (error) {
      console.error(`      Failed to download ${direction}: ${error.message}`);
    }
  }

  if (directionBuffers.length === 0) {
    throw new Error('No direction images downloaded');
  }

  // Get frame dimensions from first image
  const firstImage = await sharp(directionBuffers[0].buffer).metadata();
  const frameWidth = firstImage.width;
  const frameHeight = firstImage.height;

  // Create sprite sheet: 1 frame wide, 8 directions tall
  const spriteSheet = await sharp({
    create: {
      width: frameWidth,
      height: frameHeight * 8,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
  .composite(
    directionBuffers.map((item, index) => ({
      input: item.buffer,
      top: index * frameHeight,
      left: 0
    }))
  )
  .png()
  .toBuffer();

  // Ensure directory exists and save
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, spriteSheet);

  console.log(`    Saved sprite sheet: ${frameWidth}x${frameHeight * 8} (${directionBuffers.length} directions)`);
  return { width: frameWidth, height: frameHeight * 8 };
}

/**
 * Generate all enemies for a biome
 */
async function generateBiomeEnemies(client, biome, enemies, options = {}) {
  console.log(`\n=== Generating ${biome} enemies ===`);

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const [enemyName, basePrompt] of Object.entries(enemies)) {
    console.log(`\n--- ${enemyName} ---`);

    const size = ENEMY_SIZES[biome]?.[enemyName] || 64;
    const enemyDir = path.join(ASSETS_DIR, 'characters', 'enemies', biome, enemyName);

    // Generate each animation
    for (const animation of ENEMY_ANIMATIONS) {
      const outputPath = path.join(enemyDir, `${enemyName}_${animation}.png`);

      // Skip if already exists and not forced
      if (!options.force) {
        try {
          await fs.access(outputPath);
          console.log(`  [SKIP] ${animation} - already exists`);
          skipped++;
          continue;
        } catch {
          // File doesn't exist, continue with generation
        }
      }

      // Build prompt - use animation-specific prompt if available
      let prompt = basePrompt;
      const animationAction = buildEnemyAnimationPrompt(enemyName, animation);
      if (animationAction) {
        prompt = `${basePrompt.replace(/,\s*$/, '')}, ${animationAction}`;
      }

      try {
        console.log(`  Generating ${animation} (${size}px)...`);

        const result = await client.createCharacterWith8Directions({
          description: prompt,
          image_size: size,
          outline: 'selective outline',
          shading: 'medium shading',
          detail: 'medium detail',
          isometric: true
        });

        // Get rotation URLs
        const rotationUrls = result.rotation_urls || result.character_data?.rotation_urls;
        if (!rotationUrls) {
          throw new Error('No rotation_urls in API response');
        }

        // Create sprite sheet from all directions
        await createSpriteSheet(client, rotationUrls, outputPath);
        generated++;

      } catch (error) {
        console.error(`  [ERROR] ${animation}: ${error.message}`);
        failed++;
      }
    }
  }

  return { generated, skipped, failed };
}

async function main() {
  console.log('=== Enemy Sprite Generation ===\n');

  // Parse command line arguments
  const args = process.argv.slice(2);
  const options = {
    biome: null,
    enemy: null,
    force: args.includes('--force'),
    dryRun: args.includes('--dry-run')
  };

  for (const arg of args) {
    if (arg.startsWith('--biome=')) {
      options.biome = arg.split('=')[1];
    } else if (arg.startsWith('--enemy=')) {
      options.enemy = arg.split('=')[1];
    }
  }

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: node generate-enemies.js [options]

Options:
  --biome=NAME    Only generate enemies for specific biome
  --enemy=NAME    Only generate specific enemy
  --force         Regenerate even if sprite exists
  --dry-run       Show what would be generated
  --help, -h      Show this help

Examples:
  node generate-enemies.js --biome=forest
  node generate-enemies.js --biome=forest --enemy=gray_wolf
  node generate-enemies.js --force --biome=forest --enemy=gray_wolf
`);
    process.exit(0);
  }

  // Check API key
  if (!process.env.PIXELLAB_API_KEY && !process.env.PIXELLABS_API_KEY) {
    console.error('Error: PIXELLAB_API_KEY not found in environment');
    console.log('Please add your PixelLab API key to .env file');
    process.exit(1);
  }

  const client = getPixelLabClient();

  // Check credits
  try {
    const balance = await client.getBalance();
    console.log(`PixelLab Credits: ${balance.credits || balance.remaining_credits || 'Unknown'}\n`);
  } catch (error) {
    console.warn('Could not fetch credit balance:', error.message);
  }

  if (options.dryRun) {
    console.log('DRY RUN - showing what would be generated:\n');
  }

  let totalGenerated = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  // Filter biomes if specified
  const biomes = options.biome
    ? { [options.biome]: ENEMY_PROMPTS[options.biome] }
    : ENEMY_PROMPTS;

  if (options.biome && !ENEMY_PROMPTS[options.biome]) {
    console.error(`Error: Unknown biome '${options.biome}'`);
    console.log('Available biomes:', Object.keys(ENEMY_PROMPTS).join(', '));
    process.exit(1);
  }

  for (const [biome, enemies] of Object.entries(biomes)) {
    // Filter enemies if specified
    const targetEnemies = options.enemy
      ? { [options.enemy]: enemies[options.enemy] }
      : enemies;

    if (options.enemy && !enemies[options.enemy]) {
      console.error(`Error: Unknown enemy '${options.enemy}' in biome '${biome}'`);
      console.log('Available enemies:', Object.keys(enemies).join(', '));
      process.exit(1);
    }

    if (options.dryRun) {
      console.log(`\nBiome: ${biome}`);
      for (const enemyName of Object.keys(targetEnemies)) {
        console.log(`  Enemy: ${enemyName}`);
        for (const animation of ENEMY_ANIMATIONS) {
          console.log(`    - ${animation}`);
        }
      }
      continue;
    }

    const result = await generateBiomeEnemies(client, biome, targetEnemies, options);
    totalGenerated += result.generated;
    totalSkipped += result.skipped;
    totalFailed += result.failed;
  }

  if (!options.dryRun) {
    console.log('\n=== Generation Complete ===');
    console.log(`Generated: ${totalGenerated} sprite sheets`);
    console.log(`Skipped (existing): ${totalSkipped} sprite sheets`);
    console.log(`Failed: ${totalFailed} sprite sheets`);
    console.log(`Total animations: ${totalGenerated + totalSkipped + totalFailed}`);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Generation failed:', error);
    process.exit(1);
  });
}

module.exports = { generateBiomeEnemies, createSpriteSheet };
