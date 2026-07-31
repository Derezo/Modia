#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseBlueprintActionArgs,
  previewBlueprintCandidates
} from './blueprint-candidate-lifecycle.mjs';

function usage() {
  return `Create a strict mechanical preview of blueprint candidates.

Usage:
  node scripts/battle-maps/preview-map-candidates.mjs --theme <theme> --template <id> (--map <id>|--all)

The output is local review data only. Raw candidate JSON never enters the game.`;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseBlueprintActionArgs(argv, { allowAll: true });
  if (options.help) {
    console.log(usage());
    return { ok: true, help: true };
  }
  const result = await previewBlueprintCandidates(options);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    for (const entry of result.results) {
      console.log(`${entry.mapId}: ${entry.svgPath}`);
    }
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Battle-map candidate preview failed: ${error.message}`);
    process.exitCode = 1;
  });
}
