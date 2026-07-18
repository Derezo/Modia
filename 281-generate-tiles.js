#!/usr/bin/env node

/**
 * Backwards-compatible entry point for the retired AI terrain generator.
 * Terrain geometry is now a deterministic build artifact; this adapter accepts
 * safe selectors/file controls and delegates them to the canonical compiler.
 */

const {
  translateLegacyAiTileArgs,
  runCanonicalGenerator
} = require('../tiles/legacyTileAdapters');

function main(argv = process.argv.slice(2)) {
  try {
    const args = translateLegacyAiTileArgs(argv);
    if (!args.includes('--quiet') && !args.includes('-q')) {
      console.error(
        '[deprecated] scripts/ai-images/generate-tiles.js now delegates to ' +
        'scripts/tiles/generate-isometric-tiles.js (iso64-retina-v3).'
      );
    }
    return runCanonicalGenerator(args);
  } catch (error) {
    console.error(`Tile generation rejected: ${error.message}`);
    console.error('Run `npm run tiles:generate -- --help` for supported options.');
    return 2;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { main };
