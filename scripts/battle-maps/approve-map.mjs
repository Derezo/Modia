#!/usr/bin/env node

import {
  approveCompiledMap,
  parseApprovalArgs
} from './content-release-lifecycle.mjs';

const HELP = `Usage:
  npm run battle-maps:approve -- --theme <theme> --template <template> \\
    --map <id> --screenshot <tracked-local-review-path> --reviewer <id> \\
    --reason <specific-visual-rationale> [--json]

Approval requires an exact deterministic recompile, restored runtime art, and
the exact reviewed screenshot. The rationale must describe the inspected
composition, topology, seams, elevation, boundaries, and gameplay readability.
Approval writes only tracked metadata; the screenshot remains local binary
evidence.`;

try {
  const options = parseApprovalArgs();
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
  } else {
    const result = await approveCompiledMap(options);
    process.stdout.write(options.json
      ? `${JSON.stringify(result)}\n`
      : `${JSON.stringify(result, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
