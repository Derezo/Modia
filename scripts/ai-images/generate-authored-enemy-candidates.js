#!/usr/bin/env node
'use strict';

process.env.MODIA_AUTHORED_CHARACTER_KIND = 'enemy';

const { main } = require('./generate-authored-player-candidates');

if (require.main === module) {
  main().catch(error => {
    console.error(`Enemy candidate generation failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
