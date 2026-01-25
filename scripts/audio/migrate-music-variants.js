#!/usr/bin/env node
/**
 * Music Variant Migration Script
 * Scans existing generated music tracks and updates metadata with variant information.
 *
 * This script:
 * 1. Scans all music metadata files for generated tracks
 * 2. For each generated track, checks for _v2.mp3 variant files
 * 3. Creates variants array in metadata with path, duration, filename
 * 4. Optionally generates real waveforms using FFmpeg
 *
 * Usage:
 *   node scripts/audio/migrate-music-variants.js                # Dry run - show what would change
 *   node scripts/audio/migrate-music-variants.js --apply        # Apply changes to metadata
 *   node scripts/audio/migrate-music-variants.js --waveforms    # Also regenerate waveforms
 *   node scripts/audio/migrate-music-variants.js --apply --waveforms  # Apply all changes
 */

const path = require('path');
const fs = require('fs');
const {
  loadMetadata,
  saveMetadata,
  fileExists,
  log,
  formatBytes,
  generateWaveformPeaks,
  checkFfmpegAvailable
} = require('./lib');

// Configuration
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const METADATA_DIR = path.join(PROJECT_ROOT, 'audio-metadata/music');
const AUDIO_DIR = path.join(PROJECT_ROOT, 'frontend/public/assets/audio/music');

/**
 * Parse command line arguments
 * @returns {Object} Parsed options
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    apply: false,
    waveforms: false,
    help: false
  };

  for (const arg of args) {
    switch (arg) {
      case '--apply':
        options.apply = true;
        break;
      case '--waveforms':
        options.waveforms = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        if (arg.startsWith('--')) {
          log(`Unknown option: ${arg}`, 'warn');
        }
    }
  }

  return options;
}

/**
 * Display help message
 */
function showHelp() {
  console.log(`
Music Variant Migration Script
Scans existing generated music tracks and updates metadata with variant information.

Usage:
  node scripts/audio/migrate-music-variants.js [options]

Options:
  --apply       Apply changes to metadata files (default is dry run)
  --waveforms   Also regenerate waveform data using FFmpeg
  --help, -h    Show this help message

Examples:
  node scripts/audio/migrate-music-variants.js              # Dry run
  node scripts/audio/migrate-music-variants.js --apply      # Apply changes
  node scripts/audio/migrate-music-variants.js --apply --waveforms  # Apply with waveforms
`);
}

/**
 * Get file stats for an audio file
 * @param {string} filePath - Path to the audio file
 * @returns {Object|null} File stats or null if file doesn't exist
 */
function getFileStats(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const stats = fs.statSync(filePath);
    return {
      size: stats.size,
      mtime: stats.mtime.toISOString()
    };
  } catch {
    return null;
  }
}

/**
 * Find variant files for a given track
 * @param {string} primaryPath - Path to the primary audio file
 * @returns {Array} Array of variant file info
 */
function findVariantFiles(primaryPath) {
  const variants = [];
  const ext = path.extname(primaryPath);
  const basePath = primaryPath.slice(0, -ext.length);

  // Check for primary file (v1)
  if (fileExists(primaryPath)) {
    const stats = getFileStats(primaryPath);
    variants.push({
      index: 1,
      path: primaryPath,
      size: stats?.size || 0
    });
  }

  // Check for v2, v3, etc.
  for (let i = 2; i <= 5; i++) {
    const variantPath = `${basePath}_v${i}${ext}`;
    if (fileExists(variantPath)) {
      const stats = getFileStats(variantPath);
      variants.push({
        index: i,
        path: variantPath,
        size: stats?.size || 0
      });
    }
  }

  return variants;
}

/**
 * Convert file system path to web path
 * @param {string} fsPath - File system path
 * @returns {string} Web path (e.g., /assets/audio/music/regions/track.mp3)
 */
function toWebPath(fsPath) {
  const publicIndex = fsPath.indexOf('/public/');
  if (publicIndex !== -1) {
    return fsPath.slice(publicIndex + 7); // Remove up to and including '/public'
  }
  // Fallback: extract from audio directory
  const audioIndex = fsPath.indexOf('/assets/audio/');
  if (audioIndex !== -1) {
    return fsPath.slice(audioIndex);
  }
  return fsPath;
}

/**
 * Load all generated music tracks
 * @returns {Array} Array of tracks with metadata
 */
function loadGeneratedTracks() {
  const manifest = loadMetadata(path.join(METADATA_DIR, 'manifest.json'));
  if (!manifest) {
    throw new Error('Failed to load music manifest.json');
  }

  const tracks = [];

  for (const [category, info] of Object.entries(manifest.categories)) {
    for (const filePath of info.files) {
      const fullPath = path.join(METADATA_DIR, filePath);
      const data = loadMetadata(fullPath);

      if (!data || !data.tracks) continue;

      for (const track of data.tracks) {
        if (track.generated) {
          tracks.push({
            ...track,
            _sourceFile: filePath,
            _category: category
          });
        }
      }
    }
  }

  return tracks;
}

/**
 * Update track metadata with variant information
 * @param {Object} track - Track to update
 * @param {Array} variants - Variant information
 * @param {Array|null} waveform - Optional waveform data
 * @param {boolean} apply - Whether to actually apply changes
 * @returns {Object} Update result
 */
function updateTrackMetadata(track, variants, waveform, apply) {
  const filePath = path.join(METADATA_DIR, track._sourceFile);
  const data = loadMetadata(filePath);

  if (!data) {
    return { success: false, error: 'Failed to load metadata file' };
  }

  const trackIndex = data.tracks.findIndex(t => t.id === track.id);
  if (trackIndex === -1) {
    return { success: false, error: 'Track not found in metadata file' };
  }

  // Build variants array
  const variantsData = variants.map((v, idx) => ({
    id: `${track.id}_v${v.index}`,
    path: toWebPath(v.path),
    filename: path.basename(v.path),
    fileSize: v.size,
    isPrimary: idx === 0
  }));

  const updates = {
    variants: variantsData,
    primaryVariantId: variantsData[0]?.id || null
  };

  if (waveform) {
    updates.waveform = waveform;
  }

  if (apply) {
    data.tracks[trackIndex] = {
      ...data.tracks[trackIndex],
      ...updates
    };
    saveMetadata(filePath, data);
  }

  return {
    success: true,
    updates,
    variantCount: variantsData.length
  };
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

  log('Music Variant Migration Script', 'info');
  log('================================', 'info');
  console.log('');

  if (!options.apply) {
    log('DRY RUN MODE - No changes will be made', 'warn');
    log('Use --apply to actually update metadata files', 'info');
    console.log('');
  }

  // Check ffmpeg availability if waveforms requested
  let ffmpegAvailable = false;
  if (options.waveforms) {
    ffmpegAvailable = await checkFfmpegAvailable();
    if (!ffmpegAvailable) {
      log('FFmpeg not available - waveform generation will be skipped', 'warn');
    } else {
      log('FFmpeg available - will generate waveforms', 'success');
    }
    console.log('');
  }

  // Load all generated tracks
  const tracks = loadGeneratedTracks();
  log(`Found ${tracks.length} generated music tracks`, 'info');
  console.log('');

  const results = {
    scanned: 0,
    withVariants: 0,
    updated: 0,
    waveformsGenerated: 0,
    errors: []
  };

  for (const track of tracks) {
    results.scanned++;

    // Get the primary audio file path
    if (!track.path) {
      log(`  SKIP: ${track.id} - No path in metadata`, 'warn');
      continue;
    }

    // Convert web path to file system path
    const webPath = track.path;
    const fsPath = path.join(PROJECT_ROOT, 'frontend/public', webPath);

    // Find all variant files
    const variants = findVariantFiles(fsPath);

    if (variants.length === 0) {
      log(`  SKIP: ${track.id} - Audio file not found: ${fsPath}`, 'warn');
      continue;
    }

    // Check if already has variants
    const hasExistingVariants = track.variants && track.variants.length > 0;
    if (hasExistingVariants && variants.length <= track.variants.length) {
      // Only skip if the existing variant data seems complete
      if (!options.waveforms) {
        log(`  SKIP: ${track.id} - Already has ${track.variants.length} variants`, 'info');
        continue;
      }
    }

    if (variants.length > 1) {
      results.withVariants++;
    }

    // Generate waveform if requested
    let waveform = null;
    if (options.waveforms && ffmpegAvailable) {
      try {
        waveform = await generateWaveformPeaks(variants[0].path, 100);
        // Round to 3 decimal places
        waveform = waveform.map(p => Math.round(p * 1000) / 1000);
        results.waveformsGenerated++;
      } catch (err) {
        log(`  WARN: Failed to generate waveform for ${track.id}: ${err.message}`, 'warn');
      }
    }

    // Update metadata
    const result = updateTrackMetadata(track, variants, waveform, options.apply);

    if (result.success) {
      results.updated++;
      const totalSize = variants.reduce((sum, v) => sum + v.size, 0);
      log(`  ${options.apply ? 'UPDATED' : 'WOULD UPDATE'}: ${track.id} - ${variants.length} variants (${formatBytes(totalSize)})`, 'success');
      for (const v of variants) {
        log(`    v${v.index}: ${path.basename(v.path)} (${formatBytes(v.size)})`, 'info');
      }
    } else {
      results.errors.push({ id: track.id, error: result.error });
      log(`  ERROR: ${track.id} - ${result.error}`, 'error');
    }
  }

  // Summary
  console.log('');
  console.log('========================================');
  log('Summary', 'info');
  console.log('========================================');
  console.log(`  Tracks scanned:       ${results.scanned}`);
  console.log(`  Tracks with variants: ${results.withVariants}`);
  console.log(`  Metadata ${options.apply ? 'updated' : 'would update'}:   ${results.updated}`);
  if (options.waveforms) {
    console.log(`  Waveforms generated:  ${results.waveformsGenerated}`);
  }
  console.log(`  Errors:               ${results.errors.length}`);
  console.log('');

  if (!options.apply && results.updated > 0) {
    log('Run with --apply to actually update metadata files', 'info');
  }

  if (results.errors.length > 0) {
    log('Errors:', 'error');
    for (const { id, error } of results.errors) {
      console.log(`  - ${id}: ${error}`);
    }
  }

  process.exit(results.errors.length > 0 ? 1 : 0);
}

main().catch(error => {
  log(`Unexpected error: ${error.message}`, 'error');
  console.error(error);
  process.exit(1);
});
