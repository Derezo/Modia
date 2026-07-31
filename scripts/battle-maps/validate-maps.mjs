#!/usr/bin/env node

import {
  parseCompileArgs,
  validateCompiledTemplate
} from './content-release-lifecycle.mjs';

const HELP = `Usage:
  npm run battle-maps:validate -- --theme <theme> --template <template> \\
    (--map <id> | --all-approved) [--metadata-only] [--json]

Recompiles twice, verifies exact pins/assets, and requires canonical tracked
outputs to be byte-identical. No network or candidate generation is used.`;

try {
  const options = parseCompileArgs();
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
  } else {
    const result = await validateCompiledTemplate(options);
    process.stdout.write(options.json
      ? `${JSON.stringify(result)}\n`
      : `${JSON.stringify(result, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
