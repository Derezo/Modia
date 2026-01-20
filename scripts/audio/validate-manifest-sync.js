#!/usr/bin/env node
/**
 * Manifest Sync Validation Script
 * Compares frontend AUDIO_MANIFEST with metadata JSON files
 * Ensures both are in sync and reports discrepancies
 *
 * Usage:
 *   node scripts/audio/validate-manifest-sync.js           # Validate sync
 *   node scripts/audio/validate-manifest-sync.js --verbose # Show details
 *   node scripts/audio/validate-manifest-sync.js --fix     # Report fixable issues
 */

const fs = require('fs');
const path = require('path');
const { log, loadMetadata } = require('./lib');

// Configuration
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const AUDIO_ASSETS_PATH = path.join(PROJECT_ROOT, 'frontend/src/audio/AudioAssets.js');
const MUSIC_METADATA_DIR = path.join(PROJECT_ROOT, 'audio-metadata/music');
const SFX_METADATA_DIR = path.join(PROJECT_ROOT, 'audio-metadata/sfx');

/**
 * Parse command line arguments
 * @returns {Object} Parsed arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    verbose: false,
    fix: false,
    help: false
  };

  for (const arg of args) {
    switch (arg) {
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--fix':
        options.fix = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
    }
  }

  return options;
}

/**
 * Display help message
 */
function showHelp() {
  console.log(`
Manifest Sync Validation Script
Compares frontend AUDIO_MANIFEST with metadata JSON files

Usage:
  node scripts/audio/validate-manifest-sync.js [options]

Options:
  --verbose, -v   Show detailed output including matched keys
  --fix           Show suggestions for fixing discrepancies
  --help, -h      Show this help message

This script validates that:
  1. All keys in frontend AUDIO_MANIFEST exist in metadata
  2. All keys in metadata exist in frontend AUDIO_MANIFEST
  3. Paths match between frontend and metadata
`);
}

/**
 * Parse AUDIO_MANIFEST by dynamically importing the manifest modules
 * This approach works with the modularized manifest structure
 * @returns {Promise<Object>} Extracted manifest with music and sfx keys
 */
async function parseFrontendManifest() {
  const result = {
    music: new Map(),
    sfx: new Map()
  };

  // Manifest files to import with their prefix mapping for metadata comparison
  const manifests = [
    { file: 'musicManifest.js', export: 'MUSIC_MANIFEST', target: 'music', prefix: null },
    { file: 'sfxManifest.js', export: 'SFX_MANIFEST', target: 'sfx', prefix: null },
    { file: 'uiManifest.js', export: 'UI_MANIFEST', target: 'sfx', prefix: 'ui_' },
    { file: 'ambientManifest.js', export: 'AMBIENT_MANIFEST', target: 'sfx', prefix: 'ambient_' },
    { file: 'interactionManifest.js', export: 'INTERACTION_MANIFEST', target: 'sfx', prefix: 'interaction_' }
  ];

  const manifestDir = path.join(PROJECT_ROOT, 'frontend/src/audio/manifests');

  for (const { file, export: exportName, target, prefix } of manifests) {
    const filePath = path.join(manifestDir, file);

    // Check file exists
    if (!fs.existsSync(filePath)) {
      console.warn(`  Warning: Manifest file not found: ${file}`);
      continue;
    }

    try {
      // Dynamic import for ESM modules
      const fileUrl = `file://${filePath}`;
      const module = await import(fileUrl);
      const manifest = module[exportName];

      if (!manifest || typeof manifest !== 'object') {
        console.warn(`  Warning: Could not find ${exportName} in ${file}`);
        continue;
      }

      // Extract entries from manifest
      const targetMap = target === 'music' ? result.music : result.sfx;
      for (const [key, entry] of Object.entries(manifest)) {
        if (entry && entry.path) {
          const mappedKey = prefix ? `${prefix}${key}` : key;
          targetMap.set(mappedKey, entry.path);
        }
      }
    } catch (error) {
      console.warn(`  Warning: Failed to import ${file}: ${error.message}`);
    }
  }

  return result;
}

/**
 * Load all track IDs from metadata files
 * @returns {Object} Metadata with music and sfx maps
 */
function loadMetadataManifests() {
  const result = {
    music: new Map(),
    sfx: new Map()
  };

  // Load music metadata
  const musicManifest = loadMetadata(path.join(MUSIC_METADATA_DIR, 'manifest.json'));
  if (musicManifest) {
    for (const categoryInfo of Object.values(musicManifest.categories)) {
      for (const filePath of categoryInfo.files) {
        const data = loadMetadata(path.join(MUSIC_METADATA_DIR, filePath));
        if (data && data.tracks) {
          for (const track of data.tracks) {
            result.music.set(track.id, track.path);
          }
        }
      }
    }
  }

  // Load SFX metadata
  const sfxManifest = loadMetadata(path.join(SFX_METADATA_DIR, 'manifest.json'));
  if (sfxManifest) {
    for (const categoryInfo of Object.values(sfxManifest.categories)) {
      for (const filePath of categoryInfo.files) {
        const data = loadMetadata(path.join(SFX_METADATA_DIR, filePath));
        if (data && data.effects) {
          for (const effect of data.effects) {
            result.sfx.set(effect.id, effect.path);
          }
        }
      }
    }
  }

  return result;
}

/**
 * Compare two maps and find discrepancies
 * @param {Map} frontendMap - Keys from frontend
 * @param {Map} metadataMap - Keys from metadata
 * @param {string} category - Category name for reporting
 * @returns {Object} Comparison results
 */
function compareMaps(frontendMap, metadataMap, category) {
  const results = {
    category,
    frontendOnly: [],    // Keys in frontend but not metadata
    metadataOnly: [],    // Keys in metadata but not frontend
    pathMismatches: [],  // Keys in both but paths differ
    matched: []          // Keys that match perfectly
  };

  // Check frontend keys against metadata
  for (const [key, frontendPath] of frontendMap) {
    if (!metadataMap.has(key)) {
      results.frontendOnly.push({ key, path: frontendPath });
    } else {
      const metadataPath = metadataMap.get(key);
      if (frontendPath !== metadataPath) {
        results.pathMismatches.push({
          key,
          frontendPath,
          metadataPath
        });
      } else {
        results.matched.push(key);
      }
    }
  }

  // Check metadata keys against frontend
  for (const [key, metadataPath] of metadataMap) {
    if (!frontendMap.has(key)) {
      results.metadataOnly.push({ key, path: metadataPath });
    }
  }

  return results;
}

/**
 * Print comparison results
 * @param {Object} results - Comparison results
 * @param {Object} options - CLI options
 */
function printResults(results, options) {
  const { category, frontendOnly, metadataOnly, pathMismatches, matched } = results;
  const hasIssues = frontendOnly.length > 0 || metadataOnly.length > 0 || pathMismatches.length > 0;

  console.log(`\n${category.toUpperCase()} Sync Status:`);
  console.log('─'.repeat(50));

  // Summary
  console.log(`  Total matched: ${matched.length}`);
  if (frontendOnly.length > 0) {
    console.log(`  Frontend only: ${frontendOnly.length}`);
  }
  if (metadataOnly.length > 0) {
    console.log(`  Metadata only: ${metadataOnly.length}`);
  }
  if (pathMismatches.length > 0) {
    console.log(`  Path mismatches: ${pathMismatches.length}`);
  }

  if (!hasIssues) {
    log(`${category} manifests are in sync!`, 'success');
    if (options.verbose) {
      console.log('\n  Matched keys:');
      for (const key of matched.slice(0, 10)) {
        console.log(`    - ${key}`);
      }
      if (matched.length > 10) {
        console.log(`    ... and ${matched.length - 10} more`);
      }
    }
    return;
  }

  // Details
  if (frontendOnly.length > 0) {
    console.log('\n  Keys in frontend but NOT in metadata:');
    for (const { key, path } of frontendOnly) {
      console.log(`    - ${key}`);
      if (options.verbose) {
        console.log(`      Path: ${path}`);
      }
    }
    if (options.fix) {
      console.log('\n  To fix: Add these entries to appropriate metadata JSON files');
    }
  }

  if (metadataOnly.length > 0) {
    console.log('\n  Keys in metadata but NOT in frontend:');
    for (const { key, path } of metadataOnly) {
      console.log(`    - ${key}`);
      if (options.verbose) {
        console.log(`      Path: ${path}`);
      }
    }
    if (options.fix) {
      console.log('\n  To fix: Add these entries to frontend/src/audio/AudioAssets.js AUDIO_MANIFEST');
    }
  }

  if (pathMismatches.length > 0) {
    console.log('\n  Path mismatches:');
    for (const { key, frontendPath, metadataPath } of pathMismatches) {
      console.log(`    - ${key}`);
      console.log(`      Frontend: ${frontendPath}`);
      console.log(`      Metadata: ${metadataPath}`);
    }
    if (options.fix) {
      console.log('\n  To fix: Ensure paths match between frontend and metadata files');
    }
  }
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

  log('Manifest Sync Validation', 'info');
  log('========================', 'info');

  // Parse frontend manifest
  let frontendManifest;
  try {
    log('Parsing frontend AUDIO_MANIFEST...', 'info');
    frontendManifest = await parseFrontendManifest();
    console.log(`  Found ${frontendManifest.music.size} music keys`);
    console.log(`  Found ${frontendManifest.sfx.size} SFX keys`);
  } catch (error) {
    log(`Failed to parse frontend manifest: ${error.message}`, 'error');
    process.exit(1);
  }

  // Load metadata
  let metadataManifest;
  try {
    log('Loading metadata manifests...', 'info');
    metadataManifest = loadMetadataManifests();
    console.log(`  Found ${metadataManifest.music.size} music tracks`);
    console.log(`  Found ${metadataManifest.sfx.size} SFX effects`);
  } catch (error) {
    log(`Failed to load metadata: ${error.message}`, 'error');
    process.exit(1);
  }

  // Compare music
  const musicResults = compareMaps(
    frontendManifest.music,
    metadataManifest.music,
    'music'
  );
  printResults(musicResults, options);

  // Compare SFX
  const sfxResults = compareMaps(
    frontendManifest.sfx,
    metadataManifest.sfx,
    'sfx'
  );
  printResults(sfxResults, options);

  // Final summary
  console.log('\n' + '═'.repeat(50));
  const totalIssues =
    musicResults.frontendOnly.length +
    musicResults.metadataOnly.length +
    musicResults.pathMismatches.length +
    sfxResults.frontendOnly.length +
    sfxResults.metadataOnly.length +
    sfxResults.pathMismatches.length;

  if (totalIssues === 0) {
    log('All manifests are in sync!', 'success');
    process.exit(0);
  } else {
    log(`Found ${totalIssues} sync issue(s)`, 'warn');
    if (!options.fix) {
      console.log('\nRun with --fix to see suggestions for resolving issues');
    }
    process.exit(1);
  }
}

main().catch(error => {
  log(`Unexpected error: ${error.message}`, 'error');
  console.error(error);
  process.exit(1);
});
