#!/usr/bin/env node
/**
 * Generate Character Sprites
 * Creates 8-directional animated sprites for player classes using PixelLab API
 * Downloads all 8 directions and combines into sprite sheets
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
const fs = require('fs').promises;
const sharp = require('sharp');
const { getPixelLabClient } = require('../services/pixelLabService');
const { CHARACTER_PROMPTS, CHARACTER_ANIMATION_ACTIONS, buildCharacterAnimationPrompt } = require('../config/pixelLabPrompts');

const ASSETS_DIR = path.join(__dirname, '../../../frontend/public/assets/sprites');

// Character size
const CHARACTER_SIZE = 64;

// Animations to generate for player characters
const CHARACTER_ANIMATIONS = ['idle', 'walk', 'attack', 'hit', 'death'];

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
 * Generate all animations for a character class
 */
async function generateCharacterClass(client, charClass, basePrompt, options = {}) {
  console.log(`\n=== Generating ${charClass} ===`);

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  const charDir = path.join(ASSETS_DIR, 'characters', 'player', charClass);

  // Generate each animation
  for (const animation of CHARACTER_ANIMATIONS) {
    const outputPath = path.join(charDir, `${charClass}_${animation}.png`);

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
    const animationAction = buildCharacterAnimationPrompt(charClass, animation);
    if (animationAction) {
      prompt = `${basePrompt.replace(/,\s*$/, '')}, ${animationAction}`;
    }

    try {
      console.log(`  Generating ${animation} (${CHARACTER_SIZE}px)...`);

      const result = await client.createCharacterWith8Directions({
        description: prompt,
        image_size: CHARACTER_SIZE,
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

  return { generated, skipped, failed };
}

async function main() {
  console.log('=== Character Sprite Generation ===\n');

  // Parse command line arguments
  const args = process.argv.slice(2);
  const options = {
    charClass: null,
    force: args.includes('--force'),
    dryRun: args.includes('--dry-run')
  };

  for (const arg of args) {
    if (arg.startsWith('--class=')) {
      options.charClass = arg.split('=')[1];
    }
  }

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: node generate-characters.js [options]

Options:
  --class=NAME    Only generate specific character class
  --force         Regenerate even if sprite exists
  --dry-run       Show what would be generated
  --help, -h      Show this help

Examples:
  node generate-characters.js --class=wizard
  node generate-characters.js --force --class=wizard
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

  // Filter classes if specified
  const classes = options.charClass
    ? { [options.charClass]: CHARACTER_PROMPTS[options.charClass] }
    : CHARACTER_PROMPTS;

  if (options.charClass && !CHARACTER_PROMPTS[options.charClass]) {
    console.error(`Error: Unknown character class '${options.charClass}'`);
    console.log('Available classes:', Object.keys(CHARACTER_PROMPTS).join(', '));
    process.exit(1);
  }

  for (const [charClass, prompt] of Object.entries(classes)) {
    if (options.dryRun) {
      console.log(`\nClass: ${charClass}`);
      for (const animation of CHARACTER_ANIMATIONS) {
        console.log(`  - ${animation}`);
      }
      continue;
    }

    const result = await generateCharacterClass(client, charClass, prompt, options);
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

module.exports = { generateCharacterClass, createSpriteSheet };
