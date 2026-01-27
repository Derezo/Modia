#!/usr/bin/env node
/**
 * AI Portrait Reprocessing Script
 * Detects and reprocesses portrait images with white/opaque backgrounds
 * by re-running rembg with the isnet-general-use model and regenerating size variants.
 *
 * Usage:
 *   npm run ai:reprocess:portraits                              # Reprocess all with white backgrounds
 *   npm run ai:reprocess:portraits -- --all                     # Force reprocess ALL portraits
 *   npm run ai:reprocess:portraits -- --key elf_female_warrior  # Specific portrait
 *   npm run ai:reprocess:portraits -- --dry-run                 # Preview only
 *   npm run ai:reprocess:portraits -- --model birefnet-general  # Override model
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const readline = require('readline');
const {
  log,
  getProjectRoot,
  removeBackground,
  checkImageMagick,
  generateCanonicalSizeVariants,
  parseBaseArgs
} = require('./lib');

const PROJECT_ROOT = getProjectRoot();
const ORIGINALS_DIR = path.join(PROJECT_ROOT, 'frontend/public/assets/portraits/originals');

/** Known rembg model names for validation */
const KNOWN_REMBG_MODELS = [
  'u2net', 'u2netp', 'u2net_human_seg', 'u2net_cloth_seg',
  'isnet-general-use', 'isnet-anime',
  'birefnet-general', 'birefnet-general-lite', 'birefnet-portrait'
];

/**
 * Parse command line arguments using shared parseBaseArgs
 */
function parseArgs() {
  return parseBaseArgs(process.argv.slice(2), {
    extraFlags: {
      all:   { flag: '--all',   type: 'boolean', default: false },
      model: { flag: '--model', type: 'string',  default: 'isnet-general-use' },
      yes:   { flag: '--yes',   aliases: ['-y'], type: 'boolean', default: false }
    },
    noQueue: true
  });
}

/**
 * Display help message
 */
function showHelp() {
  console.log(`
AI Portrait Reprocessing Script
Re-runs background removal on portrait originals that have opaque (white) backgrounds,
then regenerates all size variants.

Usage:
  node scripts/ai-images/reprocess-portraits.js [options]

Options:
  --dry-run              Preview affected files without making changes
  --all                  Reprocess ALL portraits (not just those with white backgrounds)
  --key <name>           Reprocess specific portrait(s) by key (can be repeated)
  --model <name>         rembg model to use (default: isnet-general-use)
  --yes, -y              Skip confirmation prompt
  --verbose, -v          Show detailed output
  --help, -h             Show this help message

Known rembg models:
  ${KNOWN_REMBG_MODELS.join(', ')}

Examples:
  npm run ai:reprocess:portraits -- --dry-run
  npm run ai:reprocess:portraits -- --key elf_female_warrior
  npm run ai:reprocess:portraits -- --key elf_female_warrior --key human_male_wizard
  npm run ai:reprocess:portraits -- --all --yes
  npm run ai:reprocess:portraits -- --model birefnet-general
`);
}

/**
 * Check if an image is fully opaque (no transparency = likely has white background)
 * @param {string} imagePath - Path to the image
 * @returns {boolean} True if the image is fully opaque
 */
function isFullyOpaque(imagePath) {
  try {
    const result = execSync(
      `identify -format '%[opaque]' "${imagePath}"`,
      { encoding: 'utf-8', timeout: 10000 }
    ).trim();
    return result === 'True' || result === 'true';
  } catch {
    return false;
  }
}

/**
 * Prompt user for confirmation
 * @param {string} message - Confirmation message
 * @returns {Promise<boolean>} True if confirmed
 */
function confirm(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Get all portrait original files
 * @returns {string[]} Array of filenames (without path)
 */
function getPortraitFiles() {
  if (!fs.existsSync(ORIGINALS_DIR)) {
    log(`Originals directory not found: ${ORIGINALS_DIR}`, 'error');
    return [];
  }

  return fs.readdirSync(ORIGINALS_DIR)
    .filter(f => f.endsWith('.png'))
    .sort();
}

/**
 * Main execution
 */
async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  // Check prerequisites
  if (!checkImageMagick()) {
    log('ImageMagick is required but not found. Install with: sudo apt install imagemagick', 'error');
    process.exit(1);
  }

  // Validate model name
  if (!KNOWN_REMBG_MODELS.includes(options.model)) {
    log(`Warning: model '${options.model}' is not in the known models list.`, 'warn');
    log(`Known models: ${KNOWN_REMBG_MODELS.join(', ')}`, 'warn');
    log('Proceeding anyway — rembg will fail if the model is invalid.', 'warn');
    console.log('');
  }

  // Get all portrait files
  const allFiles = getPortraitFiles();
  if (allFiles.length === 0) {
    log('No portrait originals found.', 'error');
    process.exit(1);
  }

  log(`Found ${allFiles.length} portrait originals in ${ORIGINALS_DIR}`, 'info');

  // Filter by key if specified
  let candidates;
  if (options.keys.length > 0) {
    candidates = allFiles.filter(f => {
      const key = path.basename(f, '.png');
      return options.keys.includes(key);
    });

    const notFound = options.keys.filter(k => !candidates.some(f => path.basename(f, '.png') === k));
    if (notFound.length > 0) {
      log(`Keys not found: ${notFound.join(', ')}`, 'warn');
    }
  } else {
    candidates = allFiles;
  }

  // Detect affected files
  let affected;
  if (options.all || options.keys.length > 0) {
    affected = candidates;
    if (options.all) {
      log(`--all flag: will reprocess all ${affected.length} portraits`, 'info');
    }
  } else {
    log('Scanning for portraits with opaque backgrounds...', 'info');
    affected = [];
    for (const file of candidates) {
      const filePath = path.join(ORIGINALS_DIR, file);
      if (isFullyOpaque(filePath)) {
        affected.push(file);
        if (options.verbose) {
          log(`  Opaque (needs reprocessing): ${file}`, 'warn');
        }
      } else if (options.verbose) {
        log(`  Has transparency (OK): ${file}`, 'info');
      }
    }
  }

  if (affected.length === 0) {
    log('No portraits need reprocessing.', 'success');
    process.exit(0);
  }

  // Display summary
  console.log('');
  console.log('Portraits to Reprocess');
  console.log('======================');
  for (const file of affected) {
    console.log(`  - ${path.basename(file, '.png')}`);
  }
  console.log('');
  console.log(`Total: ${affected.length} portrait(s)`);
  console.log(`Model: ${options.model}`);
  console.log('');

  if (options.dryRun) {
    log('[DRY RUN] No changes made.', 'info');
    process.exit(0);
  }

  // Confirmation
  if (!options.yes) {
    const confirmed = await confirm('Proceed with reprocessing?');
    if (!confirmed) {
      log('Cancelled by user.', 'info');
      process.exit(0);
    }
    console.log('');
  }

  // Process each affected portrait
  const results = { success: 0, failed: 0 };

  for (let i = 0; i < affected.length; i++) {
    const file = affected[i];
    const key = path.basename(file, '.png');
    const originalPath = path.join(ORIGINALS_DIR, file);
    const backupPath = originalPath + '.bak';

    log(`[${i + 1}/${affected.length}] Reprocessing: ${key}`, 'info');

    try {
      // Create backup before overwriting original
      fs.copyFileSync(originalPath, backupPath);

      // Step 1: Re-run background removal on the original (overwrites in-place)
      const bgResult = await removeBackground(originalPath, originalPath, {
        verbose: options.verbose,
        quiet: !options.verbose,
        model: options.model
      });

      if (!bgResult.success) {
        log(`  Background removal failed: ${bgResult.stderr || 'unknown error'}`, 'error');
        // Restore from backup
        fs.copyFileSync(backupPath, originalPath);
        fs.unlinkSync(backupPath);
        log('  Original restored from backup.', 'info');
        results.failed++;
        continue;
      }

      // Remove backup on success
      fs.unlinkSync(backupPath);

      if (options.verbose) {
        log('  Background removed successfully', 'success');
      }

      // Step 2: Regenerate size variants
      const sizeResult = await generateCanonicalSizeVariants(
        originalPath,
        'portraits',
        key,
        {
          sizes: [64, 128, 256],
          force: true,
          verbose: options.verbose
        }
      );

      if (sizeResult.success) {
        log(`  Size variants regenerated (${sizeResult.generated.length} generated, ${sizeResult.skipped.length} skipped)`, 'success');
        results.success++;
      } else {
        log(`  Size variant generation had errors: ${sizeResult.errors.map(e => e.error).join(', ')}`, 'warn');
        results.success++; // Background removal succeeded, count as partial success
      }
    } catch (error) {
      log(`  Error: ${error.message}`, 'error');
      // Attempt to restore from backup if it exists
      if (fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, originalPath);
        fs.unlinkSync(backupPath);
        log('  Original restored from backup.', 'info');
      }
      results.failed++;
    }
  }

  // Summary
  console.log('');
  console.log('Reprocessing Summary');
  console.log('====================');
  console.log(`  Successful: ${results.success}`);
  console.log(`  Failed:     ${results.failed}`);
  console.log(`  Total:      ${affected.length}`);
  console.log('');

  if (results.failed > 0) {
    log(`${results.failed} portrait(s) failed to reprocess.`, 'warn');
    process.exit(1);
  } else {
    log('All portraits reprocessed successfully!', 'success');
  }
}

main().catch(error => {
  log(`Unexpected error: ${error.message}`, 'error');
  console.error(error);
  process.exit(1);
});
