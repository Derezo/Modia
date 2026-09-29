#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  approveBlueprintCandidate,
  parseBlueprintActionArgs
} from './blueprint-candidate-lifecycle.mjs';

function usage() {
  return `Explicitly approve or reject one exact symbolic map blueprint.

Usage:
  node scripts/battle-maps/approve-map-candidate.mjs --theme <theme> --template <id> \
    --map <id> --reviewer <id> [--reason <rationale>] \
    [--decision approved|rejected] [--update-pins] [--force]

V3 approvals require a bounded, trimmed, control-free rationale. Historical
forest-template-01 through forest-template-06 approvals are replay-only and
cannot be created or changed; author a new V3 template identity instead.
Approval never generates art or compiles a runtime map.`;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseBlueprintActionArgs(argv, {
    requireReviewer: true,
    allowDecision: true,
    allowForce: true,
    allowUpdatePins: true,
    allowReason: true,
    requireReasonForNewApproval: true,
    requireV3AuthoringIdentity: true
  });
  if (options.help) {
    console.log(usage());
    return { ok: true, help: true };
  }
  const result = await approveBlueprintCandidate(options);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(
      result.promoted
        ? `Approved ${options.mapId}; exact blueprint and review pins were recorded.`
        : `Rejected ${options.mapId}; no blueprint was promoted.`
    );
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Battle-map candidate approval failed: ${error.message}`);
    process.exitCode = 1;
  });
}
