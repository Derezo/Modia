#!/usr/bin/env node
/**
 * Prompt Validation Script
 * Generates sample sprites to validate prompts before batch generation
 *
 * Usage:
 *   npm run validate:sprites -- --type=enemy --name=gray_wolf
 *   npm run validate:sprites -- --type=character --race=elf --class=wizard
 *   npm run validate:sprites -- --type=character --race=orc --class=wizard --weapon=oak_staff --armor=apprentice_robe
 *   npm run validate:sprites -- --list-enemies
 *   npm run validate:sprites -- --list-races
 *   npm run validate:sprites -- --dry-run --type=enemy --name=gray_wolf
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs').promises;
const sharp = require('sharp');
const { getPixelLabClient } = require('../services/pixelLabService');
const {
  STYLE_SUFFIX,
  ENEMY_PROMPTS,
  CHARACTER_PROMPTS
} = require('../config/pixelLabPrompts');

// Race-specific visual traits
const RACE_PROMPTS = {
  human: {
    base: 'human',
    traits: 'average build, determined expression',
    skinTone: 'natural skin tone'
  },
  elf: {
    base: 'elf',
    traits: 'pointed ears, slender build, graceful features',
    skinTone: 'fair pale skin, ethereal glow'
  },
  dwarf: {
    base: 'dwarf',
    traits: 'short stocky build, thick beard, broad shoulders',
    skinTone: 'ruddy complexion'
  },
  vampire: {
    base: 'vampire',
    traits: 'pale undead, fangs visible, crimson eyes, dark elegant',
    skinTone: 'deathly pale skin, dark veins'
  },
  orc: {
    base: 'orc',
    traits: 'green skin, tusks, muscular brutish build',
    skinTone: 'green-gray skin'
  }
};

// Equipment prompts
const EQUIPMENT_PROMPTS = {
  weapons: {
    oak_staff: 'wooden oak staff, simple design',
    crystal_staff: 'crystalline staff, glowing blue crystal orb',
    enchanted_staff: 'enchanted staff, magical runes, pulsing energy',
    dark_staff: 'dark obsidian staff, shadowy wisps',
    rusty_sword: 'rusty iron sword, worn blade',
    iron_sword: 'iron sword, simple but sturdy',
    steel_sword: 'polished steel longsword'
  },
  armor: {
    cloth_robe: 'simple cloth robe',
    apprentice_robe: 'apprentice wizard robes, basic arcane trim',
    wizard_robe: 'flowing blue wizard robes, arcane symbols',
    archmage_robe: 'ornate archmage robes, powerful enchantments glowing',
    leather_armor: 'brown leather armor, practical',
    chain_mail: 'chain mail armor, metal links',
    plate_armor: 'shining plate armor, full coverage'
  }
};

// Enemy animation actions for richer prompts
const ENEMY_ANIMATION_ACTIONS = {
  gray_wolf: { idle: 'standing alert, ears perked, watching' },
  alpha_wolf: { idle: 'commanding presence, scarred, glowing eyes' },
  goblin_warrior: { idle: 'standing guard, sword ready' },
  goblin_archer: { idle: 'sneaky pose, shortbow ready' },
  treant: { idle: 'standing still, branches swaying gently' },
  forest_sprite: { idle: 'hovering, wings shimmering' },
  spider: { idle: 'crouched, legs twitching, ready to strike' }
};

// Wizard animation actions by race
const WIZARD_ANIMATION_ACTIONS = {
  human: { idle: 'standing calm, staff resting, robes flowing gently, focused expression' },
  elf: { idle: 'standing gracefully, staff glowing softly, ethereal presence, pointed ears visible' },
  dwarf: { idle: 'standing sturdy, staff planted firmly, beard braided, runes on armor' },
  vampire: { idle: 'standing menacingly, staff pulsing dark energy, crimson eyes glowing' },
  orc: { idle: 'standing powerfully, staff crackling energy, tusks prominent, intimidating' }
};

/**
 * Build prompt for enemy validation
 */
function buildEnemyPrompt(biome, enemyName) {
  // Find the enemy in ENEMY_PROMPTS
  const biomePrompts = ENEMY_PROMPTS[biome];
  if (!biomePrompts || !biomePrompts[enemyName]) {
    throw new Error(`Enemy not found: ${biome}/${enemyName}`);
  }

  const basePrompt = biomePrompts[enemyName];
  const action = ENEMY_ANIMATION_ACTIONS[enemyName]?.idle || 'standing ready';

  return `${basePrompt}, ${action}`;
}

/**
 * Build prompt for character validation
 */
function buildCharacterPrompt(race, charClass, weapon, armor) {
  const raceInfo = RACE_PROMPTS[race];
  if (!raceInfo) {
    throw new Error(`Unknown race: ${race}. Available: ${Object.keys(RACE_PROMPTS).join(', ')}`);
  }

  const weaponDesc = weapon ? EQUIPMENT_PROMPTS.weapons[weapon] : 'magical staff';
  const armorDesc = armor ? EQUIPMENT_PROMPTS.armor[armor] : 'wizard robes';

  if (weapon && !EQUIPMENT_PROMPTS.weapons[weapon]) {
    console.warn(`Warning: Unknown weapon "${weapon}", using as-is`);
  }
  if (armor && !EQUIPMENT_PROMPTS.armor[armor]) {
    console.warn(`Warning: Unknown armor "${armor}", using as-is`);
  }

  // Get action for this race's wizard
  const action = WIZARD_ANIMATION_ACTIONS[race]?.idle || 'standing ready, heroic stance';

  return `Fantasy ${raceInfo.base} ${charClass}, ${raceInfo.traits}, ` +
    `${raceInfo.skinTone}, wielding ${weaponDesc}, wearing ${armorDesc}, ` +
    `${action}, ${STYLE_SUFFIX}`;
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = {
    type: null,
    name: null,
    race: null,
    class: 'wizard',
    weapon: null,
    armor: null,
    biome: 'forest',
    dryRun: false,
    deploy: false,
    listEnemies: false,
    listRaces: false,
    help: false
  };

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--deploy') {
      args.deploy = true;
    } else if (arg === '--list-enemies') {
      args.listEnemies = true;
    } else if (arg === '--list-races') {
      args.listRaces = true;
    } else if (arg.startsWith('--type=')) {
      args.type = arg.split('=')[1];
    } else if (arg.startsWith('--name=')) {
      args.name = arg.split('=')[1];
    } else if (arg.startsWith('--race=')) {
      args.race = arg.split('=')[1];
    } else if (arg.startsWith('--class=')) {
      args.class = arg.split('=')[1];
    } else if (arg.startsWith('--weapon=')) {
      args.weapon = arg.split('=')[1];
    } else if (arg.startsWith('--armor=')) {
      args.armor = arg.split('=')[1];
    } else if (arg.startsWith('--biome=')) {
      args.biome = arg.split('=')[1];
    }
  }

  return args;
}

/**
 * Show help message
 */
function showHelp() {
  console.log(`
Prompt Validation Script
========================

Generates sample sprites to validate prompts before batch generation.

Usage:
  npm run validate:sprites -- [options]

Options:
  --type=enemy|character    Type of sprite to validate
  --name=NAME               Enemy name (for enemy type)
  --race=RACE               Character race (for character type)
  --class=CLASS             Character class (default: wizard)
  --weapon=WEAPON           Weapon to equip
  --armor=ARMOR             Armor to equip
  --biome=BIOME             Enemy biome (default: forest)
  --dry-run                 Show prompt without generating
  --deploy                  Also copy sprite to game assets folder
  --list-enemies            List all available enemies
  --list-races              List all available races
  --help, -h                Show this help

Examples:
  # Validate a forest enemy
  npm run validate:sprites -- --type=enemy --name=gray_wolf

  # Validate AND deploy to game assets
  npm run validate:sprites -- --type=enemy --name=gray_wolf --deploy

  # Validate a character
  npm run validate:sprites -- --type=character --race=elf --class=wizard

  # Validate with equipment
  npm run validate:sprites -- --type=character --race=orc --class=wizard --weapon=oak_staff --armor=apprentice_robe

  # Dry run (show prompt only)
  npm run validate:sprites -- --dry-run --type=enemy --name=treant

Output:
  Samples are saved to .pixellab-cache/validation/
`);
}

/**
 * List available enemies
 */
function listEnemies() {
  console.log('\nAvailable Enemies by Biome:');
  console.log('===========================\n');

  for (const [biome, enemies] of Object.entries(ENEMY_PROMPTS)) {
    console.log(`${biome.toUpperCase()}:`);
    for (const name of Object.keys(enemies)) {
      console.log(`  - ${name}`);
    }
    console.log();
  }
}

/**
 * List available races
 */
function listRaces() {
  console.log('\nAvailable Races:');
  console.log('================\n');

  for (const [race, info] of Object.entries(RACE_PROMPTS)) {
    console.log(`${race.toUpperCase()}:`);
    console.log(`  Traits: ${info.traits}`);
    console.log(`  Skin: ${info.skinTone}`);
    console.log();
  }

  console.log('\nAvailable Weapons:');
  console.log('==================');
  for (const [key, desc] of Object.entries(EQUIPMENT_PROMPTS.weapons)) {
    console.log(`  ${key}: ${desc}`);
  }

  console.log('\nAvailable Armor:');
  console.log('================');
  for (const [key, desc] of Object.entries(EQUIPMENT_PROMPTS.armor)) {
    console.log(`  ${key}: ${desc}`);
  }
}

/**
 * Validate a prompt by generating a sample
 */
async function validatePrompt(args) {
  let prompt;
  let outputName;

  if (args.type === 'enemy') {
    if (!args.name) {
      throw new Error('Enemy name required. Use --name=<enemy_name>');
    }
    prompt = buildEnemyPrompt(args.biome, args.name);
    outputName = `enemy_${args.biome}_${args.name}`;
  } else if (args.type === 'character') {
    if (!args.race) {
      throw new Error('Race required. Use --race=<race>');
    }
    prompt = buildCharacterPrompt(args.race, args.class, args.weapon, args.armor);
    outputName = `character_${args.race}_${args.class}`;
    if (args.weapon) outputName += `_${args.weapon}`;
    if (args.armor) outputName += `_${args.armor}`;
  } else {
    throw new Error('Type required. Use --type=enemy or --type=character');
  }

  console.log('\n=== Prompt Preview ===');
  console.log(prompt);
  console.log('======================\n');

  if (args.dryRun) {
    console.log('Dry run mode - no image generated');
    return;
  }

  // Check for API key
  if (!process.env.PIXELLAB_API_KEY && !process.env.PIXELLABS_API_KEY) {
    console.error('Error: PIXELLAB_API_KEY not set in environment');
    process.exit(1);
  }

  console.log('Generating sample sprite...');

  const pixelLab = getPixelLabClient();

  const result = await pixelLab.createCharacterWith8Directions({
    description: prompt,
    image_size: 64,
    outline: 'selective outline',
    shading: 'medium shading',
    detail: 'medium detail',
    isometric: true
  });

  // Ensure validation directory exists
  const validationDir = path.join(process.cwd(), '.pixellab-cache', 'validation');
  await fs.mkdir(validationDir, { recursive: true });

  // Save the image
  const outputPath = path.join(validationDir, `${outputName}_sample.png`);
  await pixelLab.saveImage(result, outputPath);

  console.log(`\nSample saved to: ${outputPath}`);

  // Deploy to game assets if --deploy flag is set
  if (args.deploy) {
    const assetsDir = path.join(process.cwd(), 'frontend', 'public', 'assets', 'sprites');

    // Direction order for sprite sheet (matches AnimatedSprite.DIRECTIONS)
    // Row 0=South, 1=Southwest, 2=West, 3=Northwest, 4=North, 5=Northeast, 6=East, 7=Southeast
    const directionOrder = ['south', 'south-west', 'west', 'north-west', 'north', 'north-east', 'east', 'south-east'];

    if (args.type === 'enemy') {
      const enemyDir = path.join(assetsDir, 'characters', 'enemies', args.biome, args.name);
      await fs.mkdir(enemyDir, { recursive: true });

      if (result.rotation_urls || result.character_data?.rotation_urls) {
        const urls = result.rotation_urls || result.character_data.rotation_urls;
        console.log('\nDownloading all directions...');

        // Download all direction images
        const directionBuffers = [];
        for (const direction of directionOrder) {
          const url = urls[direction];
          if (!url) {
            console.warn(`  Warning: No URL for direction '${direction}'`);
            continue;
          }
          const response = await fetch(url);
          const buffer = Buffer.from(await response.arrayBuffer());
          directionBuffers.push({ direction, buffer });
          console.log(`  Downloaded: ${direction}`);
        }

        // Combine into sprite sheet (8 rows, 1 column for single-frame idle)
        if (directionBuffers.length > 0) {
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

          const idlePath = path.join(enemyDir, `${args.name}_idle.png`);
          await fs.writeFile(idlePath, spriteSheet);
          console.log(`\nCreated sprite sheet: ${idlePath}`);
          console.log(`  Size: ${frameWidth}x${frameHeight * 8} (${directionBuffers.length} directions)`);
          console.log('Sprite is now available in the game!');
        }
      }
    } else if (args.type === 'character') {
      const charDir = path.join(assetsDir, 'characters', 'player', args.class);
      await fs.mkdir(charDir, { recursive: true });

      if (result.rotation_urls || result.character_data?.rotation_urls) {
        const urls = result.rotation_urls || result.character_data.rotation_urls;
        console.log('\nDownloading all directions...');

        // Download all direction images
        const directionBuffers = [];
        for (const direction of directionOrder) {
          const url = urls[direction];
          if (!url) {
            console.warn(`  Warning: No URL for direction '${direction}'`);
            continue;
          }
          const response = await fetch(url);
          const buffer = Buffer.from(await response.arrayBuffer());
          directionBuffers.push({ direction, buffer });
          console.log(`  Downloaded: ${direction}`);
        }

        // Combine into sprite sheet
        if (directionBuffers.length > 0) {
          const firstImage = await sharp(directionBuffers[0].buffer).metadata();
          const frameWidth = firstImage.width;
          const frameHeight = firstImage.height;

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

          const idlePath = path.join(charDir, `${args.class}_idle.png`);
          await fs.writeFile(idlePath, spriteSheet);
          console.log(`\nCreated sprite sheet: ${idlePath}`);
          console.log(`  Size: ${frameWidth}x${frameHeight * 8} (${directionBuffers.length} directions)`);
          console.log('Sprite is now available in the game!');
        }
      }
    }
  } else {
    console.log('Review the sample and adjust prompts if needed.');
    console.log('Use --deploy to copy the sprite to game assets.');
  }

  // Also extract character_id if available for animation testing
  if (result.character_id || result.last_response?.character_id) {
    const characterId = result.character_id || result.last_response?.character_id;
    console.log(`\nCharacter ID: ${characterId}`);
    console.log('Use this ID for animation validation.');
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = parseArgs();

  if (args.help) {
    showHelp();
    return;
  }

  if (args.listEnemies) {
    listEnemies();
    return;
  }

  if (args.listRaces) {
    listRaces();
    return;
  }

  try {
    await validatePrompt(args);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
