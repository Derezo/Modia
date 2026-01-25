#!/usr/bin/env node
/**
 * One-time batch repair for all users with discovery issues
 *
 * This script fixes users whose characters are at nodes that aren't
 * in their user_node_discovery table, causing empty world map display.
 *
 * Run: node scripts/repair-discovery.js
 */

// Import database config first (loads .env and sets up type parsers)
import '../api/src/config/database.js';
import { batchRepairAllUsers } from '../api/src/services/world/discoveryValidationService.js';

async function main() {
  console.log('=== Discovery Batch Repair ===');
  console.log(`Started: ${new Date().toISOString()}`);
  console.log('');

  const result = await batchRepairAllUsers();

  console.log('');
  console.log('=== Summary ===');
  console.log(`Users checked: ${result.total}`);
  console.log(`Users repaired: ${result.repaired}`);
  console.log(`Errors: ${result.errors.length}`);

  if (result.errors.length > 0) {
    console.log('');
    console.log('=== Errors ===');
    for (const err of result.errors) {
      console.log(`  User ${err.username} (${err.userId}): ${err.error}`);
    }
  }

  console.log('');
  console.log(`Finished: ${new Date().toISOString()}`);

  process.exit(result.errors.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
