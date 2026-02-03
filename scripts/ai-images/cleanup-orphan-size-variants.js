#!/usr/bin/env node

/**
 * Cleanup Orphan Size Variant PNGs Script
 *
 * Removes .png files from size variant directories (32/, 48/, 64/, 128/, 256/)
 * where the corresponding .webp file exists. These PNG files are legacy artifacts
 * from before WebP conversion was implemented.
 *
 * Size variant directories should only contain .webp files.
 * Original source images (.png) are stored in originals/ directories.
 *
 * Usage:
 *   node scripts/ai-images/cleanup-orphan-size-variants.js --dry-run   # Preview what would be deleted
 *   node scripts/ai-images/cleanup-orphan-size-variants.js             # Actually delete files
 *   node scripts/ai-images/cleanup-orphan-size-variants.js --all       # Delete all PNGs in size dirs (no .webp check)
 */

const fs = require('fs');
const path = require('path');

const ASSETS_ROOT = path.join(__dirname, '../../frontend/public/assets');

// Asset categories and their size variant directories
const ASSET_CONFIGS = [
  { category: 'portraits', sizes: [32, 48, 64, 128, 256] },
  { category: 'nodes', sizes: [48, 64, 96, 128, 256] },
  { category: 'items', sizes: [32, 64, 128], hasSubcategories: true },
  { category: 'icons', basePath: 'icons/png', sizes: [16, 24, 32, 48, 64, 128, 256], hasSubcategories: true },
  { category: 'overlays', sizes: [32, 48, 64, 128], hasSubcategories: true }
];

function findPngFiles(dir, files = []) {
  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip 'originals' directories
      if (entry.name === 'originals') continue;
      findPngFiles(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith('.png')) {
      files.push(fullPath);
    }
  }

  return files;
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const deleteAll = args.includes('--all');

  console.log('='.repeat(60));
  console.log('Cleanup Orphan Size Variant PNGs');
  console.log('='.repeat(60));
  console.log(`Mode: ${dryRun ? 'DRY RUN (no files will be deleted)' : deleteAll ? 'ALL (delete all PNGs in size dirs)' : 'NORMAL (delete PNGs where .webp exists)'}`);
  console.log(`Assets root: ${ASSETS_ROOT}`);
  console.log('');

  let totalFound = 0;
  let totalDeleted = 0;
  let totalSkipped = 0;
  let totalBytes = 0;

  for (const config of ASSET_CONFIGS) {
    const basePath = config.basePath || config.category;

    for (const size of config.sizes) {
      const sizeDir = path.join(ASSETS_ROOT, basePath, String(size));
      const pngFiles = findPngFiles(sizeDir);

      if (pngFiles.length === 0) {
        continue;
      }

      console.log(`\n📁 ${basePath}/${size}/:`);

      for (const pngFile of pngFiles) {
        totalFound++;
        const webpFile = pngFile.replace(/\.png$/, '.webp');
        const webpExists = fs.existsSync(webpFile);
        const relativePath = path.relative(ASSETS_ROOT, pngFile);
        const stats = fs.statSync(pngFile);
        const sizeKB = (stats.size / 1024).toFixed(1);

        if (deleteAll || webpExists) {
          totalBytes += stats.size;
          if (dryRun) {
            console.log(`  🗑️  Would delete: ${relativePath} (${sizeKB} KB)${webpExists ? ' [.webp exists]' : ' [--all]'}`);
          } else {
            fs.unlinkSync(pngFile);
            console.log(`  ✅ Deleted: ${relativePath} (${sizeKB} KB)`);
          }
          totalDeleted++;
        } else {
          console.log(`  ⏭️  Skipped: ${relativePath} (no matching .webp)`);
          totalSkipped++;
        }
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Summary:');
  console.log(`  Total .png files found in size dirs: ${totalFound}`);
  console.log(`  ${dryRun ? 'Would delete' : 'Deleted'}: ${totalDeleted} files (${(totalBytes / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`  Skipped: ${totalSkipped} files`);
  console.log('='.repeat(60));

  if (dryRun && totalDeleted > 0) {
    console.log('\n💡 Run without --dry-run to actually delete files.');
  }
}

main();
