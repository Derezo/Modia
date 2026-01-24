#!/usr/bin/env node
/**
 * AI Image Backup Restoration Script
 * Restores AI-generated images from backup directories
 *
 * Usage:
 *   npm run ai:restore -- --list                          # List available backups
 *   npm run ai:restore -- --timestamp 2026-01-22_15-30-45 # Restore specific backup
 *   npm run ai:restore -- --latest                        # Restore most recent backup
 *   npm run ai:restore -- --latest --yes                  # Skip confirmation prompt
 *
 */

const path = require('path');
const readline = require('readline');
const {
  log,
  getProjectRoot,
  formatBytes
} = require('./lib');

// Import backup utilities (stub - will be implemented in backupUtils.js)
let backupUtils;
try {
  backupUtils = require('./lib/backupUtils');
} catch (error) {
  // Provide stub implementations if backupUtils doesn't exist yet
  backupUtils = {
    listBackups: () => [],
    getBackupInfo: () => null,
    restoreBackup: () => ({ success: false, error: 'backupUtils not implemented' }),
    getLatestBackup: () => null
  };
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    list: false,
    timestamp: null,
    latest: false,
    yes: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--list':
      case '-l':
        options.list = true;
        break;
      case '--timestamp':
      case '-t':
        options.timestamp = args[++i];
        break;
      case '--latest':
        options.latest = true;
        break;
      case '--yes':
      case '-y':
        options.yes = true;
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
AI Image Backup Restoration Script
Restores AI-generated images from backup directories

Usage:
  node scripts/ai-images/restore-backup.js [options]

Options:
  --list, -l                List all available backups
  --timestamp, -t <stamp>   Restore backup with specific timestamp
  --latest                  Restore the most recent backup
  --yes, -y                 Skip confirmation prompt
  --help, -h                Show this help message

Timestamp Format:
  YYYY-MM-DD_HH-MM-SS (e.g., 2026-01-22_15-30-45)

Examples:
  npm run ai:restore -- --list
  npm run ai:restore -- --latest
  npm run ai:restore -- --timestamp 2026-01-22_15-30-45
  npm run ai:restore -- --latest --yes
`);
}

/**
 * Format a timestamp for display
 * @param {string} timestamp - Timestamp in YYYY-MM-DD_HH-MM-SS format
 * @returns {string} Human-readable date string
 */
function formatTimestamp(timestamp) {
  // Convert 2026-01-22_15-30-45 to 2026-01-22 15:30:45
  const [datePart, timePart] = timestamp.split('_');
  if (!datePart || !timePart) return timestamp;

  const formattedTime = timePart.replace(/-/g, ':');
  return `${datePart} ${formattedTime}`;
}

/**
 * List all available backups
 */
function listBackups() {
  const backups = backupUtils.listBackups();

  if (backups.length === 0) {
    console.log('No backups found.');
    console.log('');
    console.log('Backups are created automatically when regenerating assets with --force.');
    return;
  }

  console.log('Available Backups');
  console.log('=================');
  console.log('');

  // Calculate column widths
  const maxTimestampLen = Math.max(...backups.map(b => b.timestamp.length), 10);

  // Header
  console.log(`  ${'Timestamp'.padEnd(maxTimestampLen)}  ${'Assets'.padStart(8)}  ${'Size'.padStart(10)}  Created`);
  console.log(`  ${'-'.repeat(maxTimestampLen)}  ${'-'.repeat(8)}  ${'-'.repeat(10)}  ${'-'.repeat(20)}`);

  for (const backup of backups) {
    const info = backupUtils.getBackupInfo(backup.timestamp);
    const assetCount = info ? info.assetCount.toString() : '?';
    const size = info ? formatBytes(info.totalSize) : '?';
    const created = formatTimestamp(backup.timestamp);

    console.log(`  ${backup.timestamp.padEnd(maxTimestampLen)}  ${assetCount.padStart(8)}  ${size.padStart(10)}  ${created}`);
  }

  console.log('');
  console.log(`Total: ${backups.length} backup(s)`);
}

/**
 * Prompt user for confirmation
 * @param {string} message - Confirmation message
 * @returns {Promise<boolean>} True if confirmed
 */
function confirm(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Restore a backup by timestamp
 * @param {string} timestamp - Backup timestamp
 * @param {Object} options - CLI options
 */
async function restoreBackup(timestamp, options) {
  const info = backupUtils.getBackupInfo(timestamp);

  if (!info) {
    log(`Backup not found: ${timestamp}`, 'error');
    console.log('');
    console.log('Use --list to see available backups.');
    process.exit(1);
  }

  // Display backup info
  console.log('Backup Information');
  console.log('==================');
  console.log(`  Timestamp:    ${formatTimestamp(timestamp)}`);
  console.log(`  Assets:       ${info.assetCount}`);
  console.log(`  Total Size:   ${formatBytes(info.totalSize)}`);
  console.log('');

  // Show category breakdown if available
  if (info.categories && Object.keys(info.categories).length > 0) {
    console.log('Categories:');
    for (const [category, count] of Object.entries(info.categories)) {
      console.log(`  - ${category}: ${count} assets`);
    }
    console.log('');
  }

  // Confirmation
  if (!options.yes) {
    console.log('WARNING: This will overwrite existing generated images.');
    const confirmed = await confirm('Proceed with restore?');
    if (!confirmed) {
      log('Restore cancelled by user', 'info');
      process.exit(0);
    }
  }

  console.log('');
  log('Starting restore...', 'info');

  // Perform restore
  const result = backupUtils.restoreBackup(timestamp);

  if (result.success) {
    console.log('');
    console.log('Restore Summary');
    console.log('===============');
    console.log(`  Files restored: ${result.restored || 0}`);
    console.log(`  Files skipped:  ${result.skipped || 0}`);
    console.log(`  Errors:         ${result.errors || 0}`);
    console.log('');
    log('Backup restored successfully!', 'success');
  } else {
    console.log('');
    log(`Restore failed: ${result.error || 'Unknown error'}`, 'error');
    if (result.details) {
      console.log('Details:', result.details);
    }
    process.exit(1);
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

  // List backups
  if (options.list) {
    listBackups();
    process.exit(0);
  }

  // Restore latest backup
  if (options.latest) {
    const latestTimestamp = backupUtils.getLatestBackup();
    if (!latestTimestamp) {
      log('No backups available', 'error');
      console.log('');
      console.log('Backups are created automatically when regenerating assets with --force.');
      process.exit(1);
    }
    log(`Latest backup: ${latestTimestamp}`, 'info');
    console.log('');
    await restoreBackup(latestTimestamp, options);
    process.exit(0);
  }

  // Restore specific timestamp
  if (options.timestamp) {
    await restoreBackup(options.timestamp, options);
    process.exit(0);
  }

  // No action specified
  log('No action specified', 'warn');
  console.log('');
  console.log('Use one of the following:');
  console.log('  --list              List available backups');
  console.log('  --latest            Restore most recent backup');
  console.log('  --timestamp <ts>    Restore specific backup');
  console.log('');
  console.log('Run with --help for more information.');
  process.exit(1);
}

main().catch(error => {
  log(`Unexpected error: ${error.message}`, 'error');
  console.error(error);
  process.exit(1);
});
