#!/usr/bin/env node

import {
  buildCatalogRelease,
  parseCatalogArgs
} from './content-release-lifecycle.mjs';

const HELP = `Usage:
  npm run battle-maps:coverage -- --release <id> [--metadata-only] [--json]

Verifies the immutable release, exact map/approval/art pins, and every declared
theme/tier/mode/player/opponent coverage case. This command never activates a
release.`;

try {
  const options = parseCatalogArgs();
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
  } else {
    if (options.activate) throw new Error('coverage check does not accept --activate');
    const result = await buildCatalogRelease({
      ...options,
      activate: false,
      checkOnly: true,
      requireCompleteCoverage: true
    });
    process.stdout.write(options.json
      ? `${JSON.stringify(result)}\n`
      : `${JSON.stringify(result, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
