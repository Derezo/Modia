'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  parseDispatchArgs
} = require('./generate-authored-character-candidates');

test('routes player arguments only to the authored player generator', () => {
  const result = parseDispatchArgs([
    '--type', 'player', '--id', 'elf_male_medic', '--phase', 'animations'
  ]);

  assert.equal(
    path.basename(result.script),
    'generate-authored-player-candidates.js'
  );
  assert.deepEqual(result.forwarded, [
    '--id', 'elf_male_medic', '--phase', 'animations'
  ]);
});

test('routes enemy arguments only to the authored enemy generator', () => {
  const result = parseDispatchArgs([
    '--type', 'enemies', '--biome', 'forest', '--id', 'giant_spider'
  ]);

  assert.equal(
    path.basename(result.script),
    'generate-authored-enemy-candidates.js'
  );
  assert.deepEqual(result.forwarded, [
    '--biome', 'forest', '--id', 'giant_spider'
  ]);
});

test('rejects missing, legacy, and duplicate pipeline selectors', () => {
  assert.throws(
    () => parseDispatchArgs(['--id', 'warrior']),
    /provide --type player or --type enemies/
  );
  assert.throws(
    () => parseDispatchArgs(['--type', 'legacy']),
    /provide --type player or --type enemies/
  );
  assert.throws(
    () => parseDispatchArgs(['--type', 'player', '--type', 'enemies']),
    /only once/
  );
});
