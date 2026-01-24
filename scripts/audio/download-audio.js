#!/usr/bin/env node
/**
 * Audio Download Script
 * Downloads pending audio tracks from Suno generation service
 *
 * Usage:
 *   node scripts/audio/download-audio.js                # Check status and download completed
 *   node scripts/audio/download-audio.js --check        # Only check status of pending generations
 *   node scripts/audio/download-audio.js --download     # Download all completed tracks
 *   node scripts/audio/download-audio.js --task <id>    # Check/download specific task
 *   node scripts/audio/download-audio.js --retry        # Retry failed downloads
 *
 * Environment variables:
 *   SUNO_API_KEY - Required for Suno API access
 */

const path = require('path');
const {
  SunoClient,
  SUNO_STATUS,
  loadMetadata,
  saveMetadata,
  fileExists,
  log,
  delay,
  ensureDirectoryExists
} = require('./lib');

// Configuration
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const METADATA_DIR = path.join(PROJECT_ROOT, 'audio-metadata/music');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'frontend/public/assets/audio/music');

/**
 * Parse command line arguments
 * @returns {Object} Parsed arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    check: false,
    download: false,
    task: null,
    retry: false,
    help: false
  };

  // If no args, default to both check and download
  let hasMode = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--check':
        options.check = true;
        hasMode = true;
        break;
      case '--download':
        options.download = true;
        hasMode = true;
        break;
      case '--task':
        options.task = args[++i];
        break;
      case '--retry':
        options.retry = true;
        hasMode = true;
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

  // Default behavior: check and download
  if (!hasMode) {
    options.check = true;
    options.download = true;
  }

  return options;
}

/**
 * Display help message
 */
function showHelp() {
  console.log(`
Audio Download Script
Downloads pending audio tracks from Suno generation service

Usage:
  node scripts/audio/download-audio.js [options]

Options:
  --check           Check status of pending generations (default if no options)
  --download        Download completed tracks (default if no options)
  --task <id>       Check/download specific task by taskId
  --retry           Retry previously failed downloads
  --help, -h        Show this help message

When run without options, both --check and --download are enabled.

Environment variables:
  SUNO_API_KEY  Required for Suno API access

Examples:
  node scripts/audio/download-audio.js
  node scripts/audio/download-audio.js --check
  node scripts/audio/download-audio.js --download
  node scripts/audio/download-audio.js --task abc123
  node scripts/audio/download-audio.js --retry
`);
}

/**
 * Load all tracks that have pending taskIds
 * @returns {Array} Tracks with taskIds that need checking
 */
function loadPendingTracks() {
  const manifest = loadMetadata(path.join(METADATA_DIR, 'manifest.json'));
  if (!manifest) {
    throw new Error('Failed to load music manifest.json');
  }

  const pendingTracks = [];

  for (const [category, info] of Object.entries(manifest.categories)) {
    for (const filePath of info.files) {
      const fullPath = path.join(METADATA_DIR, filePath);
      const data = loadMetadata(fullPath);

      if (!data || !data.tracks) continue;

      for (const track of data.tracks) {
        // Track has a taskId but isn't marked as generated
        if (track.taskId && !track.generated) {
          pendingTracks.push({
            ...track,
            _sourceFile: filePath,
            _category: category
          });
        }
      }
    }
  }

  return pendingTracks;
}

/**
 * Load tracks with failed downloads for retry
 * @returns {Array} Tracks that had download failures
 */
function loadFailedTracks() {
  const manifest = loadMetadata(path.join(METADATA_DIR, 'manifest.json'));
  if (!manifest) {
    throw new Error('Failed to load music manifest.json');
  }

  const failedTracks = [];

  for (const [category, info] of Object.entries(manifest.categories)) {
    for (const filePath of info.files) {
      const fullPath = path.join(METADATA_DIR, filePath);
      const data = loadMetadata(fullPath);

      if (!data || !data.tracks) continue;

      for (const track of data.tracks) {
        // Track has a taskId, is marked as failed, and not yet generated
        if (track.taskId && track.downloadFailed && !track.generated) {
          failedTracks.push({
            ...track,
            _sourceFile: filePath,
            _category: category
          });
        }
      }
    }
  }

  return failedTracks;
}

/**
 * Get the full output path for a track
 * @param {Object} track - Track metadata
 * @returns {string} Full file system path
 */
function getOutputPath(track) {
  const relativePath = track.path.replace(/^\/assets\/audio\/music\//, '');
  return path.join(OUTPUT_DIR, relativePath);
}

/**
 * Update track metadata after checking status
 * @param {Object} track - Track to update
 * @param {Object} status - Status from API
 */
function updateTrackStatus(track, status) {
  const filePath = path.join(METADATA_DIR, track._sourceFile);
  const data = loadMetadata(filePath);

  if (!data) {
    log(`Failed to load ${track._sourceFile} for update`, 'error');
    return;
  }

  const trackIndex = data.tracks.findIndex(t => t.id === track.id);
  if (trackIndex !== -1) {
    data.tracks[trackIndex].lastStatusCheck = new Date().toISOString();
    data.tracks[trackIndex].status = status.status;

    if (status.isError) {
      data.tracks[trackIndex].generationError = status.errorMessage || status.status;
    }

    saveMetadata(filePath, data);
  }
}

/**
 * Mark track as successfully downloaded
 * @param {Object} track - Track to update
 * @param {Object} downloadResult - Download result
 */
function markTrackDownloaded(track, downloadResult) {
  const filePath = path.join(METADATA_DIR, track._sourceFile);
  const data = loadMetadata(filePath);

  if (!data) {
    log(`Failed to load ${track._sourceFile} for update`, 'error');
    return;
  }

  const trackIndex = data.tracks.findIndex(t => t.id === track.id);
  if (trackIndex !== -1) {
    data.tracks[trackIndex].generated = true;
    data.tracks[trackIndex].generatedAt = new Date().toISOString();
    data.tracks[trackIndex].downloadedFrom = downloadResult.taskId;
    data.tracks[trackIndex].fileSize = downloadResult.size;
    data.tracks[trackIndex].duration = downloadResult.duration;
    delete data.tracks[trackIndex].downloadFailed;

    saveMetadata(filePath, data);
  }
}

/**
 * Mark track download as failed
 * @param {Object} track - Track to update
 * @param {string} error - Error message
 */
function markDownloadFailed(track, error) {
  const filePath = path.join(METADATA_DIR, track._sourceFile);
  const data = loadMetadata(filePath);

  if (!data) {
    log(`Failed to load ${track._sourceFile} for update`, 'error');
    return;
  }

  const trackIndex = data.tracks.findIndex(t => t.id === track.id);
  if (trackIndex !== -1) {
    data.tracks[trackIndex].downloadFailed = true;
    data.tracks[trackIndex].downloadError = error;
    data.tracks[trackIndex].lastDownloadAttempt = new Date().toISOString();

    saveMetadata(filePath, data);
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

  log('Audio Download Script', 'info');
  log('=====================', 'info');
  console.log('');

  // Check for API key
  const apiKey = process.env.SUNO_API_KEY;
  if (!apiKey) {
    log('SUNO_API_KEY environment variable is required', 'error');
    log('Set it with: export SUNO_API_KEY=your_api_key', 'info');
    process.exit(1);
  }

  // Initialize client
  const client = new SunoClient({ apiKey });

  // Load tracks to process
  let tracksToProcess = [];

  if (options.task) {
    // Specific task lookup
    log(`Looking up specific task: ${options.task}`, 'info');
    // We still need to find the track in metadata to know where to save it
    const allTracks = loadPendingTracks();
    const matchingTrack = allTracks.find(t => t.taskId === options.task);

    if (matchingTrack) {
      tracksToProcess = [matchingTrack];
    } else {
      log(`No pending track found with taskId: ${options.task}`, 'warn');
      log('The track may have already been downloaded or the taskId is invalid', 'info');
    }
  } else if (options.retry) {
    tracksToProcess = loadFailedTracks();
    log(`Found ${tracksToProcess.length} tracks with failed downloads`, 'info');
  } else {
    tracksToProcess = loadPendingTracks();
    log(`Found ${tracksToProcess.length} tracks with pending generation tasks`, 'info');
  }

  if (tracksToProcess.length === 0) {
    log('No tracks to process', 'success');
    process.exit(0);
  }

  console.log('');

  // Ensure output directories exist
  ensureDirectoryExists(path.join(OUTPUT_DIR, 'regions'));
  ensureDirectoryExists(path.join(OUTPUT_DIR, 'battle'));
  ensureDirectoryExists(path.join(OUTPUT_DIR, 'core'));

  const results = {
    pending: [],
    processing: [],
    completed: [],
    downloaded: [],
    failed: []
  };

  // Check status of each track
  if (options.check || !options.download) {
    log('Checking generation status...', 'info');
    console.log('');

    for (const track of tracksToProcess) {
      try {
        const status = await client.checkStatus(track.taskId);

        // Update metadata with status
        updateTrackStatus(track, status);

        // Track the result based on isComplete/isError flags
        if (status.isComplete) {
          results.completed.push({ track, status });
          console.log(`  [COMPLETED]  ${track.id} - Ready for download`);
        } else if (status.isError) {
          results.failed.push({ track, status, error: status.errorMessage || status.status });
          console.log(`  [FAILED]     ${track.id} - ${status.errorMessage || status.status}`);
        } else if (status.status === SUNO_STATUS.PENDING) {
          results.pending.push({ track, status });
          console.log(`  [PENDING]    ${track.id} - Queued for generation`);
        } else {
          // TEXT_SUCCESS, FIRST_SUCCESS, or other intermediate states
          results.processing.push({ track, status });
          console.log(`  [PROCESSING] ${track.id} - Status: ${status.status}`);
        }

        // Small delay between status checks
        await delay(200);
      } catch (error) {
        log(`Failed to check status for ${track.id}: ${error.message}`, 'error');
        results.failed.push({ track, error: error.message });
      }
    }

    console.log('');
  }

  // Download completed tracks
  if (options.download && results.completed.length > 0) {
    log(`Downloading ${results.completed.length} completed tracks...`, 'info');
    console.log('');

    for (const { track, status } of results.completed) {
      const outputPath = getOutputPath(track);

      // Skip if file already exists
      if (fileExists(outputPath)) {
        log(`Skipping ${track.id} - file already exists`, 'info');
        continue;
      }

      try {
        log(`Downloading all variants: ${track.id}`, 'info');
        const downloadResult = await client.downloadAllTracks(track.taskId, outputPath);

        const totalSize = downloadResult.downloads.reduce((sum, d) => sum + d.size, 0);
        results.downloaded.push({
          id: track.id,
          path: downloadResult.primaryPath,
          size: totalSize,
          totalTracks: downloadResult.totalTracks,
          duration: downloadResult.downloads[0]?.duration
        });

        // Update metadata (using primary track info)
        markTrackDownloaded(track, {
          path: downloadResult.primaryPath,
          size: totalSize,
          duration: downloadResult.downloads[0]?.duration
        });

        log(`Downloaded: ${track.id} (${downloadResult.totalTracks} tracks, ${totalSize} bytes total)`, 'success');
        for (const dl of downloadResult.downloads) {
          log(`  - ${dl.path} (${dl.size} bytes)`, 'info');
        }

        // Rate limit delay
        await delay(500);
      } catch (error) {
        log(`Failed to download ${track.id}: ${error.message}`, 'error');
        markDownloadFailed(track, error.message);
        results.failed.push({ track, error: error.message });
      }
    }

    console.log('');
  }

  // Summary
  console.log('========================================');
  log('Summary', 'info');
  console.log('========================================');
  console.log(`  Pending:     ${results.pending.length}`);
  console.log(`  Processing:  ${results.processing.length}`);
  console.log(`  Completed:   ${results.completed.length}`);
  console.log(`  Downloaded:  ${results.downloaded.length}`);
  console.log(`  Failed:      ${results.failed.length}`);
  console.log('');

  if (results.downloaded.length > 0) {
    log('Downloaded files:', 'info');
    let totalBytes = 0;
    for (const file of results.downloaded) {
      console.log(`  - ${file.id} (${file.size} bytes)`);
      totalBytes += file.size;
    }
    console.log('');
    log(`Total downloaded: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`, 'info');
  }

  if (results.pending.length > 0 || results.processing.length > 0) {
    console.log('');
    log('Some tracks are still being generated. Run this script again later to download them.', 'info');
  }

  if (results.failed.length > 0) {
    console.log('');
    log('Failed tracks:', 'error');
    for (const { track, error } of results.failed) {
      console.log(`  - ${track.id}: ${error}`);
    }
    log('Use --retry to attempt failed downloads again', 'info');
  }

  process.exit(results.failed.length > 0 ? 1 : 0);
}

main().catch(error => {
  log(`Unexpected error: ${error.message}`, 'error');
  console.error(error);
  process.exit(1);
});
