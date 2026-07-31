#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseBlueprintActionArgs,
  verifyApprovedBlueprints
} from './blueprint-candidate-lifecycle.mjs';

export async function main(argv = process.argv.slice(2)) {
  const options = parseBlueprintActionArgs(argv, { allowAll: true });
  if (options.help) {
    console.log(
      'Usage: node scripts/battle-maps/check-approved-blueprints.mjs '
      + '--theme <theme> --template <id> --all [--json]'
    );
    return { ok: true, help: true };
  }
  if (!options.all) {
    throw new Error('approved-blueprint verification requires --all');
  }
  const result = await verifyApprovedBlueprints(options);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    result.results.forEach(entry =>
      console.log(`${entry.valid ? 'ok' : 'invalid'} ${entry.mapId}${entry.error ? `: ${entry.error}` : ''}`)
    );
  }
  if (!result.ok) process.exitCode = 1;
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Approved-blueprint check failed: ${error.message}`);
    process.exitCode = 1;
  });
}
