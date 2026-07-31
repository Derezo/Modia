#!/usr/bin/env node

import {
  compileApprovedTemplate,
  parseCompileArgs
} from './content-release-lifecycle.mjs';

const HELP = `Usage:
  npm run battle-maps:compile -- --theme <theme> --template <template> \\
    (--map <id> | --all-approved) [--metadata-only] [--check] [--json]

Canonical outputs are immutable under battle-maps/compiled/<theme>/.
--metadata-only explicitly skips ignored binary evidence and never claims it
was verified. It is suitable for clean-CI deterministic recompilation.`;

try {
  const options = parseCompileArgs();
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
  } else {
    const result = await compileApprovedTemplate(options);
    process.stdout.write(options.json
      ? `${JSON.stringify(result)}\n`
      : `${JSON.stringify(result, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
