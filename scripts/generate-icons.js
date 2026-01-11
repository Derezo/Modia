#!/usr/bin/env node
/**
 * Icon PNG Generation Script
 * Converts SVG icons to PNG at multiple sizes for game UI
 *
 * Usage:
 *   node scripts/generate-icons.js           # Generate all icons
 *   node scripts/generate-icons.js --force   # Regenerate all, ignore timestamps
 *   node scripts/generate-icons.js --clean   # Remove all PNGs first
 *   node scripts/generate-icons.js --help    # Show help
 *
 * Directory structure:
 *   frontend/public/assets/icons/svg/{category}-{name}.svg
 *   frontend/public/assets/icons/png/{size}/{category}-{name}.png
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SVG_DIR = path.join(__dirname, '../frontend/public/assets/icons/svg');
const PNG_DIR = path.join(__dirname, '../frontend/public/assets/icons/png');
const SIZES = [16, 24, 32, 48];

/**
 * Parse command line arguments
 * @returns {Object} Parsed options
 */
function parseArgs() {
  const args = process.argv.slice(2);
  return {
    force: args.includes('--force'),
    clean: args.includes('--clean'),
    help: args.includes('--help') || args.includes('-h'),
    verbose: args.includes('--verbose') || args.includes('-v')
  };
}

/**
 * Show help message
 */
function showHelp() {
  console.log(`
Icon PNG Generation Script
Converts SVG icons to PNG at multiple sizes (${SIZES.join(', ')}px)

Usage:
  node scripts/generate-icons.js [options]

Options:
  --force     Regenerate all icons, ignoring timestamps
  --clean     Remove all existing PNGs before generating
  --verbose   Show detailed progress
  --help, -h  Show this help message

Directory Structure:
  Source:  frontend/public/assets/icons/svg/{category}-{name}.svg
  Output:  frontend/public/assets/icons/png/{size}/{category}-{name}.png

Examples:
  node scripts/generate-icons.js              # Generate new/updated only
  node scripts/generate-icons.js --force      # Regenerate everything
  node scripts/generate-icons.js --clean      # Clean and regenerate
`);
}

/**
 * Ensure output directories exist
 */
function ensureDirectories() {
  // Ensure SVG source directory exists
  if (!fs.existsSync(SVG_DIR)) {
    fs.mkdirSync(SVG_DIR, { recursive: true });
    console.log(`Created SVG directory: ${SVG_DIR}`);
  }

  // Ensure PNG output directories exist for each size
  for (const size of SIZES) {
    const sizeDir = path.join(PNG_DIR, String(size));
    if (!fs.existsSync(sizeDir)) {
      fs.mkdirSync(sizeDir, { recursive: true });
    }
  }
}

/**
 * Clean all PNG directories
 */
function cleanPngDirectories() {
  console.log('Cleaning PNG directories...');
  let totalRemoved = 0;

  for (const size of SIZES) {
    const sizeDir = path.join(PNG_DIR, String(size));
    if (fs.existsSync(sizeDir)) {
      const files = fs.readdirSync(sizeDir).filter(f => f.endsWith('.png'));
      for (const file of files) {
        fs.unlinkSync(path.join(sizeDir, file));
        totalRemoved++;
      }
    }
  }

  console.log(`Removed ${totalRemoved} PNG files`);
}

/**
 * Get modification time of a file
 * @param {string} filePath - Path to file
 * @returns {number|null} Modification time in ms, or null if file doesn't exist
 */
function getModTime(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Check if PNG needs regeneration
 * @param {string} svgPath - Path to source SVG
 * @param {string} pngPath - Path to output PNG
 * @param {boolean} force - Force regeneration
 * @returns {boolean} True if PNG needs to be generated
 */
function needsRegeneration(svgPath, pngPath, force) {
  if (force) return true;

  const svgModTime = getModTime(svgPath);
  const pngModTime = getModTime(pngPath);

  // PNG doesn't exist
  if (pngModTime === null) return true;

  // SVG is newer than PNG
  return svgModTime > pngModTime;
}

/**
 * Convert a single SVG to PNG at specified size
 * @param {string} svgPath - Path to source SVG
 * @param {string} pngPath - Path to output PNG
 * @param {number} size - Target size in pixels
 * @returns {Promise<void>}
 */
async function convertSvgToPng(svgPath, pngPath, size) {
  const svgBuffer = fs.readFileSync(svgPath);

  await sharp(svgBuffer)
    .resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png({
      compressionLevel: 9,
      adaptiveFiltering: true
    })
    .toFile(pngPath);
}

/**
 * Get all SVG files from the source directory (walks subdirectories)
 * @returns {Array<{name: string, path: string, category: string}>} Array of SVG file info
 */
function getSvgFiles() {
  if (!fs.existsSync(SVG_DIR)) {
    return [];
  }

  const svgFiles = [];

  // Get all category subdirectories
  const entries = fs.readdirSync(SVG_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      // Category subdirectory (e.g., menu/, nodes/, actions/)
      const category = entry.name;
      const categoryPath = path.join(SVG_DIR, category);
      const categoryFiles = fs.readdirSync(categoryPath)
        .filter(file => file.endsWith('.svg'));

      for (const file of categoryFiles) {
        const baseName = file.replace('.svg', '');
        svgFiles.push({
          name: `${category}-${baseName}`,  // e.g., "menu-formation"
          path: path.join(categoryPath, file),
          category
        });
      }
    } else if (entry.name.endsWith('.svg')) {
      // Flat SVG file in root (legacy support)
      svgFiles.push({
        name: entry.name.replace('.svg', ''),
        path: path.join(SVG_DIR, entry.name),
        category: 'misc'
      });
    }
  }

  return svgFiles.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Generate PNG icons from SVG sources
 * @param {Object} options - Generation options
 * @returns {Promise<{generated: number, skipped: number, failed: number}>}
 */
async function generateIcons(options = {}) {
  const { force = false, clean = false, verbose = false } = options;

  console.log('=== Icon PNG Generation ===\n');

  // Ensure directories exist
  ensureDirectories();

  // Clean if requested
  if (clean) {
    cleanPngDirectories();
    console.log('');
  }

  // Get SVG files
  const svgFiles = getSvgFiles();

  if (svgFiles.length === 0) {
    console.log('No SVG files found in:', SVG_DIR);
    console.log('Add SVG icons with format: {category}-{name}.svg');
    console.log('Example: menu-formation.svg, action-attack.svg\n');
    return { generated: 0, skipped: 0, failed: 0 };
  }

  console.log(`Found ${svgFiles.length} SVG files`);
  console.log(`Target sizes: ${SIZES.join('px, ')}px`);
  console.log(`Force regenerate: ${force ? 'yes' : 'no'}\n`);

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  // Process each SVG
  for (const svg of svgFiles) {
    const pngName = `${svg.name}.png`;
    let fileGenerated = false;
    let fileFailed = false;

    // Generate each size
    for (const size of SIZES) {
      const pngPath = path.join(PNG_DIR, String(size), pngName);

      // Check if regeneration needed
      if (!needsRegeneration(svg.path, pngPath, force)) {
        if (verbose) {
          console.log(`  [SKIP] ${size}px/${pngName}`);
        }
        skipped++;
        continue;
      }

      try {
        await convertSvgToPng(svg.path, pngPath, size);
        if (verbose) {
          console.log(`  [GEN]  ${size}px/${pngName}`);
        }
        generated++;
        fileGenerated = true;
      } catch (err) {
        console.error(`  [FAIL] ${size}px/${pngName}: ${err.message}`);
        failed++;
        fileFailed = true;
      }
    }

    // Summary line for non-verbose mode
    if (!verbose && (fileGenerated || fileFailed)) {
      const status = fileFailed ? '[PARTIAL]' : '[OK]';
      console.log(`${status} ${svg.name}`);
    }
  }

  // Summary
  console.log('\n=== Generation Complete ===');
  console.log(`Generated: ${generated} PNG files`);
  console.log(`Skipped:   ${skipped} up-to-date files`);
  if (failed > 0) {
    console.log(`Failed:    ${failed} files`);
  }

  return { generated, skipped, failed };
}

// Main entry point
async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  try {
    const result = await generateIcons(options);
    process.exit(result.failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Generation failed:', err.message);
    process.exit(1);
  }
}

main();

module.exports = { generateIcons, SIZES };
