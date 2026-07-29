#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const TARGETS = Object.freeze({
  player: 'generate-authored-player-candidates.js',
  enemies: 'generate-authored-enemy-candidates.js'
});

function parseDispatchArgs(argv) {
  const forwarded = [];
  let type = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg !== '--type') {
      forwarded.push(arg);
      continue;
    }

    if (type !== null) {
      throw new Error('--type may be provided only once');
    }
    type = argv[index + 1];
    index += 1;
  }

  if (!TARGETS[type]) {
    throw new Error(
      'provide --type player or --type enemies; character generation requires an explicit authored pipeline'
    );
  }

  return {
    type,
    script: path.join(__dirname, TARGETS[type]),
    forwarded
  };
}

function main(argv = process.argv.slice(2)) {
  const dispatch = parseDispatchArgs(argv);
  const result = spawnSync(
    process.execPath,
    [dispatch.script, ...dispatch.forwarded],
    { cwd: process.cwd(), stdio: 'inherit' }
  );

  if (result.error) {
    throw result.error;
  }
  process.exitCode = result.status ?? 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Character candidate dispatch failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  parseDispatchArgs
};
