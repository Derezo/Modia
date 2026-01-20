#!/usr/bin/env node
/**
 * Music Generation Script
 * Generates music tracks using Suno API based on metadata configuration
 *
 * Usage:
 *   node scripts/audio/generate-music.js                      # Generate all pending tracks
 *   node scripts/audio/generate-music.js --dry-run            # Preview without generating
 *   node scripts/audio/generate-music.js --key heartlands_exploration  # Generate specific track
 *   node scripts/audio/generate-music.js --region heartlands  # Generate region-specific tracks
 *   node scripts/audio/generate-music.js --category battle    # Generate specific category
 *   node scripts/audio/generate-music.js --force              # Regenerate even if file exists
 *
 * Environment variables:
 *   SUNO_API_KEY - Required API key for Suno
 *   SUNO_WEBHOOK_URL - Optional webhook for completion notifications
 */

const path = require('path');
const {
  SunoClient,
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
    dryRun: false,
    key: null,
    region: null,
    category: null,
    force: false,
    wait: true,  // Default to waiting and downloading (single-step workflow)
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--key':
        options.key = args[++i];
        break;
      case '--region':
        options.region = args[++i];
        break;
      case '--category':
        options.category = args[++i];
        break;
      case '--force':
        options.force = true;
        break;
      case '--no-wait':
        options.wait = false;  // Opt-out of waiting (for batch generation)
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
Music Generation Script
Generates music tracks using Suno API based on metadata configuration

Usage:
  node scripts/audio/generate-music.js [options]

Options:
  --dry-run         Show what would be generated without calling APIs
  --key <id>        Generate specific track by key (e.g., heartlands_exploration)
  --region <name>   Generate only for specific region (heartlands, sylvan_reaches, iron_depths, shadowmere, bloodplains)
  --category <cat>  Generate only specific category (regions, battle, core)
  --force           Regenerate even if file exists
  --no-wait         Don't wait for completion (for batch generation, use download-audio.js later)
  --help, -h        Show this help message

By default, the script waits for generation to complete and downloads the file automatically.

Environment variables:
  SUNO_API_KEY      Required API key for Suno
  SUNO_WEBHOOK_URL  Optional webhook for completion notifications (not required)

Examples:
  node scripts/audio/generate-music.js --key title_theme          # Generate and download
  node scripts/audio/generate-music.js --dry-run                  # Preview what would be generated
  node scripts/audio/generate-music.js --region heartlands        # Generate all heartlands tracks
  node scripts/audio/generate-music.js --category battle --force  # Regenerate battle tracks
  node scripts/audio/generate-music.js --no-wait                  # Start generation, download later
`);
}

/**
 * Load all music metadata from all category files
 * @returns {Object} Combined metadata by category
 */
function loadAllMusicMetadata() {
  const manifest = loadMetadata(path.join(METADATA_DIR, 'manifest.json'));
  if (!manifest) {
    throw new Error('Failed to load music manifest.json');
  }

  const metadata = {
    manifest,
    tracks: [],
    byCategory: {}
  };

  for (const [category, info] of Object.entries(manifest.categories)) {
    metadata.byCategory[category] = [];

    for (const filePath of info.files) {
      const fullPath = path.join(METADATA_DIR, filePath);
      const data = loadMetadata(fullPath);

      if (!data) {
        log(`Warning: Failed to load ${filePath}`, 'warn');
        continue;
      }

      const tracks = data.tracks || [];
      for (const track of tracks) {
        track._sourceFile = filePath;
        track._category = category;
        metadata.tracks.push(track);
        metadata.byCategory[category].push(track);
      }
    }
  }

  return metadata;
}

/**
 * Filter tracks based on CLI options
 * @param {Array} tracks - All tracks
 * @param {Object} options - CLI options
 * @returns {Array} Filtered tracks
 */
function filterTracks(tracks, options) {
  let filtered = tracks;

  // Filter by specific key
  if (options.key) {
    filtered = filtered.filter(t => t.id === options.key);
  }

  // Filter by region
  if (options.region) {
    filtered = filtered.filter(t => t.region === options.region);
  }

  // Filter by category
  if (options.category) {
    filtered = filtered.filter(t => t._category === options.category);
  }

  return filtered;
}

/**
 * Get the full output path for a track
 * @param {Object} track - Track metadata
 * @returns {string} Full file system path
 */
function getOutputPath(track) {
  // Track paths start with /assets/audio/music/
  // We need to map to frontend/public/assets/audio/music/
  const relativePath = track.path.replace(/^\/assets\/audio\/music\//, '');
  return path.join(OUTPUT_DIR, relativePath);
}

/**
 * Check if a track needs generation
 * @param {Object} track - Track metadata
 * @param {Object} options - CLI options
 * @returns {boolean} True if track should be generated
 */
function needsGeneration(track, options) {
  // If force flag, always generate
  if (options.force) {
    return true;
  }

  // Check if already marked as generated
  if (track.generated) {
    return false;
  }

  // Check if file already exists
  const outputPath = getOutputPath(track);
  if (fileExists(outputPath)) {
    return false;
  }

  return true;
}

/**
 * Update metadata file with generation status
 * @param {Object} track - Track that was generated
 * @param {Object} result - Generation result with taskId
 */
function updateTrackMetadata(track, result) {
  const filePath = path.join(METADATA_DIR, track._sourceFile);
  const data = loadMetadata(filePath);

  if (!data) {
    log(`Failed to load ${track._sourceFile} for update`, 'error');
    return;
  }

  // Find and update the track
  const trackIndex = data.tracks.findIndex(t => t.id === track.id);
  if (trackIndex !== -1) {
    // Store taskId for later download
    data.tracks[trackIndex].taskId = result.taskId;
    data.tracks[trackIndex].generationStarted = new Date().toISOString();
    saveMetadata(filePath, data);
    log(`Updated metadata for ${track.id}`, 'info');
  }
}

/**
 * Mark track as generated in metadata
 * @param {Object} track - Track that was generated
 */
function markTrackGenerated(track) {
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
    saveMetadata(filePath, data);
  }
}

/**
 * Validate required environment variables
 * @param {Object} options - CLI options
 * @returns {boolean} True if validation passed, exits otherwise
 */
function validateEnvVars(options) {
  // Skip validation for dry-run mode
  if (options.dryRun) {
    return true;
  }

  if (!process.env.SUNO_API_KEY) {
    log('Missing SUNO_API_KEY in environment', 'error');
    log(`Expected .env file location: ${path.resolve(__dirname, '../..', '.env')}`, 'info');
    log('Set it with: export SUNO_API_KEY=your_api_key', 'info');
    process.exit(1);
  }

  return true;
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

  // Early validation of environment variables
  validateEnvVars(options);

  log('Music Generation Script', 'info');
  log('=======================', 'info');

  // Load metadata
  let metadata;
  try {
    metadata = loadAllMusicMetadata();
    log(`Loaded ${metadata.tracks.length} total tracks`, 'info');
  } catch (error) {
    log(`Failed to load metadata: ${error.message}`, 'error');
    process.exit(1);
  }

  // Filter tracks
  const filteredTracks = filterTracks(metadata.tracks, options);
  log(`Filtered to ${filteredTracks.length} tracks`, 'info');

  // Determine which tracks need generation
  const tracksToGenerate = filteredTracks.filter(t => needsGeneration(t, options));
  const skippedTracks = filteredTracks.length - tracksToGenerate.length;

  if (skippedTracks > 0) {
    log(`Skipping ${skippedTracks} tracks (already exist or generated)`, 'info');
  }

  if (tracksToGenerate.length === 0) {
    log('No tracks need generation', 'success');
    process.exit(0);
  }

  log(`\nTracks to generate: ${tracksToGenerate.length}`, 'info');
  console.log('');

  // Display what will be generated
  for (const track of tracksToGenerate) {
    console.log(`  - ${track.id}`);
    console.log(`    Name: ${track.name}`);
    console.log(`    Category: ${track._category}`);
    console.log(`    Region: ${track.region || 'N/A'}`);
    console.log(`    Output: ${getOutputPath(track)}`);
    if (options.dryRun) {
      console.log(`    Prompt: ${track.sunoPrompt.substring(0, 80)}...`);
    }
    console.log('');
  }

  // Dry run - just display
  if (options.dryRun) {
    log(`\nDry run complete. Would generate ${tracksToGenerate.length} tracks.`, 'success');
    process.exit(0);
  }

  // API key is validated at start of main(), safe to use directly
  const apiKey = process.env.SUNO_API_KEY;

  // Initialize client
  const client = new SunoClient({
    apiKey,
    webhookUrl: process.env.SUNO_WEBHOOK_URL
  });

  // Ensure output directories exist
  ensureDirectoryExists(path.join(OUTPUT_DIR, 'regions'));
  ensureDirectoryExists(path.join(OUTPUT_DIR, 'battle'));
  ensureDirectoryExists(path.join(OUTPUT_DIR, 'core'));

  // Generate tracks
  const results = {
    started: [],
    failed: []
  };

  log('\nStarting generation...', 'info');
  console.log('');

  for (let i = 0; i < tracksToGenerate.length; i++) {
    const track = tracksToGenerate[i];
    log(`[${i + 1}/${tracksToGenerate.length}] Generating: ${track.id}`, 'info');

    try {
      // Generate track - wait for completion if --wait flag is set
      const result = await client.generateTrack(track.sunoPrompt, {
        title: track.name,
        style: track.style,
        instrumental: true,
        model: track.model || 'V4_5ALL',
        customMode: true,
        waitForCompletion: options.wait
      });

      results.started.push({
        id: track.id,
        name: track.name,
        taskId: result.taskId,
        track: track,
        result: result
      });

      // Update metadata with taskId
      updateTrackMetadata(track, result);

      if (options.wait) {
        log(`Generation completed for ${track.id}, taskId: ${result.taskId}`, 'success');
      } else {
        log(`Started generation for ${track.id}, taskId: ${result.taskId}`, 'success');
      }

      // Rate limit delay between requests
      if (i < tracksToGenerate.length - 1) {
        await delay(1000);
      }
    } catch (error) {
      log(`Failed to generate ${track.id}: ${error.message}`, 'error');
      results.failed.push({
        id: track.id,
        name: track.name,
        error: error.message
      });
    }
  }

  // If --wait was specified, also download the completed tracks
  if (options.wait && results.started.length > 0) {
    log('\nDownloading completed tracks...', 'info');
    console.log('');

    for (const item of results.started) {
      const outputPath = getOutputPath(item.track);

      try {
        log(`Downloading: ${item.id}`, 'info');
        const downloadResult = await client.downloadTrack(item.taskId, outputPath);

        // Mark as generated in metadata
        markTrackGenerated(item.track);

        log(`Downloaded: ${item.id} (${downloadResult.size} bytes)`, 'success');
      } catch (error) {
        log(`Failed to download ${item.id}: ${error.message}`, 'error');
        results.failed.push({
          id: item.id,
          name: item.name,
          error: `Download failed: ${error.message}`
        });
      }
    }
  }

  // Summary
  console.log('\n========================================');
  log('Generation Summary', 'info');
  console.log('========================================');
  console.log(`  Started:  ${results.started.length}`);
  console.log(`  Failed:   ${results.failed.length}`);
  console.log('');

  if (results.started.length > 0) {
    log('Completed tracks:', 'info');
    for (const track of results.started) {
      console.log(`  - ${track.id} (taskId: ${track.taskId})`);
    }
    console.log('');
    if (!options.wait) {
      log('Use download-audio.js to check status and download completed tracks', 'info');
    }
  }

  if (results.failed.length > 0) {
    log('Failed tracks:', 'error');
    for (const track of results.failed) {
      console.log(`  - ${track.id}: ${track.error}`);
    }
  }

  process.exit(results.failed.length > 0 ? 1 : 0);
}

main().catch(error => {
  log(`Unexpected error: ${error.message}`, 'error');
  console.error(error);
  process.exit(1);
});
