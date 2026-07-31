#!/usr/bin/env node

import {
  buildCatalogRelease,
  parseCatalogArgs
} from './content-release-lifecycle.mjs';

const HELP = `Usage:
  npm run battle-maps:catalog -- --release <id> [--metadata-only] [--check] \\
    [--activate] [--json]

Builds/checks battle-maps/catalog/releases/<id>.json from the fixed tracked
definition. --activate writes battle-maps/catalog/active-release.json and is
refused unless every ignored screenshot and runtime asset is locally restored
and hash verified. No runtime flag or environment activation is used.`;

try {
  const options = parseCatalogArgs();
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
  } else {
    const result = await buildCatalogRelease(options);
    process.stdout.write(options.json
      ? `${JSON.stringify(result)}\n`
      : `${JSON.stringify(result, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
