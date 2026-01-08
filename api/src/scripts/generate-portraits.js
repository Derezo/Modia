#!/usr/bin/env node
/**
 * Generate Character Portraits
 * Creates 64x64 portrait images for all race/gender/class combinations
 *
 * 120 total portraits: 5 races × 3 genders × 8 classes
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
const { getPortraitService, RACES, GENDERS, CLASSES } = require('../services/portraitService');
const { getPixelLabClient } = require('../services/pixelLabService');

async function main() {
  console.log('=== Portrait Generation ===\n');

  // Parse command line arguments
  const args = process.argv.slice(2);
  const options = {
    race: null,
    gender: null,
    charClass: null,
    force: args.includes('--force'),
    dryRun: args.includes('--dry-run'),
    status: args.includes('--status')
  };

  for (const arg of args) {
    if (arg.startsWith('--race=')) {
      options.race = arg.split('=')[1];
    }
    if (arg.startsWith('--gender=')) {
      options.gender = arg.split('=')[1];
    }
    if (arg.startsWith('--class=')) {
      options.charClass = arg.split('=')[1];
    }
  }

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: node generate-portraits.js [options]

Options:
  --race=NAME     Only generate specific race (${RACES.join(', ')})
  --gender=NAME   Only generate specific gender (${GENDERS.join(', ')})
  --class=NAME    Only generate specific class (${CLASSES.join(', ')})
  --force         Regenerate even if portrait exists
  --status        Show current portrait status
  --dry-run       Show what would be generated
  --help, -h      Show this help

Examples:
  node generate-portraits.js --status
  node generate-portraits.js --race=elf
  node generate-portraits.js --race=human --gender=female
  node generate-portraits.js --force --class=wizard
`);
    process.exit(0);
  }

  // Check API key
  if (!process.env.PIXELLAB_API_KEY && !process.env.PIXELLABS_API_KEY) {
    console.error('Error: PIXELLAB_API_KEY not found in environment');
    console.log('Please add your PixelLab API key to .env file');
    process.exit(1);
  }

  const portraitService = getPortraitService();
  await portraitService.initialize();

  // Status check
  if (options.status) {
    const status = await portraitService.getPortraitStatus();
    console.log(`Portrait Status:`);
    console.log(`  Total needed: ${status.total}`);
    console.log(`  Existing: ${status.existing}`);
    console.log(`  Missing: ${status.missing.length}`);

    if (status.missing.length > 0 && status.missing.length <= 20) {
      console.log('\nMissing portraits:');
      for (const m of status.missing) {
        console.log(`  - ${m.race}_${m.gender}_${m.charClass}`);
      }
    } else if (status.missing.length > 20) {
      console.log(`\n(${status.missing.length} portraits missing - run without --status to generate)`);
    }
    return;
  }

  // Check credits
  const client = getPixelLabClient();
  try {
    const balance = await client.getBalance();
    console.log(`PixelLab Credits: ${balance.credits || balance.remaining_credits || 'Unknown'}\n`);
  } catch (error) {
    console.warn('Could not fetch credit balance:', error.message);
  }

  // Filter combinations based on options
  const races = options.race ? [options.race] : RACES;
  const genders = options.gender ? [options.gender] : GENDERS;
  const classes = options.charClass ? [options.charClass] : CLASSES;

  // Validate filters
  if (options.race && !RACES.includes(options.race)) {
    console.error(`Error: Unknown race '${options.race}'`);
    console.log('Available races:', RACES.join(', '));
    process.exit(1);
  }
  if (options.gender && !GENDERS.includes(options.gender)) {
    console.error(`Error: Unknown gender '${options.gender}'`);
    console.log('Available genders:', GENDERS.join(', '));
    process.exit(1);
  }
  if (options.charClass && !CLASSES.includes(options.charClass)) {
    console.error(`Error: Unknown class '${options.charClass}'`);
    console.log('Available classes:', CLASSES.join(', '));
    process.exit(1);
  }

  const total = races.length * genders.length * classes.length;
  console.log(`Generating ${total} portrait(s)...\n`);

  if (options.dryRun) {
    console.log('DRY RUN - showing what would be generated:\n');
    for (const race of races) {
      for (const gender of genders) {
        for (const charClass of classes) {
          const exists = await portraitService.portraitExists(race, gender, charClass);
          const status = exists ? '[EXISTS]' : '[GENERATE]';
          const forceStatus = options.force && exists ? ' -> [REGENERATE]' : '';
          console.log(`  ${race}_${gender}_${charClass}: ${status}${forceStatus}`);
        }
      }
    }
    return;
  }

  let generated = 0;
  let skipped = 0;
  let failed = 0;
  let current = 0;

  for (const race of races) {
    for (const gender of genders) {
      for (const charClass of classes) {
        current++;
        const progressPct = Math.round((current / total) * 100);

        // Check if exists
        if (!options.force && await portraitService.portraitExists(race, gender, charClass)) {
          console.log(`[${progressPct}%] SKIP ${race}_${gender}_${charClass} (exists)`);
          skipped++;
          continue;
        }

        console.log(`[${progressPct}%] Generating ${race}_${gender}_${charClass}...`);

        const result = await portraitService.generatePortrait(race, gender, charClass, options.force);

        if (result.success) {
          if (result.cached) {
            console.log(`  -> Cached: ${result.url}`);
            skipped++;
          } else {
            console.log(`  -> Generated: ${result.url}`);
            generated++;
          }
        } else {
          console.error(`  -> FAILED: ${result.error}`);
          failed++;
        }

        // Rate limiting between API calls
        if (!result.cached) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }
  }

  console.log('\n=== Generation Complete ===');
  console.log(`Generated: ${generated} portraits`);
  console.log(`Skipped (existing): ${skipped} portraits`);
  console.log(`Failed: ${failed} portraits`);
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Generation failed:', error);
    process.exit(1);
  });
}

module.exports = { main };
