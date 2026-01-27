#!/usr/bin/env node
/**
 * Full Audio Generation Script
 * Orchestrates generation of all music and SFX assets
 *
 * Usage:
 *   node scripts/audio/generate-all.js                       # Generate all audio
 *   node scripts/audio/generate-all.js --dry-run             # Preview without generating
 *   node scripts/audio/generate-all.js --music-only          # Music only
 *   node scripts/audio/generate-all.js --sfx-only            # SFX only
 *   node scripts/audio/generate-all.js --region heartlands   # Specific region
 *   node scripts/audio/generate-all.js --category combat     # Specific SFX category
 *   node scripts/audio/generate-all.js --force               # Regenerate even if file exists
 *   node scripts/audio/generate-all.js --skip-existing       # Skip files that exist (default)
 *
 * Environment variables:
 *   SUNO_API_KEY - Required for music generation
 *   ELEVENLABS_API_KEY - Required for SFX generation
 */

const path = require('path');
const { spawn } = require('child_process');

// Note: .env is auto-loaded by lib/audioUtils.js when imported
const { log, loadMetadata, fileExists } = require('./lib');

// Configuration
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const MUSIC_METADATA_DIR = path.join(PROJECT_ROOT, 'audio-metadata/music');
const SFX_METADATA_DIR = path.join(PROJECT_ROOT, 'audio-metadata/sfx');

/**
 * Parse command line arguments
 * @returns {Object} Parsed arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: false,
    keys: [],
    musicOnly: false,
    sfxOnly: false,
    region: null,
    category: null,
    skipExisting: true,
    force: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--key':
        options.keys.push(args[++i]);
        break;
      case '--music-only':
        options.musicOnly = true;
        break;
      case '--sfx-only':
        options.sfxOnly = true;
        break;
      case '--region':
        options.region = args[++i];
        break;
      case '--category':
        options.category = args[++i];
        break;
      case '--skip-existing':
        options.skipExisting = true;
        break;
      case '--force':
        options.force = true;
        options.skipExisting = false;
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
Full Audio Generation Script
Orchestrates generation of all music and SFX assets

Usage:
  node scripts/audio/generate-all.js [options]

Options:
  --dry-run         Show what would be generated without calling APIs
  --key <id>        Generate specific track/effect by key
  --music-only      Generate only music tracks
  --sfx-only        Generate only sound effects
  --region <name>   Generate only for specific region (heartlands, sylvan_reaches, etc.)
  --category <cat>  Generate only specific category
                    Music: regions, battle, core
                    SFX: combat, skills, ambient, interactions, ui
  --skip-existing   Skip files that already exist (default: true)
  --force           Regenerate even if file exists
  --help, -h        Show this help message

Environment variables:
  SUNO_API_KEY        Required for music generation
  ELEVENLABS_API_KEY  Required for SFX generation

Examples:
  node scripts/audio/generate-all.js --dry-run
  node scripts/audio/generate-all.js --music-only --region heartlands
  node scripts/audio/generate-all.js --sfx-only --category combat
  node scripts/audio/generate-all.js --force
`);
}

/**
 * Run a child script and capture output
 * @param {string} script - Script path
 * @param {Array} args - Arguments
 * @returns {Promise<Object>} Result with exitCode and output
 */
function runScript(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [script, ...args], {
      cwd: PROJECT_ROOT,
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      resolve({
        exitCode: code,
        stdout,
        stderr
      });
    });
  });
}

/**
 * Get summary of what needs to be generated
 * @param {Object} options - CLI options
 * @returns {Object} Summary counts
 */
function getSummary(options) {
  const summary = {
    music: { total: 0, pending: 0 },
    sfx: { total: 0, pending: 0 }
  };

  // Count music tracks
  if (!options.sfxOnly) {
    const musicManifest = loadMetadata(path.join(MUSIC_METADATA_DIR, 'manifest.json'));
    if (musicManifest) {
      for (const [category, info] of Object.entries(musicManifest.categories)) {
        if (options.category && options.category !== category) continue;

        for (const filePath of info.files) {
          const data = loadMetadata(path.join(MUSIC_METADATA_DIR, filePath));
          if (data && data.tracks) {
            for (const track of data.tracks) {
              if (options.region && track.region !== options.region) continue;
              if (options.keys.length > 0 && !options.keys.includes(track.id)) continue;

              summary.music.total++;
              if (!track.generated) {
                summary.music.pending++;
              }
            }
          }
        }
      }
    }
  }

  // Count SFX
  if (!options.musicOnly) {
    const sfxManifest = loadMetadata(path.join(SFX_METADATA_DIR, 'manifest.json'));
    if (sfxManifest) {
      for (const [category, info] of Object.entries(sfxManifest.categories)) {
        if (options.category && options.category !== category) continue;

        for (const filePath of info.files) {
          const data = loadMetadata(path.join(SFX_METADATA_DIR, filePath));
          if (data && data.effects) {
            for (const effect of data.effects) {
              if (options.keys.length > 0 && !options.keys.includes(effect.id)) continue;

              summary.sfx.total++;
              if (!effect.generated) {
                summary.sfx.pending++;
              }
            }
          }
        }
      }
    }
  }

  return summary;
}

/**
 * Check environment variables
 * @param {Object} options - CLI options
 * @returns {Object} Status of required env vars
 */
function checkEnvVars(options) {
  const status = {
    valid: true,
    missing: []
  };

  if (!options.sfxOnly && !process.env.SUNO_API_KEY) {
    status.valid = false;
    status.missing.push('SUNO_API_KEY');
  }

  if (!options.musicOnly && !process.env.ELEVENLABS_API_KEY) {
    status.valid = false;
    status.missing.push('ELEVENLABS_API_KEY');
  }

  return status;
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

  console.log('');
  log('Full Audio Generation Orchestrator', 'info');
  log('===================================', 'info');
  console.log('');

  // Get summary
  const summary = getSummary(options);
  log('Asset Summary:', 'info');
  if (!options.sfxOnly) {
    console.log(`  Music tracks: ${summary.music.pending} pending / ${summary.music.total} total`);
  }
  if (!options.musicOnly) {
    console.log(`  Sound effects: ${summary.sfx.pending} pending / ${summary.sfx.total} total`);
  }
  console.log('');

  // Check if there's anything to do
  const totalPending = summary.music.pending + summary.sfx.pending;
  if (totalPending === 0 && !options.force) {
    log('No assets need generation. Use --force to regenerate existing files.', 'success');
    process.exit(0);
  }

  // Dry run summary
  if (options.dryRun) {
    log('Dry run mode - showing what would be generated:', 'info');
    console.log('');
  }

  // Check environment variables (not needed for dry run)
  if (!options.dryRun) {
    const envStatus = checkEnvVars(options);
    if (!envStatus.valid) {
      log('Missing required environment variables:', 'error');
      for (const missing of envStatus.missing) {
        console.log(`  - ${missing}`);
      }
      console.log('');
      log('Set them with:', 'info');
      console.log('  export SUNO_API_KEY=your_suno_key');
      console.log('  export ELEVENLABS_API_KEY=your_elevenlabs_key');
      process.exit(1);
    }
  }

  const results = {
    music: null,
    sfx: null
  };

  // Generate music
  if (!options.sfxOnly && (summary.music.pending > 0 || options.force)) {
    log('Starting music generation...', 'info');
    console.log('');

    const musicArgs = [];
    if (options.dryRun) musicArgs.push('--dry-run');
    options.keys.forEach(k => musicArgs.push('--key', k));
    if (options.region) musicArgs.push('--region', options.region);
    if (options.category) musicArgs.push('--category', options.category);
    if (options.force) musicArgs.push('--force');

    try {
      results.music = await runScript(
        path.join(__dirname, 'generate-music.js'),
        musicArgs
      );
    } catch (error) {
      log(`Music generation failed: ${error.message}`, 'error');
      results.music = { exitCode: 1, error: error.message };
    }

    console.log('');
  } else if (!options.sfxOnly) {
    log('Skipping music generation (no pending tracks)', 'info');
  }

  // Generate SFX
  if (!options.musicOnly && (summary.sfx.pending > 0 || options.force)) {
    log('Starting SFX generation...', 'info');
    console.log('');

    const sfxArgs = [];
    if (options.dryRun) sfxArgs.push('--dry-run');
    options.keys.forEach(k => sfxArgs.push('--key', k));
    if (options.category) sfxArgs.push('--category', options.category);
    if (options.force) sfxArgs.push('--force');

    try {
      results.sfx = await runScript(
        path.join(__dirname, 'generate-sfx.js'),
        sfxArgs
      );
    } catch (error) {
      log(`SFX generation failed: ${error.message}`, 'error');
      results.sfx = { exitCode: 1, error: error.message };
    }

    console.log('');
  } else if (!options.musicOnly) {
    log('Skipping SFX generation (no pending effects)', 'info');
  }

  // Final summary
  console.log('========================================');
  log('Overall Summary', 'info');
  console.log('========================================');

  if (results.music) {
    const musicStatus = results.music.exitCode === 0 ? 'SUCCESS' : 'FAILED';
    console.log(`  Music:  ${musicStatus}`);
  } else {
    console.log('  Music:  SKIPPED');
  }

  if (results.sfx) {
    const sfxStatus = results.sfx.exitCode === 0 ? 'SUCCESS' : 'FAILED';
    console.log(`  SFX:    ${sfxStatus}`);
  } else {
    console.log('  SFX:    SKIPPED');
  }

  console.log('');

  // Exit with appropriate code
  const hasErrors = (results.music && results.music.exitCode !== 0) ||
                    (results.sfx && results.sfx.exitCode !== 0);

  if (hasErrors) {
    log('Some generations failed. Check output above for details.', 'warn');
    process.exit(1);
  }

  if (options.dryRun) {
    log('Dry run complete. No files were generated.', 'success');
  } else {
    log('Audio generation complete.', 'success');
    if (!options.sfxOnly) {
      log('Use download-audio.js to check and download pending music tracks.', 'info');
    }
  }

  process.exit(0);
}

main().catch(error => {
  log(`Unexpected error: ${error.message}`, 'error');
  console.error(error);
  process.exit(1);
});
