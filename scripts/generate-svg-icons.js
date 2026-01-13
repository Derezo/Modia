#!/usr/bin/env node
/**
 * Programmatic SVG Icon Generation Script
 * Generates SVG icons for enemies (and potentially other categories)
 *
 * Usage:
 *   node scripts/generate-svg-icons.js           # Generate all categories
 *   node scripts/generate-svg-icons.js enemies   # Enemies only
 *   node scripts/generate-svg-icons.js --help    # Show help
 *   node scripts/generate-svg-icons.js --list    # List available generators
 *
 * After running this script, run `npm run generate:icons` to convert SVGs to PNGs.
 */

const fs = require('fs');
const path = require('path');
const { generateEnemyIcons } = require('./icons/enemies');

const SVG_DIR = path.join(__dirname, '../frontend/public/assets/icons/svg');

/**
 * Parse command line arguments
 * @returns {Object} Parsed options
 */
function parseArgs() {
  const args = process.argv.slice(2);
  return {
    help: args.includes('--help') || args.includes('-h'),
    list: args.includes('--list') || args.includes('-l'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    categories: args.filter(a => !a.startsWith('-'))
  };
}

/**
 * Show help message
 */
function showHelp() {
  console.log(`
Programmatic SVG Icon Generation Script
Generates SVG icons from code-defined generators.

Usage:
  node scripts/generate-svg-icons.js [options] [categories...]

Options:
  --help, -h     Show this help message
  --list, -l     List available generators and their icon counts
  --verbose, -v  Show detailed progress

Categories:
  enemies        Generate 16 enemy icons

Examples:
  node scripts/generate-svg-icons.js              # Generate all
  node scripts/generate-svg-icons.js enemies      # Enemies only
  node scripts/generate-svg-icons.js --list       # Show available generators

After generation:
  npm run generate:icons    # Convert SVGs to PNGs at 16/24/32/48px
`);
}

/**
 * List available generators
 */
function listGenerators() {
  console.log('\nAvailable Icon Generators:\n');

  const generators = {
    enemies: {
      count: Object.keys(generateEnemyIcons()).length,
      description: 'Enemy creature icons (goblin, wolf, skeleton, etc.)'
    }
    // Add more categories here as they're implemented
    // classes: { count: 20, description: 'Player class icons' }
  };

  for (const [name, info] of Object.entries(generators)) {
    console.log(`  ${name.padEnd(12)} ${String(info.count).padStart(3)} icons  ${info.description}`);
  }

  const total = Object.values(generators).reduce((sum, g) => sum + g.count, 0);
  console.log(`\n  Total: ${total} icons\n`);
}

/**
 * Ensure directory exists
 * @param {string} dir - Directory path
 */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
}

/**
 * Generate icons for a category
 * @param {string} category - Category name
 * @param {Object} icons - Map of icon name to SVG content
 * @param {boolean} verbose - Show verbose output
 * @returns {Object} Generation results
 */
function generateCategory(category, icons, verbose = false) {
  const categoryDir = path.join(SVG_DIR, category);
  ensureDir(categoryDir);

  let generated = 0;
  let failed = 0;

  for (const [name, svg] of Object.entries(icons)) {
    const filePath = path.join(categoryDir, `${name}.svg`);

    try {
      fs.writeFileSync(filePath, svg, 'utf8');
      if (verbose) {
        console.log(`  [OK] ${name}.svg`);
      }
      generated++;
    } catch (err) {
      console.error(`  [FAIL] ${name}.svg: ${err.message}`);
      failed++;
    }
  }

  return { generated, failed };
}

/**
 * Generate enemy icons
 * @param {boolean} verbose - Show verbose output
 * @returns {Object} Generation results
 */
function generateEnemies(verbose = false) {
  console.log('\nGenerating enemy icons...');
  const icons = generateEnemyIcons();
  const result = generateCategory('enemies', icons, verbose);
  console.log(`  Generated ${result.generated} icons${result.failed > 0 ? `, ${result.failed} failed` : ''}`);
  return result;
}

/**
 * Main entry point
 */
async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  if (options.list) {
    listGenerators();
    process.exit(0);
  }

  console.log('=== SVG Icon Generation ===');

  const generateAll = options.categories.length === 0;
  let totalGenerated = 0;
  let totalFailed = 0;

  // Generate enemies
  if (generateAll || options.categories.includes('enemies')) {
    const result = generateEnemies(options.verbose);
    totalGenerated += result.generated;
    totalFailed += result.failed;
  }

  // Add more categories here as they're implemented
  // if (generateAll || options.categories.includes('classes')) {
  //   const result = generateClasses(options.verbose);
  //   totalGenerated += result.generated;
  //   totalFailed += result.failed;
  // }

  console.log('\n=== Generation Complete ===');
  console.log(`Total generated: ${totalGenerated} SVG files`);
  if (totalFailed > 0) {
    console.log(`Total failed: ${totalFailed} files`);
  }
  console.log('\nNext step: Run "npm run generate:icons" to convert SVGs to PNGs');

  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Generation failed:', err.message);
  process.exit(1);
});
