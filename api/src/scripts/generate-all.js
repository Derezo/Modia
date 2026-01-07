#!/usr/bin/env node
/**
 * Generate All Sprites
 * Master script that runs all sprite generation scripts in sequence
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const { generateTiles } = require('./generate-tiles');
const { generateObstacles } = require('./generate-obstacles');
const { generateCharacters } = require('./generate-characters');
const { generateEnemies } = require('./generate-enemies');
const { generateNodes } = require('./generate-nodes');
const { generateItems } = require('./generate-items');

// Parse command line arguments
const args = process.argv.slice(2);
const skipFlags = {
  tiles: args.includes('--skip-tiles'),
  obstacles: args.includes('--skip-obstacles'),
  characters: args.includes('--skip-characters'),
  enemies: args.includes('--skip-enemies'),
  nodes: args.includes('--skip-nodes'),
  items: args.includes('--skip-items')
};

const onlyFlag = args.find(arg => arg.startsWith('--only='));
const onlyTypes = onlyFlag ? onlyFlag.split('=')[1].split(',') : null;

async function generateAll() {
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║      MODIA SPRITE GENERATION PIPELINE         ║');
  console.log('╚═══════════════════════════════════════════════╝\n');

  if (!process.env.PIXELLAB_API_KEY && !process.env.PIXELLABS_API_KEY) {
    console.error('Error: PIXELLAB_API_KEY not found in environment');
    console.log('Please add your PixelLab API key to .env file');
    process.exit(1);
  }

  const startTime = Date.now();
  const results = [];

  // Define generation pipeline
  const pipeline = [
    { name: 'tiles', label: 'Terrain Tiles', fn: generateTiles },
    { name: 'obstacles', label: 'Obstacles', fn: generateObstacles },
    { name: 'characters', label: 'Player Characters', fn: generateCharacters },
    { name: 'enemies', label: 'Enemies', fn: generateEnemies },
    { name: 'nodes', label: 'World Map Nodes', fn: generateNodes },
    { name: 'items', label: 'Item Icons', fn: generateItems }
  ];

  // Filter pipeline based on flags
  const filteredPipeline = pipeline.filter(step => {
    if (onlyTypes) {
      return onlyTypes.includes(step.name);
    }
    return !skipFlags[step.name];
  });

  console.log(`Running ${filteredPipeline.length} generation steps...\n`);

  for (const step of filteredPipeline) {
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`  Starting: ${step.label}`);
    console.log('═'.repeat(50));

    const stepStart = Date.now();

    try {
      await step.fn();
      const stepDuration = ((Date.now() - stepStart) / 1000).toFixed(1);
      results.push({ name: step.label, status: 'success', duration: stepDuration });
      console.log(`\n✓ ${step.label} completed in ${stepDuration}s`);
    } catch (error) {
      const stepDuration = ((Date.now() - stepStart) / 1000).toFixed(1);
      results.push({ name: step.label, status: 'failed', duration: stepDuration, error: error.message });
      console.error(`\n✗ ${step.label} failed after ${stepDuration}s: ${error.message}`);

      // Continue with other generators even if one fails
      if (!args.includes('--fail-fast')) {
        continue;
      } else {
        break;
      }
    }
  }

  // Print summary
  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n\n╔═══════════════════════════════════════════════╗');
  console.log('║              GENERATION SUMMARY               ║');
  console.log('╚═══════════════════════════════════════════════╝\n');

  const successCount = results.filter(r => r.status === 'success').length;
  const failCount = results.filter(r => r.status === 'failed').length;

  for (const result of results) {
    const icon = result.status === 'success' ? '✓' : '✗';
    const duration = `${result.duration}s`.padStart(8);
    console.log(`  ${icon} ${result.name.padEnd(25)} ${duration}`);
    if (result.error) {
      console.log(`      Error: ${result.error}`);
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  Total time: ${totalDuration}s`);
  console.log(`  Successful: ${successCount}/${results.length}`);
  if (failCount > 0) {
    console.log(`  Failed: ${failCount}/${results.length}`);
  }
  console.log(`${'─'.repeat(50)}\n`);

  // Exit with error code if any failed
  if (failCount > 0) {
    process.exit(1);
  }
}

// Print help if requested
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: node generate-all.js [options]

Options:
  --skip-tiles       Skip terrain tile generation
  --skip-obstacles   Skip obstacle generation
  --skip-characters  Skip character sprite generation
  --skip-enemies     Skip enemy sprite generation
  --skip-nodes       Skip world map node generation
  --skip-items       Skip item icon generation
  --only=type1,type2 Only run specific generators (tiles,obstacles,characters,enemies,nodes,items)
  --fail-fast        Stop on first error instead of continuing
  --help, -h         Show this help message

Examples:
  node generate-all.js                          # Run all generators
  node generate-all.js --skip-items             # Skip item generation
  node generate-all.js --only=tiles,obstacles   # Only generate tiles and obstacles
  node generate-all.js --fail-fast              # Stop if any generator fails
`);
  process.exit(0);
}

// Run if called directly
if (require.main === module) {
  generateAll().catch(error => {
    console.error('Generation pipeline failed:', error);
    process.exit(1);
  });
}

module.exports = { generateAll };
