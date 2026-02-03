#!/usr/bin/env node

/**
 * Cleanup Orphan Originals Script
 *
 * Removes .webp files from originals/ directories where the corresponding
 * .png file exists. These .webp files are processed leftovers, not true originals.
 *
 * True originals are always .png files (direct AI-generated output).
 * The .webp files in originals/ are artifacts from previous processing.
 *
 * Usage:
 *   node scripts/ai-images/cleanup-orphan-originals.js --dry-run   # Preview what would be deleted
 *   node scripts/ai-images/cleanup-orphan-originals.js             # Actually delete files
 *   node scripts/ai-images/cleanup-orphan-originals.js --force     # Delete all .webp in originals (no .png check)
 */

const fs = require('fs');
const path = require('path');

const ASSETS_ROOT = path.join(__dirname, '../../frontend/public/assets');

// Directories that contain originals subdirectories
const ORIGINALS_DIRS = [
  'portraits/originals',
  'nodes/originals',
  'items/originals',
  'icons/originals',
  'overlays/originals',
  'obstacles/originals',
  'sprites/terrain/originals'
];

function findWebpFiles(dir, files = []) {
  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findWebpFiles(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith('.webp')) {
      files.push(fullPath);
    }
  }

  return files;
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');

  console.log('='.repeat(60));
  console.log('Cleanup Orphan Originals');
  console.log('='.repeat(60));
  console.log(`Mode: ${dryRun ? 'DRY RUN (no files will be deleted)' : force ? 'FORCE (delete all .webp in originals)' : 'NORMAL (delete .webp where .png exists)'}`);
  console.log(`Assets root: ${ASSETS_ROOT}`);
  console.log('');

  let totalFound = 0;
  let totalDeleted = 0;
  let totalSkipped = 0;
  let totalBytes = 0;

  for (const originalsDir of ORIGINALS_DIRS) {
    const fullDir = path.join(ASSETS_ROOT, originalsDir);
    const webpFiles = findWebpFiles(fullDir);

    if (webpFiles.length === 0) {
      continue;
    }

    console.log(`\n📁 ${originalsDir}:`);

    for (const webpFile of webpFiles) {
      totalFound++;
      const pngFile = webpFile.replace(/\.webp$/, '.png');
      const pngExists = fs.existsSync(pngFile);
      const relativePath = path.relative(ASSETS_ROOT, webpFile);
      const stats = fs.statSync(webpFile);
      const sizeKB = (stats.size / 1024).toFixed(1);

      if (force || pngExists) {
        totalBytes += stats.size;
        if (dryRun) {
          console.log(`  🗑️  Would delete: ${relativePath} (${sizeKB} KB)${pngExists ? ' [.png exists]' : ' [force]'}`);
        } else {
          fs.unlinkSync(webpFile);
          console.log(`  ✅ Deleted: ${relativePath} (${sizeKB} KB)`);
        }
        totalDeleted++;
      } else {
        console.log(`  ⏭️  Skipped: ${relativePath} (no matching .png)`);
        totalSkipped++;
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Summary:');
  console.log(`  Total .webp files found: ${totalFound}`);
  console.log(`  ${dryRun ? 'Would delete' : 'Deleted'}: ${totalDeleted} files (${(totalBytes / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`  Skipped: ${totalSkipped} files`);
  console.log('='.repeat(60));

  if (dryRun && totalDeleted > 0) {
    console.log('\n💡 Run without --dry-run to actually delete files.');
  }
}

main();
