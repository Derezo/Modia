#!/usr/bin/env node

/**
 * @module convert-to-webp
 * @description Converts all PNG assets to WebP format for improved compression.
 *
 * Quality settings by directory type:
 * - 85% for sprites/tiles (directories: sprites, characters, obstacles, overlays)
 * - 90% for portraits and UI (directories: portraits, nodes, items, icons)
 *
 * Features:
 * - Recursive directory traversal
 * - Skips already-converted files (checks for existing .webp)
 * - Deletes original PNG after successful conversion
 * - Supports --dry-run flag for preview mode
 *
 * Usage:
 *   npm run assets:convert-webp           # Convert all PNGs to WebP
 *   npm run assets:convert-webp:dry-run   # Preview without making changes
 */

import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ASSETS_ROOT = path.join(__dirname, '..', 'frontend', 'public', 'assets');

// Directories that get lower quality (85%) - sprites and visual effects
const SPRITE_DIRS = ['sprites', 'characters', 'obstacles', 'overlays'];

// Directories that get higher quality (90%) - portraits and UI elements
const UI_DIRS = ['portraits', 'nodes', 'items', 'icons'];

// Quality settings
const SPRITE_QUALITY = 85;
const UI_QUALITY = 90;

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');

/**
 * Determines the WebP quality based on the file path
 * @param {string} filePath - Full path to the file
 * @returns {number} Quality percentage (85 or 90)
 */
function getQualityForPath(filePath) {
  const relativePath = path.relative(ASSETS_ROOT, filePath);
  const topDir = relativePath.split(path.sep)[0];

  if (SPRITE_DIRS.includes(topDir)) {
    return SPRITE_QUALITY;
  }
  return UI_QUALITY;
}

/**
 * Recursively finds all PNG files in a directory
 * @param {string} dir - Directory to search
 * @returns {Promise<string[]>} Array of PNG file paths
 */
async function findPngFiles(dir) {
  const files = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip audio directory (not image assets)
        if (entry.name === 'audio') continue;

        const subFiles = await findPngFiles(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error.message);
  }

  return files;
}

/**
 * Checks if a WebP version of the file already exists
 * @param {string} pngPath - Path to the PNG file
 * @returns {Promise<boolean>} True if WebP already exists
 */
async function webpExists(pngPath) {
  const webpPath = pngPath.replace(/\.png$/i, '.webp');
  try {
    await fs.access(webpPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Converts a single PNG file to WebP
 * @param {string} pngPath - Path to the PNG file
 * @param {boolean} dryRun - If true, don't actually convert
 * @returns {Promise<{converted: boolean, skipped: boolean, error: string|null}>}
 */
async function convertFile(pngPath, dryRun) {
  const webpPath = pngPath.replace(/\.png$/i, '.webp');
  const quality = getQualityForPath(pngPath);

  // Check if already converted
  if (await webpExists(pngPath)) {
    return { converted: false, skipped: true, error: null };
  }

  if (dryRun) {
    return { converted: true, skipped: false, error: null };
  }

  try {
    // Convert PNG to WebP
    await sharp(pngPath)
      .webp({ quality })
      .toFile(webpPath);

    // Delete original PNG after successful conversion
    await fs.unlink(pngPath);

    return { converted: true, skipped: false, error: null };
  } catch (error) {
    return { converted: false, skipped: false, error: error.message };
  }
}

/**
 * Main conversion function
 */
async function main() {
  console.log('WebP Conversion Script');
  console.log('======================');
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes will be made)' : 'LIVE'}`);
  console.log(`Assets root: ${ASSETS_ROOT}`);
  console.log(`Sprite quality (${SPRITE_DIRS.join(', ')}): ${SPRITE_QUALITY}%`);
  console.log(`UI quality (${UI_DIRS.join(', ')}): ${UI_QUALITY}%`);
  console.log('');

  // Verify assets directory exists
  try {
    await fs.access(ASSETS_ROOT);
  } catch {
    console.error(`Error: Assets directory not found at ${ASSETS_ROOT}`);
    process.exit(1);
  }

  // Find all PNG files
  console.log('Scanning for PNG files...');
  const pngFiles = await findPngFiles(ASSETS_ROOT);
  console.log(`Found ${pngFiles.length} PNG files`);
  console.log('');

  if (pngFiles.length === 0) {
    console.log('No PNG files to convert.');
    return;
  }

  // Track statistics
  let converted = 0;
  let skipped = 0;
  let errors = 0;

  // Convert files
  console.log('Converting files...');
  for (const pngPath of pngFiles) {
    const relativePath = path.relative(ASSETS_ROOT, pngPath);
    const quality = getQualityForPath(pngPath);

    const result = await convertFile(pngPath, isDryRun);

    if (result.error) {
      console.error(`  ERROR: ${relativePath} - ${result.error}`);
      errors++;
    } else if (result.skipped) {
      // Don't log skipped files to reduce noise
      skipped++;
    } else if (result.converted) {
      const action = isDryRun ? 'Would convert' : 'Converted';
      console.log(`  ${action}: ${relativePath} (quality: ${quality}%)`);
      converted++;
    }
  }

  // Print summary
  console.log('');
  console.log('Summary');
  console.log('-------');
  console.log(`Total PNG files found: ${pngFiles.length}`);
  console.log(`${isDryRun ? 'Would convert' : 'Converted'}: ${converted}`);
  console.log(`Skipped (WebP exists): ${skipped}`);
  console.log(`Errors: ${errors}`);

  if (isDryRun && converted > 0) {
    console.log('');
    console.log('Run without --dry-run to perform actual conversion.');
  }

  // Exit with error code if there were errors
  if (errors > 0) {
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
