#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  generateBlueprintCandidates,
  parseBlueprintGenerateArgs
} from './blueprint-candidate-lifecycle.mjs';

function usage() {
  return `Generate isolated symbolic Battle Map V3 blueprint candidates.

Usage:
  node scripts/battle-maps/generate-map-candidates.mjs --theme <theme> --template <id> [options]

Options:
  --map <id>            Generate one declared map ID; repeatable
  --maps <1..3>         Generate the first N declared variants (default: all 3)
  --concurrency <1..4>  Disposable workers (default: 2)
  --timeout <seconds>   Per-worker timeout
  --dry-run             Validate and print the plan without Codex or writes
  --resume              Skip complete pinned candidates
  --force               Replace requested local candidates
  --text-template-fallback
                        Use reviewed sidecar intent without attaching the local
                        source image when nested image sandboxing is unavailable
  --json                Print machine-readable output
  --project-root <path> Isolated test root
  --help                Show this help

Raw candidates and complete logs remain in the ignored candidate tree. This
command never approves, compiles, or edits runtime content. Historical
forest-template-01 through forest-template-06 identities are replay-only;
create a new template identity for all V3 authoring.`;
}

export async function main(argv = process.argv.slice(2), dependencies) {
  const options = parseBlueprintGenerateArgs(argv);
  if (options.help) {
    console.log(usage());
    return { ok: true, help: true };
  }
  const result = await generateBlueprintCandidates(options, dependencies);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(
      `${result.dryRun ? 'Planned' : 'Completed'} ${result.jobs.length} isolated blueprint job(s) `
      + `for ${result.theme}/${result.template}.`
    );
    console.log('No blueprint was approved or compiled.');
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Battle-map blueprint generation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
