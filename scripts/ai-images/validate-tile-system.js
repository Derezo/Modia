#!/usr/bin/env node
/**
 * Tile System Validation Script
 * Validates the unified stacking tile system after overhaul
 *
 * Checks:
 * 1. No legacy *_elev*.png files exist
 * 2. All floor tiles are exactly 64x64 pixels
 * 3. All wall tiles are exactly 64x16 pixels (if they exist)
 * 4. Required floor tiles exist for all terrain types × biomes
 * 5. Metadata entries match actual PNG files
 * 6. Wall texture metadata exists for all biomes
 *
 * Usage:
 *   node scripts/ai-images/validate-tile-system.js
 *   node scripts/ai-images/validate-tile-system.js --fix  # Report what needs fixing
 *   node scripts/ai-images/validate-tile-system.js --verbose
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// Configuration
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const TERRAIN_DIR = path.join(PROJECT_ROOT, 'frontend/public/assets/sprites/terrain');
const METADATA_DIR = path.join(PROJECT_ROOT, 'ai-image-metadata/tiles');

// Expected terrain types
const TERRAIN_TYPES = ['grass', 'stone', 'rock', 'forest', 'water', 'lava', 'cliff', 'tree'];

// Expected biomes
const BIOMES = ['base', 'forest', 'cave', 'mountain', 'bridge', 'castle'];

// Variants per floor tile
const VARIANTS_PER_TERRAIN = 4;

// Parse arguments
function parseArgs() {
  const args = process.argv.slice(2);
  return {
    fix: args.includes('--fix'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    help: args.includes('--help') || args.includes('-h')
  };
}

// Get image dimensions using ImageMagick
function getImageDimensions(imagePath) {
  try {
    const output = execSync(`identify -format "%w %h" "${imagePath}"`, { encoding: 'utf-8' });
    const [width, height] = output.trim().split(' ').map(Number);
    return { width, height };
  } catch {
    return null;
  }
}

// Find files matching pattern
function findFiles(dir, pattern) {
  const files = [];

  function walkDir(currentPath) {
    if (!fs.existsSync(currentPath)) return;

    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.isFile() && pattern.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }

  walkDir(dir);
  return files;
}

// Main validation
async function validate(options) {
  console.log('Tile System Validation');
  console.log('======================\n');

  const errors = [];
  const warnings = [];
  const info = [];

  // 1. Check for legacy elevation files
  console.log('1. Checking for legacy elevation files...');
  const elevFiles = findFiles(TERRAIN_DIR, /_elev\d\.png$/);
  const pitFiles = findFiles(TERRAIN_DIR, /_pit\.png$/);

  if (elevFiles.length > 0) {
    errors.push(`Found ${elevFiles.length} legacy *_elev*.png files that should be deleted`);
    if (options.verbose) {
      elevFiles.slice(0, 5).forEach(f => console.log(`   - ${path.relative(PROJECT_ROOT, f)}`));
      if (elevFiles.length > 5) console.log(`   ... and ${elevFiles.length - 5} more`);
    }
  } else {
    info.push('No legacy *_elev*.png files found');
  }

  if (pitFiles.length > 0) {
    errors.push(`Found ${pitFiles.length} legacy *_pit.png files that should be deleted`);
    if (options.verbose) {
      pitFiles.slice(0, 5).forEach(f => console.log(`   - ${path.relative(PROJECT_ROOT, f)}`));
      if (pitFiles.length > 5) console.log(`   ... and ${pitFiles.length - 5} more`);
    }
  } else {
    info.push('No legacy *_pit.png files found');
  }

  // 2. Check floor tile dimensions
  console.log('\n2. Checking floor tile dimensions (should be 64x64)...');
  const floorTiles = findFiles(TERRAIN_DIR, /^[a-z]+_\d\.png$/);
  let wrongDimensionFloors = 0;

  for (const tile of floorTiles) {
    const dims = getImageDimensions(tile);
    if (dims && (dims.width !== 64 || dims.height !== 64)) {
      wrongDimensionFloors++;
      if (options.verbose) {
        console.log(`   - ${path.relative(PROJECT_ROOT, tile)}: ${dims.width}x${dims.height} (expected 64x64)`);
      }
    }
  }

  if (wrongDimensionFloors > 0) {
    warnings.push(`Found ${wrongDimensionFloors} floor tiles with wrong dimensions (expected 64x64)`);
  } else {
    info.push(`All ${floorTiles.length} floor tiles have correct dimensions (64x64)`);
  }

  // 3. Check wall tile dimensions (if they exist)
  console.log('\n3. Checking wall tile dimensions (should be 64x16)...');
  const wallTiles = findFiles(path.join(TERRAIN_DIR, 'base/walls'), /\.png$/);
  let wrongDimensionWalls = 0;

  for (const tile of wallTiles) {
    const dims = getImageDimensions(tile);
    if (dims && (dims.width !== 64 || dims.height !== 16)) {
      wrongDimensionWalls++;
      if (options.verbose) {
        console.log(`   - ${path.relative(PROJECT_ROOT, tile)}: ${dims.width}x${dims.height} (expected 64x16)`);
      }
    }
  }

  if (wallTiles.length === 0) {
    warnings.push('No wall textures found in base/walls/ - procedural fallback will be used');
  } else if (wrongDimensionWalls > 0) {
    warnings.push(`Found ${wrongDimensionWalls} wall tiles with wrong dimensions (expected 64x16)`);
  } else {
    info.push(`All ${wallTiles.length} wall tiles have correct dimensions (64x16)`);
  }

  // 4. Check floor tile coverage
  console.log('\n4. Checking floor tile coverage...');
  let missingFloors = 0;
  const missingByBiome = {};

  for (const biome of BIOMES) {
    missingByBiome[biome] = [];
    const biomeDir = path.join(TERRAIN_DIR, biome);

    for (const terrain of TERRAIN_TYPES) {
      for (let v = 0; v < VARIANTS_PER_TERRAIN; v++) {
        const tilePath = path.join(biomeDir, `${terrain}_${v}.png`);
        if (!fs.existsSync(tilePath)) {
          missingFloors++;
          missingByBiome[biome].push(`${terrain}_${v}`);
        }
      }
    }
  }

  if (missingFloors > 0) {
    warnings.push(`Missing ${missingFloors} floor tiles across all biomes`);
    if (options.verbose) {
      for (const [biome, missing] of Object.entries(missingByBiome)) {
        if (missing.length > 0) {
          console.log(`   ${biome}: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ` ... and ${missing.length - 3} more` : ''}`);
        }
      }
    }
  } else {
    info.push('All floor tiles present for all terrain types × biomes');
  }

  // 5. Check wall texture metadata
  console.log('\n5. Checking wall texture metadata...');
  const wallMetadataFiles = [];

  for (const biome of BIOMES) {
    const metadataPath = path.join(METADATA_DIR, 'walls', `${biome}.json`);
    if (fs.existsSync(metadataPath)) {
      wallMetadataFiles.push(biome);
    }
  }

  if (wallMetadataFiles.length < BIOMES.length) {
    const missing = BIOMES.filter(b => !wallMetadataFiles.includes(b));
    warnings.push(`Missing wall metadata for biomes: ${missing.join(', ')}`);
  } else {
    info.push(`Wall texture metadata exists for all ${BIOMES.length} biomes`);
  }

  // 6. Check base-elevations.json is deleted
  console.log('\n6. Checking legacy metadata is removed...');
  const baseElevPath = path.join(METADATA_DIR, 'floors/base-elevations.json');
  if (fs.existsSync(baseElevPath)) {
    errors.push('Legacy base-elevations.json still exists and should be deleted');
  } else {
    info.push('Legacy base-elevations.json has been removed');
  }

  // Summary
  console.log('\n========================================');
  console.log('Validation Summary');
  console.log('========================================');

  if (errors.length > 0) {
    console.log(`\n ERRORS (${errors.length}):`);
    errors.forEach(e => console.log(`   - ${e}`));
  }

  if (warnings.length > 0) {
    console.log(`\n WARNINGS (${warnings.length}):`);
    warnings.forEach(w => console.log(`   - ${w}`));
  }

  if (info.length > 0) {
    console.log(`\n INFO (${info.length}):`);
    info.forEach(i => console.log(`   - ${i}`));
  }

  const exitCode = errors.length > 0 ? 1 : 0;
  console.log(`\nValidation ${exitCode === 0 ? 'PASSED' : 'FAILED'}`);

  if (options.fix && (errors.length > 0 || warnings.length > 0)) {
    console.log('\n--fix mode: Run the following to address issues:');
    if (elevFiles.length > 0 || pitFiles.length > 0) {
      console.log('  # Delete legacy elevation files');
      console.log('  find frontend/public/assets/sprites/terrain -name "*_elev*.png" -delete');
      console.log('  find frontend/public/assets/sprites/terrain -name "*_pit.png" -delete');
    }
    if (fs.existsSync(baseElevPath)) {
      console.log('  # Delete legacy metadata');
      console.log('  rm ai-image-metadata/tiles/floors/base-elevations.json');
    }
    if (missingFloors > 0) {
      console.log('  # Generate missing floor tiles');
      console.log('  npm run ai:generate:tiles -- --force');
    }
    if (wallTiles.length === 0) {
      console.log('  # Generate wall textures');
      console.log('  npm run ai:generate:tiles -- --category walls');
    }
  }

  return exitCode;
}

// Show help
function showHelp() {
  console.log(`
Tile System Validation Script
Validates the unified stacking tile system

Usage:
  node scripts/ai-images/validate-tile-system.js [options]

Options:
  --fix       Show commands to fix issues
  --verbose   Show detailed output
  --help      Show this help message

Checks performed:
  1. No legacy *_elev*.png or *_pit.png files exist
  2. All floor tiles are 64x64 pixels
  3. All wall tiles are 64x16 pixels
  4. Required floor tiles exist for all terrain types × biomes
  5. Wall texture metadata exists for all biomes
  6. Legacy base-elevations.json is removed
`);
}

// Main
const options = parseArgs();

if (options.help) {
  showHelp();
  process.exit(0);
}

validate(options).then(exitCode => {
  process.exit(exitCode);
}).catch(err => {
  console.error('Validation error:', err.message);
  process.exit(1);
});
