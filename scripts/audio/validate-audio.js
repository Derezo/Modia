#!/usr/bin/env node
/**
 * Audio Asset Validation Script
 * Validates that all audio files referenced in metadata exist
 *
 * Usage:
 *   node scripts/audio/validate-audio.js           # Default summary
 *   node scripts/audio/validate-audio.js --status  # Overall status and counts
 *   node scripts/audio/validate-audio.js --missing # List only missing files
 *   node scripts/audio/validate-audio.js --summary # Quick summary (default)
 *   node scripts/audio/validate-audio.js --verbose # Detailed output
 *   node scripts/audio/validate-audio.js --json    # Output as JSON
 *   node scripts/audio/validate-audio.js --music   # Validate music only
 *   node scripts/audio/validate-audio.js --sfx     # Validate SFX only
 */

const path = require('path');
const { loadMetadata, fileExists, log } = require('./lib/audioUtils');

// Configuration
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const ASSETS_DIR = path.join(PROJECT_ROOT, 'frontend/public');
const METADATA_DIR = path.join(PROJECT_ROOT, 'audio-metadata');

/**
 * Parse command line arguments
 * @returns {Object} Parsed arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    status: false,
    missing: false,
    summary: false,
    verbose: false,
    json: false,
    musicOnly: false,
    sfxOnly: false,
    help: false
  };

  for (const arg of args) {
    switch (arg) {
      case '--status':
        options.status = true;
        break;
      case '--missing':
        options.missing = true;
        break;
      case '--summary':
        options.summary = true;
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--music':
        options.musicOnly = true;
        break;
      case '--sfx':
        options.sfxOnly = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        if (arg.startsWith('--')) {
          console.error(`Unknown option: ${arg}`);
        }
    }
  }

  // Default to summary if no display option selected
  if (!options.status && !options.missing && !options.verbose) {
    options.summary = true;
  }

  return options;
}

/**
 * Display help message
 */
function showHelp() {
  console.log(`
Audio Asset Validation Script
Validates that all audio files referenced in metadata exist

Usage:
  node scripts/audio/validate-audio.js [options]

Options:
  --status      Show overall status and counts
  --missing     List only missing files
  --summary     Quick summary (default)
  --verbose     Detailed output including all tracks
  --json        Output as JSON (for scripting)
  --music       Validate music tracks only
  --sfx         Validate sound effects only
  --help, -h    Show this help message

Examples:
  node scripts/audio/validate-audio.js
  node scripts/audio/validate-audio.js --status
  node scripts/audio/validate-audio.js --missing --music
  node scripts/audio/validate-audio.js --verbose --sfx
  node scripts/audio/validate-audio.js --json > report.json
`);
}

/**
 * Load all music tracks from metadata
 * @returns {Array} Array of track objects with validation info
 */
function loadMusicTracks() {
  const manifestPath = path.join(METADATA_DIR, 'music/manifest.json');
  const manifest = loadMetadata(manifestPath);

  if (!manifest) {
    console.error('Failed to load music manifest');
    return [];
  }

  const tracks = [];

  for (const [category, info] of Object.entries(manifest.categories)) {
    for (const filePath of info.files) {
      const fullPath = path.join(METADATA_DIR, 'music', filePath);
      const data = loadMetadata(fullPath);

      if (!data) {
        console.error(`Warning: Failed to load ${filePath}`);
        continue;
      }

      const trackList = data.tracks || [];
      for (const track of trackList) {
        tracks.push({
          id: track.id,
          name: track.name,
          path: track.path,
          category: category,
          region: track.region || null,
          nodeType: track.nodeType || null,
          generated: track.generated || false,
          sourceFile: filePath,
          type: 'music'
        });
      }
    }
  }

  return tracks;
}

/**
 * Load all SFX from metadata
 * @returns {Array} Array of effect objects with validation info
 */
function loadSFXTracks() {
  const manifestPath = path.join(METADATA_DIR, 'sfx/manifest.json');
  const manifest = loadMetadata(manifestPath);

  if (!manifest) {
    console.error('Failed to load SFX manifest');
    return [];
  }

  const effects = [];

  for (const [category, info] of Object.entries(manifest.categories)) {
    for (const filePath of info.files) {
      const fullPath = path.join(METADATA_DIR, 'sfx', filePath);
      const data = loadMetadata(fullPath);

      if (!data) {
        console.error(`Warning: Failed to load ${filePath}`);
        continue;
      }

      const effectList = data.effects || [];
      for (const effect of effectList) {
        effects.push({
          id: effect.id,
          name: effect.name,
          path: effect.path,
          category: category,
          subcategory: effect.subcategory || null,
          generated: effect.generated || false,
          sourceFile: filePath,
          type: 'sfx'
        });
      }
    }
  }

  return effects;
}

/**
 * Check if audio files exist for all tracks
 * @param {Array} tracks - Array of track objects
 * @returns {Object} Validation results
 */
function validateFiles(tracks) {
  const results = {
    total: tracks.length,
    existing: [],
    missing: [],
    generated: 0,
    notGenerated: 0
  };

  for (const track of tracks) {
    // Build full file path from asset path
    // track.path is like /assets/audio/music/core/title_theme.mp3
    const fullPath = path.join(ASSETS_DIR, track.path);
    const exists = fileExists(fullPath);

    if (exists) {
      results.existing.push(track);
    } else {
      results.missing.push(track);
    }

    if (track.generated) {
      results.generated++;
    } else {
      results.notGenerated++;
    }
  }

  return results;
}

/**
 * Format output as summary text
 * @param {Object} musicResults - Music validation results
 * @param {Object} sfxResults - SFX validation results
 * @param {Object} options - CLI options
 */
function outputSummary(musicResults, sfxResults, options) {
  console.log('');
  console.log('Audio Asset Validation Report');
  console.log('=============================');
  console.log('');

  if (musicResults) {
    console.log('Music Tracks:');
    console.log(`  Total: ${musicResults.total}`);
    console.log(`  Generated: ${musicResults.generated}`);
    console.log(`  Files exist: ${musicResults.existing.length}`);
    console.log(`  Missing files: ${musicResults.missing.length}`);
    console.log('');
  }

  if (sfxResults) {
    console.log('Sound Effects:');
    console.log(`  Total: ${sfxResults.total}`);
    console.log(`  Generated: ${sfxResults.generated}`);
    console.log(`  Files exist: ${sfxResults.existing.length}`);
    console.log(`  Missing files: ${sfxResults.missing.length}`);
    console.log('');
  }

  // Calculate totals
  const totalAssets = (musicResults?.total || 0) + (sfxResults?.total || 0);
  const totalMissing = (musicResults?.missing.length || 0) + (sfxResults?.missing.length || 0);
  const totalExisting = (musicResults?.existing.length || 0) + (sfxResults?.existing.length || 0);

  console.log('Summary:');
  console.log(`  Total assets: ${totalAssets}`);
  console.log(`  Files present: ${totalExisting}`);
  console.log(`  Files missing: ${totalMissing}`);

  if (totalAssets > 0) {
    const completionPercent = ((totalExisting / totalAssets) * 100).toFixed(1);
    console.log(`  Completion: ${completionPercent}%`);
  }
  console.log('');
}

/**
 * Format output for status display
 * @param {Object} musicResults - Music validation results
 * @param {Object} sfxResults - SFX validation results
 */
function outputStatus(musicResults, sfxResults) {
  console.log('');
  console.log('Audio Asset Status');
  console.log('==================');
  console.log('');

  if (musicResults) {
    console.log('MUSIC');
    console.log('-----');

    // Group by category
    const byCategory = {};
    [...musicResults.existing, ...musicResults.missing].forEach(track => {
      if (!byCategory[track.category]) {
        byCategory[track.category] = { total: 0, existing: 0, missing: 0 };
      }
      byCategory[track.category].total++;
      if (musicResults.existing.find(t => t.id === track.id)) {
        byCategory[track.category].existing++;
      } else {
        byCategory[track.category].missing++;
      }
    });

    for (const [category, stats] of Object.entries(byCategory)) {
      const statusIcon = stats.missing === 0 ? '[OK]' : '[!!]';
      console.log(`  ${statusIcon} ${category}: ${stats.existing}/${stats.total} present`);
    }
    console.log('');
  }

  if (sfxResults) {
    console.log('SOUND EFFECTS');
    console.log('-------------');

    // Group by category
    const byCategory = {};
    [...sfxResults.existing, ...sfxResults.missing].forEach(effect => {
      if (!byCategory[effect.category]) {
        byCategory[effect.category] = { total: 0, existing: 0, missing: 0 };
      }
      byCategory[effect.category].total++;
      if (sfxResults.existing.find(e => e.id === effect.id)) {
        byCategory[effect.category].existing++;
      } else {
        byCategory[effect.category].missing++;
      }
    });

    for (const [category, stats] of Object.entries(byCategory)) {
      const statusIcon = stats.missing === 0 ? '[OK]' : '[!!]';
      console.log(`  ${statusIcon} ${category}: ${stats.existing}/${stats.total} present`);
    }
    console.log('');
  }

  // Overall status
  const totalMissing = (musicResults?.missing.length || 0) + (sfxResults?.missing.length || 0);
  if (totalMissing === 0) {
    console.log('Status: All audio assets present!');
  } else {
    console.log(`Status: ${totalMissing} audio files missing`);
    console.log('Run with --missing to see the list of missing files');
  }
  console.log('');
}

/**
 * Format output showing only missing files
 * @param {Object} musicResults - Music validation results
 * @param {Object} sfxResults - SFX validation results
 */
function outputMissing(musicResults, sfxResults) {
  const allMissing = [
    ...(musicResults?.missing || []),
    ...(sfxResults?.missing || [])
  ];

  if (allMissing.length === 0) {
    console.log('');
    console.log('No missing audio files!');
    console.log('');
    return;
  }

  console.log('');
  console.log('Missing Audio Files');
  console.log('===================');
  console.log('');

  if (musicResults?.missing.length > 0) {
    console.log(`Music (${musicResults.missing.length} missing):`);
    for (const track of musicResults.missing) {
      console.log(`  ${track.path}`);
    }
    console.log('');
  }

  if (sfxResults?.missing.length > 0) {
    console.log(`Sound Effects (${sfxResults.missing.length} missing):`);
    for (const effect of sfxResults.missing) {
      console.log(`  ${effect.path}`);
    }
    console.log('');
  }
}

/**
 * Format verbose output with all tracks
 * @param {Object} musicResults - Music validation results
 * @param {Object} sfxResults - SFX validation results
 */
function outputVerbose(musicResults, sfxResults) {
  console.log('');
  console.log('Audio Asset Validation Report (Verbose)');
  console.log('=======================================');
  console.log('');

  if (musicResults) {
    console.log('MUSIC TRACKS');
    console.log('------------');
    console.log('');

    const allTracks = [...musicResults.existing, ...musicResults.missing];
    allTracks.sort((a, b) => a.id.localeCompare(b.id));

    for (const track of allTracks) {
      const hasFile = musicResults.existing.find(t => t.id === track.id);
      const fileStatus = hasFile ? '[FILE OK]' : '[MISSING]';
      const genStatus = track.generated ? '[GEN]' : '[NOT GEN]';

      console.log(`  ${track.id}`);
      console.log(`    Name: ${track.name}`);
      console.log(`    Category: ${track.category}`);
      console.log(`    Path: ${track.path}`);
      console.log(`    Status: ${fileStatus} ${genStatus}`);
      console.log('');
    }
  }

  if (sfxResults) {
    console.log('SOUND EFFECTS');
    console.log('-------------');
    console.log('');

    const allEffects = [...sfxResults.existing, ...sfxResults.missing];
    allEffects.sort((a, b) => a.id.localeCompare(b.id));

    for (const effect of allEffects) {
      const hasFile = sfxResults.existing.find(e => e.id === effect.id);
      const fileStatus = hasFile ? '[FILE OK]' : '[MISSING]';
      const genStatus = effect.generated ? '[GEN]' : '[NOT GEN]';

      console.log(`  ${effect.id}`);
      console.log(`    Name: ${effect.name}`);
      console.log(`    Category: ${effect.category}/${effect.subcategory || 'general'}`);
      console.log(`    Path: ${effect.path}`);
      console.log(`    Status: ${fileStatus} ${genStatus}`);
      console.log('');
    }
  }
}

/**
 * Format output as JSON
 * @param {Object} musicResults - Music validation results
 * @param {Object} sfxResults - SFX validation results
 */
function outputJSON(musicResults, sfxResults) {
  const report = {
    timestamp: new Date().toISOString(),
    music: musicResults ? {
      total: musicResults.total,
      generated: musicResults.generated,
      notGenerated: musicResults.notGenerated,
      filesExist: musicResults.existing.length,
      filesMissing: musicResults.missing.length,
      missingFiles: musicResults.missing.map(t => ({
        id: t.id,
        name: t.name,
        path: t.path,
        category: t.category
      }))
    } : null,
    sfx: sfxResults ? {
      total: sfxResults.total,
      generated: sfxResults.generated,
      notGenerated: sfxResults.notGenerated,
      filesExist: sfxResults.existing.length,
      filesMissing: sfxResults.missing.length,
      missingFiles: sfxResults.missing.map(e => ({
        id: e.id,
        name: e.name,
        path: e.path,
        category: e.category
      }))
    } : null,
    summary: {
      totalAssets: (musicResults?.total || 0) + (sfxResults?.total || 0),
      totalExisting: (musicResults?.existing.length || 0) + (sfxResults?.existing.length || 0),
      totalMissing: (musicResults?.missing.length || 0) + (sfxResults?.missing.length || 0),
      completionPercent: null
    }
  };

  // Calculate completion percentage
  if (report.summary.totalAssets > 0) {
    report.summary.completionPercent =
      ((report.summary.totalExisting / report.summary.totalAssets) * 100).toFixed(1);
  }

  console.log(JSON.stringify(report, null, 2));
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

  // Load and validate music tracks
  let musicResults = null;
  if (!options.sfxOnly) {
    const musicTracks = loadMusicTracks();
    if (musicTracks.length > 0) {
      musicResults = validateFiles(musicTracks);
    }
  }

  // Load and validate SFX
  let sfxResults = null;
  if (!options.musicOnly) {
    const sfxTracks = loadSFXTracks();
    if (sfxTracks.length > 0) {
      sfxResults = validateFiles(sfxTracks);
    }
  }

  // Output based on options
  if (options.json) {
    outputJSON(musicResults, sfxResults);
  } else if (options.verbose) {
    outputVerbose(musicResults, sfxResults);
    outputSummary(musicResults, sfxResults, options);
  } else if (options.missing) {
    outputMissing(musicResults, sfxResults);
  } else if (options.status) {
    outputStatus(musicResults, sfxResults);
  } else {
    // Default summary
    outputSummary(musicResults, sfxResults, options);
  }

  // Exit with error code if there are missing files
  const totalMissing = (musicResults?.missing.length || 0) + (sfxResults?.missing.length || 0);
  process.exit(totalMissing > 0 ? 1 : 0);
}

main().catch(error => {
  console.error(`Unexpected error: ${error.message}`);
  console.error(error);
  process.exit(1);
});
