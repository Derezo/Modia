#!/usr/bin/env node
/**
 * Icon Filename Migration Script
 *
 * Migrates icon filenames from prefixed format to non-prefixed format:
 * - Before: menu/menu_settings.png
 * - After:  menu/settings.png
 *
 * Also handles malformed paths from previous generation runs:
 * - Before: actions-action_move.png (at size root level)
 * - After:  actions/move.png (in correct subdirectory)
 *
 * Usage:
 *   node scripts/ai-images/migrate-icon-filenames.js          # Dry run (preview)
 *   node scripts/ai-images/migrate-icon-filenames.js --apply  # Apply changes
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const ICONS_BASE = path.join(PROJECT_ROOT, 'frontend/public/assets/icons');
const PNG_DIR = path.join(ICONS_BASE, 'png');
const ORIGINALS_DIR = path.join(ICONS_BASE, 'originals');

const ICON_CATEGORIES = ['actions', 'status', 'menu', 'augments', 'resources', 'zodiac'];
const SIZES = [16, 24, 32, 48, 64, 128, 256];

// Mapping from category to prefix patterns to strip
const CATEGORY_PREFIXES = {
  actions: 'action_',
  status: 'status_',
  menu: 'menu_',
  augments: 'augment_',
  resources: 'resource_',
  zodiac: 'zodiac_'
};

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    apply: args.includes('--apply'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    help: args.includes('--help') || args.includes('-h')
  };
}

function showHelp() {
  console.log(`
Icon Filename Migration Script

Migrates icon filenames from prefixed format to non-prefixed format.
Example: menu/menu_settings.png -> menu/settings.png

Usage:
  node scripts/ai-images/migrate-icon-filenames.js [options]

Options:
  --apply     Apply the changes (default is dry run)
  --verbose   Show detailed output
  --help      Show this help message

Examples:
  node scripts/ai-images/migrate-icon-filenames.js          # Preview changes
  node scripts/ai-images/migrate-icon-filenames.js --apply  # Apply changes
`);
}

/**
 * Strip the category prefix from a filename
 */
function stripPrefix(filename, category) {
  const baseName = path.basename(filename, '.png');
  const prefix = CATEGORY_PREFIXES[category];

  if (prefix && baseName.startsWith(prefix)) {
    return baseName.slice(prefix.length) + '.png';
  }

  // Also handle full category prefix (e.g., 'menu_settings' when category is 'menu')
  if (baseName.startsWith(`${category}_`)) {
    return baseName.slice(category.length + 1) + '.png';
  }

  return filename;
}

/**
 * Process a single directory for icon migrations
 */
function processDirectory(dir, category, options) {
  const migrations = [];

  if (!fs.existsSync(dir)) {
    return migrations;
  }

  const files = fs.readdirSync(dir);

  for (const file of files) {
    if (!file.endsWith('.png')) continue;

    const newFilename = stripPrefix(file, category);

    if (newFilename !== file) {
      migrations.push({
        from: path.join(dir, file),
        to: path.join(dir, newFilename),
        category
      });
    }
  }

  return migrations;
}

/**
 * Process malformed files at the size root level
 * e.g., icons/png/32/actions-action_move.png -> icons/png/32/actions/move.png
 */
function processMalformedFiles(sizeDir, options) {
  const migrations = [];

  if (!fs.existsSync(sizeDir)) {
    return migrations;
  }

  const files = fs.readdirSync(sizeDir);

  for (const file of files) {
    // Check for malformed pattern: {category}-{category}_{name}.png
    for (const category of ICON_CATEGORIES) {
      const pattern = `${category}-`;
      if (file.startsWith(pattern) && file.endsWith('.png')) {
        const rest = file.slice(pattern.length, -4); // Remove prefix and .png
        const newFilename = stripPrefix(rest + '.png', category);
        const targetDir = path.join(sizeDir, category);

        migrations.push({
          from: path.join(sizeDir, file),
          to: path.join(targetDir, newFilename),
          category,
          createDir: targetDir
        });
      }
    }
  }

  return migrations;
}

/**
 * Apply migrations
 */
function applyMigrations(migrations, options) {
  const applied = [];
  const failed = [];
  const dirsCreated = new Set();

  for (const migration of migrations) {
    try {
      // Create target directory if needed
      if (migration.createDir && !dirsCreated.has(migration.createDir)) {
        if (!fs.existsSync(migration.createDir)) {
          fs.mkdirSync(migration.createDir, { recursive: true });
          dirsCreated.add(migration.createDir);
          if (options.verbose) {
            console.log(`  Created directory: ${migration.createDir}`);
          }
        }
      }

      // Skip if target already exists
      if (fs.existsSync(migration.to)) {
        if (options.verbose) {
          console.log(`  Skipped (target exists): ${migration.to}`);
        }
        // Remove source if different from target
        if (migration.from !== migration.to) {
          fs.unlinkSync(migration.from);
        }
        continue;
      }

      // Rename file
      fs.renameSync(migration.from, migration.to);
      applied.push(migration);

      if (options.verbose) {
        console.log(`  Renamed: ${path.basename(migration.from)} -> ${path.basename(migration.to)}`);
      }
    } catch (error) {
      failed.push({ migration, error: error.message });
    }
  }

  return { applied, failed };
}

/**
 * Main execution
 */
function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  console.log('Icon Filename Migration Script');
  console.log('==============================');
  console.log(options.apply ? 'Mode: APPLY' : 'Mode: DRY RUN (use --apply to execute)');
  console.log('');

  const allMigrations = [];

  // Process PNG size variants
  console.log('Scanning PNG size variants...');
  for (const size of SIZES) {
    const sizeDir = path.join(PNG_DIR, String(size));

    // Check for malformed files at size root
    const malformed = processMalformedFiles(sizeDir, options);
    allMigrations.push(...malformed);

    // Check each category subdirectory
    for (const category of ICON_CATEGORIES) {
      const categoryDir = path.join(sizeDir, category);
      const migrations = processDirectory(categoryDir, category, options);
      allMigrations.push(...migrations);
    }
  }

  // Process originals
  console.log('Scanning originals...');
  for (const category of ICON_CATEGORIES) {
    const categoryDir = path.join(ORIGINALS_DIR, category);
    const migrations = processDirectory(categoryDir, category, options);
    allMigrations.push(...migrations);
  }

  console.log(`\nFound ${allMigrations.length} files to migrate`);

  if (allMigrations.length === 0) {
    console.log('No migrations needed.');
    process.exit(0);
  }

  // Display migrations
  if (options.verbose || !options.apply) {
    console.log('\nMigrations:');
    for (const m of allMigrations) {
      const fromRel = path.relative(ICONS_BASE, m.from);
      const toRel = path.relative(ICONS_BASE, m.to);
      console.log(`  ${fromRel}`);
      console.log(`    -> ${toRel}`);
    }
  }

  if (!options.apply) {
    console.log(`\nDry run complete. Use --apply to execute ${allMigrations.length} migrations.`);
    process.exit(0);
  }

  // Apply migrations
  console.log('\nApplying migrations...');
  const { applied, failed } = applyMigrations(allMigrations, options);

  console.log('\n========================================');
  console.log('Migration Summary');
  console.log('========================================');
  console.log(`  Applied: ${applied.length}`);
  console.log(`  Failed:  ${failed.length}`);

  if (failed.length > 0) {
    console.log('\nFailed migrations:');
    for (const { migration, error } of failed) {
      console.log(`  ${migration.from}: ${error}`);
    }
    process.exit(1);
  }

  console.log('\nMigration complete!');
  process.exit(0);
}

main();
