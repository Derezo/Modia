#!/usr/bin/env node

/**
 * Compatibility adapter for the retired PNG/64x16 tile validator.
 * The canonical validator checks metadata, WebP geometry, alpha coverage,
 * edge compatibility, and (with --strict) unexpected legacy files.
 */

const {
  translateLegacyValidatorArgs,
  runCanonicalValidator
} = require('../tiles/legacyTileAdapters');

function main(argv = process.argv.slice(2)) {
  try {
    const args = translateLegacyValidatorArgs(argv);
    console.error(
      '[deprecated] Delegating to scripts/tiles/validate-isometric-tiles.js. ' +
      'The legacy --fix flag now means a strict, verbose read-only audit.'
    );
    return runCanonicalValidator(args);
  } catch (error) {
    console.error(`Tile validation rejected: ${error.message}`);
    console.error('Run `npm run tiles:validate -- --help` for supported options.');
    return 2;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { main };
